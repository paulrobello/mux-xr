import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectedSchema,
  OutputSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';

let cellText = '';
const fillTexts: string[] = [];
function cell(): Record<string, unknown> {
  return {
    getWidth: () => 1,
    getChars: () => cellText,
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

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    public buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        cursorX: 0,
        getNullCell: () => cell(),
        getLine: () => ({ getCell: () => cell() }),
      },
    };
    public modes = { applicationCursorKeysMode: false, mouseTrackingMode: 'none' };
    public open(): void {}
    public resize(): void {}
    public reset(): void {}
    public write(data: Uint8Array, callback?: () => void): void {
      cellText = new TextDecoder().decode(data);
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
  readyState = MockSocket.CONNECTING;
  binaryType = '';
  sent: ArrayBuffer[] = [];
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

function frame(message: unknown): ArrayBuffer {
  const payload = toBinary(ServerMessageSchema, message as never);
  const result = new Uint8Array(payload.length + 1);
  result.set(payload, 1);
  return result.buffer;
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
async function connectedSurface() {
  const { createTerminalSurface } = await import('../src/terminal/surface');
  const surface = createTerminalSurface('http://127.0.0.1:9', pane());
  surface.connect();
  const socket = MockSocket.instances.at(-1);
  if (!socket) throw new Error('missing mock socket');
  socket.open();
  socket.message(
    frame(
      create(ServerMessageSchema, {
        message: { case: 'connected', value: create(ConnectedSchema, { cols: 4, rows: 2 }) },
      }),
    ),
  );
  vi.runOnlyPendingTimers();
  return { surface, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  cellText = '';
  fillTexts.length = 0;
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
              fillText: vi.fn((text: string) => fillTexts.push(text)),
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
  };
  (globalThis as Record<string, unknown>).window = { location: { href: 'http://localhost/' } };
});

describe('terminal render quality', () => {
  it('caps medium and low paints when XR flushes at 60 Hz', async () => {
    const medium = await connectedSurface();
    medium.surface.setRenderQuality?.('medium');
    const mediumStart = medium.surface.revision;
    for (let index = 0; index < 60; index += 1) {
      medium.socket.message(output(`m${index}`));
      medium.surface.flush?.();
      vi.advanceTimersByTime(16);
    }
    expect(medium.surface.revision - mediumStart).toBeLessThanOrEqual(16);
    const low = await connectedSurface();
    low.surface.setRenderQuality?.('low');
    const lowStart = low.surface.revision;
    for (let index = 0; index < 60; index += 1) {
      low.socket.message(output(`l${index}`));
      low.surface.flush?.();
      vi.advanceTimersByTime(16);
    }
    expect(low.surface.revision - lowStart).toBeLessThanOrEqual(6);
    low.surface.dispose();
    medium.surface.dispose();
  });

  it('keeps latest hidden output pending and paints it on full promotion', async () => {
    const { surface, socket } = await connectedSurface();
    surface.setRenderQuality?.('hidden');
    socket.message(output('older'));
    socket.message(output('latest'));
    surface.flush?.();
    expect(surface.revision).toBe(0);
    expect(fillTexts).not.toContain('latest');
    surface.setRenderQuality?.('full');
    expect(fillTexts.at(-1)).toBe('latest');
    surface.dispose();
  });

  it('does not paint while paused or after disposal', async () => {
    const { surface, socket } = await connectedSurface();
    surface.setRenderQuality?.('medium');
    surface.disconnect();
    socket.message(output('paused'));
    surface.flush?.();
    expect(surface.status).toBe('paused');
    expect(surface.revision).toBe(0);
    surface.dispose();
    vi.advanceTimersByTime(1000);
    expect(surface.status).toBe('closed');
  });
});
