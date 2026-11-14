import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WEATHER_ZIP_FORMAT, type WeatherStatus } from '@par/xr-workspace/internal/weather-data';
import {
  createWeatherProvider as createProvider,
  localWeekday,
  nwsUrl,
  parseDays,
  parseNow,
  parseWindMph,
  type WeatherFetch,
  type WeatherProvider,
  type WeatherProviderOptions,
} from '@par/xr-workspace/internal/weather-provider';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

export type {
  WeatherProvider,
  WeatherProviderOptions,
} from '@par/xr-workspace/internal/weather-provider';

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
const REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 60_000;
const CONTROL_CHARS = /[\p{Cc}]/u;

export const ZIP_FORMAT = WEATHER_ZIP_FORMAT;
export type WeatherErrorCode = 'disabled' | 'auth' | 'rate_limited' | 'protocol';

export const weatherMac = (key: Buffer, nonce: string, zip: string): Buffer =>
  createHmac('sha256', key).update(`${WEATHER_PROTOCOL}\n${nonce}\n${zip}`).digest();

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
