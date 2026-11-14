import type * as THREE from 'three';
import { accentColorOrNull, resolveEnvironmentAccent, type WorkspaceColors } from './accent-colors';
import { createAuroraTundraEnvironment } from './environments/aurora-tundra';
import { createCloudSummitEnvironment } from './environments/cloud-summit';
import { createDeepWaterEnvironment } from './environments/deep-water';
import { createDesertNightEnvironment } from './environments/desert-night';
import { createHangarDeckEnvironment } from './environments/hangar-deck';
import { createKoiGardenEnvironment } from './environments/koi-garden';
import { createMinimalStudioEnvironment } from './environments/minimal-studio';
import { createRainRooftopEnvironment } from './environments/rain-rooftop';

type EnvironmentUpdater = (deltaSeconds: number) => void;

/** Adds an updater to the scene's single `updateEnvironment` hook; returns its removal. */
export function registerEnvironmentUpdater(
  scene: THREE.Scene,
  updater: EnvironmentUpdater,
): () => void {
  const updaters = (scene.userData.environmentUpdaters ??
    new Set<EnvironmentUpdater>()) as Set<EnvironmentUpdater>;
  scene.userData.environmentUpdaters = updaters;
  updaters.add(updater);
  scene.userData.updateEnvironment = (deltaSeconds: number): void => {
    for (const each of [...updaters]) each(deltaSeconds);
  };
  return () => {
    updaters.delete(updater);
    if (updaters.size === 0 && scene.userData.environmentUpdaters === updaters) {
      delete scene.userData.updateEnvironment;
      delete scene.userData.environmentUpdaters;
    }
  };
}

export interface EnvironmentInstance {
  root: THREE.Group;
  update(deltaSeconds: number): void;
  dispose(): void;
  floorY: number;
}

/** Builds an environment; `accent` retints its accent glows, null keeps the authored cyan. */
export type EnvironmentFactory = (accent: THREE.Color | null) => EnvironmentInstance;
export type EnvironmentFactories = Partial<Record<string, EnvironmentFactory>>;

export const ENVIRONMENT_FACTORIES = {
  hangar: createHangarDeckEnvironment,
  'deep-water': createDeepWaterEnvironment,
  studio: createMinimalStudioEnvironment,
  desert: createDesertNightEnvironment,
  aurora: createAuroraTundraEnvironment,
  rooftop: createRainRooftopEnvironment,
  summit: createCloudSummitEnvironment,
  koi: createKoiGardenEnvironment,
} satisfies EnvironmentFactories;

export interface EnvironmentSelection
  extends Pick<WorkspaceColors, 'accentColor' | 'environmentAccentColor'> {
  enabled?: boolean;
}

export interface EnvironmentController {
  select(id: string | null, options?: EnvironmentSelection): EnvironmentInstance | null;
  update(deltaSeconds: number): void;
  dispose(): void;
}

/** Mounts one environment at a time. The host drives its frame updates. */
export function createEnvironmentController(
  parent: THREE.Object3D,
  factories: EnvironmentFactories = ENVIRONMENT_FACTORIES,
  onError = (id: string, error: unknown): void =>
    console.warn(`Environment ${id} unavailable.`, error),
): EnvironmentController {
  let active: { id: string; accent: string; instance: EnvironmentInstance } | null = null;
  let failedId: string | null = null;
  let disposed = false;
  const release = (): void => {
    if (!active) return;
    const { instance } = active;
    active = null;
    parent.remove(instance.root);
    instance.dispose();
  };
  return {
    select(id, options = {}) {
      if (disposed) return null;
      if (failedId !== id) failedId = null;
      const factory = id !== null && Object.hasOwn(factories, id) ? factories[id] : undefined;
      if (id === null || options.enabled === false || failedId === id || !factory) {
        release();
        return null;
      }
      const accent = resolveEnvironmentAccent(options);
      if (active?.id === id && active.accent === accent) return active.instance;
      release();
      try {
        const instance = factory(accentColorOrNull(accent));
        instance.root.visible = true;
        parent.add(instance.root);
        active = { id, accent, instance };
        return instance;
      } catch (error) {
        failedId = id;
        onError(id, error);
        return null;
      }
    },
    update(deltaSeconds) {
      active?.instance.update(deltaSeconds);
    },
    dispose() {
      disposed = true;
      release();
    },
  };
}
