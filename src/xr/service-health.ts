import * as THREE from 'three';
import { defaultHostFeedSource, type HostFeedFailure, type HostFeedSource } from '../host-feed';
import { createFeedPoller, FEED_FAILURE_TEXT, isWidgetShown } from './feed-poller';
import { createScalableLabel, updateScalableLabel } from './labels';
import { PERF_TONE_COLORS } from './perf-gauge';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const SERVICE_HEALTH_KIND = 'service-health';
export const SERVICE_HEALTH_PATH = '/service-health';
export const SERVICE_HEALTH_PROTOCOL = 'mux-xr-service-health-v1';
/** par-obs probes run every 60 s. */
export const SERVICE_HEALTH_POLL_MS = 60_000;
export const SERVICE_HEALTH_MAX_ROWS = 8;

export type ProbeState = 'up' | 'down' | 'expected-down';

export interface ServiceProbe {
  host: string;
  service: string;
  state: ProbeState;
  /** Milliseconds in this state when the streamer queried par-obs. */
  ageMs: number;
  /** False when the streamer has not seen a change, so the age is only a lower bound. */
  exact: boolean;
}

export interface ServiceHealth {
  probes: ServiceProbe[];
  down: number;
  /** Headset clock when the answer arrived; ages count on from here. */
  receivedAt: number;
}

const MAX_TEXT = 48;
const visible = (value: unknown): string =>
  typeof value === 'string'
    ? Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, ' '))
        .slice(0, MAX_TEXT)
        .join('')
        .trim()
    : '';
const STATES: readonly ProbeState[] = ['up', 'down', 'expected-down'];

/**
 * Rebuilds the server's answer field by field. Ages are taken against the streamer's own query
 * time, so a headset clock that disagrees with the Mac's does not skew them.
 */
export function parseServiceHealth(
  data: unknown,
  receivedAt: number = Date.now(),
): ServiceHealth | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (typeof value.now !== 'number' || !Number.isFinite(value.now) || !Array.isArray(value.probes))
    return null;
  const serverNow = value.now;
  const probes: ServiceProbe[] = [];
  for (const row of value.probes) {
    if (!row || typeof row !== 'object') continue;
    const probe = row as Record<string, unknown>;
    const host = visible(probe.host);
    const service = visible(probe.service);
    const state = probe.state as ProbeState;
    if (!host || !service || !STATES.includes(state)) continue;
    const since =
      typeof probe.since === 'number' && Number.isFinite(probe.since) ? probe.since : null;
    probes.push({
      host,
      service,
      state,
      ageMs: since === null ? 0 : Math.max(0, serverNow - since),
      exact: since !== null && probe.sinceExact === true,
    });
  }
  return {
    probes,
    down: probes.filter((probe) => probe.state === 'down').length,
    receivedAt,
  };
}

export type ServiceHealthModel =
  | { kind: 'loading' }
  | { kind: 'failed'; code: HostFeedFailure }
  | { kind: 'health'; health: ServiceHealth };

const FAILURE_TEXT: Record<HostFeedFailure, string> = {
  ...FEED_FAILURE_TEXT,
  disabled: 'Service health is off on the host',
  'not-configured': 'par-obs token not set up on the host',
  upstream: 'par-obs unreachable from the host',
};

export type HealthTone = 'good' | 'bad' | 'unknown';

export interface ServiceHealthRow {
  label: string;
  state: ProbeState;
  stateText: string;
  age: string;
}

export interface ServiceHealthView {
  header: string;
  /** Red when a probe is down, green when all are up, grey when unknown. */
  tone: HealthTone;
  message: string;
  rows: ServiceHealthRow[];
  hidden: number;
}

/** `5m`, `2h 10m` or `3d`, with `≥` when the streamer only knows it has been at least that long. */
export function formatAge(ms: number, exact = true): string {
  const minutes = Math.floor(ms / 60_000);
  const text =
    minutes < 1
      ? '<1m'
      : minutes < 60
        ? `${minutes}m`
        : minutes < 24 * 60
          ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
          : `${Math.floor(minutes / (24 * 60))}d`;
  return exact ? text : `≥${text === '<1m' ? '1m' : text}`;
}

const STATE_TEXT: Record<ProbeState, string> = {
  up: 'up',
  down: 'down',
  'expected-down': 'canary',
};

export function serviceHealthView(model: ServiceHealthModel, nowMs: number): ServiceHealthView {
  const quiet = (message: string, tone: HealthTone = 'unknown'): ServiceHealthView => ({
    header: 'Service health',
    tone,
    message,
    rows: [],
    hidden: 0,
  });
  if (model.kind === 'loading') return quiet('Checking…');
  if (model.kind === 'failed') return quiet(FAILURE_TEXT[model.code]);
  const { health } = model;
  if (!health.probes.length) return quiet('No probes reporting');
  const elapsed = Math.max(0, nowMs - health.receivedAt);
  const rows = health.probes.slice(0, SERVICE_HEALTH_MAX_ROWS).map((probe) => ({
    label: `${probe.service} · ${probe.host}`,
    state: probe.state,
    stateText: STATE_TEXT[probe.state],
    age: formatAge(probe.ageMs + elapsed, probe.exact),
  }));
  const up = health.probes.filter((probe) => probe.state === 'up').length;
  return {
    header: health.down ? `Service health · ${health.down} down` : `Service health · ${up} up`,
    tone: health.down ? 'bad' : 'good',
    message: '',
    rows,
    hidden: health.probes.length - rows.length,
  };
}

export const SERVICE_STATE_COLORS: Record<ProbeState, number> = {
  up: PERF_TONE_COLORS.good,
  down: PERF_TONE_COLORS.bad,
  'expected-down': PERF_TONE_COLORS.unknown,
};

const WIDTH = 0.7;
const PAD = 0.03;
const HEADER_HEIGHT = 0.065;
const ROW_PITCH = 0.052;
const ROW_TEXT = 0.038;
const FOOTER_HEIGHT = 0.045;
export const SERVICE_HEALTH_WIDTH = WIDTH;
export const SERVICE_HEALTH_HEIGHT =
  0.04 + HEADER_HEIGHT + SERVICE_HEALTH_MAX_ROWS * ROW_PITCH + FOOTER_HEIGHT;
const TOP = SERVICE_HEALTH_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT;
const FONT = 0.021;
const LEFT = -WIDTH / 2 + PAD;
const TONE_X = LEFT + 0.012;
const LABEL = { x: LEFT + 0.03, width: 0.42 };
const STATE = { x: LABEL.x + LABEL.width + 0.005, width: 0.085 };
const AGE = { x: STATE.x + STATE.width, width: WIDTH / 2 - PAD - (STATE.x + STATE.width) };

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;

let nextServiceHealthId = 1;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

function cell(text: string, column: { x: number; width: number }, y: number): THREE.Mesh {
  const label = createScalableLabel(text, column.width, ROW_TEXT, {
    backplate: false,
    align: 'left',
    fontSize: FONT,
  });
  label.position.set(column.x + column.width / 2, y, 0.03);
  return label;
}

interface Slot {
  up: THREE.Mesh;
  down: THREE.Mesh;
  canary: THREE.Mesh;
  label: THREE.Mesh;
  state: THREE.Mesh;
  age: THREE.Mesh;
  parts: THREE.Object3D[];
}

export interface ServiceHealthWidgetOptions {
  source?: HostFeedSource<ServiceHealth>;
  pollMs?: number;
  retryStore?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  now?: () => number;
  firstPollDelayMs?: number;
}

export function createServiceHealthWidget(
  envMap: THREE.Texture | null = null,
  options: ServiceHealthWidgetOptions = {},
): Widget {
  const widgetId = `${SERVICE_HEALTH_KIND}-${nextServiceHealthId++}`;
  const clock = options.now ?? Date.now;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, SERVICE_HEALTH_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'service-health-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.035, SERVICE_HEALTH_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'service-health-face';
  face.position.z = 0.014;
  root.add(body, face);

  // Text is always white (labels.ts), so the alarm is the band behind the header.
  const bandMaterial = new THREE.MeshBasicMaterial({ color: PERF_TONE_COLORS.unknown });
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH - PAD * 2, HEADER_HEIGHT * 0.9),
    bandMaterial,
  );
  band.name = 'service-health-band';
  band.position.set(0, TOP - 0.02 - HEADER_HEIGHT / 2, 0.028);
  root.add(band);

  const HEADER_WIDTH = WIDTH - PAD * 2 - 0.07;
  const header = createScalableLabel('Service health', HEADER_WIDTH, HEADER_HEIGHT * 0.7, {
    backplate: false,
    align: 'left',
  });
  header.name = 'service-health-header';
  header.position.set(LEFT + 0.01 + HEADER_WIDTH / 2, TOP - 0.02 - HEADER_HEIGHT / 2, 0.03);
  root.add(header);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'service-health-close';
  close.position.set(WIDTH / 2 - 0.045, TOP - 0.045, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close service health';
  root.add(close);

  const message = createScalableLabel('', WIDTH - PAD * 2, ROW_TEXT, {
    backplate: false,
    fontSize: FONT,
  });
  message.name = 'service-health-message';
  message.position.set(0, ROWS_TOP - ROW_PITCH * 1.5, 0.03);
  root.add(message);

  const overflow = createScalableLabel('', WIDTH * 0.4, FOOTER_HEIGHT * 0.8, {
    backplate: false,
    fontSize: FONT,
  });
  overflow.name = 'service-health-overflow';
  overflow.position.set(
    0,
    ROWS_TOP - SERVICE_HEALTH_MAX_ROWS * ROW_PITCH - FOOTER_HEIGHT / 2,
    0.03,
  );
  overflow.visible = false;
  root.add(overflow);

  // Status is a shape plus a colour: a dot for up, a triangle for down, a square for a canary.
  const stateMaterials: Record<ProbeState, THREE.MeshBasicMaterial> = {
    up: new THREE.MeshBasicMaterial({ color: SERVICE_STATE_COLORS.up }),
    down: new THREE.MeshBasicMaterial({ color: SERVICE_STATE_COLORS.down }),
    'expected-down': new THREE.MeshBasicMaterial({ color: SERVICE_STATE_COLORS['expected-down'] }),
  };
  const upGeometry = new THREE.CircleGeometry(0.011, 20);
  const downGeometry = new THREE.CircleGeometry(0.015, 3, Math.PI / 2);
  const canaryGeometry = new THREE.PlaneGeometry(0.018, 0.018);

  const slots: Slot[] = [];
  for (let index = 0; index < SERVICE_HEALTH_MAX_ROWS; index += 1) {
    const y = ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2;
    const prefix = `service-health-row-${index + 1}`;
    const up = new THREE.Mesh(upGeometry, stateMaterials.up);
    up.name = `${prefix}-up`;
    up.position.set(TONE_X, y, 0.03);
    const down = new THREE.Mesh(downGeometry, stateMaterials.down);
    down.name = `${prefix}-down`;
    down.position.set(TONE_X, y - 0.003, 0.03);
    const canary = new THREE.Mesh(canaryGeometry, stateMaterials['expected-down']);
    canary.name = `${prefix}-canary`;
    canary.position.set(TONE_X, y, 0.03);
    canary.userData.helpText = 'Expected down: a red-path canary';
    const label = cell('', LABEL, y);
    label.name = `${prefix}-label`;
    const state = cell('', STATE, y);
    state.name = `${prefix}-state`;
    const age = cell('', AGE, y);
    age.name = `${prefix}-age`;
    age.userData.helpText = 'Time since the state last changed';
    const parts = [up, down, canary, label, state, age];
    for (const part of parts) part.visible = false;
    root.add(...parts);
    slots.push({ up, down, canary, label, state, age, parts });
  }

  let disposed = false;
  let model: ServiceHealthModel = { kind: 'loading' };
  let lastMinute = -1;

  const render = (nowMs: number): void => {
    lastMinute = Math.floor(nowMs / 60_000);
    const view = serviceHealthView(model, nowMs);
    setText(header, view.header);
    bandMaterial.color.setHex(PERF_TONE_COLORS[view.tone]);
    band.userData.tone = view.tone;
    message.visible = view.message !== '';
    setText(message, view.message);
    overflow.visible = view.hidden > 0;
    if (view.hidden > 0) setText(overflow, `+${view.hidden} more`);
    slots.forEach((slot, index) => {
      const row = view.rows[index];
      for (const part of slot.parts) part.visible = Boolean(row);
      if (!row) return;
      slot.up.visible = row.state === 'up';
      slot.down.visible = row.state === 'down';
      slot.canary.visible = row.state === 'expected-down';
      setText(slot.label, row.label);
      slot.label.userData.helpText = row.label;
      setText(slot.state, row.stateText);
      setText(slot.age, row.age);
    });
  };

  const poller = createFeedPoller<ServiceHealth>({
    source:
      options.source ??
      defaultHostFeedSource(SERVICE_HEALTH_PATH, SERVICE_HEALTH_PROTOCOL, (data) =>
        parseServiceHealth(data, clock()),
      ),
    pollMs: options.pollMs ?? SERVICE_HEALTH_POLL_MS,
    retryStore: options.retryStore,
    now: options.now,
    firstPollDelayMs: options.firstPollDelayMs,
    onResult: (result) => {
      if (disposed) return;
      model = result.ok
        ? { kind: 'health', health: result.value }
        : { kind: 'failed', code: result.code };
      render(clock());
    },
  });

  // Polls only from the scene's frame loop; ages tick on once a minute.
  const update = (nowMs: number): void => {
    if (disposed) return;
    poller.update(nowMs, isWidgetShown(root), '{}');
    if (Math.floor(nowMs / 60_000) !== lastMinute) render(nowMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    poller.dispose();
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = SERVICE_HEALTH_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  render(clock());
  return { root, update, dispose };
}
