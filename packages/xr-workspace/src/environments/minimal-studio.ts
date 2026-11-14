import * as THREE from 'three';

export interface MinimalStudioEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

export const MINIMAL_STUDIO_FLOOR_Y = 0.035;

const SKY_RADIUS = 60;
const FLOOR_RADIUS = 44;
const FLOOR_RINGS = 32;
const FLOOR_SEGMENTS = 64;
const GRID_TEXTURE_SIZE = 64;
const GRID_CELL_METERS = 1;
const GRID_BASE = 214;
const GRID_LINE = 255;
const GRID_FRONT_FADE_START = 1;
const GRID_FRONT_FADE_END = 3;
const GRID_FRONT_MIN = 0.04;
const GRID_FRONT_HALF_ANGLE = Math.PI / 3;

// sRGB hex values, converted to linear by THREE.Color. The floor edge and the sky below the
// horizon share HORIZON so the seam vanishes.
const ZENITH = new THREE.Color(0x0b1219);
const HORIZON = new THREE.Color(0x1b232b);
const NADIR = new THREE.Color(0x0a0d10);
const FLOOR_NEAR = new THREE.Color(0x272b30);
const FLOOR_MID = new THREE.Color(0x15181b);

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function createSkyShell(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 24);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const elevation = position.getY(index) / SKY_RADIUS;
    if (elevation >= 0) color.copy(HORIZON).lerp(ZENITH, smoothstep(0, 0.55, elevation) ** 0.8);
    else color.copy(HORIZON).lerp(NADIR, smoothstep(0, 0.3, -elevation));
    color.toArray(colors, index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    dithering: true,
    fog: false,
  });
  const shell = new THREE.Mesh(geometry, material);
  shell.name = 'minimal-studio-horizon';
  shell.renderOrder = -1000;
  return shell;
}

function createGridTexture(): THREE.DataTexture {
  const size = GRID_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const line = x === 0 || y === 0 ? 1 : 0;
      const value = line ? GRID_LINE : GRID_BASE;
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
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Grid visibility at a floor point: full at the sides and behind, fading out ahead under the panes. */
export function minimalStudioGridStrength(x: number, z: number): number {
  const distance = Math.hypot(x, z);
  if (distance < 1e-6) return 1;
  const angleFromForward = Math.acos(Math.min(1, Math.max(-1, -z / distance)));
  const inFront =
    1 - smoothstep(GRID_FRONT_HALF_ANGLE, GRID_FRONT_HALF_ANGLE + 0.35, angleFromForward);
  const fade = smoothstep(GRID_FRONT_FADE_START, GRID_FRONT_FADE_END, distance);
  return 1 - inFront * fade * (1 - GRID_FRONT_MIN);
}

function createFloor(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0, FLOOR_RADIUS, FLOOR_SEGMENTS, FLOOR_RINGS);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const gridStrength = new Float32Array(position.count);
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    // Squared radial spacing keeps rings dense near the user, where the front grid fade happens.
    const scale = Math.hypot(position.getX(index), position.getZ(index)) / FLOOR_RADIUS;
    const x = position.getX(index) * scale;
    const z = position.getZ(index) * scale;
    position.setXYZ(index, x, 0, z);
    const distance = Math.hypot(x, z) / FLOOR_RADIUS;
    color.copy(FLOOR_NEAR).lerp(FLOOR_MID, smoothstep(0, 0.22, distance));
    color.lerp(HORIZON, smoothstep(0.25, 0.92, distance));
    color.toArray(colors, index * 3);
    uv.setXY(index, x / GRID_CELL_METERS, z / GRID_CELL_METERS);
    gridStrength[index] = minimalStudioGridStrength(x, z);
  }
  geometry.computeBoundingSphere();
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('gridStrength', new THREE.BufferAttribute(gridStrength, 1));
  const texture = createGridTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    vertexColors: true,
    dithering: true,
    fog: false,
  });
  const gridBase = (GRID_BASE / 255).toFixed(6);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'attribute float gridStrength;\nvarying float vGridStrength;\nvoid main() {',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGridStrength = gridStrength;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vGridStrength;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `diffuseColor *= mix(vec4(vec3(${gridBase}), 1.0), texture2D(map, vMapUv), vGridStrength);`,
      );
  };
  material.customProgramCacheKey = () => 'minimal-studio-floor-grid-v1';
  const floor = new THREE.Mesh(geometry, material);
  floor.name = 'minimal-studio-floor';
  floor.position.y = MINIMAL_STUDIO_FLOOR_Y;
  floor.renderOrder = -999;
  return floor;
}

export function createMinimalStudioEnvironment(): MinimalStudioEnvironment {
  const root = new THREE.Group();
  root.name = 'minimal-studio-environment';
  root.add(createSkyShell(), createFloor());
  let disposed = false;
  const update = (_deltaSeconds: number): void => undefined;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    root.removeFromParent();
  };
  return { root, update, dispose, floorY: MINIMAL_STUDIO_FLOOR_Y };
}
