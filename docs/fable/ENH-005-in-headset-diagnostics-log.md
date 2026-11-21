# ENH-005 — In-headset diagnostics log

> Source: audit of 2026-11-15 (`406a373`). Follows audit issues QA-005 and QA-001. Priority medium, estimate M.

## Goal

Make client-side failures visible where they happen. A failed IndexedDB write, host request or listener exception on a Quest currently leaves no trace unless a remote inspector is attached.

## Current state

- Production code has one `console.warn` (`src/main.ts:720`) and about 40 bare `catch {}` blocks, concentrated in `src/local-speech.ts` (9), `src/host-clipboard.ts` (9), `src/workspace/pictures.ts` (7) and `src/ui/index.ts` (7).
- After QA-005, `src/diagnostics.ts` exports `reportSwallowed(scope, error)`, which writes to `console.debug`. After QA-001, listener and consumer exceptions in `src/terminal/surface.ts` and `src/workspace/hierarchy.ts` are logged with `console.error` instead of being reported as protocol failures.
- No `error` or `unhandledrejection` listener exists on `window`.
- Widgets are registered in `WIDGET_REGISTRY` (`src/xr/widget-registry.ts`), each entry `{ kind, displayName, spawnOffset, spawnScale?, faceViewer?, create }`. The bell feed widget (`src/xr/bell-feed.ts`) is the closest existing shape: a short scrolling list of timestamped entries with a clear control.

## Preconditions

QA-005 (card `01a1dfd73f73726b9aacd9a00208ec99`) is done. ARC-006 (widget context) is preferred: with it the widget subscribes to a channel; without it, use a module-level subscription on the log.

## Implementation

1. **Log core.** Extend `src/diagnostics.ts` (no DOM or Node imports):

   ```ts
   export type DiagnosticEntry = { at: number; scope: string; name: string; message: string; count: number };
   export const DIAGNOSTIC_CAPACITY = 200;
   export const diagnostics: {
     report(scope: string, error: unknown): void;
     entries(): readonly DiagnosticEntry[];
     clear(): void;
     subscribe(listener: () => void): () => void;
   };
   ```

   A fixed-size ring. `report` stores `error.name` and `error.message` (or `String(error)`), truncated to 200 characters, after `redact`. A report equal in scope, name and message to the newest entry increments its `count` and updates `at` instead of adding a row, so a failure repeating every frame cannot flood the ring. `reportSwallowed` calls `diagnostics.report` and keeps its `console.debug`.
2. **Redaction.** `redact(message)`: strip the query string and fragment from anything that parses as a URL, and replace any run of 24 or more base64 or hex characters with `[redacted]`. Callers must still never pass clipboard text, dictated text, pasted text, request bodies or secrets; state this in the doc comment on `report`.
3. **Global handlers.** In the composition root (`src/app.ts` after ARC-009, otherwise `src/main.ts`), add `error` and `unhandledrejection` listeners that call `diagnostics.report('window.error', …)` and `diagnostics.report('window.unhandledrejection', …)`, removed on dispose. Route the two QA-001 `console.error` sites through `diagnostics.report` as well.
4. **Widget.** Create `src/xr/diagnostics-widget.ts` exporting `createDiagnosticsWidget(envMap)`, modelled on the bell feed: a title with the entry count, the newest eight entries as `scope · message · age` (`×N` when `count > 1`), and a Clear button. Re-render only when the log notifies, and only refresh ages at 1 Hz while visible. Register it in `WIDGET_REGISTRY` with `kind: 'diagnostics'`, `displayName: 'Diagnostics'`, a spawn offset clear of the existing widgets, and `faceViewer: true`.
5. **Unread indicator.** The Widgets panel entry shows a dot when the log has entries newer than the last time the widget was visible. No toast: errors must not interrupt terminal work.
6. **Browser.** Add a "Copy diagnostics" button to the browser settings panel that copies `JSON.stringify(diagnostics.entries())` to the clipboard, and a count beside it.
7. **Debug API.** Add `diagnostics(): readonly DiagnosticEntry[]` to `MuxXrDebugApi` so check scripts can assert that a run produced no entries.
8. **Docs.** Document the widget and the copy button in `docs/WORKSPACE.md`, and what is and is not recorded.

## Files to touch

`src/diagnostics.ts`, new `src/xr/diagnostics-widget.ts`, `src/xr/widget-registry.ts`, `src/app.ts` or `src/main.ts`, `src/terminal/surface.ts`, `src/workspace/hierarchy.ts`, `src/ui/settings-panel.ts` or `src/ui/index.ts`, `src/debug-api.ts`, `src/control-help.ts`, `docs/WORKSPACE.md`, `tests/diagnostics.test.ts`, new `tests/diagnostics-widget.test.ts`.

## Verification

1. `bun run test tests/diagnostics.test.ts`: the ring keeps the newest 200; a repeated report increments `count` and adds no row; `redact` removes a query string and a 32-character hex run; `clear` empties and notifies; a subscriber is called once per report.
2. `bun run test tests/diagnostics-widget.test.ts`: the widget lists the newest eight entries, shows `×3` for a tripled entry, and Clear empties the log.
3. `make e2e`, extended: after the standard flow, `__muxXR.diagnostics()` is empty; after dispatching a synthetic `error` event, it holds one entry with scope `window.error`.
4. `make widgets-clarity-check` (private fixture) captures the widget and its text is legible in the screenshot.
5. `make checkall-ci` is green.
6. The owner opens the Diagnostics widget in a Quest 3 and reads an entry. Without this the headset criterion is not met.

## Acceptance criteria (for the card)

- Swallowed errors, uncaught errors and unhandled rejections appear in a 200-entry ring, with repeats collapsed into a count, covered by unit tests.
- A Diagnostics widget lists the newest entries with scope, message and age, and a browser button copies the log as JSON.
- A redaction test proves URL query strings and long token-like runs never enter the log, and no call site passes clipboard, dictated or pasted text.
- `make checkall-ci` and `make e2e` are green, and the owner has read an entry in a Quest 3.

## Rollback

Remove the registry entry to hide the widget; the log core is inert without a subscriber. Reverting the commits restores `reportSwallowed` to `console.debug` only.

## Out of scope

Sending diagnostics to the host or to OTLP, persisting the log across reloads, and server-side logging changes.
