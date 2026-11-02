import { describe, expect, it, vi } from 'vitest';
import { createTerminalPainter } from '../src/terminal/painter';

type CellState = {
  chars?: string;
  width?: number;
  fgMode?: number;
  fg?: number;
  bgMode?: number;
  bg?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};

function cell(state: CellState = {}): Record<string, unknown> {
  const s = { chars: '', width: 1, fgMode: 0, fg: 0, bgMode: 0, bg: 0, ...state };
  return {
    getChars: () => s.chars,
    getWidth: () => s.width,
    getFgColor: () => s.fg,
    getBgColor: () => s.bg,
    isBold: () => Number(s.bold),
    isItalic: () => Number(s.italic),
    isUnderline: () => Number(s.underline),
    isInverse: () => Number(s.inverse),
    isFgRGB: () => s.fgMode === 2,
    isFgPalette: () => s.fgMode === 1,
    isBgRGB: () => s.bgMode === 2,
    isBgPalette: () => s.bgMode === 1,
  };
}

function fixture(
  cols = 4,
  rows = 3,
): {
  canvas: HTMLCanvasElement;
  terminal: { buffer: { active: Record<string, unknown> } };
  lines: Record<string, unknown>[][];
  context: Record<string, unknown>;
} {
  const lines = Array.from({ length: rows + 2 }, () => Array.from({ length: cols }, () => cell()));
  const active = {
    viewportY: 0,
    baseY: 0,
    cursorY: 0,
    cursorX: 0,
    getNullCell: () => cell(),
    getLine: (row: number) => ({ getCell: (column: number) => lines[row]?.[column] }),
  };
  const calls: string[] = [];
  const context = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: '',
    setTransform: vi.fn(),
    fillRect: vi.fn(() => calls.push('fill')),
    fillText: vi.fn(() => calls.push('text')),
    strokeRect: vi.fn(() => calls.push('stroke')),
    calls,
  } as unknown as Record<string, unknown>;
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return { canvas, terminal: { buffer: { active } }, lines, context };
}

describe('terminal painter', () => {
  it('paints every row initially, then only a changed spinner row', () => {
    const f = fixture();
    f.lines[0][0] = cell({ chars: 'a' });
    f.lines[1][0] = cell({ chars: 'b' });
    f.lines[2][0] = cell({ chars: 'c' });
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    const first = f.context.calls as string[];
    expect(first.filter((value) => value === 'fill').length).toBeGreaterThanOrEqual(3);
    first.length = 0;
    f.lines[1][0] = cell({ chars: 'B' });
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    expect(first.filter((value) => value === 'fill').length).toBe(1);
    expect(first.filter((value) => value === 'text').length).toBe(1);
  });

  it('does no canvas writes for unchanged output and repaints cursor movement', () => {
    const f = fixture();
    f.lines[0][0] = cell({ chars: 'x' });
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    painter.paint(4, 3, 'comfort');
    const calls = f.context.calls as string[];
    calls.length = 0;
    expect(painter.paint(4, 3, 'comfort')).toBe(false);
    expect(calls).toEqual([]);
    f.terminal.buffer.active.cursorX = 1;
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    expect(calls.filter((value) => value === 'fill')).toHaveLength(1);
    expect(calls.filter((value) => value === 'stroke')).toHaveLength(1);
    f.terminal.buffer.active.cursorY = 1;
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    expect(calls.filter((value) => value === 'fill')).toHaveLength(3);
  });

  it('repaints on style, mode, resize, density, and explicit invalidation changes', () => {
    const f = fixture();
    f.lines[0][0] = cell({ chars: 'x' });
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    painter.paint(4, 3, 'comfort');
    expect(painter.paint(4, 3, 'monochrome')).toBe(true);
    f.lines[0][0] = cell({ chars: 'x', italic: true, underline: true });
    expect(painter.paint(4, 3, 'monochrome')).toBe(true);
    f.lines[0][0] = cell({ chars: 'x', fgMode: 1, fg: 2, bgMode: 2, bg: 0x112233 });
    expect(painter.paint(4, 3, 'monochrome')).toBe(true);
    expect(painter.paint(5, 3, 'monochrome')).toBe(true);
    painter.invalidate();
    expect(painter.paint(5, 3, 'monochrome')).toBe(true);
  });

  it('uses the optional resolution scale without changing logical canvas size', () => {
    const f = fixture(4, 2);
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    painter.paint(4, 2, 'comfort', 1);
    expect(f.canvas.width).toBe(44);
    expect(f.canvas.height).toBe(42);
    (f.context.calls as string[]).length = 0;
    expect(painter.paint(4, 2, 'comfort', 0.5)).toBe(true);
    expect(f.canvas.width).toBe(22);
    expect(f.canvas.height).toBe(21);
    expect(f.canvas.style.width).toBe('44px');
    expect(f.canvas.style.height).toBe('42px');
    expect(painter.dirtyRows).toEqual(new Uint8Array([1, 1]));
  });

  it('invalidates all rows when density changes and tracks viewport scrolling', () => {
    const f = fixture();
    f.lines[0][0] = cell({ chars: 'top' });
    f.lines[1][0] = cell({ chars: 'next' });
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    painter.paint(4, 3, 'comfort');
    const calls = f.context.calls as string[];
    calls.length = 0;
    f.terminal.buffer.active.viewportY = 1;
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    expect(calls.filter((value) => value === 'fill')).toHaveLength(2);
    calls.length = 0;
    const originalDensity = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    expect(calls.filter((value) => value === 'fill')).toHaveLength(3);
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: originalDensity,
    });
  });

  it('handles wide cells, continuation cells, combining text, and inverse colors', () => {
    const f = fixture(4, 1);
    f.lines[0][0] = cell({ chars: '界', width: 2, inverse: true });
    f.lines[0][1] = cell({ width: 0 });
    f.lines[0][2] = cell({ chars: 'é', width: 1, bold: true });
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    expect(painter.paint(4, 1, 'original')).toBe(true);
    expect(
      (f.context.fillText as ReturnType<typeof vi.fn>).mock.calls.map(([text]) => text),
    ).toEqual(['界', 'é']);
  });
});
