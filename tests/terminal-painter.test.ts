import { describe, expect, it, vi } from 'vitest';
import { createTerminalPainter, type TerminalPainter } from '../src/terminal/painter';

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
  terminal: {
    buffer: { active: Record<string, unknown> };
    getSelectionPosition: () =>
      | { start: { x: number; y: number }; end: { x: number; y: number } }
      | undefined;
  };
  lines: Record<string, unknown>[][];
  context: Record<string, unknown>;
  selection: { current?: { start: { x: number; y: number }; end: { x: number; y: number } } };
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
  const selection: {
    current?: { start: { x: number; y: number }; end: { x: number; y: number } };
  } = {};
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
  return {
    canvas,
    terminal: { buffer: { active }, getSelectionPosition: () => selection.current },
    lines,
    context,
    selection,
  };
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

  it('does not paint a continuation-cell highlight over a selected wide glyph', () => {
    const f = fixture(2, 1);
    f.lines[0][0] = cell({ chars: '界', width: 2 });
    f.lines[0][1] = cell({ width: 0 });
    f.selection.current = { start: { x: 1, y: 0 }, end: { x: 2, y: 0 } };
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    painter.paint(2, 1, 'comfort');
    const calls = f.context.calls as string[];
    const afterGlyph = calls.slice(calls.indexOf('text') + 1);
    expect(afterGlyph).not.toContain('fill');
    expect((f.context.fillText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('界');
  });

  it('highlights zero-based exclusive multiline selections and dirties only changed rows', () => {
    const f = fixture(4, 3);
    f.lines[0][0] = cell({ chars: 'a' });
    f.lines[1][0] = cell({ chars: '界', width: 2 });
    const terminal = f.terminal as typeof f.terminal & {
      getSelectionPosition: () =>
        | { start: { x: number; y: number }; end: { x: number; y: number } }
        | undefined;
    };
    const painter = createTerminalPainter(f.canvas, terminal as never);
    painter.paint(4, 3, 'comfort');
    f.selection.current = { start: { x: 1, y: 1 }, end: { x: 2, y: 2 } };
    (f.context.calls as string[]).length = 0;
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    expect(painter.dirtyRows).toEqual(new Uint8Array([0, 1, 1]));
    expect(
      (f.context.calls as string[]).filter((value) => value === 'fill').length,
    ).toBeGreaterThan(2);
    f.selection.current = undefined;
    (f.context.calls as string[]).length = 0;
    expect(painter.paint(4, 3, 'comfort')).toBe(true);
    expect(painter.dirtyRows).toEqual(new Uint8Array([0, 1, 1]));
  });
});

describe('terminal painter damage hints', () => {
  const hint = (generation: number, ...ranges: Array<[number, number]>) => ({
    generation: BigInt(generation),
    ranges: ranges.map(([startRow, endRow]) => ({ startRow, endRow })),
  });
  // Six rows with the cursor parked on row 5, so cursor rescans never touch rows 0-4.
  const setup = () => {
    const f = fixture(4, 6);
    f.terminal.buffer.active.cursorY = 5;
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    painter.paint(4, 6, 'comfort');
    painter.noteOutput(hint(1));
    painter.paint(4, 6, 'comfort');
    return { f, painter };
  };
  const unhintedChange = (f: ReturnType<typeof fixture>) => {
    f.lines[0][0] = cell({ chars: 'z' });
    f.lines[2][0] = cell({ chars: 'y' });
  };

  it('scans every row until the first hint arrives', () => {
    const f = fixture(4, 6);
    const painter = createTerminalPainter(f.canvas, f.terminal as never);
    painter.paint(4, 6, 'comfort');
    f.lines[3][0] = cell({ chars: 'q' });
    expect(painter.paint(4, 6, 'comfort')).toBe(true);
    expect(painter.dirtyRows[3]).toBe(1);
    expect(painter.damageStats).toMatchObject({ fullScans: 2, damageScans: 0 });
  });

  it('scans only the hinted rows and the cursor rows', () => {
    const { f, painter } = setup();
    const before = painter.damageStats.rowsScanned;
    f.lines[2][0] = cell({ chars: 'y' });
    f.lines[0][0] = cell({ chars: 'z' });
    painter.noteOutput(hint(2, [2, 2]));
    expect(painter.paint(4, 6, 'comfort')).toBe(true);
    // Row 0 changed outside the hint, so the hinted scan does not see it.
    expect(Array.from(painter.dirtyRows)).toEqual([0, 0, 1, 0, 0, 0]);
    expect(painter.damageStats.rowsScanned - before).toBe(2);
    expect(painter.damageStats.damageScans).toBeGreaterThan(0);
  });

  it('treats a present generation with no ranges as no change', () => {
    const { f, painter } = setup();
    f.lines[1][0] = cell({ chars: 'n' });
    painter.noteOutput(hint(2));
    expect(painter.paint(4, 6, 'comfort')).toBe(false);
  });

  it.each([
    ['unknown damage', null],
    ['a regressed generation', hint(0, [1, 1])],
    ['overlapping ranges', hint(3, [1, 3], [2, 4])],
    ['descending ranges', hint(3, [3, 3], [1, 1])],
    ['an inverted range', hint(3, [3, 1])],
    ['an out-of-bounds range', hint(3, [4, 6])],
  ])('falls back to a full scan for %s', (_name, value) => {
    const { f, painter } = setup();
    const fullScans = painter.damageStats.fullScans;
    unhintedChange(f);
    painter.noteOutput(value);
    painter.paint(4, 6, 'comfort');
    expect(Array.from(painter.dirtyRows)).toEqual([1, 0, 1, 0, 0, 0]);
    expect(painter.damageStats.fullScans).toBe(fullScans + 1);
  });

  it('counts refused hints and resumes hinted scans after the fallback', () => {
    const { f, painter } = setup();
    painter.noteOutput(hint(3, [3, 1]));
    painter.paint(4, 6, 'comfort');
    expect(painter.damageStats.rejectedHints).toBe(1);
    // The refused chunk's rows are unknown, so the chunk after it rescans everything too.
    unhintedChange(f);
    painter.noteOutput(hint(4));
    painter.paint(4, 6, 'comfort');
    expect(Array.from(painter.dirtyRows)).toEqual([1, 0, 1, 0, 0, 0]);
    f.lines[0][0] = cell({ chars: 'w' });
    f.lines[2][0] = cell({ chars: 'v' });
    painter.noteOutput(hint(5, [2, 2]));
    painter.paint(4, 6, 'comfort');
    expect(Array.from(painter.dirtyRows)).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it('merges coalesced hints and rescans the previous hint once for seam glyphs', () => {
    const { f, painter } = setup();
    painter.noteOutput(hint(2, [0, 0]));
    painter.noteOutput(hint(3, [3, 3]));
    f.lines[0][0] = cell({ chars: 'a' });
    f.lines[3][0] = cell({ chars: 'd' });
    painter.paint(4, 6, 'comfort');
    expect(Array.from(painter.dirtyRows)).toEqual([1, 0, 0, 1, 0, 0]);
    // The tail of a split glyph arrives with the next chunk, whose hint omits row 3.
    f.lines[3][1] = cell({ chars: 'é' });
    painter.noteOutput(hint(4));
    painter.paint(4, 6, 'comfort');
    expect(painter.dirtyRows[3]).toBe(1);
    f.lines[3][2] = cell({ chars: 'x' });
    painter.noteOutput(hint(5));
    expect(painter.paint(4, 6, 'comfort')).toBe(false);
  });

  it('rescans everything on local scroll, scrollback view, buffer switch, resize and reset', () => {
    const { painter, f } = setup();
    const active = f.terminal.buffer.active as Record<string, unknown>;
    let generation = 10;
    const fullAfter = (change: () => void, rows = 6): number => {
      const fullScans = painter.damageStats.fullScans;
      change();
      generation += 1;
      painter.noteOutput(hint(generation));
      painter.paint(4, rows, 'comfort');
      return painter.damageStats.fullScans - fullScans;
    };
    expect(
      fullAfter(() => {
        active.baseY = 1;
        active.viewportY = 1;
      }),
    ).toBe(1);
    expect(painter.damageStats.fullScanReasons.scrolled).toBe(1);
    expect(fullAfter(() => undefined)).toBe(0);
    expect(fullAfter(() => (active.viewportY = 0))).toBe(1);
    expect(fullAfter(() => undefined)).toBe(1);
    active.viewportY = 1;
    painter.paint(4, 6, 'comfort');
    expect(fullAfter(() => (active.type = 'alternate'))).toBe(1);
    expect(fullAfter(() => undefined, 5)).toBe(1);
    expect(fullAfter(() => undefined, 5)).toBe(0);
    painter.resetDamage();
    f.lines[Number(active.viewportY) + 1][0] = cell({ chars: 'r' });
    painter.paint(4, 5, 'comfort');
    expect(painter.dirtyRows[1]).toBe(1);
  });

  it.each([
    ['a paint without new output', (painter: TerminalPainter) => painter.paint(4, 6, 'comfort')],
    [
      'a full scan',
      (painter: TerminalPainter) => {
        painter.invalidate();
        painter.paint(4, 6, 'comfort');
      },
    ],
  ])('rescans the previous chunk for a seam glyph across %s', (_name, between) => {
    const { f, painter } = setup();
    f.lines[3][0] = cell({ chars: 'a' });
    painter.noteOutput(hint(2, [3, 3]));
    painter.paint(4, 6, 'comfort');
    between(painter);
    f.lines[3][1] = cell({ chars: '界' });
    painter.noteOutput(hint(3, [1, 1]));
    painter.paint(4, 6, 'comfort');
    expect(painter.dirtyRows[3]).toBe(1);
  });

  it('rescans the seam rows of a chunk noted while a full scan was pending', () => {
    const { f, painter } = setup();
    painter.noteOutput(null);
    painter.noteOutput(hint(2, [3, 3]));
    painter.paint(4, 6, 'comfort');
    const damageScans = painter.damageStats.damageScans;
    f.lines[3][1] = cell({ chars: '界' });
    painter.noteOutput(hint(3));
    painter.paint(4, 6, 'comfort');
    expect(painter.damageStats.damageScans).toBe(damageScans + 1);
    expect(painter.dirtyRows[3]).toBe(1);
  });

  it('caps a long backlog of unpainted hints with a full scan', () => {
    const { f, painter } = setup();
    for (let index = 0; index < 300; index += 1) painter.noteOutput(hint(2 + index, [1, 1]));
    unhintedChange(f);
    const fullScans = painter.damageStats.fullScans;
    painter.paint(4, 6, 'comfort');
    expect(painter.damageStats.fullScans).toBe(fullScans + 1);
    expect(Array.from(painter.dirtyRows)).toEqual([1, 0, 1, 0, 0, 0]);
  });

  it('counts rows the hint missed in audit mode and still paints them', () => {
    const f = fixture(4, 6);
    f.terminal.buffer.active.cursorY = 5;
    const painter = createTerminalPainter(f.canvas, f.terminal as never, { audit: true });
    painter.paint(4, 6, 'comfort');
    painter.noteOutput(hint(1, [2, 2]));
    unhintedChange(f);
    painter.paint(4, 6, 'comfort');
    expect(painter.damageStats.auditMisses).toBe(1);
    expect(Array.from(painter.dirtyRows)).toEqual([1, 0, 1, 0, 0, 0]);
  });
});
