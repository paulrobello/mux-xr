import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createTerminalTexture } from '../src/xr/terminal-texture';

function fixture(
  width = 2,
  height = 2,
): {
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
  dirtyRows: Uint8Array;
  getImageData: ReturnType<typeof vi.fn>;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const dirtyRows = new Uint8Array(height);
  const getImageData = vi.fn((x: number, y: number, w: number, h: number) => ({
    data: pixels.slice((y * width + x) * 4, (y * width + x + w * h) * 4),
    width: w,
    height: h,
  }));
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    getImageData,
  } as unknown as CanvasRenderingContext2D);
  return { canvas, pixels, dirtyRows, getImageData };
}

function pixel(
  target: Uint8ClampedArray,
  offset: number,
  rgba: [number, number, number, number],
): void {
  target.set(rgba, offset * 4);
}

describe('terminal texture', () => {
  it('copies a changed strip in one GPU operation when the renderer supports regions', () => {
    const f = fixture(2, 4);
    const copyTextureToTexture = vi.fn();
    const owned = createTerminalTexture(f, {
      copyTextureToTexture,
      capabilities: { getMaxAnisotropy: () => 16 },
    });
    const version = owned.texture.version;
    f.dirtyRows[1] = 1;
    owned.update();
    expect(copyTextureToTexture).toHaveBeenCalledOnce();
    const [source, destination, region, position] = copyTextureToTexture.mock.calls[0];
    expect(source).not.toBe(destination);
    expect(source.image.data).toBe((owned.texture as THREE.DataTexture).image.data);
    expect(destination).toBe(owned.texture);
    expect(region.min.toArray()).toEqual([0, 2]);
    expect(region.max.toArray()).toEqual([2, 3]);
    expect(position.toArray()).toEqual([0, 2]);
    expect(owned.texture.version).toBe(version);
    expect(owned.texture.updateRanges).toEqual([]);
    owned.dispose();
  });

  it('uses trilinear mipmaps and caps anisotropy for minification', () => {
    const f = fixture();
    const owned = createTerminalTexture(f, {
      copyTextureToTexture: vi.fn(),
      capabilities: { getMaxAnisotropy: () => 16 },
    });
    expect(owned.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(owned.texture.magFilter).toBe(THREE.LinearFilter);
    expect(owned.texture.generateMipmaps).toBe(true);
    expect(owned.texture.anisotropy).toBe(4);
    owned.dispose();
  });

  it('falls back to one anisotropy sample when renderer capabilities are unavailable', () => {
    const f = fixture();
    const owned = createTerminalTexture(f, { copyTextureToTexture: vi.fn() });
    expect(owned.texture.anisotropy).toBe(1);
    owned.dispose();
  });

  it('copies CPU pixels into a vertically flipped DataTexture', () => {
    const f = fixture();
    pixel(f.pixels, 0, [255, 0, 0, 255]);
    pixel(f.pixels, 1, [0, 255, 0, 255]);
    pixel(f.pixels, 2, [0, 0, 255, 255]);
    pixel(f.pixels, 3, [255, 255, 255, 255]);
    const owned = createTerminalTexture({ canvas: f.canvas, dirtyRows: f.dirtyRows });
    expect(owned.texture).toBeInstanceOf(THREE.DataTexture);
    expect(Array.from((owned.texture as THREE.DataTexture).image.data as Uint8Array)).toEqual([
      0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    expect(owned.texture.flipY).toBe(false);
  });

  it('updates only one logical row and records a bounded range', () => {
    const f = fixture(2, 4);
    const owned = createTerminalTexture({ canvas: f.canvas, dirtyRows: f.dirtyRows });
    const texture = owned.texture as THREE.DataTexture;
    texture.updateRanges.length = 0;
    texture.needsUpdate = false;
    f.pixels.fill(0);
    pixel(f.pixels, 4, [1, 2, 3, 4]);
    f.dirtyRows[1] = 1;
    owned.update();
    expect(f.getImageData).toHaveBeenLastCalledWith(0, 1, 2, 1);
    expect(texture.updateRanges).toEqual([{ start: 16, count: 8 }]);
    expect(texture.version).toBeGreaterThan(1);
  });

  it('keeps ranges from multiple updates until the renderer consumes them', () => {
    const f = fixture(2, 2);
    const owned = createTerminalTexture({ canvas: f.canvas, dirtyRows: f.dirtyRows });
    const texture = owned.texture as THREE.DataTexture;
    texture.updateRanges.length = 0;
    f.dirtyRows[0] = 1;
    owned.update();
    f.dirtyRows.fill(0);
    f.dirtyRows[1] = 1;
    owned.update();
    expect(texture.updateRanges).toEqual([
      { start: 8, count: 8 },
      { start: 0, count: 8 },
    ]);
  });

  it('uploads the entire canvas when dirty-row flags are unavailable', () => {
    const f = fixture();
    const owned = createTerminalTexture({ canvas: f.canvas });
    const texture = owned.texture as THREE.DataTexture;
    texture.updateRanges.length = 0;
    const version = texture.version;
    owned.update();
    expect(texture.updateRanges).toEqual([
      { start: 8, count: 8 },
      { start: 0, count: 8 },
    ]);
    expect(texture.version).toBeGreaterThan(version);
  });

  it('keeps fallback upload ranges within individual pixel rows', () => {
    const f = fixture(2, 4);
    const dirtyRows = new Uint8Array([1, 1]);
    const owned = createTerminalTexture({ canvas: f.canvas, dirtyRows });
    const texture = owned.texture as THREE.DataTexture;
    texture.updateRanges.length = 0;
    owned.update();
    expect(f.getImageData).toHaveBeenLastCalledWith(0, 0, 2, 4);
    expect(texture.updateRanges).toEqual([
      { start: 24, count: 8 },
      { start: 16, count: 8 },
      { start: 8, count: 8 },
      { start: 0, count: 8 },
    ]);
  });

  it('does not upload when all dirty-row flags are clear', () => {
    const f = fixture();
    const owned = createTerminalTexture({ canvas: f.canvas, dirtyRows: f.dirtyRows });
    const texture = owned.texture as THREE.DataTexture;
    texture.updateRanges.length = 0;
    const version = texture.version;
    owned.update();
    expect(texture.updateRanges).toEqual([]);
    expect(texture.version).toBe(version);
  });

  it('recreates on resize while preserving UV settings and disposing the old texture', () => {
    const f = fixture();
    const owned = createTerminalTexture({ canvas: f.canvas, dirtyRows: f.dirtyRows });
    const previous = owned.texture;
    const dispose = vi.spyOn(previous, 'dispose');
    previous.repeat.set(0.5, 0.25);
    previous.offset.set(0.1, 0.2);
    previous.wrapS = THREE.RepeatWrapping;
    f.canvas.width = 4;
    f.canvas.height = 1;
    owned.update();
    expect(dispose).toHaveBeenCalledOnce();
    expect(owned.texture).not.toBe(previous);
    expect((owned.texture as THREE.DataTexture).image.width).toBe(4);
    expect(owned.texture.repeat.x).toBe(0.5);
    expect(owned.texture.repeat.y).toBe(0.25);
    expect(owned.texture.offset.x).toBe(0.1);
    expect(owned.texture.offset.y).toBe(0.2);
    expect(owned.texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(owned.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(owned.texture.generateMipmaps).toBe(true);
    expect(owned.texture.anisotropy).toBe(1);
  });

  it('falls back to CanvasTexture when a context cannot read pixels', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    const owned = createTerminalTexture({ canvas, dirtyRows: new Uint8Array([1, 0]) });
    expect(owned.texture).toBeInstanceOf(THREE.CanvasTexture);
    const version = owned.texture.version;
    owned.update();
    expect(owned.texture.version).toBeGreaterThan(version);
  });
});
