# Palm thickness review

Review pending. `pre-edit.blend` captures the owner's live scene before the palm change. `candidate.blend` and the live `XR_hand.blend` contain the revised candidate. `before.png` and `after.png` show the same side view.

The script restores palm coordinates from the snapshot and applies a 14% local-Y reduction with a 0.035-unit smooth transition from every non-palm vertex. It preserves all non-palm coordinates, groups and weights. `measurements.json` records the checks and thickness. The action hash covers names and frame ranges, not complete animation data; the script does not edit actions. Rig and animation review remain pending.

Independent Astra shape review scored the revised candidate 86/100 after inspecting the side silhouette and the transition into the fingers. The first pass's abrupt boundary was corrected with the wider transition and fixed boundary vertices. Owner shape approval remains pending before reweighting and animation validation.
