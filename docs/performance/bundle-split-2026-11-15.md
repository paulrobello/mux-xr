# Bundle split and lazy environments (ARC-012)

This note records the production bundle before and after splitting vendor code into named chunks and loading the eight procedural environments on first use. Desktop build sizes are measured. The three cold-load headset measurements the card requires have **not** been taken and must be taken by the owner.

## What changed

- Each procedural environment loads through `ENVIRONMENT_LOADERS` in `packages/xr-workspace/src/environment.ts`. The environment controller keeps the current world mounted until the next one has loaded, drops a load that a later selection superseded, and keeps the current world with a HUD notice when a chunk fails to load.
- `packages/xr-workspace/package.json` declares `sideEffects: ["./src/labels.ts"]`. Without it the bundler kept every environment module in the entry, because each has top-level `new THREE.Color(...)` calls it could not prove side-effect free. `labels.ts` is the one module that must stay: it calls `configureTextBuilder` at load.
- `ENVIRONMENT_FACTORIES` (eager) moved to `packages/xr-workspace/src/environment-factories.ts`, so the package still exports it for consumers that want every world at once.
- `vite.config.ts` splits `three`, `@xterm/xterm` and `troika-three-text` (with its two dependencies) into `vendor-three`, `vendor-xterm` and `vendor-troika` through `build.rolldownOptions.output.codeSplitting.groups`. Vite 8 uses Rolldown, where `manualChunks` is deprecated.
- `scripts/build-version.ts` already fingerprints every emitted chunk. A change confined to one lazy chunk changes `dist/version.json`: editing one constant in `koi-garden.ts` changed the koi chunk name and the build id (probe run on 2026-11-15).

## Desktop measurements

Measured with `bun run build` at commit base `68c4586` (before) and this change (after). Sizes are minified bytes from `dist/assets`, gzip is `gzip -9`.

| | Before | After |
| --- | --- | --- |
| JavaScript chunks | 4 (entry, heif-worker, heif-decode, hierarchy) | 16 |
| Entry chunk (`index-*.js`) | 1,878,188 B | 679,135 B (226,066 B gzip) |
| `vendor-three` | in entry | 662,345 B (165,595 B gzip) |
| `vendor-xterm` | in entry | 330,972 B (81,959 B gzip) |
| `vendor-troika` | in entry | 119,675 B (42,928 B gzip) |
| Eight environment chunks | in entry | 88,461 B together, fetched on first selection |
| JavaScript parsed at startup | 1,878,188 B | 1,792,127 B |

## What the numbers say

The entry chunk is under the 900 KB the card asked for and the build has more than 12 chunks, but the entry target is not the cost that matters on the headset. The vendor chunks are imported by the entry, so they all load at startup. Startup JavaScript fell by 86,061 B (4.6%), which is the eight environments less the small shared helper they now need. Cold-load parse and compile time should therefore change little.

The split does help on updates: `three`, `xterm` and `troika` change rarely, so after an app update the browser refetches the entry and keeps the vendor chunks from its cache. That claim is also unmeasured on the headset.

## Pending: headset measurements (rule R12)

Not done, and the card's headset criterion stays unchecked. The owner needs to take three cold loads on the Quest browser before and after, from navigation start to first rendered frame, using the same URL and a cleared cache each time:

1. Build `68c4586` (before), serve it from the streamer, and record three cold-load times.
2. Build this change (after), serve it the same way, and record three cold-load times.
3. Record median and range for each. If the median does not improve, say so on the card and leave it open. Given the numbers above, no large improvement should be expected.

## Not done

- Playbook step 3 (lazy host-feed widgets) was skipped. The six host-feed widgets are about 88 KB of source (roughly 14 KB gzip). Making them lazy turns widget creation asynchronous, which puts an await into the restore, toggle and pose-restore paths on a headset, for a saving that does not show in these numbers.
- The `update-notice-check` browser check needs a private fixture and was not run.
- Serving the production build from the streamer under its `script-src 'self'` CSP, to confirm the dynamic imports load, was not run. Same-origin dynamic imports are permitted by that policy, but it is unverified here.
