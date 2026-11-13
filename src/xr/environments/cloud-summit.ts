import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tintToLuminance } from '../accent-colors';

export interface CloudSummitEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

export const CLOUD_SUMMIT_FLOOR_Y = 0.035;
// Every cloud layer scrolls a whole number of noise tiles per period, so wrapping time here is
// seamless and the offsets reaching the shader stay in [0, 1).
export const CLOUD_SUMMIT_CLOUD_PERIOD = 120;
// Azimuth measured from -Z toward +X. Panes reach about 75 degrees, so the set sun sits behind
// the user's right shoulder.
export const CLOUD_SUMMIT_SUN_AZIMUTH_DEGREES = 155;
export const CLOUD_SUMMIT_BIRD_COUNT = 5;
/** Birds fly only between these azimuths, through the rear arc. */
export const CLOUD_SUMMIT_BIRD_ARC_DEGREES: readonly [number, number] = [100, 260];

const MAX_DELTA = 0.25;
const EYE_HEIGHT = 1.6;
const SKY_RADIUS = 86;
const STAR_RADIUS = 82;
const STAR_COUNT = 110;
const STAR_SPRITE_SIZE = 32;
const PLATFORM_RADIUS = 4.5;
const PLATFORM_SEGMENTS = 64;
const RIM_STONE_COUNT = 30;
const PANE_SECTOR_DEGREES = 75;
const CLOUD_INNER_RADIUS = 6;
const CLOUD_OUTER_RADIUS = 85;
// The sea is a shallow bowl: deep under the summit, rising toward the rim so it meets the sky a
// few degrees below eye level instead of leaving a hard ring well under the horizon.
const CLOUD_BASE_Y = -20;
const CLOUD_RISE = 16;
const NOISE_SIZE = 128;
const GRAIN_SIZE = 128;
const BIRD_RADIUS = 62;
const BIRD_SPEED_DEGREES = 1.6;
const BIRD_FLAP_HZ = 0.6;
const BIRD_FADE_SECONDS = 4;

const SUN_ELEVATION_DEGREES = -3;
const SUN_DIRECTION = new THREE.Vector3(
  Math.sin(THREE.MathUtils.degToRad(CLOUD_SUMMIT_SUN_AZIMUTH_DEGREES)) *
    Math.cos(THREE.MathUtils.degToRad(SUN_ELEVATION_DEGREES)),
  Math.sin(THREE.MathUtils.degToRad(SUN_ELEVATION_DEGREES)),
  -Math.cos(THREE.MathUtils.degToRad(CLOUD_SUMMIT_SUN_AZIMUTH_DEGREES)) *
    Math.cos(THREE.MathUtils.degToRad(SUN_ELEVATION_DEGREES)),
);
const SUN_FLAT = new THREE.Vector2(SUN_DIRECTION.x, SUN_DIRECTION.z).normalize();

// sRGB palette kept above the Quest 3 LCD black crush and below the desert moon's peak.
const SKY_ZENITH = 0x0c0e24;
const SKY_HORIZON = 0x1d2138;
const SKY_WARM = 0x45303a;
const SKY_GLOW = 0x3a2418;
const CLOUD_TROUGH = 0x10111f;
const CLOUD_BODY = 0x262840;
const CLOUD_LIT = 0x3c2c34;
const PEAK_TONE = new THREE.Color(0x16151f);
const PEAK_HAZE = new THREE.Color(0x1d2138);
const ROCK_TOP = new THREE.Color(0x2a272d);
const ROCK_EDGE = new THREE.Color(0x1f1d24);
const CLIFF_TONE = new THREE.Color(0x1d1b22);
const STONE_TONE = new THREE.Color(0x2c2a31);
const BIRD_TONE = 0x0b0a12;
const ACCENT_GLOW = 0x2a4c56;

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

function wrap01(value: number): number {
  return value - Math.floor(value);
}

function periodicNoise(samples: number[], t: number): number {
  const count = samples.length;
  const scaled = wrap01(t) * count;
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return samples[index % count] * (1 - smooth) + samples[(index + 1) % count] * smooth;
}

// Azimuth in degrees from -Z toward +X, in (-180, 180].
function azimuthOf(x: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(x, -z));
}

function inPaneSector(x: number, z: number): boolean {
  return Math.abs(azimuthOf(x, z)) < PANE_SECTOR_DEGREES;
}

function mergeOwned(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`Unable to merge ${name}`);
  merged.computeBoundingSphere();
  return merged;
}

function dataTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Tileable fbm baked from periodic value-noise lattices that all divide the texture size.
function createCloudNoiseTexture(): THREE.DataTexture {
  const random = seededRandom(0x434c4f55);
  const size = NOISE_SIZE;
  const octaves = [
    { cells: 4, weight: 0.5 },
    { cells: 8, weight: 0.27 },
    { cells: 16, weight: 0.15 },
    { cells: 32, weight: 0.08 },
  ].map((octave) => ({
    ...octave,
    lattice: Array.from({ length: octave.cells * octave.cells }, () => random()),
  }));
  const values = new Float32Array(size * size);
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0;
      for (const { cells, weight, lattice } of octaves) {
        const u = (x / size) * cells;
        const v = (y / size) * cells;
        const x0 = Math.floor(u);
        const y0 = Math.floor(v);
        const fx = smoothstep(0, 1, u - x0);
        const fy = smoothstep(0, 1, v - y0);
        const at = (sx: number, sy: number): number => lattice[(sy % cells) * cells + (sx % cells)];
        value +=
          weight *
          ((at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
            (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy);
      }
      values[y * size + x] = value;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < values.length; index += 1) {
    const byte = Math.round(((values[index] - low) / (high - low)) * 255);
    data[index * 4] = byte;
    data[index * 4 + 1] = byte;
    data[index * 4 + 2] = byte;
    data[index * 4 + 3] = 255;
  }
  return dataTexture(data, size);
}

function createGrainTexture(): THREE.DataTexture {
  const random = seededRandom(0x524f434b);
  const size = GRAIN_SIZE;
  const cells = 16;
  const coarse = Array.from({ length: cells * cells }, () => random());
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = smoothstep(0, 1, u - x0);
      const fy = smoothstep(0, 1, v - y0);
      const at = (sx: number, sy: number): number => coarse[(sy % cells) * cells + (sx % cells)];
      const blotch =
        (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
        (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      // Low contrast, roughly +/-14% around 0.86: enough texture for stereo fusion.
      const value = 0.86 + (blotch - 0.5) * 0.16 + (random() - 0.5) * 0.12;
      const byte = Math.round(Math.min(1, value) * 255);
      const offset = (y * size + x) * 4;
      data[offset] = byte;
      data[offset + 1] = byte;
      data[offset + 2] = byte;
      data[offset + 3] = 255;
    }
  }
  return dataTexture(data, size);
}

// Shared by the sky and the cloud sea, so the clouds fade into exactly the sky behind their rim.
const SKY_FUNCTION = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uWarm;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform vec2 uSunFlat;

vec3 skyColor(vec3 dir) {
  float elevation = dir.y;
  vec2 flatDir = dir.xz / max(length(dir.xz), 0.0001);
  float toward = dot(flatDir, uSunFlat) * 0.5 + 0.5;
  float up = smoothstep(0.0, 0.75, elevation);
  vec3 color = mix(uHorizon, uZenith, sqrt(up));
  float band = 1.0 - smoothstep(0.0, 0.24, abs(elevation - 0.015));
  color = mix(color, uWarm, band * (0.28 + 0.72 * toward * toward * toward));
  float sun = max(dot(dir, uSunDir), 0.0);
  float sun2 = sun * sun;
  float sun8 = sun2 * sun2 * sun2 * sun2;
  return color + uGlow * (sun8 * 0.7 + sun8 * sun8 * sun8 * 0.5);
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDirection;
#include <common>
#include <dithering_pars_fragment>
${SKY_FUNCTION}
void main() {
  gl_FragColor = vec4(skyColor(normalize(vDirection)), 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

const CLOUD_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Three unrolled taps of one tileable noise texture. Time never reaches the shader: the CPU
// supplies each layer's offset already wrapped to [0, 1), and UVs stay under about 9, so fp16
// texture coordinates cannot stair-step at the rim.
const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D uNoise;
uniform vec2 uOffsetA;
uniform vec2 uOffsetB;
uniform vec2 uOffsetC;
uniform vec3 uTrough;
uniform vec3 uBody;
uniform vec3 uLit;
varying vec3 vWorld;
#include <common>
#include <dithering_pars_fragment>
${SKY_FUNCTION}

float billow(vec2 p) {
  float a = texture2D(uNoise, p * 0.0208 + uOffsetA).r;
  float b = texture2D(uNoise, p * 0.0476 + uOffsetB).r;
  return a * 0.62 + b * 0.38;
}

void main() {
  vec2 p = vWorld.xz;
  float radius = length(p);
  float height = billow(p);
  float sunward = billow(p + uSunFlat * 2.5);
  float detail = texture2D(uNoise, p * 0.0833 + uOffsetC).r;
  float tops = smoothstep(0.3, 0.78, height + (detail - 0.5) * 0.2);
  float lit = clamp(0.5 + (sunward - height) * 7.0, 0.0, 1.0);
  float toward = dot(p / max(radius, 0.001), uSunFlat) * 0.5 + 0.5;
  float sunSide = 0.2 + 0.8 * toward * toward;
  float front = clamp(-p.y / max(radius, 0.001), 0.0, 1.0);
  float calm = 1.0 - 0.35 * smoothstep(0.3, 0.75, front);
  vec3 color = mix(uTrough, uBody, tops) * calm;
  color += uLit * lit * tops * sunSide;
  vec3 view = normalize(vWorld - cameraPosition);
  float haze = smoothstep(58.0, ${(CLOUD_OUTER_RADIUS - 1).toFixed(1)}, radius);
  color = mix(color, skyColor(view), haze);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

type SkyUniforms = Record<
  'uZenith' | 'uHorizon' | 'uWarm' | 'uGlow' | 'uSunDir' | 'uSunFlat',
  THREE.IUniform
>;

function createSkyUniforms(): SkyUniforms {
  return {
    uZenith: { value: new THREE.Color(SKY_ZENITH) },
    uHorizon: { value: new THREE.Color(SKY_HORIZON) },
    uWarm: { value: new THREE.Color(SKY_WARM) },
    uGlow: { value: new THREE.Color(SKY_GLOW) },
    uSunDir: { value: SUN_DIRECTION.clone() },
    uSunFlat: { value: SUN_FLAT.clone() },
  };
}

function createSky(uniforms: SkyUniforms): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    name: 'cloud-summit-sky',
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: { ...uniforms },
    side: THREE.BackSide,
    depthWrite: false,
    dithering: true,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material);
  sky.name = 'cloud-summit-sky';
  sky.renderOrder = -1000;
  return sky;
}

function createStarSpriteTexture(): THREE.DataTexture {
  const data = new Uint8Array(STAR_SPRITE_SIZE * STAR_SPRITE_SIZE * 4);
  const center = (STAR_SPRITE_SIZE - 1) / 2;
  const radius = STAR_SPRITE_SIZE / 2;
  for (let y = 0; y < STAR_SPRITE_SIZE; y += 1) {
    for (let x = 0; x < STAR_SPRITE_SIZE; x += 1) {
      const distance = Math.hypot(x - center, y - center) / radius;
      const alpha = distance >= 0.94 ? 0 : Math.min(1, Math.max(0, 1 - distance * distance) ** 1.6);
      const offset = (y * STAR_SPRITE_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, STAR_SPRITE_SIZE, STAR_SPRITE_SIZE, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createStars(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const random = seededRandom(0x5354524b);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    // Uniform over the cap above about 50 degrees, where dusk has darkened enough for stars.
    const y = 0.77 + random() * 0.23;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const offset = index * 3;
    positions[offset] = Math.cos(angle) * ring * STAR_RADIUS;
    positions[offset + 1] = y * STAR_RADIUS;
    positions[offset + 2] = Math.sin(angle) * ring * STAR_RADIUS;
    const fade = 0.45 + 0.55 * smoothstep(0.77, 0.95, y);
    const brightness = (random() > 0.92 ? 0.5 + random() * 0.15 : 0.16 + random() * 0.24) * fade;
    colors[offset] = brightness * 0.82;
    colors[offset + 1] = brightness * 0.88;
    colors[offset + 2] = brightness;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    name: 'cloud-summit-stars',
    map: createStarSpriteTexture(),
    size: 0.32,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = 'cloud-summit-stars';
  stars.renderOrder = -900;
  return stars;
}

function cloudHeightAt(radius: number): number {
  return CLOUD_BASE_Y + CLOUD_RISE * (radius / CLOUD_OUTER_RADIUS) ** 2;
}

function createCloudSea(
  skyUniforms: SkyUniforms,
  noise: THREE.DataTexture,
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.RingGeometry(CLOUD_INNER_RADIUS, CLOUD_OUTER_RADIUS, 96, 24);
  geometry.rotateX(-Math.PI / 2);
  geometry.deleteAttribute('uv');
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const radius = Math.hypot(position.getX(index), position.getZ(index));
    position.setY(index, cloudHeightAt(radius));
  }
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    name: 'cloud-summit-cloud-sea',
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    uniforms: {
      ...skyUniforms,
      uNoise: { value: noise },
      uOffsetA: { value: new THREE.Vector2() },
      uOffsetB: { value: new THREE.Vector2() },
      uOffsetC: { value: new THREE.Vector2() },
      uTrough: { value: new THREE.Color(CLOUD_TROUGH) },
      uBody: { value: new THREE.Color(CLOUD_BODY) },
      uLit: { value: new THREE.Color(CLOUD_LIT) },
    },
    dithering: true,
  });
  const clouds = new THREE.Mesh(geometry, material);
  clouds.name = 'cloud-summit-cloud-sea';
  clouds.renderOrder = -950;
  return clouds;
}

interface Peak {
  azimuth: number;
  distance: number;
  top: number;
  width: number;
}

// Peaks inside the pane sector only just break the cloud tops, well below the horizon.
const PEAKS: Peak[] = [
  { azimuth: 98, distance: 76, top: -2, width: 7 },
  { azimuth: 122, distance: 72, top: 3, width: 9 },
  { azimuth: 146, distance: 77, top: 5.5, width: 9 },
  { azimuth: 172, distance: 74, top: 0.5, width: 7 },
  { azimuth: -152, distance: 72, top: 4, width: 10 },
  { azimuth: -118, distance: 76, top: 0, width: 8 },
  { azimuth: -88, distance: 75, top: -3, width: 7 },
  { azimuth: -48, distance: 74, top: -5, width: 7 },
  { azimuth: -14, distance: 78, top: -4.5, width: 8 },
  { azimuth: 36, distance: 75, top: -5, width: 7 },
];
// Lower flanks fade into the cloud body over this height, so peaks sink into mist rather than
// being cut by a hard line where they meet the deck.
const PEAK_MIST_METERS = 8;

function createPeaks(): THREE.Mesh {
  const random = seededRandom(0x5045414b);
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const mist = new THREE.Color(CLOUD_BODY);
  const normal = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const triangle = (
    axis: THREE.Vector3,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
  ): void => {
    normal.crossVectors(edgeA.subVectors(b, a), edgeB.subVectors(c, a)).normalize();
    outward.set((a.x + b.x + c.x) / 3 - axis.x, 0, (a.z + b.z + c.z) / 3 - axis.z);
    if (normal.dot(outward) < 0) normal.negate();
    const facing = Math.max(0, normal.dot(SUN_DIRECTION));
    const shade = 0.85 + facing * 0.6 + (random() - 0.5) * 0.08;
    for (const corner of [a, b, c]) {
      const deck = cloudHeightAt(Math.hypot(corner.x, corner.z));
      const fade = smoothstep(deck + PEAK_MIST_METERS, deck + 0.5, corner.y);
      color.copy(PEAK_TONE).multiplyScalar(shade).lerp(PEAK_HAZE, 0.25).lerp(mist, fade);
      positions.push(corner.x, corner.y, corner.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (const peak of PEAKS) {
    const angle = THREE.MathUtils.degToRad(peak.azimuth);
    const center = new THREE.Vector3(
      Math.sin(angle) * peak.distance,
      0,
      -Math.cos(angle) * peak.distance,
    );
    const base = cloudHeightAt(peak.distance - peak.width * 1.3) - 2;
    const sides = 9;
    const twist = random() * Math.PI * 2;
    const rings = [
      { lift: 0, spread: 1 },
      { lift: 0.5, spread: 0.52 },
      { lift: 0.82, spread: 0.24 },
    ].map((ring, ringIndex) =>
      Array.from({ length: sides }, (_, index) => {
        const theta = twist + (index / sides) * Math.PI * 2 + (random() - 0.5) * 0.25;
        const spread = peak.width * ring.spread * (0.8 + random() * 0.4);
        const y =
          base + (peak.top - base) * ring.lift + (ringIndex > 0 ? (random() - 0.5) * 0.8 : 0);
        return new THREE.Vector3(
          center.x + Math.cos(theta) * spread,
          y,
          center.z + Math.sin(theta) * spread,
        );
      }),
    );
    const apex = new THREE.Vector3(
      center.x + (random() - 0.5) * peak.width * 0.15,
      peak.top,
      center.z + (random() - 0.5) * peak.width * 0.15,
    );
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let index = 0; index < sides; index += 1) {
        const next = (index + 1) % sides;
        triangle(center, rings[ring][index], rings[ring + 1][index], rings[ring][next]);
        triangle(center, rings[ring][next], rings[ring + 1][index], rings[ring + 1][next]);
      }
    }
    const top = rings[rings.length - 1];
    for (let index = 0; index < sides; index += 1)
      triangle(center, top[index], apex, top[(index + 1) % sides]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const peaks = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      name: 'cloud-summit-peaks',
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: false,
      dithering: true,
    }),
  );
  peaks.name = 'cloud-summit-peaks';
  peaks.renderOrder = -940;
  return peaks;
}

function createBoundary(): (theta: number) => number {
  const random = seededRandom(0x45444745);
  const coarse = Array.from({ length: 9 }, () => random());
  const fine = Array.from({ length: 23 }, () => random());
  return (theta: number): number => {
    const t = theta / (Math.PI * 2);
    const wobble = periodicNoise(coarse, t) * 0.7 + periodicNoise(fine, t) * 0.3;
    return PLATFORM_RADIUS + (wobble - 0.5) * 0.7;
  };
}

function setPlanarUv(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const uvs = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    uvs[index * 2] = position.getX(index) / 1.6;
    uvs[index * 2 + 1] = (position.getZ(index) + position.getY(index) * 0.7) / 1.6;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function createFloor(
  boundary: (theta: number) => number,
  material: THREE.MeshBasicMaterial,
): THREE.Mesh {
  const random = seededRandom(0x464c4f52);
  const blotches = Array.from({ length: 13 }, () => random());
  const rings = [0, 0.32, 0.62, 0.86, 1];
  const grid = rings.map((fraction) =>
    Array.from({ length: PLATFORM_SEGMENTS }, (_, index) => {
      const theta = (index / PLATFORM_SEGMENTS) * Math.PI * 2;
      const radius = boundary(theta) * fraction;
      return new THREE.Vector3(
        Math.sin(theta) * radius,
        CLOUD_SUMMIT_FLOOR_Y,
        -Math.cos(theta) * radius,
      );
    }),
  );
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const push = (vertex: THREE.Vector3): void => {
    const radius = Math.hypot(vertex.x, vertex.z);
    const theta = Math.atan2(vertex.x, -vertex.z) / (Math.PI * 2);
    const patch = periodicNoise(blotches, theta * 3 + radius * 0.11);
    color
      .copy(ROCK_TOP)
      .multiplyScalar(0.92 + patch * 0.16)
      .lerp(ROCK_EDGE, smoothstep(2.6, PLATFORM_RADIUS, radius));
    positions.push(vertex.x, vertex.y, vertex.z);
    colors.push(color.r, color.g, color.b);
  };
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    const inner = grid[ring];
    const outer = grid[ring + 1];
    for (let index = 0; index < PLATFORM_SEGMENTS; index += 1) {
      const next = (index + 1) % PLATFORM_SEGMENTS;
      if (ring === 0) {
        push(inner[0]);
        push(outer[next]);
        push(outer[index]);
        continue;
      }
      push(inner[index]);
      push(outer[next]);
      push(outer[index]);
      push(inner[index]);
      push(inner[next]);
      push(outer[next]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  setPlanarUv(geometry);
  geometry.computeBoundingSphere();
  const floor = new THREE.Mesh(geometry, material);
  floor.name = 'cloud-summit-floor';
  return floor;
}

function bakeFacets(
  geometry: THREE.BufferGeometry,
  base: THREE.Color,
  random: () => number,
): THREE.BufferGeometry {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (prepared !== geometry) geometry.dispose();
  prepared.deleteAttribute('uv');
  prepared.computeVertexNormals();
  const position = prepared.getAttribute('position');
  const normal = prepared.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const facetNormal = new THREE.Vector3();
  for (let face = 0; face < position.count; face += 3) {
    facetNormal.fromBufferAttribute(normal, face);
    const depth = smoothstep(0, -14, position.getY(face));
    const shade =
      (0.78 +
        0.3 * Math.max(0, facetNormal.y) +
        0.32 * Math.max(0, facetNormal.dot(SUN_DIRECTION)) +
        (random() - 0.5) * 0.1) *
      (1 - depth * 0.35);
    for (let corner = face; corner < face + 3; corner += 1) {
      colors[corner * 3] = base.r * shade;
      colors[corner * 3 + 1] = base.g * shade;
      colors[corner * 3 + 2] = base.b * shade;
    }
  }
  prepared.deleteAttribute('normal');
  prepared.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return prepared;
}

interface RimStone {
  /** The stone vertex the rim light sits on: high, and toward the platform center. */
  light: THREE.Vector3;
  azimuth: number;
}

function createRock(
  boundary: (theta: number) => number,
  material: THREE.MeshBasicMaterial,
): { rock: THREE.Mesh; stones: RimStone[] } {
  const random = seededRandom(0x434c4946);
  const rows = [
    { scale: 1, y: CLOUD_SUMMIT_FLOOR_Y, jitter: 0 },
    { scale: 1.03, y: -0.32, jitter: 0.05 },
    { scale: 1.08, y: -2.6, jitter: 0.25 },
    { scale: 1.18, y: -7, jitter: 0.5 },
    { scale: 1.42, y: -13, jitter: 0.8 },
    { scale: 1.85, y: -22, jitter: 1.1 },
  ];
  const grid = rows.map((row, rowIndex) =>
    Array.from({ length: PLATFORM_SEGMENTS }, (_, index) => {
      const theta =
        ((index + (rowIndex % 2) * 0.5) / PLATFORM_SEGMENTS) * Math.PI * 2 +
        (rowIndex > 0 ? (random() - 0.5) * 0.05 : 0);
      const radius = boundary(theta) * row.scale + (random() - 0.5) * row.jitter;
      const y = row.y + (rowIndex > 0 ? (random() - 0.5) * row.jitter : 0);
      return new THREE.Vector3(Math.sin(theta) * radius, y, -Math.cos(theta) * radius);
    }),
  );
  const cliffPositions: number[] = [];
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let index = 0; index < PLATFORM_SEGMENTS; index += 1) {
      const next = (index + 1) % PLATFORM_SEGMENTS;
      for (const vertex of [
        grid[row][index],
        grid[row][next],
        grid[row + 1][index],
        grid[row][next],
        grid[row + 1][next],
        grid[row + 1][index],
      ])
        cliffPositions.push(vertex.x, vertex.y, vertex.z);
    }
  }
  const cliff = new THREE.BufferGeometry();
  cliff.setAttribute('position', new THREE.Float32BufferAttribute(cliffPositions, 3));
  const parts: THREE.BufferGeometry[] = [bakeFacets(cliff, CLIFF_TONE, random)];
  const stones: RimStone[] = [];
  const box = new THREE.Box3();
  const rotation = new THREE.Euler();
  for (let index = 0; index < RIM_STONE_COUNT; index += 1) {
    if (random() < 0.12) continue;
    const theta = ((index + (random() - 0.5) * 0.5) / RIM_STONE_COUNT) * Math.PI * 2;
    const radius = boundary(theta) - 0.16;
    const x = Math.sin(theta) * radius;
    const z = -Math.cos(theta) * radius;
    const front = inPaneSector(x, z);
    const width = 0.2 + random() * 0.18;
    const height = front ? 0.1 + random() * 0.14 : 0.2 + random() * 0.28;
    const stone = new THREE.IcosahedronGeometry(1, 0);
    stone.scale(width, Math.max(width, height) * 0.8, width * (0.7 + random() * 0.4));
    stone.applyQuaternion(
      new THREE.Quaternion().setFromEuler(
        rotation.set((random() - 0.5) * 0.4, random() * Math.PI * 2, (random() - 0.5) * 0.4),
      ),
    );
    box.setFromBufferAttribute(stone.getAttribute('position') as THREE.BufferAttribute);
    stone.translate(x, CLOUD_SUMMIT_FLOOR_Y + height - box.max.y, z);
    const corners = stone.getAttribute('position');
    const light = new THREE.Vector3();
    let best = Number.NEGATIVE_INFINITY;
    for (let corner = 0; corner < corners.count; corner += 1) {
      const score =
        corners.getY(corner) - 0.3 * Math.hypot(corners.getX(corner), corners.getZ(corner));
      if (score <= best) continue;
      best = score;
      light.fromBufferAttribute(corners, corner);
    }
    parts.push(bakeFacets(stone, STONE_TONE, random));
    stones.push({ light, azimuth: azimuthOf(x, z) });
  }
  const geometry = mergeOwned(parts, 'rock');
  setPlanarUv(geometry);
  const rock = new THREE.Mesh(geometry, material);
  rock.name = 'cloud-summit-rock';
  return { rock, stones };
}

function createAccents(stones: RimStone[], accent: THREE.Color | null): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  // After rotateX the arc starts at azimuth 90 degrees, so rotateY(20) moves the start to 70 and
  // the 220-degree sweep ends at 290, leaving the pane field clear.
  const inlay = new THREE.TorusGeometry(3.3, 0.016, 3, 64, THREE.MathUtils.degToRad(220));
  inlay.rotateX(Math.PI / 2);
  inlay.rotateY(THREE.MathUtils.degToRad(20));
  inlay.scale(1, 0.25, 1);
  inlay.translate(0, CLOUD_SUMMIT_FLOOR_Y + 0.002, 0);
  parts.push(inlay.toNonIndexed());
  inlay.dispose();
  for (const stone of stones) {
    if (Math.abs(stone.azimuth) < PANE_SECTOR_DEGREES + 10) continue;
    const stud = new THREE.OctahedronGeometry(0.03, 0);
    stud.scale(1, 0.6, 1);
    stud.translate(stone.light.x, stone.light.y - 0.008, stone.light.z);
    parts.push(stud);
  }
  for (const part of parts) {
    part.deleteAttribute('uv');
    part.deleteAttribute('normal');
  }
  const accents = new THREE.Mesh(
    mergeOwned(parts, 'accents'),
    new THREE.MeshBasicMaterial({
      name: 'cloud-summit-accents',
      color: tintToLuminance(new THREE.Color(), new THREE.Color(ACCENT_GLOW), accent),
      fog: false,
      dithering: true,
    }),
  );
  accents.name = 'cloud-summit-accents';
  return accents;
}

function createBirdGeometry(): THREE.BufferGeometry {
  // A V of two tapered wings facing +Z (toward the viewer once oriented), body at the origin.
  const positions = [
    0, 0.05, 0, -0.85, 0.24, 0, 0, -0.05, 0, 0, 0.05, 0, 0, -0.05, 0, 0.85, 0.24, 0, -0.85, 0.24, 0,
    -0.55, 0.13, 0, 0, -0.05, 0, 0.85, 0.24, 0, 0, -0.05, 0, 0.55, 0.13, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function createBirds(): THREE.InstancedMesh {
  const birds = new THREE.InstancedMesh(
    createBirdGeometry(),
    new THREE.MeshBasicMaterial({
      name: 'cloud-summit-birds',
      color: BIRD_TONE,
      side: THREE.DoubleSide,
      fog: false,
      dithering: true,
    }),
    CLOUD_SUMMIT_BIRD_COUNT,
  );
  birds.name = 'cloud-summit-birds';
  birds.count = 0;
  birds.visible = false;
  // Instances move every frame, so a cached bounding sphere would cull them wrongly.
  birds.frustumCulled = false;
  birds.renderOrder = -930;
  return birds;
}

export interface CloudSummitFlockState {
  active: boolean;
  size: number;
  elapsed: number;
  duration: number;
  startAzimuth: number;
  direction: number;
  elevation: number;
  untilNext: number;
  flights: number;
}

/** `accent` retints the rim-stone lights and floor inlay; null keeps the authored dim cyan. */
export function createCloudSummitEnvironment(
  accent: THREE.Color | null = null,
): CloudSummitEnvironment {
  const root = new THREE.Group();
  root.name = 'cloud-summit-environment';
  const skyUniforms = createSkyUniforms();
  const noise = createCloudNoiseTexture();
  const grain = createGrainTexture();
  const rockMaterial = new THREE.MeshBasicMaterial({
    name: 'cloud-summit-rock',
    map: grain,
    vertexColors: true,
    fog: false,
    dithering: true,
  });
  const boundary = createBoundary();
  const clouds = createCloudSea(skyUniforms, noise);
  const { rock, stones } = createRock(boundary, rockMaterial);
  const birds = createBirds();
  root.add(
    createSky(skyUniforms),
    createStars(),
    clouds,
    createPeaks(),
    createFloor(boundary, rockMaterial),
    rock,
    createAccents(stones, accent),
    birds,
  );

  const offsetA = clouds.material.uniforms.uOffsetA.value as THREE.Vector2;
  const offsetB = clouds.material.uniforms.uOffsetB.value as THREE.Vector2;
  const offsetC = clouds.material.uniforms.uOffsetC.value as THREE.Vector2;
  clouds.userData.cloudTime = 0;

  const flockRandom = seededRandom(0x4249524b);
  const flock: CloudSummitFlockState = {
    active: false,
    size: 0,
    elapsed: 0,
    duration: 0,
    startAzimuth: 0,
    direction: 1,
    elevation: 0,
    untilNext: 8 + flockRandom() * 12,
    flights: 0,
  };
  birds.userData.flock = flock;
  const dummy = new THREE.Object3D();

  const startFlight = (): void => {
    const [low, high] = CLOUD_SUMMIT_BIRD_ARC_DEGREES;
    const arc = 40 + flockRandom() * 18;
    flock.direction = flockRandom() < 0.5 ? -1 : 1;
    const begin = low + 4 + flockRandom() * (high - low - 8 - arc);
    flock.startAzimuth = flock.direction > 0 ? begin : begin + arc;
    flock.duration = arc / BIRD_SPEED_DEGREES;
    flock.elevation = 1.2 + flockRandom() * 3.6;
    flock.size = 3 + Math.min(2, Math.floor(flockRandom() * 3));
    flock.elapsed = 0;
    flock.active = true;
    flock.flights += 1;
    flock.untilNext = Math.max(flock.duration + 4, 30 + flockRandom() * 60);
    birds.count = flock.size;
    birds.visible = true;
  };

  const placeBirds = (): void => {
    const fade =
      smoothstep(0, BIRD_FADE_SECONDS, flock.elapsed) *
      smoothstep(0, BIRD_FADE_SECONDS, flock.duration - flock.elapsed);
    const leadAzimuth = flock.startAzimuth + flock.direction * BIRD_SPEED_DEGREES * flock.elapsed;
    for (let index = 0; index < flock.size; index += 1) {
      const rank = Math.ceil(index / 2);
      const side = index % 2 === 0 ? 1 : -1;
      const azimuth = THREE.MathUtils.degToRad(leadAzimuth - flock.direction * rank * 2.1);
      const elevation = THREE.MathUtils.degToRad(flock.elevation + side * rank * 0.55);
      const radius = BIRD_RADIUS + side * rank * 1.5;
      dummy.position.set(
        Math.sin(azimuth) * radius,
        EYE_HEIGHT + Math.tan(elevation) * radius,
        -Math.cos(azimuth) * radius,
      );
      dummy.lookAt(0, dummy.position.y, 0);
      const flap = Math.sin((flock.elapsed * BIRD_FLAP_HZ + index * 0.23) * Math.PI * 2);
      dummy.scale.set(fade, fade * (0.35 + 0.75 * flap), fade);
      dummy.updateMatrix();
      birds.setMatrixAt(index, dummy.matrix);
    }
    birds.instanceMatrix.needsUpdate = true;
  };

  let disposed = false;
  const update = (deltaSeconds: number): void => {
    if (disposed || !root.visible || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const step = Math.min(deltaSeconds, MAX_DELTA);
    const time = ((clouds.userData.cloudTime as number) + step) % CLOUD_SUMMIT_CLOUD_PERIOD;
    clouds.userData.cloudTime = time;
    const phase = time / CLOUD_SUMMIT_CLOUD_PERIOD;
    offsetA.set(wrap01(phase), 0);
    offsetB.set(wrap01(-phase), wrap01(phase));
    offsetC.set(0, wrap01(-phase * 2));

    flock.untilNext -= step;
    if (flock.active) {
      flock.elapsed += step;
      if (flock.elapsed >= flock.duration) {
        flock.active = false;
        birds.count = 0;
        birds.visible = false;
      } else {
        placeBirds();
      }
    }
    if (flock.untilNext <= 0) {
      startFlight();
      placeBirds();
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>([noise, grain]);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    });
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      if (material instanceof THREE.ShaderMaterial)
        for (const uniform of Object.values(material.uniforms))
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    birds.dispose();
    root.removeFromParent();
  };
  return { root, update, dispose, floorY: CLOUD_SUMMIT_FLOOR_Y };
}
