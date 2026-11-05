# Hand shape review

`pre-shape-corrected-groups.blend` is the live hand saved after the owner corrected all Edit vertex groups and before reshaping. `longer-slimmer-review.blend` is the editable candidate, open in Blender in the neutral rest pose. `before.png` and `after.png` show the same front view; `after-side.png` shows the side.

The three fingers extend 15% from their fixed palm boundary to their original tip. Their tip-group bounding widths decrease 14.6–15.7% across the two transverse axes. The thumb extends 7%, with tip-group widths reduced 12.7–12.9%. Dimensions and checks are in `measurements.json`. The original vertex-group names, memberships and weights, topology, four actions and boundary vertices are preserved. The mesh has zero boundary edges, nonmanifold edges and zero-area faces before and after.

`reshape_fingers.py` reproduces the candidate from the pre-shape snapshot. Open that snapshot in Blender and run the script from this folder with Blender's Python console. It refuses to overwrite the candidate; use an empty copy of this folder for a repeat. It reads the owner's Edit groups without modifying them.

This is a shape review. Existing weights and animations have not been revised for the changed shape and are not validated for it. Reweighting, rerigging, animation validation and runtime export remain pending the owner's shape approval.

The revised shape is also saved in the owner's `XR_hand.blend`, with the armature displayed in its rest position for inspection. Independent Astra review scored this shape pass 88/100 after comparing the fixed front views and inspecting the side profile. The longer shafts, tapered tips, rounded caps and smooth palm transitions meet the requested modest proportion change. Owner shape approval remains pending.
