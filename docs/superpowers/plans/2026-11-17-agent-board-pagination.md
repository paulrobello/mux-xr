# Agent board pagination and max rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every roster agent reachable from the XR agent board: a user-set `agentBoardMaxRows` (3–12, default 6) plus a pager footer, replacing the inert `+N more` line.

**Architecture:** New validated setting flows through a replayed widget channel (the `weatherZip` precedent) into the agent board, which rebuilds its geometry when the value changes. Page 1 keeps today's urgent-first sticky-slot selection; pages 2+ list the remaining agents in priority sort order. The pager's buttons reuse the existing `widgetControl` → `widget.activate(hit)` routing, so the scene's action switch is untouched except for feeding the channel.

**Tech Stack:** TypeScript, Three.js, Vitest under happy-dom, Bun.

**Spec:** Approved in-session design (brainstorming, 2026-11-17): page 1 urgent-first unchanged; pages 2+ remainder in priority order; settings stepper only (no on-board −/+); browser drawer roster untouched.

## Global Constraints

- `agentBoardMaxRows`: integer, clamped to 3–12, default 6 (`AGENT_BOARD_ROWS_DEFAULT`); the default preserves today's board size and behavior when untouched.
- Page 1 selection and sticky slots must stay byte-identical in behavior to today's `agentBoardRows` when the roster fits or overflows — existing tests keep passing.
- `validateSettings` tolerates a missing `agentBoardMaxRows` (old `localStorage`); settings `version` stays `1`.
- The browser drawer agent roster stays uncapped and unpaginated.
- `mesh-inbox` (the other `AgentRosterConsumer`) is untouched; do not add members to `AgentRosterConsumer`.
- Scene action switch untouched except for the channel feed; pager actions route via `inputAction: 'widgetControl'` and `widget.activate`.
- Commit per task; run `make checkall` per task; `make checkall-ci` before the done claim. No pushes without Paul's approval.
- Copy follows the existing helpText/register style; docs match `docs/DOCUMENTATION_STYLE_GUIDE.md` voice.

## Review Focus

1. Roster shrinks below the current page → page clamps, view stays valid (pinned Task 3).
2. `maxRows` raised while on page 2 so everything fits → clamp to page 1, pager hides (pinned Task 3).
3. Old stored settings without the field → validator defaults to 6 (pinned Task 1).
4. Roster arrives between a rebuild and the next channel publish → rebuild re-renders the stored roster, not a blank board (pinned Task 3).
5. Garbage in the stepper input (`abc`, `1e9`, `-1`, `3.7`) → validator clamps/defaults, never throws (pinned Tasks 1 and 4).

---

### Task 1: `agentBoardMaxRows` setting + validator

**Files:**

- Modify: `src/workspace/agent-roster.ts`
- Modify: `src/settings/store.ts`
- Test: `tests/agent-roster.test.ts`, `tests/property/settings.property.test.ts`

**Interfaces:**

- Produces (exported from `src/workspace/agent-roster.ts`): `AGENT_BOARD_ROWS_MIN = 3`, `AGENT_BOARD_ROWS_MAX = 12`, `AGENT_BOARD_ROWS_DEFAULT = 6`, `validateAgentBoardRows(value: unknown): number`.
- Produces: `WorkspaceSettings.agentBoardMaxRows: number`, in `DEFAULT_SETTINGS` as `AGENT_BOARD_ROWS_DEFAULT`.

- [ ] **Step 1: Write the failing tests**

In `tests/agent-roster.test.ts`, new `describe('agent board rows setting', ...)`:
`validateAgentBoardRows(6) === 6`; `(3) === 3`; `(12) === 12`; `(2) === 3`; `(13) === 12`; `(3.7) === 4` (round, then clamp); `(NaN) === 6`; `(Infinity) === 6`; `('9') === 6`; `(undefined) === 6`.

In `tests/property/settings.property.test.ts`, add to the `everyFieldIsValid` switch:
`case 'agentBoardMaxRows': typeof value === 'number' && Number.isInteger(value) && value >= 3 && value <= 12, else false`.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `bun run test tests/agent-roster.test.ts tests/property/settings.property.test.ts`
Expected: FAIL (validator not exported; validator rejects every number today).

- [ ] **Step 3: Implement**

`src/workspace/agent-roster.ts`: the three constants plus
`validateAgentBoardRows(value: unknown): number` — non-finite or non-number → `AGENT_BOARD_ROWS_DEFAULT`, otherwise `Math.min(AGENT_BOARD_ROWS_MAX, Math.max(AGENT_BOARD_ROWS_MIN, Math.round(value)))`.
`src/settings/store.ts`: field on `WorkspaceSettings` with the doc comment `/** Rows per page on the XR agent board, 3-12. */`, default, and `agentBoardMaxRows: validateAgentBoardRows(candidate.agentBoardMaxRows)` in `validateSettings` (place it next to the `agentsSort` lines, both sides).

- [ ] **Step 4: Run the tests, verify they pass**

Run: `bun run test tests/agent-roster.test.ts tests/property/settings.property.test.ts && make checkall`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add -A && git commit -m "feat(settings): agentBoardMaxRows setting, clamped 3-12, default 6"`

### Task 2: `agentBoardMaxRows` widget channel

**Files:**

- Modify: `src/xr/widget-types.ts`
- Modify: `src/xr/scene.ts` (mutableState interface field, init near `weatherZip: device.weatherZip` at line ~935, `applyAgentBoardMaxRows` near `applyWeatherZip` at ~6293, subscribe line after `applyWeatherZip(next.weatherZip)` at ~6412, `createWidgetChannels` arg at ~1396)
- Modify: `src/xr/widget-registry.ts` (agent-board entry, lines 87–96)
- Test: `tests/widget-channels.test.ts` (create; no channels test exists today)

**Interfaces:**

- Consumes: Task 1's `validateAgentBoardRows`.
- Produces: `WidgetChannels.agentBoardMaxRows: Channel<number>` and `WidgetChannelPublishers.agentBoardMaxRows: Publisher<number>`; `createWidgetChannels(initial: {...; agentBoardMaxRows: number})` with `createChannel(initial.agentBoardMaxRows, true)` (replayed).

- [ ] **Step 1: Write the failing test**

`tests/widget-channels.test.ts`: `createWidgetChannels({ bellFeed: [], textureAnisotropy: 4, weatherZip: '', agentBoardMaxRows: 6 })` — `channels.agentBoardMaxRows.get() === 6`; a `subscribe` called after creation is immediately replayed `6`; `publish(9)` notifies subscribers with `9`; a later subscriber is replayed `9`.

- [ ] **Step 2: Run, verify it fails** — Run: `bun run test tests/widget-channels.test.ts`. Expected: FAIL (type error / undefined member).

- [ ] **Step 3: Implement** — channel in `widget-types.ts`; scene wiring mirroring `weatherZip` exactly (init from `device.agentBoardMaxRows`, `applyAgentBoardMaxRows(next: number)` validates via `validateAgentBoardRows`, no-ops when equal, publishes, notifies); registry passes `ctx.channels.agentBoardMaxRows.get()` into `createAgentBoardWidget(ctx.envMap, { maxRows })` and subscribes `widget.setAgentBoardMaxRows(maxRows)`. (`createAgentBoardWidget` options param arrives in Task 3 — to keep this task green alone, add the options parameter here as `{ maxRows?: number }` accepted-but-unused, or do Tasks 2+3 in one commit; prefer one commit for Tasks 2 and 3 if the intermediate state cannot compile.)

- [ ] **Step 4: Verify** — Run: `bun run test tests/widget-channels.test.ts && bunx tsc --noEmit`. Expected: PASS. (Registry wiring only fully typechecks after Task 3's widget signature.)

- [ ] **Step 5: Commit** (may fold into Task 3's commit per Step 3)

### Task 3: Board page model, pager, rebuildable geometry

**Files:**

- Modify: `src/xr/agent-board.ts`
- Test: `tests/agent-board.test.ts`
- Modify: `tests/widget-close-corner.test.ts` (imports `AGENT_BOARD_HEIGHT`)

**Interfaces:**

- Consumes: Task 1 constants (`AGENT_BOARD_ROWS_DEFAULT`); Task 2 options param.
- Produces (exported from `src/xr/agent-board.ts`):
  - `agentBoardHeight(maxRows: number): number` — replaces the `AGENT_BOARD_HEIGHT` export (its only importer is `widget-close-corner.test.ts`, updated here).
  - `agentBoardRows(rows: readonly AgentRosterRow[], previous?: readonly string[], maxRows?: number): AgentRosterRow[]` — existing behavior, third param added.
  - `agentBoardPageCount(rows: readonly AgentRosterRow[], maxRows?: number): number` — `1` when `rows.length <= maxRows`, else `1 + Math.ceil((rows.length - maxRows) / maxRows)`.
  - `agentBoardPage(rows: readonly AgentRosterRow[], previous: readonly string[], page: number, maxRows?: number): AgentRosterRow[]` — page clamped into range; page 0 = `agentBoardRows(rows, previous, maxRows)`; page n>0 = the paneIds not on page 0, `sortAgentRows(..., 'priority')` order, `slice((n-1)*maxRows, n*maxRows)`.
  - `createAgentBoardWidget(envMap?: THREE.Texture | null, options?: { maxRows?: number })`.
  - Widget gains `setAgentBoardMaxRows(maxRows: number): void` and `activate(target: THREE.Object3D): void`.
  - Pager child names: `agent-board-page-prev`, `agent-board-page-label`, `agent-board-page-next`; buttons carry `inputAction: 'widgetControl'`, `userData.agentBoardAction: 'prev' | 'next'`, helpText `'Previous agents page'` / `'Next agents page'`.

- [ ] **Step 1: Write the failing tests** in `tests/agent-board.test.ts` (keep the existing suite passing by updating `agent-board-overflow` expectations to the pager):
  - Page model (pure): `agentBoardPageCount([], 6) === 1`; `agentBoardPageCount(8 rows, 6) === 2`; `agentBoardPageCount(15 rows, 6) === 3`. `agentBoardPage(roster, [], 0, 6)` equals `agentBoardRows(roster, [], 6)`; page 1 of 8 rows/6 max = the 2 paneIds missing from page 0, in `sortAgentRows(..., 'priority')` order; `agentBoardPage(rows, prev, 99, 6)` clamps to the last page; negative clamps to page 0.
  - Pager widget: default widget shows all three pager nodes hidden; with 8 agents it is visible with label `'1/2'`; `activate` on the next node (`userData.agentBoardAction === 'next'`) flips to page 2 rows and label `'2/2'`; `activate` again stays on `'2/2'`; prev flips back; `activate` on the label node does nothing. Buttons' `inputAction` is `'widgetControl'`.
  - Clamp: on page 2, feed a roster that shrinks to fit one page → pager hides, rows show page-1 selection; feed `agentBoardMaxRows` change 6 → 3 (4 agents) → three visible rows, pager `'1/2'`, board geometry rebuilt (body height equals `agentBoardHeight(3)`); change to a value below the current page count clamps the page.
  - Rebuild keeps data: set roster, change maxRows → rows re-render without a new `setAgentRoster` call (the stored roster re-renders).
  - Update `tests/widget-close-corner.test.ts`: replace the `AGENT_BOARD_HEIGHT` import/use with `agentBoardHeight(AGENT_BOARD_MAX_ROWS)`.

- [ ] **Step 2: Run, verify they fail** — Run: `bun run test tests/agent-board.test.ts tests/widget-close-corner.test.ts`. Expected: FAIL (missing exports/behavior).

- [ ] **Step 3: Implement** in `src/xr/agent-board.ts`:
  - Convert `AGENT_BOARD_HEIGHT`/`TOP`/`ROWS_TOP` module constants into functions of `maxRows` (`agentBoardHeight` exported; `TOP`/`ROWS_TOP` internal to the build).
  - Extract an internal `build(maxRows: number)` that (re)creates body, face, header, close, empty, pager trio and the row pool into `root`, re-stamping `userData` (`widgetId`, `widgetKind`, `inputAction` defaults) exactly as the current tail `root.traverse` does. The factory calls it once; `setAgentBoardMaxRows` calls `disposeOwned(root); root.clear(); build(n)` when the value differs (guard `disposed`), then re-renders the stored roster with the page clamped to the new count. Keep `slotIds` so page-1 stickiness survives rebuilds.
  - Widget state: `page` (0-based), `lastRoster`. `setAgentRoster` stores rows, clamps page, renders via `agentBoardPage`. Pager visibility `pageCount > 1`; label `` `${page + 1}/${pageCount}` ``.
  - `activate(target)` reads `target.userData.agentBoardAction`, steps the page with clamping, re-renders.
  - Footer geometry: pager sits where the overflow label was (`prev`/`next` at ±0.09, label centred, all on the footer line); the `close` ×, header and empty-state behavior are unchanged.

- [ ] **Step 4: Verify** — Run: `bun run test tests/agent-board.test.ts tests/widget-close-corner.test.ts && make checkall`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(xr): agent board pages with a max-rows setting and pager footer"` (fold Task 2's registry/channel commit here if it was deferred).

### Task 4: Drawer settings stepper

**Files:**

- Modify: `src/ui/settings-panel.ts` (agentControls fieldset, ~lines 316–390)
- Test: `tests/agent-roster.test.ts` (settings-panel section, ~lines 490–520; mirror its mount/save pattern)

**Interfaces:**

- Consumes: Task 1's `validateAgentBoardRows`; `bindSettings` key `'agentBoardMaxRows'`.
- Produces: stepper `<label>Board rows<input data-agent-board-rows type="number" min="3" max="12" step="1" aria-label="Agent board rows per page"><small>Rows the XR agent board shows per page.</small></label>` appended to the Agent roster fieldset after the Order label.

- [ ] **Step 1: Write the failing test** — extending the existing settings-panel describe in `tests/agent-roster.test.ts` (read its current mount/save pattern first and mirror it): the panel mounts with `[data-agent-board-rows]` showing the current setting; changing it to a valid value calls the settings save with `agentBoardMaxRows`; garbage input clamps via `validateAgentBoardRows`.

- [ ] **Step 2: Run, verify it fails** — Run: `bun run test tests/agent-roster.test.ts`.

- [ ] **Step 3: Implement** — add the HTML to the `agentControls.innerHTML` template; query it alongside the other agent controls (include in the existing null-check throw); `updateAgentControls` sets `input.value = String(current().agentBoardMaxRows)`; `changeAgentLayout` saves `agentBoardMaxRows: validateAgentBoardRows(Number(boardRowsInput.value))`; add `'agentBoardMaxRows'` to the `bindSettings([...])` list.

- [ ] **Step 4: Verify** — Run: `bun run test tests/agent-roster.test.ts && make checkall`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): agent board rows stepper in the drawer settings"`

### Task 5: Docs

**Files:**

- Modify: `docs/WORKSPACE.md` (Agent board section, ~line 261–265)
- Modify: `DESIGN.md` (Agent board section, ~line 345–348)

- [ ] **Step 1: Update the board prose** — replace the "Six rows show at once … a **+N more** line counts the rest." sentences (WORKSPACE.md) and the matching "Six rows fill in pane order … A `+N more` line counts the rest, and rows close up only when an agent leaves with no newcomer." (DESIGN.md) with the paginated behavior, keeping the established voice:

  WORKSPACE.md (Agent board, paragraph 1, replacing the cap sentences): "The board shows `Agent board rows` (Settings, 3–12, default 6) rows per page. Page one fills in pane order, urgent agents claiming slots first exactly as before, and each agent keeps its row, so a state change never moves a row under the pointer. When more agents report than a page holds, a pager footer reads `‹ 2/3 ›`: page one holds the agents that need attention or are stalled first, and later pages list the rest in priority order. Point or pinch `‹` and `›` to flip pages; the pager hides while one page fits everything."

  DESIGN.md: the same facts in that document's denser register, including that the board rebuilds its geometry when the setting changes and that the pager buttons reuse the widget-control path (`widgetControl` → `activate`).

- [ ] **Step 2: Verify** — Run: `make checkall`. Expected: PASS (docs-only change; pre-commit skips the fast gate for `.md`).

- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs: agent board pagination and max-rows setting"`

---

## Final gate (before done claim)

- [ ] `make checkall-ci` green in the worktree.
- [ ] Rebase the branch onto `main` (ff-only from the worktree branch's perspective) and squash-merge to `main` as one commit; delete the branch and worktree afterwards.
- [ ] Serve the verified build to the LAN preview (standing-approved; no daemon restarts, no pushes without approval).
- [ ] Kanban item: check each criterion with evidence (`item check --criterion N --note ...`), then `item done`.
