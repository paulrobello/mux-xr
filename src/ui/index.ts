import './styles.css';
import { validateHandColor } from '@par/xr-workspace';
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
import { isSharedCommand } from '../quick-commands';
import {
  browserStorage,
  createSettingsStore,
  type SettingsStore,
  type WorkspaceSettings,
} from '../settings/store';
import type { DictationAction, DictationState } from '../speech-input';
import type { TerminalFiltering } from '../terminal/filtering';
import { type PaneProcess, processBadge } from '../terminal/lifecycle';
import { AGENTS_SORTS, type AgentRosterRow } from '../workspace/agent-roster';
import type { HierarchyStyle } from '../workspace/hierarchy-style';
import type { KeyborbMode } from '../workspace/keyborb';
import { XR_ENTRY_LABELS, type XrEntryMode } from '../xr/entry';
import { forwardedActions, mountHostClipboardControls } from './actions';
import { mountAgentRoster } from './agent-roster';
import { mountCommandLibrary } from './input-drawer';
import { mountKeyboard } from './keyboard';
import { createSettingsBinding } from './settings-binding';
import { mountSettingsControls } from './settings-controls';
import { mountSettingsPanel } from './settings-panel';
import { createSettingsSetters } from './settings-setters';
import { buildShell } from './shell';
import { mountSidebar } from './sidebar';
import { mountTerminalControls } from './terminal-controls';

export { validateHandColor };

import type { PaneCreationState } from '../workspace/pane-create';
import type { WindowPreferences } from '../workspace/window-preferences';

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
  /** Relabels the drawer Paste button while a paste waits for its confirming press. */
  setPastePrompt(text: string | null): void;
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
  const binding = createSettingsBinding({
    store: settingsStore,
    onChange: (next) => callbacks.onSettingsChange?.(next),
    onSaveError: () => {
      qs<HTMLElement>('[data-detail]').textContent = 'Settings could not be saved on this device.';
    },
  });
  const { bind: bindSettings, save: saveSettings, current: currentSettings } = binding;
  let snapshot: WorkspaceSnapshot = { panes: [] };
  let activePaneId: string | undefined;
  let attachedPaneIds: string[] = [];
  let paneCreation: PaneCreationState = { available: true, pending: false };
  const paneStatuses = new Map<string, TerminalStatus>();
  const paneProcesses = new Map<string, PaneProcess>();
  const paneBadge = (paneId: string): string | null =>
    processBadge(paneProcesses.get(paneId), paneStatuses.get(paneId));
  let inputMode: 'commands' | 'keyboard' = 'commands';
  let capturedTarget: string | undefined;
  const { root, toast, updateNotice } = buildShell({
    container,
    onWidgets: () => callbacks.onWidgets?.(),
  });
  root.querySelector('[data-gaze]')?.parentElement?.remove();
  const keyboard = mountKeyboard({
    root,
    capturedTarget: () => capturedTarget,
    onSendKey: (paneId, key, modifiers) => callbacks.onSendKey?.(paneId, key, modifiers),
    onDictationAction: (action) => callbacks.onDictationAction?.(action),
    onDictationDraftChange: (text) => callbacks.onDictationDraftChange?.(text),
  });
  const settingsPanel = root.querySelector<HTMLElement>('[data-settings]');
  root.querySelector('[data-gaze]')?.parentElement?.remove();
  const updateArrangementAvailability = (): void => {
    settingsPanelControls?.setArrangementAvailable(attachedPaneIds.length > 0);
  };
  const settingsPanelControls = settingsPanel
    ? mountSettingsPanel({
        panel: settingsPanel,
        root,
        callbacks,
        current: currentSettings,
        saveSettings,
        bindSettings,
        activePaneId: () => activePaneId,
        setTerminalCurvature: (paneId, degrees) => terminalControls.curvature.set(paneId, degrees),
        setTerminalOpacity: (paneId, opacity) => terminalControls.opacity.set(paneId, opacity),
        qs: (selector) => qs(selector),
        renderAgents: () => agentRoster.render(),
      })
    : null;
  const qs = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  const forwarders = forwardedActions(callbacks);
  const hostClipboard = mountHostClipboardControls({ root, callbacks });
  const terminalControls = mountTerminalControls({
    root,
    activePaneId: () => activePaneId,
    onResizeGrid: callbacks.onResizeGrid
      ? (paneId, cols, rows) => callbacks.onResizeGrid?.(paneId, cols, rows) ?? false
      : undefined,
  });
  keyboard.clearModifiers();
  terminalControls.clear();
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
    current: currentSettings,
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
    current: currentSettings,
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
  const pasteButton = root.querySelector<HTMLButtonElement>('[data-action="paste-clipboard"]');
  const setPastePrompt = (text: string | null): void => {
    if (!pasteButton) return;
    pasteButton.textContent = text === null ? 'Paste' : 'Confirm paste';
    pasteButton.title =
      text === null
        ? 'Paste clipboard text into the selected terminal'
        : 'Press again to send the reviewed text';
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
    if (hostClipboard.handleAction(button.dataset.action ?? '')) return;
    const forwarded = forwarders[button.dataset.action ?? ''];
    if (forwarded) {
      forwarded();
      return;
    }
    switch (button.dataset.action) {
      case 'agents-sort': {
        const next =
          AGENTS_SORTS[
            (AGENTS_SORTS.indexOf(currentSettings().agentsSort) + 1) % AGENTS_SORTS.length
          ];
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
      case 'paste-clipboard':
        callbacks.onPaste?.(capturedTarget ?? activePaneId);
        break;
      case 'settings':
        qs<HTMLElement>('[data-settings]').hidden = false;
        break;
      case 'close-settings':
        qs<HTMLElement>('[data-settings]').hidden = true;
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
  mountSettingsControls({ root, current: currentSettings, saveSettings, bindSettings });
  keyboard.setDictationState({
    supported: false,
    status: 'idle',
    transcript: '',
    error: null,
  });
  const settingsSetters = createSettingsSetters({ root, current: currentSettings, saveSettings });
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
        terminalControls.clear();
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
        terminalControls.show(id);
      } else {
        activePaneId = undefined;
        terminalControls.clear();
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
        terminalControls.clear();
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
    setTerminalGrid: (paneId, cols, rows, canResize) =>
      terminalControls.setGrid(paneId, cols, rows, canResize),
    setTerminalCurvature: (paneId, degrees) => terminalControls.setCurvature(paneId, degrees),
    setTerminalOpacity: (paneId, value) => terminalControls.setOpacity(paneId, value),
    ...settingsSetters,
    setDictationState: (state) => keyboard.setDictationState(state),
    getCommandsForPane: (paneId) => commandLibrary.commandsForPane(paneId),
    setSharedCommands: (next) => commandLibrary.setSharedCommands(next),
    recordCommandRun: (id, at = Date.now()) => commandLibrary.recordRun(id, at),
    setUpdateAvailable,
    setNotice,
    setPastePrompt,
    setToast(message) {
      toast.textContent = message ?? '';
      toast.hidden = message === null;
    },
    getSettings: () => ({ ...currentSettings() }),
    getCommands: () => [...commandLibrary.commands()],
    addCommand: (command) => commandLibrary.writeCommand(command),
    updateCommand: (command) => commandLibrary.writeCommand(command),
    deleteCommand: (id) => commandLibrary.deleteCommand(id),
    removeCommand: (id) => commandLibrary.removeCommand(id),
    reorderCommands: (from, to) => commandLibrary.reorder(from, to),
    captureCommandTarget: () => capturedTarget,
    destroy() {
      binding.stop();
      keyboard.clearModifiers();
      agentRoster.destroy();
      root.remove();
    },
  };
}
