# Core 0.77.0 usefulness for Mux XR

Published November 2 at12:09 PM PST, tag v0.77.0, commit f1059d42cbaa8c744ffdf53794f4ec7a8ce6ae14. [Official changelog](https://github.com/paulrobello/par-term-emu-core-rust/blob/v0.77.0/CHANGELOG.md).

| Addition | Mux XR value | Decision |
| --- | --- | --- |
| Seed ordering/retry repairs | Reduces stale first screens during output races | Qualify and use the new streamer |
| Raw SGR mouse handling/documentation | Correct controller TUI wheel events | Use raw 64/65 and verify actual private TUI bytes |
| Optional Output damage ranges and generation | Could avoid full visible-cell scans with many panes | Schema vendored; performance integration remains follow-up |
| Pane-create request/result | Direct route for creating real daemon panes | Useful next; writable-only, default-shell-only, default-off server permission needs explicit review |
| Pane process/lifecycle state | Better exited/running viewer badges | Additive schema available; UI follow-up |
| Optional blob connect-src policy | Could load embedded asset resources | Keep off; current local-font/self-hosted asset paths work |
| Attach/roster/default-workspace client fixes | Benefits native mux clients | No XR-specific change needed |
| Host input wake repair | Helps native attach latency | No XR client change required |

The verified Mac ARM release hashes are mux archive be9f50c1bef41dfca19b4b9b4672eb0ca203a08fbc4113821bea1bd2454abdeb and mux-streamer 9ee27b31507530aeb19d37ae9fe2a0a0712a27c9a2192dda5bd8557559845183. The generated schema is copied exactly from the release with provenance under src/terminal/vendor.

A fresh private 0.77 daemon/streamer and raw-mode Python TUI observed wheel-down bytes 1b5b3c36353b343b354d, corresponding to ESC[<65;4;5M. Existing daemon socket/refresh/input contracts are compatible. No existing mux daemon was restarted for qualification. Pane creation and blob CSP flags remain off.
