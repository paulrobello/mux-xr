import { constants as fsConstants } from 'node:fs';
import { access, realpath as fsRealpath, stat } from 'node:fs/promises';
import { homedir, hostname as osHostname } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FeedError } from './feed-route';
import {
  CONTROL_CHARS,
  createSpawnRunner,
  isLocalHost,
  type RepoCommandRunner,
  validCwd,
} from './repo-status-server';

export const KANBAN_STRIP_PATH = '/kanban-strip';
export const KANBAN_STRIP_PROTOCOL = 'mux-xr-kanban-strip-v1';

const CLI_TIMEOUT_MS = 8_000;
const CLI_MAX_BYTES = 4 * 1024 * 1024;
const RESULT_CACHE_MS = 30_000;
const FAILURE_CACHE_MS = 10_000;
/** Reads waiting on the one-at-a-time CLI queue before more are refused. */
export const MAX_PENDING_KANBAN_READS = 4;
const PROJECTS_CACHE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_STRIP_CARDS = 20;
const MAX_TITLE_CHARS = 90;
const MAX_HOLDER_CHARS = 48;
const BUN_PATHS = ['/opt/homebrew/bin/bun', '/usr/local/bin/bun'];
const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin';

/** A ~/Repos directory name; a leading dot or dash could read as a hidden path or a CLI flag. */
export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The only kanban CLI commands the streamer runs; every one of them is a read. */
export const KANBAN_READ_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ['item', 'list'],
  ['project', 'list'],
  ['schedule', 'list'],
  ['schedule', 'resource-list'],
];

export const isKanbanReadCommand = (args: readonly string[]): boolean =>
  KANBAN_READ_COMMANDS.some(([noun, verb]) => args[0] === noun && args[1] === verb) &&
  !args.some((arg) => CONTROL_CHARS.test(arg));

/** Visible text only, capped by code point. */
export const cleanText = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? Array.from(
        value
          .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
        .slice(0, max)
        .join('')
    : '';

export interface KanbanCli {
  /** Parsed JSON stdout, or null when the CLI failed, timed out or printed something else. */
  read(args: readonly string[], ttlMs?: number): Promise<unknown | null>;
}

export interface KanbanCliOptions {
  run?: RepoCommandRunner;
  homeDir?: () => string;
  /** Absolute path of an executable, or null when none of the candidates is executable. */
  findExecutable?: (candidates: readonly string[]) => Promise<string | null>;
  cliPath?: string;
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

/**
 * Runs `bun ~/Repos/kanban/cli/kanban.ts <read command> --format json` with a fixed argv, no shell
 * and a minimal environment, one run at a time, and shares each answer for `ttlMs` so several
 * headsets polling spawn the CLI once.
 */
export const createKanbanCli = (options: KanbanCliOptions = {}): KanbanCli => {
  const run = options.run ?? createSpawnRunner();
  const homeDir = options.homeDir ?? homedir;
  const findExecutable = options.findExecutable ?? firstExecutable;
  const now = options.now ?? Date.now;
  const cache = new Map<
    string,
    { at: number; value: Promise<unknown | null>; failedUntil?: number }
  >();
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  const spawnOnce = async (args: readonly string[]): Promise<unknown | null> => {
    const home = homeDir();
    const bun = await findExecutable([...BUN_PATHS, join(home, '.bun', 'bin', 'bun')]);
    if (!bun) return null;
    const result = await run(
      bun,
      [
        options.cliPath ?? join(home, 'Repos', 'kanban', 'cli', 'kanban.ts'),
        ...args,
        '--format',
        'json',
      ],
      {
        cwd: '/',
        timeoutMs: CLI_TIMEOUT_MS,
        maxBytes: CLI_MAX_BYTES,
        env: { HOME: home, PATH: SAFE_PATH, NO_COLOR: '1' },
      },
    );
    if (result.code !== 0 || result.truncated) return null;
    try {
      return JSON.parse(result.stdout);
    } catch {
      return null;
    }
  };
  return {
    read: (args, ttlMs = RESULT_CACHE_MS) => {
      if (!isKanbanReadCommand(args))
        return Promise.reject(new Error('Not a kanban read command.'));
      const key = args.join('\0');
      const hit = cache.get(key);
      if (hit && (hit.failedUntil === undefined ? now() - hit.at < ttlMs : now() < hit.failedUntil))
        return hit.value;
      // A stuck CLI must not let polls pile up behind it.
      if (pending >= MAX_PENDING_KANBAN_READS) return Promise.resolve(null);
      pending += 1;
      const step = (): Promise<unknown | null> =>
        spawnOnce(args)
          .catch(() => null)
          .finally(() => {
            pending -= 1;
          });
      const value = queue.then(step, step);
      queue = value;
      const entry: { at: number; value: Promise<unknown | null>; failedUntil?: number } = {
        at: now(),
        value,
      };
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      // A failure is shared only briefly, so an outage does not respawn the CLI on every poll.
      void value.then((parsed) => {
        if (parsed === null) entry.failedUntil = now() + FAILURE_CACHE_MS;
      });
      return value;
    },
  };
};

export type StripStatus = 'in_progress' | 'blocked';
export type StripPriority = 'low' | 'medium' | 'high' | 'critical';

export interface StripCard {
  title: string;
  status: StripStatus;
  priority: StripPriority | null;
  /** The claim holder, empty when unclaimed. */
  holder: string;
  /** The claim's lease ran out, or it never had one; the holder is likely gone. */
  claimStale: boolean;
  /** Tagged `approval` or titled "Approval: …". */
  approval: boolean;
}

export type KanbanStrip =
  | { state: 'ok'; project: string; cards: StripCard[]; total: number }
  | { state: 'unregistered'; project: string }
  /** The cwd is not inside ~/Repos/<project>, or does not exist; the answer never says which. */
  | { state: 'outside' }
  | { state: 'remote' };

const PRIORITIES: readonly StripPriority[] = ['low', 'medium', 'high', 'critical'];
const APPROVAL_TITLE = /^\s*approval\s*:/i;

/** In-progress and blocked rows from `item list`, reduced to what the strip shows. */
export const parseStripItems = (
  listing: unknown,
  nowMs: number,
): { cards: StripCard[]; total: number } | null => {
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return null;
  const lanes = listing as Record<string, unknown>;
  const cards: StripCard[] = [];
  for (const status of ['in_progress', 'blocked'] as const) {
    const rows = lanes[status] ?? [];
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const item = row as Record<string, unknown>;
      const title = cleanText(item.title, MAX_TITLE_CHARS);
      if (!title) continue;
      const holder = cleanText(item.claimedBy, MAX_HOLDER_CHARS);
      const expires = item.claimExpiresAt;
      const tags = Array.isArray(item.tags) ? item.tags : [];
      cards.push({
        title,
        status,
        priority: PRIORITIES.includes(item.priority as StripPriority)
          ? (item.priority as StripPriority)
          : null,
        holder,
        claimStale:
          holder !== '' &&
          !(typeof expires === 'number' && Number.isFinite(expires) && expires > nowMs),
        approval: tags.includes('approval') || APPROVAL_TITLE.test(title),
      });
    }
  }
  // Approval cards first; otherwise the CLI's lane order, in progress before blocked.
  const ordered = [
    ...cards.filter((card) => card.approval),
    ...cards.filter((card) => !card.approval),
  ];
  return { cards: ordered.slice(0, MAX_STRIP_CARDS), total: cards.length };
};

const isInside = (path: string, root: string): boolean =>
  path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

export interface KanbanStripFeedOptions {
  cli: KanbanCli;
  homeDir?: () => string;
  realpath?: (path: string) => Promise<string>;
  isDirectory?: (path: string) => Promise<boolean>;
  localHostname?: () => string;
  now?: () => number;
}

/** The `{cwd, host}` request a headset signs; anything else reads as no cwd. */
export const parseStripRequest = (request: string): { cwd: string; host: string | null } | null => {
  let value: unknown;
  try {
    value = JSON.parse(request);
  } catch {
    return null;
  }
  const { cwd, host } = (value ?? {}) as { cwd?: unknown; host?: unknown };
  if (typeof cwd !== 'string' || (host !== null && host !== undefined && typeof host !== 'string'))
    return null;
  return { cwd, host: typeof host === 'string' && host !== '' ? host : null };
};

/**
 * The focused pane's project: the first directory under realpath(~/Repos) that holds its cwd, so a
 * worktree inside a checkout maps to that checkout's project.
 */
export const createProjectResolver = (
  options: Pick<KanbanStripFeedOptions, 'homeDir' | 'realpath' | 'isDirectory'> = {},
): ((cwd: string) => Promise<string | null>) => {
  const homeDir = options.homeDir ?? homedir;
  const realpath = options.realpath ?? fsRealpath;
  const isDirectory =
    options.isDirectory ??
    (async (path: string) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    });
  return async (cwd) => {
    if (!validCwd(cwd)) return null;
    try {
      const repos = await realpath(join(homeDir(), 'Repos'));
      // realpath on a path such as /net/<host>/... can trigger an automount, so only paths that
      // already read as inside ~/Repos reach it.
      const lexical = resolve(cwd);
      if (!isInside(lexical, join(homeDir(), 'Repos')) && !isInside(lexical, repos)) return null;
      const real = await realpath(cwd);
      if (!isInside(real, repos)) return null;
      const project = real.slice(repos.length).split(sep).filter(Boolean)[0] ?? '';
      if (!PROJECT_NAME.test(project)) return null;
      return (await isDirectory(join(repos, project))) ? project : null;
    } catch {
      return null;
    }
  };
};

/** Loader for `/kanban-strip`: in-progress and blocked cards for the pane's ~/Repos project. */
export const createKanbanStripFeed = (
  options: KanbanStripFeedOptions,
): ((request: string) => Promise<KanbanStrip>) => {
  const resolveProject = createProjectResolver(options);
  const localHostname = options.localHostname ?? osHostname;
  const now = options.now ?? Date.now;
  const registered = async (project: string): Promise<boolean> => {
    const projects = await options.cli.read(['project', 'list'], PROJECTS_CACHE_MS);
    if (!Array.isArray(projects)) throw new FeedError('upstream');
    return projects.some(
      (row) => row && typeof row === 'object' && (row as { name?: unknown }).name === project,
    );
  };
  return async (request) => {
    const parsed = parseStripRequest(request);
    if (!parsed) return { state: 'outside' };
    if (!isLocalHost(parsed.host, localHostname())) return { state: 'remote' };
    const project = await resolveProject(parsed.cwd);
    if (!project) return { state: 'outside' };
    const listing = await options.cli.read([
      'item',
      'list',
      '--project',
      project,
      '--status',
      'in_progress,blocked',
    ]);
    if (listing === null) {
      // An unknown project fails exactly like an outage; the project list tells them apart.
      if (!(await registered(project))) return { state: 'unregistered', project };
      throw new FeedError('upstream');
    }
    const strip = parseStripItems(listing, now());
    if (!strip) throw new FeedError('upstream');
    return { state: 'ok', project, ...strip };
  };
};

export const BOOKINGS_PATH = '/bookings';
export const BOOKINGS_PROTOCOL = 'mux-xr-bookings-v1';
/** Bookings starting within this window are sent; the widget shows the next few hours. */
export const BOOKINGS_HORIZON_MS = 6 * 60 * 60_000;
const MAX_BOOKINGS = 60;
const MAX_HOSTS = 12;
const MAX_NAME_CHARS = 32;

export type BookingStatus = 'booked' | 'checked_in';
export type BookingState = 'current' | 'stale' | 'noshow' | 'upcoming';

export interface Booking {
  resource: string;
  holder: string;
  project: string;
  startAt: number;
  endAt: number;
  status: BookingStatus;
  /** The scheduler's timeline state, or null when it sent none. */
  state: BookingState | null;
  loadTolerance: 'tolerant' | 'sensitive';
}

export interface BookingsFeed {
  /** The streamer's clock, so the headset places the now marker against the same time. */
  now: number;
  /** Bookable hosts, by name. */
  hosts: string[];
  bookings: Booking[];
}

const BOOKING_STATES: readonly BookingState[] = ['current', 'stale', 'noshow', 'upcoming'];
const finiteTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Live bookings (booked or checked in) on bookable hosts that overlap now to now + horizon. */
export const parseBookings = (
  resources: unknown,
  lists: readonly unknown[],
  nowMs: number,
): BookingsFeed | null => {
  if (!Array.isArray(resources) || !lists.every(Array.isArray)) return null;
  const hosts = resources
    .filter(
      (row) => row && typeof row === 'object' && (row as { bookable?: unknown }).bookable === true,
    )
    .map((row) => cleanText((row as { name?: unknown }).name, MAX_NAME_CHARS))
    .filter((name) => name !== '')
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_HOSTS);
  const seen = new Set<string>();
  const bookings: Booking[] = [];
  for (const row of (lists as unknown[][]).flat()) {
    if (!row || typeof row !== 'object') continue;
    const value = row as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const resource = cleanText(value.resource, MAX_NAME_CHARS);
    if (value.status !== 'booked' && value.status !== 'checked_in') continue;
    if (!hosts.includes(resource) || !finiteTime(value.startAt) || !finiteTime(value.endAt))
      continue;
    // Swept rows can lag their end, so an ended window is dropped here too.
    if (value.endAt <= nowMs || value.startAt >= nowMs + BOOKINGS_HORIZON_MS) continue;
    if (value.endAt <= value.startAt) continue;
    bookings.push({
      resource,
      holder: cleanText(value.holder, MAX_HOLDER_CHARS),
      project: cleanText(value.project, MAX_NAME_CHARS),
      startAt: value.startAt,
      endAt: value.endAt,
      status: value.status,
      state: BOOKING_STATES.includes(value.state as BookingState)
        ? (value.state as BookingState)
        : null,
      loadTolerance: value.loadTolerance === 'tolerant' ? 'tolerant' : 'sensitive',
    });
  }
  bookings.sort((a, b) => a.startAt - b.startAt || a.resource.localeCompare(b.resource));
  return { now: nowMs, hosts, bookings: bookings.slice(0, MAX_BOOKINGS) };
};

/** Loader for `/bookings`: the scheduler's hosts and live bookings, through three CLI reads. */
export const createBookingsFeed = (options: {
  cli: KanbanCli;
  now?: () => number;
}): (() => Promise<BookingsFeed>) => {
  const now = options.now ?? Date.now;
  return async () => {
    const resources = await options.cli.read(['schedule', 'resource-list']);
    const booked = await options.cli.read([
      'schedule',
      'list',
      '--status',
      'booked',
      '--limit',
      '200',
    ]);
    const checkedIn = await options.cli.read([
      'schedule',
      'list',
      '--status',
      'checked_in',
      '--limit',
      '200',
    ]);
    const feed = parseBookings(resources, [booked, checkedIn], now());
    if (!feed) throw new FeedError('upstream');
    return feed;
  };
};
