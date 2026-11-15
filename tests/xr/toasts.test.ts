import { describe, expect, it, vi } from 'vitest';

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
import { fakeXR, fixture, hit } from '../helpers/xr-harness';

describe('outside-program toasts', () => {
  const toast = (overrides: Record<string, unknown>) => ({
    type: 'toast' as const,
    toast: {
      id: 't',
      message: 'hello',
      title: null,
      level: 'info' as const,
      color: '#5ad1e6',
      timeout: 0,
      placement: 'top' as const,
      paneId: null,
      source: null,
      ...overrides,
    },
  });

  it('places cards in view and above their pane, and a ray dismisses them through a nearer panel', () => {
    const onToastDismissed = vi.fn();
    const { workspace, container } = fixture({ onToastDismissed });
    workspace.receiveToast(toast({ id: 'top', level: 'error', color: '#ff7a6b' }));
    workspace.receiveToast(toast({ id: 'over-b', placement: 'pane', paneId: 'pane-b' }));
    fakeXR.frame?.(16);
    fakeXR.frame?.(32);
    workspace.scene.updateMatrixWorld(true);

    const card = workspace.scene.getObjectByName('xr-toast-top-1');
    if (!card?.visible) throw new Error('top toast card not shown');
    const eye = workspace.camera.getWorldPosition(new THREE.Vector3());
    const ahead = card.getWorldPosition(new THREE.Vector3()).sub(eye);
    expect(ahead.dot(workspace.camera.getWorldDirection(new THREE.Vector3()))).toBeGreaterThan(1);
    expect(ahead.y).toBeGreaterThan(0.3);

    const paneCard = workspace.scene.getObjectByName('xr-toast-pane-1');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b');
    if (!paneCard?.visible || !panel) throw new Error('pane toast or panel missing');
    const panelBox = new THREE.Box3().setFromObject(panel);
    expect(paneCard.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(panelBox.max.y);

    // A terminal pushed between the controller and the card still loses the ray to the card.
    const blocker = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
    blocker.position
      .copy(card.getWorldPosition(new THREE.Vector3()))
      .add(
        new THREE.Vector3(0, 0, 0.15).applyQuaternion(
          card.getWorldQuaternion(new THREE.Quaternion()),
        ),
      );
    blocker.quaternion.copy(card.getWorldQuaternion(new THREE.Quaternion()));
    hit(workspace, { inputAction: 'dismissToast', toastId: 'top' });
    expect(onToastDismissed).toHaveBeenCalledWith('top');
    expect(card.visible).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('does not report a dismissal for a toast another headset already cleared', () => {
    const onToastDismissed = vi.fn();
    const { workspace, container } = fixture({ onToastDismissed });
    workspace.receiveToast(toast({ id: 'gone', placement: 'center' }));
    workspace.receiveToast({ type: 'dismiss', id: 'gone' });
    expect(workspace.scene.getObjectByName('xr-toast-center-1')?.visible).toBe(false);
    expect(onToastDismissed).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });
});
