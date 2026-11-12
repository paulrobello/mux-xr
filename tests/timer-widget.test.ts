import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    text = '';
    anchorX: number | string = 0;
    textAlign = '';
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

vi.mock('../src/xr/timer-state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/xr/timer-state')>();
  return { ...original, readout: vi.fn(original.readout) };
});

import { readout } from '../src/xr/timer-state';
import { createTimerWidget, TIMER_HEIGHT } from '../src/xr/timer-widget';

const NOW = 1_800_000_000_000;
const DEFAULT_MS = 5 * 60_000;

function named(root: THREE.Object3D, name: string): THREE.Mesh {
  const found = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

const text = (root: THREE.Object3D, name: string): string =>
  String(named(root, name).userData.labelText);

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const widget = createTimerWidget(null);
  const press = (name: string): void => {
    const button = named(widget.root, name);
    expect(button.userData.inputAction).toBe('widgetControl');
    widget.activate?.(button);
  };
  const advance = (ms: number): void => {
    vi.setSystemTime(Date.now() + ms);
    widget.update(Date.now());
  };
  return { widget, press, advance };
}

afterEach(() => vi.useRealTimers());

describe('timer widget', () => {
  it('exposes grab, close and control metadata', () => {
    const { widget } = setup();
    expect(widget.root.userData.widgetKind).toBe('timer');
    expect(widget.root.userData.inputAction).toBe('grabWidget');
    expect(named(widget.root, 'timer-close').userData.inputAction).toBe('closeWidget');
    expect(named(widget.root, 'timer-body').userData.inputAction).toBe('grabWidget');
    expect(text(widget.root, 'timer-display')).toBe('5:00');
    widget.dispose();
  });

  it('starts, pauses, resumes and resets with button presses', () => {
    const { widget, press, advance } = setup();
    expect(text(widget.root, 'timer-run')).toBe('Start');
    press('timer-run');
    expect(text(widget.root, 'timer-run')).toBe('Pause');
    advance(10_000);
    expect(text(widget.root, 'timer-display')).toBe('4:50');
    press('timer-run');
    expect(text(widget.root, 'timer-run')).toBe('Resume');
    advance(60_000);
    expect(text(widget.root, 'timer-display')).toBe('4:50');
    press('timer-reset');
    expect(text(widget.root, 'timer-display')).toBe('5:00');
    expect(text(widget.root, 'timer-run')).toBe('Start');
    widget.dispose();
  });

  it('presets set the countdown length', () => {
    const { widget, press } = setup();
    for (const minutes of [1, 5, 15, 25]) {
      press(`timer-preset-${minutes}`);
      expect(text(widget.root, 'timer-display')).toBe(`${minutes}:00`);
    }
    widget.dispose();
  });

  it('signals completion with a pulsing amber flash and a Done face, then settles to a steady tint', () => {
    const { widget, press, advance } = setup();
    press('timer-preset-1');
    press('timer-run');
    const flash = named(widget.root, 'timer-flash') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshBasicMaterial
    >;
    advance(59_000);
    expect(flash.visible).toBe(false);
    advance(1000);
    expect(text(widget.root, 'timer-display')).toBe('Done');
    expect(text(widget.root, 'timer-run')).toBe('Restart');
    expect(flash.visible).toBe(true);
    const opacities = new Set<number>();
    for (let step = 0; step < 6; step += 1) {
      advance(60);
      opacities.add(Number(flash.material.opacity.toFixed(3)));
      expect(flash.material.opacity).toBeGreaterThan(0.44);
    }
    expect(opacities.size).toBeGreaterThan(2);
    advance(5000);
    expect(flash.visible).toBe(true);
    expect(flash.material.opacity).toBeCloseTo(0.25);
    expect(text(widget.root, 'timer-display')).toBe('Done');
    press('timer-reset');
    expect(flash.visible).toBe(false);
    widget.dispose();
  });

  it('keeps countdown and stopwatch separate across mode switches', () => {
    const { widget, press, advance } = setup();
    press('timer-preset-15');
    press('timer-run');
    advance(30_000);
    press('timer-mode');
    expect(text(widget.root, 'timer-mode')).toBe('Stopwatch');
    expect(text(widget.root, 'timer-display')).toBe('0:00');
    expect(text(widget.root, 'timer-run')).toBe('Start');
    press('timer-run');
    advance(5000);
    expect(text(widget.root, 'timer-display')).toBe('0:05');
    press('timer-mode');
    expect(text(widget.root, 'timer-mode')).toBe('Countdown');
    expect(text(widget.root, 'timer-display')).toBe('14:25');
    expect(text(widget.root, 'timer-run')).toBe('Pause');
    widget.dispose();
  });

  it('hides the presets in stopwatch mode and hands them back to grab', () => {
    const { widget, press } = setup();
    const preset = named(widget.root, 'timer-preset-5');
    expect(preset.visible).toBe(true);
    press('timer-mode');
    expect(preset.visible).toBe(false);
    expect(preset.userData.inputAction).toBe('grabWidget');
    press('timer-mode');
    expect(preset.visible).toBe(true);
    expect(preset.userData.inputAction).toBe('widgetControl');
    widget.dispose();
  });

  it('re-renders the display text at most once per displayed second', () => {
    const { widget, press, advance } = setup();
    press('timer-run');
    const display = named(widget.root, 'timer-display');
    let writes = 0;
    let seen = String(display.userData.labelText);
    for (let frame = 0; frame < 300; frame += 1) {
      advance(16);
      const now = String(display.userData.labelText);
      if (now !== seen) {
        writes += 1;
        seen = now;
      }
    }
    // 300 frames of 16 ms is 4.8 s, so 4 or 5 second boundaries and never one write per frame.
    expect(writes).toBeGreaterThanOrEqual(4);
    expect(writes).toBeLessThanOrEqual(5);
    widget.dispose();
  });

  it('survives dropped frames: one late update lands on the right time', () => {
    const { widget, press, advance } = setup();
    press('timer-run');
    advance(125_000);
    expect(text(widget.root, 'timer-display')).toBe('2:55');
    widget.dispose();
  });

  it('ignores presses after dispose', () => {
    const { widget, press } = setup();
    widget.dispose();
    expect(() => widget.activate?.(new THREE.Object3D())).not.toThrow();
    expect(() => press('timer-run')).toThrow();
  });

  it('does no per-frame readout work while idle, and one per displayed second while running', () => {
    const { widget, press, advance } = setup();
    vi.mocked(readout).mockClear();
    for (let frame = 0; frame < 300; frame += 1) advance(16);
    expect(readout).not.toHaveBeenCalled();
    press('timer-run');
    vi.mocked(readout).mockClear();
    for (let frame = 0; frame < 300; frame += 1) advance(16);
    expect(vi.mocked(readout).mock.calls.length).toBeLessThanOrEqual(5);
    widget.dispose();
  });

  it('stops per-frame work once the flash window ends', () => {
    const { widget, press, advance } = setup();
    press('timer-preset-1');
    press('timer-run');
    advance(60_000);
    advance(6000);
    vi.mocked(readout).mockClear();
    for (let frame = 0; frame < 100; frame += 1) advance(16);
    expect(readout).not.toHaveBeenCalled();
    widget.dispose();
  });

  const bounds = (widget: ReturnType<typeof createTimerWidget>, name: string) => {
    widget.root.updateMatrixWorld(true);
    const mesh = named(widget.root, name);
    const geometry = mesh.geometry as THREE.PlaneGeometry;
    const { width, height } = geometry.parameters;
    const y = mesh.position.y;
    return {
      top: y + (height * mesh.scale.y) / 2,
      bottom: y - (height * mesh.scale.y) / 2,
      x: mesh.position.x,
      width,
    };
  };

  it('keeps every control but close 0.02 m inside the face top and bottom in both modes', () => {
    const { widget, press } = setup();
    const faceTop = (TIMER_HEIGHT - 0.02) / 2;
    const names = ['timer-mode', 'timer-display-plate', 'timer-run', 'timer-reset'];
    for (const mode of ['countdown', 'stopwatch']) {
      const all = mode === 'countdown' ? [...names, 'timer-preset-1', 'timer-preset-25'] : names;
      for (const name of all) {
        const box = bounds(widget, name);
        expect(box.top, `${mode} ${name}`).toBeLessThanOrEqual(faceTop - 0.02 + 1e-9);
        expect(box.bottom, `${mode} ${name}`).toBeGreaterThanOrEqual(-faceTop + 0.02 - 1e-9);
      }
      press('timer-mode');
    }
    widget.dispose();
  });

  it('sizes presets 0.048 m with 12.7 mm gaps and the close button 0.05 m', () => {
    const { widget } = setup();
    const ids = [1, 5, 15, 25].map((minutes) => bounds(widget, `timer-preset-${minutes}`));
    for (const preset of ids) expect(preset.width).toBeCloseTo(0.048, 6);
    for (const [index, preset] of ids.slice(1).entries())
      expect(preset.x - (ids[index]?.x ?? 0) - 0.048).toBeCloseTo(0.0127, 3);
    expect(bounds(widget, 'timer-close').width).toBeCloseTo(0.05, 6);
    const [minimum] = widget.root.userData.scaleLimits as [number, number];
    expect(0.048 * minimum).toBeGreaterThanOrEqual(0.03);
    widget.dispose();
  });

  it('uses one font size per row', () => {
    const { widget, press, advance } = setup();
    const size = (name: string): number =>
      (named(widget.root, name).userData.labelTextObject as unknown as { fontSize: number })
        .fontSize;
    expect(new Set([1, 5, 15, 25].map((m) => size(`timer-preset-${m}`))).size).toBe(1);
    const reset = size('timer-reset');
    const seen: string[] = [];
    seen.push(text(widget.root, 'timer-run'));
    press('timer-run');
    seen.push(text(widget.root, 'timer-run'));
    press('timer-run');
    seen.push(text(widget.root, 'timer-run'));
    press('timer-run');
    advance(DEFAULT_MS);
    seen.push(text(widget.root, 'timer-run'));
    expect(seen).toEqual(['Start', 'Pause', 'Resume', 'Restart']);
    expect(size('timer-run')).toBe(reset);
    const countdownMode = size('timer-mode');
    press('timer-mode');
    expect(text(widget.root, 'timer-mode')).toBe('Stopwatch');
    expect(size('timer-mode')).toBe(countdownMode);
    widget.dispose();
  });

  it('re-centres the stopwatch face and run row into the freed preset band', () => {
    const { widget, press } = setup();
    const before = {
      plate: bounds(widget, 'timer-display-plate'),
      run: bounds(widget, 'timer-run'),
    };
    press('timer-mode');
    const after = {
      plate: bounds(widget, 'timer-display-plate'),
      run: bounds(widget, 'timer-run'),
    };
    const faceBottom = -(TIMER_HEIGHT - 0.02) / 2 + 0.02;
    expect(after.run.bottom).toBeCloseTo(faceBottom, 6);
    expect(after.plate.top).toBeCloseTo(before.plate.top, 6);
    expect(after.plate.bottom - after.run.top).toBeCloseTo(0.01, 6);
    expect(before.run.bottom).toBeGreaterThan(faceBottom + 0.04);
    widget.dispose();
  });

  it('badges a countdown that ends under the stopwatch, then flashes when shown again', () => {
    const { widget, press, advance } = setup();
    const badge = named(widget.root, 'timer-done-badge');
    const flash = named(widget.root, 'timer-flash');
    press('timer-preset-1');
    press('timer-run');
    press('timer-mode');
    expect(badge.visible).toBe(false);
    advance(60_000);
    expect(badge.visible).toBe(true);
    expect(flash.visible).toBe(false);
    expect(text(widget.root, 'timer-display')).toBe('0:00');
    const digits = bounds(widget, 'timer-display-plate');
    const badgeBox = bounds(widget, 'timer-done-badge');
    expect(badgeBox.bottom).toBeGreaterThan(digits.top - 0.04 - 0.0001);
    press('timer-mode');
    expect(badge.visible).toBe(false);
    expect(flash.visible).toBe(true);
    expect(text(widget.root, 'timer-display')).toBe('Done');
    widget.dispose();
  });

  it('ignores a preset while the countdown runs', () => {
    const { widget, press, advance } = setup();
    press('timer-run');
    advance(1000);
    press('timer-preset-25');
    expect(text(widget.root, 'timer-display')).toBe('4:59');
    expect(text(widget.root, 'timer-run')).toBe('Pause');
    widget.dispose();
  });
});
