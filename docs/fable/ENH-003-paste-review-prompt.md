# ENH-003 — Review prompt before a multiline or altered paste

> Source: audit of 2026-11-15 (`406a373`). Follows audit issue SEC-001. Priority medium, estimate M.

## Goal

Let the user see what is about to be pasted into a terminal, and confirm it, whenever the clipboard text spans more than one line or had control characters removed. In the headset the clipboard is invisible until it lands in a shell.

## Current state

- `pasteFrom` (`src/xr/scene.ts:1970-2050`) reads the clipboard, re-checks the target pane, and calls `panel.surface.paste(received)` immediately, then shows a toast.
- After SEC-001, `createPasteMessage` (`src/terminal/protocol.ts:100`) silently strips C0 and C1 control characters through `sanitizePasteText`. The user is not told that the text changed.
- A multiline paste into a program without bracketed paste runs line by line. The user has no preview in XR.
- A two-press confirmation pattern already exists: `armCommand` and `armedPreview` (`:4162-4185`) arm a quick command, show `Sends: <preview>` and require a second press between `CONFIRM_MIN_MS` and `CONFIRM_WINDOW_MS`. `previewCommandText(text, XR_PREVIEW_LENGTH)` produces the preview.
- The browser drawer pastes through the same shared workspace action.

## Preconditions

SEC-001 (card `01a1dfd6e30f7742ba3be611d214337f`) is done, so `sanitizePasteText` exists. If ENH-001 has landed, apply the scene changes in `src/xr/controllers/clipboard.ts` instead of `scene.ts`.

## Implementation

1. **Pure classifier.** Create `src/paste-review.ts`:
   ```ts
   export type PasteReviewMode = 'always' | 'multiline' | 'off';
   export type PasteSummary = { text: string; lines: number; characters: number; removed: number; preview: string; needsReview: boolean };
   export const summarizePaste: (raw: string, mode: PasteReviewMode) => PasteSummary;
   ```
   `text` is `sanitizePasteText(raw)`. `removed` is `raw.length - text.length`. `lines` counts LF-separated lines after normalising CRLF, ignoring one trailing newline. `preview` is the first line through `previewCommandText`. `needsReview` is `mode === 'always'`, or `mode === 'multiline'` and (`lines > 1` or `removed > 0`). With `off` it is always `false`.
2. **Setting.** Add `pasteReview: PasteReviewMode` (default `'multiline'`) to the settings store, with a three-way control on the XR `settings` panel and in the browser settings panel.
3. **Pending paste state.** In the clipboard code add `pendingPaste: { paneId: string; summary: PasteSummary; at: number; timer } | null`.
4. **Flow in `pasteFrom`.** After the existing post-read guards and before `panel.surface.paste`:
   - Build the summary. If `!needsReview`, paste as today.
   - Otherwise store `pendingPaste`, start a timer of `CONFIRM_WINDOW_MS` that clears it, play `cue('armed', source)`, and show a notice: `Paste <lines> lines, <characters> characters to <pane title>? Press Paste again. First line: <preview>` plus `, <removed> control characters removed` when `removed > 0`.
   - A second Paste press for the same pane, later than `CONFIRM_MIN_MS` and inside the window, re-runs the same target guards (`panels.get(id) === panel`, selected, connected), pastes `pendingPaste.summary.text` without re-reading the clipboard, and clears the state.
   - Any other clipboard action, a pane change, a disconnect or scene disposal clears `pendingPaste` and its timer.
5. **Picture URL path.** The `picture-url` branch at the top of `pasteFrom` (`:1978-2006`) does not paste into a terminal. Leave it unchanged.
6. **Browser drawer.** Use the same classifier. When review is needed, show the summary in the existing `workspace-notice` element with the Paste button relabelled `Confirm paste` until confirmed or timed out.
7. **Help and docs.** Add the armed state's help text to `src/control-help.ts`, and document the setting and the prompt in `docs/WORKSPACE.md` beside the clipboard section.

## Files to touch

New `src/paste-review.ts`, `src/xr/scene.ts` or `src/xr/controllers/clipboard.ts`, `src/settings/store.ts`, `src/xr/panels/settings.ts`, `src/ui/index.ts` or `src/ui/input-drawer.ts` and `src/ui/settings-panel.ts`, `src/control-help.ts`, `docs/WORKSPACE.md`, new `tests/paste-review.test.ts`, clipboard tests in `tests/xr/`.

## Constraints

- The pending text stays in memory only, is never logged, written to storage or shown beyond the first-line preview, and is dropped on timeout.
- Keep the target guards for delayed input (project rule): the pane is re-validated at confirm time, and unsent input is rejected on disconnect.
- Do not re-read the clipboard at confirm time. The text the user reviewed is the text that is sent.

## Verification

1. `bun run test tests/paste-review.test.ts`: one line with `multiline` needs no review; two lines need review; one line containing ESC needs review and reports `removed: 1`; `off` never needs review; `always` always does; CRLF counts as one break; a single trailing newline does not add a line.
2. Scene tests: a two-line paste calls `surface.paste` zero times after the first press and once after a second press inside the window; a second press before `CONFIRM_MIN_MS` does nothing; changing the selected pane between presses sends nothing; the timer expiry clears the state; a single-line paste still sends on the first press.
3. With a private daemon and streamer, `make clipboard-selection-check` passes, extended with a two-line paste that needs two presses.
4. `make checkall-ci` is green.
5. The owner confirms the prompt is readable in a Quest 3 and the two-press timing is comfortable.

## Acceptance criteria (for the card)

- With the default setting, a paste of more than one line, or one that had control characters removed, sends nothing until a second press inside the confirm window, and a single-line paste sends on the first press.
- The confirming press sends the reviewed text without re-reading the clipboard, and a pane change or disconnect between presses sends nothing; both covered by tests.
- The setting offers always, multiline and off in XR and in the browser, and `make checkall-ci` is green.
- The owner has confirmed the prompt in a Quest 3.

## Rollback

Set the default to `'off'` to disable the prompt without removing code, or revert the commits. SEC-001's sanitizing is independent and stays.

## Out of scope

A scrollable full preview of long clipboard text, and any change to copy.
