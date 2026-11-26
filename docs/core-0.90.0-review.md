# par-term emu core 0.90.0 review

Mux XR reviewed the official v0.90.0 release at commit `6c87ffdc484a01b2a2d65693743c3039f40c7dc5`, one day after the 0.89.0 pin.

## Artifact and protocol verification

- Mux archive SHA-256: `d02d2c97aa95b4f11e6c74510755f9e7330214283b1d35be4b67fd4c71c5c30a`, matching the release checksum file.
- Streamer SHA-256: `e042a1a1656dbee27c220599b9158001506086db55bef9939efd3d7268d3df10`, matching the release sidecar.
- Both detached minisign signatures verify with the upstream pinned public key `7D5A457F1AB85B55`. Both extracted Apple executables pass `codesign --verify --strict`.
- The generated `terminal_pb.ts` at the release tag is byte-identical to the vendored binding: SHA-256 `149c4be5e774aae1f6353acd9f036e1d07ae910cbee0ec666954280c1fb1f031`. No binding replacement or client protocol change is required.

Sources: [v0.90.0 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.90.0), [tagged changelog](https://github.com/paulrobello/par-term-emu-core-rust/blob/v0.90.0/CHANGELOG.md), and [signature check script](https://github.com/paulrobello/par-term-emu-core-rust/blob/v0.90.0/scripts/check-release-signatures.sh).

## Useful changes

- **Mux-mirror replay fence closes the 0.89 review gap (`d70350ac`, card 01a20beb):** the streaming bridge now parses `gen=<N>` off the seed reply's closing flags (`command_with_generation`) and drops `%output` chunks stamped at or before it — on the initial seed and on every in-place re-seed (workspace retarget, respawn re-seed). A daemon restart while a browser viewer is attached can no longer double-apply a replay-covered chunk onto the mirror `Terminal`. An unfenced seed (pre-fence daemon) feeds as before, so mixed-version pairs degrade to exactly the previous behavior. Pinned upstream by `a_chunk_stamped_at_or_before_the_seed_fence_is_dropped` and `an_unfenced_link_feeds_stamped_chunks`; the passthrough-attach parity question from the gap card is answered — attach clears then re-arms its fence on resync while the streaming bridge re-arms atomically from each re-seed, strictly stronger.
- **The locally installed streamer ships mux support by default:** `streamer-install` builds `--features streaming-bin`, whose feature set now carries the mux mirror bridge, so `cargo`-installed `par-term-streamer` 0.90.0 accepts `--mux-socket` without a separate mux-enabled build. The release still publishes plain and `-mux-` variants; the pinned `-mux-` release artifact remains this project's qualified LAN source.
- **Agent resume keeps original launch arguments (`303c27e1`, card 01a20bde):** a daemon restore composes the agent's original launch argv with a resume shape rebuilt from the persisted session, instead of re-running the hook's minimal resume invocation. `agent_launch_argv` is serde-defaulted, so older state files restore unchanged. Daemon-side; the browser agent roster benefits once the daemon runs 0.90.
- **Payload-free transfer summaries (SEC-010, `d0bf0aa1`):** `Terminal::transfer_summaries()` returns id, filename, direction, status and byte counts without cloning accumulated payload bytes (previously one poll cloned a full payload copy, and the manager had no public borrow path). Native API only — no browser protocol change; the browser already receives the `FileTransfer*` event stream.
- **Bounded par-mux client notification queue (SEC-012, `27302ab9`):** the control-mode client reader gates pushes through an 8 MiB byte ledger and closes the connection past it — the daemon's own eviction policy, chosen over silent drop-oldest — instead of growing memory while a frontend stalls. par-mux CLI client-side.
- **Ops hardening (`5d3792a`, scripts):** `make fleet-par-mux-update` minisign-verifies and deploys releases to minimac and the lennys; the JSON-era streaming test clients were rewritten as protobuf clients with real pass/fail exit codes; the bench gate bootstraps baselines predating the bench feature.

## Compatibility boundaries

No protocol, CSP, auth or origin changes affect Mux XR: the binding is byte-identical, the 0.88 nonce CSP is unchanged, and 0.89's legacy-htpasswd refusal did not move. The remaining changes concern native attach plumbing, daemon persistence internals, Python packaging and CI tooling. The fence is backward compatible in both directions — an unfenced seed feeds unfenced, and 0.88+ daemons already stamp the generation.

## Known upstream gap

None new. The mirror-bridge replay-fence gap recorded in the [0.89 review](core-0.89-review.md) is fixed by this release; upstream card `01a20beb` closed with the fix shipped.

## Qualification

Verified November 25, 2026 (America/Los_Angeles):

- `make checkall` and `make checkall-ci` passed: protocol hash, Biome, strict TypeScript, Vitest (2114 passed, 1 skipped), production build, bundle budget, observatory assets, Gitleaks and the high-severity dependency audit.
- `make real-app-check` passed against an isolated official 0.90.0 daemon and streamer pair with the production build. Both panes echoed marker commands. Baseline resize count was zero. Explicit resize observed 100×30, restored 80×24, with exactly two wire resizes. The check reported no errors and used the Apple M4 Max Metal renderer.
- Host load was ~31 (a higher-priority booked window overlapped; these gates ran load-tolerant), so this is functional evidence only, not a timing or capacity measurement.
- The private daemon and streamer were stopped after the check. Physical Quest acceptance was not performed.

## Local installation and restart

The core repo's local `make install` put 0.90.0 `par-mux` and mux-enabled `par-term-streamer` binaries in `~/.cargo/bin`. The running default daemon predates that install and still reports `0.89.0+bf095c0f`; picking up 0.90 needs the owner-gated `par-mux --restart` (approval filed on the board). The daemon at 0.89 already stamps the `%output` generation, so the LAN pair gains the replay fence from the streamer side alone.

The pristine release streamer was staged in the stable checkout's gitignored `.local/bin` as `streamer-candidate-0.90.0`, retaining the 0.89 copy. The LAN pane respawned onto it with the original TLS, origins, API-key-file, query-key and session-limit options. The frontend is served from the stable checkout's `dist`, rebuilt after the merge. Exact local addresses and process details remain in gitignored local configuration.
