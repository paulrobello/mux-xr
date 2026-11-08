import * as THREE from 'three';
import {
  NEAR_ENTER as HIERARCHY_NEAR_ENTER,
  NEAR_EXIT as HIERARCHY_NEAR_EXIT,
  PINCH_CLOSE,
  PINCH_OPEN,
} from './keyborb-input';

export { HIERARCHY_NEAR_ENTER, HIERARCHY_NEAR_EXIT };

export interface HierarchyTouchSample {
  /** The target the pinch point is near, or the one a closed pinch holds. */
  hovered: THREE.Object3D | null;
  /** Set on the frame a pinch that closed on a target opens near it again. */
  committed: THREE.Object3D | null;
}

export interface HierarchyTouch {
  sample(
    source: object,
    index: THREE.Vector3 | null,
    thumb: THREE.Vector3 | null,
    targets: readonly THREE.Object3D[],
  ): HierarchyTouchSample;
  /** The target nearest `point` within `radius` metres of its bounds. */
  nearest(
    point: THREE.Vector3,
    targets: readonly THREE.Object3D[],
    radius: number,
  ): THREE.Object3D | null;
  near(source: object): boolean;
  reset(source?: object): void;
}

interface SourceState {
  hovered: THREE.Object3D | null;
  held: THREE.Object3D | null;
  closed: boolean;
  /** A pinch must be seen open before it can latch, so one already closed at reset never does. */
  armed: boolean;
}

const sphere = new THREE.Sphere();
const box = new THREE.Box3();
const pinchPoint = new THREE.Vector3();

/** Signed gap from `point` to the target's world bounding sphere; negative inside it. */
function gapTo(target: THREE.Object3D, point: THREE.Vector3): number {
  const mesh = target as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    sphere.copy(mesh.geometry.boundingSphere as THREE.Sphere).applyMatrix4(mesh.matrixWorld);
  } else {
    box.setFromObject(target);
    if (box.isEmpty()) return Infinity;
    box.getBoundingSphere(sphere);
  }
  return sphere.center.distanceTo(point) - sphere.radius;
}

function visible(target: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = target; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

export function createHierarchyTouch(): HierarchyTouch {
  const states = new Map<object, SourceState>();
  const nearest = (
    point: THREE.Vector3,
    targets: readonly THREE.Object3D[],
    radius: number,
  ): THREE.Object3D | null => {
    let best: THREE.Object3D | null = null;
    let bestGap = radius;
    for (const target of targets) {
      if (!visible(target)) continue;
      const gap = gapTo(target, point);
      if (gap <= bestGap) {
        best = target;
        bestGap = gap;
      }
    }
    return best;
  };
  const live = (target: THREE.Object3D | null, targets: readonly THREE.Object3D[]): boolean =>
    Boolean(target && targets.includes(target) && visible(target));
  return {
    sample(source, index, thumb, targets) {
      let state = states.get(source);
      if (!state) {
        state = { hovered: null, held: null, closed: false, armed: false };
        states.set(source, state);
      }
      if (!index || !thumb) {
        Object.assign(state, { hovered: null, held: null, closed: false, armed: false });
        return { hovered: null, committed: null };
      }
      // A rebuild replaces the meshes; a held one that left the scene cannot be committed.
      if (state.held && !live(state.held, targets)) state.held = null;
      if (state.hovered && !live(state.hovered, targets)) state.hovered = null;
      pinchPoint.copy(index).add(thumb).multiplyScalar(0.5);
      const gap = index.distanceTo(thumb);
      const wasClosed = state.closed;
      state.closed = wasClosed ? gap < PINCH_OPEN : gap < PINCH_CLOSE;
      const kept = state.hovered ? gapTo(state.hovered, pinchPoint) <= HIERARCHY_NEAR_EXIT : false;
      // A held target stays hovered so the closing drift cannot hand the pinch to a neighbour.
      if (!state.held && !kept) state.hovered = nearest(pinchPoint, targets, HIERARCHY_NEAR_ENTER);
      let committed: THREE.Object3D | null = null;
      if (state.closed && !wasClosed) state.held = state.armed ? state.hovered : null;
      else if (!state.closed && wasClosed) {
        if (state.held && state.held === state.hovered && kept) committed = state.held;
        state.held = null;
        if (!kept) state.hovered = nearest(pinchPoint, targets, HIERARCHY_NEAR_ENTER);
      }
      if (!state.closed) state.armed = true;
      return { hovered: state.hovered, committed };
    },
    nearest,
    near(source) {
      return Boolean(states.get(source)?.hovered);
    },
    reset(source) {
      if (source) states.delete(source);
      else states.clear();
    },
  };
}
