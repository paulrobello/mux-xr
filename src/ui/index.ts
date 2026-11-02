import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  PanelArrangement,
  QuickCommand,
  TerminalColorMode,
  TerminalStatus,
  WorkspaceSnapshot,
} from '../contracts';
import { getKeyHelp } from '../control-help';
import { createModifierState, keyboardDimensions, keyboardKeys } from '../keyboard';
import {
  DEFAULT_TERMINAL_FILTERING,
  type TerminalFiltering,
  validateTerminalFiltering,
} from '../terminal/filtering';
import { terminalKeyLabel } from '../terminal/protocol';

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
  onSendKey?(paneId: string, key: string, modifiers?: KeyModifiers): void;
  onRunCommand?(command: QuickCommand, paneId: string): void;
  onEnterXR?(): void;
  onPassthrough?(): void;
  onSettingsChange?(settings: WorkspaceSettings): void;
  onResetLayout?(): void;
  onDemo?(): void;
  onCommandsChange?(commands: QuickCommand[], scopeKey: string): void;
  onRefresh?(): void;
  onKeyboardBackgroundChange?(enabled: boolean): void;
  onResizeGrid?(paneId: string, cols: number, rows: number): boolean;
  onTerminalCurvature?(paneId: string, degrees: number): void;
  onReloadApp?(): void;
  onArrange?(pattern: PanelArrangement): void;
  onMoveLayout?(direction: number): void;
  onWidgets?(): void;
}

export interface WorkspaceSettings {
  version: 1;
  endpoint: string;
  background: BackgroundMode;
  gazeInput: boolean;
  colorMode: TerminalColorMode;
  keyboardBackground: boolean;
  arrangement: PanelArrangement;
  filtering: TerminalFiltering;
}

export interface WorkspaceUI {
  update(snapshot: WorkspaceSnapshot): void;
  setConnection(status: TerminalStatus | 'idle', detail?: string): void;
  setDemoMode(enabled: boolean): void;
  setActivePane(id: string | undefined): void;
  getSettings(): WorkspaceSettings;
  getCommands(): QuickCommand[];
  addCommand(command: QuickCommand): boolean;
  updateCommand(command: QuickCommand): boolean;
  removeCommand(id: string): void;
  reorderCommands(from: number, to: number): void;
  captureCommandTarget(): string | undefined;
  destroy(): void;
  readonly sceneHost: HTMLElement;
  setAttachedPaneIds(ids: string[]): void;
  openInput(mode: 'commands' | 'keyboard'): void;
  closeInput(): void;
  setGazeInputEnabled(enabled: boolean): void;
  setTerminalGrid(paneId: string, cols: number, rows: number, canResize: boolean): void;
  setTerminalCurvature(paneId: string, degrees: number): void;
  setPaneStatus?(paneId: string, status: TerminalStatus): void;
  setTerminalColorMode(mode: TerminalColorMode, persist?: boolean): void;
  setKeyboardBackgroundEnabled(enabled: boolean, persist?: boolean): void;
  getCommandsForPane(paneId: string): QuickCommand[];
  setUpdateAvailable(available: boolean): void;
  setArrangement(pattern: PanelArrangement, persist?: boolean): void;
  setTerminalFiltering(filtering: TerminalFiltering, persist?: boolean): void;
  setFilteringCapabilities(maxAnisotropy: number): void;
}

export interface CommandStore {
  get(scopeKey: string): QuickCommand[];
  set(scopeKey: string, commands: QuickCommand[]): boolean;
}

const SETTINGS_KEY = 'mux-xr:settings:v1';
const COMMANDS_KEY = 'mux-xr:commands:v1';
const DEFAULT_SETTINGS: WorkspaceSettings = {
  version: 1,
  endpoint: '',
  background: 'observatory',
  gazeInput: false,
  colorMode: 'comfort',
  keyboardBackground: true,
  arrangement: 'arc',
  filtering: { ...DEFAULT_TERMINAL_FILTERING },
};

export function workspaceScope(endpoint: string, workspaceId: string): string {
  return `${endpoint.trim().toLowerCase()}::${workspaceId}`;
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

export function validateSettings(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const candidate = value as Partial<WorkspaceSettings>;
  return {
    version: 1,
    endpoint: typeof candidate.endpoint === 'string' ? candidate.endpoint : '',
    background:
      candidate.background === 'black' ||
      candidate.background === 'gradient' ||
      candidate.background === 'observatory'
        ? candidate.background
        : DEFAULT_SETTINGS.background,
    gazeInput: candidate.gazeInput === true,
    colorMode:
      candidate.colorMode === 'original' || candidate.colorMode === 'monochrome'
        ? candidate.colorMode
        : 'comfort',
    keyboardBackground: candidate.keyboardBackground !== false,
    filtering: validateTerminalFiltering(candidate.filtering),
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
      for (const [scope, value] of Object.entries(parsed)) {
        if (!Array.isArray(value)) continue;
        result[scope] = value.filter(isCommand).map((command) => ({ ...command }));
      }
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
    set(scopeKey, commands) {
      const values = read();
      const next = commands.filter(isCommand).map((command) => ({ ...command }));
      const previous = values[scopeKey];
      values[scopeKey] = next;
      if (write(values)) return true;
      if (previous) values[scopeKey] = previous;
      else delete values[scopeKey];
      return false;
    },
  };
}

function isCommand(value: unknown): value is QuickCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<QuickCommand>;
  return (
    typeof command.id === 'string' &&
    typeof command.label === 'string' &&
    typeof command.text === 'string' &&
    typeof command.sendNewline === 'boolean' &&
    (command.workspaceId === undefined || typeof command.workspaceId === 'string')
  );
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
  const paneStatuses = new Map<string, TerminalStatus>();
  let commands: QuickCommand[] = [];
  let commandScope = 'global';
  const terminalGrid = new Map<string, { cols: number; rows: number; canResize: boolean }>();
  const terminalCurvature = new Map<string, number>();
  const pendingGrid = new Map<string, { cols: number; rows: number }>();
  let inputMode: 'commands' | 'keyboard' = 'commands';
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
  root.innerHTML = `<style>${CSS}</style><header class="mux-top"><div class="brand"><span class="brand-mark">M</span><span>MUX / XR</span><span class="demo-badge" hidden>DEMO</span></div><div class="connection"><span class="status-dot"></span><span class="status-copy">Ready to connect</span></div><div class="top-actions"><button data-action="demo" class="quiet">Demo</button><button data-action="xr" class="quiet" aria-label="Enter immersive XR">${icon('xr')} Enter XR</button><button data-action="settings" class="icon-btn" aria-label="Open settings" title="Open workspace settings">${icon('settings')}</button></div></header><div class="mux-body"><aside class="sidebar"><div class="side-heading"><span>Workspace</span><button data-action="refresh" class="mini-btn" aria-label="Refresh panes" title="Refresh workspace panes">${icon('settings')}</button></div><div class="tree" data-tree><div class="empty-tree">Connect to see panes</div></div><div class="setup"><label for="endpoint">Streamer endpoint</label><div class="endpoint-row"><input id="endpoint" type="url" placeholder="wss://your-computer.local/stream" autocomplete="url"><button data-action="connect" class="connect-btn" aria-label="Connect" title="Connect to the streamer endpoint">${icon('link')}</button></div><p class="hint">LAN WSS or WS endpoint. No process control.</p></div></aside><main class="stage"><div class="stage-head"><div><h1>Terminal workspace</h1><p class="stage-sub" data-detail>Select a pane to begin monitoring.</p></div><div class="stage-tools"><button data-action="commands" class="secondary">Commands</button><button data-action="keyboard" class="secondary">Keyboard</button></div></div><div class="update-notice" data-update-notice hidden role="status"><span>Update available</span><button data-action="reload-update" class="secondary" aria-label="Reload to apply update" title="Reload to apply the available update">Reload</button></div><div class="panes" data-panes><div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div></div><div class="scene-host" data-scene-host aria-label="XR scene host"></div></main></div><div class="drawer" data-drawer hidden><div class="drawer-head"><strong data-drawer-heading>Commands</strong><button data-action="close-drawer" class="icon-btn" aria-label="Close drawer" title="Close input drawer">${icon('close')}</button></div><div class="command-row" data-command-controls><select data-command-scope aria-label="Command scope"><option value="global">Global commands</option><option value="workspace">Workspace commands</option></select><select data-command-select aria-label="Quick command"><option value="">Choose a quick command</option></select><button data-action="run-command" class="send-btn" title="Run the selected quick command">Run</button></div><div class="command-edit" data-command-controls><button data-action="add-command" class="text-btn" title="Create a new quick command">${icon('plus')} Add command</button><button data-action="remove-command" class="text-btn" title="Delete the selected quick command">Remove selected</button></div><div class="compose-row" data-keyboard-controls><textarea data-compose rows="2" placeholder="Compose text for the selected pane" aria-label="Compose terminal text"></textarea><button data-action="send-text" class="send-btn" aria-label="Send composed text" title="Send composed text to the selected pane">${icon('send')}</button></div><div class="keyboard" data-keyboard data-keyboard-controls>${keyboardMarkup}</div></div><div class="settings-panel" data-settings hidden><div class="drawer-head"><strong>Workspace settings</strong><button data-action="close-settings" class="icon-btn" aria-label="Close settings" title="Close settings">${icon('close')}</button></div><label>Background<select data-background><option value="observatory">Observatory</option><option value="gradient">Gradient</option><option value="black">Black</option></select></label><label class="check"><input type="checkbox" data-gaze> Gaze emphasis <span>Highlight the pane at the center of your view.</span></label><label class="check" title="Use head direction to choose the keyboard target after a short dwell. Looking at a pane keeps the last pane target."><input type="checkbox" data-gaze-input> Gaze keyboard input <span>In XR, looking at a pane briefly makes it the keyboard target. Off keeps manual selection.</span></label><button data-action="passthrough" class="secondary">Enter passthrough</button><button data-action="reset" class="text-btn" title="Reset pane layout without deleting commands">Reset local arrangement</button></div>`;
  const keyboardElement = root.querySelector<HTMLElement>('[data-keyboard]');
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
  let filteringMaxAnisotropy = 16;
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
    const grid = document.createElement('div');
    grid.dataset.gridControls = 'true';
    grid.innerHTML =
      '<label>Selected terminal grid <span data-grid-caption>None selected</span></label><div class="grid-inputs"><label>Columns<input data-grid-cols type="number" min="2" max="300" step="1" aria-label="Terminal columns"></label><label>Rows<input data-grid-rows type="number" min="2" max="150" step="1" aria-label="Terminal rows"></label></div><button data-action="apply-grid" class="secondary">Apply grid</button><small data-grid-status>Resize changes the process display size and do not restart it.</small><label>Terminal curvature <span data-terminal-curvature-value>0°</span><input data-terminal-curvature type="range" min="0" max="100" step="1" value="0" aria-label="Terminal curvature in degrees"></label>';
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
  }
  const editor = document.createElement('div');
  editor.className = 'command-editor';
  editor.innerHTML =
    '<input data-command-label placeholder="Label" aria-label="Command label"><input data-command-text placeholder="Command text" aria-label="Command text"><label><input type="checkbox" data-command-newline checked> Enter</label><button data-action="save-command" title="Save the quick command">Save</button><button data-action="move-up" title="Move the selected quick command up">Up</button><button data-action="move-down" title="Move the selected quick command down">Down</button>';
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
  const clearGridControls = (): void => {
    qs<HTMLButtonElement>('[data-action="apply-grid"]').disabled = true;
    qs<HTMLElement>('[data-grid-caption]').textContent = 'No terminal selected';
    qs<HTMLElement>('[data-grid-status]').textContent =
      'Select an attached terminal to change its grid.';
    qs<HTMLInputElement>('[data-terminal-curvature]').value = '0';
    qs<HTMLElement>('[data-terminal-curvature-value]').textContent = '0°';
    qs<HTMLInputElement>('[data-terminal-curvature]').disabled = true;
  };
  const updateCurvatureControls = (paneId: string | undefined): void => {
    const input = qs<HTMLInputElement>('[data-terminal-curvature]');
    const value = paneId ? (terminalCurvature.get(paneId) ?? 0) : 0;
    input.value = String(value);
    input.disabled = !paneId;
    qs<HTMLElement>('[data-terminal-curvature-value]').textContent = `${value}°`;
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
  const renderTree = (): void => {
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
    const branch = (id: string, label: string, content: string): string =>
      `<details data-branch="${escapeHtml(id)}" ${expanded.get(id) !== false ? 'open' : ''}><summary>${escapeHtml(label)}</summary>${content}</details>`;
    tree.innerHTML = `<div class="tree-daemon">Connected computer</div>${grouped(
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
                            `<button class="tree-pane ${pane.id === activePaneId ? 'selected' : ''}" data-pane="${escapeHtml(pane.id)}"><span class="pane-pip"></span><span><b>${escapeHtml(pane.title)}</b><small>${escapeHtml(pane.id)}</small></span></button>`,
                        )
                        .join(''),
                    ),
                  )
                  .join(''),
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
              `<div class="attached-selector ${pane.id === activePaneId ? 'active' : ''}"><button data-select="${escapeHtml(pane.id)}">${escapeHtml(pane.title)}</button><button class="text-btn" data-toggle-connection="${escapeHtml(pane.id)}" aria-label="${escapeHtml(connectionActionLabel(paneStatuses.get(pane.id)))} ${escapeHtml(pane.title)}" title="${escapeHtml(connectionActionTitle(pane.title, paneStatuses.get(pane.id)))}">${escapeHtml(connectionActionLabel(paneStatuses.get(pane.id)))}</button><button class="icon-btn" data-close="${escapeHtml(pane.id)}" aria-label="Close view for ${escapeHtml(pane.title)}" title="Close this viewer and keep the terminal running">${icon('close')}</button></div>`,
          )
          .join('')
      : '<div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div>';
  };
  const renderCommands = (): void => {
    qs<HTMLSelectElement>('[data-command-select]').innerHTML =
      '<option value="">Choose a quick command</option>' +
      commands
        .map(
          (command) =>
            `<option value="${escapeHtml(command.id)}">${escapeHtml(command.label)}</option>`,
        )
        .join('');
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
  const closeInput = (): void => {
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
    const paneId = button.dataset.pane ?? button.dataset.select;
    if (paneId) {
      selectPane(paneId);
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
      if (capturedTarget) callbacks.onSendKey?.(capturedTarget, key, { ...modifierState.active });
      modifierState.consume();
      syncModifierVisuals();
      return;
    }
    switch (button.dataset.action) {
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
      case 'remove-command': {
        const selected = qs<HTMLSelectElement>('[data-command-select]').value;
        commands = commands.filter((command) => command.id !== selected);
        persistCommands();
        callbacks.onCommandsChange?.(commands, currentScope());
        break;
      }
      case 'run-command': {
        const command = commands.find(
          (item) => item.id === qs<HTMLSelectElement>('[data-command-select]').value,
        );
        if (command && capturedTarget) callbacks.onRunCommand?.(command, capturedTarget);
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
  qs<HTMLInputElement>('#endpoint').value = settings.endpoint;
  qs<HTMLSelectElement>('[data-background]').value = settings.background;
  qs<HTMLSelectElement>('[data-color-mode]').value = settings.colorMode;
  qs<HTMLInputElement>('[data-keyboard-background]').checked = settings.keyboardBackground;
  qs<HTMLInputElement>('[data-gaze-input]').checked = settings.gazeInput;
  qs<HTMLSelectElement>('[data-background]').addEventListener('change', (event) => {
    settings = {
      ...settings,
      background: (event.target as HTMLSelectElement).value as BackgroundMode,
    };
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
    if (!isCommand(command)) return false;
    const scope = workspaceScope(settings.endpoint, command.workspaceId ?? '*');
    const saved = store.get(scope);
    const next = saved.some((item) => item.id === command.id)
      ? saved.map((item) => (item.id === command.id ? { ...command } : item))
      : [...saved, { ...command }];
    if (!store.set(scope, next)) {
      qs<HTMLElement>('[data-detail]').textContent = 'Commands could not be saved on this device.';
      return false;
    }
    loadCommands();
    callbacks.onCommandsChange?.(next, scope);
    return true;
  };
  const sceneHost = qs<HTMLElement>('[data-scene-host]');
  return {
    sceneHost,
    update(next) {
      snapshot = next;
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
    setPaneStatus(paneId, status) {
      if (paneStatuses.get(paneId) === status) return;
      paneStatuses.set(paneId, status);
      renderPanes();
    },
    setDemoMode(enabled) {
      qs<HTMLElement>('.demo-badge').hidden = !enabled;
    },
    setActivePane: (id) => {
      if (id) {
        selectPane(id, false);
        updateCurvatureControls(id);
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
      attachedPaneIds = [...ids];
      if (activePaneId && !ids.includes(activePaneId)) {
        activePaneId = undefined;
        clearGridControls();
      }
      if (capturedTarget && !ids.includes(capturedTarget)) closeInput();
      renderPanes();
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
    setArrangement(pattern, persist = true) {
      settings = { ...settings, arrangement: pattern };
      if (arrangementSelect) arrangementSelect.value = pattern;
      if (persist) saveSettings();
    },
    getCommandsForPane(paneId) {
      const pane = snapshot.panes.find((item) => item.id === paneId);
      const workspace = pane?.workspaceId ?? 'default';
      return [
        ...store.get(workspaceScope(settings.endpoint, '*')),
        ...store.get(workspaceScope(settings.endpoint, workspace)),
      ];
    },
    setUpdateAvailable,
    getSettings: () => ({ ...settings }),
    getCommands: () => [...commands],
    addCommand: writeCommand,
    updateCommand: writeCommand,
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

const CSS = `.mux-ui{--bg:#080b10;--surface:#111720;--surface-2:#17212d;--line:#293746;--text:#edf4f8;--muted:#9aabb6;--cyan:#66d5e7;--amber:#f1b65e;position:relative;min-height:100%;height:100%;overflow:hidden;background:radial-gradient(ellipse at 72% -25%,#203747 0%,transparent 45%),linear-gradient(135deg,#080b10,#0e151d 70%,#0b1118);color:var(--text);font:14px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}.mux-ui *{box-sizing:border-box}.mux-top{height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 24px;gap:28px;background:#0b1016dd}.brand{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.14em;font-weight:700}.brand-mark{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--cyan);color:var(--cyan);font-size:14px;border-radius:7px}.demo-badge{font-size:10px;letter-spacing:.1em;color:#15100a;background:var(--amber);padding:3px 7px;border-radius:4px}.connection{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.status-dot{width:7px;height:7px;background:var(--amber);border-radius:50%;box-shadow:0 0 8px #f1b65e88}.status-dot.connected{background:#66dc9d;box-shadow:0 0 8px #66dc9d88}.status-dot.disconnected,.status-dot.error{background:#ee776f;box-shadow:none}.status-dot.paused{background:#9aabb6;box-shadow:none}.top-actions{margin-left:auto;display:flex;gap:9px}.mux-ui button{font:inherit;color:inherit;cursor:pointer}.quiet,.secondary,.connect-btn,.icon-btn,.mini-btn,.send-btn,.text-btn,.key{border:1px solid var(--line);background:transparent}.quiet,.secondary{padding:9px 13px;border-radius:6px;color:var(--muted);display:inline-flex;align-items:center;gap:8px}.quiet:hover,.secondary:hover{color:var(--text);border-color:#537080}.quiet svg,.icon-btn svg,.connect-btn svg,.send-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.icon-btn{display:grid;place-items:center;width:34px;height:34px;border-radius:6px;color:var(--muted)}.icon-btn:hover{color:var(--text);background:var(--surface-2)}.mux-body{display:grid;grid-template-columns:270px 1fr;height:calc(100% - 64px)}.sidebar{border-right:1px solid var(--line);padding:22px 15px 16px;display:flex;flex-direction:column}.side-heading{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:0 8px 12px}.mini-btn{border:0;color:var(--muted);font-size:18px}.tree{overflow:auto;flex:1}.empty-tree{padding:28px 9px;color:#70808b;font-size:12px}.tree-workspace{margin-bottom:16px}.tree-workspace-name{color:var(--muted);font-size:11px;padding:7px 9px}.tree-pane{width:100%;display:flex;gap:9px;text-align:left;padding:9px;border:0;border-radius:6px;background:transparent}.tree-pane:hover,.tree-pane.selected{background:var(--surface-2)}.tree-pane.selected{box-shadow:inset 2px 0 var(--cyan)}.tree-pane b,.tree-pane small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-pane b{font-size:13px;font-weight:600}.tree-pane small{color:var(--muted);font-size:11px;margin-top:2px}.pane-pip{flex:none;width:7px;height:7px;margin-top:6px;border-radius:50%;background:#6ecfa8}.setup{border-top:1px solid var(--line);padding:17px 8px 0}.setup label,.settings-panel label{font-size:11px;color:var(--muted);display:block;margin-bottom:7px}.endpoint-row{display:flex;gap:6px}.endpoint-row input,.command-row select,.compose-row textarea,.settings-panel select{min-width:0;background:#0b1016;border:1px solid var(--line);border-radius:5px;color:var(--text);padding:9px;font:12px ui-monospace,SFMono-Regular,monospace}.endpoint-row input{width:100%}.connect-btn{border-radius:5px;color:var(--cyan);padding:0 10px}.hint{font-size:10px;color:#71818b;margin:8px 0 0}.stage{padding:27px clamp(20px,4vw,58px);overflow:auto}.stage-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:22px}h1{font-size:26px;letter-spacing:-.02em;margin:0 0 5px;font-weight:600}.stage-sub{color:var(--muted);margin:0;font-size:13px}.stage-tools{display:flex;gap:8px}.panes{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}.pane{min-height:270px;background:#0e151dcc;border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:0 12px 26px #0005}.pane.active{border-color:#5797a4;box-shadow:0 12px 30px #0007,0 0 0 1px #66d5e722}.pane-head{display:flex;justify-content:space-between;gap:12px;padding:14px 15px;border-bottom:1px solid var(--line)}.pane-head strong,.pane-head small,.pane-label{display:block}.pane-head strong{font-size:14px;font-weight:600}.pane-head small{font:11px ui-monospace,SFMono-Regular,monospace;color:var(--muted);margin-top:4px}.pane-label{font-size:10px;color:var(--cyan);letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px}.terminal-placeholder{height:205px;padding:24px;display:grid;place-content:center;text-align:center;color:#81929e;font:12px ui-monospace,SFMono-Regular,monospace;background:repeating-linear-gradient(0deg,#0e151d,#0e151d 22px,#101922 23px)}.terminal-placeholder small{color:#647581;margin-top:7px}.empty-state{grid-column:1/-1;min-height:430px;display:grid;place-content:center;text-align:center;color:var(--muted)}.empty-state h2{font-size:18px;font-weight:500;color:var(--text);margin:12px 0 5px}.empty-state p{max-width:410px;margin:0 auto;font-size:13px}.empty-orbit{width:64px;height:64px;border:1px solid #45626e;border-radius:50%;margin:auto;position:relative}.empty-orbit:after{content:'';position:absolute;width:7px;height:7px;border-radius:50%;background:var(--cyan);left:8px;top:9px;box-shadow:0 0 14px var(--cyan)}.drawer,.settings-panel{position:absolute;z-index:3;right:20px;bottom:20px;width:min(480px,calc(100% - 40px));background:#111a24f5;border:1px solid #38505e;border-radius:8px;padding:17px;box-shadow:0 18px 45px #000b;backdrop-filter:blur(14px)}.drawer-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.command-row,.compose-row{display:flex;gap:7px;margin-bottom:9px}.command-row select,.compose-row textarea{flex:1}.compose-row textarea{resize:vertical}.send-btn{padding:0 12px;border-radius:5px;color:var(--cyan)}.keyboard{display:flex;flex-direction:column;gap:5px}.key-row{display:flex;gap:5px}.key{min-height:28px;flex:1;border-radius:4px;font:11px ui-monospace,SFMono-Regular,monospace;color:#c5d4da}.key:hover{background:#29404a;color:#fff;border-color:#5c8790}.settings-panel{width:290px;display:flex;flex-direction:column;gap:13px}.update-notice{display:flex}.settings-panel select{width:100%;margin-top:6px}.settings-panel{max-height:calc(100vh - 40px);overflow:auto}[data-grid-controls]{display:grid;gap:10px;border-top:1px solid var(--line);padding-top:12px}[data-grid-controls]>label{display:grid;gap:4px;font-size:12px}[data-grid-caption],[data-grid-status]{color:var(--muted);font-size:11px;line-height:1.5}.grid-inputs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid-inputs label{display:grid;gap:6px;font-size:12px;color:var(--muted)}.grid-inputs input{box-sizing:border-box;width:100%;min-width:0;min-height:36px;background:#0b141d;color:var(--text);border:1px solid #38505e;border-radius:4px;padding:7px 9px;font:inherit;color-scheme:dark}[data-action=apply-grid]{justify-self:start;padding:8px 12px}[data-action=apply-grid]:disabled{opacity:.45;cursor:default}.check{display:grid!important;grid-template-columns:auto 1fr;gap:7px}.check span{grid-column:2;color:#71818b;font-size:10px}.text-btn{border:0;color:var(--amber);text-align:left;padding:5px 0}.mux-ui button:focus-visible,.mux-ui input:focus-visible,.mux-ui textarea:focus-visible,.mux-ui select:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}@media(max-width:760px){.mux-top{padding:0 13px}.mux-body{grid-template-columns:205px 1fr}.quiet{font-size:0;padding:9px}.stage{padding:20px 16px}.stage-head{display:block}.stage-tools{margin-top:14px}.panes{grid-template-columns:1fr}.sidebar{padding-left:8px;padding-right:8px}}`;
