const CONTACT_ENTER = 0.032;
const CONTACT_EXIT = 0.05;
const INDEX_APART = 0.055;
const MIDDLE_APART = 0.045;
const HOLD_SECONDS = 0.55;
const MAX_FRAME_GAP_SECONDS = 0.3;

export interface HandMenuGesture {
  update(
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    timeSeconds: number,
    enabled?: boolean,
  ): XRInputSource | undefined;
  reset(): void;
}

function distance(a: XRJointPose, b: XRJointPose): number {
  const dx = a.transform.position.x - b.transform.position.x;
  const dy = a.transform.position.y - b.transform.position.y;
  const dz = a.transform.position.z - b.transform.position.z;
  return Math.hypot(dx, dy, dz);
}

function tip(frame: XRFrame, reference: XRReferenceSpace, hand: XRHand, joint: XRHandJoint) {
  const space = hand.get(joint);
  return space && frame.getJointPose?.(space, reference);
}

/** Hold thumb to ring finger, with index and middle clear, to emit the owning hand once. */
export function createHandMenuGesture(): HandMenuGesture {
  // A neutral hand arms the recognizer (null); a timestamp marks uninterrupted contact.
  // After firing or losing tracking, the source must show neutral again.
  const holds = new Map<XRInputSource, number | null>();
  let previousTime: number | undefined;
  return {
    update(frame, reference, timeSeconds, enabled = true) {
      if (
        !enabled ||
        (previousTime !== undefined &&
          (timeSeconds < previousTime || timeSeconds - previousTime > MAX_FRAME_GAP_SECONDS))
      )
        holds.clear();
      previousTime = timeSeconds;
      if (!enabled) return;
      const sources = Array.from(frame.session.inputSources);
      for (const source of holds.keys()) {
        if (!sources.includes(source)) holds.delete(source);
      }
      let activated: XRInputSource | undefined;
      for (const source of sources) {
        const hand = source.hand;
        if (!hand) continue;
        const thumb = tip(frame, reference, hand, 'thumb-tip');
        const ring = tip(frame, reference, hand, 'ring-finger-tip');
        const index = tip(frame, reference, hand, 'index-finger-tip');
        const middle = tip(frame, reference, hand, 'middle-finger-tip');
        if (
          !thumb ||
          !ring ||
          !index ||
          !middle ||
          distance(thumb, index) < INDEX_APART ||
          distance(thumb, middle) < MIDDLE_APART
        ) {
          holds.delete(source);
          continue;
        }
        const gap = distance(thumb, ring);
        const start = holds.get(source);
        if (gap >= CONTACT_EXIT) holds.set(source, null);
        else if (start === null && gap <= CONTACT_ENTER) holds.set(source, timeSeconds);
        else if (typeof start === 'number' && timeSeconds - start >= HOLD_SECONDS) {
          holds.delete(source);
          activated ??= source;
        }
      }
      return activated;
    },
    reset() {
      holds.clear();
      previousTime = undefined;
    },
  };
}
