import { afterEach, describe, expect, it, vi } from 'vitest';

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

import * as THREE from 'three';
import { fakeXR, fixture, hit } from './helpers/xr-harness';

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
