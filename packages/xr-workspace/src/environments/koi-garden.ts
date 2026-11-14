import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tintToLuminance } from '../accent-colors';

export interface KoiGardenEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

export const KOI_GARDEN_FLOOR_Y = 0.035;
/** Water surface, a little below the deck. */
export const KOI_GARDEN_WATER_Y = -0.12;
// Every shader phase is an integer number of cycles per period, so wrapping here is seamless and
// keeps the phases small for mediump.
export const KOI_GARDEN_AMBIENT_PERIOD = 600;
export const KOI_GARDEN_LEAF_INTERVAL: readonly [number, number] = [15, 40];
export const KOI_GARDEN_LEAF_LIFETIME = 14;
/** Azimuths in degrees from -Z toward +X; the front ±75° holds panes, so none stand there. */
export const KOI_GARDEN_LANTERNS: readonly { azimuth: number; radius: number; scale: number }[] = [
  { azimuth: 130, radius: 2.72, scale: 0.85 },
  { azimuth: -135, radius: 2.72, scale: 0.85 },
  { azimuth: 96, radius: 9.6, scale: 1.05 },
  { azimuth: 176, radius: 9.6, scale: 1.1 },
  { azimuth: -102, radius: 9.6, scale: 1 },
];

const DECK_RADIUS = 3;
const COPING_RADIUS = 3.3;
const POND_INNER = 3.22;
const POND_OUTER = 9.3;
const BANK_TOP_RADIUS = 9.7;
const GROUND_RADIUS = 12.6;
const GROUND_Y = 0.08;
const SKY_RADIUS = 80;
const STAR_RADIUS = 76;
const STAR_COUNT = 420;
const STAR_SPRITE_SIZE = 32;
const FLAGSTONE_SIZE = 256;
const FLAGSTONE_CELLS = 4;
const FLAGSTONE_METERS = 2;
const GLOW_MAP_SIZE = 256;
const GLOW_EXTENT = 10;
const HALO_TEXTURE_SIZE = 64;
const EYE_HEIGHT = 1.6;
const MAX_DELTA = 0.25;
const KOI_COUNT = 6;
const KOI_SWAY_CYCLES = 450;
const PAD_LIFT = 0.04;
const LEAF_FALL_SECONDS = 7;
const LEAF_HOLD_SECONDS = 2;
const LEAF_FADE_SECONDS = 5;
const RIPPLE_SECONDS = 6;
const LANTERN_FIREBOX_Y = 0.74;

// sRGB hex values, converted to linear by THREE.Color and lifted out of the Quest 3 black crush.
const SKY_ZENITH = new THREE.Color(0x0d1019);
const SKY_HORIZON = new THREE.Color(0x1a2131);
const NEAR_TREES = new THREE.Color(0x0c0f10);
const FAR_TREES = new THREE.Color(0x121823);
const BANK_MOSS = new THREE.Color(0x141917);
const BANK_ROCK = new THREE.Color(0x1c1d1f);
const DECK_STONE = new THREE.Color(0x262628);
const COPING_STONE = new THREE.Color(0x26272a);
const DECK_SKIRT = new THREE.Color(0x141517);
const LANTERN_STONE = new THREE.Color(0x262627);
const WATER_DEEP = new THREE.Color(0x0b1016);
const WATER_SKY = new THREE.Color(0x151c29);
const WATER_RIPPLE = new THREE.Color(0x0b0f16);
const PAD_CENTER = new THREE.Color(0x1f2d1c);
const PAD_RIM = new THREE.Color(0x152117);
const LEAF_COLOR = new THREE.Color(0x7a3816);
/** The authored lantern glow; dimmer than the desert moon disc. */
export const KOI_GARDEN_GLOW = 0xa8743a;

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

function azimuthPoint(degrees: number, radius: number): THREE.Vector2 {
  const angle = THREE.MathUtils.degToRad(degrees);
  return new THREE.Vector2(Math.sin(angle) * radius, -Math.cos(angle) * radius);
}

function periodicNoise(samples: number[], t: number): number {
  const count = samples.length;
  const scaled = (((t % 1) + 1) % 1) * count;
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return samples[index % count] * (1 - smooth) + samples[(index + 1) % count] * smooth;
}

// Full height away from the panes, about a fifth of it across the front ±55°.
function paneSectorFactor(azimuthDegrees: number): number {
  return 0.2 + 0.8 * smoothstep(55, 95, Math.abs(azimuthDegrees));
}

function finishTexture(texture: THREE.DataTexture, repeat: boolean): THREE.DataTexture {
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Tiling Voronoi flagstones as a luminance multiplier around 0.85, with darker mortar seams.
function createFlagstoneTexture(): THREE.DataTexture {
  const size = FLAGSTONE_SIZE;
  const cells = FLAGSTONE_CELLS;
  const cellSize = size / cells;
  const random = seededRandom(0x4b4f4931);
  const sites = Array.from({ length: cells * cells }, (_, index) => ({
    x: ((index % cells) + 0.2 + random() * 0.6) * cellSize,
    y: (Math.floor(index / cells) + 0.2 + random() * 0.6) * cellSize,
    shade: 0.84 + random() * 0.16,
  }));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let nearest = Number.POSITIVE_INFINITY;
      let second = Number.POSITIVE_INFINITY;
      let shade = 1;
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const wrapX = (cellX + dx + cells) % cells;
          const wrapY = (cellY + dy + cells) % cells;
          const site = sites[wrapY * cells + wrapX];
          const siteX = site.x + (cellX + dx - wrapX) * cellSize;
          const siteY = site.y + (cellY + dy - wrapY) * cellSize;
          const distance = Math.hypot(x - siteX, y - siteY);
          if (distance < nearest) {
            second = nearest;
            nearest = distance;
            shade = site.shade;
          } else if (distance < second) second = distance;
        }
      }
      const seam = smoothstep(1.2, 3.6, second - nearest);
      const grain = 0.92 + random() * 0.08;
      const value = (0.74 + 0.26 * seam) * shade * grain;
      const offset = (y * size + x) * 4;
      const byte = Math.round(Math.min(1, value) * 255);
      data[offset] = byte;
      data[offset + 1] = byte;
      data[offset + 2] = byte;
      data[offset + 3] = 255;
    }
  }
  return finishTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), true);
}

function radialSprite(size: number, falloff: (distance: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center) / (size / 2);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(Math.min(1, Math.max(0, falloff(distance))) * 255);
    }
  }
  return finishTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), false);
}

interface LanternPlacement {
  base: THREE.Vector3;
  light: THREE.Vector3;
  scale: number;
  onDeck: boolean;
}

function lanternPlacements(): LanternPlacement[] {
  return KOI_GARDEN_LANTERNS.map(({ azimuth, radius, scale }) => {
    const at = azimuthPoint(azimuth, radius);
    const onDeck = radius < DECK_RADIUS;
    const baseY = onDeck ? KOI_GARDEN_FLOOR_Y : GROUND_Y - 0.02;
    return {
      base: new THREE.Vector3(at.x, baseY, at.y),
      light: new THREE.Vector3(at.x, baseY + LANTERN_FIREBOX_Y * scale, at.y),
      scale,
      onDeck,
    };
  });
}

// R holds each lantern's reflection streak, which the water shader ripples; G holds the soft
// light pool around its base. Both are static because the viewer stays near the origin.
function createGlowMap(lanterns: LanternPlacement[]): THREE.DataTexture {
  const size = GLOW_MAP_SIZE;
  const data = new Uint8Array(size * size * 4);
  const eyeAboveWater = EYE_HEIGHT - KOI_GARDEN_WATER_Y;
  const streaks = lanterns.map((lantern) => {
    const distance = Math.hypot(lantern.light.x, lantern.light.z);
    const lightAboveWater = lantern.light.y - KOI_GARDEN_WATER_Y;
    const reflected = (distance * eyeAboveWater) / (eyeAboveWater + lightAboveWater);
    const radial = new THREE.Vector2(lantern.light.x, lantern.light.z).normalize();
    return {
      center: radial.clone().multiplyScalar(reflected),
      radial,
      visible: reflected > POND_INNER + 0.2 && reflected < POND_OUTER - 0.2,
      pool: new THREE.Vector2(lantern.base.x, lantern.base.z),
      poolRadius: lantern.onDeck ? 0.9 : 1.2,
    };
  });
  const point = new THREE.Vector2();
  const offset = new THREE.Vector2();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      point.set(
        ((x + 0.5) / size) * 2 * GLOW_EXTENT - GLOW_EXTENT,
        ((y + 0.5) / size) * 2 * GLOW_EXTENT - GLOW_EXTENT,
      );
      let reflection = 0;
      let pool = 0;
      for (const streak of streaks) {
        if (streak.visible) {
          offset.subVectors(point, streak.center);
          const along = offset.dot(streak.radial);
          const across = offset.x * streak.radial.y - offset.y * streak.radial.x;
          reflection += Math.exp(-((along / 0.95) ** 2) - (across / 0.13) ** 2);
        }
        const distance = point.distanceTo(streak.pool) / streak.poolRadius;
        pool += Math.exp(-distance * distance);
      }
      const index = (y * size + x) * 4;
      data[index] = Math.round(Math.min(1, reflection) * 255);
      data[index + 1] = Math.round(Math.min(1, pool) * 255);
      data[index + 2] = 0;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const elevation = position.getY(index) / SKY_RADIUS;
    color.copy(SKY_HORIZON).lerp(SKY_ZENITH, smoothstep(0, 0.6, elevation) ** 0.7);
    color.toArray(colors, index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-sky',
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      dithering: true,
      fog: false,
    }),
  );
  sky.name = 'koi-garden-sky';
  sky.renderOrder = -1000;
  return sky;
}

function createStars(): THREE.Points {
  const random = seededRandom(0x4b535452);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const y = 0.12 + random() * 0.88;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    positions[index * 3] = Math.cos(angle) * ring * STAR_RADIUS;
    positions[index * 3 + 1] = y * STAR_RADIUS;
    positions[index * 3 + 2] = Math.sin(angle) * ring * STAR_RADIUS;
    const bright = random() > 0.95;
    const brightness =
      (bright ? 0.55 + random() * 0.2 : 0.16 + random() * 0.3) * smoothstep(0.1, 0.4, y);
    colors[index * 3] = brightness * 0.82;
    colors[index * 3 + 1] = brightness * 0.88;
    colors[index * 3 + 2] = brightness;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      name: 'koi-garden-stars',
      map: radialSprite(STAR_SPRITE_SIZE, (distance) =>
        distance >= 0.94 ? 0 : (1 - distance * distance) ** 1.6,
      ),
      size: 0.34,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      fog: false,
    }),
  );
  stars.name = 'koi-garden-stars';
  stars.renderOrder = -990;
  return stars;
}

class GeometryBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];

  triangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    colorA: THREE.Color,
    colorB: THREE.Color = colorA,
    colorC: THREE.Color = colorA,
  ): void {
    for (const [vertex, color] of [
      [a, colorA],
      [b, colorB],
      [c, colorC],
    ] as const) {
      this.positions.push(vertex.x, vertex.y, vertex.z);
      this.colors.push(color.r, color.g, color.b);
      this.uvs.push(vertex.x / FLAGSTONE_METERS, vertex.z / FLAGSTONE_METERS);
    }
  }

  build(withUv: boolean): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (withUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function polar(radius: number, angle: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(angle) * radius, y, -Math.cos(angle) * radius);
}

function deckLight(point: THREE.Vector3, lanterns: LanternPlacement[]): number {
  let light = 0;
  for (const lantern of lanterns) {
    if (!lantern.onDeck) continue;
    const distance = Math.hypot(point.x - lantern.base.x, point.z - lantern.base.z) / 0.85;
    light += Math.exp(-distance * distance);
  }
  return light;
}

function createDeck(
  flagstones: THREE.DataTexture,
  lanterns: LanternPlacement[],
  glow: THREE.Color,
): THREE.Mesh {
  const builder = new GeometryBuilder();
  const segments = 96;
  const rings = [0, 0.6, 1.2, 1.7, 2.1, 2.45, 2.75, DECK_RADIUS];
  const warmth = new THREE.Color();
  const tint = (point: THREE.Vector3, base: THREE.Color): THREE.Color =>
    base
      .clone()
      .multiplyScalar(0.9 + 0.1 * (1 - point.length() / COPING_RADIUS))
      .add(warmth.copy(glow).multiplyScalar(0.15 * deckLight(point, lanterns)));
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a0 = (segment / segments) * Math.PI * 2;
      const a1 = ((segment + 1) / segments) * Math.PI * 2;
      const corners = [
        polar(rings[ring], a0, KOI_GARDEN_FLOOR_Y),
        polar(rings[ring], a1, KOI_GARDEN_FLOOR_Y),
        polar(rings[ring + 1], a1, KOI_GARDEN_FLOOR_Y),
        polar(rings[ring + 1], a0, KOI_GARDEN_FLOOR_Y),
      ];
      const shades = corners.map((corner) => tint(corner, DECK_STONE));
      if (ring > 0)
        builder.triangle(corners[0], corners[1], corners[2], shades[0], shades[1], shades[2]);
      builder.triangle(corners[0], corners[2], corners[3], shades[0], shades[2], shades[3]);
    }
  }
  const random = seededRandom(0x4b434f50);
  const copingStones = 30;
  for (let stone = 0; stone < copingStones; stone += 1) {
    const a0 = (stone / copingStones) * Math.PI * 2;
    const a1 = ((stone + 1) / copingStones) * Math.PI * 2;
    const shade = COPING_STONE.clone().multiplyScalar(0.9 + random() * 0.2);
    const y = KOI_GARDEN_FLOOR_Y;
    const steps = 4;
    for (let step = 0; step < steps; step += 1) {
      const b0 = a0 + ((a1 - a0) * step) / steps;
      const b1 = a0 + ((a1 - a0) * (step + 1)) / steps;
      const inner0 = polar(DECK_RADIUS, b0, y);
      const inner1 = polar(DECK_RADIUS, b1, y);
      const outer0 = polar(COPING_RADIUS, b0, y);
      const outer1 = polar(COPING_RADIUS, b1, y);
      const joint0 = step === 0 ? 0.7 : 1;
      const joint1 = step === steps - 1 ? 0.7 : 1;
      const lit = [
        tint(inner0, shade).multiplyScalar(joint0 * 0.85),
        tint(inner1, shade).multiplyScalar(joint1 * 0.85),
        tint(outer0, shade).multiplyScalar(joint0),
        tint(outer1, shade).multiplyScalar(joint1),
      ];
      builder.triangle(inner0, inner1, outer1, lit[0], lit[1], lit[3]);
      builder.triangle(inner0, outer1, outer0, lit[0], lit[3], lit[2]);
      const low0 = polar(COPING_RADIUS, b0, KOI_GARDEN_WATER_Y - 0.06);
      const low1 = polar(COPING_RADIUS, b1, KOI_GARDEN_WATER_Y - 0.06);
      const skirt = DECK_SKIRT.clone().add(
        warmth.copy(glow).multiplyScalar(0.12 * deckLight(outer0, lanterns)),
      );
      builder.triangle(outer0, low1, outer1, skirt, skirt, skirt);
      builder.triangle(outer0, low0, low1, skirt, skirt, skirt);
    }
  }
  const deck = new THREE.Mesh(
    builder.build(true),
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-deck',
      map: flagstones,
      vertexColors: true,
      dithering: true,
      fog: false,
    }),
  );
  deck.name = 'koi-garden-deck';
  return deck;
}

const WATER_VERTEX = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Three fixed wave layers, no loops. Time never enters a sin argument: the CPU supplies each
// layer's phase as a unit (cos, sin) pair and the shader uses angle addition, so fp16
// quantization cannot make the ripples stutter. The leaf ripple is a single Gaussian ring.
const WATER_FRAGMENT = /* glsl */ `
uniform sampler2D uGlowMap;
uniform vec2 uWaveA;
uniform vec2 uWaveB;
uniform vec2 uWaveC;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uRipple;
uniform vec3 uGlow;
uniform vec4 uDrop;
varying vec2 vWorld;
#include <common>
#include <dithering_pars_fragment>

void wave(vec2 p, vec2 k, vec2 phase, float weight, inout float height, inout vec2 slope) {
  float a = dot(p, k);
  float s = sin(a);
  float c = cos(a);
  height += weight * (s * phase.x + c * phase.y);
  slope += k * weight * (c * phase.x - s * phase.y);
}

void main() {
  vec2 p = vWorld;
  float radius = length(p);
  float height = 0.0;
  vec2 slope = vec2(0.0);
  wave(p, vec2(1.7, 0.9), uWaveA, 0.5, height, slope);
  wave(p, vec2(-0.8, 2.1), uWaveB, 0.32, height, slope);
  wave(p, vec2(2.6, -1.9), uWaveC, 0.18, height, slope);
  float distant = smoothstep(3.0, 9.5, radius);
  vec3 color = mix(uDeep, uSky, distant * 0.55);
  color += uRipple * (0.5 + 0.5 * height) * (0.35 + 0.65 * distant);
  vec2 uv = (p + ${GLOW_EXTENT.toFixed(1)}) / ${(GLOW_EXTENT * 2).toFixed(1)};
  vec2 glow = texture2D(uGlowMap, uv + slope * 0.0035).rg;
  float bands = smoothstep(-0.7, 0.9, height);
  color += uGlow * (glow.r * (0.12 + 0.38 * bands) + glow.g * 0.16);
  float ring = clamp(abs(length(p - uDrop.xy) - uDrop.z), 0.0, 1.0);
  color += uRipple * 1.6 * exp(-ring * ring * 220.0) * uDrop.w;
  float edge = smoothstep(${POND_INNER.toFixed(2)}, 3.6, radius) *
    (1.0 - smoothstep(8.8, ${POND_OUTER.toFixed(2)}, radius));
  color *= 0.6 + 0.4 * edge;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

function createWater(
  glowMap: THREE.DataTexture,
  glow: THREE.Color,
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.RingGeometry(POND_INNER, POND_OUTER, 128, 6);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, KOI_GARDEN_WATER_Y, 0);
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');
  const material = new THREE.ShaderMaterial({
    name: 'koi-garden-water',
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: {
      uGlowMap: { value: glowMap },
      uWaveA: { value: new THREE.Vector2(1, 0) },
      uWaveB: { value: new THREE.Vector2(1, 0) },
      uWaveC: { value: new THREE.Vector2(1, 0) },
      uDeep: { value: WATER_DEEP.clone() },
      uSky: { value: WATER_SKY.clone() },
      uRipple: { value: WATER_RIPPLE.clone() },
      uGlow: { value: glow.clone() },
      uDrop: { value: new THREE.Vector4(0, 0, 0, 0) },
    },
    dithering: true,
  });
  const water = new THREE.Mesh(geometry, material);
  water.name = 'koi-garden-water';
  return water;
}

function shadeByNormal(geometry: THREE.BufferGeometry, base: THREE.Color): THREE.BufferGeometry {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (prepared !== geometry) geometry.dispose();
  prepared.computeVertexNormals();
  const normal = prepared.getAttribute('normal');
  const position = prepared.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const shade = 0.7 + 0.35 * Math.max(0, normal.getY(index)) + 0.1 * normal.getX(index);
    colors[index * 3] = base.r * shade;
    colors[index * 3 + 1] = base.g * shade;
    colors[index * 3 + 2] = base.b * shade;
  }
  prepared.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  prepared.deleteAttribute('uv');
  prepared.deleteAttribute('normal');
  return prepared;
}

function mergeOwned(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`Unable to merge ${name}`);
  merged.computeBoundingSphere();
  return merged;
}

function addTreeBand(
  builder: GeometryBuilder,
  random: () => number,
  radius: number,
  segments: number,
  minimum: number,
  maximum: number,
  crowns: number,
  tone: THREE.Color,
): void {
  const coarse = Array.from({ length: 9 }, () => random());
  const medium = Array.from({ length: 31 }, () => random());
  const fine = Array.from({ length: 97 }, () => random());
  const crownList = Array.from({ length: crowns }, () => ({
    center: random() * 360 - 180,
    width: 7 + random() * 8,
    height: maximum * (0.95 + random() * 0.15),
  }));
  const heights = Array.from({ length: segments }, (_, index) => {
    const t = index / segments;
    const azimuth = t * 360 - 180;
    let height =
      minimum +
      (maximum - minimum) *
        (periodicNoise(coarse, t) * 0.5 +
          periodicNoise(medium, t) * 0.32 +
          periodicNoise(fine, t) * 0.18);
    for (const crown of crownList) {
      const distance = Math.abs(((azimuth - crown.center + 540) % 360) - 180) / crown.width;
      if (distance < 1)
        height = Math.max(height, crown.height * Math.sqrt(1 - distance * distance));
    }
    return height * paneSectorFactor(azimuth) + (random() - 0.5) * 0.18;
  });
  const color = new THREE.Color();
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const a0 = THREE.MathUtils.degToRad((index / segments) * 360 - 180);
    const a1 = THREE.MathUtils.degToRad(((index + 1) / segments) * 360 - 180);
    const foot0 = polar(radius, a0, -0.4);
    const foot1 = polar(radius, a1, -0.4);
    const top0 = polar(radius, a0, heights[index]);
    const top1 = polar(radius, a1, heights[next]);
    color.copy(tone).multiplyScalar(0.92 + random() * 0.16);
    builder.triangle(foot0, top1, top0, color);
    builder.triangle(foot0, foot1, top1, color);
  }
}

function addBamboo(builder: GeometryBuilder, random: () => number): void {
  const groves = [
    { center: 108, spread: 18, count: 26 },
    { center: -115, spread: 20, count: 28 },
    { center: 168, spread: 14, count: 20 },
  ];
  const color = new THREE.Color();
  for (const grove of groves) {
    for (let culm = 0; culm < grove.count; culm += 1) {
      const azimuth = grove.center + (random() - 0.5) * 2 * grove.spread;
      const angle = THREE.MathUtils.degToRad(azimuth);
      const radius = 10.4 + random() * 1.1;
      const height = 4.2 + random() * 3.4;
      const width = 0.05 + random() * 0.035;
      const lean = (random() - 0.5) * 0.7;
      const tangent = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const base = polar(radius, angle, -0.2);
      const top = base.clone().addScaledVector(tangent, lean).setY(height);
      color.copy(NEAR_TREES).multiplyScalar(0.9 + random() * 0.2);
      const b0 = base.clone().addScaledVector(tangent, -width / 2);
      const b1 = base.clone().addScaledVector(tangent, width / 2);
      const t0 = top.clone().addScaledVector(tangent, -width * 0.35);
      const t1 = top.clone().addScaledVector(tangent, width * 0.35);
      builder.triangle(b0, t1, t0, color);
      builder.triangle(b0, b1, t1, color);
      const leaves = 5 + Math.floor(random() * 5);
      for (let leaf = 0; leaf < leaves; leaf += 1) {
        const along = 0.55 + random() * 0.45;
        const stem = base.clone().lerp(top, along);
        const side = random() > 0.5 ? 1 : -1;
        const length = 0.35 + random() * 0.4;
        const droop = 0.08 + random() * 0.2;
        const tip = stem
          .clone()
          .addScaledVector(tangent, side * length)
          .setY(stem.y - droop);
        const shoulder = stem
          .clone()
          .addScaledVector(tangent, side * length * 0.4)
          .setY(stem.y + 0.05);
        builder.triangle(stem, side > 0 ? tip : shoulder, side > 0 ? shoulder : tip, color);
      }
    }
  }
}

function createSurroundings(): THREE.Mesh {
  const random = seededRandom(0x4b475244);
  const builder = new GeometryBuilder();
  const segments = 128;
  const rings = [
    { radius: POND_OUTER - 0.25, y: KOI_GARDEN_WATER_Y - 0.08, tone: BANK_MOSS, shade: 0.6 },
    { radius: BANK_TOP_RADIUS, y: GROUND_Y, tone: BANK_MOSS, shade: 0.9 },
    { radius: GROUND_RADIUS, y: GROUND_Y, tone: BANK_MOSS, shade: 0.75 },
    { radius: 15, y: GROUND_Y, tone: BANK_MOSS, shade: 0.6 },
  ];
  const color = new THREE.Color();
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    const inner = rings[ring];
    const outer = rings[ring + 1];
    for (let segment = 0; segment < segments; segment += 1) {
      const a0 = (segment / segments) * Math.PI * 2;
      const a1 = ((segment + 1) / segments) * Math.PI * 2;
      const i0 = polar(inner.radius, a0, inner.y);
      const i1 = polar(inner.radius, a1, inner.y);
      const o0 = polar(outer.radius, a0, outer.y);
      const o1 = polar(outer.radius, a1, outer.y);
      color.copy(inner.tone).multiplyScalar(inner.shade * (0.9 + random() * 0.2));
      const outerColor = outer.tone.clone().multiplyScalar(outer.shade);
      builder.triangle(i0, o1, i1, color, outerColor, color);
      builder.triangle(i0, o0, o1, color, outerColor, outerColor);
    }
  }
  addTreeBand(builder, random, 14.6, 240, 3.2, 5.8, 10, FAR_TREES);
  addTreeBand(builder, random, 12, 360, 2.2, 4.2, 14, NEAR_TREES);
  addBamboo(builder, random);
  const parts: THREE.BufferGeometry[] = [builder.build(false)];
  for (let rock = 0; rock < 44; rock += 1) {
    const angle = ((rock + random() * 0.6) / 44) * Math.PI * 2;
    const radius = POND_OUTER - 0.05 + random() * 0.35;
    const size = 0.16 + random() * 0.2;
    const stone = new THREE.IcosahedronGeometry(size, 0);
    stone.scale(1.2 + random() * 0.5, 0.45 + random() * 0.25, 1 + random() * 0.4);
    stone.rotateY(random() * Math.PI);
    const at = polar(radius, angle, KOI_GARDEN_WATER_Y + size * 0.15);
    stone.translate(at.x, at.y, at.z);
    parts.push(shadeByNormal(stone, BANK_ROCK.clone().multiplyScalar(0.8 + random() * 0.3)));
  }
  const surroundings = new THREE.Mesh(
    mergeOwned(parts, 'surroundings'),
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-surroundings',
      vertexColors: true,
      side: THREE.DoubleSide,
      dithering: true,
      fog: false,
    }),
  );
  surroundings.name = 'koi-garden-surroundings';
  return surroundings;
}

function addLanternPart(
  parts: THREE.BufferGeometry[],
  geometry: THREE.BufferGeometry,
  lantern: LanternPlacement,
  y: number,
  glow: THREE.Color,
): void {
  geometry.scale(lantern.scale, lantern.scale, lantern.scale);
  geometry.translate(lantern.base.x, lantern.base.y + y * lantern.scale, lantern.base.z);
  const shaded = shadeByNormal(geometry, LANTERN_STONE);
  const position = shaded.getAttribute('position');
  const color = shaded.getAttribute('color');
  for (let index = 0; index < position.count; index += 1) {
    const distance =
      Math.hypot(
        position.getX(index) - lantern.light.x,
        position.getY(index) - lantern.light.y,
        position.getZ(index) - lantern.light.z,
      ) / lantern.scale;
    const warm = 0.3 * Math.exp(-((distance / 0.22) ** 2));
    color.setXYZ(
      index,
      color.getX(index) + glow.r * warm,
      color.getY(index) + glow.g * warm,
      color.getZ(index) + glow.b * warm,
    );
  }
  parts.push(shaded);
}

function createLanterns(
  lanterns: LanternPlacement[],
  glow: THREE.Color,
  haloTexture: THREE.DataTexture,
): THREE.Mesh[] {
  const stone: THREE.BufferGeometry[] = [];
  const windows: THREE.BufferGeometry[] = [];
  const halos: THREE.BufferGeometry[] = [];
  const facing = new THREE.Object3D();
  for (const lantern of lanterns) {
    const fireboxHalf = 0.09;
    addLanternPart(stone, new THREE.CylinderGeometry(0.2, 0.24, 0.12, 6), lantern, 0.06, glow);
    addLanternPart(stone, new THREE.CylinderGeometry(0.06, 0.075, 0.42, 6), lantern, 0.33, glow);
    addLanternPart(stone, new THREE.CylinderGeometry(0.19, 0.16, 0.07, 6), lantern, 0.575, glow);
    addLanternPart(
      stone,
      new THREE.CylinderGeometry(0.135, 0.135, fireboxHalf * 2, 6),
      lantern,
      LANTERN_FIREBOX_Y,
      glow,
    );
    addLanternPart(stone, new THREE.ConeGeometry(0.32, 0.17, 6), lantern, 0.915, glow);
    addLanternPart(stone, new THREE.SphereGeometry(0.035, 6, 4), lantern, 1.02, glow);
    const apothem = 0.135 * Math.cos(Math.PI / 6) + 0.003;
    for (let face = 0; face < 6; face += 1) {
      const angle = (face + 0.5) * (Math.PI / 3);
      const pane = new THREE.PlaneGeometry(0.075, 0.12);
      pane.translate(0, 0, apothem);
      pane.rotateY(angle);
      pane.scale(lantern.scale, lantern.scale, lantern.scale);
      pane.translate(lantern.light.x, lantern.light.y, lantern.light.z);
      const flat = pane.toNonIndexed();
      pane.dispose();
      flat.deleteAttribute('uv');
      flat.deleteAttribute('normal');
      windows.push(flat);
    }
    const haloSize = (lantern.onDeck ? 0.8 : 1.3) * lantern.scale;
    const halo = new THREE.PlaneGeometry(haloSize, haloSize);
    facing.position.copy(lantern.light);
    facing.lookAt(0, EYE_HEIGHT, 0);
    facing.updateMatrix();
    halo.applyMatrix4(facing.matrix);
    halo.deleteAttribute('normal');
    halos.push(halo);
  }
  const stoneMesh = new THREE.Mesh(
    mergeOwned(stone, 'lantern stone'),
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-lantern-stone',
      vertexColors: true,
      dithering: true,
      fog: false,
    }),
  );
  stoneMesh.name = 'koi-garden-lantern-stone';
  const windowMesh = new THREE.Mesh(
    mergeOwned(windows, 'lantern windows'),
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-lantern-glow',
      color: glow.clone(),
      dithering: true,
      fog: false,
    }),
  );
  windowMesh.name = 'koi-garden-lantern-glow';
  const haloMesh = new THREE.Mesh(
    mergeOwned(halos, 'lantern halos'),
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-lantern-halo',
      color: glow.clone(),
      map: haloTexture,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  haloMesh.name = 'koi-garden-lantern-halo';
  return [stoneMesh, windowMesh, haloMesh];
}

const KOI_VERTEX = /* glsl */ `
attribute vec3 koiColorA;
attribute vec3 koiColorB;
attribute vec3 koiColorC;
attribute vec3 koiPattern;
attribute vec2 koiSway;
uniform vec2 uSway;
uniform float uSwayAmplitude;
varying vec3 vColor;
void main() {
  vec3 p = position;
  float tail = clamp((0.16 - p.z) / 0.48, 0.0, 1.0);
  // cos and sin of the shared sway phase plus this fish's fixed offset.
  vec2 phase = vec2(
    uSway.x * koiSway.x - uSway.y * koiSway.y,
    uSway.y * koiSway.x + uSway.x * koiSway.y
  );
  float k = p.z * 7.0;
  p.x += uSwayAmplitude * tail * tail * (sin(k) * phase.x + cos(k) * phase.y);
  vColor = koiColorA * koiPattern.x + koiColorB * koiPattern.y + koiColorC * koiPattern.z;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const KOI_FRAGMENT = /* glsl */ `
uniform vec3 uWater;
uniform float uClarity;
varying vec3 vColor;
#include <common>
#include <dithering_pars_fragment>
void main() {
  gl_FragColor = vec4(mix(uWater, vColor, uClarity), 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

interface KoiPattern {
  base: THREE.Color;
  fin: THREE.Color;
  patches: { x: number; z: number; radius: number; color: THREE.Color }[];
}

const KOI_WHITE = new THREE.Color(0x9a978f);
const KOI_ORANGE = new THREE.Color(0xa8441a);
const KOI_BLACK = new THREE.Color(0x18181b);
const KOI_GOLD = new THREE.Color(0xa86d22);

const KOI_PATTERNS: KoiPattern[] = [
  {
    base: KOI_WHITE,
    fin: new THREE.Color(0x77756f),
    patches: [
      { x: 0, z: 0.19, radius: 0.06, color: KOI_ORANGE },
      { x: 0.02, z: 0.05, radius: 0.075, color: KOI_ORANGE },
      { x: -0.03, z: -0.06, radius: 0.055, color: KOI_ORANGE },
    ],
  },
  {
    base: KOI_BLACK,
    fin: new THREE.Color(0x3a3634),
    patches: [
      { x: 0, z: 0.16, radius: 0.07, color: KOI_ORANGE },
      { x: -0.03, z: 0.02, radius: 0.06, color: KOI_WHITE },
      { x: 0.03, z: -0.05, radius: 0.06, color: KOI_ORANGE },
      { x: 0, z: -0.12, radius: 0.04, color: KOI_WHITE },
    ],
  },
  {
    base: KOI_GOLD,
    fin: new THREE.Color(0x8a5a20),
    patches: [{ x: 0, z: 0.05, radius: 0.12, color: new THREE.Color(0xb47a2c) }],
  },
];

function koiColor(pattern: KoiPattern, x: number, z: number, edge: number): THREE.Color {
  const color = pattern.base.clone();
  for (const patch of pattern.patches) {
    const distance = Math.hypot(x - patch.x, z - patch.z) / patch.radius;
    color.lerp(patch.color, 1 - smoothstep(0.7, 1.15, distance));
  }
  return color.multiplyScalar(1 - 0.22 * edge);
}

const KOI_WIDTHS = [0.018, 0.045, 0.062, 0.07, 0.07, 0.065, 0.056, 0.045, 0.033, 0.022, 0.014];
const KOI_HEAD_Z = 0.25;
const KOI_PEDUNCLE_Z = -0.15;
const KOI_COLUMNS = [-1, -0.6, -0.25, 0, 0.25, 0.6, 1];

// Top surface only: the fish lie just above the water and are only ever seen from above.
function createKoiGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[][] = [[], [], []];
  const push = (point: THREE.Vector3, fin: boolean, edge: number): void => {
    positions.push(point.x, point.y, point.z);
    KOI_PATTERNS.forEach((pattern, index) => {
      const color = fin
        ? pattern.fin.clone()
        : koiColor(pattern, point.x, point.z, Math.min(1, edge));
      colors[index].push(color.r, color.g, color.b);
    });
  };
  const stations = KOI_WIDTHS.length;
  const grid = KOI_WIDTHS.map((width, station) => {
    const z = KOI_HEAD_Z + ((KOI_PEDUNCLE_Z - KOI_HEAD_Z) * station) / (stations - 1);
    return KOI_COLUMNS.map(
      (column) =>
        new THREE.Vector3(column * width, 0.012 * (width / 0.07) * (1 - column * column), z),
    );
  });
  for (let station = 0; station < stations - 1; station += 1) {
    for (let column = 0; column < KOI_COLUMNS.length - 1; column += 1) {
      const a = grid[station][column];
      const b = grid[station][column + 1];
      const c = grid[station + 1][column + 1];
      const d = grid[station + 1][column];
      const edgeA = Math.abs(KOI_COLUMNS[column]);
      const edgeB = Math.abs(KOI_COLUMNS[column + 1]);
      for (const [point, edge] of [
        [a, edgeA],
        [d, edgeA],
        [c, edgeB],
        [a, edgeA],
        [c, edgeB],
        [b, edgeB],
      ] as const)
        push(point, false, edge);
    }
  }
  const finY = 0.002;
  const fins: THREE.Vector3[][] = [
    // Forked tail.
    [
      new THREE.Vector3(-0.014, finY, KOI_PEDUNCLE_Z),
      new THREE.Vector3(-0.1, finY, -0.33),
      new THREE.Vector3(0, finY, -0.25),
    ],
    [
      new THREE.Vector3(0.014, finY, KOI_PEDUNCLE_Z),
      new THREE.Vector3(-0.014, finY, KOI_PEDUNCLE_Z),
      new THREE.Vector3(0, finY, -0.25),
    ],
    [
      new THREE.Vector3(0.014, finY, KOI_PEDUNCLE_Z),
      new THREE.Vector3(0, finY, -0.25),
      new THREE.Vector3(0.1, finY, -0.33),
    ],
    // Pectoral fins.
    [
      new THREE.Vector3(-0.06, finY, 0.14),
      new THREE.Vector3(-0.13, finY, 0.06),
      new THREE.Vector3(-0.065, finY, 0.09),
    ],
    [
      new THREE.Vector3(0.06, finY, 0.14),
      new THREE.Vector3(0.065, finY, 0.09),
      new THREE.Vector3(0.13, finY, 0.06),
    ],
  ];
  for (const fin of fins) for (const point of fin) push(point, true, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('koiColorA', new THREE.Float32BufferAttribute(colors[0], 3));
  geometry.setAttribute('koiColorB', new THREE.Float32BufferAttribute(colors[1], 3));
  geometry.setAttribute('koiColorC', new THREE.Float32BufferAttribute(colors[2], 3));
  geometry.computeBoundingSphere();
  return geometry;
}

interface KoiSwimmer {
  curve: THREE.CatmullRomCurve3;
  length: number;
  speed: number;
  direction: 1 | -1;
  progress: number;
  scale: number;
}

const KOI_LOOPS: {
  center: number;
  spread: number;
  radius: number;
  depth: number;
  eight: boolean;
}[] = [
  { center: 96, spread: 24, radius: 4.6, depth: 0.8, eight: false },
  { center: 150, spread: 20, radius: 6.3, depth: 1.5, eight: true },
  { center: -122, spread: 26, radius: 5.2, depth: 1.2, eight: false },
  { center: 178, spread: 22, radius: 4.5, depth: 0.7, eight: true },
  { center: -80, spread: 16, radius: 6.6, depth: 1.4, eight: false },
  { center: 124, spread: 18, radius: 7.4, depth: 0.9, eight: false },
];

function createSwimmers(): KoiSwimmer[] {
  const random = seededRandom(0x4b4f4950);
  return KOI_LOOPS.map((loop, index) => {
    const y = KOI_GARDEN_WATER_Y + 0.006 + index * 0.004;
    const points = Array.from({ length: 12 }, (_, step) => {
      const theta = (step / 12) * Math.PI * 2;
      const azimuth = loop.eight
        ? loop.center + loop.spread * Math.sin(theta)
        : loop.center + loop.spread * Math.cos(theta);
      const radius = loop.eight
        ? loop.radius + loop.depth * Math.sin(theta * 2)
        : loop.radius + loop.depth * Math.sin(theta);
      const jitter = (random() - 0.5) * 0.25;
      const at = azimuthPoint(azimuth, radius + jitter);
      return new THREE.Vector3(at.x, y, at.y);
    });
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    curve.arcLengthDivisions = 400;
    return {
      curve,
      length: curve.getLength(),
      speed: 0.22 + random() * 0.14,
      direction: random() > 0.5 ? 1 : -1,
      progress: random(),
      scale: 0.88 + random() * 0.3,
    };
  });
}

function createKoi(): THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = createKoiGeometry();
  const random = seededRandom(0x4b4f5357);
  const patterns = new Float32Array(KOI_COUNT * 3);
  const sway = new Float32Array(KOI_COUNT * 2);
  for (let index = 0; index < KOI_COUNT; index += 1) {
    patterns[index * 3 + (index % 3)] = 1;
    const offset = random() * Math.PI * 2;
    sway[index * 2] = Math.cos(offset);
    sway[index * 2 + 1] = Math.sin(offset);
  }
  geometry.setAttribute('koiPattern', new THREE.InstancedBufferAttribute(patterns, 3));
  geometry.setAttribute('koiSway', new THREE.InstancedBufferAttribute(sway, 2));
  const material = new THREE.ShaderMaterial({
    name: 'koi-garden-koi',
    vertexShader: KOI_VERTEX,
    fragmentShader: KOI_FRAGMENT,
    uniforms: {
      uSway: { value: new THREE.Vector2(1, 0) },
      uSwayAmplitude: { value: 0.035 },
      uWater: { value: WATER_DEEP.clone() },
      uClarity: { value: 0.72 },
    },
    side: THREE.DoubleSide,
    dithering: true,
  });
  const koi = new THREE.InstancedMesh(geometry, material, KOI_COUNT);
  koi.name = 'koi-garden-koi';
  koi.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  koi.frustumCulled = false;
  return koi;
}

interface LilyPad {
  x: number;
  z: number;
  orbit: number;
  orbitCycles: number;
  orbitPhase: number;
  spinCycles: number;
  spinPhase: number;
  scale: number;
}

const PAD_CLUSTERS = [
  { azimuth: 108, radius: 6.6 },
  { azimuth: 160, radius: 5 },
  { azimuth: -142, radius: 7.2 },
  { azimuth: -96, radius: 4.7 },
];

function createPads(): LilyPad[] {
  const random = seededRandom(0x4c494c59);
  const pads: LilyPad[] = [];
  for (const cluster of PAD_CLUSTERS) {
    const center = azimuthPoint(cluster.azimuth, cluster.radius);
    const count = 3 + Math.floor(random() * 2);
    for (let pad = 0; pad < count; pad += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 0.25 + random() * 0.55;
      pads.push({
        x: center.x + Math.cos(angle) * distance,
        z: center.y + Math.sin(angle) * distance,
        orbit: 0.12 + random() * 0.25,
        orbitCycles: (2 + Math.floor(random() * 4)) * (random() > 0.5 ? 1 : -1),
        orbitPhase: random() * Math.PI * 2,
        spinCycles: random() > 0.5 ? 1 : -1,
        spinPhase: random() * Math.PI * 2,
        scale: 0.16 + random() * 0.16,
      });
    }
  }
  return pads;
}

function createPadGeometry(): THREE.BufferGeometry {
  const builder = new GeometryBuilder();
  const segments = 18;
  const notch = 0.32;
  const center = new THREE.Vector3(0, 0.004, 0);
  for (let segment = 0; segment < segments; segment += 1) {
    const a0 = notch / 2 + ((Math.PI * 2 - notch) * segment) / segments;
    const a1 = notch / 2 + ((Math.PI * 2 - notch) * (segment + 1)) / segments;
    const rim0 = new THREE.Vector3(Math.sin(a0), 0.008, Math.cos(a0));
    const rim1 = new THREE.Vector3(Math.sin(a1), 0.008, Math.cos(a1));
    const vein = segment % 3 === 0 ? 1.12 : 1;
    builder.triangle(center, rim0, rim1, PAD_CENTER.clone().multiplyScalar(vein), PAD_RIM, PAD_RIM);
  }
  return builder.build(false);
}

function createPadMesh(count: number): THREE.InstancedMesh {
  const pads = new THREE.InstancedMesh(
    createPadGeometry(),
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-lily-pads',
      vertexColors: true,
      side: THREE.DoubleSide,
      dithering: true,
      fog: false,
    }),
    count,
  );
  pads.name = 'koi-garden-lily-pads';
  pads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pads.frustumCulled = false;
  return pads;
}

function createLeafMesh(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const builder = new GeometryBuilder();
  const tip = new THREE.Vector3(0, 0, 0.12);
  const stem = new THREE.Vector3(0, 0, -0.08);
  const ridge = new THREE.Vector3(0, 0.012, 0.015);
  const left = new THREE.Vector3(-0.075, 0, 0);
  const right = new THREE.Vector3(0.075, 0, 0);
  const dark = LEAF_COLOR.clone().multiplyScalar(0.8);
  builder.triangle(left, ridge, tip, dark, LEAF_COLOR, LEAF_COLOR);
  builder.triangle(ridge, right, tip, LEAF_COLOR, dark, LEAF_COLOR);
  builder.triangle(left, stem, ridge, dark, LEAF_COLOR, LEAF_COLOR);
  builder.triangle(ridge, stem, right, LEAF_COLOR, LEAF_COLOR, dark);
  const leaf = new THREE.Mesh(
    builder.build(false),
    new THREE.MeshBasicMaterial({
      name: 'koi-garden-leaf',
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      dithering: true,
      fog: false,
    }),
  );
  leaf.name = 'koi-garden-leaf';
  leaf.visible = false;
  leaf.frustumCulled = false;
  return leaf;
}

interface LeafEvent {
  startX: number;
  startZ: number;
  startY: number;
  landX: number;
  landZ: number;
  sideX: number;
  sideZ: number;
  spin: number;
}

/**
 * `accent` retints the lantern glow (window panes, halos, their reflection on the water and the
 * warm pools baked into the deck); null keeps the authored warm amber.
 */
export function createKoiGardenEnvironment(
  accent: THREE.Color | null = null,
): KoiGardenEnvironment {
  const root = new THREE.Group();
  root.name = 'koi-garden-environment';
  const glow = tintToLuminance(new THREE.Color(), new THREE.Color(KOI_GARDEN_GLOW), accent);
  const lanterns = lanternPlacements();
  const flagstones = createFlagstoneTexture();
  const glowMap = createGlowMap(lanterns);
  const haloTexture = radialSprite(HALO_TEXTURE_SIZE, (distance) =>
    distance >= 1 ? 0 : (1 - distance) ** 2.4,
  );
  const water = createWater(glowMap, glow);
  const koi = createKoi();
  const swimmers = createSwimmers();
  const padStates = createPads();
  const pads = createPadMesh(padStates.length);
  const leaf = createLeafMesh();
  root.add(
    createSky(),
    createStars(),
    createSurroundings(),
    createDeck(flagstones, lanterns, glow),
    water,
    ...createLanterns(lanterns, glow, haloTexture),
    koi,
    pads,
    leaf,
  );

  const uniforms = water.material.uniforms;
  const waveA = uniforms.uWaveA.value as THREE.Vector2;
  const waveB = uniforms.uWaveB.value as THREE.Vector2;
  const waveC = uniforms.uWaveC.value as THREE.Vector2;
  const drop = uniforms.uDrop.value as THREE.Vector4;
  const sway = koi.material.uniforms.uSway.value as THREE.Vector2;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const leafRandom = seededRandom(0x4c454146);
  const leafInterval = (): number =>
    KOI_GARDEN_LEAF_INTERVAL[0] +
    leafRandom() * (KOI_GARDEN_LEAF_INTERVAL[1] - KOI_GARDEN_LEAF_INTERVAL[0]);
  const leafEvent: LeafEvent = {
    startX: 0,
    startZ: 0,
    startY: 0,
    landX: 0,
    landZ: 0,
    sideX: 0,
    sideZ: 0,
    spin: 0,
  };
  const leafState = { sinceStart: 0, next: leafInterval(), started: false };
  water.userData.ambientTime = 0;
  leaf.userData.event = leafEvent;

  const placeKoi = (deltaSeconds: number): void => {
    for (let index = 0; index < swimmers.length; index += 1) {
      const swimmer = swimmers[index];
      swimmer.progress =
        (swimmer.progress +
          (swimmer.direction * deltaSeconds * swimmer.speed) / swimmer.length +
          1) %
        1;
      swimmer.curve.getPointAt(swimmer.progress, here);
      swimmer.curve.getPointAt((swimmer.progress + swimmer.direction * 0.002 + 1) % 1, ahead);
      quaternion.setFromAxisAngle(up, Math.atan2(ahead.x - here.x, ahead.z - here.z));
      matrix.compose(here, quaternion, scale.setScalar(swimmer.scale));
      koi.setMatrixAt(index, matrix);
    }
    koi.instanceMatrix.needsUpdate = true;
  };

  const placePads = (time: number): void => {
    const turn = (Math.PI * 2 * time) / KOI_GARDEN_AMBIENT_PERIOD;
    for (let index = 0; index < padStates.length; index += 1) {
      const pad = padStates[index];
      const orbit = pad.orbitPhase + turn * pad.orbitCycles;
      here.set(
        pad.x + Math.cos(orbit) * pad.orbit,
        KOI_GARDEN_WATER_Y + PAD_LIFT,
        pad.z + Math.sin(orbit) * pad.orbit,
      );
      quaternion.setFromAxisAngle(up, pad.spinPhase + turn * pad.spinCycles);
      matrix.compose(here, quaternion, scale.set(pad.scale, 1, pad.scale));
      pads.setMatrixAt(index, matrix);
    }
    pads.instanceMatrix.needsUpdate = true;
  };

  const startLeaf = (): void => {
    const side = leafRandom() > 0.5 ? 1 : -1;
    const azimuth = side * (100 + leafRandom() * 75);
    const radius = 4.2 + leafRandom() * 3.6;
    const angle = THREE.MathUtils.degToRad(azimuth);
    leafEvent.landX = Math.sin(angle) * radius;
    leafEvent.landZ = -Math.cos(angle) * radius;
    const driftAngle = leafRandom() * Math.PI * 2;
    leafEvent.startX = leafEvent.landX + Math.cos(driftAngle) * 0.5;
    leafEvent.startZ = leafEvent.landZ + Math.sin(driftAngle) * 0.5;
    leafEvent.startY = 3.2 + leafRandom() * 0.6;
    leafEvent.sideX = -Math.sin(driftAngle);
    leafEvent.sideZ = Math.cos(driftAngle);
    leafEvent.spin = (leafRandom() - 0.5) * 0.8;
  };

  const placeLeaf = (): void => {
    const age = leafState.sinceStart;
    if (!leafState.started || age >= KOI_GARDEN_LEAF_LIFETIME) {
      leaf.visible = false;
      drop.w = 0;
      return;
    }
    leaf.visible = true;
    const restY = KOI_GARDEN_WATER_Y + PAD_LIFT + 0.006;
    if (age < LEAF_FALL_SECONDS) {
      const fall = age / LEAF_FALL_SECONDS;
      const flutter = Math.sin(age * Math.PI * 0.6) * 0.18 * (1 - fall);
      leaf.position.set(
        THREE.MathUtils.lerp(leafEvent.startX, leafEvent.landX, fall) + leafEvent.sideX * flutter,
        THREE.MathUtils.lerp(leafEvent.startY, restY, fall),
        THREE.MathUtils.lerp(leafEvent.startZ, leafEvent.landZ, fall) + leafEvent.sideZ * flutter,
      );
      leaf.rotation.set(
        0.55 * Math.sin(age * Math.PI * 0.6 + 1) * (1 - fall),
        leafEvent.spin * age,
        0.4 * Math.cos(age * Math.PI * 0.6) * (1 - fall),
      );
      leaf.material.opacity = 1;
      drop.w = 0;
      return;
    }
    const floating = age - LEAF_FALL_SECONDS;
    leaf.position.set(
      leafEvent.landX - leafEvent.sideZ * floating * 0.025,
      restY,
      leafEvent.landZ + leafEvent.sideX * floating * 0.025,
    );
    leaf.rotation.set(0, leafEvent.spin * (LEAF_FALL_SECONDS + floating * 0.2), 0);
    leaf.material.opacity =
      1 - smoothstep(LEAF_HOLD_SECONDS, LEAF_HOLD_SECONDS + LEAF_FADE_SECONDS, floating);
    const ripple = Math.min(1, floating / RIPPLE_SECONDS);
    drop.set(leafEvent.landX, leafEvent.landZ, 0.06 + floating * 0.22, (1 - ripple) ** 2);
  };

  const advance = (deltaSeconds: number): void => {
    const time =
      ((water.userData.ambientTime as number) + deltaSeconds) % KOI_GARDEN_AMBIENT_PERIOD;
    water.userData.ambientTime = time;
    const phase = (Math.PI * 2 * time) / KOI_GARDEN_AMBIENT_PERIOD;
    waveA.set(Math.cos(phase * 15), Math.sin(phase * 15));
    waveB.set(Math.cos(phase * -11), Math.sin(phase * -11));
    waveC.set(Math.cos(phase * 23), Math.sin(phase * 23));
    sway.set(Math.cos(phase * KOI_SWAY_CYCLES), Math.sin(phase * KOI_SWAY_CYCLES));
    placeKoi(deltaSeconds);
    placePads(time);
    leafState.sinceStart += deltaSeconds;
    if (leafState.sinceStart >= leafState.next) {
      leafState.sinceStart -= leafState.next;
      leafState.next = leafInterval();
      leafState.started = true;
      startLeaf();
    }
    placeLeaf();
  };
  placeKoi(0);
  placePads(0);

  let disposed = false;
  const update = (deltaSeconds: number): void => {
    if (disposed || !root.visible || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    advance(Math.min(deltaSeconds, MAX_DELTA));
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>([flagstones, glowMap, haloTexture]);
    const instanced: THREE.InstancedMesh[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
      if (object instanceof THREE.InstancedMesh) instanced.push(object);
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
    for (const mesh of instanced) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    root.removeFromParent();
  };
  return { root, update, dispose, floorY: KOI_GARDEN_FLOOR_Y };
}
