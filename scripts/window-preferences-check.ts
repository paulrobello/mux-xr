import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type * as THREE from 'three';
import type { PaneDescriptor, TerminalSurface } from '../src/contracts';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __designScene: WorkspaceScene;
  __demoSurface(pane: PaneDescriptor): TerminalSurface;
  __questCamera: THREE.PerspectiveCamera;
  __questRenderer: THREE.WebGLRenderer;
  __questThree: typeof THREE;
  __originalPose: string;
};

const base = process.env.MUX_XR_BASE_URL;
const root = process.env.MUX_XR_TEST_ROOT;
if (!base || !root || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error('Window preferences check requires an explicit private URL and root');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  throw new Error('Window preferences check only accepts loopback');
const loadBefore = loadavg()[0];
if (loadBefore > 15) throw new Error(`Host load too high: ${loadBefore}`);
await mkdir(root, { recursive: true });
prepareQuestFixture(root);
const entry = join(root, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}\nObject.assign(window, { __designScene: scene, __demoSurface: createDemoSurface });\n`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', root], { stdio: 'pipe' });
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.routeWebSocket(/.*/, (socket) => socket.close());
try {
  await page.goto(`${base}/__quest-controls.html?demo=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).__designScene));
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-window-opacity]').fill('40');
  await page.locator('[data-focus-curvature]').fill('35');
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const scene = w.__designScene;
    if (scene.getTerminalOpacity('demo-1') !== 1 || scene.getTerminalOpacity('demo-2') !== 1)
      throw new Error('Changing the default changed existing panes');
    scene.addTerminal(
      w.__demoSurface({
        id: 'third',
        title: 'New default opacity',
        workspaceId: 'w',
        workspaceName: 'W',
        sessionId: 's',
        sessionName: 'S',
        windowId: 'win',
        windowName: 'Win',
      }),
    );
    if (scene.getTerminalOpacity('third') !== 0.4)
      throw new Error('New pane did not inherit opacity');
    scene.setTerminalOpacity('demo-1', 0.7);
    scene.setTerminalCurvature('demo-1', 80);
  });
  await page.locator('[data-action="close-settings"]').click();
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__designScene.state.xrMode === 'vr',
  );
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const scene = w.__designScene;
    const pane = scene.scene.getObjectByName('terminal-panel-demo-1');
    if (!pane) throw new Error('Terminal missing');
    w.__originalPose = JSON.stringify([
      pane.position.toArray(),
      pane.quaternion.toArray(),
      pane.scale.toArray(),
    ]);
    scene.toggleFocusMode('demo-1');
  });
  await page.waitForTimeout(400);
  const focused = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const pane = w.__designScene.scene.getObjectByName('terminal-panel-demo-1');
    if (pane?.userData.curvatureDegrees !== 35) throw new Error('Focus warp was not applied');
    const bounds = new w.__questThree.Box3().setFromObject(pane);
    const center = bounds.getCenter(new w.__questThree.Vector3());
    const eye = w.__questCamera.getWorldPosition(new w.__questThree.Vector3());
    const forward = w.__questCamera.getWorldDirection(new w.__questThree.Vector3());
    const depth = center.clone().sub(eye).dot(forward);
    if (Math.abs(depth - 1.5) > 0.03) throw new Error(`Focus depth ${depth} differs from 1.5m`);
    if (w.__designScene.scene.getObjectByName('terminal-panel-demo-2')?.visible)
      throw new Error('Other pane stayed visible');
    w.__designScene.showInput('display');
    const gl = w.__questRenderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (!/Apple M4/.test(renderer) || /SwiftShader/i.test(renderer))
      throw new Error(`Wrong GPU: ${renderer}`);
    return { depth, renderer };
  });
  await page.screenshot({ path: join(root, 'window-focus-settings.png') });
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    let button: THREE.Object3D | undefined;
    w.__designScene.scene.traverse((object) => {
      if (
        object.userData.inputAction === 'windowPreference' &&
        object.userData.preference === 'focusDistance' &&
        object.userData.delta > 0
      )
        button = object;
    });
    if (!button) throw new Error('Native focus-distance button missing');
    const controllers = (w as unknown as { __questControllers: THREE.Group[] }).__questControllers;
    const owner = controllers[0];
    const rotation = button.getWorldQuaternion(new w.__questThree.Quaternion());
    owner.position
      .copy(button.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
    owner.quaternion.copy(rotation);
    owner.dispatchEvent({ type: 'selectstart' } as never);
    owner.dispatchEvent({ type: 'selectend' } as never);
    if (Math.abs(w.__designScene.state.windowPreferences.focusDistance - 1.6) > 1e-6)
      throw new Error('Native setting action did not run');
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const scene = w.__designScene;
    scene.hideInput();
    scene.toggleFocusMode();
    const pane = scene.scene.getObjectByName('terminal-panel-demo-1');
    if (
      pane?.userData.curvatureDegrees !== 80 ||
      JSON.stringify([pane.position.toArray(), pane.quaternion.toArray(), pane.scale.toArray()]) !==
        w.__originalPose
    )
      throw new Error('Focus changed original placement or warp');
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, 'window-focus-restored.png') });
  await page.reload({ waitUntil: 'load' });
  const restored = await page.evaluate(() => {
    const scene = (window as unknown as FixtureWindow).__designScene;
    if (
      scene.state.windowPreferences.defaultOpacity !== 0.4 ||
      Math.abs(scene.state.windowPreferences.focusDistance - 1.6) > 1e-6 ||
      scene.state.windowPreferences.focusCurvature !== 35
    )
      throw new Error('Preferences not restored');
    if (scene.getTerminalOpacity('demo-1') !== 0.7 || scene.getTerminalOpacity('demo-2') !== 0.4)
      throw new Error('Saved pane override or new-view default lost');
    return scene.state.windowPreferences;
  });
  const loadAfter = loadavg()[0];
  if (loadAfter > 15 || errors.length) throw new Error(JSON.stringify({ loadAfter, errors }));
  const result = {
    kind: 'native-window-preferences',
    ...focused,
    loadBefore,
    loadAfter,
    restored,
    errors,
    sockets: 'all intercepted; no mux daemon',
  };
  await writeFile(join(root, 'window-preferences-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
