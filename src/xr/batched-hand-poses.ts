import * as THREE from 'three';

interface ControllerInternals {
  _hand: THREE.XRHandSpace | null;
  _getHandJoint(hand: THREE.XRHandSpace, joint: XRJointSpace): THREE.XRJointSpace;
}

type BatchFrame = XRFrame & {
  fillPoses?(spaces: XRSpace[], baseSpace: XRSpace, transforms: Float32Array): boolean;
  fillJointRadii?(jointSpaces: XRJointSpace[], radii: Float32Array): boolean;
};

interface HandBatch {
  spaces: XRJointSpace[];
  poses: Float32Array;
  radii: Float32Array;
  /** Stands in for the input source so three's update skips its own per-joint loop. */
  source: XRInputSource;
}

const EMPTY_HAND = { values: () => [][Symbol.iterator]() } as unknown as XRHand;
const batches = new WeakMap<XRInputSource, HandBatch>();
let installed = false;

function batchFor(inputSource: XRInputSource, hand: XRHand): HandBatch {
  let batch = batches.get(inputSource);
  if (batch) return batch;
  const spaces = [...hand.values()];
  batch = {
    spaces,
    poses: new Float32Array(spaces.length * 16),
    radii: new Float32Array(spaces.length),
    source: {
      handedness: inputSource.handedness,
      targetRaySpace: inputSource.targetRaySpace,
      gripSpace: inputSource.gripSpace,
      hand: EMPTY_HAND,
    } as unknown as XRInputSource,
  };
  batches.set(inputSource, batch);
  return batch;
}

/**
 * Reads tracked hand joints with one `fillPoses` and one `fillJointRadii` call per hand instead of
 * three's `getJointPose` per joint, which allocates a matrix array for each of 25 joints a frame.
 * Joint groups end up exactly as three's own loop leaves them. A hand with any joint untracked,
 * or a browser without the batch calls, takes three's path unchanged.
 */
export function installBatchedHandPoses(): void {
  if (installed) return;
  installed = true;
  const proto = THREE.WebXRController.prototype as unknown as THREE.WebXRController &
    ControllerInternals;
  const original = proto.update;
  proto.update = function (
    this: THREE.WebXRController & ControllerInternals,
    inputSource: XRInputSource,
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
  ) {
    const handGroup = this._hand;
    const xrHand = inputSource?.hand;
    const batchFrame = frame as BatchFrame;
    if (
      !handGroup ||
      !xrHand ||
      frame.session.visibilityState === 'visible-blurred' ||
      typeof batchFrame.fillPoses !== 'function' ||
      typeof batchFrame.fillJointRadii !== 'function'
    )
      return original.call(this, inputSource, frame, referenceSpace);
    const batch = batchFor(inputSource, xrHand);
    if (
      !batchFrame.fillPoses(batch.spaces, referenceSpace, batch.poses) ||
      !batchFrame.fillJointRadii(batch.spaces, batch.radii)
    )
      return original.call(this, inputSource, frame, referenceSpace);
    for (let index = 0; index < batch.spaces.length; index++) {
      const joint = this._getHandJoint(handGroup, batch.spaces[index]);
      joint.matrix.fromArray(batch.poses, index * 16);
      // three decomposes into `rotation`; the quaternion is the same pose and keeps it in sync.
      joint.matrix.decompose(joint.position, joint.quaternion, joint.scale);
      joint.matrixWorldNeedsUpdate = true;
      (joint as { jointRadius: number | undefined }).jointRadius = batch.radii[index];
      joint.visible = true;
    }
    return original.call(this, batch.source, frame, referenceSpace);
  };
}
