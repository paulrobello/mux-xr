import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_MODES, type BackgroundMode } from '../src/contracts';
import {
  BACKGROUND_LABELS,
  BACKGROUND_PICKER_COLUMNS,
  BACKGROUND_PICKER_ROWS,
  BACKGROUND_TILE_WIDTH,
  backgroundPickerRowCount,
  backgroundPickerRowShowing,
  backgroundThumbnailUrl,
  clampBackgroundPickerRow,
  layoutBackgroundPicker,
} from '../src/xr/background-picker';

const modes = (count: number): BackgroundMode[] =>
  Array.from({ length: count }, (_, index) => BACKGROUND_MODES[index % BACKGROUND_MODES.length]);

describe('background picker layout', () => {
  it('labels every background mode and points each at its thumbnail', () => {
    for (const mode of BACKGROUND_MODES) {
      expect(BACKGROUND_LABELS[mode]).toBeTruthy();
      expect(backgroundThumbnailUrl(mode)).toBe(`/assets/backgrounds/${mode}.webp`);
    }
  });

  it('ships a thumbnail for every background (make background-thumbnails)', () => {
    for (const mode of BACKGROUND_MODES) {
      const file = join('public', backgroundThumbnailUrl(mode));
      expect(existsSync(file), `${file} missing`).toBe(true);
    }
  });

  it('shows a 3 x 2 window of tiles in mode order', () => {
    const layout = layoutBackgroundPicker(0, modes(11));
    expect(layout.tiles).toHaveLength(BACKGROUND_PICKER_COLUMNS * BACKGROUND_PICKER_ROWS);
    expect(layout.tiles.map((tile) => tile.mode)).toEqual(modes(6));
    const xs = [...new Set(layout.tiles.map((tile) => tile.x))];
    const ys = [...new Set(layout.tiles.map((tile) => tile.y))];
    expect(xs).toHaveLength(3);
    expect(ys).toHaveLength(2);
    expect(xs[1] - xs[0]).toBeGreaterThan(BACKGROUND_TILE_WIDTH);
    expect(layout.canScrollUp).toBe(false);
    expect(layout.canScrollDown).toBe(true);
    expect(layout.caption).toBe('Rows 1–2 of 4');
  });

  it('clamps scrolling so the last view is full and never empty', () => {
    expect(backgroundPickerRowCount(11)).toBe(4);
    expect(clampBackgroundPickerRow(9, 11)).toBe(2);
    expect(clampBackgroundPickerRow(-3, 11)).toBe(0);
    expect(clampBackgroundPickerRow(Number.NaN, 11)).toBe(0);
    expect(clampBackgroundPickerRow(5, 4)).toBe(0);
    const last = layoutBackgroundPicker(99, modes(11));
    expect(last.firstRow).toBe(2);
    expect(last.tiles).toHaveLength(5);
    expect(last.canScrollUp).toBe(true);
    expect(last.canScrollDown).toBe(false);
    expect(last.caption).toBe('Rows 3–4 of 4');
  });

  it('does not scroll when everything fits', () => {
    const layout = layoutBackgroundPicker(1, modes(5));
    expect(layout.firstRow).toBe(0);
    expect(layout.canScrollUp).toBe(false);
    expect(layout.canScrollDown).toBe(false);
  });

  it('moves the view only as far as needed to show a mode', () => {
    const last = BACKGROUND_MODES[BACKGROUND_MODES.length - 1];
    const lastRow = Math.floor((BACKGROUND_MODES.length - 1) / BACKGROUND_PICKER_COLUMNS);
    const shown = backgroundPickerRowShowing(last, 0);
    expect(shown).toBeLessThanOrEqual(lastRow);
    expect(shown + BACKGROUND_PICKER_ROWS).toBeGreaterThan(lastRow);
    expect(backgroundPickerRowShowing(BACKGROUND_MODES[0], shown)).toBe(0);
    expect(backgroundPickerRowShowing(BACKGROUND_MODES[0], 0)).toBe(0);
  });
});
