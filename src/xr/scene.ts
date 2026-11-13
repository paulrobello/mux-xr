import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createClipboardBridge } from '../clipboard';
import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  PanelArrangement,
  QuickCommand,
  QuickCommandEntry,
  TerminalCellPosition,
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
} from '../keyboard';
import {
  copyCommand,
  isSharedCommand,
  orderQuickCommands,
  previewCommandText,
  quickStripCommands,
  splitTemplate,
} from '../quick-commands';
import type { DictationAction, DictationState } from '../speech-input';
import {
  DEFAULT_TERMINAL_FILTERING,
  type TerminalFiltering,
  type TerminalFilterMode,
  validateTerminalFiltering,
} from '../terminal/filtering';
import { paneHeading, processBadge } from '../terminal/lifecycle';
import { terminalKeyLabel } from '../terminal/protocol';
import {
  type AgentRosterLayout,
  type AgentRosterRow,
  type AgentRows,
  agentRowsSignature,
  DEFAULT_AGENT_ROSTER_LAYOUT,
} from '../workspace/agent-roster';
import {
  BUTTON_FUNCTION_LABELS,
  type ButtonFunction,
  CONTROLLER_BUTTON_LABELS,
  CONTROLLER_BUTTONS,
  type ControllerButton,
  DEFAULT_BUTTON_MAP,
  nextButtonFunction,
} from '../workspace/controller-buttons';
import {
  DEFAULT_HIERARCHY_STYLE,
  type HierarchyStyle,
  validateHierarchyStyle,
} from '../workspace/hierarchy-style';
import { validateKeyboardCurvature } from '../workspace/keyboard-curvature';
import { type KeyborbMode, keyborbEnabled, validateKeyborbMode } from '../workspace/keyborb';
import type { PaneCreationState } from '../workspace/pane-create';
import {
  DEFAULT_WINDOW_PREFERENCES,
  SCROLL_STRIP_SIDES,
  type ScrollStripSide,
  validateWindowPreferences,
  type WindowPreferences,
} from '../workspace/window-preferences';
import { calculateArrangement } from './arrangements';
import { installBatchedHandPoses } from './batched-hand-poses';
import { createBellFeedStore } from './bell-feed';
import type { CartoonHand } from './cartoon-hand';
import { clusteredRaycast } from './clustered-raycast';
import {
  type CommandDraft,
  commandFromDraft,
  createCommandDraft,
  draftFromCommand,
  editCommandDraft,
} from './command-editor';
import {
  keepLayoutAboveFloor,
  keepLayoutInsideRadius,
  workspaceFloorY,
  workspacePaneSafeRadius,
} from './floor-layout';
import { createFrameCounter } from './fps';
import { HAND_COLOR_PRESETS, validateHandColor } from './hand-colors';
import { createHandContact, type HandContact, type HandContactSample } from './hand-contact';
import { type HandInputState, updateHandInput } from './hand-input';
import { type HandReel, rebaseHandReel, reelOffset, startHandReel } from './hand-reel';
import {
  createHierarchyNavigator,
  type HierarchyNavigation,
  type HierarchyNavigator,
} from './hierarchy-navigator';
import { createHierarchyTouch, HIERARCHY_NEAR_ENTER, HIERARCHY_NEAR_EXIT } from './hierarchy-touch';
import { createRaisedButtonWalls, curveKeyboardContent } from './keyboard-surface';
import {
  createKeyborbGlyphs,
  createKeyborbKey,
  createKeyborbShells,
  type KeyborbGlyphs,
  type KeyborbShells,
  setKeyborbPressed,
} from './keyborb';
import { createKeyborbInput } from './keyborb-input';
import {
  createLabelBatcher,
  LABEL_BATCH_HIDDEN_LAYER,
  labelBatchTransparentSort,
} from './label-batches';
import {
  createScalableLabel,
  disposeScalableLabel,
  liveScalableLabels,
  updateScalableLabel,
} from './labels';
import { createPaneFocus } from './pane-focus';
import { measurePanelBounds } from './panel-bounds';
import { countsAsFrame } from './perf-gauge';
import type { PictureDepthView } from './picture-depth';
import { createPictureFrameWidget, PICTURE_KIND } from './picture-frame';
import type { PictureImage } from './picture-image';
import {
  freePictureSlot,
  PICTURE_PLACEHOLDER_OFFSET,
  PICTURE_PLACEHOLDER_SCALE,
  PICTURE_PLACEHOLDER_SLOT,
  pictureSpawnOffset,
} from './picture-sizing';
import { PICTURE_LIMITS } from './picture-store';
import { createRadialMenu, type RadialMenuAction } from './radial-menu';
import { ON_TOP_LAYER } from './render-layers';
import { createStandardHand } from './standard-hand';
import { terminalQualityAtDistance } from './terminal-lod';
import {
  createTerminalMaterial,
  setTerminalBackgroundOpacity,
  setTerminalMaterialFiltering,
} from './terminal-material';
import { createTerminalTexture, type TerminalTexture } from './terminal-texture';
import {
  createCurvedTerminalGeometry,
  createTerminalFrameAccentGeometry,
  createTerminalFrameGeometry,
  getTerminalWarpBounds,
  terminalWarpPoint,
} from './terminal-warp';
import { createTerminalWarpStore } from './terminal-warp-store';
import { applyUIEnvironment, createUIEnvironment, isSharedUIEnvironment } from './ui-environment';
import { createUIFeedback, type UICue, type UIFeedback } from './ui-feedback';
import {
  applyUIPose,
  captureUIPose,
  createUIPoseStore,
  NOMINAL_VIEWER_HEIGHT,
  type SavedUIPose,
  type UIPoseName,
  validPose,
} from './ui-poses';
import { updateVisibleMatrixWorld } from './visible-matrix-world';
import { intersectVisible } from './visible-raycast';
import { layoutWidgetPanel } from './widget-panel-layout';
import { createWidgetPoseStore, type WidgetPose } from './widget-poses';
import {
  getWidgetEntry,
  isWidgetKind,
  WIDGET_REGISTRY,
  type WidgetKey,
  type WidgetKind,
  widgetKey,
  widgetKeyKind,
  widgetSpawnYaw,
} from './widget-registry';
import type { Widget } from './widgets';
import { createWristMenuWatch, WRIST_WATCH_PROBE_REACH } from './wrist-menu-watch';

type InputKind = 'hand' | 'controller';
type InputMode =
  | 'commands'
  | 'keyboard'
  | 'panes'
  | 'terminal'
  | 'arrange'
  | 'command-editor'
  | 'widgets'
  | 'filtering'
  | 'warp'
  | 'settings'
  | 'display'
  | 'world'
  | 'buttons'
  | 'picture-url'
  | 'picture-gallery';

/** Modes that show the virtual keyboard and edit text with it. */
const isTypingMode = (mode: InputMode): boolean =>
  mode === 'keyboard' || mode === 'command-editor' || mode === 'picture-url';

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
  layoutRevision: number;
  radialOpen: boolean;
  warpTerminalId: string | null;
  selectedTerminalId: string | null;
  background: BackgroundMode;
  gazeInputEnabled: boolean;
  terminalColorMode: TerminalColorMode;
  filtering: TerminalFiltering;
  windowPreferences: WindowPreferences;
  hierarchyStyle: HierarchyStyle;
  /** Widget keys: the kind, or `<kind>:<id>` for multi-instance kinds such as pictures. */
  widgets: WidgetKey[];
  keyboardBackgroundEnabled: boolean;
  keyboardCurvature: number;
  keyborbMode: KeyborbMode;
  keyborbEnabled: boolean;
  uiSounds: boolean;
  /** `#rrggbb` hand and arm tint, or empty for the default color. */
  handColor: string;
  /** `#rrggbb` arm tint, or empty to match the hands. */
  armColor: string;
  dictation: DictationState;
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
  toast: string | null;
}

export interface NoticeOptions {
  /**
   * Also record the notice in the bell feed. Only for notices raised outside the user's current
   * action (connection and streamer errors, missing restored views, blocked XR entry); direct
   * feedback to a press and storage failures stay HUD-only.
   */
  feed?: boolean;
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
  setWindowPreferences(preferences: WindowPreferences): void;
  setHierarchyStyle(style: HierarchyStyle): void;
  setTerminalOpacity(id: string, value: number): void;
  getTerminalOpacity(id: string): number;
  /** Forget the pane's saved glass opacity and warp so it follows the new-window defaults again. */
  resetTerminalAppearance(id: string): void;
  captureTerminalPose(id: string): SavedUIPose | null;
  captureWorkspaceState(): void;
  restoreTerminalPose(id: string, pose: SavedUIPose): void;
  /** Toggle the radial; `controller` owns it, so a tracked hand gets hand-sized panels. */
  toggleRadialMenu(controller?: THREE.Group): void;
  setTerminalCurvature(id: string, degrees: number): void;
  getTerminalCurvature(id: string): number;
  setKeyboardBackgroundEnabled(enabled: boolean): void;
  setKeyboardCurvature(degrees: number): void;
  setKeyborbMode(mode: KeyborbMode): void;
  setUISounds(enabled: boolean): void;
  /** Tints both hands and their arms; null restores the default color. */
  setHandColor(color: string | null): void;
  /** Tints both arms; null makes them match the hands. */
  setArmColor(color: string | null): void;
  setDictationState(state: DictationState): void;
  setAvailablePanes(panes: PaneDescriptor[]): void;
  setPaneCreation(state: PaneCreationState): void;
  /** Close the mux tree selector, if open, so a newly opened pane is in view. */
  closePaneSelector(): void;
  /** Feed the agent roster; the panes menu shows it as an Agents group. */
  setAgentRoster(rows: readonly AgentRosterRow[], layout?: AgentRosterLayout): void;
  setQuickCommands(commands: QuickCommandEntry[]): void;
  /**
   * Shows a picked picture in frame `target` (a placeholder or a filled frame it replaces) when
   * that is still open, else in the newest open placeholder, else in a new frame. Returns the ids
   * of older frames removed to keep the frame cap (they lose their stored image).
   */
  addPicture(id: string, image: PictureImage, target?: string): string[];
  /** Shows stored pictures at their saved poses and drops saved poses with no picture. */
  restorePictures(pictures: ReadonlyArray<RestoredPicture>): void;
  removePicture(id: string): void;
  /** Gives an open frame its depth map; ignored when the frame is gone. */
  setPictureDepth(id: string, depth: PictureImage): void;
  showInput(mode: InputMode): void;
  hideInput(): void;
  enterXR(mode: 'vr' | 'ar'): Promise<void>;
  exitXR(): Promise<void>;
  setUpdateAvailable(available: boolean): void;
  setNotice(message: string | null, options?: NoticeOptions): void;
  /** Last physical-keyboard key shown in the HUD; null hides it. */
  setKeyIndicator(text: string | null): void;
  /** True while an in-scene text field is taking input. */
  isTextEntryActive(): boolean;
  /** Types a physical key into the open picture URL field; false when no field took it. */
  typeTextEntryKey(key: string): boolean;
  /** A picture controller notice: shown in the open picker panel during its pick, else the HUD. */
  notifyPicture(message: string): void;
  pasteClipboard(paneId?: string): Promise<boolean>;
  /** Types the host (Mac) clipboard into the selected terminal through the guarded paste path. */
  pasteHostClipboard(paneId?: string): Promise<boolean>;
  /** Copies the host clipboard into the Quest clipboard, keeping it for Paste if that write fails. */
  copyHostToQuest(): Promise<boolean>;
  /** Sends the Quest clipboard (or text copied in Mux XR) to the host clipboard. */
  copyQuestToHost(): Promise<boolean>;
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
const KEYBORB_DICTATION_COLUMN = 9;
const SCROLL_STRIP_WIDTH = 0.05;
const SCROLL_STRIP_OPACITY = 0.14;
const SCROLL_STRIP_ACTIVE_OPACITY = 0.38;
const ACCENT = 0x68d6ff;
const SELECTED_FRAME_GLOW = 0.45;
const CONTROLLER_RAY_LENGTH = 8;
// An XR press becomes a drag only once its hit moves past both limits, so hand and controller
// jitter during a press stays a click.
const DRAG_DEAD_ZONE = THREE.MathUtils.degToRad(1.5);
const DRAG_DEAD_CELLS = 2;
const CURSOR_RADIUS = 0.003;
// Half of a 0.5 degree cursor diameter.
const CURSOR_HALF_ANGLE = Math.tan(THREE.MathUtils.degToRad(0.25));
const CURSOR_PINCH_OPEN = 0.08;
const CURSOR_PINCH_CLOSED = 0.02;
const cursorColor = new THREE.Color();
const cursorRest = new THREE.Color(ACCENT);
const cursorPinched = new THREE.Color(0xffffff);
const QUALITY_RANK: Record<TerminalRenderQuality, number> = {
  hidden: 0,
  low: 1,
  medium: 2,
  full: 3,
};

type ScrollStripMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface XrSessionLike {
  addEventListener(type: string, listener: () => void): void;
  readonly frameRate?: number;
  readonly visibilityState?: string;
  end(): Promise<void>;
}

const POSE_EVENTS = [
  'selectstart',
  'selectend',
  'select',
  'squeezestart',
  'squeezeend',
  'squeeze',
] as const;

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
  frame: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  frameAccent: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  scrollStrips: Record<'right' | 'left', ScrollStripMesh>;
  unsubscribe: () => void;
  defaultPosition: THREE.Vector3;
  titleLabel: THREE.Mesh;
  bellLabel: THREE.Mesh;
  connectionButton: THREE.Mesh;
  closeButton: THREE.Mesh;
  bringButton: THREE.Mesh;
  width: number;
  height: number;
  revision: number;
  status: string;
  heldBadge: string;
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
  focusCurvature: number | null;
  opacity: number;
}

function disposeObject(object: THREE.Object3D): void {
  if (object.userData.disposeLabel) {
    disposeScalableLabel(object);
    return;
  }
  for (const child of [...object.children]) disposeObject(child);
  if (object instanceof THREE.InstancedMesh) object.dispose();
  (object.userData.disposeBatch as (() => void) | undefined)?.();
  const mesh = object as THREE.Mesh;
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
      if (!isSharedUIEnvironment(texture)) texture?.dispose();
    }
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
    background: typeof data.labelBackground === 'string' ? data.labelBackground : '#1c2a35',
    wrap: Boolean(data.wrap),
    border:
      typeof data.labelBorder === 'string'
        ? data.labelBorder
        : typeof data.key === 'string'
          ? '#7197a8'
          : undefined,
  });
  Object.assign(mesh.userData, data, { helpText: getControlHelp(data) });
  return mesh;
}

// Keyboard-panel units; the panel spawns at 0.38 scale, so this is about 11 mm raised, 6 mm travel.
const BUTTON_DEPTH = 0.03;
/**
 * Face buttons by gamepad index: 4 is A or X, 5 is B or Y. The left menu button (Touch Plus index 7
 * in the input-profiles registry) never reached the page on a Quest 3 on 2026-11-10, so it is unused.
 */
const FACE_BUTTONS: Record<'left' | 'right', Array<[number, ControllerButton]>> = {
  right: [
    [4, 'rightA'],
    [5, 'rightB'],
  ],
  left: [
    [4, 'leftX'],
    [5, 'leftY'],
  ],
};
/** Holding a Keyboard-mapped button this long brings the keyboard in front of the viewer. */
const KEYBOARD_SUMMON_HOLD_SECONDS = 0.5;
/** A summoned keyboard lands this fraction closer to the head than a normal spawn. */
const KEYBOARD_SUMMON_CLOSER = 0.2;
const BUTTON_TRAVEL = 0.016;
const BUTTON_PRESS_MS = 140;
const BUTTON_RELEASE_MS = 80;
const BUTTON_GAP = 0.002;
const BUTTON_WALL_COLOR = 0x3a5363;

function raisePanelButton(mesh: THREE.Mesh): void {
  const width = Number(mesh.userData.labelWidth);
  const height = Number(mesh.userData.labelHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  // Hand contact identifies keys the same way, so a press can find the button's rebuilt copy.
  const { x, y } = mesh.position;
  mesh.userData.pressKey = `${mesh.userData.inputAction}:${mesh.userData.commandId ?? ''}:${x.toFixed(4)}:${y.toFixed(4)}`;
  mesh.position.z += BUTTON_DEPTH;
  Object.assign(mesh.userData, {
    raisedButton: true,
    buttonDepth: BUTTON_DEPTH,
    buttonGap: BUTTON_GAP,
  });
}

type CommandTool = 'run' | 'pin' | 'edit' | 'remove';
const COMMAND_TOOLS: Array<[CommandTool, string]> = [
  ['run', 'Run'],
  ['pin', 'Pin'],
  ['edit', 'Edit'],
  ['remove', 'Remove'],
];
const COMMAND_TOOL_HINTS: Record<CommandTool, string> = {
  run: '',
  pin: 'Choose commands to pin or unpin',
  edit: 'Choose a command to edit',
  remove: 'Choose a command to remove',
};
const CONFIRM_WINDOW_MS = 3000;
// A controller double-click lands well inside this, so it cannot arm and confirm at once.
const CONFIRM_MIN_MS = 350;
// The armed preview shares one 1.1-wide label line, so it is shorter than the browser prompt.
const XR_PREVIEW_LENGTH = 60;
// Label text is always white, so the armed amber must stay dark enough to read.
const ARMED_STYLE = { armed: true, labelBackground: '#7a4a0c', labelBorder: '#f1b65e' };
const PINNED_BORDER = '#66d5e7';
const ARMED_TINT = 0xf1b65e;
type ConfirmAction = 'exit' | 'resetLayout';
const CONFIRM_LABELS: Record<ConfirmAction, [string, string]> = {
  exit: ['Exit', 'Exit?'],
  resetLayout: ['Reset layout', 'Reset?'],
};
// Surfaces that a select lands on without pressing a control; they get no click cue.
const PASSIVE_ACTIONS = new Set(['noop', 'grabInput', 'grabWidget', 'grabRadial', 'scrollStrip']);

function stackAboveControls(root: THREE.Group, rows: THREE.Mesh[][], gap = 0.03): void {
  let top = Number.NEGATIVE_INFINITY;
  root.updateMatrixWorld(true);
  for (const child of root.children) {
    const geometry = (child as THREE.Mesh).geometry;
    if (!geometry) continue;
    geometry.computeBoundingBox();
    if (geometry.boundingBox)
      top = Math.max(top, geometry.boundingBox.clone().applyMatrix4(child.matrix).max.y);
  }
  if (!Number.isFinite(top)) top = 0;
  for (const row of rows) {
    const height = Math.max(...row.map((mesh) => Number(mesh.userData.labelHeight) || 0.09));
    const y = top + gap + height / 2;
    const spacing = 0.04;
    const widths = row.map((mesh) => Number(mesh.userData.labelWidth) || 0.4);
    let x = -(widths.reduce((sum, width) => sum + width, 0) + spacing * (row.length - 1)) / 2;
    for (const [index, mesh] of row.entries()) {
      mesh.position.set(x + widths[index] / 2, y, 0);
      x += widths[index] + spacing;
      root.add(mesh);
    }
    top = y + height / 2;
  }
}

function setModifierVisual(object: THREE.Object3D, armed: boolean): void {
  object.userData.activeState = armed;
  const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
  if (material?.color) material.color.setHex(armed ? ACCENT : 0xffffff);
}

// Transient HUD lines (notice, dismiss, toast, Reload, FPS) sit above the HUD bar, where a widget can
// be nearer than them, so they draw without depth testing. Draw order then layers each label:
// its plate first, then its text.
const HUD_OVERLAY_RENDER_ORDER = 40;
function setHudOverlay(object: THREE.Object3D, order: number): void {
  object.userData.hudOverlay = true;
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    for (const value of Array.isArray(material) ? material : material ? [material] : []) {
      value.depthTest = false;
      value.depthWrite = false;
    }
    child.renderOrder = child === object ? order : order + 1;
  });
}

function updateLabel(object: THREE.Mesh, label: string): void {
  if (object.userData.labelText === label) return;
  const keyborbLabel = object.userData.keyborbLabel as THREE.Mesh | undefined;
  updateScalableLabel(
    keyborbLabel ?? object,
    keyborbLabel ? label.replace(' lock', '\nlock') : label,
  );
  object.userData.labelText = label;
}

const BACKGROUND_LABELS: Record<BackgroundMode, string> = {
  black: 'Black',
  gradient: 'Gradient',
  observatory: 'Observatory',
  hangar: 'Hangar deck',
  'deep-water': 'Deep-water station',
  studio: 'Minimal studio',
  desert: 'Desert night',
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
  const modes = Object.keys(BACKGROUND_LABELS) as BackgroundMode[];
  const rows = Math.ceil(modes.length / 2);
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, rows * 0.11),
    new THREE.MeshBasicMaterial({ color: 0x0d1720 }),
  );
  backing.position.set(0, 0.11 + (rows - 1) * 0.055, -0.005);
  backing.userData.inputAction = 'noop';
  options.add(backing);
  modes.forEach((background, index) => {
    const option = createLabelButton(BACKGROUND_LABELS[background], 0.48, 0.09, {
      inputAction: 'background',
      background,
    });
    option.position.set(
      index % 2 === 0 ? -0.25 : 0.25,
      0.11 + (rows - 1 - Math.floor(index / 2)) * 0.11,
      0,
    );
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

/** Shown panes: visible and not hidden by focus mode. LOD, hit-testing and the perf gauge agree. */
function isPanelShown(panel: TerminalPanel): boolean {
  return panel.root.visible && !panel.root.userData.focusHidden;
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

const COPY_TO_HOST = '\u0000copy-to-host';
/** pendingPaste target for the picture URL field, which belongs to no terminal. */
const PICTURE_URL_PASTE = '\u0000picture-url';
/** Physical editing keys the picture URL field takes besides printable characters. */
const PICTURE_URL_EDIT_KEYS = new Set([
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);
/** Recent gallery thumbnails per page: a 3 x 2 grid. */
const RECENT_PAGE_SIZE = 6;

/** The in-XR picture picker: URL entry and the Recent gallery, served by the picture controller. */
export interface ScenePicturePicker {
  addUrl(url: string, target?: string): Promise<boolean>;
  listRecent(): Promise<ReadonlyArray<RecentPictureEntry> | null>;
  placeRecent(id: string, target?: string): Promise<boolean>;
  /** Resolves false when storage refused the delete. */
  removeRecent(id: string): Promise<boolean>;
}

export interface RecentPictureEntry {
  id: string;
  name: string;
  thumbnail: PictureImage;
}

/** A stored picture to show again, with its depth map when the Mac made one. */
export interface RestoredPicture {
  id: string;
  image: PictureImage;
  depth?: PictureImage;
  depthView?: PictureDepthView;
}

/** An open "Add Picture" placeholder's pose key; it restores as a placeholder, not a picture. */
const isPlaceholderKey = (key: string): boolean => key.startsWith(`${PICTURE_KIND}:placeholder-`);

export function createWorkspaceScene(
  container: HTMLElement,
  actions: WorkspaceActions,
  options: {
    feedback?: UIFeedback;
    /** A picture frame was closed by the user; its stored image should go. */
    onPictureClosed?: (id: string) => void;
    /** In-XR picture picking; without it the frame's Enter URL and Recent actions do nothing. */
    pictures?: ScenePicturePicker;
    /** The user changed a picture frame's 3D options. */
    onPictureDepthView?: (id: string, view: PictureDepthView) => void;
  } = {},
): WorkspaceScene {
  const feedback = options.feedback ?? createUIFeedback();
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
    installBatchedHandPoses();
    renderer.setTransparentSort(labelBatchTransparentSort);
  } catch (error) {
    rendererError = error instanceof Error ? error.message : 'WebGL renderer initialization failed';
  }
  const uiEnvironment = createUIEnvironment(renderer);
  const labelBatcher = createLabelBatcher(scene, liveScalableLabels);
  const ambient = new THREE.AmbientLight(0x9db5c8, 0.7);
  const key = new THREE.DirectionalLight(0xb8dfff, 1.2);
  key.position.set(-2, 4, 4);
  // Both render passes share the scene's lights, so lit shaders keep one program between them.
  ambient.layers.enable(ON_TOP_LAYER);
  key.layers.enable(ON_TOP_LAYER);
  scene.add(ambient, key);
  const observatory = createObservatory(scene);
  const panels = new Map<string, TerminalPanel>();
  const widgets = new Map<WidgetKey, Widget>();
  const touchedWidgets = new Set<WidgetKey>();
  const clipboard = createClipboardBridge();
  // A pending native select either pastes into a pane id or, with COPY_TO_HOST, sends to the host.
  const pendingPaste = new Map<THREE.Group, string | null>();
  let clipboardGeneration = 0;
  let hostPasteInFlight = false;
  let floorCorrectionPending = false;
  let toastDeadline = 0;
  const radialMenu = createRadialMenu();
  radialMenu.root.scale.setScalar(0.8);
  radialMenu.root.traverse((object) => {
    object.userData.helpText = getControlHelp(object.userData);
  });
  scene.add(radialMenu.root);
  const terminalPoseCache = new Map<string, SavedUIPose>();
  const terminalRestoredPoses = new Map<string, SavedUIPose>();
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
  // Three keeps the XR camera at the origin (or the last session's pose) until a frame reports a
  // viewer pose, so placement, floor correction and HUD/keyboard saves wait for one.
  let xrViewerPending = false;
  // Saved poses are world transforms; placement is viewer-relative. Outside a tracked XR session
  // placement uses this fixed viewer (a nominal head, then the last tracked head) so desktop
  // camera framing never moves it.
  const layoutViewer = new THREE.PerspectiveCamera();
  layoutViewer.position.set(0, NOMINAL_VIEWER_HEIGHT, 0);
  const resetLayoutViewer = (): void => {
    layoutViewer.position.set(0, NOMINAL_VIEWER_HEIGHT, 0);
    layoutViewer.quaternion.identity();
  };
  // Three moves its XR camera from the left eye to a centre-and-back union pose during render, so
  // saved poses use the frame's viewer transform instead whenever the frame provides one.
  const xrHead = new THREE.PerspectiveCamera();
  let xrHeadFromFrame = false;
  const inXRContext = (): boolean =>
    !!renderer &&
    (renderer.xr.isPresenting || !!activeSession || mutableState.xrMode !== 'desktop');
  const poseViewer = (): THREE.Camera => {
    if (renderer && !xrViewerPending && inXRContext()) {
      if (xrHeadFromFrame) return xrHead;
      return renderer.xr.getCamera();
    }
    layoutViewer.updateMatrixWorld(true);
    return layoutViewer;
  };
  let keyboardPoseRestored = true;
  let filterVersion = 0;
  const paneFocus = createPaneFocus();
  const listeners = new Set<(state: Readonly<WorkspaceSceneState>) => void>();
  const mutableState: WorkspaceSceneState = {
    layoutRevision: 0,
    radialOpen: false,
    warpTerminalId: null,
    selectedTerminalId: null,
    background: 'observatory',
    gazeInputEnabled: false,
    terminalColorMode: 'comfort',
    filtering: { ...DEFAULT_TERMINAL_FILTERING },
    windowPreferences: { ...DEFAULT_WINDOW_PREFERENCES },
    hierarchyStyle: DEFAULT_HIERARCHY_STYLE,
    widgets: [],
    keyboardBackgroundEnabled: true,
    keyboardCurvature: 0,
    keyborbMode: 'auto',
    keyborbEnabled: false,
    uiSounds: true,
    handColor: '',
    armColor: '',
    dictation: { supported: false, status: 'idle', transcript: '', error: null },
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
    toast: null,
  };
  let disposed = false;
  let frameHandle = 0;
  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(ON_TOP_LAYER);
  const fidelityRay = new THREE.Raycaster();
  fidelityRay.layers.enable(ON_TOP_LAYER);
  const fidelityHits: THREE.Intersection[] = [];
  const terminalScreens: THREE.Mesh[] = [];
  const fidelityEye = new THREE.Vector3();
  const fidelityDirection = new THREE.Vector3();
  const fidelityPosition = new THREE.Vector3();
  const fidelityScale = new THREE.Vector3();
  const controllerRoots: THREE.Group[] = [];
  const handRoots = new Map<THREE.Group, THREE.Group>();
  const handVisuals = new Map<THREE.Group, CartoonHand>();
  const handContacts = new Map<THREE.Group, HandContact>();
  const keyboardProximity = new Map<THREE.Group, HandContact>();
  const keyborbInput = createKeyborbInput();
  const hierarchyTouch = createHierarchyTouch();
  const keyborbFlashes = new Map<number, number>();
  let keyborbHighlighted = false;
  const priorityHandActions = new Set(['wristMenu', 'exit', 'reloadUpdate', 'dismissNotice']);
  const contactSamples = new Map<THREE.Group, HandContactSample>();
  const contactGripArmed = new Set<THREE.Group>();
  const pokeSources = new Set<THREE.Group>();
  const pendingPokes = new Map<
    THREE.Group,
    { object: THREE.Mesh; target: string | null; mode: InputMode }
  >();
  const controllerGrips = new Map<THREE.Group, THREE.Group>();
  /** Pointer rays and their contact dots, drawn over menus with the hands. */
  const pointerParts: THREE.Object3D[] = [];
  const wristMenuButton = createLabelButton('Menu', 0.052, 0.035, { inputAction: 'wristMenu' });
  const wristWatch = createWristMenuWatch(wristMenuButton, uiEnvironment.texture);
  let wristMenuLastPressed = Number.NEGATIVE_INFINITY;
  scene.add(wristWatch.root);
  const watchProbeCenter = new THREE.Vector3();
  const handInputStates = new Map<THREE.Group, HandInputState>();
  const handTrackingLost = new Set<THREE.Group>();
  const handGrabActions = new Map<
    THREE.Group,
    { grab(object?: THREE.Group): void; release(): void }
  >();
  const activeHand = (root: THREE.Group): THREE.Group | undefined =>
    root.userData.inputSourceHand ? handRoots.get(root) : undefined;
  const controllerListeners: Array<{
    root: THREE.Group;
    onSelect: (event: Event) => void;
    onSelectEnd: (event: Event) => void;
    onSelectComplete: (event: Event) => void;
    onSqueeze: (event: Event) => void;
    onSqueezeEnd: (event: Event) => void;
    onConnected: (event: Event) => void;
    onDisconnected: (event: Event) => void;
    onPoseEvent: () => void;
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
      reel?: HandReel;
      far: boolean;
      shoulder: THREE.Vector3;
      facingPitch?: number;
      headingYaw?: number;
      yawRecovering?: boolean;
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
      grips: [THREE.Quaternion, THREE.Quaternion];
    }
  >();
  // Turning both grips the same way about the line between them rolls the object. Hands get a wider
  // dead zone because forearms pitching together during a carry twist both wrists slightly.
  const PAIR_ROLL_DEAD_ZONE = THREE.MathUtils.degToRad(8);
  const HAND_PAIR_ROLL_DEAD_ZONE = THREE.MathUtils.degToRad(15);
  const pairTwist = (
    start: THREE.Quaternion,
    now: THREE.Quaternion,
    swing: THREE.Quaternion,
    axis: THREE.Vector3,
  ): number => {
    const change = swing.clone().invert().multiply(now).multiply(start.clone().invert());
    if (change.w < 0) change.set(-change.x, -change.y, -change.z, -change.w);
    const along = change.x * axis.x + change.y * axis.y + change.z * axis.z;
    return 2 * Math.atan2(along, change.w);
  };
  let recenterSince: number | null = null;
  let recenterLatched = false;
  // Looking straight up or down, the facing side is the head's -up or +up respectively.
  const viewYaw = (view: THREE.Object3D): number => {
    const rotation = view.getWorldQuaternion(new THREE.Quaternion());
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
    const forward = look.clone().setY(0);
    if (forward.lengthSq() < 1e-6)
      forward
        .set(0, look.y > 0 ? -1 : 1, 0)
        .applyQuaternion(rotation)
        .setY(0);
    return Math.atan2(-forward.x, -forward.z);
  };
  const manipulationSpace = (controller: THREE.Group): THREE.Object3D => {
    const hand = activeHand(controller);
    const joints = hand
      ? (hand as THREE.Group & { joints?: Record<string, THREE.Object3D> }).joints
      : undefined;
    return joints?.wrist ?? controller;
  };
  // The tracked head: the frame's viewer pose when one arrived, else the XR camera rig.
  const trackedHead = (): THREE.Camera =>
    renderer?.xr.isPresenting ? (xrHeadFromFrame ? xrHead : renderer.xr.getCamera()) : camera;
  const headPosition = (): THREE.Vector3 => {
    const view = trackedHead();
    view.updateWorldMatrix(true, false);
    return view.getWorldPosition(new THREE.Vector3());
  };
  // Reach is the wrist's level distance from an estimated shoulder that follows the head's position
  // with the head's grab-time heading, so walking carries the object and arm sweeps around the
  // shoulder leave its depth alone.
  const SHOULDER_SIDE = 0.18;
  const SHOULDER_REANCHOR = THREE.MathUtils.degToRad(15);
  const shoulderOffset = (controller: THREE.Group): THREE.Vector3 => {
    const view = trackedHead();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
      view.getWorldQuaternion(new THREE.Quaternion()),
    );
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const side = controllerHandedness.get(controller) === 'left' ? -1 : 1;
    return right.normalize().multiplyScalar(side * SHOULDER_SIDE);
  };
  const handReach = (space: THREE.Object3D, shoulder: THREE.Vector3): number => {
    const offset = space.getWorldPosition(new THREE.Vector3()).sub(headPosition()).sub(shoulder);
    return Math.hypot(offset.x, offset.z);
  };
  // A far-held pane rides the ray's heading and pitch only: rolling the forearm would otherwise
  // swing it around the wrist and tilt the text. Near vertical the heading is undefined, so the
  // last good one holds.
  const ROLL_FREE_VERTICAL = 0.97;
  const rayFrame = (
    controller: THREE.Group,
    lastYaw?: number,
  ): { quaternion: THREE.Quaternion; yaw: number; pitch: number; held: boolean } => {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      controller.getWorldQuaternion(new THREE.Quaternion()),
    );
    const held = Math.abs(forward.y) > ROLL_FREE_VERTICAL;
    const yaw = held ? (lastYaw ?? viewYaw(trackedHead())) : Math.atan2(-forward.x, -forward.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    return {
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')),
      yaw,
      pitch,
      held,
    };
  };
  // `far` marks a ray grab; contact grabs and re-captures of a contact grab never reel.
  const captureGrab = (controller: THREE.Group, object: THREE.Group, far?: boolean): void => {
    const previous = dragStates.get(controller);
    const reach = far ?? (previous?.object === object && previous.far);
    const widgetKeyed = object.userData.widgetKey as WidgetKey | undefined;
    if (widgetKeyed) touchedWidgets.add(widgetKeyed);
    if (object.userData.widgetKind === PICTURE_KIND) {
      // A grabbed picture is user-placed: recenter leaves it, and its slot frees for new frames.
      object.userData.picturePlaced = true;
      delete object.userData.widgetSlot;
    }
    if (object === inputRoot) inputPoseSpawn = null;
    const space = manipulationSpace(controller);
    space.updateMatrixWorld(true);
    object.updateMatrixWorld(true);
    const rotation = space.getWorldQuaternion(new THREE.Quaternion());
    const handReel = reach && activeHand(controller);
    const facing = Boolean(handReel && object.userData.terminalId);
    const ray = facing
      ? rayFrame(controller, previous?.object === object ? previous.headingYaw : undefined)
      : undefined;
    const objectQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
    const localOffset = object
      .getWorldPosition(new THREE.Vector3())
      .sub(space.getWorldPosition(new THREE.Vector3()))
      .applyQuaternion((ray ? ray.quaternion.clone() : rotation.clone()).invert());
    const shoulder = shoulderOffset(controller);
    const reachNow = handReel ? handReach(space, shoulder) : 0;
    dragStates.set(controller, {
      object,
      localOffset,
      far: reach,
      shoulder,
      // A re-capture keeps reeling even after the object was reeled within the far-grab threshold.
      reel: !handReel
        ? undefined
        : previous?.object === object && previous.reel
          ? rebaseHandReel(reachNow, localOffset.length())
          : startHandReel(reachNow, localOffset.length()),
      relativeRotation: rotation.clone().invert().multiply(objectQuaternion),
      gamepad: controllerGamepads.get(controller),
      facingPitch: facing
        ? new THREE.Euler().setFromQuaternion(objectQuaternion, 'YXZ').x
        : undefined,
      headingYaw: ray?.yaw,
    });
  };
  const releaseGrab = (controller: THREE.Group): void => {
    const object = dragStates.get(controller)?.object;
    dragStates.delete(controller);
    if (!object) return;
    if (object.userData.terminalId) floorCorrectionPending = true;
    const pair = pairGrabs.get(object);
    if (!pair) return;
    pairGrabs.delete(object);
    for (const remaining of pair.controllers)
      if (remaining !== controller && dragStates.has(remaining)) captureGrab(remaining, object);
  };
  const beginPairGrab = (object: THREE.Group, first: THREE.Group, second: THREE.Group): void => {
    const firstSpace = manipulationSpace(first);
    const secondSpace = manipulationSpace(second);
    firstSpace.updateMatrixWorld(true);
    secondSpace.updateMatrixWorld(true);
    const a = firstSpace.getWorldPosition(new THREE.Vector3());
    const b = secondSpace.getWorldPosition(new THREE.Vector3());
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
      grips: [
        firstSpace.getWorldQuaternion(new THREE.Quaternion()),
        secondSpace.getWorldQuaternion(new THREE.Quaternion()),
      ],
    });
  };
  const availablePanes: PaneDescriptor[] = [];
  const controllerGamepads = new Map<THREE.Group, Gamepad>();
  const controllerHandedness = new Map<THREE.Group, string>();
  let cueCount = 0;
  const cue = (kind: UICue, source?: THREE.Group | number | null): void => {
    cueCount++;
    if (!mutableState.uiSounds) return;
    feedback.play(
      kind,
      typeof source === 'object' && source ? controllerGamepads.get(source) : null,
    );
  };
  // The source of the press being handled, so arming, Reset and paste errors pulse it too.
  let lastSelectSource: THREE.Group | null = null;
  // A press whose action played its own cue (armed, recenter) skips the click.
  const pressCue = (controller: THREE.Group, action: unknown, cues: number): void => {
    if (cueCount !== cues || (action === 'bringHere' && gripActive())) return;
    cue('select', controller);
  };
  // Raised panel buttons sink for a moment on a ray, trigger or fingertip press.
  const pressedButtons = new Map<THREE.Object3D, { until: number; offset: number }>();
  // Keyed by pressKey, so a press outlives the panel rebuild its own action triggers.
  const pressUntil = new Map<string, number>();
  const sinkPanelButton = (object: THREE.Object3D, until: number): void => {
    object.translateZ((pressedButtons.get(object)?.offset ?? 0) - BUTTON_TRAVEL);
    pressedButtons.set(object, { until, offset: BUTTON_TRAVEL });
  };
  const pressPanelButton = (object: THREE.Object3D | undefined): void => {
    const key = object?.userData.pressKey as string | undefined;
    if (!object || !key) return;
    const until = (previousRenderTime ?? performance.now()) + BUTTON_PRESS_MS;
    pressUntil.set(key, until);
    const current = inputRoot?.children.includes(object)
      ? object
      : inputRoot?.children.find((child) => child.userData.pressKey === key);
    if (current) sinkPanelButton(current, until);
  };
  const restorePanelPresses = (root: THREE.Group): void => {
    const now = previousRenderTime ?? performance.now();
    for (const child of root.children) {
      const until = pressUntil.get(child.userData.pressKey as string);
      if (until !== undefined && until > now) sinkPanelButton(child, until);
    }
  };
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
  // Where an XR press first hit, for the drag dead zone.
  interface DragPress {
    point: THREE.Vector3;
    cell: TerminalCellPosition;
  }
  const mousePresses = new Map<THREE.Group, DragPress>();
  let textSelection: {
    source: THREE.Group;
    id: string;
    surface: TerminalSurface;
    last: TerminalCellPosition;
    press: DragPress;
    dragged: boolean;
    phase: 'dragging' | 'copying' | 'retained';
  } | null = null;
  let previousRenderTime: number | null = null;
  let lodWasPresenting = false;
  const frameCounter = createFrameCounter();
  let perfWorstFrameMs = 0;
  let perfWasHidden = false;
  /** XR session start and end: drop the running worst frame and every gauge's history. */
  const resetPerfStats = (): void => {
    perfWorstFrameMs = 0;
    perfWasHidden = true;
    for (const widget of widgets.values()) widget.resetPerf?.();
  };
  let fpsLabel: THREE.Mesh | null = null;
  let keyLabel: THREE.Mesh | null = null;
  let activePaneLabel: THREE.Mesh | null = null;
  let radialTargetId: string | null = null;
  let warpPanelEdit: { id: string; original: number; touched: boolean } | null = null;
  let radialController: THREE.Group | null = null;
  let warpEdit: {
    id: string;
    original: number;
    touched: boolean;
    controller: THREE.Group | null;
  } | null = null;
  let warpReadout: THREE.Mesh | null = null;
  let gridDraft: { target: string; cols: number; rows: number } | null = null;
  let gridRequestStatus = '';
  let gazeRetargeting = false;
  let quickCommands: QuickCommandEntry[] = [];
  let menuCommands: QuickCommandEntry[] = [];
  let commandDraft: CommandDraft | null = null;
  let commandWorkspaceId: string | undefined;
  let commandEditorMessage = '';
  // In-XR picture picking: the URL being typed, the frame it fills, and the Recent gallery.
  let pictureUrl = { text: '', cursor: 0 };
  let pictureTarget: string | undefined;
  let picturePanelMessage = '';
  let pictureBusy = false;
  /** Bumped whenever a picker panel opens, so a finished pick never closes a newer panel. */
  let pictureSession = 0;
  /** A controller notice raised during the running pick, shown once: in the panel or on the HUD. */
  let pictureNotice: string | null = null;
  let recentPictures: ReadonlyArray<RecentPictureEntry> | null | 'loading' = 'loading';
  let recentPage = 0;
  let widgetsPage = 0;
  let recentGeneration = 0;
  let commandPage = 0;
  let templateHint: string | null = null;
  let commandTool: CommandTool = 'run';
  let commandsMessage = '';
  let stripCommands: QuickCommandEntry[] = [];
  const snapshotMenuCommands = (): void => {
    menuCommands = orderQuickCommands(quickCommands).map((command) => ({ ...command }));
    stripCommands = quickStripCommands(quickCommands).map((command) => ({ ...command }));
  };
  let armedCommand: { id: string; action: string; kind: 'run' | 'remove'; at: number } | null =
    null;
  let armedTimer: ReturnType<typeof setTimeout> | undefined;
  let armedControl: { action: ConfirmAction; at: number } | null = null;
  let armedControlTimer: ReturnType<typeof setTimeout> | undefined;
  let inputRoot: THREE.Group | null = null;
  let hierarchyNavigator: HierarchyNavigator | null = null;
  let hierarchyNavigation: HierarchyNavigation = { path: [], page: 0 };
  let paneCreation: PaneCreationState = { available: true, pending: false };
  const AGENT_ROSTER_COALESCE_MS = 400;
  let agentRoster: AgentRosterRow[] = [];
  // Unlike agentRoster, refreshed on every feed: the board shows ages the signature omits.
  let latestAgentRoster: readonly AgentRosterRow[] = [];
  // Scene-owned so bells and notices raised while the feed widget is closed show when it opens.
  const bellFeed = createBellFeedStore();
  // Reused every frame: widgets whose meshes a controller ray hit.
  const pointedWidgets = new Set<Widget>();
  bellFeed.subscribe(() => {
    for (const widget of widgets.values()) widget.setBellFeed?.(bellFeed.entries());
  });
  let agentRosterSignature = '';
  let agentRosterRows: AgentRows = DEFAULT_AGENT_ROSTER_LAYOUT.rows;
  let hierarchyOpened = false;
  let dictationCursor = 0;
  const dictationCaption = (): string => {
    const draft = mutableState.dictation;
    if (draft.error) return draft.error;
    if (draft.status === 'transcribing') return 'Transcribing…';
    if (draft.status === 'review') {
      const characters = Array.from(draft.transcript, (character) =>
        character === '\n' || character === '\r' ? ' ' : character,
      );
      characters.splice(dictationCursor, 0, '|');
      const start = Math.max(0, Math.min(dictationCursor - 54, characters.length - 108));
      const visible = characters.slice(start, start + 108);
      if (start > 0) visible[0] = '…';
      if (start + 108 < characters.length) visible[visible.length - 1] = '…';
      return [0, 36, 72]
        .map((offset) => visible.slice(offset, offset + 36).join(''))
        .filter(Boolean)
        .join('\n');
    }
    return draft.transcript || 'Listening…';
  };
  const hierarchyHiddenPanels = new Map<THREE.Object3D, boolean>();
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
  let toastLabel: THREE.Mesh | null = null;
  let xrStartPromise: Promise<void> | null = null;
  let activeSession: XrSessionLike | null = null;
  let inputMode: InputMode = 'commands';
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
  const radialButtonDown = new Set<THREE.Group>();
  const keyboardHolds = new Map<
    string,
    { controller: THREE.Group; index: number; seconds: number; summoned: boolean }
  >();
  const scrollDue = new Map<THREE.Group, number>();
  // A pinch on a pane's edge strip scrolls it by the ray's movement along the pane's own up axis,
  // in a plane fixed at pinch start so the ray may leave the strip mid-drag.
  const stripScrolls = new Map<
    THREE.Group,
    {
      id: string;
      strip: ScrollStripMesh;
      plane: THREE.Plane;
      up: THREE.Vector3;
      anchor: number;
      started: boolean;
    }
  >();
  let keyboardResume: {
    mode: 'keyboard' | 'command-editor';
    target: string | null;
    locked: Readonly<KeyModifiers>;
  } | null = null;
  let gazeInputState: GazeState = { candidateId: null, emphasizedId: null, since: 0 };
  let lastRayDistance = CONTROLLER_RAY_LENGTH;
  const hoveredByController = new Map<THREE.Group, THREE.Object3D>();
  let inputTransform: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: number;
  } | null = null;
  // The system spawn the input pose came from; null once the user placed it or a saved pose won.
  // A spawn made while no input was tracked has no kind and adopts the first one without moving.
  let inputPoseSpawn: { kind: InputKind | null; typing: boolean } | null = null;
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
  const cancelModifierPress = (source: THREE.Group | number, refresh = true): void => {
    const press = modifierPresses.get(source);
    modifierPresses.delete(source);
    if (!press?.before) return;
    modifierState.restore(press.modifier, press.before.active, press.before.locked);
    syncModifierVisuals();
    if (refresh && inputRoot && isTypingMode(inputMode)) refreshInputRoot(inputMode);
  };
  const resetHandContact = (
    source: THREE.Group,
    refresh = true,
    preserveNear = false,
    keepHeldKeyborb = false,
  ): void => {
    // A held Keyborb key outlives a brief tracking gap; Keyborb input lets go after its grace.
    if (!keepHeldKeyborb || !keyborbInput.holding(source)) keyborbInput.reset(source);
    keyboardProximity.get(source)?.reset();
    handContacts.get(source)?.reset(preserveNear);
    contactSamples.delete(source);
    pendingPokes.delete(source);
    if (pokeSources.delete(source)) cancelModifierPress(source, refresh);
    if (!preserveNear) {
      source.userData.nearKeyboard = false;
      contactGripArmed.delete(source);
    }
  };
  const resetHandContacts = (refresh = false): void => {
    for (const source of handContacts.keys()) resetHandContact(source, refresh);
    keyborbInput.reset();
    if (keyborbFlashes.size && inputRoot) {
      for (const child of inputRoot.children) {
        const slot = child.userData.keyborbSlot as number | undefined;
        if (slot !== undefined && keyborbFlashes.has(slot))
          setKeyborbPressed(child as THREE.Mesh, 0);
      }
    }
    keyborbFlashes.clear();
  };
  const rayHitPoint = (source: THREE.Group): THREE.Vector3 => {
    const origin = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1)
      .applyMatrix4(new THREE.Matrix4().extractRotation(source.matrixWorld))
      .normalize();
    return origin.addScaledVector(direction, Number(source.userData.rayDistance) || 0);
  };
  const pastDragDeadZone = (
    source: THREE.Group,
    press: DragPress,
    cell: TerminalCellPosition,
  ): boolean => {
    const cells = Math.max(
      Math.abs(cell.col - press.cell.col),
      Math.abs(cell.row - press.cell.row),
    );
    if (cells < DRAG_DEAD_CELLS) return false;
    const origin = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
    const before = press.point.clone().sub(origin);
    const now = rayHitPoint(source).sub(origin);
    return before.lengthSq() > 0 && now.lengthSq() > 0 && before.angleTo(now) >= DRAG_DEAD_ZONE;
  };
  const releaseMouse = (source: THREE.Group | number): void => {
    const capture = mouseCaptures.get(source);
    if (typeof source === 'object') mousePresses.delete(source);
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
    cancelTextSelection(undefined, true);
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
  const cancelTextSelection = (id?: string, draggingOnly = false): void => {
    const selection = textSelection;
    if (
      !selection ||
      (id !== undefined && selection.id !== id) ||
      (draggingOnly && selection.phase !== 'dragging')
    )
      return;
    textSelection = null;
    selection.surface.clearSelection?.();
  };
  const startTextSelection = (source: THREE.Group, target: InputTarget | null): void => {
    if (
      !renderer?.xr.isPresenting ||
      gripActive() ||
      warpEdit ||
      radialMenu.root.visible ||
      !target?.uv
    )
      return;
    const panel = panels.get(target.terminalId);
    if (
      !panel ||
      target.object !== panel.screen ||
      (panel.surface.mouseTracking ?? 'none') !== 'none'
    )
      return;
    cancelTextSelection();
    const cell = cellAtUV(panel, target.uv);
    if (!panel.surface.beginSelection?.(cell)) return;
    textSelection = {
      source,
      id: panel.id,
      surface: panel.surface,
      last: cell,
      press: { point: rayHitPoint(source), cell },
      dragged: false,
      phase: 'dragging',
    };
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
  };
  const moveTextSelection = (source: THREE.Group, target: InputTarget | null): void => {
    const selection = textSelection;
    if (!selection || selection.source !== source || selection.phase !== 'dragging') return;
    const panel = panels.get(selection.id);
    if (gripActive() || !panel || (panel.surface.mouseTracking ?? 'none') !== 'none') {
      cancelTextSelection();
      return;
    }
    if (target?.object !== panel.screen || !target.uv) return;
    const cell = cellAtUV(panel, target.uv);
    if (cell.col === selection.last.col && cell.row === selection.last.row) return;
    if (!selection.dragged && !pastDragDeadZone(source, selection.press, cell)) return;
    selection.last = cell;
    selection.dragged = true;
    panel.surface.updateSelection?.(cell);
  };
  const stripRayHeight = (
    source: THREE.Group,
    drag: { plane: THREE.Plane; up: THREE.Vector3 },
  ): number | null => {
    source.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1)
      .applyMatrix4(new THREE.Matrix4().extractRotation(source.matrixWorld))
      .normalize();
    if (Math.abs(direction.dot(drag.plane.normal)) < 0.08) return null;
    const point = new THREE.Ray(origin, direction).intersectPlane(drag.plane, new THREE.Vector3());
    return point ? point.dot(drag.up) : null;
  };
  const startStripScroll = (source: THREE.Group, target: InputTarget): void => {
    const panel = panels.get(target.terminalId);
    const strip = Object.values(panel?.scrollStrips ?? {}).find(
      (candidate) => candidate === target.object,
    );
    if (!panel || !strip) return;
    panel.root.updateMatrixWorld(true);
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(panel.root.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const normal = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(strip.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      strip.getWorldPosition(new THREE.Vector3()),
    );
    const drag = { id: panel.id, strip, plane, up, anchor: 0, started: false };
    const height = stripRayHeight(source, drag);
    if (height === null) return;
    drag.anchor = height;
    if (textSelection?.source === source) cancelTextSelection();
    selectTerminal(panel.id);
    stripScrolls.set(source, drag);
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
  };
  const updateStripScrolls = (): void => {
    for (const [source, drag] of stripScrolls) {
      const panel = panels.get(drag.id);
      if (
        !panel ||
        !source.visible ||
        disconnectedControllers.has(source) ||
        handTrackingLost.has(source) ||
        controllerRayBlocked(source) ||
        !isControlVisible(drag.strip) ||
        gripActive() ||
        warpEdit ||
        radialMenu.root.visible
      ) {
        stripScrolls.delete(source);
        continue;
      }
      const height = stripRayHeight(source, drag);
      if (height === null) continue;
      const line =
        (panel.height / Math.max(1, panel.surface.rows)) *
        panel.root.getWorldScale(new THREE.Vector3()).y;
      if (!drag.started) {
        if (Math.abs(height - drag.anchor) < line / 2) continue;
        drag.started = true;
        drag.anchor = height;
        continue;
      }
      const lines = Math.trunc((height - drag.anchor) / line);
      if (!lines) continue;
      if (Math.abs(lines) > panel.surface.rows) {
        drag.anchor = height;
        continue;
      }
      drag.anchor += lines * line;
      actions.scrollTerminal?.(panel.id, lines);
      cue('tick', source);
    }
  };
  const showScrollStrips = (panel: TerminalPanel): void => {
    const side = mutableState.windowPreferences.scrollStripSide;
    panel.scrollStrips.right.visible = side !== 'left';
    panel.scrollStrips.left.visible = side !== 'right';
  };
  const syncStripOpacity = (): void => {
    for (const panel of panels.values())
      for (const strip of Object.values(panel.scrollStrips)) {
        const active = [...stripScrolls.values()].some((drag) => drag.strip === strip);
        strip.material.opacity = active ? SCROLL_STRIP_ACTIVE_OPACITY : SCROLL_STRIP_OPACITY;
      }
  };
  const copyTextSelection = (source: THREE.Group): void => {
    const selection = textSelection;
    if (!selection || selection.source !== source || selection.phase !== 'dragging') return;
    if (gripActive() || disconnectedControllers.has(source)) {
      cancelTextSelection();
      return;
    }
    moveTextSelection(source, targetFromController(source));
    if (textSelection !== selection) return;
    const text = selection.surface.getSelectionText?.() ?? '';
    if (!selection.dragged || !text) {
      cancelTextSelection();
      return;
    }
    selection.phase = 'copying';
    const generation = ++clipboardGeneration;
    const copied = clipboard.copy(text);
    cancelTextSelection();
    showToast('Copied. Paste from Keyboard.');
    void copied.then((systemCopied) => {
      if (disposed || generation !== clipboardGeneration || systemCopied) return;
      showToast('Copied in Mux XR. Paste from Keyboard.');
    });
  };
  const showToast = (message: string | null): void => {
    mutableState.toast = message;
    toastDeadline = (previousRenderTime ?? performance.now()) + 2500;
    if (toastLabel) {
      updateLabel(toastLabel, message ?? '');
      toastLabel.visible = Boolean(message);
    }
    notify();
  };
  // Null or empty means nothing to paste; an error object carries its own notice.
  type PasteText = string | null | { error: string };
  const pasteClipboard = (
    paneId?: string,
    source: THREE.Group | null = lastSelectSource,
  ): Promise<boolean> => pasteFrom(paneId, source, () => clipboard.read(), 'Pasted.');
  const readHostText = async (): Promise<string | { error: string }> => {
    if (!actions.readHostClipboard) return { error: 'Host clipboard is not available here.' };
    const result = await actions.readHostClipboard();
    if (!result.ok) return { error: result.message };
    return result.value || { error: 'The host clipboard has no text.' };
  };
  const pasteHostClipboard = (
    paneId?: string,
    source: THREE.Group | null = lastSelectSource,
  ): Promise<boolean> => {
    if (hostPasteInFlight) return Promise.resolve(false);
    hostPasteInFlight = true;
    return pasteFrom(paneId, source, readHostText, 'Pasted host clipboard.', true).finally(() => {
      hostPasteInFlight = false;
    });
  };
  const copyHostToQuest = async (
    source: THREE.Group | null = lastSelectSource,
  ): Promise<boolean> => {
    const generation = ++clipboardGeneration;
    const result = await readHostText();
    if (disposed) return false;
    if (typeof result !== 'string') {
      setNotice(result.error);
      cue('error', source);
      return false;
    }
    const systemCopied = await clipboard.copy(result, { fromHost: true });
    if (disposed || generation !== clipboardGeneration) return systemCopied;
    showToast(
      systemCopied
        ? 'Host clipboard copied to Quest.'
        : 'Host text kept in Mux XR. The Quest clipboard refused it, so use Paste.',
    );
    return systemCopied;
  };
  const copyQuestToHost = async (
    source: THREE.Group | null = lastSelectSource,
  ): Promise<boolean> => {
    clipboardGeneration++;
    // The read starts before any await so the browser still sees the user gesture.
    const pending = clipboard.read({ excludeHost: true, preferLocal: true });
    if (!actions.writeHostClipboard) {
      setNotice('Host clipboard is not available here.');
      cue('error', source);
      return false;
    }
    const text = await pending;
    if (disposed) return false;
    if (!text) {
      setNotice(
        'The Quest clipboard is empty or unavailable here. Copy text in the browser, or highlight terminal text, first.',
      );
      cue('error', source);
      return false;
    }
    const result = await actions.writeHostClipboard(text);
    if (disposed) return false;
    if (!result.ok) {
      setNotice(result.message);
      cue('error', source);
      return false;
    }
    showToast('Copied to host clipboard.');
    return true;
  };
  const pasteFrom = async (
    paneId: string | undefined,
    source: THREE.Group | null,
    read: () => Promise<PasteText>,
    pastedToast: string,
    supersedable = false,
  ): Promise<boolean> => {
    const generation = ++clipboardGeneration;
    if (
      inputRoot &&
      inputMode === 'picture-url' &&
      (paneId === undefined || paneId === PICTURE_URL_PASTE)
    ) {
      const received = await read();
      if (disposed || (supersedable && generation !== clipboardGeneration)) return false;
      // URLs hold no whitespace, so a copied line break or indent is dropped.
      const text = typeof received === 'string' ? received.replace(/\s+/g, '') : '';
      if (!text) {
        setNotice(
          received && typeof received === 'object'
            ? received.error
            : 'Clipboard is empty or unavailable. Copy an image URL first.',
        );
        cue('error', source);
        return false;
      }
      if (!inputRoot || inputMode !== 'picture-url') return false;
      const characters = Array.from(pictureUrl.text);
      const cursor = Math.min(pictureUrl.cursor, characters.length);
      const inserted = Array.from(text);
      characters.splice(cursor, 0, ...inserted);
      pictureUrl = { text: characters.join(''), cursor: cursor + inserted.length };
      picturePanelMessage = '';
      refreshInputRoot('picture-url');
      showToast(pastedToast);
      return true;
    }
    const id = paneId ?? mutableState.inputTargetId ?? mutableState.selectedTerminalId;
    const panel = id ? panels.get(id) : undefined;
    if (
      !id ||
      !panel ||
      panel.surface.status !== 'connected' ||
      mutableState.selectedTerminalId !== id
    ) {
      setNotice('Select a connected terminal before pasting.');
      cue('error', source);
      return false;
    }
    const received = await read();
    if (disposed) return false;
    // A slow host read loses to any clipboard action started while it was in flight.
    if (supersedable && generation !== clipboardGeneration) return false;
    if (
      panels.get(id) !== panel ||
      mutableState.selectedTerminalId !== id ||
      panel.surface.status !== 'connected'
    ) {
      setNotice('The paste target changed. Select it and paste again.');
      cue('error', source);
      return false;
    }
    if (typeof received !== 'string' || received === '') {
      setNotice(
        received && typeof received === 'object'
          ? received.error
          : 'Clipboard is empty or unavailable. Highlight text to copy it first.',
      );
      cue('error', source);
      return false;
    }
    try {
      if (!panel.surface.paste(received)) throw new Error('Paste rejected');
      showToast(pastedToast);
      return true;
    } catch {
      setNotice('The terminal rejected the paste. Reconnect and try again.');
      cue('error', source);
      return false;
    }
  };
  const startMouse = (
    source: THREE.Group | number,
    target: InputTarget | null,
    button: number,
    modifiers?: KeyModifiers,
  ): boolean => {
    if (warpEdit || gripActive() || !target?.uv || button < 0 || button > 2) return false;
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
    if (typeof source === 'object')
      mousePresses.set(source, {
        point: rayHitPoint(source),
        cell: { col: input.col, row: input.row },
      });
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
    const press = typeof source === 'object' ? mousePresses.get(source) : undefined;
    if (press) {
      if (!pastDragDeadZone(source as THREE.Group, press, cell)) return;
      mousePresses.delete(source as THREE.Group);
    }
    capture.col = cell.col;
    capture.row = cell.row;
    actions.sendMouse?.(capture.id, { ...capture, eventType: 'move' });
  };

  const notify = (): void => {
    if (activePaneLabel) {
      const panel = panels.get(mutableState.selectedTerminalId ?? '');
      updateLabel(
        activePaneLabel,
        panel
          ? paneHeading(panel.surface.pane.title, panel.status, panel.surface.process, null, 0)
          : 'No active pane',
      );
    }
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
    lastSelectSource = null;
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
  const sampleHand = (root: THREE.Group): ReturnType<typeof updateHandInput> | null => {
    const hand = activeHand(root);
    const state = handInputStates.get(root);
    if (!hand || !state) return null;
    const gesture = updateHandInput(hand, state, root.visible);
    if (!gesture.tracked) {
      if (!handTrackingLost.has(root)) {
        handTrackingLost.add(root);
        resetHandContact(root, true, false, true);
        contactGripArmed.delete(root);
        pendingPaste.delete(root);
        modifierPresses.delete(root);
        handGrabActions.get(root)?.release();
        releaseMouse(root);
        if (textSelection?.source === root) cancelTextSelection(undefined, true);
        const previous = hoveredByController.get(root);
        hoveredByController.delete(root);
        if (previous && ![...hoveredByController.values()].includes(previous)) {
          const material = (previous as THREE.Mesh).material as THREE.MeshBasicMaterial;
          if (material?.color)
            material.color.setHex(previous.userData.activeState ? ACCENT : 0xffffff);
        }
        showHover(null);
      }
    } else handTrackingLost.delete(root);
    const ray = root.children.find((child) => child instanceof THREE.Line);
    const contact = root.children.find((child) => child instanceof THREE.Mesh);
    if (ray) ray.visible = gesture.tracked && !controllerRayBlocked(root);
    if (contact && !gesture.tracked) contact.visible = false;
    if (!gesture.tracked) root.userData.rayDistance = 0;
    return gesture;
  };
  // How far an index-thumb pinch has closed, 0 open to 1 closed; controllers report 0.
  const pinchProgress = (root: THREE.Group): number => {
    const joints = (
      activeHand(root) as (THREE.Group & { joints?: Record<string, THREE.Object3D> }) | undefined
    )?.joints;
    const thumb = joints?.['thumb-tip'];
    const index = joints?.['index-finger-tip'];
    if (!thumb || !index) return 0;
    const gap = thumb.position.distanceTo(index.position);
    return THREE.MathUtils.clamp(
      (CURSOR_PINCH_OPEN - gap) / (CURSOR_PINCH_OPEN - CURSOR_PINCH_CLOSED),
      0,
      1,
    );
  };
  const handSelectionAllowed = (root: THREE.Group): boolean => {
    if (!activeHand(root)) return true;
    const gesture = sampleHand(root);
    return Boolean(gesture?.tracked && !gesture.pinching && handInputStates.get(root)?.neutral);
  };
  let keyboardRaysBlocked = false;
  const controllerRayBlocked = (source: THREE.Group): boolean =>
    keyboardRaysBlocked || (controllerHandedness.get(source) === 'left' && wristWatch.near);
  const keyboardSurface = (): THREE.Group | null =>
    inputRoot && isTypingMode(inputMode) && !radialMenu.root.visible && !warpEdit
      ? inputRoot
      : null;
  const contactKeyboard = (): THREE.Group | null =>
    mutableState.keyborbEnabled ? null : keyboardSurface();
  // The render time of each hand visual's last pose update, so the render loop's proximity checks
  // reuse it. three updates the joints from an input event's own frame before dispatching it, so
  // controller events clear the entry (see onPoseEvent).
  const handPosedAt = new Map<THREE.Group, number>();
  const contactVisual = (source: THREE.Group, refresh = false): CartoonHand | undefined => {
    const visual = handVisuals.get(source);
    const side = controllerHandedness.get(source);
    if (
      !visual ||
      !source.visible ||
      disconnectedControllers.has(source) ||
      (side !== 'left' && side !== 'right')
    )
      return undefined;
    if (refresh && renderer) {
      const hand = activeHand(source);
      const posed = previousRenderTime !== null && handPosedAt.get(source) === previousRenderTime;
      if (hand) {
        if (!sampleHand(source)?.tracked) return undefined;
        if (!posed) visual.update(hand, renderer.xr.getCamera(), side, 0);
      } else if (!posed) {
        const grip = controllerGrips.get(source);
        visual.updateController(
          grip?.visible ? grip : source,
          renderer.xr.getCamera(),
          side,
          controllerGamepads.get(source),
          0,
        );
      }
    }
    return visual.root.visible ? visual : undefined;
  };
  const keyboardNear = (source: THREE.Group): boolean => {
    const visual = contactVisual(source, true);
    return Boolean(
      visual &&
        keyboardProximity
          .get(source)
          ?.near(
            visual.root.userData.indexTip as THREE.Vector3,
            visual.root.userData.palmPosition as THREE.Vector3,
            keyboardSurface(),
          ),
    );
  };
  const suppressKeyboardRays = (): boolean => {
    const blocked = Boolean(
      renderer?.xr.isPresenting &&
        controllerRoots.some(
          (source) =>
            keyboardNear(source) ||
            keyborbInput.near(source) ||
            hierarchyTouch.near(source) ||
            (contactKeyboard() && contactSamples.get(source)?.nearKeyboard),
        ),
    );
    if (blocked && !keyboardRaysBlocked) {
      releaseAllMouse();
      if (textSelection?.phase === 'dragging') cancelTextSelection();
    }
    keyboardRaysBlocked = blocked;
    return blocked;
  };
  const pressKeyborb = (controller: THREE.Group, key: THREE.Mesh, pinch = true): void => {
    const slot = key.userData.keyborbSlot as number | undefined;
    if (pinch && slot !== undefined)
      keyborbFlashes.set(slot, (previousRenderTime ?? performance.now()) + 240);
    const modifier = key.userData.modifier as KeyboardModifier | undefined;
    const before = modifier
      ? {
          active: Boolean(modifierState.active[modifier]),
          locked: Boolean(modifierState.locked[modifier]),
        }
      : undefined;
    const target: InputTarget = {
      kind: 'keyboard',
      terminalId: mutableState.inputTargetId ?? '',
      object: key,
    };
    lastSelectSource = controller;
    const cues = cueCount;
    activateTarget(target);
    pressCue(controller, key.userData.inputAction, cues);
    lastSelectSource = null;
    beginModifierPress(controller, target, before);
    if (pinch) pokeSources.add(controller);
    showHover(null);
  };
  // A Keyborb pinch types when it opens, so the press ends with the commit.
  const commitKeyborb = (controller: THREE.Group, key: THREE.Mesh): void => {
    pressKeyborb(controller, key);
    pokeSources.delete(controller);
    modifierPresses.delete(controller);
  };
  // The keyboard Keyborb can type on now, shared by the per-frame sample and the native release.
  const keyborbKeyboard = (): THREE.Group | null =>
    renderer?.xr.isPresenting &&
    mutableState.keyborbEnabled &&
    inputRoot?.visible &&
    isTypingMode(inputMode) &&
    !radialMenu.root.visible &&
    !warpEdit &&
    !gripActive()
      ? inputRoot
      : null;
  const updateKeyborbInput = (deltaSeconds: number): void => {
    const mode = inputMode;
    const targetId = mutableState.inputTargetId;
    const keyboard = keyborbKeyboard();
    keyborbInput.begin(keyboard);
    const raysLive = Boolean(keyboard) && !keyboardRaysBlocked;
    let worldFresh = false;
    for (const controller of controllerRoots) {
      const hand = activeHand(controller);
      const visual = contactVisual(controller);
      const gesture = hand ? sampleHand(controller) : null;
      if (raysLive && hand && !worldFresh) {
        // One matrix pass serves both hands' rays.
        updateVisibleMatrixWorld(scene);
        worldFresh = true;
      }
      const ray = raysLive && hand ? targetFromController(controller, false) : null;
      const rayKey = ray?.object?.userData.keyborb ? (ray.object as THREE.Mesh) : null;
      const tipsTracked = visual && (!hand || gesture?.tracked);
      const sample = keyborbInput.sample(
        controller,
        tipsTracked ? (visual.root.userData.indexTip as THREE.Vector3) : null,
        tipsTracked ? (visual.root.userData.thumbTip as THREE.Vector3) : null,
        rayKey,
        Boolean(
          keyboard &&
            gesture?.tracked &&
            !gesture.pinching &&
            !priorityHandActions.has(String(ray?.object?.userData.inputAction)),
        ),
        deltaSeconds,
        visual?.root.userData.keyborbPoint as THREE.Vector3 | undefined,
      );
      if (sample.released && pokeSources.delete(controller)) modifierPresses.delete(controller);
      const key = sample.pressed?.userData.modifier ? sample.pressed : sample.committed;
      if (
        !key ||
        !keyboard ||
        !inputRoot ||
        inputMode !== mode ||
        mutableState.inputTargetId !== targetId
      )
        continue;
      if (key === sample.pressed) pressKeyborb(controller, key);
      else commitKeyborb(controller, key);
    }
    keyborbInput.animate(deltaSeconds);
  };
  const hierarchyTouchRoot = (): THREE.Group | null =>
    renderer?.xr.isPresenting &&
    inputRoot?.visible &&
    inputMode === 'panes' &&
    hierarchyNavigator &&
    !hierarchyNavigator.transitioning &&
    !radialMenu.root.visible &&
    !warpEdit
      ? hierarchyNavigator.root
      : null;
  // Node bodies only: label planes share the action but their wide bounds would steal the hover.
  const hierarchyTargets = (root: THREE.Group | null, paneOnly = false): THREE.Object3D[] => {
    const targets: THREE.Object3D[] = [];
    if (!root) return targets;
    root.updateMatrixWorld(true);
    const collect = (object: THREE.Object3D): void => {
      if (object.userData.disposeLabel) return;
      const action = object.userData.inputAction;
      if (
        (object as THREE.Mesh).isMesh &&
        (action === 'pane' ||
          (!paneOnly && (action === 'hierarchyNode' || action === 'createPane')))
      )
        targets.push(object);
      for (const child of object.children) collect(child);
    };
    collect(root);
    return targets;
  };
  const hierarchyTouchMarker = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.05, 8, 48),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }),
  );
  hierarchyTouchMarker.name = 'hierarchy-touch-marker';
  hierarchyTouchMarker.raycast = () => undefined;
  hierarchyTouchMarker.visible = false;
  scene.add(hierarchyTouchMarker);
  const markerSphere = new THREE.Sphere();
  const updateHierarchyTouch = (): void => {
    const root = controllerRoots.some((controller) => activeHand(controller))
      ? hierarchyTouchRoot()
      : null;
    const targets = hierarchyTargets(root);
    let marked: THREE.Object3D | null = null;
    for (const controller of controllerRoots) {
      const hand = activeHand(controller);
      const gesture = hand ? sampleHand(controller) : null;
      const visual = root && hand && gesture?.tracked ? contactVisual(controller) : undefined;
      // A grab pinch or a held object owns the hand; its index-thumb gap is not a select.
      const free = visual && !gesture?.pinching && !dragStates.has(controller);
      const sample = hierarchyTouch.sample(
        controller,
        free ? (visual.root.userData.indexTip as THREE.Vector3) : null,
        free ? (visual.root.userData.thumbTip as THREE.Vector3) : null,
        targets,
      );
      marked ??= sample.hovered;
      if (!sample.committed) continue;
      lastSelectSource = controller;
      const cues = cueCount;
      activateTarget({
        kind: 'keyboard',
        terminalId: mutableState.inputTargetId ?? '',
        object: sample.committed,
      });
      pressCue(controller, sample.committed.userData.inputAction, cues);
      lastSelectSource = null;
      hierarchyTouch.reset(controller);
      marked = null;
      break;
    }
    hierarchyTouchMarker.visible = Boolean(marked);
    if (!marked) return;
    const mesh = marked as THREE.Mesh;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    markerSphere.copy(mesh.geometry.boundingSphere as THREE.Sphere).applyMatrix4(mesh.matrixWorld);
    hierarchyTouchMarker.position.copy(markerSphere.center);
    hierarchyTouchMarker.scale.setScalar(markerSphere.radius * 1.2);
    hierarchyTouchMarker.lookAt(headPosition());
  };
  const PANE_PULL_START_SCALE = 0.12;
  const PANE_PULL_GROW_DISTANCE = 0.25;
  const PANE_PULL_MIN_TRAVEL = 0.1;
  // A terminal 1.5 m away opens at scale 1, so nearer drops shrink to the same angular size.
  const PANE_PULL_REFERENCE_DISTANCE = 1.5;
  const panePulls = new Set<THREE.Group>();
  // A hand at a node has its rays hidden, so no ray target can stand in for the whole-tree grab.
  const hierarchyGrab = (
    controller: THREE.Group,
    contactObject: THREE.Group | undefined,
    target: InputTarget | null,
  ): { pane: THREE.Object3D | null; tree: boolean } => {
    const none = { pane: null, tree: false };
    const root = hierarchyTouchRoot();
    if (!root || (contactObject && contactObject !== inputRoot)) return none;
    const pulling = (node: THREE.Object3D): boolean =>
      [...panePulls].some((proxy) => proxy.userData.panePullId === node.userData.paneId);
    const hit = target?.object;
    if (hit) {
      const pane =
        hit.userData.inputAction === 'pane' && root.getObjectById(hit.id) && !pulling(hit)
          ? hit
          : null;
      return { pane, tree: false };
    }
    const visual = contactVisual(controller);
    if (!visual) return none;
    const thumb = visual.root.userData.thumbTip as THREE.Vector3;
    const pane = hierarchyTouch.nearest(thumb, hierarchyTargets(root, true), HIERARCHY_NEAR_ENTER);
    if (pane) return { pane: pulling(pane) ? null : pane, tree: false };
    return {
      pane: null,
      tree:
        !contactObject &&
        Boolean(hierarchyTouch.nearest(thumb, hierarchyTargets(root), HIERARCHY_NEAR_EXIT)),
    };
  };
  const panePullScale = (proxy: THREE.Group): number => {
    const start = proxy.userData.panePullStart as THREE.Vector3;
    const grown = THREE.MathUtils.clamp(
      proxy.position.distanceTo(start) / PANE_PULL_GROW_DISTANCE,
      0,
      1,
    );
    const target = THREE.MathUtils.clamp(
      proxy.position.distanceTo(headPosition()) / PANE_PULL_REFERENCE_DISTANCE,
      0.3,
      1.8,
    );
    return THREE.MathUtils.lerp(PANE_PULL_START_SCALE, target, grown);
  };
  const startPanePull = (controller: THREE.Group, node: THREE.Object3D, far: boolean): void => {
    const paneId = node.userData.paneId as string;
    const title = availablePanes.find((pane) => pane.id === paneId)?.title ?? paneId;
    const proxy = new THREE.Group();
    proxy.name = 'pane-pull-proxy';
    proxy.userData.panePullId = paneId;
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      new THREE.MeshBasicMaterial({
        color: 0x101820,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      }),
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(card.geometry),
      new THREE.LineBasicMaterial({ color: ACCENT }),
    );
    const label = createScalableLabel(title, 1.1, 0.16);
    label.position.z = 0.01;
    proxy.add(card, edge, label);
    proxy.traverse((object) => {
      object.raycast = () => undefined;
    });
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(proxy.position);
    proxy.userData.panePullStart = proxy.position.clone();
    proxy.scale.setScalar(PANE_PULL_START_SCALE);
    proxy.lookAt(headPosition());
    scene.add(proxy);
    panePulls.add(proxy);
    captureGrab(controller, proxy, far);
  };
  const discardPanePull = (proxy: THREE.Group): void => {
    panePulls.delete(proxy);
    scene.remove(proxy);
    disposeObject(proxy);
  };
  const finishPanePull = (controller: THREE.Group, proxy: THREE.Group): void => {
    const paneId = proxy.userData.panePullId as string;
    const travel = proxy.position.distanceTo(proxy.userData.panePullStart as THREE.Vector3);
    proxy.scale.setScalar(panePullScale(proxy));
    proxy.lookAt(headPosition());
    proxy.updateMatrixWorld(true);
    const pose = captureUIPose(proxy);
    discardPanePull(proxy);
    // Tracking loss mid-pull is not a deliberate release, so it drops the ghost.
    if (
      handTrackingLost.has(controller) ||
      travel < PANE_PULL_MIN_TRAVEL ||
      !availablePanes.some((pane) => pane.id === paneId)
    ) {
      cue('release', controller);
      return;
    }
    // Order matters: closing the hierarchy restores the visibility it recorded, then ending Focus
    // reveals its faded panels, and only then may selection run, so it rebuilds no hierarchy and
    // Focus cannot restore its pre-focus transform over the drop.
    hideInput();
    if (paneFocus.activeId) endFocusMode(true);
    actions.selectPane(paneId);
    if (panels.has(paneId)) {
      restoreTerminalPose(paneId, pose);
      rememberTerminalPlacements();
    }
    cue('select', controller);
  };
  const updatePanePulls = (): void => {
    const held = new Set([...dragStates.values()].map((drag) => drag.object));
    for (const proxy of panePulls) {
      if (!held.has(proxy)) {
        discardPanePull(proxy);
        continue;
      }
      proxy.scale.setScalar(panePullScale(proxy));
      proxy.lookAt(headPosition());
    }
  };
  const contactGripTarget = (source: THREE.Group): THREE.Group | null => {
    const visual = contactVisual(source, true);
    const query = handContacts.get(source);
    if (!visual || !query) return null;
    let roots: THREE.Group[];
    if (radialMenu.root.visible) roots = radialMenu.interactive ? [radialMenu.root] : [];
    else
      roots = [...panels.values()]
        .filter(isPanelShown)
        .map((panel) => panel.root)
        .concat(
          inputRoot ? [inputRoot] : [],
          hudRoot ? [hudRoot] : [],
          [...widgets.values()].map((widget) => widget.root),
        );
    return query.grip(
      [
        { point: visual.root.userData.palmPosition as THREE.Vector3, radius: 0.045 },
        { point: visual.root.userData.indexTip as THREE.Vector3, radius: 0.022 },
        { point: visual.root.userData.thumbTip as THREE.Vector3, radius: 0.024 },
        { point: visual.root.userData.middleTip as THREE.Vector3, radius: 0.022 },
        { point: visual.root.userData.outerTip as THREE.Vector3, radius: 0.024 },
        { point: visual.root.userData.wristPosition as THREE.Vector3, radius: 0.03 },
      ],
      roots,
    );
  };
  const onTopMask = 1 << ON_TOP_LAYER;
  const batchHiddenMask = 1 << LABEL_BATCH_HIDDEN_LAYER;
  const putOnTop = (root: THREE.Object3D): void => {
    root.traverse((object) => {
      if (object.layers.mask !== batchHiddenMask) object.layers.mask = onTopMask;
    });
  };
  const noRenderHook = (): void => undefined;
  // Without multisampled render-to-texture, three resolves an antialiased XR target at the end of
  // each render, so a second pass would draw onto a discarded buffer.
  const xrTargetResolvesPerRender = (): boolean => {
    if (!renderer?.xr.isPresenting) return false;
    const target = renderer.getRenderTarget?.();
    return (
      Boolean(target && target.samples > 0) &&
      !renderer.extensions?.has('WEBGL_multisampled_render_to_texture')
    );
  };
  // While a menu is open the room draws first without menus, hands, rays and their help and HUD
  // text; those then draw over a cleared depth buffer so nothing in the room can cover a menu.
  const renderScene = (): void => {
    if (!renderer) return;
    const menuOpen = radialMenu.root.visible || Boolean(inputRoot?.visible && inputRoot.parent);
    camera.layers.enable(ON_TOP_LAYER);
    if (!menuOpen || xrTargetResolvesPerRender()) {
      renderer.render(scene, camera);
      return;
    }
    putOnTop(radialMenu.root);
    if (inputRoot) putOnTop(inputRoot);
    for (const visual of handVisuals.values()) putOnTop(visual.root);
    for (const part of pointerParts) putOnTop(part);
    putOnTop(hoverHelp);
    putOnTop(wristWatch.root);
    if (hudRoot) putOnTop(hudRoot);
    const mask = camera.layers.mask;
    camera.layers.mask = mask & ~onTopMask;
    renderer.render(scene, camera);
    const background = scene.background;
    const beforeRender = scene.onBeforeRender;
    const autoClear = renderer.autoClear;
    scene.background = null;
    // Label batches were placed by the first pass.
    scene.onBeforeRender = noRenderHook;
    renderer.autoClear = false;
    camera.layers.mask = onTopMask;
    try {
      renderer.clearDepth();
      renderer.render(scene, camera);
    } finally {
      camera.layers.mask = mask;
      renderer.autoClear = autoClear;
      scene.onBeforeRender = beforeRender;
      scene.background = background;
    }
  };
  const render = (time = 0, frame?: XRFrame): void => {
    if (disposed) return;
    if (renderer?.xr.isPresenting) {
      const space = frame ? renderer.xr.getReferenceSpace() : null;
      const viewerPose = frame && space ? frame.getViewerPose(space) : undefined;
      if (viewerPose) {
        const { position, orientation } = viewerPose.transform;
        xrHead.position.set(position.x, position.y, position.z);
        xrHead.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        xrHead.updateMatrixWorld(true);
        xrHeadFromFrame = true;
      }
      if (xrViewerPending && (!frame || viewerPose)) xrViewerPending = false;
    }
    syncKeyborb();
    pendingPokes.clear();
    const radialDelta =
      previousRenderTime === null ? 0 : Math.max(0, (time - previousRenderTime) / 1000);
    const deltaSeconds =
      previousRenderTime === null
        ? 1 / 60
        : THREE.MathUtils.clamp((time - previousRenderTime) / 1000, 0, 0.05);
    previousRenderTime = time;
    for (const [object, press] of pressedButtons) {
      const offset =
        time < press.until
          ? BUTTON_TRAVEL
          : BUTTON_TRAVEL * Math.max(0, 1 - (time - press.until) / BUTTON_RELEASE_MS);
      object.translateZ(press.offset - offset);
      press.offset = offset;
      if (!offset) pressedButtons.delete(object);
    }
    for (const [key, until] of pressUntil) if (time >= until) pressUntil.delete(key);
    if (mutableState.toast && time >= toastDeadline) showToast(null);
    paneFocus.update(deltaSeconds);
    radialMenu.update(radialDelta);
    if (poseRestorePending && renderer?.xr.isPresenting) {
      const saved = poseStore.read('hud');
      if (saved && hudRoot)
        applyUIPose(hudRoot, saved, hudRoot.userData.scaleLimits as [number, number]);
      for (const [id, pose] of terminalRestoredPoses) {
        const panel = panels.get(id);
        if (panel) applyUIPose(panel.root, pose, [0.3, 1.8], 100);
      }
      poseRestorePending = false;
      floorCorrectionPending = true;
    }
    if (widgetRestorePending) {
      for (const [kind, pose] of Object.entries(widgetPoseStore.read())) {
        // Multi-instance widgets (pictures) restore from their own records, not from a pose.
        if (!pose || touchedWidgets.has(kind)) continue;
        if (isPlaceholderKey(kind) && !widgets.has(kind)) {
          const widget = createPictureFrameWidget(uiEnvironment.texture, {
            id: kind.slice(PICTURE_KIND.length + 1),
          });
          mountWidget(PICTURE_KIND, widget, false);
          // A pose the store cannot apply falls back to the placeholder spot, never the origin.
          if (!validPose(pose)) placeWidget(kind, widget);
          else {
            applyUIPose(widget.root, pose, [0.25, 2]);
            if (pose.placed) widget.root.userData.picturePlaced = true;
          }
          continue;
        }
        if (!isWidgetKind(kind) || widgetKeyKind(kind) !== kind) continue;
        const widget = widgets.get(kind) ?? addWidget(kind);
        applyUIPose(widget.root, pose, [0.25, 2]);
      }
      widgetRestorePending = false;
      mutableState.widgets = [...widgets.keys()];
      notify();
    }
    const nowMs = Date.now();
    const focusedPanel = panels.get(mutableState.focusedTerminalId ?? '');
    const focusedCwd = focusedPanel?.surface.cwd ?? null;
    for (const widget of widgets.values()) {
      widget.setFocusedPane?.(
        focusedPanel?.id ?? null,
        focusedCwd,
        focusedPanel?.surface.cwdHost ?? null,
      );
      widget.update(nowMs);
    }
    hierarchyNavigator?.update(
      deltaSeconds,
      renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera,
    );
    if (hierarchyNavigator)
      hierarchyNavigator.root.userData.transitioning = hierarchyNavigator.transitioning;
    (scene.userData.updateEnvironment as ((delta: number) => void) | undefined)?.(deltaSeconds);
    if (renderer?.xr.isPresenting) {
      let leftController: THREE.Group | null = null;
      let leftVisual: CartoonHand | undefined;
      let rightVisual: CartoonHand | undefined;
      for (const controller of controllerRoots) {
        const visual = handVisuals.get(controller);
        const side = controllerHandedness.get(controller);
        if (
          !controller.visible ||
          disconnectedControllers.has(controller) ||
          (side !== 'left' && side !== 'right')
        ) {
          visual?.hide();
          continue;
        }
        const hand = activeHand(controller);
        if (hand) {
          const gesture = sampleHand(controller);
          if (!gesture?.tracked) {
            visual?.hide();
            continue;
          }
          visual?.update(hand, renderer.xr.getCamera(), side, deltaSeconds);
        } else {
          const grip = controllerGrips.get(controller);
          visual?.updateController(
            grip?.visible ? grip : controller,
            renderer.xr.getCamera(),
            side,
            controllerGamepads.get(controller),
            deltaSeconds,
          );
        }
        handPosedAt.set(controller, time);
        if (side === 'left') {
          leftController = controller;
          leftVisual = visual;
        } else rightVisual = visual;
      }
      wristWatch.updateTime(Date.now());
      wristWatch.setVisible(Boolean(rightVisual?.root.visible));
      if (rightVisual?.root.visible)
        wristWatch.update(
          rightVisual.root.userData.wristPosition as THREE.Vector3,
          rightVisual.root.userData.palmForward as THREE.Vector3,
          rightVisual.root.userData.wristBackNormal as THREE.Vector3,
        );
      const watchWasNear = wristWatch.near;
      let watchPressed = false;
      if (!leftVisual?.root.visible || !wristWatch.root.visible) wristWatch.updateTouch(null);
      else if (
        wristWatch.root
          .getWorldPosition(watchProbeCenter)
          .distanceTo(leftVisual.root.userData.palmPosition as THREE.Vector3) >=
        WRIST_WATCH_PROBE_REACH
      )
        // Reading contactProbes skins the hand's probe vertices, which cannot touch from here.
        wristWatch.touchOutOfReach();
      else watchPressed = wristWatch.updateTouch(leftVisual.contactProbes);
      if (leftController && wristWatch.near && !watchWasNear) {
        releaseMouse(leftController);
        if (textSelection?.source === leftController && textSelection.phase === 'dragging')
          cancelTextSelection();
      }
      for (const controller of controllerRoots) {
        if (!activeHand(controller) || !handVisuals.get(controller)?.root.visible) continue;
        const pinching = handInputStates.get(controller)?.pinching;
        if (pinching && !heldControllers.has(controller)) handGrabActions.get(controller)?.grab();
        else if (!pinching && heldControllers.has(controller))
          handGrabActions.get(controller)?.release();
      }
      if (watchPressed && leftController && toggleWristMenu(leftController, true))
        cue('select', leftController);
    } else {
      for (const visual of handVisuals.values()) visual.hide();
      wristWatch.setVisible(false);
    }
    respawnTypingForInputKind();
    updateHierarchyTouch();
    suppressKeyboardRays();
    updateKeyborbInput(deltaSeconds);
    if (renderer?.xr.isPresenting) {
      for (const controller of controllerRoots) {
        const visual = contactVisual(controller);
        const query = handContacts.get(controller);
        if (!visual || !query) {
          resetHandContact(controller, true, false, handTrackingLost.has(controller));
          if (
            !controller.visible ||
            disconnectedControllers.has(controller) ||
            handTrackingLost.has(controller)
          ) {
            contactGripArmed.delete(controller);
            if (heldControllers.has(controller)) handGrabActions.get(controller)?.release();
          }
          continue;
        }
        const wasNear = Boolean(contactSamples.get(controller)?.nearKeyboard);
        const sample = query.sample(
          visual.root.userData.indexTip as THREE.Vector3,
          visual.root.userData.palmPosition as THREE.Vector3,
          keyboardSurface(),
          !gripActive(),
        );
        contactSamples.set(controller, sample);
        controller.userData.nearKeyboard = sample.nearKeyboard;
        if (sample.nearKeyboard && !wasNear) {
          releaseMouse(controller);
          pendingPaste.delete(controller);
          if (textSelection?.source === controller && textSelection.phase === 'dragging')
            cancelTextSelection();
        }
        if (sample.released && pokeSources.delete(controller)) modifierPresses.delete(controller);
        if (sample.pressed)
          pendingPokes.set(controller, {
            object: sample.pressed,
            target: mutableState.inputTargetId,
            mode: inputMode,
          });
      }
    } else resetHandContacts();
    suppressKeyboardRays();
    if (gripActive()) modifierPresses.clear();
    for (const [source, press] of modifierPresses) {
      if (press.since === null) press.since = time;
      if (!press.locked && time - press.since >= 550) {
        press.locked = true;
        modifierState.lock(press.modifier);
        cue('lock', source);
        if (inputRoot && isTypingMode(inputMode)) refreshInputRoot(inputMode);
        syncModifierVisuals();
      }
    }
    const fps = frameCounter.sample(time);
    const perfHidden =
      document.visibilityState === 'hidden' ||
      (activeSession?.visibilityState !== undefined && activeSession.visibilityState !== 'visible');
    if (countsAsFrame(radialDelta * 1000, perfHidden, perfWasHidden))
      perfWorstFrameMs = Math.max(perfWorstFrameMs, radialDelta * 1000);
    perfWasHidden = perfHidden;
    if (fps !== null) {
      mutableState.fps = fps;
      if (fpsLabel) updateLabel(fpsLabel, `FPS ${fps}`);
      let shownPanes = 0;
      for (const panel of panels.values()) if (isPanelShown(panel)) shownPanes += 1;
      const sample = {
        fps,
        worstFrameMs: perfWorstFrameMs,
        shownPanes,
        targetHz: renderer?.xr.isPresenting ? (activeSession?.frameRate ?? 72) : 60,
      };
      for (const widget of widgets.values()) widget.setPerfSample?.(sample);
      perfWorstFrameMs = 0;
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
      const fired: Array<{ controller: THREE.Group; button: ControllerButton }> = [];
      for (const controller of controllerRoots) {
        const hand = controllerHandedness.get(controller);
        if (hand !== 'right' && hand !== 'left') continue;
        const pad = controllerGamepads.get(controller);
        for (const [index, button] of FACE_BUTTONS[hand]) {
          const held = index === 4 ? radialButtonDown : focusButtonDown;
          const pressed = Boolean(pad?.buttons[index]?.pressed);
          const wasPressed = held.has(controller);
          if (pressed) held.add(controller);
          else held.delete(controller);
          if (
            pressed &&
            !wasPressed &&
            controller.visible &&
            !disconnectedControllers.has(controller) &&
            !gripActive()
          )
            fired.push({ controller, button });
        }
      }
      // A menu press landing with another function in one frame yields to it, whatever the
      // controller order, so the other function is not hidden behind a radial.
      const functionOf = (button: ControllerButton): ButtonFunction =>
        mutableState.windowPreferences.buttonMap[button];
      const others = fired.some(({ button }) => !['menu', 'none'].includes(functionOf(button)));
      // Presses in the frame Warp was already running only save or cancel it, so one started this
      // frame is not cancelled by a later button in the same frame.
      const warping = Boolean(warpEdit);
      for (const { controller, button } of fired) {
        if (warping) {
          if (!warpEdit) continue;
          if (button === 'rightA') finishWarp(true);
          else if (button === 'rightB') finishWarp(false);
          continue;
        }
        const choice = functionOf(button);
        if (choice === 'menu' && others) continue;
        runButtonFunction(choice, controller);
        if (choice === 'keyboard') {
          const hand = controllerHandedness.get(controller);
          const index =
            hand === 'left' || hand === 'right'
              ? FACE_BUTTONS[hand].find(([, name]) => name === button)?.[0]
              : undefined;
          if (index !== undefined)
            keyboardHolds.set(`${controller.uuid}:${button}`, {
              controller,
              index,
              seconds: 0,
              summoned: false,
            });
        }
      }
      for (const [key, hold] of keyboardHolds) {
        const pressed = controllerGamepads.get(hold.controller)?.buttons[hold.index]?.pressed;
        if (!pressed || !hold.controller.visible || disconnectedControllers.has(hold.controller)) {
          keyboardHolds.delete(key);
          continue;
        }
        hold.seconds += deltaSeconds;
        if (hold.summoned || hold.seconds < KEYBOARD_SUMMON_HOLD_SECONDS) continue;
        hold.summoned = true;
        summonKeyboard();
      }
      if (warpEdit && !gripActive()) {
        const controller = warpEdit.controller;
        if (controller && (!controller.visible || disconnectedControllers.has(controller)))
          finishWarp(false);
        else if (controller) {
          const pad = controllerGamepads.get(controller);
          const axis = pad?.axes[pad.axes.length >= 4 ? 2 : 0] ?? 0;
          if (Math.abs(axis) >= 0.2) {
            const panel = panels.get(warpEdit.id);
            if (panel)
              setTerminalCurvature(panel.id, panel.curvature + axis * 45 * deltaSeconds, false);
          }
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
          stripScrolls.has(controller) ||
          textSelection?.phase === 'dragging' ||
          textSelection?.phase === 'copying' ||
          warpEdit ||
          radialMenu.root.visible ||
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
        cue('recenter', controllerRoots[0]);
        recenterLatched = true;
      }
    }
    for (const controller of contactGripArmed) {
      if (!heldControllers.has(controller) || dragStates.has(controller)) continue;
      const object = contactGripTarget(controller);
      if (object) handGrabActions.get(controller)?.grab(object);
    }
    for (const [controller, press] of pendingPokes) {
      if (
        gripActive() ||
        !keyboardSurface() ||
        inputMode !== press.mode ||
        mutableState.inputTargetId !== press.target
      ) {
        resetHandContact(controller, false);
        continue;
      }
      const modifier = press.object.userData.modifier as KeyboardModifier | undefined;
      const before = modifier
        ? {
            active: Boolean(modifierState.active[modifier]),
            locked: Boolean(modifierState.locked[modifier]),
          }
        : undefined;
      const target: InputTarget = {
        kind: 'keyboard',
        terminalId: press.target ?? '',
        object: press.object,
      };
      lastSelectSource = controller;
      const cues = cueCount;
      if (press.object.userData.inputAction === 'pasteClipboard') {
        if (inputMode === 'picture-url') void pasteClipboard(PICTURE_URL_PASTE, controller);
        else if (press.target) void pasteClipboard(press.target);
      } else if (press.object.userData.inputAction === 'copyToHost') void copyQuestToHost();
      else activateTarget(target);
      pressCue(controller, press.object.userData.inputAction, cues);
      pressPanelButton(press.object);
      lastSelectSource = null;
      beginModifierPress(controller, target, before);
      pokeSources.add(controller);
      showHover(null);
    }
    if (pokeSources.size) gazeInputState = { candidateId: null, emphasizedId: null, since: time };
    for (const [object, pair] of pairGrabs) {
      const [first, second] = pair.controllers;
      const firstSpace = manipulationSpace(first);
      const secondSpace = manipulationSpace(second);
      firstSpace.updateMatrixWorld(true);
      secondSpace.updateMatrixWorld(true);
      const a = firstSpace.getWorldPosition(new THREE.Vector3());
      const b = secondSpace.getWorldPosition(new THREE.Vector3());
      const direction = b.clone().sub(a);
      const distance = direction.length();
      if (distance < 0.05) continue;
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        pair.direction,
        direction.divideScalar(distance),
      );
      const firstTwist = pairTwist(
        pair.grips[0],
        firstSpace.getWorldQuaternion(new THREE.Quaternion()),
        rotation,
        pair.direction,
      );
      let secondTwist = pairTwist(
        pair.grips[1],
        secondSpace.getWorldQuaternion(new THREE.Quaternion()),
        rotation,
        pair.direction,
      );
      if (secondTwist - firstTwist > Math.PI) secondTwist -= Math.PI * 2;
      else if (firstTwist - secondTwist > Math.PI) secondTwist += Math.PI * 2;
      const twist =
        Math.sign(firstTwist) === Math.sign(secondTwist)
          ? Math.sign(firstTwist) * Math.min(Math.abs(firstTwist), Math.abs(secondTwist))
          : 0;
      const deadZone =
        activeHand(first) || activeHand(second) ? HAND_PAIR_ROLL_DEAD_ZONE : PAIR_ROLL_DEAD_ZONE;
      const roll = Math.sign(twist) * Math.max(0, Math.abs(twist) - deadZone);
      if (roll) rotation.multiply(new THREE.Quaternion().setFromAxisAngle(pair.direction, roll));
      object.position.copy(pair.position).add(a.add(b).multiplyScalar(0.5).sub(pair.midpoint));
      object.quaternion.copy(rotation).multiply(pair.quaternion);
      const limits = object.userData.scaleLimits as [number, number];
      object.scale.setScalar(
        THREE.MathUtils.clamp((pair.scale * distance) / pair.distance, limits[0], limits[1]),
      );
    }
    for (const [controller, drag] of dragStates) {
      if (pairGrabs.has(drag.object)) continue;
      const space = manipulationSpace(controller);
      space.updateMatrixWorld(true);
      const controllerPosition = new THREE.Vector3().setFromMatrixPosition(space.matrixWorld);
      const controllerQuaternion = space.getWorldQuaternion(new THREE.Quaternion());
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
      if (drag.reel && activeHand(controller)) {
        // Turning carries the shoulder around with the head; re-anchor it in steps too small to
        // pass the dead zone, rebasing so the held object stays put.
        const shoulder = shoulderOffset(controller);
        if (shoulder.angleTo(drag.shoulder) > SHOULDER_REANCHOR) {
          const rebased = rebaseHandReel(handReach(space, shoulder), drag.localOffset.length());
          if (rebased) {
            drag.shoulder = shoulder;
            drag.reel = rebased;
          }
        }
        const length = drag.localOffset.length();
        const wanted = reelOffset(drag.reel, handReach(space, drag.shoulder));
        drag.localOffset.setLength(
          THREE.MathUtils.lerp(length, wanted, 1 - Math.exp(-12 * Math.max(0, deltaSeconds))),
        );
      }
      const facingPitch = drag.facingPitch;
      const ray = facingPitch === undefined ? undefined : rayFrame(controller, drag.headingYaw);
      if (ray?.held) drag.yawRecovering = true;
      else if (ray && drag.yawRecovering && drag.headingYaw !== undefined) {
        // Leaving the vertical band eases the held heading to the ray's instead of snapping.
        const gap = THREE.MathUtils.euclideanModulo(
          ray.yaw - drag.headingYaw + Math.PI,
          2 * Math.PI,
        );
        const diff = gap - Math.PI;
        if (Math.abs(diff) < 0.01) drag.yawRecovering = false;
        else {
          ray.yaw = drag.headingYaw + diff * (1 - Math.exp(-12 * Math.max(0, deltaSeconds)));
          ray.quaternion.setFromEuler(new THREE.Euler(ray.pitch, ray.yaw, 0, 'YXZ'));
        }
      }
      if (ray) drag.headingYaw = ray.yaw;
      const finalPosition = controllerPosition
        .clone()
        .add(drag.localOffset.clone().applyQuaternion(ray ? ray.quaternion : controllerQuaternion));
      drag.object.position.copy(finalPosition);
      if (facingPitch === undefined) {
        drag.object.quaternion.copy(controllerQuaternion).multiply(drag.relativeRotation);
        continue;
      }
      const toHead = headPosition().sub(finalPosition);
      drag.object.quaternion.slerp(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(facingPitch, Math.atan2(toHead.x, toHead.z), 0, 'YXZ'),
        ),
        1 - Math.exp(-12 * Math.max(0, deltaSeconds)),
      );
    }
    updatePanePulls();
    correctTerminalFloor();
    if (renderer?.xr.isPresenting) {
      // Rays and gaze below only use visible objects; the renderer's pass catches hidden ones up.
      updateVisibleMatrixWorld(scene);
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
          if (!isPanelShown(panel)) quality = 'hidden';
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
    if (mutableState.gazeInputEnabled && !radialMenu.root.visible && !warpEdit) {
      const gazeCamera = renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera;
      gazeCamera.updateMatrixWorld(true);
      raycaster.far = camera.far;
      const origin = new THREE.Vector3().setFromMatrixPosition(gazeCamera.matrixWorld);
      const direction = gazeCamera.getWorldDirection(new THREE.Vector3());
      raycaster.set(origin, direction);
      const hit = intersectVisible(
        raycaster,
        [...panels.values()]
          .map((panel) => panel.root)
          .concat(inputRoot ? [inputRoot] : [])
          .concat([...widgets.values()].map((widget) => widget.root)),
      ).find((entry) => isControlVisible(entry.object))?.object;
      let target: THREE.Object3D | null = hit ?? null;
      while (target && !target.userData.terminalId) target = target.parent;
      if (
        mutableState.gazeInputEnabled &&
        mutableState.xrMode !== 'desktop' &&
        inputMode !== 'command-editor' &&
        dragStates.size === 0 &&
        pokeSources.size === 0 &&
        stripScrolls.size === 0 &&
        keyborbInput.held().size === 0 &&
        mouseCaptures.size === 0 &&
        textSelection?.phase !== 'dragging' &&
        textSelection?.phase !== 'copying'
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
    if (renderer?.xr.isPresenting) updateStripScrolls();
    else stripScrolls.clear();
    syncStripOpacity();
    if (renderer?.xr.isPresenting) {
      let hover: THREE.Object3D | null = null;
      let bodyHover: THREE.Object3D | null = null;
      let controlTargeted = false;
      const nextHovered = new Map<THREE.Group, THREE.Object3D>();
      let radialHoverAction: RadialMenuAction | null = null;
      for (const controller of controllerRoots) {
        if (
          !controller.visible ||
          disconnectedControllers.has(controller) ||
          handTrackingLost.has(controller)
        )
          continue;
        controller.updateMatrixWorld(true);
        const sample = contactSamples.get(controller);
        const nearOrb = keyborbInput.hovered(controller);
        const nearKeyboard = Boolean(nearOrb || (sample?.nearKeyboard && keyboardSurface()));
        const nearControl = nearOrb ?? sample?.hovered;
        const rayBlocked = controllerRayBlocked(controller);
        const target: InputTarget | null = nearKeyboard
          ? nearControl
            ? {
                kind: 'keyboard',
                terminalId: mutableState.inputTargetId ?? '',
                object: nearControl,
              }
            : null
          : rayBlocked
            ? null
            : targetFromController(controller, false);
        moveMouse(controller, target);
        moveTextSelection(controller, target);
        const distance =
          (controller.userData.rayDistance as number | undefined) ?? CONTROLLER_RAY_LENGTH;
        const line = controller.children.find((child) => child instanceof THREE.Line) as
          | THREE.Line
          | undefined;
        if (line) {
          line.visible = !rayBlocked;
          line.scale.z = distance / CONTROLLER_RAY_LENGTH;
        }
        const contact = controller.children.find((child) => child instanceof THREE.Mesh) as
          | THREE.Mesh
          | undefined;
        if (contact) {
          contact.position.set(0, 0, -distance);
          contact.visible = !rayBlocked && Boolean(target?.object);
          const pinch = pinchProgress(controller);
          contact.scale.setScalar(
            THREE.MathUtils.clamp((distance * CURSOR_HALF_ANGLE) / CURSOR_RADIUS, 0.5, 12) *
              (1 + pinch * 0.8),
          );
          const material = contact.material as THREE.MeshBasicMaterial;
          material.color.copy(cursorColor.lerpColors(cursorRest, cursorPinched, pinch));
        }
        const object = target?.object;
        // Any widget mesh under the ray (row, gap, body, face) points its widget, not only labels.
        const pointedWidget = widgetOwning(object)?.[1];
        if (pointedWidget) pointedWidgets.add(pointedWidget);
        if (radialMenu.interactive && object?.userData.radialAction)
          radialHoverAction ??= object.userData.radialAction as RadialMenuAction;
        const modifierPress = modifierPresses.get(controller);
        if (modifierPress && object?.userData.modifier !== modifierPress.modifier)
          modifierPresses.delete(controller);
        const dragging = stripScrolls.has(controller);
        if (object?.userData.labelText !== undefined) {
          controlTargeted = true;
          if (object.userData.helpText && !dragging) hover ??= object;
        } else if (object?.userData.helpText && !dragging) bodyHover ??= object;
        if (
          object &&
          object.userData.labelText !== undefined &&
          (object.userData.inputAction || object.userData.key)
        ) {
          nextHovered.set(controller, object);
        }
      }
      radialMenu.setHovered(radialHoverAction);
      const allHovered = new Set(nextHovered.values());
      for (const previous of hoveredByController.values()) {
        if (allHovered.has(previous)) continue;
        const material = (previous as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        const modifier = previous.userData.modifier as keyof KeyModifiers | undefined;
        if (material?.color)
          material.color.setHex(
            (modifier && modifierState.active[modifier]) || previous.userData.activeState
              ? ACCENT
              : ((previous.userData.restColor as number | undefined) ?? 0xffffff),
          );
      }
      for (const object of allHovered) {
        const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (material?.color) material.color.setHex(0x9deaff);
      }
      hoveredByController.clear();
      for (const [controller, object] of nextHovered) hoveredByController.set(controller, object);
      for (const widget of widgets.values()) widget.setPointed?.(pointedWidgets.has(widget));
      pointedWidgets.clear();
      showHover(hover ?? (controlTargeted ? null : bodyHover), time);
    }
    if (!renderer?.xr.isPresenting && hoveredControl) showHover(hoveredControl, time);
    if (updateNotice)
      updateNotice.visible = mutableState.updateAvailable && Boolean(renderer?.xr.isPresenting);
    updateHoverPosition();
    const heldKeyborbs = keyborbInput.held();
    if ((keyborbFlashes.size || heldKeyborbs.size || keyborbHighlighted) && inputRoot) {
      for (const child of inputRoot.children) {
        const slot = child.userData.keyborbSlot as number | undefined;
        if (slot === undefined) continue;
        const expires = keyborbFlashes.get(slot);
        const flash =
          expires === undefined ? 0 : THREE.MathUtils.clamp((expires - time) / 90, 0, 1);
        setKeyborbPressed(child as THREE.Mesh, heldKeyborbs.has(child as THREE.Mesh) ? 1 : flash);
        if (expires !== undefined && expires <= time) keyborbFlashes.delete(slot);
      }
    }
    keyborbHighlighted = heldKeyborbs.size > 0;
    if (inputRoot?.visible) {
      (inputRoot.userData.keyborbShells as KeyborbShells | undefined)?.update();
      (inputRoot.userData.keyborbGlyphs as KeyborbGlyphs | undefined)?.update();
    }
    observatory.rotation.y = time * 0.00001;
    for (const panel of panels.values()) panel.surface.flush?.();
    renderScene();
    if (!renderer && typeof window.requestAnimationFrame === 'function')
      frameHandle = window.requestAnimationFrame(render);
  };
  resize();
  if (renderer) renderer.setAnimationLoop((time: number, frame?: XRFrame) => render(time, frame));
  window.addEventListener('resize', resize);
  // A visibility change between two frames makes the interval spanning it a pause.
  const markPerfPause = (): void => {
    perfWasHidden = true;
  };
  document.addEventListener('visibilitychange', markPerfPause);
  const onWheel = (event: WheelEvent): void => {
    if (warpEdit || renderer?.xr.isPresenting || !setPointerRay(event as unknown as PointerEvent))
      return;
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
    for (const panel of panels.values()) {
      const selected = panel.id === mutableState.selectedTerminalId;
      panel.frame.material.emissiveIntensity = selected ? SELECTED_FRAME_GLOW : 0;
      panel.frameAccent.material.color.setHex(selected ? 0xffffff : ACCENT);
      // The selected pane keeps a solid accent however far its glass is faded.
      panel.frameAccent.material.opacity = selected ? 1 : panel.opacity;
    }
  };
  const saveUIPose = (name: UIPoseName, object: THREE.Object3D): void => {
    if (!renderer || (!renderer.xr.isPresenting && !activeSession) || xrViewerPending) return;
    const saved = poseStore.save(name, captureUIPose(object));
    if (!saved && mutableState.notice !== 'UI position could not be saved on this device') {
      mutableState.notice = 'UI position could not be saved on this device';
      notify();
    }
  };
  // Only a user-placed keyboard persists; a system spawn is re-derived from the next session's input.
  const saveKeyboardPose = (root: THREE.Object3D): void => {
    if (!renderer || (!renderer.xr.isPresenting && !activeSession) || xrViewerPending) return;
    if (inputPoseSpawn) poseStore.forget('keyboard');
    else saveUIPose('keyboard', root);
  };
  // Ancestry, not stamped ids: nodes a widget adds after creation carry no widget metadata.
  const widgetOwning = (
    object: THREE.Object3D | null | undefined,
  ): [WidgetKey, Widget] | undefined => {
    for (let node = object; node; node = node.parent) {
      for (const entry of widgets) if (entry[1].root === node) return entry;
    }
    return undefined;
  };
  const placeWidget = (key: WidgetKey, widget: Widget): void => {
    const view = poseViewer();
    view.updateWorldMatrix(true, false);
    const eye = view.getWorldPosition(new THREE.Vector3());
    const forward = view.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    forward.normalize();
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.atan2(-forward.x, -forward.z),
    );
    const entry = getWidgetEntry(widgetKeyKind(key) ?? (key as WidgetKind));
    let offset = entry.spawnOffset;
    if (entry.multiInstance && widget.root.userData.picturePlaceholder) {
      offset = PICTURE_PLACEHOLDER_OFFSET;
      // An unmoved frame that filled an earlier placeholder still sits on this spot: give it a slot.
      for (const [otherKey, other] of widgets)
        if (other.root.userData.widgetSlot === PICTURE_PLACEHOLDER_SLOT) {
          delete other.root.userData.widgetSlot;
          placeWidget(otherKey, other);
          saveWidgetPose(otherKey, other);
        }
    } else if (entry.multiInstance) {
      if (typeof widget.root.userData.widgetSlot !== 'number')
        widget.root.userData.widgetSlot = freePictureSlot(
          [...widgets.values()]
            .filter((other) => other !== widget)
            .map((other) => other.root.userData.widgetSlot)
            .filter((slot): slot is number => typeof slot === 'number'),
        );
      offset = pictureSpawnOffset(entry.spawnOffset, widget.root.userData.widgetSlot);
    }
    const [x, y, z] = offset;
    widget.root.position.copy(new THREE.Vector3(x, y, z).applyQuaternion(rotation).add(eye));
    widget.root.quaternion.copy(rotation).multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        // Face the viewer from where this instance actually spawns (slot or placeholder).
        widgetSpawnYaw({ ...entry, spawnOffset: [x, y, z] }),
      ),
    );
    widget.root.scale.setScalar(
      widget.root.userData.picturePlaceholder ? PICTURE_PLACEHOLDER_SCALE : (entry.spawnScale ?? 1),
    );
  };
  const saveWidgetPose = (key: WidgetKey, widget: Widget): void => {
    // A placeholder's pose persists too, so a reload during the exit-to-pick flow keeps it.
    const pose: WidgetPose = captureUIPose(widget.root);
    if (widget.root.userData.widgetKind === PICTURE_KIND) {
      const slot = widget.root.userData.widgetSlot;
      if (typeof slot === 'number') pose.slot = slot;
      if (widget.root.userData.picturePlaced) pose.placed = true;
    }
    if (!widgetPoseStore.save(key, pose))
      setNotice('Widget position could not be saved on this device');
  };
  const removeWidget = (kind: WidgetKey, persist = true): void => {
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
    const pictureId = widget.root.userData.pictureId;
    if (persist && typeof pictureId === 'string' && !widget.root.userData.picturePlaceholder)
      options.onPictureClosed?.(pictureId);
    mutableState.widgets = [...widgets.keys()];
    if (!disposed && inputRoot && inputMode === 'widgets') refreshInputRoot('widgets');
    notify();
  };
  const mountWidget = (kind: WidgetKind, widget: Widget, place = true): WidgetKey => {
    const widgetId = String(widget.root.userData.widgetId ?? `widget-${kind}`);
    const key = widgetKey(kind, widgetId);
    touchedWidgets.add(key);
    widget.root.traverse((object) => {
      object.userData.widgetKind = kind;
      object.userData.widgetKey = key;
      object.userData.widgetId = widgetId;
      if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
    });
    widget.setAgentRoster?.(latestAgentRoster);
    widget.setBellFeed?.(bellFeed.entries());
    widgets.set(key, widget);
    scene.add(widget.root);
    if (place) placeWidget(key, widget);
    return key;
  };
  const addWidget = (kind: WidgetKind): Widget => {
    const widget = getWidgetEntry(kind).create(uiEnvironment.texture);
    mountWidget(kind, widget);
    return widget;
  };
  const releaseThumbnail = (image: PictureImage): void => {
    image.source.width = 0;
    image.source.height = 0;
  };
  /** Drops the gallery's decoded thumbnails; their textures went with the panel's disposal. */
  const releaseRecentPictures = (): void => {
    recentGeneration++;
    if (Array.isArray(recentPictures))
      for (const entry of recentPictures) releaseThumbnail(entry.thumbnail);
    recentPictures = 'loading';
  };
  const openPicturePanel = (mode: 'picture-url' | 'picture-gallery', target?: string): void => {
    pictureSession++;
    pictureTarget = target;
    picturePanelMessage = pictureBusy ? 'Loading… the current picture is still loading' : '';
    if (mode === 'picture-url') pictureUrl = { text: '', cursor: 0 };
    else {
      releaseRecentPictures();
      recentPage = 0;
      const generation = recentGeneration;
      const settle = (entries: ReadonlyArray<RecentPictureEntry> | null): void => {
        if (disposed || generation !== recentGeneration) {
          for (const entry of entries ?? []) releaseThumbnail(entry.thumbnail);
          return;
        }
        recentPictures = entries;
        if (inputRoot && inputMode === 'picture-gallery') refreshInputRoot('picture-gallery');
      };
      if (!options.pictures) recentPictures = null;
      else void options.pictures.listRecent().then(settle, () => settle(null));
    }
    clearArmedModifiers();
    showInput(mode);
  };
  /** Runs a pick from an XR picker panel; a failure keeps the panel open and the notice says why. */
  const runPicturePick = (
    mode: 'picture-url' | 'picture-gallery',
    pick: (picker: ScenePicturePicker) => Promise<boolean>,
    failure: string,
  ): void => {
    const picker = options.pictures;
    if (!picker) return;
    if (pictureBusy) {
      picturePanelMessage = 'Loading… the current picture is still loading';
      refreshInputRoot(mode);
      return;
    }
    pictureBusy = true;
    pictureNotice = null;
    const session = pictureSession;
    const target = pictureTarget;
    picturePanelMessage = mode === 'picture-url' ? 'Loading picture…' : 'Placing picture…';
    refreshInputRoot(mode);
    void pick(picker)
      .catch(() => false)
      .then((shown) => {
        pictureBusy = false;
        const notice = pictureNotice;
        pictureNotice = null;
        if (disposed) return;
        // A panel reopened for another frame during the load is left alone.
        const current = session === pictureSession;
        const open = current && Boolean(inputRoot) && inputMode === mode;
        if (shown) {
          if (pictureTarget === target) pictureTarget = undefined;
          if (current && mode === 'picture-url') pictureUrl = { text: '', cursor: 0 };
          if (open) hideInput();
          if (notice) setNotice(notice);
          return;
        }
        if (!open) {
          if (notice) setNotice(notice);
          return;
        }
        picturePanelMessage = notice ?? failure;
        refreshInputRoot(mode);
      });
  };
  const submitPictureUrl = (): void => {
    const url = pictureUrl.text.trim();
    if (!url) {
      picturePanelMessage = 'Type or paste an image URL';
      refreshInputRoot('picture-url');
      return;
    }
    const target = pictureTarget;
    runPicturePick(
      'picture-url',
      (picker) => picker.addUrl(url, target),
      'Could not load that URL',
    );
  };
  const placeRecentPicture = (id: string): void => {
    const target = pictureTarget;
    runPicturePick(
      'picture-gallery',
      (picker) => picker.placeRecent(id, target),
      'Could not place that picture',
    );
  };
  const pictureAnisotropy = (): number =>
    Math.min(mutableState.filtering.anisotropy, Number(scene.userData.maxAnisotropy ?? 1));
  const showPicture = (
    id: string,
    image: PictureImage,
    restore: boolean,
    target?: string,
    depth?: { depth?: PictureImage; depthView?: PictureDepthView },
  ): string[] => {
    if (disposed) return [];
    const key = widgetKey(PICTURE_KIND, id);
    if (widgets.has(key)) removeWidget(key, false);
    const targeted = target ? widgets.get(widgetKey(PICTURE_KIND, target)) : undefined;
    // A filled placeholder or a changed frame hands over its pose and spot.
    const placeholder = restore
      ? undefined
      : (targeted ??
        [...widgets.values()].reverse().find((entry) => entry.root.userData.picturePlaceholder));
    const widget = createPictureFrameWidget(uiEnvironment.texture, {
      id,
      image,
      anisotropy: pictureAnisotropy(),
      depth: depth?.depth,
      depthView: depth?.depthView,
      onDepthView: (view) => options.onPictureDepthView?.(id, view),
    });
    const saved = widgetPoseStore.read()[key];
    // A filled placeholder keeps its pose and spot and takes no slot.
    mountWidget(PICTURE_KIND, widget, !placeholder && !saved);
    if (placeholder) {
      widget.root.position.copy(placeholder.root.position);
      widget.root.quaternion.copy(placeholder.root.quaternion);
      widget.root.scale.copy(placeholder.root.scale);
      if (placeholder.root.userData.picturePlaced) widget.root.userData.picturePlaced = true;
      else if (placeholder.root.userData.picturePlaceholder)
        widget.root.userData.widgetSlot = PICTURE_PLACEHOLDER_SLOT;
      else if (typeof placeholder.root.userData.widgetSlot === 'number')
        widget.root.userData.widgetSlot = placeholder.root.userData.widgetSlot;
      removeWidget(String(placeholder.root.userData.widgetKey));
    } else if (saved) {
      // Only a grab marks a frame placed. An unmoved frame keeps its saved slot so new frames
      // spawn elsewhere and recenter can re-slot it; one with no free saved slot takes a new one.
      applyUIPose(widget.root, saved, [0.25, 2]);
      const taken = (slot: number): boolean =>
        slot !== PICTURE_PLACEHOLDER_SLOT &&
        [...widgets.values()].some(
          (other) => other !== widget && other.root.userData.widgetSlot === slot,
        );
      if (saved.placed) widget.root.userData.picturePlaced = true;
      else if (typeof saved.slot === 'number' && !taken(saved.slot))
        widget.root.userData.widgetSlot = saved.slot;
      else placeWidget(key, widget);
    }
    saveWidgetPose(key, widget);
    // The frame cap holds in the scene even when storage failed or is unavailable.
    const frames = [...widgets.entries()].filter(
      ([, entry]) =>
        entry.root.userData.widgetKind === PICTURE_KIND && !entry.root.userData.picturePlaceholder,
    );
    const evicted: string[] = [];
    for (const [oldKey, entry] of frames.slice(
      0,
      Math.max(0, frames.length - PICTURE_LIMITS.maxFrames),
    )) {
      evicted.push(String(entry.root.userData.pictureId));
      removeWidget(oldKey);
    }
    mutableState.widgets = [...widgets.keys()];
    notify();
    return evicted;
  };
  const toggleWidget = (kind: WidgetKind): void => {
    if (getWidgetEntry(kind).multiInstance) {
      // One placeholder at a time: asking again brings the open one back into view.
      const open = [...widgets.entries()].find(
        ([, entry]) =>
          entry.root.userData.widgetKind === kind && entry.root.userData.picturePlaceholder,
      );
      const [key, widget] = open ?? [undefined, addWidget(kind)];
      if (open) placeWidget(open[0], open[1]);
      saveWidgetPose(key ?? String(widget.root.userData.widgetKey), widget);
      mutableState.widgets = [...widgets.keys()];
      hideInput();
      notify();
      return;
    }
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
  const clearInputRoot = (preserveContact = false): void => {
    if (!preserveContact) resetHandContacts(false);
    pendingPaste.clear();
    if (!inputRoot) return;
    for (const [controller, drag] of [...dragStates])
      if (drag.object === inputRoot) releaseGrab(controller);
    pairGrabs.delete(inputRoot);
    for (const [controller, object] of hoveredByController)
      if (inputRoot.getObjectById(object.id)) hoveredByController.delete(controller);
    if (hoveredControl && inputRoot.getObjectById(hoveredControl.id)) showHover(null);
    if (hierarchyNavigator) {
      hierarchyNavigator.dispose();
      hierarchyNavigator.root.removeFromParent();
      hierarchyNavigator = null;
    }
    for (const [root, visible] of hierarchyHiddenPanels) root.visible = visible;
    hierarchyHiddenPanels.clear();
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
    templateHint = null;
    commandTool = 'run';
    commandsMessage = '';
    disarmCommand();
    clearArmedModifiers();
  };
  const disarmCommand = (): boolean => {
    if (armedTimer !== undefined) clearTimeout(armedTimer);
    armedTimer = undefined;
    const wasArmed = armedCommand !== null;
    armedCommand = null;
    return wasArmed;
  };
  const armCommand = (next: { id: string; action: string; kind: 'run' | 'remove' }): void => {
    disarmCommand();
    armedCommand = { ...next, at: Date.now() };
    cue('armed', lastSelectSource);
    armedTimer = setTimeout(() => {
      armedTimer = undefined;
      armedCommand = null;
      if (inputRoot && !disposed) refreshInputRoot(inputMode);
    }, CONFIRM_WINDOW_MS);
    if (inputRoot) refreshInputRoot(inputMode);
  };
  const isArmed = (id: string, action: string): boolean =>
    armedCommand?.id === id && armedCommand.action === action;
  const confirmTooSoon = (): boolean =>
    armedCommand !== null && Date.now() - armedCommand.at < CONFIRM_MIN_MS;
  const armedPreview = (action: string): string | null => {
    const armed = armedCommand;
    if (armed?.action !== action) return null;
    const command = [...menuCommands, ...stripCommands].find((item) => item.id === armed.id);
    if (!command) return null;
    const verb = armed.kind === 'remove' ? 'Removes' : 'Sends';
    return `${verb}: ${previewCommandText(command.text, XR_PREVIEW_LENGTH)}`;
  };
  let resetArmShown = false;
  const syncArmedControls = (): void => {
    const exit = hudRoot?.children.find((child) => child.userData.inputAction === 'exit') as
      | THREE.Mesh
      | undefined;
    if (exit) {
      const armed = armedControl?.action === 'exit';
      updateLabel(exit, CONFIRM_LABELS.exit[armed ? 1 : 0]);
      exit.userData.armed = armed || undefined;
      exit.userData.restColor = armed ? ARMED_TINT : undefined;
      const material = exit.material as THREE.MeshBasicMaterial;
      if (!hoveredByController.size || ![...hoveredByController.values()].includes(exit))
        material.color?.setHex(armed ? ARMED_TINT : 0xffffff);
    }
    const resetArmed = armedControl?.action === 'resetLayout';
    if (resetArmed === resetArmShown) return;
    resetArmShown = resetArmed;
    if (inputRoot && inputMode === 'arrange' && !disposed) refreshInputRoot('arrange');
  };
  const disarmControl = (): boolean => {
    if (armedControlTimer !== undefined) clearTimeout(armedControlTimer);
    armedControlTimer = undefined;
    if (!armedControl) return false;
    armedControl = null;
    syncArmedControls();
    return true;
  };
  const disarmPresses = (): void => {
    disarmControl();
    if (disarmCommand() && inputRoot && !disposed) refreshInputRoot(inputMode);
  };
  /** First press arms `action`; a second press inside the confirm window runs it. */
  const confirmControl = (action: ConfirmAction): boolean => {
    if (armedControl?.action === action) {
      if (Date.now() - armedControl.at < CONFIRM_MIN_MS) return false;
      disarmControl();
      return true;
    }
    disarmControl();
    armedControl = { action, at: Date.now() };
    armedControlTimer = setTimeout(() => {
      armedControlTimer = undefined;
      armedControl = null;
      if (!disposed) syncArmedControls();
    }, CONFIRM_WINDOW_MS);
    cue('armed', lastSelectSource);
    syncArmedControls();
    return false;
  };
  const commandButtonLabel = (command: QuickCommand, action: string): string =>
    isArmed(command.id, action)
      ? `${armedCommand?.kind === 'remove' ? 'Remove' : 'Run'} ${command.label}?`
      : isSharedCommand(command)
        ? `Shared · ${command.label}`
        : command.label;
  // Spawned surfaces follow the head's heading only, so opening one while looking down or up does
  // not bury it in the floor or tip it away.
  const viewHeading = (view: THREE.Object3D): THREE.Quaternion =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), viewYaw(view));
  // A grip can record a gamepad for a hand source, so only a non-hand gamepad means controllers.
  // Null while neither is tracked, so a brief tracking loss does not move spawned surfaces.
  const definiteInputKind = (): InputKind | null => {
    if (controllerRoots.some((root) => !activeHand(root) && controllerGamepads.has(root)))
      return 'controller';
    return controllerRoots.some((root) => activeHand(root)) ? 'hand' : null;
  };
  const HAND_KEYBOARD_OFFSET = new THREE.Vector3(0, -0.4, -0.45);
  const HAND_KEYBOARD_TILT = THREE.MathUtils.degToRad(-30);
  const resetInputPose = (): void => {
    inputTransform = null;
    if (!inputRoot) return;
    const view = trackedHead();
    view.updateMatrixWorld(true);
    const heading = viewHeading(view);
    const typing = isTypingMode(inputMode);
    const kind = definiteInputKind();
    inputPoseSpawn = { kind, typing };
    if (typing && kind === 'hand') {
      inputRoot.position
        .copy(HAND_KEYBOARD_OFFSET)
        .applyQuaternion(heading)
        .add(view.getWorldPosition(new THREE.Vector3()));
      inputRoot.quaternion
        .copy(heading)
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), HAND_KEYBOARD_TILT),
        );
    } else {
      inputRoot.position
        .set(0, -0.2, -1.15)
        .applyQuaternion(heading)
        .add(view.getWorldPosition(new THREE.Vector3()));
      inputRoot.quaternion.copy(heading);
    }
    inputRoot.scale.setScalar(0.38);
  };
  const respawnTypingForInputKind = (): void => {
    if (!inputRoot || !inputPoseSpawn?.typing || xrViewerPending) return;
    const kind = definiteInputKind();
    if (kind === null || kind === inputPoseSpawn.kind) return;
    if (inputPoseSpawn.kind === null) {
      inputPoseSpawn.kind = kind;
      return;
    }
    if (pairGrabs.has(inputRoot)) return;
    for (const drag of dragStates.values()) if (drag.object === inputRoot) return;
    resetInputPose();
  };
  const refreshInputRoot = (mode: InputMode): void => {
    if (mode !== 'picture-gallery' && inputMode === 'picture-gallery') releaseRecentPictures();
    if (mode !== 'warp') settleWarpPanel(false);
    if (mode !== inputMode) resetHandContacts(false);
    if (mode !== 'keyboard') templateHint = null;
    inputMode = mode;
    if (
      mode !== 'keyboard' &&
      ['listening', 'transcribing'].includes(mutableState.dictation.status)
    )
      actions.dictationAction?.('cancel');
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
    clearInputRoot(true);
    inputRoot = new THREE.Group();
    inputRoot.name = `xr-${mode}-controls`;
    inputRoot.userData.scaleLimits = [0.18, 0.9];
    if (inputPoseSpawn && !grabbedControllers.length && !previousPair) {
      const typing = isTypingMode(mode);
      const kind = definiteInputKind();
      if (
        inputPoseSpawn.typing !== typing ||
        (typing && kind !== null && inputPoseSpawn.kind !== null && kind !== inputPoseSpawn.kind)
      )
        inputTransform = null;
    }
    if (inputTransform) {
      inputRoot.position.copy(inputTransform.position);
      inputRoot.quaternion.copy(inputTransform.quaternion);
      inputRoot.scale.setScalar(inputTransform.scale);
    } else resetInputPose();
    if (!keyboardPoseRestored && isTypingMode(mode)) {
      const saved = poseStore.read('keyboard');
      if (saved && !previousRoot) {
        applyUIPose(inputRoot, saved, inputRoot.userData.scaleLimits as [number, number]);
        inputPoseSpawn = null;
      }
      keyboardPoseRestored = true;
    }
    for (const controller of grabbedControllers) {
      captureGrab(controller, inputRoot);
    }
    if (previousPair) beginPairGrab(inputRoot, ...previousPair.controllers);
    if (mode === 'commands') {
      const add = createLabelButton('New command', 0.5, 0.09, { inputAction: 'newCommand' });
      add.position.set(0, 0.7, 0);
      inputRoot.add(add);
    }
    if (mode === 'keyboard') {
      const backdropToggle = createLabelButton(
        `Backing: ${mutableState.keyboardBackgroundEnabled ? 'on' : 'off'}`,
        0.34,
        0.09,
        { inputAction: 'keyboardBackground' },
      );
      // Flanks the 0.9-wide target label (x -0.45..0.45) at its own height.
      backdropToggle.position.set(0.45 + 0.04 + 0.34 / 2, 0.56, 0);
      inputRoot.add(backdropToggle);
      const gazeToggle = createLabelButton(
        `Gaze input: ${mutableState.gazeInputEnabled ? 'on' : 'off'}`,
        0.5,
        0.09,
        { inputAction: 'gazeInput' },
      );
      gazeToggle.position.set(-(0.45 + 0.04 + 0.5 / 2), 0.56, 0);
      inputRoot.add(gazeToggle);
      const curvature = createLabelButton(
        `Keyboard curve: ${Math.round(mutableState.keyboardCurvature)}°`,
        0.8,
        0.09,
        { inputAction: 'noop' },
      );
      curvature.position.set(0, 0.7, 0);
      inputRoot.add(curvature);
      for (const direction of [-1, 1]) {
        const step = createLabelButton(direction < 0 ? '−' : '+', 0.16, 0.09, {
          inputAction: 'keyboardCurvature',
          delta: direction * 10,
        });
        step.position.set(direction * 0.52, 0.7, 0);
        inputRoot.add(step);
      }
      const dictation = mutableState.dictation;
      // The Keyborb Mic orb starts and stops dictation, so its panel keeps only the review buttons.
      if (!mutableState.keyborbEnabled || !dictation.supported) {
        const dictate = createLabelButton(
          dictation.status === 'transcribing'
            ? 'Transcribing…'
            : dictation.status === 'listening'
              ? 'Stop dictation'
              : dictation.supported
                ? 'Dictation'
                : 'Speech unavailable',
          0.7,
          0.1,
          {
            inputAction:
              dictation.supported && dictation.status !== 'transcribing' ? 'dictation' : 'noop',
            dictationAction: dictation.status === 'listening' ? 'stop' : 'start',
          },
        );
        dictate.name = 'xr-dictate-button';
        dictate.position.set(-0.42, 0.87, 0);
        inputRoot.add(dictate);
      }
      const paste = createLabelButton('Paste', 0.44, 0.1, { inputAction: 'pasteClipboard' });
      paste.position.set(-1, 0.87, 0);
      inputRoot.add(paste);
      // Flank the curvature row (its − and + end at x ±0.6) with the host clipboard actions.
      const hostPaste = createLabelButton('Paste host', 0.4, 0.09, {
        inputAction: 'pasteHostClipboard',
      });
      hostPaste.position.set(-0.85, 0.7, 0);
      const toHost = createLabelButton('Copy to host', 0.4, 0.09, { inputAction: 'copyToHost' });
      toHost.position.set(0.85, 0.7, 0);
      inputRoot.add(hostPaste, toHost);
      if (dictation.transcript && dictation.status !== 'listening') {
        const insert = createLabelButton('Insert text', 0.5, 0.1, {
          inputAction: 'dictation',
          dictationAction: 'insert',
        });
        insert.position.set(0.25, 0.87, 0);
        inputRoot.add(insert);
      }
      if (['review', 'error'].includes(dictation.status) && dictation.transcript.trim()) {
        const clear = createLabelButton('Clear', 0.38, 0.1, {
          inputAction: 'dictation',
          dictationAction: 'clear',
        });
        clear.position.set(1.17, 0.87, 0);
        inputRoot.add(clear);
      }
      if (dictation.status !== 'idle') {
        const cancel = createLabelButton('Cancel', 0.35, 0.1, {
          inputAction: 'dictation',
          dictationAction: 'cancel',
        });
        cancel.position.set(0.73, 0.87, 0);
        inputRoot.add(cancel);
        const transcript = createLabelButton(dictationCaption(), 1.85, 0.34, {
          inputAction: 'noop',
          wrap: true,
        });
        transcript.name = 'xr-dictation-transcript';
        transcript.position.set(0, 1.17, 0);
        inputRoot.add(transcript);
        // Sits over the transcript box's left edge, the box being 1.85 wide and 0.34 tall.
        const heading = createLabelButton('Transcript', 0.5, 0.1, { inputAction: 'noop' });
        heading.name = 'xr-dictation-transcript-heading';
        heading.position.set(-0.925 + 0.25, 1.17 + 0.17 + 0.06, 0);
        inputRoot.add(heading);
      }
    }
    const targetTitle = mutableState.inputTargetTitle
      ? `Target: ${mutableState.inputTargetTitle}`
      : 'No target selected';
    const title = createLabelButton(
      mode === 'picture-url'
        ? 'Picture URL'
        : mode === 'picture-gallery'
          ? 'Recent pictures'
          : mode === 'command-editor'
            ? commandEditorMessage ||
              (commandDraft?.editing ? 'Edit quick command' : 'New quick command')
            : mode === 'widgets'
              ? 'Widgets'
              : mode === 'settings'
                ? 'Settings'
                : mode === 'buttons'
                  ? 'Controller buttons'
                  : mode === 'display'
                    ? 'Display settings'
                    : mode === 'world'
                      ? 'World settings'
                      : mode === 'filtering'
                        ? 'Terminal filtering'
                        : mode === 'warp'
                          ? 'Terminal curvature'
                          : mode === 'arrange'
                            ? 'Arrange terminals'
                            : mode === 'panes'
                              ? `Mux tree · ${mutableState.hierarchyStyle === 'helix' ? 'Helix Navigator' : 'Spatial Docks'}`
                              : `${mode === 'commands' ? 'Quick commands' : mode === 'keyboard' ? (mutableState.keyborbEnabled ? 'Keyborb' : 'Keyboard') : 'Terminal settings'} · ${targetTitle}`,
      mode === 'panes' ? 1.8 : 0.9,
      0.12,
      { inputAction: 'grabInput' },
    );
    title.userData.dragHandle = true;
    title.position.y =
      mode === 'panes' ? 1.65 : mode === 'command-editor' || mode === 'picture-url' ? 0.88 : 0.56;
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
      const confirm = createLabelButton(
        `Confirm before running: ${commandDraft.confirm ? 'on' : 'off'}`,
        0.9,
        0.09,
        { inputAction: 'commandConfirm' },
      );
      confirm.position.set(0, 1.18, 0);
      inputRoot.add(scope, enter, save, clear, cancel, confirm);
    }
    if (mode === 'picture-url') {
      const value = Array.from(pictureUrl.text);
      const cursor = Math.min(pictureUrl.cursor, value.length);
      value.splice(cursor, 0, '|');
      const start = Math.max(0, cursor - 40);
      const field = createLabelButton(
        `URL: ${start ? '…' : ''}${value.slice(start, start + 64).join('')}`,
        1.5,
        0.12,
        { inputAction: 'noop', wrap: true },
      );
      field.name = 'xr-picture-url-field';
      field.position.y = 0.7;
      setModifierVisual(field, true);
      inputRoot.add(field);
      // Every action sits in one row above the field, so the panel ends at the keyboard's last
      // row and never reaches down over the HUD bar.
      for (const [label, inputAction, x] of [
        ['Paste', 'pasteClipboard', -1],
        ['Paste host', 'pasteHostClipboard', -0.6],
        [pictureBusy ? 'Loading…' : 'Load', pictureBusy ? 'noop' : 'pictureUrlLoad', -0.2],
        ['Clear', 'pictureUrlClear', 0.2],
        ['Recent', 'pictureRecent', 0.6],
      ] as const) {
        const button = createLabelButton(label, 0.36, 0.12, { inputAction });
        button.position.set(x, 1.04, 0);
        inputRoot.add(button);
      }
    }
    if ((mode === 'picture-url' || mode === 'picture-gallery') && picturePanelMessage) {
      const message = createLabelButton(picturePanelMessage, 1.5, 0.1, {
        inputAction: 'noop',
        wrap: true,
      });
      message.name = 'xr-picture-message';
      message.position.y = mode === 'picture-url' ? 0.56 : -0.6;
      inputRoot.add(message);
    }
    if (mode === 'settings') {
      for (const [index, [label, destination]] of (
        [
          ['Display', 'display'],
          ['World', 'world'],
          ['Selected terminal', 'terminal'],
          ['Controller buttons', 'buttons'],
        ] as const
      ).entries()) {
        const button = createLabelButton(label, 1.15, 0.13, {
          inputAction: 'openInput',
          mode: destination,
        });
        button.position.set(0, 0.36 - index * 0.17, 0);
        inputRoot.add(button);
      }
      const caption = createLabelButton('Keyborb keyboard', 1.15, 0.1, { inputAction: 'noop' });
      caption.position.y = -0.3;
      inputRoot.add(caption);
      for (const [index, keyborbMode] of (['off', 'on', 'auto'] as const).entries()) {
        const button = createLabelButton(
          keyborbMode[0].toUpperCase() + keyborbMode.slice(1),
          0.34,
          0.12,
          { inputAction: 'keyborbMode', keyborbMode },
        );
        button.position.set((index - 1) * 0.4, -0.44, 0);
        setModifierVisual(button, mutableState.keyborbMode === keyborbMode);
        inputRoot.add(button);
      }
      const help = createLabelButton('Auto: Keyborb with hand tracking', 1.6, 0.07, {
        inputAction: 'noop',
      });
      help.position.y = -0.56;
      inputRoot.add(help);
      const sounds = createLabelButton(
        `UI sounds: ${mutableState.uiSounds ? 'on' : 'off'}`,
        0.7,
        0.1,
        { inputAction: 'uiSounds' },
      );
      sounds.position.y = -0.71;
      setModifierVisual(sounds, mutableState.uiSounds);
      inputRoot.add(sounds);
    } else if (mode === 'world') {
      const backgroundSelect = createBackgroundSelect(mutableState.background, 'input');
      backgroundSelect.position.y = 0.25;
      inputRoot.add(backgroundSelect);
      for (const [index, [label, xrMode]] of (
        [
          ['VR', 'vr'],
          ['Passthrough', 'ar'],
        ] as const
      ).entries()) {
        const button = createLabelButton(label, 0.65, 0.12, { inputAction: 'xrMode', xrMode });
        button.position.set(index ? 0.38 : -0.38, -0.1, 0);
        setModifierVisual(button, mutableState.xrMode === xrMode);
        inputRoot.add(button);
      }
      for (const [row, [caption, action, current, empty]] of (
        [
          ['Hand color', 'handColor', mutableState.handColor, 'Default'],
          ['Arm color', 'armColor', mutableState.armColor, 'Match'],
        ] as const
      ).entries()) {
        const y = -0.25 - row * 0.24;
        const label = createLabelButton(caption, 0.6, 0.08, { inputAction: 'noop' });
        label.position.y = y;
        inputRoot.add(label);
        // Each swatch shows its own color; a white border marks the current one.
        for (const [index, { name, color }] of HAND_COLOR_PRESETS.entries()) {
          const swatch = createLabelButton(color ? name : empty, 0.2, 0.1, {
            inputAction: action,
            [action]: color,
            labelBackground: color || '#1c2a35',
            ...(current === color ? { labelBorder: '#ffffff' } : {}),
          });
          swatch.position.set((index - (HAND_COLOR_PRESETS.length - 1) / 2) * 0.23, y - 0.11, 0);
          inputRoot.add(swatch);
        }
      }
    } else if (mode === 'display') {
      (
        [
          ['Comfort', 'comfort'],
          ['Original', 'original'],
          ['Mono', 'monochrome'],
        ] as const
      ).forEach(([label, colorMode], index) => {
        const button = createLabelButton(label, 0.4, 0.12, {
          inputAction: 'terminalColors',
          colorMode,
        });
        button.position.set((index - 1) * 0.46, 0.25, 0);
        setModifierVisual(button, mutableState.terminalColorMode === colorMode);
        inputRoot?.add(button);
      });
      const filteringButton = createLabelButton('Filtering and gaze clarity', 1.3, 0.12, {
        inputAction: 'openInput',
        mode: 'filtering',
      });
      filteringButton.position.y = 0;
      inputRoot.add(filteringButton);
      const hierarchyStyle = createLabelButton(
        `Mux tree: ${mutableState.hierarchyStyle === 'helix' ? 'Helix Navigator' : 'Spatial Docks'}`,
        1.45,
        0.11,
        {
          inputAction: 'hierarchyStyle',
          hierarchyStyle: mutableState.hierarchyStyle === 'helix' ? 'spatial-docks' : 'helix',
        },
      );
      hierarchyStyle.position.y = -0.16;
      inputRoot.add(hierarchyStyle);
      const preferences = mutableState.windowPreferences;
      for (const [index, [preference, label, step]] of (
        [
          [
            'defaultOpacity',
            `New window glass: ${Math.round(preferences.defaultOpacity * 100)}%`,
            0.1,
          ],
          ['defaultCurvature', `New window warp: ${Math.round(preferences.defaultCurvature)}°`, 5],
          ['focusDistance', `Focus distance: ${preferences.focusDistance.toFixed(1)} m`, 0.1],
          ['focusCurvature', `Focus warp: ${Math.round(preferences.focusCurvature)}°`, 5],
        ] as const
      ).entries()) {
        const y = -0.32 - index * 0.13;
        const value = createLabelButton(label, 1.05, 0.1, { inputAction: 'noop' });
        value.position.set(0, y, 0);
        inputRoot.add(value);
        for (const direction of [-1, 1]) {
          const button = createLabelButton(direction < 0 ? '−' : '+', 0.12, 0.1, {
            inputAction: 'windowPreference',
            preference,
            delta: direction * step,
          });
          button.position.set(direction * 0.65, y, 0);
          inputRoot.add(button);
        }
      }
      const stripSide = preferences.scrollStripSide;
      const stripSideButton = createLabelButton(
        `Scroll strip: ${stripSide === 'both' ? 'both sides' : stripSide}`,
        1.05,
        0.1,
        {
          inputAction: 'scrollStripSide',
          scrollStripSide:
            SCROLL_STRIP_SIDES[
              (SCROLL_STRIP_SIDES.indexOf(stripSide) + 1) % SCROLL_STRIP_SIDES.length
            ],
        },
      );
      stripSideButton.position.set(0, -0.84, 0);
      inputRoot.add(stripSideButton);
      const frameChinButton = createLabelButton(
        `Frame chin: ${preferences.frameChin ? 'on' : 'off'}`,
        1.05,
        0.1,
        { inputAction: 'frameChin' },
      );
      frameChinButton.position.set(0, -0.97, 0);
      inputRoot.add(frameChinButton);
    } else if (mode === 'buttons') {
      const map = mutableState.windowPreferences.buttonMap;
      for (const [index, button] of CONTROLLER_BUTTONS.entries()) {
        const row = createLabelButton(
          `${CONTROLLER_BUTTON_LABELS[button]}: ${BUTTON_FUNCTION_LABELS[map[button]]}`,
          1.05,
          0.11,
          { inputAction: 'buttonMapNext', controllerButton: button },
        );
        row.position.set(0, 0.32 - index * 0.15, 0);
        inputRoot.add(row);
      }
      const reset = createLabelButton('Reset buttons', 0.6, 0.1, { inputAction: 'buttonMapReset' });
      reset.position.set(0, -0.32, 0);
      inputRoot.add(reset);
      const hint = createLabelButton(
        'While warping, right A saves and right B cancels',
        1.4,
        0.07,
        {
          inputAction: 'noop',
        },
      );
      hint.position.y = -0.46;
      inputRoot.add(hint);
    } else if (mode === 'arrange') {
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
      const resetArmed = armedControl?.action === 'resetLayout';
      const reset = createLabelButton(CONFIRM_LABELS.resetLayout[resetArmed ? 1 : 0], 0.65, 0.1, {
        inputAction: 'resetLayout',
        ...(resetArmed ? ARMED_STYLE : {}),
      });
      reset.position.y = -0.45;
      inputRoot.add(reset);
    } else if (mode === 'panes') {
      for (const panel of panels.values()) {
        hierarchyHiddenPanels.set(panel.root, panel.root.visible);
        panel.root.visible = false;
      }
      hierarchyNavigator = createHierarchyNavigator(
        availablePanes,
        mutableState.hierarchyStyle,
        hierarchyNavigation,
        new Set(panels.keys()),
        uiEnvironment.texture,
        () => paneCreation,
        () => agentRoster,
        () => agentRosterRows,
      );
      hierarchyNavigation = {
        path: hierarchyNavigator.root.userData.hierarchyPath as string[],
        page: hierarchyNavigator.root.userData.hierarchyPage as number,
      };
      inputRoot.add(hierarchyNavigator.root);
      hierarchyNavigator.root.userData.transitioning = hierarchyNavigator.transitioning;
    } else if (mode === 'commands') {
      const commandStart = commandPage * 8;
      menuCommands.slice(commandStart, commandStart + 8).forEach((command, index) => {
        const button = createLabelButton(commandButtonLabel(command, 'command'), 0.7, 0.11, {
          inputAction: 'command',
          commandId: command.id,
          ...(command.pinned ? { pinned: true, labelBorder: PINNED_BORDER } : {}),
          ...(isArmed(command.id, 'command') ? ARMED_STYLE : {}),
        });
        const row = Math.floor(index / 2);
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
      COMMAND_TOOLS.forEach(([tool, label], index) => {
        const button = createLabelButton(label, 0.36, 0.09, { inputAction: 'commandTool', tool });
        button.position.set((index - (COMMAND_TOOLS.length - 1) / 2) * 0.4, -0.22, 0);
        setModifierVisual(button, commandTool === tool);
        inputRoot?.add(button);
      });
      const preview = armedPreview('command');
      const message = preview ?? (commandsMessage || COMMAND_TOOL_HINTS[commandTool]);
      if (message) {
        const status = createLabelButton(message, 1.1, 0.08, { inputAction: 'noop' });
        status.name = preview ? 'xr-command-preview' : 'xr-commands-message';
        status.position.set(0, -0.33, 0);
        inputRoot.add(status);
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
      if (target && surface) {
        const panel = panels.get(target);
        const zoom = Number(panel?.root.userData.fontZoom ?? 1);
        const textSize = createLabelButton(`Text zoom: ${Math.round(zoom * 100)}%`, 1.05, 0.08, {
          inputAction: 'noop',
        });
        textSize.position.y = -0.34;
        inputRoot.add(textSize);
        for (const direction of [-1, 1]) {
          const button = createLabelButton(direction < 0 ? '−' : '+', 0.15, 0.09, {
            inputAction: 'fontZoom',
            terminalId: target,
            direction,
          });
          button.position.set(direction * 0.7, -0.34, 0);
          inputRoot.add(button);
        }
        const opacity = getTerminalOpacity(target);
        const glass = createLabelButton(`Glass opacity: ${Math.round(opacity * 100)}%`, 1.1, 0.08, {
          inputAction: 'noop',
        });
        glass.position.y = -0.48;
        inputRoot.add(glass);
        for (const [index, delta] of [-0.1, 0.1].entries()) {
          const button = createLabelButton(delta < 0 ? '−' : '+', 0.15, 0.09, {
            inputAction: 'glassOpacity',
            delta,
          });
          button.position.set(index ? 0.7 : -0.7, -0.48, 0);
          inputRoot.add(button);
        }
        const reset = createLabelButton('Reset to defaults', 1.1, 0.09, {
          inputAction: 'resetTerminalAppearance',
        });
        reset.position.y = -0.62;
        inputRoot.add(reset);
      }
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
      for (const [index, action] of (['warpCancel', 'warpDone'] as const).entries()) {
        const button = createLabelButton(index ? 'Done' : 'Cancel', 0.7, 0.12, {
          inputAction: action,
        });
        button.position.set(index ? 0.4 : -0.4, -0.54, 0);
        inputRoot.add(button);
      }
    } else if (mode === 'picture-gallery') {
      const entries = recentPictures;
      if (!Array.isArray(entries) || entries.length === 0) {
        const status = createLabelButton(
          entries === 'loading'
            ? 'Loading…'
            : entries === null
              ? 'Recent pictures need browser storage'
              : 'No recent pictures yet',
          1.3,
          0.1,
          { inputAction: 'noop' },
        );
        status.name = 'xr-recent-status';
        status.position.y = 0.1;
        inputRoot.add(status);
      } else {
        const pages = Math.ceil(entries.length / RECENT_PAGE_SIZE);
        recentPage = Math.max(0, Math.min(pages - 1, recentPage));
        const first = recentPage * RECENT_PAGE_SIZE;
        entries.slice(first, first + RECENT_PAGE_SIZE).forEach((entry, index) => {
          // Tiles are 0.4 x 0.28 panel units (15 x 11 cm at the 0.38 spawn scale), 0.07 and 0.06 apart.
          const x = ((index % 3) - 1) * 0.47;
          const y = 0.28 - Math.floor(index / 3) * 0.36;
          const { width, height, source } = entry.thumbnail;
          const fit = Math.min(0.4 / width, 0.28 / height);
          const texture = new THREE.CanvasTexture(source);
          texture.colorSpace = THREE.SRGBColorSpace;
          const tile = new THREE.Mesh(
            new THREE.PlaneGeometry(width * fit, height * fit),
            new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
          );
          tile.name = 'xr-recent-thumbnail';
          Object.assign(tile.userData, {
            inputAction: 'pictureRecentPlace',
            recentId: entry.id,
            helpText: `Put ${entry.name} in the frame`,
          });
          tile.position.set(x, y, 0);
          const remove = createLabelButton('×', 0.12, 0.12, {
            inputAction: 'pictureRecentRemove',
            recentId: entry.id,
          });
          remove.name = 'xr-recent-remove';
          remove.userData.helpText = `Remove ${entry.name} from Recent`;
          // Centred on the thumbnail's top-right corner: pinch-sized (0.12 is 46 mm) while covering
          // only 0.06 of the thumbnail's width, under a third of a 3:4 portrait.
          remove.position.set(x + (width * fit) / 2, y + (height * fit) / 2, 0.01);
          inputRoot?.add(tile, remove);
        });
        if (pages > 1) {
          const caption = createLabelButton(`${recentPage + 1} / ${pages}`, 0.3, 0.09, {
            inputAction: 'noop',
          });
          caption.position.y = -0.3;
          inputRoot.add(caption);
          for (const [label, delta, x] of [
            ['Prev', -1, -0.5],
            ['Next', 1, 0.5],
          ] as const) {
            const page = createLabelButton(label, 0.34, 0.12, {
              inputAction: (delta < 0 ? recentPage > 0 : recentPage < pages - 1)
                ? 'pictureRecentPage'
                : 'noop',
              delta,
            });
            page.position.set(x, -0.3, 0);
            inputRoot.add(page);
          }
        }
      }
      const enterUrl = createLabelButton('Enter URL', 0.5, 0.12, { inputAction: 'pictureUrl' });
      // Shares the bottom row with Close, keeping the panel short and clear of the HUD bar.
      enterUrl.position.set(-0.3, -0.46, 0);
      inputRoot.add(enterUrl);
    } else if (mode === 'widgets') {
      const layout = layoutWidgetPanel(WIDGET_REGISTRY.length, widgetsPage);
      widgetsPage = layout.page;
      layout.buttons.forEach((rect, index) => {
        const { kind, displayName } = WIDGET_REGISTRY[layout.first + index];
        const button = createLabelButton(
          (widgets.has(kind) && !getWidgetEntry(kind).multiInstance ? 'Hide ' : 'Add ') +
            displayName,
          rect.width,
          rect.height,
          { inputAction: 'toggleWidget', widgetKind: kind },
        );
        button.position.set(rect.x, rect.y, 0);
        inputRoot?.add(button);
      });
      if (layout.pager) {
        const { prev, caption, next } = layout.pager;
        const pageLabel = createLabelButton(
          `${layout.page + 1} / ${layout.pages}`,
          caption.width,
          caption.height,
          { inputAction: 'noop' },
        );
        pageLabel.position.set(caption.x, caption.y, 0);
        inputRoot.add(pageLabel);
        for (const [label, delta, rect] of [
          ['Prev', -1, prev],
          ['Next', 1, next],
        ] as const) {
          const enabled = delta < 0 ? layout.page > 0 : layout.page < layout.pages - 1;
          const button = createLabelButton(label, rect.width, rect.height, {
            inputAction: enabled ? 'widgetsPage' : 'noop',
            delta,
          });
          button.position.set(rect.x, rect.y, 0);
          button.visible = enabled;
          inputRoot.add(button);
        }
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
      for (const [slot, key] of keyboardKeys.entries()) {
        const label =
          key.key.length === 1 && key.key !== ' '
            ? terminalKeyLabel(key.key, Boolean(modifierState.active.shift))
            : key.label;
        const button = mutableState.keyborbEnabled
          ? createKeyborbKey(label, unit - 0.025)
          : createLabelButton(label, key.width * unit - 0.014, key.height * unit - 0.03, {
              key: key.key,
            });
        if (mutableState.keyborbEnabled) button.userData.keyborbSlot = slot;
        Object.assign(button.userData, {
          inputAction: 'key',
          key: key.key,
          modifier: key.modifier,
          helpText: getControlHelp({ inputAction: 'key', key: key.key, modifier: key.modifier }),
        });
        button.position.set(
          (key.x + key.width / 2 - keyboardDimensions.width / 2) * unit,
          0.48 - (key.y + key.height / 2) * unit,
          mutableState.keyborbEnabled ? (unit - 0.025) / 2 + 0.003 : 0,
        );
        inputRoot.add(button);
      }
      // Keyborb panel buttons sit out of pinch reach, so dictation gets its own orb in the top row.
      const dictation = mutableState.dictation;
      if (mutableState.keyborbEnabled && mode === 'keyboard' && dictation.supported) {
        const listening = dictation.status === 'listening';
        const transcribing = dictation.status === 'transcribing';
        const mic = createKeyborbKey(
          transcribing ? '...' : listening ? 'Stop' : 'Mic',
          unit - 0.025,
        );
        mic.name = 'keyborb-dictation';
        Object.assign(mic.userData, {
          keyborbSlot: keyboardKeys.length,
          inputAction: transcribing ? 'noop' : 'dictation',
          dictationAction: listening ? 'stop' : 'start',
        });
        mic.userData.helpText = transcribing
          ? 'Transcribing your dictation'
          : getControlHelp(mic.userData);
        if (listening) {
          mic.userData.restColor = 0xff7373;
          (mic.material as THREE.Material & { color: THREE.Color }).color.setHex(0xff7373);
        }
        mic.position.set(
          (KEYBORB_DICTATION_COLUMN + 0.5 - keyboardDimensions.width / 2) * unit,
          0.48 - 0.5 * unit,
          (unit - 0.025) / 2 + 0.003,
        );
        inputRoot.add(mic);
      }
      if (mutableState.keyborbEnabled) {
        const orbs = inputRoot.children.filter(
          (child): child is THREE.Mesh => child.userData.keyborb === true,
        );
        const shells = createKeyborbShells(orbs);
        inputRoot.add(shells.mesh);
        inputRoot.userData.keyborbShells = shells;
        const glyphs = createKeyborbGlyphs(orbs);
        glyphs.batch.userData.disposeBatch = () => glyphs.batch.dispose();
        inputRoot.add(glyphs.batch);
        inputRoot.userData.keyborbGlyphs = glyphs;
      }
    }
    const terminalHasReset = Boolean(
      mutableState.inputTargetId && panels.has(mutableState.inputTargetId),
    );
    const close = createLabelButton('Close', 0.3, 0.09, { inputAction: 'close' });
    close.position.set(
      mode === 'panes' ? -1.2 : 0,
      mode === 'panes'
        ? -0.9
        : mode === 'display'
          ? -1.13
          : mode === 'settings'
            ? -0.89
            : mode === 'world' || (mode === 'terminal' && terminalHasReset)
              ? -0.78
              : -0.66,
      0,
    );
    if (mode === 'picture-gallery') close.position.set(0.3, -0.46, 0);
    if (mode === 'picture-url') close.position.set(1, 1.04, 0);
    if (mode === 'widgets') {
      const { x, y } = layoutWidgetPanel(WIDGET_REGISTRY.length, widgetsPage).close;
      close.position.set(x, y, 0);
    }
    inputRoot.add(close);
    if (['terminal', 'display', 'world', 'filtering', 'buttons'].includes(mode)) {
      close.position.x = 0.22;
      const back = createLabelButton('Back', 0.3, 0.09, {
        inputAction: 'openInput',
        mode: mode === 'filtering' ? 'display' : 'settings',
      });
      back.position.set(
        -0.22,
        mode === 'display'
          ? -1.13
          : mode === 'world' || (mode === 'terminal' && terminalHasReset)
            ? -0.78
            : -0.66,
        0,
      );
      inputRoot.add(back);
    }
    if (mode === 'panes') {
      inputRoot.updateMatrixWorld(true);
      hierarchyNavigator?.update(0, renderer?.xr.isPresenting ? renderer.xr.getCamera() : camera);
      scene.add(inputRoot);
      return;
    }
    if (mode === 'keyboard') {
      const stacked: THREE.Mesh[][] = [];
      if (stripCommands.length)
        stacked.push(
          stripCommands.map((command) =>
            createLabelButton(commandButtonLabel(command, 'stripCommand'), 0.44, 0.09, {
              inputAction: 'stripCommand',
              commandId: command.id,
              ...(isArmed(command.id, 'stripCommand') ? ARMED_STYLE : {}),
            }),
          ),
        );
      if (templateHint) {
        const hint = createLabelButton(`Then type: ${templateHint}`, 1.4, 0.09, {
          inputAction: 'noop',
        });
        hint.name = 'xr-template-hint';
        stacked.push([hint]);
      }
      const preview = armedPreview('stripCommand');
      if (preview) {
        const line = createLabelButton(preview, 1.4, 0.09, { inputAction: 'noop' });
        line.name = 'xr-command-preview';
        stacked.push([line]);
      }
      stackAboveControls(inputRoot, stacked);
    }
    if (isTypingMode(mode))
      for (const child of inputRoot.children) {
        const action = child.userData.inputAction;
        if (
          (child as THREE.Mesh).isMesh &&
          action &&
          !['noop', 'grabInput', 'key'].includes(action) &&
          !child.userData.keyborb
        )
          raisePanelButton(child as THREE.Mesh);
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
    const keyboardRadians = isTypingMode(mode)
      ? THREE.MathUtils.degToRad(mutableState.keyboardCurvature)
      : 0;
    const backing = new THREE.Mesh(
      keyboardRadians
        ? createCurvedTerminalGeometry({
            width: size.x + 0.12,
            height: size.y + 0.12,
            radians: keyboardRadians,
          })
        : new THREE.PlaneGeometry(size.x + 0.12, size.y + 0.12),
      new THREE.MeshBasicMaterial({ color: 0x0d1720 }),
    );
    backing.position.copy(center);
    backing.position.z = -0.015;
    backing.name = 'input-backdrop';
    if (keyboardRadians) backing.material.depthWrite = false;
    if (isTypingMode(mode) && !mutableState.keyboardBackgroundEnabled) {
      backing.material.transparent = true;
      backing.material.opacity = 0;
      backing.material.depthWrite = false;
    }
    backing.userData.inputAction = 'grabInput';
    backing.userData.helpText = getControlHelp({ inputAction: 'grabInput' });
    inputRoot.add(backing);
    if (keyboardRadians) curveKeyboardContent(inputRoot, size.x + 0.12, keyboardRadians);
    const walls = createRaisedButtonWalls(inputRoot, BUTTON_WALL_COLOR);
    if (walls) inputRoot.add(walls);
    restorePanelPresses(inputRoot);
    scene.add(inputRoot);
    syncModifierVisuals();
  };
  const syncKeyborb = (): void => {
    if (disposed) return;
    const handTrackingActive = Boolean(
      renderer?.xr.isPresenting &&
        controllerRoots.some(
          (root) => !disconnectedControllers.has(root) && root.userData.inputSourceHand,
        ),
    );
    const enabled = keyborbEnabled(mutableState.keyborbMode, handTrackingActive);
    if (enabled === mutableState.keyborbEnabled) return;
    resetHandContacts(false);
    mutableState.keyborbEnabled = enabled;
    if (inputRoot && isTypingMode(inputMode)) refreshInputRoot(inputMode);
    notify();
  };
  const createHud = (): void => {
    hudRoot = new THREE.Group();
    hudRoot.name = 'xr-workspace-hud';
    hudRoot.userData.scaleLimits = [0.25, 1.4];
    hudRoot.position.set(0, 0.78, -1.35);
    hudRoot.scale.setScalar(0.62);
    const totalWidth = 1.6;
    activePaneLabel = createLabelButton('No active pane', 1.1, 0.09, { inputAction: 'noop' });
    activePaneLabel.name = 'xr-active-pane';
    activePaneLabel.position.x = -0.2;
    const exit = createLabelButton('Exit', 0.27, 0.09, { inputAction: 'exit' });
    exit.position.x = 0.57;
    hudRoot.add(activePaneLabel, exit);
    toastLabel = createLabelButton(mutableState.toast ?? '', 1.4, 0.09, {
      inputAction: 'noop',
      wrap: true,
    });
    toastLabel.name = 'xr-clipboard-toast';
    toastLabel.raycast = () => undefined;
    toastLabel.position.set(0, 0.45, 0);
    toastLabel.visible = Boolean(mutableState.toast);
    hudRoot.add(toastLabel);
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
    fpsLabel.position.set(0.6, 0.13, 0);
    hudRoot.add(fpsLabel);
    keyLabel = createLabelButton('', 0.6, 0.075, { inputAction: 'noop' });
    keyLabel.name = 'xr-last-key';
    keyLabel.raycast = () => undefined;
    keyLabel.position.set(0, -0.12, 0);
    keyLabel.visible = false;
    hudRoot.add(keyLabel);
    for (const overlay of [
      toastLabel,
      updateNotice,
      statusNotice,
      statusDismiss,
      fpsLabel,
      keyLabel,
    ])
      setHudOverlay(overlay, HUD_OVERLAY_RENDER_ORDER);
    scene.add(hudRoot);
  };
  const setKeyIndicator = (text: string | null): void => {
    if (!keyLabel) return;
    keyLabel.visible = text !== null;
    if (text !== null) updateLabel(keyLabel, text);
  };
  const isTextEntryActive = (): boolean =>
    inputRoot !== null &&
    ((inputMode === 'command-editor' && commandDraft !== null) || inputMode === 'picture-url');
  /** Picture controller notices: held for the open picker panel during its pick, else the HUD. */
  const notifyPicture = (message: string): void => {
    if (
      pictureBusy &&
      inputRoot &&
      (inputMode === 'picture-url' || inputMode === 'picture-gallery')
    )
      pictureNotice = pictureNotice ? `${pictureNotice}. ${message}` : message;
    else setNotice(message);
  };
  /** A physical key typed while the picture URL field is open; true when the field took it. */
  const typeTextEntryKey = (key: string): boolean => {
    if (!inputRoot || inputMode !== 'picture-url') return false;
    if (key === 'Enter') submitPictureUrl();
    else if (key === 'Escape') hideInput();
    else {
      if (key.length !== 1 && !PICTURE_URL_EDIT_KEYS.has(key)) return false;
      const draft = editCommandDraft(
        { ...createCommandDraft('picture-url'), label: pictureUrl.text, cursor: pictureUrl.cursor },
        key,
      );
      pictureUrl = { text: draft.label, cursor: draft.cursor };
      picturePanelMessage = '';
      refreshInputRoot('picture-url');
    }
    return true;
  };
  const setUpdateAvailable = (available: boolean): void => {
    if (mutableState.updateAvailable === available) return;
    mutableState.updateAvailable = available;
    radialMenu.setUpdateAvailable(available);
    wristWatch.setUpdateAvailable(available);
    if (updateNotice) updateNotice.visible = available && Boolean(renderer?.xr.isPresenting);
    notify();
  };
  const setNotice = (message: string | null, options: NoticeOptions = {}): void => {
    if (message && options.feed) bellFeed.pushNotice(message);
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
    floorCorrectionPending = true;
    correctTerminalFloor();
    rememberTerminalPlacements();
  };
  const scaleSelectedPanel = (direction: number): void => {
    const selected = mutableState.selectedTerminalId;
    const panel = selected ? panels.get(selected) : undefined;
    if (panel) resizePanel(panel, direction);
  };
  const handleInputTarget = (hit: THREE.Object3D): boolean => {
    const action = hit.userData.inputAction as string | undefined;
    const keepArmed =
      !action ||
      action === 'noop' ||
      action === 'grabInput' ||
      (armedCommand !== null && isArmed(String(hit.userData.commandId), action));
    const root = inputRoot;
    if (!keepArmed && armedControl && armedControl.action !== action) disarmControl();
    const disarmed = !keepArmed && disarmCommand();
    const handled = handleInputTargetAction(hit);
    if (disarmed && inputRoot && inputRoot === root) refreshInputRoot(inputMode);
    return handled;
  };
  const handleInputTargetAction = (hit: THREE.Object3D): boolean => {
    const action = hit.userData.inputAction as string | undefined;
    if (action === 'scrollStrip') return true;
    if (action === 'keyborbMode') {
      setKeyborbMode(validateKeyborbMode(hit.userData.keyborbMode));
      return true;
    }
    if (action === 'handColor') {
      setHandColor(String(hit.userData.handColor ?? '') || null);
      return true;
    }
    if (action === 'armColor') {
      setArmColor(String(hit.userData.armColor ?? '') || null);
      return true;
    }
    if (action === 'uiSounds') {
      setUISounds(!mutableState.uiSounds);
      return true;
    }
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
    if (action === 'bringHere') {
      const paneId = hit.userData.terminalId as string | undefined;
      if (paneId) bringTerminalHere(paneId);
      return true;
    }
    if (action === 'keepHere') {
      keepFocusPlacement();
      return true;
    }
    if (action === 'grabInput') return true;
    if (action === 'pictureUrl' || action === 'pictureRecent') {
      const owner = widgetOwning(hit)?.[1].root;
      const choices = owner?.getObjectByName('picture-change-choices');
      if (choices) choices.visible = false;
      const id = owner?.userData.pictureId;
      openPicturePanel(
        action === 'pictureUrl' ? 'picture-url' : 'picture-gallery',
        typeof id === 'string' ? id : pictureTarget,
      );
      return true;
    }
    if (action === 'pictureChange') {
      const choices = widgetOwning(hit)?.[1].root.getObjectByName('picture-change-choices');
      if (choices) choices.visible = !choices.visible;
      return true;
    }
    if (action === 'pictureUrlLoad') {
      submitPictureUrl();
      return true;
    }
    if (action === 'pictureUrlClear') {
      pictureUrl = { text: '', cursor: 0 };
      picturePanelMessage = '';
      refreshInputRoot('picture-url');
      return true;
    }
    if (action === 'widgetsPage') {
      widgetsPage += Number(hit.userData.delta) || 0;
      refreshInputRoot('widgets');
      return true;
    }
    if (action === 'pictureRecentPage') {
      recentPage += Number(hit.userData.delta) || 0;
      refreshInputRoot('picture-gallery');
      return true;
    }
    if (action === 'pictureRecentPlace') {
      placeRecentPicture(String(hit.userData.recentId));
      return true;
    }
    if (action === 'pictureRecentRemove') {
      const id = String(hit.userData.recentId);
      const picker = options.pictures;
      if (!picker) return true;
      void picker.removeRecent(id).then((removed) => {
        if (disposed || !inputRoot || inputMode !== 'picture-gallery') return;
        if (removed && Array.isArray(recentPictures)) {
          for (const entry of recentPictures)
            if (entry.id === id) releaseThumbnail(entry.thumbnail);
          recentPictures = recentPictures.filter((entry) => entry.id !== id);
          showToast('Removed from Recent.');
        } else if (!removed) picturePanelMessage = 'Could not remove that picture from Recent';
        refreshInputRoot('picture-gallery');
      });
      return true;
    }
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
      [
        'commandField',
        'commandScope',
        'commandNewline',
        'commandConfirm',
        'commandClear',
        'commandSave',
      ].includes(action)
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
      else if (action === 'commandConfirm') commandDraft.confirm = !commandDraft.confirm;
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
          snapshotMenuCommands();
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
    if (action === 'hierarchyNode') {
      if (hierarchyNavigator?.transitioning) return true;
      hierarchyNavigation = {
        path: Array.isArray(hit.userData.hierarchyPath)
          ? hit.userData.hierarchyPath.filter(
              (part: unknown): part is string => typeof part === 'string',
            )
          : [],
        page: Number(hit.userData.hierarchyPage) || 0,
      };
      if (hierarchyNavigator) {
        hierarchyNavigator.navigate(hierarchyNavigation);
        hierarchyNavigator.root.userData.transitioning = hierarchyNavigator.transitioning;
      } else refreshInputRoot('panes');
      return true;
    }
    if (action === 'pasteClipboard') {
      if (!renderer?.xr.isPresenting) void pasteClipboard();
      return true;
    }
    if (action === 'pasteHostClipboard') {
      void pasteHostClipboard();
      return true;
    }
    if (action === 'copyToHost') {
      // In a session the native select event, which carries user activation, runs this instead.
      if (!renderer?.xr.isPresenting) void copyQuestToHost();
      return true;
    }
    if (action === 'hierarchyStyle') {
      setHierarchyStyle(validateHierarchyStyle(hit.userData.hierarchyStyle));
      return true;
    }
    if (action === 'keyboardCurvature') {
      setKeyboardCurvature(mutableState.keyboardCurvature + Number(hit.userData.delta));
      return true;
    }
    if (action === 'dictation') {
      actions.dictationAction?.(hit.userData.dictationAction as DictationAction);
      return true;
    }
    if (radialMenu.root.visible && !radialMenu.interactive) return true;
    if (action === 'radialAction') {
      const choice = hit.userData.radialAction as RadialMenuAction;
      radialMenu.close();
      mutableState.radialOpen = false;
      if (choice === 'keyboard') toggleKeyboard();
      else if (choice === 'focus') toggleFocusMode(radialTargetId ?? undefined);
      else if (choice === 'warp') {
        if (radialController && activeHand(radialController)) showInput('warp', radialController);
        else startWarp(radialTargetId, radialController);
      } else if (choice !== 'cancel') showInput(choice === 'layout' ? 'arrange' : choice);
      notify();
      return true;
    }
    if (action === 'resetTerminalAppearance') {
      const id = mutableState.inputTargetId;
      if (id) resetTerminalAppearance(id);
      return true;
    }
    if (action === 'glassOpacity') {
      const id = mutableState.inputTargetId;
      if (id) setTerminalOpacity(id, getTerminalOpacity(id) + Number(hit.userData.delta));
      return true;
    }
    if (action === 'windowPreference') {
      const preference = hit.userData.preference as
        | 'defaultOpacity'
        | 'defaultCurvature'
        | 'focusDistance'
        | 'focusCurvature';
      if (
        ['defaultOpacity', 'defaultCurvature', 'focusDistance', 'focusCurvature'].includes(
          preference,
        )
      )
        setWindowPreferences({
          ...mutableState.windowPreferences,
          [preference]: mutableState.windowPreferences[preference] + Number(hit.userData.delta),
        });
      return true;
    }
    if (action === 'scrollStripSide') {
      setWindowPreferences({
        ...mutableState.windowPreferences,
        scrollStripSide: hit.userData.scrollStripSide as ScrollStripSide,
      });
      return true;
    }
    if (action === 'buttonMapNext') {
      const button = hit.userData.controllerButton as ControllerButton;
      const map = mutableState.windowPreferences.buttonMap;
      if (CONTROLLER_BUTTONS.includes(button))
        setWindowPreferences({
          ...mutableState.windowPreferences,
          buttonMap: { ...map, [button]: nextButtonFunction(map[button]) },
        });
      return true;
    }
    if (action === 'buttonMapReset') {
      setWindowPreferences({
        ...mutableState.windowPreferences,
        buttonMap: { ...DEFAULT_BUTTON_MAP },
      });
      return true;
    }
    if (action === 'frameChin') {
      setWindowPreferences({
        ...mutableState.windowPreferences,
        frameChin: !mutableState.windowPreferences.frameChin,
      });
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
    if (action === 'xrMode') {
      const mode = hit.userData.xrMode as 'vr' | 'ar';
      if (mutableState.xrMode !== mode) {
        void (async (): Promise<void> => {
          try {
            await exitXR();
            actions.setXREntryMode?.(mode);
            setNotice(`Press ${mode === 'ar' ? 'Enter passthrough' : 'Enter VR'} to continue`);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : 'XR mode could not be changed');
          }
        })();
      }
      return true;
    }
    if (action === 'resetLayout') {
      if (!confirmControl('resetLayout')) return true;
      resetLayout();
      cue('recenter', lastSelectSource);
      return true;
    }
    if (action === 'exit') {
      if (!confirmControl('exit')) return true;
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
      if (isWidgetKind(hit.userData.widgetKind)) toggleWidget(hit.userData.widgetKind);
      return true;
    }
    if (action === 'closeWidget') {
      const kind = widgetOwning(hit)?.[0];
      if (kind) removeWidget(kind);
      return true;
    }
    if (action === 'widgetControl') {
      widgetOwning(hit)?.[1].activate?.(hit);
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
          warpPanelEdit?.id !== id,
        );
      return true;
    }
    if (action === 'warpDone' || action === 'warpCancel') {
      settleWarpPanel(action === 'warpDone');
      hideInput();
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
      if (radialMenu.root.visible) {
        radialMenu.close();
        mutableState.radialOpen = false;
      }
      actions.reloadApp?.();
      return true;
    }
    if (action === 'fontZoom') {
      const panel = panels.get(String(hit.userData.terminalId ?? mutableState.inputTargetId ?? ''));
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
        if (inputRoot && inputMode === 'terminal') refreshInputRoot('terminal');
      }
      return true;
    }
    if (action === 'createPane') {
      if (hierarchyNavigator?.transitioning) return true;
      if (!hit.userData.createAvailable) {
        setNotice(
          typeof hit.userData.helpText === 'string'
            ? hit.userData.helpText
            : 'Terminal creation is unavailable.',
        );
        return true;
      }
      if (typeof hit.userData.sessionId === 'string') actions.createPane?.(hit.userData.sessionId);
      return true;
    }
    if (action === 'selectAgentPane') {
      const paneId = hit.userData.agentPaneId;
      if (typeof paneId === 'string' && availablePanes.some((pane) => pane.id === paneId))
        actions.selectPane(paneId);
      else setNotice('That agent pane is no longer open');
      return true;
    }
    if (action === 'selectBellPane') {
      const paneId = hit.userData.bellPaneId;
      if (typeof paneId !== 'string') return true;
      bellFeed.clearPane(paneId);
      if (availablePanes.some((pane) => pane.id === paneId)) actions.selectPane(paneId);
      else setNotice('That bell pane is no longer open');
      return true;
    }
    if (action === 'pane') {
      if (hierarchyNavigator?.transitioning) return true;
      const paneId = hit.userData.paneId as string;
      if (availablePanes.some((pane) => pane.id === paneId)) {
        actions.selectPane(paneId);
        hideInput();
      }
      return true;
    }
    if (action === 'commandPage') {
      commandPage = (commandPage + 1) % Math.max(1, Math.ceil(menuCommands.length / 8));
      refreshInputRoot(inputMode);
      return true;
    }
    if (action === 'key' && inputMode === 'picture-url') {
      const key = String(hit.userData.key);
      const modifier = hit.userData.modifier as KeyboardModifier | undefined;
      if (modifier) modifierState.tap(modifier);
      else if (key === 'Enter') {
        submitPictureUrl();
        return true;
      } else if (key === 'Escape') {
        hideInput();
        return true;
      } else {
        const draft = editCommandDraft(
          {
            ...createCommandDraft('picture-url'),
            label: pictureUrl.text,
            cursor: pictureUrl.cursor,
          },
          key,
          modifierState.active,
        );
        pictureUrl = { text: draft.label, cursor: draft.cursor };
        consumeArmedModifiers();
      }
      picturePanelMessage = '';
      refreshInputRoot('picture-url');
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
    if (
      action === 'key' &&
      inputMode === 'keyboard' &&
      (mutableState.dictation.status === 'review' ||
        (mutableState.dictation.status === 'error' && mutableState.dictation.transcript))
    ) {
      const key = String(hit.userData.key);
      const characters = Array.from(mutableState.dictation.transcript);
      if (key === 'Enter') actions.dictationAction?.('insert');
      else if (key === 'Escape') actions.dictationAction?.('cancel');
      else if (hit.userData.modifier) {
        modifierState.tap(hit.userData.modifier as KeyboardModifier);
        syncModifierVisuals();
      } else {
        dictationCursor = Math.max(0, Math.min(characters.length, dictationCursor));
        if (key === 'ArrowLeft') dictationCursor = Math.max(0, dictationCursor - 1);
        else if (key === 'ArrowRight')
          dictationCursor = Math.min(characters.length, dictationCursor + 1);
        else if (key === 'ArrowUp') dictationCursor = Math.max(0, dictationCursor - 36);
        else if (key === 'ArrowDown')
          dictationCursor = Math.min(characters.length, dictationCursor + 36);
        else if (key === 'Home') dictationCursor = 0;
        else if (key === 'End') dictationCursor = characters.length;
        else if (key === 'Backspace' && dictationCursor > 0)
          characters.splice(--dictationCursor, 1);
        else if (key === 'Delete') characters.splice(dictationCursor, 1);
        else if (key.length === 1) {
          characters.splice(
            dictationCursor++,
            0,
            terminalKeyLabel(key, Boolean(modifierState.active.shift)),
          );
          consumeArmedModifiers();
        }
        actions.editDictation?.(characters.join(''));
      }
      return true;
    }
    if (
      action === 'key' &&
      inputMode === 'keyboard' &&
      ['listening', 'transcribing'].includes(mutableState.dictation.status)
    )
      return true;
    if (action === 'commandTool') {
      const tool = hit.userData.tool as CommandTool;
      commandTool = commandTool === tool ? 'run' : tool;
      commandsMessage = '';
      refreshInputRoot('commands');
      return true;
    }
    if (action === 'command' && commandTool !== 'run') {
      const command = menuCommands.find((item) => item.id === hit.userData.commandId);
      if (command) manageCommand(command, action);
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
      if (command) activateCommand(command, paneId, action);
    } else if (action === 'stripCommand') {
      const command = stripCommands.find((item) => item.id === hit.userData.commandId);
      if (command) activateCommand(command, paneId, action);
    }
    return true;
  };
  const manageCommand = (command: QuickCommand, action: string): void => {
    commandsMessage = '';
    if (isSharedCommand(command)) commandsMessage = 'Shared commands are read-only';
    else if (commandTool === 'pin') {
      if (actions.saveCommand?.({ ...copyCommand(command), pinned: !command.pinned }))
        snapshotMenuCommands();
      else commandsMessage = 'Could not save on this device';
    } else if (commandTool === 'edit') {
      commandDraft = draftFromCommand(command);
      commandWorkspaceId =
        command.workspaceId ??
        availablePanes.find((pane) => pane.id === mutableState.inputTargetId)?.workspaceId;
      commandEditorMessage = '';
      commandTool = 'run';
      clearArmedModifiers();
      refreshInputRoot('command-editor');
      return;
    } else if (commandTool === 'remove') {
      if (!isArmed(command.id, action)) {
        armCommand({ id: command.id, action, kind: 'remove' });
        return;
      }
      if (confirmTooSoon()) return;
      disarmCommand();
      if (actions.removeCommand?.(command.id)) {
        snapshotMenuCommands();
        commandPage = Math.min(commandPage, Math.max(0, Math.ceil(menuCommands.length / 8) - 1));
        commandsMessage = `Removed ${command.label}`;
      } else commandsMessage = 'Could not remove on this device';
    }
    refreshInputRoot('commands');
  };
  const activateCommand = (command: QuickCommand, paneId: string, action: string): void => {
    if (command.confirm && !isArmed(command.id, action)) {
      armCommand({ id: command.id, action, kind: 'run' });
      return;
    }
    if (command.confirm && confirmTooSoon()) return;
    const wasArmed = disarmCommand();
    const root = inputRoot;
    runMenuCommand(command, paneId);
    if (wasArmed && inputRoot && inputRoot === root) refreshInputRoot(inputMode);
  };
  const runMenuCommand = (command: QuickCommand, paneId: string): void => {
    actions.runCommand(command, paneId);
    const template = splitTemplate(command.text);
    if (!template) return;
    templateHint = template.suffix || null;
    clearArmedModifiers();
    if (renderer?.xr.isPresenting) refreshInputRoot('keyboard');
    else showInput('keyboard');
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
      radialMenu.root,
      ...[...widgets.values()].map((widget) => widget.root),
    ]) {
      if (!root) continue;
      root.getWorldPosition(reachPosition);
      reach = Math.max(reach, raycaster.ray.origin.distanceTo(reachPosition) + 3 * root.scale.x);
    }
    raycaster.far = Math.min(camera.far, reach);
    const targets = [...panels.values()].filter(isPanelShown).map((panel) => panel.root);
    if (inputRoot) targets.push(inputRoot);
    if (hudRoot) targets.push(hudRoot);

    for (const widget of widgets.values()) targets.push(widget.root);
    if (radialMenu.root.visible) {
      targets.length = 0;
      targets.push(radialMenu.root);
    }
    if (wristWatch.root.visible) targets.push(wristWatch.root);
    const hits = intersectVisible(raycaster, targets).filter((entry) =>
      isControlVisible(entry.object),
    );
    // Only HUD controls drawn over widgets (hudOverlay) win the ray past a nearer widget; a
    // control the widget hides, such as Exit, must never fire through it.
    const hudButton =
      hudRoot && widgetOwning(hits[0]?.object)
        ? hits.find(
            (entry) =>
              entry.object.userData.hudOverlay === true &&
              hudRoot?.getObjectById(entry.object.id) &&
              !PASSIVE_ACTIONS.has(String(entry.object.userData.inputAction)),
          )
        : undefined;
    const intersection = hudButton ?? hits[0];
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
    const owner = widgetOwning(hit)?.[1].root;
    if (owner)
      return { terminalId: mutableState.focusedTerminalId ?? '', kind: 'keyboard', object: owner };
    let current: THREE.Object3D | null = hit;
    while (current && !current.userData.terminalId) current = current.parent;
    const terminalId = current?.userData.terminalId as string | undefined;
    if (!terminalId) return null;
    const key = hit.userData.key as string | undefined;
    return { terminalId, kind: key ? 'key' : 'terminal', object: hit, uv: intersection?.uv };
  };
  const targetFromController = (root: THREE.Group, updateWorld = true): InputTarget | null => {
    if (controllerRayBlocked(root)) {
      root.userData.rayDistance = 0;
      return null;
    }
    if (updateWorld) updateVisibleMatrixWorld(scene);
    tempMatrix.identity().extractRotation(root.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(root.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix).normalize();
    const target = targetFromRay();
    root.userData.rayDistance = Math.max(0.02, lastRayDistance);
    return target;
  };
  const activateTarget = (target: InputTarget | null): void => {
    if (warpEdit) {
      const action = target?.object?.userData.inputAction;
      if (action !== 'exit') return;
      finishWarp(false);
    }
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
    try {
      handleControllerSelect(controller);
    } finally {
      lastSelectSource = null;
    }
  };
  const handleControllerSelect = (controller: THREE.Group): void => {
    const target = targetFromController(controller);
    const action = target?.object?.userData.inputAction as string | undefined;
    lastSelectSource = controller;
    const cues = cueCount;
    const clicks =
      target?.object?.userData.key !== undefined || (action && !PASSIVE_ACTIONS.has(action));
    // These controls bypass handleInputTarget, which is where other presses disarm.
    if (action === 'wristMenu' || action === 'scrollStrip') disarmPresses();
    if (action === 'wristMenu') {
      if (clicks) cue('select', controller);
      if (controllerHandedness.get(controller) === 'left') toggleWristMenu(controller);
      return;
    }
    if (warpEdit) {
      activateTarget(target);
      if (clicks) pressCue(controller, action, cues);
      return;
    }
    if (target && action === 'scrollStrip') {
      startStripScroll(controller, target);
      showHover(null);
      return;
    }
    const modifiers = Object.keys(modifierState.active).length
      ? { ...modifierState.active }
      : undefined;
    activateTarget(target);
    if (clicks) {
      pressCue(controller, action, cues);
      pressPanelButton(target?.object);
    }
    beginModifierPress(controller, target);
    if (!startMouse(controller, target, 0, modifiers)) startTextSelection(controller, target);
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
        new THREE.SphereGeometry(CURSOR_RADIUS, 8, 6),
        new THREE.MeshBasicMaterial({ color: ACCENT }),
      );
      contact.raycast = () => undefined;
      contact.visible = false;
      root.add(rayLine, contact);
      pointerParts.push(rayLine, contact);
      const onSelect = (): void => {
        if (!root.visible || disconnectedControllers.has(root) || gripActive()) return;
        if (activeHand(root) && mutableState.keyborbEnabled) {
          if (!sampleHand(root)?.tracked) return;
          const blocked = suppressKeyboardRays();
          const target = blocked ? null : targetFromController(root);
          if (
            !priorityHandActions.has(String(target?.object?.userData.inputAction)) &&
            (target?.object?.userData.keyborb || keyborbInput.near(root) || blocked)
          ) {
            const mode = inputMode;
            const targetId = mutableState.inputTargetId;
            updateKeyborbInput(0);
            if (mode !== inputMode || targetId !== mutableState.inputTargetId) return;
            const key = keyborbInput.nativePress(
              root,
              target?.object?.userData.keyborb ? (target.object as THREE.Mesh) : null,
            );
            if (key?.userData.modifier) pressKeyborb(root, key);
            else if (key) showHover(null);
            return;
          }
        }
        if (!activeHand(root) && suppressKeyboardRays()) {
          const key = keyborbInput.hovered(root);
          if (key) pressKeyborb(root, key, false);
          return;
        }
        if (!handSelectionAllowed(root)) return;
        if (!root.visible || suppressKeyboardRays()) return;
        if (
          heldControllers.has(root) ||
          controllerGamepads.get(root)?.buttons[1]?.pressed ||
          disconnectedControllers.has(root)
        )
          return;
        const pressedAction = targetFromController(root)?.object?.userData.inputAction;
        if (pressedAction === 'pasteClipboard')
          pendingPaste.set(
            root,
            inputMode === 'picture-url'
              ? PICTURE_URL_PASTE
              : (mutableState.inputTargetId ?? mutableState.selectedTerminalId),
          );
        else if (pressedAction === 'copyToHost') pendingPaste.set(root, COPY_TO_HOST);
        onControllerSelect(root);
      };
      const onSelectEnd = (): void => {
        const lost = Boolean(activeHand(root) && !sampleHand(root)?.tracked);
        // The headset can report the release during a tracking gap while Keyborb still holds the key.
        if (keyborbInput.nativeRelease(root)) {
          const key = keyborbInput.commit(root);
          if (key && keyborbKeyboard()) commitKeyborb(root, key);
          pokeSources.delete(root);
          modifierPresses.delete(root);
        }
        stripScrolls.delete(root);
        if (lost) return;
        pendingPaste.delete(root);
        if (!pokeSources.has(root)) modifierPresses.delete(root);
        if (mouseCaptures.has(root) && !gripActive()) {
          moveMouse(root, targetFromController(root));
        }
        releaseMouse(root);
        // A cancelled XR gesture emits selectend without the user-activation select event.
        if (textSelection?.source === root && textSelection.phase === 'dragging')
          cancelTextSelection();
      };
      const onSelectComplete = (): void => {
        if (!handSelectionAllowed(root)) return;
        if (!root.visible || suppressKeyboardRays()) return;
        if (pendingPaste.has(root)) {
          const id = pendingPaste.get(root);
          pendingPaste.delete(root);
          if (id === COPY_TO_HOST) {
            if (
              !gripActive() &&
              !disconnectedControllers.has(root) &&
              targetFromController(root)?.object?.userData.inputAction === 'copyToHost'
            )
              void copyQuestToHost(root);
            return;
          }
          if (
            !gripActive() &&
            !disconnectedControllers.has(root) &&
            id &&
            targetFromController(root)?.object?.userData.inputAction === 'pasteClipboard'
          )
            void pasteClipboard(id, root);
          return;
        }
        copyTextSelection(root);
      };
      const onSqueeze = (event: Event, contactObject?: THREE.Group): void => {
        if (activeHand(root) && !sampleHand(root)?.pinching) return;
        if (
          !root.visible ||
          disconnectedControllers.has(root) ||
          (heldControllers.has(root) && !contactGripArmed.has(root))
        )
          return;
        const wasNearKeyboard = suppressKeyboardRays();
        const oldInputRoot = inputRoot;
        resetHandContact(root, true, true);
        if (contactObject && contactObject === oldInputRoot) contactObject = inputRoot ?? undefined;
        contactObject ??= contactGripTarget(root) ?? undefined;
        pendingPaste.delete(root);
        releaseAllMouse();
        modifierPresses.clear();
        heldControllers.add(root);
        if (radialMenu.root.visible && !radialMenu.interactive) return;
        const target = contactObject || wasNearKeyboard ? null : targetFromController(root);
        const hierarchy = hierarchyGrab(root, contactObject, target);
        if (hierarchy.pane) {
          contactGripArmed.delete(root);
          startPanePull(root, hierarchy.pane, Boolean(target?.object));
          cue('grab', root);
          return;
        }
        let object: THREE.Group | null =
          contactObject ?? (hierarchy.tree ? (inputRoot ?? null) : null);
        if (
          !object &&
          target &&
          target.kind === 'keyboard' &&
          inputRoot &&
          target.object &&
          inputRoot.getObjectById(target.object.id)
        )
          object = inputRoot;
        else if (!object && target?.object && radialMenu.root.getObjectById(target.object.id))
          object = radialMenu.root;
        else if (!object && hudRoot && target?.object && hudRoot.getObjectById(target.object.id))
          object = hudRoot;
        else if (!object && widgetOwning(target?.object)) {
          object = widgetOwning(target?.object)?.[1].root ?? null;
        } else if (!object && target?.terminalId && target.object) {
          const panel = panels.get(target.terminalId);
          if (panel?.root.getObjectById(target.object.id)) object = panel.root;
        }
        if (!object) {
          contactGripArmed.add(root);
          return;
        }
        contactGripArmed.delete(root);
        paneFocus.cancelMotion(object);
        if (object.userData.terminalId) selectTerminal(object.userData.terminalId as string);
        const other = [...dragStates.entries()].find(
          ([controller, drag]) => controller !== root && drag.object === object,
        )?.[0];
        if (!controllerGamepads.has(root)) {
          const gamepad = (event as Event & { data?: { gamepad?: Gamepad } }).data?.gamepad;
          if (gamepad) controllerGamepads.set(root, gamepad);
        }
        captureGrab(root, object, !contactObject && Boolean(target?.object));
        cue('grab', root);
        if (other) {
          captureGrab(other, object);
          beginPairGrab(object, other, root);
        }
      };
      const onSqueezeEnd = (): void => {
        contactGripArmed.delete(root);
        const object = dragStates.get(root)?.object;
        heldControllers.delete(root);
        releaseGrab(root);
        if (object && panePulls.has(object)) {
          finishPanePull(root, object);
          return;
        }
        if (object) cue('release', root);
        if (object && ![...dragStates.values()].some((drag) => drag.object === object)) {
          if (object === hudRoot) saveUIPose('hud', object);
          else if (object === inputRoot && isTypingMode(inputMode)) saveKeyboardPose(object);
          if (object.userData.terminalId) rememberTerminalPlacements();
          if (object.userData.widgetKey) {
            const kind = object.userData.widgetKey as WidgetKey;
            const widget = widgets.get(kind);
            if (widget) saveWidgetPose(kind, widget);
          }
        }
      };
      const onConnected = (event: Event): void => {
        onDisconnected();
        handTrackingLost.delete(root);
        handInputStates.set(root, { pinching: false, neutral: false, tracked: false });
        disconnectedControllers.delete(root);
        rayLine.visible = true;
        const data = (
          event as Event & { data?: { gamepad?: Gamepad; handedness?: string; hand?: unknown } }
        ).data;
        const gamepad = data?.hand ? undefined : data?.gamepad;
        root.userData.inputSourceHand = data?.hand;
        controllerHandedness.set(root, data?.handedness ?? 'none');
        if (gamepad?.buttons[4]?.pressed) radialButtonDown.add(root);
        else radialButtonDown.delete(root);
        if (gamepad?.buttons[5]?.pressed) focusButtonDown.add(root);
        else focusButtonDown.delete(root);
        if (gamepad) controllerGamepads.set(root, gamepad);
        syncKeyborb();
      };
      const onDisconnected = (): void => {
        resetHandContact(root);
        contactGripArmed.delete(root);
        if (controllerHandedness.get(root) === 'right') wristWatch.setVisible(false);
        wristWatch.updateTouch(null);
        handVisuals.get(root)?.hide();
        delete root.userData.inputSourceHand;
        handTrackingLost.delete(root);
        handInputStates.set(root, { pinching: false, neutral: false, tracked: false });
        pendingPaste.delete(root);
        if (textSelection?.source === root) cancelTextSelection(undefined, true);
        if (warpEdit?.controller === root) finishWarp(false);
        releaseMouse(root);
        modifierPresses.delete(root);
        radialButtonDown.delete(root);
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
        syncKeyborb();
      };
      const eventRoot = root as unknown as EventRoot;
      const onPoseEvent = (): void => {
        handPosedAt.delete(root);
      };
      // Registered first so every handler below sees the event's fresh hand pose.
      for (const type of POSE_EVENTS) eventRoot.addEventListener(type, onPoseEvent);
      eventRoot.addEventListener('selectstart', onSelect);
      eventRoot.addEventListener('selectend', onSelectEnd);
      eventRoot.addEventListener('select', onSelectComplete);
      eventRoot.addEventListener('squeezestart', onSqueeze);
      const onNativeSqueezeEnd = (): void => {
        if (activeHand(root) && sampleHand(root)?.pinching) return;
        onSqueezeEnd();
      };
      eventRoot.addEventListener('squeezeend', onNativeSqueezeEnd);
      eventRoot.addEventListener('connected', onConnected);
      eventRoot.addEventListener('disconnected', onDisconnected);
      controllerRoots.push(root);
      controllerListeners.push({
        root,
        onSelect,
        onSelectEnd,
        onSelectComplete,
        onSqueeze,
        onSqueezeEnd: onNativeSqueezeEnd,
        onConnected,
        onDisconnected,
        onPoseEvent,
      });
      scene.add(root);
      handGrabActions.set(root, {
        grab: (object) => onSqueeze(new Event('squeezestart'), object),
        release: onSqueezeEnd,
      });
      handContacts.set(root, createHandContact());
      keyboardProximity.set(root, createHandContact());
      const visual = createStandardHand();
      visual.setColor(mutableState.handColor || null, mutableState.armColor || null);
      handVisuals.set(root, visual);
      scene.add(visual.root);
      if (typeof renderer.xr.getControllerGrip === 'function') {
        const grip = renderer.xr.getControllerGrip(i);
        controllerGrips.set(root, grip);
        scene.add(grip);
      }
      if (typeof renderer.xr.getHand === 'function') {
        const hand = renderer.xr.getHand(i);
        handRoots.set(root, hand);
        handInputStates.set(root, { pinching: false, neutral: false, tracked: false });
        scene.add(hand);
      }
    }
  };
  setupControllers();
  const syncPanelFrame = (panel: TerminalPanel): void => {
    const span = {
      width: panel.width,
      height: panel.height,
      radians: THREE.MathUtils.degToRad(Math.max(0, panel.geometryCurvature)),
    };
    const options = { chin: mutableState.windowPreferences.frameChin };
    panel.frame.geometry.dispose();
    panel.frame.geometry = createTerminalFrameGeometry(span, options);
    panel.frameAccent.geometry.dispose();
    panel.frameAccent.geometry = createTerminalFrameAccentGeometry(span, options);
  };
  const syncPanelGrid = (panel: TerminalPanel): void => {
    const width = (PANEL_WIDTH * panel.surface.cols) / 80;
    const height = (PANEL_HEIGHT * panel.surface.rows) / 24;
    const curvature = panel.focusCurvature ?? panel.curvature;
    if (width === panel.width && height === panel.height && curvature === panel.geometryCurvature)
      return;
    panel.width = width;
    panel.height = height;
    panel.geometryCurvature = curvature;
    const radians = THREE.MathUtils.degToRad(curvature);
    const span = { width, height, radians };
    const bent = radians > 0;
    panel.root.userData.curvatureDegrees = curvature;
    panel.root.userData.curvatureDepth = getTerminalWarpBounds(span).depth;
    panel.screen.geometry.dispose();
    panel.screen.geometry = bent
      ? createCurvedTerminalGeometry(span)
      : new THREE.PlaneGeometry(width, height);
    syncPanelFrame(panel);
    panel.titleLabel.position.y = height / 2 + 0.07;
    panel.bellLabel.position.set(0.58, height / 2 + 0.07, 0.02);
    panel.connectionButton.position.set(0.24, -(height / 2 + 0.24), 0.02);
    panel.closeButton.position.set(-0.24, -(height / 2 + 0.24), 0.02);
    // At the pane's left edge, never closer to centre than the spot beside Close.
    panel.bringButton.position.set(Math.min(-width / 2 + 0.18, -0.66), -(height / 2 + 0.24), 0.02);
    const followCurve = (object: THREE.Object3D): void => {
      const flatX = object.position.x;
      const point = terminalWarpPoint(flatX, span);
      object.position.x = point.x;
      object.position.z = 0.02 + point.z;
      object.rotation.y = radians ? -(flatX / width) * radians : 0;
    };
    const stripOffset = width / 2 + 0.0175 + 0.008 + SCROLL_STRIP_WIDTH / 2;
    for (const [side, strip] of Object.entries(panel.scrollStrips)) {
      strip.geometry.dispose();
      strip.geometry = new THREE.PlaneGeometry(SCROLL_STRIP_WIDTH, height);
      strip.position.set(side === 'left' ? -stripOffset : stripOffset, 0, 0);
      followCurve(strip);
    }
    followCurve(panel.connectionButton);
    followCurve(panel.closeButton);
    followCurve(panel.bringButton);
    floorCorrectionPending = true;
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
      createTerminalFrameGeometry(
        { width: PANEL_WIDTH, height: PANEL_HEIGHT, radians: 0 },
        { chin: mutableState.windowPreferences.frameChin },
      ),
      applyUIEnvironment(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.62,
          metalness: 0.35,
          emissive: ACCENT,
          emissiveIntensity: 0,
          side: THREE.DoubleSide,
          // Under glass opacity the default back-then-front pair marks the material changed
          // twice per draw. One pass measured 0 front and 5 back pixels of difference at 0.5.
          forceSinglePass: true,
        }),
        uiEnvironment.texture,
      ),
    );
    frame.name = 'terminal-frame';
    frame.position.z = -0.025;
    // Controller rays reach the pane every frame; the bezel has over 1,500 triangles.
    frame.raycast = clusteredRaycast;
    root.add(frame);
    const frameAccent = new THREE.Mesh(
      createTerminalFrameAccentGeometry(
        { width: PANEL_WIDTH, height: PANEL_HEIGHT, radians: 0 },
        { chin: mutableState.windowPreferences.frameChin },
      ),
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        side: THREE.DoubleSide,
        // Unlit uniform colour blends identically in any order, so the back-then-front pass is
        // wasted. Revisit if the accent gains a texture, vertex colours or lighting.
        forceSinglePass: true,
      }),
    );
    frameAccent.name = 'terminal-frame-accent';
    frameAccent.raycast = () => undefined;
    frame.add(frameAccent);
    const createScrollStrip = (name: string): ScrollStripMesh => {
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(SCROLL_STRIP_WIDTH, PANEL_HEIGHT),
        new THREE.MeshBasicMaterial({
          color: ACCENT,
          transparent: true,
          opacity: SCROLL_STRIP_OPACITY,
          depthWrite: false,
          side: THREE.DoubleSide,
          // A flat unlit plane blends identically in one pass. The default back-then-front pair
          // also marks the material changed twice per draw, rebuilding its program parameters.
          forceSinglePass: true,
        }),
      );
      strip.name = name;
      Object.assign(strip.userData, {
        inputAction: 'scrollStrip',
        terminalId: surface.pane.id,
        excludeFromBounds: true,
        helpText: getControlHelp({ inputAction: 'scrollStrip' }),
      });
      // The three grip marks share one mesh, one draw instead of three.
      const marks = [-0.025, 0, 0.025].map((offset) =>
        new THREE.PlaneGeometry(SCROLL_STRIP_WIDTH * 0.5, 0.006).translate(0, offset, 0),
      );
      const grip = new THREE.Mesh(
        mergeGeometries(marks),
        new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.7 }),
      );
      for (const mark of marks) mark.dispose();
      grip.name = 'terminal-scroll-strip-grip';
      grip.position.z = 0.001;
      grip.userData.excludeFromBounds = true;
      grip.raycast = () => undefined;
      strip.add(grip);
      root.add(strip);
      return strip;
    };
    const scrollStrips = {
      right: createScrollStrip('terminal-scroll-strip'),
      left: createScrollStrip('terminal-scroll-strip-left'),
    };
    root.userData.fontZoom = 1;
    const titleLabel = createLabelButton(
      paneHeading(surface.pane.title, surface.status, surface.process, surface.error, 28),
      0.92,
      0.08,
      {
        terminalId: surface.pane.id,
        terminalTitle: true,
      },
    );
    titleLabel.userData.helpText = surface.error ?? titleLabel.userData.helpText;
    titleLabel.position.set(0, 0.47, 0.02);
    const bellLabel = createScalableLabel('BELL', 0.18, 0.08, {
      background: '#302718',
      border: '#e4a84a',
    });
    Object.assign(bellLabel.userData, {
      terminalId: surface.pane.id,
      terminalTitle: true,
      helpText: 'Bell pending. Select this pane to clear it.',
    });
    bellLabel.name = 'terminal-bell-indicator';
    bellLabel.userData.helpText = 'Bell pending. Select this pane to clear it.';
    bellLabel.position.set(0.58, 0.47, 0.02);
    bellLabel.visible = Boolean(surface.bellPending);
    if (surface.bellPending) bellFeed.pushBell(surface.pane.id, surface.pane.title);
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
    const bringButton = createLabelButton('Bring here', 0.36, 0.08, {
      inputAction: 'bringHere',
      terminalId: surface.pane.id,
      excludeFromBounds: true,
    });
    root.add(titleLabel, bellLabel, connectionButton, closeButton, bringButton);
    const panel: TerminalPanel = {
      id: surface.pane.id,
      surface,
      root,
      screen,
      texture,
      textureSource,
      frame,
      frameAccent,
      scrollStrips,
      unsubscribe: () => undefined,
      defaultPosition,
      titleLabel,
      bellLabel,
      connectionButton,
      closeButton,
      bringButton,
      width: PANEL_WIDTH,
      height: 0,
      revision: surface.revision,
      status: String(surface.status),
      heldBadge: processBadge(surface.process, surface.status) ?? '',
      title: surface.pane.title,
      error: surface.error,
      renderQuality: 'full',
      pendingQuality: null,
      qualitySince: 0,
      filterVersion,
      filterGaze: false,
      filterGazeAt: 0,
      curvature: warpStore.get(warpKey(surface), mutableState.windowPreferences.defaultCurvature),
      geometryCurvature: -1,
      focusCurvature: null,
      opacity: warpStore.getOpacity(
        warpKey(surface),
        mutableState.windowPreferences.defaultOpacity,
      ),
    };
    syncPanelGrid(panel);
    applyTerminalOpacity(panel);
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
      const heldBadge = processBadge(surface.process, surface.status) ?? '';
      const heldChanged = heldBadge !== panel.heldBadge;
      const bell = Boolean(surface.bellPending);
      if (bell && !panel.bellLabel.visible) bellFeed.pushBell(surface.pane.id, surface.pane.title);
      // Every acknowledge path (selection, focus, main's selectPane) lowers bellPending.
      if (!bell && panel.bellLabel.visible) bellFeed.clearPane(surface.pane.id);
      panel.bellLabel.visible = bell;
      if (statusChanged) {
        panel.status = status;
        panel.connectionButton.userData.status = status;
        panel.connectionButton.userData.helpText = getControlHelp(panel.connectionButton.userData);
        updateLabel(
          panel.connectionButton,
          ['connected', 'connecting'].includes(status) ? 'Disconnect' : 'Reconnect',
        );
      }
      if (surface.pane.title !== panel.title || statusChanged || errorChanged || heldChanged) {
        panel.title = surface.pane.title;
        panel.heldBadge = heldBadge;
        updateLabel(
          panel.titleLabel,
          paneHeading(surface.pane.title, surface.status, surface.process, surface.error, 28),
        );
        notify();
      }
      if (errorChanged) {
        panel.error = surface.error;
        panel.titleLabel.userData.helpText =
          surface.error ?? getControlHelp({ terminalTitle: true });
      }
    });
    panels.set(panel.id, panel);
    showScrollStrips(panel);
    floorCorrectionPending = true;
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
    // The panel unsubscribes from its surface, so its bell's falling edge never arrives.
    bellFeed.clearPane(id);
    cancelTextSelection(id);
    if (warpEdit?.id === id) finishWarp(false);
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
    terminalPoseCache.delete(id);
    terminalRestoredPoses.delete(id);
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
    if (nextId) panels.get(nextId)?.surface.acknowledgeBell?.();
    if (textSelection && nextId !== textSelection.id) cancelTextSelection(undefined, true);
    if (warpEdit && nextId !== warpEdit.id && !gripActive()) finishWarp(false);
    if (paneFocus.activeId && nextId !== paneFocus.activeId) endFocusMode(true);
    if (nextId === mutableState.selectedTerminalId && mutableState.focusedTerminalId === nextId)
      return;
    resetHandContacts(false);
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
      snapshotMenuCommands();
      commandPage = 0;
      templateHint = null;
      disarmCommand();
      if (inputMode === 'warp' && warpPanelEdit?.id !== nextId) {
        settleWarpPanel(false);
        if (nextId)
          warpPanelEdit = { id: nextId, original: getTerminalCurvature(nextId), touched: false };
      }
      refreshInputRoot(inputMode);
    }
    for (const panel of panels.values())
      panel.surface.focus(panel.id === mutableState.focusedTerminalId);
    setSelectedVisual();
    notify();
  };
  const applyTerminalOpacity = (panel: TerminalPanel): void =>
    paneFocus.rebase(panel.root, () => applyTerminalOpacityNow(panel));
  const applyTerminalOpacityNow = (panel: TerminalPanel): void => {
    setTerminalBackgroundOpacity(panel.screen.material, panel.opacity);
    const frame = panel.frame.material;
    const transparent = panel.opacity < 1;
    frame.opacity = panel.opacity;
    panel.frameAccent.material.opacity =
      panel.id === mutableState.selectedTerminalId ? 1 : panel.opacity;
    panel.frameAccent.material.depthWrite = !transparent;
    if (frame.transparent === transparent) return;
    frame.transparent = transparent;
    frame.depthWrite = !transparent;
    frame.needsUpdate = true;
  };
  const getTerminalOpacity = (id: string): number => panels.get(id)?.opacity ?? 1;
  const setTerminalOpacity = (id: string, value: number): void => {
    const panel = panels.get(id);
    if (!panel || !Number.isFinite(value)) return;
    panel.opacity = THREE.MathUtils.clamp(value, 0.1, 1);
    applyTerminalOpacity(panel);
    if (!warpStore.setOpacity(warpKey(panel.surface), panel.opacity))
      setNotice('Glass opacity could not be saved on this device');
    if (inputRoot && inputMode === 'terminal') refreshInputRoot('terminal');
    notify();
  };
  const resetTerminalAppearance = (id: string): void => {
    const panel = panels.get(id);
    if (!panel) return;
    // Cancel an in-flight Warp edit first so its restore cannot overwrite the defaults.
    if (warpEdit?.id === id) finishWarp(false);
    if (!warpStore.clear(warpKey(panel.surface)))
      setNotice('Saved appearance could not be cleared on this device');
    const { defaultCurvature, defaultOpacity } = mutableState.windowPreferences;
    panel.opacity = defaultOpacity;
    applyTerminalOpacity(panel);
    // Focus mode shows focusCurvature on top of the base warp, which resets underneath it.
    setTerminalCurvature(id, defaultCurvature, false);
    // An open Warp panel stays live: Cancel returns to the reset values and Done saves from them.
    if (warpPanelEdit?.id === id) warpPanelEdit = { id, original: panel.curvature, touched: false };
    if (inputRoot && (inputMode === 'terminal' || inputMode === 'warp'))
      refreshInputRoot(inputMode);
    notify();
  };
  const copyTerminalPose = (pose: SavedUIPose): SavedUIPose => ({
    position: [...pose.position],
    quaternion: [...pose.quaternion],
    scale: pose.scale,
  });
  const captureCurrentTerminalPose = (panel: TerminalPanel): SavedUIPose => {
    const original = paneFocus.originalTransform(panel.root);
    if (!original) return captureUIPose(panel.root);
    const proxy = new THREE.Object3D();
    proxy.position.copy(original.position);
    proxy.quaternion.copy(original.quaternion);
    proxy.scale.copy(original.scale);
    proxy.parent = panel.root.parent;
    return captureUIPose(proxy);
  };
  const captureTerminalPose = (id: string): SavedUIPose | null => {
    const panel = panels.get(id);
    if (!panel) return null;
    return copyTerminalPose(terminalPoseCache.get(id) ?? captureCurrentTerminalPose(panel));
  };
  const restoreTerminalPose = (id: string, pose: SavedUIPose): void => {
    const panel = panels.get(id);
    if (!panel) return;
    terminalPoseCache.set(id, copyTerminalPose(pose));
    terminalRestoredPoses.set(id, copyTerminalPose(pose));
    applyUIPose(panel.root, pose, [0.3, 1.8], 100);
    floorCorrectionPending = true;
    correctTerminalFloor();
  };
  const rememberTerminalPlacements = (): void => {
    for (const panel of panels.values()) {
      const pose = captureCurrentTerminalPose(panel);
      terminalPoseCache.set(panel.id, pose);
      terminalRestoredPoses.set(panel.id, copyTerminalPose(pose));
    }
    mutableState.layoutRevision++;
    notify();
  };
  const correctTerminalFloor = (): void => {
    if (
      !floorCorrectionPending ||
      xrViewerPending ||
      paneFocus.activeId ||
      warpEdit ||
      [...dragStates.values()].some((drag) => drag.object.userData.terminalId)
    )
      return;
    floorCorrectionPending = false;
    const view = poseViewer();
    const roots = [...panels.values()].map((panel) => panel.root);
    const clamped = keepLayoutInsideRadius(
      roots,
      workspacePaneSafeRadius(mutableState.background, mutableState.xrMode),
    );
    const offset = keepLayoutAboveFloor(
      roots,
      workspaceFloorY(mutableState.background, mutableState.xrMode),
      view.getWorldPosition(new THREE.Vector3()),
    );
    if (offset > 0 || clamped) rememberTerminalPlacements();
  };
  const captureWorkspaceState = (): void => {
    if (hudRoot) saveUIPose('hud', hudRoot);
    if (inputRoot && isTypingMode(inputMode)) saveKeyboardPose(inputRoot);
    for (const [kind, widget] of widgets) saveWidgetPose(kind, widget);
    rememberTerminalPlacements();
  };
  // The hand Warp panel previews curvature live; Done saves it and anything else restores it.
  const settleWarpPanel = (commit: boolean): void => {
    const edit = warpPanelEdit;
    if (!edit) return;
    warpPanelEdit = null;
    const panel = panels.get(edit.id);
    if (!panel) return;
    if (!commit) setTerminalCurvature(edit.id, edit.original, false);
    else if (
      (edit.touched || panel.curvature !== edit.original) &&
      !warpStore.set(warpKey(panel.surface), panel.curvature)
    )
      setNotice('Curvature could not be saved on this device');
  };
  const finishWarp = (commit: boolean): void => {
    const edit = warpEdit;
    if (!edit) return;
    warpEdit = null;
    mutableState.warpTerminalId = null;
    if (warpReadout) {
      warpReadout.removeFromParent();
      disposeObject(warpReadout);
      warpReadout = null;
    }
    if (commit) {
      const panel = panels.get(edit.id);
      if (
        panel &&
        (edit.touched || panel.curvature !== edit.original) &&
        !warpStore.set(warpKey(panel.surface), panel.curvature)
      )
        setNotice('Curvature could not be saved on this device');
    } else setTerminalCurvature(edit.id, edit.original, false);
    floorCorrectionPending = true;
    correctTerminalFloor();
    scrollDue.clear();
    stripScrolls.clear();
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    notify();
  };
  const startWarp = (id: string | null, owner: THREE.Group | null): void => {
    const panel = panels.get(id ?? mutableState.selectedTerminalId ?? '');
    if (!panel) {
      setNotice('Select an open terminal to warp');
      return;
    }
    finishWarp(false);
    endFocusMode(true);
    releaseAllMouse();
    hideInput();
    clearArmedModifiers();
    selectTerminal(panel.id);
    const controller =
      owner ?? controllerRoots.find((root) => controllerHandedness.get(root) === 'right') ?? null;
    warpEdit = { id: panel.id, original: panel.curvature, touched: false, controller };
    mutableState.warpTerminalId = panel.id;
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    scrollDue.clear();
    stripScrolls.clear();
    warpReadout = createLabelButton('', 1.25, 0.08, { inputAction: 'noop' });
    warpReadout.name = 'xr-warp-readout';
    warpReadout.position.set(0, panel.height / 2 + 0.22, 0.04);
    warpReadout.traverse((object) => {
      object.raycast = () => undefined;
    });
    panel.root.add(warpReadout);
    updateLabel(
      warpReadout,
      `Warp ${Math.round(panel.curvature)}° · stick ← / → · A save · B cancel`,
    );
    notify();
  };
  const closeRadial = (): void => {
    if (!radialMenu.isOpen) return;
    radialMenu.close();
    mutableState.radialOpen = false;
  };
  const SETTINGS_MODES: readonly InputMode[] = [
    'settings',
    'display',
    'world',
    'terminal',
    'filtering',
    'buttons',
  ];
  const toggleInputMode = (mode: InputMode): void => {
    const open =
      inputRoot &&
      (inputMode === mode || (mode === 'settings' && SETTINGS_MODES.includes(inputMode)));
    if (open) {
      hideInput();
      return;
    }
    closeRadial();
    showInput(mode);
    notify();
  };
  const runButtonFunction = (choice: ButtonFunction, controller: THREE.Group): void => {
    const right =
      controllerRoots.find(
        (root) => controllerHandedness.get(root) === 'right' && !disconnectedControllers.has(root),
      ) ?? controller;
    const aimed = (): string | undefined => {
      const id = targetFromController(controller)?.terminalId;
      return id && panels.has(id) ? id : undefined;
    };
    switch (choice) {
      case 'menu':
        // Warp follows the right stick, so a left-hand menu press hands the radial to the right.
        toggleRadialMenu(right);
        return;
      case 'panes':
        togglePanes();
        return;
      case 'focus':
        if (radialMenu.root.visible) return;
        if (inputRoot && inputMode === 'panes') hideInput();
        else toggleFocusMode(aimed());
        return;
      case 'keyboard':
        closeRadial();
        toggleKeyboard();
        notify();
        return;
      case 'commands':
      case 'widgets':
      case 'settings':
        toggleInputMode(choice);
        return;
      case 'layout':
        toggleInputMode('arrange');
        return;
      case 'warp':
        closeRadial();
        startWarp(aimed() ?? mutableState.selectedTerminalId, right);
        notify();
        return;
      case 'none':
        return;
    }
  };
  const togglePanes = (): void => {
    if (inputRoot && inputMode === 'panes') {
      hideInput();
      return;
    }
    closeRadial();
    showInput('panes');
    notify();
  };
  const toggleRadialMenu = (controller?: THREE.Group): void => {
    if (gripActive()) return;
    if (warpEdit) {
      finishWarp(true);
      return;
    }
    if (radialMenu.isOpen) {
      radialMenu.close();
      mutableState.radialOpen = false;
      notify();
      return;
    }
    const aimed = controller ? targetFromController(controller)?.terminalId : null;
    radialTargetId = aimed && panels.has(aimed) ? aimed : mutableState.selectedTerminalId;
    radialController = controller ?? null;
    releaseAllMouse();
    modifierPresses.clear();
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    const view = trackedHead();
    view.updateWorldMatrix(true, false);
    const heading = viewHeading(view);
    radialMenu.root.position
      .set(0, -0.05, -1.05)
      .applyQuaternion(heading)
      .add(view.getWorldPosition(new THREE.Vector3()));
    radialMenu.root.quaternion.copy(heading);
    radialMenu.open();
    mutableState.radialOpen = true;
    notify();
  };
  const toggleWristMenu = (source: THREE.Group, fromTouch = false): boolean => {
    if (controllerHandedness.get(source) !== 'left') return false;
    const stamp = previousRenderTime ?? performance.now();
    if (stamp - wristMenuLastPressed < 250) return false;
    wristMenuLastPressed = stamp;
    if (!fromTouch) wristWatch.updateTouch(null);
    const owner =
      controllerRoots.find((root) => controllerHandedness.get(root) === 'right') ?? source;
    const wasOpen = radialMenu.isOpen;
    toggleRadialMenu(owner);
    if (!wasOpen && radialMenu.isOpen) radialTargetId = mutableState.selectedTerminalId;
    return true;
  };
  const getTerminalCurvature = (id: string): number => panels.get(id)?.curvature ?? 0;
  const setTerminalCurvature = (id: string, degrees: number, persist = true): void => {
    const panel = panels.get(id);
    if (!panel || !Number.isFinite(degrees)) return;
    panel.curvature = THREE.MathUtils.clamp(degrees, 0, 100);
    if (warpEdit?.id === id) warpEdit.touched = true;
    if (warpPanelEdit?.id === id) warpPanelEdit.touched = true;
    syncPanelGrid(panel);
    correctTerminalFloor();
    if (persist && !warpStore.set(warpKey(panel.surface), panel.curvature))
      setNotice('Curvature could not be saved on this device');
    if (warpEdit?.id === id && warpReadout)
      updateLabel(
        warpReadout,
        `Warp ${Math.round(panel.curvature)}° · stick ← / → · A save · B cancel`,
      );
    if (inputRoot && inputMode === 'warp') refreshInputRoot('warp');
    if (persist) notify();
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
    for (const widget of widgets.values()) widget.setTextureAnisotropy?.(pictureAnisotropy());
    if (inputRoot && inputMode === 'filtering') refreshInputRoot('filtering');
    notify();
  };
  const setBackground = (mode: BackgroundMode): void => {
    floorCorrectionPending = true;
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
    if (inputRoot && inputMode === 'display') refreshInputRoot(inputMode);
    notify();
  };
  const setKeyboardBackgroundEnabled = (enabled: boolean): void => {
    if (mutableState.keyboardBackgroundEnabled === enabled) return;
    mutableState.keyboardBackgroundEnabled = enabled;
    if (inputRoot && isTypingMode(inputMode)) refreshInputRoot(inputMode);
    notify();
  };
  const setKeyboardCurvature = (degrees: number): void => {
    const next = validateKeyboardCurvature(degrees);
    if (next === mutableState.keyboardCurvature) return;
    mutableState.keyboardCurvature = next;
    if (inputRoot && isTypingMode(inputMode)) refreshInputRoot(inputMode);
    notify();
  };
  const setKeyborbMode = (mode: KeyborbMode): void => {
    const next = validateKeyborbMode(mode);
    if (next === mutableState.keyborbMode) return;
    mutableState.keyborbMode = next;
    syncKeyborb();
    if (inputRoot && inputMode === 'settings') refreshInputRoot(inputMode);
    notify();
  };
  const setUISounds = (enabled: boolean): void => {
    if (mutableState.uiSounds === enabled) return;
    mutableState.uiSounds = enabled;
    if (inputRoot && inputMode === 'settings') refreshInputRoot(inputMode);
    notify();
  };
  const setHandColor = (color: string | null): void => {
    const next = validateHandColor(color);
    if (next === mutableState.handColor) return;
    mutableState.handColor = next;
    applyHandColors();
  };
  const setArmColor = (color: string | null): void => {
    const next = validateHandColor(color);
    if (next === mutableState.armColor) return;
    mutableState.armColor = next;
    applyHandColors();
  };
  const applyHandColors = (): void => {
    const { handColor, armColor } = mutableState;
    for (const visual of handVisuals.values()) visual.setColor(handColor || null, armColor || null);
    if (inputRoot && inputMode === 'world') refreshInputRoot(inputMode);
    notify();
  };
  const setDictationState = (state: DictationState): void => {
    const previous = mutableState.dictation;
    mutableState.dictation = { ...state };
    if (previous.status !== state.status) dictationCursor = Array.from(state.transcript).length;
    if (inputRoot && inputMode === 'keyboard') {
      if (
        previous.status !== state.status ||
        previous.supported !== state.supported ||
        Boolean(previous.transcript) !== Boolean(state.transcript)
      )
        refreshInputRoot('keyboard');
      else {
        const transcript = inputRoot.getObjectByName('xr-dictation-transcript') as
          | THREE.Mesh
          | undefined;
        if (transcript) updateLabel(transcript, dictationCaption());
      }
    }
  };
  const initializeHierarchy = (): void => {
    if (hierarchyOpened) return;
    const workspaceId =
      availablePanes.find(
        (pane) => pane.id === (mutableState.inputTargetId ?? mutableState.selectedTerminalId),
      )?.workspaceId ?? availablePanes[0]?.workspaceId;
    if (!workspaceId) return;
    hierarchyNavigation = { path: [`workspace:${encodeURIComponent(workspaceId)}`], page: 0 };
    hierarchyOpened = true;
  };
  let paneCreationRetry: ReturnType<typeof setTimeout> | undefined;
  const setPaneCreation = (state: PaneCreationState, attempt = 0): void => {
    paneCreation = { ...state };
    clearTimeout(paneCreationRetry);
    if (!inputRoot || inputMode !== 'panes') return;
    // A rebuild mid-transition would cut the animation; retry until it settles (bounded).
    if (hierarchyNavigator?.transitioning) {
      if (attempt < 40)
        paneCreationRetry = setTimeout(() => setPaneCreation(paneCreation, attempt + 1), 100);
      return;
    }
    refreshInputRoot('panes');
  };
  let agentRosterRetry: ReturnType<typeof setTimeout> | undefined;
  const refreshAgentRoster = (attempt = 0): void => {
    clearTimeout(agentRosterRetry);
    agentRosterRetry = undefined;
    if (!inputRoot || inputMode !== 'panes') return;
    // Same bounded wait as pane creation: never rebuild mid-transition.
    if (hierarchyNavigator?.transitioning) {
      if (attempt < 40) agentRosterRetry = setTimeout(() => refreshAgentRoster(attempt + 1), 100);
      return;
    }
    refreshInputRoot('panes');
  };
  const setAgentRoster = (
    rows: readonly AgentRosterRow[],
    layout: AgentRosterLayout = DEFAULT_AGENT_ROSTER_LAYOUT,
  ): void => {
    latestAgentRoster = [...rows];
    for (const widget of widgets.values()) widget.setAgentRoster?.(latestAgentRoster);
    const signature = agentRowsSignature(rows, layout);
    if (signature === agentRosterSignature) return;
    agentRosterSignature = signature;
    agentRoster = [...rows];
    agentRosterRows = layout.rows;
    // Coalesce bursts of state flips into one rebuild so nodes do not churn under a reach.
    if (agentRosterRetry === undefined && inputRoot && inputMode === 'panes')
      agentRosterRetry = setTimeout(() => refreshAgentRoster(), AGENT_ROSTER_COALESCE_MS);
  };
  const setAvailablePanes = (panes: PaneDescriptor[]): void => {
    availablePanes.splice(0, availablePanes.length, ...panes);
    for (const pane of panes) {
      const panel = panels.get(pane.id);
      if (panel) {
        Object.assign(panel.surface.pane, pane);
        updateLabel(
          panel.titleLabel,
          paneHeading(pane.title, panel.surface.status, panel.surface.process, null, 0),
        );
        bellFeed.renamePane(pane.id, pane.title);
      }
    }
    const listed = new Set(panes.map((pane) => pane.id));
    bellFeed.retainPanes((paneId) => listed.has(paneId) || panels.has(paneId));
    if (inputRoot && inputMode === 'panes') {
      initializeHierarchy();
      clearTimeout(agentRosterRetry);
      agentRosterRetry = undefined;
      refreshInputRoot('panes');
    }
    notify();
  };
  const setQuickCommands = (commands: QuickCommandEntry[]): void => {
    quickCommands = commands.map((command) => ({ ...command }));
  };
  const showInput = (mode: InputMode, source?: THREE.Group | null): void => {
    if (mode === 'warp' && renderer?.xr.isPresenting && !(source && activeHand(source))) {
      startWarp(mutableState.selectedTerminalId, null);
      return;
    }
    if (warpEdit) finishWarp(false);
    if (mode === 'warp' && mutableState.focusModeTerminalId) endFocusMode(true);
    keyboardResume = null;
    templateHint = null;
    if (mode === 'widgets') widgetsPage = 0;
    if (
      !renderer?.xr.isPresenting &&
      (mode === 'commands' || mode === 'keyboard' || mode === 'command-editor')
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
    snapshotMenuCommands();
    commandPage = 0;
    clearArmedModifiers();
    if (mode === 'panes') initializeHierarchy();
    if (mode === 'warp' && warpPanelEdit?.id !== targetId) {
      settleWarpPanel(false);
      if (targetId)
        warpPanelEdit = {
          id: targetId,
          original: getTerminalCurvature(targetId),
          touched: false,
        };
    }
    refreshInputRoot(mode);
  };
  const summonKeyboard = (): void => {
    closeRadial();
    if (!inputRoot || !isTypingMode(inputMode)) toggleKeyboard();
    if (!inputRoot || !isTypingMode(inputMode)) return;
    for (const controller of [...dragStates.keys()])
      if (dragStates.get(controller)?.object === inputRoot) releaseGrab(controller);
    resetInputPose();
    const head = trackedHead().getWorldPosition(new THREE.Vector3());
    inputRoot.position.lerp(head, KEYBOARD_SUMMON_CLOSER);
    saveKeyboardPose(inputRoot);
    notify();
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
    if (inputMode === 'picture-gallery') releaseRecentPictures();
    settleWarpPanel(false);
    if (inputRoot && isTypingMode(inputMode)) saveKeyboardPose(inputRoot);
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
    if (
      inputMode === 'keyboard' &&
      ['listening', 'transcribing'].includes(mutableState.dictation.status)
    )
      actions.dictationAction?.('cancel');
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
        ? { optionalFeatures: ['local-floor', 'dom-overlay', 'hand-tracking'] }
        : { optionalFeatures: ['local-floor', 'hand-tracking'] },
    );
    activeSession = session;
    resetPerfStats();
    session.addEventListener('visibilitychange', markPerfPause);
    poseRestorePending = true;
    xrViewerPending = true;
    xrHeadFromFrame = false;
    widgetRestorePending = true;
    touchedWidgets.clear();
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
      xrViewerPending = false;
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
      finishWarp(false);
      radialMenu.close();
      mutableState.radialOpen = false;
      rememberTerminalPlacements();
      for (const [kind, widget] of widgets) saveWidgetPose(kind, widget);
      if (hudRoot) saveUIPose('hud', hudRoot);
      if (inputRoot && isTypingMode(inputMode)) saveKeyboardPose(inputRoot);
      keyboardResume = null;
      endFocusMode(true);
      releaseAllMouse();
      if (!xrViewerPending) {
        const head = poseViewer();
        head.getWorldPosition(layoutViewer.position);
        head.getWorldQuaternion(layoutViewer.quaternion);
      }
      xrViewerPending = false;
      xrHeadFromFrame = false;
      activeSession = null;
      resetPerfStats();
      hideInput();
      inputTransform = null;
      dragStates.clear();
      pairGrabs.clear();
      recenterSince = null;
      recenterLatched = false;
      heldControllers.clear();
      resetHandContacts(false);
      contactGripArmed.clear();
      for (const visual of handVisuals.values()) visual.hide();
      wristWatch.setVisible(false);
      handTrackingLost.clear();
      handInputStates.forEach((state) => {
        state.pinching = false;
        state.neutral = false;
        state.tracked = false;
      });
      scrollDue.clear();
      stripScrolls.clear();
      controllerGamepads.clear();
      controllerHandedness.clear();
      focusButtonDown.clear();
      radialButtonDown.clear();
      modifierPresses.clear();
      previousRenderTime = null;
      hoveredByController.clear();
      for (const widget of widgets.values()) widget.setPointed?.(false);
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
    const panel = panels.get(paneFocus.activeId ?? '');
    if (panel) {
      panel.focusCurvature = null;
      syncPanelGrid(panel);
    }
    paneFocus.exit(immediate);
    mutableState.focusModeTerminalId = null;
    floorCorrectionPending = true;
    syncBringButtons();
  };
  const syncBringButtons = (): void => {
    for (const panel of panels.values()) {
      const keep = panel.id === paneFocus.activeId;
      const action = keep ? 'keepHere' : 'bringHere';
      if (panel.bringButton.userData.inputAction === action) continue;
      panel.bringButton.userData.inputAction = action;
      panel.bringButton.userData.helpText = getControlHelp(panel.bringButton.userData);
      updateLabel(panel.bringButton, keep ? 'Keep here' : 'Bring here');
    }
  };
  const focusPlacement = (
    panel: TerminalPanel,
    level = false,
  ): { position: THREE.Vector3; rotation: THREE.Quaternion } => {
    const bounds = measurePanelBounds(panel.root);
    const view = trackedHead();
    view.updateWorldMatrix(true, false);
    const eye = view.getWorldPosition(new THREE.Vector3());
    const forward = view.getWorldDirection(new THREE.Vector3());
    if (level) {
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
    }
    const rotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(eye, eye.clone().add(forward), new THREE.Vector3(0, 1, 0)),
    );
    const position = new THREE.Vector3(0, 0, -mutableState.windowPreferences.focusDistance)
      .applyQuaternion(rotation)
      .add(eye)
      .sub(bounds.center.clone().multiply(panel.root.scale).applyQuaternion(rotation));
    const originalPosition = panel.root.position.clone();
    const originalQuaternion = panel.root.quaternion.clone();
    panel.root.position.copy(position);
    panel.root.quaternion.copy(rotation);
    keepLayoutInsideRadius(
      [panel.root],
      workspacePaneSafeRadius(mutableState.background, mutableState.xrMode),
    );
    keepLayoutAboveFloor(
      [panel.root],
      workspaceFloorY(mutableState.background, mutableState.xrMode),
      eye,
    );
    position.copy(panel.root.position);
    rotation.copy(panel.root.quaternion);
    panel.root.position.copy(originalPosition);
    panel.root.quaternion.copy(originalQuaternion);
    panel.root.updateMatrixWorld(true);
    if (panel.root.parent) {
      panel.root.parent.worldToLocal(position);
      rotation.premultiply(panel.root.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    return { position, rotation };
  };
  const setHierarchyStyle = (style: HierarchyStyle): void => {
    const next = validateHierarchyStyle(style);
    if (next === mutableState.hierarchyStyle) return;
    mutableState.hierarchyStyle = next;
    if (inputRoot && (inputMode === 'panes' || inputMode === 'display'))
      refreshInputRoot(inputMode);
    notify();
  };
  const setWindowPreferences = (preferences: WindowPreferences): void => {
    const next = validateWindowPreferences(preferences);
    if (JSON.stringify(next) === JSON.stringify(mutableState.windowPreferences)) return;
    const focusChanged =
      next.focusDistance !== mutableState.windowPreferences.focusDistance ||
      next.focusCurvature !== mutableState.windowPreferences.focusCurvature;
    const stripSideChanged =
      next.scrollStripSide !== mutableState.windowPreferences.scrollStripSide;
    const chinChanged = next.frameChin !== mutableState.windowPreferences.frameChin;
    mutableState.windowPreferences = next;
    if (chinChanged) for (const panel of panels.values()) syncPanelFrame(panel);
    if (stripSideChanged) {
      stripScrolls.clear();
      for (const panel of panels.values()) showScrollStrips(panel);
    }
    const panel = panels.get(paneFocus.activeId ?? '');
    if (panel && focusChanged) {
      panel.focusCurvature = next.focusCurvature;
      syncPanelGrid(panel);
      const placement = focusPlacement(panel);
      paneFocus.retarget(placement.position, placement.rotation);
    }
    if (inputRoot && (inputMode === 'display' || inputMode === 'buttons'))
      refreshInputRoot(inputMode);
    notify();
  };
  const toggleFocusMode = (id?: string): void => {
    if (gripActive()) return;
    releaseAllMouse();
    stripScrolls.clear();
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
    correctTerminalFloor();
    selectTerminal(panel.id);
    panel.focusCurvature = mutableState.windowPreferences.focusCurvature;
    syncPanelGrid(panel);
    const { position, rotation } = focusPlacement(panel);
    paneFocus.enter(
      panel.id,
      panel.root,
      [...panels.values()].map((value) => value.root),
      position,
      rotation,
    );
    mutableState.focusModeTerminalId = panel.id;
    syncBringButtons();
    notify();
  };
  const bringTerminalHere = (id: string): void => {
    const panel = panels.get(id);
    if (!panel || gripActive()) return;
    releaseAllMouse();
    showHover(null);
    gazeInputState = { candidateId: null, emphasizedId: null, since: 0 };
    if (paneFocus.activeId) endFocusMode(true);
    stripScrolls.clear();
    selectTerminal(panel.id);
    const { position, rotation } = focusPlacement(panel, true);
    panel.root.position.copy(position);
    panel.root.quaternion.copy(rotation);
    panel.root.updateMatrixWorld(true);
    rememberTerminalPlacements();
  };
  const keepFocusPlacement = (): void => {
    const panel = panels.get(paneFocus.activeId ?? '');
    if (!panel) return;
    paneFocus.keep();
    panel.focusCurvature = null;
    syncPanelGrid(panel);
    mutableState.focusModeTerminalId = null;
    floorCorrectionPending = true;
    correctTerminalFloor();
    syncBringButtons();
    rememberTerminalPlacements();
  };
  const arrangeTerminals = (pattern: PanelArrangement): void => {
    if (!panels.size) return;
    endFocusMode(true);
    stripScrolls.clear();
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
    if (!inXRContext()) resetLayoutViewer();
    const view = poseViewer();
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
    keepLayoutInsideRadius(
      ordered.map((panel) => panel.root),
      workspacePaneSafeRadius(mutableState.background, mutableState.xrMode),
    );
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
    rememberTerminalPlacements();
  };
  const moveLayoutDepth = (direction: number): void => {
    if (!panels.size || !Number.isFinite(direction) || direction === 0) return;
    endFocusMode(true);
    const view = poseViewer();
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
    rememberTerminalPlacements();
  };
  const resetLayout = (): void => {
    resetHandContacts(false);
    contactGripArmed.clear();
    cancelTextSelection(undefined, true);
    finishWarp(false);
    radialMenu.close();
    mutableState.radialOpen = false;
    radialMenu.root.scale.setScalar(0.8);
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
    if (!inXRContext()) resetLayoutViewer();
    const layoutView = poseViewer();
    layoutView.updateMatrixWorld(true);
    const layoutEye = layoutView.getWorldPosition(new THREE.Vector3());
    const layoutRotation = layoutView.getWorldQuaternion(new THREE.Quaternion());
    for (const panel of panels.values()) {
      panel.root.position
        .copy(panel.defaultPosition)
        .add(new THREE.Vector3(0, -NOMINAL_VIEWER_HEIGHT, 0))
        .applyQuaternion(layoutRotation)
        .add(layoutEye);
      panel.root.quaternion.premultiply(layoutRotation);
    }
    if (renderer?.xr.isPresenting) {
      const view = renderer.xr.getCamera();
      view.updateMatrixWorld(true);
      const eye = view.getWorldPosition(new THREE.Vector3());
      const rotation = view.getWorldQuaternion(new THREE.Quaternion());
      if (hudRoot) {
        hudRoot.position.set(0, -0.65, -1.35).applyQuaternion(rotation).add(eye);
        hudRoot.quaternion.copy(rotation);
      }
    }
    resetInputPose();
    // User-placed pictures stay put; unmoved ones give up their slots and are re-slotted in order.
    for (const widget of widgets.values())
      if (!widget.root.userData.picturePlaced) delete widget.root.userData.widgetSlot;
    for (const [kind, widget] of widgets) {
      if (widget.root.userData.picturePlaced) continue;
      placeWidget(kind, widget);
      saveWidgetPose(kind, widget);
    }
    const view = poseViewer();
    keepLayoutInsideRadius(
      [...panels.values()].map((panel) => panel.root),
      workspacePaneSafeRadius(mutableState.background, mutableState.xrMode),
    );
    keepLayoutAboveFloor(
      [...panels.values()].map((panel) => panel.root),
      workspaceFloorY(mutableState.background, mutableState.xrMode),
      view.getWorldPosition(new THREE.Vector3()),
    );
    if (inputRoot && inputMode === 'arrange') refreshInputRoot('arrange');
    rememberTerminalPlacements();
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
    if (radialMenu.root.visible) roots.push(radialMenu.root);
    for (const root of roots)
      root.traverse((object) => {
        const help = object.userData.helpText as string | undefined;
        if (!help || !isControlVisible(object) || object.userData.inputAction === 'scrollStrip')
          return;
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
    disarmCommand();
    clearTimeout(paneCreationRetry);
    clearTimeout(agentRosterRetry);
    if (armedControlTimer !== undefined) clearTimeout(armedControlTimer);
    armedControl = null;
    resetHandContacts(false);
    handContacts.clear();
    keyboardProximity.clear();
    contactSamples.clear();
    contactGripArmed.clear();
    pokeSources.clear();
    pendingPokes.clear();
    for (const proxy of [...panePulls]) discardPanePull(proxy);
    hierarchyTouch.reset();
    disposeObject(hierarchyTouchMarker);
    finishWarp(false);
    disposed = true;
    clipboard.dispose();
    feedback.dispose();
    pendingPaste.clear();
    paneFocus.dispose();
    window.cancelAnimationFrame(frameHandle);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', markPerfPause);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('lostpointercapture', onPointerUp);
    renderer?.setAnimationLoop(null);
    labelBatcher.dispose();
    for (const id of [...panels.keys()]) removeTerminal(id);
    radialMenu.dispose();
    for (const kind of [...widgets.keys()]) removeWidget(kind, false);
    for (const {
      root,
      onSelect,
      onSelectEnd,
      onSelectComplete,
      onSqueeze,
      onSqueezeEnd,
      onConnected,
      onDisconnected,
      onPoseEvent,
    } of controllerListeners) {
      const eventRoot = root as unknown as EventRoot;
      for (const type of POSE_EVENTS) eventRoot.removeEventListener(type, onPoseEvent);
      eventRoot.removeEventListener('selectstart', onSelect);
      eventRoot.removeEventListener('selectend', onSelectEnd);
      eventRoot.removeEventListener('select', onSelectComplete);
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
    stripScrolls.clear();
    controllerGamepads.clear();
    controllerHandedness.clear();
    focusButtonDown.clear();
    radialButtonDown.clear();
    modifierPresses.clear();
    disconnectedControllers.clear();
    heldControllers.clear();
    for (const hand of handRoots.values()) {
      scene.remove(hand);
    }
    for (const visual of handVisuals.values()) visual.dispose();
    wristWatch.dispose();
    disposeObject(wristMenuButton);
    for (const grip of controllerGrips.values()) scene.remove(grip);
    controllerGrips.clear();
    handVisuals.clear();
    handRoots.clear();
    handGrabActions.clear();
    handTrackingLost.clear();
    handInputStates.clear();
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
    uiEnvironment.dispose();
    renderer?.dispose();
    if (canvas.parentElement === container) container.removeChild(canvas);
    listeners.clear();
  };
  setBackground('observatory');
  createHud();
  uiEnvironment.warmPrograms(scene, camera);
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
    setWindowPreferences,
    setHierarchyStyle,
    getTerminalOpacity,
    setTerminalOpacity,
    resetTerminalAppearance,
    captureTerminalPose,
    captureWorkspaceState,
    restoreTerminalPose,
    toggleRadialMenu,
    getTerminalCurvature,
    setTerminalCurvature,
    setKeyboardBackgroundEnabled,
    setKeyboardCurvature,
    setKeyborbMode,
    setUISounds,
    setHandColor,
    setArmColor,
    setDictationState,
    setAvailablePanes,
    setPaneCreation,
    closePaneSelector: () => {
      if (inputRoot && inputMode === 'panes') hideInput();
    },
    setAgentRoster,
    setQuickCommands,
    showInput,
    hideInput,
    enterXR,
    exitXR,
    setUpdateAvailable,
    setKeyIndicator,
    isTextEntryActive,
    typeTextEntryKey,
    notifyPicture,
    setNotice,
    addPicture: (id, image, target) => showPicture(id, image, false, target),
    restorePictures: (pictures) => {
      const ids = new Set(pictures.map(({ id }) => widgetKey(PICTURE_KIND, id)));
      for (const key of Object.keys(widgetPoseStore.read()))
        if (
          widgetKeyKind(key) === PICTURE_KIND &&
          !isPlaceholderKey(key) &&
          !ids.has(key) &&
          !widgets.has(key)
        )
          widgetPoseStore.remove(key);
      for (const { id, image, depth, depthView } of pictures)
        showPicture(id, image, true, undefined, { depth, depthView });
    },
    removePicture: (id) => removeWidget(widgetKey(PICTURE_KIND, id)),
    setPictureDepth: (id, depth) => {
      const widget = widgets.get(widgetKey(PICTURE_KIND, id));
      if (widget?.setPictureDepth) widget.setPictureDepth(depth);
      else {
        depth.source.width = 0;
        depth.source.height = 0;
      }
    },
    pasteClipboard: (paneId?: string) => pasteClipboard(paneId, null),
    pasteHostClipboard: (paneId?: string) => pasteHostClipboard(paneId, null),
    copyHostToQuest: () => copyHostToQuest(null),
    copyQuestToHost: () => copyQuestToHost(null),
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
