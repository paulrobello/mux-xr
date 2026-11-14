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

function makeHost(features?: string[]): FocusQuadLayerHost {
  created = [];
  destroyed = [];
  textures = [];
  sessionLayers = [{ id: 'base' }];
  surfaceVisible = [];
  glCalls = [];
  swapBuffers = false;
  const canvas = { width: 512, height: 256 } as unknown as HTMLCanvasElement;
  const surface = { canvas, dirtyRows: new Uint8Array([0, 0]) };
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
    return { colorTexture: textures[textures.length - 1] };
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
      value: { createQuadLayer, getSubImage },
    });
    Object.defineProperty(globalThis, 'XRWebGLBinding', {
      value: stub,
      configurable: true,
    });
  }
  const gl = {
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texSubImage2D: vi.fn((_target, _level, x, y, w, h, _format, _type, source) => {
      glCalls.push([x, y, w, h, source === undefined ? null : 'canvas']);
    }),
  };
  return {
    surface,
    planeSize: { width: 1.2, height: 0.8 },
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
    expect(sessionLayers[1]).toHaveProperty('transform');
    expect(created[0]).toMatchObject({
      width: 1.2,
      height: 0.8,
      clearOnAccess: false,
      viewPixelWidth: 512,
      viewPixelHeight: 256,
      space: { id: 'ref-space' },
    });
    expect(surfaceVisible).toEqual([false]);
  });

  it('uploads the full canvas on the first frame and on swapchain switches', () => {
    const layer = createFocusQuadLayer(makeHost());
    layer.activate();
    layer.update({ frame: 1 });
    swapBuffers = true;
    layer.update({ frame: 2 });
    expect(glCalls).toEqual([
      [0, 0, 512, 256, 'canvas'],
      [0, 0, 512, 256, 'canvas'],
    ]);
  });

  it('uploads only dirty row bands while the swapchain returns the same buffer', () => {
    const host = makeHost();
    const layer = createFocusQuadLayer(host);
    layer.activate();
    layer.update({ frame: 1 });
    glCalls.length = 0;
    (host.surface.dirtyRows as Uint8Array).set([0, 1]);
    layer.update({ frame: 2 });
    expect(glCalls).toEqual([[0, 0, 512, 128, 'canvas']]);
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
