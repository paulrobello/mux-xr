import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.MUX_XR_BASE_URL ?? '';
if (!url)
  throw new Error(
    'Set MUX_XR_BASE_URL to the built app served by the mux streamer with its security headers.',
  );
const output = '.impeccable/review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const errors: string[] = [];
const messages: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') messages.push(m.text().slice(0, 1000));
  });
  page.on('requestfailed', (r) =>
    messages.push(`${r.failure()?.errorText}: ${r.url().slice(0, 200)}`),
  );
  page.on('response', (response) => {
    if (/\.(ttf|woff)(?:$|\?)/i.test(response.url()) && response.status() >= 400)
      messages.push(`Font response ${response.status()}: ${response.url()}`);
  });
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (
      /\.(ttf|woff)(?:$|\?)/i.test(requestUrl.pathname) &&
      requestUrl.origin !== new URL(url).origin
    )
      messages.push(`External font request: ${request.url()}`);
  });
  const response = await page.goto(`${url}/?demo=1`, { waitUntil: 'domcontentloaded' });
  const csp = response?.headers()['content-security-policy'] ?? '';
  const directives = new Map(
    csp.split(';').map((value) => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, sources] as const;
    }),
  );
  const workerSources =
    directives.get('worker-src') ??
    directives.get('child-src') ??
    directives.get('script-src') ??
    directives.get('default-src') ??
    [];
  const strictWorkers =
    workerSources.length > 0 &&
    workerSources.every((source) =>
      ["'self'", "'none'", "'unsafe-inline'", "'wasm-unsafe-eval'"].includes(source),
    );
  if (!strictWorkers || !directives.get('font-src')?.includes("'self'"))
    throw new Error(
      'Production check requires the streamer CSP with blob workers blocked and local fonts allowed.',
    );
  await page.waitForFunction(() => Boolean((window as unknown as { __muxXR?: unknown }).__muxXR));
  await page.locator('[data-action="desktop-preview"]').click();
  const hints = await page.evaluate(() =>
    (
      window as unknown as {
        __muxXR: {
          getControlHints(): Array<{
            label: string;
            inputAction?: string;
            clientX: number;
            clientY: number;
          }>;
        };
      }
    ).__muxXR.getControlHints(),
  );
  const controls = ['Commands', 'Widgets', 'Terminal']
    .map((label) => hints.find((h) => h.label === label && h.inputAction === 'openInput'))
    .filter(Boolean);
  if (controls.length !== 3) throw new Error('Production HUD controls missing');
  let counts: number[] = [];
  const deadline = Date.now() + 10000;
  do {
    counts = await page.evaluate(
      async (targets) =>
        new Promise<number[]>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const canvas = document.querySelector<HTMLCanvasElement>(
                'canvas[aria-label="Mux XR workspace"]',
              );
              const gl = canvas?.getContext('webgl2');
              if (!canvas || !gl) {
                resolve([]);
                return;
              }
              const rect = canvas.getBoundingClientRect();
              resolve(
                targets.map((target) => {
                  const scale = canvas.width / rect.width;
                  const w = Math.round(70 * scale),
                    h = Math.round(20 * scale);
                  const x = Math.max(
                    0,
                    Math.min(
                      canvas.width - w,
                      Math.round((target.clientX - rect.left) * scale - w / 2),
                    ),
                  );
                  const y = Math.max(
                    0,
                    Math.min(
                      canvas.height - h,
                      Math.round(canvas.height - (target.clientY - rect.top) * scale - h / 2),
                    ),
                  );
                  const pixels = new Uint8Array(w * h * 4);
                  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                  let white = 0;
                  for (let i = 0; i < pixels.length; i += 4)
                    if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180) white++;
                  return white;
                }),
              );
            }),
          ),
        ),
      controls as Array<{ clientX: number; clientY: number }>,
    );
    if (counts.length === 3 && counts.every((n) => n > 8)) break;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  const renderer = await page.evaluate(() => {
    const gl = document
      .querySelector<HTMLCanvasElement>('canvas[aria-label="Mux XR workspace"]')
      ?.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await page.screenshot({ path: `${output}/production-labels.png` });
  const labelFailures = messages.filter((message) =>
    /Troika|Creating a worker|Failure loading font|External font|Font response|\/fonts\/|unicode-font-resolver/i.test(
      message,
    ),
  );
  const result = {
    csp,
    kind: 'production-label-pixels',
    url,
    renderer,
    counts,
    errors,
    labelFailures,
    messages,
  };
  console.log(JSON.stringify(result, null, 2));
  await writeFile(`${output}/production-labels.json`, JSON.stringify(result, null, 2));
  if (counts.length !== 3 || counts.some((n) => n <= 8) || errors.length || labelFailures.length)
    throw new Error('Production UI glyph pixels missing or runtime errors');
  if (String(renderer).includes('SwiftShader') || renderer === 'unknown')
    throw new Error('Native renderer unavailable');
  await context.close();
} finally {
  await browser.close();
}
