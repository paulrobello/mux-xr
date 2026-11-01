# P1: Controller-first MVP

## Dependencies and Parallel Waves

P0 must verify. P1.1, P1.2 and P1.3 may proceed independently after their shared typed contracts are fixed. P1.4 consumes their integrated result.

## Tasks

- P1.1: XR one-pane panels, two readable defaults, controller ray selection, grip movement/rotation, physical resize and local font zoom, face-me/reset and optional head-gaze emphasis. Input focus changes only explicitly. Build black/gradient/observatory VR backgrounds and passthrough mode. Verify transform/resource tests, browser GPU images and actual controller checks. Dependencies: P0.3.
- P1.2: Global/workspace command editor with local versioned storage, pardeck-compatible label/text/Enter semantics, explicit bound targets, terminal key strip and virtual keyboard including Ctrl/Alt/Shift, Tab, Esc, arrows, backspace and repeat. Verify malformed storage, scope isolation and exact sent bytes/Enter. Dependencies: P0.2.
- P1.3: Read-only hierarchy navigation using upstream card 01a19579caef72cb9ccc955871ab48c7 (core candidate 95dbb69f, `/ws?metadata=1`). Pane choice may span workspaces; never switch desktop selection. Verify live structural updates and late joins using that actual compatible candidate. Dependencies: P0.2 plus upstream availability. Do not duplicate the mux protocol bridge. Held-pane badges from card 01a1957a2aa8739abc2c5cb116818793 follow separately and do not block the MVP test build.
- P1.4: Combine, review actual diff, run `make checkall`, `make checkall-ci` and local `make e2e`, then real Quest 3 acceptance. Benchmark 2 panes and increasing counts with real idle/log/agent workloads, recording conditions and measured results. Validate all four environment modes, mode switching, quick commands and keyboard. Dependencies: P1.1, P1.2, P1.3.

## Scene Contract

Dark orbital observatory, quiet central reading area, peripheral architecture, distant planet and sparse stars. No ambient audio. Blender authoring/inspection uses an isolated Astra agent if needed, with editable source and a portable runtime export. A scene is not accepted just because a model exports.

## Exit

Every software criterion has distinct evidence. Per Paul's later instruction, prepare the tested build first and hand off physical headset checks to him, keeping them explicitly pending. No invented panel capacity, no public hosting and no automatic pushes.
