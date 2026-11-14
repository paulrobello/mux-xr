import * as THREE from 'three';

export const PINCH_CLOSE = 0.045;
export const PINCH_OPEN = 0.05;
export const NEAR_ENTER = 0.08;
export const NEAR_EXIT = 0.11;
const REARM_SECONDS = 0.04;
// While a pinch latches its orb, another orb takes over only when it is this many orb diameters
// closer, so the closing drift stays on the key without holding it across the keyboard.
const LATCH_MARGIN = 0.3;
const LOST_GRACE_SECONDS = 0.1;

interface Orb {
  mesh: THREE.Mesh;
  rest: THREE.Vector3;
  normal: THREE.Vector3;
  diameter: number;
  lift: number;
}

export interface KeyborbPinchSample {
  hovered: THREE.Mesh | null;
  /**
   * The orb a closing pinch took hold of. A modifier acts now so a long hold can lock it; any
   * other key is highlighted until the pinch opens and then arrives as `committed`.
   */
  pressed: THREE.Mesh | null;
  /** The held orb, typed when its pinch opens. */
  committed: THREE.Mesh | null;
  released: boolean;
}

interface HandState {
  armed: boolean;
  pinching: boolean;
  activated: boolean;
  nativePhase: 'idle' | 'held' | 'released';
  nativeEarly: boolean;
  openSeconds: number;
  openFrames: number;
  enabled: boolean;
  nearby: Orb | null;
  held: THREE.Mesh | null;
  /** The held key came from a hovered orb rather than a distant ray. */
  heldNear: boolean;
  lostSeconds: number;
  result: KeyborbPinchSample;
}

export function createKeyborbInput(): {
  begin(root: THREE.Group | null): void;
  sample(
    source: THREE.Object3D,
    index: THREE.Vector3 | null,
    thumb: THREE.Vector3 | null,
    rayKey: THREE.Mesh | null,
    enabled: boolean,
    deltaSeconds?: number,
    targetPoint?: THREE.Vector3,
  ): KeyborbPinchSample;
  near(source: THREE.Object3D): boolean;
  hovered(source: THREE.Object3D): THREE.Mesh | null;
  nativePress(source: THREE.Object3D, rayKey: THREE.Mesh | null): THREE.Mesh | null;
  nativeRelease(source: THREE.Object3D): boolean;
  commit(source: THREE.Object3D): THREE.Mesh | null;
  held(): Set<THREE.Mesh>;
  holding(source: THREE.Object3D): boolean;
  animate(deltaSeconds: number): void;
  reset(source?: THREE.Object3D): void;
} {
  let keyboard: THREE.Group | null = null;
  const orbs: Orb[] = [];
  const hands = new Map<THREE.Object3D, HandState>();
  // Reused across frames; held() callers read it before the next call.
  const heldKeys = new Set<THREE.Mesh>();
  const center = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const targeted = (orb: Orb): boolean => {
    for (const hand of hands.values()) if (hand.nearby === orb) return true;
    return false;
  };
  const restore = (): void => {
    for (const orb of orbs) {
      orb.mesh.position.copy(orb.rest);
      orb.mesh.userData.keyborbLift = orb.lift = 0;
    }
  };
  const reset = (source?: THREE.Object3D): void => {
    if (source) hands.delete(source);
    else {
      hands.clear();
      restore();
      orbs.length = 0;
      keyboard = null;
      return;
    }
    for (const orb of orbs)
      if (!targeted(orb)) {
        orb.mesh.position.copy(orb.rest);
        orb.mesh.userData.keyborbLift = orb.lift = 0;
      }
  };
  return {
    begin(root) {
      if (root && !root.visible) root = null;
      if (root !== keyboard) {
        const previousSlots = new Map<HandState, number>();
        const heldSlots = new Map<HandState, number>();
        for (const hand of hands.values()) {
          const slot = hand.nearby?.mesh.userData.keyborbSlot;
          if (typeof slot === 'number') previousSlots.set(hand, slot);
          const heldSlot = hand.held?.userData.keyborbSlot;
          if (typeof heldSlot === 'number') heldSlots.set(hand, heldSlot);
          hand.held = null;
        }
        restore();
        keyboard = root;
        orbs.length = 0;
        for (const hand of hands.values()) hand.nearby = null;
        if (!root) reset();
        for (const child of root?.children ?? []) {
          if (!child.userData.keyborb) continue;
          orbs.push({
            mesh: child as THREE.Mesh,
            rest: child.position.clone(),
            normal: new THREE.Vector3(0, 0, 1).applyQuaternion(child.quaternion),
            diameter: Number(child.userData.labelWidth),
            lift: 0,
          });
        }
        for (const [hand, slot] of previousSlots) {
          hand.nearby = orbs.find((orb) => orb.mesh.userData.keyborbSlot === slot) ?? null;
        }
        for (const [hand, slot] of heldSlots) {
          hand.held = orbs.find((orb) => orb.mesh.userData.keyborbSlot === slot)?.mesh ?? null;
        }
      }
      keyboard?.updateWorldMatrix(true, false);
      keyboard?.getWorldScale(scale);
    },
    sample(source, index, thumb, rayKey, enabled, deltaSeconds = 1 / 60, targetPoint) {
      let state = hands.get(source);
      if (!state) {
        state = {
          armed: false,
          pinching: false,
          activated: false,
          nativePhase: 'idle',
          nativeEarly: false,
          openSeconds: 0,
          openFrames: 0,
          enabled: false,
          nearby: null,
          held: null,
          heldNear: false,
          lostSeconds: 0,
          result: { hovered: null, pressed: null, committed: null, released: false },
        };
        hands.set(source, state);
      }
      const result = state.result;
      result.hovered = result.pressed = result.committed = null;
      result.released = false;
      // Tracking is weakest as the thumb closes over the index, so a held key survives a brief gap.
      if (keyboard && (!index || !thumb) && state.held && state.lostSeconds < LOST_GRACE_SECONDS) {
        state.lostSeconds += Math.max(0, deltaSeconds);
        result.hovered = state.nearby?.mesh ?? null;
        return result;
      }
      state.lostSeconds = 0;
      if (!keyboard || !index || !thumb) {
        result.released = state.pinching;
        state.pinching = state.armed = false;
        state.activated = state.nativeEarly = state.enabled = false;
        state.nativePhase = 'idle';
        state.openSeconds = 0;
        state.openFrames = 0;
        state.nearby = null;
        state.held = null;
        return result;
      }
      midpoint.addVectors(index, thumb).multiplyScalar(0.5);
      const acquisitionPoint = targetPoint ?? midpoint;
      const separation = index.distanceTo(thumb);
      const rawOpen = separation >= PINCH_OPEN;
      const retained = state.nearby;
      const latchRetained =
        enabled &&
        retained !== null &&
        (deltaSeconds === 0 ||
          state.pinching ||
          state.nativePhase === 'held' ||
          (state.armed && !rawOpen));
      let nearest: Orb | null = null;
      let distance = retained ? NEAR_EXIT : NEAR_ENTER;
      for (const orb of orbs) {
        if (!orb.mesh.visible) continue;
        center.copy(orb.rest).applyMatrix4(keyboard.matrixWorld);
        normal.copy(orb.normal).transformDirection(keyboard.matrixWorld);
        const radius = (orb.diameter * Math.abs(scale.x)) / 2;
        if (delta.copy(acquisitionPoint).sub(center).dot(normal) < -radius) continue;
        const candidate = acquisitionPoint.distanceTo(center) - radius;
        if (candidate < distance) {
          nearest = orb;
          distance = candidate;
        }
      }
      if (latchRetained && retained?.mesh.visible) {
        center.copy(retained.rest).applyMatrix4(keyboard.matrixWorld);
        normal.copy(retained.normal).transformDirection(keyboard.matrixWorld);
        const radius = (retained.diameter * Math.abs(scale.x)) / 2;
        const retainedDistance = acquisitionPoint.distanceTo(center) - radius;
        if (
          delta.copy(acquisitionPoint).sub(center).dot(normal) >= -radius &&
          retainedDistance < NEAR_EXIT &&
          (nearest === null || distance > retainedDistance - LATCH_MARGIN * radius * 2)
        )
          nearest = retained;
      }
      state.nearby = nearest;
      result.hovered = state.nearby?.mesh ?? null;
      // A relaxed hand rests inside the pinch distance; once it hovers another orb, the key it
      // curled over is let go and the next pinch takes hold afresh.
      if (state.held && state.heldNear && state.nearby?.mesh !== state.held) {
        state.held = null;
        state.activated = false;
      }
      state.enabled = enabled;
      const nativeOpen = state.nativePhase !== 'idle' && separation > PINCH_CLOSE;
      state.openSeconds = rawOpen || nativeOpen ? state.openSeconds + Math.max(0, deltaSeconds) : 0;
      state.openFrames = rawOpen || nativeOpen ? state.openFrames + (deltaSeconds > 0 ? 1 : 0) : 0;
      if (
        (rawOpen || nativeOpen) &&
        (!state.activated || (state.openSeconds >= REARM_SECONDS && state.openFrames >= 2)) &&
        state.nativePhase !== 'held'
      ) {
        result.released = state.pinching;
        if (state.pinching && state.held) {
          result.committed = enabled ? state.held : null;
          state.held = null;
        }
        state.pinching = false;
        state.nativeEarly = false;
        state.armed = enabled && rawOpen;
      } else if (separation <= PINCH_CLOSE && !state.pinching) {
        state.pinching = true;
        if (!state.nativeEarly) {
          state.activated = false;
          if (enabled && (state.armed || state.nativePhase === 'held'))
            result.pressed = nearest?.mesh ?? rayKey;
          state.activated = Boolean(result.pressed);
          if (result.pressed && !result.pressed.userData.modifier) {
            state.held = result.pressed;
            state.heldNear = result.pressed === nearest?.mesh;
          }
        }
        state.nativeEarly = false;
        state.openSeconds = 0;
        state.openFrames = 0;
        state.armed = false;
      }
      if (!enabled) {
        state.armed = false;
        state.held = null;
      }
      return result;
    },
    near(source) {
      return Boolean(hands.get(source)?.nearby);
    },
    hovered(source) {
      return hands.get(source)?.nearby?.mesh ?? null;
    },
    nativePress(source, rayKey) {
      const state = hands.get(source);
      if (!keyboard || !state?.enabled || state.nativePhase === 'held') return null;
      const rearmed =
        state.nativePhase === 'released' &&
        !state.pinching &&
        state.openSeconds >= REARM_SECONDS &&
        state.openFrames >= 2;
      state.nativePhase = 'held';
      if (state.activated && !rearmed) return null;
      const key = state.nearby?.mesh ?? rayKey;
      if (!key) return null;
      state.nativeEarly = !state.pinching;
      state.activated = true;
      state.openSeconds = 0;
      state.openFrames = 0;
      state.armed = false;
      if (!key.userData.modifier) {
        state.held = key;
        state.heldNear = key === state.nearby?.mesh;
      }
      return key;
    },
    nativeRelease(source) {
      const state = hands.get(source);
      if (state?.nativePhase !== 'held') return false;
      state.nativePhase = 'released';
      state.armed = false;
      return true;
    },
    commit(source) {
      const state = hands.get(source);
      const key = state?.enabled ? state.held : null;
      if (state) state.held = null;
      return key ?? null;
    },
    holding(source) {
      return Boolean(hands.get(source)?.held);
    },
    held() {
      heldKeys.clear();
      for (const hand of hands.values()) if (hand.held) heldKeys.add(hand.held);
      return heldKeys;
    },
    animate(deltaSeconds) {
      const alpha = 1 - Math.exp(-24 * Math.max(0, deltaSeconds));
      for (const orb of orbs) {
        const wanted = targeted(orb) ? orb.diameter : 0;
        orb.lift = THREE.MathUtils.lerp(orb.lift, wanted, alpha);
        orb.mesh.position.copy(orb.rest).addScaledVector(orb.normal, orb.lift);
        orb.mesh.userData.keyborbLift = orb.lift;
      }
    },
    reset,
  };
}
