import {
  WEATHER_ZIP_FORMAT,
  type WeatherDay,
  type WeatherFetcher,
  type WeatherNow,
  type WeatherReport,
  type WeatherStatus,
} from './weather-data';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 512 * 1024;
/** ZIP centroids and NWS grid points do not move. */
const LOCATION_CACHE_MS = 24 * 60 * 60_000;
/** NWS refreshes its gridded forecast about hourly; ten minutes keeps the widget current. */
const FORECAST_CACHE_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 32;
const MAX_DAYS = 4;
const MAX_TEXT_CHARS = 60;
const NWS_HOST = 'api.weather.gov';
const CONTROL_CHARS = /[\p{Cc}]/u;

export type WeatherFetch = (url: string, init: RequestInit) => Promise<Response>;

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
  userAgent?: string;
}

class NotFound extends Error {}

export const createWeatherProvider = (options: WeatherProviderOptions = {}): WeatherProvider => {
  const fetcher: WeatherFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const locations = new Map<string, Cached<Location>>();
  const reports = new Map<string, Cached<WeatherStatus>>();

  const getJson = async (url: string): Promise<unknown> => {
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/geo+json, application/json',
        ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
      },
      credentials: 'omit',
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

/** Requests the ZIP lookup and forecast directly, using the browser's normal User-Agent. */
export function createDirectWeatherFetcher(options: WeatherProviderOptions = {}): WeatherFetcher {
  const provider = createWeatherProvider(options);
  return async (zip) => ({
    ok: true,
    status: WEATHER_ZIP_FORMAT.test(zip) ? await provider.report(zip) : { state: 'unknown-zip' },
  });
}
