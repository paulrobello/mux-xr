import { chromium } from 'playwright';
import type * as Three from 'three';

if (process.env.MUX_XR_PRIVATE_TEST !== '1') {
  throw new Error('Set MUX_XR_PRIVATE_TEST=1 to run the private WebGL terminal shimmer check');
}

const baseUrl = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4241';
const base = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error(`Refusing non-loopback BASE_URL: ${baseUrl}`);
}

type CheckResult = {
  renderer: string;
  baselineTemporalDelta: number;
  filteredTemporalDelta: number;
  temporalImprovement: number;
  nearDirectMeanAbsDelta: number;
  dirtyUploadMeanAbsDelta: number;
  glErrors: number[];
  filterModes: Array<{ mode: string; minFilter: number; anisotropy: number }>;
  gazeLinearMeanAbsDelta: number;
  sharpVsSmoothMeanAbsDelta: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 320, height: 320 },
    deviceScaleFactor: 1,
  });
  const fixtureUrl = new URL('/__terminal-shimmer-check.html', base).href;
  await page.route(fixtureUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body></body></html>',
    }),
  );
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async (): Promise<CheckResult> => {
    const threeModulePath = '/@id/three';
    const terminalTextureModule = '/src/xr/terminal-texture.ts';
    const THREE: typeof import('three') = await import(threeModulePath);
    const terminalMaterialModule = '/src/xr/terminal-material.ts';
    const { createTerminalMaterial, setTerminalMaterialFiltering } = (await import(
      terminalMaterialModule
    )) as typeof import('../src/xr/terminal-material');
    const { createTerminalTexture } = (await import(
      terminalTextureModule
    )) as typeof import('../src/xr/terminal-texture');
    const source = document.createElement('canvas');
    source.width = 256;
    source.height = 256;
    const context = source.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable');
    context.fillStyle = '#101820';
    context.fillRect(0, 0, source.width, source.height);
    context.font = 'bold 11px monospace';
    for (let row = 0; row < 23; row += 1) {
      for (let column = 0; column < 23; column += 1) {
        context.fillStyle = (row + column) % 2 === 0 ? '#44e08a' : '#47a7ff';
        context.fillText(
          `${String(row).padStart(2, '0')}:${String(column).padStart(2, '0')} ▦`,
          column * 11,
          row * 11 + 10,
        );
      }
    }
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setSize(192, 192, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.append(renderer.domElement);
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    if (/swiftshader/i.test(rendererName))
      throw new Error(`SwiftShader is not accepted: ${rendererName}`);

    const baseline = new THREE.CanvasTexture(source);
    baseline.colorSpace = THREE.SRGBColorSpace;
    baseline.minFilter = THREE.LinearFilter;
    baseline.magFilter = THREE.LinearFilter;
    baseline.generateMipmaps = false;
    const dirtyRows = new Uint8Array(23);
    dirtyRows.fill(1);
    const owned = createTerminalTexture({ canvas: source, dirtyRows }, renderer);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = createTerminalMaterial(owned.texture);
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.set(0.22, -0.58, 0);
    const scene = new THREE.Scene();
    scene.add(plane);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 20);
    camera.position.set(0, 0, 2.65);
    const target = new THREE.WebGLRenderTarget(192, 192, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    const glErrors: number[] = [];

    const frame = (texture: Three.Texture, x: number, z: number): Uint8Array => {
      material.map = texture;
      material.needsUpdate = true;
      camera.position.set(x, 0, z);
      camera.lookAt(0, 0, 0);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(192 * 192 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 192, 192, pixels);
      renderer.setRenderTarget(null);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) glErrors.push(error);
      return pixels;
    };
    const delta = (left: Uint8Array, right: Uint8Array): number => {
      let total = 0;
      for (let index = 0; index < left.length; index += 4) {
        total += Math.abs(left[index] - right[index]);
        total += Math.abs(left[index + 1] - right[index + 1]);
        total += Math.abs(left[index + 2] - right[index + 2]);
      }
      return total / ((left.length / 4) * 3);
    };
    const nearDirectMeanAbsDelta = delta(frame(baseline, 0, 0.85), frame(owned.texture, 0, 0.85));
    const positions = Array.from({ length: 12 }, (_, index) => ({
      x: (index - 5.5) * 0.0017,
      z: 2.55 + (index % 3) * 0.035,
    }));
    let baselineTemporalTotal = 0;
    let filteredTemporalTotal = 0;
    let previousBaseline = frame(baseline, positions[0].x, positions[0].z);
    let previousFiltered = frame(owned.texture, positions[0].x, positions[0].z);
    for (const position of positions.slice(1)) {
      const nextBaseline = frame(baseline, position.x, position.z);
      const nextFiltered = frame(owned.texture, position.x, position.z);
      baselineTemporalTotal += delta(previousBaseline, nextBaseline);
      filteredTemporalTotal += delta(previousFiltered, nextFiltered);
      previousBaseline = nextBaseline;
      previousFiltered = nextFiltered;
    }
    const baselineTemporalDelta = baselineTemporalTotal / (positions.length - 1);
    const filteredTemporalDelta = filteredTemporalTotal / (positions.length - 1);
    context.fillStyle = '#ffcc33';
    context.fillRect(0, 44, source.width, 11);
    dirtyRows.fill(0);
    dirtyRows[4] = 1;
    owned.update();
    const fresh = createTerminalTexture({ canvas: source, dirtyRows }, renderer);
    const dirtyUploadMeanAbsDelta = delta(
      frame(owned.texture, 0.006, 2.62),
      frame(fresh.texture, 0.006, 2.62),
    );
    const smooth = frame(owned.texture, 0.006, 2.62);
    const filterModes = [];
    const expectedFilters = [
      THREE.NearestFilter,
      THREE.LinearFilter,
      THREE.LinearMipmapNearestFilter,
      THREE.LinearMipmapLinearFilter,
    ];
    for (const [index, mode] of (
      ['nearest', 'linear', 'mipmap-nearest', 'mipmap-linear'] as const
    ).entries()) {
      owned.setFiltering({ mode, anisotropy: 16, gazeClarity: true });
      frame(owned.texture, 0.006, 2.62);
      if (owned.texture.minFilter !== expectedFilters[index])
        throw new Error(`Wrong sampler: ${mode}`);
      filterModes.push({
        mode,
        minFilter: owned.texture.minFilter,
        anisotropy: owned.texture.anisotropy,
      });
    }
    owned.setFiltering({ mode: 'mipmap-linear', anisotropy: 4, gazeClarity: true });
    const gazeVersion = owned.texture.version;
    setTerminalMaterialFiltering(
      material,
      { mode: 'mipmap-linear', anisotropy: 4, gazeClarity: true },
      true,
    );
    if (owned.texture.version !== gazeVersion) throw new Error('Gaze caused a texture reupload');
    const gazePixels = frame(owned.texture, 0.006, 2.62);
    const freshLinear = createTerminalTexture({ canvas: source, dirtyRows }, renderer);
    freshLinear.setFiltering({ mode: 'linear', anisotropy: 4, gazeClarity: false });
    setTerminalMaterialFiltering(
      material,
      { mode: 'linear', anisotropy: 4, gazeClarity: false },
      false,
    );
    const gazeLinearMeanAbsDelta = delta(gazePixels, frame(freshLinear.texture, 0.006, 2.62));
    const sharpVsSmoothMeanAbsDelta = delta(gazePixels, smooth);
    freshLinear.dispose();
    target.dispose();
    geometry.dispose();
    material.dispose();
    baseline.dispose();
    owned.dispose();
    fresh.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    return {
      renderer: rendererName,
      baselineTemporalDelta,
      filteredTemporalDelta,
      temporalImprovement: baselineTemporalDelta - filteredTemporalDelta,
      nearDirectMeanAbsDelta,
      dirtyUploadMeanAbsDelta,
      glErrors,
      filterModes,
      gazeLinearMeanAbsDelta,
      sharpVsSmoothMeanAbsDelta,
    };
  });
  assert(result.glErrors.length === 0, `WebGL errors: ${result.glErrors.join(', ')}`);
  assert(
    result.nearDirectMeanAbsDelta <= 0.1,
    `Near-field filtered texture diverged from baseline: ${JSON.stringify(result)}`,
  );
  assert(
    result.dirtyUploadMeanAbsDelta <= 0.1,
    `Dirty upload produced stale mip data: ${JSON.stringify(result)}`,
  );
  assert(
    result.filteredTemporalDelta < result.baselineTemporalDelta,
    `Filtered shimmer did not improve: ${JSON.stringify(result)}`,
  );
  assert(
    result.gazeLinearMeanAbsDelta <= 0.1,
    `Gaze policy differs from linear: ${JSON.stringify(result)}`,
  );
  assert(
    result.sharpVsSmoothMeanAbsDelta > 0.1,
    'Sharp and smooth filters did not change actual pixels',
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
