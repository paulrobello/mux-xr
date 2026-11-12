import { describe, expect, it } from 'vitest';
import {
  type AgentInstallDeps,
  assertNoAgentLoaded,
  parseInstallerArgs,
  performAgentInstall,
  performAgentUninstall,
} from '../scripts/install-dictation-service';
import { DICTATION_LABEL } from '../src/server/dictation-launchd';

const PATH = '/Users/localuser/Library/LaunchAgents/org.mux-xr.whisper.plist';
const OLD = `<plist><string>${DICTATION_LABEL}</string><string>old</string></plist>`;
const NEW = `<plist><string>${DICTATION_LABEL}</string><string>new</string></plist>`;

type World = {
  files: Map<string, string>;
  log: string[];
  agentLoaded: boolean;
  /** The listener stays up for this many polls after a bootout. */
  drainPolls: number;
  listener: number | undefined;
  healthyAfterBootstrap: boolean;
};

const fakeDeps = (world: World): AgentInstallDeps => ({
  uid: 501,
  path: PATH,
  pid: 7,
  launchctl: (args) => {
    world.log.push(args.join(' '));
    if (args[0] === 'bootout') world.agentLoaded = false;
    if (args[0] === 'bootstrap') {
      world.agentLoaded = true;
      world.listener = 100 + world.log.length;
    }
    return '';
  },
  daemonLoaded: () => false,
  agentLoaded: () => world.agentLoaded,
  listenerPid: () => {
    if (!world.agentLoaded && world.listener !== undefined) {
      if (world.drainPolls > 0) world.drainPolls -= 1;
      else world.listener = undefined;
    }
    return world.listener;
  },
  listenerUid: () => 501,
  healthy: () => world.healthyAfterBootstrap,
  readFile: async (path) => world.files.get(path),
  writeFile: async (path, contents) => {
    world.log.push(`write ${path === PATH ? 'plist' : 'temp'}`);
    world.files.set(path, contents);
  },
  rename: async (from, to) => {
    world.files.set(to, world.files.get(from) ?? '');
    world.files.delete(from);
  },
  unlink: async (path) => {
    world.files.delete(path);
  },
  lint: () => undefined,
  waitFor: async (predicate, _timeout, message) => {
    for (let poll = 0; poll < 20; poll += 1) if (predicate()) return;
    throw new Error(message);
  },
});

const world = (overrides: Partial<World> = {}): World => ({
  files: new Map([[PATH, OLD]]),
  log: [],
  agentLoaded: true,
  drainPolls: 3,
  listener: 99,
  healthyAfterBootstrap: true,
  ...overrides,
});

describe('per-user LaunchAgent installer (F2)', () => {
  it('waits for port 4242 to free after booting out the previous agent', async () => {
    const state = world();
    await performAgentInstall(NEW, fakeDeps(state));
    expect(state.log[0]).toBe(`bootout gui/501/${DICTATION_LABEL}`);
    expect(state.log).toContain(`bootstrap gui/501 ${PATH}`);
    expect(state.files.get(PATH)).toBe(NEW);
  });

  it('fails, bounded, when the old listener never frees, and restarts the previous agent', async () => {
    const state = world({ drainPolls: 1_000 });
    await expect(performAgentInstall(NEW, fakeDeps(state))).rejects.toThrow(/did not free/);
    expect(state.files.get(PATH)).toBe(OLD);
    expect(state.log.at(-1)).toBe(`bootstrap gui/501 ${PATH}`);
  });

  it('restores and re-bootstraps the previous plist when the new agent fails health', async () => {
    const state = world({ healthyAfterBootstrap: false });
    await expect(performAgentInstall(NEW, fakeDeps(state))).rejects.toThrow(/health/);
    expect(state.files.get(PATH)).toBe(OLD);
    expect(state.log.filter((entry) => entry.startsWith('bootstrap'))).toHaveLength(2);
    expect(state.log.at(-1)).toBe(`bootstrap gui/501 ${PATH}`);
    expect(state.agentLoaded).toBe(true);
  });

  it('removes a fresh plist and leaves nothing loaded when a first install fails', async () => {
    const state = world({
      files: new Map(),
      agentLoaded: false,
      listener: undefined,
      healthyAfterBootstrap: false,
    });
    await expect(performAgentInstall(NEW, fakeDeps(state))).rejects.toThrow(/health/);
    expect(state.files.has(PATH)).toBe(false);
    expect(state.agentLoaded).toBe(false);
  });

  it('refuses while the LaunchDaemon is loaded, a foreign plist exists, or another listener runs', async () => {
    await expect(
      performAgentInstall(NEW, { ...fakeDeps(world()), daemonLoaded: () => true }),
    ).rejects.toThrow(/sudo launchctl bootout system/);
    await expect(
      performAgentInstall(NEW, fakeDeps(world({ files: new Map([[PATH, '<plist/>']]) }))),
    ).rejects.toThrow(/foreign/);
    const stray = world({ agentLoaded: false, drainPolls: 1_000 });
    await expect(performAgentInstall(NEW, fakeDeps(stray))).rejects.toThrow(/occupied/);
    expect(stray.files.get(PATH)).toBe(OLD);
    expect(stray.log).toEqual([]);
  });
});

describe('agent uninstall and the daemon conflict check (F3)', () => {
  it('boots out the agent, waits for the port, then removes its plist', async () => {
    const state = world();
    await performAgentUninstall(fakeDeps(state));
    expect(state.log).toEqual([`bootout gui/501/${DICTATION_LABEL}`]);
    expect(state.listener).toBeUndefined();
    expect(state.files.has(PATH)).toBe(false);
  });

  it('keeps the plist when the port never frees', async () => {
    const state = world({ drainPolls: 1_000 });
    await expect(performAgentUninstall(fakeDeps(state))).rejects.toThrow(/did not free/);
    expect(state.files.get(PATH)).toBe(OLD);
  });

  it('makes the LaunchDaemon installer refuse while the agent is loaded', () => {
    expect(() =>
      assertNoAgentLoaded('localuser', 501, (target) => target === `gui/501/${DICTATION_LABEL}`),
    ).toThrow(/make uninstall-whisper-agent as localuser/);
    expect(() => assertNoAgentLoaded('localuser', 501, () => false)).not.toThrow();
  });

  it('parses --uninstall only together with --agent', () => {
    expect(parseInstallerArgs(['--uninstall', '--agent'])).toMatchObject({
      uninstall: true,
      agent: true,
      print: false,
    });
    expect(() => parseInstallerArgs(['--uninstall'])).toThrow(/only supported with --agent/);
    expect(() => parseInstallerArgs(['--uninstall', '--install', '--agent'])).toThrow(
      /Choose only one/,
    );
  });
});
