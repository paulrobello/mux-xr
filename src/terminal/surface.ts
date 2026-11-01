import { Terminal } from '@xterm/xterm';
import type {
  KeyModifiers,
  PaneDescriptor,
  TerminalColorMode,
  TerminalStatus,
  TerminalSurface,
} from '../contracts';
import { terminalColor } from './colors';
import {
  createFocusMessage,
  createInputMessage,
  createPasteMessage,
  createResizeMessage,
  decodeServerMessage,
  encodeClientMessage,
  terminalKeyLabel,
} from './protocol';

type SocketLike = WebSocket;
const INITIAL_RETRY_MS = 500;
const MAX_RETRIES = 8;
const CELL_WIDTH = 11;
const LINE_HEIGHT = 21;
export const MIN_GRID_COLS = 2;
export const MAX_GRID_COLS = 300;
export const MIN_GRID_ROWS = 2;
export const MAX_GRID_ROWS = 150;

export function validGrid(cols: number, rows: number): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= MIN_GRID_COLS &&
    cols <= MAX_GRID_COLS &&
    rows >= MIN_GRID_ROWS &&
    rows <= MAX_GRID_ROWS
  );
}

export function terminalKeyBytes(
  key: string,
  modifiers: KeyModifiers = {},
  applicationCursor = false,
): string {
  const mod = (modifiers.ctrl ? 4 : 0) + (modifiers.alt ? 2 : 0) + (modifiers.shift ? 1 : 0);
  const prefix = modifiers.alt ? '\x1b' : '';
  const named: Record<string, string> = {
    Enter: '\r',
    Escape: '\x1b',
    Esc: '\x1b',
    Backspace: '\x7f',
    Tab: '\t',
    ArrowUp: applicationCursor ? '\x1bOA' : '\x1b[A',
    ArrowDown: applicationCursor ? '\x1bOB' : '\x1b[B',
    ArrowRight: applicationCursor ? '\x1bOC' : '\x1b[C',
    ArrowLeft: applicationCursor ? '\x1bOD' : '\x1b[D',
    Delete: '\x1b[3~',
    Home: '\x1b[H',
    End: '\x1b[F',
  };
  if (mod === 0) return prefix + (named[key] ?? key);
  if (key.length === 1 && modifiers.ctrl) {
    if (key === ' ' || key === '@') return `${prefix}\x00`;
    if (key === '?') return `${prefix}\x7f`;
    const code = key.toUpperCase().charCodeAt(0);
    return prefix + String.fromCharCode(code >= 64 && code <= 95 ? code - 64 : code);
  }
  if (key.length === 1 && modifiers.shift) {
    return prefix + terminalKeyLabel(key, true);
  }
  const code = named[key];
  if (code?.startsWith('\x1b['))
    return key === 'Delete' ? `\x1b[3;${mod + 1}~` : `\x1b[1;${mod + 1}${code.slice(2)}`;
  if (code?.startsWith('\x1bO')) return `\x1b[1;${mod + 1}${code.slice(2)}`;
  return prefix + (named[key] ?? key);
}

export function paneWebSocketURL(endpoint: string, paneId: string): string {
  const match = /^(?:pane-)?(\d+)$/.exec(paneId) ?? /^%([0-9]+)$/.exec(paneId);
  if (!match) throw new Error(`Invalid pane id: ${paneId}`);
  const session = `pane-${match[1]}`;
  const url = new URL(
    endpoint,
    typeof window === 'undefined' ? 'http://localhost/' : window.location.href,
  );
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!url.pathname.endsWith('/ws')) url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  url.searchParams.set('session', session);
  url.searchParams.delete('metadata');
  url.searchParams.delete('mux_tree');
  return url.toString();
}

export function createTerminalSurface(endpoint: string, pane: PaneDescriptor): TerminalSurface {
  const canvas = document.createElement('canvas');
  const host = document.createElement('div');
  host.style.cssText =
    'position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden';
  document.body.append(host);
  let cols = pane.cols ?? 80;
  let rows = pane.rows ?? 24;
  const terminal = new Terminal({
    cols,
    rows,
    fontSize: 18,
    theme: { background: '#05070b', foreground: '#d8e1ef' },
    disableStdin: true,
  });
  terminal.open(host);
  let socket: SocketLike | null = null;
  let status: TerminalStatus = 'disconnected';
  let revision = 0;
  let disposed = false;
  let ready = false;
  let retries = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let appCursor = false;
  let readonly = false;
  let colorMode: TerminalColorMode = 'comfort';
  let generation = 0;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    revision += 1;
    paint();
    for (const listener of listeners) listener();
  };
  const paint = (): void => {
    const logicalWidth = cols * CELL_WIDTH;
    const logicalHeight = rows * LINE_HEIGHT;
    const density = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(logicalWidth * density));
    canvas.height = Math.max(1, Math.round(logicalHeight * density));
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    ctx.font = '18px monospace';
    ctx.textBaseline = 'top';
    const buffer = terminal.buffer.active;
    const base = buffer.viewportY;
    for (let row = 0; row < rows; row += 1) {
      const line = buffer.getLine(base + row);
      if (!line) continue;
      for (let col = 0; col < cols; col += 1) {
        const cell = line.getCell(col);
        if (!cell || cell.getWidth() === 0) continue;
        const inverse = Boolean(cell.isInverse());
        const fg = terminalColor(
          colorMode,
          cell.isFgRGB(),
          cell.isFgPalette(),
          cell.getFgColor(),
          '#d8e1ef',
          Boolean(cell.isBold()),
          false,
        );
        const bg = terminalColor(
          colorMode,
          cell.isBgRGB(),
          cell.isBgPalette(),
          cell.getBgColor(),
          '#05070b',
          false,
          true,
        );
        const foreground = inverse ? bg : fg;
        const background = inverse ? fg : bg;
        if (background !== '#05070b') {
          ctx.fillStyle = background;
          ctx.fillRect(
            col * CELL_WIDTH,
            row * LINE_HEIGHT,
            Math.max(1, cell.getWidth()) * CELL_WIDTH,
            LINE_HEIGHT,
          );
        }
        const text = cell.getChars();
        if (text) {
          ctx.fillStyle = foreground;
          ctx.font = `${cell.isBold() ? 'bold ' : ''}${cell.isItalic() ? 'italic ' : ''}18px monospace`;
          ctx.fillText(text, col * CELL_WIDTH, row * LINE_HEIGHT);
          if (cell.isUnderline()) {
            ctx.fillRect(
              col * CELL_WIDTH,
              (row + 1) * LINE_HEIGHT - 2,
              Math.max(1, cell.getWidth()) * CELL_WIDTH,
              1,
            );
          }
        }
      }
    }
    const cursor =
      terminal.buffer.active.baseY +
      terminal.buffer.active.cursorY -
      terminal.buffer.active.viewportY;
    if (cursor >= 0 && cursor < rows) {
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(
        terminal.buffer.active.cursorX * CELL_WIDTH,
        cursor * LINE_HEIGHT,
        CELL_WIDTH,
        LINE_HEIGHT,
      );
    }
  };
  const setStatus = (next: TerminalStatus): void => {
    if (status !== next) {
      status = next;
      notify();
    }
  };
  const send = (message: Parameters<typeof encodeClientMessage>[0]): boolean => {
    if (!ready || readonly || !socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(encodeClientMessage(message));
    return true;
  };
  const scheduleRetry = (): void => {
    if (disposed || retries >= MAX_RETRIES) return;
    const delay = Math.min(INITIAL_RETRY_MS * 2 ** retries, 5000);
    retries += 1;
    retry = setTimeout(connect, delay);
  };
  const connect = (): void => {
    if (
      disposed ||
      socket?.readyState === WebSocket.OPEN ||
      socket?.readyState === WebSocket.CONNECTING
    )
      return;
    ready = false;
    setStatus('connecting');
    let ws: SocketLike;
    try {
      ws = new WebSocket(paneWebSocketURL(endpoint, pane.id));
    } catch {
      setStatus('disconnected');
      scheduleRetry();
      return;
    }
    const token = ++generation;
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.onopen = () => {
      setStatus('connecting');
    };
    ws.onmessage = (event) => {
      if (token !== generation || ws !== socket) return;
      try {
        const msg = decodeServerMessage(event.data as ArrayBuffer);
        switch (msg.message.case) {
          case 'connected': {
            const connected = msg.message.value;
            ready = true;
            readonly = connected.readonly ?? false;
            retries = 0;
            if (validGrid(connected.cols, connected.rows)) {
              cols = connected.cols;
              rows = connected.rows;
            }
            terminal.resize(cols, rows);
            terminal.reset();
            if (connected.initialScreen?.length) terminal.write(connected.initialScreen, notify);
            else notify();
            setStatus('connected');
            break;
          }
          case 'output':
            terminal.write(msg.message.value.data, notify);
            break;
          case 'resize':
            if (!validGrid(msg.message.value.cols, msg.message.value.rows)) break;
            cols = msg.message.value.cols;
            rows = msg.message.value.rows;
            terminal.resize(cols, rows);
            notify();
            break;
          case 'modeChanged':
            if (msg.message.value.mode === 'application_cursor')
              appCursor = msg.message.value.enabled;
            break;
          case 'shutdown':
            ready = false;
            setStatus('exited');
            ws.close();
            break;
          default:
            notify();
        }
      } catch {
        ready = false;
        ws.close();
      }
    };
    ws.onerror = () => {
      if (token !== generation || ws !== socket) return;
      ready = false;
      setStatus('disconnected');
    };
    ws.onclose = () => {
      if (token !== generation) return;
      socket = null;
      ready = false;
      if (!disposed && status !== 'exited') {
        setStatus('disconnected');
        scheduleRetry();
      }
    };
  };
  const surface: TerminalSurface = {
    canvas,
    pane,
    get revision() {
      return revision;
    },
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    get status() {
      return status;
    },
    get canResizeGrid() {
      return ready && socket?.readyState === WebSocket.OPEN && !readonly && !disposed;
    },
    connect,
    sendText: (text) => send(createInputMessage(text)),
    sendKey: (key, modifiers) =>
      send(
        createInputMessage(
          terminalKeyBytes(key, modifiers, terminal.modes?.applicationCursorKeysMode ?? appCursor),
        ),
      ),
    paste: (text) => send(createPasteMessage(text)),
    focus: (focused) => {
      if (focused) terminal.focus();
      else terminal.blur();
      return send(createFocusMessage(focused));
    },
    resizeGrid: (nextCols, nextRows) => {
      if (!validGrid(nextCols, nextRows) || !ready || readonly || disposed) return false;
      return send(createResizeMessage(nextCols, nextRows));
    },
    setColorMode: (mode) => {
      if (colorMode === mode) return;
      colorMode = mode;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      ready = false;
      generation += 1;
      if (retry) clearTimeout(retry);
      socket?.close();
      terminal.dispose();
      host.remove();
      setStatus('closed');
    },
  };
  paint();
  return surface;
}
