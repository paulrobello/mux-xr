import { describe, expect, it } from 'vitest';
import type { PaneDescriptor } from '../src/contracts';
import {
  createOpenViewsStore,
  normalizeOpenViewsServer,
  type OpenViewsProfile,
  resolveOpenViews,
} from '../src/workspace/open-views';

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

const profile: OpenViewsProfile = {
  views: [{ paneId: '%1', workspaceId: 'w', sessionId: 's', windowId: 'win', title: 'Terminal' }],
  selectedId: '%1',
};

const pane = (id: string, windowId = 'win'): PaneDescriptor => ({
  id,
  workspaceId: 'w',
  workspaceName: 'W',
  sessionId: 's',
  sessionName: 'S',
  windowId,
  windowName: 'Win',
  title: id,
});

describe('open terminal views', () => {
  it('keeps profiles separate, including an explicitly empty profile', () => {
    const storage = memoryStorage();
    const store = createOpenViewsStore(storage);
    expect(store.read('ws://one/ws')).toBeNull();
    expect(store.save('ws://one/ws', { views: [], selectedId: null })).toBe(true);
    expect(store.read('ws://one/ws')).toEqual({ views: [], selectedId: null });
    expect(store.read('ws://two/ws')).toBeNull();
  });

  it('handles malformed and quota-failing storage safely', () => {
    const storage = memoryStorage();
    const store = createOpenViewsStore(storage);
    storage.setItem('mux-xr:open-views:v1:ws%3A%2F%2Fone%2Fws', '{bad');
    expect(store.read('ws://one/ws')).toBeNull();
    const failing = memoryStorage();
    failing.setItem = () => {
      throw new Error('quota');
    };
    expect(createOpenViewsStore(failing).save('ws://one/ws', profile)).toBe(false);
  });

  it('normalizes authenticated HTTP and WebSocket endpoints to stable ws paths', () => {
    expect(normalizeOpenViewsServer('https://user:pass@example.com/base?token=x#fragment')).toBe(
      'wss://example.com/base/ws',
    );
    expect(normalizeOpenViewsServer('ws://example.com/base/ws?x=1')).toBe(
      'ws://example.com/base/ws',
    );
  });

  it('resolves only panes with matching hierarchy and never creates missing views', () => {
    const result = resolveOpenViews(
      {
        ...profile,
        views: [...profile.views, { ...profile.views[0], paneId: '%2', windowId: 'other' }],
      },
      [pane('%1')],
    );
    expect(result.views.map((view) => view.paneId)).toEqual(['%1']);
    expect(result.missing.map((view) => view.paneId)).toEqual(['%2']);
    expect(result.selectedId).toBe('%1');
  });
});
