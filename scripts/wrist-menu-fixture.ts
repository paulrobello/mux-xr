import type { Page } from 'playwright';

type WatchWindow = Window & {
  __questScene: import('three').Scene;
  __questThree: typeof import('three');
  __questControllers: import('three').Group[];
  __muxXR: { getState(): { scene: { radialOpen: boolean } } };
};

/**
 * Opens or closes the radial the way a wearer does since the HUD Menu was removed: the left
 * controller selects the watch face on the right wrist. When the fixture has no left input,
 * pass `leftConnected: false` and a left controller is connected for the press, then
 * disconnected again, so the fixture's own input state is unchanged.
 */
export async function pressWristMenu(
  page: Page,
  { leftConnected }: { leftConnected: boolean },
): Promise<void> {
  await page.evaluate(async (leftConnected) => {
    const w = window as unknown as WatchWindow;
    const tick = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const left = w.__questControllers[1];
    const borrowed = !leftConnected;
    if (borrowed) {
      left.dispatchEvent({
        type: 'connected',
        data: { handedness: 'left', gamepad: { buttons: [], axes: [] } },
      } as never);
      await tick(3);
    }
    const wasOpen = w.__muxXR.getState().scene.radialOpen;
    const face = w.__questScene
      .getObjectByName('xr-wrist-menu-watch')
      ?.children.find((node) => node.userData.inputAction === 'wristMenu');
    if (!face) throw new Error('Wrist Menu face missing');
    const q = face.getWorldQuaternion(new w.__questThree.Quaternion());
    left.position
      .copy(face.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.25).applyQuaternion(q));
    left.quaternion.copy(q);
    w.__questScene.updateMatrixWorld(true);
    left.dispatchEvent({ type: 'selectstart' } as never);
    left.dispatchEvent({ type: 'select' } as never);
    left.dispatchEvent({ type: 'selectend' } as never);
    await tick(2);
    const toggled = w.__muxXR.getState().scene.radialOpen !== wasOpen;
    let watchShown = true;
    for (let node: import('three').Object3D | null = face; node; node = node.parent)
      if (!node.visible) watchShown = false;
    if (borrowed) {
      left.dispatchEvent({ type: 'disconnected' } as never);
      await tick(1);
    }
    if (!toggled)
      throw new Error(
        `Wrist Menu press did not toggle the radial: ${JSON.stringify({ wasOpen, watchShown, borrowed })}`,
      );
  }, leftConnected);
}
