import type { PaneProcess } from './terminal/lifecycle';

export interface PaneDescriptor {
  id: string;
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
  sessionName: string;
  windowId: string;
  windowName: string;
  title: string;
  cols?: number;
  rows?: number;
  active?: boolean;
  windowActive?: boolean;
  /** From the mux tree snapshot; absent when the producer sent an unknown state. */
  process?: PaneProcess;
}

export type TerminalStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'paused'
  | 'error'
  | 'exited'
  | 'closed';

export type TerminalColorMode = 'comfort' | 'original' | 'monochrome';
export type TerminalRenderQuality = 'full' | 'medium' | 'low' | 'hidden';

export interface KeyModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type TerminalMouseButton = 0 | 1 | 2 | 64 | 65;
export type TerminalMouseEventType = 'press' | 'release' | 'move' | 'scroll';
export type TerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any';

export interface TerminalMouseInput {
  col: number;
  row: number;
  button: TerminalMouseButton;
  eventType: TerminalMouseEventType;
  modifiers?: KeyModifiers;
}

export interface TerminalCellPosition {
  col: number;
  row: number;
}

export interface TerminalDamageStats {
  /** Paints that scanned only hinted rows. */
  damageScans: number;
  /** Paints that scanned every row. */
  fullScans: number;
  /** Rows read cell by cell, across all paints. */
  rowsScanned: number;
  /** Hints refused as invalid, each forcing a full scan. */
  rejectedHints: number;
  /** Audit mode only: rows that changed outside the hinted scan set. */
  auditMisses: number;
  /** Full scans by cause: untracked, unhinted, invalidated, viewport, scrolled, buffer, bounds. */
  fullScanReasons: Record<string, number>;
}

export interface TerminalSurface {
  readonly serverId?: string;
  readonly canvas: HTMLCanvasElement;
  readonly pane: PaneDescriptor;
  readonly revision: number;
  readonly dirtyRows?: Uint8Array;
  readonly damageStats?: Readonly<TerminalDamageStats>;
  readonly cols: number;
  readonly rows: number;
  readonly status: TerminalStatus;
  readonly error: string | null;
  /** Held-pane process lifecycle, independent of stream `status`. */
  readonly process?: PaneProcess;
  /** Working directory from OSC 7; null when unreported. */
  readonly cwd?: string | null;
  /** The OSC 7 hostname for `cwd`; null when the shell sent none. The host decides if it is local. */
  readonly cwdHost?: string | null;
  /** The streamer's advertised pane-create capability; undefined when it does not advertise one. */
  readonly paneCreateAllowed?: boolean;
  readonly bellPending?: boolean;
  acknowledgeBell?(): void;
  readonly canResizeGrid: boolean;
  readonly renderQuality?: TerminalRenderQuality;
  setRenderQuality?(quality: TerminalRenderQuality): void;
  connect(): void;
  disconnect(): void;
  flush?(): void;
  sendText(text: string): boolean;
  sendKey(key: string, modifiers?: KeyModifiers): boolean;
  readonly applicationCursor?: boolean;
  sendMouse?(input: TerminalMouseInput): boolean;
  beginSelection?(cell: TerminalCellPosition): boolean;
  updateSelection?(cell: TerminalCellPosition): void;
  getSelectionText?(): string;
  clearSelection?(): void;
  scroll?(lines: number, cell?: { col: number; row: number }): boolean;
  readonly mouseTracking?: TerminalMouseTrackingMode;
  paste(text: string): boolean;
  /** `moveDomFocus` false only reports focus to the streamer, leaving the page's DOM focus. */
  focus(focused: boolean, moveDomFocus?: boolean): void;
  resizeGrid(cols: number, rows: number): boolean;
  setColorMode(mode: TerminalColorMode): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export const BACKGROUND_MODES = [
  'black',
  'gradient',
  'observatory',
  'hangar',
  'deep-water',
  'studio',
  'desert',
  'aurora',
  'koi',
  'summit',
  'rooftop',
] as const;

export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

export function isBackgroundMode(value: unknown): value is BackgroundMode {
  return (BACKGROUND_MODES as readonly unknown[]).includes(value);
}

export type PanelArrangement = 'row' | 'grid' | 'arc' | 'sphere';

export interface QuickCommand {
  id: string;
  label: string;
  text: string;
  sendNewline: boolean;
  workspaceId?: string;
  confirm?: boolean;
  pinned?: boolean;
}

export interface QuickCommandStats {
  lastRunAt: number;
  runCount: number;
}

export interface QuickCommandEntry extends QuickCommand, Partial<QuickCommandStats> {
  shared?: boolean;
}

export interface WorkspaceSnapshot {
  panes: PaneDescriptor[];
  revision?: string;
}

export interface WorkspaceActions {
  selectPane(id: string): void;
  closePane(id: string): void;
  /** Ask the streamer for one new default-shell terminal in a mux session. */
  createPane?(sessionId: string): void;
  sendText(text: string): void;
  sendKey(key: string, modifiers?: KeyModifiers): void;
  sendMouse?(paneId: string, input: TerminalMouseInput): boolean;
  scrollTerminal?(paneId: string, lines: number, cell?: { col: number; row: number }): boolean;
  runCommand(command: QuickCommand, paneId: string): void;
  openKeyboard(): void;
  openCommands(): void;
  setXREntryMode?(mode: 'vr' | 'ar'): void;
  exitPreview?(): void;
  resizeGrid?(paneId: string, cols: number, rows: number): boolean;
  setTerminalColorMode?(mode: TerminalColorMode): void;
  setKeyboardBackground?(enabled: boolean): void;
  reloadApp?(): void;
  saveCommand?(command: QuickCommand): boolean;
  removeCommand?(id: string): boolean;
  togglePaneConnection?(id: string): void;
  dictationAction?(action: import('./speech-input').DictationAction): void;
  editDictation?(text: string): void;
  /** One explicit host clipboard read through the dictation server's `/clipboard` route. */
  readHostClipboard?(): Promise<import('./host-clipboard').HostClipboardResult<string>>;
  /** One explicit host clipboard write through the dictation server's `/clipboard` route. */
  writeHostClipboard?(
    text: string,
  ): Promise<import('./host-clipboard').HostClipboardResult<number>>;
}
