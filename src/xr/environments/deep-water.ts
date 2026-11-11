import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface DeepWaterEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

const FLOOR_Y = 0.035;
const FLOOR_RADIUS = 16;
const WATER_RADIUS = 42;
const DECK_RADIUS = 6.4;
const CEILING_Y = 4.4;
const PLATE_TEXTURE_SIZE = 128;
const MAX_DELTA = 0.25;
// The shader only uses integer multiples of TAU / CAUSTIC_PERIOD, so wrapping here is seamless
// and keeps the time uniform small enough for mediump.
export const CAUSTIC_PERIOD = 120;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createPlateTexture(): THREE.DataTexture {
  const size = PLATE_TEXTURE_SIZE;
  const random = seededRandom(0x44574154);
  const half = size / 2;
  const plateShade = Array.from({ length: 4 }, () => 0.82 + random() * 0.18);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const localX = x % half;
      const localY = y % half;
      const plate = (y >= half ? 2 : 0) + (x >= half ? 1 : 0);
      const seam = Math.min(localX, localY, half - 1 - localX, half - 1 - localY);
      const seamShade = seam < 1 ? 0.55 : seam < 2 ? 0.8 : 1;
      const grain = 0.94 + random() * 0.06;
      const value = Math.round(255 * plateShade[plate] * seamShade * grain);
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

const WATER_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform vec3 uSurface;
varying vec3 vDirection;
#include <common>
#include <dithering_pars_fragment>
void main() {
  float up = clamp(vDirection.y, -1.0, 1.0);
  vec3 color = mix(uHorizon, uDeep, 1.0 - smoothstep(-0.6, 0.0, up));
  float lift = smoothstep(0.05, 1.0, up);
  color = mix(color, uSurface, lift * lift);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

const FLOOR_VERTEX = /* glsl */ `
varying vec2 vFloor;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vFloor = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Two fixed ridge layers, no loops. Time never enters a sin argument: the CPU supplies each
// layer's phase as a unit (cos, sin) pair and the shader rotates by angle addition, so fp16
// quantization of large arguments cannot make the motion stutter on Quest. Ridge width tracks
// fwidth and the web fades where a ridge would go sub-pixel, so each eye resolves the same lines.
// Derivatives are taken outside any branch because they are undefined in divergent control flow.
const FLOOR_FRAGMENT = /* glsl */ `
uniform sampler2D uPlates;
uniform vec2 uWaveA;
uniform vec2 uWaveB;
uniform vec3 uFloor;
uniform vec3 uFog;
uniform vec3 uCaustic;
varying vec2 vFloor;
#include <common>
#include <dithering_pars_fragment>

// Distance-like field: 0 on a ridge, 1 between ridges.
float ridgeField(vec2 p, vec2 wave) {
  float u = p.y * 0.9;
  float v = p.x * 0.8;
  // sin(u + t) and sin(v - t) with wave = (cos t, sin t).
  vec2 w = p + 0.55 * vec2(sin(u) * wave.x + cos(u) * wave.y, sin(v) * wave.x - cos(v) * wave.y);
  return clamp(abs(sin(w.x) + sin(w.y)) * 0.5, 0.0, 1.0);
}

float ridgeLine(float field) {
  float blur = fwidth(field);
  float core = (1.0 - smoothstep(0.0, 0.035 + blur * 1.5, field)) * (1.0 - smoothstep(0.06, 0.22, blur));
  float glow = 1.0 - smoothstep(0.0, 0.3, field);
  return core * 0.7 + glow * glow * 0.4;
}

void main() {
  float radius = length(vFloor);
  float plates = texture2D(uPlates, vFloor * 0.25).r;
  vec3 color = uFloor * plates;
  float band = smoothstep(0.9, 2.4, radius) * (1.0 - smoothstep(5.2, 7.5, radius));
  // The forward pane sector (-Z, about ±60°) stays near-dark out to 3.5 m and half-strength on
  // the far floor, so the only moving element never sits under the panes.
  float front = clamp(-vFloor.y / max(radius, 0.001), 0.0, 1.0);
  float sector = smoothstep(0.3, 0.55, front);
  float far = smoothstep(3.5, 5.0, radius);
  band *= 1.0 - sector * mix(0.95, 0.5, far);
  vec2 a = vFloor * 3.1;
  vec2 b = vec2(vFloor.x * 0.8 - vFloor.y * 1.1, vFloor.x * 1.1 + vFloor.y * 0.8) * 2.3;
  float ra = ridgeLine(ridgeField(a, uWaveA));
  float rb = ridgeLine(ridgeField(b, uWaveB));
  float caustic = clamp(ra * 0.45 + rb * 0.35 + ra * rb * 0.9, 0.0, 1.0) * band;
  color += uCaustic * caustic * (0.55 + 0.45 * plates);
  color = mix(color, uFog, smoothstep(7.0, ${FLOOR_RADIUS.toFixed(1)}, radius));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

function createWater(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(WATER_RADIUS, 24, 12);
  const material = new THREE.ShaderMaterial({
    name: 'deep-water-volume',
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: {
      uDeep: { value: new THREE.Color(0x010204) },
      uHorizon: { value: new THREE.Color(0x050c12) },
      uSurface: { value: new THREE.Color(0x0c1820) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    dithering: true,
  });
  const water = new THREE.Mesh(geometry, material);
  water.name = 'deep-water-volume';
  water.renderOrder = -1000;
  return water;
}

function createFloor(
  texture: THREE.DataTexture,
): THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.CircleGeometry(FLOOR_RADIUS, 64);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, FLOOR_Y, 0);
  const material = new THREE.ShaderMaterial({
    name: 'deep-water-caustic-floor',
    vertexShader: FLOOR_VERTEX,
    fragmentShader: FLOOR_FRAGMENT,
    uniforms: {
      uPlates: { value: texture },
      uWaveA: { value: new THREE.Vector2(1, 0) },
      uWaveB: { value: new THREE.Vector2(1, 0) },
      uFloor: { value: new THREE.Color(0x080c11) },
      uFog: { value: new THREE.Color(0x050c12) },
      uCaustic: { value: new THREE.Color(0x27363d) },
    },
    dithering: true,
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.name = 'deep-water-floor';
  return floor;
}

// Azimuths in degrees from -Z. The front ±55° holds panes, so no structure stands there.
const PILLAR_AZIMUTHS = [70, 110, 145, 180, -145, -110, -70];

function azimuthPosition(degrees: number, radius: number): THREE.Vector2 {
  const angle = THREE.MathUtils.degToRad(degrees);
  return new THREE.Vector2(Math.sin(angle) * radius, -Math.cos(angle) * radius);
}

function bakeShade(geometry: THREE.BufferGeometry, base: THREE.Color): THREE.BufferGeometry {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (prepared !== geometry) geometry.dispose();
  prepared.deleteAttribute('uv');
  const position = prepared.getAttribute('position');
  const normal = prepared.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const height = THREE.MathUtils.clamp(position.getY(index) / CEILING_Y, 0, 1.2);
    const facing =
      0.62 + 0.38 * Math.max(0, normal.getY(index)) + 0.12 * Math.abs(normal.getX(index));
    const shade = (0.55 + 0.45 * height) * facing;
    colors[index * 3] = base.r * shade;
    colors[index * 3 + 1] = base.g * shade;
    colors[index * 3 + 2] = base.b * shade;
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

function createStructure(): THREE.Mesh {
  const base = new THREE.Color(0x101820);
  const parts: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(DECK_RADIUS - 0.2, 0.07, 6, 72);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, FLOOR_Y + 0.05, 0);
  parts.push(bakeShade(rim, base));
  const crown = new THREE.TorusGeometry(DECK_RADIUS, 0.11, 6, 72);
  crown.rotateX(Math.PI / 2);
  crown.translate(0, CEILING_Y, 0);
  parts.push(bakeShade(crown, base));
  for (const azimuth of PILLAR_AZIMUTHS) {
    const at = azimuthPosition(azimuth, DECK_RADIUS);
    const pillar = new THREE.BoxGeometry(0.24, CEILING_Y, 0.3, 1, 4, 1);
    pillar.rotateY(THREE.MathUtils.degToRad(-azimuth));
    pillar.translate(at.x, CEILING_Y / 2, at.y);
    parts.push(bakeShade(pillar, base));
  }
  for (let beam = 0; beam < 6; beam += 1) {
    const azimuth = 30 + beam * 60;
    const mid = azimuthPosition(azimuth, DECK_RADIUS / 2);
    const rib = new THREE.BoxGeometry(0.14, 0.16, DECK_RADIUS);
    rib.rotateY(THREE.MathUtils.degToRad(-azimuth));
    rib.translate(mid.x, CEILING_Y + 0.32, mid.y);
    parts.push(bakeShade(rib, base));
  }
  const hub = new THREE.CylinderGeometry(0.7, 0.9, 0.3, 24, 1);
  hub.translate(0, CEILING_Y + 0.4, 0);
  parts.push(bakeShade(hub, base));
  const structure = new THREE.Mesh(
    mergeOwned(parts, 'structure'),
    new THREE.MeshBasicMaterial({
      name: 'deep-water-structure',
      vertexColors: true,
      fog: false,
      dithering: true,
    }),
  );
  structure.name = 'deep-water-structure';
  return structure;
}

function createAccents(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  // The inlay runs only from azimuth 60° to 300°, leaving the front pane field clear. After
  // rotateX the arc starts at azimuth 90°, so rotateY(30°) moves its start to 60°.
  const inlay = new THREE.TorusGeometry(
    DECK_RADIUS - 0.55,
    0.018,
    3,
    64,
    THREE.MathUtils.degToRad(240),
  );
  inlay.rotateX(Math.PI / 2);
  inlay.rotateY(THREE.MathUtils.degToRad(30));
  inlay.scale(1, 0.25, 1);
  inlay.translate(0, FLOOR_Y + 0.002, 0);
  parts.push(inlay.toNonIndexed());
  inlay.dispose();
  for (const azimuth of PILLAR_AZIMUTHS) {
    const at = azimuthPosition(azimuth, DECK_RADIUS - 0.16);
    const strip = new THREE.BoxGeometry(0.035, 2.6, 0.01);
    strip.rotateY(THREE.MathUtils.degToRad(-azimuth));
    strip.translate(at.x, 1.9, at.y);
    parts.push(strip.toNonIndexed());
    strip.dispose();
  }
  const halo = new THREE.TorusGeometry(0.72, 0.014, 3, 48);
  halo.rotateX(Math.PI / 2);
  halo.translate(0, CEILING_Y + 0.24, 0);
  parts.push(halo.toNonIndexed());
  halo.dispose();
  for (const part of parts) part.deleteAttribute('uv');
  const accents = new THREE.Mesh(
    mergeOwned(parts, 'accents'),
    new THREE.MeshBasicMaterial({
      name: 'deep-water-accents',
      color: 0x2a3e47,
      fog: false,
      dithering: true,
    }),
  );
  accents.name = 'deep-water-accents';
  return accents;
}

export function createDeepWaterEnvironment(): DeepWaterEnvironment {
  const root = new THREE.Group();
  root.name = 'deep-water-environment';
  const plates = createPlateTexture();
  const floor = createFloor(plates);
  root.add(createWater(), floor, createStructure(), createAccents());
  const waveA = floor.material.uniforms.uWaveA.value as THREE.Vector2;
  const waveB = floor.material.uniforms.uWaveB.value as THREE.Vector2;
  floor.userData.causticTime = 0;
  let disposed = false;
  const update = (deltaSeconds: number): void => {
    if (disposed || !root.visible || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const time =
      ((floor.userData.causticTime as number) + Math.min(deltaSeconds, MAX_DELTA)) % CAUSTIC_PERIOD;
    floor.userData.causticTime = time;
    const phase = (Math.PI * 2 * time) / CAUSTIC_PERIOD;
    waveA.set(Math.cos(phase * 3), Math.sin(phase * 3));
    waveB.set(Math.cos(phase * -2), Math.sin(phase * -2));
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>([plates]);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
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
  return { root, update, dispose, floorY: FLOOR_Y };
}
