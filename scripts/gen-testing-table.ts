/**
 * Regenerates the check-target table in `docs/TESTING.md` from `scripts/checks/manifest.ts`.
 *
 * Run it after adding or changing a check's manifest entry, then commit both together. The
 * manifest-vs-reality unit test fails when the table between the markers no longer matches this
 * generator's output.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKS, type CheckSpec } from './checks/manifest';

const START = '<!-- checks:start -->';
const END = '<!-- checks:end -->';

/** The Fixture column label the manifest classification renders as. */
const FIXTURE_LABELS: Record<CheckSpec['fixture'], string> = {
  'browser-fixture': 'Loopback browser fixture, GPU',
  'private-streamer': 'Private streamer and daemon, GPU',
  daemon: 'Private daemon or streamer',
  gpu: 'GPU host',
};

/** The docs/TESTING.md table built from the manifest, ending with a newline. */
export function buildTestingTable(checks: readonly CheckSpec[] = CHECKS): string {
  const row = (check: CheckSpec): string => {
    const required = [
      ...(check.sendsInput ? ['`MUX_XR_PRIVATE_TEST`'] : []),
      ...check.requires.map((env) => `\`${env}\``),
    ].join(', ');
    const optional = check.optional.map((env) => `\`${env}\``).join(', ');
    const fixture = [FIXTURE_LABELS[check.fixture], check.fixtureNote].filter(Boolean).join(', ');
    return `| \`make ${check.name}\` | ${check.purpose} | ${required || ''} | ${optional} | ${fixture} | ${check.doesNotProve} |`;
  };
  return [
    '| Target | Checks | Required env | Optional env | Fixture | Does not prove |',
    '| --- | --- | --- | --- | --- | --- |',
    ...checks.map(row),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const doc = readFileSync(join(process.cwd(), 'docs', 'TESTING.md'), 'utf8');
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1 || end < start)
    throw new Error(
      `docs/TESTING.md must contain ${START} and ${END} around the check-target table for this generator to rewrite`,
    );
  const next = `${doc.slice(0, start + START.length)}\n${buildTestingTable()}${doc.slice(end)}`;
  writeFileSync(join(process.cwd(), 'docs', 'TESTING.md'), next);
  console.log(
    `Rewrote the check-target table in docs/TESTING.md from ${CHECKS.length} manifest entries`,
  );
}
