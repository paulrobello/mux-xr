import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFingerprint } from '../scripts/build-version';

describe('frontend build fingerprint', () => {
  it('is stable across ordering and changes with code, package version and public assets', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mux-xr-version-'));
    try {
      mkdirSync(join(directory, 'fonts'));
      writeFileSync(join(directory, 'fonts', 'local.ttf'), 'font-a');
      const entries: Array<[string, string]> = [
        ['app.js', 'one'],
        ['index.html', '<html>'],
      ];
      const first = buildFingerprint(entries, '1.0.0', directory);
      expect(first).toMatch(/^[a-f0-9]{64}$/);
      expect(buildFingerprint([...entries].reverse(), '1.0.0', directory)).toBe(first);
      expect(buildFingerprint([['app.js', 'two']], '1.0.0', directory)).not.toBe(first);
      expect(buildFingerprint(entries, '1.0.1', directory)).not.toBe(first);
      writeFileSync(join(directory, 'fonts', 'local.ttf'), 'font-b');
      expect(buildFingerprint(entries, '1.0.0', directory)).not.toBe(first);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
