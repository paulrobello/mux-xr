import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { PANEL_FLOOR_CLEARANCE, workspaceFloorY } from '../../src/xr/floor-layout';
import { fakeXR, fixture, pane, surface } from '../helpers/xr-harness';

interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const pose = (root: THREE.Object3D): Pose => ({
  position: root.position.clone(),
  quaternion: root.quaternion.clone(),
});

const expectPoseUnchanged = (root: THREE.Object3D, before: Pose): void => {
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(root.position[axis]).toBeCloseTo(before.position[axis], 6);
    expect(root.quaternion[axis]).toBeCloseTo(before.quaternion[axis], 6);
  }
  expect(root.quaternion.w).toBeCloseTo(before.quaternion.w, 6);
};

describe('roster row pane attach', () => {
  afterEach(() => {
    fakeXR.presenting = false;
  });

  it('attaching a pane from its roster row leaves every other terminal where it is', () => {
    const { workspace, container } = fixture();
    try {
      // A scene's first frame settles the initial background pass; consume it before the
      // layout under test is captured.
      fakeXR.frame?.(16);
      // A user's custom layout: both panels sit low, so the union of panel bounds dips below
      // the floor line — the state that armed the whole-layout pass and moved every terminal.
      const a = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Object3D;
      const b = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Object3D;
      a.position.set(0.55, 0, -1.3);
      b.position.set(-0.55, 0.02, -1.3);
      workspace.scene.updateMatrixWorld(true);
      const beforeA = pose(a);
      const beforeB = pose(b);

      // The roster click for a pane that is not yet attached, then the frame the render loop
      // runs after the attach — the frame where the whole-layout floor pass used to fire.
      workspace.addTerminal(surface(pane('pane-c', 'C')));
      fakeXR.frame?.(32);

      expectPoseUnchanged(a, beforeA);
      expectPoseUnchanged(b, beforeB);

      // The safety net still applies to the new panel itself.
      const c = workspace.scene.getObjectByName('terminal-panel-pane-c') as THREE.Object3D;
      const floorY = workspaceFloorY(workspace.state.background, workspace.state.xrMode);
      if (floorY === null) throw new Error('The default background has no floor');
      c.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(c);
      expect(bounds.min.y).toBeGreaterThanOrEqual(floorY + PANEL_FLOOR_CLEARANCE);
    } finally {
      workspace.dispose();
      container.remove();
    }
  });
});
