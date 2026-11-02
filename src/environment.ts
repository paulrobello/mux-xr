import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WorkspaceScene } from './xr';
import { createSpaceBackground } from './xr/space-background';

export function quietObservatoryPlanet(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const isPlanet =
      child.name === 'observatory_distant_planet' ||
      (child.material &&
        (Array.isArray(child.material) ? child.material : [child.material]).some(
          (material) =>
            material.name === 'observatory_planet_high' ||
            material.name === 'observatory_planet_low',
        ));
    if (!isPlanet) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.setHex(0x172b3e);
        material.emissiveIntensity = 0.05;
      }
    }
  });
}

function applyObservatoryPlanetTexture(
  root: THREE.Object3D,
  texture: THREE.Texture,
): THREE.Texture[] {
  const replaced: THREE.Texture[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const isPlanet =
      child.name === 'observatory_distant_planet' ||
      (child.material &&
        (Array.isArray(child.material) ? child.material : [child.material]).some(
          (material) =>
            material.name === 'observatory_planet_high' ||
            material.name === 'observatory_planet_low',
        ));
    if (!isPlanet) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.map) replaced.push(material.map);
      if (material.emissiveMap && material.emissiveMap !== material.map)
        replaced.push(material.emissiveMap);
      material.map = texture;
      material.emissiveMap = texture;
      material.color.setHex(0x9faebd);
      material.emissive.setHex(0x23303a);
      material.emissiveIntensity = 0.08;
      material.needsUpdate = true;
    }
  });
  return replaced;
}

function disposeObjectResources(
  root: THREE.Object3D,
  extraTextures: Iterable<THREE.Texture> = [],
): void {
  const textures = new Set<THREE.Texture>(extraTextures);
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    if (
      !(child instanceof THREE.Mesh) &&
      !(child instanceof THREE.Line) &&
      !(child instanceof THREE.Points)
    )
      return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

export async function loadObservatory(
  workspace: WorkspaceScene,
  signal?: AbortSignal,
): Promise<() => void> {
  const background = createSpaceBackground();
  workspace.scene.add(background.root);
  const placeholder = workspace.scene.getObjectByName('quiet-orbital-observatory');
  let root: THREE.Object3D | null = null;
  let disposed = false;
  const ownedTextures = new Set<THREE.Texture>();
  let planetPivot: THREE.Group | null = null;
  let unsubscribe = (): void => undefined;
  const sync = (): void => {
    const visible = workspace.state.background === 'observatory' && workspace.state.xrMode !== 'ar';
    background.root.visible = visible;
    if (root) root.visible = visible;
    if (placeholder) placeholder.visible = root === null && visible;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (workspace.scene.userData.updateEnvironment === updateEnvironment)
      delete workspace.scene.userData.updateEnvironment;
    signal?.removeEventListener('abort', dispose);
    if (root) {
      workspace.scene.remove(root);
      disposeObjectResources(root, ownedTextures);
      ownedTextures.clear();
      root = null;
    }
    for (const texture of ownedTextures) texture.dispose();
    background.dispose();
  };
  const updateEnvironment = (deltaSeconds: number): void => {
    if (disposed) return;
    background.update(deltaSeconds);
    if (planetPivot && background.root.visible && Number.isFinite(deltaSeconds)) {
      planetPivot.rotation.y += Math.max(0, Math.min(deltaSeconds, 0.25)) * 0.008;
    }
  };
  if (signal?.aborted) {
    dispose();
    return dispose;
  }
  unsubscribe = workspace.subscribe(sync);
  workspace.scene.userData.updateEnvironment = updateEnvironment;
  signal?.addEventListener('abort', dispose, { once: true });
  sync();
  try {
    const gltf = await new GLTFLoader().loadAsync('/assets/observatory.glb');
    if (disposed) {
      disposeObjectResources(gltf.scene);
      return dispose;
    }
    root = gltf.scene;
    root.name = 'authored-observatory';
    quietObservatoryPlanet(root);
    workspace.scene.add(root);
    const planet = findPlanetMesh(root);
    if (planet && !planetPivot) planetPivot = createPlanetPivot(planet);
    sync();
    const authoredRoot = root;
    try {
      const texture = await new THREE.TextureLoader().loadAsync('/assets/observatory-planet.png');
      if (disposed) {
        texture.dispose();
        return dispose;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.needsUpdate = true;
      for (const replaced of applyObservatoryPlanetTexture(authoredRoot, texture))
        ownedTextures.add(replaced);
      ownedTextures.add(texture);
    } catch (error) {
      if (!disposed) {
        console.warn('Observatory planet texture unavailable; using the authored planet.', error);
      }
    }
  } catch (error) {
    if (!disposed) {
      console.warn('Authored observatory unavailable; using the lightweight exterior.', error);
    }
  }
  sync();
  return dispose;
}

function findPlanetMesh(root: THREE.Object3D): THREE.Mesh | undefined {
  const named = root.getObjectByName('planet_mesh');
  if (named instanceof THREE.Mesh) return named;
  let found: THREE.Mesh | undefined;
  root.traverse((child) => {
    if (found || !(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (materials.some((material) => material.name === 'observatory_planet_low')) found = child;
  });
  return found;
}

function createPlanetPivot(planet: THREE.Mesh): THREE.Group {
  const parent = planet.parent;
  const pivot = new THREE.Group();
  pivot.name = 'observatory-planet-rotation-pivot';
  planet.updateWorldMatrix(true, false);
  planet.geometry.computeBoundingSphere();
  const center = planet.geometry.boundingSphere?.center.clone() ?? new THREE.Vector3();
  const worldCenter = planet.localToWorld(center);
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(worldCenter);
    parent.add(pivot);
    pivot.position.copy(worldCenter);
    pivot.updateWorldMatrix(true, false);
    pivot.attach(planet);
  }
  return pivot;
}
