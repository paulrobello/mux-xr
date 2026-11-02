import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright';

type Arrangement = 'row' | 'grid' | 'arc' | 'sphere';
type Viewport = { name: string; width: number; height: number };
type PanelState = { id: string; position: number[]; quaternion: number[]; scale: number };
type AppState = {
  demo: boolean;
  selectedId: string | null;
  attached: string[];
  panes: Array<{ id: string; cols?: number; rows?: number }>;
  scene: { arrangement: Arrangement | null; xrMode: string };
  panels: PanelState[];
};

const BASE_URL = process.env.MUX_XR_BASE_URL;
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
const patterns: readonly Arrangement[] = ['row', 'grid', 'arc', 'sphere'];
const viewports: readonly Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  message: string,
): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function appState(page: Page): Promise<AppState> {
  return page.evaluate(() =>
    (window as unknown as { __muxXR: { getState: () => AppState } }).__muxXR.getState(),
  );
}

function finitePanel(panel: PanelState): boolean {
  return [...panel.position, ...panel.quaternion, panel.scale].every(Number.isFinite);
}

async function runAppViewport(
  browser: Browser,
  viewport: Viewport,
  root: string,
): Promise<Record<string, unknown>> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const gltfWarnings: string[] = [];
  const assetFailures: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Troika|Creating a worker|Failure loading font|\/fonts\//i.test(message.text()))
      errors.push(message.text());
    else if (message.type() === 'error' && /gltf|glb|blob:/i.test(message.text()))
      gltfWarnings.push(message.text());
    else if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
      errors.push(message.text());
    if (message.type() === 'warning' && /gltf|glb/i.test(message.text()))
      gltfWarnings.push(message.text());
  });
  page.on('requestfailed', (request) => {
    const failure = `${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`;
    if (/gltf|glb|blob:/i.test(failure)) gltfWarnings.push(failure);
    else assetFailures.push(failure);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const failure = `${response.status()}: ${response.url()}`;
    if (new URL(response.url()).pathname === '/favicon.ico') gltfWarnings.push(failure);
    else assetFailures.push(failure);
  });
  try {
    await page.goto(`${BASE_URL}?demo=1`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await waitFor(
      () => appState(page),
      (state) => state.demo && state.panels.length >= 2,
      'demo scene did not attach two panels',
    );
    const initial = await appState(page);
    assert(initial.attached.length === 2, 'demo did not attach exactly two panels');
    assert(initial.panels.every(finitePanel), 'demo panel pose was not finite');
    const ids = initial.panels.map((panel) => panel.id).sort();
    const scales = new Map(initial.panels.map((panel) => [panel.id, panel.scale]));
    await page.locator('[data-action="settings"]').click();
    const draftBefore = await appState(page);
    await page.locator('[data-arrangement]').selectOption('sphere');
    const draftAfter = await appState(page);
    assert(
      draftBefore.scene.arrangement === draftAfter.scene.arrangement,
      'arrangement draft auto-applied before Apply',
    );
    const screenshots = [join(root, `arrangement-controls-${viewport.name}.png`)];
    await page.screenshot({ path: screenshots[0], fullPage: true });
    const arrangements: Record<string, unknown>[] = [];
    const attachedState = await appState(page);
    const selectedId = attachedState.selectedId;
    const metadataGrids = new Map(
      attachedState.panes.map((pane) => [pane.id, `${pane.cols ?? 0}x${pane.rows ?? 0}`]),
    );
    for (const pattern of patterns) {
      await page.locator('[data-arrangement]').selectOption(pattern);
      await page.locator('[data-action="apply-arrangement"]').click();
      const state = await waitFor(
        () => appState(page),
        (value) => value.scene.arrangement === pattern,
        `desktop arrangement did not apply ${pattern}`,
      );
      assert(state.scene.xrMode === 'desktop', `arrangement ${pattern} left desktop preview`);
      assert(state.selectedId === selectedId, `arrangement ${pattern} changed selected pane`);
      assert(
        await page
          .locator('.desktop-terminal-host.is-3d-preview canvas[aria-label="Mux XR workspace"]')
          .isVisible(),
        `arrangement ${pattern} did not open the desktop 3D preview`,
      );
      assert(
        state.panes.every(
          (pane) => metadataGrids.get(pane.id) === `${pane.cols ?? 0}x${pane.rows ?? 0}`,
        ),
        `arrangement ${pattern} changed terminal metadata grid`,
      );
      assert(
        state.panels
          .map((panel) => panel.id)
          .sort()
          .join('|') === ids.join('|'),
        `arrangement ${pattern} changed panel IDs`,
      );
      assert(
        state.panels.every((panel) => finitePanel(panel) && panel.scale === scales.get(panel.id)),
        `arrangement ${pattern} changed scale or produced non-finite pose`,
      );
      arrangements.push({ pattern, panels: state.panels });
    }
    assert(errors.length === 0, `app page errors: ${errors.join('; ')}`);
    assert(assetFailures.length === 0, `app asset failures: ${assetFailures.join('; ')}`);
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="Mux XR workspace"]',
      );
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return extension ? gl?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
    assert(
      renderer !== 'unavailable' && !String(renderer).toLowerCase().includes('swiftshader'),
      `GPU renderer unavailable: ${renderer}`,
    );
    return { viewport, renderer, arrangements, errors, gltfWarnings, assetFailures, screenshots };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  assert(BASE_URL, 'MUX_XR_BASE_URL is required');
  assert(PRIVATE_TEST, 'MUX_XR_PRIVATE_TEST=1 is required');
  assert(TEST_ROOT, 'MUX_XR_TEST_ROOT is required and must be an owned temporary root');
  await mkdir(TEST_ROOT, { recursive: true });
  await stat(join(TEST_ROOT, 'arrangement-fixture.js'));
  const fixtureHtml = join(TEST_ROOT, 'arrangement-fixture.html');
  try {
    await stat(fixtureHtml);
  } catch {
    await writeFile(
      fixtureHtml,
      '<!doctype html><meta charset="utf-8"><style>html,body,#fixture-host{margin:0;width:100%;height:100%;overflow:hidden;background:#05070b}#fixture-result{display:none}</style><div id="fixture-host" aria-label="Arrangement fixture"><output id="fixture-result"></output></div><script type="module" src="./arrangement-fixture.js"></script>',
    );
  }
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const app = [];
    for (const viewport of viewports) app.push(await runAppViewport(browser, viewport, TEST_ROOT));
    const fixturePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixtureErrors: string[] = [];
    fixturePage.on('pageerror', (error) => fixtureErrors.push(error.message));
    fixturePage.on('console', (message) => {
      if (/Troika|Creating a worker|Failure loading font|\/fonts\//i.test(message.text()))
        fixtureErrors.push(message.text());
    });
    await fixturePage.goto(`${BASE_URL}/arrangement-fixture.html`, {
      waitUntil: 'load',
      timeout: 15_000,
    });
    await fixturePage.waitForFunction(
      () =>
        Boolean(
          (
            window as unknown as {
              __arrangementFixtureReady?: boolean;
              __arrangementFixtureError?: string;
            }
          ).__arrangementFixtureReady ||
            (window as unknown as { __arrangementFixtureError?: string }).__arrangementFixtureError,
        ),
      undefined,
      { timeout: 15_000 },
    );
    const fixtureFailure = await fixturePage.evaluate(
      () => (window as unknown as { __arrangementFixtureError?: string }).__arrangementFixtureError,
    );
    assert(
      !fixtureFailure,
      `Arrangement fixture failed: ${fixtureFailure}; ${fixtureErrors.join('; ')}`,
    );
    const fixture = await fixturePage.evaluate(
      () => (window as unknown as { __arrangementFixture: unknown }).__arrangementFixture,
    );
    const fixtureRecord = fixture as {
      results?: unknown[];
      resizeCalls?: number;
      renderer?: string;
      paneSizes?: number[][];
      manualScales?: number[];
    };
    assert(
      fixtureRecord.results?.length === patterns.length,
      'fixture did not verify all four arrangements',
    );
    assert(
      JSON.stringify(fixtureRecord.paneSizes) ===
        JSON.stringify([
          [80, 24],
          [120, 36],
          [160, 48],
          [52, 30],
          [100, 18],
          [64, 42],
        ]),
      'fixture did not use the mixed terminal grids',
    );
    assert(
      JSON.stringify(fixtureRecord.manualScales) === JSON.stringify([1, 1.25, 0.3, 1.1, 0.8, 1.4]),
      'fixture did not use the manual panel scales',
    );
    assert(
      fixtureRecord.results.every((result) => {
        const record = result as {
          envelopesChecked?: boolean;
          inputTargetAndGridChecked?: boolean;
        };
        return record.envelopesChecked && record.inputTargetAndGridChecked;
      }),
      'fixture did not verify panel envelopes and input/grid retention for every arrangement',
    );
    assert(
      fixtureRecord.resizeCalls === 0,
      `fixture arrangement caused ${fixtureRecord.resizeCalls ?? 'unknown'} resize calls`,
    );
    assert(
      fixtureRecord.renderer && !fixtureRecord.renderer.toLowerCase().includes('swiftshader'),
      `fixture GPU renderer unavailable: ${fixtureRecord.renderer}`,
    );
    const fixtureScreenshots: string[] = [];
    await fixturePage.evaluate(async () => {
      await (
        window as unknown as { __arrangementFixtureShowMenu: () => Promise<void> }
      ).__arrangementFixtureShowMenu();
    });
    const menuScreenshot = join(TEST_ROOT, 'arrangement-fixture-native-menu.png');
    await fixturePage.screenshot({ path: menuScreenshot, fullPage: true });
    fixtureScreenshots.push(menuScreenshot);
    for (const pattern of patterns) {
      await fixturePage.evaluate(async (value) => {
        return await (
          window as unknown as {
            __arrangementFixtureApply: (arrangement: Arrangement) => Promise<void>;
          }
        ).__arrangementFixtureApply(value);
      }, pattern);
      await fixturePage.waitForTimeout(50);
      const screenshot = join(TEST_ROOT, `arrangement-fixture-${pattern}-overview.png`);
      await fixturePage.screenshot({ path: screenshot, fullPage: true });
      fixtureScreenshots.push(screenshot);
    }
    assert(fixtureErrors.length === 0, `fixture page errors: ${fixtureErrors.join('; ')}`);
    console.log(
      JSON.stringify(
        {
          kind: 'arrangement-browser-verification',
          baseUrl: BASE_URL,
          testRoot: TEST_ROOT,
          patterns,
          app,
          fixture,
          fixtureErrors,
          fixtureScreenshots,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

await main();
