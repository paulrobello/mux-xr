import * as THREE from 'three';
import type { TerminalTextureSurface } from './terminal-texture';

/**
 * Focused-terminal composition layer (WebXR layers feature, immersive-vr
 * only). While active, the focused pane's terminal plane stops writing color
 * and the compositor samples a quad or cylinder layer
 * instead. Background panes keep their mesh textures, so gaze-priority LOD,
 * fades, and transforms are untouched.
 *
 * Render path: the painter's 2D canvas uploads into the layer's swapchain
 * texture via texSubImage2D — a full upload when the swapchain hands back a
 * different buffer, dirty-row bands otherwise.
 */

export interface XrLayerGl {
  getParameter(pname: number): unknown;
  bindTexture(target: number, texture: WebGLTexture | null): void;
  pixelStorei(pname: number, value: boolean | number): void;
  texSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    width: number,
    height: number,
    format: number,
    type: number,
    source: TexImageSource,
  ): void;
}

export interface XrQuadLayerLike {
  transform: unknown;
  destroy(): void;
}

type LayerViewport = Pick<XRViewport, 'x' | 'y' | 'width' | 'height'>;

interface TerminalLayerInit {
  transform: XRRigidTransform;
  space: unknown;
  viewPixelWidth: number;
  viewPixelHeight: number;
  clearOnAccess: false;
  layout: 'mono';
  textureType: 'texture';
}

export interface XrWebGlBindingLike {
  createQuadLayer(init: TerminalLayerInit & { width: number; height: number }): XrQuadLayerLike;
  createCylinderLayer?(
    init: TerminalLayerInit & {
      radius: number;
      centralAngle: number;
      aspectRatio: number;
    },
  ): XrQuadLayerLike;
  getSubImage(
    layer: XrQuadLayerLike,
    frame: unknown,
  ): {
    colorTexture: WebGLTexture;
    viewport: LayerViewport;
  };
}

interface XrSessionLayerApi {
  renderState: { layers: unknown[] };
  updateRenderState(init: { layers?: unknown[] }): void;
  enabledFeatures?: string[];
}

export interface FocusQuadLayerHost {
  /** Terminal surface for the focused pane; its dirtyRows drive partial uploads. */
  readonly surface: TerminalTextureSurface;
  /** World-space size of the terminal plane in meters. */
  readonly planeSize: () => { width: number; height: number };
  /** The effective horizontal warp in radians, fixed for the lifetime of this layer host. */
  readonly curvature?: number;
  /** World transform of the center of the screen, read every frame. */
  readonly worldTransform: () => {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  };
  /** Suppressed while the layer composites so the mesh does not double-draw. */
  readonly setSurfaceVisible: (visible: boolean) => void;
  readonly session: XrSessionLayerApi & { end: () => Promise<void> };
  readonly space: unknown;
  readonly gl: XrLayerGl;
}

export interface FocusQuadLayer {
  /** False when the session lacks the layers feature or XRWebGLBinding. */
  readonly supported: boolean;
  activate(): void;
  /** Call every rendered frame while active; pass the current XRFrame. */
  update(frame: unknown): void;
  deactivate(): void;
  /** Recreates the layer when the terminal canvas changed pixel size. */
  notifyCanvasResized(): void;
  dispose(): void;
}

const GL_TEXTURE_2D = 0x0de1;
/**
 * The tested Quest Browser draws a flat quad about twice the requested extent.
 * A half-size declaration matches the scene aperture. Cylinders use arc geometry.
 */
const QUAD_PHYSICAL_SCALE = 0.5;
const GL_TEXTURE_BINDING_2D = 0x8069;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;
const GL_UNPACK_FLIP_Y_WEBGL = 0x9240;
const GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
const GL_UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
const GL_NONE = 0;

export function supportsQuadLayers(session: { enabledFeatures?: string[] }): boolean {
  return (
    typeof XRWebGLBinding !== 'undefined' &&
    'createQuadLayer' in XRWebGLBinding.prototype &&
    Array.isArray(session.enabledFeatures) &&
    session.enabledFeatures.includes('layers')
  );
}

export function createFocusQuadLayer(host: FocusQuadLayerHost): FocusQuadLayer {
  const curvature = host.curvature ?? 0;
  const supported =
    supportsQuadLayers(host.session) &&
    (curvature === 0 || typeof XRWebGLBinding.prototype.createCylinderLayer === 'function');
  const cylinderOffset = new THREE.Vector3();
  const binding: XrWebGlBindingLike | null = createBinding();
  let layer: XrQuadLayerLike | null = null;
  let active = false;
  let lastTexture: WebGLTexture | null = null;
  let lastViewport: LayerViewport | null = null;

  function createBinding(): XrWebGlBindingLike | null {
    if (!supported) return null;
    const ctor = XRWebGLBinding as unknown as new (
      session: unknown,
      context: unknown,
    ) => XrWebGlBindingLike;
    try {
      return new ctor(host.session, host.gl);
    } catch (error) {
      console.warn('Terminal XR binding unavailable', error);
      return null;
    }
  }

  let lastWidth = 0;
  let lastHeight = 0;
  let baseLayers: unknown[] = [];
  const destroyLayer = (): void => {
    const previous = layer;
    layer = null;
    lastTexture = null;
    lastViewport = null;
    if (previous) {
      try {
        host.session.updateRenderState({ layers: baseLayers });
      } catch {
        /* The session may have ended. */
      }
      previous.destroy();
    }
  };

  const buildLayer = (): void => {
    if (!binding) return;
    const { width, height } = host.planeSize();
    const radius = curvature ? width / curvature : 0;
    const init: TerminalLayerInit = {
      transform: rigidTransform(host.worldTransform(), radius),
      space: host.space,
      viewPixelWidth: canvasWidth(),
      viewPixelHeight: canvasHeight(),
      clearOnAccess: false,
      layout: 'mono',
      textureType: 'texture',
    };
    const next = radius
      ? binding.createCylinderLayer?.({
          ...init,
          radius,
          centralAngle: curvature,
          aspectRatio: width / height,
        })
      : binding.createQuadLayer({
          ...init,
          width: width * QUAD_PHYSICAL_SCALE,
          height: height * QUAD_PHYSICAL_SCALE,
        });
    if (!next) return;
    const previous = layer;
    try {
      host.session.updateRenderState({ layers: [next, ...baseLayers] });
    } catch (error) {
      next.destroy();
      throw error;
    }
    layer = next;
    previous?.destroy();
    layerPixelW = canvasWidth();
    layerPixelH = canvasHeight();
    lastWidth = width;
    lastHeight = height;
    lastTexture = null;
    lastViewport = null;
  };

  const rigidTransform = (
    pose: ReturnType<FocusQuadLayerHost['worldTransform']>,
    radius: number,
  ): XRRigidTransform => {
    // WebXR centers the cylinder at its axis, with the midpoint of its arc at local -Z.
    cylinderOffset.set(0, 0, radius).applyQuaternion(pose.quaternion).add(pose.position);
    return new XRRigidTransform(
      { x: cylinderOffset.x, y: cylinderOffset.y, z: cylinderOffset.z },
      { x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w },
    );
  };

  const canvasWidth = (): number => host.surface.canvas.width;
  const canvasHeight = (): number => host.surface.canvas.height;

  const applyUnpackState = (gl: XrLayerGl): void => {
    gl.pixelStorei(GL_UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(GL_UNPACK_COLORSPACE_CONVERSION_WEBGL, GL_NONE);
  };

  let scratch: HTMLCanvasElement | null = null;

  const prepareCanvas = (
    width: number,
    height: number,
    sourceTop: number,
    sourceHeight: number,
  ): HTMLCanvasElement => {
    scratch ??= document.createElement('canvas');
    if (scratch.width !== width) scratch.width = width;
    if (scratch.height !== height) scratch.height = height;
    const ctx = scratch.getContext('2d');
    if (!ctx) throw new Error('Cannot stage terminal pixels for the compositor');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(
      host.surface.canvas,
      0,
      sourceTop,
      canvasWidth(),
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    return scratch;
  };

  const upload = (
    x: number,
    y: number,
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
  ): void => {
    host.gl.texSubImage2D(GL_TEXTURE_2D, 0, x, y, width, height, GL_RGBA, GL_UNSIGNED_BYTE, canvas);
  };

  const uploadViewport = (colorTexture: WebGLTexture, viewport: LayerViewport): void => {
    const { x, y, width, height } = viewport;
    const viewportChanged =
      !lastViewport ||
      x !== lastViewport.x ||
      y !== lastViewport.y ||
      width !== lastViewport.width ||
      height !== lastViewport.height;
    const dirty = host.surface.dirtyRows;
    const sameSize = width === canvasWidth() && height === canvasHeight();
    if (
      colorTexture !== lastTexture ||
      viewportChanged ||
      !dirty?.length ||
      (!sameSize && dirty.some((flag) => flag !== 0))
    ) {
      const canvas = sameSize
        ? host.surface.canvas
        : prepareCanvas(width, height, 0, canvasHeight());
      upload(x, y, width, height, canvas);
      lastTexture = colorTexture;
      lastViewport = { x, y, width, height };
    } else if (sameSize) {
      let first = -1;
      for (let row = 0; row <= dirty.length; row += 1) {
        const isDirty = row < dirty.length && dirty[row] !== 0;
        if (isDirty && first < 0) first = row;
        if (!isDirty && first >= 0) {
          const top = Math.floor((first * height) / dirty.length);
          const bottom = Math.min(height, Math.ceil((row * height) / dirty.length));
          if (bottom > top) {
            const band = prepareCanvas(width, bottom - top, top, bottom - top);
            upload(x, y + height - bottom, width, bottom - top, band);
          }
          first = -1;
        }
      }
    }
  };

  const uploadForFrame = (frame: unknown): void => {
    if (!binding || !layer || !host.session.renderState.layers.includes(layer)) return;
    const { colorTexture, viewport } = binding.getSubImage(layer, frame);
    if (
      !Number.isInteger(viewport.x) ||
      viewport.x < 0 ||
      !Number.isInteger(viewport.y) ||
      viewport.y < 0 ||
      !Number.isInteger(viewport.width) ||
      viewport.width <= 0 ||
      !Number.isInteger(viewport.height) ||
      viewport.height <= 0
    )
      throw new Error('Invalid terminal compositor viewport');
    const gl = host.gl;
    const texture = gl.getParameter(GL_TEXTURE_BINDING_2D) as WebGLTexture | null;
    const flip = gl.getParameter(GL_UNPACK_FLIP_Y_WEBGL) as boolean;
    const premultiply = gl.getParameter(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
    const colorSpace = gl.getParameter(GL_UNPACK_COLORSPACE_CONVERSION_WEBGL) as number;
    try {
      gl.bindTexture(GL_TEXTURE_2D, colorTexture);
      applyUnpackState(gl);
      uploadViewport(colorTexture, viewport);
    } finally {
      gl.bindTexture(GL_TEXTURE_2D, texture);
      gl.pixelStorei(GL_UNPACK_FLIP_Y_WEBGL, flip);
      gl.pixelStorei(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
      gl.pixelStorei(GL_UNPACK_COLORSPACE_CONVERSION_WEBGL, colorSpace);
    }
    host.setSurfaceVisible(false);
  };

  let layerPixelW = 0;
  let layerPixelH = 0;

  const doDeactivate = (): void => {
    if (!active) return;
    active = false;
    destroyLayer();
    host.setSurfaceVisible(true);
  };

  return {
    get supported() {
      return binding !== null;
    },
    activate(): void {
      if (!binding || active) return;
      baseLayers = [...(host.session.renderState.layers ?? [])];
      if (!baseLayers.length) return;
      active = true;
      try {
        buildLayer();
      } catch (error) {
        console.warn('Terminal composition layer unavailable', error);
        doDeactivate();
      }
    },
    update(frame: unknown): void {
      if (!active || !layer) return;
      const pose = host.worldTransform();
      try {
        layer.transform = rigidTransform(pose, curvature ? lastWidth / curvature : 0);
        uploadForFrame(frame);
      } catch (error) {
        console.warn('Terminal composition layer unavailable', error);
        doDeactivate();
      }
    },
    deactivate(): void {
      doDeactivate();
    },
    notifyCanvasResized(): void {
      if (!active || !layer) return;
      const { width, height } = host.planeSize();
      if (
        canvasWidth() === layerPixelW &&
        canvasHeight() === layerPixelH &&
        Math.abs(width - lastWidth) < 0.001 &&
        Math.abs(height - lastHeight) < 0.001
      )
        return;
      host.setSurfaceVisible(true);
      try {
        buildLayer();
      } catch (error) {
        console.warn('Terminal composition layer unavailable', error);
        doDeactivate();
      }
    },
    dispose(): void {
      doDeactivate();
    },
  };
}
