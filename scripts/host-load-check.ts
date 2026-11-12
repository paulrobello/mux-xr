import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Renders the host load meter in native-GPU Chromium with real Troika text, fed by a fake stats
// source (no dictation server), and writes one screenshot per state.
const SHOTS = process.env.MUX_XR_SHOTS ?? '/tmp/host-load-shots';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'mux-xr-host-load-'));
mkdirSync(SHOTS, { recursive: true });
const entry = join(root, 'host-load-entry.ts');
writeFileSync(
  entry,
  `import * as THREE from ${JSON.stringify(join(repoRoot, 'node_modules/three/build/three.module.js'))};
import { createHostLoadWidget } from ${JSON.stringify(join(repoRoot, 'src/xr/host-load.ts'))};
import { waitForLabelSync } from ${JSON.stringify(join(repoRoot, 'src/xr/labels.ts'))};
import { createUIEnvironment } from ${JSON.stringify(join(repoRoot, 'src/xr/ui-environment.ts'))};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(2);
renderer.setSize(640, 380);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080b);
scene.add(new THREE.HemisphereLight(0xdde8f0, 0x1a2228, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(0.4, 1, 1.2);
scene.add(sun);
const env = createUIEnvironment(renderer);
const camera = new THREE.PerspectiveCamera(30, 640 / 380, 0.01, 10);
camera.position.set(0, 0, 0.74);
let widget;
const gl = renderer.getContext();
const info = gl.getExtension('WEBGL_debug_renderer_info');
window.__hostLoad = {
  renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
  async show(result) {
    if (widget) {
      widget.root.removeFromParent();
      widget.dispose();
    }
    let served;
    const done = new Promise((resolve) => { served = resolve; });
    widget = createHostLoadWidget(env.texture, {
      source: async () => { queueMicrotask(served); return result; },
    });
    scene.add(widget.root);
    widget.update(0);
    await done;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const labels = [];
    widget.root.traverse((object) => { if (object.userData.disposeLabel) labels.push(object); });
    await Promise.all(labels.map((label) => waitForLabelSync(label)));
    renderer.render(scene, camera);
  },
};
`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', root], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const html =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="./host-load-entry.js"></script></body></html>';
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const send = (type: string, body: string | Buffer): void => {
    response.writeHead(200, { 'content-type': type });
    response.end(body);
  };
  if (path === '/') send('text/html', html);
  else if (path === '/host-load-entry.js')
    send('text/javascript', readFileSync(join(root, 'host-load-entry.js')));
  else if (/^\/fonts\/[A-Za-z0-9-]+\.ttf$/.test(path))
    send('font/ttf', readFileSync(join(repoRoot, 'public', path)));
  else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No check server address');

const states = {
  ok: { ok: true, value: { load: [3.42, 2.97, 2.61], cpu: 23.4, cores: 14 } },
  warn: { ok: true, value: { load: [17.85, 12.4, 8.06], cpu: 81.2, cores: 14 } },
  unavailable: { ok: false, code: 'unavailable' },
};

const before = loadavg();
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 380 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => '__hostLoad' in window);
  const shots: string[] = [];
  for (const [name, result] of Object.entries(states)) {
    await page.evaluate(
      (result) =>
        (window as unknown as { __hostLoad: { show(r: unknown): Promise<void> } }).__hostLoad.show(
          result,
        ),
      result,
    );
    const path = join(SHOTS, `host-load-${name}.png`);
    await page.screenshot({ path });
    shots.push(path);
  }
  const rendererName = await page.evaluate(
    () => (window as unknown as { __hostLoad: { renderer: string } }).__hostLoad.renderer,
  );
  const after = loadavg();
  console.log(
    JSON.stringify(
      {
        kind: 'host-load-check',
        renderer: rendererName,
        hostLoad: { before, after, valid: before[0] <= 15 && after[0] <= 15 },
        shots,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
