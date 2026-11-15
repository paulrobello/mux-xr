// Classifies long-frame display gaps in a Chrome trace captured by scripts/terminal-capacity-check.ts
// with MUX_XR_TRACE=1. Usage:
//   bun run scripts/classify-capacity-trace.ts <trace.json> [--out <classification.json>]
import { readFileSync, writeFileSync } from 'node:fs';

const GAP_THRESHOLD_MS = 30;
const OVER_50_MS = 50;
const MAIN_MIN_DUR_US = 50;
const GPU_MIN_DUR_US = 100;
const GC_NAMES = new Set(['MajorGC', 'MinorGC']);
const TOP_MAIN_PER_GAP = 6;
const TOP_GPU_PER_GAP = 4;
const TOP_OVERALL = 8;

type TraceEvent = {
  name?: unknown;
  ts?: unknown;
  dur?: unknown;
  pid?: unknown;
  tid?: unknown;
  ph?: unknown;
  args?: unknown;
};
type TraceSlice = {
  name: string;
  ts: number;
  dur: number;
  pid: number;
  tid: number;
  args: unknown;
};
type Bucket = { name: string; topFunction: string; longestDurUs: number; ms: number };
type GapReport = {
  startMs: number;
  durationMs: number;
  main: Array<{ name: string; topFunction: string; ms: number }>;
  gc: { major: number; minor: number; ms: number };
  gpu: Array<{ name: string; topFunction: string; ms: number }>;
  gpuTotalMs: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

// args.stackTrace is innermost-first DevTools order; keep the first 3 non-empty function names.
function topStack(event: TraceSlice): string {
  const args = asRecord(event.args);
  const stack = Array.isArray(args?.stackTrace) ? (args?.stackTrace as unknown[]) : [];
  const names = stack.map((frame) => asText(asRecord(frame)?.functionName)).filter((n) => n !== '');
  if (names.length > 0) return names.slice(0, 3).join('<');
  const fn = asText(asRecord(args?.data)?.functionName);
  return fn !== '' ? `FunctionCall:${fn}` : '(no stack)';
}

function overlapUs(slice: TraceSlice, gapStartUs: number, gapEndUs: number): number {
  return Math.min(slice.ts + slice.dur, gapEndUs) - Math.max(slice.ts, gapStartUs);
}

function addEvent(map: Map<string, Bucket>, slice: TraceSlice, overlap: number): void {
  const existing = map.get(slice.name);
  if (!existing) {
    map.set(slice.name, {
      name: slice.name,
      topFunction: topStack(slice),
      longestDurUs: slice.dur,
      ms: overlap / 1000,
    });
    return;
  }
  existing.ms += overlap / 1000;
  if (slice.dur > existing.longestDurUs) {
    existing.longestDurUs = slice.dur;
    existing.topFunction = topStack(slice);
  }
}

function mergeBucket(map: Map<string, Bucket>, bucket: Bucket): void {
  const existing = map.get(bucket.name);
  if (!existing) {
    map.set(bucket.name, { ...bucket });
    return;
  }
  existing.ms += bucket.ms;
  if (bucket.longestDurUs > existing.longestDurUs) {
    existing.longestDurUs = bucket.longestDurUs;
    existing.topFunction = bucket.topFunction;
  }
}

function topBuckets(
  map: Map<string, Bucket>,
  limit: number,
): Array<{ name: string; topFunction: string; ms: number }> {
  return [...map.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .map(({ name, topFunction, ms }) => ({ name, topFunction, ms: round2(ms) }));
}

function loadEvents(path: string): TraceEvent[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    fail(
      `cannot read trace file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(
      `trace file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (Array.isArray(parsed)) return parsed as TraceEvent[];
  const record = asRecord(parsed);
  if (Array.isArray(record?.traceEvents)) return record.traceEvents as TraceEvent[];
  fail(`trace file ${path} must be a {traceEvents: [...]} object or a bare event array`);
}

function parseArgs(argv: string[]): { tracePath: string; outPath: string | null } {
  const positionals: string[] = [];
  let outPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      outPath = argv[index + 1] ?? null;
      if (outPath === null || outPath === '') fail('--out requires a file path');
      index += 1;
      continue;
    }
    positionals.push(argv[index] ?? '');
  }
  if (positionals.length !== 1 || positionals[0] === '')
    fail(
      'usage: bun run scripts/classify-capacity-trace.ts <trace.json> [--out <classification.json>]',
    );
  return { tracePath: positionals[0] ?? '', outPath };
}

function main(): void {
  const { tracePath, outPath } = parseArgs(process.argv.slice(2));
  const events = loadEvents(tracePath);

  const threadNames = new Map<string, string>();
  for (const event of events) {
    const record = asRecord(event);
    if (record?.ph !== 'M' || record.name !== 'thread_name') continue;
    const pid = asNumber(record.pid);
    const tid = asNumber(record.tid);
    const label = asText(asRecord(record.args)?.name);
    if (pid !== null && tid !== null && label !== '') threadNames.set(`${pid}:${tid}`, label);
  }
  const keysNamed = (label: string): string[] =>
    [...threadNames.entries()].filter(([, name]) => name === label).map(([key]) => key);
  const rendererMainKey = keysNamed('CrRendererMain')[0];
  if (rendererMainKey === undefined)
    fail('no CrRendererMain thread in trace metadata (missing thread_name events)');
  const gpuKeys = new Set(keysNamed('CrGpuMain'));
  const rendererPid = Number(rendererMainKey.split(':')[0]);

  const isSlice = (event: TraceEvent): event is TraceEvent & TraceSlice => {
    const pid = asNumber(event.pid);
    const tid = asNumber(event.tid);
    return (
      asText(event.name) !== '' &&
      event.ph === 'X' &&
      asNumber(event.ts) !== null &&
      (asNumber(event.dur) ?? 0) > 0 &&
      pid !== null &&
      tid !== null
    );
  };
  const onThread = (slice: TraceSlice, key: string): boolean => `${slice.pid}:${slice.tid}` === key;

  const slices: TraceSlice[] = [];
  for (const event of events) if (isSlice(event)) slices.push(event);

  const frames = slices
    .filter((slice) => onThread(slice, rendererMainKey) && slice.name === 'FireAnimationFrame')
    .map(({ ts, dur }) => ({ ts, dur }))
    .sort((a, b) => a.ts - b.ts);
  const mainSlices = slices.filter(
    (slice) =>
      onThread(slice, rendererMainKey) &&
      slice.name !== 'FireAnimationFrame' &&
      slice.dur >= MAIN_MIN_DUR_US,
  );
  const gcSlices = slices.filter((slice) => slice.pid === rendererPid && GC_NAMES.has(slice.name));
  const gpuSlices = slices.filter(
    (slice) => gpuKeys.has(`${slice.pid}:${slice.tid}`) && slice.dur >= GPU_MIN_DUR_US,
  );

  const grandMain = new Map<string, Bucket>();
  const grandGpu = new Map<string, Bucket>();
  let grandMajor = 0;
  let grandMinor = 0;
  let grandGcMs = 0;
  const gaps: GapReport[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) continue;
    const durationUs = current.ts - previous.ts;
    if (durationUs <= GAP_THRESHOLD_MS * 1000) continue;
    const gapStartUs = previous.ts;
    const gapEndUs = current.ts;
    const mainBuckets = new Map<string, Bucket>();
    for (const slice of mainSlices) {
      if (slice.ts < gapStartUs || slice.ts >= gapEndUs) continue;
      addEvent(mainBuckets, slice, overlapUs(slice, gapStartUs, gapEndUs));
    }
    const gpuBuckets = new Map<string, Bucket>();
    let gpuTotalMs = 0;
    for (const slice of gpuSlices) {
      const overlap = overlapUs(slice, gapStartUs, gapEndUs);
      if (overlap <= 0) continue;
      gpuTotalMs += overlap / 1000;
      addEvent(gpuBuckets, slice, overlap);
    }
    let major = 0;
    let minor = 0;
    let gcMs = 0;
    for (const slice of gcSlices) {
      const overlap = overlapUs(slice, gapStartUs, gapEndUs);
      if (overlap <= 0) continue;
      if (slice.name === 'MajorGC') major += 1;
      else minor += 1;
      gcMs += overlap / 1000;
    }
    grandMajor += major;
    grandMinor += minor;
    grandGcMs += gcMs;
    for (const bucket of mainBuckets.values()) mergeBucket(grandMain, bucket);
    for (const bucket of gpuBuckets.values()) mergeBucket(grandGpu, bucket);
    gaps.push({
      // startMs is the offset from the first FireAnimationFrame in the trace.
      startMs: round2((gapStartUs - (frames[0]?.ts ?? gapStartUs)) / 1000),
      durationMs: round2(durationUs / 1000),
      main: topBuckets(mainBuckets, TOP_MAIN_PER_GAP),
      gc: { major, minor, ms: round2(gcMs) },
      gpu: topBuckets(gpuBuckets, TOP_GPU_PER_GAP),
      gpuTotalMs: round2(gpuTotalMs),
    });
  }

  const report = {
    traceFile: tracePath,
    gapThresholdMs: GAP_THRESHOLD_MS,
    frameCount: frames.length,
    gaps,
    totals: {
      gapCount: gaps.length,
      over50MsCount: gaps.filter((gap) => gap.durationMs > OVER_50_MS).length,
      worstGapMs: gaps.length > 0 ? Math.max(...gaps.map((gap) => gap.durationMs)) : 0,
      main: topBuckets(grandMain, TOP_OVERALL),
      gpu: topBuckets(grandGpu, TOP_OVERALL),
      gc: { major: grandMajor, minor: grandMinor, ms: round2(grandGcMs) },
    },
  };

  console.log(`classify-capacity-trace: ${tracePath}`);
  console.log(
    `frames: ${frames.length}  gaps >${GAP_THRESHOLD_MS}ms: ${gaps.length}  >${OVER_50_MS}ms: ${report.totals.over50MsCount}  worst: ${report.totals.worstGapMs}ms`,
  );
  for (const gap of gaps) {
    const mainText = gap.main
      .slice(0, 3)
      .map((bucket) => `${bucket.name}(${bucket.topFunction}) ${bucket.ms}ms`)
      .join(' | ');
    console.log(
      `gap @${gap.startMs}ms +${gap.durationMs}ms | ${mainText} | gc major=${gap.gc.major} minor=${gap.gc.minor} | gpu ${gap.gpuTotalMs}ms`,
    );
  }
  const json = JSON.stringify(report, null, 2);
  if (outPath !== null) {
    try {
      writeFileSync(outPath, `${json}\n`);
    } catch (error) {
      fail(`cannot write ${outPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`classification written to ${outPath}`);
  }
  console.log(json);
}

try {
  main();
} catch (error) {
  console.error(
    `classify-capacity-trace: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
