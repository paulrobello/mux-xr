/**
 * Manifest-vs-reality sync test for ENH-004: fails when a check script, its Makefile target, its
 * environment declaration, or its docs/TESTING.md row is missing or diverges from the manifest in
 * `scripts/checks/manifest.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECKS } from '../scripts/checks/manifest';
import { buildTestingTable } from '../scripts/gen-testing-table';

// Vitest runs from the repository root, the same assumption tests/heif-pictures.test.ts makes.
const ROOT = process.cwd();

const scriptFiles = readdirSync(join(ROOT, 'scripts'))
  .filter((file) => file.endsWith('-check.ts'))
  // The protobuf gate is a checkall leg, not a browser/live check, so it has no manifest entry.
  // run-check.ts is the runner this manifest drives, not a check itself.
  .filter((file) => file !== 'protocol-check.ts' && file !== 'run-check.ts')
  .sort();

describe('check manifest', () => {
  it('covers every check script on disk, and only existing scripts', () => {
    const declared = CHECKS.map((check) => basename(check.script)).sort();
    expect(declared).toEqual(scriptFiles);
    for (const check of CHECKS) {
      expect(existsSync(join(ROOT, check.script)), check.script).toBe(true);
    }
  });

  it('declares unique names and non-empty purpose/doesNotProve', () => {
    const names = CHECKS.map((check) => check.name);
    expect(new Set(names).size).toBe(names.length);
    for (const check of CHECKS) {
      expect(check.purpose.trim(), check.name).not.toBe('');
      expect(check.doesNotProve.trim(), check.name).not.toBe('');
      expect(check.name.endsWith('-check') || check.name === 'live-check', check.name).toBe(true);
      expect(
        check.requires.filter((env) => env === 'MUX_XR_PRIVATE_TEST'),
        check.name,
      ).toEqual([]);
      expect(
        check.optional.filter((env) => env === 'MUX_XR_PRIVATE_TEST'),
        check.name,
      ).toEqual([]);
    }
  });

  it('gives every check a thin Makefile rule through the runner, and no direct script rule remains', () => {
    const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8');
    const lines = makefile.split('\n');
    for (const check of CHECKS) {
      const i = lines.findIndex((line) => line.startsWith(`${check.name}:`));
      expect(i, `${check.name}: missing Makefile rule`).toBeGreaterThanOrEqual(0);
      expect(lines[i + 1], `${check.name}: recipe`).toBe(
        `\tbun run scripts/run-check.ts ${check.name}`,
      );
    }
    // protocol-check is the checkall gate leg and legitimately runs its script directly.
    const direct = lines
      .filter((line) => /^\tbun run scripts\/[\w-]+-check\.ts$/.test(line))
      .filter((line) => !line.includes('protocol-check'));
    expect(direct).toEqual([]);
  });

  it('renders the docs/TESTING.md check table from the manifest', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'TESTING.md'), 'utf8');
    const start = doc.indexOf('<!-- checks:start -->');
    const end = doc.indexOf('<!-- checks:end -->');
    expect(start, 'start marker').toBeGreaterThanOrEqual(0);
    expect(end, 'end marker').toBeGreaterThan(start);
    const block = doc.slice(start + '<!-- checks:start -->'.length, end);
    expect(block.trim()).toBe(buildTestingTable().trimEnd());
  });

  it('matches each script environment declaration to its source', () => {
    for (const check of CHECKS) {
      const source = readFileSync(join(ROOT, check.script), 'utf8');
      const callMatch = source.match(/requirePrivateTest\(\[([\s\S]*?)\]\)/);
      if (callMatch) {
        const declaredArgs = [...callMatch[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
        expect(
          declaredArgs.filter((env) => env !== 'MUX_XR_PRIVATE_TEST').sort(),
          `${check.name}: requirePrivateTest arguments`,
        ).toEqual([...check.requires].sort());
      }
      for (const env of check.requires) {
        expect(source.includes(env), `${check.name}: ${env} must appear in the script`).toBe(true);
      }
      if (source.includes('process.env[')) continue; // dynamic reads: skip the literal census
      const literals = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
      const declared = new Set([...check.requires, ...check.optional, 'MUX_XR_PRIVATE_TEST']);
      const undeclared = [...new Set(literals)].filter((env) => !declared.has(env));
      expect(undeclared, `${check.name}: reads env vars the manifest does not declare`).toEqual([]);
    }
  });

  it('keeps the private-test guard on every input-sending script', () => {
    for (const check of CHECKS.filter((check) => check.sendsInput)) {
      const source = readFileSync(join(ROOT, check.script), 'utf8');
      const guarded =
        source.includes('requirePrivateTest(') ||
        /MUX_XR_PRIVATE_TEST\s*(?:!==?\s*'1'|===\s*'1')/.test(source);
      expect(guarded, `${check.name}: no direct-invocation guard`).toBe(true);
    }
  });

  it('fails the runner naming every missing variable, and direct invocation still refuses', () => {
    const bareEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
    const runner = spawnSync('bun', ['scripts/run-check.ts', 'focus-mode-check'], {
      cwd: ROOT,
      env: bareEnv,
      encoding: 'utf8',
    });
    expect(runner.status, runner.stderr).not.toBe(0);
    for (const env of ['MUX_XR_PRIVATE_TEST', 'MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT']) {
      expect(runner.stderr, `runner output names ${env}`).toContain(env);
    }
    const direct = spawnSync('bun', ['scripts/focus-mode-check.ts'], {
      cwd: ROOT,
      env: bareEnv,
      encoding: 'utf8',
    });
    expect(direct.status, direct.stderr).not.toBe(0);
    expect(direct.stderr, 'direct refusal names the opt-in').toContain('MUX_XR_PRIVATE_TEST');
  });
});

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}
