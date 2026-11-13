import { BACKGROUND_MODES, type BackgroundMode } from '../contracts';

export const BACKGROUND_LABELS: Record<BackgroundMode, string> = {
  black: 'Black',
  gradient: 'Gradient',
  observatory: 'Observatory',
  hangar: 'Hangar deck',
  'deep-water': 'Deep-water station',
  studio: 'Minimal studio',
  desert: 'Desert night',
  aurora: 'Aurora tundra',
  rooftop: 'Rain rooftop',
  summit: 'Cloud summit',
  koi: 'Koi garden',
};

export const BACKGROUND_PICKER_COLUMNS = 3;
export const BACKGROUND_PICKER_ROWS = 2;
/** Tile thumbnail size in panel units, 16:9 like the rendered thumbnails. */
export const BACKGROUND_TILE_WIDTH = 0.42;
export const BACKGROUND_TILE_HEIGHT = 0.236;
const COLUMN_PITCH = 0.48;
const ROW_PITCH = 0.4;
const FIRST_ROW_Y = 0.26;

export function backgroundThumbnailUrl(mode: BackgroundMode): string {
  return `/assets/backgrounds/${mode}.webp`;
}

export function backgroundPickerRowCount(count: number = BACKGROUND_MODES.length): number {
  return Math.ceil(count / BACKGROUND_PICKER_COLUMNS);
}

/** The highest first row that still fills the view, so scrolling never shows an empty bottom row. */
export function clampBackgroundPickerRow(
  row: number,
  count: number = BACKGROUND_MODES.length,
): number {
  const last = Math.max(0, backgroundPickerRowCount(count) - BACKGROUND_PICKER_ROWS);
  return Math.max(0, Math.min(last, Math.trunc(row) || 0));
}

/** The first row that keeps `mode` in view while moving as little as possible from `row`. */
export function backgroundPickerRowShowing(mode: BackgroundMode, row: number): number {
  const modeRow = Math.floor(BACKGROUND_MODES.indexOf(mode) / BACKGROUND_PICKER_COLUMNS);
  if (modeRow < row) return clampBackgroundPickerRow(modeRow);
  if (modeRow >= row + BACKGROUND_PICKER_ROWS)
    return clampBackgroundPickerRow(modeRow - BACKGROUND_PICKER_ROWS + 1);
  return clampBackgroundPickerRow(row);
}

export interface BackgroundPickerTile {
  mode: BackgroundMode;
  x: number;
  y: number;
}

export interface BackgroundPickerLayout {
  firstRow: number;
  tiles: BackgroundPickerTile[];
  canScrollUp: boolean;
  canScrollDown: boolean;
  /** One-based visible row range and total rows, for the scroll caption. */
  caption: string;
}

export function layoutBackgroundPicker(
  row: number,
  modes: readonly BackgroundMode[] = BACKGROUND_MODES,
): BackgroundPickerLayout {
  const rows = backgroundPickerRowCount(modes.length);
  const firstRow = clampBackgroundPickerRow(row, modes.length);
  const first = firstRow * BACKGROUND_PICKER_COLUMNS;
  const tiles = modes
    .slice(first, first + BACKGROUND_PICKER_COLUMNS * BACKGROUND_PICKER_ROWS)
    .map((mode, index) => ({
      mode,
      x: ((index % BACKGROUND_PICKER_COLUMNS) - (BACKGROUND_PICKER_COLUMNS - 1) / 2) * COLUMN_PITCH,
      y: FIRST_ROW_Y - Math.floor(index / BACKGROUND_PICKER_COLUMNS) * ROW_PITCH,
    }));
  const lastShown = Math.min(rows, firstRow + BACKGROUND_PICKER_ROWS);
  return {
    firstRow,
    tiles,
    canScrollUp: firstRow > 0,
    canScrollDown: lastShown < rows,
    caption: `Rows ${firstRow + 1}–${lastShown} of ${rows}`,
  };
}
