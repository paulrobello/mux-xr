import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import { createWidgetPoseStore } from '../src/xr/widget-poses';
import {
  findWidgetEntry,
  getWidgetEntry,
  isWidgetKind,
  WIDGET_REGISTRY,
  type WidgetKind,
  widgetKinds,
  widgetSpawnYaw,
} from '../src/xr/widget-registry';

const pose = {
  position: [1, 2, -3] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1,
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
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

describe('widget registry', () => {
  it('lists the clocks first, in panel order, with their labels and offsets', () => {
    expect(
      WIDGET_REGISTRY.map(({ kind, displayName, spawnOffset }) => [kind, displayName, spawnOffset]),
    ).toEqual([
      ['digital-clock', 'Digital clock', [-0.45, 0.3, -1.25]],
      ['analog-clock', 'Analog clock', [0.45, 0.3, -1.25]],
      ['agent-board', 'Agent board', [0, -0.27, -1.25]],
      ['timer', 'Timer', [0.01, 0.3, -1.25]],
      ['bell-feed', 'Bell feed', [1.05, 0.15, -1.1]],
      ['perf-gauge', 'Performance', [-1, 0.15, -1.1]],
    ]);
    expect(widgetKinds()).toEqual([
      'digital-clock',
      'analog-clock',
      'agent-board',
      'timer',
      'bell-feed',
      'perf-gauge',
    ]);
  });

  // Eye at the origin, as placeWidget measures offsets. Each box projects onto the z = -1 image
  // plane, so a nearer surface hiding a farther one counts even when the boxes do not intersect.
  const projected = (box: THREE.Box3): { x: [number, number]; y: [number, number] } => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          xs.push(x / -z);
          ys.push(y / -z);
        }
    return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
  };
  const overlaps = (left: THREE.Box3, right: THREE.Box3): boolean => {
    const a = projected(left);
    const b = projected(right);
    return a.x[0] < b.x[1] && b.x[0] < a.x[1] && a.y[0] < b.y[1] && b.y[0] < a.y[1];
  };
  const spawnBoxes = () =>
    WIDGET_REGISTRY.map((entry) => {
      const widget = entry.create(null);
      const [x, y, z] = entry.spawnOffset;
      widget.root.position.set(x, y, z);
      widget.root.scale.setScalar('spawnScale' in entry ? entry.spawnScale : 1);
      widget.root.rotation.y = widgetSpawnYaw(entry);
      widget.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(widget.root);
      widget.dispose();
      return { kind: entry.kind, box };
    });

  it('spawns every widget without covering another', () => {
    const boxes = spawnBoxes();
    for (const [index, left] of boxes.entries())
      for (const right of boxes.slice(index + 1)) {
        expect(left.box.intersectsBox(right.box), `${left.kind} and ${right.kind}`).toBe(false);
        expect(overlaps(left.box, right.box), `${left.kind} and ${right.kind}`).toBe(false);
      }
  });

  it('fits the timer in the gap between the clocks, clear of the board and with margin', () => {
    const boxes = new Map(spawnBoxes().map(({ kind, box }) => [kind, box]));
    const timer = boxes.get('timer');
    const digital = boxes.get('digital-clock');
    const analog = boxes.get('analog-clock');
    const board = boxes.get('agent-board');
    if (!timer || !digital || !analog || !board) throw new Error('missing spawn box');
    expect(timer.min.x).toBeGreaterThan(digital.max.x + 0.01);
    expect(timer.max.x).toBeLessThan(analog.min.x - 0.01);
    expect(timer.min.y).toBeGreaterThan(board.max.y);
    const gapCentre = (digital.max.x + analog.min.x) / 2;
    expect(timer.getCenter(new THREE.Vector3()).x).toBeCloseTo(gapCentre, 6);
    expect(timer.min.x - digital.max.x).toBeCloseTo(analog.min.x - timer.max.x, 6);
  });

  it('turns only faceViewer entries toward the eye', () => {
    for (const entry of WIDGET_REGISTRY) {
      const yaw = widgetSpawnYaw(entry);
      if (entry.kind !== 'bell-feed' && entry.kind !== 'perf-gauge') {
        expect(yaw, entry.kind).toBe(0);
        continue;
      }
      const [x, , z] = entry.spawnOffset;
      const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const toEye = new THREE.Vector3(-x, 0, -z).normalize();
      expect(normal.dot(toEye)).toBeCloseTo(1, 6);
    }
  });

  it('looks entries up by kind and rejects unknown kinds', () => {
    expect(getWidgetEntry('analog-clock').displayName).toBe('Analog clock');
    expect(findWidgetEntry('nope')).toBeUndefined();
    expect(() => getWidgetEntry('nope' as unknown as WidgetKind)).toThrow(/Unknown widget kind/);
    expect(isWidgetKind('digital-clock')).toBe(true);
    expect(isWidgetKind('nope')).toBe(false);
    expect(isWidgetKind(undefined)).toBe(false);
  });

  it('creates widgets with a matching widgetKind and a non-empty widgetId', () => {
    for (const entry of WIDGET_REGISTRY) {
      const widget = entry.create(null);
      expect(widget.root.userData.widgetKind).toBe(entry.kind);
      expect(String(widget.root.userData.widgetId)).not.toBe('');
      expect(widget.root.userData.widgetId).toBeTruthy();
      widget.update(Date.now());
      widget.dispose();
    }
  });

  it('drops unknown kinds on pose restore and refuses to save them', () => {
    const storage = memoryStorage({
      'mux-xr:widget-poses:v2': JSON.stringify({
        version: 2,
        poses: { 'digital-clock': pose, 'retired-widget': pose },
      }),
    });
    const store = createWidgetPoseStore(storage);
    expect(Object.keys(store.read())).toEqual(['digital-clock']);
    expect(store.save('retired-widget' as unknown as WidgetKind, pose)).toBe(false);
    expect(store.remove('retired-widget' as unknown as WidgetKind)).toBe(false);
  });
});
