import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type CartoonHand, createCartoonHand } from './cartoon-hand';
import type { HandContactProbe } from './hand-contact';

export const RIGGED_HAND_ASSET_URL = '/assets/hand.glb?v=95714f02a92e';
const DIGITS = ['thumb', 'index', 'middle', 'outer'] as const;
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
  rest: THREE.Quaternion;
  restPosition: THREE.Vector3;
  restScale: THREE.Vector3;
  worldRest: THREE.Quaternion;
  length: number;
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
  let disposed = false;
  let controllerMode = false;
  let wristOffset = 0;
  let palmLength = 1;
  let palmWidth = 1;
  const curls = [0, 0, 0, 0];
  const drivers: JointDriver[] = [];
  const probes: HandContactProbe[] = [];
  const probeVertices: number[] = [];
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const across = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  const referenceDirection = new THREE.Vector3();
  const segmentScale = new THREE.Vector3();
  const inverseParent = new THREE.Matrix4();
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
      const middleBase = candidate.skeleton.getBoneByName('middle_01') as THREE.Bone;
      const indexBase = candidate.skeleton.getBoneByName('index_01') as THREE.Bone;
      const outerBase = candidate.skeleton.getBoneByName('outer_01') as THREE.Bone;
      palmLength = middleBase.getWorldPosition(position).y - wristOffset;
      palmWidth = indexBase.getWorldPosition(position).x - outerBase.getWorldPosition(target).x;
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
          drivers.push({
            bone,
            rest,
            restPosition: bone.position.clone(),
            restScale: bone.scale.clone(),
            worldRest: worldRotation,
            length: bone.userData.restLength as number,
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
    authored.scale.set(1, 1, 1);
    if (!controllerMode) {
      const middle = tracked.joints?.['middle-finger-phalanx-proximal'];
      const index = tracked.joints?.['index-finger-phalanx-proximal'];
      const outer = tracked.joints?.['ring-finger-phalanx-proximal'];
      if (middle?.visible) {
        middle.getWorldPosition(position).sub(fallback.root.userData.wristPosition);
        authored.scale.y = THREE.MathUtils.clamp(position.dot(forward) / palmLength, 0.5, 1.25);
      }
      if (index?.visible && outer?.visible) {
        index.getWorldPosition(position);
        outer.getWorldPosition(target);
        authored.scale.x = THREE.MathUtils.clamp(
          position.sub(target).dot(across) / palmWidth,
          0.5,
          1.25,
        );
      }
      authored.scale.z = 0.85;
    }
    authored.position
      .copy(fallback.root.userData.wristPosition as THREE.Vector3)
      .addScaledVector(forward, -wristOffset * authored.scale.y);
    authored.quaternion.setFromRotationMatrix(basis);
    authored.updateMatrixWorld(true);
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
        const start = tracked.joints?.[JOINTS[digit][part]];
        const end = tracked.joints?.[JOINTS[digit][part + 1]];
        if (start?.visible && end?.visible && bone.parent) {
          start.getWorldPosition(position);
          end.getWorldPosition(target);
          direction.copy(target).sub(position);
          const length = direction.length();
          if (length > 1e-4) {
            direction.divideScalar(length);
            parentRotation.copy(authored.quaternion).multiply(driver.worldRest);
            referenceDirection.set(0, 1, 0).applyQuaternion(parentRotation);
            rotation.setFromUnitVectors(referenceDirection, direction).multiply(parentRotation);
            segmentScale.set(1, length / driver.length, 1);
            inverseParent.copy(bone.parent.matrixWorld).invert();
            // World-space fitting avoids inheriting a parent's nonuniform stretch.
            bone.matrix.compose(position, rotation, segmentScale).premultiply(inverseParent);
            bone.matrixAutoUpdate = false;
            bone.matrixWorldNeedsUpdate = true;
          }
        }
      }
      bone.updateWorldMatrix(false, true);
    }
    mesh.updateWorldMatrix(true, false);
    mesh.skeleton.update();
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
