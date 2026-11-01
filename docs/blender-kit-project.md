# Mux XR observatory asset contract

## Approval and Scope

Paul approved the dark orbital observatory concept in this chat on October 31, 2026 and authorized implementation with sub-agents. The environment must support terminal readability: peripheral architecture, dark open central viewing area, distant planet and sparse stars. No ambient sound. Blender may be used as needed. No paid provider step is authorized or needed.

## Piece and Runtime Frame

One rigid background piece, `observatory`, rendered in Three.js 0.186.1 on Quest 3. Meters, glTF Y-up/-Z-forward, origin at the center of the user's seated workspace on the floor. Typical eye is (0,1.6,0), terminals near z=-1.5 to -2.5. Keep the forward central reading volume x=-2..2,y=0.4..2.8,z=-0.5..-4 mostly unobstructed. Architecture can frame the view at x outside +-2.5 and below y=0.3. Background planet beyond the window, not intersecting panels. No colliders or sockets needed for decorative background.

## Deliverables and Ownership

- Checked-in deterministic generator: scripts/assets/build-observatory.py.
- Editable high and low sources: assets-source/observatory/observatory-high.blend and observatory-low.blend.
- Staged self-contained GLB: assets-source/observatory/staging/observatory.glb. Root promotes to public/assets/observatory.glb only after technical checks.
- Contract report/provenance and hashes in assets-source/observatory; preview render(s) for technical review.
- Portable PBR materials/textures, with maps baked if procedural detail is used. Preserve high/low source distinction. No dependencies on a Blender-only shader in the runtime.

The asset agent owns only these paths. Root owns the runtime loader and fallback. Loader materials are immutable per scene instance and fully disposed on teardown. Failure preserves the existing procedural black/gradient fallback and a concise diagnostic.

## Budgets and Validation

Background budget: <=60,000 triangles, <=16 materials/draw calls, <=2048px texture dimensions, <=12 MiB GLB, no lights/cameras exported, finite transforms, no external texture references, stable root named observatory. This is a single static background, so an additional LOD chain is optional only if the base asset comfortably fits these bounds. Validate by reimporting the exported GLB into clean Blender, report geometry/material/file counts and bounds, compare high/low fixed views, then integrate into the actual app for browser/Quest review. Do not record owner visual approval yourself.

## Invocation and Resource Window

Use /Applications/Blender.app/Contents/MacOS/Blender headless with --python-exit-code 1. Initial CPU authoring/export/static checks used dev-workstation load-tolerant booking 01a1958be47f722780e7554b21004123, which is closed. Future runs need a fresh reservation. GPU rendering and timing measurements require an appropriate booked window and actual host-load verification. Use deterministic seeds and record Blender version.
