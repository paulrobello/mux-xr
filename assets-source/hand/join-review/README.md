# Palm-to-finger side profile

This rest-pose refinement addresses the secondary shoulder in the previous palm adjustment. The preserved `pre-edit.blend` is the live file immediately before this change. `smooth_join.py` restores the snapshot's coordinates on every run, then reshapes depth from Z 0.090 to 0.160 with a tangent-matched taper. It blends the adjustment into the thumb root. The X and Z coordinates, distal fingers, palm core, topology, edit groups, and weights remain unchanged.

To rebuild, open the editable hand scene from `handSource` in `.local/host-config.json` in Blender 5.2.2 LTS, put `AuthoredHandRig` in REST pose and `AuthoredHandMesh` in Object mode, then execute through Blender MCP:

```python
import runpy
runpy.run_path('/path/to/mux-xr/assets-source/hand/join-review/smooth_join.py', run_name='__main__')
```

The script writes `candidate.blend`, `measurements.json`, and the live file. It validates topology and the documented invariants before saving. Running it twice produced identical vertex-coordinate SHA-256 hashes (`c475440af816968af823f7b9eb29158a08aff98d6a6b8fbd1473f70790388e49`). The mesh has no boundary or non-manifold edges and no zero-area faces. The measured depth envelope, sliced at 0.002 Z intervals from 0.090 to 0.160, decreases continuously after the change. Before it rose between 0.110 and 0.118. Maximum absolute Y displacement is 0.002272 scene units across 1,041 vertices.

The equal action invariant checks action names and ranges only, not keyframes or deformation quality. Existing rig weights and animations are retained, and reweighting and animation review await the separate rigging decision. The scene retains five objects and seven materials, including four unused materials already present before the edit.

Compare `before-join-close.png` with `after-join-close.png` for the enlarged side profile. The full side views and `after-front.png` are also included. `pre-edit.blend` SHA-256: `f3d4ac1993f33d4c9f386e0a17de7f7c9e2f8c4fdbe366703d51236c39c80bf0`.
