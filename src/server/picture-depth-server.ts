import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import {
  type ClipboardSecret,
  clientKey,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import type { DepthEstimator } from './depth-estimator';

export const PICTURE_DEPTH_PATH = '/picture-depth';
export const PICTURE_DEPTH_PROTOCOL = 'mux-xr-picture-depth-v1';
/** The client uploads its stored WebP (at most 2048 px), which is far below this. */
/** A stored picture is a 2048 px WebP at quality 0.9, well under this; it is buffered pre-auth too. */
export const PICTURE_DEPTH_MAX_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024;
const MAX_CONNECTIONS = 4;
const MAX_PER_CLIENT = 2;
const AUTH_TIMEOUT_MS = 5_000;
/** Covers the upload and a queued inference behind another client's. */
const SESSION_TIMEOUT_MS = 30_000;
const REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 60_000;
/** Inferences queued or running across every client; more are refused, never queued unbounded. */
const MAX_PENDING = 2;

export type PictureDepthErrorCode =
  | 'disabled'
  | 'auth'
  | 'rate_limited'
  | 'busy'
  | 'protocol'
  | 'too_large'
  | 'not_image'
  | 'failed';

/** The proof binds the nonce to the exact bytes, so it cannot be replayed for another upload. */
export const pictureDepthMac = (key: Buffer, nonce: string, size: number, sha256: string): Buffer =>
  createHmac('sha256', key)
    .update(`${PICTURE_DEPTH_PROTOCOL}\n${nonce}\n${size}\n${sha256}`)
    .digest();

/** True for a RIFF/WEBP container: the only format the client sends (its stored picture). */
export const isWebp = (bytes: Uint8Array): boolean =>
  bytes.length >= 16 &&
  String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
  String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';

export type PictureDepthEvent =
  | { kind: 'depth'; bytes: number; ms: number }
  | { kind: 'refused'; code: PictureDepthErrorCode };

export interface PictureDepthRouteOptions {
  allowedOrigins: string[];
  /** The clipboard pairing secret; this route adds no credential of its own. */
  loadSecret: () => ClipboardSecret;
  /** Required when the route is enabled; absent, every request is refused as disabled. */
  estimator?: DepthEstimator;
  now?: () => number;
  authTimeoutMs?: number;
  sessionTimeoutMs?: number;
  maxBytes?: number;
  /** Auth failures per client. */
  limiter?: FailureLimiter;
  /** Authenticated requests per client. */
  requestLimiter?: FailureLimiter;
  /** Codes, sizes and timings only. */
  onEvent?: (event: PictureDepthEvent) => void;
}

export type PictureDepthRoute = {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
};

const rawBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);

export const createPictureDepthRoute = (options: PictureDepthRouteOptions): PictureDepthRoute => {
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createFailureLimiter(options.now, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  const maxBytes = options.maxBytes ?? PICTURE_DEPTH_MAX_BYTES;
  const sockets = new Set<WebSocket>();
  let pending = 0;
  const perClient = new Map<string, number>();
  let upgrading = 0;
  // The upload is the one large message; text messages are capped separately in the handler.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: Math.max(maxBytes, MAX_TEXT_BYTES),
  });
  const emit = (event: PictureDepthEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      /* Logging must not break a request. */
    }
  };
  const refuseHttp = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const hold = (ip: string): (() => void) => {
    perClient.set(ip, (perClient.get(ip) ?? 0) + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const left = (perClient.get(ip) ?? 1) - 1;
      if (left > 0) perClient.set(ip, left);
      else perClient.delete(ip);
    };
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !options.allowedOrigins.includes(origin)) {
      refuseHttp(socket, '403 Forbidden');
      return;
    }
    const ip = clientKey(request.socket.remoteAddress);
    if (
      limiter.saturated(ip) ||
      requests.blocked(ip) ||
      (perClient.get(ip) ?? 0) >= MAX_PER_CLIENT
    ) {
      refuseHttp(socket, '429 Too Many Requests');
      return;
    }
    if (sockets.size + upgrading >= MAX_CONNECTIONS) {
      refuseHttp(socket, '503 Service Unavailable');
      return;
    }
    const attempt = limiter.begin(ip);
    const release = hold(ip);
    let reserved = true;
    const unreserve = (): void => {
      if (!reserved) return;
      reserved = false;
      upgrading -= 1;
    };
    upgrading += 1;
    socket.once('close', () => {
      unreserve();
      attempt();
      release();
    });
    wss.handleUpgrade(request, socket, head, (client) => {
      unreserve();
      serve(client, ip, attempt, release);
    });
  };

  const serve = (socket: WebSocket, ip: string, attempt: () => void, release: () => void): void => {
    sockets.add(socket);
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (code: number, reason: string): void => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      socket.close(code, reason);
    };
    const fail = (code: PictureDepthErrorCode): void => {
      if (code === 'auth') limiter.fail(ip);
      attempt();
      emit({ kind: 'refused', code });
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'error', code }));
      finish(1008, code);
    };
    const abort = new AbortController();
    socket.on('close', () => {
      abort.abort();
      attempt();
      release();
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      sockets.delete(socket);
    });
    socket.on('error', () => undefined);

    const secret = options.loadSecret();
    const estimator = options.estimator;
    if (!secret.enabled || !estimator) {
      fail('disabled');
      return;
    }
    const nonce = randomBytes(32).toString('base64');
    let phase: 'auth' | 'upload' | 'busy' = 'auth';
    let expected: { size: number; sha256: string } | null = null;
    timers.push(
      setTimeout(() => {
        if (phase === 'auth') fail('auth');
      }, options.authTimeoutMs ?? AUTH_TIMEOUT_MS),
      setTimeout(
        () => finish(1000, 'session timeout'),
        options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS,
      ),
    );
    socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: PICTURE_DEPTH_PROTOCOL }));

    socket.on('message', async (data, isBinary) => {
      if (finished) return;
      if (phase === 'auth') {
        const text = rawBuffer(data);
        if (isBinary || text.length > MAX_TEXT_BYTES) {
          fail('auth');
          return;
        }
        let message: { type?: unknown; size?: unknown; sha256?: unknown; mac?: unknown };
        try {
          message = JSON.parse(text.toString('utf8'));
        } catch {
          fail('auth');
          return;
        }
        if (
          message?.type !== 'auth' ||
          typeof message.mac !== 'string' ||
          typeof message.sha256 !== 'string' ||
          !/^[A-Za-z0-9+/]{43}=$/.test(message.sha256) ||
          typeof message.size !== 'number' ||
          !Number.isInteger(message.size) ||
          message.size <= 0 ||
          limiter.blocked(ip)
        ) {
          fail('auth');
          return;
        }
        const provided = Buffer.from(message.mac, 'base64');
        const wanted = pictureDepthMac(secret.key, nonce, message.size, message.sha256);
        if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
          fail('auth');
          return;
        }
        attempt();
        if (requests.blocked(ip)) {
          fail('rate_limited');
          return;
        }
        requests.fail(ip);
        if (message.size > maxBytes) {
          fail('too_large');
          return;
        }
        expected = { size: message.size, sha256: message.sha256 };
        phase = 'upload';
        socket.send(JSON.stringify({ type: 'ready' }));
        return;
      }
      if (phase !== 'upload' || !isBinary || !expected) {
        fail('protocol');
        return;
      }
      phase = 'busy';
      const bytes = rawBuffer(data);
      if (
        bytes.length !== expected.size ||
        createHash('sha256').update(bytes).digest('base64') !== expected.sha256
      ) {
        fail('protocol');
        return;
      }
      if (!isWebp(bytes)) {
        fail('not_image');
        return;
      }
      if (pending >= MAX_PENDING) {
        fail('busy');
        return;
      }
      const started = Date.now();
      let depth: Awaited<ReturnType<DepthEstimator['estimate']>>;
      pending += 1;
      try {
        depth = await estimator.estimate(bytes, abort.signal);
      } catch {
        if (!finished) fail('failed');
        return;
      } finally {
        pending -= 1;
      }
      if (finished) return;
      emit({ kind: 'depth', bytes: bytes.length, ms: Date.now() - started });
      socket.send(
        JSON.stringify({
          type: 'depth',
          width: depth.width,
          height: depth.height,
          size: depth.png.length,
        }),
      );
      socket.send(depth.png, { binary: true }, () => finish(1000, 'complete'));
    });
  };

  return {
    handleUpgrade,
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
    },
  };
};
