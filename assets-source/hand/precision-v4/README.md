# Straight outer digit and lower webs

This candidate answers the owner's review of precision-v3: "the hand looks a bit webbed and outside finger is bent a bit".

`pre-edit.blend` is a copy of the owner's open `XR_hand.blend`, saved without modifying it. Its mesh and bones are identical to `precision-v3/candidate.blend`. `shape_edit.py` moves vertices and the outer bone chain only. Topology, weights, Edit groups and the four actions are unchanged, and the script asserts a digest of faces and weights.

- **Outer digit.** precision-v3 straightened the outer bones but not the mesh. The mesh centreline sat 6–8 mm outward of the bones along most of the digit and met them only at the tip, so the digit read as bent. The script kernel-smooths the mesh centreline, shifts each outer vertex onto a straight line from the base centre to the tip centre (scaled by its outer-bone weight), and moves the three outer bones onto that line, keeping their joint fractions. Action keys are converted to the new bone frames. The outer root moved from (−42, 127.5) to (−47.8, 125.7) mm in Blender X/Z. Centreline offsets are now within about 2 mm of the bones, at the noise level of the slice measurement (`measure_shape.py`).
- **Webs.** Both crotches dropped by about 10 mm, from 137.4 mm to 127.4 mm (middle–outer) and from 136.2 mm to 126.2 mm (index–middle). Each U-shaped crotch drops rigidly within 11 mm of its centre, so it stays round, and the drop fades out by 27 mm laterally, 50 mm toward the wrist and 35 mm up the digits. Ten Taubin (shrink-free) relaxation passes over the edited webs and the outer-digit seam remove creases at the edit boundary. Earlier trials with a peaked or Gaussian falloff turned the crotches into pointed V shapes and were rejected.

Parameters and measurements are in `shape-edit-report.json`. Blender reimport (`validate_export.py`) found one skinned mesh with 13 bones, the four clips, and normalized weights with 1–4 influences (`reimport-validation.json`).

Across the 248-frame Quest motion capture, the minimum finger surface gap is 3.2 mm, with none under 2 mm (precision-v3: 4.0 mm). The closest pair moved from index–middle to middle–outer.

To regenerate, run:

```
Blender -b pre-edit.blend --python shape_edit.py
Blender -b candidate.blend --python export_stage.py
Blender -b candidate.blend --python validate_export.py
```

`render_views.py` (with `RENDER_TAG` and `RENDER_DIR` set) writes the front, spread and spread-back review renders.

- Pre-edit SHA-256: `2d83b9c47d81cc4d059b6428d8fd95465707e06f9911148c1df6d56a6a302cbd`
- Candidate SHA-256: `d15311e38500133d9f80be4fa141824c1111169dd481c7c031f781b64c39ade3`
- Staged GLB SHA-256: `836fabdaccd984fe1bf45fcc7611424f51bbf5b333038c5815de1aad5f5790a5`
