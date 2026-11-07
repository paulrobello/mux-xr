import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyUIPose, captureUIPose, createUIPoseStore } from '../src/xr/ui-poses';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const validPose = {
  position: [1, 2, -3] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1.5,
};

describe('UI poses', () => {
  it('round-trips each named pose and ignores malformed persisted entries', () => {
    const storage = memoryStorage();
    const store = createUIPoseStore(storage);
    expect(store.save('keyboard', validPose)).toBe(true);
    expect(store.read('keyboard')).toEqual(validPose);
    storage.setItem(
      'mux-xr:ui-poses:v1',
      JSON.stringify({
        version: 1,
        poses: {
          hud: { position: [99, 0, 0], quaternion: [0, 0, 0, 0], scale: 1 },
        },
      }),
    );
    expect(store.read('hud')).toBeNull();
  });

  it('rejects invalid values, handles quota failures, and clears only its key', () => {
    const storage = memoryStorage();
    storage.setItem('unrelated', 'keep');
    const store = createUIPoseStore(storage);
    expect(store.save('hud', { ...validPose, scale: 4 })).toBe(false);
    expect(store.clear()).toBe(true);
    expect(storage.getItem('unrelated')).toBe('keep');
    const failing = memoryStorage();
    failing.setItem = () => {
      throw new Error('quota');
    };
    expect(createUIPoseStore(failing).save('hud', validPose)).toBe(false);
  });

  it('migrates v1 viewer-relative poses once against the nominal standing head', () => {
    const storage = memoryStorage();
    storage.setItem(
      'mux-xr:ui-poses:v1',
      JSON.stringify({ version: 1, poses: { keyboard: validPose } }),
    );
    const store = createUIPoseStore(storage);
    expect(store.read('keyboard')?.position).toEqual([1, 3.52, -3]);
    expect(store.save('hud', validPose)).toBe(true);
    const written = JSON.parse(storage.getItem('mux-xr:ui-poses:v2') ?? '{}');
    expect(written.version).toBe(2);
    expect(written.poses.keyboard.position).toEqual([1, 3.52, -3]);
    expect(store.read('keyboard')?.position).toEqual([1, 3.52, -3]);
    expect(store.clear()).toBe(true);
    expect(storage.getItem('mux-xr:ui-poses:v1')).toBeNull();
  });

  it('prefers v2 world poses over a leftover v1 document', () => {
    const storage = memoryStorage();
    storage.setItem(
      'mux-xr:ui-poses:v1',
      JSON.stringify({ version: 1, poses: { keyboard: validPose } }),
    );
    storage.setItem(
      'mux-xr:ui-poses:v2',
      JSON.stringify({ version: 2, poses: { hud: validPose } }),
    );
    const store = createUIPoseStore(storage);
    expect(store.read('hud')).toEqual(validPose);
    expect(store.read('keyboard')).toBeNull();
  });

  it('captures and applies a world pose through a transformed parent', () => {
    const parent = new THREE.Object3D();
    parent.position.set(3, 0, -2);
    parent.rotation.y = 0.3;
    const root = new THREE.Object3D();
    parent.add(root);
    root.position.set(1, 0.5, -2);
    root.rotation.y = 0.7;
    root.scale.setScalar(1.2);
    parent.updateMatrixWorld(true);
    const pose = captureUIPose(root);
    const before = root.getWorldPosition(new THREE.Vector3());
    expect(pose.position[1]).toBeCloseTo(0.5, 6);
    root.position.set(0, 0, 0);
    applyUIPose(root, pose, [0.2, 3]);
    parent.updateMatrixWorld(true);
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6);
    expect(
      root
        .getWorldQuaternion(new THREE.Quaternion())
        .angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.0, 0))),
    ).toBeLessThan(1e-6);
  });
});
