/** One authenticated weather query per connection to the dictation server's `/weather`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';
import { hostServiceUrl } from './host-service';

const PROTOCOL = 'mux-xr-weather-v1';
const DEFAULT_TIMEOUT_MS = 30_000;

import {
  WEATHER_ZIP_FORMAT,
  type WeatherFailure,
  type WeatherFetcher,
  type WeatherStatus,
} from '@par/xr-workspace/weather';

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
  return (zip) => {
    if (!WEATHER_ZIP_FORMAT.test(zip))
      return Promise.resolve({ ok: true, status: { state: 'unknown-zip' } });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return openPairedSocket<{ status: WeatherStatus }, WeatherFailure>({
      url: options.url(),
      secret,
      protocol: PROTOCOL,
      material: zip,
      authFields: { zip },
      timeoutMs,
      onTimeout: () => 'timeout',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onOpenError: () => 'unavailable',
      onServerError: (code) => SERVER_CODES[String(code)] ?? 'unavailable',
      onClose: () => 'unavailable',
      onMessage: (message) => {
        const frame = message as { type?: unknown; status?: unknown };
        if (frame.type !== 'weather') return { ok: false, code: 'unavailable' };
        const status = parseWeatherStatus(frame.status);
        return status ? { ok: true, value: { status } } : { ok: false, code: 'unavailable' };
      },
    }).then((outcome) => (outcome.ok ? { ok: true, status: outcome.value.status } : outcome));
  };
}

/** The production client: the host service port on the page's host, paired by the host clipboard secret. */
export function createDefaultWeatherFetcher(): WeatherFetcher {
  const secret = createHostClipboardSecretStore();
  return createWeatherClient({
    url: () => hostServiceUrl('/weather', window.location),
    secret: () => secret.get(),
  });
}
