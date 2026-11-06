import * as THREE from 'three';
import neutralReference from './hand-neutral-reference.json';

type HandJoints = THREE.Group & { joints?: Record<string, THREE.Object3D | undefined> };

export function createHandPoseConstraints(mesh: THREE.SkinnedMesh, root: THREE.Group) {
  const bone = (name: string): THREE.Bone => mesh.skeleton.getBoneByName(name) as THREE.Bone;
  const thumb = [bone('thumb_01'), bone('thumb_02'), bone('thumb_03')];
  const roots = [bone('index_01'), bone('middle_01'), bone('outer_01')];
  const ends = [bone('index_03'), bone('middle_03'), bone('outer_03')];
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
  const thumbRest = thumb.map((item) => item.getWorldQuaternion(new THREE.Quaternion()));
  const thumbCurrent = thumb.map(() => new THREE.Quaternion());
  const proximalRest = thumb[2]
    .getWorldPosition(new THREE.Vector3())
    .sub(thumb[0].getWorldPosition(new THREE.Vector3()));
  const proximalLength = proximalRest.length();
  proximalRest.normalize();
  const distalLength = Number(thumb[2].userData.restLength);
  const distalRest = new THREE.Vector3(0, 1, 0).applyQuaternion(thumbRest[2]);
  const points = Array.from({ length: 4 }, () => new THREE.Vector3());
  const directions = Array.from({ length: 3 }, () => new THREE.Vector3());
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
  const rawThumb = new THREE.Vector3();
  const rawIndex = new THREE.Vector3();
  const rawKnuckle = new THREE.Vector3();
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

      const fistBlend = THREE.MathUtils.smoothstep(closure, 0.3, 1);
      const curlSign = controllerClosure !== undefined || side === 'right' ? 1 : -1;
      for (const joint of fingerJoints) {
        rotation.setFromAxisAngle(joint.axis, [1.2, 1.35, 0.75][joint.part] * curlSign);
        rotation.premultiply(joint.rest);
        joint.bone.quaternion.slerp(rotation, fistBlend).normalize();
        joint.bone.updateWorldMatrix(false, true);
      }
      root.worldToLocal(endpoint(ends[1], middleTip));
      for (const index of [0, 2]) {
        const item = roots[index];
        const sign = index === 0 ? 1 : -1;
        root.worldToLocal(endpoint(ends[index], tip));
        root.worldToLocal(item.getWorldPosition(base));
        const excess = Math.max(0, sign * (tip.x - middleTip.x) - 0.021) * closure;
        const shift = Math.min(index === 0 ? 0.0145 : 0.01, excess * 0.6);
        item.parent?.getWorldQuaternion(parent).invert();
        delta
          .set(-sign * shift, 0, 0)
          .applyQuaternion(palm)
          .applyQuaternion(parent);
        item.position.add(delta);
        const cup = Math.min(
          0.26,
          Math.atan2(excess - shift, Math.max(0.015, Math.abs(tip.z - base.z))),
        );
        axis.set(0, 1, 0).applyQuaternion(palm).applyQuaternion(parent);
        rotation.setFromAxisAngle(axis, -sign * Math.sign(tip.z - base.z) * cup);
        item.quaternion.premultiply(rotation);
        item.updateWorldMatrix(false, true);
      }

      if (controllerClosure !== undefined) return;
      if (
        !read(hand, 'wrist', base) ||
        !read(hand, 'thumb-phalanx-proximal', delta) ||
        !read(hand, 'thumb-tip', rawThumb) ||
        !read(hand, 'index-finger-tip', rawIndex) ||
        !read(hand, 'index-finger-phalanx-intermediate', rawKnuckle)
      )
        return;

      delta.sub(base).applyQuaternion(inversePalm).sub(thumbNeutral[side]).clampLength(0, 0.05);
      thumb[0].parent?.getWorldQuaternion(parent).invert();
      thumb[0].position.add(delta.applyQuaternion(palm).applyQuaternion(parent));
      thumb[0].updateWorldMatrix(false, true);
      const pinch = 1 - THREE.MathUtils.smoothstep(rawThumb.distanceTo(rawIndex), 0.012, 0.075);
      const fold =
        closure *
        (1 - pinch) *
        (1 - THREE.MathUtils.smoothstep(rawThumb.distanceTo(rawKnuckle), 0.035, 0.065));
      const weight = pinch + fold;
      if (weight <= 0) return;

      thumb[0].getWorldPosition(base);
      bone('index_02').getWorldPosition(target);
      endpoint(ends[0], tip);
      const pinchShare = pinch / (pinch + fold);
      target.lerp(tip, pinchShare);
      axis.subVectors(base, target).normalize();
      // Bone endpoints sit inside the rounded pads, so contact requires a finite separation.
      target.addScaledVector(axis, THREE.MathUtils.lerp(0.022, 0.017, pinchShare));
      axis.subVectors(target, base);
      const distance = THREE.MathUtils.clamp(
        axis.length(),
        proximalLength - distalLength + 0.001,
        proximalLength + distalLength - 0.0005,
      );
      axis.normalize();
      end.copy(base).addScaledVector(axis, distance);
      pole.set(0, 0, side === 'left' ? -1 : 1).applyQuaternion(palm);
      pole.addScaledVector(axis, -pole.dot(axis));
      if (pole.lengthSq() < 1e-6) pole.copy(forward).addScaledVector(axis, -forward.dot(axis));
      pole.normalize();
      const cosine =
        (proximalLength ** 2 + distance ** 2 - distalLength ** 2) / (2 * proximalLength * distance);
      elbow
        .copy(base)
        .addScaledVector(axis, proximalLength * cosine)
        .addScaledVector(pole, proximalLength * Math.sqrt(Math.max(0, 1 - cosine ** 2)));
      directions[0].subVectors(elbow, base).normalize().applyQuaternion(inversePalm);
      directions[1].subVectors(end, elbow).normalize().applyQuaternion(inversePalm);
      for (let i = 0; i < 3; i++) thumb[i].getWorldQuaternion(thumbCurrent[i]);
      for (let i = 0; i < 3; i++) {
        swing.setFromUnitVectors(i < 2 ? proximalRest : distalRest, directions[i < 2 ? 0 : 1]);
        rotation.copy(palm).multiply(swing).multiply(thumbRest[i]);
        thumbCurrent[i].slerp(rotation, weight);
        rotation.copy(thumbCurrent[i]);
        thumb[i].parent?.getWorldQuaternion(parent).invert();
        rotation.premultiply(parent);
        thumb[i].quaternion.copy(rotation).normalize();
        thumb[i].updateWorldMatrix(false, true);
      }
    },
  };
}
