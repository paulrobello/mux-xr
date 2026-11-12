import * as THREE from 'three';
import { createScalableLabel, updateScalableLabel } from './labels';
import {
  DEFAULT_DEPTH_VIEW,
  depthDisplacement,
  depthStrengthLabel,
  normalizeDepthView,
  type PictureDepthView,
  stepDepthStrength,
} from './picture-depth';
import type { PictureImage } from './picture-image';
import { frameSize, PICTURE_LONG_EDGE, PLACEHOLDER_ASPECT } from './picture-sizing';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const PICTURE_KIND = 'picture';
export const PICTURE_PLACEHOLDER_TEXT = 'Add a picture';
export const PICTURE_PLACEHOLDER_HINT = 'or pick one on the page';

/**
 * The XR picker choices. Frames spawn at scale 0.6 or 1, so these local sizes keep every target at
 * least 0.045 m tall in the world.
 */
function addPickerChoices(parent: THREE.Object3D, y: number): void {
  for (const [label, action, x] of [
    ['Enter URL', 'pictureUrl', -0.135],
    ['Recent', 'pictureRecent', 0.135],
  ] as const) {
    const button = createScalableLabel(label, 0.24, 0.085, { background: '#223946' });
    button.name = `picture-${action === 'pictureUrl' ? 'url' : 'recent'}-choice`;
    button.position.set(x, y, 0.004);
    button.userData.inputAction = action;
    button.userData.helpText =
      action === 'pictureUrl' ? 'Type or paste an image URL' : 'Choose a recent picture';
    parent.add(button);
  }
}

const BORDER = 0.022;
const DEPTH = 0.024;
const FRAME_COLOR = 0x0c1117;

let nextPlaceholderId = 1;

export interface PictureFrameOptions {
  /** Stable frame id; also the IndexedDB key and the pose-store suffix. */
  id?: string;
  /** The picture; omitted for the "Pick an image on the page" placeholder. */
  image?: PictureImage | null;
  /** Texture anisotropy, already capped to the renderer's maximum. */
  anisotropy?: number;
  /** The picture's depth map (near bright); omitted until the Mac has made one. */
  depth?: PictureImage | null;
  /** How the frame shows its depth; omitted means the default view. */
  depthView?: PictureDepthView;
  /** The user changed the 3D options. */
  onDepthView?: (view: PictureDepthView) => void;
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
    // Bright is near. Anchor 1 keeps the nearest pixels on the frame plane and recedes the rest;
    // anchor 0.5 centres the depth on the frame, so near pixels pop out in front of it.
    vec3 p = position + normal * (d - depthAnchor) * depthScale;
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
): Widget {
  const image = options.image ?? null;
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
    addPickerChoices(root, -0.03);
    const hint = createScalableLabel(PICTURE_PLACEHOLDER_HINT, size.width - 0.16, 0.045, {
      backplate: false,
    });
    hint.name = 'picture-frame-hint';
    hint.position.set(0, -0.14, 0.002);
    root.add(hint);
  }
  if (image) {
    const change = createScalableLabel('Change', 0.2, 0.08, { background: '#223946' });
    change.name = 'picture-change';
    // Inside the bottom-left corner, so the frame's footprint (and slot clearance) is unchanged.
    change.position.set(-size.width / 2 + 0.11, -size.height / 2 + 0.05, 0.012);
    change.userData.inputAction = 'pictureChange';
    change.userData.helpText = 'Replace this picture';
    root.add(change);
    const choices = new THREE.Group();
    choices.name = 'picture-change-choices';
    choices.visible = false;
    choices.position.z = 0.008;
    addPickerChoices(choices, 0);
    root.add(choices);
  }
  const controls: THREE.Object3D[] = [];
  let depthOptions: THREE.Group | null = null;
  const depthLabels = new Map<string, THREE.Mesh>();
  if (image) {
    const toggle = createScalableLabel('3D', 0.1, 0.08, { background: '#223946' });
    toggle.name = 'picture-depth';
    // Inside the bottom-right corner, mirroring Change.
    toggle.position.set(size.width / 2 - 0.06, -size.height / 2 + 0.05, 0.012);
    toggle.userData.inputAction = 'widgetControl';
    toggle.userData.pictureDepthCommand = 'options';
    toggle.userData.helpText = '3D picture options';
    root.add(toggle);
    controls.push(toggle);
    depthOptions = createDepthOptions(size.width, depthLabels);
    root.add(depthOptions);
    controls.push(depthOptions);
    controls.push(root.getObjectByName('picture-change') as THREE.Object3D);
    controls.push(root.getObjectByName('picture-change-choices') as THREE.Object3D);
  }

  const close = createScalableLabel('×', 0.075, 0.075, { background: '#223946' });
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
  let depthImage: PictureImage | null = null;
  let relief: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  const longEdge = Math.max(size.width, size.height);

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
    const shown = Boolean(relief && view.enabled);
    if (plane) (plane.material as THREE.Material).visible = !shown;
    frame.visible = !shown;
    openBorder.visible = shown;
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
  };

  const setDepth = (depth: PictureImage): void => {
    if (!texture || disposed) {
      depth.source.width = 0;
      depth.source.height = 0;
      return;
    }
    depthTexture?.dispose();
    if (depthImage) {
      depthImage.source.width = 0;
      depthImage.source.height = 0;
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
    },
    setTextureAnisotropy: (anisotropy) => {
      if (!texture || disposed) return;
      const next = Math.max(1, Math.floor(anisotropy));
      if (texture.anisotropy === next) return;
      texture.anisotropy = next;
      texture.needsUpdate = true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Material.dispose leaves its map alone, so the texture and its canvas go here.
      texture?.dispose();
      depthTexture?.dispose();
      for (const owned of [image, depthImage])
        if (owned) {
          owned.source.width = 0;
          owned.source.height = 0;
        }
      disposeOwned(root);
      root.clear();
    },
  };
}

/**
 * The 3D options panel, hidden until the frame's 3D button opens it. Two columns on a frame wide
 * enough, else one; every target is at least 0.07 m local, 0.042 m at the smallest frame scale.
 */
function createDepthOptions(width: number, labels: Map<string, THREE.Mesh>): THREE.Group {
  const panel = new THREE.Group();
  panel.name = 'picture-depth-options';
  panel.visible = false;
  panel.position.z = 0.008;
  const cellHeight = 0.08;
  const gap = 0.012;
  const columns = width >= 0.54 ? 2 : 1;
  const cellWidth = Math.min(0.25, (width - 0.04 - gap * (columns - 1)) / columns);
  const rows = Math.ceil(4 / columns);
  const panelHeight = rows * cellHeight + (rows - 1) * gap;
  // Centred in the picture above the bottom-row buttons.
  const centreY = 0.05;
  const cell = (index: number): { x: number; y: number } => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: (column - (columns - 1) / 2) * (cellWidth + gap),
      y: centreY + panelHeight / 2 - cellHeight / 2 - row * (cellHeight + gap),
    };
  };
  const button = (
    name: string,
    text: string,
    w: number,
    x: number,
    y: number,
    command: string,
    help: string,
  ): THREE.Mesh => {
    const control = createScalableLabel(text, w, cellHeight, { background: '#223946' });
    control.name = `picture-depth-${name}`;
    control.position.set(x, y, 0);
    control.userData.inputAction = 'widgetControl';
    control.userData.pictureDepthCommand = command;
    control.userData.helpText = help;
    panel.add(control);
    return control;
  };
  const toggle = cell(0);
  labels.set(
    'enabled',
    button('enabled', '3D: On', cellWidth, toggle.x, toggle.y, 'enabled', 'Turn 3D on or off'),
  );
  const strength = cell(1);
  const step = 0.07;
  button(
    'weaker',
    '−',
    step,
    strength.x - (cellWidth - step) / 2,
    strength.y,
    'weaker',
    'Less depth',
  );
  button(
    'stronger',
    '+',
    step,
    strength.x + (cellWidth - step) / 2,
    strength.y,
    'stronger',
    'More depth',
  );
  const value = createScalableLabel('Depth 0.25', cellWidth - step * 2 - 0.01, cellHeight, {
    background: '#15232b',
  });
  value.name = 'picture-depth-strength';
  value.position.set(strength.x, strength.y, 0);
  panel.add(value);
  labels.set('strength', value);
  const mode = cell(2);
  labels.set(
    'mode',
    button(
      'mode',
      'Inward',
      cellWidth,
      mode.x,
      mode.y,
      'mode',
      'Recede behind the frame or pop out',
    ),
  );
  const edges = cell(3);
  labels.set(
    'edges',
    button(
      'edges',
      'Edges: Stretch',
      cellWidth,
      edges.x,
      edges.y,
      'edges',
      'Stretch or cut the picture where its depth jumps',
    ),
  );
  return panel;
}
