import * as THREE from 'three';

export function createScalableLabel(label: string, width: number, height: number): THREE.Mesh {
  const root = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial(),
  );
  Object.assign(root.userData, {
    labelText: label,
    labelWidth: width,
    labelHeight: height,
    disposeLabel: () => {
      root.geometry.dispose();
      root.material.dispose();
    },
  });
  return root;
}

export function updateScalableLabel(root: THREE.Mesh, label: string): void {
  root.userData.labelText = label;
}
export function disposeScalableLabel(root: THREE.Object3D): void {
  root.userData.disposeLabel?.();
}
