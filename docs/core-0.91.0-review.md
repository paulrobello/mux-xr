# par-term emu core 0.91.0 review

Mux XR reviewed the official v0.91.0 release at commit `c65525bb751cfcd890a038a30739501c67ba1c9b`, one day after the 0.90.0 pin.

## Artifact and protocol verification

- Mux archive SHA-256: `6d59f836776fdeb61f6f42d9b605b0f51b3e42e2f6886a453e8ba7e4be907bc8`, matching the release checksum file.
- Streamer SHA-256: `500bec8f8b1ad97585b5f4295cfe46d9db96e4846ecc8908b5e9fa1af6fd2626`, matching the release sidecar.
- Both detached minisign signatures verify with the upstream pinned public key `7D5A457F1AB85B55`. Both extracted Apple executables pass `codesign --verify --strict`.
- The generated `terminal_pb.ts` at the release tag is byte-identical to the vendored binding: SHA-256 `149c4be5e774aae1f6353acd9f036e1d07ae910cbee0ec666954280c1fb1f031`. No binding replacement or client protocol change is required.

Sources: [v0.91.0 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.91.0), [tagged changelog](https://github.com/paulrobello/par-term-emu-core-rust/blob/v0.91.0/CHANGELOG.md), and [signature check script](https://github.com/paulrobello/par-term-emu-core-rust/blob/v0.91.0/scripts/check-release-signatures.sh).

## Useful changes

- **Input write path no longer blocks on the tty round trip (`98ec1195`, upstream card 01a218f2):** `PtySession::write` and `PtyInputHandle::write` enqueue onto a bounded per-session queue drained by a dedicated thread (16-chunk backpressure window, about 1 MiB) instead of taking the exclusive Terminal lock per chunk and blocking on the tty write under the writer mutex. Input recording runs at enqueue time gated on a shared atomic, so a non-recording write never serializes against the reader thread or frame gathers. Daemon-side: the browser client's keystrokes and pastes ride the mux input path, so typing latency under load improves with no client change — the binding is byte-identical and the mux wire protocol exposes no per-write acks, so the changed error timing (a tty write failure is latched sticky and reported by a later write, while the enqueue-time call returns `Ok`) never reaches the browser.
- **`make streamer-install-mux` install guard (`3c060447`):** the install target greps the installed binary for a `cfg(mux)`-gated `mux_factory` string, failing the install when the mux feature did not compile in — plain and mux-enabled streamer builds print identical `--help`/`--version`, so nothing else could tell them apart. Default `make install` now ships the mux-enabled streamer. Upstream closes the exact gap this project hit shipping the 0.90.0 streamer (vault: `Patterns/mux-streamer-install-verification-guard`); this project still pins the release `-mux-` artifact as its qualified LAN source.

## Compatibility boundaries

No protocol, CSP, auth or origin changes affect Mux XR: the binding is byte-identical, 0.88's nonce CSP and 0.89's legacy-htpasswd refusal are unchanged, and the write-path rework is daemon-internal with a bounded queue (16 chunks, ~1 MiB) as the only new backpressure surface. A producer faster than the tty for a long burst can now hit queue backpressure instead of the old writer-mutex serialization; the browser input path stays send-and-forget.

## Known upstream gap

None new.

## Qualification

Verified November 27, 2026 (America/Los_Angeles):

- `make checkall` and `make checkall-ci` passed: protocol hash, Biome, strict TypeScript, Vitest, production build, bundle budget, observatory assets, Gitleaks and the high-severity dependency audit.
- `make real-app-check` passed against an isolated official 0.91.0 daemon and streamer pair with the production build. The app saw all three panes, both panes echoed marker commands, and the check reported no errors.
- The private daemon and streamer were stopped after the check. Physical Quest acceptance was not performed.

## Local installation

The pristine release binaries are staged in this checkout's gitignored `.local/bin`: `streamer-candidate-0.91.0` and `mux-core-0.91.0`, plus the unversioned `streamer-candidate`/`mux-core` refreshed to 0.91.0 (the unversioned `mux-core` had been stale at 0.87.0). `make core-pin --stage .local/bin` is non-executable on macOS (copyFileSync drops the mode bit), so the staged copies need `chmod +x` before use — a follow-up card is filed for the script fix.
