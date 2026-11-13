import { describe, expect, it, vi } from 'vitest';
import { createTerminalWarpStore } from '../src/xr/terminal-warp-store';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe('terminal warp store', () => {
  it('uses a new-window default only when the pane has no saved opacity', () => {
    const storage = memoryStorage();
    const store = createTerminalWarpStore(storage);
    store.set('curvature-only', 25);
    store.setOpacity('custom', 0.7);
    expect(store.getOpacity('new', 0.4)).toBe(0.4);
    expect(store.getOpacity('curvature-only', 0.4)).toBe(0.4);
    expect(store.getOpacity('custom', 0.4)).toBe(0.7);
    expect(createTerminalWarpStore(null).getOpacity('new', 0.4)).toBe(0.4);
  });
  it('uses a curvature fallback only when the pane has no saved curvature', () => {
    const store = createTerminalWarpStore(memoryStorage());
    store.set('saved-flat', 0);
    store.setOpacity('opacity-only', 0.5);
    expect(store.get('new', 30)).toBe(30);
    expect(store.get('opacity-only', 30)).toBe(30);
    expect(store.get('saved-flat', 30)).toBe(0);
    expect(createTerminalWarpStore(null).get('new', 30)).toBe(30);
  });
  it('stores values by opaque pane identity and clamps them to degrees', () => {
    const store = createTerminalWarpStore(memoryStorage());
    expect(store.get('workspace/session/window/pane')).toBe(0);
    expect(store.set('workspace/session/window/pane', 42.5)).toBe(true);
    expect(store.get('workspace/session/window/pane')).toBe(42.5);
    expect(store.set('other', -10)).toBe(true);
    expect(store.set('high', 101)).toBe(true);
    expect(store.get('other')).toBe(0);
    expect(store.get('high')).toBe(100);
    expect(store.set('nan', Number.NaN)).toBe(true);
    expect(store.get('nan')).toBe(0);
  });

  it('tolerates malformed and unknown-version documents', () => {
    const storage = memoryStorage();
    storage.setItem('mux-xr:terminal-warp:v1', '{bad');
    expect(createTerminalWarpStore(storage).get('pane')).toBe(0);
    storage.setItem(
      'mux-xr:terminal-warp:v1',
      JSON.stringify({ version: 99, values: { pane: 75 } }),
    );
    expect(createTerminalWarpStore(storage).get('pane')).toBe(0);
  });

  it('persists opacity beside legacy curvature values and clamps it', () => {
    const storage = memoryStorage();
    const store = createTerminalWarpStore(storage);
    expect(store.getOpacity('pane')).toBe(1);
    expect(store.set('pane', 42)).toBe(true);
    expect(store.setOpacity('pane', 0.35)).toBe(true);
    expect(store.get('pane')).toBe(42);
    expect(store.getOpacity('pane')).toBe(0.35);
    expect(store.setOpacity('low', -1)).toBe(true);
    expect(store.setOpacity('high', 2)).toBe(true);
    expect(store.setOpacity('nan', Number.NaN)).toBe(true);
    expect(store.getOpacity('low')).toBe(0.1);
    expect(store.getOpacity('high')).toBe(1);
    expect(store.getOpacity('nan')).toBe(1);
    const document = JSON.parse(storage.getItem('mux-xr:terminal-warp:v1') ?? '{}');
    expect(document.values.pane).toBe(42);
    expect(document.opacity.pane).toBe(0.35);
  });

  it('commits the changed appearance fields in one storage write', () => {
    const storage = memoryStorage();
    const write = vi.spyOn(storage, 'setItem');
    const store = createTerminalWarpStore(storage);
    expect(store.setAppearance('pane', { degrees: 27, opacity: 0.45 })).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(store.get('pane')).toBe(27);
    expect(store.getOpacity('pane')).toBe(0.45);
    expect(store.setAppearance('opacity-only', { opacity: 0.6 })).toBe(true);
    expect(store.get('opacity-only', 42)).toBe(42);
  });

  it('returns false when storage is unavailable or blocked', () => {
    expect(createTerminalWarpStore(null).set('pane', 20)).toBe(false);
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(createTerminalWarpStore(storage).set('pane', 20)).toBe(false);
  });
  it('clears both saved values for one key and persists the change', () => {
    const storage = memoryStorage();
    const store = createTerminalWarpStore(storage);
    store.set('a', 70);
    store.setOpacity('a', 0.3);
    store.set('b', 20);
    store.setOpacity('b', 0.8);
    expect(store.clear('a')).toBe(true);
    const reopened = createTerminalWarpStore(storage);
    expect(reopened.get('a', 30)).toBe(30);
    expect(reopened.getOpacity('a', 0.6)).toBe(0.6);
    expect(reopened.get('b', 30)).toBe(20);
    expect(reopened.getOpacity('b', 0.6)).toBe(0.8);
    expect(store.clear('never-saved')).toBe(true);
    expect(createTerminalWarpStore(null).clear('a')).toBe(false);
  });
});
