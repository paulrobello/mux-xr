import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type WebSocketRoute } from 'playwright';
import type { FixtureWindow } from './lib/fixture-window';
import { assert, requirePrivateTest, waitFor } from './lib/harness';
import { prepareQuestFixture } from './prepare-quest-fixture';

const { MUX_XR_BASE_URL: BASE_URL, MUX_XR_TEST_ROOT: TEST_ROOT } = requirePrivateTest([
  'MUX_XR_BASE_URL',
  'MUX_XR_TEST_ROOT',
]);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE_URL).hostname))
  throw new Error('auto-entry-check only accepts a loopback BASE_URL');

type Variant = 'allow' | 'deny';

async function buildVariant(root: string, variant: Variant): Promise<void> {
  const shimPath = join(root, 'quest-three-shim.js');
  const shim = await readFile(shimPath, 'utf8');
  const replacement = `const autoXR = { calls: 0, activationAtRequest: [] };
const autoVariant = ${JSON.stringify(variant)};
Object.defineProperty(navigator, 'xr', { configurable: true, value: {
  isSessionSupported: async (mode) => mode === 'immersive-vr',
  requestSession: async (mode) => {
    autoXR.calls += 1;
    autoXR.activationAtRequest.push(navigator.userActivation?.isActive ?? false);
    if (autoVariant === 'deny' && !navigator.userActivation?.isActive) {
      const error = new DOMException('User activation is required', 'NotAllowedError');
      throw error;
    }
    if (mode !== 'immersive-vr') throw new Error('Unexpected XR mode');
    return session;
  },
} });
Object.assign(window, { __autoXR: autoXR });`;
  const rewritten = shim.replace(
    "Object.defineProperty(navigator, 'xr', { configurable: true, value: { requestSession: async () => session } });",
    replacement,
  );
  assert(rewritten !== shim, 'Quest XR shim requestSession hook was not found');
  await writeFile(shimPath, rewritten);
  execFileSync(
    'bun',
    ['build', join(root, 'quest-main.ts'), '--target', 'browser', '--outdir', root],
    {
      cwd: resolve(process.cwd()),
      stdio: 'inherit',
    },
  );
}

async function runVariant(
  baseUrl: string,
  root: string,
  variant: Variant,
): Promise<Record<string, unknown>> {
  prepareQuestFixture(root);
  await buildVariant(root, variant);
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/.*/, (socket: WebSocketRoute) => socket.close());
  try {
    await page.goto(`${baseUrl}/__quest-controls.html?demo=1&auto-entry=${variant}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await waitFor(
      async () =>
        Boolean(await page.evaluate(() => Boolean((window as unknown as FixtureWindow).__muxXR))),
      'Fixture did not initialize',
    );
    await waitFor(
      () =>
        page.evaluate((variant) => {
          const w = window as unknown as FixtureWindow;
          const scene = w.__muxXR.getState().scene;
          return (
            w.__autoXR.calls === 1 &&
            (variant === 'allow'
              ? scene.xrMode === 'vr'
              : Boolean(scene.notice?.includes('Automatic XR entry was blocked')))
          );
        }, variant),
      'Automatic entry attempt did not settle',
    );
    const initial = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const gl = (
        w as unknown as {
          __questRenderer?: { getContext(kind: string): WebGLRenderingContext | null };
        }
      ).__questRenderer?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        calls: w.__autoXR.calls,
        activation: w.__autoXR.activationAtRequest[0],
        backend: debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
        state: w.__muxXR.getState(),
      };
    });
    assert(
      !initial.activation,
      `Fresh page unexpectedly had user activation: ${JSON.stringify(initial)}`,
    );
    assert(
      initial.backend !== 'unknown' && !/swiftshader/i.test(String(initial.backend)),
      `Native renderer unavailable: ${initial.backend}`,
    );
    if (variant === 'allow') {
      assert(
        initial.calls === 1 && initial.state.scene.xrMode === 'vr',
        `Automatic XR entry failed: ${JSON.stringify(initial)}`,
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(
        async () =>
          (await page.evaluate(
            () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode,
          )) === 'vr',
        'Reload did not auto-enter XR',
      );
      const reloaded = await page.evaluate(() => ({
        calls: (window as unknown as FixtureWindow).__autoXR.calls,
        state: (window as unknown as FixtureWindow).__muxXR.getState(),
      }));
      assert(reloaded.calls === 1, `Reload attempted automatic XR ${reloaded.calls} times`);
      assert(errors.length === 0, `Automatic entry page errors: ${errors.join('; ')}`);
      return { variant, initial, reloaded, errors };
    }
    assert(
      initial.calls === 1 && initial.state.scene.xrMode === 'desktop',
      `Denied automatic XR did not remain desktop: ${JSON.stringify(initial)}`,
    );
    const notice =
      initial.state.scene.notice ?? (await page.locator('[data-notice-text]').textContent());
    assert(
      notice?.includes('Automatic XR entry was blocked'),
      `Activation notice missing: ${notice ?? 'none'}`,
    );
    await page.locator('[data-action="xr"]').click();
    await waitFor(
      async () =>
        (await page.evaluate(
          () => (window as unknown as FixtureWindow).__muxXR.getState().scene.xrMode,
        )) === 'vr',
      'Trusted Enter XR fallback failed',
    );
    const activated = await page.evaluate(() => ({
      calls: (window as unknown as FixtureWindow).__autoXR.calls,
      activation: navigator.userActivation?.isActive ?? false,
      state: (window as unknown as FixtureWindow).__muxXR.getState(),
    }));
    assert(
      activated.calls === 2,
      `Trusted fallback expected second requestSession call, got ${activated.calls}`,
    );
    assert(errors.length === 0, `Entry fallback page errors: ${errors.join('; ')}`);
    return { variant, initial, notice, activated, errors };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const root = resolve(TEST_ROOT as string);
  await mkdir(root, { recursive: true });
  const allow = await runVariant(BASE_URL as string, root, 'allow');
  const deny = await runVariant(BASE_URL as string, root, 'deny');
  const result = { kind: 'auto-entry-check', allow, deny };
  console.log(JSON.stringify(result, null, 2));
}

void main();
