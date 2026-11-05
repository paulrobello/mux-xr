"""Add named preview actions to the authored hand rig and export glTF clips.

Run after rig_hand.py on its generated rig. Each action transitions from open at
frame 1 to its pose at frame 25, then holds through frame 37 at 24 fps.
"""
import bpy
import os

HERE = os.path.dirname(os.path.abspath(__file__))
rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
scene = bpy.context.scene
rig.animation_data_create()

fist_digits = {f'{digit}_{i:02d}': (angle, 0, 0)
               for digit in ('index', 'middle', 'outer')
               for i, angle in enumerate((1.0, 0.9, 0.65), 1)}
thumb_fold = {'thumb_01': (0.9, 0, -0.45), 'thumb_02': (0.35, 0, -0.15), 'thumb_03': (0.2, 0, 0)}
poses = {
    'Open': {},
    'Fist': {**fist_digits, **thumb_fold},
    'Pointing': {**{k: v for k, v in fist_digits.items() if not k.startswith('index_')}, **thumb_fold},
    'Thumbs Up': {**fist_digits, 'wrist': (0, 0, 1.5707963267948966)},
}
for name, rotations in poses.items():
    if bpy.data.actions.get(name):
        raise RuntimeError(f'Action {name!r} already exists; preserve it before regenerating')
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    for frame in (1, 25, 37):
        scene.frame_set(frame)
        for bone in rig.pose.bones:
            bone.rotation_mode = 'XYZ'
            bone.rotation_euler = rotations.get(bone.name, (0, 0, 0)) if frame != 1 else (0, 0, 0)
            bone.keyframe_insert(data_path='rotation_euler', frame=frame, group=bone.name)

rig.animation_data.action = bpy.data.actions['Open']
scene.frame_start = 1
scene.frame_end = 37
scene.frame_set(1)
rig.hide_set(False)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
hand.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, 'authored-hand.staged.glb'),
                          export_format='GLB', use_selection=True, use_active_scene=True,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_anim_slide_to_zero=True)
print('Actions created:', ', '.join(poses))
