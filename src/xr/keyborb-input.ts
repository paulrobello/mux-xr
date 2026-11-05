import * as THREE from 'three';

const PINCH_CLOSE = 0.045;
const PINCH_OPEN = 0.05;
const NEAR_ENTER = 0.08;
const NEAR_EXIT = 0.11;
const REARM_SECONDS = 0.04;

interface Orb {
  mesh: THREE.Mesh;
  rest: THREE.Vector3;
  normal: THREE.Vector3;
  diameter: number;
  lift: number;
}

export interface KeyborbPinchSample {
  hovered: THREE.Mesh | null;
  pressed: THREE.Mesh | null;
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
  animate(deltaSeconds: number): void;
  reset(source?: THREE.Object3D): void;
} {
  let keyboard: THREE.Group | null = null;
  const orbs: Orb[] = [];
  const hands = new Map<THREE.Object3D, HandState>();
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
        for (const hand of hands.values()) {
          const slot = hand.nearby?.mesh.userData.keyborbSlot;
          if (typeof slot === 'number') previousSlots.set(hand, slot);
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
          result: { hovered: null, pressed: null, released: false },
        };
        hands.set(source, state);
      }
      const result = state.result;
      result.hovered = result.pressed = null;
      result.released = false;
      if (!keyboard || !index || !thumb) {
        result.released = state.pinching;
        state.pinching = state.armed = false;
        state.activated = state.nativeEarly = state.enabled = false;
        state.nativePhase = 'idle';
        state.openSeconds = 0;
        state.openFrames = 0;
        state.nearby = null;
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
          retainedDistance < NEAR_EXIT
        )
          nearest = retained;
      }
      state.nearby = nearest;
      result.hovered = state.nearby?.mesh ?? null;
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
        }
        state.nativeEarly = false;
        state.openSeconds = 0;
        state.openFrames = 0;
        state.armed = false;
      }
      if (!enabled) state.armed = false;
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
      return key;
    },
    nativeRelease(source) {
      const state = hands.get(source);
      if (state?.nativePhase !== 'held') return false;
      state.nativePhase = 'released';
      state.armed = false;
      return true;
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
