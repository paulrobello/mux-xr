# Changelog

All notable changes to Mux XR are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.2.0 - 2026-11-15

Audit remediation wave from the 2026-11-15 audit: 53 of 55 findings fixed across security, architecture, code quality and documentation. The remaining two are by design: one waits on headset measurements, one belongs to the performance card.

### Added

- Opt-in dictation authentication: `--dictate-auth on` moves `/dictate` onto a paired route with per-client and global 503 caps. Off by default; today's behavior unchanged.
- Optional toast bearer token: `--toast-token-file` accepts a token file, with the pairing secret as fallback; `--insecure` refuses non-loopback binds (exit 2) and empty tokens are rejected.
- Lazy-loaded environments: each procedural world builds its own chunk, so entry JavaScript fell from 1.88 MB to 679 kB and update reloads parse less.
- `@par/xr-workspace` 0.2.0 adds APIs asked for by its first outside consumer: elastic-arm visibility, glow and a near-eye fade; a public label text update; `keepAbove` for single-pass scenes; stable control ids; a menu panel; optional pointer, button and session helpers; and the fonts and hand models inside the package with a staging command. The arm's near-eye fade is on by default, in Mux XR as well.

### Changed

- Device settings live in one store (`src/settings/store.ts`) shared by the browser presenter and the XR scene; scene-made changes persist through the same store.
- `src/main.ts` is a bootstrap; app wiring lives in `src/app.ts` behind a tested pane controller, and a pane that fails to attach shows a notice instead of throwing.
- The browser UI is decomposed into per-region mounts (`mountWorkspaceUI` 1,811 → 393 lines) and its stylesheet moved to `src/ui/styles.css`.
- Widgets receive a `WidgetContext` (host and typed channels) instead of optional push methods; slow data replays to widgets that attach late.
- Accent state is per scene, and every `WorkspaceActions` member is required with test helpers providing full sets.
- Picture and store modules moved out of `src/xr` into `src/pictures/` and `src/stores/`; `contracts.ts` and `src/workspace` no longer import from the XR layer.
- `?server=` links no longer auto-connect to cross-origin streamer names; the endpoint is prefilled and waits for an explicit connect.
- TypeScript compiles as four strict projects and Vitest runs node and dom projects, with `protocol-check` leading the fast gate.
- Backgrounds, labels and loaders come from one `BACKGROUNDS` descriptor table, and the scene exposes `registerFrameUpdater` instead of a `scene.userData` hook.

### Fixed

- Timing-test pins raised so gates stay green while the fleet runs parallel builds (picture frames 5s → 20s).
- e2e coverage caught that the styles.css extraction initially dropped the keyboard layout, dictation, clipboard, toast and notice styles; restored and pinned by tests.

## 0.1.0 - 2026-11-15

First release of the workspace, recorded from the commit history of 2026-11-01 through 2026-11-15. No git tag exists.

### Added

- Terminal creation: **New terminal** in the browser tree and the XR hierarchy asks the streamer for a default-shell window. It needs a streamer started with `--allow-pane-create` and gates on the capability the streamer reports at attach.
- Agent roster: par-mux agent states appear under **Agents** in the browser sidebar and in the XR Panes hierarchy, with par-mux style configurable rows and ordering. Held-pane exit and respawn state shows in the pane list and tree.
- Hand input and Keyborb: tracked-hand rays, pinch selection and grabs, near-hand typing and contact grabs on raised panel buttons, the spherical-key Keyborb keyboard with a **Mic** orb, and the standard WebXR generic hands with elastic arms and a selectable hand color. The right wrist watch shows local time, opens the radial menu and offers **Reload update**.
- Controller and radial input: the eight-item radial menu (Keyboard, Commands, Panes, Layout, Warp, Widgets, Settings, Focus), remappable face buttons, Warp opacity editing, UI sounds and haptics, **Bring here**, press-twice confirmations and a both-stick recenter.
- Desk Window: a passthrough view of the real desk inside the selected virtual world, with its own grab, resize and close controls.
- Focus and warp: a reversible Focus mode, per-pane curvature up to 180° and glass opacity, new-window defaults with **Reset to defaults**, and an automatic WebXR composition layer for the focused terminal in supported immersive VR.
- Widgets: clocks, agent board, timer and stopwatch, bell feed, performance gauge, host load, Git & CI, kanban strip, host bookings, service health, mesh inbox, stream health, weather, dictated sticky note and pictures. Git & CI, the kanban strip, host bookings, service health and the mesh inbox need an opt-in host route. Those five widgets, the sticky note, the picture picker and the opt-in picture proxy are flag-gated or still await the owner's headset check, so they are not accepted features. See the [workspace guide](docs/WORKSPACE.md#widgets).
- Toasts: programs on the Mac post cards to XR through the host service `/toast` route, with `scripts/send-toast.ts`.
- Host clipboard sync: explicit **Host → Quest**, **Quest → Host**, **Paste host** and **Copy to host** transfers over a paired host service route.
- Local dictation: Whisper transcription through the host service, with a review step before insertion and OpenTelemetry export to par-obs.
- Eight added backgrounds: Hangar deck, Deep-water station, Minimal studio, Desert night, Aurora tundra, Koi garden, Cloud summit and Rain rooftop, chosen from a Backgrounds picker.
- A paired physical keyboard types into the selected terminal.
- Quick commands that are shared, pinned, confirmed or templated, and spatial arrangements (Row, Grid, Arc, Sphere).
- Frontend update notices: a content fingerprint and `version.json` let browser and XR users reload a newer build.
- Private workspace toolkit package `@par/xr-workspace`.

### Changed

- Focus now uses a native WebXR composition layer by default in supported immersive VR. Flat terminals use a quad and warped terminals use a cylinder. The pane frame and scroll controls remain part of the spatial workspace.
- Focus warp can use its own 0–180° angle or inherit the terminal's saved warp. Existing Focus angles are preserved as **Custom**. Terminal warp controls and saved angles support up to 180°.
- Saved UI, widget and pane poses are world reference-space transforms. Older viewer-relative saves migrate on load.
- The authored cartoon hand was replaced by the standard WebXR hands on 2026-11-07. The HUD Menu button moved to the wrist watch and left X toggles the Panes navigator.
- Machine configuration moved out of the repository into `.local/host-config.json`.

### Fixed

- Focused text flicker, and texture uploads reduced by keeping the latest terminal image on the GPU and copying it into each compositor frame.
- Pasted text has control characters stripped.
- Reloads no longer move panes away, and the hidden xterm no longer swallows physical keys.
- Host bookings use the viewing device's time zone.

### Security

- `/dictate` can require the clipboard pairing proof with `--dictate-auth on`, and ffmpeg input probing is limited to browser containers.
- `/toast` can accept a dedicated sender token (`--toast-token-file`) instead of the clipboard pairing secret.
- Credential files for health and telemetry use the checked reader, and the installer opens its recovery log without following symlinks.
- The `server` query parameter is classified before auto-connect.

## Versioning

`package.json` holds the application version. There are no git tags yet. The build fingerprint in the served `version.json` identifies a built app, and `@par/xr-workspace` carries its own version in `packages/xr-workspace/package.json`.

See the [XR workspace guide](docs/WORKSPACE.md#focus-warp-and-terminal-settings) for the controls and fallback behavior of Focus.
