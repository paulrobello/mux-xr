import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { keepLayoutAboveFloor, workspaceFloorY } from '../src/xr/floor-layout';

const panel = (height: number): THREE.Group => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, height, 0.04)));
  return root;
};

const bounds = (roots: readonly THREE.Group[]): THREE.Box3 => {
  const result = new THREE.Box3().makeEmpty();
  for (const root of roots) result.union(new THREE.Box3().setFromObject(root));
  return result;
};

describe('floor-aware workspace layout', () => {
  it('maps observatory and AR floors while leaving black and gradient unconstrained', () => {
    expect(workspaceFloorY('observatory', 'desktop')).toBeCloseTo(0.035);
    expect(workspaceFloorY('observatory', 'vr')).toBeCloseTo(0.035);
    expect(workspaceFloorY('observatory', 'ar')).toBe(0);
    expect(workspaceFloorY('black', 'vr')).toBeNull();
    expect(workspaceFloorY('gradient', 'desktop')).toBeNull();
  });

  it('lifts mixed rotated and scaled roots by one shared world offset', () => {
    const parent = new THREE.Group();
    parent.position.set(0.5, 0.2, -1);
    parent.rotation.y = 0.35;
    parent.scale.set(1.2, 0.9, 1.1);
    const first = panel(0.8);
    const second = panel(1.4);
    first.position.set(-0.8, -0.2, 0);
    second.position.set(0.8, -0.7, 0);
    second.rotation.z = 0.3;
    second.scale.set(0.8, 1.3, 1);
    parent.add(first, second);
    parent.updateWorldMatrix(true, true);
    const beforeDistance = first
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(second.getWorldPosition(new THREE.Vector3()));
    const offset = keepLayoutAboveFloor([first, second], 0.035, new THREE.Vector3(0, 1.4, 2));
    const measured = bounds([first, second]);
    expect(offset).toBeGreaterThan(0);
    expect(measured.min.y).toBeGreaterThanOrEqual(0.095 - 1e-6);
    expect(
      first
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(second.getWorldPosition(new THREE.Vector3())),
    ).toBeCloseTo(beforeDistance);
    expect(first.quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(second.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });

  it('is a no-op when no floor applies or all geometry is already clear', () => {
    const root = panel(0.4);
    root.position.y = 1;
    const before = root.position.clone();
    expect(keepLayoutAboveFloor([root], null, new THREE.Vector3())).toBe(0);
    expect(root.position.toArray()).toEqual(before.toArray());
    expect(keepLayoutAboveFloor([root], 0.035, new THREE.Vector3())).toBe(0);
  });
});
