import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  QuickCommand,
  TerminalStatus,
  WorkspaceSnapshot,
} from '../contracts';
import { getKeyHelp } from '../control-help';
import { terminalKeyLabel } from '../terminal/protocol';

export interface UICallbacks {
  onConnect(endpoint: string): void;
  onDisconnect?(): void;
  onSelectPane?(pane: PaneDescriptor): void;
  onClosePane?(pane: PaneDescriptor): void;
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
}

export interface WorkspaceSettings {
  version: 1;
  endpoint: string;
  background: BackgroundMode;
  gazeEmphasis: boolean;
}

export interface WorkspaceUI {
  update(snapshot: WorkspaceSnapshot): void;
  setConnection(status: TerminalStatus | 'idle', detail?: string): void;
  setDemoMode(enabled: boolean): void;
  setActivePane(id: string | undefined): void;
  getSettings(): WorkspaceSettings;
  getCommands(): QuickCommand[];
  addCommand(command: QuickCommand): void;
  updateCommand(command: QuickCommand): void;
  removeCommand(id: string): void;
  reorderCommands(from: number, to: number): void;
  captureCommandTarget(): string | undefined;
  destroy(): void;
  readonly sceneHost: HTMLElement;
  setAttachedPaneIds(ids: string[]): void;
  openInput(mode: 'commands' | 'keyboard'): void;
  getCommandsForPane(paneId: string): QuickCommand[];
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
  gazeEmphasis: true,
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
    gazeEmphasis: typeof candidate.gazeEmphasis === 'boolean' ? candidate.gazeEmphasis : true,
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

export interface SemanticKey {
  readonly label: string;
  readonly key: string;
  readonly modifier?: 'ctrl' | 'alt' | 'shift';
}
const KEY_LAYOUT: readonly (readonly SemanticKey[])[] = [
  [
    { label: 'Esc', key: 'Escape' },
    { label: 'Tab', key: 'Tab' },
    { label: 'Ctrl', key: 'Control', modifier: 'ctrl' },
    { label: 'Alt', key: 'Alt', modifier: 'alt' },
    { label: 'Shift', key: 'Shift', modifier: 'shift' },
  ],
  [
    { label: '↑', key: 'ArrowUp' },
    { label: '←', key: 'ArrowLeft' },
    { label: '↓', key: 'ArrowDown' },
    { label: '→', key: 'ArrowRight' },
    { label: 'Enter', key: 'Enter' },
  ],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'].map((key) => ({
    label: key === 'Backspace' ? '⌫' : key,
    key,
  })),
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'].map((key) => ({
    label: key,
    key: key.toLowerCase(),
  })),
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", '\\'].map((key) => ({
    label: key,
    key: key.toLowerCase(),
  })),
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'].map((key) => ({
    label: key,
    key: key.toLowerCase(),
  })),
  [{ label: 'Space', key: ' ' }],
];
export const semanticKeyboardLayout = KEY_LAYOUT;

export function mountWorkspaceUI(container: HTMLElement, callbacks: UICallbacks): WorkspaceUI {
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
  let settings = loadSettings(storage);
  if (!settings.endpoint && typeof location !== 'undefined')
    settings = { ...settings, endpoint: location.origin };
  let snapshot: WorkspaceSnapshot = { panes: [] };
  let activePaneId: string | undefined;
  let attachedPaneIds: string[] = [];
  let commands: QuickCommand[] = [];
  let commandScope = 'global';
  let inputMode: 'commands' | 'keyboard' = 'commands';
  const heldModifiers: KeyModifiers = {};
  const keyboardLabel = (key: string, shift = false): string => {
    if (key.length === 1 && key !== ' ') return terminalKeyLabel(key, shift);
    return KEY_LAYOUT.flat().find((entry) => entry.key === key)?.label ?? key;
  };
  const keyboardTitle = (key: string): string => getKeyHelp(key) ?? '';
  const clearModifiers = (): void => {
    delete heldModifiers.ctrl;
    delete heldModifiers.alt;
    delete heldModifiers.shift;
    for (const key of root.querySelectorAll<HTMLButtonElement>('.key')) {
      key.classList.remove('active');
      if (!key.dataset.modifier) key.textContent = keyboardLabel(key.dataset.key ?? '');
    }
  };
  let capturedTarget: string | undefined;
  const root = document.createElement('section');
  root.className = 'mux-ui';
  root.innerHTML = `<style>${CSS}</style><header class="mux-top"><div class="brand"><span class="brand-mark">M</span><span>MUX / XR</span><span class="demo-badge" hidden>DEMO</span></div><div class="connection"><span class="status-dot"></span><span class="status-copy">Ready to connect</span></div><div class="top-actions"><button data-action="demo" class="quiet">Demo</button><button data-action="xr" class="quiet" aria-label="Enter immersive XR">${icon('xr')} Enter XR</button><button data-action="settings" class="icon-btn" aria-label="Open settings" title="Open workspace settings">${icon('settings')}</button></div></header><div class="mux-body"><aside class="sidebar"><div class="side-heading"><span>Workspace</span><button data-action="refresh" class="mini-btn" aria-label="Refresh panes" title="Refresh workspace panes">${icon('settings')}</button></div><div class="tree" data-tree><div class="empty-tree">Connect to see panes</div></div><div class="setup"><label for="endpoint">Streamer endpoint</label><div class="endpoint-row"><input id="endpoint" type="url" placeholder="wss://your-computer.local/stream" autocomplete="url"><button data-action="connect" class="connect-btn" aria-label="Connect" title="Connect to the streamer endpoint">${icon('link')}</button></div><p class="hint">LAN WSS or WS endpoint. No process control.</p></div></aside><main class="stage"><div class="stage-head"><div><h1>Terminal workspace</h1><p class="stage-sub" data-detail>Select a pane to begin monitoring.</p></div><div class="stage-tools"><button data-action="commands" class="secondary">Commands</button><button data-action="keyboard" class="secondary">Keyboard</button></div></div><div class="panes" data-panes><div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div></div><div class="scene-host" data-scene-host aria-label="XR scene host"></div></main></div><div class="drawer" data-drawer hidden><div class="drawer-head"><strong data-drawer-heading>Commands</strong><button data-action="close-drawer" class="icon-btn" aria-label="Close drawer" title="Close input drawer">${icon('close')}</button></div><div class="command-row" data-command-controls><select data-command-scope aria-label="Command scope"><option value="global">Global commands</option><option value="workspace">Workspace commands</option></select><select data-command-select aria-label="Quick command"><option value="">Choose a quick command</option></select><button data-action="run-command" class="send-btn" title="Run the selected quick command">Run</button></div><div class="command-edit" data-command-controls><button data-action="add-command" class="text-btn" title="Create a new quick command">${icon('plus')} Add command</button><button data-action="remove-command" class="text-btn" title="Delete the selected quick command">Remove selected</button></div><div class="compose-row" data-keyboard-controls><textarea data-compose rows="2" placeholder="Compose text for the selected pane" aria-label="Compose terminal text"></textarea><button data-action="send-text" class="send-btn" aria-label="Send composed text" title="Send composed text to the selected pane">${icon('send')}</button></div><div class="keyboard" data-keyboard data-keyboard-controls>${KEY_LAYOUT.map((row) => `<div class="key-row">${row.map((key) => `<button class="key" data-key="${escapeHtml(key.key)}" data-modifier="${key.modifier ?? ''}" aria-label="${escapeHtml(key.key === 'Backspace' ? 'Backspace' : key.label)}" title="${escapeHtml(keyboardTitle(key.key))}">${escapeHtml(key.label)}</button>`).join('')}</div>`).join('')}</div></div><div class="settings-panel" data-settings hidden><div class="drawer-head"><strong>Workspace settings</strong><button data-action="close-settings" class="icon-btn" aria-label="Close settings" title="Close settings">${icon('close')}</button></div><label>Background<select data-background><option value="observatory">Observatory</option><option value="gradient">Gradient</option><option value="black">Black</option></select></label><label class="check"><input type="checkbox" data-gaze> Gaze emphasis <span>Visual emphasis only, never input focus.</span></label><button data-action="passthrough" class="secondary">Enter passthrough</button><button data-action="reset" class="text-btn" title="Reset pane layout without deleting commands">Reset local arrangement</button></div>`;
  container.replaceChildren(root);
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
  clearModifiers();
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
              `<div class="attached-selector ${pane.id === activePaneId ? 'active' : ''}"><button data-select="${escapeHtml(pane.id)}">${escapeHtml(pane.title)}</button><button class="icon-btn" data-close="${escapeHtml(pane.id)}" aria-label="Detach ${escapeHtml(pane.title)}" title="Detach this viewer and keep the terminal running">${icon('close')}</button></div>`,
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
    if (button.dataset.key) {
      const key = button.dataset.key;
      const modifier = button.dataset.modifier as 'ctrl' | 'alt' | 'shift' | '';
      if (modifier) {
        heldModifiers[modifier] = !heldModifiers[modifier];
        button.classList.toggle('active');
        root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((keyButton) => {
          const raw = keyButton.dataset.key ?? '';
          if (!keyButton.dataset.modifier)
            keyButton.textContent = keyboardLabel(raw, Boolean(heldModifiers.shift));
        });
        return;
      }
      if (capturedTarget) callbacks.onSendKey?.(capturedTarget, key, { ...heldModifiers });
      clearModifiers();
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
  qs<HTMLInputElement>('[data-gaze]').checked = settings.gazeEmphasis;
  qs<HTMLSelectElement>('[data-background]').addEventListener('change', (event) => {
    settings = {
      ...settings,
      background: (event.target as HTMLSelectElement).value as BackgroundMode,
    };
    saveSettings();
  });
  qs<HTMLInputElement>('[data-gaze]').addEventListener('change', (event) => {
    settings = { ...settings, gazeEmphasis: (event.target as HTMLInputElement).checked };
    saveSettings();
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
  const writeCommand = (command: QuickCommand): void => {
    if (!isCommand(command)) return;
    const scope = workspaceScope(settings.endpoint, command.workspaceId ?? '*');
    const saved = store.get(scope);
    const next = saved.some((item) => item.id === command.id)
      ? saved.map((item) => (item.id === command.id ? { ...command } : item))
      : [...saved, { ...command }];
    if (!store.set(scope, next)) {
      qs<HTMLElement>('[data-detail]').textContent = 'Commands could not be saved on this device.';
      return;
    }
    loadCommands();
    callbacks.onCommandsChange?.(next, scope);
  };
  const sceneHost = qs<HTMLElement>('[data-scene-host]');
  return {
    sceneHost,
    update(next) {
      snapshot = next;
      if (activePaneId && !next.panes.some((pane) => pane.id === activePaneId))
        activePaneId = undefined;
      if (capturedTarget && !next.panes.some((pane) => pane.id === capturedTarget)) closeInput();
      loadCommands();
      renderTree();
      renderPanes();
    },
    setConnection(nextStatus, detail = nextStatus === 'connected' ? 'Connected' : 'Not connected') {
      qs<HTMLElement>('.status-copy').textContent = detail;
      qs<HTMLElement>('.status-dot').className = `status-dot ${nextStatus}`;
    },
    setDemoMode(enabled) {
      qs<HTMLElement>('.demo-badge').hidden = !enabled;
    },
    setActivePane: (id) => {
      if (id) selectPane(id, false);
      else {
        activePaneId = undefined;
        renderTree();
        renderPanes();
        updateTargetCaption();
      }
    },
    setAttachedPaneIds(ids) {
      attachedPaneIds = [...ids];
      if (capturedTarget && !ids.includes(capturedTarget)) closeInput();
      renderPanes();
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
    getCommandsForPane(paneId) {
      const pane = snapshot.panes.find((item) => item.id === paneId);
      const workspace = pane?.workspaceId ?? 'default';
      return [
        ...store.get(workspaceScope(settings.endpoint, '*')),
        ...store.get(workspaceScope(settings.endpoint, workspace)),
      ];
    },
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

const CSS = `.mux-ui{--bg:#080b10;--surface:#111720;--surface-2:#17212d;--line:#293746;--text:#edf4f8;--muted:#9aabb6;--cyan:#66d5e7;--amber:#f1b65e;position:relative;min-height:100%;height:100%;overflow:hidden;background:radial-gradient(ellipse at 72% -25%,#203747 0%,transparent 45%),linear-gradient(135deg,#080b10,#0e151d 70%,#0b1118);color:var(--text);font:14px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}.mux-ui *{box-sizing:border-box}.mux-top{height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 24px;gap:28px;background:#0b1016dd}.brand{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.14em;font-weight:700}.brand-mark{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--cyan);color:var(--cyan);font-size:14px;border-radius:7px}.demo-badge{font-size:10px;letter-spacing:.1em;color:#15100a;background:var(--amber);padding:3px 7px;border-radius:4px}.connection{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.status-dot{width:7px;height:7px;background:var(--amber);border-radius:50%;box-shadow:0 0 8px #f1b65e88}.status-dot.connected{background:#66dc9d;box-shadow:0 0 8px #66dc9d88}.status-dot.disconnected{background:#ee776f}.top-actions{margin-left:auto;display:flex;gap:9px}.mux-ui button{font:inherit;color:inherit;cursor:pointer}.quiet,.secondary,.connect-btn,.icon-btn,.mini-btn,.send-btn,.text-btn,.key{border:1px solid var(--line);background:transparent}.quiet,.secondary{padding:9px 13px;border-radius:6px;color:var(--muted);display:inline-flex;align-items:center;gap:8px}.quiet:hover,.secondary:hover{color:var(--text);border-color:#537080}.quiet svg,.icon-btn svg,.connect-btn svg,.send-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.icon-btn{display:grid;place-items:center;width:34px;height:34px;border-radius:6px;color:var(--muted)}.icon-btn:hover{color:var(--text);background:var(--surface-2)}.mux-body{display:grid;grid-template-columns:270px 1fr;height:calc(100% - 64px)}.sidebar{border-right:1px solid var(--line);padding:22px 15px 16px;display:flex;flex-direction:column}.side-heading{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:0 8px 12px}.mini-btn{border:0;color:var(--muted);font-size:18px}.tree{overflow:auto;flex:1}.empty-tree{padding:28px 9px;color:#70808b;font-size:12px}.tree-workspace{margin-bottom:16px}.tree-workspace-name{color:var(--muted);font-size:11px;padding:7px 9px}.tree-pane{width:100%;display:flex;gap:9px;text-align:left;padding:9px;border:0;border-radius:6px;background:transparent}.tree-pane:hover,.tree-pane.selected{background:var(--surface-2)}.tree-pane.selected{box-shadow:inset 2px 0 var(--cyan)}.tree-pane b,.tree-pane small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-pane b{font-size:13px;font-weight:600}.tree-pane small{color:var(--muted);font-size:11px;margin-top:2px}.pane-pip{flex:none;width:7px;height:7px;margin-top:6px;border-radius:50%;background:#6ecfa8}.setup{border-top:1px solid var(--line);padding:17px 8px 0}.setup label,.settings-panel label{font-size:11px;color:var(--muted);display:block;margin-bottom:7px}.endpoint-row{display:flex;gap:6px}.endpoint-row input,.command-row select,.compose-row textarea,.settings-panel select{min-width:0;background:#0b1016;border:1px solid var(--line);border-radius:5px;color:var(--text);padding:9px;font:12px ui-monospace,SFMono-Regular,monospace}.endpoint-row input{width:100%}.connect-btn{border-radius:5px;color:var(--cyan);padding:0 10px}.hint{font-size:10px;color:#71818b;margin:8px 0 0}.stage{padding:27px clamp(20px,4vw,58px);overflow:auto}.stage-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:22px}h1{font-size:26px;letter-spacing:-.02em;margin:0 0 5px;font-weight:600}.stage-sub{color:var(--muted);margin:0;font-size:13px}.stage-tools{display:flex;gap:8px}.panes{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}.pane{min-height:270px;background:#0e151dcc;border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:0 12px 26px #0005}.pane.active{border-color:#5797a4;box-shadow:0 12px 30px #0007,0 0 0 1px #66d5e722}.pane-head{display:flex;justify-content:space-between;gap:12px;padding:14px 15px;border-bottom:1px solid var(--line)}.pane-head strong,.pane-head small,.pane-label{display:block}.pane-head strong{font-size:14px;font-weight:600}.pane-head small{font:11px ui-monospace,SFMono-Regular,monospace;color:var(--muted);margin-top:4px}.pane-label{font-size:10px;color:var(--cyan);letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px}.terminal-placeholder{height:205px;padding:24px;display:grid;place-content:center;text-align:center;color:#81929e;font:12px ui-monospace,SFMono-Regular,monospace;background:repeating-linear-gradient(0deg,#0e151d,#0e151d 22px,#101922 23px)}.terminal-placeholder small{color:#647581;margin-top:7px}.empty-state{grid-column:1/-1;min-height:430px;display:grid;place-content:center;text-align:center;color:var(--muted)}.empty-state h2{font-size:18px;font-weight:500;color:var(--text);margin:12px 0 5px}.empty-state p{max-width:410px;margin:0 auto;font-size:13px}.empty-orbit{width:64px;height:64px;border:1px solid #45626e;border-radius:50%;margin:auto;position:relative}.empty-orbit:after{content:'';position:absolute;width:7px;height:7px;border-radius:50%;background:var(--cyan);left:8px;top:9px;box-shadow:0 0 14px var(--cyan)}.drawer,.settings-panel{position:absolute;z-index:3;right:20px;bottom:20px;width:min(480px,calc(100% - 40px));background:#111a24f5;border:1px solid #38505e;border-radius:8px;padding:17px;box-shadow:0 18px 45px #000b;backdrop-filter:blur(14px)}.drawer-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.command-row,.compose-row{display:flex;gap:7px;margin-bottom:9px}.command-row select,.compose-row textarea{flex:1}.compose-row textarea{resize:vertical}.send-btn{padding:0 12px;border-radius:5px;color:var(--cyan)}.keyboard{display:flex;flex-direction:column;gap:5px}.key-row{display:flex;gap:5px}.key{min-height:28px;flex:1;border-radius:4px;font:11px ui-monospace,SFMono-Regular,monospace;color:#c5d4da}.key:hover{background:#29404a;color:#fff;border-color:#5c8790}.settings-panel{width:290px;display:flex;flex-direction:column;gap:13px}.settings-panel select{width:100%;margin-top:6px}.check{display:grid!important;grid-template-columns:auto 1fr;gap:7px}.check span{grid-column:2;color:#71818b;font-size:10px}.text-btn{border:0;color:var(--amber);text-align:left;padding:5px 0}.mux-ui button:focus-visible,.mux-ui input:focus-visible,.mux-ui textarea:focus-visible,.mux-ui select:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}@media(max-width:760px){.mux-top{padding:0 13px}.mux-body{grid-template-columns:205px 1fr}.quiet{font-size:0;padding:9px}.stage{padding:20px 16px}.stage-head{display:block}.stage-tools{margin-top:14px}.panes{grid-template-columns:1fr}.sidebar{padding-left:8px;padding-right:8px}}`;
