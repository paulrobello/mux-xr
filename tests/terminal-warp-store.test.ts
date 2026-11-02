import { describe, expect, it } from 'vitest';
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

  it('returns false when storage is unavailable or blocked', () => {
    expect(createTerminalWarpStore(null).set('pane', 20)).toBe(false);
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(createTerminalWarpStore(storage).set('pane', 20)).toBe(false);
  });
});
