import * as THREE from 'three';

const baseUpdateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;

/**
 * `object.updateMatrixWorld(true)` for the visible part of the graph only. Hidden subtrees keep
 * their matrices and are flagged, so the renderer's own pass, or the next full one, recomputes them.
 * Code that reads a hidden object's `matrixWorld` before render must update it itself, as
 * `getWorldPosition` and `Box3.setFromObject` already do. Objects that override `updateMatrixWorld`
 * (cameras, troika batches) get their own method for their subtree.
 */
export function updateVisibleMatrixWorld(object: THREE.Object3D): void {
  if (object.updateMatrixWorld !== baseUpdateMatrixWorld) {
    object.updateMatrixWorld(true);
    return;
  }
  if (object.matrixAutoUpdate) object.updateMatrix();
  if (object.matrixWorldAutoUpdate) {
    if (object.parent === null) object.matrixWorld.copy(object.matrix);
    else object.matrixWorld.multiplyMatrices(object.parent.matrixWorld, object.matrix);
  }
  object.matrixWorldNeedsUpdate = false;
  const children = object.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.visible) updateVisibleMatrixWorld(child);
    else child.matrixWorldNeedsUpdate = true;
  }
}
