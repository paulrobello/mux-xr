import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
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

import { createPictureFrameWidget } from '../src/xr/picture-frame';
import {
  PICTURE_PLACEHOLDER_OFFSET,
  PICTURE_PLACEHOLDER_SCALE,
  PICTURE_SLOTS,
  pictureSpawnOffset,
} from '../src/xr/picture-sizing';
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
      ['host-load', 'Host load', [-1.15, 0.53, -1.3]],
      ['stream-health', 'Stream health', [-1.6, 0.6, -1.1]],
      ['repo-status', 'Git & CI', [0.6, -0.1, -1.4]],
      ['weather', 'Weather', [-0.6, 0.574, -1.32]],
      ['picture', 'Picture', [-0.95, -0.55, -1.15]],
      ['kanban-strip', 'Kanban strip', [0, -0.9, -1.2]],
      ['booking-timeline', 'Host bookings', [-2.5, 0.05, -1.6]],
      ['service-health', 'Service health', [2.65, -0.45, -1.6]],
      ['mesh-inbox', 'Mesh inbox', [0, 1.55, -1.2]],
      ['sticky-note', 'Sticky note', [1.45, 0.7, -1.1]],
    ]);
    expect(widgetKinds()).toEqual([
      'digital-clock',
      'analog-clock',
      'agent-board',
      'timer',
      'bell-feed',
      'perf-gauge',
      'host-load',
      'stream-health',
      'repo-status',
      'weather',
      'picture',
      'kanban-strip',
      'booking-timeline',
      'service-health',
      'mesh-inbox',
      'sticky-note',
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
      if (!('faceViewer' in entry && entry.faceViewer)) {
        expect(yaw, entry.kind).toBe(0);
        continue;
      }
      const [x, , z] = entry.spawnOffset;
      const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const toEye = new THREE.Vector3(-x, 0, -z).normalize();
      expect(normal.dot(toEye)).toBeCloseTo(1, 6);
    }
  });

  // Picture frames take the image aspect, face the viewer from their own slot, and cascade nearer
  // past the first layer. Check wide, tall and square frames in every slot of two layers against
  // the other widgets and both HUD poses, against each other, and the menu placeholder's view.
  describe('picture placement', () => {
    const others = (): Array<{ kind: string; box: THREE.Box3 }> => {
      const boxes: Array<{ kind: string; box: THREE.Box3 }> = spawnBoxes().filter(
        ({ kind }) => kind !== 'picture',
      );
      // The HUD at scale 0.62: bar plus the notice, Reload and toast lines above it.
      const hud = (y: number, z: number) =>
        new THREE.Box3(
          new THREE.Vector3(-0.53, y - 0.05, z - 0.01),
          new THREE.Vector3(0.53, y + 0.31, z),
        );
      // Recentered (0.65 m below, 1.35 m ahead) and default (y 0.78 seen from a 1.52 m eye).
      boxes.push({ kind: 'hud-recentered', box: hud(-0.65, -1.35) });
      boxes.push({ kind: 'hud-default', box: hud(0.78 - 1.52, -1.35) });
      return boxes;
    };
    const shapes = [
      [1600, 900],
      [900, 1600],
      [1, 1],
    ] as const;
    const frameAt = (
      offset: readonly [number, number, number],
      scale: number,
      width: number,
      height: number,
    ): THREE.Box3 => {
      const widget = createPictureFrameWidget(null, {
        id: 'shape',
        image: { source: { width, height } as HTMLCanvasElement, width, height },
      });
      const entry = getWidgetEntry('picture');
      widget.root.position.set(...offset);
      widget.root.rotation.y = widgetSpawnYaw({ ...entry, spawnOffset: offset });
      widget.root.scale.setScalar(scale);
      widget.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(widget.root);
      widget.dispose();
      return box;
    };
    const entry = getWidgetEntry('picture');
    const slots = Array.from({ length: PICTURE_SLOTS * 2 }, (_, slot) => slot);

    it('spawns every slot clear of the other widgets and both HUD poses', () => {
      const fixed = others();
      for (const [width, height] of shapes)
        for (const slot of slots) {
          const box = frameAt(pictureSpawnOffset(entry.spawnOffset, slot), 1, width, height);
          for (const other of fixed) {
            const label = `${width}x${height} slot ${slot} and ${other.kind}`;
            expect(box.intersectsBox(other.box), label).toBe(false);
            expect(overlaps(box, other.box), label).toBe(false);
          }
        }
    });

    it('never stacks two pictures: one layer side by side, later layers nearer', () => {
      const layer = (slot: number) => Math.floor(slot / PICTURE_SLOTS);
      for (const [width, height] of shapes)
        for (const a of slots)
          for (const b of slots.filter((slot) => slot > a)) {
            const left = frameAt(pictureSpawnOffset(entry.spawnOffset, a), 1, width, height);
            const right = frameAt(pictureSpawnOffset(entry.spawnOffset, b), 1, width, height);
            const label = `${width}x${height} slots ${a} and ${b}`;
            const pa = new THREE.Vector3(...pictureSpawnOffset(entry.spawnOffset, a));
            const pb = new THREE.Vector3(...pictureSpawnOffset(entry.spawnOffset, b));
            expect(pa.distanceTo(pb), label).toBeGreaterThan(0.05);
            if (layer(a) === layer(b)) {
              expect(left.intersectsBox(right), label).toBe(false);
              expect(overlaps(left, right), label).toBe(false);
            }
            // A cascaded frame that overlaps on screen sits clearly nearer, never coplanar.
            else if (overlaps(left, right))
              expect(pa.length() - pb.length(), label).toBeGreaterThan(0.04);
          }
    });

    it('spawns the Add Picture placeholder fully in view and clear of the fixed widgets', () => {
      const box = frameAt(PICTURE_PLACEHOLDER_OFFSET, PICTURE_PLACEHOLDER_SCALE, 4, 3);
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            // Inside 45 degrees left/right and 30 degrees up/down of straight ahead (a Quest 3
            // eye sees about 50 degrees to each side).
            expect(Math.abs(x / -z)).toBeLessThan(Math.tan((45 * Math.PI) / 180));
            expect(Math.abs(y / -z)).toBeLessThan(Math.tan((30 * Math.PI) / 180));
          }
      for (const other of others()) {
        expect(box.intersectsBox(other.box), other.kind).toBe(false);
        expect(overlaps(box, other.box), other.kind).toBe(false);
      }
      // A filled placeholder keeps its pose. Its oriented box never meets a slot frame's (the yawed
      // axis-aligned boxes are too coarse here), and where the two overlap on screen it sits
      // clearly nearer, like a cascaded layer, never coplanar.
      const orientedFrame = (
        offset: readonly [number, number, number],
        scale: number,
        width: number,
        height: number,
      ): OBB => {
        const widget = createPictureFrameWidget(null, {
          id: 'shape',
          image: { source: { width, height } as HTMLCanvasElement, width, height },
        });
        const local = new THREE.Box3().setFromObject(widget.root);
        widget.root.position.set(...offset);
        widget.root.rotation.y = widgetSpawnYaw({ ...entry, spawnOffset: offset });
        widget.root.scale.setScalar(scale);
        widget.root.updateMatrixWorld(true);
        const box = new OBB().fromBox3(local).applyMatrix4(widget.root.matrixWorld);
        widget.dispose();
        return box;
      };
      const near = Math.hypot(PICTURE_PLACEHOLDER_OFFSET[0], PICTURE_PLACEHOLDER_OFFSET[2]);
      for (const [width, height] of shapes)
        for (const slot of slots) {
          const offset = pictureSpawnOffset(entry.spawnOffset, slot);
          const label = `${width}x${height} slot ${slot}`;
          const filled = orientedFrame(
            PICTURE_PLACEHOLDER_OFFSET,
            PICTURE_PLACEHOLDER_SCALE,
            width,
            height,
          );
          expect(filled.intersectsOBB(orientedFrame(offset, 1, width, height)), label).toBe(false);
          const onScreen = overlaps(
            frameAt(PICTURE_PLACEHOLDER_OFFSET, PICTURE_PLACEHOLDER_SCALE, width, height),
            frameAt(offset, 1, width, height),
          );
          if (onScreen)
            expect(Math.hypot(offset[0], offset[2]) - near, label).toBeGreaterThan(0.04);
        }
    });
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
