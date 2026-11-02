import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __muxXR: {
    getState(): {
      scene: {
        xrMode: string;
        widgets: string[];
        filtering: { mode: string; anisotropy: number; gazeClarity: boolean };
      };
    };
  };
  __questScene: import('three').Scene;
  __questControllers: import('three').Group[];
  __questThree: typeof import('three');
  __questCamera: import('three').PerspectiveCamera;
  __questRenderer: import('three').WebGLRenderer;
  __widgetsPad: { buttons: Array<{ pressed: boolean }>; axes: number[] };
};
type Pose = { position: number[]; quaternion: number[]; scale: number[] };

const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
if (!BASE_URL || !TEST_ROOT || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error(
    'Widgets clarity verification requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT',
  );
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE_URL).hostname))
  throw new Error('Widgets clarity verification is loopback-only');

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function assertPoseClose(actual: Pose | undefined, expected: Pose, label: string): void {
  assert(actual, `${label} was not restored`);
  const values = [...actual.position, ...actual.quaternion, ...actual.scale];
  assert(values.every(Number.isFinite), `${label} contains non-finite values`);
  const expectedValues = [...expected.position, ...expected.quaternion, ...expected.scale];
  assert(
    values.length === expectedValues.length &&
      values.every((value, index) => Math.abs(value - expectedValues[index]) <= 1e-6),
    `${label} changed across reload: ${JSON.stringify({ expected, actual })}`,
  );
}
async function waitFor(
  page: Page,
  predicate: () => Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(message);
}
async function target(
  page: Page,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await page.evaluate(
    async ({ action, extra }) => {
      const w = window as unknown as FixtureWindow;
      let hit: import('three').Object3D | undefined;
      w.__questScene.traverse((object) => {
        if (
          !hit &&
          object.visible &&
          (() => {
            for (let parent = object.parent; parent; parent = parent.parent)
              if (!parent.visible) return false;
            return true;
          })() &&
          object.userData.inputAction === action &&
          Object.entries(extra).every(([key, value]) => object.userData[key] === value)
        )
          hit = object;
      });
      if (!hit) throw new Error(`Native control missing: ${action} ${JSON.stringify(extra)}`);
      const point = hit.getWorldPosition(new w.__questThree.Vector3());
      const rotation = hit.getWorldQuaternion(new w.__questThree.Quaternion());
      const controller = w.__questControllers[0];
      controller.position
        .copy(point)
        .add(new w.__questThree.Vector3(0, 0, 0.35).applyQuaternion(rotation));
      controller.quaternion.copy(rotation);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    { action, extra },
  );
}
async function pressA(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as FixtureWindow;
    w.__widgetsPad.buttons[4].pressed = true;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    w.__widgetsPad.buttons[4].pressed = false;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function widgetPixels(page: Page, name: string): Promise<{ visible: number; delta: number }> {
  return page.evaluate((name) => {
    const w = window as unknown as FixtureWindow;
    const object = w.__questScene.getObjectByName(name);
    if (!object) throw new Error(`Widget missing for pixel check: ${name}`);
    object.updateWorldMatrix(true, true);
    const center = object.getWorldPosition(new w.__questThree.Vector3()).project(w.__questCamera);
    const gl = w.__questRenderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const x = Math.max(0, Math.min(width - 40, Math.round(((center.x + 1) * width) / 2) - 40));
    const y = Math.max(0, Math.min(height - 40, Math.round(((center.y + 1) * height) / 2) - 40));
    const read = (): Uint8Array => {
      w.__questRenderer.render(w.__questScene, w.__questCamera);
      const pixels = new Uint8Array(80 * 80 * 4);
      gl.readPixels(x, y, 80, 80, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const visiblePixels = read();
    object.visible = false;
    const hiddenPixels = read();
    object.visible = true;
    let visible = 0;
    let delta = 0;
    for (let index = 0; index < visiblePixels.length; index += 4) {
      if (visiblePixels[index] + visiblePixels[index + 1] + visiblePixels[index + 2] > 120)
        visible += 1;
      if (
        Math.abs(visiblePixels[index] - hiddenPixels[index]) +
          Math.abs(visiblePixels[index + 1] - hiddenPixels[index + 1]) +
          Math.abs(visiblePixels[index + 2] - hiddenPixels[index + 2]) >
        8
      )
        delta += 1;
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`WebGL error while reading widget pixels: ${error}`);
    return { visible, delta };
  }, name);
}

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
page.on('console', (message) => {
  if (/Troika|Failure loading font|Creating a worker|Shader Error|GL_INVALID/i.test(message.text()))
    errors.push(message.text());
});
try {
  await mkdir(TEST_ROOT, { recursive: true });
  prepareQuestFixture(TEST_ROOT);
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.goto(`${BASE_URL}/__quest-controls.html?demo=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  await waitFor(
    page,
    async () =>
      (await page.evaluate(() => Boolean((window as unknown as FixtureWindow).__muxXR))) &&
      (await page.evaluate(
        () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode,
      )) === 'desktop',
    'App did not initialize',
  );
  await page.locator('[data-action="xr"]').click();
  await waitFor(
    page,
    async () =>
      (await page.evaluate(
        () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode,
      )) === 'vr',
    'XR did not start',
  );
  const renderer = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const gl = w.__questRenderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  });
  assert(
    renderer && renderer !== 'unknown' && !/swiftshader/i.test(renderer),
    `Unsupported renderer: ${renderer}`,
  );

  await target(page, 'openInput', { mode: 'widgets' });
  assert(
    await page.evaluate(() =>
      Boolean(
        (window as unknown as FixtureWindow).__questScene.getObjectByName('xr-widgets-controls'),
      ),
    ),
    'Widgets HUD did not replace keyboard',
  );
  assert(
    !(await page.evaluate(() =>
      Boolean(
        (window as unknown as FixtureWindow).__questScene.getObjectByName('xr-keyboard-controls'),
      ),
    )),
    'Keyboard remained visible in Widgets mode',
  );
  await page.screenshot({ path: join(TEST_ROOT, 'widgets-menu.png') });

  await target(page, 'toggleWidget', { widgetKind: 'digital-clock' });
  await waitFor(
    page,
    async () =>
      (
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.widgets,
        )
      ).includes('digital-clock'),
    'Digital clock was not added',
  );
  const digitalBefore = await page.evaluate(
    () =>
      (window as unknown as FixtureWindow).__questScene.getObjectByName('digital-clock-display')
        ?.userData.labelText as string,
  );
  const digitalPixels = await widgetPixels(page, 'clock-widget-1');
  await page.waitForTimeout(1100);
  const digitalAfter = await page.evaluate(
    () =>
      (window as unknown as FixtureWindow).__questScene.getObjectByName('digital-clock-display')
        ?.userData.labelText as string,
  );
  assert(digitalBefore !== digitalAfter, 'Digital clock did not update');
  assert(
    digitalPixels.visible > 0 && digitalPixels.delta > 0,
    'Digital clock did not change rendered pixels',
  );
  await target(page, 'openInput', { mode: 'widgets' });
  await target(page, 'toggleWidget', { widgetKind: 'analog-clock' });
  await waitFor(
    page,
    async () =>
      (
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.widgets,
        )
      ).includes('analog-clock'),
    'Analog clock was not added',
  );
  const analogPixels = await widgetPixels(page, 'clock-widget-2');
  assert(
    analogPixels.visible > 0 && analogPixels.delta > 0,
    'Analog clock did not change rendered pixels',
  );
  await page.screenshot({ path: join(TEST_ROOT, 'widgets-clocks.png') });
  await target(page, 'closeWidget', { widgetId: 'clock-widget-1' });
  await target(page, 'closeWidget', { widgetId: 'clock-widget-2' });
  await waitFor(
    page,
    async () =>
      (
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.widgets,
        )
      ).length === 0,
    'Clock close controls did not remove both clocks',
  );

  await target(page, 'openInput', { mode: 'terminal' });
  await target(page, 'openInput', { mode: 'filtering' });
  await target(page, 'filterMode', { filterMode: 'mipmap-linear' });
  await target(page, 'filterAnisotropy', { anisotropy: 4 });
  const gazeBefore = await page.evaluate(
    () => (window as unknown as FixtureWindow).__muxXR.getState().scene.filtering.gazeClarity,
  );
  await target(page, 'filterGaze');
  const filtering = await page.evaluate(
    () => (window as unknown as FixtureWindow).__muxXR.getState().scene.filtering,
  );
  assert(
    filtering.mode === 'mipmap-linear' &&
      filtering.anisotropy === 4 &&
      filtering.gazeClarity !== gazeBefore,
    `Native filtering controls failed: ${JSON.stringify(filtering)}`,
  );
  await page.screenshot({ path: join(TEST_ROOT, 'widgets-filtering.png') });

  const hudPose = await page.evaluate((): Pose => {
    const w = window as unknown as FixtureWindow;
    const hud = w.__questScene.getObjectByName('xr-workspace-hud');
    if (!hud) throw new Error('HUD missing for pose check');
    hud.position.x += 0.07;
    return {
      position: hud.position.toArray(),
      quaternion: hud.quaternion.toArray(),
      scale: hud.scale.toArray(),
    };
  });
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const pad = {
      buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
      axes: [0, 0, 0, 0],
    };
    Object.assign(window, { __widgetsPad: pad });
    w.__questControllers[1].dispatchEvent({
      type: 'connected',
      data: { gamepad: pad, handedness: 'right' },
    } as never);
  });
  await pressA(page);
  const keyboardPose = await page.evaluate((): Pose => {
    const w = window as unknown as FixtureWindow;
    const keyboard = w.__questScene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard did not open for pose check');
    keyboard.position.x += 0.08;
    return {
      position: keyboard.position.toArray(),
      quaternion: keyboard.quaternion.toArray(),
      scale: keyboard.scale.toArray(),
    };
  });
  await target(page, 'exit');
  await waitFor(
    page,
    async () =>
      (await page.evaluate(
        () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode,
      )) === 'desktop',
    'XR did not exit for pose save',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="xr"]').click();
  await waitFor(
    page,
    async () =>
      (await page.evaluate(
        () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode,
      )) === 'vr',
    'XR did not restart',
  );
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const pad = {
      buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
      axes: [0, 0, 0, 0],
    };
    Object.assign(window, { __widgetsPad: pad });
    w.__questControllers[1].dispatchEvent({
      type: 'connected',
      data: { gamepad: pad, handedness: 'right' },
    } as never);
  });
  await pressA(page);
  const keyboardRestored = await page.evaluate((): Pose | undefined => {
    const object = (window as unknown as FixtureWindow).__questScene.getObjectByName(
      'xr-keyboard-controls',
    );
    return object
      ? {
          position: object.position.toArray(),
          quaternion: object.quaternion.toArray(),
          scale: object.scale.toArray(),
        }
      : undefined;
  });
  assertPoseClose(keyboardRestored, keyboardPose, 'Keyboard pose');
  const hudRestored = await page.evaluate((): Pose | undefined => {
    const object = (window as unknown as FixtureWindow).__questScene.getObjectByName(
      'xr-workspace-hud',
    );
    return object
      ? {
          position: object.position.toArray(),
          quaternion: object.quaternion.toArray(),
          scale: object.scale.toArray(),
        }
      : undefined;
  });
  assertPoseClose(hudRestored, hudPose, 'HUD pose');
  const result = {
    kind: 'widgets-clarity-check',
    renderer,
    digitalBefore,
    digitalAfter,
    digitalPixels,
    analogPixels,
    filtering,
    keyboardPose,
    keyboardRestored,
    hudPose,
    hudRestored,
    errors,
  };
  assert(errors.length === 0, `Unexpected render errors: ${JSON.stringify(errors)}`);
  await writeFile(join(TEST_ROOT, 'widgets-clarity-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
