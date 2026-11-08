vi.mock('../src/xr/labels', () => import('./helpers/labels'));
vi.mock('../src/xr/ui-environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/xr/ui-environment')>();
  return { ...actual, createUIEnvironment: vi.fn(actual.createUIEnvironment) };
});

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { TerminalStatus, TerminalSurface, WorkspaceActions } from '../src/contracts';
import type { GazeState } from '../src/xr/scene';
import {
  applyPanelTransform,
  captureInputTarget,
  clearInputTarget,
  createWorkspaceScene,
  pageRange,
  routeInput,
  updateGaze,
} from '../src/xr/scene';
import { createUIEnvironment, UI_ENV_MAP_INTENSITY } from '../src/xr/ui-environment';

describe('XR scene interaction helpers', () => {
  it('clamps physical panel scale without touching terminal grid dimensions', () => {
    const object = new THREE.Group();
    applyPanelTransform(object, { position: new THREE.Vector3(1, 2, 3), scale: 8 });
    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect(object.scale.x).toBe(3);
  });

  it('requires a stable dwell before gaze emphasis and clears on loss', () => {
    let gaze: GazeState = { candidateId: null, emphasizedId: null, since: 0 };
    gaze = updateGaze(gaze, 'pane-a', 100);
    expect(gaze.emphasizedId).toBeNull();
    gaze = updateGaze(gaze, 'pane-a', 449);
    expect(gaze.emphasizedId).toBeNull();
    gaze = updateGaze(gaze, 'pane-a', 450);
    expect(gaze.emphasizedId).toBe('pane-a');
    expect(updateGaze(gaze, null, 500).emphasizedId).toBeNull();
  });

  it('routes explicit key targets through sendKey, not sendText', () => {
    const actions: WorkspaceActions = {
      selectPane: vi.fn(),
      closePane: vi.fn(),
      sendText: vi.fn(),
      sendKey: vi.fn(),
      runCommand: vi.fn(),
      openKeyboard: vi.fn(),
      openCommands: vi.fn(),
    };
    expect(routeInput({ terminalId: 'pane-a', kind: 'key' }, 'Control', actions)).toBe(true);
    expect(actions.sendKey).toHaveBeenCalledWith('Control');
    expect(actions.sendText).not.toHaveBeenCalled();
  });

  it('captures and clears menu targets without retargeting', () => {
    expect(captureInputTarget('pane-a', 'Agent')).toEqual({ id: 'pane-a', title: 'Agent' });
    expect(clearInputTarget()).toEqual({ id: null, title: null });
  });

  it('pages command or hierarchy entries with bounded cyclic ranges', () => {
    expect(pageRange(9, 0, 8)).toEqual({ start: 0, end: 8, page: 0 });
    expect(pageRange(9, 1, 8)).toEqual({ start: 8, end: 9, page: 1 });
    expect(pageRange(9, 2, 8)).toEqual({ start: 0, end: 8, page: 0 });
  });

  it('preserves physical size across gaze toggles and updates proportional status labels', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    let status: TerminalStatus = 'disconnected';
    let emit = (): void => undefined;
    const surface: TerminalSurface = {
      canvas: document.createElement('canvas'),
      pane: {
        id: '%7',
        title: 'Agent',
        workspaceId: '+1',
        workspaceName: 'Work',
        sessionId: '$1',
        sessionName: 'Dev',
        windowId: '@1',
        windowName: 'Shell',
      },
      revision: 0,
      cols: 80,
      rows: 24,
      get status() {
        return status;
      },
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
      subscribe(listener) {
        emit = listener;
        return () => undefined;
      },
    };
    const actions: WorkspaceActions = {
      selectPane: vi.fn(),
      closePane: vi.fn(),
      sendText: vi.fn(),
      sendKey: vi.fn(),
      runCommand: vi.fn(),
      openKeyboard: vi.fn(),
      openCommands: vi.fn(),
    };
    const workspace = createWorkspaceScene(container, actions);
    try {
      workspace.addTerminal(surface);
      const panel = workspace.scene.getObjectByName('terminal-panel-%7');
      if (!panel) throw new Error('Panel was not created');
      applyPanelTransform(panel, { scale: 1.6 });
      workspace.setGazeInputEnabled(true);
      workspace.setGazeInputEnabled(false);
      expect(panel.scale.x).toBe(1.6);
      expect(surface.cols).toBe(80);
      const title = panel.children.find(
        (child) => child.userData.labelText === 'Agent · disconnected',
      );
      if (!(title instanceof THREE.Mesh)) throw new Error('Panel title was not created');
      const material = title.material as THREE.MeshBasicMaterial;
      const initialMap = material.map;
      status = 'connected';
      emit();
      expect(title.userData.labelText).toBe('Agent · connected');
      expect(material.map).toBe(initialMap);
      const stable = material.map;
      emit();
      expect(material.map).toBe(stable);
      workspace.setAvailablePanes([{ ...surface.pane, title: 'Renamed' }]);
      emit();
      expect(title.userData.labelText).toBe('Renamed · connected');
    } finally {
      workspace.dispose();
      container.remove();
      context.mockRestore();
      log.mockRestore();
    }
  });

  it('keeps the shared UI env map alive when a panel frame is disposed', () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const envMap = new THREE.Texture();
    envMap.userData.sharedUIEnvironment = true;
    const environmentDispose = vi.fn();
    envMap.addEventListener('dispose', environmentDispose);
    const releaseEnvironment = vi.fn();
    const warmPrograms = vi.fn();
    vi.mocked(createUIEnvironment).mockReturnValueOnce({
      texture: envMap,
      warmPrograms,
      dispose: releaseEnvironment,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const surface = (id: string): TerminalSurface => ({
      canvas: document.createElement('canvas'),
      pane: {
        id,
        title: `Agent ${id}`,
        workspaceId: '+1',
        workspaceName: 'Work',
        sessionId: '$1',
        sessionName: 'Dev',
        windowId: '@1',
        windowName: 'Shell',
      },
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
      subscribe: () => () => undefined,
    });
    const actions: WorkspaceActions = {
      selectPane: vi.fn(),
      closePane: vi.fn(),
      sendText: vi.fn(),
      sendKey: vi.fn(),
      runCommand: vi.fn(),
      openKeyboard: vi.fn(),
      openCommands: vi.fn(),
    };
    const workspace = createWorkspaceScene(container, actions);
    expect(warmPrograms).toHaveBeenCalledOnce();
    expect(warmPrograms.mock.calls[0]?.[0]).toBe(workspace.scene);
    try {
      workspace.addTerminal(surface('%1'));
      workspace.addTerminal(surface('%2'));
      const frameMaterial = (id: string): THREE.MeshStandardMaterial => {
        const frame = workspace.scene
          .getObjectByName(`terminal-panel-${id}`)
          ?.getObjectByName('terminal-frame') as THREE.Mesh | undefined;
        if (!frame) throw new Error(`Frame for ${id} was not created`);
        return frame.material as THREE.MeshStandardMaterial;
      };
      const survivor = frameMaterial('%2');
      expect(frameMaterial('%1').envMap).toBe(envMap);
      expect(survivor.envMap).toBe(envMap);
      expect(survivor.envMapIntensity).toBe(UI_ENV_MAP_INTENSITY);
      const watchCase = workspace.scene.getObjectByName('xr-wrist-menu-watch-case') as THREE.Mesh;
      expect((watchCase.material as THREE.MeshStandardMaterial).envMap).toBe(envMap);
      const screen = workspace.scene
        .getObjectByName('terminal-panel-%2')
        ?.getObjectByName('terminal-surface') as THREE.Mesh;
      expect((screen.material as THREE.MeshStandardMaterial).envMap ?? null).toBeNull();

      workspace.removeTerminal('%1');
      expect(workspace.scene.getObjectByName('terminal-panel-%1')).toBeUndefined();
      expect(environmentDispose).not.toHaveBeenCalled();
      expect(survivor.envMap).toBe(envMap);
    } finally {
      workspace.dispose();
      container.remove();
      context.mockRestore();
      log.mockRestore();
    }
    expect(environmentDispose).not.toHaveBeenCalled();
    expect(releaseEnvironment).toHaveBeenCalledOnce();
  });
});
