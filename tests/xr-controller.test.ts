import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeXR = vi.hoisted(() => ({
  controllers: [] as unknown[],
  presenting: false,
  camera: null as unknown,
  frame: null as ((time: number) => void) | null,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  fakeXR.controllers = [new actual.Group(), new actual.Group()];
  class FakeRenderer {
    xr = {
      enabled: false,
      get isPresenting() {
        return fakeXR.presenting;
      },
      getController: (index: number) => fakeXR.controllers[index],
      getCamera: () => fakeXR.camera,
      setReferenceSpaceType: vi.fn(),
      setSession: vi.fn(async () => undefined),
    };
    capabilities = { getMaxAnisotropy: () => 1 };
    setPixelRatio(_ratio: number): void {}
    setSize(_width: number, _height: number, _updateStyle?: boolean): void {}
    setAnimationLoop(callback: ((time: number) => void) | null): void {
      fakeXR.frame = callback;
    }
    render(scene: { updateMatrixWorld(force?: boolean): void }): void {
      scene.updateMatrixWorld(true);
    }
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import * as THREE from 'three';
import type { PaneDescriptor, TerminalSurface, WorkspaceActions } from '../src/contracts';
import { createWorkspaceScene } from '../src/xr/scene';

const pane = (id: string, title = id): PaneDescriptor => ({
  id,
  title,
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
    connect() {},
    sendText: () => true,
    sendKey: () => true,
    paste: () => true,
    focus() {},
    resizeGrid: vi.fn(),
    dispose() {},
    subscribe(_next) {
      return () => undefined;
    },
  };
}

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
  fakeXR.camera = workspace.camera;
  const left = surface(pane('pane-a', 'A'));
  const right = surface(pane('pane-b', 'B'));
  workspace.addTerminal(left);
  workspace.addTerminal(right);
  workspace.setAvailablePanes([left.pane, right.pane]);
  workspace.scene.updateMatrixWorld(true);
  return { workspace, actions, container, left, right };
}

function hit(
  workspace: ReturnType<typeof createWorkspaceScene>,
  data: Record<string, unknown>,
  event = 'selectstart',
  distance = 0.3,
): void {
  let button: THREE.Object3D | undefined;
  workspace.scene.traverse((object) => {
    let visible = true;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
      if (!parent.visible) visible = false;
    if (
      visible &&
      !button &&
      Object.entries(data).every(([key, value]) => object.userData[key] === value)
    )
      button = object;
  });
  if (!button) throw new Error(`Control not found: ${JSON.stringify(data)}`);
  workspace.scene.updateMatrixWorld(true);
  const controller = fakeXR.controllers[0] as THREE.Group;
  const orientation = button.getWorldQuaternion(new THREE.Quaternion());
  controller.position.copy(
    button
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, 0, distance).applyQuaternion(orientation)),
  );
  controller.quaternion.copy(orientation);
  workspace.scene.updateMatrixWorld(true);
  controller.dispatchEvent({ type: event } as never);
}

describe('native XR controller event routing', () => {
  beforeEach(() => {
    fakeXR.presenting = true;
    fakeXR.controllers.forEach((controller) => {
      const object = controller as THREE.Group;
      object.position.set(0, 0, 0);
      object.visible = true;
      object.rotation.set(0, 0, 0);
    });
  });

  it('uses one keyboard presentation for the current mode', () => {
    fakeXR.presenting = false;
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.showInput('keyboard');
    expect(actions.openKeyboard).toHaveBeenCalledTimes(1);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    workspace.showInput('panes');
    hit(workspace, { inputAction: 'mode', mode: 'keyboard' });
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeUndefined();
    expect(actions.openKeyboard).toHaveBeenCalledTimes(2);
    fakeXR.presenting = true;
    workspace.showInput('keyboard');
    expect(actions.openKeyboard).toHaveBeenCalledTimes(2);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    workspace.showInput('commands');
    expect(actions.openCommands).not.toHaveBeenCalled();
    expect(workspace.scene.getObjectByName('xr-commands-controls')).toBeDefined();
    workspace.dispose();
    container.remove();
  });

  it('clears native input when an immersive session ends', async () => {
    const listeners = new Map<string, () => void>();
    const session = {
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    try {
      await workspace.enterXR('vr');
      workspace.selectTerminal('pane-a');
      workspace.showInput('keyboard');
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
      fakeXR.presenting = false;
      listeners.get('end')?.();
      expect(workspace.state.xrMode).toBe('desktop');
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
      expect(workspace.state.inputTargetId).toBeNull();
    } finally {
      workspace.dispose();
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it('bounds preview growth and keeps independent recovery controls usable', () => {
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
    panel.scale.setScalar(1.8);
    workspace.scaleSelectedPanel(-1);
    expect(panel.scale.x).toBeCloseTo(1.7);
    fakeXR.presenting = true;
    fakeXR.frame?.(16);
    hit(workspace, { inputAction: 'resetLayout' });
    expect(panel.scale.x).toBe(1);
    panel.scale.setScalar(1.8);
    panel.position.z = -0.4;
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'selectedScale', direction: -1 }, 'selectstart', 1);
    expect(panel.scale.x).toBeCloseTo(1.7);
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('routes browser hover and clicks through the terminal control actions', () => {
    fakeXR.presenting = false;
    const { workspace, actions, container, right } = fixture();
    Object.defineProperty(workspace.canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    });
    const enter = workspace
      .getControlHints()
      .find((hint) => hint.key === 'Enter' && hint.terminalId === 'pane-b');
    if (!enter) throw new Error('Enter strip target missing');
    const pointer = (type: string, control: { clientX: number; clientY: number }) =>
      workspace.canvas.dispatchEvent(
        new PointerEvent(type, { clientX: control.clientX, clientY: control.clientY }),
      );
    pointer('pointermove', enter);
    expect(workspace.canvas.title).toContain('Send Enter');
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(true);
    expect(actions.sendKey).not.toHaveBeenCalled();
    pointer('pointerdown', enter);
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expect(actions.sendKey).toHaveBeenLastCalledWith('Enter', undefined);
    const shrink = workspace
      .getControlHints()
      .find(
        (hint) =>
          hint.inputAction === 'scale' && hint.label === '−' && hint.terminalId === 'pane-b',
      );
    if (!shrink) throw new Error('Scale target missing');
    pointer('pointermove', shrink);
    expect(workspace.canvas.title).toContain('Shrink panel');
    pointer('pointerdown', shrink);
    expect(workspace.scene.getObjectByName('terminal-panel-pane-b')?.scale.x).toBeLessThan(1);
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(workspace.canvas.title).toBe('');
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('shows controller-ray hover help without sending input', () => {
    const { workspace, actions, container } = fixture();
    hit(workspace, { key: 'Tab', terminalId: 'pane-b' }, 'hover');
    fakeXR.presenting = true;
    fakeXR.frame?.(16);
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(true);
    expect(workspace.canvas.title).toContain('Send Tab');
    expect(actions.sendKey).not.toHaveBeenCalled();
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.set(20, 20, 20);
    (fakeXR.controllers[1] as THREE.Group).visible = false;
    fakeXR.frame?.(32);
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
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
    hit(workspace, { inputAction: 'openInput', mode: 'commands' });
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
    hit(workspace, { inputAction: 'openInput', mode: 'keyboard' });
    workspace.selectTerminal('pane-b');
    vi.mocked(actions.sendKey).mockClear();
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    expect(actions.sendKey).not.toHaveBeenCalled();
    hit(workspace, { inputAction: 'key', key: 'a' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expect(vi.mocked(actions.sendKey).mock.calls.at(-1)?.[0]).toBe('a');
    workspace.dispose();
    container.remove();
  });

  it('selects a pane when its own terminal key strip is activated', () => {
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    hit(workspace, { key: 'Enter', terminalId: 'pane-b' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expect(actions.sendKey).toHaveBeenLastCalledWith('Enter', undefined);
    workspace.dispose();
    container.remove();
  });

  it('updates native key captions for Shift and restores them after input', () => {
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    hit(workspace, { inputAction: 'openInput', mode: 'keyboard' });
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

  it('requests an unattached pane through the native hierarchy', () => {
    const { workspace, actions, left, right, container } = fixture();
    workspace.setAvailablePanes([left.pane, right.pane, pane('pane-c', 'Other')]);
    hit(workspace, { inputAction: 'openInput', mode: 'panes' });
    hit(workspace, { inputAction: 'hierarchyNext' });
    hit(workspace, { inputAction: 'hierarchyNext' });
    hit(workspace, { inputAction: 'hierarchyNext' });
    hit(workspace, { inputAction: 'pane', paneId: 'pane-c' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-c');
    workspace.dispose();
    container.remove();
  });
});
