import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { create, toBinary } from '@bufbuild/protobuf';
import { chromium, type Page, type WebSocketRoute } from 'playwright';
import type * as THREE from 'three';
import type { TerminalSurface } from '../src/contracts';
import {
  BellSchema,
  ConnectedSchema,
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
  OutputSchema,
  ResizeSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __bellScene: WorkspaceScene;
  __bellSurfaces: Map<string, TerminalSurface>;
  __bellSelect(id: string): void;
  __questRenderer: THREE.WebGLRenderer;
  __questCamera: THREE.PerspectiveCamera;
  __questThree: typeof THREE;
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = process.env.MUX_XR_TEST_ROOT;
assert(root && process.env.MUX_XR_PRIVATE_TEST === '1', 'Explicit private fixture root required');
const repo = process.cwd();
const loadBefore = loadavg()[0];
await mkdir(root, { recursive: true });
prepareQuestFixture(root);
const entry = join(root, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}\nObject.assign(window, { __bellScene: scene, __bellSurfaces: surfaces, __bellSelect: selectPane });\n`,
);
execFileSync('bun', ['build', entry, '--minify', '--target', 'browser', '--outdir', root]);
const server = createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    for (const directory of [root, join(repo, 'dist')]) {
      const path = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(`${resolve(directory)}/`)) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch {
        continue;
      }
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.ttf': 'font/ttf',
        '.png': 'image/png',
        '.glb': 'model/gltf-binary',
      };
      response.writeHead(200, {
        'Content-Type': types[extname(path)] ?? 'application/octet-stream',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; font-src 'self'; worker-src 'self'",
      });
      response.end(bytes);
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  })().catch(() => {
    response.writeHead(500);
    response.end('Fixture error');
  });
});
await new Promise<void>((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
const address = server.address();
assert(address && typeof address !== 'string', 'Fixture server did not bind');
const base = `http://127.0.0.1:${address.port}`;
const frame = (message: ServerMessage): Buffer =>
  Buffer.from([0, ...toBinary(ServerMessageSchema, message)]);
const tree = frame(
  create(ServerMessageSchema, {
    message: {
      case: 'muxTreeSnapshot',
      value: create(MuxTreeSnapshotSchema, {
        workspaces: [
          create(MuxTreeWorkspaceSchema, {
            id: 'w',
            name: 'Bell fixture',
            sessions: [
              create(MuxTreeSessionSchema, {
                id: 's',
                name: 'Bell tests',
                windows: [
                  create(MuxTreeWindowSchema, {
                    id: 'win',
                    name: 'Bell',
                    panes: ['%1', '%2'].map((id, index) =>
                      create(MuxTreePaneSchema, {
                        id,
                        title: `Bell ${index ? 'B' : 'A'}`,
                        cols: 80,
                        rows: 24,
                        active: index === 0,
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
const output = (text: string): Buffer =>
  frame(
    create(ServerMessageSchema, {
      message: {
        case: 'output',
        value: create(OutputSchema, { data: new TextEncoder().encode(text) }),
      },
    }),
  );
const explicitBell = frame(
  create(ServerMessageSchema, { message: { case: 'bell', value: create(BellSchema) } }),
);
async function fixture(page: Page): Promise<Map<string, WebSocketRoute>> {
  const sockets = new Map<string, WebSocketRoute>();
  await page.routeWebSocket(/.*/, (socket) => {
    const id = new URL(socket.url()).searchParams.get('session')?.replace('pane-', '%');
    socket.onMessage(() => {
      if (!id) socket.send(tree);
    });
    if (!id) {
      socket.send(tree);
      return;
    }
    sockets.set(id, socket);
    socket.send(
      frame(
        create(ServerMessageSchema, {
          message: {
            case: 'connected',
            value: create(ConnectedSchema, {
              cols: 80,
              rows: 24,
              initialScreen: new TextEncoder().encode(`\x1b[2J\x1b[H${id} fixture\r\n\x07`),
            }),
          },
        }),
      ),
    );
  });
  return sockets;
}
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const sockets = await fixture(page);
  await page.goto(`${base}/?server=${encodeURIComponent(base)}`);
  await page
    .getByRole('button', { name: /Bell B/ })
    .first()
    .click();
  const pane = page.locator('[data-pane-id="%2"]');
  const badge = pane.locator('.desktop-terminal-bell');
  await pane.getByRole('button', { name: /connected/ }).waitFor();
  await page.waitForTimeout(200);
  assert(!(await badge.isVisible()), 'Initial screen must not replay a bell');
  const canvas = pane.locator('canvas');
  const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  sockets.get('%2')?.send(output('\x1b]0;Title only'));
  sockets.get('%2')?.send(output('\x07OSC completed\r\n'));
  await page.waitForFunction(
    ({ before }) =>
      document.querySelector<HTMLCanvasElement>('[data-pane-id="%2"] canvas')?.toDataURL() !==
      before,
    { before },
  );
  assert(!(await badge.isVisible()), 'OSC BEL terminator produced a false bell');
  sockets.get('%2')?.send(output('\x07'));
  await badge.waitFor({ state: 'visible' });
  assert(
    !(await page.locator('[data-pane-id="%1"] .desktop-terminal-bell').isVisible()),
    'Bell leaked to another pane',
  );
  await page.screenshot({ path: join(root, 'bell-desktop.png') });
  await pane.locator('.desktop-terminal-heading').click();
  await badge.waitFor({ state: 'hidden' });
  sockets.get('%2')?.send(explicitBell);
  await badge.waitFor({ state: 'visible' });
  await pane.locator('.desktop-terminal-heading').click();
  await badge.waitFor({ state: 'hidden' });
  await page.close();

  const xr = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  xr.on('pageerror', (error) => errors.push(error.message));
  const xrSockets = await fixture(xr);
  await xr.goto(`${base}/__quest-controls.html?server=${encodeURIComponent(base)}`);
  await xr.waitForFunction(() => Boolean((window as unknown as FixtureWindow).__bellScene));
  await xr.evaluate(() => (window as unknown as FixtureWindow).__bellSelect('%2'));
  await xr.waitForFunction(
    () => (window as unknown as FixtureWindow).__bellSurfaces.get('%2')?.status === 'connected',
  );
  await xr.locator('[data-action="xr"]').click();
  await xr.waitForFunction(
    () => (window as unknown as FixtureWindow).__bellScene.state.xrMode === 'vr',
  );
  await xr.evaluate(() => {
    const w = window as unknown as FixtureWindow;
    w.__bellScene.setTerminalCurvature('%2', 100);
    w.__bellScene.setTerminalCurvature('%2', 0);
    w.__bellScene.setTerminalCurvature('%2', 100);
    const panel = w.__bellScene.scene.getObjectByName('terminal-panel-%2');
    if (panel) w.__questCamera.lookAt(panel.getWorldPosition(new w.__questThree.Vector3()));
  });
  xrSockets.get('%2')?.send(
    frame(
      create(ServerMessageSchema, {
        message: { case: 'resize', value: create(ResizeSchema, { cols: 40, rows: 24 }) },
      }),
    ),
  );
  xrSockets.get('%2')?.send(output('\x07'));
  await xr.waitForFunction(
    () =>
      (window as unknown as FixtureWindow).__bellScene.scene
        .getObjectByName('terminal-panel-%2')
        ?.getObjectByName('terminal-bell-indicator')?.visible,
  );
  const visual = await xr.evaluate(async () => {
    const w = window as unknown as FixtureWindow;
    const panel = w.__bellScene.scene.getObjectByName('terminal-panel-%2');
    const bell = panel?.getObjectByName('terminal-bell-indicator');
    if (!bell) throw new Error('Bell mesh missing');
    await bell.userData.labelSyncPromise;
    const gl = w.__questRenderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      x: bell.position.x,
      label: bell.userData.labelText,
      pending: w.__bellSurfaces.get('%2')?.bellPending,
    };
  });
  assert(
    /Metal|Apple/.test(visual.renderer) && !/SwiftShader/.test(visual.renderer),
    `Expected native Metal: ${visual.renderer}`,
  );
  assert(
    visual.pending && visual.label === 'BELL' && Math.abs(visual.x - 0.58) < 1e-6,
    'Curved/resized bell placement drifted',
  );
  await xr.screenshot({ path: join(root, 'bell-xr.png') });
  await xr.evaluate(() => (window as unknown as FixtureWindow).__bellScene.selectTerminal('%2'));
  await xr.waitForFunction(
    () => !(window as unknown as FixtureWindow).__bellSurfaces.get('%2')?.bellPending,
  );
  assert(
    !(await xr.evaluate(
      () =>
        (window as unknown as FixtureWindow).__bellScene.scene
          .getObjectByName('terminal-panel-%2')
          ?.getObjectByName('terminal-bell-indicator')?.visible,
    )),
    'XR refocus did not hide bell',
  );
  await xr.screenshot({ path: join(root, 'bell-xr-cleared.png') });
  assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  const result = {
    desktopProduction: true,
    realParser: true,
    oscIgnored: true,
    explicitBell: true,
    paneIsolation: true,
    desktopFocusClears: true,
    xrFixture: true,
    curvedResize: true,
    xrRefocusClears: true,
    ...visual,
    loadBefore,
    loadAfter: loadavg()[0],
  };
  await writeFile(join(root, 'bell-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
