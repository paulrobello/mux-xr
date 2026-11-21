# XR workspace: consumer APIs

Audio Probe XR is the first app outside Mux XR to use `@par/xr-workspace`. This plan turns the friction it hit into package APIs, then moves that app onto them.

## Goal

An app can hide, light and fade the elastic arms, update a label, keep menus above additive scenery, build a menu from a row list, route a pointer and face buttons, start a session with sane Quest defaults, and stage the package's fonts and hand models, all through public exports. Audio Probe XR then drops its workarounds.

## Constraints

- Mux XR's behaviour does not change. Every new behaviour is opt-in or defaults to what Mux XR does today, except the arm's near-eye fade (slice 1), which is on by default and has an off switch.
- The package README states that the app owns the renderer, session, frame loop, hit testing and input routing. The pointer and session helpers (slice 4) are optional conveniences; nothing in the package or in Mux XR calls them.
- New files import siblings relatively (`./labels`). Nothing imports `@par/xr-workspace/internal/*`: the `fix/audit-remediation` branch removes that export and replaces the star barrel in `index.ts` with explicit named exports.
- No slice edits `index.ts`, `package.json` or the package README. The orchestrator adds exports and documentation after the slices are verified.
- three.js 0.186.1, no new dependencies. Tests run under vitest with no WebGL: assert object state, not pixels.

## Slices

Each slice has its own guide and owns its files exclusively, so the four can be built in parallel.

| Slice                                       | Guide                                                | Owns                                                                                |
| ------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. Arm controls and near-eye fade           | [01-arm.md](01-arm.md)                               | `elastic-arm.ts`, `cartoon-hand.ts`, `standard-hand.ts` and their tests             |
| 2. Label update, overlay order, control ids | [02-labels-overlay-ids.md](02-labels-overlay-ids.md) | `labels.ts`, `radial-menu.ts`, `wrist-menu-watch.ts`, new `overlay-order.ts`, tests |
| 3. Menu panel                               | [03-menu-panel.md](03-menu-panel.md)                 | new `menu-panel.ts`, test                                                           |
| 4. Pointer and session helpers              | [04-pointer-session.md](04-pointer-session.md)       | new `pointer.ts`, `xr-session.ts`, tests                                            |
| 5. Packaging                                | done by the orchestrator                             | `package.json`, `stage-assets.ts`, `assets/`, README, `index.ts`                    |

## Verification

Each slice runs its own test files, `bunx tsc --noEmit -p .` and `bunx biome check` on its files. The orchestrator then runs `make checkall` on the combined tree, and `make checkall-ci` before any merge.

## Landing

The branch `feat/xr-consumer-apis` is cut from `main` at `61711cb`. It is not merged until `fix/audit-remediation` reaches local `main`. Then it is rebased, its names are added to the explicit export list, the gate is re-run, and it is squash-merged. Expected rebase conflicts: `index.ts` (structure), `standard-hand.ts` (that branch adds typed joint accessors; this one adds arm state, so the two are independent), `package.json` (`./internal/*` removed there), and any test that mocks `@par/xr-workspace/internal/labels`.

Audio Probe XR adopts the APIs after the merge. Its guide is `plans/xr-workspace-adoption.md` in that repo.
