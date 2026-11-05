# Palm base depth

`pre-edit.blend` captures the live scene after the join refinement and before this adjustment. `slim_base.py` restores that snapshot's mesh coordinates on each run, reduces the palm's local Y depth, and blends the reduction into the finger bases. X and Z coordinates, selection groups, weights, topology and distal tips remain unchanged.

Open `/path/to/editable-hand.blend` in Blender 5.2.2 LTS, set `AuthoredHandRig` to REST and `AuthoredHandMesh` to Object mode, then execute with Blender MCP:

```python
import runpy
runpy.run_path('/path/to/mux-xr/assets-source/hand/base-review/slim_base.py', run_name='__main__')
```

The script writes `candidate.blend`, `measurements.json`, and the live file. It validates mesh and invariant checks before saving. A second run reproduced the same vertex-coordinate SHA-256 `83e2b9d456431a060983a25d039e8484a809b6323c831e630f09f92d1c8e3380`.

The Edit Palm group depth decreased from 0.062016 to 0.046822 scene units. The unchanged Edit Thumb Tip group spans 0.043415, so the palm is 1.0785 times that diameter. The full thumb group, including its blended root, spans 0.044954 after the edit. The positive and negative side envelopes monotonically taper across Z 0.074–0.170 at sampled 0.002 intervals. There are no boundary or non-manifold edges, and no zero-area faces. The scene retains five objects and seven materials, including four unused materials present before this edit.

`before-close.png` and `after-close.png` show the side profile at identical scale; full side views and `after-front.png` are also included. The action invariant checks names and ranges only, not keyframe contents or deformation quality. No rigging or animation changes were made in this shape pass. Snapshot SHA-256: `346b53b6568bd675493a4ba6f508d16741cb003f3a3a0fea368efa7d8d1858eb`.
