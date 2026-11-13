# Testing Mux XR

Run these commands from the repository root. Install the pinned dependencies with `bun install --frozen-lockfile`. The full local gate also requires `uv` and `gitleaks` on PATH.

## Local gates

- `make checkall` runs Biome, TypeScript, unit tests, and the production build.
- `make checkall-ci` adds asset validation, secret scanning, and the dependency audit.

There are no tracked CI workflows. `make checkall-ci` is the full local gate. The browser and live-streamer checks below run separately.

## Browser fixtures

Install the Chromium revision pinned by Playwright with `bunx playwright install chromium --no-shell --no-remove`. Run `make e2e` against a local app. Set `MUX_XR_BASE_URL` if the app is on a different port. The suite uses synthetic protocol fixtures across desktop, tablet, and mobile viewports.

Browser tests use hardware Chromium headless on supported hosts. Book the host before load-sensitive work and record the renderer and load for performance results.

- `MUX_XR_BASE_URL=https://localhost:4240 make production-label-check`: verify actual UI glyph pixels in a built app served with the streamer CSP. A Vite development server is not sufficient.
- `MUX_XR_PRIVATE_TEST=1 MUX_XR_BASE_URL=http://127.0.0.1:4241 MUX_XR_TEST_ROOT=/path/to/private/dist make widgets-clarity-check`: native widget, filter and pose checks using a private built fixture.
- `MUX_XR_PRIVATE_TEST=1 MUX_XR_TEST_ROOT=/path/to/private/dist make hierarchy-check`: private loopback GPU check for both hierarchy styles, browser/native synchronization, navigation, screenshots and reload persistence.
- `MUX_XR_PRIVATE_TEST=1 MUX_XR_TEST_ROOT=/path/to/private/dist make input-refinement-check`: private loopback Metal-GPU check for hierarchy, keyboard curvature, warped rims and injected fake speech recognition. It does not prove microphone, transcription service or physical Quest voice support.
- `MUX_XR_BASE_URL=http://127.0.0.1:4241 bun run scripts/xr-visual-check.ts`: native GPU rendering of the spatial keyboard using an explicit test XR camera/controller. This requires a Vite development server and does not replace headset testing.

The streamer’s CSP blocks blob workers. Troika typesets native labels on the main thread with bundled fonts. Check actual glyph pixels in the production build when changing that path.

### Terminal rendering and stream fixtures

`MUX_XR_PRIVATE_TEST=1 MUX_XR_BASE_URL=http://127.0.0.1:4241 bun run scripts/terminal-texture-check.ts` checks actual WebGL pixels against the canvas reference using an isolated Vite server. It loads a blank fixture, verifies partial updates, orientation, resizing and UV transforms, and does not connect to a mux daemon.

`MUX_XR_BASE_URL=http://127.0.0.1:4241 MUX_XR_PRIVATE_TEST=1 bun run scripts/stream-lifecycle-check.ts` exercises four streams with every WebSocket intercepted. It covers a 3 MiB seed, manual disconnect, rejected input, reconnect without replay, close and reopen. Use an isolated static preview. `MUX_XR_SKIP_LIFECYCLE=1` measures a fixed four-pane, 149×54 workload with 6,400 packets. `MUX_XR_BASELINE=1` runs the same diagnostic against an older build. Timings describe desktop canvas cost and frame pacing, not Quest capacity or a headset FPS gate.

## Private real-streamer checks

Use an isolated daemon socket, streamer, and test panes. The prepared LAN preview uses the shared default daemon. Restrict live delivery verification to static frontend files and normal application startup.

- `MUX_XR_PRIVATE_TEST=1 MUX_XR_MUX_SOCKET=/private/par-mux.sock make agent-roster-app-check`: runs the built app on a private loopback streamer. It reports hook agent states and checks live roster rows, attaching a pane from its row with no resize, and removal of a killed pane. `MUX_XR_REASON_ONLY=1` instead checks the reason shown after a fresh streamer start. Its panes need running `claude`/`codex` processes so the daemon keeps the claims.
- `make real-app-check`: actual built app against a private compatible core pair, requiring `MUX_XR_PRIVATE_TEST=1` and `MUX_XR_BASE_URL`. It issues two harmless marker commands, so use isolated test panes.
- `make live-check`: runs a terminal-adapter diagnostic against a real streamer. It requires `MUX_XR_STREAMER` and two `MUX_XR_PANES`. This is separate from full hierarchy and headset acceptance.

Use `make pane-create-check` and `make pane-create-app-check` to verify the pane-create protocol and the built app respectively against a private streamer. See the [core 0.81 review](core-0.81-review.md#pane-create-adoption-check) for qualification details.

## Physical Quest checks

Browser and simulated XR checks establish software behavior. Verify real controller and hand interactions, text readability, passthrough, microphone permissions, and comfort on the headset. Capacity and frame pacing require a measured headset workload. The owner reported that the controller build worked well on Quest 3. Hand input still requires physical acceptance.

## Evidence

See [historical verification](verification.md), [core compatibility](core-0.81-review.md), and the [performance reports](performance/) for recorded results.

The observatory's editable high/low sources, deterministic generator, hashes and technical reports are in [assets-source/observatory](../assets-source/observatory) and [scripts/assets](../scripts/assets). The runtime GLB is 2,528,120 bytes with 22,712 triangles and ten draw calls. Creative owner approval and Quest checks remain explicit.
