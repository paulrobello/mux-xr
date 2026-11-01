import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockTextLike extends THREE.Mesh {
  text: string;
  font: string | null;
  fontSize: number;
  maxWidth: number;
  anchorX: number | string;
  anchorY: number | string;
  textAlign: string;
  whiteSpace: string;
  lineHeight: number | string;
  overflowWrap: string;
  color: number | string | THREE.Color;
  depthOffset: number;
  disposed: boolean;
}

const configuration = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    text = '';
    font: string | null = null;
    fontSize = 0;
    maxWidth = 0;
    anchorX: number | string = 0;
    anchorY: number | string = 0;
    textAlign = '';
    whiteSpace = '';
    lineHeight: number | string = 'normal';
    overflowWrap = '';
    color: number | string | THREE.Color = 0;
    depthOffset = 0;
    disposed = false;
    constructor() {
      super(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    }
    sync(callback?: () => void): void {
      queueMicrotask(() => callback?.());
    }
    dispose(): void {
      this.disposed = true;
    }
  },
  configureTextBuilder: vi.fn((value: unknown) => {
    configuration.current = value;
  }),
}));

import {
  createScalableLabel,
  disposeScalableLabel,
  LABEL_FONT_URL,
  LABEL_SYMBOL_FONT_URL,
  updateScalableLabel,
  waitForLabelSync,
} from '../src/xr/labels';

describe('scalable XR labels', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates a tintable plane with glyph-free background and local SDF text', async () => {
    expect(configuration.current).toMatchObject({
      defaultFontURL: LABEL_FONT_URL,
      useWorker: false,
    });
    const root = createScalableLabel('Commands', 0.28, 0.09, { background: '#1c2a35' });
    const text = root.userData.labelTextObject as MockTextLike;

    expect(root).toBeInstanceOf(THREE.Mesh);
    expect((root.geometry as THREE.PlaneGeometry).parameters.width).toBe(0.28);
    expect((root.geometry as THREE.PlaneGeometry).parameters.height).toBe(0.09);
    const material = root.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    const pixels = (material.map as THREE.DataTexture).image.data as Uint8Array;
    const textureWidth = (material.map as THREE.DataTexture).image.width;
    expect(textureWidth).toBe(Math.round((64 * 0.28) / 0.09));
    expect(Array.from(pixels.slice(0, 4))).toEqual([28, 42, 53, 255]);
    expect(
      Array.from(pixels.slice((3 * textureWidth + 3) * 4, (3 * textureWidth + 3) * 4 + 4)),
    ).toEqual([28, 42, 53, 255]);
    expect(text.font).toBe(LABEL_FONT_URL);
    expect(text.position.z).toBeGreaterThan(0);
    await expect(waitForLabelSync(root)).resolves.toBeUndefined();
  });

  it('uses the local symbol font for arrow and backspace glyphs', () => {
    for (const label of ['←', '→', '⌫', '← Next']) {
      const root = createScalableLabel(label, 0.12, 0.035);
      expect((root.userData.labelTextObject as MockTextLike).font).toBe(LABEL_SYMBOL_FONT_URL);
      disposeScalableLabel(root);
    }
    expect(
      (createScalableLabel('$ 123…', 0.2, 0.04).userData.labelTextObject as MockTextLike).font,
    ).toBe(LABEL_FONT_URL);
  });

  it('fits a long caption before truncating and preserves wrap on update', () => {
    const root = createScalableLabel('A longer caption', 0.7, 0.11, { wrap: true });
    const text = root.userData.labelTextObject as MockTextLike;
    expect(text.text).toBe('A longer caption');
    expect(text.fontSize).toBeGreaterThan(0.11 * 0.22);
    updateScalableLabel(root, 'Another caption');
    expect(text.whiteSpace).toBe('normal');
  });

  it('sanitizes unsupported glyphs while preserving supported punctuation and original text', () => {
    const root = createScalableLabel('A$ ← · … 漢', 0.7, 0.11);
    const text = root.userData.labelTextObject as MockTextLike;
    expect(root.userData.labelText).toBe('A$ ← · … 漢');
    expect(text.text).toBe('A$ ⇦ · … ?');
  });

  it('updates text without replacing root identity or interaction target', () => {
    const root = createScalableLabel('A', 0.12, 0.035);
    root.position.set(1, 2, 3);
    const raycast = root.raycast;
    const text = root.userData.labelTextObject as MockTextLike;

    updateScalableLabel(root, 'B');

    expect(root.position.toArray()).toEqual([1, 2, 3]);
    expect(root.raycast).toBe(raycast);
    expect(text.text).toBe('B');
    expect(root.userData.labelText).toBe('B');
  });

  it('defers Troika disposal until sync settles and disposes owned resources once', async () => {
    const root = createScalableLabel('⌫', 0.12, 0.035);
    const text = root.userData.labelTextObject as MockTextLike;
    const geometryDispose = vi.spyOn(root.geometry, 'dispose');
    const materialDispose = vi.spyOn(root.material as THREE.MeshBasicMaterial, 'dispose');
    const textureDispose = vi.spyOn(
      root.userData.labelBackgroundTexture as THREE.DataTexture,
      'dispose',
    );

    disposeScalableLabel(root);
    disposeScalableLabel(root);

    expect(text.disposed).toBe(false);
    await waitForLabelSync(root);
    await Promise.resolve();
    expect(text.disposed).toBe(true);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
