# Mux XR PRD

| Field | Value |
| --- | --- |
| Product | Mux XR |
| Repo | /Users/localuser/Repos/mux-xr |
| Owner | Paul Robello |
| Status | Owner confirmed XR entry; revised controller/input build ready for headset recheck |
| Date | October 31, 2026, Etc/GMT+8 |

## Overview

A LAN-only Quest 3 workspace for monitoring par-mux terminals and issuing occasional commands without a physical keyboard. At least two independently positioned live pane panels must be readable together. The headset owns presentation and preferences while par-mux owns processes and terminal state.

## Goals

- At least two readable live panes, with movable XR UI roots, physical scale, rotation and local font zoom. Pane, keyboard, commands, hierarchy and workspace HUD surfaces transform as units. Grip-only thumbstick X yaws and Y pitches without Y translation; grip plus trigger rolls around the laser axis with X and pushes or pulls with Y.
- Hierarchy navigation: daemon > workspace > session > window/tab > pane. One pane per MVP panel.
- Explicit command target, global/workspace quick commands, terminal key strip and virtual keyboard. Terminal grid resize is explicit and selected-pane scoped, with browser/native settings, Apply-only sends, server-echo dimensions and bounded columns/rows.
- Passthrough and VR with black, gradient and one polished silent sci-fi observatory.
- Active-pane-only highlighting and a default-off head-gaze toggle for dwell-based keyboard targeting.
- Headset-local settings. Measure higher panel capacity using real workload shapes.
- Detect new frontend builds with a bounded same-origin manifest poll and a user-controlled Reload action in browser/XR. Reload automatically on the non-XR main page; keep Reload explicit during immersion and end XR before navigation.

## Non-Goals

Public hosting/tunnels, physical keyboard dependency, ambient sound, arbitrary remote shell services, synchronized preferences, and automatic process creation/termination. Whole-window split composition, named saved layouts, elaborate radial menus/flyouts and hand tracking are roadmap scope.

## Reference Projects

| Reference | Reuse |
| --- | --- |
| par-term-emu-core-rust | Binary protobuf/zlib streaming, pane mirrors, input/paste/mouse, metadata |
| pardeck | Label/text/optional-Enter command model, local editable lists and intentionally targeted input |
| par-dots | Direct Three.js WebXR lifecycle, controller-slot handling, grabbable UI and real-headset acceptance boundary |
| webxr1 | Controller/hand interaction direction, MR/VR mode switching and local Quest development |

## Architecture Direction

TypeScript + Vite + Three.js. One terminal emulator and canvas surface per displayed pane. Reuse the core's generated protobuf schema and codec. Canvas textures feed XR meshes, updated only when output changes. Desktop mode displays the terminal canvases flat at their logical size, with a separate 3D preview. DOM controls offer the same operations for setup, debugging and desktop use. Input presentation is mode-specific: browser and 3D preview use the compact DOM drawer, while immersive XR uses native scene input only. Every XR UI root (pane, keyboard, commands, hierarchy and workspace HUD) is a grabbable transform unit. XR controls must be native scene content, not DOM overlays presumed visible in immersion. Desktop mouse preview retains its Smaller, Larger and Reset layout toolbar; XR does not add dedicated physical resize or reset buttons. Native keyboard labels use self-hosted OFL Noto Sans and Symbols 2 through Troika SDF 0.52.5, with unsupported visual glyphs rendered as `?` and original titles retained. Keyboard Backing is a saved browser/native-header setting; off hides the backing while key buttons and the logical grabbable plane remain.

Typed boundaries separate terminal transport, hierarchy metadata, local settings, controls and XR rendering. Headset-local storage is versioned and validated. Connections reject input while disconnected, never replay unsent commands, and detach without killing panes. Menu targets start at the selected pane and follow later explicit pane selections. Gaze changes the keyboard target only when Gaze input is enabled. Use a 350 ms head-directed dwell and retain the last pane target when looking at the keyboard. Closing/removing a panel withdraws its viewer connection.

Grip-only thumbstick X yaws an XR root and Y pitches it, with no Y translation. Grip plus trigger rolls around the controller laser axis with X and pushes or pulls along it with Y. Two-controller grip resizes from hand spread, rotates from hand direction and moves from the midpoint. Transforms persist while typing, retargeting and switching modes. If all grips are released, holding both thumbstick clicks (button 3) for one second recenters every pane, the HUD and input surfaces near the current headset position and resets physical scale. Only explicit Apply from selected-pane browser Workspace Settings or native HUD Terminal settings sends a grid resize. Columns are bounded 2..300 and rows 2..150, actual dimensions are server echo read-only state, and disconnected resize is denied. Grabbing, scaling, zooming, gazing or changing backgrounds does not send a PTY resize. Preserve existing streamer authentication/origin configuration. LAN HTTPS/WSS must be trusted by the headset; no credentials or trust changes are silently provisioned. Initial planned local ports are 4240 (app) and 4241 (isolated verification), subject to reservation before use.

Spatial arrangement presets are available for currently attached terminals through browser settings and the native Arrange menu: Row, Grid, Arc and Sphere. Sphere uses a front hemisphere with level, inward-facing panels. Explicit application uses the current viewer position and yaw, preserves physical sizes/text zoom/input focus/PTY grids, rebases held panels, and leaves later manual changes intact. The chosen pattern is a saved local preference. Adding another pane does not automatically rearrange existing panels. Named pose libraries and animated restore remain separate roadmap work.

Right-controller B toggles temporary Focus mode for the aimed terminal, falling back to the active pane. The pane moves to a size-fitted position centered on the current view and remains world-stable. Other terminals fade out and reject ray/gaze input while the keyboard and HUD remain available. Exiting restores the pane's exact original transform and fades other terminals in. Grip suppresses B activation. Arrangement/recenter actions and XR exit restore visibility without changing terminal grids or processes.

Distance-based rendering LOD is independent of gaze keyboard targeting. The head-gazed pane always remains full fidelity. Medium/far panes reduce raster density and refresh cadence, hidden panes retain live parser state without painting, and desktop returns to full resolution. This never changes PTY grids, input selection or spatial UI text quality. Higher physical Quest capacity remains measured owner acceptance, not inferred from desktop pane counts.

The shared desktop/XR keyboard uses conventional key grouping. Modifier taps remain one-shot, while a roughly 550 ms hold locks Shift/Ctrl/Alt until a later tap. Locked state is visible and resets on input-target/context changes. Right-controller A toggles the keyboard, preserving its pose and safe target ownership. B retains Focus mode. Closer/Farther translate the complete terminal layout horizontally toward or away from the viewer while preserving scales, rotations and remote grids, with a near-distance bound. Observatory motion is limited to slow own-center planet rotation and occasional reused meteor geometry. Terminal filtering adds mipmapped minification and bounded anisotropy, with separate software motion evidence and physical Quest acceptance.

### Upstream Dependencies

- [Full hierarchy/layout streaming](https://board.example.test/board?card=01a19579caef72cb9ccc955871ab48c7): implemented in core `95dbb69f` and published in 0.76.0; metadata-only selector is `/ws?metadata=1`. Required for production hierarchy navigation. Integrate that supported contract rather than a second mux-control bridge.
- [Pane lifecycle streaming](https://board.example.test/board?card=01a1957a2aa8739abc2c5cb116818793): shipped upstream in 0.76.0 for accurate exited/running status and late-join state. Viewer badges remain a non-blocking follow-up. Do not infer exit from silence or label a connection as proof of a running process.

## Phases

| Phase | Demonstrable outcome | Acceptance |
| --- | --- | --- |
| P0 | Local app and real single-pane vertical slice | Typed build/gates, binary protocol fidelity, initial ANSI seed and live input/output, safe detach/reconnect, trustworthy LAN setup instructions |
| P1 | Controller-first MVP test build | Two real panes, hierarchy selection, manipulation, command scopes, virtual input, four environment modes, explicit focus, head-gaze option, browser/live-core evidence, and a handoff for the owner's deferred Quest acceptance |
| P2 | Spatial workspace polish | Named 3D layouts, radial menus, animated window entrance/restore, whole-window split views, broader capacity characterization |
| P3 | Hand control | Selection, manipulation and typing usable with hands, preserving explicit input-target semantics |

Plans: [P0](plans/phase-0-live-terminal.md), [P1](plans/phase-1-controller-mvp.md), [P2](plans/phase-2-spatial-workspaces.md), [P3](plans/phase-3-hand-control.md).

## Verification and Readiness

`make checkall` covers formatting/lint, TypeScript, meaningful unit tests and production build. `make checkall-ci` adds CI-equivalent packaging/secret/dependency checks. Browser suites remain local and use actual GPU rendering. `make e2e` is part of the local done gate. Test a real isolated mux daemon/streamer, two pane streams, commands with and without Enter, disconnect/reconnect, pane closure and held-pane lifecycle when available. Synthetic demo mode is explicitly labeled and never counts as streaming acceptance.

Actual Quest 3 acceptance checks controller targeting, both readable panels, passthrough/VR transitions, virtual keyboard and text clarity. Paul explicitly requested a tested build first and will perform these hardware checks afterward. Software readiness and owner headset acceptance are separate records. Capacity runs record panel count, grids, workload (idle, scrolling logs, busy agent TUI), background, session refresh rate, frame pacing, input response and host load. No maximum is claimed before measurement. Unavailable headset evidence stays pending on its own owner acceptance card.

## Risks

- Quest 3 uses head-directed gaze rather than eye tracking. Gaze input must use dwell/hysteresis, remain opt-in and show the current keyboard target.
- Text sharpness and canvas upload cost compete with scenery and panel count. Benchmark actual headset workloads.
- Hierarchy/lifecycle APIs are being added upstream and require a compatible candidate, not assumed release support.
- Trusted local HTTPS on Quest may require an owner device step. Existing services must not be restarted without separate authorization.
- Workspace command keys must include server identity plus workspace identity, and settings must survive malformed or outdated local data safely.

## Open Questions and Design Stress Test

The interview settled all MVP product choices. The following are implementation facts to verify, not new requirements: compatible upstream API/version; headset availability/trust setup; benchmark-supported capacity; final observatory asset cost. The unavailable grilling skill is replaced by this explicit stress test: distinguish gaze from command focus, display size from PTY size, view detach from process kill, stream sessions from mux sessions, and synthetic browser evidence from physical-headset acceptance. Each distinction has an acceptance check above.
