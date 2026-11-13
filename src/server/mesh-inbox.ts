import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir, hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import { cleanText } from './board-feeds';
import { FeedError } from './feed-route';
import { createSpawnRunner, type RepoCommandRunner } from './repo-status-server';

export const MESH_INBOX_PATH = '/mesh-inbox';
export const MESH_INBOX_PROTOCOL = 'mux-xr-mesh-inbox-v1';
export const MESH_INBOX_LIMIT = 12;
const CLI_TIMEOUT_MS = 8_000;
const CLI_MAX_BYTES = 1024 * 1024;
const RESULT_CACHE_MS = 15_000;
const MAX_SUBJECT_CHARS = 80;
const MAX_ADDRESS_CHARS = 96;
const BUN_PATHS = ['/opt/homebrew/bin/bun', '/usr/local/bin/bun'];
const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin';
/** A par-mesh host label; anything else never reaches the CLI's argv. */
const HOST_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const STATES = new Set(['queued', 'delivered', 'acked', 'expired', 'failed']);

export type MeshPriority = 'interrupt' | 'next-turn';

/** Envelope fields only: par-mesh history carries no bodies, and ack notes are never forwarded. */
export interface MeshMessage {
  from: string;
  to: string;
  subject: string;
  priority: MeshPriority;
  ts: number;
  state: string;
  sealed: boolean;
}

export interface MeshInbox {
  /** The streamer's clock when it read the history, so the headset can age rows without skew. */
  now: number;
  host: string;
  messages: MeshMessage[];
}

/** This Mac's par-mesh host: the short hostname, lowercased (dev-workstation is `dev-workstation`). */
export const meshHostName = (hostname: string = osHostname()): string | null => {
  const short = hostname.split('.')[0]?.toLowerCase() ?? '';
  return HOST_NAME.test(short) ? short : null;
};

const address = (value: unknown): string => {
  const text = cleanText(value, MAX_ADDRESS_CHARS);
  return /\s/.test(text) ? '' : text;
};

/** Rebuilds `par-mesh history --format json` rows newest first, keeping only envelope fields. */
export const parseMeshHistory = (rows: unknown): MeshMessage[] | null => {
  if (!Array.isArray(rows)) return null;
  const messages: MeshMessage[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const from = address(row.from_addr);
    const to = address(row.to_addr) || address(row.target);
    const ts = typeof row.ts_ms === 'number' && Number.isFinite(row.ts_ms) ? row.ts_ms : null;
    if (!from || !to || ts === null) continue;
    const state = cleanText(row.state, 16);
    messages.push({
      from,
      to,
      subject: cleanText(row.subject, MAX_SUBJECT_CHARS),
      priority: row.priority === 'interrupt' ? 'interrupt' : 'next-turn',
      ts,
      state: STATES.has(state) ? state : '',
      sealed: row.sealed === true,
    });
  }
  return messages.sort((a, b) => b.ts - a.ts).slice(0, MESH_INBOX_LIMIT);
};

export interface MeshInboxFeedOptions {
  run?: RepoCommandRunner;
  homeDir?: () => string;
  findExecutable?: (candidates: readonly string[]) => Promise<string | null>;
  /** The par-mesh CLI script, run by bun; `~/.bun/bin/par-mesh` by default. */
  meshPath?: string;
  hostname?: () => string;
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
 * Loader for `/mesh-inbox`. It runs `bun ~/.bun/bin/par-mesh history --host <host> --limit 12
 * --format json` with a fixed argv, no shell and a minimal environment, and shares each answer
 * briefly so several headsets polling spawn it once.
 */
export const createMeshInboxFeed = (
  options: MeshInboxFeedOptions = {},
): (() => Promise<MeshInbox>) => {
  const run = options.run ?? createSpawnRunner();
  const homeDir = options.homeDir ?? homedir;
  const findExecutable = options.findExecutable ?? firstExecutable;
  const now = options.now ?? Date.now;
  let cached: { at: number; value: Promise<MeshInbox> } | null = null;

  const load = async (): Promise<MeshInbox> => {
    const host = meshHostName(options.hostname?.());
    if (!host) throw new FeedError('not_configured');
    const home = homeDir();
    const bun = await findExecutable([...BUN_PATHS, join(home, '.bun', 'bin', 'bun')]);
    if (!bun) throw new FeedError('not_configured');
    const result = await run(
      bun,
      [
        options.meshPath ?? join(home, '.bun', 'bin', 'par-mesh'),
        'history',
        '--host',
        host,
        '--limit',
        String(MESH_INBOX_LIMIT),
        '--format',
        'json',
      ],
      {
        cwd: '/',
        timeoutMs: CLI_TIMEOUT_MS,
        maxBytes: CLI_MAX_BYTES,
        env: { HOME: home, PATH: SAFE_PATH, NO_COLOR: '1' },
      },
    ).catch(() => null);
    if (result?.code !== 0 || result.truncated) throw new FeedError('upstream');
    let rows: unknown;
    try {
      rows = JSON.parse(result.stdout);
    } catch {
      throw new FeedError('upstream');
    }
    const messages = parseMeshHistory(rows);
    if (!messages) throw new FeedError('upstream');
    return { now: now(), host, messages };
  };

  return () => {
    if (cached && now() - cached.at < RESULT_CACHE_MS) return cached.value;
    const value = load();
    const entry = { at: now(), value };
    cached = entry;
    // A failure is not worth sharing for the whole window; the next poll asks again.
    value.catch(() => {
      if (cached === entry) cached = null;
    });
    return value;
  };
};
