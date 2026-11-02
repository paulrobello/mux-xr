# Terminal clarity controls and moving-gaze comparison

Measured November 2, 2026, Etc/GMT+8. These are private desktop GPU fixtures, not a Quest capacity claim.

## Workload and hardware

test-mac Apple M4, Chromium new headless with Metal hardware acceleration, 1440×1000 viewport and device scale2. Compared base116d2cb with the widgets/clarity candidate. Each pane is149×54, receives a spinner-line update at10Hz and a log line at1Hz, for8 seconds per count. Head direction moves to a different terminal every500ms. Gaze input is off, the background is Black, and terminal input is never sent. All WebSockets are intercepted protocol fixtures. `MUX_XR_GAZE_SWEEP=1` enables the bounded sweep in the existing capacity checker.

## Accepted comparison

| Panes | Base callback p95 | Candidate callback p95 | Base callback p99 | Candidate callback p99 | Base/candidate uploaded MiB |
| --- | --- | --- | --- | --- | --- |
| 6 | 6.4 ms | 6.4 ms | 61.3 ms | 63.1 ms | 502.6 / 502.0 |
| 12 | 6.4 ms | 6.3 ms | 57.8 ms | 56.1 ms | 437.1 / 437.6 |
| 18 | 6.3 ms | 6.5 ms | 54.7 ms | 54.1 ms | 378.9 / 378.4 |

Animation-frame interval p95 was16.8ms in every run. Uploaded bytes differ slightly with delivered packet counts. Accepted one-minute host load before/after each baseline run was2.071/2.146,2.134/2.039,2.039/2.113, and candidate1.987/1.835,1.835/1.860,1.791/1.982. Every run had zero page errors. These results show no material p95 regression in this workload, not a capacity improvement. Long LOD-promotion frames still occur during aggressive gaze changes, as shown by p99. The existing long-frame follow-up remains open.

## Sampling and rejected implementation

Explicit settings choose Nearest, Linear, Mipmap bilinear or Mipmap smooth, with anisotropy Off/2×/4×/8×/16× capped by hardware. Sharper gaze selects base-level linear sampling through a per-material uniform and WebGL2 `textureLod`, keeping the base sampler and texture version unchanged. Head-gazed panes independently retain full raster quality.

The first implementation changed texture samplers on each gaze transition. It was rejected after6-pane callback p95 rose6.4→35.6ms and uploaded data rose502.6→900.7MiB. Those results are retained separately and are not delivery evidence. Only explicit user filter changes now update the sampler.

Native pixel checks exercised all four sampler modes, zero GL errors, and actual visible differences between sharp and smooth sampling (mean absolute channel difference5.228 on a0–255 scale). Gaze-priority pixels matched a separately constructed Linear reference exactly (delta0). Dirty mip updates matched a fresh texture exactly (delta0). The previous default-filter motion proxy remained22.258→18.586 and near-view reference difference0.021. This does not establish headset readability or optical comfort.

Accepted reports, rejected report, logs and screenshots are retained under `.local/evidence/widgets-clarity/native`. See [verification](../verification.md) for clocks, saved poses, floor layouts and the delivery boundary.
