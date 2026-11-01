import { cpSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.MUX_XR_BASE_URL;
const root = process.env.MUX_XR_UPDATE_TEST_ROOT;
if (process.env.MUX_XR_PRIVATE_TEST !== '1' || !url || !root)
  throw new Error('Use an isolated update test root and MUX_XR_PRIVATE_TEST=1');
const current = JSON.parse(readFileSync(join(root, 'served/version.json'), 'utf8')) as {
  buildId: string;
};
const next = JSON.parse(readFileSync(join(root, 'next/version.json'), 'utf8')) as {
  buildId: string;
};
if (current.buildId === next.buildId) throw new Error('Update fixture builds must differ');
await mkdir('.impeccable/review', { recursive: true });
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  let navigations = 0;
  let polls = 0;
  const errors: string[] = [];
  const messages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') messages.push(message.text());
  });
  page.on('requestfailed', (request) =>
    messages.push(`${request.failure()?.errorText}: ${request.url()}`),
  );
  page.on('response', (response) => {
    if (/\.(js|css|ttf|woff)(?:$|\?)/i.test(response.url()) && response.status() >= 400)
      errors.push(`Asset ${response.status()}: ${response.url()}`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/version.json') polls += 1;
  });
  await page.goto(`${url}/?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as unknown as { __muxXR?: unknown }).__muxXR));
  const buildId = () =>
    page.evaluate(
      () =>
        (window as unknown as { __muxXR: { getState(): { buildId: string } } }).__muxXR.getState()
          .buildId,
    );
  if ((await buildId()) !== current.buildId)
    throw new Error('Embedded build does not match served manifest');
  await page.evaluate(() =>
    (
      window as unknown as { __muxXR: { checkForUpdate(): Promise<void> } }
    ).__muxXR.checkForUpdate(),
  );
  if (await page.locator('[data-update-notice]').isVisible())
    throw new Error('Current build showed an update');
  const navigationBaseline = navigations;
  const initialPolls = polls;
  cpSync(join(root, 'next'), join(root, 'served'), { recursive: true });
  await page.locator('[data-update-notice]').waitFor({ state: 'visible', timeout: 35_000 });
  if (navigations !== navigationBaseline || (await buildId()) !== current.buildId)
    throw new Error('Update caused an automatic reload');
  if (polls <= initialPolls) throw new Error('Periodic polling did not observe the new build');
  await page.screenshot({ path: '.impeccable/review/update-available-browser.png' });
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.locator('[data-action="reload-update"]').click(),
  ]);
  await page.waitForFunction(() => Boolean((window as unknown as { __muxXR?: unknown }).__muxXR));
  await page.evaluate(() =>
    (
      window as unknown as { __muxXR: { checkForUpdate(): Promise<void> } }
    ).__muxXR.checkForUpdate(),
  );
  if (
    (await buildId()) !== next.buildId ||
    (await page.locator('[data-update-notice]').isVisible())
  )
    throw new Error('Explicit reload did not adopt the new build');
  const labelFailures = messages.filter((message) =>
    /Troika|Creating a worker|Failure loading font|\/fonts\//i.test(message),
  );
  if (errors.length || labelFailures.length)
    throw new Error([...errors, ...labelFailures].join('\n'));
  const result = {
    kind: 'served-update-notice',
    current: current.buildId,
    next: next.buildId,
    polls,
    navigations,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  await writeFile('.impeccable/review/update-notice-result.json', JSON.stringify(result, null, 2));
  await page.close();
} finally {
  await browser.close();
}
