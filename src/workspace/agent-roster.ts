import type { PaneDescriptor } from '../contracts';
import type { AgentEntry } from '../terminal/vendor/terminal_pb';

/** One par-mux roster entry, normalized for the UI (bigint stamps become numbers). */
export interface AgentRosterEntry {
  /** Tree pane id (`%N`), the id every selection path uses. */
  paneId: string;
  agent: string;
  /** par-mux state string, kept verbatim so unknown states still render. */
  state: string;
  reason: string;
  /** Raw par-mux workspace id (`+N`), "" when unknown. */
  workspace: string;
  project: string;
  paneLabel: string;
  stalled: boolean;
  lastActivityAt: number;
}

/** A roster entry joined against the current mux tree. */
export interface AgentRosterRow extends AgentRosterEntry {
  /** Tree workspace name, else the raw workspace id. */
  workspaceName: string;
  /** Pane title from the tree, else the roster label, else the pane id. */
  title: string;
}

export type AgentStateTone = 'attention' | 'working' | 'idle' | 'done' | 'unknown';

const TONES: Record<string, AgentStateTone> = {
  question: 'attention',
  blocked: 'attention',
  working: 'working',
  idle: 'idle',
  done: 'done',
};

export function agentStateTone(state: string): AgentStateTone {
  return TONES[state.toLowerCase()] ?? 'unknown';
}

export function normalizeAgentEntry(entry: AgentEntry): AgentRosterEntry {
  return {
    paneId: `%${entry.paneId}`,
    agent: entry.agent,
    state: entry.state,
    reason: entry.reason,
    workspace: entry.workspace,
    project: entry.project,
    paneLabel: entry.paneLabel,
    stalled: entry.stalled,
    lastActivityAt: Number(entry.lastActivityAt),
  };
}

export interface AgentRosterStore {
  /** Replace the roster with a full snapshot (sent on every connect and after lag). */
  replace(entries: readonly AgentEntry[]): void;
  /** Apply one delta: upsert, or remove when `released`. */
  apply(entry: AgentEntry | undefined, released: boolean): void;
  clear(): void;
  entries(): AgentRosterEntry[];
  subscribe(listener: () => void): () => void;
}

export function createAgentRosterStore(): AgentRosterStore {
  const roster = new Map<string, AgentRosterEntry>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    replace(entries) {
      roster.clear();
      for (const entry of entries) {
        const normalized = normalizeAgentEntry(entry);
        roster.set(normalized.paneId, normalized);
      }
      emit();
    },
    apply(entry, released) {
      if (!entry) return;
      const paneId = `%${entry.paneId}`;
      if (released) {
        if (!roster.delete(paneId)) return;
      } else {
        const next = normalizeAgentEntry(entry);
        const previous = roster.get(paneId);
        // Core deltas never carry the reason; an unchanged state keeps the snapshot's.
        if (!next.reason && previous?.state === next.state) next.reason = previous.reason;
        roster.set(paneId, next);
      }
      emit();
    },
    clear() {
      if (!roster.size) return;
      roster.clear();
      emit();
    },
    entries: () => [...roster.values()],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function paneNumber(id: string): number {
  const value = Number.parseInt(id.replace(/^%/, ''), 10);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

/**
 * Join roster entries with the tree, ordered by pane id so rows never move under a pointer.
 * The tree is authoritative for pane existence: the streamer's roster cache can keep a
 * closed pane, so entries without a tree pane are dropped.
 */
export function agentRosterRows(
  entries: readonly AgentRosterEntry[],
  panes: readonly PaneDescriptor[],
): AgentRosterRow[] {
  const byId = new Map(panes.map((pane) => [pane.id, pane]));
  return entries
    .flatMap((entry): AgentRosterRow[] => {
      const pane = byId.get(entry.paneId);
      if (!pane) return [];
      return [
        {
          ...entry,
          workspaceName: pane.workspaceName || entry.workspace,
          title: pane.title || entry.paneLabel || entry.paneId,
        },
      ];
    })
    .sort((left, right) => paneNumber(left.paneId) - paneNumber(right.paneId));
}

/** What a row shows; two rows with equal signatures render identically. */
export function agentRowsSignature(rows: readonly AgentRosterRow[]): string {
  return rows
    .map((row) =>
      [
        row.paneId,
        row.agent,
        row.state,
        row.reason,
        row.stalled,
        row.workspaceName,
        row.title,
      ].join('\u0001'),
    )
    .join('\u0000');
}
