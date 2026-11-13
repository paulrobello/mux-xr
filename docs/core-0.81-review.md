# par-term emu core 0.81.0 review

Mux XR reviewed the official `par-term-emu-core-rust` v0.81.0 release at commit `8b3cc8d61f787b90b673180764ad6d2a3cb4b35b`, three releases after the qualified v0.78.1.

- Mux archive SHA-256: `8591bf8598501a82512d9042788b6e56ddfdd9c544da601173fca0e0581cab85`
- Streamer binary SHA-256: `3a24b4aa291922a107760be43ab675f566113a7279f914d4728e60f2f7ea9009`, matching the release's own `.sha256` file.
- Vendored `terminal_pb.ts` SHA-256: `a726195a354a549da216b5a6ffd1faa8359a4e8f10d98d5e32bf56fb67d6c35b`.

Sources: [v0.81.0 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.81.0) and the `CHANGELOG.md` at that tag. The 0.79.0 to 0.81.0 releases have no release notes of their own.

## Protocol

Every change is an optional field, so this client and older streamers stay compatible in both directions:

- `Connected.paneCreateAllowed`: the streamer says at handshake whether it will create panes (`--allow-pane-create` and a writable connection).
- `Connected.cwdHostname` and `Connected.cwdIsLocal`, and `CwdChanged.isLocal`: mux-backed panes now report their working directory, filed from mux-xr as core card 01a1ce6a.
- `PaneCreateRequest.name`: an optional window name of up to 64 bytes with no control characters, passed to `new-window -n`. Filed from mux-xr as core card 01a1d0d5.

## Adopted in this pin

- The terminal surface reads the cwd hostname from `Connected`, so the git and CI widget knows the cwd host from the first frame instead of waiting for a `CwdChanged`.

## Benefits that need the 0.81.0 streamer running

- Pane cwd for mux-backed sessions, which the git and CI widget depends on.
- `paneCreateAllowed` lets the create-pane controls show "unavailable" before the first attempt. Today they learn it from a refusal.
- Named windows for panes created from XR.
- Agent roster presence stamps refresh every 60 seconds, and `report-state` claims and blocked reasons arrive in roster deltas. Both improve the agent board with no client change.
- After a broadcast lag, the stream re-sends the pane's process state, so a held pane that exited no longer shows as running.
- `worktree-remove -f`, `kill-window` and `kill-session` release agent-roster rows, so the board stops showing ghost agents.

## Qualification

On November 12, 2026, the official 0.81.0 streamer was run on loopback against a private par-mux 0.80.0 daemon (`0.80.0+e9d8f33c`, the same version as the shared default daemon) on its own socket.

- `scripts/pane-lifecycle-check.ts` passed: the client saw `exited(3)` and then `running` on the same stream.
- `scripts/real-app-check.ts` passed with no errors. Two panes in separate sessions held 80×24 with zero baseline Resize messages. An explicit 100×30 resize restored to 80×24 with exactly two wire resizes. Renderer: `ANGLE Metal Renderer: Apple M4 Max`.
- The first real-app run failed at the 100×30 resize because the private panes were split inside one window. The unchanged 0.78.1 binary failed at the same step on that layout, and both pass with one pane per session. This is a functional check, run at a 1-minute load of 52 to 79. It makes no timing claim.

## LAN deployment

- Since 0.80.0 the streamer refuses a non-loopback bind that serves shells without authentication unless `--allow-unauthenticated` is passed. Paul chose that flag on November 12, 2026. The LAN preview keeps TLS and its origin allow-list, and has no authentication.
- The 0.81.0 binary replaced `.local/bin/streamer-candidate` in place, and the 0.78.1 binary is kept as `.local/bin/streamer-candidate-0.78.1`. Both are signed with the same Developer ID identity. The macOS firewall rule for that path still admits it: test-mac fetched `https://192.0.2.10:4240/` with HTTP 200.
- The `mux-xr-streamer` pane was respawned with its previous flags plus `--allow-unauthenticated`. The default par-mux daemon was not restarted. The browser e2e suite passed on all three viewports against the live streamer.
