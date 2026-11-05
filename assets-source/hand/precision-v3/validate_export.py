"""Reimport the staged GLB, check skin and animation semantics, then clean up."""
import bpy
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent
names = ('Open', 'Fist', 'Pointing', 'Thumbs Up')
collections = ('objects','meshes','armatures','materials','actions','images','collections')
original = {name:set(getattr(bpy.data,name)) for name in collections}
scene = bpy.context.scene
previous_frame = scene.frame_current
previous_active = bpy.context.view_layer.objects.active
selected = list(bpy.context.selected_objects)
try:
    bpy.ops.import_scene.gltf(filepath=str(OUT/'hand.staged.glb'))
    imported_objects = [o for o in bpy.data.objects if o not in original['objects']]
    imported_actions = [a for a in bpy.data.actions if a not in original['actions']]
    rigs = [o for o in imported_objects if o.type=='ARMATURE']
    meshes = [o for o in imported_objects if o.type=='MESH' and any(mod.type=='ARMATURE' for mod in o.modifiers)]
    helpers = [o for o in imported_objects if o.type=='MESH' and o not in meshes]
    print('imported', [(o.name,o.type,len(o.data.vertices) if o.type=='MESH' else None, [(m.name,m.type) for m in o.modifiers]) for o in imported_objects])
    assert len(rigs)==len(meshes)==1, [(o.name,o.type,len(o.data.vertices) if o.type=='MESH' else None, [(m.name,m.type) for m in o.modifiers]) for o in imported_objects]
    rig, hand = rigs[0], meshes[0]
    expected = {'wrist'} | {f'{d}_{i:02d}' for d in ('thumb','index','middle','outer') for i in range(1,4)}
    assert {b.name for b in rig.data.bones} == expected
    deform = {g.index for g in hand.vertex_groups if g.name in expected}
    weights = [[g.weight for g in v.groups if g.group in deform and g.weight>0] for v in hand.data.vertices]
    assert all(1<=len(w)<=4 and all(math.isfinite(x) for x in w) and abs(sum(w)-1)<1e-5 for w in weights)
    assert len(imported_actions)==4
    actions = {next(n for n in names if a.name==n or a.name.startswith(n+'.')):a for a in imported_actions}
    assert set(actions)==set(names)
    rig.animation_data_create();rig.data.pose_position='POSE'
    angles = {}
    for name,action in actions.items():
        rig.animation_data.action=action
        scene.frame_set(25)
        bpy.context.view_layer.update()
        angles[name] = {n:rig.pose.bones[n].matrix_basis.to_quaternion().angle for n in expected}
    eps=.03
    assert all(abs(v)<eps for v in angles['Open'].values())
    assert all(angles['Fist'][f'{d}_01']>.7 for d in ('index','middle','outer','thumb'))
    assert angles['Pointing']['index_01']<eps and angles['Pointing']['middle_01']>.7 and angles['Pointing']['outer_01']>.7
    assert angles['Thumbs Up']['wrist']>1.4 and angles['Thumbs Up']['thumb_01']<eps and angles['Thumbs Up']['index_01']>.7
    report={'reimported_skinned_meshes':len(meshes),'import_created_helper_meshes':[(o.name,len(o.data.vertices),o.users) for o in helpers],'bones':sorted(expected),'vertices':len(hand.data.vertices),'triangles':sum(len(p.vertices)-2 for p in hand.data.polygons),'actions':sorted(actions),'weight_influences_min':min(map(len,weights)),'weight_influences_max':max(map(len,weights)),'weight_sum_min':min(map(sum,weights)),'weight_sum_max':max(map(sum,weights)),'frame_25_bone_angles_radians':angles}
    (OUT/'reimport-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
finally:
    # Delete only data created by this import, preserving pre-existing orphans.
    for obj in list(bpy.data.objects):
        if obj not in original['objects']:
            bpy.data.objects.remove(obj,do_unlink=True)
    for name in ('collections','meshes','armatures','materials','actions','images'):
        bucket=getattr(bpy.data,name)
        for item in list(bucket):
            if item not in original[name]:
                bucket.remove(item,do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in selected:
        if obj.name in bpy.context.view_layer.objects: obj.select_set(True)
    if previous_active and previous_active.name in bpy.context.view_layer.objects:
        bpy.context.view_layer.objects.active=previous_active
    scene.frame_set(previous_frame)
