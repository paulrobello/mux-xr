import { create, toBinary } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BellSchema,
  ConnectedSchema,
  OutputSchema,
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

type BellHandler = () => void;
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
    attachCustomKeyEventHandler(): void {}
    resize(): void {}
    reset(): void {}
    write(data: Uint8Array, callback?: () => void): void {
      (this as unknown as MockTerminal).writes.push({ data, callback });
    }
    onBell(handler: BellHandler): { dispose(): void } {
      const mock = this as unknown as MockTerminal;
      mock.bellHandler = handler;
      return { dispose: () => (mock.bellHandler = undefined) };
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
  bellHandler: BellHandler | undefined;
  bell(): void {
    this.bellHandler?.();
  }
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

function bell(): ArrayBuffer {
  return frame(
    create(ServerMessageSchema, {
      message: { case: 'bell', value: create(BellSchema, {}) },
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

describe('terminal bell state', () => {
  it('ignores explicit bells before handshake and parser bells without live output', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    surface.connect();
    const socket = MockSocket.instances.at(-1);
    const terminal = terminals.at(-1);
    if (!socket || !terminal) throw new Error('missing mock surface');
    socket.open();
    socket.message(bell());
    expect(surface.bellPending).toBe(false);
    socket.message(connected());
    terminal.bell();
    expect(surface.bellPending).toBe(false);
    surface.disconnect();
    terminal.bell();
    expect(surface.bellPending).toBe(false);
    surface.dispose();
  });

  it('latches explicit protobuf bells and focus clears, including refocus', async () => {
    const { surface, socket } = await connectedSurface();
    socket.message(bell());
    expect(surface.bellPending).toBe(true);
    surface.focus(true);
    expect(surface.bellPending).toBe(false);
    socket.message(bell());
    surface.focus(true);
    expect(surface.bellPending).toBe(false);
    surface.dispose();
  });

  it('latches xterm parser bells from live output without a timer', async () => {
    const { surface, socket, terminal } = await connectedSurface();
    socket.message(output('live'));
    expect(surface.bellPending).toBe(false);
    terminal.bell();
    expect(surface.bellPending).toBe(true);
    surface.dispose();
  });

  it('excludes initial-screen bells and acknowledgement prevents delayed relatch', async () => {
    const { surface, terminal, socket } = await connectedSurface('replay');
    terminal.bell();
    expect(surface.bellPending).toBe(false);
    terminal.drainOne();
    socket.message(output('live'));
    surface.focus(true);
    terminal.bell();
    expect(surface.bellPending).toBe(false);
    terminal.drainAll();
    terminal.bell();
    expect(surface.bellPending).toBe(false);
    surface.dispose();
  });

  it('retains pending state through reconnect and ignores old websocket/parser generations', async () => {
    const { surface, socket: oldSocket, terminal } = await connectedSurface();
    oldSocket.message(output('old'));
    surface.disconnect();
    oldSocket.message(bell());
    surface.connect();
    const newSocket = MockSocket.instances.at(-1);
    if (!newSocket) throw new Error('missing reconnect socket');
    newSocket.open();
    newSocket.message(connected());
    terminal.bell();
    expect(surface.bellPending).toBe(false);
    terminal.drainOne();
    newSocket.message(output('new'));
    terminal.bell();
    expect(surface.bellPending).toBe(true);
    surface.disconnect();
    expect(surface.bellPending).toBe(true);
    surface.dispose();
    expect(surface.bellPending).toBe(false);
    terminal.drainAll();
  });
});
