import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tintToLuminance } from '../accent-colors';

export interface RainRooftopEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

export const RAIN_ROOFTOP_FLOOR_Y = 0.035;

const MAX_DELTA = 0.25;
const SKY_RADIUS = 88;
/** Half the side of the square terrace floor; the parapet's inner face sits here. */
export const RAIN_ROOFTOP_FLOOR_HALF = 3.5;
/** Half the side of the square canopy slab. */
export const RAIN_ROOFTOP_CANOPY_HALF = 4.1;
const CANOPY_Y = 3.4;
const CANOPY_THICKNESS = 0.18;
const PARAPET_HEIGHT = 0.45;
const PARAPET_THICKNESS = 0.25;
const RAIL_Y = 1.05;
const PAVER_TEXTURE_SIZE = 128;
const PAVER_TEXTURE_METERS = 2.4;
// Streets sit far enough below and beyond the parapet that they clear its top edge from the eye.
const GROUND_Y = -12;
const GROUND_RADIUS = 87;
const TRAFFIC_LIFT = 0.35;
const STREET_PITCH = 24;
const STREET_INNER = 38;
const STREET_OUTER = 85;
const CITY_INNER = 40;
const CITY_CORNER_LIMIT = 86;
const CITY_VERTEX_LIMIT = 88;

export const RAIN_ROOFTOP_RAIN_COUNT = 900;
/** Rain stays outside the canopy square by this margin and outside this radius. */
export const RAIN_ROOFTOP_RAIN_MARGIN = 0.6;
export const RAIN_ROOFTOP_RAIN_MIN_RADIUS = 5;
const RAIN_MAX_RADIUS = 11;
const RAIN_TOP = 9;
const RAIN_SPAN = 16;
const RAIN_LENGTH = 0.55;

// Every sub-period divides the master period, so wrapping time at the master is seamless and
// every shader only ever sees a phase in [0, 1) or a unit (cos, sin) pair.
export const RAIN_ROOFTOP_PERIOD = 480;
const RAIN_PERIOD = 2;
const CAR_SPACING = 10;
const CAR_PERIOD = 2;
const PLATOON_SPACING = 75;
const PLATOON_PERIOD = 15;
export const RAIN_ROOFTOP_BEACON_PERIOD = 1.5;
/** Window grid: one cell per column width and floor height, in meters of facade. */
export const RAIN_ROOFTOP_WINDOW_COLUMN = 1.6;
export const RAIN_ROOFTOP_WINDOW_FLOOR = 3.0;
/** Share of windows that switch on and off; each switches twice per master period. */
export const RAIN_ROOFTOP_DYNAMIC_FRACTION = 0.2;
const WINDOW_LIT_FRACTION = 0.24;
const WINDOW_FADE = 2.5 / RAIN_ROOFTOP_PERIOD;
const WINDOW_LOBBY_HEIGHT = 4;

// Palette in linear-from-sRGB codes, lifted out of the Quest 3 LCD black crush.
const SKY_ZENITH = new THREE.Color(0x0f1117);
const SKY_CLOUD = new THREE.Color(0x15171e);
const SKY_GLOW = new THREE.Color(0x2c2422);
const SKY_GLOW_FRONT = new THREE.Color(0x1d1b1f);
const SKY_BELOW = new THREE.Color(0x16141a);
const GROUND_NEAR = new THREE.Color(0x09090c);
const GROUND_FAR = new THREE.Color(0x17141a);
const TOWER_BASE = new THREE.Color(0x0d0f14);
const TOWER_HAZE = new THREE.Color(0x1f1b1e);
const FLOOR_BASE = new THREE.Color(0x111216);
const FLOOR_SHEEN = new THREE.Color(0x1f2129);
const STRUCTURE_BASE = new THREE.Color(0x17181d);
const SOFFIT_BASE = new THREE.Color(0x141419);
const WINDOW_WARM = new THREE.Color(0.2, 0.13, 0.065);
const WINDOW_COOL = new THREE.Color(0.11, 0.13, 0.16);
const TRAFFIC_WARM = new THREE.Color(0.26, 0.2, 0.13);
const TRAFFIC_RED = new THREE.Color(0.24, 0.02, 0.012);
const BEACON_RED = new THREE.Color(0.55, 0.035, 0.02);
const RAIN_COLOR = new THREE.Color(0.034, 0.038, 0.046);
/** The authored neon trim: a dim cool cyan. */
export const RAIN_ROOFTOP_TRIM_COLOR = 0x1f5c6a;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Degrees from the forward -Z axis, positive toward +X. */
function azimuthDegrees(x: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(x, -z));
}

/** 0 inside the pane sector around -Z, 1 well outside it. */
function openSector(x: number, z: number): number {
  return smoothstep(70, 105, Math.abs(azimuthDegrees(x, z)));
}

// The pane-sector fade shared by the traffic and rain shaders: 1 straight ahead, 0 beside and
// behind. Uses the direction cosine rather than atan so it stays cheap and branch-free.
const FRONT_GLSL = /* glsl */ `
float frontWeight(vec2 xz) {
  float facing = -xz.y / max(length(xz), 0.001);
  return smoothstep(-0.26, 0.34, facing);
}
`;

const HASH_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

function bakeShade(
  geometry: THREE.BufferGeometry,
  base: THREE.Color,
  shade: (normal: THREE.Vector3, position: THREE.Vector3) => number,
): THREE.BufferGeometry {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (prepared !== geometry) geometry.dispose();
  prepared.deleteAttribute('uv');
  const position = prepared.getAttribute('position');
  const normal = prepared.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    n.fromBufferAttribute(normal, index);
    p.fromBufferAttribute(position, index);
    const value = shade(n, p);
    colors[index * 3] = base.r * value;
    colors[index * 3 + 1] = base.g * value;
    colors[index * 3 + 2] = base.b * value;
  }
  prepared.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return prepared;
}

function mergeOwned(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`Unable to merge ${name}`);
  merged.computeBoundingSphere();
  return merged;
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

function basicMaterial(
  name: string,
  options: THREE.MeshBasicMaterialParameters = {},
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ name, fog: false, dithering: true, ...options });
}

function createSky(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const random = seededRandom(0x534b5952);
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 20);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const direction = new THREE.Vector3();
  const color = new THREE.Color();
  const glow = new THREE.Color();
  const cloud = Array.from({ length: 64 }, () => random());
  for (let index = 0; index < position.count; index += 1) {
    direction.fromBufferAttribute(position, index).normalize();
    const elevation = direction.y;
    const angle = (Math.atan2(direction.z, direction.x) / (Math.PI * 2) + 1) % 1;
    const sample = angle * cloud.length;
    const i0 = Math.floor(sample) % cloud.length;
    const mottled =
      cloud[i0] * (1 - (sample - Math.floor(sample))) +
      cloud[(i0 + 1) % cloud.length] * (sample - Math.floor(sample));
    glow.copy(SKY_GLOW_FRONT).lerp(SKY_GLOW, openSector(direction.x, direction.z));
    if (elevation < 0) {
      color.copy(SKY_BELOW).lerp(glow, 1 - smoothstep(0, 0.12, -elevation));
    } else {
      color
        .copy(SKY_CLOUD)
        .multiplyScalar(0.92 + 0.16 * mottled * smoothstep(0.08, 0.5, elevation))
        .lerp(SKY_ZENITH, smoothstep(0.35, 1, elevation))
        .lerp(glow, 1 - smoothstep(0, 0.2, elevation));
    }
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  const sky = new THREE.Mesh(
    geometry,
    basicMaterial('rain-rooftop-sky', {
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  sky.name = 'rain-rooftop-sky';
  sky.renderOrder = -1000;
  return sky;
}

function createGround(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.RingGeometry(3, GROUND_RADIUS, 64, 6);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, GROUND_Y, 0);
  geometry.deleteAttribute('uv');
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const far = smoothstep(30, GROUND_RADIUS, Math.hypot(x, z));
    color.copy(GROUND_NEAR).lerp(GROUND_FAR, far * (0.5 + 0.5 * openSector(x, z)));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const ground = new THREE.Mesh(
    geometry,
    basicMaterial('rain-rooftop-city-ground', { vertexColors: true }),
  );
  ground.name = 'rain-rooftop-city-ground';
  ground.renderOrder = -900;
  return ground;
}

export interface RainRooftopTower {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  top: number;
  seed: number;
  open: number;
}

/** Towers stand on a street grid, kept lower inside the pane sector around -Z. */
export function rainRooftopTowers(): RainRooftopTower[] {
  const random = seededRandom(0x43495459);
  const towers: RainRooftopTower[] = [];
  const blocks = Math.ceil(CITY_CORNER_LIMIT / STREET_PITCH);
  for (let bx = -blocks; bx <= blocks; bx += 1) {
    for (let bz = -blocks; bz <= blocks; bz += 1) {
      const cx = bx * STREET_PITCH;
      const cz = bz * STREET_PITCH;
      if (Math.hypot(cx, cz) < CITY_INNER) continue;
      const lots: { x: number; z: number; half: number }[] =
        random() < 0.45
          ? [{ x: cx, z: cz, half: 6 + random() * 2.5 }]
          : [-4.5, 4.5].flatMap((ox) =>
              [-4.5, 4.5].map((oz) => ({ x: cx + ox, z: cz + oz, half: 2.6 + random() * 1.6 })),
            );
      for (const lot of lots) {
        const skip = random();
        const halfWidth = lot.half * (0.8 + random() * 0.2);
        const halfDepth = lot.half * (0.8 + random() * 0.2);
        const corner = Math.hypot(Math.abs(lot.x) + halfWidth, Math.abs(lot.z) + halfDepth);
        if (skip < 0.12 || corner > CITY_CORNER_LIMIT) continue;
        const open = openSector(lot.x, lot.z);
        const low = -9 + random() * 8;
        const tall = random() < 0.16 ? 20 + random() * 13 : -5 + random() * 19;
        let top = THREE.MathUtils.lerp(low, tall, open);
        top = Math.min(top, Math.sqrt(CITY_VERTEX_LIMIT ** 2 - corner ** 2));
        if (top - GROUND_Y < 6) top = GROUND_Y + 6;
        towers.push({ x: lot.x, z: lot.z, halfWidth, halfDepth, top, seed: towers.length, open });
      }
    }
  }
  return towers;
}

const TOWER_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aWindow;
attribute float aDim;
varying vec3 vColor;
varying vec3 vWindow;
varying float vDim;
varying float vHaze;
void main() {
  vColor = aColor;
  vWindow = aWindow;
  vDim = aDim;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vHaze = smoothstep(45.0, 92.0, length(world.xz)) * 0.55;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Windows are hashed per facade cell. A dynamic window's on/off cycle is fract(offset + phase),
// so it is periodic in the CPU-wrapped phase and never jumps at the wrap. Derivatives are taken
// unconditionally because they are undefined in divergent control flow.
const TOWER_FRAGMENT = /* glsl */ `
uniform float uWindowPhase;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform vec3 uHaze;
varying vec3 vColor;
varying vec3 vWindow;
varying float vDim;
varying float vHaze;
#include <common>
#include <dithering_pars_fragment>
${HASH_GLSL}
void main() {
  vec2 grid = vWindow.xy / vec2(${RAIN_ROOFTOP_WINDOW_COLUMN.toFixed(2)}, ${RAIN_ROOFTOP_WINDOW_FLOOR.toFixed(2)});
  vec2 cell = floor(grid);
  vec2 local = fract(grid);
  vec2 blur = fwidth(grid) + 0.001;
  vec2 lower = smoothstep(vec2(0.2, 0.3) - blur, vec2(0.2, 0.3) + blur, local);
  vec2 upper = 1.0 - smoothstep(vec2(0.8, 0.82) - blur, vec2(0.8, 0.82) + blur, local);
  float pane = lower.x * lower.y * upper.x * upper.y;
  pane = mix(pane, 0.3, smoothstep(0.3, 0.7, max(blur.x, blur.y)));
  vec2 key = cell + vec2(vWindow.z * 13.0, vWindow.z * 7.0);
  float staticLit = step(hash12(key), ${WINDOW_LIT_FRACTION.toFixed(3)});
  float dynamic = step(hash12(key + 71.3), ${RAIN_ROOFTOP_DYNAMIC_FRACTION.toFixed(3)});
  float tone = hash12(key + 37.1);
  float duty = 0.3 + 0.4 * hash12(key + 11.7);
  float cycle = fract(hash12(key + 143.9) + uWindowPhase);
  float switching = smoothstep(0.0, ${WINDOW_FADE.toFixed(5)}, cycle) *
    (1.0 - smoothstep(duty, duty + ${WINDOW_FADE.toFixed(5)}, cycle));
  float lit = mix(staticLit, switching, dynamic);
  float facade = step(0.0, vWindow.z) * step(${WINDOW_LOBBY_HEIGHT.toFixed(1)}, vWindow.y);
  vec3 tint = mix(uWarm, uCool, step(0.74, tone)) * (0.5 + 0.5 * fract(tone * 7.31));
  vec3 color = vColor * (1.0 - 0.25 * pane * facade) + tint * lit * pane * facade * vDim;
  color = mix(color, uHaze, vHaze);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

function createTowers(
  towers: RainRooftopTower[],
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const windows: number[] = [];
  const dims: number[] = [];
  const random = seededRandom(0x544f5752);
  const color = new THREE.Color();
  const light = new THREE.Vector3(0.35, 0.2, 0.9).normalize();
  const normal = new THREE.Vector3();
  for (const tower of towers) {
    const tone = 0.85 + random() * 0.3;
    const dim = 0.35 + 0.65 * tower.open;
    const x0 = tower.x - tower.halfWidth;
    const x1 = tower.x + tower.halfWidth;
    const z0 = tower.z - tower.halfDepth;
    const z1 = tower.z + tower.halfDepth;
    const height = tower.top - GROUND_Y;
    const push = (
      corners: [number, number, number][],
      u: number[],
      v: number[],
      facade: boolean,
      faceNormal: [number, number, number],
    ): void => {
      normal.set(...faceNormal);
      const shade = tone * (0.82 + 0.22 * Math.abs(normal.dot(light)) + (facade ? 0 : 0.25));
      for (const order of [0, 1, 2, 0, 2, 3]) {
        const [x, y, z] = corners[order];
        positions.push(x, y, z);
        const rise = (y - GROUND_Y) / Math.max(height, 1);
        color
          .copy(TOWER_BASE)
          .multiplyScalar(shade)
          .lerp(TOWER_HAZE, 0.45 * (1 - smoothstep(0, 0.5, rise)));
        colors.push(color.r, color.g, color.b);
        windows.push(u[order], v[order], facade ? tower.seed : -1);
        dims.push(dim);
      }
    };
    const b = GROUND_Y;
    const t = tower.top;
    const w = x1 - x0;
    const d = z1 - z0;
    // Counter-clockwise seen from outside each face.
    push(
      [
        [x0, b, z1],
        [x1, b, z1],
        [x1, t, z1],
        [x0, t, z1],
      ],
      [0, w, w, 0],
      [0, 0, height, height],
      true,
      [0, 0, 1],
    );
    push(
      [
        [x1, b, z0],
        [x0, b, z0],
        [x0, t, z0],
        [x1, t, z0],
      ],
      [0, w, w, 0],
      [0, 0, height, height],
      true,
      [0, 0, -1],
    );
    push(
      [
        [x1, b, z1],
        [x1, b, z0],
        [x1, t, z0],
        [x1, t, z1],
      ],
      [0, d, d, 0],
      [0, 0, height, height],
      true,
      [1, 0, 0],
    );
    push(
      [
        [x0, b, z0],
        [x0, b, z1],
        [x0, t, z1],
        [x0, t, z0],
      ],
      [0, d, d, 0],
      [0, 0, height, height],
      true,
      [-1, 0, 0],
    );
    push(
      [
        [x0, t, z1],
        [x1, t, z1],
        [x1, t, z0],
        [x0, t, z0],
      ],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      false,
      [0, 1, 0],
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aWindow', new THREE.Float32BufferAttribute(windows, 3));
  geometry.setAttribute('aDim', new THREE.Float32BufferAttribute(dims, 1));
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    name: 'rain-rooftop-skyline',
    vertexShader: TOWER_VERTEX,
    fragmentShader: TOWER_FRAGMENT,
    uniforms: {
      uWindowPhase: { value: 0 },
      uWarm: { value: WINDOW_WARM.clone() },
      uCool: { value: WINDOW_COOL.clone() },
      uHaze: { value: TOWER_HAZE.clone() },
    },
    dithering: true,
  });
  const skyline = new THREE.Mesh(geometry, material);
  skyline.name = 'rain-rooftop-skyline';
  skyline.renderOrder = -800;
  return skyline;
}

const BEACON_VERTEX = /* glsl */ `
attribute vec2 aOffset;
uniform vec2 uPulse;
varying float vGlow;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vec3 facingNormal = normalize(normalMatrix * normal);
  float facing = clamp(dot(facingNormal, normalize(-view.xyz)), 0.0, 1.0);
  // cos(pulse + offset) by angle addition, so no time ever enters a trig call.
  float wave = 0.5 + 0.5 * (uPulse.x * aOffset.x - uPulse.y * aOffset.y);
  float pulse = 0.1 + 0.9 * wave * wave * (3.0 - 2.0 * wave);
  vGlow = facing * facing * pulse;
  gl_Position = projectionMatrix * view;
}
`;

const BEACON_FRAGMENT = /* glsl */ `
uniform vec3 uBeacon;
varying float vGlow;
#include <common>
#include <dithering_pars_fragment>
void main() {
  gl_FragColor = vec4(uBeacon * vGlow, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

export const RAIN_ROOFTOP_BEACON_COUNT = 6;

function createBeacons(
  towers: RainRooftopTower[],
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const random = seededRandom(0x4245434e);
  const candidates = towers
    .filter((tower) => Math.abs(azimuthDegrees(tower.x, tower.z)) > 95)
    .sort((a, b) => b.top - a.top);
  const chosen: RainRooftopTower[] = [];
  for (const tower of candidates) {
    if (chosen.length >= RAIN_ROOFTOP_BEACON_COUNT) break;
    const azimuth = azimuthDegrees(tower.x, tower.z);
    const crowded = chosen.some(
      (other) => Math.abs(azimuthDegrees(other.x, other.z) - azimuth) < 14,
    );
    if (!crowded) chosen.push(tower);
  }
  const parts = chosen.map((tower) => {
    const sphere = new THREE.IcosahedronGeometry(0.85, 1);
    sphere.deleteAttribute('uv');
    sphere.translate(tower.x, tower.top + 0.9, tower.z);
    const angle = random() * Math.PI * 2;
    const offsets = new Float32Array(sphere.getAttribute('position').count * 2);
    for (let index = 0; index < offsets.length; index += 2) {
      offsets[index] = Math.cos(angle);
      offsets[index + 1] = Math.sin(angle);
    }
    sphere.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 2));
    return sphere;
  });
  const material = new THREE.ShaderMaterial({
    name: 'rain-rooftop-beacons',
    vertexShader: BEACON_VERTEX,
    fragmentShader: BEACON_FRAGMENT,
    uniforms: {
      uPulse: { value: new THREE.Vector2(1, 0) },
      uBeacon: { value: BEACON_RED.clone() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    dithering: true,
  });
  const beacons = new THREE.Mesh(mergeOwned(parts, 'beacons'), material);
  beacons.name = 'rain-rooftop-beacons';
  return beacons;
}

const TRAFFIC_VERTEX = /* glsl */ `
attribute vec3 aLane;
varying vec3 vLane;
varying float vFront;
varying float vNear;
${FRONT_GLSL}
void main() {
  vLane = aLane;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vFront = frontWeight(world.xz);
  vNear = smoothstep(${STREET_INNER.toFixed(1)}, ${(STREET_INNER + 10).toFixed(1)}, length(world.xz));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Cars and platoons are two fixed-spacing patterns whose phases the CPU wraps into [0, 1), so
// both stay periodic and the flow never jumps when time wraps.
const TRAFFIC_FRAGMENT = /* glsl */ `
uniform vec2 uFlow;
uniform vec3 uHeadlights;
uniform vec3 uTaillights;
varying vec3 vLane;
varying float vFront;
varying float vNear;
#include <common>
#include <dithering_pars_fragment>
void main() {
  float direction = vLane.y;
  float car = fract(vLane.x / ${CAR_SPACING.toFixed(1)} - direction * uFlow.x);
  float carMask = 1.0 - smoothstep(0.06, 0.13, abs(car - 0.5));
  float platoon = fract(vLane.x / ${PLATOON_SPACING.toFixed(1)} - direction * uFlow.y);
  float group = smoothstep(0.1, 0.25, platoon) * (1.0 - smoothstep(0.55, 0.75, platoon));
  float across = 1.0 - smoothstep(0.35, 1.0, abs(vLane.z));
  vec3 tone = mix(uTaillights, uHeadlights, step(0.0, direction));
  float sector = (1.0 - 0.75 * vFront) * vNear;
  vec3 color = tone * across * sector * (carMask * group + 0.04);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

interface StreetSegment {
  axis: 'x' | 'z';
  offset: number;
  from: number;
  to: number;
}

function streetSegments(): StreetSegment[] {
  const lines: { axis: 'x' | 'z'; offset: number }[] = [
    { axis: 'x', offset: -36 },
    { axis: 'x', offset: 36 },
    { axis: 'x', offset: 60 },
    { axis: 'z', offset: 36 },
    { axis: 'z', offset: -60 },
    { axis: 'z', offset: 12 },
  ];
  const segments: StreetSegment[] = [];
  for (const line of lines) {
    const outer = Math.sqrt(STREET_OUTER ** 2 - line.offset ** 2);
    const inner = Math.sqrt(Math.max(0, STREET_INNER ** 2 - line.offset ** 2));
    if (inner === 0) segments.push({ ...line, from: -outer, to: outer });
    else {
      segments.push({ ...line, from: -outer, to: -inner });
      segments.push({ ...line, from: inner, to: outer });
    }
  }
  return segments;
}

function createTraffic(): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const random = seededRandom(0x54524146);
  const positions: number[] = [];
  const lanes: number[] = [];
  const y = GROUND_Y + TRAFFIC_LIFT;
  for (const segment of streetSegments()) {
    const start = random() * PLATOON_SPACING;
    for (const direction of [1, -1]) {
      const center = segment.offset + direction * 1.3;
      const half = 0.9;
      const point = (along: number, side: number): [number, number] =>
        segment.axis === 'x' ? [center + side * half, along] : [along, center + side * half];
      const corners = [
        [segment.from, -1],
        [segment.to, -1],
        [segment.to, 1],
        [segment.from, 1],
      ] as const;
      for (const order of [0, 2, 1, 0, 3, 2]) {
        const [along, side] = corners[order];
        const [x, z] = point(along, side);
        positions.push(x, y, z);
        lanes.push(along - segment.from + start, direction, side);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLane', new THREE.Float32BufferAttribute(lanes, 3));
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    name: 'rain-rooftop-traffic',
    vertexShader: TRAFFIC_VERTEX,
    fragmentShader: TRAFFIC_FRAGMENT,
    uniforms: {
      uFlow: { value: new THREE.Vector2(0, 0) },
      uHeadlights: { value: TRAFFIC_WARM.clone() },
      uTaillights: { value: TRAFFIC_RED.clone() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    dithering: true,
  });
  const traffic = new THREE.Mesh(geometry, material);
  traffic.name = 'rain-rooftop-traffic';
  traffic.renderOrder = -700;
  return traffic;
}

const RAIN_VERTEX = /* glsl */ `
attribute vec3 aRain;
uniform float uFall;
varying float vAlpha;
void main() {
  float fall = fract(aRain.x + uFall);
  float y = ${RAIN_TOP.toFixed(1)} - fall * ${RAIN_SPAN.toFixed(1)} - aRain.y * ${RAIN_LENGTH.toFixed(2)};
  vec3 moved = vec3(position.x, y, position.z);
  float ends = smoothstep(0.0, 0.1, fall) * (1.0 - smoothstep(0.8, 1.0, fall));
  vAlpha = aRain.z * ends * (0.35 + 0.65 * aRain.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
}
`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uRain;
varying float vAlpha;
#include <common>
#include <dithering_pars_fragment>
void main() {
  gl_FragColor = vec4(uRain * vAlpha, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

function createRain(): THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const random = seededRandom(0x5241494e);
  const positions = new Float32Array(RAIN_ROOFTOP_RAIN_COUNT * 6);
  const attributes = new Float32Array(RAIN_ROOFTOP_RAIN_COUNT * 6);
  const clear = RAIN_ROOFTOP_CANOPY_HALF + RAIN_ROOFTOP_RAIN_MARGIN;
  let placed = 0;
  while (placed < RAIN_ROOFTOP_RAIN_COUNT) {
    const radius = Math.sqrt(
      RAIN_ROOFTOP_RAIN_MIN_RADIUS ** 2 +
        random() * (RAIN_MAX_RADIUS ** 2 - RAIN_ROOFTOP_RAIN_MIN_RADIUS ** 2),
    );
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const seed = random();
    const strength = 0.55 + random() * 0.45;
    if (Math.max(Math.abs(x), Math.abs(z)) < clear) continue;
    // Straight ahead the rain drops to about a fifth so it never reads as noise behind the panes.
    const brightness = strength * (0.22 + 0.78 * openSector(x, z));
    for (let end = 0; end < 2; end += 1) {
      const offset = (placed * 2 + end) * 3;
      positions[offset] = x;
      positions[offset + 1] = end === 0 ? RAIN_TOP : RAIN_TOP - RAIN_SPAN - RAIN_LENGTH;
      positions[offset + 2] = z;
      attributes[offset] = seed;
      attributes[offset + 1] = end;
      attributes[offset + 2] = brightness;
    }
    placed += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRain', new THREE.BufferAttribute(attributes, 3));
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    name: 'rain-rooftop-rain',
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    uniforms: {
      uFall: { value: 0 },
      uRain: { value: RAIN_COLOR.clone() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    dithering: true,
  });
  const rain = new THREE.LineSegments(geometry, material);
  rain.name = 'rain-rooftop-rain';
  return rain;
}

function createPaverTexture(): THREE.DataTexture {
  const size = PAVER_TEXTURE_SIZE;
  const random = seededRandom(0x50415645);
  const tiles = 4;
  const tile = size / tiles;
  const shades = Array.from({ length: tiles * tiles }, () => 0.86 + random() * 0.14);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const localX = x % tile;
      const localY = y % tile;
      const seam = Math.min(localX, localY, tile - 1 - localX, tile - 1 - localY);
      const seamShade = seam < 1 ? 0.72 : seam < 2 ? 0.9 : 1;
      const index = Math.floor(y / tile) * tiles + Math.floor(x / tile);
      const grain = 0.95 + random() * 0.05;
      const value = Math.round(255 * shades[index] * seamShade * grain);
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createFloor(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const side = RAIN_ROOFTOP_FLOOR_HALF * 2;
  const geometry = new THREE.PlaneGeometry(side, side, 14, 14);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, RAIN_ROOFTOP_FLOOR_Y, 0);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const uvs = new Float32Array(position.count * 2);
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    color.copy(FLOOR_BASE).lerp(FLOOR_SHEEN, smoothstep(1.6, RAIN_ROOFTOP_FLOOR_HALF, edge) * 0.85);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    uvs[index * 2] = x / PAVER_TEXTURE_METERS;
    uvs[index * 2 + 1] = z / PAVER_TEXTURE_METERS;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const floor = new THREE.Mesh(
    geometry,
    basicMaterial('rain-rooftop-floor', { vertexColors: true, map: createPaverTexture() }),
  );
  floor.name = 'rain-rooftop-floor';
  return floor;
}

// Azimuths stay beyond ±80° of -Z, so the canopy's front edge is cantilevered over the panes.
export const RAIN_ROOFTOP_PILLARS: readonly [number, number][] = [
  [-3.25, -0.35],
  [3.25, -0.35],
  [-3.25, 3.25],
  [3.25, 3.25],
  [0, 3.25],
];

function createStructure(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const parts: THREE.BufferGeometry[] = [];
  const floor = RAIN_ROOFTOP_FLOOR_Y;
  const edge = RAIN_ROOFTOP_FLOOR_HALF;
  const wall = edge + PARAPET_THICKNESS / 2;
  const outer = edge + PARAPET_THICKNESS;
  const solid = (n: THREE.Vector3, p: THREE.Vector3): number =>
    (0.72 + 0.32 * Math.max(0, n.y) + 0.1 * Math.abs(n.x)) *
    (0.8 + 0.2 * Math.min(1, p.y / CANOPY_Y));
  const pushShaded = (geometry: THREE.BufferGeometry, base = STRUCTURE_BASE): void => {
    parts.push(bakeShade(geometry, base, solid));
  };
  const wallY = floor + PARAPET_HEIGHT / 2;
  pushShaded(box(outer * 2, PARAPET_HEIGHT, PARAPET_THICKNESS, 0, wallY, -wall));
  pushShaded(box(outer * 2, PARAPET_HEIGHT, PARAPET_THICKNESS, 0, wallY, wall));
  pushShaded(box(PARAPET_THICKNESS, PARAPET_HEIGHT, edge * 2, -wall, wallY, 0));
  pushShaded(box(PARAPET_THICKNESS, PARAPET_HEIGHT, edge * 2, wall, wallY, 0));
  const capY = floor + PARAPET_HEIGHT + 0.02;
  const cap = PARAPET_THICKNESS + 0.06;
  pushShaded(box(outer * 2 + 0.06, 0.04, cap, 0, capY, -wall));
  pushShaded(box(outer * 2 + 0.06, 0.04, cap, 0, capY, wall));
  pushShaded(box(cap, 0.04, edge * 2, -wall, capY, 0));
  pushShaded(box(cap, 0.04, edge * 2, wall, capY, 0));
  const railTop = floor + RAIL_Y;
  const railInset = wall;
  pushShaded(box(railInset * 2 + 0.05, 0.05, 0.05, 0, railTop, -railInset));
  pushShaded(box(railInset * 2 + 0.05, 0.05, 0.05, 0, railTop, railInset));
  pushShaded(box(0.05, 0.05, railInset * 2, -railInset, railTop, 0));
  pushShaded(box(0.05, 0.05, railInset * 2, railInset, railTop, 0));
  const postHeight = RAIL_Y - PARAPET_HEIGHT - 0.04;
  const postY = floor + PARAPET_HEIGHT + 0.04 + postHeight / 2;
  for (let step = -2; step <= 2; step += 1) {
    const along = (step / 2) * railInset;
    for (const sign of [-1, 1]) {
      pushShaded(box(0.035, postHeight, 0.035, along, postY, sign * railInset));
      if (Math.abs(step) < 2)
        pushShaded(box(0.035, postHeight, 0.035, sign * railInset, postY, along));
    }
  }
  for (const [x, z] of RAIN_ROOFTOP_PILLARS)
    pushShaded(box(0.18, CANOPY_Y - floor, 0.18, x, floor + (CANOPY_Y - floor) / 2, z));
  const canopy = RAIN_ROOFTOP_CANOPY_HALF;
  const soffit = (n: THREE.Vector3): number => 0.8 + 0.3 * Math.max(0, n.y) + 0.12 * Math.abs(n.z);
  parts.push(
    bakeShade(
      box(canopy * 2, CANOPY_THICKNESS, canopy * 2, 0, CANOPY_Y + CANOPY_THICKNESS / 2, 0),
      SOFFIT_BASE,
      soffit,
    ),
  );
  const beamY = CANOPY_Y - 0.13;
  for (const x of [-3.25, 3.25])
    parts.push(bakeShade(box(0.2, 0.26, canopy * 2, x, beamY, 0), SOFFIT_BASE, soffit));
  for (const z of [-0.35, 3.25])
    parts.push(bakeShade(box(6.3, 0.26, 0.2, 0, beamY, z), SOFFIT_BASE, soffit));
  const structure = new THREE.Mesh(
    mergeOwned(parts, 'structure'),
    basicMaterial('rain-rooftop-structure', { vertexColors: true }),
  );
  structure.name = 'rain-rooftop-structure';
  return structure;
}

function createTrim(
  accent: THREE.Color | null,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const canopy = RAIN_ROOFTOP_CANOPY_HALF + 0.012;
  const y = CANOPY_Y - 0.012;
  const length = canopy * 2 + 0.024;
  const strips: { geometry: THREE.BufferGeometry; level: number }[] = [
    // The front edge is overhead in the pane field, so it runs at a little over half strength.
    { geometry: box(length, 0.022, 0.022, 0, y, -canopy), level: 0.55 },
    { geometry: box(length, 0.022, 0.022, 0, y, canopy), level: 1 },
    { geometry: box(0.022, 0.022, length, -canopy, y, 0), level: 0.85 },
    { geometry: box(0.022, 0.022, length, canopy, y, 0), level: 0.85 },
  ];
  const parts = strips.map(({ geometry, level }) =>
    bakeShade(geometry, new THREE.Color(1, 1, 1), () => level),
  );
  const material = basicMaterial('rain-rooftop-neon-trim', {
    vertexColors: true,
    color: tintToLuminance(new THREE.Color(), new THREE.Color(RAIN_ROOFTOP_TRIM_COLOR), accent),
  });
  const trim = new THREE.Mesh(mergeOwned(parts, 'trim'), material);
  trim.name = 'rain-rooftop-neon-trim';
  return trim;
}

/** `accent` retints the neon canopy trim; null keeps the authored cool cyan. */
export function createRainRooftopEnvironment(
  accent: THREE.Color | null = null,
): RainRooftopEnvironment {
  const root = new THREE.Group();
  root.name = 'rain-rooftop-environment';
  const towers = rainRooftopTowers();
  const skyline = createTowers(towers);
  const beacons = createBeacons(towers);
  const traffic = createTraffic();
  const rain = createRain();
  root.add(
    createSky(),
    createGround(),
    skyline,
    beacons,
    traffic,
    rain,
    createFloor(),
    createStructure(),
    createTrim(accent),
  );
  const pulse = beacons.material.uniforms.uPulse.value as THREE.Vector2;
  const flow = traffic.material.uniforms.uFlow.value as THREE.Vector2;
  const windowPhase = skyline.material.uniforms.uWindowPhase;
  const fall = rain.material.uniforms.uFall;
  root.userData.time = 0;
  let disposed = false;
  const update = (deltaSeconds: number): void => {
    if (disposed || !root.visible || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const time =
      ((root.userData.time as number) + Math.min(deltaSeconds, MAX_DELTA)) % RAIN_ROOFTOP_PERIOD;
    root.userData.time = time;
    windowPhase.value = time / RAIN_ROOFTOP_PERIOD;
    fall.value = (time / RAIN_PERIOD) % 1;
    flow.set((time / CAR_PERIOD) % 1, (time / PLATOON_PERIOD) % 1);
    const beat = (Math.PI * 2 * time) / RAIN_ROOFTOP_BEACON_PERIOD;
    pulse.set(Math.cos(beat), Math.sin(beat));
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) &&
        !(object instanceof THREE.Points) &&
        !(object instanceof THREE.Line)
      )
        return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    });
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      if (material instanceof THREE.ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms))
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    root.removeFromParent();
  };
  return { root, update, dispose, floorY: RAIN_ROOFTOP_FLOOR_Y };
}
