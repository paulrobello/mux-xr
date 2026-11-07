import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  createRiggedHand,
  RIGGED_HAND_ASSET_URL,
  THUMB_FOLD_MORPHS,
  THUMB_FOLD_SMOOTHING,
  THUMB_HELPERS,
} from '../src/xr/rigged-hand';

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
// Seen from the back, the thumb-side edge of a settled pose (max x per 2 mm of y in the wrist
// frame, every triangle sampled) from 40 mm below to `above` metres above the thumb_01 head. A knob
// with a dip beside it shows as a gap under the edge's concave envelope; returns the largest gap.
async function backOutlineDip(
  pose: { side: 'left' | 'right'; joints: Record<string, { matrix: number[] }> },
  above: number,
): Promise<number> {
  const bin = 0.002;
  const hand = createRiggedHand({ loader: parsedLoader() });
  await hand.assetReady;
  hand.update(poseSource(pose.joints), new THREE.PerspectiveCamera(), pose.side, 1 / 60);
  const mesh = authoredMeshes(hand.root)[0];
  mesh.skeleton.update();
  const { bones, boneInverses } = mesh.skeleton;
  const wrist = bones.findIndex((bone) => bone.name === 'wrist');
  const thumb = bones.findIndex((bone) => bone.name === 'thumb_01');
  const head = new THREE.Vector3().setFromMatrixPosition(boneInverses[thumb].clone().invert());
  const toWrist = new THREE.Matrix4()
    .multiplyMatrices(bones[wrist].matrixWorld, boneInverses[wrist])
    .premultiply(mesh.matrixWorld.clone().invert())
    .invert();
  const index = mesh.geometry.index as THREE.BufferAttribute;
  const points = Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, k) =>
    mesh.getVertexPosition(k, new THREE.Vector3()).applyMatrix4(toWrist),
  );
  const edge = new Map<number, number>();
  const steps = 4;
  for (let face = 0; face < index.count; face += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => points[index.getX(face + k)]);
    for (let u = 0; u <= steps; u++)
      for (let v = 0; v <= steps - u; v++) {
        const point = new THREE.Vector3()
          .addScaledVector(a, u / steps)
          .addScaledVector(b, v / steps)
          .addScaledVector(c, (steps - u - v) / steps);
        if (point.y < head.y - 0.04 || point.y > head.y + above) continue;
        const slot = Math.floor(point.y / bin);
        edge.set(slot, Math.max(edge.get(slot) ?? -Infinity, point.x));
      }
  }
  const slots = [...edge.keys()].sort((a, b) => a - b);
  let dip = 0;
  for (let m = 1; m < slots.length - 1; m++)
    for (let l = 0; l < m; l++)
      for (let r = m + 1; r < slots.length; r++) {
        const t = (slots[m] - slots[l]) / (slots[r] - slots[l]);
        const envelope =
          (edge.get(slots[l]) as number) * (1 - t) + (edge.get(slots[r]) as number) * t;
        dip = Math.max(dip, envelope - (edge.get(slots[m]) as number));
      }
  hand.dispose();
  return dip;
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
    {
      hands: Array<{
        side: 'left' | 'right';
        frame?: number;
        stampDeltaMs?: number;
        joints: Record<string, { matrix: number[] }>;
      }>;
    }
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
  it.each(gestures.sets['captured-fist'].hands)(
    'rests the captured $side fist thumb where the tracked thumb touches the index',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = poseSource(pose.joints);
      source.rotation.set(0.3, -0.6, 0.4);
      source.updateMatrixWorld(true);
      hand.update(source, new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      const root = hand.root.getObjectByName('authored-hand-root') as THREE.Object3D;
      const palm = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const thumb = mesh.skeleton.getBoneByName('thumb_03') as THREE.Bone;
      // The tracked tip joint sits at the skin, so compare the rendered pad surface.
      const thumbIndex = mesh.skeleton.bones.indexOf(thumb);
      const skinIndex = mesh.geometry.getAttribute('skinIndex');
      const skinWeight = mesh.geometry.getAttribute('skinWeight');
      const head = thumb.getWorldPosition(new THREE.Vector3());
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(
        thumb.getWorldQuaternion(new THREE.Quaternion()),
      );
      let reach = 0;
      for (let i = 0; i < skinIndex.count; i++) {
        let weight = 0;
        for (let k = 0; k < 4; k++)
          if (skinIndex.getComponent(i, k) === thumbIndex) weight += skinWeight.getComponent(i, k);
        if (weight < 0.5) continue;
        const vertex = mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()));
        reach = Math.max(reach, vertex.sub(head).dot(axis));
      }
      const rendered = head
        .addScaledVector(axis, reach)
        .sub(
          (mesh.skeleton.getBoneByName('index_02') as THREE.Bone).getWorldPosition(
            new THREE.Vector3(),
          ),
        )
        .applyQuaternion(palm);
      const tracked = source.joints['thumb-tip']
        .getWorldPosition(new THREE.Vector3())
        .sub(
          source.joints['index-finger-phalanx-intermediate'].getWorldPosition(new THREE.Vector3()),
        )
        .applyQuaternion(palm);
      // The tracked thumb rests beside the index PIP knuckle; the rendered thumb keeps that
      // offset instead of folding across the fingers. The cartoon thumb is longer than the
      // tracked one and lies straight, so its pad may land further along the thumb's own
      // direction but not off to the side of it.
      const along = (mesh.skeleton.getBoneByName('thumb_03') as THREE.Bone)
        .getWorldPosition(new THREE.Vector3())
        .sub(
          (mesh.skeleton.getBoneByName('thumb_01') as THREE.Bone).getWorldPosition(
            new THREE.Vector3(),
          ),
        )
        .applyQuaternion(palm)
        .normalize();
      const error = rendered.sub(tracked);
      const overshoot = error.dot(along);
      expect(tracked.length()).toBeLessThan(0.03);
      expect(overshoot).toBeGreaterThan(-0.0035);
      expect(overshoot).toBeLessThan(0.0075);
      expect(error.addScaledVector(along, -overshoot).length()).toBeLessThan(0.0035);
      hand.dispose();
    },
  );
  it.each(gestures.sets['captured-fist'].hands)(
    'bends the captured $side fist thumb tip the way the tracked thumb bends',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = poseSource(pose.joints);
      hand.update(source, new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      const thumb = mesh.skeleton.getBoneByName('thumb_03') as THREE.Bone;
      const rendered = new THREE.Vector3(0, 1, 0).applyQuaternion(
        thumb.getWorldQuaternion(new THREE.Quaternion()),
      );
      const at = (name: string) => source.joints[name].getWorldPosition(new THREE.Vector3());
      const tracked = at('thumb-tip').sub(at('thumb-phalanx-distal')).normalize();
      const root = hand.root.getObjectByName('authored-hand-root') as THREE.Object3D;
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        root.getWorldQuaternion(new THREE.Quaternion()),
      );
      // The tracked tip curls toward the palm; the rendered tip must not hyperextend away.
      expect(Math.abs(rendered.dot(normal) - tracked.dot(normal))).toBeLessThan(0.1);
      expect(THREE.MathUtils.radToDeg(rendered.angleTo(tracked))).toBeLessThan(20);
      hand.dispose();
    },
  );
  it.each(gestures.sets['captured-thumb-rest'].hands)(
    'lays the captured $side resting thumb flat across the fist instead of arching it',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = poseSource(pose.joints);
      hand.update(source, new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      const skinIndex = mesh.geometry.getAttribute('skinIndex');
      const skinWeight = mesh.geometry.getAttribute('skinWeight');
      const owned = (prefixes: string[]): THREE.Vector3[] => {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i < skinIndex.count; i++) {
          let weight = 0;
          for (let k = 0; k < 4; k++) {
            const name = mesh.skeleton.bones[skinIndex.getComponent(i, k)].name;
            if (prefixes.some((prefix) => name.startsWith(prefix)))
              weight += skinWeight.getComponent(i, k);
          }
          if (weight > 0.8) points.push(mesh.getVertexPosition(i, new THREE.Vector3()));
        }
        return points;
      };
      const fingers = owned(['index_02', 'index_03', 'middle_02', 'middle_03']);
      const gap = (points: THREE.Vector3[]): number =>
        Math.min(...points.map((p) => Math.min(...fingers.map((q) => p.distanceTo(q)))));
      const at = (name: string) => source.joints[name].getWorldPosition(new THREE.Vector3());
      const segments = ['index', 'middle'].flatMap((digit) =>
        ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']
          .map((joint) => at(`${digit}-finger-${joint}`))
          .slice(0, -1)
          .map((start, i, all) => {
            const ends = [...all.slice(1), at(`${digit}-finger-tip`)];
            return new THREE.Line3(start, ends[i]);
          }),
      );
      const clearance = (point: THREE.Vector3): number =>
        Math.min(
          ...segments.map((line) =>
            line.closestPointToPoint(point, true, new THREE.Vector3()).distanceTo(point),
          ),
        );
      // The tracked thumb lies along the fingers: its shaft is no farther off them than its pad.
      const tracked =
        clearance(at('thumb-phalanx-distal').lerp(at('thumb-phalanx-proximal'), 0.4)) -
        clearance(at('thumb-tip').lerp(at('thumb-phalanx-distal'), 0.3));
      const rendered = gap(owned(['thumb_02'])) - gap(owned(['thumb_03']));
      expect(Math.abs(rendered - tracked)).toBeLessThan(0.004);
      hand.dispose();
    },
  );
  it.each([
    ...gestures.sets['captured-thumb-rest'].hands.map((pose) => ({ ...pose, kind: 'resting' })),
    ...gestures.sets['captured-thumb-slide'].hands.map((pose) => ({ ...pose, kind: 'sliding' })),
    ...gestures.sets['captured-fist'].hands.map((pose) => ({ ...pose, kind: 'fist' })),
  ])(
    'keeps the $side $kind thumb knuckle straight so the thumb bends only at the pad',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      hand.update(poseSource(pose.joints), new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      const direction = (name: string) =>
        new THREE.Vector3(0, 1, 0).applyQuaternion(
          (mesh.skeleton.getBoneByName(name) as THREE.Bone).getWorldQuaternion(
            new THREE.Quaternion(),
          ),
        );
      expect(
        THREE.MathUtils.radToDeg(direction('thumb_01').angleTo(direction('thumb_02'))),
      ).toBeLessThan(10);
      hand.dispose();
    },
  );
  it.each(gestures.sets['captured-thumb-rest'].hands)(
    'keeps the back of the $side thumb root free of pockets with the thumb resting on the fist',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      hand.update(poseSource(pose.joints), new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      mesh.skeleton.update();
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      const index = geometry.index as THREE.BufferAttribute;
      // glTF splits vertices along seams; weld them so each surface point has one ring.
      const welded = new Map<string, number>();
      const weld = Array.from({ length: position.count }, (_, vertex) => {
        const key = [0, 1, 2].map((k) => position.getComponent(vertex, k).toFixed(5)).join();
        if (!welded.has(key)) welded.set(key, vertex);
        return welded.get(key) as number;
      });
      const ring = Array.from({ length: position.count }, () => new Set<number>());
      for (let face = 0; face < index.count; face += 3)
        for (let k = 0; k < 3; k++) {
          const a = weld[index.getX(face + k)];
          const b = weld[index.getX(face + ((k + 1) % 3))];
          ring[a].add(b);
          ring[b].add(a);
        }
      // Back-of-hand skin around the thumb root, by bind position (glTF: +Z is the palm).
      const region = weld.filter((target, vertex) => {
        if (target !== vertex) return false;
        const x = position.getX(vertex);
        const y = position.getY(vertex);
        return position.getZ(vertex) < -0.002 && x > 0.04 && x < 0.085 && y > 0.06 && y < 0.115;
      });
      const twoRing = region.map((vertex) => {
        const around = new Set(ring[vertex]);
        for (const next of ring[vertex]) for (const far of ring[next]) around.add(far);
        around.delete(vertex);
        return [...around];
      });
      // Depth of each vertex below the mean of its two-ring, along the outward normal.
      const pits = (at: (vertex: number) => THREE.Vector3): number[] => {
        const normals = new Map<number, THREE.Vector3>();
        for (let face = 0; face < index.count; face += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => weld[index.getX(face + k)]);
          const normal = at(b)
            .sub(at(a))
            .cross(at(c).sub(at(a)));
          for (const vertex of [a, b, c])
            normals.set(vertex, (normals.get(vertex) ?? new THREE.Vector3()).add(normal));
        }
        return region.map((vertex, k) => {
          const mean = new THREE.Vector3();
          for (const other of twoRing[k]) mean.add(at(other));
          mean.divideScalar(twoRing[k].length);
          return mean.sub(at(vertex)).dot((normals.get(vertex) as THREE.Vector3).normalize());
        });
      };
      const rest = pits((vertex) => new THREE.Vector3().fromBufferAttribute(position, vertex));
      const outward = [...rest].sort((a, b) => a - b)[rest.length >> 1] > 0 ? -1 : 1;
      const posed = pits((vertex) => mesh.getVertexPosition(vertex, new THREE.Vector3()));
      // A slit dug by the thumb root reads as a pit deeper than about 1.5 mm.
      expect(Math.max(...[...rest, ...posed].map((pit) => pit * outward))).toBeLessThan(0.0015);
      hand.dispose();
    },
  );
  it.each([
    ...gestures.sets['captured-thumb-slide'].hands.map((pose) => ({ ...pose, kind: 'closed' })),
    ...gestures.sets['captured-thumb-slide-left'].hands.map((pose) => ({
      ...pose,
      kind: 'closed',
    })),
    ...gestures.sets['captured-open-palm-slide'].hands.map((pose) => ({ ...pose, kind: 'open' })),
  ])('keeps the $side thumb root uncrimped on the $kind-hand thumb slide', async (pose) => {
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    hand.update(poseSource(pose.joints), new THREE.PerspectiveCamera(), pose.side, 1 / 60);
    const mesh = authoredMeshes(hand.root)[0];
    mesh.skeleton.update();
    const { bones, boneInverses } = mesh.skeleton;
    const thumb = bones.findIndex((bone) => bone.name === 'thumb_01');
    const wrist = bones.findIndex((bone) => bone.name === 'wrist');
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const index = geometry.index as THREE.BufferAttribute;
    // Skin-only helper bones carry part of the wrist-to-thumb blend, so they count as thumb.
    const thumbBones = new Set(
      bones.flatMap((bone, k) =>
        k === thumb || (bone.name.startsWith('thumb_') && bone.name.endsWith('_helper')) ? [k] : [],
      ),
    );
    const thumbWeight = (vertex: number): number => {
      let weight = 0;
      for (let k = 0; k < 4; k++)
        if (thumbBones.has(skinIndex.getComponent(vertex, k)))
          weight += skinWeight.getComponent(vertex, k);
      return weight;
    };
    const skinRotation = (bone: number): THREE.Quaternion =>
      new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4()
          .multiplyMatrices(bones[bone].matrixWorld, boneInverses[bone])
          .premultiply(mesh.matrixWorld.clone().invert()),
      );
    const wristRotation = skinRotation(wrist);
    const thumbRotation = skinRotation(thumb);
    const corners = (face: number, at: (vertex: number) => THREE.Vector3): THREE.Vector3[] =>
      [0, 1, 2].map((k) => at(index.getX(face + k)));
    const rest = (vertex: number) => new THREE.Vector3().fromBufferAttribute(position, vertex);
    const posed = (vertex: number) => mesh.getVertexPosition(vertex, new THREE.Vector3());
    const normal = ([a, b, c]: THREE.Vector3[]) => b.clone().sub(a).cross(c.clone().sub(a));
    // The skin band blending wrist into thumb_01 is where linear-blend skinning crimps.
    let flipped = 0;
    const areaRatios: number[] = [];
    for (let face = 0; face < index.count; face += 3) {
      const share = [0, 1, 2].reduce((sum, k) => sum + thumbWeight(index.getX(face + k)), 0) / 3;
      if (share <= 0.02 || share >= 0.98) continue;
      const before = normal(corners(face, rest));
      const after = normal(corners(face, posed));
      areaRatios.push(after.length() / before.length());
      const expected = [wristRotation, thumbRotation].map((rotation) =>
        before.clone().applyQuaternion(rotation),
      );
      if (expected.every((direction) => after.dot(direction) < 0)) flipped++;
    }
    areaRatios.sort((a, b) => a - b);
    // A crimp folds band triangles inside out; a pinched root collapses their area instead.
    // A fixed rank, unlike a percentile, does not loosen when a wider blend enlarges the band.
    expect(flipped).toBeLessThanOrEqual(2);
    expect(areaRatios[9]).toBeGreaterThan(0.19);
    hand.dispose();
  });
  it.each([
    ...gestures.sets['captured-thumb-slide'].hands,
    ...gestures.sets['captured-thumb-slide-left'].hands,
  ])('keeps the $side closed-fist thumb root inside the precision-v5 outline', async (pose) => {
    // Silhouette of the thumb-root region (below 10 mm above the thumb_01 head, thumb shaft
    // excluded) in the wrist frame, sampled on every triangle, for the palm/back, thumb-side
    // and top views. precision-v5 folds here but keeps a rounded outline; a lobe or beak
    // shows as silhouette area outside it.
    const views: Array<[(p: THREE.Vector3) => number, (p: THREE.Vector3) => number]> = [
      [(p) => p.y, (p) => p.x],
      [(p) => p.y, (p) => -p.z],
      [(p) => p.y, (p) => p.z],
      [(p) => p.z, (p) => p.x],
    ];
    const bin = 0.002;
    const profiles = async (bytes: ArrayBuffer) => {
      const hand = createRiggedHand({
        loader: {
          loadAsync: () => new GLTFLoader().parseAsync(bytes, ''),
        } as unknown as GLTFLoader,
      });
      await hand.assetReady;
      hand.update(poseSource(pose.joints), new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      mesh.skeleton.update();
      const { bones, boneInverses } = mesh.skeleton;
      const wrist = bones.findIndex((bone) => bone.name === 'wrist');
      const thumb = bones.findIndex((bone) => bone.name === 'thumb_01');
      const shaft = new Set(
        bones.flatMap((bone, k) => (['thumb_02', 'thumb_03'].includes(bone.name) ? [k] : [])),
      );
      const head = new THREE.Vector3().setFromMatrixPosition(boneInverses[thumb].clone().invert());
      const toWrist = new THREE.Matrix4()
        .multiplyMatrices(bones[wrist].matrixWorld, boneInverses[wrist])
        .premultiply(mesh.matrixWorld.clone().invert())
        .invert();
      const geometry = mesh.geometry;
      const skinIndex = geometry.getAttribute('skinIndex');
      const skinWeight = geometry.getAttribute('skinWeight');
      const index = geometry.index as THREE.BufferAttribute;
      const count = geometry.getAttribute('position').count;
      const points = Array.from({ length: count }, (_, vertex) =>
        mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(toWrist),
      );
      const kept = Array.from({ length: count }, (_, vertex) => {
        let weight = 0;
        for (let k = 0; k < 4; k++)
          if (shaft.has(skinIndex.getComponent(vertex, k)))
            weight += skinWeight.getComponent(vertex, k);
        return weight < 0.5;
      });
      const result = views.map(() => new Map<number, number>());
      const steps = 4;
      for (let face = 0; face < index.count; face += 3) {
        const corners = [0, 1, 2].map((k) => index.getX(face + k));
        if (!corners.every((vertex) => kept[vertex])) continue;
        const [a, b, c] = corners.map((vertex) => points[vertex]);
        for (let u = 0; u <= steps; u++)
          for (let v = 0; v <= steps - u; v++) {
            const point = new THREE.Vector3()
              .addScaledVector(a, u / steps)
              .addScaledVector(b, v / steps)
              .addScaledVector(c, (steps - u - v) / steps);
            if (point.y > head.y + 0.01) continue;
            for (const [k, [key, value]] of views.entries()) {
              const slot = Math.floor(key(point) / bin);
              result[k].set(slot, Math.max(result[k].get(slot) ?? -Infinity, value(point)));
            }
          }
      }
      hand.dispose();
      return result;
    };
    const reference = await profiles(
      new Uint8Array(readFileSync('assets-source/hand/precision-v5/hand.staged.glb')).slice()
        .buffer,
    );
    const current = await profiles(assetBytes);
    let excess = 0;
    for (const [k, profile] of current.entries())
      for (const [slot, value] of profile) {
        const limit = reference[k].get(slot);
        if (limit !== undefined && value > limit) excess += (value - limit) * bin;
      }
    // mm^2 outside v5: the v6b lobe and beak measured about 560-580, v10 about 110.
    expect(excess * 1e6).toBeLessThan(250);
  });
  it.each(['left', 'right'] as const)(
    'drives only the %s thumb_fold corrective, for a thumb folded over a fist',
    async (side) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const mesh = authoredMeshes(hand.root)[0];
      const own = mesh.morphTargetDictionary?.[THUMB_FOLD_MORPHS[side]] as number;
      const other =
        mesh.morphTargetDictionary?.[THUMB_FOLD_MORPHS[side === 'left' ? 'right' : 'left']];
      expect(own).toBeTypeOf('number');
      expect(other).toBeTypeOf('number');
      const weight = (): number => mesh.morphTargetInfluences?.[own] ?? Number.NaN;
      const otherWeight = (): number => mesh.morphTargetInfluences?.[other as number] ?? Number.NaN;
      const pose = (set: string) =>
        gestures.sets[set].hands.find((entry) => entry.side === side)?.joints ?? {};
      const camera = new THREE.PerspectiveCamera();
      hand.update(neutralSource(side), camera, side, 1 / 60);
      expect(weight()).toBe(0);
      hand.update(poseSource(pose('captured-pinch')), camera, side, 1 / 60);
      expect(weight()).toBeLessThan(0.05);
      // The weight eases toward its target, so one 60 Hz frame of a fist moves it only a little.
      hand.update(poseSource(pose('captured-fist')), camera, side, 1 / 60);
      expect(weight()).toBeLessThan(0.3);
      // A still fist moves no skin, so the weight settles at THUMB_FOLD_MIN_RATE.
      hand.update(poseSource(pose('captured-fist')), camera, side, 10);
      expect(weight()).toBeGreaterThan(0.85);
      expect(otherWeight()).toBe(0);
      const gamepad = { buttons: Array.from({ length: 6 }, () => ({ value: 1, pressed: true })) };
      hand.updateController(new THREE.Group(), camera, side, gamepad as unknown as Gamepad, 1 / 60);
      expect(weight()).toBe(0);
      expect(otherWeight()).toBe(0);
      // Leaving controller mode or tracking loss takes the next target directly, never a stale weight.
      hand.update(poseSource(pose('captured-fist')), camera, side, 1 / 60);
      expect(weight()).toBeGreaterThan(0.85);
      hand.hide();
      hand.update(neutralSource(side), camera, side, 1 / 60);
      expect(weight()).toBe(0);
      hand.dispose();
    },
  );
  it.each(['hide', 'tracking loss', 'controller mode', 'side change'] as const)(
    'drops a stale thumb_fold weight after %s',
    async (reset) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const mesh = authoredMeshes(hand.root)[0];
      const camera = new THREE.PerspectiveCamera();
      const fist = (side: 'left' | 'right') =>
        poseSource(
          gestures.sets['captured-fist'].hands.find((entry) => entry.side === side)?.joints ?? {},
        );
      const weights = () => [...(mesh.morphTargetInfluences ?? [])];
      hand.update(fist('right'), camera, 'right', 1 / 60);
      expect(Math.max(...weights())).toBeGreaterThan(0.85);
      if (reset === 'hide') hand.hide();
      if (reset === 'tracking loss') {
        const lost = fist('right');
        for (const joint of Object.values(lost.joints)) joint.visible = false;
        hand.update(lost, camera, 'right', 1 / 60);
      }
      if (reset === 'controller mode')
        hand.updateController(new THREE.Group(), camera, 'right', undefined, 1 / 60);
      if (reset === 'side change') hand.update(fist('left'), camera, 'left', 1 / 60);
      // One 60 Hz frame back at an open hand would leave an eased weight near 1; a reset takes 0.
      hand.update(neutralSource('right'), camera, 'right', 1 / 60);
      expect(weights()).toEqual(weights().map(() => 0));
      hand.dispose();
    },
  );
  it('keeps the thumb_fold weights of the two hands apart', async () => {
    // The scene builds one rigged hand per side, each from its own parse of the asset.
    const left = createRiggedHand({ loader: parsedLoader() });
    const right = createRiggedHand({ loader: parsedLoader() });
    await Promise.all([left.assetReady, right.assetReady]);
    const fist = gestures.sets['captured-fist'].hands.find((entry) => entry.side === 'left');
    left.update(poseSource(fist?.joints ?? {}), new THREE.PerspectiveCamera(), 'left', 1);
    const [leftMesh, rightMesh] = [left, right].map((hand) => authoredMeshes(hand.root)[0]);
    expect(leftMesh.morphTargetInfluences).not.toBe(rightMesh.morphTargetInfluences);
    expect(
      leftMesh.morphTargetInfluences?.[
        leftMesh.morphTargetDictionary?.[THUMB_FOLD_MORPHS.left] as number
      ],
    ).toBeGreaterThan(0.85);
    expect(rightMesh.morphTargetInfluences?.every((weight) => weight === 0)).toBe(true);
    left.dispose();
    right.dispose();
  });
  it('moves the thumb_fold key no further than the skin on a still thumb-rest fist', async () => {
    // Replays thumb-rest frames 27-42 at their captured spacing. Per capture, the key's own skin
    // motion (morphed minus unmorphed positions) must not outrun the unmorphed skin motion over the
    // key's region on frames 30-40. v12, eased only, moved the key 1.4 mm under 0.7 mm of skin at
    // frame 35.
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    const mesh = authoredMeshes(hand.root)[0];
    const slot = mesh.morphTargetDictionary?.[THUMB_FOLD_MORPHS.right] as number;
    const influences = mesh.morphTargetInfluences as number[];
    const target = mesh.geometry.morphAttributes.position?.[slot] as THREE.BufferAttribute;
    const region: number[] = [];
    for (let vertex = 0; vertex < target.count; vertex++)
      if (Math.hypot(target.getX(vertex), target.getY(vertex), target.getZ(vertex)) > 1e-4)
        region.push(vertex);
    const sample = () =>
      region.map((vertex) => mesh.getVertexPosition(vertex, new THREE.Vector3()));
    const camera = new THREE.PerspectiveCamera();
    let previous: { skin: THREE.Vector3[]; key: THREE.Vector3[] } | undefined;
    const ratios: number[] = [];
    for (const frame of gestures.sets['captured-thumb-rest-sequence'].hands) {
      hand.update(poseSource(frame.joints), camera, 'right', (frame.stampDeltaMs ?? 0) / 1000);
      mesh.skeleton.update();
      const weight = influences[slot];
      const morphed = sample();
      influences[slot] = 0;
      const skin = sample();
      influences[slot] = weight;
      const key = morphed.map((point, k) => point.clone().sub(skin[k]));
      if (previous) {
        let skinStep = 0;
        let keyStep = 0;
        for (let k = 0; k < region.length; k++) {
          skinStep = Math.max(skinStep, skin[k].distanceTo(previous.skin[k]));
          keyStep = Math.max(keyStep, key[k].distanceTo(previous.key[k]));
        }
        const index = (frame as { frame?: number }).frame ?? 0;
        if (index >= 30 && index <= 40) ratios.push(keyStep / skinStep);
      }
      previous = { skin, key };
    }
    expect(ratios).toHaveLength(11);
    expect(Math.max(...ratios)).toBeLessThanOrEqual(1);
    hand.dispose();
  });
  it('eases the thumb_fold weight across consecutive thumb-rest captures', async () => {
    // Thumb-rest frames 27-42 swing the fold target between about 0.2 and 1 from one capture to
    // the next; unsmoothed (v11) the weight jumped 0.49 in one capture while the skin moved under a
    // millimetre. Replayed at the capture cadence the eased weight steps at most about 0.25.
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    const mesh = authoredMeshes(hand.root)[0];
    const slot = mesh.morphTargetDictionary?.[THUMB_FOLD_MORPHS.right] as number;
    const camera = new THREE.PerspectiveCamera();
    const frames = gestures.sets['captured-thumb-rest-sequence'].hands;
    expect(frames).toHaveLength(16);
    const steps: number[] = [];
    let previous: number | undefined;
    let settled = 0;
    for (const frame of frames) {
      hand.update(poseSource(frame.joints), camera, 'right', 0.057);
      const weight = mesh.morphTargetInfluences?.[slot] as number;
      if (previous !== undefined) steps.push(Math.abs(weight - previous));
      previous = weight;
      settled = Math.max(settled, weight);
    }
    expect(THUMB_FOLD_SMOOTHING).toBeGreaterThanOrEqual(0.08);
    expect(THUMB_FOLD_SMOOTHING).toBeLessThanOrEqual(0.12);
    expect(Math.max(...steps)).toBeLessThan(0.3);
    expect(settled).toBeGreaterThan(0.6);
    hand.dispose();
  });
  it('catches the thumb_fold key up with a folding slide within a few captures', async () => {
    // Slide frames 156-166 at their captured stamps: the fold target reaches full weight at frame
    // 161. The surface lag is the settled weight minus the eased one, times the key's reach. At
    // 100 ms easing the 8.4 mm right key lagged 3.2 mm at frame 161; 85 ms leaves 2.8.
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    const mesh = authoredMeshes(hand.root)[0];
    const slot = mesh.morphTargetDictionary?.[THUMB_FOLD_MORPHS.right] as number;
    const key = mesh.geometry.morphAttributes.position?.[slot] as THREE.BufferAttribute;
    let reach = 0;
    for (let k = 0; k < key.count; k++)
      reach = Math.max(reach, Math.hypot(key.getX(k), key.getY(k), key.getZ(k)));
    const camera = new THREE.PerspectiveCamera();
    const lag = new Map<number, number>();
    for (const frame of gestures.sets['captured-thumb-slide-sequence'].hands) {
      hand.update(poseSource(frame.joints), camera, 'right', (frame.stampDeltaMs ?? 0) / 1000);
      const settledHand = createRiggedHand({ loader: parsedLoader() });
      await settledHand.assetReady;
      settledHand.update(poseSource(frame.joints), camera, 'right', 10);
      const settled = authoredMeshes(settledHand.root)[0].morphTargetInfluences?.[slot] as number;
      lag.set(
        frame.frame ?? -1,
        (settled - (mesh.morphTargetInfluences?.[slot] as number)) * reach,
      );
      settledHand.dispose();
    }
    expect(lag.size).toBe(11);
    expect((lag.get(161) as number) * 1000).toBeLessThanOrEqual(3);
    expect((lag.get(164) as number) * 1000).toBeLessThanOrEqual(0.5);
    hand.dispose();
  });
  it.each([
    ...gestures.sets['captured-thumb-slide'].hands,
    ...gestures.sets['captured-thumb-slide-left'].hands,
    ...gestures.sets['captured-thumb-rest'].hands,
  ])('keeps the $side closed-fist thumb-side back outline convex', async (pose) => {
    // From 40 mm below to 10 mm above the thumb_01 head: v10 dipped 2.6-3.3 mm on these poses,
    // the thumb_fold corrective leaves 0.7-1.3 mm.
    expect((await backOutlineDip(pose, 0.01)) * 1000).toBeLessThan(1.5);
  });
  it('keeps the right fist back-outline ledge above the thumb root under 4 mm', async () => {
    // The ledge's corner sits 10-18 mm above the thumb_01 head, where the thumb-root knob meets
    // the narrower index-base edge, so this window reaches 30 mm above the head. v12 dipped
    // 5.7 mm here; v13's right key fills the rim toward the envelope and leaves 2.8.
    const [pose] = gestures.sets['captured-thumb-slide'].hands;
    expect((await backOutlineDip(pose, 0.03)) * 1000).toBeLessThan(4);
  });
  it.each([
    ...gestures.sets['captured-thumb-slide-left'].hands,
    ...gestures.sets['captured-thumb-slide'].hands,
  ])('keeps the $side closed-fist thumb root free of a pit under the knob', async (pose) => {
    // Umbrella residual (vertex minus the mean of its neighbours, along the vertex normal) over
    // skin carried mostly by the thumb-root helpers and thumb_01. The left runtime pose pushes a
    // knob out palm-side of the thumb root with a pit under it: 2.6 mm deep with the shared v11
    // key, 1.5 mm with the left key, against 1.5-1.6 mm on the right hand.
    const hand = createRiggedHand({ loader: parsedLoader() });
    await hand.assetReady;
    hand.update(poseSource(pose.joints), new THREE.PerspectiveCamera(), pose.side, 1 / 60);
    const mesh = authoredMeshes(hand.root)[0];
    mesh.skeleton.update();
    const geometry = mesh.geometry;
    const count = geometry.getAttribute('position').count;
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const index = geometry.index as THREE.BufferAttribute;
    const root = new Set(
      mesh.skeleton.bones.flatMap((bone, k) =>
        [...Object.keys(THUMB_HELPERS), 'thumb_01'].includes(bone.name) ? [k] : [],
      ),
    );
    const points = Array.from({ length: count }, (_, vertex) =>
      mesh.getVertexPosition(vertex, new THREE.Vector3()),
    );
    const normals = points.map(() => new THREE.Vector3());
    const neighbours = points.map(() => new Set<number>());
    for (let face = 0; face < index.count; face += 3) {
      const corners = [0, 1, 2].map((k) => index.getX(face + k));
      const [a, b, c] = corners.map((vertex) => points[vertex]);
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a));
      for (const vertex of corners) {
        normals[vertex].add(normal);
        for (const other of corners) if (other !== vertex) neighbours[vertex].add(other);
      }
    }
    let pit = 0;
    for (let vertex = 0; vertex < count; vertex++) {
      let share = 0;
      for (let k = 0; k < 4; k++)
        if (root.has(skinIndex.getComponent(vertex, k)))
          share += skinWeight.getComponent(vertex, k);
      if (share <= 0.3) continue;
      const mean = new THREE.Vector3();
      for (const other of neighbours[vertex]) mean.add(points[other]);
      mean.divideScalar(neighbours[vertex].size);
      pit = Math.min(pit, points[vertex].clone().sub(mean).dot(normals[vertex].normalize()));
    }
    expect(-pit * 1000).toBeLessThan(2);
    hand.dispose();
  });
  it.each(['left', 'right'] as const)(
    'keeps the %s index pointing forward when the other fingers curl',
    async (side) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const open = neutralCapture.hands.find((entry) => entry.side === side)?.joints;
      const fist = gestures.sets['captured-fist'].hands.find(
        (entry) => entry.side === side,
      )?.joints;
      if (!open || !fist) throw new Error('Missing captured hand');
      const wrist = (joints: typeof open) => new THREE.Matrix4().fromArray(joints.wrist.matrix);
      const move = wrist(open).multiply(wrist(fist).invert());
      const joints = { ...open };
      for (const [name, entry] of Object.entries(fist))
        if (/^(middle|ring|pinky)-finger-/.test(name))
          joints[name] = {
            matrix: new THREE.Matrix4().fromArray(entry.matrix).premultiply(move).toArray(),
          };
      const source = poseSource(joints);
      hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      const at = (name: string) => source.joints[name].getWorldPosition(new THREE.Vector3());
      const tracked = at('index-finger-phalanx-intermediate')
        .sub(at('index-finger-phalanx-proximal'))
        .normalize();
      const bone = mesh.skeleton.getBoneByName('index_01') as THREE.Bone;
      const rendered = new THREE.Vector3(0, 1, 0).applyQuaternion(
        bone.getWorldQuaternion(new THREE.Quaternion()),
      );
      expect(THREE.MathUtils.radToDeg(rendered.angleTo(tracked))).toBeLessThan(20);
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
      // Tracked curl drives the digits directly; the roots sit ~30 mm apart, so closing
      // fingers come together without touching.
      expect(gap).toBeLessThan(rightPartial ? 0.018 : 0.014);
      expect(gap).toBeGreaterThan(0.002);
    }
    for (const bone of mesh.skeleton.bones)
      for (const axis of [0, 1, 2])
        expect(
          new THREE.Vector3().setFromMatrixColumn(bone.matrixWorld, axis).length(),
        ).toBeCloseTo(1, 5);
    hand.dispose();
  });
  it.each(['left', 'right'] as const)(
    'aims every %s bone along its tracked neutral joint',
    async (side) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = neutralSource(side);
      hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      const joints: Record<string, string> = {
        thumb_01: 'thumb-phalanx-proximal',
        thumb_02: 'thumb-phalanx-proximal',
        thumb_03: 'thumb-phalanx-distal',
      };
      for (const [name, finger] of [
        ['index', 'index'],
        ['middle', 'middle'],
        ['outer', 'ring'],
      ])
        ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal'].forEach((part, i) => {
          joints[`${name}_0${i + 1}`] = `${finger}-finger-${part}`;
        });
      const palmNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        (hand.root.getObjectByName('authored-hand-root') as THREE.Object3D).getWorldQuaternion(
          new THREE.Quaternion(),
        ),
      );
      const roots: Record<string, { bone: THREE.Vector3; joint: THREE.Vector3 }> = {};
      const flat = (axis: THREE.Vector3) => axis.clone().projectOnPlane(palmNormal).normalize();
      for (const [name, joint] of Object.entries(joints)) {
        const bone = mesh.skeleton.getBoneByName(name) as THREE.Bone;
        const boneAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(
          bone.getWorldQuaternion(new THREE.Quaternion()),
        );
        const jointAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(
          source.joints[joint].getWorldQuaternion(new THREE.Quaternion()),
        );
        if (name.startsWith('thumb') || name.startsWith('middle')) {
          expect(boneAxis.angleTo(jointAxis)).toBeLessThan(THREE.MathUtils.degToRad(1));
        } else {
          // Index and outer only swing about the palm normal; their tracked curl is kept.
          expect(Math.abs(boneAxis.dot(palmNormal) - jointAxis.dot(palmNormal))).toBeLessThan(0.02);
        }
        if (name.endsWith('_01')) roots[name] = { bone: flat(boneAxis), joint: flat(jointAxis) };
      }
      // The neutral open hand's tracked fan is narrowed toward the middle finger.
      for (const name of ['index_01', 'outer_01'])
        expect(roots[name].bone.angleTo(roots.middle_01.bone)).toBeLessThan(
          roots[name].joint.angleTo(roots.middle_01.joint),
        );
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
      hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
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
        hand.update(source, new THREE.PerspectiveCamera(), side, 1 / 60);
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
    'keeps the unopposed $side thumb on its tracked direction',
    async (pose) => {
      const hand = createRiggedHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = poseSource(pose.joints);
      const tip = (name: string) => source.joints[name].getWorldPosition(new THREE.Vector3());
      expect(tip('thumb-tip').distanceTo(tip('index-finger-tip'))).toBeGreaterThan(0.075);
      hand.update(source, new THREE.PerspectiveCamera(), pose.side, 1 / 60);
      const mesh = authoredMeshes(hand.root)[0];
      for (const [name, joint] of [
        ['thumb_01', 'thumb-phalanx-proximal'],
        ['thumb_03', 'thumb-phalanx-distal'],
      ]) {
        const bone = mesh.skeleton.getBoneByName(name) as THREE.Bone;
        const boneAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(
          bone.getWorldQuaternion(new THREE.Quaternion()),
        );
        const jointAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(
          source.joints[joint].getWorldQuaternion(new THREE.Quaternion()),
        );
        expect(boneAxis.angleTo(jointAxis)).toBeLessThan(THREE.MathUtils.degToRad(1));
      }
      hand.dispose();
    },
  );
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
          if (bone.name === 'thumb_01' || bone.name.endsWith('_helper'))
            expect(rootTravel).toBeLessThanOrEqual(0.050001);
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
    const boneNames = [...NAMES, ...Object.keys(THUMB_HELPERS)];
    expect(firstBones).toHaveLength(boneNames.length);
    expect(secondBones).toHaveLength(boneNames.length);
    expect(firstBones.map((bone) => bone.name)).toEqual(expect.arrayContaining(boneNames));
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
