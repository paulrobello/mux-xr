export type TerminalFilterMode = 'nearest' | 'linear' | 'mipmap-nearest' | 'mipmap-linear';

export interface TerminalFiltering {
  mode: TerminalFilterMode;
  anisotropy: 1 | 2 | 4 | 8 | 16;
  gazeClarity: boolean;
}

export const DEFAULT_TERMINAL_FILTERING: TerminalFiltering = {
  mode: 'mipmap-linear',
  anisotropy: 4,
  gazeClarity: true,
};

const ANISOTROPY_LEVELS = [1, 2, 4, 8, 16] as const;

function normalizeAnisotropy(value: unknown): TerminalFiltering['anisotropy'] {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return DEFAULT_TERMINAL_FILTERING.anisotropy;
  const clamped = Math.max(1, Math.min(16, value));
  let selected: TerminalFiltering['anisotropy'] = 1;
  for (const level of ANISOTROPY_LEVELS) if (level <= clamped) selected = level;
  return selected;
}

export function validateTerminalFiltering(value: unknown): TerminalFiltering {
  const candidate =
    typeof value === 'object' && value !== null
      ? (value as Partial<Record<keyof TerminalFiltering, unknown>>)
      : {};
  const mode = candidate.mode;
  return {
    mode:
      mode === 'nearest' ||
      mode === 'linear' ||
      mode === 'mipmap-nearest' ||
      mode === 'mipmap-linear'
        ? mode
        : DEFAULT_TERMINAL_FILTERING.mode,
    anisotropy: normalizeAnisotropy(candidate.anisotropy),
    gazeClarity:
      typeof candidate.gazeClarity === 'boolean'
        ? candidate.gazeClarity
        : DEFAULT_TERMINAL_FILTERING.gazeClarity,
  };
}
