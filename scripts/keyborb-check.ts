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
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { prepareQuestFixture } from './prepare-quest-fixture';

const baseUrl = process.env.MUX_XR_BASE_URL;
const testRoot = process.env.MUX_XR_TEST_ROOT;
if (!baseUrl || !testRoot || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error('Keyborb verification requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname))
  throw new Error('Loopback only');
const checkedBaseUrl = baseUrl;
const checkedTestRoot = testRoot;

type FixtureWindow = Window & {
  __muxXR: {
    getState(): { attached: string[]; scene: { xrMode: string; keyborbMode: string } };
  };
  __questScene: import('three').Scene;
  __questThree: typeof import('three');
  __questControllers: import('three').Group[];
  __questHands: Array<import('three').Group & { joints: Record<string, import('three').Group> }>;
  __questRenderer: import('three').WebGLRenderer;
};

const frame = (message: ServerMessage): Buffer =>
  Buffer.from([0, ...toBinary(ServerMessageSchema, message)]);
const snapshot = (): Buffer => {
  const pane = (id: string) =>
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
          sessionId: id,
          initialScreen: new TextEncoder().encode(
            `${id} connected\r\nSynthetic Keyborb fixture\r\n`,
          ),
        }),
      },
    }),
  );

async function waitFor(
  page: Page,
  predicate: () => Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(message);
}
async function frames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}
async function targetSelect(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate((data) => {
    const w = window as unknown as FixtureWindow;
    let target: import('three').Object3D | undefined;
    w.__questScene.traverse((object) => {
      if (!target && Object.entries(data).every(([key, value]) => object.userData[key] === value))
        target = object;
    });
    if (!target) throw new Error(`XR target missing: ${JSON.stringify(data)}`);
    const controller = w.__questControllers[0];
    const q = target.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(target.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(q));
    controller.quaternion.copy(q);
    w.__questScene.updateMatrixWorld(true);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'select' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
  }, data);
  await frames(page);
}
async function targetSelectHold(
  page: Page,
  data: Record<string, unknown>,
  holdFrames = 20,
): Promise<void> {
  await page.evaluate((data) => {
    const w = window as unknown as FixtureWindow;
    let target: import('three').Object3D | undefined;
    w.__questScene.traverse((object) => {
      if (!target && Object.entries(data).every(([key, value]) => object.userData[key] === value))
        target = object;
    });
    if (!target) throw new Error(`XR target missing: ${JSON.stringify(data)}`);
    const controller = w.__questControllers[0];
    const q = target.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(target.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(q));
    controller.quaternion.copy(q);
    w.__questScene.updateMatrixWorld(true);
    controller.dispatchEvent({ type: 'selectstart' } as never);
  }, data);
  await frames(page, holdFrames);
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const controller = w.__questControllers[0];
    controller.dispatchEvent({ type: 'select' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
  });
  await frames(page);
}
async function openKeyboard(page: Page): Promise<void> {
  await targetSelect(page, { inputAction: 'toggleRadial' });
  await waitFor(
    page,
    async () =>
      page.evaluate(() =>
        (() => {
          const menu = (window as unknown as FixtureWindow).__questScene.getObjectByName(
            'radial-menu',
          );
          return Boolean(menu?.visible && menu.userData.interactive);
        })(),
      ),
    'XR radial menu did not become interactive',
  );
  await targetSelect(page, { inputAction: 'radialAction', radialAction: 'keyboard' });
  await waitFor(
    page,
    async () =>
      page.evaluate(
        () =>
          (window as unknown as FixtureWindow).__questScene.getObjectByName('xr-keyboard-controls')
            ?.visible === true,
      ),
    'XR keyboard did not open',
  );
  await waitFor(
    page,
    async () =>
      page.evaluate(
        () =>
          !(window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
            ?.visible,
      ),
    'XR radial did not finish closing',
  );
}
async function keyReport(page: Page): Promise<{ total: number; spherical: number; flat: number }> {
  return page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const keys: import('three').Object3D[] = [];
    w.__questScene.traverse((object) => {
      if (object.userData.inputAction === 'key') keys.push(object);
    });
    return {
      total: keys.length,
      spherical: keys.filter((key) => key.userData.keyborb === true).length,
      flat: keys.filter((key) => key.userData.keyborb !== true).length,
    };
  });
}
async function main(): Promise<void> {
  await mkdir(checkedTestRoot, { recursive: true });
  prepareQuestFixture(checkedTestRoot);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  const inputs: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Shader Error|GL_INVALID|Failure loading font/i.test(message.text()))
      errors.push(message.text());
  });
  await page.routeWebSocket(/.*/, (ws: WebSocketRoute) => {
    const id = new URL(ws.url()).searchParams.get('session') ?? 'metadata';
    ws.onMessage((raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
      if (bytes.length < 2 || bytes[0] !== 0) return;
      const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1))).message;
      if (message.case === 'muxTreeRequest') ws.send(snapshot());
      if (message.case === 'input') inputs.push(new TextDecoder().decode(message.value.data));
    });
    if (id !== 'metadata') ws.send(connected(id));
  });
  const report: Record<string, unknown> = { errors, screenshots: [] as string[] };
  try {
    await page.goto(
      `${checkedBaseUrl}/__quest-controls.html?server=${encodeURIComponent(checkedBaseUrl)}`,
      {
        waitUntil: 'domcontentloaded',
      },
    );
    await page.evaluate(() => localStorage.removeItem('mux-xr:settings:v1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(
      page,
      async () =>
        page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR?.getState().attached.length === 2,
        ),
      'Demo panes did not attach',
    );
    await page.locator('[data-action="settings"]').click();
    const select = page.locator('[data-keyborb-mode]');
    const persisted: string[] = [];
    for (const mode of ['off', 'on', 'auto']) {
      await select.selectOption(mode);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(
        page,
        async () => (await page.locator('[data-keyborb-mode]').count()) === 1,
        'Settings did not mount',
      );
      await page.locator('[data-action="settings"]').click();
      persisted.push(await page.locator('[data-keyborb-mode]').inputValue());
    }
    report.persisted = persisted;
    await page.locator('[data-action="close-settings"]').click();
    await page.locator('[data-action="xr"]').click();
    await waitFor(
      page,
      async () =>
        page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode === 'vr',
        ),
      'XR did not start',
    );
    await waitFor(
      page,
      async () =>
        page.evaluate(() => {
          const hands = (window as unknown as FixtureWindow).__questScene.children.filter(
            (root) => root.name === 'xr-cartoon-hand',
          );
          return hands.length === 2 && hands.every((root) => root.userData.handAsset === 'loaded');
        }),
      'Authored hand rigs did not load',
    );
    const renderer = await page.evaluate(() => {
      const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    });
    report.renderer = renderer;
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const names = ['wrist', 'thumb-tip', 'middle-finger-tip', 'index-finger-tip'];
      w.__questControllers[0].dispatchEvent({
        type: 'connected',
        data: {
          handedness: 'right',
          hand: new Map(names.map((name) => [name, { jointName: name }])),
        },
      } as never);
      const hand = w.__questHands[0];
      hand.joints.wrist.position.set(0.2, 1.2, -0.4);
      hand.joints['thumb-tip'].position.set(0.26, 1.24, -0.4);
      hand.joints['index-finger-tip'].position.set(0.2, 1.32, -0.4);
      hand.joints['middle-finger-tip'].position.set(0.2, 1.37, -0.4);
      for (const joint of Object.values(hand.joints)) joint.visible = true;
    });
    await frames(page, 5);
    await openKeyboard(page);
    report.autoHands = await keyReport(page);
    const orb = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      let key: import('three').Object3D | undefined;
      w.__questScene.traverse((object) => {
        if (object.userData.inputAction === 'key' && object.userData.key === 'a') key = object;
      });
      if (!key) throw new Error('Pinch fixture key missing');
      const point = key.getWorldPosition(new w.__questThree.Vector3());
      return {
        point: point.toArray(),
        diameter: Number(key.userData.labelWidth),
        base: key.position.toArray(),
      };
    });
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const index = w.__questHands[0].joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.04;
      w.__questHands[0].joints.wrist.position
        .copy(index.position)
        .add(new w.__questThree.Vector3(0.03, -0.12, 0.04));
      w.__questHands[0].joints['middle-finger-tip'].position
        .copy(index.position)
        .add(new w.__questThree.Vector3(0.03, 0.04, 0.02));
      w.__questHands[0].joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      w.__questHands[0].joints['thumb-tip'].position.x -= 0.04;
    }, orb.point);
    await frames(page, 60);
    report.contactInputs = inputs.length;
    await page.screenshot({
      path: join(checkedTestRoot, 'keyborb-keyboard-hover-a.png'),
      fullPage: true,
    });
    (report.screenshots as string[]).push('keyborb-keyboard-hover-a.png');
    const idleLift = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      let key: import('three').Object3D | undefined;
      w.__questScene.traverse((object) => {
        if (object.userData.inputAction === 'key' && object.userData.key === 'a') key = object;
      });
      return Number(key?.userData.keyborbLift ?? 0);
    });
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const index = w.__questHands[0].joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.02;
      w.__questHands[0].joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      w.__questHands[0].joints['thumb-tip'].position.x -= 0.02;
    }, orb.point);
    await frames(page, 3);
    report.pinchFlash = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      let pressed = 0;
      w.__questScene.traverse((object) => {
        if (object.userData.inputAction === 'key' && object.userData.key === 'a')
          pressed = Number(
            (
              object as import('three').Mesh<
                import('three').BufferGeometry,
                import('three').ShaderMaterial
              >
            ).material.uniforms.pressed.value,
          );
      });
      return pressed;
    });
    await page.screenshot({
      path: join(checkedTestRoot, 'keyborb-pinch-flash.png'),
      fullPage: true,
    });
    (report.screenshots as string[]).push('keyborb-pinch-flash.png');
    await frames(page, 60);
    report.pinchInputs = [...inputs];
    const raisedLift = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      let key: import('three').Object3D | undefined;
      w.__questScene.traverse((object) => {
        if (object.userData.inputAction === 'key' && object.userData.key === 'a') key = object;
      });
      return Number(key?.userData.keyborbLift ?? 0);
    });
    report.keyborbLift = { idle: idleLift, raised: raisedLift, expected: orb.diameter };
    await page.screenshot({
      path: join(checkedTestRoot, 'keyborb-keyboard-raised-a.png'),
      fullPage: true,
    });
    (report.screenshots as string[]).push('keyborb-keyboard-raised-a.png');
    await targetSelectHold(page, { inputAction: 'key', key: 'a' });
    report.nativePinchInputs = [...inputs];
    const nativeRepeatBaseline = inputs.length;
    await targetSelectHold(page, { inputAction: 'key', key: 'a' });
    report.nativeRepeatInputs = inputs.slice(nativeRepeatBaseline);
    const briefBaseline = inputs.length;
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const index = w.__questHands[0].joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.025;
      w.__questHands[0].joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      w.__questHands[0].joints['thumb-tip'].position.x -= 0.025;
    }, orb.point);
    await frames(page, 1);
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const index = w.__questHands[0].joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.02;
      w.__questHands[0].joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      w.__questHands[0].joints['thumb-tip'].position.x -= 0.02;
    }, orb.point);
    await frames(page, 1);
    report.briefInputs = inputs.slice(briefBaseline);
    const deliberateBaseline = inputs.length;
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const index = w.__questHands[0].joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.04;
      w.__questHands[0].joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      w.__questHands[0].joints['thumb-tip'].position.x -= 0.04;
    }, orb.point);
    await frames(page, 8);
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const index = w.__questHands[0].joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.02;
      w.__questHands[0].joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      w.__questHands[0].joints['thumb-tip'].position.x -= 0.02;
    }, orb.point);
    await frames(page, 60);
    report.deliberateInputs = inputs.slice(deliberateBaseline);
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const index = w.__questHands[0].joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.04;
      w.__questHands[0].joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      w.__questHands[0].joints['thumb-tip'].position.x -= 0.04;
    }, orb.point);
    await frames(page, 5);
    report.releasedInputs = [...inputs];
    const recoveryBaseline = inputs.length;
    await page.evaluate((point) => {
      const w = window as unknown as FixtureWindow;
      const hand = w.__questHands[0];
      const index = hand.joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.024;
      hand.joints.wrist.visible = false;
      hand.joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      hand.joints['thumb-tip'].position.x -= 0.024;
      hand.joints['middle-finger-tip'].position.copy(hand.joints['thumb-tip'].position).y += 0.03;
    }, orb.point);
    await frames(page, 5);
    await page.evaluate(() => {
      const hand = (window as unknown as FixtureWindow).__questHands[0];
      hand.joints.wrist.visible = true;
    });
    await frames(page, 5);
    await page.evaluate((point) => {
      const hand = (window as unknown as FixtureWindow).__questHands[0];
      const index = hand.joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.01;
      hand.joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      hand.joints['thumb-tip'].position.x -= 0.01;
    }, orb.point);
    await frames(page, 8);
    report.recoveryBeforeNative = inputs.slice(recoveryBaseline);
    await targetSelectHold(page, { inputAction: 'key', key: 'a' });
    report.recoveryAfterNative = inputs.slice(recoveryBaseline);
    await page.evaluate((point) => {
      const hand = (window as unknown as FixtureWindow).__questHands[0];
      const index = hand.joints['index-finger-tip'];
      index.position.fromArray(point as [number, number, number]);
      index.position.x += 0.04;
      hand.joints['thumb-tip'].position.fromArray(point as [number, number, number]);
      hand.joints['thumb-tip'].position.x -= 0.04;
    }, orb.point);
    await frames(page, 5);
    report.recoveryAfterRelease = inputs.slice(recoveryBaseline);
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const names = ['wrist', 'thumb-tip', 'middle-finger-tip', 'index-finger-tip'];
      const controller = w.__questControllers[1];
      controller.dispatchEvent({
        type: 'connected',
        data: {
          handedness: 'left',
          hand: new Map(names.map((name) => [name, { jointName: name }])),
        },
      } as never);
      const hand = w.__questHands[1];
      hand.visible = true;
      hand.joints.wrist.position.set(-2, 2, -1);
      hand.joints['thumb-tip'].position.set(-2, 2, -1);
      hand.joints['index-finger-tip'].position.set(-1.9, 2, -1);
      hand.joints['middle-finger-tip'].position.set(-1.9, 2.02, -1);
      for (const joint of Object.values(hand.joints)) joint.visible = true;
    });
    await frames(page, 10);
    report.bothRaysBlocked = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      return w.__questControllers.map((controller) => ({
        rayVisible:
          controller.children.find((child) => child instanceof w.__questThree.Line)?.visible ??
          false,
      }));
    });
    await page.screenshot({
      path: join(checkedTestRoot, 'keyborb-both-rays-off.png'),
      fullPage: true,
    });
    (report.screenshots as string[]).push('keyborb-both-rays-off.png');
    await page.screenshot({ path: join(checkedTestRoot, 'keyborb-xr-hands.png'), fullPage: true });
    (report.screenshots as string[]).push('keyborb-xr-hands.png');
    await page.locator('[data-action="settings"]').click();
    await select.selectOption('on');
    await frames(page);
    report.onHands = await keyReport(page);
    await select.selectOption('off');
    await frames(page);
    report.offHands = await keyReport(page);
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const hand = w.__questHands[0];
      for (const joint of Object.values(hand.joints)) joint.position.set(5, 5, 5);
      w.__questControllers[1].dispatchEvent({ type: 'disconnected' } as never);
      w.__questControllers[0].dispatchEvent({ type: 'disconnected' } as never);
      w.__questControllers[0].dispatchEvent({
        type: 'connected',
        data: { handedness: 'right', gamepad: { buttons: [], axes: [] } },
      } as never);
    });
    await select.selectOption('auto');
    await frames(page, 5);
    report.autoControllers = await keyReport(page);
    await select.selectOption('on');
    await frames(page);
    report.onControllers = await keyReport(page);
    report.controllerTriggerPoses = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const pads = [0, 1].map(() => ({
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 6 }, (_, index) => ({
          pressed: index === 0,
          value: index === 0 ? 1 : 0,
        })),
      }));
      for (let i = 0; i < 2; i += 1) {
        const controller = w.__questControllers[i];
        controller.position.set(i === 0 ? 0.22 : -0.22, 1.3, -0.45);
        controller.quaternion.setFromEuler(new w.__questThree.Euler(0.2, i ? -0.3 : 0.3, 0));
        controller.dispatchEvent({
          type: 'connected',
          data: { handedness: i === 0 ? 'right' : 'left', gamepad: pads[i] },
        } as never);
      }
      return w.__questControllers.map((controller) => ({
        position: controller.position.toArray(),
        quaternion: controller.quaternion.toArray(),
      }));
    });
    await frames(page, 20);
    await page.locator('[data-action="close-settings"]').click();
    await page.screenshot({
      path: join(checkedTestRoot, 'controller-hands-trigger.png'),
      fullPage: true,
    });
    (report.screenshots as string[]).push('controller-hands-trigger.png');
    await targetSelect(page, { inputAction: 'toggleRadial' });
    await waitFor(
      page,
      async () =>
        page.evaluate(
          () =>
            (window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
              ?.userData.interactive === true,
        ),
      'XR Settings radial did not open',
    );
    await targetSelect(page, { inputAction: 'radialAction', radialAction: 'settings' });
    await waitFor(
      page,
      async () =>
        page.evaluate(
          () =>
            !(window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
              ?.visible,
        ),
      'XR Settings radial did not finish closing',
    );
    await targetSelect(page, { inputAction: 'keyborbMode', keyborbMode: 'auto' });
    report.nativeMode = await page.evaluate(
      () => (window as unknown as FixtureWindow).__muxXR.getState().scene.keyborbMode,
    );
    await page.screenshot({
      path: join(checkedTestRoot, 'keyborb-settings-xr.png'),
      fullPage: true,
    });
    (report.screenshots as string[]).push('keyborb-settings-xr.png');
    if (!(await select.isVisible())) await page.locator('[data-action="settings"]').click();
    await page.screenshot({ path: join(checkedTestRoot, 'keyborb-settings.png'), fullPage: true });
    (report.screenshots as string[]).push('keyborb-settings.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(checkedTestRoot, 'keyborb-settings-mobile.png'),
      fullPage: true,
    });
    (report.screenshots as string[]).push('keyborb-settings-mobile.png');
    report.ok =
      Number(report.pinchFlash) > 0 &&
      persisted.join(',') === 'off,on,auto' &&
      report.contactInputs === 0 &&
      JSON.stringify(report.pinchInputs) === JSON.stringify(['a']) &&
      JSON.stringify(report.nativePinchInputs) === JSON.stringify(['a']) &&
      JSON.stringify(report.nativeRepeatInputs) === JSON.stringify([]) &&
      JSON.stringify(report.briefInputs) === JSON.stringify([]) &&
      JSON.stringify(report.deliberateInputs) === JSON.stringify(['a']) &&
      JSON.stringify(report.releasedInputs) === JSON.stringify(['a', 'a']) &&
      JSON.stringify(report.recoveryBeforeNative) === JSON.stringify([]) &&
      JSON.stringify(report.recoveryAfterNative) === JSON.stringify(['a']) &&
      JSON.stringify(report.recoveryAfterRelease) === JSON.stringify(['a']) &&
      Array.isArray(report.bothRaysBlocked) &&
      (report.bothRaysBlocked as Array<{ rayVisible: boolean }>).every(
        (item) => item.rayVisible === false,
      ) &&
      Math.abs(
        Number((report.keyborbLift as { idle: number }).idle) -
          Number((report.keyborbLift as { expected: number }).expected),
      ) < 0.001 &&
      Math.abs(
        Number((report.keyborbLift as { raised: number }).raised) -
          Number((report.keyborbLift as { expected: number }).expected),
      ) < 0.001 &&
      JSON.stringify(report.autoHands) === JSON.stringify({ total: 62, spherical: 62, flat: 0 }) &&
      JSON.stringify(report.onHands) === JSON.stringify({ total: 62, spherical: 62, flat: 0 }) &&
      JSON.stringify(report.offHands) === JSON.stringify({ total: 62, spherical: 0, flat: 62 }) &&
      JSON.stringify(report.autoControllers) ===
        JSON.stringify({ total: 62, spherical: 0, flat: 62 }) &&
      JSON.stringify(report.onControllers) ===
        JSON.stringify({ total: 62, spherical: 62, flat: 0 }) &&
      Array.isArray(report.controllerTriggerPoses) &&
      (report.controllerTriggerPoses as unknown[]).length === 2 &&
      report.nativeMode === 'auto' &&
      /Apple.*M4|Metal/i.test(renderer) &&
      !/SwiftShader/i.test(renderer) &&
      errors.length === 0;
    if (!report.ok) throw new Error(`Keyborb assertions failed: ${JSON.stringify(report)}`);
  } finally {
    await writeFile(join(checkedTestRoot, 'keyborb-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
await main();
