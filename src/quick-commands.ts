import type { QuickCommand, QuickCommandEntry, TerminalSurface } from './contracts';

// Plain `{}` stays literal for `find -exec … {} +`, `xargs -I{}` and awk programs.
export const TEMPLATE_PLACEHOLDER = '{{}}';
export const SHARED_COMMAND_PREFIX = 'shared:';

export function isSharedCommand(command: Pick<QuickCommand, 'id'>): boolean {
  return command.id.startsWith(SHARED_COMMAND_PREFIX);
}

export function isCommand(value: unknown): value is QuickCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<QuickCommand>;
  return (
    typeof command.id === 'string' &&
    command.id.trim() !== '' &&
    typeof command.label === 'string' &&
    typeof command.text === 'string' &&
    command.text !== '' &&
    typeof command.sendNewline === 'boolean' &&
    (command.workspaceId === undefined || typeof command.workspaceId === 'string') &&
    (command.confirm === undefined || typeof command.confirm === 'boolean') &&
    (command.pinned === undefined || typeof command.pinned === 'boolean')
  );
}

export function copyCommand(command: QuickCommand): QuickCommand {
  return {
    id: command.id,
    label: command.label,
    text: command.text,
    sendNewline: command.sendNewline,
    ...(command.workspaceId !== undefined ? { workspaceId: command.workspaceId } : {}),
    ...(command.confirm ? { confirm: true } : {}),
    ...(command.pinned ? { pinned: true } : {}),
  };
}

export interface QuickCommandFile {
  version: 1;
  commands: QuickCommand[];
}

export function sharedCommandId(id: string): string {
  return id.startsWith(SHARED_COMMAND_PREFIX) ? id : `${SHARED_COMMAND_PREFIX}${id}`;
}

/** Keeps the first command for each id; every lookup by id takes the first match. */
export function dedupeCommands<T extends QuickCommand>(commands: T[]): T[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}

export function duplicateCommandIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/** Reads a `{version:1, commands:[...]}` file, keeping valid, unique commands and counting the rest. */
export function parseCommandFile(
  value: unknown,
): { commands: QuickCommand[]; skipped: number } | null {
  if (!value || typeof value !== 'object') return null;
  const file = value as Partial<QuickCommandFile>;
  if (file.version !== 1 || !Array.isArray(file.commands)) return null;
  const commands = dedupeCommands(file.commands.filter(isCommand).map(copyCommand));
  return { commands, skipped: file.commands.length - commands.length };
}

export function serializeCommandFile(commands: QuickCommand[]): string {
  const file: QuickCommandFile = { version: 1, commands: commands.map(copyCommand) };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Shared commands cannot be unpinned, so a shared `pinned` flag is dropped. */
export function toSharedCommands(commands: QuickCommand[]): QuickCommand[] {
  return dedupeCommands(
    commands.map((command) => {
      const { pinned: _pinned, ...shared } = copyCommand(command);
      return { ...shared, id: sharedCommandId(command.id) };
    }),
  );
}

/** Loads the read-only shared command file; a missing or invalid file yields no commands. */
export async function loadSharedCommands(
  url: string,
  fetcher: (input: string) => Promise<Pick<Response, 'ok' | 'json'>> = (input) => fetch(input),
): Promise<QuickCommand[]> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return [];
    const parsed = parseCommandFile(await response.json());
    return parsed ? toSharedCommands(parsed.commands) : [];
  } catch {
    return [];
  }
}

/** Server identity for command scopes: lowercase host plus explicit or scheme-default port. */
export function commandServerKey(endpoint: string): string {
  const raw = endpoint.trim().toLowerCase();
  const defaults: Record<string, string> = {
    'http:': '80',
    'ws:': '80',
    'https:': '443',
    'wss:': '443',
  };
  try {
    const url = new URL(raw);
    if (!(url.protocol in defaults) || !url.hostname) return raw;
    return `${url.hostname}:${url.port || defaults[url.protocol]}`;
  } catch {
    return raw;
  }
}

export function splitTemplate(text: string): { prefix: string; suffix: string } | null {
  const index = text.indexOf(TEMPLATE_PLACEHOLDER);
  if (index < 0) return null;
  return { prefix: text.slice(0, index), suffix: text.slice(index + TEMPLATE_PLACEHOLDER.length) };
}

const CONTROL_SYMBOLS: Record<number, string> = { 9: '⇥', 10: '⏎', 13: '⏎', 27: '␛', 127: '␡' };

/** Command text for confirm prompts, with control characters shown as symbols. */
export function previewCommandText(text: string, max = 120): string {
  let visible = '';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13 && text.charCodeAt(index + 1) === 10) index++;
    visible +=
      CONTROL_SYMBOLS[code] ?? (code < 32 ? String.fromCharCode(0x2400 + code) : text[index]);
  }
  const characters = [...visible];
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : visible;
}

export type QuickCommandResult = 'sent' | 'template' | 'unavailable' | 'enter-failed';

type CommandSurface = Pick<TerminalSurface, 'sendText' | 'sendKey'> &
  Partial<Pick<TerminalSurface, 'paste'>>;

export function executeQuickCommand(
  surface: CommandSurface | undefined,
  command: QuickCommand,
): QuickCommandResult {
  if (!surface) return 'unavailable';
  const template = splitTemplate(command.text);
  const text = template ? template.prefix : command.text;
  if (text) {
    const multiline = /[\r\n]/.test(text);
    const sent = multiline && surface.paste ? surface.paste(text) : surface.sendText(text);
    if (!sent) return 'unavailable';
  }
  if (template) return 'template';
  if (command.sendNewline && !surface.sendKey('Enter')) return 'enter-failed';
  return 'sent';
}
/** XR order: pinned first, then most recently run, then saved order. */
export function orderQuickCommands(commands: QuickCommandEntry[]): QuickCommandEntry[] {
  return commands
    .map((command, index) => ({ command, index }))
    .sort(
      (a, b) =>
        Number(Boolean(b.command.pinned)) - Number(Boolean(a.command.pinned)) ||
        (b.command.lastRunAt ?? 0) - (a.command.lastRunAt ?? 0) ||
        a.index - b.index,
    )
    .map(({ command }) => command);
}

/** Up to four pinned commands, or the four most used when none are pinned. */
export function quickStripCommands(commands: QuickCommandEntry[], limit = 4): QuickCommandEntry[] {
  const ordered = orderQuickCommands(commands);
  const pinned = ordered.filter((command) => command.pinned);
  if (pinned.length) return pinned.slice(0, limit);
  return ordered
    .filter((command) => (command.runCount ?? 0) > 0)
    .map((command, index) => ({ command, index }))
    .sort((a, b) => (b.command.runCount ?? 0) - (a.command.runCount ?? 0) || a.index - b.index)
    .slice(0, limit)
    .map(({ command }) => command);
}
