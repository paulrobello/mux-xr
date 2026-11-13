import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { BACKGROUND_MODES, type BackgroundMode } from '../src/contracts';

/**
 * Renders every world background from the standing eye into the picker thumbnails served from
 * /assets/backgrounds. Usage: bun scripts/background-thumbnails.ts [mode ...]
 */
type ThumbnailWindow = Window & {
  __backgroundThumbnails: {
    render(mode: BackgroundMode): Promise<string>;
    rendererName(): string;
  };
};

const out = resolve('public/assets/backgrounds');
const requested = process.argv.slice(2);
const modes = requested.length
  ? BACKGROUND_MODES.filter((mode) => requested.includes(mode))
  : [...BACKGROUND_MODES];
if (requested.length && modes.length !== requested.length)
  throw new Error(`Unknown background in: ${requested.join(', ')}`);

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
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(`http://127.0.0.1:${address.port}/scripts/background-thumbnails.html`);
  await page.waitForFunction(() => '__backgroundThumbnails' in window);
  console.log(
    `renderer: ${await page.evaluate(() => (window as unknown as ThumbnailWindow).__backgroundThumbnails.rendererName())}`,
  );
  for (const mode of modes) {
    const url = await page.evaluate(
      (value) => (window as unknown as ThumbnailWindow).__backgroundThumbnails.render(value),
      mode,
    );
    if (!url.startsWith('data:image/webp;base64,')) throw new Error(`${mode}: not a WebP capture`);
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    await writeFile(join(out, `${mode}.webp`), bytes);
    console.log(`${mode}.webp ${bytes.length} bytes`);
  }
  if (errors.length) throw errors[0];
} finally {
  await browser.close();
  await server.close();
}
