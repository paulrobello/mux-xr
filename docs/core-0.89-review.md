# par-term emu core 0.89.0 review

Mux XR reviewed the official v0.89.0 release at commit `bf095c0fee7a11f9ddd8700c895485cfe2f648fd`, covering both 0.88.0 and 0.89.0 since the previous 0.87.0 pin.

## Artifact and protocol verification

- Mux archive SHA-256: `8602bca5678b4ca71944f5c8ed6814257a5e3b5059ac869f49db155f5f0dac87`, matching the release checksum file.
- Streamer SHA-256: `57de43ffdb9a85942a208a49a35a50244f1a5c2f58e3e1de8f23a1d0cfa666c7`, matching the release sidecar.
- Both detached minisign signatures verify with the upstream pinned public key `7D5A457F1AB85B55`. Both extracted Apple executables pass `codesign --verify --strict`.
- The generated `terminal_pb.ts` at the release tag is byte-identical to the vendored binding: SHA-256 `149c4be5e774aae1f6353acd9f036e1d07ae910cbee0ec666954280c1fb1f031`. No binding replacement or client protocol change is required.

Sources: [v0.89.0 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.89.0), [tagged changelog](https://github.com/paulrobello/par-term-emu-core-rust/blob/v0.89.0/CHANGELOG.md), and [signature check script](https://github.com/paulrobello/par-term-emu-core-rust/blob/v0.89.0/scripts/check-release-signatures.sh).

## Useful changes

- **HTML script nonces (0.88):** the streamer replaces inline-script permission with per-response nonces and rewrites script tags. The production app passes the private real-app check under this policy. LAN HTML also returns the nonce policy, retaining `connect-src` permission for `blob:` textures. No client change is needed.
- **Signed release artifacts (0.88):** detached minisign signatures provide an authenticity check in addition to hashes. Both downloaded artifacts were verified for this pin.
- **Replay generation fences (0.88 and 0.89):** daemon output and replay replies carry generation stamps. The native attach renderer and passthrough attach client drop replay-covered late output, preventing duplicate application and corrupted grids on resynchronization. These are native attach fixes, not evidence of a new browser feature or a browser reconnect fix.
- **Antigravity agent integration (0.88):** core can identify agy panes, report working/idle state, install hooks, and resume conversations. Useful to the shared daemon's roster without an XR protocol change. Hook installation was not changed in this update.
- **Robustness (0.88):** mouse-mode desynchronization degrades instead of panicking, and off-grid DECSERA rectangles no longer panic the terminal core.
- **Doctor attribution (0.88):** a self-responsible, Developer-ID-signed daemon reports `stable-identity` rather than `tainted`. The restarted default daemon confirms this verdict.

## Compatibility boundaries

Core 0.89 rejects legacy htpasswd formats by default on its library path, matching the standalone streamer's existing policy. This pin preserves the LAN API-key file, query-key option, TLS and origins. No credentials or authentication options were changed. Other upstream changes concern native divider dragging, Windows file locking, download redirects, benchmark tooling and removal of an unused Rust Broadcaster API, not new XR controls.

## Qualification

Verified November 23, 2026 (America/Los_Angeles):

- `make checkall` and `make checkall-ci` passed: protocol hash, Biome, strict TypeScript, Vitest, production build, observatory assets, Gitleaks and high-severity dependency audit.
- `make real-app-check` passed against an isolated official 0.89.0 daemon and streamer with the production build. Both panes echoed marker commands. Baseline resize count was zero. Explicit resize observed 100×30, restored 80×24, with exactly two wire resizes. The check reported no errors and used the Apple M4 Max Metal renderer.
- Playwright's required Chromium revision was installed after the first attempt reported a missing executable. The subsequent run passed. Host load was above 15, so this is functional evidence only, not a timing or capacity measurement.
- The private daemon and streamer were stopped. Physical Quest acceptance was not performed.

## Local installation and restart

The pristine release streamer and daemon were staged in the stable checkout's gitignored `.local/bin`, retaining the previous 0.87.0 copies. The PATH daemon was already a team-signed 0.89.0 build. With explicit owner approval, `par-mux --restart` routed through the launchd job. That restart interrupted this agent's shell, but subsequent checks confirmed a new daemon reporting `0.89.0+bf095c0f` and `stable-identity`.

The LAN streamer restored automatically in its existing pane with version 0.89.0 and the original TLS, origins, API-key-file, query-key and session-limit options. Its HTTPS root returned 200 and the new nonce-based CSP. The frontend is served from the stable checkout's `dist`; rebuilding that checkout after merging supplies the updated build. Exact local addresses and process details remain in gitignored local configuration.
