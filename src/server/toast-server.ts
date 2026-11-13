import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import {
  parseToastEnvelope,
  parseToastRequest,
  type Toast,
  type ToastEnvelope,
} from '../toast-contract';
import {
  type ClipboardSecret,
  clientKey,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import { createRequestLimiter, type RequestLimiter } from './host-stats-server';

/** Senders POST one toast here. */
export const TOAST_PATH = '/toast';
/** Headsets subscribe here and receive every toast. */
export const TOASTS_PATH = '/toasts';
export const TOASTS_PROTOCOL = 'mux-xr-toasts-v1';
export const TOAST_BODY_MAX_BYTES = 4 * 1024;
/** Accepted toasts per sender per minute. */
export const TOAST_REQUEST_LIMIT = 120;
const BODY_TIMEOUT_MS = 5_000;
const AUTH_TIMEOUT_MS = 5_000;
const PING_INTERVAL_MS = 25_000;
const MAX_SUBSCRIBERS = 8;
const MAX_SUBSCRIBERS_PER_CLIENT = 4;
const MAX_MESSAGE_BYTES = 1024;
/** Toasts kept for headsets that connect later, such as after a reload. */
const REPLAY_LIMIT = 16;

export type ToastEvent =
  | { kind: 'toast'; level: Toast['level']; delivered: number }
  | { kind: 'dismiss'; delivered: number }
  | {
      kind: 'refused';
      code:
        | 'origin'
        | 'remote'
        | 'auth'
        | 'disabled'
        | 'rate_limited'
        | 'busy'
        | 'invalid'
        | 'too_large';
    };

export type ToastHubOptions = {
  allowedOrigins: string[];
  /** The clipboard pairing secret, reread per request and per subscription. */
  loadSecret: () => ClipboardSecret;
  /** Accept senders from other LAN hosts, not only this Mac. They still need the secret. */
  allowRemoteSenders?: boolean;
  limiter?: FailureLimiter;
  requestLimiter?: RequestLimiter;
  now?: () => number;
  makeId?: () => string;
  authTimeoutMs?: number;
  pingIntervalMs?: number;
  bodyTimeoutMs?: number;
  maxSubscribers?: number;
  /** Levels, counts and refusal codes only; never message text or the secret. */
  onEvent?: (event: ToastEvent) => void;
};

export type ToastHub = {
  /** True when it answered the request; false leaves it to the caller. */
  handleRequest(request: IncomingMessage, response: ServerResponse): boolean;
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
};

export const toastsMac = (key: Buffer, nonce: string): Buffer =>
  createHmac('sha256', key).update(`${TOASTS_PROTOCOL}\n${nonce}\nsubscribe`).digest();

export const isLoopbackAddress = (address: string | undefined): boolean =>
  !!address && (address === '::1' || /^127\./.test(address) || /^::ffff:127\./i.test(address));

const digest = (value: Buffer): Buffer => createHash('sha256').update(value).digest();

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export const bearerMatches = (header: string | undefined, key: Buffer): boolean => {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  if (!match) return false;
  return timingSafeEqual(digest(Buffer.from(match[1].trim(), 'utf8')), digest(key));
};

const rawText = (data: RawData): string =>
  (Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)])
  ).toString('utf8');

export const createToastHub = (options: ToastHubOptions): ToastHub => {
  const now = options.now ?? Date.now;
  const limiter = options.limiter ?? createFailureLimiter(now);
  const requests = options.requestLimiter ?? createRequestLimiter(now, TOAST_REQUEST_LIMIT);
  const makeId = options.makeId ?? (() => randomUUID());
  const maxSubscribers = options.maxSubscribers ?? MAX_SUBSCRIBERS;
  const subscribers = new Set<WebSocket>();
  const sockets = new Set<WebSocket>();
  const perClient = new Map<string, number>();
  let upgrading = 0;
  // Newest last; an expired timed toast is dropped before replay.
  const recent: Array<{ toast: Toast; expires: number }> = [];
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const emit = (event: ToastEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      /* Observability must not interrupt the route. */
    }
  };
  const refuse = (
    response: ServerResponse,
    status: number,
    code: Extract<ToastEvent, { kind: 'refused' }>['code'],
    error: string,
  ): void => {
    emit({ kind: 'refused', code });
    response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
    response.end(JSON.stringify({ error }));
  };
  const pruneRecent = (): void => {
    const time = now();
    for (let index = recent.length - 1; index >= 0; index -= 1)
      if (recent[index].expires <= time) recent.splice(index, 1);
    while (recent.length > REPLAY_LIMIT) recent.shift();
  };
  const broadcast = (envelope: ToastEnvelope): number => {
    const existing = recent.findIndex(
      (entry) => entry.toast.id === (envelope.type === 'toast' ? envelope.toast.id : envelope.id),
    );
    if (existing >= 0) recent.splice(existing, 1);
    if (envelope.type === 'toast')
      recent.push({
        toast: envelope.toast,
        expires: envelope.toast.timeout ? now() + envelope.toast.timeout * 1000 : Infinity,
      });
    pruneRecent();
    const text = JSON.stringify(envelope);
    let delivered = 0;
    for (const socket of subscribers)
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(text);
        delivered += 1;
      }
    return delivered;
  };

  const handleRequest = (request: IncomingMessage, response: ServerResponse): boolean => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      return false;
    }
    if (url.pathname !== TOAST_PATH) return false;
    if (url.search) {
      refuse(response, 400, 'invalid', 'The toast route takes no query string.');
      return true;
    }
    if (request.method !== 'POST') {
      emit({ kind: 'refused', code: 'invalid' });
      response.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'POST a JSON toast.' }));
      return true;
    }
    // A browser page always sends Origin; command-line senders never do.
    if (request.headers.origin !== undefined) {
      refuse(response, 403, 'origin', 'Browser pages cannot post toasts.');
      return true;
    }
    const address = request.socket.remoteAddress;
    if (!isLoopbackAddress(address) && !options.allowRemoteSenders) {
      refuse(response, 403, 'remote', 'Toasts are accepted only from this Mac (--toast-lan on).');
      return true;
    }
    const ip = clientKey(address);
    if (limiter.saturated(ip) || requests.blocked(ip)) {
      refuse(response, 429, 'rate_limited', 'Too many toast requests.');
      return true;
    }
    const secret = options.loadSecret();
    if (!secret.enabled) {
      refuse(response, 503, 'disabled', `Toasts need the pairing secret: ${secret.reason}.`);
      return true;
    }
    if (!bearerMatches(request.headers.authorization, secret.key)) {
      limiter.fail(ip);
      refuse(response, 401, 'auth', 'Send Authorization: Bearer <pairing secret>.');
      return true;
    }
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
      refuse(response, 415, 'invalid', 'Send Content-Type: application/json.');
      return true;
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > TOAST_BODY_MAX_BYTES) {
      refuse(
        response,
        413,
        'too_large',
        `Toast bodies are limited to ${TOAST_BODY_MAX_BYTES} bytes.`,
      );
      request.resume();
      return true;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      refuse(response, 408, 'invalid', 'The toast body did not arrive in time.');
      request.destroy();
    }, options.bodyTimeoutMs ?? BODY_TIMEOUT_MS);
    request.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > TOAST_BODY_MAX_BYTES) {
        done = true;
        clearTimeout(timer);
        refuse(
          response,
          413,
          'too_large',
          `Toast bodies are limited to ${TOAST_BODY_MAX_BYTES} bytes.`,
        );
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', () => {
      done = true;
      clearTimeout(timer);
    });
    request.on('end', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        refuse(response, 400, 'invalid', 'The body is not valid JSON.');
        return;
      }
      const parsed = parseToastRequest(body, makeId);
      if (!parsed.ok) {
        refuse(response, 400, 'invalid', parsed.error);
        return;
      }
      requests.record(ip);
      const delivered = broadcast(parsed.value);
      const id = parsed.value.type === 'toast' ? parsed.value.toast.id : parsed.value.id;
      emit(
        parsed.value.type === 'toast'
          ? { kind: 'toast', level: parsed.value.toast.level, delivered }
          : { kind: 'dismiss', delivered },
      );
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id, delivered }));
    });
    return true;
  };

  const refuseUpgrade = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !options.allowedOrigins.includes(origin)) {
      emit({ kind: 'refused', code: 'origin' });
      refuseUpgrade(socket, '403 Forbidden');
      return;
    }
    const ip = clientKey(request.socket.remoteAddress);
    if (limiter.saturated(ip)) {
      emit({ kind: 'refused', code: 'rate_limited' });
      refuseUpgrade(socket, '429 Too Many Requests');
      return;
    }
    if (
      sockets.size + upgrading >= maxSubscribers ||
      (perClient.get(ip) ?? 0) >= MAX_SUBSCRIBERS_PER_CLIENT
    ) {
      emit({ kind: 'refused', code: 'busy' });
      refuseUpgrade(socket, '503 Service Unavailable');
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
    upgrading += 1;
    const release = (): void => {
      if (!reserved) return;
      reserved = false;
      upgrading -= 1;
    };
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
    let phase: 'auth' | 'checking' | 'subscribed' = 'auth';
    let finished = false;
    let alive = true;
    let pinger: ReturnType<typeof setInterval> | undefined;
    const authTimer = setTimeout(() => {
      if (phase !== 'subscribed') fail('auth');
    }, options.authTimeoutMs ?? AUTH_TIMEOUT_MS);
    const finish = (code: number, reason: string): void => {
      if (finished) return;
      finished = true;
      clearTimeout(authTimer);
      if (pinger) clearInterval(pinger);
      socket.close(code, reason);
    };
    const fail = (code: 'auth' | 'disabled' | 'protocol'): void => {
      if (code === 'auth') limiter.fail(ip);
      if (code !== 'protocol') emit({ kind: 'refused', code });
      attempt();
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'error', code }));
      finish(1008, code);
    };
    socket.on('close', () => {
      attempt();
      finished = true;
      clearTimeout(authTimer);
      if (pinger) clearInterval(pinger);
      sockets.delete(socket);
      subscribers.delete(socket);
    });
    socket.on('error', () => undefined);
    socket.on('pong', () => {
      alive = true;
    });

    const secret = options.loadSecret();
    if (!secret.enabled) {
      fail('disabled');
      return;
    }
    const nonce = randomBytes(32).toString('base64');
    socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: TOASTS_PROTOCOL }));
    socket.on('message', (data, isBinary) => {
      if (finished) return;
      if (isBinary || phase === 'checking') {
        fail('protocol');
        return;
      }
      // A subscribed headset may only clear a toast, which clears it on every headset.
      if (phase === 'subscribed') {
        let envelope: ToastEnvelope | null = null;
        try {
          envelope = parseToastEnvelope(JSON.parse(rawText(data)));
        } catch {
          envelope = null;
        }
        if (envelope?.type !== 'dismiss') {
          fail('protocol');
          return;
        }
        emit({ kind: 'dismiss', delivered: broadcast(envelope) });
        return;
      }
      phase = 'checking';
      let message: { type?: unknown; mac?: unknown };
      try {
        message = JSON.parse(rawText(data));
      } catch {
        message = {};
      }
      if (message?.type !== 'auth' || typeof message.mac !== 'string' || limiter.blocked(ip)) {
        fail('auth');
        return;
      }
      const provided = Buffer.from(message.mac, 'base64');
      const expected = toastsMac(secret.key, nonce);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        fail('auth');
        return;
      }
      attempt();
      clearTimeout(authTimer);
      phase = 'subscribed';
      subscribers.add(socket);
      socket.send(JSON.stringify({ type: 'ready' }));
      pruneRecent();
      const time = now();
      // Replays carry the time left, so a reconnect never restarts a toast's full timeout.
      for (const entry of recent)
        socket.send(
          JSON.stringify({
            type: 'toast',
            replay: true,
            toast: {
              ...entry.toast,
              timeout: Number.isFinite(entry.expires)
                ? Math.max(1, Math.ceil((entry.expires - time) / 1000))
                : 0,
            },
          }),
        );
      pinger = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, options.pingIntervalMs ?? PING_INTERVAL_MS);
    });
  };

  return {
    handleRequest,
    handleUpgrade,
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
};
