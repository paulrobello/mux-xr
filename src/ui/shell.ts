import { keyboardDimensions, keyboardKeys } from '@par/xr-workspace';
import { BACKGROUNDS } from '../backgrounds';
import { XR_ENTRY_LABELS } from '../xr/entry';
import { escapeHtml, icon } from './html';
import { keyboardTitle } from './keyboard';

export interface ShellDeps {
  container: HTMLElement;
  onWidgets?(): void;
}

export interface Shell {
  root: HTMLElement;
  toast: HTMLElement;
  updateNotice: HTMLElement;
}

/**
 * Builds the workspace shell inside `container`: the header, sidebar, stage, input drawer and
 * settings panel markup, plus the controls added to them. Every rule these controls need lives
 * in src/ui/styles.css, so nothing here depends on a <style> element.
 */
export function buildShell(deps: ShellDeps): Shell {
  const { container } = deps;
  const root = document.createElement('section');
  root.className = 'mux-ui';
  const backgroundOptions = BACKGROUNDS.map(
    ({ id, label }) => `<option value="${id}">${escapeHtml(label)}</option>`,
  ).join('');
  const keyboardMarkup = keyboardKeys
    .map(
      (entry) =>
        `<button class="key" data-key="${escapeHtml(entry.key)}" data-modifier="${entry.modifier ?? ''}" style="--key-x:${entry.x};--key-y:${entry.y};--key-width:${entry.width};--key-height:${entry.height}" aria-pressed="false" aria-label="${escapeHtml(entry.key === 'Backspace' ? 'Backspace' : entry.label)}" title="${escapeHtml(keyboardTitle(entry.key))}">${escapeHtml(entry.label)}</button>`,
    )
    .join('');
  root.innerHTML = `<header class="mux-top"><div class="brand"><span class="brand-mark">M</span><span>MUX / XR</span><span class="demo-badge" hidden>DEMO</span></div><div class="connection"><span class="status-dot"></span><span class="status-copy">Ready to connect</span></div><div class="top-actions"><button data-action="demo" class="quiet">Demo</button><button data-action="xr" class="quiet" aria-label="Enter immersive XR">${icon('xr')} Enter XR</button><button data-action="settings" class="icon-btn" aria-label="Open settings" title="Open workspace settings">${icon('settings')}</button></div></header><div class="mux-body"><aside class="sidebar"><section class="agents" data-agents-section hidden aria-label="Agent roster"><div class="side-heading"><span>Agents <span data-agent-count></span></span><button data-action="agents-sort" class="mini-text" aria-label="Agent order" title="Change the agent order"></button></div><div class="agent-list" data-agents></div></section><div class="side-heading"><span>Workspace</span><button data-action="refresh" class="mini-btn" aria-label="Refresh panes" title="Refresh workspace panes">${icon('settings')}</button></div><div class="tree" data-tree><div class="empty-tree">Connect to see panes</div></div><div class="setup"><label for="endpoint">Streamer endpoint</label><div class="endpoint-row"><input id="endpoint" type="url" placeholder="wss://your-computer.local/stream" autocomplete="url"><button data-action="connect" class="connect-btn" aria-label="Connect" title="Connect to the streamer endpoint">${icon('link')}</button></div><p class="hint">LAN WSS or WS endpoint. Creates default-shell terminals only when the streamer allows it.</p></div></aside><main class="stage"><div class="stage-head"><div><h1>Terminal workspace</h1><p class="stage-sub" data-detail>Select a pane to begin monitoring.</p></div><div class="stage-tools"><button data-action="commands" class="secondary">Commands</button><button data-action="keyboard" class="secondary">Keyboard</button></div></div><div class="update-notice" data-update-notice hidden role="status"><span>Update available</span><button data-action="reload-update" class="secondary" aria-label="Reload to apply update" title="Reload to apply the available update">Reload</button></div><div class="workspace-notice" data-notice hidden role="status"><span data-notice-text></span><button data-action="dismiss-notice" class="icon-btn" aria-label="Dismiss notice" title="Dismiss notice">×</button></div><div class="panes" data-panes><div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div></div><div class="scene-host" data-scene-host aria-label="XR scene host"></div></main></div><div class="drawer" data-drawer hidden><div class="drawer-head"><strong data-drawer-heading>Commands</strong><button data-action="close-drawer" class="icon-btn" aria-label="Close drawer" title="Close input drawer">${icon('close')}</button></div><div class="command-row" data-command-controls><select data-command-scope aria-label="Command scope"><option value="global">Global commands</option><option value="workspace">Workspace commands</option></select><select data-command-select aria-label="Quick command"><option value="">Choose a quick command</option></select><button data-action="run-command" class="send-btn" title="Run the selected quick command">Run</button></div><div class="command-edit" data-command-controls><button data-action="add-command" class="text-btn" title="Create a new quick command">${icon('plus')} Add command</button><button data-action="remove-command" class="text-btn" title="Delete the selected quick command">Remove selected</button><button data-action="pin-command" class="text-btn" title="Pin or unpin the selected quick command in XR">Pin / unpin</button><button data-action="export-commands" class="text-btn" title="Download every quick command for this server as JSON">Export</button><button data-action="import-commands" class="text-btn" title="Merge quick commands from an exported JSON file">Import</button><input type="file" accept="application/json,.json" data-command-import hidden></div><div class="compose-row" data-keyboard-controls><textarea data-compose rows="2" placeholder="Compose text for the selected pane" aria-label="Compose terminal text"></textarea><button data-action="send-text" class="send-btn" aria-label="Send composed text" title="Send composed text to the selected pane">${icon('send')}</button></div><div class="keyboard" data-keyboard data-keyboard-controls>${keyboardMarkup}</div></div><div class="settings-panel" data-settings hidden><div class="drawer-head"><strong>Workspace settings</strong><button data-action="close-settings" class="icon-btn" aria-label="Close settings" title="Close settings">${icon('close')}</button></div><label>Background<select data-background>${backgroundOptions}</select></label><label class="check"><input type="checkbox" data-gaze> Gaze emphasis <span>Highlight the pane at the center of your view.</span></label><button data-action="passthrough" class="secondary">Enter passthrough</button><button data-action="desk-window" class="secondary">${XR_ENTRY_LABELS.desk}</button><button data-action="reset" class="text-btn" title="Reset pane layout without deleting commands">Reset local arrangement</button></div>`;
  const keyboardElement = root.querySelector<HTMLElement>('[data-keyboard]');
  const drawer = root.querySelector<HTMLElement>('[data-drawer]');
  const toast = document.createElement('div');
  toast.className = 'mux-clipboard-toast';
  toast.dataset.clipboardToast = 'true';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  root.append(toast);
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
  widgetsButton.addEventListener('click', () => deps.onWidgets?.());
  root.querySelector('.stage-tools')?.append(widgetsButton);
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
  return { root, toast, updateNotice };
}
