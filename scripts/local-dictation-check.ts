import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type * as THREE from 'three';
import type { TerminalSurface } from '../src/contracts';
import type { SpeechInput } from '../src/speech-input';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type FixtureWindow = Window & {
  __speechScene: WorkspaceScene;
  __speechInput: SpeechInput;
  __speechSurfaces: Map<string, TerminalSurface>;
  __questThree: typeof THREE;
  __questRenderer: THREE.WebGLRenderer;
  __questControllers: THREE.Group[];
  __speechStreams: MediaStream[];
  __sent: Array<{ id: string; text: string }>;
};
const rootPath = process.env.MUX_XR_TEST_ROOT;
const sample = process.env.MUX_XR_SPEECH_SAMPLE;
const speechUrl = process.env.MUX_XR_SPEECH_URL;
if (process.env.MUX_XR_PRIVATE_TEST !== '1' || !rootPath || !sample || !speechUrl)
  throw new Error(
    'Requires MUX_XR_PRIVATE_TEST=1, MUX_XR_TEST_ROOT, MUX_XR_SPEECH_SAMPLE and MUX_XR_SPEECH_URL',
  );
if (!sample.startsWith('/') || !speechUrl.startsWith('wss://'))
  throw new Error('Speech sample must be absolute and service URL must use wss://');
const testRoot = resolve(rootPath);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadBefore = loadavg()[0];
if (loadBefore > 15) throw new Error(`Host load too high: ${loadBefore}`);
await mkdir(testRoot, { recursive: true });
prepareQuestFixture(testRoot);
const entry = join(testRoot, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}\nObject.assign(window, { __speechScene: scene, __speechInput: speechInput, __speechSurfaces: surfaces });\n`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', testRoot], {
  cwd: repoRoot,
  stdio: 'pipe',
});
const types: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.ttf': 'font/ttf',
};
const server = createServer(async (request, response) => {
  const relative =
    decodeURIComponent((request.url ?? '/').split('?')[0]).replace(/^\/+/, '') ||
    '__quest-controls.html';
  const servedRoot =
    relative.startsWith('assets/') || relative.startsWith('fonts/')
      ? join(repoRoot, 'public')
      : testRoot;
  const file = resolve(servedRoot, normalize(relative));
  if (!file.startsWith(`${servedRoot}/`)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((done, reject) => {
  server.once('error', reject);
  server.listen(4241, '127.0.0.1', done);
});
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${sample}`,
    '--ignore-certificate-errors',
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
await page.addInitScript((serviceUrl) => {
  const NativeWebSocket = window.WebSocket;
  const NativeSpeech = (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  const streams: MediaStream[] = [];
  const media = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (media)
    navigator.mediaDevices.getUserMedia = async (...args: Parameters<typeof media>) => {
      const stream = await media(...args);
      streams.push(stream);
      (window as unknown as FixtureWindow).__speechStreams = streams;
      return stream;
    };
  class RoutedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const parsed = new URL(String(url), location.href);
      super(parsed.port === '4242' ? serviceUrl : url, protocols);
    }
  }
  Object.assign(window, { WebSocket: RoutedWebSocket, __removedSpeechRecognition: NativeSpeech });
}, speechUrl);
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.log(`Browser console: ${message.text()}`);
});
page.on('websocket', (socket) =>
  socket.on('socketerror', (error) => console.log(`Socket error: ${error}`)),
);
await page.routeWebSocket(
  (url) => url.port !== '4242',
  (socket) => socket.close(),
);
const clickNative = async (action: string, dataKey: string): Promise<void> =>
  page.evaluate(
    ({ action, dataKey }) => {
      const w = window as unknown as FixtureWindow;
      let target: THREE.Object3D | undefined;
      w.__speechScene.scene.traverse((object: THREE.Object3D) => {
        if (
          !target &&
          object.userData.inputAction === action &&
          object.userData.dictationAction === dataKey
        )
          target = object;
      });
      if (!target) throw new Error(`Missing native ${action}/${dataKey}`);
      w.__speechScene.scene.updateMatrixWorld(true);
      const controller = w.__questControllers[0];
      const rotation = target.getWorldQuaternion(new w.__questThree.Quaternion());
      controller.position
        .copy(target.getWorldPosition(new w.__questThree.Vector3()))
        .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
      controller.quaternion.copy(rotation);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
    },
    { action, dataKey },
  );
try {
  await page.goto('http://127.0.0.1:4241/__quest-controls.html?demo=1', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as unknown as FixtureWindow).__speechScene));
  const renderer = await page.evaluate(() => {
    const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  });
  if (!/Apple/.test(renderer) || /SwiftShader/i.test(renderer))
    throw new Error(`Wrong GPU: ${renderer}`);
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__speechScene.state.xrMode === 'vr',
  );
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).__speechScene.showInput('keyboard'),
  );
  const targetPane = await page.evaluate(
    () => (window as unknown as FixtureWindow).__speechScene.state.selectedTerminalId,
  );
  if (!targetPane) throw new Error('No selected speech target');
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow & { __sent: Array<{ id: string; text: string }> };
    w.__sent = [];
    for (const surface of w.__speechSurfaces.values()) {
      const send = surface.sendText.bind(surface);
      surface.sendText = (text: string) => {
        w.__sent.push({ id: surface.pane.id, text });
        return send(text);
      };
    }
  });
  await clickNative('dictation', 'start');
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__speechInput.getState().status === 'listening',
  );
  await page.waitForFunction(() =>
    (window as unknown as FixtureWindow).__speechStreams?.some((stream) => stream.active),
  );
  await page.screenshot({ path: join(testRoot, 'local-dictation-recording.png') });
  await page.waitForTimeout(12_000);
  await clickNative('dictation', 'stop');
  await page.waitForFunction(
    () => (window as unknown as FixtureWindow).__speechInput.getState().status === 'transcribing',
  );
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() =>
      (window as unknown as FixtureWindow).__speechInput.getState(),
    );
    if (state.status === 'review') break;
    if (state.status === 'error') throw new Error(state.error ?? 'Speech recognition failed');
    await page.waitForTimeout(500);
  }
  const reviewed = await page.evaluate(() =>
    (window as unknown as FixtureWindow).__speechInput.getState(),
  );
  if (
    reviewed.status !== 'review' ||
    !/ask not what your country can do for you/i.test(reviewed.transcript)
  )
    throw new Error(`Unexpected backend transcript: ${reviewed.transcript}`);
  const beforeInsert = await page.evaluate(
    () => (window as unknown as FixtureWindow).__sent.length,
  );
  if (beforeInsert !== 0) throw new Error('Dictation inserted before explicit review approval');
  await page.screenshot({ path: join(testRoot, 'local-dictation-review.png') });
  await clickNative('dictation', 'insert');
  const result = await page.evaluate(() => {
    const w = window as unknown as FixtureWindow & { __sent: Array<{ id: string; text: string }> };
    return {
      state: w.__speechInput.getState(),
      sent: w.__sent,
      tracksEnded: (w.__speechStreams ?? []).every((stream) =>
        [...stream.getTracks()].every((track) => track.readyState === 'ended'),
      ),
    };
  });
  if (
    result.sent.length !== 1 ||
    result.sent[0].id !== targetPane ||
    /[\r\n]/.test(result.sent[0].text)
  )
    throw new Error(`Unexpected insertion: ${JSON.stringify(result.sent)}`);
  const loadAfter = loadavg()[0];
  if (!result.tracksEnded || loadAfter > 15 || errors.length)
    throw new Error(JSON.stringify({ loadAfter, tracksEnded: result.tracksEnded, errors }));
  await writeFile(
    join(testRoot, 'local-dictation-result.json'),
    JSON.stringify(
      {
        renderer,
        targetPane,
        transcript: reviewed.transcript,
        inserted: result.sent[0].text,
        tracksEnded: result.tracksEnded,
        fakeMicrophone: true,
        loadBefore,
        loadAfter,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
}
