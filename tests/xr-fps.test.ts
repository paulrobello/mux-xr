import { describe, expect, it } from 'vitest';
import { createFrameCounter } from '../src/xr/fps';

describe('XR frame counter', () => {
  it('counts actual frames over elapsed time and includes missed frames', () => {
    const counter = createFrameCounter();
    counter.sample(0);
    let fps: number | null = null;
    for (let frame = 1; frame <= 45; frame += 1) fps = counter.sample((frame * 1000) / 90) ?? fps;
    expect(fps).toBe(90);
    for (let frame = 1; frame <= 20; frame += 1) fps = counter.sample(500 + frame * 25) ?? fps;
    expect(fps).toBe(40);
    counter.reset();
    expect(counter.sample(1000)).toBeNull();
  });
});
