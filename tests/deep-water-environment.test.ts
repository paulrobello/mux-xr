import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CAUSTIC_PERIOD, createDeepWaterEnvironment } from '../src/xr/environments/deep-water';

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}

function worldPositions(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const values: number[] = [];
  const point = new THREE.Vector3();
  for (const mesh of meshes(root)) {
    const attribute = mesh.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1) {
      point.fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld);
      values.push(point.x, point.y, point.z);
    }
  }
  return values;
}

function maxDistance(values: number[]): number {
  let maximum = 0;
  for (let index = 0; index < values.length; index += 3)
    maximum = Math.max(maximum, Math.hypot(values[index], values[index + 1], values[index + 2]));
  return maximum;
}

function causticTime(environment: ReturnType<typeof createDeepWaterEnvironment>): number {
  const floor = environment.root.getObjectByName('deep-water-floor') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  return floor.userData.causticTime as number;
}

function ownedResources(root: THREE.Object3D): {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
} {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const mesh of meshes(root)) {
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
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

describe('deep-water research station environment', () => {
  it('is deterministic, finite, and stays within the camera far plane', () => {
    const first = createDeepWaterEnvironment();
    const second = createDeepWaterEnvironment();
    expect(first.root.name).toBe('deep-water-environment');
    const firstPositions = worldPositions(first.root);
    expect(firstPositions).toEqual(worldPositions(second.root));
    expect(firstPositions.every(Number.isFinite)).toBe(true);
    expect(maxDistance(firstPositions)).toBeLessThan(100 * 0.9);
    const plates = ownedResources(first.root).textures.values().next().value as THREE.DataTexture;
    const secondPlates = ownedResources(second.root).textures.values().next()
      .value as THREE.DataTexture;
    expect(Array.from(plates.image.data as Uint8Array)).toEqual(
      Array.from(secondPlates.image.data as Uint8Array),
    );
    first.dispose();
    second.dispose();
  });

  it('keeps the draw-call budget low and uses no network assets', () => {
    const environment = createDeepWaterEnvironment();
    const drawn = meshes(environment.root);
    expect(drawn.length).toBeLessThanOrEqual(10);
    const { textures } = ownedResources(environment.root);
    for (const texture of textures) expect(texture).toBeInstanceOf(THREE.DataTexture);
    environment.dispose();
  });

  it('places the floor surface at floorY', () => {
    const environment = createDeepWaterEnvironment();
    expect(environment.floorY).toBe(0.035);
    const floor = environment.root.getObjectByName('deep-water-floor');
    expect(floor).toBeDefined();
    environment.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(floor as THREE.Object3D);
    expect(bounds.max.y).toBeCloseTo(environment.floorY, 6);
    expect(bounds.min.y).toBeCloseTo(environment.floorY, 6);
    environment.dispose();
  });

  it('keeps structure and accents out of the front pane field', () => {
    const environment = createDeepWaterEnvironment();
    environment.root.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    for (const name of ['deep-water-structure', 'deep-water-accents']) {
      const mesh = environment.root.getObjectByName(name) as THREE.Mesh;
      expect(mesh).toBeDefined();
      const attribute = mesh.geometry.getAttribute('position');
      let checked = 0;
      for (let index = 0; index < attribute.count; index += 1) {
        point.fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld);
        if (point.y <= 0.4 || point.y >= 3) continue;
        checked += 1;
        const azimuth = THREE.MathUtils.radToDeg(Math.atan2(point.x, -point.z));
        expect(Math.abs(azimuth)).toBeGreaterThan(55);
        expect(Math.hypot(point.x, point.z)).toBeGreaterThan(4);
      }
      expect(checked).toBeGreaterThan(0);
    }
    environment.dispose();
  });

  it('keeps every accent, including the floor inlay, out of the front ±55° sector', () => {
    const environment = createDeepWaterEnvironment();
    environment.root.updateMatrixWorld(true);
    const accents = environment.root.getObjectByName('deep-water-accents') as THREE.Mesh;
    const attribute = accents.geometry.getAttribute('position');
    const point = new THREE.Vector3();
    let floorVertices = 0;
    for (let index = 0; index < attribute.count; index += 1) {
      point.fromBufferAttribute(attribute, index).applyMatrix4(accents.matrixWorld);
      const radius = Math.hypot(point.x, point.z);
      if (radius < 1) continue;
      if (point.y < 0.2) floorVertices += 1;
      const azimuth = THREE.MathUtils.radToDeg(Math.atan2(point.x, -point.z));
      expect(Math.abs(azimuth)).toBeGreaterThan(55);
    }
    expect(floorVertices).toBeGreaterThan(0);
    environment.dispose();
  });

  it('ships mobile-safe, dithered shaders with well-ordered smoothstep edges', () => {
    const environment = createDeepWaterEnvironment();
    const shaders = meshes(environment.root)
      .map((mesh) => mesh.material)
      .filter(
        (material): material is THREE.ShaderMaterial => material instanceof THREE.ShaderMaterial,
      );
    expect(shaders).toHaveLength(2);
    for (const material of shaders) {
      const source = material.fragmentShader;
      expect(material.dithering).toBe(true);
      expect(source).toMatch(/#include <common>\s*\n#include <dithering_pars_fragment>/);
      expect(source).toContain('#include <dithering_fragment>');
      expect(source).not.toMatch(/\b(for|while)\s*\(/);
      for (const match of source.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g))
        expect(Number(match[1])).toBeLessThan(Number(match[2]));
      for (const name of source.matchAll(/uniform\s+\w+\s+(\w+);/g))
        expect(material.uniforms[name[1]]).toBeDefined();
      for (const name of Object.keys(material.uniforms)) expect(source).toContain(name);
    }
    const floor = environment.root.getObjectByName('deep-water-floor') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(floor.material.fragmentShader).toContain('fwidth(');
    for (const mesh of meshes(environment.root)) {
      const material = mesh.material as THREE.Material;
      if (material instanceof THREE.MeshBasicMaterial) {
        expect(material.fog).toBe(false);
        expect(material.dithering).toBe(true);
      }
    }
    environment.dispose();
  });

  it('advances caustic time only while visible and clamps hostile deltas', () => {
    const environment = createDeepWaterEnvironment();
    expect(environment.root.visible).toBe(true);
    environment.root.visible = false;
    environment.update(1);
    expect(causticTime(environment)).toBe(0);
    environment.root.visible = true;
    environment.update(0.1);
    expect(causticTime(environment)).toBeCloseTo(0.1, 10);
    environment.update(1e9);
    expect(causticTime(environment)).toBeCloseTo(0.35, 10);
    environment.update(Number.POSITIVE_INFINITY);
    environment.update(Number.NaN);
    environment.update(-5);
    environment.update(0);
    expect(causticTime(environment)).toBeCloseTo(0.35, 10);
    for (let index = 0; index < CAUSTIC_PERIOD * 8; index += 1) environment.update(0.25);
    const wrapped = causticTime(environment);
    expect(Number.isFinite(wrapped)).toBe(true);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(CAUSTIC_PERIOD);
    expect(wrapped).toBeCloseTo(0.35, 6);
    const floor = environment.root.getObjectByName('deep-water-floor') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    const phase = (Math.PI * 2 * wrapped) / CAUSTIC_PERIOD;
    const waveA = floor.material.uniforms.uWaveA.value as THREE.Vector2;
    const waveB = floor.material.uniforms.uWaveB.value as THREE.Vector2;
    expect(waveA.x).toBeCloseTo(Math.cos(phase * 3), 10);
    expect(waveA.y).toBeCloseTo(Math.sin(phase * 3), 10);
    expect(waveB.y).toBeCloseTo(Math.sin(phase * -2), 10);
    for (const value of [waveA.x, waveA.y, waveB.x, waveB.y]) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
    environment.dispose();
  });

  it('disposes every geometry, material, and texture once and detaches the root', () => {
    const environment = createDeepWaterEnvironment();
    const parent = new THREE.Group();
    parent.add(environment.root);
    const { geometries, materials, textures } = ownedResources(environment.root);
    expect(geometries.size).toBeGreaterThan(0);
    expect(materials.size).toBeGreaterThan(0);
    expect(textures.size).toBeGreaterThan(0);
    const spies = [...geometries, ...materials, ...textures].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    environment.dispose();
    environment.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(environment.root.parent).toBeNull();
    environment.root.visible = true;
    environment.update(0.1);
    expect(causticTime(environment)).toBe(0);
  });
});
