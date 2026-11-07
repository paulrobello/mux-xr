// Derives one side's thumb_fold corrective shape key from posed captures of that side.
// NAME=thumb_fold_right|thumb_fold_left bun run assets-source/hand/precision-v6/fold_morph.ts <out.json> <capture.json>:<side>:<from>-<to> ...
// For every capture frame whose runtime fold weight is at least MIN_WEIGHT, the closed-fist thumb root
// is smoothed in posed space (masked Laplacian, which removes the knob, dip and wrinkles), then the
// band is relaxed tangentially so smoothing does not crush its triangles. The posed correction is
// pulled back to bind space through each vertex's blended skin matrix L; the bind delta is the
// weighted least-squares fit over all frames: d = (sum w^2 L^T L)^-1 sum w L^T delta.
// Smoothing cannot reach the ledge where the thumb-root knob meets the narrower index-base edge
// (10-18 mm above the thumb_01 head), so a fill term pushes the back view's thumb-side rim out to its
// concave envelope. The fill is fitted separately, only over the frames that push each vertex: frames
// where a vertex is off the rim do not care about it, and averaging them in would cancel the fill.
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRiggedHand } from '../../../src/xr/rigged-hand';

const GLB = process.env.GLB ?? 'assets-source/hand/authored-hand.staged.glb';
const MIN_WEIGHT = 0.3;
const NAME = process.env.NAME ?? 'thumb_fold_right';
// More smoothing passes round the knob further but fold or crush the crease band. Palm-side skin
// (bind +Z, metres) holds the thumb/palm valley, so smoothing fades out there; the left runtime pose
// bulges palm-side of the thumb root (bind z +3..+10 mm), so its key fades later. These keep at most
// 2 flipped band triangles and the crimp band above 0.19; the thumb-rest pocket is 1.2 mm on the
// left and 1.4 mm on the right, where the fill deepens it.
type Fit = { iterations: number; relax: number; palmStart: number; palmEnd: number; fill: number };
const FIT = (
  {
    thumb_fold_right: { iterations: 15, relax: 6, palmStart: 0.002, palmEnd: 0.01, fill: 3 },
    thumb_fold_left: { iterations: 8, relax: 6, palmStart: 0.01, palmEnd: 0.018, fill: 0 },
  } as Record<string, Fit>
)[NAME];
if (!FIT) throw new Error(`unknown corrective ${NAME}`);
const { iterations: ITERATIONS, relax: RELAX, palmStart: PALM_START, palmEnd: PALM_END, fill: FILL } = FIT;
// Fill window in the wrist frame (metres from the thumb_01 head), the deepest skin behind the rim that
// still follows it, and the largest gap filled per frame. On the right, fills of 1.3-2 without the
// neighbour pass deepened the pit to 2.1-3.0 mm, and 4 with two passes flipped 4 band triangles.
const FILL_BELOW = 0.04;
const FILL_ABOVE = 0.03;
const FILL_RIM = 0.015;
const FILL_GAP = 0.006;
const STEP = 0.5;
const HELPERS = ['thumb_root_helper', 'thumb_heel_helper', 'thumb_web_helper', 'thumb_01'];
const SHAFT = ['thumb_02', 'thumb_03'];
const [out, ...specs] = process.argv.slice(2);

type Frame = { hands: { side: string; visible: boolean; joints: Record<string, { matrix: number[] }> }[] };
const bytes = new Uint8Array(readFileSync(GLB)).slice().buffer;
const loader = {
  loadAsync: async () => {
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    gltf.scene.traverse((object) => {
      const skinned = object as THREE.SkinnedMesh;
      if (!skinned.isSkinnedMesh) return;
      const count = skinned.geometry.getAttribute('position').count;
      skinned.geometry.morphAttributes.position = [0, 1].map(
        () => new THREE.BufferAttribute(new Float32Array(count * 3), 3),
      );
      skinned.geometry.morphTargetsRelative = true;
      skinned.updateMorphTargets();
      skinned.morphTargetDictionary = { thumb_fold_left: 0, thumb_fold_right: 1 };
    });
    return gltf;
  },
} as unknown as GLTFLoader;
const hand = createRiggedHand({ loader });
await hand.assetReady;
const mesh = hand.root.getObjectByName('authored-hand-skin') as THREE.SkinnedMesh;
const geometry = mesh.geometry;
const count = geometry.getAttribute('position').count;
const skinIndex = geometry.getAttribute('skinIndex');
const skinWeight = geometry.getAttribute('skinWeight');
const bones = mesh.skeleton.bones;
const share = (vertex: number, names: string[]): number => {
  let total = 0;
  for (let k = 0; k < 4; k++)
    if (names.includes(bones[skinIndex.getComponent(vertex, k)].name))
      total += skinWeight.getComponent(vertex, k);
  return total;
};

const neighbours: Set<number>[] = Array.from({ length: count }, () => new Set());
const index = geometry.index as THREE.BufferAttribute;
for (let f = 0; f < index.count; f += 3) {
  const tri = [index.getX(f), index.getX(f + 1), index.getX(f + 2)];
  for (const a of tri) for (const b of tri) if (a !== b) neighbours[a].add(b);
}
// Region: back and side skin carried by the thumb-root helpers and thumb_01, never the thumb shaft,
// pad or palm valley. The relaxed band reaches further out than the smoothed region.
const position = geometry.getAttribute('position');
const region = (v: number, start: number, end: number): number =>
  THREE.MathUtils.smoothstep(share(v, HELPERS), start, end) *
  (1 - THREE.MathUtils.smoothstep(share(v, SHAFT), 0.02, 0.2)) *
  (1 - THREE.MathUtils.smoothstep(position.getZ(v), PALM_START, PALM_END));
let mask = Array.from({ length: count }, (_, v) => region(v, 0.15, 0.5));
for (let pass = 0; pass < 3; pass++)
  mask = mask.map((value, v) => {
    let sum = 0;
    for (const n of neighbours[v]) sum += mask[n];
    return Math.min(value, sum / Math.max(1, neighbours[v].size));
  });
const relax = Array.from({ length: count }, (_, v) => region(v, 0.05, 0.3));
// Fill candidates: thumb-side palm and thumb-root skin below the fingers (bind metres).
const fillable = Array.from(
  { length: count },
  (_, v) => position.getX(v) > 0.035 && position.getY(v) > 0.05 && position.getY(v) < 0.13,
);
const belowFingers = (v: number): boolean => position.getY(v) < 0.13;
const normal = Array.from({ length: count }, () => new Float64Array(9));
const rhs = Array.from({ length: count }, () => new Float64Array(3));
const fillNormal = Array.from({ length: count }, () => new Float64Array(9));
const fillRhs = Array.from({ length: count }, () => new Float64Array(3));
const wristBone = bones.findIndex((bone) => bone.name === 'wrist');
const headY = new THREE.Vector3().setFromMatrixPosition(
  mesh.skeleton.boneInverses[bones.findIndex((bone) => bone.name === 'thumb_01')].clone().invert(),
).y;
// Back-view thumb-side edge (max x per 2 mm of height, sampled on every triangle) and the push that
// lifts each rim vertex to the edge's concave envelope, spread one pass over its neighbours.
const fillPush = (target: THREE.Vector3[]): THREE.Vector3[] => {
  const toWrist = new THREE.Matrix4()
    .multiplyMatrices(bones[wristBone].matrixWorld, mesh.skeleton.boneInverses[wristBone])
    .premultiply(mesh.matrixWorld.clone().invert())
    .invert();
  const outward = new THREE.Vector3(1, 0, 0).transformDirection(toWrist.clone().invert());
  const local = target.map((p) => p.clone().applyMatrix4(toWrist));
  const bin = (y: number): number => Math.floor(y / 0.002);
  const edge = new Map<number, number>();
  for (let f = 0; f < index.count; f += 3) {
    const tri = [index.getX(f), index.getX(f + 1), index.getX(f + 2)];
    if (!tri.every(belowFingers)) continue;
    const [a, b, c] = tri.map((v) => local[v]);
    for (let u = 0; u <= 4; u++)
      for (let w = 0; w <= 4 - u; w++) {
        const q = new THREE.Vector3()
          .addScaledVector(a, u / 4)
          .addScaledVector(b, w / 4)
          .addScaledVector(c, (4 - u - w) / 4);
        if (q.y < headY - FILL_BELOW || q.y > headY + FILL_ABOVE) continue;
        edge.set(bin(q.y), Math.max(edge.get(bin(q.y)) ?? -Infinity, q.x));
      }
  }
  const bins = [...edge.keys()].sort((a, b) => a - b);
  const envelope = new Map<number, number>();
  for (const m of bins) {
    let top = edge.get(m) as number;
    for (const l of bins)
      for (const r of bins)
        if (l < m && r > m) {
          const t = (m - l) / (r - l);
          top = Math.max(top, (edge.get(l) as number) * (1 - t) + (edge.get(r) as number) * t);
        }
    envelope.set(m, top);
  }
  let push = target.map(() => new THREE.Vector3());
  for (let v = 0; v < count; v++) {
    if (!fillable[v]) continue;
    const at = edge.get(bin(local[v].y));
    const top = envelope.get(bin(local[v].y));
    if (at === undefined || top === undefined) continue;
    const gap = Math.min(top - at, FILL_GAP);
    const near = 1 - THREE.MathUtils.smoothstep(at - local[v].x, 0, FILL_RIM);
    if (gap > 0 && near > 0) push[v].addScaledVector(outward, gap * FILL * near);
  }
  push = push.map((p, v) => {
    if (!fillable[v] && mask[v] <= 0) return p;
    const mean = new THREE.Vector3();
    for (const n of neighbours[v]) mean.add(push[n]);
    return p.clone().lerp(mean.divideScalar(Math.max(1, neighbours[v].size)), 0.5);
  });
  return push;
};
// Adds one frame's weighted normal equations for a vertex: n += w^2 L^T L, r += w L^T delta.
// L is column-major: L[c * 3 + r] is row r, column c.
const accumulate = (
  n: Float64Array,
  r: Float64Array,
  L: number[],
  delta: THREE.Vector3,
  weight: number,
): void => {
  const d = [delta.x, delta.y, delta.z];
  for (let a = 0; a < 3; a++) {
    for (let c = 0; c < 3; c++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += L[a * 3 + k] * L[c * 3 + k];
      n[a * 3 + c] += weight * weight * dot;
    }
    let dot = 0;
    for (let k = 0; k < 3; k++) dot += L[a * 3 + k] * d[k];
    r[a] += weight * dot;
  }
};
const skin = new THREE.Matrix4();
const term = new THREE.Matrix4();
const linear = new THREE.Matrix3();
let frames = 0;
for (const spec of specs) {
  const [file, side, range] = spec.split(':');
  const [from, to] = range.split('-').map(Number);
  const capture = JSON.parse(readFileSync(file, 'utf8')) as Frame[];
  for (let i = from; i <= to; i++) {
    const pose = capture[i]?.hands.find((item) => item.side === side && item.visible);
    if (!pose) continue;
    const source = new THREE.Group() as THREE.Group & { joints: Record<string, THREE.Object3D> };
    source.joints = {};
    for (const [name, joint] of Object.entries(pose.joints)) {
      const object = new THREE.Group();
      new THREE.Matrix4()
        .fromArray(joint.matrix)
        .decompose(object.position, object.quaternion, object.scale);
      object.visible = true;
      source.joints[name] = object;
      source.add(object);
    }
    // A long step lets the smoothed runtime weight settle on its target for every frame.
    hand.update(source, new THREE.PerspectiveCamera(), side as 'left' | 'right', 10);
    const weight = mesh.morphTargetInfluences?.[mesh.morphTargetDictionary?.[`thumb_fold_${side}`] ?? -1] ?? 0;
    if (weight < MIN_WEIGHT) continue;
    frames++;
    const posed = Array.from({ length: count }, (_, v) =>
      mesh.getVertexPosition(v, new THREE.Vector3()),
    );
    let target = posed.map((p) => p.clone());
    for (let pass = 0; pass < ITERATIONS; pass++)
      target = target.map((p, v) => {
        if (mask[v] <= 0) return p;
        const mean = new THREE.Vector3();
        for (const n of neighbours[v]) mean.add(target[n]);
        mean.divideScalar(neighbours[v].size);
        return p.clone().lerp(mean, STEP * mask[v]);
      });
    for (let pass = 0; pass < RELAX; pass++) {
      const normals = target.map(() => new THREE.Vector3());
      for (let f = 0; f < index.count; f += 3) {
        const [a, b, c] = [index.getX(f), index.getX(f + 1), index.getX(f + 2)];
        const face = new THREE.Vector3()
          .subVectors(target[b], target[a])
          .cross(new THREE.Vector3().subVectors(target[c], target[a]));
        normals[a].add(face);
        normals[b].add(face);
        normals[c].add(face);
      }
      target = target.map((p, v) => {
        if (relax[v] <= 0) return p;
        const along = normals[v].normalize();
        const move = new THREE.Vector3();
        for (const n of neighbours[v]) move.add(target[n]);
        move.divideScalar(neighbours[v].size).sub(p);
        move.addScaledVector(along, -move.dot(along));
        return p.clone().addScaledVector(move, 0.5 * relax[v]);
      });
    }
    const push = fillPush(target);
    for (let v = 0; v < count; v++) {
      const pushed = push[v].lengthSq() > 1e-12;
      if (mask[v] <= 0 && relax[v] <= 0 && !pushed) continue;
      skin.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(v, k);
        if (w === 0) continue;
        const b = skinIndex.getComponent(v, k);
        term.multiplyMatrices(bones[b].matrixWorld, mesh.skeleton.boneInverses[b]);
        for (let e = 0; e < 16; e++) skin.elements[e] += w * term.elements[e];
      }
      skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
      const L = linear.setFromMatrix4(skin).elements;
      if (mask[v] > 0 || relax[v] > 0)
        accumulate(normal[v], rhs[v], L, target[v].clone().sub(posed[v]), weight);
      if (pushed) accumulate(fillNormal[v], fillRhs[v], L, push[v], weight);
    }
  }
}

const solve = new THREE.Matrix3();
const indices: number[] = [];
const deltas: number[] = [];
const positions: number[] = [];
let largest = 0;
const solved = (n: Float64Array, r: Float64Array): THREE.Vector3 =>
  n[0] + n[4] + n[8] > 0
    ? new THREE.Vector3(r[0], r[1], r[2]).applyMatrix3(
        solve.set(n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8]).invert(),
      )
    : new THREE.Vector3();
for (let v = 0; v < count; v++) {
  const d = solved(normal[v], rhs[v]).add(solved(fillNormal[v], fillRhs[v]));
  if (d.length() < 1e-5) continue;
  largest = Math.max(largest, d.length());
  indices.push(v);
  deltas.push(...d.toArray().map((x) => Number(x.toFixed(6))));
  positions.push(...[0, 1, 2].map((c) => Number(position.getComponent(v, c).toFixed(6))));
}
writeFileSync(out, `${JSON.stringify({ name: NAME, frames, indices, positions, deltas })}\n`);
console.log(
  `frames ${frames} vertices ${indices.length} largest ${(largest * 1000).toFixed(1)} mm -> ${out}`,
);
