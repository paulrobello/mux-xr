import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  OutputSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { prepareQuestFixture } from './prepare-quest-fixture';

type Frame = { paneId: string; kind: string; data?: string };
type FixtureWindow = Window & {
  __muxXR: {
    getState(): {
      attached: string[];
      selectedId: string | null;
      scene: { xrMode: string; focusModeTerminalId: string | null };
    };
    selectPane(id: string): void;
  };
  __questScene: import('three').Scene;
  __questControllers: import('three').Group[];
  __questThree: typeof import('three');
  __questCamera: import('three').PerspectiveCamera;
};
const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
if (!BASE_URL || !TEST_ROOT || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error(
    'Input comfort verification requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT',
  );
const baseUrl = BASE_URL as string;
const testRoot = TEST_ROOT as string;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname))
  throw new Error('Loopback only');

const frame = (message: ServerMessage): Buffer =>
  Buffer.from([0, ...toBinary(ServerMessageSchema, message)]);
const snapshot = (): Buffer => {
  const pane = (id: string) =>
    create(MuxTreePaneSchema, {
      id,
      title: `Pane ${id}`,
      active: id === '%1',
      cols: 80,
      rows: 24,
      x: id === '%1' ? 0 : 40,
      y: 0,
    });
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'muxTreeSnapshot',
        value: create(MuxTreeSnapshotSchema, {
          workspaces: [
            create(MuxTreeWorkspaceSchema, {
              id: 'w',
              name: 'Workspace',
              active: true,
              sessions: [
                create(MuxTreeSessionSchema, {
                  id: '$1',
                  name: 'Session',
                  active: true,
                  windows: [
                    create(MuxTreeWindowSchema, {
                      id: '@1',
                      name: 'Window',
                      active: true,
                      layout: '80x24,0,0,1,2',
                      panes: [pane('%1'), pane('%2')],
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
          initialScreen: new TextEncoder().encode(`${id} connected\r\n`),
        }),
      },
    }),
  );
const output = (text: string): Buffer =>
  frame(
    create(ServerMessageSchema, {
      message: {
        case: 'output',
        value: create(OutputSchema, { data: new TextEncoder().encode(text) }),
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
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
async function target(
  page: Page,
  action: string,
  extra: Record<string, unknown> = {},
  controller = 0,
  hold = 0,
): Promise<void> {
  await page.evaluate(
    async ({ action, extra, controller, hold }) => {
      const w = window as unknown as FixtureWindow;
      let hit: import('three').Object3D | undefined;
      w.__questScene.traverse((o) => {
        if (
          !hit &&
          o.userData.inputAction === action &&
          Object.entries(extra).every(([k, v]) => o.userData[k] === v)
        )
          hit = o;
      });
      if (!hit) throw new Error(`control missing: ${action} ${JSON.stringify(extra)}`);
      const point = hit.getWorldPosition(new w.__questThree.Vector3());
      const q = hit.getWorldQuaternion(new w.__questThree.Quaternion());
      const c = w.__questControllers[controller];
      c.position.copy(point).add(new w.__questThree.Vector3(0, 0, 0.35).applyQuaternion(q));
      c.quaternion.copy(q);
      c.dispatchEvent({ type: 'selectstart' } as never);
      if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
      c.dispatchEvent({ type: 'selectend' } as never);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    { action, extra, controller, hold },
  );
}
async function main(): Promise<void> {
  await mkdir(testRoot, { recursive: true });
  prepareQuestFixture(testRoot);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const frames: Frame[] = [];
  const errors: string[] = [];
  let resize = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/Troika|Failure loading font|Creating a worker|Shader Error|GL_INVALID/i.test(m.text()))
      errors.push(m.text());
  });
  await page.routeWebSocket(/.*/, (ws: WebSocketRoute) => {
    const id = new URL(ws.url()).searchParams.get('session')?.replace(/^pane-/, '%') ?? 'metadata';
    ws.onMessage((raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
      if (bytes.length < 2) return;
      const msg = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
      if (msg.message.case === 'input')
        frames.push({
          paneId: id,
          kind: 'input',
          data: new TextDecoder().decode(msg.message.value.data),
        });
      if (msg.message.case === 'resize') resize += 1;
      if (msg.message.case === 'muxTreeRequest') ws.send(snapshot());
    });
    if (id !== 'metadata') {
      ws.send(connected(id));
      ws.send(output(`${id} ready\r\n`));
    }
  });
  try {
    await page.goto(`${baseUrl}/__quest-controls.html?server=${encodeURIComponent(baseUrl)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await waitFor(
      page,
      async () =>
        (await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().attached.length,
        )) >= 2,
      'panes did not attach',
    );
    await page.locator('[data-action="xr"]').click();
    await waitFor(
      page,
      async () =>
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode === 'vr',
        ),
      'XR did not start',
    );
    await page.evaluate(() => (window as unknown as FixtureWindow).__muxXR.selectPane('%1'));
    const face = async (button: number, pressed: boolean): Promise<void> => {
      await page.evaluate(
        async ({ button, pressed }) => {
          const w = window as unknown as { __comfortPad: { buttons: Array<{ pressed: boolean }> } };
          w.__comfortPad.buttons[button].pressed = pressed;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        },
        { button, pressed },
      );
    };
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const pad = {
        buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
        axes: [0, 0, 0, 0],
      };
      Object.assign(window, { __comfortPad: pad });
      w.__questControllers[1].dispatchEvent({
        type: 'connected',
        data: { gamepad: pad, handedness: 'right' },
      } as never);
    });
    await face(4, true);
    await face(4, false);
    const keyboardPose = await page.evaluate(() => {
      const keyboard = (window as unknown as FixtureWindow).__questScene.getObjectByName(
        'xr-keyboard-controls',
      );
      if (!keyboard) throw new Error('A did not open keyboard');
      keyboard.position.x += 0.07;
      return keyboard.position.toArray();
    });
    await face(4, true);
    await face(4, false);
    assert(
      await page.evaluate(
        () =>
          !(window as unknown as FixtureWindow).__questScene.getObjectByName(
            'xr-keyboard-controls',
          ),
      ),
      'A did not hide keyboard',
    );
    await face(4, true);
    await face(4, false);
    const reopened = await page.evaluate(() =>
      (window as unknown as FixtureWindow).__questScene
        .getObjectByName('xr-keyboard-controls')
        ?.position.toArray(),
    );
    assert(JSON.stringify(reopened) === JSON.stringify(keyboardPose), 'A lost keyboard pose');
    const geometry = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const keys: Record<string, { x: number; y: number }> = {};
      w.__questScene.traverse((o) => {
        if (
          o.userData.inputAction === 'key' &&
          ['Enter', 'a', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(o.userData.key)
        ) {
          const p = o.getWorldPosition(new w.__questThree.Vector3());
          keys[o.userData.key] = { x: p.x, y: p.y };
        }
      });
      return keys;
    });
    assert(
      geometry.Enter.x > geometry.a.x &&
        geometry.ArrowUp.y > geometry.ArrowDown.y &&
        Math.abs(geometry.ArrowLeft.y - geometry.ArrowRight.y) < 0.01,
      'Keyboard geometry incorrect',
    );
    await page.screenshot({ path: join(testRoot, 'keyboard-normal.png') });
    await target(page, 'key', { key: 'Shift' }, 0, 650);
    await page.screenshot({ path: join(testRoot, 'keyboard-locked-shift.png') });
    await target(page, 'key', { key: 'a' });
    await target(page, 'key', { key: 'b' });
    await target(page, 'key', { key: 'Shift' });
    await target(page, 'key', { key: 'c' });
    await target(page, 'key', { key: 'Control' }, 0, 650);
    await target(page, 'key', { key: 'a' });
    await target(page, 'key', { key: 'b' });
    await target(page, 'key', { key: 'Control' });
    await target(page, 'key', { key: 'd' });
    await waitFor(
      page,
      async () => frames.filter((f) => f.kind === 'input').length >= 6,
      'Input frames missing',
    );
    const input = frames.filter((f) => f.kind === 'input');
    assert(
      JSON.stringify(input.map((f) => f.data)) ===
        JSON.stringify(['A', 'B', 'c', '\u0001', '\u0002', 'd']),
      `Wrong sticky input: ${JSON.stringify(input)}`,
    );
    assert(
      input.every((f) => f.paneId === '%1'),
      'Input leaked to a different pane',
    );
    await target(page, 'openInput', { mode: 'arrange' });
    const positions = () =>
      page.evaluate(() =>
        (window as unknown as FixtureWindow).__questScene.children
          .filter((o) => o.name.startsWith('terminal-panel-'))
          .map((o) => ({
            p: o.position.toArray(),
            s: o.scale.toArray(),
            q: o.quaternion.toArray(),
          })),
      );
    const before = await positions();
    await target(page, 'layoutDepth', { direction: -1 });
    const closer = await positions();
    const shifts = before.map((o, i) => o.p.map((v, j) => closer[i].p[j] - v));
    assert(
      Math.abs(Math.hypot(...shifts[0]) - 0.4) < 1e-5 &&
        shifts[0].every((v, i) => Math.abs(v - shifts[1][i]) < 1e-5),
      'Closer did not move the whole layout',
    );
    assert(
      before.every(
        (o, i) =>
          JSON.stringify(o.s) === JSON.stringify(closer[i].s) &&
          JSON.stringify(o.q) === JSON.stringify(closer[i].q),
      ),
      'Layout move changed scale/orientation',
    );
    await page.screenshot({ path: join(testRoot, 'closer-layout.png') });
    await target(page, 'layoutDepth', { direction: 1 });
    const restored = await positions();
    assert(
      before.every((o, i) => o.p.every((v, j) => Math.abs(v - restored[i].p[j]) < 1e-5)),
      'Farther did not restore positions',
    );
    await face(5, true);
    await face(5, false);
    assert(
      await page.evaluate(
        () =>
          (window as unknown as FixtureWindow).__muxXR.getState().scene.focusModeTerminalId ===
          '%1',
      ),
      'B focus failed',
    );
    await face(5, true);
    await face(5, false);
    assert(
      await page.evaluate(
        () =>
          (window as unknown as FixtureWindow).__muxXR.getState().scene.focusModeTerminalId ===
          null,
      ),
      'B exit focus failed',
    );
    assert(
      resize === 0 && errors.length === 0,
      `Unexpected resize/render errors: ${JSON.stringify({ resize, errors })}`,
    );
    const spaceMotion = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const pivot = w.__questScene.getObjectByName('observatory-planet-rotation-pivot');
      const meteor = w.__questScene.getObjectByName('observatory-exterior-shooting-star') as
        | import('three').Line<import('three').BufferGeometry, import('three').LineBasicMaterial>
        | undefined;
      const update = w.__questScene.userData.updateEnvironment as
        | ((delta: number) => void)
        | undefined;
      if (!pivot || !meteor || !update) throw new Error('Environment motion missing');
      const before = pivot.getWorldPosition(new w.__questThree.Vector3());
      const rotation = pivot.rotation.y;
      for (let step = 0; step < 400; step += 1) {
        update(0.25);
        if (meteor.visible && meteor.material.opacity > 0.05) break;
      }
      const start = meteor.position.clone();
      update(0.05);
      const centerDelta = pivot.getWorldPosition(new w.__questThree.Vector3()).distanceTo(before);
      return {
        rotationDelta: pivot.rotation.y - rotation,
        centerDelta,
        meteorVisible: meteor.visible,
        meteorTravel: meteor.position.distanceTo(start),
      };
    });
    assert(
      spaceMotion.rotationDelta > 0 &&
        spaceMotion.centerDelta < 1e-6 &&
        spaceMotion.meteorVisible &&
        spaceMotion.meteorTravel > 0,
      `Space motion failed: ${JSON.stringify(spaceMotion)}`,
    );
    await page.screenshot({ path: join(testRoot, 'observatory-motion.png') });
    await target(page, 'exit');
    await page.locator('[data-action="keyboard"]').click();
    const domShift = page.locator('[data-key="Shift"]').first();
    await domShift.hover();
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    assert(
      await domShift.evaluate((element) => element.classList.contains('locked')),
      'DOM pointer release lost lock',
    );
    const domStart = frames.filter((f) => f.kind === 'input').length;
    await page.locator('[data-key="a"]').click();
    await page.locator('[data-key="b"]').click();
    await domShift.click();
    await page.locator('[data-key="c"]').click();
    await waitFor(
      page,
      async () => frames.filter((f) => f.kind === 'input').length >= domStart + 3,
      'DOM input missing',
    );
    const domInput = frames.filter((f) => f.kind === 'input').slice(domStart);
    assert(
      JSON.stringify(domInput.map((f) => f.data)) === JSON.stringify(['A', 'B', 'c']),
      `DOM modifiers failed: ${JSON.stringify(domInput)}`,
    );
    await page.screenshot({ path: join(testRoot, 'keyboard-browser.png') });
    await writeFile(
      join(testRoot, 'input-comfort-result.json'),
      JSON.stringify(
        { kind: 'input-comfort-check', input, domInput, spaceMotion, resize, geometry, errors },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        kind: 'input-comfort-check',
        input,
        domInput,
        spaceMotion,
        resize,
        geometry,
        errors,
      }),
    );
  } finally {
    await browser.close();
  }
}
await main();
