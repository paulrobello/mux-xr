import * as THREE from 'three';
import {
  createDefaultWeatherFetcher,
  validateWeatherZip,
  type WeatherDay,
  type WeatherFailure,
  type WeatherFetcher,
  type WeatherReport,
} from '../host-weather';
import { createScalableLabel, updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const WEATHER_KIND = 'weather';
/** NWS updates its grids about hourly and the server caches ten minutes. */
export const WEATHER_POLL_MS = 10 * 60_000;
/** A failed lookup is retried sooner than a good one is refreshed. */
export const WEATHER_RETRY_MS = 60_000;
/** A banner: current conditions on the left, the day tiles on the right. */
export const WEATHER_WIDTH = 0.66;
export const WEATHER_HEIGHT = 0.2;

export type WeatherIconKind = 'clear' | 'partly' | 'cloudy' | 'rain' | 'thunder' | 'snow' | 'fog';

/** Maps NWS short-forecast wording onto one of the drawn icons; the most severe word wins. */
export function weatherIconKind(summary: string): WeatherIconKind {
  const text = summary.toLowerCase();
  if (/thunder|t-storm/.test(text)) return 'thunder';
  if (/snow|sleet|flurr|blizzard|ice|freezing/.test(text)) return 'snow';
  if (/rain|shower|drizzle/.test(text)) return 'rain';
  if (/fog|haze|smoke|mist|dust/.test(text)) return 'fog';
  if (/partly|mostly sunny|mostly clear|few clouds/.test(text)) return 'partly';
  if (/cloud|overcast/.test(text)) return 'cloudy';
  if (/sunny|clear|fair|hot/.test(text)) return 'clear';
  return 'cloudy';
}

export type WeatherModel =
  | { kind: 'no-zip' }
  | { kind: 'loading'; zip: string }
  | { kind: 'unknown-zip'; zip: string }
  | { kind: 'failed'; zip: string; code: WeatherFailure }
  | { kind: 'report'; report: WeatherReport };

export interface WeatherView {
  title: string;
  temp: string;
  summary: string;
  detail: string;
  updated: string;
  icon: WeatherIconKind | null;
  isDay: boolean;
  days: WeatherDay[];
}

const FAILURE_TEXT: Record<WeatherFailure, string> = {
  'no-secret': 'Pair the host clipboard in Settings',
  disabled: 'Host pairing is off on the Mac',
  auth: 'The Mac rejected the pairing secret',
  'rate-limited': 'Too many requests; retrying',
  unavailable: 'Weather service unreachable',
  timeout: 'Weather service timed out',
};

const quiet = (title: string, summary: string, detail = ''): WeatherView => ({
  title,
  temp: '',
  summary,
  detail,
  updated: '',
  icon: null,
  isDay: true,
  days: [],
});

export function formatUpdated(fetchedAt: string, nowMs: number): string {
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.floor((nowMs - at) / 60_000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : 'over an hour ago';
}

export function weatherView(model: WeatherModel, nowMs: number): WeatherView {
  switch (model.kind) {
    case 'no-zip':
      return quiet('Weather', 'No ZIP code set', 'Settings › World › Weather ZIP');
    case 'loading':
      return quiet(`Weather · ${model.zip}`, 'Checking the forecast…');
    case 'unknown-zip':
      return quiet(
        `Weather · ${model.zip}`,
        'ZIP code not found',
        'Settings › World › Weather ZIP',
      );
    case 'failed':
      return quiet(`Weather · ${model.zip}`, 'Unavailable', FAILURE_TEXT[model.code]);
  }
  const { report } = model;
  const { now } = report;
  const parts = [
    now.windMph === null ? '' : `Wind ${now.windMph} mph${now.windDir ? ` ${now.windDir}` : ''}`,
    now.humidity === null ? '' : `Humidity ${now.humidity}%`,
  ].filter(Boolean);
  const updated = formatUpdated(report.fetchedAt, nowMs);
  return {
    title: [report.place, report.region].filter(Boolean).join(', ') || `ZIP ${report.zip}`,
    temp: `${now.tempF}°`,
    summary: now.summary || '—',
    detail: parts.join(' · '),
    updated: updated && `Updated ${updated}`,
    icon: weatherIconKind(now.summary),
    isDay: now.isDay,
    days: report.days,
  };
}

export function formatDayTemps(day: WeatherDay): string {
  if (day.highF !== null && day.lowF !== null) return `${day.highF}° / ${day.lowF}°`;
  if (day.highF !== null) return `High ${day.highF}°`;
  if (day.lowF !== null) return `Low ${day.lowF}°`;
  return '—';
}

const SUN = 0xffc24a;
const MOON = 0xdfe8f2;
const CLOUD = 0xd7e3ea;
const STORM_CLOUD = 0x8c9cab;
const RAIN = 0x66d5e7;
const SNOW = 0xf4fbff;
const BOLT = 0xffd84d;

/** Shared geometry and materials for every icon one widget draws. */
interface IconKit {
  sphere: THREE.SphereGeometry;
  ray: THREE.BoxGeometry;
  drop: THREE.CylinderGeometry;
  flake: THREE.OctahedronGeometry;
  bar: THREE.BoxGeometry;
  bolt: THREE.ExtrudeGeometry;
  sun: THREE.MeshStandardMaterial;
  moon: THREE.MeshStandardMaterial;
  cloud: THREE.MeshStandardMaterial;
  stormCloud: THREE.MeshStandardMaterial;
  rain: THREE.MeshStandardMaterial;
  snow: THREE.MeshStandardMaterial;
  boltMaterial: THREE.MeshStandardMaterial;
  dispose(): void;
}

function createIconKit(envMap: THREE.Texture | null): IconKit {
  const lit = (color: number, emissive = 0, intensity = 0): THREE.MeshStandardMaterial =>
    applyUIEnvironment(
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: intensity,
        roughness: 0.55,
        metalness: 0.05,
      }),
      envMap,
    );
  const boltShape = new THREE.Shape();
  boltShape.moveTo(0.004, 0.03);
  boltShape.lineTo(-0.012, 0.0);
  boltShape.lineTo(0.0, 0.0);
  boltShape.lineTo(-0.006, -0.03);
  boltShape.lineTo(0.014, 0.006);
  boltShape.lineTo(0.002, 0.006);
  boltShape.closePath();
  const kit = {
    sphere: new THREE.SphereGeometry(1, 14, 10),
    ray: new THREE.BoxGeometry(0.004, 0.012, 0.004),
    drop: new THREE.CylinderGeometry(0.0018, 0.0018, 0.014, 5),
    flake: new THREE.OctahedronGeometry(0.0045),
    bar: new THREE.BoxGeometry(0.07, 0.005, 0.004),
    bolt: new THREE.ExtrudeGeometry(boltShape, { depth: 0.004, bevelEnabled: false }),
    sun: lit(SUN, SUN, 0.75),
    moon: lit(MOON, MOON, 0.35),
    cloud: lit(CLOUD, 0x2a3640, 0.25),
    stormCloud: lit(STORM_CLOUD, 0x1a222a, 0.2),
    rain: lit(RAIN, RAIN, 0.5),
    snow: lit(SNOW, SNOW, 0.4),
    boltMaterial: lit(BOLT, BOLT, 0.9),
  };
  return {
    ...kit,
    dispose: () => {
      for (const value of Object.values(kit)) value.dispose();
    },
  };
}

interface WeatherIcon {
  group: THREE.Group;
  /** Advances the icon's idle motion; `t` is seconds. */
  animate(t: number): void;
}

/** Builds one icon about 0.1 m across at scale 1, centred on its group's origin. */
function buildIcon(kit: IconKit, kind: WeatherIconKind, isDay: boolean): WeatherIcon {
  const group = new THREE.Group();
  group.name = `weather-icon-${kind}`;
  const movers: Array<(t: number) => void> = [];
  const ball = (material: THREE.Material, radius: number, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(kit.sphere, material);
    mesh.scale.setScalar(radius);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const cloud = (material: THREE.Material, x: number, y: number, scale = 1): THREE.Group => {
    const puff = new THREE.Group();
    puff.position.set(x, y, 0.012);
    puff.scale.setScalar(scale);
    for (const [px, py, r] of [
      [-0.022, -0.004, 0.016],
      [0, 0.006, 0.021],
      [0.022, -0.002, 0.017],
      [0, -0.01, 0.017],
    ] as const) {
      const mesh = new THREE.Mesh(kit.sphere, material);
      mesh.scale.set(r * 1.05, r, r * 0.7);
      mesh.position.set(px, py, 0);
      puff.add(mesh);
    }
    group.add(puff);
    const baseX = x;
    movers.push((t) => {
      puff.position.x = baseX + Math.sin(t * 0.6) * 0.004;
    });
    return puff;
  };
  const sky = (x: number, y: number, radius: number): void => {
    if (!isDay) {
      const moon = ball(kit.moon, radius * 0.85, x, y);
      movers.push((t) => {
        moon.rotation.y = t * 0.2;
      });
      return;
    }
    ball(kit.sun, radius, x, y);
    const rays = new THREE.Group();
    rays.position.set(x, y, 0);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const ray = new THREE.Mesh(kit.ray, kit.sun);
      ray.position.set(Math.cos(angle) * radius * 1.45, Math.sin(angle) * radius * 1.45, 0);
      ray.rotation.z = angle - Math.PI / 2;
      rays.add(ray);
    }
    group.add(rays);
    movers.push((t) => {
      rays.rotation.z = t * 0.35;
    });
  };
  const falling = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    speed: number,
    spin: boolean,
  ): void => {
    const drops: THREE.Mesh[] = [];
    for (let index = 0; index < count; index += 1) {
      const drop = new THREE.Mesh(geometry, material);
      drop.position.set(-0.022 + (index * 0.044) / Math.max(1, count - 1), -0.03, 0.012);
      if (!spin) drop.rotation.z = 0.25;
      group.add(drop);
      drops.push(drop);
    }
    movers.push((t) => {
      for (const [index, drop] of drops.entries()) {
        const phase = (t * speed + index * 0.37) % 1;
        drop.position.y = -0.02 - phase * 0.02;
        drop.position.x = -0.022 + (index * 0.044) / Math.max(1, count - 1) - phase * 0.006;
        drop.visible = phase < 0.92;
        if (spin) drop.rotation.z = t * 1.5 + index;
      }
    });
  };

  switch (kind) {
    case 'clear':
      sky(0, 0, 0.026);
      break;
    case 'partly':
      sky(0.016, 0.014, 0.02);
      cloud(kit.cloud, -0.006, -0.008);
      break;
    case 'cloudy':
      cloud(kit.stormCloud, 0.014, 0.012, 0.8);
      cloud(kit.cloud, -0.006, -0.006);
      break;
    case 'rain':
      cloud(kit.stormCloud, 0, 0.012);
      falling(kit.drop, kit.rain, 4, 1.1, false);
      break;
    case 'thunder': {
      cloud(kit.stormCloud, 0, 0.014);
      const bolt = new THREE.Mesh(kit.bolt, kit.boltMaterial);
      bolt.position.set(0, -0.022, 0.02);
      group.add(bolt);
      falling(kit.drop, kit.rain, 3, 1.2, false);
      // A brief double flicker every few seconds.
      movers.push((t) => {
        const phase = t % 3.2;
        bolt.visible = !(phase > 2.6 && phase < 2.7) && !(phase > 2.8 && phase < 2.85);
        kit.boltMaterial.emissiveIntensity = phase < 0.15 ? 1.6 : 0.9;
      });
      break;
    }
    case 'snow':
      cloud(kit.cloud, 0, 0.012);
      falling(kit.flake, kit.snow, 4, 0.45, true);
      break;
    case 'fog':
      cloud(kit.cloud, 0, 0.016, 0.8);
      for (const [index, y] of [-0.012, -0.022, -0.032].entries()) {
        const bar = new THREE.Mesh(kit.bar, kit.cloud);
        bar.position.set(0, y, 0.02);
        group.add(bar);
        movers.push((t) => {
          bar.position.x = Math.sin(t * 0.8 + index * 1.3) * 0.006;
        });
      }
      break;
  }
  return {
    group,
    animate: (t) => {
      for (const move of movers) move(t);
    },
  };
}

export interface WeatherWidgetOptions {
  fetchWeather?: WeatherFetcher;
  pollMs?: number;
  retryMs?: number;
  /** Whether the page is hidden; polling pauses while it is. */
  pageHidden?: () => boolean;
}

let nextWeatherId = 1;

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const TILE_COLOR = 0x15232b;
const PAD = 0.02;
const TOP = WEATHER_HEIGHT / 2;
const LEFT = -WEATHER_WIDTH / 2 + PAD;
const RIGHT = WEATHER_WIDTH / 2 - PAD;
/** The current-conditions block; the day tiles fill the rest. */
const NOW_WIDTH = 0.3;
const DAY_SLOTS = 4;
const TILE_GAP = 0.008;
const TILES_LEFT = LEFT + NOW_WIDTH + 0.012;
const TILE_WIDTH = (RIGHT - TILES_LEFT - TILE_GAP * (DAY_SLOTS - 1)) / DAY_SLOTS;
const TILE_HEIGHT = 0.128;
const TILE_Y = -0.022;
const ICON_X = LEFT + 0.042;
const ICON_Y = 0.008;
const ICON_SCALE = 1;
const TILE_ICON_SCALE = 0.42;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

function shownInScene(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent)
    if (!current.visible || current.userData.focusHidden) return false;
  return true;
}

const defaultPageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function createWeatherWidget(
  envMap: THREE.Texture | null = null,
  options: WeatherWidgetOptions = {},
): Widget {
  const widgetId = `${WEATHER_KIND}-${nextWeatherId++}`;
  let fetchWeather = options.fetchWeather;
  const pollMs = options.pollMs ?? WEATHER_POLL_MS;
  const retryMs = options.retryMs ?? WEATHER_RETRY_MS;
  const pageHidden = options.pageHidden ?? defaultPageHidden;
  const root = new THREE.Group();
  root.name = widgetId;
  const kit = createIconKit(envMap);

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WEATHER_WIDTH, WEATHER_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'weather-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WEATHER_WIDTH - 0.03, WEATHER_HEIGHT - 0.03, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'weather-face';
  face.position.z = 0.014;
  root.add(body, face);

  const label = (
    name: string,
    width: number,
    height: number,
    x: number,
    y: number,
    options: { align?: 'left' | 'center'; fontSize?: number; wrap?: boolean } = {},
  ): THREE.Mesh => {
    const mesh = createScalableLabel('', width, height, { backplate: false, ...options });
    mesh.name = name;
    mesh.position.set(x, y, 0.03);
    root.add(mesh);
    return mesh;
  };
  const CLOSE = 0.04;
  const title = label('weather-title', NOW_WIDTH, 0.034, LEFT + NOW_WIDTH / 2, TOP - PAD - 0.01, {
    align: 'left',
    fontSize: 0.02,
  });
  const close = createScalableLabel('×', CLOSE, CLOSE, { background: '#223946' });
  close.name = 'weather-close';
  close.position.set(WEATHER_WIDTH / 2 - CLOSE / 2 - 0.006, TOP - CLOSE / 2 - 0.006, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the weather';
  root.add(close);

  const TEXT_X = LEFT + 0.09;
  const TEXT_WIDTH = NOW_WIDTH - 0.09;
  const temp = label('weather-temp', TEXT_WIDTH, 0.058, TEXT_X + TEXT_WIDTH / 2, 0.022, {
    align: 'left',
    fontSize: 0.05,
  });
  const summary = label('weather-summary', TEXT_WIDTH, 0.03, TEXT_X + TEXT_WIDTH / 2, -0.024, {
    align: 'left',
    fontSize: 0.016,
    wrap: true,
  });
  const detail = label('weather-detail', NOW_WIDTH, 0.02, LEFT + NOW_WIDTH / 2, -0.058, {
    align: 'left',
    fontSize: 0.0135,
  });
  const updated = label('weather-updated', NOW_WIDTH, 0.018, LEFT + NOW_WIDTH / 2, -0.077, {
    align: 'left',
    fontSize: 0.0115,
  });

  const iconSlot = new THREE.Group();
  iconSlot.name = 'weather-icon-slot';
  iconSlot.position.set(ICON_X, ICON_Y, 0.02);
  iconSlot.scale.setScalar(ICON_SCALE);
  root.add(iconSlot);

  const tileMaterial = new THREE.MeshBasicMaterial({ color: TILE_COLOR });
  const tileGeometry = new THREE.PlaneGeometry(TILE_WIDTH, TILE_HEIGHT);
  const tiles = Array.from({ length: DAY_SLOTS }, (_, index) => {
    const x = TILES_LEFT + TILE_WIDTH / 2 + index * (TILE_WIDTH + TILE_GAP);
    const plate = new THREE.Mesh(tileGeometry, tileMaterial);
    plate.name = `weather-day-${index}-plate`;
    plate.position.set(x, TILE_Y, 0.028);
    root.add(plate);
    const name = label(`weather-day-${index}-name`, TILE_WIDTH - 0.006, 0.022, x, TILE_Y + 0.047, {
      fontSize: 0.0135,
    });
    const icon = new THREE.Group();
    icon.name = `weather-day-${index}-icon`;
    icon.position.set(x, TILE_Y + 0.014, 0.03);
    icon.scale.setScalar(TILE_ICON_SCALE);
    root.add(icon);
    const temps = label(`weather-day-${index}-temps`, TILE_WIDTH - 0.004, 0.02, x, TILE_Y - 0.026, {
      fontSize: 0.0135,
    });
    const precip = label(
      `weather-day-${index}-precip`,
      TILE_WIDTH - 0.004,
      0.018,
      x,
      TILE_Y - 0.046,
      { fontSize: 0.0115 },
    );
    return { plate, name, icon, temps, precip, key: '' };
  });

  const tag = (object: THREE.Object3D): void => {
    object.traverse((child) => {
      child.userData.widgetId = widgetId;
      child.userData.widgetKind = WEATHER_KIND;
      // Icons rebuilt after mounting need the scene's key to stay grabbable.
      if (root.userData.widgetKey) child.userData.widgetKey = root.userData.widgetKey;
      if (!child.userData.inputAction) child.userData.inputAction = 'grabWidget';
    });
  };

  let disposed = false;
  let zip = '';
  let model: WeatherModel = { kind: 'no-zip' };
  let generation = 0;
  let inFlight = false;
  let nextPollAt = Number.POSITIVE_INFINITY;
  let lastRenderMinute = -1;
  let mainIcon: WeatherIcon | null = null;
  let mainIconKey = '';

  const setIcon = (slot: THREE.Group, kind: WeatherIconKind | null, isDay: boolean) => {
    slot.clear();
    if (!kind) return null;
    const icon = buildIcon(kit, kind, isDay);
    slot.add(icon.group);
    tag(icon.group);
    return icon;
  };

  const render = (nowMs: number): void => {
    const view = weatherView(model, nowMs);
    setText(title, view.title);
    setText(temp, view.temp);
    setText(summary, view.summary);
    setText(detail, view.detail);
    setText(updated, view.updated);
    const iconKey = view.icon ? `${view.icon}:${view.isDay}` : '';
    if (iconKey !== mainIconKey) {
      mainIconKey = iconKey;
      mainIcon = setIcon(iconSlot, view.icon, view.isDay);
      if (mainIcon) mainIcon.animate(nowMs / 1000);
    }
    // Status messages have no icon or temperature, so they start at the left edge.
    summary.position.x = view.temp ? TEXT_X + TEXT_WIDTH / 2 : LEFT + TEXT_WIDTH / 2;
    summary.position.y = view.temp ? -0.024 : 0.0;
    for (const [index, tile] of tiles.entries()) {
      const day = view.days[index];
      const shown = !!day;
      tile.plate.visible = shown;
      tile.name.visible = shown;
      tile.temps.visible = shown;
      tile.precip.visible = shown;
      tile.icon.visible = shown;
      if (!day) continue;
      setText(tile.name, day.name);
      setText(tile.temps, formatDayTemps(day));
      setText(tile.precip, day.precip === null ? '' : `${day.precip}% precip`);
      const kind = weatherIconKind(day.summary);
      const key = `${kind}:${day.name !== 'Tonight'}`;
      if (key !== tile.key) {
        tile.key = key;
        // Forecast icons stand still, so only the main icon costs per-frame work.
        setIcon(tile.icon, kind, day.name !== 'Tonight')?.animate(0.8);
      }
    }
    lastRenderMinute = Math.floor(nowMs / 60_000);
  };

  const poll = (): void => {
    if (!zip || inFlight || disposed) return;
    fetchWeather ??= createDefaultWeatherFetcher();
    const token = generation;
    const target = zip;
    inFlight = true;
    nextPollAt = Number.POSITIVE_INFINITY;
    void fetchWeather(target)
      .catch(() => ({ ok: false as const, code: 'unavailable' as const }))
      .then((result) => {
        if (token !== generation) return;
        inFlight = false;
        if (disposed) return;
        const at = Date.now();
        if (!result.ok) {
          // Keep showing a good report through a transient failure.
          if (model.kind !== 'report') model = { kind: 'failed', zip: target, code: result.code };
          nextPollAt = at + retryMs;
        } else if (result.status.state === 'ok') {
          model = { kind: 'report', report: result.status.report };
          nextPollAt = at + pollMs;
        } else if (result.status.state === 'unknown-zip') {
          model = { kind: 'unknown-zip', zip: target };
          nextPollAt = Number.POSITIVE_INFINITY;
        } else {
          if (model.kind !== 'report') model = { kind: 'failed', zip: target, code: 'unavailable' };
          nextPollAt = at + retryMs;
        }
        render(at);
      });
  };

  const setWeatherZip = (next: string): void => {
    const valid = validateWeatherZip(next);
    if (disposed || valid === zip) return;
    zip = valid;
    generation += 1;
    inFlight = false;
    model = zip ? { kind: 'loading', zip } : { kind: 'no-zip' };
    nextPollAt = zip ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const nowMs = Date.now();
    render(nowMs);
    if (zip && shownInScene(root) && !pageHidden()) poll();
  };

  // Called from the render loop only while the widget is mounted, so closing it stops polling.
  const update = (nowMs: number): void => {
    if (disposed) return;
    const visible = shownInScene(root);
    if (zip && nowMs >= nextPollAt && visible && !pageHidden()) poll();
    if (!visible) return;
    mainIcon?.animate(nowMs / 1000);
    if (model.kind === 'report' && Math.floor(nowMs / 60_000) !== lastRenderMinute) render(nowMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    // Icons share the kit, so they leave the tree before the owned sweep and the kit goes once.
    iconSlot.clear();
    for (const tile of tiles) tile.icon.clear();
    disposeOwned(root);
    kit.dispose();
    root.clear();
  };

  tag(root);
  root.userData.scaleLimits = [0.3, 2];
  render(Date.now());
  return { root, update, dispose, setWeatherZip };
}
