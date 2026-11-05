# Mux XR

A LAN-only Quest 3 workspace for monitoring par-mux panes and issuing occasional commands without a physical keyboard.

The desktop opens with sharp, flat terminal canvases at their natural text size. Use **3D preview** to inspect the spatial scene, or **Enter XR** on Quest.

The MVP candidate includes individual terminal panels, controller and hand input, global/workspace quick commands, a virtual keyboard, headset-local preferences, passthrough and silent black/gradient/observatory VR backgrounds. Animated radial navigation is implemented. Named 3D layouts and whole-window split views remain roadmap work. Hand input still requires physical Quest acceptance.

## Development

Use Node 24 or Bun 1.4.4, with Bun for packages and tasks:

```sh
bun install --frozen-lockfile
make checkall-ci
make dev
```

Open [the local app](http://localhost:4240). Use Demo for synthetic preview content. Demo does not connect to or execute commands on your computer.

Browser checks need the Chromium revision pinned by Playwright. Install it with `bunx playwright install chromium --no-shell --no-remove`; this keeps other projects' browser versions in the shared cache.

`make dev-stop` stops only this checkout's listener on 4240 and waits for the port to clear. `make dev-restart` stops and starts it. Run long-lived development/streamer processes in a par-mux pane. Local verification uses reserved port 4241.

## Connect Real Panes

The computer must run a compatible mux-enabled par-term-streamer against the desired par-mux socket. Configure the streamer endpoint in the sidebar. This app reuses core protobuf/zlib streaming and does not create or kill pane processes. Physical panel size and local zoom do not change terminal rows/columns.

Full hierarchy browsing requires `mux_tree_request` / `mux_tree_snapshot` and `/ws?metadata=1`. Use the mux-enabled streamer and daemon from [core 0.78.1](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.78.1) or a verified compatible build. Both official macOS ARM64 release binaries passed the real-app check. The plain streamer build lacks mux support, and a version string alone does not establish hierarchy support.

The dedicated preview uses the official 0.78.1 streamer against the existing 0.77.0 default par-mux daemon. The matched 0.78.1 streamer/daemon pairing was also qualified privately. The shared default daemon is not restarted as part of this pin. Tests use separate private sockets. Exact binaries, digests and qualification evidence are recorded in [the core 0.78.1 review](docs/core-0.78-review.md) and [historical verification](docs/verification.md). A connected stream does not establish whether a held pane's process is still running.

Select a pane to attach it, then explicitly select its panel to target input. Commands and Keyboard follow explicit pane selections, including while the drawer is open. The target caption identifies the pane receiving input. Only the active input pane is highlighted. Enable **Gaze input** to let a short dwell choose the keyboard target. It is off by default and keeps the last target while you look at the keyboard.

Each desktop and XR terminal has **Close view** and **Disconnect / Reconnect** controls. Close view removes the virtual panel while its mux pane and shell continue running. Reopen it through Panes. Disconnect retains the panel, last image and placement, stops retries and rejects input. Reconnect attaches to the same pane without replaying input. Network interruptions still retry automatically. A malformed or incompatible stream shows a bounded error and waits for explicit Reconnect. Incoming frames accept the core's bounded 9 MiB payload size, including large initial scrollback seeds.

## Quest and LAN HTTPS

WebXR needs a secure context. Desktop localhost is suitable for development. Daily LAN access needs a certificate trusted by the headset and HTTPS/WSS endpoints. Vite can load existing certificate/key files via `MUX_XR_TLS_CERT` and `MUX_XR_TLS_KEY`; no credentials, certificates or trust stores are replaced automatically.

The prepared preview serves the built app and WebSockets at **[https://192.0.2.10:4240](https://192.0.2.10:4240)**, also available at `https://localhost:4240`. The full app passed from test-mac over LAN HTTPS/WSS with two private real shell panes and targeted command input. The current dedicated streamer mirrors the existing default par-mux daemon. Delivery preserves that daemon and pardeck services.

The existing IWSDK development PEM was reused. It is self-signed and covers localhost rather than the LAN IP, so the Quest browser needs an explicit certificate exception. Paul approved the exact preview binary's incoming-connection rule, which was applied and verified. Existing certificates, trust stores and credentials were preserved. On November 3, 2026, Paul confirmed that he has been testing on Quest 3 and the current controller build works well. New hand gestures require their own headset check.

To serve an already running compatible daemon, run the streamer in a par-mux pane with these arguments (supply your actual binary, socket and existing PEM paths):

```sh
/path/to/par-term-streamer --host 0.0.0.0 --port 4240 \
  --enable-http --web-root /Users/localuser/Repos/mux-xr/dist \
  --mux-socket /path/to/private.sock --tls-pem /path/to/existing.pem \
  --allowed-origins https://192.0.2.10:4240 \
  --allowed-origins https://localhost:4240
```

Stop that streamer with Ctrl-C in its owning pane. The prepared preview's exact upstream socket and streamer pane IDs are recorded in `.local/runtime.json`. Preserve existing authentication configuration and shared services. No published hosting or tunnels are required.

The endpoint is prefilled from the page origin, and a custom endpoint is remembered. The preview mirrors the existing par-mux daemon. Initial views prefer its default workspace/session, and existing panes keep their own programs and shell. On Quest, opening the preview automatically connects when the server field is populated. Choose two pane leaves, then Enter XR. Every XR UI surface (pane, keyboard, commands, hierarchy and workspace HUD) is a grabbable root. Grip one controller to move and rotate it: thumbstick X yaws and Y pitches, without Y translation. Grip plus trigger rolls around the controller laser axis with thumbstick X and pushes or pulls along it with thumbstick Y. Grip the same surface with both controllers to resize by spreading or bringing hands together, rotate by changing hand direction, and move it with the hand midpoint. Transforms persist while typing, retargeting and switching modes. The default keyboard remains small. Settings → Selected terminal adjusts local text zoom. Commands opens saved quick commands and their editor. Keyboard opens text entry and terminal keys. Both follow your pane selection, with optional Gaze input on the XR Keyboard panel and in browser settings. Shift shows uppercase letters and US-layout symbols, including `$`. A short modifier tap applies to one key. Hold Shift, Ctrl or Alt for about 550 ms to lock it until tapped again; locked keys are marked. Changing the input target clears locks. Settings offers passthrough and the three silent backgrounds.

## Spatial controls

Mouse clicks in 3D preview and controller triggers in VR use the same actions, with one input presenter per mode. Browser Keyboard/Commands use the compact DOM drawer; immersive VR uses spatial controls only. Hover with the mouse or aim a controller ray at a non-obvious control to see its explanation. DOM icon and modifier buttons also have browser hover titles.

| Radial item | Owns |
| --- | --- |
| Keyboard | Keys, modifier locks, target readout, Gaze input and Backing. |
| Commands | Global/workspace commands and their editor. |
| Panes | Hierarchy browsing and opening/selecting pane views. |
| Layout | Row, Grid, Arc, Sphere, Closer/Farther and recovery. |
| Warp | Direct right-thumbstick curvature editing. A saves, B cancels. |
| Widgets | Add/show/hide digital and analog clocks. |
| Settings | Display, World and Selected terminal pages. |

### Hand input

VR and passthrough request optional WebXR hand tracking. On a supporting headset, put the controllers down and enable the headset's hand tracking. Controllers remain available when hand tracking is unavailable.

Point the hand ray and pinch **index finger to thumb** to select controls, type keys, run a saved command or select a pane. Use the HUD **Menu** button to open the same radial menu available through controller A. Keyboard modifiers retain their tap-once and hold-to-lock behavior, and explicit pane selection retargets the keyboard and commands.

**Keyborb** is an alternate spatial keyboard with translucent spherical keys and floating letters and symbols. Browser Workspace Settings and native XR Settings share a saved **Off / On / Auto** preference. **Auto**, the default, uses Keyborb when hand-tracking input sources are active and the standard keyboard with controllers. **On** always uses Keyborb, and **Off** always uses the standard keyboard. Keyborb retains the same 62-key layout, modifiers, curvature, target and placement. Point and press the controller trigger or pinch index to thumb to type. Hand hover and contact alone never send a Keyborb key.

Bring your index finger or thumb near Keyborb to lift the orb closest to the thumb-index midpoint toward your hand by its full diameter. Both lasers and their distant selection and grab actions turn off when either hand is near a keyboard. A relaxed index-thumb pinch sends the nearest key and flashes the orb mint green. Open your fingers before pinching again; the headset's native pinch is also accepted when the custom opening threshold was not reached. Each hand can target a different orb, and hovering or touching still never types. Farther away, the hand ray remains available with the same forgiving pinch selection.

With the standard keyboard (**Keyborb: Off**, or Auto with controllers), bring your hand within about 14 cm of the keyboard to hide both lasers and type by pressing keys with your index fingertip. Withdraw before pressing again. Modifier taps and holds work with contact, including on curved keyboards. Both lasers return when both hands leave the keyboard proximity area. Direct contact grabs remain available.

Touch a surface and grip the controller, or pinch **middle finger to thumb** with a tracked hand, to grab the object you touch. Distant surfaces still support aiming and gripping. Move or rotate your hand to manipulate the whole pane, keyboard, command panel, hierarchy, HUD or clock. Grab the same surface with both hands and change their separation to resize, or move their midpoint to translate. Releasing one hand continues with the other without a jump. Grabbing suppresses typing and terminal mouse input.

Hands open curvature presets and Curve less / Curve more through **Menu → Warp**. Controllers retain direct thumbstick Warp editing.

Tracked hands use Paul's orange Blender hand, with a 13-bone rig for its palm, three fingers and thumb. The editable source, rig and pose actions live in `assets-source/hand`. A procedural hand remains available while the asset loads or if loading fails. Elastic arms curve from the wrists to separate anchors 20 cm left/right, 18 cm below and 4 cm forward of the camera. They stretch with the tracked wrists and sag slightly, with a small amount of smoothing in the middle of the curve. The rendered hand preserves its authored bind-bone positions, lengths and cross-sections at the authored physical size. Tracked joint segment directions drive bone rotations only, and the tracked wrist drives the hand root pose. Raw tracked fingertips still drive input, while the rendered skin is stylized and does not promise exact tracked-tip correspondence. The slim source digits are about 23–27 mm across. The hands and arms do not catch rays or send input.

Controllers show the same hands. Trigger pressure curls the index finger, grip pressure curls the lower two fingers, and the face buttons animate the thumb. A rounded wrist joint overlaps the arm and hand to keep their connection closed as they rotate. The right wrist carries a watch showing device-local **12-hour time with AM/PM**, updated each minute: touch its case or band with any part of the left hand, or point at it from farther away and press the left controller trigger. The left ray turns off near the watch. Withdraw the hand before touching again. Controller A and the HUD Menu remain available.

Tracking loss hides the hand and arm, releases manipulation and cancels in-flight input. Open both pinches after tracking returns before starting another gesture. Desktop/browser hand fixtures verify software behavior only. Gesture comfort, occlusion recovery and typing precision still need real Quest 3 hand testing.

### Mux hierarchy navigation

The XR **Panes** surface presents the workspace/session/window/pane hierarchy as real 3D geometry. The default **Helix Navigator** arranges nodes around a compact helix; **Spatial Docks** places the same hierarchy in spatial dock groups. Choose **Hierarchy style** in browser Workspace settings, or use the native **Settings → Display → Mux tree** control. The choice is saved locally and stays synchronized between browser and native settings.

The initial view shows the current workspace and its sessions. Navigation centers the current parent and shows one spherical child level at a time, hiding unrelated siblings. Click a node to expand it. Ancestors remain available as breadcrumbs, and Home, Up and paging retain parent context. Selecting a pane leaf opens the existing pane view and closes the navigator, without changing the remote process. Press B to close the navigator without entering Focus. The navigator is a movable XR root: one- and two-controller grip gestures use the same manipulation behavior as other XR surfaces, and its transform and navigation state survive style changes. While it is open, terminal view roots are temporarily hidden. Closing or switching away restores their original visibility.

The desktop DOM hierarchy remains the accessible fallback. The bundled XR labels use crisp local text and the hierarchy uses muted teal and ivory node bodies, amber branch/attached states and dim connectors. Children contract into the current parent and expand around the newly selected parent. Immediate child shapes and the gold rings on attached panes rotate slowly while labels remain stable. Circular Home, Up and paging controls catch rays across the whole circle, including its center. Breadcrumbs remain available, and Spatial Docks has no translucent base.

Display owns color modes and Filtering, including independent Sharper gaze. World owns the background selector and VR/passthrough. Changing immersive mode ends the current session and prepares a named Enter VR/Enter passthrough browser button for a fresh press. Selected terminal owns grid dimensions, text zoom and per-pane glass opacity. Gaze input appears only on Keyboard. The HUD shows active-pane/connection status, FPS, notices, updates and Exit. Terminal views retain title/status, Disconnect/Reconnect and Close view. Typing keys and local text-size buttons no longer repeat on every terminal.

Settings → Display also owns new-window opacity and Focus preferences. New terminal views use the saved default glass opacity (10–100%, initially 100%) unless that pane has a saved override. Changing the default leaves open views unchanged. Focus distance is saved from 0.5–5 m, defaulting to 1.5 m. Focus warp is saved from 0–100°, defaulting to flat. Both focus settings apply to any focused window and update an active focus immediately. Exiting focus restores its original placement, scale and per-pane curvature.

The 3D preview toolbar always exposes **Smaller panel**, **Larger panel** and **Reset layout**, independently of pane geometry. Preview enlargement is bounded to keep the panel and attached controls inside the viewport. In VR, physical resizing uses grip gestures. Layout also offers workspace recovery. Hover help uses compact labels that scale with viewing distance after a 700 ms dwell, shows actions only and is hidden while gripping. If UI space is lost, release all grips and hold both thumbstick clicks for one second to recenter every pane, the HUD and input surfaces near the current headset position and reset physical scale. This recovery does not resize the PTY. Surface scale and text zoom leave terminal rows and columns unchanged.

Terminal grid size is changed only from the selected pane in browser Workspace Settings with numeric columns/rows and Apply, or from radial Settings → Selected terminal. Native presets are 80x24, 100x30, 120x36 and 160x48, with ±1 and ±10 draft controls plus Apply. Columns and rows are bounded to 2..300 and 2..150. The controls are disabled while disconnected, and only an explicit Apply sends a resize; actual dimensions come back from the server as read-only state. Terminal colors are a saved global preference with Comfortable (default), Original and Monochrome modes. The native keyboard uses self-hosted OFL Noto Sans and Symbols 2 through Troika SDF 0.52.5; unsupported visual glyphs render as `?` while retaining the original title. Keyboard Backing is a saved browser/native-header toggle: off leaves key buttons visible, while the logical grabbable plane remains and can occlude gaze so the input target is retained. The native FPS HUD is an actual frame counter updated about every 500 ms, not a capacity benchmark.

Terminal windows can shrink to 0.3×, half the previous 0.6× minimum. The upper limit stays 1.8×. The XR background selector lives only in Settings → World.

Keyboard settings include a saved **Keyboard curvature** range from 0° to 100°. Curved backing and key geometry preserve ray picking and the shared keyboard-root grip behavior. Key borders use textured `#7197a8` treatment. Keyboard Backing remains an independent toggle.

Keyboard dictation prefers local Whisper on this Mac when the browser supports microphone recording. Choose **Dictate**, speak, choose **Stop dictation**, wait for transcription, review the editable text, then choose **Insert text**. Insertion sends text without Enter and stays locked to the connected pane captured at start. **Clear** empties the reviewed draft while keeping the editor and selected pane active. It is available after recording/transcription ends. Cancel, retargeting, close and disposal stop capture or transcription and release the microphone. Recording is bounded to 60 seconds and 8 MiB. The TLS WebSocket listener on port 4242 accepts the configured frontend Origin, converts the clip with FFmpeg and runs the installed `whisper-cli` locally. Temporary audio is deleted after processing. No cloud API credentials or changes to the existing streamer, authentication or CSP are required. The browser Web Speech controller remains available when a local recording factory is not configured. Physical Quest microphone permission and transcription quality remain owner acceptance items.

Install boot startup from the stable checkout with `make install-whisper-service` (administrator authentication required). The system LaunchDaemon runs Bun directly as `localuser`, uses RunAtLoad and KeepAlive, and retains the existing model, TLS and origins. It does not require a par-mux session. `make whisper-service-plist` prints the exact configuration without installing it. The installer drains a recognized existing listener, verifies launchd ownership and HTTPS health, and restores availability if the cutover fails.

The local service can also be started manually with `bun run scripts/dictation-server.ts --host <LAN-IP> --port 4242 --origin https://<LAN-IP>:4240 --cert .local/https/_cert.pem --key .local/https/_cert.pem --model .local/models/ggml-base.en.bin`. Reuse the existing TLS PEM and repeat `--origin` for additional existing frontend origins. The installed base.en model is pinned to [whisper.cpp model revision 5359861](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1), SHA-256 `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`, under the model's MIT license. Its local provenance record is next to the ignored model file.

Whisper OpenTelemetry loads optional `.local/whisper-otel.env` (mode 600), or standard `OTEL_*` environment variables. `OTEL_EXPORTER_OTLP_ENDPOINT` supplies the base URL, per-signal endpoints override it, and `OTEL_EXPORTER_OTLP_HEADERS` supplies the existing ingestion headers. Metrics, transcription spans and bounded operational logs use service name `mux-xr-whisper`; audio, transcript text and raw exceptions are excluded. Metrics are cumulative with explicit timestamps and include request/rejection counts, transcription outcomes and duration, audio byte totals, client/active-job gauges, availability and heartbeat. Export runs every 15 seconds with bounded requests and buffers. Collector failure never blocks dictation; shutdown exports availability zero. The same file is read after the prepared boot service is installed.

In XR, press **B on the right controller** while pointing at a terminal to enter Focus mode. With no terminal under the ray, it uses the active pane. The pane moves in front of your current view at the saved focus distance (default 1.5 m) and focus warp, while the other terminals fade out. Its placement stays fixed as your head moves, and the keyboard and HUD remain available. Press B again to restore its exact original position, rotation, scale and normal curvature and fade the other terminals back in. B is ignored while either grip is held. Selecting a different pane, applying an arrangement, recentering or leaving XR safely ends Focus mode. This never resizes the terminal grid or stops its process.

## Automatic terminal detail

In XR, the pane under your head-directed gaze always uses full raster quality, even with Gaze input off. Nearby terminals remain full quality. More distant terminals use half or quarter raster resolution and reduced update rates, with immediate restoration when looked at. This changes rendering only: keyboard targeting, selection highlights, terminal grids and UI label sharpness stay independent. Hidden focus-mode terminals continue receiving and parsing output. Desktop terminals return to full quality.

The observatory exterior adds stable star clusters and diffuse cloud bands. The existing authored planet texture loads through a self-hosted fallback without changing the security policy. See the [measured capacity comparison](docs/performance/terminal-lod-2026-11-02.md) for workload, limits and before/after results.

## Keyboard and workspace shortcuts

The desktop and XR keyboards use the same familiar key positions, with Enter at the right of the home row, wide Shift/Backspace/Space keys, and a separate inverted-T arrow cluster. Right-controller **A** opens or closes the tinted radial action menu. Choose Keyboard to toggle the keyboard. It preserves the keyboard pose and active target, and ignores presses made during a grip. **B** continues to toggle terminal Focus mode. A temporarily hidden keyboard retains its locks for the same target, while pane/context changes and XR exit clear them.

In **Arrange** or browser Workspace settings, use **Closer** and **Farther** to move all terminal panels together. Panel size, rotation, text zoom and terminal grids stay unchanged. Closer stops before the nearest panel enters the viewing space.

The observatory planet rotates slowly about its own center. A subtle shooting star occasionally crosses the exterior. Motion pauses outside the Observatory and in passthrough, with no sound. Terminal filtering is saved in Workspace Settings and radial Settings → Display → Filtering. Choose Nearest, Linear, Mipmap crisp or Mipmap smooth, plus anisotropy Off/2×/4×/8×/16× (capped by the GPU). Mipmap smooth with 4× anisotropy is the base default. Sharper gaze is on by default: the head-gazed pane uses full raster quality and base-level linear sampling to favor clarity without reuploading textures, independently of Gaze input. Turn it off to keep the selected base filter on every pane. Physical headset clarity remains an owner recheck.

## Terminal mouse input

For TUIs that enable mouse tracking, point at the terminal and press the controller trigger for a left click. Hold the trigger and move the ray to drag, then release it. Movement is sent only over the captured pane, and the release stays with that pane. Grip suppresses mouse input and safely ends an existing drag before window manipulation. Desktop terminal canvases also support pointer click/drag. Mouse coordinates follow the remote grid, physical transforms and local text zoom. Disabled tracking, read-only and disconnected streams reject mouse input.

In XR, trigger-drag over ordinary terminal text selects it locally. Releasing a completed drag copies the exact text, clears the highlight immediately and shows a copy toast. Choose **Keyboard → Paste** to insert it into the selected connected terminal without Enter. If browser clipboard access is blocked, the copy stays available inside Mux XR and the toast says so. Paste also reads text copied outside the app when the browser permits it. A click without a drag only selects the pane. Grip cancels an active text drag without copying. Gripping or moving UI after a completed drag preserves a pending clipboard write. Mouse-enabled TUIs keep their mouse behavior. Local text copy also works from a disconnected pane's retained view and never sends clipboard commands to par-mux.

## Quick command setup

In XR, open **Commands → New command**. Select **Name** or **Command**, type with the virtual keys, choose **Global** or **Workspace** scope and whether running should append **Enter**, then **Save**. Saving stores the command on this device without running it. Run a saved command explicitly from the Commands menu. The browser drawer provides label/text fields and Save for the same command store.

Connected viewers retry dropped connections with capped backoff until detached. Unsent input is rejected and is never replayed after reconnect. Existing remote grid dimensions are adopted on attach, and the XR window follows server-confirmed rows/columns without moving or rescaling its root. Explicit grid Apply changes the remote grid; viewing and connecting do not.

## Spatial arrangements

Use **Workspace settings → 3D arrangement → Apply arrangement** in the browser, or **Layout** in the XR radial menu. Choose **Row**, **Grid**, **Arc** or **Sphere**. Browser Apply opens the 3D preview. Sphere distributes panels over the front of a spherical surface, curving horizontally and vertically as more terminals are attached, with every panel facing the viewer.

Presets apply to currently attached terminals around your current position and heading. They preserve each panel's physical size, text zoom, input target and remote grid. You can continue grabbing, rotating and scaling afterward. Opening another terminal does not reset existing panels. The last chosen preset is saved locally, but applying it remains explicit. Named saved layouts and animated restoration remain roadmap work.

Arrangement spacing measures each window's current grid geometry, title and controls, plus its manual physical scale. Layouts center those complete bounds and increase distance when viewer-facing windows would visually overlap. Physical scale, text zoom, input target and remote grids are preserved. Controller rays extend to reach arranged windows beyond the default ray length. Creating a new terminal through the viewer requires the pending opt-in core API, tracked by [the upstream card](https://board.example.test/board?card=01a1991e1e20727d8ff8a32afc0b212f). Existing default-workspace panes can already be attached.

The **Widgets** radial item opens the clock controls. A opens the radial menu. Widgets adds a local-time digital or analog 3D clock. Grip either clock to move, rotate, push/pull or scale it like other UI. Its × closes only that clock. Grip stick left/right now uses the reversed yaw and laser-axis roll directions.

Keyboard and main-panel position, rotation and scale save on final grip release and XR exit. The next XR session restores them relative to the new headset position and heading. Both-stick recovery clears those saved poses while retaining commands and other preferences. Clock presence, position, rotation and scale now persist locally, including desktop preview and XR reload. Closing a clock removes its saved entry.

Arrangements keep the full terminal bounds above the Observatory deck or passthrough floor. Black and Gradient keep unrestricted vertical layouts. Stars use varied-size circular soft sprites in one draw call, with no flashing or audio.

## Verification

- `make checkall`: format/lint, TypeScript, unit tests and production build.
- `make checkall-ci`: fast gate plus asset-chain validation, secret scan and dependency audit.
- `MUX_XR_BASE_URL=https://localhost:4240 make production-label-check`: verify actual UI glyph pixels in a built app served with the streamer CSP. A Vite development server is not sufficient.
- `MUX_XR_PRIVATE_TEST=1 MUX_XR_BASE_URL=http://127.0.0.1:4241 MUX_XR_TEST_ROOT=/path/to/private/dist make widgets-clarity-check`: native widget, filter and pose checks using a private built fixture.
- `MUX_XR_PRIVATE_TEST=1 MUX_XR_TEST_ROOT=/path/to/private/dist make hierarchy-check`: private loopback GPU check for both hierarchy styles, browser/native synchronization, navigation, screenshots and reload persistence.
- `MUX_XR_PRIVATE_TEST=1 MUX_XR_TEST_ROOT=/path/to/private/dist make input-refinement-check`: private loopback Metal-GPU check for hierarchy, keyboard curvature, warped rims and injected fake speech recognition. It does not prove microphone, transcription service or physical Quest voice support.
- `make e2e`: local native-GPU browser tests with explicitly synthetic protocol fixtures.
- `make real-app-check`: actual built app against a private compatible core pair, requiring `MUX_XR_PRIVATE_TEST=1` and `MUX_XR_BASE_URL`. It issues two harmless marker commands, so use isolated test panes.
- `MUX_XR_BASE_URL=http://127.0.0.1:4241 bun run scripts/xr-visual-check.ts`: native GPU rendering of the spatial keyboard using an explicit test XR camera/controller. This requires a Vite development server and does not replace headset testing.
- `make live-check`: real-streamer terminal-adapter diagnostic; requires `MUX_XR_STREAMER` and two `MUX_XR_PANES`. This is separate from full hierarchy and headset acceptance.

Browser tests use hardware Chromium headless on supported hosts. Book the host before load-sensitive work. Paul confirmed the build works in headset XR and provided the first controller/keyboard feedback. Updated controls, two-panel readability, passthrough, comfort and capacity still require owner acceptance. No maximum pane count is claimed before measurement.

The observatory's editable high/low sources, deterministic generator, hashes and technical reports are in `assets-source/observatory` and `scripts/assets`. The runtime GLB is 2,528,120 bytes with 22,712 triangles and ten draw calls. Creative owner approval and Quest checks remain explicit.

See [historical verification](docs/verification.md), [DESIGN.md](DESIGN.md), [PRD.md](PRD.md) and the [phase plans](plans/phase-0-live-terminal.md) for scope and dependencies.

The streamer's strict policy blocks blob workers, so Troika typesetting runs on the main thread. Label visibility is checked against the actual served build. Comfort colors replace blue-dominant terminal foregrounds with lighter, low-chroma teal; Original keeps source colors and Monochrome uses neutral foregrounds/backgrounds. Physical color-depth perception still needs a headset check.

## Frontend updates

Production builds include a content fingerprint in the page and a same-origin `version.json` manifest. The frontend checks immediately and every 30 seconds with a five-second request timeout and cache bypass. A changed build shows a compact **Update available / Reload** notice in the browser and an **Update: Reload** action on the XR HUD. On the desktop main page, detected updates reload automatically. In immersive XR, updates wait for an explicit reload. The watch menu also shows **Reload update** while a newer build is available. Reload exits the immersive session first, then loads a fresh page with a cache-busting URL. Terminal processes remain running, and saved device preferences and commands remain in local storage.

The identifier covers the bundled application and public assets, so a font or environment asset update also triggers the notice. Development uses Vite's existing reload behavior rather than production polling.

Automated typing, grid, command and reconnect checks must target an isolated private daemon and streamer. Never point the private-test flag at the real/default mux daemon. Live delivery verification is limited to static frontend files and normal application startup.

Terminal updates compare visible cells and repaint only changed rows, including the old and new cursor rows. XR copies those row strips into a persistent GPU texture at the same pixel density. Unchanged output does not redraw text or upload a texture. Text size, color modes and grid dimensions stay independent of this optimization.

`MUX_XR_PRIVATE_TEST=1 MUX_XR_BASE_URL=http://127.0.0.1:4241 bun run scripts/terminal-texture-check.ts` checks actual WebGL pixels against the canvas reference using an isolated Vite server. It loads a blank fixture, verifies partial updates, orientation, resizing and UV transforms, and does not connect to a mux daemon.

`MUX_XR_BASE_URL=http://127.0.0.1:4241 MUX_XR_PRIVATE_TEST=1 bun run scripts/stream-lifecycle-check.ts` exercises four streams with every WebSocket intercepted. It covers a 3 MiB seed, manual disconnect, rejected input, reconnect without replay, close and reopen. Use an isolated static preview. `MUX_XR_SKIP_LIFECYCLE=1` measures a fixed four-pane, 149×54 workload with 6,400 packets. `MUX_XR_BASELINE=1` runs the same diagnostic against an older build. Timings describe desktop canvas cost and frame pacing, not Quest capacity or a headset FPS gate.

## XR refinement controls

Grip-plus-trigger stick left/right uses its original roll direction again. Grip-only yaw keeps the newer reversed direction. XR startup is single-flight and attempts automatic entry on supported startup/reload even without a fresh click. If the browser rejects it, a clear notice and trusted-gesture/manual fallback remain. Support alone does not guarantee permission to enter. Browser activation requirements retain a first-interaction/manual entry fallback. Successful entry clears old errors. Click a notice or its × above the HUD to dismiss it. Tooltips choose a stable pose when shown and clear the control bounds instead of rotating with every head movement.

Filtering shows anisotropy only for mipmap modes and hides values beyond the device cap. Sharper gaze has a saved maximum distance, default 3 m, adjustable in browser settings or native Filtering. It uses physical distance and remains independent of Gaze input. Anisotropy primarily affects oblique minification. Higher values can look alike front-on, and base-level sharper gaze bypasses mip smoothing.

Choose radial **Warp** to edit the pane aimed at when A opened the menu, falling back to the active pane. Right-stick left/right previews curvature from flat to 100°. A saves and exits, while B cancels and restores the original curve. Grip pauses editing and retains normal manipulation. Gaze routing, scrolling and trigger input pause during Warp. The next separate A press opens the radial again. Browser Workspace Settings has the same selected-pane slider. Curvature is saved per server/pane, preserves the remote grid and mouse UV mapping, and is included in layout spacing/floor checks. Point at a terminal and use either controller's stick up/down to scroll. Both grips must be released, the radial must be closed, and other panels must be closed except Keyboard. No trigger is needed. Ordinary shells use local scrollback. Mouse-aware TUIs receive raw SGR wheel reports. Browser wheel scrolling works in both flat terminals and the 3D preview.

The [radial design notes](design/radial-menus.md) and [rendered comparison](https://artifacts.example.test/a/01a19e0a856b745388c896d401016f04) compare five-action menus and glass treatment using the actual scene. The tinted ring is now the live A-button menu. The [core 0.78.1 review](docs/core-0.78-review.md) records release benefits, qualification evidence and the shared-daemon boundary.

## Animated menu, glass and restart restore

Press A to open the selected tinted ring. Its center expands first, seven options emerge as a stack, then move around the circle into their final positions. The programmed opening is 640 ms. Moving targets cannot be activated or grabbed. Point and trigger to choose Keyboard, Commands, Panes, Layout, Warp, Widgets or Settings. Center Cancel or A closes it. B remains Focus outside Warp editing. Scrolling and underlying terminal activation are blocked while the menu is visible.

Settings → Selected terminal includes saved per-pane glass opacity controls from 10–100%. Browser Workspace Settings has the same slider. The dark backing becomes translucent while normal bright text stays opaque. The frame is a separate hollow bezel, so adjusting opacity does not abruptly remove the border or require repeated texture uploads.

Open terminal views, the selected pane and 3D positions/rotations/scales are saved per streamer. Reload resolves them against the current hierarchy and shows a dismissible toast for unavailable panes. Explicitly closing every view saves an empty workspace. Focus-mode placement is temporary and is excluded from the saved layout. Restoration sends no commands, resize or pane-create request. After installing this update, open the panes you want once; subsequent restarts restore the saved set.
