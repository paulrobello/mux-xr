import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import {
  type ClipboardSecret,
  clientKey,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import { createRequestLimiter, type RequestLimiter } from './host-stats-server';

/**
 * One generic read-only JSON feed per path, gated like `/host-stats`: the server sends a nonce, the
 * client answers with its request text and an HMAC of `${protocol}\n${nonce}\n${request}` keyed by the
 * clipboard pairing secret, and gets one `{type:'feed', data}` or `{type:'error', code}` back.
 */
const MAX_MESSAGE_BYTES = 8 * 1024;
export const MAX_FEED_REQUEST_CHARS = 4096;
const MAX_CONNECTIONS = 6;
const MAX_CONNECTIONS_PER_CLIENT = 3;
const AUTH_TIMEOUT_MS = 5_000;
/** Longer than a cold cache needs: the kanban CLI makes a network round trip per call. */
const SESSION_TIMEOUT_MS = 25_000;
/** Successful requests per client per minute; widgets poll every 30-60 s. */
export const FEED_REQUEST_LIMIT = 20;

/** C0 and C1 controls; they would split the signed text. */
const CONTROL_CHARS = /\p{Cc}/u;

export type FeedErrorCode =
  | 'disabled'
  | 'not_configured'
  | 'auth'
  | 'rate_limited'
  | 'protocol'
  | 'upstream';

/** Thrown by a feed loader to answer `not_configured` or `upstream` instead of a payload. */
export class FeedError extends Error {
  constructor(readonly code: 'not_configured' | 'upstream') {
    super(code);
  }
}

/** Refusal and failure codes only; requests and payloads are never reported. */
export type FeedEvent = {
  kind: 'refused';
  feed: string;
  code: 'origin' | 'rate_limited' | 'busy' | FeedErrorCode;
};

export const feedMac = (key: Buffer, protocol: string, nonce: string, request: string): Buffer =>
  createHmac('sha256', key).update(`${protocol}\n${nonce}\n${request}`).digest();

export type FeedRouteOptions = {
  /** Short name for events, such as `kanban-strip`. */
  name: string;
  protocol: string;
  allowedOrigins: string[];
  /** The clipboard pairing secret, reread per connection; disabled answers `disabled`. */
  loadSecret: () => ClipboardSecret;
  /** Runs only after a valid MAC; throw {@link FeedError} for `not_configured` or `upstream`. */
  load: (request: string) => Promise<unknown>;
  /** Auth failures; share the clipboard route's limiter so every route draws on one budget. */
  limiter?: FailureLimiter;
  requestLimiter?: RequestLimiter;
  now?: () => number;
  authTimeoutMs?: number;
  sessionTimeoutMs?: number;
  maxConnections?: number;
  maxConnectionsPerClient?: number;
  onEvent?: (event: FeedEvent) => void;
};

export type FeedRoute = {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
};

const rawText = (data: RawData): string =>
  (Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)])
  ).toString('utf8');

export const createFeedRoute = (options: FeedRouteOptions): FeedRoute => {
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createRequestLimiter(options.now, FEED_REQUEST_LIMIT, 60_000);
  const authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const sessionTimeoutMs = options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
  const maxPerClient = options.maxConnectionsPerClient ?? MAX_CONNECTIONS_PER_CLIENT;
  const sockets = new Set<WebSocket>();
  let upgrading = 0;
  const perClient = new Map<string, number>();
  const emit = (code: FeedEvent['code']): void => {
    try {
      options.onEvent?.({ kind: 'refused', feed: options.name, code });
    } catch {
      /* Observability must not interrupt the route. */
    }
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const refuseHttp = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !options.allowedOrigins.includes(origin)) {
      emit('origin');
      refuseHttp(socket, '403 Forbidden');
      return;
    }
    const ip = clientKey(request.socket.remoteAddress);
    if (limiter.saturated(ip) || requests.blocked(ip)) {
      emit('rate_limited');
      refuseHttp(socket, '429 Too Many Requests');
      return;
    }
    if (sockets.size + upgrading >= maxConnections || (perClient.get(ip) ?? 0) >= maxPerClient) {
      emit('busy');
      refuseHttp(socket, '503 Service Unavailable');
      return;
    }
    perClient.set(ip, (perClient.get(ip) ?? 0) + 1);
    let held = true;
    const releaseClient = (): void => {
      if (!held) return;
      held = false;
      const left = (perClient.get(ip) ?? 1) - 1;
      if (left > 0) perClient.set(ip, left);
      else perClient.delete(ip);
    };
    const attempt = limiter.begin(ip);
    let reserved = true;
    const release = (): void => {
      if (!reserved) return;
      reserved = false;
      upgrading -= 1;
    };
    upgrading += 1;
    // A failed handshake never reaches the callback, so the raw socket's close releases both.
    socket.once('close', () => {
      release();
      releaseClient();
      attempt();
    });
    wss.handleUpgrade(request, socket, head, (client) => {
      release();
      client.once('close', releaseClient);
      serve(client, ip, attempt);
    });
  };

  const serve = (socket: WebSocket, ip: string, attempt: () => void): void => {
    sockets.add(socket);
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (code: number, reason: string): void => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      socket.close(code, reason);
    };
    const fail = (code: FeedErrorCode): void => {
      if (code === 'auth') limiter.fail(ip);
      if (code !== 'protocol') emit(code);
      attempt();
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'error', code }));
      finish(1008, code);
    };
    socket.on('close', () => {
      attempt();
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      sockets.delete(socket);
    });
    socket.on('error', () => undefined);

    const secret = options.loadSecret();
    if (!secret.enabled) {
      fail('disabled');
      return;
    }
    const nonce = randomBytes(32).toString('base64');
    let phase: 'auth' | 'busy' = 'auth';
    timers.push(
      setTimeout(() => {
        if (phase === 'auth') fail('auth');
      }, authTimeoutMs),
      setTimeout(() => finish(1000, 'session timeout'), sessionTimeoutMs),
    );
    socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: options.protocol }));

    socket.on('message', async (data, isBinary) => {
      if (finished) return;
      if (phase !== 'auth' || isBinary) {
        fail('protocol');
        return;
      }
      phase = 'busy';
      let message: { type?: unknown; mac?: unknown; request?: unknown };
      try {
        message = JSON.parse(rawText(data));
      } catch {
        message = {};
      }
      if (
        message?.type !== 'auth' ||
        typeof message.mac !== 'string' ||
        typeof message.request !== 'string' ||
        message.request.length > MAX_FEED_REQUEST_CHARS ||
        CONTROL_CHARS.test(message.request) ||
        limiter.blocked(ip)
      ) {
        fail('auth');
        return;
      }
      const provided = Buffer.from(message.mac, 'base64');
      const expected = feedMac(secret.key, options.protocol, nonce, message.request);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        fail('auth');
        return;
      }
      attempt();
      if (requests.blocked(ip)) {
        fail('rate_limited');
        return;
      }
      requests.record(ip);
      let payload: unknown;
      try {
        payload = await options.load(message.request);
      } catch (error) {
        if (finished) return;
        fail(error instanceof FeedError ? error.code : 'upstream');
        return;
      }
      if (finished) return;
      socket.send(JSON.stringify({ type: 'feed', data: payload }));
      finish(1000, 'complete');
    });
  };

  return {
    handleUpgrade,
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
};
