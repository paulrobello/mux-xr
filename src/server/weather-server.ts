import {
  createWeatherProvider as createProvider,
  localWeekday,
  nwsUrl,
  parseDays,
  parseNow,
  parseWindMph,
  WEATHER_ZIP_FORMAT,
  type WeatherFetch,
  type WeatherProvider,
  type WeatherProviderOptions,
  type WeatherStatus,
} from '@par/xr-workspace/weather';

export type {
  WeatherProvider,
  WeatherProviderOptions,
} from '@par/xr-workspace/weather';

import {
  type ClipboardSecret,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import { createPairedRoute, type PairedRoute, pairedHmac } from './paired-route';

export const WEATHER_PATH = '/weather';
export const WEATHER_PROTOCOL = 'mux-xr-weather-v1';
const MAX_MESSAGE_BYTES = 2 * 1024;
const MAX_CONNECTIONS = 8;
const MAX_PRE_AUTH_PER_CLIENT = 2;
const AUTH_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 30_000;
const REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 60_000;
const CONTROL_CHARS = /[\p{Cc}]/u;

export const ZIP_FORMAT = WEATHER_ZIP_FORMAT;
export type WeatherErrorCode = 'disabled' | 'auth' | 'rate_limited' | 'protocol';

export const weatherMac = (key: Buffer, nonce: string, zip: string): Buffer =>
  pairedHmac(key, WEATHER_PROTOCOL, nonce, zip);

export { localWeekday, nwsUrl, parseDays, parseNow, parseWindMph, type WeatherFetch };

export function createWeatherProvider(options: WeatherProviderOptions = {}): WeatherProvider {
  return createProvider({ ...options, userAgent: 'mux-xr-weather' });
}

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

export type WeatherRoute = PairedRoute;

export const createWeatherRoute = (options: WeatherRouteOptions): WeatherRoute => {
  const provider = options.provider ?? createWeatherProvider({ now: options.now });
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createFailureLimiter(options.now, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  return createPairedRoute({
    protocol: WEATHER_PROTOCOL,
    allowedOrigins: options.allowedOrigins,
    loadSecret: options.loadSecret,
    limiter,
    requestLimiter: { blocked: requests.blocked, charge: requests.fail },
    maxPayloadBytes: MAX_MESSAGE_BYTES,
    maxConnections: options.maxConnections ?? MAX_CONNECTIONS,
    perClient: { cap: MAX_PRE_AUTH_PER_CLIENT, gate: 'rate', release: 'auth' },
    reportGates: false,
    reportFailures: 'none',
    emit: () => undefined,
    authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    validateAuth: (message) =>
      typeof message.zip === 'string' &&
      message.zip.length <= 16 &&
      !CONTROL_CHARS.test(message.zip),
    macMaterial: (message) => String(message.zip),
    onAuthenticated: (connection, message) => {
      void (async () => {
        const zip = String(message.zip);
        const status: WeatherStatus = ZIP_FORMAT.test(zip)
          ? await provider.report(zip).catch((): WeatherStatus => ({ state: 'unavailable' }))
          : { state: 'unknown-zip' };
        if (connection.finished()) return;
        connection.sendJson({ type: 'weather', status });
        connection.finish(1000, 'complete');
      })();
    },
  });
};
