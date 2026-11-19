import { FOVEATION_LEVELS, type FoveationLevel } from '@par/xr-workspace';

export type { FoveationLevel };

/**
 * Normalized fixedFoveation per level; the WebXR range is 0 (none) to 1 (maximum). Shared
 * source of truth with the workspace package's xr-session module.
 */
export const FOVEATION_AMOUNT = FOVEATION_LEVELS;

export function validateFoveationLevel(value: unknown): FoveationLevel {
  return typeof value === 'string' && Object.hasOwn(FOVEATION_LEVELS, value)
    ? (value as FoveationLevel)
    : 'low';
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
