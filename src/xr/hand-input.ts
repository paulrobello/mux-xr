import type * as THREE from 'three';

export interface HandInputState {
  pinching: boolean;
  neutral: boolean;
  tracked: boolean;
}

export interface HandInputResult {
  tracked: boolean;
  pinching: boolean;
  started: boolean;
  ended: boolean;
  recovered: boolean;
}

const CLOSE_DISTANCE = 0.028;
const OPEN_DISTANCE = 0.045;

/** Update the thumb-to-middle pinch state from Three's hand joint groups. */
export function updateHandInput(
  hand: THREE.Group,
  state: HandInputState,
  rayTracked = true,
): HandInputResult {
  const joints = (
    hand as THREE.Group & {
      joints?: Record<string, THREE.Object3D | undefined>;
    }
  ).joints;
  const thumb = joints?.['thumb-tip'];
  const index = joints?.['index-finger-tip'];
  const middle = joints?.['middle-finger-tip'];
  const wrist = joints?.wrist;
  if (
    !rayTracked ||
    !hand.visible ||
    !thumb?.visible ||
    !index?.visible ||
    !middle?.visible ||
    !wrist?.visible
  ) {
    state.tracked = false;
    state.pinching = false;
    state.neutral = false;
    return { tracked: false, pinching: false, started: false, ended: false, recovered: false };
  }
  const recovered = !state.tracked;
  const indexDistance = thumb.position.distanceTo(index.position);
  const middleDistance = thumb.position.distanceTo(middle.position);
  const wasPinching = state.pinching;
  if (state.pinching) {
    if (middleDistance >= OPEN_DISTANCE) {
      state.pinching = false;
      state.neutral = indexDistance >= OPEN_DISTANCE;
    }
  } else if (state.neutral && indexDistance >= OPEN_DISTANCE && middleDistance <= CLOSE_DISTANCE) {
    state.pinching = true;
    state.neutral = false;
  }
  if (recovered) {
    state.neutral = indexDistance >= OPEN_DISTANCE && middleDistance >= OPEN_DISTANCE;
    state.pinching = false;
  } else if (!state.neutral && indexDistance >= OPEN_DISTANCE && middleDistance >= OPEN_DISTANCE) {
    state.neutral = true;
  }
  state.tracked = true;
  return {
    tracked: true,
    pinching: state.pinching,
    started: !wasPinching && state.pinching,
    ended: wasPinching && !state.pinching,
    recovered,
  };
}
