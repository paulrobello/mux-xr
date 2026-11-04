import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createElasticArm } from '../src/xr/elastic-arm';

function center(positions: THREE.BufferAttribute, segment: number, side = 0): THREE.Vector3 {
  const result = new THREE.Vector3();
  result.fromBufferAttribute(positions, segment * 10 + side);
  return result;
}

describe('elastic arm', () => {
  it('keeps endpoints exact and sags below the chord', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const anchor = new THREE.Vector3(0, 1, 0);
    const wrist = new THREE.Vector3(1, 1, 0);
    arm.update(anchor, wrist, 1);
    const positions = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(center(positions, 0).distanceTo(anchor)).toBeCloseTo(0.018, 3);
    expect(center(positions, 24).distanceTo(wrist)).toBeCloseTo(0.014, 3);
    expect(center(positions, 12).y).toBeLessThan(1);
    arm.dispose();
  });

  it('reuses buffers, owns geometry only, and is not pickable', () => {
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, 'dispose');
    const arm = createElasticArm(material);
    const position = arm.mesh.geometry.getAttribute('position');
    const normal = arm.mesh.geometry.getAttribute('normal');
    const dispose = vi.spyOn(arm.mesh.geometry, 'dispose');
    arm.update(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 1);
    expect(arm.mesh.geometry.getAttribute('position')).toBe(position);
    expect(arm.mesh.geometry.getAttribute('normal')).toBe(normal);
    expect(arm.mesh.raycast).not.toBe(THREE.Mesh.prototype.raycast);
    arm.dispose();
    arm.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it('stays finite for vertical and coincident endpoints and reset clears lag', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const position = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    arm.update(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0.001);
    arm.update(new THREE.Vector3(), new THREE.Vector3(0, 0, 0), 0.016);
    expect(arm.mesh.visible).toBe(false);
    for (let i = 0; i < position.array.length; i += 1)
      expect(Number.isFinite(position.array[i])).toBe(true);
    arm.reset();
    arm.update(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 2, 0), 0);
    expect(center(position, 12).y).toBeLessThan(2);
    arm.dispose();
  });
});
