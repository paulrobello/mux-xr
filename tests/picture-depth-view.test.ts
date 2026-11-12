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

import type { PictureDepthEstimator, PictureDepthResult } from '../src/host-picture-depth';
import { createPictureController } from '../src/workspace/pictures';
import {
  DEFAULT_DEPTH_VIEW,
  depthDisplacement,
  depthFailureNotice,
  normalizeDepthView,
  stepDepthStrength,
} from '../src/xr/picture-depth';
import { createPictureFrameWidget } from '../src/xr/picture-frame';
import type { PictureImage, PreparedPicture } from '../src/xr/picture-image';
import {
  createMemoryPictureStorage,
  createPictureLibrary,
  planEviction,
} from '../src/xr/picture-store';

const canvas = (width: number, height: number) =>
  ({ width, height, getContext: () => null }) as unknown as HTMLCanvasElement;
const image = (width: number, height: number): PictureImage => ({
  source: canvas(width, height),
  width,
  height,
});
const depthBlob = () => new Blob([new Uint8Array(16)], { type: 'image/png' });

describe('depth view', () => {
  it('defaults to 3D on at 0.25, inward, stretched edges', () => {
    expect(DEFAULT_DEPTH_VIEW).toEqual({
      enabled: true,
      strength: 0.25,
      mode: 'inward',
      edges: 'stretch',
    });
  });

  it('repairs a stored view and clamps strength to 0.05 steps', () => {
    expect(normalizeDepthView(undefined)).toEqual(DEFAULT_DEPTH_VIEW);
    expect(normalizeDepthView({ enabled: 'yes', strength: 7, mode: 'x', edges: 'cut' })).toEqual({
      ...DEFAULT_DEPTH_VIEW,
      strength: 1,
      edges: 'cut',
    });
    expect(normalizeDepthView({ strength: Number.NaN, mode: 'popout' })).toEqual({
      ...DEFAULT_DEPTH_VIEW,
      mode: 'popout',
    });
    const view = normalizeDepthView({ strength: 0.05 });
    expect(stepDepthStrength(view, -1).strength).toBe(0.05);
    expect(stepDepthStrength(view, 3).strength).toBeCloseTo(0.2, 10);
  });

  it('scales displacement with the frame size and drops to zero when off', () => {
    expect(depthDisplacement(DEFAULT_DEPTH_VIEW, 0.9)).toBeCloseTo(0.25, 10);
    expect(depthDisplacement(DEFAULT_DEPTH_VIEW, 0.6)).toBeCloseTo(0.25 * (0.6 / 0.9), 10);
    expect(depthDisplacement({ ...DEFAULT_DEPTH_VIEW, enabled: false }, 0.6)).toBe(0);
  });

  it('names the fix for each failure', () => {
    expect(depthFailureNotice('disabled')).toMatch(/--picture-depth on/);
    expect(depthFailureNotice('no-secret')).toMatch(/Host clipboard/);
    expect(depthFailureNotice('unavailable')).toMatch(/Could not reach the Mac/);
  });
});

describe('picture store depth', () => {
  it('counts depth bytes toward the storage cap', () => {
    const records = [
      { id: 'a', createdAt: 1, blob: { size: 40 }, depth: { size: 40 } },
      { id: 'b', createdAt: 2, blob: { size: 10 } },
    ];
    expect(planEviction(records, 11, { maxFrames: 8, maxBytes: 100 })).toEqual(['a']);
    expect(planEviction(records, 10, { maxFrames: 8, maxBytes: 100 })).toEqual([]);
    expect(planEviction(records, 10, { maxFrames: 8, maxBytes: 200 })).toEqual([]);
  });

  it('updates an existing record and refuses a missing one', async () => {
    const storage = createMemoryPictureStorage();
    const library = createPictureLibrary(storage);
    await library.add({
      id: 'p',
      name: 'p',
      blob: new Blob([new Uint8Array(8)], { type: 'image/webp' }),
      width: 8,
      height: 8,
      createdAt: 1,
    });
    const depth = depthBlob();
    expect(await library.update('p', { depth })).toBe(true);
    expect(
      await library.update('p', { depthView: { ...DEFAULT_DEPTH_VIEW, mode: 'popout' } }),
    ).toBe(true);
    expect(storage.records.get('p')).toMatchObject({ depth, depthView: { mode: 'popout' } });
    expect(await library.update('gone', { depth })).toBe(false);
    expect(storage.records.has('gone')).toBe(false);
  });
});

describe('picture controller depth', () => {
  const prepared = (name: string): PreparedPicture => ({
    ...image(800, 600),
    name,
    blob: new Blob([new Uint8Array(32)], { type: 'image/webp' }),
  });
  const setup = (estimate?: PictureDepthEstimator) => {
    const storage = createMemoryPictureStorage();
    const scene = {
      addPicture: vi.fn((): string[] => []),
      restorePictures: vi.fn(),
      removePicture: vi.fn(),
      setPictureDepth: vi.fn(),
    };
    const notify = vi.fn();
    let id = 0;
    const controller = createPictureController({
      library: createPictureLibrary(storage),
      scene: () => scene,
      notify,
      createId: () => `pic-${++id}`,
      depth: estimate,
      loaders: {
        file: async (file) => prepared(file.name),
        url: async (url) => prepared(url),
        stored: async (_blob, name) => prepared(name),
      },
    });
    return { storage, scene, notify, controller };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const ok = (): PictureDepthResult => ({ ok: true, depth: depthBlob(), width: 800, height: 600 });

  it('makes a depth map for a new picture in the background and stores it', async () => {
    const estimate = vi.fn(async () => ok());
    const { storage, scene, notify, controller } = setup(estimate);
    await controller.addFile(new File(['x'], 'cat.png'));
    await settle();
    expect(estimate).toHaveBeenCalledWith(storage.records.get('pic-1')?.blob);
    expect(scene.setPictureDepth).toHaveBeenCalledWith('pic-1', expect.anything());
    expect(storage.records.get('pic-1')?.depth?.type).toBe('image/png');
    expect(notify).not.toHaveBeenCalled();
  });

  it('never writes a frame closed while its depth was made back into storage', async () => {
    let finish: (result: PictureDepthResult) => void = () => {};
    const estimate = vi.fn(
      () =>
        new Promise<PictureDepthResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { storage, scene, controller } = setup(estimate);
    await controller.addFile(new File(['x'], 'cat.png'));
    await settle();
    controller.closed('pic-1');
    finish(ok());
    await settle();
    await settle();
    expect(storage.records.has('pic-1')).toBe(false);
    expect(scene.setPictureDepth).not.toHaveBeenCalled();
  });

  it('drops a depth map whose pixels disagree with the reply header', async () => {
    const estimate = vi.fn(
      async (): Promise<PictureDepthResult> => ({
        ok: true,
        depth: depthBlob(),
        width: 4,
        height: 4,
      }),
    );
    const { storage, scene, controller } = setup(estimate);
    await controller.addFile(new File(['x'], 'cat.png'));
    await settle();
    expect(scene.setPictureDepth).not.toHaveBeenCalled();
    expect(storage.records.get('pic-1')?.depth).toBeUndefined();
  });

  it('stays quiet in the background on an unpaired Mac but reports when the user asks', async () => {
    const estimate = vi.fn(
      async (): Promise<PictureDepthResult> => ({ ok: false, code: 'disabled' }),
    );
    const { notify, controller } = setup(estimate);
    await controller.addFile(new File(['x'], 'cat.png'));
    await settle();
    expect(notify).not.toHaveBeenCalled();
    controller.setDepthView('pic-1', { ...DEFAULT_DEPTH_VIEW, strength: 0.5 });
    await settle();
    await settle();
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(depthFailureNotice('disabled'));
  });

  it('stores the view and asks for no depth when 3D is turned off', async () => {
    const estimate = vi.fn(
      async (): Promise<PictureDepthResult> => ({ ok: false, code: 'disabled' }),
    );
    const { storage, controller } = setup(estimate);
    await controller.addFile(new File(['x'], 'cat.png'));
    await settle();
    controller.setDepthView('pic-1', { ...DEFAULT_DEPTH_VIEW, enabled: false });
    await settle();
    await settle();
    expect(storage.records.get('pic-1')?.depthView?.enabled).toBe(false);
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('restores stored depth and view, and remakes depth only where it is missing', async () => {
    const estimate = vi.fn(async () => ok());
    const { storage, scene, controller } = setup(estimate);
    const blob = new Blob([new Uint8Array(8)], { type: 'image/webp' });
    const view = { ...DEFAULT_DEPTH_VIEW, mode: 'popout' as const };
    storage.records.set('a', {
      id: 'a',
      name: 'a',
      blob,
      width: 8,
      height: 8,
      createdAt: 1,
      depth: depthBlob(),
      depthView: view,
    });
    storage.records.set('b', { id: 'b', name: 'b', blob, width: 8, height: 8, createdAt: 2 });
    await controller.restore();
    await settle();
    const restored = scene.restorePictures.mock.calls[0]?.[0] as Array<{
      id: string;
      depth?: PictureImage;
      depthView: unknown;
    }>;
    expect(restored.map(({ id, depth, depthView }) => [id, Boolean(depth), depthView])).toEqual([
      ['a', true, view],
      ['b', false, DEFAULT_DEPTH_VIEW],
    ]);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(scene.setPictureDepth).toHaveBeenCalledWith('b', expect.anything());
  });
});

describe('picture frame 3D', () => {
  const frame = (onDepthView = vi.fn()) => {
    const widget = createPictureFrameWidget(null, {
      id: 'pic-1',
      image: image(1600, 900),
      onDepthView,
    });
    return { widget, onDepthView };
  };
  const press = (widget: ReturnType<typeof frame>['widget'], name: string) => {
    const target = widget.root.getObjectByName(name);
    if (!target) throw new Error(`${name} missing`);
    expect(target.userData.inputAction).toBe('widgetControl');
    widget.activate?.(target);
  };

  it('stays flat with the solid border until a depth map arrives', () => {
    const { widget } = frame();
    expect(widget.root.getObjectByName('picture-frame-relief')).toBeUndefined();
    expect(widget.root.getObjectByName('picture-frame-border')?.visible).toBe(true);
    expect(widget.root.getObjectByName('picture-frame-ring')?.visible).toBe(false);
    widget.dispose();
  });

  it('shows an unpickable relief and an open border once depth arrives', () => {
    const { widget } = frame();
    const depth = image(4, 4);
    widget.setPictureDepth?.(depth);
    const relief = widget.root.getObjectByName('picture-frame-relief') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;
    expect(relief.visible).toBe(true);
    expect(relief.frustumCulled).toBe(false);
    const hits: THREE.Intersection[] = [];
    relief.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
    const flat = widget.root.getObjectByName('picture-frame-image') as THREE.Mesh;
    expect((flat.material as THREE.Material).visible).toBe(false);
    expect(widget.root.getObjectByName('picture-frame-border')?.visible).toBe(false);
    expect(widget.root.getObjectByName('picture-frame-ring')?.visible).toBe(true);
    const depthTexture = relief.material.uniforms.depthMap.value as THREE.Texture;
    expect(depthTexture.colorSpace).toBe(THREE.NoColorSpace);
    expect(depthTexture.generateMipmaps).toBe(false);
    expect(relief.material.uniforms.depthAnchor.value).toBe(1);
    expect(relief.material.uniforms.depthScale.value).toBeCloseTo(0.25 * (0.6 / 0.9), 10);
    const disposeDepth = vi.spyOn(depthTexture, 'dispose');
    widget.dispose();
    expect(disposeDepth).toHaveBeenCalled();
    expect(depth.source.width).toBe(0);
  });

  it('changes every option from the panel and reports each change', () => {
    const { widget, onDepthView } = frame();
    widget.setPictureDepth?.(image(4, 4));
    const relief = widget.root.getObjectByName('picture-frame-relief') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;
    const options = widget.root.getObjectByName('picture-depth-options');
    expect(options?.visible).toBe(false);
    press(widget, 'picture-depth');
    expect(options?.visible).toBe(true);

    press(widget, 'picture-depth-stronger');
    expect(onDepthView).toHaveBeenLastCalledWith(expect.objectContaining({ strength: 0.3 }));
    expect(widget.root.getObjectByName('picture-depth-strength')?.userData.labelText).toBe(
      'Depth 0.30',
    );
    press(widget, 'picture-depth-weaker');
    expect(onDepthView).toHaveBeenLastCalledWith(expect.objectContaining({ strength: 0.25 }));

    press(widget, 'picture-depth-mode');
    expect(onDepthView).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'popout' }));
    expect(relief.material.uniforms.depthAnchor.value).toBe(0.5);
    // Pop out reaches past the controls, so they draw on top of the picture.
    const close = widget.root.getObjectByName('picture-close') as THREE.Mesh;
    expect((close.material as THREE.Material).depthTest).toBe(false);

    press(widget, 'picture-depth-edges');
    expect(onDepthView).toHaveBeenLastCalledWith(expect.objectContaining({ edges: 'cut' }));
    expect(relief.material.uniforms.cutThreshold.value).toBeLessThan(1);

    press(widget, 'picture-depth-enabled');
    expect(onDepthView).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(relief.visible).toBe(false);
    expect(widget.root.getObjectByName('picture-frame-border')?.visible).toBe(true);
    expect((close.material as THREE.Material).depthTest).toBe(true);
    widget.dispose();
  });

  it.each([
    [1600, 900],
    [900, 1600],
  ])('fits every option label on a %ix%i frame without truncating it', (width, height) => {
    const widget = createPictureFrameWidget(null, { id: 'pic-3', image: image(width, height) });
    const panel = widget.root.getObjectByName('picture-depth-options');
    const texts: string[] = [];
    panel?.traverse((child) => {
      const text = child.userData.labelTextObject as { text?: string } | undefined;
      if (text?.text) texts.push(text.text);
    });
    expect(texts).toContain('Depth 0.25');
    expect(texts.filter((text) => text.includes('…'))).toEqual([]);
    widget.dispose();
  });

  it('puts change and 3D on the top edge with close, off the picture', () => {
    const { widget } = frame();
    const plane = widget.root.getObjectByName('picture-frame-image') as THREE.Mesh;
    const { width, height } = (plane.geometry as THREE.PlaneGeometry).parameters;
    for (const name of ['picture-change', 'picture-depth', 'picture-close'])
      expect(widget.root.getObjectByName(name)?.position.y).toBeGreaterThan(height / 2);
    for (const name of ['picture-change', 'picture-close'])
      expect(Math.abs(widget.root.getObjectByName(name)?.position.x ?? 0)).toBeGreaterThan(
        width / 2,
      );
    widget.dispose();
  });

  it('opens with a stored view and depth', () => {
    const widget = createPictureFrameWidget(null, {
      id: 'pic-2',
      image: image(900, 1600),
      depth: image(4, 4),
      depthView: { ...DEFAULT_DEPTH_VIEW, mode: 'popout', strength: 0.5 },
    });
    const relief = widget.root.getObjectByName('picture-frame-relief') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.ShaderMaterial
    >;
    expect(relief.material.uniforms.depthAnchor.value).toBe(0.5);
    expect(relief.material.uniforms.depthScale.value).toBeCloseTo(0.5 * (0.6 / 0.9), 10);
    widget.dispose();
  });
});
