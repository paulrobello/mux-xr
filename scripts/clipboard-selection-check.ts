import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { chromium, type WebSocketRoute } from 'playwright';
import type * as THREE from 'three';
import type { TerminalSurface } from '../src/contracts';
import {
  ClientMessageSchema,
  ConnectedSchema,
  ModeChangedSchema,
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
  OutputSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __selectionScene: WorkspaceScene;
  __selectionSurfaces: Map<string, TerminalSurface>;
  __questControllers: THREE.Group[];
  __questThree: typeof THREE;
  __questRenderer: THREE.WebGLRenderer;
  __questCamera: THREE.PerspectiveCamera;
  __aimSelection(col: number, row: number): void;
  __clipboardWrite: Clipboard['writeText'];
  __rejectClipboard?: () => void;
};

const base = process.env.MUX_XR_BASE_URL;
const root = process.env.MUX_XR_TEST_ROOT;
if (
  !base ||
  !root ||
  process.env.MUX_XR_PRIVATE_TEST !== '1' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)
)
  throw new Error('Clipboard check requires an explicit private loopback URL and root');
const before = loadavg()[0];
if (before > 15) throw new Error(`Host load too high: ${before}`);
await mkdir(root, { recursive: true });
prepareQuestFixture(root);
const entry = join(root, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}\nObject.assign(window, { __selectionScene: scene, __selectionSurfaces: surfaces });\n`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', root], { stdio: 'pipe' });
const frame = (message: ServerMessage): Buffer =>
  Buffer.from([0, ...toBinary(ServerMessageSchema, message)]);
const panes = ['%1', '%2'];
const tree = frame(
  create(ServerMessageSchema, {
    message: {
      case: 'muxTreeSnapshot',
      value: create(MuxTreeSnapshotSchema, {
        workspaces: [
          create(MuxTreeWorkspaceSchema, {
            id: 'w',
            name: 'W',
            sessions: [
              create(MuxTreeSessionSchema, {
                id: 's',
                name: 'S',
                windows: [
                  create(MuxTreeWindowSchema, {
                    id: 'win',
                    name: 'Win',
                    panes: panes.map((id) =>
                      create(MuxTreePaneSchema, {
                        id,
                        title: id,
                        cols: 80,
                        rows: 24,
                        active: id === '%1',
                      }),
                    ),
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
const normalScreen = '\x1b[2J\x1b[Halpha bravo charlie\r\ndelta echo foxtrot\r\nwide: 界 😀 café';
let useScrollback = false;
const routes = new Map<string, WebSocketRoute>();
const messages: string[] = [];
const pastedInputs: string[] = [];
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.routeWebSocket(/.*/, (socket) => {
  const id = new URL(socket.url()).searchParams.get('session')?.replace('pane-', '%');
  socket.onMessage((raw) => {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
    const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
    if (message.message.case === 'muxTreeRequest') socket.send(tree);
    else {
      messages.push(message.message.case ?? 'empty');
      if (message.message.case === 'input')
        pastedInputs.push(new TextDecoder().decode(message.message.value.data));
      if (message.message.case === 'paste') pastedInputs.push(message.message.value.content);
    }
  });
  if (!id) {
    socket.send(tree);
    return;
  }
  routes.set(id, socket);
  const screen = useScrollback
    ? Array.from({ length: 30 }, (_, index) => `line-${String(index).padStart(2, '0')}`).join(
        '\r\n',
      )
    : normalScreen;
  socket.send(
    frame(
      create(ServerMessageSchema, {
        message: {
          case: 'connected',
          value: create(ConnectedSchema, {
            cols: 80,
            rows: 24,
            initialScreen: new TextEncoder().encode(screen),
          }),
        },
      }),
    ),
  );
});

let originalClipboard: string | undefined;
const setup = async (): Promise<void> => {
  await page.goto(`${base}/__quest-controls.html?server=${encodeURIComponent(base)}`, {
    waitUntil: 'load',
  });
  await page.waitForFunction(
    () =>
      (window as unknown as FixtureWindow).__selectionSurfaces?.get('%1')?.status === 'connected',
  );
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__selectionScene.state.xrMode === 'vr',
  );
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    const three = w.__questThree;
    const controller = w.__questControllers[0];
    const panel = w.__selectionScene.scene.getObjectByName('terminal-panel-%1');
    if (panel) w.__questCamera.lookAt(panel.getWorldPosition(new three.Vector3()));
    controller.dispatchEvent({
      type: 'connected',
      data: {
        handedness: 'right',
        gamepad: {
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
        },
      },
    } as never);
    w.__aimSelection = (col, row): void => {
      const surface = w.__selectionSurfaces.get('%1');
      const screen = w.__selectionScene.scene
        .getObjectByName('terminal-panel-%1')
        ?.getObjectByName('terminal-surface') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      if (!surface || !screen) throw new Error('Selection surface missing');
      const geometry = screen.geometry;
      const positions = geometry.getAttribute('position');
      const uvs = geometry.getAttribute('uv');
      const indices = geometry.getIndex();
      const texture = screen.material.map;
      texture?.updateMatrix();
      const uv = new three.Vector2((col + 0.5) / surface.cols, 1 - (row + 0.5) / surface.rows);
      if (texture) uv.applyMatrix3(texture.matrix.clone().invert());
      for (let index = 0; index < (indices?.count ?? positions.count); index += 3) {
        const ids = [0, 1, 2].map((offset) => indices?.getX(index + offset) ?? index + offset);
        const coordinates = ids.map((id) => new three.Vector2(uvs.getX(id), uvs.getY(id)));
        const [a, b, c] = coordinates;
        const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        const wa = ((b.y - c.y) * (uv.x - c.x) + (c.x - b.x) * (uv.y - c.y)) / denominator;
        const wb = ((c.y - a.y) * (uv.x - c.x) + (a.x - c.x) * (uv.y - c.y)) / denominator;
        const weights = [wa, wb, 1 - wa - wb];
        if (weights.some((weight) => weight < -1e-6)) continue;
        const vertices = ids.map((id) => new three.Vector3().fromBufferAttribute(positions, id));
        const local = new three.Vector3();
        weights.forEach((weight, i) => {
          local.addScaledVector(vertices[i], weight);
        });
        screen.updateWorldMatrix(true, false);
        const normal = vertices[1]
          .clone()
          .sub(vertices[0])
          .cross(vertices[2].clone().sub(vertices[0]))
          .applyNormalMatrix(new three.Matrix3().getNormalMatrix(screen.matrixWorld))
          .normalize();
        controller.position.copy(screen.localToWorld(local)).addScaledVector(normal, 0.3);
        controller.quaternion.setFromUnitVectors(new three.Vector3(0, 0, 1), normal);
        return;
      }
      throw new Error('Requested cell is outside the displayed viewport');
    };
  });
  await page.waitForTimeout(100);
};
const begin = async (col: number, row: number): Promise<void> => {
  await page.evaluate(
    ({ col, row }) => {
      const w = window as unknown as FixtureWindow;
      w.__aimSelection(col, row);
      w.__questControllers[0].dispatchEvent({ type: 'selectstart' } as never);
    },
    { col, row },
  );
};
const drag = async (col: number, row: number): Promise<void> => {
  await page.evaluate(
    ({ col, row }) => (window as unknown as FixtureWindow).__aimSelection(col, row),
    { col, row },
  );
  await page.waitForTimeout(75);
};
const finish = async (complete = true): Promise<void> => {
  await page.evaluate((complete) => {
    const w = window as unknown as FixtureWindow;
    if (complete) w.__questControllers[0].dispatchEvent({ type: 'select' } as never);
    w.__questControllers[0].dispatchEvent({ type: 'selectend' } as never);
  }, complete);
};
const selectionText = (): Promise<string> =>
  page.evaluate(
    () =>
      (window as unknown as FixtureWindow).__selectionSurfaces.get('%1')?.getSelectionText?.() ??
      '',
  );
const selectionPixel = (): Promise<number[]> =>
  page.evaluate(() => {
    const canvas = (window as unknown as FixtureWindow).__selectionSurfaces.get('%1')?.canvas;
    if (!canvas) throw new Error('Selection canvas missing');
    return [
      ...(canvas
        .getContext('2d')
        ?.getImageData(
          Math.floor((11.1 / 80) * canvas.width),
          Math.floor((0.1 / 24) * canvas.height),
          1,
          1,
        ).data ?? []),
    ];
  });

try {
  await setup();
  originalClipboard = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__selectionScene.setTerminalCurvature('%1', 60),
  );
  await begin(6, 0);
  await drag(9, 1);
  const multiline = await selectionText();
  if (multiline !== 'bravo charlie\ndelta echo')
    throw new Error(`Incorrect multiline range: ${JSON.stringify(multiline)}`);
  await page.screenshot({ path: join(root, 'clipboard-selected.png') });
  const highlightedPixel = await selectionPixel();
  await finish();
  await page.waitForFunction(
    () => !(window as unknown as FixtureWindow).__selectionSurfaces.get('%1')?.getSelectionText?.(),
  );
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== multiline)
    throw new Error('Actual clipboard differs from selected range');
  await page.waitForTimeout(80);
  const clearedPixel = await selectionPixel();
  if (JSON.stringify(highlightedPixel) === JSON.stringify(clearedPixel))
    throw new Error('Clearing selection did not repaint its highlight');
  await page.screenshot({ path: join(root, 'clipboard-cleared.png') });

  await begin(15, 2);
  await drag(7, 2);
  const unicode = await selectionText();
  if (unicode !== '界 😀 café')
    throw new Error(`Unicode reverse range mismatch: ${JSON.stringify(unicode)}`);
  await finish();
  await page.waitForFunction(
    () => !(window as unknown as FixtureWindow).__selectionSurfaces.get('%1')?.getSelectionText?.(),
  );
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== unicode)
    throw new Error('Unicode clipboard mismatch');

  await begin(6, 0);
  await drag(9, 1);
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__clipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = () =>
      new Promise<void>((_resolve, reject) => {
        w.__rejectClipboard = () => reject(new DOMException('Test rejection', 'NotAllowedError'));
      });
  });
  await finish();
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__questControllers[1].dispatchEvent({ type: 'squeezestart' } as never);
    w.__questControllers[1].dispatchEvent({ type: 'squeezeend' } as never);
    w.__selectionScene.resetLayout();
  });
  if (await selectionText()) throw new Error('Released selection did not clear immediately');
  await page.evaluate(() => (window as unknown as FixtureWindow).__rejectClipboard?.());
  await page.waitForFunction(() =>
    (window as unknown as FixtureWindow).__selectionScene.state.toast?.includes('Copied in Mux XR'),
  );
  if (await selectionText()) throw new Error('Rejected clipboard write restored the highlight');
  if (messages.some((message) => ['input', 'paste', 'mouse', 'resize'].includes(message)))
    throw new Error(`Local selection leaked terminal traffic: ${messages}`);
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__selectionScene.showInput('keyboard');
    w.__selectionScene.scene.updateMatrixWorld(true);
    let paste: THREE.Object3D | undefined;
    w.__selectionScene.scene.traverse((object) => {
      if (!paste && object.userData.inputAction === 'pasteClipboard') paste = object;
    });
    if (!paste) throw new Error('Native Paste button missing');
    const controller = w.__questControllers[0];
    const rotation = paste.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(paste.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
    controller.quaternion.copy(rotation);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'select' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
  });
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__selectionScene.state.toast === 'Pasted.',
  );
  await page.waitForTimeout(50);
  if (
    pastedInputs.length !== 1 ||
    pastedInputs[0] !== multiline ||
    messages.filter((message) => message === 'paste').length !== 1 ||
    messages.includes('input')
  )
    throw new Error(`Paste did not send exact text without Enter: ${JSON.stringify(pastedInputs)}`);
  await page.screenshot({ path: join(root, 'clipboard-paste.png') });
  await page.evaluate(() => (window as unknown as FixtureWindow).__selectionScene.hideInput());
  messages.length = 0;
  await page.evaluate(() => {
    navigator.clipboard.writeText = (window as unknown as FixtureWindow).__clipboardWrite;
  });

  await begin(6, 0);
  await drag(9, 1);
  await finish(false);
  if (await selectionText()) throw new Error('Cancelled gesture retained drag');
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== unicode)
    throw new Error('Cancelled gesture copied text');
  await begin(6, 0);
  await drag(9, 1);
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__questControllers[1].dispatchEvent({ type: 'squeezestart' } as never);
    w.__questControllers[1].dispatchEvent({ type: 'squeezeend' } as never);
  });
  await finish();
  if (await selectionText()) throw new Error('Grip failed to cancel selection');
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== unicode)
    throw new Error('Grip copied text');
  if (messages.some((message) => ['input', 'paste', 'mouse', 'resize'].includes(message)))
    throw new Error(`Local selection leaked terminal traffic: ${messages}`);

  useScrollback = true;
  await setup();
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__selectionSurfaces.get('%1')?.scroll?.(-4),
  );
  await begin(0, 0);
  await drag(6, 0);
  routes.get('%1')?.send(
    frame(
      create(ServerMessageSchema, {
        message: {
          case: 'output',
          value: create(OutputSchema, { data: new TextEncoder().encode('\x1b[24;1Hspinner |') }),
        },
      }),
    ),
  );
  await page.waitForTimeout(80);
  if ((await selectionText()) !== 'line-02')
    throw new Error(
      `Scrollback/unrelated-output selection mismatch: ${JSON.stringify(await selectionText())}`,
    );
  await finish();
  await page.waitForFunction(
    () => !(window as unknown as FixtureWindow).__selectionSurfaces.get('%1')?.getSelectionText?.(),
  );
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== 'line-02')
    throw new Error('Scrollback clipboard mismatch');
  routes.get('%1')?.send(
    frame(
      create(ServerMessageSchema, {
        message: {
          case: 'modeChanged',
          value: create(ModeChangedSchema, { mode: 'mouse_button_event', enabled: true }),
        },
      }),
    ),
  );
  await page.waitForTimeout(50);
  await begin(0, 0);
  await drag(6, 0);
  await finish();
  if (await selectionText()) throw new Error('TUI mouse drag selected local text');
  if (messages.filter((message) => message === 'mouse').length < 2)
    throw new Error('TUI mouse reports missing');

  const renderer = await page.evaluate(() => {
    const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
  });
  const after = loadavg()[0];
  if (!/Apple/.test(renderer) || /SwiftShader/i.test(renderer) || after > 15 || errors.length)
    throw new Error(JSON.stringify({ renderer, after, errors }));
  const result = {
    kind: 'native-controller-clipboard',
    renderer,
    before,
    after,
    multiline,
    unicode,
    scrollback: 'line-02',
    highlightedPixel,
    clearedPixel,
    copiedAndCleared: true,
    rejectionCleared: true,
    nativePasteExactWithoutEnter: true,
    cancellationSafe: true,
    gripSafe: true,
    tuiMousePreserved: true,
    errors,
    traffic: 'all WebSockets intercepted',
  };
  await writeFile(join(root, 'clipboard-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await page
    .evaluate(() => {
      const w = window as unknown as FixtureWindow;
      if (w.__clipboardWrite) navigator.clipboard.writeText = w.__clipboardWrite;
    })
    .catch(() => undefined);
  if (originalClipboard !== undefined)
    await page
      .evaluate((text) => navigator.clipboard.writeText(text), originalClipboard)
      .catch(() => undefined);
  await browser.close();
}
