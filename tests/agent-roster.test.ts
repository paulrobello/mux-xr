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
import { mountWorkspaceUI } from '../src/ui';
import {
  agentRosterRows,
  agentRowsSignature,
  agentStateTone,
  createAgentRosterStore,
  normalizeAgentEntry,
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

  it('changes the signature only when a visible field changes', () => {
    const rows = agentRosterRows([normalizeAgentEntry(entry(1, 'idle'))], [pane('%1')]);
    const quieter = agentRosterRows(
      [normalizeAgentEntry(entry(1, 'idle', { lastActivityAt: 99n, cpuMs: 5n }))],
      [pane('%1')],
    );
    const changed = agentRosterRows([normalizeAgentEntry(entry(1, 'working'))], [pane('%1')]);
    expect(agentRowsSignature(quieter)).toBe(agentRowsSignature(rows));
    expect(agentRowsSignature(changed)).not.toBe(agentRowsSignature(rows));
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
    expect(blocked.textContent).toContain('blocked');
    expect(blocked.textContent).toContain('claude');
    expect(blocked.textContent).toContain('%2 · Director');
    expect(blocked.querySelector('.agent-reason')?.textContent).toBe('<b>approve</b> deploy');
    expect(blocked.querySelector('.agent-reason b')).toBeNull();
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
    expect(root.querySelector('.agent-state')?.textContent).toBe('done · stalled');
  });
});
