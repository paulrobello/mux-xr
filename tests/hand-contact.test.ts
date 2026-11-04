import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createHandContact } from '../src/xr/hand-contact';
import { curveKeyboardContent } from '../src/xr/keyboard-surface';
import { createCurvedTerminalGeometry } from '../src/xr/terminal-warp';

function keyboard(name = 'keyboard'): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshBasicMaterial());
  backdrop.name = 'input-backdrop';
  backdrop.position.z = -0.006;
  root.add(backdrop);
  for (const [key, x] of [
    ['a', -0.06],
    ['b', 0.06],
  ] as const) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshBasicMaterial());
    mesh.userData.inputAction = 'key';
    mesh.userData.key = key;
    mesh.userData.labelWidth = 0.08;
    mesh.userData.labelHeight = 0.08;
    mesh.position.x = x;
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}

const p = (z: number, x = -0.06): THREE.Vector3 => new THREE.Vector3(x, 0, z);

describe('hand contact', () => {
  it('presses once, holds, releases, then accepts a new front poke', () => {
    const probe = createHandContact();
    const board = keyboard();
    expect(probe.sample(p(0.08), p(0.08), board, true).pressed).toBeNull();
    expect(probe.sample(p(-0.02), p(-0.02), board, true).pressed?.userData.key).toBe('a');
    expect(probe.pressed).toBe(true);
    expect(probe.sample(p(-0.01), p(-0.01), board, true).pressed).toBeNull();
    expect(probe.sample(p(0.08), p(0.08), board, true).released?.userData.key).toBe('a');
    expect(probe.sample(p(-0.02), p(-0.02), board, true).pressed?.userData.key).toBe('a');
  });

  it('rejects initial contact and backside entry, but detects a swept front path', () => {
    const probe = createHandContact();
    const board = keyboard();
    expect(probe.sample(p(0.004), p(0.004), board, true).pressed).toBeNull();
    probe.reset();
    expect(probe.sample(p(-0.02), p(-0.02), board, true).pressed).toBeNull();
    probe.reset();
    expect(probe.sample(p(0.08), p(0.08), board, true).pressed).toBeNull();
    expect(probe.sample(p(-0.04), p(-0.04), board, true).pressed?.userData.key).toBe('a');
  });

  it('does not repress when the keyboard root is replaced at identical key coordinates', () => {
    const probe = createHandContact();
    const first = keyboard();
    expect(probe.sample(p(0.08), p(0.08), first, true).pressed).toBeNull();
    expect(probe.sample(p(-0.02), p(-0.02), first, true).pressed).not.toBeNull();
    const replacement = keyboard();
    expect(probe.sample(p(-0.02), p(-0.02), replacement, true).pressed).toBeNull();
  });

  it('sweeps the finger pad into the first key crossed during a fast diagonal poke', () => {
    const probe = createHandContact();
    const board = keyboard();
    probe.sample(p(0.04, -0.06), p(0.04, -0.06), board, true);
    expect(probe.sample(p(-0.06, 0.06), p(-0.06, 0.06), board, true).pressed?.userData.key).toBe(
      'a',
    );
  });

  it('keeps disabled contact latched until withdrawal on a transformed board', () => {
    const probe = createHandContact();
    const board = keyboard();
    board.position.set(0.2, 0.1, -0.3);
    board.rotation.y = 0.35;
    board.scale.setScalar(1.4);
    board.updateMatrixWorld(true);
    const key = board.children[1] as THREE.Mesh;
    const center = key.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      key.getWorldQuaternion(new THREE.Quaternion()),
    );
    const front = center.clone().addScaledVector(normal, 0.08);
    const contact = center.clone().addScaledVector(normal, -0.01);
    expect(probe.sample(front, front, board, false).pressed).toBeNull();
    expect(probe.sample(contact, contact, board, true).pressed).toBeNull();
    probe.sample(front, front, board, true);
    expect(probe.sample(contact, contact, board, true).pressed?.userData.key).toBe('a');
  });

  it('uses the actual curved key surface for proximity and pressing', () => {
    const probe = createHandContact();
    const curved = keyboard('xr-keyboard-controls');
    (curved.children[0] as THREE.Mesh).geometry.dispose();
    (curved.children[0] as THREE.Mesh).geometry = createCurvedTerminalGeometry({
      width: 0.5,
      height: 0.3,
      radians: 0.6,
    });
    curveKeyboardContent(curved, 0.5, 0.6);
    const key = curved.children[1] as THREE.Mesh;
    const center = key.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      key.getWorldQuaternion(new THREE.Quaternion()),
    );
    const front = center.clone().addScaledVector(normal, 0.08);
    const contact = center.clone().addScaledVector(normal, 0.005);
    expect(probe.near(front, front, curved)).toBe(true);
    probe.sample(front, front, curved, true);
    expect(probe.sample(contact, contact, curved, true).pressed?.userData.key).toBe('a');
  });

  it('returns the actual visible grip owner and reset clears pressed state', () => {
    const probe = createHandContact();
    const owner = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial());
    owner.add(mesh);
    const collapsed = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    collapsed.scale.setScalar(0);
    owner.add(collapsed);
    owner.updateMatrixWorld(true);
    expect(probe.grip([{ point: new THREE.Vector3(), radius: 0.04 }], [owner])).toBe(owner);
    owner.visible = false;
    expect(probe.grip([{ point: new THREE.Vector3(), radius: 0.04 }], [owner])).toBeNull();
    const board = keyboard();
    probe.sample(p(0.08), p(0.08), board, true);
    probe.sample(p(-0.02), p(-0.02), board, true);
    expect(probe.pressed).toBe(true);
    probe.reset();
    expect(probe.pressed).toBe(false);
  });
});
