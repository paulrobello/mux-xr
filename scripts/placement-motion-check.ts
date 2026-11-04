import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import type * as THREE from 'three';
import type { TerminalSurface } from '../src/contracts';
import { workspaceFloorY } from '../src/xr/floor-layout';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __placementScene: WorkspaceScene;
  __placementSurfaces: Map<string, TerminalSurface>;
  __questThree: typeof THREE;
  __questRenderer: THREE.WebGLRenderer;
  __questControllers: THREE.Group[];
};
const root = process.env.MUX_XR_TEST_ROOT;
if (process.env.MUX_XR_PRIVATE_TEST !== '1' || !root)
  throw new Error('Placement check requires MUX_XR_PRIVATE_TEST=1 and MUX_XR_TEST_ROOT');
const testRoot = resolve(root);
const before = loadavg()[0];
if (before > 15) throw new Error(`Host load too high: ${before}`);
await mkdir(testRoot, { recursive: true });
prepareQuestFixture(testRoot);
const entry = join(testRoot, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}\nObject.assign(window, { __placementScene: scene, __placementSurfaces: surfaces });\n`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', testRoot], {
  stdio: 'pipe',
});
const server = createServer(async (request, response) => {
  const requestPath = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const relative = requestPath === '/' ? '__quest-controls.html' : requestPath.replace(/^\/+/, '');
  const servedRoot =
    relative.startsWith('fonts/') || relative.startsWith('assets/') ? resolve('public') : testRoot;
  const file = resolve(servedRoot, normalize(relative));
  if (!file.startsWith(`${servedRoot}/`)) return response.writeHead(403).end();
  try {
    const types: Record<string, string> = {
      '.css': 'text/css',
      '.html': 'text/html',
      '.js': 'text/javascript',
    };
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolveServer, reject) => {
  server.once('error', reject);
  server.listen(4241, '127.0.0.1', resolveServer);
});
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
const bounds = (): Promise<{ minY: number; maxY: number; count: number }> =>
  page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const result = new w.__questThree.Box3().makeEmpty();
    let count = 0;
    w.__placementScene.scene.traverse((object) => {
      if (!object.name.startsWith('terminal-panel-')) return;
      result.union(new w.__questThree.Box3().setFromObject(object));
      count += 1;
    });
    return { minY: result.min.y, maxY: result.max.y, count };
  });
const assertFloor = async (
  floor: number,
  label: string,
): Promise<{ minY: number; maxY: number; count: number }> => {
  await page.waitForTimeout(100);
  const measured = await bounds();
  if (measured.minY < floor + 0.06 - 1e-4)
    throw new Error(`${label} below floor: ${JSON.stringify(measured)}`);
  return measured;
};
try {
  await page.goto('http://127.0.0.1:4241/__quest-controls.html?demo=1', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).__placementScene));
  const renderer = await page.evaluate(() => {
    const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
  });
  if (!/Apple/.test(renderer) || /SwiftShader/i.test(renderer))
    throw new Error(`Wrong GPU: ${renderer}`);
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__placementScene.state.xrMode === 'vr',
  );
  const floor = workspaceFloorY('observatory', 'vr');
  if (floor === null) throw new Error('Observatory floor unexpectedly unconstrained');
  const arranged = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__placementScene.setBackground('observatory');
    w.__placementScene.setTerminalCurvature('demo-1', 100);
    w.__placementScene.arrangeTerminals('sphere');
    return [...w.__placementSurfaces.keys()];
  });
  if (arranged.length < 2) throw new Error('Expected two demo panes');
  const arrangedBounds = await assertFloor(floor, 'arrangement');
  const grown = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const surface = w.__placementSurfaces.get('demo-1');
    if (!surface?.resizeGrid(80, 60)) throw new Error('Grid growth rejected');
    w.__placementScene.setTerminalCurvature('demo-1', 100);
    return surface.cols;
  });
  if (grown !== 80) throw new Error('Grid dimensions were not retained');
  const grownBounds = await assertFloor(floor, 'grid growth');
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__placementScene.restoreTerminalPose('demo-1', {
      position: [0, -1.2, -1.4],
      quaternion: [0, 0, 0, 1],
      scale: 1,
    });
  });
  const restoredBounds = await assertFloor(floor, 'restored pose');
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__placementScene.showInput('widgets');
    let target: THREE.Object3D | undefined;
    w.__placementScene.scene.traverse((object) => {
      if (
        !target &&
        object.userData.inputAction === 'toggleWidget' &&
        object.userData.widgetKind === 'digital-clock'
      )
        target = object;
    });
    if (!target) throw new Error('Digital clock control missing');
    w.__placementScene.scene.updateMatrixWorld(true);
    const controller = w.__questControllers[0];
    const rotation = target.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(target.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
    controller.quaternion.copy(rotation);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
  });
  const widgetPose = await page.evaluate(async () => {
    const w = window as unknown as FixtureWindow;
    const clock = w.__placementScene.scene.children.find(
      (object) => object.userData.widgetKind === 'digital-clock',
    );
    if (!clock) throw new Error('Clock missing after activation');
    let body: THREE.Object3D | undefined;
    clock.traverse((object) => {
      if (!body && (object as THREE.Mesh).isMesh && object.userData.inputAction === 'grabWidget')
        body = object;
    });
    if (!body) throw new Error('Clock grip body missing');
    w.__placementScene.scene.updateMatrixWorld(true);
    const controller = w.__questControllers[0],
      rotation = body.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(body.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
    controller.quaternion.copy(rotation);
    const before = clock.position.clone();
    controller.dispatchEvent({ type: 'squeezestart' } as never);
    controller.position.x += 0.25;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    if (clock.position.distanceTo(before) < 0.1) throw new Error('Clock did not move with grip');
    const moved = clock.position.clone();
    w.__placementScene.showInput('settings');
    w.__placementScene.setKeyboardCurvature(40);
    w.__placementScene.arrangeTerminals('grid');
    w.__questRenderer.xr.getCamera().position.x += 0.2;
    for (let frame = 0; frame < 25; frame++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (clock.position.distanceTo(moved) > 1e-5)
      throw new Error('Clock reset after release/menu/layout/head movement');
    return moved.toArray();
  });
  await page.screenshot({ path: join(testRoot, 'placement-and-clock.png') });
  const after = loadavg()[0];
  if (after > 15 || errors.length) throw new Error(JSON.stringify({ after, errors }));
  const result = {
    kind: 'native-placement-motion',
    renderer,
    before,
    after,
    floor,
    arrangedBounds,
    grownBounds,
    restoredBounds,
    widgetPose,
    errors,
  };
  await writeFile(join(testRoot, 'placement-motion-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
}
