/** How a picture frame shows its depth map. */
export type PictureDepthMode = 'inward' | 'popout';
export type PictureDepthEdges = 'stretch' | 'cut';
/** What a stereo pair shows in 3D: its two captured eyes, or one eye with a depth map. */
export type PictureDepthSource = 'stereo' | 'depth';

export interface PictureDepthView {
  /** 3D on; off shows the flat picture even when a depth map is stored. */
  enabled: boolean;
  /**
   * Depth as picked on the 0.9 m prototype frame; the frame scales it to its own long edge, so the
   * relief keeps its proportions at any frame size.
   */
  strength: number;
  /** Inward recedes behind the frame like a window; pop out centres the depth on the frame. */
  mode: PictureDepthMode;
  /** Stretch fills depth edges by smearing; cut leaves gaps where depth jumps. */
  edges: PictureDepthEdges;
  /** Only used by stereo pairs; other pictures always use a depth map. */
  source: PictureDepthSource;
}

export const DEFAULT_DEPTH_VIEW: Readonly<PictureDepthView> = {
  enabled: true,
  strength: 0.25,
  mode: 'inward',
  edges: 'stretch',
  source: 'stereo',
};
export const DEPTH_STRENGTH_STEP = 0.05;
export const MIN_DEPTH_STRENGTH = 0.05;
export const MAX_DEPTH_STRENGTH = 1;
/** The prototype frame's long edge the default strength was chosen on. */
export const DEPTH_REFERENCE_EDGE = 0.9;

const roundStrength = (value: number): number =>
  Math.min(
    MAX_DEPTH_STRENGTH,
    Math.max(
      MIN_DEPTH_STRENGTH,
      Number((Math.round(value / DEPTH_STRENGTH_STEP) * DEPTH_STRENGTH_STEP).toFixed(2)),
    ),
  );

/** A stored view, with anything missing or malformed replaced by the default. */
export function normalizeDepthView(value: unknown): PictureDepthView {
  const stored = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<keyof PictureDepthView, unknown>
  >;
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_DEPTH_VIEW.enabled,
    strength:
      typeof stored.strength === 'number' && Number.isFinite(stored.strength)
        ? roundStrength(stored.strength)
        : DEFAULT_DEPTH_VIEW.strength,
    mode: stored.mode === 'popout' ? 'popout' : 'inward',
    edges: stored.edges === 'cut' ? 'cut' : 'stretch',
    source: stored.source === 'depth' ? 'depth' : 'stereo',
  };
}

/** `view` with its strength moved by `steps` increments, clamped to the allowed range. */
export function stepDepthStrength(view: PictureDepthView, steps: number): PictureDepthView {
  return { ...view, strength: roundStrength(view.strength + steps * DEPTH_STRENGTH_STEP) };
}

/** Whether a picture shows its depth map: 3D on, and a flat picture or a stereo pair set to depth. */
export const usesDepthMap = (view: PictureDepthView, stereo: boolean): boolean =>
  view.enabled && (!stereo || view.source === 'depth');

/** The displacement scale for a frame whose image long edge is `longEdge` metres (local). */
export function depthDisplacement(view: PictureDepthView, longEdge: number): number {
  return view.enabled ? (view.strength * longEdge) / DEPTH_REFERENCE_EDGE : 0;
}

/** The text shown on a frame's depth options, e.g. "0.25". */
export const depthStrengthLabel = (strength: number): string => strength.toFixed(2);
