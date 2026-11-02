import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSpaceBackground } from '../src/xr/space-background';

function positions(root: THREE.Object3D): number[] {
  const values: number[] = [];
  root.traverse((object) => {
    const attribute = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!attribute) return;
    for (let index = 0; index < attribute.count; index += 1) {
      values.push(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
    }
  });
  return values;
}

function maxDistance(root: THREE.Object3D): number {
  let maximum = 0;
  root.traverse((object) => {
    const attribute = (object as THREE.Mesh).geometry?.getAttribute?.('position');
    if (!attribute) return;
    for (let index = 0; index < attribute.count; index += 1) {
      maximum = Math.max(
        maximum,
        new THREE.Vector3(
          attribute.getX(index),
          attribute.getY(index),
          attribute.getZ(index),
        ).length(),
      );
    }
  });
  return maximum;
}

describe('observatory exterior space', () => {
  it('is deterministic, finite, and stays within the camera far plane', () => {
    const first = createSpaceBackground();
    const second = createSpaceBackground();
    expect(first.root.name).toBe('observatory-exterior-space');
    expect(positions(first.root)).toEqual(positions(second.root));
    expect(positions(first.root).every(Number.isFinite)).toBe(true);
    expect(first.root.children).toHaveLength(3);
    expect(maxDistance(first.root)).toBeLessThan(80);
    first.dispose();
    second.dispose();
  });

  it('disposes owned resources idempotently and detaches the root', () => {
    const background = createSpaceBackground();
    const geometries = background.root.children.map((child) => (child as THREE.Mesh).geometry);
    const dispose = vi.spyOn(geometries[0], 'dispose');
    background.dispose();
    background.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(background.root.parent).toBeNull();
  });
});
