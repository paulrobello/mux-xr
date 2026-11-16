/** Shared scene fixture and controller helpers for the native XR controller tests (tests/xr/). */
import * as THREE from 'three';
import { vi } from 'vitest';
import type { PaneDescriptor, TerminalSurface } from '../../src/contracts';
import { createWorkspaceScene } from '../../src/xr/scene';
import { createTestActions } from './actions';
import { createFakeHost } from './widget-context';
import { fakeXR } from './xr-mocks';

export { fakeXR, handPoses } from './xr-mocks';

export const pane = (id: string, title = id): PaneDescriptor => ({
  id,
  title,
  workspaceId: 'workspace',
  workspaceName: 'Workspace',
  sessionId: 'session',
  sessionName: 'Session',
  windowId: 'window',
  windowName: 'Window',
});

export function surface(descriptor: PaneDescriptor): TerminalSurface {
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

export function fixture(options?: Parameters<typeof createWorkspaceScene>[2]) {
  const actions = createTestActions();
  const container = document.createElement('div');
  const fakeHost = createFakeHost();
  const workspace = createWorkspaceScene(container, actions, { host: fakeHost.host, ...options });
  fakeXR.camera = workspace.camera;
  const left = surface(pane('pane-a', 'A'));
  const right = surface(pane('pane-b', 'B'));
  workspace.addTerminal(left);
  workspace.addTerminal(right);
  workspace.setAvailablePanes([left.pane, right.pane]);
  workspace.scene.updateMatrixWorld(true);
  return { workspace, actions, container, left, right, hostRequests: fakeHost.requests };
}

export function hit(
  workspace: ReturnType<typeof createWorkspaceScene>,
  data: Record<string, unknown>,
  event = 'selectstart',
  distance = 0.3,
): void {
  if (data.inputAction === 'toggleWidget') turnToWidget(workspace, data);
  const button = visibleWithData(workspace, data);
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

export function visibleWithData(
  workspace: ReturnType<typeof createWorkspaceScene>,
  data: Record<string, unknown>,
): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  workspace.scene.traverse((object) => {
    let visible = true;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
      if (!parent.visible) visible = false;
    if (
      visible &&
      !found &&
      Object.entries(data).every(([key, value]) => object.userData[key] === value)
    )
      found = object;
  });
  return found;
}

/** The Widgets panel pages once the registry outgrows one page: turn to the entry's page. */
export function turnToWidget(
  workspace: ReturnType<typeof createWorkspaceScene>,
  data: Record<string, unknown>,
): void {
  for (const delta of [-1, 1])
    for (let turns = 0; turns < 8 && !visibleWithData(workspace, data); turns += 1) {
      if (!visibleWithData(workspace, { inputAction: 'widgetsPage', delta })) break;
      hit(workspace, { inputAction: 'widgetsPage', delta });
    }
}

export function objectWithData(
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

export function aimController(
  controller: THREE.Group,
  target: THREE.Object3D,
  distance = 0.3,
): void {
  const orientation = target.getWorldQuaternion(new THREE.Quaternion());
  controller.position.copy(
    target
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, 0, distance).applyQuaternion(orientation)),
  );
  controller.quaternion.copy(orientation);
}

export function aimControllerAtScreen(
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

export function connectController(
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

export function pressFocusButton(gamepad: Gamepad, time: number): void {
  (gamepad.buttons[5] as { pressed: boolean }).pressed = true;
  fakeXR.frame?.(time);
  (gamepad.buttons[5] as { pressed: boolean }).pressed = false;
  fakeXR.frame?.(time + 16);
}
let graphFrameTime = 0;
export function settleHierarchy(): void {
  for (let frame = 0; frame < 40; frame++) {
    graphFrameTime += 16;
    fakeXR.frame?.(graphFrameTime);
  }
}

export function openRadialMenu(gamepad: Gamepad, time: number): void {
  (gamepad.buttons[4] as { pressed: boolean }).pressed = true;
  fakeXR.frame?.(time);
  (gamepad.buttons[4] as { pressed: boolean }).pressed = false;
  fakeXR.frame?.(time + 16);
  fakeXR.frame?.(time + 900);
}

export function selectRadialAction(
  workspace: ReturnType<typeof createWorkspaceScene>,
  gamepad: Gamepad,
  action: 'keyboard' | 'commands' | 'panes' | 'layout' | 'warp' | 'widgets' | 'settings' | 'cancel',
  time: number,
): void {
  openRadialMenu(gamepad, time);
  hit(workspace, { inputAction: 'radialAction', radialAction: action });
  fakeXR.frame?.(time + 1100);
}

export function selectKeyboardViaRadial(
  workspace: ReturnType<typeof createWorkspaceScene>,
  gamepad: Gamepad,
  time: number,
): void {
  selectRadialAction(workspace, gamepad, 'keyboard', time);
}

/** Per-test reset the original `beforeEach` of the controller suite performed. */
export function resetXRControllers(): void {
  fakeXR.presenting = true;
  localStorage.removeItem('mux-xr:ui-poses:v2');
  localStorage.removeItem('mux-xr:widget-poses:v2');
  localStorage.removeItem('mux-xr:sticky-notes:v1');
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
}
