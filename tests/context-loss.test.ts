vi.mock('@par/xr-workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@par/xr-workspace')>();
  return {
    ...actual,
    ...(await import('./helpers/labels')),
    createStandardHand: actual.createCartoonHand,
  };
});

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    xr = {
      enabled: false,
      isPresenting: false,
      getController: () => new actual.Group(),
      getHand: () => new actual.Group(),
      getCamera: () => new actual.PerspectiveCamera(),
      setReferenceSpaceType: vi.fn(),
      setSession: vi.fn(async () => undefined),
    };
    capabilities = { getMaxAnisotropy: () => 1 };
    setPixelRatio(_ratio: number): void {}
    setSize(_width: number, _height: number, _updateStyle?: boolean): void {}
    autoClear = true;
    clearDepth(): void {}
    setAnimationLoop(_callback: ((time: number) => void) | null): void {}
    render(scene: { updateMatrixWorld(force?: boolean): void }): void {
      scene.updateMatrixWorld(true);
    }
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import type * as THREE from 'three';
import type { PaneDescriptor, TerminalSurface, WorkspaceActions } from '../src/contracts';
import { createWorkspaceScene } from '../src/xr/scene';

const NOTICE = 'The headset reclaimed graphics memory. Restoring the workspace.';

const pane = (id: string): PaneDescriptor => ({
  id,
  title: id,
  workspaceId: 'workspace',
  workspaceName: 'Workspace',
  sessionId: 'session',
  sessionName: 'Session',
  windowId: 'window',
  windowName: 'Window',
});

function surface(descriptor: PaneDescriptor): TerminalSurface {
  return {
    canvas: document.createElement('canvas'),
    pane: descriptor,
    revision: 0,
    cols: 80,
    rows: 24,
    status: 'connected',
    error: null,
    connect() {},
    disconnect() {},
    sendText: () => true,
    sendKey: () => true,
    paste: () => true,
    focus() {},
    resizeGrid: () => true,
    canResizeGrid: true,
    setColorMode: () => undefined,
    dispose() {},
    subscribe() {
      return () => undefined;
    },
  };
}

const cleanups: Array<() => void> = [];

function fixture() {
  const actions: WorkspaceActions = {
    selectPane: vi.fn(),
    closePane: vi.fn(),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    runCommand: vi.fn(),
    openKeyboard: vi.fn(),
    openCommands: vi.fn(),
  };
  const container = document.createElement('div');
  const workspace = createWorkspaceScene(container, actions);
  const terminal = surface(pane('pane-a'));
  workspace.addTerminal(terminal);
  workspace.scene.updateMatrixWorld(true);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    workspace.dispose();
    container.remove();
  };
  cleanups.push(dispose);
  return { workspace, dispose };
}

const terminalTexture = (workspace: ReturnType<typeof createWorkspaceScene>): THREE.Texture => {
  const screen = workspace.scene.getObjectByName('terminal-surface') as THREE.Mesh | undefined;
  const map = (screen?.material as THREE.MeshBasicMaterial | undefined)?.map;
  if (!map) throw new Error('terminal texture missing');
  return map;
};

const lostEvent = (): Event => new Event('webglcontextlost', { cancelable: true });

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('WebGL context loss', () => {
  it('prevents the default on loss so three.js can restore, and shows a notice', () => {
    const { workspace } = fixture();
    const event = lostEvent();
    workspace.canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(workspace.state.notice).toBe(NOTICE);
  });

  it('clears the notice and re-uploads terminal textures on restore', () => {
    const { workspace } = fixture();
    const before = terminalTexture(workspace).version;
    workspace.canvas.dispatchEvent(lostEvent());
    workspace.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(workspace.state.notice).toBeNull();
    expect(terminalTexture(workspace).version).toBeGreaterThan(before);
  });

  it('keeps an unrelated notice that replaced the context-loss one', () => {
    const { workspace } = fixture();
    workspace.canvas.dispatchEvent(lostEvent());
    workspace.setNotice('Streamer disconnected');
    workspace.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(workspace.state.notice).toBe('Streamer disconnected');
  });

  it('stops listening once disposed', () => {
    const { workspace, dispose } = fixture();
    const canvas = workspace.canvas;
    dispose();
    const event = lostEvent();
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
