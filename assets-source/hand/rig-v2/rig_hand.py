"""Fit the hand rig and rebuild previews against the preserved revised mesh.

Run in the live source scene through Blender MCP. The source mesh stays in place;
only the named deform groups, the existing rig bones, and four actions are changed.
"""
import bpy
import bmesh
import hashlib
import json
import math
import struct
from pathlib import Path
from mathutils import Quaternion, Vector

OUT = Path(__file__).resolve().parent
LIVE = '/path/to/editable-hand.blend'
rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
mesh = hand.data
scene = bpy.context.scene
assert bpy.data.filepath == LIVE and hand.mode == 'OBJECT' and mesh.shape_keys is None
assert hand.parent == rig and len(mesh.vertices) == 2850
DIGITS = ('thumb', 'index', 'middle', 'outer')
DEFORM = ('wrist',) + tuple(f'{d}_{i:02d}' for d in DIGITS for i in range(1,4))
NAMES = ('Open', 'Fist', 'Pointing', 'Thumbs Up')

def digest(value: object) -> str:
    return hashlib.sha256(repr(value).encode()).hexdigest()

def mesh_invariants() -> dict[str, str]:
    edit = {g.index:g.name for g in hand.vertex_groups if g.name.startswith('Edit ')}
    return {
        'coordinates': digest([tuple(v.co) for v in mesh.vertices]),
        'topology': digest(([tuple(e.vertices) for e in mesh.edges], [tuple(p.vertices) for p in mesh.polygons])),
        'edit_groups': digest((list(edit.values()), [sorted((edit[g.group], g.weight) for g in v.groups if g.group in edit) for v in mesh.vertices])),
        'objects': digest([(o.name, o.type, tuple(o.location)) for o in scene.objects]),
        'materials': digest([(m.name, m.users) for m in bpy.data.materials]),
    }

before = mesh_invariants()
assert set(DEFORM) == {b.name for b in rig.data.bones}
# Centerlines sampled from the edited finger cross sections, in Blender local
# X across hand, Y depth, Z finger direction. The wrist remains unchanged.
chains = {
    'thumb': [( .07067,0,.08640),(.090,.0015,.0873),(.110,.0019,.0893),(.130,.0019,.0900)],
    'index': [( .049,0,.1275),(.055,0,.1530),(.0585,0,.1760),(.060,0,.1960)],
    'middle':[(-.0016,0,.1355),(-.0011,0,.1590),(-.0007,0,.1830),(-.00065,0,.2078)],
    'outer': [(-.053,0,.1275),(-.059,0,.1530),(-.0635,0,.1760),(-.063,0,.1960)],
}
chains = {d:[Vector(p) for p in points] for d, points in chains.items()}
rig.data.pose_position = 'REST'
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for digit in DIGITS:
    for i in range(3):
        b = rig.data.edit_bones[f'{digit}_{i+1:02d}']
        b.head = chains[digit][i]
        b.tail = chains[digit][i+1]
        b.use_connect = i > 0
bpy.ops.object.mode_set(mode='OBJECT')
for name in DEFORM:
    group = hand.vertex_groups.get(name)
    if group is not None:
        hand.vertex_groups.remove(group)
for name in DEFORM:
    hand.vertex_groups.new(name=name)

def smooth(a: float, b: float, x: float) -> float:
    t = max(0.0, min(1.0, (x-a)/(b-a)))
    return t*t*(3-2*t)

# Refit the original distance-based four-influence blend to the new centerlines.
for vertex in mesh.vertices:
    point = vertex.co
    samples = []
    for digit in DIGITS:
        start, j1, j2, end = chains[digit]
        axis = (end-start).normalized()
        length = (end-start).dot(axis)
        along = (point-start).dot(axis)
        closest = start + axis * max(0.0, min(length, along))
        distance = (point-closest).length
        activation = smooth(-.014, .012, along)
        affinity = 1.0 / (distance*distance + .000025)**2
        samples.append((digit, along, (j1-start).dot(axis), (j2-start).dot(axis), activation, affinity))
    total_affinity = sum(v[5] for v in samples)
    weights = {'wrist':0.0}
    for digit, along, j1, j2, activation, affinity in samples:
        portion = affinity/total_affinity
        weights['wrist'] += portion*(1-activation)
        t1 = smooth(j1-.009, j1+.009, along)
        t2 = smooth(j2-.007, j2+.007, along)
        weights[f'{digit}_01'] = portion*activation*(1-t1)
        weights[f'{digit}_02'] = portion*activation*t1*(1-t2)
        weights[f'{digit}_03'] = portion*activation*t1*t2
    strongest = [(name,w) for name,w in sorted(weights.items(),key=lambda it:it[1],reverse=True)[:4] if w>1e-5]
    total = sum(w for _,w in strongest)
    assert total > 0
    for name,weight in strongest:
        hand.vertex_groups[name].add([vertex.index], weight/total, 'REPLACE')

# Local curl axes are derived from the same +depth convention as the runtime.
# A rest direction crossed with Blender -Y points toward glTF +Z depth.
rig.data.pose_position = 'POSE'
rig.animation_data_create()
rig.animation_data.action = None
assert {a.name for a in bpy.data.actions} == set(NAMES)
for name in NAMES:
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
axes = {}
for digit in DIGITS:
    for i in range(1,4):
        name = f'{digit}_{i:02d}'
        b = rig.data.bones[name]
        direction = (b.tail_local-b.head_local).normalized()
        global_axis = direction.cross(Vector((0,-1,0))).normalized()
        axes[name] = b.matrix_local.to_quaternion().inverted() @ global_axis
wrist_axis = rig.data.bones['wrist'].matrix_local.to_quaternion().inverted() @ Vector((0,-1,0))
poses = {
    'Open': {},
    'Fist': {**{f'{d}_{i:02d}': a for d in ('index','middle','outer') for i,a in enumerate((1.0,.95,.70),1)}, **{f'thumb_{i:02d}':a for i,a in enumerate((.85,.75,.5),1)}},
    'Pointing': {**{f'{d}_{i:02d}': a for d in ('middle','outer') for i,a in enumerate((1.0,.95,.70),1)}, **{f'thumb_{i:02d}':a for i,a in enumerate((.85,.75,.5),1)}},
    'Thumbs Up': {f'{d}_{i:02d}': a for d in ('index','middle','outer') for i,a in enumerate((1.0,.95,.70),1)},
}
for name, angles in poses.items():
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    for frame in (1,25,37):
        scene.frame_set(frame)
        for bone in rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            q = Quaternion()
            if frame != 1:
                if bone.name in angles:
                    q = Quaternion(axes[bone.name], angles[bone.name])
                elif bone.name == 'wrist' and name == 'Thumbs Up':
                    q = Quaternion(wrist_axis, math.pi/2)
            bone.rotation_quaternion = q
            bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
rig.animation_data.action = bpy.data.actions['Open']
scene.frame_start = 1
scene.frame_end = 37
scene.frame_set(1)
rig.hide_set(False)
# The source has no deformation at Open and remains the exact edited shape.
assert before == mesh_invariants(), (before, mesh_invariants())
weights_data = []
deform_ids = {hand.vertex_groups[n].index for n in DEFORM}
for v in mesh.vertices:
    values = [g.weight for g in v.groups if g.group in deform_ids and g.weight>0]
    assert 1 <= len(values) <= 4 and abs(sum(values)-1) < 1e-5
    weights_data.append((len(values),sum(values)))
bm = bmesh.new(); bm.from_mesh(mesh)
validation = {'open_edges':sum(e.is_boundary for e in bm.edges), 'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges), 'zero_area_faces':sum(f.calc_area()<1e-12 for f in bm.faces)}
bm.free()
assert not any(validation.values())
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True);hand.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'hand.staged.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_slide_to_zero=True)
with (OUT/'hand.staged.glb').open('rb') as stream:
    magic, version, length = struct.unpack('<4sII', stream.read(12))
    n, kind = struct.unpack('<I4s', stream.read(8))
    gltf = json.loads(stream.read(n))
assert magic == b'glTF' and version == 2 and kind == b'JSON'
assert {a['name'] for a in gltf['animations']} == set(NAMES) and len(gltf['animations']) == 4
assert len(gltf['meshes']) == 1 and len(gltf['skins']) == 1 and len(gltf['skins'][0]['joints']) == 13
metadata = {'axes':'+X thumb, +Y fingers, +Z depth in glTF', 'units':'metres', 'vertices':len(mesh.vertices), 'triangles':sum(len(p.vertices)-2 for p in mesh.polygons), 'bones':{b.name:{'head_blender':list(b.head_local),'tail_blender':list(b.tail_local),'parent':b.parent.name if b.parent else None} for b in rig.data.bones}, 'actions':list(NAMES), 'weight_influences_min':min(n for n,_ in weights_data), 'weight_influences_max':max(n for n,_ in weights_data), 'weight_sum_min':min(s for _,s in weights_data), 'weight_sum_max':max(s for _,s in weights_data), 'invariants_before':before, 'invariants_after':mesh_invariants(), 'mesh_validation':validation}
(OUT/'measurements.json').write_text(json.dumps(metadata,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'candidate.blend'),copy=True)
bpy.ops.wm.save_as_mainfile(filepath=LIVE)
print(json.dumps(metadata,indent=2))
