import * as THREE from 'three';

export interface SpaceBackground {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
}

const STAR_COUNT = 640;
const SKY_RADIUS = 78;
const METEOR_MIN_DELAY = 35;
const METEOR_MAX_DELAY = 70;
const METEOR_MIN_LIFETIME = 0.5;
const METEOR_MAX_LIFETIME = 1.2;
const STAR_SPRITE_SIZE = 64;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createStarSpriteTexture(): THREE.DataTexture {
  const data = new Uint8Array(STAR_SPRITE_SIZE * STAR_SPRITE_SIZE * 4);
  const center = (STAR_SPRITE_SIZE - 1) / 2;
  const radius = STAR_SPRITE_SIZE / 2;
  for (let y = 0; y < STAR_SPRITE_SIZE; y += 1) {
    for (let x = 0; x < STAR_SPRITE_SIZE; x += 1) {
      const distance = Math.hypot(x - center, y - center) / radius;
      const core = Math.max(0, 1 - distance * distance);
      const alpha = distance >= 0.94 ? 0 : Math.min(1, core ** 1.35 * 1.08);
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

function createStarfield(): THREE.Points {
  const random = seededRandom(0x4f425356);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const scales = new Float32Array(STAR_COUNT);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const cluster = index % 7 === 0;
    const z = cluster ? random() * 0.55 - 0.275 : random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius =
      Math.sqrt(Math.max(0, 1 - z * z)) * SKY_RADIUS * (cluster ? 0.82 + random() * 0.12 : 1);
    const offset = index * 3;
    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] = z * SKY_RADIUS;
    positions[offset + 2] = Math.sin(angle) * radius;
    const warm = random() > 0.78;
    const brightness = cluster ? 0.8 + random() * 0.2 : 0.52 + random() * 0.38;
    colors[offset] = brightness * (warm ? 1 : 0.72);
    colors[offset + 1] = brightness * (warm ? 0.78 : 0.9);
    colors[offset + 2] = brightness * (warm ? 0.58 : 1);
    scales[index] = cluster ? 1.05 + random() * 0.45 : 0.62 + random() * 0.62;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('starScale', new THREE.BufferAttribute(scales, 1));
  const sprite = createStarSpriteTexture();
  const material = new THREE.PointsMaterial({
    map: sprite,
    size: 0.42,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
    alphaTest: 0.02,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'uniform float size;',
      'uniform float size;\nattribute float starScale;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      'gl_PointSize = size;',
      'gl_PointSize = size * starScale;',
    );
  };
  material.customProgramCacheKey = () => 'observatory-soft-starfield-v1';
  const stars = new THREE.Points(geometry, material);
  stars.name = 'observatory-exterior-stars';
  stars.renderOrder = -900;
  return stars;
}

function createSkyShell(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 16, 8);
  const width = 512;
  const height = 256;
  const data = new Uint8Array(width * height * 4);
  const deep = [3, 12, 24];
  const teal = [22, 82, 108];
  const amber = [124, 78, 44];
  for (let y = 0; y < height; y += 1) {
    const latitude = Math.abs((y / (height - 1)) * 2 - 1);
    const latitudeDistance = (latitude - 0.18) / 0.15;
    const band = Math.exp(-(latitudeDistance * latitudeDistance));
    for (let x = 0; x < width; x += 1) {
      const directionX = (x / (width - 1)) * 2 - 1;
      const variation =
        0.7 +
        0.3 * Math.sin(directionX * 18 + latitude * 7) +
        0.14 * Math.sin(directionX * -31 + latitude * 19);
      const wispDistance = (latitude - 0.38) / 0.12;
      const wisps = Math.exp(-(wispDistance * wispDistance)) * 0.16;
      const cloud = Math.min(1.2, Math.max(0.3, variation)) * band + wisps;
      const warmDistance = (directionX + 0.28) / 0.36;
      const warm = Math.exp(-(warmDistance * warmDistance)) * cloud * 0.28;
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = deep[channel] + (teal[channel] - deep[channel]) * cloud * 0.62;
        data[offset + channel] = Math.round(
          Math.min(255, Math.max(0, base + (amber[channel] - base) * warm)),
        );
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  material.userData.ownedTexture = texture;
  const shell = new THREE.Mesh(geometry, material);
  shell.name = 'observatory-exterior-galactic-band';
  shell.renderOrder = -1000;
  return shell;
}

function createOrbitalTrail(): THREE.LineLoop {
  const positions = new Float32Array(96 * 3);
  for (let index = 0; index < 96; index += 1) {
    const angle = (index / 96) * Math.PI * 2;
    const offset = index * 3;
    positions[offset] = Math.cos(angle) * 58;
    positions[offset + 1] = 17;
    positions[offset + 2] = Math.sin(angle) * 58;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x517d86,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const trail = new THREE.LineLoop(geometry, material);
  trail.name = 'observatory-exterior-orbital-trail';
  trail.renderOrder = -899;
  return trail;
}

function createMeteor(): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xb8e6ee,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const meteor = new THREE.Line(geometry, material);
  meteor.name = 'observatory-exterior-shooting-star';
  meteor.renderOrder = -898;
  meteor.visible = false;
  return meteor;
}

export function createSpaceBackground(): SpaceBackground {
  const root = new THREE.Group();
  root.name = 'observatory-exterior-space';
  root.visible = false;
  const meteor = createMeteor();
  root.add(createSkyShell(), createStarfield(), createOrbitalTrail(), meteor);
  const meteorPosition = meteor.geometry.getAttribute('position') as THREE.BufferAttribute;
  const meteorStart = new THREE.Vector3();
  const meteorEnd = new THREE.Vector3();
  const meteorDirection = new THREE.Vector3();
  let elapsed = 0;
  let meteorDelay = METEOR_MIN_DELAY + 35 * 0.5;
  let meteorAge = 0;
  let meteorLifetime = METEOR_MIN_LIFETIME;
  let meteorActive = false;
  const spawnMeteor = (): void => {
    const angle = elapsed * 0.73;
    const y = 21 + Math.sin(elapsed * 0.31) * 3;
    const x = Math.sin(angle) * 30;
    const z = -58 - Math.cos(angle) * 6;
    meteorStart.set(x, y, z);
    meteorDirection.set(-0.62, -0.08, 0.34).normalize();
    meteorEnd.copy(meteorStart).addScaledVector(meteorDirection, -5.5);
    meteorPosition.setXYZ(0, 0, 0, 0);
    meteorEnd.copy(meteorDirection).multiplyScalar(-5.5);
    meteorPosition.setXYZ(1, meteorEnd.x, meteorEnd.y, meteorEnd.z);
    meteor.position.copy(meteorStart);
    meteor.geometry.boundingSphere = null;
    meteorPosition.needsUpdate = true;
    meteorLifetime =
      METEOR_MIN_LIFETIME + (elapsed % 1) * (METEOR_MAX_LIFETIME - METEOR_MIN_LIFETIME);
    meteorAge = 0;
    meteorActive = true;
    meteor.visible = true;
  };
  const update = (deltaSeconds: number): void => {
    if (disposed || !root.visible || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const delta = Math.min(deltaSeconds, 0.25);
    elapsed += delta;
    if (!meteorActive) {
      meteorDelay -= delta;
      if (meteorDelay <= 0) spawnMeteor();
      return;
    }
    meteorAge += delta;
    meteor.position.copy(meteorStart).addScaledVector(meteorDirection, meteorAge * 24);
    const progress = Math.min(1, meteorAge / meteorLifetime);
    meteor.material.opacity = Math.sin(progress * Math.PI) * 0.48;
    if (progress >= 1) {
      meteorActive = false;
      meteor.visible = false;
      meteor.material.opacity = 0;
      meteorDelay = METEOR_MIN_DELAY + (elapsed % 1) * (METEOR_MAX_DELAY - METEOR_MIN_DELAY);
    }
  };
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.LineLoop ||
        object instanceof THREE.Points
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      }
    });
    root.removeFromParent();
  };
  return { root, update, dispose };
}
