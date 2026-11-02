import { describe, expect, it } from 'vitest';
import { terminalQualityAtDistance } from '../src/xr/terminal-lod';

describe('distance terminal LOD', () => {
  it('keeps nearby panes full and uses reduced tiers for farther panes', () => {
    expect(terminalQualityAtDistance(2, 'full')).toBe('full');
    expect(terminalQualityAtDistance(5, 'full')).toBe('medium');
    expect(terminalQualityAtDistance(10, 'full')).toBe('low');
  });

  it('uses different promotion and demotion boundaries to avoid distance flicker', () => {
    expect(terminalQualityAtDistance(3.5, 'full')).toBe('full');
    expect(terminalQualityAtDistance(3.5, 'medium')).toBe('medium');
    expect(terminalQualityAtDistance(7, 'medium')).toBe('medium');
    expect(terminalQualityAtDistance(7, 'low')).toBe('low');
    expect(terminalQualityAtDistance(6, 'low')).toBe('medium');
    expect(terminalQualityAtDistance(3, 'low')).toBe('full');
    expect(terminalQualityAtDistance(Number.NaN, 'low')).toBe('full');
  });
});
