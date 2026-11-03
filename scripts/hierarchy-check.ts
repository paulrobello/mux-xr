import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type * as THREE from 'three';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __designScene: WorkspaceScene;
  __questRenderer: THREE.WebGLRenderer;
  __questThree: typeof THREE;
  __questControllers: THREE.Group[];
};

const root = process.env.MUX_XR_TEST_ROOT;
if (process.env.MUX_XR_PRIVATE_TEST !== '1' || !root)
  throw new Error('Hierarchy check requires MUX_XR_PRIVATE_TEST=1 and MUX_XR_TEST_ROOT');
const testRoot = resolve(root);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadBefore = loadavg()[0];
if (loadBefore > 15) throw new Error(`Host load too high: ${loadBefore}`);
await mkdir(testRoot, { recursive: true });
prepareQuestFixture(testRoot);
const entry = join(testRoot, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}\nObject.assign(window, { __designScene: scene });\n`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', testRoot], {
  cwd: repoRoot,
  stdio: 'pipe',
});

const contentTypes: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const relative = pathname === '/' ? '__quest-controls.html' : pathname.replace(/^\/+/, '');
  const servedRoot =
    relative.startsWith('assets/') || relative.startsWith('fonts/')
      ? join(repoRoot, 'public')
      : testRoot;
  const file = resolve(servedRoot, normalize(relative));
  if (!file.startsWith(`${servedRoot}/`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolveServer, reject) => {
  server.once('error', reject);
  server.listen(4241, '127.0.0.1', () => resolveServer());
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

async function selectControllerTarget(selector: string): Promise<void> {
  await page.evaluate((objectSelector) => {
    const w = window as unknown as FixtureWindow;
    const object = w.__designScene.scene.getObjectByName(objectSelector);
    if (!object) throw new Error(`Missing XR target ${objectSelector}`);
    const controller = w.__questControllers[0];
    const rotation = object.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(object.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
    controller.quaternion.copy(rotation);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
  }, selector);
}

try {
  await page.goto('http://127.0.0.1:4241/__quest-controls.html?demo=1', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).__designScene));
  const renderer = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const gl = w.__questRenderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const value = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (!value || /SwiftShader/i.test(value) || !/Apple M4/i.test(value))
      throw new Error(`Wrong GPU: ${value}`);
    return value;
  });
  const selector = page.locator('[data-hierarchy-style]');
  await page.locator('[data-action="settings"]').click();
  await selector.selectOption('spatial-docks');
  await page.waitForFunction(
    () =>
      (window as unknown as FixtureWindow).__designScene.state.hierarchyStyle === 'spatial-docks',
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mux-xr:settings:v1') ?? '{}'),
  );
  if (stored.hierarchyStyle !== 'spatial-docks')
    throw new Error('Hierarchy style was not persisted');
  await page.locator('[data-action="close-settings"]').click();
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__designScene.state.xrMode === 'vr',
  );
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__designScene.setBackground('black'),
  );

  const inspectStyle = async (style: 'helix' | 'spatial-docks', screenshot: string) => {
    await page.locator('[data-action="settings"]').click();
    await selector.selectOption(style);
    await page.locator('[data-action="close-settings"]').click();
    await page.evaluate(() =>
      (window as unknown as FixtureWindow).__designScene.showInput('panes'),
    );
    await page.evaluate(() =>
      (window as unknown as FixtureWindow).__designScene.setBackground('black'),
    );
    await page.waitForFunction(() =>
      Boolean(
        (window as unknown as FixtureWindow).__designScene.scene.getObjectByName(
          'hierarchy-navigator',
        ),
      ),
    );
    const geometry = await page.evaluate(() => {
      const scene = (window as unknown as FixtureWindow).__designScene;
      const root = scene.scene.getObjectByName('hierarchy-navigator');
      if (!root || root.children.length < 2)
        throw new Error('Hierarchy has insufficient 3D geometry');
      let meshes = 0;
      root.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) meshes += 1;
      });
      if (meshes < 2) throw new Error('Hierarchy contains no rendered 3D nodes');
      return { style: root.userData.hierarchyStyle, meshes };
    });
    if (geometry.style !== style)
      throw new Error(`Expected ${style}, got ${String(geometry.style)}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(testRoot, screenshot) });
    return geometry;
  };
  const spatial = await inspectStyle('spatial-docks', 'hierarchy-spatial-docks.png');
  const node = await page.evaluate(() => {
    const scene = (window as unknown as FixtureWindow).__designScene.scene;
    let target: THREE.Object3D | undefined;
    scene.getObjectByName('hierarchy-navigator')?.traverse((object) => {
      if (!target && object.userData.inputAction === 'hierarchyNode') target = object;
    });
    if (!target) throw new Error('No hierarchy node action target');
    target.name = '__hierarchy-branch-target';
    return target.name;
  });
  await selectControllerTarget(node);
  await page.waitForTimeout(100);
  const pathLength = await page.evaluate(() => {
    const root = (window as unknown as FixtureWindow).__designScene.scene.getObjectByName(
      'hierarchy-navigator',
    );
    return Array.isArray(root?.userData.hierarchyPath) ? root.userData.hierarchyPath.length : 0;
  });
  if (pathLength < 1) throw new Error('Controller selection did not advance hierarchy path');
  const paneTarget = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    let target: THREE.Object3D | undefined;
    w.__designScene.scene.getObjectByName('hierarchy-navigator')?.traverse((object) => {
      if (!target && object.userData.inputAction === 'pane') target = object;
    });
    if (!target) throw new Error('No existing pane available from hierarchy');
    target.name = '__hierarchy-pane-target';
    return { name: target.name, id: String(target.userData.paneId) };
  });
  await selectControllerTarget(paneTarget.name);
  await page.waitForFunction((id) => {
    const scene = (window as unknown as FixtureWindow).__designScene;
    return (
      scene.state.selectedTerminalId === id && !scene.scene.getObjectByName('hierarchy-navigator')
    );
  }, paneTarget.id);
  const restoredViews = await page.evaluate(() => {
    const scene = (window as unknown as FixtureWindow).__designScene;
    return scene.scene.children
      .filter((object) => object.name.startsWith('terminal-panel-'))
      .every((object) => object.visible);
  });
  if (!restoredViews) throw new Error('Closing the navigator left terminal views hidden');
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__designScene.showInput('display'),
  );
  await page.waitForFunction(() => {
    const scene = (window as unknown as FixtureWindow).__designScene;
    let found = false;
    scene.scene.traverse((object) => {
      if (object.userData.inputAction === 'hierarchyStyle') found = true;
    });
    return found;
  });
  const displayTarget = await page.evaluate(() => {
    const scene = (window as unknown as FixtureWindow).__designScene.scene;
    let target: THREE.Object3D | undefined;
    scene.traverse((object) => {
      if (!target && object.userData.inputAction === 'hierarchyStyle') target = object;
    });
    if (!target) throw new Error('Native hierarchy style control missing');
    target.name = '__hierarchy-style-target';
    return target.name;
  });
  await selectControllerTarget(displayTarget);
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__designScene.state.hierarchyStyle === 'helix',
  );
  if ((await selector.inputValue()) !== 'helix')
    throw new Error('Native style control did not sync browser settings');
  const helix = await inspectStyle('helix', 'hierarchy-helix.png');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).__designScene));
  const restored = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    if (w.__designScene.state.hierarchyStyle !== 'helix')
      throw new Error('Reload did not restore style');
    return w.__designScene.state.hierarchyStyle;
  });
  const loadAfter = loadavg()[0];
  if (loadAfter > 15 || errors.length) throw new Error(JSON.stringify({ loadAfter, errors }));
  const result = {
    kind: 'native-hierarchy-style',
    renderer,
    spatial,
    helix,
    restored,
    loadBefore,
    loadAfter,
    errors,
  };
  await writeFile(join(testRoot, 'hierarchy-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
}
