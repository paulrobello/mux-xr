import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type CartoonHand, createCartoonHand } from './cartoon-hand';
import type { HandContactProbe } from './hand-contact';
import neutralReference from './hand-neutral-reference.json';
import { createHandPoseConstraints } from './hand-pose-constraints';

export const RIGGED_HAND_ASSET_URL = '/assets/hand.glb?v=e143187b1f57';
const DIGITS = ['thumb', 'index', 'middle', 'outer'] as const;
// The cartoon's three wide fingers stand in for four real ones, so tracked spread reads as a fan.
// Skin-only helper bones at the thumb_01 head follow a share of thumb_01's turn and root travel
// from bind. The root and web helpers carry the wrist/thumb_01 band at half the turn, so no vertex
// blends bones more than half a thumb_01 turn apart; behind the head the band and the heel follow
// the full root travel, so an opposing thumb carries the heel inward instead of leaving a lobe.
export const THUMB_HELPERS = {
  thumb_root_helper: { rotation: 0.5, travel: 1 },
  thumb_heel_helper: { rotation: 0, travel: 1 },
  thumb_web_helper: { rotation: 0.5, travel: 0.55 },
} as const;
// Per-side corrective shape keys that round the closed-fist thumb root back to the precision-v5
// outline; the runtime retarget is side-asymmetric, so each hand has its own fit. The weight rises
// with the opposing thumb's root travel scaled by finger closure (metres), so the open palm, an
// open-hand pinch and controller grips leave it at 0. It follows that target with a time constant
// (seconds), and each frame the key may move its skin at most THUMB_FOLD_SKIN_RATIO times as far as
// the skin under it moved, or THUMB_FOLD_MIN_RATE (weight per second) if that is more, so a still
// hand still settles; tracking jitter on a still fist therefore cannot make the skin breathe. The first tracked frame
// after a hide, a controller frame or a side change takes the target directly.
export const THUMB_FOLD_MORPHS = { left: 'thumb_fold_left', right: 'thumb_fold_right' } as const;
export const THUMB_FOLD_START = 0.004;
export const THUMB_FOLD_FULL = 0.015;
export const THUMB_FOLD_SMOOTHING = 0.085;
export const THUMB_FOLD_SKIN_RATIO = 0.6;
export const THUMB_FOLD_MIN_RATE = 0.12;
const FOLD_SAMPLES = 16;
const SPLAY_KEEP = 0.3;
const SPLAY_INWARD = 0.05;
const SPLAY_LIMIT = 0.35;
const neutralPoses = neutralReference as Record<'left' | 'right', Record<string, number[]>>;
const JOINTS = [
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  [
    'index-finger-phalanx-proximal',
    'index-finger-phalanx-intermediate',
    'index-finger-phalanx-distal',
    'index-finger-tip',
  ],
  [
    'middle-finger-phalanx-proximal',
    'middle-finger-phalanx-intermediate',
    'middle-finger-phalanx-distal',
    'middle-finger-tip',
  ],
  [
    'ring-finger-phalanx-proximal',
    'ring-finger-phalanx-intermediate',
    'ring-finger-phalanx-distal',
    'ring-finger-tip',
  ],
];
type TrackedHand = THREE.Group & { joints?: Record<string, THREE.Object3D | undefined> };
export interface RiggedHandOptions {
  assetUrl?: string;
  loader?: GLTFLoader;
}
export interface RiggedHand extends CartoonHand {
  assetReady: Promise<boolean>;
}
interface JointDriver {
  bone: THREE.Bone;
  jointName: string;
  rest: THREE.Quaternion;
  restPosition: THREE.Vector3;
  restScale: THREE.Vector3;
  alignedRest: Record<'left' | 'right', THREE.Quaternion>;
  neutralInverse: Record<'left' | 'right', THREE.Quaternion>;
  curlAxis: THREE.Vector3;
  digit: number;
  part: number;
}

function disposeAsset(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
}

export function createRiggedHand(options: RiggedHandOptions = {}): RiggedHand {
  const fallback = createCartoonHand();
  const originalUpdate = fallback.update.bind(fallback);
  const originalController = fallback.updateController.bind(fallback);
  const skin = fallback.root.getObjectByName('cartoon-hand-skin');
  const wristJoint = new THREE.Mesh(
    new THREE.SphereGeometry(0.019, 16, 12),
    (skin as THREE.Mesh).material,
  );
  wristJoint.name = 'authored-hand-wrist';
  wristJoint.raycast = () => undefined;
  fallback.root.add(wristJoint);
  fallback.root.userData.handAsset = 'loading';
  let authored: THREE.Group | undefined;
  let mesh: THREE.SkinnedMesh | undefined;
  let poseConstraints: ReturnType<typeof createHandPoseConstraints> | undefined;
  const foldMorphs: {
    side: 'left' | 'right';
    index: number;
    reach: number;
    samples: number[];
    previous: THREE.Vector3[];
  }[] = [];
  let foldWeight = 0;
  let foldSide: 'left' | 'right' | undefined;
  let disposed = false;
  let controllerMode = false;
  let wristOffset = 0;
  const curls = [0, 0, 0, 0];
  const drivers: JointDriver[] = [];
  const probes: HandContactProbe[] = [];
  const probeVertices: number[] = [];
  const position = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const across = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  const palmRotation = new THREE.Quaternion();
  const inverseRotation = new THREE.Quaternion();
  const visibleIndex = new THREE.Vector3();
  const visibleThumb = new THREE.Vector3();
  const pinchPoint = new THREE.Vector3();
  const splayVector = new THREE.Vector3();
  const knuckle = new THREE.Vector3();
  const palmNormal = new THREE.Vector3();
  const swings = [0, 0, 0, 0].map(() => new THREE.Quaternion());
  let indexEnd: THREE.Bone | undefined;
  let thumbEnd: THREE.Bone | undefined;
  const thumbHelpers: {
    bone: THREE.Bone;
    thumb: THREE.Bone;
    rest: THREE.Quaternion;
    restPosition: THREE.Vector3;
    rotation: number;
    travel: number;
  }[] = [];
  const assetReady = (options.loader ?? new GLTFLoader())
    .loadAsync(options.assetUrl ?? RIGGED_HAND_ASSET_URL)
    .then((gltf) => {
      if (disposed) {
        disposeAsset(gltf.scene);
        return false;
      }
      const meshes: THREE.SkinnedMesh[] = [];
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) meshes.push(object);
      });
      const candidate = meshes[0];
      const names = [
        'wrist',
        ...DIGITS.flatMap((digit) => [1, 2, 3].map((part) => `${digit}_0${part}`)),
      ];
      if (
        meshes.length !== 1 ||
        candidate.skeleton.bones.length !==
          names.length +
            Object.keys(THUMB_HELPERS).filter((name) => candidate.skeleton.getBoneByName(name))
              .length ||
        names.some((name) => !candidate.skeleton.bones.some((bone) => bone.name === name)) ||
        candidate.skeleton.bones.some(
          (bone) => !Number.isFinite(bone.userData.restLength) || bone.userData.restLength <= 0,
        )
      ) {
        disposeAsset(gltf.scene);
        fallback.root.userData.handAsset = 'fallback';
        return false;
      }
      authored = gltf.scene;
      authored.name = 'authored-hand-root';
      mesh = candidate;
      mesh.name = 'authored-hand-skin';
      mesh.frustumCulled = false;
      mesh.raycast = () => undefined;
      indexEnd = candidate.skeleton.getBoneByName('index_03');
      thumbEnd = candidate.skeleton.getBoneByName('thumb_03');
      const thumbRoot = candidate.skeleton.getBoneByName('thumb_01');
      thumbHelpers.length = 0;
      for (const [name, share] of Object.entries(THUMB_HELPERS)) {
        const helper = candidate.skeleton.getBoneByName(name);
        if (helper && thumbRoot)
          thumbHelpers.push({
            bone: helper,
            thumb: thumbRoot,
            rest: helper.quaternion.clone(),
            restPosition: helper.position.clone(),
            ...share,
          });
      }
      foldMorphs.length = 0;
      for (const [side, name] of Object.entries(THUMB_FOLD_MORPHS) as [
        'left' | 'right',
        string,
      ][]) {
        const index = candidate.morphTargetDictionary?.[name];
        const target = candidate.geometry.morphAttributes.position?.[index ?? -1];
        if (index === undefined || !target) continue;
        // The skin motion under the key is sampled at the vertices it moves furthest.
        const reaches = Array.from({ length: target.count }, (_, vertex) =>
          Math.hypot(target.getX(vertex), target.getY(vertex), target.getZ(vertex)),
        );
        const samples = reaches
          .map((_, vertex) => vertex)
          .sort((a, b) => reaches[b] - reaches[a])
          .slice(0, FOLD_SAMPLES);
        foldMorphs.push({
          side,
          index,
          reach: reaches[samples[0]],
          samples,
          previous: samples.map(() => new THREE.Vector3()),
        });
      }
      // The thumb_fold morph widens the geometry bounding box; the wrist sits on the bind surface.
      wristOffset = new THREE.Box3().setFromBufferAttribute(
        mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
      ).min.y;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material.isMeshStandardMaterial) {
        material.emissive.copy(material.color);
        material.emissiveIntensity = 0.6;
        const armMaterial = (skin as THREE.Mesh).material as THREE.MeshStandardMaterial;
        armMaterial.copy(material);
      }
      authored.updateMatrixWorld(true);
      for (const [digit, name] of DIGITS.entries()) {
        for (let part = 0; part < 3; part++) {
          const bone = candidate.skeleton.bones.find(
            (item) => item.name === `${name}_0${part + 1}`,
          ) as THREE.Bone;
          const rest = bone.quaternion.clone();
          const worldRotation = bone.getWorldQuaternion(new THREE.Quaternion());
          const restDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(worldRotation);
          const curlAxis = new THREE.Vector3()
            .crossVectors(restDirection, new THREE.Vector3(0, 0, 1))
            .normalize();
          curlAxis.applyQuaternion(parentRotation.copy(worldRotation).invert());
          // The visible thumb starts at MCP; its first two bones form the proximal phalanx.
          const jointName =
            digit === 0 && part < 2 ? 'thumb-phalanx-proximal' : JOINTS[digit][part];
          const neutral = {
            left: new THREE.Quaternion().fromArray(neutralPoses.left[jointName]),
            right: new THREE.Quaternion().fromArray(neutralPoses.right[jointName]),
          };
          // The authored rest pose differs from the tracked neutral by up to 75 degrees
          // (sideways thumb), so each bone is re-aimed along the neutral joint's -Z axis.
          const aligned = (side: 'left' | 'right'): THREE.Quaternion =>
            new THREE.Quaternion()
              .setFromUnitVectors(
                restDirection,
                new THREE.Vector3(0, 0, -1).applyQuaternion(neutral[side]),
              )
              .multiply(worldRotation);
          drivers.push({
            bone,
            jointName,
            rest,
            restPosition: bone.position.clone(),
            restScale: bone.scale.clone(),
            alignedRest: { left: aligned('left'), right: aligned('right') },
            neutralInverse: {
              left: neutral.left.clone().invert(),
              right: neutral.right.clone().invert(),
            },
            curlAxis,
            digit,
            part,
          });
        }
      }
      const cells = new Set<string>();
      const vertices = mesh.geometry.getAttribute('position');
      for (let index = 0; index < vertices.count; index++) {
        position.fromBufferAttribute(vertices, index);
        const cell = `${Math.floor(position.x / 0.015)},${Math.floor(position.y / 0.015)},${Math.floor(position.z / 0.015)}`;
        if (cells.has(cell)) continue;
        cells.add(cell);
        probeVertices.push(index);
        probes.push({ point: new THREE.Vector3(), radius: 0.012 });
      }
      probes.push({ point: wristJoint.position, radius: 0.019 });
      poseConstraints = createHandPoseConstraints(mesh, authored);
      fallback.root.add(authored);
      if (skin) skin.visible = false;
      fallback.root.userData.handAsset = 'loaded';
      return true;
    })
    .catch(() => {
      if (!disposed) fallback.root.userData.handAsset = 'fallback';
      return false;
    });

  fallback.update = (source, camera, side, deltaSeconds): void => {
    originalUpdate(source, camera, side, deltaSeconds);
    wristJoint.position
      .copy(fallback.root.userData.wristPosition as THREE.Vector3)
      .addScaledVector(fallback.root.userData.palmForward as THREE.Vector3, 0.003);
    if (!authored || !mesh || !fallback.root.visible) {
      foldSide = undefined;
      return;
    }
    forward.copy(fallback.root.userData.palmForward as THREE.Vector3);
    normal.copy(fallback.root.userData.wristBackNormal as THREE.Vector3).negate();
    across.crossVectors(forward, normal).normalize();
    basis.makeBasis(across, forward, normal);
    const tracked = source as TrackedHand;
    authored.position
      .copy(fallback.root.userData.wristPosition as THREE.Vector3)
      .addScaledVector(forward, -wristOffset);
    authored.quaternion.setFromRotationMatrix(basis);
    authored.updateMatrixWorld(true);
    authored.getWorldQuaternion(palmRotation);
    inverseRotation.copy(palmRotation).invert();
    // A curled finger's knuckle-to-tip vector folds back into the palm, so its spread
    // angle is meaningless; each angle is returned with a weight that fades it out.
    const splay = (digit: number): { angle: number; weight: number } | undefined => {
      const base = tracked.joints?.[JOINTS[digit][0]];
      const tip = tracked.joints?.[JOINTS[digit][3]];
      if (!base?.visible || !tip?.visible) return undefined;
      base.getWorldPosition(knuckle);
      tip.getWorldPosition(splayVector).sub(knuckle).applyQuaternion(inverseRotation);
      return {
        angle: Math.atan2(splayVector.x, splayVector.y),
        weight: THREE.MathUtils.smoothstep(Math.hypot(splayVector.x, splayVector.y), 0.045, 0.065),
      };
    };
    const middle = controllerMode ? undefined : splay(2);
    palmNormal.set(0, 0, 1).applyQuaternion(palmRotation);
    for (const digit of [1, 3]) {
      const own = middle === undefined ? undefined : splay(digit);
      let angle = 0;
      if (own && middle) {
        const spread = THREE.MathUtils.euclideanModulo(
          own.angle - middle.weight * middle.angle + Math.PI,
          2 * Math.PI,
        );
        angle = THREE.MathUtils.clamp(
          own.weight *
            ((1 - SPLAY_KEEP) * (spread - Math.PI) + (digit === 1 ? 1 : -1) * SPLAY_INWARD),
          -SPLAY_LIMIT,
          SPLAY_LIMIT,
        );
      }
      swings[digit].setFromAxisAngle(palmNormal, angle);
    }
    for (const driver of drivers) {
      const { bone, rest, digit, part } = driver;
      bone.matrixAutoUpdate = true;
      bone.position.copy(driver.restPosition);
      bone.scale.copy(driver.restScale);
      bone.quaternion.copy(rest);
      if (controllerMode) {
        const angle =
          curls[digit] * (digit === 0 ? [0.25, 0.2, 0.15][part] : [0.8, 0.75, 0.65][part]);
        rotation.setFromAxisAngle(driver.curlAxis, angle);
        bone.quaternion.multiply(rotation);
      } else {
        const joint = tracked.joints?.[driver.jointName];
        if (joint?.visible && bone.parent) {
          joint.getWorldQuaternion(rotation);
          rotation
            .premultiply(inverseRotation)
            .multiply(driver.neutralInverse[side])
            .multiply(driver.alignedRest[side])
            .premultiply(palmRotation)
            .premultiply(swings[digit]);
          bone.parent.getWorldQuaternion(parentRotation).invert();
          bone.quaternion.copy(parentRotation).multiply(rotation).normalize();
        }
      }
      bone.updateWorldMatrix(false, true);
    }
    poseConstraints?.update(
      tracked,
      side,
      controllerMode ? Math.min(curls[1], curls[2], curls[3]) : undefined,
    );
    for (const helper of thumbHelpers) {
      const { bone, thumb } = helper;
      bone.matrixAutoUpdate = true;
      bone.position.lerpVectors(helper.restPosition, thumb.position, helper.travel);
      bone.quaternion.slerpQuaternions(helper.rest, thumb.quaternion, helper.rotation);
      bone.scale.copy(thumb.scale);
      bone.updateWorldMatrix(false, true);
    }
    mesh.updateWorldMatrix(true, false);
    mesh.skeleton.update();
    const foldTarget = THREE.MathUtils.smoothstep(
      poseConstraints?.foldTravel ?? 0,
      THUMB_FOLD_START,
      THUMB_FOLD_FULL,
    );
    const own = foldMorphs.find((morph) => morph.side === side);
    let skinStep = 0;
    if (own) {
      const bind = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < own.samples.length; k++) {
        position.fromBufferAttribute(bind, own.samples[k]);
        mesh.applyBoneTransform(own.samples[k], position);
        skinStep = Math.max(skinStep, position.distanceTo(own.previous[k]));
        own.previous[k].copy(position);
      }
    }
    if (controllerMode || foldSide !== side) foldWeight = foldTarget;
    else {
      const eased =
        (foldTarget - foldWeight) *
        (1 - Math.exp(-Math.max(0, deltaSeconds) / THUMB_FOLD_SMOOTHING));
      const limit = Math.max(
        own ? (THUMB_FOLD_SKIN_RATIO * skinStep) / Math.max(own.reach, 1e-6) : 1,
        THUMB_FOLD_MIN_RATE * Math.max(0, deltaSeconds),
      );
      foldWeight += THREE.MathUtils.clamp(eased, -limit, limit);
    }
    foldSide = controllerMode ? undefined : side;
    if (mesh.morphTargetInfluences)
      for (const morph of foldMorphs)
        mesh.morphTargetInfluences[morph.index] = morph.side === side ? foldWeight : 0;
    if (indexEnd && thumbEnd) {
      indexEnd.localToWorld(visibleIndex.set(0, indexEnd.userData.restLength, 0));
      thumbEnd.localToWorld(visibleThumb.set(0, thumbEnd.userData.restLength, 0));
      pinchPoint.addVectors(visibleIndex, visibleThumb).multiplyScalar(0.5);
      const trackedDigits =
        JOINTS[0].every((name) => tracked.joints?.[name]?.visible) &&
        JOINTS[1].every((name) => tracked.joints?.[name]?.visible);
      fallback.root.userData.keyborbPoint =
        controllerMode || trackedDigits ? pinchPoint : undefined;
    }
    for (let index = 0; index < probeVertices.length; index++) {
      mesh.getVertexPosition(probeVertices[index], probes[index].point);
      probes[index].point.applyMatrix4(mesh.matrixWorld);
    }
  };
  return {
    root: fallback.root,
    get contactProbes() {
      return mesh && fallback.root.visible ? probes : fallback.contactProbes;
    },
    assetReady,
    update: fallback.update,
    updateController(pose, camera, side, gamepad, deltaSeconds) {
      const pressure = (index: number): number =>
        THREE.MathUtils.clamp(
          gamepad?.buttons[index]?.value ?? (gamepad?.buttons[index]?.pressed ? 1 : 0),
          0,
          1,
        );
      const alpha = 1 - Math.exp(-20 * Math.max(0, deltaSeconds));
      const amounts = [Math.max(pressure(4), pressure(5)), pressure(0), pressure(1), pressure(1)];
      for (let digit = 0; digit < 4; digit++)
        curls[digit] = THREE.MathUtils.lerp(curls[digit], amounts[digit], alpha);
      controllerMode = true;
      try {
        originalController(pose, camera, side, gamepad, deltaSeconds);
      } finally {
        controllerMode = false;
      }
    },
    hide() {
      fallback.hide();
      curls.fill(0);
      foldSide = undefined;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (authored) disposeAsset(authored);
      wristJoint.geometry.dispose();
      fallback.dispose();
    },
  };
}
