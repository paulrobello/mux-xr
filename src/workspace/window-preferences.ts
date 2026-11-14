import { MAX_SURFACE_CURVATURE_RADIANS } from '@par/xr-workspace/internal/curved-surface';
import { type ButtonMap, DEFAULT_BUTTON_MAP, validateButtonMap } from './controller-buttons';

export type ScrollStripSide = 'right' | 'left' | 'both';
export type FocusWarpMode = 'custom' | 'inherit';

export const SCROLL_STRIP_SIDES: readonly ScrollStripSide[] = ['right', 'left', 'both'];
export const MAX_TERMINAL_CURVATURE_DEGREES = (MAX_SURFACE_CURVATURE_RADIANS * 180) / Math.PI;

export interface WindowPreferences {
  defaultOpacity: number;
  /** Curvature in degrees for panes with no saved warp. */
  defaultCurvature: number;
  focusDistance: number;
  focusWarpMode: FocusWarpMode;
  focusCurvature: number;
  scrollStripSide: ScrollStripSide;
  /** Show the instrument chin under each pane frame. */
  frameChin: boolean;
  /** Function run by each controller face button. */
  buttonMap: ButtonMap;
}

export const DEFAULT_WINDOW_PREFERENCES: WindowPreferences = {
  defaultOpacity: 1,
  defaultCurvature: 0,
  focusDistance: 1.5,
  focusWarpMode: 'custom',
  focusCurvature: 0,
  scrollStripSide: 'right',
  frameChin: false,
  buttonMap: { ...DEFAULT_BUTTON_MAP },
};

const clamp = (value: number, minimum: number, maximum: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;

export function validateWindowPreferences(value: unknown): WindowPreferences {
  if (!value || typeof value !== 'object')
    return { ...DEFAULT_WINDOW_PREFERENCES, buttonMap: { ...DEFAULT_BUTTON_MAP } };
  const candidate = value as Partial<WindowPreferences>;
  return {
    defaultOpacity: clamp(
      candidate.defaultOpacity ?? NaN,
      0.1,
      1,
      DEFAULT_WINDOW_PREFERENCES.defaultOpacity,
    ),
    defaultCurvature: clamp(
      candidate.defaultCurvature ?? NaN,
      0,
      MAX_TERMINAL_CURVATURE_DEGREES,
      DEFAULT_WINDOW_PREFERENCES.defaultCurvature,
    ),
    focusDistance: clamp(
      candidate.focusDistance ?? NaN,
      0.5,
      5,
      DEFAULT_WINDOW_PREFERENCES.focusDistance,
    ),
    focusCurvature: clamp(
      candidate.focusCurvature ?? NaN,
      0,
      MAX_TERMINAL_CURVATURE_DEGREES,
      DEFAULT_WINDOW_PREFERENCES.focusCurvature,
    ),
    focusWarpMode:
      candidate.focusWarpMode === 'inherit' ? 'inherit' : DEFAULT_WINDOW_PREFERENCES.focusWarpMode,
    scrollStripSide: SCROLL_STRIP_SIDES.includes(candidate.scrollStripSide as ScrollStripSide)
      ? (candidate.scrollStripSide as ScrollStripSide)
      : DEFAULT_WINDOW_PREFERENCES.scrollStripSide,
    frameChin:
      typeof candidate.frameChin === 'boolean'
        ? candidate.frameChin
        : DEFAULT_WINDOW_PREFERENCES.frameChin,
    buttonMap: validateButtonMap(candidate.buttonMap),
  };
}
