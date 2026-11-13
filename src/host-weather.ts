/** One authenticated weather query per connection to the dictation server's `/weather`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';

const PROTOCOL = 'mux-xr-weather-v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;
export const WEATHER_ZIP_FORMAT = /^\d{5}$/;

export interface WeatherNow {
  tempF: number;
  summary: string;
  isDay: boolean;
  windMph: number | null;
  windDir: string | null;
  humidity: number | null;
  precip: number | null;
}

export interface WeatherDay {
  /** "Today", "Tonight" or a short weekday. */
  name: string;
  highF: number | null;
  lowF: number | null;
  summary: string;
  precip: number | null;
}

export interface WeatherReport {
  zip: string;
  place: string;
  /** Two-letter state. */
  region: string;
  now: WeatherNow;
  days: WeatherDay[];
  fetchedAt: string;
}

export type WeatherStatus =
  | { state: 'ok'; report: WeatherReport }
  | { state: 'unknown-zip' }
  | { state: 'unavailable' };

export type WeatherFailure =
  | 'no-secret'
  | 'disabled'
  | 'auth'
  | 'rate-limited'
  | 'unavailable'
  | 'timeout';

export type WeatherResult =
  | { ok: true; status: WeatherStatus }
  | { ok: false; code: WeatherFailure };

export type WeatherFetcher = (zip: string) => Promise<WeatherResult>;

/** A valid ZIP, or empty for anything else. */
export function validateWeatherZip(value: unknown): string {
  return typeof value === 'string' && WEATHER_ZIP_FORMAT.test(value) ? value : '';
}

export interface WeatherClientOptions {
  url: () => string;
  secret: () => string | null;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  timeoutMs?: number;
}

const SERVER_CODES: Record<string, WeatherFailure> = {
  disabled: 'disabled',
  auth: 'auth',
  rate_limited: 'rate-limited',
};

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const str = (value: unknown, max = 60): string =>
  typeof value === 'string' ? value.slice(0, max) : '';
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
const pct = (value: unknown): number | null => {
  const parsed = int(value);
  return parsed === null ? null : Math.max(0, Math.min(100, parsed));
};

/** Rebuilds the server's report field by field, so nothing unexpected reaches the scene. */
export function parseWeatherStatus(value: unknown): WeatherStatus | null {
  if (!value || typeof value !== 'object') return null;
  const status = value as Record<string, unknown>;
  if (status.state === 'unknown-zip' || status.state === 'unavailable')
    return { state: status.state };
  if (status.state !== 'ok') return null;
  const report = status.report as Record<string, unknown> | undefined;
  const now = report?.now as Record<string, unknown> | undefined;
  const tempF = int(now?.tempF);
  if (!report || !now || tempF === null || !Array.isArray(report.days)) return null;
  const days = report.days
    .filter((day): day is Record<string, unknown> => !!day && typeof day === 'object')
    .slice(0, 4)
    .map((day) => ({
      name: str(day.name, 12),
      highF: int(day.highF),
      lowF: int(day.lowF),
      summary: str(day.summary),
      precip: pct(day.precip),
    }));
  return {
    state: 'ok',
    report: {
      zip: str(report.zip, 5),
      place: str(report.place),
      region: str(report.region, 4),
      now: {
        tempF,
        summary: str(now.summary),
        isDay: now.isDay !== false,
        windMph: int(now.windMph),
        windDir: str(now.windDir, 4) || null,
        humidity: pct(now.humidity),
        precip: pct(now.precip),
      },
      days,
      fetchedAt: str(report.fetchedAt, 40),
    },
  };
}

export function createWeatherClient(options: WeatherClientOptions): WeatherFetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  return (zip) => {
    if (!WEATHER_ZIP_FORMAT.test(zip))
      return Promise.resolve({ ok: true, status: { state: 'unknown-zip' } });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return new Promise((resolve) => {
      let settled = false;
      let challenged = false;
      let socket: HostClipboardSocket | undefined;
      const finish = (result: WeatherResult): void => {
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
      const failure = (code: WeatherFailure): void => finish({ ok: false, code });
      const timer = setTimeout(() => failure('timeout'), timeoutMs);
      try {
        socket = factory(options.url());
      } catch {
        failure('unavailable');
        return;
      }
      const active = socket;
      active.onerror = () => undefined;
      active.onclose = () => failure('unavailable');
      active.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          failure('unavailable');
          return;
        }
        let message: { type?: unknown; code?: unknown; nonce?: unknown; status?: unknown };
        try {
          message = JSON.parse(event.data);
        } catch {
          failure('unavailable');
          return;
        }
        if (message.type === 'error') {
          failure(SERVER_CODES[String(message.code)] ?? 'unavailable');
        } else if (message.type === 'challenge') {
          if (
            challenged ||
            typeof message.nonce !== 'string' ||
            !NONCE_FORMAT.test(message.nonce)
          ) {
            failure('unavailable');
            return;
          }
          challenged = true;
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
                new TextEncoder().encode(`${PROTOCOL}\n${nonce}\n${zip}`),
              );
              if (!settled) active.send(JSON.stringify({ type: 'auth', zip, mac: base64(mac) }));
            } catch {
              failure('unavailable');
            }
          })();
        } else if (message.type === 'weather') {
          const status = parseWeatherStatus(message.status);
          if (status) finish({ ok: true, status });
          else failure('unavailable');
        } else failure('unavailable');
      };
    });
  };
}

/** The production client: port 4242 on the page's host, paired by the host clipboard secret. */
export function createDefaultWeatherFetcher(): WeatherFetcher {
  const secret = createHostClipboardSecretStore();
  return createWeatherClient({
    url: () => {
      const url = new URL('/weather', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.port = '4242';
      url.search = '';
      url.hash = '';
      return url.href;
    },
    secret: () => secret.get(),
  });
}
