/** Compositor fixed foveation for immersive sessions: `off`, `low`, `medium` or `high`. */
export type FoveationLevel = 'off' | 'low' | 'medium' | 'high';

export const FOVEATION_LEVELS: readonly FoveationLevel[] = ['off', 'low', 'medium', 'high'];

/** Normalized fixedFoveation per level; the WebXR range is 0 (none) to 1 (maximum). */
export const FOVEATION_AMOUNT: Record<FoveationLevel, number> = {
  off: 0,
  low: 0.25,
  medium: 0.5,
  high: 1,
};

export function validateFoveationLevel(value: unknown): FoveationLevel {
  return FOVEATION_LEVELS.includes(value as FoveationLevel) ? (value as FoveationLevel) : 'low';
}

/** The slice of the WebXR session this module needs; structural, so tests can stub it. */
export interface FoveationSession {
  updateRenderState?(init: XRRenderStateInit & { fixedFoveation?: number }): void;
}

/**
 * Applies the setting to an immersive session. Runtimes without foveation reject unknown
 * render-state keys or omit the method entirely; either way rendering continues unfocused.
 */
export function applySessionFoveation(session: FoveationSession, level: FoveationLevel): void {
  if (!session.updateRenderState) return;
  try {
    session.updateRenderState({ fixedFoveation: FOVEATION_AMOUNT[level] });
  } catch {
    /* Foveation unsupported; rendering continues unfocused. */
  }
}
