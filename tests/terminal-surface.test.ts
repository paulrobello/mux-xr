import { create, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectedSchema,
  OutputSchema,
  ResizeSchema,
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

  it('keeps retrying after repeated connection failures until a later connection recovers', async () => {
    vi.useFakeTimers();
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    surface.connect();
    for (let attempt = 0; attempt < 9; attempt += 1) {
      MockSocket.instances.at(-1)?.closeSilently();
      vi.advanceTimersByTime(5000);
    }
    expect(MockSocket.instances.length).toBeGreaterThan(8);
    const recovered = MockSocket.instances.at(-1);
    recovered?.open();
    recovered?.message(
      frame(
        create(ServerMessageSchema, {
          message: { case: 'connected', value: create(ConnectedSchema, { cols: 80, rows: 24 }) },
        }),
      ),
    );
    expect(surface.status).toBe('connected');
    surface.dispose();
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

  it('validates resize requests and adopts only the server echo', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    expect(surface.resizeGrid(Number.NaN, 30)).toBe(false);
    expect(surface.resizeGrid(100, 1)).toBe(false);
    expect(surface.cols).toBe(80);
    surface.connect();
    const ws = MockSocket.instances[0];
    ws.open();
    ws.message(
      frame(
        create(ServerMessageSchema, {
          message: { case: 'connected', value: create(ConnectedSchema, { cols: 80, rows: 24 }) },
        }),
      ),
    );
    expect(surface.canResizeGrid).toBe(true);
    expect(surface.resizeGrid(100, 30)).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(surface.cols).toBe(80);
    ws.message(
      frame(
        create(ServerMessageSchema, {
          message: { case: 'resize', value: create(ResizeSchema, { cols: 100, rows: 30 }) },
        }),
      ),
    );
    expect([surface.cols, surface.rows]).toEqual([100, 30]);
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
    surface.setColorMode('original');
    expect(paintStyles).toContain('rgb(17,34,51)');
    expect(paintStyles).toContain('#cd0000');
    expect(paintTextStyles).toContain('#cd0000');
    surface.dispose();
  });

  it('repaints and notifies subscribers when the color mode changes', async () => {
    const { createTerminalSurface } = await import('../src/terminal/surface');
    const surface = createTerminalSurface('http://127.0.0.1:9', pane());
    const revisions: number[] = [];
    surface.subscribe(() => revisions.push(surface.revision));
    surface.setColorMode('monochrome');
    expect(revisions).toEqual([1]);
    expect(surface.revision).toBe(1);
    surface.setColorMode('monochrome');
    expect(revisions).toHaveLength(1);
    surface.dispose();
  });
});

describe('terminal color modes', () => {
  it('maps ANSI 256 colors and keeps comfort and monochrome readable', async () => {
    const { terminalColor } = await import('../src/terminal/colors');
    expect(terminalColor('original', false, true, 196, '#000')).toBe('#ff0000');
    expect(terminalColor('original', false, true, 46, '#000')).toBe('#00ff00');
    expect(terminalColor('original', false, true, 232, '#000')).toBe('#080808');
    expect(terminalColor('original', false, true, 255, '#000')).toBe('#eeeeee');
    expect(terminalColor('comfort', true, false, 0x0000ff, '#000')).not.toBe('#0000ff');
    expect(terminalColor('monochrome', true, false, 0x0000ff, '#000')).toBe('#787878');
    for (const mode of ['comfort', 'original', 'monochrome'] as const) {
      expect(terminalColor(mode, false, true, 0, '#05070b', false, true)).toBe('#000000');
      expect(terminalColor(mode, true, false, 0, '#05070b', false, true)).toBe(
        mode === 'original' ? 'rgb(0,0,0)' : '#000000',
      );
    }
  });

  it('turns blue foregrounds into readable muted teal while preserving original colors', async () => {
    const { terminalColor } = await import('../src/terminal/colors');
    const parse = (color: string): [number, number, number] => {
      const channels = color.slice(1).match(/../g);
      if (!channels) throw new Error(`Invalid color: ${color}`);
      return channels.map((channel) => Number.parseInt(channel, 16)) as [number, number, number];
    };
    expect(terminalColor('original', false, true, 4, '#000')).toBe('#0000ee');
    expect(terminalColor('original', false, true, 12, '#000')).toBe('#5c5cff');
    expect(terminalColor('original', true, false, 0x0000ff, '#000')).toBe('rgb(0,0,255)');
    for (let index = 0; index < 256; index += 1)
      expect(terminalColor('comfort', false, true, index, '#000')).toMatch(/^#[0-9a-f]{6}$/i);
    const blue = parse(terminalColor('comfort', false, true, 4, '#000'));
    const brightBlue = parse(terminalColor('comfort', false, true, 12, '#000'));
    expect(brightBlue[1]).toBeGreaterThan(blue[1]);
    for (const [isRgb, value] of [
      [false, 4],
      [false, 12],
      [true, 0x0000ff],
    ] as const) {
      const [red, green, blue] = parse(terminalColor('comfort', isRgb, !isRgb, value, '#000'));
      expect(green).toBeGreaterThan(red);
      expect(Math.abs(green - blue)).toBeLessThanOrEqual(16);
      expect(blue - red).toBeLessThan(40);
      expect(0.2126 * red + 0.7152 * green + 0.0722 * blue).toBeGreaterThan(140);
    }
    const monochromeForeground = terminalColor('monochrome', false, false, 0, '#d8e1ef');
    expect(monochromeForeground.slice(1, 3)).toBe(monochromeForeground.slice(3, 5));
    expect(monochromeForeground.slice(3, 5)).toBe(monochromeForeground.slice(5, 7));
    expect(terminalColor('monochrome', false, false, 0, '#070707', false, true)).toBe('#070707');
  });
});
