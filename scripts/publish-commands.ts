import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import {
  duplicateCommandIds,
  isCommand,
  parseCommandFile,
  type QuickCommandFile,
  sharedCommandId,
} from '../src/quick-commands.ts';

export const SHARED_COMMANDS_FILE = 'quick-commands.json';

export function validateCommandFile(text: string): number {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const parsed = parseCommandFile(value);
  if (!parsed) throw new Error('Expected {"version": 1, "commands": [...]}.');
  const commands = (value as QuickCommandFile).commands;
  const valid = commands.filter(isCommand);
  if (valid.length !== commands.length)
    throw new Error(
      `${commands.length - valid.length} command(s) are missing a non-empty id or text, a label or sendNewline.`,
    );
  const duplicates = duplicateCommandIds(valid.map((command) => sharedCommandId(command.id)));
  if (duplicates.length)
    throw new Error(`Duplicate command id(s) after the shared: prefix: ${duplicates.join(', ')}.`);
  return parsed.commands.length;
}

export function publishCommands(file: string, root: string): { count: number; paths: string[] } {
  const count = validateCommandFile(readFileSync(file, 'utf8'));
  const paths = ['.local', 'dist'].map((directory) => join(root, directory, SHARED_COMMANDS_FILE));
  for (const path of paths) {
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(file, path);
  }
  return { count, paths };
}

/** Copies `.local/quick-commands.json` into the build output so rebuilds keep the shared file. */
export function sharedCommandsPlugin(root: string): Plugin {
  let outDir = join(root, 'dist');
  return {
    name: 'mux-xr-shared-commands',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const source = join(root, '.local', SHARED_COMMANDS_FILE);
      if (!existsSync(source)) return;
      mkdirSync(outDir, { recursive: true });
      copyFileSync(source, join(outDir, SHARED_COMMANDS_FILE));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: make publish-commands FILE=<path to quick-commands JSON>');
    process.exit(2);
  }
  try {
    const { count, paths } = publishCommands(
      resolve(file),
      resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    );
    console.log(`Published ${count} shared quick command(s) to ${paths.join(' and ')}`);
  } catch (error) {
    console.error(`publish-commands: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
