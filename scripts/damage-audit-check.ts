import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { decodeServerMessage } from '../src/terminal/protocol';

// Drives real programs through a PRIVATE par-mux daemon and a core 0.77+ mux streamer that serves
// the built app, with the painter's audit mode on: after every damage-hinted paint the painter
// rescans each row and counts rows that changed outside the hint. Zero misses across the run means
// hinted painting produced exactly the rows a full scan would have.

type StreamDamage = {
  damageScans: number;
  fullScans: number;
  rowsScanned: number;
  rejectedHints: number;
  auditMisses: number;
};
type StreamState = { id: string; status: string; rows: number; damage: StreamDamage | null };
type FixtureWindow = Window & {
  __muxXR: { getState: () => { streams: StreamState[] } };
};

const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
const SOCKET = process.env.MUX_XR_MUX_SOCKET;
const PAR_MUX = process.env.MUX_XR_PAR_MUX ?? 'par-mux';
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mux(command: string): string {
  return execFileSync(PAR_MUX, ['--socket', SOCKET as string, '--cmd', command], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

// Raw hex bytes reach the pane exactly; par-mux set-buffer strips shell quotes.
function sendBytes(pane: string, text: string): void {
  const hex = [...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, '0'));
  for (let index = 0; index < hex.length; index += 64)
    mux(`send-keys -t ${pane} -H ${hex.slice(index, index + 64).join(' ')}`);
}

function type(pane: string, text: string): void {
  sendBytes(pane, `${text}\r`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function streams(page: Page): Promise<StreamState[]> {
  return await page.evaluate(() => (window as unknown as FixtureWindow).__muxXR.getState().streams);
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, message: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (done(value)) return value;
    await sleep(100);
  }
  throw new Error(message);
}

async function main(): Promise<void> {
  assert(
    PRIVATE_TEST && BASE_URL && TEST_ROOT && SOCKET,
    'damage-audit-check requires ' +
      'MUX_XR_PRIVATE_TEST=1, MUX_XR_BASE_URL, MUX_XR_TEST_ROOT and MUX_XR_MUX_SOCKET',
  );
  assert(
    ['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE_URL).hostname),
    'MUX_XR_BASE_URL must be loopback',
  );
  assert(!SOCKET.endsWith('par-mux-default.sock'), 'Refusing the default par-mux socket');
  await mkdir(TEST_ROOT, { recursive: true });
  const loadBefore = loadavg()[0];
  assert(loadBefore <= 15, `Host load ${loadBefore.toFixed(2)} exceeds 15`);
  const panes = mux('list-panes')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^%\d+$/.test(line));
  assert(panes.length >= 2, `Private daemon needs two panes, found ${panes.length}`);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const errors: string[] = [];
  const steps: Array<{
    step: string;
    streams: StreamState[];
    outputs: Record<string, { hinted: number; plain: number }>;
  }> = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (error) => errors.push(error.message));
    // Per pane: output frames with and without damage fields, as received from the streamer.
    const outputs = new Map<string, { hinted: number; plain: number }>();
    page.on('websocket', (socket) => {
      const pane = new URL(socket.url()).searchParams.get('session');
      if (!pane) return;
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string') return;
        try {
          const message = decodeServerMessage(new Uint8Array(payload).buffer as ArrayBuffer);
          if (message.message.case !== 'output') return;
          const counts = outputs.get(pane) ?? { hinted: 0, plain: 0 };
          if (message.message.value.damageGeneration === undefined) counts.plain += 1;
          else counts.hinted += 1;
          outputs.set(pane, counts);
        } catch (error) {
          errors.push(`frame decode: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    });
    await page.addInitScript(() => {
      (window as unknown as { __muxXRDamageAudit: boolean }).__muxXRDamageAudit = true;
    });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.locator('#endpoint').fill(BASE_URL);
    await page.locator('[data-action="connect"]').click();
    for (const pane of panes.slice(0, 2)) {
      await page.locator(`[data-pane="${pane}"]`).waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator(`[data-pane="${pane}"]`).click();
    }
    await waitFor(
      () => streams(page),
      (list) => list.filter((stream) => stream.status === 'connected').length >= 2,
      'Two pane streams did not connect',
    );
    const [main, side] = panes;
    const record = async (step: string, run: () => void, settleMs = 1_500) => {
      run();
      await sleep(settleMs);
      const counts = Object.fromEntries([...outputs].map(([pane, value]) => [pane, { ...value }]));
      steps.push({ step, streams: await streams(page), outputs: counts });
    };
    await record('spinner in a second pane', () =>
      type(
        side,
        `for i in $(seq 1 150); do printf '\\r%s %d ' '|/-\\' "$i"; sleep 0.02; done; echo`,
      ),
    );
    await record('scrolling log', () => type(main, 'seq 1 4000'));
    await record('wide and combining text', () =>
      type(main, "printf '界面テスト wide 🎉 e\\u0301 done\\n'"),
    );
    await record('colors and attributes', () =>
      type(
        main,
        "printf '\\e[31mred\\e[0m \\e[1;4mbold under\\e[0m \\e[7minverse\\e[0m \\e[48;5;27mbg\\e[0m\\n'",
      ),
    );
    await record('cursor addressing', () =>
      type(main, "printf '\\e[s\\e[5;10Hcup-write\\e[2;1H\\e[2Kline two\\e[u'; echo"),
    );
    await record('scroll region', () =>
      type(main, "printf '\\e[3;10r\\e[10;1H'; seq 1 25; printf '\\e[r'; echo"),
    );
    await record('insert and delete characters', () =>
      type(main, "printf 'abcdefgh\\e[4D\\e[2@XY\\e[3P\\n'"),
    );
    await record('clear screen', () => type(main, 'clear'));
    await record(
      'full-screen editor',
      () => type(main, 'vi -u NONE /tmp/mux-xr-damage-audit.txt'),
      2_000,
    );
    await record('editor insert', () => {
      sendBytes(main, 'i');
      sendBytes(main, 'hello damage audit\x1byy10p');
    });
    await record('editor quit', () => {
      type(main, ':q!');
    });
    await record('resize', () => mux(`resize-pane -t ${main} -x 40`), 2_000);
    await record('output after resize', () => type(main, 'seq 1 60'));
    // Kilobytes of multibyte text split glyphs across relay chunk seams.
    await record(
      'wide text burst across chunk seams',
      () =>
        type(main, "for i in $(seq 1 60); do printf '界面テスト🎉é%.0s' $(seq 1 40); echo; done"),
      2_500,
    );
    // Output still queued in the browser when the grid changes size.
    await record(
      'resize during output',
      () => {
        type(main, 'seq 1 20000');
        mux(`resize-pane -t ${main} -x 60`);
      },
      3_000,
    );
    await page.screenshot({ path: join(TEST_ROOT, 'damage-audit.png') });
    const final = steps.at(-1)?.streams ?? [];
    const attached = final.filter((stream) => panes.slice(0, 2).includes(stream.id));
    const loadAfter = loadavg()[0];
    const report = {
      kind: 'damage-audit-check',
      baseUrl: new URL(BASE_URL).origin,
      panes: panes.slice(0, 2),
      steps,
      final: attached,
      errors,
      loadBefore,
      loadAfter,
      loadValid: loadAfter <= 15,
      evidence:
        'Real private par-mux daemon and mux streamer; painter audit mode rescans every row after each hinted paint',
    };
    await writeFile(join(TEST_ROOT, 'damage-audit.json'), JSON.stringify(report, null, 2));
    assert(attached.length === 2, 'Both audited streams must be attached at the end');
    for (const stream of attached) {
      assert(stream.damage, `${stream.id} reported no damage stats`);
      assert(stream.damage.damageScans > 0, `${stream.id} never received damage hints`);
      assert(
        stream.damage.auditMisses === 0,
        `${stream.id} missed ${stream.damage.auditMisses} rows`,
      );
    }
    assert(errors.length === 0, `Page errors: ${errors.join('; ')}`);
    assert(report.loadValid, `Post-run host load ${loadAfter.toFixed(2)} exceeds 15`);
    console.log(JSON.stringify({ ok: true, final: attached, loadBefore, loadAfter }));
  } finally {
    await browser.close();
  }
}

await main();
