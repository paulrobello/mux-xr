import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const runScript = (args: string[]) =>
  spawnSync('bun', ['run', 'scripts/send-toast.ts', ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });

describe('send-toast script', () => {
  let directory = '';
  let secretPath = '';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mux-xr-send-toast-'));
    secretPath = join(directory, 'secret');
    await writeFile(secretPath, 'not-a-real-pairing-value-for-tests-only\n');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('refuses --insecure to a non-loopback URL without opening a connection', () => {
    const result = runScript([
      'hello',
      '--insecure',
      '--url',
      'https://attacker.example.test:4242',
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--insecure');
  });

  it('reads the dedicated toast token from --token-file', () => {
    const result = runScript([
      'hello',
      '--token-file',
      join(directory, 'missing-token'),
      '--secret-file',
      secretPath,
    ]);
    // The token read happens before any network activity, so this fails on arguments only.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('toast token');
  });
});
