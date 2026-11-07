// A hand has no thumbstick, so a far ray grab moves the held object along its grab offset in
// proportion to the hand's reach: pulling the wrist in to half its reach brings the object half
// as far. Reach is the wrist's level distance from an estimated shoulder beside the head.
// Controllers keep their thumbstick push/pull.
export const REEL_MIN_START = 0.5;
export const REEL_MIN_REACH = 0.2;
export const REEL_DEAD_ZONE = 0.05;
export const REEL_MIN_DISTANCE = 0.3;
export const REEL_MAX_DISTANCE = 6;

export interface HandReel {
  /** Wrist reach when the grab began. */
  startReach: number;
  /** Length of the grab offset when the grab began. */
  startOffset: number;
}

export function startHandReel(reach: number, offset: number): HandReel | undefined {
  if (!(reach >= REEL_MIN_REACH) || !(offset > REEL_MIN_START)) return undefined;
  return { startReach: reach, startOffset: offset };
}

/** Continue a reel from a new grab pose, whatever the current offset. */
export function rebaseHandReel(reach: number, offset: number): HandReel | undefined {
  if (!(reach >= REEL_MIN_REACH) || !(offset > 0)) return undefined;
  return { startReach: reach, startOffset: offset };
}

export function reelOffset(reel: HandReel, reach: number): number {
  const change = reach - reel.startReach;
  const travel = Math.sign(change) * Math.max(0, Math.abs(change) - REEL_DEAD_ZONE);
  const wanted = (reel.startOffset * Math.max(0, reel.startReach + travel)) / reel.startReach;
  const farthest = Math.max(REEL_MAX_DISTANCE, reel.startOffset);
  const nearest = Math.min(REEL_MIN_DISTANCE, reel.startOffset);
  return Math.min(farthest, Math.max(nearest, wanted));
}
