import type * as THREE from 'three';
import { accentColorOrNull, resolveEnvironmentAccent, type WorkspaceColors } from './accent-colors';

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

/** An environment whose code is fetched on first use, so it stays out of the entry bundle. */
export interface LazyEnvironment {
  load(): Promise<EnvironmentFactory>;
}
/** One selectable world: a factory ready now, or a loader that resolves one. */
export type EnvironmentSource = EnvironmentFactory | LazyEnvironment;
export type EnvironmentSources = Partial<Record<string, EnvironmentSource>>;

/** The built-in environments, each fetched as its own chunk the first time it is selected. */
export const ENVIRONMENT_LOADERS = {
  hangar: {
    load: () => import('./environments/hangar-deck').then((m) => m.createHangarDeckEnvironment),
  },
  'deep-water': {
    load: () => import('./environments/deep-water').then((m) => m.createDeepWaterEnvironment),
  },
  studio: {
    load: () =>
      import('./environments/minimal-studio').then((m) => m.createMinimalStudioEnvironment),
  },
  desert: {
    load: () => import('./environments/desert-night').then((m) => m.createDesertNightEnvironment),
  },
  aurora: {
    load: () => import('./environments/aurora-tundra').then((m) => m.createAuroraTundraEnvironment),
  },
  rooftop: {
    load: () => import('./environments/rain-rooftop').then((m) => m.createRainRooftopEnvironment),
  },
  summit: {
    load: () => import('./environments/cloud-summit').then((m) => m.createCloudSummitEnvironment),
  },
  koi: {
    load: () => import('./environments/koi-garden').then((m) => m.createKoiGardenEnvironment),
  },
} satisfies EnvironmentSources;

export interface EnvironmentSelection
  extends Pick<WorkspaceColors, 'accentColor' | 'environmentAccentColor'> {
  enabled?: boolean;
}

export interface EnvironmentController {
  /**
   * Switches to world `id`, or to none for null, a disabled selection or an unknown id. Returns the
   * mounted environment. A world whose code is not loaded yet leaves the current one mounted and
   * returns it; `onMount` reports the new one once it has replaced it.
   */
  select(id: string | null, options?: EnvironmentSelection): EnvironmentInstance | null;
  update(deltaSeconds: number): void;
  dispose(): void;
}

const isFactory = (source: EnvironmentSource): source is EnvironmentFactory =>
  typeof source === 'function';

/** Mounts one environment at a time. The host drives its frame updates. */
export function createEnvironmentController(
  parent: THREE.Object3D,
  sources: EnvironmentSources = ENVIRONMENT_LOADERS,
  onError = (id: string, error: unknown): void =>
    console.warn(`Environment ${id} unavailable.`, error),
  onMount: (instance: EnvironmentInstance, id: string) => void = () => undefined,
): EnvironmentController {
  let active: { id: string; accent: string; instance: EnvironmentInstance } | null = null;
  let failedId: string | null = null;
  let disposed = false;
  // A later select supersedes a load still in flight: its result is cached but never mounted.
  let generation = 0;
  const loaded = new Map<string, EnvironmentFactory>();
  const loading = new Map<string, Promise<EnvironmentFactory>>();
  const release = (): void => {
    if (!active) return;
    const { instance } = active;
    active = null;
    parent.remove(instance.root);
    instance.dispose();
  };
  const build = (
    id: string,
    accent: string,
    factory: EnvironmentFactory,
  ): EnvironmentInstance | null => {
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
  };
  const load = (id: string, source: LazyEnvironment): Promise<EnvironmentFactory> => {
    let pending = loading.get(id);
    if (!pending) {
      pending = source.load().then(
        (factory) => {
          loaded.set(id, factory);
          loading.delete(id);
          return factory;
        },
        (error: unknown) => {
          loading.delete(id);
          throw error;
        },
      );
      loading.set(id, pending);
    }
    return pending;
  };
  return {
    select(id, options = {}) {
      if (disposed) return null;
      if (failedId !== id) failedId = null;
      const source = id !== null && Object.hasOwn(sources, id) ? sources[id] : undefined;
      if (id === null || options.enabled === false || !source) {
        generation += 1;
        release();
        return null;
      }
      // A failed load keeps the world that was showing until the mode changes.
      if (failedId === id) return active?.instance ?? null;
      const accent = resolveEnvironmentAccent(options);
      generation += 1;
      if (active?.id === id && active.accent === accent) return active.instance;
      const factory = isFactory(source) ? source : loaded.get(id);
      if (factory) {
        release();
        return build(id, accent, factory);
      }
      const mine = generation;
      load(id, source as LazyEnvironment).then(
        (resolved) => {
          if (disposed || mine !== generation) return;
          const previous = active;
          active = null;
          const instance = build(id, accent, resolved);
          if (!instance) {
            active = previous;
            return;
          }
          if (previous) {
            parent.remove(previous.instance.root);
            previous.instance.dispose();
          }
          onMount(instance, id);
        },
        (error: unknown) => {
          if (disposed || mine !== generation) return;
          failedId = id;
          onError(id, error);
        },
      );
      return active?.instance ?? null;
    },
    update(deltaSeconds) {
      active?.instance.update(deltaSeconds);
    },
    dispose() {
      disposed = true;
      generation += 1;
      release();
    },
  };
}
