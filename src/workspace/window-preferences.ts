export type ScrollStripSide = 'right' | 'left' | 'both';

export const SCROLL_STRIP_SIDES: readonly ScrollStripSide[] = ['right', 'left', 'both'];

export interface WindowPreferences {
  defaultOpacity: number;
  focusDistance: number;
  focusCurvature: number;
  scrollStripSide: ScrollStripSide;
  /** Show the instrument chin under each pane frame. */
  frameChin: boolean;
}

export const DEFAULT_WINDOW_PREFERENCES: WindowPreferences = {
  defaultOpacity: 1,
  focusDistance: 1.5,
  focusCurvature: 0,
  scrollStripSide: 'right',
  frameChin: false,
};

const clamp = (value: number, minimum: number, maximum: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;

export function validateWindowPreferences(value: unknown): WindowPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_WINDOW_PREFERENCES };
  const candidate = value as Partial<WindowPreferences>;
  return {
    defaultOpacity: clamp(
      candidate.defaultOpacity ?? NaN,
      0.1,
      1,
      DEFAULT_WINDOW_PREFERENCES.defaultOpacity,
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
      100,
      DEFAULT_WINDOW_PREFERENCES.focusCurvature,
    ),
    scrollStripSide: SCROLL_STRIP_SIDES.includes(candidate.scrollStripSide as ScrollStripSide)
      ? (candidate.scrollStripSide as ScrollStripSide)
      : DEFAULT_WINDOW_PREFERENCES.scrollStripSide,
    frameChin:
      typeof candidate.frameChin === 'boolean'
        ? candidate.frameChin
        : DEFAULT_WINDOW_PREFERENCES.frameChin,
  };
}
