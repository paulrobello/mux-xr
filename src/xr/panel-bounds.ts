import * as THREE from 'three';

export interface PanelBounds {
  size: { width: number; height: number };
  center: THREE.Vector3;
}

/**
 * Measures the geometry below a panel in the panel's own coordinate frame.
 * The root transform is intentionally removed so prior placement does not
 * change the measured dimensions.
 */
export function measurePanelBounds(root: THREE.Object3D): PanelBounds {
  root.updateWorldMatrix(true, true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bounds = new THREE.Box3().makeEmpty();

  root.traverse((object) => {
    // Troika creates glyph meshes below the label's plane. The plane is the
    // fitted, stable label bounds and the glyph geometry can lag its sync.
    if (object !== root && object.parent?.userData.labelTextObject === object) return;

    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;

    const relativeMatrix = rootInverse.clone().multiply(object.matrixWorld);
    bounds.union(geometry.boundingBox.clone().applyMatrix4(relativeMatrix));
  });

  if (bounds.isEmpty()) {
    return { size: { width: 0, height: 0 }, center: new THREE.Vector3() };
  }

  const size = bounds.getSize(new THREE.Vector3());
  return {
    size: {
      width: size.x * Math.abs(root.scale.x),
      height: size.y * Math.abs(root.scale.y),
    },
    center: bounds.getCenter(new THREE.Vector3()),
  };
}
