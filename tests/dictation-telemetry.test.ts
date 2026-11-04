import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDictationTelemetry as create } from '../src/server/dictation-telemetry';

const active: ReturnType<typeof create>[] = [];
const createDictationTelemetry: typeof create = (options) => {
  const telemetry = create(options);
  active.push(telemetry);
  return telemetry;
};
afterEach(async () => {
  for (const telemetry of active.splice(0)) await telemetry.shutdown();
  vi.restoreAllMocks();
});

type JsonRecord = Record<string, unknown>;
type Export = { url: string; body: JsonRecord };
type MetricPoint = {
  asDouble?: number;
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  attributes?: unknown[];
};
type Metric = {
  name: string;
  sum?: { dataPoints: MetricPoint[] };
  gauge?: { dataPoints: MetricPoint[] };
};
type MetricsBody = { resourceMetrics: Array<{ scopeMetrics: Array<{ metrics: Metric[] }> }> };
const ok = () => new Response('{}', { status: 200 });
const exporter = (): { calls: Export[]; fetch: typeof fetch } => {
  const calls: Export[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as JsonRecord });
    return ok();
  }) as typeof fetch;
  return { calls, fetch: fetcher };
};
const bySignal = (calls: Export[], signal: string) =>
  calls.find((call) => call.url.endsWith(`/v1/${signal}`))?.body;
const requireMetric = (body: JsonRecord, name: string): Metric => {
  const found = (body as unknown as MetricsBody).resourceMetrics[0]?.scopeMetrics[0]?.metrics.find(
    (item) => item.name === name,
  );
  if (!found) throw new Error(`missing metric ${name}`);
  return found;
};

describe('dictation OTLP telemetry', () => {
  it('is disabled without an endpoint or when explicitly disabled', async () => {
    for (const env of [
      {},
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test', OTEL_SDK_DISABLED: 'true' },
    ]) {
      const { calls, fetch } = exporter();
      const telemetry = createDictationTelemetry({ env, fetch });
      expect(telemetry.enabled).toBe(false);
      await telemetry.forceFlush();
      expect(calls).toEqual([]);
    }
  });

  it('fails soft for an invalid endpoint without exporting', async () => {
    const { calls, fetch } = exporter();
    const telemetry = createDictationTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'not a URL' },
      fetch,
    });
    expect(telemetry.enabled).toBe(false);
    await expect(telemetry.forceFlush()).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('separates counter dimensions and preserves cumulative values across flushes', async () => {
    let wall = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    const { calls, fetch } = exporter();
    const telemetry = createDictationTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test' },
      fetch,
    });
    telemetry.httpRequest('/health', 200);
    telemetry.httpRequest('/health', 500);
    telemetry.rejected('busy');
    telemetry.rejected('origin');
    telemetry.beginTranscription(12)('success');
    await telemetry.forceFlush();
    const first = bySignal(calls, 'metrics');
    if (!first) throw new Error('missing first metrics export');
    const firstCounter = requireMetric(first, 'mux_xr_whisper_requests_total');
    const firstRejected = requireMetric(first, 'mux_xr_whisper_requests_rejected_total');
    expect(firstCounter.sum?.dataPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          asDouble: 1,
          attributes: expect.arrayContaining([
            { key: 'route', value: { stringValue: '/health' } },
            { key: 'status', value: { stringValue: '200' } },
          ]),
        }),
        expect.objectContaining({
          asDouble: 1,
          attributes: expect.arrayContaining([
            { key: 'route', value: { stringValue: '/health' } },
            { key: 'status', value: { stringValue: '500' } },
          ]),
        }),
      ]),
    );
    expect(firstRejected.sum?.dataPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          asDouble: 1,
          attributes: expect.arrayContaining([{ key: 'reason', value: { stringValue: 'busy' } }]),
        }),
        expect.objectContaining({
          asDouble: 1,
          attributes: expect.arrayContaining([{ key: 'reason', value: { stringValue: 'origin' } }]),
        }),
      ]),
    );
    const start = firstCounter.sum?.dataPoints[0]?.startTimeUnixNano;
    if (!start) throw new Error('missing counter start timestamp');
    expect(BigInt(start)).toBeGreaterThan(0n);
    telemetry.httpRequest('/health', 200);
    wall += 1_000;
    await telemetry.forceFlush();
    const second = bySignal(calls.slice(3), 'metrics');
    if (!second) throw new Error('missing second metrics export');
    const secondPoints =
      requireMetric(second, 'mux_xr_whisper_requests_total').sum?.dataPoints ?? [];
    const second200 = secondPoints.find((point) =>
      JSON.stringify(point.attributes).includes('200'),
    );
    const second500 = secondPoints.find((point) =>
      JSON.stringify(point.attributes).includes('500'),
    );
    expect(second200?.asDouble).toBe(2);
    expect(second500?.asDouble).toBe(1);
    expect(second200?.startTimeUnixNano).toBe(start);
    if (!second200?.timeUnixNano) throw new Error('missing second counter timestamp');
    expect(BigInt(second200.timeUnixNano)).toBeGreaterThan(BigInt(start));
  });

  it('emits a valid delayed span and omits secrets, transcript, raw errors, and model paths', async () => {
    const { calls, fetch } = exporter();
    const telemetry = createDictationTelemetry({
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test',
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=secret-token',
      },
      fetch,
    });
    const finish = telemetry.beginTranscription(42);
    await new Promise((resolve) => setTimeout(resolve, 5));
    finish('error');
    await telemetry.forceFlush();
    const traceBody = bySignal(calls, 'traces');
    if (!traceBody) throw new Error('missing traces export');
    const span = (
      traceBody as unknown as {
        resourceSpans: Array<{
          scopeSpans: Array<{
            spans: Array<{
              startTimeUnixNano: string;
              endTimeUnixNano: string;
              status: { code: number };
            }>;
          }>;
        }>;
      }
    ).resourceSpans[0].scopeSpans[0].spans[0];
    expect(BigInt(span.endTimeUnixNano)).toBeGreaterThan(BigInt(span.startTimeUnixNano));
    expect(span.status.code).toBeLessThanOrEqual(2);
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('"transcript":');
    expect(serialized).not.toContain('private transcript text');
    expect(serialized).not.toContain('"error":');
    expect(serialized).not.toContain('"modelPath":');
  });

  it('coalesces overlapping flushes and emits up=0 on shutdown', async () => {
    let release!: () => void;
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(ok());
    });
    const calls: Export[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as JsonRecord });
      return pending;
    }) as typeof globalThis.fetch;
    const telemetry = createDictationTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test' },
      fetch,
    });
    const first = telemetry.forceFlush();
    const second = telemetry.forceFlush();
    await Promise.resolve();
    expect(calls).toHaveLength(3);
    const stopping = telemetry.shutdown();
    release();
    await Promise.all([first, second, stopping]);
    const shutdown = calls.findLast((call) => call.url.endsWith('/v1/metrics'))?.body;
    if (!shutdown) throw new Error('missing shutdown metrics');
    expect(calls.filter((call) => call.url.endsWith('/v1/metrics'))).toHaveLength(2);
    expect(requireMetric(shutdown, 'mux_xr_whisper_up').gauge?.dataPoints[0]?.asDouble).toBe(0);
    expect(
      requireMetric(shutdown, 'mux_xr_whisper_heartbeat_timestamp_seconds').gauge?.dataPoints[0]
        ?.asDouble,
    ).toBeGreaterThan(0);
  });

  it('keeps failed span and log buffers bounded while new records arrive', async () => {
    let failed = true;
    const calls: Export[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const entry = {
        url: String(url),
        body: JSON.parse(String(init?.body)) as JsonRecord,
      };
      calls.push(entry);
      if (failed && (entry.url.endsWith('/traces') || entry.url.endsWith('/logs')))
        throw new Error('offline');
      return ok();
    }) as typeof globalThis.fetch;
    const telemetry = createDictationTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.test' },
      fetch,
    });
    for (let index = 0; index < 140; index += 1) telemetry.beginTranscription(index)('error');
    await telemetry.forceFlush();
    failed = false;
    telemetry.beginTranscription(1)('success');
    await telemetry.forceFlush();
    const traces = calls.filter((call) => call.url.endsWith('/traces')).at(-1)?.body;
    const logs = calls.filter((call) => call.url.endsWith('/logs')).at(-1)?.body;
    const spanCount =
      (
        traces as unknown as
          | { resourceSpans: Array<{ scopeSpans: Array<{ spans: unknown[] }> }> }
          | undefined
      )?.resourceSpans[0]?.scopeSpans[0]?.spans.length ?? 0;
    const logCount =
      (
        logs as unknown as
          | { resourceLogs: Array<{ scopeLogs: Array<{ logRecords: unknown[] }> }> }
          | undefined
      )?.resourceLogs[0]?.scopeLogs[0]?.logRecords.length ?? 0;
    expect(spanCount).toBeLessThanOrEqual(128);
    expect(logCount).toBeLessThanOrEqual(128);
  });
});
