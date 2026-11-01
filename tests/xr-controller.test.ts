vi.mock('../src/xr/labels', () => import('./helpers/labels'));

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
    resizeGrid: vi.fn(() => true),
    canResizeGrid: true,
    setColorMode: vi.fn(),
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
    resizeGrid: vi.fn(() => true),
    setTerminalColorMode: vi.fn(),
    setKeyboardBackground: vi.fn(),
    reloadApp: vi.fn(),
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

function objectWithData(
  workspace: ReturnType<typeof createWorkspaceScene>,
  data: Record<string, unknown>,
): THREE.Object3D {
  let result: THREE.Object3D | undefined;
  workspace.scene.traverse((object) => {
    if (!result && Object.entries(data).every(([key, value]) => object.userData[key] === value))
      result = object;
  });
  if (!result) throw new Error(`Control not found: ${JSON.stringify(data)}`);
  return result;
}

function aimController(controller: THREE.Group, target: THREE.Object3D, distance = 0.3): void {
  const orientation = target.getWorldQuaternion(new THREE.Quaternion());
  controller.position.copy(
    target
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, 0, distance).applyQuaternion(orientation)),
  );
  controller.quaternion.copy(orientation);
}

function connectController(index: number, axes = [0, 0, 0, 0]): Gamepad {
  const gamepad = {
    axes,
    buttons: [{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }],
  } as unknown as Gamepad;
  (fakeXR.controllers[index] as THREE.Group).dispatchEvent({
    type: 'connected',
    data: { gamepad },
  } as never);
  return gamepad;
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

  it('keeps the update control XR-only and routes one explicit reload without ending XR', () => {
    const { workspace, actions, container } = fixture();
    fakeXR.presenting = false;
    workspace.setUpdateAvailable(true);
    const notice = objectWithData(workspace, { inputAction: 'reloadUpdate' });
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
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
    expect(actions.sendKey).not.toHaveBeenCalled();
    pointer('pointerdown', enter);
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expect(actions.sendKey).toHaveBeenLastCalledWith('Enter', undefined);
    const fontDown = workspace
      .getControlHints()
      .find(
        (hint) =>
          hint.inputAction === 'fontZoom' && hint.label === 'A−' && hint.terminalId === 'pane-b',
      );
    if (!fontDown) throw new Error('Font zoom target missing');
    pointer('pointermove', fontDown);
    expect(workspace.canvas.title).toContain('text');
    pointer('pointerdown', fontDown);
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(workspace.canvas.title).toBe('');
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('delays compact action hints and hides them while gripping', () => {
    const { workspace, actions, container } = fixture();
    hit(workspace, { key: 'Tab', terminalId: 'pane-b' }, 'hover');
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
    hit(workspace, { inputAction: 'gazeInput' }, 'squeezestart');
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

  it('keeps the native keyboard compact and omits physical transform buttons', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const before = new THREE.Box3().setFromObject(keyboard);
    expect(before.getSize(new THREE.Vector3()).x).toBeLessThanOrEqual(1.1);
    expect(keyboard.position.length()).toBeGreaterThan(0.5);
    const transformActions = new Set(['inputScale', 'inputReset', 'resetLayout', 'selectedScale']);
    keyboard.traverse((object) =>
      expect(transformActions.has(String(object.userData.inputAction))).toBe(false),
    );
    workspace.dispose();
    container.remove();
  });

  it('opens and resets near the current headset with non-overlapping controls', () => {
    const { workspace, container } = fixture();
    workspace.camera.position.set(3, 1.7, 2);
    workspace.camera.lookAt(2, 1.7, 1);
    workspace.camera.updateMatrixWorld(true);
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const expected = workspace.camera.position
      .clone()
      .addScaledVector(workspace.camera.getWorldDirection(new THREE.Vector3()), 1.15);
    expected.y -= 0.2;
    expect(keyboard.position.distanceTo(expected)).toBeLessThan(0.000001);
    const controls: THREE.Object3D[] = [];
    keyboard.updateMatrixWorld(true);
    keyboard.traverse((object) => {
      if (object.userData.labelWidth) controls.push(object);
    });
    for (let a = 0; a < controls.length; a += 1) {
      const first = controls[a];
      const pointA = keyboard.worldToLocal(first.getWorldPosition(new THREE.Vector3()));
      for (let b = a + 1; b < controls.length; b += 1) {
        const second = controls[b];
        const pointB = keyboard.worldToLocal(second.getWorldPosition(new THREE.Vector3()));
        const overlapX =
          (first.userData.labelWidth + second.userData.labelWidth) / 2 -
          Math.abs(pointA.x - pointB.x);
        const overlapY =
          (first.userData.labelHeight + second.userData.labelHeight) / 2 -
          Math.abs(pointA.y - pointB.y);
        expect(
          overlapX > 0.00001 && overlapY > 0.00001,
          `${first.userData.labelText} overlaps ${second.userData.labelText}`,
        ).toBe(false);
      }
    }
    const viewRotation = workspace.camera.getWorldQuaternion(new THREE.Quaternion());
    const eye = workspace.camera.getWorldPosition(new THREE.Vector3());
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!panel || !hud) throw new Error('Workspace roots missing');
    keyboard.position.x += 1;
    panel.position.x -= 1;
    hud.position.x += 1;
    workspace.resetLayout();
    expect(keyboard.position.distanceTo(expected)).toBeLessThan(0.000001);
    const expectedPanel = new THREE.Vector3(-0.87, 1.5 - 1.52, -1.5)
      .applyQuaternion(viewRotation)
      .add(eye);
    const expectedHud = new THREE.Vector3(0, -0.65, -1.35).applyQuaternion(viewRotation).add(eye);
    expect(panel.position.distanceTo(expectedPanel)).toBeLessThan(0.6);
    expect(hud.position.distanceTo(expectedHud)).toBeLessThan(0.6);
    workspace.dispose();
    container.remove();
  });

  it('uses the real controller event source for gamepad drag and suppresses trigger typing', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    const gamepad = { axes: [0, 0, 0, -1], buttons: [{ pressed: false }] } as unknown as Gamepad;
    controller.dispatchEvent({ type: 'connected', data: { gamepad } } as never);
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    const position = keyboard.position.clone();
    const rotation = keyboard.quaternion.clone();
    controller.dispatchEvent({ type: 'selectstart' } as never);
    fakeXR.frame?.(16);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(keyboard.position.distanceTo(position)).toBeLessThan(0.000001);
    expect(keyboard.quaternion.angleTo(rotation)).toBeGreaterThan(0.001);
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    workspace.dispose();
    container.remove();
  });

  it('routes keys to the head-gaze dwell target only when enabled and keeps it over the keyboard', async () => {
    const session = { addEventListener: vi.fn() };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, actions, container } = fixture();
    await workspace.enterXR('vr');
    workspace.camera.position.set(0, 1.5, 0);
    workspace.camera.lookAt(0.87, 1.5, -1.5);
    fakeXR.frame?.(0);
    fakeXR.frame?.(400);
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    workspace.setGazeInputEnabled(true);
    expect(workspace.state.gazeEnabled).toBe(false);
    fakeXR.frame?.(500);
    fakeXR.frame?.(849);
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    fakeXR.frame?.(851);
    expect(workspace.state.selectedTerminalId).toBe('pane-b');
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const direction = keyboard.position.clone().sub(workspace.camera.position).normalize();
    const panelA = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!panelA) throw new Error('Pane missing');
    panelA.position.copy(workspace.camera.position).addScaledVector(direction, 2);
    workspace.camera.lookAt(keyboard.position);
    fakeXR.frame?.(1000);
    fakeXR.frame?.(1400);
    expect(workspace.state.selectedTerminalId).toBe('pane-b');
    hit(workspace, { inputAction: 'key', key: 'a' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    expect(actions.sendKey).toHaveBeenLastCalledWith('a', undefined);
    workspace.hideInput();
    workspace.setGazeInputEnabled(false);
    fakeXR.frame?.(1500);
    fakeXR.frame?.(1900);
    expect(workspace.state.selectedTerminalId).toBe('pane-b');
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps thumbstick rotation independent of frame rate', () => {
    const rotateForOneSecond = (hz: number): number => {
      const { workspace, container } = fixture();
      workspace.showInput('keyboard');
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
      if (!keyboard) throw new Error('Keyboard missing');
      const controller = fakeXR.controllers[0] as THREE.Group;
      const gamepad = { axes: [0, 0, 1, 0], buttons: [{ pressed: false }] } as unknown as Gamepad;
      controller.dispatchEvent({ type: 'connected', data: { gamepad } } as never);
      fakeXR.frame?.(0);
      hit(workspace, { inputAction: 'grabInput', dragHandle: true }, 'squeezestart');
      const initial = keyboard.quaternion.clone();
      for (let frame = 1; frame <= hz; frame += 1) fakeXR.frame?.((frame * 1000) / hz);
      const angle = initial.angleTo(keyboard.quaternion);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      workspace.dispose();
      container.remove();
      return angle;
    };
    const at60 = rotateForOneSecond(60);
    const at120 = rotateForOneSecond(120);
    expect(at60).toBeCloseTo(0.9, 4);
    expect(at120).toBeCloseTo(at60, 4);
  });

  it('preserves a held keyboard transform through Shift and pane retargeting', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'grabInput', dragHandle: true }, 'squeezestart');
    const grip = fakeXR.controllers[0] as THREE.Group;
    const trigger = fakeXR.controllers[1] as THREE.Group;
    grip.position.x += 0.2;
    grip.rotation.y += 0.15;
    fakeXR.frame?.(16);
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const position = keyboard.position.clone();
    const rotation = keyboard.quaternion.clone();
    const shift = keyboard.children.find((object) => object.userData.key === 'Shift');
    if (!shift) throw new Error('Shift missing');
    trigger.quaternion.copy(shift.getWorldQuaternion(new THREE.Quaternion()));
    trigger.position
      .copy(shift.getWorldPosition(new THREE.Vector3()))
      .add(new THREE.Vector3(0, 0, 0.3).applyQuaternion(trigger.quaternion));
    workspace.scene.updateMatrixWorld(true);
    trigger.dispatchEvent({ type: 'selectstart' } as never);
    workspace.selectTerminal('pane-b');
    const refreshed = workspace.scene.getObjectByName('xr-keyboard-controls');
    expect(refreshed?.position.distanceTo(position)).toBeLessThan(0.000001);
    expect(refreshed?.quaternion.angleTo(rotation)).toBeLessThan(0.000001);
    grip.position.y += 0.1;
    fakeXR.frame?.(32);
    expect(refreshed?.position.y).toBeGreaterThan(position.y + 0.09);
    workspace.dispose();
    container.remove();
  });

  it('uses two-controller grip for shared-root translation, rotation, and scale', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    workspace.scene.updateMatrixWorld(true);
    const keyA = objectWithData(workspace, { inputAction: 'key', key: 'a' });
    const shift = objectWithData(workspace, { inputAction: 'key', key: 'Shift' });
    const left = fakeXR.controllers[0] as THREE.Group;
    const right = fakeXR.controllers[1] as THREE.Group;
    connectController(0);
    connectController(1);
    aimController(left, keyA);
    left.dispatchEvent({ type: 'squeezestart' } as never);
    const initialScale = keyboard.scale.x;
    const initialPosition = keyboard.position.clone();
    expect(initialScale).toBeCloseTo(0.38, 4);
    aimController(right, shift);
    right.dispatchEvent({ type: 'squeezestart' } as never);
    expect(keyboard.scale.x).toBeCloseTo(initialScale, 6);
    left.position.x -= 0.2;
    right.position.x += 0.2;
    right.position.y += 0.08;
    fakeXR.frame?.(16);
    expect(keyboard.scale.x).toBeGreaterThan(initialScale);
    expect(keyboard.position.distanceTo(initialPosition)).toBeGreaterThan(0.01);
    expect(keyboard.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.01);
    const scaleWhilePairHeld = keyboard.scale.x;
    right.dispatchEvent({ type: 'squeezeend' } as never);
    const releasedPosition = keyboard.position.clone();
    fakeXR.frame?.(24);
    expect(keyboard.position.distanceTo(releasedPosition)).toBeLessThan(0.000001);
    left.position.x -= 0.1;
    fakeXR.frame?.(32);
    expect(keyboard.scale.x).toBeCloseTo(scaleWhilePairHeld, 6);
    expect(keyboard.position.x).toBeLessThan(initialPosition.x);
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('rebases one-hand pose on disconnect and preserves ownership across menu refresh', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const left = fakeXR.controllers[0] as THREE.Group;
    const right = fakeXR.controllers[1] as THREE.Group;
    const keyA = objectWithData(workspace, { inputAction: 'key', key: 'a' });
    const shift = objectWithData(workspace, { inputAction: 'key', key: 'Shift' });
    connectController(0);
    connectController(1);
    aimController(left, keyA);
    aimController(right, shift);
    left.dispatchEvent({ type: 'squeezestart' } as never);
    right.dispatchEvent({ type: 'squeezestart' } as never);
    const pairScale = keyboard.scale.x;
    workspace.showInput('commands');
    const refreshed = workspace.scene.getObjectByName('xr-commands-controls');
    if (!refreshed) throw new Error('Commands menu missing');
    expect(refreshed.scale.x).toBeCloseTo(pairScale, 6);
    workspace.selectTerminal('pane-b');
    const refreshedAfterSelection = workspace.scene.getObjectByName('xr-commands-controls');
    if (!refreshedAfterSelection) throw new Error('Commands menu missing after selection');
    expect(refreshedAfterSelection.scale.x).toBeCloseTo(pairScale, 6);
    const poseAfterRefresh = refreshedAfterSelection.position.clone();
    const rotationAfterRefresh = refreshedAfterSelection.quaternion.clone();
    fakeXR.frame?.(32);
    expect(refreshedAfterSelection.position.distanceTo(poseAfterRefresh)).toBeLessThan(0.000001);
    expect(refreshedAfterSelection.quaternion.angleTo(rotationAfterRefresh)).toBeLessThan(0.000001);
    right.dispatchEvent({ type: 'disconnected' } as never);
    const beforeMove = refreshedAfterSelection.position.clone();
    left.position.y += 0.15;
    fakeXR.frame?.(48);
    expect(refreshedAfterSelection.position.y).toBeGreaterThan(beforeMove.y + 0.1);
    workspace.dispose();
    container.remove();
  });

  it('disposes a grabbed input root when its target pane is removed', () => {
    const { workspace, actions, right, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    const keyA = objectWithData(workspace, { inputAction: 'key', key: 'a' });
    const shift = objectWithData(workspace, { inputAction: 'key', key: 'Shift' });
    if (!keyboard) throw new Error('Keyboard missing');
    connectController(0);
    connectController(1);
    aimController(fakeXR.controllers[0] as THREE.Group, keyA);
    aimController(fakeXR.controllers[1] as THREE.Group, shift);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    (fakeXR.controllers[1] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    const remainingScale = (workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group)
      .scale.x;
    workspace.removeTerminal('pane-a');
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    (fakeXR.controllers[0] as THREE.Group).position.x -= 0.4;
    (fakeXR.controllers[1] as THREE.Group).position.x += 0.4;
    fakeXR.frame?.(64);
    expect(
      (workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group).scale.x,
    ).toBeCloseTo(remainingScale, 6);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it.each([
    [
      'terminal',
      'terminal-panel-pane-a',
      undefined,
      { terminalTitle: true, terminalId: 'pane-a' },
      { inputAction: 'fontZoom', terminalId: 'pane-a' },
    ],
    [
      'keyboard',
      'xr-keyboard-controls',
      'keyboard',
      { inputAction: 'key', key: 'a' },
      { inputAction: 'key', key: 'Shift' },
    ],
    [
      'commands',
      'xr-commands-controls',
      'commands',
      { inputAction: 'pane', paneId: 'pane-a' },
      { inputAction: 'mode', mode: 'keyboard' },
    ],
    [
      'panes',
      'xr-panes-controls',
      'panes',
      { inputAction: 'hierarchyNext' },
      { inputAction: 'mode', mode: 'keyboard' },
    ],
    [
      'hud',
      'xr-workspace-hud',
      undefined,
      { inputAction: 'openInput', mode: 'commands' },
      { inputAction: 'openInput', mode: 'keyboard' },
    ],
  ])(
    'pair-grips the %s root without activating controls or resizing PTY',
    (_label, rootName, mode, firstData, secondData) => {
      const { workspace, actions, right, container } = fixture();
      if (mode) workspace.showInput(mode as 'commands' | 'keyboard' | 'panes');
      const root = workspace.scene.getObjectByName(rootName);
      if (!root) throw new Error(`${rootName} missing`);
      const first = objectWithData(workspace, firstData);
      const second = objectWithData(workspace, secondData);
      connectController(0);
      connectController(1);
      aimController(fakeXR.controllers[0] as THREE.Group, first);
      aimController(fakeXR.controllers[1] as THREE.Group, second);
      const initialScale = root.scale.x;
      const initialPosition = root.position.clone();
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
      (fakeXR.controllers[1] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
      (fakeXR.controllers[0] as THREE.Group).position.x -= 0.2;
      (fakeXR.controllers[1] as THREE.Group).position.x += 0.2;
      (fakeXR.controllers[1] as THREE.Group).position.y += 0.1;
      fakeXR.frame?.(16);
      expect(root.scale.x).not.toBeCloseTo(initialScale, 6);
      expect(root.position.distanceTo(initialPosition)).toBeGreaterThan(0.01);
      expect(actions.sendKey).not.toHaveBeenCalled();
      expect(right.resizeGrid).not.toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    },
  );

  it('allows physical transform reset only through both-stick hold while ungripped', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!keyboard || !panel || !hud) throw new Error('XR roots missing');
    const transformActions = new Set(['inputScale', 'inputReset', 'selectedScale', 'resetLayout']);
    workspace.scene.traverse((object) => {
      if (object.name.startsWith('xr-'))
        expect(transformActions.has(String(object.userData.inputAction))).toBe(false);
    });
    const leftPad = connectController(0, [0, 0, 0, 0]);
    const rightPad = connectController(1, [0, 0, 0, 0]);
    const originalKeyboard = keyboard.position.clone();
    const viewRotation = workspace.camera.getWorldQuaternion(new THREE.Quaternion());
    const eye = workspace.camera.getWorldPosition(new THREE.Vector3());
    const expectedPanel = new THREE.Vector3(-0.87, -0.02, -1.5)
      .applyQuaternion(viewRotation)
      .add(eye);
    const expectedHud = new THREE.Vector3(0, -0.65, -1.35).applyQuaternion(viewRotation).add(eye);
    (leftPad.buttons as unknown as Array<{ pressed: boolean }>)[3].pressed = true;
    (rightPad.buttons as unknown as Array<{ pressed: boolean }>)[3].pressed = true;
    keyboard.position.x += 0.5;
    panel.position.x -= 0.5;
    hud.position.x += 0.5;
    fakeXR.frame?.(0);
    for (let frame = 1; frame <= 25; frame += 1) fakeXR.frame?.(frame * 50);
    expect(keyboard.position.distanceTo(originalKeyboard)).toBeLessThan(0.001);
    expect(panel.position.distanceTo(expectedPanel)).toBeLessThan(0.6);
    expect(hud.position.distanceTo(expectedHud)).toBeLessThan(0.6);
    workspace.dispose();
    container.remove();
  });

  it('does not recenter while a controller grip is held', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const target = objectWithData(workspace, { inputAction: 'key', key: 'a' });
    const originalPosition = keyboard.position.clone();
    const held = fakeXR.controllers[0] as THREE.Group;
    const other = fakeXR.controllers[1] as THREE.Group;
    const heldPad = connectController(0);
    const otherPad = connectController(1);
    aimController(held, target);
    held.dispatchEvent({ type: 'squeezestart' } as never);
    held.position.x += 0.3;
    fakeXR.frame?.(16);
    const grippedPosition = keyboard.position.clone();
    (heldPad.buttons as unknown as Array<{ pressed: boolean }>)[3].pressed = true;
    (otherPad.buttons as unknown as Array<{ pressed: boolean }>)[3].pressed = true;
    for (let frame = 1; frame <= 25; frame += 1) fakeXR.frame?.(frame * 50);
    expect(keyboard.position.distanceTo(grippedPosition)).toBeLessThan(0.000001);
    expect(keyboard.position.distanceTo(originalPosition)).toBeGreaterThan(0.01);
    held.dispatchEvent({ type: 'squeezeend' } as never);
    other.visible = false;
    workspace.dispose();
    container.remove();
  });

  it('terminates the controller ray at a distant key and keeps tint until both controllers leave', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const key = (() => {
      let found: THREE.Object3D | undefined;
      workspace.scene.traverse((object) => {
        if (!found && object.userData.inputAction === 'key' && object.userData.key === 'a')
          found = object;
      });
      return found;
    })();
    if (!key) throw new Error('Key missing');
    const orient = key.getWorldQuaternion(new THREE.Quaternion());
    const point = key.getWorldPosition(new THREE.Vector3());
    for (const controller of fakeXR.controllers as THREE.Group[]) {
      controller.position.copy(point).add(new THREE.Vector3(0, 0, 2).applyQuaternion(orient));
      controller.quaternion.copy(orient);
    }
    workspace.scene.updateMatrixWorld(true);
    fakeXR.frame?.(16);
    const line = (fakeXR.controllers[0] as THREE.Group).children.find(
      (child) => child instanceof THREE.Line,
    );
    expect(line?.scale.z).toBeCloseTo(2 / 8, 5);
    const material = (key as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0x9deaff);
    (fakeXR.controllers[1] as THREE.Group).position.set(20, 20, 20);
    fakeXR.frame?.(32);
    expect(material.color.getHex()).toBe(0x9deaff);
    (fakeXR.controllers[0] as THREE.Group).position.set(20, 20, 20);
    fakeXR.frame?.(48);
    expect(material.color.getHex()).toBe(0xffffff);
    workspace.dispose();
    container.remove();
  });

  it('keeps passive grip help clear while the other ray targets a key', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'a' }, 'hover');
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    const body = hud?.children.find((object) => object.userData.inputAction === 'grabInput');
    if (!body) throw new Error('HUD body missing');
    aimController(fakeXR.controllers[1] as THREE.Group, body);
    fakeXR.frame?.(16);
    expect(workspace.scene.getObjectByName('xr-hover-help')?.visible).toBe(false);
    const key = objectWithData(workspace, { inputAction: 'key', key: 'a' }) as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(key.material.color.getHex()).toBe(0x9deaff);
    workspace.dispose();
    container.remove();
  });

  it('rolls around the controller laser axis in grip-trigger mode', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    keyboard.rotation.set(0.2, 0.45, -0.1);
    const controller = fakeXR.controllers[0] as THREE.Group;
    const pad = connectController(0, [0, 0, 1, 0]);
    (pad.buttons as unknown as Array<{ pressed: boolean }>)[0].pressed = true;
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    const before = keyboard.quaternion.clone();
    const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.quaternion);
    const position = keyboard.position.clone();
    fakeXR.frame?.(0);
    const expected = new THREE.Quaternion().setFromAxisAngle(axis, 0.9 / 60).multiply(before);
    expect(keyboard.quaternion.angleTo(expected)).toBeLessThan(0.000001);
    expect(keyboard.position.distanceTo(position)).toBeLessThan(0.000001);
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('reverses normal-grip pitch without changing position or trigger depth', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    const gamepad = connectController(0, [0, 0, 0, -1]);
    hit(workspace, { inputAction: 'grabInput', dragHandle: true }, 'squeezestart');
    const before = keyboard.quaternion.clone();
    const position = keyboard.position.clone();
    const initialRelative = controller
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(before);
    fakeXR.frame?.(0);
    const expectedUp = controller
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(
        initialRelative.multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.9 / 60),
        ),
      );
    expect(keyboard.quaternion.angleTo(expectedUp)).toBeLessThan(0.000001);
    expect(keyboard.position.distanceTo(position)).toBeLessThan(0.000001);
    const afterUp = keyboard.quaternion.clone();

    controller.dispatchEvent({ type: 'squeezeend' } as never);
    (gamepad.axes as number[])[3] = 1;
    hit(workspace, { inputAction: 'grabInput', dragHandle: true }, 'squeezestart');
    const beforeDown = keyboard.quaternion.clone();
    const depthBeforeDown = keyboard.position.clone();
    fakeXR.frame?.(1000);
    expect(keyboard.quaternion.angleTo(beforeDown)).toBeGreaterThan(0.01);
    expect(keyboard.position.distanceTo(depthBeforeDown)).toBeLessThan(0.000001);
    expect(afterUp.angleTo(keyboard.quaternion)).toBeGreaterThan(0.01);
    workspace.dispose();
    container.remove();
  });

  it('resizes a selected grid only on explicit Apply and exposes color modes', () => {
    const { workspace, actions, left, right, container } = fixture();
    workspace.selectTerminal('pane-b');
    workspace.showInput('terminal');
    hit(workspace, { inputAction: 'gridPreset', cols: 120, rows: 36 });
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    hit(workspace, { inputAction: 'gridApply' });
    expect(actions.resizeGrid).toHaveBeenCalledExactlyOnceWith('pane-b', 120, 36);
    expect(left.resizeGrid).not.toHaveBeenCalled();
    expect(right.cols).toBe(80);
    hit(workspace, { inputAction: 'terminalColors', colorMode: 'monochrome' });
    expect(actions.setTerminalColorMode).toHaveBeenLastCalledWith('monochrome');
    expect(workspace.state.terminalColorMode).toBe('monochrome');
    expect(left.setColorMode).toHaveBeenCalledWith('monochrome');
    workspace.dispose();
    container.remove();
  });

  it('can hide keyboard backing without losing keys or grip support, and shows measured FPS', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'keyboardBackground' });
    expect(actions.setKeyboardBackground).toHaveBeenLastCalledWith(false);
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    const backing = keyboard?.getObjectByName('input-backdrop') as THREE.Mesh<
      THREE.PlaneGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(backing.material.opacity).toBe(0);
    expect(backing.material.depthWrite).toBe(false);
    hit(workspace, { inputAction: 'key', key: 'a' });
    expect(actions.sendKey).toHaveBeenLastCalledWith('a', undefined);
    hit(workspace, { inputAction: 'grabInput', dragHandle: true }, 'squeezestart');
    const current = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!current) throw new Error('Keyboard missing');
    const before = current.position.clone();
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    for (let frame = 0; frame <= 60; frame += 1) fakeXR.frame?.((frame * 1000) / 60);
    expect(current.position.x).toBeCloseTo(before.x + 0.2, 5);
    expect(workspace.state.fps).toBe(60);
    expect(workspace.scene.getObjectByName('xr-fps-counter')?.userData.labelText).toBe('FPS 60');
    workspace.dispose();
    container.remove();
  });

  it('accumulates controller-local depth while grip trigger is held and preserves release pose', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    const gamepad = { axes: [0, 0, 0, -1], buttons: [{ pressed: true }] } as unknown as Gamepad;
    controller.dispatchEvent({ type: 'connected', data: { gamepad } } as never);
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    const initial = keyboard.position.clone();
    fakeXR.frame?.(16);
    fakeXR.frame?.(32);
    expect(keyboard.position.distanceTo(initial)).toBeGreaterThan(0.001);
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    const released = keyboard.position.clone();
    (gamepad.axes as number[])[3] = 1;
    fakeXR.frame?.(48);
    expect(keyboard.position.distanceTo(released)).toBeLessThan(0.000001);
    workspace.dispose();
    container.remove();
  });
});
