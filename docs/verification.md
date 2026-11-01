# Tested build evidence

Software verification completed November 1, 2026 (Etc/GMT+8). Paul requested the tested build first and will perform Quest 3 checks afterward. This is a software-qualified headset test candidate.

## Software gate

`make checkall-ci` covers Biome, strict TypeScript, 42 unit tests across six files, the production build, observatory asset validation, secret scanning and a high-severity dependency audit. The audit reports zero vulnerabilities. The production JavaScript chunk is approximately 1.12 MB before gzip (293 KB gzip). Its warning remains visible and is not a headset performance result.

The unit suite exercises protobuf/zlib framing, ANSI seeding and live output, disconnected input rejection, bounded reconnects, target capture, persistence failures, key encoding, hierarchy normalization, native controller events, relative panel transforms, local zoom and resource teardown. Controller tests dispatch actual Three.js Group events with only the GPU renderer mocked. They caught and reproduce fixes for DOM-style event assumptions, grip activating keys, inverted zoom and hierarchy leaves failing to attach new panes.

## Browser evidence

`make e2e` uses explicit protocol fixtures. Desktop (1440×900), tablet (820×900) and mobile (390×844) passed with native Chromium headless and the Apple M4 Metal renderer. Each captured 24 input frames with no page errors. The final rerun recorded test-mac load 1.856 before and 2.028 after. The final visual reviewer cleared all six previously reported material findings, including the mobile Backspace label. It verifies hierarchy selection, two panels, command scopes, optional Enter, frozen input target, modifier bytes, detach, backgrounds and settings. Fixture results do not establish a real daemon round trip.

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

## LAN and published release qualification

Paul explicitly approved the application firewall rule on November 1, 2026. The rule was applied only to `/Users/localuser/Repos/mux-xr/.local/bin/streamer-candidate`, preserving the approved binary hash. The app allow entry is present. HTTPS immediately became reachable from test-mac, confirming the earlier inbound connectivity problem was resolved by that change. No other application rule or global firewall setting changed.

The complete real-app check then passed from test-mac to `https://192.0.2.10:4240` over HTTPS/WSS. It reproduced zero metadata sessions, two attached viewer streams, distinct command output on both panes, zero Resize messages and positive unchanged 80×24 grids. There were no page errors. Browser probing also confirmed `isSecureContext` and `navigator.xr`. test-mac load was 1.782 before and after.

A separate run against the official [core 0.76.0 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.76.0), using a fresh private daemon and streamer on test-mac, passed those same assertions. Both downloads matched their published checksums:

| Artifact | SHA-256 |
| --- | --- |
| `par-mux-v0.76.0-aarch64-apple-darwin.tar.gz` | `6ad8c9e9205c71f3c70eb675dd1fb749f0e14075dec0008feb970b291333ec72` |
| Extracted `par-mux` | `81d840a5cce96a87fe612f730e1b5b82a8ff41397ddaef60bb8594c0bcbdba2a` |
| `par-term-streamer-mux-macos-aarch64` | `94a4eccb8279c7e9c5184d78f23124bb52cdb98ab05fa9d70d5e206e9cd1d969` |

The release tag resolves to `676e44f237eebf1c01c0843481ec8b00fceb43d1`; the downloaded daemon reports `0.76.0+761624a`, and the streamer reports `0.76.0`. test-mac load was 1.959 before and after this run. The live LAN preview retains its original approved candidate binary, while release compatibility was tested separately. Shared services were not restarted.

The LAN run exposed a test timing assumption: attached panel controls can exist before the remote stream handshake completes. The verifier now waits for both actual handshakes and two server sessions. Command output markers are unique per run, excluding stale screen seeds as a source of success. An initial test launched under a detached mux also encountered macOS outbound Local Network Privacy attribution; the same browser and API probe succeeded through foreground SSH without changing privacy settings. Failed diagnostic attempts were excluded from acceptance.

Accepted logs are `.local/evidence/lan-full-app.log`, `release-full-app.log` and `lan-release-summary.json`. Temporary remote daemons, browsers, copied packages and scratch trees were cleaned up after qualification.

## Visual and asset checks

Desktop, tablet and mobile captures were reviewed. The interface uses a nested hierarchy, readable two-panel framing, a themed command editor and responsive input controls. The final mechanical Impeccable detector returned no findings. The observatory is an original, deterministic Blender asset with editable sources, 22,712 triangles, ten draw calls and a 2,528,120-byte runtime GLB. Its technical validator and source/runtime byte comparison pass.

## Pending owner checks

Quest 3 hardware acceptance is pending: two-panel physical readability, controller ray and grip behavior, passthrough, virtual keyboard comfort, observatory taste and frame pacing. No maximum pane count or production-scale performance improvement is claimed. Black and gradient modes provide simpler backgrounds for comparison.

The LAN preview reuses the existing IWSDK development certificate. It is self-signed and its SANs cover localhost, not the LAN address. HTTPS/WSS can be tested with an explicit development-certificate exception, but headset trust and WebXR entry must be confirmed by the owner. LAN HTTPS/WSS now pass after the explicitly approved application firewall rule. No trust store, credential or shared service configuration was changed.

Both the matching daemon and streamer are required for complete geometry metadata. A published `0.75` version string alone is insufficient. The original candidate hashes above describe gated local builds. Official 0.76.0 release artifacts were additionally qualified as recorded above. Held-pane exit/respawn metadata shipped upstream in 0.76.0, while viewer status badges remain a separately tracked enhancement.

## Owner desktop feedback fixes

The November 1 desktop feedback is addressed with these separate checks:

- First load prefills the serving origin. A saved custom endpoint survives remount.
- Lowercase keycaps match unshifted bytes. Shift exposes uppercase and US symbols including dollar, then returns to base labels after one character. Native XR labels share the same character mapping.
- Explicit selection of pane B while input remains open retargets the keyboard, composer, commands and caption. Gaze remains independent. This deliberately replaces the earlier captured-until-dismissed behavior.
- Desktop output uses natural-size flat canvases, with 3D preview as a separate choice. Canvas backing density is capped at 2x and XR texture filtering is linear. Foreground/background ANSI mapping is verified for inverse cells.
- The preview's two idle Zsh panes were respawned using the actual account UserShell, `/opt/homebrew/opt/bash/bin/bash -l`. Both pane-info replies report bash. Shared services and shell configuration were preserved.
- Unit coverage increased to 39 tests. The desktop/tablet/mobile native-GPU fixture and the actual two-pane app check passed against core 0.76.0. The real check switches to pane B with the input drawer still open and verifies unique output on B with no leakage to A and no Resize messages.
- Desktop screenshots use device scale 2 and verify that the angled XR canvas is hidden by default. Fixture load was 1.836 to 1.940, and real-app load was 1.940 to 1.945 on test-mac. Browser images were inspected for actual text clarity.

The final design detector reported advisory differences between legacy embedded UI colors/type sizes and DESIGN.md. The new desktop view reuses the incumbent palette. These advisories were not treated as functional failures or as permission for a broader redesign. Physical Quest behavior after these fixes remains owner-pending.

## Spatial controls, hover help and separate input views

The subsequent owner feedback confirmed the other desktop fixes and identified inert spatial strips and indistinguishable Commands/Keyboard drawers. These are now covered separately:

- Browser pointer and XR controller adapters use one action dispatcher. Mouse projection/raycast tests exercise actual Three.js meshes for the per-pane Enter strip and panel scale button, and assert that scale sends no grid resize. Adjacent inner resize buttons were separated by a small increase in default panel spacing.
- The browser native-GPU suite clicks the projected terminal Enter control and observes the correct pane's carriage-return frame. It also activates the workspace HUD Black action and Exit, which returns to flat terminal view. All three viewports pass with 42 captured frames and no page errors. These protocol fixtures remain distinct from real daemon acceptance.
- Hover explanations share the control action metadata. Browser canvas titles and a non-interactive spatial label explain keys, physical sizing, text zoom and HUD controls. A simulated controller-ray hover shows the label without sending input, then clears it when the ray leaves. Tooltip objects and pointer listeners are disposed with the scene. Physical Quest readability remains owner-pending.
- Commands shows saved-command controls/editor. Keyboard shows the composer and key grid. Unit and browser visibility assertions verify the views differ and preserve explicit pane targeting. DOM icon/modifier buttons include descriptive hover titles.
- Full fast and CI-parity gates pass with 42 tests. test-mac native-GPU browser load was 1.610 before and 1.737 after. Owned preview processes and scratch files were removed after the run.
