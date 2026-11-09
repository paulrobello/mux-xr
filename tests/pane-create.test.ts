import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor } from '../src/contracts';
import {
  ClientMessageSchema,
  ConnectedSchema,
  ErrorSchema,
  PaneCreatedSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import {
  createPaneCreator,
  describePaneCreateOutcome,
  type PaneCreateOutcome,
  type PaneCreateSocket,
  requestPaneCreate,
} from '../src/workspace/pane-create';

class MockSocket implements PaneCreateSocket {
  binaryType = 'blob';
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  sent: ArrayBuffer[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  receive(message: Parameters<typeof create<typeof ServerMessageSchema>>[1]): void {
    const payload = toBinary(ServerMessageSchema, create(ServerMessageSchema, message));
    const frame = new Uint8Array(payload.length + 1);
    frame.set(payload, 1);
    this.onmessage?.({ data: frame.buffer });
  }
  connected(readonly = false): void {
    this.receive({
      message: {
        case: 'connected',
        value: create(ConnectedSchema, { cols: 80, rows: 24, readonly }),
      },
    });
  }
  decodedSent() {
    return this.sent.map((data) =>
      fromBinary(ClientMessageSchema, new Uint8Array(data).subarray(1)),
    );
  }
}

function harness() {
  const sockets: MockSocket[] = [];
  const socketFactory = (url: string) => {
    const socket = new MockSocket(url);
    sockets.push(socket);
    return socket;
  };
  return { sockets, socketFactory };
}

const pane = (id: string, sessionId = '$1', active = false): PaneDescriptor => ({
  id,
  workspaceId: 'w',
  workspaceName: 'Work',
  sessionId,
  sessionName: `session ${sessionId}`,
  windowId: `@${id}`,
  windowName: 'win',
  title: id,
  active,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('requestPaneCreate', () => {
  it('sends one correlated request on a writable pane stream and resolves the reply', async () => {
    const { sockets, socketFactory } = harness();
    const promise = requestPaneCreate('wss://host:4240/ws', '%3', '$1', {
      correlationId: 'c-1',
      socketFactory,
    });
    const socket = sockets[0];
    expect(new URL(socket.url).searchParams.get('session')).toBe('pane-3');
    expect(new URL(socket.url).searchParams.has('metadata')).toBe(false);
    expect(socket.sent).toHaveLength(0);
    socket.connected();
    const sent = socket.decodedSent();
    expect(sent).toHaveLength(1);
    expect(sent[0].message.case).toBe('paneCreateRequest');
    expect(sent[0].message.value).toMatchObject({ correlationId: 'c-1', sessionId: '$1' });
    socket.receive({
      message: {
        case: 'paneCreated',
        value: create(PaneCreatedSchema, {
          correlationId: 'other',
          sessionId: '$1',
          windowId: '@8',
          paneId: '%8',
        }),
      },
    });
    socket.receive({
      message: {
        case: 'paneCreated',
        value: create(PaneCreatedSchema, {
          correlationId: 'c-1',
          sessionId: '$1',
          windowId: '@9',
          paneId: '%9',
        }),
      },
    });
    await expect(promise).resolves.toEqual({
      kind: 'created',
      correlationId: 'c-1',
      sessionId: '$1',
      windowId: '@9',
      paneId: '%9',
    });
    expect(socket.closed).toBe(true);
    expect(socket.decodedSent().map((message) => message.message.case)).toEqual([
      'paneCreateRequest',
    ]);
  });

  it.each([
    ['pane_create_disabled', 'disabled'],
    ['pane_create_read_only', 'read_only'],
    ['pane_create_no_daemon', 'no_daemon'],
    ['pane_create_failed', 'failed'],
    ['pane_create_unknown', 'error'],
  ])('maps refusal %s to %s', async (code, reason) => {
    const { sockets, socketFactory } = harness();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', { socketFactory });
    sockets[0].connected();
    sockets[0].receive({
      message: { case: 'error', value: create(ErrorSchema, { message: 'no', code }) },
    });
    await expect(promise).resolves.toMatchObject({ kind: 'refused', reason, code });
    expect(sockets[0].closed).toBe(true);
  });

  it('ignores errors without a creation code after sending', async () => {
    const { sockets, socketFactory } = harness();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', {
      correlationId: 'c-2',
      socketFactory,
    });
    sockets[0].connected();
    sockets[0].receive({
      message: { case: 'error', value: create(ErrorSchema, { message: 'pane ended', code: 'x' }) },
    });
    expect(sockets[0].closed).toBe(false);
    sockets[0].receive({
      message: {
        case: 'paneCreated',
        value: create(PaneCreatedSchema, {
          correlationId: 'c-2',
          sessionId: '$1',
          windowId: '@4',
          paneId: '%4',
        }),
      },
    });
    await expect(promise).resolves.toMatchObject({ kind: 'created', paneId: '%4' });
  });

  it('never sends on a read-only connection', async () => {
    const { sockets, socketFactory } = harness();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', { socketFactory });
    sockets[0].connected(true);
    await expect(promise).resolves.toMatchObject({ kind: 'refused', reason: 'read_only' });
    expect(sockets[0].sent).toHaveLength(0);
  });

  it('reports an unreachable streamer as certain when nothing was sent', async () => {
    const { sockets, socketFactory } = harness();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', { socketFactory, timeoutMs: 50 });
    sockets[0].onclose?.({});
    await expect(promise).resolves.toMatchObject({ kind: 'refused', reason: 'unreachable' });
    const second = harness();
    const timed = requestPaneCreate('ws://h/ws', '%1', '$1', {
      socketFactory: second.socketFactory,
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(60);
    await expect(timed).resolves.toMatchObject({ kind: 'refused', reason: 'unreachable' });
    expect(second.sockets[0].sent).toHaveLength(0);
  });

  it('resolves uncertain after a silent old streamer and matches a late reply', async () => {
    const { sockets, socketFactory } = harness();
    const late = vi.fn();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', {
      correlationId: 'c-late',
      socketFactory,
      timeoutMs: 100,
      lateGraceMs: 1000,
      onLateReply: late,
    });
    sockets[0].connected();
    await vi.advanceTimersByTimeAsync(120);
    await expect(promise).resolves.toEqual({
      kind: 'uncertain',
      correlationId: 'c-late',
      cause: 'timeout',
    });
    expect(sockets[0].closed).toBe(false);
    sockets[0].receive({
      message: {
        case: 'paneCreated',
        value: create(PaneCreatedSchema, {
          correlationId: 'c-late',
          sessionId: '$1',
          windowId: '@4',
          paneId: '%4',
        }),
      },
    });
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ paneId: '%4' }));
    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toHaveLength(1);
  });

  it('closes the late listener after the grace window', async () => {
    const { sockets, socketFactory } = harness();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', {
      socketFactory,
      timeoutMs: 100,
      lateGraceMs: 200,
    });
    sockets[0].connected();
    await vi.advanceTimersByTimeAsync(110);
    await promise;
    await vi.advanceTimersByTimeAsync(210);
    expect(sockets[0].closed).toBe(true);
  });

  it('resolves uncertain when the stream closes after sending', async () => {
    const { sockets, socketFactory } = harness();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', { socketFactory });
    sockets[0].connected();
    sockets[0].onclose?.({});
    await expect(promise).resolves.toMatchObject({ kind: 'uncertain', cause: 'closed' });
  });
});

describe('requestPaneCreate cancellation', () => {
  it('closes the stream when aborted before sending', async () => {
    const { sockets, socketFactory } = harness();
    const controller = new AbortController();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', {
      socketFactory,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).resolves.toMatchObject({ kind: 'refused', reason: 'unreachable' });
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].sent).toHaveLength(0);
  });

  it('closes a late listener when aborted', async () => {
    const { sockets, socketFactory } = harness();
    const controller = new AbortController();
    const late = vi.fn();
    const promise = requestPaneCreate('ws://h/ws', '%1', '$1', {
      socketFactory,
      timeoutMs: 50,
      signal: controller.signal,
      onLateReply: late,
    });
    sockets[0].connected();
    await vi.advanceTimersByTimeAsync(60);
    await expect(promise).resolves.toMatchObject({ kind: 'uncertain' });
    controller.abort();
    expect(sockets[0].closed).toBe(true);
    expect(late).not.toHaveBeenCalled();
  });
});

describe('createPaneCreator', () => {
  function creator(results: PaneCreateOutcome[]) {
    const request = vi.fn(
      async (_anchor: string, _session: string, _token: number, _signal: AbortSignal) =>
        results.shift() ??
        ({ kind: 'uncertain', correlationId: 'x', cause: 'timeout' } as PaneCreateOutcome),
    );
    const deps = {
      request,
      refreshTree: vi.fn(),
      attach: vi.fn(),
      notify: vi.fn(),
      onChange: vi.fn(),
      attachTimeoutMs: 500,
      confirmMs: 400,
      lateConfirmMs: 1200,
    };
    return { deps, creator: createPaneCreator(deps) };
  }
  const created = (paneId: string): Extract<PaneCreateOutcome, { kind: 'created' }> => ({
    kind: 'created',
    correlationId: 'c',
    sessionId: '$1',
    windowId: '@9',
    paneId,
  });

  it('anchors on the active pane in the chosen session and attaches once the pane appears', async () => {
    const { deps, creator: subject } = creator([created('%9')]);
    const panes = [pane('%1', '$1'), pane('%2', '$1', true), pane('%3', '$2', true)];
    expect(subject.create('$1', panes)).toBe(true);
    expect(deps.request).toHaveBeenCalledWith('%2', '$1', 1, expect.any(AbortSignal));
    expect(subject.create('$1', panes)).toBe(false);
    expect(deps.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.refreshTree).toHaveBeenCalledTimes(1);
    expect(subject.state.pending).toBe(true);
    expect(deps.attach).not.toHaveBeenCalled();
    subject.observeSnapshot([...panes, pane('%9', '$1')]);
    expect(deps.attach).toHaveBeenCalledWith('%9');
    expect(deps.attach).toHaveBeenCalledTimes(1);
    expect(subject.state).toEqual({ available: true, pending: false });
  });

  it('reports a created pane that never appears without retrying', async () => {
    const { deps, creator: subject } = creator([created('%9')]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(600);
    expect(deps.attach).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenLastCalledWith(expect.stringContaining('has not appeared'));
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(subject.state.pending).toBe(false);
  });

  it.each(['disabled', 'read_only', 'no_daemon'] as const)(
    'disables creation after a %s refusal',
    async (reason) => {
      const { deps, creator: subject } = creator([{ kind: 'refused', reason, message: 'no' }]);
      subject.create('$1', [pane('%1')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(subject.state.available).toBe(false);
      expect(subject.state.reason).toBeTruthy();
      expect(subject.create('$1', [pane('%1')])).toBe(false);
      expect(deps.request).toHaveBeenCalledTimes(1);
      expect(deps.refreshTree).not.toHaveBeenCalled();
      subject.reset();
      expect(subject.state.available).toBe(true);
    },
  );

  it.each([
    ['failed', 'pane_create_failed'],
    ['error', 'unexpected_code'],
  ] as const)('confirms a %s refusal before allowing another request', async (reason, code) => {
    const { deps, creator: subject } = creator([
      { kind: 'refused', reason, code, message: 'boom' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.state.pending).toBe(true);
    expect(deps.refreshTree).toHaveBeenCalledTimes(1);
    expect(subject.create('$1', [pane('%1')])).toBe(false);
    subject.observeSnapshot([pane('%1')]);
    expect(subject.state.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(deps.refreshTree).toHaveBeenCalledTimes(2);
    expect(subject.state).toEqual({ available: true, pending: false });
    expect(deps.notify).toHaveBeenLastCalledWith(expect.stringContaining('No new terminal'));
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('surfaces a window created despite pane_create_failed without opening it', async () => {
    const { deps, creator: subject } = creator([
      { kind: 'refused', reason: 'failed', code: 'pane_create_failed', message: 'list-panes' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    subject.observeSnapshot([pane('%1'), pane('%6')]);
    expect(deps.attach).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenLastCalledWith(expect.stringContaining('%6'));
    expect(subject.state).toEqual({ available: true, pending: false });
  });

  it('waits for later snapshots before declaring an uncertain request empty', async () => {
    const { deps, creator: subject } = creator([
      { kind: 'uncertain', correlationId: 'c', cause: 'timeout' },
    ]);
    const panes = [pane('%1')];
    subject.create('$1', panes);
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.create('$1', panes)).toBe(false);
    subject.observeSnapshot(panes);
    expect(subject.state.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    subject.observeSnapshot([...panes, pane('%8')]);
    expect(deps.notify).toHaveBeenLastCalledWith(expect.stringContaining('%8'));
    expect(subject.state).toEqual({ available: true, pending: false });
    expect(deps.attach).not.toHaveBeenCalled();
  });

  it('disables creation when an uncertain request leaves no pane', async () => {
    const { deps, creator: subject } = creator([
      { kind: 'uncertain', correlationId: 'c', cause: 'closed' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    subject.observeSnapshot([pane('%1')]);
    await vi.advanceTimersByTimeAsync(400);
    expect(subject.state.available).toBe(false);
    expect(subject.state.reason).toContain('0.77.0');
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('keeps confirming a timed-out request through the late-reply grace', async () => {
    const { deps, creator: subject } = creator([
      { kind: 'uncertain', correlationId: 'c', cause: 'timeout' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    subject.observeSnapshot([pane('%1')]);
    await vi.advanceTimersByTimeAsync(800);
    expect(subject.state.pending).toBe(true);
    expect(deps.refreshTree.mock.calls.length).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(subject.state.available).toBe(false);
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('aborts a timed-out request that is still listening on reconnect', async () => {
    const { deps, creator: subject } = creator([
      { kind: 'uncertain', correlationId: 'c', cause: 'timeout' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    const signal = deps.request.mock.calls[0][3];
    expect(signal.aborted).toBe(false);
    subject.reset();
    expect(signal.aborted).toBe(true);
  });

  it('treats a rejected request as unreachable', async () => {
    const { deps, creator: subject } = creator([]);
    deps.request.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.state).toEqual({ available: true, pending: false });
    expect(deps.notify).toHaveBeenLastCalledWith(expect.stringContaining('boom'));
  });

  it('attaches a pane from a late correlated reply while confirming', async () => {
    const { deps, creator: subject } = creator([
      { kind: 'uncertain', correlationId: 'c', cause: 'timeout' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    subject.lateReply(created('%5'), 1);
    subject.observeSnapshot([pane('%1'), pane('%5')]);
    expect(deps.attach).toHaveBeenCalledWith('%5');
    await vi.advanceTimersByTimeAsync(400);
    expect(subject.state).toEqual({ available: true, pending: false });
  });

  it('ignores a late reply from an older request while a newer one is pending', async () => {
    let resolveSecond: (outcome: PaneCreateOutcome) => void = () => undefined;
    const { deps, creator: subject } = creator([
      { kind: 'uncertain', correlationId: 'a', cause: 'timeout' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    subject.observeSnapshot([pane('%1'), pane('%4')]);
    expect(subject.state.pending).toBe(false);
    deps.request.mockImplementationOnce(
      () => new Promise<PaneCreateOutcome>((resolve) => (resolveSecond = resolve)),
    );
    subject.create('$1', [pane('%1'), pane('%4')]);
    subject.lateReply(created('%4'), 1);
    expect(subject.state.pending).toBe(true);
    expect(deps.attach).not.toHaveBeenCalled();
    expect(subject.create('$1', [pane('%1'), pane('%4')])).toBe(false);
    resolveSecond(created('%7'));
    await vi.advanceTimersByTimeAsync(0);
    subject.observeSnapshot([pane('%1'), pane('%4'), pane('%7')]);
    expect(deps.attach).toHaveBeenCalledWith('%7');
    expect(deps.attach).not.toHaveBeenCalledWith('%4');
  });

  it('does not reopen a pane already surfaced by confirmation', async () => {
    const { deps, creator: subject } = creator([
      { kind: 'uncertain', correlationId: 'c', cause: 'timeout' },
    ]);
    subject.create('$1', [pane('%1')]);
    await vi.advanceTimersByTimeAsync(0);
    subject.observeSnapshot([pane('%1'), pane('%4')]);
    subject.lateReply(created('%4'), 1);
    expect(deps.attach).not.toHaveBeenCalled();
  });

  it('refuses a session with no known pane without sending', () => {
    const { deps, creator: subject } = creator([]);
    expect(subject.create('$9', [pane('%1')])).toBe(false);
    expect(deps.request).not.toHaveBeenCalled();
  });

  it('aborts and ignores the in-flight request on reconnect', async () => {
    const { deps, creator: subject } = creator([created('%9')]);
    subject.create('$1', [pane('%1')]);
    const signal = deps.request.mock.calls[0][3];
    subject.reset();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.refreshTree).not.toHaveBeenCalled();
    expect(subject.state).toEqual({ available: true, pending: false });
  });

  it('describes each refusal distinctly', () => {
    const texts = (
      ['disabled', 'read_only', 'no_daemon', 'failed', 'unreachable', 'error'] as const
    ).map((reason) => describePaneCreateOutcome({ kind: 'refused', reason, message: 'm' }));
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[0]).toContain('--allow-pane-create');
  });
});
