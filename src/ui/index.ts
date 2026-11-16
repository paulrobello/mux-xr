import './styles.css';
import { validateHandColor, validateWeatherZip } from '@par/xr-workspace';
import type {
  BackgroundMode,
  KeyModifiers,
  PaneDescriptor,
  PanelArrangement,
  QuickCommand,
  QuickCommandEntry,
  TerminalColorMode,
  TerminalStatus,
  WorkspaceSnapshot,
} from '../contracts';
import { HOST_CLIPBOARD_SETUP } from '../host-clipboard';
import { isSharedCommand } from '../quick-commands';
import {
  browserStorage,
  createSettingsStore,
  type SettingsStore,
  settingChanged,
  type WorkspaceSettings,
} from '../settings/store';
import type { DictationAction, DictationState } from '../speech-input';
import { type TerminalFiltering, validateTerminalFiltering } from '../terminal/filtering';
import { type PaneProcess, processBadge } from '../terminal/lifecycle';
import { AGENTS_SORTS, type AgentRosterRow } from '../workspace/agent-roster';
import { type HierarchyStyle, validateHierarchyStyle } from '../workspace/hierarchy-style';
import type { KeyborbMode } from '../workspace/keyborb';
import { validateKeyborbMode } from '../workspace/keyborb';
import { XR_ENTRY_LABELS, type XrEntryMode } from '../xr/entry';
import { mountAgentRoster } from './agent-roster';
import { mountCommandLibrary } from './input-drawer';
import { mountKeyboard } from './keyboard';
import { mountSettingsPanel } from './settings-panel';
import { buildShell } from './shell';
import { mountSidebar } from './sidebar';

export { validateHandColor };

import type { PaneCreationState } from '../workspace/pane-create';
import {
  MAX_TERMINAL_CURVATURE_DEGREES,
  type WindowPreferences,
} from '../workspace/window-preferences';

export type { SemanticKey } from '@par/xr-workspace';
export {
  createModifierState,
  keyboardDimensions,
  keyboardKeys,
  semanticKeyboardLayout,
} from '@par/xr-workspace';

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
  onPassthrough?(mode: Exclude<XrEntryMode, 'vr'>): void;
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

export interface WorkspaceUI {
  update(snapshot: WorkspaceSnapshot): void;
  setConnection(status: TerminalStatus | 'idle', detail?: string): void;
  setDemoMode(enabled: boolean): void;
  /** Fills the endpoint field without persisting or connecting; used for a link-named streamer awaiting confirmation. */
  setEndpointDraft(value: string): void;
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
  setXREntryMode(mode: XrEntryMode): void;
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
  /** Applies a hand color chosen in XR; empty restores the default color. */
  setHandColor(color: string, persist?: boolean): void;
  /** Applies an arm color chosen in XR; empty makes the arms match the hands. */
  setArmColor(color: string, persist?: boolean): void;
  /** Applies an accent chosen in XR; empty restores the default cyan. */
  setAccentColor(color: string, persist?: boolean): void;
  /** Applies an environment accent chosen in XR; empty matches the interface accent. */
  setEnvironmentAccentColor(color: string, persist?: boolean): void;
  /** Applies a weather ZIP chosen in XR; anything but five digits clears it. */
  setWeatherZip(zip: string, persist?: boolean): void;
  setBackground(mode: BackgroundMode, persist?: boolean): void;
  setFilteringCapabilities(maxAnisotropy: number): void;
  setDictationState(state: DictationState): void;
  setKeyboardCurvature(degrees: number, persist?: boolean): void;
}

// The swatch the color picker shows while the hands keep their default color.
const _DEFAULT_HAND_SWATCH = '#b4b4b4';
// The swatch the accent pickers show while the XR accent stays the default cyan.
const _DEFAULT_ACCENT_SWATCH = '#68d6ff';

export interface WorkspaceUIOptions {
  /** The settings both presenters share; a private store over `localStorage` when omitted. */
  settings?: SettingsStore;
}

export function mountWorkspaceUI(
  container: HTMLElement,
  callbacks: UICallbacks,
  options: WorkspaceUIOptions = {},
): WorkspaceUI {
  const storage = browserStorage();
  const settingsStore = options.settings ?? createSettingsStore(storage);
  if (!settingsStore.get().endpoint && typeof location !== 'undefined')
    settingsStore.update({ endpoint: location.origin }, { persist: false });
  let settings = settingsStore.get();
  // Each control registers the settings it shows, so a change from XR or another presenter
  // re-renders exactly the controls whose fields moved.
  const settingsViews: Array<{ keys: Array<keyof WorkspaceSettings>; refresh: () => void }> = [];
  const bindSettings = (keys: Array<keyof WorkspaceSettings>, refresh: () => void): void => {
    settingsViews.push({ keys, refresh });
  };
  const refreshSettingsViews = (changed: (key: keyof WorkspaceSettings) => boolean): void => {
    for (const view of settingsViews) if (view.keys.some(changed)) view.refresh();
  };
  // Re-renders the patched controls even when the store ignored the patch, because a control may
  // hold a raw typed value that validation changed back to the stored one.
  const saveSettings = (
    patch: Partial<WorkspaceSettings>,
    saveOptions?: { persist?: boolean },
  ): void => {
    const saved = settingsStore.update(patch, saveOptions);
    settings = settingsStore.get();
    refreshSettingsViews((key) => key in patch);
    if (!saved)
      qs<HTMLElement>('[data-detail]').textContent = 'Settings could not be saved on this device.';
  };
  const stopSettings = settingsStore.subscribe((next, previous) => {
    settings = settingsStore.get();
    refreshSettingsViews((key) => settingChanged(next, previous, key));
    callbacks.onSettingsChange?.(next);
  });
  let snapshot: WorkspaceSnapshot = { panes: [] };
  let activePaneId: string | undefined;
  let attachedPaneIds: string[] = [];
  let paneCreation: PaneCreationState = { available: true, pending: false };
  const paneStatuses = new Map<string, TerminalStatus>();
  const paneProcesses = new Map<string, PaneProcess>();
  const paneBadge = (paneId: string): string | null =>
    processBadge(paneProcesses.get(paneId), paneStatuses.get(paneId));
  const terminalGrid = new Map<string, { cols: number; rows: number; canResize: boolean }>();
  const terminalCurvature = new Map<string, number>();
  const terminalOpacity = new Map<string, number>();
  const pendingGrid = new Map<string, { cols: number; rows: number }>();
  let inputMode: 'commands' | 'keyboard' = 'commands';
  let capturedTarget: string | undefined;
  const { root, toast, updateNotice } = buildShell({
    container,
    onWidgets: () => callbacks.onWidgets?.(),
  });
  root.querySelector('[data-gaze]')?.parentElement?.remove();
  const _settingsPanel = root.querySelector<HTMLElement>('[data-settings]');
  const keyboard = mountKeyboard({
    root,
    capturedTarget: () => capturedTarget,
    onSendKey: (paneId, key, modifiers) => callbacks.onSendKey?.(paneId, key, modifiers),
    onDictationAction: (action) => callbacks.onDictationAction?.(action),
    onDictationDraftChange: (text) => callbacks.onDictationDraftChange?.(text),
  });
  const settingsPanel = root.querySelector<HTMLElement>('[data-settings]');
  root.querySelector('[data-gaze]')?.parentElement?.remove();
  let filteringMaxAnisotropy = 16;
  const updateArrangementAvailability = (): void => {
    settingsPanelControls?.setArrangementAvailable(attachedPaneIds.length > 0);
  };
  const settingsPanelControls = settingsPanel
    ? mountSettingsPanel({
        panel: settingsPanel,
        root,
        callbacks,
        current: () => settings,
        saveSettings,
        bindSettings,
        activePaneId: () => activePaneId,
        terminalCurvature,
        terminalOpacity,
        qs: (selector) => qs(selector),
        renderAgents: () => agentRoster.render(),
      })
    : null;
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
  keyboard.clearModifiers();
  clearGridControls();
  updateArrangementAvailability();
  const actionHelp: Record<string, string> = {
    demo: 'Preview synthetic terminals without running commands',
    xr: 'Enter immersive VR with controller input',
    commands: 'Open saved global and workspace quick commands',
    keyboard: 'Open text entry and the terminal keyboard',
    passthrough: 'Enter mixed reality with your surroundings visible',
    'desk-window': 'Keep the virtual world and reveal your desk through a movable window',
    'send-text': 'Send text as typed without adding Enter',
    'run-command': 'Send the saved command; add Enter if enabled',
  };
  for (const [action, help] of Object.entries(actionHelp))
    root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.setAttribute('title', help);
  root
    .querySelector('[data-command-newline]')
    ?.setAttribute('title', 'Append Enter after the command text to execute it');
  const agentRoster = mountAgentRoster({
    root,
    current: () => settings,
    activePaneId: () => activePaneId,
  });
  const sidebar = mountSidebar({
    root,
    snapshot: () => snapshot,
    activePaneId: () => activePaneId,
    attachedPaneIds: () => attachedPaneIds,
    paneCreation: () => paneCreation,
    paneBadge,
    paneStatus: (paneId) => paneStatuses.get(paneId),
    renderAgents: () => agentRoster.render(),
  });
  const { renderTree, renderPanes } = sidebar;
  const commandLibrary = mountCommandLibrary({
    root,
    storage,
    current: () => settings,
    snapshot: () => snapshot,
    activePaneId: () => activePaneId,
    capturedTarget: () => capturedTarget,
    onCommandsChange: (list, scope) => callbacks.onCommandsChange?.(list, scope),
    onRunCommand: (command, paneId) => callbacks.onRunCommand?.(command, paneId),
  });
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
  const closeInput = (): void => {
    callbacks.onDictationAction?.('cancel');
    capturedTarget = undefined;
    keyboard.clearModifiers();
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
      keyboard.clearModifiers();
      commandLibrary.load();
    }
    updateTargetCaption();
    if (notify) callbacks.onSelectPane?.(pane);
  };
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
    if (keyboard.handleKeyClick(button)) return;
    if (
      ['move-up', 'move-down', 'pin-command', 'remove-command'].includes(
        button.dataset.action ?? '',
      ) &&
      isSharedCommand({ id: qs<HTMLSelectElement>('[data-command-select]').value })
    ) {
      qs<HTMLElement>('[data-detail]').textContent = 'Shared commands are read-only.';
      return;
    }
    if (commandLibrary.handleAction(button.dataset.action ?? '')) return;
    switch (button.dataset.action) {
      case 'agents-sort': {
        const next =
          AGENTS_SORTS[(AGENTS_SORTS.indexOf(settings.agentsSort) + 1) % AGENTS_SORTS.length];
        saveSettings({ agentsSort: next });
        agentRoster.render();
        break;
      }
      case 'connect': {
        const endpoint = qs<HTMLInputElement>('#endpoint').value.trim();
        capturedTarget = undefined;
        keyboard.clearModifiers();
        qs<HTMLElement>('[data-drawer]').hidden = true;
        saveSettings({ endpoint });
        commandLibrary.load();
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
        keyboard.clearModifiers();
        qs<HTMLElement>('[data-drawer]').hidden = false;
        updateInputMode();
        updateTargetCaption();
        commandLibrary.load();
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
        callbacks.onPassthrough?.('ar');
        break;
      case 'desk-window':
        callbacks.onPassthrough?.('desk');
        break;
      case 'demo':
        callbacks.onDemo?.();
        break;
      case 'reset':
        callbacks.onResetLayout?.();
        break;
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
  qs<HTMLInputElement>('#endpoint').value = settings.endpoint;
  qs<HTMLSelectElement>('[data-background]').value = settings.background;
  qs<HTMLSelectElement>('[data-hierarchy-style]').value = settings.hierarchyStyle;
  qs<HTMLSelectElement>('[data-keyborb-mode]').value = settings.keyborbMode;
  qs<HTMLSelectElement>('[data-color-mode]').value = settings.colorMode;
  qs<HTMLInputElement>('[data-keyboard-background]').checked = settings.keyboardBackground;
  qs<HTMLInputElement>('[data-gaze-input]').checked = settings.gazeInput;
  qs<HTMLInputElement>('[data-ui-sounds]').checked = settings.uiSounds;
  keyboard.setDictationState({
    supported: false,
    status: 'idle',
    transcript: '',
    error: null,
  });
  qs<HTMLSelectElement>('[data-background]').addEventListener('change', (event) =>
    saveSettings({ background: (event.target as HTMLSelectElement).value as BackgroundMode }),
  );
  qs<HTMLSelectElement>('[data-hierarchy-style]').addEventListener('change', (event) =>
    saveSettings({
      hierarchyStyle: validateHierarchyStyle((event.target as HTMLSelectElement).value),
    }),
  );
  qs<HTMLSelectElement>('[data-keyborb-mode]').addEventListener('change', (event) =>
    saveSettings({ keyborbMode: validateKeyborbMode((event.target as HTMLSelectElement).value) }),
  );
  const weatherZipInput = qs<HTMLInputElement>('[data-weather-zip]');
  weatherZipInput.value = settings.weatherZip;
  bindSettings(['weatherZip'], () => {
    weatherZipInput.value = settings.weatherZip;
  });
  weatherZipInput.addEventListener('change', () => {
    const next = validateWeatherZip(weatherZipInput.value.trim());
    weatherZipInput.value = next;
    if (settings.weatherZip === next) return;
    saveSettings({ weatherZip: next });
  });
  qs<HTMLInputElement>('[data-ui-sounds]').addEventListener('change', (event) =>
    saveSettings({ uiSounds: (event.target as HTMLInputElement).checked }),
  );
  qs<HTMLInputElement>('[data-gaze-input]').addEventListener('change', (event) =>
    saveSettings({ gazeInput: (event.target as HTMLInputElement).checked }),
  );
  qs<HTMLSelectElement>('[data-color-mode]').addEventListener('change', (event) =>
    saveSettings({ colorMode: (event.target as HTMLSelectElement).value as TerminalColorMode }),
  );
  qs<HTMLInputElement>('[data-keyboard-background]').addEventListener('change', (event) =>
    saveSettings({ keyboardBackground: (event.target as HTMLInputElement).checked }),
  );
  bindSettings(['background'], () => {
    qs<HTMLSelectElement>('[data-background]').value = settings.background;
  });
  bindSettings(['colorMode'], () => {
    qs<HTMLSelectElement>('[data-color-mode]').value = settings.colorMode;
  });
  bindSettings(['keyboardBackground'], () => {
    qs<HTMLInputElement>('[data-keyboard-background]').checked = settings.keyboardBackground;
  });
  bindSettings(['gazeInput'], () => {
    qs<HTMLInputElement>('[data-gaze-input]').checked = settings.gazeInput;
  });
  bindSettings(['uiSounds'], () => {
    qs<HTMLInputElement>('[data-ui-sounds]').checked = settings.uiSounds;
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
      commandLibrary.load();
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
      agentRoster.setRows(rows);
    },
    setDemoMode(enabled) {
      qs<HTMLElement>('.demo-badge').hidden = !enabled;
    },
    setEndpointDraft(value) {
      qs<HTMLInputElement>('#endpoint').value = value;
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
      keyboard.clearModifiers();
      qs<HTMLElement>('[data-drawer]').hidden = false;
      updateInputMode();
      commandLibrary.load();
      updateTargetCaption();
      if (mode === 'keyboard')
        qs<HTMLElement>('[data-keyboard]').scrollIntoView({ block: 'nearest' });
    },
    closeInput,
    setXREntryMode(mode) {
      const label = XR_ENTRY_LABELS[mode];
      const button = qs<HTMLButtonElement>('[data-action="xr"]');
      button.textContent = label;
      button.setAttribute('aria-label', label);
      button.title = label;
    },
    setGazeInputEnabled: (enabled) => saveSettings({ gazeInput: enabled }),
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
      const value = Number.isFinite(degrees)
        ? Math.max(0, Math.min(MAX_TERMINAL_CURVATURE_DEGREES, degrees))
        : 0;
      terminalCurvature.set(paneId, value);
      if (activePaneId === paneId) updateCurvatureControls(paneId);
    },
    setTerminalOpacity(paneId, value) {
      const opacity = Number.isFinite(value) ? Math.max(10, Math.min(100, value)) : 100;
      terminalOpacity.set(paneId, opacity);
      if (activePaneId === paneId) updateOpacityControls(paneId);
    },
    setTerminalColorMode: (mode, persist = true) => saveSettings({ colorMode: mode }, { persist }),
    setKeyboardBackgroundEnabled: (enabled, persist = true) =>
      saveSettings({ keyboardBackground: enabled }, { persist }),
    setKeyboardCurvature: (degrees, persist = false) =>
      saveSettings({ keyboardCurvature: degrees }, { persist }),
    setTerminalFiltering: (filtering, persist = false) => saveSettings({ filtering }, { persist }),
    setWindowPreferences: (value, persist = false) =>
      saveSettings({ windowPreferences: value }, { persist }),
    setHierarchyStyle: (style, persist = false) =>
      saveSettings({ hierarchyStyle: style }, { persist }),
    setKeyborbMode: (mode, persist = false) => saveSettings({ keyborbMode: mode }, { persist }),
    setBackground: (mode, persist = false) => saveSettings({ background: mode }, { persist }),
    setArmColor: (color, persist = false) => saveSettings({ armColor: color }, { persist }),
    setWeatherZip: (zip, persist = false) => saveSettings({ weatherZip: zip }, { persist }),
    setAccentColor: (color, persist = false) => saveSettings({ accentColor: color }, { persist }),
    setEnvironmentAccentColor: (color, persist = false) =>
      saveSettings({ environmentAccentColor: color }, { persist }),
    setHandColor: (color, persist = false) => saveSettings({ handColor: color }, { persist }),
    setUISounds: (enabled, persist = false) => saveSettings({ uiSounds: enabled }, { persist }),
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
      saveSettings({
        filtering: validateTerminalFiltering({
          ...settings.filtering,
          anisotropy: Number(available.value),
        }),
      });
    },
    setDictationState: (state) => keyboard.setDictationState(state),
    setArrangement: (pattern, persist = true) =>
      saveSettings({ arrangement: pattern }, { persist }),
    getCommandsForPane: (paneId) => commandLibrary.commandsForPane(paneId),
    setSharedCommands: (next) => commandLibrary.setSharedCommands(next),
    recordCommandRun: (id, at = Date.now()) => commandLibrary.recordRun(id, at),
    setUpdateAvailable,
    setNotice,
    setToast(message) {
      toast.textContent = message ?? '';
      toast.hidden = message === null;
    },
    getSettings: () => ({ ...settings }),
    getCommands: () => [...commandLibrary.commands()],
    addCommand: (command) => commandLibrary.writeCommand(command),
    updateCommand: (command) => commandLibrary.writeCommand(command),
    deleteCommand: (id) => commandLibrary.deleteCommand(id),
    removeCommand: (id) => commandLibrary.removeCommand(id),
    reorderCommands: (from, to) => commandLibrary.reorder(from, to),
    captureCommandTarget: () => capturedTarget,
    destroy() {
      stopSettings();
      keyboard.clearModifiers();
      agentRoster.destroy();
      root.remove();
    },
  };
}
