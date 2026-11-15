// @vitest-environment happy-dom
import { resolveAccent } from '@par/xr-workspace';
import { describe, expect, it, vi } from 'vitest';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  loadSettings,
  SETTINGS_KEY,
  type WorkspaceSettings,
} from '../src/settings/store';
import { mountWorkspaceUI } from '../src/ui';
import { accent } from '../src/xr/accent-state';
import { fixture } from './helpers/xr-harness';

function memoryStorage(initial?: string): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SETTINGS_KEY, initial);
  return {
    values,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const stored = (storage: ReturnType<typeof memoryStorage>): Partial<WorkspaceSettings> =>
  JSON.parse(storage.values.get(SETTINGS_KEY) ?? '{}');

describe('settings store', () => {
  it('starts from the defaults and updates, validates and persists a patch', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.update({ uiSounds: false, background: 'desert' })).toBe(true);
    expect(store.get().uiSounds).toBe(false);
    expect(store.get().background).toBe('desert');
    expect(stored(storage)).toMatchObject({ uiSounds: false, background: 'desert' });
    store.update({ handColor: 'not-a-color', keyboardCurvature: 9999 });
    expect(store.get().handColor).toBe('');
    expect(store.get().keyboardCurvature).toBeLessThanOrEqual(100);
  });

  it('treats an update that changes nothing as a no-op', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ uiSounds: true, handColor: '' });
    store.update({ handColor: 'invalid' });
    expect(listener).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it('keeps a persist: false change in memory and writes it with the next persisting update', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage);
    store.update({ colorMode: 'monochrome' }, { persist: false });
    expect(store.get().colorMode).toBe('monochrome');
    expect(storage.values.size).toBe(0);
    store.update({ uiSounds: false });
    expect(stored(storage)).toMatchObject({ colorMode: 'monochrome', uiSounds: false });
  });

  it('writes earlier unsaved changes when a persisting update repeats the current value', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage);
    store.update({ background: 'desert' }, { persist: false });
    store.update({ background: 'desert' });
    expect(stored(storage).background).toBe('desert');
  });

  it('notifies subscribers in subscription order with the next and previous settings', () => {
    const store = createSettingsStore(memoryStorage());
    const order: string[] = [];
    store.subscribe((next, previous) => {
      order.push(`a:${previous.uiSounds}>${next.uiSounds}`);
    });
    const stop = store.subscribe(() => order.push('b'));
    store.subscribe(() => order.push('c'));
    store.update({ uiSounds: false });
    stop();
    store.update({ uiSounds: true });
    expect(order).toEqual(['a:true>false', 'b', 'c', 'a:false>true', 'c']);
  });

  it('ends a feedback loop between subscribers because the repeat update is a no-op', () => {
    const store = createSettingsStore(memoryStorage());
    const seen: boolean[] = [];
    store.subscribe((next) => {
      seen.push(next.gazeInput);
      store.update({ gazeInput: next.gazeInput });
    });
    store.update({ gazeInput: true });
    expect(seen).toEqual([true]);
  });

  it('delivers an update made inside a subscriber after the current one finishes', () => {
    const store = createSettingsStore(memoryStorage());
    const seen: string[] = [];
    store.subscribe((next) => {
      seen.push(`first:${next.background}`);
      if (next.background === 'desert') store.update({ background: 'koi' });
    });
    store.subscribe((next) => seen.push(`second:${next.background}`));
    store.update({ background: 'desert' });
    expect(seen).toEqual(['first:desert', 'second:desert', 'first:koi', 'second:koi']);
  });

  it('reports a failed write, keeps the change in memory and still notifies', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createSettingsStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.update({ uiSounds: false })).toBe(false);
    expect(store.get().uiSounds).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    consoleError.mockRestore();
    warn.mockRestore();
  });

  it('falls back to the defaults field by field for invalid stored JSON', () => {
    expect(loadSettings(memoryStorage('{not json'))).toEqual(DEFAULT_SETTINGS);
    const partial = loadSettings(
      memoryStorage(
        JSON.stringify({
          uiSounds: false,
          background: 'no-such-background',
          handColor: '#ABCDEF',
          filtering: { mode: 'bogus' },
          arrangement: 7,
        }),
      ),
    );
    expect(partial.uiSounds).toBe(false);
    expect(partial.handColor).toBe('#abcdef');
    expect(partial.background).toBe(DEFAULT_SETTINGS.background);
    expect(partial.filtering).toEqual(DEFAULT_SETTINGS.filtering);
    expect(partial.arrangement).toBe(DEFAULT_SETTINGS.arrangement);
  });

  it('keeps a store without storage in memory and ignores localStorage', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ uiSounds: false }));
    try {
      const store = createSettingsStore();
      expect(store.get()).toEqual(DEFAULT_SETTINGS);
      store.update({ uiSounds: false });
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')).toEqual({ uiSounds: false });
    } finally {
      localStorage.clear();
    }
  });

  it('does not share default objects between stores', () => {
    const first = createSettingsStore();
    first.get().filtering.mode = 'nearest';
    expect(createSettingsStore().get().filtering.mode).toBe(DEFAULT_SETTINGS.filtering.mode);
  });
});

describe('settings shared by the browser presenter and the XR scene', () => {
  it('starts the scene from the stored settings', () => {
    const storage = memoryStorage(
      JSON.stringify({
        uiSounds: false,
        background: 'koi',
        handColor: '#112233',
        weatherZip: '90210',
        accentColor: '#ff8800',
      }),
    );
    const { workspace } = fixture({ settings: createSettingsStore(storage) });
    expect(workspace.state.uiSounds).toBe(false);
    expect(workspace.state.background).toBe('koi');
    expect(workspace.state.handColor).toBe('#112233');
    expect(workspace.state.weatherZip).toBe('90210');
    expect(workspace.state.accentColor).toBe('#ff8800');
    expect(accent.hex).toBe(resolveAccent('#ff8800'));
    workspace.dispose();
  });

  it('applies a scene setter to the store and the browser controls without a bridge', () => {
    const storage = memoryStorage();
    const settings = createSettingsStore(storage);
    const { workspace } = fixture({ settings });
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined }, { settings });
    workspace.setBackground('desert');
    workspace.setUISounds(false);
    workspace.setHandColor('#445566');
    expect(settings.get()).toMatchObject({
      background: 'desert',
      uiSounds: false,
      handColor: '#445566',
    });
    expect(ui.getSettings().background).toBe('desert');
    expect(root.querySelector<HTMLSelectElement>('[data-background]')?.value).toBe('desert');
    expect(root.querySelector<HTMLInputElement>('[data-ui-sounds]')?.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>('[data-hand-color]')?.value).toBe('#445566');
    expect(stored(storage)).toMatchObject({ background: 'desert', uiSounds: false });
    ui.destroy();
    workspace.dispose();
  });

  it('applies a browser change to the scene and persists it once', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const settings = createSettingsStore(storage);
    const { workspace } = fixture({ settings });
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined }, { settings });
    setItem.mockClear();
    const checkbox = root.querySelector<HTMLInputElement>('[data-ui-sounds]');
    if (!checkbox) throw new Error('UI sounds control missing');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(workspace.state.uiSounds).toBe(false);
    expect(setItem).toHaveBeenCalledTimes(1);
    ui.destroy();
    workspace.dispose();
  });

  it('shows a notice when a scene setter cannot save', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { workspace } = fixture({ settings: createSettingsStore(storage) });
    workspace.setUISounds(false);
    expect(workspace.state.uiSounds).toBe(false);
    expect(workspace.state.notice).toBe('Settings could not be saved on this device.');
    warn.mockRestore();
    consoleError.mockRestore();
    workspace.dispose();
  });

  it('keeps terminal color mode and keyboard background session-only when set from the scene', () => {
    const storage = memoryStorage();
    const settings = createSettingsStore(storage);
    const { workspace } = fixture({ settings });
    workspace.setTerminalColorMode('monochrome');
    workspace.setKeyboardBackgroundEnabled(false);
    expect(workspace.state.terminalColorMode).toBe('monochrome');
    expect(workspace.state.keyboardBackgroundEnabled).toBe(false);
    expect(storage.values.size).toBe(0);
    workspace.dispose();
  });
});
