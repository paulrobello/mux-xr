import type { ModifierState } from '@par/xr-workspace';
import type * as THREE from 'three';
import type {
  BackgroundMode,
  PaneDescriptor,
  PanelArrangement,
  QuickCommand,
  QuickCommandEntry,
  TerminalColorMode,
  WorkspaceActions,
} from '../contracts';
import type { PictureImage } from '../pictures/picture-image';
import type { TerminalFiltering } from '../terminal/filtering';
import type { AgentRosterRow, AgentRows } from '../workspace/agent-roster';
import type { HierarchyStyle } from '../workspace/hierarchy-style';
import type { KeyborbMode } from '../workspace/keyborb';
import type { PaneCreationState } from '../workspace/pane-create';
import type { WindowPreferences } from '../workspace/window-preferences';
import type { AccentState } from './accent-state';
import type { BellFeedStore } from './bell-feed';
import type { CommandDraft } from './command-editor';
import type { HierarchyNavigation, HierarchyNavigator } from './hierarchy-navigator';
import type { PanelAction } from './panel-actions';
import type { CommandTool, ConfirmAction } from './panel-ui';
import type {
  RecentPictureEntry,
  ScenePicturePicker,
  TerminalPanel,
  WorkspaceSceneState,
  XrSessionLike,
} from './scene';
import type { UICue } from './ui-feedback';
import type { WidgetEntry, WidgetKey, WidgetKind } from './widget-registry';
import type { Widget } from './widgets';

/**
 * The XR panel modes. `PANELS` in `panels/index.ts` carries one module per member.
 */
export type InputMode =
  | 'commands'
  | 'keyboard'
  | 'panes'
  | 'terminal'
  | 'arrange'
  | 'command-editor'
  | 'widgets'
  | 'sticky-note-reader'
  | 'filtering'
  | 'warp'
  | 'settings'
  | 'display'
  | 'world'
  | 'backgrounds'
  | 'buttons'
  | 'picture-url'
  | 'picture-gallery'
  | 'weather-zip'
  | 'accent';

/**
 * The typed seam between the scene factory and the per-mode XR panel modules under `panels/`.
 * Panel builders read scene state through getters so they never capture a stale closure value,
 * and they mutate factory-owned panel state only through the setters here.
 */
export interface SceneContext {
  readonly renderer: THREE.WebGLRenderer | null;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly mutableState: WorkspaceSceneState;
  readonly maxAnisotropy: number;
  /** This scene's live accent colours. */
  readonly accent: Readonly<AccentState>;
  readonly actions: WorkspaceActions;
  readonly panels: ReadonlyMap<string, TerminalPanel>;
  readonly widgets: ReadonlyMap<WidgetKey, Widget>;
  /** The UI environment texture the hierarchy navigator reads. */
  readonly uiEnvironmentTexture: THREE.Texture | null;
  /** The picture picker when in-XR picture picking is wired. */
  readonly picturePicker?: ScenePicturePicker;
  cue(kind: UICue, source?: THREE.Group | number | null): void;
  notify(): void;
  setNotice(message: string | null): void;
  showToast(message: string | null): void;
  refreshInputRoot(mode: InputMode): void;
  showInput(mode: InputMode): void;
  hideInput(): void;
  get inputMode(): InputMode;
  get inputRoot(): THREE.Group | null;
  readonly availablePanes: readonly PaneDescriptor[];
  get paneCreation(): PaneCreationState;
  get agentRoster(): AgentRosterRow[];
  get agentRosterRows(): AgentRows;
  get hierarchyNavigator(): HierarchyNavigator | null;
  set hierarchyNavigator(value: HierarchyNavigator | null);
  get hierarchyNavigation(): HierarchyNavigation;
  set hierarchyNavigation(value: HierarchyNavigation);
  get menuCommands(): QuickCommandEntry[];
  get stripCommands(): QuickCommandEntry[];
  get templateHint(): string | null;
  set templateHint(value: string | null);
  get recentPictures(): RecentPictures;
  get recentPage(): number;
  set recentPage(value: number);
  get notePage(): number;
  set notePage(value: number);
  get notePages(): string[];
  get commandDraft(): CommandDraft | null;
  set commandDraft(value: CommandDraft | null);
  get commandEditorMessage(): string;
  set commandEditorMessage(value: string);
  get commandPage(): number;
  set commandPage(value: number);
  get commandTool(): CommandTool;
  set commandTool(value: CommandTool);
  get commandsMessage(): string;
  set commandsMessage(value: string);
  get commandWorkspaceId(): string | undefined;
  set commandWorkspaceId(value: string | undefined);
  get gridDraft(): GridDraft | null;
  set gridDraft(value: GridDraft | null);
  get gridRequestStatus(): string;
  set gridRequestStatus(value: string);
  get weatherZipDraft(): string;
  set weatherZipDraft(value: string);
  get weatherZipMessage(): string;
  set weatherZipMessage(value: string);
  get pictureUrl(): PictureUrlDraft;
  set pictureUrl(value: PictureUrlDraft);
  get pictureBusy(): boolean;
  get picturePanelMessage(): string;
  set picturePanelMessage(value: string);
  get widgetsPage(): number;
  set widgetsPage(value: number);
  get backgroundRow(): number;
  set backgroundRow(value: number);
  get armedControl(): ArmedControl | null;
  /** Scene setters and helpers panel handlers invoke. */
  confirmControl(action: ConfirmAction): boolean;
  manageCommand(command: QuickCommand, action: string): void;
  getWidgetEntry(kind: WidgetKind): WidgetEntry;
  getTerminalOpacity(id: string): number;
  setTerminalOpacity(id: string, value: number): void;
  getTerminalCurvature(id: string): number;
  setTerminalCurvature(id: string, degrees: number, persist?: boolean): void;
  resetTerminalAppearance(id: string): void;
  setWindowPreferences(preferences: WindowPreferences): void;
  settleWarpPanel(commit: boolean): void;
  startWarp(id: string | null, owner: THREE.Group | null): void;
  activeHand(root: THREE.Group): THREE.Group | undefined;
  endFocusMode(immediate?: boolean): void;
  setWarpPanelEdit(value: { id: string; original: number; touched: boolean } | null): void;
  initializeHierarchy(): void;
  setWeatherZip(zip: string): void;
  setKeyborbMode(mode: KeyborbMode): void;
  setUISounds(enabled: boolean): void;
  setHierarchyStyle(style: HierarchyStyle): void;
  setKeyboardCurvature(degrees: number): void;
  setKeyboardBackgroundEnabled(enabled: boolean): void;
  setGazeInputEnabled(enabled: boolean): void;
  setTerminalColorMode(mode: TerminalColorMode): void;
  setTerminalFiltering(filtering: TerminalFiltering): void;
  arrangeTerminals(pattern: PanelArrangement): void;
  moveLayoutDepth(direction: number): void;
  resetLayout(): void;
  toggleWidget(kind: WidgetKind): void;
  setBackground(mode: BackgroundMode): void;
  backgroundThumbnail(mode: BackgroundMode): THREE.Texture | null;
  exitXR(): Promise<void>;
  get warpPanelEdit(): { id: string; original: number; touched: boolean } | null;
  openDeskWindow(): void;
  removeWidget(kind: WidgetKey, persist?: boolean): void;
  get activeSession(): XrSessionLike | null;
  submitPictureUrl(): void;
  placeRecentPicture(id: string): void;
  setRecentPictures(pictures: RecentPictures): void;
  releaseThumbnail(image: PictureImage): void;
  get disposed(): boolean;
  get lastSelectSource(): THREE.Group | null;
  dictationCaption(): string;
  dictationReview(): boolean;
  editDictationKey(key: string): void;
  pinNote(): void;
  copyQuestToHost(): Promise<boolean>;
  syncModifierVisuals(): void;
  get hierarchyHiddenPanels(): Map<THREE.Object3D, boolean>;
  get bellFeed(): BellFeedStore;
  isArmed(id: string, action: string): boolean;
  armedPreview(action: string): string | null;
  consumeArmedModifiers(): void;
  clearArmedModifiers(): void;
  snapshotMenuCommands(): void;
  commandButtonLabel(command: QuickCommand, action: string): string;
  get modifierState(): ModifierState;
}

/** Alias shapes the context re-exports for panel modules. */
export type RecentPictures = ReadonlyArray<RecentPictureEntry> | null | 'loading';
export type GridDraft = { target: string; cols: number; rows: number };
export type PictureUrlDraft = { text: string; cursor: number };
export type ArmedControl = { action: ConfirmAction; at: number };

export interface PanelModule {
  /** Rebuilds the panel's controls into the fresh input root. */
  build(root: THREE.Group, ctx: SceneContext): void;
  /**
   * Claims the panel's actions the shared chain processes before the radial-animation swallow.
   * Return true when the action belongs to this panel; every other type returns false.
   */
  handleActionEarly?(action: PanelAction, hit: THREE.Object3D, ctx: SceneContext): boolean;
  /**
   * Claims the panel's actions processed after that swallow (and after the shared early chain
   * declined). Return true when the action belongs to this panel.
   */
  handleAction?(action: PanelAction, hit: THREE.Object3D, ctx: SceneContext): boolean;
  /** The drag-handle label text. */
  title(ctx: SceneContext): string;
  /** Drag-handle width; the shared default is 0.9. */
  titleWidth?: number;
  /** Drag-handle y; the shared default is 0.56. */
  titleY?: number;
  /** The Close button position; the shared default is (0, -0.66). */
  closePosition?(ctx: SceneContext): { x: number; y: number };
  /** When the panel has a Back button, its target mode and position. */
  back?(ctx: SceneContext): { target: InputMode; x: number; y: number };
  /**
   * showInput's per-mode side effects, run before the shared show preamble. Return true when
   * showInput stops here because the panel redirected the request (warp's XR hand-off).
   */
  onShow?(ctx: SceneContext, source: THREE.Group | null): boolean | undefined;
  /**
   * Desktop-only: opening this panel outside a session swaps to the DOM presenter instead of
   * mounting in-scene controls. `'commands'` opens the command library, `'keyboard'` the keyboard.
   */
  desktopSwap?: 'commands' | 'keyboard';
  /** Per-mode preparation after the input target is resolved, just before the root is built. */
  onPrepare?(ctx: SceneContext, targetId: string | null): void;
  /**
   * Runs after Close/Back placement. Return true when the panel finished the input root itself
   * and the shared backing/walls tail must be skipped.
   */
  finalize?(root: THREE.Group, ctx: SceneContext): boolean;
  /** Modes this panel keeps open when toggled, so the radial treats them as one surface. */
  subsumes?: readonly InputMode[];
}
