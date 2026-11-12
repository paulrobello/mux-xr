/** One-request-per-connection host load stats from the dictation server's `/host-stats`. */
import type { HostClipboardSocket } from './host-clipboard';

const PROTOCOL = 'mux-xr-host-stats-v1';
const DEFAULT_TIMEOUT_MS = 4_000;
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;

export interface HostStatsSnapshot {
  load: [number, number, number];
  /** 0..100, or null when the host could not measure it. */
  cpu: number | null;
  cores: number;
}

export type HostStatsFailure =
  | 'no-secret'
  | 'disabled'
  | 'auth'
  | 'rate-limited'
  | 'unavailable'
  | 'timeout';

export type HostStatsResult =
  | { ok: true; value: HostStatsSnapshot }
  | { ok: false; code: HostStatsFailure };

export type HostStatsSource = () => Promise<HostStatsResult>;

export interface HostStatsClientOptions {
  url: () => string;
  secret: () => string | null;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  timeoutMs?: number;
}

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The stats payload, or null when any field is missing or out of range. */
export function parseHostStats(message: unknown): HostStatsSnapshot | null {
  const data = message as { type?: unknown; load?: unknown; cpu?: unknown; cores?: unknown };
  if (data?.type !== 'stats' || !Array.isArray(data.load) || data.load.length !== 3) return null;
  if (!data.load.every(finite)) return null;
  if (data.cpu !== null && !(finite(data.cpu) && data.cpu <= 100)) return null;
  if (!finite(data.cores) || !Number.isInteger(data.cores)) return null;
  return {
    load: [data.load[0], data.load[1], data.load[2]],
    cpu: data.cpu as number | null,
    cores: data.cores,
  };
}

export function createHostStatsClient(options: HostStatsClientOptions): HostStatsSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  // A browser cannot read the 429 status, so once this server has answered before, a close before
  // its challenge is most likely a rate-limit refusal rather than a server that went away.
  let answeredBefore = false;
  return () => {
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return new Promise((resolve) => {
      let settled = false;
      let challenged = false;
      let socket: HostClipboardSocket | undefined;
      const finish = (result: HostStatsResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket?.close(1000, 'done');
        } catch {
          /* Already closed. */
        }
        resolve(result);
      };
      const fail = (code: HostStatsFailure) => finish({ ok: false, code });
      const timer = setTimeout(() => fail('timeout'), timeoutMs);
      try {
        socket = factory(options.url());
      } catch {
        fail('unavailable');
        return;
      }
      const active = socket;
      active.onerror = () => undefined;
      active.onclose = () => fail(!challenged && answeredBefore ? 'rate-limited' : 'unavailable');
      active.onmessage = (event) => {
        let message: { type?: unknown; code?: unknown; nonce?: unknown };
        try {
          message = typeof event.data === 'string' ? JSON.parse(event.data) : {};
        } catch {
          message = {};
        }
        if (message.type === 'error') {
          fail(
            message.code === 'disabled'
              ? 'disabled'
              : message.code === 'auth'
                ? 'auth'
                : message.code === 'rate_limited'
                  ? 'rate-limited'
                  : 'unavailable',
          );
        } else if (message.type === 'challenge') {
          if (
            challenged ||
            typeof message.nonce !== 'string' ||
            !NONCE_FORMAT.test(message.nonce)
          ) {
            fail('unavailable');
            return;
          }
          challenged = true;
          answeredBefore = true;
          const nonce = message.nonce;
          void (async () => {
            try {
              const key = await crypto.importKey(
                'raw',
                new TextEncoder().encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign'],
              );
              const mac = await crypto.sign(
                'HMAC',
                key,
                new TextEncoder().encode(`${PROTOCOL}\n${nonce}\nstats`),
              );
              if (!settled) active.send(JSON.stringify({ type: 'auth', mac: base64(mac) }));
            } catch {
              fail('unavailable');
            }
          })();
        } else {
          const value = challenged ? parseHostStats(message) : null;
          if (value) finish({ ok: true, value });
          else fail('unavailable');
        }
      };
    });
  };
}

/** The dictation server's URL for `path`, as main.ts builds it for `/clipboard` and `/dictate`. */
export function dictationServiceUrl(
  path: string,
  location: { href: string; protocol: string },
): string {
  const url = new URL(path, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.port = '4242';
  url.search = '';
  url.hash = '';
  return url.href;
}
