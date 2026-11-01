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

The prepared preview still uses the independently gated matching `95dbb69f` daemon/streamer pair. Its exact binaries and the tested release hashes are recorded in [the verification report](docs/verification.md). The vendored schema matches that hierarchy candidate and was also tested against 0.76.0. Core 0.76.0 ships [held-pane lifecycle metadata](https://board.example.test/board?card=01a1957a2aa8739abc2c5cb116818793); viewer exit-state badges remain a separate enhancement. A connected stream does not establish whether a held pane's process is still running.

Select a pane to attach it, then explicitly select its panel to target input. Commands and Keyboard follow explicit pane selections, including while the drawer is open. The target caption identifies the pane receiving input. Head-directed gaze affects visual emphasis only. Detach closes the viewer connection, preserving the pane.

## Quest and LAN HTTPS

WebXR needs a secure context. Desktop localhost is suitable for development. Daily LAN access needs a certificate trusted by the headset and HTTPS/WSS endpoints. Vite can load existing certificate/key files via `MUX_XR_TLS_CERT` and `MUX_XR_TLS_KEY`; no credentials, certificates or trust stores are replaced automatically.

The prepared preview serves the built app and WebSockets at **[https://192.0.2.10:4240](https://192.0.2.10:4240)**, also available at `https://localhost:4240`. The full app passed from test-mac over LAN HTTPS/WSS with two real shell panes and targeted command input. It uses a dedicated matching daemon and leaves shared par-mux and pardeck services unchanged. To view existing sessions, point a compatible streamer at their daemon socket.

The existing IWSDK development PEM was reused. It is self-signed and covers localhost rather than the LAN IP, so the Quest browser needs an explicit certificate exception. Paul approved the exact preview binary's incoming-connection rule, which was applied and verified. Existing certificates, trust stores and credentials were preserved. Headset trust and XR entry remain owner checks.

To serve an already running compatible daemon, run the streamer in a par-mux pane with these arguments (supply your actual binary, socket and existing PEM paths):

```sh
/path/to/par-term-streamer --host 0.0.0.0 --port 4240 \
  --enable-http --web-root /Users/localuser/Repos/mux-xr/dist \
  --mux-socket /path/to/private.sock --tls-pem /path/to/existing.pem \
  --allowed-origins https://192.0.2.10:4240 \
  --allowed-origins https://localhost:4240
```

Stop that streamer with Ctrl-C in its owning pane. The prepared preview's exact private socket and pane IDs are recorded in `.local/runtime.json`; its shell panes are ordinary live shells. Preserve existing authentication configuration and shared services. No published hosting or tunnels are required.

The endpoint is prefilled from the page origin, and a custom endpoint is remembered. The dedicated preview panes use the account's configured Homebrew Bash login shell. On Quest, open the preview and press Connect. Choose two pane leaves, then Enter XR. Use trigger to select controls and grip on a panel to move/rotate it. Panel ± controls adjust physical size, A± controls local text zoom. Commands opens saved quick commands and their editor. Keyboard opens text entry and terminal keys. Both follow your explicit pane selection. Shift shows uppercase letters and US-layout symbols, including `$`, then resets after a character. Settings offers passthrough and the three silent backgrounds.

## Spatial controls

Mouse clicks in 3D preview and controller triggers in VR use the same actions. Hover with the mouse or aim a controller ray at a non-obvious control to see its explanation. DOM icon and modifier buttons also have browser hover titles.

| Control | Action |
| --- | --- |
| `−` / `+` | Shrink or enlarge the physical panel. |
| `A−` / `A+` | Zoom terminal text out or in locally. |
| Esc, Tab, arrows, Enter | Send that terminal key to the pane containing the strip. |
| Ctrl / Alt | Arm a modifier for the next strip key. |
| Commands / Keyboard / Panes | Open saved commands, terminal input or hierarchy navigation. |
| Black / Gradient / Observatory | Change the VR background. |
| Exit | Return to flat terminals in the browser, or end the immersive session in VR. |

Panel scale and text zoom leave terminal rows and columns unchanged. Neighboring panels' default control positions are separated so resize buttons do not overlap.

## Verification

- `make checkall`: format/lint, TypeScript, unit tests and production build.
- `make checkall-ci`: fast gate plus asset-chain validation, secret scan and dependency audit.
- `make e2e`: local native-GPU browser tests with explicitly synthetic protocol fixtures.
- `make real-app-check`: actual built app against a private compatible core pair, requiring `MUX_XR_PRIVATE_TEST=1` and `MUX_XR_BASE_URL`. It issues two harmless marker commands, so use isolated test panes.
- `make live-check`: real-streamer terminal-adapter diagnostic; requires `MUX_XR_STREAMER` and two `MUX_XR_PANES`. This is separate from full hierarchy and headset acceptance.

Browser tests use hardware Chromium headless on supported hosts. Book the host before load-sensitive work. Paul requested the tested build first and will perform the Quest checks afterward. Actual Quest controller behavior, two-panel readability, passthrough and capacity remain pending owner acceptance. No maximum pane count is claimed before measurement.

The observatory's editable high/low sources, deterministic generator, hashes and technical reports are in `assets-source/observatory` and `scripts/assets`. The runtime GLB is 2,528,120 bytes with 22,712 triangles and ten draw calls. Creative owner approval and Quest checks remain explicit.

See [the verification report](docs/verification.md), [DESIGN.md](DESIGN.md), [PRD.md](PRD.md) and the [phase plans](plans/phase-0-live-terminal.md) for scope and dependencies.
