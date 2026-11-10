// @vitest-environment happy-dom
import { create, type MessageInitShape, toBinary } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor } from '../src/contracts';
import {
  type AgentEntry,
  AgentEntrySchema,
  AgentRosterSchema,
  AgentStateChangedSchema,
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { agentRosterLayout, mountWorkspaceUI, validateSettings } from '../src/ui';
import {
  AGENT_ROWS_PRESETS,
  type AgentRosterLayout,
  type AgentRows,
  type AgentsSort,
  agentRosterRows,
  agentRowLines,
  agentRowsSignature,
  agentStateTone,
  agentTokenText,
  createAgentRosterStore,
  formatAge,
  formatAgentRows,
  normalizeAgentEntry,
  parseAgentRows,
  resolveAgentRows,
  sortAgentRows,
} from '../src/workspace/agent-roster';
import { connectHierarchy } from '../src/workspace/hierarchy';

const entry = (
  paneId: number,
  state: string,
  extra: MessageInitShape<typeof AgentEntrySchema> = {},
): AgentEntry =>
  create(AgentEntrySchema, {
    paneId,
    agent: 'claude',
    state,
    workspace: '+4',
    paneLabel: `label ${paneId}`,
    lastActivityAt: 1234n,
    ...extra,
  });

const pane = (id: string, workspaceName = 'default'): PaneDescriptor => ({
  id,
  workspaceId: '+4',
  workspaceName,
  sessionId: '$1',
  sessionName: 'main',
  windowId: '@1',
  windowName: 'win',
  title: `Pane ${id}`,
});

describe('agent roster model', () => {
  it('normalizes the wire entry to a tree pane id and plain numbers', () => {
    const normalized = normalizeAgentEntry(entry(228, 'done', { reason: 'r', stalled: true }));
    expect(normalized).toMatchObject({
      paneId: '%228',
      agent: 'claude',
      state: 'done',
      reason: 'r',
      workspace: '+4',
      stalled: true,
      lastActivityAt: 1234,
    });
    expect(() => JSON.stringify(normalized)).not.toThrow();
  });

  it('maps known states to tones and keeps unknown ones distinct', () => {
    expect(agentStateTone('question')).toBe('attention');
    expect(agentStateTone('Blocked')).toBe('attention');
    expect(agentStateTone('working')).toBe('working');
    expect(agentStateTone('idle')).toBe('idle');
    expect(agentStateTone('done')).toBe('done');
    expect(agentStateTone('compacting')).toBe('unknown');
  });

  it('replaces on snapshot, upserts and releases on deltas, and notifies only on change', () => {
    const store = createAgentRosterStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.replace([entry(1, 'idle'), entry(2, 'working')]);
    expect(store.entries().map((item) => item.paneId)).toEqual(['%1', '%2']);
    store.apply(entry(2, 'blocked', { reason: 'needs approval' }), false);
    expect(store.entries().find((item) => item.paneId === '%2')).toMatchObject({
      state: 'blocked',
      reason: 'needs approval',
    });
    store.apply(entry(3, 'working'), false);
    store.apply(create(AgentEntrySchema, { paneId: 1 }), true);
    expect(store.entries().map((item) => item.paneId)).toEqual(['%2', '%3']);
    const calls = listener.mock.calls.length;
    store.apply(create(AgentEntrySchema, { paneId: 99 }), true);
    store.apply(undefined, false);
    expect(listener).toHaveBeenCalledTimes(calls);
    store.replace([entry(7, 'blocked', { reason: 'approve deploy' })]);
    // Real deltas carry no reason: an unchanged state keeps it, a new state drops it.
    store.apply(entry(7, 'blocked', { stalled: true }), false);
    expect(store.entries()[0]).toMatchObject({ reason: 'approve deploy', stalled: true });
    store.apply(entry(7, 'working'), false);
    expect(store.entries()[0].reason).toBe('');
    expect(store.entries().map((item) => item.paneId)).toEqual(['%7']);
    store.clear();
    expect(store.entries()).toEqual([]);
  });

  it('joins rows to the tree in stable pane order and drops panes the tree no longer has', () => {
    const store = createAgentRosterStore();
    store.replace([
      entry(30, 'done'),
      entry(5, 'idle'),
      entry(12, 'question'),
      entry(8, 'working'),
      entry(40, 'blocked', { workspace: '+9' }),
    ]);
    const rows = agentRosterRows(store.entries(), [
      pane('%30'),
      pane('%5'),
      pane('%12', 'Research'),
      pane('%8'),
    ]);
    expect(rows.map((row) => row.paneId)).toEqual(['%5', '%8', '%12', '%30']);
    expect(rows[2]).toMatchObject({ workspaceName: 'Research', title: 'Pane %12' });
    const untitled = agentRosterRows(store.entries(), [
      { ...pane('%40', ''), workspaceName: '', title: '' },
    ]);
    expect(untitled).toEqual([
      expect.objectContaining({ paneId: '%40', workspaceName: '+9', title: 'label 40' }),
    ]);
  });

  it('changes the signature for shown tokens and aria fields, never for the clock alone', () => {
    const compact: AgentRosterLayout = { rows: AGENT_ROWS_PRESETS.compact, sort: 'pane' };
    const rows = agentRosterRows([normalizeAgentEntry(entry(1, 'idle'))], [pane('%1')]);
    const sig = (value: typeof rows, layout: AgentRosterLayout = compact) =>
      agentRowsSignature(value, layout);
    const quieter = agentRosterRows(
      [normalizeAgentEntry(entry(1, 'idle', { lastActivityAt: 99n, cpuMs: 5n }))],
      [pane('%1')],
    );
    expect(sig(quieter)).toBe(sig(rows));
    const changed = agentRosterRows([normalizeAgentEntry(entry(1, 'working'))], [pane('%1')]);
    expect(sig(changed)).not.toBe(sig(rows));
    // The row's aria-label reads the reason even when the layout hides it.
    const reasoned = agentRosterRows(
      [normalizeAgentEntry(entry(1, 'idle', { reason: 'why' }))],
      [pane('%1')],
    );
    expect(sig(reasoned)).not.toBe(sig(rows));
    const withCpu = { rows: [['agent', 'cpu']] as AgentRows, sort: 'pane' as const };
    expect(sig(quieter, withCpu)).not.toBe(sig(rows, withCpu));
    const withAge = { rows: [['agent', 'activity']] as AgentRows, sort: 'pane' as const };
    expect(sig(quieter, withAge)).not.toBe(sig(rows, withAge));
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
    const before = sig(rows, withAge);
    nowSpy.mockReturnValue(9_000_000);
    expect(sig(rows, withAge)).toBe(before);
    nowSpy.mockRestore();
  });

  it('carries every streamer field and the tree session and window', () => {
    const [row] = agentRosterRows(
      [
        normalizeAgentEntry(
          entry(4, 'working', {
            source: 'scrape',
            project: 'par-term',
            lastReportAt: 5n,
            lastInputAt: 6n,
            lastViewedAt: 7n,
            viewerCount: 2,
            cpuMs: 61_000n,
          }),
        ),
      ],
      [pane('%4')],
    );
    expect(row).toMatchObject({
      source: 'scrape',
      project: 'par-term',
      lastReportAt: 5,
      lastInputAt: 6,
      lastViewedAt: 7,
      viewerCount: 2,
      cpuMs: 61_000,
      sessionName: 'main',
      windowName: 'win',
    });
  });
});

describe('agent roster layout', () => {
  const now = 10_000_000;
  const row = (state: string, extra: MessageInitShape<typeof AgentEntrySchema> = {}) =>
    agentRosterRows([normalizeAgentEntry(entry(5, state, extra))], [pane('%5', 'Director')])[0];

  it('renders par-mux presets token for token, dropping empty tokens', () => {
    const blocked = row('blocked', { project: 'pardeck', reason: 'approve deploy' });
    expect(agentRowLines(blocked, AGENT_ROWS_PRESETS.default, now)).toEqual([
      '● · Director · pardeck',
      'claude',
    ]);
    expect(agentRowLines(blocked, AGENT_ROWS_PRESETS.compact, now)).toEqual(['● · claude']);
    expect(agentRowLines(blocked, AGENT_ROWS_PRESETS.detailed, now)).toEqual([
      '● · blocked · Director · pardeck',
      'claude · %5',
    ]);
    expect(agentRowLines(blocked, AGENT_ROWS_PRESETS.verbose, now)).toEqual([
      '● · blocked · claude',
      'approve deploy',
    ]);
    const quiet = row('idle');
    expect(agentRowLines(quiet, AGENT_ROWS_PRESETS.verbose, now)).toEqual(['○ · idle · claude']);
    expect(agentRowLines(row('working'), [['state_icon']], now)).toEqual(['◐']);
  });

  it('formats the extra tokens and coarse ages', () => {
    const busy = row('working', {
      stalled: true,
      source: 'hook',
      lastActivityAt: BigInt(now - 5 * 60_000),
      lastInputAt: BigInt(now - 3_000),
      viewerCount: 1,
      cpuMs: 1500n,
    });
    expect(agentTokenText(busy, 'state', now)).toBe('working (stalled)');
    expect(
      agentRowLines(
        busy,
        [
          ['title', 'session', 'window', 'source'],
          ['activity', 'input', 'viewers', 'cpu'],
        ],
        now,
      ),
    ).toEqual(['Pane %5 · main · win · hook', 'active 5m · input now · 1 viewer · cpu 1.5s']);
    expect(formatAge(0, now)).toBe('');
    expect(formatAge(now - 45_000, now)).toBe('45s');
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3h');
    expect(formatAge(now - 2 * 86_400_000, now)).toBe('2d');
  });

  it('parses custom rows, skipping unknown tokens, and falls back when none are known', () => {
    expect(parseAgentRows('state_icon, agent / project pane\nbogus, message')).toEqual({
      rows: [['state_icon', 'agent'], ['project', 'pane'], ['message']],
      unknown: ['bogus'],
    });
    expect(formatAgentRows([['state_icon', 'agent'], ['pane']])).toBe('state_icon, agent / pane');
    expect(resolveAgentRows('custom', 'nope')).toBe(AGENT_ROWS_PRESETS.full);
    expect(resolveAgentRows('custom', 'agent')).toEqual([['agent']]);
    expect(resolveAgentRows('compact', 'agent')).toBe(AGENT_ROWS_PRESETS.compact);
  });

  it('sorts by pane, grouped workspace and state, or priority', () => {
    const rows = agentRosterRows(
      [
        normalizeAgentEntry(entry(1, 'idle', { workspace: '+2' })),
        normalizeAgentEntry(entry(2, 'question', { workspace: '+9' })),
        normalizeAgentEntry(entry(3, 'working', { workspace: '+2' })),
        normalizeAgentEntry(entry(4, 'blocked', { workspace: '+2' })),
        normalizeAgentEntry(entry(5, 'done', { workspace: '' })),
      ],
      ['%1', '%2', '%3', '%4', '%5'].map((id) => pane(id)),
    );
    const ids = (sort: AgentsSort) => sortAgentRows(rows, sort).map((item) => item.paneId);
    expect(ids('pane')).toEqual(['%1', '%2', '%3', '%4', '%5']);
    expect(ids('grouped')).toEqual(['%4', '%3', '%1', '%2', '%5']);
    expect(ids('priority')).toEqual(['%2', '%4', '%5', '%3', '%1']);
  });

  it('keeps other saved settings when the roster fields are missing or invalid', () => {
    const old = validateSettings({ version: 1, endpoint: 'wss://x', uiSounds: false });
    expect(old).toMatchObject({
      endpoint: 'wss://x',
      uiSounds: false,
      agentRows: 'full',
      agentRowsCustom: '',
      agentsSort: 'pane',
    });
    const bad = validateSettings({ agentRows: 'huge', agentsSort: 'random', agentRowsCustom: 3 });
    expect(bad).toMatchObject({ agentRows: 'full', agentsSort: 'pane', agentRowsCustom: '' });
    const custom = validateSettings({
      agentRows: 'custom',
      agentRowsCustom: 'agent / pane',
      agentsSort: 'priority',
    });
    expect(agentRosterLayout(custom)).toEqual({ rows: [['agent'], ['pane']], sort: 'priority' });
  });
});

class MockSocket {
  static instances: MockSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = '';
  sent: ArrayBuffer[] = [];
  onopen?: () => void;
  onmessage?: (event: MessageEvent<ArrayBuffer>) => void;
  onerror?: () => void;
  onclose?: () => void;
  constructor(readonly url: string) {
    MockSocket.instances.push(this);
  }
  send(message: ArrayBuffer): void {
    this.sent.push(message);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  message(message: ServerMessage['message']): void {
    const payload = toBinary(ServerMessageSchema, create(ServerMessageSchema, { message }));
    const frame = new Uint8Array(payload.length + 1);
    frame.set(payload, 1);
    this.onmessage?.({ data: frame.buffer } as MessageEvent<ArrayBuffer>);
  }
}

describe('metadata socket roster routing', () => {
  const originalSocket = globalThis.WebSocket;
  beforeEach(() => {
    MockSocket.instances = [];
    (globalThis as Record<string, unknown>).WebSocket = MockSocket;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).WebSocket = originalSocket;
    vi.useRealTimers();
  });

  it('routes snapshots and deltas to the roster without satisfying the tree timeout', async () => {
    vi.useFakeTimers();
    const store = createAgentRosterStore();
    const errors: string[] = [];
    const connection = await connectHierarchy(
      'http://localhost:4241/',
      vi.fn(),
      (message) => errors.push(message),
      store,
    );
    const socket = MockSocket.instances[0];
    socket.message({
      case: 'agentRoster',
      value: create(AgentRosterSchema, { agents: [entry(1, 'idle'), entry(2, 'working')] }),
    });
    socket.message({
      case: 'agentStateChanged',
      value: create(AgentStateChangedSchema, { agent: entry(2, 'question') }),
    });
    socket.message({
      case: 'agentStateChanged',
      value: create(AgentStateChangedSchema, {
        agent: create(AgentEntrySchema, { paneId: 1 }),
        released: true,
      }),
    });
    expect(store.entries().map((item) => [item.paneId, item.state])).toEqual([['%2', 'question']]);
    vi.advanceTimersByTime(8000);
    expect(errors).toEqual(['No mux hierarchy received. Check the streamer version and endpoint.']);
    connection.disconnect();
  });

  it('keeps a tree-only connection working when no roster handler is given', async () => {
    const snapshots: number[] = [];
    const connection = await connectHierarchy(
      'http://localhost:4241/',
      (snapshot) => snapshots.push(snapshot.panes.length),
      vi.fn(),
    );
    const socket = MockSocket.instances[0];
    socket.message({ case: 'agentRoster', value: create(AgentRosterSchema, { agents: [] }) });
    socket.message({
      case: 'muxTreeSnapshot',
      value: create(MuxTreeSnapshotSchema, {
        workspaces: [
          create(MuxTreeWorkspaceSchema, {
            id: '+4',
            sessions: [
              create(MuxTreeSessionSchema, {
                id: '$1',
                windows: [
                  create(MuxTreeWindowSchema, {
                    id: '@1',
                    panes: [create(MuxTreePaneSchema, { id: '%2' })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    });
    expect(snapshots).toEqual([1]);
    connection.disconnect();
  });
});

describe('browser agent roster list', () => {
  const mount = () => {
    const root = document.createElement('div');
    const selected: string[] = [];
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSelectPane: (item) => selected.push(item.id),
    });
    return { root, ui, selected };
  };

  it('stays hidden until agents are reported', () => {
    const { root, ui } = mount();
    expect(root.querySelector<HTMLElement>('[data-agents-section]')?.hidden).toBe(true);
    ui.update({ panes: [pane('%2')] });
    ui.setAgentRoster(agentRosterRows([normalizeAgentEntry(entry(2, 'idle'))], [pane('%2')]));
    expect(root.querySelector<HTMLElement>('[data-agents-section]')?.hidden).toBe(false);
    expect(root.querySelector('[data-agent-count]')?.textContent).toBe('1');
    ui.setAgentRoster([]);
    expect(root.querySelector<HTMLElement>('[data-agents-section]')?.hidden).toBe(true);
  });

  it('shows pane, kind, state, workspace and escaped reason, and selects through the tree path', () => {
    const { root, ui, selected } = mount();
    const panes = [pane('%2', 'Director'), pane('%3')];
    ui.update({ panes });
    ui.setAgentRoster(
      agentRosterRows(
        [
          normalizeAgentEntry(entry(2, 'blocked', { reason: '<b>approve</b> deploy' })),
          normalizeAgentEntry(entry(3, 'working')),
          normalizeAgentEntry(entry(9, 'working')),
        ],
        panes,
      ),
    );
    const rows = [...root.querySelectorAll<HTMLButtonElement>('.agent-row')];
    expect(rows.map((row) => row.dataset.pane)).toEqual(['%2', '%3']);
    const blocked = rows[0];
    expect(blocked.dataset.agentTone).toBe('attention');
    const lines = [...blocked.querySelectorAll('.agent-lines > *')].map((line) => line.textContent);
    expect(lines).toEqual([
      '● · blocked · claude · Pane %2',
      'Director · %2',
      '<b>approve</b> deploy',
    ]);
    expect(blocked.querySelector('[data-token="message"]')?.textContent).toBe(
      '<b>approve</b> deploy',
    );
    expect(blocked.querySelector('[data-token="message"] b')).toBeNull();
    blocked.click();
    expect(selected).toEqual(['%2']);
    expect(root.querySelector('.agent-row.selected')?.getAttribute('data-pane')).toBe('%2');
    root.querySelector<HTMLButtonElement>('.agent-row[data-pane="%3"]')?.click();
    expect(selected).toEqual(['%2', '%3']);
  });

  it('updates rows in place without rebuilding the workspace tree', () => {
    const { root, ui } = mount();
    const panes = [pane('%2')];
    ui.update({ panes });
    const tree = root.querySelector('[data-tree]')?.firstElementChild;
    ui.setAgentRoster(agentRosterRows([normalizeAgentEntry(entry(2, 'working'))], panes));
    ui.setAgentRoster(
      agentRosterRows([normalizeAgentEntry(entry(2, 'done', { stalled: true }))], panes),
    );
    expect(root.querySelector('[data-tree]')?.firstElementChild).toBe(tree);
    expect(root.querySelector('[data-token="state"]')?.textContent).toBe('done (stalled)');
  });

  it('cycles the order from the header and switches layouts from settings', () => {
    localStorage.clear();
    const changes: string[] = [];
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSettingsChange: (value) => changes.push(`${value.agentRows}:${value.agentsSort}`),
    });
    const panes = [pane('%2')];
    ui.update({ panes });
    ui.setAgentRoster(
      agentRosterRows([normalizeAgentEntry(entry(2, 'idle', { project: 'kanban' }))], panes),
    );
    const sort = root.querySelector<HTMLButtonElement>('[data-action="agents-sort"]');
    expect(sort?.textContent).toBe('pane');
    sort?.click();
    expect(sort?.textContent).toBe('grouped');
    sort?.click();
    sort?.click();
    expect(sort?.textContent).toBe('pane');
    const select = root.querySelector<HTMLSelectElement>('[data-agent-rows]');
    const custom = root.querySelector<HTMLInputElement>('[data-agent-rows-custom]');
    if (!select || !custom) throw new Error('roster controls missing');
    select.value = 'compact';
    select.dispatchEvent(new Event('change'));
    expect(
      [...root.querySelectorAll('.agent-row .agent-lines > *')].map((line) => line.textContent),
    ).toEqual(['○ · claude']);
    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    custom.value = 'project, nonsense / pane';
    custom.dispatchEvent(new Event('change'));
    expect(
      [...root.querySelectorAll('.agent-row .agent-lines > *')].map((line) => line.textContent),
    ).toEqual(['kanban', '%2']);
    expect(root.querySelector('[data-agent-rows-hint]')?.textContent).toContain(
      'Unknown, skipped: nonsense',
    );
    expect(ui.getSettings()).toMatchObject({
      agentRows: 'custom',
      agentRowsCustom: 'project, nonsense / pane',
    });
    expect(changes).toContain('full:grouped');
    expect(changes.at(-1)).toBe('custom:pane');
    ui.destroy();
  });

  it('holds a reorder while hovered but applies in-place changes, resuming on leave or the timer', () => {
    vi.useFakeTimers();
    localStorage.clear();
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    const panes = [pane('%1'), pane('%2')];
    ui.update({ panes });
    const rows = (first: string, second: string) =>
      sortAgentRows(
        agentRosterRows(
          [normalizeAgentEntry(entry(1, first)), normalizeAgentEntry(entry(2, second))],
          panes,
        ),
        'priority',
      );
    const order = () =>
      [...root.querySelectorAll<HTMLElement>('.agent-row')].map((row) => row.dataset.pane);
    ui.setAgentRoster(rows('question', 'idle'));
    expect(order()).toEqual(['%1', '%2']);
    const list = root.querySelector<HTMLElement>('[data-agents]');
    if (!list) throw new Error('agent list missing');
    const hover = vi.spyOn(list, 'matches').mockImplementation((query) => query === ':hover');
    // Same order, new state: renders in place even while hovered.
    ui.setAgentRoster(rows('blocked', 'idle'));
    expect(root.querySelector('.agent-row[data-pane="%1"]')?.textContent).toContain('blocked');
    // A reorder waits for the pointer to leave.
    ui.setAgentRoster(rows('idle', 'question'));
    expect(order()).toEqual(['%1', '%2']);
    hover.mockReturnValue(false);
    list.dispatchEvent(new Event('pointerleave'));
    expect(order()).toEqual(['%2', '%1']);
    // Where pointerleave never fires (touch), the timer resumes the held reorder.
    hover.mockImplementation((query) => query === ':hover');
    ui.setAgentRoster(rows('question', 'idle'));
    expect(order()).toEqual(['%2', '%1']);
    hover.mockReturnValue(false);
    vi.advanceTimersByTime(15_000);
    expect(order()).toEqual(['%1', '%2']);
    ui.destroy();
    vi.useRealTimers();
  });
});
