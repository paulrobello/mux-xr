import { mkdir, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fromBinary } from '@bufbuild/protobuf';
import { chromium } from 'playwright';
import { decodeServerMessage } from '../src/terminal/protocol';
import { ClientMessageSchema } from '../src/terminal/vendor/terminal_pb';
import { normalizeTree } from '../src/workspace/hierarchy';

// Drives the built app, served by a private streamer, through the browser New terminal control.
// Run only against an isolated daemon: the `created` case adds a real default-shell window.
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';
const BASE_URL = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4241';
const EXPECT = process.env.MUX_XR_EXPECT as 'created' | 'disabled' | 'old' | undefined;
const OUT = process.env.MUX_XR_EVIDENCE ?? join(process.cwd(), '.local', 'evidence', 'pane-create');

type Pane = { id: string; sessionId: string; cols?: number; rows?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const buffer = (payload: Buffer): ArrayBuffer =>
  payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;

async function waitFor<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, message: string) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main(): Promise<void> {
  assert(PRIVATE_TEST, 'MUX_XR_PRIVATE_TEST=1 is required: this check creates real panes');
  assert(
    EXPECT === 'created' || EXPECT === 'disabled' || EXPECT === 'old',
    'MUX_XR_EXPECT must be created, disabled or old',
  );
  const host = new URL(BASE_URL).hostname;
  assert(
    host === '127.0.0.1' || host === 'localhost',
    'Private checks must use a loopback streamer',
  );
  await mkdir(OUT, { recursive: true });
  const loadBefore = loadavg()[0];
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const sent: Record<string, number> = {};
  const connectedStreams = new Set<string>();
  let latest: Pane[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    const session = new URL(socket.url()).searchParams.get('session') ?? 'metadata';
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      const bytes = Buffer.from(payload);
      if (bytes.length < 2 || bytes[0] !== 0) return;
      const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
      const kind = message.message.case ?? 'none';
      sent[kind] = (sent[kind] ?? 0) + 1;
    });
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const message = decodeServerMessage(buffer(Buffer.from(payload)));
        if (message.message.case === 'muxTreeSnapshot')
          latest = normalizeTree(message.message.value).panes;
        if (message.message.case === 'connected') connectedStreams.add(session);
      } catch {
        errors.push(`undecodable frame on ${session}`);
      }
    });
  });
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#endpoint').fill(BASE_URL);
    await page.locator('[data-action="connect"]').click();
    await page.locator('[data-create-session]').first().waitFor({ timeout: 15_000 });
    const before = await waitFor(
      () => latest,
      (panes) => panes.length >= 2,
      'no hierarchy',
    );
    const target = before[0];
    await page.locator(`[data-pane="${target.id}"]`).first().click();
    await waitFor(
      () => connectedStreams.has(`pane-${target.id.slice(1)}`),
      Boolean,
      'existing pane did not attach',
    );
    const attachedBefore = await page
      .locator('[data-select]')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.select));
    const resizeBefore = sent.resize ?? 0;
    const button = page.locator(`[data-create-session="${target.sessionId}"]`);
    assert(!(await button.isDisabled()), 'creation control starts disabled');
    await button.click();
    let added: Pane[] = [];
    if (EXPECT === 'created') {
      added = await waitFor(
        () => latest.filter((pane) => !before.some((old) => old.id === pane.id)),
        (panes) => panes.length === 1,
        'the new pane never appeared in the hierarchy',
      );
      await page.locator(`[data-select="${added[0].id}"]`).waitFor({ timeout: 15_000 });
      await waitFor(
        () => connectedStreams.has(`pane-${added[0].id.slice(1)}`),
        Boolean,
        'the new pane stream did not connect',
      );
      assert(added[0].sessionId === target.sessionId, 'the new pane is in another session');
      await waitFor(
        () => button.isDisabled(),
        (disabled) => !disabled,
        'control stayed locked',
      );
    } else {
      await page
        .locator('.tree-create-note', { hasText: EXPECT === 'old' ? '0.77.0' : 'turned off' })
        .waitFor({ timeout: EXPECT === 'old' ? 60_000 : 15_000 });
      assert(await button.isDisabled(), `creation stayed enabled after the ${EXPECT} outcome`);
      await page.waitForTimeout(1500);
      await page.locator('[data-action="refresh"]').click();
      await page.waitForTimeout(1000);
      added = latest.filter((pane) => !before.some((old) => old.id === pane.id));
      assert(added.length === 0, 'a refused request created a pane');
      await page.locator('[data-create-session]').first().click({ force: true });
      await page.waitForTimeout(500);
    }
    const attachedAfter = await page
      .locator('[data-select]')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.select));
    const geometryChanged = before.filter((old) => {
      const now = latest.find((pane) => pane.id === old.id);
      return !now || now.cols !== old.cols || now.rows !== old.rows;
    });
    const screenshot = join(OUT, `app-${EXPECT}.png`);
    await page.screenshot({ path: screenshot });
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    const result = {
      kind: 'pane-create-app-check',
      expect: EXPECT,
      baseUrl: BASE_URL,
      renderer,
      loadBefore,
      loadAfter: loadavg()[0],
      before: before.map((pane) => `${pane.id}@${pane.sessionId} ${pane.cols}x${pane.rows}`),
      after: latest.map((pane) => `${pane.id}@${pane.sessionId} ${pane.cols}x${pane.rows}`),
      added: added.map((pane) => pane.id),
      attachedBefore,
      attachedAfter,
      sent,
      resizeDuringCreate: (sent.resize ?? 0) - resizeBefore,
      geometryChanged: geometryChanged.map((pane) => pane.id),
      notice: await page.locator('[data-notice-text]').textContent(),
      errors,
      screenshot,
    };
    await writeFile(join(OUT, `app-${EXPECT}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
    assert((sent.paneCreateRequest ?? 0) === 1, 'expected exactly one create request');
    assert((sent.resize ?? 0) === 0, 'a resize was sent');
    assert(geometryChanged.length === 0, 'an existing pane changed size or disappeared');
    assert(
      attachedBefore.every((id) => attachedAfter.includes(id)),
      'an existing view was replaced',
    );
    if (EXPECT === 'created') assert(attachedAfter.includes(added[0].id), 'new pane not attached');
    console.log(`PASS app ${EXPECT}`);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
