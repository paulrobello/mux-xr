/** One-request-per-connection host load stats from the dictation server's `/host-stats`. */
import type { HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';

const PROTOCOL = 'mux-xr-host-stats-v1';
const DEFAULT_TIMEOUT_MS = 4_000;

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
  // A browser cannot read the 429 status, so once this server has answered before, a close before
  // its challenge is most likely a rate-limit refusal rather than a server that went away.
  let answeredBefore = false;
  return () => {
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return openPairedSocket<HostStatsSnapshot, HostStatsFailure>({
      url: options.url(),
      secret,
      protocol: PROTOCOL,
      material: 'stats',
      timeoutMs,
      onTimeout: () => 'timeout',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onChallenge: () => {
        answeredBefore = true;
      },
      onOpenError: () => 'unavailable',
      onServerError: (code) =>
        code === 'disabled'
          ? 'disabled'
          : code === 'auth'
            ? 'auth'
            : code === 'rate_limited'
              ? 'rate-limited'
              : 'unavailable',
      onClose: (info) => (!info.challenged && answeredBefore ? 'rate-limited' : 'unavailable'),
      onMessage: (message, _socket, challenged) => {
        const value = challenged ? parseHostStats(message) : null;
        return value ? { ok: true, value } : { ok: false, code: 'unavailable' };
      },
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
