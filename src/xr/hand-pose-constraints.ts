import * as THREE from 'three';
import neutralReference from './hand-neutral-reference.json';

type HandJoints = THREE.Group & { joints?: Record<string, THREE.Object3D | undefined> };
const CONTACT_JOINTS = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];

export function createHandPoseConstraints(mesh: THREE.SkinnedMesh, root: THREE.Group) {
  const bone = (name: string): THREE.Bone => mesh.skeleton.getBoneByName(name) as THREE.Bone;
  const thumb = [bone('thumb_01'), bone('thumb_02'), bone('thumb_03')];
  const roots = [bone('index_01'), bone('middle_01'), bone('outer_01')];
  const ends = [bone('index_03'), bone('middle_03'), bone('outer_03')];
  const contactChains = ['index', 'middle'].map((digit) =>
    [1, 2, 3].map((part) => bone(`${digit}_0${part}`)),
  );
  const fingerJoints = ['index', 'middle', 'outer'].flatMap((digit) =>
    [1, 2, 3].map((part) => {
      const item = bone(`${digit}_0${part}`);
      const world = item.getWorldQuaternion(new THREE.Quaternion());
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(world);
      axis
        .cross(new THREE.Vector3(0, 0, 1))
        .normalize()
        .applyQuaternion(world.invert());
      return { bone: item, rest: item.quaternion.clone(), axis, part: part - 1 };
    }),
  );
  const thumbCurrent = thumb.map(() => new THREE.Quaternion());
  const proximalLength = thumb[2]
    .getWorldPosition(new THREE.Vector3())
    .distanceTo(thumb[0].getWorldPosition(new THREE.Vector3()));
  const distalLength = Number(thumb[2].userData.restLength);
  const padOverhang = measurePadOverhang(mesh, thumb[2], distalLength);
  const points = Array.from({ length: 4 }, () => new THREE.Vector3());
  const directions = Array.from({ length: 3 }, () => new THREE.Vector3());
  const folded = Array.from({ length: 3 }, () => new THREE.Vector3());
  const tracked = Array.from({ length: 4 }, () => new THREE.Vector3());
  const flex = new THREE.Vector3();
  const palm = new THREE.Quaternion();
  const inversePalm = new THREE.Quaternion();
  const parent = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  const swing = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const middleTip = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const base = new THREE.Vector3();
  const target = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const end = new THREE.Vector3();
  const current = new THREE.Vector3();
  const rawThumb = new THREE.Vector3();
  const rawIndex = new THREE.Vector3();
  const contactOffset = new THREE.Vector3();
  const segment = new THREE.Line3();
  const thumbNeutral = {
    left: new THREE.Vector3().fromArray(neutralReference.thumbBasePositions.left),
    right: new THREE.Vector3().fromArray(neutralReference.thumbBasePositions.right),
  };
  const endpoint = (item: THREE.Bone, output: THREE.Vector3): THREE.Vector3 =>
    item.localToWorld(output.set(0, Number(item.userData.restLength), 0));
  const read = (hand: HandJoints, name: string, output: THREE.Vector3): boolean => {
    const joint = hand.joints?.[name];
    if (!joint?.visible) return false;
    joint.getWorldPosition(output);
    return true;
  };

  return {
    update(hand: HandJoints, side: 'left' | 'right', controllerClosure?: number): void {
      root.getWorldQuaternion(palm);
      inversePalm.copy(palm).invert();
      forward.set(0, 1, 0).applyQuaternion(palm);
      let closure = controllerClosure ?? 1;
      if (controllerClosure === undefined) {
        for (const digit of ['index', 'middle', 'ring']) {
          const names = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
          if (!names.every((name, i) => read(hand, `${digit}-finger-${name}`, points[i]))) {
            closure = 0;
            break;
          }
          for (let i = 0; i < 3; i++)
            directions[i].subVectors(points[i + 1], points[i]).normalize();
          const flexion =
            forward.angleTo(directions[0]) +
            directions[0].angleTo(directions[1]) +
            directions[1].angleTo(directions[2]);
          closure = Math.min(closure, THREE.MathUtils.smoothstep(flexion, 0.75, 2.2));
        }
      }

      // Tracked fingers follow their joints directly; the coordinated fist only shapes
      // the controller grip, which has no per-joint data.
      if (controllerClosure !== undefined) applyControllerGrip(closure);
      cupPalm(closure);
      if (controllerClosure === undefined) applyThumbOpposition(hand, side, closure);
    },
  };

  function applyControllerGrip(closure: number): void {
    const fistBlend = THREE.MathUtils.smoothstep(closure, 0.3, 1);
    for (const joint of fingerJoints) {
      rotation.setFromAxisAngle(joint.axis, [1.2, 1.35, 0.75][joint.part]);
      rotation.premultiply(joint.rest);
      joint.bone.quaternion.slerp(rotation, fistBlend).normalize();
      joint.bone.updateWorldMatrix(false, true);
    }
  }

  // The authored digits are wider than real fingers, so closing fingers swing toward the
  // middle finger to avoid a claw. Roots never translate: moving a skinned root bunches
  // the palm skin into a lump.
  function cupPalm(closure: number): void {
    root.worldToLocal(endpoint(ends[1], middleTip));
    for (const index of [0, 2]) {
      const item = roots[index];
      const sign = index === 0 ? 1 : -1;
      root.worldToLocal(endpoint(ends[index], tip));
      root.worldToLocal(item.getWorldPosition(base));
      const excess = Math.max(0, sign * (tip.x - middleTip.x) - 0.021) * closure;
      item.parent?.getWorldQuaternion(parent).invert();
      const cup = Math.min(
        0.26,
        Math.atan2(excess * 0.4, Math.max(0.015, Math.abs(tip.z - base.z))),
      );
      axis.set(0, 1, 0).applyQuaternion(palm).applyQuaternion(parent);
      rotation.setFromAxisAngle(axis, -sign * Math.sign(tip.z - base.z) * cup);
      item.quaternion.premultiply(rotation);
      item.updateWorldMatrix(false, true);
    }
  }

  function applyThumbOpposition(hand: HandJoints, side: 'left' | 'right', closure: number): void {
    if (!read(hand, 'thumb-tip', rawThumb) || !read(hand, 'index-finger-tip', rawIndex)) return;
    // The resting thumb lies on whichever phalanx it touches, so locate that contact on the
    // tracked index/middle segments and reproduce it on the matching model segment.
    let contactDistance = Number.POSITIVE_INFINITY;
    let contactDigit = 0;
    let contactSegment = 0;
    let contactT = 0;
    for (let digit = 0; digit < 2; digit++) {
      const prefix = digit === 0 ? 'index' : 'middle';
      if (!CONTACT_JOINTS.every((name, i) => read(hand, `${prefix}-finger-${name}`, points[i])))
        return;
      for (let k = 0; k < 3; k++) {
        segment.set(points[k], points[k + 1]);
        const t = segment.closestPointToPointParameter(rawThumb, true);
        segment.at(t, current);
        const distance = current.distanceTo(rawThumb);
        if (distance >= contactDistance) continue;
        contactDistance = distance;
        contactDigit = digit;
        contactSegment = k;
        contactT = t;
        contactOffset.subVectors(rawThumb, current);
      }
    }
    const tipContact =
      contactDigit === 0 && contactSegment === 2
        ? THREE.MathUtils.smoothstep(contactT, 0.3, 0.8)
        : 0;
    // A curled fist brings the thumb within pinch range of the buried index tip; only count
    // it as a pinch there when the thumb actually touches the tip.
    const pinch =
      (1 - THREE.MathUtils.smoothstep(rawThumb.distanceTo(rawIndex), 0.012, 0.075)) *
      THREE.MathUtils.lerp(1, tipContact, closure);
    const fold =
      closure * (1 - pinch) * (1 - THREE.MathUtils.smoothstep(contactDistance, 0.03, 0.055));
    const weight = pinch + fold;
    if (weight <= 0) return;
    if (read(hand, 'wrist', base) && read(hand, 'thumb-phalanx-proximal', delta)) {
      delta.sub(base).applyQuaternion(inversePalm).sub(thumbNeutral[side]).clampLength(0, 0.05);
      thumb[0].parent?.getWorldQuaternion(parent).invert();
      thumb[0].position.add(
        delta.multiplyScalar(weight).applyQuaternion(palm).applyQuaternion(parent),
      );
      thumb[0].updateWorldMatrix(false, true);
    }

    thumb[0].getWorldPosition(base);
    const chain = contactChains[contactDigit];
    chain[contactSegment].getWorldPosition(target);
    if (contactSegment < 2) chain[contactSegment + 1].getWorldPosition(current);
    else endpoint(chain[2], current);
    target.lerp(current, contactT);
    // Bone endpoints sit inside the rounded pads, so contact requires a finite separation;
    // a hovering thumb keeps its tracked clearance beyond that.
    const separation = 0.022 + Math.max(0, contactDistance - 0.02);
    if (contactOffset.lengthSq() > 1e-8)
      target.addScaledVector(contactOffset.normalize(), separation);
    else target.addScaledVector(axis.subVectors(base, target).normalize(), separation);
    endpoint(ends[0], tip);
    tip.addScaledVector(axis.subVectors(base, tip).normalize(), 0.017);
    target.lerp(tip, pinch / weight);
    axis.subVectors(target, base);
    // The tracked tip joint sits at the skin while the bone ends inside the pad, so a folded
    // thumb aims its pad surface at the contact. The pinch offset was tuned on bone ends.
    const reach = distalLength + padOverhang * (fold / weight);
    const distance = THREE.MathUtils.clamp(
      axis.length(),
      proximalLength - reach + 0.001,
      proximalLength + reach - 0.0005,
    );
    axis.normalize();
    end.copy(base).addScaledVector(axis, distance);
    pole.set(0, 0, side === 'left' ? -1 : 1).applyQuaternion(palm);
    pole.addScaledVector(axis, -pole.dot(axis));
    if (pole.lengthSq() < 1e-6) pole.copy(forward).addScaledVector(axis, -forward.dot(axis));
    pole.normalize();
    const cosine =
      (proximalLength ** 2 + distance ** 2 - reach ** 2) / (2 * proximalLength * distance);
    elbow
      .copy(base)
      .addScaledVector(axis, proximalLength * cosine)
      .addScaledVector(pole, proximalLength * Math.sqrt(Math.max(0, 1 - cosine ** 2)));
    directions[0].subVectors(elbow, base).normalize();
    directions[2].subVectors(end, elbow).normalize();
    directions[1].copy(directions[0]);
    foldThumb(hand, fold / weight);
    for (let i = 0; i < 3; i++) thumb[i].getWorldQuaternion(thumbCurrent[i]);
    for (let i = 0; i < 3; i++) {
      // Swinging from the tracked direction keeps the pad roll continuous as the
      // opposition weight rises and falls.
      current.set(0, 1, 0).applyQuaternion(thumbCurrent[i]);
      swing.setFromUnitVectors(current, directions[i]);
      rotation.copy(swing).multiply(thumbCurrent[i]);
      thumbCurrent[i].slerp(rotation, weight);
      rotation.copy(thumbCurrent[i]);
      thumb[i].parent?.getWorldQuaternion(parent).invert();
      rotation.premultiply(parent);
      thumb[i].quaternion.copy(rotation).normalize();
      thumb[i].updateWorldMatrix(false, true);
    }
  }

  // A thumb resting on the fist lies straight along the contact axis and bends only at the
  // pad by the tracked IP angle. The cartoon thumb is longer than the span to the contact;
  // bending the knuckle to absorb that excess arches the thumb off the fingers, so the pad
  // instead lands further along them.
  function foldThumb(hand: HandJoints, blend: number): void {
    if (blend <= 0) return;
    const names = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal'];
    if (!names.every((name, i) => read(hand, name, tracked[i]))) return;
    tracked[3].copy(rawThumb);
    for (let i = 0; i < 3; i++) tracked[i].subVectors(tracked[i + 1], tracked[i]).normalize();
    const ip = tracked[1].angleTo(tracked[2]);
    flex.crossVectors(tracked[0], tracked[1]).add(current.crossVectors(tracked[1], tracked[2]));
    flex.addScaledVector(axis, -flex.dot(axis));
    if (flex.length() < 0.05) return;
    flex.normalize();
    folded[0].copy(axis);
    folded[1].copy(axis);
    folded[2].copy(axis).applyAxisAngle(flex, ip);
    for (let i = 0; i < 3; i++) directions[i].lerp(folded[i], blend).normalize();
  }
}

function measurePadOverhang(mesh: THREE.SkinnedMesh, tip: THREE.Bone, length: number): number {
  const index = mesh.skeleton.bones.indexOf(tip);
  const position = mesh.geometry.getAttribute('position');
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  const toBone = new THREE.Matrix4().multiplyMatrices(
    mesh.skeleton.boneInverses[index],
    mesh.bindMatrix,
  );
  const vertex = new THREE.Vector3();
  let surface = length;
  for (let i = 0; i < position.count; i++) {
    let weight = 0;
    for (let k = 0; k < 4; k++)
      if (skinIndex.getComponent(i, k) === index) weight += skinWeight.getComponent(i, k);
    if (weight < 0.5) continue;
    surface = Math.max(surface, vertex.fromBufferAttribute(position, i).applyMatrix4(toBone).y);
  }
  return surface - length;
}
