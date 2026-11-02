import { describe, expect, it } from 'vitest';
import { createWidgetPoseStore } from '../src/xr/widget-poses';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const digitalPose = {
  position: [1, 2, -3] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1.5,
};

const analogPose = {
  position: [-1, 0.5, 2] as [number, number, number],
  quaternion: [0, 0.70710678, 0, 0.70710678] as [number, number, number, number],
  scale: 0.75,
};

describe('widget poses', () => {
  it('round-trips both widget kinds and clones returned data', () => {
    const store = createWidgetPoseStore(memoryStorage());
    expect(store.save('digital-clock', digitalPose)).toBe(true);
    expect(store.save('analog-clock', analogPose)).toBe(true);
    const poses = store.read();
    expect(poses).toEqual({ 'digital-clock': digitalPose, 'analog-clock': analogPose });
    const digital = poses['digital-clock'];
    if (!digital) throw new Error('missing digital pose');
    digital.position[0] = 99;
    expect(store.read()['digital-clock']?.position[0]).toBe(1);
  });

  it('ignores malformed persisted entries and preserves valid entries', () => {
    const storage = memoryStorage();
    storage.setItem(
      'mux-xr:widget-poses:v1',
      JSON.stringify({
        version: 1,
        poses: {
          'digital-clock': digitalPose,
          'analog-clock': { position: [0, 0, 0], quaternion: [0, 0, 0, 0], scale: 1 },
          unknown: digitalPose,
        },
      }),
    );
    expect(createWidgetPoseStore(storage).read()).toEqual({ 'digital-clock': digitalPose });
  });

  it('removes one kind, clears its key only, and handles storage failures', () => {
    const storage = memoryStorage();
    storage.setItem('unrelated', 'keep');
    const store = createWidgetPoseStore(storage);
    store.save('digital-clock', digitalPose);
    store.save('analog-clock', analogPose);
    expect(store.remove('digital-clock')).toBe(true);
    expect(store.read()).toEqual({ 'analog-clock': analogPose });
    expect(store.clear()).toBe(true);
    expect(storage.getItem('unrelated')).toBe('keep');

    const failing = memoryStorage();
    failing.setItem = () => {
      throw new Error('quota');
    };
    const failingStore = createWidgetPoseStore(failing);
    expect(failingStore.save('digital-clock', digitalPose)).toBe(false);
    expect(failingStore.remove('digital-clock')).toBe(false);
    expect(failingStore.clear()).toBe(true);
  });
});
