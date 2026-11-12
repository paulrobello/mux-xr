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

import type { PictureDepthResult } from '../src/host-picture-depth';
import { createPictureController } from '../src/workspace/pictures';
import {
  decodeHeifPixels,
  type HeifImageHandle,
  type HeifLibrary,
  readStereoPair,
} from '../src/xr/heif-core';
import { DEFAULT_DEPTH_VIEW, usesDepthMap } from '../src/xr/picture-depth';
import { createPictureFrameWidget } from '../src/xr/picture-frame';
import type { PictureImage, PreparedPicture } from '../src/xr/picture-image';
import { preparePicture } from '../src/xr/picture-image';
import {
  createMemoryPictureStorage,
  createMemoryRecentPictureStorage,
  createPictureLibrary,
  createRecentPictureLibrary,
  planEviction,
} from '../src/xr/picture-store';
import { estimateDisparity } from '../src/xr/stereo-disparity';

/** An ISO-BMFF box; `full` prepends the FullBox version and flags. */
function box(type: string, payload: Uint8Array, full = false): Uint8Array {
  const body = full ? new Uint8Array([0, 0, 0, 0, ...payload]) : payload;
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(body, 8);
  return out;
}
const u32 = (...values: number[]): Uint8Array => {
  const out = new Uint8Array(values.length * 4);
  values.forEach((value, i) => {
    new DataView(out.buffer).setUint32(i * 4, value);
  });
  return out;
};
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
/** A file whose meta box holds an 'altr' group and then a 'ster' group, as an iPhone writes. */
const spatialHeader = (left: number, right: number): Uint8Array =>
  concat(
    box('ftyp', new TextEncoder().encode('heic\0\0\0\0mif1heic')),
    box(
      'meta',
      concat(
        box('hdlr', new Uint8Array(21), true),
        box(
          'grpl',
          concat(
            box('altr', u32(47, 2, 68, 46), true),
            box('ster', u32(126, 2, left, right), true),
          ),
        ),
      ),
      true,
    ),
  );

describe('readStereoPair', () => {
  it("reads the left and right ids from the meta box's ster group", () => {
    expect(readStereoPair(spatialHeader(122, 95))).toEqual({ left: 122, right: 95 });
  });

  it('is null without a stereo group, and for truncated or junk bytes', () => {
    const plain = concat(box('ftyp', new Uint8Array(8)), box('meta', new Uint8Array(0), true));
    expect(readStereoPair(plain)).toBeNull();
    expect(readStereoPair(spatialHeader(1, 2).subarray(0, 60))).toBeNull();
    expect(readStereoPair(new Uint8Array(64).fill(0xff))).toBeNull();
  });
});

describe('decodeHeifPixels stereo', () => {
  const handle = (width: number, height: number, primary: boolean, fill: number) => {
    const freed = vi.fn();
    const image: HeifImageHandle = {
      get_width: () => width,
      get_height: () => height,
      is_primary: () => primary,
      display: (target, done) => {
        target.data.fill(fill);
        done(target);
      },
      free: freed,
    };
    return { image, freed };
  };
  const library = (ids: number[], images: HeifImageHandle[]): HeifLibrary => ({
    HeifDecoder: class {
      decoder = {};
      decode = () => images;
    },
    heif_js_context_get_list_of_top_level_image_IDs: () => ids,
  });
  const limits = { maxEdge: 16384, maxPixels: 50e6 };

  it('decodes both eyes of a stereo pair, left first, and frees every handle', async () => {
    const primary = handle(8, 6, true, 1);
    const right = handle(4, 3, false, 2);
    const left = handle(4, 3, false, 3);
    const decoded = await decodeHeifPixels(
      library([46, 95, 122], [primary.image, right.image, left.image]),
      spatialHeader(122, 95),
      limits,
    );
    expect([decoded.image.width, decoded.image.data[0]]).toEqual([4, 3]);
    expect([decoded.right?.width, decoded.right?.data[0]]).toEqual([4, 2]);
    for (const entry of [primary, right, left]) expect(entry.freed).toHaveBeenCalledOnce();
  });

  it('falls back to the primary image when the eyes cannot be matched up', async () => {
    const primary = handle(8, 6, true, 1);
    const right = handle(4, 3, false, 2);
    const odd = handle(5, 3, false, 3);
    const run = (ids: number[], images: HeifImageHandle[]) =>
      decodeHeifPixels(library(ids, images), spatialHeader(122, 95), limits);
    // Eyes of different sizes, ids out of step with the images, and no stereo group.
    expect((await run([46, 95, 122], [primary.image, right.image, odd.image])).right).toBe(
      undefined,
    );
    expect((await run([46, 95], [primary.image, right.image, odd.image])).image.width).toBe(8);
    // A pair whose two eyes together exceed one image's pixel budget shows the primary.
    const big = await decodeHeifPixels(
      library(
        [46, 95, 122],
        [primary.image, handle(6, 5, false, 2).image, handle(6, 5, false, 3).image],
      ),
      spatialHeader(122, 95),
      { maxEdge: 16384, maxPixels: 50 },
    );
    expect([big.image.width, big.right]).toEqual([8, undefined]);
    const plain = await decodeHeifPixels(
      library([46, 95, 122], [primary.image, right.image, odd.image]),
      concat(box('ftyp', new Uint8Array(8))),
      limits,
    );
    expect([plain.image.width, plain.right]).toEqual([8, undefined]);
  });
});

describe('estimateDisparity', () => {
  it('finds a uniform shift between the eyes, positive when the left eye sits further right', () => {
    const width = 160;
    const height = 48;
    let seed = 7;
    const noise = Array.from({ length: width + 40 }, () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % 256;
    });
    const eye = (offset: number): Uint8ClampedArray => {
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const value = noise[x + 20 - offset + (y % 7)];
          rgba.set([value, value, value, 255], (y * width + x) * 4);
        }
      return rgba;
    };
    const measured = estimateDisparity(eye(6), eye(0), width, height);
    expect(measured.typical).toBeCloseTo(6 / width, 6);
    expect(measured.near).toBeCloseTo(6 / width, 6);
    expect(estimateDisparity(eye(0), eye(0), width, height).typical).toBe(0);
  });

  it('reports zero for a featureless pair', () => {
    const flat = new Uint8ClampedArray(64 * 32 * 4).fill(128);
    expect(estimateDisparity(flat, flat, 64, 32)).toEqual({ near: 0, typical: 0 });
  });
});

const canvas = (width: number, height: number) =>
  ({
    width,
    height,
    getContext: () => ({ drawImage: vi.fn(), imageSmoothingEnabled: false }),
    toBlob: (done: (blob: Blob | null) => void, type?: string) =>
      done(new Blob([new Uint8Array(16)], { type })),
  }) as unknown as HTMLCanvasElement;
const flat = (width: number, height: number): PictureImage => ({
  source: canvas(width, height),
  width,
  height,
});

describe('spatial photo pictures', () => {
  const heifBytes = concat(box('ftyp', new TextEncoder().encode('heic\0\0\0\0mif1heic')));
  const deps = (right: { width: number; height: number } | undefined) => ({
    fetch: vi.fn(),
    decode: vi.fn(),
    decodeHeif: vi.fn(async () => ({ image: { width: 2688, height: 2016 }, right })),
    createCanvas: canvas,
  });

  it('keeps a matching right eye, encoded for storage, and drops a mismatched one', async () => {
    const blob = new Blob([heifBytes], { type: 'image/heic' });
    const pair = await preparePicture(blob, 'IMG.HEIC', deps({ width: 2688, height: 2016 }));
    expect([pair.width, pair.height]).toEqual([2048, 1536]);
    expect(pair.right?.source.width).toBe(2048);
    expect(pair.right?.blob.type).toBe('image/webp');
    const odd = await preparePicture(blob, 'IMG.HEIC', deps({ width: 100, height: 100 }));
    expect(odd.right).toBeUndefined();
  });

  it('counts the right eye toward the storage and Recent budgets', async () => {
    expect(
      planEviction([{ id: 'a', createdAt: 1, blob: { size: 40 }, right: { size: 40 } }], 30, {
        maxFrames: 8,
        maxBytes: 100,
      }),
    ).toEqual(['a']);
    const recent = createRecentPictureLibrary(createMemoryRecentPictureStorage(), {
      maxFrames: 8,
      maxBytes: 100,
    });
    const entry = (id: string, sourceKey: string) => ({
      id,
      name: id,
      blob: new Blob([new Uint8Array(30)]),
      right: new Blob([new Uint8Array(30)]),
      thumbnail: new Blob([new Uint8Array(5)]),
      width: 4,
      height: 3,
      sourceKey,
      lastUsedAt: 1,
    });
    await recent.add(entry('r1', 'a'));
    expect(await recent.add(entry('r2', 'b'))).toBe(1);
  });

  it('defaults a stereo pair to its captured eyes, not a depth map', () => {
    expect(usesDepthMap(DEFAULT_DEPTH_VIEW, true)).toBe(false);
    expect(usesDepthMap(DEFAULT_DEPTH_VIEW, false)).toBe(true);
    expect(usesDepthMap({ ...DEFAULT_DEPTH_VIEW, source: 'depth' }, true)).toBe(true);
  });
});

describe('picture controller with stereo pairs', () => {
  const stereo = (name: string): PreparedPicture => ({
    ...flat(800, 600),
    name,
    blob: new Blob([new Uint8Array(32)], { type: 'image/webp' }),
    right: {
      source: canvas(800, 600),
      blob: new Blob([new Uint8Array(32)], { type: 'image/webp' }),
    },
  });
  const setup = () => {
    const storage = createMemoryPictureStorage();
    const scene = {
      addPicture: vi.fn((): string[] => []),
      restorePictures: vi.fn(),
      removePicture: vi.fn(),
      setPictureDepth: vi.fn(),
    };
    const estimate = vi.fn(
      async (): Promise<PictureDepthResult> => ({
        ok: true,
        depth: new Blob([new Uint8Array(4)], { type: 'image/png' }),
        width: 800,
        height: 600,
      }),
    );
    let id = 0;
    const controller = createPictureController({
      library: createPictureLibrary(storage),
      scene: () => scene,
      notify: vi.fn(),
      createId: () => `pic-${++id}`,
      depth: estimate,
      loaders: {
        file: async (file) => stereo(file.name),
        url: async (url) => stereo(url),
        stored: async (_blob, name) => ({
          ...flat(800, 600),
          name,
          blob: new Blob([new Uint8Array(32)], { type: 'image/webp' }),
        }),
      },
    });
    return { storage, scene, estimate, controller };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('stores both eyes and asks for no depth map while showing stereo', async () => {
    const { storage, estimate, controller } = setup();
    await controller.addFile(new File(['x'], 'IMG.HEIC'));
    await settle();
    expect(storage.records.get('pic-1')?.right?.size).toBe(32);
    expect(estimate).not.toHaveBeenCalled();
  });

  it('asks for a depth map when a stereo pair is switched to depth', async () => {
    const { estimate, scene, controller } = setup();
    await controller.addFile(new File(['x'], 'IMG.HEIC'));
    controller.setDepthView('pic-1', { ...DEFAULT_DEPTH_VIEW, source: 'depth' });
    await settle();
    await settle();
    expect(estimate).toHaveBeenCalledOnce();
    expect(scene.setPictureDepth).toHaveBeenCalledWith('pic-1', expect.anything());
  });

  it('restores both eyes', async () => {
    const { storage, scene, controller } = setup();
    const blob = new Blob([new Uint8Array(8)], { type: 'image/webp' });
    storage.records.set('a', {
      id: 'a',
      name: 'a',
      blob,
      right: blob,
      width: 800,
      height: 600,
      createdAt: 1,
    });
    await controller.restore();
    const [[restored]] = scene.restorePictures.mock.calls as unknown as [
      [Array<{ image: PictureImage }>],
    ];
    expect(restored[0]?.image.right?.source.width).toBe(800);
  });
});

describe('stereo picture frame', () => {
  const pair = (): PictureImage => ({
    ...flat(1600, 1200),
    right: { source: canvas(1600, 1200), blob: new Blob([]) },
  });

  it('shows each eye its own image and the desktop the left', () => {
    const widget = createPictureFrameWidget(null, { id: 'pic-s', image: pair() });
    const mesh = widget.root.getObjectByName('picture-frame-stereo') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;
    expect(mesh.visible).toBe(true);
    const flatPlane = widget.root.getObjectByName('picture-frame-image') as THREE.Mesh;
    expect((flatPlane.material as THREE.Material).visible).toBe(false);
    const draw = (camera: THREE.Camera) => {
      mesh.onBeforeRender(
        {} as THREE.WebGLRenderer,
        new THREE.Scene(),
        camera,
        mesh.geometry,
        mesh.material,
        null as unknown as THREE.Group,
      );
      return mesh.material.uniforms.eye.value;
    };
    const eye = (layer: number) => {
      const camera = new THREE.PerspectiveCamera();
      camera.layers.enable(layer);
      return camera;
    };
    expect(draw(eye(1))).toBe(0);
    expect(draw(eye(2))).toBe(1);
    expect(draw(new THREE.PerspectiveCamera())).toBe(0);
    const hits: THREE.Intersection[] = [];
    mesh.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
    widget.dispose();
  });

  it('switches to a depth map from the Source option, showing its strength and edges', () => {
    const onDepthView = vi.fn();
    const widget = createPictureFrameWidget(null, { id: 'pic-s', image: pair(), onDepthView });
    const depthMapOptions = widget.root.getObjectByName('picture-depth-map-options');
    expect(depthMapOptions?.visible).toBe(false);
    const source = widget.root.getObjectByName('picture-depth-source');
    if (!source) throw new Error('source option missing');
    widget.activate?.(source);
    expect(onDepthView).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'depth' }));
    expect(depthMapOptions?.visible).toBe(true);
    expect(widget.root.getObjectByName('picture-frame-stereo')?.visible).toBe(false);
    widget.setPictureDepth?.(flat(4, 4));
    expect(widget.root.getObjectByName('picture-frame-relief')?.visible).toBe(true);
    widget.dispose();
  });

  it('has no Source option or stereo mesh for an ordinary picture', () => {
    const widget = createPictureFrameWidget(null, { id: 'pic-f', image: flat(1600, 1200) });
    expect(widget.root.getObjectByName('picture-depth-source')).toBeUndefined();
    expect(widget.root.getObjectByName('picture-frame-stereo')).toBeUndefined();
    expect(widget.root.getObjectByName('picture-depth-map-options')?.visible).toBe(true);
    widget.dispose();
  });
});
