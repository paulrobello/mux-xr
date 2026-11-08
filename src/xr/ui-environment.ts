import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Faint reflections only: dark, low-glare surfaces keep terminal text the brightest thing. */
export const UI_ENV_MAP_INTENSITY = 0.4;

export interface UIEnvironment {
  /** The shared PMREM texture; null without a working renderer or after dispose. */
  texture: THREE.Texture | null;
  /** Compiles the env-lit program variants now, so their first use in a session cannot hitch. */
  warmPrograms(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget | null {
  const room = new RoomEnvironment();
  let generator: THREE.PMREMGenerator | null = null;
  let restore: (() => void) | null = null;
  try {
    // fromScene restores this state only when it finishes, so a throw would leave XR disabled.
    const xrEnabled = renderer.xr.enabled;
    const renderTarget = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipmapLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const toneMapping = renderer.toneMapping;
    restore = () => {
      renderer.setRenderTarget(renderTarget, cubeFace, mipmapLevel);
      renderer.xr.enabled = xrEnabled;
      renderer.autoClear = autoClear;
      renderer.toneMapping = toneMapping;
    };
    generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(room, 0.04);
    target.texture.userData.sharedUIEnvironment = true;
    return target;
  } catch (error) {
    console.warn('UI environment map unavailable; UI materials stay without reflections.', error);
    return null;
  } finally {
    restore?.();
    room.dispose();
    generator?.dispose();
  }
}

/**
 * Lights selected UI materials per material. Never assign it to `scene.environment`, which
 * would also relight the hand meshes. Build it before any XR session starts.
 */
export function createUIEnvironment(renderer: THREE.WebGLRenderer | null): UIEnvironment {
  let target = renderer ? buildEnvironment(renderer) : null;
  const warmMaterials: THREE.MeshStandardMaterial[] = [];
  const environment: UIEnvironment = {
    texture: target?.texture ?? null,
    warmPrograms(scene: THREE.Scene, camera: THREE.Camera): void {
      const envMap = environment.texture;
      if (!renderer || !envMap || warmMaterials.length > 0) return;
      // One material per env-lit variant: plain, flat-shaded nodes and double-sided frames.
      warmMaterials.push(
        applyUIEnvironment(new THREE.MeshStandardMaterial(), envMap),
        applyUIEnvironment(new THREE.MeshStandardMaterial({ flatShading: true }), envMap),
        applyUIEnvironment(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), envMap),
      );
      const geometry = new THREE.BoxGeometry(0.01, 0.01, 0.01);
      const group = new THREE.Group();
      for (const material of warmMaterials) group.add(new THREE.Mesh(geometry, material));
      try {
        renderer.compile(group, camera, scene);
      } catch (error) {
        console.warn('UI environment program warm-up failed.', error);
      } finally {
        group.clear();
        geometry.dispose();
      }
    },
    dispose(): void {
      // Disposing a warm-up material releases its program, so they live as long as the scene.
      for (const material of warmMaterials) material.dispose();
      warmMaterials.length = 0;
      target?.dispose();
      target = null;
      environment.texture = null;
    },
  };
  return environment;
}

/** Material teardown must skip this texture: every other UI material still samples it. */
export function isSharedUIEnvironment(texture: THREE.Texture | null | undefined): boolean {
  return texture?.userData.sharedUIEnvironment === true;
}

export function applyUIEnvironment<T extends THREE.MeshStandardMaterial>(
  material: T,
  envMap: THREE.Texture | null | undefined,
): T {
  if (!envMap) return material;
  material.envMap = envMap;
  material.envMapIntensity = UI_ENV_MAP_INTENSITY;
  return material;
}
