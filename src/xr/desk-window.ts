import * as THREE from 'three';
import { tagAccentMaterial } from './accent-colors';
import { createScalableLabel } from './labels';
import { disposeOwned, type Widget } from './widgets';

export const DESK_WINDOW_KIND = 'desk-window';
const WINDOW_BIT = 1;
const MASK_ORDER = -1_000_001;
const WIDTH = 0.85;
const HEIGHT = 0.46;
const RIM = 0.014;
const FEATHER_METRES = 0.055;
const RIM_COLOR = 0x536e7d;
const maskedRoots = new WeakSet<THREE.Object3D>();

export function setEnvironmentWindowMask(root: THREE.Object3D, enabled: boolean): void {
  if (maskedRoots.has(root) === enabled) return;
  if (enabled) maskedRoots.add(root);
  else maskedRoots.delete(root);
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const each of Array.isArray(material) ? material : [material]) {
      each.stencilWrite = enabled;
      each.stencilWriteMask = enabled ? 0 : 0xff;
      each.stencilFunc = enabled ? THREE.NotEqualStencilFunc : THREE.AlwaysStencilFunc;
      each.stencilFuncMask = enabled ? WINDOW_BIT : 0xff;
      each.stencilRef = enabled ? WINDOW_BIT : 0;
    }
  });
}

export function createDeskBackdrop(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  // Three clears to transparent in alpha-blend sessions. Draw an opaque backdrop where the
  // aperture's stencil bit is clear, in the same render as both XR views and the workspace.
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        backdropColor: { value: new THREE.Color() },
        gradient: { value: null },
        useGradient: { value: false },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 backdropColor;
        uniform sampler2D gradient;
        uniform bool useGradient;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(useGradient ? texture2D(gradient, vUv).rgb : backdropColor, 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFuncMask: WINDOW_BIT,
      stencilRef: WINDOW_BIT,
    }),
  );
  backdrop.name = 'desk-window-backdrop';
  backdrop.renderOrder = MASK_ORDER + 1;
  backdrop.frustumCulled = false;
  backdrop.visible = false;
  backdrop.raycast = () => undefined;
  return backdrop;
}

// Both eyes use the direction from the same viewer origin to the opening. Their view
// rotations and projection matrices still map those directions to the correct eye pixels.
const APERTURE_VERTEX = `
  uniform vec3 viewerCenter;
  uniform bool editing;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 direction = editing
      ? (modelViewMatrix * vec4(position, 1.0)).xyz
      : (viewMatrix * vec4(world - viewerCenter, 0.0)).xyz;
    gl_Position = projectionMatrix * vec4(direction, 1.0);
  }
`;

export function createDeskWindow(viewerCenter = new THREE.Vector3()): Widget {
  const root = new THREE.Group();
  root.name = 'desk-window';
  root.userData.widgetId = DESK_WINDOW_KIND;
  root.userData.widgetKind = DESK_WINDOW_KIND;
  root.userData.scaleLimits = [0.25, 2];

  const editing = { value: false };
  const aperture = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH, HEIGHT),
    new THREE.ShaderMaterial({
      uniforms: { viewerCenter: { value: viewerCenter }, editing },
      vertexShader: APERTURE_VERTEX,
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
      side: THREE.DoubleSide,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      stencilWrite: true,
      stencilWriteMask: WINDOW_BIT,
      stencilFuncMask: WINDOW_BIT,
      stencilRef: WINDOW_BIT,
      stencilZPass: THREE.ReplaceStencilOp,
    }),
  );
  aperture.name = 'desk-window-aperture';
  aperture.renderOrder = MASK_ORDER;
  aperture.frustumCulled = false;
  aperture.raycast = () => undefined;
  root.add(aperture);

  const feather = new THREE.Mesh(
    aperture.geometry,
    new THREE.ShaderMaterial({
      uniforms: {
        viewerCenter: { value: viewerCenter },
        editing,
        size: { value: new THREE.Vector2(WIDTH, HEIGHT) },
        featherWidth: { value: FEATHER_METRES },
      },
      vertexShader: APERTURE_VERTEX,
      fragmentShader: `
        uniform vec2 size;
        uniform float featherWidth;
        varying vec2 vUv;
        void main() {
          vec2 distanceToEdge = min(vUv, 1.0 - vUv) * size;
          float edge = min(distanceToEdge.x, distanceToEdge.y);
          if (edge >= featherWidth) discard;
          float opacity = 1.0 - smoothstep(0.0, featherWidth, edge);
          gl_FragColor = vec4(0.009, 0.014, 0.022, opacity);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    }),
  );
  feather.name = 'desk-window-feather';
  feather.renderOrder = MASK_ORDER + 2;
  feather.frustumCulled = false;
  feather.raycast = () => undefined;
  root.add(feather);

  const rimMaterial = tagAccentMaterial(
    new THREE.MeshBasicMaterial({ color: RIM_COLOR, side: THREE.DoubleSide }),
    RIM_COLOR,
  );
  // The edge remains pickable while its material is hidden.
  rimMaterial.visible = false;
  const horizontal = new THREE.PlaneGeometry(WIDTH + RIM * 2, RIM);
  const vertical = new THREE.PlaneGeometry(RIM, HEIGHT);
  for (const sign of [-1, 1]) {
    const bar = new THREE.Mesh(horizontal, rimMaterial);
    bar.position.y = (sign * (HEIGHT + RIM)) / 2;
    const side = new THREE.Mesh(vertical, rimMaterial);
    side.position.x = (sign * (WIDTH + RIM)) / 2;
    bar.name = sign < 0 ? 'desk-window-rim-bottom' : 'desk-window-rim-top';
    side.name = sign < 0 ? 'desk-window-rim-left' : 'desk-window-rim-right';
    root.add(bar, side);
  }
  const close = createScalableLabel('×', 0.065, 0.065, { background: '#223946' });
  close.name = 'desk-window-close';
  close.position.set(WIDTH / 2 + RIM / 2, HEIGHT / 2 + RIM + 0.034, 0.008);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the desk window and restore the virtual background';
  close.visible = false;
  root.add(close);

  return {
    root,
    update: () => undefined,
    dispose: () => disposeOwned(root),
    setPointed: (pointed) => {
      editing.value = pointed;
      rimMaterial.visible = pointed;
      close.visible = pointed;
    },
  };
}
