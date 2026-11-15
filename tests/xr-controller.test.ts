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
  hit,
  objectWithData,
  pane,
  pressFocusButton,
  resetXRControllers,
  selectKeyboardViaRadial,
  selectRadialAction,
  surface,
} from './helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

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
