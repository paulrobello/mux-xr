import { ENVIRONMENT_FACTORIES } from '@par/xr-workspace';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_MODES, type BackgroundMode, isBackgroundMode } from '../src/contracts';
import {
  createEnvironmentManager,
  createObservatoryAccent,
  type EnvironmentInstance,
} from '../src/environment';
import { loadSettings, validateSettings } from '../src/ui';
import type { WorkspaceScene } from '../src/xr';
import { DESK_WINDOW_KIND } from '../src/xr/desk-window';
import { workspaceFloorY } from '../src/xr/floor-layout';
import { createTestFrameUpdaters } from './helpers/frame-updaters';

const ENV_MODES = [
  'hangar',
  'deep-water',
  'studio',
  'desert',
  'aurora',
  'koi',
  'summit',
  'rooftop',
] as const;
const ROOT_NAMES: Record<(typeof ENV_MODES)[number], string> = {
  hangar: 'hangar-deck-environment',
  'deep-water': 'deep-water-environment',
  studio: 'minimal-studio-environment',
  desert: 'desert-night-environment',
  aurora: 'aurora-tundra-environment',
  rooftop: 'rain-rooftop-environment',
  summit: 'cloud-summit-environment',
  koi: 'koi-garden-environment',
};

function harness() {
  const scene = new THREE.Scene();
  const state: {
    background: BackgroundMode;
    xrMode: 'desktop' | 'vr' | 'ar';
    accentColor: string;
    environmentAccentColor: string;
    widgets: string[];
    fullPassthrough: boolean;
  } = {
    background: 'observatory',
    xrMode: 'desktop',
    accentColor: '',
    environmentAccentColor: '',
    widgets: [],
    fullPassthrough: false,
  };
  const listeners = new Set<() => void>();
  const setNotice = vi.fn();
  const { registerFrameUpdater, runFrame } = createTestFrameUpdaters();
  const workspace = {
    scene,
    state,
    setNotice,
    registerFrameUpdater,
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
    accent: string | null;
  }> = [];
  const factories = Object.fromEntries(
    ENV_MODES.map((mode) => [
      mode,
      (accent: THREE.Color | null) => {
        const instance = ENVIRONMENT_FACTORIES[mode]?.(accent) as EnvironmentInstance;
        const dispose = vi.fn(instance.dispose);
        instance.dispose = dispose;
        created.push({
          mode,
          instance,
          dispose,
          accent: accent ? `#${accent.getHexString()}` : null,
        });
        return instance;
      },
    ]),
  );
  return { scene, workspace, set, created, factories, setNotice, runFrame, registerFrameUpdater };
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
    expect(created).toHaveLength(ENV_MODES.length);
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
  });

  it('rebuilds the active environment once per environment accent change', () => {
    const { workspace, set, created, factories } = harness();
    const stop = createEnvironmentManager(workspace, factories);
    set({ background: 'hangar' });
    expect(created.map((entry) => entry.accent)).toEqual([null]);
    set({ accentColor: '#ff672f' });
    set({ xrMode: 'vr' });
    expect(created.map((entry) => entry.accent)).toEqual([null, '#ff672f']);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    set({ environmentAccentColor: '#22a55a' });
    set({ accentColor: '#3b82f6' });
    expect(created.map((entry) => entry.accent)).toEqual([null, '#ff672f', '#22a55a']);
    set({ environmentAccentColor: '', accentColor: '' });
    expect(created.at(-1)?.accent).toBeNull();
    stop();
  });

  it('tints the observatory accent materials at their brightness and restores them', () => {
    const cool = new THREE.MeshStandardMaterial({
      name: 'observatory_cool_low',
      color: new THREE.Color(0.07, 0.3, 0.39),
      emissive: new THREE.Color(0.049, 0.21, 0.273),
    });
    const hull = new THREE.MeshStandardMaterial({ name: 'observatory_hull_low', color: 0x101820 });
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), cool),
      new THREE.Mesh(new THREE.BoxGeometry(), hull),
    );
    const authored = cool.color.clone();
    const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const apply = createObservatoryAccent(root);
    apply('#ff672f');
    expect(cool.color.r).toBeGreaterThan(cool.color.b);
    expect(luminance(cool.color)).toBeCloseTo(luminance(authored), 6);
    expect(hull.color.getHex()).toBe(0x101820);
    apply('');
    expect(cool.color.equals(authored)).toBe(true);
  });

  it('hides (disposes) in AR and restores outside AR', () => {
    const { scene, workspace, set, created, factories } = harness();
    const stop = createEnvironmentManager(workspace, factories);
    set({ background: 'desert' });
    expect(liveRoots(scene)).toEqual([ROOT_NAMES.desert]);
    set({ xrMode: 'ar', fullPassthrough: true });
    expect(liveRoots(scene)).toEqual([]);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    set({ xrMode: 'vr', fullPassthrough: false });
    expect(liveRoots(scene)).toEqual([ROOT_NAMES.desert]);
    expect(created).toHaveLength(2);
    stop();
  });

  it('masks the selected environment only while the desk window is open in AR', () => {
    const { scene, workspace, set, created, factories } = harness();
    const stop = createEnvironmentManager(workspace, factories);
    set({ background: 'studio', xrMode: 'ar', widgets: [DESK_WINDOW_KIND] });
    expect(liveRoots(scene)).toEqual([ROOT_NAMES.studio]);
    const checkMaterials = (enabled: boolean): void => {
      const root = created.at(-1)?.instance.root;
      const materials: THREE.Material[] = [];
      root?.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        if (material) materials.push(...(Array.isArray(material) ? material : [material]));
      });
      expect(materials.length).toBeGreaterThan(0);
      for (const material of materials) {
        expect(material.stencilWrite).toBe(enabled);
        expect(material.stencilFunc).toBe(
          enabled ? THREE.NotEqualStencilFunc : THREE.AlwaysStencilFunc,
        );
        expect(material.stencilWriteMask).toBe(enabled ? 0 : 0xff);
      }
    };
    checkMaterials(true);
    set({ xrMode: 'vr' });
    expect(created).toHaveLength(1);
    checkMaterials(false);
    set({ xrMode: 'ar', background: 'hangar' });
    expect(liveRoots(scene)).toEqual([ROOT_NAMES.hangar]);
    checkMaterials(true);
    set({ widgets: [] });
    expect(liveRoots(scene)).toEqual([ROOT_NAMES.hangar]);
    checkMaterials(false);
    set({ fullPassthrough: true });
    expect(liveRoots(scene)).toEqual([]);
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

  it('a repeated unregister cannot remove a newer updater', () => {
    const { registerFrameUpdater, runFrame } = harness();
    const first = registerFrameUpdater(vi.fn());
    first();
    const newer = vi.fn();
    registerFrameUpdater(newer);
    first();
    runFrame(0.01);
    expect(newer).toHaveBeenCalledWith(0.01);
  });

  it('starts directly in AR without creating anything', () => {
    const { workspace, set, created, factories } = harness();
    set({ background: 'hangar', xrMode: 'ar', fullPassthrough: true });
    const stop = createEnvironmentManager(workspace, factories);
    expect(created).toHaveLength(0);
    stop();
  });

  it('drives the active update through the frame hook without clobbering other updaters', () => {
    const { workspace, set, created, factories, registerFrameUpdater, runFrame } = harness();
    const other = vi.fn();
    const unregister = registerFrameUpdater(other);
    const stop = createEnvironmentManager(workspace, factories);
    set({ background: 'hangar' });
    const update = vi.spyOn(created[0].instance, 'update');
    runFrame(0.016);
    expect(other).toHaveBeenCalledWith(0.016);
    expect(update).toHaveBeenCalledWith(0.016);
    stop();
    update.mockClear();
    runFrame(0.016);
    expect(other).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    unregister();
  });
});

describe('background modes', () => {
  it('reports floor Y from each environment for its mode and none for plain modes', () => {
    for (const mode of ENV_MODES) {
      const instance = ENVIRONMENT_FACTORIES[mode]?.(null) as EnvironmentInstance;
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

describe('lazy environments', () => {
  const instance = (name: string) => {
    const root = new THREE.Group();
    root.name = name;
    return { root, floorY: 0, update: vi.fn(), dispose: vi.fn() };
  };
  /** A loader the test settles by hand, so it can interleave selections with a pending fetch. */
  const deferred = () => {
    let resolve!: (factory: (accent: THREE.Color | null) => EnvironmentInstance) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<(accent: THREE.Color | null) => EnvironmentInstance>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    return { load: vi.fn(() => promise), resolve, reject };
  };
  const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

  it('keeps the current world mounted until the next one has loaded, then swaps and disposes', async () => {
    const { scene, workspace, set } = harness();
    const first = instance('first-environment');
    const second = instance('second-environment');
    const slow = deferred();
    const stop = createEnvironmentManager(workspace, {
      hangar: () => first,
      studio: slow,
    });
    set({ background: 'hangar' });
    expect(liveRoots(scene)).toEqual(['first-environment']);
    set({ background: 'studio' });
    expect(liveRoots(scene)).toEqual(['first-environment']);
    expect(first.dispose).not.toHaveBeenCalled();
    slow.resolve(() => second);
    await flush();
    expect(liveRoots(scene)).toEqual(['second-environment']);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    stop();
  });

  it('drops a load that a later selection superseded, and fetches each world once', async () => {
    const { scene, workspace, set } = harness();
    const stale = deferred();
    const live = instance('live-environment');
    const stop = createEnvironmentManager(workspace, {
      hangar: stale,
      studio: () => live,
    });
    set({ background: 'hangar' });
    set({ background: 'studio' });
    expect(liveRoots(scene)).toEqual(['live-environment']);
    stale.resolve(() => instance('stale-environment'));
    await flush();
    expect(liveRoots(scene)).toEqual(['live-environment']);
    set({ background: 'hangar' });
    expect(liveRoots(scene)).toEqual(['stale-environment']);
    expect(stale.load).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps the current world and raises a notice when a chunk fails to load', async () => {
    const { scene, workspace, set, setNotice } = harness();
    const current = instance('current-environment');
    const broken = deferred();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stop = createEnvironmentManager(workspace, {
      hangar: () => current,
      studio: broken,
    });
    set({ background: 'hangar' });
    set({ background: 'studio' });
    broken.reject(new Error('chunk failed'));
    await flush();
    expect(liveRoots(scene)).toEqual(['current-environment']);
    expect(current.dispose).not.toHaveBeenCalled();
    expect(setNotice).toHaveBeenCalledTimes(1);
    // The failure is not retried until the mode changes.
    set({ xrMode: 'vr' });
    expect(broken.load).toHaveBeenCalledTimes(1);
    stop();
    warn.mockRestore();
  });

  it('does not mount a world that finishes loading after the manager stopped', async () => {
    const { scene, workspace, set } = harness();
    const late = deferred();
    const stop = createEnvironmentManager(workspace, { hangar: late });
    set({ background: 'hangar' });
    stop();
    late.resolve(() => instance('late-environment'));
    await flush();
    expect(liveRoots(scene)).toEqual([]);
  });

  it('applies the desk window mask to a world that mounts after loading', async () => {
    const { scene, workspace, set } = harness();
    const lazy = deferred();
    const world = instance('masked-environment');
    const material = new THREE.MeshBasicMaterial();
    world.root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    const stop = createEnvironmentManager(workspace, { studio: lazy });
    set({ background: 'studio', xrMode: 'ar', widgets: [DESK_WINDOW_KIND] });
    lazy.resolve(() => world);
    await flush();
    expect(liveRoots(scene)).toEqual(['masked-environment']);
    expect(material.stencilWrite).toBe(true);
    stop();
  });
});
