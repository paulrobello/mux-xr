import * as THREE from 'three';
import { createScalableLabel, updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type SpatialWidget } from './widget';

/** A sample of frame pacing. Send samples at about 2 Hz for a 20-second history. */
export interface PerfSample {
  fps: number | null;
  /** Longest frame interval since the previous sample, in milliseconds; pauses excluded. */
  worstFrameMs: number;
  /** Visible panes, for apps that display them. */
  shownPanes?: number;
  /** Display refresh rate the frame time is judged against. */
  targetHz: number;
}

export type PerfTone = 'good' | 'warn' | 'bad' | 'unknown';

export const PERF_TONE_COLORS: Record<PerfTone, number> = {
  good: 0x5cc49a,
  warn: 0xd9a441,
  bad: 0xd8605a,
  unknown: 0x5d717d,
};

/** Samples in the sparkline; at 2 Hz this is the last 20 seconds. */
export const PERF_HISTORY = 40;

/**
 * A frame interval longer than this is a pause, not a slow frame. Visibility changes mark the
 * known pauses (hidden tab, system menu); this cap only catches ones no event reported, so real
 * freezes of a few seconds still show.
 */
export const PERF_PAUSE_MS = 5000;

export const PERF_GAUGE_WIDTH = 0.46;
export const PERF_GAUGE_HEIGHT = 0.29;

/**
 * Whether a frame interval counts toward the worst-frame stat. Intervals over PERF_PAUSE_MS, any
 * interval ending while the page or XR session is not visible, and any interval spanning a
 * visibility change (`hiddenBefore`) are pauses.
 */
export function countsAsFrame(frameMs: number, hiddenNow: boolean, hiddenBefore: boolean): boolean {
  return Number.isFinite(frameMs) && frameMs <= PERF_PAUSE_MS && !hiddenNow && !hiddenBefore;
}

function toneForRatio(ratio: number): PerfTone {
  if (ratio >= 0.95) return 'good';
  if (ratio >= 0.75) return 'warn';
  return 'bad';
}

/** Within 5% of the target is on pace, within 25% is a visible stutter, past that is bad. */
export function fpsTone(fps: number | null, targetHz: number): PerfTone {
  if (fps === null || !Number.isFinite(fps) || !(targetHz > 0)) return 'unknown';
  return toneForRatio(fps / targetHz);
}

/** The same thresholds for one frame time against the frame budget. */
export function frameTone(frameMs: number, targetHz: number): PerfTone {
  if (!Number.isFinite(frameMs) || frameMs <= 0 || !(targetHz > 0)) return 'unknown';
  return toneForRatio(1000 / targetHz / frameMs);
}

export function formatFps(fps: number | null, targetHz: number): string {
  const target = targetHz > 0 ? Math.round(targetHz) : '--';
  const current = fps === null || !Number.isFinite(fps) ? '--' : Math.round(fps);
  return `${current} / ${target} fps`;
}

export function formatWorstFrame(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'worst (20 s) -- ms';
  return `worst (20 s) ${ms < 100 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

export function formatPanes(count: number): string {
  return `${count} ${count === 1 ? 'pane' : 'panes'} shown`;
}

/** Fixed-capacity ring of worst-frame samples; push never allocates. */
export interface FrameTimeHistory {
  readonly capacity: number;
  readonly count: number;
  push(ms: number): void;
  /** The index-th oldest retained sample. */
  at(index: number): number;
  max(): number;
  clear(): void;
}

export function createFrameTimeHistory(capacity = PERF_HISTORY): FrameTimeHistory {
  const values = new Float32Array(Math.max(1, Math.floor(capacity)));
  let head = 0;
  let count = 0;
  return {
    capacity: values.length,
    get count() {
      return count;
    },
    push(ms) {
      values[head] = Number.isFinite(ms) && ms > 0 ? ms : 0;
      head = (head + 1) % values.length;
      if (count < values.length) count += 1;
    },
    at(index) {
      if (index < 0 || index >= count) return 0;
      return values[(head - count + index + values.length) % values.length];
    },
    max() {
      let worst = 0;
      for (let index = 0; index < count; index += 1) worst = Math.max(worst, this.at(index));
      return worst;
    },
    clear() {
      head = 0;
      count = 0;
    },
  };
}

/**
 * Writes each retained sample's sparkline height into `out` (0..1, oldest first) and returns the
 * sample count. The frame budget lands at the middle, so twice the budget or worse fills the plot.
 */
export function sparklineHeights(
  history: FrameTimeHistory,
  targetHz: number,
  out: Float32Array,
): number {
  const budget = 1000 / (targetHz > 0 ? targetHz : 60);
  const count = Math.min(history.count, out.length);
  const offset = history.count - count;
  for (let index = 0; index < count; index += 1)
    out[index] = THREE.MathUtils.clamp(history.at(offset + index) / (2 * budget), 0, 1);
  return count;
}

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const PLOT_COLOR = 0x0e1a21;
const BUDGET_COLOR = 0x8fa3ae;
const PAD = 0.025;
const TOP = PERF_GAUGE_HEIGHT / 2;
const PLOT_LEFT = -PERF_GAUGE_WIDTH / 2 + PAD;
const PLOT_WIDTH = PERF_GAUGE_WIDTH - PAD * 2;
const PLOT_BOTTOM = -PERF_GAUGE_HEIGHT / 2 + PAD;
const PLOT_HEIGHT = 0.07;
const FPS_Y = 0.05;
const WORST_Y = 0.004;

let nextGaugeId = 1;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

export interface PerfGaugeOptions {
  onClose?: () => void;
}

export interface PerfGaugeWidget extends SpatialWidget {
  setPerfSample(sample: PerfSample): void;
  resetPerf(): void;
}

export function createPerfGaugeWidget(
  envMap: THREE.Texture | null = null,
  options: PerfGaugeOptions = {},
): PerfGaugeWidget {
  const widgetId = `perf-gauge-${nextGaugeId++}`;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(PERF_GAUGE_WIDTH, PERF_GAUGE_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'perf-gauge-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(PERF_GAUGE_WIDTH - 0.035, PERF_GAUGE_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'perf-gauge-face';
  face.position.z = 0.014;
  root.add(body, face);

  const header = createScalableLabel('Performance', 0.22, 0.04, {
    backplate: false,
    align: 'left',
  });
  header.name = 'perf-gauge-header';
  header.position.set(PLOT_LEFT + 0.11, TOP - 0.04, 0.03);
  root.add(header);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'perf-gauge-close';
  close.position.set(PERF_GAUGE_WIDTH / 2 - 0.05 / 2, TOP - 0.05 / 2, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the performance gauge';
  root.add(close);

  // Text is always white (labels.ts), so status is a shape plus a colour: a circle on pace, a
  // warning triangle below it.
  const tone = new THREE.MeshBasicMaterial({ color: PERF_TONE_COLORS.unknown });
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.014, 24), tone);
  dot.name = 'perf-gauge-tone';
  dot.position.set(PLOT_LEFT + 0.016, FPS_Y, 0.03);
  const warning = new THREE.Mesh(new THREE.CircleGeometry(0.019, 3, Math.PI / 2), tone);
  warning.name = 'perf-gauge-warning';
  warning.position.set(PLOT_LEFT + 0.016, FPS_Y - 0.004, 0.03);
  warning.visible = false;
  root.add(dot, warning);

  const FPS_WIDTH = 0.19;
  const fpsLabel = createScalableLabel(formatFps(null, 0), FPS_WIDTH, 0.06, {
    backplate: false,
    align: 'left',
  });
  fpsLabel.name = 'perf-gauge-fps';
  fpsLabel.position.set(PLOT_LEFT + 0.04 + FPS_WIDTH / 2, FPS_Y, 0.03);
  root.add(fpsLabel);

  // One fixed size for both readouts, so their text matches whatever its length.
  // Readable at about 1.5 m: the pane count sits beside the FPS, the worst frame gets a full row.
  const STAT_FONT = 0.022;
  const PANES_WIDTH = 0.2;
  const worstLabel = createScalableLabel(formatWorstFrame(0), PLOT_WIDTH, 0.036, {
    backplate: false,
    align: 'left',
    fontSize: STAT_FONT,
  });
  worstLabel.name = 'perf-gauge-worst';
  worstLabel.position.set(0, WORST_Y, 0.03);
  root.add(worstLabel);

  const panesLabel = createScalableLabel(formatPanes(0), PANES_WIDTH, 0.036, {
    backplate: false,
    align: 'left',
    fontSize: STAT_FONT,
  });
  panesLabel.name = 'perf-gauge-panes';
  panesLabel.position.set(PERF_GAUGE_WIDTH / 2 - PAD - PANES_WIDTH / 2, FPS_Y, 0.03);
  panesLabel.visible = false;
  root.add(panesLabel);

  const plot = new THREE.Mesh(
    new THREE.PlaneGeometry(PLOT_WIDTH, PLOT_HEIGHT),
    new THREE.MeshBasicMaterial({ color: PLOT_COLOR }),
  );
  plot.name = 'perf-gauge-plot';
  plot.position.set(0, PLOT_BOTTOM + PLOT_HEIGHT / 2, 0.028);
  root.add(plot);

  // The frame budget sits at mid-height (see sparklineHeights), drawn over the bars.
  const budget = new THREE.Mesh(
    new THREE.PlaneGeometry(PLOT_WIDTH, 0.002),
    new THREE.MeshBasicMaterial({ color: BUDGET_COLOR, transparent: true, opacity: 0.7 }),
  );
  budget.name = 'perf-gauge-budget';
  budget.position.set(0, PLOT_BOTTOM + PLOT_HEIGHT / 2, 0.032);
  root.add(budget);

  // One bar (four vertices) per sample, each tinted by its own frame time against the budget.
  const positions = new Float32Array(PERF_HISTORY * 4 * 3);
  const colors = new Float32Array(PERF_HISTORY * 4 * 3);
  const step = PLOT_WIDTH / PERF_HISTORY;
  const indices: number[] = [];
  for (let index = 0; index < PERF_HISTORY; index += 1) {
    const left = PLOT_LEFT + index * step + step * 0.1;
    const right = left + step * 0.8;
    positions.set(
      [left, PLOT_BOTTOM, 0, right, PLOT_BOTTOM, 0, left, PLOT_BOTTOM, 0, right, PLOT_BOTTOM, 0],
      index * 12,
    );
    const base = index * 4;
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkPositions = new THREE.BufferAttribute(positions, 3);
  sparkPositions.setUsage(THREE.DynamicDrawUsage);
  const sparkColors = new THREE.BufferAttribute(colors, 3);
  sparkColors.setUsage(THREE.DynamicDrawUsage);
  sparkGeometry.setAttribute('position', sparkPositions);
  sparkGeometry.setAttribute('color', sparkColors);
  sparkGeometry.setIndex(indices);
  sparkGeometry.setDrawRange(0, 0);
  const sparkMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
  });
  const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
  spark.name = 'perf-gauge-sparkline';
  spark.position.z = 0.03;
  // Positions change in place, so the default bounds would go stale.
  spark.frustumCulled = false;
  root.add(spark);

  const toneColors = Object.fromEntries(
    Object.entries(PERF_TONE_COLORS).map(([key, hex]) => [key, new THREE.Color(hex)]),
  ) as Record<PerfTone, THREE.Color>;
  const history = createFrameTimeHistory(PERF_HISTORY);
  const heights = new Float32Array(PERF_HISTORY);
  let disposed = false;

  const setPerfSample = (sample: PerfSample): void => {
    if (disposed) return;
    history.push(sample.worstFrameMs);
    const status = fpsTone(sample.fps, sample.targetHz);
    tone.color.copy(toneColors[status]);
    const below = status === 'warn' || status === 'bad';
    dot.visible = !below;
    warning.visible = below;
    setText(fpsLabel, formatFps(sample.fps, sample.targetHz));
    setText(worstLabel, formatWorstFrame(history.max()));
    panesLabel.visible = sample.shownPanes !== undefined;
    if (sample.shownPanes !== undefined) setText(panesLabel, formatPanes(sample.shownPanes));
    const count = sparklineHeights(history, sample.targetHz, heights);
    // Newest sample at the right edge.
    const first = PERF_HISTORY - count;
    for (let index = first; index < PERF_HISTORY; index += 1) {
      const sampleIndex = index - first;
      const top = PLOT_BOTTOM + Math.max(0.002, heights[sampleIndex] * PLOT_HEIGHT);
      positions[index * 12 + 7] = top;
      positions[index * 12 + 10] = top;
      const color = toneColors[frameTone(history.at(sampleIndex), sample.targetHz)];
      for (let vertex = 0; vertex < 4; vertex += 1) color.toArray(colors, index * 12 + vertex * 3);
    }
    sparkPositions.needsUpdate = true;
    sparkColors.needsUpdate = true;
    sparkGeometry.setDrawRange(first * 6, count * 6);
  };

  const resetPerf = (): void => {
    if (disposed) return;
    history.clear();
    sparkGeometry.setDrawRange(0, 0);
    setText(worstLabel, formatWorstFrame(0));
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = 'perf-gauge';
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  // All work happens in setPerfSample at the scene's frame-counter cadence.
  const update = (): void => undefined;
  return {
    root,
    update,
    dispose,
    setPerfSample,
    resetPerf,
    activate(target) {
      if (!disposed && target === close) options.onClose?.();
    },
  };
}
