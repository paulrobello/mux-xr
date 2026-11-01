# P0: Live terminal vertical slice

## Dependencies

Approved PRD. No P1/P2 implementation prerequisite.

## Tasks

- P0.1: Scaffold typed Vite/Three.js app, standard Make targets, local dev lifecycle, pre-commit secret checks and separate CI concerns. Pin verified reference/current versions: Three.js 0.186.1, TypeScript 7.0.2, Vite 8.3.5, happy-dom 21.0.4, Biome 2.5.15, Vitest 5.0.3, Playwright 1.63.0, @types/three 0.186.0, @types/webxr 0.5.24. The patched Vite/happy-dom pins replace the reference repo's vulnerable versions after the actual dependency audit. Verify `make checkall` and `make checkall-ci`. Dependencies: none.
- P0.2: One `TerminalSurface` using core protobuf/zlib and xterm 6.0.0 public buffer APIs. Pin @bufbuild/protobuf 2.16.0 and pako 3.0.3 to the core frontend reference. Write ANSI seed before deltas. Bounded reconnect, no input queue across disconnect, no implicit grid resize. Verify codec/input unit tests and a real private mux+streamer round trip. Dependencies: P0.1.
- P0.3: Browser setup and basic XR entry with explicit LAN endpoint, visible connection errors, TLS requirements and safe view detach. Verify production browser render and existing-pane process survival after closing the view. Dependencies: P0.1, P0.2.

## Exit

Real one-pane bidirectional streaming plus green fast/parity gates. Commit atomically. No public deployment or service restart.
