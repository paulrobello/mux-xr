import * as THREE from 'three';
import { createHostClipboardSecretStore } from '../host-clipboard';
import {
  createHostStatsClient,
  dictationServiceUrl,
  type HostStatsFailure,
  type HostStatsResult,
  type HostStatsSnapshot,
  type HostStatsSource,
} from '../host-stats';
import { createScalableLabel, updateScalableLabel } from './labels';
import { PERF_TONE_COLORS } from './perf-gauge';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export type HostLoadTone = 'ok' | 'warn' | 'critical' | 'unknown';

/** The fleet's host load rule: a 1-minute load above 15 is too busy for load-sensitive work. */
export const HOST_LOAD_WARN = 15;
export const HOST_LOAD_CRITICAL = 30;
export const HOST_CPU_WARN = 75;
export const HOST_CPU_CRITICAL = 90;
export const HOST_LOAD_POLL_MS = 5_000;
/**
 * After a rejected secret, wait out the server's 60 s auth-failure window, which it shares with the
 * clipboard route, so polling never locks out Paste host or hides the rejection behind a 429.
 */
export const HOST_LOAD_AUTH_RETRY_MS = 65_000;
export const HOST_LOAD_RATE_LIMIT_RETRY_MS = 15_000;
/** sessionStorage key holding the rejected-secret retry deadline (epoch ms) across reloads. */
export const HOST_LOAD_AUTH_RETRY_KEY = 'mux-xr.host-load-auth-retry-at';

type RetryStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserSessionStorage = (): RetryStore | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

export const HOST_LOAD_TONE_COLORS: Record<HostLoadTone, number> = {
  ok: PERF_TONE_COLORS.good,
  warn: PERF_TONE_COLORS.warn,
  critical: PERF_TONE_COLORS.bad,
  unknown: PERF_TONE_COLORS.unknown,
};

export const HOST_LOAD_WIDTH = 0.46;
export const HOST_LOAD_HEIGHT = 0.25;

const TONE_RANK: Record<HostLoadTone, number> = { unknown: 0, ok: 1, warn: 2, critical: 3 };

export function loadTone(load: number): HostLoadTone {
  if (!Number.isFinite(load) || load < 0) return 'unknown';
  if (load > HOST_LOAD_CRITICAL) return 'critical';
  if (load > HOST_LOAD_WARN) return 'warn';
  return 'ok';
}

export function cpuTone(cpu: number | null): HostLoadTone {
  if (cpu === null || !Number.isFinite(cpu)) return 'unknown';
  if (cpu >= HOST_CPU_CRITICAL) return 'critical';
  if (cpu >= HOST_CPU_WARN) return 'warn';
  return 'ok';
}

/** The worse of the 1-minute load and CPU tones; an unmeasured CPU defers to the load. */
export function hostTone(stats: HostStatsSnapshot): HostLoadTone {
  const load = loadTone(stats.load[0]);
  const cpu = cpuTone(stats.cpu);
  return TONE_RANK[cpu] > TONE_RANK[load] ? cpu : load;
}

const loadNumber = (value: number): string => (value < 100 ? value.toFixed(2) : value.toFixed(0));

export function formatLoad(stats: HostStatsSnapshot): string {
  return `load ${loadNumber(stats.load[0])}`;
}

export function formatLoadTrend(stats: HostStatsSnapshot): string {
  return `5m ${loadNumber(stats.load[1])}  15m ${loadNumber(stats.load[2])}  ${stats.cores} cores`;
}

export function formatCpu(cpu: number | null): string {
  return cpu === null || !Number.isFinite(cpu) ? 'CPU --%' : `CPU ${Math.round(cpu)}%`;
}

export const HOST_LOAD_UNAVAILABLE: Record<HostStatsFailure, string> = {
  'no-secret': 'Not paired: Settings > Host clipboard',
  disabled: 'No pairing secret on the host',
  auth: 'Host rejected the pairing secret',
  unavailable: 'Host stats unreachable (port 4242)',
  timeout: 'Host stats timed out',
  'rate-limited': 'Host stats busy, retrying',
};

/** The browser's connection to the dictation server, with the host clipboard pairing secret. */
export function defaultHostStatsSource(): HostStatsSource {
  let client: HostStatsSource | undefined;
  return () => {
    client ??= createHostStatsClient({
      url: () => dictationServiceUrl('/host-stats', window.location),
      secret: createHostClipboardSecretStore().get,
    });
    return client();
  };
}

export interface HostLoadWidgetOptions {
  source?: HostStatsSource;
  pollMs?: number;
  /** Where the rejected-secret deadline survives a reload; sessionStorage by default. */
  retryStore?: () => RetryStore | undefined;
  /** Clock for the stored deadline; the scene passes Date.now() to update, so they agree. */
  now?: () => number;
}

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const BAR_TRACK_COLOR = 0x0e1a21;
const WARN_MARK_COLOR = 0x8fa3ae;
const PAD = 0.025;
const TOP = HOST_LOAD_HEIGHT / 2;
const LEFT = -HOST_LOAD_WIDTH / 2 + PAD;
const INNER_WIDTH = HOST_LOAD_WIDTH - PAD * 2;
const LOAD_Y = 0.028;
const TREND_Y = -0.018;
const CPU_Y = -0.072;
const CPU_LABEL_WIDTH = 0.12;
const BAR_HEIGHT = 0.022;
const BAR_LEFT = LEFT + CPU_LABEL_WIDTH + 0.01;
const BAR_WIDTH = HOST_LOAD_WIDTH / 2 - PAD - BAR_LEFT;
const STAT_FONT = 0.022;

let nextHostLoadId = 1;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

function isShown(object: THREE.Object3D): boolean {
  if (!object.parent) return false;
  for (let current: THREE.Object3D | null = object; current; current = current.parent)
    if (!current.visible || current.userData.focusHidden) return false;
  return true;
}

export function createHostLoadWidget(
  envMap: THREE.Texture | null = null,
  options: HostLoadWidgetOptions = {},
): Widget {
  const source = options.source ?? defaultHostStatsSource();
  const pollMs = options.pollMs ?? HOST_LOAD_POLL_MS;
  const retryStore = options.retryStore ?? browserSessionStorage;
  const clock = options.now ?? Date.now;
  const widgetId = `host-load-${nextHostLoadId++}`;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(HOST_LOAD_WIDTH, HOST_LOAD_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'host-load-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(HOST_LOAD_WIDTH - 0.035, HOST_LOAD_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'host-load-face';
  face.position.z = 0.014;
  root.add(body, face);

  const header = createScalableLabel('Host load', 0.22, 0.04, { backplate: false, align: 'left' });
  header.name = 'host-load-header';
  header.position.set(LEFT + 0.11, TOP - 0.04, 0.03);
  root.add(header);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'host-load-close';
  close.position.set(HOST_LOAD_WIDTH / 2 - 0.04, TOP - 0.04, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the host load meter';
  root.add(close);

  // Text is always white (labels.ts), so status is a shape plus a colour, as on the perf gauge.
  const tone = new THREE.MeshBasicMaterial({ color: HOST_LOAD_TONE_COLORS.unknown });
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.014, 24), tone);
  dot.name = 'host-load-tone';
  dot.position.set(LEFT + 0.016, LOAD_Y, 0.03);
  const warning = new THREE.Mesh(new THREE.CircleGeometry(0.019, 3, Math.PI / 2), tone);
  warning.name = 'host-load-warning';
  warning.position.set(LEFT + 0.016, LOAD_Y - 0.004, 0.03);
  warning.visible = false;
  root.add(dot, warning);

  const LOAD_WIDTH = INNER_WIDTH - 0.04;
  const loadLabel = createScalableLabel('Connecting…', LOAD_WIDTH, 0.06, {
    backplate: false,
    align: 'left',
  });
  loadLabel.name = 'host-load-value';
  loadLabel.position.set(LEFT + 0.04 + LOAD_WIDTH / 2, LOAD_Y, 0.03);
  root.add(loadLabel);

  const trendLabel = createScalableLabel(' ', INNER_WIDTH, 0.036, {
    backplate: false,
    align: 'left',
    fontSize: STAT_FONT,
  });
  trendLabel.name = 'host-load-trend';
  trendLabel.position.set(0, TREND_Y, 0.03);
  root.add(trendLabel);

  const cpuLabel = createScalableLabel(formatCpu(null), CPU_LABEL_WIDTH, 0.036, {
    backplate: false,
    align: 'left',
    fontSize: STAT_FONT,
  });
  cpuLabel.name = 'host-load-cpu';
  cpuLabel.position.set(LEFT + CPU_LABEL_WIDTH / 2, CPU_Y, 0.03);
  root.add(cpuLabel);

  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT),
    new THREE.MeshBasicMaterial({ color: BAR_TRACK_COLOR }),
  );
  track.name = 'host-load-cpu-track';
  track.position.set(BAR_LEFT + BAR_WIDTH / 2, CPU_Y, 0.028);
  root.add(track);

  const barMaterial = new THREE.MeshBasicMaterial({ color: HOST_LOAD_TONE_COLORS.unknown });
  const barGeometry = new THREE.PlaneGeometry(1, BAR_HEIGHT);
  barGeometry.translate(0.5, 0, 0);
  const bar = new THREE.Mesh(barGeometry, barMaterial);
  bar.name = 'host-load-cpu-bar';
  bar.position.set(BAR_LEFT, CPU_Y, 0.03);
  bar.scale.x = 0.0001;
  root.add(bar);

  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.002, BAR_HEIGHT + 0.008),
    new THREE.MeshBasicMaterial({ color: WARN_MARK_COLOR, transparent: true, opacity: 0.7 }),
  );
  mark.name = 'host-load-cpu-warn-mark';
  mark.position.set(BAR_LEFT + (BAR_WIDTH * HOST_CPU_WARN) / 100, CPU_Y, 0.032);
  root.add(mark);

  let disposed = false;
  let inFlight = false;
  let nextPollAt = Number.NEGATIVE_INFINITY;

  const storeRetry = (deadline: number | null): void => {
    try {
      if (deadline === null) retryStore()?.removeItem(HOST_LOAD_AUTH_RETRY_KEY);
      else retryStore()?.setItem(HOST_LOAD_AUTH_RETRY_KEY, String(deadline));
    } catch {
      /* Storage unavailable: the backoff then lasts for this page only. */
    }
  };
  let storedRetry = Number.NaN;
  try {
    storedRetry = Number(retryStore()?.getItem(HOST_LOAD_AUTH_RETRY_KEY) ?? Number.NaN);
  } catch {
    /* Storage unavailable. */
  }
  const startedAt = clock();
  const restoredRetry =
    Number.isFinite(storedRetry) &&
    storedRetry > startedAt &&
    storedRetry <= startedAt + HOST_LOAD_AUTH_RETRY_MS;
  if (restoredRetry) nextPollAt = storedRetry;

  const setTone = (value: HostLoadTone): void => {
    tone.color.setHex(HOST_LOAD_TONE_COLORS[value]);
    const alarm = value === 'warn' || value === 'critical';
    dot.visible = !alarm;
    warning.visible = alarm;
  };

  const showResult = (result: HostStatsResult): void => {
    if (disposed) return;
    if (!result.ok) {
      setTone('unknown');
      setText(loadLabel, 'Unavailable');
      setText(trendLabel, HOST_LOAD_UNAVAILABLE[result.code]);
      setText(cpuLabel, formatCpu(null));
      bar.visible = false;
      return;
    }
    const stats = result.value;
    setTone(hostTone(stats));
    setText(loadLabel, formatLoad(stats));
    setText(trendLabel, formatLoadTrend(stats));
    setText(cpuLabel, formatCpu(stats.cpu));
    bar.visible = stats.cpu !== null;
    bar.scale.x = Math.max(
      0.0001,
      (BAR_WIDTH * THREE.MathUtils.clamp(stats.cpu ?? 0, 0, 100)) / 100,
    );
    barMaterial.color.setHex(HOST_LOAD_TONE_COLORS[cpuTone(stats.cpu)]);
  };

  const poll = (nowMs: number): void => {
    inFlight = true;
    nextPollAt = nowMs + pollMs;
    let result: Promise<HostStatsResult>;
    try {
      result = source();
    } catch {
      result = Promise.resolve({ ok: false, code: 'unavailable' });
    }
    void Promise.resolve(result)
      .catch((): HostStatsResult => ({ ok: false, code: 'unavailable' }))
      .then((value) => {
        inFlight = false;
        if (!value.ok && value.code === 'auth') {
          nextPollAt = nowMs + HOST_LOAD_AUTH_RETRY_MS;
          storeRetry(nextPollAt);
        } else if (!value.ok && value.code === 'rate-limited')
          nextPollAt = nowMs + HOST_LOAD_RATE_LIMIT_RETRY_MS;
        else if (value.ok) storeRetry(null);
        showResult(value);
      });
  };

  if (restoredRetry) showResult({ ok: false, code: 'auth' });

  // Polls only from the scene's frame loop, so a closed, hidden or unrendered widget never asks.
  const update = (nowMs: number): void => {
    if (disposed || inFlight || nowMs < nextPollAt || !isShown(root)) return;
    poll(nowMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = 'host-load';
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  return { root, update, dispose };
}
