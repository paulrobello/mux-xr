import { describe, expect, it } from 'vitest';
import { rebaseHandReel, reelOffset, startHandReel } from '../src/xr/hand-reel';

describe('hand reel', () => {
  it('scales the grab offset with the hand reach and clamps it', () => {
    const reel = startHandReel(0.5, 4);
    if (!reel) throw new Error('far grab should reel');
    expect(reelOffset(reel, 0.5)).toBeCloseTo(4, 9);
    expect(reelOffset(reel, 0.52)).toBeCloseTo(4, 9);
    expect(reelOffset(reel, 0.47)).toBeCloseTo(4, 9);
    expect(reelOffset(reel, 0.25)).toBeCloseTo((4 * 0.3) / 0.5, 9);
    expect(reelOffset(reel, 0)).toBeCloseTo((4 * 0.05) / 0.5, 9);
    expect(reelOffset(reel, -0.2)).toBe(0.3);
    expect(reelOffset(reel, 2)).toBe(6);
  });

  it('never pulls a window already beyond the far limit in on its own', () => {
    const reel = startHandReel(0.5, 8);
    if (!reel) throw new Error('far grab should reel');
    expect(reelOffset(reel, 0.5)).toBeCloseTo(8, 9);
    expect(reelOffset(reel, 0.6)).toBe(8);
  });

  it('rebases a reel that already brought the object within the far-grab threshold', () => {
    const reel = rebaseHandReel(0.4, 0.35);
    if (!reel) throw new Error('rebase should keep reeling');
    expect(reelOffset(reel, 0.4)).toBeCloseTo(0.35, 9);
    expect(reelOffset(reel, 0.8)).toBeCloseTo((0.35 * 0.75) / 0.4, 9);
    expect(reelOffset(reel, 0.2)).toBe(0.3);
    expect(rebaseHandReel(0.1, 0.35)).toBeUndefined();
  });

  it('leaves near grabs and degenerate reaches alone', () => {
    expect(startHandReel(0.5, 0.4)).toBeUndefined();
    expect(startHandReel(0.15, 3)).toBeUndefined();
    expect(startHandReel(0, 3)).toBeUndefined();
    expect(startHandReel(Number.NaN, 3)).toBeUndefined();
  });
});
