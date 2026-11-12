// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { isHeif } from '../src/image-format';
import { decodeHeifPixels, HeifDecodeError, type HeifLibrary } from '../src/xr/heif-core';
import { type PictureLoaderDeps, preparePicture } from '../src/xr/picture-image';
import { MAX_UNPROBED_PICTURE_BYTES, PictureLoadError } from '../src/xr/picture-sizing';

const fixture = readFileSync('tests/fixtures/gradient.heic');
const require = createRequire(import.meta.url);
const libheifPath = require.resolve('libheif-js/libheif-wasm/libheif.js');

function loadLibheif(): HeifLibrary {
  const factory = require(libheifPath) as (options: { wasmBinary: Buffer }) => HeifLibrary;
  return factory({ wasmBinary: readFileSync(libheifPath.replace(/\.js$/, '.wasm')) });
}

/** An ISO-BMFF ftyp box with the given major and compatible brands. */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const text = [major, '\0\0\0\0', ...compatible].join('');
  const bytes = new Uint8Array(8 + text.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(
    [...'ftyp'].map((char) => char.charCodeAt(0)),
    4,
  );
  bytes.set(
    [...text].map((char) => char.charCodeAt(0)),
    8,
  );
  return bytes;
}

describe('isHeif', () => {
  it('recognises HEVC HEIF brands, and generic HEIF without AVIF', () => {
    expect(isHeif(fixture)).toBe(true);
    expect(isHeif(ftyp('heic', 'mif1', 'heic'))).toBe(true);
    expect(isHeif(ftyp('mif1', 'heic'))).toBe(true);
    expect(isHeif(ftyp('msf1', 'hevc'))).toBe(true);
  });

  it('leaves generic HEIF with no HEVC brand to the browser, since its codec is unknown', () => {
    expect(isHeif(ftyp('mif1', 'mif1'))).toBe(false);
    expect(isHeif(ftyp('mif1', 'miaf'))).toBe(false);
  });

  it('leaves AVIF, other ISO-BMFF files and non-images to the browser', () => {
    expect(isHeif(ftyp('avif', 'mif1', 'miaf'))).toBe(false);
    expect(isHeif(ftyp('mif1', 'avif'))).toBe(false);
    expect(isHeif(ftyp('isom', 'mp41'))).toBe(false);
    expect(
      isHeif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe(false);
    expect(isHeif(fixture.subarray(0, 12))).toBe(false);
  });
});

describe('decodeHeifPixels', () => {
  it('decodes the primary image of a real HEIC to RGBA', async () => {
    const pixels = await decodeHeifPixels(loadLibheif(), fixture, {
      maxEdge: 16384,
      maxPixels: 64 * 1024 * 1024,
    });
    expect([pixels.width, pixels.height]).toEqual([64, 48]);
    expect(pixels.data.length).toBe(64 * 48 * 4);
    const at = (x: number, y: number): number[] => [
      ...pixels.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4),
    ];
    // The fixture is a gradient: red rises left to right, green top to bottom, blue fixed.
    const [r0, g0] = at(0, 0);
    const [r1, , , a1] = at(63, 0);
    const [, g2] = at(0, 47);
    expect(r0).toBeLessThan(40);
    expect(g0).toBeLessThan(40);
    expect(r1).toBeGreaterThan(200);
    expect(g2).toBeGreaterThan(200);
    expect(a1).toBe(255);
  });

  it('refuses an oversized image from the container size before decoding it', async () => {
    const lib = loadLibheif();
    const display = vi.fn();
    const decoder = lib.HeifDecoder;
    const spied: HeifLibrary = {
      HeifDecoder: class {
        decode(bytes: Uint8Array) {
          return new decoder().decode(bytes).map((image) => {
            image.display = display;
            return image;
          });
        }
      },
    };
    const refused = decodeHeifPixels(spied, fixture, { maxEdge: 32, maxPixels: 1 << 20 });
    await expect(refused).rejects.toEqual(new HeifDecodeError('too-large', '64x48 px'));
    expect(display).not.toHaveBeenCalled();
  });

  it('reports a file that is not HEIF as undecodable', async () => {
    const refused = decodeHeifPixels(loadLibheif(), new Uint8Array(64), {
      maxEdge: 16384,
      maxPixels: 1 << 26,
    });
    await expect(refused).rejects.toBeInstanceOf(HeifDecodeError);
  });
});

describe('preparePicture with HEIF', () => {
  const canvas = (width: number, height: number) =>
    ({
      width,
      height,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (done: (blob: Blob | null) => void, type?: string) =>
        done(new Blob([new Uint8Array(8)], { type })),
    }) as unknown as HTMLCanvasElement;
  const deps = (decodeHeif?: PictureLoaderDeps['decodeHeif']): PictureLoaderDeps => ({
    fetch: vi.fn(),
    decode: vi.fn(async () => {
      throw new Error('the browser cannot decode HEIF');
    }),
    decodeHeif,
    createCanvas: canvas,
  });

  it('routes HEIF to the HEIF decoder, not the browser', async () => {
    const loader = deps(vi.fn(async () => ({ width: 2048, height: 1536 })));
    const picture = await preparePicture(
      new Blob([fixture], { type: 'image/heic' }),
      'a.heic',
      loader,
    );
    expect(loader.decodeHeif).toHaveBeenCalledOnce();
    expect(loader.decode).not.toHaveBeenCalled();
    expect([picture.width, picture.height]).toEqual([2048, 1536]);
    expect(picture.blob.type).toBe('image/webp');
  });

  it('decodes a HEIF with no browser type, as a picked .heic often has', async () => {
    const loader = deps(vi.fn(async () => ({ width: 64, height: 48 })));
    await preparePicture(new Blob([fixture]), 'IMG_5424.HEIC.heif', loader);
    expect(loader.decodeHeif).toHaveBeenCalledOnce();
  });

  it('does not refuse a large HEIF for an unreadable header size', async () => {
    const big = new Blob([fixture, new Uint8Array(MAX_UNPROBED_PICTURE_BYTES)]);
    const loader = deps(vi.fn(async () => ({ width: 64, height: 48 })));
    await expect(preparePicture(big, 'big.heic', loader)).resolves.toBeDefined();
  });

  it('keeps the size refusal from the HEIF decoder, and fails cleanly with no decoder', async () => {
    const tooLarge = deps(
      vi.fn(async () => {
        throw new PictureLoadError('too-large', '20000x20000 px');
      }),
    );
    await expect(preparePicture(new Blob([fixture]), 'a.heic', tooLarge)).rejects.toMatchObject({
      code: 'too-large',
      message: '20000x20000 px',
    });
    await expect(preparePicture(new Blob([fixture]), 'a.heic', deps())).rejects.toMatchObject({
      code: 'decode',
    });
  });
});
