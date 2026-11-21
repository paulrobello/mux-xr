# par-term emu core 0.86.0 review

Mux XR reviewed the official `par-term-emu-core-rust` v0.86.0 release at commit `39887b12fa047e8037d12127810a166e10ea4209`, four releases after the qualified v0.83.0 pin (0.84.0, 0.84.1, 0.85.0, 0.86.0).

- Mux archive SHA-256: `295518e355ebb8f7065493e851de8469a3218439fc7048350f5b168652d0a7cf`, matching the release's own `SHA256SUMS.txt`.
- Streamer binary SHA-256: `14fdfb5e81edde7900999c3231d35b170c8e5a796502eef6441cff88534061a7`, matching the release's own `.sha256` file.
- Vendored `terminal_pb.ts` SHA-256: `149c4be5e774aae1f6353acd9f036e1d07ae910cbee0ec666954280c1fb1f031`.

Sources: the [v0.86.0 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.86.0) and the `CHANGELOG.md` at that tag. The 0.84.0 to 0.85.0 releases have no release notes of their own.

## Protocol

One optional field, so this client and older streamers stay compatible in both directions:

- `Connected.paneResizeReflow` (field 17, ENH-045): present when the session terminal reflows resizes xterm-style. The mode is a daemon-side opt-in (`--xterm-resize-reflow` at daemon start, flag/env/file tiers). The streamer's per-pane mirror terminal enables the same mode from the pane-info `reflow=1` token, so a reflow-enabled daemon gives mux-xr viewers reflowed content with no client change. Absent means a pre-0.84 streamer, or the visible-screen-only default.

## Adopted in this pin

- Pin and documentation only. `paneResizeReflow` is informational for this client: mux-xr keeps the explicit-Apply resize contract, and the reflow mode changes what the daemon and streamer mirror produce, not what the client sends. Surfacing the flag in pane info is a possible follow-up, not part of this pin.

## Changes 0.84–0.86 with mux-xr relevance

- Core emulator: `EL 0` and `ECH` now clear the row's wrapped flag like xterm's ClearRight (card 01a1f016). Rendering correctness at the right margin; arrives with the 0.86.0 streamer, and daemon-side panes get it with a daemon restart.
- Attach reaches daemons by explicit path and pane env socket (0.84.1), and a window switch-back replays the landed window's panes (0.85.0). Both are attach-path robustness for mux-backed sessions.
- Pane and session env moved out of the state file into 0600 sidecars, and pane terminal grids moved out of the state file — format v4 (0.85.0). Daemon-side; smaller state file and no secrets in it.
- Agent panes resume in the agent's own cwd instead of the shell's (0.85.0) — agent roster rows resume where the agent worked.
- `par-mux --restart` routes a launchd-managed default-instance daemon through its launchd job (0.86.0). Relevant to the shared default daemon on this host when a restart is approved.
- Installed artifacts are Developer-ID-signed with stable identifiers (0.85.0). Both 0.86.0 Apple binaries carry the `QMLVG482FY` Developer ID signature and pass `codesign --verify --strict`.
- Windows: the claude-mod env merge is escaped and platform-separator-safe (0.84.0), fixing settings corruption.

## Benefits that need the 0.86.0 streamer running

- The emulator wrapped-flag fix in pane rendering.
- Xterm-style resize reflow, when the daemon opts in with `--xterm-resize-reflow`.

## Qualification

On November 21, 2026, the official 0.86.0 streamer and par-mux archive ran on loopback.

- `make pane-lifecycle-check` passed with the 0.86.0 streamer and a private 0.86.0 daemon (`0.86.0+39887b1`): the client saw `exited(3)` and then `running` on the same stream. Functional check, 1-minute load 64, no timing claim.
- `make real-app-check` passed with the built app against a private 0.86.0 daemon and the 0.86.0 streamer on loopback 4241. Two panes in separate sessions held 80×24 with zero baseline Resize messages. An explicit 100×30 resize restored to 80×24 with exactly two wire resizes. Errors: none. Functional check, 1-minute load 61 to 97, no timing claim.
- First executions of the freshly downloaded streamer were SIGKILLed while the 1-minute load sat above 78; a fresh exec minutes later ran the identical (hash-matching, strictly valid Developer ID signature) binary without change. Recorded as a transient first-exec assessment flake under host load, not an artifact defect.

## LAN deployment

- `.local/bin/streamer-candidate` holds the pristine release bytes (hash matches the pin), Developer ID signed. The previous 0.83.0 binary is kept as `.local/bin/streamer-candidate-0.83.0`.
- The LAN streamer pane `%2849` in session `mux-xr-lan` (Director workspace, shared default daemon) runs the candidate with its existing TLS, origin, api-key-file and `--max-sessions 64` flags preserved. The default daemon was not restarted and keeps its authentication configuration.
- Verification: the LAN preview URL served the rebuilt app with HTTP 200 (api-key gates the stream websockets, not static files), and a headless Chromium load of the LAN URL mounted the app with the renderer canvas present. Its only error, a GLTF texture `blob:` fetch blocked by `connect-src 'self'`, appears identically on the 0.83.0 streamer in an A/B on loopback — pre-existing, not an upgrade regression. Stream websocket authentication was not exercised (the key lives in app settings, which a fresh headless profile does not carry).
