import { createServer, type Server } from 'node:http';
import { createDirectWeatherFetcher } from '@par/xr-workspace/internal/weather-provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { HostClipboardSocket } from '../src/host-clipboard';
import { createWeatherClient, parseWeatherStatus, validateWeatherZip } from '../src/host-weather';
import { attachDictationServer } from '../src/server/dictation-server';
import {
  createWeatherProvider,
  localWeekday,
  nwsUrl,
  parseDays,
  parseNow,
  parseWindMph,
  type WeatherFetch,
  type WeatherProvider,
  weatherMac,
} from '../src/server/weather-server';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';

const period = (overrides: Record<string, unknown>) => ({
  name: 'Friday',
  startTime: '2026-11-13T06:00:00-08:00',
  isDaytime: true,
  temperature: 61,
  temperatureUnit: 'F',
  windSpeed: '7 to 20 mph',
  windDirection: 'S',
  shortForecast: 'Showers And Thunderstorms',
  probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 98 },
  ...overrides,
});

const FORECAST = {
  properties: {
    periods: [
      period({
        name: 'This Afternoon',
        startTime: '2026-11-12T13:00:00-08:00',
        temperature: 72,
        shortForecast: 'Mostly Sunny',
        probabilityOfPrecipitation: { value: 1 },
      }),
      period({
        name: 'Tonight',
        startTime: '2026-11-12T18:00:00-08:00',
        isDaytime: false,
        temperature: 53,
        probabilityOfPrecipitation: { value: 17 },
      }),
      period({}),
      period({ name: 'Friday Night', isDaytime: false, temperature: 47 }),
      period({
        name: 'Veterans Day',
        startTime: '2026-11-14T06:00:00-08:00',
        temperature: 64,
        shortForecast: 'Sunny',
        probabilityOfPrecipitation: { value: null },
      }),
    ],
  },
};
const HOURLY = {
  properties: {
    periods: [
      period({
        name: '',
        temperature: 71,
        windSpeed: '3 mph',
        windDirection: 'SSW',
        shortForecast: 'Partly Sunny',
        probabilityOfPrecipitation: { value: 1 },
        relativeHumidity: { value: 51 },
      }),
    ],
  },
};
const POINTS = {
  properties: {
    forecast: 'https://api.weather.gov/gridpoints/STO/41,68/forecast',
    forecastHourly: 'https://api.weather.gov/gridpoints/STO/41,68/forecast/hourly',
  },
};
const GEO = {
  'post code': '95814',
  places: [
    {
      'place name': 'Sacramento',
      longitude: '-121.4922',
      latitude: '38.5804',
      'state abbreviation': 'CA',
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch = (overrides: Record<string, () => Response> = {}) =>
  vi.fn<WeatherFetch>(async (url) => {
    for (const [prefix, respond] of Object.entries(overrides))
      if (url.startsWith(prefix)) return respond();
    if (url === 'https://api.zippopotam.us/us/95814') return json(GEO);
    if (url.startsWith('https://api.zippopotam.us/')) return json({}, 404);
    if (url === 'https://api.weather.gov/points/38.5804,-121.4922') return json(POINTS);
    if (url.endsWith('/forecast/hourly')) return json(HOURLY);
    if (url.endsWith('/forecast')) return json(FORECAST);
    return json({}, 500);
  });

describe('weather parsing', () => {
  it('reads wind ranges as their upper bound', () => {
    expect(parseWindMph('7 to 20 mph')).toBe(20);
    expect(parseWindMph('3 mph')).toBe(3);
    expect(parseWindMph('calm')).toBeNull();
    expect(parseWindMph(4)).toBeNull();
  });

  it('names days in the forecast offset', () => {
    expect(localWeekday('2026-11-13T23:00:00-08:00')).toBe('Fri');
    expect(localWeekday('nonsense')).toBe('');
  });

  it('takes current conditions from the first hourly period', () => {
    expect(parseNow(HOURLY)).toEqual({
      tempF: 71,
      summary: 'Partly Sunny',
      isDay: true,
      windMph: 3,
      windDir: 'SSW',
      humidity: 51,
      precip: 1,
    });
    expect(parseNow({ properties: { periods: [] } })).toBeNull();
    expect(
      parseNow({ properties: { periods: [period({ temperature: 20, temperatureUnit: 'C' })] } })
        ?.tempF,
    ).toBe(68);
  });

  it('pairs days with their nights and keeps the higher chance of precipitation', () => {
    expect(parseDays(FORECAST)).toEqual([
      { name: 'Today', highF: 72, lowF: 53, summary: 'Mostly Sunny', precip: 17 },
      { name: 'Fri', highF: 61, lowF: 47, summary: 'Showers And Thunderstorms', precip: 98 },
      { name: 'Sat', highF: 64, lowF: null, summary: 'Sunny', precip: null },
    ]);
  });

  it('starts with Tonight when the forecast opens at night', () => {
    const [, ...fromTonight] = FORECAST.properties.periods;
    expect(parseDays({ properties: { periods: fromTonight } })[0]).toEqual({
      name: 'Tonight',
      highF: null,
      lowF: 53,
      summary: 'Showers And Thunderstorms',
      precip: 17,
    });
  });

  it('follows only NWS https URLs out of a points answer', () => {
    expect(nwsUrl(POINTS.properties.forecast)).toBe(POINTS.properties.forecast);
    expect(nwsUrl('http://api.weather.gov/x')).toBeNull();
    expect(nwsUrl('https://api.weather.gov.evil.test/x')).toBeNull();
    expect(nwsUrl('https://user@api.weather.gov/x')).toBeNull();
    expect(nwsUrl('https://api.weather.gov:8443/x')).toBeNull();
    expect(nwsUrl(42)).toBeNull();
  });
});

describe('weather provider', () => {
  it('geocodes the ZIP, reads NWS and caches both lookups', async () => {
    let now = Date.parse('2026-11-13T00:00:00Z');
    const fetch = fakeFetch();
    const provider = createWeatherProvider({ fetch, now: () => now });
    const first = await provider.report('95814');
    expect(first).toEqual({
      state: 'ok',
      report: {
        zip: '95814',
        place: 'Sacramento',
        region: 'CA',
        now: expect.objectContaining({ tempF: 71 }),
        days: expect.arrayContaining([expect.objectContaining({ name: 'Today' })]),
        fetchedAt: '2026-11-13T00:00:00.000Z',
      },
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toEqual(expect.objectContaining({ 'User-Agent': 'mux-xr-weather' }));
    expect(init?.redirect).toBe('error');
    await provider.report('95814');
    expect(fetch).toHaveBeenCalledTimes(4);
    now += 11 * 60_000;
    await provider.report('95814');
    // The location stays cached; only the two forecasts are fetched again.
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('fetches a report directly without a companion address or pairing secret', async () => {
    const fetch = fakeFetch();
    const direct = createDirectWeatherFetcher({ fetch });
    expect(await direct('invalid')).toEqual({ ok: true, status: { state: 'unknown-zip' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(await direct('95814')).toEqual({
      ok: true,
      status: expect.objectContaining({
        state: 'ok',
        report: expect.objectContaining({ place: 'Sacramento' }),
      }),
    });
    expect(fetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      'api.zippopotam.us',
      'api.weather.gov',
      'api.weather.gov',
      'api.weather.gov',
    ]);
    expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty('User-Agent');
  });

  it('reports unknown ZIPs and retries after an outage instead of caching it', async () => {
    let down = true;
    const fetch = fakeFetch({
      'https://api.weather.gov/gridpoints': () => (down ? json({}, 503) : json(FORECAST)),
    });
    const provider = createWeatherProvider({ fetch });
    expect(await provider.report('00000')).toEqual({ state: 'unknown-zip' });
    expect(await provider.report('95814')).toEqual({ state: 'unavailable' });
    down = false;
    expect((await provider.report('95814')).state).toBe('ok');
  });

  it('refuses a points answer that points away from NWS', async () => {
    const fetch = fakeFetch({
      'https://api.weather.gov/points': () =>
        json({
          properties: { forecast: 'https://evil.test/f', forecastHourly: 'https://evil.test/h' },
        }),
    });
    const provider = createWeatherProvider({ fetch });
    expect(await provider.report('95814')).toEqual({ state: 'unknown-zip' });
    expect(fetch.mock.calls.some(([url]) => url.startsWith('https://evil.test'))).toBe(false);
  });
});

describe('weather client', () => {
  it('validates ZIPs and rebuilds statuses field by field', () => {
    expect(validateWeatherZip('95814')).toBe('95814');
    expect(validateWeatherZip('9581')).toBe('');
    expect(validateWeatherZip(95814)).toBe('');
    expect(parseWeatherStatus({ state: 'unknown-zip' })).toEqual({ state: 'unknown-zip' });
    expect(parseWeatherStatus({ state: 'ok', report: { now: {}, days: [] } })).toBeNull();
    expect(parseWeatherStatus('nope')).toBeNull();
  });
});

const servers: { server: Server; close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const { server, close } of servers.splice(0)) {
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const start = async (provider: WeatherProvider, configured = true) => {
  const server = createServer();
  const attached = attachDictationServer(server, {
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard: configured
      ? {
          loadSecret: () => ({ enabled: true, key: Buffer.from(PAIRING) }),
          host: { read: async () => '', write: async () => undefined },
        }
      : undefined,
    weather: { provider },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `ws://127.0.0.1:${address.port}/weather`;
};

const factory = (target: string) =>
  new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket;

describe('weather route', () => {
  it('answers a paired client and rejects a wrong secret', async () => {
    const provider = createWeatherProvider({ fetch: fakeFetch() });
    const url = await start(provider);
    const client = (secret: string | null) =>
      createWeatherClient({ url: () => url, secret: () => secret, socketFactory: factory });
    const result = await client(PAIRING)('95814');
    expect(result.ok && result.status.state === 'ok' && result.status.report.place).toBe(
      'Sacramento',
    );
    expect(await client(PAIRING)('00000')).toEqual({ ok: true, status: { state: 'unknown-zip' } });
    expect(await client('wrong-secret-value-of-enough-length')('95814')).toEqual({
      ok: false,
      code: 'auth',
    });
    expect(await client(null)('95814')).toEqual({ ok: false, code: 'no-secret' });
  });

  it('never asks the provider about a malformed ZIP, even when signed', async () => {
    const provider = { report: vi.fn<WeatherProvider['report']>() };
    const url = await start(provider);
    const answer = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = new WebSocket(url, { origin: ORIGIN });
      socket.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (message.type === 'challenge') {
          const zip = '../../x';
          const mac = weatherMac(Buffer.from(PAIRING), message.nonce, zip).toString('base64');
          socket.send(JSON.stringify({ type: 'auth', zip, mac }));
        } else {
          resolve(message);
          socket.close();
        }
      });
      socket.once('error', reject);
    });
    expect(answer).toEqual({ type: 'weather', status: { state: 'unknown-zip' } });
    expect(provider.report).not.toHaveBeenCalled();
  });

  it('reports disabled without clipboard pairing', async () => {
    const url = await start({ report: vi.fn() }, false);
    const client = createWeatherClient({
      url: () => url,
      secret: () => PAIRING,
      socketFactory: factory,
    });
    expect(await client('95814')).toEqual({ ok: false, code: 'disabled' });
  });
});
