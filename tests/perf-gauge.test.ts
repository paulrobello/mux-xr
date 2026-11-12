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

import {
  countsAsFrame,
  createFrameTimeHistory,
  createPerfGaugeWidget,
  formatFps,
  formatPanes,
  formatWorstFrame,
  fpsTone,
  frameTone,
  PERF_HISTORY,
  PERF_TONE_COLORS,
  sparklineHeights,
} from '../src/xr/perf-gauge';

describe('perf gauge math', () => {
  it('tones FPS against the XR target', () => {
    expect(fpsTone(72, 72)).toBe('good');
    expect(fpsTone(69, 72)).toBe('good');
    expect(fpsTone(68, 72)).toBe('warn');
    expect(fpsTone(54, 72)).toBe('warn');
    expect(fpsTone(53, 72)).toBe('bad');
    expect(fpsTone(86, 90)).toBe('good');
    expect(fpsTone(72, 90)).toBe('warn');
    expect(fpsTone(null, 72)).toBe('unknown');
    expect(fpsTone(Number.NaN, 72)).toBe('unknown');
    expect(fpsTone(60, 0)).toBe('unknown');
  });

  it('tones a single frame time against the frame budget', () => {
    expect(frameTone(1000 / 72, 72)).toBe('good');
    expect(frameTone(14.5, 72)).toBe('good');
    expect(frameTone(16.7, 72)).toBe('warn');
    expect(frameTone(18.5, 72)).toBe('warn');
    expect(frameTone(19, 72)).toBe('bad');
    expect(frameTone(0, 72)).toBe('unknown');
  });

  it('treats long or hidden intervals as pauses, not frames', () => {
    expect(countsAsFrame(16.7, false, false)).toBe(true);
    expect(countsAsFrame(1500, false, false)).toBe(true);
    expect(countsAsFrame(5000, false, false)).toBe(true);
    expect(countsAsFrame(5001, false, false)).toBe(false);
    expect(countsAsFrame(16.7, true, false)).toBe(false);
    expect(countsAsFrame(16.7, false, true)).toBe(false);
    expect(countsAsFrame(Number.NaN, false, false)).toBe(false);
  });

  it('formats the readouts', () => {
    expect(formatFps(71.6, 72)).toBe('72 / 72 fps');
    expect(formatFps(60, 90)).toBe('60 / 90 fps');
    expect(formatFps(null, 72)).toBe('-- / 72 fps');
    expect(formatFps(null, 0)).toBe('-- / -- fps');
    expect(formatWorstFrame(13.889)).toBe('worst (20 s) 13.9 ms');
    expect(formatWorstFrame(250.4)).toBe('worst (20 s) 250 ms');
    expect(formatWorstFrame(0)).toBe('worst (20 s) -- ms');
    expect(formatPanes(1)).toBe('1 pane shown');
    expect(formatPanes(6)).toBe('6 panes shown');
  });

  it('keeps the newest samples in a fixed ring and reports their max', () => {
    const history = createFrameTimeHistory(3);
    expect(history.count).toBe(0);
    expect(history.max()).toBe(0);
    history.push(10);
    history.push(30);
    expect([history.at(0), history.at(1)]).toEqual([10, 30]);
    history.push(20);
    history.push(15);
    expect(history.count).toBe(3);
    expect([history.at(0), history.at(1), history.at(2)]).toEqual([30, 20, 15]);
    expect(history.max()).toBe(30);
    history.push(5);
    expect(history.max()).toBe(20);
    history.push(Number.NaN);
    expect(history.at(2)).toBe(0);
    expect(history.at(5)).toBe(0);
    history.clear();
    expect(history.count).toBe(0);
    expect(history.max()).toBe(0);
  });

  it('scales sparkline heights so the frame budget sits at mid-height', () => {
    const history = createFrameTimeHistory(4);
    for (const ms of [1000 / 72, 0, 1000 / 36, 100]) history.push(ms);
    const out = new Float32Array(4);
    expect(sparklineHeights(history, 72, out)).toBe(4);
    expect(Array.from(out)).toEqual([0.5, 0, 1, 1].map(Math.fround));
    const short = new Float32Array(2);
    expect(sparklineHeights(history, 72, short)).toBe(2);
    expect(Array.from(short)).toEqual([1, 1]);
  });
});

describe('perf gauge widget', () => {
  const sample = { fps: 72, worstFrameMs: 18.25, shownPanes: 6, targetHz: 72 };
  const named = (root: THREE.Object3D, name: string): THREE.Object3D => {
    const object = root.getObjectByName(name);
    if (!object) throw new Error(`${name} missing`);
    return object;
  };

  it('shows FPS, the worst recent frame and visible panes from each sample', () => {
    const widget = createPerfGaugeWidget(null);
    expect(named(widget.root, 'perf-gauge-fps').userData.labelText).toBe('-- / -- fps');
    widget.setPerfSample?.(sample);
    expect(named(widget.root, 'perf-gauge-fps').userData.labelText).toBe('72 / 72 fps');
    expect(named(widget.root, 'perf-gauge-worst').userData.labelText).toBe('worst (20 s) 18.3 ms');
    expect(named(widget.root, 'perf-gauge-panes').userData.labelText).toBe('6 panes shown');
    expect(named(widget.root, 'perf-gauge-warning').visible).toBe(false);
    const dot = named(widget.root, 'perf-gauge-tone') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(dot.material.color.getHex()).toBe(PERF_TONE_COLORS.good);
    // The worst readout spans the history window, not just the latest sample.
    widget.setPerfSample?.({ ...sample, fps: 50, worstFrameMs: 9 });
    expect(named(widget.root, 'perf-gauge-worst').userData.labelText).toBe('worst (20 s) 18.3 ms');
    expect(dot.material.color.getHex()).toBe(PERF_TONE_COLORS.bad);
    // Below target the status is also a shape: the dot gives way to a warning triangle.
    expect(dot.visible).toBe(false);
    expect(named(widget.root, 'perf-gauge-warning').visible).toBe(true);
    widget.resetPerf?.();
    expect(named(widget.root, 'perf-gauge-worst').userData.labelText).toBe('worst (20 s) -- ms');
    widget.setPerfSample?.({ ...sample, worstFrameMs: 9 });
    expect(named(widget.root, 'perf-gauge-worst').userData.labelText).toBe('worst (20 s) 9.0 ms');
    widget.dispose();
  });

  it('updates the sparkline in place without reallocating its buffer', () => {
    const widget = createPerfGaugeWidget(null);
    const spark = named(widget.root, 'perf-gauge-sparkline') as THREE.Mesh;
    const position = spark.geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = position.array;
    expect(spark.geometry.drawRange.count).toBe(0);
    widget.setPerfSample?.(sample);
    widget.setPerfSample?.(sample);
    expect(spark.geometry.drawRange).toMatchObject({ start: (PERF_HISTORY - 2) * 6, count: 12 });
    for (let index = 0; index < PERF_HISTORY + 5; index += 1) widget.setPerfSample?.(sample);
    expect(spark.geometry.drawRange).toMatchObject({ start: 0, count: PERF_HISTORY * 6 });
    expect(position.array).toBe(array);
    widget.dispose();
  });

  it('tints each bar by its own frame time, not by the current FPS', () => {
    const widget = createPerfGaugeWidget(null);
    const spark = named(widget.root, 'perf-gauge-sparkline') as THREE.Mesh;
    const color = spark.geometry.getAttribute('color') as THREE.BufferAttribute;
    widget.setPerfSample?.({ ...sample, fps: 72, worstFrameMs: 40 });
    widget.setPerfSample?.({ ...sample, fps: 40, worstFrameMs: 12 });
    const bar = (fromRight: number) =>
      new THREE.Color().fromBufferAttribute(color, (PERF_HISTORY - fromRight) * 4).getHex();
    expect(bar(2)).toBe(PERF_TONE_COLORS.bad);
    expect(bar(1)).toBe(PERF_TONE_COLORS.good);
    widget.dispose();
  });

  it('does no work in the per-frame update and ignores samples after dispose', () => {
    const widget = createPerfGaugeWidget(null);
    const fps = named(widget.root, 'perf-gauge-fps');
    widget.update(Date.now());
    expect(fps.userData.labelText).toBe('-- / -- fps');
    widget.dispose();
    expect(() => widget.setPerfSample?.(sample)).not.toThrow();
    expect(widget.root.children).toHaveLength(0);
  });
});
