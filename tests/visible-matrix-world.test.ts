import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { updateVisibleMatrixWorld } from '../src/xr/visible-matrix-world';

function tree() {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const shown = new THREE.Mesh();
  const hidden = new THREE.Group();
  const hiddenChild = new THREE.Mesh();
  const manual = new THREE.Group();
  manual.matrixAutoUpdate = false;
  const manualChild = new THREE.Mesh();
  manualChild.matrixAutoUpdate = false;
  hidden.visible = false;
  scene.add(root);
  root.add(shown, hidden, manual);
  hidden.add(hiddenChild);
  manual.add(manualChild);
  for (const [object, x] of [
    [root, 1],
    [shown, 2],
    [hidden, 3],
    [hiddenChild, 4],
    [manualChild, 5],
  ] as const) {
    object.position.set(x, x * 0.5, -x);
    object.rotation.set(0.1 * x, 0.2 * x, 0);
  }
  manualChild.updateMatrix();
  manual.matrix.makeTranslation(0.3, 0, 0);
  scene.updateMatrixWorld(true);
  return { scene, root, shown, hidden, hiddenChild, manual, manualChild };
}

describe('updateVisibleMatrixWorld', () => {
  it('matches a forced full update for every visible object', () => {
    const expected = tree();
    const actual = tree();
    for (const t of [expected, actual]) {
      t.root.position.x = 7;
      t.shown.rotation.z = 0.4;
      t.manual.matrix.makeTranslation(0, 0.9, 0);
    }
    expected.scene.updateMatrixWorld(true);
    updateVisibleMatrixWorld(actual.scene);
    for (const key of ['root', 'shown', 'manual', 'manualChild'] as const)
      expect(actual[key].matrixWorld.elements).toEqual(expected[key].matrixWorld.elements);
  });

  it('skips hidden subtrees and leaves them for the next normal pass', () => {
    const t = tree();
    const before = t.hiddenChild.matrixWorld.clone();
    t.root.position.x = 9;
    updateVisibleMatrixWorld(t.scene);
    expect(t.hiddenChild.matrixWorld.equals(before)).toBe(true);
    expect(t.hidden.matrixWorldNeedsUpdate).toBe(true);
    // The renderer's own unforced pass then catches the hidden subtree up.
    t.scene.updateMatrixWorld();
    const reference = tree();
    reference.root.position.x = 9;
    reference.scene.updateMatrixWorld(true);
    expect(t.hiddenChild.matrixWorld.elements).toEqual(reference.hiddenChild.matrixWorld.elements);
  });

  it('hands objects with their own updateMatrixWorld to that method', () => {
    const t = tree();
    let calls = 0;
    const custom = new (class extends THREE.Group {
      override updateMatrixWorld(force?: boolean): void {
        calls++;
        super.updateMatrixWorld(force);
      }
    })();
    const child = new THREE.Mesh();
    child.position.x = 2;
    custom.add(child);
    t.root.add(custom);
    updateVisibleMatrixWorld(t.scene);
    expect(calls).toBe(1);
    const expected = new THREE.Matrix4().multiplyMatrices(custom.matrixWorld, child.matrix);
    expect(child.matrixWorld.elements).toEqual(expected.elements);
    expect(custom.matrixWorld.elements).toEqual(t.root.matrixWorld.elements);
  });
});
