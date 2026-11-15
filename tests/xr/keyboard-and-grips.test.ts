import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@par/xr-workspace', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).withLabelsAndCountingHand(
    await importOriginal<typeof import('@par/xr-workspace')>(),
  ),
);
vi.mock('../../src/xr/repo-status-widget', async (original) =>
  (await import('../helpers/xr-mocks')).withSpiedRepoStatus(
    await original<typeof import('../../src/xr/repo-status-widget')>(),
  ),
);
vi.mock('../../src/xr/kanban-strip', async (original) =>
  (await import('../helpers/xr-mocks')).withSpiedKanbanStrip(
    await original<typeof import('../../src/xr/kanban-strip')>(),
  ),
);
vi.mock('three', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).createThreeMock(
    await importOriginal<typeof import('three')>(),
  ),
);

import * as THREE from 'three';
import type { TerminalSurface } from '../../src/contracts';
import type { createWorkspaceScene } from '../../src/xr/scene';
import {
  aimController,
  connectController,
  fakeXR,
  fixture,
  hit,
  objectWithData,
  resetXRControllers,
  visibleWithData,
} from '../helpers/xr-harness';

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
});
