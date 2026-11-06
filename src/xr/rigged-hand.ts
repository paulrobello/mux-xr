import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type CartoonHand, createCartoonHand } from './cartoon-hand';
import type { HandContactProbe } from './hand-contact';
import neutralReference from './hand-neutral-reference.json';
import { createHandPoseConstraints } from './hand-pose-constraints';

export const RIGGED_HAND_ASSET_URL = '/assets/hand.glb?v=6f2274e0a394';
const DIGITS = ['thumb', 'index', 'middle', 'outer'] as const;
// The cartoon's three wide fingers stand in for four real ones, so tracked spread reads as a fan.
const SPLAY_KEEP = 0.3;
const SPLAY_INWARD = 0.05;
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
        candidate.skeleton.bones.length !== names.length ||
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
      mesh.geometry.computeBoundingBox();
      wristOffset = mesh.geometry.boundingBox?.min.y ?? 0;
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
    if (!authored || !mesh || !fallback.root.visible) return;
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
    const splay = (digit: number): number | undefined => {
      const base = tracked.joints?.[JOINTS[digit][0]];
      const tip = tracked.joints?.[JOINTS[digit][3]];
      if (!base?.visible || !tip?.visible) return undefined;
      base.getWorldPosition(knuckle);
      tip.getWorldPosition(splayVector).sub(knuckle).applyQuaternion(inverseRotation);
      return Math.atan2(splayVector.x, splayVector.y);
    };
    const middleSplay = controllerMode ? undefined : splay(2);
    palmNormal.set(0, 0, 1).applyQuaternion(palmRotation);
    for (const digit of [1, 3]) {
      const own = middleSplay === undefined ? undefined : splay(digit);
      const planar = Math.hypot(splayVector.x, splayVector.y);
      const weight = THREE.MathUtils.smoothstep(planar, 0.045, 0.065);
      const angle =
        own === undefined || middleSplay === undefined
          ? 0
          : weight *
            ((1 - SPLAY_KEEP) * (own - (middleSplay as number)) +
              (digit === 1 ? 1 : -1) * SPLAY_INWARD);
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
    mesh.updateWorldMatrix(true, false);
    mesh.skeleton.update();
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
