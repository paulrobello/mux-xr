vi.mock('../src/xr/labels', () => import('./helpers/labels'));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeXR = vi.hoisted(() => ({
  controllers: [] as unknown[],
  hands: [] as unknown[],
  presenting: false,
  camera: null as unknown,
  frame: null as ((time: number) => void) | null,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  fakeXR.controllers = [new actual.Group(), new actual.Group()];
  fakeXR.hands = [new actual.Group(), new actual.Group()];
  class FakeRenderer {
    xr = {
      enabled: false,
      get isPresenting() {
        return fakeXR.presenting;
      },
      getController: (index: number) => fakeXR.controllers[index],
      getHand: (index: number) => fakeXR.hands[index],
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
import { measurePanelBounds } from '../src/xr/panel-bounds';
import { createWorkspaceScene } from '../src/xr/scene';
import { terminalWarpPoint } from '../src/xr/terminal-warp';

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
    error: null,
    connect() {},
    disconnect() {},
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
    togglePaneConnection: vi.fn(),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    sendMouse: vi.fn(() => true),
    runCommand: vi.fn(),
    openKeyboard: vi.fn(),
    openCommands: vi.fn(),
    resizeGrid: vi.fn(() => true),
    setTerminalColorMode: vi.fn(),
    setKeyboardBackground: vi.fn(),
    reloadApp: vi.fn(),
    saveCommand: vi.fn(() => true),
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

function aimControllerAtScreen(
  controller: THREE.Group,
  screen: THREE.Object3D,
  localPoint: THREE.Vector3,
  distance = 0.3,
): void {
  const orientation = screen.getWorldQuaternion(new THREE.Quaternion());
  controller.position.copy(
    screen
      .localToWorld(localPoint.clone())
      .add(new THREE.Vector3(0, 0, distance).applyQuaternion(orientation)),
  );
  controller.quaternion.copy(orientation);
}

function connectController(
  index: number,
  axes = [0, 0, 0, 0],
  handedness: 'left' | 'right' | 'none' = 'right',
): Gamepad {
  const gamepad = {
    axes,
    buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
  } as unknown as Gamepad;
  (fakeXR.controllers[index] as THREE.Group).dispatchEvent({
    type: 'connected',
    data: { gamepad, handedness },
  } as never);
  return gamepad;
}

function pressFocusButton(gamepad: Gamepad, time: number): void {
  (gamepad.buttons[5] as { pressed: boolean }).pressed = true;
  fakeXR.frame?.(time);
  (gamepad.buttons[5] as { pressed: boolean }).pressed = false;
  fakeXR.frame?.(time + 16);
}
let graphFrameTime = 0;
function settleHierarchy(): void {
  for (let frame = 0; frame < 40; frame++) {
    graphFrameTime += 16;
    fakeXR.frame?.(graphFrameTime);
  }
}

function openRadialMenu(gamepad: Gamepad, time: number): void {
  (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
  fakeXR.frame?.(time);
  (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
  fakeXR.frame?.(time + 16);
  fakeXR.frame?.(time + 900);
}

function selectRadialAction(
  workspace: ReturnType<typeof createWorkspaceScene>,
  gamepad: Gamepad,
  action: 'keyboard' | 'commands' | 'panes' | 'layout' | 'warp' | 'widgets' | 'settings' | 'cancel',
  time: number,
): void {
  openRadialMenu(gamepad, time);
  hit(workspace, { inputAction: 'radialAction', radialAction: action });
  fakeXR.frame?.(time + 1100);
}

function selectKeyboardViaRadial(
  workspace: ReturnType<typeof createWorkspaceScene>,
  gamepad: Gamepad,
  time: number,
): void {
  selectRadialAction(workspace, gamepad, 'keyboard', time);
}

describe('native XR controller event routing', () => {
  beforeEach(() => {
    fakeXR.presenting = true;
    localStorage.removeItem('mux-xr:ui-poses:v1');
    localStorage.removeItem('mux-xr:widget-poses:v1');
    localStorage.removeItem('mux-xr:terminal-warp:v1');
    fakeXR.controllers.forEach((controller) => {
      const object = controller as THREE.Group;
      object.position.set(0, 0, 0);
      object.visible = true;
      object.rotation.set(0, 0, 0);
      delete object.userData.inputSourceHand;
    });
    fakeXR.hands.forEach((hand) => {
      const object = hand as THREE.Group & { joints: Record<string, THREE.Group> };
      object.clear();
      object.joints = {};
      object.visible = false;
      object.position.set(0, 0, 0);
      object.quaternion.identity();
    });
  });

  describe('tracked hand sources', () => {
    type Hand = THREE.Group & { joints: Record<string, THREE.Group> };
    const cleanups: Array<() => void> = [];
    afterEach(() => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      vi.unstubAllGlobals();
    });
    const setup = (keyborbMode: 'off' | 'on' | 'auto' = 'off') => {
      const value = fixture();
      value.workspace.setKeyborbMode(keyborbMode);
      cleanups.push(() => {
        value.workspace.dispose();
        value.container.remove();
      });
      value.workspace.selectTerminal('pane-a');
      return value;
    };
    const connectHand = (index = 0): Hand => {
      const hand = fakeXR.hands[index] as Hand;
      hand.visible = true;
      for (const name of ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip']) {
        const joint = new THREE.Group();
        joint.position.set(index ? -0.2 : 0.2, 1.2, -0.4);
        hand.joints[name] = joint;
        hand.add(joint);
      }
      hand.joints['index-finger-tip'].position.x += 0.08;
      hand.joints['middle-finger-tip'].position.y += 0.08;
      const data = {
        hand: new Map(Object.keys(hand.joints).map((jointName) => [jointName, { jointName }])),
        handedness: index ? 'left' : 'right',
      };
      (fakeXR.controllers[index] as THREE.Group).dispatchEvent({
        type: 'connected',
        data,
      } as never);
      hand.dispatchEvent({ type: 'connected', data } as never);
      fakeXR.frame?.(1);
      return hand;
    };
    const nativeEvent = (index: number, type: string): void => {
      (fakeXR.controllers[index] as THREE.Group).dispatchEvent({ type } as never);
      (fakeXR.hands[index] as Hand).dispatchEvent({ type } as never);
    };
    const pinch = (hand: Hand, held: boolean): void => {
      hand.joints['middle-finger-tip'].position.copy(hand.joints['thumb-tip'].position);
      if (!held) hand.joints['middle-finger-tip'].position.y += 0.08;
    };
    const contactKey = (
      workspace: ReturnType<typeof createWorkspaceScene>,
      hand: Hand,
      key: string,
      depth: number,
      time: number,
    ): void => {
      const button = objectWithData(workspace, { inputAction: 'key', key });
      const point = button.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        button.getWorldQuaternion(new THREE.Quaternion()),
      );
      hand.joints.wrist.position
        .copy(point)
        .add(new THREE.Vector3(0, -0.12, 0))
        .addScaledVector(normal, 0.08);
      hand.joints['thumb-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new THREE.Vector3(-0.06, 0.04, 0));
      hand.joints['middle-finger-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new THREE.Vector3(0, 0.17, 0));
      hand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, depth);
      fakeXR.frame?.(time);
    };

    it('switches Auto on hand source changes without moving or retargeting the keyboard', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      expect(workspace.state.keyborbEnabled).toBe(false);
      let root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      root.position.set(0.2, 1.1, -0.9);
      root.rotation.set(0.1, 0.2, -0.1);
      root.scale.setScalar(0.5);
      const position = root.position.clone();
      const quaternion = root.quaternion.clone();
      connectHand();
      expect(workspace.state.keyborbEnabled).toBe(true);
      root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      expect(root.position.distanceTo(position)).toBeLessThan(1e-8);
      expect(root.quaternion.angleTo(quaternion)).toBeLessThan(1e-8);
      expect(root.scale.x).toBe(0.5);
      expect(workspace.state.inputTargetId).toBe('pane-a');
      expect(actions.sendKey).not.toHaveBeenCalled();
      connectController(0);
      expect(workspace.state.keyborbEnabled).toBe(false);
      expect(objectWithData(workspace, { key: 'a' }).userData.keyborb).toBeUndefined();
    });

    it('renders all 62 spherical keys and keeps them spherical on a curved keyboard', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      workspace.setKeyboardCurvature(60);
      const root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const keys = root.children.filter((child) => child.userData.inputAction === 'key');
      expect(keys).toHaveLength(62);
      for (const key of keys) {
        expect((key as THREE.Mesh).geometry).toBeInstanceOf(THREE.SphereGeometry);
        expect(key.userData.labelText).toBeTruthy();
        expect((key as THREE.Mesh).material).toMatchObject({
          transparent: true,
          depthWrite: false,
        });
      }
      hit(workspace, { key: 'a' });
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hit(workspace, { key: 'Shift' });
      expect(objectWithData(workspace, { key: 'b' }).userData.labelText).toBe('B');
      hit(workspace, { key: 'b' });
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', { shift: true });
      expect(objectWithData(workspace, { key: 'b' }).userData.labelText).toBe('b');
      const key = objectWithData(workspace, { key: 'a' }) as THREE.Mesh;
      const disposeGeometry = vi.spyOn(key.geometry, 'dispose');
      const disposeMaterial = vi.spyOn(key.material as THREE.Material, 'dispose');
      workspace.setKeyborbMode('off');
      expect(disposeGeometry).toHaveBeenCalledOnce();
      expect(disposeMaterial).toHaveBeenCalledOnce();
    });

    it('requires pinch selection instead of typing from Keyborb hand contact', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      expect(workspace.state.keyborbEnabled).toBe(true);
      contactKey(workspace, hand, 'a', 0.06, 20);
      contactKey(workspace, hand, 'a', 0.004, 40);
      fakeXR.frame?.(60);
      expect(actions.sendKey).not.toHaveBeenCalled();
      const orb = objectWithData(workspace, { inputAction: 'key', key: 'a' });
      const point = orb.getWorldPosition(new THREE.Vector3());
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.04, 0, 0));
      fakeXR.frame?.(80);
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.02, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.02, 0, 0));
      fakeXR.frame?.(90);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hit(workspace, { key: 'a' });
      for (let frame = 0; frame < 20; frame++) fakeXR.frame?.(100 + frame * 16);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hand.joints['index-finger-tip'].position.x += 0.08;
      fakeXR.frame?.(500);
      nativeEvent(0, 'selectend');
      nativeEvent(0, 'select');
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      expect(
        (fakeXR.controllers[0] as THREE.Group).children.find((child) => child instanceof THREE.Line)
          ?.visible,
      ).toBe(false);
      workspace.setKeyborbMode('off');
      expect(workspace.state.keyborbEnabled).toBe(false);
      workspace.setKeyborbMode('on');
      connectController(0);
      expect(workspace.state.keyborbEnabled).toBe(true);
    });

    it('changes Keyborb modes through native Settings controls', () => {
      const { workspace } = setup('off');
      workspace.showInput('settings');
      hit(workspace, { inputAction: 'keyborbMode', keyborbMode: 'on' });
      expect(workspace.state.keyborbMode).toBe('on');
      expect(workspace.state.keyborbEnabled).toBe(true);
      hit(workspace, { inputAction: 'keyborbMode', keyborbMode: 'auto' });
      expect(workspace.state.keyborbMode).toBe('auto');
      expect(workspace.state.keyborbEnabled).toBe(false);
      connectHand();
      expect(workspace.state.keyborbEnabled).toBe(true);
      nativeEvent(0, 'disconnected');
      expect(workspace.state.keyborbEnabled).toBe(false);
    });

    it('accepts native Keyborb pinches after a natural opening with other fingers relaxed', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const point = objectWithData(workspace, { inputAction: 'key', key: 'a' }).getWorldPosition(
        new THREE.Vector3(),
      );
      hand.joints['index-finger-tip'].position.copy(point);
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.048, 0, 0));
      hand.joints['middle-finger-tip'].position
        .copy(hand.joints['thumb-tip'].position)
        .add(new THREE.Vector3(0, 0.03, 0));
      hand.joints.wrist.visible = false;
      fakeXR.frame?.(10);
      hand.joints.wrist.visible = true;
      fakeXR.frame?.(20);
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.02, 0, 0));
      fakeXR.frame?.(40);
      expect(actions.sendKey).not.toHaveBeenCalled();
      hit(workspace, { inputAction: 'key', key: 'a' });
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hit(workspace, { inputAction: 'key', key: 'a' });
      fakeXR.frame?.(60);
      expect(actions.sendKey).toHaveBeenCalledTimes(1);
      nativeEvent(0, 'selectend');
      hit(workspace, { inputAction: 'key', key: 'a' });
      fakeXR.frame?.(80);
      expect(actions.sendKey).toHaveBeenCalledTimes(1);
      nativeEvent(0, 'selectend');
    });

    it.each(['off', 'on'] as const)(
      'suppresses both distant rays when either hand is near the %s keyboard',
      (mode) => {
        const { workspace, actions } = setup(mode);
        workspace.showInput('keyboard');
        const near = connectHand(0);
        const far = connectHand(1);
        const other = fakeXR.controllers[1] as THREE.Group;
        const panel = objectWithData(workspace, { terminalId: 'pane-b' });
        aimController(other, panel);
        contactKey(workspace, near, 'a', 0.06, 20);
        for (const controller of fakeXR.controllers as THREE.Group[])
          expect(controller.children.find((child) => child instanceof THREE.Line)?.visible).toBe(
            false,
          );
        vi.mocked(actions.selectPane).mockClear();
        nativeEvent(1, 'selectstart');
        expect(workspace.state.selectedTerminalId).toBe('pane-a');
        expect(actions.selectPane).not.toHaveBeenCalledWith('pane-b');
        const position = panel.position.clone();
        pinch(far, true);
        fakeXR.frame?.(40);
        for (const joint of Object.values(far.joints)) joint.position.x += 0.1;
        fakeXR.frame?.(60);
        expect(panel.position.distanceTo(position)).toBeLessThan(1e-8);
        pinch(far, false);
        for (const hand of [near, far])
          for (const joint of Object.values(hand.joints)) joint.position.z += 2;
        fakeXR.frame?.(80);
        for (const controller of fakeXR.controllers as THREE.Group[])
          expect(controller.children.find((child) => child instanceof THREE.Line)?.visible).toBe(
            true,
          );
        aimController(other, panel);
        nativeEvent(1, 'selectstart');
        expect(workspace.state.selectedTerminalId).toBe('pane-b');
      },
    );

    it('keeps forgiving pinch modifier holds and cancels held pinches when retargeting', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const pose = (key: string, gap: number, time: number): void => {
        const button = objectWithData(workspace, { inputAction: 'key', key });
        const point = button.getWorldPosition(new THREE.Vector3());
        hand.joints['index-finger-tip'].position.copy(point);
        hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(gap, 0, 0));
        hand.joints['middle-finger-tip'].position
          .copy(hand.joints['thumb-tip'].position)
          .add(new THREE.Vector3(0, 0.12, 0));
        fakeXR.frame?.(time);
      };
      pose('Shift', 0.08, 100);
      pose('Shift', 0.04, 120);
      expect(objectWithData(workspace, { key: 'Shift' }).userData.activeState).toBe(true);
      nativeEvent(0, 'selectend');
      fakeXR.frame?.(800);
      const shift = objectWithData(workspace, { key: 'Shift' });
      expect(shift.userData.locked).toBe(true);
      expect(shift.userData.keyborbLabel.userData.labelText).toBe('Shift\nlock');
      pose('Shift', 0.08, 900);
      pose('Shift', 0.08, 910);
      pose('b', 0.04, 930);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('b', { shift: true });
      workspace.selectTerminal('pane-b');
      fakeXR.frame?.(940);
      expect(actions.sendKey).toHaveBeenCalledTimes(1);
      pose('b', 0.08, 960);
      pose('b', 0.04, 980);
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', undefined);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
      expect(workspace.state.inputTargetId).toBe('pane-b');
    });

    it('accepts both hands pinching separate orbs in the same frame', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hands = [connectHand(0), connectHand(1)];
      const points = ['a', 'b'].map((key) =>
        objectWithData(workspace, { inputAction: 'key', key }).getWorldPosition(
          new THREE.Vector3(),
        ),
      );
      const pose = (gap: number): void => {
        for (const [index, hand] of hands.entries()) {
          hand.joints['index-finger-tip'].position.copy(points[index]);
          hand.joints['thumb-tip'].position.copy(points[index]).add(new THREE.Vector3(gap, 0, 0));
          hand.joints['middle-finger-tip'].position
            .copy(hand.joints['thumb-tip'].position)
            .add(new THREE.Vector3(0, 0.12, 0));
        }
      };
      pose(0.08);
      fakeXR.frame?.(100);
      pose(0.04);
      fakeXR.frame?.(120);
      expect(vi.mocked(actions.sendKey).mock.calls).toEqual([
        ['a', undefined],
        ['b', undefined],
      ]);
      fakeXR.frame?.(140);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
    });

    it('hides both hand rays and types once per index poke without ray selection', () => {
      const { workspace, actions } = setup();
      workspace.showInput('keyboard');
      const hand = connectHand(0);
      connectHand(1);
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.set(5, 5, 0);
      contactKey(workspace, hand, 'a', 0.06, 20);
      const ray = controller.children.find((node) => node instanceof THREE.Line);
      expect(ray?.visible).toBe(false);
      expect(
        (fakeXR.controllers[1] as THREE.Group).children.find((node) => node instanceof THREE.Line)
          ?.visible,
      ).toBe(false);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      expect(actions.sendKey).not.toHaveBeenCalled();
      contactKey(workspace, hand, 'a', 0.004, 40);
      fakeXR.frame?.(60);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      contactKey(workspace, hand, 'a', 0.06, 80);
      contactKey(workspace, hand, 'a', 0.004, 100);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
      for (const joint of Object.values(hand.joints)) joint.position.z += 1;
      fakeXR.frame?.(120);
      expect(ray?.visible).toBe(true);
    });

    it('keeps poke modifier holds through rebuilds and cancels held contact when retargeting', () => {
      const { workspace, actions } = setup();
      workspace.showInput('keyboard');
      const hand = connectHand();
      contactKey(workspace, hand, 'Shift', 0.06, 20);
      contactKey(workspace, hand, 'Shift', 0.004, 40);
      fakeXR.frame?.(60);
      fakeXR.frame?.(660);
      contactKey(workspace, hand, 'Shift', 0.06, 680);
      contactKey(workspace, hand, 'b', 0.06, 700);
      contactKey(workspace, hand, 'b', 0.004, 720);
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', { shift: true });
      const count = vi.mocked(actions.sendKey).mock.calls.length;
      workspace.selectTerminal('pane-b');
      fakeXR.frame?.(740);
      expect(actions.sendKey).toHaveBeenCalledTimes(count);
      contactKey(workspace, hand, 'c', 0.06, 760);
      contactKey(workspace, hand, 'c', 0.004, 780);
      expect(actions.sendKey).toHaveBeenLastCalledWith('c', undefined);
      expect(workspace.state.inputTargetId).toBe('pane-b');
    });

    it('grips a contacted keyboard with its ray elsewhere and never pokes while gripping', () => {
      const { workspace, actions, left } = setup();
      workspace.showInput('keyboard');
      const hand = connectHand();
      (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
      contactKey(workspace, hand, 'a', 0.015, 20);
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const before = keyboard.position.clone();
      hand.joints['index-finger-tip'].position.z -= 0.011;
      pinch(hand, true);
      fakeXR.frame?.(40);
      const movement = new THREE.Vector3(0.1, 0.03, 0);
      for (const joint of Object.values(hand.joints)) joint.position.add(movement);
      fakeXR.frame?.(60);
      expect(keyboard.position.clone().sub(before).distanceTo(movement)).toBeLessThan(1e-5);
      pinch(hand, false);
      fakeXR.frame?.(80);
      expect(actions.sendKey).not.toHaveBeenCalled();
      expect(left.resizeGrid).not.toHaveBeenCalled();
    });

    it.each(['retarget', 'mode'] as const)(
      'cancels an empty held contact grip on %s change',
      (change) => {
        const { workspace } = setup();
        workspace.showInput('keyboard');
        const hand = connectHand();
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        for (const joint of Object.values(hand.joints)) joint.position.addScalar(5);
        fakeXR.frame?.(20);
        pinch(hand, true);
        fakeXR.frame?.(40);
        if (change === 'retarget') workspace.selectTerminal('pane-b');
        else {
          workspace.showInput('commands');
          workspace.showInput('keyboard');
        }
        const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
        const key = objectWithData(workspace, { inputAction: 'key', key: 'a' });
        const point = key.getWorldPosition(new THREE.Vector3());
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          key.getWorldQuaternion(new THREE.Quaternion()),
        );
        const movement = point.addScaledVector(normal, 0.015).sub(hand.joints.wrist.position);
        for (const joint of Object.values(hand.joints)) joint.position.add(movement);
        fakeXR.frame?.(60);
        const before = keyboard.position.clone();
        for (const joint of Object.values(hand.joints)) joint.position.x += 0.1;
        fakeXR.frame?.(80);
        expect(keyboard.position.distanceTo(before)).toBeLessThan(1e-5);
      },
    );

    it.each(['panel', 'hud', 'widget'] as const)(
      'contact-grips the actual %s owner rather than the focused pane',
      (kind) => {
        const { workspace, actions } = setup();
        workspace.selectTerminal('pane-b');
        if (kind === 'widget') {
          workspace.showInput('widgets');
          hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
          workspace.hideInput();
        }
        const hand = connectHand();
        const object = (
          kind === 'widget'
            ? objectWithData(workspace, { inputAction: 'grabWidget', widgetKind: 'digital-clock' })
            : workspace.scene.getObjectByName(
                kind === 'panel' ? 'terminal-panel-pane-a' : 'xr-workspace-hud',
              )
        ) as THREE.Group;
        const point = object.getWorldPosition(new THREE.Vector3());
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          object.getWorldQuaternion(new THREE.Quaternion()),
        );
        hand.joints.wrist.position
          .copy(point)
          .add(new THREE.Vector3(0, -0.047, 0))
          .addScaledVector(normal, 0.02);
        hand.joints['thumb-tip'].position
          .copy(hand.joints.wrist.position)
          .add(new THREE.Vector3(-0.06, 0.04, 0));
        hand.joints['middle-finger-tip'].position
          .copy(hand.joints.wrist.position)
          .add(new THREE.Vector3(0, 0.17, 0));
        hand.joints['index-finger-tip'].position
          .copy(hand.joints.wrist.position)
          .add(new THREE.Vector3(0, 0.12, 0));
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        fakeXR.frame?.(20);
        const before = object.position.clone();
        const other = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
        const otherBefore = other.position.clone();
        pinch(hand, true);
        fakeXR.frame?.(40);
        for (const joint of Object.values(hand.joints)) joint.position.x += 0.1;
        fakeXR.frame?.(60);
        expect(object.position.x - before.x).toBeCloseTo(0.1);
        expect(other.position.distanceTo(otherBefore)).toBeLessThan(1e-5);
        expect(actions.sendKey).not.toHaveBeenCalled();
      },
    );

    it('contact-grabs with both hands and rebases when one loses tracking', () => {
      const { workspace, actions } = setup();
      const right = connectHand(0);
      const left = connectHand(1);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const point = panel.getWorldPosition(new THREE.Vector3());
      for (const [i, hand] of [right, left].entries()) {
        const wrist = point.clone().add(new THREE.Vector3(i ? -0.12 : 0.12, -0.047, 0.02));
        const movement = wrist.sub(hand.joints.wrist.position);
        for (const joint of Object.values(hand.joints)) joint.position.add(movement);
        (fakeXR.controllers[i] as THREE.Group).position.set(5, 5, 0);
      }
      fakeXR.frame?.(20);
      pinch(right, true);
      fakeXR.frame?.(40);
      pinch(left, true);
      fakeXR.frame?.(60);
      const scale = panel.scale.x;
      for (const joint of Object.values(right.joints)) joint.position.x += 0.1;
      for (const joint of Object.values(left.joints)) joint.position.x -= 0.1;
      fakeXR.frame?.(80);
      expect(panel.scale.x).toBeGreaterThan(scale);
      const position = panel.position.clone();
      left.joints.wrist.visible = false;
      fakeXR.frame?.(100);
      expect(panel.position.distanceTo(position)).toBeLessThan(1e-5);
      for (const joint of Object.values(right.joints)) joint.position.x += 0.1;
      fakeXR.frame?.(120);
      expect(panel.position.x - position.x).toBeCloseTo(0.1);
      expect(actions.sendKey).not.toHaveBeenCalled();
    });

    it.each(['vr', 'ar'] as const)(
      'requests optional hand tracking in %s sessions',
      async (mode) => {
        const { workspace } = setup();
        const requestSession = vi.fn(async () => ({
          addEventListener: vi.fn(),
          end: vi.fn(async () => undefined),
        }));
        vi.stubGlobal('navigator', { xr: { requestSession } });
        await workspace.enterXR(mode);
        expect(requestSession).toHaveBeenLastCalledWith(
          mode === 'ar' ? 'immersive-ar' : 'immersive-vr',
          {
            optionalFeatures:
              mode === 'ar'
                ? ['local-floor', 'dom-overlay', 'hand-tracking']
                : ['local-floor', 'hand-tracking'],
          },
        );
      },
    );

    it('uses the target-ray identity once and keeps controllers working with getHand available', () => {
      const { workspace, actions } = setup();
      workspace.showInput('keyboard');
      connectHand();
      hit(workspace, { key: 'a' });
      (fakeXR.hands[0] as Hand).dispatchEvent({ type: 'selectstart' } as never);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      nativeEvent(0, 'selectend');
      connectController(0);
      hit(workspace, { key: 'b' });
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', undefined);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
    });

    it('opens the radial and keyboard through the hand-accessible HUD Menu', () => {
      const { workspace } = setup();
      connectHand();
      hit(workspace, { inputAction: 'toggleRadial' });
      fakeXR.frame?.(1000);
      expect(workspace.state.radialOpen).toBe(true);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'keyboard' });
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    });

    it('offers hand-selectable Warp presets without entering a stick-only mode', () => {
      const { workspace, left } = setup();
      connectHand();
      hit(workspace, { inputAction: 'toggleRadial' });
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
      fakeXR.frame?.(1200);
      expect(workspace.state.warpTerminalId).toBeNull();
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeDefined();
      hit(workspace, { inputAction: 'curvature', degrees: 30 });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
      expect(left.resizeGrid).not.toHaveBeenCalled();
    });

    it('opens the wrist watch by left index contact once and rearms after withdrawal', () => {
      const { workspace, actions } = setup();
      connectHand(0);
      const leftHand = connectHand(1);
      const face = objectWithData(workspace, { inputAction: 'wristMenu' });
      const point = face.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        face.getWorldQuaternion(new THREE.Quaternion()),
      );
      leftHand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, 0.08);
      fakeXR.frame?.(20);
      leftHand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, 0.005);
      fakeXR.frame?.(40);
      expect(workspace.state.radialOpen).toBe(true);
      fakeXR.frame?.(100);
      expect(workspace.state.radialOpen).toBe(true);
      leftHand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, 0.08);
      fakeXR.frame?.(400);
      leftHand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, 0.005);
      fakeXR.frame?.(450);
      expect(workspace.state.radialOpen).toBe(false);
      expect(actions.sendKey).not.toHaveBeenCalled();
    });

    it.each(['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip'])(
      'cancels %s tracking loss before a render callback and rearms only after neutral release',
      (joint) => {
        const { workspace, actions } = setup();
        workspace.showInput('keyboard');
        const hand = connectHand();
        hand.joints[joint].visible = false;
        hit(workspace, { key: 'a' });
        expect(actions.sendKey).not.toHaveBeenCalled();
        hand.joints[joint].visible = true;
        hand.joints['index-finger-tip'].position.copy(hand.joints['thumb-tip'].position);
        hit(workspace, { key: 'a' });
        expect(actions.sendKey).not.toHaveBeenCalled();
        hand.joints['index-finger-tip'].position.x += 0.08;
        fakeXR.frame?.(30);
        hit(workspace, { key: 'a' });
        expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      },
    );

    it('moves the grabbed panel from the wrist and suppresses simultaneous index selection', () => {
      const { workspace, actions } = setup();
      const hand = connectHand();
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const title = objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-a' });
      const root = fakeXR.controllers[0] as THREE.Group;
      aimController(root, title);
      workspace.scene.updateMatrixWorld(true);
      pinch(hand, true);
      nativeEvent(0, 'selectstart');
      fakeXR.frame?.(20);
      const before = panel.position.clone();
      hand.joints.wrist.position.x += 0.2;
      fakeXR.frame?.(40);
      expect(panel.position.x - before.x).toBeCloseTo(0.2);
      expect(actions.sendKey).not.toHaveBeenCalled();
      pinch(hand, false);
      fakeXR.frame?.(60);
      const released = panel.position.clone();
      hand.joints.wrist.position.x += 0.1;
      fakeXR.frame?.(80);
      expect(panel.position.distanceTo(released)).toBeLessThan(0.00001);
    });

    it('scales using two wrist poses and rebases when one hand releases or loses tracking', () => {
      const { workspace } = setup();
      const right = connectHand(0);
      const left = connectHand(1);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const title = objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-a' });
      aimController(fakeXR.controllers[0] as THREE.Group, title);
      aimController(fakeXR.controllers[1] as THREE.Group, title);
      workspace.scene.updateMatrixWorld(true);
      pinch(right, true);
      fakeXR.frame?.(20);
      pinch(left, true);
      fakeXR.frame?.(40);
      const scale = panel.scale.x;
      right.joints.wrist.position.x += 0.1;
      left.joints.wrist.position.x -= 0.1;
      fakeXR.frame?.(60);
      expect(panel.scale.x).toBeGreaterThan(scale);
      const position = panel.position.clone();
      left.joints.wrist.visible = false;
      fakeXR.frame?.(80);
      expect(panel.position.distanceTo(position)).toBeLessThan(0.00001);
      right.joints.wrist.position.x += 0.1;
      fakeXR.frame?.(100);
      expect(panel.position.x - position.x).toBeCloseTo(0.1);
    });
  });

  it('lets the left controller press the right wrist Menu watch and rejects its right controller', () => {
    const { workspace, actions, container } = fixture();
    connectController(0, [0, 0, 0, 0], 'right');
    connectController(1, [0, 0, 0, 0], 'left');
    fakeXR.frame?.(20);
    hit(workspace, { inputAction: 'wristMenu' });
    expect(workspace.state.radialOpen).toBe(false);
    const face = objectWithData(workspace, { inputAction: 'wristMenu' });
    const leftController = fakeXR.controllers[1] as THREE.Group;
    aimController(leftController, face);
    workspace.scene.updateMatrixWorld(true);
    leftController.dispatchEvent({ type: 'selectstart' } as never);
    expect(workspace.state.radialOpen).toBe(true);
    fakeXR.frame?.(40);
    expect(workspace.state.radialOpen).toBe(true);
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('shows a readable three-line dictation excerpt and scrolls without changing its text', () => {
    const { workspace, actions, container } = fixture();
    const transcript = Array.from({ length: 60 }, (_, index) => `word${index}`).join('\n');
    const draft = { supported: true, status: 'review' as const, transcript, error: null };
    actions.editDictation = (text) => workspace.setDictationState({ ...draft, transcript: text });
    workspace.setDictationState(draft);
    workspace.showInput('keyboard');
    const label = workspace.scene.getObjectByName('xr-dictation-transcript');
    const caption = String(label?.userData.labelText);
    expect(caption.split('\n')).toHaveLength(3);
    expect(caption.split('\n').every((line) => Array.from(line).length <= 36)).toBe(true);
    expect(workspace.state.dictation.transcript).toBe(transcript);
    hit(workspace, { inputAction: 'key', key: 'ArrowUp' });
    expect(label?.userData.labelText).not.toBe(caption);
    expect(workspace.state.dictation.transcript).toBe(transcript);
    workspace.dispose();
    container.remove();
  });

  describe('trigger text selection', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      vi.unstubAllGlobals();
    });
    const setupSelection = (writeText = vi.fn(() => Promise.resolve())) => {
      const value = fixture();
      const { workspace, actions, left, container } = value;
      cleanups.push(() => {
        workspace.dispose();
        container.remove();
      });
      actions.sendMouse = vi.fn(() => false);
      left.beginSelection = vi.fn(() => true);
      left.updateSelection = vi.fn();
      left.getSelectionText = vi.fn(() => 'exact text\n界 😀');
      left.clearSelection = vi.fn();
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const screen = workspace.scene
        .getObjectByName('terminal-panel-pane-a')
        ?.getObjectByName('terminal-surface') as THREE.Mesh<THREE.PlaneGeometry>;
      const width = screen.geometry.parameters.width;
      const height = screen.geometry.parameters.height;
      const aimCell = (col: number, row: number): void => {
        const point = terminalWarpPoint(((col + 0.5) / left.cols - 0.5) * width, {
          width,
          height,
          radians: THREE.MathUtils.degToRad(workspace.getTerminalCurvature('pane-a')),
        });
        aimControllerAtScreen(
          controller,
          screen,
          new THREE.Vector3(point.x, (0.5 - (row + 0.5) / left.rows) * height, point.z),
        );
      };
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const start = (): void => {
        aimCell(2, 3);
        controller.dispatchEvent({ type: 'selectstart' } as never);
      };
      const drag = (): void => {
        aimCell(8, 5);
        fakeXR.frame?.(100);
      };
      const finish = (): void => {
        controller.dispatchEvent({ type: 'select' } as never);
        controller.dispatchEvent({ type: 'selectend' } as never);
      };
      return { ...value, controller, aimCell, start, drag, finish, writeText };
    };

    it('copies curved-grid text and clears immediately on completed trigger release', async () => {
      let resolveWrite: (() => void) | undefined;
      const write = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );
      const { workspace, left, start, drag, finish } = setupSelection(write);
      workspace.setTerminalCurvature('pane-a', 60);
      start();
      expect(left.beginSelection).toHaveBeenCalledWith({ col: 2, row: 3 });
      drag();
      expect(left.updateSelection).toHaveBeenLastCalledWith({ col: 8, row: 5 });
      expect(write).not.toHaveBeenCalled();
      finish();
      expect(write).toHaveBeenCalledExactlyOnceWith('exact text\n界 😀');
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      expect(workspace.state.toast).toContain('Copied');
      resolveWrite?.();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('clears selection and keeps local paste available when system copy fails', async () => {
      const { workspace, left, start, drag, finish } = setupSelection(
        vi.fn(() => Promise.reject(new Error('denied'))),
      );
      start();
      drag();
      finish();
      await Promise.resolve();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      expect(workspace.state.toast).toContain('Copied in Mux XR');
      left.paste = vi.fn(() => true);
      expect(await workspace.pasteClipboard('pane-a')).toBe(true);
      expect(left.paste).toHaveBeenCalledWith('exact text\n界 😀');
    });

    it('keeps copied text available through grip and recenter while OS copy is pending', async () => {
      let rejectWrite: ((reason: Error) => void) | undefined;
      const { workspace, left, controller, start, drag, finish } = setupSelection(
        vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectWrite = reject;
            }),
        ),
      );
      start();
      drag();
      finish();
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      workspace.resetLayout();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      rejectWrite?.(new Error('denied'));
      await Promise.resolve();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      expect(workspace.state.toast).toContain('Copied in Mux XR');
    });

    it('pastes only on a completed native Paste gesture and cancels on disconnect', async () => {
      const { workspace, left, controller, start, drag, finish } = setupSelection();
      start();
      drag();
      finish();
      left.paste = vi.fn(() => true);
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'pasteClipboard' });
      expect(left.paste).not.toHaveBeenCalled();
      finish();
      await Promise.resolve();
      expect(left.paste).toHaveBeenCalledExactlyOnceWith('exact text\n界 😀');
      expect(workspace.state.toast).toBe('Pasted.');
      hit(workspace, { inputAction: 'pasteClipboard' });
      controller.dispatchEvent({ type: 'disconnected' } as never);
      finish();
      await Promise.resolve();
      expect(left.paste).toHaveBeenCalledTimes(1);
    });

    it('does not paste into a different pane while an external clipboard read is pending', async () => {
      let resolveRead!: (text: string) => void;
      const { workspace, left, right } = setupSelection();
      left.paste = vi.fn(() => true);
      right.paste = vi.fn(() => true);
      vi.stubGlobal('navigator', {
        clipboard: {
          readText: () =>
            new Promise<string>((resolve) => {
              resolveRead = resolve;
            }),
        },
      });
      const pending = workspace.pasteClipboard('pane-a');
      workspace.selectTerminal('pane-b');
      resolveRead('external text');
      expect(await pending).toBe(false);
      expect(left.paste).not.toHaveBeenCalled();
      expect(right.paste).not.toHaveBeenCalled();
      expect(workspace.state.notice).toContain('paste target changed');
    });

    it('does not copy a click or a cancelled selectend', () => {
      const { left, controller, start, drag, finish, writeText } = setupSelection();
      start();
      finish();
      expect(writeText).not.toHaveBeenCalled();
      start();
      drag();
      controller.dispatchEvent({ type: 'selectend' } as never);
      expect(writeText).not.toHaveBeenCalled();
      expect(left.clearSelection).toHaveBeenCalledTimes(2);
    });

    it('cancels selection on grip, disconnect, recenter and removal without copying', () => {
      for (const action of ['grip', 'disconnect', 'reset', 'remove'] as const) {
        const { workspace, left, controller, start, drag, finish, writeText } = setupSelection();
        start();
        drag();
        if (action === 'grip') controller.dispatchEvent({ type: 'squeezestart' } as never);
        else if (action === 'disconnect')
          controller.dispatchEvent({ type: 'disconnected' } as never);
        else if (action === 'reset') workspace.resetLayout();
        else workspace.removeTerminal('pane-a');
        finish();
        expect(writeText).not.toHaveBeenCalled();
        expect(left.clearSelection).toHaveBeenCalledTimes(1);
        workspace.dispose();
      }
    });

    it('keeps TUI mouse reporting and suppresses selection while gripping', () => {
      const { actions, left, controller, start, drag, finish, writeText } = setupSelection();
      Object.defineProperty(left, 'mouseTracking', { value: 'drag' });
      actions.sendMouse = vi.fn(() => true);
      start();
      drag();
      finish();
      expect(actions.sendMouse).toHaveBeenCalled();
      expect(left.beginSelection).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      start();
      expect(left.beginSelection).not.toHaveBeenCalled();
    });

    it('does not clear a newer selection when an older clipboard write resolves', async () => {
      let resolveWrite: (() => void) | undefined;
      const { left, start, drag, finish } = setupSelection(
        vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveWrite = resolve;
            }),
        ),
      );
      start();
      drag();
      finish();
      start();
      drag();
      const clear = left.clearSelection;
      if (!clear) throw new Error('Selection cleanup missing');
      const cleared = vi.mocked(clear).mock.calls.length;
      resolveWrite?.();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(cleared);
    });
  });

  it('replaces the HUD keyboard shortcut with Widgets and closes clocks without typing', () => {
    const { workspace, actions, container } = fixture();
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    const modes = hud?.children.map((object) => object.userData.mode);
    expect(modes).not.toContain('widgets');
    expect(modes).not.toContain('keyboard');
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    expect(workspace.state.widgets).toEqual(['digital-clock']);
    const root = objectWithData(workspace, {
      widgetKind: 'digital-clock',
      inputAction: 'grabWidget',
    });
    hit(workspace, { inputAction: 'grabWidget', widgetKind: 'digital-clock' }, 'squeezestart');
    const initial = root.getWorldPosition(new THREE.Vector3());
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(16);
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(initial)).toBeGreaterThan(0.1);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    hit(workspace, { inputAction: 'closeWidget', widgetKind: 'digital-clock' });
    expect(workspace.state.widgets).toEqual([]);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(actions.sendText).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('pair-scales a clock, recovers it and disposes it without terminal traffic', () => {
    const { workspace, actions, left, container } = fixture();
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'analog-clock' });
    const face = objectWithData(workspace, {
      widgetKind: 'analog-clock',
      inputAction: 'grabWidget',
    });
    const close = objectWithData(workspace, {
      widgetKind: 'analog-clock',
      inputAction: 'closeWidget',
    });
    let root = face;
    while (root.parent && !root.userData.scaleLimits) root = root.parent;
    connectController(0);
    connectController(1);
    aimController(fakeXR.controllers[0] as THREE.Group, face);
    aimController(fakeXR.controllers[1] as THREE.Group, close);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    (fakeXR.controllers[1] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    const scale = root.scale.x;
    (fakeXR.controllers[0] as THREE.Group).position.x -= 0.1;
    (fakeXR.controllers[1] as THREE.Group).position.x += 0.1;
    fakeXR.frame?.(16);
    expect(root.scale.x).toBeGreaterThan(scale);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    (fakeXR.controllers[1] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    workspace.resetLayout();
    expect(root.scale.x).toBe(1);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(left.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    expect(root.children).toHaveLength(0);
    container.remove();
  });

  it('saves final UI grip poses and saves again when XR ends after presentation stops', async () => {
    const listeners: Array<() => void> = [];
    const session = {
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      end: async () => {
        fakeXR.presenting = false;
        listeners.forEach((listener) => {
          listener();
        });
      },
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    await workspace.enterXR('vr');
    fakeXR.frame?.(0);
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(16);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    const saved = JSON.parse(localStorage.getItem('mux-xr:ui-poses:v1') ?? '{}');
    expect(saved.poses.keyboard.position).toHaveLength(3);
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!hud) throw new Error('HUD missing');
    hud.position.x = 0.37;
    hud.scale.setScalar(0.7);
    hit(workspace, { inputAction: 'exit' });
    await Promise.resolve();
    const ended = JSON.parse(localStorage.getItem('mux-xr:ui-poses:v1') ?? '{}');
    expect(ended.poses.hud.scale).toBeCloseTo(0.7);
    expect(ended.poses.keyboard).toBeDefined();
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('opens native Widgets and Filtering in desktop preview without a keyboard drawer', () => {
    const { workspace, actions, container } = fixture();
    fakeXR.presenting = false;
    workspace.showInput('widgets');
    expect(workspace.scene.getObjectByName('xr-widgets-controls')).toBeDefined();
    workspace.showInput('filtering');
    expect(workspace.scene.getObjectByName('xr-filtering-controls')).toBeDefined();
    expect(actions.openKeyboard).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('reverses normal-grip yaw while retaining local pitch behavior', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    connectController(0, [0, 0, 1, 0]);
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    const before = keyboard.quaternion.clone();
    fakeXR.frame?.(0);
    const expected = before.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9 / 60),
    );
    expect(keyboard.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    workspace.dispose();
    container.remove();
  });

  it('scrolls only the pointed pane while ungripped without changing selection', () => {
    const { workspace, actions, container } = fixture();
    actions.scrollTerminal = vi.fn(() => true);
    workspace.selectTerminal('pane-a');
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface');
    if (!screen) throw new Error('screen missing');
    const pad = connectController(0, [0, 0, 0, 1]);
    aimController(fakeXR.controllers[0] as THREE.Group, screen);
    fakeXR.frame?.(0);
    expect(actions.scrollTerminal).toHaveBeenCalledWith('pane-b', 3, expect.any(Object));
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    (pad.buttons[1] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(500);
    expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
    workspace.dispose();
    container.remove();
  });

  it('persists clock presence and transforms and removes saved clocks on close', () => {
    const first = fixture();
    first.workspace.showInput('widgets');
    hit(first.workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    const root = first.workspace.scene.children.find(
      (o) => o.userData.widgetKind === 'digital-clock',
    );
    if (!root) throw new Error('clock missing');
    hit(
      first.workspace,
      { inputAction: 'grabWidget', widgetKind: 'digital-clock' },
      'squeezestart',
    );
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(0);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    const expected = root.position.clone();
    first.workspace.showInput('settings');
    first.workspace.setKeyboardCurvature(40);
    first.workspace.arrangeTerminals('grid');
    first.workspace.camera.position.x += 0.3;
    first.workspace.camera.updateMatrixWorld(true);
    for (let frame = 1; frame < 40; frame++) fakeXR.frame?.(frame * 16);
    expect(root.position.distanceTo(expected)).toBeLessThan(1e-6);
    first.workspace.dispose();
    first.container.remove();
    const second = fixture();
    fakeXR.frame?.(16);
    const restored = second.workspace.scene.children.find(
      (o) => o.userData.widgetKind === 'digital-clock',
    );
    expect(restored?.position.distanceTo(expected)).toBeLessThan(1e-6);
    hit(second.workspace, { inputAction: 'closeWidget', widgetKind: 'digital-clock' });
    expect(JSON.parse(localStorage.getItem('mux-xr:widget-poses:v1') ?? '{}').poses).toEqual({});
    second.workspace.dispose();
    second.container.remove();
  });

  it('curves only the selected pane and persists curvature without resizing its grid', () => {
    const { workspace, left, right, container } = fixture();
    workspace.setTerminalCurvature('pane-b', 60);
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface') as THREE.Mesh;
    expect(screen.geometry.boundingSphere?.radius).toBeGreaterThan(0);
    expect(workspace.getTerminalCurvature('pane-b')).toBe(60);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(0);
    expect(left.resizeGrid).not.toHaveBeenCalled();
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.setNotice('Example message');
    hit(workspace, { inputAction: 'dismissNotice' });
    expect(workspace.state.notice).toBeNull();
    workspace.dispose();
    container.remove();
  });

  it('routes stream controls separately from closing the terminal view', () => {
    const { workspace, actions } = fixture();
    hit(workspace, { inputAction: 'toggleConnection', terminalId: 'pane-a' });
    expect(actions.togglePaneConnection).toHaveBeenCalledWith('pane-a');
    expect(actions.closePane).not.toHaveBeenCalled();
    hit(workspace, { inputAction: 'closePane', terminalId: 'pane-a' });
    expect(actions.closePane).toHaveBeenCalledWith('pane-a');
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(actions.sendText).not.toHaveBeenCalled();
    workspace.dispose();
  });

  it('routes controller screen hits to clamped terminal mouse cells and captures movement', () => {
    const { workspace, actions, container } = fixture();
    const screen = workspace.scene.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    const geometry = (screen as THREE.Mesh).geometry as THREE.PlaneGeometry;
    const width = geometry.parameters.width;
    const height = geometry.parameters.height;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(width * 0.001, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 40, row: 12, button: 0, eventType: 'press' }),
    );

    aimControllerAtScreen(controller, screen, new THREE.Vector3(width * 0.25, height * 0.25, 0));
    fakeXR.frame?.(16);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 60, row: 6, button: 0, eventType: 'move' }),
    );

    aimControllerAtScreen(
      controller,
      screen,
      new THREE.Vector3(width * 0.4999, -height * 0.4999, 0),
    );
    fakeXR.frame?.(32);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 79, row: 23, eventType: 'move' }),
    );
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 79, row: 23, eventType: 'release' }),
    );
    workspace.dispose();
    container.remove();
  });

  it('suppresses controller mouse input while a grip is held or its raw grip button is pressed', () => {
    const { workspace, actions, container } = fixture();
    const screen = workspace.scene.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    const gamepad = connectController(0);
    (gamepad.buttons[1] as { pressed: boolean }).pressed = true;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).not.toHaveBeenCalled();
    (gamepad.buttons[1] as { pressed: boolean }).pressed = false;
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).toHaveBeenCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'press' }),
    );
    const callsBeforeGrip = (actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length;
    controller.dispatchEvent({ type: 'squeezestart' } as never);
    expect(actions.sendMouse).toHaveBeenCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'release' }),
    );
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect((actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBeforeGrip + 1,
    );
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    workspace.dispose();
    container.remove();
  });

  it('keeps mouse capture on the original pane while the ray crosses another pane or empty space', () => {
    const { workspace, actions, container } = fixture();
    const screenA = workspace.scene
      .getObjectByName('terminal-panel-pane-a')
      ?.getObjectByName('terminal-surface');
    const screenB = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface');
    if (!screenA || !screenB) throw new Error('Terminal surfaces missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    aimControllerAtScreen(controller, screenA, new THREE.Vector3(0.001, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 40, row: 12, eventType: 'press' }),
    );
    const callsAfterPress = (actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length;

    aimControllerAtScreen(controller, screenB, new THREE.Vector3(0.2, 0, 0));
    fakeXR.frame?.(16);
    expect((actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterPress);

    const orientation = screenA.getWorldQuaternion(new THREE.Quaternion());
    controller.position.copy(screenA.localToWorld(new THREE.Vector3(0, 0, 0.3)));
    controller.quaternion.copy(
      new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
        .multiply(orientation),
    );
    fakeXR.frame?.(32);
    expect((actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterPress);

    aimControllerAtScreen(controller, screenA, new THREE.Vector3(0.2, 0, 0));
    fakeXR.frame?.(48);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 51, row: 12, eventType: 'move' }),
    );
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 51, row: 12, eventType: 'release' }),
    );
    workspace.dispose();
    container.remove();
  });

  it('does not capture a controller mouse press when the backend rejects it', () => {
    const { workspace, actions, container } = fixture();
    const screen = workspace.scene.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    (actions.sendMouse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const controller = fakeXR.controllers[0] as THREE.Group;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(actions.sendMouse).toHaveBeenCalledTimes(1);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'press' }),
    );
    workspace.dispose();
    container.remove();
  });

  it('releases captured controller mouse input when the terminal closes, disconnects, or XR ends', async () => {
    const pressCenter = (workspace: ReturnType<typeof createWorkspaceScene>): void => {
      const screen = workspace.scene.getObjectByName('terminal-surface');
      if (!screen) throw new Error('Terminal surface missing');
      const controller = fakeXR.controllers[0] as THREE.Group;
      aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001, 0, 0));
      controller.dispatchEvent({ type: 'selectstart' } as never);
    };

    {
      const { workspace, actions, container } = fixture();
      pressCenter(workspace);
      workspace.removeTerminal('pane-a');
      expect(actions.sendMouse).toHaveBeenLastCalledWith(
        'pane-a',
        expect.objectContaining({ eventType: 'release' }),
      );
      workspace.dispose();
      container.remove();
    }

    {
      const { workspace, actions, container } = fixture();
      pressCenter(workspace);
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'disconnected' } as never);
      expect(actions.sendMouse).toHaveBeenLastCalledWith(
        'pane-a',
        expect.objectContaining({ eventType: 'release' }),
      );
      workspace.dispose();
      container.remove();
    }

    const endListeners: Array<() => void> = [];
    const session = {
      addEventListener: (_type: string, listener: () => void) => endListeners.push(listener),
      end: vi.fn(async () =>
        endListeners.forEach((listener) => {
          listener();
        }),
      ),
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    fakeXR.presenting = true;
    const { workspace, actions, container } = fixture();
    await workspace.enterXR('vr');
    pressCenter(workspace);
    await workspace.exitXR();
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'release' }),
    );
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('owns the background selector only in World and closes it after selection', () => {
    const { workspace, container } = fixture();
    workspace.showInput('settings');
    hit(workspace, { inputAction: 'openInput', mode: 'world' });
    const world = workspace.scene.getObjectByName('xr-world-controls');
    if (!world) throw new Error('World missing');
    const menu = world.getObjectByName('background-options');
    expect(menu?.visible).toBe(false);
    hit(workspace, { inputAction: 'backgroundSelect', backgroundSelectOwner: 'input' });
    expect(menu?.visible).toBe(true);
    hit(workspace, { inputAction: 'background', background: 'gradient' });
    expect(workspace.state.background).toBe('gradient');
    expect(menu?.visible).toBe(false);
    const widths = menu?.children
      .filter((child) => child.userData.inputAction === 'background')
      .map((child) => child.userData.labelWidth);
    expect(widths).toHaveLength(3);
    expect(new Set(widths).size).toBe(1);
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    expect(hud?.children.some((child) => child.userData.inputAction === 'backgroundSelect')).toBe(
      false,
    );
    workspace.showInput('keyboard');
    expect(workspace.scene.getObjectByName('background-options')).toBeUndefined();
    workspace.dispose();
    container.remove();
  });

  it('keeps preferences in their owning panels and removes terminal key strips', () => {
    const { workspace, container } = fixture();
    for (const mode of [
      'keyboard',
      'commands',
      'panes',
      'arrange',
      'widgets',
      'settings',
      'display',
      'world',
      'terminal',
      'filtering',
    ] as const) {
      workspace.showInput(mode);
      const root = workspace.scene.getObjectByName(`xr-${mode}-controls`);
      if (!root) throw new Error(`Panel missing: ${mode}`);
      const actions = root.children.map((child) => child.userData.inputAction);
      expect(actions.includes('gazeInput')).toBe(mode === 'keyboard');
      expect(Boolean(root.getObjectByName('background-select'))).toBe(mode === 'world');
      expect(actions).not.toContain('mode');
      if (mode === 'commands') expect(actions).not.toContain('pane');
      expect(actions.includes('terminalColors')).toBe(mode === 'display');
      expect(actions.includes('glassOpacity')).toBe(mode === 'terminal');
    }
    expect(workspace.scene.getObjectByName('terminal-key-strip')).toBeUndefined();
    workspace.dispose();
    container.remove();
  });

  it('reuses a vacant slot when reopening a view', () => {
    const { workspace, left } = fixture();
    workspace.removeTerminal(left.pane.id);
    workspace.addTerminal(left);
    const reopened = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const other = workspace.scene.getObjectByName('terminal-panel-pane-b');
    expect(reopened?.position.x).toBeLessThan(other?.position.x ?? -Infinity);
    workspace.dispose();
  });

  it('reaches terminals placed beyond the default laser length', () => {
    const { workspace } = fixture();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!panel) throw new Error('Terminal missing');
    panel.position.set(0, 1.5, -12);
    panel.quaternion.identity();
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.set(0, 1.5, 0);
    controller.quaternion.identity();
    fakeXR.frame?.(16);
    expect(controller.userData.rayDistance).toBeCloseTo(12);
    const line = controller.children.find((child) => child instanceof THREE.Line);
    expect(line?.scale.z).toBeCloseTo(12 / 8);
    workspace.dispose();
  });

  it('uses one keyboard presentation for the current mode', () => {
    fakeXR.presenting = false;
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.showInput('keyboard');
    expect(actions.openKeyboard).toHaveBeenCalledTimes(1);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    workspace.showInput('panes');
    workspace.showInput('keyboard');
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

  it.each(['row', 'grid', 'arc', 'sphere'] as const)(
    'arranges %s around the current viewer without changing input, scale or terminal grids',
    (pattern) => {
      const { workspace, actions, container, left, right } = fixture();
      workspace.camera.position.set(2, 1.8, 3);
      workspace.camera.rotation.set(0.25, 0.7, 0);
      workspace.selectTerminal('pane-b');
      workspace.showInput('keyboard');
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const keyboardPosition = keyboard.position.clone();
      const target = workspace.state.inputTargetId;
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
      panel.scale.setScalar(1.3);
      panel.userData.fontZoom = 1.25;
      vi.clearAllMocks();
      workspace.arrangeTerminals(pattern);
      expect(workspace.state.arrangement).toBe(pattern);
      expect(workspace.state.selectedTerminalId).toBe('pane-b');
      expect(workspace.state.inputTargetId).toBe(target);
      expect(keyboard.position.distanceTo(keyboardPosition)).toBeLessThan(1e-9);
      expect(panel.scale.x).toBe(1.3);
      expect(panel.userData.fontZoom).toBe(1.25);
      for (const id of ['pane-a', 'pane-b']) {
        const root = workspace.scene.getObjectByName(`terminal-panel-${id}`) as THREE.Group;
        const visualCenter = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
        const towardEye = workspace.camera.position.clone().sub(visualCenter).normalize();
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
        expect(normal.dot(towardEye)).toBeGreaterThan(0.999);
      }
      expect(actions.selectPane).not.toHaveBeenCalled();
      expect(actions.resizeGrid).not.toHaveBeenCalled();
      expect(left.resizeGrid).not.toHaveBeenCalled();
      expect(right.resizeGrid).not.toHaveBeenCalled();
      expect(actions.sendKey).not.toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    },
  );

  it('routes the native Arrange menu and keeps the arranged panels grabbable', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('arrange');
    const menu = workspace.scene.getObjectByName('xr-arrange-controls') as THREE.Group;
    const position = menu.position.clone();
    hit(workspace, { inputAction: 'arrange', pattern: 'sphere' });
    expect(workspace.state.arrangement).toBe('sphere');
    expect(
      workspace.scene.getObjectByName('xr-arrange-controls')?.position.distanceTo(position),
    ).toBeLessThan(1e-9);
    workspace.hideInput();
    hit(workspace, { terminalTitle: true, terminalId: 'pane-b' }, 'squeezestart');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
    const start = panel.position.clone();
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(16);
    expect(panel.position.x - start.x).toBeCloseTo(0.2);
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('rebases both held controllers when an arrangement is applied', () => {
    const { workspace, container } = fixture();
    connectController(0);
    connectController(1);
    const first = fakeXR.controllers[0] as THREE.Group;
    const second = fakeXR.controllers[1] as THREE.Group;
    aimController(first, objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-a' }));
    aimController(
      second,
      objectWithData(workspace, { inputAction: 'closePane', terminalId: 'pane-a' }),
    );
    first.dispatchEvent({ type: 'squeezestart' } as never);
    second.dispatchEvent({ type: 'squeezestart' } as never);
    workspace.arrangeTerminals('grid');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
    const position = panel.position.clone();
    const orientation = panel.quaternion.clone();
    fakeXR.frame?.(0);
    fakeXR.frame?.(16);
    expect(panel.position.distanceTo(position)).toBeLessThan(1e-9);
    expect(panel.quaternion.angleTo(orientation)).toBeLessThan(1e-6);
    second.position.add(
      second.position.clone().sub(first.position).normalize().multiplyScalar(0.2),
    );
    fakeXR.frame?.(32);
    expect(panel.scale.x).toBeGreaterThan(1);
    second.dispatchEvent({ type: 'squeezeend' } as never);
    const handedOff = panel.position.clone();
    fakeXR.frame?.(48);
    expect(panel.position.distanceTo(handedOff)).toBeLessThan(1e-9);
    workspace.dispose();
    container.remove();
  });

  it('clears the native pattern highlight when recovery restores the default layout', () => {
    const { workspace, container } = fixture();
    workspace.showInput('arrange');
    hit(workspace, { inputAction: 'arrange', pattern: 'sphere' });
    const active = objectWithData(workspace, {
      inputAction: 'arrange',
      pattern: 'sphere',
    }) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(active.material.color.getHex()).toBe(0x68d6ff);
    workspace.resetLayout();
    expect(workspace.state.arrangement).toBeNull();
    const reset = objectWithData(workspace, {
      inputAction: 'arrange',
      pattern: 'sphere',
    }) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(reset.material.color.getHex()).toBe(0xffffff);
    workspace.dispose();
    container.remove();
  });

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
    expect(
      workspace.scene
        .getObjectByName('terminal-panel-pane-a')
        ?.getObjectByName('active-pane-highlight')?.visible,
    ).toBe(true);
    expect(
      workspace.scene
        .getObjectByName('terminal-panel-pane-b')
        ?.getObjectByName('active-pane-highlight')?.visible,
    ).toBe(false);
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
    hit(workspace, { inputAction: 'exit' });
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(workspace.getTerminalCurvature('pane-a')).toBe(0);
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
    fakeXR.frame?.(1200);
    const curve = workspace.getTerminalCurvature('pane-a');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!panel) throw new Error('Pane A missing');
    const position = panel.position.clone();
    hit(workspace, { terminalTitle: true, terminalId: 'pane-a' }, 'squeezestart');
    const left = fakeXR.controllers[0] as THREE.Group;
    left.position.x += 0.2;
    fakeXR.frame?.(1300);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(curve);
    expect(panel.position.x).toBeCloseTo(position.x + 0.2);
    left.dispatchEvent({ type: 'squeezeend' } as never);
    fakeXR.frame?.(1400);
    expect(workspace.getTerminalCurvature('pane-a')).toBeGreaterThan(curve);
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

  it('previews the aimed pane without persistence or UI broadcasts and saves with A', () => {
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
    const originalStorage = localStorage.getItem('mux-xr:terminal-warp:v1');
    const changed = vi.fn();
    const stop = workspace.subscribe(changed);
    (gamepad.axes as number[])[2] = 1;
    fakeXR.frame?.(8200);
    const preview = workspace.getTerminalCurvature('pane-b');
    expect(preview).toBeGreaterThan(0);
    expect(localStorage.getItem('mux-xr:terminal-warp:v1')).toBe(originalStorage);
    expect(changed).not.toHaveBeenCalled();
    (gamepad.axes as number[])[2] = 0;
    (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(8300);
    fakeXR.frame?.(8400);
    (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(8416);
    expect(workspace.state.warpTerminalId).toBeNull();
    expect(workspace.state.radialOpen).toBe(false);
    expect(workspace.getTerminalCurvature('pane-b')).toBe(preview);
    expect(localStorage.getItem('mux-xr:terminal-warp:v1')).not.toBe(originalStorage);
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
    expect(right.setRenderQuality).toHaveBeenLastCalledWith('full');
    expect(workspace.state.renderGazeTerminalId).toBe('pane-b');
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    expect(workspace.state.gazeInputEnabled).toBe(false);
    expect(actions.resizeGrid).not.toHaveBeenCalled();
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

  it('uses new-window opacity without changing open panes or saved overrides', () => {
    const { workspace, container } = fixture();
    workspace.setTerminalOpacity('pane-a', 0.7);
    workspace.setWindowPreferences({ defaultOpacity: 0.4, focusDistance: 1.5, focusCurvature: 0 });
    expect(workspace.getTerminalOpacity('pane-a')).toBe(0.7);
    expect(workspace.getTerminalOpacity('pane-b')).toBe(1);
    workspace.addTerminal(surface(pane('pane-c')));
    expect(workspace.getTerminalOpacity('pane-c')).toBe(0.4);
    workspace.removeTerminal('pane-a');
    workspace.addTerminal(surface(pane('pane-a')));
    expect(workspace.getTerminalOpacity('pane-a')).toBe(0.7);
    workspace.dispose();
    container.remove();
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
    workspace.setWindowPreferences({ defaultOpacity: 0.4, focusDistance: 2.2, focusCurvature: 40 });
    for (let frame = 20; frame < 40; frame++) fakeXR.frame?.(frame * 20);
    checkDistance(2.2);
    expect(root.userData.curvatureDegrees).toBe(40);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(65);
    expect(localStorage.getItem('mux-xr:terminal-warp:v1')).toBe(stored);
    workspace.toggleFocusMode();
    expect(root.userData.curvatureDegrees).toBe(65);
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
