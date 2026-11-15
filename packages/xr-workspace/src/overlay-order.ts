import type * as THREE from 'three';

export const OVERLAY_RENDER_ORDER = 1000;

/**
 * Draws everything under `root` after the rest of the scene, including objects added later.
 * Returns a function that stops tracking additions; orders already set are left as they are.
 */
export function keepAbove(root: THREE.Object3D, order = OVERLAY_RENDER_ORDER): () => void {
  const tracked = new WeakSet<THREE.Object3D>();
  const listening: THREE.Object3D[] = [];
  const onChildAdded = (event: { child: THREE.Object3D }): void => raise(event.child);
  const raise = (object: THREE.Object3D): void => {
    object.traverse((node) => {
      if ((node as THREE.Group).isGroup) node.renderOrder = order;
      if (tracked.has(node)) return;
      tracked.add(node);
      node.addEventListener('childadded', onChildAdded);
      listening.push(node);
    });
  };
  raise(root);
  return () => {
    for (const node of listening) node.removeEventListener('childadded', onChildAdded);
    listening.length = 0;
  };
}
