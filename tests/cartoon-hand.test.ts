import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createCartoonHand } from '../src/xr/cartoon-hand';

type Hand = THREE.Group & { joints: Record<string, THREE.Group> };

function trackedHand(side: 'left' | 'right'): Hand {
  const hand = new THREE.Group() as Hand;
  hand.joints = {};
  const add = (name: string, x: number, y: number): void => {
    const joint = new THREE.Group();
    joint.position.set(
      (side === 'left' ? 1 : -1) * x + (side === 'left' ? -0.22 : 0.22),
      1.2 + y,
      -0.6,
    );
    hand.joints[name] = joint;
    hand.add(joint);
  };
  add('wrist', 0, 0);
  for (const [index, part] of ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'].entries())
    add(`thumb-${part}`, [0.035, 0.055, 0.075, 0.09][index], [0.018, 0.03, 0.045, 0.06][index]);
  for (const [finger, x, length] of [
    ['index-finger', 0.03, 0.16],
    ['middle-finger', 0, 0.18],
    ['ring-finger', -0.028, 0.16],
    ['pinky-finger', -0.052, 0.13],
  ] as const)
    for (const [index, part] of [
      'metacarpal',
      'phalanx-proximal',
      'phalanx-intermediate',
      'phalanx-distal',
      'tip',
    ].entries())
      add(`${finger}-${part}`, x, length * [0.17, 0.47, 0.67, 0.85, 1][index]);
  return hand;
}

describe('cartoon tracked hands', () => {
  it('curls index on trigger, preserves index on grip and thumb button presses, and reuses skin buffers', () => {
    const visual = createCartoonHand();
    const pose = new THREE.Group();
    pose.position.set(0.2, 1.3, -0.55);
    const camera = new THREE.PerspectiveCamera();
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }));
    const pad = { buttons } as unknown as Gamepad;
    const skin = visual.root.getObjectByName('cartoon-hand-skin') as THREE.Mesh;
    const positions = skin.geometry.getAttribute('position');
    visual.updateController(pose, camera, 'right', pad, 1);
    const open = Array.from(positions.array);
    const tip = (visual.root.userData.indexTip as THREE.Vector3).clone();
    buttons[0].value = 1;
    visual.updateController(pose, camera, 'right', pad, 1);
    expect((visual.root.userData.indexTip as THREE.Vector3).distanceTo(tip)).toBeGreaterThan(0.03);
    expect(skin.geometry.getAttribute('position')).toBe(positions);
    buttons[0].value = 0;
    buttons[1].value = 1;
    visual.updateController(pose, camera, 'right', pad, 1);
    expect((visual.root.userData.indexTip as THREE.Vector3).distanceTo(tip)).toBeLessThan(1e-6);
    expect(Array.from(positions.array)).not.toEqual(open);
    buttons[1].value = 0;
    buttons[4].value = 1;
    visual.updateController(pose, camera, 'right', pad, 1);
    expect((visual.root.userData.indexTip as THREE.Vector3).distanceTo(tip)).toBeLessThan(1e-6);
    expect(Array.from(positions.array)).not.toEqual(open);
    visual.dispose();
  });
  it('uses rounded opaque orange skin and a continuous arm without any picking surfaces', () => {
    const visual = createCartoonHand();
    visual.update(trackedHand('right'), new THREE.PerspectiveCamera(), 'right', 1 / 90);
    expect(visual.root.visible).toBe(true);
    const meshes = visual.root.children as THREE.Mesh[];
    expect(meshes).toHaveLength(2);
    expect((meshes[0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff672f);
    expect((meshes[0].material as THREE.MeshStandardMaterial).transparent).toBe(false);
    for (const mesh of meshes) {
      expect(mesh.raycast).not.toBe(THREE.Mesh.prototype.raycast);
      const positions = mesh.geometry.getAttribute('position');
      expect(positions.count).toBeLessThan(1500);
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    }
    visual.dispose();
  });

  it('maintains distinct camera-relative shoulder anchors through translation, yaw and pitch', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(2, 1.7, -3);
    camera.rotation.set(0.3, Math.PI / 2, 0.1);
    const left = createCartoonHand();
    const right = createCartoonHand();
    left.update(trackedHand('left'), camera, 'left', 0.016);
    right.update(trackedHand('right'), camera, 'right', 0.016);
    const rotation = camera.getWorldQuaternion(new THREE.Quaternion());
    const expected = new THREE.Vector3(-0.2, -0.18, -0.04)
      .applyQuaternion(rotation)
      .add(camera.position);
    expect((left.root.userData.armAnchor as THREE.Vector3).distanceTo(expected)).toBeLessThan(1e-8);
    expect(
      (left.root.userData.armAnchor as THREE.Vector3).distanceTo(right.root.userData.armAnchor),
    ).toBeCloseTo(0.4);
    left.dispose();
    right.dispose();
  });

  it('deforms from tracked finger poses in reused buffers without modifying the tracked joints', () => {
    const hand = trackedHand('left');
    const visual = createCartoonHand();
    const camera = new THREE.PerspectiveCamera();
    visual.update(hand, camera, 'left', 0.016);
    const skin = visual.root.getObjectByName('cartoon-hand-skin') as THREE.Mesh;
    const attribute = skin.geometry.getAttribute('position');
    const before = Array.from(attribute.array);
    hand.joints['index-finger-tip'].position.z += 0.06;
    const position = hand.joints['index-finger-tip'].position.clone();
    visual.update(hand, camera, 'left', 0.016);
    expect(skin.geometry.getAttribute('position')).toBe(attribute);
    expect(Array.from(attribute.array)).not.toEqual(before);
    expect(hand.joints['index-finger-tip'].position.equals(position)).toBe(true);
    visual.dispose();
  });

  it('hides on tracking loss and disposes its material and geometry once', () => {
    const hand = trackedHand('right');
    const visual = createCartoonHand();
    const skin = visual.root.getObjectByName('cartoon-hand-skin') as THREE.Mesh;
    const material = skin.material as THREE.Material;
    const materialDispose = vi.spyOn(material, 'dispose');
    const geometryDispose = vi.spyOn(skin.geometry, 'dispose');
    visual.update(hand, new THREE.PerspectiveCamera(), 'right', 0.016);
    hand.joints.wrist.visible = false;
    visual.update(hand, new THREE.PerspectiveCamera(), 'right', 0.016);
    expect(visual.root.visible).toBe(false);
    visual.dispose();
    visual.dispose();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
    visual.update(hand, new THREE.PerspectiveCamera(), 'right', 0.016);
    expect(visual.root.visible).toBe(false);
  });
});
