import * as THREE from 'three';
import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  QuickCommand,
  TerminalSurface,
  WorkspaceActions,
} from '../contracts';
import { getControlHelp } from '../control-help';
import { terminalKeyLabel } from '../terminal/protocol';
import { type SemanticKey, semanticKeyboardLayout } from '../ui';

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
  gazeEnabled: boolean;
  xrMode: 'desktop' | 'vr' | 'ar';
  focusedTerminalId: string | null;
  rendererError: string | null;
  inputTargetId: string | null;
  inputTargetTitle: string | null;
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
  setGazeEnabled(enabled: boolean): void;
  setAvailablePanes(panes: PaneDescriptor[]): void;
  setQuickCommands(commands: QuickCommand[]): void;
  showInput(mode: 'commands' | 'keyboard' | 'panes'): void;
  hideInput(): void;
  enterXR(mode: 'vr' | 'ar'): Promise<void>;
  resetLayout(): void;
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
  selection: THREE.LineSegments;
  unsubscribe: () => void;
  defaultPosition: THREE.Vector3;
  titleLabel: THREE.Mesh;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      for (const key of [
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'emissiveMap',
        'envMap',
      ]) {
        const texture = (material as unknown as Record<string, THREE.Texture | undefined>)[key];
        texture?.dispose();
      }
      material.dispose();
    }
  });
}

function createCanvasTexture(surface: TerminalSurface): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(surface.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createLabelTexture(
  label: string,
  width: number,
  height: number,
  background = '#1c2a35',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const density = Math.min(1024, 2048 / width, 512 / height);
  canvas.width = Math.max(1, Math.round(width * density));
  canvas.height = Math.max(1, Math.round(height * density));
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#4a6b78';
    context.lineWidth = 2;
    context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    context.fillStyle = '#edf7fa';
    let fontSize = Math.round(canvas.height * 0.42);
    const padding = Math.round(canvas.height * 0.15);
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    while (
      context.measureText(label).width > canvas.width - padding * 2 &&
      fontSize > canvas.height * 0.25
    ) {
      fontSize -= 1;
      context.font = `600 ${fontSize}px system-ui, sans-serif`;
    }
    let text = label;
    while (text.length > 1 && context.measureText(text).width > canvas.width - padding * 2)
      text = `${text.slice(0, -2)}…`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createLabelButton(
  label: string,
  width: number,
  height: number,
  data: Record<string, unknown>,
): THREE.Mesh {
  const texture = createLabelTexture(label, width, height);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  );
  Object.assign(mesh.userData, data, {
    helpText: getControlHelp(data),
    labelTexture: texture,
    labelText: label,
    labelWidth: width,
    labelHeight: height,
  });
  return mesh;
}

function setModifierVisual(object: THREE.Object3D, armed: boolean): void {
  const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
  if (material?.color) material.color.setHex(armed ? ACCENT : 0xffffff);
}

function updateLabel(object: THREE.Mesh, label: string): void {
  if (object.userData.labelText === label) return;
  const material = object.material as THREE.MeshBasicMaterial;
  const old = material.map;
  material.map = createLabelTexture(
    label,
    object.userData.labelWidth as number,
    object.userData.labelHeight as number,
  );
  object.userData.labelText = label;
  object.userData.labelTexture = material.map;
  material.needsUpdate = true;
  old?.dispose();
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

function createSelection(): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(
    new THREE.PlaneGeometry(PANEL_WIDTH + 0.025, PANEL_HEIGHT + 0.025),
  );
  const material = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95 });
  const line = new THREE.LineSegments(geometry, material);
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
    gazeEnabled: false,
    xrMode: 'desktop',
    focusedTerminalId: null,
    rendererError,
    inputTargetId: null,
    inputTargetTitle: null,
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
  }> = [];
  const tempMatrix = new THREE.Matrix4();
  const dragStates = new Map<
    THREE.Group,
    { panel: TerminalPanel; localOffset: THREE.Vector3; relativeRotation: THREE.Quaternion }
  >();
  const availablePanes: PaneDescriptor[] = [];
  let quickCommands: QuickCommand[] = [];
  let menuCommands: QuickCommand[] = [];
  let commandPage = 0;
  let inputRoot: THREE.Group | null = null;
  let hudRoot: THREE.Group | null = null;
  let activeSession: XrSessionLike | null = null;
  let inputMode: 'commands' | 'keyboard' | 'panes' = 'commands';
  let panePage = 0;
  let armedModifiers: KeyModifiers = {};
  let hierarchyLevel: 'workspace' | 'session' | 'window' | 'pane' = 'workspace';
  let hierarchyWorkspaceId: string | null = null;
  let hierarchySessionId: string | null = null;
  let hierarchyWindowId: string | null = null;
  let gazeState: GazeState = { candidateId: null, emphasizedId: null, since: 0 };
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
  const hoverHelp = createLabelButton('', 1.05, 0.12, {});
  hoverHelp.name = 'xr-hover-help';
  hoverHelp.visible = false;
  hoverHelp.raycast = () => undefined;
  scene.add(hoverHelp);
  let hoveredControl: THREE.Object3D | null = null;
  const showHover = (object: THREE.Object3D | null): void => {
    const help = object?.userData.helpText as string | undefined;
    hoveredControl = help ? object : null;
    hoverHelp.visible = Boolean(help);
    canvas.title = help ?? '';
    if (help) updateLabel(hoverHelp, help);
  };
  const updateHoverPosition = (): void => {
    if (!hoveredControl) return;
    let owner: THREE.Object3D = hoveredControl;
    while (owner.parent) owner = owner.parent;
    if (owner !== scene) {
      showHover(null);
      return;
    }
    const view = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
    const eye = view.getWorldPosition(new THREE.Vector3());
    hoverHelp.position.copy(hoveredControl.getWorldPosition(new THREE.Vector3()));
    const towardEye = eye.sub(hoverHelp.position).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      view.getWorldQuaternion(new THREE.Quaternion()),
    );
    hoverHelp.position.addScaledVector(up, 0.14).addScaledVector(towardEye, 0.12);
    const projected = hoverHelp.position.clone().project(view);
    projected.x = THREE.MathUtils.clamp(projected.x, -0.6, 0.6);
    projected.y = THREE.MathUtils.clamp(projected.y, -0.7, 0.75);
    hoverHelp.position.copy(projected.unproject(view));
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
    if (!setPointerRay(event)) return;
    activateTarget(targetFromRay());
    showHover(null);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!setPointerRay(event)) return;
    showHover(targetFromRay()?.object ?? null);
    updateHoverPosition();
  };
  const onPointerLeave = (): void => showHover(null);
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
    for (const [controller, drag] of dragStates) {
      controller.updateMatrixWorld(true);
      const position = new THREE.Vector3()
        .setFromMatrixPosition(controller.matrixWorld)
        .add(
          drag.localOffset
            .clone()
            .applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())),
        );
      drag.panel.root.position.copy(position);
      drag.panel.root.quaternion
        .copy(controller.getWorldQuaternion(new THREE.Quaternion()))
        .multiply(drag.relativeRotation);
    }
    if (mutableState.gazeEnabled) {
      const gazeCamera = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
      const origin = new THREE.Vector3().setFromMatrixPosition(gazeCamera.matrixWorld);
      const direction = gazeCamera.getWorldDirection(new THREE.Vector3());
      raycaster.set(origin, direction);
      const hit = raycaster.intersectObjects(
        [...panels.values()].map((panel) => panel.root),
        true,
      )[0]?.object;
      let target: THREE.Object3D | null = hit ?? null;
      while (target && !target.userData.terminalId) target = target.parent;
      gazeState = updateGaze(
        gazeState,
        (target?.userData.terminalId as string | undefined) ?? null,
        time,
      );
      for (const panel of panels.values()) {
        const emphasized = panel.id === gazeState.emphasizedId;
        panel.selection.visible = emphasized || panel.id === mutableState.selectedTerminalId;
        (panel.selection.material as THREE.LineBasicMaterial).opacity = emphasized ? 1 : 0.72;
      }
    }
    if (renderer?.xr.isPresenting) {
      let hover: THREE.Object3D | null = null;
      for (const controller of controllerRoots) {
        if (!controller.visible) continue;
        controller.updateMatrixWorld(true);
        const target = targetFromController(controller);
        if (target?.object?.userData.helpText) {
          hover = target.object;
          break;
        }
      }
      showHover(hover);
    }
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
    scene.remove(inputRoot);
    disposeObject(inputRoot);
    inputRoot = null;
  };
  const clearInputCapture = (): void => {
    mutableState.inputTargetId = null;
    mutableState.inputTargetTitle = null;
    menuCommands = [];
    commandPage = 0;
    clearArmedModifiers();
  };
  const refreshInputRoot = (mode: 'commands' | 'keyboard' | 'panes'): void => {
    inputMode = mode;
    clearInputRoot();
    inputRoot = new THREE.Group();
    inputRoot.name = `xr-${mode}-controls`;
    inputRoot.position.set(0, 1.27, -0.82);
    inputRoot.scale.setScalar(0.72);
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
    inputRoot.add(modeCommands, modeKeyboard);
    const targetTitle = mutableState.inputTargetTitle
      ? `Target: ${mutableState.inputTargetTitle}`
      : 'No target selected';
    const title = createLabelButton(
      `${mode === 'commands' ? 'Quick commands' : mode === 'keyboard' ? 'Terminal keyboard' : `Panes · ${hierarchyLevel}`} · ${targetTitle}`,
      0.9,
      0.12,
      { inputAction: 'noop' },
    );
    title.position.y = 0.56;
    inputRoot.add(title);
    if (mode === 'panes') {
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
    } else {
      semanticKeyboardLayout.forEach((row, rowIndex) => {
        row.forEach((key, columnIndex) => {
          const width = key.label.length > 4 ? 0.27 : 0.17;
          const x = (columnIndex - (row.length - 1) / 2) * 0.19;
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
    close.position.set(0, -0.62, 0);
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
    black.position.set(-0.38, -0.55, 0);
    gradient.position.set(-0.08, -0.55, 0);
    observatory.position.set(0.3, -0.55, 0);
    inputRoot.add(close, black, gradient, observatory);
    scene.add(inputRoot);
  };
  const createHud = (): void => {
    hudRoot = new THREE.Group();
    hudRoot.name = 'xr-workspace-hud';
    hudRoot.position.set(0, 0.78, -1.35);
    hudRoot.scale.setScalar(0.62);
    const controls: Array<[string, Record<string, unknown>]> = [
      ['Commands', { inputAction: 'openInput', mode: 'commands' }],
      ['Keyboard', { inputAction: 'openInput', mode: 'keyboard' }],
      ['Panes', { inputAction: 'openInput', mode: 'panes' }],
      ['Exit', { inputAction: 'exit' }],
      ['Black', { inputAction: 'background', background: 'black' }],
      ['Gradient', { inputAction: 'background', background: 'gradient' }],
      ['Observatory', { inputAction: 'background', background: 'observatory' }],
    ];
    controls.forEach(([label, data], index) => {
      const button = createLabelButton(label, label === 'Observatory' ? 0.34 : 0.27, 0.09, data);
      button.position.x = (index - (controls.length - 1) / 2) * 0.31;
      hudRoot?.add(button);
    });
    scene.add(hudRoot);
  };
  const handleInputTarget = (hit: THREE.Object3D): boolean => {
    const action = hit.userData.inputAction as string | undefined;
    if (!action || action === 'noop') return false;
    if (action === 'close') {
      hideInput();
      return true;
    }
    if (action === 'mode') {
      refreshInputRoot(hit.userData.mode as 'commands' | 'keyboard');
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
      showInput(hit.userData.mode as 'commands' | 'keyboard' | 'panes');
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
    if (action === 'scale') {
      let parent: THREE.Object3D | null = hit;
      while (parent && !parent.userData.terminalId) parent = parent.parent;
      const panel = parent ? panels.get(parent.userData.terminalId as string) : undefined;
      if (panel) {
        const direction = hit.userData.direction as number;
        panel.root.scale.setScalar(
          Math.max(0.6, Math.min(1.8, panel.root.scale.x + direction * 0.1)),
        );
      }
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
    const targets = [...panels.values()].map((panel) => panel.root);
    if (inputRoot) targets.push(inputRoot);
    if (hudRoot) targets.push(hudRoot);
    const hits = raycaster.intersectObjects(targets, true);
    const hit = hits[0]?.object;
    if (!hit) return null;
    if (hit.userData.inputAction)
      return { terminalId: mutableState.focusedTerminalId ?? '', kind: 'keyboard', object: hit };
    let current: THREE.Object3D | null = hit;
    while (current && !current.userData.terminalId) current = current.parent;
    const terminalId = current?.userData.terminalId as string | undefined;
    if (!terminalId) return null;
    const key = hit.userData.key as string | undefined;
    return { terminalId, kind: key ? 'key' : 'terminal', object: hit };
  };
  const targetFromController = (root: THREE.Group): InputTarget | null => {
    tempMatrix.identity().extractRotation(root.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(root.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix).normalize();
    return targetFromRay();
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
      root.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -1),
          ]),
          new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.65 }),
        ),
      );
      const onSelect = (): void => onControllerSelect(root);
      const onSqueeze = (): void => {
        const target = targetFromController(root);
        const controller = root;
        if (!target) return;
        if (target.kind === 'keyboard' && target.object) {
          return;
        }
        selectTerminal(target.terminalId);
        if (target.kind === 'terminal' && target.object) {
          let parent: THREE.Object3D | null = target.object;
          while (parent && !parent.userData.terminalId) parent = parent.parent;
          const panel = parent ? panels.get(parent.userData.terminalId as string) : undefined;
          if (panel) {
            panel.root.updateMatrixWorld(true);
            const panelWorld = new THREE.Vector3().setFromMatrixPosition(panel.root.matrixWorld);
            const controllerWorld = new THREE.Vector3().setFromMatrixPosition(
              controller.matrixWorld,
            );
            const controllerRotation = controller.getWorldQuaternion(new THREE.Quaternion());
            dragStates.set(controller, {
              panel,
              localOffset: panelWorld
                .sub(controllerWorld)
                .applyQuaternion(controllerRotation.clone().invert()),
              relativeRotation: controllerRotation.clone().invert().multiply(panel.root.quaternion),
            });
          }
        }
      };
      const onSqueezeEnd = (): void => {
        dragStates.delete(root);
      };
      const eventRoot = root as unknown as EventRoot;
      eventRoot.addEventListener('selectstart', onSelect);
      eventRoot.addEventListener('squeezestart', onSqueeze);
      eventRoot.addEventListener('squeezeend', onSqueezeEnd);
      controllerRoots.push(root);
      controllerListeners.push({ root, onSelect, onSqueeze, onSqueezeEnd });
      scene.add(root);
    }
  };
  setupControllers();
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
    root.position.copy(defaultPosition);
    root.rotation.y = index % 2 === 0 ? 0.06 : -0.06;
    const texture = createCanvasTexture(surface);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    screen.name = 'terminal-surface';
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
    const scaleDown = createLabelButton('−', 0.1, 0.1, {
      inputAction: 'scale',
      direction: -1,
      terminalId: surface.pane.id,
    });
    const scaleUp = createLabelButton('+', 0.1, 0.1, {
      inputAction: 'scale',
      direction: 1,
      terminalId: surface.pane.id,
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
    scaleDown.position.set(-0.79, 0.38, 0.02);
    scaleUp.position.set(0.79, 0.38, 0.02);
    fontDown.position.set(-0.79, 0.22, 0.02);
    fontUp.position.set(0.79, 0.22, 0.02);
    root.userData.fontZoom = 1;
    const titleLabel = createLabelButton(`${surface.pane.title} · ${surface.status}`, 0.92, 0.08, {
      inputAction: 'noop',
    });
    titleLabel.position.set(0, 0.47, 0.02);
    root.add(selection, keyStrip, scaleDown, scaleUp, fontDown, fontUp, titleLabel);
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
    };
    panel.unsubscribe = surface.subscribe(() => {
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
    dragStates.forEach((drag, controller) => {
      if (drag.panel.id === id) dragStates.delete(controller);
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
  const setGazeEnabled = (enabled: boolean): void => {
    mutableState.gazeEnabled = enabled;
    if (!enabled) {
      gazeState = { candidateId: null, emphasizedId: null, since: 0 };
      for (const panel of panels.values()) {
        panel.selection.visible = panel.id === mutableState.selectedTerminalId;
      }
    }
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
  const showInput = (mode: 'commands' | 'keyboard' | 'panes'): void => {
    const targetId = mutableState.focusedTerminalId ?? mutableState.selectedTerminalId;
    mutableState.inputTargetId = targetId;
    mutableState.inputTargetTitle =
      availablePanes.find((pane) => pane.id === targetId)?.title ?? targetId;
    menuCommands = quickCommands.map((command) => ({ ...command }));
    commandPage = 0;
    clearArmedModifiers();
    if (mode === 'commands') actions.openCommands();
    else if (mode === 'keyboard') actions.openKeyboard();
    refreshInputRoot(mode);
  };
  const hideInput = (): void => {
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
      mutableState.xrMode = 'desktop';
      camera.position.copy(desktopCameraPosition);
      camera.quaternion.copy(desktopCameraQuaternion);
      observatory.visible = mutableState.background === 'observatory';
      scene.userData.backgroundVisible = true;
      setBackground(mutableState.background);
      notify();
    });
  };
  const resetLayout = (): void => {
    for (const panel of panels.values()) {
      panel.root.position.copy(panel.defaultPosition);
      panel.root.rotation.set(0, panel.defaultPosition.x < 0 ? 0.06 : -0.06, 0);
      panel.root.scale.setScalar(1);
    }
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
        if (!help) return;
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
    for (const { root, onSelect, onSqueeze, onSqueezeEnd } of controllerListeners) {
      const eventRoot = root as unknown as EventRoot;
      eventRoot.removeEventListener('selectstart', onSelect);
      eventRoot.removeEventListener('squeezestart', onSqueeze);
      eventRoot.removeEventListener('squeezeend', onSqueezeEnd);
      scene.remove(root);
      disposeObject(root);
    }
    controllerListeners.length = 0;
    controllerRoots.length = 0;
    clearInputRoot();
    if (hudRoot) {
      scene.remove(hudRoot);
      disposeObject(hudRoot);
      hudRoot = null;
    }
    hoveredControl = null;
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
    setGazeEnabled,
    setAvailablePanes,
    setQuickCommands,
    showInput,
    hideInput,
    enterXR,
    resetLayout,
    getControlHints,
    dispose,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type { BackgroundMode };
