import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type * as THREE from 'three';
import type { TerminalSurface } from '../src/contracts';
import type { SpeechInput } from '../src/speech-input';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __designScene: WorkspaceScene;
  __questRenderer: THREE.WebGLRenderer;
  __questThree: typeof THREE;
  __questControllers: THREE.Group[];
  __speech: SpeechInput;
  __surfaces: Map<string, TerminalSurface>;
};

const rootPath = process.env.MUX_XR_TEST_ROOT;
if (process.env.MUX_XR_PRIVATE_TEST !== '1' || !rootPath)
  throw new Error('Input refinement check requires MUX_XR_PRIVATE_TEST=1 and MUX_XR_TEST_ROOT');
const testRoot = resolve(rootPath);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadBefore = loadavg()[0];
if (loadBefore > 15) throw new Error(`Host load too high: ${loadBefore}`);
await mkdir(testRoot, { recursive: true });
prepareQuestFixture(testRoot);
const entry = join(testRoot, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}\nObject.assign(window, { __designScene: scene, __speech: speechInput, __surfaces: surfaces });\n`,
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
  '.ttf': 'font/ttf',
};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const relative = pathname === '/' ? '__quest-controls.html' : pathname.replace(/^\/+/, '');
  const servedRoot =
    relative.startsWith('assets/') || relative.startsWith('fonts/')
      ? join(repoRoot, 'public')
      : testRoot;
  const file = resolve(servedRoot, normalize(relative));
  if (!file.startsWith(`${servedRoot}/`)) return response.writeHead(403).end();
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
await new Promise<void>((done, reject) => {
  server.once('error', reject);
  server.listen(4241, '127.0.0.1', () => done());
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
await page.addInitScript(() => {
  class FakeRecognition {
    static latest: FakeRecognition | undefined;
    onstart?: () => void;
    onend?: () => void;
    onresult?: (event: unknown) => void;
    onerror?: (event: unknown) => void;
    continuous = false;
    interimResults = false;
    constructor() {
      FakeRecognition.latest = this;
    }
    start(): void {
      this.onstart?.();
    }
    stop(): void {
      this.onend?.();
    }
    abort(): void {
      this.onend?.();
    }
    emitResult(text: string): void {
      this.onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript: text }], { isFinal: true })],
      });
    }
  }
  Object.assign(window, {
    MediaRecorder: undefined,
    SpeechRecognition: FakeRecognition,
    webkitSpeechRecognition: FakeRecognition,
    __FakeRecognition: FakeRecognition,
  });
});
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.routeWebSocket(/.*/, (socket) => socket.close());

async function clickNative(
  action: string,
  match?: (data: Record<string, unknown>) => boolean,
): Promise<void> {
  await page.evaluate(
    async ({ action, matchSource }) => {
      const w = window as unknown as FixtureWindow;
      let target: THREE.Object3D | undefined;
      w.__designScene.scene.traverse((object: THREE.Object3D) => {
        if (target || object.userData.inputAction !== action) return;
        if (matchSource && !new Function('data', `return (${matchSource})(data)`)(object.userData))
          return;
        target = object;
      });
      if (!target) throw new Error(`Missing native action ${action}`);
      const controller = w.__questControllers[0];
      const point = target.getWorldPosition(new w.__questThree.Vector3());
      const rotation = target.getWorldQuaternion(new w.__questThree.Quaternion());
      controller.position
        .copy(point)
        .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
      controller.quaternion.copy(rotation);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
    },
    { action, matchSource: match ? match.toString() : undefined },
  );
}
const waitFor = async (predicate: () => Promise<boolean>, message: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(message);
};

try {
  await page.goto('http://127.0.0.1:4241/__quest-controls.html?demo=1', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).__designScene));
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__designScene.state.xrMode === 'vr',
  );
  const renderer = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const gl = w.__questRenderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const value = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (!/Apple M4/i.test(value) || /SwiftShader/i.test(value))
      throw new Error(`Wrong GPU: ${value}`);
    return value;
  });
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__designScene.setBackground('black'),
  );

  await page.evaluate(() => (window as unknown as FixtureWindow).__designScene.showInput('panes'));
  await waitFor(
    async () =>
      page.evaluate(() =>
        Boolean(
          document.querySelector('.hierarchy-navigator') ||
            (window as unknown as FixtureWindow).__designScene.scene.getObjectByName(
              'hierarchy-navigator',
            ),
        ),
      ),
    'Hierarchy did not open',
  );
  const hierarchyInitial = await page.evaluate(() => {
    const root = (window as unknown as FixtureWindow).__designScene.scene.getObjectByName(
      'hierarchy-navigator',
    );
    const actions: string[] = [];
    root?.traverse((object: THREE.Object3D) => {
      if (object.userData.inputAction) actions.push(String(object.userData.inputAction));
    });
    return { path: root?.userData.hierarchyPath, actions };
  });
  if (!Array.isArray(hierarchyInitial.path) || hierarchyInitial.path.length !== 1)
    throw new Error(
      `Expected workspace-initialized hierarchy, got ${JSON.stringify(hierarchyInitial.path)}`,
    );
  await clickNative(
    'hierarchyNode',
    (data) => Array.isArray(data.hierarchyPath) && data.hierarchyPath.length === 2,
  );
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const pane = [...w.__surfaces.values()][0].pane;
    w.__designScene.setAvailablePanes(
      Array.from({ length: 6 }, (_, index) => ({
        ...pane,
        id: `layout-${index}`,
        windowId: `layout-window-${index}`,
        windowName: `Window ${index + 1}`,
        title: `Layout pane ${index + 1}`,
      })),
    );
  });
  await waitFor(
    async () =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as FixtureWindow).__designScene.scene.getObjectByName(
            'hierarchy-navigator',
          ),
        ),
      ),
    'Session navigation closed hierarchy',
  );
  await page.waitForTimeout(400);
  const childLabelBounds = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow & { __questCamera: THREE.Camera };
    const navigator = w.__designScene.scene.getObjectByName('hierarchy-navigator');
    const nodes = navigator?.userData.hierarchyNodes as Array<{
      node: { kind: string };
      object: THREE.Group;
    }>;
    w.__designScene.scene.updateMatrixWorld(true);
    return nodes
      .filter((entry) => entry.node.kind === 'window')
      .map((entry) => {
        const label = entry.object.children.find(
          (child) => typeof child.userData.labelWidth === 'number',
        );
        if (!label) throw new Error('Window label missing');
        const width = Number(label.userData.labelWidth) / 2;
        const height = Number(label.userData.labelHeight) / 2;
        const corners = [
          [-width, -height],
          [-width, height],
          [width, -height],
          [width, height],
        ].map(([x, y]) =>
          label.localToWorld(new w.__questThree.Vector3(x, y, 0)).project(w.__questCamera),
        );
        return {
          left: Math.min(...corners.map((point) => point.x)),
          right: Math.max(...corners.map((point) => point.x)),
          bottom: Math.min(...corners.map((point) => point.y)),
          top: Math.max(...corners.map((point) => point.y)),
        };
      });
  });
  if (childLabelBounds.length !== 6) throw new Error('Expected six active child labels');
  for (let a = 0; a < childLabelBounds.length; a++)
    for (let b = a + 1; b < childLabelBounds.length; b++) {
      const left = childLabelBounds[a],
        right = childLabelBounds[b];
      if (
        left.left < right.right &&
        left.right > right.left &&
        left.bottom < right.top &&
        left.top > right.bottom
      )
        throw new Error(`Projected child labels overlap: ${a},${b}`);
    }
  await page.screenshot({ path: join(testRoot, 'input-refinement-hierarchy.png') });
  await page.evaluate(async () => {
    const w = window as unknown as FixtureWindow & {
      __questPad?: { buttons: Array<{ pressed: boolean }>; axes: number[] };
    };
    const pad = w.__questPad ?? {
      buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
      axes: [0, 0, 0, 0],
    };
    w.__questPad = pad;
    w.__questControllers[1].dispatchEvent({
      type: 'connected',
      data: { gamepad: pad, handedness: 'right' },
    } as never);
    pad.buttons[5].pressed = true;
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
    pad.buttons[5].pressed = false;
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
  const gamepadState = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    return {
      hierarchyGone: !w.__designScene.scene.getObjectByName('hierarchy-navigator'),
      focusModeTerminalId: w.__designScene.state.focusModeTerminalId,
      terminalsVisible: w.__designScene.scene.children
        .filter((object: THREE.Object3D) => object.name.startsWith('terminal-panel-'))
        .every((object: THREE.Object3D) => object.visible),
    };
  });
  if (
    !gamepadState.hierarchyGone ||
    gamepadState.focusModeTerminalId !== null ||
    !gamepadState.terminalsVisible
  )
    throw new Error(`Gamepad B behavior failed: ${JSON.stringify(gamepadState)}`);
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const scene = w.__designScene;
    scene.setAvailablePanes([...w.__surfaces.values()].map((surface) => surface.pane));
    scene.setWindowPreferences({
      ...scene.state.windowPreferences,
      focusCurvature: 100,
      focusDistance: 1.5,
    });
    scene.toggleFocusMode('demo-1');
    scene.setBackground('black');
  });
  await page.waitForTimeout(500);
  const warpedRim = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const panel = w.__designScene.scene.getObjectByName('terminal-panel-demo-1');
    const screen = panel?.getObjectByName('terminal-surface') as THREE.Mesh;
    const frame = panel?.getObjectByName('terminal-frame') as THREE.Mesh;
    screen.geometry.computeBoundingBox();
    frame.geometry.computeBoundingBox();
    const screenBounds = screen.geometry.boundingBox,
      frameBounds = frame.geometry.boundingBox;
    if (
      !screenBounds ||
      !frameBounds ||
      frameBounds.max.x <= screenBounds.max.x ||
      frameBounds.min.x >= screenBounds.min.x
    )
      throw new Error('Warped rim does not extend beyond screen edges');
    return {
      screenWidth: screenBounds.max.x - screenBounds.min.x,
      frameWidth: frameBounds.max.x - frameBounds.min.x,
    };
  });
  await page.screenshot({ path: join(testRoot, 'input-refinement-warped-rim.png') });
  await page.evaluate(() => (window as unknown as FixtureWindow).__designScene.toggleFocusMode());

  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-keyboard-curvature]').fill('90');
  await page.locator('[data-keyboard-curvature]').dispatchEvent('input');
  await page.locator('[data-action="close-settings"]').click();
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__designScene.showInput('keyboard'),
  );
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__designScene.state.keyboardCurvature === 90,
  );
  await clickNative('dictation', (data) => data.dictationAction === 'start');
  await waitFor(
    async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __FakeRecognition: {
                latest: { onstart?: () => void; emitResult(text: string): void; stop(): void };
              };
            }
          ).__FakeRecognition.latest !== undefined,
      ),
    'Fake speech did not start',
  );
  await page.evaluate(() =>
    (
      window as unknown as {
        __FakeRecognition: { latest: { emitResult(text: string): void; stop(): void } };
      }
    ).__FakeRecognition.latest.emitResult('hello from fake speech'),
  );
  await clickNative('dictation', (data) => data.dictationAction === 'stop');
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-dictation-draft]') as HTMLTextAreaElement)?.value ===
      'hello from fake speech',
  );
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__speech.editDraft('edited synthetic text'),
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(testRoot, 'input-refinement-dictation-review.png') });
  const before = await page.evaluate(
    () => (window as unknown as FixtureWindow).__designScene.state.selectedTerminalId,
  );
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow & {
      __sentTexts: Array<{ id: string; text: string }>;
    };
    w.__sentTexts = [];
    for (const surface of w.__surfaces.values()) {
      const original = surface.sendText.bind(surface);
      surface.sendText = (text: string) => {
        w.__sentTexts.push({ id: surface.pane.id, text });
        return original(text);
      };
    }
  });
  await clickNative('dictation', (data) => data.dictationAction === 'insert');
  const sent = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow & {
      __sentTexts: Array<{ id: string; text: string }>;
    };
    return { id: w.__sentTexts[0]?.id, calls: w.__sentTexts };
  });
  if (sent.id !== before) throw new Error('Dictation target changed during review');
  if (sent.calls.length !== 1 || sent.calls[0].text !== 'edited synthetic text')
    throw new Error(`Unexpected dictation insertion: ${JSON.stringify(sent.calls)}`);

  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__designScene.setBackground('black'),
  );
  await page.screenshot({ path: join(testRoot, 'input-refinement-keyboard.png') });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__designScene?.state.keyboardCurvature === 90,
  );
  const loadAfter = loadavg()[0];
  if (loadAfter > 15 || errors.length) throw new Error(JSON.stringify({ loadAfter, errors }));
  await writeFile(
    join(testRoot, 'input-refinement-result.json'),
    JSON.stringify(
      {
        renderer,
        hierarchyInitial,
        keyboardCurvature: 90,
        childLabelBounds,
        warpedRim,
        syntheticSpeech: true,
        dictationTarget: before,
        loadBefore,
        loadAfter,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
}
