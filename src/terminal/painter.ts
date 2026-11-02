import type { IBufferCell, IBufferLine, Terminal } from '@xterm/xterm';
import type { TerminalColorMode } from '../contracts';
import { terminalColor } from './colors';

const CELL_WIDTH = 11;
const LINE_HEIGHT = 21;
const FONT_SIZE = 18;
const DEFAULT_FOREGROUND = '#d8e1ef';
const CANVAS_BACKGROUND = '#05070b';
const MONOCHROME_BACKGROUND = '#070707';

type TerminalLike = Pick<Terminal, 'buffer'>;
type PainterContext = CanvasRenderingContext2D;

export interface TerminalPainter {
  readonly dirtyRows: Uint8Array;
  paint(
    cols: number,
    rows: number,
    colorMode: TerminalColorMode,
    resolutionScale?: number,
  ): boolean;
  invalidate(): void;
}

export function createTerminalPainter(
  canvas: HTMLCanvasElement,
  terminal: TerminalLike,
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
      if (!current || width === 0) continue;
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
      const foreground = inverse ? bg : fg;
      const cellBackground = inverse ? fg : bg;
      const x = col * CELL_WIDTH;
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
      const cursorRow = active.baseY + active.cursorY - active.viewportY;
      dirtyRows.fill(0);
      if (full) dirtyRows.fill(1);
      const cell = active.getNullCell();
      for (let row = 0; row < rows; row += 1) {
        const line = active.getLine(active.viewportY + row);
        for (let col = 0; col < cols; col += 1) {
          if (readCell(line?.getCell(col, cell), row * cols + col)) dirtyRows[row] = 1;
        }
      }
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
        drawRow(ctx, row, cols, colorMode, background, cell);
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
      return changed;
    },
    invalidate(): void {
      invalidated = true;
    },
  };
}
