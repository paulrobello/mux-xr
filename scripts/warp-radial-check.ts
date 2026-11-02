import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  OutputSchema,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { prepareQuestFixture } from './prepare-quest-fixture';

const baseUrl = process.env.MUX_XR_BASE_URL;
const testRoot = process.env.MUX_XR_TEST_ROOT;
if (!baseUrl || !testRoot || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error(
    'warp-radial-check requires MUX_XR_PRIVATE_TEST=1, MUX_XR_BASE_URL, and MUX_XR_TEST_ROOT',
  );
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname))
  throw new Error('warp-radial-check only accepts a loopback BASE_URL');
const serverUrl = baseUrl as string;

type BrowserWindow = Window & {
  __muxXR: {
    getState(): { attached: string[]; scene: { xrMode: string } };
    selectPane(id: string): void;
  };
  __questScene: import('three').Scene;
  __questThree: typeof import('three');
  __questCamera: import('three').PerspectiveCamera;
  __questRenderer: {
    render(scene: import('three').Scene, camera: import('three').Camera): void;
    getContext(): WebGL2RenderingContext;
  };
  __designScene?: import('../src/xr/scene').WorkspaceScene;
  __designSurfaces?: Map<string, import('../src/contracts').TerminalSurface>;
  __radialSync?: (object: import('three').Object3D) => Promise<void>;
  __radialFactory?: (options: {
    variant: 'ring' | 'satellites';
    glass: boolean;
    onSelect?: (action: string) => void;
  }) => { root: import('three').Group; update(dt: number): void; dispose(): void };
  __warpRadialActions?: string[];
};

const frame = (message: unknown): Buffer =>
  Buffer.from([0, ...toBinary(ServerMessageSchema, message as never)]);
const tree = (): Buffer => {
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
          initialScreen: new TextEncoder().encode(
            Array.from(
              { length: 100 },
              (_, i) => `${id} monitor history ${String(i).padStart(3, '0')} • agent status ready`,
            ).join('\r\n') + '\r\n',
          ),
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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(message);
}
async function clickXR(page: Page): Promise<void> {
  await page.locator('[data-action="xr"]').click();
  await waitFor(
    page,
    async () =>
      await page.evaluate(
        () => (window as unknown as BrowserWindow).__muxXR.getState().scene.xrMode === 'vr',
      ),
    'XR did not start',
  );
}
async function injectRadialFactory(root: string): Promise<void> {
  const source = join(root, 'quest-main.ts');
  const radial = resolve('src/xr/radial-prototype.ts');
  const existing = await readFile(source, 'utf8');
  await writeFile(
    source,
    `${existing}\nimport { createRadialPrototype } from ${JSON.stringify(radial)};\nimport {waitForLabelSync} from ${JSON.stringify(resolve('src/xr/labels.ts'))};\nObject.assign(window, { __radialFactory: createRadialPrototype, __radialSync:waitForLabelSync, __designScene: scene, __designSurfaces: surfaces });\n`,
  );
  execFileSync('bun', ['build', source, '--target', 'browser', '--outdir', root], {
    stdio: 'inherit',
  });
}
async function addRadial(
  page: Page,
  variant: 'ring' | 'satellites',
  glass: boolean,
): Promise<void> {
  await page.evaluate(
    async ({ variant, glass }) => {
      const w = window as unknown as BrowserWindow;
      if (!w.__radialFactory) throw new Error('radial factory was not injected');
      const selected: string[] = [];
      const radial = w.__radialFactory({
        variant,
        glass,
        onSelect: (action) => selected.push(action),
      });
      radial.root.position.set(0, 1.48, -1.05);
      radial.root.scale.setScalar(0.8);
      radial.root.userData.radialCapture = { variant, glass };
      w.__questScene.add(radial.root);
      w.__warpRadialActions = selected;
      const waits: Promise<void>[] = [];
      radial.root.traverse((o) => {
        if (w.__radialSync) waits.push(w.__radialSync(o));
      });
      await Promise.all(waits);
      w.__questRenderer.render(w.__questScene, w.__questCamera);
    },
    { variant, glass },
  );
}
async function verifyRadialRaycast(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as BrowserWindow;
    const root = w.__questScene.getObjectByName('radial-prototype');
    if (!root) throw new Error('radial prototype root missing');
    const THREE = w.__questThree;
    const raycaster = new THREE.Raycaster();
    const camera = w.__questCamera;
    const targets: import('three').Object3D[] = [];
    root.traverse((object) => {
      if (typeof object.userData.radialAction === 'string') targets.push(object);
    });
    if (targets.length < 5) throw new Error('radial action metadata missing');
    for (const target of targets) {
      let label: import('three').Object3D | undefined;
      target.traverse((o) => {
        if (!label && typeof o.userData.labelText === 'string') label = o;
      });
      const point = (label ?? target).getWorldPosition(new THREE.Vector3());
      const projected = point.clone().project(camera);
      raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
      const hit = raycaster.intersectObjects([target], true)[0];
      if (!hit) throw new Error(`radial raycast missed ${target.userData.radialAction}`);
      let owner: import('three').Object3D | null = hit.object;
      while (owner && typeof owner.userData.onSelect !== 'function') owner = owner.parent;
      if (!owner) throw new Error(`radial callback missing ${target.userData.radialAction}`);
      owner.userData.onSelect();
    }
  });
}
async function verifyNativeWarpAndFiltering(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as BrowserWindow;
    const design = w.__designScene;
    if (!design) throw new Error('design scene handle missing');
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 3; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    design.setTerminalCurvature('%1', 60);
    if (design.getTerminalCurvature('%1') !== 60) throw new Error('curvature not applied');
    design.showInput('filtering');
    design.setTerminalFiltering({
      mode: 'nearest',
      anisotropy: 16,
      gazeClarity: true,
      gazeMaxDistance: 3,
    });
    let anisotropyButtons = 0;
    w.__questScene.getObjectByName('xr-filtering-controls')?.traverse((o) => {
      if (o.userData.inputAction === 'filterAnisotropy') anisotropyButtons++;
    });
    if (anisotropyButtons !== 0) throw new Error('irrelevant anisotropy controls remain visible');
    design.setTerminalFiltering({
      mode: 'mipmap-linear',
      anisotropy: 4,
      gazeClarity: true,
      gazeMaxDistance: 20,
    });
    const panel = w.__questScene.getObjectByName('terminal-panel-%1');
    const screen = panel?.getObjectByName('terminal-surface') as import('three').Mesh<
      import('three').BufferGeometry,
      import('three').MeshBasicMaterial
    >;
    if (!screen) throw new Error('screen missing');
    const position = screen.geometry.getAttribute('position');
    const normal = screen.geometry.getAttribute('normal');
    const uv = screen.geometry.getAttribute('uv');
    let bottom = 0,
      top = 0;
    for (let i = 0; i < uv.count; i++)
      if (Math.abs(uv.getX(i) - 0.25) < 1e-5) {
        if (uv.getY(i) === 0) bottom = i;
        else top = i;
      }
    const local = new w.__questThree.Vector3()
      .fromBufferAttribute(position, bottom)
      .add(new w.__questThree.Vector3().fromBufferAttribute(position, top))
      .multiplyScalar(0.5);
    const point = screen.localToWorld(local);
    const front = new w.__questThree.Vector3()
      .fromBufferAttribute(normal, bottom)
      .transformDirection(screen.matrixWorld);
    const ray = new w.__questThree.Raycaster(
      point.clone().addScaledVector(front, 0.3),
      front.clone().negate(),
    );
    const hit = ray.intersectObject(screen, false)[0];
    if (!hit?.uv || Math.abs(hit.uv.x - 0.25) > 1e-3 || Math.abs(hit.uv.y - 0.5) > 1e-3)
      throw new Error(`curved UV incorrect: ${JSON.stringify(hit?.uv)}`);
    design.hideInput();
    const camera = w.__questCamera;
    const originalQuaternion = camera.quaternion.clone();
    camera.lookAt(screen.getWorldPosition(new w.__questThree.Vector3()));
    await settle();
    if (screen.material.userData.terminalGazePriority.value !== 1)
      throw new Error('near-range gaze priority missing');
    const selected = design.state.selectedTerminalId;
    design.setTerminalFiltering({ ...design.state.filtering, gazeMaxDistance: 0.25 });
    await settle();
    if (screen.material.userData.terminalGazePriority.value !== 0)
      throw new Error('gaze priority exceeds distance');
    if (design.state.selectedTerminalId !== selected)
      throw new Error('render gaze changed input target');
    design.setTerminalFiltering({ ...design.state.filtering, gazeMaxDistance: 3 });
    camera.quaternion.copy(originalQuaternion);
    design.setNotice('Preview message');
    let dismiss: import('three').Object3D | undefined;
    w.__questScene.traverse((o) => {
      if (o.userData.inputAction === 'dismissNotice' && o.userData.labelText === '×') dismiss = o;
    });
    if (!dismiss) throw new Error('notice dismiss control missing');
    const controller = (window as unknown as { __questControllers: import('three').Group[] })
      .__questControllers[0];
    const rotation = dismiss.getWorldQuaternion(new w.__questThree.Quaternion());
    controller.position
      .copy(dismiss.getWorldPosition(new w.__questThree.Vector3()))
      .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
    controller.quaternion.copy(rotation);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
    if (design.state.notice !== null) throw new Error('notice did not dismiss');
  });
}

async function main(): Promise<void> {
  const root = resolve(testRoot as string);
  await mkdir(root, { recursive: true });
  prepareQuestFixture(root);
  await injectRadialFactory(root);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const protocolScroll: number[] = [];
  const paneRoutes = new Map<string, WebSocketRoute>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Troika|Failure loading font|Shader Error|GL_INVALID/i.test(message.text()))
      errors.push(message.text());
  });
  await page.routeWebSocket(/.*/, (ws: WebSocketRoute) => {
    const id = new URL(ws.url()).searchParams.get('session')?.replace(/^pane-/, '%') ?? 'metadata';
    ws.onMessage((raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
      if (bytes.length < 2) return;
      const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
      if (message.message.case === 'muxTreeRequest') ws.send(tree());
      if (
        message.message.case === 'mouse' &&
        (message.message.value.button === 64 || message.message.value.button === 65)
      )
        protocolScroll.push(message.message.value.button);
    });
    if (id !== 'metadata') {
      paneRoutes.set(id, ws);
      ws.send(connected(id));
      ws.send(output(`${id} observatory\r\n`));
    }
  });
  try {
    await page.goto(`${serverUrl}/__quest-controls.html?server=${encodeURIComponent(serverUrl)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await waitFor(
      page,
      async () =>
        (await page.evaluate(
          () => (window as unknown as BrowserWindow).__muxXR.getState().attached.length,
        )) >= 2,
      'terminals did not attach',
    );
    await page.evaluate(() => (window as unknown as BrowserWindow).__muxXR.selectPane('%1'));
    await clickXR(page);
    await verifyNativeWarpAndFiltering(page);
    const localScroll = await page.evaluate(async () => {
      const w = window as unknown as BrowserWindow;
      const typed = w as unknown as {
        __designSurfaces: Map<string, import('../src/contracts').TerminalSurface>;
        __questControllers: import('three').Group[];
      };
      const surface = typed.__designSurfaces.get('%1');
      if (!surface) throw new Error('surface missing');
      const pixels = (): number => {
        const bytes = surface.canvas
          .getContext('2d')
          ?.getImageData(0, 0, surface.canvas.width, surface.canvas.height).data;
        if (!bytes) return 0;
        let sum = 0;
        for (let i = 0; i < bytes.length; i += 4)
          sum = (sum + bytes[i] * (i + 1) + bytes[i + 1]) % 2147483647;
        return sum;
      };
      const pad = {
        axes: [0, 0, 0, -1],
        buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
      };
      const c = typed.__questControllers[0];
      const screen = w.__questScene
        .getObjectByName('terminal-panel-%1')
        ?.getObjectByName('terminal-surface');
      if (!screen) throw new Error('screen missing');
      c.dispatchEvent({ type: 'connected', data: { handedness: 'left', gamepad: pad } } as never);
      c.quaternion.copy(screen.getWorldQuaternion(new w.__questThree.Quaternion()));
      c.position
        .copy(screen.getWorldPosition(new w.__questThree.Vector3()))
        .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(c.quaternion));
      const before = pixels();
      await new Promise((resolve) => setTimeout(resolve, 300));
      pad.axes[3] = 0;
      const after = pixels();
      if (before === after)
        throw new Error('controller scrollback did not change actual terminal pixels');
      pad.buttons[1].pressed = true;
      pad.axes[3] = -1;
      const held = pixels();
      await new Promise((resolve) => setTimeout(resolve, 250));
      pad.axes[3] = 0;
      pad.buttons[1].pressed = false;
      if (pixels() !== held) throw new Error('grip allowed scroll input');
      Object.assign(window, { __nativeScrollPad: pad });
      return { before, after };
    });
    paneRoutes.get('%1')?.send(output('\x1b[?1000h\x1b[?1006h'));
    await page.waitForFunction(
      () =>
        ((
          window as unknown as {
            __designSurfaces: Map<string, import('../src/contracts').TerminalSurface>;
          }
        ).__designSurfaces.get('%1')?.mouseTracking ?? 'none') !== 'none',
    );
    await page.evaluate(() => {
      (window as unknown as { __nativeScrollPad: { axes: number[] } }).__nativeScrollPad.axes[3] =
        1;
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      (window as unknown as { __nativeScrollPad: { axes: number[] } }).__nativeScrollPad.axes[3] =
        0;
    });
    assert(protocolScroll.includes(65), 'native TUI wheel did not send raw SGR65');

    const renderer = await page.evaluate(() => {
      const gl = (window as unknown as BrowserWindow).__questRenderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    assert(
      renderer !== 'unknown' && !/swiftshader/i.test(renderer),
      `Native GPU required: ${renderer}`,
    );
    await addRadial(page, 'ring', false);
    await verifyRadialRaycast(page);
    await page.screenshot({ path: join(root, 'warp-radial-ring.png'), fullPage: false });
    await page.evaluate(() => {
      const w = window as unknown as BrowserWindow;
      const radial = w.__questScene.getObjectByName('radial-prototype');
      radial?.removeFromParent();
    });
    await addRadial(page, 'satellites', false);
    await page.screenshot({ path: join(root, 'warp-radial-satellites.png'), fullPage: false });
    await page.evaluate(() =>
      (window as unknown as BrowserWindow).__questScene
        .getObjectByName('radial-prototype')
        ?.removeFromParent(),
    );
    await addRadial(page, 'ring', true);
    await page.screenshot({ path: join(root, 'warp-radial-ring-glass.png'), fullPage: false });
    await page.evaluate(() => {
      const w = window as unknown as BrowserWindow;
      const screen = w.__questScene
        .getObjectByName('terminal-panel-%1')
        ?.getObjectByName('terminal-surface') as import('three').Mesh<
        import('three').BufferGeometry,
        import('three').MeshBasicMaterial
      >;
      const source = screen.material.map as import('three').DataTexture;
      if (!source.image.data) throw new Error('terminal pixel data missing');
      const bytes = new Uint8Array(source.image.data as Uint8Array);
      for (let i = 0; i < bytes.length; i += 4)
        bytes[i + 3] = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) < 55 ? 115 : 255;
      const texture = new w.__questThree.DataTexture(
        bytes,
        source.image.width,
        source.image.height,
      );
      texture.colorSpace = source.colorSpace;
      texture.minFilter = source.minFilter;
      texture.magFilter = source.magFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      screen.material.map = texture;
      screen.material.transparent = true;
      screen.material.depthWrite = false;
      screen.material.needsUpdate = true;
      const frame = screen.parent?.children.find(
        (o) => (o as import('three').Mesh).material instanceof w.__questThree.MeshStandardMaterial,
      ) as import('three').Mesh<
        import('three').BufferGeometry,
        import('three').MeshStandardMaterial
      >;
      if (frame) {
        frame.material.transparent = true;
        frame.material.opacity = 0.3;
        frame.material.depthWrite = false;
      }
    });
    await page.waitForTimeout(100);
    await page.screenshot({
      path: join(root, 'warp-radial-curved-glass-pane.png'),
      fullPage: false,
    });
    assert(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
    assert(
      protocolScroll.every((button) => button === 64 || button === 65),
      'invalid terminal wheel protocol value',
    );
    await writeFile(
      join(root, 'warp-radial-result.json'),
      JSON.stringify(
        {
          viewport: [1440, 1000],
          deviceScaleFactor: 1,
          renderer,
          localScroll,
          protocolScroll,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
