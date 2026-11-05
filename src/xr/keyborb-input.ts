import * as THREE from 'three';

const PINCH_CLOSE = 0.045;
const PINCH_OPEN = 0.065;
const NEAR_ENTER = 0.08;
const NEAR_EXIT = 0.11;

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
  ): KeyborbPinchSample;
  near(source: THREE.Object3D): boolean;
  hovered(source: THREE.Object3D): THREE.Mesh | null;
  animate(deltaSeconds: number): void;
  reset(source?: THREE.Object3D): void;
} {
  let keyboard: THREE.Group | null = null;
  const orbs: Orb[] = [];
  const hands = new Map<THREE.Object3D, HandState>();
  const center = new THREE.Vector3();
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
      }
      keyboard?.updateWorldMatrix(true, false);
      keyboard?.getWorldScale(scale);
    },
    sample(source, index, thumb, rayKey, enabled) {
      let state = hands.get(source);
      if (!state) {
        state = {
          armed: false,
          pinching: false,
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
        state.nearby = null;
        return result;
      }
      let nearest: Orb | null = null;
      let distance = state.nearby ? NEAR_EXIT : NEAR_ENTER;
      for (const orb of orbs) {
        if (!orb.mesh.visible) continue;
        center.copy(orb.rest).applyMatrix4(keyboard.matrixWorld);
        normal.copy(orb.normal).transformDirection(keyboard.matrixWorld);
        const radius = (orb.diameter * Math.abs(scale.x)) / 2;
        if (
          Math.max(
            delta.copy(index).sub(center).dot(normal),
            delta.copy(thumb).sub(center).dot(normal),
          ) < -radius
        )
          continue;
        const candidate = Math.min(index.distanceTo(center), thumb.distanceTo(center)) - radius;
        if (candidate < distance) {
          nearest = orb;
          distance = candidate;
        }
      }
      state.nearby = nearest;
      result.hovered = nearest?.mesh ?? null;
      const separation = index.distanceTo(thumb);
      if (separation >= PINCH_OPEN) {
        result.released = state.pinching;
        state.pinching = false;
        state.armed = enabled;
      } else if (separation <= PINCH_CLOSE && !state.pinching) {
        state.pinching = true;
        if (state.armed && enabled) result.pressed = nearest?.mesh ?? rayKey;
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
    animate(deltaSeconds) {
      const alpha = 1 - Math.exp(-24 * Math.max(0, deltaSeconds));
      for (const orb of orbs) {
        const wanted = targeted(orb) ? orb.diameter * 0.75 : 0;
        orb.lift = THREE.MathUtils.lerp(orb.lift, wanted, alpha);
        orb.mesh.position.copy(orb.rest).addScaledVector(orb.normal, orb.lift);
        orb.mesh.userData.keyborbLift = orb.lift;
      }
    },
    reset,
  };
}
