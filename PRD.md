# Mux XR PRD

| Field | Value |
| --- | --- |
| Product | Mux XR |
| Repo | /Users/localuser/Repos/mux-xr |
| Owner | Paul Robello |
| Status | Owner confirmed XR entry; revised controller/input build ready for headset recheck |
| Date | November 2, 2026, Etc/GMT+8 |

## Overview

A LAN-only Quest 3 workspace for monitoring par-mux terminals and issuing occasional commands without a physical keyboard. At least two independently positioned live pane panels must be readable together. The headset owns presentation and preferences while par-mux owns processes and terminal state.

## Goals

- At least two readable live panes, with movable XR UI roots, physical scale, rotation and local font zoom. Pane, keyboard, commands, hierarchy and workspace HUD surfaces transform as units. Grip-only thumbstick X yaws and Y pitches without Y translation; grip plus trigger rolls around the laser axis with X and pushes or pulls with Y.
- Hierarchy navigation: daemon > workspace > session > window/tab > pane. One pane per MVP panel.
- Explicit command target, global/workspace quick commands, virtual keyboard with terminal keys. Terminal grid resize is explicit and selected-pane scoped, with browser/native settings, Apply-only sends, server-echo dimensions and bounded columns/rows.
- Passthrough and VR with black, gradient and one polished silent sci-fi observatory.
- Active-pane-only highlighting and a default-off head-gaze toggle for dwell-based keyboard targeting.
- Headset-local settings, keyboard/HUD poses and sizes, selectable texture filtering with independent gaze clarity, and 3D local-time clock widgets. Measure higher panel capacity using real workload shapes.
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

TypeScript + Vite + Three.js. One terminal emulator and canvas surface per displayed pane. Reuse the core's generated protobuf schema and codec. Canvas textures feed XR meshes, updated only when output changes. Desktop mode displays the terminal canvases flat at their logical size, with a separate 3D preview. DOM controls offer the same operations for setup, debugging and desktop use. Input presentation is mode-specific: browser and 3D preview use the compact DOM drawer, while immersive XR uses native scene input only. Every XR UI root (pane, keyboard, commands, hierarchy and workspace HUD) is a grabbable transform unit. XR controls must be native scene content, not DOM overlays presumed visible in immersion. Desktop mouse preview retains its Smaller, Larger and Reset layout toolbar; XR physical resizing uses grip gestures, with recovery in Layout and through both stick clicks. Native keyboard labels use self-hosted OFL Noto Sans and Symbols 2 through Troika SDF 0.52.5, with unsupported visual glyphs rendered as `?` and original titles retained. Keyboard Backing is a saved browser/native-header setting; off hides the backing while key buttons and the logical grabbable plane remain.

Typed boundaries separate terminal transport, hierarchy metadata, local settings, controls and XR rendering. Headset-local storage is versioned and validated. Connections reject input while disconnected, never replay unsent commands, and detach without killing panes. Menu targets start at the selected pane and follow later explicit pane selections. Gaze changes the keyboard target only when Gaze input is enabled. Use a 350 ms head-directed dwell and retain the last pane target when looking at the keyboard. Closing/removing a panel withdraws its viewer connection.

Grip-only thumbstick X yaws an XR root and Y pitches it, with no Y translation. Grip plus trigger rolls around the controller laser axis with X and pushes or pulls along it with Y. Two-controller grip resizes from hand spread, rotates from hand direction and moves from the midpoint. Transforms persist while typing, retargeting and switching modes. If all grips are released, holding both thumbstick clicks (button 3) for one second recenters every pane, the HUD and input surfaces near the current headset position and resets physical scale. Only explicit Apply from selected-pane browser Workspace Settings or native HUD Terminal settings sends a grid resize. Columns are bounded 2..300 and rows 2..150, actual dimensions are server echo read-only state, and disconnected resize is denied. Grabbing, scaling, zooming, gazing or changing backgrounds does not send a PTY resize. Preserve existing streamer authentication/origin configuration. LAN HTTPS/WSS must be trusted by the headset; no credentials or trust changes are silently provisioned. Initial planned local ports are 4240 (app) and 4241 (isolated verification), subject to reservation before use.

Spatial arrangement presets are available for currently attached terminals through browser settings and the native Arrange menu: Row, Grid, Arc and Sphere. Sphere uses a front hemisphere with level, inward-facing panels. Explicit application uses the current viewer position and yaw, preserves physical sizes/text zoom/input focus/PTY grids, rebases held panels, and leaves later manual changes intact. The chosen pattern is a saved local preference. Adding another pane does not automatically rearrange existing panels. Named pose libraries and animated restore remain separate roadmap work.

The XR Panes surface provides two approved hierarchy presentations: O6 **Helix Navigator** (default) and O7 **Spatial Docks**. Both render the workspace/session/window/pane tree as real 3D geometry under the radial Panes action. The initial view shows the current workspace and sessions, then centers the current parent with one spherical child level while unrelated siblings disappear. Click expands a node, ancestors remain breadcrumbs, and Home, Up and paging retain parent context. A pane leaf opens the existing pane view and closes the navigator without changing its process. B closes the navigator without invoking Focus. The hierarchy root supports the existing one- and two-controller grip gestures, and its path and transform persist across style changes. Opening the navigator temporarily hides terminal view roots, while closing or switching away restores their original visibility. Browser Workspace settings expose the saved **Hierarchy style** selector, and native Settings → Display exposes the synchronized **Mux tree** toggle. The desktop DOM hierarchy remains the accessible fallback.

Right-controller B toggles temporary Focus mode for the aimed terminal, falling back to the active pane. The pane centers on the current view at a saved distance (0.5–5 m, default 1.5 m) and remains world-stable. A separate saved focus warp (0–100°, default flat) temporarily replaces its normal curvature. Both preferences update active focus. Other terminals fade out and reject ray/gaze input while the keyboard and HUD remain available. Exiting restores the pane's exact original transform and normal curvature and fades other terminals in. Grip suppresses B activation. Arrangement/recenter actions and XR exit restore visibility without changing terminal grids or processes. Settings → Display owns these preferences and the saved new-window glass opacity (10–100%, default 100%). New opacity defaults do not change open panes, and saved per-pane overrides take precedence.

Distance-based rendering LOD is independent of gaze keyboard targeting. The head-gazed pane always remains full fidelity. Medium/far panes reduce raster density and refresh cadence, hidden panes retain live parser state without painting, and desktop returns to full resolution. This never changes PTY grids, input selection or spatial UI text quality. Higher physical Quest capacity remains measured owner acceptance, not inferred from desktop pane counts.

The shared desktop/XR keyboard uses conventional key grouping. Modifier taps remain one-shot, while a roughly 550 ms hold locks Shift/Ctrl/Alt until a later tap. Locked state is visible and resets on input-target/context changes. Right-controller A opens the seven-item radial menu. Keyboard is one item and preserves its pose and safe target ownership. Outside hierarchy navigation, B retains Focus mode. Closer/Farther translate the complete terminal layout horizontally toward or away from the viewer while preserving scales, rotations and remote grids, with a near-distance bound. Observatory motion is limited to slow own-center planet rotation and occasional reused meteor geometry. Terminal filtering offers nearest, linear, nearest-mip and trilinear choices with bounded Off/2×/4×/8×/16× anisotropy. Sharper gaze defaults on and uses full raster quality plus shader-selected base-level sampling on the head-gazed pane without texture uploads, independently of keyboard targeting. Observatory and passthrough arrangements respect the full window bounds above their floors, while Black and Gradient stay unrestricted. The native HUD shows status, notices, updates and Exit. A opens radial Keyboard, Commands, Panes, Layout, Warp, Widgets and Settings. Digital and analog 3D local-time clocks use universal manipulation and separate close controls. Keyboard and HUD poses save locally on final grip release and XR exit, restore relative to the next headset heading, and clear through both-stick recovery. Grip-only yaw keeps the reversed horizontal direction. Grip-trigger roll uses its original direction. Physical Quest readability and comfort remain owner acceptance.
Keyboard curvature is a saved 0–100° preference, and curved backing/key geometry preserves ray picking and shared-root grip behavior. Keyboard Backing is independent. Keyboard Dictate prefers microphone recording with local Whisper transcription on this Mac, followed by editable transcript review through the textarea or virtual keys and explicit Insert without Enter. Capture is locked to the connected pane selected at start. Stop ends capture and starts transcription. Cancel, retarget, close and disposal end active work and release the microphone. A separate bounded TLS WebSocket listener uses the existing certificate and installed local Whisper/FFmpeg tools without cloud API credentials or changes to streamer authentication or CSP. The browser Web Speech controller remains a fallback when no local factory is configured. Physical Quest microphone permission, transcription quality and voice comfort remain device acceptance.

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

## November 2 refinement

Persist clock presence and yaw-relative transforms with the keyboard/HUD. Restore them in desktop preview and XR. Automatically enter XR where browser policy permits, retain activation/manual fallback, suppress duplicate entry and allow notice dismissal. Tooltip placement remains stable through head motion and clears control bounds.

Sharper gaze applies only within a configurable saved maximum physical distance. Filtering controls expose applicable anisotropy levels up to the actual device cap. Per-server/pane curvature is adjustable 0–100° without PTY resize, with valid UV picking and depth-aware arrangement spacing. Controller stick and browser wheel scroll local history or a mouse-aware TUI, with grip suppression.

Radial menus and glass remain a rendered design review. Proposed A toggles Keyboard/Commands/Layout/Warp/Widgets, with trigger selection, center Cancel and B focus preserved. Native prototypes use current geometry, fonts, colors and background. Glass chrome is feasible with conservative alpha; refractive glass and whole-terminal transparency need physical readability and performance acceptance.

## Selected radial and last-workspace restore

The accepted tinted ring is live on A. Opening uses center expansion (0–160ms), stacked emergence (160–320ms) and polar fan-out (320–800ms), with trigger/grip gating until settled. All five actions route to existing surfaces. Modal ownership suppresses input and scrolling behind the menu, with B Focus retained outside it.

Dark terminal backing opacity is configurable 10–100% per server/pane in browser and XR. Foreground colors remain crisp and the hollow frame stays present. Saved open views include selection and yaw-relative 3D transforms. Resolve saved identities against live hierarchy, restore partial sets safely, toast missing panes, preserve explicit empty sets and exclude transient Focus placement.

## Accepted panel ownership

Gaze input belongs only on Keyboard beside the target readout and Backing. Display owns color/filter/sharper-gaze preferences, World owns background and VR/passthrough, and Selected terminal owns grid/text zoom/per-pane glass opacity. Commands does not duplicate the hierarchy picker. Every movable UI retains universal grip manipulation.

Warp is a dedicated direct radial action. Capture the aimed pane before the radial occludes its ray, with active-pane fallback. Right-stick X previews 0–100° curvature. A saves and exits, B cancels without Focus, and preview is not persisted until save. Block underlying terminal input, scroll and gaze retargeting while editing, while grips retain manipulation. Cancel on target removal, controller disconnect, recenter, disposal and XR exit.
