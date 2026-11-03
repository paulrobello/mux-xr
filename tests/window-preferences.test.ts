import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_PREFERENCES,
  validateWindowPreferences,
} from '../src/workspace/window-preferences';

describe('window preferences', () => {
  it('uses defaults for missing or malformed values', () => {
    expect(validateWindowPreferences(null)).toEqual(DEFAULT_WINDOW_PREFERENCES);
    expect(validateWindowPreferences({ defaultOpacity: '1', focusDistance: Infinity })).toEqual(
      DEFAULT_WINDOW_PREFERENCES,
    );
  });

  it('clamps finite values to the supported display ranges', () => {
    expect(
      validateWindowPreferences({ defaultOpacity: 0, focusDistance: 99, focusCurvature: -5 }),
    ).toEqual({ defaultOpacity: 0.1, focusDistance: 5, focusCurvature: 0 });
    expect(
      validateWindowPreferences({ defaultOpacity: 2, focusDistance: 0, focusCurvature: 120 }),
    ).toEqual({ defaultOpacity: 1, focusDistance: 0.5, focusCurvature: 100 });
  });
});
