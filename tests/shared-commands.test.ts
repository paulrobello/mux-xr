import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  publishCommands,
  sharedCommandsPlugin,
  validateCommandFile,
} from '../scripts/publish-commands';
import { loadSharedCommands } from '../src/quick-commands';

const file = (commands: unknown[]) => ({ version: 1, commands });
const deploy = { id: 'deploy', label: 'Deploy', text: 'make deploy', sendNewline: true };
const response = (ok: boolean, json: () => Promise<unknown>) => async () => ({ ok, json });

describe('shared quick commands', () => {
  const roots: string[] = [];
  const tempRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'mux-xr-shared-'));
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('loads a valid file as namespaced read-only commands', async () => {
    const commands = await loadSharedCommands(
      'quick-commands.json',
      response(true, async () => file([deploy, { id: 'bad' }])),
    );
    expect(commands).toEqual([{ ...deploy, id: 'shared:deploy' }]);
  });

  it('treats a missing, invalid or unreachable file as no shared commands', async () => {
    expect(
      await loadSharedCommands(
        'x',
        response(false, async () => file([deploy])),
      ),
    ).toEqual([]);
    expect(
      await loadSharedCommands(
        'x',
        response(true, async () => ({ commands: [] })),
      ),
    ).toEqual([]);
    expect(
      await loadSharedCommands(
        'x',
        response(true, async () => {
          throw new SyntaxError('html fallback');
        }),
      ),
    ).toEqual([]);
    expect(
      await loadSharedCommands('x', async () => {
        throw new TypeError('offline');
      }),
    ).toEqual([]);
  });

  it('validates publish input strictly', () => {
    expect(validateCommandFile(JSON.stringify(file([deploy])))).toBe(1);
    expect(() => validateCommandFile('{')).toThrow('not valid JSON');
    expect(() => validateCommandFile('{"commands":[]}')).toThrow('version');
    expect(() => validateCommandFile(JSON.stringify(file([deploy, { id: 'x' }])))).toThrow(
      '1 command(s)',
    );
    expect(() => validateCommandFile(JSON.stringify(file([{ ...deploy, text: '' }])))).toThrow(
      'non-empty',
    );
  });

  it('rejects duplicate ids, including ones that collide after the shared: prefix', () => {
    expect(() => validateCommandFile(JSON.stringify(file([deploy, deploy])))).toThrow(
      'Duplicate command id(s) after the shared: prefix: shared:deploy.',
    );
    expect(() =>
      validateCommandFile(JSON.stringify(file([deploy, { ...deploy, id: 'shared:deploy' }]))),
    ).toThrow('shared:deploy');
  });

  it('drops duplicate ids and pins when loading the shared file', async () => {
    const commands = await loadSharedCommands(
      'x',
      response(true, async () =>
        file([
          { ...deploy, pinned: true },
          { ...deploy, id: 'shared:deploy', text: 'rm -rf build' },
        ]),
      ),
    );
    expect(commands).toEqual([{ ...deploy, id: 'shared:deploy' }]);
  });

  it('publishes to .local and dist, and the build plugin restores dist from .local', () => {
    const root = tempRoot();
    const source = join(root, 'commands.json');
    writeFileSync(source, JSON.stringify(file([deploy])));
    const { count, paths } = publishCommands(source, root);
    expect(count).toBe(1);
    expect(paths).toEqual([
      join(root, '.local', 'quick-commands.json'),
      join(root, 'dist', 'quick-commands.json'),
    ]);
    rmSync(join(root, 'dist'), { recursive: true });
    const plugin = sharedCommandsPlugin(root);
    (plugin.closeBundle as () => void)();
    expect(JSON.parse(readFileSync(join(root, 'dist', 'quick-commands.json'), 'utf8'))).toEqual(
      file([deploy]),
    );
  });

  it('skips the build copy when no shared file was published', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'dist'));
    (sharedCommandsPlugin(root).closeBundle as () => void)();
    expect(existsSync(join(root, 'dist', 'quick-commands.json'))).toBe(false);
  });
});
