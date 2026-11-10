const handPoses = vi.hoisted(() => ({ count: 0, probeReads: 0 }));
vi.mock('../src/xr/labels', () => import('./helpers/labels'));
vi.mock('../src/xr/standard-hand', async () => {
  const { createCartoonHand } = await import('../src/xr/cartoon-hand');
  return {
    createStandardHand: (...args: Parameters<typeof createCartoonHand>) => {
      const hand = createCartoonHand(...args);
      const update = hand.update.bind(hand);
      hand.update = (...pose: Parameters<typeof hand.update>) => {
        handPoses.count++;
        update(...pose);
      };
      const probes = hand.contactProbes;
      return Object.defineProperty(hand, 'contactProbes', {
        get: () => {
          handPoses.probeReads++;
          return probes;
        },
      });
    },
  };
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeXR = vi.hoisted(() => ({
  controllers: [] as unknown[],
  hands: [] as unknown[],
  presenting: false,
  camera: null as unknown,
  frame: null as ((time: number, frame?: unknown) => void) | null,
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
      getReferenceSpace: () => ({}),
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

function fixture(options?: Parameters<typeof createWorkspaceScene>[2]) {
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
  const workspace = createWorkspaceScene(container, actions, options);
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
    buttons: Array.from({ length: 8 }, () => ({ pressed: false })),
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
    localStorage.removeItem('mux-xr:ui-poses:v2');
    localStorage.removeItem('mux-xr:widget-poses:v2');
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
    const setup = (
      keyborbMode: 'off' | 'on' | 'auto' = 'off',
      options?: Parameters<typeof fixture>[0],
    ) => {
      const value = fixture(options);
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
    ): void => contactControl(workspace, hand, { inputAction: 'key', key }, depth, time);
    const contactControl = (
      workspace: ReturnType<typeof createWorkspaceScene>,
      hand: Hand,
      data: Record<string, unknown>,
      depth: number,
      time: number,
    ): void => {
      const button = objectWithData(workspace, data);
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

    // Index and thumb tips straddle the node; the middle finger stays clear of a grab pinch.
    const pinchAt = (hand: Hand, point: THREE.Vector3, gap: number, time: number): void => {
      hand.joints.wrist.position.copy(point).add(new THREE.Vector3(0, -0.12, 0.1));
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0, gap / 2, 0.02));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(0, -gap / 2, 0.02));
      hand.joints['middle-finger-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new THREE.Vector3(0.05, 0.17, 0));
      fakeXR.frame?.(time);
    };

    it('selects a hierarchy pane node with a touch pinch and swallows its native select', () => {
      const { workspace, actions } = setup('off');
      connectController(0);
      workspace.showInput('panes');
      for (const title of ['Workspace', 'Session', 'Window']) {
        hit(workspace, { inputAction: 'hierarchyNode', originalTitle: title });
        for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(100 + frame * 16);
      }
      vi.mocked(actions.selectPane).mockClear();
      const hand = connectHand();
      const node = objectWithData(workspace, { inputAction: 'pane', paneId: 'pane-b' });
      workspace.scene.updateMatrixWorld(true);
      const point = node.getWorldPosition(new THREE.Vector3());
      pinchAt(hand, point, 0.08, 1000);
      pinchAt(hand, point, 0.08, 1016);
      expect(workspace.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(true);
      pinchAt(hand, point, 0.02, 1032);
      nativeEvent(0, 'selectstart');
      expect(actions.selectPane).not.toHaveBeenCalled();
      pinchAt(hand, point, 0.08, 1048);
      nativeEvent(0, 'selectend');
      expect(actions.selectPane).toHaveBeenCalledTimes(1);
      expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
      expect(workspace.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(false);
    });

    it('grabs the whole hierarchy with a hand closed at a non-pane node', () => {
      const { workspace } = setup('off');
      connectController(0);
      workspace.showInput('panes');
      const hand = connectHand();
      const node = objectWithData(workspace, {
        inputAction: 'hierarchyNode',
        originalTitle: 'Session',
      });
      workspace.scene.updateMatrixWorld(true);
      // Within pinch reach of the node but clear of the fingertip and palm contact probes.
      const mesh = node as THREE.Mesh;
      mesh.geometry.computeBoundingSphere();
      const bounds = (mesh.geometry.boundingSphere as THREE.Sphere)
        .clone()
        .applyMatrix4(mesh.matrixWorld);
      const point = bounds.center.clone().add(new THREE.Vector3(0, 0, bounds.radius + 0.06));
      pinchAt(hand, point, 0.08, 1000);
      expect(workspace.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(true);
      const root = workspace.scene.getObjectByName('hierarchy-navigator')?.parent;
      const before = root?.position.clone() ?? new THREE.Vector3();
      pinch(hand, true);
      fakeXR.frame?.(1016);
      expect(workspace.scene.getObjectByName('pane-pull-proxy')).toBeUndefined();
      for (const joint of Object.values(hand.joints)) joint.position.x += 0.3;
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(1032 + frame * 16);
      expect(root?.position.distanceTo(before)).toBeGreaterThan(0.2);
    });

    it('ignores a hierarchy pinch that closed away from every node', () => {
      const { workspace, actions } = setup('off');
      connectController(0);
      workspace.showInput('panes');
      const hand = connectHand();
      const node = objectWithData(workspace, {
        inputAction: 'hierarchyNode',
        originalTitle: 'Session',
      });
      workspace.scene.updateMatrixWorld(true);
      const point = node.getWorldPosition(new THREE.Vector3());
      const path = workspace.scene.getObjectByName('hierarchy-navigator')?.userData.hierarchyPath;
      pinchAt(hand, point.clone().add(new THREE.Vector3(0, 0.4, 0)), 0.02, 1000);
      pinchAt(hand, point, 0.02, 1016);
      pinchAt(hand, point, 0.08, 1032);
      expect(
        workspace.scene.getObjectByName('hierarchy-navigator')?.userData.hierarchyPath,
      ).toEqual(path);
      expect(actions.selectPane).not.toHaveBeenCalled();
    });

    it('uses the native controller ray despite stray palm metadata', () => {
      const { workspace } = setup('off');
      connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const visual = workspace.scene.getObjectByName('xr-cartoon-hand');
      const line = controller.children.find((child) => child instanceof THREE.Line) as THREE.Line;
      if (!visual || !line) throw new Error('Tracked hand ray fixtures missing');
      const palmPosition = new THREE.Vector3(0.42, 1.18, -0.72);
      const palmNormal = new THREE.Vector3(0.6, 0.2, -0.77).normalize();
      visual.userData.renderedPalmPosition = palmPosition;
      visual.userData.renderedPalmDirection = palmNormal;
      controller.position.set(-0.3, 0.8, 0.4);
      controller.rotation.set(0.2, -0.35, 0.1);
      controller.scale.set(1.7, 0.8, 1.3);
      fakeXR.frame?.(32);
      const nativeOrigin = controller.getWorldPosition(new THREE.Vector3());
      const nativeDirection = controller.getWorldDirection(new THREE.Vector3());
      expect(line.getWorldPosition(new THREE.Vector3()).distanceTo(nativeOrigin)).toBeLessThan(
        1e-6,
      );
      expect(line.getWorldDirection(new THREE.Vector3()).distanceTo(nativeDirection)).toBeLessThan(
        1e-6,
      );
    });

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

    it('renders all 68 spherical keys and keeps them spherical on a curved keyboard', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      workspace.setKeyboardCurvature(60);
      const root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const keys = root.children.filter((child) => child.userData.inputAction === 'key');
      expect(keys).toHaveLength(68);
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
      expect(actions.sendKey).not.toHaveBeenCalled();
      expect(
        (orb as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>).material.uniforms.pressed
          .value,
      ).toBe(1);
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.04, 0, 0));
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(100 + frame * 16);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      const rebuiltOrb = objectWithData(workspace, { inputAction: 'key', key: 'a' }) as THREE.Mesh<
        THREE.SphereGeometry,
        THREE.ShaderMaterial
      >;
      expect(rebuiltOrb.material.uniforms.pressed.value).toBeGreaterThan(0);
      for (let frame = 0; frame < 20; frame++) fakeXR.frame?.(170 + frame * 16);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hand.joints['index-finger-tip'].position.x += 0.08;
      fakeXR.frame?.(500);
      expect(rebuiltOrb.material.uniforms.pressed.value).toBe(0);
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

    it('poses a tracked hand once per frame however often keyboard proximity is checked', () => {
      const { workspace } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const key = objectWithData(workspace, { inputAction: 'key', key: 'g' });
      const point = key.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 0.05));
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.04, 0, 0));
      fakeXR.frame?.(20);
      const before = handPoses.count;
      fakeXR.frame?.(40);
      expect(handPoses.count - before).toBe(1);
      const visual = workspace.scene.children.find(
        (object) => object.name === 'xr-cartoon-hand' && object.userData.handedness === 'right',
      );
      if (!visual) throw new Error('Hand visual missing');
      const tip = (): number => (visual.userData.indexTip as THREE.Vector3).x;
      const framed = tip();
      // three moves the joints to the event's own frame before dispatching it.
      hand.joints['index-finger-tip'].position.x += 0.05;
      nativeEvent(0, 'selectstart');
      expect(tip() - framed).toBeCloseTo(0.05, 3);
      nativeEvent(0, 'selectend');
      const events = handPoses.count;
      fakeXR.frame?.(60);
      expect(handPoses.count - events).toBe(1);
    });

    it('targets the rendered finger midpoint while using tracked separation for the pinch', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const rawKey = objectWithData(workspace, { inputAction: 'key', key: 'a' });
      const visibleKey = objectWithData(workspace, { inputAction: 'key', key: 'b' });
      const rawPoint = rawKey.getWorldPosition(new THREE.Vector3());
      const visiblePoint = visibleKey
        .getWorldPosition(new THREE.Vector3())
        .add(new THREE.Vector3(0, 0, 0.06));
      const visual = workspace.scene.children.find(
        (object) => object.name === 'xr-cartoon-hand' && object.userData.handedness === 'right',
      );
      if (!visual) throw new Error('Hand visual missing');
      visual.userData.keyborbPoint = visiblePoint;
      hand.joints['index-finger-tip'].position.copy(rawPoint).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(rawPoint).add(new THREE.Vector3(-0.04, 0, 0));
      fakeXR.frame?.(20);
      hand.joints['index-finger-tip'].position.copy(rawPoint).add(new THREE.Vector3(0.02, 0, 0));
      hand.joints['thumb-tip'].position.copy(rawPoint).add(new THREE.Vector3(-0.02, 0, 0));
      fakeXR.frame?.(40);
      expect(actions.sendKey).not.toHaveBeenCalled();
      hand.joints['index-finger-tip'].position.copy(rawPoint).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(rawPoint).add(new THREE.Vector3(-0.04, 0, 0));
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(60 + frame * 20);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('b', undefined);
    });

    it('starts and stops dictation from a pinch on the Keyborb Mic orb', () => {
      const { workspace, actions } = setup('on');
      const dictationAction = vi.fn();
      actions.dictationAction = dictationAction;
      const idle = { supported: true, status: 'idle', transcript: '', error: null } as const;
      workspace.setDictationState(idle);
      workspace.showInput('keyboard');
      const hand = connectHand();
      const pinchOrb = (start: number): void => {
        const mic = workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh;
        const point = mic.getWorldPosition(new THREE.Vector3());
        const spread = (gap: number): void => {
          hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(gap, 0, 0));
          hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-gap, 0, 0));
        };
        const before = dictationAction.mock.calls.length;
        spread(0.04);
        fakeXR.frame?.(start);
        spread(0.02);
        fakeXR.frame?.(start + 20);
        expect(dictationAction).toHaveBeenCalledTimes(before);
        spread(0.04);
        for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(start + 40 + frame * 20);
      };
      const mic = workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh;
      expect(mic.geometry).toBeInstanceOf(THREE.SphereGeometry);
      expect(mic.userData.labelText).toBe('Mic');
      pinchOrb(20);
      expect(dictationAction).toHaveBeenCalledExactlyOnceWith('start');
      expect(actions.sendKey).not.toHaveBeenCalled();
      workspace.setDictationState({ ...idle, status: 'listening' });
      expect(
        (workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh).userData.labelText,
      ).toBe('Stop');
      pinchOrb(400);
      expect(dictationAction).toHaveBeenLastCalledWith('stop');
      expect(dictationAction).toHaveBeenCalledTimes(2);
      workspace.setDictationState({ ...idle, status: 'transcribing' });
      expect(
        (workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh).userData.inputAction,
      ).toBe('noop');
    });

    it('draws all orb shells in one instanced call that follows the orbs', () => {
      const { workspace } = setup('on');
      workspace.showInput('keyboard');
      connectHand();
      fakeXR.frame?.(16);
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const orbs = keyboard.children.filter(
        (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> =>
          child.userData.keyborb === true,
      );
      const shells = keyboard.getObjectByName('keyborb-shells') as THREE.InstancedMesh;
      expect(orbs.length).toBeGreaterThan(60);
      expect(shells.count).toBe(orbs.length);
      expect(keyboard.getObjectByName('keyborb-glyphs')).toBeDefined();
      for (const orb of orbs) expect(orb.material.visible).toBe(false);
      const index = orbs.findIndex((orb) => orb.userData.key === 'g');
      orbs[index].material.uniforms.pressed.value = 1;
      fakeXR.frame?.(32);
      const pressed = shells.geometry.getAttribute('instancePressed') as THREE.BufferAttribute;
      expect(pressed.getX(index)).toBe(1);
      const matrix = new THREE.Matrix4();
      shells.getMatrixAt(index, matrix);
      expect(
        new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(orbs[index].position),
      ).toBeLessThan(1e-6);
    });

    it('drops the panel Dictation button when the Keyborb Mic orb is shown', () => {
      const idle = { supported: true, status: 'idle', transcript: '', error: null } as const;
      const orb = setup('on');
      orb.workspace.setDictationState(idle);
      orb.workspace.showInput('keyboard');
      connectHand();
      fakeXR.frame?.(16);
      expect(orb.workspace.scene.getObjectByName('keyborb-dictation')).toBeDefined();
      expect(orb.workspace.scene.getObjectByName('xr-dictate-button')).toBeUndefined();
      const headings = () => {
        let count = 0;
        orb.workspace.scene.traverse((object) => {
          if (object.name === 'xr-dictation-transcript-heading') count += 1;
        });
        return count;
      };
      expect(headings()).toBe(0);
      orb.workspace.setDictationState({ ...idle, status: 'review', transcript: 'hello' });
      expect(orb.workspace.scene.getObjectByName('xr-dictate-button')).toBeUndefined();
      expect(headings()).toBe(1);
      orb.workspace.setDictationState({ ...idle, status: 'review', transcript: 'hello there' });
      expect(headings()).toBe(1);
      const insert = [] as THREE.Object3D[];
      orb.workspace.scene.traverse((object) => {
        if (object.userData.dictationAction === 'insert') insert.push(object);
      });
      expect(insert).toHaveLength(1);
      orb.workspace.setDictationState(idle);
      expect(headings()).toBe(0);
      orb.workspace.dispose();
      orb.container.remove();
      const flat = setup('off');
      flat.workspace.setDictationState(idle);
      flat.workspace.showInput('keyboard');
      expect(flat.workspace.scene.getObjectByName('xr-dictate-button')?.userData.labelText).toBe(
        'Dictation',
      );
    });

    it('scrolls from a hand index pinch on the edge strip and stops when Focus changes', () => {
      const { workspace, actions } = setup('off');
      actions.scrollTerminal = vi.fn(() => true);
      connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const strip = workspace.scene
        .getObjectByName('terminal-panel-pane-b')
        ?.getObjectByName('terminal-scroll-strip') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      const rest = strip.material.opacity;
      const line = 0.8 / 24;
      const aim = (y: number, time: number): void => {
        aimControllerAtScreen(controller, strip, new THREE.Vector3(0, y, 0));
        fakeXR.frame?.(time);
      };
      aim(0, 10);
      nativeEvent(0, 'selectstart');
      aim(-line * 0.6, 20);
      aim(-line * 2.7, 30);
      expect(actions.scrollTerminal).toHaveBeenCalledExactlyOnceWith('pane-b', -2);
      expect(strip.material.opacity).toBeGreaterThan(rest);
      expect(workspace.state.selectedTerminalId).toBe('pane-b');
      workspace.toggleFocusMode('pane-b');
      aim(-line * 9, 40);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
      expect(strip.material.opacity).toBe(rest);
    });

    it('offers the Mic orb only on a Keyborb text keyboard with speech support', () => {
      const { workspace } = setup('off');
      workspace.showInput('keyboard');
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeUndefined();
      workspace.setDictationState({ supported: true, status: 'idle', transcript: '', error: null });
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeUndefined();
      workspace.setKeyborbMode('on');
      workspace.showInput('keyboard');
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeDefined();
      workspace.setDictationState({
        supported: false,
        status: 'idle',
        transcript: '',
        error: null,
      });
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeUndefined();
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
      expect(actions.sendKey).not.toHaveBeenCalled();
      hit(workspace, { inputAction: 'key', key: 'a' });
      fakeXR.frame?.(60);
      expect(actions.sendKey).not.toHaveBeenCalled();
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hit(workspace, { inputAction: 'key', key: 'a' });
      fakeXR.frame?.(80);
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).toHaveBeenCalledTimes(1);
    });

    it('does not type a native Keyborb release while the other hand grabs a window', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const point = objectWithData(workspace, { inputAction: 'key', key: 'a' }).getWorldPosition(
        new THREE.Vector3(),
      );
      hand.joints['index-finger-tip'].position.copy(point);
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.07, 0, 0));
      fakeXR.frame?.(20);
      hit(workspace, { inputAction: 'key', key: 'a' });
      const other = fakeXR.controllers[1] as THREE.Group;
      aimController(other, objectWithData(workspace, { terminalId: 'pane-b' }));
      other.dispatchEvent({ type: 'squeezestart' } as never);
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).not.toHaveBeenCalled();
    });

    const holdKeyborbA = (workspace: ReturnType<typeof createWorkspaceScene>, hand: Hand) => {
      const orb = objectWithData(workspace, { inputAction: 'key', key: 'a' });
      const point = orb.getWorldPosition(new THREE.Vector3());
      const spread = (gap: number): void => {
        hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(gap, 0, 0));
        hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-gap, 0, 0));
      };
      spread(0.04);
      fakeXR.frame?.(80);
      spread(0.02);
      fakeXR.frame?.(90);
      expect(
        (orb as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>).material.uniforms.pressed
          .value,
      ).toBe(1);
      return spread;
    };

    it.each(['thumb-tip', 'index-finger-tip', 'wrist', 'middle-finger-tip'])(
      'keeps a held Keyborb key through a brief %s tracking dropout',
      (joint) => {
        const { workspace, actions } = setup('auto');
        workspace.showInput('keyboard');
        const hand = connectHand();
        const spread = holdKeyborbA(workspace, hand);
        hand.joints[joint].visible = false;
        fakeXR.frame?.(106);
        fakeXR.frame?.(122);
        hand.joints[joint].visible = true;
        fakeXR.frame?.(138);
        expect(actions.sendKey).not.toHaveBeenCalled();
        spread(0.04);
        for (let frame = 0; frame < 6; frame++) fakeXR.frame?.(160 + frame * 16);
        expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      },
    );

    it('types a held Keyborb key when the native release lands in a tracking gap', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      holdKeyborbA(workspace, hand);
      hit(workspace, { inputAction: 'key', key: 'a' });
      hand.joints['thumb-tip'].visible = false;
      fakeXR.frame?.(106);
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hand.joints['thumb-tip'].visible = true;
      for (let frame = 0; frame < 6; frame++) fakeXR.frame?.(122 + frame * 16);
      expect(actions.sendKey).toHaveBeenCalledOnce();
    });

    it('drops a held Keyborb key when tracking stays lost past the grace', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const spread = holdKeyborbA(workspace, hand);
      hand.joints['thumb-tip'].visible = false;
      for (let frame = 0; frame < 12; frame++) fakeXR.frame?.(106 + frame * 16);
      hand.joints['thumb-tip'].visible = true;
      spread(0.04);
      for (let frame = 0; frame < 6; frame++) fakeXR.frame?.(320 + frame * 16);
      expect(actions.sendKey).not.toHaveBeenCalled();
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
        hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(-gap / 2, 0, 0));
        hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(gap / 2, 0, 0));
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
      expect(actions.sendKey).not.toHaveBeenCalled();
      for (let frame = 0; frame < 3; frame++) pose('b', 0.08, 950 + frame * 20);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('b', { shift: true });
      pose('b', 0.04, 1020);
      workspace.selectTerminal('pane-b');
      for (let frame = 0; frame < 3; frame++) pose('b', 0.08, 1040 + frame * 20);
      expect(actions.sendKey).toHaveBeenCalledTimes(1);
      pose('b', 0.04, 1120);
      for (let frame = 0; frame < 3; frame++) pose('b', 0.08, 1140 + frame * 20);
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
          hand.joints['index-finger-tip'].position
            .copy(points[index])
            .add(new THREE.Vector3(-gap / 2, 0, 0));
          hand.joints['thumb-tip'].position
            .copy(points[index])
            .add(new THREE.Vector3(gap / 2, 0, 0));
          hand.joints['middle-finger-tip'].position
            .copy(hand.joints['thumb-tip'].position)
            .add(new THREE.Vector3(0, 0.12, 0));
        }
      };
      pose(0.08);
      fakeXR.frame?.(100);
      pose(0.04);
      fakeXR.frame?.(120);
      expect(actions.sendKey).not.toHaveBeenCalled();
      pose(0.08);
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(140 + frame * 20);
      expect(vi.mocked(actions.sendKey).mock.calls).toEqual([
        ['a', undefined],
        ['b', undefined],
      ]);
      fakeXR.frame?.(240);
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

    it.each(['off', 'on'] as const)(
      'pokes the raised Close button once with Keyborb %s and ignores a hovering fingertip',
      (keyborbMode) => {
        const play = vi.fn();
        const { workspace } = setup(keyborbMode, { feedback: { play, dispose: vi.fn() } });
        workspace.showInput('keyboard');
        const hand = connectHand(0);
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        expect(workspace.state.keyborbEnabled).toBe(keyborbMode === 'on');
        const close = { inputAction: 'close' };
        expect(objectWithData(workspace, close).userData.raisedButton).toBe(true);
        contactControl(workspace, hand, close, 0.06, 20);
        for (let frame = 0; frame < 4; frame++)
          contactControl(workspace, hand, close, 0.025, 40 + frame * 20);
        expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
        expect(play).not.toHaveBeenCalled();
        contactControl(workspace, hand, close, 0.004, 140);
        expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
        expect(play.mock.calls.map(([kind]) => kind)).toEqual(['select']);
      },
    );

    it.each(['off', 'on'] as const)(
      'toggles a raised panel button once per held poke with Keyborb %s',
      (keyborbMode) => {
        const { workspace, actions } = setup(keyborbMode);
        workspace.showInput('keyboard');
        const hand = connectHand(0);
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        const backing = { inputAction: 'keyboardBackground' };
        contactControl(workspace, hand, backing, 0.06, 20);
        for (let frame = 0; frame < 6; frame++)
          contactControl(workspace, hand, backing, 0.004, 40 + frame * 20);
        expect(workspace.state.keyboardBackgroundEnabled).toBe(false);
        contactControl(workspace, hand, backing, 0.06, 200);
        contactControl(workspace, hand, backing, 0.004, 220);
        expect(workspace.state.keyboardBackgroundEnabled).toBe(true);
        expect(actions.sendKey).not.toHaveBeenCalled();
      },
    );

    it('keeps the press-twice confirm on a poked Keyborb strip command', () => {
      vi.useFakeTimers();
      try {
        const { workspace, actions } = setup('on');
        const risky = {
          id: 'risky',
          label: 'risky',
          text: 'echo risky',
          sendNewline: true,
          pinned: true,
          confirm: true,
        };
        workspace.setQuickCommands([risky]);
        workspace.showInput('keyboard');
        const hand = connectHand(0);
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        const strip = { inputAction: 'stripCommand', commandId: 'risky' };
        contactControl(workspace, hand, strip, 0.06, 20);
        contactControl(workspace, hand, strip, 0.004, 40);
        expect(actions.runCommand).not.toHaveBeenCalled();
        expect(objectWithData(workspace, strip).userData.armed).toBe(true);
        vi.advanceTimersByTime(400);
        contactControl(workspace, hand, strip, 0.06, 60);
        contactControl(workspace, hand, strip, 0.004, 80);
        expect(actions.runCommand).toHaveBeenCalledExactlyOnceWith(risky, 'pane-a');
      } finally {
        vi.useRealTimers();
      }
    });

    it('pokes a raised button with a controller-held hand but never pokes a Keyborb orb', () => {
      const { workspace, actions } = setup('on');
      connectController(0);
      workspace.showInput('keyboard');
      const controller = fakeXR.controllers[0] as THREE.Group;
      fakeXR.frame?.(10);
      const visual = objectWithData(workspace, { handedness: 'right' });
      const touch = (data: Record<string, unknown>, depth: number, time: number): void => {
        const button = objectWithData(workspace, data);
        workspace.scene.updateMatrixWorld(true);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          button.getWorldQuaternion(new THREE.Quaternion()),
        );
        const point = button.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, depth);
        controller.position.add(point.sub(visual.userData.indexTip as THREE.Vector3));
        fakeXR.frame?.(time);
      };
      const key = { inputAction: 'key', key: 'a' };
      touch(key, 0.06, 20);
      touch(key, 0.06, 40);
      touch(key, 0.004, 60);
      touch(key, -0.02, 80);
      expect(actions.sendKey).not.toHaveBeenCalled();
      const close = { inputAction: 'close' };
      touch(close, 0.06, 100);
      touch(close, 0.06, 120);
      touch(close, 0.004, 140);
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    });

    it('keeps a poked Backing button sunk across its rebuild, then eases it back', () => {
      const { workspace } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand(0);
      (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
      const backing = { inputAction: 'keyboardBackground' };
      const rest = objectWithData(workspace, backing).position.z;
      contactControl(workspace, hand, backing, 0.06, 20);
      contactControl(workspace, hand, backing, 0.004, 40);
      expect(workspace.state.keyboardBackgroundEnabled).toBe(false);
      fakeXR.frame?.(60);
      const rebuilt = objectWithData(workspace, backing);
      expect(rebuilt.position.z).toBeLessThan(rest - 0.01);
      fakeXR.frame?.(200);
      expect(rebuilt.position.z).toBeLessThan(rest - 0.001);
      fakeXR.frame?.(300);
      expect(rebuilt.position.z).toBeCloseTo(rest);
    });

    it('bends the raised walls with the face on a curved keyboard', () => {
      const { workspace } = setup('off');
      workspace.showInput('keyboard');
      workspace.setKeyboardCurvature(60);
      const paste = objectWithData(workspace, { inputAction: 'pasteClipboard' }) as THREE.Mesh;
      const root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const merged = root.getObjectByName('xr-button-walls') as THREE.Mesh;
      paste.geometry.computeBoundingBox();
      const face = paste.geometry.boundingBox as THREE.Box3;
      paste.updateMatrix();
      const toFace = paste.matrix.clone().invert();
      const positions = merged.geometry.getAttribute('position');
      const point = new THREE.Vector3();
      const walls = new THREE.Box3();
      const halfWidth = Number(paste.userData.labelWidth) / 2 + 1e-4;
      const halfHeight = Number(paste.userData.labelHeight) / 2 + 1e-4;
      for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index).applyMatrix4(toFace);
        if (Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight && point.z > -0.05)
          walls.expandByPoint(point);
      }
      expect(face.max.z).toBeGreaterThan(0.005);
      expect(walls.max.z).toBeGreaterThan(face.max.z - 0.003);
      expect(walls.min.z).toBeLessThan(-0.025);
    });

    it('raises keyboard panel controls with depth and keeps ray hover and select', () => {
      const { workspace } = setup('on');
      connectController(0);
      workspace.showInput('keyboard');
      for (const data of [
        { inputAction: 'close' },
        { inputAction: 'keyboardBackground' },
        { inputAction: 'gazeInput' },
        { inputAction: 'keyboardCurvature', delta: 10 },
        { inputAction: 'pasteClipboard' },
      ]) {
        const button = objectWithData(workspace, data) as THREE.Mesh;
        expect(button.userData.raisedButton, JSON.stringify(data)).toBe(true);
        expect(button.position.z).toBeGreaterThan(0.02);
      }
      expect(
        objectWithData(workspace, { inputAction: 'key', key: 'a' }).userData.raisedButton,
      ).toBe(undefined);
      const root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const walls: THREE.Object3D[] = [];
      root.traverse((object) => {
        if (object.name === 'xr-button-walls') walls.push(object);
      });
      expect(walls).toHaveLength(1);
      expect(walls[0].parent).toBe(root);
      const raycast = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
      expect(raycast.intersectObject(walls[0])).toEqual([]);
      const close = objectWithData(workspace, { inputAction: 'close' }) as THREE.Mesh;
      aimController(fakeXR.controllers[0] as THREE.Group, close);
      workspace.scene.updateMatrixWorld(true);
      fakeXR.frame?.(20);
      expect((close.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(0xffffff);
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
      const paste = objectWithData(workspace, { inputAction: 'pasteClipboard' });
      const rest = paste.position.z;
      hit(workspace, { inputAction: 'pasteClipboard' });
      expect(paste.position.z).toBeLessThan(rest - 0.01);
      fakeXR.frame?.(400);
      expect(paste.position.z).toBeCloseTo(rest);
      const disposeWalls = vi.spyOn((walls[0] as THREE.Mesh).geometry, 'dispose');
      hit(workspace, { inputAction: 'close' });
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
      expect(disposeWalls).toHaveBeenCalledOnce();
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

    it('reels a far hand-grabbed window in as the wrist pulls toward the head', () => {
      const { workspace } = setup();
      const hand = connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const panel = objectWithData(workspace, { terminalId: 'pane-a' }) as THREE.Group;
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const wrist = head.clone().add(new THREE.Vector3(0.1, -0.3, -0.45));
      const shift = wrist.clone().sub(hand.joints.wrist.position);
      for (const joint of Object.values(hand.joints)) joint.position.add(shift);
      aimController(controller, panel, 2);
      fakeXR.frame?.(10);
      const before = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      pinch(hand, true);
      fakeXR.frame?.(20);
      const pull = head.clone().sub(wrist).multiplyScalar(0.5);
      for (const joint of Object.values(hand.joints)) joint.position.add(pull);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(40 + frame * 16);
      const after = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      expect(after).toBeLessThan(before * 0.65);
      pinch(hand, false);
      fakeXR.frame?.(800);
    });

    const farHandGrab = (workspace: ReturnType<typeof createWorkspaceScene>) => {
      const hand = connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const panel = objectWithData(workspace, { terminalId: 'pane-a' }) as THREE.Group;
      const camera = fakeXR.camera as THREE.Object3D;
      const head = camera.getWorldPosition(new THREE.Vector3());
      const wrist = head.clone().add(new THREE.Vector3(0.1, -0.3, -0.45));
      const shift = wrist.clone().sub(hand.joints.wrist.position);
      for (const joint of Object.values(hand.joints)) joint.position.add(shift);
      aimController(controller, panel, 2);
      fakeXR.frame?.(10);
      const before = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      pinch(hand, true);
      fakeXR.frame?.(20);
      return { hand, controller, panel, camera, head, wrist, before };
    };

    it('carries a far hand-grabbed window at its distance while walking', () => {
      const { workspace } = setup();
      const { hand, controller, panel, camera, before } = farHandGrab(workspace);
      const start = camera.position.clone();
      cleanups.push(() => {
        camera.position.copy(start);
        camera.updateMatrixWorld(true);
      });
      const step = new THREE.Vector3(0, 0, -0.6);
      for (const joint of Object.values(hand.joints)) joint.position.add(step);
      controller.position.add(step);
      camera.position.add(step);
      camera.updateMatrixWorld(true);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(40 + frame * 16);
      const head = camera.getWorldPosition(new THREE.Vector3());
      const after = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      expect(Math.abs(after - before)).toBeLessThan(before * 0.03);
      pinch(hand, false);
      fakeXR.frame?.(800);
    });

    it.each([90, -90])(
      'keeps a far hand-grabbed window distance through a %i degree body turn',
      (degrees) => {
        const { workspace } = setup();
        const { hand, controller, panel, camera, head, before } = farHandGrab(workspace);
        const start = camera.quaternion.clone();
        cleanups.push(() => {
          camera.quaternion.copy(start);
          camera.updateMatrixWorld(true);
        });
        const axis = new THREE.Vector3(0, 1, 0);
        const step = THREE.MathUtils.degToRad(degrees / 9);
        const yaw = new THREE.Quaternion().setFromAxisAngle(axis, step);
        for (let turn = 0; turn < 9; turn++) {
          for (const object of [...Object.values(hand.joints), controller]) {
            object.position.sub(head).applyAxisAngle(axis, step).add(head);
            object.quaternion.premultiply(yaw);
          }
          camera.quaternion.premultiply(yaw);
          camera.updateMatrixWorld(true);
          for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(40 + turn * 64 + frame * 16);
        }
        for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(700 + frame * 16);
        const after = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
        expect(Math.abs(after - before)).toBeLessThan(before * 0.03);
        pinch(hand, false);
        fakeXR.frame?.(1300);
      },
    );

    it('keeps a far hand-grabbed window depth through a sideways arm sweep', () => {
      const { workspace } = setup();
      const { hand, panel, head, wrist } = farHandGrab(workspace);
      const offset = panel.getWorldPosition(new THREE.Vector3()).sub(wrist).length();
      // Sweep the wrist 25 degrees across the body around a shoulder beside the head.
      const shoulder = head.clone().add(new THREE.Vector3(0.18, -0.25, 0));
      const arm = wrist.clone().sub(shoulder);
      const swept = shoulder
        .clone()
        .add(arm.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(25)));
      const move = swept.sub(wrist);
      for (const joint of Object.values(hand.joints)) joint.position.add(move);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(40 + frame * 16);
      const now = panel.getWorldPosition(new THREE.Vector3()).sub(hand.joints.wrist.position);
      expect(Math.abs(now.length() - offset)).toBeLessThan(offset * 0.05);
      pinch(hand, false);
      fakeXR.frame?.(800);
    });

    it('keeps a far hand-grabbed window level, in place and facing the head through a wrist roll', () => {
      const { workspace } = setup();
      const { hand, controller, panel } = farHandGrab(workspace);
      for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
      const before = panel.getWorldPosition(new THREE.Vector3());
      const roll = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, -1),
        THREE.MathUtils.degToRad(40),
      );
      hand.joints.wrist.quaternion.multiply(roll);
      controller.quaternion.multiply(roll);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(600 + frame * 16);
      const rotation = panel.getWorldQuaternion(new THREE.Quaternion());
      expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(0.01);
      expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).y)).toBeLessThan(0.01);
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const toHead = head.sub(before).setY(0).normalize();
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).setY(0).normalize();
      expect(front.dot(toHead)).toBeGreaterThan(0.99);
      pinch(hand, false);
      fakeXR.frame?.(1400);
    });

    const expectLevelFacingHead = (panel: THREE.Object3D): void => {
      const rotation = panel.getWorldQuaternion(new THREE.Quaternion());
      expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).y)).toBeLessThan(0.01);
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const toHead = head.sub(panel.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).setY(0).normalize();
      expect(front.dot(toHead)).toBeGreaterThan(0.99);
    };

    it('keeps a far hand-grabbed window on the ray while the wrist bends', () => {
      const { workspace } = setup();
      const { hand, panel } = farHandGrab(workspace);
      for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
      const before = panel.getWorldPosition(new THREE.Vector3());
      hand.joints.wrist.quaternion.setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(25), 0, 'YXZ'),
      );
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(600 + frame * 16);
      expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(0.01);
      pinch(hand, false);
      fakeXR.frame?.(1400);
    });

    it('swings a far hand-grabbed window with the ray, level and facing the head', () => {
      const { workspace } = setup();
      const { hand, controller, panel } = farHandGrab(workspace);
      for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
      const wrist = hand.joints.wrist.getWorldPosition(new THREE.Vector3());
      const yaw = THREE.MathUtils.degToRad(20);
      const expected = panel
        .getWorldPosition(new THREE.Vector3())
        .sub(wrist)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        .add(wrist);
      controller.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      );
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(600 + frame * 16);
      expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(0.02);
      expectLevelFacingHead(panel);
      pinch(hand, false);
      fakeXR.frame?.(1400);
    });

    it.each([90, 100])(
      'keeps the last heading when the grabbing ray points %d degrees up',
      (degrees) => {
        const { workspace } = setup();
        const { hand, controller, panel } = farHandGrab(workspace);
        const yaw = 0.5;
        // Pitching about the held heading's right axis leaves the pane's sideways offset alone.
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const wrist = hand.joints.wrist.getWorldPosition(new THREE.Vector3());
        const sideways = (): number =>
          panel.getWorldPosition(new THREE.Vector3()).sub(wrist).dot(right);
        controller.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
        for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
        const before = sideways();
        expect(Math.abs(before)).toBeGreaterThan(0.05);
        controller.quaternion.setFromEuler(
          new THREE.Euler(THREE.MathUtils.degToRad(degrees), yaw, 0, 'YXZ'),
        );
        for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(600 + frame * 16);
        expect(sideways()).toBeCloseTo(before, 2);
        pinch(hand, false);
        fakeXR.frame?.(1400);
      },
    );

    it.each([
      ['up', Math.PI / 2],
      ['down', -Math.PI / 2],
    ])('spawns a panel on the facing side while looking straight %s', (_label, pitch) => {
      const { workspace } = setup();
      const camera = fakeXR.camera as THREE.Object3D;
      camera.rotation.set(pitch, 0.5, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      workspace.showInput('settings');
      const panel = workspace.scene.getObjectByName('xr-settings-controls');
      if (!panel) throw new Error('Settings missing');
      const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
      const expected = new THREE.Vector3(0, -0.2, -1.15)
        .applyQuaternion(heading)
        .add(camera.getWorldPosition(new THREE.Vector3()));
      expect(panel.position.distanceTo(expected)).toBeLessThan(1e-6);
    });

    it('spawns the hand keyboard low, near and tilted toward the user on the head heading', () => {
      const { workspace } = setup();
      connectHand();
      const camera = fakeXR.camera as THREE.Object3D;
      camera.rotation.set(-0.6, 0.5, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      workspace.showInput('keyboard');
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
      if (!keyboard) throw new Error('Keyboard missing');
      const eye = camera.getWorldPosition(new THREE.Vector3());
      const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
      const expected = new THREE.Vector3(0, -0.4, -0.45).applyQuaternion(heading).add(eye);
      expect(keyboard.position.distanceTo(expected)).toBeLessThan(1e-6);
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(keyboard.quaternion);
      expect(front.y).toBeCloseTo(0.5, 5);
      const toEye = eye.sub(keyboard.position).setY(0).normalize();
      expect(front.setY(0).normalize().dot(toEye)).toBeGreaterThan(0.999);
    });

    const keyboardRoot = (workspace: ReturnType<typeof createWorkspaceScene>): THREE.Object3D => {
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
      if (!keyboard) throw new Error('Keyboard missing');
      return keyboard;
    };
    const eyeAt = (offset: THREE.Vector3): THREE.Vector3 =>
      (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3()).add(offset);
    const HAND_SPAWN = new THREE.Vector3(0, -0.4, -0.45);
    const PANEL_SPAWN = new THREE.Vector3(0, -0.2, -1.15);
    const tilt = (object: THREE.Object3D): number =>
      new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).y;

    it('re-spawns a hand keyboard at the controller pose when controllers take over', () => {
      const { workspace } = setup();
      connectHand();
      workspace.showInput('keyboard');
      expect(keyboardRoot(workspace).position.distanceTo(eyeAt(HAND_SPAWN))).toBeLessThan(1e-6);
      connectController(0);
      connectController(1, [0, 0, 0, 0], 'left');
      // A controller held normally rests right where the near hand keyboard was.
      const parked = fakeXR.controllers[1] as THREE.Group;
      parked.position.copy(eyeAt(new THREE.Vector3(-0.05, -0.38, -0.42)));
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(40 + frame * 16);
      const keyboard = keyboardRoot(workspace);
      expect(keyboard.position.distanceTo(eyeAt(PANEL_SPAWN))).toBeLessThan(1e-6);
      expect(tilt(keyboard)).toBeCloseTo(0, 5);
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      expect(workspace.state.radialOpen).toBe(true);
    });

    it('spawns the hand keyboard near even after a far panel was open first', () => {
      const { workspace } = setup();
      connectHand();
      workspace.showInput('settings');
      workspace.showInput('keyboard');
      const keyboard = keyboardRoot(workspace);
      expect(keyboard.position.distanceTo(eyeAt(HAND_SPAWN))).toBeLessThan(1e-6);
      expect(tilt(keyboard)).toBeCloseTo(0.5, 5);
    });

    it('spawns a panel far and untilted after the hand keyboard was open', () => {
      const { workspace } = setup();
      connectHand();
      workspace.showInput('keyboard');
      workspace.showInput('settings');
      const panel = workspace.scene.getObjectByName('xr-settings-controls');
      if (!panel) throw new Error('Settings missing');
      expect(panel.position.distanceTo(eyeAt(PANEL_SPAWN))).toBeLessThan(1e-6);
      expect(tilt(panel)).toBeCloseTo(0, 5);
    });

    it('leaves a user-grabbed keyboard in place when the input kind flips', () => {
      const { workspace } = setup();
      connectHand();
      workspace.showInput('keyboard');
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.copy(keyboardRoot(workspace).getWorldPosition(new THREE.Vector3()));
      workspace.scene.updateMatrixWorld(true);
      connectController(0);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(20);
      controller.position.x += 0.3;
      fakeXR.frame?.(40);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      const placed = keyboardRoot(workspace).position.clone();
      expect(placed.distanceTo(eyeAt(HAND_SPAWN))).toBeGreaterThan(0.2);
      connectHand();
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(60 + frame * 16);
      connectController(0);
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(200 + frame * 16);
      expect(keyboardRoot(workspace).position.distanceTo(placed)).toBeLessThan(1e-6);
    });

    const xrSession = () => {
      const listeners: Array<() => void> = [];
      const session = {
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        end: async () => {
          for (const listener of listeners.splice(0)) listener();
        },
      };
      vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
      return session;
    };

    it('does not carry a spawned hand keyboard into the next controller session', async () => {
      const { workspace } = setup();
      connectHand();
      let session = xrSession();
      await workspace.enterXR('vr');
      fakeXR.frame?.(30);
      workspace.showInput('keyboard');
      expect(keyboardRoot(workspace).position.distanceTo(eyeAt(HAND_SPAWN))).toBeLessThan(1e-6);
      await session.end();
      fakeXR.frame?.(60);
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'disconnected' } as never);
      session = xrSession();
      await workspace.enterXR('vr');
      connectController(0);
      fakeXR.frame?.(90);
      workspace.showInput('keyboard');
      const keyboard = keyboardRoot(workspace);
      expect(keyboard.position.distanceTo(eyeAt(PANEL_SPAWN))).toBeLessThan(1e-6);
      expect(tilt(keyboard)).toBeCloseTo(0, 5);
      await session.end();
    });

    it('carries a user-grabbed keyboard pose into the next session', async () => {
      const { workspace } = setup();
      let session = xrSession();
      await workspace.enterXR('vr');
      connectController(0);
      fakeXR.frame?.(30);
      workspace.showInput('keyboard');
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.copy(keyboardRoot(workspace).getWorldPosition(new THREE.Vector3()));
      workspace.scene.updateMatrixWorld(true);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(40);
      controller.position.x += 0.3;
      fakeXR.frame?.(60);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      const placed = keyboardRoot(workspace).position.clone();
      expect(placed.distanceTo(eyeAt(PANEL_SPAWN))).toBeGreaterThan(0.2);
      await session.end();
      session = xrSession();
      await workspace.enterXR('vr');
      fakeXR.frame?.(90);
      workspace.showInput('keyboard');
      expect(keyboardRoot(workspace).position.distanceTo(placed)).toBeLessThan(1e-3);
      await session.end();
    });

    it('restores a saved keyboard pose instead of the hand keyboard spawn', async () => {
      localStorage.setItem(
        'mux-xr:ui-poses:v1',
        JSON.stringify({
          version: 1,
          poses: {
            keyboard: { position: [0.3, -0.1, -0.9], quaternion: [0, 0, 0, 1], scale: 0.5 },
          },
        }),
      );
      const session = { addEventListener: () => undefined, end: async () => undefined };
      vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
      const { workspace } = setup();
      connectHand();
      await workspace.enterXR('vr');
      fakeXR.frame?.(30);
      workspace.showInput('keyboard');
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
      if (!keyboard) throw new Error('Keyboard missing');
      const eye = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      expect(keyboard.scale.x).toBeCloseTo(0.5);
      expect(
        keyboard.position.distanceTo(eye.add(new THREE.Vector3(0, -0.4, -0.45))),
      ).toBeGreaterThan(0.1);
    });

    it('moves a contact-grabbed panel edge 1:1 without reeling it', () => {
      const { workspace } = setup();
      const hand = connectHand(0);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const point = panel.getWorldPosition(new THREE.Vector3());
      // The left edge, over half a metre from the panel origin; the right edge meets pane-b.
      const wrist = point.clone().add(new THREE.Vector3(-0.6, -0.047, 0.02));
      const movement = wrist.clone().sub(hand.joints.wrist.position);
      for (const joint of Object.values(hand.joints)) joint.position.add(movement);
      (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
      fakeXR.frame?.(20);
      pinch(hand, true);
      fakeXR.frame?.(40);
      const before = panel.position.clone();
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const pull = head.sub(hand.joints.wrist.position).setY(0).normalize().multiplyScalar(0.25);
      for (const joint of Object.values(hand.joints)) joint.position.add(pull);
      for (let frame = 0; frame < 20; frame++) fakeXR.frame?.(60 + frame * 16);
      expect(panel.position.clone().sub(before).distanceTo(pull)).toBeLessThan(1e-5);
      pinch(hand, false);
      fakeXR.frame?.(600);
    });

    it('rolls a two-hand grab when both wrists turn about the line between them', () => {
      const { workspace } = setup();
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
      const start = panel.quaternion.clone();
      const axis = right.joints.wrist.position.clone().sub(left.joints.wrist.position).normalize();
      const turn = (rightDegrees: number, leftDegrees: number, time: number): void => {
        for (const [hand, degrees] of [
          [right, rightDegrees],
          [left, leftDegrees],
        ] as const) {
          const twist = new THREE.Quaternion().setFromAxisAngle(
            axis,
            THREE.MathUtils.degToRad(degrees),
          );
          const pivot = hand.joints.wrist.position.clone();
          for (const joint of Object.values(hand.joints)) {
            joint.position.sub(pivot).applyQuaternion(twist).add(pivot);
            joint.quaternion.premultiply(twist);
          }
        }
        fakeXR.frame?.(time);
      };
      turn(10, 10, 80);
      expect(panel.quaternion.angleTo(start)).toBeLessThan(1e-6);
      turn(20, -20, 90);
      expect(panel.quaternion.angleTo(start)).toBeLessThan(1e-6);
      turn(0, 10, 95);
      expect(panel.quaternion.angleTo(start)).toBeLessThan(1e-6);
      turn(0, 30, 100);
      expect(THREE.MathUtils.radToDeg(panel.quaternion.angleTo(start))).toBeCloseTo(15, 0);
      const rolled = new THREE.Quaternion()
        .setFromAxisAngle(axis, THREE.MathUtils.degToRad(15))
        .multiply(start);
      expect(panel.quaternion.angleTo(rolled)).toBeLessThan(0.02);
      pinch(right, false);
      pinch(left, false);
      fakeXR.frame?.(400);
    });

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

    it('opens the radial and keyboard from a hand session', () => {
      const { workspace } = setup();
      connectHand();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      expect(workspace.state.radialOpen).toBe(true);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'keyboard' });
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    });

    it('toggles Focus on the selected pane from the hand-opened radial', () => {
      const { workspace } = setup();
      connectHand();
      workspace.selectTerminal('pane-b');
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'focus' });
      expect(workspace.state.focusModeTerminalId).toBe('pane-b');
      expect(workspace.state.radialOpen).toBe(false);
      fakeXR.frame?.(1500);
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(2500);
      expect(workspace.state.radialOpen).toBe(true);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'focus' });
      expect(workspace.state.focusModeTerminalId).toBeNull();
    });

    it('previews hand Warp presets and saves only on Done', () => {
      const { workspace } = setup();
      connectHand();
      const saved = (): string => localStorage.getItem('mux-xr:terminal-warp:v1') ?? '';
      const openWarp = (time: number): void => {
        workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
        fakeXR.frame?.(time);
        hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
        fakeXR.frame?.(time + 200);
      };
      const before = saved();
      const original = workspace.getTerminalCurvature('pane-a');
      openWarp(1000);
      hit(workspace, { inputAction: 'curvature', degrees: 60 });
      hit(workspace, { inputAction: 'curvatureStep', delta: 5 });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(65);
      expect(saved()).toBe(before);
      hit(workspace, { inputAction: 'warpCancel' });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(original);
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeUndefined();
      expect(saved()).toBe(before);
      openWarp(2000);
      hit(workspace, { inputAction: 'curvature', degrees: 30 });
      workspace.showInput('keyboard');
      expect(workspace.getTerminalCurvature('pane-a')).toBe(original);
      openWarp(3000);
      hit(workspace, { inputAction: 'curvature', degrees: 45 });
      hit(workspace, { inputAction: 'warpDone' });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(45);
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeUndefined();
      expect(saved()).toContain('45');
      const settled = saved();
      openWarp(4000);
      hit(workspace, { inputAction: 'curvature', degrees: 90 });
      workspace.selectTerminal('pane-b');
      expect(workspace.getTerminalCurvature('pane-a')).toBe(45);
      const paneB = workspace.getTerminalCurvature('pane-b');
      hit(workspace, { inputAction: 'curvature', degrees: 60 });
      expect(workspace.getTerminalCurvature('pane-b')).toBe(60);
      expect(saved()).toBe(settled);
      hit(workspace, { inputAction: 'warpCancel' });
      expect(workspace.getTerminalCurvature('pane-b')).toBe(paneB);
      expect(saved()).toBe(settled);
    });

    it('leaves Focus when the hand Warp panel opens', () => {
      const { workspace } = setup();
      connectHand();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'focus' });
      expect(workspace.state.focusModeTerminalId).toBe('pane-a');
      fakeXR.frame?.(1500);
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(2500);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
      expect(workspace.state.focusModeTerminalId).toBeNull();
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeDefined();
    });

    it('offers hand-selectable Warp presets without entering a stick-only mode', () => {
      const { workspace, left } = setup();
      connectHand();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
      fakeXR.frame?.(1200);
      expect(workspace.state.warpTerminalId).toBeNull();
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeDefined();
      hit(workspace, { inputAction: 'curvature', degrees: 30 });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
      expect(left.resizeGrid).not.toHaveBeenCalled();
    });

    it('opens the watch by left palm contact and blocks only the nearby left ray', () => {
      const { workspace, actions } = setup();
      connectHand(0);
      const leftHand = connectHand(1);
      const face = objectWithData(workspace, { inputAction: 'wristMenu' });
      const point = face.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        face.getWorldQuaternion(new THREE.Quaternion()),
      );
      const leftVisual = objectWithData(workspace, { handedness: 'left' });
      const movePalm = (distance: number): void => {
        const delta = point
          .clone()
          .addScaledVector(normal, distance)
          .sub(leftVisual.userData.palmPosition);
        for (const joint of Object.values(leftHand.joints)) joint.position.add(delta);
      };
      movePalm(0.2);
      fakeXR.frame?.(20);
      movePalm(0.06);
      fakeXR.frame?.(40);
      const rays = (fakeXR.controllers as THREE.Group[]).map((controller) =>
        controller.children.find((child) => child instanceof THREE.Line),
      );
      expect(rays.map((ray) => ray?.visible)).toEqual([true, false]);
      expect(workspace.state.radialOpen).toBe(false);
      aimController(
        fakeXR.controllers[1] as THREE.Group,
        objectWithData(workspace, { terminalId: 'pane-b' }),
      );
      nativeEvent(1, 'selectstart');
      expect(workspace.state.selectedTerminalId).toBe('pane-a');
      movePalm(0.01);
      fakeXR.frame?.(60);
      expect(workspace.state.radialOpen).toBe(true);
      fakeXR.frame?.(380);
      expect(workspace.state.radialOpen).toBe(true);
      movePalm(0.2);
      fakeXR.frame?.(400);
      expect(rays.map((ray) => ray?.visible)).toEqual([true, true]);
      movePalm(0.01);
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
      // A straight world-X sweep also lengthens the reach a little, so the far grab reels slightly.
      expect(Math.abs(panel.position.x - before.x - 0.2)).toBeLessThan(0.02);
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
    const leftController = fakeXR.controllers[1] as THREE.Group;
    leftController.position.x = -0.5;
    fakeXR.frame?.(20);
    hit(workspace, { inputAction: 'wristMenu' });
    expect(workspace.state.radialOpen).toBe(false);
    const face = objectWithData(workspace, { inputAction: 'wristMenu' });
    aimController(leftController, face);
    workspace.scene.updateMatrixWorld(true);
    fakeXR.frame?.(40);
    leftController.dispatchEvent({ type: 'selectstart' } as never);
    expect(workspace.state.radialOpen).toBe(true);
    fakeXR.frame?.(60);
    expect(workspace.state.radialOpen).toBe(true);
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('shows the radial Reload button only for an available update and closes before reload', () => {
    const { workspace, actions, container } = fixture();
    connectController(0, [0, 0, 0, 0], 'right');
    connectController(1, [0, 0, 0, 0], 'left');
    const leftController = fakeXR.controllers[1] as THREE.Group;
    leftController.position.x = -0.5;
    fakeXR.frame?.(20);
    const face = objectWithData(workspace, { inputAction: 'wristMenu' });
    aimController(leftController, face);
    workspace.scene.updateMatrixWorld(true);
    fakeXR.frame?.(40);
    leftController.dispatchEvent({ type: 'selectstart' } as never);
    expect(workspace.state.radialOpen).toBe(true);
    fakeXR.frame?.(940);

    const reload = workspace.scene.getObjectByName('radial-menu-reload-update');
    if (!reload) throw new Error('Radial Reload button not found');
    expect(reload.visible).toBe(false);
    workspace.setUpdateAvailable(true);
    expect(reload.visible).toBe(true);
    workspace.setUpdateAvailable(false);
    expect(reload.visible).toBe(false);
    workspace.setUpdateAvailable(true);
    expect(reload.visible).toBe(true);

    hit(workspace, { inputAction: 'reloadUpdate' });
    expect(actions.reloadApp).toHaveBeenCalledOnce();
    expect(workspace.state.radialOpen).toBe(false);
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
    // A flat Transcript heading names the speech-to-text box from just above its top edge.
    const heading = workspace.scene.getObjectByName('xr-dictation-transcript-heading');
    expect(heading?.userData.labelText).toBe('Transcript');
    expect(heading?.userData.inputAction).toBe('noop');
    const top = (label?.position.y ?? 0) + Number(label?.userData.labelHeight) / 2;
    const bottom = (heading?.position.y ?? 0) - Number(heading?.userData.labelHeight) / 2;
    expect(bottom).toBeGreaterThan(top);
    expect(bottom - top).toBeLessThan(0.03);
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

    it('keeps a jittered press a click that selects the pane without copying', () => {
      const { workspace, left, controller, aimCell, start, finish, writeText } = setupSelection();
      workspace.selectTerminal('pane-b');
      start();
      expect(workspace.state.selectedTerminalId).toBe('pane-a');
      aimCell(3, 3);
      fakeXR.frame?.(50);
      aimCell(3, 4);
      fakeXR.frame?.(60);
      finish();
      expect(left.updateSelection).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
      expect(workspace.state.toast).toBeNull();
      start();
      aimCell(12, 6);
      fakeXR.frame?.(100);
      finish();
      expect(left.updateSelection).toHaveBeenLastCalledWith({ col: 12, row: 6 });
      expect(writeText).toHaveBeenCalledOnce();
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
    const saved = JSON.parse(localStorage.getItem('mux-xr:ui-poses:v2') ?? '{}');
    expect(saved.poses.keyboard.position).toHaveLength(3);
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!hud) throw new Error('HUD missing');
    hud.position.x = 0.37;
    hud.scale.setScalar(0.7);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    hit(workspace, { inputAction: 'exit' });
    clock.mockReturnValue(now + 400);
    hit(workspace, { inputAction: 'exit' });
    clock.mockRestore();
    await Promise.resolve();
    const ended = JSON.parse(localStorage.getItem('mux-xr:ui-poses:v2') ?? '{}');
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

  describe('edge scroll strip', () => {
    const stripOf = (
      workspace: ReturnType<typeof createWorkspaceScene>,
      id: string,
    ): THREE.Mesh => {
      const strip = workspace.scene
        .getObjectByName(`terminal-panel-${id}`)
        ?.getObjectByName('terminal-scroll-strip');
      if (!(strip instanceof THREE.Mesh)) throw new Error('strip missing');
      return strip;
    };
    const lineHeight = (workspace: ReturnType<typeof createWorkspaceScene>, id: string): number => {
      const screen = workspace.scene
        .getObjectByName(`terminal-panel-${id}`)
        ?.getObjectByName('terminal-surface') as THREE.Mesh<THREE.PlaneGeometry>;
      screen.geometry.computeBoundingBox();
      const box = screen.geometry.boundingBox as THREE.Box3;
      return (box.max.y - box.min.y) / 24;
    };
    const scrolled = (actions: { scrollTerminal?: unknown }): number[] =>
      (actions.scrollTerminal as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[1] as number,
      );

    it('drags whole lines touch-style without selecting text, grabbing or moving the pane', () => {
      const { workspace, actions, container, right } = fixture();
      actions.scrollTerminal = vi.fn(() => true);
      actions.sendMouse = vi.fn(() => false);
      right.beginSelection = vi.fn(() => true);
      workspace.selectTerminal('pane-a');
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const strip = stripOf(workspace, 'pane-b');
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
      const position = panel.position.clone();
      const line = lineHeight(workspace, 'pane-b');
      const aim = (y: number, time: number): void => {
        aimControllerAtScreen(controller, strip, new THREE.Vector3(0, y, 0));
        fakeXR.frame?.(time);
      };
      aim(0, 10);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      expect(workspace.state.selectedTerminalId).toBe('pane-b');
      aim(-line * 0.3, 20);
      aim(-line * 0.6, 30);
      expect(actions.scrollTerminal).not.toHaveBeenCalled();
      aim(-line * 3.7, 40);
      expect(scrolled(actions)).toEqual([-3]);
      for (let step = 1; step <= 6; step += 1) aim(-line * 3.7 + line * 0.4 * step, 40 + step * 10);
      expect(scrolled(actions).slice(1)).toEqual([1, 1]);
      expect(actions.scrollTerminal).toHaveBeenCalledWith('pane-b', 1);
      expect(right.beginSelection).not.toHaveBeenCalled();
      expect(actions.sendMouse).not.toHaveBeenCalled();
      expect(panel.position.distanceTo(position)).toBeLessThan(1e-9);
      controller.dispatchEvent({ type: 'select' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      aim(line * 10, 200);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(3);
      workspace.dispose();
      container.remove();
    });

    it('scrolls along a rolled pane and stops when a grip takes over', () => {
      const { workspace, actions, container } = fixture();
      actions.scrollTerminal = vi.fn(() => true);
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      panel.rotateZ(Math.PI / 2);
      const strip = stripOf(workspace, 'pane-a');
      const line = lineHeight(workspace, 'pane-a');
      aimControllerAtScreen(controller, strip, new THREE.Vector3(0, 0, 0));
      fakeXR.frame?.(10);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(panel.quaternion);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(panel.quaternion);
      const start = controller.position.clone();
      controller.position.copy(start).addScaledVector(side, line * 4);
      fakeXR.frame?.(20);
      expect(actions.scrollTerminal).not.toHaveBeenCalled();
      controller.position.copy(start).addScaledVector(up, -line * 0.6);
      fakeXR.frame?.(30);
      controller.position.copy(start).addScaledVector(up, -line * 2.7);
      fakeXR.frame?.(40);
      expect(scrolled(actions)).toEqual([-2]);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(50);
      controller.position.copy(start).addScaledVector(up, -line * 8);
      fakeXR.frame?.(60);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      controller.position.copy(start).addScaledVector(up, line * 8);
      fakeXR.frame?.(70);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
      workspace.dispose();
      container.remove();
    });

    it('keeps both strips out of the pane footprint', () => {
      const { workspace, container } = fixture();
      workspace.setWindowPreferences({
        ...workspace.state.windowPreferences,
        scrollStripSide: 'both',
      });
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const before = measurePanelBounds(panel).size.width;
      stripOf(workspace, 'pane-a').removeFromParent();
      panel.getObjectByName('terminal-scroll-strip-left')?.removeFromParent();
      expect(measurePanelBounds(panel).size.width).toBeCloseTo(before, 6);
      workspace.dispose();
      container.remove();
    });

    it('places strips on the chosen side and scrolls from the left strip', () => {
      const { workspace, actions, container } = fixture();
      actions.scrollTerminal = vi.fn(() => true);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const right = stripOf(workspace, 'pane-a');
      const left = panel.getObjectByName('terminal-scroll-strip-left');
      if (!(left instanceof THREE.Mesh)) throw new Error('left strip missing');
      expect([right.visible, left.visible]).toEqual([true, false]);
      expect(left.position.x).toBeCloseTo(-right.position.x, 6);
      expect(left.userData).toMatchObject({ inputAction: 'scrollStrip', excludeFromBounds: true });
      const choose = (side: 'right' | 'left' | 'both'): void =>
        workspace.setWindowPreferences({
          ...workspace.state.windowPreferences,
          scrollStripSide: side,
        });
      choose('both');
      expect([right.visible, left.visible]).toEqual([true, true]);
      choose('left');
      expect([right.visible, left.visible]).toEqual([false, true]);
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const line = lineHeight(workspace, 'pane-a');
      const aim = (y: number, time: number): void => {
        aimControllerAtScreen(controller, left, new THREE.Vector3(0, y, 0));
        fakeXR.frame?.(time);
      };
      aim(0, 10);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      aim(-line * 0.6, 20);
      aim(-line * 2.7, 30);
      expect(scrolled(actions)).toEqual([-2]);
      choose('right');
      aim(-line * 6, 40);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
      workspace.dispose();
      container.remove();
    });

    it('cycles the strip side from the XR Display settings', () => {
      const { workspace, container } = fixture();
      workspace.showInput('display');
      hit(workspace, { inputAction: 'scrollStripSide', scrollStripSide: 'left' });
      expect(workspace.state.windowPreferences.scrollStripSide).toBe('left');
      hit(workspace, { inputAction: 'scrollStripSide', scrollStripSide: 'both' });
      expect(workspace.state.windowPreferences.scrollStripSide).toBe('both');
      hit(workspace, { inputAction: 'scrollStripSide', scrollStripSide: 'right' });
      expect(workspace.state.windowPreferences.scrollStripSide).toBe('right');
      workspace.dispose();
      container.remove();
    });

    it('starts without the frame chin and toggles it from XR Display settings, rebuilding open frames', () => {
      const { workspace, container } = fixture();
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const bottoms = (): number[] =>
        ['terminal-frame', 'terminal-frame-accent'].map((name) => {
          const mesh = panel.getObjectByName(name) as THREE.Mesh;
          mesh.geometry.computeBoundingBox();
          return mesh.geometry.boundingBox?.min.y ?? Number.NaN;
        });
      expect(workspace.state.windowPreferences.frameChin).toBe(false);
      const [bareFrame, bareAccent] = bottoms() as [number, number];
      workspace.showInput('display');
      hit(workspace, { inputAction: 'frameChin' });
      expect(workspace.state.windowPreferences.frameChin).toBe(true);
      const [chinFrame, chinAccent] = bottoms() as [number, number];
      expect(bareFrame - chinFrame).toBeCloseTo(0.05);
      expect(bareAccent).toBeGreaterThan(chinAccent);
      hit(workspace, { inputAction: 'frameChin' });
      expect(workspace.state.windowPreferences.frameChin).toBe(false);
      expect(bottoms()[0]).toBeCloseTo(bareFrame);
      workspace.dispose();
      container.remove();
    });
  });

  it('marks the selected pane by lighting its frame and whitening its accent', () => {
    const { workspace, container } = fixture();
    const look = (id: string): { glow: number; accent: number } => {
      const panel = workspace.scene.getObjectByName(`terminal-panel-${id}`) as THREE.Group;
      const frame = panel.getObjectByName('terminal-frame') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;
      const accent = panel.getObjectByName('terminal-frame-accent') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      return { glow: frame.material.emissiveIntensity, accent: accent.material.color.getHex() };
    };
    expect(workspace.scene.getObjectByName('active-pane-highlight')).toBeUndefined();
    expect(look('pane-a').glow).toBeGreaterThan(0.3);
    expect(look('pane-a').accent).toBe(0xffffff);
    expect(look('pane-b')).toEqual({ glow: 0, accent: 0x68d6ff });
    workspace.selectTerminal('pane-b');
    expect(look('pane-a')).toEqual({ glow: 0, accent: 0x68d6ff });
    expect(look('pane-b').glow).toBeGreaterThan(0.3);
    expect(look('pane-b').accent).toBe(0xffffff);
    workspace.dispose();
    container.remove();
  });

  it('fades an unselected frame accent with the glass and keeps it out of ray hits', () => {
    const { workspace, container } = fixture();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
    const accent = panel.getObjectByName('terminal-frame-accent') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    workspace.setTerminalOpacity('pane-b', 0.4);
    expect(accent.material.opacity).toBeCloseTo(0.4);
    expect(accent.material.depthWrite).toBe(false);
    workspace.selectTerminal('pane-b');
    expect(accent.material.opacity).toBe(1);
    workspace.selectTerminal('pane-a');
    expect(accent.material.opacity).toBeCloseTo(0.4);
    workspace.setTerminalOpacity('pane-b', 1);
    expect(accent.material.opacity).toBe(1);
    expect(accent.material.depthWrite).toBe(true);
    const hits: THREE.Intersection[] = [];
    accent.raycast(
      new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)),
      hits,
    );
    expect(hits).toHaveLength(0);
    workspace.dispose();
    container.remove();
  });

  it('draws the frame accent in one pass instead of three.js back-then-front transparent passes', () => {
    const { workspace, container } = fixture();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
    const material = (panel.getObjectByName('terminal-frame-accent') as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
    const twoPass =
      material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;
    expect(twoPass).toBe(false);
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
    expect(JSON.parse(localStorage.getItem('mux-xr:widget-poses:v2') ?? '{}').poses).toEqual({});
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

  it('keeps a far controller mouse press a click until the hit passes the drag dead zone', () => {
    const { workspace, actions, container, left } = fixture();
    Object.defineProperty(left, 'mouseTracking', { value: 'drag' });
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-a')
      ?.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    connectController(0);
    const cell = 1.42 / 80;
    const sent = () => (actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001, 0, 0), 3);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(sent()).toHaveLength(1);
    // Three cells at 3 m is under 1.5 degrees of ray angle.
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001 + cell * 3, 0, 0), 3);
    fakeXR.frame?.(20);
    expect(sent()).toHaveLength(1);
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001 + cell * 10, 0, 0), 3);
    fakeXR.frame?.(40);
    expect(sent().at(-1)?.[1]).toEqual(expect.objectContaining({ col: 50, eventType: 'move' }));
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(sent().at(-1)?.[1]).toEqual(expect.objectContaining({ col: 50, eventType: 'release' }));
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001, 0, 0), 3);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001 + cell * 3, 0, 0), 3);
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(
      sent()
        .slice(-2)
        .map((call) => [call[1].col, call[1].eventType]),
    ).toEqual([
      [40, 'press'],
      [40, 'release'],
    ]);
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

  it('toggles radial with the left menu button or left X', () => {
    const { workspace, container } = fixture();
    const gamepad = connectController(0, [0, 0, 0, 0], 'left');
    const press = (index: number, time: number): void => {
      (gamepad.buttons[index] as { pressed: boolean }).pressed = true;
      fakeXR.frame?.(time);
      (gamepad.buttons[index] as { pressed: boolean }).pressed = false;
      fakeXR.frame?.(time + 16);
    };
    press(7, 0);
    expect(workspace.state.radialOpen).toBe(true);
    press(7, 100);
    expect(workspace.state.radialOpen).toBe(false);
    press(4, 200);
    expect(workspace.state.radialOpen).toBe(true);
    workspace.dispose();
    container.remove();
  });

  it('does not toggle radial for a left menu button already held at connect', () => {
    const { workspace, container } = fixture();
    const gamepad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 8 }, (_, index) => ({ pressed: index === 7 })),
    } as unknown as Gamepad;
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({
      type: 'connected',
      data: { gamepad, handedness: 'left' },
    } as never);
    fakeXR.frame?.(0);
    expect(workspace.state.radialOpen).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('hands a left-menu radial to the right controller so Warp follows the right stick', () => {
    const { workspace, container } = fixture();
    // The pointing helper aims controller 0, so the right controller takes index 0 here.
    const rightAxes = [0, 0, 0, 0];
    connectController(0, rightAxes, 'right');
    const left = connectController(1, [0, 0, 0, 0], 'left');
    workspace.selectTerminal('pane-a');
    const before = workspace.getTerminalCurvature('pane-a');
    (left.buttons[7] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    (left.buttons[7] as { pressed: boolean }).pressed = false;
    fakeXR.frame?.(16);
    fakeXR.frame?.(900);
    hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
    fakeXR.frame?.(2000);
    expect(workspace.state.warpTerminalId).toBe('pane-a');
    rightAxes[2] = 1;
    fakeXR.frame?.(2200);
    expect(workspace.getTerminalCurvature('pane-a')).toBeGreaterThan(before);
    workspace.dispose();
    container.remove();
  });

  it('toggles radial once when A and the left menu button land in the same frame', () => {
    const { workspace, container } = fixture();
    const left = connectController(0, [0, 0, 0, 0], 'left');
    const right = connectController(1, [0, 0, 0, 0], 'right');
    (left.buttons[7] as { pressed: boolean }).pressed = true;
    (right.buttons[4] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(0);
    expect(workspace.state.radialOpen).toBe(true);
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

  it('uses new-window opacity without changing open panes or saved overrides', () => {
    const { workspace, container } = fixture();
    workspace.setTerminalOpacity('pane-a', 0.7);
    workspace.setWindowPreferences({
      defaultOpacity: 0.4,
      focusDistance: 1.5,
      focusCurvature: 0,
      scrollStripSide: 'right',
      frameChin: true,
    });
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
    workspace.setWindowPreferences({
      defaultOpacity: 0.4,
      focusDistance: 2.2,
      focusCurvature: 40,
      scrollStripSide: 'right',
      frameChin: true,
    });
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
