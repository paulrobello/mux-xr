/** One authenticated git and CI status query per connection to the dictation server's `/repo-status`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';

const PROTOCOL = 'mux-xr-repo-status-v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;

/** Newlines would split the signed text; the server refuses any control character too. */
const CONTROL_CHARS = /\p{Cc}/u;

export type RepoCiState = 'success' | 'failure' | 'in_progress' | 'unknown';

export interface RepoCi {
  state: RepoCiState;
  conclusion: string | null;
  status: string | null;
  workflow: string | null;
  createdAt: string | null;
}

export type RepoStatusReport =
  | {
      state: 'ok';
      repo: string;
      branch: string | null;
      detached: boolean;
      upstream: boolean;
      ahead: number;
      behind: number;
      /** Staged changes or untracked files; null when git could not tell. */
      dirty: boolean | null;
      ci: RepoCi | null;
    }
  | { state: 'not-a-repo' }
  | { state: 'remote' }
  | { state: 'unavailable' };

export type RepoStatusFailure =
  | 'no-secret'
  | 'disabled'
  | 'auth'
  | 'rate-limited'
  | 'unavailable'
  | 'timeout';

export type RepoStatusResult =
  | { ok: true; report: RepoStatusReport }
  | { ok: false; code: RepoStatusFailure };

/** `host` is the OSC 7 hostname, null when the shell sent none. */
export type RepoStatusFetcher = (cwd: string, host: string | null) => Promise<RepoStatusResult>;

export interface RepoStatusClientOptions {
  url: () => string;
  secret: () => string | null;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  timeoutMs?: number;
}

const SERVER_CODES: Record<string, RepoStatusFailure> = {
  disabled: 'disabled',
  auth: 'auth',
  rate_limited: 'rate-limited',
};

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const CI_STATES: readonly RepoCiState[] = ['success', 'failure', 'in_progress', 'unknown'];

/** Rebuilds the server's report field by field, so nothing unexpected reaches the scene. */
export function parseRepoStatusReport(value: unknown): RepoStatusReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Record<string, unknown>;
  if (report.state === 'not-a-repo' || report.state === 'unavailable' || report.state === 'remote')
    return { state: report.state };
  if (report.state !== 'ok' || typeof report.repo !== 'string') return null;
  const ci = report.ci as Record<string, unknown> | null | undefined;
  return {
    state: 'ok',
    repo: report.repo,
    branch: text(report.branch),
    detached: report.detached === true,
    upstream: report.upstream === true,
    ahead: count(report.ahead),
    behind: count(report.behind),
    dirty: typeof report.dirty === 'boolean' ? report.dirty : null,
    ci:
      ci && typeof ci === 'object'
        ? {
            state: CI_STATES.includes(ci.state as RepoCiState)
              ? (ci.state as RepoCiState)
              : 'unknown',
            conclusion: text(ci.conclusion),
            status: text(ci.status),
            workflow: text(ci.workflow),
            createdAt: text(ci.createdAt),
          }
        : null,
  };
}

export function createRepoStatusClient(options: RepoStatusClientOptions): RepoStatusFetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  return (cwd, host) => {
    if (CONTROL_CHARS.test(cwd) || (host !== null && CONTROL_CHARS.test(host)))
      return Promise.resolve({ ok: false, code: 'unavailable' });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return new Promise((resolve) => {
      let settled = false;
      let challenged = false;
      let socket: HostClipboardSocket | undefined;
      const finish = (result: RepoStatusResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket?.close(1000, 'done');
        } catch {
          /* Already closed. */
        }
        resolve(result);
      };
      const failure = (code: RepoStatusFailure): void => finish({ ok: false, code });
      const timer = setTimeout(() => failure('timeout'), timeoutMs);
      try {
        socket = factory(options.url());
      } catch {
        failure('unavailable');
        return;
      }
      const active = socket;
      active.onerror = () => undefined;
      active.onclose = () => failure('unavailable');
      active.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          failure('unavailable');
          return;
        }
        let message: { type?: unknown; code?: unknown; nonce?: unknown; status?: unknown };
        try {
          message = JSON.parse(event.data);
        } catch {
          failure('unavailable');
          return;
        }
        if (message.type === 'error') {
          failure(SERVER_CODES[String(message.code)] ?? 'unavailable');
        } else if (message.type === 'challenge') {
          if (
            challenged ||
            typeof message.nonce !== 'string' ||
            !NONCE_FORMAT.test(message.nonce)
          ) {
            failure('unavailable');
            return;
          }
          challenged = true;
          const nonce = message.nonce;
          void (async () => {
            try {
              const key = await crypto.importKey(
                'raw',
                new TextEncoder().encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign'],
              );
              const mac = await crypto.sign(
                'HMAC',
                key,
                new TextEncoder().encode(`${PROTOCOL}\n${nonce}\n${host ?? ''}\n${cwd}`),
              );
              if (!settled)
                active.send(JSON.stringify({ type: 'auth', cwd, host, mac: base64(mac) }));
            } catch {
              failure('unavailable');
            }
          })();
        } else if (message.type === 'status') {
          const report = parseRepoStatusReport(message.status);
          if (report) finish({ ok: true, report });
          else failure('unavailable');
        } else failure('unavailable');
      };
    });
  };
}

/** The production client: port 4242 on the page's host, paired by the host clipboard secret. */
export function createDefaultRepoStatusFetcher(): RepoStatusFetcher {
  const secret = createHostClipboardSecretStore();
  return createRepoStatusClient({
    url: () => {
      const url = new URL('/repo-status', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.port = '4242';
      url.search = '';
      url.hash = '';
      return url.href;
    },
    secret: () => secret.get(),
  });
}
