import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Renders outside-program toast cards at every level and placement with real Troika text in GPU
// Chromium. Toasts are pushed straight into the layer, so nothing reaches the host service.
const SHOTS = process.env.MUX_XR_SHOTS ?? '/tmp/xr-toast-shots';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'mux-xr-toast-shots-'));
mkdirSync(SHOTS, { recursive: true });
const entry = join(root, 'toast-entry.ts');
writeFileSync(
  entry,
  `import * as THREE from ${JSON.stringify(join(repoRoot, 'node_modules/three/build/three.module.js'))};
import { createMessageToastLayer } from ${JSON.stringify(join(repoRoot, 'src/xr/message-toasts.ts'))};
import { waitForLabelSync } from ${JSON.stringify(join(repoRoot, 'src/xr/labels.ts'))};
import { parseToastRequest } from ${JSON.stringify(join(repoRoot, 'src/toast-contract.ts'))};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(2);
renderer.setSize(960, 720);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3540);
const camera = new THREE.PerspectiveCamera(62, 960 / 720, 0.01, 20);
camera.position.set(0, 1.6, 0);
scene.add(camera);
// Stand-ins for the HUD bar and a terminal panel, so anchored stacks have something to sit on.
const hud = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 0.15), new THREE.MeshBasicMaterial({ color: 0x0d1720 }));
hud.scale.setScalar(0.62);
const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), new THREE.MeshBasicMaterial({ color: 0x0b0f12 }));
scene.add(hud, pane);
let layer = null;
let next = 0;
const gl = renderer.getContext();
const info = gl.getExtension('WEBGL_debug_renderer_info');
window.__toasts = {
  renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
  async show(spec) {
    if (layer) { layer.root.removeFromParent(); layer.dispose(); }
    layer = createMessageToastLayer();
    scene.add(layer.root);
    hud.visible = spec.hud;
    pane.visible = spec.pane;
    hud.position.set(0, 1.18, -1.35);
    pane.position.set(spec.paneX ?? 0, 1.35, -2);
    for (const body of spec.toasts) {
      const parsed = parseToastRequest(body, () => 'shot-' + ++next);
      if (!parsed.ok) throw new Error(parsed.error);
      layer.apply(parsed.value, 0);
    }
    const anchors = {
      camera,
      hud: spec.hud ? hud : null,
      pane: () => (spec.pane ? { object: pane, top: 0.35 } : null),
    };
    layer.update(0, 0, anchors);
    await new Promise((done) => setTimeout(done, 0));
    const labels = [];
    layer.root.traverse((object) => { if (object.userData.disposeLabel && object.parent?.visible) labels.push(object); });
    const stalled = [];
    await Promise.all(labels.map((label) => Promise.race([
      waitForLabelSync(label),
      new Promise((done) => setTimeout(() => { stalled.push(label.name); done(); }, 20000)),
    ])));
    layer.update(0, 0, anchors);
    renderer.render(scene, camera);
    return { stalled, shown: layer.shown() };
  },
};
`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', root], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(
  join(root, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="./toast-entry.js"></script></body></html>',
);

type Spec = { hud: boolean; pane: boolean; paneX?: number; toasts: Array<Record<string, unknown>> };
const states: Record<string, Spec> = {
  'view-levels': {
    hud: false,
    pane: false,
    toasts: [
      {
        level: 'info',
        title: 'Backup',
        message: 'Nightly backup started on backup-host.',
        source: 'cron',
      },
      { level: 'success', title: 'CI', message: 'mux-xr main passed in 4m 12s.', source: 'gh' },
      { level: 'warn', title: 'Disk', message: 'Macintosh HD is 91% full.' },
      {
        level: 'error',
        title: 'Deploy failed',
        message:
          'build-host-2 rejected the release: health check timed out after 30 s. Rolled back to the previous build.',
        placement: 'center',
        source: 'deploy',
      },
      {
        level: 'info',
        message: 'A custom-colored note with no title.',
        color: '#b48cff',
        placement: 'bottom',
      },
    ],
  },
  'hud-and-pane': {
    hud: true,
    pane: true,
    toasts: [
      {
        level: 'warn',
        title: 'Agent',
        message: 'claude in %12 is waiting for an answer.',
        placement: 'pane',
      },
      { level: 'success', message: 'Tests passed (412).', placement: 'hud', source: 'make' },
      { level: 'info', message: 'Pulled 3 commits.', placement: 'hud' },
    ],
  },
  'missing-anchors-fall-back': {
    hud: false,
    pane: false,
    toasts: [
      {
        level: 'error',
        message: 'Pane toast with its pane closed falls back to the top.',
        placement: 'pane',
      },
    ],
  },
};

const server = createServer((request, response) => {
  const url = request.url ?? '';
  const font = /^\/fonts\/([\w.-]+\.ttf)$/.exec(url)?.[1];
  const name = url === '/' ? 'index.html' : url.replace(/^\//, '');
  if (!font && !/^[\w.-]+$/.test(name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = readFileSync(font ? join(repoRoot, 'public/fonts', font) : join(root, name));
    response.writeHead(200, {
      'content-type': font ? 'font/ttf' : name.endsWith('.js') ? 'text/javascript' : 'text/html',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('no server address');

const before = loadavg();
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => '__toasts' in window);
  const shots: string[] = [];
  for (const [name, spec] of Object.entries(states)) {
    const result = await page.evaluate(
      (spec) =>
        (
          window as unknown as {
            __toasts: {
              show(spec: unknown): Promise<{ stalled: string[]; shown: Record<string, string[]> }>;
            };
          }
        ).__toasts.show(spec),
      spec,
    );
    if (result.stalled.length)
      errors.push(`${name}: labels never synced: ${result.stalled.join(', ')}`);
    const expected = spec.toasts.length;
    const counted = Object.values(result.shown).flat().length;
    if (counted !== expected) errors.push(`${name}: ${counted} cards shown, expected ${expected}`);
    const path = join(SHOTS, `toast-${name}.png`);
    await page.screenshot({ path });
    shots.push(path);
  }
  const rendererName = await page.evaluate(
    () => (window as unknown as { __toasts: { renderer: string } }).__toasts.renderer,
  );
  console.log(
    JSON.stringify(
      {
        kind: 'toast-shots',
        renderer: rendererName,
        load: { before, after: loadavg() },
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
}
