# Authored hand source and rig

The active runtime hand is the precision-v3 candidate, with approximately 23–27 mm digit cross sections and a 30 mm source palm depth. Index and outer chains are straight, with the outer root moved inward to x=-42 mm. The active staged GLB, public hand.glb, and rig metadata are copies of precision-v3. GLB SHA-256 is `95714f02a92e58eba41a26ebf1e8197369c336da9844ce36d15bad147af51e0d`.

Every bone exports restLength in metres. Controller motion retains the authored dimensions. Tracked input uses one uniform size for the palm and digit thickness, preserving the authored proportions. Finger segments fit the measured joints using independent world-space bone transforms to prevent inherited stretch. The source mesh and corrected Edit selections remain editable in the saved owner file. Independent Astra review scored the source and runtime result 87/100 after inspecting the straight chains, slim silhouette and tracked pinch. Exact tracked endpoint correspondence and controller restoration passed both-handed unit tests.

The VR, passthrough and Keyborb browser checks passed on Apple M4 Max Metal, including local 12-hour watch time and one character per pinch. Evidence is retained in `.local/evidence/precision-watch-1105` in the primary checkout. Physical Quest typing comfort remains owner acceptance.

## Refitted rig history

The previous runtime hand was the refitted version in `rig-v2`. It includes the longer, slimmer fingers and a palm side depth of 0.046822 m, about 1.0785 times the thumb-tip depth. The shoulder correction and base shaping are preserved in `join-review` and `base-review`. `rig-v2/pre-rig.blend` retains the corrected editing groups and final shape before reweighting.

The rig-v2 outputs were promoted at commit c9acafb. GLB SHA-256 is `ec70d488639657fc3663506d5e97508cd064098d635d0c59e9573e7d26b90fd1`. The runtime requests a content-versioned URL to avoid stale mesh caching. Regeneration and pose checks are documented in `rig-v2/README.md`. Independent Astra review scored the refined shape and rig 87/100 after inspecting front/side poses, pinch, and application captures. A localized webbing crease remains visible in the fully closed grip.

Both native Metal browser fixtures passed with the new rig, including VR, transparent passthrough, controller finger isolation, watch reload, and Keyborb pinch deduplication. Physical Quest comfort remains owner testing. Evidence is retained in `.local/evidence/hand-v2-1105` in the primary checkout.

## Initial rig history

The hand was modeled by Paul Robello and supplied in the open Blender scene. The snapshot `original-hand.blend` was saved from that live scene before rigging. It preserves the user's editable edge mesh, Skin and Subdivision modifiers, material, and scene data. SHA-256: `e9ab1bd430680efac0269d759a541b93d5966043834e4caf4f2a7f6964d387fe`.

`rig_hand.py` derives the orange skinned mesh and armature from that snapshot using Blender 5.2.2. For regeneration, run `blender original-hand.blend --background --python-exit-code 1 --python rig_hand.py --python animate_hand.py` from this directory. The script retains the original object hidden, bakes its evaluated surface, constructs the skeleton and weights, and exports `authored-hand.staged.glb` and `rig-metadata.json`. The editable result is in `rigged-hand.blend`. The user's open source file was also saved with the rig, with the original object retained and hidden.

Initial GLB SHA-256 (archived at commit d4ebf2f): `04490708c39e3de48b9e59ef57dffc411e8b01f889630288fa8f04981e06ba49`. Rigged copy SHA-256: `df9d9c28b51c098ed7b258295772fa0fb20ef9780596e3a469a8a28e024f2e99`.

The initial export has one skinned mesh, 2,850 vertices, 5,696 triangles, 13 bones, and four animation clips. Blender reimport confirmed 1–4 influences per vertex, finite normals and weights, and weight sums between 0.999999862 and 1.000000115. The surface reaches 0.20384 m from wrist origin along the finger axis. Neutral, index bend, and grip were inspected in the Blender viewport. Independent Astra review inspected Open, Fist, Pointing and Thumbs Up through MCP and the exact exported skin in the application. The visual/correctness assessment is 86/100, covering the preserved silhouette, separated digits, continuous skin, recognizable poses, and deformation. Physical Quest tracking and pinch comfort remain owner acceptance checks.

`animate_hand.py` adds four reusable actions: Open, Fist, Pointing, and Thumbs Up. At 24 frames per second, frames 1–25 transition from the open pose and frames 25–37 hold. Each action is retained with a fake user. The thumbs-up action rotates the wrist to orient the extended thumb upward. The four exported clips run from 0 to 1.5 seconds and were reimported successfully. Blender viewport inspection covered each pose from front and side. To preview an action, select `AuthoredHandRig`, select the action in the Dope Sheet Action Editor, and play frames 1–37.

Initial runtime validation used the exported GLB through Three.js on Apple M4 Max Metal. Both hands loaded independent 13-bone skeletons, controller trigger bent only its index, tracking loss hid the affected hand, watch ray activation worked, and Keyborb still sent one key per pinch with color feedback. The runtime adds orange emission for the scene lighting and aligns the base of the skin to the elastic arm. Browser evidence is retained in `.local/evidence/authored-hand-1105` in the primary checkout.
