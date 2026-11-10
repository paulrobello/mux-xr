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
  /** Provenance as reported: `hook`, `scrape` or `self`. */
  source: string;
  stalled: boolean;
  /** Unix ms stamps as of the streamer's last full roster fetch; 0 means absent. */
  lastActivityAt: number;
  lastReportAt: number;
  lastInputAt: number;
  lastViewedAt: number;
  viewerCount: number;
  cpuMs: number;
}

/** A roster entry joined against the current mux tree. */
export interface AgentRosterRow extends AgentRosterEntry {
  /** Tree workspace name, else the raw workspace id. */
  workspaceName: string;
  /** Pane title from the tree, else the roster label, else the pane id. */
  title: string;
  sessionName: string;
  windowName: string;
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
    source: entry.source,
    stalled: entry.stalled,
    lastActivityAt: Number(entry.lastActivityAt),
    lastReportAt: Number(entry.lastReportAt),
    lastInputAt: Number(entry.lastInputAt),
    lastViewedAt: Number(entry.lastViewedAt),
    viewerCount: entry.viewerCount,
    cpuMs: Number(entry.cpuMs),
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
          sessionName: pane.sessionName,
          windowName: pane.windowName,
        },
      ];
    })
    .sort((left, right) => paneNumber(left.paneId) - paneNumber(right.paneId));
}

/**
 * What the rows show under a layout at `now`; equal signatures render identically, so a
 * stamp that no shown token reads never triggers a re-render.
 */
export function agentRowsSignature(
  rows: readonly AgentRosterRow[],
  layout: AgentRosterLayout = DEFAULT_AGENT_ROSTER_LAYOUT,
): string {
  // Ages tick with the clock, so they stay out; the browser refreshes them on its own timer.
  return rows
    .map((row) =>
      [
        row.paneId,
        agentStateTone(row.state),
        row.agent,
        row.state,
        row.stalled,
        row.title,
        row.reason,
        row.workspaceName,
        row.project,
        ...agentRowLines(row, layout.rows, 0, AGE_TOKENS),
        layout.rows.some((line) => line.some((token) => AGE_TOKENS.has(token)))
          ? `${row.lastActivityAt}:${row.lastInputAt}`
          : '',
      ].join('\u0001'),
    )
    .join('\u0000');
}

/**
 * Entry tokens: par-mux's `[client] agent-rows` vocabulary first, then mux-xr extras.
 * Time and presence tokens are as of the streamer's last full roster fetch, because
 * core state deltas carry the previous values forward.
 */
export const AGENT_TOKENS = [
  'state_icon',
  'state',
  'workspace',
  'project',
  'message',
  'agent',
  'pane',
  'title',
  'session',
  'window',
  'source',
  'activity',
  'input',
  'viewers',
  'cpu',
] as const;
export type AgentToken = (typeof AGENT_TOKENS)[number];
export type AgentRows = readonly (readonly AgentToken[])[];

/** mux-xr's `full` layout, then par-mux's named `agent-rows` layouts token for token. */
export const AGENT_ROWS_PRESETS = {
  full: [['state_icon', 'state', 'agent', 'title'], ['workspace', 'project', 'pane'], ['message']],
  default: [['state_icon', 'workspace', 'project'], ['agent']],
  compact: [['state_icon', 'agent']],
  detailed: [
    ['state_icon', 'state', 'workspace', 'project'],
    ['agent', 'pane'],
  ],
  verbose: [['state_icon', 'state', 'agent'], ['message']],
} as const satisfies Record<string, AgentRows>;
export type AgentRowsPreset = keyof typeof AGENT_ROWS_PRESETS;
export type AgentRowsChoice = AgentRowsPreset | 'custom';
export const AGENT_ROWS_CHOICES: readonly AgentRowsChoice[] = [
  'full',
  'default',
  'compact',
  'detailed',
  'verbose',
  'custom',
];

/** `pane` keeps rows still under a pointer; `grouped` and `priority` are par-mux's orders. */
export type AgentsSort = 'pane' | 'grouped' | 'priority';
export const AGENTS_SORTS: readonly AgentsSort[] = ['pane', 'grouped', 'priority'];

export interface AgentRosterLayout {
  rows: AgentRows;
  sort: AgentsSort;
}

export const DEFAULT_AGENT_ROSTER_LAYOUT: AgentRosterLayout = {
  rows: AGENT_ROWS_PRESETS.full,
  sort: 'pane',
};

const TOKEN_SET: ReadonlySet<string> = new Set(AGENT_TOKENS);

function isAgentToken(token: string): token is AgentToken {
  return TOKEN_SET.has(token);
}

/** Parse custom rows: lines split on `/` or newlines, tokens on commas or spaces. */
export function parseAgentRows(text: string): { rows: AgentToken[][]; unknown: string[] } {
  const unknown: string[] = [];
  const rows: AgentToken[][] = [];
  for (const line of text.split(/[/\n]/)) {
    const tokens: AgentToken[] = [];
    for (const token of line.split(/[\s,]+/)) {
      if (!token) continue;
      if (isAgentToken(token)) tokens.push(token);
      else unknown.push(token);
    }
    if (tokens.length) rows.push(tokens);
  }
  return { rows, unknown };
}

export function formatAgentRows(rows: AgentRows): string {
  return rows.map((line) => line.join(', ')).join(' / ');
}

/** The rows a settings choice resolves to; custom rows with no known token use the default. */
export function resolveAgentRows(choice: AgentRowsChoice, custom: string): AgentRows {
  if (choice !== 'custom') return AGENT_ROWS_PRESETS[choice];
  const { rows } = parseAgentRows(custom);
  return rows.length ? rows : AGENT_ROWS_PRESETS.full;
}

const STATE_ICONS: Record<AgentStateTone, string> = {
  attention: '●',
  working: '◐',
  done: '●',
  idle: '○',
  unknown: '·',
};

export function agentStateIcon(state: string): string {
  return STATE_ICONS[agentStateTone(state)];
}

/** Coarse age (`now`, `42s`, `5m`, `3h`, `2d`); empty for an absent stamp. */
export function formatAge(at: number, now: number): string {
  if (!at) return '';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatCpu(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return `cpu ${ms}ms`;
  if (ms < 60_000) return `cpu ${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `cpu ${Math.floor(ms / 60_000)}m`;
  return `cpu ${(ms / 3_600_000).toFixed(1)}h`;
}

/** A token's text for one row; empty when the row has nothing to show for it. */
export function agentTokenText(row: AgentRosterRow, token: AgentToken, now: number): string {
  switch (token) {
    case 'state_icon':
      return agentStateIcon(row.state);
    case 'state':
      return row.stalled ? `${row.state} (stalled)` : row.state;
    case 'workspace':
      return row.workspaceName;
    case 'project':
      return row.project;
    case 'message':
      return row.reason;
    case 'agent':
      return row.agent;
    case 'pane':
      return row.paneId;
    case 'title':
      return row.title;
    case 'session':
      return row.sessionName;
    case 'window':
      return row.windowName;
    case 'source':
      return row.source;
    case 'activity': {
      const age = formatAge(row.lastActivityAt, now);
      return age ? `active ${age}` : '';
    }
    case 'input': {
      const age = formatAge(row.lastInputAt, now);
      return age ? `input ${age}` : '';
    }
    case 'viewers':
      return row.viewerCount ? `${row.viewerCount} viewer${row.viewerCount === 1 ? '' : 's'}` : '';
    case 'cpu':
      return formatCpu(row.cpuMs);
  }
}

/** Tokens whose text changes with the clock alone. */
export const AGE_TOKENS: ReadonlySet<AgentToken> = new Set<AgentToken>(['activity', 'input']);

export interface AgentLinePart {
  token: AgentToken;
  text: string;
}

/** Each layout line's non-empty parts; a line with nothing to show drops out. */
export function agentRowParts(
  row: AgentRosterRow,
  rows: AgentRows,
  now: number,
  skip: ReadonlySet<AgentToken> = new Set(),
): AgentLinePart[][] {
  return rows
    .map((line) =>
      line
        .filter((token) => !skip.has(token))
        .map((token) => ({ token, text: agentTokenText(row, token, now) }))
        .filter((part) => part.text),
    )
    .filter((line) => line.length > 0);
}

/** Each layout line joined with ` · `, par-mux's entry form. */
export function agentRowLines(
  row: AgentRosterRow,
  rows: AgentRows,
  now: number,
  skip?: ReadonlySet<AgentToken>,
): string[] {
  return agentRowParts(row, rows, now, skip).map((line) =>
    line.map((part) => part.text).join(' · '),
  );
}

const STATE_PRIORITY: Record<string, number> = {
  question: 0,
  blocked: 1,
  done: 2,
  working: 3,
  idle: 4,
};

function statePriority(state: string): number {
  return STATE_PRIORITY[state.toLowerCase()] ?? 5;
}

function workspaceNumber(id: string): number {
  const value = Number.parseInt(id.replace(/^\+/, ''), 10);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

/**
 * Order rows. `grouped` keeps workspaces in id order with agents by state priority;
 * `priority` puts the most urgent state first. Both break ties by pane id, and unknown
 * workspaces trail, as in par-mux.
 */
export function sortAgentRows(rows: readonly AgentRosterRow[], sort: AgentsSort): AgentRosterRow[] {
  const byPane = (left: AgentRosterRow, right: AgentRosterRow): number =>
    paneNumber(left.paneId) - paneNumber(right.paneId);
  const byWorkspace = (left: AgentRosterRow, right: AgentRosterRow): number =>
    workspaceNumber(left.workspace) - workspaceNumber(right.workspace);
  const byState = (left: AgentRosterRow, right: AgentRosterRow): number =>
    statePriority(left.state) - statePriority(right.state);
  const sorted = [...rows];
  if (sort === 'grouped')
    sorted.sort(
      (left, right) => byWorkspace(left, right) || byState(left, right) || byPane(left, right),
    );
  else if (sort === 'priority')
    sorted.sort(
      (left, right) => byState(left, right) || byWorkspace(left, right) || byPane(left, right),
    );
  else sorted.sort(byPane);
  return sorted;
}
