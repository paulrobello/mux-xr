import type * as THREE from 'three';
import { disposeScalableLabel } from './labels';

export interface SpatialWidget {
  root: THREE.Group;
  update(nowMs: number): void;
  dispose(): void;
  activate?(target: THREE.Object3D): void;
  setPointed?(pointed: boolean): void;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
}

export function disposeOwned(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object !== root && object.userData.disposeLabel) {
      disposeScalableLabel(object);
      return;
    }
    for (let parent = object.parent; parent; parent = parent.parent) {
      if (parent.userData.disposeLabel) return;
    }
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (materials.has(material)) continue;
        materials.add(material);
        disposeMaterial(material);
      }
    }
  });
}
