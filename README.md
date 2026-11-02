# Mux XR

A LAN-only Quest 3 workspace for monitoring par-mux panes and issuing occasional commands without a physical keyboard.

The desktop opens with sharp, flat terminal canvases at their natural text size. Use **3D preview** to inspect the spatial scene, or **Enter XR** on Quest.

The MVP candidate includes individual terminal panels, controller manipulation, global/workspace quick commands, a virtual keyboard, headset-local preferences, passthrough and silent black/gradient/observatory VR backgrounds. Named 3D layouts, radial menus, whole-window split views and hands are planned after MVP.

## Development

Use Node 24 or Bun 1.4.4, with Bun for packages and tasks:

```sh
bun install --frozen-lockfile
make checkall-ci
make dev
```

Open [the local app](http://localhost:4240). Use Demo for synthetic preview content. Demo does not connect to or execute commands on your computer.

`make dev-stop` stops only this checkout's listener on 4240 and waits for the port to clear. `make dev-restart` stops and starts it. Run long-lived development/streamer processes in a par-mux pane. Local verification uses reserved port 4241.

## Connect Real Panes

The computer must run a compatible mux-enabled par-term-streamer against the desired par-mux socket. Configure the streamer endpoint in the sidebar. This app reuses core protobuf/zlib streaming and does not create or kill pane processes. Physical panel size and local zoom do not change terminal rows/columns.

Full hierarchy browsing requires `mux_tree_request` / `mux_tree_snapshot` and `/ws?metadata=1`. Use the mux-enabled streamer and daemon from [core 0.76.0](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.76.0) or a verified compatible build. Both official macOS ARM64 release binaries passed the real-app check. The plain streamer build lacks mux support, and a `0.75` version string alone does not establish hierarchy support.

The prepared preview uses the official 0.76.0 streamer attached to the existing par-mux daemon and prefers its default workspace. Tests use separate private sockets. Exact binaries and historical verification are recorded in [the verification report](docs/verification.md). The vendored hierarchy schema was tested against 0.76.0. Core 0.76.0 ships [held-pane lifecycle metadata](https://board.example.test/board?card=01a1957a2aa8739abc2c5cb116818793); viewer exit-state badges remain a separate enhancement. A connected stream does not establish whether a held pane's process is still running.

Select a pane to attach it, then explicitly select its panel to target input. Commands and Keyboard follow explicit pane selections, including while the drawer is open. The target caption identifies the pane receiving input. Only the active input pane is highlighted. Enable **Gaze input** to let a short dwell choose the keyboard target. It is off by default and keeps the last target while you look at the keyboard.

Each desktop and XR terminal has **Close view** and **Disconnect / Reconnect** controls. Close view removes the virtual panel while its mux pane and shell continue running. Reopen it through Panes. Disconnect retains the panel, last image and placement, stops retries and rejects input. Reconnect attaches to the same pane without replaying input. Network interruptions still retry automatically. A malformed or incompatible stream shows a bounded error and waits for explicit Reconnect. Incoming frames accept the core's bounded 9 MiB payload size, including large initial scrollback seeds.

## Quest and LAN HTTPS

WebXR needs a secure context. Desktop localhost is suitable for development. Daily LAN access needs a certificate trusted by the headset and HTTPS/WSS endpoints. Vite can load existing certificate/key files via `MUX_XR_TLS_CERT` and `MUX_XR_TLS_KEY`; no credentials, certificates or trust stores are replaced automatically.

The prepared preview serves the built app and WebSockets at **[https://192.0.2.10:4240](https://192.0.2.10:4240)**, also available at `https://localhost:4240`. The full app passed from test-mac over LAN HTTPS/WSS with two private real shell panes and targeted command input. The current dedicated streamer mirrors the existing default par-mux daemon. Delivery preserves that daemon and pardeck services.

The existing IWSDK development PEM was reused. It is self-signed and covers localhost rather than the LAN IP, so the Quest browser needs an explicit certificate exception. Paul approved the exact preview binary's incoming-connection rule, which was applied and verified. Existing certificates, trust stores and credentials were preserved. Paul confirmed Quest Browser access and immersive XR entry on November 1, 2026. The refined controls still require a headset recheck.

To serve an already running compatible daemon, run the streamer in a par-mux pane with these arguments (supply your actual binary, socket and existing PEM paths):

```sh
/path/to/par-term-streamer --host 0.0.0.0 --port 4240 \
  --enable-http --web-root /Users/localuser/Repos/mux-xr/dist \
  --mux-socket /path/to/private.sock --tls-pem /path/to/existing.pem \
  --allowed-origins https://192.0.2.10:4240 \
  --allowed-origins https://localhost:4240
```

Stop that streamer with Ctrl-C in its owning pane. The prepared preview's exact upstream socket and streamer pane IDs are recorded in `.local/runtime.json`. Preserve existing authentication configuration and shared services. No published hosting or tunnels are required.

The endpoint is prefilled from the page origin, and a custom endpoint is remembered. The preview mirrors the existing par-mux daemon. Initial views prefer its default workspace/session, and existing panes keep their own programs and shell. On Quest, opening the preview automatically connects when the server field is populated. Choose two pane leaves, then Enter XR. Every XR UI surface (pane, keyboard, commands, hierarchy and workspace HUD) is a grabbable root. Grip one controller to move and rotate it: thumbstick X yaws and Y pitches, without Y translation. Grip plus trigger rolls around the controller laser axis with thumbstick X and pushes or pulls along it with thumbstick Y. Grip the same surface with both controllers to resize by spreading or bringing hands together, rotate by changing hand direction, and move it with the hand midpoint. Transforms persist while typing, retargeting and switching modes. The default keyboard remains small. Each terminal's A± controls zoom its text locally. Commands opens saved quick commands and their editor. Keyboard opens text entry and terminal keys. Both follow your pane selection, with optional Gaze input available in XR and browser settings. Shift shows uppercase letters and US-layout symbols, including `$`. A short modifier tap applies to one key. Hold Shift, Ctrl or Alt for about 550 ms to lock it until tapped again; locked keys are marked. Changing the input target clears locks. Settings offers passthrough and the three silent backgrounds.

## Spatial controls

Mouse clicks in 3D preview and controller triggers in VR use the same actions, with one input presenter per mode. Browser Keyboard/Commands use the compact DOM drawer; immersive VR uses spatial controls only. Hover with the mouse or aim a controller ray at a non-obvious control to see its explanation. DOM icon and modifier buttons also have browser hover titles.

| Control | Action |
| --- | --- |
| `A−` / `A+` | Zoom terminal text out or in locally. |
| Esc, Tab, arrows, Enter | Send that terminal key to the pane containing the strip. |
| Ctrl / Alt | Arm a modifier for the next strip key. |
| Commands / Widgets / Panes | Open saved commands, 3D clocks or hierarchy navigation from the XR HUD. Right-controller A toggles Keyboard. |
| Background selector | Choose Black, Gradient or Observatory from one compact menu. |
| Exit | Return to flat terminals in the browser, or end the immersive session in VR. |

The 3D preview toolbar always exposes **Smaller panel**, **Larger panel** and **Reset layout**, independently of pane geometry. Preview enlargement is bounded to keep the panel and attached controls inside the viewport. In VR, there are no dedicated physical resize or reset buttons. Hover help uses compact labels that scale with viewing distance after a 700 ms dwell, shows actions only and is hidden while gripping. If UI space is lost, release all grips and hold both thumbstick clicks for one second to recenter every pane, the HUD and input surfaces near the current headset position and reset physical scale. This recovery does not resize the PTY. Surface scale and text zoom leave terminal rows and columns unchanged.

Terminal grid size is changed only from the selected pane in browser Workspace Settings with numeric columns/rows and Apply, or from the native HUD Terminal settings. Native presets are 80x24, 100x30, 120x36 and 160x48, with ±1 and ±10 draft controls plus Apply. Columns and rows are bounded to 2..300 and 2..150. The controls are disabled while disconnected, and only an explicit Apply sends a resize; actual dimensions come back from the server as read-only state. Terminal colors are a saved global preference with Comfortable (default), Original and Monochrome modes. The native keyboard uses self-hosted OFL Noto Sans and Symbols 2 through Troika SDF 0.52.5; unsupported visual glyphs render as `?` while retaining the original title. Keyboard Backing is a saved browser/native-header toggle: off leaves key buttons visible, while the logical grabbable plane remains and can occlude gaze so the input target is retained. The native FPS HUD is an actual frame counter updated about every 500 ms, not a capacity benchmark.

Terminal windows can shrink to 0.3×, half the previous 0.6× minimum. The upper limit stays 1.8×. The HUD and input surfaces use matching background select menus with evenly spaced options and a shared saved value.

In XR, press **B on the right controller** while pointing at a terminal to enter Focus mode. With no terminal under the ray, it uses the active pane. The pane moves in front of your current view at a distance fitted to its size, while the other terminals fade out. Its placement stays fixed as your head moves, and the keyboard and HUD remain available. Press B again to restore its exact original position, rotation and scale and fade the other terminals back in. B is ignored while either grip is held. Selecting a different pane, applying an arrangement, recentering or leaving XR safely ends Focus mode. This never resizes the terminal grid or stops its process.

## Automatic terminal detail

In XR, the pane under your head-directed gaze always uses full raster quality, even with Gaze input off. Nearby terminals remain full quality. More distant terminals use half or quarter raster resolution and reduced update rates, with immediate restoration when looked at. This changes rendering only: keyboard targeting, selection highlights, terminal grids and UI label sharpness stay independent. Hidden focus-mode terminals continue receiving and parsing output. Desktop terminals return to full quality.

The observatory exterior adds stable star clusters and diffuse cloud bands. The existing authored planet texture loads through a self-hosted fallback without changing the security policy. See the [measured capacity comparison](docs/performance/terminal-lod-2026-11-02.md) for workload, limits and before/after results.

## Keyboard and workspace shortcuts

The desktop and XR keyboards use the same familiar key positions, with Enter at the right of the home row, wide Shift/Backspace/Space keys, and a separate inverted-T arrow cluster. Right-controller **A** toggles the keyboard. It preserves the keyboard pose and active target, and ignores presses made during a grip. **B** continues to toggle terminal Focus mode. A temporarily hidden keyboard retains its locks for the same target, while pane/context changes and XR exit clear them.

In **Arrange** or browser Workspace settings, use **Closer** and **Farther** to move all terminal panels together. Panel size, rotation, text zoom and terminal grids stay unchanged. Closer stops before the nearest panel enters the viewing space.

The observatory planet rotates slowly about its own center. A subtle shooting star occasionally crosses the exterior. Motion pauses outside the Observatory and in passthrough, with no sound. Terminal filtering is saved in Workspace Settings and native Terminal settings → Filtering. Choose Nearest, Linear, Mipmap crisp or Mipmap smooth, plus anisotropy Off/2×/4×/8×/16× (capped by the GPU). Mipmap smooth with 4× anisotropy is the base default. Sharper gaze is on by default: the head-gazed pane uses full raster quality and base-level linear sampling to favor clarity without reuploading textures, independently of Gaze input. Turn it off to keep the selected base filter on every pane. Physical headset clarity remains an owner recheck.

## Terminal mouse input

For TUIs that enable mouse tracking, point at the terminal and press the controller trigger for a left click. Hold the trigger and move the ray to drag, then release it. Movement is sent only over the captured pane, and the release stays with that pane. Grip suppresses mouse input and safely ends an existing drag before window manipulation. Desktop terminal canvases also support pointer click/drag. Mouse coordinates follow the remote grid, physical transforms and local text zoom. Disabled tracking, read-only and disconnected streams reject mouse input.

## Quick command setup

In XR, open **Commands → New command**. Select **Name** or **Command**, type with the virtual keys, choose **Global** or **Workspace** scope and whether running should append **Enter**, then **Save**. Saving stores the command on this device without running it. Run a saved command explicitly from the Commands menu. The browser drawer provides label/text fields and Save for the same command store.

Connected viewers retry dropped connections with capped backoff until detached. Unsent input is rejected and is never replayed after reconnect. Existing remote grid dimensions are adopted on attach, and the XR window follows server-confirmed rows/columns without moving or rescaling its root. Explicit grid Apply changes the remote grid; viewing and connecting do not.

## Spatial arrangements

Use **Workspace settings → 3D arrangement → Apply arrangement** in the browser, or **Arrange** on the XR HUD. Choose **Row**, **Grid**, **Arc** or **Sphere**. Browser Apply opens the 3D preview. Sphere distributes panels over the front of a spherical surface, curving horizontally and vertically as more terminals are attached, with every panel facing the viewer.

Presets apply to currently attached terminals around your current position and heading. They preserve each panel's physical size, text zoom, input target and remote grid. You can continue grabbing, rotating and scaling afterward. Opening another terminal does not reset existing panels. The last chosen preset is saved locally, but applying it remains explicit. Named saved layouts and animated restoration remain roadmap work.

Arrangement spacing measures each window's current grid geometry, title and controls, plus its manual physical scale. Layouts center those complete bounds and increase distance when viewer-facing windows would visually overlap. Physical scale, text zoom, input target and remote grids are preserved. Controller rays extend to reach arranged windows beyond the default ray length. Creating a new terminal through the viewer requires the pending opt-in core API, tracked by [the upstream card](https://board.example.test/board?card=01a1991e1e20727d8ff8a32afc0b212f). Existing default-workspace panes can already be attached.

The native HUD replaces its Keyboard button with **Widgets**. A still toggles the keyboard. Widgets adds a local-time digital or analog 3D clock. Grip either clock to move, rotate, push/pull or scale it like other UI. Its × closes only that clock. Grip stick left/right now uses the reversed yaw and laser-axis roll directions.

Keyboard and main-panel position, rotation and scale save on final grip release and XR exit. The next XR session restores them relative to the new headset position and heading. Both-stick recovery clears those saved poses while retaining commands and other preferences. Clock positions are currently session-local.

Arrangements keep the full terminal bounds above the Observatory deck or passthrough floor. Black and Gradient keep unrestricted vertical layouts. Stars use varied-size circular soft sprites in one draw call, with no flashing or audio.

## Verification

- `make checkall`: format/lint, TypeScript, unit tests and production build.
- `make checkall-ci`: fast gate plus asset-chain validation, secret scan and dependency audit.
- `MUX_XR_BASE_URL=https://localhost:4240 make production-label-check`: verify actual UI glyph pixels in a built app served with the streamer CSP. A Vite development server is not sufficient.
- `MUX_XR_PRIVATE_TEST=1 MUX_XR_BASE_URL=http://127.0.0.1:4241 MUX_XR_TEST_ROOT=/path/to/private/dist make widgets-clarity-check`: native widget, filter and pose checks using a private built fixture.
- `make e2e`: local native-GPU browser tests with explicitly synthetic protocol fixtures.
- `make real-app-check`: actual built app against a private compatible core pair, requiring `MUX_XR_PRIVATE_TEST=1` and `MUX_XR_BASE_URL`. It issues two harmless marker commands, so use isolated test panes.
- `MUX_XR_BASE_URL=http://127.0.0.1:4241 bun run scripts/xr-visual-check.ts`: native GPU rendering of the spatial keyboard using an explicit test XR camera/controller. This requires a Vite development server and does not replace headset testing.
- `make live-check`: real-streamer terminal-adapter diagnostic; requires `MUX_XR_STREAMER` and two `MUX_XR_PANES`. This is separate from full hierarchy and headset acceptance.

Browser tests use hardware Chromium headless on supported hosts. Book the host before load-sensitive work. Paul confirmed the build works in headset XR and provided the first controller/keyboard feedback. Updated controls, two-panel readability, passthrough, comfort and capacity still require owner acceptance. No maximum pane count is claimed before measurement.

The observatory's editable high/low sources, deterministic generator, hashes and technical reports are in `assets-source/observatory` and `scripts/assets`. The runtime GLB is 2,528,120 bytes with 22,712 triangles and ten draw calls. Creative owner approval and Quest checks remain explicit.

See [the verification report](docs/verification.md), [DESIGN.md](DESIGN.md), [PRD.md](PRD.md) and the [phase plans](plans/phase-0-live-terminal.md) for scope and dependencies.

The streamer's strict policy blocks blob workers, so Troika typesetting runs on the main thread. Label visibility is checked against the actual served build. Comfort colors replace blue-dominant terminal foregrounds with lighter, low-chroma teal; Original keeps source colors and Monochrome uses neutral foregrounds/backgrounds. Physical color-depth perception still needs a headset check.

## Frontend updates

Production builds include a content fingerprint in the page and a same-origin `version.json` manifest. The frontend checks immediately and every 30 seconds with a five-second request timeout and cache bypass. A changed build shows a compact **Update available / Reload** notice in the browser and an **Update: Reload** action on the XR HUD. On the desktop main page, detected updates reload automatically. In immersive XR, updates wait for the explicit Update: Reload action. Reload exits the immersive session first, then loads a fresh page with a cache-busting URL. Terminal processes remain running, and saved device preferences and commands remain in local storage.

The identifier covers the bundled application and public assets, so a font or environment asset update also triggers the notice. Development uses Vite's existing reload behavior rather than production polling.

Automated typing, grid, command and reconnect checks must target an isolated private daemon and streamer. Never point the private-test flag at the real/default mux daemon. Live delivery verification is limited to static frontend files and normal application startup.

Terminal updates compare visible cells and repaint only changed rows, including the old and new cursor rows. XR copies those row strips into a persistent GPU texture at the same pixel density. Unchanged output does not redraw text or upload a texture. Text size, color modes and grid dimensions stay independent of this optimization.

`MUX_XR_PRIVATE_TEST=1 MUX_XR_BASE_URL=http://127.0.0.1:4241 bun run scripts/terminal-texture-check.ts` checks actual WebGL pixels against the canvas reference using an isolated Vite server. It loads a blank fixture, verifies partial updates, orientation, resizing and UV transforms, and does not connect to a mux daemon.

`MUX_XR_BASE_URL=http://127.0.0.1:4241 MUX_XR_PRIVATE_TEST=1 bun run scripts/stream-lifecycle-check.ts` exercises four streams with every WebSocket intercepted. It covers a 3 MiB seed, manual disconnect, rejected input, reconnect without replay, close and reopen. Use an isolated static preview. `MUX_XR_SKIP_LIFECYCLE=1` measures a fixed four-pane, 149×54 workload with 6,400 packets. `MUX_XR_BASELINE=1` runs the same diagnostic against an older build. Timings describe desktop canvas cost and frame pacing, not Quest capacity or a headset FPS gate.
