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
import { pressWristMenu } from './wrist-menu-fixture';

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
  __questRenderer: import('three').WebGLRenderer;
  __questHands: Array<import('three').Group & { joints: Record<string, import('three').Group> }>;
};
const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
if (!BASE_URL || !TEST_ROOT || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error(
    'Hand input verification requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT',
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
  _page: Page,
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

async function handAction(page: Page, data: Record<string, unknown>, hold = 0): Promise<void> {
  await page.evaluate(
    async ({ data, hold }) => {
      const w = window as unknown as FixtureWindow;
      let hit: import('three').Object3D | undefined;
      w.__questScene.traverse((object) => {
        let visible = true;
        for (let parent: import('three').Object3D | null = object; parent; parent = parent.parent)
          if (!parent.visible) visible = false;
        if (
          visible &&
          !hit &&
          Object.entries(data).every(([key, value]) => object.userData[key] === value)
        )
          hit = object;
      });
      if (!hit) throw new Error(`Hand target missing: ${JSON.stringify(data)}`);
      const root = w.__questControllers[0];
      const q = hit.getWorldQuaternion(new w.__questThree.Quaternion());
      root.position
        .copy(hit.getWorldPosition(new w.__questThree.Vector3()))
        .add(new w.__questThree.Vector3(0, 0, 0.35).applyQuaternion(q));
      root.quaternion.copy(q);
      w.__questScene.updateMatrixWorld(true);
      root.dispatchEvent({ type: 'selectstart' } as never);
      if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
      root.dispatchEvent({ type: 'select' } as never);
      root.dispatchEvent({ type: 'selectend' } as never);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    { data, hold },
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
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      /Troika|Failure loading font|Creating a worker|Shader Error|GL_INVALID/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.routeWebSocket('**/ws**', (ws: WebSocketRoute) => {
    const id = new URL(ws.url()).searchParams.get('session')?.replace(/^pane-/, '%') ?? 'metadata';
    ws.onMessage((raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
      if (bytes.length < 2) return;
      const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
      if (message.message.case === 'input')
        frames.push({
          paneId: id,
          kind: 'input',
          data: new TextDecoder().decode(message.message.value.data),
        });
      if (message.message.case === 'resize') resize += 1;
      if (message.message.case === 'muxTreeRequest') ws.send(snapshot());
    });
    if (id !== 'metadata') {
      ws.send(connected(id));
      ws.send(output(`${id} hand fixture\r\n`));
    }
  });
  try {
    await page.goto(`${baseUrl}/__quest-controls.html?server=${encodeURIComponent(baseUrl)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await waitFor(
      page,
      async () =>
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().attached.length >= 2,
        ),
      'Panes did not attach',
    );
    await page.locator('[data-pane="%1"]').click();
    await page.locator('[data-action="commands"]').click();
    await page.locator('[data-command-label]').fill('Hand check');
    await page.locator('[data-command-text]').fill('echo hand');
    await page.locator('[data-command-newline]').uncheck();
    await page.locator('[data-action="save-command"]').click();
    await page.locator('[data-action="close-drawer"]').click();
    // Hand rays target the flat keyboard; Keyborb (auto with tracked hands) is pinch-only.
    await page.locator('[data-action="settings"]').click();
    await page.locator('[data-keyborb-mode]').selectOption('off');
    await page.locator('[data-action="close-settings"]').click();
    await page.locator('[data-action="xr"]').click();
    await waitFor(
      page,
      async () =>
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode === 'vr',
        ),
      'XR did not start',
    );
    const renderer = await page.evaluate(() => {
      const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
    });
    assert(
      /Apple.*M4|ANGLE.*Metal/i.test(renderer) && !/SwiftShader/i.test(renderer),
      `Native GPU required: ${renderer}`,
    );
    await page.evaluate(async () => {
      const w = window as unknown as FixtureWindow;
      for (let i = 0; i < 2; i++) {
        const joints = ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip'];
        w.__questControllers[i].dispatchEvent({
          type: 'connected',
          data: {
            handedness: i === 0 ? 'right' : 'left',
            hand: new Map(joints.map((jointName) => [jointName, { jointName }])),
          },
        } as never);
        const hand = w.__questHands[i];
        const wrist = hand.joints.wrist;
        // Resting low and behind the near hand keyboard (its backing reaches y 0.95, z -0.21),
        // outside its 0.14 m near zone so the both-rays rule stays off for ray typing.
        wrist.position.set(i ? -0.25 : 0.25, 0.7, 0.1);
        hand.joints['thumb-tip'].position
          .copy(wrist.position)
          .add(new w.__questThree.Vector3(0, 0.05, 0));
        hand.joints['index-finger-tip'].position
          .copy(wrist.position)
          .add(new w.__questThree.Vector3(0.07, 0.08, 0));
        hand.joints['middle-finger-tip'].position
          .copy(wrist.position)
          .add(new w.__questThree.Vector3(0, 0.13, 0));
        for (const joint of Object.values(hand.joints)) joint.visible = true;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      w.__muxXR.selectPane('%1');
    });
    await pressWristMenu(page, { leftConnected: true });
    await waitFor(
      page,
      async () =>
        await page.evaluate(() =>
          Boolean(
            (window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
              ?.userData.interactive,
          ),
        ),
      'Hand Menu did not open radial',
    );
    await handAction(page, { inputAction: 'radialAction', radialAction: 'keyboard' });
    await waitFor(
      page,
      async () =>
        await page.evaluate(
          () =>
            !(window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
              ?.visible,
        ),
      'Radial menu did not finish closing',
    );
    await handAction(page, { key: 'a' });
    await handAction(page, { key: 'Shift' }, 650);
    await handAction(page, { key: 'b' });
    await page.evaluate(() => (window as unknown as FixtureWindow).__muxXR.selectPane('%2'));
    await handAction(page, { key: 'c' });
    await page.screenshot({ path: join(testRoot, 'hands-keyboard.png') });
    await pressWristMenu(page, { leftConnected: true });
    await waitFor(
      page,
      async () =>
        await page.evaluate(() =>
          Boolean(
            (window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
              ?.userData.interactive,
          ),
        ),
      'Hand Menu did not reopen',
    );
    await handAction(page, { inputAction: 'radialAction', radialAction: 'commands' });
    await waitFor(
      page,
      async () =>
        await page.evaluate(
          () =>
            !(window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
              ?.visible,
        ),
      'Commands transition did not finish',
    );
    await handAction(page, { inputAction: 'command' });
    await waitFor(
      page,
      async () => frames.filter((entry) => entry.kind === 'input').length >= 4,
      `Hand keyboard did not send input: ${JSON.stringify(frames)}`,
    );
    const input = frames.filter((entry) => entry.kind === 'input');
    assert(
      input[0]?.paneId === '%1' && input[0]?.data === 'a',
      `First hand input: ${JSON.stringify(input)}`,
    );
    assert(
      input[1]?.paneId === '%1' && input[1]?.data === 'B',
      `Held modifier: ${JSON.stringify(input)}`,
    );
    assert(
      input[2]?.paneId === '%2' && input[2]?.data === 'c',
      `Retargeted hand input: ${JSON.stringify(input)}`,
    );
    assert(
      input[3]?.paneId === '%2' && input[3]?.data === 'echo hand',
      `Hand command target: ${JSON.stringify(input)}`,
    );
    assert(resize === 0, `Hand input resized the terminal ${resize} times`);
    assert(errors.length === 0, errors.join('\n'));
    const report = {
      renderer,
      input,
      resize,
      errors,
      evidence: 'Native desktop WebXR hand fixture; physical Quest hand acceptance pending',
    };
    await writeFile(join(testRoot, 'hand-input-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
}

await main();
