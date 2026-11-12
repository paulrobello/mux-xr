import * as THREE from 'three';

export interface HandContactProbe {
  point: THREE.Vector3;
  radius: number;
}
export interface HandContactSample {
  nearKeyboard: boolean;
  hovered: THREE.Mesh | null;
  pressed: THREE.Mesh | null;
  released: THREE.Mesh | null;
}
export interface HandContact {
  readonly pressed: boolean;
  sample(
    index: THREE.Vector3,
    palm: THREE.Vector3,
    keyboard: THREE.Group | null,
    enabled: boolean,
  ): HandContactSample;
  near(index: THREE.Vector3, palm: THREE.Vector3, keyboard: THREE.Group | null): boolean;
  grip(probes: readonly HandContactProbe[], roots: readonly THREE.Group[]): THREE.Group | null;
  reset(preserveNear?: boolean): void;
}

interface Surface {
  mesh: THREE.Mesh | null;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  signed: number;
}
const surface = (): Surface => ({
  mesh: null,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: Infinity,
  signed: Infinity,
});
const ENTER_NEAR = 0.14;
const EXIT_NEAR = 0.2;
const PRESS_DEPTH = 0.01;
const WITHDRAW = 0.035;
const PAD_RADIUS = 0.006;

function visible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (!node.visible || node.userData.focusHidden || node.userData.labelDisposed) return false;
  return true;
}

export function createHandContact(): HandContact {
  const inverse = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const local = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const world = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  const delta = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const sweep = new THREE.Raycaster();
  const sweepHits: THREE.Intersection[] = [];
  const keyHit = surface();
  const bodyHit = surface();
  const palmHit = surface();
  const gripHit = surface();
  const keys: THREE.Mesh[] = [];
  const bodies: THREE.Mesh[] = [];
  const ids = new WeakMap<THREE.Mesh, string>();
  const result: HandContactSample = {
    nearKeyboard: false,
    hovered: null,
    pressed: null,
    released: null,
  };
  let cachedKeyboard: THREE.Group | null = null;
  let wasNear = false;
  let hasPrevious = false;
  let armed = false;
  let latched = false;
  let active: THREE.Mesh | null = null;
  let activeId: string | undefined;

  const prepare = (keyboard: THREE.Group | null): void => {
    if (cachedKeyboard !== keyboard) collect(keyboard);
    if (!keyboard) return;
    // Contact reads only these direct children, so refreshing the keyboard's whole subtree (over
    // 160 nodes with the Keyborb) on every call is wasted; it ran several times a frame per hand.
    keyboard.updateWorldMatrix(true, false);
    for (const mesh of keys) mesh.updateWorldMatrix(false, false);
    for (const mesh of bodies) if (!keys.includes(mesh)) mesh.updateWorldMatrix(false, false);
  };
  const collect = (keyboard: THREE.Group | null): void => {
    cachedKeyboard = keyboard;
    keys.length = 0;
    bodies.length = 0;
    if (!keyboard) return;
    for (const object of keyboard.children) {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) continue;
      if (mesh.name === 'input-backdrop') bodies.push(mesh);
      const action = mesh.userData.inputAction;
      // Keyborb orbs type by pinch only, so a fingertip can poke just the panel buttons.
      if (!action || action === 'noop' || action === 'grabInput' || mesh.userData.keyborb) continue;
      ids.set(mesh, `${keyboard.name}:${mesh.position.x.toFixed(4)}:${mesh.position.y.toFixed(4)}`);
      keys.push(mesh);
    }
    if (!bodies.length) bodies.push(...keys);
  };
  const checkMesh = (mesh: THREE.Mesh, point: THREE.Vector3, hit: Surface): void => {
    if (!visible(mesh)) return;
    const geometry = mesh.geometry as THREE.BufferGeometry & {
      isInstancedBufferGeometry?: boolean;
    };
    if (geometry.isInstancedBufferGeometry || mesh.parent?.userData.labelTextObject === mesh)
      return;
    const positions = geometry.getAttribute('position');
    if (!positions) return;
    if (Math.abs(mesh.matrixWorld.determinant()) < 1e-12) return;
    inverse.copy(mesh.matrixWorld).invert();
    local.copy(point).applyMatrix4(inverse);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    geometry.boundingBox?.clampPoint(local, closest);
    world.copy(closest).applyMatrix4(mesh.matrixWorld);
    if (world.distanceTo(point) > hit.distance) return;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const indices = geometry.index;
    const count = indices?.count ?? positions.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      triangle.a.fromBufferAttribute(positions, indices ? indices.getX(offset) : offset);
      triangle.b.fromBufferAttribute(positions, indices ? indices.getX(offset + 1) : offset + 1);
      triangle.c.fromBufferAttribute(positions, indices ? indices.getX(offset + 2) : offset + 2);
      triangle.closestPointToPoint(local, closest);
      world.copy(closest).applyMatrix4(mesh.matrixWorld);
      const distance = world.distanceTo(point);
      if (distance >= hit.distance) continue;
      triangle.getNormal(normal).applyNormalMatrix(normalMatrix);
      hit.mesh = mesh;
      hit.distance = distance;
      hit.point.copy(world);
      hit.normal.copy(normal);
      hit.signed = delta.copy(point).sub(world).dot(normal);
    }
  };
  const nearest = (
    meshes: readonly THREE.Mesh[],
    point: THREE.Vector3,
    hit: Surface,
    limit = EXIT_NEAR,
  ): void => {
    hit.mesh = null;
    hit.distance = limit;
    hit.signed = Infinity;
    for (const mesh of meshes) checkMesh(mesh, point, hit);
  };
  const near = (
    index: THREE.Vector3,
    palm: THREE.Vector3,
    keyboard: THREE.Group | null,
  ): boolean => {
    prepare(keyboard);
    if (!keyboard || !visible(keyboard)) return false;
    nearest(bodies, index, bodyHit);
    nearest(bodies, palm, palmHit);
    return Math.min(bodyHit.distance, palmHit.distance) < (wasNear ? EXIT_NEAR : ENTER_NEAR);
  };
  const reset = (preserveNear = false): void => {
    cachedKeyboard = null;
    keys.length = 0;
    bodies.length = 0;
    if (!preserveNear) wasNear = false;
    hasPrevious = false;
    armed = false;
    latched = false;
    active = null;
    activeId = undefined;
    result.nearKeyboard = wasNear;
    result.hovered = result.pressed = result.released = null;
  };
  const sample = (
    index: THREE.Vector3,
    palm: THREE.Vector3,
    keyboard: THREE.Group | null,
    enabled: boolean,
  ): HandContactSample => {
    result.pressed = result.released = result.hovered = null;
    result.nearKeyboard = near(index, palm, keyboard);
    wasNear = result.nearKeyboard;
    if (!wasNear) {
      result.released = active;
      active = null;
      activeId = undefined;
      armed = latched = false;
      previous.copy(index);
      hasPrevious = Boolean(keyboard);
      return result;
    }
    nearest(keys, index, keyHit);
    if (keyHit.mesh && keyHit.distance < 0.035) result.hovered = keyHit.mesh;
    if (!enabled) {
      result.released = active;
      active = null;
      activeId = undefined;
      armed = false;
      latched = true;
      previous.copy(index);
      hasPrevious = true;
      return result;
    }
    if (active) {
      const lateral = keyHit.distance ** 2 - keyHit.signed ** 2;
      if (
        !keyHit.mesh ||
        ids.get(keyHit.mesh) !== activeId ||
        keyHit.distance > 0.045 ||
        keyHit.signed > 0.024 ||
        lateral > 0.012 ** 2
      ) {
        result.released = active;
        active = null;
        activeId = undefined;
      } else active = keyHit.mesh;
    }
    if (bodyHit.mesh && bodyHit.signed >= WITHDRAW) {
      armed = true;
      latched = false;
    }
    if (
      !latched &&
      keyHit.mesh &&
      hasPrevious &&
      delta.copy(previous).sub(keyHit.point).dot(keyHit.normal) >= WITHDRAW
    )
      armed = true;
    if (!active && !latched && armed && hasPrevious) {
      const movement = delta.copy(index).sub(previous);
      const length = movement.length();
      let pressed: THREE.Mesh | null = null;
      if (
        keyHit.mesh &&
        keyHit.signed <= PRESS_DEPTH &&
        keyHit.signed >= -0.045 &&
        keyHit.distance ** 2 - keyHit.signed ** 2 <= PAD_RADIUS ** 2 &&
        movement.dot(keyHit.normal) < -0.0005
      )
        pressed = keyHit.mesh;
      if (length > 0.001) {
        world.copy(previous);
        if (keyHit.mesh) world.addScaledVector(keyHit.normal, -PRESS_DEPTH);
        else if (bodyHit.mesh) world.addScaledVector(bodyHit.normal, -PRESS_DEPTH);
        sweep.set(world, movement.divideScalar(length));
        sweep.far = length;
        sweepHits.length = 0;
        sweep.intersectObjects(keys, false, sweepHits);
        for (const hit of sweepHits) {
          if (!visible(hit.object) || !hit.face) continue;
          normalMatrix.getNormalMatrix(hit.object.matrixWorld);
          normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix);
          if (normal.dot(movement) >= 0) continue;
          pressed = hit.object as THREE.Mesh;
          break;
        }
      }
      if (pressed) {
        active = pressed;
        activeId = ids.get(pressed);
        result.pressed = pressed;
        latched = true;
        armed = false;
      }
    }
    previous.copy(index);
    hasPrevious = true;
    return result;
  };
  return {
    get pressed() {
      return active !== null;
    },
    sample,
    near,
    reset,
    grip(probes, roots) {
      let owner: THREE.Group | null = null;
      let distance = Infinity;
      for (const root of roots) {
        if (!visible(root)) continue;
        root.updateWorldMatrix(true, true);
        for (const probe of probes) {
          gripHit.mesh = null;
          gripHit.distance = Math.min(probe.radius, distance);
          root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh) checkMesh(mesh, probe.point, gripHit);
          });
          if (gripHit.mesh && gripHit.distance < distance) {
            owner = root;
            distance = gripHit.distance;
          }
        }
      }
      return owner;
    },
  };
}
