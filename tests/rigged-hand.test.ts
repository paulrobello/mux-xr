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

describe('authored rigged hand', () => {
  it('keeps rendered contact probes attached through controller rotation and translation', async () => {
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    const pose = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    hand.updateController(pose, camera, 'left', undefined, 1 / 60);
    const wristJoint = hand.root.getObjectByName('authored-hand-wrist') as THREE.Mesh;
    const wrist = hand.root.userData.wristPosition as THREE.Vector3;
    expect(wristJoint.position.distanceTo(wrist)).toBeCloseTo(0.006);
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
