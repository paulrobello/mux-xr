import type * as THREE from 'three';

/** Marks an object as a control an automated check can find by id. Also sets `name`. */
export function setControlId<T extends THREE.Object3D>(object: T, id: string): T {
  object.name = id;
  object.userData.controlId = id;
  return object;
}

/** First object under `root` (inclusive, depth-first) whose control id is `id`. */
export function findControl(root: THREE.Object3D, id: string): THREE.Object3D | undefined {
  if (root.userData.controlId === id) return root;
  for (const child of root.children) {
    const found = findControl(child, id);
    if (found) return found;
  }
  return undefined;
}

/** The control id of `object` or its nearest ancestor that has one, stopping at `root`. */
export function controlIdOf(object: THREE.Object3D, root?: THREE.Object3D): string | null {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const id = node.userData.controlId;
    if (typeof id === 'string') return id;
    if (node === root) break;
  }
  return null;
}
