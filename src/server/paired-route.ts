/**
 * The shared paired-route handshake behind every host-service WebSocket: one WebSocketServer,
 * nonce, auth timer, HMAC and constant-time MAC comparison per route. Failure classification is
 * unified: a binary or out-of-phase frame fails as `protocol`, a JSON parse failure parses as
 * `{}` and fails `auth`, and the auth and session timeouts are options on every route.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import type { ClipboardSecret, FailureLimiter } from './clipboard-server';

export const PAIRED_AUTH_TIMEOUT_MS = 5_000;

/** Rate-limit key: IPv4 (including IPv4-mapped IPv6) as is, other IPv6 grouped by its /64. */
export const clientKey = (address: string | undefined): string => {
  if (!address) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  const groups = expandIPv6(address.split('%')[0].toLowerCase());
  if (!groups) return address;
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`;
};

const expandIPv6 = (address: string): string[] | null => {
  const [head, tail, extra] = address.split('::');
  if (extra !== undefined) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return null;
  return [...left, ...Array(tail === undefined ? 0 : missing).fill('0'), ...right];
};

/** Constant-time buffer equality; false on any length mismatch. The only timingSafeEqual site. */
export const constantTimeEqual = (provided: Buffer, expected: Buffer): boolean =>
  provided.length === expected.length && timingSafeEqual(provided, expected);

/** The shared MAC: HMAC-SHA256 over `protocol\nnonce\nrequest` keyed by the pairing secret. */
export const pairedHmac = (key: Buffer, protocol: string, nonce: string, request: string): Buffer =>
  createHmac('sha256', key).update(`${protocol}\n${nonce}\n${request}`).digest();

const digest = (value: Buffer): Buffer => createHash('sha256').update(value).digest();

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export const bearerMatches = (header: string | undefined, key: Buffer): boolean => {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  if (!match) return false;
  return constantTimeEqual(digest(Buffer.from(match[1].trim(), 'utf8')), digest(key));
};

/** A raw text frame: ws delivers Buffers, byte arrays or ArrayBuffers. */
export const pairedRawText = (data: RawData): string =>
  (Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)])
  ).toString('utf8');

export type PairedGateCode = 'origin' | 'rate_limited' | 'busy';

/**
 * The per-client connection slot. `gate` decides which refusal it produces: `rate` answers 429
 * (weather, repo-status and the picture routes) and `busy` answers 503 (host-stats, feed and
 * toasts). `release` decides its lifetime: `auth` frees the slot once authentication resolves,
 * `close` holds it until the socket closes.
 */
export type PairedPerClientSlot = {
  cap: number;
  gate: 'rate' | 'busy';
  release: 'auth' | 'close';
};

/** Authenticated-request limiter: checked in the 429 gate and again after a valid MAC. */
export type PairedRequestLimiter = {
  blocked(key: string): boolean;
  /** Charges one accepted request; `record` on the RequestLimiter routes, `fail` on the rest. */
  charge(key: string): void;
};

export type PairedConnection = {
  socket: WebSocket;
  ip: string;
  /** True once the connection is closing or closed. */
  finished(): boolean;
  /** Sends `{type:'error', code}` and closes with 1008 unless `closeCode` says otherwise. */
  fail(code: string, closeCode?: number): void;
  /** Closes with an explicit code and reason. */
  finish(closeCode: number, reason: string): void;
  sendJson(value: unknown): void;
  /** Aborted when the socket closes, so in-flight work can stop. */
  signal: AbortSignal;
  /** Registers a timer the route owns; cleared when the connection finishes or closes. */
  addTimer(handle: ReturnType<typeof setTimeout>): void;
};

export type PairedMessageHandler = (data: RawData, isBinary: boolean) => void;

export type PairedAuthMessage = { type?: unknown; mac?: unknown } & Record<string, unknown>;

export type PairedRouteOptions = {
  protocol: string;
  allowedOrigins: string[];
  loadSecret: () => ClipboardSecret;
  /** Auth-failure limiter; routes pass their own default so several routes can share one budget. */
  limiter: FailureLimiter;
  requestLimiter?: PairedRequestLimiter;
  maxPayloadBytes: number;
  maxConnections: number;
  perClient?: PairedPerClientSlot;
  /** Reports the upgrade-gate refusals (origin, rate_limited, busy) to the route's sink. */
  reportGates: boolean;
  /** Which handshake and session failures reach the route's sink. */
  reportFailures: 'all' | 'except-protocol' | 'none';
  emit: (event: { kind: 'refused'; code: string }) => void;
  authTimeoutMs?: number;
  /** Absent on subscription routes, which keep the session open with a ping loop instead. */
  sessionTimeoutMs?: number;
  /** Extra validation of the auth message fields; false fails the frame as `auth`. */
  validateAuth?: (message: PairedAuthMessage) => boolean;
  /** Text-size cap on the auth frame, for routes whose payload needs a larger maxPayload. */
  authMaxTextBytes?: number;
  /** Human-readable detail on `{type:'error'}`; omitted when it returns undefined. */
  errorMessage?: (code: string) => string | undefined;
  /** The signed request text: the MAC covers `protocol\nnonce\nmaterial`. */
  macMaterial: (message: PairedAuthMessage) => string;
  /**
   * Runs after a valid MAC. Return a handler to keep receiving frames on a live session, or
   * nothing for a one-shot route, where a later frame fails as `protocol`.
   */
  onAuthenticated: (
    connection: PairedConnection,
    message: PairedAuthMessage,
  ) => PairedMessageHandler | undefined;
  /** Extra cleanup when the socket closes, such as removing a subscriber. */
  onConnectionClose?: (socket: WebSocket) => void;
};

export type PairedRoute = {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
};

export const createPairedRoute = (options: PairedRouteOptions): PairedRoute => {
  const authTimeoutMs = options.authTimeoutMs ?? PAIRED_AUTH_TIMEOUT_MS;
  const sockets = new Set<WebSocket>();
  const perClient = new Map<string, number>();
  let upgrading = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: options.maxPayloadBytes });
  const emit = (event: { kind: 'refused'; code: string }): void => {
    try {
      options.emit(event);
    } catch {
      /* Observability must not interrupt the route. */
    }
  };
  const reportFailure = (code: string): void => {
    if (
      options.reportFailures === 'all' ||
      (options.reportFailures === 'except-protocol' && code !== 'protocol')
    )
      emit({ kind: 'refused', code });
  };
  const refuseHttp = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const holdPerClient = (ip: string): (() => void) => {
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
      if (options.reportGates) emit({ kind: 'refused', code: 'origin' });
      refuseHttp(socket, '403 Forbidden');
      return;
    }
    const ip = clientKey(request.socket.remoteAddress);
    const overRate =
      options.limiter.saturated(ip) ||
      (options.requestLimiter?.blocked(ip) ?? false) ||
      (options.perClient?.gate === 'rate' && (perClient.get(ip) ?? 0) >= options.perClient.cap);
    if (overRate) {
      if (options.reportGates) emit({ kind: 'refused', code: 'rate_limited' });
      refuseHttp(socket, '429 Too Many Requests');
      return;
    }
    const overBusy =
      sockets.size + upgrading >= options.maxConnections ||
      (options.perClient?.gate === 'busy' && (perClient.get(ip) ?? 0) >= options.perClient.cap);
    if (overBusy) {
      if (options.reportGates) emit({ kind: 'refused', code: 'busy' });
      refuseHttp(socket, '503 Service Unavailable');
      return;
    }
    const attempt = options.limiter.begin(ip);
    const releaseClient = options.perClient ? holdPerClient(ip) : undefined;
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
      releaseClient?.();
      attempt();
    });
    wss.handleUpgrade(request, socket, head, (client) => {
      release();
      if (options.perClient?.release === 'close') client.once('close', () => releaseClient?.());
      serve(client, ip, attempt, releaseClient);
    });
  };

  const serve = (
    socket: WebSocket,
    ip: string,
    attempt: () => void,
    releaseClient: (() => void) | undefined,
  ): void => {
    sockets.add(socket);
    let finished = false;
    let authed = false;
    const abort = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (closeCode: number, reason: string): void => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      socket.close(closeCode, reason);
    };
    const fail = (code: string, closeCode = 1008): void => {
      if (code === 'auth') options.limiter.fail(ip);
      reportFailure(code);
      attempt();
      if (options.perClient?.release === 'auth') releaseClient?.();
      const detail = options.errorMessage?.(code);
      if (socket.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify(
            detail === undefined
              ? { type: 'error', code }
              : { type: 'error', code, message: detail },
          ),
        );
      finish(closeCode, code);
    };
    socket.on('close', () => {
      abort.abort();
      attempt();
      releaseClient?.();
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      sockets.delete(socket);
      options.onConnectionClose?.(socket);
    });
    socket.on('error', () => undefined);

    const secret = options.loadSecret();
    if (!secret.enabled) {
      fail('disabled');
      return;
    }
    const nonce = randomBytes(32).toString('base64');
    let session: PairedMessageHandler | null = null;
    timers.push(
      setTimeout(() => {
        if (!authed) fail('auth');
      }, authTimeoutMs),
    );
    if (options.sessionTimeoutMs !== undefined)
      timers.push(setTimeout(() => finish(1000, 'session timeout'), options.sessionTimeoutMs));
    socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: options.protocol }));

    const connection: PairedConnection = {
      socket,
      ip,
      finished: () => finished,
      fail,
      finish,
      sendJson: (value) => socket.send(JSON.stringify(value)),
      signal: abort.signal,
      addTimer: (handle) => timers.push(handle),
    };

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (finished) return;
      if (session) {
        session(data, isBinary);
        return;
      }
      if (authed) {
        // A one-shot route: a frame after the handshake is out of phase.
        fail('protocol');
        return;
      }
      if (isBinary) {
        fail('protocol');
        return;
      }
      const text = pairedRawText(data);
      if (options.authMaxTextBytes !== undefined && text.length > options.authMaxTextBytes) {
        fail('auth');
        return;
      }
      let message: PairedAuthMessage;
      try {
        message = JSON.parse(text);
      } catch {
        message = {};
      }
      if (
        message?.type !== 'auth' ||
        typeof message.mac !== 'string' ||
        (options.validateAuth && !options.validateAuth(message)) ||
        options.limiter.blocked(ip)
      ) {
        fail('auth');
        return;
      }
      const provided = Buffer.from(message.mac, 'base64');
      const expected = pairedHmac(
        secret.key,
        options.protocol,
        nonce,
        options.macMaterial(message),
      );
      if (!constantTimeEqual(provided, expected)) {
        fail('auth');
        return;
      }
      authed = true;
      attempt();
      if (options.perClient?.release === 'auth') releaseClient?.();
      if (options.requestLimiter?.blocked(ip)) {
        fail('rate_limited');
        return;
      }
      options.requestLimiter?.charge(ip);
      session = options.onAuthenticated(connection, message) ?? null;
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
