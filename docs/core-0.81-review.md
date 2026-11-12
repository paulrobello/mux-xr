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

## Before upgrading the LAN streamer

- Since 0.80.0 the streamer refuses a non-loopback bind that serves shells without authentication unless `--allow-unauthenticated` is passed. The LAN preview binds `0.0.0.0` with TLS and no authentication. The alternatives are that flag, or an API key or HTTP password that the client would have to send.
- The macOS application firewall rule approved on November 1, 2026 applies to the current binary at `.local/bin/streamer-candidate` (see [verification](verification.md)). Replacing that file may require approving the rule again before the headset can connect.
- The 0.81.0 binaries need the same real-app check the 0.78.1 pair passed.
