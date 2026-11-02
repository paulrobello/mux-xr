import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINAL_FILTERING, validateTerminalFiltering } from '../src/terminal/filtering';

describe('terminal filtering validation', () => {
  it('uses the clarity-oriented defaults for malformed values', () => {
    expect(validateTerminalFiltering(null)).toEqual(DEFAULT_TERMINAL_FILTERING);
    expect(validateTerminalFiltering({})).toEqual(DEFAULT_TERMINAL_FILTERING);
  });

  it('accepts filter modes and normalizes anisotropy to supported levels', () => {
    expect(
      validateTerminalFiltering({ mode: 'nearest', anisotropy: 0, gazeClarity: false }),
    ).toEqual({
      mode: 'nearest',
      anisotropy: 1,
      gazeClarity: false,
    });
    expect(validateTerminalFiltering({ mode: 'mipmap-nearest', anisotropy: 6 })).toEqual({
      mode: 'mipmap-nearest',
      anisotropy: 4,
      gazeClarity: true,
    });
    expect(validateTerminalFiltering({ mode: 'mipmap-linear', anisotropy: 99 })).toEqual({
      mode: 'mipmap-linear',
      anisotropy: 16,
      gazeClarity: true,
    });
  });

  it('rejects unknown mode and malformed fields independently', () => {
    expect(validateTerminalFiltering({ mode: 'bogus', anisotropy: '4', gazeClarity: 1 })).toEqual(
      DEFAULT_TERMINAL_FILTERING,
    );
  });
});
