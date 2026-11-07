// Writes src/xr/standard-hand-controller-poses.json from the captured Quest fixtures. For each side:
// `open` (relaxed neutral) and `fist` hold every joint relative to its parent joint, so a blend of
// their rotations keeps bone lengths; `grip` is the WebXR grip space in the captured fist's wrist
// frame (origin at the curled-finger centroid, -Z along the held rod toward the thumb, +X out of
// the back of the right hand and -X out of the back of the left).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';

type Side = 'left' | 'right';
type Capture = { side: Side; joints: Record<string, { matrix: number[] }> };
const neutral = JSON.parse(readFileSync('tests/fixtures/quest-hand-poses.json', 'utf8'))
  .hands as Capture[];
const fists = JSON.parse(readFileSync('tests/fixtures/quest-gesture-poses.json', 'utf8')).sets[
  'captured-fist'
].hands as Capture[];
const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const CHAINS = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...FINGERS.map((finger) => ['wrist', ...PARTS.map((part) => `${finger}-${part}`)]),
];
const round = (values: ArrayLike<number>): number[] =>
  Array.from(values, (value) => Number(value.toFixed(6)));
const flatten = (matrix: THREE.Matrix4): number[] => {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  matrix.decompose(position, rotation, new THREE.Vector3());
  return [...round(position.toArray()), ...round(rotation.normalize().toArray())];
};
const world = (capture: Capture, name: string): THREE.Matrix4 =>
  new THREE.Matrix4().fromArray(capture.joints[name].matrix);
const local = (capture: Capture): Record<string, number[]> => {
  const output: Record<string, number[]> = { wrist: flatten(world(capture, 'wrist')) };
  for (const chain of CHAINS)
    for (let index = 1; index < chain.length; index++)
      output[chain[index]] = flatten(
        world(capture, chain[index - 1])
          .invert()
          .multiply(world(capture, chain[index])),
      );
  return output;
};
const grip = (capture: Capture): number[] => {
  const point = (name: string): THREE.Vector3 =>
    new THREE.Vector3().setFromMatrixPosition(world(capture, name));
  const curled = (finger: string): THREE.Vector3 =>
    ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal']
      .reduce((sum, part) => sum.add(point(`${finger}-${part}`)), new THREE.Vector3())
      .divideScalar(3);
  const centroid = FINGERS.reduce(
    (sum, finger) => sum.add(curled(finger)),
    new THREE.Vector3(),
  ).divideScalar(FINGERS.length);
  const z = curled('pinky-finger').sub(curled('index-finger')).normalize();
  // Fingers curl toward the wrist frame's -Y, so +Y is the back of the hand.
  const back = new THREE.Vector3(0, 1, 0).applyQuaternion(
    new THREE.Quaternion().setFromRotationMatrix(world(capture, 'wrist')),
  );
  const x = back
    .addScaledVector(z, -back.dot(z))
    .normalize()
    .multiplyScalar(capture.side === 'right' ? 1 : -1);
  const y = new THREE.Vector3().crossVectors(z, x);
  return flatten(new THREE.Matrix4().makeBasis(x, y, z).setPosition(centroid));
};
const find = (captures: Capture[], side: Side): Capture =>
  captures.find((hand) => hand.side === side) as Capture;
const output = Object.fromEntries(
  (['left', 'right'] as const).map((side) => [
    side,
    {
      open: local(find(neutral, side)),
      fist: local(find(fists, side)),
      grip: grip(find(fists, side)),
    },
  ]),
);
const target = 'src/xr/standard-hand-controller-poses.json';
writeFileSync(target, `${JSON.stringify(output)}\n`);
spawnSync('bunx', ['biome', 'format', '--write', target]);
