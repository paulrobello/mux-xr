vi.mock('@par/xr-workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@par/xr-workspace')>();
  return {
    ...actual,
    ...(await import('./helpers/labels')),
    createStandardHand: actual.createCartoonHand,
  };
});
vi.mock('three', async (importOriginal) => {
  const { createThreeMock } = await import('./helpers/xr-mocks');
  return createThreeMock(await importOriginal<typeof import('three')>());
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createSettingsStore } from '../src/settings/store';

const apps: Array<{ dispose(): void }> = [];

function mountApp(settings = createSettingsStore()) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = createApp(root, { settings });
  apps.push(app);
  return { app, root };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 404 })),
  );
});

afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
  document.body.innerHTML = '';
  delete window.__muxXR;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createApp', () => {
  it('constructs every presenter without reaching a later binding and installs the debug API', () => {
    const { root } = mountApp();
    expect(window.__muxXR).toBeDefined();
    expect(root.querySelector('.sidebar')).not.toBeNull();
    expect(window.__muxXR?.getState()).toMatchObject({
      demo: false,
      endpoint: '',
      selectedId: null,
      attached: [],
    });
  });

  it('starts the demo, attaches its panes through every presenter and selects one', () => {
    const { app, root } = mountApp();
    app.startDemo();
    const state = window.__muxXR?.getState();
    expect(state?.demo).toBe(true);
    expect(state?.attached.length).toBeGreaterThan(0);
    // No pane sits in a workspace named "default", so the last pane the loop attaches stays selected.
    expect(state?.attached).toEqual(['demo-1', 'demo-2']);
    expect(state?.selectedId).toBe('demo-2');
    expect(state?.streams.map((stream) => stream.id)).toEqual(state?.attached);
    expect(state?.panels.length).toBe(state?.attached.length);
    expect(root.querySelector('.demo-badge')?.hasAttribute('hidden')).toBe(false);
  });

  it('closes a demo pane through the debug API and clears the attached list', () => {
    const { app } = mountApp();
    app.startDemo();
    for (const id of window.__muxXR?.getState().attached ?? []) window.__muxXR?.closePane(id);
    expect(window.__muxXR?.getState().attached).toEqual([]);
    expect(window.__muxXR?.getState().selectedId).toBeNull();
  });

  it('uses the saved endpoint and proposes a different one without connecting', () => {
    const settings = createSettingsStore();
    settings.update({ endpoint: ' ws://saved.test ' }, { persist: false });
    const { app, root } = mountApp(settings);
    expect(app.savedEndpoint()).toBe('ws://saved.test');
    app.proposeEndpoint('ws://linked.test', 'This link names a different streamer.');
    expect(root.querySelector<HTMLInputElement>('#endpoint')?.value).toBe('ws://linked.test');
    expect(window.__muxXR?.getState().endpoint).toBe('');
  });

  it('disposes twice without throwing', () => {
    const { app } = mountApp();
    app.startDemo();
    expect(() => {
      app.dispose();
      app.dispose();
    }).not.toThrow();
  });
});
