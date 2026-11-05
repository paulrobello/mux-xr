"""Derive the typing hand from the captured rig-v2 scene in Blender 5.2."""
import bpy
import bmesh
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
bones = ('wrist',) + tuple(f'{d}_{i:02d}' for d in ('thumb','index','middle','outer') for i in range(1,4))
assert len(hand.data.vertices) == 2850 and {b.name for b in rig.data.bones} == set(bones)
assert {a.name for a in bpy.data.actions} == set(names)
assert hand.data.shape_keys is None and hand.parent == rig
if bpy.context.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
rig.animation_data.action = bpy.data.actions['Open']
scene.frame_set(1)
rig.data.pose_position = 'REST'
edit_groups = {g.index:g.name for g in hand.vertex_groups if g.name.startswith('Edit ')}
def edit_digest():
    value = [(v.index, sorted((edit_groups[g.group],g.weight) for g in v.groups if g.group in edit_groups)) for v in hand.data.vertices]
    return hashlib.sha256(repr(value).encode()).hexdigest()
def topology_digest():
    return hashlib.sha256(repr(([tuple(e.vertices) for e in hand.data.edges],[tuple(p.vertices) for p in hand.data.polygons])).encode()).hexdigest()
before_edit, before_topology = edit_digest(), topology_digest()
indices = {hand.vertex_groups[n].index:n for n in bones}
transforms = {n:(rig.data.bones[n].matrix_local.copy(), rig.data.bones[n].matrix_local.inverted()) for n in bones if n != 'wrist'}
original = [v.co.copy() for v in hand.data.vertices]
for v in hand.data.vertices:
    p = v.co.copy()
    result = p * 0
    total = 0.0
    for g in v.groups:
        if g.group not in indices or g.weight <= 0: continue
        name = indices[g.group]
        if name == 'wrist':
            q = p.copy(); q.x *= .75; q.y *= .64
        else:
            m, inv = transforms[name]
            q = inv @ p
            q.x *= .56; q.z *= .56
            q = m @ q
        result += q * g.weight
        total += g.weight
    assert abs(total-1) < 1e-5
    v.co = result / total
hand.data.update()
for b in rig.data.bones:
    b['restLength'] = float(b.length)
assert edit_digest() == before_edit and topology_digest() == before_topology
bm = bmesh.new(); bm.from_mesh(hand.data)
mesh_checks = {'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),'zero_area_faces':sum(f.calc_area()<1e-12 for f in bm.faces)}
bm.free()
assert not any(mesh_checks.values()), mesh_checks
rig.data.pose_position = 'POSE'
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True); hand.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'hand.staged.glb'), export_format='GLB', use_selection=True, use_active_scene=True, export_animations=True, export_animation_mode='ACTIONS', export_anim_slide_to_zero=True, export_extras=True)
with (OUT/'hand.staged.glb').open('rb') as f:
    magic,version,_=struct.unpack('<4sII',f.read(12)); size,kind=struct.unpack('<I4s',f.read(8)); gltf=json.loads(f.read(size))
assert magic==b'glTF' and version==2 and kind==b'JSON'
assert len(gltf['meshes'])==1 and len(gltf['skins'])==1 and len(gltf['skins'][0]['joints'])==13
assert {a['name'] for a in gltf['animations']}==set(names)
for b in rig.data.bones:
    node=next(n for n in gltf['nodes'] if n.get('name')==b.name)
    assert math.isclose(node['extras']['restLength'],b.length,rel_tol=1e-6)
# Report cross-sections of vertices strongly associated with a segment, in its bind frame.
sections={}
for name in bones[1:]:
    m,inv=transforms[name]; length=rig.data.bones[name].length
    ids=[v.index for v in hand.data.vertices if any(indices.get(g.group)==name and g.weight>.65 for g in v.groups)]
    def extents(points):
        selected=[inv @ points[i] for i in ids]
        selected=[p for p in selected if .2*length <= p.y <= .8*length]
        return {'samples':len(selected),'x_m':max((p.x for p in selected),default=0)-min((p.x for p in selected),default=0),'z_m':max((p.z for p in selected),default=0)-min((p.z for p in selected),default=0)}
    sections[name]={'before':extents(original),'after':extents([v.co for v in hand.data.vertices])}
report={'source_sha256':hashlib.sha256((OUT/'pre-edit.blend').read_bytes()).hexdigest(),'glb_sha256':hashlib.sha256((OUT/'hand.staged.glb').read_bytes()).hexdigest(),'edit_groups_sha256':before_edit,'topology_sha256':before_topology,'mesh_checks':mesh_checks,'rest_lengths_m':{b.name:b.length for b in rig.data.bones},'sections':sections,'bounds_m':[float(x) for x in hand.dimensions]}
(OUT/'measurements.json').write_text(json.dumps(report,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'candidate.blend'),copy=True)
print(json.dumps(report,indent=2))
