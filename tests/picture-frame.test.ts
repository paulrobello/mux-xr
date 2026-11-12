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

import { mountPicturePicker } from '../src/ui/pictures';
import { createPictureController, type PictureLoaders } from '../src/workspace/pictures';
import { createPictureFrameWidget, PICTURE_PLACEHOLDER_TEXT } from '../src/xr/picture-frame';
import {
  loadPictureUrl,
  type PictureLoaderDeps,
  type PreparedPicture,
  preparePicture,
} from '../src/xr/picture-image';
import {
  fitWithin,
  frameSize,
  freePictureSlot,
  MAX_PICTURE_EDGE,
  MAX_PICTURE_SOURCE_BYTES,
  MAX_UNPROBED_PICTURE_BYTES,
  PictureLoadError,
  pictureErrorNotice,
  pictureSpawnOffset,
  probeImageSize,
} from '../src/xr/picture-sizing';
import {
  createIndexedDBPictureStorage,
  createMemoryPictureStorage,
  createPictureLibrary,
  type PictureRecord,
  planEviction,
} from '../src/xr/picture-store';
import type { SavedUIPose } from '../src/xr/ui-poses';
import { createWidgetPoseStore } from '../src/xr/widget-poses';
import { widgetKey, widgetKeyKind } from '../src/xr/widget-registry';

function fakeCanvas(width: number, height: number) {
  const drawImage = vi.fn();
  const canvas = {
    width,
    height,
    drawImage,
    getContext: () => ({ drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }),
    toBlob: (callback: (blob: Blob | null) => void, type?: string) =>
      callback(new Blob([new Uint8Array(width * height > 1e6 ? 2048 : 64)], { type })),
  };
  return canvas as unknown as HTMLCanvasElement & { drawImage: typeof drawImage };
}

function deps(
  decoded: { width: number; height: number } | Error,
  response?: Response | Error,
): PictureLoaderDeps & { closed: () => boolean; canvases: HTMLCanvasElement[] } {
  let closed = false;
  const canvases: HTMLCanvasElement[] = [];
  return {
    closed: () => closed,
    canvases,
    fetch: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response ?? new Response(new Blob(['x'], { type: 'image/png' }));
    }),
    decode: vi.fn(async () => {
      if (decoded instanceof Error) throw decoded;
      return {
        ...decoded,
        close: () => {
          closed = true;
        },
      };
    }),
    createCanvas: (width, height) => {
      const canvas = fakeCanvas(width, height);
      canvases.push(canvas);
      return canvas;
    },
  };
}

const png = (bytes = 16): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' });
const pngHeader = (width: number, height: number): Blob => {
  const head = new Uint8Array(32);
  head.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(head.buffer).setUint32(16, width);
  new DataView(head.buffer).setUint32(20, height);
  return new Blob([head], { type: 'image/png' });
};

describe('picture sizing', () => {
  it('downscales to the 2048 edge without upscaling, keeping the aspect', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1000, 5000)).toEqual({ width: 410, height: 2048 });
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
    expect(() => fitWithin(0, 10)).toThrow(RangeError);
  });

  it('sizes the image plane to the image aspect on a 0.6 m long edge', () => {
    expect(frameSize(1600, 900)).toEqual({ width: 0.6, height: (0.6 * 900) / 1600 });
    expect(frameSize(900, 1600)).toEqual({ width: (0.6 * 900) / 1600, height: 0.6 });
    const square = frameSize(512, 512);
    expect(square.width).toBe(square.height);
  });

  it('keeps every slot a frame apart, within 50 degrees of forward, and cascades nearer', () => {
    const base = [-0.95, -0.55, -1.15] as const;
    const at = (slot: number) => new THREE.Vector3(...pictureSpawnOffset(base, slot));
    expect(
      at(0)
        .toArray()
        .map((n) => +n.toFixed(6)),
    ).toEqual([...base]);
    const layer = [0, 1, 2, 3, 4];
    for (const slot of layer)
      for (const other of layer.filter((o) => o > slot))
        expect(at(slot).distanceTo(at(other))).toBeGreaterThan(0.66);
    // Every slot centre stays inside a Quest 3 eye's view when looking straight ahead.
    for (let slot = 0; slot < 15; slot += 1)
      expect(at(slot).angleTo(new THREE.Vector3(0, 0, -1))).toBeLessThan((50 * Math.PI) / 180);
    // Slot 5 is slot 0 one layer nearer and lower; slot 7 is slot 2 one layer nearer.
    expect(Math.hypot(at(5).x, at(5).z)).toBeCloseTo(Math.hypot(base[0], base[2]) - 0.07, 6);
    expect(at(5).y).toBeCloseTo(base[1] - 0.035, 6);
    expect(Math.hypot(at(7).x, at(7).z)).toBeCloseTo(Math.hypot(at(2).x, at(2).z) - 0.07, 6);
    expect(new Set(Array.from({ length: 15 }, (_, slot) => at(slot).toArray().join())).size).toBe(
      15,
    );
    expect(freePictureSlot([0, 1, 3])).toBe(2);
    expect(freePictureSlot([])).toBe(0);
  });

  it('reads image size from PNG, GIF, WebP and JPEG headers', () => {
    const bytes = (...parts: Array<number[] | string>) =>
      new Uint8Array(
        parts.flatMap((part) =>
          typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : part,
        ),
      );
    const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
    const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
    const png = bytes([0x89], 'PNG', [13, 10, 26, 10], be32(13), 'IHDR', be32(17000), be32(60));
    expect(probeImageSize(png)).toEqual({ width: 17000, height: 60 });
    expect(probeImageSize(bytes('GIF89a', le16(320), le16(200)))).toEqual({
      width: 320,
      height: 200,
    });
    const vp8x = bytes(
      'RIFF',
      [0, 0, 0, 0],
      'WEBP',
      'VP8X',
      [10, 0, 0, 0],
      [0, 0, 0, 0],
      le24(3999),
      le24(1999),
      [0],
    );
    expect(probeImageSize(vp8x)).toEqual({ width: 4000, height: 2000 });
    const bits = (640 - 1) | ((480 - 1) << 14);
    const vp8l = bytes(
      'RIFF',
      [0, 0, 0, 0],
      'WEBP',
      'VP8L',
      [5, 0, 0, 0],
      [0x2f],
      [bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255],
      [0, 0, 0, 0, 0],
    );
    expect(probeImageSize(vp8l)).toEqual({ width: 640, height: 480 });
    const vp8 = bytes(
      'RIFF',
      [0, 0, 0, 0],
      'WEBP',
      'VP8 ',
      [0, 0, 0, 0],
      [0, 0, 0, 0x9d, 0x01, 0x2a],
      le16(800),
      le16(600),
    );
    expect(probeImageSize(vp8)).toEqual({ width: 800, height: 600 });
    // SOI, an APP0 segment to skip, then SOF0 with height 3000 and width 4000.
    const jpeg = bytes(
      [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x0b, 0xb8, 0x0f, 0xa0, 3],
      new Array(12).fill(0),
    );
    expect(probeImageSize(jpeg)).toEqual({ width: 4000, height: 3000 });
    expect(probeImageSize(bytes('<html>not an image</html>'))).toBeNull();
  });

  it('names the host in the CORS notice and the reason in the others', () => {
    expect(pictureErrorNotice('cors', 'https://img.example.com/a.png')).toMatch(
      /^Image blocked by CORS: img\.example\.com/,
    );
    expect(pictureErrorNotice('http', 'https://img.example.com/a.png', 'HTTP 404')).toBe(
      'Image request failed (HTTP 404): img.example.com',
    );
    expect(pictureErrorNotice('too-large', 'big.png', '20000x100 px')).toBe(
      'Image is too large (20000x100 px): big.png',
    );
    expect(pictureErrorNotice('decode', 'bad.png')).toBe('Image could not be decoded: bad.png');
  });
});

describe('picture loading', () => {
  it('downscales into a bounded canvas, re-encodes, and closes the decoded bitmap', async () => {
    const loader = deps({ width: 4000, height: 3000 });
    const picture = await preparePicture(png(), 'wide.png', loader);
    expect([picture.width, picture.height]).toEqual([2048, 1536]);
    expect([picture.source.width, picture.source.height]).toEqual([2048, 1536]);
    expect(picture.blob.type).toBe('image/webp');
    expect(loader.closed()).toBe(true);
  });

  it('keeps the stored blob as is on restore', async () => {
    const blob = png();
    const picture = await preparePicture(blob, 'p.webp', deps({ width: 300, height: 600 }), {
      reencode: false,
    });
    expect(picture.blob).toBe(blob);
    expect([picture.width, picture.height]).toEqual([300, 600]);
  });

  it.each([
    [
      'an oversized file',
      png(MAX_PICTURE_SOURCE_BYTES + 1),
      { width: 10, height: 10 },
      'too-large',
    ],
    [
      'a non-image file',
      new Blob(['<html>'], { type: 'text/html' }),
      { width: 1, height: 1 },
      'not-image',
    ],
    ['an undecodable file', png(), new Error('bad'), 'decode'],
    ['a zero-size decode', png(), { width: 0, height: 0 }, 'decode'],
    ['an oversized decode', png(), { width: 20000, height: 100 }, 'too-large'],
    ['an oversized header', pngHeader(17000, 60), { width: 17000, height: 60 }, 'too-large'],
    ['an over-64 MP header', pngHeader(9000, 9000), { width: 9000, height: 9000 }, 'too-large'],
    ['an over-64 MP decode', png(), { width: 8200, height: 8200 }, 'too-large'],
    [
      'a large file whose header gives no size',
      png(MAX_UNPROBED_PICTURE_BYTES + 1),
      { width: 10, height: 10 },
      'too-large',
    ],
  ] as const)('rejects %s', async (_label, blob, decoded, code) => {
    const loader = deps(decoded instanceof Error ? decoded : { ...decoded });
    await expect(preparePicture(blob, 'x', loader)).rejects.toMatchObject({ code });
    // Whatever was decoded is closed; size and type checks reject before decoding.
    const decodedOnce = vi.mocked(loader.decode).mock.calls.length > 0;
    expect(loader.closed()).toBe(decodedOnce && !(decoded instanceof Error));
    if (code === 'not-image' || blob.size > MAX_PICTURE_SOURCE_BYTES)
      expect(decodedOnce).toBe(false);
    // An oversized header, or a large file with no readable size, is refused before decoding.
    if (/header/.test(_label)) expect(decodedOnce).toBe(false);
  });

  it('reports a fetch TypeError as CORS, a bad status as HTTP, and refuses non-http URLs', async () => {
    await expect(
      loadPictureUrl(
        'https://img.example.com/a.png',
        deps({ width: 1, height: 1 }, new TypeError('x')),
      ),
    ).rejects.toMatchObject({ code: 'cors', message: 'img.example.com' });
    await expect(
      loadPictureUrl(
        'https://img.example.com/a.png',
        deps({ width: 1, height: 1 }, new Response('', { status: 404 })),
      ),
    ).rejects.toMatchObject({ code: 'http', message: 'HTTP 404' });
    await expect(
      loadPictureUrl('file:///etc/passwd', deps({ width: 1, height: 1 })),
    ).rejects.toMatchObject({
      code: 'bad-url',
    });
    await expect(loadPictureUrl('not a url', deps({ width: 1, height: 1 }))).rejects.toMatchObject({
      code: 'bad-url',
    });
  });

  it('stops reading a body with no Content-Length once it passes the byte cap', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(4 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const loader = deps(
      { width: 1, height: 1 },
      new Response(body, { headers: { 'content-type': 'image/png' } }),
    );
    await expect(loadPictureUrl('https://img.example.com/huge.png', loader)).rejects.toMatchObject({
      code: 'too-large',
    });
    expect(pulled * chunk.byteLength).toBeLessThan(MAX_PICTURE_SOURCE_BYTES + 3 * chunk.byteLength);
    expect(loader.decode).not.toHaveBeenCalled();
  });

  it('aborts a request after 20 s and reports a timeout, not CORS', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const loader = deps({ width: 1, height: 1 });
    // A hung server: the request only settles when its signal aborts.
    loader.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('timed out', 'TimeoutError')),
          );
        }),
    );
    const loading = loadPictureUrl('https://slow.example.com/a.png', loader);
    controller.abort(new DOMException('timed out', 'TimeoutError'));
    const error = await loading.catch((caught: unknown) => caught);
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(error).toMatchObject({ code: 'timeout' });
    expect(pictureErrorNotice('timeout', 'https://slow.example.com/a.png')).toBe(
      'Image request timed out after 20 s: slow.example.com',
    );
    timeout.mockRestore();
  });

  it('refuses an http URL from an https page as mixed content', async () => {
    const loader = { ...deps({ width: 1, height: 1 }), pageProtocol: 'https:' };
    await expect(loadPictureUrl('http://img.example.com/a.png', loader)).rejects.toMatchObject({
      code: 'mixed-content',
    });
    expect(loader.fetch).not.toHaveBeenCalled();
    expect(pictureErrorNotice('mixed-content', 'http://img.example.com/a.png')).toBe(
      'Mixed content blocked: use an https URL',
    );
    // The same URL is fine from an http page (a LAN dev server).
    const plain = { ...deps({ width: 1, height: 1 }), pageProtocol: 'http:' };
    await expect(loadPictureUrl('http://img.example.com/a.png', plain)).resolves.toBeTruthy();
  });

  it('fetches with CORS mode and no credentials, never through a proxy', async () => {
    const loader = deps({ width: 800, height: 600 });
    const picture = await loadPictureUrl('https://img.example.com/photos/sun%20set.jpg', loader);
    expect(loader.fetch).toHaveBeenCalledWith('https://img.example.com/photos/sun%20set.jpg', {
      mode: 'cors',
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    });
    expect(picture.name).toBe('sun set.jpg');
  });
});

const record = (id: string, createdAt: number, bytes = 10): PictureRecord => ({
  id,
  name: id,
  blob: new Blob([new Uint8Array(bytes)]),
  width: 4,
  height: 3,
  createdAt,
});

describe('picture storage', () => {
  it('evicts the oldest frames past the frame count or byte budget', () => {
    const limits = { maxFrames: 3, maxBytes: 100 };
    const existing = [record('b', 2), record('a', 1), record('c', 3)];
    expect(planEviction(existing, 10, limits)).toEqual(['a']);
    expect(planEviction([record('a', 1, 60), record('b', 2, 30)], 40, limits)).toEqual(['a']);
    expect(planEviction([record('a', 1, 60), record('b', 2, 30)], 90, limits)).toEqual(['a', 'b']);
    expect(planEviction([], 10, limits)).toEqual([]);
    expect(() => planEviction([], 101, limits)).toThrow(RangeError);
  });

  it('stores, lists oldest first, evicts, and deletes through the storage seam', async () => {
    const storage = createMemoryPictureStorage();
    const library = createPictureLibrary(storage, { maxFrames: 2, maxBytes: 1000 });
    expect(await library.add(record('one', 1))).toEqual([]);
    expect(await library.add(record('two', 2))).toEqual([]);
    expect(await library.add(record('three', 3))).toEqual(['one']);
    expect((await library.list()).map(({ id }) => id)).toEqual(['two', 'three']);
    await library.delete('two');
    expect([...storage.records.keys()]).toEqual(['three']);
  });

  it('keys picture poses per frame and refuses bare or malformed picture keys', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;
    const store = createWidgetPoseStore(storage);
    const pose = (x = 0): SavedUIPose => ({
      position: [x, 1, -1],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    });
    expect(widgetKey('picture', 'pic-1')).toBe('picture:pic-1');
    expect(widgetKey('digital-clock', 'ignored')).toBe('digital-clock');
    expect(store.save('picture:pic-1', pose())).toBe(true);
    expect(store.save('picture:pic-2', pose(1))).toBe(true);
    expect(store.save('picture', pose())).toBe(false);
    expect(store.save('picture:bad id!', pose())).toBe(false);
    expect(store.save('digital-clock:x', pose())).toBe(false);
    expect(Object.keys(store.read()).sort()).toEqual(['picture:pic-1', 'picture:pic-2']);
    expect(store.remove('picture:pic-1')).toBe(true);
    expect(Object.keys(store.read())).toEqual(['picture:pic-2']);
    expect(widgetKeyKind('picture:pic-2')).toBe('picture');
    expect(widgetKeyKind('picture')).toBeUndefined();
  });
});

const image = (width: number, height: number) =>
  ({ source: fakeCanvas(width, height), width, height }) as const;

describe('picture frame widget', () => {
  it.each([
    [1600, 900],
    [900, 1600],
  ])(
    'matches the image aspect for %ix%i and frames it with a thin dark border',
    (width, height) => {
      const widget = createPictureFrameWidget(null, {
        id: 'pic-1',
        image: image(width, height),
        anisotropy: 8,
      });
      const plane = widget.root.getObjectByName('picture-frame-image') as THREE.Mesh;
      const geometry = plane.geometry as THREE.PlaneGeometry;
      expect(geometry.parameters.width / geometry.parameters.height).toBeCloseTo(width / height, 6);
      expect(Math.max(geometry.parameters.width, geometry.parameters.height)).toBeCloseTo(0.6, 6);
      const border = widget.root.getObjectByName('picture-frame-border') as THREE.Mesh;
      const box = border.geometry as THREE.BoxGeometry;
      expect(box.parameters.width - geometry.parameters.width).toBeLessThan(0.06);
      const texture = (plane.material as THREE.MeshBasicMaterial).map as THREE.Texture;
      expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(texture.generateMipmaps).toBe(true);
      expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(texture.anisotropy).toBe(8);
      expect(widget.root.userData).toMatchObject({
        widgetKind: 'picture',
        widgetId: 'pic-1',
        pictureId: 'pic-1',
      });
      expect(widget.root.getObjectByName('picture-close')?.userData.inputAction).toBe(
        'closeWidget',
      );
      const disposeTexture = vi.spyOn(texture, 'dispose');
      widget.dispose();
      expect(disposeTexture).toHaveBeenCalled();
      expect(widget.root.children).toHaveLength(0);
    },
  );

  it('shows the pick-on-the-page placeholder, never a blank frame, when it has no image', () => {
    const widget = createPictureFrameWidget(null);
    expect(widget.root.userData.picturePlaceholder).toBe(true);
    expect(widget.root.getObjectByName('picture-frame-image')).toBeUndefined();
    const placeholder = widget.root.getObjectByName('picture-frame-placeholder');
    expect(placeholder?.userData.labelText).toBe(PICTURE_PLACEHOLDER_TEXT);
    widget.dispose();
  });
});

describe('picture controller', () => {
  const prepared = (name: string, width = 800, height = 600): PreparedPicture => ({
    ...image(width, height),
    name,
    blob: new Blob([new Uint8Array(32)], { type: 'image/webp' }),
  });
  const setup = (
    loaders: Partial<PictureLoaders> = {},
    limits = { maxFrames: 2, maxBytes: 1000 },
  ) => {
    const storage = createMemoryPictureStorage();
    const scene = {
      addPicture: vi.fn((): string[] => []),
      restorePictures: vi.fn(),
      removePicture: vi.fn(),
    };
    const notify = vi.fn();
    let id = 0;
    let clock = 0;
    const controller = createPictureController({
      library: createPictureLibrary(storage, limits),
      scene: () => scene,
      notify,
      createId: () => `pic-${++id}`,
      now: () => ++clock,
      loaders: {
        file: async (file) => prepared(file.name),
        url: async (url) => prepared(url),
        stored: async (_blob, name) => prepared(name),
        ...loaders,
      },
    });
    return { storage, scene, notify, controller };
  };

  it('stores the downscaled blob and shows the frame for a picked file', async () => {
    const { storage, scene, notify, controller } = setup();
    expect(await controller.addFile(new File(['x'], 'cat.png'))).toBe(true);
    expect(scene.addPicture).toHaveBeenCalledWith('pic-1', expect.objectContaining({ width: 800 }));
    expect(storage.records.get('pic-1')?.blob.type).toBe('image/webp');
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies and adds no frame or record when a load fails', async () => {
    const { storage, scene, notify, controller } = setup({
      url: async (url) => {
        throw new PictureLoadError('cors', new URL(url).host);
      },
      file: async () => {
        throw new Error('boom');
      },
    });
    expect(await controller.addUrl(' https://img.example.com/a.png ')).toBe(false);
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Image blocked by CORS: img\.example\.com/),
    );
    expect(await controller.addFile(new File(['x'], 'bad.png'))).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('Image could not be decoded: bad.png');
    expect(scene.addPicture).not.toHaveBeenCalled();
    expect(storage.records.size).toBe(0);
  });

  it('evicts the oldest frame with a notice when the bound is reached', async () => {
    const { storage, scene, notify, controller } = setup();
    for (const name of ['a.png', 'b.png', 'c.png']) await controller.addFile(new File(['x'], name));
    expect(scene.removePicture).toHaveBeenCalledWith('pic-1');
    expect([...storage.records.keys()].sort()).toEqual(['pic-2', 'pic-3']);
    expect(notify).toHaveBeenLastCalledWith(
      'Removed the oldest picture to stay within the picture limit',
    );
  });

  it('still shows the picture when storage fails, with a not-saved notice', async () => {
    const { scene, notify, controller } = setup({}, { maxFrames: 2, maxBytes: 8 });
    expect(await controller.addFile(new File(['x'], 'big.png'))).toBe(true);
    expect(scene.addPicture).toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/^Picture shown but not saved/));
  });

  it('restores stored pictures and deletes the ones that no longer decode', async () => {
    const { storage, scene, notify, controller } = setup({
      stored: async (_blob, name) => {
        if (name === 'broken') throw new PictureLoadError('decode', name);
        return prepared(name);
      },
    });
    await storage.put(record('good', 1));
    await storage.put(record('broken', 2));
    await controller.restore();
    expect(scene.restorePictures).toHaveBeenCalledWith([
      { id: 'good', image: expect.objectContaining({ name: 'good' }) },
    ]);
    expect([...storage.records.keys()]).toEqual(['good']);
    expect(notify).toHaveBeenCalledWith('A saved picture could not be decoded and was removed');
  });

  it('reports frames the scene capped when storage could not evict them', async () => {
    const { scene, notify, controller } = setup({}, { maxFrames: 2, maxBytes: 8 });
    scene.addPicture.mockReturnValueOnce(['pic-0']);
    await controller.addFile(new File(['x'], 'a.png'));
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^Picture shown but not saved.*\. Removed the oldest picture to stay within the picture limit$/,
      ),
    );
  });

  it('runs adds one at a time so the frame cap holds under rapid picks', async () => {
    let active = 0;
    let peak = 0;
    const { storage, controller } = setup({
      file: async (file) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return prepared(file.name);
      },
    });
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((name) => controller.addFile(new File(['x'], name))),
    );
    expect(peak).toBe(1);
    expect([...storage.records.keys()].sort()).toEqual(['pic-3', 'pic-4']);
  });

  it('never shows a restored picture that an add during the restore evicted', async () => {
    let releaseRestore = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const { storage, scene, controller } = setup({
      stored: async (_blob, name) => {
        await gate;
        return prepared(name);
      },
    });
    await storage.put(record('old-1', 1));
    await storage.put(record('old-2', 2));
    const restoring = controller.restore();
    const adding = controller.addFile(new File(['x'], 'new.png'));
    releaseRestore();
    await Promise.all([restoring, adding]);
    // The restore finished first with both stored frames; the add then evicted old-1 from both.
    expect(scene.restorePictures).toHaveBeenCalledBefore(scene.addPicture);
    expect(scene.removePicture).toHaveBeenCalledWith('old-1');
    expect([...storage.records.keys()].sort()).toEqual(['old-2', 'pic-1']);
  });

  it('deletes the blob when a frame is closed', async () => {
    const { storage, controller } = setup();
    await controller.addFile(new File(['x'], 'a.png'));
    controller.closed('pic-1');
    await Promise.resolve();
    await Promise.resolve();
    expect(storage.records.size).toBe(0);
  });
});

describe('IndexedDB picture storage', () => {
  it('rejects every call when IndexedDB is unavailable', async () => {
    const storage = createIndexedDBPictureStorage(undefined);
    await expect(storage.list()).rejects.toThrow(/unavailable/);
    await expect(storage.put(record('a', 1))).rejects.toThrow(/unavailable/);
    await expect(storage.delete('a')).rejects.toThrow(/unavailable/);
  });

  it('rejects when the database will not open, then retries on the next call', async () => {
    let opens = 0;
    const factory = {
      open: () => {
        opens += 1;
        const request = { error: new Error('blocked by policy') } as unknown as IDBOpenDBRequest;
        queueMicrotask(() => request.onerror?.(new Event('error')));
        return request;
      },
    } as unknown as IDBFactory;
    const storage = createIndexedDBPictureStorage(factory);
    await expect(storage.list()).rejects.toThrow('blocked by policy');
    await expect(storage.put(record('a', 1))).rejects.toThrow('blocked by policy');
    expect(opens).toBe(2);
  });

  it('creates the store on upgrade and rejects a failed write transaction', async () => {
    const created: string[] = [];
    const transaction = {
      error: new Error('quota exceeded'),
      objectStore: () => ({
        put: () => {
          const request = {} as IDBRequest;
          queueMicrotask(() => {
            request.onsuccess?.(new Event('success'));
            transaction.onabort?.(new Event('abort'));
          });
          return request;
        },
      }),
    } as unknown as IDBTransaction & { onabort: ((event: Event) => void) | null };
    const db = {
      objectStoreNames: { contains: () => false },
      createObjectStore: (name: string) => created.push(name),
      transaction: () => transaction,
    };
    const factory = {
      open: () => {
        const request = { result: db } as unknown as IDBOpenDBRequest;
        queueMicrotask(() => {
          request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
          request.onsuccess?.(new Event('success'));
        });
        return request;
      },
    } as unknown as IDBFactory;
    const storage = createIndexedDBPictureStorage(factory);
    await expect(storage.put(record('a', 1))).rejects.toThrow('quota exceeded');
    expect(created).toEqual(['pictures']);
  });
});

describe('picture picker', () => {
  it('ignores Add, Enter and file picks while a pick is still loading', async () => {
    const sidebar = document.createElement('aside');
    let finish = (_shown: boolean) => {};
    const onUrl = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const onFile = vi.fn(async () => true);
    const section = mountPicturePicker(sidebar, { onUrl, onFile });
    const url = section.querySelector('[data-picture-url]') as HTMLInputElement;
    const add = section.querySelector('[data-action="add-picture-url"]') as HTMLButtonElement;
    url.value = 'https://img.example.com/a.png';
    add.click();
    url.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    url.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const file = section.querySelector('[data-picture-file]') as HTMLInputElement;
    Object.defineProperty(file, 'files', { value: [new File(['x'], 'a.png')], configurable: true });
    file.dispatchEvent(new Event('change'));
    expect(onUrl).toHaveBeenCalledTimes(1);
    expect(onFile).not.toHaveBeenCalled();
    expect(add.disabled).toBe(true);
    finish(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(add.disabled).toBe(false);
    expect(url.value).toBe('');
    expect(section.querySelector('.picture-pick-row')?.getAttribute('style')).toBeNull();
  });
});
