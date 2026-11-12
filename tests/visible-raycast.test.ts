import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { intersectVisible } from '../src/xr/visible-raycast';

function shown(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (!node.visible || node.userData.focusHidden) return false;
  return true;
}

function forest(seed: number) {
  let state = seed;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const scene = new THREE.Scene();
  const roots: THREE.Object3D[] = [];
  const grow = (parent: THREE.Object3D, depth: number): void => {
    for (let i = 0; i < 3; i++) {
      const node =
        random() < 0.6
          ? new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial())
          : new THREE.Group();
      node.position.set(random() - 0.5, random() - 0.5, -random() * 2);
      node.visible = random() > 0.25;
      if (random() < 0.1) node.userData.focusHidden = true;
      parent.add(node);
      if (depth < 3) grow(node, depth + 1);
    }
  };
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group();
    root.visible = i !== 2;
    scene.add(root);
    roots.push(root);
    grow(root, 0);
  }
  scene.updateMatrixWorld(true);
  return { roots };
}

describe('intersectVisible', () => {
  it('matches three with hidden hits filtered out, in the same order', () => {
    const raycaster = new THREE.Raycaster();
    let compared = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { roots } = forest(seed);
      for (let x = -0.6; x <= 0.6; x += 0.2)
        for (let y = -0.6; y <= 0.6; y += 0.2) {
          raycaster.set(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1));
          const expected = raycaster
            .intersectObjects(roots, true)
            .filter((hit) => shown(hit.object));
          const actual = intersectVisible(raycaster, roots).filter((hit) => shown(hit.object));
          expect(actual.map((hit) => [hit.object.id, hit.distance])).toEqual(
            expected.map((hit) => [hit.object.id, hit.distance]),
          );
          compared += expected.length;
        }
    }
    expect(compared).toBeGreaterThan(100);
  });
});
