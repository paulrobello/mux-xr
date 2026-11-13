import * as THREE from 'three';
import { tagAccentMaterial } from './accent-colors';
import { disposeOwned, type Widget } from './widgets';

export const DESK_WINDOW_KIND = 'desk-window';
const WINDOW_BIT = 1;
const MASK_ORDER = -1_000_001;
const WIDTH = 0.85;
const HEIGHT = 0.46;
const RIM = 0.014;
const RIM_HIT_MARGIN = 0.018;
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
  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 direction = (viewMatrix * vec4(world - viewerCenter, 0.0)).xyz;
    gl_Position = projectionMatrix * vec4(direction, 1.0);
  }
`;

export interface DeskWindowIntersection extends THREE.Intersection {
  deskWindowPoint?: THREE.Vector3;
}

function projectDeskControl(material: THREE.MeshBasicMaterial, viewerCenter: THREE.Vector3): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.viewerCenter = { value: viewerCenter };
    shader.vertexShader = `uniform vec3 viewerCenter;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `
        vec3 world = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vec4 mvPosition = viewMatrix * vec4(world - viewerCenter, 0.0);
        gl_Position = projectionMatrix * vec4(mvPosition.xyz, 1.0);
      `,
    );
  };
}

export function projectDeskPointer(
  material: THREE.MeshBasicMaterial | THREE.LineBasicMaterial,
  viewerCenter: THREE.Vector3,
  offset: THREE.Vector3,
  active: { value: boolean },
  endpointOnly: boolean,
): void {
  material.customProgramCacheKey = () => (endpointOnly ? 'desk-ray' : 'desk-contact');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.deskViewerCenter = { value: viewerCenter };
    shader.uniforms.deskPointerOffset = { value: offset };
    shader.uniforms.deskPointerActive = active;
    shader.vertexShader = `
      uniform vec3 deskViewerCenter;
      uniform vec3 deskPointerOffset;
      uniform bool deskPointerActive;
      ${shader.vertexShader}
    `.replace(
      '#include <project_vertex>',
      `
        #include <project_vertex>
        if (deskPointerActive ${endpointOnly ? '&& position.z < 0.0' : ''}) {
          vec3 shift = cameraPosition - deskViewerCenter + deskPointerOffset;
          mvPosition += viewMatrix * vec4(shift, 0.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
    );
  };
}

// The shader effectively translates the frame by eye position minus viewer center. Undo
// that translation on the ray for each eye, and keep the space between the two edges pickable.
function createDeskControlRaycast(
  viewerCenter: THREE.Vector3,
  eyePositions: readonly THREE.Vector3[],
  margin: number,
): THREE.Mesh['raycast'] {
  const inverse = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const projectedPoint = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  return function (
    this: THREE.Mesh<THREE.PlaneGeometry>,
    raycaster,
    hits: DeskWindowIntersection[],
  ): void {
    inverse.copy(this.matrixWorld).invert();
    scale.setFromMatrixScale(this.matrixWorld);
    const { width, height } = this.geometry.parameters;
    const marginX = margin / scale.x;
    const marginY = margin / scale.y;
    let nearest = Infinity;
    let bestMiss = Infinity;
    let bestCenterDistance = Infinity;
    for (let index = -1; index < eyePositions.length; index++) {
      const eye = index === -1 ? viewerCenter : eyePositions[index];
      offset.subVectors(eye, viewerCenter);
      localRay.copy(raycaster.ray);
      localRay.origin.sub(offset);
      localRay.applyMatrix4(inverse);
      if (!localRay.intersectPlane(plane, localPoint)) continue;
      const missX = Math.max(0, Math.abs(localPoint.x) - width / 2);
      const missY = Math.max(0, Math.abs(localPoint.y) - height / 2);
      if (missX > marginX || missY > marginY) continue;
      const miss = Math.hypot(missX * scale.x, missY * scale.y);
      const centerDistance = Math.hypot(localPoint.x / width, localPoint.y / height);
      worldPoint.copy(localPoint).applyMatrix4(this.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(worldPoint.add(offset));
      if (distance < raycaster.near || distance > raycaster.far) continue;
      if (miss < bestMiss || (miss === bestMiss && centerDistance < bestCenterDistance)) {
        bestMiss = miss;
        bestCenterDistance = centerDistance;
        nearest = distance;
        projectedPoint.copy(worldPoint).sub(offset);
      }
    }
    if (Number.isFinite(nearest))
      hits.push({
        distance: nearest,
        point: raycaster.ray.at(nearest, new THREE.Vector3()),
        object: this,
        deskWindowPoint: projectedPoint.clone(),
      });
  };
}

export function createDeskWindow(
  viewerCenter = new THREE.Vector3(),
  eyePositions: readonly THREE.Vector3[] = [],
): Widget {
  const root = new THREE.Group();
  root.name = 'desk-window';
  root.userData.widgetId = DESK_WINDOW_KIND;
  root.userData.widgetKind = DESK_WINDOW_KIND;
  root.userData.scaleLimits = [0.25, 2];

  const aperture = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH, HEIGHT),
    new THREE.ShaderMaterial({
      uniforms: { viewerCenter: { value: viewerCenter } },
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
  aperture.userData.excludeFromContactGrip = true;
  root.add(aperture);

  const rimMaterial = tagAccentMaterial(
    new THREE.MeshBasicMaterial({ color: RIM_COLOR, side: THREE.DoubleSide }),
    RIM_COLOR,
  );
  projectDeskControl(rimMaterial, viewerCenter);
  const raycastRim = createDeskControlRaycast(viewerCenter, eyePositions, RIM_HIT_MARGIN);
  const horizontal = new THREE.PlaneGeometry(WIDTH + RIM * 2, RIM);
  const vertical = new THREE.PlaneGeometry(RIM, HEIGHT);
  for (const sign of [-1, 1]) {
    const bar = new THREE.Mesh(horizontal, rimMaterial);
    bar.position.y = (sign * (HEIGHT + RIM)) / 2;
    const side = new THREE.Mesh(vertical, rimMaterial);
    side.position.x = (sign * (WIDTH + RIM)) / 2;
    bar.name = sign < 0 ? 'desk-window-rim-bottom' : 'desk-window-rim-top';
    side.name = sign < 0 ? 'desk-window-rim-left' : 'desk-window-rim-right';
    bar.frustumCulled = side.frustumCulled = false;
    bar.raycast = side.raycast = raycastRim;
    root.add(bar, side);
  }
  const closeSize = 0.065;
  const closeMaterial = new THREE.MeshBasicMaterial({ color: 0x223946, side: THREE.DoubleSide });
  projectDeskControl(closeMaterial, viewerCenter);
  const close = new THREE.Mesh(new THREE.PlaneGeometry(closeSize, closeSize), closeMaterial);
  close.name = 'desk-window-close';
  close.position.set(WIDTH / 2 + RIM - closeSize / 2, HEIGHT / 2 + RIM + closeSize / 2, 0);
  close.frustumCulled = false;
  close.raycast = createDeskControlRaycast(viewerCenter, eyePositions, 0.009);
  close.userData.labelText = '×';
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the desk window and restore the virtual background';
  const markMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  projectDeskControl(markMaterial, viewerCenter);
  const markGeometry = new THREE.PlaneGeometry(0.023, 0.003);
  for (const angle of [-Math.PI / 4, Math.PI / 4]) {
    const mark = new THREE.Mesh(markGeometry, markMaterial);
    mark.position.z = 0.001;
    mark.rotation.z = angle;
    mark.frustumCulled = false;
    mark.raycast = () => undefined;
    close.add(mark);
  }
  close.visible = false;
  root.add(close);

  return {
    root,
    update: () => undefined,
    dispose: () => disposeOwned(root),
    setPointed: (pointed) => {
      close.visible = pointed;
    },
  };
}
