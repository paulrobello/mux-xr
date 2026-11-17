import { type Browser, chromium, type Page } from 'playwright';
import type { CheckSpec } from '../checks/manifest';

/**
 * The manifest-driven environment guard `scripts/run-check.ts` runs before importing a check:
 * every entry requirement is checked together, so a run without a fixture announces all of the
 * variables it needs at once, including `MUX_XR_PRIVATE_TEST` when the check sends input.
 * Returns the required variables' values so a caller can pass them on.
 */
export function resolveCheckEnv(spec: CheckSpec): Record<string, string> {
  const missing: string[] = [];
  if (spec.sendsInput && process.env.MUX_XR_PRIVATE_TEST !== '1')
    missing.push('MUX_XR_PRIVATE_TEST');
  for (const name of spec.requires) if (!process.env[name]) missing.push(name);
  if (missing.length)
    throw new Error(
      `${spec.name} requires ${missing.join(', ')} to point at a private fixture you own. Set them and MUX_XR_PRIVATE_TEST=1 for checks that send input.`,
    );
  return Object.fromEntries(spec.requires.map((name) => [name, process.env[name] as string]));
}

/** Throws `message` unless `condition` holds. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A plain millisecond sleep, so poll loops yield without needing a page handle. */
export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls `read` until it resolves truthy and returns that value. The legacy per-script helpers took
 * the page first and a message last; scripts call this as `waitFor(read, message)`.
 */
export async function waitFor<T>(
  read: () => Promise<T> | T,
  label = 'condition',
  timeoutMs = 15_000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(intervalMs);
  }
}

/** Like {@link waitFor}, for readers whose good value is not itself truthy (`ok` decides). */
export async function waitForMatch<T>(
  read: () => Promise<T> | T,
  ok: (value: T) => boolean,
  label = 'condition',
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(intervalMs);
  }
}

/**
 * The guard every browser check script opens with: refuses to run unless the caller opted into a
 * private test fixture (`MUX_XR_PRIVATE_TEST=1`) and set every named variable. Returns the named
 * variables' values so the script can destructure them.
 */
export function requirePrivateTest(names: readonly string[]): Record<string, string> {
  if (process.env.MUX_XR_PRIVATE_TEST !== '1')
    throw new Error(
      'This check sends input to a private test daemon. Set MUX_XR_PRIVATE_TEST=1 and point MUX_XR_BASE_URL at your private fixture.',
    );
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length)
    throw new Error(`This check also requires ${missing.join(', ')} pointing at the fixture.`);
  return Object.fromEntries(names.map((name) => [name, process.env[name] as string]));
}

const GPU_LAUNCH_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

/** The Chromium launch every graphics check uses: the GPU stack, never SwiftShader. */
export async function launchGpuBrowser(options?: { headless?: boolean }): Promise<Browser> {
  return chromium.launch({
    channel: 'chromium',
    headless: options?.headless ?? true,
    args: GPU_LAUNCH_ARGS,
  });
}

/** Opens the app and waits for DOM content, as `scripts/e2e.ts` does. */
export const openApp = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
};
