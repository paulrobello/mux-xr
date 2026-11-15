import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@par/xr-workspace', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).withLabelsAndCountingHand(
    await importOriginal<typeof import('@par/xr-workspace')>(),
  ),
);
vi.mock('three', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).createThreeMock(
    await importOriginal<typeof import('three')>(),
  ),
);

import * as THREE from 'three';
import type { PaneDescriptor } from '../../src/contracts';
import type { createWorkspaceScene } from '../../src/xr/scene';
import {
  aimController,
  connectController,
  fakeXR,
  fixture,
  hit,
  objectWithData,
  pane,
  pressFocusButton,
  resetXRControllers,
  settleHierarchy,
  surface,
} from '../helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

  it('does not rearrange existing panels when another terminal is attached', () => {
    const { workspace, container } = fixture();
    workspace.arrangeTerminals('sphere');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
    const position = panel.position.clone();
    workspace.addTerminal(surface(pane('pane-c')));
    expect(panel.position.distanceTo(position)).toBeLessThan(1e-9);
    workspace.dispose();
    container.remove();
  });

  it('creates a workspace quick command through native keys without executing the draft', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'newCommand' });
    for (const key of ['p', 'w', 'd']) hit(workspace, { inputAction: 'key', key });
    hit(workspace, { inputAction: 'commandField', field: 'text' });
    for (const key of ['p', 'w', 'd']) hit(workspace, { inputAction: 'key', key });
    hit(workspace, { inputAction: 'commandScope' });
    hit(workspace, { inputAction: 'commandNewline' });
    hit(workspace, { inputAction: 'commandSave' });
    expect(actions.saveCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'pwd',
        text: 'pwd',
        sendNewline: false,
        workspaceId: 'workspace',
      }),
    );
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(actions.runCommand).not.toHaveBeenCalled();
    expect(workspace.scene.getObjectByName('xr-command-editor-controls')).toBeUndefined();
    workspace.dispose();
    container.remove();
  });

  it('keeps an unsaved native command draft after validation or storage failure', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'newCommand' });
    hit(workspace, { inputAction: 'commandSave' });
    expect(actions.saveCommand).not.toHaveBeenCalled();
    hit(workspace, { inputAction: 'key', key: 'x' });
    hit(workspace, { inputAction: 'commandField', field: 'text' });
    hit(workspace, { inputAction: 'key', key: 'x' });
    if (!actions.saveCommand) throw new Error('Missing command save fixture');
    vi.mocked(actions.saveCommand).mockReturnValue(false);
    hit(workspace, { inputAction: 'commandSave' });
    expect(workspace.scene.getObjectByName('xr-command-editor-controls')).toBeDefined();
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('retains the active pane marker while looking at another pane with gaze input off', () => {
    const { workspace, container } = fixture();
    workspace.camera.lookAt(0.87, 1.5, -1.5);
    fakeXR.frame?.(0);
    fakeXR.frame?.(800);
    const glow = (id: string): number => {
      const panel = workspace.scene.getObjectByName(`terminal-panel-${id}`) as THREE.Group;
      const frame = panel.getObjectByName('terminal-frame') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;
      return frame.material.emissiveIntensity;
    };
    expect(glow('pane-a')).toBeGreaterThan(0);
    expect(glow('pane-b')).toBe(0);
    workspace.dispose();
    container.remove();
  });

  it('anchors tooltip pose and size until the next hover while avoiding control bounds', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
    const key = objectWithData(workspace, { inputAction: 'key', key: 'Shift' });
    const controller = fakeXR.controllers[0] as THREE.Group;
    aimController(controller, key);
    fakeXR.frame?.(0);
    fakeXR.frame?.(800);
    const tip = workspace.scene.getObjectByName('xr-hover-help') as THREE.Mesh;
    const nearScale = tip.scale.x;
    const tipPosition = tip.position.clone();
    const tipQuaternion = tip.quaternion.clone();
    workspace.camera.rotation.y += 0.3;
    keyboard.position.z -= 2;
    aimController(controller, key);
    fakeXR.frame?.(1600);
    expect(tip.visible).toBe(true);
    expect(tip.scale.x).toBe(nearScale);
    expect(tip.position.distanceTo(tipPosition)).toBeLessThan(1e-6);
    expect(tip.quaternion.angleTo(tipQuaternion)).toBeLessThan(1e-6);
    expect(tip.scale.x).toBeLessThanOrEqual(6);
    workspace.dispose();
    container.remove();
  });

  it('keeps the update control XR-only and routes one explicit reload without ending XR', () => {
    const { workspace, actions, container } = fixture();
    fakeXR.presenting = false;
    workspace.setUpdateAvailable(true);
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    const notice = hud?.children.find((child) => child.userData.inputAction === 'reloadUpdate');
    if (!notice) throw new Error('XR update notice not found');
    expect(notice.visible).toBe(false);
    expect(() => hit(workspace, { inputAction: 'reloadUpdate' })).toThrow('Control not found');
    workspace.showInput('keyboard');
    const inputRoot = workspace.scene.getObjectByName('xr-keyboard-controls');
    const targetId = workspace.state.inputTargetId;
    fakeXR.presenting = true;
    fakeXR.frame?.(16);
    expect(notice.visible).toBe(true);
    hit(workspace, { inputAction: 'reloadUpdate' });
    expect(actions.reloadApp).toHaveBeenCalledOnce();
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(workspace.state.inputTargetId).toBe(targetId);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBe(inputRoot);
    workspace.dispose();
    container.remove();
  });

  it('exitXR awaits the active session end and propagates rejection', async () => {
    let resolveEnd: (() => void) | undefined;
    const end = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEnd = resolve;
        }),
    );
    const session = {
      addEventListener: vi.fn(),
      end,
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    await workspace.enterXR('vr');
    let settled = false;
    const exiting = workspace.exitXR().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(end).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    resolveEnd?.();
    await exiting;
    expect(settled).toBe(true);
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('exitXR propagates an active session end rejection', async () => {
    const failure = new Error('session end failed');
    const session = { addEventListener: vi.fn(), end: vi.fn(async () => Promise.reject(failure)) };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    await workspace.enterXR('vr');
    await expect(workspace.exitXR()).rejects.toBe(failure);
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('bounds desktop panel growth without exposing XR recovery controls', () => {
    fakeXR.presenting = false;
    const { workspace, right, container } = fixture();
    workspace.selectTerminal('pane-b');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!panel) throw new Error('Pane B missing');
    for (let step = 0; step < 30; step += 1) workspace.scaleSelectedPanel(1);
    expect(panel.scale.x).toBeLessThan(1.8);
    const bounds = new THREE.Box3().setFromObject(panel);
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(workspace.camera);
          expect(Math.abs(point.x)).toBeLessThanOrEqual(0.981);
          expect(Math.abs(point.y)).toBeLessThanOrEqual(0.981);
        }
    fakeXR.presenting = true;
    fakeXR.frame?.(16);
    workspace.showInput('keyboard');
    const xrRoots = [
      workspace.scene.getObjectByName('xr-keyboard-controls'),
      workspace.scene.getObjectByName('xr-workspace-hud'),
    ];
    for (const root of xrRoots) {
      root?.traverse((object) => {
        expect(['inputScale', 'inputReset', 'selectedScale', 'resetLayout']).not.toContain(
          object.userData.inputAction,
        );
      });
    }
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('bounds desktop panel shrink at the physical minimum without resizing the PTY', () => {
    fakeXR.presenting = false;
    const { workspace, right, container } = fixture();
    workspace.selectTerminal('pane-b');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!panel) throw new Error('Pane B missing');
    for (let step = 0; step < 30; step += 1) workspace.scaleSelectedPanel(-1);
    expect(panel.scale.x).toBeCloseTo(0.3, 6);
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('routes browser hover and clicks through terminal lifecycle controls', () => {
    fakeXR.presenting = false;
    const { workspace, actions, container, right } = fixture();
    Object.defineProperty(workspace.canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    });
    const pointer = (type: string, action: string): void => {
      const control = workspace
        .getControlHints()
        .find((hint) => hint.inputAction === action && hint.terminalId === 'pane-b');
      if (!control) throw new Error(`Terminal control missing: ${action}`);
      workspace.canvas.dispatchEvent(
        new PointerEvent(type, { clientX: control.clientX, clientY: control.clientY }),
      );
    };
    pointer('pointermove', 'toggleConnection');
    expect(workspace.canvas.title).toContain('Disconnect');
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
    pointer('pointerdown', 'toggleConnection');
    expect(actions.togglePaneConnection).toHaveBeenLastCalledWith('pane-b');
    pointer('pointermove', 'closePane');
    expect(workspace.canvas.title).toContain('shell keeps running');
    pointer('pointerdown', 'closePane');
    expect(actions.closePane).toHaveBeenLastCalledWith('pane-b');
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(workspace.canvas.title).toBe('');
    workspace.dispose();
    container.remove();
  });

  it('delays compact action hints and hides them while gripping', () => {
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-b');
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'Tab' }, 'hover');
    fakeXR.frame?.(0);
    fakeXR.frame?.(699);
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
    fakeXR.frame?.(701);
    const tooltip = workspace.scene.getObjectByName(
      'xr-hover-help',
    ) as THREE.Mesh<THREE.PlaneGeometry>;
    expect(tooltip.visible).toBe(true);
    expect(tooltip.geometry.parameters.width).toBeLessThanOrEqual(0.32);
    expect(tooltip.geometry.parameters.height).toBeLessThanOrEqual(0.05);
    expect(actions.sendKey).not.toHaveBeenCalled();
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    fakeXR.frame?.(750);
    expect(tooltip.visible).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('routes selectstart from Three EventDispatcher without DOM currentTarget', () => {
    const { workspace, actions, container } = fixture();
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.set(0.87, 1.5, 0);
    workspace.scene.updateMatrixWorld(true);
    expect(() => controller.dispatchEvent({ type: 'selectstart' } as never)).not.toThrow();
    expect(actions.selectPane).toHaveBeenCalledWith('pane-b');
    workspace.dispose();
    container.remove();
  });

  it('keeps the surface-aligned frame grabbable from behind', () => {
    const { workspace, container } = fixture();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const frame = panel?.getObjectByName('terminal-frame') as THREE.Mesh | undefined;
    if (!panel || !frame) throw new Error('Frame missing');
    workspace.scene.updateMatrixWorld(true);
    const orientation = panel.getWorldQuaternion(new THREE.Quaternion());
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position
      .copy(panel.localToWorld(new THREE.Vector3(1.42 / 2 + 0.00875, 0, 0)))
      .add(new THREE.Vector3(0, 0, -0.3).applyQuaternion(orientation));
    controller.quaternion
      .copy(orientation)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    const before = panel.position.clone();
    controller.dispatchEvent({ type: 'squeezestart' } as never);
    controller.position.x += 0.2;
    fakeXR.frame?.(16);
    expect(panel.position.x).toBeCloseTo(before.x + 0.2);
    workspace.dispose();
    container.remove();
  });

  it('keeps squeeze drag relative rotation and stops on squeezeend', () => {
    const { workspace, actions, container, right } = fixture();
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.set(0.87, 1.5, 0);
    workspace.scene.updateMatrixWorld(true);
    expect(() => controller.dispatchEvent({ type: 'squeezestart' } as never)).not.toThrow();
    controller.position.x += 0.2;
    controller.rotation.y = 0.4;
    fakeXR.frame?.(16);
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b');
    const expected = new THREE.Vector3(0, 0, -1.5)
      .applyQuaternion(controller.quaternion)
      .add(controller.position);
    expect(panel?.position.distanceTo(expected)).toBeLessThan(0.000001);
    expect(right.resizeGrid).not.toHaveBeenCalled();
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    const stopped = panel?.position.clone();
    controller.position.x += 0.4;
    fakeXR.frame?.(32);
    expect(panel?.position.x).toBe(stopped?.x);
    expect(actions.selectPane).toHaveBeenCalledWith('pane-b');
    workspace.dispose();
    container.remove();
  });

  it('grips panel and HUD roots as movable workspace objects', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('keyboard');
    workspace.selectTerminal('pane-a');
    const paneA = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const paneB = workspace.scene.getObjectByName('terminal-panel-pane-b');
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!paneA || !paneB || !hud) throw new Error('Panel or HUD missing');
    const originalA = paneA.position.clone();
    const originalB = paneB.position.clone();
    const originalHud = hud.position.clone();
    hit(workspace, { terminalTitle: true, terminalId: 'pane-b' }, 'squeezestart');
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.x += 0.2;
    fakeXR.frame?.(16);
    expect(paneA.position.distanceTo(originalA)).toBeLessThan(0.000001);
    expect(paneB.position.x).toBeCloseTo(originalB.x + 0.2, 5);
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    hit(workspace, { inputAction: 'exit' }, 'squeezestart');
    controller.position.y += 0.2;
    fakeXR.frame?.(32);
    expect(hud.position.distanceTo(originalHud)).toBeGreaterThan(0.01);
    expect(workspace.state.gazeInputEnabled).toBe(false);
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('removing the dragged pane releases controller state and restores fallback focus', () => {
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-b');
    workspace.removeTerminal('pane-b');
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    expect(workspace.state.focusedTerminalId).toBe('pane-a');
    expect(actions.selectPane).toHaveBeenCalledWith('pane-b');
    workspace.dispose();
    container.remove();
  });

  it('retargets the native command HUD on explicit pane selection', () => {
    const { workspace, actions, container } = fixture();
    const command = { id: 'saved', label: 'Original', text: 'printf original', sendNewline: true };
    workspace.selectTerminal('pane-a');
    workspace.setQuickCommands([command]);
    workspace.showInput('commands');
    expect(workspace.state.inputTargetId).toBe('pane-a');
    const nextCommand = { ...command, text: 'printf changed' };
    workspace.setQuickCommands([nextCommand]);
    workspace.selectTerminal('pane-b');
    expect(workspace.state.inputTargetId).toBe('pane-b');
    hit(workspace, { inputAction: 'command', commandId: 'saved' });
    expect(actions.runCommand).toHaveBeenLastCalledWith(nextCommand, 'pane-b');
    hit(workspace, { inputAction: 'close' });
    expect(workspace.state.inputTargetId).toBeNull();
    workspace.dispose();
    container.remove();
  });

  it('retargets keyboard input on explicit selection and never activates a key with grip', () => {
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.showInput('keyboard');
    workspace.selectTerminal('pane-b');
    vi.mocked(actions.sendKey).mockClear();
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    expect(actions.sendKey).not.toHaveBeenCalled();
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    hit(workspace, { inputAction: 'key', key: 'a' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expect(vi.mocked(actions.sendKey).mock.calls.at(-1)?.[0]).toBe('a');
    workspace.dispose();
    container.remove();
  });

  it('clears controller hover and grip state when a source disconnects', () => {
    const { workspace, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'a' }, 'hover');
    fakeXR.frame?.(16);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'disconnected' } as never);
    fakeXR.frame?.(32);
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('routes the keyboard to the explicitly selected pane', () => {
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.selectTerminal('pane-b');
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'Enter' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expect(actions.sendKey).toHaveBeenLastCalledWith('Enter', undefined);
    workspace.dispose();
    container.remove();
  });

  it('updates native key captions for Shift and restores them after input', () => {
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.showInput('keyboard');
    const label = (key: string): string | undefined => {
      let found: string | undefined;
      workspace.scene.traverse((object) => {
        if (object.userData.inputAction === 'key' && object.userData.key === key)
          found = object.userData.labelText;
      });
      return found;
    };
    expect(label('a')).toBe('a');
    expect(label('Backspace')).toBe('⌫');
    hit(workspace, { inputAction: 'key', key: 'Shift' });
    expect(label('a')).toBe('A');
    expect(label('4')).toBe('$');
    hit(workspace, { inputAction: 'key', key: '4' });
    expect(actions.sendKey).toHaveBeenLastCalledWith('4', { shift: true });
    expect(label('a')).toBe('a');
    expect(label('4')).toBe('4');
    workspace.dispose();
    container.remove();
  });

  it('zooms terminal text in without tiling or resizing the PTY', () => {
    const { workspace, right, container } = fixture();
    workspace.selectTerminal('pane-b');
    workspace.showInput('terminal');
    hit(workspace, { inputAction: 'fontZoom', direction: 1, terminalId: 'pane-b' });
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b');
    const screen = panel?.getObjectByName('terminal-surface') as THREE.Mesh;
    const texture = (screen.material as THREE.MeshBasicMaterial).map;
    expect(texture?.repeat.x).toBeLessThan(1);
    expect(texture?.repeat.y).toBeLessThan(1);
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it.each(['helix', 'spatial-docks'] as const)(
    'requests an unattached pane through the %s hierarchy',
    (style) => {
      const { workspace, actions, left, right, container } = fixture();
      workspace.setHierarchyStyle(style);
      workspace.setAvailablePanes([left.pane, right.pane, pane('pane-c', 'Other')]);
      workspace.showInput('panes');
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Workspace' });
      settleHierarchy();
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Session' });
      settleHierarchy();
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Window' });
      settleHierarchy();
      hit(workspace, { inputAction: 'pane', paneId: 'pane-c' });
      expect(actions.selectPane).toHaveBeenLastCalledWith('pane-c');
      workspace.dispose();
      container.remove();
    },
  );

  it('opens an agent pane from the coalesced live Agents shortcut in the hierarchy', () => {
    vi.useFakeTimers();
    try {
      const { workspace, actions, left, right, container } = fixture();
      const target = pane('pane-c', 'Agent shell');
      workspace.setAvailablePanes([left.pane, right.pane, target]);
      workspace.showInput('panes');
      settleHierarchy();
      const row = (state: string) => ({
        paneId: 'pane-c',
        agent: 'claude',
        state,
        reason: state === 'question' ? 'Pick a plan' : '',
        workspace: 'workspace',
        project: '',
        paneLabel: '',
        source: 'hook',
        stalled: false,
        lastActivityAt: 0,
        lastReportAt: 0,
        lastInputAt: 0,
        lastViewedAt: 0,
        viewerCount: 0,
        cpuMs: 0,
        workspaceName: 'Workspace',
        title: 'Agent shell',
        sessionName: 'Session',
        windowName: 'Window',
      });
      expect(() => objectWithData(workspace, { originalTitle: 'Agents (1)' })).toThrow();
      // A burst of state flips rebuilds the menu once, with the latest rows.
      workspace.setAgentRoster([row('working')]);
      workspace.setAgentRoster([row('question')]);
      expect(() => objectWithData(workspace, { originalTitle: 'Agents (1)' })).toThrow();
      vi.advanceTimersByTime(400);
      expect(objectWithData(workspace, { originalTitle: 'Agents (1)' }).userData.helpText).toBe(
        'An agent needs attention · Open agents',
      );
      const timers = vi.getTimerCount();
      // A stamp no shown token reads (cpu is not in the full layout) never rebuilds.
      workspace.setAgentRoster([{ ...row('question'), cpuMs: 99 }]);
      expect(vi.getTimerCount()).toBe(timers);
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Agents (1)' });
      settleHierarchy();
      expect(
        objectWithData(workspace, { inputAction: 'pane', paneId: 'pane-c' }).userData.originalTitle,
      ).toBe('question · claude · Agent shell');
      expect(
        objectWithData(workspace, { inputAction: 'pane', paneId: 'pane-c' }).userData.helpText,
      ).toBe('question · claude · Agent shell · Workspace · pane-c · Pick a plan · Open pane');
      hit(workspace, { inputAction: 'pane', paneId: 'pane-c' });
      expect(actions.selectPane).toHaveBeenLastCalledWith('pane-c');
      workspace.showInput('panes');
      settleHierarchy();
      workspace.setAgentRoster([]);
      vi.advanceTimersByTime(400);
      expect(() => objectWithData(workspace, { originalTitle: 'claude · question' })).toThrow();
      workspace.dispose();
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a terminal from the session hierarchy and explains refusals', () => {
    const { workspace, actions, container } = fixture();
    const createPane = vi.fn();
    actions.createPane = createPane;
    workspace.showInput('panes');
    hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Workspace' });
    settleHierarchy();
    hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Session' });
    settleHierarchy();
    hit(workspace, { inputAction: 'createPane', sessionId: 'session' });
    expect(createPane).toHaveBeenCalledWith('session');
    workspace.closePaneSelector();
    expect(() => objectWithData(workspace, { inputAction: 'createPane' })).toThrow();
    const panels = workspace.scene.children.filter((object) =>
      object.name.startsWith('terminal-panel-'),
    );
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((object) => object.visible)).toBe(true);
    workspace.closePaneSelector();
    workspace.showInput('panes');
    hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Workspace' });
    settleHierarchy();
    hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Session' });
    settleHierarchy();
    workspace.setPaneCreation({
      available: false,
      pending: false,
      reason: 'Terminal creation is turned off on this streamer.',
    });
    settleHierarchy();
    hit(workspace, { inputAction: 'createPane', createAvailable: false });
    expect(createPane).toHaveBeenCalledTimes(1);
    expect(workspace.state.notice).toBe('Terminal creation is turned off on this streamer.');
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('applies a creation state change that arrives during a hierarchy transition', () => {
    vi.useFakeTimers();
    try {
      const { workspace, container } = fixture();
      workspace.showInput('panes');
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Workspace' });
      settleHierarchy();
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Session' });
      workspace.setPaneCreation({ available: true, pending: true, reason: 'Creating a terminal…' });
      settleHierarchy();
      workspace.setPaneCreation({ available: false, pending: false, reason: 'Turned off.' });
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Window' });
      workspace.setPaneCreation({ available: true, pending: false });
      settleHierarchy();
      vi.advanceTimersByTime(4000);
      const control = objectWithData(workspace, { inputAction: 'createPane' });
      expect(control.userData.createAvailable).toBe(true);
      expect(control.userData.originalTitle).toBe('New terminal');
      workspace.dispose();
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  const openPaneLevel = (workspace: ReturnType<typeof createWorkspaceScene>): void => {
    workspace.showInput('panes');
    for (const title of ['Workspace', 'Session', 'Window']) {
      hit(workspace, { inputAction: 'hierarchyNode', originalTitle: title });
      settleHierarchy();
    }
  };
  // main.ts attaches a missing pane's terminal, then selects it, which rebuilds the open input.
  const selectLikeMain = (
    workspace: ReturnType<typeof createWorkspaceScene>,
    actions: ReturnType<typeof fixture>['actions'],
    panes: PaneDescriptor[],
  ): void => {
    actions.selectPane = vi.fn((id: string) => {
      const descriptor = panes.find((item) => item.id === id);
      if (!descriptor) return;
      if (!workspace.scene.getObjectByName(`terminal-panel-${id}`))
        workspace.addTerminal(surface(descriptor));
      workspace.selectTerminal(id);
    });
  };
  const pullPane = (
    workspace: ReturnType<typeof createWorkspaceScene>,
    paneId: string,
    shift: THREE.Vector3,
  ): THREE.Vector3 => {
    const start = objectWithData(workspace, { inputAction: 'pane', paneId }).getWorldPosition(
      new THREE.Vector3(),
    );
    hit(workspace, { inputAction: 'pane', paneId }, 'squeezestart');
    expect(workspace.scene.getObjectByName('pane-pull-proxy')).toBeDefined();
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.add(shift);
    settleHierarchy();
    expect(workspace.scene.getObjectByName('pane-pull-proxy')?.scale.x).toBeGreaterThan(0.25);
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    expect(workspace.scene.getObjectByName('pane-pull-proxy')).toBeUndefined();
    return start.add(shift);
  };
  const expectDropped = (
    workspace: ReturnType<typeof createWorkspaceScene>,
    paneId: string,
    at: THREE.Vector3,
  ): void => {
    const panel = workspace.scene.getObjectByName(`terminal-panel-${paneId}`);
    if (!panel) throw new Error('Dropped panel missing');
    expect(panel.visible).toBe(true);
    expect(workspace.scene.getObjectByName('hierarchy-navigator')).toBeUndefined();
    expect(panel.position.distanceTo(at)).toBeLessThan(1e-3);
    const toHead = workspace.camera.getWorldPosition(new THREE.Vector3()).sub(panel.position);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(panel.quaternion);
    expect(facing.angleTo(toHead)).toBeLessThan(0.05);
    expect(workspace.captureTerminalPose(paneId)?.position[0]).toBeCloseTo(panel.position.x);
  };

  it('pulls an attached pane node out of the hierarchy and shows it where it is released', () => {
    const { workspace, actions, container, left, right } = fixture();
    selectLikeMain(workspace, actions, [left.pane, right.pane]);
    connectController(0);
    openPaneLevel(workspace);
    const at = pullPane(workspace, 'pane-b', new THREE.Vector3(0.6, 0.1, -0.3));
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expectDropped(workspace, 'pane-b', at);
    workspace.dispose();
    container.remove();
  });

  it('opens an unattached pane where its node is released', () => {
    const { workspace, actions, container, left, right } = fixture();
    const other = pane('pane-c', 'Other');
    selectLikeMain(workspace, actions, [left.pane, right.pane, other]);
    workspace.setAvailablePanes([left.pane, right.pane, other]);
    connectController(0);
    openPaneLevel(workspace);
    expect(workspace.scene.getObjectByName('terminal-panel-pane-c')).toBeUndefined();
    const at = pullPane(workspace, 'pane-c', new THREE.Vector3(-0.5, 0.2, -0.4));
    expectDropped(workspace, 'pane-c', at);
    workspace.dispose();
    container.remove();
  });

  it('ends Focus before dropping the focused pane so the drop survives', () => {
    const { workspace, actions, container, left, right } = fixture();
    selectLikeMain(workspace, actions, [left.pane, right.pane]);
    const gamepad = connectController(0);
    workspace.selectTerminal('pane-b');
    pressFocusButton(gamepad, 16);
    expect(workspace.state.focusModeTerminalId).toBe('pane-b');
    // Let Focus fade the other pane out, so the hierarchy records it hidden.
    for (let frame = 0; frame < 120; frame++) fakeXR.frame?.(32 + frame * 16);
    expect(workspace.scene.getObjectByName('terminal-panel-pane-a')?.visible).toBe(false);
    openPaneLevel(workspace);
    const at = pullPane(workspace, 'pane-b', new THREE.Vector3(0.5, 0, -0.5));
    expect(workspace.state.focusModeTerminalId).toBeNull();
    expectDropped(workspace, 'pane-b', at);
    settleHierarchy();
    expect(workspace.scene.getObjectByName('terminal-panel-pane-a')?.visible).toBe(true);
    workspace.dispose();
    container.remove();
  });

  it('drops a pane pull that barely moved without selecting the pane', () => {
    const { workspace, actions, container } = fixture();
    connectController(0);
    openPaneLevel(workspace);
    vi.mocked(actions.selectPane).mockClear();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b');
    const before = panel?.position.clone();
    hit(workspace, { inputAction: 'pane', paneId: 'pane-b' }, 'squeezestart');
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.x += 0.03;
    settleHierarchy();
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    expect(workspace.scene.getObjectByName('pane-pull-proxy')).toBeUndefined();
    expect(actions.selectPane).not.toHaveBeenCalled();
    expect(workspace.scene.getObjectByName('hierarchy-navigator')).toBeDefined();
    expect(panel?.position.distanceTo(before ?? new THREE.Vector3())).toBeLessThan(1e-6);
    workspace.dispose();
    container.remove();
  });

  it('still grabs the whole hierarchy from a non-pane node', () => {
    const { workspace, container } = fixture();
    connectController(0);
    workspace.showInput('panes');
    const root = workspace.scene.getObjectByName('hierarchy-navigator')?.parent;
    const before = root?.position.clone();
    hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Workspace' }, 'squeezestart');
    expect(workspace.scene.getObjectByName('pane-pull-proxy')).toBeUndefined();
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.3;
    settleHierarchy();
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    expect(root?.position.distanceTo(before ?? new THREE.Vector3())).toBeGreaterThan(0.2);
    workspace.dispose();
    container.remove();
  });

  it('keeps restored and grown panels above the authored floor', () => {
    const { workspace, left, container } = fixture();
    workspace.setBackground('observatory');
    workspace.restoreTerminalPose('pane-a', {
      position: [0, -2, -1.5],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    });
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!panel) throw new Error('Panel missing');
    expect(new THREE.Box3().setFromObject(panel).min.y).toBeGreaterThanOrEqual(0.095 - 1e-6);
    Object.defineProperty(left, 'rows', { value: 100, configurable: true });
    workspace.setTerminalCurvature('pane-a', 100);
    expect(new THREE.Box3().setFromObject(panel).min.y).toBeGreaterThanOrEqual(0.095 - 1e-6);
    workspace.dispose();
    container.remove();
  });

  it('clamps restored panes inside the hangar safe radius only', () => {
    const horizontal = (panel: THREE.Object3D): number => {
      const center = new THREE.Box3().setFromObject(panel).getCenter(new THREE.Vector3());
      return Math.hypot(center.x, center.z);
    };
    const far = {
      position: [9, 1.5, 0] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: 1,
    };
    for (const mode of [
      'black',
      'gradient',
      'observatory',
      'deep-water',
      'studio',
      'desert',
    ] as const) {
      const { workspace, container } = fixture();
      workspace.setBackground(mode);
      workspace.restoreTerminalPose('pane-a', far);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
      if (!panel) throw new Error('Panel missing');
      expect(horizontal(panel), mode).toBeGreaterThan(8.5);
      workspace.dispose();
      container.remove();
    }
    const { workspace, container } = fixture();
    workspace.setBackground('hangar');
    workspace.restoreTerminalPose('pane-a', far);
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!panel) throw new Error('Panel missing');
    expect(horizontal(panel)).toBeLessThanOrEqual(6.5 + 1e-6);
    expect(horizontal(panel)).toBeGreaterThan(6);
    workspace.setBackground('black');
    workspace.restoreTerminalPose('pane-a', far);
    expect(horizontal(panel)).toBeGreaterThan(8.5);
    workspace.dispose();
    container.remove();
  });

  it('clamps a pane grabbed past the hangar radius when it is released', () => {
    const horizontal = (panel: THREE.Object3D): number => {
      const center = new THREE.Box3().setFromObject(panel).getCenter(new THREE.Vector3());
      return Math.hypot(center.x, center.z);
    };
    for (const mode of ['hangar', 'black'] as const) {
      const { workspace, container } = fixture();
      workspace.setBackground(mode);
      workspace.restoreTerminalPose('pane-a', {
        position: [4, 1.5, -2],
        quaternion: [0, 0, 0, 1],
        scale: 1,
      });
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
      if (!panel) throw new Error('Panel missing');
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      controller.position.copy(
        new THREE.Box3().setFromObject(panel).getCenter(new THREE.Vector3()),
      );
      workspace.scene.updateMatrixWorld(true);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(20);
      controller.position.x += 3;
      controller.position.z -= 3;
      fakeXR.frame?.(40);
      expect(horizontal(panel), `${mode} while held`).toBeGreaterThan(6.6);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      fakeXR.frame?.(60);
      if (mode === 'hangar') expect(horizontal(panel)).toBeLessThanOrEqual(6.5 + 1e-6);
      else expect(horizontal(panel)).toBeGreaterThan(6.6);
      workspace.dispose();
      container.remove();
    }
  });

  it('keeps the graph root while children animate between levels', () => {
    const { workspace, container } = fixture();
    workspace.showInput('panes');
    const root = workspace.scene.getObjectByName('hierarchy-navigator');
    hit(workspace, { inputAction: 'hierarchyNode', originalTitle: 'Session' });
    expect(workspace.scene.getObjectByName('hierarchy-navigator')).toBe(root);
    expect(root?.userData.transitioning).toBe(true);
    settleHierarchy();
    expect(root?.userData.transitioning).toBe(false);
    expect(root?.userData.hierarchyPath).toHaveLength(2);
    workspace.dispose();
    container.remove();
  });

  it('picks curved keyboard keys and keeps curvature separate from the PTY', () => {
    const { workspace, actions, right, container } = fixture();
    workspace.selectTerminal('pane-b');
    workspace.setKeyboardCurvature(90);
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const key = objectWithData(workspace, { inputAction: 'key', key: 'q' });
    expect(Math.abs(key.rotation.y)).toBeGreaterThan(0.1);
    expect(key.position.z).toBeGreaterThan(0);
    expect(keyboard.userData.keyboardCurvature).toBeCloseTo(90);
    hit(workspace, { inputAction: 'key', key: 'q' });
    expect(actions.sendKey).toHaveBeenLastCalledWith('q', undefined);
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('cancels hierarchy navigation with B without entering Focus', () => {
    const { workspace, container } = fixture();
    const gamepad = connectController(0);
    workspace.showInput('panes');
    expect(workspace.scene.getObjectByName('hierarchy-navigator')?.userData.hierarchyPath).toEqual([
      'workspace:workspace',
    ]);
    pressFocusButton(gamepad, 16);
    expect(workspace.scene.getObjectByName('hierarchy-navigator')).toBeUndefined();
    expect(workspace.state.focusModeTerminalId).toBeNull();
    expect(workspace.scene.getObjectByName('terminal-panel-pane-a')?.visible).toBe(true);
    workspace.dispose();
    container.remove();
  });

  it('edits a reviewed dictation locally and inserts only through its explicit action', () => {
    const { workspace, actions, container } = fixture();
    actions.editDictation = vi.fn();
    actions.dictationAction = vi.fn();
    workspace.setDictationState({
      supported: true,
      status: 'review',
      transcript: 'echo',
      error: null,
    });
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: ' ' });
    expect(actions.editDictation).toHaveBeenCalledWith('echo ');
    expect(actions.sendKey).not.toHaveBeenCalled();
    hit(workspace, { inputAction: 'key', key: 'Enter' });
    expect(actions.dictationAction).toHaveBeenCalledWith('insert');
    hit(workspace, { inputAction: 'dictation', dictationAction: 'clear' });
    expect(actions.dictationAction).toHaveBeenCalledWith('clear');
    workspace.setDictationState({ supported: true, status: 'review', transcript: '', error: null });
    expect(() =>
      objectWithData(workspace, { inputAction: 'dictation', dictationAction: 'clear' }),
    ).toThrow();
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });
});
