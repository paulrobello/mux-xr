import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createStandardHand,
  STANDARD_HAND_ASSET_URLS,
  STANDARD_HAND_JOINTS,
} from '../src/xr/standard-hand';
import {
  WRIST_WATCH_EXTENT,
  WRIST_WATCH_NEAR_EXIT_GAP,
  WRIST_WATCH_PROBE_REACH,
} from '../src/xr/wrist-menu-watch';

type Side = 'left' | 'right';
type Capture = { side: Side; joints: Record<string, { matrix: number[] }> };
const bytes = (side: Side): ArrayBuffer =>
  new Uint8Array(readFileSync(`public/assets/xr-hands/${side}.glb`)).slice().buffer;
const gestures = JSON.parse(readFileSync('tests/fixtures/quest-gesture-poses.json', 'utf8')) as {
  sets: Record<string, { hands: (Capture & { rawTrackedThumbIndexDistance?: number })[] }>;
};
const neutral = JSON.parse(readFileSync('tests/fixtures/quest-hand-poses.json', 'utf8')) as {
  hands: Capture[];
};

function parsedLoader(): GLTFLoader {
  return {
    loadAsync: (url: string) =>
      new GLTFLoader().parseAsync(bytes(url.includes('right') ? 'right' : 'left'), ''),
  } as unknown as GLTFLoader;
}
function failingLoader(): GLTFLoader {
  return { loadAsync: () => Promise.reject(new Error('offline')) } as unknown as GLTFLoader;
}
// Captured joints placed under a hand group that sits away from the origin and turned, as a
// tracked XRHand does in the room.
function poseSource(capture: Capture): THREE.Group & { joints: Record<string, THREE.Group> } {
  const source = new THREE.Group() as THREE.Group & { joints: Record<string, THREE.Group> };
  source.position.set(0.3, 1.2, -0.4);
  source.rotation.set(0.2, -0.7, 0.1);
  source.joints = {};
  for (const [name, entry] of Object.entries(capture.joints)) {
    const joint = new THREE.Group();
    new THREE.Matrix4()
      .fromArray(entry.matrix)
      .decompose(joint.position, joint.quaternion, joint.scale);
    source.joints[name] = joint;
    source.add(joint);
  }
  source.updateMatrixWorld(true);
  return source;
}
const visibleSkin = (hand: { root: THREE.Group }, side: Side): THREE.SkinnedMesh =>
  hand.root.getObjectByName(`standard-hand-skin-${side}`) as THREE.SkinnedMesh;

describe('standard XR hand', () => {
  it('serves the vendored generic-hand meshes under content-hash URLs', () => {
    for (const side of ['left', 'right'] as const) {
      const hash = createHash('sha256')
        .update(readFileSync(`public/assets/xr-hands/${side}.glb`))
        .digest('hex');
      expect(STANDARD_HAND_ASSET_URLS[side]).toBe(
        `/assets/xr-hands/${side}.glb?v=${hash.slice(0, 12)}`,
      );
    }
  });

  it('loads both sides with every WebXR joint as a bone', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    expect(await hand.assetReady).toBe(true);
    expect(hand.root.userData.handAsset).toBe('loaded');
    for (const side of ['left', 'right'] as const) {
      const skin = visibleSkin(hand, side);
      expect(skin.frustumCulled).toBe(false);
      expect(skin.skeleton.bones.map((bone) => bone.name).sort()).toEqual(
        [...STANDARD_HAND_JOINTS].sort(),
      );
    }
    hand.dispose();
  });

  it.each([
    ...gestures.sets['captured-pinch'].hands,
    ...gestures.sets['captured-fist'].hands,
    ...gestures.sets['captured-thumb-slide'].hands,
  ])('puts every $side bone on its tracked joint', async (capture) => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const source = poseSource(capture);
    hand.update(source, new THREE.PerspectiveCamera(), capture.side, 1 / 60);
    const skin = visibleSkin(hand, capture.side);
    const bone = new THREE.Vector3();
    const joint = new THREE.Vector3();
    const boneTurn = new THREE.Quaternion();
    const jointTurn = new THREE.Quaternion();
    for (const name of STANDARD_HAND_JOINTS) {
      const target = skin.skeleton.getBoneByName(name) as THREE.Bone;
      target.getWorldPosition(bone);
      source.joints[name].getWorldPosition(joint);
      expect(bone.distanceTo(joint)).toBeLessThan(1e-6);
      target.getWorldQuaternion(boneTurn);
      source.joints[name].getWorldQuaternion(jointTurn);
      // Averaged captures are not exactly orthonormal, so decomposing twice differs by < 0.04 deg.
      expect(boneTurn.angleTo(jointTurn)).toBeLessThan(7e-4);
    }
    expect(skin.parent?.parent?.visible || skin.parent?.visible).toBe(true);
    hand.dispose();
  });

  it('closes the captured pinch with the Keyborb point between the tracked tips', async () => {
    for (const capture of gestures.sets['captured-pinch'].hands) {
      const hand = createStandardHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = poseSource(capture);
      hand.update(source, new THREE.PerspectiveCamera(), capture.side, 1 / 60);
      const index = source.joints['index-finger-tip'].getWorldPosition(new THREE.Vector3());
      const thumb = source.joints['thumb-tip'].getWorldPosition(new THREE.Vector3());
      const point = hand.root.userData.keyborbPoint as THREE.Vector3;
      expect(point.distanceTo(index.clone().add(thumb).multiplyScalar(0.5))).toBeLessThan(1e-6);
      expect((hand.root.userData.indexTip as THREE.Vector3).distanceTo(index)).toBeLessThan(1e-6);
      expect((hand.root.userData.thumbTip as THREE.Vector3).distanceTo(thumb)).toBeLessThan(1e-6);
      expect(index.distanceTo(thumb)).toBeLessThan(0.02);
      hand.dispose();
    }
  });

  it.each([
    ...neutral.hands,
    ...gestures.sets['captured-pinch'].hands,
    ...gestures.sets['captured-fist'].hands,
  ])(
    'caps the $side forearm cut with a wrist-bone ellipse that sits on the skinned ring',
    async (capture) => {
      const hand = createStandardHand({ loader: parsedLoader() });
      await hand.assetReady;
      const source = poseSource(capture);
      hand.update(source, new THREE.PerspectiveCamera(), capture.side, 1 / 60);
      const skin = visibleSkin(hand, capture.side);
      const cap = hand.root.getObjectByName(
        `standard-hand-wrist-cap-${capture.side}`,
      ) as THREE.Mesh;
      expect(cap.parent).toBe(skin.skeleton.getBoneByName('wrist'));
      // Its own copy: one material across skinned and unskinned meshes churns three's programs.
      const capMaterial = cap.material as THREE.MeshStandardMaterial;
      const skinMaterial = skin.material as THREE.MeshStandardMaterial;
      expect(capMaterial).not.toBe(skinMaterial);
      expect(capMaterial.color.getHex()).toBe(skinMaterial.color.getHex());
      expect(capMaterial.emissive.getHex()).toBe(skinMaterial.emissive.getHex());
      expect(capMaterial.emissiveIntensity).toBe(skinMaterial.emissiveIntensity);
      const toCap = cap.matrixWorld.clone().invert();
      const point = new THREE.Vector3();
      const rim: number[] = [];
      let outermost = Number.NEGATIVE_INFINITY;
      const vertices = skin.geometry.getAttribute('position').count;
      for (let vertex = 0; vertex < vertices; vertex++) {
        skin.getVertexPosition(vertex, point).applyMatrix4(skin.matrixWorld).applyMatrix4(toCap);
        // Cap-local units: x and y are scaled by the semi-axes, z by the cap depth.
        const z = point.z * cap.scale.z;
        outermost = Math.max(outermost, z);
        if (z > -0.003) rim.push(Math.hypot(point.x, point.y));
      }
      // No skin pokes past the cut plane, and every vertex at the cut lies on the cap's rim.
      expect(outermost).toBeLessThan(0.001);
      expect(rim.length).toBeGreaterThanOrEqual(30);
      expect(Math.min(...rim)).toBeGreaterThan(0.8);
      expect(Math.max(...rim)).toBeLessThan(1);
      // The domed face points down the forearm, away from the fingers.
      const outward = new THREE.Vector3(0, 0, 1).transformDirection(cap.matrixWorld);
      const fingers = source.joints['middle-finger-phalanx-proximal']
        .getWorldPosition(new THREE.Vector3())
        .sub(cap.getWorldPosition(new THREE.Vector3()));
      expect(outward.dot(fingers.normalize())).toBeLessThan(-0.8);
      hand.dispose();
    },
  );

  it('samples finite contact probes from the posed skin', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const capture = neutral.hands[1];
    const source = poseSource(capture);
    hand.update(source, new THREE.PerspectiveCamera(), capture.side, 1 / 60);
    const probes = hand.contactProbes;
    expect(probes.length).toBeGreaterThan(40);
    const wrist = source.joints.wrist.getWorldPosition(new THREE.Vector3());
    for (const probe of probes) {
      expect(probe.point.toArray().every(Number.isFinite)).toBe(true);
      expect(probe.point.distanceTo(wrist)).toBeLessThan(0.25);
    }
    hand.dispose();
  });

  it('skins contact probes only when they are read after a new pose', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const capture = neutral.hands[1];
    const source = poseSource(capture);
    const skinned = vi.spyOn(THREE.SkinnedMesh.prototype, 'getVertexPosition');
    try {
      hand.update(source, new THREE.PerspectiveCamera(), capture.side, 1 / 60);
      expect(skinned).not.toHaveBeenCalled();
      const count = hand.contactProbes.length;
      expect(skinned).toHaveBeenCalledTimes(count);
      const before = hand.contactProbes[0].point.clone();
      expect(skinned).toHaveBeenCalledTimes(count);
      source.position.x += 0.1;
      source.updateMatrixWorld(true);
      hand.update(source, new THREE.PerspectiveCamera(), capture.side, 1 / 60);
      expect(hand.contactProbes[0].point.x - before.x).toBeCloseTo(0.1, 6);
      expect(skinned).toHaveBeenCalledTimes(count * 2);
    } finally {
      skinned.mockRestore();
      hand.dispose();
    }
  });

  it.each([
    ['standard', parsedLoader],
    ['cartoon fallback', failingLoader],
  ] as const)(
    'keeps every %s hand contact probe within the wrist watch reach of the palm',
    async (_, loader) => {
      const hand = createStandardHand({ loader: loader() });
      await hand.assetReady;
      let farthest = 0;
      const measure = (): void => {
        const palm = hand.root.userData.palmPosition as THREE.Vector3;
        for (const probe of hand.contactProbes)
          farthest = Math.max(farthest, probe.point.distanceTo(palm) + probe.radius);
      };
      const captures = [
        ...neutral.hands,
        ...Object.values(gestures.sets).flatMap((set) => set.hands),
      ];
      for (const capture of captures) {
        hand.update(poseSource(capture), new THREE.PerspectiveCamera(), capture.side, 1 / 60);
        measure();
      }
      const pose = new THREE.Group();
      pose.position.set(0.1, 1.2, -0.4);
      pose.rotation.set(0.5, -0.3, 0.2);
      pose.updateMatrixWorld(true);
      for (const value of [0, 0.5, 1]) {
        const gamepad = {
          buttons: Array.from({ length: 6 }, () => ({ value, pressed: value > 0 })),
        } as unknown as Gamepad;
        for (const side of ['left', 'right'] as const)
          for (let frame = 0; frame < 60; frame++) {
            hand.updateController(pose, new THREE.PerspectiveCamera(), side, gamepad, 1 / 30);
            measure();
          }
      }
      expect(farthest).toBeGreaterThan(0.05);
      expect(farthest).toBeLessThan(
        WRIST_WATCH_PROBE_REACH - WRIST_WATCH_EXTENT - WRIST_WATCH_NEAR_EXIT_GAP,
      );
      hand.dispose();
    },
  );

  it('shows only the model for the side it is updated as and hides on tracking loss', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const left = hand.root.getObjectByName('standard-hand-root-left') as THREE.Object3D;
    const right = hand.root.getObjectByName('standard-hand-root-right') as THREE.Object3D;
    const camera = new THREE.PerspectiveCamera();
    hand.update(poseSource(neutral.hands[0]), camera, 'left', 1 / 60);
    expect([left.visible, right.visible]).toEqual([true, false]);
    hand.update(poseSource(neutral.hands[1]), camera, 'right', 1 / 60);
    expect([left.visible, right.visible]).toEqual([false, true]);
    const lost = poseSource(neutral.hands[1]);
    lost.visible = false;
    hand.update(lost, camera, 'right', 1 / 60);
    expect(hand.root.visible).toBe(false);
    expect(hand.root.userData.keyborbPoint).toBeUndefined();
    hand.dispose();
  });

  it('curls only the digit its controller input drives', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const pose = new THREE.Group();
    pose.position.set(0.2, 1.1, -0.3);
    pose.rotation.set(-0.4, 0.3, 0);
    pose.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera();
    const settle = (pressed: number[]): Record<string, THREE.Vector3> => {
      const gamepad = {
        buttons: Array.from({ length: 6 }, (_, index) => ({
          value: pressed.includes(index) ? 1 : 0,
          pressed: pressed.includes(index),
        })),
      } as unknown as Gamepad;
      for (let frame = 0; frame < 60; frame++)
        hand.updateController(pose, camera, 'right', gamepad, 1 / 30);
      const skin = visibleSkin(hand, 'right');
      return Object.fromEntries(
        ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'wrist'].map((name) => [
          name,
          (skin.skeleton.getBoneByName(name) as THREE.Bone).getWorldPosition(new THREE.Vector3()),
        ]),
      );
    };
    const open = settle([]);
    const trigger = settle([0]);
    const grip = settle([1]);
    const button = settle([4]);
    const moved = (a: Record<string, THREE.Vector3>, b: Record<string, THREE.Vector3>) =>
      Object.fromEntries(Object.keys(a).map((name) => [name, a[name].distanceTo(b[name])]));
    expect(moved(open, trigger)['index-finger-tip']).toBeGreaterThan(0.03);
    expect(moved(open, trigger)['middle-finger-tip']).toBeLessThan(1e-4);
    expect(moved(open, grip)['middle-finger-tip']).toBeGreaterThan(0.03);
    expect(moved(open, grip)['index-finger-tip']).toBeLessThan(1e-4);
    expect(moved(open, button)['thumb-tip']).toBeGreaterThan(0.01);
    expect(moved(open, button)['index-finger-tip']).toBeLessThan(1e-4);
    // A curled finger closes toward the wrist.
    expect(grip['middle-finger-tip'].distanceTo(grip.wrist)).toBeLessThan(
      open['middle-finger-tip'].distanceTo(open.wrist),
    );
    expect(hand.root.userData.keyborbPoint).toBeInstanceOf(THREE.Vector3);
    hand.dispose();
  });

  it('keeps every bone length through a half-pressed trigger, grip and face button', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const pose = new THREE.Group();
    pose.position.set(-0.2, 1.1, -0.3);
    pose.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera();
    const lengths = (value: number): number[] => {
      const gamepad = {
        buttons: Array.from({ length: 6 }, () => ({ value, pressed: value > 0 })),
      } as unknown as Gamepad;
      for (let frame = 0; frame < 60; frame++)
        hand.updateController(pose, camera, 'left', gamepad, 1 / 30);
      const skin = visibleSkin(hand, 'left');
      const at = (name: string): THREE.Vector3 =>
        (skin.skeleton.getBoneByName(name) as THREE.Bone).getWorldPosition(new THREE.Vector3());
      return STANDARD_HAND_JOINTS.slice(1).map((name, index) =>
        at(name).distanceTo(
          at(name.endsWith('-metacarpal') ? 'wrist' : STANDARD_HAND_JOINTS[index]),
        ),
      );
    };
    const open = lengths(0);
    for (const value of [0.25, 0.5, 0.75, 1])
      lengths(value).forEach((length, index) => {
        expect(Math.abs(length - open[index])).toBeLessThan(1e-4);
      });
    hand.dispose();
  });

  it.each(['left', 'right'] as const)(
    'wraps the $0 fist around the WebXR grip origin with the back of the hand outward',
    async (side) => {
      const hand = createStandardHand({ loader: parsedLoader() });
      await hand.assetReady;
      const pose = new THREE.Group();
      pose.position.set(0.1, 1.2, -0.4);
      pose.rotation.set(0.5, -0.3, 0.2);
      pose.updateMatrixWorld(true);
      const gamepad = {
        buttons: Array.from({ length: 6 }, () => ({ value: 1, pressed: true })),
      } as unknown as Gamepad;
      for (let frame = 0; frame < 60; frame++)
        hand.updateController(pose, new THREE.PerspectiveCamera(), side, gamepad, 1 / 30);
      const skin = visibleSkin(hand, side);
      const at = (name: string): THREE.Vector3 =>
        (skin.skeleton.getBoneByName(name) as THREE.Bone).getWorldPosition(new THREE.Vector3());
      const centroid = new THREE.Vector3();
      for (const finger of ['index', 'middle', 'ring', 'pinky'])
        for (const part of ['proximal', 'intermediate', 'distal'])
          centroid.add(at(`${finger}-finger-phalanx-${part}`));
      centroid.divideScalar(12);
      expect(centroid.distanceTo(pose.position)).toBeLessThan(0.01);
      // Grip +X points out of the back of the right hand, -X out of the back of the left.
      const local = (point: THREE.Vector3): THREE.Vector3 => pose.worldToLocal(point.clone());
      const knuckles = local(at('middle-finger-phalanx-proximal'));
      const fingertips = local(at('middle-finger-phalanx-intermediate'));
      expect(Math.sign(knuckles.x - fingertips.x)).toBe(side === 'right' ? 1 : -1);
      // +Y points toward the arm, -Z toward the thumb.
      expect(local(at('wrist')).y).toBeGreaterThan(0.03);
      expect(local(at('index-finger-phalanx-proximal')).z).toBeLessThan(
        local(at('pinky-finger-phalanx-proximal')).z,
      );
      hand.dispose();
    },
  );

  it('drops the Keyborb point while a thumb or index joint is untracked', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const source = poseSource(neutral.hands[0]);
    source.joints['thumb-phalanx-distal'].visible = false;
    hand.update(source, new THREE.PerspectiveCamera(), 'left', 1 / 60);
    expect(hand.root.visible).toBe(true);
    expect(hand.root.userData.keyborbPoint).toBeUndefined();
    hand.dispose();
  });

  it('keeps an untracked fingertip off the stale bone when the hand moves', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const source = poseSource(neutral.hands[0]);
    const camera = new THREE.PerspectiveCamera();
    hand.update(source, camera, 'left', 1 / 60);
    source.joints['index-finger-tip'].visible = false;
    source.position.x += 0.5;
    source.updateMatrixWorld(true);
    hand.update(source, camera, 'left', 1 / 60);
    const distal = source.joints['index-finger-phalanx-distal'].getWorldPosition(
      new THREE.Vector3(),
    );
    expect((hand.root.userData.indexTip as THREE.Vector3).distanceTo(distal)).toBeLessThan(0.05);
    hand.dispose();
  });

  it('tints both hands, wrist caps and the arm, and restores the model color', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    hand.setColor('#3366ff');
    await hand.assetReady;
    const tinted = (): THREE.MeshStandardMaterial[] => {
      const materials: THREE.MeshStandardMaterial[] = [];
      for (const name of [
        'standard-hand-skin-left',
        'standard-hand-skin-right',
        'standard-hand-wrist-cap-left',
        'standard-hand-wrist-cap-right',
        'elastic-hand-arm',
      ]) {
        const mesh = hand.root.getObjectByName(name) as THREE.Mesh;
        materials.push(mesh.material as THREE.MeshStandardMaterial);
      }
      return materials;
    };
    const blue = new THREE.Color('#3366ff').getHex();
    for (const material of tinted()) {
      expect(material.color.getHex()).toBe(blue);
      expect(material.emissive.getHex()).toBe(blue);
    }
    hand.setColor(null);
    const [skin, ...rest] = tinted();
    expect(skin.color.getHex()).not.toBe(blue);
    for (const material of rest) expect(material.color.getHex()).toBe(skin.color.getHex());
    hand.dispose();
  });

  it('tints the cartoon fallback and its arm when the meshes cannot load', async () => {
    const hand = createStandardHand({ loader: failingLoader() });
    await hand.assetReady;
    hand.setColor('#22aa44');
    const arm = hand.root.getObjectByName('elastic-hand-arm') as THREE.Mesh;
    const material = arm.material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(0x22aa44);
    hand.setColor(null);
    expect(material.color.getHex()).toBe(0xff672f);
    hand.dispose();
  });

  it('falls back to the cartoon hand when the meshes cannot load', async () => {
    const hand = createStandardHand({ loader: failingLoader() });
    expect(await hand.assetReady).toBe(false);
    expect(hand.root.userData.handAsset).toBe('fallback');
    const capture = neutral.hands[0];
    hand.update(poseSource(capture), new THREE.PerspectiveCamera(), capture.side, 1 / 60);
    expect(hand.root.getObjectByName('cartoon-hand-skin')?.visible).toBe(true);
    expect(hand.contactProbes.length).toBeGreaterThan(0);
    hand.dispose();
  });

  it('frees the loaded meshes on dispose, including a load that finishes afterwards', async () => {
    const hand = createStandardHand({ loader: parsedLoader() });
    await hand.assetReady;
    const skin = visibleSkin(hand, 'left');
    let disposed = 0;
    skin.geometry.addEventListener('dispose', () => disposed++);
    hand.dispose();
    expect(disposed).toBe(1);
    const late = createStandardHand({ loader: parsedLoader() });
    late.dispose();
    expect(await late.assetReady).toBe(false);
  });
});
