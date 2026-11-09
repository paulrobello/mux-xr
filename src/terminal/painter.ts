import type { IBufferCell, IBufferLine, Terminal } from '@xterm/xterm';
import type { TerminalColorMode, TerminalDamageStats } from '../contracts';
import { terminalColor } from './colors';

const CELL_WIDTH = 11;
const LINE_HEIGHT = 21;
const FONT_SIZE = 18;
const DEFAULT_FOREGROUND = '#d8e1ef';
const CANVAS_BACKGROUND = '#05070b';
const MONOCHROME_BACKGROUND = '#070707';
const MAX_PENDING_RANGES = 256;

type SelectionPosition = { start: { x: number; y: number }; end: { x: number; y: number } } | null;
type TerminalLike = Pick<Terminal, 'buffer'> & {
  getSelectionPosition?: () => SelectionPosition | undefined;
};
type PainterContext = CanvasRenderingContext2D;

/** Rows one output chunk changed, as the streamer reports them (inclusive, viewport-relative). */
export interface TerminalDamageHint {
  generation: bigint;
  ranges: ReadonlyArray<{ startRow: number; endRow: number }>;
}

export interface TerminalPainterOptions {
  /** Shadow-scan every row after a hinted paint and count rows the hint missed. */
  audit?: boolean;
}

export interface TerminalPainter {
  readonly dirtyRows: Uint8Array;
  readonly damageStats: TerminalDamageStats;
  paint(
    cols: number,
    rows: number,
    colorMode: TerminalColorMode,
    resolutionScale?: number,
  ): boolean;
  invalidate(): void;
  /** Record one parsed output chunk; `null` means its damage is unknown. */
  noteOutput(hint: TerminalDamageHint | null): void;
  /** Forget damage tracking, as on a fresh connection; scans fully until the next hint. */
  resetDamage(): void;
}

export function createTerminalPainter(
  canvas: HTMLCanvasElement,
  terminal: TerminalLike,
  options: TerminalPainterOptions = {},
): TerminalPainter {
  let cachedCols = 0;
  let cachedRows = 0;
  let initialized = false;
  let invalidated = true;
  let cachedMode: TerminalColorMode | null = null;
  let cachedDensity = 0;
  let cachedChars: string[] = [];
  let cachedWidth = new Uint8Array(0);
  let cachedFgMode = new Int32Array(0);
  let cachedFgValue = new Int32Array(0);
  let cachedBgMode = new Int32Array(0);
  let cachedBgValue = new Int32Array(0);
  let cachedFlags = new Uint8Array(0);
  let dirtyRows = new Uint8Array(0);
  let previousCursorRow = -1;
  let previousCursorX = -1;
  let previousSelectionKey = '';
  let previousViewportY = 0;
  let previousBaseY = 0;
  let previousBufferType: string | undefined;
  // Damage tracking stays off until a valid hint arrives, so sources without
  // hints (demo content, older streamers) keep scanning every row.
  let tracking = false;
  let forceFullScan = true;
  let lastGeneration: bigint | undefined;
  let pendingRanges: Array<[number, number]> = [];
  // A glyph split at a relay chunk seam lands one chunk after its row was
  // reported, so each chunk also rescans the previous chunk's rows; null means
  // the previous chunk's rows are unknown.
  let previousChunk: Array<[number, number]> | null = [];
  let scanRows = new Uint8Array(0);
  const damageStats: TerminalDamageStats = {
    damageScans: 0,
    fullScans: 0,
    rowsScanned: 0,
    rejectedHints: 0,
    auditMisses: 0,
    fullScanReasons: {},
  };

  const validRanges = (hint: TerminalDamageHint): Array<[number, number]> | null => {
    if (lastGeneration !== undefined && hint.generation < lastGeneration) return null;
    const ranges: Array<[number, number]> = [];
    let previousEnd = -1;
    for (const { startRow, endRow } of hint.ranges) {
      if (!Number.isInteger(startRow) || !Number.isInteger(endRow)) return null;
      if (startRow <= previousEnd || endRow < startRow) return null;
      ranges.push([startRow, endRow]);
      previousEnd = endRow;
    }
    return ranges;
  };

  const selectionKey = (selection: SelectionPosition | undefined): string => {
    return selection
      ? `${selection.start.x},${selection.start.y}:${selection.end.x},${selection.end.y}`
      : '';
  };

  const selectionContains = (
    selection: SelectionPosition | undefined,
    col: number,
    bufferRow: number,
  ): boolean => {
    if (!selection) return false;
    const { start: rawStart, end: rawEnd } = selection;
    const start =
      rawStart.y < rawEnd.y || (rawStart.y === rawEnd.y && rawStart.x <= rawEnd.x)
        ? rawStart
        : rawEnd;
    const end = start === rawStart ? rawEnd : rawStart;
    if (bufferRow < start.y || bufferRow > end.y) return false;
    if (start.y === end.y) return col >= start.x && col < end.x;
    if (bufferRow === start.y) return col >= start.x;
    if (bufferRow === end.y) return col < end.x;
    return true;
  };

  const resizeCache = (cols: number, rows: number): void => {
    const length = cols * rows;
    cachedChars = new Array<string>(length).fill('');
    cachedWidth = new Uint8Array(length);
    cachedFgMode = new Int32Array(length);
    cachedFgValue = new Int32Array(length);
    cachedBgMode = new Int32Array(length);
    cachedBgValue = new Int32Array(length);
    cachedFlags = new Uint8Array(length);
    dirtyRows = new Uint8Array(rows);
    scanRows = new Uint8Array(rows);
  };

  const markRanges = (ranges: Array<[number, number]>, rows: number): boolean => {
    for (const [start, end] of ranges) {
      if (end >= rows) return false;
      scanRows.fill(1, start, end + 1);
    }
    return true;
  };

  const setFillStyle = (ctx: PainterContext, value: string): void => {
    if (ctx.fillStyle !== value) ctx.fillStyle = value;
  };

  const readCell = (cell: IBufferCell | undefined, index: number): boolean => {
    const width = cell?.getWidth() ?? 0;
    const chars = cell?.getChars() ?? '';
    const fgMode = cell ? (cell.isFgRGB() ? 2 : cell.isFgPalette() ? 1 : 0) : 0;
    const fgValue = cell?.getFgColor() ?? 0;
    const bgMode = cell ? (cell.isBgRGB() ? 2 : cell.isBgPalette() ? 1 : 0) : 0;
    const bgValue = cell?.getBgColor() ?? 0;
    const flags = cell
      ? (cell.isBold() ? 1 : 0) |
        (cell.isItalic() ? 2 : 0) |
        (cell.isUnderline() ? 4 : 0) |
        (cell.isInverse() ? 8 : 0)
      : 0;
    const changed =
      cachedChars[index] !== chars ||
      cachedWidth[index] !== width ||
      cachedFgMode[index] !== fgMode ||
      cachedFgValue[index] !== fgValue ||
      cachedBgMode[index] !== bgMode ||
      cachedBgValue[index] !== bgValue ||
      cachedFlags[index] !== flags;
    cachedChars[index] = chars;
    cachedWidth[index] = width;
    cachedFgMode[index] = fgMode;
    cachedFgValue[index] = fgValue;
    cachedBgMode[index] = bgMode;
    cachedBgValue[index] = bgValue;
    cachedFlags[index] = flags;
    return changed;
  };

  const drawRow = (
    ctx: PainterContext,
    row: number,
    cols: number,
    colorMode: TerminalColorMode,
    background: string,
    cell: IBufferCell,
    selection: SelectionPosition | undefined,
  ): void => {
    setFillStyle(ctx, background);
    ctx.fillRect(0, row * LINE_HEIGHT, cols * CELL_WIDTH, LINE_HEIGHT);
    const line: IBufferLine | undefined = terminal.buffer.active.getLine(
      terminal.buffer.active.viewportY + row,
    );
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const current = line?.getCell(col, cell);
      const width = cachedWidth[index];
      const x = col * CELL_WIDTH;
      if (!current || width === 0) continue;
      const bufferRow = terminal.buffer.active.viewportY + row;
      const selected =
        selectionContains(selection, col, bufferRow) ||
        (width === 2 && selectionContains(selection, col + 1, bufferRow));
      const inverse = (cachedFlags[index] & 8) !== 0;
      const fg = terminalColor(
        colorMode,
        current.isFgRGB(),
        current.isFgPalette(),
        cachedFgValue[index],
        DEFAULT_FOREGROUND,
        (cachedFlags[index] & 1) !== 0,
        false,
      );
      const bg = terminalColor(
        colorMode,
        current.isBgRGB(),
        current.isBgPalette(),
        cachedBgValue[index],
        background,
        false,
        true,
      );
      const foreground = selected ? '#ffffff' : inverse ? bg : fg;
      const cellBackground = selected ? '#284f5b' : inverse ? fg : bg;
      if (cellBackground !== background) {
        setFillStyle(ctx, cellBackground);
        ctx.fillRect(x, row * LINE_HEIGHT, Math.max(1, width) * CELL_WIDTH, LINE_HEIGHT);
      }
      const chars = cachedChars[index];
      if (!chars) continue;
      setFillStyle(ctx, foreground);
      const font = `${(cachedFlags[index] & 1) !== 0 ? 'bold ' : ''}${
        (cachedFlags[index] & 2) !== 0 ? 'italic ' : ''
      }${FONT_SIZE}px monospace`;
      if (ctx.font !== font) ctx.font = font;
      ctx.fillText(chars, x, row * LINE_HEIGHT);
      if ((cachedFlags[index] & 4) !== 0) {
        ctx.fillRect(x, (row + 1) * LINE_HEIGHT - 2, Math.max(1, width) * CELL_WIDTH, 1);
      }
    }
  };

  return {
    get dirtyRows(): Uint8Array {
      return dirtyRows;
    },
    paint(cols, rows, colorMode, resolutionScale = 1): boolean {
      const scale = resolutionScale > 0 ? resolutionScale : 1;
      const density =
        Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2) * scale;
      const dimensionsChanged = cols !== cachedCols || rows !== cachedRows;
      if (dimensionsChanged) {
        cachedCols = cols;
        cachedRows = rows;
        resizeCache(cols, rows);
        invalidated = true;
      }
      const logicalWidth = cols * CELL_WIDTH;
      const logicalHeight = rows * LINE_HEIGHT;
      const width = Math.max(1, Math.round(logicalWidth * density));
      const height = Math.max(1, Math.round(logicalHeight * density));
      const canvasChanged = canvas.width !== width || canvas.height !== height;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const styleWidth = `${logicalWidth}px`;
      const styleHeight = `${logicalHeight}px`;
      if (canvas.style.width !== styleWidth) canvas.style.width = styleWidth;
      if (canvas.style.height !== styleHeight) canvas.style.height = styleHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      const background = colorMode === 'monochrome' ? MONOCHROME_BACKGROUND : CANVAS_BACKGROUND;
      const full =
        !initialized ||
        invalidated ||
        canvasChanged ||
        density !== cachedDensity ||
        colorMode !== cachedMode;
      const active = terminal.buffer.active;
      const selection = terminal.getSelectionPosition?.();
      const currentSelectionKey = selectionKey(selection);
      const cursorRow = active.baseY + active.cursorY - active.viewportY;
      dirtyRows.fill(0);
      if (full) dirtyRows.fill(1);
      if (currentSelectionKey !== previousSelectionKey || active.viewportY !== previousViewportY) {
        const markSelectionRows = (key: string, viewportY: number): void => {
          if (!key) return;
          const [start, end] = key.split(':').map((part) => part.split(',').map(Number));
          const first = Math.min(start[1], end[1]) - viewportY;
          const last = Math.max(start[1], end[1]) - viewportY;
          for (let row = Math.max(0, first); row <= Math.min(rows - 1, last); row += 1)
            dirtyRows[row] = 1;
        };
        markSelectionRows(previousSelectionKey, previousViewportY);
        markSelectionRows(currentSelectionKey, active.viewportY);
      }
      const cell = active.getNullCell();
      // Hints describe the live screen, so a scrolled-back view, a local
      // scroll or a buffer switch rescans everything.
      const reason = !tracking
        ? 'untracked'
        : forceFullScan
          ? 'unhinted'
          : full
            ? 'invalidated'
            : active.viewportY !== active.baseY
              ? 'viewport'
              : active.baseY !== previousBaseY
                ? 'scrolled'
                : active.viewportY !== previousViewportY
                  ? 'viewport'
                  : active.type !== previousBufferType
                    ? 'buffer'
                    : null;
      scanRows.fill(0);
      let scanAll = reason !== null;
      if (!scanAll && !markRanges(pendingRanges, rows)) scanAll = true;
      const fullReason = reason ?? (scanAll ? 'bounds' : null);
      if (fullReason)
        damageStats.fullScanReasons[fullReason] =
          (damageStats.fullScanReasons[fullReason] ?? 0) + 1;
      if (!scanAll) {
        for (const row of [previousCursorRow, cursorRow])
          if (row >= 0 && row < rows) scanRows[row] = 1;
      }
      const scanRow = (row: number): boolean => {
        const line = active.getLine(active.viewportY + row);
        let changed = false;
        for (let col = 0; col < cols; col += 1) {
          if (readCell(line?.getCell(col, cell), row * cols + col)) changed = true;
        }
        return changed;
      };
      for (let row = 0; row < rows; row += 1) {
        if (!scanAll && !scanRows[row]) continue;
        damageStats.rowsScanned += 1;
        if (scanRow(row)) dirtyRows[row] = 1;
      }
      if (scanAll) damageStats.fullScans += 1;
      else {
        damageStats.damageScans += 1;
        if (options.audit) {
          for (let row = 0; row < rows; row += 1) {
            if (scanRows[row] || !scanRow(row)) continue;
            damageStats.auditMisses += 1;
            dirtyRows[row] = 1;
          }
        }
      }
      pendingRanges = [];
      forceFullScan = false;
      const cursorChanged = cursorRow !== previousCursorRow || active.cursorX !== previousCursorX;
      if (cursorChanged && previousCursorRow >= 0 && previousCursorRow < rows)
        dirtyRows[previousCursorRow] = 1;
      if (cursorRow >= 0 && cursorRow < rows) {
        if (cursorChanged) dirtyRows[cursorRow] = 1;
      }
      let changed = full;
      ctx.setTransform(density, 0, 0, density, 0, 0);
      if (ctx.textBaseline !== 'top') ctx.textBaseline = 'top';
      if (ctx.strokeStyle !== '#ffffff') ctx.strokeStyle = '#ffffff';
      for (let row = 0; row < rows; row += 1) {
        if (!dirtyRows[row]) continue;
        drawRow(ctx, row, cols, colorMode, background, cell, selection);
        changed = true;
      }
      if (cursorRow >= 0 && cursorRow < rows && (dirtyRows[cursorRow] !== 0 || full)) {
        ctx.strokeRect(
          active.cursorX * CELL_WIDTH + 0.5,
          cursorRow * LINE_HEIGHT + 0.5,
          CELL_WIDTH - 1,
          LINE_HEIGHT - 1,
        );
      }
      initialized = true;
      invalidated = false;
      cachedMode = colorMode;
      cachedDensity = density;
      previousCursorRow = cursorRow;
      previousCursorX = active.cursorX;
      previousSelectionKey = currentSelectionKey;
      previousViewportY = active.viewportY;
      previousBaseY = active.baseY;
      previousBufferType = active.type;
      return changed;
    },
    invalidate(): void {
      invalidated = true;
    },
    get damageStats(): TerminalDamageStats {
      return damageStats;
    },
    noteOutput(hint): void {
      const ranges = hint ? validRanges(hint) : null;
      if (!hint || !ranges) {
        if (hint) damageStats.rejectedHints += 1;
        forceFullScan = true;
        previousChunk = null;
        return;
      }
      tracking = true;
      lastGeneration = hint.generation;
      const seam = previousChunk;
      previousChunk = ranges;
      if (forceFullScan || seam === null) {
        forceFullScan = true;
        return;
      }
      // A hidden pane still parses output but does not paint; past this many
      // queued ranges a full scan is cheaper than replaying them.
      if (pendingRanges.length + seam.length + ranges.length > MAX_PENDING_RANGES) {
        forceFullScan = true;
        pendingRanges = [];
        return;
      }
      pendingRanges.push(...seam, ...ranges);
    },
    resetDamage(): void {
      tracking = false;
      forceFullScan = true;
      lastGeneration = undefined;
      pendingRanges = [];
      previousChunk = [];
    },
  };
}
