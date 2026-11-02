import { chromium } from 'playwright';
import type * as Three from 'three';

if (process.env.MUX_XR_PRIVATE_TEST !== '1') {
  throw new Error('Set MUX_XR_PRIVATE_TEST=1 to run the private WebGL terminal opacity check');
}

const baseUrl = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4241';
const base = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error(`Refusing non-loopback BASE_URL: ${baseUrl}`);
}

type CheckResult = {
  renderer: string;
  defaultPixels: number[];
  halfPixels: number[];
  tenthPixels: number[];
  glErrors: number[];
  textureVersion: number;
  materialVersion: number;
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
  const fixtureUrl = new URL('/__terminal-opacity-check.html', base).href;
  await page.route(fixtureUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body></body></html>',
    }),
  );
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async (): Promise<CheckResult> => {
    function assert(condition: unknown, message: string): asserts condition {
      if (!condition) throw new Error(message);
    }
    const bundle = '/opacity-entry.js';
    const THREE: typeof import('three') = await import(bundle);
    const { createTerminalMaterial, setTerminalBackgroundOpacity } = (await import(
      bundle
    )) as typeof import('../src/xr/terminal-material');

    const source = document.createElement('canvas');
    source.width = 5;
    source.height = 1;
    const context = source.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable');
    const colors = ['#000000', '#ffffff', '#00ff00', '#0000ff', '#333333'];
    for (const [index, color] of colors.entries()) {
      context.fillStyle = color;
      context.fillRect(index, 0, 1, 1);
    }
    context.fillStyle = '#000000';
    context.fillRect(0, 1, 1, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setSize(320, 80, false);
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

    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const material = createTerminalMaterial(texture);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const plane = new THREE.Mesh(geometry, material);
    const scene = new THREE.Scene();
    scene.add(plane);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const target = new THREE.WebGLRenderTarget(320, 80, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    renderer.setClearColor(new THREE.Color('#204060'), 1);
    const glErrors: number[] = [];
    const readPixels = (): number[] => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(320 * 80 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 320, 80, pixels);
      renderer.setRenderTarget(null);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) glErrors.push(error);
      return [
        ...[0, 1, 2, 3, 4].flatMap((column) => {
          const index = (40 * 320 + (column * 64 + 32)) * 4;
          return [pixels[index], pixels[index + 1], pixels[index + 2]];
        }),
      ];
    };

    const defaultPixels = readPixels();
    setTerminalBackgroundOpacity(material, 0.5);
    const halfPixels = readPixels();
    const textureVersion = texture.version;
    const materialVersion = material.version;
    setTerminalBackgroundOpacity(material, 0.4);
    setTerminalBackgroundOpacity(material, 0.1);
    const tenthPixels = readPixels();
    assert(texture.version === textureVersion, 'Opacity updates changed texture version');
    assert(
      material.version === materialVersion,
      'Repeated non-opaque opacity changed material version',
    );
    setTerminalBackgroundOpacity(material, 1);
    const restoredPixels = readPixels();
    assert(
      restoredPixels.every((value, index) => Math.abs(value - defaultPixels[index]) <= 1),
      'Opacity 1 differs from default opaque output',
    );

    geometry.dispose();
    material.dispose();
    texture.dispose();
    target.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    return {
      renderer: rendererName,
      defaultPixels,
      halfPixels,
      tenthPixels,
      glErrors,
      textureVersion,
      materialVersion,
    };
  });

  const pixel = (values: number[], column: number): number[] =>
    values.slice(column * 3, column * 3 + 3);
  const backgroundDefault = pixel(result.defaultPixels, 0);
  const backgroundHalf = pixel(result.halfPixels, 0);
  const backgroundTenth = pixel(result.tenthPixels, 0);
  const whiteDefault = pixel(result.defaultPixels, 1);
  const whiteHalf = pixel(result.halfPixels, 1);
  const greenDefault = pixel(result.defaultPixels, 2);
  const greenHalf = pixel(result.halfPixels, 2);
  const blueDefault = pixel(result.defaultPixels, 3);
  const blueHalf = pixel(result.halfPixels, 3);
  const grayDefault = pixel(result.defaultPixels, 4);
  const grayHalf = pixel(result.halfPixels, 4);
  const delta = (left: number[], right: number[]): number =>
    left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0);
  assert(
    delta(backgroundDefault, backgroundHalf) > 5,
    `Dark background did not change at opacity .5: ${JSON.stringify(result)}`,
  );
  assert(
    delta(backgroundHalf, backgroundTenth) > 2,
    `Dark background did not respond to opacity .1: ${JSON.stringify(result)}`,
  );
  for (const [name, before, after] of [
    ['white', whiteDefault, whiteHalf],
    ['green', greenDefault, greenHalf],
    ['blue', blueDefault, blueHalf],
    ['dimgray', grayDefault, grayHalf],
  ] as const) {
    assert(
      delta(before, after) <= 2,
      `${name} foreground changed with opacity: ${JSON.stringify(result)}`,
    );
  }
  assert(result.glErrors.length === 0, `WebGL errors: ${result.glErrors.join(', ')}`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
