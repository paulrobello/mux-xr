# ENH-002 — Per-system frame timing in the performance gauge and capacity check

> Source: audit of 2026-11-15 (`406a373`). Priority medium, estimate M. Depends on ENH-001.

## Goal

When a long frame happens in the headset, show which part of the frame loop took the time. Today that attribution exists only on a desktop, from a Chrome trace.

## Current state

- `PerfSample` (`packages/xr-workspace/src/perf-gauge.ts:7-16`) carries `fps`, `worstFrameMs`, `shownPanes` and `targetHz`. The scene builds one sample at the frame-counter cadence (about 2 Hz) inside `render` (`src/xr/scene.ts:3068-3088`) and pushes it to widgets.
- The performance gauge (`createPerfGaugeWidget`, `perf-gauge.ts:167`) shows FPS, the worst frame in a 20-second history and a sparkline.
- Long-frame attribution comes from `scripts/terminal-capacity-check.ts` with `MUX_XR_TRACE=1` and `scripts/classify-capacity-trace.ts`, which classify display gaps over 30 ms from a Chrome trace. Neither runs on a Quest.
- `docs/performance/` records that the open question for the in-progress card "Reduce long-frame outliers beyond terminal LOD" is what the outlier frames spend their time on.
- After ENH-001, `render` is a loop over named `FrameSystem` objects (`src/xr/frame-systems.ts`), which gives a place to measure without editing each system.

## Preconditions

ENH-001 step 3 (frame systems) has landed. Without it this plan would add timing calls throughout `render`, which is not acceptable while that function is being changed.

## Implementation

1. **Timing core.** Create `src/xr/frame-timing.ts`:

   ```ts
   export type SystemTiming = { name: string; worstMs: number; meanMs: number };
   export type FrameTiming = {
     /** Wraps one system's update. A no-op wrapper when disabled. */
     measure(index: number, update: () => void): void;
     /** Called once per frame with the frame's total; remembers the per-system split of the worst frame. */
     endFrame(totalMs: number): void;
     /** Fills and returns one reused array; resets the window. */
     drain(): readonly SystemTiming[];
     enabled: boolean;
   };
   export const createFrameTiming: (names: readonly string[], now?: () => number) => FrameTiming;
   ```

   State is three preallocated `Float64Array(names.length)` buffers (current frame, window sum, split of the worst frame) plus counters. `drain` writes into one array of objects created at construction. Nothing allocates per frame.
2. **Loop integration.** In `render`'s loop over systems, call `timing.measure(index, system.update)` when `timing.enabled`, otherwise call `system.update` directly. Keep the branch outside the loop body's hot path by selecting one of two loop functions when the flag changes.
3. **Flag.** Add a `frameTiming: boolean` setting (default `false`) through the settings store, with a toggle on the XR `display` panel and in the browser settings panel. The setting is session-scoped: do not persist it, so a headset never stays in measuring mode by accident.
4. **Sample.** Extend `PerfSample` with `systems?: readonly SystemTiming[]`, documented as present only while timing is enabled. In the `perf-sample` system, attach `timing.drain()` when enabled.
5. **Gauge.** In `createPerfGaugeWidget`, when `sample.systems` is present, show one extra label under the worst-frame label: the system with the largest share of the worst frame and its milliseconds (for example `fidelity 21 ms`). Use the existing `setText` path so the label only re-renders when the text changes. No new geometry when timing is off.
6. **Debug API.** Add `frameTimings(): readonly SystemTiming[]` to `MuxXrDebugApi` (`src/debug-api.ts`), returning the last drained window.
7. **Capacity check.** In `scripts/terminal-capacity-check.ts`, when `MUX_XR_FRAME_TIMING=1`, enable the setting through the debug API and add the per-system table to the evidence JSON next to the existing frame statistics. Document the variable in `docs/TESTING.md`.
8. **Docs.** Add a short section to `docs/WORKSPACE.md` under the performance gauge and a note in `docs/performance/` describing how to read the split.

## Files to touch

New `src/xr/frame-timing.ts`, `src/xr/scene.ts` (the render loop only), `src/xr/frame-systems.ts`, `packages/xr-workspace/src/perf-gauge.ts`, `src/settings/store.ts`, `src/xr/panels/display.ts`, `src/ui/settings-panel.ts`, `src/debug-api.ts`, `scripts/terminal-capacity-check.ts`, `docs/TESTING.md`, `docs/WORKSPACE.md`, new `tests/frame-timing.test.ts`, `tests/perf-gauge.test.ts`.

## Verification

1. `bun run test tests/frame-timing.test.ts tests/perf-gauge.test.ts`: with an injected clock, three systems taking 1, 5 and 2 ms report those worst values; the split returned is that of the frame with the largest total; `drain` returns the same array instance on every call; a disabled instance records nothing.
2. Overhead: run `make terminal-capacity-check` (private fixture, GPU host, load average at most 15 recorded) three times with timing off and three with `MUX_XR_FRAME_TIMING=1`. The mean frame time with timing on is within 0.1 ms of timing off. Report the six numbers.
3. `make perf-gauge-check` passes, and with timing on its screenshot shows the system label.
4. `make checkall-ci` is green.
5. The owner turns the toggle on in the headset and reads a system name on the gauge during a deliberate stall (opening several panes). Without this the headset criterion is not met.

## Acceptance criteria (for the card)

- With the setting on, `PerfSample.systems` lists every frame system with worst and mean milliseconds, and the gauge names the largest contributor to the worst frame.
- Unit tests prove the timing core allocates no new array or object per frame or per drain.
- Six capacity-check runs show mean frame time with timing on within 0.1 ms of timing off, with host load recorded.
- The owner has read a system label on the gauge in a Quest 3.

## Rollback

The feature is behind a default-off, non-persisted setting. Reverting the commits removes it. If overhead exceeds the bound, keep the core and debug API for desktop checks and remove the gauge label and the in-headset toggle.

## Out of scope

Exporting timings to the host's OTLP telemetry, GPU timing (WebXR exposes none on Quest), and fixing whatever the timings reveal.
