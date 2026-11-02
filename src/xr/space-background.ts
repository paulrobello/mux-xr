import * as THREE from 'three';

export interface SpaceBackground {
  root: THREE.Group;
  dispose: () => void;
}

const STAR_COUNT = 640;
const SKY_RADIUS = 78;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createStarfield(): THREE.Points {
  const random = seededRandom(0x4f425356);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
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
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.34,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
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

export function createSpaceBackground(): SpaceBackground {
  const root = new THREE.Group();
  root.name = 'observatory-exterior-space';
  root.visible = false;
  root.add(createSkyShell(), createStarfield(), createOrbitalTrail());
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
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
  return { root, dispose };
}
