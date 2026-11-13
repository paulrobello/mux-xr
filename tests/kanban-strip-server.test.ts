import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  createKanbanCli,
  createKanbanStripFeed,
  createProjectResolver,
  isKanbanReadCommand,
  KANBAN_STRIP_PROTOCOL,
  parseStripItems,
} from '../src/server/board-feeds';
import { createRequestLimiter } from '../src/server/host-stats-server';
import type { RepoCommandRunner } from '../src/server/repo-status-server';
import { parseKanbanStrip } from '../src/xr/kanban-strip';
import {
  clientRequest,
  ORIGIN,
  requestFeed,
  startFeedServer,
  stopFeedServers,
  upgradeStatus,
  WRONG_PAIRING,
} from './helpers/feed-socket';

const NOW = 1_794_550_000_000;
const home = realpathSync(mkdtempSync(join(tmpdir(), 'mux-xr-board-home-')));
const repos = join(home, 'Repos');
mkdirSync(join(repos, 'alpha', 'src', 'deep'), { recursive: true });
mkdirSync(join(repos, 'alpha', '.claude', 'worktrees', 'side'), { recursive: true });
mkdirSync(join(repos, 'ghost'), { recursive: true });
mkdirSync(join(repos, '-flag'), { recursive: true });
mkdirSync(join(home, 'outside'), { recursive: true });
symlinkSync(join(home, 'outside'), join(repos, 'escape'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
afterEach(stopFeedServers);

const LISTING = {
  in_progress: [
    {
      title: 'Integrate pane creation',
      status: 'in_progress',
      priority: 'medium',
      claimedBy: 'mux-xr-core-081',
      claimExpiresAt: NOW + 60_000,
      description: 'never forwarded',
      blockReason: 'never forwarded',
    },
    {
      title: 'Old claim\u0007 with a bell',
      status: 'in_progress',
      priority: 'urgent',
      claimedBy: 'gone-agent',
      claimExpiresAt: NOW - 1,
    },
  ],
  blocked: [
    {
      title: 'Owner-check the Quest build',
      status: 'blocked',
      priority: 'high',
      claimedBy: '',
      tags: ['webxr', 'approval'],
    },
    { title: 'Approval: push the release', status: 'blocked', priority: 'critical', claimedBy: '' },
  ],
};

type Call = { file: string; args: readonly string[]; env: Record<string, string>; cwd?: string };

/** A kanban CLI double: `item list` answers per project, `project list` names the board's projects. */
const fakeRunner = (
  options: { projects?: string[] | null; listings?: Record<string, unknown> } = {},
) => {
  const calls: Call[] = [];
  const run: RepoCommandRunner = async (file, args, runOptions) => {
    calls.push({ file, args, env: runOptions.env, cwd: runOptions.cwd });
    const [, noun, verb, , project] = args;
    if (noun === 'item' && verb === 'list') {
      const listing = options.listings?.[String(project)];
      return listing === undefined
        ? { code: 1, stdout: '', truncated: false }
        : { code: 0, stdout: JSON.stringify(listing), truncated: false };
    }
    if (noun === 'project' && verb === 'list')
      return options.projects === null
        ? { code: 1, stdout: '', truncated: false }
        : {
            code: 0,
            stdout: JSON.stringify((options.projects ?? []).map((name) => ({ name }))),
            truncated: false,
          };
    return { code: 1, stdout: '', truncated: false };
  };
  return { run, calls };
};

const cliFor = (runner: ReturnType<typeof fakeRunner>, now = () => NOW) =>
  createKanbanCli({
    run: runner.run,
    homeDir: () => home,
    findExecutable: async (candidates) => candidates[0] ?? null,
    now,
  });

const stripRequest = (cwd: string, host: string | null = null) => JSON.stringify({ cwd, host });

const feedFor = (runner: ReturnType<typeof fakeRunner>) =>
  createKanbanStripFeed({
    cli: cliFor(runner),
    homeDir: () => home,
    localHostname: () => 'dev-workstation.local',
    now: () => NOW,
  });

describe('kanban CLI runner', () => {
  it('runs only read commands, through bun with a fixed argv, no shell input and a bare env', async () => {
    const runner = fakeRunner({ listings: { alpha: LISTING } });
    const cli = cliFor(runner);
    await cli.read(['item', 'list', '--project', 'alpha', '--status', 'in_progress,blocked']);
    await cli.read(['project', 'list']);
    await expect(cli.read(['item', 'move', '--id', 'x', '--status', 'done'])).rejects.toThrow(
      /Not a kanban read command/,
    );
    await expect(cli.read(['schedule', 'book', '--resource', 'test-mac'])).rejects.toThrow();
    expect(runner.calls.map((call) => call.args)).toEqual([
      [
        join(home, 'Repos', 'kanban', 'cli', 'kanban.ts'),
        'item',
        'list',
        '--project',
        'alpha',
        '--status',
        'in_progress,blocked',
        '--format',
        'json',
      ],
      [join(home, 'Repos', 'kanban', 'cli', 'kanban.ts'), 'project', 'list', '--format', 'json'],
    ]);
    for (const call of runner.calls) {
      expect(call.file).toBe('/opt/homebrew/bin/bun');
      expect(call.cwd).toBe('/');
      expect(Object.keys(call.env).sort()).toEqual(['HOME', 'NO_COLOR', 'PATH']);
      expect(isKanbanReadCommand(call.args.slice(1))).toBe(true);
    }
  });

  it('refuses control characters in any argument', () => {
    expect(isKanbanReadCommand(['item', 'list', '--project', 'a\nb'])).toBe(false);
    expect(isKanbanReadCommand(['item', 'list'])).toBe(true);
    expect(isKanbanReadCommand(['item', 'add'])).toBe(false);
  });

  it('shares one run per argv for 30 seconds, and a failure for 10 seconds', async () => {
    let now = NOW;
    const runner = fakeRunner({ listings: { alpha: LISTING } });
    const cli = cliFor(runner, () => now);
    const args = ['item', 'list', '--project', 'alpha', '--status', 'in_progress,blocked'];
    await Promise.all([cli.read(args), cli.read(args)]);
    now += 29_000;
    await cli.read(args);
    expect(runner.calls).toHaveLength(1);
    now += 2_000;
    await cli.read(args);
    expect(runner.calls).toHaveLength(2);
    const missing = ['item', 'list', '--project', 'ghost', '--status', 'in_progress,blocked'];
    expect(await cli.read(missing)).toBeNull();
    now += 9_000;
    expect(await cli.read(missing)).toBeNull();
    expect(runner.calls).toHaveLength(3);
    now += 2_000;
    expect(await cli.read(missing)).toBeNull();
    expect(runner.calls).toHaveLength(4);
  });

  it('refuses reads beyond four waiting on a stuck CLI, without spawning them', async () => {
    const releases: Array<() => void> = [];
    let spawned = 0;
    const cli = createKanbanCli({
      run: () =>
        new Promise((done) => {
          spawned += 1;
          releases.push(() => done({ code: 0, stdout: '[]', truncated: false }));
        }),
      homeDir: () => home,
      findExecutable: async (candidates) => candidates[0] ?? null,
      now: () => NOW,
    });
    const reads = [1, 2, 3, 4].map((index) => cli.read(['item', 'list', '--project', `p${index}`]));
    expect(await cli.read(['item', 'list', '--project', 'p5'])).toBeNull();
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      releases.shift()?.();
    }
    expect(await Promise.all(reads)).toEqual([[], [], [], []]);
    expect(spawned).toBe(4);
    void cli.read(['item', 'list', '--project', 'p6']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spawned).toBe(5);
  });
});

describe('kanban strip parsing', () => {
  it('keeps title, status, priority, holder and approval, approval cards first', () => {
    const parsed = parseStripItems(LISTING, NOW);
    expect(parsed?.total).toBe(4);
    expect(parsed?.cards).toEqual([
      {
        title: 'Owner-check the Quest build',
        status: 'blocked',
        priority: 'high',
        holder: '',
        claimStale: false,
        approval: true,
      },
      {
        title: 'Approval: push the release',
        status: 'blocked',
        priority: 'critical',
        holder: '',
        claimStale: false,
        approval: true,
      },
      {
        title: 'Integrate pane creation',
        status: 'in_progress',
        priority: 'medium',
        holder: 'mux-xr-core-081',
        claimStale: false,
        approval: false,
      },
      {
        title: 'Old claim with a bell',
        status: 'in_progress',
        priority: null,
        holder: 'gone-agent',
        claimStale: true,
        approval: false,
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain('never forwarded');
  });

  it('treats a claim without a lease as stale and rejects malformed listings', () => {
    const legacy = { in_progress: [{ title: 'Legacy', claimedBy: 'old' }] };
    expect(parseStripItems(legacy, NOW)?.cards[0]?.claimStale).toBe(true);
    expect(parseStripItems([], NOW)).toBeNull();
    expect(parseStripItems({ blocked: 'nope' }, NOW)).toBeNull();
    expect(parseStripItems({}, NOW)).toEqual({ cards: [], total: 0 });
  });
});

describe('focused pane project', () => {
  const resolve = createProjectResolver({ homeDir: () => home });

  it('maps a cwd anywhere under ~/Repos/<project>, worktrees included, to that project', async () => {
    expect(await resolve(join(repos, 'alpha'))).toBe('alpha');
    expect(await resolve(join(repos, 'alpha', 'src', 'deep'))).toBe('alpha');
    expect(await resolve(join(repos, 'alpha', '.claude', 'worktrees', 'side'))).toBe('alpha');
  });

  it('refuses ~/Repos itself, paths outside it, symlink escapes, flag-like names and bad input', async () => {
    expect(await resolve(repos)).toBeNull();
    expect(await resolve(join(home, 'outside'))).toBeNull();
    expect(await resolve(join(repos, 'escape'))).toBeNull();
    expect(await resolve(join(repos, '-flag'))).toBeNull();
    expect(await resolve(join(repos, 'missing'))).toBeNull();
    expect(await resolve(`${join(repos, 'alpha')}/../../outside`)).toBeNull();
    expect(await resolve('Repos/alpha')).toBeNull();
    expect(await resolve('')).toBeNull();
  });

  it('never resolves a path that does not read as inside ~/Repos, so no automount is touched', async () => {
    const resolved: string[] = [];
    const guarded = createProjectResolver({
      homeDir: () => home,
      realpath: async (path) => {
        resolved.push(path);
        return realpathSync(path);
      },
    });
    for (const cwd of ['/net/fileserver/share', `${repos}-other/alpha`, join(repos, '..', 'x')])
      expect(await guarded(cwd), cwd).toBeNull();
    expect(resolved).toEqual([repos, repos, repos]);
    expect(await guarded(join(repos, 'alpha'))).toBe('alpha');
  });
});

describe('kanban strip feed', () => {
  it('answers the focused project, unregistered projects, outside paths and remote shells', async () => {
    const runner = fakeRunner({ projects: ['alpha'], listings: { alpha: LISTING } });
    const feed = feedFor(runner);
    const ok = await feed(stripRequest(join(repos, 'alpha', 'src')));
    expect(ok).toMatchObject({ state: 'ok', project: 'alpha', total: 4 });
    expect(await feed(stripRequest(join(repos, 'ghost')))).toEqual({
      state: 'unregistered',
      project: 'ghost',
    });
    expect(await feed(stripRequest(join(home, 'outside')))).toEqual({ state: 'outside' });
    expect(await feed(stripRequest(join(repos, 'alpha'), 'other-mac'))).toEqual({
      state: 'remote',
    });
    expect(await feed(stripRequest(join(repos, 'alpha'), 'dev-workstation'))).toMatchObject({
      state: 'ok',
    });
    expect(await feed('not json')).toEqual({ state: 'outside' });
    // Outside, remote and malformed requests never reach the CLI.
    expect(runner.calls.map((call) => call.args.slice(1, 5))).toEqual([
      ['item', 'list', '--project', 'alpha'],
      ['item', 'list', '--project', 'ghost'],
      ['project', 'list', '--format', 'json'],
    ]);
  });

  it('reports an outage, not an unregistered project, when the board cannot be read', async () => {
    const feed = feedFor(fakeRunner({ projects: null }));
    await expect(feed(stripRequest(join(repos, 'alpha')))).rejects.toMatchObject({
      code: 'upstream',
    });
  });
});

describe('kanban strip route', () => {
  const start = (
    enabled = true,
    runner = fakeRunner({ projects: ['alpha'], listings: { alpha: LISTING } }),
  ) =>
    startFeedServer({
      boardFeeds: {
        enabled,
        cli: cliFor(runner),
        strip: { homeDir: () => home, localHostname: () => 'dev-workstation', now: () => NOW },
      },
    }).then((server) => ({ ...server, url: `${server.base}/kanban-strip`, runner }));

  it('answers the cards after the secret proof, and the browser client parses them', async () => {
    const { url } = await start();
    const request = stripRequest(join(repos, 'alpha'));
    const { reply, code } = await requestFeed(url, KANBAN_STRIP_PROTOCOL, request);
    expect(reply).toMatchObject({ type: 'feed', data: { state: 'ok', project: 'alpha' } });
    expect(code).toBe(1000);
    const result = await clientRequest(url, KANBAN_STRIP_PROTOCOL, parseKanbanStrip, request);
    expect(result.ok && result.value.state === 'ok' && result.value.cards[0]?.approval).toBe(true);
  });

  it('binds the proof to the request, refuses a wrong secret, and runs nothing for either', async () => {
    const { url, runner } = await start();
    const signed = stripRequest(join(repos, 'alpha'));
    const sent = stripRequest(join(repos, 'ghost'));
    expect((await requestFeed(url, KANBAN_STRIP_PROTOCOL, sent, undefined, signed)).reply).toEqual({
      type: 'error',
      code: 'auth',
    });
    expect((await requestFeed(url, KANBAN_STRIP_PROTOCOL, signed, WRONG_PAIRING)).reply).toEqual({
      type: 'error',
      code: 'auth',
    });
    expect(
      await clientRequest(url, KANBAN_STRIP_PROTOCOL, parseKanbanStrip, signed, WRONG_PAIRING),
    ).toEqual({ ok: false, code: 'auth' });
    expect(runner.calls).toHaveLength(0);
  });

  it('answers disabled unless --board-feeds is on, and without clipboard pairing', async () => {
    const off = await start(false);
    expect(await clientRequest(off.url, KANBAN_STRIP_PROTOCOL, parseKanbanStrip, '{}')).toEqual({
      ok: false,
      code: 'disabled',
    });
    const unpaired = await startFeedServer({ paired: false, boardFeeds: { enabled: true } });
    expect(
      await clientRequest(
        `${unpaired.base}/kanban-strip`,
        KANBAN_STRIP_PROTOCOL,
        parseKanbanStrip,
        '{}',
      ),
    ).toEqual({ ok: false, code: 'disabled' });
    expect(off.runner.calls).toHaveLength(0);
  });

  it('answers upstream when the board is unreachable', async () => {
    const { url } = await start(true, fakeRunner({ projects: null }));
    expect(
      await clientRequest(
        url,
        KANBAN_STRIP_PROTOCOL,
        parseKanbanStrip,
        stripRequest(join(repos, 'alpha')),
      ),
    ).toEqual({ ok: false, code: 'upstream' });
  });

  it('refuses bad origins and query strings, and limits requests per client', async () => {
    const runner = fakeRunner({ projects: ['alpha'], listings: { alpha: LISTING } });
    const server = await startFeedServer({
      boardFeeds: {
        enabled: true,
        cli: cliFor(runner),
        strip: { homeDir: () => home },
        requestLimiter: createRequestLimiter(Date.now, 2),
      },
    });
    const url = `${server.base}/kanban-strip`;
    expect(await upgradeStatus(url, 'https://evil.test')).toBe(403);
    expect(await upgradeStatus(url)).toBe(403);
    expect(await upgradeStatus(`${url}?x=1`, ORIGIN)).toBe(403);
    const request = stripRequest(join(repos, 'alpha'));
    await requestFeed(url, KANBAN_STRIP_PROTOCOL, request);
    await requestFeed(url, KANBAN_STRIP_PROTOCOL, request);
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
  });
});
