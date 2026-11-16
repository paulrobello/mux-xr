import { DEFAULT_ACCENT, DEFAULT_ACCENT_HOVER } from '@par/xr-workspace';

/** One scene's live XR accent; its setter retints what was built with it. */
export interface AccentState {
  hex: number;
  hover: number;
}

export function createAccentState(): AccentState {
  return { hex: DEFAULT_ACCENT, hover: DEFAULT_ACCENT_HOVER };
}
