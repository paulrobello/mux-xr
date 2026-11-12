export type PaneProcessState = 'running' | 'exited';

export interface PaneProcess {
  readonly state: PaneProcessState;
  /** Present only while exited, and only when the daemon could read the status. */
  readonly exitCode?: number;
}

export const RUNNING_PROCESS: PaneProcess = Object.freeze({ state: 'running' });

/** Only "" (a pre-lifecycle producer) and "running" mean running; any other unknown state is null so the caller keeps its last known state. */
export function parsePaneProcess(state: string, exitCode?: number): PaneProcess | null {
  if (state === '' || state === 'running') return RUNNING_PROCESS;
  if (state !== 'exited') return null;
  return exitCode === undefined ? { state: 'exited' } : { state: 'exited', exitCode };
}

/** `%3`, `pane-3` and `3` name the same pane. */
export function samePaneId(a: string, b: string): boolean {
  const key = (id: string): string => /^(?:pane-|%)?(\d+)$/.exec(id)?.[1] ?? id;
  return key(a) === key(b);
}

/** Stream statuses where the stream itself already says the pane ended or failed. */
const TERMINAL_STATUSES = new Set(['exited', 'closed', 'error']);

export function sameProcess(a: PaneProcess, b: PaneProcess): boolean {
  return a.state === b.state && a.exitCode === b.exitCode;
}

/** The held-pane badge, kept apart from stream connectivity. Null while the process runs. */
export function processBadge(process: PaneProcess | undefined, status?: string): string | null {
  if (process?.state !== 'exited') return null;
  if (status !== undefined && TERMINAL_STATUSES.has(status)) return null;
  return process.exitCode === undefined ? 'Exited' : `Exited (code ${process.exitCode})`;
}

/** Heading text: title, stream connectivity, then the process badge, then any error. */
export function paneHeading(
  title: string,
  status: string,
  process: PaneProcess | undefined,
  error: string | null,
  errorLimit: number,
): string {
  const badge = processBadge(process, status);
  return [title, status, badge, error ? error.slice(0, errorLimit) : null]
    .filter((part) => part !== null)
    .join(' · ');
}
