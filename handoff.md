# XR hand debugging handoff

Updated November 5, 2026, after the approximately 9:00 PM PST Quest recording.

## Progress since this handoff (November 5, ~9:45 PM PST)

- **A1 done.** Dense review of the 20:59:59 clip is in `.local/evidence/hand-review-1105b/findings.md` (primary checkout). Main failures: P1, the thumb renders as a rigid sideways paddle whenever it is not pinching, and snaps when opposition releases (17.37→17.47 s). P2, the fingers merge or interpenetrate during partial curls (12.0–13.0 s, 17.07–17.37 s). P3, the open spread is wide. P4, there are one-frame curl and thumb pops.
- **A2 root cause.** The layer replay (`.local/evidence/hand-retarget-1105/layers/`, with plots `layers.png`, `aligned.png` and `candidate.png`) showed that the base retarget caused the paddle, not the constraint layer. The authored rest pose sits 15–33° from Paul's tracked neutral on the fingers and **67–75° on the thumb** (authored sideways, tracked forward beside the index). Neutral-relative deltas were applied to that rest, so the thumb never left the sideways pose. The runtime palm basis matches the neutral-capture basis, and the neutral quaternion −Z matches the segment directions within 1–3°.
- **Fix `fa3d942` on main (squash-merged, not pushed).** Each bone now applies its deltas to the rest re-aimed along the neutral joint's −Z axis, so every bone points along its tracked joint. Tracked fingers no longer blend toward the canned fist. That blend now applies only to the controller grip. The palm cup is kept. Thumb-root displacement applies only in proportion to the opposition weight. Thumb IK swings from the tracked direction.
- **Verification.** `make checkall-ci` is green with 527 tests, including a new regression that fails on the old solver at 68–75° and passes now. The VR, AR and Keyborb browser fixtures pass on M4 Max Metal (`.local/evidence/hand-retarget-1105/aligned-{vr,ar,keyborb}`). Pinch bone ends render 17 mm apart. Keyborb sends one key per pinch.
- **P2 check.** Across all 248 captured motion frames, the minimum finger-to-finger surface gap is 4.0 mm, with none under 2 mm (`.local/evidence/hand-retarget-1105/layers/gaps-all.ts`). The captured motion shows no merged or interpenetrating fingers, but that capture predates the rejected clip.
- **Contract change.** The neutral hand no longer reproduces the authored Open mesh. It follows Paul's real hand. The mesh, weights and Blender file are unchanged.
- **Still open.** Paul has to accept the result in the headset. Full-fist finger gaps measure about 12 mm (they were 6 mm when the canned fist overrode tracking). The max sampled thumb step is 32–42° against 68–72° before, still higher than the input during opposition transitions. Paul authorized Blender re-rigging on November 5 (~9:40 PM). If the thumb web creases at the new tracked angles, or the 45 mm finger-root spacing still reads as claw-like, adjust the rig or weights in `/path/to/editable-hand.blend`.

- **Blender tuning (November 5, ~10:15 PM PST), not pushed.** Paul chose to tune in Blender first and reported: "the hand looks a bit webbed and outside finger is bent a bit".
  - **Outer finger.** The outer-finger mesh sat 6–8 mm outward of its straightened bones, which made it look bent. The mesh and bones are now on one straight axis, and the outer root is at x=−47.8 mm.
  - **Webs.** Both web crotches are about 10 mm lower and stay round.
  - **Model edit.** Vertices and outer bones changed only. Topology, weights, groups and actions are unchanged. The new asset is `assets-source/hand/precision-v4` (GLB `836fabdaccd9…`). Paul's open `XR_hand.blend` was not modified, and the snapshot is `precision-v4/pre-edit.blend`.
  - **Independent review.** Over four tuning rounds the scores were 76, 72, 74 and 82/100, against 55–62 for the previous model. Remaining minor items are a faint shading ridge at the inner index root and slightly slimmer digit roots.
  - **Checks.** `make checkall-ci` is green (527 tests). The VR, AR and Keyborb fixtures pass on M4 Max Metal. Across 248 captured frames the minimum finger gap is 3.2 mm (was 4.0), with none under 2 mm.
  - **Evidence.** In the primary checkout, `.local/evidence/hand-shape-1105/` holds renders1–4 and fixtures.
  - **Correction.** The 20:59:59 clip predates `fa3d942`. No Quest recording of the aligned retarget exists yet.

## Start here: the hands are still broken

Paul's latest feedback is: **"hands are still messed up, pull latest video then create handoff.md for a new agent to take over"**.

The owner has rejected the current result. This is an unresolved engineering problem, not merely an outstanding approval. Earlier statements that the poses passed tests or looked acceptable in screenshots do **not** establish that the hands look or work correctly in the headset. Do not treat any commit below as an owner-approved hand implementation.

The original handoff changed documentation only. The progress section above records the fix that followed.

## Latest video — already on this Mac

- **Mac:** `/Users/localuser/Movies/Quest Recordings/com.oculus.browser-20261105-205959-0.mp4`
- **Quest original:** `/sdcard/Oculus/VideoShots/com.oculus.browser-20261105-205959-0.mp4`
- **SHA-256, matched independently on Quest and Mac:** `dd19ee71ab0b58a4eba21b96e2ceae696dc2f933283a199e7a0fcab6b18d9159`
- **Size/duration:** 9,916,287 bytes, 20.469270 seconds.
- **Media:** 1920 × 1080 HEVC video, AAC audio, 614 video frames. Use timestamps for extraction. `r_frame_rate` is misleading for this file; the reported average is approximately 30 fps.
- **One-frame-per-second overview:** `/Users/localuser/Repos/mux-xr/.local/evidence/hand-handoff-1105/latest-contact.jpg`. Cells run left to right, then top to bottom, beginning near zero seconds. The final empty cells are padding.

The overview contains open hands, curls, rotations and pinch-like poses. It is a locator, not a diagnosis of the new failure. Earlier analysis used extracted frames, enlarged crops and joint replay, **not continuous video playback**. The latest video has not been root-caused. Inspect its transitions as well as its held poses. It is newer than all the joint captures below, so those captures are not synchronized ground truth for this clip.

## Repository and live environment

| Item | Current value |
| --- | --- |
| Primary checkout | `/Users/localuser/Repos/mux-xr` |
| Current Codex checkout | `/path/to/mux-xr` |
| Code baseline | precision-v4 hand asset on top of `fa3d942` (hand retarget fix; earlier baseline `94bc28b`) |
| Latest runtime change | `fa3d942` |
| Live frontend | `https://192.0.2.10:4240` |
| Served build | rebuilt from `fa3d942` on November 5 (~9:50 PM PST) |
| Frontend asset | `/assets/index-Cv3EhiM2.js` |
| Live streamer par-mux session / pane | `$1019` / `%1387` |
| Runtime handoff metadata | `/Users/localuser/Repos/mux-xr/.local/runtime.json` |
| Main kanban item | `01a1ae0c706d72418cfb5d63c9058f38` |
| Earlier related hand-distortion item | `01a1adf28bbe77e68007bfde280d2908` |

The worktree and main were clean at the start of this handoff. Prior feature branches were locally squash-merged and deleted. The harness-owned Codex checkout remains available, generally detached at main between tasks. Use a feature branch/worktree for new edits. Do not remove or alter the other old worktrees. No push was performed in this work, and there is no standing push approval.

The existing streamer serves the primary checkout's `dist`. It uses the owner's real default par-mux daemon and shells. **Do not restart that daemon/streamer or send automated typing, resize or command tests to the real default sessions.** Browser fixtures must remain isolated and mock their WebSocket traffic. A local frontend build updates the served files without restarting the streamer. Changes in XR are offered through the watch/HUD update UI; do not forcibly reload an active immersive session.

## Owner requirements and decisions to preserve

- **D1 — Custom model:** Paul created the orange three-finger-plus-thumb hand in Blender and wants it used. Preserve his source mesh and corrected editing vertex groups. Do not silently replace it with a generic five-finger hand or rewrite weights without inspecting the actual rig and deformation.
- **D2 — Native lasers:** A palm-origin/finger-axis laser experiment was explicitly rejected. The original headset-provided target rays were restored. Do not reinstate the palm-ray override because an earlier message asked for it.
- **D3 — Input behavior:** Keyborb defaults to Auto, switches on for hand tracking, raises the nearest resting orb by its diameter, flashes green on activation, and latches/deduplicates pinches. Both distant rays are suppressed near a keyboard; the left ray is suppressed near the right-wrist watch. Preserve these behaviors while investigating the hand visuals/input correspondence.
- **D4 — Watch and MR:** The right-wrist watch has local 12-hour time, an update indicator and a Reload update action. Left-hand contact can activate it. Passthrough MR already exists. These are not missing features to add again.

## Where the implementation lives

Paths below are relative to the primary checkout.

| File | Responsibility |
| --- | --- |
| `src/xr/rigged-hand.ts` | GLB loading, calibration/retargeting, controller curls, rendered contact probes and fingertip midpoint. Calls the constraint layer after initial bone rotation transfer. |
| `src/xr/hand-pose-constraints.ts` | Most recent corrective layer: coordinated closing pose, finger-root convergence/cupping, thumb-root displacement and two-link contact IK. Highest-priority code to inspect critically. |
| `src/xr/hand-neutral-reference.json` | Owner-specific left/right neutral joint quaternions and palm-relative thumb-base positions. |
| `src/xr/cartoon-hand.ts` | Procedural fallback, raw joint sampling, palm basis, arm/wrist metadata and raw fingertip metadata. |
| `src/xr/hand-input.ts`, `hand-contact.ts`, `keyborb-input.ts` | Raw gesture intent, direct contact and key selection/debounce. |
| `src/xr/scene.ts` | Input routing, native rays, tracking lifecycle and suppression rules. |
| `tests/rigged-hand.test.ts` | Neutral, dimensions, captured pinch, partial/full closure and tracking-preservation regressions. |
| `tests/fixtures/quest-*.json` | Older wrist-normalized poses, neutral references and selected gesture captures. |
| `scripts/hand-visual-check.ts` | Actual app with private XR shim; captured poses from front and ±60-degree views, VR/AR, watch/controller checks. |
| `scripts/keyborb-check.ts` | Isolated keyboard selection, feedback, mode switching and duplicate suppression checks. |
| `assets-source/hand/PROVENANCE.md` | Asset history and current rendering contract. Historical verification is not owner acceptance. |

### Current algorithm, including its assumptions

Initial retargeting applies each tracked palm-relative joint rotation relative to the captured neutral orientation, then applies the authored rest orientation and removes the **current** target-parent world rotation. All bone scales remain one. Thumb bones `thumb_01` and `thumb_02` both use `thumb-phalanx-proximal`; `thumb_03` uses `thumb-phalanx-distal`.

The subsequent constraint layer is heuristic and has **not** solved the owner's real-use complaint:

- **F1 — Closing:** It measures summed segment bends on index/middle/ring, takes the minimum, and normalizes with `smoothstep(0.75, 2.2)`. It blends all three visible fingers toward hardcoded local angles `[1.2, 1.35, 0.75]` radians. This can override independent tracked motion. The tracked left/right curl signs differ.
- **F2 — Cupping:** It targets approximately 21 mm lateral tip spacing, permits index/outer root travel up to 14.5/10 mm and adds up to 0.26 radian of convergence. Thus the old invariant that every bind translation stays fixed is no longer true. Child segment lengths/scales are retained.
- **F3 — Thumb:** It moves the thumb root by the tracked MCP displacement relative to the neutral reference, capped at 50 mm. Pinch/fold proximity blends a two-link solver toward the rendered index tip or knuckle. The pole uses the palm depth axis with a handedness sign. It uses fixed 17–22 mm center offsets for rounded pad contact. A single offset is not a universal surface-contact solution.
- **F4 — Input separation:** Raw source transforms and raw `indexTip`/`thumbTip` metadata are retained. `keyborbPoint` is the midpoint of rendered bone endpoints; contact probes sample deformed skin. A visually corrective pose can still move the rendered typing target in a way that feels wrong. Investigate that relationship instead of assuming untouched raw input proves correct interaction.

The GLB's Open/Fist/Pointing/Thumbs Up animation clips are preview/test assets. `rigged-hand.ts` drives live bones procedurally and does not play those clips with an AnimationMixer. Editing a preview action alone will not fix the live tracked-hand path.

## Source model and Blender

- Last inspected owner file: `/path/to/editable-hand.blend`, Blender 5.2.2. Recheck the actual live file and scene before touching it.
- Runtime GLB: `/Users/localuser/Repos/mux-xr/public/assets/hand.glb`.
- Staged GLB: `/Users/localuser/Repos/mux-xr/assets-source/hand/authored-hand.staged.glb`.
- Both currently hash to `95714f02a92e58eba41a26ebf1e8197369c336da9844ce36d15bad147af51e0d`.
- Current source stage is `assets-source/hand/precision-v3`. The recent runtime fixes did not change the GLB, weights, source mesh or owner editing groups.
- The rig has 13 bones: wrist plus three segments each for thumb/index/middle/outer. Authored coordinates are +X toward thumb, +Y along fingers, +Z depth. The rigged outer digit follows ring-finger tracking; the procedural fallback combines ring/little positions differently.
- Prior inspection placed the thumb root at x=70.67 mm with substantial thumb-root weights around the palm junction. The first two visible thumb sections total approximately 39.51 mm; the distal section is approximately 20.01 mm.
- Prior source-action inspection measured approximately 22–23 mm gaps between curled fingers. The source Fist action itself looked claw-like. Its thumb fold did not provide convincing opposition. This is evidence to revisit, not justification for more arbitrary runtime offsets.

Use the rigged-character/Blender skills and the current model-routing instructions. Original Blender work uses an isolated suitable authoring agent, with independent visual evaluation. Preserve the owner scene. Temporary inspection poses must be restored. MCP execution-local variables may not survive across calls even though imported modules can remain cached.

## Changes tried and their outcomes

| Commit | Change | Important outcome |
| --- | --- | --- |
| `4867d38` | Preserved authored bone dimensions instead of fitting all tracked endpoints | Reduced stretching; owner still rejected the appearance. |
| `27373ae` | Relative bends, rendered Keyborb target latching, watch update indicator | Keyboard fixes retained; hand/thumb motion still wrong. |
| `864e719` | Separate neutral quaternion references and palm-origin rays | Isolated math tests passed; owner rejected lasers and thumb bend placement. |
| `6eb0ef3` | Restored native rays; mapped two visible thumb bones to proximal tracking | Base-pivot regressions passed; owner still reported spread fingers and weird thumbs. |
| `b434bda` | Added the current pose-constraint layer | Selected captures and static reviews improved; latest owner report says hands remain messed up. |
| `94bc28b` | Added held full-fist fixtures for both hands | Test-only commit; runtime fingerprint unchanged. Passing full-fist snapshots did not establish real-use correctness. |

Use these as comparison points in an isolated preview. There is no known-good, owner-approved hand implementation in this sequence. Avoid reverting unrelated keyboard/watch fixes.

## Evidence and the limits of previous verification

Primary local evidence folders:

- **E1 — Latest rejection:** `.local/evidence/hand-handoff-1105` and the new video linked above.
- **E2 — Held full fists:** `.local/evidence/held-fists-1105`. Includes raw capture, selected poses, front/side images, metrics and gate log. 153 active left and 127 active right samples; five stable frames averaged per fixture pose.
- **E3 — Earlier motion/pinch:** `.local/evidence/hand-motion-1105`. Includes 248 active samples, `replay-report.json`, baseline/current metrics and browser captures. These preceded the latest video.
- **E4 — Prior iterations:** `.local/evidence/thumb-pivot-1105`, `thumb-retarget-1105`, `pinch-curl-watch-1105`, `quest-deform-1105`.

Previous `make checkall-ci` passed **525 tests**. VR/AR/Keyborb browser fixtures passed on native Apple M4 Max Metal. Static independent reviews scored selected images approximately 83/100. Held-fist nearest-surface samples measured approximately 3.6/4.7 mm inter-finger gaps, and selected pinch endpoints were 17 mm apart with apparent pad contact. **These are limited software/static observations. The owner has now explicitly rejected the actual result.**

Important remaining gaps:

- **R1 — Temporal behavior:** The earlier replay report contains thumb steps around 61–72 degrees between sampled frames, including a roughly 61-degree rendered step with an approximately 8.7-degree input-orientation step. Its simplistic spike filter still reported no spikes. That report is not proof of smooth motion; inspect timestamps, source position changes and constraint weights together.
- **R2 — Coverage/overfitting:** Mean neutral poses and selected averaged fist/pinch frames cover a small subset of the motion. They can pass while transitions, free thumb movement, partial curls, release, occlusion and normal typing remain bad.
- **R3 — Surface geometry:** Endpoint distance and nearest-vertex gaps do not rule out penetration, collapse or stretched thumb-web skin. Reviews observed angular thumb-base folds. Inspect the whole deformation through motion and all views.
- **R4 — Coordinate/model fit:** Real five-digit anatomy, the four-digit stylized mesh, authored sideways thumb, joint local axes and left/right chirality differ. The initial neutral-offset approach plus the later pose/IK layer may conceal rather than correctly resolve those differences. This is an investigation hypothesis, not an established new diagnosis.

## Practical next steps

1. **A1 — Review the newest clip first.** Inspect continuous motion or dense timestamped sequences. Write down concrete failure times and the affected hand/joints. Do not begin with another offset adjustment based only on a favorable held pose.
2. **A2 — Reproduce and separate the layers.** Compare the initial retarget output with the constraint output in an isolated preview. Log source joint transforms, palm basis, neutral reference, constraint weights, root displacement, bone poses and visible fingertip/contact positions together. Compare current behavior with `6eb0ef3` diagnostically, not as an assumed fix.
3. **A3 — Preserve input semantics while diagnosing.** Keep native rays, pinch deduplication and proximity suppression. If correlated new capture is needed, wait for actual hand tracking before starting the capture timer, and correlate it with the video/build.
4. **A4 — Validate complete movement.** Check slow and fast open/close, partial curls, independent fingers, free thumb opposition, pinch/release, both hands, wrist rotations, tracking loss/recovery and real Keyborb typing. Add regressions from the actual failure, not merely expected solver constants.
5. **A5 — Require owner acceptance.** Green tests and another static review are insufficient. The hand issue remains open until Paul confirms that motion, appearance and interaction work in XR.

## Capture and test operations

ADB is `/Users/localuser/Library/Android/sdk/platform-tools/adb`; Quest serial is `2G0YC5ZF8D000L`. It was connected and authorized when the latest video was pulled. Recheck rather than assuming that persists. USB authorization has reset during this session.

Read-only joint capture helpers remain in the Codex checkout under `.local/hand-motion/`: `capture.mjs`, `capture-fists-tracked.mjs`, `read-joints.mjs`, `analyze.mjs`, `analyze-fists.mjs`, `replay.ts` and the metric probes. They use Quest Chrome DevTools, locate the application's scene via the `window.__muxXR.getState` closure, and sample joint transforms. These are task-local diagnostics, not a supported product API. Cached tab URLs/forwarded ports are stale after cleanup. Create a new `adb forward tcp:0 localabstract:chrome_devtools_remote` and fetch its current `/json` before reuse; remove only that forward afterward.

`xrMode: vr` does not prove hand tracking is active. Two captures initially returned invisible hand groups. Put controllers down, acquire open hands and verify both source/model groups are visible before asking for a closed pose. The successful bounded helper waited for tracking, then recorded ten seconds. Always inspect active sample counts; a completed empty capture is a failure.

This Mac's FFmpeg lacks the `drawtext` filter. Timestamp/crop contact sheets can use `uv run --no-project --with pillow python`; default `python3` did not have Pillow. Do not mislabel still-frame inspection as watching a video continuously.

The project gate is `make checkall-ci` (lint, TypeScript, tests, build, asset comparison, gitleaks and dependency audit). No checked-in CI definitions were found in the usual repository locations during this handoff; no remote CI run was performed. Existing warnings are not proof of the hand bug's status.

Private browser checks need `MUX_XR_PRIVATE_TEST=1`, a loopback `MUX_XR_BASE_URL` and `MUX_XR_TEST_ROOT`; `MUX_XR_MODE=vr|ar` selects the hand visual fixture. Port 4241 is reserved for isolated mux-xr checks. Use par-mux for managed preview/test processes, inspect the actual renderer, and book/release the host per the project instructions. `.local/hand-motion/run-held-fists.sh` and earlier run scripts illustrate the invocation but require a fresh owned preview server.

At handoff, temporary capture forwards and test servers from the earlier work were removed. The real streamer remains running. No new agent/chat was launched by this handoff task. Claim the existing kanban item when taking over; its final state is backlog because the owner supplied a negative verdict and requested a new agent, not because we are waiting for approval.
