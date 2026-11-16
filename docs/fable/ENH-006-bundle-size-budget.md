# ENH-006 — Bundle size budget in the CI-parity gate

> Source: audit of 2026-11-15 (`406a373`). Follows audit issue ARC-012. Priority low, estimate S.

## Goal

Keep the entry chunk from growing back after ARC-012 splits it. A static import added to the wrong module would silently pull an environment or a vendor library into the entry chunk again.

## Current state

- At `406a373` the production build is a single entry chunk, `dist/assets/index-*.js`, of 1,869,454 bytes. `vite.config.ts:16-24` has no chunking configuration.
- After ARC-012 the build emits an entry chunk under 900 KB, one chunk per lazily loaded environment and host-feed widget, and vendor chunks `vendor-three`, `vendor-xterm` and `vendor-troika`.
- `make checkall` runs `lint typecheck test build`, so `dist/` exists when `checkall-ci` continues. `checkall-ci` adds `asset-check`, Gitleaks and `bun audit` (`Makefile:15-18`).
- `scripts/build-version.ts` already walks `dist` to fingerprint the build, so reading the emitted assets from a script is an established pattern.

## Preconditions

ARC-012 (card `01a1dfd701f071c7a1f85db1a98039ec`) is done and its measured sizes are recorded in `docs/performance/`. Without the split, the only possible budget is today's 1.87 MB, which protects nothing.

## Implementation

1. **Budget file.** Create `bundle-budget.json` at the repo root:
   ```json
   {
     "entry": 900000,
     "lazyChunkMax": 400000,
     "vendor": { "vendor-three": 800000, "vendor-xterm": 350000, "vendor-troika": 250000 },
     "total": 2600000
   }
   ```
   Replace every number with the size measured after ARC-012 plus 10% headroom, rounded up to the next 10,000 bytes. Sizes are raw bytes of the emitted `.js` files, not gzip, because parse and compile cost on the Quest follows raw size.
2. **Checker.** Create `scripts/bundle-budget.ts`: read `dist/assets/*.js`; classify each file as entry (`index-*.js`), vendor (name starts with a `vendor` key) or lazy (everything else); compare against the budget; print a table of chunk, bytes, limit and status; exit 1 if any row is over or if `dist/assets` is missing. With `--json`, print the table as JSON for the performance notes.
3. **Makefile.** Add `bundle-budget:` running `bun run scripts/bundle-budget.ts`, add it to `.PHONY`, and add it to `checkall-ci` as a prerequisite after `checkall` (`checkall-ci: checkall asset-check bundle-budget`). Keep it out of `checkall` so the fast gate does not fail on a deliberate size change mid-work.
4. **Docs.** In `docs/TESTING.md`, document the target and the rule for raising a limit: change `bundle-budget.json` in the same commit as the code that needs it, with the reason in the commit message.

## Files to touch

New `bundle-budget.json`, new `scripts/bundle-budget.ts`, `Makefile`, `docs/TESTING.md`, new `tests/bundle-budget.test.ts` (the classifier and comparison as pure functions, fed a fake file list).

## Verification

1. `bun run test tests/bundle-budget.test.ts`: a file list within limits passes; an entry over the limit fails and names the chunk; an unknown vendor chunk is treated as lazy; an empty list fails.
2. `make build && make bundle-budget` exits 0 and prints every chunk.
3. Temporarily set `"entry": 1000` in `bundle-budget.json`: `make bundle-budget` exits 1 and names the entry chunk. Restore the file.
4. Temporarily add a static import of one environment to `src/main.ts`: `make build && make bundle-budget` exits 1. Revert.
5. `make checkall-ci` is green.

## Acceptance criteria (for the card)

- `make checkall-ci` fails when the entry chunk, a vendor chunk, the largest lazy chunk or the total exceeds `bundle-budget.json`, and prints the offending chunk with its size and limit.
- The limits are the sizes measured after ARC-012 plus 10% headroom, and the measured sizes are recorded in `docs/performance/`.
- A unit test covers the classifier and the comparison, and step 4 above was demonstrated once.

## Rollback

Remove `bundle-budget` from the `checkall-ci` prerequisites. The script and budget file are inert otherwise.

## Out of scope

Gzip or Brotli budgets, per-route budgets, and asset (GLB, font, image) size limits, which `asset-check` covers for the observatory.
