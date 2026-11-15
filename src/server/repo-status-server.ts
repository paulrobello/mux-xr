import { spawn as nodeSpawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, realpath as fsRealpath } from 'node:fs/promises';
import { homedir, hostname as osHostname } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { errorName, reportSwallowed } from '../diagnostics';
import { rosterDirectoryProject } from '../workspace/project-directory';
import {
  type ClipboardSecret,
  createFailureLimiter,
  type FailureLimiter,
} from './clipboard-server';
import { createPairedRoute, type PairedRoute, pairedHmac } from './paired-route';

export const REPO_STATUS_PATH = '/repo-status';
export const REPO_STATUS_PROTOCOL = 'mux-xr-repo-status-v1';
const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_CWD_CHARS = 4096;
const MAX_HOST_CHARS = 253;
const MAX_CONNECTIONS = 8;
const MAX_PRE_AUTH_PER_CLIENT = 2;
const AUTH_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 20_000;
const GIT_TIMEOUT_MS = 3_000;
const GH_TIMEOUT_MS = 4_000;
const GIT_MAX_BYTES = 64 * 1024;
const GH_MAX_BYTES = 64 * 1024;
const GIT_CACHE_MS = 10_000;
const GH_CACHE_MS = 60_000;
const REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_WORKFLOW_CHARS = 60;
const GIT_PATHS = ['/usr/bin/git', '/opt/homebrew/bin/git'];
const GH_PATHS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin';

/**
 * Applied to every git run, as `-c` flags and again through GIT_CONFIG_COUNT so the git that gh
 * spawns inherits it: no fsmonitor or hooks command from repo config, no implicit bare repos, no
 * transport at all.
 */
export const GIT_HARDENING: ReadonlyArray<readonly [string, string]> = [
  ['core.fsmonitor', 'false'],
  ['core.hooksPath', '/dev/null'],
  ['safe.bareRepository', 'explicit'],
  ['protocol.allow', 'never'],
];

/**
 * The fixed prefix for every probe. Probes never run `status` or a worktree-walking `diff`: those
 * read tracked file content and so run the repo's own clean/process filters.
 */
export const hardenedGitArgs = (root: string, ...args: string[]): string[] => [
  ...GIT_HARDENING.flatMap(([key, value]) => ['-c', `${key}=${value}`]),
  '--no-optional-locks',
  '-C',
  root,
  ...args,
];

export const probeEnv = (home: string): Record<string, string> => {
  const env: Record<string, string> = {
    HOME: home,
    PATH: SAFE_PATH,
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_CEILING_DIRECTORIES: dirname(home),
    GIT_CONFIG_COUNT: String(GIT_HARDENING.length),
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
  };
  GIT_HARDENING.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
};

export type CiState = 'success' | 'failure' | 'in_progress' | 'unknown';

export interface RepoCiStatus {
  state: CiState;
  conclusion: string | null;
  status: string | null;
  workflow: string | null;
  createdAt: string | null;
}

export type RepoStatus =
  | {
      state: 'ok';
      repo: string;
      branch: string | null;
      detached: boolean;
      upstream: boolean;
      ahead: number;
      behind: number;
      /** Staged changes or untracked files; unstaged-only edits to tracked files read clean. Null when git could not tell. */
      dirty: boolean | null;
      /** Null when gh is missing or failed, or HEAD is detached; unknown when origin is not a GitHub repo. */
      ci: RepoCiStatus | null;
    }
  | { state: 'not-a-repo' }
  | { state: 'remote' }
  | { state: 'unavailable' };

export type RepoStatusErrorCode = 'disabled' | 'auth' | 'rate_limited' | 'protocol';

export type RunResult = { code: number | null; stdout: string; truncated: boolean };

/** Runs one fixed program without a shell. Never rejects. */
export type RepoCommandRunner = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs: number; maxBytes: number; env: Record<string, string> },
) => Promise<RunResult>;

/**
 * Spawns in its own process group so a timeout or the output cap kills git or gh and anything they
 * started. Output past `maxBytes` is dropped and reported as truncated.
 */
export const createSpawnRunner =
  (spawn: typeof nodeSpawn = nodeSpawn): RepoCommandRunner =>
  (file, args, options) =>
    new Promise((resolveRun) => {
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawn(file, [...args], {
          cwd: options.cwd,
          env: options.env,
          shell: false,
          detached: true,
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
      } catch (error) {
        reportSwallowed('repo-status.spawn', errorName(error));
        resolveRun({ code: null, stdout: '', truncated: false });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;
      let settled = false;
      const killGroup = (): void => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already gone. */
        }
      };
      const timer = setTimeout(killGroup, options.timeoutMs);
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveRun({ code, stdout: Buffer.concat(chunks).toString('utf8'), truncated });
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        if (truncated) return;
        const room = options.maxBytes - bytes;
        if (chunk.length > room) {
          if (room > 0) chunks.push(chunk.subarray(0, room));
          bytes = options.maxBytes;
          truncated = true;
          killGroup();
          return;
        }
        chunks.push(chunk);
        bytes += chunk.length;
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => finish(truncated ? null : code));
    });

/** C0 and C1 controls, including NUL and newlines, which would also split the signed text. */
export const CONTROL_CHARS = /\p{Cc}/u;

const isInside = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

/** Absolute, bounded, control-free; anything else is never handed to the filesystem. */
export const validCwd = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_CWD_CHARS &&
  isAbsolute(value) &&
  !CONTROL_CHARS.test(value);

/** Resolve a roster hint only to a real directory inside the host's canonical checkout tree. */
export async function resolveWidgetDirectory(
  directory: string,
  home: string,
  realpath: (path: string) => Promise<string> = fsRealpath,
): Promise<string | null> {
  const project = rosterDirectoryProject(directory);
  if (!project) return validCwd(directory) ? directory : null;
  try {
    const repos = await realpath(join(home, 'Repos'));
    const canonical = await realpath(join(repos, project));
    return canonical !== repos && isInside(canonical, repos) ? canonical : null;
  } catch {
    return null;
  }
}

const shortName = (name: string): string => name.split('.')[0] ?? name;

/** An OSC 7 host names this Mac: absent, `localhost`, or its full or short name, any case. */
export const isLocalHost = (host: string | null, local: string = osHostname()): boolean => {
  if (host === null || host === '') return true;
  const wanted = host.toLowerCase();
  const own = local.toLowerCase();
  return (
    wanted === 'localhost' || wanted === own || (own !== '' && shortName(wanted) === shortName(own))
  );
};

/** `owner/repo` from a GitHub origin URL, or null for anything else. */
export const githubSlug = (url: string): string | null => {
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  const slug = match?.[1];
  return slug &&
    /^\w[\w.-]*\/[\w.-]+$/.test(slug) &&
    slug.split('/').every((part) => part !== '.' && part !== '..')
    ? slug
    : null;
};

/** `%(upstream:track)` text such as `[ahead 2, behind 1]`, `[gone]` or empty. */
export const parseTrack = (track: string): { ahead: number; behind: number } => ({
  ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
  behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
});

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const WORD = /^[a-z_]{1,32}$/;

export const ciState = (status: string | null, conclusion: string | null): CiState => {
  if (status && status !== 'completed') return 'in_progress';
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure')
    return 'failure';
  return 'unknown';
};

const UNKNOWN_CI: RepoCiStatus = {
  state: 'unknown',
  conclusion: null,
  status: null,
  workflow: null,
  createdAt: null,
};

/** First run from `gh run list --json`, reduced to enum-like strings, a capped name and a time. */
export const parseGhRuns = (stdout: string): RepoCiStatus | null => {
  let runs: unknown;
  try {
    runs = JSON.parse(stdout);
  } catch (error) {
    reportSwallowed('repo-status.gh-parse', errorName(error));
    return null;
  }
  if (!Array.isArray(runs)) return null;
  if (runs.length === 0) return { ...UNKNOWN_CI };
  const run = runs[0] as Record<string, unknown>;
  const word = (value: unknown): string | null =>
    typeof value === 'string' && WORD.test(value) ? value : null;
  const status = word(run.status);
  const conclusion = word(run.conclusion);
  const workflow =
    typeof run.workflowName === 'string'
      ? Array.from(run.workflowName.replace(/[\p{Cc}\p{Cf}]/gu, ''))
          .slice(0, MAX_WORKFLOW_CHARS)
          .join('') || null
      : null;
  const createdAt =
    typeof run.createdAt === 'string' && ISO_TIME.test(run.createdAt) ? run.createdAt : null;
  return { state: ciState(status, conclusion), conclusion, status, workflow, createdAt };
};

/** What the git probes found, plus what the CI lookup needs. */
export type GitProbeResult =
  | { status: Exclude<RepoStatus, { state: 'ok' }> }
  | {
      status: Extract<RepoStatus, { state: 'ok' }>;
      /** Present when the branch has a name; `slug` null means origin is not a GitHub repo. */
      ci?: { branch: string; slug: string | null };
    };

export interface RepoStatusProbe {
  /** Local git probes only; the route runs these one at a time. */
  git(cwd: string): Promise<GitProbeResult>;
  /** The latest Actions run for a branch, or null when gh is missing or fails. */
  ci(slug: string, branch: string): Promise<RepoCiStatus | null>;
}

export interface RepoStatusProbeOptions {
  run?: RepoCommandRunner;
  homeDir?: () => string;
  realpath?: (path: string) => Promise<string>;
  /** Absolute path of an executable, or null when none of the candidates is executable. */
  findExecutable?: (candidates: readonly string[]) => Promise<string | null>;
  now?: () => number;
}

const firstExecutable = async (candidates: readonly string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* Try the next one. */
    }
  }
  return null;
};

type Cached<T> = { at: number; value: Promise<T> };

const remember = <T>(cache: Map<string, Cached<T>>, key: string, at: number, value: Promise<T>) => {
  cache.delete(key);
  cache.set(key, { at, value });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
};

/** Probes for a repo, its branch, its upstream counts and whether it is dirty. */
export const composeRepoStatus = async (
  probe: RepoStatusProbe,
  cwd: string,
): Promise<RepoStatus> => {
  const result = await probe.git(cwd);
  if (result.status.state !== 'ok' || !('ci' in result) || !result.ci) return result.status;
  const ci = result.ci.slug ? await probe.ci(result.ci.slug, result.ci.branch) : { ...UNKNOWN_CI };
  return { ...result.status, ci };
};

/**
 * Resolves a pane cwd to a repo inside the home directory and summarises it. Every failure,
 * including paths outside home, missing paths and non-repos, reads as `not-a-repo`, so the answer
 * never says whether a path exists.
 */
export const createRepoStatusProbe = (options: RepoStatusProbeOptions = {}): RepoStatusProbe => {
  const run = options.run ?? createSpawnRunner();
  const realpath = options.realpath ?? fsRealpath;
  const findExecutable = options.findExecutable ?? firstExecutable;
  const now = options.now ?? Date.now;
  const homeDir = options.homeDir ?? homedir;
  const roots = new Map<string, Cached<string | null>>();
  const gitCache = new Map<string, Cached<GitProbeResult>>();
  const ghCache = new Map<string, Cached<RepoCiStatus | null>>();
  const fresh = <T>(cache: Map<string, Cached<T>>, key: string, ttl: number): Promise<T> | null => {
    const hit = cache.get(key);
    return hit && now() - hit.at < ttl ? hit.value : null;
  };
  const realHome = async (): Promise<string | null> => {
    try {
      return await realpath(homeDir());
    } catch {
      return null;
    }
  };
  const confine = async (path: string, home: string): Promise<string | null> => {
    try {
      const real = await realpath(path);
      return isInside(real, home) ? real : null;
    } catch {
      return null;
    }
  };
  const git = async (
    home: string,
    root: string,
    args: string[],
    maxBytes = GIT_MAX_BYTES,
  ): Promise<RunResult | null> => {
    const file = await findExecutable(GIT_PATHS);
    if (!file) return null;
    return run(file, hardenedGitArgs(root, ...args), {
      timeoutMs: GIT_TIMEOUT_MS,
      maxBytes,
      env: probeEnv(home),
    });
  };
  const resolveRoot = (cwd: string): Promise<string | null> => {
    const cached = fresh(roots, cwd, GIT_CACHE_MS);
    if (cached) return cached;
    const value = (async () => {
      const home = await realHome();
      if (!home) return null;
      // realpath on a path such as /net/<host>/... can trigger an automount, so only paths that
      // already read as inside home reach it.
      const lexical = resolve(cwd);
      if (!isInside(lexical, resolve(homeDir())) && !isInside(lexical, home)) return null;
      const real = await confine(cwd, home);
      if (!real) return null;
      const result = await git(home, real, [
        'rev-parse',
        '--show-toplevel',
        '--absolute-git-dir',
        '--git-common-dir',
      ]);
      if (result?.code !== 0) return null;
      const lines = result.stdout.split('\n').filter(Boolean);
      if (lines.length !== 3) return null;
      // The worktree, its git dir and the shared git dir must all stay inside home.
      const confined = await Promise.all(lines.map((line) => confine(resolve(real, line), home)));
      return confined.every(Boolean) ? confined[0] : null;
    })();
    remember(roots, cwd, now(), value);
    return value;
  };
  const summarise = async (home: string, root: string): Promise<GitProbeResult> => {
    const unavailable: GitProbeResult = { status: { state: 'unavailable' } };
    const head = await git(home, root, ['symbolic-ref', '-q', '--short', 'HEAD']);
    if (!head || (head.code !== 0 && head.code !== 1)) return unavailable;
    const branch = head.code === 0 ? head.stdout.trim() || null : null;
    let upstream = false;
    let ahead = 0;
    let behind = 0;
    if (branch) {
      const refs = await git(home, root, [
        'for-each-ref',
        '--format=%(upstream:short)%00%(upstream:track)',
        `refs/heads/${branch}`,
      ]);
      const [name = '', track = ''] = (refs?.code === 0 ? refs.stdout.trim() : '').split('\0');
      upstream = name !== '';
      ({ ahead, behind } = parseTrack(track));
    }
    let dirty: boolean | null = null;
    const staged = await git(home, root, ['diff-index', '--cached', '--quiet', 'HEAD', '--']);
    if (staged?.code === 1) dirty = true;
    else if (staged?.code === 0) {
      const untracked = await git(
        home,
        root,
        ['ls-files', '--others', '--exclude-standard', '--directory', '--no-empty-directory'],
        1,
      );
      if (untracked && untracked.stdout.length > 0) dirty = true;
      else if (untracked?.code === 0) dirty = false;
    }
    const origin = branch
      ? await git(home, root, ['config', '--get', 'remote.origin.url'], 4096)
      : null;
    const status = {
      state: 'ok' as const,
      repo: basename(root),
      branch,
      detached: head.code === 1,
      upstream,
      ahead,
      behind,
      dirty,
      ci: null,
    };
    if (!branch) return { status };
    return {
      status,
      ci: { branch, slug: origin?.code === 0 ? githubSlug(origin.stdout) : null },
    };
  };
  return {
    git: async (cwd) => {
      if (!validCwd(cwd)) return { status: { state: 'not-a-repo' } };
      const root = await resolveRoot(cwd);
      if (!root) return { status: { state: 'not-a-repo' } };
      const cached = fresh(gitCache, root, GIT_CACHE_MS);
      if (cached) return cached;
      const value = (async () => {
        const home = await realHome();
        return home ? summarise(home, root) : ({ status: { state: 'unavailable' } } as const);
      })();
      remember(gitCache, root, now(), value);
      return value;
    },
    ci: (slug, branch) => {
      const key = `${slug}\n${branch}`;
      const cached = fresh(ghCache, key, GH_CACHE_MS);
      if (cached) return cached;
      const value = (async () => {
        const [gh, home] = await Promise.all([findExecutable(GH_PATHS), realHome()]);
        if (!gh || !home) return null;
        const result = await run(
          gh,
          [
            'run',
            'list',
            '-R',
            slug,
            '--limit',
            '1',
            '--json',
            'conclusion,status,headBranch,workflowName,createdAt',
            `--branch=${branch}`,
          ],
          { cwd: '/', timeoutMs: GH_TIMEOUT_MS, maxBytes: GH_MAX_BYTES, env: probeEnv(home) },
        );
        return result.code === 0 && !result.truncated ? parseGhRuns(result.stdout) : null;
      })();
      remember(ghCache, key, now(), value);
      return value;
    },
  };
};

export const repoStatusMac = (
  key: Buffer,
  nonce: string,
  host: string | null,
  cwd: string,
): Buffer => pairedHmac(key, REPO_STATUS_PROTOCOL, nonce, `${host ?? ''}\n${cwd}`);

export interface RepoStatusRouteOptions {
  homeDir?: () => string;
  allowedOrigins: string[];
  /** The clipboard pairing secret; this route adds no credential of its own. */
  loadSecret: () => ClipboardSecret;
  probe?: RepoStatusProbe;
  localHostname?: () => string;
  now?: () => number;
  authTimeoutMs?: number;
  maxConnections?: number;
  /** Auth failures per client. */
  limiter?: FailureLimiter;
  /** Authenticated requests per client. */
  requestLimiter?: FailureLimiter;
}

export type RepoStatusRoute = PairedRoute;

export const createRepoStatusRoute = (options: RepoStatusRouteOptions): RepoStatusRoute => {
  const homeDir = options.homeDir ?? homedir;
  const probe = options.probe ?? createRepoStatusProbe({ homeDir, now: options.now });
  const localHostname = options.localHostname ?? osHostname;
  const limiter = options.limiter ?? createFailureLimiter(options.now);
  const requests =
    options.requestLimiter ?? createFailureLimiter(options.now, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  // Local git probes run one at a time; a request whose socket closed while queued is skipped.
  let gitQueue: Promise<unknown> = Promise.resolve();
  const queuedGit = (cwd: string, alive: () => boolean): Promise<GitProbeResult | null> => {
    const step = async (): Promise<GitProbeResult | null> => (alive() ? probe.git(cwd) : null);
    const result = gitQueue.then(step, step);
    gitQueue = result.catch(() => undefined);
    return result.catch((error: unknown): GitProbeResult => {
      reportSwallowed('repo-status.git-probe', errorName(error));
      return { status: { state: 'unavailable' } };
    });
  };
  return createPairedRoute({
    protocol: REPO_STATUS_PROTOCOL,
    allowedOrigins: options.allowedOrigins,
    loadSecret: options.loadSecret,
    limiter,
    requestLimiter: { blocked: requests.blocked, charge: requests.fail },
    maxPayloadBytes: MAX_MESSAGE_BYTES,
    maxConnections: options.maxConnections ?? MAX_CONNECTIONS,
    perClient: { cap: MAX_PRE_AUTH_PER_CLIENT, gate: 'rate', release: 'auth' },
    reportGates: false,
    reportFailures: 'none',
    emit: () => undefined,
    authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    validateAuth: (message) => {
      const host = message.host ?? null;
      return (
        typeof message.cwd === 'string' &&
        !CONTROL_CHARS.test(message.cwd) &&
        (host === null ||
          (typeof host === 'string' && host.length <= MAX_HOST_CHARS && !CONTROL_CHARS.test(host)))
      );
    },
    macMaterial: (message) => `${message.host ?? ''}\n${message.cwd}`,
    onAuthenticated: (connection, message) => {
      void (async () => {
        const host = (message.host as string | null) ?? null;
        const cwdText = String(message.cwd);
        const local = isLocalHost(host, localHostname());
        const cwd = local ? await resolveWidgetDirectory(cwdText, homeDir()) : null;
        let status: RepoStatus;
        if (!local) status = { state: 'remote' };
        else if (!cwd) status = { state: 'not-a-repo' };
        else {
          const result = await queuedGit(cwd, () => !connection.finished());
          if (!result || connection.finished()) return;
          status = result.status;
          if (status.state === 'ok' && 'ci' in result && result.ci) {
            const target = result.ci;
            const ci = target.slug
              ? await probe.ci(target.slug, target.branch).catch((error: unknown) => {
                  reportSwallowed('repo-status.ci-probe', errorName(error));
                  return null;
                })
              : { ...UNKNOWN_CI };
            status = { ...status, ci };
          }
        }
        if (connection.finished()) return;
        connection.sendJson({ type: 'status', status });
        connection.finish(1000, 'complete');
      })();
    },
  });
};
