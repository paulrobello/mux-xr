# ENH-004 — One manifest for the browser checks, driving the Makefile, env validation and the testing table

> Source: audit of 2026-11-15 (`406a373`). Follows audit issues ARC-013 and DOC-003. Priority low, estimate M.

## Goal

Describe each browser check once. The Makefile target, the environment guard and the row in `docs/TESTING.md` all come from that description, so they cannot drift apart again.

## Current state

- `scripts/` holds about 41 `*-check.ts` scripts. Before ARC-013, eleven had no Makefile target, thirteen were absent from `docs/TESTING.md`, and one documented command (`focus-mode-check`) failed because the doc omitted a required variable (audit DOC-002, DOC-003).
- After ARC-013, every check has a hand-written Makefile rule (`<name>-check: ; bun run scripts/<name>-check.ts`), calls `requirePrivateTest([...])` from `scripts/lib/harness.ts` with its own list of variables, and after DOC-003 has a hand-written table row.
- Three places still state the same facts per check: the Makefile, the script's guard, and the doc table.

## Preconditions

ARC-013 (card `01a1dfd6fbc5742da2a784d69042049a`) and DOC-003 are done. The in-progress perf card owns `scripts/terminal-capacity-check.ts` and `scripts/classify-capacity-trace.ts`; list the capacity check in the manifest but do not edit those two files until that card closes.

## Implementation

1. **Manifest.** Create `scripts/checks/manifest.ts`:

   ```ts
   export type CheckSpec = {
     name: string;                 // Makefile target, e.g. 'focus-mode-check'
     script: string;               // repo-relative path
     purpose: string;              // one sentence
     requires: readonly string[];  // env vars that must be set
     optional: readonly string[];  // env vars it reads when present
     fixture: 'browser-fixture' | 'private-streamer' | 'gpu';
     sendsInput: boolean;          // true forces MUX_XR_PRIVATE_TEST=1
     doesNotProve: string;         // the evidence caveat from docs/TESTING.md
   };
   export const CHECKS: readonly CheckSpec[];
   ```

   Fill it from the current scripts: `requires` and `optional` from each script's `requirePrivateTest` call and `process.env` reads, `purpose` and `doesNotProve` from the DOC-003 table.
2. **Runner.** Create `scripts/run-check.ts <name>`: look the name up, fail with the list of valid names when unknown, fail naming every missing variable in `requires`, require `MUX_XR_PRIVATE_TEST=1` when `sendsInput` is true, then `await import()` the script. `--list` prints the names one per line.
3. **Scripts.** Remove each script's own `requirePrivateTest` call once the runner covers it, but keep a one-line guard at the top of each script that throws when it is run directly without `MUX_XR_PRIVATE_TEST=1` and `sendsInput` is true. The private-daemon rule must hold whichever way a script is started.
4. **Makefile.** Replace the per-check rules with:

   ```make
   CHECKS := <space-separated names, kept in manifest order>
   .PHONY: $(CHECKS)
   $(CHECKS):
   	bun run scripts/run-check.ts $@
   ```

   Keep the list static in the Makefile; do not shell out to compute it.
5. **Doc table.** Create `scripts/gen-testing-table.ts` that rewrites the block between `<!-- checks:start -->` and `<!-- checks:end -->` in `docs/TESTING.md` from the manifest, and add a `testing-table` Makefile target. Put the markers around the DOC-003 table.
6. **Sync test.** Add `tests/check-manifest.test.ts` asserting: every `scripts/*-check.ts` file is in the manifest and every manifest script exists; the Makefile's `CHECKS` list equals the manifest names; the table in `docs/TESTING.md` equals the generator's output; every check with `sendsInput: true` lists `MUX_XR_PRIVATE_TEST` handling.
7. **Docs.** Update `CLAUDE.md`'s `make <feature>-check` row to mention the manifest, and `docs/TESTING.md` to say the table is generated.

## Files to touch

New `scripts/checks/manifest.ts`, `scripts/run-check.ts`, `scripts/gen-testing-table.ts`, `tests/check-manifest.test.ts`; `Makefile`; `scripts/*-check.ts` (guard lines only); `docs/TESTING.md`; `CLAUDE.md`.

## Verification

1. `bun run test tests/check-manifest.test.ts` passes.
2. `make -n focus-mode-check` prints `bun run scripts/run-check.ts focus-mode-check`.
3. `MUX_XR_PRIVATE_TEST= make focus-mode-check; echo $?` exits non-zero and the message names `MUX_XR_PRIVATE_TEST`, `MUX_XR_BASE_URL` and `MUX_XR_TEST_ROOT`.
4. `make testing-table && git diff --exit-code docs/TESTING.md` shows no change on a clean tree.
5. Adding a scratch `scripts/zz-check.ts` makes the sync test fail; remove it afterwards.
6. `make checkall-ci` is green, and `make e2e` plus one private-streamer check (for example `make hierarchy-check`) still pass through the runner.

## Acceptance criteria (for the card)

- A unit test fails when a check script, its Makefile target or its row in `docs/TESTING.md` is missing or differs from the manifest.
- Running any check without a required variable exits non-zero and names every missing variable.
- A script that sends input still refuses to run without `MUX_XR_PRIVATE_TEST=1` when started directly, bypassing the runner.
- `make checkall-ci`, `make e2e` and one private-streamer check pass through the runner.

## Rollback

Revert the Makefile and runner commits; the scripts remain runnable directly because their own guard line was kept.

## Out of scope

Moving scripts into subdirectories, and changing what any check asserts.
