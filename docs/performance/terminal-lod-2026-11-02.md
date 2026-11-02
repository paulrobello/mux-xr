# Terminal LOD capacity comparison — 2026-11-02

Baseline source: `0e84ad3`. Candidate source: `e918a42`, before the later keyboard and filtering batch. The source hashes below bind that historical comparison. Apple M4 Mac mini, native Chromium headless/ANGLE Metal, 1440×1000 viewport, device scale 2. These are desktop diagnostics using the actual app callbacks, terminal parser/painter, XR render/controller branch and a narrow XR session shim. They do not establish a Quest maximum or sustained thermal behavior.

All WebSockets were intercepted. Each case used real logical 149×54 grids, dense colored initial content, one-row agent spinners at approximately 10 Hz per pane and one appended log line per second in pane 1. Two seconds of warmup preceded eight seconds of measurement. The same packet counts and byte counts were delivered to both variants. Keyboard was closed, background Black, gaze keyboard input off, selected pane %1. The center pane remained full quality and a far-pane head turn promoted that pane to full without changing selection.

| Panes | Render callback p95, baseline → candidate | Texture uploads, MiB | Canvas RGBA footprint, MiB | Display interval p95 |
| --- | --- | --- | --- | --- |
| 6 | 8.5 → 5.8 ms | 467.9 → 287.6 | 170.2 → 47.9 | 16.8 → 16.8 ms |
| 12 | 10.3 → 6.3 ms | 713.7 → 295.7 | 340.3 → 58.5 | 16.8 → 16.8 ms |
| 18 | 12.6 → 6.8 ms | 959.5 → 305.5 | 510.5 → 69.1 | 16.8 → 16.8 ms |

At 18 panes this is about 46% lower render-callback p95, 68% fewer uploaded bytes and 86% less canvas pixel storage. Canvas footprint is a measured RGBA-size proxy, not total browser or GPU memory. CPU time covers the XR render callback, while some paints also run on scheduled timers. Display intervals include their effect on the main thread.

Long-frame outliers remain. Worst display gaps were about 66.7 ms for the baseline and 50.1 ms for the 18-pane candidate. The six-pane candidate still had approximately 66.7 ms outliers. Do not describe these short runs as uniformly stable 60 FPS. Eighteen-pane Black draw calls remained 485, so further chrome batching and offscreen-parser/render analysis remain candidates for another measured pass.

Accepted one-minute host loads ranged from 2.1 to 5.6 for Black comparisons and 2.1 to 2.3 for Observatory comparisons, below 15 before and after every case. A local M4 Max attempt was refused at pre-run load 19.996 and is excluded.

With 12 panes and Observatory selected, baseline/candidate render-callback p95 was 10.2/6.2 ms and display-interval p95 was 16.8/16.8 ms. Draw calls changed from 352 to 355, triangles from 24,801 to 25,025. This verifies the small exterior geometry overhead; it is not an isolated mobile-GPU timing claim.

## Shipped changes

- Full quality for the pane under head-directed gaze, independent of keyboard targeting. Nearby panes remain full, medium panes use half raster density and up to 15 paints/s, far panes quarter density and up to 5 paints/s. Hidden focus-mode panes keep parsing output without painting. PTY grids and UI labels are unchanged.
- Distance hysteresis and a 250 ms demotion delay avoid oscillation. Promotion is immediate. Returning to desktop restores full quality.
- Reuse the scene matrix update across XR fidelity and controller picking. Fidelity queries intersect terminal screens, not every key and label.
- Exterior stars are inside the camera clip distance. The static galactic field is precomputed into a 512×256 sRGB texture rather than running procedural trigonometry per fragment. A self-hosted copy of the existing authored planet map avoids the embedded-image fetch failure under the unchanged CSP.

## Research and deferred work

[Three.js Texture](https://threejs.org/docs/pages/Texture.html) and [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html#copyTextureToTexture) document the texture/update APIs. The existing dirty-strip upload path is retained. [xterm onRender](https://xtermjs.org/docs/api/terminal/classes/terminal/#onrender) reports rendered row ranges, but those asynchronous/offscreen renderer notifications are not used as authoritative parser damage in XR. Core already tracks damage locally but Output currently streams only raw bytes and timestamp. Optional ordered damage ranges are filed upstream as `01a19ca4ddb5759eb4d33a400501c4c6`.

[XRManager foveation](https://threejs.org/docs/pages/XRManager.html#setFoveation) and [framebuffer scale](https://threejs.org/docs/pages/XRManager.html#setFramebufferScaleFactor) affect the entire XR framebuffer. They were not changed because this batch preserves UI fidelity and prioritizes the looked-at pane explicitly.

## Evidence binding

Raw paired reports and rendered captures are retained locally under `.local/evidence/capacity`. Runtime source hashes used for this comparison:

- `src/contracts.ts`: `2c3fb0695e6531a3c742a1543ed832c94911df1a50d59eb6477bfb5858a65069`
- `src/terminal/painter.ts`: `74ab30254dabc64e62ef0fc055aba800461af199893d274bf3df5b2edb5d24d2`
- `src/terminal/surface.ts`: `b2d1cefac40d5b82c234365410c863d1dd3527823d1a304e0f4681151ef73e09`
- `src/xr/scene.ts`: `474926cfa5ae6adab2f780b3f7d2b9794030e1d91eaa3c25f70d2b2b45845ee4`
- `src/xr/terminal-lod.ts`: `8f983704f75f680877cfb8976cd962f1269012e1de8c3c4cff7f9ab55c368e3a`
- `src/environment.ts`: `b66a2c17bf7ce686445bd3706d72a732843af4115cc6e39b1b6b51e84077bfdb`
- `src/xr/space-background.ts`: `c174b46dfb707fee72623ccbf90ff0059b30c1e106473ae315ab44aab41ce380`
- `public/assets/observatory-planet.png`: `f785512060885bb4fd4474eb75287ba94c0bb98f43fbec5efc58bdd67c78e713`
