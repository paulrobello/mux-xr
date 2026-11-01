import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WorkspaceScene } from './xr';

export async function loadObservatory(workspace: WorkspaceScene): Promise<() => void> {
  const gltf = await new GLTFLoader().loadAsync('/assets/observatory.glb');
  const root = gltf.scene;
  root.name = 'authored-observatory';
  const placeholder = workspace.scene.getObjectByName('quiet-orbital-observatory');
  if (placeholder) placeholder.visible = false;
  workspace.scene.add(root);
  const sync = (): void => {
    root.visible = workspace.state.background === 'observatory' && workspace.state.xrMode !== 'ar';
    if (placeholder) placeholder.visible = false;
  };
  const unsubscribe = workspace.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    workspace.scene.remove(root);
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
  };
}
