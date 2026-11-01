import { describe, expect, it } from 'vitest';
import { shouldAutoReload } from '../src/update-policy';

describe('frontend update presentation policy', () => {
  it('automatically applies a detected desktop update', () => {
    expect(shouldAutoReload(true, 'desktop')).toBe(true);
    expect(shouldAutoReload(false, 'desktop')).toBe(false);
  });
  it('keeps reload explicit in VR and passthrough and during immersive entry', () => {
    expect(shouldAutoReload(true, 'vr')).toBe(false);
    expect(shouldAutoReload(true, 'ar')).toBe(false);
    expect(shouldAutoReload(true, 'desktop', true)).toBe(false);
  });
});
