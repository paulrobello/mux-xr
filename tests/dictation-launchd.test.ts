import { describe, expect, it } from 'vitest';
import {
  isSafeMigratableListener,
  parseInstallerArgs,
  parseListenerPid,
} from '../scripts/install-dictation-service';
import {
  buildLaunchDaemonPlist,
  DICTATION_LABEL,
  isOwnedPlist,
  validateRepository,
  validateUser,
} from '../src/server/dictation-launchd';

describe('Whisper LaunchDaemon definition', () => {
  it('parses PID-only listener output and deduplicates dual-stack rows', () => {
    expect(parseListenerPid('123\n123\n')).toBe(123);
    expect(parseListenerPid('')).toBeUndefined();
    expect(() => parseListenerPid('COMMAND PID USER')).toThrow(/Invalid PID/);
    expect(() => parseListenerPid('123\n456\n')).toThrow(/multiple/);
  });
  it('starts directly through Bun and never depends on par-mux', () => {
    const plist = buildLaunchDaemonPlist();
    expect(plist).toContain('<true/>');
    expect(plist).not.toContain('par-mux');
    expect(plist).toContain('/opt/homebrew/bin/bun');
    expect(plist).toContain('<key>KeepAlive</key>');
  });

  it('escapes XML values and rejects unstable paths and invalid users', () => {
    expect(buildLaunchDaemonPlist({ repository: '/Users/p/a&b<repo>', user: 'paul_1' })).toContain(
      'a&amp;b&lt;repo&gt;',
    );
    expect(() => validateRepository('/Users/p/.codex/worktrees/mux-xr')).toThrow(/stable checkout/);
    expect(() => validateUser('paul name')).toThrow(/Invalid macOS user/);
  });

  it('fails closed for a changed plist even when its label is ours', () => {
    const expected = buildLaunchDaemonPlist();
    expect(isOwnedPlist(expected, expected)).toBe(true);
    expect(isOwnedPlist(expected.replace('4242', '4243'), expected)).toBe(false);
    expect(expected).toContain(`<string>${DICTATION_LABEL}</string>`);
  });

  it('parses print mode without requiring root or par-mux', () => {
    const options = parseInstallerArgs([
      '--print',
      '--repo',
      '/Users/localuser/Repos/mux-xr',
      '--user',
      'localuser',
    ]);
    expect(options).toMatchObject({
      print: true,
      install: false,
      repository: '/Users/localuser/Repos/mux-xr',
    });
  });

  it('only permits migration of the selected Bun listener', () => {
    const metadata = {
      uid: 501,
      gid: 20,
      executable: '/opt/homebrew/bin/bun',
      cwd: '/Users/localuser/Repos/mux-xr',
      args: ['run', 'scripts/dictation-server.ts'],
    };
    expect(isSafeMigratableListener(metadata, '/Users/localuser/Repos/mux-xr', 501)).toBe(true);
    expect(
      isSafeMigratableListener({ ...metadata, uid: 0 }, '/Users/localuser/Repos/mux-xr', 501),
    ).toBe(false);
    expect(
      isSafeMigratableListener(
        { ...metadata, executable: '/usr/bin/python3' },
        '/Users/localuser/Repos/mux-xr',
        501,
      ),
    ).toBe(false);
  });
});
