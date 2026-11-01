# Orbital observatory candidate

Original Blender-authored static environment for the approved Mux XR concept. The layered pressure-frame opening, panelled deck, overhead haunches, recessed service consoles, status indicators, distant planet and sparse stars share ten runtime material groups.

## Build and check

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-observatory.py
uv run --no-project python scripts/assets/check-observatory.py
```

For an independent fresh rebuild, add `-- --repro --no-render` to the Blender command. Compare `repro/staging/observatory.glb` with `staging/observatory.glb`. The checked candidate matched byte-for-byte across two fresh Blender 5.2.2 processes. `reproducibility.json` records the hashes and binds the review images to the candidate.

## Source and material contract

- `observatory-high.blend`: 292 editable mesh components, three-segment bevels and a 128×64 planet sphere. It includes a CPU preview rig, which is excluded from export.
- `observatory-low.blend`: the runtime geometry, with one-segment bevels and a 96×48 planet sphere, batched into ten material meshes. Preview camera and lights are excluded from export.
- `archive/`: immutable superseded source revisions retained by content hash.
- `maps/planet-basecolor.png`: original seeded, spherical noise color field materialized as a 2048×1024 sRGB PNG. The same image drives the distant planet's base and low emissive color. It contains no directional lighting.
- Architecture uses portable scalar PBR colors, metallic and roughness values. Bevels remain actual geometry. There are no procedural Blender nodes, normal maps, projected details or omitted relief requiring a high-to-low projection bake.
- No external art, paid provider, audio, collider, animation, socket or runtime lighting asset is used.

The GLB uses meters, +Y up and −Z forward. Root `observatory` is at floor origin. The central reading volume x=−2..2, y=0.4..2.8, z=−4..−0.5 is clear. The planet center is (13,12,−69), radius 11. The seated runtime eye is (0,1.6,0). Large overall bounds include the distant stars and should not be used to auto-fit the workspace camera.

## Verified candidate

The staged GLB has 22,712 triangles, ten meshes, ten materials, ten draw calls, eleven nodes and one embedded PNG. It is 2,528,120 bytes. A clean Blender reimport preserves triangle count and bounds within 1 mm. The standalone checker validates hashes, counts, root identity, embedded PNG dimensions, finite positions/transforms, unit normals and the absence of cameras, lights and external references. `report.json` contains the measured data and source hashes.

`previews/review-sheet.png` presents the same-camera high, low and reimported views plus a wider peripheral view. All renders used Cycles CPU, 12 samples, 960×600. These are visual evidence, not performance measurements. Average high-to-low RGB difference is approximately 0.72/0.89/1.03 on a 0–255 scale. The low-to-reimport difference is below 0.004 per channel.

Technical asset checks pass. Runtime loading, fallback/lifecycle tests, Quest 3 behavior and owner visual acceptance remain pending with the integrating session. The authoring agent has not recorded owner approval or promoted the GLB into the public asset directory.

## Build findings

Blender's exporter varied triangle order and a UV component by approximately 5.96e−8 between fresh runs. The generator now canonicalizes cyclic triangle indices, sorts triangles and rounds UV coordinates to 1e−6 before reimporting. This preserves triangle winding and positions and yields identical exported bytes. Joining source objects invalidates their Python handles, so material groups are gathered before joining. A clean factory scene has no world, so the CPU preview rig creates its own world when needed.
