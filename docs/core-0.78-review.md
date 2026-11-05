# par-term emu core 0.78.1 review

## Pin and provenance

Mux XR reviewed the official `par-term-emu-core-rust` v0.78.1 release at commit `b52c58bf7686645f7ae541b7385b82883205a60e`.

- Mux archive SHA-256: `6171491ab2dd3f5fe9f1b39127896de2be4915bf726f12fc160a336039b2d483`
- Streamer binary SHA-256: `7a3cd8a5e1517c53b0e892e72cf21e74f76fb6856b5a2a09933d4c64391fd3b1`
- Vendored `terminal_pb.ts` is byte-identical to 0.77.0, SHA-256 `74568289834b31bf654307ce151f5928472f1b33a9a92f5b1b8c4fd0dba894fe`.

Sources: [official v0.78.1 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.78.1) and [v0.77.0…v0.78.1 comparison](https://github.com/paulrobello/par-term-emu-core-rust/compare/v0.77.0...v0.78.1).

## Benefits for Mux XR

- Lossless output relay (`4b1de6d4`) improves delivery of terminal output through the streamer.
- Bell forwarding (`d3d8016b`) is a direct benefit for the existing desktop/XR pane-bell indicator.
- Damage pairing (`957f6bb2`, `44a1d7ef`) improves upstream damage metadata. Mux XR does not consume the associated hint yet, so this review makes no frames-per-second or performance claim.
- Native `vi` copy/pickers are core-side behavior and do not change Mux XR's XR interaction surface.

The generated schema did not change, so this pin does not require a frontend protocol migration.

## Qualification

Private-socket real-app checks passed for both pairings:

1. New streamer 0.78.1 with daemon 0.77.0 (`ebabfbba`)
2. New daemon 0.78.1 (`b52c58b`) with new streamer 0.78.1

Both cases verified read-only metadata probing, two attached panes, unique A/B routing, 80×24 grids, zero baseline resizes, explicit 100×30 resize and restoration to 80×24 with exactly two resize requests, no errors, and an M4 Max Metal renderer. Explicit Bell checks passed, while BEL-terminated OSC title sequences produced no additional Bell event.

The qualification uses private sockets and does not prove Quest comfort, readability, hand tracking, controller feel or sustained headset performance.

## Deployment boundary and lesson

The dedicated preview runs the 0.78.1 streamer against the shared default par-mux daemon, which intentionally remains on 0.77.0 and is not restarted. The live deployment is the qualified mixed pairing; the matched 0.78.1 pair remains a private qualification result.

On macOS, a detached CLI daemon start selected the old installed Par-mux.app 0.77 despite the 0.78.1 CLI. The verified paired 0.78.1 daemon was therefore run with `--foreground` in its managed pane. Future qualification must identify the actual daemon process and socket rather than relying on the CLI version string.
