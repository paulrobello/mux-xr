import { describe, expect, it } from 'vitest';
import { createStarSpriteTexture } from '../packages/xr-workspace/src/environments/star-sprite';
import { validPose } from '../src/pose-validation';
import { createOpenViewsStore } from '../src/workspace/open-views';

const pose = (position: [number, number, number]) => ({
  position,
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1,
});

describe('validPose', () => {
  it('accepts a unit-quaternion pose in range', () => {
    expect(validPose(pose([1, 2, 3]))).toBe(true);
  });

  it('rejects a pose beyond 20 m by default and honours a wider limit', () => {
    expect(validPose(pose([25, 0, 0]))).toBe(false);
    expect(validPose(pose([25, 0, 0]), 100)).toBe(true);
    expect(validPose(pose([101, 0, 0]), 100)).toBe(false);
  });

  it('rejects non-objects, bad shapes and non-finite values', () => {
    expect(validPose(null)).toBe(false);
    expect(validPose('pose')).toBe(false);
    expect(validPose({ ...pose([0, 0, 0]), position: [0, 0] })).toBe(false);
    expect(validPose(pose([Number.NaN, 0, 0]))).toBe(false);
    expect(validPose({ ...pose([0, 0, 0]), quaternion: [0, 0, 0, 2] })).toBe(false);
    expect(validPose({ ...pose([0, 0, 0]), scale: 0.1 })).toBe(false);
    expect(validPose({ ...pose([0, 0, 0]), scale: 3.5 })).toBe(false);
  });

  it('keeps open views validating at the 100 m limit they always used', () => {
    const storage = (() => {
      const values = new Map<string, string>();
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size;
        },
      } as Storage;
    })();
    const store = createOpenViewsStore(storage);
    const view = (position: [number, number, number]) => ({
      views: [
        {
          paneId: '%1',
          workspaceId: 'w',
          sessionId: 's',
          windowId: 'win',
          pose: pose(position),
        },
      ],
      selectedId: null,
    });
    expect(store.save('server', view([60, 0, 0]))).toBe(true);
    expect(store.read('server')?.views[0].pose?.position).toEqual([60, 0, 0]);
    expect(store.save('server', view([150, 0, 0]))).toBe(false);
  });
});

describe('createStarSpriteTexture', () => {
  it('draws a 32 px soft disc: opaque near the middle, clear at the rim', () => {
    const texture = createStarSpriteTexture();
    const data = texture.image.data as Uint8Array;
    const size = texture.image.width;
    expect(size).toBe(32);
    const alphaAt = (x: number, y: number): number => data[(y * size + x) * 4 + 3];
    expect(alphaAt(15, 15)).toBeGreaterThan(240);
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(31, 16)).toBe(0);
    expect(texture.generateMipmaps).toBe(true);
    texture.dispose();
  });
});
