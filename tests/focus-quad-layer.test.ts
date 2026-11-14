import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFocusQuadLayer,
  type FocusQuadLayerHost,
  supportsQuadLayers,
} from '../src/xr/focus-quad-layer';

let created: Record<string, unknown>[];
let destroyed: { destroyed: boolean }[];
let textures: { id: number }[];
let sessionLayers: unknown[];
let surfaceVisible: boolean[];
let glCalls: unknown[][];
let swapBuffers = false;
let viewport = { x: 0, y: 0, width: 512, height: 256 };

function makeHost(features?: string[], cylinderSupported = true): FocusQuadLayerHost {
  created = [];
  destroyed = [];
  textures = [];
  sessionLayers = [{ id: 'base' }];
  surfaceVisible = [];
  glCalls = [];
  swapBuffers = false;
  viewport = { x: 0, y: 0, width: 512, height: 256 };
  const canvas = { width: 512, height: 256 } as unknown as HTMLCanvasElement;
  const surface = { canvas, revision: 0 };
  const createQuadLayer = vi.fn((init: Record<string, unknown>) => {
    const marker = { destroyed: false };
    destroyed.push(marker);
    created.push(init);
    return {
      transform: init.transform,
      destroy: vi.fn(() => {
        marker.destroyed = true;
      }),
    };
  });
  const getSubImage = vi.fn(() => {
    if (swapBuffers || textures.length === 0) {
      textures.push({ id: textures.length });
    }
    return { colorTexture: textures[textures.length - 1], viewport };
  });
  const session = {
    renderState: { layers: sessionLayers },
    updateRenderState: vi.fn((init: { layers?: unknown[] }) => {
      if (init.layers) {
        sessionLayers.length = 0;
        sessionLayers.push(...init.layers);
      }
    }),
    enabledFeatures: features ?? ['local-floor', 'layers'],
    end: vi.fn(async () => undefined),
  };
  if (features === undefined) {
    const stub = function StubBinding() {};
    Object.defineProperty(stub, 'prototype', {
      value: {
        createQuadLayer,
        getSubImage,
        ...(cylinderSupported ? { createCylinderLayer: createQuadLayer } : {}),
      },
    });
    Object.defineProperty(globalThis, 'XRWebGLBinding', {
      value: stub,
      configurable: true,
    });
  }
  const gl = {
    getParameter: vi.fn(() => null),
    getError: vi.fn(() => 0),
    bindTexture: vi.fn(),
    createTexture: vi.fn(() => ({ id: 'owned-texture' })),
    deleteTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    createFramebuffer: vi.fn(() => ({ id: 'owned-framebuffer' })),
    deleteFramebuffer: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    copyTexSubImage2D: vi.fn((_target, _level, x, y, sourceX, sourceY, w, h) => {
      glCalls.push([x, y, sourceX, sourceY, w, h]);
    }),
  };
  return {
    surface,
    planeSize: () => ({ width: 1.2, height: 0.8 }),
    worldTransform: () => ({
      position: { x: 0, y: 1.4, z: -0.6 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    }),
    setSurfaceVisible: vi.fn((visible: boolean) => {
      surfaceVisible.push(visible);
    }),
    session,
    space: { id: 'ref-space' },
    gl,
  } as unknown as FocusQuadLayerHost;
}

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'XRWebGLBinding');
  class XRRigidTransformStub {
    position: unknown;
    orientation: unknown;
    constructor(position?: unknown, orientation?: unknown) {
      this.position = position;
      this.orientation = orientation;
    }
  }
  Object.defineProperty(globalThis, 'XRRigidTransform', {
    value: XRRigidTransformStub,
    configurable: true,
  });
});

describe('supportsQuadLayers', () => {
  it('is false without the layers feature', () => {
    expect(supportsQuadLayers({ enabledFeatures: ['local-floor'] })).toBe(false);
  });

  it('is false without XRWebGLBinding', () => {
    expect(supportsQuadLayers({ enabledFeatures: ['layers'] })).toBe(false);
  });
});

describe('createFocusQuadLayer', () => {
  it('stays unsupported and inert without XRWebGLBinding', () => {
    const layer = createFocusQuadLayer(makeHost(['local-floor', 'layers']));
    expect(layer.supported).toBe(false);
    layer.activate();
    expect(created).toHaveLength(0);
    expect(surfaceVisible).toEqual([]);
  });

  it('activates: creates the layer, registers it, hides the mesh surface', () => {
    const layer = createFocusQuadLayer(makeHost());
    layer.activate();
    expect(created).toHaveLength(1);
    expect(sessionLayers).toHaveLength(2);
    expect(sessionLayers[0]).toHaveProperty('transform');
    expect(sessionLayers[1]).toEqual({ id: 'base' });
    expect(created[0]).toMatchObject({
      width: 0.6,
      height: 0.4,
      clearOnAccess: false,
      layout: 'mono',
      textureType: 'texture',
      viewPixelWidth: 512,
      viewPixelHeight: 256,
      space: { id: 'ref-space' },
    });
    expect(surfaceVisible).toEqual([]);
    layer.update({ frame: 1 });
    expect(surfaceVisible).toEqual([false]);
  });

  it.each([Math.PI / 3, Math.PI])(
    'matches the pane geometry for a %f radian cylinder',
    (curvature) => {
      const host = makeHost();
      const orientation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 2,
      );
      const position = new THREE.Vector3(1, 2, 3);
      const radius = 1.2 / curvature;
      const layer = createFocusQuadLayer({
        ...host,
        curvature,
        worldTransform: () => ({ position, quaternion: orientation }),
      });
      layer.activate();
      expect(created[0]).toMatchObject({ radius, centralAngle: curvature, aspectRatio: 1.2 / 0.8 });
      expect(created[0]).not.toHaveProperty('width');
      const transform = created[0].transform as XRRigidTransform;
      expect(transform.position.x).toBeCloseTo(position.x + radius);
      expect(transform.position.y).toBeCloseTo(position.y);
      expect(transform.position.z).toBeCloseTo(position.z);
      expect(position.toArray()).toEqual([1, 2, 3]);
      layer.update({ frame: 1 });
      expect(glCalls).toEqual([[0, 0, 0, 0, 512, 256]]);
      expect(surfaceVisible).toEqual([false]);
    },
  );

  it('keeps the warped mesh available on browsers without cylinders', () => {
    const layer = createFocusQuadLayer({ ...makeHost(undefined, false), curvature: Math.PI / 3 });
    expect(layer.supported).toBe(false);
    layer.activate();
    expect(created).toHaveLength(0);
    expect(surfaceVisible).toEqual([]);
  });

  it('applies the flat physical correction without changing texture resolution', () => {
    const layer = createFocusQuadLayer(makeHost());
    layer.activate();
    expect(created[0]).toMatchObject({
      width: 0.6,
      height: 0.4,
      viewPixelWidth: 512,
      viewPixelHeight: 256,
    });
  });

  it('copies the complete GPU image each frame without reuploading an unchanged canvas', () => {
    const host = makeHost();
    const layer = createFocusQuadLayer(host);
    layer.activate();
    layer.update({ frame: 1 });
    layer.update({ frame: 2 });
    swapBuffers = true;
    layer.update({ frame: 3 });
    expect(textures).toHaveLength(2);
    expect(glCalls).toEqual([
      [0, 0, 0, 0, 512, 256],
      [0, 0, 0, 0, 512, 256],
      [0, 0, 0, 0, 512, 256],
    ]);
    expect(host.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(host.gl.texSubImage2D).not.toHaveBeenCalled();
  });

  it('updates the GPU cache on a new revision and copies it at the viewport offset', () => {
    const host = makeHost();
    const layer = createFocusQuadLayer(host);
    layer.activate();
    viewport = { x: 16, y: 32, width: 512, height: 256 };
    layer.update({ frame: 1 });
    (host.surface as { revision: number }).revision++;
    layer.update({ frame: 2 });
    expect(glCalls).toEqual([
      [16, 32, 0, 0, 512, 256],
      [16, 32, 0, 0, 512, 256],
    ]);
    expect(host.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(host.gl.texSubImage2D).toHaveBeenCalledTimes(1);
  });

  it('scales the entire canvas when the runtime allocates a smaller or moved viewport', () => {
    const host = makeHost();
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage, clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    try {
      const layer = createFocusQuadLayer(host);
      layer.activate();
      viewport = { x: 11, y: 17, width: 384, height: 192 };
      layer.update({ frame: 1 });
      layer.update({ frame: 2 });
      expect(glCalls).toEqual([
        [11, 17, 0, 0, 384, 192],
        [11, 17, 0, 0, 384, 192],
      ]);
      expect(drawImage).toHaveBeenCalledWith(host.surface.canvas, 0, 0, 384, 192);
      viewport = { x: 19, y: 17, width: 384, height: 192 };
      layer.update({ frame: 3 });
      expect(glCalls.at(-1)).toEqual([19, 17, 0, 0, 384, 192]);
      expect(drawImage).toHaveBeenCalledTimes(1);
      viewport = { x: 19, y: 17, width: 256, height: 128 };
      layer.update({ frame: 4 });
      expect(glCalls.at(-1)).toEqual([19, 17, 0, 0, 256, 128]);
      expect(drawImage).toHaveBeenCalledTimes(2);
    } finally {
      getContext.mockRestore();
    }
  });

  it('keeps the pane visible while the compositor layer is absent', () => {
    const layer = createFocusQuadLayer(makeHost());
    layer.activate();
    layer.update({ frame: 1 });
    const [compositor] = sessionLayers.splice(0, 1);
    layer.update({ frame: 2 });
    expect(surfaceVisible).toEqual([false, true]);
    expect(glCalls).toHaveLength(1);
    sessionLayers.unshift(compositor);
    layer.update({ frame: 3 });
    expect(surfaceVisible.at(-1)).toBe(false);
    expect(glCalls).toHaveLength(2);
  });

  it('restores renderer state and releases owned GPU resources when the copy fails', () => {
    const host = makeHost();
    const boundTexture = { id: 'three-texture' };
    const boundFramebuffer = { id: 'three-framebuffer' };
    vi.mocked(host.gl.getParameter).mockImplementation((parameter) => {
      if (parameter === 0x8069) return boundTexture;
      if (parameter === 0x8caa) return boundFramebuffer;
      if (parameter === 0x9243) return 0x9244;
      return parameter === 0x9241;
    });
    vi.mocked(host.gl.getError).mockReturnValue(0x0502);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const layer = createFocusQuadLayer(host);
      layer.activate();
      layer.update({ frame: 1 });
      expect(host.gl.bindTexture).toHaveBeenLastCalledWith(0x0de1, boundTexture);
      expect(host.gl.bindFramebuffer).toHaveBeenLastCalledWith(0x8ca8, boundFramebuffer);
      expect(vi.mocked(host.gl.pixelStorei).mock.calls.slice(-3)).toEqual([
        [0x9240, false],
        [0x9241, true],
        [0x9243, 0x9244],
      ]);
      expect(host.gl.deleteTexture).toHaveBeenCalledWith({ id: 'owned-texture' });
      expect(host.gl.deleteFramebuffer).toHaveBeenCalledWith({ id: 'owned-framebuffer' });
      expect(sessionLayers).toEqual([{ id: 'base' }]);
      expect(surfaceVisible).toEqual([true]);
    } finally {
      warn.mockRestore();
    }
  });

  it('deactivate destroys the layer, unregisters it, and restores the mesh', () => {
    const layer = createFocusQuadLayer(makeHost());
    layer.activate();
    layer.deactivate();
    expect(destroyed.map((marker) => marker.destroyed)).toEqual([true]);
    expect(sessionLayers).toHaveLength(1);
    expect(surfaceVisible.at(-1)).toBe(true);
  });

  it('recreates the layer when the terminal canvas changed size', () => {
    const host = makeHost();
    const layer = createFocusQuadLayer(host);
    layer.activate();
    const canvas = (host.surface as { canvas: HTMLCanvasElement }).canvas;
    canvas.width = 1024;
    layer.notifyCanvasResized();
    expect(created).toHaveLength(2);
    expect(destroyed.map((marker) => marker.destroyed)).toEqual([true, false]);
    expect(created[1].viewPixelWidth).toBe(1024);
  });
});
