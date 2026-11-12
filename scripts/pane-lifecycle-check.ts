import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PaneProcess, parsePaneProcess, samePaneId } from '../src/terminal/lifecycle';
import { decodeServerMessage } from '../src/terminal/protocol';
import { paneWebSocketURL } from '../src/terminal/surface';

// Held-pane exit and respawn through a real streamer, against a private par-mux daemon and
// socket only. It never touches the shared default daemon.
const STREAMER_BIN = process.env.MUX_XR_STREAMER_BIN ?? 'par-term-streamer';
const PAR_MUX_BIN = process.env.MUX_XR_PAR_MUX_BIN ?? 'par-mux';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        address && typeof address !== 'string' ? resolve(address.port) : reject(new Error('port')),
      );
    });
  });

const root = mkdtempSync(join(tmpdir(), 'mux-xr-lifecycle-'));
const socket = join(root, 'mux.sock');
const env = { ...process.env, PAR_MUX_ALLOW_NESTED: '1', PAR_MUX_SOCKET: socket };
delete (env as Record<string, string | undefined>).PAR_MUX_ENV;
const mux = (command: string): string =>
  execFileSync(PAR_MUX_BIN, ['--socket', socket, '--cmd', command], { env, encoding: 'utf8' });

let streamer: ChildProcess | undefined;

async function main(): Promise<Record<string, unknown>> {
  execFileSync(
    PAR_MUX_BIN,
    ['start', '--socket', socket, '--state-dir', join(root, 'state'), '--no-attach'],
    { env, stdio: 'ignore' },
  );
  mux('set-option remain-on-exit on');
  mux(`new-session -s lifecycle -c ${root}`);
  const paneId = mux('list-panes').trim().split('\n')[0]?.trim();
  assert(paneId && /^%\d+$/.test(paneId), `No private pane: ${paneId}`);

  const port = await freePort();
  streamer = spawn(
    STREAMER_BIN,
    ['--host', '127.0.0.1', '--port', String(port), '--mux-socket', socket],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let streamerLog = '';
  streamer.stdout?.on('data', (chunk) => {
    streamerLog += String(chunk);
  });
  streamer.stderr?.on('data', (chunk) => {
    streamerLog += String(chunk);
  });
  const version = execFileSync(STREAMER_BIN, ['--version'], { encoding: 'utf8' }).trim();

  const states: Array<PaneProcess & { at: number }> = [];
  let exited = false;
  streamer.once('exit', () => {
    exited = true;
  });
  let connected = false;
  let ws: WebSocket | undefined;
  for (let attempt = 0; attempt < 40 && !connected && !exited; attempt += 1) {
    await sleep(250);
    ws = await new Promise<WebSocket | undefined>((resolve) => {
      const candidate = new WebSocket(paneWebSocketURL(`ws://127.0.0.1:${port}`, paneId));
      candidate.binaryType = 'arraybuffer';
      candidate.onopen = () => resolve(candidate);
      candidate.onerror = () => resolve(undefined);
    });
    if (!ws) continue;
    ws.onmessage = (event) => {
      const message = decodeServerMessage(event.data as ArrayBuffer);
      if (message.message.case === 'connected') connected = true;
      if (message.message.case !== 'paneProcessState') return;
      const { paneId: id, state, exitCode } = message.message.value;
      if (id !== '' && !samePaneId(id, paneId)) return;
      const next = parsePaneProcess(state, exitCode);
      if (next) states.push({ ...next, at: Date.now() });
    };
    for (let wait = 0; wait < 20 && !connected; wait += 1) await sleep(100);
  }
  assert(connected, `Streamer never sent connected:\n${streamerLog}`);

  const waitFor = async (match: (state: PaneProcess) => boolean, label: string) => {
    for (let wait = 0; wait < 100; wait += 1) {
      if (states.some(match)) return;
      await sleep(100);
    }
    throw new Error(`No ${label} state; saw ${JSON.stringify(states)}\n${streamerLog}`);
  };

  mux(`send-keys -t ${paneId} -l "exit 3" --enter`);
  await waitFor((s) => s.state === 'exited' && s.exitCode === 3, 'exited (code 3)');
  const exitedAt = states.length;
  mux(`respawn-pane -t ${paneId}`);
  await waitFor((s) => s.state === 'running', 'running after respawn');
  const afterRespawn = states.slice(exitedAt);
  assert(
    afterRespawn.some((s) => s.state === 'running'),
    'Respawn did not report running on the same stream',
  );
  ws?.close();
  return {
    kind: 'pane-lifecycle-real-streamer',
    streamer: version,
    paneId,
    states: states.map(({ state, exitCode }) =>
      exitCode === undefined ? state : `${state}(${exitCode})`,
    ),
  };
}

main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    console.log('PASS');
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    streamer?.kill('SIGTERM');
    try {
      execFileSync(PAR_MUX_BIN, ['--socket', socket, '--stop'], { env, stdio: 'ignore' });
    } catch {}
    rmSync(root, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  });
