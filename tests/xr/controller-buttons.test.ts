import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { DEFAULT_BUTTON_MAP } from '../../src/workspace/controller-buttons';
import {
  aimControllerAtScreen,
  connectController,
  fakeXR,
  fixture,
  handPoses,
  hit,
  objectWithData,
  openRadialMenu,
  pane,
  resetXRControllers,
  selectKeyboardViaRadial,
  selectRadialAction,
  surface,
} from '../helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

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
});
