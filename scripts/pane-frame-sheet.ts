import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Renders the pane frame at a matrix of sizes, curvatures and chin settings with the runtime
 * geometry and material, for a visual review. Usage: bun scripts/pane-frame-sheet.ts [out-dir]
 */
const out = resolve(process.argv[2] ?? 'artifacts/pane-frame-sheet');
const sizes: Array<[string, number, number]> = [
  ['tiny', 0.36, 0.17],
  ['small', 0.71, 0.4],
  ['default', 1.42, 0.8],
  ['tall', 0.9, 1.4],
  ['wide', 4, 2],
  ['huge', 8.5, 3.2],
];
const curvatures = [0, 30, 60, 100];
type Shot = Record<string, unknown> & { name: string };
const shots: Shot[] = [];
for (const [label, width, height] of sizes)
  for (const degrees of curvatures)
    shots.push({ name: `${label}-${degrees}`, width, height, degrees, chin: true });
for (const degrees of [0, 100])
  shots.push(
    { name: `default-${degrees}-nochin`, width: 1.42, height: 0.8, degrees, chin: false },
    {
      name: `default-${degrees}-oblique`,
      width: 1.42,
      height: 0.8,
      degrees,
      chin: true,
      yaw: -38,
      pitch: 14,
    },
    {
      name: `default-${degrees}-corner`,
      width: 1.42,
      height: 0.8,
      degrees,
      chin: true,
      zoom: 'corner',
      yaw: -24,
      pitch: 16,
    },
    {
      name: `default-${degrees}-chin`,
      width: 1.42,
      height: 0.8,
      degrees,
      chin: true,
      zoom: 'chin',
      yaw: -24,
      pitch: -12,
    },
    {
      name: `default-${degrees}-glass`,
      width: 1.42,
      height: 0.8,
      degrees,
      chin: true,
      opacity: 0.4,
    },
  );
shots.push(
  {
    name: 'tiny-100-corner',
    width: 0.36,
    height: 0.17,
    degrees: 100,
    chin: true,
    zoom: 'corner',
    yaw: -24,
    pitch: 16,
  },
  {
    name: 'huge-100-corner',
    width: 8.5,
    height: 3.2,
    degrees: 100,
    chin: true,
    zoom: 'corner',
    yaw: -24,
    pitch: 16,
  },
);

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === 'string') throw new Error('no dev server address');
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args:
    process.env.PW_GPU === 'swiftshader'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  await mkdir(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto(`http://127.0.0.1:${address.port}/scripts/pane-frame-sheet.html`);
  await page.waitForFunction(() => '__frameSheet' in window);
  const rendererName = await page.evaluate(() =>
    (window as unknown as { __frameSheet: { rendererName(): string } }).__frameSheet.rendererName(),
  );
  console.log(`renderer: ${rendererName}`);
  for (const { name, ...shot } of shots) {
    await page.evaluate(
      (value) =>
        (window as unknown as { __frameSheet: { show(shot: unknown): void } }).__frameSheet.show(
          value,
        ),
      shot,
    );
    await page.screenshot({ path: join(out, `${name}.png`) });
  }
  console.log(`${shots.length} frames written to ${out}`);
} finally {
  await browser.close();
  await server.close();
}
