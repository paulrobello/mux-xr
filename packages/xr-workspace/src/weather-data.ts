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
