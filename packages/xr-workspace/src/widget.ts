import type * as THREE from 'three';
import { disposeScalableLabel } from './labels';

/** A mountable 3D widget. The host owns the frame loop, input routing and placement of `root`. */
export interface SpatialWidget {
  /** Add this to the scene. The widget positions it at its spawn pose, which the host may override. */
  root: THREE.Group;
  /** Call once per frame with the wall-clock time in milliseconds, so dropped frames never drift it. */
  update(nowMs: number): void;
  /** Frees the widget's geometry, materials and label textures. The host removes `root` from its parent. */
  dispose(): void;
  /** Routes a control hit. The host calls it with the object a ray, pinch or touch selected. */
  activate?(target: THREE.Object3D): void;
  /** Reports whether a ray rests on the widget, so it can hold its layout still while pointed at. */
  setPointed?(pointed: boolean): void;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
}

/**
 * Disposes every geometry and material under `root`, each once, and the labels it owns through
 * `disposeScalableLabel`. Anything shared with other widgets, such as an environment map, must not
 * be attached below `root` as a material you want kept.
 */
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
