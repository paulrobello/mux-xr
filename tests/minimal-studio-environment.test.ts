import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createMinimalStudioEnvironment,
  MINIMAL_STUDIO_FLOOR_Y,
  minimalStudioGridStrength,
} from '../src/xr/environments/minimal-studio';

const CAMERA_FAR = 100;

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}

function material(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
  return mesh.material as THREE.MeshBasicMaterial;
}

/** Everything that can change what the environment draws: transforms, every vertex attribute,
 * material state and texture pixels. */
function snapshot(root: THREE.Object3D): unknown {
  root.updateMatrixWorld(true);
  const objects: unknown[] = [];
  root.traverse((object) => {
    const entry: Record<string, unknown> = {
      name: object.name,
      visible: object.visible,
      renderOrder: object.renderOrder,
      matrixWorld: [...object.matrixWorld.elements],
    };
    if (object instanceof THREE.Mesh) {
      const geometry = object.geometry as THREE.BufferGeometry;
      entry.attributes = Object.fromEntries(
        Object.entries(geometry.attributes).map(([key, attribute]) => [
          key,
          [...(attribute as THREE.BufferAttribute).array],
        ]),
      );
      entry.index = geometry.index ? [...geometry.index.array] : null;
      const basic = material(object);
      entry.material = {
        color: basic.color.getHex(),
        opacity: basic.opacity,
        transparent: basic.transparent,
        side: basic.side,
        dithering: basic.dithering,
        vertexColors: basic.vertexColors,
        depthWrite: basic.depthWrite,
        map: basic.map
          ? {
              pixels: [...((basic.map as THREE.DataTexture).image.data as Uint8Array)],
              offset: basic.map.offset.toArray(),
              repeat: basic.map.repeat.toArray(),
              rotation: basic.map.rotation,
            }
          : null,
      };
    }
    objects.push(entry);
  });
  return objects;
}

function worldPositions(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  for (const mesh of meshes(root)) {
    const attribute = mesh.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1)
      points.push(
        new THREE.Vector3().fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld),
      );
  }
  return points;
}

function triangleCount(root: THREE.Object3D): number {
  return meshes(root).reduce((total, mesh) => {
    const index = mesh.geometry.getIndex();
    return total + (index ? index.count : mesh.geometry.getAttribute('position').count) / 3;
  }, 0);
}

describe('minimal studio environment', () => {
  it('builds identical positions, colours, transforms and textures every time', () => {
    const first = createMinimalStudioEnvironment();
    const second = createMinimalStudioEnvironment();
    expect(first.root.name).toBe('minimal-studio-environment');
    const reference = snapshot(first.root);
    expect(snapshot(second.root)).toEqual(reference);
    // The snapshot must notice a single changed vertex colour, or the comparison proves nothing.
    const floor = second.root.getObjectByName('minimal-studio-floor') as THREE.Mesh;
    const colors = floor.geometry.getAttribute('color') as THREE.BufferAttribute;
    colors.setX(5, colors.getX(5) + 0.001);
    expect(snapshot(second.root)).not.toEqual(reference);
    first.dispose();
    second.dispose();
  });

  it('is finite and stays within the camera far plane', () => {
    const environment = createMinimalStudioEnvironment();
    const points = worldPositions(environment.root);
    expect(points.every((point) => [point.x, point.y, point.z].every(Number.isFinite))).toBe(true);
    expect(Math.max(...points.map((point) => point.length()))).toBeLessThan(CAMERA_FAR * 0.8);
    environment.dispose();
  });

  it('never changes on update: no motion of any kind', () => {
    const environment = createMinimalStudioEnvironment();
    const before = snapshot(environment.root);
    for (const delta of [0.016, 0.25, 5, 120, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      environment.update(delta);
    expect(snapshot(environment.root)).toEqual(before);
    environment.dispose();
  });

  it('places a flat floor surface at floorY, matching the observatory floor', () => {
    const environment = createMinimalStudioEnvironment();
    expect(environment.floorY).toBe(0.035);
    expect(environment.floorY).toBe(MINIMAL_STUDIO_FLOOR_Y);
    const floor = environment.root.getObjectByName('minimal-studio-floor') as THREE.Mesh;
    for (const point of worldPositions(floor)) expect(point.y).toBeCloseTo(environment.floorY, 6);
    environment.dispose();
  });

  it('blends the floor edge into the sky horizon colour', () => {
    const environment = createMinimalStudioEnvironment();
    const floor = environment.root.getObjectByName('minimal-studio-floor') as THREE.Mesh;
    const sky = environment.root.getObjectByName('minimal-studio-horizon') as THREE.Mesh;
    const colorAt = (mesh: THREE.Mesh, pick: (point: THREE.Vector3) => number): number[] => {
      const position = mesh.geometry.getAttribute('position');
      const color = mesh.geometry.getAttribute('color');
      let best = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < position.count; index += 1) {
        const score = pick(new THREE.Vector3().fromBufferAttribute(position, index));
        if (score > bestScore) {
          bestScore = score;
          best = index;
        }
      }
      return [color.getX(best), color.getY(best), color.getZ(best)];
    };
    const floorEdge = colorAt(floor, (point) => Math.hypot(point.x, point.z));
    const floorCenter = colorAt(floor, (point) => -Math.hypot(point.x, point.z));
    const skyHorizon = colorAt(sky, (point) => -Math.abs(point.y));
    for (let channel = 0; channel < 3; channel += 1) {
      expect(floorEdge[channel]).toBeCloseTo(skyHorizon[channel], 3);
      expect(floorCenter[channel]).toBeGreaterThan(floorEdge[channel]);
    }
    environment.dispose();
  });

  it('keeps the grid peripheral: faded ahead under the panes, intact beside and behind', () => {
    expect(minimalStudioGridStrength(0, -0.5)).toBe(1);
    expect(minimalStudioGridStrength(0, -3)).toBeLessThan(0.05);
    const angle = THREE.MathUtils.degToRad(55);
    expect(minimalStudioGridStrength(3 * Math.sin(angle), -3 * Math.cos(angle))).toBeLessThan(0.05);
    expect(minimalStudioGridStrength(3, 0)).toBeGreaterThan(0.95);
    expect(minimalStudioGridStrength(-3, 0)).toBeGreaterThan(0.95);
    expect(minimalStudioGridStrength(0, 3)).toBe(1);
    const environment = createMinimalStudioEnvironment();
    const floor = environment.root.getObjectByName('minimal-studio-floor') as THREE.Mesh;
    const position = floor.geometry.getAttribute('position');
    const strength = floor.geometry.getAttribute('gridStrength');
    expect(strength.count).toBe(position.count);
    let checkedAhead = 0;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      if (Math.hypot(x, z) >= 3 && Math.abs(Math.atan2(x, -z)) <= Math.PI / 3) {
        expect(strength.getX(index)).toBeLessThan(0.05);
        checkedAhead += 1;
      }
    }
    expect(checkedAhead).toBeGreaterThan(0);
    environment.dispose();
  });

  it('stays within a two draw call budget: unlit, dithered, no lights', () => {
    const environment = createMinimalStudioEnvironment();
    const all = meshes(environment.root);
    expect(all).toHaveLength(2);
    for (const mesh of all) {
      expect(Array.isArray(mesh.material)).toBe(false);
      expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(material(mesh).dithering).toBe(true);
    }
    let lights = 0;
    environment.root.traverse((object) => {
      if (object instanceof THREE.Light) lights += 1;
    });
    expect(lights).toBe(0);
    expect(triangleCount(environment.root)).toBeLessThan(6000);
    environment.dispose();
  });

  it('disposes every geometry, material and texture once and detaches the root', () => {
    const environment = createMinimalStudioEnvironment();
    const parent = new THREE.Group();
    parent.add(environment.root);
    const geometrySpies = meshes(environment.root).map((mesh) =>
      vi.spyOn(mesh.geometry, 'dispose'),
    );
    const materials = meshes(environment.root).map((mesh) => mesh.material as THREE.Material);
    const materialSpies = materials.map((entry) => vi.spyOn(entry, 'dispose'));
    const textures = materials.flatMap((entry) =>
      Object.values(entry).filter((value) => value instanceof THREE.Texture),
    ) as THREE.Texture[];
    expect(textures.length).toBeGreaterThan(0);
    const textureSpies = textures.map((texture) => vi.spyOn(texture, 'dispose'));
    environment.dispose();
    environment.dispose();
    expect(geometrySpies).toHaveLength(2);
    expect(materialSpies).toHaveLength(2);
    for (const spy of [...geometrySpies, ...materialSpies, ...textureSpies])
      expect(spy).toHaveBeenCalledTimes(1);
    expect(environment.root.parent).toBeNull();
  });
});
