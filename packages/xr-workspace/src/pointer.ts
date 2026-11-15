import * as THREE from 'three';

export interface PointerHit {
  object: THREE.Object3D;
  /** The entry of `roots` the object belongs to. */
  root: THREE.Object3D;
  distance: number;
  point: THREE.Vector3;
}

export interface Pointer {
  /**
   * Nearest hit among `roots` whose object and every ancestor up to and including its root are
   * visible. The returned hit is reused by the next call.
   */
  cast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    roots: readonly THREE.Object3D[],
  ): PointerHit | null;
  /** Casts along the −Z axis of `source`'s world transform, as an XR target-ray space points. */
  castFrom(source: THREE.Object3D, roots: readonly THREE.Object3D[]): PointerHit | null;
}

function visibleUpTo(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) return true;
  }
  return true;
}

export function createPointer(options: { far?: number; layers?: readonly number[] } = {}): Pointer {
  const raycaster = new THREE.Raycaster();
  if (options.far !== undefined) raycaster.far = options.far;
  for (const layer of options.layers ?? []) raycaster.layers.enable(layer);
  const hits: THREE.Intersection[] = [];
  const result: PointerHit = {
    object: new THREE.Object3D(),
    root: new THREE.Object3D(),
    distance: 0,
    point: new THREE.Vector3(),
  };
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  function cast(
    from: THREE.Vector3,
    along: THREE.Vector3,
    roots: readonly THREE.Object3D[],
  ): PointerHit | null {
    raycaster.ray.origin.copy(from);
    raycaster.ray.direction.copy(along);
    let found = false;
    for (const root of roots) {
      hits.length = 0;
      raycaster.intersectObject(root, true, hits);
      for (const hit of hits) {
        if (found && hit.distance >= result.distance) break;
        if (!visibleUpTo(hit.object, root)) continue;
        result.object = hit.object;
        result.root = root;
        result.distance = hit.distance;
        result.point.copy(hit.point);
        found = true;
        break;
      }
    }
    hits.length = 0;
    return found ? result : null;
  }

  return {
    cast,
    castFrom(source, roots) {
      source.updateWorldMatrix(true, false);
      source.getWorldPosition(origin);
      source.getWorldQuaternion(rotation);
      direction.set(0, 0, -1).applyQuaternion(rotation);
      return cast(origin, direction, roots);
    },
  };
}

export interface ButtonEdges {
  /** Call once per frame before reading. A missing gamepad releases every button. */
  update(gamepad: Gamepad | null | undefined): void;
  /** True only on the frame the button went down. */
  pressed(index: number): boolean;
  /** True only on the frame the button came up. */
  released(index: number): boolean;
  held(index: number): boolean;
  reset(): void;
}

export function createButtonEdges(): ButtonEdges {
  let previous: boolean[] = [];
  let current: boolean[] = [];
  return {
    update(gamepad) {
      [previous, current] = [current, previous];
      const count = Math.max(previous.length, gamepad?.buttons.length ?? 0);
      current.length = count;
      for (let i = 0; i < count; i++) current[i] = Boolean(gamepad?.buttons[i]?.pressed);
      previous.length = count;
    },
    pressed: (index) => Boolean(current[index]) && !previous[index],
    released: (index) => !current[index] && Boolean(previous[index]),
    held: (index) => Boolean(current[index]),
    reset() {
      previous.length = 0;
      current.length = 0;
    },
  };
}

export interface AxisRepeat {
  /** Returns −1 or 1 on the frames the axis should act, otherwise 0. */
  update(value: number, deltaSeconds: number): -1 | 0 | 1;
  reset(): void;
}

export function createAxisRepeat(
  options: { threshold?: number; initialDelay?: number; repeatDelay?: number } = {},
): AxisRepeat {
  const { threshold = 0.6, initialDelay = 0.4, repeatDelay = 0.12 } = options;
  let direction: -1 | 0 | 1 = 0;
  let remaining = 0;
  return {
    update(value, deltaSeconds) {
      const next = Math.abs(value) > threshold ? (value > 0 ? 1 : -1) : 0;
      if (next === 0) {
        direction = 0;
        return 0;
      }
      if (next !== direction) {
        direction = next;
        remaining = initialDelay;
        return next;
      }
      remaining -= deltaSeconds;
      if (remaining > 0) return 0;
      remaining = repeatDelay;
      return next;
    },
    reset() {
      direction = 0;
      remaining = 0;
    },
  };
}
