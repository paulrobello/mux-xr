import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paneWebSocketURL } from '../src/terminal/surface';
import {
  ClientMessageSchema,
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { connectHierarchy, hierarchyURL, normalizeTree } from '../src/workspace/hierarchy';

class MockSocket {
  static instances: MockSocket[] = [];
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  readyState = MockSocket.CONNECTING;
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
  open(): void {
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  message(message: ArrayBuffer): void {
    this.onmessage?.({ data: message } as MessageEvent<ArrayBuffer>);
  }
}

function serverFrame(tree: ReturnType<typeof create<typeof MuxTreeSnapshotSchema>>): ArrayBuffer {
  const payload = toBinary(
    ServerMessageSchema,
    create(ServerMessageSchema, { message: { case: 'muxTreeSnapshot', value: tree } }),
  );
  const frame = new Uint8Array(payload.length + 1);
  frame.set(payload, 1);
  return frame.buffer;
}

beforeEach(() => {
  MockSocket.instances = [];
  (globalThis as Record<string, unknown>).WebSocket = MockSocket;
  (globalThis as Record<string, unknown>).location = {
    origin: 'http://localhost:4241',
    protocol: 'http:',
    href: 'http://localhost:4241/',
  };
  (globalThis as Record<string, unknown>).window = { location: globalThis.location };
});

describe('workspace metadata connection', () => {
  it('uses the metadata-only selector without accidentally pinning a pane', () => {
    const url = new URL(hierarchyURL('http://localhost:4241/ws?session=pane-3'));
    expect(url.protocol).toBe('ws:');
    expect(url.searchParams.get('metadata')).toBe('1');
    expect(url.searchParams.has('session')).toBe(false);
    const pane = new URL(paneWebSocketURL(url.toString(), '%3'));
    expect(pane.searchParams.get('session')).toBe('pane-3');
    expect(pane.searchParams.has('metadata')).toBe(false);
  });

  it('preserves all hierarchy identities and applies full replacement snapshots', () => {
    const tree = create(MuxTreeSnapshotSchema, {
      workspaces: [
        create(MuxTreeWorkspaceSchema, {
          id: '+1',
          name: 'Work',
          sessions: [
            create(MuxTreeSessionSchema, {
              id: '$2',
              name: 'Dev',
              windows: [
                create(MuxTreeWindowSchema, {
                  id: '@3',
                  name: 'Build',
                  panes: [
                    create(MuxTreePaneSchema, { id: '%4', title: 'Shell', cols: 100, rows: 30 }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(normalizeTree(tree).panes[0]).toEqual({
      id: '%4',
      title: 'Shell',
      workspaceId: '+1',
      workspaceName: 'Work',
      sessionId: '$2',
      sessionName: 'Dev',
      windowId: '@3',
      windowName: 'Build',
      cols: 100,
      rows: 30,
      active: false,
      windowActive: false,
    });
    expect(normalizeTree(create(MuxTreeSnapshotSchema)).panes).toEqual([]);
  });

  it('requests fresh snapshots after reconnect and replaces the prior structure', async () => {
    vi.useFakeTimers();
    const snapshots: string[][] = [];
    const connection = await connectHierarchy(
      'http://localhost:4241/ws?session=pane-3',
      (snapshot) => snapshots.push(snapshot.panes.map((pane) => pane.id)),
      vi.fn(),
    );
    const first = MockSocket.instances[0];
    first.open();
    expect(
      fromBinary(ClientMessageSchema, new Uint8Array(first.sent[0]).slice(1)).message.case,
    ).toBe('muxTreeRequest');
    first.message(
      serverFrame(
        create(MuxTreeSnapshotSchema, {
          workspaces: [
            create(MuxTreeWorkspaceSchema, {
              id: 'w',
              sessions: [
                create(MuxTreeSessionSchema, {
                  id: 's',
                  windows: [
                    create(MuxTreeWindowSchema, {
                      id: 'win',
                      panes: [create(MuxTreePaneSchema, { id: 'old' })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    first.close();
    vi.advanceTimersByTime(1000);
    const second = MockSocket.instances[1];
    second.open();
    second.message(
      serverFrame(
        create(MuxTreeSnapshotSchema, {
          workspaces: [
            create(MuxTreeWorkspaceSchema, {
              id: 'w2',
              sessions: [
                create(MuxTreeSessionSchema, {
                  id: 's2',
                  windows: [
                    create(MuxTreeWindowSchema, {
                      id: 'win2',
                      panes: [create(MuxTreePaneSchema, { id: 'new' })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    expect(snapshots).toEqual([['old'], ['new']]);
    connection.disconnect();
    vi.useRealTimers();
  });

  it('keeps retrying beyond the old attempt limit and recovers later', async () => {
    vi.useFakeTimers();
    const snapshots: string[][] = [];
    const connection = await connectHierarchy(
      'http://localhost:4241/ws',
      (snapshot) => snapshots.push(snapshot.panes.map((pane) => pane.id)),
      vi.fn(),
    );
    let current = MockSocket.instances[0];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      current.close();
      vi.advanceTimersByTime(10000);
      const latest = MockSocket.instances.at(-1);
      if (!latest) throw new Error('Reconnect did not create a new socket');
      current = latest;
    }
    expect(MockSocket.instances.length).toBe(9);
    current.open();
    current.message(
      serverFrame(
        create(MuxTreeSnapshotSchema, {
          workspaces: [
            create(MuxTreeWorkspaceSchema, {
              id: 'recovered',
              sessions: [
                create(MuxTreeSessionSchema, {
                  id: 's',
                  windows: [
                    create(MuxTreeWindowSchema, {
                      id: 'w',
                      panes: [create(MuxTreePaneSchema, { id: 'recovered-pane' })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    );
    expect(snapshots).toEqual([['recovered-pane']]);
    connection.disconnect();
    vi.useRealTimers();
  });

  it('disconnect suppresses retries and metadata mode sends no pane input or resize', async () => {
    vi.useFakeTimers();
    const connection = await connectHierarchy(
      'http://localhost:4241/ws?session=pane-3',
      vi.fn(),
      vi.fn(),
    );
    const socket = MockSocket.instances[0];
    socket.open();
    const request = fromBinary(ClientMessageSchema, new Uint8Array(socket.sent[0]).slice(1));
    expect(request.message.case).toBe('muxTreeRequest');
    expect(socket.url).toContain('metadata=1');
    expect(socket.url).not.toContain('session=');
    connection.disconnect();
    vi.advanceTimersByTime(60000);
    expect(MockSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
