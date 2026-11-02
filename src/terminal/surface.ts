import { Terminal } from '@xterm/xterm';
import type {
  KeyModifiers,
  PaneDescriptor,
  TerminalColorMode,
  TerminalMouseInput,
  TerminalMouseTrackingMode,
  TerminalStatus,
  TerminalSurface,
} from '../contracts';
import { createTerminalPainter } from './painter';
import {
  createFocusMessage,
  createInputMessage,
  createMouseMessage,
  createPasteMessage,
  createResizeMessage,
  decodeServerMessage,
  encodeClientMessage,
  terminalKeyLabel,
} from './protocol';

type SocketLike = WebSocket;
const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 5000;
export const MIN_GRID_COLS = 2;
export const MAX_GRID_COLS = 300;
export const MIN_GRID_ROWS = 2;
export const MAX_GRID_ROWS = 150;
const SERVER_MOUSE_MODES: Record<string, TerminalMouseTrackingMode> = {
  mouse_x10: 'x10',
  mouse_normal: 'vt200',
  mouse_button_event: 'drag',
  mouse_any_event: 'any',
};

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
  let paintFrame: number | ReturnType<typeof setTimeout> | null = null;
  let pendingPaintGuard: (() => boolean) | null = null;
  let appCursor = false;
  let readonly = false;
  let colorMode: TerminalColorMode = 'comfort';
  let generation = 0;
  let paused = false;
  let mouseTrackingFallback: TerminalMouseTrackingMode = 'none';
  let mouseTrackingDisabled = false;
  let serverMouseMode: TerminalMouseTrackingMode | null = null;
  let serverMouseModeKnown = false;
  let error: string | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const painter = createTerminalPainter(canvas, terminal);
  const paint = (emit = true): void => {
    if (!painter.paint(cols, rows, colorMode)) return;
    if (emit) {
      revision += 1;
      notify();
    }
  };
  const cancelPaint = (): void => {
    if (paintFrame === null) return;
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function')
      window.cancelAnimationFrame(paintFrame as number);
    else clearTimeout(paintFrame as ReturnType<typeof setTimeout>);
    paintFrame = null;
    pendingPaintGuard = null;
  };
  const queuePaint = (isCurrent: () => boolean = () => true): void => {
    if (disposed || paused || !isCurrent()) return;
    pendingPaintGuard = isCurrent;
    if (paintFrame !== null) return;
    const frame = (): void => {
      paintFrame = null;
      const guard = pendingPaintGuard;
      pendingPaintGuard = null;
      if (disposed || paused || !guard?.()) return;
      paint();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      paintFrame = window.requestAnimationFrame(frame);
    } else {
      paintFrame = setTimeout(frame, 0);
    }
  };
  const flush = (): void => {
    if (paintFrame === null) return;
    const guard = pendingPaintGuard;
    cancelPaint();
    if (!disposed && !paused && guard?.()) paint();
  };
  const setStatus = (next: TerminalStatus): void => {
    if (status !== next) {
      status = next;
      notify();
    }
  };
  const failProtocol = (message: string): void => {
    error = message.slice(0, 256);
    ready = false;
    paused = true;
    generation += 1;
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
    cancelPaint();
    const current = socket;
    socket = null;
    current?.close();
    setStatus('error');
  };
  const send = (message: Parameters<typeof encodeClientMessage>[0]): boolean => {
    if (!ready || readonly || !socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(encodeClientMessage(message));
    return true;
  };
  const scheduleRetry = (): void => {
    if (disposed || paused || retry) return;
    const delay = Math.min(INITIAL_RETRY_MS * 2 ** retries, MAX_RETRY_MS);
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
    paused = false;
    error = null;
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
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
      if (token !== generation || ws !== socket) return;
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
            mouseTrackingFallback = 'none';
            mouseTrackingDisabled = false;
            serverMouseMode = null;
            serverMouseModeKnown = false;
            retries = 0;
            if (validGrid(connected.cols, connected.rows)) {
              cols = connected.cols;
              rows = connected.rows;
            }
            terminal.resize(cols, rows);
            terminal.reset();
            const current = (): boolean => token === generation;
            if (connected.initialScreen?.length)
              terminal.write(connected.initialScreen, () => queuePaint(current));
            else queuePaint(current);
            setStatus('connected');
            break;
          }
          case 'output':
            terminal.write(msg.message.value.data, () => queuePaint(() => token === generation));
            break;
          case 'resize':
            if (!validGrid(msg.message.value.cols, msg.message.value.rows)) break;
            cols = msg.message.value.cols;
            rows = msg.message.value.rows;
            terminal.resize(cols, rows);
            cancelPaint();
            paint();
            break;
          case 'modeChanged': {
            if (msg.message.value.mode === 'application_cursor')
              appCursor = msg.message.value.enabled;
            const exactMouseMode = SERVER_MOUSE_MODES[msg.message.value.mode];
            if (exactMouseMode) {
              serverMouseModeKnown = true;
              if (msg.message.value.enabled) {
                serverMouseMode = exactMouseMode;
                mouseTrackingDisabled = false;
              } else if (serverMouseMode === exactMouseMode) {
                serverMouseMode = null;
              }
            } else if (msg.message.value.mode === 'mouse_tracking' && !serverMouseModeKnown) {
              // Compatibility with older servers that only exposed an aggregate flag.
              mouseTrackingDisabled = !msg.message.value.enabled;
              mouseTrackingFallback = msg.message.value.enabled ? 'vt200' : 'none';
            }
            break;
          }
          case 'shutdown':
            ready = false;
            setStatus('exited');
            ws.close();
            break;
          case 'error':
            failProtocol(
              msg.message.value.code
                ? `${msg.message.value.code}: ${msg.message.value.message}`
                : msg.message.value.message,
            );
            break;
          default:
            break;
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const data = event.data as ArrayBuffer | ArrayBufferView;
        const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
        failProtocol(`decode failed for ${byteLength} bytes: ${message}`);
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
    get dirtyRows() {
      return painter.dirtyRows;
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
    get error() {
      return error;
    },
    get canResizeGrid() {
      return ready && socket?.readyState === WebSocket.OPEN && !readonly && !disposed;
    },
    get mouseTracking() {
      if (serverMouseModeKnown) return serverMouseMode ?? 'none';
      if (mouseTrackingDisabled) return 'none';
      const mode = terminal.modes?.mouseTrackingMode as TerminalMouseTrackingMode | undefined;
      return mode && mode !== 'none' ? mode : mouseTrackingFallback;
    },
    connect,
    flush,
    disconnect: () => {
      if (disposed || paused) return;
      paused = true;
      ready = false;
      generation += 1;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      cancelPaint();
      const current = socket;
      socket = null;
      current?.close();
      setStatus('paused');
    },
    sendText: (text) => send(createInputMessage(text)),
    sendKey: (key, modifiers) =>
      send(
        createInputMessage(
          terminalKeyBytes(key, modifiers, terminal.modes?.applicationCursorKeysMode ?? appCursor),
        ),
      ),
    sendMouse: (input: TerminalMouseInput): boolean => {
      if (
        !Number.isInteger(input.col) ||
        !Number.isInteger(input.row) ||
        input.col < 0 ||
        input.col >= cols ||
        input.row < 0 ||
        input.row >= rows
      )
        return false;
      const mode = surface.mouseTracking;
      if (mode === 'none') return false;
      if (input.eventType === 'move' && mode !== 'drag' && mode !== 'any') return false;
      if (input.eventType !== 'move' && mode === 'x10' && input.eventType !== 'press') return false;
      return send(createMouseMessage(input));
    },
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
      cancelPaint();
      paint();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      paused = false;
      ready = false;
      generation += 1;
      if (retry) clearTimeout(retry);
      cancelPaint();
      const current = socket;
      socket = null;
      current?.close();
      terminal.dispose();
      host.remove();
      setStatus('closed');
    },
  };
  paint(false);
  return surface;
}
