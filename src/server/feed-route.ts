import {
  type ClipboardSecret,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import { createRequestLimiter, type RequestLimiter } from './host-stats-server';
import { createPairedRoute, type PairedRoute, pairedHmac } from './paired-route';

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
  pairedHmac(key, protocol, nonce, request);

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

export type FeedRoute = PairedRoute;

export const createFeedRoute = (options: FeedRouteOptions): FeedRoute => {
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createRequestLimiter(options.now, FEED_REQUEST_LIMIT, 60_000);
  const emitEvent = (code: FeedEvent['code']): void => {
    try {
      options.onEvent?.({ kind: 'refused', feed: options.name, code });
    } catch {
      /* Observability must not interrupt the route. */
    }
  };
  return createPairedRoute({
    protocol: options.protocol,
    allowedOrigins: options.allowedOrigins,
    loadSecret: options.loadSecret,
    limiter,
    requestLimiter: { blocked: requests.blocked, charge: requests.record },
    maxPayloadBytes: MAX_MESSAGE_BYTES,
    maxConnections: options.maxConnections ?? MAX_CONNECTIONS,
    perClient: {
      cap: options.maxConnectionsPerClient ?? MAX_CONNECTIONS_PER_CLIENT,
      gate: 'busy',
      release: 'close',
    },
    reportGates: true,
    reportFailures: 'except-protocol',
    emit: (event) => emitEvent(event.code as FeedEvent['code']),
    authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    sessionTimeoutMs: options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS,
    validateAuth: (message) =>
      typeof message.request === 'string' &&
      message.request.length <= MAX_FEED_REQUEST_CHARS &&
      !CONTROL_CHARS.test(message.request),
    macMaterial: (message) => String(message.request),
    onAuthenticated: (connection, message) => {
      void (async () => {
        let payload: unknown;
        try {
          payload = await options.load(String(message.request));
        } catch (error) {
          if (!connection.finished())
            connection.fail(error instanceof FeedError ? error.code : 'upstream');
          return;
        }
        if (connection.finished()) return;
        connection.sendJson({ type: 'feed', data: payload });
        connection.finish(1000, 'complete');
      })();
    },
  });
};
