import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { chromium, type Page, type WebSocketRoute } from 'playwright';
import {
  ClientMessageSchema,
  ConnectedSchema,
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { prepareQuestFixture } from './prepare-quest-fixture';

const baseUrl = process.env.MUX_XR_BASE_URL;
const testRoot = process.env.MUX_XR_TEST_ROOT;
if (!baseUrl || !testRoot || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error('radial-live-check requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT');
const parsedBase = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedBase.hostname))
  throw new Error('radial-live-check only accepts a loopback BASE_URL');

type FixtureWindow = Window & {
  __muxXR: { getState(): { attached: string[]; scene: { xrMode: string; radialOpen: boolean } } };
  __questScene: import('three').Scene;
  __questControllers: import('three').Group[];
  __questThree: typeof import('three');
  __questRenderer: { getContext(): WebGLRenderingContext | WebGL2RenderingContext };
  __designScene: import('../src/xr/scene').WorkspaceScene;
  __testRadialMenu: import('../src/xr/radial-menu').RadialMenu;
  __radialFreeze?: boolean;
  __radialPad: { buttons: Array<{ pressed: boolean }> };
};

const frame = (message: unknown): Buffer =>
  Buffer.from([0, ...toBinary(ServerMessageSchema, message as never)]);
let availablePaneIds = ['%1', '%2', '%3'];
const tree = (): Buffer => {
  const makePane = (id: string) =>
    create(MuxTreePaneSchema, { id, title: `Pane ${id}`, active: id === '%1', cols: 80, rows: 24 });
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'muxTreeSnapshot',
        value: create(MuxTreeSnapshotSchema, {
          workspaces: [
            create(MuxTreeWorkspaceSchema, {
              id: 'w',
              name: 'Workspace',
              sessions: [
                create(MuxTreeSessionSchema, {
                  id: 's',
                  name: 'Session',
                  windows: [
                    create(MuxTreeWindowSchema, {
                      id: 'win',
                      name: 'Window',
                      panes: availablePaneIds.map(makePane),
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      },
    }),
  );
};
const connected = (id: string): Buffer =>
  frame(
    create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, {
          cols: 80,
          rows: 24,
          sessionId: `pane-${id.slice(1)}`,
          initialScreen: new TextEncoder().encode(`${id} monitor history\r\n`),
        }),
      },
    }),
  );

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
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
async function injectSceneHandle(root: string): Promise<void> {
  const source = join(root, 'quest-main.ts');
  const existing = await readFile(source, 'utf8');
  const sceneFile = join(root, 'quest-scene.ts');
  const sceneSource = await readFile(sceneFile, 'utf8');
  await writeFile(
    sceneFile,
    sceneSource
      .replace(
        'const radialMenu = createRadialMenu();',
        'const radialMenu = createRadialMenu(); Object.assign(window,{__testRadialMenu:radialMenu});',
      )
      .replace(
        'radialMenu.update(radialDelta);',
        'if(!(window as unknown as {__radialFreeze?:boolean}).__radialFreeze)radialMenu.update(radialDelta);',
      ),
  );
  await writeFile(source, `${existing}\nObject.assign(window, { __designScene: scene });\n`);
  execFileSync('bun', ['build', source, '--target', 'browser', '--outdir', root], {
    stdio: 'inherit',
  });
}
async function nativeAction(
  page: Page,
  action: string,
  expected: Record<string, unknown> = {},
): Promise<void> {
  await page.evaluate(
    async ({ action, expected }) => {
      const w = window as unknown as FixtureWindow;
      let target: import('three').Object3D | undefined;
      w.__questScene.traverse((object) => {
        if (
          !target &&
          object.userData.inputAction === action &&
          Object.entries(expected).every(([key, value]) => object.userData[key] === value)
        )
          target = object;
      });
      if (!target) throw new Error(`Native action missing: ${action}`);
      const point = target.getWorldPosition(new w.__questThree.Vector3());
      const rotation = target.getWorldQuaternion(new w.__questThree.Quaternion());
      const controller = w.__questControllers[0];
      controller.position
        .copy(point)
        .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
      controller.quaternion.copy(rotation);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    { action, expected },
  );
}
async function waitRafMilliseconds(page: Page, milliseconds: number): Promise<number> {
  return page.evaluate(async (duration) => {
    const started = performance.now();
    while (performance.now() - started < duration)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - started;
  }, milliseconds);
}

async function main(): Promise<void> {
  const loadBefore = loadavg()[0];
  const root = resolve(testRoot as string);
  await mkdir(root, { recursive: true });
  prepareQuestFixture(root);
  await injectSceneHandle(root);
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
  const commandFrames: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/.*/, (socket: WebSocketRoute) => {
    const id =
      new URL(socket.url()).searchParams.get('session')?.replace(/^pane-/, '%') ?? 'metadata';
    socket.onMessage((raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
      const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
      if (message.message.case === 'muxTreeRequest') socket.send(tree());
      else if (message.message.case) commandFrames.push(message.message.case);
    });
    socket.send(id === 'metadata' ? tree() : connected(id));
    if (id !== 'metadata') socket.send(tree());
  });
  try {
    await page.goto(
      `${baseUrl}/__quest-controls.html?server=${encodeURIComponent(baseUrl as string)}`,
      { waitUntil: 'domcontentloaded', timeout: 15_000 },
    );
    await waitFor(
      page,
      async () =>
        (await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().attached.length,
        )) >= 2,
      'Initial panes did not attach',
    );
    await page.evaluate(() => {
      (window as unknown as { __muxXR: { selectPane(id: string): void } }).__muxXR.selectPane('%3');
    });
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
      const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
    });
    assert(renderer && !/swiftshader/i.test(renderer), `Unsupported renderer: ${renderer}`);
    const modes = ['keyboard', 'commands', 'arrange', 'warp', 'widgets'] as const;
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const pad = {
        buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
        axes: [0, 0, 0, 0],
      };
      Object.assign(window, { __radialPad: pad });
      w.__questControllers[1].dispatchEvent({
        type: 'connected',
        data: { gamepad: pad, handedness: 'right' },
      } as never);
    });
    const radialTiming = await page.evaluate(async () => {
      const w = window as unknown as FixtureWindow;
      const started = performance.now();
      const samples: Array<{ time: number; center: number; targets: number[][] }> = [];
      w.__radialPad.buttons[4].pressed = true;
      while (performance.now() - started < 1200) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        w.__radialPad.buttons[4].pressed = false;
        const root = w.__testRadialMenu.root;
        samples.push({
          time: performance.now() - started,
          center: root.getObjectByName('radial-menu-cancel')?.scale.x ?? 0,
          targets: ['keyboard', 'commands', 'layout', 'warp', 'widgets'].map(
            (action) => root.getObjectByName(`radial-menu-${action}`)?.position.toArray() ?? [],
          ),
        });
        if (w.__testRadialMenu.interactive)
          return { duration: performance.now() - started, samples };
      }
      throw new Error('radial did not become interactive in1200ms');
    });
    assert(
      radialTiming.duration < 1000,
      `Radial opening exceeded one second: ${radialTiming.duration}`,
    );
    await page.screenshot({ path: join(root, 'radial-live-open.png') });
    await nativeAction(page, 'radialAction', { radialAction: 'cancel' });
    await waitFor(
      page,
      async () =>
        (await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.radialOpen,
        )) === false,
      'Radial cancel failed',
    );
    await page.waitForTimeout(180);
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      w.__radialFreeze = true;
      w.__testRadialMenu.open();
      w.__testRadialMenu.update(0.16);
    });
    await page.screenshot({ path: join(root, 'radial-center-160ms.png') });
    await page.evaluate(() => (window as unknown as FixtureWindow).__testRadialMenu.update(0.16));
    await page.screenshot({ path: join(root, 'radial-stack-320ms.png') });
    await page.evaluate(() =>
      (window as unknown as FixtureWindow).__testRadialMenu.update(0.48 + 0.00001),
    );
    await page.screenshot({ path: join(root, 'radial-fan-800ms.png') });
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      w.__testRadialMenu.close();
      w.__testRadialMenu.update(0.2);
      w.__radialFreeze = false;
    });
    for (const [action, mode] of [
      ['keyboard', 'keyboard'],
      ['commands', 'commands'],
      ['layout', 'arrange'],
      ['warp', 'warp'],
      ['widgets', 'widgets'],
    ] as const) {
      await page.evaluate(async () => {
        const w = window as unknown as FixtureWindow;
        w.__radialPad.buttons[4].pressed = true;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        w.__radialPad.buttons[4].pressed = false;
      });
      await waitFor(
        page,
        async () =>
          page.evaluate(() => (window as unknown as FixtureWindow).__testRadialMenu.interactive),
        'menu did not open',
      );
      await nativeAction(page, 'radialAction', { radialAction: action });
      await page.waitForTimeout(180);
      assert(
        await page.evaluate(
          (mode) =>
            !!(window as unknown as FixtureWindow).__questScene.getObjectByName(
              `xr-${mode}-controls`,
            ),
          mode,
        ),
        `wrong radial destination ${action}`,
      );
      await nativeAction(page, 'close');
    }
    await page.waitForTimeout(180);
    await page.evaluate(() => {
      (window as unknown as FixtureWindow).__designScene.showInput('warp');
    });
    await nativeAction(page, 'glassOpacity', { delta: -0.1 });
    await nativeAction(page, 'close');
    const savedPose = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const api = w.__muxXR as unknown as { selectPane(id: string): void };
      api.selectPane('%1');
      w.__designScene.restoreTerminalPose('%1', {
        position: [0.4, -0.2, -1.6],
        quaternion: [0, 0, 0, 1],
        scale: 0.75,
      });
      w.__designScene.moveLayoutDepth(1);
      w.__designScene.setTerminalOpacity('%1', 0.4);
      return w.__designScene.captureTerminalPose('%1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(
      page,
      async () =>
        page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().attached.length === 3,
        ),
      'saved panes did not restore',
    );
    await page.locator('[data-action="xr"]').click();
    await page.waitForTimeout(100);
    const restoredPose = await page.evaluate(() =>
      (window as unknown as FixtureWindow).__designScene.captureTerminalPose('%1'),
    );
    assert(savedPose && restoredPose, 'pose missing');
    for (const key of ['position', 'quaternion'] as const)
      assert(
        savedPose[key].every((value, index) => Math.abs(value - restoredPose[key][index]) < 1e-6),
        `pose ${key} changed`,
      );
    assert(Math.abs(savedPose.scale - restoredPose.scale) < 1e-6, 'saved scale changed');
    assert(
      (await page.evaluate(() =>
        (window as unknown as FixtureWindow).__designScene.getTerminalOpacity('%1'),
      )) === 0.4,
      'opacity did not restore',
    );
    availablePaneIds = ['%1', '%3'];
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(
      page,
      async () =>
        page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().attached.length === 2,
        ),
      'partial restore failed',
    );
    assert(
      (await page.locator('[data-notice-text]').textContent())?.includes('%2'),
      'missing pane toast absent',
    );
    await page.locator('[data-action="dismiss-notice"]').click();
    await page.evaluate(() => {
      const api = (window as unknown as { __muxXR: { closePane(id: string): void } }).__muxXR;
      api.closePane('%1');
      api.closePane('%3');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(150);
    assert(
      (await page.evaluate(
        () => (window as unknown as FixtureWindow).__muxXR.getState().attached.length,
      )) === 0,
      'explicit closed-all profile reopened defaults',
    );
    assert(
      !commandFrames.some((value) => /^(input|paste|resize|paneCreate)/i.test(value)),
      `restore emitted commands: ${commandFrames.join(',')}`,
    );
    assert(errors.length === 0, `Native page errors: ${errors.join('; ')}`);
    const loadAfter = loadavg()[0];
    const result = {
      kind: 'radial-live-check',
      renderer,
      modes,
      radialTiming,
      restoredViews: 3,
      partialRestore: 2,
      closedAll: true,
      savedPose,
      restoredPose,
      commandFrames,
      loadBefore,
      loadAfter,
      loadValid: loadBefore <= 15 && loadAfter <= 15,
      errors,
    };
    await writeFile(join(root, 'radial-live-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
void main();
