import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createKeyborbInput } from '../src/xr/keyborb-input';

function fixture(): {
  root: THREE.Group;
  keys: THREE.Mesh[];
  source: THREE.Group;
  input: ReturnType<typeof createKeyborbInput>;
} {
  const root = new THREE.Group();
  const keys = [0, 0.13].map((x) => {
    const key = new THREE.Mesh(new THREE.SphereGeometry(0.0525));
    key.position.x = x;
    Object.assign(key.userData, { keyborb: true, labelWidth: 0.105 });
    root.add(key);
    return key;
  });
  const source = new THREE.Group();
  const input = createKeyborbInput();
  input.begin(root);
  return { root, keys, source, input };
}

describe('Keyborb fingertip interaction', () => {
  it('selects the orb nearest the midpoint rather than either fingertip', () => {
    const { keys, source, input } = fixture();
    const result = input.sample(
      source,
      new THREE.Vector3(0, 0, 0.06),
      new THREE.Vector3(0.14, 0, 0.06),
      null,
      true,
    );
    expect(result.hovered).toBe(keys[1]);
    input.animate(1);
    expect(keys[0].position.z).toBe(0);
    expect(keys[1].position.z).toBeCloseTo(0.105, 6);
  });
  it('raises only the nearest orb by its full diameter and returns it on leave', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0.005, 0, 0.09);
    const thumb = new THREE.Vector3(-0.08, 0, 0.09);
    for (let frame = 0; frame < 90; frame++) {
      expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
      input.animate(1 / 90);
    }
    expect(keys[0].position.z).toBeCloseTo(0.105, 6);
    expect(keys[1].position.z).toBe(0);
    expect(input.near(source)).toBe(true);
    index.z = thumb.z = 1;
    input.sample(source, index, thumb, null, true);
    for (let frame = 0; frame < 90; frame++) input.animate(1 / 90);
    expect(keys[0].position.z).toBeCloseTo(0, 6);
  });

  it('lifts along each curved key normal after the keyboard is transformed and scaled', () => {
    const { root, keys, source, input } = fixture();
    input.reset();
    keys[0].rotation.y = 0.6;
    root.position.set(0.2, 1.3, -1);
    root.rotation.set(0.2, -0.4, 0.3);
    root.scale.setScalar(0.4);
    input.begin(root);
    const center = keys[0].getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      keys[0].getWorldQuaternion(new THREE.Quaternion()),
    );
    const index = center.clone().addScaledVector(normal, 0.03);
    input.sample(source, index, index.clone().add(new THREE.Vector3(0, -0.08, 0)), null, true);
    input.animate(1);
    const lift = keys[0].getWorldPosition(new THREE.Vector3()).sub(center);
    expect(lift.length()).toBeCloseTo(0.105 * 0.4, 6);
    expect(lift.clone().normalize().dot(normal)).toBeCloseTo(1, 6);
  });

  it('uses a forgiving 4 cm pinch and requires a fresh opening before sending again', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0.04, 0, 0.06);
    const thumb = new THREE.Vector3(-0.04, 0, 0.06);
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    index.x = 0.02;
    thumb.x = -0.02;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
    for (let frame = 0; frame < 30; frame++)
      expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    index.x = 0.024;
    thumb.x = -0.024;
    expect(input.sample(source, index, thumb, null, true).released).toBe(false);
    index.x = 0.04;
    thumb.x = -0.04;
    expect(input.sample(source, index, thumb, null, true).released).toBe(false);
    input.sample(source, index, thumb, null, true);
    expect(input.sample(source, index, thumb, null, true).released).toBe(true);
    index.x = thumb.x = 0;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
  });

  it('does not replay held pinches after tracking loss, suppression, or keyboard rebuilds', () => {
    const { root, keys, source, input } = fixture();
    const index = new THREE.Vector3(0.02, 0, 0.06);
    const thumb = new THREE.Vector3(-0.02, 0, 0.06);
    expect(input.sample(source, index, thumb, keys[0], true).pressed).toBeNull();
    index.x = 0.08;
    input.sample(source, index, thumb, null, true);
    index.x = 0.02;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
    input.begin(root.clone());
    expect(input.sample(source, index, thumb, keys[0], true).pressed).toBeNull();
    input.reset(source);
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    index.x = 0.08;
    input.sample(source, index, thumb, null, false);
    index.x = 0.02;
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
  });

  it('accepts native pinch fallback without requiring the wider raw opening', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0, 0, 0.06);
    const thumb = new THREE.Vector3(-0.048, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    thumb.x = -0.02;
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    expect(input.nativePress(source, null)).toBe(keys[0]);
    expect(input.nativePress(source, null)).toBeNull();
    expect(input.nativeRelease(source)).toBe(true);
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    expect(input.nativePress(source, null)).toBeNull();
    input.nativeRelease(source);
    thumb.x = -0.048;
    for (let frame = 0; frame < 4; frame++) input.sample(source, index, thumb, null, true);
    thumb.x = -0.02;
    input.sample(source, index, thumb, null, true);
    expect(input.nativePress(source, null)).toBe(keys[0]);
  });

  it('deduplicates native-first and raw-first pinches despite delayed joint poses', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0, 0, 0.06);
    const thumb = new THREE.Vector3(-0.08, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    expect(input.nativePress(source, null)).toBe(keys[0]);
    input.sample(source, index, thumb, null, true);
    thumb.x = -0.02;
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    input.nativeRelease(source);
    thumb.x = -0.08;
    for (let frame = 0; frame < 4; frame++) input.sample(source, index, thumb, null, true);
    thumb.x = -0.04;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
    expect(input.nativePress(source, null)).toBeNull();
    expect(input.nativeRelease(source)).toBe(true);
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    input.reset(source);
    expect(input.nativePress(source, keys[0])).toBeNull();
  });

  it('ignores brief opening jitter and late native events after a raw pinch', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0, 0, 0.06);
    const thumb = new THREE.Vector3(-0.08, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    thumb.x = -0.04;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
    thumb.x = -0.052;
    input.sample(source, index, thumb, null, true, 0.05);
    thumb.x = -0.04;
    expect(input.sample(source, index, thumb, null, true).pressed).toBeNull();
    thumb.x = -0.08;
    for (let frame = 0; frame < 4; frame++) input.sample(source, index, thumb, null, true);
    expect(input.nativePress(source, null)).toBeNull();
    input.nativeRelease(source);
    input.sample(source, index, thumb, null, true);
    thumb.x = -0.04;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
  });

  it('supports a far ray target and resets lifts when the keyboard is hidden or tracking is lost', () => {
    const { root, keys, source, input } = fixture();
    const index = new THREE.Vector3(0, 0, 1);
    const thumb = new THREE.Vector3(-0.08, 0, 1);
    input.sample(source, index, thumb, keys[1], true);
    thumb.x = -0.04;
    expect(input.sample(source, index, thumb, keys[1], true).pressed).toBe(keys[1]);
    index.set(0, 0, 0.07);
    thumb.set(-0.08, 0, 0.07);
    input.sample(source, index, thumb, null, true);
    input.animate(1);
    expect(keys[0].position.z).toBeGreaterThan(0);
    input.reset(source);
    expect(keys[0].position.z).toBe(0);
    root.visible = false;
    input.begin(root);
    expect(input.sample(source, index, thumb, keys[0], true).pressed).toBeNull();
  });

  it('tracks the closest orb independently for both hands and preserves the other hand on reset', () => {
    const { keys, source, input } = fixture();
    const other = new THREE.Group();
    input.sample(
      source,
      new THREE.Vector3(0, 0, 0.06),
      new THREE.Vector3(-0.08, 0, 0.06),
      null,
      true,
    );
    input.sample(
      other,
      new THREE.Vector3(0.13, 0, 0.06),
      new THREE.Vector3(0.21, 0, 0.06),
      null,
      true,
    );
    input.animate(1);
    expect(keys[0].position.z).toBeCloseTo(0.105, 6);
    expect(keys[1].position.z).toBeCloseTo(0.105, 6);
    input.reset(source);
    expect(keys[0].position.z).toBe(0);
    expect(keys[1].position.z).toBeCloseTo(0.105, 6);
    input.begin(null);
    expect(keys[1].position.z).toBe(0);
  });
});
