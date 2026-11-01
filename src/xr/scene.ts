import * as THREE from 'three';
import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  PanelArrangement,
  QuickCommand,
  TerminalColorMode,
  TerminalSurface,
  WorkspaceActions,
} from '../contracts';
import { getControlHelp } from '../control-help';
import { terminalKeyLabel } from '../terminal/protocol';
import { type SemanticKey, semanticKeyboardLayout } from '../ui';
import { calculateArrangement } from './arrangements';
import {
  type CommandDraft,
  commandFromDraft,
  createCommandDraft,
  editCommandDraft,
} from './command-editor';
import { createFrameCounter } from './fps';
import { createScalableLabel, disposeScalableLabel, updateScalableLabel } from './labels';

type InputMode = 'commands' | 'keyboard' | 'panes' | 'terminal' | 'arrange' | 'command-editor';

export interface PanelTransform {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: number;
}

export interface GazeState {
  candidateId: string | null;
  emphasizedId: string | null;
  since: number;
}

export interface WorkspaceSceneState {
  selectedTerminalId: string | null;
  background: BackgroundMode;
  gazeInputEnabled: boolean;
  terminalColorMode: TerminalColorMode;
  keyboardBackgroundEnabled: boolean;
  fps: number | null;
  xrMode: 'desktop' | 'vr' | 'ar';
  focusedTerminalId: string | null;
  rendererError: string | null;
  inputTargetId: string | null;
  inputTargetTitle: string | null;
  updateAvailable: boolean;
  arrangement: PanelArrangement | null;
  notice: string | null;
}

export interface WorkspaceScene {
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly state: Readonly<WorkspaceSceneState>;
  addTerminal(surface: TerminalSurface): void;
  removeTerminal(id: string): void;
  selectTerminal(id: string | null): void;
  setBackground(mode: BackgroundMode): void;
  setGazeInputEnabled(enabled: boolean): void;
  setTerminalColorMode(mode: TerminalColorMode): void;
  setKeyboardBackgroundEnabled(enabled: boolean): void;
  setAvailablePanes(panes: PaneDescriptor[]): void;
  setQuickCommands(commands: QuickCommand[]): void;
  showInput(mode: InputMode): void;
  hideInput(): void;
  enterXR(mode: 'vr' | 'ar'): Promise<void>;
  exitXR(): Promise<void>;
  setUpdateAvailable(available: boolean): void;
  setNotice(message: string | null): void;
  resetLayout(): void;
  arrangeTerminals(pattern: PanelArrangement): void;
  scaleSelectedPanel(direction: number): void;
  getControlHints(): Array<{
    label: string;
    help: string;
    terminalId?: string;
    inputAction?: string;
    key?: string;
    clientX: number;
    clientY: number;
  }>;
  dispose(): void;
  subscribe(listener: (state: Readonly<WorkspaceSceneState>) => void): () => void;
}

export interface InputTarget {
  terminalId: string;
  kind: 'terminal' | 'key' | 'command' | 'keyboard';
  object?: THREE.Object3D;
}

export interface InputCapture {
  id: string | null;
  title: string | null;
}

export function captureInputTarget(id: string | null, title: string | null): InputCapture {
  return { id, title };
}

export function clearInputTarget(): InputCapture {
  return { id: null, title: null };
}

export function pageRange(
  total: number,
  page: number,
  pageSize: number,
): { start: number; end: number; page: number } {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = ((page % pages) + pages) % pages;
  const start = current * Math.max(1, pageSize);
  return { start, end: Math.min(total, start + Math.max(1, pageSize)), page: current };
}

export function applyPanelTransform(
  object: THREE.Object3D,
  transform: Partial<Pick<PanelTransform, 'position' | 'rotation' | 'scale'>>,
): void {
  if (transform.position) object.position.copy(transform.position);
  if (transform.rotation) object.rotation.copy(transform.rotation);
  if (transform.scale !== undefined)
    object.scale.setScalar(Math.max(0.25, Math.min(3, transform.scale)));
}

export function updateGaze(
  previous: GazeState,
  candidateId: string | null,
  nowMs: number,
  dwellMs = 350,
): GazeState {
  if (!candidateId) return { candidateId: null, emphasizedId: null, since: nowMs };
  if (candidateId !== previous.candidateId) {
    return { candidateId, emphasizedId: previous.emphasizedId, since: nowMs };
  }
  if (candidateId && previous.emphasizedId !== candidateId && nowMs - previous.since >= dwellMs) {
    return { candidateId, emphasizedId: candidateId, since: previous.since };
  }
  return previous;
}

export function routeInput(
  target: InputTarget | null,
  text: string,
  actions: WorkspaceActions,
): boolean {
  if (!target) return false;
  if (target.kind === 'key') {
    actions.selectPane(target.terminalId);
    actions.sendKey(text);
    return true;
  }
  if (target.kind === 'terminal' || target.kind === 'keyboard') {
    actions.selectPane(target.terminalId);
    actions.sendText(text);
    return true;
  }
  return false;
}

const PANEL_WIDTH = 1.42;
const PANEL_HEIGHT = 0.8;
const ACCENT = 0x68d6ff;
const CONTROLLER_RAY_LENGTH = 8;

interface XrSessionLike {
  addEventListener(type: string, listener: () => void): void;
  end(): Promise<void>;
}

interface EventRoot {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

interface TerminalPanel {
  id: string;
  surface: TerminalSurface;
  root: THREE.Group;
  screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.CanvasTexture;
  frame: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  selection: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  unsubscribe: () => void;
  defaultPosition: THREE.Vector3;
  titleLabel: THREE.Mesh;
  width: number;
  height: number;
}

function disposeObject(object: THREE.Object3D): void {
  if (object.userData.disposeLabel) {
    disposeScalableLabel(object);
    return;
  }
  for (const child of [...object.children]) disposeObject(child);
  const mesh = object as THREE.Mesh;
  mesh.geometry?.dispose();
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  for (const material of materials) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'envMap'])
      (material as unknown as Record<string, THREE.Texture | undefined>)[key]?.dispose();
    material.dispose();
  }
}

function createCanvasTexture(surface: TerminalSurface): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(surface.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createLabelButton(
  label: string,
  width: number,
  height: number,
  data: Record<string, unknown>,
): THREE.Mesh {
  const mesh = createScalableLabel(label, width, height, {
    background: '#1c2a35',
    wrap: Boolean(data.wrap),
  });
  Object.assign(mesh.userData, data, { helpText: getControlHelp(data) });
  return mesh;
}

function setModifierVisual(object: THREE.Object3D, armed: boolean): void {
  object.userData.activeState = armed;
  const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
  if (material?.color) material.color.setHex(armed ? ACCENT : 0xffffff);
}

function updateLabel(object: THREE.Mesh, label: string): void {
  if (object.userData.labelText !== label) updateScalableLabel(object, label);
}

function createGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#152a3b');
    gradient.addColorStop(0.55, '#08131e');
    gradient.addColorStop(1, '#020509');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function selectionGeometry(width: number, height: number): THREE.ShapeGeometry {
  const x = (width + 0.07) / 2;
  const y = (height + 0.07) / 2;
  const innerX = (width + 0.01) / 2;
  const innerY = (height + 0.01) / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x, -y).lineTo(x, -y).lineTo(x, y).lineTo(-x, y).closePath();
  const hole = new THREE.Path();
  hole
    .moveTo(-innerX, -innerY)
    .lineTo(-innerX, innerY)
    .lineTo(innerX, innerY)
    .lineTo(innerX, -innerY)
    .closePath();
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape);
}

function createSelection(): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  const material = new THREE.MeshBasicMaterial({
    color: ACCENT,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const line = new THREE.Mesh(selectionGeometry(PANEL_WIDTH, PANEL_HEIGHT), material);
  line.name = 'active-pane-highlight';
  line.position.z = 0.012;
  line.visible = false;
  line.raycast = () => undefined;
  return line;
}

function createKeyStrip(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terminal-key-strip';
  const keys: readonly SemanticKey[] = [
    { label: 'Esc', key: 'Escape' },
    { label: 'Tab', key: 'Tab' },
    { label: 'Ctrl', key: 'Control', modifier: 'ctrl' },
    { label: 'Alt', key: 'Alt', modifier: 'alt' },
    { label: '↑', key: 'ArrowUp' },
    { label: '↓', key: 'ArrowDown' },
    { label: '←', key: 'ArrowLeft' },
    { label: '→', key: 'ArrowRight' },
    { label: 'Enter', key: 'Enter' },
  ];
  for (let i = 0; i < keys.length; i += 1) {
    const key = createLabelButton(keys[i].label, 0.12, 0.035, {
      key: keys[i].key,
      modifier: keys[i].modifier,
    });
    key.position.set((i - (keys.length - 1) / 2) * 0.14, -0.48, 0);
    group.add(key);
  }
  return group;
}

function isControlVisible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent)
    if (!current.visible) return false;
  return true;
}

function createObservatory(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  group.name = 'quiet-orbital-observatory';
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.018, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0x263e52, transparent: true, opacity: 0.6 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.2;
  group.add(ring);
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x172b3e, roughness: 0.85, metalness: 0.08 }),
  );
  planet.position.set(-3.2, 1.2, -5.2);
  group.add(planet);
  scene.add(group);
  return group;
}

export function createWorkspaceScene(
  container: HTMLElement,
  actions: WorkspaceActions,
): WorkspaceScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.01, 100);
  camera.position.set(0, 1.52, 0.45);
  camera.lookAt(0, 1.42, -1.05);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Mux XR workspace');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  let renderer: THREE.WebGLRenderer | null = null;
  let rendererError: string | null = null;
  let gradientTexture: THREE.CanvasTexture | null = null;
  const desktopCameraPosition = camera.position.clone();
  const desktopCameraQuaternion = camera.quaternion.clone();
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.xr.enabled = true;
  } catch (error) {
    rendererError = error instanceof Error ? error.message : 'WebGL renderer initialization failed';
  }
  const ambient = new THREE.AmbientLight(0x9db5c8, 0.7);
  const key = new THREE.DirectionalLight(0xb8dfff, 1.2);
  key.position.set(-2, 4, 4);
  scene.add(ambient, key);
  const observatory = createObservatory(scene);
  const panels = new Map<string, TerminalPanel>();
  const listeners = new Set<(state: Readonly<WorkspaceSceneState>) => void>();
  const mutableState: WorkspaceSceneState = {
    selectedTerminalId: null,
    background: 'observatory',
    gazeInputEnabled: false,
    terminalColorMode: 'comfort',
    keyboardBackgroundEnabled: true,
    fps: null,
    xrMode: 'desktop',
    focusedTerminalId: null,
    rendererError,
    inputTargetId: null,
    inputTargetTitle: null,
    updateAvailable: false,
    arrangement: null,
    notice: null,
  };
  let disposed = false;
  let frameHandle = 0;
  const raycaster = new THREE.Raycaster();
  const controllerRoots: THREE.Group[] = [];
  const controllerListeners: Array<{
    root: THREE.Group;
    onSelect: (event: Event) => void;
    onSqueeze: (event: Event) => void;
    onSqueezeEnd: (event: Event) => void;
    onConnected: (event: Event) => void;
    onDisconnected: (event: Event) => void;
  }> = [];
  const tempMatrix = new THREE.Matrix4();
  const dragStates = new Map<
    THREE.Group,
    {
      object: THREE.Group;
      localOffset: THREE.Vector3;
      relativeRotation: THREE.Quaternion;
      gamepad?: Gamepad;
    }
  >();
  const pairGrabs = new Map<
    THREE.Group,
    {
      controllers: [THREE.Group, THREE.Group];
      distance: number;
      direction: THREE.Vector3;
      midpoint: THREE.Vector3;
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: number;
    }
  >();
  let recenterSince: number | null = null;
  let recenterLatched = false;
  const captureGrab = (controller: THREE.Group, object: THREE.Group): void => {
    controller.updateMatrixWorld(true);
    object.updateMatrixWorld(true);
    const rotation = controller.getWorldQuaternion(new THREE.Quaternion());
    dragStates.set(controller, {
      object,
      localOffset: object
        .getWorldPosition(new THREE.Vector3())
        .sub(controller.getWorldPosition(new THREE.Vector3()))
        .applyQuaternion(rotation.clone().invert()),
      relativeRotation: rotation
        .clone()
        .invert()
        .multiply(object.getWorldQuaternion(new THREE.Quaternion())),
      gamepad: controllerGamepads.get(controller),
    });
  };
  const releaseGrab = (controller: THREE.Group): void => {
    const object = dragStates.get(controller)?.object;
    dragStates.delete(controller);
    if (!object) return;
    const pair = pairGrabs.get(object);
    if (!pair) return;
    pairGrabs.delete(object);
    for (const remaining of pair.controllers)
      if (remaining !== controller && dragStates.has(remaining)) captureGrab(remaining, object);
  };
  const beginPairGrab = (object: THREE.Group, first: THREE.Group, second: THREE.Group): void => {
    first.updateMatrixWorld(true);
    second.updateMatrixWorld(true);
    const a = first.getWorldPosition(new THREE.Vector3());
    const b = second.getWorldPosition(new THREE.Vector3());
    const direction = b.clone().sub(a);
    const distance = direction.length();
    if (distance < 0.05) {
      dragStates.delete(second);
      return;
    }
    pairGrabs.set(object, {
      controllers: [first, second],
      distance,
      direction: direction.normalize(),
      midpoint: a.add(b).multiplyScalar(0.5),
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.x,
    });
  };
  const availablePanes: PaneDescriptor[] = [];
  const controllerGamepads = new Map<THREE.Group, Gamepad>();
  const disconnectedControllers = new Set<THREE.Group>();
  const heldControllers = new Set<THREE.Group>();
  let previousRenderTime: number | null = null;
  const frameCounter = createFrameCounter();
  let fpsLabel: THREE.Mesh | null = null;
  let gridDraft: { target: string; cols: number; rows: number } | null = null;
  let gridRequestStatus = '';
  let gazeRetargeting = false;
  let quickCommands: QuickCommand[] = [];
  let menuCommands: QuickCommand[] = [];
  let commandDraft: CommandDraft | null = null;
  let commandWorkspaceId: string | undefined;
  let commandEditorMessage = '';
  let commandPage = 0;
  let inputRoot: THREE.Group | null = null;
  let hudRoot: THREE.Group | null = null;
  let updateNotice: THREE.Mesh | null = null;
  let statusNotice: THREE.Mesh | null = null;
  let activeSession: XrSessionLike | null = null;
  let inputMode: InputMode = 'commands';
  let panePage = 0;
  let armedModifiers: KeyModifiers = {};
  let hierarchyLevel: 'workspace' | 'session' | 'window' | 'pane' = 'workspace';
  let hierarchyWorkspaceId: string | null = null;
  let hierarchySessionId: string | null = null;
  let hierarchyWindowId: string | null = null;
  let gazeInputState: GazeState = { candidateId: null, emphasizedId: null, since: 0 };
  let lastRayDistance = CONTROLLER_RAY_LENGTH;
  const hoveredByController = new Map<THREE.Group, THREE.Object3D>();
  let inputTransform: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: number;
  } | null = null;
  const pointer = new THREE.Vector2();
  const clearArmedModifiers = (): void => {
    inputRoot?.traverse((object) => {
      if (object.userData.modifier) setModifierVisual(object, false);
    });
    armedModifiers = {};
  };

  const notify = (): void => {
    for (const listener of listeners) listener(mutableState);
  };
  const hoverHelp = createLabelButton('', 0.32, 0.05, { wrap: true });
  hoverHelp.name = 'xr-hover-help';
  hoverHelp.visible = false;
  hoverHelp.raycast = () => undefined;
  scene.add(hoverHelp);
  let hoveredControl: THREE.Object3D | null = null;
  let hoverSince = 0;
  const showHover = (object: THREE.Object3D | null, now = performance.now()): void => {
    const help = object?.userData.helpText as string | undefined;
    if (!help || dragStates.size) {
      hoveredControl = null;
      hoverHelp.visible = false;
      canvas.title = '';
      return;
    }
    if (hoveredControl !== object) {
      hoveredControl = object;
      hoverSince = now;
    }
    canvas.title = help;
    hoverHelp.visible = now - hoverSince >= 700;
    if (hoverHelp.visible) updateLabel(hoverHelp, help);
  };
  const updateHoverPosition = (): void => {
    if (!hoveredControl || !hoverHelp.visible) return;
    let owner: THREE.Object3D = hoveredControl;
    while (owner.parent) owner = owner.parent;
    if (owner !== scene) {
      showHover(null);
      return;
    }
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      view.getWorldQuaternion(new THREE.Quaternion()),
    );
    const distance = hoveredControl
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(view.getWorldPosition(new THREE.Vector3()));
    const tooltipScale = THREE.MathUtils.clamp(distance / 1.4, 0.3, 6);
    hoverHelp.scale.setScalar(tooltipScale);
    hoverHelp.position
      .copy(hoveredControl.getWorldPosition(new THREE.Vector3()))
      .addScaledVector(up, 0.075 * tooltipScale);
    hoverHelp.quaternion.copy(view.getWorldQuaternion(new THREE.Quaternion()));
  };
  const setPointerRay = (event: PointerEvent): boolean => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    return true;
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (renderer?.xr.isPresenting) return;
    if (!setPointerRay(event)) return;
    activateTarget(targetFromRay());
    showHover(null);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (renderer?.xr.isPresenting) return;
    if (!setPointerRay(event)) return;
    showHover(targetFromRay()?.object ?? null);
    updateHoverPosition();
  };
  const onPointerLeave = (): void => {
    if (!renderer?.xr.isPresenting) showHover(null);
  };
  const resize = (): void => {
    const width = Math.max(1, container.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, container.clientHeight || window.innerHeight || 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!renderer?.xr.isPresenting) {
      const panelSpan = PANEL_WIDTH + 1.74;
      const horizontalFov =
        2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(58) / 2) * camera.aspect);
      const distance = panelSpan / 2 / Math.tan(horizontalFov / 2) / 0.85;
      camera.position.z = -1.5 + distance;
      camera.lookAt(0, 1.42, -1.5);
      desktopCameraPosition.copy(camera.position);
      desktopCameraQuaternion.copy(camera.quaternion);
    }
    renderer?.setSize(width, height, false);
  };
  const render = (time = 0): void => {
    if (disposed) return;
    const deltaSeconds =
      previousRenderTime === null
        ? 1 / 60
        : THREE.MathUtils.clamp((time - previousRenderTime) / 1000, 0, 0.05);
    previousRenderTime = time;
    const fps = frameCounter.sample(time);
    if (fps !== null) {
      mutableState.fps = fps;
      if (fpsLabel) updateLabel(fpsLabel, `FPS ${fps}`);
    }
    if (inputMode === 'terminal' && inputRoot) {
      const surface = mutableState.inputTargetId
        ? panels.get(mutableState.inputTargetId)?.surface
        : undefined;
      const status = inputRoot.getObjectByName('terminal-grid-status') as THREE.Mesh | undefined;
      if (status && surface)
        updateLabel(
          status,
          `${surface.cols} × ${surface.rows}${surface.canResizeGrid ? '' : ' · read-only/disconnected'}`,
        );
    }
    if (renderer?.xr.isPresenting) {
      const bothSticks =
        heldControllers.size === 0 &&
        controllerRoots.length === 2 &&
        controllerRoots.every(
          (controller) =>
            controller.visible &&
            !disconnectedControllers.has(controller) &&
            controllerGamepads.get(controller)?.buttons[3]?.pressed,
        );
      if (!bothSticks) {
        recenterSince = null;
        recenterLatched = false;
      } else if (recenterSince === null) recenterSince = time;
      else if (!recenterLatched && time - recenterSince >= 1000) {
        resetLayout();
        recenterLatched = true;
      }
    }
    for (const [object, pair] of pairGrabs) {
      const [first, second] = pair.controllers;
      first.updateMatrixWorld(true);
      second.updateMatrixWorld(true);
      const a = first.getWorldPosition(new THREE.Vector3());
      const b = second.getWorldPosition(new THREE.Vector3());
      const direction = b.clone().sub(a);
      const distance = direction.length();
      if (distance < 0.05) continue;
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        pair.direction,
        direction.divideScalar(distance),
      );
      object.position.copy(pair.position).add(a.add(b).multiplyScalar(0.5).sub(pair.midpoint));
      object.quaternion.copy(rotation).multiply(pair.quaternion);
      const limits = object.userData.scaleLimits as [number, number];
      object.scale.setScalar(
        THREE.MathUtils.clamp((pair.scale * distance) / pair.distance, limits[0], limits[1]),
      );
    }
    for (const [controller, drag] of dragStates) {
      if (pairGrabs.has(drag.object)) continue;
      controller.updateMatrixWorld(true);
      const controllerPosition = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
      const controllerQuaternion = controller.getWorldQuaternion(new THREE.Quaternion());
      const gamepad = drag.gamepad;
      if (gamepad) {
        const axes = gamepad.axes;
        const x = axes.length >= 4 ? axes[2] : (axes[axes.length - 2] ?? 0);
        const y = axes.length >= 4 ? axes[3] : (axes[axes.length - 1] ?? 0);
        const deadzone = 0.15;
        const applyDeadzone = (value: number): number =>
          Math.abs(value) < deadzone ? 0 : (value - Math.sign(value) * deadzone) / (1 - deadzone);
        const horizontal = applyDeadzone(x) * 0.9 * deltaSeconds;
        const vertical = -applyDeadzone(y) * deltaSeconds;
        if (gamepad.buttons[0]?.pressed) {
          drag.relativeRotation.premultiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), horizontal),
          );
          drag.localOffset.z = THREE.MathUtils.clamp(drag.localOffset.z - vertical * 0.8, -6, -0.3);
        } else {
          drag.relativeRotation
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -horizontal),
            )
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -vertical * 0.9),
            );
        }
      }
      const finalPosition = controllerPosition
        .clone()
        .add(drag.localOffset.clone().applyQuaternion(controllerQuaternion));
      drag.object.position.copy(finalPosition);
      drag.object.quaternion.copy(controllerQuaternion).multiply(drag.relativeRotation);
    }
    if (mutableState.gazeInputEnabled) {
      const gazeCamera = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
      scene.updateMatrixWorld(true);
      gazeCamera.updateMatrixWorld(true);
      raycaster.far = CONTROLLER_RAY_LENGTH;
      const origin = new THREE.Vector3().setFromMatrixPosition(gazeCamera.matrixWorld);
      const direction = gazeCamera.getWorldDirection(new THREE.Vector3());
      raycaster.set(origin, direction);
      const hit = raycaster
        .intersectObjects(
          [...panels.values()].map((panel) => panel.root).concat(inputRoot ? [inputRoot] : []),
          true,
        )
        .find((entry) => isControlVisible(entry.object))?.object;
      let target: THREE.Object3D | null = hit ?? null;
      while (target && !target.userData.terminalId) target = target.parent;
      if (
        mutableState.gazeInputEnabled &&
        mutableState.xrMode !== 'desktop' &&
        inputMode !== 'command-editor' &&
        dragStates.size === 0
      ) {
        const nextGaze = updateGaze(
          gazeInputState,
          (target?.userData.terminalId as string | undefined) ?? null,
          time,
        );
        if (nextGaze.emphasizedId && nextGaze.emphasizedId !== gazeInputState.emphasizedId) {
          gazeRetargeting = true;
          selectTerminal(nextGaze.emphasizedId);
          gazeRetargeting = false;
        }
        gazeInputState = nextGaze;
      }
      if (dragStates.size) gazeInputState = { candidateId: null, emphasizedId: null, since: time };
    }
    if (renderer?.xr.isPresenting) {
      let hover: THREE.Object3D | null = null;
      let bodyHover: THREE.Object3D | null = null;
      let controlTargeted = false;
      const nextHovered = new Map<THREE.Group, THREE.Object3D>();
      for (const controller of controllerRoots) {
        if (!controller.visible || disconnectedControllers.has(controller)) continue;
        controller.updateMatrixWorld(true);
        const target = targetFromController(controller);
        const distance =
          (controller.userData.rayDistance as number | undefined) ?? CONTROLLER_RAY_LENGTH;
        const line = controller.children.find((child) => child instanceof THREE.Line) as
          | THREE.Line
          | undefined;
        if (line) line.scale.z = distance / CONTROLLER_RAY_LENGTH;
        const contact = controller.children.find((child) => child instanceof THREE.Mesh) as
          | THREE.Mesh
          | undefined;
        if (contact) {
          contact.position.set(0, 0, -distance);
          contact.visible = Boolean(target?.object);
        }
        const object = target?.object;
        if (object?.userData.labelText !== undefined) {
          controlTargeted = true;
          if (object.userData.helpText) hover ??= object;
        } else if (object?.userData.helpText) bodyHover ??= object;
        if (
          object &&
          object.userData.labelText !== undefined &&
          (object.userData.inputAction || object.userData.key)
        ) {
          nextHovered.set(controller, object);
        }
      }
      const allHovered = new Set(nextHovered.values());
      for (const previous of hoveredByController.values()) {
        if (allHovered.has(previous)) continue;
        const material = (previous as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        const modifier = previous.userData.modifier as keyof KeyModifiers | undefined;
        if (material?.color)
          material.color.setHex(
            (modifier && armedModifiers[modifier]) || previous.userData.activeState
              ? ACCENT
              : 0xffffff,
          );
      }
      for (const object of allHovered) {
        const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (material?.color) material.color.setHex(0x9deaff);
      }
      hoveredByController.clear();
      for (const [controller, object] of nextHovered) hoveredByController.set(controller, object);
      showHover(hover ?? (controlTargeted ? null : bodyHover), time);
    }
    if (!renderer?.xr.isPresenting && hoveredControl) showHover(hoveredControl, time);
    if (updateNotice)
      updateNotice.visible = mutableState.updateAvailable && Boolean(renderer?.xr.isPresenting);
    updateHoverPosition();
    observatory.rotation.y = time * 0.00001;
    renderer?.render(scene, camera);
    if (!renderer && typeof window.requestAnimationFrame === 'function')
      frameHandle = window.requestAnimationFrame(render);
  };
  resize();
  if (renderer) renderer.setAnimationLoop((time: number) => render(time));
  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointercancel', onPointerLeave);

  const setSelectedVisual = (): void => {
    for (const panel of panels.values())
      panel.selection.visible = panel.id === mutableState.selectedTerminalId;
  };
  const clearInputRoot = (): void => {
    if (!inputRoot) return;
    for (const [controller, drag] of [...dragStates])
      if (drag.object === inputRoot) releaseGrab(controller);
    pairGrabs.delete(inputRoot);
    for (const [controller, object] of hoveredByController)
      if (inputRoot.getObjectById(object.id)) hoveredByController.delete(controller);
    if (hoveredControl && inputRoot.getObjectById(hoveredControl.id)) showHover(null);
    scene.remove(inputRoot);
    disposeObject(inputRoot);
    inputRoot = null;
  };
  const clearInputCapture = (): void => {
    mutableState.inputTargetId = null;
    mutableState.inputTargetTitle = null;
    menuCommands = [];
    gridDraft = null;
    gridRequestStatus = '';
    commandPage = 0;
    clearArmedModifiers();
  };
  const resetInputPose = (): void => {
    inputTransform = null;
    if (!inputRoot) return;
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    view.updateMatrixWorld(true);
    inputRoot.position
      .copy(view.getWorldPosition(new THREE.Vector3()))
      .addScaledVector(view.getWorldDirection(new THREE.Vector3()), 1.15);
    inputRoot.position.y -= 0.2;
    inputRoot.quaternion.copy(view.getWorldQuaternion(new THREE.Quaternion()));
    inputRoot.scale.setScalar(0.38);
  };
  const refreshInputRoot = (mode: InputMode): void => {
    inputMode = mode;
    const previousRoot = inputRoot;
    const previousPair = previousRoot ? pairGrabs.get(previousRoot) : undefined;
    if (previousRoot) pairGrabs.delete(previousRoot);
    const grabbedControllers = inputRoot
      ? [...dragStates.entries()]
          .filter(([, drag]) => drag.object === inputRoot)
          .map(([controller]) => controller)
      : [];
    if (inputRoot) {
      inputRoot.updateMatrixWorld(true);
      inputTransform = {
        position: inputRoot.position.clone(),
        quaternion: inputRoot.quaternion.clone(),
        scale: inputRoot.scale.x,
      };
    }
    clearInputRoot();
    inputRoot = new THREE.Group();
    inputRoot.name = `xr-${mode}-controls`;
    inputRoot.userData.scaleLimits = [0.18, 0.9];
    if (inputTransform) {
      inputRoot.position.copy(inputTransform.position);
      inputRoot.quaternion.copy(inputTransform.quaternion);
      inputRoot.scale.setScalar(inputTransform.scale);
    } else resetInputPose();
    for (const controller of grabbedControllers) {
      captureGrab(controller, inputRoot);
    }
    if (previousPair) beginPairGrab(inputRoot, ...previousPair.controllers);
    const modeCommands = createLabelButton('Commands', 0.28, 0.09, {
      inputAction: 'mode',
      mode: 'commands',
    });
    const modeKeyboard = createLabelButton('Keyboard', 0.28, 0.09, {
      inputAction: 'mode',
      mode: 'keyboard',
    });
    modeCommands.position.set(-0.2, 0.7, 0);
    modeKeyboard.position.set(0.2, 0.7, 0);
    if (mode !== 'command-editor') inputRoot.add(modeCommands, modeKeyboard);
    if (mode === 'commands') {
      const add = createLabelButton('New command', 0.5, 0.09, { inputAction: 'newCommand' });
      add.position.set(0.75, 0.7, 0);
      inputRoot.add(add);
    }
    if (mode === 'keyboard') {
      const backdropToggle = createLabelButton(
        `Backing: ${mutableState.keyboardBackgroundEnabled ? 'on' : 'off'}`,
        0.34,
        0.09,
        { inputAction: 'keyboardBackground' },
      );
      backdropToggle.position.set(0.65, 0.7, 0);
      inputRoot.add(backdropToggle);
    }
    const gazeToggle = createLabelButton(
      `Gaze input: ${mutableState.gazeInputEnabled ? 'on' : 'off'}`,
      0.34,
      0.08,
      {
        inputAction: 'gazeInput',
      },
    );
    gazeToggle.position.set(0, 0.84, 0);
    if (mode !== 'command-editor') inputRoot.add(gazeToggle);
    const targetTitle = mutableState.inputTargetTitle
      ? `Target: ${mutableState.inputTargetTitle}`
      : 'No target selected';
    const title = createLabelButton(
      mode === 'command-editor'
        ? commandEditorMessage || 'New quick command'
        : mode === 'arrange'
          ? 'Arrange terminals'
          : `${mode === 'commands' ? 'Quick commands' : mode === 'keyboard' ? 'Keyboard' : mode === 'terminal' ? 'Terminal settings' : `Panes · ${hierarchyLevel}`} · ${targetTitle}`,
      0.9,
      0.12,
      { inputAction: 'grabInput' },
    );
    title.userData.dragHandle = true;
    title.position.y = mode === 'command-editor' ? 0.88 : 0.56;
    inputRoot.add(title);
    if (mode === 'command-editor' && commandDraft) {
      for (const [field, y] of [
        ['label', 0.7],
        ['text', 0.56],
      ] as const) {
        const value = Array.from(commandDraft[field]);
        const active = commandDraft.field === field;
        if (active) value.splice(commandDraft.cursor, 0, '|');
        const start = active ? Math.max(0, commandDraft.cursor - 28) : 0;
        const button = createLabelButton(
          `${field === 'label' ? 'Name' : 'Command'}: ${start ? '…' : ''}${value.slice(start, start + 56).join('')}`,
          1.5,
          0.1,
          { inputAction: 'commandField', field, wrap: true },
        );
        button.position.y = y;
        setModifierVisual(button, active);
        inputRoot.add(button);
      }
      const scope = createLabelButton(
        commandDraft.scope === 'global' ? 'Global' : 'Workspace',
        0.5,
        0.09,
        { inputAction: 'commandScope' },
      );
      scope.position.set(-0.55, 1.04, 0);
      const enter = createLabelButton(
        `Enter: ${commandDraft.sendNewline ? 'on' : 'off'}`,
        0.5,
        0.09,
        { inputAction: 'commandNewline' },
      );
      enter.position.set(0, 1.04, 0);
      const save = createLabelButton('Save', 0.4, 0.09, { inputAction: 'commandSave' });
      save.position.set(0.55, 1.04, 0);
      const clear = createLabelButton('Clear field', 0.45, 0.09, { inputAction: 'commandClear' });
      clear.position.set(-0.28, -0.53, 0);
      const cancel = createLabelButton('Cancel', 0.4, 0.09, { inputAction: 'commandCancel' });
      cancel.position.set(0.28, -0.53, 0);
      inputRoot.add(scope, enter, save, clear, cancel);
    }
    if (mode === 'arrange') {
      const status = createLabelButton(
        panels.size
          ? `${panels.size} terminals · keep sizes and input target`
          : 'Open terminals first',
        1.5,
        0.1,
        { inputAction: 'noop' },
      );
      status.position.y = 0.36;
      inputRoot.add(status);
      if (panels.size) {
        const patterns: Array<[string, PanelArrangement]> = [
          ['Row', 'row'],
          ['Grid', 'grid'],
          ['Arc', 'arc'],
          ['Sphere', 'sphere'],
        ];
        patterns.forEach(([label, pattern], index) => {
          const button = createLabelButton(label, 0.65, 0.14, {
            inputAction: 'arrange',
            pattern,
          });
          button.position.set(index % 2 ? 0.38 : -0.38, 0.16 - Math.floor(index / 2) * 0.2, 0);
          setModifierVisual(button, mutableState.arrangement === pattern);
          inputRoot?.add(button);
        });
      }
    } else if (mode === 'panes') {
      const visible = availablePanes.filter(
        (pane) =>
          hierarchyLevel === 'workspace' ||
          (hierarchyLevel === 'session' && pane.workspaceId === hierarchyWorkspaceId) ||
          (hierarchyLevel === 'window' &&
            pane.workspaceId === hierarchyWorkspaceId &&
            pane.sessionId === hierarchySessionId) ||
          (hierarchyLevel === 'pane' &&
            pane.workspaceId === hierarchyWorkspaceId &&
            pane.sessionId === hierarchySessionId &&
            pane.windowId === hierarchyWindowId),
      );
      const groups = new Map<string, PaneDescriptor[]>();
      visible.forEach((pane) => {
        const key =
          hierarchyLevel === 'workspace'
            ? pane.workspaceId
            : hierarchyLevel === 'session'
              ? pane.sessionId
              : hierarchyLevel === 'window'
                ? pane.windowId
                : pane.id;
        groups.set(key, [...(groups.get(key) ?? []), pane]);
      });
      [...groups.values()].slice(panePage * 4, panePage * 4 + 4).forEach((group, index) => {
        const pane = group[0];
        const label =
          hierarchyLevel === 'workspace'
            ? pane.workspaceName
            : hierarchyLevel === 'session'
              ? pane.sessionName
              : hierarchyLevel === 'window'
                ? pane.windowName
                : `${pane.title} · ${pane.sessionName}/${pane.windowName}`;
        const button = createLabelButton(label, 0.78, 0.11, {
          inputAction: hierarchyLevel === 'pane' ? 'pane' : 'hierarchyNext',
          hierarchyKey: pane.id,
          paneId: pane.id,
        });
        button.position.set(index % 2 ? 0.42 : -0.42, 0.4 - Math.floor(index / 2) * 0.15, 0);
        inputRoot?.add(button);
      });
      if (groups.size > 4) {
        const page = createLabelButton('Next page', 0.28, 0.08, { inputAction: 'panePage' });
        page.position.set(0.2, -0.18, 0);
        inputRoot.add(page);
      }
      if (hierarchyLevel !== 'workspace') {
        const back = createLabelButton('Back', 0.25, 0.08, { inputAction: 'hierarchyBack' });
        back.position.set(-0.2, -0.18, 0);
        inputRoot.add(back);
      }
    } else if (mode === 'commands') {
      const pageStart = panePage * 4;
      availablePanes.slice(pageStart, pageStart + 4).forEach((pane, index) => {
        const button = createLabelButton(`Pane: ${pane.title}`, 0.7, 0.11, {
          inputAction: 'pane',
          paneId: pane.id,
        });
        button.position.set(index % 2 ? 0.4 : -0.4, 0.4 - Math.floor(index / 2) * 0.14, 0);
        inputRoot?.add(button);
      });
      if (availablePanes.length > 4) {
        const page = createLabelButton(
          `Panes ${pageStart + 1}-${Math.min(pageStart + 4, availablePanes.length)} · Next`,
          0.7,
          0.1,
          { inputAction: 'panePage' },
        );
        page.position.set(0, -0.18, 0);
        inputRoot.add(page);
      }
      const commandStart = commandPage * 8;
      menuCommands.slice(commandStart, commandStart + 8).forEach((command, index) => {
        const button = createLabelButton(command.label, 0.7, 0.11, {
          inputAction: 'command',
          commandId: command.id,
        });
        const row = Math.floor((index + Math.min(availablePanes.length, 4)) / 2);
        button.position.set(index % 2 ? 0.4 : -0.4, 0.4 - row * 0.14, 0);
        inputRoot?.add(button);
      });
      if (menuCommands.length > 8) {
        const page = createLabelButton(
          `Commands ${commandStart + 1}-${Math.min(commandStart + 8, menuCommands.length)} · Next`,
          0.7,
          0.1,
          { inputAction: 'commandPage' },
        );
        page.position.set(0, -0.45, 0);
        inputRoot.add(page);
      }
    } else if (mode === 'terminal') {
      const target = mutableState.inputTargetId;
      const surface = target ? panels.get(target)?.surface : undefined;
      if (surface && target) {
        if (gridDraft?.target !== target)
          gridDraft = { target, cols: surface.cols, rows: surface.rows };
        const status = createLabelButton(`${surface.cols} × ${surface.rows}`, 0.9, 0.1, {
          inputAction: 'noop',
        });
        status.name = 'terminal-grid-status';
        status.position.y = 0.4;
        inputRoot.add(status);
        [
          [80, 24],
          [100, 30],
          [120, 36],
          [160, 48],
        ].forEach(([cols, rows], index) => {
          const button = createLabelButton(`${cols}×${rows}`, 0.34, 0.09, {
            inputAction: 'gridPreset',
            cols,
            rows,
          });
          button.position.set((index - 1.5) * 0.39, 0.25, 0);
          inputRoot?.add(button);
        });
        for (const [axis, y] of [
          ['cols', 0.1],
          ['rows', -0.04],
        ] as const) {
          const caption = createLabelButton(
            `${axis === 'cols' ? 'Cols' : 'Rows'}: ${gridDraft[axis]}`,
            0.35,
            0.09,
            { inputAction: 'noop' },
          );
          caption.position.set(0, y, 0);
          inputRoot.add(caption);
          [-10, -1, 1, 10].forEach((delta, index) => {
            const button = createLabelButton(delta > 0 ? `+${delta}` : String(delta), 0.25, 0.09, {
              inputAction: 'gridStep',
              axis,
              delta,
            });
            button.position.set([-0.72, -0.4, 0.4, 0.72][index], y, 0);
            inputRoot?.add(button);
          });
        }
        const apply = createLabelButton(gridRequestStatus || 'Apply grid', 0.9, 0.09, {
          inputAction: 'gridApply',
        });
        apply.position.y = -0.2;
        inputRoot.add(apply);
      }
      const modes: Array<[string, TerminalColorMode]> = [
        ['Comfort', 'comfort'],
        ['Original', 'original'],
        ['Mono', 'monochrome'],
      ];
      modes.forEach(([label, colorMode], index) => {
        const button = createLabelButton(label, 0.34, 0.09, {
          inputAction: 'terminalColors',
          colorMode,
        });
        button.position.set((index - 1) * 0.4, -0.36, 0);
        setModifierVisual(button, mutableState.terminalColorMode === colorMode);
        inputRoot?.add(button);
      });
      const modeStatus = createLabelButton(
        `Colors: ${mutableState.terminalColorMode}`,
        1.08,
        0.05,
        { inputAction: 'noop' },
      );
      modeStatus.position.y = -0.455;
      inputRoot.add(modeStatus);
    } else {
      semanticKeyboardLayout.forEach((row, rowIndex) => {
        const widths = row.map((key) =>
          key.key === ' ' ? 0.9 : key.label.length > 4 ? 0.27 : 0.17,
        );
        let left =
          -(widths.reduce((total, width) => total + width, 0) + (row.length - 1) * 0.025) / 2;
        row.forEach((key, columnIndex) => {
          const width = widths[columnIndex];
          const x = left + width / 2;
          left += width + 0.025;
          const button = createLabelButton(
            key.key.length === 1 && key.key !== ' '
              ? terminalKeyLabel(key.key, Boolean(armedModifiers.shift))
              : key.label,
            width,
            0.1,
            {
              inputAction: 'key',
              key: key.key,
              modifier: key.modifier,
            },
          );
          if (key.modifier) setModifierVisual(button, Boolean(armedModifiers[key.modifier]));
          button.position.set(x, 0.4 - rowIndex * 0.13, 0);
          inputRoot?.add(button);
        });
      });
    }
    const close = createLabelButton('Close', 0.3, 0.09, { inputAction: 'close' });
    close.position.set(0, -0.66, 0);
    const black = createLabelButton('Black', 0.22, 0.08, {
      inputAction: 'background',
      background: 'black',
    });
    const gradient = createLabelButton('Gradient', 0.25, 0.08, {
      inputAction: 'background',
      background: 'gradient',
    });
    const observatory = createLabelButton('Observatory', 0.3, 0.08, {
      inputAction: 'background',
      background: 'observatory',
    });
    black.position.set(-0.38, -0.53, 0);
    gradient.position.set(-0.08, -0.53, 0);
    observatory.position.set(0.3, -0.53, 0);
    inputRoot.add(close);
    if (mode !== 'command-editor') inputRoot.add(black, gradient, observatory);
    inputRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const child of inputRoot.children) {
      const geometry = (child as THREE.Mesh).geometry;
      if (!geometry) continue;
      geometry.computeBoundingBox();
      if (geometry.boundingBox)
        bounds.union(geometry.boundingBox.clone().applyMatrix4(child.matrix));
    }
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x + 0.12, size.y + 0.12),
      new THREE.MeshBasicMaterial({ color: 0x0d1720 }),
    );
    backing.position.copy(center);
    backing.position.z = -0.015;
    backing.name = 'input-backdrop';
    if (
      (mode === 'keyboard' || mode === 'command-editor') &&
      !mutableState.keyboardBackgroundEnabled
    ) {
      backing.material.transparent = true;
      backing.material.opacity = 0;
      backing.material.depthWrite = false;
    }
    backing.userData.inputAction = 'grabInput';
    backing.userData.helpText = getControlHelp({ inputAction: 'grabInput' });
    inputRoot.add(backing);
    scene.add(inputRoot);
  };
  const createHud = (): void => {
    hudRoot = new THREE.Group();
    hudRoot.name = 'xr-workspace-hud';
    hudRoot.userData.scaleLimits = [0.25, 1.4];
    hudRoot.position.set(0, 0.78, -1.35);
    hudRoot.scale.setScalar(0.62);
    const controls: Array<[string, Record<string, unknown>]> = [
      ['Commands', { inputAction: 'openInput', mode: 'commands' }],
      ['Keyboard', { inputAction: 'openInput', mode: 'keyboard' }],
      ['Panes', { inputAction: 'openInput', mode: 'panes' }],
      ['Terminal', { inputAction: 'openInput', mode: 'terminal' }],
      ['Arrange', { inputAction: 'openInput', mode: 'arrange' }],
      ['Exit', { inputAction: 'exit' }],
      ['Black', { inputAction: 'background', background: 'black' }],
      ['Gradient', { inputAction: 'background', background: 'gradient' }],
      ['Observatory', { inputAction: 'background', background: 'observatory' }],
      ['Gaze input: off', { inputAction: 'gazeInput', gazeInputEnabled: false }],
    ];
    controls.forEach(([label, data], index) => {
      const button = createLabelButton(label, label === 'Observatory' ? 0.34 : 0.27, 0.09, data);
      button.position.x = (index - (controls.length - 1) / 2) * 0.31;
      hudRoot?.add(button);
    });
    updateNotice = createLabelButton('Update: Reload', 0.42, 0.09, { inputAction: 'reloadUpdate' });
    updateNotice.position.set(0, 0.16, 0);
    updateNotice.visible = false;
    hudRoot.add(updateNotice);
    statusNotice = createLabelButton(mutableState.notice ?? '', 1.4, 0.075, {
      inputAction: 'noop',
      wrap: true,
    });
    statusNotice.position.set(0, 0.3, 0);
    statusNotice.visible = Boolean(mutableState.notice);
    hudRoot.add(statusNotice);
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(controls.length * 0.31 + 0.08, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x0d1720 }),
    );
    backing.position.z = -0.015;
    backing.userData.inputAction = 'grabInput';

    hudRoot.add(backing);
    fpsLabel = createLabelButton('FPS --', 0.24, 0.055, { inputAction: 'noop' });
    (fpsLabel.material as THREE.MeshBasicMaterial).opacity = 0;
    (fpsLabel.material as THREE.MeshBasicMaterial).depthWrite = false;
    fpsLabel.name = 'xr-fps-counter';
    fpsLabel.position.set(1.12, 0.13, 0);
    hudRoot.add(fpsLabel);
    scene.add(hudRoot);
  };
  const setUpdateAvailable = (available: boolean): void => {
    if (mutableState.updateAvailable === available) return;
    mutableState.updateAvailable = available;
    if (updateNotice) updateNotice.visible = available && Boolean(renderer?.xr.isPresenting);
    notify();
  };
  const setNotice = (message: string | null): void => {
    if (mutableState.notice === message) return;
    mutableState.notice = message;
    if (statusNotice) {
      statusNotice.visible = Boolean(message);
      updateLabel(statusNotice, message ?? '');
    }
    notify();
  };
  const panelFitsPreview = (panel: TerminalPanel): boolean => {
    camera.updateMatrixWorld(true);
    panel.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(panel.root);
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(camera);
          if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 0.98 || Math.abs(point.y) > 0.98)
            return false;
        }
    return true;
  };
  const resizePanel = (panel: TerminalPanel, direction: number): void => {
    const current = panel.root.scale.x;
    const next = Math.max(0.6, Math.min(1.8, current + direction * 0.1));
    panel.root.scale.setScalar(next);
    if (!renderer?.xr.isPresenting && next > current && !panelFitsPreview(panel)) {
      let low = current;
      let high = next;
      for (let step = 0; step < 12; step += 1) {
        const middle = (low + high) / 2;
        panel.root.scale.setScalar(middle);
        if (panelFitsPreview(panel)) low = middle;
        else high = middle;
      }
      panel.root.scale.setScalar(low);
    }
    notify();
  };
  const scaleSelectedPanel = (direction: number): void => {
    const selected = mutableState.selectedTerminalId;
    const panel = selected ? panels.get(selected) : undefined;
    if (panel) resizePanel(panel, direction);
  };
  const handleInputTarget = (hit: THREE.Object3D): boolean => {
    const action = hit.userData.inputAction as string | undefined;
    if (!action || action === 'noop') return false;
    if (action === 'close') {
      commandDraft = null;
      hideInput();
      return true;
    }
    if (action === 'grabInput') return true;
    if (action === 'newCommand') {
      commandDraft = createCommandDraft(crypto.randomUUID());
      commandWorkspaceId = availablePanes.find(
        (pane) => pane.id === mutableState.inputTargetId,
      )?.workspaceId;
      commandEditorMessage = '';
      clearArmedModifiers();
      refreshInputRoot('command-editor');
      return true;
    }
    if (action === 'commandCancel') {
      commandDraft = null;
      commandEditorMessage = '';
      refreshInputRoot('commands');
      return true;
    }
    if (
      commandDraft &&
      ['commandField', 'commandScope', 'commandNewline', 'commandClear', 'commandSave'].includes(
        action,
      )
    ) {
      commandEditorMessage = '';
      if (action === 'commandField') {
        commandDraft.field = hit.userData.field as 'label' | 'text';
        commandDraft.cursor = Array.from(commandDraft[commandDraft.field]).length;
      } else if (action === 'commandScope') {
        if (commandWorkspaceId)
          commandDraft.scope = commandDraft.scope === 'global' ? 'workspace' : 'global';
        else commandEditorMessage = 'Select a pane for workspace scope';
      } else if (action === 'commandNewline') commandDraft.sendNewline = !commandDraft.sendNewline;
      else if (action === 'commandClear') {
        commandDraft[commandDraft.field] = '';
        commandDraft.cursor = 0;
      } else {
        const command = commandFromDraft(commandDraft, commandWorkspaceId);
        if (!command) commandEditorMessage = 'Enter a name and command';
        else if (!actions.saveCommand?.(command))
          commandEditorMessage = 'Could not save on this device';
        else {
          commandDraft = null;
          menuCommands = quickCommands.map((item) => ({ ...item }));
          clearArmedModifiers();
          refreshInputRoot('commands');
          return true;
        }
      }
      clearArmedModifiers();
      refreshInputRoot('command-editor');
      return true;
    }
    if (action === 'mode') {
      const mode = hit.userData.mode as 'commands' | 'keyboard';
      if (renderer?.xr.isPresenting) refreshInputRoot(mode);
      else showInput(mode);
      return true;
    }
    if (action === 'hierarchyNext') {
      const pane = availablePanes.find((item) => item.id === hit.userData.hierarchyKey);
      if (pane) {
        if (hierarchyLevel === 'workspace') {
          hierarchyWorkspaceId = pane.workspaceId;
          hierarchyLevel = 'session';
        } else if (hierarchyLevel === 'session') {
          hierarchySessionId = pane.sessionId;
          hierarchyLevel = 'window';
        } else if (hierarchyLevel === 'window') {
          hierarchyWindowId = pane.windowId;
          hierarchyLevel = 'pane';
        }
        panePage = 0;
        refreshInputRoot('panes');
      }
      return true;
    }
    if (action === 'hierarchyBack') {
      if (hierarchyLevel === 'pane') hierarchyLevel = 'window';
      else if (hierarchyLevel === 'window') hierarchyLevel = 'session';
      else if (hierarchyLevel === 'session') hierarchyLevel = 'workspace';
      panePage = 0;
      refreshInputRoot('panes');
      return true;
    }
    if (action === 'openInput') {
      showInput(hit.userData.mode as InputMode);
      return true;
    }
    if (action === 'exit') {
      hideInput();
      if (activeSession) void activeSession.end();
      else actions.exitPreview?.();
      return true;
    }
    if (action === 'background') {
      setBackground(hit.userData.background as BackgroundMode);
      return true;
    }
    if (action === 'arrange') {
      arrangeTerminals(hit.userData.pattern as PanelArrangement);
      return true;
    }
    if (action === 'keyboardBackground') {
      const enabled = !mutableState.keyboardBackgroundEnabled;
      actions.setKeyboardBackground?.(enabled);
      setKeyboardBackgroundEnabled(enabled);
      return true;
    }
    if (action === 'terminalColors') {
      const mode = hit.userData.colorMode as TerminalColorMode;
      actions.setTerminalColorMode?.(mode);
      setTerminalColorMode(mode);
      return true;
    }
    if (action === 'gridPreset' || action === 'gridStep') {
      if (!gridDraft) return true;
      if (action === 'gridPreset') {
        gridDraft.cols = Number(hit.userData.cols);
        gridDraft.rows = Number(hit.userData.rows);
      } else {
        const axis = hit.userData.axis as 'cols' | 'rows';
        gridDraft[axis] = THREE.MathUtils.clamp(
          gridDraft[axis] + Number(hit.userData.delta),
          2,
          axis === 'cols' ? 300 : 150,
        );
      }
      gridRequestStatus = '';
      refreshInputRoot('terminal');
      return true;
    }
    if (action === 'gridApply') {
      if (gridDraft)
        gridRequestStatus = actions.resizeGrid?.(gridDraft.target, gridDraft.cols, gridDraft.rows)
          ? 'Grid requested'
          : 'Grid unavailable';
      refreshInputRoot('terminal');
      return true;
    }
    if (action === 'gazeInput') {
      setGazeInputEnabled(!mutableState.gazeInputEnabled);
      return true;
    }
    if (action === 'reloadUpdate') {
      actions.reloadApp?.();
      return true;
    }
    if (action === 'fontZoom') {
      let parent: THREE.Object3D | null = hit;
      while (parent && !parent.userData.terminalId) parent = parent.parent;
      const panel = parent ? panels.get(parent.userData.terminalId as string) : undefined;
      if (panel) {
        const next = Math.max(
          1,
          Math.min(
            1.8,
            ((panel.root.userData.fontZoom as number) ?? 1) +
              (hit.userData.direction as number) * 0.1,
          ),
        );
        panel.root.userData.fontZoom = next;
        panel.texture.wrapS = THREE.ClampToEdgeWrapping;
        panel.texture.wrapT = THREE.ClampToEdgeWrapping;
        panel.texture.repeat.set(1 / next, 1 / next);
        panel.texture.offset.set(0, 0);
        panel.texture.needsUpdate = true;
      }
      return true;
    }
    if (action === 'pane') {
      const paneId = hit.userData.paneId as string;
      if (availablePanes.some((pane) => pane.id === paneId)) {
        actions.selectPane(paneId);
        hideInput();
      }
      return true;
    }
    if (action === 'panePage') {
      const keys = new Set(
        availablePanes.map((pane) =>
          inputMode === 'panes'
            ? hierarchyLevel === 'workspace'
              ? pane.workspaceId
              : hierarchyLevel === 'session'
                ? pane.sessionId
                : hierarchyLevel === 'window'
                  ? pane.windowId
                  : pane.id
            : pane.id,
        ),
      );
      panePage = (panePage + 1) % Math.max(1, Math.ceil(keys.size / 4));
      refreshInputRoot(inputMode);
      return true;
    }
    if (action === 'commandPage') {
      commandPage = (commandPage + 1) % Math.max(1, Math.ceil(menuCommands.length / 8));
      refreshInputRoot(inputMode);
      return true;
    }
    if (action === 'key' && inputMode === 'command-editor' && commandDraft) {
      const modifier = hit.userData.modifier as keyof KeyModifiers | undefined;
      if (modifier) armedModifiers[modifier] = !armedModifiers[modifier];
      else {
        commandDraft = editCommandDraft(commandDraft, hit.userData.key as string, armedModifiers);
        clearArmedModifiers();
      }
      commandEditorMessage = '';
      refreshInputRoot('command-editor');
      return true;
    }
    const paneId = mutableState.inputTargetId;
    if (!paneId) return true;
    if (action === 'key') {
      actions.selectPane(paneId);
      const modifier = hit.userData.modifier as keyof KeyModifiers | undefined;
      if (modifier) {
        armedModifiers[modifier] = !armedModifiers[modifier];
        setModifierVisual(hit, Boolean(armedModifiers[modifier]));
        if (modifier === 'shift') refreshInputRoot(inputMode);
        return true;
      }
      const modifiers = Object.keys(armedModifiers).length ? { ...armedModifiers } : undefined;
      actions.sendKey(hit.userData.key as string, modifiers);
      clearArmedModifiers();
      if (inputMode === 'keyboard') refreshInputRoot(inputMode);
    } else if (action === 'command') {
      const command = menuCommands.find((item) => item.id === hit.userData.commandId);
      if (command) actions.runCommand(command, paneId);
    }
    return true;
  };
  const targetFromRay = (): InputTarget | null => {
    raycaster.far = CONTROLLER_RAY_LENGTH;
    const targets = [...panels.values()].map((panel) => panel.root);
    if (inputRoot) targets.push(inputRoot);
    if (hudRoot) targets.push(hudRoot);
    const hits = raycaster.intersectObjects(targets, true);
    const intersection = hits.find((entry) => isControlVisible(entry.object));
    const hit = intersection?.object;
    lastRayDistance = intersection?.distance ?? CONTROLLER_RAY_LENGTH;
    if (!hit) return null;
    if (hit.userData.inputAction)
      return {
        terminalId:
          (hit.userData.terminalId as string | undefined) ?? mutableState.focusedTerminalId ?? '',
        kind: 'keyboard',
        object: hit,
      };
    let current: THREE.Object3D | null = hit;
    while (current && !current.userData.terminalId) current = current.parent;
    const terminalId = current?.userData.terminalId as string | undefined;
    if (!terminalId) return null;
    const key = hit.userData.key as string | undefined;
    return { terminalId, kind: key ? 'key' : 'terminal', object: hit };
  };
  const targetFromController = (root: THREE.Group): InputTarget | null => {
    scene.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    tempMatrix.identity().extractRotation(root.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(root.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix).normalize();
    const target = targetFromRay();
    root.userData.rayDistance = Math.min(CONTROLLER_RAY_LENGTH, Math.max(0.02, lastRayDistance));
    return target;
  };
  const activateTarget = (target: InputTarget | null): void => {
    if (!target) return;
    if (target.kind === 'keyboard' && target.object) {
      handleInputTarget(target.object);
      return;
    }
    selectTerminal(target.terminalId);
    if (target.kind === 'key') {
      const hit = target.object;
      const keyName = hit?.userData.key as string | undefined;
      if (keyName) {
        const modifier = hit?.userData.modifier as keyof KeyModifiers | undefined;
        if (modifier) {
          armedModifiers[modifier] = !armedModifiers[modifier];
          if (hit) setModifierVisual(hit, Boolean(armedModifiers[modifier]));
        } else {
          actions.sendKey(
            keyName,
            Object.keys(armedModifiers).length ? { ...armedModifiers } : undefined,
          );
          clearArmedModifiers();
        }
      }
    }
  };
  const onControllerSelect = (controller: THREE.Group): void => {
    activateTarget(targetFromController(controller));
    showHover(null);
  };
  const setupControllers = (): void => {
    if (!renderer) return;
    for (let i = 0; i < 2; i += 1) {
      const root = renderer.xr.getController(i);
      const rayLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -CONTROLLER_RAY_LENGTH),
        ]),
        new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.65 }),
      );
      rayLine.raycast = () => undefined;
      const contact = new THREE.Mesh(
        new THREE.SphereGeometry(0.003, 8, 6),
        new THREE.MeshBasicMaterial({ color: ACCENT }),
      );
      contact.raycast = () => undefined;
      contact.visible = false;
      root.add(rayLine, contact);
      const onSelect = (): void => {
        if (heldControllers.has(root) || disconnectedControllers.has(root)) return;
        onControllerSelect(root);
      };
      const onSqueeze = (event: Event): void => {
        if (heldControllers.has(root) || disconnectedControllers.has(root)) return;
        heldControllers.add(root);
        const target = targetFromController(root);
        if (!target) return;
        let object: THREE.Group | null = null;
        if (
          target.kind === 'keyboard' &&
          inputRoot &&
          target.object &&
          inputRoot.getObjectById(target.object.id)
        )
          object = inputRoot;
        else if (hudRoot && target.object && hudRoot.getObjectById(target.object.id))
          object = hudRoot;
        else if (target.terminalId && target.object) {
          const panel = panels.get(target.terminalId);
          if (panel?.root.getObjectById(target.object.id)) object = panel.root;
        }
        if (!object) return;
        if (object.userData.terminalId) selectTerminal(object.userData.terminalId as string);
        const other = [...dragStates.entries()].find(
          ([controller, drag]) => controller !== root && drag.object === object,
        )?.[0];
        if (!controllerGamepads.has(root)) {
          const gamepad = (event as Event & { data?: { gamepad?: Gamepad } }).data?.gamepad;
          if (gamepad) controllerGamepads.set(root, gamepad);
        }
        captureGrab(root, object);
        if (other) {
          captureGrab(other, object);
          beginPairGrab(object, other, root);
        }
      };
      const onSqueezeEnd = (): void => {
        heldControllers.delete(root);
        releaseGrab(root);
      };
      const onConnected = (event: Event): void => {
        disconnectedControllers.delete(root);
        rayLine.visible = true;
        const gamepad = (event as Event & { data?: { gamepad?: Gamepad } }).data?.gamepad;
        if (gamepad) controllerGamepads.set(root, gamepad);
      };
      const onDisconnected = (): void => {
        disconnectedControllers.add(root);
        heldControllers.delete(root);
        rayLine.visible = false;
        contact.visible = false;
        controllerGamepads.delete(root);
        releaseGrab(root);
        recenterSince = null;
        const previous = hoveredByController.get(root);
        hoveredByController.delete(root);
        if (previous && ![...hoveredByController.values()].includes(previous)) {
          const material = (previous as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          const modifier = previous.userData.modifier as keyof KeyModifiers | undefined;
          if (material?.color)
            material.color.setHex(
              (modifier && armedModifiers[modifier]) || previous.userData.activeState
                ? ACCENT
                : 0xffffff,
            );
        }
        root.userData.rayDistance = 0;
      };
      const eventRoot = root as unknown as EventRoot;
      eventRoot.addEventListener('selectstart', onSelect);
      eventRoot.addEventListener('squeezestart', onSqueeze);
      eventRoot.addEventListener('squeezeend', onSqueezeEnd);
      eventRoot.addEventListener('connected', onConnected);
      eventRoot.addEventListener('disconnected', onDisconnected);
      controllerRoots.push(root);
      controllerListeners.push({
        root,
        onSelect,
        onSqueeze,
        onSqueezeEnd,
        onConnected,
        onDisconnected,
      });
      scene.add(root);
    }
  };
  setupControllers();
  const syncPanelGrid = (panel: TerminalPanel): void => {
    const width = (PANEL_WIDTH * panel.surface.cols) / 80;
    const height = (PANEL_HEIGHT * panel.surface.rows) / 24;
    if (width === panel.width && height === panel.height) return;
    panel.width = width;
    panel.height = height;
    panel.screen.geometry.dispose();
    panel.screen.geometry = new THREE.PlaneGeometry(width, height);
    panel.frame.geometry.dispose();
    panel.frame.geometry = new THREE.BoxGeometry(width + 0.035, height + 0.06, 0.035);
    panel.selection.geometry.dispose();
    panel.selection.geometry = selectionGeometry(width, height);
    panel.titleLabel.position.y = height / 2 + 0.07;
    const strip = panel.root.getObjectByName('terminal-key-strip');
    if (strip) strip.position.y = -(height - PANEL_HEIGHT) / 2;
    for (const child of panel.root.children) {
      if (child.userData.inputAction !== 'fontZoom') continue;
      child.position.x = Number(child.userData.direction) * (width / 2 + 0.08);
      child.position.y = height / 2 - 0.18;
    }
  };
  const addTerminal = (surface: TerminalSurface): void => {
    if (panels.has(surface.pane.id)) return;
    const index = panels.size;
    const defaultPosition = new THREE.Vector3(
      index % 2 === 0 ? -0.87 : 0.87,
      1.5 - Math.floor(index / 2) * 0.95,
      -1.5,
    );
    const root = new THREE.Group();
    root.name = `terminal-panel-${surface.pane.id}`;
    root.userData.terminalId = surface.pane.id;
    root.userData.scaleLimits = [0.6, 1.8];
    root.position.copy(defaultPosition);
    root.rotation.y = index % 2 === 0 ? 0.06 : -0.06;
    const texture = createCanvasTexture(surface);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    screen.name = 'terminal-surface';
    screen.userData.helpText = getControlHelp({ terminalTitle: true });
    root.add(screen);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_WIDTH + 0.035, PANEL_HEIGHT + 0.06, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.72, metalness: 0.3 }),
    );
    frame.position.z = -0.025;
    root.add(frame);
    const selection = createSelection();
    const keyStrip = createKeyStrip();
    keyStrip.traverse((child: THREE.Object3D) => {
      child.userData.terminalId = surface.pane.id;
    });
    const fontDown = createLabelButton('A−', 0.12, 0.1, {
      inputAction: 'fontZoom',
      direction: -1,
      terminalId: surface.pane.id,
    });
    const fontUp = createLabelButton('A+', 0.12, 0.1, {
      inputAction: 'fontZoom',
      direction: 1,
      terminalId: surface.pane.id,
    });
    fontDown.position.set(-0.79, 0.22, 0.02);
    fontUp.position.set(0.79, 0.22, 0.02);
    root.userData.fontZoom = 1;
    const titleLabel = createLabelButton(`${surface.pane.title} · ${surface.status}`, 0.92, 0.08, {
      terminalId: surface.pane.id,
      terminalTitle: true,
    });
    titleLabel.position.set(0, 0.47, 0.02);
    root.add(selection, keyStrip, fontDown, fontUp, titleLabel);
    const panel: TerminalPanel = {
      id: surface.pane.id,
      surface,
      root,
      screen,
      texture,
      frame,
      selection,
      unsubscribe: () => undefined,
      defaultPosition,
      titleLabel,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
    };
    syncPanelGrid(panel);
    panel.unsubscribe = surface.subscribe(() => {
      syncPanelGrid(panel);
      texture.needsUpdate = true;
      updateLabel(panel.titleLabel, `${surface.pane.title} · ${surface.status}`);
    });
    panels.set(panel.id, panel);
    scene.add(root);
    if (!mutableState.selectedTerminalId) {
      mutableState.selectedTerminalId = panel.id;
      mutableState.focusedTerminalId = panel.id;
    }
    setSelectedVisual();
    if (inputRoot && inputMode === 'arrange') refreshInputRoot('arrange');
    notify();
  };
  const removeTerminal = (id: string): void => {
    const panel = panels.get(id);
    if (!panel) return;
    panel.unsubscribe();
    scene.remove(panel.root);
    disposeObject(panel.root);
    panel.texture.dispose();
    panels.delete(id);
    if (inputRoot && inputMode === 'arrange') refreshInputRoot('arrange');
    dragStates.forEach((drag, controller) => {
      if (drag.object.userData.terminalId === id) releaseGrab(controller);
    });
    if (mutableState.inputTargetId === id) {
      clearInputCapture();
      clearInputRoot();
    }
    if (mutableState.selectedTerminalId === id)
      mutableState.selectedTerminalId = panels.keys().next().value ?? null;
    if (mutableState.focusedTerminalId === id)
      mutableState.focusedTerminalId = mutableState.selectedTerminalId;
    setSelectedVisual();
    notify();
  };
  const selectTerminal = (id: string | null): void => {
    const nextId = id && panels.has(id) ? id : null;
    if (nextId === mutableState.selectedTerminalId && mutableState.focusedTerminalId === nextId)
      return;
    if (!gazeRetargeting) gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    mutableState.selectedTerminalId = nextId;
    mutableState.focusedTerminalId = mutableState.selectedTerminalId;
    if (mutableState.selectedTerminalId) actions.selectPane(mutableState.selectedTerminalId);
    if (inputRoot) {
      clearArmedModifiers();
      mutableState.inputTargetId = nextId;
      mutableState.inputTargetTitle =
        availablePanes.find((pane) => pane.id === nextId)?.title ?? nextId;
      menuCommands = quickCommands.map((command) => ({ ...command }));
      commandPage = 0;
      refreshInputRoot(inputMode);
    }
    for (const panel of panels.values())
      panel.surface.focus(panel.id === mutableState.focusedTerminalId);
    setSelectedVisual();
    notify();
  };
  const setBackground = (mode: BackgroundMode): void => {
    mutableState.background = mode;
    if (mutableState.xrMode === 'ar') {
      observatory.visible = false;
      scene.background = null;
      scene.userData.backgroundVisible = false;
      notify();
      return;
    }
    gradientTexture?.dispose();
    gradientTexture = null;
    if (mode === 'black') scene.background = new THREE.Color(0x000000);
    else if (mode === 'gradient') {
      gradientTexture = createGradientTexture();
      scene.background = gradientTexture;
    } else scene.background = new THREE.Color(0x050a10);
    observatory.visible = mode === 'observatory';
    notify();
  };
  const setGazeInputEnabled = (enabled: boolean): void => {
    if (mutableState.gazeInputEnabled === enabled) return;
    mutableState.gazeInputEnabled = enabled;
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    if (hudRoot) {
      const toggle = hudRoot.children.find((child) => child.userData.inputAction === 'gazeInput');
      if (toggle) {
        toggle.userData.gazeInputEnabled = enabled;
        updateLabel(toggle as THREE.Mesh, `Gaze input: ${enabled ? 'on' : 'off'}`);
      }
    }
    const inputToggle = inputRoot?.children.find(
      (child) => child.userData.inputAction === 'gazeInput',
    );
    if (inputToggle)
      updateLabel(inputToggle as THREE.Mesh, `Gaze input: ${enabled ? 'on' : 'off'}`);
    notify();
  };
  const setTerminalColorMode = (mode: TerminalColorMode): void => {
    if (mutableState.terminalColorMode === mode) return;
    mutableState.terminalColorMode = mode;
    for (const panel of panels.values()) panel.surface.setColorMode(mode);
    if (inputRoot && inputMode === 'terminal') refreshInputRoot(inputMode);
    notify();
  };
  const setKeyboardBackgroundEnabled = (enabled: boolean): void => {
    if (mutableState.keyboardBackgroundEnabled === enabled) return;
    mutableState.keyboardBackgroundEnabled = enabled;
    if (inputRoot && (inputMode === 'keyboard' || inputMode === 'command-editor'))
      refreshInputRoot(inputMode);
    notify();
  };
  const setAvailablePanes = (panes: PaneDescriptor[]): void => {
    availablePanes.splice(0, availablePanes.length, ...panes);
    for (const pane of panes) {
      const panel = panels.get(pane.id);
      if (panel) {
        Object.assign(panel.surface.pane, pane);
        updateLabel(panel.titleLabel, `${pane.title} · ${panel.surface.status}`);
      }
    }
    panePage = 0;
    const validWorkspace =
      hierarchyWorkspaceId === null ||
      panes.some((pane) => pane.workspaceId === hierarchyWorkspaceId);
    const validSession =
      hierarchySessionId === null ||
      panes.some(
        (pane) =>
          pane.sessionId === hierarchySessionId && pane.workspaceId === hierarchyWorkspaceId,
      );
    const validWindow =
      hierarchyWindowId === null ||
      panes.some(
        (pane) => pane.windowId === hierarchyWindowId && pane.sessionId === hierarchySessionId,
      );
    if (!validWorkspace || !validSession || !validWindow) {
      hierarchyLevel = 'workspace';
      hierarchyWorkspaceId = null;
      hierarchySessionId = null;
      hierarchyWindowId = null;
    }
  };
  const setQuickCommands = (commands: QuickCommand[]): void => {
    quickCommands = commands.map((command) => ({ ...command }));
  };
  const showInput = (mode: InputMode): void => {
    if (
      !renderer?.xr.isPresenting &&
      mode !== 'panes' &&
      mode !== 'terminal' &&
      mode !== 'arrange'
    ) {
      hideInput();
      if (mode === 'commands') actions.openCommands();
      else actions.openKeyboard();
      return;
    }
    const targetId = mutableState.focusedTerminalId ?? mutableState.selectedTerminalId;
    mutableState.inputTargetId = targetId;
    mutableState.inputTargetTitle =
      availablePanes.find((pane) => pane.id === targetId)?.title ?? targetId;
    menuCommands = quickCommands.map((command) => ({ ...command }));
    commandPage = 0;
    clearArmedModifiers();
    refreshInputRoot(mode);
  };
  const hideInput = (): void => {
    if (inputRoot)
      inputTransform = {
        position: inputRoot.position.clone(),
        quaternion: inputRoot.quaternion.clone(),
        scale: inputRoot.scale.x,
      };
    dragStates.forEach((drag, controller) => {
      if (drag.object === inputRoot) releaseGrab(controller);
    });
    clearInputRoot();
    clearInputCapture();
    notify();
  };
  const enterXR = async (mode: 'vr' | 'ar'): Promise<void> => {
    if (!renderer) throw new Error('WebGL is unavailable');
    const xr = (
      navigator as Navigator & {
        xr?: { requestSession(mode: string, options?: unknown): Promise<XrSessionLike> };
      }
    ).xr;
    if (!xr) throw new Error('WebXR is unavailable');
    const sessionMode = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
    const session = await xr.requestSession(
      sessionMode,
      mode === 'ar'
        ? { optionalFeatures: ['local-floor', 'dom-overlay'] }
        : { optionalFeatures: ['local-floor'] },
    );
    activeSession = session;
    hideInput();
    inputTransform = null;
    previousRenderTime = null;
    frameCounter.reset();
    mutableState.fps = null;
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    desktopCameraPosition.copy(camera.position);
    desktopCameraQuaternion.copy(camera.quaternion);
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
    mutableState.xrMode = mode;
    if (mode === 'ar') {
      observatory.visible = false;
      scene.background = null;
      scene.userData.backgroundVisible = false;
    } else {
      setBackground(mutableState.background);
      scene.userData.backgroundVisible = true;
    }
    notify();
    session.addEventListener('end', () => {
      activeSession = null;
      hideInput();
      inputTransform = null;
      dragStates.clear();
      pairGrabs.clear();
      recenterSince = null;
      recenterLatched = false;
      heldControllers.clear();
      controllerGamepads.clear();
      previousRenderTime = null;
      hoveredByController.clear();
      showHover(null);
      gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
      mutableState.xrMode = 'desktop';
      if (hudRoot) {
        hudRoot.position.set(0, 0.78, -1.35);
        hudRoot.quaternion.identity();
        hudRoot.scale.setScalar(0.62);
      }
      camera.position.copy(desktopCameraPosition);
      camera.quaternion.copy(desktopCameraQuaternion);
      observatory.visible = mutableState.background === 'observatory';
      scene.userData.backgroundVisible = true;
      setBackground(mutableState.background);
      notify();
    });
  };
  const exitXR = async (): Promise<void> => {
    if (activeSession) await activeSession.end();
  };
  const arrangeTerminals = (pattern: PanelArrangement): void => {
    if (!panels.size) return;
    const ordered = [...panels.values()];
    const poses = calculateArrangement(
      pattern,
      ordered.map(({ root }) => ({
        width: (PANEL_WIDTH + 0.3) * root.scale.x,
        height: (PANEL_HEIGHT + 0.3) * root.scale.x,
      })),
    );
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    view.updateMatrixWorld(true);
    const eye = view.getWorldPosition(new THREE.Vector3());
    const forward = view.getWorldDirection(new THREE.Vector3());
    const yaw = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(-forward.x, -forward.z),
    );
    ordered.forEach((panel, index) => {
      panel.root.position.copy(poses[index].position).applyQuaternion(yaw).add(eye);
      panel.root.quaternion.copy(yaw).multiply(poses[index].quaternion);
    });
    for (const [controller, drag] of dragStates)
      if (ordered.some((panel) => panel.root === drag.object)) captureGrab(controller, drag.object);
    for (const [object, pair] of pairGrabs)
      if (ordered.some((panel) => panel.root === object))
        beginPairGrab(object, ...pair.controllers);
    mutableState.arrangement = pattern;
    if (inputRoot && inputMode === 'arrange') refreshInputRoot('arrange');
    notify();
  };
  const resetLayout = (): void => {
    mutableState.arrangement = null;
    for (const panel of panels.values()) {
      panel.root.position.copy(panel.defaultPosition);
      panel.root.rotation.set(0, panel.defaultPosition.x < 0 ? 0.06 : -0.06, 0);
      panel.root.scale.setScalar(1);
    }
    dragStates.clear();
    pairGrabs.clear();
    if (hudRoot) {
      hudRoot.position.set(0, 0.78, -1.35);
      hudRoot.quaternion.identity();
      hudRoot.scale.setScalar(0.62);
    }
    if (renderer?.xr.isPresenting) {
      const view = renderer.xr.getCamera();
      view.updateMatrixWorld(true);
      const eye = view.getWorldPosition(new THREE.Vector3());
      const rotation = view.getWorldQuaternion(new THREE.Quaternion());
      for (const panel of panels.values()) {
        panel.root.position
          .copy(panel.defaultPosition)
          .add(new THREE.Vector3(0, -1.52, 0))
          .applyQuaternion(rotation)
          .add(eye);
        panel.root.quaternion.premultiply(rotation);
      }
      if (hudRoot) {
        hudRoot.position.set(0, -0.65, -1.35).applyQuaternion(rotation).add(eye);
        hudRoot.quaternion.copy(rotation);
      }
    }
    resetInputPose();
    if (inputRoot && inputMode === 'arrange') refreshInputRoot('arrange');
    notify();
  };
  const getControlHints = (): Array<{
    label: string;
    help: string;
    terminalId?: string;
    inputAction?: string;
    key?: string;
    clientX: number;
    clientY: number;
  }> => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return [];
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const result: ReturnType<WorkspaceScene['getControlHints']> = [];
    const roots: THREE.Object3D[] = [...panels.values()].map((panel) => panel.root);
    if (inputRoot) roots.push(inputRoot);
    if (hudRoot) roots.push(hudRoot);
    for (const root of roots)
      root.traverse((object) => {
        const help = object.userData.helpText as string | undefined;
        if (!help || !isControlVisible(object)) return;
        const point = object.getWorldPosition(new THREE.Vector3()).project(camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return;
        result.push({
          label: object.userData.labelText as string,
          help,
          terminalId: object.userData.terminalId as string | undefined,
          inputAction: object.userData.inputAction as string | undefined,
          key: object.userData.key as string | undefined,
          clientX: bounds.left + ((point.x + 1) * bounds.width) / 2,
          clientY: bounds.top + ((1 - point.y) * bounds.height) / 2,
        });
      });
    return result;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.cancelAnimationFrame(frameHandle);
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('pointercancel', onPointerLeave);
    renderer?.setAnimationLoop(null);
    for (const id of [...panels.keys()]) removeTerminal(id);
    for (const {
      root,
      onSelect,
      onSqueeze,
      onSqueezeEnd,
      onConnected,
      onDisconnected,
    } of controllerListeners) {
      const eventRoot = root as unknown as EventRoot;
      eventRoot.removeEventListener('selectstart', onSelect);
      eventRoot.removeEventListener('squeezestart', onSqueeze);
      eventRoot.removeEventListener('squeezeend', onSqueezeEnd);
      eventRoot.removeEventListener('connected', onConnected);
      eventRoot.removeEventListener('disconnected', onDisconnected);
      scene.remove(root);
      disposeObject(root);
      root.clear();
    }
    controllerListeners.length = 0;
    controllerRoots.length = 0;
    controllerGamepads.clear();
    disconnectedControllers.clear();
    heldControllers.clear();
    clearInputRoot();
    if (hudRoot) {
      scene.remove(hudRoot);
      disposeObject(hudRoot);
      hudRoot = null;
    }
    hoveredControl = null;
    hoveredByController.clear();
    dragStates.clear();
    pairGrabs.clear();
    canvas.title = '';
    scene.remove(hoverHelp);
    disposeObject(hoverHelp);
    scene.clear();
    gradientTexture?.dispose();
    renderer?.dispose();
    if (canvas.parentElement === container) container.removeChild(canvas);
    listeners.clear();
  };
  setBackground('observatory');
  createHud();
  return {
    canvas,
    scene,
    camera,
    state: mutableState,
    addTerminal,
    removeTerminal,
    selectTerminal,
    setBackground,
    setGazeInputEnabled,
    setTerminalColorMode,
    setKeyboardBackgroundEnabled,
    setAvailablePanes,
    setQuickCommands,
    showInput,
    hideInput,
    enterXR,
    exitXR,
    setUpdateAvailable,
    setNotice,
    arrangeTerminals,
    resetLayout,
    scaleSelectedPanel,
    getControlHints,
    dispose,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type { BackgroundMode };
