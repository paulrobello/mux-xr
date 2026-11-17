/**
 * The single entry point for every browser and live check target: `bun run scripts/run-check.ts <name>`.
 *
 * Validates the check's manifest entry (environment and the `MUX_XR_PRIVATE_TEST=1` opt-in) before
 * importing the script, so a missing fixture announces every missing variable before any browser
 * starts. `--list` prints the manifest names one per line. Starting a script directly (bypassing
 * this runner) still hits the script's own `requirePrivateTest` guard or explicit guard line.
 */
import { basename } from 'node:path';
import { CHECKS } from './checks/manifest';
import { resolveCheckEnv } from './lib/harness';

const name = process.argv[2];

if (name === '--list') {
  for (const check of CHECKS) console.log(check.name);
} else {
  const spec = CHECKS.find((check) => check.name === name);
  if (!spec) {
    console.error(
      `Unknown check "${name ?? ''}". Valid names:\n${CHECKS.map((check) => check.name).join('\n')}`,
    );
    process.exit(1);
  }
  try {
    resolveCheckEnv(spec);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  await import(new URL(basename(spec.script), import.meta.url).href);
}
