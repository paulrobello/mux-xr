import { create, toBinary } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectedSchema,
  OutputSchema,
  PaneProcessStateSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';

function cell(): Record<string, unknown> {
  return {
    getWidth: () => 1,
    getChars: () => '',
    isInverse: () => 0,
    isFgRGB: () => false,
    isFgPalette: () => false,
    getFgColor: () => 0,
    isBgRGB: () => false,
    isBgPalette: () => false,
    getBgColor: () => 0,
    isBold: () => 0,
    isItalic: () => 0,
    isUnderline: () => 0,
  };
}

type Write = { callback?: () => void; data: Uint8Array };

const terminals: MockTerminal[] = [];
vi.mock('../src/terminal/painter', () => ({
  createTerminalPainter: () => ({
    dirtyRows: new Uint8Array(2),
    paint: () => false,
    invalidate: () => undefined,
    noteOutput: () => undefined,
    resetDamage: () => undefined,
  }),
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class extends MockTerminal {
    readonly buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        cursorX: 0,
        type: 'normal',
        getLine: () => ({ getCell: () => cell() }),
      },
    };
    readonly modes = { applicationCursorKeysMode: false, mouseTrackingMode: 'none' };
    constructor() {
      super();
      terminals.push(this);
    }
    open(): void {}
    resize(): void {}
    reset(): void {}
    write(data: Uint8Array, callback?: () => void): void {
      (this as unknown as MockTerminal).writes.push({ data, callback });
    }
    onSelectionChange(): { dispose(): void } {
      return { dispose: () => {} };
    }
    focus(): void {}
    blur(): void {}
    dispose(): void {}
  },
}));

class MockTerminal {
  readonly writes: Write[] = [];
  drainOne(): void {
    this.writes.shift()?.callback?.();
  }
  drainAll(): void {
    while (this.writes.length) this.drainOne();
  }
}

class MockSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static instances: MockSocket[] = [];
  readyState = MockSocket.CONNECTING;
  binaryType = '';
  onopen?: () => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  onclose?: () => void;
  constructor(readonly url: string) {
    MockSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.onclose?.();
  }
  open(): void {
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
  }
  message(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }
}

function frame(message: ServerMessage): ArrayBuffer {
  const payload = toBinary(ServerMessageSchema, message);
  const result = new Uint8Array(payload.length + 1);
  result.set(payload, 1);
  return result.buffer;
}

function connected(initialScreen?: string): ArrayBuffer {
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, {
          cols: 4,
          rows: 2,
          initialScreen: initialScreen ? new TextEncoder().encode(initialScreen) : undefined,
        }),
      },
    }),
  );
}

function output(text: string): ArrayBuffer {
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'output',
        value: create(OutputSchema, { data: new TextEncoder().encode(text) }),
      },
    }),
  );
}

function processState(state: string, exitCode?: number, paneId = '%3'): ArrayBuffer {
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'paneProcessState',
        value: create(PaneProcessStateSchema, { paneId, state, exitCode }),
      },
    }),
  );
}

function pane() {
  return {
    id: '3',
    workspaceId: 'w',
    workspaceName: 'W',
    sessionId: 's',
    sessionName: 'S',
    windowId: 'win',
    windowName: 'Win',
    title: 'Pane',
    cols: 4,
    rows: 2,
  };
}

async function connectedSurface(initialScreen?: string) {
  const { createTerminalSurface } = await import('../src/terminal/surface');
  const surface = createTerminalSurface('http://127.0.0.1:9', pane());
  surface.connect();
  const socket = MockSocket.instances.at(-1);
  const terminal = terminals.at(-1);
  if (!socket || !terminal) throw new Error('missing mock surface');
  socket.open();
  socket.message(connected(initialScreen));
  return { surface, socket, terminal };
}

beforeEach(() => {
  vi.resetModules();
  MockSocket.instances.length = 0;
  terminals.length = 0;
  vi.stubGlobal('WebSocket', MockSocket);
  vi.stubGlobal('document', {
    createElement: (tag: string) =>
      tag === 'canvas'
        ? {
            width: 0,
            height: 0,
            style: {},
            getContext: () => ({
              fillRect: vi.fn(),
              fillText: vi.fn(),
              setTransform: vi.fn(),
              strokeRect: vi.fn(),
              fillStyle: '',
              strokeStyle: '',
              font: '',
              textBaseline: '',
            }),
          }
        : { style: {}, remove: vi.fn() },
    body: { append: vi.fn() },
  });
  vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('held-pane process lifecycle on the terminal surface', () => {
  it('starts running and reports an exited pane with its code, apart from connectivity', async () => {
    const { surface, socket } = await connectedSurface();
    expect(surface.process).toEqual({ state: 'running' });
    socket.message(processState('exited', 7));
    expect(surface.status).toBe('connected');
    expect(surface.process).toEqual({ state: 'exited', exitCode: 7 });
  });

  it('reads an exited pane without a readable status as exited with no code', async () => {
    const { surface, socket } = await connectedSurface();
    socket.message(processState('exited'));
    expect(surface.process).toEqual({ state: 'exited' });
  });

  it('clears the held state on respawn over the same stream, keeping panel identity', async () => {
    const { surface, socket } = await connectedSurface();
    const listener = vi.fn();
    surface.subscribe(listener);
    socket.message(processState('exited', 1));
    expect(listener).toHaveBeenCalledTimes(1);
    const id = surface.pane.id;
    socket.message(processState('running'));
    expect(surface.process).toEqual({ state: 'running' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(surface.pane.id).toBe(id);
    expect(MockSocket.instances).toHaveLength(1);
  });

  it('does not notify for a repeated identical state', async () => {
    const { surface, socket } = await connectedSurface();
    socket.message(processState('exited', 2));
    const listener = vi.fn();
    surface.subscribe(listener);
    socket.message(processState('exited', 2));
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not carry a held state across a reconnect that reports nothing', async () => {
    const { surface, socket } = await connectedSurface();
    socket.message(processState('exited', 3));
    socket.message(connected());
    expect(surface.process).toEqual({ state: 'running' });
  });

  it('reads a legacy empty state as running', async () => {
    const { surface, socket } = await connectedSurface();
    socket.message(processState('exited', 3));
    socket.message(processState(''));
    expect(surface.process).toEqual({ state: 'running' });
  });

  it('ends exited after a real reconnect that replays the exited state', async () => {
    vi.useFakeTimers();
    const { surface, socket } = await connectedSurface();
    socket.message(processState('exited', 4));
    socket.close();
    expect(surface.status).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(600);
    expect(MockSocket.instances).toHaveLength(2);
    const next = MockSocket.instances[1];
    next.open();
    next.message(connected());
    expect(surface.process).toEqual({ state: 'running' });
    next.message(processState('exited', 4));
    expect(surface.status).toBe('connected');
    expect(surface.process).toEqual({ state: 'exited', exitCode: 4 });
  });

  it('keeps the last known state for an unknown non-empty state', async () => {
    const { surface, socket } = await connectedSurface();
    socket.message(processState('exited', 3));
    socket.message(processState('zombie'));
    expect(surface.process).toEqual({ state: 'exited', exitCode: 3 });
    socket.message(processState('running'));
    expect(surface.process).toEqual({ state: 'running' });
  });

  it('ignores another pane, matches %N and pane-N spellings, and accepts an empty pane id', async () => {
    const { surface, socket } = await connectedSurface();
    socket.message(processState('exited', 1, '%9'));
    expect(surface.process).toEqual({ state: 'running' });
    socket.message(processState('exited', 1, 'pane-3'));
    expect(surface.process).toEqual({ state: 'exited', exitCode: 1 });
    socket.message(processState('running', undefined, '3'));
    expect(surface.process).toEqual({ state: 'running' });
    socket.message(processState('exited', 2, ''));
    expect(surface.process).toEqual({ state: 'exited', exitCode: 2 });
  });
});
