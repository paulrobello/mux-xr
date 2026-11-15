import { createHash } from 'node:crypto';
import type { RawData } from 'ws';
import {
  type ClipboardSecret,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import type { DepthEstimator } from './depth-estimator';
import { createPairedRoute, type PairedRoute, pairedHmac } from './paired-route';

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
  pairedHmac(key, PICTURE_DEPTH_PROTOCOL, nonce, `${size}\n${sha256}`);

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

export type PictureDepthRoute = PairedRoute;

const rawBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);

export const createPictureDepthRoute = (options: PictureDepthRouteOptions): PictureDepthRoute => {
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createFailureLimiter(options.now, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  const maxBytes = options.maxBytes ?? PICTURE_DEPTH_MAX_BYTES;
  const estimator = options.estimator;
  let pending = 0;
  const emitEvent = (event: PictureDepthEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      /* Logging must not break a request. */
    }
  };
  return createPairedRoute({
    protocol: PICTURE_DEPTH_PROTOCOL,
    allowedOrigins: options.allowedOrigins,
    limiter,
    loadSecret: () => {
      const secret = options.loadSecret();
      return secret.enabled && options.estimator
        ? secret
        : { enabled: false, reason: 'depth estimation unavailable' };
    },
    requestLimiter: { blocked: requests.blocked, charge: requests.fail },
    maxPayloadBytes: Math.max(maxBytes, MAX_TEXT_BYTES),
    maxConnections: MAX_CONNECTIONS,
    perClient: { cap: MAX_PER_CLIENT, gate: 'rate', release: 'close' },
    reportGates: false,
    reportFailures: 'all',
    emit: (event) => emitEvent({ kind: 'refused', code: event.code as PictureDepthErrorCode }),
    authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    sessionTimeoutMs: options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS,
    authMaxTextBytes: MAX_TEXT_BYTES,
    validateAuth: (message) =>
      typeof message.sha256 === 'string' &&
      /^[A-Za-z0-9+/]{43}=$/.test(message.sha256) &&
      typeof message.size === 'number' &&
      Number.isInteger(message.size) &&
      message.size > 0,
    macMaterial: (message) => `${message.size}\n${message.sha256}`,
    onAuthenticated: (connection, message) => {
      const size = message.size as number;
      if (size > maxBytes) {
        connection.fail('too_large');
        return;
      }
      const expected = { size, sha256: String(message.sha256) };
      connection.sendJson({ type: 'ready' });
      let phase: 'upload' | 'busy' = 'upload';
      return (data, isBinary) => {
        if (connection.finished()) return;
        if (phase !== 'upload' || !isBinary) {
          connection.fail('protocol');
          return;
        }
        phase = 'busy';
        const bytes = rawBuffer(data);
        if (
          bytes.length !== expected.size ||
          createHash('sha256').update(bytes).digest('base64') !== expected.sha256
        ) {
          connection.fail('protocol');
          return;
        }
        if (!isWebp(bytes)) {
          connection.fail('not_image');
          return;
        }
        if (pending >= MAX_PENDING) {
          connection.fail('busy');
          return;
        }
        const started = Date.now();
        void (async () => {
          let depth: Awaited<ReturnType<DepthEstimator['estimate']>>;
          if (!estimator) return;
          pending += 1;
          try {
            depth = await estimator.estimate(bytes, connection.signal);
          } catch {
            if (!connection.finished()) connection.fail('failed');
            return;
          } finally {
            pending -= 1;
          }
          if (connection.finished()) return;
          emitEvent({ kind: 'depth', bytes: bytes.length, ms: Date.now() - started });
          connection.sendJson({
            type: 'depth',
            width: depth.width,
            height: depth.height,
            size: depth.png.length,
          });
          connection.socket.send(depth.png, { binary: true }, () =>
            connection.finish(1000, 'complete'),
          );
        })();
      };
    },
  });
};
