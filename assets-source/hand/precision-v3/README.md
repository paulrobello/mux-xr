# Precision hand candidate

This candidate derives from the live authored rig-v2 hand captured in `pre-edit.blend`. The mesh uses normalized deform weights to blend transverse contraction in each bone's rest frame. The wrist region narrows independently. Vertex weights, topology, corrected Edit groups, materials, and the four authored actions are preserved. The index and outer chains were straightened from root to tip after slimming. Their intermediate joints and base segment lengths changed; their fingertip positions remain unchanged. The palm depth is approximately 30 mm. Measured distal cross sections are index 23.7 × 22.7 mm, middle 26.7 × 23.0 mm, outer 23.8 × 23.3 mm, and thumb 24.3 × 24.1 mm. These are sampled extents in each bone frame; see `measurements.json` for sample counts and the other segments.

Every bone carries `restLength` in metres, exported as glTF node extras. Bone-local +Y follows head to tail, so `(0, restLength, 0)` is the tip offset. The glTF contains one skin, one mesh, 13 joints, and Open, Fist, Pointing, and Thumbs Up clips. Blender reimport checks in `reimport-validation.json` cover clip poses and normalized 1–4 influences. The import logs warnings for unrelated Blender UI extras; the skin, clips and geometry reimported successfully.

Open, Fist, Pointing, Thumbs Up, and a diagnostic pinch were inspected in Blender from front and side. The pinch uses different curl angles than rig-v2 because the slimmer tips are farther apart at the original angles. At the diagnostic pose, the tip groups are 1.39 mm apart with zero triangle intersections; this does not prove full-mesh collision freedom. Physical headset interaction remains to be verified.

To regenerate, open `pre-edit.blend` in Blender 5.2.2 and run `slim_hand.py`, then run `fit_bases.py` through Blender MCP. Alternatively, open `pre-straight.blend` and run only `fit_bases.py`. These scripts write a candidate and staged GLB but do not overwrite the live file. Run `validate_export.py` and `inspect_pinch.py` in Blender; restore Open at frame 1 afterward. The owner file was separately saved after validation.

- Preserved source SHA-256: `203f505b1e95afecd24ad79bf38b6c5be137c2d6bca4bda9f2f7072010ec94f9`
- Candidate blend SHA-256: `4faf4cbed8a69f1235ac7e95490f761dba09af4bc695e7bf6cbac9f45357de55`
- Final staged GLB SHA-256: `95714f02a92e58eba41a26ebf1e8197369c336da9844ce36d15bad147af51e0d`

The prior base-fit source SHA-256 is `bd71dcc2df4c6b892b67f639758d30076bcdbf5d996e76df9813299c582b4af6`. The pre-straightening snapshot SHA-256 is `10a1b97efe868de97fed00261595c1e29d0f1156a730c3f75272683535757151`. The outer root is at x=−42 mm, z=127.5 mm and the index root at x=46.55 mm, z=127.5 mm. Both three-bone chains run straight to their unchanged tips. Existing normalized weights were retained after inspecting the resulting poses. `basefit-measurements.json` records the joint positions and geometry preservation digest.

The first slimmed GLB, before base fitting, had historical SHA-256 `a7e011227cea64b9e71607f7a02e43a54f82a155f89a6bf8c10797fb99152926`. It is superseded by the final staged GLB above.

The intermediate fitted GLB had historical SHA-256 `3b545254e53392fa8c20bf96e575524fb0eec7d0dde31e640175742813c9db4d`.
