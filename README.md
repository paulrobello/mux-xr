# Mux XR

A LAN-only Quest 3 workspace for monitoring par-mux panes and issuing occasional commands without a physical keyboard.

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

Full hierarchy browsing requires the core `mux_tree_request` / `mux_tree_snapshot` surface and `/ws?metadata=1`. [The upstream hierarchy card](https://board.example.test/board?card=01a19579caef72cb9ccc955871ab48c7) passed its gates and merged into core local main at `95dbb69f1d8ee5d655361c19334a192c10c4c8e8`. Published version 0.75 alone is not proof of support. Use the matching daemon from that same commit (SHA-256 `0a355456e59e28826891c661eafc5db4ebe2219d5c3a25c618d096ab33269ddd`), since older daemons lack geometry format fields. The compatible local candidate streamer binary has SHA-256 `4ba594b75cccaa23f73818296879248e07137090abd8bd95eaf497c4ac25a924`; it is not yet the release artifact. The vendored generated schema matches that candidate. [Held-pane lifecycle metadata](https://board.example.test/board?card=01a1957a2aa8739abc2c5cb116818793) is a separate, non-blocking enhancement. A connected stream does not establish whether a held pane's process is still running.

Select a pane to attach it, then explicitly select its panel to target input. Opening Commands or Keyboard binds its target until dismissed/reopened. Head-directed gaze affects visual emphasis only. Detach closes the viewer connection, preserving the pane.

## Quest and LAN HTTPS

WebXR needs a secure context. Desktop localhost is suitable for development. Daily LAN access needs a certificate trusted by the headset and HTTPS/WSS endpoints. Vite can load existing certificate/key files via `MUX_XR_TLS_CERT` and `MUX_XR_TLS_KEY`; no credentials, certificates or trust stores are replaced automatically.

The prepared local preview serves the built app and WebSockets on `https://localhost:4240`. Its intended LAN URL is `https://192.0.2.10:4240`, pending macOS Firewall incoming-connection permission for the dedicated candidate binary. Local HTTPS responds, while LAN probes currently time out. It uses a dedicated matching daemon with two real shell panes, leaving the shared default daemon and pardeck service running unchanged. This preview does not expose the existing shared daemon's sessions until that daemon is upgraded separately.

The existing IWSDK development PEM was reused locally. It is self-signed and covers localhost rather than the LAN IP, so the Quest browser will need an explicit certificate exception. No certificates, trust stores, firewall rules or credentials were generated or replaced. Headset trust and XR entry are pending owner checks.

To serve an already running compatible daemon, run the streamer in a par-mux pane with these arguments (supply your actual binary, socket and existing PEM paths):

```sh
/path/to/par-term-streamer --host 0.0.0.0 --port 4240 \
  --enable-http --web-root /Users/localuser/Repos/mux-xr/dist \
  --mux-socket /path/to/private.sock --tls-pem /path/to/existing.pem \
  --allowed-origins https://192.0.2.10:4240 \
  --allowed-origins https://localhost:4240
```

Stop that streamer with Ctrl-C in its owning pane. The prepared preview's exact private socket and pane IDs are recorded in `.local/runtime.json`; its shell panes are ordinary live shells. Preserve existing authentication configuration and shared services. No published hosting or tunnels are required.

On Quest, open the preview, enter `https://192.0.2.10:4240` as the endpoint and press Connect. Choose two pane leaves, then Enter XR. Use trigger to select controls and grip on a panel to move/rotate it. Panel ± controls adjust physical size, A± controls local text zoom. Commands and Keyboard bind the selected pane until dismissed. Settings offers passthrough and the three silent backgrounds.

## Verification

- `make checkall`: format/lint, TypeScript, unit tests and production build.
- `make checkall-ci`: fast gate plus asset-chain validation, secret scan and dependency audit.
- `make e2e`: local native-GPU browser tests with explicitly synthetic protocol fixtures.
- `make real-app-check`: actual built app against a private compatible core pair, requiring `MUX_XR_PRIVATE_TEST=1` and `MUX_XR_BASE_URL`. It issues two harmless marker commands, so use isolated test panes.
- `make live-check`: real-streamer terminal-adapter diagnostic; requires `MUX_XR_STREAMER` and two `MUX_XR_PANES`. This is separate from full hierarchy and headset acceptance.

Browser tests use hardware Chromium headless on supported hosts. Book the host before load-sensitive work. Paul requested the tested build first and will perform the Quest checks afterward. Actual Quest controller behavior, two-panel readability, passthrough and capacity remain pending owner acceptance. No maximum pane count is claimed before measurement.

The observatory's editable high/low sources, deterministic generator, hashes and technical reports are in `assets-source/observatory` and `scripts/assets`. The runtime GLB is 2,528,120 bytes with 22,712 triangles and ten draw calls. Creative owner approval and Quest checks remain explicit.

See [the verification report](docs/verification.md), [DESIGN.md](DESIGN.md), [PRD.md](PRD.md) and the [phase plans](plans/phase-0-live-terminal.md) for scope and dependencies.
