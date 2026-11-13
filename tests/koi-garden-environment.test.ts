import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { linearLuminance } from '../src/xr/accent-colors';
import {
  createKoiGardenEnvironment,
  KOI_GARDEN_AMBIENT_PERIOD,
  KOI_GARDEN_FLOOR_Y,
  KOI_GARDEN_GLOW,
  KOI_GARDEN_LANTERNS,
  KOI_GARDEN_LEAF_INTERVAL,
  KOI_GARDEN_WATER_Y,
} from '../src/xr/environments/koi-garden';

type Environment = ReturnType<typeof createKoiGardenEnvironment>;
type Drawable = THREE.Mesh | THREE.Points;

const EYE_HEIGHT = 1.6;
const EXPECTED_NAMES = [
  'koi-garden-sky',
  'koi-garden-stars',
  'koi-garden-surroundings',
  'koi-garden-deck',
  'koi-garden-water',
  'koi-garden-lantern-stone',
  'koi-garden-lantern-glow',
  'koi-garden-lantern-halo',
  'koi-garden-koi',
  'koi-garden-lily-pads',
  'koi-garden-leaf',
];

function drawables(root: THREE.Object3D): Drawable[] {
  const found: Drawable[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) found.push(object);
  });
  return found;
}

function named<T extends THREE.Object3D>(environment: Environment, name: string): T {
  const object = environment.root.getObjectByName(name);
  expect(object, name).toBeDefined();
  return object as T;
}

// Azimuth from the forward -Z axis, positive toward +X.
function azimuthDegrees(x: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(x, -z));
}

function worldVertices(object: Drawable): THREE.Vector3[] {
  object.updateWorldMatrix(true, false);
  const attribute = object.geometry.getAttribute('position');
  return Array.from({ length: attribute.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld),
  );
}

function koiPositions(environment: Environment): THREE.Vector3[] {
  const koi = named<THREE.InstancedMesh>(environment, 'koi-garden-koi');
  const matrix = new THREE.Matrix4();
  return Array.from({ length: koi.count }, (_, index) => {
    koi.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });
}

function water(environment: Environment): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  return named(environment, 'koi-garden-water');
}

function ownedResources(root: THREE.Object3D): {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
} {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const object of drawables(root)) {
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      if (material instanceof THREE.ShaderMaterial)
        for (const uniform of Object.values(material.uniforms))
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
    }
  }
  return { geometries, materials, textures };
}

describe('koi garden environment', () => {
  it('names every part, is deterministic, finite and inside the camera far plane', () => {
    const first = createKoiGardenEnvironment();
    const second = createKoiGardenEnvironment();
    expect(first.root.name).toBe('koi-garden-environment');
    for (const name of EXPECTED_NAMES) expect(first.root.getObjectByName(name), name).toBeDefined();
    for (const object of drawables(first.root)) expect(object.name).toMatch(/^koi-garden-/);
    const firstValues = drawables(first.root).flatMap((object) =>
      worldVertices(object).flatMap((vertex) => vertex.toArray()),
    );
    const secondValues = drawables(second.root).flatMap((object) =>
      worldVertices(object).flatMap((vertex) => vertex.toArray()),
    );
    expect(firstValues).toEqual(secondValues);
    expect(firstValues.every(Number.isFinite)).toBe(true);
    let maximum = 0;
    for (let index = 0; index < firstValues.length; index += 3)
      maximum = Math.max(
        maximum,
        Math.hypot(firstValues[index], firstValues[index + 1], firstValues[index + 2]),
      );
    expect(maximum).toBeLessThan(100 * 0.9);
    expect(koiPositions(first)).toEqual(koiPositions(second));
    first.dispose();
    second.dispose();
  });

  it('stays within the draw-call budget and uses only generated textures', () => {
    const environment = createKoiGardenEnvironment();
    const drawn = drawables(environment.root);
    expect(drawn.length).toBe(EXPECTED_NAMES.length);
    expect(drawn.length).toBeLessThanOrEqual(12);
    const { textures } = ownedResources(environment.root);
    expect(textures.size).toBeGreaterThan(0);
    for (const texture of textures) expect(texture).toBeInstanceOf(THREE.DataTexture);
    environment.dispose();
  });

  it('puts the deck surface at floorY with the water just below it', () => {
    const environment = createKoiGardenEnvironment();
    expect(environment.floorY).toBe(0.035);
    expect(KOI_GARDEN_FLOOR_Y).toBe(0.035);
    let checked = 0;
    for (const vertex of worldVertices(named<THREE.Mesh>(environment, 'koi-garden-deck'))) {
      if (Math.hypot(vertex.x, vertex.z) > 2.95) continue;
      checked += 1;
      expect(vertex.y).toBeCloseTo(environment.floorY, 6);
    }
    expect(checked).toBeGreaterThan(100);
    // The deck material is front-sided, so every walkable triangle must face up.
    const deckVertices = worldVertices(named<THREE.Mesh>(environment, 'koi-garden-deck'));
    const edge = new THREE.Vector3();
    const other = new THREE.Vector3();
    let upward = 0;
    for (let index = 0; index < deckVertices.length; index += 3) {
      const [a, b, c] = deckVertices.slice(index, index + 3);
      if (Math.abs(a.y - b.y) > 1e-6 || Math.abs(a.y - c.y) > 1e-6) continue;
      const normal = edge.subVectors(b, a).cross(other.subVectors(c, a));
      expect(normal.y).toBeGreaterThan(0);
      upward += 1;
    }
    expect(upward).toBeGreaterThan(500);
    const surface = new THREE.Box3().setFromObject(water(environment));
    expect(surface.max.y).toBeCloseTo(KOI_GARDEN_WATER_Y, 6);
    expect(KOI_GARDEN_WATER_Y).toBeLessThan(environment.floorY);
    expect(environment.floorY - KOI_GARDEN_WATER_Y).toBeLessThan(0.3);
    let innerRadius = Number.POSITIVE_INFINITY;
    let outerRadius = 0;
    for (const vertex of worldVertices(water(environment))) {
      const radius = Math.hypot(vertex.x, vertex.z);
      innerRadius = Math.min(innerRadius, radius);
      outerRadius = Math.max(outerRadius, radius);
    }
    expect(innerRadius).toBeLessThan(3.3);
    expect(outerRadius).toBeGreaterThan(9);
    environment.dispose();
  });

  it('keeps the treeline low across the front pane sector', () => {
    const environment = createKoiGardenEnvironment();
    let sampled = 0;
    let frontElevation = Number.NEGATIVE_INFINITY;
    let rearHeight = 0;
    for (const vertex of worldVertices(named(environment, 'koi-garden-surroundings'))) {
      const radius = Math.hypot(vertex.x, vertex.z);
      const azimuth = Math.abs(azimuthDegrees(vertex.x, vertex.z));
      if (azimuth > 120) rearHeight = Math.max(rearHeight, vertex.y);
      if (azimuth > 60 || radius < 1) continue;
      sampled += 1;
      frontElevation = Math.max(
        frontElevation,
        THREE.MathUtils.radToDeg(Math.atan2(vertex.y - EYE_HEIGHT, radius)),
      );
    }
    expect(sampled).toBeGreaterThan(200);
    expect(frontElevation).toBeLessThan(3);
    expect(rearHeight).toBeGreaterThan(4);
    environment.dispose();
  });

  it('keeps lanterns, their glow and the water reflections out of the front ±75°', () => {
    for (const lantern of KOI_GARDEN_LANTERNS)
      expect(Math.abs(lantern.azimuth)).toBeGreaterThanOrEqual(80);
    const environment = createKoiGardenEnvironment();
    for (const name of [
      'koi-garden-lantern-stone',
      'koi-garden-lantern-glow',
      'koi-garden-lantern-halo',
    ]) {
      const vertices = worldVertices(named(environment, name));
      expect(vertices.length).toBeGreaterThan(0);
      for (const vertex of vertices)
        expect(Math.abs(azimuthDegrees(vertex.x, vertex.z)), name).toBeGreaterThan(75);
    }
    const glowMap = water(environment).material.uniforms.uGlowMap.value as THREE.DataTexture;
    const { data, width, height } = glowMap.image as {
      data: Uint8Array;
      width: number;
      height: number;
    };
    let front = 0;
    let lit = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const worldX = ((x + 0.5) / width) * 20 - 10;
        const worldZ = ((y + 0.5) / height) * 20 - 10;
        const index = (y * width + x) * 4;
        if (data[index] > 128) lit += 1;
        if (Math.hypot(worldX, worldZ) < 1) continue;
        if (Math.abs(azimuthDegrees(worldX, worldZ)) > 75) continue;
        front = Math.max(front, data[index], data[index + 1]);
      }
    }
    expect(lit).toBeGreaterThan(20);
    expect(front).toBeLessThanOrEqual(3);
    environment.dispose();
  });

  it('authors a lantern glow no brighter than the desert moon disc', () => {
    const moon = new THREE.Color().setRGB(160 / 255, 157 / 255, 147 / 255, THREE.SRGBColorSpace);
    expect(linearLuminance(new THREE.Color(KOI_GARDEN_GLOW))).toBeLessThan(linearLuminance(moon));
  });

  it('swims the koi slowly along loops that avoid the pane sector', () => {
    const environment = createKoiGardenEnvironment();
    let previous = koiPositions(environment);
    expect(previous).toHaveLength(6);
    const step = 1 / 8;
    let samples = 0;
    for (let frame = 0; frame < 8 * 240; frame += 1) {
      environment.update(step);
      const current = koiPositions(environment);
      current.forEach((position, index) => {
        const radius = Math.hypot(position.x, position.z);
        expect(radius).toBeGreaterThan(3.5);
        expect(radius).toBeLessThan(9);
        expect(Math.abs(azimuthDegrees(position.x, position.z))).toBeGreaterThanOrEqual(50);
        const speed = position.distanceTo(previous[index]) / step;
        expect(speed).toBeGreaterThan(0.2);
        expect(speed).toBeLessThan(0.4);
        samples += 1;
      });
      previous = current;
    }
    expect(samples).toBe(6 * 8 * 240);
    environment.dispose();
  });

  it('advances and wraps the ambient clock, sway and pads, and ignores hostile deltas', () => {
    const environment = createKoiGardenEnvironment();
    const surface = water(environment);
    const time = (): number => surface.userData.ambientTime as number;
    const koi = named<THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>>(
      environment,
      'koi-garden-koi',
    );
    const pads = named<THREE.InstancedMesh>(environment, 'koi-garden-lily-pads');
    const padMatrix = (): number[] => {
      const matrix = new THREE.Matrix4();
      pads.getMatrixAt(0, matrix);
      return [...matrix.elements];
    };
    const padsBefore = padMatrix();
    const swayBefore = (koi.material.uniforms.uSway.value as THREE.Vector2).clone();
    environment.update(0.1);
    expect(time()).toBeCloseTo(0.1, 10);
    expect(padMatrix()).not.toEqual(padsBefore);
    expect((koi.material.uniforms.uSway.value as THREE.Vector2).equals(swayBefore)).toBe(false);
    environment.update(1e9);
    expect(time()).toBeCloseTo(0.35, 10);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) environment.update(bad);
    expect(time()).toBeCloseTo(0.35, 10);
    environment.root.visible = false;
    environment.update(0.2);
    expect(time()).toBeCloseTo(0.35, 10);
    environment.root.visible = true;
    for (let index = 0; index < KOI_GARDEN_AMBIENT_PERIOD * 4; index += 1) environment.update(0.25);
    expect(time()).toBeGreaterThanOrEqual(0);
    expect(time()).toBeLessThan(KOI_GARDEN_AMBIENT_PERIOD);
    expect(time()).toBeCloseTo(0.35, 5);
    const uniforms = surface.material.uniforms;
    for (const name of ['uWaveA', 'uWaveB', 'uWaveC']) {
      const phase = uniforms[name].value as THREE.Vector2;
      expect(phase.length()).toBeCloseTo(1, 6);
    }
    expect((koi.material.uniforms.uSway.value as THREE.Vector2).length()).toBeCloseTo(1, 6);
    environment.dispose();
  });

  it('drops a leaf every 15–40 s outside the pane sector and fades it on the water', () => {
    const environment = createKoiGardenEnvironment();
    const leaf = named<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(
      environment,
      'koi-garden-leaf',
    );
    const drop = water(environment).material.uniforms.uDrop.value as THREE.Vector4;
    expect(leaf.visible).toBe(false);
    const step = 0.25;
    const starts: number[] = [];
    let wasVisible = false;
    let maximumRipple = 0;
    let minimumOpacity = 1;
    for (let frame = 0; frame < 600 / step; frame += 1) {
      environment.update(step);
      if (leaf.visible && !wasVisible) starts.push(frame * step);
      wasVisible = leaf.visible;
      if (!leaf.visible) continue;
      expect(Math.abs(azimuthDegrees(leaf.position.x, leaf.position.z))).toBeGreaterThan(85);
      expect(leaf.position.y).toBeLessThan(4);
      expect(leaf.position.y).toBeGreaterThan(KOI_GARDEN_WATER_Y);
      minimumOpacity = Math.min(minimumOpacity, leaf.material.opacity);
      maximumRipple = Math.max(maximumRipple, drop.w);
    }
    expect(starts.length).toBeGreaterThanOrEqual(600 / KOI_GARDEN_LEAF_INTERVAL[1] - 1);
    expect(starts[0]).toBeGreaterThanOrEqual(KOI_GARDEN_LEAF_INTERVAL[0] - step);
    for (let index = 1; index < starts.length; index += 1) {
      const interval = starts[index] - starts[index - 1];
      expect(interval).toBeGreaterThanOrEqual(KOI_GARDEN_LEAF_INTERVAL[0] - step);
      expect(interval).toBeLessThanOrEqual(KOI_GARDEN_LEAF_INTERVAL[1] + step);
    }
    expect(minimumOpacity).toBeLessThan(0.1);
    expect(maximumRipple).toBeGreaterThan(0.5);
    const repeat = createKoiGardenEnvironment();
    const repeatLeaf = named<THREE.Mesh>(repeat, 'koi-garden-leaf');
    const repeatStarts: number[] = [];
    let repeatVisible = false;
    for (let frame = 0; frame < 600 / step; frame += 1) {
      repeat.update(step);
      if (repeatLeaf.visible && !repeatVisible) repeatStarts.push(frame * step);
      repeatVisible = repeatLeaf.visible;
    }
    expect(repeatStarts).toEqual(starts);
    environment.dispose();
    repeat.dispose();
  });

  it('retints the lantern glow with an accent at the authored luminance; null keeps amber', () => {
    const authored = createKoiGardenEnvironment();
    const tinted = createKoiGardenEnvironment(new THREE.Color(0x68d6ff));
    const amber = new THREE.Color(KOI_GARDEN_GLOW);
    const glowOf = (environment: Environment): THREE.Color =>
      named<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(
        environment,
        'koi-garden-lantern-glow',
      ).material.color;
    const haloOf = (environment: Environment): THREE.Color =>
      named<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(
        environment,
        'koi-garden-lantern-halo',
      ).material.color;
    expect(glowOf(authored).getHex()).toBe(amber.getHex());
    expect(haloOf(authored).getHex()).toBe(amber.getHex());
    expect((water(authored).material.uniforms.uGlow.value as THREE.Color).getHex()).toBe(
      amber.getHex(),
    );
    const accentGlow = glowOf(tinted);
    expect(accentGlow.getHex()).not.toBe(amber.getHex());
    expect(accentGlow.b).toBeGreaterThan(accentGlow.r);
    expect(linearLuminance(accentGlow)).toBeCloseTo(linearLuminance(amber), 4);
    expect(haloOf(tinted).getHex()).toBe(accentGlow.getHex());
    expect((water(tinted).material.uniforms.uGlow.value as THREE.Color).getHex()).toBe(
      accentGlow.getHex(),
    );
    const deckColors = (environment: Environment): number[] =>
      Array.from(
        named<THREE.Mesh>(environment, 'koi-garden-deck').geometry.getAttribute('color')
          .array as Float32Array,
      );
    expect(deckColors(tinted)).not.toEqual(deckColors(authored));
    const untouched = ['koi-garden-sky', 'koi-garden-surroundings'];
    for (const name of untouched) {
      const before = named<THREE.Mesh>(authored, name).geometry.getAttribute('color').array;
      const after = named<THREE.Mesh>(tinted, name).geometry.getAttribute('color').array;
      expect(Array.from(after as Float32Array)).toEqual(Array.from(before as Float32Array));
    }
    authored.dispose();
    tinted.dispose();
  });

  it('ships dithered, loop-free shaders whose uniforms all line up', () => {
    const environment = createKoiGardenEnvironment();
    const shaders = drawables(environment.root)
      .map((object) => object.material)
      .filter(
        (material): material is THREE.ShaderMaterial => material instanceof THREE.ShaderMaterial,
      );
    expect(shaders).toHaveLength(2);
    for (const material of shaders) {
      const source = `${material.vertexShader}\n${material.fragmentShader}`;
      expect(material.dithering).toBe(true);
      expect(material.fragmentShader).toMatch(
        /#include <common>\s*\n#include <dithering_pars_fragment>/,
      );
      expect(material.fragmentShader).toContain('#include <dithering_fragment>');
      expect(source).not.toMatch(/\b(for|while)\s*\(/);
      expect(source).not.toMatch(/uTime/);
      for (const match of source.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g))
        expect(Number(match[1])).toBeLessThan(Number(match[2]));
      for (const name of source.matchAll(/uniform\s+\w+\s+(\w+);/g))
        expect(material.uniforms[name[1]], name[1]).toBeDefined();
      for (const name of Object.keys(material.uniforms)) expect(source).toContain(name);
    }
    for (const object of drawables(environment.root)) {
      const material = object.material as THREE.Material;
      if (material instanceof THREE.MeshBasicMaterial) expect(material.fog).toBe(false);
    }
    environment.dispose();
  });

  it('disposes every geometry, material, texture and instanced mesh once, then goes inert', () => {
    const environment = createKoiGardenEnvironment();
    const parent = new THREE.Group();
    parent.add(environment.root);
    const { geometries, materials, textures } = ownedResources(environment.root);
    expect(geometries.size).toBe(EXPECTED_NAMES.length);
    expect(materials.size).toBe(EXPECTED_NAMES.length);
    expect(textures.size).toBeGreaterThanOrEqual(4);
    const instanced = drawables(environment.root).filter(
      (object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh,
    );
    expect(instanced).toHaveLength(2);
    const spies = [...geometries, ...materials, ...textures, ...instanced].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    environment.dispose();
    environment.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(environment.root.parent).toBeNull();
    const time = water(environment).userData.ambientTime as number;
    environment.update(0.1);
    expect(water(environment).userData.ambientTime).toBe(time);
  });
});
