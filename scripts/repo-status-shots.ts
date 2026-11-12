import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Renders the Git & CI widget in each state with real Troika text in GPU Chromium. The status
// source is a stub, so nothing reaches the dictation server, git or gh.
const SHOTS = process.env.MUX_XR_SHOTS ?? '/tmp/git-ci-shots';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'mux-xr-repo-status-shots-'));
mkdirSync(SHOTS, { recursive: true });
const entry = join(root, 'repo-status-entry.ts');
writeFileSync(
  entry,
  `import * as THREE from ${JSON.stringify(join(repoRoot, 'node_modules/three/build/three.module.js'))};
import { createRepoStatusWidget } from ${JSON.stringify(join(repoRoot, 'src/xr/repo-status-widget.ts'))};
import { waitForLabelSync } from ${JSON.stringify(join(repoRoot, 'src/xr/labels.ts'))};
import { createUIEnvironment } from ${JSON.stringify(join(repoRoot, 'src/xr/ui-environment.ts'))};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(2);
renderer.setSize(640, 360);
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
const camera = new THREE.PerspectiveCamera(30, 640 / 360, 0.01, 10);
camera.position.set(0, 0, 0.6);
let widget = null;
const gl = renderer.getContext();
const info = gl.getExtension('WEBGL_debug_renderer_info');
window.__repo = {
  renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
  async show(spec) {
    if (widget) { widget.root.removeFromParent(); widget.dispose(); }
    const fetchStatus = spec.result ? async () => spec.result : () => new Promise(() => undefined);
    widget = createRepoStatusWidget(env.texture, { fetchStatus, pageHidden: () => false });
    scene.add(widget.root);
    if (spec.pane) widget.setFocusedPane(spec.pane, spec.cwd ?? null);
    await new Promise((done) => setTimeout(done, 0));
    const labels = [];
    widget.root.traverse((object) => { if (object.userData.disposeLabel) labels.push(object); });
    const stalled = [];
    await Promise.all(labels.map((label) => Promise.race([
      waitForLabelSync(label),
      new Promise((done) => setTimeout(() => { stalled.push(label.name + '=' + JSON.stringify(label.userData.labelText)); done(); }, 20000)),
    ])));
    renderer.render(scene, camera);
    return stalled;
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
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="./repo-status-entry.js"></script></body></html>',
);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ok = (overrides: Record<string, unknown>, ci: Record<string, unknown> | null) => ({
  ok: true,
  report: {
    state: 'ok',
    repo: 'mux-xr',
    branch: 'main',
    detached: false,
    upstream: true,
    ahead: 0,
    behind: 0,
    dirty: false,
    ...overrides,
    ci: ci && { conclusion: null, status: null, workflow: 'CI', createdAt: minutesAgo(7), ...ci },
  },
});
const states: Record<string, { pane?: string; cwd?: string; result?: unknown }> = {
  'no-pane': {},
  'unknown-cwd': { pane: 'p1' },
  loading: { pane: 'p1', cwd: '/Users/me/mux-xr' },
  'not-a-repo': {
    pane: 'p1',
    cwd: '/Users/me',
    result: { ok: true, report: { state: 'not-a-repo' } },
  },
  'remote-shell': {
    pane: 'p1',
    cwd: '/home/me/mux-xr',
    result: { ok: true, report: { state: 'remote' } },
  },
  'unavailable-unpaired': {
    pane: 'p1',
    cwd: '/Users/me/mux-xr',
    result: { ok: false, code: 'no-secret' },
  },
  'ci-success-clean': {
    pane: 'p1',
    cwd: '/Users/me/mux-xr',
    result: ok({}, { state: 'success', conclusion: 'success', status: 'completed' }),
  },
  'ci-failure-dirty': {
    pane: 'p1',
    cwd: '/Users/me/mux-xr',
    result: ok(
      { branch: 'feat/git-ci-widget', dirty: true, ahead: 3, behind: 1 },
      { state: 'failure', conclusion: 'failure', status: 'completed', createdAt: minutesAgo(42) },
    ),
  },
  'ci-in-progress': {
    pane: 'p1',
    cwd: '/Users/me/mux-xr',
    result: ok(
      { ahead: 1 },
      { state: 'in_progress', status: 'in_progress', createdAt: minutesAgo(2) },
    ),
  },
  'ci-unknown-no-upstream': {
    pane: 'p1',
    cwd: '/Users/me/mux-xr',
    result: ok(
      { upstream: false, branch: 'spike' },
      { state: 'unknown', workflow: null, createdAt: null },
    ),
  },
  'ci-unavailable': { pane: 'p1', cwd: '/Users/me/mux-xr', result: ok({ dirty: true }, null) },
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
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => '__repo' in window);
  const shots: string[] = [];
  for (const [name, spec] of Object.entries(states)) {
    const stalled = await page.evaluate(
      (spec) =>
        (window as unknown as { __repo: { show(spec: unknown): Promise<string[]> } }).__repo.show(
          spec,
        ),
      spec,
    );
    if (stalled.length) errors.push(`${name}: labels never synced: ${stalled.join(', ')}`);
    const path = join(SHOTS, `repo-status-${name}.png`);
    await page.screenshot({ path });
    shots.push(path);
  }
  const rendererName = await page.evaluate(
    () => (window as unknown as { __repo: { renderer: string } }).__repo.renderer,
  );
  console.log(
    JSON.stringify(
      {
        kind: 'repo-status-shots',
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
