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
    Object.assign(key.userData, { keyborb: true, keyborbSlot: x, labelWidth: 0.105 });
    root.add(key);
    return key;
  });
  const source = new THREE.Group();
  const input = createKeyborbInput();
  input.begin(root);
  return { root, keys, source, input };
}

describe('Keyborb fingertip interaction', () => {
  it('uses the last displayed target for native event resampling and rearms on another orb', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0.09, 0, 0.06);
    const thumb = new THREE.Vector3(0.03, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    index.x += 0.02;
    thumb.x += 0.02;
    expect(input.sample(source, index, thumb, null, true, 0).hovered).toBe(keys[0]);
    expect(input.nativePress(source, null)).toBe(keys[0]);
    expect(input.sample(source, index, thumb, null, true).hovered).toBe(keys[0]);
    input.nativeRelease(source);
    index.x = 0.17;
    thumb.x = 0.09;
    for (let frame = 0; frame < 4; frame++) input.sample(source, index, thumb, null, true);
    index.x = 0.15;
    thumb.x = 0.11;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[1]);
  });
  it('retains controller hover while pinch typing is disabled', () => {
    const { keys, source, input } = fixture();
    const result = input.sample(
      source,
      new THREE.Vector3(0.04, 0, 0.06),
      new THREE.Vector3(-0.04, 0, 0.06),
      null,
      false,
    );
    expect(result.hovered).toBe(keys[0]);
    expect(input.nativePress(source, null)).toBeNull();
  });
  it('keeps the hovered orb when the closing midpoint drifts across its neighbor', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0.03, 0, 0.06);
    const thumb = new THREE.Vector3(-0.03, 0, 0.06);
    index.x = 0.09;
    thumb.x = 0.03;
    expect(input.sample(source, index, thumb, null, true).hovered).toBe(keys[0]);
    index.x = 0.0975;
    thumb.x = 0.0535;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
  });

  it('uses the supplied visual target point for acquisition', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0.14, 0, 0.06);
    const thumb = new THREE.Vector3(0, 0, 0.06);
    expect(
      input.sample(source, index, thumb, null, true, undefined, new THREE.Vector3(0, 0, 0.06))
        .hovered,
    ).toBe(keys[0]);
  });

  it('remaps a retained target to the same slot after a keyboard rebuild', () => {
    const { root, source, input } = fixture();
    const index = new THREE.Vector3(0.09, 0, 0.06);
    const thumb = new THREE.Vector3(0.03, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    const replacement = root.clone();
    input.begin(replacement);
    index.x = 0.0975;
    thumb.x = 0.0535;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(replacement.children[0]);
  });

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

  it('follows the hand across a production-scale row while the fingers rest curled', () => {
    const root = new THREE.Group();
    root.scale.setScalar(0.38);
    const keys = [0, 1, 2, 3, 4].map((slot) => {
      const key = new THREE.Mesh(new THREE.SphereGeometry(0.0525));
      key.position.x = slot * 0.13;
      Object.assign(key.userData, { keyborb: true, keyborbSlot: slot, labelWidth: 0.105 });
      root.add(key);
      return key;
    });
    const source = new THREE.Group();
    const input = createKeyborbInput();
    input.begin(root);
    const target = new THREE.Vector3();
    for (const [slot, key] of keys.entries()) {
      target.set(slot * 0.13 * 0.38, 0, 0.03);
      const index = target.clone().add(new THREE.Vector3(0.015, 0, 0));
      const thumb = target.clone().add(new THREE.Vector3(-0.015, 0, 0));
      expect(input.sample(source, index, thumb, null, true, 1 / 60, target).hovered).toBe(key);
    }
  });

  it('highlights the orb when the pinch closes and types it only when the pinch opens', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0.04, 0, 0.06);
    const thumb = new THREE.Vector3(-0.04, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    index.x = 0.02;
    thumb.x = -0.02;
    const closed = input.sample(source, index, thumb, null, true);
    expect(closed.pressed).toBe(keys[0]);
    expect(closed.committed).toBeNull();
    expect(input.held().has(keys[0])).toBe(true);
    for (let frame = 0; frame < 10; frame++)
      expect(input.sample(source, index, thumb, null, true).committed).toBeNull();
    index.x = 0.04;
    thumb.x = -0.04;
    const committed: (THREE.Mesh | null)[] = [];
    for (let frame = 0; frame < 4; frame++)
      committed.push(input.sample(source, index, thumb, null, true).committed);
    expect(committed.filter(Boolean)).toEqual([keys[0]]);
    expect(input.held().size).toBe(0);
  });

  it('types a native pinch once on release and drops a held key when tracking is lost', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0, 0, 0.06);
    const thumb = new THREE.Vector3(-0.08, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    expect(input.nativePress(source, null)).toBe(keys[0]);
    thumb.x = -0.02;
    expect(input.sample(source, index, thumb, null, true).committed).toBeNull();
    expect(input.nativeRelease(source)).toBe(true);
    expect(input.commit(source)).toBe(keys[0]);
    thumb.x = -0.08;
    for (let frame = 0; frame < 4; frame++)
      expect(input.sample(source, index, thumb, null, true).committed).toBeNull();
    thumb.x = -0.02;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
    for (let frame = 0; frame < 8; frame++)
      expect(input.sample(source, null, null, null, true).committed).toBeNull();
    expect(input.held().size).toBe(0);
    expect(input.commit(source)).toBeNull();
  });

  it('keeps a held key through a brief tracking gap and types it on release', () => {
    const { keys, source, input } = fixture();
    const index = new THREE.Vector3(0.04, 0, 0.06);
    const thumb = new THREE.Vector3(-0.04, 0, 0.06);
    input.sample(source, index, thumb, null, true);
    index.x = 0.02;
    thumb.x = -0.02;
    expect(input.sample(source, index, thumb, null, true).pressed).toBe(keys[0]);
    for (let frame = 0; frame < 3; frame++) input.sample(source, null, null, null, true);
    index.x = 0.04;
    thumb.x = -0.04;
    const committed: (THREE.Mesh | null)[] = [];
    for (let frame = 0; frame < 4; frame++)
      committed.push(input.sample(source, index, thumb, null, true).committed);
    expect(committed.filter(Boolean)).toEqual([keys[0]]);
  });

  it('lets go of the key a relaxed hand curled over once it hovers another orb', () => {
    const root = new THREE.Group();
    root.scale.setScalar(0.38);
    const keys = [0, 1, 2, 3].map((slot) => {
      const key = new THREE.Mesh(new THREE.SphereGeometry(0.0525));
      key.position.x = slot * 0.13;
      Object.assign(key.userData, { keyborb: true, keyborbSlot: slot, labelWidth: 0.105 });
      root.add(key);
      return key;
    });
    const source = new THREE.Group();
    const input = createKeyborbInput();
    input.begin(root);
    const at = (slot: number, gap: number) => {
      const target = new THREE.Vector3(slot * 0.13 * 0.38, 0, 0.03);
      return input.sample(
        source,
        target.clone().add(new THREE.Vector3(gap / 2, 0, 0)),
        target.clone().add(new THREE.Vector3(-gap / 2, 0, 0)),
        null,
        true,
        1 / 60,
        target,
      );
    };
    at(0, 0.06);
    expect(at(0, 0.04).pressed).toBe(keys[0]);
    for (const slot of [1, 2, 3]) expect(at(slot, 0.04).hovered).toBe(keys[slot]);
    expect(input.held().size).toBe(0);
    expect(input.nativePress(source, null)).toBe(keys[3]);
    expect(input.nativeRelease(source)).toBe(true);
    expect(input.commit(source)).toBe(keys[3]);
    at(3, 0.04);
    at(3, 0.06);
    at(3, 0.06);
    at(3, 0.06);
    expect(input.commit(source)).toBeNull();
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
