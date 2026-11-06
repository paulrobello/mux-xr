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
const questPoses = JSON.parse(readFileSync('tests/fixtures/quest-hand-poses.json', 'utf8')) as {
  hands: Array<{ side: 'left' | 'right'; joints: Record<string, { matrix: number[] }> }>;
};

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
  roll = 0,
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
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.3 + roll));
  for (const [name, point] of Object.entries(points)) {
    const joint = new THREE.Group();
    joint.position.fromArray(point);
    joint.position.x *= side === 'left' ? 1 : -1;
    joint.position.applyQuaternion(rotation).add(new THREE.Vector3(0.2, 1.2, -0.6));
    joint.quaternion.copy(rotation);
    joint.updateMatrix();
    joint.matrixAutoUpdate = false;
    joint.matrixWorldNeedsUpdate = true;
    source.joints[name] = joint;
    source.add(joint);
  }
  return source;
}

const neutralCapture = JSON.parse(
  readFileSync('tests/fixtures/quest-neutral-hands.json', 'utf8'),
) as {
  hands: Array<{ side: 'left' | 'right'; joints: Record<string, { matrix: number[] }> }>;
};
const gestures = JSON.parse(readFileSync('tests/fixtures/quest-gesture-poses.json', 'utf8')) as {
  sets: Record<
    string,
    { hands: Array<{ side: 'left' | 'right'; joints: Record<string, { matrix: number[] }> }> }
  >;
};
function neutralSource(
  side: 'left' | 'right',
): THREE.Group & { joints: Record<string, THREE.Group> } {
  const captured = neutralCapture.hands.find((hand) => hand.side === side);
  if (!captured) throw new Error('Missing neutral hand');
  return poseSource(captured.joints);
}
function poseSource(
  joints: Record<string, { matrix: number[] }>,
): THREE.Group & { joints: Record<string, THREE.Group> } {
  const source = new THREE.Group() as THREE.Group & { joints: Record<string, THREE.Group> };
  source.joints = {};
  for (const [name, entry] of Object.entries(joints)) {
    const joint = new THREE.Group();
    joint.matrix.fromArray(entry.matrix);
    joint.matrix.decompose(joint.position, joint.quaternion, joint.scale);
    joint.matrixAutoUpdate = false;
    joint.matrixWorldNeedsUpdate = true;
    source.joints[name] = joint;
    source.add(joint);
  }
  return source;
}

describe('authored rigged hand', () => {
  it.each(gestures.sets['captured-pinch'].hands)(
    'brings the captured $side pinch pads together without changing tracking',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = poseSource(pose.joints);
      const before = JSON.stringify(
        Object.values(source.joints).map((joint) => joint.matrix.elements),
      );
      const mesh = authoredMeshes(hand.root)[0];
      const index = mesh.skeleton.getBoneByName('index_03') as THREE.Bone;
      const thumb = mesh.skeleton.getBoneByName('thumb_03') as THREE.Bone;
      const indexTip = new THREE.Vector3();
      const thumbTip = new THREE.Vector3();
      for (const roll of [0, Math.PI / 2, Math.PI]) {
        source.rotation.set(0.3, -0.6, roll);
        hand.update(source, new THREE.PerspectiveCamera(), pose.side, 1 / 60);
        index.localToWorld(indexTip.set(0, index.userData.restLength, 0));
        thumb.localToWorld(thumbTip.set(0, thumb.userData.restLength, 0));
        expect(thumbTip.distanceTo(indexTip)).toBeGreaterThan(0.009);
        expect(thumbTip.distanceTo(indexTip)).toBeLessThan(0.024);
        expect(
          (hand.root.userData.thumbTip as THREE.Vector3).distanceTo(
            source.joints['thumb-tip'].getWorldPosition(new THREE.Vector3()),
          ),
        ).toBeLessThan(1e-6);
      }
      expect(
        JSON.stringify(Object.values(source.joints).map((joint) => joint.matrix.elements)),
      ).toBe(before);
      hand.dispose();
    },
  );
  it.each([
    ...gestures.sets['captured-close'].hands.map((pose) => ({ ...pose, kind: 'partial' })),
    ...gestures.sets['captured-fist'].hands.map((pose) => ({ ...pose, kind: 'full fist' })),
  ])('reduces the captured $side $kind finger gaps while keeping bone dimensions', async (pose) => {
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    const mesh = authoredMeshes(hand.root)[0];
    const positions = mesh.geometry.getAttribute('position');
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    const surfaces: number[][] = ['index', 'middle', 'outer'].map((name) => {
      const vertices: number[] = [];
      const root = mesh.skeleton.getBoneByName(`${name}_01`) as THREE.Bone;
      const cutoff = root.getWorldPosition(new THREE.Vector3()).y + 0.012;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        if (positions.getY(vertex) < cutoff) continue;
        let influence = 0;
        for (let part = 0; part < 4; part++)
          if (mesh.skeleton.bones[indices.getComponent(vertex, part)].name.startsWith(`${name}_`))
            influence += weights.getComponent(vertex, part);
        if (influence > 0.8) vertices.push(vertex);
      }
      return vertices;
    });
    hand.update(poseSource(pose.joints), new THREE.PerspectiveCamera(), pose.side, 1 / 60);
    const points = surfaces.map((vertices) =>
      vertices.map((vertex) => mesh.getVertexPosition(vertex, new THREE.Vector3())),
    );
    for (const side of [0, 2]) {
      let gap = Infinity;
      for (const point of points[side])
        for (const other of points[1]) gap = Math.min(gap, point.distanceTo(other));
      const rightPartial = pose.side === 'right' && pose.kind === 'partial';
      expect(gap).toBeLessThan(rightPartial ? 0.018 : 0.006);
      if (rightPartial) expect(gap).toBeGreaterThan(0.01);
    }
    for (const bone of mesh.skeleton.bones)
      for (const axis of [0, 1, 2])
        expect(
          new THREE.Vector3().setFromMatrixColumn(bone.matrixWorld, axis).length(),
        ).toBeCloseTo(1, 5);
    hand.dispose();
  });
  it.each(['left', 'right'] as const)(
    'matches the authored Open mesh for the calibrated %s hand',
    async (side) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = neutralSource(side);
      hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      const positions = mesh.geometry.getAttribute('position');
      let largestChange = 0;
      const before = new THREE.Vector3();
      const after = new THREE.Vector3();
      for (let index = 0; index < positions.count; index++) {
        before.fromBufferAttribute(positions, index);
        mesh.getVertexPosition(index, after);
        largestChange = Math.max(largestChange, before.distanceTo(after));
      }
      expect(largestChange).toBeLessThan(1e-5);
      const index = mesh.skeleton.getBoneByName('index_03') as THREE.Bone;
      const thumb = mesh.skeleton.getBoneByName('thumb_03') as THREE.Bone;
      const visibleMidpoint = index
        .localToWorld(new THREE.Vector3(0, index.userData.restLength, 0))
        .add(thumb.localToWorld(new THREE.Vector3(0, thumb.userData.restLength, 0)))
        .multiplyScalar(0.5);
      expect(
        (hand.root.userData.keyborbPoint as THREE.Vector3).distanceTo(visibleMidpoint),
      ).toBeLessThan(1e-6);
      hand.dispose();
    },
  );

  it.each(['left', 'right'] as const)(
    'applies %s unopposed thumb base motion once without adding child bends',
    async (side) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = neutralSource(side);
      const mesh = authoredMeshes(hand.root)[0];
      const thumb = [1, 2, 3].map(
        (part) => mesh.skeleton.getBoneByName(`thumb_0${part}`) as THREE.Bone,
      );
      const rest = thumb.map((bone) => bone.quaternion.clone());
      const pivot = source.joints['thumb-metacarpal'].position.clone();
      const thumbDirection = source.joints['thumb-tip'].position.clone().sub(pivot);
      const awayFromIndex = source.joints['thumb-tip'].position
        .clone()
        .sub(source.joints['index-finger-tip'].position);
      const turn = new THREE.Quaternion().setFromAxisAngle(
        thumbDirection.cross(awayFromIndex).normalize(),
        0.7,
      );
      for (const [name, joint] of Object.entries(source.joints)) {
        if (!name.startsWith('thumb-')) continue;
        joint.position.sub(pivot).applyQuaternion(turn).add(pivot);
        joint.quaternion.premultiply(turn);
        joint.updateMatrix();
        joint.matrixWorldNeedsUpdate = true;
      }
      hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
      expect(thumb[0].quaternion.angleTo(rest[0])).toBeCloseTo(0.7, 5);
      expect(thumb[1].quaternion.angleTo(rest[1])).toBeLessThan(1e-5);
      expect(thumb[2].quaternion.angleTo(rest[2])).toBeLessThan(1e-5);
      hand.dispose();
    },
  );
  for (const side of ['left', 'right'] as const) {
    it.each(['proximal', 'distal'] as const)(
      `bends the ${side} thumb at the authored %s pivot`,
      async (part) => {
        const hand = createRiggedHand({ loader: parsedLoader() });
        await hand.assetReady;
        const source = neutralSource(side);
        const mesh = authoredMeshes(hand.root)[0];
        const thumb = [1, 2, 3].map(
          (index) => mesh.skeleton.getBoneByName(`thumb_0${index}`) as THREE.Bone,
        );
        const rest = thumb.map((bone) => bone.quaternion.clone());
        const names =
          part === 'proximal'
            ? ['thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
            : ['thumb-phalanx-distal', 'thumb-tip'];
        const pivot = source.joints[names[0]].position.clone();
        const thumbDirection = source.joints['thumb-tip'].position.clone().sub(pivot);
        const awayFromIndex = source.joints['thumb-tip'].position
          .clone()
          .sub(source.joints['index-finger-tip'].position);
        const turn = new THREE.Quaternion().setFromAxisAngle(
          thumbDirection.cross(awayFromIndex).normalize(),
          0.7,
        );
        for (const name of names) {
          const joint = source.joints[name];
          joint.position.sub(pivot).applyQuaternion(turn).add(pivot);
          joint.quaternion.premultiply(turn);
          joint.updateMatrix();
          joint.matrixWorldNeedsUpdate = true;
        }
        hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
        expect(thumb[0].quaternion.angleTo(rest[0])).toBeCloseTo(part === 'proximal' ? 0.7 : 0, 5);
        expect(thumb[1].quaternion.angleTo(rest[1])).toBeLessThan(1e-5);
        expect(thumb[2].quaternion.angleTo(rest[2])).toBeCloseTo(part === 'distal' ? 0.7 : 0, 5);
        hand.dispose();
      },
    );
  }
  it.each(questPoses.hands)(
    'preserves bone dimensions with recorded Quest $side joints',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = new THREE.Group() as THREE.Group & { joints: Record<string, THREE.Group> };
      source.joints = {};
      for (const [name, captured] of Object.entries(pose.joints)) {
        const joint = new THREE.Group();
        joint.matrix.fromArray(captured.matrix);
        joint.matrix.decompose(joint.position, joint.quaternion, joint.scale);
        joint.matrixAutoUpdate = false;
        joint.matrixWorldNeedsUpdate = true;
        source.joints[name] = joint;
        source.add(joint);
      }
      hand.update(source, new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      for (const bone of authoredMeshes(hand.root)[0].skeleton.bones)
        for (const axis of [0, 1, 2])
          expect(
            new THREE.Vector3().setFromMatrixColumn(bone.matrixWorld, axis).length(),
          ).toBeCloseTo(1, 5);
      hand.dispose();
    },
  );
  it.each(['left', 'right'] as const)(
    'preserves %s authored bone dimensions through wrist rolls and controller changes',
    async (side) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const mesh = authoredMeshes(hand.root)[0];
      const originalPositions = mesh.skeleton.bones.map((bone) => bone.position.clone());
      for (const roll of [0, Math.PI / 2, Math.PI]) {
        const source = trackedSource(side, roll);
        hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
        for (const [index, bone] of mesh.skeleton.bones.entries()) {
          const scales = [0, 1, 2].map((axis) =>
            new THREE.Vector3().setFromMatrixColumn(bone.matrixWorld, axis).length(),
          );
          expect(Math.max(...scales) - Math.min(...scales)).toBeLessThan(1e-5);
          const localPosition = new THREE.Vector3().setFromMatrixPosition(bone.matrix);
          const rootTravel = localPosition.distanceTo(originalPositions[index]);
          if (bone.name === 'thumb_01') expect(rootTravel).toBeLessThanOrEqual(0.050001);
          else if (bone.name === 'index_01') expect(rootTravel).toBeLessThanOrEqual(0.014501);
          else if (bone.name === 'outer_01') expect(rootTravel).toBeLessThanOrEqual(0.010001);
          else expect(rootTravel).toBeLessThan(1e-6);
        }
        expect(hand.root.getObjectByName('authored-hand-root')?.scale.toArray()).toEqual([1, 1, 1]);
        for (const digit of ['thumb', 'index'] as const) {
          const joint = source.joints[digit === 'thumb' ? 'thumb-tip' : 'index-finger-tip'];
          expect(
            (hand.root.userData[`${digit}Tip`] as THREE.Vector3).distanceTo(
              joint.getWorldPosition(new THREE.Vector3()),
            ),
          ).toBeLessThan(1e-6);
        }
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
