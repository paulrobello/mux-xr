import './styles.css';
import {
  createModifierState,
  keyboardDimensions,
  keyboardKeys,
  validateHandColor,
  validateWeatherZip,
} from '@par/xr-workspace';
import { createCommandStatsStore, createCommandStore } from '../commands/store';
import {
  exportServerCommands,
  mergeImportedCommands,
  reorderCommands,
  workspaceScope,
} from '../commands/transfer';
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
import { getKeyHelp } from '../control-help';
import { HOST_CLIPBOARD_SETUP } from '../host-clipboard';
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
import { terminalKeyLabel } from '../terminal/protocol';
import { AGENTS_SORTS, type AgentRosterRow } from '../workspace/agent-roster';
import { type HierarchyStyle, validateHierarchyStyle } from '../workspace/hierarchy-style';
import type { KeyborbMode } from '../workspace/keyborb';
import { validateKeyborbMode } from '../workspace/keyborb';
import { XR_ENTRY_LABELS, type XrEntryMode } from '../xr/entry';
import { mountAgentRoster } from './agent-roster';
import { escapeHtml, icon } from './html';
import { mountSettingsPanel } from './settings-panel';
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
  root.innerHTML = `<header class="mux-top"><div class="brand"><span class="brand-mark">M</span><span>MUX / XR</span><span class="demo-badge" hidden>DEMO</span></div><div class="connection"><span class="status-dot"></span><span class="status-copy">Ready to connect</span></div><div class="top-actions"><button data-action="demo" class="quiet">Demo</button><button data-action="xr" class="quiet" aria-label="Enter immersive XR">${icon('xr')} Enter XR</button><button data-action="settings" class="icon-btn" aria-label="Open settings" title="Open workspace settings">${icon('settings')}</button></div></header><div class="mux-body"><aside class="sidebar"><section class="agents" data-agents-section hidden aria-label="Agent roster"><div class="side-heading"><span>Agents <span data-agent-count></span></span><button data-action="agents-sort" class="mini-text" aria-label="Agent order" title="Change the agent order"></button></div><div class="agent-list" data-agents></div></section><div class="side-heading"><span>Workspace</span><button data-action="refresh" class="mini-btn" aria-label="Refresh panes" title="Refresh workspace panes">${icon('settings')}</button></div><div class="tree" data-tree><div class="empty-tree">Connect to see panes</div></div><div class="setup"><label for="endpoint">Streamer endpoint</label><div class="endpoint-row"><input id="endpoint" type="url" placeholder="wss://your-computer.local/stream" autocomplete="url"><button data-action="connect" class="connect-btn" aria-label="Connect" title="Connect to the streamer endpoint">${icon('link')}</button></div><p class="hint">LAN WSS or WS endpoint. Creates default-shell terminals only when the streamer allows it.</p></div></aside><main class="stage"><div class="stage-head"><div><h1>Terminal workspace</h1><p class="stage-sub" data-detail>Select a pane to begin monitoring.</p></div><div class="stage-tools"><button data-action="commands" class="secondary">Commands</button><button data-action="keyboard" class="secondary">Keyboard</button></div></div><div class="update-notice" data-update-notice hidden role="status"><span>Update available</span><button data-action="reload-update" class="secondary" aria-label="Reload to apply update" title="Reload to apply the available update">Reload</button></div><div class="workspace-notice" data-notice hidden role="status"><span data-notice-text></span><button data-action="dismiss-notice" class="icon-btn" aria-label="Dismiss notice" title="Dismiss notice">×</button></div><div class="panes" data-panes><div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div></div><div class="scene-host" data-scene-host aria-label="XR scene host"></div></main></div><div class="drawer" data-drawer hidden><div class="drawer-head"><strong data-drawer-heading>Commands</strong><button data-action="close-drawer" class="icon-btn" aria-label="Close drawer" title="Close input drawer">${icon('close')}</button></div><div class="command-row" data-command-controls><select data-command-scope aria-label="Command scope"><option value="global">Global commands</option><option value="workspace">Workspace commands</option></select><select data-command-select aria-label="Quick command"><option value="">Choose a quick command</option></select><button data-action="run-command" class="send-btn" title="Run the selected quick command">Run</button></div><div class="command-edit" data-command-controls><button data-action="add-command" class="text-btn" title="Create a new quick command">${icon('plus')} Add command</button><button data-action="remove-command" class="text-btn" title="Delete the selected quick command">Remove selected</button><button data-action="pin-command" class="text-btn" title="Pin or unpin the selected quick command in XR">Pin / unpin</button><button data-action="export-commands" class="text-btn" title="Download every quick command for this server as JSON">Export</button><button data-action="import-commands" class="text-btn" title="Merge quick commands from an exported JSON file">Import</button><input type="file" accept="application/json,.json" data-command-import hidden></div><div class="compose-row" data-keyboard-controls><textarea data-compose rows="2" placeholder="Compose text for the selected pane" aria-label="Compose terminal text"></textarea><button data-action="send-text" class="send-btn" aria-label="Send composed text" title="Send composed text to the selected pane">${icon('send')}</button></div><div class="keyboard" data-keyboard data-keyboard-controls>${keyboardMarkup}</div></div><div class="settings-panel" data-settings hidden><div class="drawer-head"><strong>Workspace settings</strong><button data-action="close-settings" class="icon-btn" aria-label="Close settings" title="Close settings">${icon('close')}</button></div><label>Background<select data-background><option value="observatory">Observatory</option><option value="gradient">Gradient</option><option value="black">Black</option><option value="hangar">Hangar deck</option><option value="deep-water">Deep-water station</option><option value="studio">Minimal studio</option><option value="desert">Desert night</option><option value="aurora">Aurora tundra</option><option value="koi">Koi garden</option><option value="summit">Cloud summit</option><option value="rooftop">Rain rooftop</option></select></label><label class="check"><input type="checkbox" data-gaze> Gaze emphasis <span>Highlight the pane at the center of your view.</span></label><button data-action="passthrough" class="secondary">Enter passthrough</button><button data-action="desk-window" class="secondary">${XR_ENTRY_LABELS.desk}</button><button data-action="reset" class="text-btn" title="Reset pane layout without deleting commands">Reset local arrangement</button></div>`;
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
    insert.hidden = Boolean(state.forNote);
    insert.disabled =
      Boolean(state.forNote) ||
      !['review', 'error'].includes(state.status) ||
      !state.transcript.trim();
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
        if (key === 'Enter') {
          if (!dictationState.forNote) callbacks.onDictationAction?.('insert');
        } else if (key === 'Escape') callbacks.onDictationAction?.('cancel');
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
        saveSettings({ agentsSort: next });
        agentRoster.render();
        break;
      }
      case 'connect': {
        const endpoint = qs<HTMLInputElement>('#endpoint').value.trim();
        capturedTarget = undefined;
        clearModifiers();
        qs<HTMLElement>('[data-drawer]').hidden = true;
        saveSettings({ endpoint });
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
    setDictationState,
    setArrangement: (pattern, persist = true) =>
      saveSettings({ arrangement: pattern }, { persist }),
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
      stopSettings();
      clearModifiers();
      agentRoster.destroy();
      root.remove();
    },
  };
}
