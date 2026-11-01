import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { create, fromBinary } from '@bufbuild/protobuf';
import { chromium, type Page } from 'playwright';
import { decodeServerMessage, encodeClientMessage } from '../src/terminal/protocol';
import {
  ClientMessageSchema,
  MuxTreeRequestSchema,
  type MuxTreeSnapshot,
} from '../src/terminal/vendor/terminal_pb';

type PaneObservation = {
  id: string;
  title: string;
  cols: number;
  rows: number;
  active: boolean;
};
type WireFrame = { paneId: string; case: string; data?: string };
type RealResult = {
  kind: 'real-app-core-integration';
  build: string;
  rawCoreCandidate: string;
  binary: string;
  backendBaseUrl: string;
  renderer: string;
  readonlyProbe: { before: number; afterProbe: number; afterAttach: number };
  attached: number;
  sessions: { before: number; afterProbe: number; afterAttach: number };
  receivedSnapshotCount: number;
  paneIds: string[];
  treePanes: PaneObservation[];
  gridsBefore: Array<{ id: string; cols: number; rows: number }>;
  gridsAfter: Array<{ id: string; cols: number; rows: number }>;
  markersSeen: Record<string, boolean>;
  zeroResizeMessages: number;
  screenshotPaths: string[];
  errors: string[];
};

const BASE_URL = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4241';
const REVIEW_DIR = join(process.cwd(), '.impeccable', 'review');
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function toArrayBuffer(payload: Buffer): ArrayBuffer {
  return payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  ) as ArrayBuffer;
}

function snapshotPanes(snapshot: MuxTreeSnapshot): PaneObservation[] {
  return snapshot.workspaces.flatMap((workspace) =>
    workspace.sessions.flatMap((session) =>
      session.windows.flatMap((window) =>
        window.panes.map((pane) => ({
          id: pane.id,
          title: pane.title,
          cols: pane.cols,
          rows: pane.rows,
          active: pane.active,
        })),
      ),
    ),
  );
}

async function sessionCount(page: Page): Promise<number> {
  const response = await page.request.get(`${BASE_URL}/sessions`);
  assert(response.ok(), `GET /sessions failed with ${response.status()}`);
  const body: unknown = await response.json();
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object' && Array.isArray((body as { sessions?: unknown }).sessions))
    return (body as { sessions: unknown[] }).sessions.length;
  throw new Error('GET /sessions did not return an array or {sessions: []}');
}

async function waitFor<T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  message: string,
): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function main(): Promise<void> {
  assert(PRIVATE_TEST, 'MUX_XR_PRIVATE_TEST=1 is required before issuing commands');
  await mkdir(REVIEW_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const frames: WireFrame[] = [];
  const outputs = new Map<string, string>();
  const connectedPanes = new Set<string>();
  const runPrefix = `MUX_XR_${Date.now()}_`;
  const firstMarker = `${runPrefix}A`;
  const secondMarker = `${runPrefix}B`;
  const snapshots: MuxTreeSnapshot[] = [];
  const screenshotPaths: string[] = [];
  let zeroResizeMessages = 0;
  let metadataProbeReady = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    const session = url.searchParams.get('session');
    const paneId = session?.replace(/^pane-/, '%') ?? 'metadata';
    if (paneId !== 'metadata') outputs.set(paneId, '');
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const message = decodeServerMessage(toArrayBuffer(Buffer.from(payload)));
        if (paneId !== 'metadata' && message.message.case === 'connected')
          connectedPanes.add(paneId);
        if (message.message.case === 'muxTreeSnapshot') {
          snapshots.push(message.message.value);
          if (url.searchParams.get('metadata') === '1') {
            metadataProbeReady = true;
          }
        }
        if (
          paneId !== 'metadata' &&
          message.message.case === 'connected' &&
          message.message.value.initialScreen
        )
          outputs.set(
            paneId,
            `${outputs.get(paneId) ?? ''}${new TextDecoder().decode(message.message.value.initialScreen)}`,
          );
        if (paneId !== 'metadata' && message.message.case === 'output')
          outputs.set(
            paneId,
            `${outputs.get(paneId) ?? ''}${new TextDecoder().decode(message.message.value.data)}`,
          );
      } catch (error) {
        errors.push(
          `server frame decode: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const bytes = Buffer.from(payload);
        const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
        if (message.message.case === 'resize') zeroResizeMessages += 1;
        if (message.message.case === 'input')
          frames.push({
            paneId,
            case: 'input',
            data: new TextDecoder().decode(message.message.value.data),
          });
        else frames.push({ paneId, case: message.message.case ?? 'unknown' });
      } catch (error) {
        errors.push(
          `client frame decode: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  });
  try {
    const sessionsBefore = await sessionCount(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const metadataRequest = encodeClientMessage(
      create(ClientMessageSchema, {
        message: { case: 'muxTreeRequest', value: create(MuxTreeRequestSchema) },
      }),
    );
    await page.evaluate(
      ({ endpoint, request }) => {
        const url = new URL(endpoint);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
        url.searchParams.set('metadata', '1');
        const socket = new WebSocket(url.toString());
        Object.assign(window, { __muxXRMetadataProbe: socket });
        socket.addEventListener('open', () => socket.send(new Uint8Array(request)));
      },
      { endpoint: BASE_URL, request: [...new Uint8Array(metadataRequest)] },
    );
    await waitFor(
      () => metadataProbeReady,
      Boolean,
      'metadata-only probe did not receive a tree snapshot',
    );
    await page.evaluate(() =>
      (window as unknown as { __muxXRMetadataProbe?: WebSocket }).__muxXRMetadataProbe?.close(),
    );
    const sessionsAfterProbe = await sessionCount(page);
    assert(
      sessionsAfterProbe === sessionsBefore,
      `metadata probe changed session count: ${sessionsBefore} to ${sessionsAfterProbe}`,
    );
    await page.locator('#endpoint').fill(BASE_URL);
    await page.locator('[data-action="connect"]').click();
    await page.locator('[data-pane]').nth(1).waitFor({ state: 'visible', timeout: 15_000 });
    await waitFor(
      () => snapshots.length,
      (count) => count >= 2,
      'app did not receive a hierarchy snapshot',
    );
    const treePanes = snapshotPanes(snapshots.at(-1) ?? snapshots[0]);
    assert(treePanes.length >= 2, `real hierarchy exposed only ${treePanes.length} panes`);
    const paneIds = treePanes.slice(0, 2).map((pane) => pane.id);
    const gridsBefore = paneIds.map((id) => {
      const pane = treePanes.find((item) => item.id === id);
      return { id, cols: pane?.cols ?? 0, rows: pane?.rows ?? 0 };
    });
    assert(
      gridsBefore.every((grid) => grid.cols > 0 && grid.rows > 0),
      'Daemon metadata lacks valid pane geometry; use the matching core daemon candidate',
    );
    await page.locator(`[data-pane="${paneIds[0]}"]`).click();
    await page.locator(`[data-pane="${paneIds[1]}"]`).click();
    assert((await page.locator('[data-select]').count()) >= 2, 'real app did not attach two panes');
    await waitFor(
      () => paneIds.every((id) => connectedPanes.has(id)),
      Boolean,
      'both pane streams did not complete their handshakes',
    );
    const sessionsAfterAttach = await waitFor(
      () => sessionCount(page),
      (count) => count === 2,
      'pane attach did not create exactly two viewer streams',
    );
    const overviewPath = join(REVIEW_DIR, 'real-app-overview.png');
    await page.screenshot({ path: overviewPath, fullPage: true });
    screenshotPaths.push(overviewPath);
    await page.locator(`[data-pane="${paneIds[0]}"]`).click();
    await page.locator('[data-action="commands"]').click();
    await page.locator('[data-command-label]').fill('Real global marker');
    await page.locator('[data-command-text]').fill(`printf '%s%s\\n' '${runPrefix}' 'A'`);
    await page.locator('[data-action="save-command"]').click();
    await page.locator('[data-command-select]').selectOption({ label: 'Real global marker' });
    await page.locator('[data-action="run-command"]').click();
    await waitFor(
      () => outputs.get(paneIds[0]) ?? '',
      (text) => text.includes(firstMarker),
      'first real command output marker not observed',
    );
    await page.locator(`[data-select="${paneIds[1]}"]`).click();
    assert(
      (await page.locator('[data-detail]').textContent())?.includes(
        treePanes[1].title || paneIds[1],
      ),
      'input target caption did not follow explicit selection',
    );
    await page.locator('[data-compose]').fill(`printf '%s%s\\n' '${runPrefix}' 'B'`);
    await page.locator('[data-action="send-text"]').click();
    await page.locator('[data-key="Enter"]').click();
    await waitFor(
      () => outputs.get(paneIds[1]) ?? '',
      (text) => text.includes(secondMarker),
      'second real command output marker not observed',
    );
    const keyboardPath = join(REVIEW_DIR, 'real-app-keyboard.png');
    await page.screenshot({ path: keyboardPath, fullPage: true });
    screenshotPaths.push(keyboardPath);
    await page.locator('[data-action="close-drawer"]').click();
    await page.locator('[data-action="settings"]').click();
    const settingsPath = join(REVIEW_DIR, 'real-app-settings.png');
    await page.screenshot({ path: settingsPath, fullPage: true });
    screenshotPaths.push(settingsPath);
    const gridsAfter = paneIds.map((id) => {
      const pane = snapshotPanes(snapshots.at(-1) ?? snapshots[0]).find((item) => item.id === id);
      return { id, cols: pane?.cols ?? 0, rows: pane?.rows ?? 0 };
    });
    assert(
      JSON.stringify(gridsBefore) === JSON.stringify(gridsAfter),
      'Viewing and input changed pane dimensions',
    );
    assert(
      !(outputs.get(paneIds[0]) ?? '').includes(secondMarker),
      'pane B command leaked to pane A',
    );
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
    const result: RealResult = {
      kind: 'real-app-core-integration',
      build: process.env.MUX_XR_BUILD ?? 'unknown',
      rawCoreCandidate: process.env.MUX_XR_CORE_SHA ?? 'unknown',
      binary: process.env.MUX_XR_BINARY_SHA ?? 'unknown',
      backendBaseUrl: BASE_URL,
      renderer: String(renderer),
      readonlyProbe: {
        before: sessionsBefore,
        afterProbe: sessionsAfterProbe,
        afterAttach: sessionsAfterAttach,
      },
      attached: await page.locator('[data-select]').count(),
      sessions: {
        before: sessionsBefore,
        afterProbe: sessionsAfterProbe,
        afterAttach: sessionsAfterAttach,
      },
      receivedSnapshotCount: snapshots.length,
      paneIds,
      treePanes,
      gridsBefore,
      gridsAfter,
      markersSeen: {
        [paneIds[0]]: (outputs.get(paneIds[0]) ?? '').includes(firstMarker),
        [paneIds[1]]: (outputs.get(paneIds[1]) ?? '').includes(secondMarker),
      },
      zeroResizeMessages,
      screenshotPaths,
      errors,
    };
    assert(zeroResizeMessages === 0, `unexpected client resize messages: ${zeroResizeMessages}`);
    assert(
      frames
        .filter((frame) => frame.case === 'input')
        .every(
          (frame) => !frame.data?.includes(firstMarker) && !frame.data?.includes(secondMarker),
        ),
      'full marker appeared in client input',
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const failurePath = join(REVIEW_DIR, 'real-app-failure.png');
    await page.screenshot({ path: failurePath, fullPage: true }).catch(() => undefined);
    errors.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
