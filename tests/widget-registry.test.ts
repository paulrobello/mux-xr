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
  getWidgetEntry,
  isWidgetKind,
  WIDGET_REGISTRY,
  widgetKinds,
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
    ]);
    expect(widgetKinds()).toEqual(['digital-clock', 'analog-clock']);
  });

  it('looks entries up by kind and rejects unknown kinds', () => {
    expect(getWidgetEntry('analog-clock')?.displayName).toBe('Analog clock');
    expect(getWidgetEntry('nope')).toBeUndefined();
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
        poses: { 'digital-clock': pose, 'agent-board': pose },
      }),
    });
    const store = createWidgetPoseStore(storage);
    expect(Object.keys(store.read())).toEqual(['digital-clock']);
    expect(store.save('agent-board' as never, pose)).toBe(false);
    expect(store.remove('agent-board' as never)).toBe(false);
  });
});
