import type { Page } from 'playwright';
import type { FixtureWindow } from './lib/fixture-window';
import { assert, launchGpuBrowser, openApp, requirePrivateTest, waitFor } from './lib/harness';

/**
 * Drives the real WebGL context through loseContext() and restoreContext() on the demo workspace.
 * Desktop Chromium proves the non-immersive path only: how an XRSession reacts to context loss
 * differs per browser and needs a headset.
 */

const NOTICE = 'The headset reclaimed graphics memory. Restoring the workspace.';

const { MUX_XR_BASE_URL: baseUrl } = requirePrivateTest(['MUX_XR_BASE_URL']);
const base = new URL(baseUrl);
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
  `Refusing non-loopback MUX_XR_BASE_URL: ${baseUrl}`,
);

const notice = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as unknown as FixtureWindow).__muxXR.getState().scene.notice);

/**
 * The scene host also holds 2D terminal canvases, so the renderer's canvas is the one that hands
 * out a WebGL2 context. Each page.evaluate below runs in the page, so it carries its own lookup.
 */
const centreAlpha = (page: Page): Promise<number> =>
  page.evaluate(() => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-scene-host] canvas')) {
      const gl = canvas.getContext('webgl2');
      if (!gl) continue;
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return pixel[0] + pixel[1] + pixel[2] + pixel[3];
    }
    return -1;
  });

const browser = await launchGpuBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, new URL('/?demo=1', base).href);
  await waitFor(
    () =>
      page.evaluate(
        () => typeof (window as unknown as FixtureWindow).__muxXR?.getThreeScene === 'function',
      ),
    'the app test hooks',
  );
  await waitFor(() => page.locator('[data-scene-host] canvas').count(), 'the scene canvas');

  const lost = await page.evaluate(() => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-scene-host] canvas')) {
      const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      if (!extension) continue;
      (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext = extension;
      extension.loseContext();
      return true;
    }
    return false;
  });
  assert(lost, 'WEBGL_lose_context is unavailable in this browser');
  await waitFor(async () => (await notice(page)) === NOTICE, 'the context-loss notice');

  await page.evaluate(() =>
    (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext.restoreContext(),
  );
  await waitFor(async () => (await notice(page)) === null, 'the notice to clear after restore');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const alpha = await waitFor(async () => (await centreAlpha(page)) > 0, 'a drawn centre pixel');
  assert(alpha, 'The scene did not redraw after the context was restored');
  assert(errors.length === 0, `Page errors during context loss: ${errors.join('; ')}`);
  console.log('context-loss-check passed: notice shown on loss, cleared on restore, scene redrawn');
} finally {
  await browser.close();
}
