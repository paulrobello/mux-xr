import * as THREE from 'three';
import type { TerminalStatus } from '../contracts';
import type { TerminalLinkStats } from '../terminal/link-stats';
import { createScalableLabel, updateScalableLabel } from './labels';
import { PERF_TONE_COLORS, type PerfTone } from './perf-gauge';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

/** One pane's stream as the scene reports it each sample. */
export interface StreamLinkInput {
  paneId: string;
  label: string;
  status: TerminalStatus;
  stats: Readonly<TerminalLinkStats> | undefined;
}

export interface StreamHealthRow {
  paneId: string;
  label: string;
  status: TerminalStatus;
  /** How long the pane has held its current status. */
  statusForMs: number;
  /** Received kilobytes per second over the rate window; null until two samples span time. */
  kbps: number | null;
  rttMs: number | null;
  reconnects: number;
  resyncs: number;
  missedPings: number;
  tone: PerfTone;
}

/** The scene samples streams this often while a stream health widget is open. */
export const STREAM_HEALTH_SAMPLE_MS = 1000;
export const STREAM_HEALTH_RATE_WINDOW_MS = 10_000;
/** Reconnects, resyncs and missed pings count over this window. */
export const STREAM_HEALTH_EVENT_WINDOW_MS = 5 * 60_000;
export const STREAM_HEALTH_SLOW_RTT_MS = 200;
/** A pane out of `connected` this long is bad rather than briefly reconnecting. */
export const STREAM_HEALTH_STUCK_MS = 5000;
export const STREAM_HEALTH_MAX_ROWS = 4;

interface Snapshot {
  at: number;
  bytes: number;
  reconnects: number;
  resyncs: number;
  missedPings: number;
}

interface PaneHistory {
  snapshots: Snapshot[];
  status: TerminalStatus;
  since: number;
}

export function streamTone(
  row: Omit<StreamHealthRow, 'tone' | 'paneId' | 'label' | 'kbps'>,
): PerfTone {
  if (row.status === 'exited') return 'unknown';
  if (row.status !== 'connected') return row.statusForMs >= STREAM_HEALTH_STUCK_MS ? 'bad' : 'warn';
  if (row.reconnects >= 2 || row.missedPings >= 2) return 'bad';
  if (
    row.reconnects > 0 ||
    row.missedPings > 0 ||
    row.resyncs > 0 ||
    (row.rttMs !== null && row.rttMs > STREAM_HEALTH_SLOW_RTT_MS)
  )
    return 'warn';
  return 'good';
}

const TONE_ORDER: Record<PerfTone, number> = { bad: 0, warn: 1, unknown: 2, good: 3 };

/** Per-pane windows over cumulative link counters; panes missing from a sample are dropped. */
export function createStreamHealthTracker(): {
  sample(nowMs: number, inputs: readonly StreamLinkInput[]): StreamHealthRow[];
  clear(): void;
} {
  const panes = new Map<string, PaneHistory>();
  return {
    sample(nowMs, inputs) {
      const seen = new Set<string>();
      const rows: StreamHealthRow[] = [];
      for (const input of inputs) {
        seen.add(input.paneId);
        let history = panes.get(input.paneId);
        if (!history) {
          history = { snapshots: [], status: input.status, since: nowMs };
          panes.set(input.paneId, history);
        } else if (history.status !== input.status) {
          history.status = input.status;
          history.since = nowMs;
        }
        const stats = input.stats;
        const { snapshots } = history;
        if (stats)
          snapshots.push({
            at: nowMs,
            bytes: stats.bytesReceived,
            reconnects: stats.reconnects,
            resyncs: stats.resyncs,
            missedPings: stats.missedPings,
          });
        while (snapshots.length > 1 && nowMs - snapshots[0].at > STREAM_HEALTH_EVENT_WINDOW_MS)
          snapshots.shift();
        const newest = snapshots[snapshots.length - 1];
        const oldest = snapshots[0];
        let rateBase: Snapshot | undefined;
        for (const snapshot of snapshots)
          if (nowMs - snapshot.at <= STREAM_HEALTH_RATE_WINDOW_MS) {
            rateBase = snapshot;
            break;
          }
        const span = newest && rateBase ? newest.at - rateBase.at : 0;
        const kbps =
          newest && rateBase && span > 0
            ? (newest.bytes - rateBase.bytes) / 1024 / (span / 1000)
            : null;
        const delta = (key: 'reconnects' | 'resyncs' | 'missedPings'): number =>
          newest && oldest ? Math.max(0, newest[key] - oldest[key]) : 0;
        const base = {
          status: input.status,
          statusForMs: nowMs - history.since,
          rttMs: input.status === 'connected' ? (stats?.rttMs ?? null) : null,
          reconnects: delta('reconnects'),
          resyncs: delta('resyncs'),
          missedPings: delta('missedPings'),
        };
        rows.push({
          ...base,
          paneId: input.paneId,
          label: input.label,
          kbps: input.status === 'connected' ? kbps : null,
          tone: streamTone(base),
        });
      }
      for (const id of panes.keys()) if (!seen.has(id)) panes.delete(id);
      return rows.sort(
        (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.label.localeCompare(b.label),
      );
    },
    clear() {
      panes.clear();
    },
  };
}

export function formatRate(kbps: number | null): string {
  if (kbps === null || !Number.isFinite(kbps)) return '-- kB/s';
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${kbps < 10 ? kbps.toFixed(1) : Math.round(kbps)} kB/s`;
}

export function formatRtt(ms: number | null): string {
  return ms === null || !Number.isFinite(ms) ? '-- ms' : `${Math.round(ms)} ms`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`;
}

/** Reconnects, resyncs and missed pings, in the column header's order. */
export function formatEvents(row: StreamHealthRow): string {
  return `${row.reconnects} · ${row.resyncs} · ${row.missedPings}`;
}

const WIDTH = 0.8;
const PAD = 0.03;
const HEADER_HEIGHT = 0.065;
const COLUMNS_HEIGHT = 0.04;
const ROW_PITCH = 0.058;
const ROW_TEXT = 0.04;
const FOOTER_HEIGHT = 0.045;
export const STREAM_HEALTH_WIDTH = WIDTH;
export const STREAM_HEALTH_HEIGHT =
  0.04 + HEADER_HEIGHT + COLUMNS_HEIGHT + STREAM_HEALTH_MAX_ROWS * ROW_PITCH + FOOTER_HEIGHT;
const TOP = STREAM_HEALTH_HEIGHT / 2;
const COLUMNS_Y = TOP - 0.02 - HEADER_HEIGHT - COLUMNS_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT - COLUMNS_HEIGHT;
const FONT = 0.022;
const COLUMN_FONT = 0.018;
const LABEL_CHARACTERS = 22;

// Left edge and width of each column, from the face's left edge.
const LEFT = -WIDTH / 2 + PAD;
const TONE_X = LEFT + 0.014;
const NAME = { x: LEFT + 0.035, width: 0.28 };
const RATE = { x: NAME.x + NAME.width, width: 0.14 };
const RTT = { x: RATE.x + RATE.width, width: 0.11 };
const EVENTS = { x: RTT.x + RTT.width, width: 0.17 };

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;

let nextWidgetId = 1;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

function clip(text: string): string {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length <= LABEL_CHARACTERS
    ? characters.join('')
    : `${characters.slice(0, LABEL_CHARACTERS - 1).join('')}…`;
}

function cell(
  text: string,
  column: { x: number; width: number },
  y: number,
  font = FONT,
): THREE.Mesh {
  const label = createScalableLabel(text, column.width, ROW_TEXT, {
    backplate: false,
    align: 'left',
    fontSize: font,
  });
  label.position.set(column.x + column.width / 2, y, 0.03);
  return label;
}

interface Slot {
  dot: THREE.Mesh;
  warning: THREE.Mesh;
  name: THREE.Mesh;
  rate: THREE.Mesh;
  rtt: THREE.Mesh;
  events: THREE.Mesh;
  parts: THREE.Object3D[];
}

export function createStreamHealthWidget(envMap: THREE.Texture | null = null): Widget {
  const widgetId = `stream-health-${nextWidgetId++}`;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, STREAM_HEALTH_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'stream-health-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.035, STREAM_HEALTH_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'stream-health-face';
  face.position.z = 0.014;
  root.add(body, face);

  const header = createScalableLabel('Stream health', 0.32, HEADER_HEIGHT * 0.75, {
    backplate: false,
    align: 'left',
  });
  header.name = 'stream-health-header';
  header.position.set(LEFT + 0.16, TOP - 0.02 - HEADER_HEIGHT / 2, 0.03);
  root.add(header);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'stream-health-close';
  close.position.set(WIDTH / 2 - 0.045, TOP - 0.045, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close stream health';
  root.add(close);

  const columns = [
    cell('Pane', NAME, COLUMNS_Y, COLUMN_FONT),
    cell('Rate', RATE, COLUMNS_Y, COLUMN_FONT),
    cell('RTT', RTT, COLUMNS_Y, COLUMN_FONT),
    cell('Recon · Resync · Miss', EVENTS, COLUMNS_Y, COLUMN_FONT),
  ];
  for (const [index, label] of columns.entries()) {
    label.name = `stream-health-column-${index + 1}`;
    label.userData.helpText =
      index === 3 ? 'Reconnects, resync frames and missed pings in the last 5 minutes' : undefined;
    root.add(label);
  }

  const empty = createScalableLabel('No pane streams', WIDTH * 0.6, ROW_TEXT, { backplate: false });
  empty.name = 'stream-health-empty';
  empty.position.set(0, ROWS_TOP - ROW_PITCH * 1.5, 0.03);
  root.add(empty);

  const overflow = createScalableLabel('', WIDTH * 0.4, FOOTER_HEIGHT * 0.8, { backplate: false });
  overflow.name = 'stream-health-overflow';
  overflow.position.set(0, ROWS_TOP - STREAM_HEALTH_MAX_ROWS * ROW_PITCH - FOOTER_HEIGHT / 2, 0.03);
  overflow.visible = false;
  root.add(overflow);

  // Text is always white (labels.ts), so tone is a shape plus a colour, as on the perf gauge.
  const toneMaterials = Object.fromEntries(
    Object.entries(PERF_TONE_COLORS).map(([tone, color]) => [
      tone,
      new THREE.MeshBasicMaterial({ color }),
    ]),
  ) as Record<PerfTone, THREE.MeshBasicMaterial>;
  const dotGeometry = new THREE.CircleGeometry(0.011, 20);
  const warningGeometry = new THREE.CircleGeometry(0.015, 3, Math.PI / 2);

  const slots: Slot[] = [];
  for (let index = 0; index < STREAM_HEALTH_MAX_ROWS; index += 1) {
    const y = ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2;
    const dot = new THREE.Mesh(dotGeometry, toneMaterials.unknown);
    dot.name = `stream-health-row-${index + 1}-tone`;
    dot.position.set(TONE_X, y, 0.03);
    const warning = new THREE.Mesh(warningGeometry, toneMaterials.warn);
    warning.name = `stream-health-row-${index + 1}-warning`;
    warning.position.set(TONE_X, y - 0.003, 0.03);
    const name = cell('', NAME, y);
    name.name = `stream-health-row-${index + 1}-name`;
    const rate = cell('', RATE, y);
    rate.name = `stream-health-row-${index + 1}-rate`;
    const rtt = cell('', RTT, y);
    rtt.name = `stream-health-row-${index + 1}-rtt`;
    const events = cell('', EVENTS, y);
    events.name = `stream-health-row-${index + 1}-events`;
    const parts = [dot, warning, name, rate, rtt, events];
    for (const part of parts) part.visible = false;
    root.add(...parts);
    slots.push({ dot, warning, name, rate, rtt, events, parts });
  }

  const tracker = createStreamHealthTracker();
  let disposed = false;

  const setStreamLinks = (inputs: readonly StreamLinkInput[], nowMs: number): void => {
    if (disposed) return;
    const rows = tracker.sample(nowMs, inputs);
    empty.visible = rows.length === 0;
    const hidden = rows.length - STREAM_HEALTH_MAX_ROWS;
    overflow.visible = hidden > 0;
    if (hidden > 0) setText(overflow, `+${hidden} more`);
    const bad = rows.filter((row) => row.tone === 'bad').length;
    setText(header, bad ? `Stream health · ${bad} bad` : 'Stream health');
    slots.forEach((slot, index) => {
      const row = rows[index];
      for (const part of slot.parts) part.visible = Boolean(row);
      if (!row) return;
      const below = row.tone === 'warn' || row.tone === 'bad';
      slot.dot.visible = !below;
      slot.warning.visible = below;
      slot.dot.material = toneMaterials[row.tone];
      slot.warning.material = toneMaterials[row.tone];
      setText(slot.name, clip(row.label));
      const connected = row.status === 'connected';
      setText(slot.rate, connected ? formatRate(row.kbps) : row.status);
      setText(slot.rtt, connected ? formatRtt(row.rttMs) : formatDuration(row.statusForMs));
      setText(slot.events, formatEvents(row));
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    tracker.clear();
    disposeOwned(root);
    // Rows swap tone materials, so ones not on a mesh right now would escape disposeOwned.
    for (const material of Object.values(toneMaterials)) material.dispose();
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = 'stream-health';
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  // All work happens in setStreamLinks at the scene's sample cadence.
  const update = (): void => undefined;
  return { root, update, dispose, setStreamLinks };
}
