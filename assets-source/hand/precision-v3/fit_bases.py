"""Fit index and outer roots to measured precision-hand base cross sections."""
import bpy
import hashlib
import json
import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent
rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
scene = bpy.context.scene
names = ('Open', 'Fist', 'Pointing', 'Thumbs Up')
targets = tuple(f'{d}_{i:02d}' for d in ('index','outer') for i in range(1,4))
root_x = {'index': .046553785, 'outer': -.042}
assert len(hand.data.vertices) == 2850 and set(a.name for a in bpy.data.actions) == set(names)
if bpy.context.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
def mesh_digest():
    return hashlib.sha256(repr([(tuple(v.co),sorted((g.group,g.weight) for g in v.groups)) for v in hand.data.vertices]).encode()).hexdigest()
before=mesh_digest()
old={n:rig.data.bones[n].matrix_local.to_quaternion() for n in targets}
old_heads={n:list(rig.data.bones[n].head_local) for n in targets}
tails={n:list(rig.data.bones[n].tail_local) for n in targets}
keys={}
for action in names:
    rig.animation_data.action=bpy.data.actions[action]
    for frame in (1,25,37):
        scene.frame_set(frame)
        keys[action,frame]={n:rig.pose.bones[n].rotation_quaternion.copy() for n in targets}
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for d in ('index','outer'):
    chain = [rig.data.edit_bones[f'{d}_{i:02d}'] for i in range(1,4)]
    z0, z3 = chain[0].head.z, chain[-1].tail.z
    tip_x = chain[-1].tail.x
    levels = [chain[0].head.z] + [b.tail.z for b in chain]
    points = [(root_x[d]+(tip_x-root_x[d])*(z-z0)/(z3-z0), 0.0, z) for z in levels]
    for i,b in enumerate(chain):
        b.head = points[i]; b.tail = points[i+1]
bpy.ops.object.mode_set(mode='OBJECT')
for n in targets:
    rig.data.bones[n]['restLength']=float(rig.data.bones[n].length)
for action in names:
    rig.animation_data.action=bpy.data.actions[action]
    for frame in (1,25,37):
        scene.frame_set(frame)
        for n in targets:
            conversion=rig.data.bones[n].matrix_local.to_quaternion().inverted() @ old[n]
            pb=rig.pose.bones[n]; pb.rotation_mode='QUATERNION'
            pb.rotation_quaternion=conversion @ keys[action,frame][n] @ conversion.inverted()
            pb.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=n)
assert mesh_digest()==before
rig.animation_data.action=bpy.data.actions['Open']; scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); hand.select_set(True); bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'hand.staged.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_slide_to_zero=True,export_extras=True)
with (OUT/'hand.staged.glb').open('rb') as f:
    magic,version,_=struct.unpack('<4sII',f.read(12)); size,kind=struct.unpack('<I4s',f.read(8)); gltf=json.loads(f.read(size))
assert magic==b'glTF' and version==2 and kind==b'JSON'
assert len(gltf['meshes'])==1 and len(gltf['skins'])==1 and len(gltf['skins'][0]['joints'])==13
assert {a['name'] for a in gltf['animations']}==set(names)
for b in rig.data.bones:
    node=next(n for n in gltf['nodes'] if n.get('name')==b.name)
    assert math.isclose(node['extras']['restLength'],b.length,rel_tol=1e-6)
report={'old_heads_m':old_heads,'new_heads_m':{n:list(rig.data.bones[n].head_local) for n in targets},'old_tails_m':tails,'new_tails_m':{n:list(rig.data.bones[n].tail_local) for n in targets},'mesh_and_groups_sha256':before,'glb_sha256':hashlib.sha256((OUT/'hand.staged.glb').read_bytes()).hexdigest(),'source_sha256':hashlib.sha256((OUT/'pre-straight.blend').read_bytes()).hexdigest()}
(OUT/'basefit-measurements.json').write_text(json.dumps(report,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'candidate.blend'),copy=True)
print(json.dumps(report,indent=2))
