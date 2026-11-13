# Refitted hand rig

The preserved `pre-rig.blend` captures the edited hand immediately before the rig pass. `rig_hand.py` refits the existing 13-bone armature to the revised finger centerlines, assigns the 13 deform groups with a four-influence maximum, creates Open, Fist, Pointing and Thumbs Up actions, and exports `hand.staged.glb`. The wrist origin, mesh coordinates and topology, selection-group names and memberships, scene objects, and materials are preserved. The original pre-refit actions are retained in `pre-rig.blend`.

For regeneration, open the editable hand scene from `handSource` in `.local/host-config.json` in Blender 5.2.2 LTS, select `AuthoredHandRig`, switch to Object mode, and execute through Blender MCP:

```python
import runpy
runpy.run_path('/path/to/mux-xr/assets-source/hand/rig-v2/rig_hand.py', run_name='__main__')
```

This replaces the four existing named actions, updates the existing rig and deform groups, and saves the candidate, staged GLB, measurements, and live scene. It does not resize the mesh or change the edit-selection groups. `validate_export.py` reimports the staged GLB, checks weights, named bones and frame-25 action semantics, then removes its temporary imported objects. `inspect_pinch.py` sets a separate diagnostic pose; it does not create a fifth action. Restore Open afterward.

The editable scene was saved in Pose mode with Open selected, and the Action Editor contains all four fake-user actions. Each action transitions from Open at frame 1 to the named pose at frame 25 and holds to frame 37. The screen captures show the four poses from front and side, plus a near-contact pinch. The wrist rotation in Thumbs Up orients the extended thumb upward. A localized webbing crease is visible in the closed grip.

The reimport has one skinned mesh, 2,850 vertices, 5,696 triangles, 13 named bones, four clips, and 1–4 finite weights per vertex. Weight sums range from 0.999999885 to 1.000000104. Frame-25 bone checks verify the intended open, grip, pointing and thumbs-up joint motions. In the diagnostic pinch, the nearest tested thumb-tip vertex is 0.000256 m from the index-tip surface, with no overlapping triangles between the two tip groups. This check covers those two groups only and does not establish collision-free deformation over all poses. Runtime and physical headset interaction remain separate validation steps.

`rig-metadata.json` uses the runtime glTF axes: +X toward the thumb, +Y toward the fingers, and +Z depth. `measurements.json`, `reimport-validation.json`, and `pinch-validation.json` contain the measured results.

- Pre-rig snapshot SHA-256: `646c229e5e73331199451bc510fbacba072c5e17764856c2524f637353f45e07`
- Staged GLB SHA-256: `ec70d488639657fc3663506d5e97508cd064098d635d0c59e9573e7d26b90fd1`

The exact staged GLB passed the application browser fixtures in VR and passthrough on Apple M4 Max Metal. The AR fixture verified an immersive-ar session request, null environment background, and zero clear alpha. Keyborb sent one character per pinch. The physical Quest test remains with the owner.
