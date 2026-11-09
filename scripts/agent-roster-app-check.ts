import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fromBinary } from '@bufbuild/protobuf';
import { chromium } from 'playwright';
import { decodeServerMessage } from '../src/terminal/protocol';
import { ClientMessageSchema } from '../src/terminal/vendor/terminal_pb';

// Drives the built app's agent roster against a private daemon: it reports agent states with
// `report-state` and closes a pane, so never point it at the real/default mux daemon.
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';
const BASE_URL = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4241';
const SOCKET = process.env.MUX_XR_MUX_SOCKET ?? '';
const OUT =
  process.env.MUX_XR_EVIDENCE ?? join(process.cwd(), '.local', 'evidence', 'agent-roster');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const buffer = (payload: Buffer): ArrayBuffer =>
  payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;

function mux(command: string): string {
  const run = spawnSync('par-mux', ['--socket', SOCKET, '--cmd', command], { encoding: 'utf8' });
  assert(run.status === 0, `par-mux ${command} failed: ${run.stderr}`);
  return run.stdout.trim();
}

// Microsecond-scale so it outruns any earlier epoch-ms report; stale seqs are dropped silently.
let seq = Date.now() * 1000;
// A pane.report_agent hook report, the path real agents use (source=hook).
function hook(paneId: string, agent: string, state: string, message = ''): void {
  seq += 1;
  const line = `${JSON.stringify({
    id: 1,
    method: 'pane.report_agent',
    params: { pane_id: paneId, agent, seq, state, message },
  })}\n`;
  const run = spawnSync('/usr/bin/nc', ['-U', '-w', '2', SOCKET], {
    input: line,
    encoding: 'utf8',
  });
  assert(run.stdout.includes('"ok"'), `hook report failed: ${run.stdout}${run.stderr}`);
}

async function main(): Promise<void> {
  assert(PRIVATE_TEST, 'MUX_XR_PRIVATE_TEST=1 is required: this check changes agent state');
  assert(SOCKET && !SOCKET.includes('par-mux-default'), 'MUX_XR_MUX_SOCKET must be private');
  const host = new URL(BASE_URL).hostname;
  assert(host === '127.0.0.1' || host === 'localhost', 'Private checks must use loopback');
  const panes = mux('list-panes -a').split('\n').sort();
  assert(panes.length >= 3, `need three private panes, found ${panes.join(',')}`);
  const [, agentPane, questionPane] = panes;
  await mkdir(OUT, { recursive: true });
  const loadBefore = loadavg()[0];
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const sent: Record<string, number> = {};
  const received: Record<string, number> = {};
  const connectedStreams = new Set<string>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    const session = new URL(socket.url()).searchParams.get('session') ?? 'metadata';
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      const bytes = Buffer.from(payload);
      if (bytes.length < 2 || bytes[0] !== 0) return;
      const kind =
        fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1))).message.case ?? 'none';
      sent[kind] = (sent[kind] ?? 0) + 1;
    });
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      try {
        const kind = decodeServerMessage(buffer(Buffer.from(payload))).message.case ?? 'none';
        if (session === 'metadata') received[kind] = (received[kind] ?? 0) + 1;
        if (kind === 'connected') connectedStreams.add(session);
      } catch {
        errors.push(`undecodable frame on ${session}`);
      }
    });
  });
  const row = (paneId: string) => page.locator(`.agent-row[data-pane="${paneId}"]`);
  try {
    if (process.env.MUX_XR_REASON_ONLY === '1') {
      // Run after a fresh private streamer start: only its first fetch carries reasons.
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.locator('#endpoint').fill(BASE_URL);
      await page.locator('[data-action="connect"]').click();
      const reason = page.locator('.agent-row .agent-reason').first();
      await reason.waitFor({ timeout: 15_000 });
      const shot = join(OUT, 'app-reason.png');
      await page.locator('.agents').screenshot({ path: shot });
      console.log(JSON.stringify({ reason: await reason.textContent(), shot, errors }));
      assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
      console.log('PASS agent roster reason');
      return;
    }
    hook(agentPane, 'claude', 'working');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#endpoint').fill(BASE_URL);
    await page.locator('[data-action="connect"]').click();
    await row(agentPane).waitFor({ timeout: 15_000 });
    assert((await row(agentPane).getAttribute('data-agent-tone')) === 'working', 'not working');
    const snapshotRow = (await row(agentPane).textContent()) ?? '';

    hook(agentPane, 'claude', 'blocked', 'needs approval');
    hook(questionPane, 'codex', 'question', 'pick a plan');
    await page
      .locator(`.agent-row[data-pane="${agentPane}"][data-agent-tone="attention"]`)
      .waitFor({ timeout: 15_000 });
    await row(questionPane).waitFor({ timeout: 15_000 });
    const liveRows = await page
      .locator('.agent-row')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
    // Live deltas carry no reason (core card 01a1c28e); MUX_XR_REASON_ONLY covers reasons.

    const resizeBefore = sent.resize ?? 0;
    await row(questionPane).click();
    const streamId = `pane-${questionPane.slice(1)}`;
    const deadline = Date.now() + 15_000;
    while (!connectedStreams.has(streamId) && Date.now() < deadline) await page.waitForTimeout(100);
    assert(connectedStreams.has(streamId), 'selected agent pane did not attach');
    await page
      .locator(`.agent-row.selected[data-pane="${questionPane}"]`)
      .waitFor({ timeout: 5_000 });
    await page.locator(`[data-select="${questionPane}"]`).waitFor({ timeout: 5_000 });
    const screenshot = join(OUT, 'app-roster.png');
    await page.screenshot({ path: screenshot });

    mux(`kill-pane -t ${agentPane}`);
    await row(agentPane).waitFor({ state: 'detached', timeout: 15_000 });
    const result = {
      kind: 'agent-roster-app-check',
      baseUrl: BASE_URL,
      loadBefore,
      loadAfter: loadavg()[0],
      panes,
      snapshotRow,
      liveRows,
      remainingRows: await page
        .locator('.agent-row')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.pane)),
      attached: await page
        .locator('[data-select]')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.select)),
      sent,
      received,
      resizeDuringSelect: (sent.resize ?? 0) - resizeBefore,
      errors,
      screenshot,
    };
    await writeFile(join(OUT, 'app-roster.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
    assert((received.agentRoster ?? 0) >= 1, 'no roster snapshot received');
    assert((received.agentStateChanged ?? 0) >= 2, 'roster deltas missing');
    console.log('PASS agent roster app');
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
