import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

const JOINTS = ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip'];

function poseFor(index: number, time: number): { matrix: Float32Array; radius: number } {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0.1 * index + time, 1.2 - 0.01 * index, -0.3 + 0.005 * time),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2 * index, time, -0.1 * index)),
    new THREE.Vector3(1, 1, 1),
  );
  return { matrix: new Float32Array(matrix.elements), radius: Math.fround(0.008 + index * 0.001) };
}

function rig(batch: boolean, tracked: (index: number) => boolean = () => true) {
  const controller = new THREE.WebXRController();
  const hand = controller.getHandSpace();
  controller.getTargetRaySpace();
  const spaces = JOINTS.map((jointName) => ({ jointName }) as unknown as XRJointSpace);
  const xrHand = new Map(JOINTS.map((name, index) => [name, spaces[index]]));
  const source = {
    handedness: 'right',
    hand: xrHand,
    targetRaySpace: { ray: true },
  } as unknown as XRInputSource;
  let time = 0;
  const frame = {
    session: { visibilityState: 'visible' },
    getJointPose: (space: XRJointSpace) => {
      const index = spaces.indexOf(space);
      if (!tracked(index)) return null;
      const pose = poseFor(index, time);
      return { transform: { matrix: pose.matrix }, radius: pose.radius };
    },
    getPose: () => ({ transform: { matrix: poseFor(9, time).matrix } }),
    ...(batch
      ? {
          fillPoses: (list: XRJointSpace[], _base: XRSpace, out: Float32Array) => {
            if (!list.every((space) => tracked(spaces.indexOf(space)))) return false;
            list.forEach((space, i) => {
              out.set(poseFor(spaces.indexOf(space), time).matrix, i * 16);
            });
            return true;
          },
          fillJointRadii: (list: XRJointSpace[], out: Float32Array) => {
            list.forEach((space, i) => {
              out[i] = poseFor(spaces.indexOf(space), time).radius;
            });
            return true;
          },
        }
      : {}),
  } as unknown as XRFrame;
  const events: string[] = [];
  hand.addEventListener('pinchstart', () => events.push('pinchstart'));
  hand.addEventListener('pinchend', () => events.push('pinchend'));
  const step = (at: number) => {
    time = at;
    controller.update(source, frame, {} as XRReferenceSpace);
  };
  return { controller, hand, step, events };
}

const state = (hand: THREE.XRHandSpace) =>
  JOINTS.map((name) => {
    const joint = hand.joints[name as XRHandJoint];
    return {
      visible: joint?.visible,
      matrix: joint?.matrix.elements.map((v) => Number(v.toFixed(6))),
      position: joint?.position.toArray().map((v) => Number(v.toFixed(6))),
      quaternion: joint?.quaternion.toArray().map((v) => Number(v.toFixed(6))),
      radius: joint?.jointRadius,
    };
  });

describe('batched hand poses', async () => {
  const { installBatchedHandPoses } = await import('../src/xr/batched-hand-poses');
  installBatchedHandPoses();

  it('leaves joints, hand visibility and the target ray as three does', () => {
    const batched = rig(true);
    const stock = rig(false);
    for (const at of [0, 0.5, 1.25]) {
      batched.step(at);
      stock.step(at);
      expect(state(batched.hand)).toEqual(state(stock.hand));
      expect(batched.hand.visible).toBe(true);
      expect(batched.controller.getTargetRaySpace().matrix.elements).toEqual(
        stock.controller.getTargetRaySpace().matrix.elements,
      );
    }
  });

  it('falls back to three per joint when a joint is untracked', () => {
    const batched = rig(true, (index) => index !== 2);
    const stock = rig(false, (index) => index !== 2);
    batched.step(0.3);
    stock.step(0.3);
    expect(state(batched.hand)).toEqual(state(stock.hand));
    expect(batched.hand.joints['index-finger-tip']?.visible).toBe(false);
  });

  it('still raises pinch events from the batched joints', () => {
    const batched = rig(true);
    const stock = rig(false);
    for (const at of [0, 0.5]) {
      batched.step(at);
      stock.step(at);
    }
    expect(batched.events).toEqual(stock.events);
  });
});
