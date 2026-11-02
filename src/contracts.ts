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

export interface KeyModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface TerminalSurface {
  readonly canvas: HTMLCanvasElement;
  readonly pane: PaneDescriptor;
  readonly revision: number;
  readonly dirtyRows?: Uint8Array;
  readonly cols: number;
  readonly rows: number;
  readonly status: TerminalStatus;
  readonly error: string | null;
  readonly canResizeGrid: boolean;
  connect(): void;
  disconnect(): void;
  flush?(): void;
  sendText(text: string): boolean;
  sendKey(key: string, modifiers?: KeyModifiers): boolean;
  paste(text: string): boolean;
  focus(focused: boolean): void;
  resizeGrid(cols: number, rows: number): boolean;
  setColorMode(mode: TerminalColorMode): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export type BackgroundMode = 'black' | 'gradient' | 'observatory';

export type PanelArrangement = 'row' | 'grid' | 'arc' | 'sphere';

export interface QuickCommand {
  id: string;
  label: string;
  text: string;
  sendNewline: boolean;
  workspaceId?: string;
}

export interface WorkspaceSnapshot {
  panes: PaneDescriptor[];
  revision?: string;
}

export interface WorkspaceActions {
  selectPane(id: string): void;
  closePane(id: string): void;
  sendText(text: string): void;
  sendKey(key: string, modifiers?: KeyModifiers): void;
  runCommand(command: QuickCommand, paneId: string): void;
  openKeyboard(): void;
  openCommands(): void;
  exitPreview?(): void;
  resizeGrid?(paneId: string, cols: number, rows: number): boolean;
  setTerminalColorMode?(mode: TerminalColorMode): void;
  setKeyboardBackground?(enabled: boolean): void;
  reloadApp?(): void;
  saveCommand?(command: QuickCommand): boolean;
  togglePaneConnection?(id: string): void;
}
