// Runs the real app against a private par-mux daemon and mux-enabled streamer, never the default
// daemon. The served root must contain a copy of dist (fonts and assets), and the daemon needs two
// separate 80x24 sessions rather than one split window, whose layout caps a pane's resize:
//   par-mux --socket S --state-dir D start --no-attach
//   par-mux --socket S --cmd "new-session -s a -x 80 -y 24"   (and again for -s b)
//   cp -R dist/. ROOT && par-term-streamer --host 127.0.0.1 --port 4241 --enable-http \
//     --web-root ROOT --mux-socket S
//   MUX_XR_PRIVATE_TEST=1 MUX_XR_BASE_URL=http://127.0.0.1:4241 MUX_XR_TEST_ROOT=ROOT \
//     bun run scripts/quest-controls-check.ts
import { fromBinary } from '@bufbuild/protobuf';
import { chromium, type Page } from 'playwright';
import { decodeServerMessage } from '../src/terminal/protocol';
import { ClientMessageSchema } from '../src/terminal/vendor/terminal_pb';
import { prepareQuestFixture } from './prepare-quest-fixture';

type AppState = {
  attached: string[];
  selectedId: string | null;
  scene: { xrMode: string };
  panes: Array<{ id: string; cols?: number; rows?: number }>;
  streams: Array<{ id: string; cols: number; rows: number; status: string; writable: boolean }>;
};
type Frame = { paneId: string; case: string; data?: string };
const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function state(page: Page): Promise<AppState> {
  return page.evaluate(() =>
    (window as unknown as { __muxXR: { getState: () => AppState } }).__muxXR.getState(),
  );
}

async function waitFor<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  message: string,
): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

type ControlExpectation = {
  terminalId?: string;
  mode?: string;
  field?: string;
  key?: string;
  colorMode?: string;
  cols?: number;
  rows?: number;
  label?: string;
  radialAction?: string;
};

async function clickControl(
  page: Page,
  action: string,
  expected: ControlExpectation = {},
): Promise<void> {
  await page.evaluate(
    async ({ action, expected }) => {
      const root = (
        window as unknown as {
          __questScene: import('three').Scene;
          __questControllers: import('three').Group[];
        }
      ).__questScene;
      const controller = (window as unknown as { __questControllers: import('three').Group[] })
        .__questControllers[0];
      let target: import('three').Object3D | undefined;
      root.traverse((object) => {
        if (target || object.userData.inputAction !== action) return;
        if (expected.terminalId !== undefined && object.userData.terminalId !== expected.terminalId)
          return;
        if (expected.mode !== undefined && object.userData.mode !== expected.mode) return;
        if (expected.field !== undefined && object.userData.field !== expected.field) return;
        if (expected.key !== undefined && object.userData.key !== expected.key) return;
        if (expected.colorMode !== undefined && object.userData.colorMode !== expected.colorMode)
          return;
        if (expected.cols !== undefined && object.userData.cols !== expected.cols) return;
        if (expected.rows !== undefined && object.userData.rows !== expected.rows) return;
        if (expected.label !== undefined && object.userData.labelText !== expected.label) return;
        if (
          expected.radialAction !== undefined &&
          object.userData.radialAction !== expected.radialAction
        )
          return;
        target = object;
      });
      if (!target)
        throw new Error(`native control not found: ${action} ${JSON.stringify(expected)}`);
      const point = target.getWorldPosition(
        new (window as unknown as { __questThree: typeof import('three') }).__questThree.Vector3(),
      );
      const targetRotation = target.getWorldQuaternion(
        new (
          window as unknown as { __questThree: typeof import('three') }
        ).__questThree.Quaternion(),
      );
      const offset = new (
        window as unknown as { __questThree: typeof import('three') }
      ).__questThree.Vector3(0, 0, 0.35).applyQuaternion(targetRotation);
      controller.position.copy(point).add(offset);
      controller.quaternion.copy(targetRotation);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    { action, expected },
  );
}

async function key(page: Page, value: string): Promise<void> {
  await clickControl(page, 'key', { key: value });
}

async function radial(page: Page, action: string): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __questControllers: import('three').Group[];
      __questPad?: { buttons: Array<{ pressed: boolean }>; axes: number[] };
    };
    if (!w.__questPad)
      w.__questPad = {
        buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
        axes: [0, 0, 0, 0],
      };
    const pad = w.__questPad;
    if (!w.__questControllers[1].userData.questPadConnected) {
      w.__questControllers[1].dispatchEvent({
        type: 'connected',
        data: { gamepad: pad, handedness: 'right' },
      } as never);
      w.__questControllers[1].userData.questPadConnected = true;
    }
    pad.buttons[4].pressed = true;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    pad.buttons[4].pressed = false;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await waitFor(
    () =>
      page.evaluate(() =>
        Boolean(
          (
            window as unknown as { __questScene: import('three').Scene }
          ).__questScene.getObjectByName('radial-menu')?.userData.interactive,
        ),
      ),
    (value) => value,
    'Radial menu did not become interactive',
  );
  await clickControl(page, 'radialAction', { radialAction: action });
  await page.waitForTimeout(180);
}

async function typeNative(page: Page, text: string): Promise<void> {
  for (const character of text) await key(page, character);
}

async function panelMetrics(page: Page, id: string) {
  return page.evaluate((paneId) => {
    const root = (
      window as unknown as { __questScene: import('three').Scene }
    ).__questScene.getObjectByName(`terminal-panel-${paneId}`);
    const screen = root?.getObjectByName('terminal-surface') as
      | import('three').Mesh<import('three').PlaneGeometry, import('three').MeshBasicMaterial>
      | undefined;
    const image = screen?.material.map?.image as
      | HTMLCanvasElement
      | { data: Uint8Array; width: number; height: number }
      | undefined;
    const pixels =
      image &&
      ('data' in image
        ? image.data
        : image.getContext('2d')?.getImageData(0, 0, image.width, image.height).data);
    if (!root || !screen || !pixels) throw new Error('Missing live panel pixels');
    let hash = 2166136261;
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619) >>> 0;
    return {
      hash,
      width: screen.geometry.parameters.width,
      height: screen.geometry.parameters.height,
      position: root.position.toArray(),
      scale: root.scale.x,
    };
  }, id);
}

async function main(): Promise<void> {
  assert(
    BASE_URL && TEST_ROOT && PRIVATE_TEST,
    'MUX_XR_BASE_URL, MUX_XR_TEST_ROOT, and MUX_XR_PRIVATE_TEST=1 are required',
  );
  prepareQuestFixture(TEST_ROOT);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const frames: Frame[] = [];
  const output = new Map<string, string>();
  const errors: string[] = [];
  let resizeMessages = 0;
  let viewerConnections = 0;
  await page.addInitScript(() => {
    const NativeWebSocket = WebSocket;
    const sockets: WebSocket[] = [];
    class RecordingWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: RecordingWebSocket });
    Object.assign(window, { __questSockets: sockets });
    const session = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      end: async () => undefined,
      requestReferenceSpace: async () => ({}),
    };
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: { requestSession: async () => session },
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    const paneId =
      new URL(socket.url()).searchParams.get('session')?.replace(/^pane-/, '%') ?? 'metadata';
    if (!output.has(paneId)) output.set(paneId, '');
    if (paneId !== 'metadata') viewerConnections += 1;
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const bytes = Buffer.from(payload);
        const message = decodeServerMessage(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
        if (message.message.case === 'output')
          output.set(
            paneId,
            `${output.get(paneId) ?? ''}${new TextDecoder().decode(message.message.value.data)}`,
          );
      } catch (error) {
        errors.push(`server frame: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const bytes = Buffer.from(payload);
        const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
        if (message.message.case === 'resize') resizeMessages += 1;
        if (message.message.case === 'input')
          frames.push({
            paneId,
            case: 'input',
            data: new TextDecoder().decode(message.message.value.data),
          });
      } catch (error) {
        errors.push(`client frame: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
  try {
    await page.goto(`${BASE_URL}/__quest-controls.html?server=${encodeURIComponent(BASE_URL)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    const initial = await waitFor(
      () => state(page),
      (value) => value.attached.length >= 2,
      'real app did not attach two panes',
    );
    const paneIds = initial.attached.slice(0, 2);
    await waitFor(
      () => state(page),
      (value) =>
        value.streams.length >= 2 &&
        value.streams.every((stream) => stream.status === 'connected' && stream.writable),
      'Private streams did not become writable',
    );
    await page.locator('[data-action="xr"]').click();
    await waitFor(
      () => state(page),
      (value) => value.scene.xrMode === 'vr',
      'XR shim did not enter VR mode',
    );
    await page.waitForFunction(
      () => Boolean((window as unknown as { __questScene?: unknown }).__questScene),
      undefined,
      { timeout: 5_000 },
    );
    await page.evaluate(async () => {
      const scene = (window as unknown as { __questScene: import('three').Scene }).__questScene;
      const pending: Promise<void>[] = [];
      scene.traverse((object) => {
        const promise = object.userData.labelSyncPromise as Promise<void> | undefined;
        if (promise) pending.push(promise);
      });
      await Promise.race([
        Promise.all(pending),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('native SDF labels did not sync')), 12_000),
        ),
      ]);
    });
    await radial(page, 'widgets');
    await radial(page, 'keyboard');
    for (const paneId of paneIds) {
      const beforePixels = await panelMetrics(page, paneId);
      await page.evaluate(
        (id) =>
          (
            window as unknown as { __muxXR: { selectPane: (pane: string) => void } }
          ).__muxXR.selectPane(id),
        paneId,
      );
      const keyboardOpen = await page.evaluate(() =>
        Boolean(
          (
            window as unknown as { __questScene: import('three').Scene }
          ).__questScene.getObjectByName('xr-keyboard-controls'),
        ),
      );
      if (!keyboardOpen) await radial(page, 'keyboard');
      await typeNative(page, `echo native${paneId.slice(1)}`);
      await key(page, 'Enter');
      await waitFor(
        () => Promise.resolve(output.get(paneId) ?? ''),
        (text) => text.includes(`native${paneId.slice(1)}`),
        `native output missing for ${paneId}`,
      );
      await waitFor(
        () => panelMetrics(page, paneId),
        (value) => value.hash !== beforePixels.hash,
        `Native typing did not change visible pixels for ${paneId}`,
      );
    }
    assert(
      resizeMessages === 0,
      `typing or pane selection emitted ${resizeMessages} resize messages`,
    );
    await page.evaluate(
      (id) =>
        (window as unknown as { __muxXR: { selectPane(id: string): void } }).__muxXR.selectPane(id),
      paneIds[0],
    );
    const originalGrid = (await state(page)).streams.find((stream) => stream.id === paneIds[0]);
    assert(originalGrid, 'Original grid was not available');
    const initialPanel = await panelMetrics(page, paneIds[0]);
    await radial(page, 'settings');
    await clickControl(page, 'openInput', { mode: 'display' });
    const colorHashes: number[] = [];
    for (const colorMode of ['original', 'monochrome', 'comfort'] as const) {
      await clickControl(page, 'terminalColors', { colorMode });
      colorHashes.push(
        await page.evaluate(() => {
          const fixture = window as unknown as {
            __questScene: import('three').Scene;
            __muxXR: { getState(): AppState };
          };
          const panel = fixture.__questScene.getObjectByName(
            `terminal-panel-${fixture.__muxXR.getState().selectedId}`,
          );
          const screen = panel?.getObjectByName('terminal-surface') as
            | import('three').Mesh<import('three').PlaneGeometry, import('three').MeshBasicMaterial>
            | undefined;
          const image = screen?.material.map?.image as
            | HTMLCanvasElement
            | { data: Uint8Array; width: number; height: number }
            | undefined;
          const pixels =
            image &&
            ('data' in image
              ? image.data
              : image.getContext('2d')?.getImageData(0, 0, image.width, image.height).data);
          if (!pixels) throw new Error('Terminal pixels were not available');
          let hash = 2166136261;
          for (const value of pixels) hash = Math.imul(hash ^ value, 16777619) >>> 0;
          return hash;
        }),
      );
    }
    assert(
      new Set(colorHashes).size >= 2,
      `terminal color modes did not change rendered pixels: ${colorHashes.join(',')}`,
    );
    await clickControl(page, 'openInput', { mode: 'settings' });
    await clickControl(page, 'openInput', { mode: 'terminal' });
    await clickControl(page, 'gridPreset', { cols: 100, rows: 30 });
    await clickControl(page, 'gridApply');
    await waitFor(
      () => Promise.resolve(frames.length),
      (count) => count > 0,
      'grid resize frame missing',
    );
    assert(Number(resizeMessages) === 1, `expected one grid resize request, got ${resizeMessages}`);
    await waitFor(
      () => state(page),
      (value) =>
        value.panes.some((pane) => pane.id === paneIds[0] && pane.cols === 100 && pane.rows === 30),
      'server did not acknowledge 100x30 grid geometry',
    );
    const resizedPanel = await panelMetrics(page, paneIds[0]);
    assert(
      Math.abs(resizedPanel.width / initialPanel.width - 100 / originalGrid.cols) < 1e-6,
      'XR window width did not follow acknowledged columns',
    );
    assert(
      Math.abs(resizedPanel.height / initialPanel.height - 30 / originalGrid.rows) < 1e-6,
      'XR window height did not follow acknowledged rows',
    );
    assert(
      resizedPanel.scale === initialPanel.scale &&
        JSON.stringify(resizedPanel.position) === JSON.stringify(initialPanel.position),
      'Grid acknowledgement reset manual panel transforms',
    );
    await clickControl(page, 'gridPreset', { cols: originalGrid.cols, rows: originalGrid.rows });
    await clickControl(page, 'gridApply');
    assert(
      Number(resizeMessages) === 2,
      `expected grid restore resize request, got ${resizeMessages}`,
    );
    await waitFor(
      () => state(page),
      (value) =>
        value.streams.some(
          (pane) =>
            pane.id === paneIds[0] &&
            pane.cols === originalGrid.cols &&
            pane.rows === originalGrid.rows,
        ),
      'server did not acknowledge restored grid geometry',
    );
    await radial(page, 'commands');
    await clickControl(page, 'newCommand');
    await clickControl(page, 'commandField', { field: 'label' });
    await typeNative(page, 'native command');
    await clickControl(page, 'commandField', { field: 'text' });
    await typeNative(page, 'echo nativecommand');
    const beforeSaveInputs = frames.length;
    await clickControl(page, 'commandSave');
    assert(frames.length === beforeSaveInputs, 'saving native command executed input');
    await clickControl(page, 'command', { label: 'native command' });
    await waitFor(
      () => Promise.resolve(output.get(paneIds[0]) ?? ''),
      (text) => text.includes('nativecommand'),
      'saved native command did not execute',
    );
    await clickControl(page, 'close');
    await clickControl(page, 'toggleConnection', { terminalId: paneIds[0] });
    await waitFor(
      () => state(page),
      (value) =>
        value.streams.some((stream) => stream.id === paneIds[0] && stream.status === 'paused'),
      'Native Disconnect did not pause the stream',
    );
    await clickControl(page, 'toggleConnection', { terminalId: paneIds[0] });
    await waitFor(
      () => state(page),
      (value) => value.streams.every((stream) => stream.status === 'connected'),
      'Native Reconnect did not resume the stream',
    );
    await clickControl(page, 'closePane', { terminalId: paneIds[0] });
    await waitFor(
      () => state(page),
      (value) =>
        !value.attached.includes(paneIds[0]) && value.panes.some((pane) => pane.id === paneIds[0]),
      'Native Close view did not preserve the pane in the hierarchy',
    );
    await page.evaluate(
      (id) =>
        (window as unknown as { __muxXR: { selectPane(id: string): void } }).__muxXR.selectPane(id),
      paneIds[0],
    );
    await waitFor(
      () => state(page),
      (value) =>
        value.streams.length === 2 &&
        value.streams.every((stream) => stream.status === 'connected'),
      'Native-closed pane did not reopen',
    );
    const connectionsBeforeReconnect = viewerConnections;
    const inputsBeforeReconnect = frames.length;
    await page.evaluate((ids) => {
      const sockets = (window as unknown as { __questSockets: WebSocket[] }).__questSockets;
      for (const socket of sockets)
        if (ids.some((id) => socket.url.includes(`session=pane-${id.slice(1)}`))) socket.close();
    }, paneIds);
    await waitFor(
      () => Promise.resolve(viewerConnections),
      (count) => count > connectionsBeforeReconnect,
      'viewer sockets did not reconnect',
    );
    await waitFor(
      () => state(page),
      (value) => value.streams.every((stream) => stream.status === 'connected'),
      'Viewer did not finish reconnecting',
    );
    assert(frames.length === inputsBeforeReconnect, 'Reconnect replayed input');
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="Mux XR workspace"]',
      );
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
    assert(
      renderer !== 'unavailable' && !String(renderer).toLowerCase().includes('swiftshader'),
      `GPU renderer unavailable: ${renderer}`,
    );
    assert(errors.length === 0, `native page errors: ${errors.join('; ')}`);
    await page.screenshot({ path: `${TEST_ROOT}/quest-controls-native.png`, fullPage: true });
    console.log(
      JSON.stringify(
        {
          kind: 'quest-controls-check',
          baseUrl: BASE_URL,
          testRoot: TEST_ROOT,
          renderer,
          paneIds,
          frames,
          resizeMessages,
          colorHashes,
          initialPanel,
          resizedPanel,
          viewerConnections,
          nativeLifecycleControls: true,
          errors,
          output: Object.fromEntries(output),
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
