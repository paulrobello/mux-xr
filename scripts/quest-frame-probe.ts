// Samples XR frame timing, WebGL draw calls and texture uploads from the Quest Browser over adb
// and the DevTools protocol while someone uses the headset. Nothing in the app changes: the probe
// patches WebGL2RenderingContext and XRSession.requestAnimationFrame in the live page.
//
//   bun run scripts/quest-frame-probe.ts [--seconds 120] [--match mux] [--out file.jsonl]
//     [--cycle 8]
//
// --cycle N hides one group of the scene at a time for N seconds each (all panes, each widget,
// the open keyboard or panel, the HUD, then everything), with the full scene between phases, and
// prints each phase's mean frame interval against the full scene's. Hold still while it runs.
// Hiding everything still submits an empty frame, which separates fixed per-frame cost from the
// scene's.
//
// Each second prints fps, frame interval p50/p95/max, rAF callback mean/p95 (main-thread JS and
// GL submit), draw calls and texture uploads per frame, and the open widgets and pane count.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const SECONDS = Number(args.get('--seconds') ?? 120);
const MATCH = args.get('--match') ?? '';
const OUT = args.get('--out') ?? '';
const CYCLE = Number(args.get('--cycle') ?? 0);
const PORT = 9333;
const adbCandidates = [join(homedir(), 'Library/Android/sdk/platform-tools/adb'), 'adb'];
const adb = adbCandidates.find((path) => {
  try {
    execFileSync(path, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!adb) throw new Error('adb not found');
const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
  .split('\n')
  .slice(1)
  .filter((line) => line.trim().endsWith('device'));
if (devices.length === 0)
  throw new Error('No authorized adb device. Plug in the headset and accept USB debugging.');
execFileSync(adb, ['forward', `tcp:${PORT}`, 'localabstract:chrome_devtools_remote']);

interface Target {
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}
const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Target[];
const target = targets.find(
  (entry) =>
    entry.type === 'page' &&
    entry.webSocketDebuggerUrl &&
    (MATCH ? entry.url.includes(MATCH) || entry.title.includes(MATCH) : true),
);
if (!target?.webSocketDebuggerUrl)
  throw new Error(
    `No page target${MATCH ? ` matching ${MATCH}` : ''}: ${targets.map((t) => t.url).join(', ')}`,
  );
console.error(`probing ${target.title} ${target.url}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  socket.onopen = () => resolve();
  socket.onerror = () => reject(new Error('DevTools socket failed'));
});
let nextId = 1;
const pending = new Map<number, (value: unknown) => void>();
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)?.(message.result);
    pending.delete(message.id);
  }
};
const evaluate = <T>(expression: string): Promise<T> =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (result) =>
      resolve((result as { result?: { value?: T } })?.result?.value as T),
    );
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
  });

const install = `(() => {
  if (window.__questProbe) return 'already';
  const probe = { frames: [], draws: 0, uploads: 0, uploadBytes: 0 };
  window.__questProbe = probe;
  const gl = WebGL2RenderingContext.prototype;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
    const original = gl[name];
    if (!original) continue;
    gl[name] = function (...a) { probe.draws++; return original.apply(this, a); };
  }
  for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexSubImage2D']) {
    const original = gl[name];
    if (!original) continue;
    gl[name] = function (...a) {
      probe.uploads++;
      const sizeArg = a.find((x) => x && typeof x === 'object' && 'width' in x && 'height' in x);
      if (sizeArg) probe.uploadBytes += sizeArg.width * sizeArg.height * 4;
      else if (typeof a[4] === 'number' && typeof a[5] === 'number') probe.uploadBytes += a[4] * a[5] * 4;
      return original.apply(this, a);
    };
  }
  const raf = XRSession.prototype.requestAnimationFrame;
  let last = 0;
  XRSession.prototype.requestAnimationFrame = function (callback) {
    return raf.call(this, (time, frame) => {
      const d0 = probe.draws, u0 = probe.uploads, b0 = probe.uploadBytes;
      const start = performance.now();
      callback(time, frame);
      const cb = performance.now() - start;
      probe.frames.push([time, last ? time - last : 0, cb, probe.draws - d0, probe.uploads - u0, probe.uploadBytes - b0]);
      if (probe.frames.length > 4000) probe.frames.splice(0, 1000);
      last = time;
    });
  };
  return 'installed';
})()`;
console.error(`probe ${await evaluate<string>(install)}`);

const drain = `(() => {
  const p = window.__questProbe; const frames = p.frames; p.frames = [];
  const s = window.__muxXR?.getState?.();
  return { frames, widgets: s?.scene?.widgets ?? null, panes: s?.attached?.length ?? null,
    xr: s?.scene?.xrMode ?? null };
})()`;
const pct = (values: number[], q: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const groupsExpression = `(() => {
  const scene = window.__muxXR?.getThreeScene?.();
  if (!scene) return null;
  const groups = [];
  const panes = scene.children.filter((o) => o.name.startsWith('terminal-panel-'));
  if (panes.length) groups.push('panes');
  for (const o of scene.children) if (o.userData.widgetKind && o.visible) groups.push('widget:' + o.name);
  for (const o of scene.children) if (/^xr-.*-controls$/.test(o.name) && o.visible) groups.push('input:' + o.name);
  if (scene.getObjectByName('xr-workspace-hud')) groups.push('hud');
  groups.push('everything');
  return groups;
})()`;
const hideExpression = (group: string | null): string => `(() => {
  const scene = window.__muxXR.getThreeScene();
  const p = window.__questProbe;
  for (const [object, visible] of p.hidden ?? []) object.visible = visible;
  p.hidden = [];
  const group = ${JSON.stringify(group)};
  if (!group) return 0;
  const hide = (o) => { p.hidden.push([o, o.visible]); o.visible = false; };
  if (group === 'everything') for (const o of scene.children) hide(o);
  else if (group === 'panes') for (const o of scene.children) { if (o.name.startsWith('terminal-panel-')) hide(o); }
  else if (group === 'hud') hide(scene.getObjectByName('xr-workspace-hud'));
  else { const name = group.slice(group.indexOf(':') + 1); const o = scene.getObjectByName(name); if (o) hide(o); }
  return p.hidden.length;
})()`;
const phases: Array<string | null> = [];
if (CYCLE > 0) {
  const groups = await evaluate<string[] | null>(groupsExpression);
  if (!groups) throw new Error('This build has no __muxXR.getThreeScene; serve a build with it');
  for (const group of groups) phases.push(null, group);
  phases.push(null);
  console.error(`cycle: ${groups.join(', ')} (${phases.length * CYCLE} s)`);
}
const phaseStats = new Map<string, number[]>();
let phaseIndex = -1;
let phaseStarted = 0;
let currentPhase: string | null = null;
const restore = () => evaluate<number>(hideExpression(null));
process.on('SIGINT', async () => {
  await restore();
  process.exit(130);
});
if (OUT) writeFileSync(OUT, '');
const deadline = Date.now() + (CYCLE > 0 ? phases.length * CYCLE + 1 : SECONDS) * 1000;
console.log(
  'time      fps  int p50/p95/max ms   cb mean/p95 ms  draws/f  up/f  MiB/s  panes widgets',
);
while (Date.now() < deadline) {
  if (CYCLE > 0 && Date.now() - phaseStarted >= CYCLE * 1000) {
    phaseIndex++;
    if (phaseIndex >= phases.length) break;
    currentPhase = phases[phaseIndex];
    await evaluate<number>(hideExpression(currentPhase));
    phaseStarted = Date.now();
    await evaluate<unknown>('window.__questProbe.frames = []');
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const sample = await evaluate<{
    frames: number[][];
    widgets: string[] | null;
    panes: number | null;
    xr: string | null;
  }>(drain);
  if (!sample) continue;
  const intervals = sample.frames.map((f) => f[1]).filter((v) => v > 0);
  const callbacks = sample.frames.map((f) => f[2]);
  const n = Math.max(1, sample.frames.length);
  const row = {
    at: new Date().toISOString(),
    frames: sample.frames.length,
    intervalP50: pct(intervals, 0.5),
    intervalP95: pct(intervals, 0.95),
    intervalMax: Math.max(0, ...intervals),
    callbackMean: mean(callbacks),
    callbackP95: pct(callbacks, 0.95),
    drawsPerFrame: sample.frames.reduce((a, f) => a + f[3], 0) / n,
    uploadsPerFrame: sample.frames.reduce((a, f) => a + f[4], 0) / n,
    uploadMiBPerSecond: sample.frames.reduce((a, f) => a + f[5], 0) / 1048576,
    panes: sample.panes,
    widgets: sample.widgets,
    xr: sample.xr,
    phase: CYCLE > 0 ? (currentPhase ?? 'full') : undefined,
  };
  // The first second of a phase still holds frames rendered across the switch.
  if (CYCLE > 0 && Date.now() - phaseStarted > 1500)
    phaseStats.set(row.phase ?? 'full', [
      ...(phaseStats.get(row.phase ?? 'full') ?? []),
      ...intervals,
    ]);
  if (OUT) appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  const local = new Date().toLocaleTimeString('en-US', {
    hour12: false,
  });
  console.log(
    `${local} ${String(row.frames).padStart(4)}  ${row.intervalP50.toFixed(1)}/${row.intervalP95.toFixed(1)}/${row.intervalMax.toFixed(1)}`.padEnd(
      36,
    ) +
      `${row.callbackMean.toFixed(2)}/${row.callbackP95.toFixed(2)}`.padEnd(16) +
      `${row.drawsPerFrame.toFixed(0)}`.padStart(7) +
      `${row.uploadsPerFrame.toFixed(1)}`.padStart(6) +
      `${row.uploadMiBPerSecond.toFixed(1)}`.padStart(7) +
      `  ${row.panes ?? '-'} ${(row.widgets ?? []).join(',')}${row.phase ? ` [${row.phase}]` : ''}`,
  );
}
if (CYCLE > 0) {
  await restore();
  const full = mean(phaseStats.get('full') ?? []);
  console.log(
    `\nphase                         mean ms  fps    saved ms vs full (${full.toFixed(2)})`,
  );
  for (const [phase, values] of phaseStats) {
    const m = mean(values);
    console.log(
      `${phase.padEnd(30)}${m.toFixed(2).padStart(7)}${(1000 / Math.max(m, 0.001)).toFixed(1).padStart(6)}${(full - m).toFixed(2).padStart(10)}`,
    );
  }
}
socket.close();
