vi.mock('../src/xr/labels', () => import('./helpers/labels'));

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
      connect() {},
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
      workspace.setGazeEnabled(true);
      workspace.setGazeEnabled(false);
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
});
