import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import type { HostFeedResult, HostFeedSource } from '../src/host-feed';
import {
  createMeshInboxFeed,
  MESH_INBOX_PROTOCOL,
  meshHostName,
  parseMeshHistory,
} from '../src/server/mesh-inbox';
import type { RepoCommandRunner } from '../src/server/repo-status-server';
import type { AgentRosterRow } from '../src/workspace/agent-roster';
import {
  createMeshInboxWidget,
  MESH_INBOX_POLL_MS,
  type MeshInbox,
  meshInboxView,
  parseMeshInbox,
  recipientPane,
} from '../src/xr/mesh-inbox';
import {
  clientRequest,
  requestFeed,
  startFeedServer,
  stopFeedServers,
} from './helpers/feed-socket';

afterEach(stopFeedServers);

const NOW = Date.UTC(2026, 10, 12, 5, 40);
const MIN = 60_000;

const historyRow = (overrides: Record<string, unknown>) => ({
  msgid: 'm_test',
  from_addr: 'claude-b50c@workstation:par-rt-db',
  to_addr: 'director-2@workstation:par-director',
  target: 'director-2@workstation:par-director',
  host: 'workstation',
  priority: 'next-turn',
  subject: 'deploy notice',
  ts_ms: NOW - 3 * MIN,
  state: 'acked',
  delivered_ms: NOW - 3 * MIN,
  acked_ms: NOW - 2 * MIN,
  ack_note: 'private ack note text',
  sealed: false,
  senderAuthed: true,
  ...overrides,
});
const HISTORY = [
  historyRow({}),
  historyRow({
    from_addr: 'director-2@workstation:par-director',
    to_addr: 'claude-9294@workstation:par-mesh',
    priority: 'interrupt',
    subject: 'stop\u001b[31m now\u0000 please',
    ts_ms: NOW - MIN,
  }),
  historyRow({ from_addr: '', subject: 'no sender' }),
];

const runnerFor = (stdout: string, code = 0) => {
  const calls: Array<{ file: string; args: readonly string[]; env: Record<string, string> }> = [];
  const run: RepoCommandRunner = async (file, args, options) => {
    calls.push({ file, args, env: options.env });
    return { code, stdout, truncated: false };
  };
  return { calls, run };
};
const feedFor = (stdout: string, code = 0, now: () => number = () => NOW) => {
  const runner = runnerFor(stdout, code);
  const feed = createMeshInboxFeed({
    run: runner.run,
    homeDir: () => '/Users/test',
    findExecutable: async (candidates) => candidates[0] ?? null,
    hostname: () => 'workstation.local',
    now,
  });
  return { ...runner, feed };
};

describe('mesh inbox feed', () => {
  it('runs par-mesh history for this host with a fixed argv and a bare environment', async () => {
    const { calls, feed } = feedFor(JSON.stringify(HISTORY));
    const inbox = await feed();
    expect(calls).toEqual([
      {
        file: '/opt/homebrew/bin/bun',
        args: [
          '/Users/test/.bun/bin/par-mesh',
          'history',
          '--host',
          'workstation',
          '--limit',
          '12',
          '--format',
          'json',
        ],
        env: {
          HOME: '/Users/test',
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin',
          NO_COLOR: '1',
        },
      },
    ]);
    expect(inbox.host).toBe('workstation');
    expect(inbox.now).toBe(NOW);
    expect(meshHostName('bad host!')).toBeNull();
  });

  it('keeps envelopes only, newest first, with control characters stripped and no ack notes', () => {
    const messages = parseMeshHistory(HISTORY);
    expect(messages).toEqual([
      {
        from: 'director-2@workstation:par-director',
        to: 'claude-9294@workstation:par-mesh',
        subject: 'stop [31m now please',
        priority: 'interrupt',
        ts: NOW - MIN,
        state: 'acked',
        sealed: false,
      },
      {
        from: 'claude-b50c@workstation:par-rt-db',
        to: 'director-2@workstation:par-director',
        subject: 'deploy notice',
        priority: 'next-turn',
        ts: NOW - 3 * MIN,
        state: 'acked',
        sealed: false,
      },
    ]);
    expect(JSON.stringify(messages)).not.toContain('private ack note');
    expect(parseMeshHistory({ rows: [] })).toBeNull();
    expect(parseMeshHistory([historyRow({ subject: 'x'.repeat(500) })])?.[0]?.subject).toHaveLength(
      80,
    );
  });

  it('answers upstream when par-mesh fails or prints something else, and shares an answer briefly', async () => {
    await expect(feedFor('', 1).feed()).rejects.toMatchObject({ code: 'upstream' });
    await expect(feedFor('not json').feed()).rejects.toMatchObject({ code: 'upstream' });
    let now = NOW;
    const { calls, feed } = feedFor(JSON.stringify(HISTORY), 0, () => now);
    await feed();
    now += 10_000;
    await feed();
    expect(calls).toHaveLength(1);
    now += 6_000;
    await feed();
    expect(calls).toHaveLength(2);
  });

  it('serves /mesh-inbox behind --mesh-inbox and the secret proof', async () => {
    const { run } = runnerFor(JSON.stringify(HISTORY));
    const options = {
      run,
      homeDir: () => '/Users/test',
      findExecutable: async (candidates: readonly string[]) => candidates[0] ?? null,
      hostname: () => 'workstation',
    };
    const on = await startFeedServer({ meshInbox: { enabled: true, ...options } });
    const { reply } = await requestFeed(`${on.base}/mesh-inbox`, MESH_INBOX_PROTOCOL, '{}');
    expect(reply).toMatchObject({ type: 'feed', data: { host: 'workstation' } });
    expect(JSON.stringify(reply)).not.toContain('private ack note');
    expect(JSON.stringify(reply)).not.toContain('msgid');
    const parsed = await clientRequest(
      `${on.base}/mesh-inbox`,
      MESH_INBOX_PROTOCOL,
      (data) => parseMeshInbox(data, NOW),
      '{}',
    );
    expect(parsed.ok && parsed.value.messages).toHaveLength(2);
    const off = await startFeedServer({ meshInbox: { enabled: false, ...options } });
    expect(
      await clientRequest(`${off.base}/mesh-inbox`, MESH_INBOX_PROTOCOL, parseMeshInbox, '{}'),
    ).toEqual({ ok: false, code: 'disabled' });
    const unwired = await startFeedServer({});
    expect(
      await clientRequest(`${unwired.base}/mesh-inbox`, MESH_INBOX_PROTOCOL, parseMeshInbox, '{}'),
    ).toEqual({ ok: false, code: 'disabled' });
  });
});

const rosterRow = (paneId: string, agent: string, project: string): AgentRosterRow => ({
  paneId,
  agent,
  state: 'working',
  reason: '',
  workspace: '+1',
  project,
  paneLabel: '',
  source: 'hook',
  stalled: false,
  lastActivityAt: NOW,
  lastReportAt: NOW,
  lastInputAt: NOW,
  lastViewedAt: NOW,
  viewerCount: 0,
  cpuMs: 0,
  workspaceName: 'main',
  title: project,
  sessionName: 's',
  windowName: 'w',
});
const ROSTER = [
  rosterRow('%10', 'claude', 'par-mesh'),
  rosterRow('%20', 'claude', 'par-director'),
  rosterRow('%21', 'omp', 'par-director'),
  rosterRow('%30', 'claude', 'kanban'),
  rosterRow('%31', 'claude', 'kanban'),
];

const serverAnswer = {
  now: NOW,
  host: 'workstation',
  messages: parseMeshHistory(HISTORY),
};

describe('mesh inbox view', () => {
  it('maps a recipient to its pane only when the roster names exactly one', () => {
    expect(recipientPane('claude-9294@workstation:par-mesh', 'workstation', ROSTER)).toBe('%10');
    expect(recipientPane('omp-1fac@workstation:par-director', 'workstation', ROSTER)).toBe('%21');
    expect(recipientPane('director-2@workstation:par-director', 'workstation', ROSTER)).toBeNull();
    expect(recipientPane('claude-1@workstation:kanban', 'workstation', ROSTER)).toBeNull();
    expect(recipientPane('claude-9294@test-mac:par-mesh', 'workstation', ROSTER)).toBeNull();
    expect(recipientPane('*@workstation:par-mesh', 'workstation', ROSTER)).toBeNull();
  });

  it('lists sender, recipient, subject, priority and age, newest first', () => {
    const inbox = parseMeshInbox(serverAnswer, NOW) as MeshInbox;
    const view = meshInboxView({ kind: 'inbox', inbox }, NOW + MIN, ROSTER);
    expect(view.header).toBe('Mesh inbox · workstation');
    expect(
      view.rows.map((row) => [
        row.route,
        row.subject,
        row.priority,
        row.interrupt,
        row.age,
        row.paneId,
      ]),
    ).toEqual([
      ['director-2 → claude-9294', 'stop [31m now please', 'int', true, '2m', '%10'],
      ['claude-b50c → director-2', 'deploy notice', 'next', false, '4m', null],
    ]);
    expect(meshInboxView({ kind: 'failed', code: 'disabled' }, NOW).message).toBe(
      'Mesh inbox is off on the host',
    );
    expect(meshInboxView({ kind: 'failed', code: 'unavailable' }, NOW).message).toBe(
      'Host service unreachable (port 4242)',
    );
    expect(meshInboxView({ kind: 'inbox', inbox: { ...inbox, messages: [] } }, NOW).message).toBe(
      'No recent messages',
    );
  });
});

describe('mesh inbox widget', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  };

  it('highlights interrupts, focuses a mapped recipient on a pinch, and polls every 30 s', async () => {
    const calls: Array<(result: HostFeedResult<MeshInbox>) => void> = [];
    const source: HostFeedSource<MeshInbox> = () =>
      new Promise((resolve) => {
        calls.push(resolve);
      });
    const widget = createMeshInboxWidget(null, {
      source,
      retryStore: memory,
      firstPollDelayMs: 0,
      now: () => NOW,
    });
    new THREE.Scene().add(widget.root);
    widget.setAgentRoster?.(ROSTER);
    widget.update(NOW);
    expect(calls).toHaveLength(1);
    calls[0]?.({ ok: true, value: parseMeshInbox(serverAnswer, NOW) as MeshInbox });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const part = (name: string) => widget.root.getObjectByName(name);
    expect(part('mesh-inbox-row-1-accent')?.visible).toBe(true);
    expect(part('mesh-inbox-row-1-tint')?.visible).toBe(true);
    expect(part('mesh-inbox-row-2-accent')?.visible).toBe(false);
    expect(part('mesh-inbox-row-3-route')?.visible).toBe(false);
    expect(part('mesh-inbox-row-1-subject')?.userData).toMatchObject({
      inputAction: 'selectAgentPane',
      agentPaneId: '%10',
      labelText: 'stop [31m now please',
    });
    expect(part('mesh-inbox-row-2-subject')?.userData.inputAction).toBe('grabWidget');
    expect(part('mesh-inbox-row-2-subject')?.userData.agentPaneId).toBeUndefined();
    widget.setAgentRoster?.([]);
    expect(part('mesh-inbox-row-1-subject')?.userData.inputAction).toBe('grabWidget');
    widget.update(NOW + MESH_INBOX_POLL_MS - 1);
    expect(calls).toHaveLength(1);
    widget.update(NOW + MESH_INBOX_POLL_MS);
    expect(calls).toHaveLength(2);
    widget.dispose();
    widget.update(NOW + 10 * MESH_INBOX_POLL_MS);
    expect(calls).toHaveLength(2);
  });
});
