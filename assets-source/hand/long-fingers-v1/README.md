# long-fingers-v1

The active runtime hand. It is the first authored hand's pipeline (`rig_hand.py` and `animate_hand.py`, first shipped at commit d4ebf2f) run on the owner's edited source, which has longer fingers and thumb and narrower tips. See the long-fingers-v1 section of `../PROVENANCE.md` for the reason, hashes and measurements.

| File | Role |
| --- | --- |
| `source.blend` | Unmodified copy of the owner's approved `vr-cartoon-hand2-long-fingers.blend`. `Hand.001` is the 14-vertex skin/subsurf source. `Hand.001_original` is not used. |
| `rig_hand.py` | Bakes the evaluated surface, builds the 13-bone rig and weights, writes `restLength` on every bone and `rig-metadata.json`. |
| `animate_hand.py` | Adds the Open, Fist, Pointing and Thumbs Up actions, exports `authored-hand.staged.glb`, asserts the export contract and writes `rigged-hand.blend`. |
| `authored-hand.staged.glb` | Runtime asset, copied to `../authored-hand.staged.glb` and `public/assets/hand.glb`. |
| `rig-metadata.json` | Bone heads and tails in glTF space, copied to `../rig-metadata.json`. |
| `rigged-hand.blend` | Editable rigged result. |

Regenerate from this folder with Blender 5.2 (headless, `source.blend` is never saved):

```bash
blender source.blend --background --python-exit-code 1 --python rig_hand.py --python animate_hand.py
```

The scripts write beside themselves and print `EXPORT <sha256>`. Promote by copying the GLB and metadata as above, then set `RIGGED_HAND_ASSET_URL` in `src/xr/rigged-hand.ts` to `?v=` plus the first 12 hex digits of that hash.
