import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  PanelArrangement,
  QuickCommand,
  QuickCommandEntry,
  QuickCommandStats,
  TerminalColorMode,
  TerminalStatus,
  WorkspaceSnapshot,
} from '../contracts';
import { isBackgroundMode } from '../contracts';
import { getKeyHelp } from '../control-help';
import { HOST_CLIPBOARD_SETUP } from '../host-clipboard';
import { createModifierState, keyboardDimensions, keyboardKeys } from '../keyboard';
import {
  commandServerKey,
  copyCommand,
  isCommand,
  isSharedCommand,
  parseCommandFile,
  previewCommandText,
  serializeCommandFile,
  toSharedCommands,
} from '../quick-commands';
import type { DictationAction, DictationState } from '../speech-input';
import {
  DEFAULT_TERMINAL_FILTERING,
  type TerminalFiltering,
  validateTerminalFiltering,
} from '../terminal/filtering';
import { type PaneProcess, processBadge } from '../terminal/lifecycle';
import { terminalKeyLabel } from '../terminal/protocol';
import {
  AGE_TOKENS,
  AGENT_ROWS_CHOICES,
  AGENT_TOKENS,
  AGENTS_SORTS,
  type AgentRosterLayout,
  type AgentRosterRow,
  type AgentRowsChoice,
  type AgentsSort,
  agentRowLines,
  agentRowParts,
  agentRowsSignature,
  agentStateTone,
  agentTokenText,
  DEFAULT_AGENT_ROSTER_LAYOUT,
  parseAgentRows,
  resolveAgentRows,
} from '../workspace/agent-roster';
import {
  BUTTON_FUNCTION_LABELS,
  BUTTON_FUNCTIONS,
  CONTROLLER_BUTTON_LABELS,
  CONTROLLER_BUTTONS,
  type ControllerButton,
  DEFAULT_BUTTON_MAP,
} from '../workspace/controller-buttons';
import {
  DEFAULT_HIERARCHY_STYLE,
  type HierarchyStyle,
  validateHierarchyStyle,
} from '../workspace/hierarchy-style';
import { validateKeyboardCurvature } from '../workspace/keyboard-curvature';
import type { KeyborbMode } from '../workspace/keyborb';
import { validateKeyborbMode } from '../workspace/keyborb';
import type { PaneCreationState } from '../workspace/pane-create';
import {
  DEFAULT_WINDOW_PREFERENCES,
  validateWindowPreferences,
  type WindowPreferences,
} from '../workspace/window-preferences';

export type { SemanticKey } from '../keyboard';
export {
  createModifierState,
  keyboardDimensions,
  keyboardKeys,
  semanticKeyboardLayout,
} from '../keyboard';

export interface UICallbacks {
  onConnect(endpoint: string): void;
  onDisconnect?(): void;
  onSelectPane?(pane: PaneDescriptor): void;
  onClosePane?(pane: PaneDescriptor): void;
  onTogglePaneConnection?(pane: PaneDescriptor): void;
  onSendText?(paneId: string, text: string): void;
  onPaste?(paneId?: string): void;
  onHostToQuest?(): void;
  onQuestToHost?(): void;
  isHostClipboardPaired?(): boolean;
  /** Saves the host clipboard pairing secret, or forgets it when given null. */
  onHostClipboardSecret?(secret: string | null): boolean;
  onSendKey?(paneId: string, key: string, modifiers?: KeyModifiers): void;
  onRunCommand?(command: QuickCommand, paneId: string): void;
  onEnterXR?(): void;
  onPassthrough?(): void;
  onSettingsChange?(settings: WorkspaceSettings): void;
  onResetLayout?(): void;
  onDemo?(): void;
  onCommandsChange?(commands: QuickCommand[], scopeKey: string): void;
  onRefresh?(): void;
  onCreatePane?(sessionId: string): void;
  onKeyboardBackgroundChange?(enabled: boolean): void;
  onResizeGrid?(paneId: string, cols: number, rows: number): boolean;
  onTerminalCurvature?(paneId: string, degrees: number): void;
  onTerminalOpacity?(paneId: string, opacity: number): void;
  onTerminalReset?(paneId: string): void;
  onReloadApp?(): void;
  onArrange?(pattern: PanelArrangement): void;
  onMoveLayout?(direction: number): void;
  onWidgets?(): void;
  onDismissNotice?(): void;
  onDictationAction?(action: DictationAction): void;
  onDictationDraftChange?(text: string): void;
}

export interface WorkspaceSettings {
  version: 1;
  endpoint: string;
  background: BackgroundMode;
  gazeInput: boolean;
  colorMode: TerminalColorMode;
  keyboardBackground: boolean;
  keyboardCurvature: number;
  arrangement: PanelArrangement;
  filtering: TerminalFiltering;
  windowPreferences: WindowPreferences;
  hierarchyStyle: HierarchyStyle;
  keyborbMode: KeyborbMode;
  uiSounds: boolean;
  /** `#rrggbb` tint for the XR hands and arms, or empty for the default color. */
  handColor: string;
  /** par-mux `agent-rows` preset, or `custom` for {@link agentRowsCustom}. */
  agentRows: AgentRowsChoice;
  agentRowsCustom: string;
  agentsSort: AgentsSort;
}

/** The roster layout a settings value selects. */
export function agentRosterLayout(
  settings: Pick<WorkspaceSettings, 'agentRows' | 'agentRowsCustom' | 'agentsSort'>,
): AgentRosterLayout {
  return {
    rows: resolveAgentRows(settings.agentRows, settings.agentRowsCustom),
    sort: settings.agentsSort,
  };
}

export interface WorkspaceUI {
  update(snapshot: WorkspaceSnapshot): void;
  setConnection(status: TerminalStatus | 'idle', detail?: string): void;
  setDemoMode(enabled: boolean): void;
  setPaneCreation(state: PaneCreationState): void;
  /** Show the par-mux agent roster; each row selects its pane through the tree path. */
  setAgentRoster(rows: readonly AgentRosterRow[]): void;
  setActivePane(id: string | undefined): void;
  getSettings(): WorkspaceSettings;
  getCommands(): QuickCommand[];
  addCommand(command: QuickCommand): boolean;
  updateCommand(command: QuickCommand): boolean;
  removeCommand(id: string): void;
  deleteCommand(id: string): boolean;
  reorderCommands(from: number, to: number): void;
  captureCommandTarget(): string | undefined;
  destroy(): void;
  readonly sceneHost: HTMLElement;
  setAttachedPaneIds(ids: string[]): void;
  openInput(mode: 'commands' | 'keyboard'): void;
  closeInput(): void;
  setGazeInputEnabled(enabled: boolean): void;
  setXREntryMode(mode: 'vr' | 'ar'): void;
  setTerminalGrid(paneId: string, cols: number, rows: number, canResize: boolean): void;
  setTerminalCurvature(paneId: string, degrees: number): void;
  setTerminalOpacity(paneId: string, value: number): void;
  setPaneStatus?(paneId: string, status: TerminalStatus, process?: PaneProcess): void;
  setTerminalColorMode(mode: TerminalColorMode, persist?: boolean): void;
  setKeyboardBackgroundEnabled(enabled: boolean, persist?: boolean): void;
  getCommandsForPane(paneId: string): QuickCommandEntry[];
  recordCommandRun(id: string, at?: number): void;
  setSharedCommands(commands: QuickCommand[]): void;
  setUpdateAvailable(available: boolean): void;
  setNotice(message: string | null): void;
  setToast(message: string | null): void;
  setArrangement(pattern: PanelArrangement, persist?: boolean): void;
  setTerminalFiltering(filtering: TerminalFiltering, persist?: boolean): void;
  setWindowPreferences(value: WindowPreferences, persist?: boolean): void;
  setHierarchyStyle(style: HierarchyStyle, persist?: boolean): void;
  setKeyborbMode(mode: KeyborbMode, persist?: boolean): void;
  setUISounds(enabled: boolean, persist?: boolean): void;
  setBackground(mode: BackgroundMode, persist?: boolean): void;
  setFilteringCapabilities(maxAnisotropy: number): void;
  setDictationState(state: DictationState): void;
  setKeyboardCurvature(degrees: number, persist?: boolean): void;
}

export interface CommandStore {
  get(scopeKey: string): QuickCommand[];
  set(scopeKey: string, commands: QuickCommand[]): boolean;
  all(): Record<string, QuickCommand[]>;
  setAll(values: Record<string, QuickCommand[]>): boolean;
}

const SETTINGS_KEY = 'mux-xr:settings:v1';
// The swatch the color picker shows while the hands keep their default color.
const DEFAULT_HAND_SWATCH = '#b4b4b4';
const AGENT_AGE_REFRESH_MS = 15_000;
const COMMANDS_KEY = 'mux-xr:commands:v1';
const COMMAND_STATS_KEY = 'mux-xr:command-stats:v1';

export interface CommandStatsStore {
  get(server: string, id: string): QuickCommandStats | undefined;
  record(server: string, id: string, at: number): boolean;
}

export function createCommandStatsStore(
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): CommandStatsStore {
  const read = (): Record<string, QuickCommandStats> => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(COMMAND_STATS_KEY) ?? '{}');
      if (!parsed || typeof parsed !== 'object') return {};
      const result: Record<string, QuickCommandStats> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const entry = value as Partial<QuickCommandStats> | null;
        if (
          entry &&
          Number.isFinite(entry.lastRunAt) &&
          Number.isInteger(entry.runCount) &&
          Number(entry.runCount) > 0
        )
          result[key] = { lastRunAt: Number(entry.lastRunAt), runCount: Number(entry.runCount) };
      }
      return result;
    } catch {
      return {};
    }
  };
  return {
    get: (server, id) => read()[`${server}::${id}`],
    record(server, id, at) {
      const values = read();
      const key = `${server}::${id}`;
      values[key] = { lastRunAt: at, runCount: (values[key]?.runCount ?? 0) + 1 };
      try {
        storage?.setItem(COMMAND_STATS_KEY, JSON.stringify(values));
        return true;
      } catch {
        return false;
      }
    },
  };
}
const DEFAULT_SETTINGS: WorkspaceSettings = {
  version: 1,
  endpoint: '',
  background: 'observatory',
  gazeInput: false,
  colorMode: 'comfort',
  keyboardBackground: true,
  keyboardCurvature: 0,
  arrangement: 'arc',
  filtering: { ...DEFAULT_TERMINAL_FILTERING },
  windowPreferences: { ...DEFAULT_WINDOW_PREFERENCES },
  hierarchyStyle: DEFAULT_HIERARCHY_STYLE,
  keyborbMode: 'auto',
  uiSounds: true,
  handColor: '',
  agentRows: 'full',
  agentRowsCustom: '',
  agentsSort: DEFAULT_AGENT_ROSTER_LAYOUT.sort,
};

export function workspaceScope(endpoint: string, workspaceId: string): string {
  return `${commandServerKey(endpoint)}::${workspaceId}`;
}

/** Every saved command for one server, with workspaceId restored from its scope key. */
export function exportServerCommands(
  values: Record<string, QuickCommand[]>,
  endpoint: string,
): QuickCommand[] {
  const prefix = workspaceScope(endpoint, '');
  const result: QuickCommand[] = [];
  for (const [scope, commands] of Object.entries(values)) {
    if (!scope.startsWith(prefix)) continue;
    const workspaceId = scope.slice(prefix.length);
    for (const command of commands) {
      const { workspaceId: _ignored, ...rest } = copyCommand(command);
      result.push(workspaceId === '*' ? rest : { ...rest, workspaceId });
    }
  }
  return result;
}

/** Merges imported commands by id into one server's scopes; an imported command replaces any saved copy. */
export function mergeImportedCommands(
  values: Record<string, QuickCommand[]>,
  endpoint: string,
  imported: QuickCommand[],
): { values: Record<string, QuickCommand[]>; added: number; updated: number; skipped: number } {
  const prefix = workspaceScope(endpoint, '');
  const next: Record<string, QuickCommand[]> = {};
  for (const [scope, commands] of Object.entries(values)) next[scope] = [...commands];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const command of imported) {
    if (isSharedCommand(command) || !isCommand(command) || seen.has(command.id)) {
      skipped++;
      continue;
    }
    seen.add(command.id);
    const scope = workspaceScope(endpoint, command.workspaceId ?? '*');
    let existed = false;
    for (const [key, commands] of Object.entries(next)) {
      if (key === scope || !key.startsWith(prefix)) continue;
      const kept = commands.filter((item) => item.id !== command.id);
      if (kept.length !== commands.length) existed = true;
      next[key] = kept;
    }
    const list = next[scope] ?? [];
    const index = list.findIndex((item) => item.id === command.id);
    if (index >= 0) list[index] = copyCommand(command);
    else list.push(copyCommand(command));
    next[scope] = list;
    if (existed || index >= 0) updated++;
    else added++;
  }
  return { values: next, added, updated, skipped };
}

function normalizeScopeKey(scope: string): string {
  const split = scope.lastIndexOf('::');
  if (split < 0) return scope;
  return workspaceScope(scope.slice(0, split), scope.slice(split + 2));
}

export function reorderCommands(
  commands: QuickCommand[],
  from: number,
  to: number,
): QuickCommand[] {
  if (from < 0 || from >= commands.length || to < 0 || to >= commands.length || from === to)
    return [...commands];
  const result = [...commands];
  const [command] = result.splice(from, 1);
  result.splice(to, 0, command);
  return result;
}

/** A lowercase `#rrggbb` color, or empty (the default) for anything else. */
export function validateHandColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
}

export function validateSettings(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const candidate = value as Partial<WorkspaceSettings>;
  return {
    version: 1,
    endpoint: typeof candidate.endpoint === 'string' ? candidate.endpoint : '',
    background: isBackgroundMode(candidate.background)
      ? candidate.background
      : DEFAULT_SETTINGS.background,
    gazeInput: candidate.gazeInput === true,
    colorMode:
      candidate.colorMode === 'original' || candidate.colorMode === 'monochrome'
        ? candidate.colorMode
        : 'comfort',
    keyboardBackground: candidate.keyboardBackground !== false,
    keyboardCurvature: validateKeyboardCurvature(candidate.keyboardCurvature),
    filtering: validateTerminalFiltering(candidate.filtering),
    windowPreferences: validateWindowPreferences(candidate.windowPreferences),
    hierarchyStyle: validateHierarchyStyle(candidate.hierarchyStyle),
    keyborbMode: validateKeyborbMode(candidate.keyborbMode),
    uiSounds: candidate.uiSounds !== false,
    handColor: validateHandColor(candidate.handColor),
    agentRows: AGENT_ROWS_CHOICES.includes(candidate.agentRows as AgentRowsChoice)
      ? (candidate.agentRows as AgentRowsChoice)
      : DEFAULT_SETTINGS.agentRows,
    agentRowsCustom:
      typeof candidate.agentRowsCustom === 'string' ? candidate.agentRowsCustom.slice(0, 500) : '',
    agentsSort: AGENTS_SORTS.includes(candidate.agentsSort as AgentsSort)
      ? (candidate.agentsSort as AgentsSort)
      : DEFAULT_SETTINGS.agentsSort,
    arrangement:
      candidate.arrangement === 'row' ||
      candidate.arrangement === 'grid' ||
      candidate.arrangement === 'sphere' ||
      candidate.arrangement === 'arc'
        ? candidate.arrangement
        : DEFAULT_SETTINGS.arrangement,
  };
}

export function createCommandStore(
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): CommandStore {
  const read = (): Record<string, QuickCommand[]> => {
    if (!storage) return {};
    try {
      const parsed: unknown = JSON.parse(storage.getItem(COMMANDS_KEY) ?? '{}');
      if (!parsed || typeof parsed !== 'object') return {};
      const result: Record<string, QuickCommand[]> = {};
      let migrated = false;
      for (const [scope, value] of Object.entries(parsed)) {
        if (!Array.isArray(value)) continue;
        const key = normalizeScopeKey(scope);
        if (key !== scope) migrated = true;
        const merged = result[key] ?? [];
        for (const command of value.filter(isCommand).map(copyCommand))
          if (!merged.some((item) => item.id === command.id)) merged.push(command);
        result[key] = merged;
      }
      if (migrated) write(result);
      return result;
    } catch {
      return {};
    }
  };
  const write = (values: Record<string, QuickCommand[]>): boolean => {
    try {
      storage?.setItem(COMMANDS_KEY, JSON.stringify(values));
      return true;
    } catch {
      return false;
    }
  };
  return {
    get(scopeKey) {
      return read()[scopeKey] ?? [];
    },
    all: read,
    setAll(values) {
      const next: Record<string, QuickCommand[]> = {};
      for (const [scope, commands] of Object.entries(values))
        if (commands.length) next[scope] = commands.filter(isCommand).map(copyCommand);
      return write(next);
    },
    set(scopeKey, commands) {
      const values = read();
      const next = commands.filter(isCommand).map(copyCommand);
      const previous = values[scopeKey];
      values[scopeKey] = next;
      if (write(values)) return true;
      if (previous) values[scopeKey] = previous;
      else delete values[scopeKey];
      return false;
    },
  };
}

export function loadSettings(
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): WorkspaceSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    return validateSettings(JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function icon(name: 'close' | 'link' | 'xr' | 'send' | 'plus' | 'settings'): string {
  const paths: Record<string, string> = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10 6"/><path d="M14 11a5 5 0 0 0-7.1-.1L5.5 12.3a5 5 0 0 0 7.1 7.1L14 18"/>',
    xr: '<path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-4.6 1.3L14 14h-4l-1.4 1.8A2.5 2.5 0 0 1 4 14.5v-5Z"/><circle cx="8" cy="11" r="1"/><circle cx="16" cy="11" r="1"/>',
    send: '<path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings:
      '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19 13 1.2 1-.9 1.6-1.5-.4a7.8 7.8 0 0 1-1.5 1l-.2 1.5h-1.9l-.5-1.4a7.8 7.8 0 0 1-1.9 0l-.5 1.4h-1.9l-.2-1.5a7.8 7.8 0 0 1-1.5-1l-1.5.4-.9-1.6L6 13a7.8 7.8 0 0 1 0-2L4.8 10l.9-1.6 1.5.4a7.8 7.8 0 0 1 1.5-1l.2-1.5h1.9l.5 1.4a7.8 7.8 0 0 1 1.9 0l.5-1.4h1.9l.2 1.5a7.8 7.8 0 0 1 1.5 1l1.5-.4.9 1.6-1.2 1a7.8 7.8 0 0 1 0 2Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function connectionActionLabel(status: TerminalStatus | undefined): string {
  return status === undefined || status === 'connected' || status === 'connecting'
    ? 'Disconnect'
    : 'Reconnect';
}

function connectionActionTitle(title: string, status: TerminalStatus | undefined): string {
  return status === undefined || status === 'connected' || status === 'connecting'
    ? `Disconnect ${title} view without stopping the terminal`
    : `Reconnect ${title} view to the running terminal`;
}

export function mountWorkspaceUI(container: HTMLElement, callbacks: UICallbacks): WorkspaceUI {
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
  let settings = loadSettings(storage);
  if (!settings.endpoint && typeof location !== 'undefined')
    settings = { ...settings, endpoint: location.origin };
  let snapshot: WorkspaceSnapshot = { panes: [] };
  let activePaneId: string | undefined;
  let attachedPaneIds: string[] = [];
  let paneCreation: PaneCreationState = { available: true, pending: false };
  let agentRows: AgentRosterRow[] = [];
  let agentSignature = '';
  let agentRenderDeferred = false;
  let agentRenderedOrder = '';
  let agentRenderedAges = '';
  const paneStatuses = new Map<string, TerminalStatus>();
  const paneProcesses = new Map<string, PaneProcess>();
  const paneBadge = (paneId: string): string | null =>
    processBadge(paneProcesses.get(paneId), paneStatuses.get(paneId));
  let commands: QuickCommand[] = [];
  let sharedCommands: QuickCommand[] = [];
  let commandScope = 'global';
  const terminalGrid = new Map<string, { cols: number; rows: number; canResize: boolean }>();
  const terminalCurvature = new Map<string, number>();
  const terminalOpacity = new Map<string, number>();
  const pendingGrid = new Map<string, { cols: number; rows: number }>();
  let inputMode: 'commands' | 'keyboard' = 'commands';
  let dictationState: DictationState | undefined;
  const modifierState = createModifierState();
  const holdTimers = new Map<HTMLButtonElement, number>();
  const keyboardLabel = (key: string, shift = false): string => {
    if (key.length === 1 && key !== ' ') return terminalKeyLabel(key, shift);
    return keyboardKeys.find((entry) => entry.key === key)?.label ?? key;
  };
  const keyboardTitle = (key: string): string => getKeyHelp(key) ?? '';
  const syncModifierVisuals = (): void => {
    for (const key of root.querySelectorAll<HTMLButtonElement>('.key')) {
      const modifier = key.dataset.modifier as 'ctrl' | 'alt' | 'shift' | undefined;
      if (modifier) {
        const active = Boolean(modifierState.active[modifier]);
        const locked = Boolean(modifierState.locked[modifier]);
        key.classList.toggle('active', active);
        key.classList.toggle('locked', locked);
        key.setAttribute('aria-pressed', String(active));
        key.title = locked
          ? `${key.textContent ?? modifier} locked (click to unlock)`
          : keyboardTitle(key.dataset.key ?? '');
      } else {
        key.textContent = keyboardLabel(key.dataset.key ?? '', Boolean(modifierState.active.shift));
      }
    }
  };
  const clearModifiers = (): void => {
    for (const timer of holdTimers.values()) window.clearTimeout(timer);
    holdTimers.clear();
    modifierState.clear();
    for (const key of root.querySelectorAll<HTMLButtonElement>('.key'))
      delete key.dataset.longPressed;
    syncModifierVisuals();
  };
  let capturedTarget: string | undefined;
  const root = document.createElement('section');
  root.className = 'mux-ui';
  const keyboardMarkup = keyboardKeys
    .map(
      (entry) =>
        `<button class="key" data-key="${escapeHtml(entry.key)}" data-modifier="${entry.modifier ?? ''}" style="--key-x:${entry.x};--key-y:${entry.y};--key-width:${entry.width};--key-height:${entry.height}" aria-pressed="false" aria-label="${escapeHtml(entry.key === 'Backspace' ? 'Backspace' : entry.label)}" title="${escapeHtml(keyboardTitle(entry.key))}">${escapeHtml(entry.label)}</button>`,
    )
    .join('');
  root.innerHTML = `<style>${CSS}</style><header class="mux-top"><div class="brand"><span class="brand-mark">M</span><span>MUX / XR</span><span class="demo-badge" hidden>DEMO</span></div><div class="connection"><span class="status-dot"></span><span class="status-copy">Ready to connect</span></div><div class="top-actions"><button data-action="demo" class="quiet">Demo</button><button data-action="xr" class="quiet" aria-label="Enter immersive XR">${icon('xr')} Enter XR</button><button data-action="settings" class="icon-btn" aria-label="Open settings" title="Open workspace settings">${icon('settings')}</button></div></header><div class="mux-body"><aside class="sidebar"><section class="agents" data-agents-section hidden aria-label="Agent roster"><div class="side-heading"><span>Agents <span data-agent-count></span></span><button data-action="agents-sort" class="mini-text" aria-label="Agent order" title="Change the agent order"></button></div><div class="agent-list" data-agents></div></section><div class="side-heading"><span>Workspace</span><button data-action="refresh" class="mini-btn" aria-label="Refresh panes" title="Refresh workspace panes">${icon('settings')}</button></div><div class="tree" data-tree><div class="empty-tree">Connect to see panes</div></div><div class="setup"><label for="endpoint">Streamer endpoint</label><div class="endpoint-row"><input id="endpoint" type="url" placeholder="wss://your-computer.local/stream" autocomplete="url"><button data-action="connect" class="connect-btn" aria-label="Connect" title="Connect to the streamer endpoint">${icon('link')}</button></div><p class="hint">LAN WSS or WS endpoint. Creates default-shell terminals only when the streamer allows it.</p></div></aside><main class="stage"><div class="stage-head"><div><h1>Terminal workspace</h1><p class="stage-sub" data-detail>Select a pane to begin monitoring.</p></div><div class="stage-tools"><button data-action="commands" class="secondary">Commands</button><button data-action="keyboard" class="secondary">Keyboard</button></div></div><div class="update-notice" data-update-notice hidden role="status"><span>Update available</span><button data-action="reload-update" class="secondary" aria-label="Reload to apply update" title="Reload to apply the available update">Reload</button></div><div class="workspace-notice" data-notice hidden role="status"><span data-notice-text></span><button data-action="dismiss-notice" class="icon-btn" aria-label="Dismiss notice" title="Dismiss notice">×</button></div><div class="panes" data-panes><div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div></div><div class="scene-host" data-scene-host aria-label="XR scene host"></div></main></div><div class="drawer" data-drawer hidden><div class="drawer-head"><strong data-drawer-heading>Commands</strong><button data-action="close-drawer" class="icon-btn" aria-label="Close drawer" title="Close input drawer">${icon('close')}</button></div><div class="command-row" data-command-controls><select data-command-scope aria-label="Command scope"><option value="global">Global commands</option><option value="workspace">Workspace commands</option></select><select data-command-select aria-label="Quick command"><option value="">Choose a quick command</option></select><button data-action="run-command" class="send-btn" title="Run the selected quick command">Run</button></div><div class="command-edit" data-command-controls><button data-action="add-command" class="text-btn" title="Create a new quick command">${icon('plus')} Add command</button><button data-action="remove-command" class="text-btn" title="Delete the selected quick command">Remove selected</button><button data-action="pin-command" class="text-btn" title="Pin or unpin the selected quick command in XR">Pin / unpin</button><button data-action="export-commands" class="text-btn" title="Download every quick command for this server as JSON">Export</button><button data-action="import-commands" class="text-btn" title="Merge quick commands from an exported JSON file">Import</button><input type="file" accept="application/json,.json" data-command-import hidden></div><div class="compose-row" data-keyboard-controls><textarea data-compose rows="2" placeholder="Compose text for the selected pane" aria-label="Compose terminal text"></textarea><button data-action="send-text" class="send-btn" aria-label="Send composed text" title="Send composed text to the selected pane">${icon('send')}</button></div><div class="keyboard" data-keyboard data-keyboard-controls>${keyboardMarkup}</div></div><div class="settings-panel" data-settings hidden><div class="drawer-head"><strong>Workspace settings</strong><button data-action="close-settings" class="icon-btn" aria-label="Close settings" title="Close settings">${icon('close')}</button></div><label>Background<select data-background><option value="observatory">Observatory</option><option value="gradient">Gradient</option><option value="black">Black</option><option value="hangar">Hangar deck</option><option value="deep-water">Deep-water station</option><option value="studio">Minimal studio</option><option value="desert">Desert night</option></select></label><label class="check"><input type="checkbox" data-gaze> Gaze emphasis <span>Highlight the pane at the center of your view.</span></label><button data-action="passthrough" class="secondary">Enter passthrough</button><button data-action="reset" class="text-btn" title="Reset pane layout without deleting commands">Reset local arrangement</button></div>`;
  const keyboardElement = root.querySelector<HTMLElement>('[data-keyboard]');
  root
    .querySelector('style')
    ?.append(
      document.createTextNode(
        '.dictation-controls:not([hidden]){display:grid;gap:8px}.dictation-actions{display:flex;flex-wrap:wrap;gap:8px}.dictation-controls textarea{box-sizing:border-box;width:100%;min-height:72px;resize:vertical;background:#0b1016;color:#dce7ed;border:1px solid #3a5363;border-radius:4px;padding:8px;font:inherit}.dictation-controls textarea:focus-visible{outline:2px solid #8be0ea;outline-offset:2px}[data-host-clipboard]{display:grid;gap:8px}[data-host-clipboard] input{box-sizing:border-box;width:100%;margin-top:6px;background:#0b1016;border:1px solid #293746;border-radius:5px;color:#edf4f8;padding:9px;font:12px ui-monospace,SFMono-Regular,monospace}[data-host-clipboard-status]{color:#9aabb6;font-size:11px;line-height:1.5;overflow-wrap:anywhere}',
      ),
    );
  const drawer = root.querySelector<HTMLElement>('[data-drawer]');
  const toast = document.createElement('div');
  toast.className = 'mux-clipboard-toast';
  toast.dataset.clipboardToast = 'true';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  root.append(toast);
  root
    .querySelector('style')
    ?.append(
      document.createTextNode(
        '.mux-clipboard-toast{position:fixed;right:20px;bottom:20px;max-width:min(28rem,calc(100vw - 40px));z-index:100;pointer-events:none;padding:12px 16px;border:1px solid #3a5363;border-radius:8px;background:#17212d;color:#dce7ed;font-size:14px}',
      ),
    );
  const dictationControls = document.createElement('div');
  dictationControls.dataset.keyboardControls = 'true';
  dictationControls.className = 'dictation-controls';
  dictationControls.innerHTML =
    '<div class="dictation-actions"><button data-action="dictation-start" class="secondary">Dictate</button><button data-action="dictation-stop" class="secondary" hidden>Stop</button><button data-action="dictation-insert" class="send-btn" disabled>Insert text</button><button data-action="dictation-clear" class="text-btn" hidden title="Clear the reviewed dictation text">Clear</button><button data-action="dictation-cancel" class="text-btn">Cancel</button></div><textarea data-dictation-draft rows="3" aria-label="Dictation transcript" placeholder="Dictation transcript appears here for review" disabled></textarea><small data-dictation-status>Speech input is idle.</small>';
  drawer?.append(dictationControls);
  const paste = document.createElement('button');
  paste.dataset.action = 'paste-clipboard';
  paste.className = 'secondary';
  paste.textContent = 'Paste';
  paste.title = 'Paste clipboard text into the selected terminal';
  dictationControls.querySelector('.dictation-actions')?.prepend(paste);
  const hostToQuest = document.createElement('button');
  hostToQuest.dataset.action = 'host-to-quest';
  hostToQuest.className = 'secondary';
  hostToQuest.textContent = 'Host → Quest';
  hostToQuest.title = "Copy the Mac's clipboard text into the Quest clipboard";
  const questToHost = document.createElement('button');
  questToHost.dataset.action = 'quest-to-host';
  questToHost.className = 'secondary';
  questToHost.textContent = 'Quest → Host';
  questToHost.title = "Send the Quest clipboard text to the Mac's clipboard";
  paste.after(hostToQuest, questToHost);
  const gazeInput = document.createElement('label');
  gazeInput.className = 'check';
  gazeInput.dataset.keyboardControls = 'true';
  gazeInput.title =
    'Use head direction to choose the keyboard target after a short dwell. Looking at the keyboard keeps the last pane target.';
  gazeInput.innerHTML =
    '<input type="checkbox" data-gaze-input> Gaze keyboard input <span>In XR, looking at a pane briefly makes it the keyboard target. Off keeps manual selection.</span>';
  drawer?.append(gazeInput);
  if (keyboardElement) {
    keyboardElement.style.setProperty('--keyboard-width', String(keyboardDimensions.width));
    keyboardElement.style.setProperty('--keyboard-height', String(keyboardDimensions.height));
    root
      .querySelector('style')
      ?.append(
        '.keyboard{position:relative;display:block;width:min(100%,calc(var(--keyboard-width)*1em));aspect-ratio:var(--keyboard-width)/var(--keyboard-height);min-height:170px}.key{position:absolute;left:calc(var(--key-x)/var(--keyboard-width)*100%);top:calc(var(--key-y)/var(--keyboard-height)*100%);width:calc(var(--key-width)/var(--keyboard-width)*100%);height:calc(var(--key-height)/var(--keyboard-height)*100%);min-height:0}',
      );
  }
  container.replaceChildren(root);
  const updateNotice =
    root.querySelector<HTMLElement>('[data-update-notice]') ?? document.createElement('div');
  updateNotice.style.cssText =
    'align-items:center;gap:10px;margin:-8px 0 18px;color:var(--muted);font-size:12px';
  root
    .querySelector('style')
    ?.append(
      '.workspace-notice{display:flex;align-items:center;gap:9px;margin:-8px 0 16px;padding:8px 10px;background:#17212ddd;border:1px solid #38505e;border-radius:6px;color:var(--text);font-size:12px}.workspace-notice span{flex:1}',
    );
  if (!updateNotice.parentElement) {
    updateNotice.className = 'update-notice';
    updateNotice.hidden = true;
    updateNotice.setAttribute('role', 'status');
    updateNotice.innerHTML =
      '<span>Update available</span><button data-action="reload-update" class="secondary" aria-label="Reload to apply update" title="Reload to apply the available update">Reload</button>';
    root.querySelector('.stage-head')?.after(updateNotice);
  }
  const widgetsButton = document.createElement('button');
  widgetsButton.className = 'secondary';
  widgetsButton.dataset.action = 'widgets';
  widgetsButton.textContent = 'Widgets';
  widgetsButton.title = 'Open movable clock widgets';
  widgetsButton.addEventListener('click', () => callbacks.onWidgets?.());
  root.querySelector('.stage-tools')?.append(widgetsButton);
  const settingsPanel = root.querySelector<HTMLElement>('[data-settings]');
  root.querySelector('[data-gaze]')?.parentElement?.remove();
  let arrangementSelect: HTMLSelectElement | null = null;
  let arrangementApply: HTMLButtonElement | null = null;
  let hierarchyStyleSelect: HTMLSelectElement | null = null;
  let agentSortSelect: HTMLSelectElement | null = null;
  let keyborbModeSelect: HTMLSelectElement | null = null;
  let filteringMaxAnisotropy = 16;
  let updateWindowPreferenceControls = (): void => undefined;
  const updateArrangementAvailability = (): void => {
    if (arrangementApply) arrangementApply.disabled = attachedPaneIds.length === 0;
  };
  if (settingsPanel) {
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Terminal colors';
    const colorSelect = document.createElement('select');
    colorSelect.dataset.colorMode = 'true';
    colorSelect.setAttribute('aria-label', 'Terminal color mode');
    colorSelect.innerHTML =
      '<option value="comfort">Comfort colors</option><option value="original">Original colors</option><option value="monochrome">Monochrome</option>';
    colorLabel.append(colorSelect);
    settingsPanel.insertBefore(
      colorLabel,
      settingsPanel.querySelector('[data-background]')?.parentElement ?? null,
    );
    const keyboardBackground = document.createElement('label');
    keyboardBackground.className = 'check';
    keyboardBackground.innerHTML =
      '<input type="checkbox" data-keyboard-background> Keyboard background <span>Show the keyboard panel background in XR.</span>';
    settingsPanel.insertBefore(
      keyboardBackground,
      settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
    );
    const keyboardCurvature = document.createElement('label');
    keyboardCurvature.innerHTML =
      '<span>Keyboard curvature <span data-keyboard-curvature-value>0°</span></span><input data-keyboard-curvature type="range" min="0" max="100" step="1" aria-label="Keyboard curvature in degrees">';
    settingsPanel.insertBefore(
      keyboardCurvature,
      settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
    );
    const keyboardCurvatureInput = keyboardCurvature.querySelector<HTMLInputElement>(
      '[data-keyboard-curvature]',
    );
    const keyboardCurvatureValue = keyboardCurvature.querySelector<HTMLElement>(
      '[data-keyboard-curvature-value]',
    );
    if (!keyboardCurvatureInput || !keyboardCurvatureValue)
      throw new Error('Keyboard curvature control missing');
    const updateKeyboardCurvature = (): void => {
      keyboardCurvatureInput.value = String(settings.keyboardCurvature);
      keyboardCurvatureValue.textContent = `${settings.keyboardCurvature}°`;
    };
    keyboardCurvatureInput.addEventListener('input', () => {
      settings = {
        ...settings,
        keyboardCurvature: validateKeyboardCurvature(Number(keyboardCurvatureInput.value)),
      };
      updateKeyboardCurvature();
      saveSettings();
    });
    updateKeyboardCurvature();
    const keyborb = document.createElement('label');
    keyborb.innerHTML =
      '<span>Keyborb</span><select data-keyborb-mode aria-label="Keyborb"><option value="off">Off</option><option value="on">On</option><option value="auto">Auto</option></select><small>Auto uses Keyborb with hand tracking.</small>';
    settingsPanel.insertBefore(
      keyborb,
      settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
    );
    keyborbModeSelect = keyborb.querySelector('[data-keyborb-mode]');
    if (!keyborbModeSelect) throw new Error('Keyborb control missing');
    keyborbModeSelect.value = settings.keyborbMode;
    const uiSounds = document.createElement('label');
    uiSounds.className = 'check';
    uiSounds.innerHTML =
      '<input type="checkbox" data-ui-sounds> UI sounds <span>Play short clicks in XR and pulse the controllers on presses, grabs and scrolling.</span>';
    settingsPanel.insertBefore(
      uiSounds,
      settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
    );
    const handColor = document.createElement('div');
    handColor.innerHTML =
      '<label for="mux-hand-color">Hand and arm color</label><div class="hand-color-row"><input id="mux-hand-color" type="color" data-hand-color><button type="button" data-action="hand-color-default" class="text-btn" title="Use the default hand color">Default</button></div>';
    settingsPanel.insertBefore(
      handColor,
      settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
    );
    const handColorInput = handColor.querySelector<HTMLInputElement>('[data-hand-color]');
    const handColorDefault = handColor.querySelector<HTMLButtonElement>(
      '[data-action="hand-color-default"]',
    );
    if (!handColorInput || !handColorDefault) throw new Error('Hand color control missing');
    const updateHandColor = (): void => {
      handColorInput.value = settings.handColor || DEFAULT_HAND_SWATCH;
      handColorDefault.disabled = !settings.handColor;
    };
    handColorInput.addEventListener('input', () => {
      settings = { ...settings, handColor: validateHandColor(handColorInput.value) };
      updateHandColor();
      saveSettings();
    });
    handColorDefault.addEventListener('click', () => {
      settings = { ...settings, handColor: '' };
      updateHandColor();
      saveSettings();
    });
    updateHandColor();
    const filteringControls = document.createElement('div');
    filteringControls.innerHTML =
      '<label>Terminal filtering<select data-filter-mode aria-label="Terminal filtering"><option value="nearest">Nearest pixels</option><option value="linear">Linear (sharp)</option><option value="mipmap-nearest">Mipmap bilinear</option><option value="mipmap-linear">Mipmap trilinear (smooth)</option></select></label><label data-filter-anisotropy-row>Anisotropy (mipmap modes)<select data-filter-anisotropy aria-label="Terminal anisotropy"><option value="1">Off</option><option value="2">2x</option><option value="4">4x</option><option value="8">8x</option><option value="16">16x</option></select><span>Anisotropy matters for oblique minification. 8x and 16x may look the same front-facing.</span></label><label class="check"><input type="checkbox" data-filter-gaze> Sharper gazed terminal <span>Use sharp linear sampling while looking at a terminal.</span></label><label data-filter-distance-row>Gaze max distance<input data-filter-distance type="number" min="0.25" max="20" step="0.25" aria-label="Gaze maximum distance in meters"><span>Sharper gaze ignores mipmaps within this distance.</span></label>';
    settingsPanel.insertBefore(
      filteringControls,
      settingsPanel.querySelector('[data-action="passthrough"]'),
    );
    const filterMode = filteringControls.querySelector<HTMLSelectElement>('[data-filter-mode]');
    const filterAnisotropy = filteringControls.querySelector<HTMLSelectElement>(
      '[data-filter-anisotropy]',
    );
    const filterGaze = filteringControls.querySelector<HTMLInputElement>('[data-filter-gaze]');
    const filterDistance =
      filteringControls.querySelector<HTMLInputElement>('[data-filter-distance]');
    const filterAnisotropyRow = filteringControls.querySelector<HTMLElement>(
      '[data-filter-anisotropy-row]',
    );
    const filterDistanceRow = filteringControls.querySelector<HTMLElement>(
      '[data-filter-distance-row]',
    );
    if (
      !filterMode ||
      !filterAnisotropy ||
      !filterGaze ||
      !filterDistance ||
      !filterAnisotropyRow ||
      !filterDistanceRow
    )
      throw new Error('Filtering controls missing');
    const updateFilteringVisibility = (): void => {
      const mipmapMode =
        filterMode.value === 'mipmap-nearest' || filterMode.value === 'mipmap-linear';
      filterAnisotropyRow.hidden = !mipmapMode;
      filterDistanceRow.hidden = !mipmapMode || !filterGaze.checked;
    };
    const changeFiltering = (): void => {
      settings = {
        ...settings,
        filtering: validateTerminalFiltering({
          mode: filterMode.value,
          anisotropy: Number(filterAnisotropy.value),
          gazeClarity: filterGaze.checked,
          gazeMaxDistance: Number(filterDistance.value),
        }),
      };
      filterDistance.value = String(settings.filtering.gazeMaxDistance);
      updateFilteringVisibility();
      saveSettings();
    };
    filterMode.addEventListener('change', changeFiltering);
    filterAnisotropy.addEventListener('change', changeFiltering);
    filterGaze.addEventListener('change', changeFiltering);
    filterDistance.addEventListener('change', changeFiltering);
    filterMode.value = settings.filtering.mode;
    filterAnisotropy.value = String(settings.filtering.anisotropy);
    filterGaze.checked = settings.filtering.gazeClarity;
    filterDistance.value = String(settings.filtering.gazeMaxDistance);
    updateFilteringVisibility();
    const hierarchyStyle = document.createElement('label');
    hierarchyStyle.innerHTML =
      '<span>Hierarchy style</span><select data-hierarchy-style aria-label="Hierarchy style"><option value="helix">Helix Navigator</option><option value="spatial-docks">Spatial Docks</option></select>';
    settingsPanel.insertBefore(
      hierarchyStyle,
      settingsPanel.querySelector('[data-action="passthrough"]'),
    );
    hierarchyStyleSelect = hierarchyStyle.querySelector('[data-hierarchy-style]');
    if (!hierarchyStyleSelect) throw new Error('Hierarchy style control missing');
    hierarchyStyleSelect.value = settings.hierarchyStyle;
    const agentControls = document.createElement('fieldset');
    agentControls.dataset.agentRoster = 'true';
    agentControls.innerHTML = `<legend>Agent roster</legend><label>Rows<select data-agent-rows aria-label="Agent roster rows"><option value="full">Full (state, agent, title / workspace, project, pane / message)</option><option value="default">par-mux default (state, workspace, project / agent)</option><option value="compact">Compact (state, agent)</option><option value="detailed">Detailed (state, workspace, project / agent, pane)</option><option value="verbose">Verbose (state, agent / message)</option><option value="custom">Custom</option></select></label><label data-agent-rows-custom-row>Custom rows<input data-agent-rows-custom type="text" spellcheck="false" placeholder="state_icon, workspace, project / agent" aria-label="Custom agent roster rows"><small data-agent-rows-hint></small></label><label>Order<select data-agents-sort aria-label="Agent order"><option value="pane">Pane (rows stay put)</option><option value="grouped">Grouped by workspace, urgent first</option><option value="priority">Priority, most urgent first</option></select></label>`;
    settingsPanel.insertBefore(agentControls, settingsPanel.querySelector('[data-action="reset"]'));
    const hostClipboard = document.createElement('fieldset');
    hostClipboard.dataset.hostClipboard = 'true';
    hostClipboard.innerHTML =
      '<legend>Host clipboard</legend><label>Pairing secret<input data-host-clipboard-secret type="password" autocomplete="off" spellcheck="false" aria-label="Host clipboard pairing secret" placeholder="Contents of .local/clipboard-secret"></label><div class="dictation-actions"><button data-action="host-clipboard-save" class="secondary">Save</button><button data-action="host-clipboard-forget" class="text-btn" title="Remove the pairing secret from this browser">Forget</button></div><small data-host-clipboard-status></small>';
    settingsPanel.insertBefore(hostClipboard, settingsPanel.querySelector('[data-action="reset"]'));
    const agentRowsSelect = agentControls.querySelector<HTMLSelectElement>('[data-agent-rows]');
    const agentRowsCustom = agentControls.querySelector<HTMLInputElement>(
      '[data-agent-rows-custom]',
    );
    const agentRowsCustomRow = agentControls.querySelector<HTMLElement>(
      '[data-agent-rows-custom-row]',
    );
    const agentRowsHint = agentControls.querySelector<HTMLElement>('[data-agent-rows-hint]');
    agentSortSelect = agentControls.querySelector('[data-agents-sort]');
    if (
      !agentRowsSelect ||
      !agentRowsCustom ||
      !agentRowsCustomRow ||
      !agentRowsHint ||
      !agentSortSelect
    )
      throw new Error('Agent roster controls missing');
    const sortSelect = agentSortSelect;
    const updateAgentControls = (): void => {
      agentRowsSelect.value = settings.agentRows;
      agentRowsCustom.value = settings.agentRowsCustom;
      sortSelect.value = settings.agentsSort;
      agentRowsCustomRow.hidden = settings.agentRows !== 'custom';
      const { rows, unknown } = parseAgentRows(settings.agentRowsCustom);
      agentRowsHint.textContent = `${
        unknown.length ? `Unknown, skipped: ${unknown.join(', ')}. ` : ''
      }${rows.length ? '' : 'No known token yet, so the Full rows show. '}Separate lines with / and tokens with commas. Tokens: ${AGENT_TOKENS.join(', ')}.`;
      agentRowsHint.classList.toggle('warn', unknown.length > 0);
    };
    const changeAgentLayout = (): void => {
      settings = {
        ...settings,
        agentRows: validateSettings({ ...settings, agentRows: agentRowsSelect.value }).agentRows,
        agentRowsCustom: agentRowsCustom.value.slice(0, 500),
        agentsSort: validateSettings({ ...settings, agentsSort: sortSelect.value }).agentsSort,
      };
      updateAgentControls();
      saveSettings();
      renderAgents();
    };
    agentRowsSelect.addEventListener('change', changeAgentLayout);
    agentRowsCustom.addEventListener('change', changeAgentLayout);
    sortSelect.addEventListener('change', changeAgentLayout);
    updateAgentControls();
    const windowControls = document.createElement('div');
    windowControls.dataset.windowPreferences = 'true';
    windowControls.innerHTML =
      '<fieldset><legend>Window and focus preferences</legend><label>New window glass opacity <span data-window-opacity-value>100%</span><input data-window-opacity type="range" min="10" max="100" step="1" aria-label="New window glass opacity percentage"><small>Applies to new windows only. Existing panes are unchanged.</small></label><label>New window warp <span data-window-warp-value>0°</span><input data-window-warp type="range" min="0" max="100" step="5" aria-label="New window curvature in degrees"><small>Applies to new windows only. Existing panes are unchanged.</small></label><label>Focus distance <span data-focus-distance-value>1.5 m</span><input data-focus-distance type="range" min="0.5" max="5" step="0.1" aria-label="Focus distance in meters"><small>Distance in front of you when focusing any window.</small></label><label>Focus warp <span data-focus-curvature-value>0°</span><input data-focus-curvature type="range" min="0" max="100" step="5" aria-label="Focus curvature in degrees"><small>Temporary focus curvature. The original curvature restores when focus ends.</small></label><label>Scroll strip <select data-scroll-strip-side aria-label="Scroll strip side"><option value="right">Right</option><option value="left">Left</option><option value="both">Both sides</option></select><small>Pinch and drag the strip beside each pane to scroll it.</small></label><label><input data-frame-chin type="checkbox" aria-label="Show the chin under each pane frame"> Frame chin<small>Adds the instrument strip under each pane frame.</small></label></fieldset>';
    settingsPanel.insertBefore(
      windowControls,
      settingsPanel.querySelector('[data-action="passthrough"]'),
    );
    const windowOpacity = windowControls.querySelector<HTMLInputElement>('[data-window-opacity]');
    const windowWarp = windowControls.querySelector<HTMLInputElement>('[data-window-warp]');
    const windowDistance = windowControls.querySelector<HTMLInputElement>('[data-focus-distance]');
    const windowCurvature =
      windowControls.querySelector<HTMLInputElement>('[data-focus-curvature]');
    const stripSide = windowControls.querySelector<HTMLSelectElement>('[data-scroll-strip-side]');
    const frameChin = windowControls.querySelector<HTMLInputElement>('[data-frame-chin]');
    const windowOpacityValue = windowControls.querySelector<HTMLElement>(
      '[data-window-opacity-value]',
    );
    const windowWarpValue = windowControls.querySelector<HTMLElement>('[data-window-warp-value]');
    const windowDistanceValue = windowControls.querySelector<HTMLElement>(
      '[data-focus-distance-value]',
    );
    const windowCurvatureValue = windowControls.querySelector<HTMLElement>(
      '[data-focus-curvature-value]',
    );
    if (
      !windowOpacity ||
      !windowWarp ||
      !windowWarpValue ||
      !windowDistance ||
      !windowCurvature ||
      !stripSide ||
      !frameChin ||
      !windowOpacityValue ||
      !windowDistanceValue ||
      !windowCurvatureValue
    )
      throw new Error('Window preference controls missing');
    updateWindowPreferenceControls = (): void => {
      windowOpacity.value = String(Math.round(settings.windowPreferences.defaultOpacity * 100));
      windowWarp.value = String(settings.windowPreferences.defaultCurvature);
      windowDistance.value = String(settings.windowPreferences.focusDistance);
      windowCurvature.value = String(settings.windowPreferences.focusCurvature);
      stripSide.value = settings.windowPreferences.scrollStripSide;
      frameChin.checked = settings.windowPreferences.frameChin;
      windowOpacityValue.textContent = `${windowOpacity.value}%`;
      windowWarpValue.textContent = `${windowWarp.value}°`;
      windowDistanceValue.textContent = `${windowDistance.value} m`;
      windowCurvatureValue.textContent = `${windowCurvature.value}°`;
    };
    const changeWindowPreferences = (): void => {
      settings = {
        ...settings,
        windowPreferences: validateWindowPreferences({
          defaultOpacity: Number(windowOpacity.value) / 100,
          defaultCurvature: Number(windowWarp.value),
          focusDistance: Number(windowDistance.value),
          focusCurvature: Number(windowCurvature.value),
          scrollStripSide: stripSide.value,
          frameChin: frameChin.checked,
          buttonMap: settings.windowPreferences.buttonMap,
        }),
      };
      updateWindowPreferenceControls();
      saveSettings();
    };
    windowOpacity.addEventListener('input', changeWindowPreferences);
    windowWarp.addEventListener('input', changeWindowPreferences);
    windowDistance.addEventListener('input', changeWindowPreferences);
    windowCurvature.addEventListener('input', changeWindowPreferences);
    stripSide.addEventListener('change', changeWindowPreferences);
    frameChin.addEventListener('change', changeWindowPreferences);
    updateWindowPreferenceControls();
    const buttonControls = document.createElement('div');
    buttonControls.dataset.controllerButtons = 'true';
    const functionOptions = BUTTON_FUNCTIONS.map(
      (choice) => `<option value="${choice}">${BUTTON_FUNCTION_LABELS[choice]}</option>`,
    ).join('');
    buttonControls.innerHTML = `<fieldset><legend>Controller buttons</legend>${CONTROLLER_BUTTONS.map(
      (button) =>
        `<label>${CONTROLLER_BUTTON_LABELS[button]} <select data-controller-button="${button}" aria-label="${CONTROLLER_BUTTON_LABELS[button]} button function">${functionOptions}</select></label>`,
    ).join(
      '',
    )}<button data-action="reset-controller-buttons" class="secondary">Reset buttons</button><small>While warping a pane, right A saves and right B cancels.</small></fieldset>`;
    settingsPanel.insertBefore(
      buttonControls,
      settingsPanel.querySelector('[data-action="passthrough"]'),
    );
    const buttonSelects = [
      ...buttonControls.querySelectorAll<HTMLSelectElement>('[data-controller-button]'),
    ];
    const updateButtonControls = (): void => {
      for (const select of buttonSelects)
        select.value =
          settings.windowPreferences.buttonMap[select.dataset.controllerButton as ControllerButton];
    };
    const saveButtonMap = (buttonMap: unknown): void => {
      settings = {
        ...settings,
        windowPreferences: validateWindowPreferences({ ...settings.windowPreferences, buttonMap }),
      };
      updateButtonControls();
      saveSettings();
    };
    for (const select of buttonSelects)
      select.addEventListener('change', () =>
        saveButtonMap(
          Object.fromEntries(
            buttonSelects.map((entry) => [entry.dataset.controllerButton, entry.value]),
          ),
        ),
      );
    buttonControls
      .querySelector('[data-action="reset-controller-buttons"]')
      ?.addEventListener('click', () => saveButtonMap(DEFAULT_BUTTON_MAP));
    const refreshWindowControls = updateWindowPreferenceControls;
    updateWindowPreferenceControls = (): void => {
      refreshWindowControls();
      updateButtonControls();
    };
    updateButtonControls();
    const grid = document.createElement('div');
    grid.dataset.gridControls = 'true';
    grid.innerHTML =
      '<label>Selected terminal grid <span data-grid-caption>None selected</span></label><div class="grid-inputs"><label>Columns<input data-grid-cols type="number" min="2" max="300" step="1" aria-label="Terminal columns"></label><label>Rows<input data-grid-rows type="number" min="2" max="150" step="1" aria-label="Terminal rows"></label></div><button data-action="apply-grid" class="secondary">Apply grid</button><small data-grid-status>Resize changes the process display size and do not restart it.</small><label>Terminal curvature <span data-terminal-curvature-value>0°</span><input data-terminal-curvature type="range" min="0" max="100" step="1" value="0" aria-label="Terminal curvature in degrees"></label><label>Terminal glass opacity <span data-terminal-opacity-value>100%</span><input data-terminal-opacity type="range" min="10" max="100" step="5" value="100" aria-label="Terminal glass opacity"><small>Foreground text remains opaque.</small></label><button data-action="reset-terminal-appearance" class="secondary" title="Forget this pane\'s saved glass opacity and warp so it follows the new-window defaults">Reset to defaults</button>';
    settingsPanel.insertBefore(
      grid,
      settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
    );
    const arrangement = document.createElement('div');
    arrangement.dataset.arrangementControls = 'true';
    arrangement.innerHTML =
      '<label for="arrangement-pattern">3D arrangement</label><select id="arrangement-pattern" data-arrangement aria-label="3D terminal arrangement"><option value="row">Row</option><option value="grid">Grid</option><option value="arc">Arc</option><option value="sphere">Sphere</option></select><small>Applies to attached terminals in 3D. Sphere uses a front hemisphere. Terminals remain individually adjustable.</small><button data-action="apply-arrangement" class="secondary" title="Apply this 3D arrangement to attached terminals">Apply arrangement</button>';
    const distanceRow = document.createElement('div');
    distanceRow.className = 'grid-inputs';
    for (const [label, direction] of [
      ['Closer', -1],
      ['Farther', 1],
    ] as const) {
      const button = document.createElement('button');
      button.className = 'secondary';
      button.textContent = label;
      button.dataset.action = direction < 0 ? 'layout-closer' : 'layout-farther';
      button.title =
        direction < 0
          ? 'Move all terminals closer without resizing them'
          : 'Move all terminals farther without resizing them';
      button.addEventListener('click', () => callbacks.onMoveLayout?.(direction));
      distanceRow.append(button);
    }
    arrangement.append(distanceRow);
    settingsPanel.insertBefore(
      arrangement,
      settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
    );
    arrangementSelect = arrangement.querySelector('[data-arrangement]');
    arrangementApply = arrangement.querySelector('[data-action="apply-arrangement"]');
    if (!arrangementSelect || !arrangementApply) throw new Error('Missing arrangement controls');
    const select = arrangementSelect;
    select.value = settings.arrangement;
    arrangementApply.addEventListener('click', () => {
      const pattern = select.value as PanelArrangement;
      settings = { ...settings, arrangement: pattern };
      saveSettings();
      callbacks.onArrange?.(pattern);
    });
    root
      .querySelector<HTMLInputElement>('[data-terminal-curvature]')
      ?.addEventListener('input', (event) => {
        if (!activePaneId) return;
        const degrees = Math.max(
          0,
          Math.min(100, Number((event.target as HTMLInputElement).value)),
        );
        terminalCurvature.set(activePaneId, degrees);
        qs<HTMLElement>('[data-terminal-curvature-value]').textContent = `${degrees}°`;
        callbacks.onTerminalCurvature?.(activePaneId, degrees);
      });
    root
      .querySelector<HTMLInputElement>('[data-terminal-opacity]')
      ?.addEventListener('input', (event) => {
        if (!activePaneId) return;
        const rawOpacity = Number((event.target as HTMLInputElement).value);
        const opacity = Number.isFinite(rawOpacity) ? Math.max(10, Math.min(100, rawOpacity)) : 100;
        terminalOpacity.set(activePaneId, opacity);
        qs<HTMLElement>('[data-terminal-opacity-value]').textContent = `${opacity}%`;
        callbacks.onTerminalOpacity?.(activePaneId, opacity);
      });
    root
      .querySelector<HTMLButtonElement>('[data-action="reset-terminal-appearance"]')
      ?.addEventListener('click', () => {
        if (activePaneId) callbacks.onTerminalReset?.(activePaneId);
      });
  }
  const editor = document.createElement('div');
  editor.className = 'command-editor';
  editor.innerHTML =
    '<input data-command-label placeholder="Label" aria-label="Command label"><input data-command-text placeholder="Command text ({{}} = type the rest)" aria-label="Command text"><label><input type="checkbox" data-command-newline checked> Enter</label><label><input type="checkbox" data-command-confirm> Confirm before running</label><button data-action="save-command" title="Save the quick command">Save</button><button data-action="move-up" title="Move the selected quick command up">Up</button><button data-action="move-down" title="Move the selected quick command down">Down</button>';
  editor.dataset.commandControls = 'true';
  root
    .querySelector<HTMLElement>('[data-drawer]')
    ?.insertBefore(
      editor,
      root.querySelector<HTMLElement>('[data-compose]')?.parentElement ?? null,
    );
  const qs = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  const updateHostClipboardStatus = (message: string | null = null): void => {
    const status = root.querySelector<HTMLElement>('[data-host-clipboard-status]');
    if (!status) return;
    status.textContent =
      message ??
      (callbacks.isHostClipboardPaired?.()
        ? 'Paired. The secret is stored only in this browser.'
        : `Not paired. ${HOST_CLIPBOARD_SETUP}`);
  };
  updateHostClipboardStatus();
  const clearGridControls = (): void => {
    qs<HTMLButtonElement>('[data-action="apply-grid"]').disabled = true;
    qs<HTMLElement>('[data-grid-caption]').textContent = 'No terminal selected';
    qs<HTMLElement>('[data-grid-status]').textContent =
      'Select an attached terminal to change its grid.';
    qs<HTMLInputElement>('[data-terminal-curvature]').value = '0';
    qs<HTMLElement>('[data-terminal-curvature-value]').textContent = '0°';
    qs<HTMLInputElement>('[data-terminal-curvature]').disabled = true;
    qs<HTMLInputElement>('[data-terminal-opacity]').value = '100';
    qs<HTMLElement>('[data-terminal-opacity-value]').textContent = '100%';
    qs<HTMLInputElement>('[data-terminal-opacity]').disabled = true;
    qs<HTMLButtonElement>('[data-action="reset-terminal-appearance"]').disabled = true;
  };
  const updateCurvatureControls = (paneId: string | undefined): void => {
    const input = qs<HTMLInputElement>('[data-terminal-curvature]');
    const value = paneId ? (terminalCurvature.get(paneId) ?? 0) : 0;
    input.value = String(value);
    input.disabled = !paneId;
    qs<HTMLElement>('[data-terminal-curvature-value]').textContent = `${value}°`;
  };
  const updateOpacityControls = (paneId: string | undefined): void => {
    const input = qs<HTMLInputElement>('[data-terminal-opacity]');
    const value = paneId ? (terminalOpacity.get(paneId) ?? 100) : 100;
    input.value = String(value);
    input.disabled = !paneId;
    qs<HTMLButtonElement>('[data-action="reset-terminal-appearance"]').disabled = !paneId;
    qs<HTMLElement>('[data-terminal-opacity-value]').textContent = `${value}%`;
  };
  clearModifiers();
  clearGridControls();
  updateArrangementAvailability();
  const actionHelp: Record<string, string> = {
    demo: 'Preview synthetic terminals without running commands',
    xr: 'Enter immersive VR with controller input',
    commands: 'Open saved global and workspace quick commands',
    keyboard: 'Open text entry and the terminal keyboard',
    passthrough: 'Enter mixed reality with your surroundings visible',
    'send-text': 'Send text as typed without adding Enter',
    'run-command': 'Send the saved command; add Enter if enabled',
  };
  for (const [action, help] of Object.entries(actionHelp))
    root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.setAttribute('title', help);
  root
    .querySelector('[data-command-newline]')
    ?.setAttribute('title', 'Append Enter after the command text to execute it');
  const saveSettings = (): void => {
    try {
      storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
      callbacks.onSettingsChange?.(settings);
    } catch {
      qs<HTMLElement>('[data-detail]').textContent = 'Settings could not be saved on this device.';
    }
  };
  const renderAgents = (): void => {
    const section = qs<HTMLElement>('[data-agents-section]');
    section.hidden = agentRows.length === 0;
    qs<HTMLElement>('[data-agent-count]').textContent = agentRows.length
      ? String(agentRows.length)
      : '';
    const layout = agentRosterLayout(settings);
    const sortButton = qs<HTMLButtonElement>('[data-action="agents-sort"]');
    sortButton.textContent = layout.sort;
    sortButton.title = `Agent order: ${layout.sort}. Change the agent order`;
    const list = qs<HTMLElement>('[data-agents]');
    // A reorder waits while the pointer is over the list; other updates render in place.
    const order = agentRows.map((row) => row.paneId).join(' ');
    if (order !== agentRenderedOrder && agentRenderedOrder && list.matches(':hover')) {
      agentRenderDeferred = true;
      return;
    }
    agentRenderDeferred = false;
    agentRenderedOrder = order;
    agentRenderedAges = agentAgesKey();
    const now = Date.now();
    list.innerHTML = agentRows
      .map((row) => {
        const tone = agentStateTone(row.state);
        const state = agentTokenText(row, 'state', now);
        const lines = agentRowParts(row, layout.rows, now);
        const content = (lines.length ? lines : [[{ token: 'agent' as const, text: row.agent }]])
          .map((line, index) => {
            const parts = line
              .map(
                (part) =>
                  `<span class="agent-token" data-token="${part.token}">${escapeHtml(part.text)}</span>`,
              )
              .join('<span class="agent-sep"> · </span>');
            return index === 0 ? `<b>${parts}</b>` : `<small>${parts}</small>`;
          })
          .join('');
        return `<button class="tree-pane agent-row ${row.paneId === activePaneId ? 'selected' : ''}" data-pane="${escapeHtml(row.paneId)}" data-agent-tone="${tone}" title="${escapeHtml(`Open ${row.agent} in ${row.paneId}`)}" aria-label="${escapeHtml(`${row.agent} ${state} in ${row.workspaceName || 'unknown workspace'}, pane ${row.paneId}${row.project ? `, project ${row.project}` : ''}${row.reason ? `, ${row.reason}` : ''}`)}"><span class="agent-lines">${content}</span></button>`;
      })
      .join('');
  };
  /** The age texts the rows would show now; empty when the layout has no age token. */
  function agentAgesKey(): string {
    const { rows } = agentRosterLayout(settings);
    const ages = rows.map((line) => line.filter((token) => AGE_TOKENS.has(token)));
    if (!ages.some((line) => line.length)) return '';
    const now = Date.now();
    return agentRows.map((row) => agentRowLines(row, ages, now).join('|')).join('\u0000');
  }
  qs<HTMLElement>('[data-agents]').addEventListener('pointerleave', () => {
    if (agentRenderDeferred) renderAgents();
  });
  const agentAgeTimer = setInterval(() => {
    // Also resumes a deferred reorder where pointerleave never fired (touch).
    if (agentRenderDeferred || (agentRows.length && agentAgesKey() !== agentRenderedAges))
      renderAgents();
  }, AGENT_AGE_REFRESH_MS);
  const exitBadge = (paneId: string): string => {
    const badge = paneBadge(paneId);
    return badge ? `<small class="pane-exit-badge">${escapeHtml(badge)}</small>` : '';
  };
  const renderTree = (): void => {
    renderAgents();
    const tree = qs<HTMLElement>('[data-tree]');
    if (!snapshot.panes.length) {
      tree.innerHTML = '<div class="empty-tree">No panes reported</div>';
      return;
    }
    const expanded = new Map(
      [...tree.querySelectorAll<HTMLDetailsElement>('details[data-branch]')].map((node) => [
        node.dataset.branch,
        node.open,
      ]),
    );
    const grouped = (
      panes: PaneDescriptor[],
      field: 'workspaceId' | 'sessionId' | 'windowId',
    ): PaneDescriptor[][] => {
      const groups = new Map<string, PaneDescriptor[]>();
      for (const pane of panes) groups.set(pane[field], [...(groups.get(pane[field]) ?? []), pane]);
      return [...groups.values()];
    };
    const createLabel = paneCreation.pending
      ? 'Creating terminal…'
      : paneCreation.available
        ? 'New terminal'
        : 'Creation unavailable';
    const createButton = (sessionId: string, sessionName: string): string =>
      `<button class="tree-create" data-create-session="${escapeHtml(sessionId)}" ${paneCreation.available && !paneCreation.pending ? '' : 'disabled'} aria-label="Create a new default-shell terminal in ${escapeHtml(sessionName)}" title="${escapeHtml(paneCreation.reason ?? `Create a new default-shell terminal in ${sessionName}`)}">${icon('plus')} ${createLabel}</button>`;
    const createNote =
      paneCreation.reason && (paneCreation.pending || !paneCreation.available)
        ? `<div class="tree-create-note" role="status">${escapeHtml(paneCreation.reason)}</div>`
        : '';
    const branch = (id: string, label: string, content: string): string =>
      `<details data-branch="${escapeHtml(id)}" ${expanded.get(id) !== false ? 'open' : ''}><summary>${escapeHtml(label)}</summary>${content}</details>`;
    tree.innerHTML = `<div class="tree-daemon">Connected computer</div>${createNote}${grouped(
      snapshot.panes,
      'workspaceId',
    )
      .map((workspace) =>
        branch(
          workspace[0].workspaceId,
          workspace[0].workspaceName,
          grouped(workspace, 'sessionId')
            .map((session) =>
              branch(
                session[0].sessionId,
                session[0].sessionName,
                grouped(session, 'windowId')
                  .map((window) =>
                    branch(
                      window[0].windowId,
                      window[0].windowName,
                      window
                        .map(
                          (pane) =>
                            `<button class="tree-pane ${pane.id === activePaneId ? 'selected' : ''}" data-pane="${escapeHtml(pane.id)}"><span class="pane-pip"></span><span><b>${escapeHtml(pane.title)}</b><small>${escapeHtml(pane.id)}</small>${exitBadge(pane.id)}</span></button>`,
                        )
                        .join(''),
                    ),
                  )
                  .join('') + createButton(session[0].sessionId, session[0].sessionName),
              ),
            )
            .join(''),
        ),
      )
      .join('')}`;
  };
  const renderPanes = (): void => {
    const host = qs<HTMLElement>('[data-panes]');
    const attached = snapshot.panes.filter((pane) => attachedPaneIds.includes(pane.id));
    host.innerHTML = attached.length
      ? attached
          .map(
            (pane) =>
              `<div class="attached-selector ${pane.id === activePaneId ? 'active' : ''}"><button data-select="${escapeHtml(pane.id)}">${escapeHtml(pane.title)}</button>${exitBadge(pane.id)}<button class="text-btn" data-toggle-connection="${escapeHtml(pane.id)}" aria-label="${escapeHtml(connectionActionLabel(paneStatuses.get(pane.id)))} ${escapeHtml(pane.title)}" title="${escapeHtml(connectionActionTitle(pane.title, paneStatuses.get(pane.id)))}">${escapeHtml(connectionActionLabel(paneStatuses.get(pane.id)))}</button><button class="icon-btn" data-close="${escapeHtml(pane.id)}" aria-label="Close view for ${escapeHtml(pane.title)}" title="Close this viewer and keep the terminal running">${icon('close')}</button></div>`,
          )
          .join('')
      : '<div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div>';
  };
  const commandOption = (command: QuickCommand): string =>
    `<option value="${escapeHtml(command.id)}">${escapeHtml(command.label)}${command.pinned ? ' · pinned' : ''}</option>`;
  const targetWorkspace = (): string =>
    snapshot.panes.find((pane) => pane.id === (capturedTarget ?? activePaneId))?.workspaceId ??
    'default';
  const visibleSharedCommands = (): QuickCommand[] =>
    sharedCommands.filter((command) =>
      commandScope === 'global'
        ? command.workspaceId === undefined
        : command.workspaceId === targetWorkspace(),
    );
  const findDrawerCommand = (id: string): QuickCommand | undefined =>
    commands.find((item) => item.id === id) ??
    visibleSharedCommands().find((item) => item.id === id);
  const renderCommands = (): void => {
    const shared = visibleSharedCommands();
    qs<HTMLSelectElement>('[data-command-select]').innerHTML =
      '<option value="">Choose a quick command</option>' +
      commands.map(commandOption).join('') +
      (shared.length
        ? `<optgroup label="Shared" data-shared-commands>${shared.map(commandOption).join('')}</optgroup>`
        : '');
  };
  const currentScope = (): string =>
    commandScope === 'global'
      ? workspaceScope(settings.endpoint, '*')
      : workspaceScope(
          settings.endpoint,
          snapshot.panes.find((pane) => pane.id === (capturedTarget ?? activePaneId))
            ?.workspaceId ?? 'default',
        );
  const loadCommands = (): void => {
    commands = store.get(currentScope());
    renderCommands();
  };
  const updateInputMode = (): void => {
    if (inputMode !== 'keyboard') callbacks.onDictationAction?.('cancel');
    qs<HTMLElement>('[data-drawer-heading]').textContent =
      inputMode === 'commands' ? 'Commands' : 'Keyboard';
    root.querySelectorAll<HTMLElement>('[data-command-controls]').forEach((element) => {
      element.hidden = inputMode !== 'commands';
    });
    root.querySelectorAll<HTMLElement>('[data-keyboard-controls]').forEach((element) => {
      element.hidden = inputMode !== 'keyboard';
    });
  };
  const updateTargetCaption = (): void => {
    const target = snapshot.panes.find((pane) => pane.id === (capturedTarget ?? activePaneId));
    qs<HTMLElement>('[data-detail]').textContent = target
      ? `Input target: ${target.title} · ${target.sessionName} / ${target.windowName}`
      : 'Select a connected pane to send commands.';
  };
  const setUpdateAvailable = (available: boolean): void => {
    updateNotice.hidden = !available;
  };
  const setNotice = (message: string | null): void => {
    const notice = qs<HTMLElement>('[data-notice]');
    qs<HTMLElement>('[data-notice-text]').textContent = message ?? '';
    notice.hidden = message === null;
  };
  const setDictationState = (state: DictationState): void => {
    dictationState = { ...state };
    const start = qs<HTMLButtonElement>('[data-action="dictation-start"]');
    const stop = qs<HTMLButtonElement>('[data-action="dictation-stop"]');
    const insert = qs<HTMLButtonElement>('[data-action="dictation-insert"]');
    const clear = qs<HTMLButtonElement>('[data-action="dictation-clear"]');
    const draft = qs<HTMLTextAreaElement>('[data-dictation-draft]');
    const status = qs<HTMLElement>('[data-dictation-status]');
    start.disabled = !state.supported || ['listening', 'transcribing'].includes(state.status);
    start.textContent = state.status === 'transcribing' ? 'Transcribing…' : 'Dictate';
    stop.hidden = state.status !== 'listening';
    insert.disabled = !['review', 'error'].includes(state.status) || !state.transcript.trim();
    clear.hidden = !['review', 'error'].includes(state.status) || !state.transcript.trim();
    draft.disabled =
      state.status === 'idle' ||
      state.status === 'listening' ||
      state.status === 'transcribing' ||
      (state.status === 'error' && !state.transcript.trim());
    if (draft.value !== state.transcript) draft.value = state.transcript;
    status.textContent = state.error ?? `Speech input is ${state.status}.`;
  };
  const closeInput = (): void => {
    callbacks.onDictationAction?.('cancel');
    capturedTarget = undefined;
    clearModifiers();
    qs<HTMLElement>('[data-drawer]').hidden = true;
    updateTargetCaption();
  };
  const selectPane = (id: string, notify = true): void => {
    const pane = snapshot.panes.find((item) => item.id === id);
    if (!pane) return;
    activePaneId = id;
    renderTree();
    renderPanes();
    if (!qs<HTMLElement>('[data-drawer]').hidden) {
      capturedTarget = id;
      clearModifiers();
      loadCommands();
    }
    updateTargetCaption();
    if (notify) callbacks.onSelectPane?.(pane);
  };
  const cancelModifierHold = (button: HTMLButtonElement): void => {
    const timer = holdTimers.get(button);
    if (timer !== undefined) window.clearTimeout(timer);
    holdTimers.delete(button);
  };
  root.addEventListener('pointerdown', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-modifier]');
    if (!button) return;
    const modifier = button.dataset.modifier as 'ctrl' | 'alt' | 'shift' | undefined;
    if (!modifier) return;
    delete button.dataset.longPressed;
    cancelModifierHold(button);
    button.setPointerCapture?.(event.pointerId);
    holdTimers.set(
      button,
      window.setTimeout(() => {
        modifierState.lock(modifier);
        button.dataset.longPressed = 'true';
        syncModifierVisuals();
        holdTimers.delete(button);
      }, 550),
    );
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    root.addEventListener(eventName, (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-modifier]');
      if (button) {
        cancelModifierHold(button);
        if (eventName === 'pointercancel') delete button.dataset.longPressed;
      }
    });
  }
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.createSession) {
      if (!(button as HTMLButtonElement).disabled)
        callbacks.onCreatePane?.(button.dataset.createSession);
      return;
    }
    const paneId = button.dataset.pane ?? button.dataset.select;
    if (paneId) {
      selectPane(paneId);
      button.blur();
      return;
    }
    if (button.dataset.close) {
      const pane = snapshot.panes.find((item) => item.id === button.dataset.close);
      if (pane) callbacks.onClosePane?.(pane);
      return;
    }
    if (button.dataset.toggleConnection) {
      const pane = snapshot.panes.find((item) => item.id === button.dataset.toggleConnection);
      if (pane) callbacks.onTogglePaneConnection?.(pane);
      return;
    }
    if (button.dataset.key) {
      const key = button.dataset.key;
      const modifier = button.dataset.modifier as 'ctrl' | 'alt' | 'shift' | '';
      if (modifier) {
        if (button.dataset.longPressed) {
          delete button.dataset.longPressed;
          return;
        }
        modifierState.tap(modifier);
        syncModifierVisuals();
        return;
      }
      if (['listening', 'transcribing'].includes(dictationState?.status ?? '')) return;
      if (
        dictationState?.status === 'review' ||
        (dictationState?.status === 'error' && dictationState.transcript)
      ) {
        const draft = qs<HTMLTextAreaElement>('[data-dictation-draft]');
        let start = draft.selectionStart;
        let end = draft.selectionEnd;
        if (key === 'Enter') callbacks.onDictationAction?.('insert');
        else if (key === 'Escape') callbacks.onDictationAction?.('cancel');
        else {
          if (key === 'ArrowLeft')
            start = end =
              draft.value.slice(0, start).length -
              (Array.from(draft.value.slice(0, start)).at(-1)?.length ?? 0);
          else if (key === 'ArrowRight')
            start = end = end + (Array.from(draft.value.slice(end))[0]?.length ?? 0);
          else if (key === 'Home') start = end = 0;
          else if (key === 'End') start = end = draft.value.length;
          else if (key === 'Backspace' || key === 'Delete' || key.length === 1) {
            if (key === 'Backspace' && start === end)
              start -= Array.from(draft.value.slice(0, start)).at(-1)?.length ?? 0;
            if (key === 'Delete' && start === end)
              end += Array.from(draft.value.slice(end))[0]?.length ?? 0;
            const text =
              key.length === 1 ? terminalKeyLabel(key, Boolean(modifierState.active.shift)) : '';
            draft.setRangeText(text, start, end, 'end');
            start = end = draft.selectionEnd;
            callbacks.onDictationDraftChange?.(draft.value);
          }
          draft.setSelectionRange(start, end);
        }
        modifierState.consume();
        syncModifierVisuals();
        return;
      }
      if (capturedTarget) callbacks.onSendKey?.(capturedTarget, key, { ...modifierState.active });
      modifierState.consume();
      syncModifierVisuals();
      return;
    }
    if (
      ['move-up', 'move-down', 'pin-command', 'remove-command'].includes(
        button.dataset.action ?? '',
      ) &&
      isSharedCommand({ id: qs<HTMLSelectElement>('[data-command-select]').value })
    ) {
      qs<HTMLElement>('[data-detail]').textContent = 'Shared commands are read-only.';
      return;
    }
    switch (button.dataset.action) {
      case 'agents-sort': {
        const next =
          AGENTS_SORTS[(AGENTS_SORTS.indexOf(settings.agentsSort) + 1) % AGENTS_SORTS.length];
        settings = { ...settings, agentsSort: next };
        if (agentSortSelect) agentSortSelect.value = next;
        saveSettings();
        renderAgents();
        break;
      }
      case 'connect': {
        const endpoint = qs<HTMLInputElement>('#endpoint').value.trim();
        settings = { ...settings, endpoint };
        capturedTarget = undefined;
        clearModifiers();
        qs<HTMLElement>('[data-drawer]').hidden = true;
        saveSettings();
        loadCommands();
        callbacks.onConnect(endpoint);
        break;
      }
      case 'refresh':
        callbacks.onRefresh?.();
        break;
      case 'xr':
        callbacks.onEnterXR?.();
        break;
      case 'reload-update':
        callbacks.onReloadApp?.();
        break;
      case 'dismiss-notice':
        setNotice(null);
        callbacks.onDismissNotice?.();
        break;
      case 'commands':
      case 'keyboard':
        inputMode = button.dataset.action as 'commands' | 'keyboard';
        if (qs<HTMLElement>('[data-drawer]').hidden) capturedTarget = activePaneId;
        clearModifiers();
        qs<HTMLElement>('[data-drawer]').hidden = false;
        updateInputMode();
        updateTargetCaption();
        loadCommands();
        break;
      case 'close-drawer':
        closeInput();
        break;
      case 'dictation-start':
        callbacks.onDictationAction?.('start');
        break;
      case 'paste-clipboard':
        callbacks.onPaste?.(capturedTarget ?? activePaneId);
        break;
      case 'host-to-quest':
        callbacks.onHostToQuest?.();
        break;
      case 'quest-to-host':
        callbacks.onQuestToHost?.();
        break;
      case 'host-clipboard-save': {
        const input = qs<HTMLInputElement>('[data-host-clipboard-secret]');
        const saved = callbacks.onHostClipboardSecret?.(input.value) ?? false;
        input.value = '';
        updateHostClipboardStatus(saved ? null : 'Enter the secret before saving.');
        break;
      }
      case 'host-clipboard-forget':
        callbacks.onHostClipboardSecret?.(null);
        qs<HTMLInputElement>('[data-host-clipboard-secret]').value = '';
        updateHostClipboardStatus('Forgotten. Host clipboard transfers are off in this browser.');
        break;
      case 'dictation-stop':
        callbacks.onDictationAction?.('stop');
        break;
      case 'dictation-insert':
        callbacks.onDictationAction?.('insert');
        break;
      case 'dictation-clear':
        callbacks.onDictationAction?.('clear');
        break;
      case 'dictation-cancel':
        callbacks.onDictationAction?.('cancel');
        break;
      case 'settings':
        qs<HTMLElement>('[data-settings]').hidden = false;
        break;
      case 'close-settings':
        qs<HTMLElement>('[data-settings]').hidden = true;
        break;
      case 'passthrough':
        callbacks.onPassthrough?.();
        break;
      case 'demo':
        callbacks.onDemo?.();
        break;
      case 'reset':
        callbacks.onResetLayout?.();
        break;
      case 'add-command':
        qs<HTMLSelectElement>('[data-command-select]').value = '';
        qs<HTMLInputElement>('[data-command-label]').value = '';
        qs<HTMLInputElement>('[data-command-text]').value = '';
        qs<HTMLInputElement>('[data-command-newline]').checked = true;
        qs<HTMLInputElement>('[data-command-confirm]').checked = false;
        qs<HTMLInputElement>('[data-command-label]').focus();
        break;
      case 'save-command': {
        const label = qs<HTMLInputElement>('[data-command-label]').value.trim();
        const text = qs<HTMLInputElement>('[data-command-text]').value;
        if (label && text) {
          const selected = qs<HTMLSelectElement>('[data-command-select]').value;
          const old = commands.find((item) => item.id === selected);
          const targetPane = snapshot.panes.find((item) => item.id === capturedTarget);
          if (commandScope === 'workspace' && !targetPane) {
            qs<HTMLElement>('[data-detail]').textContent =
              'Select a pane before saving a workspace command.';
            break;
          }
          const added = {
            id: old?.id ?? `${Date.now()}`,
            label,
            text,
            sendNewline: qs<HTMLInputElement>('[data-command-newline]').checked,
            ...(commandScope === 'workspace' ? { workspaceId: targetPane?.workspaceId } : {}),
            ...(qs<HTMLInputElement>('[data-command-confirm]').checked ? { confirm: true } : {}),
            ...(old?.pinned ? { pinned: true } : {}),
          };
          commands = old
            ? commands.map((item) => (item.id === old.id ? added : item))
            : [...commands, added];
          persistCommands();
          qs<HTMLSelectElement>('[data-command-select]').value = added.id;
        }
        break;
      }
      case 'move-up':
      case 'move-down': {
        const selected = qs<HTMLSelectElement>('[data-command-select]').value;
        const index = commands.findIndex((item) => item.id === selected);
        if (index >= 0) {
          commands = reorderCommands(
            commands,
            index,
            index + (button.dataset.action === 'move-up' ? -1 : 1),
          );
          persistCommands();
        }
        break;
      }
      case 'export-commands': {
        const exported = exportServerCommands(store.all(), settings.endpoint);
        const url = URL.createObjectURL(
          new Blob([serializeCommandFile(exported)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mux-xr-quick-commands.json';
        link.click();
        URL.revokeObjectURL(url);
        qs<HTMLElement>('[data-detail]').textContent =
          `Exported ${exported.length} quick command${exported.length === 1 ? '' : 's'}.`;
        break;
      }
      case 'import-commands':
        qs<HTMLInputElement>('[data-command-import]').click();
        break;
      case 'pin-command': {
        const select = qs<HTMLSelectElement>('[data-command-select]');
        const selected = select.value;
        if (!commands.some((item) => item.id === selected)) break;
        commands = commands.map((item) =>
          item.id === selected ? { ...copyCommand(item), pinned: !item.pinned } : item,
        );
        persistCommands();
        select.value = selected;
        break;
      }
      case 'remove-command': {
        const selected = qs<HTMLSelectElement>('[data-command-select]').value;
        commands = commands.filter((command) => command.id !== selected);
        persistCommands();
        callbacks.onCommandsChange?.(commands, currentScope());
        break;
      }
      case 'run-command': {
        const command = findDrawerCommand(qs<HTMLSelectElement>('[data-command-select]').value);
        if (!command || !capturedTarget) break;
        if (command.confirm) {
          const target = snapshot.panes.find((pane) => pane.id === capturedTarget);
          if (
            !window.confirm(
              `Run "${command.label}" in ${target?.title ?? capturedTarget}?\n\n${previewCommandText(command.text)}`,
            )
          )
            break;
        }
        callbacks.onRunCommand?.(command, capturedTarget);
        break;
      }
      case 'send-text': {
        const text = qs<HTMLTextAreaElement>('[data-compose]').value;
        if (text && capturedTarget) {
          callbacks.onSendText?.(capturedTarget, text);
          qs<HTMLTextAreaElement>('[data-compose]').value = '';
        }
        break;
      }
    }
  });
  qs<HTMLSelectElement>('[data-command-scope]').addEventListener('change', (event) => {
    commandScope = (event.target as HTMLSelectElement).value;
    loadCommands();
  });
  qs<HTMLInputElement>('[data-command-import]').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void file.text().then(importCommands);
  });
  qs<HTMLSelectElement>('[data-command-select]').addEventListener('change', (event) => {
    const selected = findDrawerCommand((event.target as HTMLSelectElement).value);
    if (!selected) return;
    qs<HTMLInputElement>('[data-command-label]').value = selected.label;
    qs<HTMLInputElement>('[data-command-text]').value = selected.text;
    qs<HTMLInputElement>('[data-command-newline]').checked = selected.sendNewline;
    qs<HTMLInputElement>('[data-command-confirm]').checked = Boolean(selected.confirm);
  });
  qs<HTMLInputElement>('#endpoint').value = settings.endpoint;
  qs<HTMLSelectElement>('[data-background]').value = settings.background;
  qs<HTMLSelectElement>('[data-hierarchy-style]').value = settings.hierarchyStyle;
  qs<HTMLSelectElement>('[data-keyborb-mode]').value = settings.keyborbMode;
  qs<HTMLSelectElement>('[data-color-mode]').value = settings.colorMode;
  qs<HTMLInputElement>('[data-keyboard-background]').checked = settings.keyboardBackground;
  qs<HTMLInputElement>('[data-gaze-input]').checked = settings.gazeInput;
  qs<HTMLInputElement>('[data-ui-sounds]').checked = settings.uiSounds;
  setDictationState({
    supported: false,
    status: 'idle',
    transcript: '',
    error: null,
  });
  qs<HTMLSelectElement>('[data-background]').addEventListener('change', (event) => {
    settings = {
      ...settings,
      background: (event.target as HTMLSelectElement).value as BackgroundMode,
    };
    saveSettings();
  });
  qs<HTMLSelectElement>('[data-hierarchy-style]').addEventListener('change', (event) => {
    settings = {
      ...settings,
      hierarchyStyle: validateHierarchyStyle((event.target as HTMLSelectElement).value),
    };
    saveSettings();
  });
  qs<HTMLSelectElement>('[data-keyborb-mode]').addEventListener('change', (event) => {
    settings = {
      ...settings,
      keyborbMode: validateKeyborbMode((event.target as HTMLSelectElement).value),
    };
    saveSettings();
  });
  qs<HTMLInputElement>('[data-ui-sounds]').addEventListener('change', (event) => {
    settings = { ...settings, uiSounds: (event.target as HTMLInputElement).checked };
    saveSettings();
  });
  qs<HTMLInputElement>('[data-gaze-input]').addEventListener('change', (event) => {
    settings = { ...settings, gazeInput: (event.target as HTMLInputElement).checked };
    saveSettings();
  });
  qs<HTMLSelectElement>('[data-color-mode]').addEventListener('change', (event) => {
    settings = {
      ...settings,
      colorMode: (event.target as HTMLSelectElement).value as TerminalColorMode,
    };
    saveSettings();
  });
  qs<HTMLInputElement>('[data-keyboard-background]').addEventListener('change', (event) => {
    settings = {
      ...settings,
      keyboardBackground: (event.target as HTMLInputElement).checked,
    };
    saveSettings();
  });
  qs<HTMLTextAreaElement>('[data-dictation-draft]').addEventListener('input', (event) => {
    callbacks.onDictationDraftChange?.((event.target as HTMLTextAreaElement).value);
  });
  qs<HTMLButtonElement>('[data-action="apply-grid"]').addEventListener('click', () => {
    const paneId = activePaneId;
    const cols = Number(qs<HTMLInputElement>('[data-grid-cols]').value);
    const rows = Number(qs<HTMLInputElement>('[data-grid-rows]').value);
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      cols > 300 ||
      rows < 2 ||
      rows > 150
    ) {
      qs<HTMLElement>('[data-grid-status]').textContent = 'Use 2–300 columns and 2–150 rows.';
      return;
    }
    if (!paneId || !callbacks.onResizeGrid) {
      qs<HTMLElement>('[data-grid-status]').textContent =
        'Resize unavailable while disconnected or read-only.';
      return;
    }
    pendingGrid.set(paneId, { cols, rows });
    if (!callbacks.onResizeGrid(paneId, cols, rows)) {
      pendingGrid.delete(paneId);
      qs<HTMLElement>('[data-grid-status]').textContent =
        'Resize unavailable while disconnected or read-only.';
      return;
    }
    qs<HTMLElement>('[data-grid-status]').textContent =
      'Resize requested. Waiting for server confirmation…';
  });
  const store = createCommandStore(storage);
  const stats = createCommandStatsStore(storage);
  const persistCommands = (): void => {
    const scope = currentScope();
    if (!store.set(scope, commands)) {
      commands = store.get(scope);
      renderCommands();
      qs<HTMLElement>('[data-detail]').textContent = 'Commands could not be saved on this device.';
      return;
    }
    renderCommands();
    callbacks.onCommandsChange?.(commands, scope);
  };
  const writeCommand = (command: QuickCommand): boolean => {
    if (!isCommand(command) || isSharedCommand(command)) return false;
    const scope = workspaceScope(settings.endpoint, command.workspaceId ?? '*');
    const values = withoutServerCommand(store.all(), command.id, scope);
    const saved = store.get(scope);
    const next = saved.some((item) => item.id === command.id)
      ? saved.map((item) => (item.id === command.id ? copyCommand(command) : item))
      : [...saved, copyCommand(command)];
    values[scope] = next;
    if (!store.setAll(values)) {
      qs<HTMLElement>('[data-detail]').textContent = 'Commands could not be saved on this device.';
      return false;
    }
    loadCommands();
    callbacks.onCommandsChange?.(next, scope);
    return true;
  };
  const serverScopePrefix = (): string => workspaceScope(settings.endpoint, '');
  const withoutServerCommand = (
    values: Record<string, QuickCommand[]>,
    id: string,
    keepScope?: string,
  ): Record<string, QuickCommand[]> => {
    for (const [scope, saved] of Object.entries(values))
      if (scope !== keepScope && scope.startsWith(serverScopePrefix()))
        values[scope] = saved.filter((item) => item.id !== id);
    return values;
  };
  const deleteCommand = (id: string): boolean => {
    const values = withoutServerCommand(store.all(), id);
    if (!store.setAll(values)) {
      qs<HTMLElement>('[data-detail]').textContent = 'Commands could not be saved on this device.';
      return false;
    }
    loadCommands();
    callbacks.onCommandsChange?.(commands, currentScope());
    return true;
  };
  const importCommands = (text: string): void => {
    const detail = qs<HTMLElement>('[data-detail]');
    let parsed: ReturnType<typeof parseCommandFile> = null;
    try {
      parsed = parseCommandFile(JSON.parse(text));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      detail.textContent = 'Import failed: not a quick command file.';
      return;
    }
    const merged = mergeImportedCommands(store.all(), settings.endpoint, parsed.commands);
    if (!store.setAll(merged.values)) {
      detail.textContent = 'Commands could not be saved on this device.';
      return;
    }
    loadCommands();
    callbacks.onCommandsChange?.(commands, currentScope());
    const skipped = parsed.skipped + merged.skipped;
    detail.textContent = `Imported ${merged.added + merged.updated} quick commands: ${merged.added} new, ${merged.updated} updated${skipped ? `, ${skipped} skipped` : ''}.`;
  };
  const sceneHost = qs<HTMLElement>('[data-scene-host]');
  return {
    sceneHost,
    update(next) {
      snapshot = next;
      const present = new Set(next.panes.map((pane) => pane.id));
      for (const id of paneProcesses.keys()) if (!present.has(id)) paneProcesses.delete(id);
      // An attached pane's live surface is authoritative; the tree only speaks for unattached ones.
      for (const pane of next.panes)
        if (pane.process && !attachedPaneIds.includes(pane.id))
          paneProcesses.set(pane.id, pane.process);
      if (activePaneId && !next.panes.some((pane) => pane.id === activePaneId)) {
        activePaneId = undefined;
        clearGridControls();
      }
      if (capturedTarget && !next.panes.some((pane) => pane.id === capturedTarget)) closeInput();
      loadCommands();
      renderTree();
      renderPanes();
    },
    setConnection(nextStatus, detail = nextStatus === 'connected' ? 'Connected' : 'Not connected') {
      qs<HTMLElement>('.status-copy').textContent = detail;
      qs<HTMLElement>('.status-dot').className = `status-dot ${nextStatus}`;
    },
    setPaneStatus(paneId, status, process) {
      const before = paneBadge(paneId);
      const changed = paneStatuses.get(paneId) !== status;
      paneStatuses.set(paneId, status);
      if (process) paneProcesses.set(paneId, process);
      if (!changed && paneBadge(paneId) === before) return;
      renderPanes();
      if (paneBadge(paneId) !== before) renderTree();
    },
    setPaneCreation(state) {
      paneCreation = { ...state };
      renderTree();
    },
    setAgentRoster(rows) {
      const layout = agentRosterLayout(settings);
      const signature = `${layout.sort}\u0002${agentRowsSignature(rows, layout)}`;
      agentRows = [...rows];
      if (signature === agentSignature) return;
      agentSignature = signature;
      renderAgents();
    },
    setDemoMode(enabled) {
      qs<HTMLElement>('.demo-badge').hidden = !enabled;
    },
    setActivePane: (id) => {
      if (id) {
        selectPane(id, false);
        updateCurvatureControls(id);
        updateOpacityControls(id);
        const grid = terminalGrid.get(id);
        if (grid) {
          pendingGrid.delete(id);
          qs<HTMLInputElement>('[data-grid-cols]').value = String(grid.cols);
          qs<HTMLInputElement>('[data-grid-rows]').value = String(grid.rows);
          qs<HTMLElement>('[data-grid-caption]').textContent = `${grid.cols} × ${grid.rows}`;
          qs<HTMLButtonElement>('[data-action="apply-grid"]').disabled = !grid.canResize;
        }
      } else {
        activePaneId = undefined;
        clearGridControls();
        renderTree();
        renderPanes();
        updateTargetCaption();
      }
    },
    setAttachedPaneIds(ids) {
      for (const id of attachedPaneIds) {
        if (ids.includes(id)) continue;
        paneStatuses.delete(id);
      }
      attachedPaneIds = [...ids];
      if (activePaneId && !ids.includes(activePaneId)) {
        activePaneId = undefined;
        clearGridControls();
      }
      if (capturedTarget && !ids.includes(capturedTarget)) closeInput();
      renderPanes();
      renderTree();
      updateArrangementAvailability();
    },
    openInput(mode) {
      inputMode = mode;
      if (qs<HTMLElement>('[data-drawer]').hidden) capturedTarget = activePaneId;
      clearModifiers();
      qs<HTMLElement>('[data-drawer]').hidden = false;
      updateInputMode();
      loadCommands();
      updateTargetCaption();
      if (mode === 'keyboard')
        qs<HTMLElement>('[data-keyboard]').scrollIntoView({ block: 'nearest' });
    },
    closeInput,
    setXREntryMode(mode) {
      const label = mode === 'ar' ? 'Enter passthrough' : 'Enter VR';
      const button = qs<HTMLButtonElement>('[data-action="xr"]');
      button.textContent = label;
      button.setAttribute('aria-label', label);
      button.title = label;
    },
    setGazeInputEnabled(enabled) {
      if (settings.gazeInput === enabled) return;
      settings = { ...settings, gazeInput: enabled };
      qs<HTMLInputElement>('[data-gaze-input]').checked = enabled;
      saveSettings();
    },
    setTerminalGrid(paneId, cols, rows, canResize) {
      const previous = terminalGrid.get(paneId);
      const pending = pendingGrid.get(paneId);
      if (
        previous?.cols === cols &&
        previous.rows === rows &&
        previous.canResize === canResize &&
        (!pending || (pending.cols === cols && pending.rows === rows))
      )
        return;
      terminalGrid.set(paneId, { cols, rows, canResize });
      if (activePaneId !== paneId) return;
      const acknowledged = !pending || (pending.cols === cols && pending.rows === rows);
      if (acknowledged) {
        pendingGrid.delete(paneId);
        qs<HTMLInputElement>('[data-grid-cols]').value = String(cols);
        qs<HTMLInputElement>('[data-grid-rows]').value = String(rows);
      }
      qs<HTMLElement>('[data-grid-caption]').textContent = `${cols} × ${rows}`;
      const apply = qs<HTMLButtonElement>('[data-action="apply-grid"]');
      apply.disabled = !canResize;
      if (acknowledged)
        qs<HTMLElement>('[data-grid-status]').textContent = canResize
          ? 'Resize changes the process display size and do not restart it.'
          : 'Resize unavailable while disconnected or read-only.';
    },
    setTerminalCurvature(paneId, degrees) {
      const value = Number.isFinite(degrees) ? Math.max(0, Math.min(100, degrees)) : 0;
      terminalCurvature.set(paneId, value);
      if (activePaneId === paneId) updateCurvatureControls(paneId);
    },
    setTerminalOpacity(paneId, value) {
      const opacity = Number.isFinite(value) ? Math.max(10, Math.min(100, value)) : 100;
      terminalOpacity.set(paneId, opacity);
      if (activePaneId === paneId) updateOpacityControls(paneId);
    },
    setTerminalColorMode(mode, persist = true) {
      settings = { ...settings, colorMode: mode };
      qs<HTMLSelectElement>('[data-color-mode]').value = mode;
      if (persist) saveSettings();
    },
    setKeyboardBackgroundEnabled(enabled, persist = true) {
      settings = { ...settings, keyboardBackground: enabled };
      qs<HTMLInputElement>('[data-keyboard-background]').checked = enabled;
      if (persist) saveSettings();
    },
    setKeyboardCurvature(degrees, persist = false) {
      const value = validateKeyboardCurvature(degrees);
      if (settings.keyboardCurvature === value) return;
      settings = { ...settings, keyboardCurvature: value };
      const input = qs<HTMLInputElement>('[data-keyboard-curvature]');
      input.value = String(value);
      qs<HTMLElement>('[data-keyboard-curvature-value]').textContent = `${value}°`;
      if (persist) saveSettings();
    },
    setTerminalFiltering(filtering, persist = false) {
      const next = validateTerminalFiltering(filtering);
      if (JSON.stringify(settings.filtering) === JSON.stringify(next)) return;
      settings = { ...settings, filtering: next };
      qs<HTMLSelectElement>('[data-filter-mode]').value = settings.filtering.mode;
      qs<HTMLSelectElement>('[data-filter-anisotropy]').value = String(
        settings.filtering.anisotropy,
      );
      qs<HTMLInputElement>('[data-filter-gaze]').checked = settings.filtering.gazeClarity;
      qs<HTMLInputElement>('[data-filter-distance]').value = String(
        settings.filtering.gazeMaxDistance,
      );
      const mode = settings.filtering.mode;
      const mipmapMode = mode === 'mipmap-nearest' || mode === 'mipmap-linear';
      qs<HTMLElement>('[data-filter-anisotropy-row]').hidden = !mipmapMode;
      qs<HTMLElement>('[data-filter-distance-row]').hidden =
        !mipmapMode || !settings.filtering.gazeClarity;
      if (persist) saveSettings();
    },
    setWindowPreferences(value, persist = false) {
      const next = validateWindowPreferences(value);
      if (JSON.stringify(settings.windowPreferences) === JSON.stringify(next)) return;
      settings = { ...settings, windowPreferences: next };
      updateWindowPreferenceControls();
      if (persist) saveSettings();
    },
    setHierarchyStyle(style, persist = false) {
      const next = validateHierarchyStyle(style);
      if (settings.hierarchyStyle === next) return;
      settings = { ...settings, hierarchyStyle: next };
      if (hierarchyStyleSelect) hierarchyStyleSelect.value = next;
      if (persist) saveSettings();
    },
    setKeyborbMode(mode, persist = false) {
      const next = validateKeyborbMode(mode);
      if (settings.keyborbMode === next) return;
      settings = { ...settings, keyborbMode: next };
      if (keyborbModeSelect) keyborbModeSelect.value = next;
      if (persist) saveSettings();
    },
    setBackground(mode, persist = false) {
      if (settings.background === mode) return;
      settings = { ...settings, background: mode };
      qs<HTMLSelectElement>('[data-background]').value = mode;
      if (persist) saveSettings();
    },
    setUISounds(enabled, persist = false) {
      if (settings.uiSounds === enabled) return;
      settings = { ...settings, uiSounds: enabled };
      qs<HTMLInputElement>('[data-ui-sounds]').checked = enabled;
      if (persist) saveSettings();
    },
    setFilteringCapabilities(maxAnisotropy) {
      filteringMaxAnisotropy = Number.isFinite(maxAnisotropy)
        ? Math.max(1, Math.min(16, maxAnisotropy))
        : 16;
      const select = qs<HTMLSelectElement>('[data-filter-anisotropy]');
      for (const option of select.options)
        option.hidden = Number(option.value) > filteringMaxAnisotropy;
      if (Number(select.value) <= filteringMaxAnisotropy) return;
      const available = [...select.options].reverse().find((option) => !option.hidden);
      if (!available) return;
      select.value = available.value;
      settings = {
        ...settings,
        filtering: validateTerminalFiltering({
          ...settings.filtering,
          anisotropy: Number(available.value),
        }),
      };
      saveSettings();
    },
    setDictationState,
    setArrangement(pattern, persist = true) {
      settings = { ...settings, arrangement: pattern };
      if (arrangementSelect) arrangementSelect.value = pattern;
      if (persist) saveSettings();
    },
    getCommandsForPane(paneId) {
      const pane = snapshot.panes.find((item) => item.id === paneId);
      const workspace = pane?.workspaceId ?? 'default';
      const server = commandServerKey(settings.endpoint);
      const shared = sharedCommands
        .filter((command) => command.workspaceId === undefined || command.workspaceId === workspace)
        .map((command): QuickCommandEntry => ({ ...command, shared: true }));
      return [
        ...shared,
        ...store.get(workspaceScope(settings.endpoint, '*')),
        ...store.get(workspaceScope(settings.endpoint, workspace)),
      ].map((command): QuickCommandEntry => ({ ...command, ...stats.get(server, command.id) }));
    },
    setSharedCommands(next) {
      sharedCommands = toSharedCommands(next.filter(isSharedCommand));
      renderCommands();
    },
    recordCommandRun(id, at = Date.now()) {
      stats.record(commandServerKey(settings.endpoint), id, at);
    },
    setUpdateAvailable,
    setNotice,
    setToast(message) {
      toast.textContent = message ?? '';
      toast.hidden = message === null;
    },
    getSettings: () => ({ ...settings }),
    getCommands: () => [...commands],
    addCommand: writeCommand,
    updateCommand: writeCommand,
    deleteCommand,
    removeCommand(id) {
      commands = commands.filter((command) => command.id !== id);
      persistCommands();
    },
    reorderCommands(from, to) {
      commands = reorderCommands(commands, from, to);
      persistCommands();
    },
    captureCommandTarget: () => capturedTarget,
    destroy() {
      clearModifiers();
      clearInterval(agentAgeTimer);
      root.remove();
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

const CSS = `.mux-ui{--bg:#080b10;--surface:#111720;--surface-2:#17212d;--line:#293746;--text:#edf4f8;--muted:#9aabb6;--cyan:#66d5e7;--amber:#f1b65e;position:relative;min-height:100%;height:100%;overflow:hidden;background:radial-gradient(ellipse at 72% -25%,#203747 0%,transparent 45%),linear-gradient(135deg,#080b10,#0e151d 70%,#0b1118);color:var(--text);font:14px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}.mux-ui *{box-sizing:border-box}.mux-top{height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 24px;gap:28px;background:#0b1016dd}.brand{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.14em;font-weight:700}.brand-mark{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--cyan);color:var(--cyan);font-size:14px;border-radius:7px}.demo-badge{font-size:10px;letter-spacing:.1em;color:#15100a;background:var(--amber);padding:3px 7px;border-radius:4px}.connection{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.status-dot{width:7px;height:7px;background:var(--amber);border-radius:50%;box-shadow:0 0 8px #f1b65e88}.status-dot.connected{background:#66dc9d;box-shadow:0 0 8px #66dc9d88}.status-dot.disconnected,.status-dot.error{background:#ee776f;box-shadow:none}.status-dot.paused{background:#9aabb6;box-shadow:none}.top-actions{margin-left:auto;display:flex;gap:9px}.mux-ui button{font:inherit;color:inherit;cursor:pointer}.quiet,.secondary,.connect-btn,.icon-btn,.mini-btn,.send-btn,.text-btn,.key{border:1px solid var(--line);background:transparent}.quiet,.secondary{padding:9px 13px;border-radius:6px;color:var(--muted);display:inline-flex;align-items:center;gap:8px}.quiet:hover,.secondary:hover{color:var(--text);border-color:#537080}.quiet svg,.icon-btn svg,.connect-btn svg,.send-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.icon-btn{display:grid;place-items:center;width:34px;height:34px;border-radius:6px;color:var(--muted)}.icon-btn:hover{color:var(--text);background:var(--surface-2)}.mux-body{display:grid;grid-template-columns:270px 1fr;height:calc(100% - 64px)}.sidebar{border-right:1px solid var(--line);padding:22px 15px 16px;display:flex;flex-direction:column;min-height:0;overflow-y:auto}.side-heading{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:0 8px 12px}.mini-btn{border:0;color:var(--muted);font-size:18px}.tree{overflow:auto;flex:1 1 auto;min-height:96px}.empty-tree{padding:28px 9px;color:#70808b;font-size:12px}.tree-workspace{margin-bottom:16px}.tree-workspace-name{color:var(--muted);font-size:11px;padding:7px 9px}.tree-pane{width:100%;display:flex;gap:9px;text-align:left;padding:9px;border:0;border-radius:6px;background:transparent}.tree-pane:hover,.tree-pane.selected{background:var(--surface-2)}.tree-pane.selected{box-shadow:inset 2px 0 var(--cyan)}.tree-pane b,.tree-pane small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-pane b{font-size:13px;font-weight:600}.tree-pane small{color:var(--muted);font-size:11px;margin-top:2px}.pane-pip{flex:none;width:7px;height:7px;margin-top:6px;border-radius:50%;background:#6ecfa8}.setup{border-top:1px solid var(--line);padding:17px 8px 0}.setup label,.settings-panel label{font-size:11px;color:var(--muted);display:block;margin-bottom:7px}.endpoint-row{display:flex;gap:6px}.endpoint-row input,.command-row select,.compose-row textarea,.settings-panel select{min-width:0;background:#0b1016;border:1px solid var(--line);border-radius:5px;color:var(--text);padding:9px;font:12px ui-monospace,SFMono-Regular,monospace}.endpoint-row input{width:100%}.connect-btn{border-radius:5px;color:var(--cyan);padding:0 10px}.hint{font-size:10px;color:#71818b;margin:8px 0 0}.picture-pick-row{margin-top:6px}.stage{padding:27px clamp(20px,4vw,58px);overflow:auto}.stage-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:22px}h1{font-size:26px;letter-spacing:-.02em;margin:0 0 5px;font-weight:600}.stage-sub{color:var(--muted);margin:0;font-size:13px}.stage-tools{display:flex;gap:8px}.panes{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}.pane{min-height:270px;background:#0e151dcc;border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:0 12px 26px #0005}.pane.active{border-color:#5797a4;box-shadow:0 12px 30px #0007,0 0 0 1px #66d5e722}.pane-head{display:flex;justify-content:space-between;gap:12px;padding:14px 15px;border-bottom:1px solid var(--line)}.pane-head strong,.pane-head small,.pane-label{display:block}.pane-head strong{font-size:14px;font-weight:600}.pane-head small{font:11px ui-monospace,SFMono-Regular,monospace;color:var(--muted);margin-top:4px}.pane-label{font-size:10px;color:var(--cyan);letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px}.terminal-placeholder{height:205px;padding:24px;display:grid;place-content:center;text-align:center;color:#81929e;font:12px ui-monospace,SFMono-Regular,monospace;background:repeating-linear-gradient(0deg,#0e151d,#0e151d 22px,#101922 23px)}.terminal-placeholder small{color:#647581;margin-top:7px}.empty-state{grid-column:1/-1;min-height:430px;display:grid;place-content:center;text-align:center;color:var(--muted)}.empty-state h2{font-size:18px;font-weight:500;color:var(--text);margin:12px 0 5px}.empty-state p{max-width:410px;margin:0 auto;font-size:13px}.empty-orbit{width:64px;height:64px;border:1px solid #45626e;border-radius:50%;margin:auto;position:relative}.empty-orbit:after{content:'';position:absolute;width:7px;height:7px;border-radius:50%;background:var(--cyan);left:8px;top:9px;box-shadow:0 0 14px var(--cyan)}.drawer,.settings-panel{position:absolute;z-index:3;right:20px;bottom:20px;width:min(480px,calc(100% - 40px));background:#111a24f5;border:1px solid #38505e;border-radius:8px;padding:17px;box-shadow:0 18px 45px #000b;backdrop-filter:blur(14px)}.drawer-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.command-row,.compose-row{display:flex;gap:7px;margin-bottom:9px}.command-row select,.compose-row textarea{flex:1}.compose-row textarea{resize:vertical}.send-btn{padding:0 12px;border-radius:5px;color:var(--cyan)}.keyboard{display:flex;flex-direction:column;gap:5px}.key-row{display:flex;gap:5px}.key{min-height:28px;flex:1;border-radius:4px;font:11px ui-monospace,SFMono-Regular,monospace;color:#c5d4da}.key:hover{background:#29404a;color:#fff;border-color:#5c8790}.settings-panel{width:290px;display:flex;flex-direction:column;gap:13px}.update-notice{display:flex}.settings-panel select{width:100%;margin-top:6px}.settings-panel{max-height:calc(100vh - 40px);overflow:auto}[data-grid-controls]{display:grid;gap:10px;border-top:1px solid var(--line);padding-top:12px}[data-grid-controls]>label{display:grid;gap:4px;font-size:12px}[data-grid-caption],[data-grid-status]{color:var(--muted);font-size:11px;line-height:1.5}.grid-inputs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid-inputs label{display:grid;gap:6px;font-size:12px;color:var(--muted)}.grid-inputs input{box-sizing:border-box;width:100%;min-width:0;min-height:36px;background:#0b141d;color:var(--text);border:1px solid #38505e;border-radius:4px;padding:7px 9px;font:inherit;color-scheme:dark}[data-action=apply-grid]{justify-self:start;padding:8px 12px}[data-action=apply-grid]:disabled{opacity:.45;cursor:default}.check{display:grid!important;grid-template-columns:auto 1fr;gap:7px}.check span{grid-column:2;color:#71818b;font-size:10px}.text-btn{border:0;color:var(--amber);text-align:left;padding:5px 0}.text-btn:disabled{opacity:.45;cursor:default}.hand-color-row{display:flex;align-items:center;gap:12px}.hand-color-row input{width:44px;height:30px;padding:2px;background:#0b1016;border:1px solid var(--line);border-radius:5px;cursor:pointer}.mux-ui button:focus-visible,.mux-ui input:focus-visible,.mux-ui textarea:focus-visible,.mux-ui select:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}@media(max-width:760px){.mux-top{padding:0 13px}.mux-body{grid-template-columns:205px 1fr}.quiet{font-size:0;padding:9px}.stage{padding:20px 16px}.stage-head{display:block}.stage-tools{margin-top:14px}.panes{grid-template-columns:1fr}.sidebar{padding-left:8px;padding-right:8px}}`;
