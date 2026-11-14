import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { HostClipboardSocket } from '../src/host-clipboard';
import { createRepoStatusClient } from '../src/host-repo-status';
import { type ClipboardSecret, createFailureLimiter } from '../src/server/clipboard-server';
import { attachDictationServer } from '../src/server/dictation-server';
import {
  ciState,
  composeRepoStatus,
  createRepoStatusProbe,
  createSpawnRunner,
  type GitProbeResult,
  githubSlug,
  hardenedGitArgs,
  isLocalHost,
  parseGhRuns,
  parseTrack,
  type RepoCommandRunner,
  type RepoStatus,
  type RepoStatusProbe,
  type RepoStatusRouteOptions,
  repoStatusMac,
} from '../src/server/repo-status-server';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';
const LOCAL_HOST = 'test-mac.local';
const GH_RUN = JSON.stringify([
  {
    conclusion: 'success',
    status: 'completed',
    headBranch: 'main',
    workflowName: 'CI',
    createdAt: '2026-11-11T10:00:00Z',
  },
]);
const HARDENED_PREFIX = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'safe.bareRepository=explicit',
  '-c',
  'protocol.allow=never',
  '--no-optional-locks',
  '-C',
];

let scratch: string;
let home: string;
let outside: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'mux-xr-repo-status-')));
  home = join(scratch, 'home');
  outside = join(scratch, 'outside');
  mkdirSync(join(home, 'repo', 'src'), { recursive: true });
  mkdirSync(join(home, 'repo', '.git'));
  mkdirSync(join(outside, 'repo'), { recursive: true });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

type Call = {
  file: string;
  args: readonly string[];
  cwd?: string;
  maxBytes: number;
  env: Record<string, string>;
};
type Reply = { code: number | null; stdout?: string; truncated?: boolean };
const sub = (args: readonly string[]): string => {
  const at = args.indexOf('-C');
  return at >= 0 ? String(args[at + 2]) : String(args[0]);
};

const fakeRunner = (
  overrides: Partial<Record<string, (args: readonly string[]) => Reply>> = {},
) => {
  const calls: Call[] = [];
  const defaults: Record<string, (args: readonly string[]) => Reply> = {
    'rev-parse': () => ({
      code: 0,
      stdout: `${join(home, 'repo')}\n${join(home, 'repo', '.git')}\n${join(home, 'repo', '.git')}\n`,
    }),
    'symbolic-ref': () => ({ code: 0, stdout: 'main\n' }),
    'for-each-ref': () => ({ code: 0, stdout: 'origin/main\0[ahead 2, behind 1]\n' }),
    'diff-index': () => ({ code: 0 }),
    'ls-files': () => ({ code: 0, stdout: '' }),
    config: () => ({ code: 0, stdout: 'git@github.com:someone/mux-xr.git\n' }),
    run: () => ({ code: 0, stdout: GH_RUN }),
  };
  const run: RepoCommandRunner = async (file, args, options) => {
    calls.push({ file, args, cwd: options.cwd, maxBytes: options.maxBytes, env: options.env });
    const name = sub(args);
    const reply = (overrides[name] ?? defaults[name] ?? (() => ({ code: 128 })))(args);
    return { stdout: '', truncated: false, ...reply };
  };
  return { run, calls };
};

const probeWith = (
  runner: ReturnType<typeof fakeRunner>,
  options: { gh?: boolean; now?: () => number } = {},
) =>
  createRepoStatusProbe({
    run: runner.run,
    homeDir: () => home,
    findExecutable: async (candidates) =>
      candidates[0].endsWith('/gh')
        ? options.gh === false
          ? null
          : '/opt/homebrew/bin/gh'
        : '/usr/bin/git',
    now: options.now,
  });
const statusOf = (probe: RepoStatusProbe, cwd: string) => composeRepoStatus(probe, cwd);

describe('repo status probe', () => {
  it('summarises a repo inside home with counts, the dirty flag and CI, and no file names', async () => {
    const runner = fakeRunner({ 'ls-files': () => ({ code: null, stdout: 's', truncated: true }) });
    const status = await statusOf(probeWith(runner), join(home, 'repo', 'src'));
    expect(status).toEqual({
      state: 'ok',
      repo: 'repo',
      branch: 'main',
      detached: false,
      upstream: true,
      ahead: 2,
      behind: 1,
      dirty: true,
      ci: {
        state: 'success',
        conclusion: 'success',
        status: 'completed',
        workflow: 'CI',
        createdAt: '2026-11-11T10:00:00Z',
      },
    });
    expect(JSON.stringify(status)).not.toContain(home);
  });

  it('runs every git probe with the hardened prefix and never runs status', async () => {
    const runner = fakeRunner();
    await statusOf(probeWith(runner), join(home, 'repo', 'src'));
    const repo = join(home, 'repo');
    const git = runner.calls.filter((call) => call.file === '/usr/bin/git');
    expect(git.map((call) => call.args)).toEqual([
      [
        ...HARDENED_PREFIX,
        join(repo, 'src'),
        'rev-parse',
        '--show-toplevel',
        '--absolute-git-dir',
        '--git-common-dir',
      ],
      [...HARDENED_PREFIX, repo, 'symbolic-ref', '-q', '--short', 'HEAD'],
      [
        ...HARDENED_PREFIX,
        repo,
        'for-each-ref',
        '--format=%(upstream:short)%00%(upstream:track)',
        'refs/heads/main',
      ],
      [...HARDENED_PREFIX, repo, 'diff-index', '--cached', '--quiet', 'HEAD', '--'],
      [
        ...HARDENED_PREFIX,
        repo,
        'ls-files',
        '--others',
        '--exclude-standard',
        '--directory',
        '--no-empty-directory',
      ],
      [...HARDENED_PREFIX, repo, 'config', '--get', 'remote.origin.url'],
    ]);
    expect(runner.calls.flatMap((call) => call.args)).not.toContain('status');
    expect(git.find((call) => call.args.includes('ls-files'))?.maxBytes).toBe(1);
    const gh = runner.calls.find((call) => call.file.endsWith('/gh'));
    expect(gh?.args).toEqual([
      'run',
      'list',
      '-R',
      'someone/mux-xr',
      '--limit',
      '1',
      '--json',
      'conclusion,status,headBranch,workflowName,createdAt',
      '--branch=main',
    ]);
    expect(gh?.cwd).toBe('/');
  });

  it('puts the hardening in the environment too, so the git gh spawns inherits it', async () => {
    const runner = fakeRunner();
    await statusOf(probeWith(runner), join(home, 'repo'));
    for (const call of runner.calls)
      expect(call.env).toMatchObject({
        HOME: home,
        GIT_CEILING_DIRECTORIES: scratch,
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '4',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: 'false',
        GIT_CONFIG_KEY_1: 'core.hooksPath',
        GIT_CONFIG_VALUE_1: '/dev/null',
        GIT_CONFIG_KEY_2: 'safe.bareRepository',
        GIT_CONFIG_VALUE_2: 'explicit',
        GIT_CONFIG_KEY_3: 'protocol.allow',
        GIT_CONFIG_VALUE_3: 'never',
      });
  });

  it('rejects paths outside home and escapes without running anything', async () => {
    symlinkSync(join(outside, 'repo'), join(home, 'escape'));
    const runner = fakeRunner();
    const probe = probeWith(runner);
    for (const cwd of [
      join(outside, 'repo'),
      join(home, '..', 'outside', 'repo'),
      join(home, 'escape'),
    ])
      expect(await statusOf(probe, cwd), cwd).toEqual({ state: 'not-a-repo' });
    expect(runner.calls).toEqual([]);
  });

  it('never resolves a path that does not read as inside home, so no automount is touched', async () => {
    const resolved: string[] = [];
    const probe = createRepoStatusProbe({
      run: fakeRunner().run,
      homeDir: () => home,
      realpath: async (path) => {
        resolved.push(path);
        return realpathSync(path);
      },
      findExecutable: async () => '/usr/bin/git',
    });
    for (const cwd of ['/net/fileserver/share', `${home}-other/repo`, join(home, '..', 'x')])
      expect(await statusOf(probe, cwd), cwd).toEqual({ state: 'not-a-repo' });
    expect(resolved.filter((path) => path !== home)).toEqual([]);
  });

  it('follows a symlink that stays inside home', async () => {
    symlinkSync(join(home, 'repo'), join(home, 'link'));
    const runner = fakeRunner();
    expect((await statusOf(probeWith(runner), join(home, 'link'))).state).toBe('ok');
    expect(runner.calls[0].args[HARDENED_PREFIX.length]).toBe(join(home, 'repo'));
  });

  it('fails closed when the root, git dir or common dir leaves home', async () => {
    mkdirSync(join(outside, 'git'), { recursive: true });
    const lines = [
      [scratch, join(home, 'repo', '.git'), '.git'],
      [join(home, 'repo'), join(outside, 'git'), join(outside, 'git')],
      [join(home, 'repo'), join(home, 'repo', '.git'), join(outside, 'git')],
      [join(home, 'repo'), join(home, 'repo', '.git'), '../../outside/git'],
      [join(home, 'repo'), join(home, 'missing', '.git'), '.git'],
      [join(home, 'repo'), join(home, 'repo', '.git')],
    ];
    for (const reply of lines) {
      const runner = fakeRunner({
        'rev-parse': () => ({ code: 0, stdout: `${reply.join('\n')}\n` }),
      });
      expect(await statusOf(probeWith(runner), join(home, 'repo')), reply.join(' ')).toEqual({
        state: 'not-a-repo',
      });
      expect(runner.calls).toHaveLength(1);
    }
  });

  it('reports non-repos, missing, relative and NUL paths the same way', async () => {
    const runner = fakeRunner({ 'rev-parse': () => ({ code: 128 }) });
    const probe = probeWith(runner);
    for (const cwd of [
      join(home, 'repo'),
      join(home, 'missing'),
      'repo',
      `${home}\0x`,
      `${home}\nx`,
      `${home}\u0085x`,
      '',
    ])
      expect(await statusOf(probe, cwd), JSON.stringify(cwd)).toEqual({ state: 'not-a-repo' });
    expect(runner.calls).toHaveLength(1);
  });

  it('reads the dirty flag from staged changes and untracked files only', async () => {
    const dirty = async (overrides: Parameters<typeof fakeRunner>[0]) => {
      const status = await statusOf(probeWith(fakeRunner(overrides)), join(home, 'repo'));
      return status.state === 'ok' ? status.dirty : 'not ok';
    };
    expect(await dirty({})).toBe(false);
    expect(await dirty({ 'diff-index': () => ({ code: 1 }) })).toBe(true);
    expect(await dirty({ 'ls-files': () => ({ code: 0, stdout: 'n' }) })).toBe(true);
    expect(await dirty({ 'diff-index': () => ({ code: 128 }) })).toBeNull();
    expect(await dirty({ 'ls-files': () => ({ code: null }) })).toBeNull();
  });

  it('caches git for about 10 s and gh for about 60 s', async () => {
    let now = 1_000_000;
    const runner = fakeRunner();
    const probe = probeWith(runner, { now: () => now });
    const count = (kind: string) =>
      runner.calls.filter((call) =>
        kind === 'gh' ? call.file.endsWith('/gh') : sub(call.args) === kind,
      ).length;
    await statusOf(probe, join(home, 'repo'));
    await statusOf(probe, join(home, 'repo', 'src'));
    expect([count('symbolic-ref'), count('gh')]).toEqual([1, 1]);
    now += 11_000;
    await statusOf(probe, join(home, 'repo'));
    expect([count('symbolic-ref'), count('gh')]).toEqual([2, 1]);
    now += 50_000;
    await statusOf(probe, join(home, 'repo'));
    expect([count('symbolic-ref'), count('gh')]).toEqual([3, 2]);
  });

  it('skips gh when it is missing, HEAD is detached or origin is not a GitHub repo', async () => {
    const missing = fakeRunner();
    const noGh = await statusOf(probeWith(missing, { gh: false }), join(home, 'repo'));
    expect(noGh.state === 'ok' && noGh.ci).toBeNull();
    const detached = fakeRunner({ 'symbolic-ref': () => ({ code: 1 }) });
    expect(await statusOf(probeWith(detached), join(home, 'repo'))).toMatchObject({
      state: 'ok',
      detached: true,
      branch: null,
      ci: null,
    });
    const gitlab = fakeRunner({ config: () => ({ code: 0, stdout: 'git@gitlab.com:a/b.git\n' }) });
    const other = await statusOf(probeWith(gitlab), join(home, 'repo'));
    expect(other.state === 'ok' && other.ci?.state).toBe('unknown');
    expect(
      [...missing.calls, ...detached.calls, ...gitlab.calls].some((call) =>
        call.file.endsWith('/gh'),
      ),
    ).toBe(false);
  });

  it('reports unavailable when HEAD cannot be read', async () => {
    const broken = fakeRunner({ 'symbolic-ref': () => ({ code: 128 }) });
    expect(await statusOf(probeWith(broken), join(home, 'repo'))).toEqual({ state: 'unavailable' });
  });
});

describe('repo status probe against real git (SEC-001)', () => {
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      // A git hook running this suite exports GIT_DIR for the outer repo, and `git init` would
      // then rewrite that repo's config instead of creating the temp repo.
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: home,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CEILING_DIRECTORIES: scratch,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('never runs repo filters or an fsmonitor hook when tracked files are stat-dirty', async () => {
    const repo = join(home, 'planted');
    const markers = {
      clean: join(scratch, 'clean-filter-ran'),
      process: join(scratch, 'process-filter-ran'),
      fsmonitor: join(scratch, 'fsmonitor-ran'),
    };
    mkdirSync(repo);
    run(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'tracked.txt'), 'hello\n');
    writeFileSync(join(repo, 'processed.txt'), 'hello\n');
    run(repo, 'add', 'tracked.txt', 'processed.txt');
    run(repo, 'commit', '-q', '-m', 'init');
    writeFileSync(
      join(repo, '.gitattributes'),
      'tracked.txt filter=evil\nprocessed.txt filter=proc\n',
    );
    run(repo, 'config', 'filter.evil.clean', `touch ${markers.clean}; cat`);
    // A `process` filter without the protocol handshake deadlocks git on Linux; plant a clean filter instead.
    run(repo, 'config', 'filter.proc.clean', `touch ${markers.process}; cat`);
    run(repo, 'config', 'core.fsmonitor', `touch ${markers.fsmonitor}`);
    const touchTracked = (seconds: number) => {
      const at = new Date(Date.now() + seconds * 1000);
      for (const name of ['tracked.txt', 'processed.txt']) utimesSync(join(repo, name), at, at);
    };
    // Not vacuous: plain `git status` runs every planted command.
    touchTracked(5);
    run(repo, '--no-optional-locks', 'status', '--porcelain=v2');
    for (const marker of Object.values(markers)) {
      expect(existsSync(marker), marker).toBe(true);
      rmSync(marker);
    }

    touchTracked(10);
    const probe = createRepoStatusProbe({ homeDir: () => home });
    const status = await composeRepoStatus({ ...probe, ci: async () => null }, join(repo, '.'));
    expect(status).toMatchObject({ state: 'ok', repo: 'planted', branch: 'main', dirty: true });
    for (const marker of Object.values(markers)) expect(existsSync(marker), marker).toBe(false);
  });

  it('treats an empty untracked directory as clean, as git status does', async () => {
    const repo = join(home, 'empty-dir');
    mkdirSync(repo);
    run(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'file.txt'), 'hello\n');
    run(repo, 'add', 'file.txt');
    run(repo, 'commit', '-q', '-m', 'init');
    mkdirSync(join(repo, 'scratch', 'nested'), { recursive: true });
    const probe = createRepoStatusProbe({ homeDir: () => home });
    const status = await composeRepoStatus({ ...probe, ci: async () => null }, repo);
    expect(status).toMatchObject({ state: 'ok', repo: 'empty-dir', dirty: false });
    writeFileSync(join(repo, 'scratch', 'nested', 'new.txt'), 'x\n');
    const fresh = createRepoStatusProbe({ homeDir: () => home });
    const dirty = await composeRepoStatus({ ...fresh, ci: async () => null }, repo);
    expect(dirty).toMatchObject({ state: 'ok', dirty: true });
  });

  it('never lazily fetches a missing object in a partial clone', async () => {
    const source = join(scratch, 'source');
    const marker = join(scratch, 'upload-pack-ran');
    mkdirSync(source);
    run(source, 'init', '-q', '-b', 'main');
    writeFileSync(join(source, 'file.txt'), 'hello\n');
    run(source, 'add', 'file.txt');
    run(source, 'commit', '-q', '-m', 'init');
    run(source, 'config', 'uploadpack.allowFilter', 'true');
    const partialClone = (name: string): string => {
      run(home, 'clone', '-q', '--no-checkout', '--filter=tree:0', `file://${source}`, name);
      const clone = join(home, name);
      run(clone, 'config', 'remote.origin.uploadpack', `touch ${marker}; git-upload-pack`);
      return clone;
    };
    const lazyFetch = (cwd: string) => {
      try {
        run(cwd, 'diff-index', '--cached', '--quiet', 'HEAD', '--');
      } catch {
        /* Exit 1 (differs) or a failed fetch; only the marker matters. */
      }
    };
    // Not vacuous: plain git fetches HEAD's missing tree through the planted upload-pack.
    lazyFetch(partialClone('vacuity'));
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    const clone = partialClone('partial');
    const probe = createRepoStatusProbe({ homeDir: () => home });
    const status = await composeRepoStatus({ ...probe, ci: async () => null }, clone);
    expect(status).toMatchObject({ state: 'ok', repo: 'partial', branch: 'main', dirty: null });
    expect(existsSync(marker)).toBe(false);
  });
});

describe('spawn runner', () => {
  const env = { PATH: '/usr/bin:/bin' };
  it('kills the process group on timeout', async () => {
    const started = Date.now();
    const result = await createSpawnRunner()('/bin/sleep', ['5'], {
      timeoutMs: 100,
      maxBytes: 10,
      env,
    });
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('caps output and reports it truncated', async () => {
    const result = await createSpawnRunner()('/usr/bin/yes', [], {
      timeoutMs: 3000,
      maxBytes: 1,
      env,
    });
    expect(result).toEqual({ code: null, stdout: 'y', truncated: true });
  });
});

describe('repo status parsing', () => {
  it('builds the hardened git prefix', () => {
    expect(hardenedGitArgs('/r', 'x')).toEqual([...HARDENED_PREFIX, '/r', 'x']);
  });

  it('treats only this Mac as local', () => {
    expect(isLocalHost(null, LOCAL_HOST)).toBe(true);
    expect(isLocalHost('', LOCAL_HOST)).toBe(true);
    expect(isLocalHost('localhost', LOCAL_HOST)).toBe(true);
    expect(isLocalHost('test-mac.local', LOCAL_HOST)).toBe(true);
    expect(isLocalHost('test-mac.LOCAL', LOCAL_HOST)).toBe(true);
    expect(isLocalHost('test-mac', LOCAL_HOST)).toBe(true);
    expect(isLocalHost('test-mac.lan', LOCAL_HOST)).toBe(true);
    expect(isLocalHost('test-macx', LOCAL_HOST)).toBe(false);
    expect(isLocalHost('build-box.example', LOCAL_HOST)).toBe(false);
  });

  it('parses only GitHub origins into owner/repo', () => {
    expect(githubSlug('git@github.com:someone/mux-xr.git')).toBe('someone/mux-xr');
    expect(githubSlug('https://github.com/someone/mux.xr')).toBe('someone/mux.xr');
    expect(githubSlug('ssh://git@github.com/a_b/c-d.git\n')).toBe('a_b/c-d');
    expect(githubSlug('https://github.com/a/b/c')).toBeNull();
    expect(githubSlug('https://github.com/a/--repo=x;y')).toBeNull();
    expect(githubSlug('git@gitlab.com:a/b.git')).toBeNull();
    expect(githubSlug('git@github.com:-R/x.git')).toBeNull();
    for (const url of [
      'https://github.com/owner/..',
      'https://github.com/owner/.',
      'git@github.com:owner/...git',
      'https://github.com/./repo',
      'https://github.com/../repo',
    ])
      expect(githubSlug(url), url).toBeNull();
    expect(githubSlug('https://github.com/owner/.dotfiles')).toBe('owner/.dotfiles');
    expect(githubSlug('https://evil.test/github.com/a/b')).toBeNull();
  });

  it('parses upstream tracking', () => {
    expect(parseTrack('[ahead 2, behind 1]')).toEqual({ ahead: 2, behind: 1 });
    expect(parseTrack('[behind 3]')).toEqual({ ahead: 0, behind: 3 });
    expect(parseTrack('[gone]')).toEqual({ ahead: 0, behind: 0 });
  });

  it('maps gh runs to a CI state and sanitises the strings', () => {
    expect(ciState('in_progress', null)).toBe('in_progress');
    expect(ciState('completed', 'failure')).toBe('failure');
    expect(ciState('completed', 'cancelled')).toBe('unknown');
    expect(parseGhRuns('[]')?.state).toBe('unknown');
    expect(
      parseGhRuns(
        JSON.stringify([
          {
            status: 'queued; rm',
            conclusion: '',
            workflowName: `CI\u001b[31m${'x'.repeat(100)}`,
            createdAt: 'yesterday',
          },
        ]),
      ),
    ).toEqual({
      state: 'unknown',
      conclusion: null,
      status: null,
      workflow: `CI[31m${'x'.repeat(54)}`,
      createdAt: null,
    });
    expect(parseGhRuns('not json')).toBeNull();
  });
});

const servers: Array<{ server: Server; close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const { server, close } of servers.splice(0)) {
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const okStatus: Extract<RepoStatus, { state: 'ok' }> = {
  state: 'ok',
  repo: 'repo',
  branch: 'main',
  detached: false,
  upstream: true,
  ahead: 0,
  behind: 0,
  dirty: false,
  ci: null,
};

const fakeProbe = (result: GitProbeResult = { status: okStatus }) => ({
  git: vi.fn<RepoStatusProbe['git']>(async () => result),
  ci: vi.fn<RepoStatusProbe['ci']>(async () => null),
});

const start = async (
  options: {
    loadSecret?: () => ClipboardSecret;
    configured?: boolean;
    enabled?: boolean;
    repoStatus?: Omit<RepoStatusRouteOptions, 'allowedOrigins' | 'loadSecret'>;
  } = {},
) => {
  const server = createServer();
  const attached = attachDictationServer(server, {
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard:
      options.configured === false
        ? undefined
        : {
            loadSecret:
              options.loadSecret ?? (() => ({ enabled: true, key: Buffer.from(PAIRING) })),
            host: { read: async () => '', write: async () => undefined },
          },
    repoStatus: {
      enabled: options.enabled ?? true,
      localHostname: () => LOCAL_HOST,
      ...options.repoStatus,
    },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `ws://127.0.0.1:${address.port}/repo-status`;
};

const query = (
  url: string,
  cwd: string,
  options: { key?: string; host?: string | null; signedHost?: string | null } = {},
) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = new WebSocket(url, { origin: ORIGIN });
    const host = options.host ?? null;
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (message.type === 'challenge') {
        const signed = options.signedHost === undefined ? host : options.signedHost;
        const mac = repoStatusMac(Buffer.from(options.key ?? PAIRING), message.nonce, signed, cwd);
        socket.send(JSON.stringify({ type: 'auth', cwd, host, mac: mac.toString('base64') }));
      } else {
        resolve(message);
        socket.close();
      }
    });
    socket.once('error', reject);
  });
const WRONG = { key: 'wrong-secret-value-of-enough-length' };

const upgradeStatus = (url: string, origin?: string) =>
  new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once('open', () => {
      socket.terminate();
      reject(new Error('upgrade unexpectedly accepted'));
    });
    socket.once('error', () => undefined);
  });

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe('/repo-status route', () => {
  it('resolves a signed roster hint on the serving host and rejects traversal or remote hints', async () => {
    const probe = fakeProbe();
    const repos = join(home, 'Repos');
    mkdirSync(join(repos, 'alpha'), { recursive: true });
    symlinkSync(home, join(repos, 'escape'));
    const url = await start({ repoStatus: { probe, homeDir: () => home } });
    expect(await query(url, '~/Repos/alpha')).toMatchObject({ type: 'status', status: okStatus });
    expect(probe.git).toHaveBeenCalledWith(join(repos, 'alpha'));
    expect(await query(url, '~/Repos/escape')).toMatchObject({ status: { state: 'not-a-repo' } });
    expect(await query(url, '~/Repos/../outside')).toMatchObject({
      status: { state: 'not-a-repo' },
    });
    expect(await query(url, '~/Repos/alpha', { host: 'other-mac' })).toMatchObject({
      status: { state: 'remote' },
    });
    expect(probe.git).toHaveBeenCalledOnce();
  });

  it('answers an authenticated query and adds CI outside the git queue', async () => {
    const probe = fakeProbe({ status: okStatus, ci: { branch: 'main', slug: 'someone/repo' } });
    probe.ci.mockResolvedValue({
      state: 'failure',
      conclusion: 'failure',
      status: 'completed',
      workflow: 'CI',
      createdAt: null,
    });
    const url = await start({ repoStatus: { probe } });
    const reply = await query(url, '/Users/someone/repo');
    expect(reply).toMatchObject({
      type: 'status',
      status: { state: 'ok', ci: { state: 'failure' } },
    });
    expect(probe.git).toHaveBeenCalledWith('/Users/someone/repo');
    expect(probe.ci).toHaveBeenCalledWith('someone/repo', 'main');
  });

  it('treats an OSC 7 hostname naming this Mac as local and any other as remote', async () => {
    const probe = fakeProbe();
    const url = await start({ repoStatus: { probe } });
    for (const host of [LOCAL_HOST, 'test-mac', 'test-mac.LOCAL', 'localhost', null])
      expect((await query(url, '/r', { host })).status, String(host)).toEqual(okStatus);
    expect(await query(url, '/r', { host: 'build-box.example' })).toEqual({
      type: 'status',
      status: { state: 'remote' },
    });
    expect(probe.git).toHaveBeenCalledTimes(5);
  });

  it('requires the pairing secret and binds the MAC to the host and cwd', async () => {
    const probe = fakeProbe();
    const url = await start({ repoStatus: { probe } });
    expect(await query(url, '/r', WRONG)).toEqual({ type: 'error', code: 'auth' });
    expect(await query(url, '/r', { host: 'build-box', signedHost: LOCAL_HOST })).toEqual({
      type: 'error',
      code: 'auth',
    });
    const reply = await new Promise<Record<string, unknown>>((resolve) => {
      const socket = new WebSocket(url, { origin: ORIGIN });
      socket.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (message.type !== 'challenge') return resolve(message);
        const mac = repoStatusMac(Buffer.from(PAIRING), message.nonce, null, '/a');
        socket.send(JSON.stringify({ type: 'auth', cwd: '/b', mac: mac.toString('base64') }));
      });
    });
    expect(reply).toEqual({ type: 'error', code: 'auth' });
    expect(probe.git).not.toHaveBeenCalled();
  });

  it('refuses control characters in the host or cwd before checking the proof', async () => {
    const probe = fakeProbe();
    const url = await start({ repoStatus: { probe } });
    expect(await query(url, '/r\nx')).toEqual({ type: 'error', code: 'auth' });
    expect(await query(url, '/r', { host: 'test-mac\n/evil' })).toEqual({
      type: 'error',
      code: 'auth',
    });
    expect(await query(url, '/r', { host: 'mini\u0007mac' })).toEqual({
      type: 'error',
      code: 'auth',
    });
    expect(probe.git).not.toHaveBeenCalled();
  });

  it('stays disabled without the explicit opt-in, even with clipboard pairing', async () => {
    const probe = fakeProbe();
    const url = await start({ enabled: false, repoStatus: { probe } });
    expect(await query(url, '/r')).toEqual({ type: 'error', code: 'disabled' });
    expect(probe.git).not.toHaveBeenCalled();
  });

  it('is disabled when clipboard pairing is not configured', async () => {
    const url = await start({ configured: false });
    expect(await query(url, '/r')).toEqual({ type: 'error', code: 'disabled' });
  });

  it('refuses other origins and query strings', async () => {
    const url = await start();
    expect(await upgradeStatus(url, 'https://evil.test')).toBe(403);
    expect(await upgradeStatus(url)).toBe(403);
    expect(await upgradeStatus(`${url}?cwd=/etc`, ORIGIN)).toBe(403);
  });

  it('rate-limits authenticated requests per client', async () => {
    const probe = fakeProbe();
    const url = await start({
      repoStatus: { probe, requestLimiter: createFailureLimiter(Date.now, 2, 60_000) },
    });
    expect((await query(url, '/r')).type).toBe('status');
    expect((await query(url, '/r')).type).toBe('status');
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    expect(probe.git).toHaveBeenCalledTimes(2);
  });

  it('locks a client out after repeated auth failures', async () => {
    const url = await start({ repoStatus: { probe: fakeProbe() } });
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect((await query(url, '/r', WRONG)).code).toBe('auth');
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
  });

  it('shares the failed-proof block with /clipboard', async () => {
    const url = await start({ repoStatus: { probe: fakeProbe() } });
    const clipboardUrl = url.replace('/repo-status', '/clipboard');
    const badClipboardProof = () =>
      new Promise<unknown>((resolve) => {
        const socket = new WebSocket(clipboardUrl, { origin: ORIGIN });
        socket.on('message', (data) => {
          const message = JSON.parse(String(data));
          if (message.type === 'challenge')
            socket.send(JSON.stringify({ type: 'auth', op: 'read', mac: 'AAAA' }));
          else resolve(message.code);
        });
      });
    for (let attempt = 0; attempt < 3; attempt += 1) expect(await badClipboardProof()).toBe('auth');
    for (let attempt = 0; attempt < 2; attempt += 1)
      expect((await query(url, '/r', WRONG)).code).toBe('auth');
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    expect(await upgradeStatus(clipboardUrl, ORIGIN)).toBe(429);
  });

  it('allows at most two unauthenticated sockets per client', async () => {
    const url = await start({ repoStatus: { probe: fakeProbe() } });
    const held = [new WebSocket(url, { origin: ORIGIN }), new WebSocket(url, { origin: ORIGIN })];
    await Promise.all(held.map((socket) => new Promise((done) => socket.once('message', done))));
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    for (const socket of held) socket.terminate();
    await settle();
    expect((await query(url, '/r')).type).toBe('status');
  });

  it('caps concurrent connections', async () => {
    const url = await start({ repoStatus: { maxConnections: 1, probe: fakeProbe() } });
    const held = new WebSocket(url, { origin: ORIGIN });
    await new Promise((resolve) => held.once('message', resolve));
    expect(await upgradeStatus(url, ORIGIN)).toBe(503);
    held.terminate();
  });

  it('skips a queued probe whose socket closed while it waited', async () => {
    let release!: () => void;
    const probe = fakeProbe();
    probe.git.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ status: okStatus }))),
    );
    const url = await start({ repoStatus: { probe } });
    const first = query(url, '/first');
    await settle();
    const second = new WebSocket(url, { origin: ORIGIN });
    second.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (message.type !== 'challenge') return;
      const mac = repoStatusMac(Buffer.from(PAIRING), message.nonce, null, '/second');
      second.send(JSON.stringify({ type: 'auth', cwd: '/second', mac: mac.toString('base64') }));
      setTimeout(() => second.terminate(), 30);
    });
    await settle(150);
    release();
    expect((await first).type).toBe('status');
    await settle();
    expect(probe.git.mock.calls).toEqual([['/first']]);
  });
});

describe('repo status client against the route', () => {
  it('authenticates with the clipboard secret and forwards the OSC 7 host', async () => {
    const probe = fakeProbe();
    const url = await start({ repoStatus: { probe } });
    const factory = (target: string) =>
      new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket;
    const client = (secret: string | null) =>
      createRepoStatusClient({ url: () => url, secret: () => secret, socketFactory: factory });
    expect(await client(PAIRING)('/Users/someone/repo', LOCAL_HOST)).toEqual({
      ok: true,
      report: okStatus,
    });
    expect(await client(PAIRING)('/Users/someone/repo', 'elsewhere')).toEqual({
      ok: true,
      report: { state: 'remote' },
    });
    expect(await client('wrong-secret-value-of-enough-length')('/r', null)).toEqual({
      ok: false,
      code: 'auth',
    });
    expect(await client(null)('/r', null)).toEqual({ ok: false, code: 'no-secret' });
    const opened = vi.fn(factory);
    const guarded = createRepoStatusClient({
      url: () => url,
      secret: () => PAIRING,
      socketFactory: opened,
    });
    expect(await guarded('/r\nx', null)).toEqual({ ok: false, code: 'unavailable' });
    expect(await guarded('/r', 'host\n/x')).toEqual({ ok: false, code: 'unavailable' });
    expect(opened).not.toHaveBeenCalled();
    expect(probe.git).toHaveBeenCalledTimes(1);
  });
});
