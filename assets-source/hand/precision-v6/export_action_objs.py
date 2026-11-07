"""Write the skinned mesh at each action's hold frame (25) as OBJ for review renders.

Blender -b --factory-startup <candidate.blend> --python export_action_objs.py -- <out_dir>
"""
import bpy
import sys
from pathlib import Path

out = Path(sys.argv[sys.argv.index('--') + 1])
out.mkdir(parents=True, exist_ok=True)
rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
for name in ('Open', 'Fist', 'Pointing', 'Thumbs Up'):
    rig.animation_data.action = bpy.data.actions[name]
    bpy.context.scene.frame_set(25)
    bpy.ops.object.select_all(action='DESELECT')
    hand.select_set(True)
    bpy.context.view_layer.objects.active = hand
    bpy.ops.wm.obj_export(filepath=str(out / f"action-{name.replace(' ', '')}.obj"), export_selected_objects=True,
                          apply_modifiers=True, export_materials=False, export_uv=False, export_normals=False,
                          forward_axis='NEGATIVE_Z', up_axis='Y')
