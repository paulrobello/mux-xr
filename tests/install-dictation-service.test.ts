import {
  closeSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openRecoveryLog } from '../scripts/install-dictation-service';

const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;

describe('recovery log open (SEC-007)', () => {
  it('opens a fresh log, checks it, and chowns the descriptor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mux-xr-recovery-'));
    const path = join(dir, 'whisper-migration-recovery.log');
    try {
      const fchown = vi.fn();
      const fd = openRecoveryLog(path, uid, gid, { fchown });
      expect(typeof fd).toBe('number');
      expect(fchown).toHaveBeenCalledExactlyOnceWith(fd, uid, gid);
      closeSync(fd);
      expect(statSync(path).mode & 0o777 & ~0o022).toBe(0o600 & ~0o022);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked log path without following it and never chowns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mux-xr-recovery-'));
    const target = join(dir, 'root-owned-target');
    const link = join(dir, 'whisper-migration-recovery.log');
    try {
      writeFileSync(target, 'do not touch\n', { mode: 0o600 });
      symlinkSync(target, link);
      const fchown = vi.fn();
      expect(() => openRecoveryLog(link, uid, gid, { fchown })).toThrow();
      expect(fchown).not.toHaveBeenCalled();
      // The planted link's target keeps its original owner and contents.
      const info = statSync(target);
      expect(info.uid).toBe(uid);
      expect(readFileSync(target, 'utf8')).toBe('do not touch\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a hard-linked log because the file has more than one link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mux-xr-recovery-'));
    const target = join(dir, 'victim');
    const alias = join(dir, 'whisper-migration-recovery.log');
    try {
      writeFileSync(target, 'keep me\n', { mode: 0o600 });
      linkSync(target, alias);
      const fchown = vi.fn();
      expect(() => openRecoveryLog(alias, uid, gid, { fchown })).toThrow(
        'not a singly-linked regular file',
      );
      expect(fchown).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
