import * as THREE from 'three';
import { createScalableLabel, updateScalableLabel } from './labels';
import {
  DEFAULT_DEPTH_VIEW,
  depthDisplacement,
  depthStrengthLabel,
  normalizeDepthView,
  type PictureDepthView,
  stepDepthStrength,
  usesDepthMap,
} from './picture-depth';
import { frameSize, PICTURE_LONG_EDGE, PLACEHOLDER_ASPECT } from './picture-sizing';
import { measureStereoCanvases, type StereoDisparity } from './stereo-disparity';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type SpatialWidget } from './widget';

export const PICTURE_KIND = 'picture';
export const PICTURE_PLACEHOLDER_TEXT = 'Add a picture';
export interface PictureCanvas {
  source: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface PictureFrameImage extends PictureCanvas {
  /** Right eye when the primary canvas is the left eye. Both use the same dimensions. */
  right?: Pick<PictureCanvas, 'source'>;
}

export interface PicturePickerAction {
  id: string;
  label: string;
  name?: string;
  helpText?: string;
  activate?(frameId: string): void;
}

function addPickerChoices(
  parent: THREE.Object3D,
  y: number,
  actions: readonly PicturePickerAction[],
): Map<THREE.Object3D, PicturePickerAction> {
  const targets = new Map<THREE.Object3D, PicturePickerAction>();
  const width = Math.min(0.24, 0.54 / actions.length - 0.03);
  for (const [index, action] of actions.entries()) {
    const button = createScalableLabel(action.label, width, 0.085, { background: '#223946' });
    button.name = action.name ?? `picture-${action.id}-choice`;
    button.position.set((index - (actions.length - 1) / 2) * (width + 0.03), y, 0.004);
    button.userData.inputAction = action.id;
    button.userData.helpText = action.helpText;
    parent.add(button);
    targets.set(button, action);
  }
  return targets;
}

const BORDER = 0.022;
/** The corner icon buttons: close, change and 3D. */
const CORNER_SIZE = 0.075;
const DEPTH = 0.024;
const FRAME_COLOR = 0x0c1117;

let nextPlaceholderId = 1;

export interface PictureFrameOptions {
  /** Stable identifier for the frame. */
  id?: string;
  image?: PictureFrameImage | null;
  /** Texture anisotropy, already capped to the renderer's maximum. */
  anisotropy?: number;
  /** The depth map uses brighter values for closer pixels. */
  depth?: PictureCanvas | null;
  /** How the frame shows its depth; omitted means the default view. */
  depthView?: PictureDepthView;
  /** The user changed the 3D options. */
  onDepthView?: (view: PictureDepthView) => void;
  onClose?: (id: string) => void;
  picker?: { actions: readonly PicturePickerAction[]; hint?: string };
  /** Release the input canvases by clearing them when replaced or disposed. */
  ownsCanvases?: boolean;
}

export interface PictureFrameWidget extends SpatialWidget {
  setPictureDepth(depth: PictureCanvas): void;
  setTextureAnisotropy(anisotropy: number): void;
}

/** Relief mesh resolution along the frame's long edge; the depth map is about 518 px. */
const DEPTH_SEGMENTS = 160;
/** A depth step between neighbouring texels above this cuts the surface in "cut" edges mode. */
const DEPTH_CUT_THRESHOLD = 0.06;
/** Draw order for controls lifted over a picture that pops out of its frame. */
const POPOUT_CONTROL_ORDER = 20;

const DEPTH_VERTEX = /* glsl */ `
  uniform sampler2D depthMap; uniform float depthScale; uniform float depthAnchor; uniform vec2 texel;
  varying vec2 vUv; varying float vEdge;
  float near(vec2 at) { return texture2D(depthMap, at).r; }
  void main() {
    vUv = uv;
    float d = near(uv);
    float gx = abs(near(uv + vec2(texel.x, 0.0)) - near(uv - vec2(texel.x, 0.0)));
    float gy = abs(near(uv + vec2(0.0, texel.y)) - near(uv - vec2(0.0, texel.y)));
    vEdge = max(gx, gy);
    // The outermost ring stays on the frame plane, stretching the picture's edge to the border.
    float rim = step(uv.x, 0.0001) + step(0.9999, uv.x) + step(uv.y, 0.0001) + step(0.9999, uv.y);
    float scale = rim > 0.0 ? 0.0 : depthScale;
    // Bright is near. Anchor 1 keeps the nearest pixels on the frame plane and recedes the rest;
    // anchor 0.5 centres the depth on the frame, so near pixels pop out in front of it.
    vec3 p = position + normal * (d - depthAnchor) * scale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const DEPTH_FRAGMENT = /* glsl */ `
  uniform sampler2D photo; uniform float cutThreshold;
  varying vec2 vUv; varying float vEdge;
  void main() {
    if (vEdge > cutThreshold) discard;
    gl_FragColor = texture2D(photo, vUv);
    #include <colorspace_fragment>
  }`;

// Each eye samples its own image, shifted so the chosen disparity sits on the frame plane and
// cropped by the same amount on both axes so the picture keeps its aspect.
const STEREO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const STEREO_FRAGMENT = /* glsl */ `
  uniform sampler2D leftEye; uniform sampler2D rightEye; uniform float eye; uniform float converge;
  varying vec2 vUv;
  void main() {
    float keep = 1.0 - abs(converge);
    float x = vUv.x * keep + (eye > 0.5 ? max(-converge, 0.0) : max(converge, 0.0));
    vec2 at = vec2(x, 0.5 + (vUv.y - 0.5) * keep);
    gl_FragColor = eye > 0.5 ? texture2D(rightEye, at) : texture2D(leftEye, at);
    #include <colorspace_fragment>
  }`;

/** The WebXR right-eye camera: three.js enables layer 2 on it and layer 1 on the left. */
const isRightEye = (camera: THREE.Camera): boolean =>
  camera.layers.isEnabled(2) && !camera.layers.isEnabled(1);

/** A border with no backing, so a picture receding behind the frame plane stays visible. */
function createOpenBorder(width: number, height: number, material: THREE.Material): THREE.Group {
  const ring = new THREE.Group();
  ring.name = 'picture-frame-ring';
  const outerWidth = width + BORDER * 2;
  for (const [w, h, x, y] of [
    [outerWidth, BORDER, 0, (height + BORDER) / 2],
    [outerWidth, BORDER, 0, -(height + BORDER) / 2],
    [BORDER, height, -(width + BORDER) / 2, 0],
    [BORDER, height, (width + BORDER) / 2, 0],
  ] as const) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(w, h, DEPTH), material);
    side.position.set(x, y, -DEPTH / 2);
    ring.add(side);
  }
  return ring;
}

/** A thin dark frame around a plane whose aspect matches the image, with a close control. */
export function createPictureFrameWidget(
  envMap: THREE.Texture | null = null,
  options: PictureFrameOptions = {},
): PictureFrameWidget {
  const image = options.image ?? null;
  const pickerActions = options.picker?.actions ?? [];
  if (pickerActions.length > 2)
    throw new RangeError('A picture frame supports up to two picker actions');
  let pickerTargets = new Map<THREE.Object3D, PicturePickerAction>();
  let changeChoices: THREE.Group | null = null;
  let changeButton: THREE.Mesh | null = null;
  const id = options.id ?? `placeholder-${nextPlaceholderId++}`;
  const size = image
    ? frameSize(image.width, image.height)
    : { width: PICTURE_LONG_EDGE, height: PICTURE_LONG_EDGE / PLACEHOLDER_ASPECT };
  const root = new THREE.Group();
  root.name = `picture-frame-${id}`;
  root.userData.widgetId = id;
  root.userData.widgetKind = PICTURE_KIND;
  root.userData.pictureId = id;
  root.userData.picturePlaceholder = !image;
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(size.width + BORDER * 2, size.height + BORDER * 2, DEPTH),
    applyUIEnvironment(
      new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.55, metalness: 0.35 }),
      envMap,
    ),
  );
  frame.name = 'picture-frame-border';
  frame.position.z = -DEPTH / 2;
  root.add(frame);

  let texture: THREE.CanvasTexture | null = null;
  let plane: THREE.Mesh | null = null;
  if (image) {
    texture = new THREE.CanvasTexture(image.source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.max(1, Math.floor(options.anisotropy ?? 1));
    plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size.width, size.height),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    plane.name = 'picture-frame-image';
    plane.position.z = 0.001;
    root.add(plane);
  } else {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(size.width, size.height),
      new THREE.MeshBasicMaterial({ color: 0x15232b }),
    );
    face.name = 'picture-frame-face';
    face.position.z = 0.001;
    root.add(face);
    const placeholder = createScalableLabel(PICTURE_PLACEHOLDER_TEXT, size.width - 0.08, 0.07, {
      backplate: false,
    });
    placeholder.name = 'picture-frame-placeholder';
    placeholder.position.set(0, 0.1, 0.002);
    root.add(placeholder);
    if (pickerActions.length) pickerTargets = addPickerChoices(root, -0.03, pickerActions);
    if (options.picker?.hint) {
      const hint = createScalableLabel(options.picker.hint, size.width - 0.16, 0.045, {
        backplate: false,
      });
      hint.name = 'picture-frame-hint';
      hint.position.set(0, -0.14, 0.002);
      root.add(hint);
    }
  }
  if (image && pickerActions.length) {
    changeButton = createScalableLabel('🖼', CORNER_SIZE, CORNER_SIZE, { background: '#223946' });
    changeButton.name = 'picture-change';
    changeButton.position.set(-size.width / 2 - BORDER / 2, size.height / 2 + BORDER / 2, 0.012);
    changeButton.userData.inputAction = 'pictureChange';
    changeButton.userData.helpText = 'Replace this picture';
    changeChoices = new THREE.Group();
    changeChoices.name = 'picture-change-choices';
    changeChoices.visible = false;
    changeChoices.position.z = 0.008;
    pickerTargets = addPickerChoices(changeChoices, 0, pickerActions);
    root.add(changeButton, changeChoices);
  }
  const controls: THREE.Object3D[] = [];
  let depthOptions: THREE.Group | null = null;
  const depthLabels = new Map<string, THREE.Mesh>();
  if (image) {
    const toggle = createScalableLabel('3D', CORNER_SIZE, CORNER_SIZE, { background: '#223946' });
    toggle.name = 'picture-depth';
    // Beside close on the top edge.
    toggle.position.set(
      size.width / 2 + BORDER / 2 - CORNER_SIZE - 0.01,
      size.height / 2 + BORDER / 2,
      0.012,
    );
    toggle.userData.inputAction = 'widgetControl';
    toggle.userData.pictureDepthCommand = 'options';
    toggle.userData.helpText = '3D picture options';
    root.add(toggle);
    controls.push(toggle);
    depthOptions = createDepthOptions(size.width, depthLabels, Boolean(image.right));
    root.add(depthOptions);
    controls.push(depthOptions);
    if (changeButton && changeChoices) controls.push(changeButton, changeChoices);
  }

  const close = createScalableLabel('×', CORNER_SIZE, CORNER_SIZE, { background: '#223946' });
  close.name = 'picture-close';
  // Sits on the frame's top-right corner so it never covers the picture.
  close.position.set(size.width / 2 + BORDER / 2, size.height / 2 + BORDER / 2, 0.012);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close this picture frame';
  root.add(close);
  controls.push(close);

  let view = normalizeDepthView(options.depthView ?? DEFAULT_DEPTH_VIEW);
  const openBorder = createOpenBorder(size.width, size.height, frame.material);
  openBorder.visible = false;
  root.add(openBorder);
  let depthTexture: THREE.CanvasTexture | null = null;
  let depthImage: PictureCanvas | null = null;
  let relief: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  const longEdge = Math.max(size.width, size.height);
  let rightTexture: THREE.CanvasTexture | null = null;
  let stereo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  let disparity: StereoDisparity | null = null;
  if (texture && image?.right) {
    rightTexture = new THREE.CanvasTexture(image.right.source);
    rightTexture.colorSpace = THREE.SRGBColorSpace;
    rightTexture.generateMipmaps = true;
    rightTexture.minFilter = THREE.LinearMipmapLinearFilter;
    rightTexture.magFilter = THREE.LinearFilter;
    rightTexture.anisotropy = texture.anisotropy;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        leftEye: { value: texture },
        rightEye: { value: rightTexture },
        eye: { value: 0 },
        converge: { value: 0 },
      },
      vertexShader: STEREO_VERTEX,
      fragmentShader: STEREO_FRAGMENT,
    });
    stereo = new THREE.Mesh(new THREE.PlaneGeometry(size.width, size.height), material);
    stereo.name = 'picture-frame-stereo';
    stereo.position.z = 0.001;
    stereo.raycast = () => {};
    // Called once per eye in XR; the desktop camera is neither eye and gets the left image.
    stereo.onBeforeRender = (_renderer, _scene, camera) => {
      material.uniforms.eye.value = isRightEye(camera) ? 1 : 0;
      material.uniformsNeedUpdate = true;
    };
    stereo.userData.widgetId = id;
    stereo.userData.widgetKind = PICTURE_KIND;
    stereo.userData.inputAction = 'grabWidget';
    root.add(stereo);
    disparity = measureStereoCanvases(image.source, image.right.source);
  }

  const setControlsOnTop = (onTop: boolean): void => {
    for (const control of controls)
      control.traverse((child) => {
        const material = (child as THREE.Mesh).material;
        for (const value of Array.isArray(material) ? material : material ? [material] : [])
          value.depthTest = !onTop;
        child.renderOrder = onTop ? POPOUT_CONTROL_ORDER + (child === control ? 0 : 1) : 0;
      });
  };

  const applyView = (): void => {
    const pair = Boolean(stereo);
    const stereoShown = pair && view.enabled && view.source === 'stereo';
    const shown = Boolean(relief) && usesDepthMap(view, pair);
    if (plane) (plane.material as THREE.Material).visible = !shown && !stereoShown;
    frame.visible = !shown;
    openBorder.visible = shown;
    if (stereo) {
      stereo.visible = stereoShown;
      // Inward puts the nearest content on the frame plane, so the scene sits behind the frame;
      // pop out puts the typical content there, so nearer things come forward.
      stereo.material.uniforms.converge.value =
        (view.mode === 'popout' ? disparity?.typical : disparity?.near) ?? 0;
    }
    const depthMapOptions = depthOptions?.getObjectByName('picture-depth-map-options');
    if (depthMapOptions) depthMapOptions.visible = !pair || view.source === 'depth';
    if (relief) {
      relief.visible = shown;
      const uniforms = relief.material.uniforms;
      uniforms.depthScale.value = depthDisplacement(view, longEdge);
      uniforms.depthAnchor.value = view.mode === 'popout' ? 0.5 : 1;
      uniforms.cutThreshold.value = view.edges === 'cut' ? DEPTH_CUT_THRESHOLD : 2;
    }
    setControlsOnTop(shown && view.mode === 'popout');
    const text = (name: string, label: string): void => {
      const mesh = depthLabels.get(name);
      if (mesh && mesh.userData.labelText !== label) updateScalableLabel(mesh, label);
    };
    text('enabled', view.enabled ? '3D: On' : '3D: Off');
    text('strength', `Depth ${depthStrengthLabel(view.strength)}`);
    text('mode', view.mode === 'popout' ? 'Pop out' : 'Inward');
    text('edges', view.edges === 'cut' ? 'Edges: Cut' : 'Edges: Stretch');
    text('source', view.source === 'depth' ? 'Source: Depth map' : 'Source: Stereo');
  };

  const releaseCanvas = (canvas: HTMLCanvasElement | undefined): void => {
    if (options.ownsCanvases && canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  };
  const setDepth = (depth: PictureCanvas): void => {
    if (!texture || disposed) {
      releaseCanvas(depth.source);
      return;
    }
    depthTexture?.dispose();
    if (
      depthImage &&
      depthImage.source !== depth.source &&
      depthImage.source !== image?.source &&
      depthImage.source !== image?.right?.source
    ) {
      releaseCanvas(depthImage.source);
    }
    depthImage = depth;
    // Read in the vertex shader as raw values: no colour conversion and no mipmaps.
    depthTexture = new THREE.CanvasTexture(depth.source);
    depthTexture.generateMipmaps = false;
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;
    if (!relief) {
      const across = Math.max(1, Math.round((DEPTH_SEGMENTS * size.width) / longEdge));
      const down = Math.max(1, Math.round((DEPTH_SEGMENTS * size.height) / longEdge));
      relief = new THREE.Mesh(
        new THREE.PlaneGeometry(size.width, size.height, across, down),
        new THREE.ShaderMaterial({
          uniforms: {
            photo: { value: texture },
            depthMap: { value: depthTexture },
            depthScale: { value: 0 },
            depthAnchor: { value: 1 },
            texel: { value: new THREE.Vector2(1 / depth.width, 1 / depth.height) },
            cutThreshold: { value: 2 },
          },
          vertexShader: DEPTH_VERTEX,
          fragmentShader: DEPTH_FRAGMENT,
          side: THREE.DoubleSide,
        }),
      );
      relief.name = 'picture-frame-relief';
      relief.position.z = 0.001;
      // Rays pick the flat plane: testing every relief triangle per controller each frame is slow.
      relief.raycast = () => {};
      // The relief reaches well behind or in front of the flat bounds the culler would test.
      relief.frustumCulled = false;
      relief.userData.widgetId = id;
      relief.userData.widgetKind = PICTURE_KIND;
      relief.userData.inputAction = 'grabWidget';
      root.add(relief);
    } else {
      relief.material.uniforms.depthMap.value = depthTexture;
      (relief.material.uniforms.texel.value as THREE.Vector2).set(
        1 / depth.width,
        1 / depth.height,
      );
    }
    applyView();
  };

  const changeView = (next: PictureDepthView): void => {
    view = normalizeDepthView(next);
    applyView();
    options.onDepthView?.(view);
  };

  root.traverse((object) => {
    object.userData.widgetId = id;
    object.userData.widgetKind = PICTURE_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });

  let disposed = false;
  if (options.depth) setDepth(options.depth);
  applyView();
  return {
    root,
    update: () => {},
    setPictureDepth: setDepth,
    activate: (target) => {
      if (disposed) return;
      if (target === close) {
        options.onClose?.(id);
        return;
      }
      if (changeChoices && target === changeButton) {
        changeChoices.visible = !changeChoices.visible;
        return;
      }
      const pickerAction = pickerTargets.get(target);
      if (pickerAction && (!changeChoices || changeChoices.visible)) {
        if (changeChoices) changeChoices.visible = false;
        pickerAction.activate?.(id);
        return;
      }
      if (!root.getObjectById(target.id)) return;
      const command = target.userData.pictureDepthCommand;
      if (command === 'options') {
        if (depthOptions) depthOptions.visible = !depthOptions.visible;
      } else if (command === 'enabled') changeView({ ...view, enabled: !view.enabled });
      else if (command === 'stronger') changeView(stepDepthStrength(view, 1));
      else if (command === 'weaker') changeView(stepDepthStrength(view, -1));
      else if (command === 'mode')
        changeView({ ...view, mode: view.mode === 'popout' ? 'inward' : 'popout' });
      else if (command === 'edges')
        changeView({ ...view, edges: view.edges === 'cut' ? 'stretch' : 'cut' });
      else if (command === 'source')
        changeView({ ...view, source: view.source === 'depth' ? 'stereo' : 'depth' });
    },
    setTextureAnisotropy: (anisotropy) => {
      if (!texture || disposed) return;
      const next = Math.max(1, Math.floor(anisotropy));
      if (texture.anisotropy === next) return;
      texture.anisotropy = next;
      texture.needsUpdate = true;
      if (rightTexture) {
        rightTexture.anisotropy = next;
        rightTexture.needsUpdate = true;
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Material.dispose leaves its map alone, so the texture and its canvas go here.
      texture?.dispose();
      depthTexture?.dispose();
      rightTexture?.dispose();
      for (const canvas of new Set([image?.source, depthImage?.source, image?.right?.source]))
        releaseCanvas(canvas);
      disposeOwned(root);
      root.clear();
    },
  };
}

/**
 * The 3D options panel, hidden until the frame's 3D button opens it, centred on the picture:
 * 3D and mode side by side, a stereo pair's source, then the depth map's strength and edges.
 */
function createDepthOptions(
  width: number,
  labels: Map<string, THREE.Mesh>,
  stereo: boolean,
): THREE.Group {
  const panel = new THREE.Group();
  panel.name = 'picture-depth-options';
  panel.visible = false;
  panel.position.z = 0.008;
  // Strength and edges only apply to a depth map, so a stereo pair hides them in stereo.
  const depthMap = new THREE.Group();
  depthMap.name = 'picture-depth-map-options';
  panel.add(depthMap);
  const rowHeight = 0.075;
  const gap = 0.01;
  const rows = stereo ? 4 : 3;
  const panelWidth = Math.min(0.5, width - 0.06);
  const half = (panelWidth - gap) / 2;
  const rowY = (row: number): number => ((rows - 1) / 2 - row) * (rowHeight + gap);
  const button = (
    name: string,
    text: string,
    w: number,
    x: number,
    y: number,
    command: string,
    help: string,
    parent: THREE.Object3D = panel,
  ): THREE.Mesh => {
    const control = createScalableLabel(text, w, rowHeight, { background: '#223946' });
    control.name = `picture-depth-${name}`;
    control.position.set(x, y, 0);
    control.userData.inputAction = 'widgetControl';
    control.userData.pictureDepthCommand = command;
    control.userData.helpText = help;
    parent.add(control);
    return control;
  };
  const left = -(half + gap) / 2;
  const right = (half + gap) / 2;
  labels.set(
    'enabled',
    button('enabled', '3D: On', half, left, rowY(0), 'enabled', 'Turn 3D on or off'),
  );
  labels.set(
    'mode',
    button('mode', 'Inward', half, right, rowY(0), 'mode', 'Recede behind the frame or pop out'),
  );
  if (stereo)
    labels.set(
      'source',
      button(
        'source',
        'Source: Stereo',
        panelWidth,
        0,
        rowY(1),
        'source',
        'Show the captured stereo pair or a depth map',
      ),
    );
  const strengthRow = stereo ? 2 : 1;
  const step = 0.075;
  const edge = (panelWidth - step) / 2;
  button('weaker', '−', step, -edge, rowY(strengthRow), 'weaker', 'Less depth', depthMap);
  button('stronger', '+', step, edge, rowY(strengthRow), 'stronger', 'More depth', depthMap);
  const value = createScalableLabel('Depth 0.25', panelWidth - step * 2 - gap * 2, rowHeight, {
    background: '#15232b',
  });
  value.name = 'picture-depth-strength';
  value.position.set(0, rowY(strengthRow), 0);
  depthMap.add(value);
  labels.set('strength', value);
  labels.set(
    'edges',
    button(
      'edges',
      'Edges: Stretch',
      panelWidth,
      0,
      rowY(strengthRow + 1),
      'edges',
      'Stretch or cut the picture where its depth jumps',
      depthMap,
    ),
  );
  return panel;
}
