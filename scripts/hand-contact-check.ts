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
  __questRenderer: import('three').WebGLRenderer;
  __questHands: Array<import('three').Group & { joints: Record<string, import('three').Group> }>;
};
const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
if (!BASE_URL || !TEST_ROOT || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error(
    'Hand contact verification requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT',
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

async function settle(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}
async function contact(
  page: Page,
  data: Record<string, unknown>,
  depth: number,
  grip = false,
  palm = false,
  rootName?: string,
): Promise<void> {
  await page.evaluate(
    ({ data, depth, grip, palm, rootName }) => {
      const w = window as unknown as FixtureWindow;
      const T = w.__questThree;
      const start = rootName ? w.__questScene.getObjectByName(rootName) : w.__questScene;
      let target: import('three').Object3D | undefined;
      start?.traverse((object) => {
        let visible = true;
        for (let parent: import('three').Object3D | null = object; parent; parent = parent.parent)
          if (!parent.visible) visible = false;
        if (
          !target &&
          visible &&
          Object.entries(data).every(([key, value]) =>
            key === 'name' ? object.name === value : object.userData[key] === value,
          )
        )
          target = object;
      });
      if (!target) throw new Error(`Contact target missing ${JSON.stringify(data)}`);
      const point = target.getWorldPosition(new T.Vector3());
      const normal = new T.Vector3(0, 0, 1).applyQuaternion(
        target.getWorldQuaternion(new T.Quaternion()),
      );
      const hand = w.__questHands[0];
      hand.joints.wrist.position
        .copy(point)
        .add(new T.Vector3(0, palm ? -0.047 : -0.12, 0))
        .addScaledVector(normal, palm ? 0.025 : 0.08);
      hand.joints['thumb-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new T.Vector3(-0.06, 0.04, 0));
      hand.joints['middle-finger-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new T.Vector3(0, 0.17, 0));
      hand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, depth);
      for (const joint of Object.values(hand.joints)) joint.visible = true;
      if (grip) hand.joints['middle-finger-tip'].position.copy(hand.joints['thumb-tip'].position);
      w.__questControllers[0].position.set(5, 5, 0);
      w.__questControllers[0].quaternion.identity();
    },
    { data, depth, grip, palm, rootName },
  );
  await settle(page);
}
async function poke(page: Page, data: Record<string, unknown>, hold = 0): Promise<void> {
  await contact(page, data, 0.06);
  await contact(page, data, 0.004);
  if (hold) await page.waitForTimeout(hold);
  await contact(page, data, 0.06);
}
async function radial(page: Page, action: string): Promise<void> {
  await handAction(page, { inputAction: 'toggleRadial' });
  await waitFor(
    page,
    async () =>
      await page.evaluate(() =>
        Boolean(
          (window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')?.userData
            .interactive,
        ),
      ),
    'Radial did not settle',
  );
  await handAction(page, { inputAction: 'radialAction', radialAction: action });
  await waitFor(
    page,
    async () =>
      await page.evaluate(
        () =>
          !(window as unknown as FixtureWindow).__questScene.getObjectByName('radial-menu')
            ?.visible,
      ),
    'Radial did not close',
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
  const inputCount = (): number => frames.length;
  const errors: string[] = [];
  let resize = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Shader Error|GL_INVALID|Failure loading font/i.test(message.text()))
      errors.push(message.text());
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
      ws.send(output(`${id} contact fixture\r\n`));
    }
  });
  const report: Record<string, unknown> = { frames, errors };
  try {
    await page.goto(`${baseUrl}/__quest-controls.html?server=${encodeURIComponent(baseUrl)}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitFor(
      page,
      async () =>
        await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().attached.length >= 2,
        ),
      'Panes did not attach',
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
    report.renderer = await page.evaluate(() => {
      const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    });
    assert(
      /Apple.*M4|ANGLE.*Metal/i.test(String(report.renderer)) &&
        !/SwiftShader/i.test(String(report.renderer)),
      'Native GPU required',
    );
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      for (let i = 0; i < 2; i++) {
        const names = ['wrist', 'thumb-tip', 'middle-finger-tip', 'index-finger-tip'];
        w.__questControllers[i].dispatchEvent({
          type: 'connected',
          data: {
            handedness: i ? 'left' : 'right',
            hand: new Map(names.map((jointName) => [jointName, { jointName }])),
          },
        } as never);
        const hand = w.__questHands[i];
        for (const joint of Object.values(hand.joints)) {
          joint.position.set(i ? -2 : 0.3, i ? 2 : 1.2, i ? 0.5 : -0.35);
          joint.visible = true;
        }
        hand.joints['thumb-tip'].position.x += 0.06;
        hand.joints['middle-finger-tip'].position.y += 0.17;
        hand.joints['index-finger-tip'].position.y += 0.12;
      }
      w.__muxXR.selectPane('%1');
    });
    await settle(page);
    await radial(page, 'keyboard');
    await contact(page, { key: 'a', inputAction: 'key' }, 0.06);
    const near = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      return !w.__questControllers[0].children.find((node) => node instanceof w.__questThree.Line)
        ?.visible;
    });
    assert(near, 'Near keyboard laser remained visible');
    await page.evaluate(() => {
      const c = (window as unknown as FixtureWindow).__questControllers[0];
      for (const type of ['selectstart', 'select', 'selectend']) c.dispatchEvent({ type } as never);
    });
    await settle(page);
    assert(inputCount() === 0, 'Near ray activation leaked input');
    await contact(page, { key: 'a', inputAction: 'key' }, 0.004);
    await settle(page, 8);
    assert(inputCount() === 1, `Held poke repeated or missed: ${JSON.stringify(frames)}`);
    await contact(page, { key: 'a', inputAction: 'key' }, 0.06);
    await poke(page, { key: 'Shift', inputAction: 'key' }, 650);
    await contact(page, { key: 'b', inputAction: 'key' }, 0.06);
    await contact(page, { key: 'b', inputAction: 'key' }, 0.004);
    await page.evaluate(() => (window as unknown as FixtureWindow).__muxXR.selectPane('%2'));
    await settle(page, 5);
    assert(inputCount() === 2, 'Pane retarget repeated a held poke');
    await contact(page, { key: 'c', inputAction: 'key' }, 0.06);
    await contact(page, { key: 'c', inputAction: 'key' }, 0.004);
    await settle(page, 5);
    await page.evaluate(() => {
      (window as unknown as FixtureWindow).__questHands[0].joints['middle-finger-tip'].visible =
        false;
    });
    await settle(page);
    await page.evaluate(() => {
      (window as unknown as FixtureWindow).__questHands[0].joints['middle-finger-tip'].visible =
        true;
    });
    await settle(page, 5);
    assert(inputCount() === 3, `Tracking recovery replayed a poke: ${JSON.stringify(frames)}`);
    await contact(page, { key: 'c', inputAction: 'key' }, 0.06);
    for (let i = 0; i < 6; i++) await poke(page, { inputAction: 'keyboardCurvature', delta: 10 });
    await page.evaluate(() => {
      const root = (window as unknown as FixtureWindow).__questScene.getObjectByName(
        'xr-keyboard-controls',
      );
      if (!root) throw new Error('Keyboard missing');
      root.rotation.x -= 0.12;
      root.rotation.y += 0.2;
      root.position.x += 0.08;
      root.scale.multiplyScalar(0.9);
    });
    await poke(page, { key: 'd', inputAction: 'key' });
    await page.screenshot({ path: join(testRoot, 'keyboard-contact.png') });
    const keyboardBefore = await page.evaluate(() =>
      (window as unknown as FixtureWindow).__questScene
        .getObjectByName('xr-keyboard-controls')
        ?.position.toArray(),
    );
    await contact(page, { name: 'input-backdrop' }, 0.025, false, true, 'xr-keyboard-controls');
    const inputBeforeGrip = frames.length;
    await contact(page, { name: 'input-backdrop' }, 0.004, true, true, 'xr-keyboard-controls');
    await page.evaluate(() => {
      for (const joint of Object.values(
        (window as unknown as FixtureWindow).__questHands[0].joints,
      ))
        joint.position.add({ x: 0.12, y: 0.04, z: 0 });
    });
    await settle(page);
    const keyboardAfter = await page.evaluate(() =>
      (window as unknown as FixtureWindow).__questScene
        .getObjectByName('xr-keyboard-controls')
        ?.position.toArray(),
    );
    assert(
      keyboardBefore &&
        keyboardAfter &&
        Math.abs(keyboardAfter[0] - keyboardBefore[0] - 0.12) < 1e-4 &&
        Math.abs(keyboardAfter[1] - keyboardBefore[1] - 0.04) < 1e-4,
      `Contact keyboard grab missed: ${JSON.stringify({ keyboardBefore, keyboardAfter })}`,
    );
    await contact(page, { name: 'input-backdrop' }, 0.025, false, true, 'xr-keyboard-controls');
    assert(inputCount() === inputBeforeGrip, 'Grip typed into keyboard');
    await page.evaluate(() => {
      for (const joint of Object.values(
        (window as unknown as FixtureWindow).__questHands[0].joints,
      ))
        joint.position.z += 1;
    });
    await settle(page);
    await contact(page, { inputAction: 'close' }, 0.06);
    await contact(page, { inputAction: 'close' }, 0.004);
    await page.evaluate(() => {
      for (const joint of Object.values(
        (window as unknown as FixtureWindow).__questHands[0].joints,
      ))
        joint.position.z += 1;
    });
    await settle(page);
    const positions = await page.evaluate(() => {
      const scene = (window as unknown as FixtureWindow).__questScene;
      return ['%1', '%2'].map((id) =>
        scene.getObjectByName(`terminal-panel-${id}`)?.position.toArray(),
      );
    });
    await contact(page, { name: 'terminal-surface' }, 0.025, false, true, 'terminal-panel-%1');
    await contact(page, { name: 'terminal-surface' }, 0.025, true, true, 'terminal-panel-%1');
    await page.evaluate(() => {
      for (const joint of Object.values(
        (window as unknown as FixtureWindow).__questHands[0].joints,
      ))
        joint.position.x += 0.1;
    });
    await settle(page);
    const moved = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      return {
        selected: w.__muxXR.getState().selectedId,
        positions: ['%1', '%2'].map((id) =>
          w.__questScene.getObjectByName(`terminal-panel-${id}`)?.position.toArray(),
        ),
      };
    });
    assert(
      positions[0] &&
        moved.positions[0] &&
        Math.abs(moved.positions[0][0] - positions[0][0] - 0.1) < 1e-4,
      'Contact did not grab pane1',
    );
    assert(
      JSON.stringify(positions[1]) === JSON.stringify(moved.positions[1]),
      'Contact grip moved focused pane2',
    );
    await contact(page, { name: 'terminal-surface' }, 0.025, false, true, 'terminal-panel-%1');
    await page.evaluate(() => {
      for (const node of Object.values((window as unknown as FixtureWindow).__questHands[0].joints))
        node.position.z += 1;
    });
    await settle(page);
    const restoredRay = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      return Boolean(
        w.__questControllers[0].children.find((node) => node instanceof w.__questThree.Line)
          ?.visible,
      );
    });
    assert(restoredRay, 'Distant laser did not restore');
    await radial(page, 'keyboard');
    await handAction(page, { key: 'e', inputAction: 'key' });
    await waitFor(page, async () => frames.length >= 5, 'Input protocol did not settle');
    const expected = [
      ['%1', 'a'],
      ['%1', 'B'],
      ['%2', 'c'],
      ['%2', 'd'],
      ['%1', 'e'],
    ];
    assert(
      frames.length === expected.length &&
        frames.every(
          (value, i) => value.paneId === expected[i][0] && value.data === expected[i][1],
        ),
      `Contact targeting mismatch ${JSON.stringify(frames)}`,
    );
    assert(resize === 0 && errors.length === 0, JSON.stringify({ resize, errors }));
    Object.assign(report, {
      nearLaserHidden: near,
      distantLaserRestored: restoredRay,
      keyboardBefore,
      keyboardAfter,
      panelGrab: moved,
      resize,
      ok: true,
      scope:
        'Native browser synthetic hand poses; physical Quest contact feel remains owner acceptance',
    });
    console.log(JSON.stringify(report));
  } finally {
    await writeFile(join(testRoot, 'hand-contact-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
await main();
