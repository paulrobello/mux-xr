import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { createRiggedHand, RIGGED_HAND_ASSET_URL } from '../src/xr/rigged-hand';

const NAMES = [
  'wrist',
  'thumb_01',
  'thumb_02',
  'thumb_03',
  'index_01',
  'index_02',
  'index_03',
  'middle_01',
  'middle_02',
  'middle_03',
  'outer_01',
  'outer_02',
  'outer_03',
];
const assetBytes = new Uint8Array(
  readFileSync('assets-source/hand/authored-hand.staged.glb'),
).slice().buffer;

async function parsedAsset(): Promise<GLTF> {
  return new GLTFLoader().parseAsync(assetBytes, '');
}
function parsedLoader(): GLTFLoader {
  return { loadAsync: parsedAsset } as unknown as GLTFLoader;
}
function authoredMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) meshes.push(object);
  });
  return meshes;
}

function trackedSource(
  side: 'left' | 'right',
): THREE.Group & { joints: Record<string, THREE.Group> } {
  const source = new THREE.Group() as THREE.Group & { joints: Record<string, THREE.Group> };
  source.joints = {};
  const points: Record<string, number[]> = {
    wrist: [0, 0, 0],
    'thumb-metacarpal': [0.035, 0.018, 0],
    'thumb-phalanx-proximal': [0.055, 0.03, 0],
    'thumb-phalanx-distal': [0.075, 0.045, 0],
    'thumb-tip': [0.09, 0.06, 0],
  };
  for (const [finger, x, length] of [
    ['index-finger', 0.03, 0.16],
    ['middle-finger', 0, 0.18],
    ['ring-finger', -0.028, 0.16],
    ['pinky-finger', -0.052, 0.13],
  ] as const) {
    for (const [part, fraction] of [
      ['phalanx-proximal', 0.47],
      ['phalanx-intermediate', 0.67],
      ['phalanx-distal', 0.85],
      ['tip', 1],
    ] as const)
      points[`${finger}-${part}`] = [x, length * fraction, 0];
  }
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.3));
  for (const [name, point] of Object.entries(points)) {
    const joint = new THREE.Group();
    joint.position.fromArray(point);
    joint.position.x *= side === 'left' ? 1 : -1;
    joint.position.applyQuaternion(rotation).add(new THREE.Vector3(0.2, 1.2, -0.6));
    joint.quaternion.copy(rotation);
    source.joints[name] = joint;
    source.add(joint);
  }
  return source;
}

describe('authored rigged hand', () => {
  it.each(['left', 'right'] as const)(
    'aligns %s tracked fingertips and restores controller poses',
    async (side) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const mesh = authoredMeshes(hand.root)[0];
      const originalPositions = mesh.skeleton.bones.map((bone) => bone.position.clone());
      const source = trackedSource(side);
      hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
      const authored = hand.root.getObjectByName('authored-hand-root') as THREE.Group;
      expect(authored.scale.x).toBeCloseTo(authored.scale.y);
      expect(authored.scale.z).toBeCloseTo(authored.scale.y);
      for (const [digit, jointName] of [
        ['thumb', 'thumb-tip'],
        ['index', 'index-finger-tip'],
        ['middle', 'middle-finger-tip'],
        ['outer', 'ring-finger-tip'],
      ] as const) {
        const bone = mesh.skeleton.getBoneByName(`${digit}_03`) as THREE.Bone;
        const tip = bone.localToWorld(new THREE.Vector3(0, bone.userData.restLength, 0));
        for (const axis of [0, 2])
          expect(
            new THREE.Vector3().setFromMatrixColumn(bone.matrixWorld, axis).length(),
          ).toBeCloseTo(authored.scale.y);
        const joint = source.joints[jointName];
        expect(tip.distanceTo(joint.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-5);
      }
      hand.updateController(new THREE.Group(), new THREE.PerspectiveCamera(), side, undefined, 1);
      for (const [index, bone] of mesh.skeleton.bones.entries()) {
        expect(bone.position.distanceTo(originalPositions[index])).toBeLessThan(1e-6);
        expect(bone.matrixAutoUpdate).toBe(true);
      }
      hand.dispose();
    },
  );
  it('keeps rendered contact probes attached through controller rotation and translation', async () => {
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    const pose = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    hand.updateController(pose, camera, 'left', undefined, 1 / 60);
    const wristJoint = hand.root.getObjectByName('authored-hand-wrist') as THREE.Mesh;
    const wrist = hand.root.userData.wristPosition as THREE.Vector3;
    expect(wristJoint.position.distanceTo(wrist)).toBeCloseTo(0.003);
    expect((wristJoint.geometry as THREE.SphereGeometry).parameters.radius).toBeGreaterThan(
      wristJoint.position.distanceTo(wrist) + 0.014,
    );
    const original = hand.contactProbes.map((probe) => probe.point.clone());
    expect(original.length).toBeGreaterThan(20);
    pose.position.set(0.3, 1.2, -0.8);
    pose.quaternion.setFromEuler(new THREE.Euler(0.2, 0.7, -0.4));
    pose.updateMatrixWorld(true);
    hand.updateController(pose, camera, 'left', undefined, 1 / 60);
    for (const [index, probe] of hand.contactProbes.entries()) {
      const expected = original[index].applyQuaternion(pose.quaternion).add(pose.position);
      expect(probe.point.distanceTo(expected)).toBeLessThan(1e-6);
    }
    hand.dispose();
  });
  it('exports all four preview actions with finite deformed skin', async () => {
    const asset = await parsedAsset();
    expect(asset.animations.map((clip) => clip.name).sort()).toEqual([
      'Fist',
      'Open',
      'Pointing',
      'Thumbs Up',
    ]);
    const mixer = new THREE.AnimationMixer(asset.scene);
    const mesh = authoredMeshes(asset.scene)[0];
    const vertex = new THREE.Vector3();
    for (const clip of asset.animations) {
      expect(clip.duration).toBeCloseTo(1.5);
      mixer.stopAllAction();
      mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
      mixer.setTime(1.4);
      asset.scene.updateMatrixWorld(true);
      mesh.skeleton.update();
      for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
        mesh.getVertexPosition(index, vertex);
        expect(vertex.toArray().every(Number.isFinite)).toBe(true);
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(asset.scene);
  });
  it('parses the staged GLB, validates its skin, and isolates clones', async () => {
    expect(new URL(RIGGED_HAND_ASSET_URL, 'https://localhost').searchParams.get('v')).toBe(
      createHash('sha256').update(new Uint8Array(assetBytes)).digest('hex').slice(0, 12),
    );
    const first = createRiggedHand({ loader: parsedLoader() });
    const second = createRiggedHand({ loader: parsedLoader() });
    expect(await first.assetReady).toBe(true);
    expect(await second.assetReady).toBe(true);
    const firstRoot = first.root.getObjectByName('authored-hand-root');
    const secondRoot = second.root.getObjectByName('authored-hand-root');
    const firstBones = firstRoot?.getObjectsByProperty('type', 'Bone') ?? [];
    const secondBones = secondRoot?.getObjectsByProperty('type', 'Bone') ?? [];
    expect(firstBones).toHaveLength(NAMES.length);
    expect(secondBones).toHaveLength(NAMES.length);
    expect(firstBones.map((bone) => bone.name)).toEqual(expect.arrayContaining(NAMES));
    expect(firstBones[0]).not.toBe(secondBones[0]);
    const firstMeshes = authoredMeshes(first.root);
    expect(firstMeshes).toHaveLength(1);
    expect(firstMeshes[0].name).toBe('authored-hand-skin');
    const weights = firstMeshes[0].geometry.getAttribute('skinWeight');
    expect(weights.itemSize).toBe(4);
    for (let vertex = 0; vertex < weights.count; vertex++)
      expect(
        weights.getX(vertex) + weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex),
      ).toBeCloseTo(1, 4);
    expect(firstMeshes[0].material).not.toBe(authoredMeshes(second.root)[0].material);
    expect(first.root.userData.handAsset).toBe('loaded');
    first.dispose();
    second.dispose();
  });

  it('keeps the procedural skin visible for an invalid asset', async () => {
    const loader = {
      loadAsync: async () => ({ scene: new THREE.Group() }),
    } as unknown as GLTFLoader;
    const hand = createRiggedHand({ loader });
    expect(await hand.assetReady).toBe(false);
    expect(hand.root.userData.handAsset).toBe('fallback');
    expect(hand.root.getObjectByName('cartoon-hand-skin')?.visible).toBe(true);
    hand.dispose();
  });

  it('does not attach a late asset after disposal', async () => {
    let resolveLoad: ((asset: { scene: THREE.Group }) => void) | undefined;
    const loader = {
      loadAsync: () =>
        new Promise<{ scene: THREE.Group }>((resolve) => {
          resolveLoad = resolve;
        }),
    } as unknown as GLTFLoader;
    const hand = createRiggedHand({ loader });
    hand.dispose();
    resolveLoad?.(await parsedAsset());
    expect(await hand.assetReady).toBe(false);
    expect(hand.root.getObjectByName('authored-hand-root')).toBeUndefined();
  });
});
