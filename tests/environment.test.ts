import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import type { BackgroundMode } from '../src/contracts';
import { loadObservatory, quietObservatoryPlanet } from '../src/environment';
import type { WorkspaceScene } from '../src/xr';

describe('authored observatory display treatment', () => {
  it('dims only the authored distant planet material', () => {
    const root = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshStandardMaterial({ emissiveIntensity: 0.23 }),
    );
    planet.name = 'observatory_distant_planet';
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    panel.name = 'observatory_window_sill';
    root.add(planet, panel);
    quietObservatoryPlanet(root);
    expect(planet.material.color.getHex()).toBe(0x172b3e);
    expect((planet.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.05);
    expect((panel.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(1);
  });

  it('leaves fallback and unrelated meshes unchanged when authored planet is absent', () => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshStandardMaterial({ emissiveIntensity: 0.8 }),
    );
    quietObservatoryPlanet(mesh);
    expect((mesh.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.8);
  });

  it('keeps the exterior fallback visible when authored loading fails', async () => {
    const scene = new THREE.Scene();
    let listener: (() => void) | undefined;
    const state: { background: BackgroundMode; xrMode: 'desktop' | 'vr' | 'ar' } = {
      background: 'observatory',
      xrMode: 'desktop',
    };
    const workspace = {
      scene,
      state,
      subscribe(next: () => void) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    } as unknown as WorkspaceScene;
    const load = vi
      .spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockRejectedValue(new Error('missing'));
    const dispose = await loadObservatory(workspace);
    const background = scene.getObjectByName('observatory-exterior-space');
    expect(background?.visible).toBe(true);
    state.xrMode = 'ar';
    listener?.();
    expect(background?.visible).toBe(false);
    dispose();
    expect(scene.getObjectByName('observatory-exterior-space')).toBeUndefined();
    load.mockRestore();
  });

  it('disposes a late GLB result after abort without attaching it', async () => {
    const scene = new THREE.Scene();
    const state: { background: BackgroundMode; xrMode: 'desktop' | 'vr' | 'ar' } = {
      background: 'observatory',
      xrMode: 'desktop',
    };
    const workspace = {
      scene,
      state,
      subscribe: () => () => undefined,
    } as unknown as WorkspaceScene;
    let resolveLoad!: (value: { scene: THREE.Group }) => void;
    const loadPromise = new Promise<{ scene: THREE.Group }>((resolve) => {
      resolveLoad = resolve;
    });
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockReturnValue(loadPromise as never);
    const controller = new AbortController();
    const cleanupPromise = loadObservatory(workspace, controller.signal);
    await Promise.resolve();
    const authored = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const geometryDispose = vi.spyOn(authored.geometry, 'dispose');
    const materialDispose = vi.spyOn(authored.material as THREE.Material, 'dispose');
    const authoredRoot = new THREE.Group();
    authoredRoot.add(authored);
    controller.abort();
    resolveLoad({ scene: authoredRoot });
    const cleanup = await cleanupPromise;
    cleanup();
    expect(scene.getObjectByName('authored-observatory')).toBeUndefined();
    expect(scene.getObjectByName('observatory-exterior-space')).toBeUndefined();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    load.mockRestore();
  });

  it('applies the self-hosted planet texture when available', async () => {
    const scene = new THREE.Scene();
    const state = { background: 'observatory' as BackgroundMode, xrMode: 'desktop' as const };
    const workspace = {
      scene,
      state,
      subscribe: () => () => undefined,
    } as unknown as WorkspaceScene;
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshStandardMaterial({ name: 'observatory_planet_high' }),
    );
    planet.name = 'observatory_distant_planet';
    const authoredRoot = new THREE.Group();
    authoredRoot.add(planet);
    const gltfLoad = vi
      .spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene: authoredRoot } as never);
    const texture = new THREE.Texture<HTMLImageElement>();
    const textureLoad = vi
      .spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockResolvedValue(texture);
    const dispose = await loadObservatory(workspace);
    expect((planet.material as THREE.MeshStandardMaterial).map).toBe(texture);
    expect(texture.flipY).toBe(false);
    dispose();
    gltfLoad.mockRestore();
    textureLoad.mockRestore();
  });

  it('disposes a late planet texture after abort', async () => {
    const scene = new THREE.Scene();
    const state = { background: 'observatory' as BackgroundMode, xrMode: 'desktop' as const };
    const workspace = {
      scene,
      state,
      subscribe: () => () => undefined,
    } as unknown as WorkspaceScene;
    const authoredRoot = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshStandardMaterial({ name: 'observatory_planet_high' }),
    );
    planet.name = 'observatory_distant_planet';
    authoredRoot.add(planet);
    const gltfLoad = vi
      .spyOn(GLTFLoader.prototype, 'loadAsync')
      .mockResolvedValue({ scene: authoredRoot } as never);
    let resolveTexture!: (texture: THREE.Texture<HTMLImageElement>) => void;
    const texturePromise = new Promise<THREE.Texture<HTMLImageElement>>((resolve) => {
      resolveTexture = resolve;
    });
    const textureLoad = vi
      .spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockReturnValue(texturePromise);
    const controller = new AbortController();
    const loadPromise = loadObservatory(workspace, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    const texture = new THREE.Texture<HTMLImageElement>();
    const textureDispose = vi.spyOn(texture, 'dispose');
    controller.abort();
    resolveTexture(texture);
    await loadPromise;
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(scene.getObjectByName('authored-observatory')).toBeUndefined();
    gltfLoad.mockRestore();
    textureLoad.mockRestore();
  });
});
