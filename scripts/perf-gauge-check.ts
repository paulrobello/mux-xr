import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Microbenchmarks the performance gauge's 2 Hz update path in native-GPU Chromium with real
// Troika typesetting, and writes screenshots of the gauge at each FPS tone.
const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
const SHOTS = process.env.MUX_XR_SHOTS ?? '/tmp/perf-gauge-shots';
const ITERATIONS = Number(process.env.MUX_XR_ITERATIONS ?? 400);
if (!BASE_URL || !TEST_ROOT || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error('Perf gauge check requires MUX_XR_PRIVATE_TEST=1, BASE_URL, and TEST_ROOT');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE_URL).hostname))
  throw new Error('Perf gauge check is loopback-only');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(TEST_ROOT);
mkdirSync(root, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const entry = join(root, 'perf-gauge-entry.ts');
writeFileSync(
  entry,
  `import * as THREE from ${JSON.stringify(join(repoRoot, 'node_modules/three/build/three.module.js'))};
import { createPerfGaugeWidget } from ${JSON.stringify(join(repoRoot, 'src/xr/perf-gauge.ts'))};
import { waitForLabelSync } from ${JSON.stringify(join(repoRoot, 'src/xr/labels.ts'))};
import { createUIEnvironment } from ${JSON.stringify(join(repoRoot, 'src/xr/ui-environment.ts'))};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(2);
renderer.setSize(640, 400);
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
const camera = new THREE.PerspectiveCamera(30, 640 / 400, 0.01, 10);
camera.position.set(0, 0, 0.82);
let widget = createPerfGaugeWidget(env.texture);
scene.add(widget.root);
const labels = () => {
  const out = [];
  widget.root.traverse((object) => { if (object.userData.disposeLabel) out.push(object); });
  return out;
};
const synced = () => Promise.all(labels().map((label) => waitForLabelSync(label)));
const gl = renderer.getContext();
const info = gl.getExtension('WEBGL_debug_renderer_info');
window.__gauge = {
  renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
  async show(samples) {
    widget.root.removeFromParent();
    widget.dispose();
    widget = createPerfGaugeWidget(env.texture);
    scene.add(widget.root);
    for (const sample of samples) widget.setPerfSample(sample);
    await synced();
    renderer.render(scene, camera);
  },
  async bench(iterations) {
    const sample = { fps: 72, worstFrameMs: 14, shownPanes: 6, targetHz: 72 };
    for (let index = 0; index < 20; index += 1) {
      widget.setPerfSample({ ...sample, fps: 60 + (index % 13), worstFrameMs: 12 + index });
      await synced();
    }
    // performance.now() is coarsened to 100 us here, so time batches and divide.
    const batch = 20;
    const changedTotal = [];
    const unchanged = [];
    const render = [];
    let step = 0;
    const next = () => {
      step += 1;
      // Every readout changes: the worst case for typesetting.
      return { fps: 50 + (step % 23), worstFrameMs: 300 + step * 0.37, shownPanes: step % 19, targetHz: 72 };
    };
    for (let round = 0; round < iterations / batch; round += 1) {
      let start = performance.now();
      for (let index = 0; index < batch; index += 1) {
        widget.setPerfSample(next());
        await synced();
      }
      changedTotal.push((performance.now() - start) / batch);
      const same = next();
      widget.setPerfSample(same);
      await synced();
      start = performance.now();
      for (let index = 0; index < batch; index += 1) widget.setPerfSample(same);
      unchanged.push((performance.now() - start) / batch);
      start = performance.now();
      for (let index = 0; index < batch; index += 1) renderer.render(scene, camera);
      gl.finish();
      render.push((performance.now() - start) / batch);
    }
    const stats = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const us = (ms) => Number((ms * 1000).toFixed(1));
      return { batches: values.length, batchSize: batch, meanUs: us(mean), p50Us: us(pick(0.5)), p95Us: us(pick(0.95)), maxUs: us(sorted[sorted.length - 1]) };
    };
    return {
      changedTextUntilTypesetUs: stats(changedTotal),
      unchangedTextUs: stats(unchanged),
      gaugeOnlySceneRenderUs: stats(render),
    };
  },
};
`,
);
execFileSync('bun', ['build', entry, '--target', 'browser', '--outdir', root], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(
  join(root, '__perf-gauge.html'),
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="./perf-gauge-entry.js"></script></body></html>',
);

const history = (count: number, base: number, spread: number, spike = 0) =>
  Array.from(
    { length: count },
    (_, index) => base + ((index * 7) % 5) * spread + (index === count - 6 ? spike : 0),
  );
const tones = {
  good: { fps: 72, targetHz: 72, panes: 6, frames: history(40, 13.6, 0.3, 9) },
  warn: { fps: 61, targetHz: 72, panes: 12, frames: history(40, 15.5, 1.6, 14) },
  bad: { fps: 41, targetHz: 72, panes: 18, frames: history(40, 22, 3.5, 30) },
};

const before = loadavg();
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${BASE_URL}/__perf-gauge.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => '__gauge' in window);
  const shots: string[] = [];
  for (const [tone, spec] of Object.entries(tones)) {
    await page.evaluate(
      (spec) =>
        (
          window as unknown as { __gauge: { show(samples: unknown[]): Promise<void> } }
        ).__gauge.show(
          spec.frames.map((worstFrameMs) => ({
            fps: spec.fps,
            worstFrameMs,
            shownPanes: spec.panes,
            targetHz: spec.targetHz,
          })),
        ),
      spec,
    );
    const path = join(SHOTS, `perf-gauge-${tone}.png`);
    await page.screenshot({ path });
    shots.push(path);
  }
  const rendererName = await page.evaluate(
    () => (window as unknown as { __gauge: { renderer: string } }).__gauge.renderer,
  );
  const bench = await page.evaluate(
    (iterations) =>
      (window as unknown as { __gauge: { bench(n: number): Promise<unknown> } }).__gauge.bench(
        iterations,
      ),
    ITERATIONS,
  );
  const after = loadavg();
  console.log(
    JSON.stringify(
      {
        kind: 'perf-gauge-check',
        renderer: rendererName,
        iterations: ITERATIONS,
        hostLoad: { before, after, valid: before[0] <= 15 && after[0] <= 15 },
        bench,
        shots,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  if (before[0] > 15 || after[0] > 15)
    throw new Error(
      `host 1-minute load exceeded 15 (before ${before[0].toFixed(2)}, after ${after[0].toFixed(2)}); discard this sample`,
    );
} finally {
  await browser.close();
}
