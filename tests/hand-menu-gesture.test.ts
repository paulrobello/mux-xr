import { createHandMenuGesture } from '@par/xr-workspace';
import { describe, expect, it } from 'vitest';

type Point = { x: number; y: number; z: number };

function fixture() {
  const points: Record<string, Point> = {
    'thumb-tip': { x: 0, y: 0, z: 0 },
    'ring-finger-tip': { x: 0.08, y: 0, z: 0 },
    'index-finger-tip': { x: 0.08, y: 0.02, z: 0 },
    'middle-finger-tip': { x: 0.08, y: -0.02, z: 0 },
  };
  const spaces = new Map(Object.keys(points).map((name) => [name, { name }]));
  const source = { hand: spaces } as unknown as XRInputSource;
  const frame = {
    session: { inputSources: [source] },
    getJointPose: (space: { name: string }) => ({
      transform: { position: points[space.name] },
    }),
  } as unknown as XRFrame;
  return { frame, points, source, referenceSpace: {} as XRReferenceSpace };
}

function contact(points: Record<string, Point>): void {
  points['ring-finger-tip'].x = 0.01;
}

describe('hand menu gesture', () => {
  it('fires once after a sustained thumb-ring contact and rearms after neutral release', () => {
    const { frame, points, source, referenceSpace } = fixture();
    const gesture = createHandMenuGesture();
    gesture.update(frame, referenceSpace, 0);
    contact(points);
    expect(gesture.update(frame, referenceSpace, 0.05)).toBeUndefined();
    expect(gesture.update(frame, referenceSpace, 0.3)).toBeUndefined();
    expect(gesture.update(frame, referenceSpace, 0.5)).toBeUndefined();
    expect(gesture.update(frame, referenceSpace, 0.75)).toBe(source);
    expect(gesture.update(frame, referenceSpace, 0.8)).toBeUndefined();
    expect(gesture.update(frame, referenceSpace, 4)).toBeUndefined();
    points['ring-finger-tip'].x = 0.08;
    gesture.update(frame, referenceSpace, 0.9);
    contact(points);
    gesture.update(frame, referenceSpace, 1.1);
    gesture.update(frame, referenceSpace, 1.3);
    gesture.update(frame, referenceSpace, 1.5);
    expect(gesture.update(frame, referenceSpace, 1.7)).toBe(source);
  });

  it.each(['index-finger-tip', 'middle-finger-tip'])(
    'requires a neutral hand after a conflicting %s pinch',
    (joint) => {
      const { frame, points, source, referenceSpace } = fixture();
      const gesture = createHandMenuGesture();
      const step = (time: number) => gesture.update(frame, referenceSpace, time);
      step(0);
      contact(points);
      points[joint].x = 0.01;
      for (let i = 1; i <= 10; i++) expect(step(i / 10)).toBeUndefined();
      points[joint].x = 0.08;
      for (let i = 11; i <= 20; i++) expect(step(i / 10)).toBeUndefined();
      points['ring-finger-tip'].x = 0.08;
      step(2.1);
      contact(points);
      for (let i = 22; i <= 27; i++) expect(step(i / 10)).toBeUndefined();
      expect(step(2.8)).toBe(source);
    },
  );

  it.each(['disabled', 'lost joint', 'disconnect', 'clock gap', 'clock rewind', 'reset'])(
    'requires release after %s interrupts contact',
    (interruption) => {
      const { frame, points, referenceSpace } = fixture();
      const gesture = createHandMenuGesture();
      const step = (time: number) => gesture.update(frame, referenceSpace, time);
      step(0);
      contact(points);
      step(0.1);
      step(0.3);
      if (interruption === 'disabled') gesture.update(frame, referenceSpace, 0.4, false);
      if (interruption === 'lost joint')
        gesture.update({ ...frame, getJointPose: () => undefined } as XRFrame, referenceSpace, 0.4);
      if (interruption === 'disconnect')
        gesture.update(
          { session: { inputSources: [] } } as unknown as XRFrame,
          referenceSpace,
          0.4,
        );
      if (interruption === 'clock rewind') step(0.02);
      if (interruption === 'reset') gesture.reset();
      const start = interruption === 'clock gap' ? 2 : 0.5;
      for (let i = 0; i < 12; i++) expect(step(start + i / 10)).toBeUndefined();
    },
  );
});
