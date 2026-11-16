# ENH-001 — Finish the scene decomposition: controllers and per-frame systems

> Source: audit of 2026-11-15 (`406a373`). Follows audit issue ARC-001, which does phase 1 (a `SceneContext` and one module per XR panel). Priority high, estimate L.

## Goal

Reduce `createWorkspaceScene` in `src/xr/scene.ts` from a shared-state closure to a composition function under 2,500 lines, by extracting stateful controllers and turning `render` into an ordered list of named per-frame systems. The `WorkspaceScene` interface does not change.

## Current state

- After ARC-001 phase 1 the panel builders and their action handlers live in `src/xr/panels/`, and `src/xr/scene-context.ts` exists. Everything else is still in the closure (line numbers from `406a373`, before ARC-001):
  - `render` (`:2790-3683`, about 894 lines): toasts, a one-shot widget restore, controller polling, face buttons, pair grabs, drags, level of detail, gaze input, hover, perf sampling and the draw call.
  - `setupControllers` (`:6692-7011`), `addTerminal` (`:7068-7324`).
  - Clipboard: `pasteClipboard` (`:1900`), `pasteHostClipboard` (`:1910`), `copyHostToQuest` (`:1920`), `copyQuestToHost` (`:1940`), `pasteFrom` (`:1970-2050`).
  - Command and control arming: `armCommand`, `disarmCommand`, `isArmed`, `disarmControl`, `syncArmedControls` (`:4155-4215`).
- parsight's decomposition of the file reports 16 structural clusters at modularity 0.63. Regenerate it before starting: `audit_repository` with `sections: ["decomposition"]`, `file_path: "src/xr/scene.ts"`, `repository_id: "mux-xr"`.
- The only regression suite is `tests/xr-controller.test.ts` (split by QA-006 into `tests/xr/*.test.ts`) and `tests/xr-scene.test.ts`.

## Preconditions

1. ARC-001 (card `01a1dfd6f57a73a48afb558f36d0b115`) is done.
2. The card "Reduce long-frame outliers beyond terminal LOD" (`01a19cbce496742a8e68815a85e1192a`) is closed. This plan rewrites `render`; do not start step 3 while that card is open.
3. The owner's headset checks on the flag-gated widgets are complete, or the owner agrees to proceed. Their mount and restore code moves in step 2.
4. Record a baseline with the capacity check before any edit (see Verification).

## Implementation

Work in a worktree. One extraction per commit, `make checkall` after each.

1. **Controllers.** For each, create `src/xr/controllers/<name>.ts` exporting `create<Name>(ctx: SceneContext, deps): <Name>` with its state as local variables and an explicit returned interface. Replace the closure functions with calls on the returned object.
   - `clipboard.ts`: the five clipboard functions and `clipboardGeneration`. Keep every target guard in `pasteFrom` (`:2009-2031`): the pane is re-checked after the awaited read, and a superseded generation is dropped.
   - `arming.ts`: `armedCommand`, `armedControl`, both timers and their functions.
   - `terminal-panels.ts`: `addTerminal`, panel removal, `applyTerminalOpacity`, `cellAtUV`, `syncPanelFrame`, and the `panels` map.
   - `hand-input.ts`: `activeHand`, `manipulationSpace`, `shoulderOffset`, `handReach`, `captureGrab`.
   - `hierarchy-touch.ts`: `updateHierarchyTouch`, `hierarchyGrab`, `startPanePull`.
   - `xr-session.ts`: `setupControllers` and session start and end handling.
   Order: `arming`, `clipboard`, `hierarchy-touch`, `hand-input`, `terminal-panels`, `xr-session` (least to most entangled).
2. **Dispose.** Each controller returns `dispose()`. `dispose` in the scene (`:8665-8779`) calls them in reverse creation order. Confirm every `addEventListener` moved with its removal: `grep -c addEventListener` and `grep -c removeEventListener` per new file must match.
3. **Frame systems.** Create `src/xr/frame-systems.ts`:
   ```ts
   export type FrameInfo = { time: number; deltaSeconds: number; frame: XRFrame | undefined; presenting: boolean };
   export type FrameSystem = { name: string; update(info: FrameInfo): void };
   ```
   Cut `render` into systems in its current statement order: `toasts`, `widget-restore`, `controller-visuals`, `face-buttons`, `pair-grabs`, `drags`, `fidelity` (LOD), `gaze-input`, `hover`, `perf-sample`, `environment`, `draw`. `render` becomes: build one reused `FrameInfo` object, loop the array, return. Do not reorder systems; several read state the previous one wrote in the same frame.
4. **No new per-frame allocation.** The `FrameInfo` object and the systems array are created once. Do not introduce closures, spreads or array literals inside any `update`. Where the moved code already allocates (the sites listed on the perf card), leave it as it is unless that card has already fixed it.
5. **`TerminalSurface` split** (deferred half of ARC-018). In `src/contracts.ts`, define `TerminalView` (canvas, revision, grid, status), `TerminalInput`, `TerminalSelection` and `TerminalDiagnostics`, with `TerminalSurface` as their intersection so existing code compiles. Narrow each controller's parameter type to the parts it uses. `src/demo.ts` implements view and input and supplies explicit no-ops for the rest.
6. **Tests.** Add `tests/xr/controllers/<name>.test.ts` for `arming` and `clipboard` using a fake `SceneContext`, which the closure never allowed. Move existing tests only by import path.

## Files to touch

`src/xr/scene.ts`, `src/xr/scene-context.ts`, new `src/xr/controllers/*.ts` (six files), new `src/xr/frame-systems.ts`, `src/contracts.ts`, `src/demo.ts`, `tests/xr/**`, `docs/ARCHITECTURE.md` (module ownership table).

## Verification

1. `make checkall` and `make checkall-ci` are green.
2. `wc -l src/xr/scene.ts` is under 2,500 and `awk '/const render = /,/^  };/' src/xr/scene.ts | wc -l` is under 80.
3. `make e2e` passes. With a private daemon and streamer: `make hierarchy-check`, `make focus-mode-check`, `make hand-input-check`, `make clipboard-selection-check` pass.
4. Frame pacing does not regress. Run `make terminal-capacity-check` (private fixture, GPU host, 1-minute load average at most 15 before and after, recorded with the result) before the first edit and after the last. The count of display gaps over 30 ms and the mean frame time must be within run-to-run noise, established by running the baseline three times.
5. The owner confirms on a Quest 3 that controls, grabs, hand input and widgets behave as before. Without this check the card stays open.

## Acceptance criteria (for the card)

- `src/xr/scene.ts` is under 2,500 lines and `render` is under 80 lines made of a loop over named frame systems.
- Six controller modules exist with unit tests for arming and clipboard, and `make checkall-ci` plus `make e2e` are green.
- The capacity check shows no regression in gaps over 30 ms against a three-run baseline, with host load recorded.
- The owner has confirmed controls, grabs and widgets on a Quest 3.

## Rollback

Each extraction is one commit behind an unchanged interface, so `git revert` of a single commit restores that concern to the closure. If the capacity check regresses after step 3, revert the frame-systems commit alone and keep the controllers.

## Out of scope

Fixing the per-frame allocation sites (perf card), the widget context (ARC-006), and any behaviour change.
