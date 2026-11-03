export interface WindowPreferences {
  defaultOpacity: number;
  focusDistance: number;
  focusCurvature: number;
}

export const DEFAULT_WINDOW_PREFERENCES: WindowPreferences = {
  defaultOpacity: 1,
  focusDistance: 1.5,
  focusCurvature: 0,
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
  };
}
