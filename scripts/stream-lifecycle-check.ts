import { mkdir } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import * as pako from 'pako';
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

const BASE_URL = process.env.MUX_XR_BASE_URL;
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';
const BASELINE = process.env.MUX_XR_BASELINE === '1' || process.argv.includes('--baseline');
const SKIP_LIFECYCLE = BASELINE || process.env.MUX_XR_SKIP_LIFECYCLE === '1';
const SCREENSHOT_DIR =
  process.env.MUX_XR_SCREENSHOT_DIR ?? join(process.cwd(), '.impeccable', 'review');
const LARGE_SEED = 3 * 1024 * 1024;
const PANES = ['%1', '%2', '%3', '%4'] as const;

type WireFrame = { paneId: string; kind: string; data?: string };
type HarnessState = {
  sockets: number;
  socketByPane: Map<string, number>;
  socketRoutes: Map<string, WebSocketRoute>;
  closed: string[];
  frames: WireFrame[];
  inputs: WireFrame[];
  errors: string[];
  outputPackets: number;
  outputBytes: number;
};
type BrowserMetrics = {
  continuousRaf: number[];
  paintCount: number;
  paintDurationMs: number;
  renderer: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function frame(message: ServerMessage, compress = false): Buffer {
  const payload = Buffer.from(toBinary(ServerMessageSchema, message));
  if (!compress) return Buffer.concat([Buffer.from([0]), payload]);
  return Buffer.concat([Buffer.from([1]), Buffer.from(pako.deflate(payload))]);
}

function snapshotFrame(): Buffer {
  const panes = PANES.map((id, index) =>
    create(MuxTreePaneSchema, {
      id,
      title: `Hierarchy pane ${index + 1}`,
      active: index === 0,
      cols: 149,
      rows: 54,
      x: (index % 2) * 75,
      y: Math.floor(index / 2) * 27,
    }),
  );
  const snapshot = create(MuxTreeSnapshotSchema, {
    workspaces: [
      create(MuxTreeWorkspaceSchema, {
        id: 'workspace-1',
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
                name: 'Hierarchy',
                active: true,
                layout: '149x54,0,0,0,0',
                panes,
              }),
            ],
          }),
        ],
      }),
    ],
  });
  return frame(
    create(ServerMessageSchema, { message: { case: 'muxTreeSnapshot', value: snapshot } }),
  );
}

function connectedFrame(paneId: string, largeSeed: boolean): Buffer {
  const prefix = `\x1b[2J\x1b[H${paneId} connected\r\n`;
  const row = `${paneId} ${'stream regression '.repeat(8)}\r\n`;
  const text = largeSeed ? prefix + row.repeat(Math.ceil(LARGE_SEED / row.length)) : prefix + row;
  const screen = new TextEncoder().encode(text.slice(0, largeSeed ? LARGE_SEED : undefined));
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, {
          cols: 149,
          rows: 54,
          sessionId: `pane-${paneId.slice(1)}`,
          initialScreen: screen,
        }),
      },
    }),
    largeSeed,
  );
}

function burstFrame(paneId: string, tick: number): Buffer {
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'output',
        value: create(OutputSchema, {
          data: new TextEncoder().encode(
            `\x1b[38;5;${(tick % 6) + 1}m${paneId} burst ${tick}\x1b[0m\r\n`,
          ),
        }),
      },
    }),
  );
}

function decodeClient(message: string | Buffer): WireFrame {
  const bytes = Buffer.isBuffer(message) ? message : Buffer.from(message, 'binary');
  const decoded = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
  const kind = decoded.message.case ?? 'unknown';
  if (decoded.message.case === 'input')
    return { paneId: '', kind, data: new TextDecoder().decode(decoded.message.value.data) };
  return { paneId: '', kind };
}

async function installFixture(page: Page, state: HarnessState): Promise<void> {
  await page.routeWebSocket('**/ws**', (ws: WebSocketRoute) => {
    state.sockets += 1;
    const session = new URL(ws.url()).searchParams.get('session');
    const paneId = session?.replace(/^pane-/, '%') ?? 'metadata';
    state.socketByPane.set(paneId, (state.socketByPane.get(paneId) ?? 0) + 1);
    state.socketRoutes.set(paneId, ws);
    ws.onClose(() => state.closed.push(paneId));
    ws.onMessage((message) => {
      const decoded = decodeClient(message);
      decoded.paneId = paneId;
      state.frames.push(decoded);
      if (decoded.kind === 'input') state.inputs.push(decoded);
      if (decoded.kind === 'muxTreeRequest') ws.send(snapshotFrame());
    });
    if (session) ws.send(connectedFrame(paneId, !SKIP_LIFECYCLE && paneId === '%4'));
  });
}

async function waitFor(
  _page: Page,
  predicate: () => Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function metrics(page: Page): Promise<BrowserMetrics> {
  return page.evaluate(() => {
    const value = (window as unknown as { __muxXRMetrics: BrowserMetrics }).__muxXRMetrics;
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Mux XR workspace"]',
    );
    let renderer = 'unknown';
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'WebGL';
    }
    return { ...value, renderer };
  });
}

async function main(): Promise<void> {
  assert(BASE_URL, 'MUX_XR_BASE_URL is required');
  assert(PRIVATE_TEST, 'MUX_XR_PRIVATE_TEST=1 is required');
  const parsed = new URL(BASE_URL);
  assert(
    ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname),
    'MUX_XR_BASE_URL must be loopback',
  );
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const state: HarnessState = {
    sockets: 0,
    socketByPane: new Map(),
    socketRoutes: new Map(),
    closed: [],
    frames: [],
    inputs: [],
    errors: [],
    outputPackets: 0,
    outputBytes: 0,
  };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.addInitScript(() => {
    const target = window as unknown as { __muxXRMetrics: BrowserMetrics };
    target.__muxXRMetrics = {
      continuousRaf: [],
      paintCount: 0,
      paintDurationMs: 0,
      renderer: 'unknown',
    };
    let last = performance.now();
    let measuring = false;
    const continuous = (time: number) => {
      if (measuring) {
        target.__muxXRMetrics.continuousRaf.push(time - last);
        last = time;
      }
      window.requestAnimationFrame(continuous);
    };
    window.requestAnimationFrame(continuous);
    const paintStarts = new WeakMap<CanvasRenderingContext2D, number>();
    const transform = CanvasRenderingContext2D.prototype.setTransform;
    CanvasRenderingContext2D.prototype.setTransform = function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ): void {
      if (measuring && this.canvas?.getAttribute('aria-label')?.endsWith('terminal output')) {
        target.__muxXRMetrics.paintCount += 1;
        paintStarts.set(this, performance.now());
      }
      Reflect.apply(transform, this, args);
    };
    const stroke = CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect = function (
      ...args: Parameters<typeof stroke>
    ): void {
      stroke.apply(this, args);
      const start = paintStarts.get(this);
      if (measuring && start !== undefined) {
        target.__muxXRMetrics.paintDurationMs += performance.now() - start;
        paintStarts.delete(this);
      }
    };
    Object.assign(window, {
      __muxXRStartMetrics: () => {
        measuring = true;
        target.__muxXRMetrics.continuousRaf = [];
        target.__muxXRMetrics.paintCount = 0;
        target.__muxXRMetrics.paintDurationMs = 0;
        last = performance.now();
      },
      __muxXREndMetrics: () => {
        measuring = false;
      },
    });
  });
  await installFixture(page, state);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#endpoint').fill(`${BASE_URL}/stream`);
    await page.locator('[data-action="connect"]').click();
    await waitFor(
      page,
      async () => (await page.locator('[data-pane]').count()) === 4,
      'hierarchy did not expose four panes',
    );
    await waitFor(
      page,
      async () => {
        const attached = await page.evaluate(
          () =>
            (
              window as unknown as { __muxXR: { getState: () => { attached: string[] } } }
            ).__muxXR.getState().attached,
        );
        return attached.length === 2;
      },
      'autoattach did not attach two panes',
    );
    await page.locator('[data-pane="%3"]').click();
    await page.locator('[data-pane="%4"]').click();
    await waitFor(
      page,
      async () => {
        const streams = await page.evaluate(
          () =>
            (
              window as unknown as {
                __muxXR: { getState: () => { streams: Array<{ status: string }> } };
              }
            ).__muxXR.getState().streams,
        );
        return streams.length === 4 && streams.every((stream) => stream.status === 'connected');
      },
      'four streams did not connect',
    );
    if (!SKIP_LIFECYCLE) {
      const before = await page.evaluate(() =>
        (
          window as unknown as {
            __muxXR: {
              getState: () => {
                panels: Array<{ id: string; position: number[]; quaternion: number[] }>;
              };
            };
          }
        ).__muxXR
          .getState()
          .panels.find((panel) => panel.id === '%4'),
      );
      const inputBefore = state.inputs.length;
      await page.locator('[data-toggle-connection="%4"]').click();
      await waitFor(
        page,
        async () =>
          (await page.locator('[data-toggle-connection="%4"]').textContent()) === 'Reconnect',
        'manual disconnect did not pause',
      );
      await new Promise((resolve) => setTimeout(resolve, 6000));
      assert((state.socketByPane.get('%4') ?? 0) === 1, 'paused stream opened a retry socket');
      await page.locator('[data-action="keyboard"]').click();
      await page.locator('[data-key="a"]').click();
      assert(state.inputs.length === inputBefore, 'disconnected input was sent');
      await page.locator('[data-toggle-connection="%4"]').click();
      await waitFor(
        page,
        async () =>
          (await page.locator('[data-toggle-connection="%4"]').textContent()) === 'Disconnect',
        'reconnect did not complete',
      );
      assert(state.inputs.length === inputBefore, 'reconnect replayed input');
      const after = await page.evaluate(() =>
        (
          window as unknown as {
            __muxXR: {
              getState: () => {
                panels: Array<{ id: string; position: number[]; quaternion: number[] }>;
              };
            };
          }
        ).__muxXR
          .getState()
          .panels.find((panel) => panel.id === '%4'),
      );
      assert(JSON.stringify(before) === JSON.stringify(after), 'disconnect changed panel pose');
      await page.locator('[data-close="%4"]').click();
      await waitFor(
        page,
        async () => !(await page.locator('[data-select="%4"]').count()),
        'closing view did not remove pane',
      );
      assert(
        (await page.locator('[data-pane="%4"]').count()) === 1,
        'closed pane disappeared from metadata',
      );
      await page.locator('[data-pane="%4"]').click();
      await waitFor(
        page,
        async () => (await page.locator('[data-select="%4"]').count()) === 1,
        'closed pane did not reopen',
      );
    }
    await page.locator('[data-action="desktop-preview"]').click();
    await page.waitForTimeout(500);
    await page.evaluate(() =>
      (window as unknown as { __muxXRStartMetrics: () => void }).__muxXRStartMetrics(),
    );
    const startLoad = loadavg();
    assert(startLoad[0] <= 15, `pre-run load average exceeded 15: ${startLoad[0]}`);
    let tick = 0;
    for (let burst = 0; burst < 160; burst += 1) {
      for (const paneId of PANES)
        for (let packet = 0; packet < 10; packet += 1) {
          const payload = burstFrame(paneId, tick++);
          state.socketRoutes.get(paneId)?.send(payload);
          state.outputPackets += 1;
          state.outputBytes += payload.byteLength;
        }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await page.evaluate(() =>
      (window as unknown as { __muxXREndMetrics: () => void }).__muxXREndMetrics(),
    );
    await page.screenshot({
      path: join(SCREENSHOT_DIR, `${BASELINE ? 'baseline' : 'candidate'}-streams.png`),
      fullPage: true,
    });
    const browserMetrics = await metrics(page);
    const raf = browserMetrics.continuousRaf.slice().sort((a, b) => a - b);
    assert(state.errors.length === 0, `page errors: ${state.errors.join('; ')}`);
    assert(
      browserMetrics.renderer !== 'unknown' && browserMetrics.renderer !== 'WebGL',
      `GPU renderer was not confirmed: ${browserMetrics.renderer}`,
    );
    assert(
      !/swiftshader/i.test(browserMetrics.renderer),
      `GPU renderer is SwiftShader: ${browserMetrics.renderer}`,
    );
    const endLoad = loadavg();
    assert(endLoad[0] <= 15, `post-run load average exceeded 15: ${endLoad[0]}`);
    console.log(
      JSON.stringify({
        mode: BASELINE ? 'baseline' : SKIP_LIFECYCLE ? 'perf-only' : 'candidate',
        inputFrameCount: state.inputs.length,
        outputPacketCount: state.outputPackets,
        outputBytes: state.outputBytes,
        streams: Object.fromEntries(state.socketByPane),
        metrics: {
          renderer: browserMetrics.renderer,
          rafP50Ms: raf[Math.floor(raf.length * 0.5)] ?? 0,
          rafP95Ms: raf[Math.floor(raf.length * 0.95)] ?? 0,
          rafMaxMs: Math.max(...raf, 0),
          paintCount: browserMetrics.paintCount,
          paintDurationMs: browserMetrics.paintDurationMs,
        },
        pageErrors: state.errors,
        osLoadAvg: { start: startLoad, end: endLoad },
      }),
    );
  } finally {
    await browser.close();
  }
}

await main();
