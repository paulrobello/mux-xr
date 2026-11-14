import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHangarDeckEnvironment,
  HANGAR_DECK_PANE_SAFE_RADIUS,
} from '../src/xr/environments/hangar-deck';

const backgroundDeltas = vi.hoisted(() => [] as number[]);

vi.mock('@par/xr-workspace/internal/space-background', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/xr/space-background')>();
  return {
    ...original,
    createSpaceBackground: () => {
      const background = original.createSpaceBackground();
      return {
        ...background,
        update: (deltaSeconds: number) => {
          backgroundDeltas.push(deltaSeconds);
          background.update(deltaSeconds);
        },
      };
    },
  };
});

beforeEach(() => {
  backgroundDeltas.length = 0;
});

const CAMERA_FAR = 100;

/** Distance from the origin to a triangle projected onto the XZ plane. */
function horizontalDistanceToTriangle(
  a: THREE.Vector2,
  b: THREE.Vector2,
  c: THREE.Vector2,
): number {
  const cross = (p: THREE.Vector2, q: THREE.Vector2): number => p.x * q.y - p.y * q.x;
  const area = cross(new THREE.Vector2().subVectors(b, a), new THREE.Vector2().subVectors(c, a));
  if (Math.abs(area) > 1e-9) {
    const origin = new THREE.Vector2();
    const s1 = cross(
      new THREE.Vector2().subVectors(b, a),
      new THREE.Vector2().subVectors(origin, a),
    );
    const s2 = cross(
      new THREE.Vector2().subVectors(c, b),
      new THREE.Vector2().subVectors(origin, b),
    );
    const s3 = cross(
      new THREE.Vector2().subVectors(a, c),
      new THREE.Vector2().subVectors(origin, c),
    );
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
  }
  const toSegment = (p: THREE.Vector2, q: THREE.Vector2): number => {
    const edge = new THREE.Vector2().subVectors(q, p);
    const lengthSq = edge.lengthSq();
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, -p.dot(edge) / lengthSq));
    return p.clone().addScaledVector(edge, t).length();
  };
  return Math.min(toSegment(a, b), toSegment(b, c), toSegment(c, a));
}

function positions(root: THREE.Object3D): number[] {
  const values: number[] = [];
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  root.traverse((object) => {
    const attribute = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!attribute) return;
    for (let index = 0; index < attribute.count; index += 1) {
      point.fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld);
      values.push(point.x, point.y, point.z);
    }
  });
  return values;
}

function colors(root: THREE.Object3D): number[] {
  const values: number[] = [];
  root.traverse((object) => {
    const attribute = (object as THREE.Mesh).geometry?.getAttribute?.('color');
    if (!attribute) return;
    for (let index = 0; index < attribute.count * attribute.itemSize; index += 1)
      values.push(attribute.array[index] as number);
  });
  return values;
}

function maxDistance(values: readonly number[]): number {
  let maximum = 0;
  for (let index = 0; index < values.length; index += 3) {
    maximum = Math.max(maximum, Math.hypot(values[index], values[index + 1], values[index + 2]));
  }
  return maximum;
}

interface Owned {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}

function ownedResources(root: THREE.Object3D): Owned {
  const owned: Owned = { geometries: new Set(), materials: new Set(), textures: new Set() };
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    if (!renderable.geometry || !renderable.material) return;
    owned.geometries.add(renderable.geometry);
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of materials) {
      owned.materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) owned.textures.add(value);
      }
    }
  });
  return owned;
}

describe('orbital hangar deck environment', () => {
  it('is deterministic, finite, and stays within the camera far plane', () => {
    const first = createHangarDeckEnvironment();
    const second = createHangarDeckEnvironment();
    expect(first.root.name).toBe('hangar-deck-environment');
    const firstPositions = positions(first.root);
    expect(firstPositions).toEqual(positions(second.root));
    expect(colors(first.root)).toEqual(colors(second.root));
    expect(firstPositions.every(Number.isFinite)).toBe(true);
    expect(colors(first.root).every(Number.isFinite)).toBe(true);
    expect(maxDistance(firstPositions)).toBeLessThan(80);
    expect(maxDistance(firstPositions)).toBeLessThan(CAMERA_FAR);
    first.dispose();
    second.dispose();
  });

  it('places the walkable floor at floorY, matching the observatory floor', () => {
    const environment = createHangarDeckEnvironment();
    expect(environment.floorY).toBeCloseTo(0.035, 6);
    environment.root.updateMatrixWorld(true);
    const structure = environment.root.getObjectByName('hangar-deck-structure');
    expect(structure).toBeDefined();
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    // Plate centres; the 14 mm seams between plates drop to a recessed subfloor.
    for (const [x, z] of [
      [0.6, -1.8],
      [-0.6, -3],
      [1.8, 0.6],
      [-3, -5.4],
      [3, 3],
      [-5.4, 5.4],
    ]) {
      raycaster.set(new THREE.Vector3(x, 1.6, z), down);
      const [hit] = raycaster.intersectObject(structure as THREE.Object3D, false);
      expect(hit?.point.y).toBeCloseTo(environment.floorY, 6);
    }
    environment.dispose();
  });

  it('keeps every deck face below 3 m outside the pane-safe radius, except the floor', () => {
    expect(HANGAR_DECK_PANE_SAFE_RADIUS).toBe(6.5);
    const environment = createHangarDeckEnvironment();
    const structure = environment.root.getObjectByName('hangar-deck-structure') as THREE.Mesh;
    const position = structure.geometry.getAttribute('position');
    const index = structure.geometry.getIndex();
    expect(index).not.toBeNull();
    const vertex = new THREE.Vector3();
    const corners = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
    let checked = 0;
    let violations = 0;
    for (let face = 0; face < (index?.count ?? 0); face += 3) {
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let corner = 0; corner < 3; corner += 1) {
        vertex.fromBufferAttribute(position, index?.getX(face + corner) ?? 0);
        corners[corner].set(vertex.x, vertex.z);
        minY = Math.min(minY, vertex.y);
        maxY = Math.max(maxY, vertex.y);
      }
      const isFloor = maxY <= environment.floorY + 0.01;
      if (isFloor || minY >= 3) continue;
      checked += 1;
      if (
        horizontalDistanceToTriangle(corners[0], corners[1], corners[2]) <
        HANGAR_DECK_PANE_SAFE_RADIUS
      )
        violations += 1;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(violations).toBe(0);
    environment.dispose();
  });

  it('keeps the forward pane field quiet: only a high band faces forward, sides beyond 45 degrees', () => {
    const environment = createHangarDeckEnvironment();
    const glass = environment.root.getObjectByName('hangar-deck-window-glass') as THREE.Mesh;
    const position = glass.geometry.getAttribute('position');
    const eyeY = 1.6;
    let side = 0;
    let band = 0;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      const azimuth = THREE.MathUtils.radToDeg(Math.atan2(Math.abs(x), -z));
      if (azimuth > 45) {
        side += 1;
        continue;
      }
      // The forward band stays at least 8 degrees above eye level (its outer corners, 8.5 m away,
      // are the lowest) and within +-35 degrees.
      const elevation = THREE.MathUtils.radToDeg(
        Math.atan2(position.getY(index) - eyeY, Math.hypot(x, z)),
      );
      expect(elevation).toBeGreaterThan(8);
      expect(azimuth).toBeLessThan(35);
      band += 1;
    }
    expect(side).toBe(8);
    expect(band).toBe(4);
    environment.dispose();
  });

  it('clamps the delta it forwards and skips invalid or hidden updates', () => {
    const environment = createHangarDeckEnvironment();
    for (const delta of [Number.NaN, -1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 0])
      environment.update(delta);
    expect(backgroundDeltas).toEqual([]);
    environment.update(1e9);
    environment.update(0.016);
    expect(backgroundDeltas).toEqual([0.25, 0.016]);
    environment.root.visible = false;
    environment.update(0.1);
    expect(backgroundDeltas).toHaveLength(2);
    environment.dispose();
    environment.root.visible = true;
    environment.update(0.1);
    expect(backgroundDeltas).toHaveLength(2);
  });

  it('keeps the draw-call count low with merged static geometry', () => {
    const environment = createHangarDeckEnvironment();
    let drawables = 0;
    environment.root.traverse((object) => {
      if ((object as THREE.Mesh).geometry) drawables += 1;
    });
    expect(drawables).toBeLessThanOrEqual(10);
    environment.dispose();
  });

  it('disposes every geometry, material and texture exactly once and detaches', () => {
    const environment = createHangarDeckEnvironment();
    const parent = new THREE.Scene();
    parent.add(environment.root);
    const owned = ownedResources(environment.root);
    expect(owned.geometries.size).toBeGreaterThanOrEqual(3);
    expect(owned.materials.size).toBeGreaterThanOrEqual(3);
    expect(owned.textures.size).toBeGreaterThanOrEqual(1);
    const spies = [...owned.geometries, ...owned.materials, ...owned.textures].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    environment.dispose();
    environment.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(environment.root.parent).toBeNull();
    environment.update(0.016);
  });

  it('treats NaN, negative, infinite and huge deltas safely', () => {
    const environment = createHangarDeckEnvironment();
    const before = positions(environment.root);
    for (const delta of [Number.NaN, -1, Number.POSITIVE_INFINITY, 1e9, 0]) {
      expect(() => environment.update(delta)).not.toThrow();
    }
    for (let index = 0; index < 400; index += 1) environment.update(1e6);
    const after = positions(environment.root);
    expect(after.every(Number.isFinite)).toBe(true);
    expect(after.length).toBe(before.length);
    environment.root.visible = false;
    expect(() => environment.update(0.5)).not.toThrow();
    environment.dispose();
  });
});
