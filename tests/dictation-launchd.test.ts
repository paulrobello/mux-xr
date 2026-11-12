import { describe, expect, it } from 'vitest';
import {
  isSafeMigratableListener,
  parseInstallerArgs,
  parseListenerPid,
} from '../scripts/install-dictation-service';
import {
  agentPlistPath,
  buildLaunchAgentPlist,
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

  it('keeps the LaunchDaemon free of clipboard access so its installed plist still matches', () => {
    expect(buildLaunchDaemonPlist()).not.toContain('clipboard');
  });

  it('builds a gui-session LaunchAgent that points at the user-created clipboard secret', () => {
    const plist = buildLaunchAgentPlist();
    expect(plist).toContain(`<string>${DICTATION_LABEL}</string>`);
    expect(plist).not.toContain('<key>UserName</key>');
    expect(plist).toContain('<key>LimitLoadToSessionType</key>\n  <string>Aqua</string>');
    expect(plist).toContain(
      '<string>--clipboard-secret-file</string>\n    <string>/Users/localuser/Repos/mux-xr/.local/clipboard-secret</string>',
    );
    expect(plist).toContain('<string>4242</string>');
    expect(agentPlistPath('localuser')).toBe(
      `/Users/localuser/Library/LaunchAgents/${DICTATION_LABEL}.plist`,
    );
    expect(() => agentPlistPath('../root')).toThrow(/Invalid macOS user/);
  });

  it('leaves /repo-status off unless the agent install opts in', () => {
    expect(buildLaunchAgentPlist()).not.toContain('--repo-status');
    expect(buildLaunchDaemonPlist()).not.toContain('--repo-status');
    expect(buildLaunchAgentPlist({ repoStatus: true })).toContain(
      '<string>--repo-status</string>\n    <string>on</string>',
    );
    expect(parseInstallerArgs(['--print', '--agent']).repoStatus).toBe(false);
    expect(parseInstallerArgs(['--print', '--agent', '--repo-status']).repoStatus).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--repo-status'])).toThrow(/only supported/);
  });

  it('leaves /picture-fetch off unless the agent install opts in', () => {
    expect(buildLaunchAgentPlist()).not.toContain('--picture-proxy');
    expect(buildLaunchDaemonPlist()).not.toContain('--picture-proxy');
    expect(buildLaunchAgentPlist({ pictureProxy: true })).toContain(
      '<string>--picture-proxy</string>\n    <string>on</string>',
    );
    expect(parseInstallerArgs(['--print', '--agent']).pictureProxy).toBe(false);
    expect(parseInstallerArgs(['--print', '--agent', '--picture-proxy']).pictureProxy).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--picture-proxy'])).toThrow(/only supported/);
  });

  it('leaves /picture-depth off unless the agent install opts in, and passes the model path', () => {
    expect(buildLaunchAgentPlist()).not.toContain('--picture-depth');
    expect(buildLaunchDaemonPlist()).not.toContain('--picture-depth');
    expect(buildLaunchAgentPlist({ pictureDepth: true })).toContain(
      '<string>--picture-depth</string>\n    <string>on</string>\n    <string>--depth-model</string>\n    <string>/Users/localuser/Repos/mux-xr/.local/models/depth-anything-v2-small.onnx</string>',
    );
    expect(parseInstallerArgs(['--print', '--agent']).pictureDepth).toBe(false);
    expect(parseInstallerArgs(['--print', '--agent', '--picture-depth']).pictureDepth).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--picture-depth'])).toThrow(/only supported/);
  });

  it('parses agent print and install modes and never migrates listeners for agents', () => {
    expect(parseInstallerArgs(['--print', '--agent'])).toMatchObject({ print: true, agent: true });
    expect(parseInstallerArgs(['--install', '--agent'])).toMatchObject({
      install: true,
      agent: true,
    });
    expect(parseInstallerArgs(['--print']).agent).toBe(false);
    expect(() =>
      parseInstallerArgs(['--install', '--agent', '--migrate-running-listener']),
    ).toThrow(/never migrate/);
  });
});
