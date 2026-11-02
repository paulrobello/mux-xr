import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type * as THREE from 'three';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __muxXR: {
    getState(): {
      attached: string[];
      scene: { focusModeTerminalId: string | null; xrMode: string };
    };
  };
  __questScene: THREE.Scene;
  __questControllers: THREE.Group[];
  __questCamera: THREE.PerspectiveCamera;
  __questRenderer: THREE.WebGLRenderer;
  __questThree: typeof THREE;
  __focusPad: { buttons: Array<{ pressed: boolean }>; axes: number[] };
  __focusOriginal: { position: number[]; quaternion: number[]; scale: number[] };
};

const base = process.env.MUX_XR_BASE_URL;
const root = process.env.MUX_XR_TEST_ROOT;
if (!base || !root || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error('Focus verification requires an explicit private test URL and root');
await mkdir(root, { recursive: true });
prepareQuestFixture(root);
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/Troika|Failure loading font|Creating a worker/.test(message.text()))
    errors.push(message.text());
});
await page.routeWebSocket(/.*/, (socket) => socket.close());
try {
  await page.goto(`${base}/__quest-controls.html?demo=1`, { waitUntil: 'load', timeout: 15000 });
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode === 'vr',
  );
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const pane = w.__questScene.getObjectByName('terminal-panel-demo-1');
    if (!pane) throw new Error('Demo pane missing');
    w.__focusOriginal = {
      position: pane.position.toArray(),
      quaternion: pane.quaternion.toArray(),
      scale: pane.scale.toArray(),
    };
    w.__focusPad = {
      buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
      axes: [0, 0, 0, 0],
    };
    const controller = w.__questControllers[1];
    controller.dispatchEvent({
      type: 'connected',
      data: { gamepad: w.__focusPad, handedness: 'right' },
    } as never);
    const point = pane.getWorldPosition(new w.__questThree.Vector3());
    const rotation = pane.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(point)
      .add(new w.__questThree.Vector3(0, 0, 0.4).applyQuaternion(rotation));
    controller.quaternion.copy(rotation);
    w.__focusPad.buttons[1].pressed = true;
    w.__focusPad.buttons[5].pressed = true;
  });
  await page.waitForTimeout(80);
  if (
    await page.evaluate(() =>
      Boolean((window as unknown as FixtureWindow).__muxXR.getState().scene.focusModeTerminalId),
    )
  )
    throw new Error('Grip leaked a focus toggle');
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__focusPad.buttons[1].pressed = false;
  });
  await page.waitForTimeout(60);
  if (
    await page.evaluate(() =>
      Boolean((window as unknown as FixtureWindow).__muxXR.getState().scene.focusModeTerminalId),
    )
  )
    throw new Error('Releasing grip activated held B');
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__focusPad.buttons[5].pressed = false;
  });
  await page.waitForTimeout(40);
  await page.screenshot({ path: join(root, 'focus-before.png') });
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__focusPad.buttons[5].pressed = true;
  });
  await page.waitForFunction(() => {
    const w = window as unknown as FixtureWindow;
    return (
      w.__muxXR.getState().scene.focusModeTerminalId === 'demo-1' &&
      !w.__questScene.getObjectByName('terminal-panel-demo-2')?.visible
    );
  });
  await page.screenshot({ path: join(root, 'focus-active.png') });
  const focused = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const gl = w.__questRenderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const target = w.__questScene.getObjectByName('terminal-panel-demo-1');
    const hidden = w.__questScene.getObjectByName('terminal-panel-demo-2');
    if (!target || !hidden?.userData.focusHidden) throw new Error('Focus isolation failed');
    let title: THREE.Object3D | undefined;
    target.traverse((object) => {
      if (String(object.userData.labelText).includes('connected')) title = object;
    });
    if (!title) throw new Error('Focused title missing');
    const center = title.getWorldPosition(new w.__questThree.Vector3()).project(w.__questCamera);
    const x = Math.round(((center.x + 1) * gl.drawingBufferWidth) / 2);
    const y = Math.round(((center.y + 1) * gl.drawingBufferHeight) / 2);
    w.__questRenderer.render(w.__questScene, w.__questCamera);
    const pixels = new Uint8Array(240 * 32 * 4);
    gl.readPixels(x - 120, y - 16, 240, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let foreground = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180) foreground++;
    return {
      renderer,
      foreground,
      position: target.position.toArray(),
      scale: target.scale.toArray(),
    };
  });
  if (!focused.renderer || /swiftshader/i.test(focused.renderer) || focused.foreground < 10)
    throw new Error(`Native focus label check failed: ${JSON.stringify(focused)}`);
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__focusPad.buttons[5].pressed = false;
  });
  await page.waitForTimeout(40);
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).__focusPad.buttons[5].pressed = true;
  });
  await page.waitForFunction(() => {
    const w = window as unknown as FixtureWindow;
    return (
      !w.__muxXR.getState().scene.focusModeTerminalId &&
      !w.__questScene.getObjectByName('terminal-panel-demo-2')?.userData.focusHidden
    );
  });
  const restored = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const target = w.__questScene.getObjectByName('terminal-panel-demo-1');
    if (!target) throw new Error('Restored pane missing');
    return (
      JSON.stringify({
        position: target.position.toArray(),
        quaternion: target.quaternion.toArray(),
        scale: target.scale.toArray(),
      }) === JSON.stringify(w.__focusOriginal)
    );
  });
  if (!restored || errors.length)
    throw new Error(`Focus restoration failed: ${JSON.stringify({ restored, errors })}`);
  await page.screenshot({ path: join(root, 'focus-restored.png') });
  const result = {
    kind: 'native-focus-mode',
    gripSuppressed: true,
    heldBConsumed: true,
    exactRestore: restored,
    hiddenPane: true,
    ...focused,
    errors,
  };
  await writeFile(join(root, 'focus-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
