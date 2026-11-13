import { mkdir, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { type CDPSession, chromium, type Page, type WebSocketRoute } from 'playwright';
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
import { pressWristMenu } from './wrist-menu-fixture';

// Compares the render and script cost of the closed, standard and Keyborb keyboards in the
// synthetic Quest fixture. Draw calls and per-frame script time are proxies for headset fps.
const baseUrl = process.env.MUX_XR_BASE_URL;
const testRoot = process.env.MUX_XR_TEST_ROOT;
if (!baseUrl || !testRoot || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error('Keyborb perf check requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname))
  throw new Error('Loopback only');
const checkedBaseUrl = baseUrl;
const checkedTestRoot = testRoot;
const MEASURED_FRAMES = 240;
// Quest-like defaults: a phone-class CPU and one render per eye. KEYBORB_PERF_THROTTLE=1 and
// KEYBORB_PERF_EYES=1 give the plain desktop numbers.
const CPU_THROTTLE = Number(process.env.KEYBORB_PERF_THROTTLE ?? 4);
const EYES = Number(process.env.KEYBORB_PERF_EYES ?? 2);
// Comma-separated object names hidden in the Keyborb state, to attribute its cost.
const ABLATE = (process.env.KEYBORB_PERF_ABLATE ?? '').split(',').filter(Boolean);
// The left hand: 'far' at rest beside the body, 'watch' hovering by the right wrist watch, or
// 'none' for the right hand alone.
const LEFT_HAND = (process.env.KEYBORB_PERF_LEFT ?? 'far') as 'far' | 'watch' | 'none';
const STATES = (process.env.KEYBORB_PERF_STATES ?? 'closed,standard,keyborb').split(',') as Array<
  'closed' | 'standard' | 'keyborb'
>;

type FixtureWindow = Window & {
  __muxXR: { getState(): { attached: string[]; scene: { xrMode: string } } };
  __questScene: import('three').Scene;
  __questThree: typeof import('three');
  __questControllers: import('three').Group[];
  __questHands: Array<import('three').Group & { joints: Record<string, import('three').Group> }>;
  __questRenderer: import('three').WebGLRenderer;
  __perf?: {
    renders: number;
    renderMs: number;
    calls: number;
    triangles: number;
    uploads: number;
    syncs: number;
    draws: Record<string, number>;
  };
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
          initialScreen: new TextEncoder().encode(`${id} connected\r\nKeyborb perf fixture\r\n`),
        }),
      },
    }),
  );

async function waitFor(page: Page, predicate: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(message);
}
async function frames(page: Page, count: number): Promise<void> {
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
  await frames(page, 3);
}
const visible = (page: Page, name: string) =>
  page.evaluate(
    (name) => (window as unknown as FixtureWindow).__questScene.getObjectByName(name)?.visible,
    name,
  );
async function openKeyboard(page: Page): Promise<void> {
  await pressWristMenu(page, { leftConnected: LEFT_HAND !== 'none' });
  await waitFor(
    page,
    async () =>
      page.evaluate(() => {
        const menu = (window as unknown as FixtureWindow).__questScene.getObjectByName(
          'radial-menu',
        );
        return Boolean(menu?.visible && menu.userData.interactive);
      }),
    'XR radial menu did not become interactive',
  );
  await targetSelect(page, { inputAction: 'radialAction', radialAction: 'keyboard' });
  await waitFor(
    page,
    async () => (await visible(page, 'xr-keyboard-controls')) === true,
    'no keyboard',
  );
  await waitFor(page, async () => !(await visible(page, 'radial-menu')), 'radial stayed open');
}

interface StateReport {
  state: string;
  keys: number;
  orbs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  textures: number;
  geometries: number;
  renderSubmitMs: number;
  scriptMsPerFrame: number;
  textureUploadsPerFrame: number;
  textSyncsPerFrame: number;
  hotspots: Array<{ fn: string; selfMs: number }>;
  /** Every sampled function's self time per frame, for diffing states. */
  profile: Record<string, number>;
  /** Draw calls per frame by nearest named ancestor, largest first. */
  draws: Array<{ name: string; perFrame: number }>;
  loadBefore: number;
  loadAfter: number;
}

async function profileHotspots(cdp: CDPSession, page: Page): Promise<Record<string, number>> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await frames(page, MEASURED_FRAMES);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const deltas = profile.timeDeltas ?? [];
  const label = (id: number): string | null => {
    const node = byId.get(id);
    if (!node) return null;
    const { functionName, url, lineNumber } = node.callFrame;
    if (!url || ['(idle)', '(program)', '(garbage collector)'].includes(functionName)) return null;
    const file = url.split('/').pop()?.split('?')[0] ?? url;
    return `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`;
  };
  (profile.samples ?? []).forEach((id, index) => {
    const key = label(id);
    if (!key) return;
    const ms = (deltas[index] ?? 0) / 1000;
    self.set(key, (self.get(key) ?? 0) + ms);
    // Inclusive time, so the caller that owns an expensive subtree shows up too.
    const seen = new Set<string>();
    for (let at: number | undefined = id; at !== undefined; at = parents.get(at)) {
      const frame = label(at);
      if (!frame || seen.has(frame)) continue;
      seen.add(frame);
      self.set(`incl ${frame}`, (self.get(`incl ${frame}`) ?? 0) + ms);
    }
  });
  return Object.fromEntries(
    [...self.entries()].map(([fn, selfMs]) => [fn, Number((selfMs / MEASURED_FRAMES).toFixed(4))]),
  );
}

async function measure(
  page: Page,
  cdp: CDPSession,
  state: 'closed' | 'standard' | 'keyborb',
): Promise<StateReport> {
  await page.goto(
    `${checkedBaseUrl}/__quest-controls.html?server=${encodeURIComponent(checkedBaseUrl)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await waitFor(
    page,
    async () => (await page.locator('[data-action="settings"]').count()) === 1,
    'Workspace did not mount',
  );
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-keyborb-mode]').selectOption(state === 'keyborb' ? 'on' : 'off');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(
    page,
    async () =>
      page.evaluate(
        () => (window as unknown as FixtureWindow).__muxXR?.getState().attached.length === 2,
      ),
    'Demo panes did not attach',
  );
  await page.locator('[data-action="xr"]').click();
  await waitFor(
    page,
    async () =>
      page.evaluate(
        () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode === 'vr',
      ),
    'XR did not start',
  );
  await page.evaluate((left) => {
    const w = window as unknown as FixtureWindow;
    const names = ['wrist', 'thumb-tip', 'middle-finger-tip', 'index-finger-tip'];
    const connect = (index: number, handedness: 'left' | 'right', x: number): void => {
      w.__questControllers[index].dispatchEvent({
        type: 'connected',
        data: { handedness, hand: new Map(names.map((name) => [name, { jointName: name }])) },
      } as never);
      const hand = w.__questHands[index];
      const thumb = handedness === 'right' ? 0.06 : -0.06;
      hand.joints.wrist.position.set(x, 1.2, -0.4);
      hand.joints['thumb-tip'].position.set(x + thumb, 1.24, -0.4);
      hand.joints['index-finger-tip'].position.set(x, 1.32, -0.4);
      hand.joints['middle-finger-tip'].position.set(x, 1.37, -0.4);
      for (const joint of Object.values(hand.joints)) joint.visible = true;
    };
    connect(0, 'right', 0.2);
    // About 0.1 m from the right wrist, inside the watch's probe reach.
    if (left !== 'none') connect(1, 'left', left === 'watch' ? 0.1 : -0.2);
  }, LEFT_HAND);
  await frames(page, 10);
  if (state !== 'closed') {
    await openKeyboard(page);
    // Hover an open pinch just in front of the middle row, as when reaching for a key.
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      let key: import('three').Object3D | undefined;
      w.__questScene.traverse((object) => {
        if (object.userData.inputAction === 'key' && object.userData.key === 'g') key = object;
      });
      if (!key) throw new Error('Hover key missing');
      const point = key.getWorldPosition(new w.__questThree.Vector3());
      const normal = new w.__questThree.Vector3(0, 0, 1).applyQuaternion(
        key.getWorldQuaternion(new w.__questThree.Quaternion()),
      );
      const hand = w.__questHands[0];
      hand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, 0.05);
      hand.joints['index-finger-tip'].position.x += 0.04;
      hand.joints['thumb-tip'].position.copy(point).addScaledVector(normal, 0.05);
      hand.joints['thumb-tip'].position.x -= 0.04;
      hand.joints['middle-finger-tip'].position.copy(point).addScaledVector(normal, 0.08);
      hand.joints.wrist.position.copy(point).addScaledVector(normal, 0.16).y -= 0.08;
    });
  }
  await frames(page, 90);
  await page.evaluate((eyes) => {
    const w = window as unknown as FixtureWindow;
    const renderer = w.__questRenderer;
    const perf = {
      renders: 0,
      renderMs: 0,
      calls: 0,
      triangles: 0,
      uploads: 0,
      syncs: 0,
      draws: {} as Record<string, number>,
    };
    w.__perf = perf;
    const direct = renderer.renderBufferDirect.bind(renderer);
    renderer.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      let named: import('three').Object3D | null = object;
      while (named && !named.name) named = named.parent;
      const key = `${named?.name || object.type}${named === object ? '' : ' >'}`;
      perf.draws[key] = (perf.draws[key] ?? 0) + 1;
      direct(camera, scene, geometry, material, object, group);
    };
    const render = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => {
      const start = performance.now();
      // Two full renders also double scene traversal and culling, which XR's ArrayCamera does once,
      // so absolute submit time is somewhat high; per-render work such as onBeforeRender is exact.
      for (let eye = 0; eye < eyes; eye++) {
        render(scene, camera);
        perf.calls += renderer.info.render.calls;
        perf.triangles += renderer.info.render.triangles;
      }
      perf.renderMs += performance.now() - start;
      perf.renders++;
    };
    const gl = renderer.getContext() as WebGL2RenderingContext;
    for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D'] as const) {
      const original = (gl[name] as (...args: unknown[]) => void).bind(gl);
      (gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        perf.uploads++;
        return original(...args);
      };
    }
    let text: (import('three').Object3D & { sync?: () => void }) | undefined;
    w.__questScene.traverse((object) => {
      if (!text && typeof (object as { sync?: unknown }).sync === 'function') text = object;
    });
    const proto = text ? Object.getPrototypeOf(text) : null;
    if (proto?.sync) {
      const sync = proto.sync;
      proto.sync = function (this: unknown, ...args: unknown[]) {
        perf.syncs++;
        return sync.apply(this, args);
      };
    }
  }, EYES);
  if (state === 'keyborb' && ABLATE.length)
    await page.evaluate((names) => {
      const scene = (window as unknown as FixtureWindow).__questScene;
      for (const name of names) {
        const object = scene.getObjectByName(name);
        if (!object) throw new Error(`Ablation target missing: ${name}`);
        object.visible = false;
      }
    }, ABLATE);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  const loadBefore = loadavg()[0];
  const before = await cdp.send('Performance.getMetrics');
  await frames(page, MEASURED_FRAMES);
  const after = await cdp.send('Performance.getMetrics');
  const metric = (set: typeof before, name: string) =>
    set.metrics.find((entry) => entry.name === name)?.value ?? 0;
  const scriptSeconds = metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration');
  const counters = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const perf = w.__perf;
    if (!perf) throw new Error('Perf counters missing');
    let keys = 0;
    let orbs = 0;
    w.__questScene.traverse((object) => {
      if (object.userData.inputAction !== 'key' || !object.visible) return;
      keys++;
      if (object.userData.keyborb) orbs++;
    });
    const info = w.__questRenderer.info;
    return {
      ...perf,
      keys,
      orbs,
      programs: info.programs?.length ?? 0,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    };
  });
  const profile = await profileHotspots(cdp, page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const hotspots = Object.entries(profile)
    .filter(([fn]) => !fn.startsWith('incl '))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([fn, selfMs]) => ({ fn, selfMs }));
  const loadAfter = loadavg()[0];
  const renders = Math.max(1, counters.renders);
  return {
    state,
    keys: counters.keys,
    orbs: counters.orbs,
    drawCalls: Math.round(counters.calls / renders),
    triangles: Math.round(counters.triangles / renders),
    programs: counters.programs,
    textures: counters.textures,
    geometries: counters.geometries,
    renderSubmitMs: Number((counters.renderMs / renders).toFixed(3)),
    scriptMsPerFrame: Number(((scriptSeconds * 1000) / MEASURED_FRAMES).toFixed(3)),
    textureUploadsPerFrame: Number((counters.uploads / MEASURED_FRAMES).toFixed(3)),
    textSyncsPerFrame: Number((counters.syncs / MEASURED_FRAMES).toFixed(3)),
    hotspots,
    profile,
    draws: Object.entries(counters.draws)
      .map(([name, count]) => ({ name, perFrame: Number((count / renders).toFixed(2)) }))
      .sort((a, b) => b.perFrame - a.perFrame)
      .slice(0, 30),
    loadBefore,
    loadAfter,
  };
}

async function main(): Promise<void> {
  if (loadavg()[0] > 15) throw new Error(`Host load too high: ${loadavg()[0]}`);
  await mkdir(checkedTestRoot, { recursive: true });
  prepareQuestFixture(checkedTestRoot);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/.*/, (ws: WebSocketRoute) => {
    const id = new URL(ws.url()).searchParams.get('session') ?? 'metadata';
    ws.onMessage((raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
      if (bytes.length < 2 || bytes[0] !== 0) return;
      const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1))).message;
      if (message.case === 'muxTreeRequest') ws.send(snapshot());
    });
    if (id !== 'metadata') ws.send(connected(id));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const states: StateReport[] = [];
  try {
    for (const state of STATES) states.push(await measure(page, cdp, state));
  } finally {
    await browser.close();
  }
  const report = {
    kind: 'keyborb-perf',
    frames: MEASURED_FRAMES,
    cpuThrottle: CPU_THROTTLE,
    eyes: EYES,
    ablate: ABLATE,
    leftHand: LEFT_HAND,
    states,
    errors,
  };
  await writeFile(
    join(checkedTestRoot, 'keyborb-perf.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}

await main();
