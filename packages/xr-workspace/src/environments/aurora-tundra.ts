import * as THREE from 'three';
import { tintToLuminance } from '../accent-colors';

export interface AuroraTundraEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

export const AURORA_TUNDRA_FLOOR_Y = 0.035;
// Every animated phase is an integer harmonic of this period (45-90 s layers), so wrapping the
// clock here is seamless and keeps every shader argument small.
export const AURORA_TUNDRA_PERIOD = 180;
export const AURORA_TUNDRA_SNOW_COUNT = 360;
// Snow never comes nearer than this inside the forward pane field, so no flake crosses pane text.
export const AURORA_TUNDRA_SNOW_FRONT_CLEARANCE = 3.5;

const MAX_DELTA = 0.25;
const SKY_RADIUS = 84;
const STAR_RADIUS = 80;
const STAR_COUNT = 620;
const SPRITE_SIZE = 32;
const GRAIN_SIZE = 128;
const GRAIN_METERS = 3.4;
const FLOOR_FLAT_RADIUS = 18;
const FLOOR_SEGMENTS = 64;
const PANE_SECTOR_ANGLE = Math.PI * 1.5;
const AURORA_SEGMENTS = 120;
const AURORA_ROWS = 8;
const SNOW_TOP = 7.5;
const SNOW_OUTER_RADIUS = 11;
const SNOW_FRONT_RADIUS = 4.2;
const SNOW_SIDE_RADIUS = 2;
const SNOW_DRIFT_MAX = 0.4;

// Palette in sRGB codes, lifted out of the Quest 3 LCD black crush and ordered: sky zenith
// darkest, then hills, horizon and snow.
const SKY_ZENITH = new THREE.Color(0x0b0f18);
const SKY_HORIZON = new THREE.Color(0x1a2232);
const NEAR_HILLS = new THREE.Color(0x272e3d);
const FAR_HILLS = new THREE.Color(0x1f2535);
const SNOW_FLOOR = new THREE.Color(0x2c3340);
const SNOW_RIM = new THREE.Color(0x1f2634);
const SNOWFLAKE = new THREE.Color(0x6e7888);
// Linear peak luminance of an authored band stays at or below half the desert moon disc, so even
// where a folded curtain overlaps itself the sum is no brighter than the moon.
export const AURORA_TUNDRA_PRIMARY = new THREE.Color(0x1d7f4f);
export const AURORA_TUNDRA_SECONDARY = new THREE.Color(0x1a6f78);
const AURORA_CROWN = new THREE.Color(0x2e1d5c);
const HILL_LIGHT = new THREE.Vector3(0.15, 0.75, 0.65).normalize();

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

function angularDistance(a: number, b: number): number {
  return Math.abs(((((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
}

function periodicNoise(samples: number[], t: number): number {
  const count = samples.length;
  const scaled = (((t % 1) + 1) % 1) * count;
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return samples[index % count] * (1 - smooth) + samples[(index + 1) % count] * smooth;
}

// Panes sit around -Z, so hills there stay a low swell.
function paneSectorFactor(angle: number): number {
  return 0.22 + 0.78 * smoothstep(0.95, 1.5, angularDistance(angle, PANE_SECTOR_ANGLE));
}

function createSkyDome(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const direction = new THREE.Vector3();
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    direction.fromBufferAttribute(position, index).normalize();
    const height = Math.max(0, direction.y);
    color.copy(SKY_HORIZON).lerp(SKY_ZENITH, Math.min(1, height / 0.55) ** 0.6);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      name: 'aurora-tundra-sky',
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      dithering: true,
      fog: false,
    }),
  );
  sky.name = 'aurora-tundra-sky';
  sky.renderOrder = -1000;
  return sky;
}

function createSpriteTexture(): THREE.DataTexture {
  const data = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE * 4);
  const center = (SPRITE_SIZE - 1) / 2;
  const radius = SPRITE_SIZE / 2;
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    for (let x = 0; x < SPRITE_SIZE; x += 1) {
      const distance = Math.hypot(x - center, y - center) / radius;
      const alpha = distance >= 0.94 ? 0 : Math.min(1, Math.max(0, 1 - distance * distance) ** 1.6);
      const offset = (y * SPRITE_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, SPRITE_SIZE, SPRITE_SIZE, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createStars(
  sprite: THREE.Texture,
): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const random = seededRandom(0x41535452);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const y = 0.08 + random() * 0.92;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const offset = index * 3;
    positions[offset] = Math.cos(angle) * ring * STAR_RADIUS;
    positions[offset + 1] = y * STAR_RADIUS;
    positions[offset + 2] = Math.sin(angle) * ring * STAR_RADIUS;
    const horizonFade = Math.min(1, (y - 0.08) / 0.3);
    const bright = random() > 0.95;
    const brightness =
      (bright ? 0.55 + random() * 0.2 : 0.16 + random() * 0.3) * (0.3 + 0.7 * horizonFade);
    colors[offset] = brightness * 0.82;
    colors[offset + 1] = brightness * 0.9;
    colors[offset + 2] = brightness;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      name: 'aurora-tundra-stars',
      map: sprite,
      size: 0.34,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      fog: false,
    }),
  );
  stars.name = 'aurora-tundra-stars';
  stars.renderOrder = -900;
  return stars;
}

interface HillBand {
  radius: number;
  depth: number;
  crestOffset: number;
  footY: number;
  segments: number;
  ridgeHeight: number;
  tone: THREE.Color;
  haze: number;
}

function createHills(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const random = seededRandom(0x48494c4c);
  const bands: HillBand[] = [
    {
      radius: 74,
      depth: 10,
      crestOffset: -0.4,
      footY: -7,
      segments: 160,
      ridgeHeight: 8,
      tone: FAR_HILLS,
      haze: 0.5,
    },
    {
      radius: 56,
      depth: 11,
      crestOffset: -1.2,
      footY: -6,
      segments: 144,
      ridgeHeight: 5,
      tone: NEAR_HILLS,
      haze: 0.15,
    },
  ];
  const rows = [
    { inset: 0, drop: 0, haze: 0 },
    { inset: 0.25, drop: 0.22, haze: 0.3 },
    { inset: 0.6, drop: 0.6, haze: 0.65 },
    { inset: 1, drop: 1, haze: 1 },
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const normal = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  for (const band of bands) {
    const coarse = Array.from({ length: 6 }, () => random());
    const medium = Array.from({ length: 15 }, () => random());
    const heights = Array.from({ length: band.segments }, (_, index) => {
      const t = index / band.segments;
      const rolling = periodicNoise(coarse, t) * 0.65 + periodicNoise(medium, t) * 0.35;
      return band.ridgeHeight * rolling ** 1.4 * paneSectorFactor(t * Math.PI * 2);
    });
    const grid = rows.map((row) =>
      heights.map((height, index) => {
        const angle = (index / band.segments) * Math.PI * 2;
        const crestY = band.crestOffset + height;
        const y = crestY + (band.footY - crestY) * row.drop;
        const radius = band.radius - band.depth * row.inset;
        return {
          position: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
          haze: row.haze * band.haze,
        };
      }),
    );
    type Corner = (typeof grid)[number][number];
    const facet = (a: Corner, b: Corner, c: Corner): void => {
      edgeA.subVectors(b.position, a.position);
      edgeB.subVectors(c.position, a.position);
      normal.crossVectors(edgeA, edgeB).normalize();
      centroid.copy(a.position).add(b.position).add(c.position);
      if (normal.dot(centroid) > 0) normal.negate();
      const shade = 0.88 + Math.max(0, normal.dot(HILL_LIGHT)) * 0.3;
      for (const corner of [a, b, c]) {
        positions.push(corner.position.x, corner.position.y, corner.position.z);
        color.copy(band.tone).multiplyScalar(shade).lerp(SKY_HORIZON, corner.haze);
        colors.push(color.r, color.g, color.b);
      }
    };
    for (let row = 0; row < rows.length - 1; row += 1) {
      for (let index = 0; index < band.segments; index += 1) {
        const next = (index + 1) % band.segments;
        facet(grid[row][index], grid[row][next], grid[row + 1][index]);
        facet(grid[row][next], grid[row + 1][next], grid[row + 1][index]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const hills = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      name: 'aurora-tundra-hills',
      vertexColors: true,
      side: THREE.DoubleSide,
      dithering: true,
      fog: false,
    }),
  );
  hills.name = 'aurora-tundra-hills';
  hills.renderOrder = -880;
  return hills;
}

// Only smooth value noise, no per-texel randomness, so the snow cannot sparkle at grazing angles.
function createGrainTexture(): THREE.DataTexture {
  const random = seededRandom(0x534e4f57);
  const size = GRAIN_SIZE;
  const coarseCells = 8;
  const fineCells = 32;
  const coarse = Array.from({ length: coarseCells * coarseCells }, () => random());
  const fine = Array.from({ length: fineCells * fineCells }, () => random());
  const sample = (table: number[], cells: number, u: number, v: number): number => {
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = smoothstep(0, 1, u - x0);
    const fy = smoothstep(0, 1, v - y0);
    const at = (x: number, y: number): number => table[(y % cells) * cells + (x % cells)];
    return (
      (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
      (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
    );
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const blotch = sample(
        coarse,
        coarseCells,
        (x / size) * coarseCells,
        (y / size) * coarseCells,
      );
      const drift = sample(fine, fineCells, (x / size) * fineCells, (y / size) * fineCells);
      const value = 0.93 + (blotch - 0.5) * 0.1 + (drift - 0.5) * 0.06;
      const byte = Math.round(Math.min(1, value) * 255);
      const offset = (y * size + x) * 4;
      data[offset] = byte;
      data[offset + 1] = byte;
      data[offset + 2] = byte;
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
  const random = seededRandom(0x464c4f52);
  const rings = [
    { radius: 0, y: AURORA_TUNDRA_FLOOR_Y },
    { radius: 4, y: AURORA_TUNDRA_FLOOR_Y },
    { radius: 9, y: AURORA_TUNDRA_FLOOR_Y },
    { radius: 14, y: AURORA_TUNDRA_FLOOR_Y },
    { radius: FLOOR_FLAT_RADIUS, y: AURORA_TUNDRA_FLOOR_Y },
    { radius: 26, y: -0.7 },
    { radius: 36, y: -2.2 },
    { radius: 48, y: -5 },
  ];
  const grid = rings.map((ring, ringIndex) =>
    Array.from({ length: FLOOR_SEGMENTS }, (_, index) => {
      const angle = ((index + (ringIndex % 2) * 0.5) / FLOOR_SEGMENTS) * Math.PI * 2;
      const outer = ringIndex > 4;
      const radius = ring.radius + (outer ? (random() - 0.5) * 2 : 0);
      const y = outer ? ring.y + (random() - 0.5) * 0.5 : ring.y;
      return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }),
  );
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const color = new THREE.Color();
  const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    for (const vertex of [a, b, c]) {
      const fade = smoothstep(7, 34, Math.hypot(vertex.x, vertex.z));
      color.copy(SNOW_FLOOR).lerp(SNOW_RIM, fade);
      positions.push(vertex.x, vertex.y, vertex.z);
      colors.push(color.r, color.g, color.b);
      uvs.push(vertex.x / GRAIN_METERS, vertex.z / GRAIN_METERS);
    }
  };
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const inner = grid[ringIndex];
    const outer = grid[ringIndex + 1];
    for (let index = 0; index < FLOOR_SEGMENTS; index += 1) {
      const next = (index + 1) % FLOOR_SEGMENTS;
      if (ringIndex === 0) {
        push(inner[0], outer[next], outer[index]);
        continue;
      }
      push(inner[index], outer[next], outer[index]);
      push(inner[index], inner[next], outer[next]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const floor = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      name: 'aurora-tundra-floor',
      map: createGrainTexture(),
      vertexColors: true,
      dithering: true,
      fog: false,
    }),
  );
  floor.name = 'aurora-tundra-floor';
  floor.renderOrder = -870;
  return floor;
}

interface Curtain {
  radius: number;
  fromDegrees: number;
  toDegrees: number;
  baseY: number;
  height: number;
  secondary: boolean;
  seed: number;
}

// Azimuth from -Z toward +X. Anything within ±75° of -Z starts above 24° elevation, clear of a
// two-row pane stack 2.3 m away (about 18°), and the rest sits low enough to see without craning.
const CURTAINS: Curtain[] = [
  {
    radius: 34,
    fromDegrees: 105,
    toDegrees: 255,
    baseY: 11,
    height: 18,
    secondary: false,
    seed: 0.4,
  },
  {
    radius: 30,
    fromDegrees: -85,
    toDegrees: 85,
    baseY: 17,
    height: 14,
    secondary: true,
    seed: 2.1,
  },
  {
    radius: 22,
    fromDegrees: 120,
    toDegrees: 240,
    baseY: 13,
    height: 12,
    secondary: false,
    seed: 4.3,
  },
];
export const AURORA_TUNDRA_FOLD_AMPLITUDE = 2.6;

const AURORA_VERTEX = /* glsl */ `
attribute vec3 aCurtain;
attribute vec2 aRibbon;
attribute float aSeed;
attribute float aSecondary;
uniform vec2 uFoldA;
uniform vec2 uFoldB;
varying vec2 vRibbon;
varying float vSeed;
varying float vSecondary;
varying float vBreath;
uniform vec3 uBreath;
void main() {
  vRibbon = aRibbon;
  vSeed = aSeed;
  vSecondary = aSecondary;
  vBreath = dot(uBreath, aCurtain);
  float a = aRibbon.x * 18.849556 + aSeed;
  float b = aRibbon.x * 31.415927 + aSeed * 1.7;
  // sin(a + phase) with phase = (cos, sin), so time never enters the argument.
  float foldA = sin(a) * uFoldA.x + cos(a) * uFoldA.y;
  float foldB = sin(b) * uFoldB.x - cos(b) * uFoldB.y;
  float sway = (0.65 + 0.35 * aRibbon.y) * (foldA * 0.7 + foldB * 0.3);
  vec3 displaced = position;
  displaced.xz += normalize(position.xz) * sway * ${AURORA_TUNDRA_FOLD_AMPLITUDE.toFixed(2)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

// Ray arguments stay under about 60 rad so fp16 fragment math keeps them stable.
const AURORA_FRAGMENT = /* glsl */ `
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uCrown;
uniform vec2 uRays;
varying vec2 vRibbon;
varying float vSeed;
varying float vSecondary;
varying float vBreath;
#include <common>
#include <dithering_pars_fragment>
void main() {
  float u = vRibbon.x;
  float v = vRibbon.y;
  float edge = smoothstep(0.0, 0.16, v);
  float fade = pow(1.0 - v, 1.7);
  float ends = smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(0.86, 1.0, u));
  float r = u * 50.265482 + vSeed;
  float rays = 0.62 + 0.26 * (sin(r) * uRays.x + cos(r) * uRays.y) + 0.12 * sin(u * 23.0 + vSeed * 3.0);
  float intensity = clamp(edge * fade * ends * rays * vBreath, 0.0, 1.0);
  vec3 band = mix(uPrimary, uSecondary, vSecondary);
  vec3 color = mix(band, uCrown, smoothstep(0.25, 0.9, v)) * intensity;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

function createAurora(
  accent: THREE.Color | null,
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const vertsPerCurtain = (AURORA_SEGMENTS + 1) * (AURORA_ROWS + 1);
  const total = vertsPerCurtain * CURTAINS.length;
  const positions = new Float32Array(total * 3);
  const ribbon = new Float32Array(total * 2);
  const curtainMask = new Float32Array(total * 3);
  const seeds = new Float32Array(total);
  const secondary = new Float32Array(total);
  const indices: number[] = [];
  CURTAINS.forEach((curtain, curtainIndex) => {
    const start = curtainIndex * vertsPerCurtain;
    for (let row = 0; row <= AURORA_ROWS; row += 1) {
      const v = row / AURORA_ROWS;
      for (let column = 0; column <= AURORA_SEGMENTS; column += 1) {
        const u = column / AURORA_SEGMENTS;
        const azimuth = THREE.MathUtils.degToRad(
          curtain.fromDegrees + (curtain.toDegrees - curtain.fromDegrees) * u,
        );
        const vertex = start + row * (AURORA_SEGMENTS + 1) + column;
        positions[vertex * 3] = Math.sin(azimuth) * curtain.radius;
        positions[vertex * 3 + 1] = curtain.baseY + curtain.height * v;
        positions[vertex * 3 + 2] = -Math.cos(azimuth) * curtain.radius;
        ribbon[vertex * 2] = u;
        ribbon[vertex * 2 + 1] = v;
        curtainMask[vertex * 3 + curtainIndex] = 1;
        seeds[vertex] = curtain.seed;
        secondary[vertex] = curtain.secondary ? 1 : 0;
      }
    }
    for (let row = 0; row < AURORA_ROWS; row += 1) {
      for (let column = 0; column < AURORA_SEGMENTS; column += 1) {
        const a = start + row * (AURORA_SEGMENTS + 1) + column;
        const b = a + 1;
        const c = a + AURORA_SEGMENTS + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRibbon', new THREE.BufferAttribute(ribbon, 2));
  geometry.setAttribute('aCurtain', new THREE.BufferAttribute(curtainMask, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSecondary', new THREE.BufferAttribute(secondary, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += AURORA_TUNDRA_FOLD_AMPLITUDE;
  const material = new THREE.ShaderMaterial({
    name: 'aurora-tundra-aurora',
    vertexShader: AURORA_VERTEX,
    fragmentShader: AURORA_FRAGMENT,
    uniforms: {
      uPrimary: {
        value: tintToLuminance(new THREE.Color(), AURORA_TUNDRA_PRIMARY, accent),
      },
      uSecondary: { value: AURORA_TUNDRA_SECONDARY.clone() },
      uCrown: { value: AURORA_CROWN.clone() },
      uFoldA: { value: new THREE.Vector2(1, 0) },
      uFoldB: { value: new THREE.Vector2(1, 0) },
      uRays: { value: new THREE.Vector2(1, 0) },
      uBreath: { value: new THREE.Vector3(1, 1, 1) },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    dithering: true,
  });
  const aurora = new THREE.Mesh(geometry, material);
  aurora.name = 'aurora-tundra-aurora';
  aurora.renderOrder = -890;
  aurora.userData.auroraTime = 0;
  return aurora;
}

interface Snow {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  baseX: Float32Array;
  baseZ: Float32Array;
  height: Float32Array;
  speed: Float32Array;
  driftX: Float32Array;
  driftZ: Float32Array;
  driftHarmonic: Float32Array;
  driftSeed: Float32Array;
}

function createSnow(sprite: THREE.Texture): Snow {
  const random = seededRandom(0x464c414b);
  const count = AURORA_TUNDRA_SNOW_COUNT;
  const positions = new Float32Array(count * 3);
  const baseX = new Float32Array(count);
  const baseZ = new Float32Array(count);
  const height = new Float32Array(count);
  const speed = new Float32Array(count);
  const driftX = new Float32Array(count);
  const driftZ = new Float32Array(count);
  const driftHarmonic = new Float32Array(count);
  const driftSeed = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const azimuth = (random() * 2 - 1) * Math.PI;
    // Past 95° the drift (at most 0.57 m) cannot carry a flake back inside the ±75° field.
    const inner =
      Math.abs(azimuth) < THREE.MathUtils.degToRad(95) ? SNOW_FRONT_RADIUS : SNOW_SIDE_RADIUS;
    const radius = Math.sqrt(inner ** 2 + random() * (SNOW_OUTER_RADIUS ** 2 - inner ** 2));
    baseX[index] = Math.sin(azimuth) * radius;
    baseZ[index] = -Math.cos(azimuth) * radius;
    height[index] = AURORA_TUNDRA_FLOOR_Y + random() * (SNOW_TOP - AURORA_TUNDRA_FLOOR_Y);
    speed[index] = 0.3 + random() * 0.3;
    driftX[index] = (0.15 + random() * 0.25) * (random() > 0.5 ? 1 : -1);
    driftZ[index] = (0.1 + random() * 0.2) * (random() > 0.5 ? 1 : -1);
    driftHarmonic[index] = 3 + Math.floor(random() * 6);
    driftSeed[index] = random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, SNOW_TOP / 2, 0),
    Math.hypot(SNOW_OUTER_RADIUS + SNOW_DRIFT_MAX, SNOW_TOP / 2),
  );
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      name: 'aurora-tundra-snow',
      map: sprite,
      color: SNOWFLAKE.clone(),
      size: 0.04,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.6,
      alphaTest: 0.02,
      depthWrite: false,
      fog: false,
    }),
  );
  points.name = 'aurora-tundra-snow';
  points.renderOrder = -860;
  return { points, baseX, baseZ, height, speed, driftX, driftZ, driftHarmonic, driftSeed };
}

function placeSnow(snow: Snow, phase: number): void {
  const attribute = snow.points.geometry.getAttribute('position') as THREE.BufferAttribute;
  const array = attribute.array as Float32Array;
  for (let index = 0; index < snow.height.length; index += 1) {
    const angle = phase * snow.driftHarmonic[index] + snow.driftSeed[index];
    array[index * 3] = snow.baseX[index] + snow.driftX[index] * Math.sin(angle);
    array[index * 3 + 1] = snow.height[index];
    array[index * 3 + 2] = snow.baseZ[index] + snow.driftZ[index] * Math.cos(angle);
  }
  attribute.needsUpdate = true;
}

/** `accent` retints the primary aurora band; null keeps the authored soft green. */
export function createAuroraTundraEnvironment(
  accent: THREE.Color | null = null,
): AuroraTundraEnvironment {
  const root = new THREE.Group();
  root.name = 'aurora-tundra-environment';
  const sprite = createSpriteTexture();
  const aurora = createAurora(accent);
  const snow = createSnow(sprite);
  root.add(createSkyDome(), createStars(sprite), aurora, createHills(), createFloor(), snow.points);
  const uniforms = aurora.material.uniforms;
  const foldA = uniforms.uFoldA.value as THREE.Vector2;
  const foldB = uniforms.uFoldB.value as THREE.Vector2;
  const rays = uniforms.uRays.value as THREE.Vector2;
  const breath = uniforms.uBreath.value as THREE.Vector3;
  const snowSpan = SNOW_TOP - AURORA_TUNDRA_FLOOR_Y;
  const apply = (time: number): void => {
    const phase = (Math.PI * 2 * time) / AURORA_TUNDRA_PERIOD;
    foldA.set(Math.cos(phase * 3), Math.sin(phase * 3));
    foldB.set(Math.cos(phase * 2), Math.sin(phase * 2));
    rays.set(Math.cos(phase * 4), Math.sin(phase * 4));
    breath.set(
      0.8 + 0.2 * Math.sin(phase * 2 + 0.3),
      0.8 + 0.2 * Math.sin(phase * 3 + 1.9),
      0.8 + 0.2 * Math.sin(phase * 4 + 4.1),
    );
    placeSnow(snow, phase);
  };
  apply(0);
  let disposed = false;
  const update = (deltaSeconds: number): void => {
    if (disposed || !root.visible || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const delta = Math.min(deltaSeconds, MAX_DELTA);
    const time = ((aurora.userData.auroraTime as number) + delta) % AURORA_TUNDRA_PERIOD;
    aurora.userData.auroraTime = time;
    for (let index = 0; index < snow.height.length; index += 1) {
      let y = snow.height[index] - snow.speed[index] * delta;
      if (y < AURORA_TUNDRA_FLOOR_Y) y += snowSpan;
      snow.height[index] = y;
    }
    apply(time);
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>([sprite]);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
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
  return { root, update, dispose, floorY: AURORA_TUNDRA_FLOOR_Y };
}
