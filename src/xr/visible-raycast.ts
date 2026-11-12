import type * as THREE from 'three';

const byDistance = (a: THREE.Intersection, b: THREE.Intersection): number =>
  a.distance - b.distance;

/**
 * `raycaster.intersectObjects(objects, true)` without descending into hidden or focus-hidden
 * subtrees. Callers still filter hits by every ancestor's visibility, so this drops only hits they
 * would reject, in three's own visit order and sort.
 */
export function intersectVisible(
  raycaster: THREE.Raycaster,
  objects: readonly THREE.Object3D[],
  target: THREE.Intersection[] = [],
): THREE.Intersection[] {
  const visit = (object: THREE.Object3D): void => {
    if (!object.visible || object.userData.focusHidden) return;
    let propagate = true;
    if (object.layers.test(raycaster.layers))
      propagate = (object.raycast(raycaster, target) as unknown) !== false;
    if (!propagate) return;
    const children = object.children;
    for (let i = 0; i < children.length; i++) visit(children[i]);
  };
  for (const object of objects) visit(object);
  return target.sort(byDistance);
}
