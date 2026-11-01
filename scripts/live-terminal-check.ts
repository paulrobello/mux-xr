import { loadavg } from 'node:os';
import { fromBinary } from '@bufbuild/protobuf';
import { chromium } from 'playwright';
import { decodeServerMessage } from '../src/terminal/protocol';
import { ClientMessageSchema } from '../src/terminal/vendor/terminal_pb';

type LiveResult = {
  kind: 'live-adapter-diagnostic';
  build: 'mux-xr';
  host: string;
  renderer: string;
  panes: string[];
  markers: string[];
  outputMarkersSeen: Record<string, boolean>;
  beforeRevision: number[];
  afterRevision: number[];
  disposedInputAccepted: boolean[];
  beforeLoad: number;
  afterLoad: number;
};

const BASE_URL = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4240';
const STREAMER = process.env.MUX_XR_STREAMER;
const panes = (process.env.MUX_XR_PANES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function arrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function main(): Promise<void> {
  assert(STREAMER, 'MUX_XR_STREAMER is required for the live adapter diagnostic');
  assert(panes.length === 2, 'MUX_XR_PANES must contain exactly two pane ids');
  const beforeLoad = loadavg()[0] ?? 0;
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const output: Record<string, string> = {};
  const sentInput: Record<string, string[]> = {};
  page.on('websocket', (socket) => {
    const session = new URL(socket.url()).searchParams.get('session') ?? '';
    const paneId = session.replace('pane-', '');
    output[paneId] = '';
    sentInput[paneId] = [];
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const message = decodeServerMessage(arrayBuffer(Buffer.from(payload)));
        if (message.message.case === 'output')
          output[paneId] += new TextDecoder().decode(message.message.value.data);
        if (message.message.case === 'connected' && message.message.value.initialScreen)
          output[paneId] += new TextDecoder().decode(message.message.value.initialScreen);
      } catch {
        // Ignore non-terminal frames. The surface owns protocol rejection semantics.
      }
    });
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const bytes = Buffer.from(payload);
        if (bytes.length < 2) return;
        const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
        if (message.message.case === 'input')
          sentInput[paneId].push(new TextDecoder().decode(message.message.value.data));
      } catch {
        // Ignore malformed or non-terminal frames for the diagnostic report.
      }
    });
  });
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
    assert(
      renderer !== 'unavailable' && !String(renderer).toLowerCase().includes('swiftshader'),
      `GPU renderer unavailable: ${renderer}`,
    );
    const markers = panes.map(
      (pane) => `MUX_XR_LIVE_${pane}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    );
    const beforeRevision = await page.evaluate(
      async ({ endpoint, paneIds }) => {
        const loadModule = Function('path', 'return import(path)') as (
          path: string,
        ) => Promise<typeof import('../src/terminal/surface')>;
        const module = await loadModule('/src/terminal/surface.ts');
        const surfaces = paneIds.map((id) =>
          module.createTerminalSurface(endpoint, {
            id,
            workspaceId: 'live',
            workspaceName: 'live',
            sessionId: 'live',
            sessionName: 'live',
            windowId: 'live',
            windowName: 'live',
            title: id,
            cols: 80,
            rows: 24,
          }),
        );
        Object.assign(window, { __muxXRLiveSurfaces: surfaces });
        surfaces.forEach((surface) => {
          surface.connect();
        });
        const deadline = Date.now() + 15_000;
        while (surfaces.some((surface) => surface.status !== 'connected')) {
          if (Date.now() > deadline)
            throw new Error(
              `live surfaces did not connect: ${surfaces.map((surface) => surface.status).join(',')}`,
            );
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return surfaces.map((surface) => surface.revision);
      },
      { endpoint: STREAMER, paneIds: panes },
    );
    await page.evaluate(
      async ({ commands }) => {
        const surfaces = (
          window as unknown as {
            __muxXRLiveSurfaces: Array<{
              sendText: (value: string) => boolean;
              sendKey: (key: string) => boolean;
            }>;
          }
        ).__muxXRLiveSurfaces;
        if (!surfaces) throw new Error('live surfaces were not installed');
        for (const [index, command] of commands.entries()) {
          if (!surfaces[index].sendText(command)) throw new Error(`input ${index} was rejected`);
          if (!surfaces[index].sendKey('Enter')) throw new Error(`enter ${index} was rejected`);
        }
      },
      {
        commands: markers.map((marker) => {
          const split = Math.ceil(marker.length / 2);
          const first = marker.slice(0, split);
          const second = marker.slice(split);
          return `printf '%s%s\\n' '${first}' '${second}'`;
        }),
      },
    );
    const deadline = Date.now() + 15_000;
    while (!markers.every((marker, index) => (output[panes[index]] ?? '').includes(marker))) {
      if (Date.now() > deadline)
        throw new Error(`live output marker was not observed: ${JSON.stringify(output)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const afterRevision = await page.evaluate(() =>
      (
        window as unknown as { __muxXRLiveSurfaces: Array<{ revision: number }> }
      ).__muxXRLiveSurfaces.map((surface) => surface.revision),
    );
    const disposedInputAccepted = await page.evaluate(() => {
      const surfaces = (
        window as unknown as {
          __muxXRLiveSurfaces: Array<{ dispose: () => void; sendText: (value: string) => boolean }>;
        }
      ).__muxXRLiveSurfaces;
      return surfaces.map((surface) => {
        surface.dispose();
        return surface.sendText('should-be-rejected');
      });
    });
    assert(
      disposedInputAccepted.every((accepted) => !accepted),
      'disposed surfaces accepted input',
    );
    assert(
      markers.every((marker, index) => !(sentInput[panes[index]] ?? []).join('').includes(marker)),
      'full marker appeared in joined input frames',
    );
    assert(
      afterRevision.some((revision, index) => revision > (beforeRevision[index] ?? 0)),
      'surface revisions did not change after live output',
    );
    const afterLoad = loadavg()[0] ?? 0;
    const result: LiveResult = {
      kind: 'live-adapter-diagnostic',
      build: 'mux-xr',
      host: process.platform,
      renderer: String(renderer),
      panes,
      markers,
      outputMarkersSeen: Object.fromEntries(
        markers.map((marker, index) => [
          panes[index],
          (output[panes[index]] ?? '').includes(marker),
        ]),
      ),
      beforeRevision,
      afterRevision,
      disposedInputAccepted,
      beforeLoad,
      afterLoad,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
