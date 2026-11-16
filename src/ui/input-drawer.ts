import { createCommandStatsStore, createCommandStore } from '../commands/store';
import {
  exportServerCommands,
  mergeImportedCommands,
  reorderCommands,
  workspaceScope,
} from '../commands/transfer';
import type { PaneDescriptor, QuickCommand, QuickCommandEntry } from '../contracts';
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
import type { WorkspaceSettings } from '../settings/store';
import { escapeHtml } from './html';

export interface CommandLibraryDeps {
  root: HTMLElement;
  storage: Storage | undefined;
  current(): WorkspaceSettings;
  snapshot(): { panes: PaneDescriptor[] };
  activePaneId(): string | undefined;
  /** The pane the drawer sends to; set when the drawer opens. */
  capturedTarget(): string | undefined;
  onCommandsChange?(commands: QuickCommand[], scopeKey: string): void;
  onRunCommand?(command: QuickCommand, paneId: string): void;
}

export interface CommandLibrary {
  commands(): QuickCommand[];
  setSharedCommands(commands: QuickCommand[]): void;
  /** Reloads the saved commands for the current server, scope and target. */
  load(): void;
  /** The commands the scene lists for a pane, shared ones first, with run statistics. */
  commandsForPane(paneId: string): QuickCommandEntry[];
  recordRun(id: string, at: number): void;
  writeCommand(command: QuickCommand): boolean;
  deleteCommand(id: string): boolean;
  removeCommand(id: string): void;
  reorder(from: number, to: number): void;
  /** Handles a click on a command action button; false when the action is not one of its own. */
  handleAction(action: string): boolean;
}

/**
 * The quick-command half of the input drawer: the saved and shared lists, the scope selector, the
 * editor, import and export, and running a command in the captured pane.
 */
export function mountCommandLibrary(deps: CommandLibraryDeps): CommandLibrary {
  const { root } = deps;
  const callbacks = deps;
  const qs = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  const detail = (text: string): void => {
    qs<HTMLElement>('[data-detail]').textContent = text;
  };
  const store = createCommandStore(deps.storage);
  const stats = createCommandStatsStore(deps.storage);
  let commands: QuickCommand[] = [];
  let sharedCommands: QuickCommand[] = [];
  let commandScope = 'global';

  const commandOption = (command: QuickCommand): string =>
    `<option value="${escapeHtml(command.id)}">${escapeHtml(command.label)}${command.pinned ? ' · pinned' : ''}</option>`;
  const target = (): string | undefined => deps.capturedTarget() ?? deps.activePaneId();
  const targetWorkspace = (): string =>
    deps.snapshot().panes.find((pane) => pane.id === target())?.workspaceId ?? 'default';
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
      ? workspaceScope(deps.current().endpoint, '*')
      : workspaceScope(deps.current().endpoint, targetWorkspace());
  const load = (): void => {
    commands = store.get(currentScope());
    renderCommands();
  };
  const persistCommands = (): void => {
    const scope = currentScope();
    if (!store.set(scope, commands)) {
      commands = store.get(scope);
      renderCommands();
      detail('Commands could not be saved on this device.');
      return;
    }
    renderCommands();
    callbacks.onCommandsChange?.(commands, scope);
  };
  const serverScopePrefix = (): string => workspaceScope(deps.current().endpoint, '');
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
  const writeCommand = (command: QuickCommand): boolean => {
    if (!isCommand(command) || isSharedCommand(command)) return false;
    const scope = workspaceScope(deps.current().endpoint, command.workspaceId ?? '*');
    const values = withoutServerCommand(store.all(), command.id, scope);
    const saved = store.get(scope);
    const next = saved.some((item) => item.id === command.id)
      ? saved.map((item) => (item.id === command.id ? copyCommand(command) : item))
      : [...saved, copyCommand(command)];
    values[scope] = next;
    if (!store.setAll(values)) {
      detail('Commands could not be saved on this device.');
      return false;
    }
    load();
    callbacks.onCommandsChange?.(next, scope);
    return true;
  };
  const deleteCommand = (id: string): boolean => {
    const values = withoutServerCommand(store.all(), id);
    if (!store.setAll(values)) {
      detail('Commands could not be saved on this device.');
      return false;
    }
    load();
    callbacks.onCommandsChange?.(commands, currentScope());
    return true;
  };
  const importCommands = (text: string): void => {
    let parsed: ReturnType<typeof parseCommandFile> = null;
    try {
      parsed = parseCommandFile(JSON.parse(text));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      detail('Import failed: not a quick command file.');
      return;
    }
    const merged = mergeImportedCommands(store.all(), deps.current().endpoint, parsed.commands);
    if (!store.setAll(merged.values)) {
      detail('Commands could not be saved on this device.');
      return;
    }
    load();
    callbacks.onCommandsChange?.(commands, currentScope());
    const skipped = parsed.skipped + merged.skipped;
    detail(
      `Imported ${merged.added + merged.updated} quick commands: ${merged.added} new, ${merged.updated} updated${skipped ? `, ${skipped} skipped` : ''}.`,
    );
  };

  qs<HTMLSelectElement>('[data-command-scope]').addEventListener('change', (event) => {
    commandScope = (event.target as HTMLSelectElement).value;
    load();
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

  const handleAction = (action: string): boolean => {
    switch (action) {
      case 'add-command':
        qs<HTMLSelectElement>('[data-command-select]').value = '';
        qs<HTMLInputElement>('[data-command-label]').value = '';
        qs<HTMLInputElement>('[data-command-text]').value = '';
        qs<HTMLInputElement>('[data-command-newline]').checked = true;
        qs<HTMLInputElement>('[data-command-confirm]').checked = false;
        qs<HTMLInputElement>('[data-command-label]').focus();
        return true;
      case 'save-command': {
        const label = qs<HTMLInputElement>('[data-command-label]').value.trim();
        const text = qs<HTMLInputElement>('[data-command-text]').value;
        if (label && text) {
          const selected = qs<HTMLSelectElement>('[data-command-select]').value;
          const old = commands.find((item) => item.id === selected);
          const targetPane = deps
            .snapshot()
            .panes.find((item) => item.id === deps.capturedTarget());
          if (commandScope === 'workspace' && !targetPane) {
            detail('Select a pane before saving a workspace command.');
            return true;
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
        return true;
      }
      case 'move-up':
      case 'move-down': {
        const selected = qs<HTMLSelectElement>('[data-command-select]').value;
        const index = commands.findIndex((item) => item.id === selected);
        if (index >= 0) {
          commands = reorderCommands(commands, index, index + (action === 'move-up' ? -1 : 1));
          persistCommands();
        }
        return true;
      }
      case 'export-commands': {
        const exported = exportServerCommands(store.all(), deps.current().endpoint);
        const url = URL.createObjectURL(
          new Blob([serializeCommandFile(exported)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mux-xr-quick-commands.json';
        link.click();
        URL.revokeObjectURL(url);
        detail(`Exported ${exported.length} quick command${exported.length === 1 ? '' : 's'}.`);
        return true;
      }
      case 'import-commands':
        qs<HTMLInputElement>('[data-command-import]').click();
        return true;
      case 'pin-command': {
        const select = qs<HTMLSelectElement>('[data-command-select]');
        const selected = select.value;
        if (!commands.some((item) => item.id === selected)) return true;
        commands = commands.map((item) =>
          item.id === selected ? { ...copyCommand(item), pinned: !item.pinned } : item,
        );
        persistCommands();
        select.value = selected;
        return true;
      }
      case 'remove-command': {
        const selected = qs<HTMLSelectElement>('[data-command-select]').value;
        commands = commands.filter((command) => command.id !== selected);
        persistCommands();
        callbacks.onCommandsChange?.(commands, currentScope());
        return true;
      }
      case 'run-command': {
        const command = findDrawerCommand(qs<HTMLSelectElement>('[data-command-select]').value);
        const captured = deps.capturedTarget();
        if (!command || !captured) return true;
        if (command.confirm) {
          const pane = deps.snapshot().panes.find((item) => item.id === captured);
          if (
            !window.confirm(
              `Run "${command.label}" in ${pane?.title ?? captured}?\n\n${previewCommandText(command.text)}`,
            )
          )
            return true;
        }
        callbacks.onRunCommand?.(command, captured);
        return true;
      }
      default:
        return false;
    }
  };

  return {
    commands: () => commands,
    setSharedCommands(next) {
      sharedCommands = toSharedCommands(next.filter(isSharedCommand));
      renderCommands();
    },
    load,
    commandsForPane(paneId) {
      const pane = deps.snapshot().panes.find((item) => item.id === paneId);
      const workspace = pane?.workspaceId ?? 'default';
      const endpoint = deps.current().endpoint;
      const server = commandServerKey(endpoint);
      const shared = sharedCommands
        .filter((command) => command.workspaceId === undefined || command.workspaceId === workspace)
        .map((command): QuickCommandEntry => ({ ...command, shared: true }));
      return [
        ...shared,
        ...store.get(workspaceScope(endpoint, '*')),
        ...store.get(workspaceScope(endpoint, workspace)),
      ].map((command): QuickCommandEntry => ({ ...command, ...stats.get(server, command.id) }));
    },
    recordRun: (id, at) => {
      stats.record(commandServerKey(deps.current().endpoint), id, at);
    },
    writeCommand,
    deleteCommand,
    removeCommand(id) {
      commands = commands.filter((command) => command.id !== id);
      persistCommands();
    },
    reorder(from, to) {
      commands = reorderCommands(commands, from, to);
      persistCommands();
    },
    handleAction,
  };
}
