import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectedSchema,
  OutputSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';

const fakeWrites: Uint8Array[] = [];
const fakeResets: number[] = [];
const fakeCells: unknown[] = [];
const paintStyles: string[] = [];
const paintTextStyles: string[] = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    public buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        cursorX: 0,
        getLine: () =>
          fakeCells.length ? { getCell: (index: number) => fakeCells[index] } : undefined,
      },
    };
    public options = { cursorBlink: false };
    public open(): void {}
    public resize(): void {}
    public reset(): void {
      fakeResets.push(1);
    }
    public write(data: Uint8Array, callback?: () => void): void {
      fakeWrites.push(data);
      callback?.();
    }
    public focus(): void {}
    public blur(): void {}
    public dispose(): void {}
  },
}));

class MockSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static instances: MockSocket[] = [];
  readonly readyState = 0;
  readonly sent: ArrayBuffer[] = [];
  binaryType = '';
  onopen?: () => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  onerror?: () => void;
  onclose?: () => void;
  constructor(readonly url: string) {
    MockSocket.instances.push(this);
  }
  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.();
  }
  open(): void {
    (this as { readyState: number }).readyState = MockSocket.OPEN;
    this.onopen?.();
  }
  message(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }
  closeSilently(): void {
    this.onclose?.();
  }
}

function frame(message: unknown): ArrayBuffer {
  const payload = toBinary(ServerMessageSchema, message as never);
  const result = new Uint8Array(payload.length + 1);
  result.set(payload, 1);
  return result.buffer;
}
function pane(id = '3') {
  return {
    id,
    workspaceId: 'w',
    workspaceName: 'W',
    sessionId: 's',
    sessionName: 'S',
    windowId: 'win',
    windowName: 'Win',
    title: 'Pane',
    cols: 80,
    rows: 24,
  };
}

beforeEach(() => {
  fakeWrites.length = 0;
  fakeResets.length = 0;
  fakeCells.length = 0;
  paintStyles.length = 0;
  paintTextStyles.length = 0;
  MockSocket.instances.length = 0;
  (globalThis as Record<string, unknown>).WebSocket = MockSocket;
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) =>
      tag === 'canvas'
        ? {
            width: 0,
            height: 0,
            style: {},
            getContext: () => ({
              fillRect: vi.fn(),
              fillText: vi.fn(() => paintTextStyles.push(paintStyles.at(-1) ?? '')),
              setTransform: vi.fn(),
              strokeRect: vi.fn(),
              set fillStyle(value: string) {
                paintStyles.push(value);
              },
              set strokeStyle(_value: string) {},
              set font(_value: string) {},
              set textBaseline(_value: string) {},
            }),
          }
        : { style: {}, remove: vi.fn() },
    body: { append: vi.fn() },
  };
  (globalThis as Record<string, unknown>).window = { location: { href: 'http://localhost/' } };
});

describe('terminal surface lifecycle', () => {
  it('writes connected seed before subsequent output and gates input on handshake', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    surface.connect();
    const ws = MockSocket.instances[0];
    expect(surface.sendText('before')).toBe(false);
    ws.open();
    ws.message(
      frame(
        create(ServerMessageSchema, {
          message: {
            case: 'connected',
            value: create(ConnectedSchema, {
              cols: 80,
              rows: 24,
              initialScreen: new TextEncoder().encode('seed'),
            }),
          },
        }),
      ),
    );
    expect(surface.status).toBe('connected');
    expect(surface.sendText('after')).toBe(true);
    ws.message(
      frame(
        create(ServerMessageSchema, {
          message: {
            case: 'output',
            value: create(OutputSchema, { data: new TextEncoder().encode('delta') }),
          },
        }),
      ),
    );
    expect(fakeResets.length).toBe(1);
    expect(new TextDecoder().decode(fakeWrites[0])).toBe('seed');
    expect(new TextDecoder().decode(fakeWrites[1])).toBe('delta');
  });

  it('does not open duplicate sockets while connecting and ignores stale callbacks', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    surface.connect();
    surface.connect();
    expect(MockSocket.instances).toHaveLength(1);
    const first = MockSocket.instances[0];
    vi.useFakeTimers();
    first.closeSilently();
    vi.advanceTimersByTime(500);
    expect(MockSocket.instances).toHaveLength(2);
    const second = MockSocket.instances[1];
    first.onmessage?.({
      data: frame(
        create(ServerMessageSchema, {
          message: { case: 'connected', value: create(ConnectedSchema, { cols: 80, rows: 24 }) },
        }),
      ),
    });
    expect(surface.status).toBe('connecting');
    second.open();
    second.message(
      frame(
        create(ServerMessageSchema, {
          message: { case: 'connected', value: create(ConnectedSchema, { cols: 80, rows: 24 }) },
        }),
      ),
    );
    expect(surface.status).toBe('connected');
    first.closeSilently();
    expect(surface.status).toBe('connected');
    vi.useRealTimers();
  });

  it('rejects resize while disconnected or read-only and normalizes pane URL', async () => {
    const { createTerminalSurface, paneWebSocketURL } = await import('../src/terminal/surface');
    expect(paneWebSocketURL('http://127.0.0.1:9', '%3')).toContain('session=pane-3');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    surface.resizeGrid(100, 30);
    expect(surface.cols).toBe(80);
    surface.connect();
    const ws = MockSocket.instances[0];
    ws.open();
    ws.message(
      frame(
        create(ServerMessageSchema, {
          message: {
            case: 'connected',
            value: create(ConnectedSchema, { cols: 80, rows: 24, readonly: true }),
          },
        }),
      ),
    );
    expect(surface.sendText('no')).toBe(false);
    surface.resizeGrid(100, 30);
    expect(surface.cols).toBe(80);
    surface.dispose();
  });

  it('supersamples at capped density without changing logical terminal size', async () => {
    Object.assign(window, { devicePixelRatio: 3 });
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    expect(surface.canvas.width).toBe(1760);
    expect(surface.canvas.height).toBe(1008);
    expect(surface.canvas.style.width).toBe('880px');
    expect(surface.canvas.style.height).toBe('504px');
    expect([surface.cols, surface.rows]).toEqual([80, 24]);
    surface.dispose();
  });

  it('paints public RGB/palette cell colors and inverse text', async () => {
    fakeCells.push({
      getWidth: () => 1,
      isInverse: () => 1,
      isFgRGB: () => true,
      isFgPalette: () => false,
      getFgColor: () => 0x112233,
      isBgRGB: () => false,
      isBgPalette: () => true,
      getBgColor: () => 1,
      isBold: () => 0,
      isItalic: () => 0,
      isDim: () => 0,
      isUnderline: () => 1,
      getChars: () => 'X',
    });
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    expect(paintStyles).toContain('rgb(17,34,51)');
    expect(paintStyles).toContain('#cd0000');
    expect(paintTextStyles).toContain('#cd0000');
    surface.dispose();
  });
});
