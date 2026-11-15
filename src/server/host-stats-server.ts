import { cpus as osCpus, loadavg as osLoadavg } from 'node:os';
import {
  type ClipboardSecret,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import { createPairedRoute, type PairedRoute, pairedHmac } from './paired-route';

export const HOST_STATS_PATH = '/host-stats';
export const HOST_STATS_PROTOCOL = 'mux-xr-host-stats-v1';
const MAX_MESSAGE_BYTES = 1024;
const MAX_CONNECTIONS = 4;
const MAX_CONNECTIONS_PER_CLIENT = 2;
const AUTH_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 10_000;
/** Successful requests per client per minute; a 5 s poll needs 12. */
export const HOST_STATS_REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 60_000;
/** A previous CPU snapshot inside this range is a usable delta base; outside it, sample afresh. */
const MIN_DELTA_MS = 1_000;
const MAX_DELTA_MS = 30_000;
const FRESH_SAMPLE_MS = 250;

export type HostStats = {
  type: 'stats';
  /** 1-, 5- and 15-minute load averages. */
  load: [number, number, number];
  /** Busy share of all cores since the previous sample, 0..100, or null when it cannot be measured. */
  cpu: number | null;
  cores: number;
};

export type HostStatsErrorCode = 'disabled' | 'auth' | 'rate_limited' | 'protocol';

/** Refusals only; successful requests are never reported. */
export type HostStatsEvent = {
  kind: 'refused';
  code: 'origin' | 'rate_limited' | 'busy' | 'auth' | 'disabled';
};

export type RequestLimiter = {
  blocked(key: string): boolean;
  record(key: string): void;
};

/** Sliding-window count of requests per key. */
export const createRequestLimiter = (
  now: () => number = Date.now,
  limit = HOST_STATS_REQUEST_LIMIT,
  windowMs = REQUEST_WINDOW_MS,
): RequestLimiter => {
  const seen = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const cutoff = now() - windowMs;
    for (const [other, times] of seen) {
      const kept = times.filter((at) => at > cutoff);
      if (kept.length) seen.set(other, kept);
      else seen.delete(other);
    }
    return seen.get(key) ?? [];
  };
  return {
    blocked: (key) => recent(key).length >= limit,
    record: (key) => {
      seen.set(key, [...recent(key), now()]);
    },
  };
};

type CpuTimes = { idle: number; total: number };

export type HostStatsProbe = {
  loadavg: () => number[];
  cpus: () => Array<{ times: Record<string, number> }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const defaultProbe: HostStatsProbe = {
  loadavg: osLoadavg,
  cpus: osCpus as unknown as HostStatsProbe['cpus'],
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const round = (value: number, places = 2): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const finiteOrZero = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const sumTimes = (list: Array<{ times: Record<string, number> }>): CpuTimes => {
  let idle = 0;
  let total = 0;
  for (const cpu of list) {
    for (const value of Object.values(cpu.times ?? {})) total += finiteOrZero(value);
    idle += finiteOrZero(cpu.times?.idle);
  }
  return { idle, total };
};

export const cpuPercent = (before: CpuTimes, after: CpuTimes): number | null => {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (!(total > 0) || idle < 0 || idle > total) return null;
  return round(((total - idle) / total) * 100, 1);
};

/** CPU usage from os.cpus() deltas, sampled only when a request asks. */
export const createHostStatsSampler = (probe: Partial<HostStatsProbe> = {}) => {
  const { loadavg, cpus, now, sleep } = { ...defaultProbe, ...probe };
  let previous: { at: number; times: CpuTimes } | null = null;
  let inFlight: Promise<HostStats> | null = null;
  const take = (): { at: number; times: CpuTimes; cores: number } => {
    const list = cpus();
    return { at: now(), times: sumTimes(list), cores: list.length };
  };
  const sample = async (): Promise<HostStats> => {
    let current = take();
    const age = previous ? current.at - previous.at : Number.POSITIVE_INFINITY;
    let base = previous?.times;
    if (!previous || age < MIN_DELTA_MS || age > MAX_DELTA_MS) {
      base = current.times;
      await sleep(FRESH_SAMPLE_MS);
      current = take();
    }
    previous = { at: current.at, times: current.times };
    const [one, five, fifteen] = loadavg();
    return {
      type: 'stats',
      load: [round(finiteOrZero(one)), round(finiteOrZero(five)), round(finiteOrZero(fifteen))],
      cpu: base ? cpuPercent(base, current.times) : null,
      cores: current.cores,
    };
  };
  return {
    /** Concurrent callers share one sample. */
    sample: (): Promise<HostStats> => {
      inFlight ??= sample().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
};

export const hostStatsMac = (key: Buffer, nonce: string): Buffer =>
  pairedHmac(key, HOST_STATS_PROTOCOL, nonce, 'stats');

export type HostStatsRouteOptions = {
  allowedOrigins: string[];
  /** The clipboard pairing secret, reread per connection. */
  loadSecret: () => ClipboardSecret;
  /** Auth failures; share the clipboard route's limiter so both routes draw on one budget. */
  limiter?: FailureLimiter;
  /** Successful requests; defaults to {@link HOST_STATS_REQUEST_LIMIT} per minute per client. */
  requestLimiter?: RequestLimiter;
  sampler?: { sample: () => Promise<HostStats> };
  now?: () => number;
  authTimeoutMs?: number;
  maxConnections?: number;
  maxConnectionsPerClient?: number;
  sessionTimeoutMs?: number;
  /** Counts refusal codes only; never stats or the secret. */
  onEvent?: (event: HostStatsEvent) => void;
};

export type HostStatsRoute = PairedRoute;

const ERROR_MESSAGES: Record<HostStatsErrorCode, string> = {
  disabled: 'Host stats need the host clipboard pairing secret on the host.',
  auth: 'Host stats authentication failed.',
  rate_limited: 'Too many host stats requests.',
  protocol: 'Unexpected host stats message.',
};

export const createHostStatsRoute = (options: HostStatsRouteOptions): HostStatsRoute => {
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests = options.requestLimiter ?? createRequestLimiter(options.now);
  const sampler = options.sampler ?? createHostStatsSampler();
  const emit = (code: HostStatsEvent['code']): void => {
    try {
      options.onEvent?.({ kind: 'refused', code });
    } catch {
      /* Observability must not interrupt the route. */
    }
  };
  return createPairedRoute({
    protocol: HOST_STATS_PROTOCOL,
    allowedOrigins: options.allowedOrigins,
    loadSecret: options.loadSecret,
    limiter,
    requestLimiter: { blocked: requests.blocked, charge: requests.record },
    maxPayloadBytes: MAX_MESSAGE_BYTES,
    maxConnections: options.maxConnections ?? MAX_CONNECTIONS,
    perClient: {
      cap: options.maxConnectionsPerClient ?? MAX_CONNECTIONS_PER_CLIENT,
      gate: 'busy',
      release: 'close',
    },
    reportGates: true,
    reportFailures: 'except-protocol',
    emit: (event) => emit(event.code as HostStatsEvent['code']),
    authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    sessionTimeoutMs: options.sessionTimeoutMs ?? SESSION_TIMEOUT_MS,
    macMaterial: () => 'stats',
    errorMessage: (code) => ERROR_MESSAGES[code as HostStatsErrorCode],
    onAuthenticated: (connection) => {
      void (async () => {
        try {
          const stats = await sampler.sample();
          if (connection.finished()) return;
          connection.sendJson(stats);
          connection.finish(1000, 'complete');
        } catch {
          connection.finish(1011, 'sample failed');
        }
      })();
    },
  });
};
