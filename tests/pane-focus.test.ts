import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPaneFocus } from '../src/xr/pane-focus';

function pane(opacity = 0.8): { root: THREE.Group; mesh: THREE.Mesh } {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ opacity, transparent: true, depthWrite: false }),
  );
  root.add(mesh);
  return { root, mesh };
}

describe('pane focus', () => {
  it('retargets an active focus without jumping or replacing the original pose', () => {
    const focus = createPaneFocus();
    const { root } = pane();
    root.position.set(3, 2, -4);
    const original = root.position.clone();
    focus.enter('a', root, [root], new THREE.Vector3(0, 0, -2), new THREE.Quaternion());
    focus.update(0.25);
    const current = root.position.clone();
    focus.retarget(new THREE.Vector3(0, 0, -1.5), new THREE.Quaternion());
    expect(root.position).toEqual(current);
    focus.update(0.25);
    expect(root.position.z).toBe(-1.5);
    focus.exit(true);
    expect(root.position).toEqual(original);
    focus.dispose();
  });

  it('keeps the focus placement, finishing motion, and fades siblings back', () => {
    const focus = createPaneFocus();
    const { root } = pane();
    const { root: other } = pane();
    root.position.set(3, 2, -4);
    const target = new THREE.Vector3(0, 1.4, -1.5);
    focus.enter('a', root, [root, other], target, new THREE.Quaternion());
    focus.update(0.05);
    expect(other.userData.focusHidden).toBe(true);
    focus.keep();
    expect(focus.activeId).toBeNull();
    expect(root.position).toEqual(target);
    expect(focus.originalTransform(root)).toBeNull();
    for (let step = 0; step < 10; step++) focus.update(0.1);
    expect(root.position).toEqual(target);
    expect(other.visible).toBe(true);
    expect(other.userData.focusHidden).toBeUndefined();
    focus.dispose();
  });

  it('animates the focus root and restores its exact transform', () => {
    const focus = createPaneFocus();
    const { root } = pane();
    const original = {
      position: root.position.clone(),
      quaternion: root.quaternion.clone(),
      scale: root.scale.clone(),
    };
    const targetPosition = new THREE.Vector3(1, 2, 3);
    const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.1));
    focus.enter('a', root, [root], targetPosition, targetQuaternion);
    focus.update(0.125);
    expect(root.position.x).toBeGreaterThan(original.position.x);
    expect(root.position.x).toBeLessThan(targetPosition.x);
    focus.update(0.125);
    expect(root.position).toEqual(targetPosition);
    root.position.set(9, 9, 9);
    root.scale.set(3, 4, 5);
    focus.exit(true);
    expect(root.position).toEqual(original.position);
    expect(root.quaternion.x).toBeCloseTo(original.quaternion.x);
    expect(root.quaternion.y).toBeCloseTo(original.quaternion.y);
    expect(root.quaternion.z).toBeCloseTo(original.quaternion.z);
    expect(root.quaternion.w).toBeCloseTo(original.quaternion.w);
    expect(root.scale).toEqual(original.scale);
  });

  it('fades siblings, hides them at zero, and restores material flags', () => {
    const focus = createPaneFocus();
    const a = pane(0.7);
    const b = pane(0.6);
    focus.enter('a', a.root, [a.root, b.root], new THREE.Vector3(), new THREE.Quaternion());
    expect(b.root.userData.focusHidden).toBe(true);
    focus.update(0.1);
    expect((b.mesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(0.6);
    expect((b.mesh.material as THREE.MeshBasicMaterial).transparent).toBe(true);
    expect((b.mesh.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
    focus.update(0.2);
    expect(b.root.visible).toBe(false);
    focus.exit();
    expect(b.root.visible).toBe(true);
    focus.update(0.1);
    expect((b.mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    expect((b.mesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(0.6);
    focus.update(0.15);
    expect((b.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0.6);
    expect(b.root.userData.focusHidden).toBeUndefined();
  });

  it('keeps hidden descendants hidden and supports rapid re-entry and new panes', () => {
    const focus = createPaneFocus();
    const a = pane();
    const b = pane();
    const child = new THREE.Group();
    child.visible = false;
    b.root.add(child);
    focus.enter('a', a.root, [a.root, b.root], new THREE.Vector3(), new THREE.Quaternion());
    focus.exit();
    focus.enter('a', a.root, [a.root, b.root], new THREE.Vector3(2, 0, 0), new THREE.Quaternion());
    const c = pane();
    focus.add(c.root);
    focus.update(1);
    expect(c.root.visible).toBe(false);
    focus.remove(c.root);
    expect(c.root.visible).toBe(true);
    focus.exit(true);
    expect(child.visible).toBe(false);
    focus.dispose();
    expect(focus.activeId).toBeNull();
  });

  it('preserves material identity and opaque flags without revealing an originally hidden root', () => {
    const focus = createPaneFocus();
    const a = pane();
    const b = pane();
    const material = b.mesh.material as THREE.MeshBasicMaterial;
    material.transparent = false;
    material.depthWrite = true;
    b.root.visible = false;
    focus.enter('a', a.root, [a.root, b.root], new THREE.Vector3(), new THREE.Quaternion());
    focus.update(0.1);
    expect(b.mesh.material).toBe(material);
    expect(b.root.visible).toBe(false);
    focus.exit();
    focus.update(0.25);
    expect(b.root.visible).toBe(false);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.opacity).toBe(0.8);
    focus.dispose();
  });

  it('captures a new original pose when reentering during a previous fade-in', () => {
    const focus = createPaneFocus();
    const a = pane();
    const b = pane();
    focus.enter('a', a.root, [a.root, b.root], new THREE.Vector3(3, 0, 0), new THREE.Quaternion());
    focus.update(0.25);
    focus.exit();
    a.root.position.set(1, 2, 3);
    focus.enter('a', a.root, [a.root, b.root], new THREE.Vector3(4, 0, 0), new THREE.Quaternion());
    focus.update(0.1);
    focus.exit(true);
    expect(a.root.position).toEqual(new THREE.Vector3(1, 2, 3));
    expect((b.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0.8);
    expect(b.root.visible).toBe(true);
    focus.dispose();
  });
});
