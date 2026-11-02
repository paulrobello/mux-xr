import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { type Browser, chromium, type Page, type WebSocketRoute } from 'playwright';
import {
  ClientMessageSchema,
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

type Viewport = { name: string; width: number; height: number };
type Frame = { paneId: string; case: string; data?: string; cols?: number; rows?: number };
type FixtureState = { frames: Frame[]; closed: string[]; sockets: number };

const BASE_URL = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4240';
const REVIEW_DIR = join(process.cwd(), '.impeccable', 'review');
const viewports: readonly Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function serverFrame(message: ServerMessage): Buffer {
  return Buffer.from([0, ...toBinary(ServerMessageSchema, message)]);
}

function snapshotFrame(): Buffer {
  const pane = (id: string, title: string) =>
    create(MuxTreePaneSchema, {
      id,
      title,
      active: id === '%1',
      cols: 80,
      rows: 24,
      x: id === '%1' ? 0 : 40,
      y: 0,
    });
  const snapshot = create(MuxTreeSnapshotSchema, {
    workspaces: [
      create(MuxTreeWorkspaceSchema, {
        id: 'main',
        name: 'Main workspace',
        active: true,
        sessions: [
          create(MuxTreeSessionSchema, {
            id: '$1',
            name: 'Development',
            active: true,
            windows: [
              create(MuxTreeWindowSchema, {
                id: '@1',
                name: 'Build',
                active: true,
                layout: '80x24,0,0,1,2',
                panes: [pane('%1', 'Build monitor')],
              }),
            ],
          }),
        ],
      }),
      create(MuxTreeWorkspaceSchema, {
        id: 'ops',
        name: 'Operations',
        active: false,
        sessions: [
          create(MuxTreeSessionSchema, {
            id: '$2',
            name: 'Observability',
            active: true,
            windows: [
              create(MuxTreeWindowSchema, {
                id: '@2',
                name: 'Agent logs',
                active: true,
                layout: '80x24,0,0,2,3',
                panes: [pane('%2', 'Agent activity')],
              }),
            ],
          }),
        ],
      }),
    ],
  });
  return serverFrame(
    create(ServerMessageSchema, {
      message: { case: 'muxTreeSnapshot', value: snapshot },
    }),
  );
}

function connectedFrame(paneId: string): Buffer {
  const screen = new TextEncoder().encode(
    `\x1b[2J\x1b[H${paneId} connected\r\nfixture stream ready`,
  );
  return serverFrame(
    create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, {
          cols: 80,
          rows: 24,
          sessionId: `pane-${paneId.slice(1)}`,
          initialScreen: screen,
        }),
      },
    }),
  );
}

function outputFrame(text: string): Buffer {
  return serverFrame(
    create(ServerMessageSchema, {
      message: {
        case: 'output',
        value: create(OutputSchema, { data: new TextEncoder().encode(text) }),
      },
    }),
  );
}

function decodeClientMessage(message: string | Buffer): {
  case: string;
  data?: string;
  cols?: number;
  rows?: number;
} {
  const bytes = Buffer.isBuffer(message) ? message : Buffer.from(message, 'binary');
  assert(bytes.length > 1, 'fixture received an empty client frame');
  const decoded = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
  if (decoded.message.case === 'input')
    return {
      case: decoded.message.case,
      data: new TextDecoder().decode(decoded.message.value.data),
    };
  if (decoded.message.case === 'resize')
    return {
      case: decoded.message.case,
      cols: decoded.message.value.cols,
      rows: decoded.message.value.rows,
    };
  assert(decoded.message.case !== undefined, 'fixture received an empty client message');
  return { case: decoded.message.case };
}

async function installFixture(page: Page, state: FixtureState): Promise<void> {
  await page.routeWebSocket('**/ws**', (ws: WebSocketRoute) => {
    state.sockets += 1;
    const url = new URL(ws.url());
    const session = url.searchParams.get('session');
    const paneId = session?.replace('pane-', '%') ?? 'hierarchy';
    ws.onClose(() => {
      if (session) state.closed.push(paneId);
    });
    ws.onMessage((message) => {
      const decoded = decodeClientMessage(message);
      state.frames.push({ paneId, ...decoded });
      if (decoded.case === 'muxTreeRequest') ws.send(snapshotFrame());
      if (decoded.case === 'resize' && decoded.cols && decoded.rows)
        ws.send(
          serverFrame(
            create(ServerMessageSchema, {
              message: {
                case: 'resize',
                value: create(ResizeSchema, { cols: decoded.cols, rows: decoded.rows }),
              },
            }),
          ),
        );
    });
    if (session) {
      ws.send(connectedFrame(paneId));
      ws.send(outputFrame(`${paneId} output frame\r\n`));
    }
  });
}

async function observedInputFrames(
  page: Page,
  state: FixtureState,
  paneId: string,
  start: number,
  lastInput: string,
): Promise<Frame[]> {
  const wait = async (ready: () => boolean, detail: string): Promise<void> => {
    const deadline = Date.now() + 5000;
    while (!ready() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert(ready(), detail);
  };
  await wait(
    () =>
      state.frames
        .slice(start)
        .some((frame) => frame.paneId === paneId && frame.data === lastInput),
    `Input did not reach ${paneId}: ${lastInput}`,
  );
  const boundary = state.frames.length;
  const selected = await page.evaluate(
    () =>
      (window as unknown as { __muxXR: { getState(): { selectedId: string } } }).__muxXR.getState()
        .selectedId,
  );
  const select = selected === paneId ? (paneId === '%1' ? '%2' : '%1') : paneId;
  await page.locator(`[data-pane="${select}"]`).click();
  // A later focus message on the same socket orders all preceding input frames.
  await wait(
    () =>
      state.frames
        .slice(boundary)
        .some((frame) => frame.paneId === paneId && frame.case === 'focus'),
    'Input ordering boundary did not arrive',
  );
  if (selected !== select) await page.locator(`[data-pane="${selected}"]`).click();
  return state.frames.slice(start);
}

async function waitForText(page: Page, selector: string, pattern: RegExp): Promise<void> {
  await page.waitForFunction(
    ({ selector, source, flags }) => {
      const text = document.querySelector(selector)?.textContent ?? '';
      return new RegExp(source, flags).test(text);
    },
    { selector, source: pattern.source, flags: pattern.flags },
  );
}

async function runViewport(browser: Browser, viewport: Viewport): Promise<Record<string, unknown>> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.name === 'desktop' ? 2 : 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) =>
    console.error(
      'Browser request failed:',
      request.url().slice(0, 200),
      request.failure()?.errorText,
    ),
  );
  const state: FixtureState = { frames: [], closed: [], sockets: 0 };
  await installFixture(page, state);
  const execute = async (): Promise<Record<string, unknown>> => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForFunction(
      () => Boolean((window as unknown as { __muxXR?: unknown }).__muxXR),
      undefined,
      { timeout: 15000 },
    );
    assert(
      (await page.locator('#endpoint').inputValue()) === new URL(BASE_URL).origin,
      'endpoint was not prefilled from serving origin',
    );
    await page.locator('[data-pane="%1"]').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('[data-pane="%2"]').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const attached = (
          window as unknown as { __muxXR: { getState(): { attached: string[] } } }
        ).__muxXR.getState().attached;
        return attached.includes('%1') && attached.includes('%2');
      },
      undefined,
      { timeout: 10000 },
    );
    await page.locator('#endpoint').fill(`${BASE_URL}/stream`);
    await page.locator('[data-action="connect"]').click();
    await page.locator('[data-pane="%1"]').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('[data-pane="%2"]').waitFor({ state: 'visible', timeout: 10_000 });
    await waitForText(page, '[data-detail]', /Select a connected pane|Input target/);

    await page.locator('[data-pane="%1"]').click();
    await page.locator('[data-pane="%2"]').click();
    assert((await page.locator('[data-select="%1"]').count()) === 1, 'pane A was not attached');
    assert((await page.locator('[data-select="%2"]').count()) === 1, 'pane B was not attached');
    assert(
      !(await page.locator('canvas[aria-label="Mux XR workspace"]').isVisible()),
      'desktop still shows the angled XR canvas by default',
    );
    await page.locator('[data-action="desktop-preview"]').click();
    const sceneCanvas = page.locator('canvas[aria-label="Mux XR workspace"]');
    await sceneCanvas.waitFor({ state: 'visible', timeout: 5_000 });
    type Hint = {
      key?: string;
      terminalId?: string;
      inputAction?: string;
      label: string;
      help: string;
      clientX: number;
      clientY: number;
    };
    const hints = await page.evaluate(() =>
      (window as unknown as { __muxXR: { getControlHints(): Hint[] } }).__muxXR.getControlHints(),
    );
    const stripEnter = hints.find(
      (hint) => hint.key === 'Enter' && hint.terminalId === '%1' && !hint.inputAction,
    );
    assert(stripEnter, 'terminal Enter strip target missing');
    await page.mouse.move(stripEnter.clientX, stripEnter.clientY);
    assert(
      (await sceneCanvas.getAttribute('title'))?.includes('Send Enter'),
      'spatial hover explanation missing',
    );
    const stripStart = state.frames.length;
    await page.mouse.click(stripEnter.clientX, stripEnter.clientY);
    await observedInputFrames(page, state, '%1', stripStart, '\r');
    const currentHints = async (): Promise<Hint[]> =>
      page.evaluate(() =>
        (window as unknown as { __muxXR: { getControlHints(): Hint[] } }).__muxXR.getControlHints(),
      );
    assert(
      !(await currentHints()).some(
        (hint) => hint.inputAction === 'openInput' && hint.label === 'Keyboard',
      ),
      'Keyboard remains on the native HUD',
    );
    await page.locator('[data-action="widgets"]').click();
    assert(
      (await currentHints()).filter((hint) => hint.inputAction === 'toggleWidget').length === 2,
      'Desktop Widgets did not open native clock choices',
    );
    const closeWidgets = (await currentHints()).find((hint) => hint.inputAction === 'close');
    assert(closeWidgets, 'Widgets close target missing');
    await page.mouse.click(closeWidgets.clientX, closeWidgets.clientY);
    await page.locator('[data-action="keyboard"]').click();
    assert(
      await page.locator('[data-keyboard]').isVisible(),
      'Browser shortcut did not open the compact keyboard',
    );
    assert(
      !(await currentHints()).some((hint) => hint.inputAction === 'key'),
      'HUD opened a duplicate spatial keyboard in the browser',
    );
    await page.screenshot({
      path: join(REVIEW_DIR, `${viewport.name}-single-keyboard.png`),
      fullPage: true,
    });
    await page.locator('[data-action="close-drawer"]').click();
    const commandsHud = (await currentHints()).find(
      (hint) => hint.inputAction === 'openInput' && hint.label === 'Commands',
    );
    assert(commandsHud, 'Commands HUD target missing');
    await page.mouse.click(commandsHud.clientX, commandsHud.clientY);
    assert(await page.locator('[data-command-label]').isVisible(), 'HUD Commands editor missing');
    assert(!(await page.locator('[data-keyboard]').isVisible()), 'HUD Commands shows keyboard');
    await page.locator('[data-action="close-drawer"]').click();
    for (let step = 0; step < 25; step += 1)
      await page.locator('[data-action="desktop-scale-up"]').click();
    const recovery = page.locator('[data-action="desktop-scale-down"]');
    const recoveryBounds = await recovery.boundingBox();
    assert(
      recoveryBounds &&
        recoveryBounds.x >= 0 &&
        recoveryBounds.x + recoveryBounds.width <= viewport.width &&
        recoveryBounds.y >= 0 &&
        recoveryBounds.y + recoveryBounds.height <= viewport.height,
      'recovery control left the viewport',
    );
    assert(
      !(await currentHints()).some(
        (hint) =>
          hint.inputAction === 'scale' ||
          hint.inputAction === 'inputScale' ||
          hint.inputAction === 'selectedScale',
      ),
      'spatial transform buttons remain in the scene',
    );
    await page.screenshot({
      path: join(REVIEW_DIR, `${viewport.name}-bounded-panel.png`),
      fullPage: true,
    });
    await recovery.click();
    await page.locator('[data-action="desktop-reset-layout"]').click();
    const backgroundSelect = (await currentHints()).find(
      (hint) => hint.inputAction === 'backgroundSelect',
    );
    assert(backgroundSelect, 'background selector missing');
    await page.mouse.click(backgroundSelect.clientX, backgroundSelect.clientY);
    const black = (await currentHints()).find(
      (hint) => hint.inputAction === 'background' && hint.label === 'Black',
    );
    assert(black, 'background HUD target missing');
    await page.mouse.click(black.clientX, black.clientY);
    const exit = (await currentHints()).find((hint) => hint.inputAction === 'exit');
    assert(exit, 'Exit HUD target missing');

    await page.waitForFunction(
      () => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[aria-label="Mux XR workspace"]',
        );
        return Boolean(
          canvas?.width &&
            canvas.height &&
            (canvas.getContext('webgl2') ?? canvas.getContext('webgl')),
        );
      },
      undefined,
      { timeout: 5_000 },
    );
    assert(
      await sceneCanvas.evaluate(
        (element) =>
          new Promise<boolean>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No render frame arrived')), 5000);
            // The default WebGL drawing buffer is discarded after presentation.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(timer);
                const canvas = element as HTMLCanvasElement;
                const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
                if (!gl) {
                  resolve(false);
                  return;
                }
                const pixels = new Uint8Array(canvas.width * canvas.height * 4);
                gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                let meaningful = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                  if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0)
                    meaningful += 1;
                }
                resolve(gl.getError() === gl.NO_ERROR && meaningful > 100);
              }),
            );
          }),
      ),
      'rendered WebGL canvas was blank',
    );
    await page.locator('[data-action="desktop-preview"]').click();
    assert(
      !(await sceneCanvas.isVisible()),
      '3D preview did not hide after returning to terminals',
    );
    await page.locator('.desktop-terminal-panel canvas').first().waitFor({ state: 'visible' });
    const dimensions = await page
      .locator('.desktop-terminal-panel canvas')
      .first()
      .evaluate((canvas: HTMLCanvasElement) => ({
        pixels: canvas.width,
        logical: canvas.getBoundingClientRect().width,
        density: devicePixelRatio,
      }));
    assert(
      Math.abs(dimensions.pixels / dimensions.logical - Math.min(2, dimensions.density)) < 0.01,
      'desktop canvas is being scaled away from its logical resolution',
    );

    await page.locator('[data-pane="%1"]').click();
    await page.locator('[data-action="commands"]').click();
    await page.locator('[data-action="close-drawer"]').click();
    await page.screenshot({
      path: join(REVIEW_DIR, `${viewport.name}-overview.png`),
      fullPage: true,
    });
    await page.locator('[data-action="commands"]').click();
    assert(
      !(await page.locator('[data-keyboard]').isVisible()),
      'Commands still shows the keyboard',
    );
    assert(await page.locator('[data-command-label]').isVisible(), 'Commands editor missing');
    await page.locator('[data-command-label]').fill('Global status');
    await page.locator('[data-command-text]').fill('printf global');
    await page.locator('[data-action="save-command"]').click();
    await page.locator('[data-command-scope]').selectOption('workspace');
    await page.locator('[data-command-label]').fill('Workspace status');
    await page.locator('[data-command-text]').fill('printf workspace');
    await page.locator('[data-command-newline]').uncheck();
    await page.locator('[data-action="save-command"]').click();
    const options = await page.locator('[data-command-select] option').allTextContents();
    assert(
      options.some((text) => text.includes('Workspace status')),
      'workspace command was not persisted',
    );
    await page.locator('[data-command-select]').selectOption({ label: 'Workspace status' });
    const workspaceStart = state.frames.length;
    await page.locator('[data-action="run-command"]').click();
    const workspaceFrames = await observedInputFrames(
      page,
      state,
      '%1',
      workspaceStart,
      'printf workspace',
    );
    const workspaceFrame = workspaceFrames.find((frame) => frame.data === 'printf workspace');
    assert(workspaceFrame?.paneId === '%1', 'workspace command did not target pane A');
    assert(
      !workspaceFrames.some((frame) => frame.data === '\r'),
      'optional-Enter false command unexpectedly emitted Enter',
    );
    await page.locator('[data-command-scope]').selectOption('global');
    await page.locator('[data-command-select]').selectOption({ label: 'Global status' });
    const globalStart = state.frames.length;
    await page.locator('[data-action="run-command"]').click();
    const globalFrames = await observedInputFrames(page, state, '%1', globalStart, 'printf global');
    assert(
      globalFrames.some((frame) => frame.data === 'printf global') &&
        globalFrames.some((frame) => frame.data === '\r'),
      'global command did not emit text and optional Enter',
    );

    await page.locator('[data-action="close-drawer"]').click();
    await page.locator('[data-pane="%1"]').click();
    await page.locator('[data-action="keyboard"]').click();
    await page.locator('[data-pane="%2"]').click();
    await page.locator('[data-compose]').fill('printf captured');
    const capturedStart = state.frames.length;
    await page.locator('[data-action="send-text"]').click();
    await page.locator('[data-action="close-drawer"]').click();
    const captured = (
      await observedInputFrames(page, state, '%2', capturedStart, 'printf captured')
    ).find((frame) => frame.data === 'printf captured');
    assert(
      captured?.paneId === '%2',
      `explicit selection of B did not retarget input: ${captured?.paneId ?? 'missing'}`,
    );

    await page.locator('[data-pane="%1"]').click();
    await page.locator('[data-action="keyboard"]').click();
    assert(
      !(await page.locator('[data-command-label]').isVisible()),
      'Keyboard still shows command editor',
    );
    assert(await page.locator('[data-keyboard]').isVisible(), 'Keyboard view missing');
    const keyboardStart = state.frames.length;
    assert(
      (await page.locator('[data-key="a"]').textContent()) === 'a',
      'base keycap was not lowercase',
    );
    await page.locator('[data-key="a"]').click();
    await page.locator('[data-modifier="shift"]').first().click();
    assert(
      (await page.locator('[data-key="4"]').textContent()) === '$',
      'Shift keycap did not expose dollar',
    );
    await page.locator('[data-key="4"]').click();
    assert(
      (await page.locator('[data-key="4"]').textContent()) === '4',
      'one-shot Shift did not restore keycap',
    );
    await page.locator('[data-modifier="shift"]').first().click();
    await page.locator('[data-key="c"]').click();
    await page.locator('[data-modifier="ctrl"]').first().click();
    await page.locator('[data-key="c"]').click();
    const keyboardBytes = (await observedInputFrames(page, state, '%1', keyboardStart, '\x03'))
      .filter((frame) => frame.paneId === '%1' && frame.case === 'input')
      .map((frame) => frame.data ?? '');
    assert(
      keyboardBytes.includes('a') &&
        keyboardBytes.includes('$') &&
        keyboardBytes.includes('C') &&
        keyboardBytes.includes('\x03'),
      'virtual keyboard did not emit lowercase, shift, and Ctrl-C bytes',
    );
    await page.screenshot({
      path: join(REVIEW_DIR, `${viewport.name}-keyboard.png`),
      fullPage: true,
    });
    await page.locator('[data-action="close-drawer"]').click();

    await page.locator('[data-pane="%2"]').click();
    await page.locator('[data-close="%2"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-select="%2"]'));
    const closeDeadline = Date.now() + 2_000;
    while (!state.closed.includes('%2') && Date.now() < closeDeadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert(state.closed.includes('%2'), 'detaching pane B did not close its viewer socket');

    await page.locator('[data-action="settings"]').click();
    await page.locator('[data-color-mode]').selectOption('monochrome');
    await page.locator('[data-keyboard-background]').uncheck();
    assert(
      await page.evaluate(() => {
        const state = (
          window as unknown as {
            __muxXR: {
              getState(): {
                scene: { terminalColorMode: string; keyboardBackgroundEnabled: boolean };
              };
            };
          }
        ).__muxXR.getState();
        return (
          state.scene.terminalColorMode === 'monochrome' && !state.scene.keyboardBackgroundEnabled
        );
      }),
      'color or keyboard background setting did not reach scene',
    );
    await page.locator('[data-grid-cols]').fill('120');
    await page.locator('[data-grid-rows]').fill('36');
    const resizeStart = state.frames.filter((frame) => frame.case === 'resize').length;
    await page.locator('[data-action="apply-grid"]').click();
    let deadline = Date.now() + 5000;
    while (
      state.frames.filter((frame) => frame.case === 'resize').length <= resizeStart &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert(
      state.frames.filter((frame) => frame.case === 'resize').length > resizeStart,
      'resize request did not reach fixture',
    );
    await waitForText(page, '[data-grid-caption]', /120 × 36/);
    assert(
      state.frames.filter((frame) => frame.case === 'resize').length === resizeStart + 1,
      'unexpected resize count after explicit request',
    );
    await page.locator('[data-grid-cols]').fill('80');
    await page.locator('[data-grid-rows]').fill('24');
    await page.locator('[data-action="apply-grid"]').click();
    deadline = Date.now() + 5000;
    while (
      state.frames.filter((frame) => frame.case === 'resize').length <= resizeStart + 1 &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert(
      state.frames.filter((frame) => frame.case === 'resize').length > resizeStart + 1,
      'restore resize request did not reach fixture',
    );
    await waitForText(page, '[data-grid-caption]', /80 × 24/);
    assert(
      state.frames.filter((frame) => frame.case === 'resize').length === resizeStart + 2,
      'restore emitted unexpected resize messages',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean((window as unknown as { __muxXR?: unknown }).__muxXR),
      undefined,
      { timeout: 15000 },
    );
    await page.locator('[data-action="settings"]').click();
    assert(
      (await page.locator('[data-color-mode]').inputValue()) === 'monochrome',
      'color mode did not persist',
    );
    assert(
      !(await page.locator('[data-keyboard-background]').isChecked()),
      'keyboard background did not persist',
    );
    await page.locator('[data-background]').selectOption('black');
    assert(
      (await page.locator('[data-gaze]').count()) === 0,
      'independent gaze emphasis control should be absent',
    );
    assert(
      !(await page.locator('[data-gaze-input]').isChecked()),
      'gaze keyboard input must default off',
    );
    await page.locator('[data-gaze-input]').check();
    assert(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __muxXR: { getState(): { scene: { gazeInputEnabled: boolean } } };
            }
          ).__muxXR.getState().scene.gazeInputEnabled,
      ),
      'gaze input setting did not reach the scene',
    );
    assert(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('mux-xr:settings:v1') ?? '{}').gazeInput === true,
      ),
      'gaze input setting was not persisted',
    );
    await page.locator('[data-gaze-input]').uncheck();
    assert(
      !(await page.evaluate(
        () =>
          (
            window as unknown as {
              __muxXR: { getState(): { scene: { gazeInputEnabled: boolean } } };
            }
          ).__muxXR.getState().scene.gazeInputEnabled,
      )),
      'gaze input did not disable',
    );
    assert(
      (await page.locator('[data-background]').inputValue()) === 'black',
      'background setting did not apply',
    );
    assert(
      (await page.locator('[data-gaze]').count()) === 0,
      'independent gaze emphasis control should be absent',
    );
    await page.screenshot({
      path: join(REVIEW_DIR, `${viewport.name}-settings.png`),
      fullPage: true,
    });
    await page.locator('[data-action="close-settings"]').click();

    await page.locator('#endpoint').fill('ftp://not-an-endpoint');
    await page.locator('[data-action="connect"]').click();
    await waitForText(page, '.status-copy', /HTTP|WebSocket|endpoint/i);
    assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="Mux XR workspace"]',
      );
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
    assert(
      renderer !== 'unavailable' && !String(renderer).toLowerCase().includes('swiftshader'),
      `GPU renderer unavailable: ${renderer}`,
    );
    const result = {
      kind: 'fixture-browser',
      build: 'mux-xr',
      host: process.platform,
      viewport,
      renderer,
      sockets: state.sockets,
      frames: state.frames.length,
      errors,
    };
    await context.close();
    return result;
  };
  try {
    return await execute();
  } catch (error) {
    await page
      .screenshot({ path: join(REVIEW_DIR, `${viewport.name}-failure.png`), fullPage: true })
      .catch(() => undefined);
    await writeFile(
      join(REVIEW_DIR, `${viewport.name}-failure.json`),
      JSON.stringify(
        {
          viewport,
          state,
          errors,
          appState: await page
            .evaluate(() =>
              (
                window as unknown as { __muxXR?: { getState?: () => unknown } }
              ).__muxXR?.getState?.(),
            )
            .catch(() => null),
        },
        null,
        2,
      ),
    );
    await context.close();
    throw error;
  }
}

async function main(): Promise<void> {
  await mkdir(REVIEW_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const results = [];
    for (const viewport of viewports) results.push(await runViewport(browser, viewport));
    console.log(
      JSON.stringify({ kind: 'fixture-browser-suite', baseUrl: BASE_URL, results }, null, 2),
    );
  } finally {
    await browser.close();
  }
}

await main();
