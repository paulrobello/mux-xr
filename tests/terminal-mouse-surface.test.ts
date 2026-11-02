import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor } from '../src/contracts';
import {
  ClientMessageSchema,
  ConnectedSchema,
  ModeChangedSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';

const modes = { mouseTrackingMode: 'none' as 'none' | 'drag' | 'any' | 'vt200' | 'x10' };
const scrollCalls: number[] = [];
const nullCell = {
  getWidth: () => 1,
  getChars: () => '',
  isFgRGB: () => false,
  isFgPalette: () => false,
  getFgColor: () => 0,
  isBgRGB: () => false,
  isBgPalette: () => false,
  getBgColor: () => 0,
  isBold: () => false,
  isItalic: () => false,
  isUnderline: () => false,
  isInverse: () => false,
};
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    public modes = modes;
    public buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        cursorX: 0,
        getNullCell: () => nullCell,
        getLine: () => undefined,
      },
    };
    public options = { cursorBlink: false };
    open(): void {}
    resize(): void {}
    reset(): void {}
    write(_data: Uint8Array, callback?: () => void): void {
      callback?.();
    }
    focus(): void {}
    blur(): void {}
    scrollLines(lines: number): void {
      scrollCalls.push(lines);
    }
    dispose(): void {}
  },
}));

class MockSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static instances: MockSocket[] = [];
  readyState = MockSocket.CONNECTING;
  readonly sent: ArrayBuffer[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
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
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
  }
  message(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }
}

const pane: PaneDescriptor = {
  id: '3',
  workspaceId: 'w',
  workspaceName: 'W',
  sessionId: 's',
  sessionName: 'S',
  windowId: 'win',
  windowName: 'Win',
  title: 'Pane',
  cols: 4,
  rows: 3,
};

function frame(message: unknown): ArrayBuffer {
  const payload = toBinary(ServerMessageSchema, message as never);
  const result = new Uint8Array(payload.length + 1);
  result.set(payload, 1);
  return result.buffer;
}

function connected(readonly = false): ArrayBuffer {
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, { cols: 4, rows: 3, readonly }),
      },
    }),
  );
}

function modeChanged(enabled: boolean): ArrayBuffer {
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'modeChanged',
        value: create(ModeChangedSchema, { mode: 'mouse_tracking', enabled }),
      },
    }),
  );
}

function namedMode(mode: string, enabled: boolean): ArrayBuffer {
  return frame(
    create(ServerMessageSchema, {
      message: { case: 'modeChanged', value: create(ModeChangedSchema, { mode, enabled }) },
    }),
  );
}

beforeEach(() => {
  MockSocket.instances.length = 0;
  scrollCalls.length = 0;
  modes.mouseTrackingMode = 'none';
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
              fillText: vi.fn(),
              strokeRect: vi.fn(),
              setTransform: vi.fn(),
            }),
          }
        : { style: {}, remove: vi.fn() },
    body: { append: vi.fn() },
  };
  (globalThis as Record<string, unknown>).window = { location: { href: 'http://localhost/' } };
});

describe('terminal surface mouse gating', () => {
  it('sends bounded raw SGR wheel codes with clamped cells and no text or resize', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane);
    surface.connect();
    const socket = MockSocket.instances[0];
    socket.open();
    socket.message(connected());
    socket.message(modeChanged(true));
    const before = socket.sent.length;
    expect(surface.scroll?.(-2, { col: 99, row: -2 })).toBe(true);
    expect(surface.scroll?.(100)).toBe(true);
    const messages = socket.sent
      .slice(before)
      .map((raw) => fromBinary(ClientMessageSchema, new Uint8Array(raw).subarray(1)).message);
    expect(messages).toHaveLength(34);
    expect(
      messages.every((message) => message.case === 'mouse' && message.value.eventType === 'scroll'),
    ).toBe(true);
    expect(
      messages
        .slice(0, 2)
        .every(
          (message) =>
            message.case === 'mouse' &&
            message.value.button === 64 &&
            message.value.col === 3 &&
            message.value.row === 0,
        ),
    ).toBe(true);
    expect(
      messages.slice(2).every((message) => message.case === 'mouse' && message.value.button === 65),
    ).toBe(true);
    surface.dispose();
  });

  it('scrolls the local xterm viewport when mouse tracking is off', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane);
    expect(surface.scroll?.(3, { col: 99, row: -2 })).toBe(true);
    expect(scrollCalls).toEqual([3]);
    expect(surface.scroll?.(0)).toBe(false);
    surface.disconnect();
    surface.dispose();
    expect(surface.scroll?.(1)).toBe(false);
  });

  it('gates by handshake, mode, bounds, pause, and dispose', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane);
    expect(surface.sendMouse?.({ col: 0, row: 0, button: 0, eventType: 'press' })).toBe(false);
    surface.connect();
    const socket = MockSocket.instances[0];
    socket.open();
    socket.message(connected());
    expect(surface.sendMouse?.({ col: -1, row: 0, button: 0, eventType: 'press' })).toBe(false);
    expect(surface.sendMouse?.({ col: 4, row: 0, button: 0, eventType: 'press' })).toBe(false);
    socket.message(modeChanged(true));
    expect(surface.mouseTracking).toBe('vt200');
    expect(surface.sendMouse?.({ col: 1, row: 1, button: 0, eventType: 'press' })).toBe(true);
    expect(surface.sendMouse?.({ col: 1, row: 1, button: 0, eventType: 'move' })).toBe(false);
    modes.mouseTrackingMode = 'drag';
    expect(surface.sendMouse?.({ col: 1, row: 1, button: 0, eventType: 'move' })).toBe(true);
    socket.message(modeChanged(false));
    expect(surface.mouseTracking).toBe('none');
    expect(surface.sendMouse?.({ col: 1, row: 1, button: 0, eventType: 'release' })).toBe(false);
    surface.disconnect();
    expect(surface.sendMouse?.({ col: 1, row: 1, button: 0, eventType: 'press' })).toBe(false);
    surface.dispose();
    expect(surface.sendMouse?.({ col: 1, row: 1, button: 0, eventType: 'press' })).toBe(false);
  });

  it('rejects read-only handshakes and clears tracking state on reconnect', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane);
    surface.connect();
    const first = MockSocket.instances[0];
    first.open();
    first.message(connected(true));
    first.message(modeChanged(true));
    expect(surface.mouseTracking).toBe('vt200');
    expect(surface.sendMouse?.({ col: 0, row: 0, button: 0, eventType: 'press' })).toBe(false);
    surface.disconnect();
    surface.connect();
    const second = MockSocket.instances[1];
    second.open();
    second.message(connected(false));
    expect(surface.mouseTracking).toBe('none');
    expect(surface.sendMouse?.({ col: 0, row: 0, button: 0, eventType: 'press' })).toBe(false);
    surface.dispose();
  });

  it('tracks the exact core mode through full sync and ignores encoding flags', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane);
    surface.connect();
    const socket = MockSocket.instances[0];
    socket.open();
    socket.message(connected());
    socket.message(namedMode('mouse_x10', false));
    socket.message(namedMode('mouse_normal', false));
    socket.message(namedMode('mouse_button_event', true));
    socket.message(namedMode('mouse_any_event', false));
    socket.message(namedMode('mouse_sgr', false));
    expect(surface.mouseTracking).toBe('drag');
    expect(surface.sendMouse?.({ col: 1, row: 1, button: 0, eventType: 'move' })).toBe(true);
    socket.message(namedMode('mouse_button_event', false));
    expect(surface.mouseTracking).toBe('none');
    surface.dispose();
  });
});
