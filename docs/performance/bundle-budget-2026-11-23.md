# Bundle size budget baseline (ENH-006)

This note records the measured chunk sizes the ENH-006 budget pins, so a future reader can see what the limits in `bundle-budget.json` protect. Measured with `bun run build` at commit e327e71 plus this change (the change adds no JS to the app bundle), macOS arm64, Vite 8 / Rolldown, minified raw bytes from `dist/assets`.

## Measured sizes

| Chunk                            | Measured bytes | Budget limit |
| -------------------------------- | -------------- | ------------ |
| Entry chunk (`index-*.js`)       | 698,540        | 770,000      |
| `vendor-three`                   | 669,224        | 740,000      |
| `vendor-xterm`                   | 330,972        | 370,000      |
| `vendor-troika`                  | 122,454        | 140,000      |
| Largest lazy chunk (heif-worker) | 91,739         | 110,000      |
| Total JS                         | 2,005,414      | 2,210,000    |

## How the limits were derived

Each limit is the measured size plus 10% headroom, rounded up to the next 10,000 bytes (for example 698,540 × 1.1 = 768,394 → 770,000). Limits are raw minified bytes, not gzip, because the Quest's parse and compile cost follows raw size. The lazy limit bounds only the largest lazy chunk: every non-entry, non-vendor chunk (environments, heif-worker, hierarchy, star-sprite) is bounded through the maximum, and an unknown vendor-named chunk falls into the lazy bucket.

## What the budget does not cover

Gzip or Brotli budgets, per-route budgets, and asset (GLB, font, image) size limits, which `asset-check` covers for the observatory. It also does not prove the entry chunk cannot grow by exactly the headroom in one step: each limit allows one 10% step before the gate fails.
