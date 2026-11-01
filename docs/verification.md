# Tested build evidence

Software verification completed November 1, 2026 (Etc/GMT+8). Paul confirmed the app works in headset XR and supplied the first controller/keyboard feedback. The revised interaction build is software-qualified and ready for his headset recheck.

## Software gate

`make checkall-ci` covers Biome, strict TypeScript, 83 unit tests across eight files, the production build, observatory asset validation, secret scanning and a high-severity dependency audit. The audit reports zero vulnerabilities. The production JavaScript chunk is approximately 1.27 MB before gzip (346 KB gzip). Its warning remains visible and is not a headset performance result.

The unit suite exercises protobuf/zlib framing, ANSI seeding and live output, disconnected input rejection, bounded reconnects, target capture, persistence failures, key encoding, hierarchy normalization, native controller events, relative panel transforms, local zoom and resource teardown. Controller tests dispatch actual Three.js Group events with GPU/SDF drawing mocked. A separate native-GPU fixture exercises the real SDF text implementation and bundled fonts. They caught and reproduce fixes for DOM-style event assumptions, grip activating keys, inverted zoom and hierarchy leaves failing to attach new panes.

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

Quest Browser access and immersive XR entry are owner-confirmed. Acceptance of the revised rays, keyboard size and manipulation, gaze input, two-panel readability, passthrough, observatory taste and frame pacing remains pending. No maximum pane count or production-scale performance improvement is claimed. Black and gradient modes provide simpler backgrounds for comparison.

The LAN preview reuses the existing IWSDK development certificate. It is self-signed and its SANs cover localhost, not the LAN address. HTTPS/WSS can be tested with an explicit development-certificate exception, and Paul has now confirmed headset access and immersive entry. LAN HTTPS/WSS now pass after the explicitly approved application firewall rule. No trust store, credential or shared service configuration was changed.

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

## Single input presentation and panel recovery

The next owner screenshots exposed the combined DOM/spatial keyboard presenter and panel growth clipping its own shrink controls. The fixes use one presenter per mode: browser HUD input opens the compact drawer only, native XR input does not invoke DOM opening callbacks, and session end clears spatial input. A lifecycle regression explicitly checks keyboard disposal on immersive exit.

Browser growth now projects the whole panel hierarchy, including attached controls, and caps enlargement at a 2% viewport margin. Shrinking remains allowed even for an already oversized panel. The preview toolbar provides selected-panel Smaller/Larger and Reset layout independently of geometry. VR retains its physical scale range and has recovery controls outside the pane, either on the HUD or above an open native input panel. Recovery controls render above pane geometry and receive explicit picking priority, while invisible controls are excluded. No shell process was restarted and no PTY grid resize is involved.

All 46 unit tests and the parity gate pass. Desktop, tablet and mobile native-GPU fixtures pass after clicking the actual HUD Keyboard control, asserting no spatial keyboard exists, enlarging 25 times, checking viewport bounds/reachable shrink controls, and using recovery/reset. Accepted screenshots include `desktop-single-keyboard.png` and `desktop-bounded-panel.png`. The final screenshot run recorded test-mac load 1.843 to 2.290 with no page errors. These are browser/simulated XR results; physical Quest comfort/readability remains owner-pending.


## First Quest feedback: rays, keyboard manipulation and gaze input

Paul confirmed headset XR operation and reported short visible rays, a keyboard filling the view, missing hover/contact feedback and missing manipulation controls. The revised scene uses the actual picked intersection for the visible ray endpoint, an eight-meter fallback ray, a small contact dot and per-controller key highlights. Both controllers can hover one key without clearing each other's tint. Disconnect hides contact/ray visuals and releases the grab.

The keyboard now opens near the current headset pose at approximately 1.07 meters wide, with all 59 keys and controls inside the test camera frustum. It has its own Smaller/Larger/Reset actions and a grabbable title/body. Its controls do not overlap. Typing, Shift, pane selection and menu mode changes preserve its current transform. Closing/reopening preserves the in-session arrangement, while XR reference-space changes and Reset discard stale poses. The workspace HUD remains fixed so recovery and Exit stay available.

Grip moves and rotates a terminal or input menu with the controller. Horizontal thumbstick input turns the held object, vertical input lifts it in world space, and grip plus trigger changes vertical input to controller-ray push/pull. Motion uses elapsed frame time with a deadzone. Tests compare 60 Hz and 120 Hz rotation, verify accumulated depth and release pose, prevent trigger typing while gripping, and verify that gripping pane B's title manipulates B rather than the selected pane A. No layout action changes a PTY grid.

Gaze input is a separate, persistent, default-off option in browser settings, the XR HUD and the keyboard panel. Enabling it uses a 350 ms head-directed dwell to select the keyboard target. Looking at the keyboard retains the last pane, including when a different terminal lies behind it. It pauses during manipulation and clears modifiers when the target changes. Visual gaze emphasis remains independently configurable. Positive routing tests verify selection of pane B and key delivery to B after dwell, while disabled gaze never retargets input.

`make checkall` and `make checkall-ci` pass with 57 tests, strict TypeScript, asset validation, secret scanning and dependency audit. No CI workflow is configured in this repository. The desktop/tablet/mobile protocol fixtures each pass with 42 captured frames and no page errors. The new `MUX_XR_BASE_URL=http://127.0.0.1:4241 bun run scripts/xr-visual-check.ts` renders the actual spatial keyboard with a test XR camera/controller and native Metal Chromium, verifies all key bounds and checks a 0.7-meter ray contact on highlighted key A. Screenshots were inspected. Accepted final test-mac load was 1.497 before/after the spatial check and 1.794 after the browser suite. An earlier visual-fixture failure pointed its Three.js Group along positive Z instead of the controller ray's negative Z, and was corrected before acceptance.

The accepted logs are `.local/evidence/quest-final-parity.log` and `quest-final-browser.log`, with `quest-keyboard-native.png` and `quest-keyboard-native-highlight.png` under `.impeccable/review`. This round uses protocol fixtures and simulated XR, not a fresh real-daemon round trip or physical headset acceptance. Existing real-core/LAN evidence above remains separate. Terminal processes, streamer binaries, firewall rules and certificates are preserved.


## Universal direct manipulation

The owner subsequently requested all XR UI surfaces be directly manipulable, replacing the prior fixed-HUD and dedicated resize/reset-button approach. Terminal panes, keyboard, quick commands, hierarchy and HUD now share whole-surface grip behavior. Child keys and actions remain attached. XR panel-size buttons, keyboard-size/reset actions and the separate recovery strip are removed. A−/A+ remain local terminal text zoom, and the desktop DOM toolbar retains mouse-accessible scale/reset controls.

One controller moves/rotates a surface with the existing stick yaw/lift and grip-plus-trigger push/pull mapping. Gripping the same surface with both controllers scales from hand separation, moves from midpoint translation and rotates from the hand direction. Releasing or disconnecting one source rebases the remaining grab at the current visible pose. Input-menu rebuilds capture fresh anchors and pair reference values. Closing or removing the target releases all input-root grabs before disposal. Every surface owns scale limits, while all manipulation preserves the PTY grid and suppresses trigger activation from held controllers.

Recovery uses a one-second hold on both thumbstick clicks while neither grip is held. It restores terminal, HUD and input transforms in front of the current headset. No on-surface transform controls are required. Hover help explains grip and two-grip scaling, and the HUD body explains the recenter gesture. This supersedes the fixed recovery HUD described in the previous round.

The full fast and parity gates pass with 68 tests. New tests cover pair-grip translation/rotation/scaling for each of the five surface types, no-jump one/two-controller handoffs, scaled/moved menu refresh and target retargeting, disconnect rebasing, disposal of a grabbed input target, and both-stick recovery with held-grip suppression. Physical Quest acceptance of the new gestures remains owner-pending.


Native Metal verification also passes with no XR transform actions in the scene, all 59 keyboard keys in view, and two-controller scaling from 0.38 to 0.5881 with 0.06 meters of midpoint movement. Removing the transform rows reduces the keyboard surface height from 0.7505 to 0.6479 meters at its default scale, while width remains 1.0735 meters. The ray still ends on highlighted key A at 0.7 meters. Desktop/tablet/mobile fixture checks each pass with 42 captured frames and zero page errors. test-mac load was 1.912 before the spatial check, 2.239 afterward and 2.128 after the browser suite. Accepted evidence is `.local/evidence/direct-final-browser.log` and `direct-parity.log`. An initial fixture timeout moved the two simulated controllers toward one another because key traversal order reversed left/right; the verifier now orders grip targets spatially before spreading them. That attempt was excluded. Screenshots were inspected, and the temporary remote daemon/scratch were removed and booking released.


The final visual review also caught passive grip help from the other controller covering the keyboard while a letter key was targeted. Control hover now takes priority over body help, with a positive two-ray regression and native Metal rerun. The latest gate passes 68 tests. The focused rerun reproduced the same geometry, scale and ray values with test-mac load 1.903 before and after; its log is `.local/evidence/direct-hover-visual.log`. No headset performance or physical controller acceptance is inferred from these fixtures.


## Orientation, explicit grids and readable XR text

The latest owner feedback adds grip-only stick yaw/pitch, grip-plus-trigger laser-axis roll and push/pull, explicit terminal grid control, scalable keyboard labels, quieter hints, measured FPS and a buttons-only keyboard option. One- and two-controller physical manipulation remains independent from the PTY grid.

The HUD Terminal menu edits a selected-pane grid draft through presets and step controls; Apply alone sends a resize. Browser settings offer numeric columns/rows and Apply. Requests require integer columns 2–300 and rows 2–150, an open connected socket and a writable stream. The viewer adopts dimensions only from server acknowledgement. The private official core 0.76.0 app check observed pane B change from 80×24 to 100×30 and restore to 80×24 through actual tree metadata and the viewer caption. Pane A stayed 80×24. Normal viewing/typing sent zero resize messages, while explicit Apply/restore sent exactly two. Unique command markers still reached only their intended panes. Both private pane-info replies returned Bash at 80×24 afterward. No owner shell was resized during verification.

XR controls use Troika 0.52.5 SDF glyphs with bundled OFL Noto fonts. The glyph-free button backgrounds preserve physical border aspect, and text fits from actual glyph bounds. Exact font cmap ranges select local glyphs, equivalent supported arrow glyphs replace unavailable directional forms, and unsupported visual characters use `?` while preserving the original label metadata. Font URLs, licenses, bytes and hashes are recorded in public/fonts/README.md. Disposal immediately removes a label from view and releases owned planes/textures, then finalizes text geometry and instance materials after asynchronous sync, preserving the shared atlas.

The native Apple M4 Metal fixture rendered 68 SDF labels, all 59 keyboard keys inside the default camera frustum, a real measured FPS readout, and the existing 0.7-meter key contact/highlight. Near (0.7 m), far (2 m), oblique (1.5 m at 0.5 rad) and buttons-only screenshots were inspected. Terminal panels are hidden only in the isolated distance-test captures to prevent normal world occlusion from concealing labels. The FPS readout measures this application's render callbacks over half-second intervals and is not a Quest capacity benchmark.

Keyboard Backing is a persisted toggle available in the keyboard header and browser settings. Disabling it leaves buttons visible and retains a transparent logical grip/gaze surface. Grip instructions no longer appear automatically. Action-only hints require 700 ms of stable hover, measure 0.32×0.05 m and disappear while manipulating. They stay next to their target rather than being forced into the center of view.

Comfort (default), Original and Monochrome terminal colors are persisted presentation modes. ANSI 256-color mapping is now complete rather than wrapping every color to the first sixteen entries. All terminal pixels still share one planar texture; no foreground color is placed at a different geometric depth. The reported color-depth effect may be optical, so the comfort/monochrome choices and physical readability still require owner Quest verification.

All 81 tests and the full parity gate pass. Desktop/tablet/mobile protocol fixtures each pass with 44 captured frames, including explicit resize/restore and persisted presentation preferences, and no page errors. Native GPU load was 1.938 before and 2.103 after the final spatial run. Browser load was 1.716 to 1.605. The final real-core run used the release hashes recorded above and daemon stamp 0.76.0+761624a, with load 1.753 to 3.214 and no page errors. Accepted evidence includes readability-final-parity.log, readability-browser-final.log (spatial portion), readability-e2e-final.log and readability-real-app-final.log under .local/evidence.

Excluded diagnostics found an overbroad glyph coverage table that triggered external font fallback, then a network-idle readiness assumption that never settled. Coverage is now generated from the actual bundled font cmaps, and browser checks wait for application readiness. A full native run after the fix made no external requests. Test daemons, browsers and fleet scratch are cleaned up after verification. No credential, certificate, firewall rule or shared service was changed, and no maximum headset capacity or physical comfort result is claimed.

The final browser grid-form pass used the actual UI component and global CSS at mobile and desktop widths. Numeric inputs are themed dark, 122×36 px in the settings panel, arranged in two columns, and the panel scrolls within the viewport. Initial Apply is disabled until a terminal is available. Both captures passed; readability-grid-style.log records the computed field styling. This static DOM check ran in a booked load-tolerant local window and is not a timing or GPU-performance sample.


## Served label repair, reversed pitch and quieter blues

Owner testing found that the previous candidate had no XR UI glyphs. The earlier native fixture imported source modules from Vite and missed the streamer's production Content Security Policy. The actual served build reproduced zero foreground pixels in three HUD-label crops, with console errors explicitly blocking Troika blob workers. The supported configureTextBuilder useWorker:false path restores typesetting under the unchanged policy. No CSP, certificate, firewall rule, credential or streamer binary was modified.

The new production-label-check requires an explicit built-app URL and a CSP that blocks blob workers while allowing local fonts. It rejects relevant font/Troika/worker failures and checks foreground glyph pixels in the rendered WebGL canvas, rather than relying on scene metadata. The repaired, minified candidate served by the same streamer produced 188, 281 and 228 white glyph pixels in Commands/Keyboard/Terminal crops, with zero page errors and zero label failures. This semantic pixel check used native Apple M4 Max Metal in a booked load-tolerant window; it is not a frame-time or performance measurement. Physical Quest recheck remains separate.

Normal-grip pitch was reversed exactly as requested. Tests compare its quaternion direction and unchanged position, while preserving grip-trigger roll and push/pull. Comfort-mode blue is now a lighter, low-chroma teal with green close to blue, including truecolor and palette blue. Original remains exact source color. Monochrome now also neutralizes default foreground/background fallbacks. Tests cover all256 palette indices, black backgrounds, bright-blue distinction and stronger foreground readability.

All83 tests, strict TypeScript and full parity checks pass. Accepted logs are label-repair-parity.log and production-label-final.log under .local/evidence; production-label-baseline.log records the failing served build. A remaining GLTFLoader texture fetch is blocked by the existing connect-src policy and is tracked separately on core card01a19895bd22721e9042583d8f5f8357. That optional custom-root CSP capability was filed upstream with strict-default and owner-opt-in requirements. The label regression test reports these unrelated environment messages separately rather than claiming all asset requests succeed.

## Explicit frontend update notices

Production builds emit a deterministic SHA-256 fingerprint in index.html and version.json, covering the bundled application, package version and public assets. The frontend compares the embedded identifier with an immediate same-origin manifest request and subsequent 30-second polls. Requests bypass the cache, time out after five seconds, and never overlap. Malformed, failed or aborted requests retain any existing notice. Returning to the running build clears the notice. Development retains Vite reload behavior.

A compact browser notice and an action attached to the movable XR HUD offer Reload. Detection does not navigate or change input focus. Explicit reload awaits the active immersive session's end before navigating to a cache-busting URL that preserves other query parameters and the fragment. Rejection or a ten-second exit timeout retains the current page. The normal viewer teardown disconnects streams without terminating terminal processes. Device preferences and saved commands remain in local storage.

The fast and full parity gates pass with 94 tests, strict TypeScript, asset validation, secret scanning and dependency audit. Focused tests cover fingerprint stability and asset changes, differing first responses, rollback, duplicate polls, network failures, timeout/disposal, DOM visibility/action routing, XR-only control visibility, deferred session exit and rejected exit. A read-only diff review found no remaining actionable issues.

The final minified build was served by a private streamer under its unchanged production CSP on dev-workstation. The browser loaded fingerprint 9233317f751e26cf101275ca38962228389bdabefea7596885839e75974722b8, then the owned fixture root was replaced with a different asset build, 49184b76992dda50705eea6e453b32a31a4e098c5e20d9af886aef5b308ddcd7. A periodic poll revealed the notice without navigation. Clicking Reload adopted the new embedded fingerprint and cleared the notice. There were five manifest requests, two document navigations including initial load, and no page or label failures. An initial run exposed inline display styling overriding the hidden attribute. A subsequent CSS edit briefly split a grouped input selector. Both are corrected in the final served rerun, and its screenshot was inspected.

The same final run rendered 188/281/228 foreground glyph pixels under native Apple M4 Max Metal and the strict CSP. Load was 11.101 before and 12.085 after, below the limit of 15, in the booked window. Evidence is update-final-runtime.log and update-final-runtime.exit under .local/evidence, with full parity in update-parity.log and captures under .impeccable/review. An earlier test-mac pass is retained under .local/evidence/update-notice. These checks establish browser behavior and simulated XR routing, not physical Quest acceptance. The pre-existing optional GLTF blob-fetch warning remains tracked upstream. The private remote daemon, server, browser and scratch were removed, and port 4241 was confirmed clear. No owner shell, security configuration or shared service was changed.

Run make update-notice-check only against an owned isolated fixture, with MUX_XR_PRIVATE_TEST=1, MUX_XR_BASE_URL and MUX_XR_UPDATE_TEST_ROOT explicitly set. The script deliberately replaces that fixture's served directory to exercise a real build change. It must not target the live workspace.

## Spatial terminal arrangements

Attached terminal panels now support Row, Grid, Arc and Sphere presets. Browser Workspace settings provide a persisted pattern draft and explicit Apply arrangement, which opens the 3D preview. The native grabbable Arrange menu exposes the same four actions. Sphere occupies a forward spherical surface and curves in both axes for multi-row layouts. Every panel faces the viewer. Geometry uses size-aware spacing and chord-safe curved separation, including high-latitude contraction, with no clamped edge positions that collapse large grids.

Application uses the current world-space eye position and yaw while preserving individual physical scales, text zoom, selected/input target and terminal grid. One- and two-controller holds are rebased after placement so they continue without snapping back. Adding another terminal leaves existing poses intact. Recovery clears the native preset highlight when restoring defaults. Only the last chosen pattern is stored, not a library of named transforms. Named layouts and animated restore remain roadmap work.

The fast and full parity gates pass with 115 tests, strict TypeScript, asset validation, secret scanning and dependency audit. Geometry cases cover empty/single/two/six/twelve panels, mixed sizes and 64 unique spherical positions. These mathematical cases do not establish headset capacity. Interaction regressions cover all four viewer-relative presets, unchanged input/size/zoom/grid, native action routing, continued gripping, two-hand rebasing and recovery highlight state. Browser UI tests cover empty/disabled state, explicit application, stored-value validation and native-choice synchronization.

The actual minified app served by a private streamer passed desktop 1440×900 and mobile 390×844 checks on native Apple M4 Metal. Each pattern opened the 3D preview, produced finite panel transforms and preserved IDs, selection, scales and metadata grid dimensions. A separately compiled real-scene fixture used six synthetic panels and native scene-button picking under the same server CSP. All four menu choices applied with zero resize calls and zero fixture/page/asset failures. Screenshots include the native menu and six-panel overviews of Row, Grid, Arc and Sphere. Overview captures move the verification camera after arrangement and are not headset viewpoints.

The same run passed production foreground-glyph checks with 187/284/240 pixels and no label failures. Accepted load was 1.725 before and after the booked test-mac run, below 15. The existing optional GLTF blob-fetch and favicon warnings are recorded separately. Earlier excluded checks found an ambiguous canvas locator and generic favicon 404 handling in the verifier, both corrected before acceptance. A mid-edit lint attempt was also excluded and the final full gate rerun passed.

Evidence is under .local/evidence/arrangements, with the gate in arrangements-parity.log. The private daemon, browsers, copied dependencies and remote scratch were removed, port 4241 was confirmed clear, and the GPU booking was released. These checks establish layout software behavior and rendering with synthetic content. Physical Quest arrangement comfort/readability and real workload capacity remain owner checks. No owner pane, daemon, shell or security configuration was changed.

For an owned private test root containing a copy of dist, compile scripts/arrangement-fixture.ts into arrangement-fixture.js in that root with bun build --target browser. Serve the root using the streamer, then run make arrangement-check with MUX_XR_BASE_URL, MUX_XR_PRIVATE_TEST=1 and MUX_XR_TEST_ROOT explicitly set. The script writes fixture HTML and screenshots to that root, so do not point it at the live workspace.

## Quest feedback repair and existing-daemon profile

Owner testing confirmed readable keyboard text at all distances, working grip/rotation/push-pull, and functional background modes. The next repair removes separate gaze-emphasis highlighting: only the selected input pane receives the active marker. Labels use solid backgrounds instead of raster hairlines, and the active marker is a broad, static low-opacity mesh. Tooltips retain their 700 ms dwell and target-relative placement, with bounded distance scaling. The authored planet's base tint and emissive intensity are reduced so a failed optional texture cannot leave a bright white disc. SDF fonts and manipulation contracts are preserved.

Commands → New command edits Name and Command using the native keyboard, offers Global/Workspace and Enter behavior, and saves locally without executing. Persistence failures retain the draft. Existing remote columns/rows are adopted by the viewer, and screen, frame, active marker, title and terminal-key controls follow server-confirmed dimensions. Root position, rotation, scale and text zoom remain intact. Browser grid drafts survive ordinary output updates until Apply/acknowledgement. Arrangement spacing for actual new window bounds is deliberately deferred to card 01a1992ee3937163ba2a66768cdf2919, after this drop.

Startup connects automatically to a populated endpoint. Metadata and pane viewers retry indefinitely with capped backoff, cancel correctly on replacement/disposal and never replay unsent input. Initial attachments prefer the existing default workspace/session and active pane. Desktop/main-page update detection automatically reloads to a cache-busted URL. XR and pending immersive entry retain the explicit Update: Reload path, which exits XR before navigation.

The full parity gate passes with 135 tests and strict TypeScript. A native Apple M4 Metal fixture compiled the actual main/business callbacks with a narrow XR renderer/controller shim and used two private real Bash panes on an isolated official 0.76.0 mux/streamer pair. Virtual keys produced stream output and changed visible terminal pixels for each pane. Color pixel hashes were distinct for Original, Monochrome and Comfort: 39429735, 225516547 and 1410961039. Explicit 100×30 Apply and restore emitted exactly two resize messages. The XR screen changed from 1.42×0.8 to 1.775×1.0 while retaining position and scale. Native command Save emitted no terminal input, and explicit Run executed afterward. Forced viewer reconnect completed with four total viewer connections and no input replay. The second private pane retained its pre-existing 120×36 grid. No test used the real/default daemon.

The accepted native run had load 2.397 before and 2.365 after. Strict-CSP production label crops contained 187/284/240 foreground pixels with no label failures. A separate actual served A-to-B update test observed four manifest polls and two document navigations, automatically adopting build dfafc8351da08255b5573e29c43960656439004358062106db2ef42270f0dd35 from 1ca1b8187d5cfe360e26b9bd9273cccc7144989a6bbcca1590c8815f42a5e5af without clicking Reload. Its load was 1.867 to 2.031, with zero page errors. An old wait-for-visible-notice assertion was removed because automatic desktop navigation makes that notice transient. Earlier fixture setup failures were excluded before the passing reruns.

Evidence is under .local/evidence/quest-feedback and quest-feedback-parity.log. All private browsers, daemons, shells, copied dependencies and scratch on test-mac were removed, and port 4241 was confirmed clear. Optional GLTF blob-texture and favicon warnings remain separately recorded. Existing-process mutation is excluded from live delivery checks: the real default daemon is used only by normal application connections, not regression tests. New real-pane creation remains blocked on the supported opt-in core API, card 01a1991e1e20727d8ff8a32afc0b212f. Physical Quest input, shimmer/tooltip comfort and the quieter planet remain owner rechecks.
