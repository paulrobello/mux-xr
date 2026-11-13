import { Terminal } from '@xterm/xterm';
import type {
  KeyModifiers,
  PaneDescriptor,
  TerminalCellPosition,
  TerminalColorMode,
  TerminalMouseInput,
  TerminalMouseTrackingMode,
  TerminalRenderQuality,
  TerminalStatus,
  TerminalSurface,
} from '../contracts';
import {
  type PaneProcess,
  parsePaneProcess,
  RUNNING_PROCESS,
  samePaneId,
  sameProcess,
} from './lifecycle';
import { createTerminalPainter, type TerminalDamageHint } from './painter';
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
const QUALITY_INTERVAL_MS: Record<Exclude<TerminalRenderQuality, 'full' | 'hidden'>, number> = {
  medium: 1000 / 15,
  low: 1000 / 5,
};
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
const MAX_SCROLL_WHEEL_EVENTS = 32;

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
    Insert: '\x1b[2~',
    Delete: '\x1b[3~',
    Home: applicationCursor ? '\x1bOH' : '\x1b[H',
    End: applicationCursor ? '\x1bOF' : '\x1b[F',
    PageUp: '\x1b[5~',
    PageDown: '\x1b[6~',
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
  if (code?.endsWith('~')) return `${code.slice(0, -1)};${mod + 1}~`;
  if (code?.startsWith('\x1b[')) return `\x1b[1;${mod + 1}${code.slice(2)}`;
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

/** The page keyboard router owns physical keys; a focused xterm would otherwise cancel and stop every keydown. */
export function ignoreXtermKeys(terminal: Pick<Terminal, 'attachCustomKeyEventHandler'>): void {
  terminal.attachCustomKeyEventHandler(() => false);
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
  ignoreXtermKeys(terminal);
  let socket: SocketLike | null = null;
  let status: TerminalStatus = 'disconnected';
  let revision = 0;
  let disposed = false;
  let ready = false;
  let retries = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let paintFrame: number | ReturnType<typeof setTimeout> | null = null;
  let paintFrameKind: 'raf' | 'timeout' | null = null;
  let pendingPaintGuard: (() => boolean) | null = null;
  let pendingPaint = false;
  let renderQuality: TerminalRenderQuality = 'full';
  let lastPaintAt = 0;
  let appCursor = false;
  let readonly = false;
  let colorMode: TerminalColorMode = 'comfort';
  let generation = 0;
  // Bumped when the grid changes size or resets; hints computed before that no longer address its rows.
  let gridEpoch = 0;
  let bellPending = false;
  let bellAckEpoch = 0;
  type WriteContext = { generation: number; ackEpoch: number; liveOutput: boolean };
  const writeContexts: WriteContext[] = [];
  let parsingContext: WriteContext | null = null;
  let paused = false;
  let mouseTrackingFallback: TerminalMouseTrackingMode = 'none';
  let mouseTrackingDisabled = false;
  let serverMouseMode: TerminalMouseTrackingMode | null = null;
  let serverMouseModeKnown = false;
  let selectionAnchor: TerminalCellPosition | null = null;
  let selectionMarker: { line: number; dispose(): void } | undefined;
  let selectionBufferType: string | undefined;
  let error: string | null = null;
  let processState: PaneProcess = pane.process ?? RUNNING_PROCESS;
  let cwd: string | null = null;
  let cwdHost: string | null = null;
  let paneCreateAllowed: boolean | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const acknowledgeBell = (): void => {
    bellAckEpoch += 1;
    if (bellPending) {
      bellPending = false;
      notify();
    }
  };
  const markBell = (token?: number, explicit = false): void => {
    if (disposed || paused || !ready) return;
    const context = parsingContext ?? writeContexts[0];
    if (
      !explicit &&
      (!context?.liveOutput ||
        context.generation !== generation ||
        context.ackEpoch !== bellAckEpoch)
    )
      return;
    if (token !== undefined && token !== generation) return;
    if (!bellPending) {
      bellPending = true;
      notify();
    }
  };
  const writeTerminal = (
    data: Uint8Array,
    token: number,
    liveOutput: boolean,
    damage: TerminalDamageHint | null = null,
  ): void => {
    const context: WriteContext = { generation: token, ackEpoch: bellAckEpoch, liveOutput };
    const epoch = gridEpoch;
    writeContexts.push(context);
    parsingContext = context;
    terminal.write(data, () => {
      const index = writeContexts.indexOf(context);
      if (index >= 0) writeContexts.splice(index, 1);
      if (parsingContext === context) parsingContext = null;
      // Damage describes the screen after these bytes, so it lands once xterm has parsed them.
      painter.noteOutput(token === generation && epoch === gridEpoch ? damage : null);
      queuePaint(() => token === generation);
    });
    if (parsingContext === context) parsingContext = null;
  };
  const painter = createTerminalPainter(canvas, terminal, {
    audit: (globalThis as { __muxXRDamageAudit?: boolean }).__muxXRDamageAudit === true,
  });
  const paint = (emit = true): void => {
    if (renderQuality === 'hidden') return;
    pendingPaint = false;
    const scale = renderQuality === 'full' ? 1 : renderQuality === 'medium' ? 0.5 : 0.25;
    const painted = painter.paint(cols, rows, colorMode, scale);
    if (painted) lastPaintAt = Date.now();
    if (painter.redrawPending) queuePaint();
    if (!painted) return;
    if (emit) {
      revision += 1;
      notify();
    }
  };
  const cancelPaint = (): void => {
    if (paintFrame === null) return;
    if (
      paintFrameKind === 'raf' &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    )
      window.cancelAnimationFrame(paintFrame as number);
    else clearTimeout(paintFrame as ReturnType<typeof setTimeout>);
    paintFrame = null;
    paintFrameKind = null;
    pendingPaintGuard = null;
  };
  const queuePaint = (isCurrent: () => boolean = () => true): void => {
    if (disposed || paused || !isCurrent()) return;
    pendingPaint = true;
    pendingPaintGuard = isCurrent;
    if (renderQuality === 'hidden') return;
    if (paintFrame !== null) return;
    const frame = (): void => {
      paintFrame = null;
      paintFrameKind = null;
      const guard = pendingPaintGuard;
      pendingPaintGuard = null;
      if (disposed || paused || !guard?.()) return;
      paint();
    };
    const interval = renderQuality === 'full' ? 0 : QUALITY_INTERVAL_MS[renderQuality];
    const delay = Math.max(0, interval - (Date.now() - lastPaintAt));
    if (delay > 0) {
      paintFrame = setTimeout(frame, delay);
      paintFrameKind = 'timeout';
    } else if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      paintFrame = window.requestAnimationFrame(frame);
      paintFrameKind = 'raf';
    } else {
      paintFrame = setTimeout(frame, 0);
      paintFrameKind = 'timeout';
    }
  };
  const flush = (): void => {
    if (paintFrame === null && !pendingPaint) return;
    const guard = pendingPaintGuard;
    if (disposed || paused || renderQuality === 'hidden') return;
    const interval = renderQuality === 'full' ? 0 : QUALITY_INTERVAL_MS[renderQuality];
    if (Date.now() - lastPaintAt < interval) {
      if (paintFrame === null) queuePaint(guard ?? (() => true));
      return;
    }
    if (paintFrame !== null) cancelPaint();
    pendingPaintGuard = null;
    if (guard?.() ?? pendingPaint) paint();
  };
  const setStatus = (next: TerminalStatus): void => {
    if (status !== next) {
      status = next;
      notify();
    }
  };
  const invalidateSelection = (): void => {
    selectionAnchor = null;
    selectionBufferType = undefined;
    selectionMarker?.dispose();
    selectionMarker = undefined;
    terminal.clearSelection?.();
  };
  const paintSelection = (): void => {
    if (!disposed && renderQuality !== 'hidden') paint();
  };
  const selectionCell = (cell: TerminalCellPosition): TerminalCellPosition | null => {
    if (!Number.isInteger(cell.col) || !Number.isInteger(cell.row)) return null;
    if (cell.col < 0 || cell.col >= cols || cell.row < 0 || cell.row >= rows) return null;
    const line = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + cell.row);
    let col = cell.col;
    while (col > 0 && line?.getCell(col)?.getWidth() === 0) col -= 1;
    return { col, row: cell.row };
  };
  terminal.onSelectionChange?.(() => {
    if (!terminal.hasSelection()) {
      selectionAnchor = null;
      selectionBufferType = undefined;
      selectionMarker?.dispose();
      selectionMarker = undefined;
    } else if (selectionMarker?.line === -1) invalidateSelection();
  });
  const bellSubscription = terminal.onBell?.(() => markBell());
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
            cwd = connected.cwd?.startsWith('/') ? connected.cwd : null;
            cwdHost = cwd ? (connected.cwdHostname ?? null) : null;
            paneCreateAllowed = connected.paneCreateAllowed;
            mouseTrackingFallback = 'none';
            mouseTrackingDisabled = false;
            serverMouseMode = null;
            serverMouseModeKnown = false;
            retries = 0;
            // The server replays only a stored PaneProcessState and stores none for a pane that never changed state, so silence means running.
            // The tree seed covers only the connecting phase before this message.
            processState = RUNNING_PROCESS;
            if (validGrid(connected.cols, connected.rows)) {
              cols = connected.cols;
              rows = connected.rows;
            }
            gridEpoch += 1;
            terminal.resize(cols, rows);
            terminal.reset();
            painter.resetDamage();
            invalidateSelection();
            const current = (): boolean => token === generation;
            if (connected.initialScreen?.length)
              writeTerminal(connected.initialScreen, token, false);
            else queuePaint(current);
            setStatus('connected');
            break;
          }
          case 'output': {
            const output = msg.message.value;
            // Both fields absent means unknown damage; a resync frame arrives this way.
            const damage =
              output.damageGeneration === undefined
                ? null
                : { generation: output.damageGeneration, ranges: output.damage };
            writeTerminal(output.data, token, true, damage);
            break;
          }
          case 'bell':
            markBell(token, true);
            break;
          case 'resize':
            if (!validGrid(msg.message.value.cols, msg.message.value.rows)) break;
            cols = msg.message.value.cols;
            rows = msg.message.value.rows;
            gridEpoch += 1;
            terminal.resize(cols, rows);
            // A reflow moves rows, so the previous chunk's seam rows no longer apply.
            painter.noteOutput(null);
            invalidateSelection();
            cancelPaint();
            queuePaint();
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
          case 'paneProcessState': {
            const { paneId, state, exitCode } = msg.message.value;
            if (paneId !== '' && !samePaneId(paneId, pane.id)) break;
            const next = parsePaneProcess(state, exitCode);
            if (next && !sameProcess(processState, next)) {
              processState = next;
              notify();
            }
            break;
          }
          case 'cwdChanged': {
            const change = msg.message.value;
            cwd = change.newCwd.startsWith('/') ? change.newCwd : null;
            cwdHost = cwd ? (change.hostname ?? null) : null;
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
  const streamIdentity = new URL(paneWebSocketURL(endpoint, pane.id));
  const surface: TerminalSurface = {
    serverId: `${streamIdentity.origin}${streamIdentity.pathname}`,
    canvas,
    pane,
    get revision() {
      return revision;
    },
    get dirtyRows() {
      return painter.dirtyRows;
    },
    get damageStats() {
      return painter.damageStats;
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
    get process() {
      return processState;
    },
    get cwd() {
      return cwd;
    },
    get cwdHost() {
      return cwdHost;
    },
    get paneCreateAllowed() {
      return paneCreateAllowed;
    },
    get bellPending() {
      return bellPending;
    },
    acknowledgeBell,
    get canResizeGrid() {
      return ready && socket?.readyState === WebSocket.OPEN && !readonly && !disposed;
    },
    get renderQuality() {
      return renderQuality;
    },
    setRenderQuality: (quality) => {
      if (renderQuality === quality || disposed) return;
      renderQuality = quality;
      cancelPaint();
      pendingPaint = true;
      if (!paused && quality === 'full') paint();
      else if (!paused && quality !== 'hidden') queuePaint();
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
    get applicationCursor() {
      return terminal.modes?.applicationCursorKeysMode ?? appCursor;
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
      if (
        input.eventType !== 'move' &&
        input.eventType !== 'scroll' &&
        mode === 'x10' &&
        input.eventType !== 'press'
      )
        return false;
      return send(createMouseMessage(input));
    },
    beginSelection: (cell): boolean => {
      if (disposed || surface.mouseTracking !== 'none') return false;
      const valid = selectionCell(cell);
      if (!valid) return false;
      selectionAnchor = { col: valid.col, row: valid.row + terminal.buffer.active.viewportY };
      selectionBufferType = terminal.buffer.active.type;
      selectionMarker?.dispose();
      selectionMarker = terminal.registerMarker?.(
        selectionAnchor.row - (terminal.buffer.active.baseY + terminal.buffer.active.cursorY),
      );
      terminal.select(valid.col, valid.row + terminal.buffer.active.viewportY, 1);
      paintSelection();
      return true;
    },
    updateSelection: (cell): void => {
      if (disposed || !selectionAnchor) return;
      if (selectionMarker?.line === -1 || selectionBufferType !== terminal.buffer.active.type) {
        invalidateSelection();
        paintSelection();
        return;
      }
      const valid = selectionCell(cell);
      if (!valid) return;
      const anchorRow = selectionMarker?.line ?? selectionAnchor.row;
      const anchorOffset = anchorRow * cols + selectionAnchor.col;
      const endOffset = (valid.row + terminal.buffer.active.viewportY) * cols + valid.col;
      const startOffset = Math.min(anchorOffset, endOffset);
      terminal.select(
        startOffset % cols,
        Math.floor(startOffset / cols),
        Math.abs(endOffset - anchorOffset) + 1,
      );
      paintSelection();
    },
    getSelectionText: (): string => {
      if (
        selectionMarker?.line === -1 ||
        (selectionAnchor && selectionBufferType !== terminal.buffer.active.type)
      ) {
        invalidateSelection();
        paintSelection();
        return '';
      }
      if (!terminal.hasSelection?.()) {
        selectionAnchor = null;
        return '';
      }
      return terminal.getSelection();
    },
    clearSelection: (): void => {
      if (disposed) return;
      invalidateSelection();
      paintSelection();
    },
    scroll: (lines, cell = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) }): boolean => {
      if (!Number.isFinite(lines) || lines === 0 || disposed) return false;
      const wholeLines = Math.trunc(lines);
      if (wholeLines === 0) return false;
      const col = Math.max(0, Math.min(cols - 1, Math.trunc(cell.col)));
      const row = Math.max(0, Math.min(rows - 1, Math.trunc(cell.row)));
      const mode = surface.mouseTracking;
      const remote = mode !== 'none' && ready && !readonly && socket?.readyState === WebSocket.OPEN;
      if (remote) {
        const button = wholeLines < 0 ? 64 : 65;
        const count = Math.min(Math.abs(wholeLines), MAX_SCROLL_WHEEL_EVENTS);
        let handled = true;
        for (let index = 0; index < count; index += 1) {
          handled =
            (surface.sendMouse?.({ col, row, button, eventType: 'scroll' }) ?? false) && handled;
        }
        return handled;
      }
      terminal.scrollLines(wholeLines);
      painter.invalidate();
      paint();
      return true;
    },
    paste: (text) => send(createPasteMessage(text)),
    focus: (focused, moveDomFocus = true) => {
      if (focused) acknowledgeBell();
      if (moveDomFocus) {
        if (focused) terminal.focus();
        else terminal.blur();
      }
      return send(createFocusMessage(focused));
    },
    resizeGrid: (nextCols, nextRows) => {
      if (!validGrid(nextCols, nextRows) || !ready || readonly || disposed) return false;
      return send(createResizeMessage(nextCols, nextRows));
    },
    setColorMode: (mode) => {
      if (colorMode === mode || disposed) return;
      colorMode = mode;
      cancelPaint();
      if (renderQuality === 'full') paint();
      else queuePaint();
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
      writeContexts.length = 0;
      parsingContext = null;
      bellPending = false;
      bellSubscription?.dispose();
      selectionMarker?.dispose();
      selectionMarker = undefined;
      selectionAnchor = null;
      host.remove();
      setStatus('closed');
    },
  };
  paint(false);
  return surface;
}
