/** One authenticated git and CI status query per connection to the dictation server's `/repo-status`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';
import { hostServiceUrl } from './host-service';

const PROTOCOL = 'mux-xr-repo-status-v1';
const DEFAULT_TIMEOUT_MS = 15_000;

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
  return (cwd, host) => {
    if (CONTROL_CHARS.test(cwd) || (host !== null && CONTROL_CHARS.test(host)))
      return Promise.resolve({ ok: false, code: 'unavailable' });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return openPairedSocket<RepoStatusReport, RepoStatusFailure>({
      url: options.url(),
      secret,
      protocol: PROTOCOL,
      material: `${host ?? ''}\n${cwd}`,
      authFields: { cwd, host },
      timeoutMs,
      onTimeout: () => 'timeout',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onOpenError: () => 'unavailable',
      onServerError: (code) => SERVER_CODES[String(code)] ?? 'unavailable',
      onClose: () => 'unavailable',
      onMessage: (message) => {
        const frame = message as { type?: unknown; status?: unknown };
        if (frame.type !== 'status') return { ok: false, code: 'unavailable' };
        const report = parseRepoStatusReport(frame.status);
        return report ? { ok: true, value: report } : { ok: false, code: 'unavailable' };
      },
    }).then((outcome) => (outcome.ok ? { ok: true, report: outcome.value } : outcome));
  };
}

/** The production client: the host service port on the page's host, paired by the host clipboard secret. */
export function createDefaultRepoStatusFetcher(): RepoStatusFetcher {
  const secret = createHostClipboardSecretStore();
  return createRepoStatusClient({
    url: () => hostServiceUrl('/repo-status', window.location),
    secret: () => secret.get(),
  });
}
