import { FOVEATION_LEVELS as PACKAGE_FOVEATION_LEVELS } from '@par/xr-workspace';
import { describe, expect, it } from 'vitest';
import { applySessionFoveation, FOVEATION_AMOUNT, validateFoveationLevel } from '../src/foveation';
import { validateSettings } from '../src/settings/store';

describe('foveation', () => {
  it('maps the levels across the normalized WebXR range', () => {
    expect(FOVEATION_AMOUNT).toEqual({ off: 0, low: 0.25, medium: 0.5, high: 1 });
  });

  it('shares the level map with the workspace package instead of carrying a copy', () => {
    expect(FOVEATION_AMOUNT).toBe(PACKAGE_FOVEATION_LEVELS);
  });

  it('keeps known levels and defaults unknown ones to low', () => {
    expect(validateFoveationLevel('high')).toBe('high');
    expect(validateFoveationLevel(undefined)).toBe('low');
    expect(validateFoveationLevel('maximum')).toBe('low');
    expect(validateFoveationLevel('toString')).toBe('low');
  });

  it('applies the level to a session and survives runtimes without foveation', () => {
    const calls: number[] = [];
    applySessionFoveation(
      { updateRenderState: (init) => calls.push(init.fixedFoveation ?? -1) },
      'medium',
    );
    expect(calls).toEqual([0.5]);
    applySessionFoveation({}, 'high');
    expect(calls).toEqual([0.5]);
    applySessionFoveation(
      {
        updateRenderState: () => {
          throw new Error('unsupported');
        },
      },
      'high',
    );
    expect(calls).toEqual([0.5]);
  });

  it('defaults the workspace setting to low and repairs invalid stored values', () => {
    expect(validateSettings({}).foveation).toBe('low');
    expect(validateSettings({ foveation: 'maximum' }).foveation).toBe('low');
    expect(validateSettings({ foveation: 'high' }).foveation).toBe('high');
  });
});
