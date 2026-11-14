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

const TEST_REPO = '/Users/localuser/Repos/mux-xr';
const TEST_CONFIG = { repository: TEST_REPO, user: 'localuser' };
const buildAgent = (options: Parameters<typeof buildLaunchAgentPlist>[0] = {}) =>
  buildLaunchAgentPlist({ ...TEST_CONFIG, ...options });
const buildDaemon = (options: Parameters<typeof buildLaunchDaemonPlist>[0] = {}) =>
  buildLaunchDaemonPlist({ ...TEST_CONFIG, ...options });

describe('Whisper LaunchDaemon definition', () => {
  it('parses PID-only listener output and deduplicates dual-stack rows', () => {
    expect(parseListenerPid('123\n123\n')).toBe(123);
    expect(parseListenerPid('')).toBeUndefined();
    expect(() => parseListenerPid('COMMAND PID USER')).toThrow(/Invalid PID/);
    expect(() => parseListenerPid('123\n456\n')).toThrow(/multiple/);
  });
  it('starts directly through Bun and never depends on par-mux', () => {
    const plist = buildDaemon();
    expect(plist).toContain('<true/>');
    expect(plist).not.toContain('par-mux');
    expect(plist).toContain('/opt/homebrew/bin/bun');
    expect(plist).toContain('<key>KeepAlive</key>');
  });

  it('escapes XML values and rejects unstable paths and invalid users', () => {
    expect(buildDaemon({ repository: '/Users/p/a&b<repo>', user: 'paul_1' })).toContain(
      'a&amp;b&lt;repo&gt;',
    );
    expect(() => validateRepository('/Users/p/.codex/worktrees/mux-xr')).toThrow(/stable checkout/);
    expect(() => validateUser('paul name')).toThrow(/Invalid macOS user/);
  });

  it('fails closed for a changed plist even when its label is ours', () => {
    const expected = buildDaemon();
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

  it('renders local launchd settings and preserves explicit installer overrides', () => {
    const options = parseInstallerArgs(['--print', '--user', 'operator'], {
      repository: TEST_REPO,
      user: 'localuser',
      origins: ['https://mux-host.example.test:4240', 'https://localhost:4240'],
      launchdLabel: 'test.mux-xr.whisper',
    });
    const plist = buildLaunchDaemonPlist(options);
    expect(plist).toContain('<string>test.mux-xr.whisper</string>');
    expect(plist).toContain('<string>operator</string>');
    expect(plist).toContain('<string>https://mux-host.example.test:4240</string>');
    expect(isOwnedPlist(plist, plist, options.label)).toBe(true);
    expect(() => buildDaemon({ origins: ['https://mux-host.example.test/path'] })).toThrow(
      /HTTPS origins/,
    );
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
    expect(buildDaemon()).not.toContain('clipboard');
  });

  it('builds a gui-session LaunchAgent that points at the user-created clipboard secret', () => {
    const plist = buildAgent();
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
    expect(buildAgent()).not.toContain('--repo-status');
    expect(buildDaemon()).not.toContain('--repo-status');
    expect(buildAgent({ repoStatus: true })).toContain(
      '<string>--repo-status</string>\n    <string>on</string>',
    );
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent']).repoStatus).toBe(false);
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent', '--repo-status']).repoStatus).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--user', 'localuser', '--repo-status'])).toThrow(/only supported/);
  });

  it('leaves /picture-fetch off unless the agent install opts in', () => {
    expect(buildAgent()).not.toContain('--picture-proxy');
    expect(buildDaemon()).not.toContain('--picture-proxy');
    expect(buildAgent({ pictureProxy: true })).toContain(
      '<string>--picture-proxy</string>\n    <string>on</string>',
    );
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent']).pictureProxy).toBe(false);
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent', '--picture-proxy']).pictureProxy).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--user', 'localuser', '--picture-proxy'])).toThrow(/only supported/);
  });

  it('leaves /picture-depth off unless the agent install opts in, and passes the model path', () => {
    expect(buildAgent()).not.toContain('--picture-depth');
    expect(buildDaemon()).not.toContain('--picture-depth');
    expect(buildAgent({ pictureDepth: true })).toContain(
      '<string>--picture-depth</string>\n    <string>on</string>\n    <string>--depth-model</string>\n    <string>/Users/localuser/Repos/mux-xr/.local/models/depth-anything-v2-small.onnx</string>',
    );
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent']).pictureDepth).toBe(false);
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent', '--picture-depth']).pictureDepth).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--user', 'localuser', '--picture-depth'])).toThrow(/only supported/);
  });

  it('leaves the kanban board feeds off unless the agent install opts in', () => {
    expect(buildAgent()).not.toContain('--board-feeds');
    expect(buildDaemon()).not.toContain('--board-feeds');
    expect(buildAgent({ boardFeeds: true })).toContain(
      '<string>--board-feeds</string>\n    <string>on</string>',
    );
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent']).boardFeeds).toBe(false);
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent', '--board-feeds']).boardFeeds).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--user', 'localuser', '--board-feeds'])).toThrow(/only supported/);
  });

  it('leaves service health off unless the agent install opts in, with the owner token path', () => {
    expect(buildAgent()).not.toContain('--service-health');
    expect(buildDaemon()).not.toContain('--service-health');
    expect(buildAgent({ serviceHealth: true })).toContain(
      '<string>--service-health</string>\n    <string>on</string>\n    <string>--service-health-env-file</string>\n    <string>/Users/localuser/Repos/mux-xr/.local/par-obs-query.env</string>',
    );
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent']).serviceHealth).toBe(false);
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent', '--service-health']).serviceHealth).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--user', 'localuser', '--service-health'])).toThrow(/only supported/);
  });

  it('leaves the mesh inbox off unless the agent install opts in', () => {
    expect(buildAgent()).not.toContain('--mesh-inbox');
    expect(buildDaemon()).not.toContain('--mesh-inbox');
    expect(buildAgent({ meshInbox: true })).toContain(
      '<string>--mesh-inbox</string>\n    <string>on</string>',
    );
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent']).meshInbox).toBe(false);
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent', '--mesh-inbox']).meshInbox).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--user', 'localuser', '--mesh-inbox'])).toThrow(/only supported/);
  });

  it('accepts LAN toast senders only when the agent install opts in', () => {
    expect(buildAgent()).not.toContain('--toast-lan');
    expect(buildAgent({ toastLan: true })).toContain(
      '<string>--toast-lan</string>\n    <string>on</string>',
    );
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent']).toastLan).toBe(false);
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent', '--toast-lan']).toastLan).toBe(true);
    expect(() => parseInstallerArgs(['--print', '--user', 'localuser', '--toast-lan'])).toThrow(/only supported/);
  });

  it('parses agent print and install modes and never migrates listeners for agents', () => {
    expect(parseInstallerArgs(['--print', '--user', 'localuser', '--agent'])).toMatchObject({ print: true, agent: true });
    expect(parseInstallerArgs(['--install', '--user', 'localuser', '--agent'])).toMatchObject({
      install: true,
      agent: true,
    });
    expect(parseInstallerArgs(['--print', '--user', 'localuser']).agent).toBe(false);
    expect(() =>
      parseInstallerArgs(['--install', '--user', 'localuser', '--agent', '--migrate-running-listener']),
    ).toThrow(/never migrate/);
  });
});
