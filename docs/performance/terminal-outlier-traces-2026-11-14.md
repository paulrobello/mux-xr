# Terminal long-frame outlier traces — 2026-11-14

Bounded native Chrome traces over the capacity workload, captured with the new MUX_XR_TRACE arm
(scripts/terminal-capacity-check.ts) and classified with scripts/classify-capacity-trace.ts.
Card: Reduce long-frame outliers beyond terminal LOD, criterion 1 (capture + classify before fixes).

## Setup and validity

- MiniMac M4 (macOS 27.2), Chromium 153.0.8010.12 new headless, channel 'chromium', ANGLE Metal,
  1440x1000 viewport, device scale 2 — the accepted native fixture shape from the 2026-11-02 docs.
- Source: worktree branch worktree-perf-trace-classification commit 6fcf802 (trace arm + classifier;
  tree otherwise identical to main 97a967d).
- Mixed workload, black background, selected pane %1, 149x54 grids, one spinner line at 10 Hz per
  pane plus one appended log line per second in pane 1; 2 s warmup, 8 s measured; a second arm ran
  the 500 ms gaze sweep at 18 panes. No damage arm (MUX_XR_DAMAGE unset), so every output scan is
  a full scan with reason 'untracked', matching the pre-damage evidence lineage.
- Host load 1.45-1.83 before/after every case (guard is 15). All runs exited 0 with zero page errors.
- Tracing itself adds overhead: gaps reported here classify attribution, not a regression claim
  against the non-trace arms.

## Gap inventory (display gaps over 30 ms between renderer frames)

| Arm | Frames | Gaps >30 ms | >50 ms | Worst | Warmup outliers |
| --- | --- | --- | --- | --- | --- |
| static 6 | 637 | 8 | 8 | 65.7 ms | none |
| static 12 | 635 | 12 | 4 | 113.5 ms | 102.1 ms, 76.4 ms |
| static 18 | 592 | 33 | 10 | 212.9 ms | 212.9 ms, 192.1 ms |
| sweep 18 | 588 | 33 | 13 | 215.4 ms | 215.4 ms, 190.9 ms |

Capacity summary under trace: static cpu p50 1.1-1.9 ms, p95 10.1 / 19.0 / 31.6 ms (6/12/18),
pacing p95 16.8 / 16.8 / 33.3 ms; sweep 18-pane cpu p95 29.8 ms. Uploads 424-486 MiB per static
window; sweep 754 MiB uploads, 749 MiB getImageData bytes.

## Classification

1. Static gaps are 1 Hz-aligned (one per appended log line, ~1016-1031 ms apart at every count).
   The renderer-main tick (the XR render callback) runs 40-65 ms end to end; inside it the GPU
   process stalls in RasterImplementation::ReadbackImagePixels (14-24 ms) or
   CommandBufferProxyImpl::WaitForToken (22-24 ms), with 115-160 ms of GPU-track busy per gap.
   Cause: the log line scrolls the selected full-quality pane; without damage hints the painter
   full-scans the 3278x2268 canvas (getImageData bytes ~= texture upload bytes in every run), and
   texSubImage2D from the GPU-backed 2D canvas forces a synchronous readback on the GPU process.
   The 10 Hz spinner rewrites do NOT produce gaps on their own: dirty-row uploads keep them cheap.
2. Sweep tier flips (gaze promotion between 500 ms sweep steps) add 92-101 ms gaps beyond the 1 Hz
   ones, same signature plus paired MinorGC events (allocation churn from the resize-repaint path:
   new canvas + new DataTexture per tier change). This matches the 2026-11-12 Quest 3 probe
   (80-130 ms gaps lining up with tier-switch seconds) and the Nov-2 doc's 50-67 ms candidates.
3. Warmup outliers (190-215 ms at 12/18 panes) are the initial tier-assignment burst on first
   layout, not steady-state; the 2 s warmup already keeps them out of the measured p95.

GC is negligible (0 major; minor GC only at tier flips, under 5 ms total per window). The cost is
not parse or JS allocation; it is the synchronous full-canvas repaint + readback upload inside the
frame-critical tick.

## Fix candidates (proposals only; nothing changed in this pass)

- Adopt damage hints for the selected pane: the DAMAGE fixture arm exists and asserts damageScans>0,
  but shipped evidence runs without hints turn every output into a full scan. Damage-scoped scans
  would shrink the 1 Hz log-line repaint from the full 3278x2268 canvas to the scrolled rows.
- Cut the synchronous readback: upload strips from the canvas without a full-canvas
  getImageData/texSubImage round trip (the Quest notes list reuse-across-tiers and strip uploads as
  the next step; the strip-swap attempt f384af6 failed on Quest and was reverted, so the proposal is
  damage-scoped repaints first, then upload-shape work measured separately).
- Tier flips: keep the GPU texture allocated at full size across tiers (resize the upload, not the
  texture), removing the reallocation + full re-upload on each promotion.

## Evidence binding

Raw traces (20.9-33.2 MB), capacity reports, and classification JSONs are retained under
.local/evidence/trace-2026-11-14/ (static/ and sweep/), captured on MiniMac in booked windows
(23:31-23:43Z staging, 03:45-04:35Z captures, holder claude-dbl@macdaddy:mux-xr). Host: MiniMac
serial workload identical to the 2026-11-02 accepted fixtures.
