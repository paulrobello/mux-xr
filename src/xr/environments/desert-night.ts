import * as THREE from 'three';

export interface DesertNightEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

export const DESERT_NIGHT_FLOOR_Y = 0.035;

const SKY_RADIUS = 84;
const STAR_RADIUS = 80;
const STAR_COUNT = 900;
const STAR_SPRITE_SIZE = 32;
const MOON_DISTANCE = 78;
const MOON_RADIUS = 1.5;
const PLATEAU_FLAT_RADIUS = 18;
const PLATEAU_SEGMENTS = 48;
const PLATEAU_GRAIN_SIZE = 128;
const PLATEAU_GRAIN_METERS = 2.2;
const MOON_TEXTURE_SIZE = 128;
const MOON_HALO_SCALE = 3.2;
// Azimuth measured from -Z toward +X. Curved pane layouts reach about 66 degrees, so the moon
// sits at 112 degrees, to the user's right and slightly behind.
export const DESERT_NIGHT_MOON_AZIMUTH_DEGREES = 112;
const MOON_ELEVATION_DEGREES = 31;
const MOON_DIRECTION = new THREE.Vector3(
  Math.sin(THREE.MathUtils.degToRad(DESERT_NIGHT_MOON_AZIMUTH_DEGREES)) *
    Math.cos(THREE.MathUtils.degToRad(MOON_ELEVATION_DEGREES)),
  Math.sin(THREE.MathUtils.degToRad(MOON_ELEVATION_DEGREES)),
  -Math.cos(THREE.MathUtils.degToRad(DESERT_NIGHT_MOON_AZIMUTH_DEGREES)) *
    Math.cos(THREE.MathUtils.degToRad(MOON_ELEVATION_DEGREES)),
);

// Palette in sRGB codes, lifted out of the Quest 3 LCD black crush (about 16-46) and ordered:
// terrain silhouette darkest, then far range, plateau and sky horizon.
const SKY_ZENITH = new THREE.Color(0x13161f);
const SKY_HORIZON = new THREE.Color(0x232a3a);
const FAR_RANGE = new THREE.Color(0x1b1f2b);
const MAIN_RANGE = new THREE.Color(0x141519);
const FOOTHILLS = new THREE.Color(0x131315);
const PLATEAU_SAND = new THREE.Color(0x2e2925);
const PLATEAU_RIM = new THREE.Color(0x1f2028);

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function periodicNoise(samples: number[], t: number): number {
  const count = samples.length;
  const scaled = (((t % 1) + 1) % 1) * count;
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return samples[index % count] * (1 - smooth) + samples[(index + 1) % count] * smooth;
}

function noiseTable(random: () => number, count: number): number[] {
  return Array.from({ length: count }, () => random());
}

const PANE_SECTOR_ANGLE = Math.PI * 1.5;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function angularDistance(a: number, b: number): number {
  const difference = Math.abs(
    ((((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
  );
  return difference;
}

// Panes sit around -Z, so the silhouette is kept low there.
function paneSectorFactor(angle: number): number {
  return 0.32 + 0.68 * smoothstep(0.85, 1.35, angularDistance(angle, PANE_SECTOR_ANGLE));
}

interface Butte {
  center: number;
  capHalfWidth: number;
  skirtWidth: number;
  height: number;
}

// A butte has a narrow, gently domed cap, a short steep cliff, then a concave talus skirt.
function butteProfile(butte: Butte, angle: number): number {
  const distance = angularDistance(angle, butte.center);
  if (distance <= butte.capHalfWidth) {
    const dome = 1 - 0.08 * (distance / butte.capHalfWidth) ** 2;
    return butte.height * dome;
  }
  const outside = distance - butte.capHalfWidth;
  const cliff = butte.skirtWidth * 0.12;
  if (outside <= cliff) return butte.height * (0.92 - 0.2 * (outside / cliff));
  const skirt = Math.min(1, (outside - cliff) / (butte.skirtWidth - cliff));
  return butte.height * 0.72 * (1 - skirt) ** 2.2;
}

interface TerrainBand {
  radius: number;
  depth: number;
  crestOffset: number;
  footY: number;
  segments: number;
  ridgeHeight: number;
  buttes: number;
  butteHeight: [number, number];
  tone: THREE.Color;
  haze: number;
}

function bandProfile(band: TerrainBand, random: () => number): number[] {
  const coarse = noiseTable(random, 7);
  const medium = noiseTable(random, 17);
  const fine = noiseTable(random, 43);
  const buttes: Butte[] = [];
  while (buttes.length < band.buttes) {
    const center = random() * Math.PI * 2;
    const height = band.butteHeight[0] + random() * (band.butteHeight[1] - band.butteHeight[0]);
    const capHalfWidth = 0.025 + random() * 0.07;
    const skirtWidth = 0.09 + random() * 0.12;
    if (angularDistance(center, PANE_SECTOR_ANGLE) < 1.15) continue;
    buttes.push({ center, capHalfWidth, skirtWidth, height });
  }
  return Array.from({ length: band.segments }, (_, index) => {
    const t = index / band.segments;
    const angle = t * Math.PI * 2;
    const rolling =
      periodicNoise(coarse, t) * 0.55 +
      periodicNoise(medium, t) * 0.3 +
      periodicNoise(fine, t) * 0.15;
    let height = band.ridgeHeight * rolling ** 1.6;
    for (const butte of buttes)
      height = Math.max(height, butteProfile(butte, angle) + height * 0.3);
    return height * paneSectorFactor(angle);
  });
}

function createTerrainRing(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const random = seededRandom(0x44455354);
  const positions: number[] = [];
  const colors: number[] = [];
  const bands: TerrainBand[] = [
    // Far range: lower, softer, lighter and bluer for aerial perspective.
    {
      radius: 76,
      crestOffset: 0.3,
      depth: 9,
      footY: -9,
      segments: 160,
      ridgeHeight: 9,
      buttes: 3,
      butteHeight: [4, 6.5],
      tone: FAR_RANGE,
      haze: 0.45,
    },
    // Main range: varied ridges and buttes with talus skirts.
    {
      radius: 58,
      crestOffset: -0.9,
      depth: 10,
      footY: -8,
      segments: 192,
      ridgeHeight: 6,
      buttes: 6,
      butteHeight: [4.5, 9],
      tone: MAIN_RANGE,
      haze: 0.18,
    },
    // Low foothills that hide the range feet behind the plateau rim.
    {
      radius: 42,
      crestOffset: -2.2,
      depth: 7,
      footY: -6,
      segments: 128,
      ridgeHeight: 3.4,
      buttes: 0,
      butteHeight: [0, 0],
      tone: FOOTHILLS,
      haze: 0.1,
    },
  ];
  const rows = [
    { inset: 0, drop: 0, haze: 0 },
    { inset: 0.18, drop: 0.3, haze: 0.25 },
    { inset: 0.55, drop: 0.68, haze: 0.6 },
    { inset: 1, drop: 1, haze: 1 },
  ];
  const vertex = new THREE.Vector3();
  const color = new THREE.Color();
  for (const band of bands) {
    const heights = bandProfile(band, random);
    const grid: { position: THREE.Vector3; haze: number }[][] = rows.map((row) =>
      heights.map((height, index) => {
        const angle = (index / band.segments) * Math.PI * 2;
        const crestY = band.crestOffset + height;
        const y =
          crestY + (band.footY - crestY) * row.drop + (row.inset > 0 ? (random() - 0.5) * 0.6 : 0);
        const radius = band.radius - band.depth * row.inset + (random() - 0.5) * 0.8 * row.inset;
        return {
          position: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
          haze: row.haze * band.haze,
        };
      }),
    );
    const facet = (
      a: { position: THREE.Vector3; haze: number },
      b: { position: THREE.Vector3; haze: number },
      c: { position: THREE.Vector3; haze: number },
    ): void => {
      const normal = new THREE.Vector3()
        .subVectors(b.position, a.position)
        .cross(new THREE.Vector3().subVectors(c.position, a.position))
        .normalize();
      vertex.copy(a.position).add(b.position).add(c.position);
      if (normal.dot(vertex) > 0) normal.negate();
      const shade = 0.86 + Math.max(0, normal.dot(MOON_DIRECTION)) * 0.45 + (random() - 0.5) * 0.08;
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
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    dithering: true,
    fog: false,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = 'desert-night-terrain-ring';
  terrain.renderOrder = -880;
  return terrain;
}

function createPlateau(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const random = seededRandom(0x504c5454);
  const rings = [
    { radius: 0, y: DESERT_NIGHT_FLOOR_Y },
    { radius: 4, y: DESERT_NIGHT_FLOOR_Y },
    { radius: 9, y: DESERT_NIGHT_FLOOR_Y },
    { radius: 14, y: DESERT_NIGHT_FLOOR_Y },
    { radius: PLATEAU_FLAT_RADIUS, y: DESERT_NIGHT_FLOOR_Y },
    { radius: 22, y: -1.4 },
    { radius: 27, y: -6 },
  ];
  const grid: THREE.Vector3[][] = rings.map((ring, ringIndex) =>
    Array.from({ length: PLATEAU_SEGMENTS }, (_, index) => {
      const jitter = ringIndex > 0 ? (random() - 0.5) * 0.08 : 0;
      const angle = ((index + (ringIndex % 2) * 0.5) / PLATEAU_SEGMENTS) * Math.PI * 2 + jitter;
      const radius = ring.radius + (ringIndex >= 4 ? (random() - 0.5) * 2.4 : 0);
      const y = ringIndex > 4 ? ring.y + (random() - 0.5) * 0.8 : ring.y;
      return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }),
  );
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const color = new THREE.Color();
  const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    const center = (a.length() + b.length() + c.length()) / 3;
    const variance = 1 + (random() - 0.5) * 0.12 * Math.min(1, center / 10);
    for (const vertex of [a, b, c]) {
      const fade = smoothstep(6, 22, Math.hypot(vertex.x, vertex.z));
      color.copy(PLATEAU_SAND).multiplyScalar(variance).lerp(PLATEAU_RIM, fade);
      positions.push(vertex.x, vertex.y, vertex.z);
      colors.push(color.r, color.g, color.b);
      uvs.push(vertex.x / PLATEAU_GRAIN_METERS, vertex.z / PLATEAU_GRAIN_METERS);
    }
  };
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const inner = grid[ringIndex];
    const outer = grid[ringIndex + 1];
    for (let index = 0; index < PLATEAU_SEGMENTS; index += 1) {
      const next = (index + 1) % PLATEAU_SEGMENTS;
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
  const material = new THREE.MeshBasicMaterial({
    map: createGrainTexture(),
    vertexColors: true,
    dithering: true,
    fog: false,
  });
  const plateau = new THREE.Mesh(geometry, material);
  plateau.name = 'desert-night-plateau-floor';
  plateau.renderOrder = -870;
  return plateau;
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
    color.copy(SKY_HORIZON).lerp(SKY_ZENITH, Math.min(1, height / 0.6) ** 0.65);
    if (direction.y < 0) color.copy(SKY_HORIZON);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    dithering: true,
    fog: false,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.name = 'desert-night-sky';
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
  const random = seededRandom(0x53544152);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    // Uniform over the upper sky above roughly 4 degrees of elevation.
    const y = 0.07 + random() * 0.93;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const offset = index * 3;
    positions[offset] = Math.cos(angle) * ring * STAR_RADIUS;
    positions[offset + 1] = y * STAR_RADIUS;
    positions[offset + 2] = Math.sin(angle) * ring * STAR_RADIUS;
    const horizonFade = Math.min(1, (y - 0.07) / 0.25);
    const bright = random() > 0.93;
    const brightness =
      (bright ? 0.75 + random() * 0.25 : 0.22 + random() * 0.38) * (0.35 + 0.65 * horizonFade);
    const warm = random() > 0.8;
    colors[offset] = brightness * (warm ? 1 : 0.8);
    colors[offset + 1] = brightness * (warm ? 0.86 : 0.88);
    colors[offset + 2] = brightness * (warm ? 0.72 : 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    map: createStarSpriteTexture(),
    size: 0.38,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = 'desert-night-stars';
  stars.renderOrder = -900;
  return stars;
}

// One texture carries the lit disc and a soft halo, so the glow is per-fragment and round.
function createMoonTexture(): THREE.DataTexture {
  const data = new Uint8Array(MOON_TEXTURE_SIZE * MOON_TEXTURE_SIZE * 4);
  const center = (MOON_TEXTURE_SIZE - 1) / 2;
  const discRadius = 1 / MOON_HALO_SCALE;
  for (let y = 0; y < MOON_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < MOON_TEXTURE_SIZE; x += 1) {
      const distance = Math.hypot(x - center, y - center) / (MOON_TEXTURE_SIZE / 2);
      const disc = 1 - smoothstep(discRadius - 0.02, discRadius + 0.01, distance);
      const halo = distance >= 1 ? 0 : 0.16 * (1 - distance) ** 2.4;
      const alpha = Math.min(1, disc + halo * (1 - disc));
      const tone = disc + (1 - disc) * 0.45;
      const offset = (y * MOON_TEXTURE_SIZE + x) * 4;
      data[offset] = Math.round(160 * tone);
      data[offset + 1] = Math.round(157 * tone);
      data[offset + 2] = Math.round(147 * tone + (1 - disc) * 30);
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(
    data,
    MOON_TEXTURE_SIZE,
    MOON_TEXTURE_SIZE,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createGrainTexture(): THREE.DataTexture {
  const random = seededRandom(0x47524e53);
  const size = PLATEAU_GRAIN_SIZE;
  const coarse = Array.from({ length: 16 * 16 }, () => random());
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * 16;
      const v = (y / size) * 16;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = smoothstep(0, 1, u - x0);
      const fy = smoothstep(0, 1, v - y0);
      const sample = (sx: number, sy: number): number => coarse[(sy % 16) * 16 + (sx % 16)];
      const blotch =
        (sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx) * (1 - fy) +
        (sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx) * fy;
      const grain = random();
      // Low contrast: roughly +/-12% around 0.88, enough texture for stereo fusion.
      const value = 0.88 + (blotch - 0.5) * 0.13 + (grain - 0.5) * 0.11;
      const offset = (y * size + x) * 4;
      const byte = Math.round(Math.min(1, value) * 255);
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

function createMoon(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const size = MOON_RADIUS * 2 * MOON_HALO_SCALE;
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshBasicMaterial({
    map: createMoonTexture(),
    transparent: true,
    depthWrite: true,
    dithering: true,
    fog: false,
  });
  const moon = new THREE.Mesh(geometry, material);
  moon.name = 'desert-night-moon';
  moon.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -890;
  return moon;
}

export function createDesertNightEnvironment(): DesertNightEnvironment {
  const root = new THREE.Group();
  root.name = 'desert-night-environment';
  root.add(createSkyDome(), createStars(), createMoon(), createTerrainRing(), createPlateau());
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  let disposed = false;
  const update = (deltaSeconds: number): void => {
    if (disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    geometries.clear();
    textures.clear();
    materials.clear();
    root.removeFromParent();
  };
  return { root, update, dispose, floorY: DESERT_NIGHT_FLOOR_Y };
}
