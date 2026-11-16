import type { QuickCommand } from '../contracts';
import { commandServerKey, copyCommand, isCommand, isSharedCommand } from '../quick-commands';

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

export function normalizeScopeKey(scope: string): string {
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
