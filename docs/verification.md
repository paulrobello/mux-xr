# Tested build evidence

Software verification completed November 1, 2026 (Etc/GMT+8). Paul requested the tested build first and will perform Quest 3 checks afterward. This is a software-qualified headset test candidate.

## Software gate

`make checkall-ci` covers Biome, strict TypeScript, 31 unit tests across six files, the production build, observatory asset validation, secret scanning and a high-severity dependency audit. The audit reports zero vulnerabilities. The production JavaScript chunk is approximately 1.12 MB before gzip (293 KB gzip). Its warning remains visible and is not a headset performance result.

The unit suite exercises protobuf/zlib framing, ANSI seeding and live output, disconnected input rejection, bounded reconnects, target capture, persistence failures, key encoding, hierarchy normalization, native controller events, relative panel transforms, local zoom and resource teardown. Controller tests dispatch actual Three.js Group events with only the GPU renderer mocked. They caught and reproduce fixes for DOM-style event assumptions, grip activating keys, inverted zoom and hierarchy leaves failing to attach new panes.

## Browser evidence

`make e2e` uses explicit protocol fixtures. Desktop (1440×900), tablet (820×900) and mobile (390×844) passed with native Chromium headless and the Apple M4 Metal renderer. Each captured 24 input frames with no page errors. It verifies hierarchy selection, two panels, command scopes, optional Enter, frozen input target, modifier bytes, detach, backgrounds and settings. Fixture results do not establish a real daemon round trip.

The focused `make live-check` diagnostic separately sent distinct split-marker commands through two real terminal adapters, observed both outputs and revision increases, and rejected input after disposal. test-mac load was 1.953 before and after that diagnostic. It does not establish full-app hierarchy acceptance.

`make real-app-check` then exercised the actual built app through a real private daemon and streamer, without WebSocket fixtures or adapter bypasses:

- Core source: `95dbb69f1d8ee5d655361c19334a192c10c4c8e8`.
- Streamer SHA-256: `4ba594b75cccaa23f73818296879248e07137090abd8bd95eaf497c4ac25a924`.
- Matching daemon SHA-256: `0a355456e59e28826891c661eafc5db4ebe2219d5c3a25c618d096ab33269ddd` (`0.75.0+95dbb69f`).
- Metadata-only `/ws?metadata=1` left streamer sessions at zero. Attaching two actual panes created two viewer streams.
- Global quick command on one pane and composed text plus virtual Enter on the other produced distinct output markers. Complete markers were absent from client input, excluding echoed-input false positives.
- Both grids were positively reported as 80×24 before and after. The client sent zero Resize messages.
- The real hierarchy delivered six snapshots, both panes remained attached and no page errors occurred.
- Renderer: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`.

Raw logs and screenshots are preserved locally under `.local/evidence` and `.impeccable/review`. Temporary fleet scratch trees and private remote daemons were removed after the run. An earlier diagnostic using an older daemon reported zero geometry and was excluded from grid-preservation acceptance.

## Visual and asset checks

Desktop, tablet and mobile captures were reviewed. The interface uses a nested hierarchy, readable two-panel framing, a themed command editor and responsive input controls. The final mechanical Impeccable detector returned no findings. The observatory is an original, deterministic Blender asset with editable sources, 22,712 triangles, ten draw calls and a 2,528,120-byte runtime GLB. Its technical validator and source/runtime byte comparison pass.

## Pending owner checks

Quest 3 hardware acceptance is pending: two-panel physical readability, controller ray and grip behavior, passthrough, virtual keyboard comfort, observatory taste and frame pacing. No maximum pane count or production-scale performance improvement is claimed. Black and gradient modes provide simpler backgrounds for comparison.

The LAN preview reuses the existing IWSDK development certificate. It is self-signed and its SANs cover localhost, not the LAN address. HTTPS/WSS can be tested with an explicit development-certificate exception, but headset trust and WebXR entry must be confirmed by the owner. No trust store, firewall, credential or shared service configuration was changed.

Both the matching daemon and streamer are required for complete geometry metadata. A published `0.75` version string alone is insufficient. The candidates above are gated local builds, not published release artifacts. Held-pane exit/respawn state remains a separately tracked enhancement.
