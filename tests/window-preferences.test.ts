import { describe, expect, it } from 'vitest';
import { DEFAULT_BUTTON_MAP } from '../src/workspace/controller-buttons';
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
      validateWindowPreferences({
        defaultOpacity: 0,
        defaultCurvature: -5,
        focusDistance: 99,
        focusCurvature: -5,
      }),
    ).toEqual({
      defaultOpacity: 0.1,
      defaultCurvature: 0,
      focusDistance: 5,
      focusCurvature: 0,
      focusWarpMode: 'custom',
      scrollStripSide: 'right',
      frameChin: false,
      buttonMap: DEFAULT_BUTTON_MAP,
    });
    expect(
      validateWindowPreferences({
        defaultOpacity: 2,
        defaultCurvature: 120,
        focusDistance: 0,
        focusCurvature: 200,
      }),
    ).toEqual({
      defaultOpacity: 1,
      defaultCurvature: 120,
      focusDistance: 0.5,
      focusCurvature: 180,
      focusWarpMode: 'custom',
      scrollStripSide: 'right',
      frameChin: false,
      buttonMap: DEFAULT_BUTTON_MAP,
    });
  });

  it('preserves the custom angle when inheriting and defaults older settings to Custom', () => {
    expect(validateWindowPreferences({ focusCurvature: 65 })).toMatchObject({
      focusWarpMode: 'custom',
      focusCurvature: 65,
    });
    expect(
      validateWindowPreferences({ focusWarpMode: 'inherit', focusCurvature: 180 }),
    ).toMatchObject({
      focusWarpMode: 'inherit',
      focusCurvature: 180,
    });
    expect(validateWindowPreferences({ focusWarpMode: 'invalid' }).focusWarpMode).toBe('custom');
  });

  it('keeps a boolean frame chin choice and falls back to hiding it', () => {
    expect(validateWindowPreferences({ frameChin: true }).frameChin).toBe(true);
    expect(validateWindowPreferences({ frameChin: 'no' }).frameChin).toBe(false);
    expect(validateWindowPreferences({}).frameChin).toBe(false);
  });

  it('keeps a known scroll strip side and falls back to the right edge', () => {
    expect(validateWindowPreferences({ scrollStripSide: 'both' }).scrollStripSide).toBe('both');
    expect(validateWindowPreferences({ scrollStripSide: 'left' }).scrollStripSide).toBe('left');
    expect(validateWindowPreferences({ scrollStripSide: 'top' }).scrollStripSide).toBe('right');
  });
});
