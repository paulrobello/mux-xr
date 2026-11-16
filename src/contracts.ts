import type { KeyModifiers } from '@par/xr-workspace/keyboard-types';
import { BACKGROUNDS, type BackgroundId } from './backgrounds';
import type { HostClipboardResult } from './host-clipboard';
import type { DictationAction } from './speech-input';
import type { PaneProcess } from './terminal/lifecycle';
import type { TerminalLinkStats } from './terminal/link-stats';
import type { XrEntryMode } from './xr/entry';

/**
 * The interfaces between the presenters (browser UI, desktop panels, XR scene) and the transport
 * (the streamer terminal surfaces and the demo). Presenters depend on these types and never on a
 * concrete surface, so the demo surface and the live surface are interchangeable.
 */

/** One mux pane with the workspace, session and window that contain it. Ids come from the mux tree. */
export interface PaneDescriptor {
  id: string;
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
  sessionName: string;
  windowId: string;
  windowName: string;
  title: string;
  /** Remote grid size in cells; absent until the tree snapshot reports it. */
  cols?: number;
  rows?: number;
  /** Whether the pane is its window's active pane, and whether its window is the active one. */
  active?: boolean;
  windowActive?: boolean;
  /** From the mux tree snapshot; absent when the producer sent an unknown state. */
  process?: PaneProcess;
}

/** Connection state of one terminal stream. `paused` is a user disconnect and `exited` a finished held pane. */
export type TerminalStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'paused'
  | 'error'
  | 'exited'
  | 'closed';

/** Saved global color preference. `comfort` is the default. */
export type TerminalColorMode = 'comfort' | 'original' | 'monochrome';
/** Raster tier set by the XR level-of-detail pass. `hidden` skips painting while the pane is not shown. */
export type TerminalRenderQuality = 'full' | 'medium' | 'low' | 'hidden';

export type { KeyModifiers } from '@par/xr-workspace/keyboard-types';

/** Mouse button codes as the terminal protocol reports them: 0 left, 1 middle, 2 right, 64 and 65 wheel up and down. */
export type TerminalMouseButton = 0 | 1 | 2 | 64 | 65;
/** The phase of one mouse report sent to a terminal. */
export type TerminalMouseEventType = 'press' | 'release' | 'move' | 'scroll';
/** The mouse reporting mode a terminal application enabled. `none` means local selection and scrollback. */
export type TerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any';

/** One mouse report, addressed by grid cell and not by pixel. */
export interface TerminalMouseInput {
  /** Zero-based grid cell. */
  col: number;
  row: number;
  button: TerminalMouseButton;
  eventType: TerminalMouseEventType;
  modifiers?: KeyModifiers;
}

/** A zero-based cell in the visible grid. */
export interface TerminalCellPosition {
  col: number;
  row: number;
}

/** Painter counters behind the damage-hinted paint path, read by the capacity and damage-audit checks. */
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

/**
 * One terminal as presenters see it: a canvas that follows a pane, its status and its input
 * methods. Optional members are absent on the demo surface (`createDemoSurface` in `src/demo.ts`),
 * which has no stream, diagnostics, selection or scrollback. The demo does define `sendMouse`
 * (always false) and `mouseTracking` (always `none`). The live surface in
 * `src/terminal/surface.ts` implements every member.
 */
export interface TerminalSurface {
  /** Identity of the stream (origin and path), used to key per-server saved state. Absent on the demo. */
  readonly serverId?: string;
  readonly canvas: HTMLCanvasElement;
  readonly pane: PaneDescriptor;
  /** Increments on every repaint of `canvas`, so a texture upload can tell when to refresh. */
  readonly revision: number;
  /** One flag per row, set for rows the most recent paint changed. Absent on the demo, which has no damage tracking. */
  readonly dirtyRows?: Uint8Array;
  /** Painter counters. Absent on the demo. */
  readonly damageStats?: Readonly<TerminalDamageStats>;
  /** Current grid size in cells, which follows the server-confirmed size. */
  readonly cols: number;
  readonly rows: number;
  readonly status: TerminalStatus;
  /** The bounded error that stopped the stream; null otherwise. */
  readonly error: string | null;
  /** Held-pane process lifecycle, independent of stream `status`. Absent on the demo. */
  readonly process?: PaneProcess;
  /** Working directory from OSC 7; null when unreported. */
  readonly cwd?: string | null;
  /** The OSC 7 hostname for `cwd`; null when the shell sent none. The host decides if it is local. */
  readonly cwdHost?: string | null;
  /** The streamer's advertised pane-create capability; undefined when it does not advertise one. */
  readonly paneCreateAllowed?: boolean;
  /** Cumulative stream counters for the stream health widget. */
  readonly linkStats?: Readonly<TerminalLinkStats>;
  /** Sends a keepalive ping to time the round trip; at most one is in flight. */
  pingLink?(nowMs: number): boolean;
  /** A bell arrived since the pane was last selected or focused. Absent on the demo. */
  readonly bellPending?: boolean;
  /** Clears `bellPending`. Absent on the demo. */
  acknowledgeBell?(): void;
  /** Whether a grid resize would be accepted now. False while disconnected or read-only. */
  readonly canResizeGrid: boolean;
  /** The raster tier last set. Absent on the demo, which always paints at full quality. */
  readonly renderQuality?: TerminalRenderQuality;
  setRenderQuality?(quality: TerminalRenderQuality): void;
  connect(): void;
  disconnect(): void;
  /** Paints pending output now instead of waiting for the next frame. Absent on the demo. */
  flush?(): void;
  /** Returns false when the input was rejected, for example while disconnected or read-only. */
  sendText(text: string): boolean;
  sendKey(key: string, modifiers?: KeyModifiers): boolean;
  /** DECCKM state, which selects between `ESC [` and `ESC O` arrow sequences. Absent on the demo. */
  readonly applicationCursor?: boolean;
  /** Returns false when the report was not sent. The demo always returns false. */
  sendMouse?(input: TerminalMouseInput): boolean;
  /** Local text selection. All four members are absent on the demo. */
  beginSelection?(cell: TerminalCellPosition): boolean;
  updateSelection?(cell: TerminalCellPosition): void;
  getSelectionText?(): string;
  clearSelection?(): void;
  /** Scrolls local history, or sends wheel reports to a mouse-aware application. Absent on the demo. */
  scroll?(lines: number, cell?: { col: number; row: number }): boolean;
  /** The mode the terminal application enabled. The demo always reports `none`. */
  readonly mouseTracking?: TerminalMouseTrackingMode;
  /** Sends text as one bracketed paste where the terminal supports it. Returns false when rejected. */
  paste(text: string): boolean;
  /** `moveDomFocus` false only reports focus to the streamer, leaving the page's DOM focus. */
  focus(focused: boolean, moveDomFocus?: boolean): void;
  /** Asks the server to resize the remote grid. Returns false when out of bounds or not allowed. */
  resizeGrid(cols: number, rows: number): boolean;
  setColorMode(mode: TerminalColorMode): void;
  /** Calls `listener` on any state change. Returns the function that unsubscribes it. */
  subscribe(listener: () => void): () => void;
  /** Closes the stream and releases the canvas. The surface cannot be reused. */
  dispose(): void;
}

/** Every selectable scene background, in picker order. */
export const BACKGROUND_MODES: readonly BackgroundMode[] = BACKGROUNDS.map(
  (background) => background.id,
);

/** One background id from the `BACKGROUNDS` table. */
export type BackgroundMode = BackgroundId;

/** Narrows a stored value to a `BackgroundMode`, so a mode removed from the list is ignored on load. */
export function isBackgroundMode(value: unknown): value is BackgroundMode {
  return (BACKGROUND_MODES as readonly unknown[]).includes(value);
}

/** The spatial arrangement presets that place attached terminal panels. */
export type PanelArrangement = 'row' | 'grid' | 'arc' | 'sphere';

/** A saved command that the Commands panel sends to the selected pane. */
export interface QuickCommand {
  id: string;
  label: string;
  text: string;
  /** Append Enter when running. */
  sendNewline: boolean;
  /** Set for workspace-scoped commands. Absent for global ones. */
  workspaceId?: string;
  /** Require a second select before running. */
  confirm?: boolean;
  pinned?: boolean;
}

/** Usage counters kept per server on this device. */
export interface QuickCommandStats {
  /** Epoch milliseconds. */
  lastRunAt: number;
  runCount: number;
}

/** A command as listed: the local commands plus the read-only shared ones from `/quick-commands.json`. */
export interface QuickCommandEntry extends QuickCommand, Partial<QuickCommandStats> {
  /** True for a shared command, which can run but cannot be pinned, edited or removed. */
  shared?: boolean;
}

/** The panes of one mux tree snapshot. */
export interface WorkspaceSnapshot {
  panes: PaneDescriptor[];
  /** Opaque revision from the streamer, when it reports one. */
  revision?: string;
}

/**
 * The shared actions that the browser drawer, desktop panels and XR scene all route through, so
 * every input path behaves the same. Optional members are wired only where the host supports
 * them: call them with `?.` and treat absence as "not available here".
 */
export interface WorkspaceActions {
  selectPane(id: string): void;
  closePane(id: string): void;
  /** Ask the streamer for one new default-shell terminal in a mux session. */
  createPane(sessionId: string): void;
  sendText(text: string): void;
  sendKey(key: string, modifiers?: KeyModifiers): void;
  sendMouse(paneId: string, input: TerminalMouseInput): boolean;
  scrollTerminal(paneId: string, lines: number, cell?: { col: number; row: number }): boolean;
  runCommand(command: QuickCommand, paneId: string): void;
  openKeyboard(): void;
  openCommands(): void;
  setXREntryMode(mode: XrEntryMode): void;
  exitPreview(): void;
  resizeGrid(paneId: string, cols: number, rows: number): boolean;
  setTerminalColorMode(mode: TerminalColorMode): void;
  setKeyboardBackground(enabled: boolean): void;
  reloadApp(): void;
  saveCommand(command: QuickCommand): boolean;
  removeCommand(id: string): boolean;
  togglePaneConnection(id: string): void;
  dictationAction(action: DictationAction): void;
  editDictation(text: string): void;
  /** One explicit host clipboard read through the dictation server's `/clipboard` route. */
  readHostClipboard(): Promise<HostClipboardResult<string>>;
  /** One explicit host clipboard write through the dictation server's `/clipboard` route. */
  writeHostClipboard(text: string): Promise<HostClipboardResult<number>>;
}
