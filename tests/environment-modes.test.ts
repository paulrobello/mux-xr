import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_MODES, type BackgroundMode, isBackgroundMode } from '../src/contracts';
import {
  createEnvironmentManager,
  ENVIRONMENT_FACTORIES,
  type EnvironmentInstance,
  registerEnvironmentUpdater,
} from '../src/environment';
import { loadSettings, validateSettings } from '../src/ui';
import type { WorkspaceScene } from '../src/xr';
import { workspaceFloorY } from '../src/xr/floor-layout';

const ENV_MODES = ['hangar', 'deep-water', 'studio', 'desert'] as const;
const ROOT_NAMES: Record<(typeof ENV_MODES)[number], string> = {
  hangar: 'hangar-deck-environment',
  'deep-water': 'deep-water-environment',
  studio: 'minimal-studio-environment',
  desert: 'desert-night-environment',
};

function harness() {
  const scene = new THREE.Scene();
  const state: { background: BackgroundMode; xrMode: 'desktop' | 'vr' | 'ar' } = {
    background: 'observatory',
    xrMode: 'desktop',
  };
  const listeners = new Set<() => void>();
  const workspace = {
    scene,
    state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as WorkspaceScene;
  const set = (patch: Partial<typeof state>): void => {
    Object.assign(state, patch);
    for (const listener of [...listeners]) listener();
  };
  const created: Array<{
    mode: BackgroundMode;
    instance: EnvironmentInstance;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const factories = Object.fromEntries(
    ENV_MODES.map((mode) => [
      mode,
      () => {
        const instance = ENVIRONMENT_FACTORIES[mode]?.() as EnvironmentInstance;
        const dispose = vi.fn(instance.dispose);
        instance.dispose = dispose;
        created.push({ mode, instance, dispose });
        return instance;
      },
    ]),
  );
  return { scene, workspace, set, created, factories };
}

const liveRoots = (scene: THREE.Scene): string[] =>
  scene.children.map((child) => child.name).filter((name) => name.endsWith('-environment'));

describe('environment manager', () => {
  it('creates and fully disposes each environment as modes change', () => {
    const { scene, workspace, set, created, factories } = harness();
    const stop = createEnvironmentManager(workspace, factories);
    expect(created).toHaveLength(0);
    for (const mode of ENV_MODES) {
      set({ background: mode });
      expect(liveRoots(scene)).toEqual([ROOT_NAMES[mode]]);
      expect(created.at(-1)?.instance.root.visible).toBe(true);
      expect(created.filter((entry) => entry.dispose.mock.calls.length === 0)).toHaveLength(1);
    }
    for (const mode of ['observatory', 'black', 'gradient'] as const) {
      set({ background: mode });
      expect(liveRoots(scene)).toEqual([]);
    }
    expect(created).toHaveLength(4);
    for (const entry of created) expect(entry.dispose).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not recreate on unrelated notifications and disposes on stop', () => {
    const { scene, workspace, set, created, factories } = harness();
    const stop = createEnvironmentManager(workspace, factories);
    set({ background: 'studio' });
    set({ xrMode: 'vr' });
    expect(created).toHaveLength(1);
    stop();
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(liveRoots(scene)).toEqual([]);
    expect(scene.userData.updateEnvironment).toBeUndefined();
  });

  it('hides (disposes) in AR and restores outside AR', () => {
    const { scene, workspace, set, created, factories } = harness();
    const stop = createEnvironmentManager(workspace, factories);
    set({ background: 'desert' });
    expect(liveRoots(scene)).toEqual([ROOT_NAMES.desert]);
    set({ xrMode: 'ar' });
    expect(liveRoots(scene)).toEqual([]);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    set({ xrMode: 'vr' });
    expect(liveRoots(scene)).toEqual([ROOT_NAMES.desert]);
    expect(created).toHaveLength(2);
    stop();
  });

  it('does not retry a failing factory until the mode changes', () => {
    const { workspace, set, factories } = harness();
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stop = createEnvironmentManager(workspace, { ...factories, hangar: failing });
    set({ background: 'hangar' });
    set({ xrMode: 'vr' });
    set({ xrMode: 'desktop' });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    set({ background: 'black' });
    set({ background: 'hangar' });
    expect(failing).toHaveBeenCalledTimes(2);
    stop();
    warn.mockRestore();
  });

  it('a repeated unregister cannot remove a newer updater set', () => {
    const { scene } = harness();
    const first = registerEnvironmentUpdater(scene, vi.fn());
    first();
    const newer = vi.fn();
    registerEnvironmentUpdater(scene, newer);
    first();
    (scene.userData.updateEnvironment as (delta: number) => void)(0.01);
    expect(newer).toHaveBeenCalledWith(0.01);
  });

  it('starts directly in AR without creating anything', () => {
    const { workspace, set, created, factories } = harness();
    set({ background: 'hangar', xrMode: 'ar' });
    const stop = createEnvironmentManager(workspace, factories);
    expect(created).toHaveLength(0);
    stop();
  });

  it('drives the active update through the shared hook without clobbering other updaters', () => {
    const { scene, workspace, set, created, factories } = harness();
    const other = vi.fn();
    const unregister = registerEnvironmentUpdater(scene, other);
    const stop = createEnvironmentManager(workspace, factories);
    set({ background: 'hangar' });
    const update = vi.spyOn(created[0].instance, 'update');
    (scene.userData.updateEnvironment as (delta: number) => void)(0.016);
    expect(other).toHaveBeenCalledWith(0.016);
    expect(update).toHaveBeenCalledWith(0.016);
    stop();
    expect(typeof scene.userData.updateEnvironment).toBe('function');
    unregister();
    expect(scene.userData.updateEnvironment).toBeUndefined();
  });
});

describe('background modes', () => {
  it('reports floor Y from each environment for its mode and none for plain modes', () => {
    for (const mode of ENV_MODES) {
      const instance = ENVIRONMENT_FACTORIES[mode]?.() as EnvironmentInstance;
      expect(workspaceFloorY(mode, 'desktop')).toBeCloseTo(instance.floorY, 6);
      expect(workspaceFloorY(mode, 'vr')).toBeCloseTo(instance.floorY, 6);
      expect(workspaceFloorY(mode, 'ar')).toBe(0);
      instance.dispose();
    }
    expect(workspaceFloorY('observatory', 'vr')).toBeCloseTo(0.035, 6);
    expect(workspaceFloorY('black', 'vr')).toBeNull();
    expect(workspaceFloorY('gradient', 'desktop')).toBeNull();
  });

  it('round-trips every mode through persistence and rejects unknown values', () => {
    for (const mode of BACKGROUND_MODES) {
      expect(isBackgroundMode(mode)).toBe(true);
      const store = new Map<string, string>();
      const storage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      } as unknown as Storage;
      const first = loadSettings(storage);
      const raw = JSON.stringify({ ...first, background: mode });
      expect(validateSettings(JSON.parse(raw)).background).toBe(mode);
    }
    for (const bad of ['laser', '', 42, null, 'Hangar']) {
      expect(validateSettings({ background: bad }).background).toBe('observatory');
    }
  });
});
