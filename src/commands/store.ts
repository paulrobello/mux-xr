import type { QuickCommand, QuickCommandStats } from '../contracts';
import { reportSwallowed } from '../diagnostics';
import { copyCommand, isCommand } from '../quick-commands';
import { normalizeScopeKey } from './transfer';

const COMMANDS_KEY = 'mux-xr:commands:v1';
const COMMAND_STATS_KEY = 'mux-xr:command-stats:v1';

export interface CommandStore {
  get(scopeKey: string): QuickCommand[];
  set(scopeKey: string, commands: QuickCommand[]): boolean;
  all(): Record<string, QuickCommand[]>;
  setAll(values: Record<string, QuickCommand[]>): boolean;
}

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
      } catch (error) {
        reportSwallowed('ui.command-stats-save', error);
        return false;
      }
    },
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
    } catch (error) {
      reportSwallowed('ui.commands-save', error);
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
