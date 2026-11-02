import * as THREE from 'three';
import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  PanelArrangement,
  QuickCommand,
  TerminalColorMode,
  TerminalMouseInput,
  TerminalRenderQuality,
  TerminalSurface,
  WorkspaceActions,
} from '../contracts';
import { getControlHelp } from '../control-help';
import {
  createModifierState,
  type KeyboardModifier,
  keyboardDimensions,
  keyboardKeys,
  type SemanticKey,
} from '../keyboard';
import {
  DEFAULT_TERMINAL_FILTERING,
  type TerminalFiltering,
  type TerminalFilterMode,
  validateTerminalFiltering,
} from '../terminal/filtering';
import { terminalKeyLabel } from '../terminal/protocol';
import { calculateArrangement } from './arrangements';
import {
  type CommandDraft,
  commandFromDraft,
  createCommandDraft,
  editCommandDraft,
} from './command-editor';
import { keepLayoutAboveFloor, workspaceFloorY } from './floor-layout';
import { createFrameCounter } from './fps';
import { createScalableLabel, disposeScalableLabel, updateScalableLabel } from './labels';
import { createPaneFocus } from './pane-focus';
import { measurePanelBounds } from './panel-bounds';
import { terminalQualityAtDistance } from './terminal-lod';
import { createTerminalMaterial, setTerminalMaterialFiltering } from './terminal-material';
import { createTerminalTexture, type TerminalTexture } from './terminal-texture';
import {
  createCurvedTerminalGeometry,
  createCurvedTerminalSelection,
  getTerminalWarpBounds,
  terminalWarpPoint,
  warpGeometryPositions,
} from './terminal-warp';
import { createTerminalWarpStore } from './terminal-warp-store';
import { applyUIPose, captureUIPose, createUIPoseStore, type UIPoseName } from './ui-poses';
import { createWidgetPoseStore } from './widget-poses';
import { type ClockWidget, createClockWidget, type WidgetKind } from './widgets';

type InputMode =
  | 'commands'
  | 'keyboard'
  | 'panes'
  | 'terminal'
  | 'arrange'
  | 'command-editor'
  | 'widgets'
  | 'filtering'
  | 'warp';

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
  filtering: TerminalFiltering;
  widgets: WidgetKind[];
  keyboardBackgroundEnabled: boolean;
  fps: number | null;
  xrMode: 'desktop' | 'vr' | 'ar';
  focusedTerminalId: string | null;
  focusModeTerminalId: string | null;
  renderGazeTerminalId: string | null;
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
  setTerminalFiltering(filtering: TerminalFiltering): void;
  setTerminalCurvature(id: string, degrees: number): void;
  getTerminalCurvature(id: string): number;
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
  toggleFocusMode(id?: string): void;
  scaleSelectedPanel(direction: number): void;
  moveLayoutDepth(direction: number): void;
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
  uv?: THREE.Vector2;
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
const QUALITY_RANK: Record<TerminalRenderQuality, number> = {
  hidden: 0,
  low: 1,
  medium: 2,
  full: 3,
};

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
  screen: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.Texture;
  textureSource: TerminalTexture;
  frame: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  selection: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  unsubscribe: () => void;
  defaultPosition: THREE.Vector3;
  titleLabel: THREE.Mesh;
  connectionButton: THREE.Mesh;
  closeButton: THREE.Mesh;
  width: number;
  height: number;
  revision: number;
  status: string;
  title: string;
  error: string | null;
  renderQuality: TerminalRenderQuality;
  pendingQuality: TerminalRenderQuality | null;
  qualitySince: number;
  filterVersion: number;
  filterGaze: boolean;
  filterGazeAt: number;
  curvature: number;
  geometryCurvature: number;
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

const BACKGROUND_LABELS: Record<BackgroundMode, string> = {
  black: 'Black',
  gradient: 'Gradient',
  observatory: 'Observatory',
};

function createBackgroundSelect(mode: BackgroundMode, owner: 'hud' | 'input'): THREE.Group {
  const root = new THREE.Group();
  root.name = 'background-select';
  const trigger = createLabelButton(BACKGROUND_LABELS[mode], 0.48, 0.09, {
    inputAction: 'backgroundSelect',
    backgroundSelectOwner: owner,
  });
  trigger.name = 'background-select-trigger';
  const shape = new THREE.Shape().moveTo(-0.009, 0.006).lineTo(0.009, 0.006).lineTo(0, -0.006);
  shape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  arrow.position.set(0.2, 0, 0.003);
  arrow.raycast = () => undefined;
  const options = new THREE.Group();
  options.name = 'background-options';
  options.visible = false;
  options.position.z = 0.03;
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.33),
    new THREE.MeshBasicMaterial({ color: 0x0d1720 }),
  );
  backing.position.set(0, 0.22, -0.005);
  backing.userData.inputAction = 'noop';
  options.add(backing);
  (Object.keys(BACKGROUND_LABELS) as BackgroundMode[]).forEach((background, index) => {
    const option = createLabelButton(BACKGROUND_LABELS[background], 0.48, 0.09, {
      inputAction: 'background',
      background,
    });
    option.position.y = 0.33 - index * 0.11;
    setModifierVisual(option, background === mode);
    options.add(option);
  });
  root.add(trigger, arrow, options);
  return root;
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

function createSelection(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
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
    if (!current.visible || current.userData.focusHidden) return false;
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
  const widgets = new Map<WidgetKind, ClockWidget>();
  const poseStore = createUIPoseStore();
  const widgetPoseStore = createWidgetPoseStore();
  const warpStore = createTerminalWarpStore();
  const warpKey = (surface: TerminalSurface): string =>
    JSON.stringify([
      surface.serverId ?? 'demo',
      surface.pane.workspaceId,
      surface.pane.sessionId,
      surface.pane.windowId,
      surface.pane.id,
    ]);
  scene.userData.maxAnisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1;
  let widgetRestorePending = true;
  let poseRestorePending = false;
  let keyboardPoseRestored = true;
  let filterVersion = 0;
  const paneFocus = createPaneFocus();
  const listeners = new Set<(state: Readonly<WorkspaceSceneState>) => void>();
  const mutableState: WorkspaceSceneState = {
    selectedTerminalId: null,
    background: 'observatory',
    gazeInputEnabled: false,
    terminalColorMode: 'comfort',
    filtering: { ...DEFAULT_TERMINAL_FILTERING },
    widgets: [],
    keyboardBackgroundEnabled: true,
    fps: null,
    xrMode: 'desktop',
    focusedTerminalId: null,
    focusModeTerminalId: null,
    renderGazeTerminalId: null,
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
  const fidelityRay = new THREE.Raycaster();
  const fidelityHits: THREE.Intersection[] = [];
  const terminalScreens: THREE.Mesh[] = [];
  const fidelityEye = new THREE.Vector3();
  const fidelityDirection = new THREE.Vector3();
  const fidelityPosition = new THREE.Vector3();
  const fidelityScale = new THREE.Vector3();
  const controllerRoots: THREE.Group[] = [];
  const controllerListeners: Array<{
    root: THREE.Group;
    onSelect: (event: Event) => void;
    onSelectEnd: (event: Event) => void;
    onSqueeze: (event: Event) => void;
    onSqueezeEnd: (event: Event) => void;
    onConnected: (event: Event) => void;
    onDisconnected: (event: Event) => void;
  }> = [];
  const tempMatrix = new THREE.Matrix4();
  const reachPosition = new THREE.Vector3();
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
  const controllerHandedness = new Map<THREE.Group, string>();
  const focusButtonDown = new Set<THREE.Group>();
  const disconnectedControllers = new Set<THREE.Group>();
  const heldControllers = new Set<THREE.Group>();
  const mouseCaptures = new Map<
    THREE.Group | number,
    {
      id: string;
      col: number;
      row: number;
      button: TerminalMouseInput['button'];
      modifiers?: KeyModifiers;
    }
  >();
  let previousRenderTime: number | null = null;
  let lodWasPresenting = false;
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
  const closeBackgroundMenus = (): void => {
    for (const owner of [hudRoot, inputRoot]) {
      const options = owner?.getObjectByName('background-options');
      if (options) options.visible = false;
    }
  };
  let updateNotice: THREE.Mesh | null = null;
  let statusNotice: THREE.Mesh | null = null;
  let statusDismiss: THREE.Mesh | null = null;
  let xrStartPromise: Promise<void> | null = null;
  let activeSession: XrSessionLike | null = null;
  let inputMode: InputMode = 'commands';
  let panePage = 0;
  const modifierState = createModifierState();
  const modifierPresses = new Map<
    THREE.Group | number,
    {
      modifier: KeyboardModifier;
      since: number | null;
      locked: boolean;
      before?: { active: boolean; locked: boolean };
    }
  >();
  const keyboardButtonDown = new Set<THREE.Group>();
  const scrollDue = new Map<THREE.Group, number>();
  let keyboardResume: {
    mode: 'keyboard' | 'command-editor';
    target: string | null;
    locked: Readonly<KeyModifiers>;
  } | null = null;
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
  const syncModifierVisuals = (): void => {
    const labels = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
    const active = modifierState.active;
    const locked = modifierState.locked;
    const roots: THREE.Object3D[] = [...panels.values()]
      .map((panel) => panel.root)
      .concat([...widgets.values()].map((widget) => widget.root));
    if (inputRoot) roots.push(inputRoot);
    for (const root of roots)
      root.traverse((object) => {
        const modifier = object.userData.modifier as KeyboardModifier | undefined;
        if (!modifier) return;
        setModifierVisual(object, Boolean(active[modifier]));
        object.userData.locked = Boolean(locked[modifier]);
        updateLabel(
          object as THREE.Mesh,
          locked[modifier] ? `${labels[modifier]} lock` : labels[modifier],
        );
        object.userData.helpText = locked[modifier]
          ? `${labels[modifier]} locked; tap to release`
          : `${labels[modifier]}: tap once, hold to lock`;
      });
  };
  const clearArmedModifiers = (): void => {
    modifierPresses.clear();
    modifierState.clear();
    syncModifierVisuals();
  };
  const consumeArmedModifiers = (): void => {
    modifierState.consume();
    syncModifierVisuals();
  };
  const beginModifierPress = (
    source: THREE.Group | number,
    target: InputTarget | null,
    before?: { active: boolean; locked: boolean },
  ): void => {
    modifierPresses.delete(source);
    const modifier = target?.object?.userData.modifier as KeyboardModifier | undefined;
    if (modifier) modifierPresses.set(source, { modifier, since: null, locked: false, before });
  };
  const cancelModifierPress = (source: number): void => {
    const press = modifierPresses.get(source);
    modifierPresses.delete(source);
    if (!press?.before) return;
    modifierState.restore(press.modifier, press.before.active, press.before.locked);
    syncModifierVisuals();
    if (inputRoot && (inputMode === 'keyboard' || inputMode === 'command-editor'))
      refreshInputRoot(inputMode);
  };
  const releaseMouse = (source: THREE.Group | number): void => {
    const capture = mouseCaptures.get(source);
    if (!capture) return;
    mouseCaptures.delete(source);
    const panel = panels.get(capture.id);
    if (panel)
      actions.sendMouse?.(capture.id, {
        ...capture,
        col: Math.min(capture.col, panel.surface.cols - 1),
        row: Math.min(capture.row, panel.surface.rows - 1),
        eventType: 'release',
      });
    if (typeof source === 'number' && canvas.hasPointerCapture?.(source))
      canvas.releasePointerCapture(source);
    consumeArmedModifiers();
    if (capture.modifiers?.shift && inputRoot && inputMode === 'keyboard')
      refreshInputRoot(inputMode);
  };
  const releaseAllMouse = (): void => {
    for (const source of [...mouseCaptures.keys()]) releaseMouse(source);
  };
  const gripActive = (): boolean =>
    heldControllers.size > 0 ||
    [...controllerGamepads.values()].some((pad) => pad.buttons[1]?.pressed);
  const cellAtUV = (panel: TerminalPanel, uv: THREE.Vector2): { col: number; row: number } => {
    panel.texture.updateMatrix();
    const sampled = uv.clone().applyMatrix3(panel.texture.matrix);
    return {
      col: THREE.MathUtils.clamp(
        Math.floor(sampled.x * panel.surface.cols),
        0,
        panel.surface.cols - 1,
      ),
      row: THREE.MathUtils.clamp(
        Math.floor((1 - sampled.y) * panel.surface.rows),
        0,
        panel.surface.rows - 1,
      ),
    };
  };
  const startMouse = (
    source: THREE.Group | number,
    target: InputTarget | null,
    button: number,
    modifiers?: KeyModifiers,
  ): boolean => {
    if (gripActive() || !target?.uv || button < 0 || button > 2) return false;
    const panel = panels.get(target.terminalId);
    if (
      !panel ||
      target.object !== panel.screen ||
      [...mouseCaptures.values()].some((capture) => capture.id === panel.id)
    )
      return false;
    const input: TerminalMouseInput = {
      ...cellAtUV(panel, target.uv),
      button: button as TerminalMouseInput['button'],
      eventType: 'press',
      modifiers,
    };
    if (!actions.sendMouse?.(panel.id, input)) return false;
    mouseCaptures.set(source, { ...input, id: panel.id });
    return true;
  };
  const moveMouse = (source: THREE.Group | number, target: InputTarget | null): void => {
    const capture = mouseCaptures.get(source);
    if (!capture) return;
    const panel = panels.get(capture.id);
    if (
      gripActive() ||
      !panel ||
      panel.surface.status !== 'connected' ||
      panel.surface.mouseTracking === 'none'
    ) {
      releaseMouse(source);
      return;
    }
    if (target?.object !== panel.screen) return;
    if (!target.uv) return;
    const cell = cellAtUV(panel, target.uv);
    if (cell.col === capture.col && cell.row === capture.row) return;
    capture.col = cell.col;
    capture.row = cell.row;
    actions.sendMouse?.(capture.id, { ...capture, eventType: 'move' });
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
  let hoverPlaced = false;
  let hoverSince = 0;
  const showHover = (object: THREE.Object3D | null, now = performance.now()): void => {
    const help = object?.userData.helpText as string | undefined;
    if (!help || dragStates.size) {
      hoveredControl = null;
      hoverPlaced = false;
      hoverHelp.visible = false;
      canvas.title = '';
      return;
    }
    if (hoveredControl !== object) {
      hoveredControl = object;
      hoverPlaced = false;
      hoverSince = now;
    }
    canvas.title = help;
    hoverHelp.visible = now - hoverSince >= 700;
    if (hoverHelp.visible) updateLabel(hoverHelp, help);
  };
  const updateHoverPosition = (): void => {
    if (!hoveredControl || !hoverHelp.visible || hoverPlaced) return;
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
    const bounds = new THREE.Box3().setFromObject(hoveredControl);
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const projectedHalfHeight =
      Math.abs(up.x) * extent.x + Math.abs(up.y) * extent.y + Math.abs(up.z) * extent.z;
    hoverHelp.quaternion.copy(view.getWorldQuaternion(new THREE.Quaternion()));
    hoverHelp.position.copy(center).addScaledVector(up, projectedHalfHeight + 0.045 * tooltipScale);
    hoverHelp.position.addScaledVector(
      new THREE.Vector3(0, 0, 1).applyQuaternion(hoverHelp.quaternion),
      0.018 * tooltipScale,
    );
    hoverPlaced = true;
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
    const target = targetFromRay();
    const modifier = target?.object?.userData.modifier as KeyboardModifier | undefined;
    const before = modifier
      ? {
          active: Boolean(modifierState.active[modifier]),
          locked: Boolean(modifierState.locked[modifier]),
        }
      : undefined;
    activateTarget(target);
    beginModifierPress(event.pointerId, target, before);
    if (modifierPresses.has(event.pointerId)) canvas.setPointerCapture?.(event.pointerId);
    if (
      startMouse(event.pointerId, target, event.button, {
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      })
    ) {
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
    showHover(null);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (renderer?.xr.isPresenting) return;
    if (!setPointerRay(event)) return;
    const modifierPress = modifierPresses.get(event.pointerId);
    if (modifierPress && targetFromRay()?.object?.userData.modifier !== modifierPress.modifier)
      cancelModifierPress(event.pointerId);
    if (mouseCaptures.has(event.pointerId)) {
      moveMouse(event.pointerId, targetFromRay());
      return;
    }
    showHover(targetFromRay()?.object ?? null);
    updateHoverPosition();
  };
  const onPointerLeave = (): void => {
    if (!renderer?.xr.isPresenting) showHover(null);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.type === 'pointerup') modifierPresses.delete(event.pointerId);
    else cancelModifierPress(event.pointerId);
    if (
      event.type === 'pointerup' &&
      !renderer?.xr.isPresenting &&
      mouseCaptures.has(event.pointerId) &&
      setPointerRay(event)
    )
      moveMouse(event.pointerId, targetFromRay());
    releaseMouse(event.pointerId);
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
    paneFocus.update(deltaSeconds);
    if (poseRestorePending && renderer?.xr.isPresenting) {
      const saved = poseStore.read('hud');
      if (saved && hudRoot)
        applyUIPose(
          hudRoot,
          renderer.xr.getCamera(),
          saved,
          hudRoot.userData.scaleLimits as [number, number],
        );
      poseRestorePending = false;
    }
    if (widgetRestorePending) {
      for (const [kind, pose] of Object.entries(widgetPoseStore.read())) {
        const widget = widgets.get(kind as WidgetKind) ?? addWidget(kind as WidgetKind);
        applyUIPose(
          widget.root,
          renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera,
          pose,
          [0.25, 2],
        );
      }
      widgetRestorePending = false;
      mutableState.widgets = [...widgets.keys()];
      notify();
    }
    const nowMs = Date.now();
    for (const widget of widgets.values()) widget.update(nowMs);
    (scene.userData.updateEnvironment as ((delta: number) => void) | undefined)?.(deltaSeconds);
    if (gripActive()) modifierPresses.clear();
    for (const press of modifierPresses.values()) {
      if (press.since === null) press.since = time;
      if (!press.locked && time - press.since >= 550) {
        press.locked = true;
        modifierState.lock(press.modifier);
        if (inputRoot && (inputMode === 'keyboard' || inputMode === 'command-editor'))
          refreshInputRoot(inputMode);
        syncModifierVisuals();
      }
    }
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
      for (const controller of controllerRoots) {
        if (controllerHandedness.get(controller) !== 'right') continue;
        const keyboardPressed = Boolean(controllerGamepads.get(controller)?.buttons[4]?.pressed);
        const keyboardWasPressed = keyboardButtonDown.has(controller);
        if (keyboardPressed) keyboardButtonDown.add(controller);
        else keyboardButtonDown.delete(controller);
        if (
          keyboardPressed &&
          !keyboardWasPressed &&
          controller.visible &&
          !disconnectedControllers.has(controller) &&
          !gripActive()
        )
          toggleKeyboard();
        const pressed = Boolean(controllerGamepads.get(controller)?.buttons[5]?.pressed);
        const wasPressed = focusButtonDown.has(controller);
        if (pressed) focusButtonDown.add(controller);
        else focusButtonDown.delete(controller);
        if (
          pressed &&
          !wasPressed &&
          controller.visible &&
          !disconnectedControllers.has(controller) &&
          !gripActive()
        ) {
          const target = targetFromController(controller);
          toggleFocusMode(
            target?.terminalId && panels.has(target.terminalId) ? target.terminalId : undefined,
          );
        }
      }
      for (const controller of controllerRoots) {
        const pad = controllerGamepads.get(controller);
        if (
          !pad ||
          !controller.visible ||
          disconnectedControllers.has(controller) ||
          gripActive() ||
          mouseCaptures.size ||
          pad.buttons[3]?.pressed ||
          (inputRoot && inputMode !== 'keyboard')
        ) {
          scrollDue.delete(controller);
          continue;
        }
        const axis = pad.axes.length >= 4 ? pad.axes[3] : (pad.axes.at(-1) ?? 0);
        if (Math.abs(axis) < 0.35) {
          scrollDue.delete(controller);
          continue;
        }
        if (time < (scrollDue.get(controller) ?? 0)) continue;
        const target = targetFromController(controller);
        const panel = target?.terminalId ? panels.get(target.terminalId) : undefined;
        if (panel && target?.uv && target.object === panel.screen) {
          actions.scrollTerminal?.(panel.id, Math.sign(axis) * 3, cellAtUV(panel, target.uv));
          scrollDue.set(controller, time + 160 / Math.abs(axis));
        }
      }
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
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), horizontal),
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
    if (renderer?.xr.isPresenting) {
      scene.updateMatrixWorld(true);
      const fidelityView = renderer.xr.getCamera();
      fidelityView.updateWorldMatrix(true, false);
      fidelityView.getWorldPosition(fidelityEye);
      fidelityView.getWorldDirection(fidelityDirection);
      let renderGazeId: string | null = null;
      if (renderer?.xr.isPresenting) {
        fidelityRay.set(fidelityEye, fidelityDirection);
        fidelityRay.far = camera.far;
        fidelityHits.length = 0;
        fidelityRay.intersectObjects(terminalScreens, false, fidelityHits);
        const hit = fidelityHits.find((entry) => isControlVisible(entry.object));
        renderGazeId = (hit?.object.parent?.userData.terminalId as string | undefined) ?? null;
      }
      mutableState.renderGazeTerminalId = renderGazeId;
      for (const panel of panels.values()) {
        const distance = panel.screen.getWorldPosition(fidelityPosition).distanceTo(fidelityEye);
        const inRange = distance <= mutableState.filtering.gazeMaxDistance;
        if (panel.id === renderGazeId && inRange) panel.filterGazeAt = time;
        const filterGaze =
          inRange &&
          (panel.id === renderGazeId || (panel.filterGaze && time - panel.filterGazeAt < 250));
        if (filterGaze !== panel.filterGaze || panel.filterVersion !== filterVersion) {
          setTerminalMaterialFiltering(panel.screen.material, mutableState.filtering, filterGaze);
          panel.filterGaze = filterGaze;
          panel.filterVersion = filterVersion;
        }
        let quality: TerminalRenderQuality = 'full';
        if (renderer?.xr.isPresenting) {
          if (!panel.root.visible || panel.root.userData.focusHidden) quality = 'hidden';
          else if (panel.id !== renderGazeId) {
            panel.root.getWorldPosition(fidelityPosition);
            panel.root.getWorldScale(fidelityScale);
            quality = terminalQualityAtDistance(
              fidelityPosition.distanceTo(fidelityEye) / Math.max(0.01, Math.abs(fidelityScale.y)),
              panel.renderQuality,
            );
          }
        }
        if (quality === panel.renderQuality) panel.pendingQuality = null;
        else {
          const immediate =
            quality === 'hidden' || QUALITY_RANK[quality] > QUALITY_RANK[panel.renderQuality];
          if (panel.pendingQuality !== quality) {
            panel.pendingQuality = quality;
            panel.qualitySince = time;
          }
          if (immediate || time - panel.qualitySince >= 250) {
            panel.renderQuality = quality;
            panel.pendingQuality = null;
            panel.surface.setRenderQuality?.(quality);
          }
        }
      }
    } else if (lodWasPresenting) {
      mutableState.renderGazeTerminalId = null;
      for (const panel of panels.values()) {
        panel.renderQuality = 'full';
        panel.pendingQuality = null;
        panel.surface.setRenderQuality?.('full');
        panel.filterGaze = false;
        setTerminalMaterialFiltering(panel.screen.material, mutableState.filtering, false);
      }
    }
    lodWasPresenting = Boolean(renderer?.xr.isPresenting);
    if (mutableState.gazeInputEnabled) {
      const gazeCamera = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
      gazeCamera.updateMatrixWorld(true);
      raycaster.far = camera.far;
      const origin = new THREE.Vector3().setFromMatrixPosition(gazeCamera.matrixWorld);
      const direction = gazeCamera.getWorldDirection(new THREE.Vector3());
      raycaster.set(origin, direction);
      const hit = raycaster
        .intersectObjects(
          [...panels.values()]
            .map((panel) => panel.root)
            .concat(inputRoot ? [inputRoot] : [])
            .concat([...widgets.values()].map((widget) => widget.root)),
          true,
        )
        .find((entry) => isControlVisible(entry.object))?.object;
      let target: THREE.Object3D | null = hit ?? null;
      while (target && !target.userData.terminalId) target = target.parent;
      if (
        mutableState.gazeInputEnabled &&
        mutableState.xrMode !== 'desktop' &&
        inputMode !== 'command-editor' &&
        dragStates.size === 0 &&
        mouseCaptures.size === 0
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
        const target = targetFromController(controller, false);
        moveMouse(controller, target);
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
        const modifierPress = modifierPresses.get(controller);
        if (modifierPress && object?.userData.modifier !== modifierPress.modifier)
          modifierPresses.delete(controller);
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
            (modifier && modifierState.active[modifier]) || previous.userData.activeState
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
    for (const panel of panels.values()) panel.surface.flush?.();
    renderer?.render(scene, camera);
    if (!renderer && typeof window.requestAnimationFrame === 'function')
      frameHandle = window.requestAnimationFrame(render);
  };
  resize();
  if (renderer) renderer.setAnimationLoop((time: number) => render(time));
  window.addEventListener('resize', resize);
  const onWheel = (event: WheelEvent): void => {
    if (renderer?.xr.isPresenting || !setPointerRay(event as unknown as PointerEvent)) return;
    const target = targetFromRay();
    const panel = target?.terminalId ? panels.get(target.terminalId) : undefined;
    if (!panel || target?.object !== panel.screen || !target.uv) return;
    const unit = event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? panel.surface.rows : 1 / 40;
    const lines = Math.sign(event.deltaY) * Math.max(1, Math.round(Math.abs(event.deltaY) * unit));
    if (actions.scrollTerminal?.(panel.id, lines, cellAtUV(panel, target.uv)))
      event.preventDefault();
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);

  const setSelectedVisual = (): void => {
    for (const panel of panels.values())
      panel.selection.visible = panel.id === mutableState.selectedTerminalId;
  };
  const saveUIPose = (name: UIPoseName, object: THREE.Object3D): void => {
    if (!renderer || (!renderer.xr.isPresenting && !activeSession)) return;
    const saved = poseStore.save(name, captureUIPose(object, renderer.xr.getCamera()));
    if (!saved && mutableState.notice !== 'UI position could not be saved on this device') {
      mutableState.notice = 'UI position could not be saved on this device';
      notify();
    }
  };
  const placeWidget = (widget: ClockWidget): void => {
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    view.updateWorldMatrix(true, false);
    const eye = view.getWorldPosition(new THREE.Vector3());
    const forward = view.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    forward.normalize();
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(-forward.x, -forward.z),
    );
    const x = widget.root.userData.widgetKind === 'digital-clock' ? -0.45 : 0.45;
    widget.root.position.copy(new THREE.Vector3(x, 0.3, -1.25).applyQuaternion(rotation).add(eye));
    widget.root.quaternion.copy(rotation);
    widget.root.scale.setScalar(1);
  };
  const saveWidgetPose = (kind: WidgetKind, widget: ClockWidget): void => {
    const view = renderer?.xr.isPresenting || activeSession ? renderer?.xr.getCamera() : camera;
    if (view && !widgetPoseStore.save(kind, captureUIPose(widget.root, view)))
      setNotice('Widget position could not be saved on this device');
  };
  const removeWidget = (kind: WidgetKind, persist = true): void => {
    const widget = widgets.get(kind);
    if (!widget) return;
    for (const [controller, drag] of dragStates)
      if (drag.object === widget.root) releaseGrab(controller);
    for (const [controller, object] of hoveredByController)
      if (widget.root.getObjectById(object.id)) hoveredByController.delete(controller);
    showHover(null);
    widget.root.removeFromParent();
    widget.dispose();
    widgets.delete(kind);
    if (persist) widgetPoseStore.remove(kind);
    mutableState.widgets = [...widgets.keys()];
    if (!disposed && inputRoot && inputMode === 'widgets') refreshInputRoot('widgets');
    notify();
  };
  const addWidget = (kind: WidgetKind): ClockWidget => {
    const widget = createClockWidget(kind);
    widget.root.traverse((object) => {
      if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
    });
    widgets.set(kind, widget);
    scene.add(widget.root);
    placeWidget(widget);
    return widget;
  };
  const toggleWidget = (kind: WidgetKind): void => {
    if (widgets.has(kind)) {
      removeWidget(kind);
      return;
    }
    const widget = addWidget(kind);
    saveWidgetPose(kind, widget);
    mutableState.widgets = [...widgets.keys()];
    hideInput();
    notify();
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
    if (!keyboardPoseRestored && (mode === 'keyboard' || mode === 'command-editor')) {
      const saved = poseStore.read('keyboard');
      if (saved && !previousRoot)
        applyUIPose(
          inputRoot,
          renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera,
          saved,
          inputRoot.userData.scaleLimits as [number, number],
        );
      keyboardPoseRestored = true;
    }
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
        : mode === 'widgets'
          ? 'Widgets'
          : mode === 'filtering'
            ? 'Terminal filtering'
            : mode === 'warp'
              ? 'Terminal curvature'
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
        for (const [label, direction] of [
          ['Closer', -1],
          ['Farther', 1],
        ] as const) {
          const button = createLabelButton(label, 0.65, 0.11, {
            inputAction: 'layoutDepth',
            direction,
          });
          button.position.set(direction < 0 ? -0.38 : 0.38, -0.28, 0);
          inputRoot.add(button);
        }
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
      const filteringButton = createLabelButton('Filtering', 0.65, 0.09, {
        inputAction: 'openInput',
        mode: 'filtering',
      });
      filteringButton.position.set(0.65, 0.55, 0);
      inputRoot.add(filteringButton);
      const warpButton = createLabelButton('Warp', 0.65, 0.09, {
        inputAction: 'openInput',
        mode: 'warp',
      });
      warpButton.position.set(-0.65, 0.55, 0);
      inputRoot.add(warpButton);
    } else if (mode === 'warp') {
      const target = mutableState.inputTargetId;
      const degrees = target ? getTerminalCurvature(target) : 0;
      const caption = createLabelButton(
        target ? `Curvature: ${degrees}°` : 'Select a terminal',
        1.4,
        0.14,
        { inputAction: 'noop' },
      );
      caption.position.y = 0.3;
      inputRoot.add(caption);
      for (const [index, value] of [0, 15, 30, 45, 60, 90, 100].entries()) {
        const button = createLabelButton(value === 0 ? 'Flat' : `${value}°`, 0.35, 0.12, {
          inputAction: 'curvature',
          degrees: value,
        });
        button.position.set(((index % 4) - 1.5) * 0.4, 0.08 - Math.floor(index / 4) * 0.18, 0);
        setModifierVisual(button, degrees === value);
        inputRoot.add(button);
      }
      for (const [index, delta] of [-5, 5].entries()) {
        const button = createLabelButton(delta < 0 ? 'Curve less' : 'Curve more', 0.7, 0.12, {
          inputAction: 'curvatureStep',
          delta,
        });
        button.position.set(index ? 0.4 : -0.4, -0.36, 0);
        inputRoot.add(button);
      }
    } else if (mode === 'widgets') {
      for (const [index, kind] of (['digital-clock', 'analog-clock'] as const).entries()) {
        const name = kind === 'digital-clock' ? 'Digital clock' : 'Analog clock';
        const button = createLabelButton(
          (widgets.has(kind) ? 'Hide ' : 'Add ') + name,
          1.25,
          0.14,
          { inputAction: 'toggleWidget', widgetKind: kind },
        );
        button.position.set(0, 0.25 - index * 0.22, 0);
        inputRoot.add(button);
      }
    } else if (mode === 'filtering') {
      const modes: Array<[string, TerminalFilterMode]> = [
        ['Nearest', 'nearest'],
        ['Linear sharp', 'linear'],
        ['Mipmap bilinear', 'mipmap-nearest'],
        ['Mipmap smooth', 'mipmap-linear'],
      ];
      modes.forEach(([label, filterMode], index) => {
        const button = createLabelButton(label, 0.74, 0.12, {
          inputAction: 'filterMode',
          filterMode,
        });
        button.position.set(index % 2 ? 0.4 : -0.4, 0.3 - Math.floor(index / 2) * 0.16, 0);
        setModifierVisual(button, mutableState.filtering.mode === filterMode);
        inputRoot?.add(button);
      });
      const mipMode = mutableState.filtering.mode.startsWith('mipmap-');
      const maximum = Number(scene.userData.maxAnisotropy ?? 1);
      if (mipMode) {
        const levels = ([1, 2, 4, 8, 16] as const).filter((value) => value <= maximum);
        levels.forEach((anisotropy, index) => {
          const button = createLabelButton(anisotropy === 1 ? 'Off' : `${anisotropy}x`, 0.26, 0.1, {
            inputAction: 'filterAnisotropy',
            anisotropy,
          });
          button.position.set((index - (levels.length - 1) / 2) * 0.3, -0.1, 0);
          setModifierVisual(button, mutableState.filtering.anisotropy === anisotropy);
          inputRoot?.add(button);
        });
        const hint = createLabelButton(`Oblique smoothing · device max ${maximum}x`, 1.45, 0.055, {
          inputAction: 'noop',
        });
        hint.position.y = -0.19;
        inputRoot.add(hint);
      }
      const gaze = createLabelButton(
        `Sharper gaze: ${mutableState.filtering.gazeClarity ? 'on' : 'off'}`,
        1.2,
        0.1,
        { inputAction: 'filterGaze' },
      );
      gaze.position.y = -0.28;
      setModifierVisual(gaze, mutableState.filtering.gazeClarity);
      inputRoot.add(gaze);
      if (mipMode && mutableState.filtering.gazeClarity) {
        const distance = createLabelButton(
          `Sharpen within ${mutableState.filtering.gazeMaxDistance.toFixed(2)} m`,
          1.08,
          0.08,
          { inputAction: 'noop' },
        );
        distance.position.y = -0.42;
        inputRoot.add(distance);
        for (const [index, delta] of [-0.25, 0.25].entries()) {
          const button = createLabelButton(delta < 0 ? '−' : '+', 0.15, 0.1, {
            inputAction: 'filterDistance',
            delta,
          });
          button.position.set(index ? 0.7 : -0.7, -0.42, 0);
          inputRoot.add(button);
        }
      }
    } else {
      const unit = 0.13;
      for (const key of keyboardKeys) {
        const button = createLabelButton(
          key.key.length === 1 && key.key !== ' '
            ? terminalKeyLabel(key.key, Boolean(modifierState.active.shift))
            : key.label,
          key.width * unit - 0.014,
          key.height * unit - 0.03,
          { inputAction: 'key', key: key.key, modifier: key.modifier },
        );
        button.position.set(
          (key.x + key.width / 2 - keyboardDimensions.width / 2) * unit,
          0.48 - (key.y + key.height / 2) * unit,
          0,
        );
        inputRoot.add(button);
      }
    }
    const close = createLabelButton('Close', 0.3, 0.09, { inputAction: 'close' });
    close.position.set(0, -0.66, 0);
    inputRoot.add(close);
    if (mode !== 'command-editor') {
      const backgroundSelect = createBackgroundSelect(mutableState.background, 'input');
      backgroundSelect.position.y = -0.53;
      inputRoot.add(backgroundSelect);
    }
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
    syncModifierVisuals();
  };
  const createHud = (): void => {
    hudRoot = new THREE.Group();
    hudRoot.name = 'xr-workspace-hud';
    hudRoot.userData.scaleLimits = [0.25, 1.4];
    hudRoot.position.set(0, 0.78, -1.35);
    hudRoot.scale.setScalar(0.62);
    const controls: Array<[string, Record<string, unknown>]> = [
      ['Commands', { inputAction: 'openInput', mode: 'commands' }],
      ['Widgets', { inputAction: 'openInput', mode: 'widgets' }],
      ['Panes', { inputAction: 'openInput', mode: 'panes' }],
      ['Terminal', { inputAction: 'openInput', mode: 'terminal' }],
      ['Arrange', { inputAction: 'openInput', mode: 'arrange' }],
      ['Exit', { inputAction: 'exit' }],
      [BACKGROUND_LABELS[mutableState.background], { inputAction: 'backgroundSelect' }],
      ['Gaze input: off', { inputAction: 'gazeInput', gazeInputEnabled: false }],
    ];
    const widths = controls.map(([, data]) =>
      data.inputAction === 'backgroundSelect'
        ? 0.48
        : data.inputAction === 'gazeInput'
          ? 0.34
          : 0.27,
    );
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + (controls.length - 1) * 0.04;
    let left = -totalWidth / 2;
    controls.forEach(([label, data], index) => {
      const button =
        data.inputAction === 'backgroundSelect'
          ? createBackgroundSelect(mutableState.background, 'hud')
          : createLabelButton(label, widths[index], 0.09, data);
      button.position.x = left + widths[index] / 2;
      left += widths[index] + 0.04;
      hudRoot?.add(button);
    });
    updateNotice = createLabelButton('Update: Reload', 0.42, 0.09, { inputAction: 'reloadUpdate' });
    updateNotice.position.set(0, 0.16, 0);
    updateNotice.visible = false;
    hudRoot.add(updateNotice);
    statusNotice = createLabelButton(mutableState.notice ?? '', 1.4, 0.075, {
      inputAction: 'dismissNotice',
      wrap: true,
    });
    statusNotice.position.set(0, 0.3, 0);
    statusNotice.visible = Boolean(mutableState.notice);
    hudRoot.add(statusNotice);
    statusDismiss = createLabelButton('×', 0.075, 0.075, { inputAction: 'dismissNotice' });
    statusDismiss.position.set(0.78, 0.3, 0);
    statusDismiss.visible = Boolean(mutableState.notice);
    hudRoot.add(statusDismiss);
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(totalWidth + 0.08, 0.15),
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
    if (statusDismiss) statusDismiss.visible = Boolean(message);
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
    const next = Math.max(0.3, Math.min(1.8, current + direction * 0.1));
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
    if (action === 'backgroundSelect') {
      const options = hit.parent?.getObjectByName('background-options');
      const open = !options?.visible;
      closeBackgroundMenus();
      if (options) options.visible = open;
      return true;
    }
    if (!action || action === 'noop') return false;
    if (action === 'close') {
      commandDraft = null;
      hideInput();
      return true;
    }
    if (action === 'closePane') {
      const paneId = hit.userData.terminalId as string | undefined;
      if (paneId) actions.closePane(paneId);
      return true;
    }
    if (action === 'toggleConnection') {
      const paneId = hit.userData.terminalId as string | undefined;
      if (paneId) actions.togglePaneConnection?.(paneId);
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
    if (action === 'dismissNotice') {
      setNotice(null);
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
    if (action === 'toggleWidget') {
      toggleWidget(hit.userData.widgetKind as WidgetKind);
      return true;
    }
    if (action === 'closeWidget') {
      const kind = [...widgets.entries()].find(
        ([, widget]) => widget.root.userData.widgetId === hit.userData.widgetId,
      )?.[0];
      if (kind) removeWidget(kind);
      return true;
    }
    if (action === 'grabWidget') return true;
    if (action === 'curvature' || action === 'curvatureStep') {
      const id = mutableState.inputTargetId;
      if (id)
        setTerminalCurvature(
          id,
          action === 'curvature'
            ? Number(hit.userData.degrees)
            : getTerminalCurvature(id) + Number(hit.userData.delta),
        );
      return true;
    }
    if (action === 'filterDistance') {
      setTerminalFiltering({
        ...mutableState.filtering,
        gazeMaxDistance: mutableState.filtering.gazeMaxDistance + Number(hit.userData.delta),
      });
      return true;
    }
    if (action === 'filterMode' || action === 'filterAnisotropy' || action === 'filterGaze') {
      setTerminalFiltering({
        ...mutableState.filtering,
        ...(action === 'filterMode' ? { mode: hit.userData.filterMode as TerminalFilterMode } : {}),
        ...(action === 'filterAnisotropy'
          ? { anisotropy: Number(hit.userData.anisotropy) as TerminalFiltering['anisotropy'] }
          : {}),
        ...(action === 'filterGaze' ? { gazeClarity: !mutableState.filtering.gazeClarity } : {}),
      });
      return true;
    }
    if (action === 'layoutDepth') {
      moveLayoutDepth(Number(hit.userData.direction));
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
      if (modifier) modifierState.tap(modifier);
      else {
        commandDraft = editCommandDraft(
          commandDraft,
          hit.userData.key as string,
          modifierState.active,
        );
        consumeArmedModifiers();
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
        modifierState.tap(modifier);
        syncModifierVisuals();
        setModifierVisual(hit, Boolean(modifierState.active[modifier]));
        if (modifier === 'shift') refreshInputRoot(inputMode);
        return true;
      }
      const modifiers = Object.keys(modifierState.active).length
        ? { ...modifierState.active }
        : undefined;
      actions.sendKey(hit.userData.key as string, modifiers);
      consumeArmedModifiers();
      if (inputMode === 'keyboard') refreshInputRoot(inputMode);
    } else if (action === 'command') {
      const command = menuCommands.find((item) => item.id === hit.userData.commandId);
      if (command) actions.runCommand(command, paneId);
    }
    return true;
  };
  const targetFromRay = (): InputTarget | null => {
    let reach = CONTROLLER_RAY_LENGTH;
    for (const panel of panels.values()) {
      panel.root.getWorldPosition(reachPosition);
      reach = Math.max(
        reach,
        raycaster.ray.origin.distanceTo(reachPosition) +
          (Math.hypot(panel.width, panel.height) / 2 + 1) * panel.root.scale.x,
      );
    }
    for (const root of [
      inputRoot,
      hudRoot,
      ...[...widgets.values()].map((widget) => widget.root),
    ]) {
      if (!root) continue;
      root.getWorldPosition(reachPosition);
      reach = Math.max(reach, raycaster.ray.origin.distanceTo(reachPosition) + 3 * root.scale.x);
    }
    raycaster.far = Math.min(camera.far, reach);
    const targets = [...panels.values()]
      .filter((panel) => panel.root.visible && !panel.root.userData.focusHidden)
      .map((panel) => panel.root);
    if (inputRoot) targets.push(inputRoot);
    if (hudRoot) targets.push(hudRoot);
    for (const widget of widgets.values()) targets.push(widget.root);
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
    return { terminalId, kind: key ? 'key' : 'terminal', object: hit, uv: intersection?.uv };
  };
  const targetFromController = (root: THREE.Group, updateWorld = true): InputTarget | null => {
    if (updateWorld) scene.updateMatrixWorld(true);
    tempMatrix.identity().extractRotation(root.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(root.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix).normalize();
    const target = targetFromRay();
    root.userData.rayDistance = Math.max(0.02, lastRayDistance);
    return target;
  };
  const activateTarget = (target: InputTarget | null): void => {
    if (target?.object?.userData.inputAction !== 'backgroundSelect') closeBackgroundMenus();
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
          modifierState.tap(modifier);
          syncModifierVisuals();
          if (hit) setModifierVisual(hit, Boolean(modifierState.active[modifier]));
        } else {
          actions.sendKey(
            keyName,
            Object.keys(modifierState.active).length ? { ...modifierState.active } : undefined,
          );
          consumeArmedModifiers();
        }
      }
    }
  };
  const onControllerSelect = (controller: THREE.Group): void => {
    const target = targetFromController(controller);
    const modifiers = Object.keys(modifierState.active).length
      ? { ...modifierState.active }
      : undefined;
    activateTarget(target);
    beginModifierPress(controller, target);
    startMouse(controller, target, 0, modifiers);
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
        if (
          heldControllers.has(root) ||
          controllerGamepads.get(root)?.buttons[1]?.pressed ||
          disconnectedControllers.has(root)
        )
          return;
        onControllerSelect(root);
      };
      const onSelectEnd = (): void => {
        modifierPresses.delete(root);
        if (mouseCaptures.has(root) && !gripActive()) {
          moveMouse(root, targetFromController(root));
        }
        releaseMouse(root);
      };
      const onSqueeze = (event: Event): void => {
        if (heldControllers.has(root) || disconnectedControllers.has(root)) return;
        releaseAllMouse();
        modifierPresses.clear();
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
        else if (target.object?.userData.widgetId) {
          object =
            [...widgets.values()].find(
              (widget) => widget.root.userData.widgetId === target.object?.userData.widgetId,
            )?.root ?? null;
        } else if (target.terminalId && target.object) {
          const panel = panels.get(target.terminalId);
          if (panel?.root.getObjectById(target.object.id)) object = panel.root;
        }
        if (!object) return;
        paneFocus.cancelMotion(object);
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
        const object = dragStates.get(root)?.object;
        heldControllers.delete(root);
        releaseGrab(root);
        if (object && ![...dragStates.values()].some((drag) => drag.object === object)) {
          if (object === hudRoot) saveUIPose('hud', object);
          else if (
            object === inputRoot &&
            (inputMode === 'keyboard' || inputMode === 'command-editor')
          )
            saveUIPose('keyboard', object);
          if (object.userData.widgetKind) {
            const kind = object.userData.widgetKind as WidgetKind;
            const widget = widgets.get(kind);
            if (widget) saveWidgetPose(kind, widget);
          }
        }
      };
      const onConnected = (event: Event): void => {
        disconnectedControllers.delete(root);
        rayLine.visible = true;
        const data = (event as Event & { data?: { gamepad?: Gamepad; handedness?: string } }).data;
        const gamepad = data?.gamepad;
        controllerHandedness.set(root, data?.handedness ?? 'none');
        if (gamepad?.buttons[4]?.pressed) keyboardButtonDown.add(root);
        else keyboardButtonDown.delete(root);
        if (gamepad?.buttons[5]?.pressed) focusButtonDown.add(root);
        else focusButtonDown.delete(root);
        if (gamepad) controllerGamepads.set(root, gamepad);
      };
      const onDisconnected = (): void => {
        releaseMouse(root);
        modifierPresses.delete(root);
        keyboardButtonDown.delete(root);
        disconnectedControllers.add(root);
        heldControllers.delete(root);
        rayLine.visible = false;
        contact.visible = false;
        controllerGamepads.delete(root);
        controllerHandedness.delete(root);
        focusButtonDown.delete(root);
        releaseGrab(root);
        recenterSince = null;
        const previous = hoveredByController.get(root);
        hoveredByController.delete(root);
        if (previous && ![...hoveredByController.values()].includes(previous)) {
          const material = (previous as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          const modifier = previous.userData.modifier as keyof KeyModifiers | undefined;
          if (material?.color)
            material.color.setHex(
              (modifier && modifierState.active[modifier]) || previous.userData.activeState
                ? ACCENT
                : 0xffffff,
            );
        }
        root.userData.rayDistance = 0;
      };
      const eventRoot = root as unknown as EventRoot;
      eventRoot.addEventListener('selectstart', onSelect);
      eventRoot.addEventListener('selectend', onSelectEnd);
      eventRoot.addEventListener('squeezestart', onSqueeze);
      eventRoot.addEventListener('squeezeend', onSqueezeEnd);
      eventRoot.addEventListener('connected', onConnected);
      eventRoot.addEventListener('disconnected', onDisconnected);
      controllerRoots.push(root);
      controllerListeners.push({
        root,
        onSelect,
        onSelectEnd,
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
    if (
      width === panel.width &&
      height === panel.height &&
      panel.curvature === panel.geometryCurvature
    )
      return;
    panel.width = width;
    panel.height = height;
    panel.geometryCurvature = panel.curvature;
    const radians = THREE.MathUtils.degToRad(panel.curvature);
    const span = { width, height, radians };
    const bent = radians > 0;
    panel.root.userData.curvatureDegrees = panel.curvature;
    panel.root.userData.curvatureDepth = getTerminalWarpBounds(span).depth;
    panel.screen.geometry.dispose();
    panel.screen.geometry = bent
      ? createCurvedTerminalGeometry(span)
      : new THREE.PlaneGeometry(width, height);
    panel.frame.geometry.dispose();
    panel.frame.geometry = new THREE.BoxGeometry(
      width + 0.035,
      height + 0.06,
      0.035,
      bent ? 32 : 1,
    );
    if (bent) warpGeometryPositions(panel.frame.geometry, span);
    panel.selection.geometry.dispose();
    panel.selection.geometry = bent
      ? createCurvedTerminalSelection({
          width: width + 0.07,
          height: height + 0.07,
          radians,
          border: 0.03,
        })
      : selectionGeometry(width, height);
    panel.titleLabel.position.y = height / 2 + 0.07;
    const strip = panel.root.getObjectByName('terminal-key-strip');
    if (strip) strip.position.y = -(height - PANEL_HEIGHT) / 2;
    for (const child of panel.root.children) {
      if (child.userData.inputAction !== 'fontZoom') continue;
      child.position.x = Number(child.userData.direction) * (width / 2 + 0.08);
      child.position.y = height / 2 - 0.18;
    }
    panel.connectionButton.position.set(0.24, -(height / 2 + 0.24), 0.02);
    panel.closeButton.position.set(-0.24, -(height / 2 + 0.24), 0.02);
    const followCurve = (object: THREE.Object3D): void => {
      const flatX = object.position.x;
      const point = terminalWarpPoint(flatX, span);
      object.position.x = point.x;
      object.position.z = 0.02 + point.z;
      object.rotation.y = radians ? -(flatX / width) * radians : 0;
    };
    for (const child of panel.root.children)
      if (child.userData.inputAction === 'fontZoom') followCurve(child);
    followCurve(panel.connectionButton);
    followCurve(panel.closeButton);
    strip?.children.forEach((child) => {
      child.userData.flatX ??= child.position.x;
      child.position.x = Number(child.userData.flatX);
      followCurve(child);
    });
  };
  const addTerminal = (surface: TerminalSurface): void => {
    if (panels.has(surface.pane.id)) return;
    const occupied = new Set([...panels.values()].map((panel) => panel.root.userData.initialSlot));
    let index = 0;
    while (occupied.has(index)) index += 1;
    const defaultPosition = new THREE.Vector3(
      index % 2 === 0 ? -0.87 : 0.87,
      1.5 - Math.floor(index / 2) * 0.95,
      -1.5,
    );
    const root = new THREE.Group();
    root.name = `terminal-panel-${surface.pane.id}`;
    root.userData.terminalId = surface.pane.id;
    root.userData.initialSlot = index;
    root.userData.scaleLimits = [0.3, 1.8];
    root.position.copy(defaultPosition);
    root.rotation.y = index % 2 === 0 ? 0.06 : -0.06;
    const textureSource = createTerminalTexture(surface, renderer ?? undefined);
    textureSource.setFiltering(mutableState.filtering);
    const texture = textureSource.texture;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      createTerminalMaterial(texture),
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
    const shortError = surface.error ? ` · ${surface.error.slice(0, 28)}` : '';
    const titleLabel = createLabelButton(
      `${surface.pane.title} · ${surface.status}${shortError}`,
      0.92,
      0.08,
      {
        terminalId: surface.pane.id,
        terminalTitle: true,
      },
    );
    titleLabel.userData.helpText = surface.error ?? titleLabel.userData.helpText;
    titleLabel.position.set(0, 0.47, 0.02);
    const connectionButton = createLabelButton(
      ['connected', 'connecting'].includes(String(surface.status)) ? 'Disconnect' : 'Reconnect',
      0.46,
      0.08,
      {
        inputAction: 'toggleConnection',
        terminalId: surface.pane.id,
        status: surface.status,
      },
    );
    const closeButton = createLabelButton('Close view', 0.38, 0.08, {
      inputAction: 'closePane',
      terminalId: surface.pane.id,
    });
    root.add(selection, keyStrip, fontDown, fontUp, titleLabel, connectionButton, closeButton);
    const panel: TerminalPanel = {
      id: surface.pane.id,
      surface,
      root,
      screen,
      texture,
      textureSource,
      frame,
      selection,
      unsubscribe: () => undefined,
      defaultPosition,
      titleLabel,
      connectionButton,
      closeButton,
      width: PANEL_WIDTH,
      height: 0,
      revision: surface.revision,
      status: String(surface.status),
      title: surface.pane.title,
      error: surface.error,
      renderQuality: 'full',
      pendingQuality: null,
      qualitySince: 0,
      filterVersion,
      filterGaze: false,
      filterGazeAt: 0,
      curvature: warpStore.get(warpKey(surface)),
      geometryCurvature: -1,
    };
    syncPanelGrid(panel);
    panel.unsubscribe = surface.subscribe(() => {
      syncPanelGrid(panel);
      if (surface.revision !== panel.revision) {
        panel.revision = surface.revision;
        textureSource.update();
        if (panel.texture !== textureSource.texture) {
          panel.texture = textureSource.texture;
          screen.material.map = panel.texture;
        }
      }
      const status = String(surface.status);
      const statusChanged = status !== panel.status;
      const errorChanged = surface.error !== panel.error;
      if (statusChanged) {
        panel.status = status;
        panel.connectionButton.userData.status = status;
        panel.connectionButton.userData.helpText = getControlHelp(panel.connectionButton.userData);
        updateLabel(
          panel.connectionButton,
          ['connected', 'connecting'].includes(status) ? 'Disconnect' : 'Reconnect',
        );
      }
      if (surface.pane.title !== panel.title || statusChanged || errorChanged) {
        panel.title = surface.pane.title;
        updateLabel(
          panel.titleLabel,
          `${surface.pane.title} · ${surface.status}${surface.error ? ` · ${surface.error.slice(0, 28)}` : ''}`,
        );
      }
      if (errorChanged) {
        panel.error = surface.error;
        panel.titleLabel.userData.helpText =
          surface.error ?? getControlHelp({ terminalTitle: true });
      }
    });
    panels.set(panel.id, panel);
    terminalScreens.push(screen);
    scene.add(root);
    if (!mutableState.selectedTerminalId) {
      mutableState.selectedTerminalId = panel.id;
      mutableState.focusedTerminalId = panel.id;
    }
    setSelectedVisual();
    paneFocus.add(root);
    if (inputRoot && inputMode === 'arrange') refreshInputRoot('arrange');
    notify();
  };
  const removeTerminal = (id: string): void => {
    const panel = panels.get(id);
    if (!panel) return;
    terminalScreens.splice(terminalScreens.indexOf(panel.screen), 1);
    paneFocus.remove(panel.root);
    mutableState.focusModeTerminalId = paneFocus.activeId;
    for (const [source, capture] of mouseCaptures) if (capture.id === id) releaseMouse(source);
    panel.unsubscribe();
    scene.remove(panel.root);
    panel.textureSource.dispose();
    panel.screen.material.map = null;
    disposeObject(panel.root);
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
    if (paneFocus.activeId && nextId !== paneFocus.activeId) endFocusMode(true);
    if (nextId === mutableState.selectedTerminalId && mutableState.focusedTerminalId === nextId)
      return;
    if (!gazeRetargeting) gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    keyboardResume = null;
    clearArmedModifiers();
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
  const getTerminalCurvature = (id: string): number => panels.get(id)?.curvature ?? 0;
  const setTerminalCurvature = (id: string, degrees: number): void => {
    const panel = panels.get(id);
    if (!panel || !Number.isFinite(degrees)) return;
    panel.curvature = THREE.MathUtils.clamp(degrees, 0, 100);
    syncPanelGrid(panel);
    if (!warpStore.set(warpKey(panel.surface), panel.curvature))
      setNotice('Curvature could not be saved on this device');
    if (inputRoot && inputMode === 'warp') refreshInputRoot('warp');
    notify();
  };
  const setTerminalFiltering = (filtering: TerminalFiltering): void => {
    const next = validateTerminalFiltering({
      ...filtering,
      anisotropy: Math.min(filtering.anisotropy, Number(scene.userData.maxAnisotropy ?? 1)),
    });
    if (JSON.stringify(next) === JSON.stringify(mutableState.filtering)) return;
    mutableState.filtering = next;
    filterVersion += 1;
    for (const panel of panels.values()) {
      panel.textureSource.setFiltering(next);
      setTerminalMaterialFiltering(panel.screen.material, next, panel.filterGaze);
      panel.filterVersion = filterVersion;
    }
    if (inputRoot && inputMode === 'filtering') refreshInputRoot('filtering');
    notify();
  };
  const setBackground = (mode: BackgroundMode): void => {
    mutableState.background = mode;
    closeBackgroundMenus();
    for (const owner of [hudRoot, inputRoot]) {
      const select = owner?.getObjectByName('background-select');
      const trigger = select?.getObjectByName('background-select-trigger') as
        | THREE.Mesh
        | undefined;
      if (trigger) updateLabel(trigger, BACKGROUND_LABELS[mode]);
      select?.traverse((child) => {
        if (child.userData.inputAction === 'background')
          setModifierVisual(child, child.userData.background === mode);
      });
    }
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
    keyboardResume = null;
    if (
      !renderer?.xr.isPresenting &&
      mode !== 'panes' &&
      mode !== 'terminal' &&
      mode !== 'arrange' &&
      mode !== 'widgets' &&
      mode !== 'filtering' &&
      mode !== 'warp'
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
  const toggleKeyboard = (): void => {
    modifierPresses.clear();
    if (inputRoot && (inputMode === 'keyboard' || inputMode === 'command-editor')) {
      keyboardResume = {
        mode: inputMode,
        target: mutableState.selectedTerminalId,
        locked: modifierState.locked,
      };
      hideInput();
      return;
    }
    const resume =
      !inputRoot && keyboardResume?.target === mutableState.selectedTerminalId
        ? keyboardResume
        : null;
    showInput(resume?.mode === 'command-editor' && commandDraft ? 'command-editor' : 'keyboard');
    if (resume)
      for (const name of ['ctrl', 'alt', 'shift'] as const)
        if (resume.locked[name]) modifierState.lock(name);
    if (resume && inputRoot) refreshInputRoot(inputMode);
    keyboardResume = null;
    syncModifierVisuals();
  };
  const hideInput = (): void => {
    if (inputRoot && (inputMode === 'keyboard' || inputMode === 'command-editor'))
      saveUIPose('keyboard', inputRoot);
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
  const startXR = async (mode: 'vr' | 'ar'): Promise<void> => {
    if (!renderer) throw new Error('WebGL is unavailable');
    const xr = (
      navigator as Navigator & {
        xr?: { requestSession(mode: string, options?: unknown): Promise<XrSessionLike> };
      }
    ).xr;
    if (!xr) throw new Error('WebXR is unavailable');
    const sessionMode = mode === 'ar' ? 'immersive-ar' : 'immersive-vr';
    releaseAllMouse();
    const session = await xr.requestSession(
      sessionMode,
      mode === 'ar'
        ? { optionalFeatures: ['local-floor', 'dom-overlay'] }
        : { optionalFeatures: ['local-floor'] },
    );
    activeSession = session;
    poseRestorePending = true;
    widgetRestorePending = true;
    keyboardPoseRestored = false;
    keyboardResume = null;
    hideInput();
    inputTransform = null;
    previousRenderTime = null;
    frameCounter.reset();
    mutableState.fps = null;
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    desktopCameraPosition.copy(camera.position);
    desktopCameraQuaternion.copy(camera.quaternion);
    renderer.xr.setReferenceSpaceType('local-floor');
    try {
      await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
    } catch (error) {
      activeSession = null;
      await session.end().catch(() => undefined);
      throw error;
    }
    mutableState.xrMode = mode;
    setNotice(null);
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
      for (const [kind, widget] of widgets) saveWidgetPose(kind, widget);
      if (hudRoot) saveUIPose('hud', hudRoot);
      if (inputRoot && (inputMode === 'keyboard' || inputMode === 'command-editor'))
        saveUIPose('keyboard', inputRoot);
      keyboardResume = null;
      endFocusMode(true);
      releaseAllMouse();
      activeSession = null;
      hideInput();
      inputTransform = null;
      dragStates.clear();
      pairGrabs.clear();
      recenterSince = null;
      recenterLatched = false;
      heldControllers.clear();
      scrollDue.clear();
      controllerGamepads.clear();
      controllerHandedness.clear();
      focusButtonDown.clear();
      keyboardButtonDown.clear();
      modifierPresses.clear();
      previousRenderTime = null;
      hoveredByController.clear();
      showHover(null);
      gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
      mutableState.xrMode = 'desktop';
      mutableState.renderGazeTerminalId = null;
      for (const panel of panels.values()) {
        panel.renderQuality = 'full';
        panel.pendingQuality = null;
        panel.surface.setRenderQuality?.('full');
        panel.filterGaze = false;
        setTerminalMaterialFiltering(panel.screen.material, mutableState.filtering, false);
      }
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
  const enterXR = (mode: 'vr' | 'ar'): Promise<void> => {
    if (activeSession || mutableState.xrMode !== 'desktop') return Promise.resolve();
    if (xrStartPromise) return xrStartPromise;
    const pending = startXR(mode).finally(() => {
      if (xrStartPromise === pending) xrStartPromise = null;
    });
    xrStartPromise = pending;
    return pending;
  };
  const exitXR = async (): Promise<void> => {
    if (activeSession) await activeSession.end();
  };
  const endFocusMode = (immediate = false): void => {
    paneFocus.exit(immediate);
    mutableState.focusModeTerminalId = null;
  };
  const toggleFocusMode = (id?: string): void => {
    if (gripActive()) return;
    releaseAllMouse();
    closeBackgroundMenus();
    showHover(null);
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    if (paneFocus.activeId) {
      endFocusMode();
      notify();
      return;
    }
    const panel = panels.get(id ?? mutableState.selectedTerminalId ?? '');
    if (!panel) return;
    selectTerminal(panel.id);
    const bounds = measurePanelBounds(panel.root);
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    view.updateWorldMatrix(true, false);
    const eye = view.getWorldPosition(new THREE.Vector3());
    const forward = view.getWorldDirection(new THREE.Vector3());
    const rotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(eye, eye.clone().add(forward), new THREE.Vector3(0, 1, 0)),
    );
    const distance = Math.max(
      0.8,
      bounds.size.width / (2 * Math.tan(THREE.MathUtils.degToRad(25))),
      bounds.size.height / (2 * Math.tan(THREE.MathUtils.degToRad(18))),
    );
    const position = new THREE.Vector3(0, 0, -distance)
      .applyQuaternion(rotation)
      .add(eye)
      .sub(bounds.center.clone().multiply(panel.root.scale).applyQuaternion(rotation));
    if (panel.root.parent) {
      panel.root.parent.worldToLocal(position);
      rotation.premultiply(panel.root.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    paneFocus.enter(
      panel.id,
      panel.root,
      [...panels.values()].map((value) => value.root),
      position,
      rotation,
    );
    mutableState.focusModeTerminalId = panel.id;
    notify();
  };
  const arrangeTerminals = (pattern: PanelArrangement): void => {
    if (!panels.size) return;
    endFocusMode(true);
    const ordered = [...panels.values()];
    const bounds = ordered.map(({ root }) => measurePanelBounds(root));
    const poses = calculateArrangement(
      pattern,
      bounds.map((bound, index) => {
        const panel = ordered[index];
        const depth = Number(panel.root.userData.curvatureDepth ?? 0) * panel.root.scale.z;
        return depth > 0
          ? {
              width: Math.max(bound.size.width, panel.width * panel.root.scale.x) + 2 * depth,
              height: bound.size.height + 2 * depth,
            }
          : bound.size;
      }),
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
      const offset = bounds[index].center
        .clone()
        .multiply(panel.root.scale)
        .applyQuaternion(poses[index].quaternion);
      panel.root.position.copy(poses[index].position).sub(offset).applyQuaternion(yaw).add(eye);
      panel.root.quaternion.copy(yaw).multiply(poses[index].quaternion);
    });
    keepLayoutAboveFloor(
      ordered.map((panel) => panel.root),
      workspaceFloorY(mutableState.background, mutableState.xrMode),
      eye,
    );
    for (const [controller, drag] of dragStates)
      if (ordered.some((panel) => panel.root === drag.object)) captureGrab(controller, drag.object);
    for (const [object, pair] of pairGrabs)
      if (ordered.some((panel) => panel.root === object))
        beginPairGrab(object, ...pair.controllers);
    mutableState.arrangement = pattern;
    if (inputRoot && inputMode === 'arrange') refreshInputRoot('arrange');
    notify();
  };
  const moveLayoutDepth = (direction: number): void => {
    if (!panels.size || !Number.isFinite(direction) || direction === 0) return;
    endFocusMode(true);
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    scene.updateMatrixWorld(true);
    view.updateWorldMatrix(true, false);
    const eye = view.getWorldPosition(new THREE.Vector3());
    const center = new THREE.Vector3();
    for (const panel of panels.values())
      center.add(panel.root.getWorldPosition(new THREE.Vector3()));
    center.divideScalar(panels.size).sub(eye);
    center.y = 0;
    if (center.lengthSq() < 0.0001) {
      view.getWorldDirection(center);
      center.y = 0;
    }
    if (center.lengthSq() < 0.0001) center.set(0, 0, -1);
    center.normalize();
    let distance = Math.sign(direction) * 0.4;
    if (distance < 0) {
      let nearest = Infinity;
      for (const panel of panels.values()) {
        const box = new THREE.Box3().setFromObject(panel.root);
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              nearest = Math.min(nearest, new THREE.Vector3(x, y, z).sub(eye).dot(center));
            }
      }
      distance = -Math.min(-distance, Math.max(0, nearest - 0.8));
    }
    const delta = center.multiplyScalar(distance);
    for (const panel of panels.values()) {
      const position = panel.root.getWorldPosition(new THREE.Vector3()).add(delta);
      panel.root.position.copy(
        panel.root.parent ? panel.root.parent.worldToLocal(position) : position,
      );
    }
    for (const [controller, drag] of dragStates)
      if (drag.object.userData.terminalId) captureGrab(controller, drag.object);
    for (const [object, pair] of pairGrabs)
      if (object.userData.terminalId) beginPairGrab(object, ...pair.controllers);
    notify();
  };
  const resetLayout = (): void => {
    poseStore.clear();
    keyboardPoseRestored = true;
    endFocusMode(true);
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
    for (const [kind, widget] of widgets) {
      placeWidget(widget);
      saveWidgetPose(kind, widget);
    }
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    keepLayoutAboveFloor(
      [...panels.values()].map((panel) => panel.root),
      workspaceFloorY(mutableState.background, mutableState.xrMode),
      view.getWorldPosition(new THREE.Vector3()),
    );
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
    const roots: THREE.Object3D[] = [...panels.values()]
      .map((panel) => panel.root)
      .concat([...widgets.values()].map((widget) => widget.root));
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
    paneFocus.dispose();
    window.cancelAnimationFrame(frameHandle);
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('lostpointercapture', onPointerUp);
    renderer?.setAnimationLoop(null);
    for (const id of [...panels.keys()]) removeTerminal(id);
    for (const kind of [...widgets.keys()]) removeWidget(kind, false);
    for (const {
      root,
      onSelect,
      onSelectEnd,
      onSqueeze,
      onSqueezeEnd,
      onConnected,
      onDisconnected,
    } of controllerListeners) {
      const eventRoot = root as unknown as EventRoot;
      eventRoot.removeEventListener('selectstart', onSelect);
      eventRoot.removeEventListener('selectend', onSelectEnd);
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
    scrollDue.clear();
    controllerGamepads.clear();
    controllerHandedness.clear();
    focusButtonDown.clear();
    keyboardButtonDown.clear();
    modifierPresses.clear();
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
    setTerminalFiltering,
    getTerminalCurvature,
    setTerminalCurvature,
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
    toggleFocusMode,
    resetLayout,
    scaleSelectedPanel,
    moveLayoutDepth,
    getControlHints,
    dispose,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type { BackgroundMode };
