import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createDesertNightEnvironment,
  DESERT_NIGHT_MOON_AZIMUTH_DEGREES,
} from '../src/xr/environments/desert-night';

const CAMERA_FAR = 100;

function drawables(root: THREE.Object3D): (THREE.Mesh | THREE.Points)[] {
  const found: (THREE.Mesh | THREE.Points)[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) found.push(object);
  });
  return found;
}

function worldPositions(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const values: number[] = [];
  const vertex = new THREE.Vector3();
  for (const object of drawables(root)) {
    const attribute = object.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1) {
      vertex.fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld);
      values.push(vertex.x, vertex.y, vertex.z);
    }
  }
  return values;
}

const EYE_HEIGHT = 1.6;

// Azimuth from the forward -Z axis, positive toward +X.
function azimuthDegrees(x: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(x, -z));
}

function snapshot(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true);
  const state: unknown[] = [];
  root.traverse((object) => {
    state.push(object.name, object.visible, object.renderOrder, [...object.matrixWorld.elements]);
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
    for (const name of Object.keys(object.geometry.attributes)) {
      state.push(name, Array.from(object.geometry.getAttribute(name).array as ArrayLike<number>));
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const basic = material as THREE.MeshBasicMaterial;
      state.push(
        basic.color?.getHex(),
        basic.opacity,
        basic.visible,
        basic.map?.offset.toArray(),
        basic.map?.rotation,
        basic.map?.version,
      );
    }
  });
  return state;
}

describe('desert night plateau environment', () => {
  it('is deterministic, finite, and stays within the camera far plane', () => {
    const first = createDesertNightEnvironment();
    const second = createDesertNightEnvironment();
    expect(first.root.name).toBe('desert-night-environment');
    const values = worldPositions(first.root);
    expect(values).toEqual(worldPositions(second.root));
    expect(values.every(Number.isFinite)).toBe(true);
    let maximum = 0;
    for (let index = 0; index < values.length; index += 3) {
      maximum = Math.max(maximum, Math.hypot(values[index], values[index + 1], values[index + 2]));
    }
    expect(maximum).toBeLessThan(CAMERA_FAR * 0.9);
    first.dispose();
    second.dispose();
  });

  it('keeps the draw-call budget at five or fewer', () => {
    const environment = createDesertNightEnvironment();
    expect(drawables(environment.root).length).toBeLessThanOrEqual(5);
    environment.dispose();
  });

  it('builds the terrain ring as one mesh that rings the horizon', () => {
    const environment = createDesertNightEnvironment();
    const terrain = drawables(environment.root).filter((object) => object.name.includes('terrain'));
    expect(terrain).toHaveLength(1);
    const ring = terrain[0];
    expect(ring).toBeInstanceOf(THREE.Mesh);
    const position = ring.geometry.getAttribute('position');
    const quadrants = new Set<number>();
    let minimumRadius = Number.POSITIVE_INFINITY;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      minimumRadius = Math.min(minimumRadius, Math.hypot(x, z));
      quadrants.add((x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0));
    }
    expect(quadrants.size).toBe(4);
    expect(minimumRadius).toBeGreaterThan(30);
    environment.dispose();
  });

  it('places the walkable floor surface at floorY', () => {
    const environment = createDesertNightEnvironment();
    expect(environment.floorY).toBe(0.035);
    const floor = environment.root.getObjectByName('desert-night-plateau-floor') as
      | THREE.Mesh
      | undefined;
    expect(floor).toBeDefined();
    const position = floor?.geometry.getAttribute('position') as THREE.BufferAttribute;
    let nearCount = 0;
    for (let index = 0; index < position.count; index += 1) {
      if (Math.hypot(position.getX(index), position.getZ(index)) > 12) continue;
      nearCount += 1;
      expect(position.getY(index)).toBeCloseTo(environment.floorY, 6);
    }
    expect(nearCount).toBeGreaterThan(0);
    environment.dispose();
  });

  it('keeps the front pane sector clear: low terrain within ±60° and the moon outside ±70°', () => {
    const environment = createDesertNightEnvironment();
    environment.root.updateMatrixWorld(true);
    const terrain = environment.root.getObjectByName('desert-night-terrain-ring') as THREE.Mesh;
    const position = terrain.geometry.getAttribute('position');
    let maximumElevation = Number.NEGATIVE_INFINITY;
    let sampled = 0;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      if (Math.abs(azimuthDegrees(x, z)) > 60) continue;
      sampled += 1;
      const elevation = THREE.MathUtils.radToDeg(
        Math.atan2(position.getY(index) - EYE_HEIGHT, Math.hypot(x, z)),
      );
      maximumElevation = Math.max(maximumElevation, elevation);
    }
    expect(sampled).toBeGreaterThan(100);
    expect(maximumElevation).toBeLessThan(2);
    const moon = environment.root.getObjectByName('desert-night-moon') as THREE.Mesh;
    const moonPosition = moon.getWorldPosition(new THREE.Vector3());
    expect(Math.abs(azimuthDegrees(moonPosition.x, moonPosition.z))).toBeGreaterThan(70);
    expect(Math.abs(DESERT_NIGHT_MOON_AZIMUTH_DEGREES)).toBeGreaterThanOrEqual(75);
    expect((moon.material as THREE.MeshBasicMaterial).depthWrite).toBe(true);
    environment.dispose();
  });

  it('has no animated state: update changes no transform, vertex, colour or material', () => {
    const environment = createDesertNightEnvironment();
    environment.root.visible = true;
    const before = snapshot(environment.root);
    for (let frame = 0; frame < 600; frame += 1) environment.update(1 / 72);
    environment.update(0.25);
    environment.update(10);
    environment.update(Number.NaN);
    environment.update(-1);
    expect(snapshot(environment.root)).toEqual(before);
    environment.dispose();
    expect(() => environment.update(0.016)).not.toThrow();
  });

  it('disposes every geometry, material and texture once and detaches the root', () => {
    const environment = createDesertNightEnvironment();
    const parent = new THREE.Group();
    parent.add(environment.root);
    const geometrySpies: ReturnType<typeof vi.spyOn>[] = [];
    const materialSpies: ReturnType<typeof vi.spyOn>[] = [];
    const textureSpies: ReturnType<typeof vi.spyOn>[] = [];
    for (const object of drawables(environment.root)) {
      geometrySpies.push(vi.spyOn(object.geometry, 'dispose'));
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        materialSpies.push(vi.spyOn(material, 'dispose'));
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textureSpies.push(vi.spyOn(value, 'dispose'));
        }
      }
    }
    expect(geometrySpies.length).toBe(5);
    expect(materialSpies.length).toBe(5);
    expect(textureSpies.length).toBeGreaterThan(0);
    environment.dispose();
    environment.dispose();
    for (const spy of [...geometrySpies, ...materialSpies, ...textureSpies]) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(environment.root.parent).toBeNull();
  });
});
