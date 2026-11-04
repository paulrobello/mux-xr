import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import type * as THREE from 'three';
import type { TerminalSurface } from '../src/contracts';
import type { SpeechInput } from '../src/speech-input';
import type { WorkspaceScene } from '../src/xr/scene';
import { prepareQuestFixture } from './prepare-quest-fixture';

type Fixture = Window & {
  __scene: WorkspaceScene;
  __speech: SpeechInput;
  __surfaces: Map<string, TerminalSurface>;
  __questThree: typeof THREE;
  __questRenderer: THREE.WebGLRenderer;
  __questControllers: THREE.Group[];
  __recognition: { emit(text: string): void; stops: number; aborts: number };
  __sent: Array<{ id: string; text: string }>;
  __settleLabels(): Promise<void>;
};

if (process.env.MUX_XR_PRIVATE_TEST !== '1' || !process.env.MUX_XR_TEST_ROOT)
  throw new Error('Requires private test mode and an explicit test root');
const root = resolve(process.env.MUX_XR_TEST_ROOT);
const repo = process.cwd();
const loadBefore = loadavg()[0];
await mkdir(root, { recursive: true });
prepareQuestFixture(root);
const entry = resolve(root, 'quest-main.ts');
await writeFile(
  entry,
  `${await readFile(entry, 'utf8')}
import { waitForLabelSync as settleLabel } from ${JSON.stringify(resolve('src/xr/labels.ts'))};
Object.assign(window, { __scene: scene, __speech: speechInput, __surfaces: surfaces,
  __settleLabels: async () => { const jobs = []; scene.scene.traverse(object => { if(object.userData.labelTextObject) jobs.push(settleLabel(object)); }); await Promise.all(jobs); }
});`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', root], { stdio: 'pipe' });
const server = createServer(async (request, response) => {
  const relative =
    decodeURIComponent((request.url ?? '/').split('?')[0]).replace(/^\/+/, '') ||
    '__quest-controls.html';
  const base =
    relative.startsWith('fonts/') || relative.startsWith('assets/')
      ? resolve(repo, 'public')
      : root;
  const file = resolve(base, relative);
  if (!file.startsWith(`${base}/`)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.ttf': 'font/ttf',
    };
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
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.routeWebSocket(/.*/, (socket) => socket.close());
await page.addInitScript(() => {
  class Recognition {
    onstart?: () => void;
    onend?: () => void;
    onresult?: (event: unknown) => void;
    stops = 0;
    aborts = 0;
    constructor() {
      Object.assign(window, { __recognition: this });
    }
    start(): void {
      this.onstart?.();
    }
    stop(): void {
      this.stops++;
      this.onend?.();
    }
    abort(): void {
      this.aborts++;
      this.onend?.();
    }
    emit(text: string): void {
      this.onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript: text }], { isFinal: true })],
      });
    }
  }
  Object.assign(window, {
    MediaRecorder: undefined,
    SpeechRecognition: Recognition,
    webkitSpeechRecognition: Recognition,
  });
});
const settle = async (): Promise<void> => {
  await page.waitForFunction(
    () => {
      const root = (window as unknown as Fixture).__scene.scene.getObjectByName(
        'hierarchy-navigator',
      );
      return !root || root.userData.transitioning === false;
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.evaluate(() => (window as unknown as Fixture).__settleLabels());
};
const click = async (name: string, hole = false): Promise<void> => {
  await page.evaluate(
    ({ name, hole }) => {
      const w = window as unknown as Fixture;
      w.__scene.scene.updateMatrixWorld(true);
      const object = w.__scene.scene.getObjectByName(name);
      if (!object) throw new Error(`Missing ${name}`);
      const controller = w.__questControllers[0];
      const rotation = object.getWorldQuaternion(new w.__questThree.Quaternion());
      const point = object.localToWorld(new w.__questThree.Vector3(0, hole ? 0.07 : 0, 0));
      controller.position
        .copy(point)
        .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
      controller.quaternion.copy(rotation);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
    },
    { name, hole },
  );
  await settle();
};
const clickAction = async (action: string, value: string): Promise<void> => {
  const name = await page.evaluate(
    ({ action, value }) => {
      const w = window as unknown as Fixture;
      let found: THREE.Object3D | undefined;
      w.__scene.scene.traverse((object) => {
        if (
          !found &&
          object.userData.inputAction === action &&
          (object.userData.dictationAction === value || object.userData.key === value)
        )
          found = object;
      });
      if (!found) throw new Error(`Missing action ${action}/${value}`);
      found.name = '__qa-action';
      return found.name;
    },
    { action, value },
  );
  await click(name);
};
try {
  await page.goto('http://127.0.0.1:4241/__quest-controls.html?demo=1');
  await page.waitForFunction(() => Boolean((window as unknown as Fixture).__speech));
  const renderer = await page.evaluate(() => {
    const gl = (window as unknown as Fixture).__questRenderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
  });
  if (!/Apple/.test(renderer) || /SwiftShader/.test(renderer))
    throw new Error(`Wrong renderer ${renderer}`);
  await page.evaluate(() => {
    const w = window as unknown as Fixture;
    w.__sent = [];
    for (const surface of w.__surfaces.values())
      surface.sendText = (text) => {
        w.__sent.push({ id: surface.pane.id, text });
        return true;
      };
  });
  await page.locator('[data-action="keyboard"]').click();
  await page.locator('[data-action="dictation-start"]').click();
  await page.evaluate(() =>
    (window as unknown as Fixture).__recognition.emit('echo reviewed draft'),
  );
  await page.locator('[data-action="dictation-stop"]').click();
  await page.screenshot({ path: resolve(root, 'desktop-clear.png') });
  await page.locator('[data-action="dictation-clear"]').click();
  await page.waitForFunction(() => {
    const state = (window as unknown as Fixture).__speech.getState();
    return state.status === 'review' && state.transcript === '';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(root, 'mobile-clear.png') });
  await page.locator('[data-dictation-draft]').fill('echo clear-dom');
  await page.locator('[data-action="dictation-insert"]').click();
  await page.locator('[data-action="close-drawer"]').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="xr"]').click();
  await page.waitForFunction(() => (window as unknown as Fixture).__scene.state.xrMode === 'vr');
  await page.evaluate(() => (window as unknown as Fixture).__scene.showInput('keyboard'));
  await clickAction('dictation', 'start');
  await page.evaluate(() => (window as unknown as Fixture).__recognition.emit('echo clear-native'));
  await clickAction('dictation', 'stop');
  const beforeClear = await page.evaluate(() => {
    const w = window as unknown as Fixture;
    return {
      stops: w.__recognition.stops,
      aborts: w.__recognition.aborts,
      target: w.__scene.state.inputTargetId,
    };
  });
  await clickAction('dictation', 'clear');
  const cleared = await page.evaluate(() => {
    const w = window as unknown as Fixture;
    const state = w.__speech.getState();
    if (
      state.status !== 'review' ||
      state.transcript ||
      !w.__scene.scene.getObjectByName('xr-keyboard-controls')
    )
      throw new Error('Clear closed or retained the draft');
    return {
      stops: w.__recognition.stops,
      aborts: w.__recognition.aborts,
      target: w.__scene.state.inputTargetId,
    };
  });
  if (JSON.stringify(cleared) !== JSON.stringify(beforeClear))
    throw new Error('Clear changed target or stopped recognition');
  await page.screenshot({ path: resolve(root, 'native-clear.png') });
  await clickAction('key', 'a');
  await clickAction('dictation', 'insert');
  const sent = await page.evaluate(() => (window as unknown as Fixture).__sent);
  if (
    sent.length !== 2 ||
    sent[0].text !== 'echo clear-dom' ||
    sent[1].text !== 'a' ||
    sent.some((entry) => entry.id !== beforeClear.target)
  )
    throw new Error(`Unexpected insertion ${JSON.stringify(sent)}`);
  await page.evaluate(() => {
    const w = window as unknown as Fixture;
    w.__scene.setAvailablePanes(
      Array.from({ length: 13 }, (_, index) => ({
        id: index < 2 ? `demo-${index + 1}` : `qa-${index}`,
        title: `Pane ${index}`,
        workspaceId: 'qa',
        workspaceName: 'Demo QA',
        sessionId: 'qa-session',
        sessionName: 'Session',
        windowId: `window-${index}`,
        windowName: `Window ${index}`,
      })),
    );
    w.__scene.setBackground('black');
    w.__scene.showInput('panes');
  });
  const styles: Array<Record<string, unknown>> = [];
  for (const style of ['helix', 'spatial-docks'] as const) {
    await page.evaluate(
      (style) => (window as unknown as Fixture).__scene.setHierarchyStyle(style),
      style,
    );
    await settle();
    await click('hierarchy-control-home', true);
    const home = await page.evaluate(
      () =>
        (window as unknown as Fixture).__scene.scene.getObjectByName('hierarchy-navigator')
          ?.userData.hierarchyPath.length,
    );
    if (home !== 0) throw new Error('Home center did not activate');
    for (let depth = 0; depth < 2; depth++) {
      const target = await page.evaluate(() => {
        const root = (window as unknown as Fixture).__scene.scene.getObjectByName(
          'hierarchy-navigator',
        );
        const length = Number(root?.userData.hierarchyPath.length ?? 0);
        let target: THREE.Object3D | undefined;
        root?.traverse((object) => {
          if (
            !target &&
            object.userData.inputAction === 'hierarchyNode' &&
            object.userData.hierarchyPath?.length === length + 1
          )
            target = object;
        });
        if (!target) throw new Error('Missing child branch');
        target.name = '__qa-child';
        return target.name;
      });
      await click(target);
    }
    await click('hierarchy-page-1', true);
    await page.waitForFunction(
      () =>
        (window as unknown as Fixture).__scene.scene.getObjectByName('hierarchy-navigator')
          ?.userData.hierarchyPage === 1,
    );
    await click('hierarchy-page-0', true);
    const windowTarget = await page.evaluate(() => {
      const root = (window as unknown as Fixture).__scene.scene.getObjectByName(
        'hierarchy-navigator',
      );
      const node = root?.children.find(
        (object) =>
          object.name.startsWith('hierarchy-window-') &&
          object.userData.hierarchyPath?.length === root.userData.hierarchyPath.length + 1,
      );
      const body = node?.children[0];
      if (!body) throw new Error('Missing first window');
      body.name = '__qa-window';
      return body.name;
    });
    await click(windowTarget);
    const sample = await page.evaluate(() => {
      const w = window as unknown as Fixture;
      const root = w.__scene.scene.getObjectByName('hierarchy-navigator');
      const node = root?.children.find((object) => object.userData.attachedRing);
      const body = node?.children[0];
      const ring = node?.children.find(
        (object) => (object as THREE.Mesh).geometry?.type === 'TorusGeometry',
      );
      const label = node?.children.find((object) => object.userData.labelTextObject);
      if (!body || !ring || !label) throw new Error('Missing attached pane geometry');
      body.name = '__qa-body';
      ring.name = '__qa-ring';
      label.name = '__qa-label';
      w.__scene.scene.updateMatrixWorld(true);
      return {
        body: body.quaternion.toArray(),
        ring: ring.quaternion.toArray(),
        label: label.getWorldQuaternion(new w.__questThree.Quaternion()).toArray(),
      };
    });
    await page.waitForFunction(
      (sample) => {
        const w = window as unknown as Fixture;
        w.__scene.scene.updateMatrixWorld(true);
        const scene = w.__scene.scene,
          q = w.__questThree.Quaternion;
        const body = scene.getObjectByName('__qa-body'),
          ring = scene.getObjectByName('__qa-ring'),
          label = scene.getObjectByName('__qa-label');
        return (
          body &&
          ring &&
          label &&
          body.quaternion.angleTo(new q().fromArray(sample.body)) > 0.01 &&
          ring.quaternion.angleTo(new q().fromArray(sample.ring)) > 0.01 &&
          label.getWorldQuaternion(new q()).angleTo(new q().fromArray(sample.label)) < 0.0001
        );
      },
      sample,
      { timeout: 60_000 },
    );
    await settle();
    await page.screenshot({ path: resolve(root, `explorer-${style}.png`) });
    await click('hierarchy-control-up', true);
    const up = await page.evaluate(
      () =>
        (window as unknown as Fixture).__scene.scene.getObjectByName('hierarchy-navigator')
          ?.userData.hierarchyPath.length,
    );
    if (up !== 2) throw new Error('Up center did not activate');
    styles.push({
      style,
      home: true,
      next: true,
      previous: true,
      up: true,
      bodyAndRingMotion: true,
      labelStable: true,
    });
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  const result = {
    functionalOnly: true,
    renderer,
    loadBefore,
    loadAfter: loadavg()[0],
    performanceMeasurements: false,
    styles,
    cleared,
    sent,
    errors,
  };
  await writeFile(resolve(root, 'explorer-controls-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
}
