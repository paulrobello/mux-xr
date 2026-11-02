import { chromium } from 'playwright';

if (process.env.MUX_XR_PRIVATE_TEST !== '1') {
  throw new Error('Set MUX_XR_PRIVATE_TEST=1 to run the private WebGL terminal texture check');
}

const baseUrl = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4241';
const base = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error(`Refusing non-loopback BASE_URL: ${baseUrl}`);
}

type CheckResult = {
  renderer: string;
  nonzeroPixels: number;
  maxDelta: number;
  glErrors: number[];
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
  const fixtureUrl = new URL('/__terminal-texture-check.html', base).href;
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
    const THREE: typeof import('three') = await import(threeModulePath);
    const terminalTextureModule = '/src/xr/terminal-texture.ts';
    const { createTerminalTexture } = (await import(
      terminalTextureModule
    )) as typeof import('../src/xr/terminal-texture');

    const source = document.createElement('canvas');
    source.width = 8;
    source.height = 8;
    const context = source.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable');
    context.fillStyle = '#e53935';
    context.fillRect(0, 0, 4, 4);
    context.fillStyle = '#43a047';
    context.fillRect(4, 0, 4, 4);
    context.fillStyle = '#1e88e5';
    context.fillRect(0, 4, 4, 4);
    context.fillStyle = '#fdd835';
    context.fillRect(4, 4, 4, 4);
    context.fillStyle = '#101820';
    context.font = 'bold 3px sans-serif';
    context.fillText('XR', 1, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setSize(64, 64, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1);
    document.body.append(renderer.domElement);
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    if (/swiftshader/i.test(rendererName))
      throw new Error(`SwiftShader is not accepted: ${rendererName}`);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    const scene = new THREE.Scene();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    scene.add(plane);
    const target = new THREE.WebGLRenderTarget(64, 64, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    const glErrors: number[] = [];
    let nonzeroPixels = 0;
    let maxDelta = 0;

    const draw = (texture: import('three').Texture): Uint8Array => {
      plane.material = new THREE.MeshBasicMaterial({ map: texture });
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const pixels = new Uint8Array(64 * 64 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) glErrors.push(error);
      plane.material.dispose();
      return pixels;
    };
    const compare = (left: Uint8Array, right: Uint8Array, label: string): void => {
      for (let index = 0; index < left.length; index += 1) {
        const delta = Math.abs(left[index] - right[index]);
        maxDelta = Math.max(maxDelta, delta);
        if (left[index] !== 0) nonzeroPixels += 1;
        if (delta > 1)
          throw new Error(`${label} differs at byte ${index}: ${left[index]} vs ${right[index]}`);
      }
    };

    const dirtyRows = new Uint8Array([1, 1, 1, 1]);
    const makeReference = (): import('three').CanvasTexture => {
      const next = new THREE.CanvasTexture(source);
      next.colorSpace = THREE.SRGBColorSpace;
      next.minFilter = THREE.LinearFilter;
      next.magFilter = THREE.LinearFilter;
      next.generateMipmaps = false;
      return next;
    };
    let reference = makeReference();
    const owned = createTerminalTexture(
      {
        canvas: source,
        dirtyRows,
      },
      renderer,
    );
    compare(draw(reference), draw(owned.texture), 'initial orientation');

    dirtyRows.fill(0);
    dirtyRows[1] = 1;
    context.fillStyle = '#8e24aa';
    context.fillRect(0, 2, 8, 2);
    reference.needsUpdate = true;
    owned.update();
    compare(draw(reference), draw(owned.texture), 'one dirty row');

    dirtyRows.fill(0);
    dirtyRows[0] = 1;
    context.fillStyle = '#6d4c41';
    context.fillRect(0, 0, 8, 2);
    reference.needsUpdate = true;
    owned.update();
    dirtyRows.fill(0);
    dirtyRows[2] = 1;
    context.fillStyle = '#00897b';
    context.fillRect(0, 4, 8, 2);
    reference.needsUpdate = true;
    owned.update();
    compare(draw(reference), draw(owned.texture), 'accumulated dirty rows');

    owned.texture.repeat.set(0.5, 0.5);
    owned.texture.offset.set(0.25, 0.25);
    reference.repeat.copy(owned.texture.repeat);
    reference.offset.copy(owned.texture.offset);
    source.width = 16;
    source.height = 8;
    context.fillStyle = '#3949ab';
    context.fillRect(0, 0, 16, 8);
    reference.dispose();
    reference = makeReference();
    reference.repeat.copy(owned.texture.repeat);
    reference.offset.copy(owned.texture.offset);
    reference.needsUpdate = true;
    owned.update();
    reference.needsUpdate = true;
    compare(draw(reference), draw(owned.texture), 'resize and UV transform');

    if (glErrors.length) throw new Error(`WebGL errors: ${glErrors.join(', ')}`);
    target.dispose();
    plane.geometry.dispose();
    renderer.dispose();
    owned.dispose();
    reference.dispose();
    renderer.domElement.remove();
    return { renderer: rendererName, nonzeroPixels, maxDelta, glErrors };
  });
  assert(result.nonzeroPixels > 0, 'Rendered output contained no nonzero pixels');
  assert(result.maxDelta <= 1, `Maximum rendered delta exceeded tolerance: ${result.maxDelta}`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
