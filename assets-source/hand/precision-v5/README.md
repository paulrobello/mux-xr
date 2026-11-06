# Narrower finger spacing and a smooth outer root

This candidate answers the owner's November 6 headset review of precision-v4: "the outside finger still has a lump in it and the fingers are still too far apart". The third point of that review, the thumb tip on a closed hand, was a runtime fix in `src/xr/hand-pose-constraints.ts`, not a mesh change.

`pre-edit.blend` is a byte copy of `precision-v4/candidate.blend`. The owner's open `XR_hand.blend` is not touched.

- **Spacing.** The digit roots sat about 47 mm apart, roughly twice a real hand's spacing for digits about 25 mm wide. `narrow.py` moves the index digit 17 mm and the outer digit 14 mm toward the middle finger. Bones translate without rotating, so action keys and `restLength` are unchanged. Vertices with more than 0.9 index or outer weight move rigidly. The middle digit, the thumb and the palm below 80 mm stay put, and a biharmonic solve interpolates everything in between, so the displacement leaves every fixed region with zero slope. Four Taubin relaxation passes follow. A hand-tuned lateral blend creased the palm below each crotch and notched the outer palm edge. A Laplace (membrane) solve left slope breaks along the lock edges, which showed as a crease below the index–middle web and a bump in the thumb–index web on the back; the biharmonic solve halves the second difference of the displacement there (peak 1.3 to 0.8 mm, 99th percentile 0.58 to 0.32 mm). `NARROW_SOLVER=harmonic` reproduces it. Compressing each web left a pinched V floor with a crease below it, so 60 smoothing passes with a radial falloff (18 mm around each web floor) round it back into a U. The outer palm edge dipped about 2 mm below the outer root and then flared out; the same smoothing within 26 mm of that spot straightens it. Roots are now at x = 29.6 (index), −1.6 (middle) and −33.8 mm (outer). Digit widths more than 10 mm above the roots are unchanged. Topology, weights and groups are unchanged, and the script asserts a digest of faces and weights.
- **Outer-root lump.** When the outer digit splayed, the skin at the outer edge of its root bunched into a bump, because the wrist-to-`outer_01` weight blend there is short. `root_weights.py` smooths only the wrist/`outer_01` split for the 132 vertices within 26 mm of the `outer_01` head on its outer side, keeping each vertex's total for the two groups (mean share change 0.13, max 0.22). A wider 34 mm blend dented the palm edge and was rejected. The same script widens the thumb_02/thumb_03 split within 14 mm of the thumb's last joint (74 vertices, mean share change 0.15, max 0.26), because a resting thumb now bends about 45° there and the short blend creased it. Vertex positions and topology are unchanged.

Across the 248-frame Quest motion capture, the median finger surface gap is about 10 mm (precision-v4: 23.7 mm) and the minimum is 2.4 mm, with none under 2 mm. Shifts of 20 mm or more produced contacts under 2 mm. Blender reimport (`validate_export.py`) found one skinned mesh with 13 bones, the four clips, and normalized weights with 1–4 influences (`reimport-validation.json`).

To regenerate, run:

```
Blender -b pre-edit.blend --python narrow.py
Blender -b narrowed.blend --python root_weights.py
Blender -b candidate.blend --python export_stage.py
Blender -b candidate.blend --python validate_export.py
```

`render_views.py` (with `RENDER_TAG` and `RENDER_DIR` set, and `SPREAD_ANGLE` optional) writes front, spread, Fist and curled review renders.

- Pre-edit SHA-256: `5119677a0e44efc799a334dd40593b53afc4d3f11f5353a52064e09f110d882a`
- Narrowed SHA-256: `cca8f76e359e855e5157cf9cc07f7aad8e8de54774c897f3a4f0856aa0ab50ce`
- Candidate SHA-256: `ea5d289720e933fce2714a7c1323573b2abdc1b64ae627be488f759a75c4b378`
- Staged GLB SHA-256: `6f2274e0a39497d629c70049e5b0d9f18a698dd8f0de50504bba17940f2baf97`
