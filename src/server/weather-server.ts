import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import type { WeatherDay, WeatherNow, WeatherReport, WeatherStatus } from '../host-weather';
import {
  type ClipboardSecret,
  clientKey,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';

export const WEATHER_PATH = '/weather';
export const WEATHER_PROTOCOL = 'mux-xr-weather-v1';
const MAX_MESSAGE_BYTES = 2 * 1024;
const MAX_CONNECTIONS = 8;
const MAX_PRE_AUTH_PER_CLIENT = 2;
const AUTH_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 512 * 1024;
/** ZIP centroids and NWS grid points do not move. */
const LOCATION_CACHE_MS = 24 * 60 * 60_000;
/** NWS refreshes its gridded forecast about hourly; ten minutes keeps the widget current. */
const FORECAST_CACHE_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 32;
const REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 60_000;
const MAX_DAYS = 4;
const MAX_TEXT_CHARS = 60;
/** NWS refuses requests without a User-Agent; this one names the app and nothing about the user. */
const USER_AGENT = 'mux-xr-weather';
const NWS_HOST = 'api.weather.gov';

export const ZIP_FORMAT = /^\d{5}$/;
const CONTROL_CHARS = /\p{Cc}/u;

export type WeatherErrorCode = 'disabled' | 'auth' | 'rate_limited' | 'protocol';

export type WeatherFetch = (url: string, init: RequestInit) => Promise<Response>;

export const weatherMac = (key: Buffer, nonce: string, zip: string): Buffer =>
  createHmac('sha256', key).update(`${WEATHER_PROTOCOL}\n${nonce}\n${zip}`).digest();

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(CONTROL_CHARS, '').trim().slice(0, MAX_TEXT_CHARS) : '';

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

const percent = (value: unknown): number | null => {
  const raw = (value as { value?: unknown } | null)?.value;
  const parsed = num(raw);
  return parsed === null ? null : Math.max(0, Math.min(100, parsed));
};

/** `"7 to 20 mph"` reads as its upper bound, the gusty end a person would plan for. */
export const parseWindMph = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const numbers = value.match(/\d+/g);
  return numbers ? Math.max(...numbers.map(Number)) : null;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The weekday of an NWS start time in the forecast's own offset, not the Mac's. */
export const localWeekday = (startTime: unknown): string => {
  const match = typeof startTime === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(startTime) : null;
  if (!match) return '';
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return WEEKDAYS[day.getUTCDay()] ?? '';
};

type Period = Record<string, unknown>;

const periodsOf = (body: unknown): Period[] => {
  const periods = (body as { properties?: { periods?: unknown } } | null)?.properties?.periods;
  return Array.isArray(periods)
    ? periods.filter((period): period is Period => !!period && typeof period === 'object')
    : [];
};

export const parseNow = (hourly: unknown): WeatherNow | null => {
  const first = periodsOf(hourly)[0];
  const temp = num(first?.temperature);
  if (!first || temp === null) return null;
  return {
    tempF: first.temperatureUnit === 'C' ? Math.round((temp * 9) / 5 + 32) : temp,
    summary: text(first.shortForecast),
    isDay: first.isDaytime !== false,
    windMph: parseWindMph(first.windSpeed),
    windDir: text(first.windDirection) || null,
    humidity: percent(first.relativeHumidity),
    precip: percent(first.probabilityOfPrecipitation),
  };
};

/** Pairs each daytime period with the night after it; a leading night becomes "Tonight". */
export const parseDays = (forecast: unknown): WeatherDay[] => {
  const periods = periodsOf(forecast);
  const days: WeatherDay[] = [];
  for (let index = 0; index < periods.length && days.length < MAX_DAYS; index += 1) {
    const period = periods[index] as Period;
    const temp = num(period.temperature);
    const first = days.length === 0;
    if (period.isDaytime === false) {
      if (!first) continue;
      days.push({
        name: 'Tonight',
        highF: null,
        lowF: temp,
        summary: text(period.shortForecast),
        precip: percent(period.probabilityOfPrecipitation),
      });
      continue;
    }
    const night = periods[index + 1];
    const nightPrecip =
      night?.isDaytime === false ? percent(night.probabilityOfPrecipitation) : null;
    const dayPrecip = percent(period.probabilityOfPrecipitation);
    days.push({
      name: first ? 'Today' : localWeekday(period.startTime) || text(period.name),
      highF: temp,
      lowF: night?.isDaytime === false ? num(night.temperature) : null,
      summary: text(period.shortForecast),
      precip:
        dayPrecip === null && nightPrecip === null
          ? null
          : Math.max(dayPrecip ?? 0, nightPrecip ?? 0),
    });
  }
  return days;
};

/** Only NWS's own HTTPS endpoints are followed out of a points response. */
export const nwsUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === NWS_HOST && !url.username && !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
};

interface Location {
  place: string;
  state: string;
  forecast: string;
  hourly: string;
}

type Cached<T> = { at: number; value: Promise<T> };

export interface WeatherProvider {
  report(zip: string): Promise<WeatherStatus>;
}

export interface WeatherProviderOptions {
  fetch?: WeatherFetch;
  now?: () => number;
}

class NotFound extends Error {}

export const createWeatherProvider = (options: WeatherProviderOptions = {}): WeatherProvider => {
  const fetcher: WeatherFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const locations = new Map<string, Cached<Location>>();
  const reports = new Map<string, Cached<WeatherStatus>>();

  const getJson = async (url: string): Promise<unknown> => {
    const response = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json, application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) throw new NotFound();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) throw new Error('response too large');
    return JSON.parse(body);
  };

  const cached = <T>(
    cache: Map<string, Cached<T>>,
    key: string,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T> => {
    const at = now();
    const hit = cache.get(key);
    if (hit && at - hit.at < ttl) return hit.value;
    const value = load();
    cache.delete(key);
    cache.set(key, { at, value });
    // A failed lookup is retried on the next request rather than cached.
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
    return value;
  };

  const locate = (zip: string): Promise<Location> =>
    cached(locations, zip, LOCATION_CACHE_MS, async () => {
      const geo = (await getJson(`https://api.zippopotam.us/us/${zip}`)) as {
        places?: Array<Record<string, unknown>>;
      };
      const place = geo?.places?.[0];
      const lat = Number(place?.latitude);
      const lon = Number(place?.longitude);
      if (!place || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new NotFound();
      const points = (await getJson(
        `https://${NWS_HOST}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      )) as { properties?: Record<string, unknown> };
      const forecast = nwsUrl(points?.properties?.forecast);
      const hourly = nwsUrl(points?.properties?.forecastHourly);
      if (!forecast || !hourly) throw new NotFound();
      return {
        place: text(place['place name']),
        state: text(place['state abbreviation']),
        forecast,
        hourly,
      };
    });

  const report = (zip: string): Promise<WeatherStatus> =>
    cached(reports, zip, FORECAST_CACHE_MS, async (): Promise<WeatherStatus> => {
      let location: Location;
      try {
        location = await locate(zip);
      } catch (error) {
        return error instanceof NotFound ? { state: 'unknown-zip' } : { state: 'unavailable' };
      }
      try {
        const [forecast, hourly] = await Promise.all([
          getJson(location.forecast),
          getJson(location.hourly),
        ]);
        const current = parseNow(hourly);
        const days = parseDays(forecast);
        if (!current || !days.length) return { state: 'unavailable' };
        const result: WeatherReport = {
          zip,
          place: location.place,
          region: location.state,
          now: current,
          days,
          fetchedAt: new Date(now()).toISOString(),
        };
        return { state: 'ok', report: result };
      } catch {
        return { state: 'unavailable' };
      }
    }).then((status) => {
      // Unavailable answers are not worth ten minutes of staleness.
      if (status.state === 'unavailable') reports.delete(zip);
      return status;
    });

  return { report };
};

export interface WeatherRouteOptions {
  allowedOrigins: string[];
  /** The clipboard pairing secret; this route adds no credential of its own. */
  loadSecret: () => ClipboardSecret;
  provider?: WeatherProvider;
  now?: () => number;
  authTimeoutMs?: number;
  maxConnections?: number;
  /** Auth failures per client. */
  limiter?: FailureLimiter;
  /** Authenticated requests per client. */
  requestLimiter?: FailureLimiter;
}

export type WeatherRoute = {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): Promise<void>;
};

const rawText = (data: RawData): string =>
  (Buffer.isBuffer(data)
    ? data
    : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)])
  ).toString('utf8');

export const createWeatherRoute = (options: WeatherRouteOptions): WeatherRoute => {
  const provider = options.provider ?? createWeatherProvider({ now: options.now });
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createFailureLimiter(options.now, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  const authTimeoutMs = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
  const sockets = new Set<WebSocket>();
  const preAuth = new Map<string, number>();
  let upgrading = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const refuseHttp = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const holdPreAuth = (ip: string): (() => void) => {
    preAuth.set(ip, (preAuth.get(ip) ?? 0) + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const left = (preAuth.get(ip) ?? 1) - 1;
      if (left > 0) preAuth.set(ip, left);
      else preAuth.delete(ip);
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
      (preAuth.get(ip) ?? 0) >= MAX_PRE_AUTH_PER_CLIENT
    ) {
      refuseHttp(socket, '429 Too Many Requests');
      return;
    }
    if (sockets.size + upgrading >= maxConnections) {
      refuseHttp(socket, '503 Service Unavailable');
      return;
    }
    const attempt = limiter.begin(ip);
    const authed = holdPreAuth(ip);
    let reserved = true;
    const release = (): void => {
      if (!reserved) return;
      reserved = false;
      upgrading -= 1;
    };
    upgrading += 1;
    socket.once('close', () => {
      release();
      attempt();
      authed();
    });
    wss.handleUpgrade(request, socket, head, (client) => {
      release();
      serve(client, ip, attempt, authed);
    });
  };

  const serve = (socket: WebSocket, ip: string, attempt: () => void, authed: () => void): void => {
    sockets.add(socket);
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (code: number, reason: string): void => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      socket.close(code, reason);
    };
    const fail = (code: WeatherErrorCode): void => {
      if (code === 'auth') limiter.fail(ip);
      attempt();
      authed();
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'error', code }));
      finish(1008, code);
    };
    socket.on('close', () => {
      attempt();
      authed();
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
    socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: WEATHER_PROTOCOL }));

    socket.on('message', async (data, isBinary) => {
      if (finished) return;
      if (phase !== 'auth' || isBinary) {
        fail(phase === 'auth' ? 'auth' : 'protocol');
        return;
      }
      phase = 'busy';
      let message: { type?: unknown; zip?: unknown; mac?: unknown };
      try {
        message = JSON.parse(rawText(data));
      } catch {
        fail('auth');
        return;
      }
      if (
        message?.type !== 'auth' ||
        typeof message.mac !== 'string' ||
        typeof message.zip !== 'string' ||
        message.zip.length > 16 ||
        CONTROL_CHARS.test(message.zip) ||
        limiter.blocked(ip)
      ) {
        fail('auth');
        return;
      }
      const provided = Buffer.from(message.mac, 'base64');
      const expected = weatherMac(secret.key, nonce, message.zip);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        fail('auth');
        return;
      }
      attempt();
      authed();
      if (requests.blocked(ip)) {
        fail('rate_limited');
        return;
      }
      requests.fail(ip);
      const status: WeatherStatus = ZIP_FORMAT.test(message.zip)
        ? await provider.report(message.zip).catch((): WeatherStatus => ({ state: 'unavailable' }))
        : { state: 'unknown-zip' };
      if (finished) return;
      socket.send(JSON.stringify({ type: 'weather', status }));
      finish(1000, 'complete');
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
