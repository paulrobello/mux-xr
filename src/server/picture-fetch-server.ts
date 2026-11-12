import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { type NetworkInterfaceInfo, networkInterfaces as osNetworkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import {
  type ClipboardSecret,
  clientKey,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';

export const PICTURE_FETCH_PATH = '/picture-fetch';
export const PICTURE_FETCH_PROTOCOL = 'mux-xr-picture-fetch-v1';
export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
export const PICTURE_MAX_REDIRECTS = 3;
export const PICTURE_TOTAL_TIMEOUT_MS = 10_000;
export const PICTURE_MAX_URL_CHARS = 2048;
const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_CONNECTIONS = 8;
const MAX_PER_CLIENT = 2;
const AUTH_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 15_000;
const REQUEST_LIMIT = 20;
const REQUEST_WINDOW_MS = 60_000;

export type PictureFetchErrorCode =
  | 'disabled'
  | 'auth'
  | 'rate_limited'
  | 'protocol'
  | 'bad_url'
  | 'blocked'
  | 'too_large'
  | 'not_image'
  | 'timeout'
  | 'failed';

export type PictureContentType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const CONTROL_CHARS = /\p{Cc}/u;

const parseIPv4 = (text: string): number[] | null => {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

/** Eight 16-bit groups of an IPv6 text (zone ids stripped, a dotted IPv4 tail allowed), or null. */
const parseIPv6 = (input: string): number[] | null => {
  let text = input.split('%')[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v4 = parseIPv4(dotted[1]);
    if (!v4) return null;
    text = `${text.slice(0, -dotted[1].length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const side = (value: string): number[] | null => {
    if (value === '') return [];
    const groups = value
      .split(':')
      .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
    return groups.every((group) => !Number.isNaN(group)) ? groups : null;
  };
  const head = side(halves[0]);
  const tail = halves.length === 2 ? side(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...Array<number>(fill).fill(0), ...tail];
};

const blockedIPv4 = ([a, b, c]: number[]): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  a >= 224 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 0 && (c === 0 || c === 2)) ||
  (a === 192 && b === 88 && c === 99) ||
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  (a === 198 && b === 51 && c === 100) ||
  (a === 203 && b === 0 && c === 113);

const groupsToV4 = (high: number, low: number): number[] => [
  high >> 8,
  high & 0xff,
  low >> 8,
  low & 0xff,
];

/**
 * True for any address a public image host must never resolve to: loopback, private, link-local,
 * CGNAT, unspecified, multicast, broadcast and reserved ranges, IPv6 ULA and link-local, and every
 * IPv6 form that embeds one of the IPv4 ranges (mapped, translated, compatible, NAT64, 6to4).
 * Unparseable text counts as blocked. Fixed ranges only: the host's own networks are checked by
 * `isOnOwnNetwork`.
 */
export const isBlockedAddress = (address: string): boolean => {
  const v4 = parseIPv4(address);
  if (v4) return blockedIPv4(v4);
  const g = parseIPv6(address);
  if (!g) return true;
  if (g.slice(0, 5).every((group) => group === 0)) {
    // ::, ::1, ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible) all fall in the first 96 bits.
    if (g[5] === 0xffff) return blockedIPv4(groupsToV4(g[6], g[7]));
    if (g[5] === 0) return true;
  }
  // ::ffff:0:a.b.c.d, the IPv4-translated range ::ffff:0:0/96.
  if (g.slice(0, 4).every((group) => group === 0) && g[4] === 0xffff && g[5] === 0) return true;
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((group) => group === 0))
    return blockedIPv4(groupsToV4(g[6], g[7]));
  if (g[0] === 0x2002) return blockedIPv4(groupsToV4(g[1], g[2]));
  return (
    (g[0] & 0xfe00) === 0xfc00 ||
    (g[0] & 0xffc0) === 0xfe80 ||
    (g[0] & 0xffc0) === 0xfec0 ||
    (g[0] & 0xff00) === 0xff00 ||
    (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8 || (g[1] & 0xfff0) === 0x20)) ||
    (g[0] === 0x3fff && (g[1] & 0xf000) === 0) ||
    (g[0] === 0x64 && g[1] === 0xff9b) ||
    (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0)
  );
};

export type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

const toBits = (address: string): { family: 4 | 6; value: bigint } | null => {
  const v4 = parseIPv4(address);
  if (v4) return { family: 4, value: v4.reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n) };
  const g = parseIPv6(address);
  return g
    ? { family: 6, value: g.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n) }
    : null;
};

/** The same address as an IPv4 value when it is an IPv4-mapped IPv6 address. */
const mappedV4 = (address: string): string | null => {
  const g = parseIPv6(address);
  return g?.slice(0, 5).every((group) => group === 0) && g[5] === 0xffff
    ? groupsToV4(g[6], g[7]).join('.')
    : null;
};

/**
 * True when `address` is one of this host's own addresses or lies inside any on-link prefix
 * (address and netmask, IPv4 and IPv6) of any interface. The caller passes a fresh interface
 * list per hop because temporary IPv6 addresses rotate.
 */
export const isOnOwnNetwork = (address: string, interfaces: InterfaceMap): boolean => {
  const candidates = [address, mappedV4(address)].flatMap((entry) => {
    const bits = entry === null ? null : toBits(entry);
    return bits ? [bits] : [];
  });
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const own = toBits(entry.address);
      if (!own) continue;
      const mask = toBits(entry.netmask);
      const width = own.family === 4 ? 32n : 128n;
      const full = (1n << width) - 1n;
      const bitmask = mask && mask.family === own.family ? mask.value : full;
      for (const candidate of candidates)
        if (
          candidate.family === own.family &&
          (candidate.value & bitmask) === (own.value & bitmask)
        )
          return true;
    }
  }
  return false;
};

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type PictureResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type PictureHop = {
  status: number;
  location?: string;
  contentType?: string;
  contentLength?: number;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
};

/** One GET to a pinned address. Never follows redirects, never sends cookies or credentials. */
export type PictureTransport = (target: {
  url: URL;
  address: ResolvedAddress;
  signal: AbortSignal;
}) => Promise<PictureHop>;

export const defaultResolver: PictureResolver = async (hostname) => {
  const literal = isIP(hostname);
  if (literal) return [{ address: hostname, family: literal as 4 | 6 }];
  const found = await dns.lookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
};

const bareHost = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '');

/**
 * Connects to the already validated address through a fixed `lookup`, so DNS is never consulted
 * again, while the Host header and TLS server name stay the original hostname.
 */
export const defaultTransport: PictureTransport = ({ url, address, signal }) =>
  new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(
      {
        protocol: url.protocol,
        hostname: bareHost(url),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        signal,
        headers: {
          accept: 'image/png,image/jpeg,image/gif,image/webp',
          'accept-encoding': 'identity',
          'user-agent': 'mux-xr-picture-proxy',
        },
        lookup: (
          _hostname: string,
          options: { all?: boolean },
          callback: (...args: never[]) => void,
        ) => {
          const done = callback as unknown as (...args: unknown[]) => void;
          if (options?.all) done(null, [{ address: address.address, family: address.family }]);
          else done(null, address.address, address.family);
        },
      },
      (response: IncomingMessage) => {
        const header = (name: string): string | undefined => {
          const value = response.headers[name];
          return Array.isArray(value) ? value[0] : value;
        };
        const length = Number(header('content-length'));
        resolve({
          status: response.statusCode ?? 0,
          location: header('location'),
          contentType: header('content-type'),
          contentLength:
            header('content-length') !== undefined && Number.isFinite(length) ? length : undefined,
          body: response,
          destroy: () => response.destroy(),
        });
      },
    );
    req.once('error', reject);
    req.end();
  });

/** The type the leading bytes declare, or null when they match no allowed format. */
export const sniffImageType = (bytes: Uint8Array): PictureContentType | null => {
  const at = (index: number): number => bytes[index] ?? -1;
  const ascii = (offset: number, text: string): boolean =>
    [...text].every((char, index) => at(offset + index) === char.charCodeAt(0));
  if (
    at(0) === 0x89 &&
    ascii(1, 'PNG') &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  )
    return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
};

const ALLOWED_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type PictureFetchResult =
  | { ok: true; bytes: Buffer; contentType: PictureContentType }
  | { ok: false; code: PictureFetchErrorCode };

export interface PictureFetchDeps {
  resolve?: PictureResolver;
  transport?: PictureTransport;
  timeoutMs?: number;
  maxBytes?: number;
  /** The host's interfaces, read fresh on every hop. */
  networkInterfaces?: () => InterfaceMap;
  /** Aborts the fetch, for example when the client socket closes. */
  signal?: AbortSignal;
}

class Refusal extends Error {
  constructor(readonly code: PictureFetchErrorCode) {
    super(code);
  }
}

const checkUrl = (url: URL): void => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Refusal('bad_url');
  if (url.username !== '' || url.password !== '') throw new Refusal('bad_url');
  if (url.hostname === '') throw new Refusal('bad_url');
  // The URL parser drops a port equal to the scheme default, so any remaining port is non-default.
  if (url.port !== '') throw new Refusal('blocked');
};

/** Resolves once, refuses if any answer is not public or on this host's networks, and returns the address to pin. */
const pinTarget = async (
  url: URL,
  resolve: PictureResolver,
  interfaces: () => InterfaceMap,
): Promise<ResolvedAddress> => {
  let answers: ResolvedAddress[];
  try {
    answers = await resolve(bareHost(url));
  } catch {
    throw new Refusal('failed');
  }
  if (answers.length === 0) throw new Refusal('failed');
  const own = interfaces();
  if (
    answers.some(
      (answer) => isBlockedAddress(answer.address) || isOnOwnNetwork(answer.address, own),
    )
  )
    throw new Refusal('blocked');
  return answers[0];
};

/**
 * Fetches one image for a client. Every hop (the first URL and each of at most three redirects) is
 * validated and connected to by pinned address, the whole exchange shares one deadline, and the
 * body is cut off the moment it passes the byte cap.
 */
export const fetchPicture = async (
  rawUrl: string,
  deps: PictureFetchDeps = {},
): Promise<PictureFetchResult> => {
  const resolve = deps.resolve ?? defaultResolver;
  const transport = deps.transport ?? defaultTransport;
  const maxBytes = deps.maxBytes ?? PICTURE_MAX_BYTES;
  const controller = new AbortController();
  const deadline = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Refusal('timeout')), {
      once: true,
    });
  });
  deadline.catch(() => undefined);
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? PICTURE_TOTAL_TIMEOUT_MS);
  const chained = (): void => controller.abort();
  if (deps.signal?.aborted) controller.abort();
  deps.signal?.addEventListener('abort', chained, { once: true });
  let hop: PictureHop | undefined;
  try {
    if (rawUrl.length > PICTURE_MAX_URL_CHARS || CONTROL_CHARS.test(rawUrl))
      throw new Refusal('bad_url');
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Refusal('bad_url');
    }
    for (let redirects = 0; ; redirects += 1) {
      checkUrl(url);
      const address = await Promise.race([
        pinTarget(url, resolve, deps.networkInterfaces ?? osNetworkInterfaces),
        deadline,
      ]);
      hop = await Promise.race([
        transport({ url, address, signal: controller.signal }),
        deadline,
      ]).catch((error: unknown) => {
        throw error instanceof Refusal
          ? error
          : new Refusal(controller.signal.aborted ? 'timeout' : 'failed');
      });
      if (REDIRECTS.has(hop.status)) {
        hop.destroy();
        if (redirects >= PICTURE_MAX_REDIRECTS || !hop.location) throw new Refusal('failed');
        try {
          url = new URL(hop.location, url);
        } catch {
          throw new Refusal('bad_url');
        }
        continue;
      }
      break;
    }
    if (hop.status < 200 || hop.status > 299) throw new Refusal('failed');
    const declared = (hop.contentType ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.includes(declared)) throw new Refusal('not_image');
    if (hop.contentLength !== undefined && hop.contentLength > maxBytes)
      throw new Refusal('too_large');
    const chunks: Buffer[] = [];
    let total = 0;
    const iterator = hop.body[Symbol.asyncIterator]();
    for (;;) {
      const step = await Promise.race([iterator.next(), deadline]).catch((error: unknown) => {
        throw error instanceof Refusal
          ? error
          : new Refusal(controller.signal.aborted ? 'timeout' : 'failed');
      });
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) throw new Refusal('too_large');
      chunks.push(Buffer.from(step.value));
    }
    const bytes = Buffer.concat(chunks);
    const sniffed = sniffImageType(bytes);
    if (sniffed === null || sniffed !== declared) throw new Refusal('not_image');
    return { ok: true, bytes, contentType: sniffed };
  } catch (error) {
    return { ok: false, code: error instanceof Refusal ? error.code : 'failed' };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', chained);
    hop?.destroy();
    controller.abort();
  }
};

export const pictureFetchMac = (key: Buffer, nonce: string, url: string): Buffer =>
  createHmac('sha256', key).update(`${PICTURE_FETCH_PROTOCOL}\n${nonce}\n${url}`).digest();

export type PictureFetchEvent =
  | { kind: 'transfer'; bytes: number }
  | { kind: 'refused'; code: PictureFetchErrorCode };

export interface PictureFetchRouteOptions extends PictureFetchDeps {
  allowedOrigins: string[];
  /** The clipboard pairing secret; this route adds no credential of its own. */
  loadSecret: () => ClipboardSecret;
  now?: () => number;
  authTimeoutMs?: number;
  maxConnections?: number;
  maxConnectionsPerClient?: number;
  /** Auth failures per client. */
  limiter?: FailureLimiter;
  /** Authenticated requests per client. */
  requestLimiter?: FailureLimiter;
  /** Codes and byte counts only; a URL never reaches this callback. */
  onEvent?: (event: PictureFetchEvent) => void;
}

export type PictureFetchRoute = {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
};

const rawText = (data: RawData): string =>
  (Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)])
  ).toString('utf8');

export const createPictureFetchRoute = (options: PictureFetchRouteOptions): PictureFetchRoute => {
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createFailureLimiter(options.now, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  const authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
  const maxPerClient = options.maxConnectionsPerClient ?? MAX_PER_CLIENT;
  const sockets = new Set<WebSocket>();
  const perClient = new Map<string, number>();
  let upgrading = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const emit = (event: PictureFetchEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      /* Logging must not break a transfer. */
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
    if (limiter.saturated(ip) || requests.blocked(ip) || (perClient.get(ip) ?? 0) >= maxPerClient) {
      refuseHttp(socket, '429 Too Many Requests');
      return;
    }
    if (sockets.size + upgrading >= maxConnections) {
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
    // A closed socket aborts its in-flight fetch, so the per-client cap bounds real outbound work.
    const abort = new AbortController();
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (code: number, reason: string): void => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      socket.close(code, reason);
    };
    const fail = (code: PictureFetchErrorCode): void => {
      if (code === 'auth') limiter.fail(ip);
      attempt();
      emit({ kind: 'refused', code });
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'error', code }));
      finish(1008, code);
    };
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
      setTimeout(() => finish(1000, 'session timeout'), SESSION_TIMEOUT_MS),
    );
    socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: PICTURE_FETCH_PROTOCOL }));

    socket.on('message', async (data, isBinary) => {
      if (finished) return;
      if (phase !== 'auth' || isBinary) {
        fail(phase === 'auth' ? 'auth' : 'protocol');
        return;
      }
      phase = 'busy';
      let message: { type?: unknown; url?: unknown; mac?: unknown };
      try {
        message = JSON.parse(rawText(data));
      } catch {
        fail('auth');
        return;
      }
      if (
        message?.type !== 'auth' ||
        typeof message.mac !== 'string' ||
        typeof message.url !== 'string' ||
        message.url.length > PICTURE_MAX_URL_CHARS ||
        CONTROL_CHARS.test(message.url) ||
        limiter.blocked(ip)
      ) {
        fail('auth');
        return;
      }
      const provided = Buffer.from(message.mac, 'base64');
      const expected = pictureFetchMac(secret.key, nonce, message.url);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        fail('auth');
        return;
      }
      attempt();
      if (requests.blocked(ip)) {
        fail('rate_limited');
        return;
      }
      requests.fail(ip);
      const result = await fetchPicture(message.url, { ...options, signal: abort.signal });
      if (finished) return;
      if (!result.ok) {
        fail(result.code);
        return;
      }
      emit({ kind: 'transfer', bytes: result.bytes.length });
      socket.send(
        JSON.stringify({
          type: 'image',
          contentType: result.contentType,
          size: result.bytes.length,
        }),
      );
      socket.send(result.bytes, { binary: true }, () => finish(1000, 'complete'));
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
