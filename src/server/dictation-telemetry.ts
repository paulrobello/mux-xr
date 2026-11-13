import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';

export type TranscriptionOutcome = 'success' | 'error' | 'cancelled' | 'timeout';
export interface DictationTelemetry {
  readonly enabled: boolean;
  connected(): void;
  disconnected(): void;
  rejected(reason: 'origin' | 'path' | 'invalid_payload' | 'busy'): void;
  httpRequest(route: '/health' | '/toast' | 'other', status: number): void;
  beginTranscription(bytes: number): (outcome: TranscriptionOutcome) => void;
  started(): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}
type Options = {
  env?: NodeJS.ProcessEnv;
  envFile?: string;
  fetch?: typeof fetch;
  hostname?: string;
  intervalMs?: number;
};
type Attr = { key: string; value: { stringValue: string } };
type Counter = { name: string; value: number; attributes: Attr[] };
type Signal = 'metrics' | 'traces' | 'logs';
const MAX_BUFFER = 128;
const BOUNDS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 90];
const noop = (): void => undefined;
const str = (value: string): { stringValue: string } => ({ stringValue: value });
const attrs = (values: Record<string, string | number>): Attr[] =>
  Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value: str(String(value)) }));
const unixNano = (): string => (BigInt(Date.now()) * 1_000_000n).toString();
const disabled = (): DictationTelemetry => ({
  enabled: false,
  connected: noop,
  disconnected: noop,
  rejected: noop,
  httpRequest: noop,
  beginTranscription: () => noop,
  started: noop,
  forceFlush: async () => undefined,
  shutdown: async () => undefined,
});

const parseEnvFile = (path?: string): NodeJS.ProcessEnv => {
  if (!path) return {};
  try {
    const values: NodeJS.ProcessEnv = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?(OTEL_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      values[match[1]] = value;
    }
    return values;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn('Whisper telemetry configuration could not be loaded.');
    return {};
  }
};
const headersFor = (env: NodeJS.ProcessEnv, signal: Signal): Record<string, string> => {
  const result: Record<string, string> = { 'content-type': 'application/json' };
  for (const raw of [
    env.OTEL_EXPORTER_OTLP_HEADERS,
    env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_HEADERS`],
  ]) {
    for (const pair of raw?.split(',') ?? []) {
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      try {
        result[decodeURIComponent(pair.slice(0, at).trim())] = decodeURIComponent(
          pair.slice(at + 1).trim(),
        );
      } catch {
        /* Invalid headers must not leak into diagnostics. */
      }
    }
  }
  return result;
};
const endpointFor = (env: NodeJS.ProcessEnv, signal: Signal): string | undefined => {
  const specific = env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`];
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const value = specific || (base ? `${base.replace(/\/+$/, '')}/v1/${signal}` : undefined);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return value;
  } catch {
    /* Only validated endpoints reach the exporter. */
  }
  console.warn('Whisper telemetry export endpoint is invalid.');
  return undefined;
};

export const createDictationTelemetry = (options: Options = {}): DictationTelemetry => {
  const env = { ...(options.env ?? process.env), ...parseEnvFile(options.envFile) };
  if (env.OTEL_SDK_DISABLED?.toLowerCase() === 'true') return disabled();
  const endpoints = {
    metrics: endpointFor(env, 'metrics'),
    traces: endpointFor(env, 'traces'),
    logs: endpointFor(env, 'logs'),
  };
  if (!Object.values(endpoints).some(Boolean)) return disabled();
  const send = options.fetch ?? fetch;
  const resource = {
    attributes: attrs({
      'service.name': env.OTEL_SERVICE_NAME || 'mux-xr-whisper',
      'host.name': (options.hostname ?? osHostname()).split('.')[0].toLowerCase(),
      'service.version': env.OTEL_SERVICE_VERSION || '0.1.0',
    }),
  };
  const scope = { name: 'mux-xr-whisper' };
  const startTime = unixNano();
  const counters = new Map<string, Counter>();
  const gauges = new Map<string, number>([
    ['clients', 0],
    ['active_transcriptions', 0],
    ['up', 0],
  ]);
  const histogram = { counts: Array<number>(BOUNDS.length + 1).fill(0), sum: 0, count: 0 };
  const pendingSpans: unknown[] = [],
    pendingLogs: unknown[] = [];
  let flushing: Promise<void> | undefined;
  let stopping = false;
  const bump = (name: string, amount = 1, values: Record<string, string | number> = {}): void => {
    const attributes = attrs(values),
      key = `${name}:${JSON.stringify(attributes)}`;
    const point = counters.get(key);
    if (point) point.value += amount;
    else counters.set(key, { name, value: amount, attributes });
  };
  const append = (buffer: unknown[], value: unknown): void => {
    buffer.push(value);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  };
  const log = (
    message: string,
    severity: number,
    values: Record<string, string | number> = {},
  ): void =>
    append(pendingLogs, {
      timeUnixNano: unixNano(),
      severityNumber: severity,
      severityText: severity >= 17 ? 'ERROR' : severity >= 13 ? 'WARN' : 'INFO',
      body: str(message),
      attributes: attrs(values),
    });
  const post = async (signal: Signal, body: unknown): Promise<boolean> => {
    const endpoint = endpoints[signal];
    if (!endpoint) return true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<boolean>((done) => {
        timer = setTimeout(() => {
          controller.abort();
          done(false);
        }, 2_000);
      });
      const request = Promise.resolve()
        .then(() =>
          send(endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: headersFor(env, signal),
            body: JSON.stringify(body),
            signal: controller.signal,
          }),
        )
        .then(
          (response) => response.ok,
          () => false,
        );
      return await Promise.race([request, timeout]);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const flush = async (): Promise<void> => {
    if (flushing) return flushing;
    flushing = (async () => {
      const now = unixNano();
      gauges.set('heartbeat_timestamp_seconds', Date.now() / 1000);
      const grouped = new Map<string, unknown[]>();
      for (const point of counters.values()) {
        const points = grouped.get(point.name) ?? [];
        points.push({
          asDouble: point.value,
          attributes: point.attributes,
          startTimeUnixNano: startTime,
          timeUnixNano: now,
        });
        grouped.set(point.name, points);
      }
      const data: unknown[] = [...grouped].map(([name, dataPoints]) => ({
        name: `mux_xr_whisper_${name}`,
        sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints },
      }));
      for (const [name, value] of gauges)
        data.push({
          name: `mux_xr_whisper_${name}`,
          gauge: { dataPoints: [{ asDouble: value, timeUnixNano: now }] },
        });
      if (histogram.count)
        data.push({
          name: 'mux_xr_whisper_transcription_duration_seconds',
          unit: 's',
          histogram: {
            aggregationTemporality: 2,
            dataPoints: [
              {
                startTimeUnixNano: startTime,
                timeUnixNano: now,
                count: String(histogram.count),
                sum: histogram.sum,
                explicitBounds: BOUNDS,
                bucketCounts: histogram.counts.map(String),
              },
            ],
          },
        });
      const spans = pendingSpans.splice(0),
        logs = pendingLogs.splice(0);
      const results = await Promise.all([
        post('metrics', {
          resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics: data }] }],
        }),
        post('traces', { resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }] }),
        post('logs', { resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: logs }] }] }),
      ]);
      if (!results[1]) {
        pendingSpans.unshift(...spans);
        if (pendingSpans.length > MAX_BUFFER)
          pendingSpans.splice(0, pendingSpans.length - MAX_BUFFER);
      }
      if (!results[2]) {
        pendingLogs.unshift(...logs);
        if (pendingLogs.length > MAX_BUFFER) pendingLogs.splice(0, pendingLogs.length - MAX_BUFFER);
      }
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };
  const configuredInterval = Number(env.OTEL_METRIC_EXPORT_INTERVAL);
  const interval = setInterval(
    () => {
      void flush();
    },
    options.intervalMs ??
      (Number.isFinite(configuredInterval) && configuredInterval >= 1_000
        ? configuredInterval
        : 15_000),
  );
  interval.unref?.();
  return {
    enabled: true,
    connected: () => {
      if (!stopping) gauges.set('clients', (gauges.get('clients') ?? 0) + 1);
    },
    disconnected: () => gauges.set('clients', Math.max(0, (gauges.get('clients') ?? 0) - 1)),
    rejected: (reason) => {
      if (!stopping) {
        bump('requests_rejected_total', 1, { reason });
        log('Dictation request rejected', 13, { reason });
      }
    },
    httpRequest: (route, status) => {
      if (!stopping) bump('requests_total', 1, { route, status });
    },
    beginTranscription: (bytes) => {
      if (stopping) return noop;
      const started = performance.now(),
        startedNano = unixNano(),
        traceId = randomBytes(16).toString('hex'),
        spanId = randomBytes(8).toString('hex');
      gauges.set('active_transcriptions', (gauges.get('active_transcriptions') ?? 0) + 1);
      bump('audio_bytes_total', bytes);
      let finished = false;
      return (outcome) => {
        if (finished) return;
        finished = true;
        const elapsed = Math.max(0, (performance.now() - started) / 1000);
        gauges.set(
          'active_transcriptions',
          Math.max(0, (gauges.get('active_transcriptions') ?? 0) - 1),
        );
        bump('transcriptions_total', 1, { outcome });
        const bucket = BOUNDS.findIndex((bound) => elapsed <= bound);
        histogram.counts[bucket < 0 ? BOUNDS.length : bucket]++;
        histogram.sum += elapsed;
        histogram.count++;
        const now = unixNano(),
          endedNano = BigInt(now) < BigInt(startedNano) ? startedNano : now;
        append(pendingSpans, {
          traceId,
          spanId,
          kind: 2,
          name: 'whisper.transcribe',
          startTimeUnixNano: startedNano,
          endTimeUnixNano: endedNano,
          attributes: attrs({ outcome, 'audio.bytes': bytes }),
          status: { code: outcome === 'success' ? 1 : outcome === 'cancelled' ? 0 : 2 },
        });
        log(
          'Whisper transcription completed',
          outcome === 'error' || outcome === 'timeout' ? 17 : 9,
          { outcome },
        );
      };
    },
    started: () => {
      if (!stopping) {
        gauges.set('up', 1);
        bump('starts_total');
        log('Whisper listener started', 9);
      }
    },
    forceFlush: flush,
    shutdown: async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(interval);
      if (flushing) await flushing;
      gauges.set('up', 0);
      log('Whisper listener stopped', 9);
      await flush();
    },
  };
};
