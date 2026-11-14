import type * as THREE from 'three';
import type { TerminalTextureSurface } from './terminal-texture';

/**
 * Focused-terminal composition quad layer (WebXR layers feature, immersive-vr
 * only). While active, the focused pane's terminal plane stops writing color
 * and the compositor samples an XRQuadLayer at native panel resolution
 * instead. Background panes keep their mesh textures, so gaze-priority LOD,
 * fades, and transforms are untouched.
 *
 * Render path: the painter's 2D canvas uploads into the layer's swapchain
 * texture via texSubImage2D — a full upload when the swapchain hands back a
 * different buffer, dirty-row bands otherwise.
 */

export interface XrLayerGl {
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

export interface XrWebGlBindingLike {
  createQuadLayer(init: {
    transform: unknown;
    width: number;
    height: number;
    space: unknown;
    viewPixelWidth: number;
    viewPixelHeight: number;
    clearOnAccess: boolean;
  }): XrQuadLayerLike;
  getSubImage(layer: XrQuadLayerLike, frame: unknown): { colorTexture: WebGLTexture };
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
  readonly planeSize: { width: number; height: number };
  /** World transform of the pane root, read every frame. */
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
  const supported = supportsQuadLayers(host.session);
  const binding: XrWebGlBindingLike | null = createBinding();
  let layer: XrQuadLayerLike | null = null;
  let active = false;
  let lastTexture: WebGLTexture | null = null;

  function createBinding(): XrWebGlBindingLike | null {
    if (!supported) return null;
    const ctor = XRWebGLBinding as unknown as new (
      session: unknown,
      context: unknown,
    ) => XrWebGlBindingLike;
    return new ctor(host.session, host.gl);
  }

  const destroyLayer = (): void => {
    if (layer) {
      layer.destroy();
      const layers = host.session.renderState.layers.filter((entry) => entry !== layer);
      host.session.updateRenderState({ layers });
      layer = null;
      lastTexture = null;
    }
  };

  const buildLayer = (): void => {
    const activeBinding = binding;
    if (!activeBinding) return;
    const pose = host.worldTransform();
    layer = activeBinding.createQuadLayer({
      transform: rigidTransform(pose),
      width: host.planeSize.width,
      height: host.planeSize.height,
      space: host.space,
      viewPixelWidth: canvasWidth(),
      viewPixelHeight: canvasHeight(),
      clearOnAccess: false,
    });
    layerPixelW = canvasWidth();
    layerPixelH = canvasHeight();
    const layers = [...host.session.renderState.layers, layer];
    host.session.updateRenderState({ layers });
    lastTexture = null;
  };

  const rigidTransform = (pose: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  }): XRRigidTransform => {
    return new XRRigidTransform(
      { x: pose.position.x, y: pose.position.y, z: pose.position.z },
      { x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w },
    );
  };

  const canvasWidth = (): number => host.surface.canvas.width;
  const canvasHeight = (): number => host.surface.canvas.height;

  const uploadFull = (texture: WebGLTexture): void => {
    const gl = host.gl;
    gl.bindTexture(GL_TEXTURE_2D, texture);
    applyUnpackState(gl);
    gl.texSubImage2D(
      GL_TEXTURE_2D,
      0,
      0,
      0,
      canvasWidth(),
      canvasHeight(),
      GL_RGBA,
      GL_UNSIGNED_BYTE,
      host.surface.canvas,
    );
    lastTexture = texture;
  };

  const applyUnpackState = (gl: XrLayerGl): void => {
    gl.pixelStorei(GL_UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(GL_UNPACK_COLORSPACE_CONVERSION_WEBGL, GL_NONE);
  };

  let scratch: HTMLCanvasElement | null = null;

  const cropRows = (top: number, height: number): HTMLCanvasElement => {
    scratch ??= document.createElement('canvas');
    scratch.width = canvasWidth();
    scratch.height = height;
    const ctx = scratch.getContext('2d');
    if (!ctx) return host.surface.canvas;
    ctx.drawImage(host.surface.canvas, 0, top, canvasWidth(), height, 0, 0, canvasWidth(), height);
    return scratch;
  };

  const uploadDirtyRows = (texture: WebGLTexture): void => {
    const gl = host.gl;
    const dirty = host.surface.dirtyRows;
    const rowCount = dirty?.length ?? 0;
    if (!dirty || rowCount === 0) {
      uploadFull(texture);
      return;
    }
    gl.bindTexture(GL_TEXTURE_2D, texture);
    applyUnpackState(gl);
    let first = -1;
    for (let row = 0; row <= rowCount; row += 1) {
      const isDirty = row < rowCount && dirty[row] !== 0;
      if (isDirty && first < 0) first = row;
      if (!isDirty && first >= 0) {
        const top = Math.floor((first * canvasHeight()) / rowCount);
        const bottom = Math.min(canvasHeight(), Math.ceil((row * canvasHeight()) / rowCount));
        if (bottom > top) {
          gl.texSubImage2D(
            GL_TEXTURE_2D,
            0,
            0,
            canvasHeight() - bottom,
            canvasWidth(),
            bottom - top,
            GL_RGBA,
            GL_UNSIGNED_BYTE,
            cropRows(top, bottom - top),
          );
        }
        first = -1;
      }
    }
  };

  const uploadForFrame = (frame: unknown): void => {
    const activeBinding = binding;
    if (!activeBinding || !layer) return;
    const subImage = activeBinding.getSubImage(layer, frame);
    if (subImage.colorTexture !== lastTexture) {
      uploadFull(subImage.colorTexture);
      return;
    }
    uploadDirtyRows(subImage.colorTexture);
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
      return supported;
    },
    activate(): void {
      if (!supported || active) return;
      active = true;
      buildLayer();
      if (layer) host.setSurfaceVisible(false);
    },
    update(frame: unknown): void {
      if (!active || !layer) return;
      const pose = host.worldTransform();
      layer.transform = rigidTransform(pose);
      uploadForFrame(frame);
    },
    deactivate(): void {
      doDeactivate();
    },
    notifyCanvasResized(): void {
      if (!active || !layer) return;
      if (canvasWidth() !== layerPixelW || canvasHeight() !== layerPixelH) {
        destroyLayer();
        buildLayer();
      }
    },
    dispose(): void {
      doDeactivate();
    },
  };
}
