import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@par/xr-workspace', async (importOriginal) =>
  (await import('./helpers/xr-mocks')).withLabelsAndCountingHand(
    await importOriginal<typeof import('@par/xr-workspace')>(),
  ),
);
vi.mock('../src/xr/repo-status-widget', async (original) =>
  (await import('./helpers/xr-mocks')).withSpiedRepoStatus(
    await original<typeof import('../src/xr/repo-status-widget')>(),
  ),
);
vi.mock('../src/xr/kanban-strip', async (original) =>
  (await import('./helpers/xr-mocks')).withSpiedKanbanStrip(
    await original<typeof import('../src/xr/kanban-strip')>(),
  ),
);
vi.mock('three', async (importOriginal) =>
  (await import('./helpers/xr-mocks')).createThreeMock(
    await importOriginal<typeof import('three')>(),
  ),
);

import { createHandContact } from '@par/xr-workspace';
import * as THREE from 'three';
import type { TerminalSurface } from '../src/contracts';
import { DEFAULT_BUTTON_MAP } from '../src/workspace/controller-buttons';
import type { DeskWindowIntersection } from '../src/xr/desk-window';
import { measurePanelBounds } from '../src/xr/panel-bounds';
import type { createWorkspaceScene } from '../src/xr/scene';
import {
  aimController,
  aimControllerAtScreen,
  connectController,
  fakeXR,
  fixture,
  handPoses,
  hit,
  objectWithData,
  openRadialMenu,
  pane,
  pressFocusButton,
  resetXRControllers,
  selectKeyboardViaRadial,
  selectRadialAction,
  surface,
  visibleWithData,
} from './helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

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
      if (!object.userData.labelWidth) return;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
        if (!parent.visible) return;
      controls.push(object);
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

  it('opens the keyboard and radial level on the head heading while looking down', () => {
    const { workspace, container } = fixture();
    workspace.camera.position.set(1, 1.6, 0.5);
    workspace.camera.rotation.set(-0.7, -0.4, 0, 'YXZ');
    workspace.camera.updateMatrixWorld(true);
    const eye = workspace.camera.getWorldPosition(new THREE.Vector3());
    const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.4);
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    const keyboardAt = new THREE.Vector3(0, -0.2, -1.15).applyQuaternion(heading).add(eye);
    expect(keyboard.position.distanceTo(keyboardAt)).toBeLessThan(1e-6);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(keyboard.quaternion).y).toBeCloseTo(0, 6);
    const gamepad = connectController(1, [0, 0, 0, 0], 'right');
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    const radial = workspace.scene.getObjectByName('radial-menu');
    if (!radial) throw new Error('Radial missing');
    const radialAt = new THREE.Vector3(0, -0.05, -1.05).applyQuaternion(heading).add(eye);
    expect(radial.getWorldPosition(new THREE.Vector3()).distanceTo(radialAt)).toBeLessThan(1e-6);
    const radialFront = new THREE.Vector3(0, 0, 1).applyQuaternion(
      radial.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(radialFront.y).toBeCloseTo(0, 6);
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
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
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

  it('clamps two-controller terminal shrink at the physical minimum without input or PTY resize', () => {
    const { workspace, actions, right, container } = fixture();
    workspace.selectTerminal('pane-b');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!panel) throw new Error('Pane B missing');
    const title = objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-b' });
    const zoom = objectWithData(workspace, { inputAction: 'closePane', terminalId: 'pane-b' });
    const left = fakeXR.controllers[0] as THREE.Group;
    const rightController = fakeXR.controllers[1] as THREE.Group;
    connectController(0);
    connectController(1);
    aimController(left, title);
    aimController(rightController, zoom);
    left.dispatchEvent({ type: 'squeezestart' } as never);
    rightController.dispatchEvent({ type: 'squeezestart' } as never);
    const midpoint = left.position.clone().add(rightController.position).multiplyScalar(0.5);
    left.position.copy(midpoint).add(new THREE.Vector3(-0.05, 0, 0));
    rightController.position.copy(midpoint).add(new THREE.Vector3(0.05, 0, 0));
    fakeXR.frame?.(16);
    expect(panel.scale.x).toBeCloseTo(0.3, 6);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(actions.sendText).not.toHaveBeenCalled();
    expect(right.resizeGrid).not.toHaveBeenCalled();
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
      { inputAction: 'closePane', terminalId: 'pane-a' },
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
      { inputAction: 'newCommand' },
      { inputAction: 'close' },
    ],
    [
      'panes',
      'xr-panes-controls',
      'panes',
      { inputAction: 'hierarchyNode', originalTitle: 'Workspace' },
      { inputAction: 'close' },
    ],
    ['hud', 'xr-workspace-hud', undefined, { inputAction: 'exit' }, { inputAction: 'exit' }],
  ])(
    'pair-grips the %s root without activating controls or resizing PTY',
    (_label, rootName, mode, firstData, secondData) => {
      const { workspace, actions, right, container } = fixture();
      if (mode) workspace.showInput(mode as 'commands' | 'keyboard' | 'panes');
      if (_label === 'commands')
        workspace.setQuickCommands([
          { id: 'pair', label: 'Pair', text: 'pair', sendNewline: true },
        ]);
      if (_label === 'commands') workspace.showInput('commands');
      const root = workspace.scene.getObjectByName(rootName);
      if (!root) throw new Error(`${rootName} missing`);
      const first = objectWithData(workspace, firstData);
      const second =
        _label === 'hud'
          ? workspace.scene.getObjectByName('xr-active-pane')
          : objectWithData(workspace, secondData);
      if (!second) throw new Error('Second grip target missing');
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
    workspace.showInput('settings');
    hit(workspace, { inputAction: 'openInput', mode: 'display' });
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

  describe('sticky notes', () => {
    const review = (transcript: string) =>
      ({ supported: true, status: 'review', transcript, error: null }) as const;
    const notes = (): Record<string, string> =>
      JSON.parse(localStorage.getItem('mux-xr:sticky-notes:v1') ?? '{"notes":{}}').notes;
    const poses = (): Record<string, { placed?: true }> =>
      JSON.parse(localStorage.getItem('mux-xr:widget-poses:v2') ?? '{"poses":{}}').poses;
    const pin = (workspace: ReturnType<typeof createWorkspaceScene>, text: string): string => {
      workspace.setDictationState(review(text));
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'pinNote' });
      const key = workspace.state.widgets.find((entry) => entry.startsWith('sticky-note:'));
      if (!key) throw new Error('note missing');
      return key;
    };

    it('starts note dictation from the Widgets panel, or explains when speech is unavailable', () => {
      const { workspace, actions, container } = fixture();
      const dictationAction = vi.fn();
      actions.dictationAction = dictationAction;
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'sticky-note' });
      expect(dictationAction).not.toHaveBeenCalled();
      expect(workspace.state.notice).toBe(
        'Speech is unavailable here, so a note cannot be dictated',
      );
      workspace.setDictationState({ supported: true, status: 'idle', transcript: '', error: null });
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'sticky-note' });
      expect(dictationAction).toHaveBeenLastCalledWith('startNote');
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
      expect(workspace.state.widgets).toEqual([]);
      workspace.dispose();
      container.remove();
    });

    it.each(['button', 'Enter', 'physical Enter'] as const)(
      'creates a target-free sticky note with %s',
      (method) => {
        const { workspace, actions, container } = fixture();
        const dictationAction = vi.fn();
        actions.dictationAction = dictationAction;
        try {
          workspace.selectTerminal(null);
          workspace.setDictationState({ ...review('Check the desk lamp'), forNote: true });
          workspace.showInput('keyboard');
          expect(workspace.isTextEntryActive()).toBe(true);
          expect(
            visibleWithData(workspace, { inputAction: 'dictation', dictationAction: 'insert' }),
          ).toBeUndefined();
          const expected =
            method === 'physical Enter' ? 'Check the desk lamp!' : 'Check the desk lamp';
          if (method === 'button') hit(workspace, { inputAction: 'pinNote' });
          else if (method === 'Enter') hit(workspace, { inputAction: 'key', key: 'Enter' });
          else {
            actions.editDictation = (text) =>
              workspace.setDictationState({ ...review(text), forNote: true });
            expect(workspace.typeTextEntryKey('!')).toBe(true);
            expect(workspace.typeTextEntryKey('Enter')).toBe(true);
          }
          expect(Object.values(notes())).toEqual([expected]);
          expect(dictationAction.mock.calls).toEqual([['cancel']]);
          expect(actions.sendKey).not.toHaveBeenCalled();
          expect(actions.sendText).not.toHaveBeenCalled();
        } finally {
          workspace.dispose();
          container.remove();
        }
      },
    );

    it('pins the reviewed transcript in view as a placed note and ends dictation', () => {
      const { workspace, actions, container } = fixture();
      const dictationAction = vi.fn();
      actions.dictationAction = dictationAction;
      workspace.setDictationState({ ...review(''), status: 'listening' });
      workspace.showInput('keyboard');
      expect(workspace.scene.getObjectByName('xr-dictation-pin-note')).toBeUndefined();
      const key = pin(workspace, '  Call   the   vet  ');
      const id = key.slice('sticky-note:'.length);
      expect(notes()).toEqual({ [id]: 'Call the vet' });
      expect(poses()[key]?.placed).toBe(true);
      expect(dictationAction).toHaveBeenLastCalledWith('cancel');
      const text = workspace.scene.getObjectByName('sticky-note-text');
      expect(text?.userData.labelText).toBe('Call the vet');
      workspace.dispose();
      container.remove();
    });

    it('reads a restored long note through the last page and back', () => {
      const text = `First sentence. ${'Repeated words. '.repeat(22)} Final sentence.`;
      localStorage.setItem(
        'mux-xr:sticky-notes:v1',
        JSON.stringify({
          version: 1,
          notes: { 'note-long': text },
        }),
      );
      const { workspace, container } = fixture();
      try {
        fakeXR.frame?.(0);
        hit(workspace, {
          widgetKind: 'sticky-note',
          inputAction: 'readStickyNote',
          helpText: 'Read the full note',
        });
        const page = () =>
          String(workspace.scene.getObjectByName('sticky-note-page')?.userData.labelText);
        expect(page()).toContain('First sentence.');
        for (
          let count = 0;
          count < 12 && visibleWithData(workspace, { inputAction: 'stickyNotePage', delta: 1 });
          count++
        )
          hit(workspace, { inputAction: 'stickyNotePage', delta: 1 });
        expect(page().replace(/\s+/g, ' ')).toContain('Final sentence.');
        expect(
          visibleWithData(workspace, { inputAction: 'stickyNotePage', delta: 1 }),
        ).toBeUndefined();
        hit(workspace, { inputAction: 'stickyNotePage', delta: -1 });
        expect(page()).not.toContain('Final');
      } finally {
        workspace.dispose();
        container.remove();
      }
    });

    it('deletes a note only on a second press within the confirm window', () => {
      vi.useFakeTimers();
      const { workspace, container } = fixture();
      try {
        const key = pin(workspace, 'Ship it');
        hit(workspace, { inputAction: 'widgetControl', widgetKind: 'sticky-note' });
        expect(workspace.state.widgets).toContain(key);
        const confirm = workspace.scene.getObjectByName('sticky-note-confirm');
        expect(confirm?.visible).toBe(true);
        vi.advanceTimersByTime(3100);
        fakeXR.frame?.(100);
        expect(confirm?.visible).toBe(false);
        hit(workspace, { inputAction: 'widgetControl', widgetKind: 'sticky-note' });
        hit(workspace, { inputAction: 'closeWidget', widgetKind: 'sticky-note' });
        expect(workspace.state.widgets).not.toContain(key);
        expect(notes()).toEqual({});
        expect(poses()[key]).toBeUndefined();
      } finally {
        workspace.dispose();
        container.remove();
        vi.useRealTimers();
      }
    });

    it('restores notes after a reload, including one whose pose never saved', () => {
      const first = fixture();
      const key = pin(first.workspace, 'Water the plants');
      first.workspace.dispose();
      first.container.remove();
      const stored = JSON.parse(localStorage.getItem('mux-xr:sticky-notes:v1') ?? '{}');
      stored.notes['note-orphan'] = 'Orphan';
      localStorage.setItem('mux-xr:sticky-notes:v1', JSON.stringify(stored));
      const { workspace, container } = fixture();
      fakeXR.frame?.(16);
      expect(workspace.state.widgets).toEqual(
        expect.arrayContaining([key, 'sticky-note:note-orphan']),
      );
      const texts: unknown[] = [];
      workspace.scene.traverse((object) => {
        if (object.name === 'sticky-note-text') texts.push(object.userData.labelText);
      });
      expect(texts.sort()).toEqual(['Orphan', 'Water the plants']);
      expect(poses()['sticky-note:note-orphan']).toBeDefined();
      workspace.dispose();
      container.remove();
    });
  });

  describe('stream health feed', () => {
    const links = (left: TerminalSurface, right: TerminalSurface) => {
      const stats = {
        bytesReceived: 0,
        reconnects: 0,
        resyncs: 0,
        missedPings: 0,
        rttMs: 24 as number | null,
      };
      const ping = vi.fn(() => true);
      Object.assign(left, { linkStats: stats, pingLink: ping });
      Object.assign(right, { linkStats: { ...stats, rttMs: null }, pingLink: ping });
      return { stats, ping };
    };
    const run = (start: number, seconds: number): number => {
      let time = start;
      for (let frame = 0; frame < seconds * 60; frame += 1) {
        time += 1000 / 60;
        fakeXR.frame?.(time);
      }
      return time;
    };

    it('neither pings nor samples streams while no stream health widget is open', () => {
      const { workspace, container, left, right } = fixture();
      const { ping } = links(left, right);
      const linkStats = vi.fn(() => undefined);
      Object.defineProperty(left, 'linkStats', { get: linkStats });
      run(0, 5);
      expect(ping).not.toHaveBeenCalled();
      expect(linkStats).not.toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    });

    it('pings each pane about once a second and shows its rate and round trip', () => {
      const { workspace, container, left, right } = fixture();
      const { stats, ping } = links(left, right);
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'stream-health' });
      let time = run(0, 1);
      const pings = ping.mock.calls.length;
      expect(pings).toBeGreaterThanOrEqual(2);
      expect(pings).toBeLessThanOrEqual(4);
      stats.bytesReceived = 50 * 1024;
      time = run(time, 2);
      expect(ping.mock.calls.length - pings).toBeGreaterThanOrEqual(2);
      expect(ping.mock.calls.length - pings).toBeLessThanOrEqual(6);
      const label = (name: string) => workspace.scene.getObjectByName(name)?.userData.labelText;
      const rows = [1, 2].map((row) => ({
        name: label(`stream-health-row-${row}-name`),
        rate: label(`stream-health-row-${row}-rate`),
        rtt: label(`stream-health-row-${row}-rtt`),
      }));
      const a = rows.find((row) => row.name === 'A');
      expect(a?.rtt).toBe('24 ms');
      expect(a?.rate).toMatch(/kB\/s$/);
      expect(a?.rate).not.toBe('-- kB/s');
      expect(rows.find((row) => row.name === 'B')?.rtt).toBe('-- ms');
      hit(workspace, { inputAction: 'closeWidget', widgetKind: 'stream-health' });
      const closed = ping.mock.calls.length;
      run(time, 3);
      expect(ping.mock.calls.length).toBe(closed);
      workspace.dispose();
      container.remove();
    });
  });

  describe('performance gauge feed', () => {
    const open = () => {
      const { workspace, container } = fixture();
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'perf-gauge' });
      const label = (name: string) => workspace.scene.getObjectByName(name)?.userData.labelText;
      return { workspace, container, label };
    };
    // Frames at 60 Hz with one injected interval at the given frame.
    const run = (start: number, gapAt: number, gapMs: number, frames = 60): number => {
      let time = start;
      for (let frame = 0; frame <= frames; frame += 1) {
        time += frame === gapAt ? gapMs : 1000 / 60;
        fakeXR.frame?.(time);
      }
      return time;
    };

    // The test XR fake presents without a session frame rate, so the target is the 72 Hz fallback.
    it('feeds the scene FPS against its target, the worst frame and the shown pane count', () => {
      const { workspace, container, label } = open();
      run(0, 20, 40);
      expect(label('perf-gauge-fps')).toBe(`${workspace.state.fps} / 72 fps`);
      expect(label('perf-gauge-worst')).toBe('worst (20 s) 40.0 ms');
      expect(label('perf-gauge-panes')).toBe('2 panes shown');
      workspace.dispose();
      container.remove();
    });

    it('shows a real freeze over a second but skips unreported pauses past 5 s', () => {
      const { workspace, container, label } = open();
      const time = run(0, 20, 6000);
      expect(label('perf-gauge-worst')).toBe('worst (20 s) 16.7 ms');
      run(time, 20, 1500);
      expect(label('perf-gauge-worst')).toBe('worst (20 s) 1500 ms');
      workspace.dispose();
      container.remove();
    });

    it('skips intervals while the page is hidden and across a visibilitychange', () => {
      const { workspace, container, label } = open();
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      let time = run(0, 5, 300, 10);
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      // The first interval after the page shows again spans the hidden time; skip it too.
      time = run(time, 0, 400);
      expect(label('perf-gauge-worst')).toBe('worst (20 s) 16.7 ms');
      // A hide and show with no frame between them still marks the spanning interval a pause.
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      run(time, 0, 700);
      expect(label('perf-gauge-worst')).toBe('worst (20 s) 16.7 ms');
      visibility.mockRestore();
      workspace.dispose();
      container.remove();
    });

    it('skips XR session blur and resets the gauge on session start and end', async () => {
      const { workspace, container, label } = open();
      run(0, 20, 80);
      expect(label('perf-gauge-worst')).toBe('worst (20 s) 80.0 ms');
      const listeners = new Map<string, Array<() => void>>();
      const emit = (type: string) => {
        for (const listener of listeners.get(type) ?? []) listener();
      };
      const session = {
        visibilityState: 'visible',
        frameRate: 90,
        addEventListener: (type: string, listener: () => void) =>
          listeners.set(type, [...(listeners.get(type) ?? []), listener]),
        end: async () => emit('end'),
      };
      vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
      await workspace.enterXR('vr');
      expect(label('perf-gauge-worst')).toBe('worst (20 s) -- ms');
      session.visibilityState = 'visible-blurred';
      emit('visibilitychange');
      let time = run(10_000, 10, 500, 20);
      session.visibilityState = 'visible';
      emit('visibilitychange');
      time = run(time, 0, 600);
      // A blur too brief to span a frame is reported only by its events.
      emit('visibilitychange');
      emit('visibilitychange');
      time = run(time, 0, 900);
      run(time, 30, 25);
      expect(label('perf-gauge-worst')).toBe('worst (20 s) 25.0 ms');
      expect(label('perf-gauge-fps')).toMatch(/ \/ 90 fps$/);
      await session.end();
      expect(label('perf-gauge-worst')).toBe('worst (20 s) -- ms');
      vi.unstubAllGlobals();
      workspace.dispose();
      container.remove();
    });
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

  describe('UI sounds and haptics', () => {
    const feedbackFixture = () => {
      const play = vi.fn();
      const value = fixture({ feedback: { play, dispose: vi.fn() } });
      const cues = (): string[] => play.mock.calls.map((call) => call[0] as string);
      return { ...value, play, cues };
    };

    it('clicks and pulses the controller on control and key presses', () => {
      const { workspace, container, play, cues } = feedbackFixture();
      const gamepad = connectController(0);
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'key', key: 'a' });
      expect(cues()).toEqual(['select']);
      expect(play).toHaveBeenLastCalledWith('select', gamepad);
      hit(workspace, { inputAction: 'noop' });
      expect(cues()).toEqual(['select']);
      workspace.dispose();
      container.remove();
    });

    it('clicks and pulses the left controller once per wrist watch touch press', () => {
      const { workspace, container, play, cues } = feedbackFixture();
      connectController(0, [0, 0, 0, 0], 'right');
      const leftPad = connectController(1, [0, 0, 0, 0], 'left');
      const left = fakeXR.controllers[1] as THREE.Group;
      left.position.x = -0.5;
      fakeXR.frame?.(20);
      const face = objectWithData(workspace, { inputAction: 'wristMenu' });
      const visual = objectWithData(workspace, { handedness: 'left' });
      const touch = (distance: number, time: number): void => {
        workspace.scene.updateMatrixWorld(true);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          face.getWorldQuaternion(new THREE.Quaternion()),
        );
        const point = face.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, distance);
        left.position.add(point.sub(visual.userData.indexTip as THREE.Vector3));
        fakeXR.frame?.(time);
      };
      touch(0.2, 40);
      touch(0.03, 60);
      expect(cues()).toEqual([]);
      expect(workspace.state.radialOpen).toBe(false);
      touch(0, 80);
      expect(workspace.state.radialOpen).toBe(true);
      expect(play.mock.calls).toEqual([['select', leftPad]]);
      touch(0, 100);
      fakeXR.frame?.(400);
      expect(cues()).toEqual(['select']);
      play.mockClear();
      workspace.setUISounds(false);
      touch(0.2, 420);
      touch(0, 440);
      expect(workspace.state.radialOpen).toBe(false);
      expect(play).not.toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    });

    it('reads the left hand contact probes only within reach of the wrist watch', () => {
      const { workspace, container } = feedbackFixture();
      connectController(0, [0, 0, 0, 0], 'right');
      connectController(1, [0, 0, 0, 0], 'left');
      const left = fakeXR.controllers[1] as THREE.Group;
      left.position.x = -0.5;
      fakeXR.frame?.(20);
      const reads = handPoses.probeReads;
      fakeXR.frame?.(40);
      fakeXR.frame?.(60);
      expect(handPoses.probeReads).toBe(reads);
      const face = objectWithData(workspace, { inputAction: 'wristMenu' });
      const visual = objectWithData(workspace, { handedness: 'left' });
      workspace.scene.updateMatrixWorld(true);
      const point = face.getWorldPosition(new THREE.Vector3());
      left.position.add(point.sub(visual.userData.palmPosition as THREE.Vector3)).x -= 0.1;
      fakeXR.frame?.(80);
      expect(handPoses.probeReads).toBeGreaterThan(reads);
      workspace.dispose();
      container.remove();
    });

    it('stays silent when a quick second watch touch is debounced', () => {
      const { workspace, container, cues } = feedbackFixture();
      connectController(0, [0, 0, 0, 0], 'right');
      connectController(1, [0, 0, 0, 0], 'left');
      const left = fakeXR.controllers[1] as THREE.Group;
      left.position.x = -0.5;
      fakeXR.frame?.(20);
      const face = objectWithData(workspace, { inputAction: 'wristMenu' });
      const visual = objectWithData(workspace, { handedness: 'left' });
      const touch = (distance: number, time: number): void => {
        workspace.scene.updateMatrixWorld(true);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          face.getWorldQuaternion(new THREE.Quaternion()),
        );
        const point = face.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, distance);
        left.position.add(point.sub(visual.userData.indexTip as THREE.Vector3));
        fakeXR.frame?.(time);
      };
      touch(0.2, 40);
      touch(0, 60);
      expect(workspace.state.radialOpen).toBe(true);
      touch(0.2, 80);
      touch(0, 100);
      expect(workspace.state.radialOpen).toBe(true);
      expect(cues()).toEqual(['select']);
      workspace.dispose();
      container.remove();
    });

    it('cues a grab and its release once each and a held modifier lock', () => {
      const { workspace, container, cues } = feedbackFixture();
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      controller.position.set(0.87, 1.5, 0);
      workspace.scene.updateMatrixWorld(true);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(16);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      expect(cues()).toEqual(['grab', 'release']);
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'key', key: 'Shift' });
      fakeXR.frame?.(100);
      fakeXR.frame?.(700);
      expect(cues()).toEqual(['grab', 'release', 'select', 'lock']);
      workspace.dispose();
      container.remove();
    });

    it('ticks for each strip scroll batch and cues the both-stick recenter', () => {
      const { workspace, actions, container, cues } = feedbackFixture();
      actions.scrollTerminal = vi.fn(() => true);
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const strip = workspace.scene
        .getObjectByName('terminal-panel-pane-a')
        ?.getObjectByName('terminal-scroll-strip') as THREE.Mesh;
      aimControllerAtScreen(controller, strip, new THREE.Vector3(0, 0, 0));
      fakeXR.frame?.(10);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      for (let step = 1; step <= 4; step += 1) {
        aimControllerAtScreen(controller, strip, new THREE.Vector3(0, -0.1 * step, 0));
        fakeXR.frame?.(10 + step * 50);
      }
      controller.dispatchEvent({ type: 'selectend' } as never);
      const scrolls = (actions.scrollTerminal as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(scrolls).toBeGreaterThan(1);
      expect(cues().filter((cue) => cue === 'tick')).toHaveLength(scrolls);
      const leftPad = connectController(0);
      const rightPad = connectController(1);
      (leftPad.buttons as unknown as Array<{ pressed: boolean }>)[3].pressed = true;
      (rightPad.buttons as unknown as Array<{ pressed: boolean }>)[3].pressed = true;
      for (let frame = 0; frame <= 25; frame += 1) fakeXR.frame?.(1000 + frame * 50);
      expect(cues().filter((cue) => cue === 'recenter')).toHaveLength(1);
      workspace.dispose();
      container.remove();
    });

    it('stays silent and still when UI sounds are off in XR Settings', () => {
      const { workspace, container, play } = feedbackFixture();
      connectController(0);
      workspace.showInput('settings');
      expect(objectWithData(workspace, { inputAction: 'uiSounds' }).userData.labelText).toBe(
        'UI sounds: on',
      );
      const listener = vi.fn();
      workspace.subscribe(listener);
      hit(workspace, { inputAction: 'uiSounds' });
      expect(workspace.state.uiSounds).toBe(false);
      expect(listener).toHaveBeenCalled();
      expect(objectWithData(workspace, { inputAction: 'uiSounds' }).userData.labelText).toBe(
        'UI sounds: off',
      );
      play.mockClear();
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'key', key: 'a' });
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.set(0.87, 1.5, 0);
      workspace.hideInput();
      workspace.scene.updateMatrixWorld(true);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      expect(play).not.toHaveBeenCalled();
      workspace.setUISounds(true);
      expect(workspace.state.uiSounds).toBe(true);
      workspace.dispose();
      container.remove();
    });
  });

  describe('press-twice confirmation and ray cursor', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('pulses the pressing controller for the Reset confirm', () => {
      vi.useFakeTimers();
      const play = vi.fn();
      const { workspace, container } = fixture({ feedback: { play, dispose: vi.fn() } });
      const gamepad = connectController(0);
      workspace.showInput('arrange');
      hit(workspace, { inputAction: 'resetLayout' });
      expect(play.mock.calls).toEqual([['armed', gamepad]]);
      vi.advanceTimersByTime(500);
      hit(workspace, { inputAction: 'resetLayout' });
      expect(play).toHaveBeenLastCalledWith('recenter', gamepad);
      expect(play.mock.calls.map(([kind]) => kind)).toEqual(['armed', 'recenter']);
      play.mockClear();
      void workspace.pasteClipboard('missing-pane');
      expect(play.mock.calls).toEqual([['error', null]]);
      play.mockClear();
      hit(workspace, { inputAction: 'exit' });
      expect(objectWithData(workspace, { inputAction: 'exit' }).userData.armed).toBe(true);
      workspace.dispose();
      container.remove();
    });

    it('rebuilds Arrange only when the Reset layout arm state changes', () => {
      vi.useFakeTimers();
      const { workspace, container } = fixture();
      connectController(0);
      workspace.showInput('arrange');
      const arrange = workspace.scene.getObjectByName('xr-arrange-controls');
      hit(workspace, { inputAction: 'exit' });
      vi.advanceTimersByTime(3001);
      expect(workspace.scene.getObjectByName('xr-arrange-controls')).toBe(arrange);
      hit(workspace, { inputAction: 'resetLayout' });
      expect(workspace.scene.getObjectByName('xr-arrange-controls')).not.toBe(arrange);
      workspace.dispose();
      container.remove();
    });

    it('arms HUD Exit on the first press and exits only on a second press in the window', () => {
      vi.useFakeTimers();
      const play = vi.fn();
      const { workspace, actions, container } = fixture({ feedback: { play, dispose: vi.fn() } });
      actions.exitPreview = vi.fn();
      const gamepad = connectController(0);
      hit(workspace, { inputAction: 'exit' });
      const exit = objectWithData(workspace, { inputAction: 'exit' }) as THREE.Mesh;
      expect(actions.exitPreview).not.toHaveBeenCalled();
      expect(exit.userData.labelText).toBe('Exit?');
      expect(exit.userData.armed).toBe(true);
      expect((exit.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(0xffffff);
      expect(play.mock.calls).toEqual([['armed', gamepad]]);
      vi.advanceTimersByTime(3001);
      expect(exit.userData.labelText).toBe('Exit');
      expect((exit.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
      hit(workspace, { inputAction: 'exit' });
      expect(actions.exitPreview).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      hit(workspace, { inputAction: 'exit' });
      expect(actions.exitPreview).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      hit(workspace, { inputAction: 'exit' });
      expect(actions.exitPreview).toHaveBeenCalledOnce();
      expect(exit.userData.labelText).toBe('Exit');
      workspace.dispose();
      container.remove();
    });

    it('needs a second press to reset the layout and disarms on another control', () => {
      vi.useFakeTimers();
      const { workspace, container } = fixture();
      workspace.showInput('arrange');
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      panel.position.x -= 0.5;
      const moved = panel.position.clone();
      hit(workspace, { inputAction: 'resetLayout' });
      expect(panel.position.distanceTo(moved)).toBe(0);
      const armed = objectWithData(workspace, { inputAction: 'resetLayout' });
      expect(armed.userData.labelText).toBe('Reset?');
      expect(armed.userData.armed).toBe(true);
      vi.advanceTimersByTime(400);
      hit(workspace, { inputAction: 'layoutDepth', direction: 1 });
      const after = panel.position.clone();
      expect(objectWithData(workspace, { inputAction: 'resetLayout' }).userData.labelText).toBe(
        'Reset layout',
      );
      hit(workspace, { inputAction: 'resetLayout' });
      expect(panel.position.distanceTo(after)).toBe(0);
      vi.advanceTimersByTime(400);
      hit(workspace, { inputAction: 'resetLayout' });
      expect(panel.position.distanceTo(after)).toBeGreaterThan(0.1);
      expect(objectWithData(workspace, { inputAction: 'resetLayout' }).userData.labelText).toBe(
        'Reset layout',
      );
      workspace.dispose();
      container.remove();
    });

    it('scales the ray hit cursor with distance to about half a degree', () => {
      const { workspace, container } = fixture();
      connectController(0);
      const controller = fakeXR.controllers[0] as THREE.Group;
      const screen = workspace.scene
        .getObjectByName('terminal-panel-pane-a')
        ?.getObjectByName('terminal-surface') as THREE.Mesh;
      const cursor = controller.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
      const sizeAt = (distance: number, time: number): number => {
        aimControllerAtScreen(controller, screen, new THREE.Vector3(0, 0, 0), distance);
        fakeXR.frame?.(time);
        expect(cursor.visible).toBe(true);
        return 2 * 0.003 * cursor.scale.x;
      };
      const far = sizeAt(4, 10);
      expect(THREE.MathUtils.radToDeg(2 * Math.atan(far / 2 / 4))).toBeCloseTo(0.5, 2);
      const mid = sizeAt(2, 20);
      expect(far / mid).toBeCloseTo(2, 5);
      expect(sizeAt(0.1, 30)).toBeCloseTo(0.003, 6);
      workspace.dispose();
      container.remove();
    });
  });

  it('locks a held modifier across keys and releases it on a later tap', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'Shift' });
    fakeXR.frame?.(0);
    fakeXR.frame?.(600);
    const locked = objectWithData(workspace, { inputAction: 'key', key: 'Shift' });
    expect(locked.userData.locked).toBe(true);
    hit(workspace, { inputAction: 'key', key: 'a' });
    hit(workspace, { inputAction: 'key', key: 'b' });
    expect(actions.sendKey).toHaveBeenNthCalledWith(1, 'a', { shift: true });
    expect(actions.sendKey).toHaveBeenNthCalledWith(2, 'b', { shift: true });
    hit(workspace, { inputAction: 'key', key: 'Shift' });
    hit(workspace, { inputAction: 'key', key: 'c' });
    expect(actions.sendKey).toHaveBeenLastCalledWith('c', undefined);
    workspace.dispose();
    container.remove();
  });

  it('cancels modifier holds on release and clears locks on target change', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'Control' });
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'selectend' } as never);
    fakeXR.frame?.(0);
    fakeXR.frame?.(700);
    hit(workspace, { inputAction: 'key', key: 'a' });
    hit(workspace, { inputAction: 'key', key: 'b' });
    expect(actions.sendKey).toHaveBeenLastCalledWith('b', undefined);
    hit(workspace, { inputAction: 'key', key: 'Shift' });
    fakeXR.frame?.(800);
    fakeXR.frame?.(1400);
    workspace.selectTerminal('pane-b');
    hit(workspace, { inputAction: 'key', key: 'c' });
    expect(actions.sendKey).toHaveBeenLastCalledWith('c', undefined);
    workspace.dispose();
    container.remove();
  });

  it('toggles Panes with left X and leaves the radial to right A', () => {
    const { workspace, container } = fixture();
    const gamepad = connectController(0, [0, 0, 0, 0], 'left');
    const press = (time: number): void => {
      (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
      fakeXR.frame?.(time);
      (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
      fakeXR.frame?.(time + 16);
    };
    press(0);
    expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeDefined();
    expect(workspace.state.radialOpen).toBe(false);
    press(100);
    expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeUndefined();
    workspace.dispose();
    container.remove();
  });

  it('closes an open radial when left X opens Panes', () => {
    const { workspace, container } = fixture();
    const right = connectController(1, [0, 0, 0, 0], 'right');
    const left = connectController(0, [0, 0, 0, 0], 'left');
    (right.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    expect(workspace.state.radialOpen).toBe(true);
    (left.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(16);
    expect(workspace.state.radialOpen).toBe(false);
    expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeDefined();
    workspace.dispose();
    container.remove();
  });

  it('opens Panes, not the radial, when right A and left X land in one frame', () => {
    for (const leftFirst of [true, false]) {
      const { workspace, container } = fixture();
      const left = connectController(leftFirst ? 0 : 1, [0, 0, 0, 0], 'left');
      const right = connectController(leftFirst ? 1 : 0, [0, 0, 0, 0], 'right');
      (left.buttons[4] as { pressed: boolean }).pressed = true;
      (right.buttons[4] as { pressed: boolean }).pressed = true;
      fakeXR.frame?.(0);
      expect(workspace.state.radialOpen).toBe(false);
      expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeDefined();
      workspace.dispose();
      container.remove();
    }
  });

  it('ignores left X during Warp', () => {
    const { workspace, container } = fixture();
    // The pointing helper aims controller 0, so the right controller takes index 0 here.
    const right = connectController(0, [0, 0, 0, 0], 'right');
    const left = connectController(1, [0, 0, 0, 0], 'left');
    selectRadialAction(workspace, right, 'warp', 0);
    expect(workspace.state.warpTerminalId).toBe('pane-a');
    (left.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(1500);
    expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeUndefined();
    expect(workspace.state.warpTerminalId).toBe('pane-a');
    (left.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(1516);
    workspace.dispose();
    container.remove();
  });

  it('does not toggle Panes for a left X already held at connect', () => {
    const { workspace, container } = fixture();
    const gamepad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 8 }, (_, index) => ({ pressed: index === 4 })),
    } as unknown as Gamepad;
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({
      type: 'connected',
      data: { gamepad, handedness: 'left' },
    } as never);
    fakeXR.frame?.(0);
    expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeUndefined();
    workspace.dispose();
    container.remove();
  });

  it('runs a remapped function from left Y and lets right A do nothing', () => {
    const { workspace, container } = fixture();
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      buttonMap: { ...DEFAULT_BUTTON_MAP, leftY: 'keyboard', rightA: 'none' },
    });
    const right = connectController(1, [0, 0, 0, 0], 'right');
    const left = connectController(0, [0, 0, 0, 0], 'left');
    (right.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    expect(workspace.state.radialOpen).toBe(false);
    (left.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(16);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    (left.buttons[5] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(32);
    (left.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(48);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    workspace.dispose();
    container.remove();
  });

  it('brings the keyboard in front of the viewer when its button is held', () => {
    const { workspace, container } = fixture();
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      buttonMap: { ...DEFAULT_BUTTON_MAP, leftY: 'keyboard' },
    });
    const left = connectController(0, [0, 0, 0, 0], 'left');
    let time = 0;
    const press = (down: boolean, after = 16) => {
      time += after;
      (left.buttons[5] as { pressed: boolean }).pressed = down;
      fakeXR.frame?.(time);
    };
    const hold = () => {
      for (let frame = 0; frame < 45; frame += 1) press(true);
    };
    press(true, 0);
    press(false);
    const keyboard = () => workspace.scene.getObjectByName('xr-keyboard-controls');
    const spawn = keyboard()?.position.clone();
    expect(spawn).toBeDefined();
    const head = workspace.camera.getWorldPosition(new THREE.Vector3());
    const front = (spawn as THREE.Vector3).clone().lerp(head, 0.2);
    keyboard()?.position.set(4, 2, 3);
    // A short press still toggles, wherever the keyboard was left.
    press(true, 100);
    press(false);
    expect(keyboard()).toBeUndefined();
    press(true, 100);
    press(false);
    expect(keyboard()?.position.distanceTo(new THREE.Vector3(4, 2, 3))).toBeLessThan(1e-6);
    // Held past the threshold, it lands in front again, from shown or hidden.
    press(true, 100);
    hold();
    press(false);
    expect(keyboard()?.position.distanceTo(front as THREE.Vector3)).toBeLessThan(1e-3);
    keyboard()?.position.set(-3, 1, 2);
    press(true, 100);
    press(false);
    expect(keyboard()).toBeUndefined();
    press(true, 100);
    hold();
    expect(keyboard()?.position.distanceTo(front as THREE.Vector3)).toBeLessThan(1e-3);
    press(false);
    expect(keyboard()).toBeDefined();
    workspace.dispose();
    container.remove();
  });

  it('keeps right A save and right B cancel during Warp whatever they are mapped to', () => {
    const { workspace, container } = fixture();
    const pad = connectController(0, [0, 0, 0, 0], 'right');
    selectRadialAction(workspace, pad, 'warp', 0);
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      buttonMap: { ...DEFAULT_BUTTON_MAP, rightA: 'keyboard', rightB: 'none' },
    });
    (pad.axes as number[])[2] = 1;
    fakeXR.frame?.(1200);
    (pad.axes as number[])[2] = 0;
    const previewed = workspace.getTerminalCurvature('pane-a');
    expect(previewed).toBeGreaterThan(0);
    (pad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(1300);
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(workspace.getTerminalCurvature('pane-a')).toBe(previewed);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    (pad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(1316);
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      buttonMap: DEFAULT_BUTTON_MAP,
    });
    selectRadialAction(workspace, pad, 'warp', 2000);
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      buttonMap: { ...DEFAULT_BUTTON_MAP, rightA: 'keyboard', rightB: 'none' },
    });
    (pad.axes as number[])[2] = 1;
    fakeXR.frame?.(3200);
    (pad.axes as number[])[2] = 0;
    (pad.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(3300);
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(workspace.getTerminalCurvature('pane-a')).toBe(previewed);
    workspace.dispose();
    container.remove();
  });

  it('cycles and resets button functions from XR Settings → Controller buttons', () => {
    const { workspace, container } = fixture();
    workspace.showInput('settings');
    hit(workspace, { inputAction: 'openInput', mode: 'buttons' });
    expect(workspace.scene.getObjectByName('xr-buttons-controls')).toBeDefined();
    hit(workspace, { inputAction: 'buttonMapNext', controllerButton: 'leftY' });
    expect(workspace.state.windowPreferences.buttonMap.leftY).toBe('menu');
    hit(workspace, { inputAction: 'buttonMapNext', controllerButton: 'leftY' });
    expect(workspace.state.windowPreferences.buttonMap.leftY).toBe('panes');
    hit(workspace, { inputAction: 'buttonMapReset' });
    expect(workspace.state.windowPreferences.buttonMap).toEqual(DEFAULT_BUTTON_MAP);
    workspace.dispose();
    container.remove();
  });

  it('opens the radial when right A lands with a button mapped to Nothing', () => {
    const { workspace, container } = fixture();
    const right = connectController(1, [0, 0, 0, 0], 'right');
    const left = connectController(0, [0, 0, 0, 0], 'left');
    (left.buttons[5] as { pressed: boolean }).pressed = true;
    (right.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    expect(workspace.state.radialOpen).toBe(true);
    workspace.dispose();
    container.remove();
  });

  it('starts Warp from a mapped button on the aimed pane, or says to select one', () => {
    const { workspace, container } = fixture();
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      buttonMap: { ...DEFAULT_BUTTON_MAP, leftY: 'warp' },
    });
    const right = connectController(1, [0, 0, 0, 0], 'right');
    const left = connectController(0, [0, 0, 0, 0], 'left');
    (left.buttons[5] as { pressed: boolean }).pressed = true;
    (right.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    expect(workspace.state.warpTerminalId).toBe('pane-a');
    workspace.dispose();
    container.remove();
  });

  it('closes Settings from a sub-page with a button mapped to Settings', () => {
    const { workspace, container } = fixture();
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      buttonMap: { ...DEFAULT_BUTTON_MAP, leftY: 'settings' },
    });
    const left = connectController(0, [0, 0, 0, 0], 'left');
    workspace.showInput('display');
    (left.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    expect(workspace.scene.getObjectByName('xr-display-controls')).toBeUndefined();
    (left.buttons[5] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(16);
    (left.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(32);
    expect(workspace.scene.getObjectByName('xr-settings-controls')).toBeDefined();
    workspace.dispose();
    container.remove();
  });

  it('leaves Focus to right B, so left Y does nothing', () => {
    const { workspace, container } = fixture();
    const left = connectController(0, [0, 0, 0, 0], 'left');
    const right = connectController(1, [0, 0, 0, 0], 'right');
    (left.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    expect(workspace.state.focusModeTerminalId).toBeNull();
    (right.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(16);
    expect(workspace.state.focusModeTerminalId).not.toBeNull();
    workspace.dispose();
    container.remove();
  });

  it('keeps the main HUD to pane status and Exit with no Menu button', () => {
    const { workspace, container } = fixture();
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!hud) throw new Error('HUD missing');
    const actions: string[] = [];
    hud.traverse((object) => {
      if (object.userData.inputAction) actions.push(object.userData.inputAction as string);
    });
    expect(actions).not.toContain('toggleRadial');
    expect(actions).toContain('exit');
    workspace.dispose();
    container.remove();
  });

  it('keeps Display settings rows clear of Back and Close', () => {
    const { workspace, container } = fixture();
    workspace.showInput('display');
    const controls = workspace.scene.getObjectByName('xr-input-controls') ?? workspace.scene;
    const boxes = new Map<string, THREE.Box3>();
    controls.traverse((object) => {
      const action = object.userData.inputAction as string | undefined;
      if (action && object instanceof THREE.Mesh && !boxes.has(action))
        boxes.set(action, new THREE.Box3().setFromObject(object));
    });
    const chin = boxes.get('frameChin');
    const close = boxes.get('close');
    if (!chin || !close) throw new Error('Display controls missing');
    expect(chin.min.y).toBeGreaterThan(close.max.y);
    workspace.dispose();
    container.remove();
  });

  it('opens radial with right A and preserves keyboard pose and target through selection', () => {
    const { workspace, container } = fixture();
    const gamepad = connectController(1, [0, 0, 0, 0], 'right');
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    const radial = workspace.scene.getObjectByName('radial-menu');
    expect(radial?.visible).toBe(true);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    fakeXR.frame?.(100);
    expect(radial?.visible).toBe(true);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(120);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(140);
    expect(workspace.state.radialOpen).toBe(false);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(360);
    expect(radial?.visible).toBe(false);
    selectKeyboardViaRadial(workspace, gamepad, 400);
    let keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Radial keyboard action did not open keyboard');
    keyboard.position.x += 0.3;
    const position = keyboard.position.clone();
    selectKeyboardViaRadial(workspace, gamepad, 1600);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    selectKeyboardViaRadial(workspace, gamepad, 2800);
    keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    expect(keyboard?.position).toEqual(position);
    expect(workspace.state.inputTargetId).toBe('pane-a');
    workspace.dispose();
    container.remove();
  });

  it('consumes A pressed during grip until a new physical press', () => {
    const { workspace, container } = fixture();
    const gamepad = connectController(0);
    (gamepad.buttons[1] as { pressed: boolean }).pressed = true;
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    (gamepad.buttons[1] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(100);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(120);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(140);
    expect(workspace.scene.getObjectByName('radial-menu')?.visible).toBe(true);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(1040);
    hit(workspace, { inputAction: 'radialAction', radialAction: 'keyboard' });
    fakeXR.frame?.(1240);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    workspace.dispose();
    container.remove();
  });

  it('treats radial as a modal A menu and routes each action to its panel', () => {
    const { workspace, actions, container } = fixture();
    const gamepad = connectController(1, [0, 0, 0, 0], 'right');
    openRadialMenu(gamepad, 0);
    const radial = workspace.scene.getObjectByName('radial-menu');
    expect(radial?.visible).toBe(true);
    expect(radial?.userData.inputAction).toBe('grabRadial');
    const sendsBeforeEarlySelection = (actions.sendKey as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    expect((gamepad.buttons[4] as { pressed: boolean }).pressed).toBe(false);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(1000);
    expect(workspace.state.radialOpen).toBe(false);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(1200);
    expect(radial?.visible).toBe(false);
    expect((actions.sendKey as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      sendsBeforeEarlySelection,
    );

    selectRadialAction(workspace, gamepad, 'commands', 1400);
    expect(workspace.scene.getObjectByName('xr-commands-controls')).toBeDefined();
    selectRadialAction(workspace, gamepad, 'layout', 2600);
    expect(workspace.scene.getObjectByName('xr-arrange-controls')).toBeDefined();
    selectRadialAction(workspace, gamepad, 'widgets', 3800);
    expect(workspace.scene.getObjectByName('xr-widgets-controls')).toBeDefined();
    selectRadialAction(workspace, gamepad, 'warp', 5000);
    expect(workspace.state.warpTerminalId).toBe('pane-a');
    expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeUndefined();
    expect(radial?.visible).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('keeps Exit available during direct Warp and discards its preview', () => {
    const { workspace, actions, container } = fixture();
    actions.exitPreview = vi.fn();
    const pad = connectController(1, [0, 0, 0, 0], 'right');
    selectRadialAction(workspace, pad, 'warp', 0);
    (pad.axes as number[])[2] = 1;
    fakeXR.frame?.(1200);
    expect(workspace.getTerminalCurvature('pane-a')).toBeGreaterThan(0);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    hit(workspace, { inputAction: 'exit' });
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(workspace.getTerminalCurvature('pane-a')).toBe(0);
    expect(actions.exitPreview).not.toHaveBeenCalled();
    clock.mockReturnValue(now + 400);
    hit(workspace, { inputAction: 'exit' });
    clock.mockRestore();
    expect(actions.exitPreview).toHaveBeenCalledOnce();
    workspace.dispose();
    container.remove();
  });

  it('corrects a pending floor violation when a Warp preview is saved', () => {
    const { workspace, container } = fixture();
    const pad = connectController(1, [0, 0, 0, 0], 'right');
    selectRadialAction(workspace, pad, 'warp', 0);
    workspace.restoreTerminalPose('pane-a', {
      position: [0, -2, -1.5],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    });
    const root = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!root) throw new Error('Warp panel missing');
    expect(new THREE.Box3().setFromObject(root).min.y).toBeLessThan(0);
    (pad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(1400);
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(new THREE.Box3().setFromObject(root).min.y).toBeGreaterThanOrEqual(0.095 - 1e-6);
    workspace.dispose();
    container.remove();
  });

  it('refreshes the compact HUD when active pane status and title change', () => {
    const { workspace, container } = fixture();
    const live = surface(pane('live', 'Live'));
    let changed = (): void => undefined;
    live.subscribe = (listener) => {
      changed = listener;
      return () => undefined;
    };
    workspace.addTerminal(live);
    workspace.selectTerminal('live');
    const label = workspace.scene.getObjectByName('xr-active-pane');
    expect(label?.userData.labelText).toBe('Live · connected');
    Object.assign(live, { status: 'disconnected' });
    changed();
    expect(label?.userData.labelText).toBe('Live · disconnected');
    workspace.setAvailablePanes([pane('live', 'Renamed')]);
    expect(label?.userData.labelText).toBe('Renamed · disconnected');
    workspace.dispose();
    container.remove();
  });

  it('pauses Warp while gripping and retains normal physical movement', () => {
    const { workspace, actions, container } = fixture();
    const pad = connectController(1, [0, 0, 0, 0], 'right');
    selectRadialAction(workspace, pad, 'warp', 0);
    (pad.axes as number[])[2] = 1;
    (pad.axes as number[])[3] = 1;
    fakeXR.frame?.(1200);
    const curve = workspace.getTerminalCurvature('pane-a');
    const opacity = workspace.getTerminalOpacity('pane-a');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!panel) throw new Error('Pane A missing');
    const position = panel.position.clone();
    hit(workspace, { terminalTitle: true, terminalId: 'pane-a' }, 'squeezestart');
    const left = fakeXR.controllers[0] as THREE.Group;
    left.position.x += 0.2;
    fakeXR.frame?.(1300);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(curve);
    expect(workspace.getTerminalOpacity('pane-a')).toBe(opacity);
    expect(panel.position.x).toBeCloseTo(position.x + 0.2);
    left.dispatchEvent({ type: 'squeezeend' } as never);
    fakeXR.frame?.(1400);
    expect(workspace.getTerminalCurvature('pane-a')).toBeGreaterThan(curve);
    expect(workspace.getTerminalOpacity('pane-a')).toBeLessThan(opacity);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('cancels an unsaved Warp when the immersive session ends', async () => {
    const listeners = new Map<string, () => void>();
    const session = {
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    try {
      await workspace.enterXR('vr');
      const pad = connectController(1, [0, 0, 0, 0], 'right');
      selectRadialAction(workspace, pad, 'warp', 0);
      (pad.axes as number[])[2] = 1;
      fakeXR.frame?.(1200);
      expect(workspace.getTerminalCurvature('pane-a')).toBeGreaterThan(0);
      fakeXR.presenting = false;
      listeners.get('end')?.();
      expect(workspace.state.warpTerminalId).toBeNull();
      expect(workspace.getTerminalCurvature('pane-a')).toBe(0);
    } finally {
      workspace.dispose();
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it('leaves XR and prepares a fresh browser action for a different immersive mode', async () => {
    const listeners = new Map<string, () => void>();
    const session = {
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      end: vi.fn(async () => {
        fakeXR.presenting = false;
        listeners.get('end')?.();
      }),
    };
    const request = vi.fn(async () => session);
    vi.stubGlobal('navigator', { xr: { requestSession: request } });
    const { workspace, actions, container } = fixture();
    actions.setXREntryMode = vi.fn();
    try {
      await workspace.enterXR('vr');
      workspace.showInput('settings');
      hit(workspace, { inputAction: 'openInput', mode: 'world' });
      hit(workspace, { inputAction: 'xrMode', xrMode: 'ar' });
      await Promise.resolve();
      await Promise.resolve();
      expect(actions.setXREntryMode).toHaveBeenCalledWith('ar');
      expect(session.end).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
      expect(workspace.state.xrMode).toBe('desktop');
      expect(workspace.state.notice).toContain('Enter passthrough');
    } finally {
      workspace.dispose();
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it('opens a desk window in AR, moves and scales it by the rim, and restores its pose', async () => {
    const listeners = new Map<string, () => void>();
    const session = {
      environmentBlendMode: 'alpha-blend',
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      end: vi.fn(async () => listeners.get('end')?.()),
    };
    const requestSession = vi.fn(async () => session);
    vi.stubGlobal('navigator', { xr: { requestSession } });
    const { workspace, actions, container } = fixture();
    try {
      await workspace.enterXR('desk');
      const viewer = { x: 0, y: 1.52, z: 0, w: 1 };
      const orientation = { x: 0, y: 0, z: 0, w: 1 };
      const framePose = {
        getViewerPose: () => ({
          transform: { position: viewer, orientation },
          views: [
            { eye: 'left', transform: { position: { ...viewer, x: -0.032, z: 0.012 } } },
            { eye: 'right', transform: { position: { ...viewer, x: 0.032, z: -0.012 } } },
          ],
        }),
      };
      fakeXR.frame?.(0, framePose);
      expect(requestSession).toHaveBeenCalledWith('immersive-ar', expect.anything());
      expect(workspace.state.xrMode).toBe('ar');
      expect(workspace.state.widgets).toContain('desk-window');
      expect(workspace.scene.background).toBeNull();
      expect(workspace.scene.getObjectByName('desk-window-backdrop')?.visible).toBe(true);
      const frame = workspace.scene.getObjectByName('desk-window');
      const rimLeft = frame?.getObjectByName('desk-window-rim-left');
      const rimRight = frame?.getObjectByName('desk-window-rim-right');
      if (!frame || !rimLeft || !rimRight) throw new Error('Desk window frame is missing');
      const rimMaterial = (rimLeft as THREE.Mesh<THREE.PlaneGeometry, THREE.Material>).material;
      const close = frame.getObjectByName('desk-window-close');
      const aperture = frame.getObjectByName('desk-window-aperture') as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.ShaderMaterial
      >;
      expect(aperture.material.uniforms.viewerCenter.value).toBeInstanceOf(THREE.Vector3);
      expect(rimMaterial.visible).toBe(true);
      expect(close?.visible).toBe(false);
      expect(close?.position.z).toBe(0);
      expect(frame.getObjectByName('desk-window-feather')).toBeUndefined();
      // Keep the terminal furniture away from the controller rays aimed at the rim.
      workspace.scene.getObjectByName('terminal-panel-pane-a')?.position.setX(-5);
      workspace.scene.getObjectByName('terminal-panel-pane-b')?.position.setX(5);
      const left = fakeXR.controllers[0] as THREE.Group;
      const right = fakeXR.controllers[1] as THREE.Group;
      const pad = connectController(0, [0, 0, 0, 0], 'left');
      connectController(1, [0, 0, 0, 0], 'right');
      const leftEye = new THREE.Vector3(-0.032, 0, 0.012);
      const rightEye = new THREE.Vector3(0.032, 0, -0.012);
      const ray = new THREE.Raycaster();
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.quaternion);
      const rimPoint = rimLeft.getWorldPosition(new THREE.Vector3());
      for (const offset of [leftEye, rightEye, new THREE.Vector3()]) {
        const point = rimPoint.clone().add(offset);
        ray.set(point.clone().addScaledVector(normal, 0.3), normal.clone().negate());
        const match = ray.intersectObject(frame, true)[0] as DeskWindowIntersection;
        expect(match?.object).toBe(rimLeft);
        expect(match?.point.distanceTo(point)).toBeLessThan(1e-6);
        expect(match?.deskWindowPoint?.distanceTo(rimPoint)).toBeLessThan(1e-6);
      }
      const middle = frame.getWorldPosition(new THREE.Vector3());
      ray.set(middle.clone().addScaledVector(normal, 0.3), normal.clone().negate());
      expect(ray.intersectObject(frame, true)).toEqual([]);
      expect(
        createHandContact().grip([{ point: middle, radius: 0.04 }], [frame as THREE.Group]),
      ).toBeNull();
      aimController(left, rimLeft);
      left.position.add(leftEye);
      fakeXR.frame?.(16, framePose);
      expect(left.userData.rayDistance).toBeCloseTo(0.3, 5);
      left.dispatchEvent({ type: 'squeezestart' } as never);
      const initial = frame.position.clone();
      const initialRotation = frame.quaternion.clone();
      left.position.x += 0.16;
      (pad.axes as number[])[3] = 0.8;
      fakeXR.frame?.(32);
      expect(frame.position.x).toBeCloseTo(initial.x + 0.16);
      expect(frame.quaternion.angleTo(initialRotation)).toBeGreaterThan(0.01);
      expect(rimMaterial.visible).toBe(true);
      (pad.axes as number[])[3] = 0;
      aimController(right, rimRight);
      right.position.add(rightEye);
      right.dispatchEvent({ type: 'squeezestart' } as never);
      const scale = frame.scale.x;
      left.position.x -= 0.1;
      right.position.x += 0.1;
      fakeXR.frame?.(64);
      expect(frame.scale.x).toBeGreaterThan(scale);
      left.dispatchEvent({ type: 'squeezeend' } as never);
      right.dispatchEvent({ type: 'squeezeend' } as never);
      const saved = frame.position.clone();
      left.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      right.quaternion.copy(left.quaternion);
      fakeXR.frame?.(80);
      expect(rimMaterial.visible).toBe(true);
      expect(close?.visible).toBe(false);
      aimController(left, rimLeft);
      fakeXR.frame?.(96);
      expect(rimMaterial.visible).toBe(true);
      expect(close?.visible).toBe(true);
      if (!close) throw new Error('Desk Window close control is missing');
      for (const offset of [leftEye, rightEye]) {
        const center = close.getWorldPosition(new THREE.Vector3());
        const point = center.clone().add(offset);
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.quaternion);
        ray.set(point.clone().addScaledVector(facing, 0.3), facing.negate());
        const match = ray.intersectObject(frame, true)[0] as DeskWindowIntersection;
        expect(match?.object).toBe(close);
        expect(match?.deskWindowPoint?.distanceTo(center)).toBeLessThan(1e-6);
      }
      aimController(left, close);
      left.position.add(rightEye);
      left.dispatchEvent({ type: 'selectstart' } as never);
      expect(workspace.state.widgets).not.toContain('desk-window');
      expect(workspace.state.xrMode).toBe('ar');
      expect(workspace.scene.getObjectByName('desk-window-backdrop')?.visible).toBe(true);
      expect(workspace.state.fullPassthrough).toBe(false);
      expect(session.end).not.toHaveBeenCalled();
      workspace.showInput('world');
      hit(workspace, { inputAction: 'xrMode', xrMode: 'desk' });
      const restored = workspace.scene.getObjectByName('desk-window');
      expect(restored?.position.distanceTo(saved)).toBeLessThan(1e-6);
      workspace.showInput('world');
      hit(workspace, { inputAction: 'xrMode', xrMode: 'vr' });
      expect(workspace.state.widgets).not.toContain('desk-window');
      expect(workspace.scene.getObjectByName('desk-window-backdrop')?.visible).toBe(true);
      expect(workspace.state.fullPassthrough).toBe(false);
      hit(workspace, { inputAction: 'xrMode', xrMode: 'ar' });
      expect(workspace.state.fullPassthrough).toBe(true);
      expect(workspace.scene.getObjectByName('desk-window-backdrop')?.visible).toBe(false);
      hit(workspace, { inputAction: 'xrMode', xrMode: 'desk' });
      expect(workspace.state.widgets).toContain('desk-window');
      expect(session.end).not.toHaveBeenCalled();
      expect(requestSession).toHaveBeenCalledOnce();
      expect(actions.sendKey).not.toHaveBeenCalled();
      await workspace.exitXR();
      expect(workspace.state.xrMode).toBe('desktop');
      expect(workspace.scene.getObjectByName('desk-window')).toBeUndefined();
    } finally {
      workspace.dispose();
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it('rejects desk-window entry when the compositor cannot blend camera passthrough', async () => {
    const session = { environmentBlendMode: 'additive', end: vi.fn(async () => undefined) };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    try {
      await expect(workspace.enterXR('desk')).rejects.toThrow('alpha-blended passthrough');
      expect(session.end).toHaveBeenCalledOnce();
      expect(workspace.state.xrMode).toBe('desktop');
      expect(workspace.scene.getObjectByName('desk-window')).toBeUndefined();
    } finally {
      workspace.dispose();
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it('previews both axes for the aimed pane without broadcasts and saves both with A', () => {
    const { workspace, container } = fixture();
    const controller = fakeXR.controllers[1] as THREE.Group;
    const gamepad = connectController(1, [0, 0, 0, 0], 'right');
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Pane B screen missing');
    workspace.selectTerminal('pane-a');
    aimController(controller, screen);
    selectRadialAction(workspace, gamepad, 'warp', 7000);
    expect(workspace.state.warpTerminalId).toBe('pane-b');
    expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeUndefined();
    expect(workspace.scene.getObjectByName('xr-warp-readout')).toBeDefined();
    const readout = workspace.scene.getObjectByName('xr-warp-readout');
    expect(readout?.userData.labelText).toContain('Opacity 100%');
    const originalStorage = localStorage.getItem('mux-xr:terminal-warp:v1');
    const changed = vi.fn();
    const stop = workspace.subscribe(changed);
    (gamepad.axes as number[])[2] = 1;
    (gamepad.axes as number[])[3] = 1;
    fakeXR.frame?.(8200);
    const preview = workspace.getTerminalCurvature('pane-b');
    expect(preview).toBeGreaterThan(0);
    const opacity = workspace.getTerminalOpacity('pane-b');
    expect(opacity).toBeLessThan(1);
    expect(workspace.getTerminalOpacity('pane-a')).toBe(1);
    expect(readout?.userData.labelText).toContain(`Opacity ${Math.round(opacity * 100)}%`);
    (gamepad.axes as number[])[2] = 0;
    (gamepad.axes as number[])[3] = -0.5;
    fakeXR.frame?.(8216);
    const savedOpacity = workspace.getTerminalOpacity('pane-b');
    expect(savedOpacity).toBeGreaterThan(opacity);
    expect(workspace.getTerminalCurvature('pane-b')).toBe(preview);
    expect(localStorage.getItem('mux-xr:terminal-warp:v1')).toBe(originalStorage);
    expect(changed).not.toHaveBeenCalled();
    (gamepad.axes as number[])[2] = 0;
    (gamepad.axes as number[])[3] = 0;
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(8300);
    fakeXR.frame?.(8400);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(8416);
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(workspace.state.radialOpen).toBe(false);
    expect(workspace.getTerminalCurvature('pane-b')).toBe(preview);
    expect(workspace.getTerminalOpacity('pane-b')).toBe(savedOpacity);
    const saved = JSON.parse(localStorage.getItem('mux-xr:terminal-warp:v1') ?? '{}');
    expect(Object.values(saved.values)).toEqual([preview]);
    expect(Object.values(saved.opacity)).toEqual([savedOpacity]);
    stop();
    workspace.dispose();
    container.remove();
  });

  it('blocks actual mouse, stick scroll and enabled gaze routing during Warp, then B cancels without Focus', () => {
    const { workspace, actions, container } = fixture();
    actions.scrollTerminal = vi.fn(() => true);
    const controller = fakeXR.controllers[1] as THREE.Group;
    const gamepad = connectController(1, [0, 0, 0, 1], 'right');
    const a = workspace.scene
      .getObjectByName('terminal-panel-pane-a')
      ?.getObjectByName('terminal-surface');
    const b = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface');
    if (!a || !b) throw new Error('Screens missing');
    aimController(controller, a);
    fakeXR.frame?.(8000);
    expect(actions.scrollTerminal).toHaveBeenCalled();
    actions.scrollTerminal = vi.fn(() => true);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(actions.sendMouse).toHaveBeenCalled();
    vi.mocked(actions.sendMouse)?.mockClear();
    workspace.setTerminalCurvature('pane-a', 30);
    workspace.setTerminalOpacity('pane-a', 0.65);
    const saved = localStorage.getItem('mux-xr:terminal-warp:v1');
    workspace.setGazeInputEnabled(true);
    workspace.camera.lookAt(b.getWorldPosition(new THREE.Vector3()));
    selectRadialAction(workspace, gamepad, 'warp', 9000);
    (gamepad.axes as number[])[2] = 1;
    fakeXR.frame?.(10200);
    fakeXR.frame?.(10600);
    aimController(controller, a);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(workspace.getTerminalCurvature('pane-a')).toBeGreaterThan(30);
    expect(workspace.getTerminalOpacity('pane-a')).toBeLessThan(0.65);
    expect(actions.scrollTerminal).not.toHaveBeenCalled();
    expect(workspace.state.gazeInputEnabled).toBe(true);
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    expect(actions.sendMouse).not.toHaveBeenCalled();
    (gamepad.axes as number[])[2] = 0;
    (gamepad.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(10700);
    (gamepad.buttons[5] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(10716);
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(workspace.state.focusModeTerminalId).toBeNull();
    expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
    expect(workspace.getTerminalOpacity('pane-a')).toBe(0.65);
    expect(localStorage.getItem('mux-xr:terminal-warp:v1')).toBe(saved);
    workspace.dispose();
    container.remove();
  });

  it.each(['disconnect', 'remove', 'reset', 'dispose'] as const)(
    'cancels an unsaved Warp on %s',
    (reason) => {
      const { workspace, container } = fixture();
      const pad = connectController(1, [0, 0, 0, 0], 'right');
      selectRadialAction(workspace, pad, 'warp', 0);
      const saved = localStorage.getItem('mux-xr:terminal-warp:v1');
      (pad.axes as number[])[2] = 1;
      fakeXR.frame?.(1200);
      expect(workspace.getTerminalCurvature('pane-a')).toBeGreaterThan(0);
      if (reason === 'disconnect')
        (fakeXR.controllers[1] as THREE.Group).dispatchEvent({ type: 'disconnected' } as never);
      else if (reason === 'remove') workspace.removeTerminal('pane-a');
      else if (reason === 'reset') workspace.resetLayout();
      else workspace.dispose();
      expect(workspace.state.warpTerminalId).toBeNull();
      expect(localStorage.getItem('mux-xr:terminal-warp:v1')).toBe(saved);
      expect(workspace.scene.getObjectByName('xr-warp-readout')).toBeUndefined();
      workspace.dispose();
      container.remove();
    },
  );

  it('remembers terminal scale and captures original placement during transient focus', () => {
    const { workspace, container } = fixture();
    workspace.selectTerminal('pane-a');
    const pose = {
      position: [0.4, -0.1, -1.5] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: 0.8,
    };
    workspace.restoreTerminalPose('pane-a', pose);
    workspace.scaleSelectedPanel(-1);
    expect(workspace.captureTerminalPose('pane-a')?.scale).toBeCloseTo(0.7);
    const saved = workspace.captureTerminalPose('pane-a');
    workspace.toggleFocusMode('pane-a');
    fakeXR.frame?.(0);
    fakeXR.frame?.(300);
    const title = objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-a' });
    aimController(fakeXR.controllers[0] as THREE.Group, title);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.1;
    fakeXR.frame?.(400);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    expect(workspace.captureTerminalPose('pane-a')?.position).toEqual(saved?.position);
    workspace.dispose();
    container.remove();
  });

  it('restores glass opacity without resizing or rebuilding for every slider value', () => {
    const { workspace, left, container } = fixture();
    workspace.setTerminalOpacity('pane-a', 0.4);
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-a')
      ?.getObjectByName('terminal-surface') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const version = screen.material.version;
    workspace.setTerminalOpacity('pane-a', 0.5);
    expect(screen.material.version).toBe(version);
    expect(screen.material.userData.terminalBackgroundOpacity.value).toBe(0.5);
    expect(left.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
    const second = fixture();
    expect(second.workspace.getTerminalOpacity('pane-a')).toBe(0.5);
    second.workspace.dispose();
    second.container.remove();
  });

  it('fades the frame between the outline and the text with the glass opacity', () => {
    const { workspace, container } = fixture();
    const frame = workspace.scene
      .getObjectByName('terminal-panel-pane-a')
      ?.getObjectByName('terminal-frame') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(frame.material.transparent).toBe(false);
    expect(frame.material.depthWrite).toBe(true);
    const opaqueVersion = frame.material.version;
    workspace.setTerminalOpacity('pane-a', 0.3);
    expect(frame.material.version).toBeGreaterThan(opaqueVersion);
    expect(frame.material.opacity).toBeCloseTo(0.3);
    expect(frame.material.transparent).toBe(true);
    expect(frame.material.depthWrite).toBe(false);
    const version = frame.material.version;
    workspace.setTerminalOpacity('pane-a', 0.4);
    expect(frame.material.opacity).toBeCloseTo(0.4);
    expect(frame.material.version).toBe(version);
    workspace.setTerminalOpacity('pane-a', 1);
    expect(frame.material.opacity).toBe(1);
    expect(frame.material.transparent).toBe(false);
    expect(frame.material.depthWrite).toBe(true);
    workspace.dispose();
    container.remove();
  });

  it('moves an entire layout without changing its geometry, input or grids', () => {
    const { workspace, actions, container } = fixture();
    workspace.arrangeTerminals('sphere');
    const a = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const b = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!a || !b) throw new Error('Missing terminals');
    const before = [a, b].map((root) => ({
      position: root.position.clone(),
      quaternion: root.quaternion.clone(),
      scale: root.scale.clone(),
    }));
    const selected = workspace.state.selectedTerminalId;
    workspace.moveLayoutDepth(-1);
    const da = a.position.clone().sub(before[0].position);
    const db = b.position.clone().sub(before[1].position);
    expect(da.length()).toBeCloseTo(0.4);
    expect(da.distanceTo(db)).toBeLessThan(1e-6);
    for (const [index, root] of [a, b].entries()) {
      expect(root.quaternion.angleTo(before[index].quaternion)).toBeLessThan(1e-6);
      expect(root.scale).toEqual(before[index].scale);
    }
    expect(workspace.state.selectedTerminalId).toBe(selected);
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    workspace.moveLayoutDepth(1);
    expect(a.position.distanceTo(before[0].position)).toBeLessThan(1e-6);
    workspace.dispose();
    container.remove();
  });

  it('bounds whole-layout movement before panels reach the viewer', () => {
    const { workspace, container } = fixture();
    workspace.arrangeTerminals('sphere');
    for (let step = 0; step < 30; step += 1) workspace.moveLayoutDepth(-1);
    workspace.scene.updateMatrixWorld(true);
    for (const root of workspace.scene.children.filter((object) =>
      object.name.startsWith('terminal-panel-'),
    )) {
      const bounds = new THREE.Box3().setFromObject(root);
      expect(bounds.max.z).toBeLessThanOrEqual(workspace.camera.position.z - 0.8 + 1e-6);
    }
    workspace.dispose();
    container.remove();
  });

  it('restores modifier state when a desktop pointer press is canceled', () => {
    fakeXR.presenting = false;
    const { workspace, actions, container } = fixture();
    vi.spyOn(workspace.canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1024,
      height: 768,
      right: 1024,
      bottom: 768,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    workspace.canvas.setPointerCapture = vi.fn();
    fakeXR.presenting = true;
    workspace.showInput('keyboard');
    fakeXR.presenting = false;
    const control = workspace
      .getControlHints()
      .find((hint) => hint.key === 'Control' && hint.inputAction === 'key');
    const tab = workspace
      .getControlHints()
      .find((hint) => hint.key === 'Tab' && hint.inputAction === 'key');
    if (!control || !tab) throw new Error('Keyboard pointer targets missing');
    workspace.canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 3,
        clientX: control.clientX,
        clientY: control.clientY,
      }),
    );
    workspace.canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 3 }));
    workspace.canvas.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 3, clientX: tab.clientX, clientY: tab.clientY }),
    );
    expect(actions.sendKey).toHaveBeenLastCalledWith('Tab', undefined);
    workspace.dispose();
    container.remove();
  });

  it('does not resurrect keyboard locks after changing panes while the keyboard is hidden', () => {
    const { workspace, actions, container } = fixture();
    const gamepad = connectController(1, [0, 0, 0, 0], 'right');
    selectKeyboardViaRadial(workspace, gamepad, 0);
    hit(workspace, { inputAction: 'key', key: 'Shift' });
    fakeXR.frame?.(1200);
    fakeXR.frame?.(1800);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(1820);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(1836);
    fakeXR.frame?.(2720);
    hit(workspace, { inputAction: 'radialAction', radialAction: 'keyboard' });
    fakeXR.frame?.(2920);
    workspace.selectTerminal('pane-b');
    workspace.selectTerminal('pane-a');
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(3000);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(3016);
    fakeXR.frame?.(3900);
    hit(workspace, { inputAction: 'radialAction', radialAction: 'keyboard' });
    fakeXR.frame?.(4100);
    hit(workspace, { inputAction: 'key', key: 'c' });
    expect(actions.sendKey).toHaveBeenLastCalledWith('c', undefined);
    workspace.dispose();
    container.remove();
  });

  it('assigns focus mode to the right-handed controller regardless of connection slot', () => {
    const { workspace, container } = fixture();
    const right = connectController(1, [0, 0, 0, 0], 'right');
    connectController(0, [0, 0, 0, 0], 'left');
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Pane B screen missing');
    aimControllerAtScreen(fakeXR.controllers[1] as THREE.Group, screen, new THREE.Vector3());
    pressFocusButton(right, 100);
    expect(workspace.state.focusModeTerminalId).toBe('pane-b');
    workspace.dispose();
    container.remove();
  });

  it('reports terminal focus without moving DOM focus while presenting XR', () => {
    const { workspace, left, right, container } = fixture();
    left.focus = vi.fn();
    right.focus = vi.fn();
    workspace.selectTerminal('pane-b');
    expect(right.focus).toHaveBeenLastCalledWith(true, false);
    expect(left.focus).toHaveBeenLastCalledWith(false, false);
    fakeXR.presenting = false;
    fakeXR.frame?.(20);
    workspace.selectTerminal('pane-a');
    expect(left.focus).toHaveBeenLastCalledWith(true, true);
    expect(right.focus).toHaveBeenLastCalledWith(false, true);
    workspace.dispose();
    container.remove();
  });

  it('promotes the head-gazed far pane without changing manual input focus', () => {
    const { workspace, actions, left, right, container } = fixture();
    left.setRenderQuality = vi.fn();
    right.setRenderQuality = vi.fn();
    workspace.camera.position.set(0, 1.6, 0);
    workspace.camera.rotation.set(0, 0, 0);
    const a = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const b = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!a || !b) throw new Error('Terminal roots missing');
    a.position.set(-6, 1.6, -10);
    b.position.set(6, 1.6, -10);
    workspace.setGazeInputEnabled(false);
    workspace.selectTerminal('pane-a');
    for (let frame = 0; frame < 20; frame += 1) fakeXR.frame?.(frame * 20);
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('low');
    workspace.camera.lookAt(b.position);
    fakeXR.frame?.(420);
    expect(workspace.state.renderGazeTerminalId).toBe('pane-b');
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('low');
    fakeXR.frame?.(800);
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('full');
    expect(workspace.state.renderGazeTerminalId).toBe('pane-b');
    // A brief glance away keeps the promoted pane full instead of resizing it again.
    workspace.camera.lookAt(a.position);
    for (let time = 820; time <= 2000; time += 20) fakeXR.frame?.(time);
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('full');
    for (let time = 2020; time <= 3200; time += 20) fakeXR.frame?.(time);
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('low');
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    expect(workspace.state.gazeInputEnabled).toBe(false);
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('does not promote a far pane that a fast head sweep crosses', () => {
    const { workspace, right, container } = fixture();
    right.setRenderQuality = vi.fn();
    workspace.camera.position.set(0, 1.6, 0);
    workspace.camera.rotation.set(0, 0, 0);
    const a = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const b = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!a || !b) throw new Error('Terminal roots missing');
    a.position.set(-6, 1.6, -10);
    b.position.set(6, 1.6, -10);
    workspace.setGazeInputEnabled(false);
    workspace.selectTerminal('pane-a');
    for (let frame = 0; frame < 20; frame += 1) fakeXR.frame?.(frame * 20);
    right.setRenderQuality = vi.fn();
    workspace.camera.lookAt(b.position);
    for (let time = 400; time <= 700; time += 20) fakeXR.frame?.(time);
    expect(workspace.state.renderGazeTerminalId).toBe('pane-b');
    workspace.camera.lookAt(a.position);
    for (let time = 720; time <= 1500; time += 20) fakeXR.frame?.(time);
    expect(right.setRenderQuality).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('suspends hidden focus-mode panes and restores full raster quality outside XR', () => {
    const { workspace, right, container } = fixture();
    right.setRenderQuality = vi.fn();
    workspace.toggleFocusMode('pane-a');
    fakeXR.frame?.(0);
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('hidden');
    fakeXR.presenting = false;
    fakeXR.frame?.(20);
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('full');
    expect(workspace.state.renderGazeTerminalId).toBeNull();
    workspace.dispose();
    container.remove();
  });

  it('uses a B-button edge, ignores grip-suppressed presses, and exits without an aim hit', () => {
    const { workspace, container } = fixture();
    const gamepad = connectController(0);
    const controller = fakeXR.controllers[0] as THREE.Group;
    const screen = workspace.scene.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal screen missing');
    aimControllerAtScreen(controller, screen, new THREE.Vector3());
    (gamepad.buttons[1] as { pressed: boolean }).pressed = true;
    (gamepad.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(100);
    expect(workspace.state.focusModeTerminalId).toBeNull();
    (gamepad.buttons[1] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(116);
    expect(workspace.state.focusModeTerminalId).toBeNull();
    (gamepad.buttons[5] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(132);
    (gamepad.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(148);
    expect(workspace.state.focusModeTerminalId).toBe('pane-a');
    fakeXR.frame?.(164);
    expect(workspace.state.focusModeTerminalId).toBe('pane-a');
    controller.position.set(100, 100, 100);
    (gamepad.buttons[5] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(180);
    (gamepad.buttons[5] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(196);
    expect(workspace.state.focusModeTerminalId).toBeNull();
    workspace.dispose();
    container.remove();
  });

  it('preserves keyboard targeting while hiding other roots from input and gaze', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    expect(keyboard).toBeDefined();
    const gamepad = connectController(0);
    workspace.toggleFocusMode('pane-a');
    expect(workspace.state.focusModeTerminalId).toBe('pane-a');
    expect(workspace.state.inputTargetId).toBe('pane-a');
    expect(keyboard?.visible).toBe(true);
    const hiddenRoot = workspace.scene.getObjectByName('terminal-panel-pane-b');
    expect(hiddenRoot?.userData.focusHidden).toBe(true);
    for (let frame = 0; frame < 20; frame += 1) fakeXR.frame?.(frame * 20);
    expect(hiddenRoot?.visible).toBe(false);
    workspace.toggleFocusMode();
    expect(workspace.state.focusModeTerminalId).toBeNull();
    expect(hiddenRoot?.visible).toBe(true);
    for (let frame = 20; frame < 40; frame += 1) fakeXR.frame?.(frame * 20);
    expect(hiddenRoot?.userData.focusHidden).toBeFalsy();
    expect(gamepad.buttons[5]?.pressed).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('brings a far pane level in front of the viewer at the focus distance and saves it', () => {
    const { workspace, container } = fixture();
    workspace.camera.position.set(1, 1.6, 0.5);
    workspace.camera.rotation.set(-0.3, 0.4, 0, 'YXZ');
    workspace.camera.updateMatrixWorld(true);
    const root = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
    root.position.set(4, 2.5, -6);
    root.rotation.set(0, -0.8, 0.2);
    workspace.scene.updateMatrixWorld(true);
    const revision = workspace.state.layoutRevision;
    hit(workspace, { inputAction: 'bringHere', terminalId: 'pane-b' });
    const eye = workspace.camera.getWorldPosition(new THREE.Vector3());
    const position = root.getWorldPosition(new THREE.Vector3());
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(
      root.getWorldQuaternion(new THREE.Quaternion()),
    );
    const toEye = eye.clone().sub(position).setY(0);
    expect(Math.abs(toEye.length() - workspace.state.windowPreferences.focusDistance)).toBeLessThan(
      0.1,
    );
    expect(Math.abs(front.y)).toBeLessThan(1e-6);
    expect(front.dot(toEye.normalize())).toBeGreaterThan(0.999);
    expect(workspace.state.focusModeTerminalId).toBeNull();
    expect(workspace.state.selectedTerminalId).toBe('pane-b');
    expect(workspace.state.layoutRevision).toBeGreaterThan(revision);
    const saved = workspace.captureTerminalPose('pane-b');
    for (let frame = 0; frame < 10; frame += 1) fakeXR.frame?.(frame * 20);
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(position)).toBeLessThan(1e-6);
    expect(workspace.captureTerminalPose('pane-b')).toEqual(saved);
    workspace.dispose();
    container.remove();
  });

  it('keeps Bring here at the left edge of a wide pane and left of Close', () => {
    const { workspace, container } = fixture();
    const wide = surface(pane('pane-w', 'W'));
    (wide as { cols: number }).cols = 160;
    workspace.addTerminal(wide);
    const root = workspace.scene.getObjectByName('terminal-panel-pane-w') as THREE.Group;
    const bring = objectWithData(workspace, { inputAction: 'bringHere', terminalId: 'pane-w' });
    const close = objectWithData(workspace, { inputAction: 'closePane', terminalId: 'pane-w' });
    const width = (1.42 * 160) / 80;
    expect(bring.position.x).toBeCloseTo(-width / 2 + 0.18, 5);
    expect(bring.position.x + 0.18).toBeLessThan(close.position.x - 0.19);
    expect(root.children).toContain(bring);
    workspace.dispose();
    container.remove();
  });

  it('keeps the focused placement with Keep here instead of restoring the original pose', () => {
    const { workspace, container } = fixture();
    const root = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
    const original = root.position.clone();
    const originalPose = workspace.captureTerminalPose('pane-b');
    workspace.toggleFocusMode('pane-b');
    for (let frame = 0; frame < 20; frame += 1) fakeXR.frame?.(frame * 20);
    const focused = root.position.clone();
    expect(focused.distanceTo(original)).toBeGreaterThan(0.1);
    const revision = workspace.state.layoutRevision;
    hit(workspace, { inputAction: 'keepHere', terminalId: 'pane-b' });
    expect(workspace.state.focusModeTerminalId).toBeNull();
    for (let frame = 20; frame < 40; frame += 1) fakeXR.frame?.(frame * 20);
    expect(root.position.distanceTo(focused)).toBeLessThan(0.01);
    expect(workspace.state.layoutRevision).toBeGreaterThan(revision);
    expect(workspace.captureTerminalPose('pane-b')?.position).not.toEqual(originalPose?.position);
    expect(
      objectWithData(workspace, { inputAction: 'bringHere', terminalId: 'pane-b' }),
    ).toBeDefined();
    const other = workspace.scene.getObjectByName('terminal-panel-pane-a');
    expect(other?.visible).toBe(true);
    expect(other?.userData.focusHidden).toBeFalsy();
    workspace.dispose();
    container.remove();
  });

  it('places focus relative to the viewer once without changing scale or remote grids', () => {
    const { workspace, actions, container } = fixture();
    workspace.camera.position.set(3, 1.8, 2);
    workspace.camera.rotation.set(-0.25, Math.PI / 3, 0, 'YXZ');
    const root = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!root) throw new Error('Pane B root missing');
    root.scale.setScalar(0.6);
    const original = root.position.clone();
    workspace.toggleFocusMode('pane-b');
    for (let frame = 0; frame < 20; frame += 1) fakeXR.frame?.(frame * 20);
    const focused = root.position.clone();
    expect(focused.distanceTo(original)).toBeGreaterThan(1);
    expect(root.scale.x).toBe(0.6);
    expect(
      root
        .getWorldDirection(new THREE.Vector3())
        .dot(workspace.camera.getWorldDirection(new THREE.Vector3()).negate()),
    ).toBeCloseTo(1);
    const local = focused
      .clone()
      .sub(workspace.camera.position)
      .applyQuaternion(workspace.camera.quaternion.clone().invert());
    expect(Math.abs(local.x)).toBeLessThan(0.1);
    expect(Math.abs(local.y)).toBeLessThan(0.1);
    expect(local.z).toBeLessThan(-0.75);
    workspace.camera.position.x += 2;
    workspace.camera.rotation.y += 0.5;
    fakeXR.frame?.(1000);
    expect(root.position).toEqual(focused);
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('uses new-window opacity and curvature without changing open panes or saved overrides', () => {
    const { workspace, container } = fixture();
    workspace.setTerminalOpacity('pane-a', 0.7);
    workspace.setTerminalCurvature('pane-a', 15);
    workspace.setWindowPreferences({
      defaultOpacity: 0.4,
      defaultCurvature: 45,
      focusDistance: 1.5,
      focusCurvature: 0,
      focusWarpMode: 'custom',
      scrollStripSide: 'right',
      frameChin: true,
      buttonMap: DEFAULT_BUTTON_MAP,
    });
    expect(workspace.getTerminalOpacity('pane-a')).toBe(0.7);
    expect(workspace.getTerminalOpacity('pane-b')).toBe(1);
    workspace.addTerminal(surface(pane('pane-c')));
    expect(workspace.getTerminalOpacity('pane-c')).toBe(0.4);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(15);
    expect(workspace.getTerminalCurvature('pane-b')).toBe(0);
    expect(workspace.getTerminalCurvature('pane-c')).toBe(45);
    workspace.removeTerminal('pane-a');
    workspace.addTerminal(surface(pane('pane-a')));
    expect(workspace.getTerminalOpacity('pane-a')).toBe(0.7);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(15);
    workspace.dispose();
    container.remove();
  });

  describe('resetting a pane to the new-window defaults', () => {
    const prefs = (defaultOpacity: number, defaultCurvature: number, focusCurvature = 0) => ({
      defaultOpacity,
      defaultCurvature,
      focusDistance: 1.5,
      focusCurvature,
      focusWarpMode: 'custom' as const,
      scrollStripSide: 'right' as const,
      frameChin: true,
      buttonMap: DEFAULT_BUTTON_MAP,
    });
    const customize = (workspace: ReturnType<typeof createWorkspaceScene>): void => {
      workspace.setTerminalOpacity('pane-a', 0.3);
      workspace.setTerminalCurvature('pane-a', 70);
    };
    const pressReset = (workspace: ReturnType<typeof createWorkspaceScene>): void => {
      workspace.selectTerminal('pane-a');
      workspace.showInput('terminal');
      hit(workspace, { inputAction: 'resetTerminalAppearance' });
    };

    it('resets saved opacity 0.3 and curvature 70 to defaults 0.6 and 30 from the XR button', () => {
      localStorage.clear();
      const { workspace, container } = fixture();
      workspace.setWindowPreferences(prefs(0.6, 30));
      customize(workspace);
      pressReset(workspace);
      expect(workspace.getTerminalOpacity('pane-a')).toBe(0.6);
      expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
      const label = workspace.scene
        .getObjectByName('xr-terminal-controls')
        ?.children.find((child) => String(child.userData.labelText).startsWith('Glass opacity'));
      expect(label?.userData.labelText).toBe('Glass opacity: 60%');
      workspace.dispose();
      container.remove();
    });

    it('follows changed defaults after a reset and a pane reopen', () => {
      localStorage.clear();
      const { workspace, container } = fixture();
      workspace.setWindowPreferences(prefs(0.6, 30));
      customize(workspace);
      pressReset(workspace);
      workspace.setWindowPreferences(prefs(0.45, 55));
      workspace.removeTerminal('pane-a');
      workspace.addTerminal(surface(pane('pane-a')));
      expect(workspace.getTerminalOpacity('pane-a')).toBe(0.45);
      expect(workspace.getTerminalCurvature('pane-a')).toBe(55);
      workspace.dispose();
      container.remove();
    });

    it('resets during Focus mode without corrupting the restore', () => {
      localStorage.clear();
      const { workspace, container } = fixture();
      workspace.setWindowPreferences(prefs(0.6, 30, 40));
      customize(workspace);
      const root = workspace.scene.getObjectByName('terminal-panel-pane-a');
      if (!root) throw new Error('Pane A root missing');
      workspace.toggleFocusMode('pane-a');
      expect(root.userData.curvatureDegrees).toBe(40);
      pressReset(workspace);
      expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
      expect(workspace.getTerminalOpacity('pane-a')).toBe(0.6);
      expect(root.userData.curvatureDegrees).toBe(40);
      expect(workspace.state.focusModeTerminalId).toBe('pane-a');
      workspace.toggleFocusMode();
      expect(root.userData.curvatureDegrees).toBe(30);
      workspace.setWindowPreferences(prefs(0.5, 10));
      workspace.removeTerminal('pane-a');
      workspace.addTerminal(surface(pane('pane-a')));
      expect(workspace.getTerminalCurvature('pane-a')).toBe(10);
      workspace.dispose();
      container.remove();
    });

    it('reset or opacity changes on a faded pane survive the Focus fade restore', () => {
      localStorage.clear();
      const { workspace, container } = fixture();
      workspace.setWindowPreferences(prefs(0.6, 30));
      workspace.setTerminalOpacity('pane-b', 0.3);
      const root = workspace.scene.getObjectByName('terminal-panel-pane-b');
      if (!root) throw new Error('Pane B root missing');
      const opacities = (): number[] => {
        const values: number[] = [];
        root.traverse((object) => {
          const material = (object as THREE.Mesh).material as THREE.Material | undefined;
          if (material && 'opacity' in material) values.push(material.opacity);
        });
        return values;
      };
      expect(opacities()).toContain(0.3);
      workspace.toggleFocusMode('pane-a');
      workspace.resetTerminalAppearance('pane-b');
      workspace.setTerminalOpacity('pane-a', 0.8);
      workspace.removeTerminal('pane-a');
      expect(workspace.getTerminalOpacity('pane-b')).toBe(0.6);
      expect(opacities()).toContain(0.6);
      expect(opacities()).not.toContain(0.3);
      workspace.dispose();
      container.remove();
    });

    it('keeps Close and Back at the original height when no pane is selected', () => {
      const { workspace, container } = fixture();
      workspace.removeTerminal('pane-a');
      workspace.removeTerminal('pane-b');
      workspace.showInput('terminal');
      const root = workspace.scene.getObjectByName('xr-terminal-controls');
      const close = root?.children.find((child) => child.userData.labelText === 'Close');
      expect(close?.position.y).toBe(-0.66);
      expect(
        root?.children.some((child) => child.userData.inputAction === 'resetTerminalAppearance'),
      ).toBe(false);
      workspace.dispose();
      container.remove();
    });

    it('keeps Reset clear of every other control on the Selected terminal page', () => {
      const { workspace, container } = fixture();
      workspace.selectTerminal('pane-a');
      workspace.showInput('terminal');
      const root = workspace.scene.getObjectByName('xr-terminal-controls');
      if (!root) throw new Error('Terminal page missing');
      root.updateMatrixWorld(true);
      const boxes = new Map<THREE.Object3D, THREE.Box3>();
      root.traverse((object) => {
        if (!object.userData.labelWidth) return;
        const center = root.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
        const width = object.userData.labelWidth as number;
        const height = object.userData.labelHeight as number;
        boxes.set(
          object,
          new THREE.Box3(
            new THREE.Vector3(center.x - width / 2, center.y - height / 2, -1),
            new THREE.Vector3(center.x + width / 2, center.y + height / 2, 1),
          ),
        );
      });
      const entries = [...boxes.entries()];
      const reset = entries.find(([o]) => o.userData.inputAction === 'resetTerminalAppearance');
      if (!reset) throw new Error('Reset button missing');
      for (const label of ['Back', 'Close', 'Glass opacity: 100%'])
        expect(
          entries.some(([o]) => String(o.userData.labelText).startsWith(label)),
          label,
        ).toBe(true);
      for (let a = 0; a < entries.length; a += 1)
        for (const [other, box] of entries.slice(a + 1))
          expect(
            entries[a][1].intersectsBox(box),
            `${entries[a][0].userData.labelText} overlaps ${other.userData.labelText}`,
          ).toBe(false);
      workspace.dispose();
      container.remove();
    });
  });

  describe('opening an unattached pane uses the new-window defaults', () => {
    const prefs = {
      defaultOpacity: 0.5,
      defaultCurvature: 40,
      focusDistance: 1.5,
      focusCurvature: 0,
      focusWarpMode: 'custom' as const,
      scrollStripSide: 'right' as const,
      frameChin: true,
      buttonMap: DEFAULT_BUTTON_MAP,
    };
    const setup = () => {
      localStorage.clear();
      const ctx = fixture();
      const { workspace, actions } = ctx;
      const target = pane('pane-c', 'C');
      workspace.setAvailablePanes([pane('pane-a', 'A'), pane('pane-b', 'B'), target]);
      workspace.setWindowPreferences(prefs);
      vi.mocked(actions.selectPane).mockImplementation((id: string) => {
        if (id === 'pane-c') workspace.addTerminal(surface(target));
      });
      return ctx;
    };
    const expectDefaults = (workspace: ReturnType<typeof createWorkspaceScene>): void => {
      expect(workspace.getTerminalOpacity('pane-c')).toBe(0.5);
      expect(workspace.getTerminalCurvature('pane-c')).toBe(40);
    };

    it('via an agent board row', () => {
      const { workspace, container } = setup();
      workspace.setAgentRoster([
        {
          paneId: 'pane-c',
          agent: 'claude',
          state: 'working',
          reason: '',
          workspace: '+1',
          project: '',
          paneLabel: '',
          source: 'hook',
          stalled: false,
          lastActivityAt: Date.now(),
          lastReportAt: 0,
          lastInputAt: 0,
          lastViewedAt: 0,
          viewerCount: 0,
          cpuMs: 0,
          workspaceName: 'Main',
          title: 'Shell C',
          sessionName: 'S',
          windowName: 'W',
        },
      ] as never);
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'agent-board' });
      hit(workspace, { inputAction: 'selectAgentPane', agentPaneId: 'pane-c' });
      expectDefaults(workspace);
      workspace.dispose();
      container.remove();
    });

    it('via the Panes navigator', () => {
      const { workspace, container } = setup();
      workspace.showInput('panes');
      for (const title of ['Workspace', 'Session', 'Window']) {
        hit(workspace, { inputAction: 'hierarchyNode', originalTitle: title });
        for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(100 + frame * 16);
      }
      hit(workspace, { inputAction: 'pane', paneId: 'pane-c' });
      expectDefaults(workspace);
      workspace.dispose();
      container.remove();
    });
  });

  it('applies focus distance and temporary warp and restores the saved pane geometry and pose', () => {
    const { workspace, actions, container } = fixture();
    const root = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
    workspace.setTerminalCurvature('pane-a', 65);
    const original = {
      position: root.position.clone(),
      quaternion: root.quaternion.clone(),
      scale: root.scale.clone(),
    };
    const stored = localStorage.getItem('mux-xr:terminal-warp:v1');
    workspace.toggleFocusMode('pane-a');
    for (let frame = 0; frame < 20; frame++) fakeXR.frame?.(frame * 20);
    expect(root.userData.curvatureDegrees).toBe(0);
    const checkDistance = (distance: number): void => {
      const center = root.localToWorld(measurePanelBounds(root).center);
      const target = workspace.camera
        .getWorldPosition(new THREE.Vector3())
        .addScaledVector(workspace.camera.getWorldDirection(new THREE.Vector3()), distance);
      expect(center.distanceTo(target)).toBeLessThan(1e-5);
    };
    checkDistance(1.5);
    workspace.setWindowPreferences({
      ...workspace.state.windowPreferences,
      focusDistance: 2.2,
      focusCurvature: 40,
    });
    for (let frame = 20; frame < 40; frame++) fakeXR.frame?.(frame * 20);
    checkDistance(2.2);
    expect(root.userData.curvatureDegrees).toBe(40);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(65);
    workspace.showInput('display');
    hit(workspace, { inputAction: 'focusWarpMode' });
    expect(workspace.state.windowPreferences.focusWarpMode).toBe('inherit');
    expect(root.userData.curvatureDegrees).toBe(65);
    expect(localStorage.getItem('mux-xr:terminal-warp:v1')).toBe(stored);
    workspace.setTerminalCurvature('pane-a', 180);
    expect(root.userData.curvatureDegrees).toBe(180);
    const inheritedWarp = localStorage.getItem('mux-xr:terminal-warp:v1');
    hit(workspace, { inputAction: 'focusWarpMode' });
    expect(workspace.state.windowPreferences.focusWarpMode).toBe('custom');
    expect(root.userData.curvatureDegrees).toBe(40);
    expect(localStorage.getItem('mux-xr:terminal-warp:v1')).toBe(inheritedWarp);
    workspace.toggleFocusMode();
    expect(root.userData.curvatureDegrees).toBe(180);
    expect(root.position.distanceTo(original.position)).toBeLessThan(1e-6);
    expect(root.quaternion.angleTo(original.quaternion)).toBeLessThan(1e-6);
    expect(root.scale).toEqual(original.scale);
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('restores the exact pane transform after focus manipulation and target removal', () => {
    const { workspace, container } = fixture();
    const root = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!root) throw new Error('Pane A root missing');
    const position = root.position.clone();
    const quaternion = root.quaternion.clone();
    const scale = root.scale.clone();
    workspace.toggleFocusMode('pane-a');
    root.position.x += 0.4;
    root.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3),
    );
    root.scale.multiplyScalar(1.3);
    workspace.toggleFocusMode();
    expect(root.position.distanceTo(position)).toBeLessThan(1e-6);
    expect(root.quaternion.angleTo(quaternion)).toBeLessThan(1e-6);
    expect(root.scale.distanceTo(scale)).toBeLessThan(1e-6);
    workspace.toggleFocusMode('pane-a');
    workspace.removeTerminal('pane-a');
    expect(workspace.state.focusModeTerminalId).toBeNull();
    expect(workspace.scene.getObjectByName('terminal-panel-pane-b')?.visible).toBe(true);
    workspace.dispose();
    container.remove();
  });

  it('recovers all roots when XR presentation ends', async () => {
    const endListeners: Array<() => void> = [];
    const session = {
      addEventListener: (_type: string, listener: () => void) => endListeners.push(listener),
      end: vi.fn(async () => {
        endListeners.forEach((listener) => {
          listener();
        });
      }),
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    await workspace.enterXR('vr');
    workspace.toggleFocusMode('pane-a');
    await workspace.exitXR();
    expect(workspace.state.focusModeTerminalId).toBeNull();
    expect(workspace.scene.getObjectByName('terminal-panel-pane-b')?.visible).toBe(true);
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });
});

describe('terminal pose persistence across reloads', () => {
  const untracked = { getViewerPose: () => null };
  const startSession = () => {
    const listeners: Array<() => void> = [];
    const session = {
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      end: vi.fn(async () => {
        fakeXR.presenting = false;
        for (const listener of listeners) listener();
      }),
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
  };
  const trackedHead = (head: THREE.PerspectiveCamera): void => {
    head.position.set(0.3, 1.65, 0.2);
    head.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6);
  };

  afterEach(() => {
    fakeXR.presenting = false;
    vi.unstubAllGlobals();
  });

  it('keeps panes where they were in the room whatever the head pose at reload', async () => {
    const head = new THREE.PerspectiveCamera();
    const original = {
      position: [0.2, 1.47, -1.4] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: 1,
    };
    let saved = original;
    for (const [reload, yaw] of [0, Math.PI / 6, -Math.PI / 4].entries()) {
      fakeXR.presenting = false;
      startSession();
      const { workspace, container } = fixture();
      head.position.set(0, 0, 0);
      head.quaternion.identity();
      fakeXR.camera = head;
      await workspace.enterXR('vr');
      fakeXR.presenting = true;
      fakeXR.frame?.(1000, untracked);
      workspace.restoreTerminalPose('pane-a', saved);
      fakeXR.frame?.(1016, untracked);
      head.position.set(0.3 - reload * 0.2, 1.65, 0.2);
      head.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(1100 + frame * 16);
      const root = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Object3D;
      root
        .getWorldPosition(new THREE.Vector3())
        .toArray()
        .forEach((value, axis) => {
          expect(value).toBeCloseTo(original.position[axis], 3);
        });
      await workspace.exitXR();
      for (let frame = 0; frame < 3; frame++) fakeXR.frame?.(2000 + frame * 16);
      const next = workspace.captureTerminalPose('pane-a');
      if (!next) throw new Error('Pane A pose missing');
      next.position.forEach((value, axis) => {
        expect(value).toBeCloseTo(original.position[axis], 3);
      });
      saved = next as typeof original;
      workspace.dispose();
      container.remove();
    }
  });

  it('waits for a tracked head before lifting restored panes off the floor', async () => {
    startSession();
    const { workspace, container } = fixture();
    const head = new THREE.PerspectiveCamera();
    fakeXR.camera = head;
    await workspace.enterXR('vr');
    fakeXR.presenting = true;
    fakeXR.frame?.(1000, untracked);
    workspace.restoreTerminalPose('pane-a', {
      position: [0, 0.1, -1.4],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    });
    fakeXR.frame?.(1016, untracked);
    const root = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Object3D;
    expect(root.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0.1, 3);
    trackedHead(head);
    for (let frame = 0; frame < 3; frame++) fakeXR.frame?.(1100 + frame * 16);
    expect(root.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(0.5);
    workspace.dispose();
    container.remove();
  });

  it('keeps XR pane poses when desktop controls recapture after XR ends', async () => {
    startSession();
    const { workspace, container } = fixture();
    const head = new THREE.PerspectiveCamera();
    trackedHead(head);
    fakeXR.camera = head;
    await workspace.enterXR('vr');
    fakeXR.presenting = true;
    fakeXR.frame?.(1000);
    const pose = {
      position: [-0.3, 1.62, -1.6] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: 1,
    };
    workspace.restoreTerminalPose('pane-a', pose);
    fakeXR.frame?.(1016);
    await workspace.exitXR();
    workspace.selectTerminal('pane-a');
    workspace.scaleSelectedPanel(-1);
    for (let frame = 0; frame < 3; frame++) fakeXR.frame?.(2000 + frame * 16);
    const saved = workspace.captureTerminalPose('pane-a');
    if (!saved) throw new Error('Pane A pose missing');
    saved.position.forEach((value, axis) => {
      expect(value).toBeCloseTo(pose.position[axis], 3);
    });
    expect(saved.scale).toBeCloseTo(0.9, 3);
    workspace.dispose();
    container.remove();
  });

  it('lays out desktop Arrange and Reset from the nominal viewer after a turned session', async () => {
    const reference = fixture();
    reference.workspace.arrangeTerminals('row');
    const arranged = reference.workspace.captureTerminalPose('pane-a');
    reference.workspace.resetLayout();
    const reset = reference.workspace.captureTerminalPose('pane-a');
    reference.workspace.dispose();
    reference.container.remove();
    startSession();
    const { workspace, container } = fixture();
    const head = new THREE.PerspectiveCamera();
    trackedHead(head);
    head.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    fakeXR.camera = head;
    await workspace.enterXR('vr');
    fakeXR.presenting = true;
    fakeXR.frame?.(1000);
    await workspace.exitXR();
    workspace.arrangeTerminals('row');
    const turnedArranged = workspace.captureTerminalPose('pane-a');
    workspace.resetLayout();
    const turnedReset = workspace.captureTerminalPose('pane-a');
    if (!arranged || !reset || !turnedArranged || !turnedReset) throw new Error('pose missing');
    turnedArranged.position.forEach((value, axis) => {
      expect(value).toBeCloseTo(arranged.position[axis], 3);
    });
    turnedReset.position.forEach((value, axis) => {
      expect(value).toBeCloseTo(reset.position[axis], 3);
    });
    expect(arranged.position[2]).toBeLessThan(-1.5);
    workspace.dispose();
    container.remove();
  });

  it('saves a desktop clock in front of the nominal viewer', () => {
    localStorage.removeItem('mux-xr:widget-poses:v2');
    const { workspace, container } = fixture();
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    const saved = JSON.parse(localStorage.getItem('mux-xr:widget-poses:v2') ?? '{}').poses?.[
      'digital-clock'
    ];
    expect(saved?.position[0]).toBeCloseTo(-0.45, 3);
    expect(saved?.position[1]).toBeCloseTo(1.82, 3);
    expect(saved?.position[2]).toBeCloseTo(-1.25, 3);
    workspace.dispose();
    container.remove();
    localStorage.removeItem('mux-xr:widget-poses:v2');
  });

  it('places Reset layout from the frame viewer pose, not the render-adjusted camera', async () => {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 5);
    const tracked = {
      getViewerPose: () => ({
        transform: {
          position: { x: 0.3, y: 1.65, z: 0.2, w: 1 },
          orientation: { x: yaw.x, y: yaw.y, z: yaw.z, w: yaw.w },
        },
      }),
    };
    const resetPose = async (cameraZ: number) => {
      startSession();
      const { workspace, container } = fixture();
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0.3, 1.65, cameraZ);
      camera.quaternion.copy(yaw);
      fakeXR.camera = camera;
      await workspace.enterXR('vr');
      fakeXR.presenting = true;
      fakeXR.frame?.(1000, tracked);
      workspace.resetLayout();
      const pose = workspace.captureTerminalPose('pane-a');
      await workspace.exitXR();
      workspace.dispose();
      container.remove();
      fakeXR.presenting = false;
      if (!pose) throw new Error('Pane A pose missing');
      return pose;
    };
    const exact = await resetPose(0.2);
    const adjusted = await resetPose(0.26);
    adjusted.position.forEach((value, axis) => {
      expect(value).toBeCloseTo(exact.position[axis], 3);
    });
  });
  it('brings a pane in front of the frame viewer pose, not the render-adjusted camera', async () => {
    startSession();
    const { workspace, container } = fixture();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-0.6, 1.4, 0.8);
    camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 3);
    fakeXR.camera = camera;
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 5);
    const tracked = {
      getViewerPose: () => ({
        transform: {
          position: { x: 0.3, y: 1.65, z: 0.2, w: 1 },
          orientation: { x: yaw.x, y: yaw.y, z: yaw.z, w: yaw.w },
        },
      }),
    };
    await workspace.enterXR('vr');
    fakeXR.presenting = true;
    fakeXR.frame?.(1000, tracked);
    hit(workspace, { inputAction: 'bringHere', terminalId: 'pane-b' });
    const root = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
    const eye = new THREE.Vector3(0.3, 1.65, 0.2);
    const toEye = eye.sub(root.getWorldPosition(new THREE.Vector3())).setY(0);
    expect(Math.abs(toEye.length() - workspace.state.windowPreferences.focusDistance)).toBeLessThan(
      0.1,
    );
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(
      root.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(front.dot(toEye.normalize())).toBeGreaterThan(0.999);
    await workspace.exitXR();
    workspace.dispose();
    container.remove();
  });
});
