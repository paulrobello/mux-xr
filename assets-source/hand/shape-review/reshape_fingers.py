"""Run once against the corrected-groups pre-shape snapshot in Blender.

Groups are read as authored, never written. Boundary vertices remain fixed;
all displacement and taper blend smoothly from the farthest boundary coordinate.
"""
import bpy
import bmesh
import hashlib
import json
import math
import os
import struct

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(ROOT, 'longer-slimmer-review.blend')
REPORT = os.path.join(ROOT, 'measurements.json')
ob = bpy.data.objects['AuthoredHandMesh']
assert len(ob.data.vertices) == 2850
if ob.mode == 'EDIT':
    ob.update_from_editmode()
    bpy.ops.object.mode_set(mode='OBJECT')
mesh = ob.data

def group_ids(name: str) -> set[int]:
    index = ob.vertex_groups[name].index
    return {v.index for v in mesh.vertices if any(g.group == index for g in v.groups)}

def hashes() -> tuple[str, str]:
    topology = hashlib.sha256()
    groups = hashlib.sha256()
    for e in mesh.edges:
        topology.update(struct.pack('<II', *e.vertices))
    for face in mesh.polygons:
        topology.update(struct.pack('<I', len(face.vertices)))
        for i in face.vertices:
            topology.update(struct.pack('<I', i))
    for group in ob.vertex_groups:
        groups.update(group.name.encode('utf8') + b'\0')
    for v in mesh.vertices:
        for g in sorted(v.groups, key=lambda g: g.group):
            groups.update(struct.pack('<IIf', v.index, g.group, g.weight))
    return topology.hexdigest(), groups.hexdigest()

def smooth(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x*x*(3-2*x)

def geometry_check() -> dict[str, int]:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    result = {
        'boundary_edges': sum(e.is_boundary for e in bm.edges),
        'nonmanifold_edges': sum(not e.is_manifold for e in bm.edges),
        'zero_area_faces': sum(f.calc_area() <= 1e-12 for f in bm.faces),
    }
    bm.free()
    return result

before_geometry = geometry_check()
before_hash = hashes()
original = [v.co.copy() for v in mesh.vertices]
results = {}
for name, axis, extension, taper in [
    ('Index', 2, 0.15, 0.16), ('Middle', 2, 0.15, 0.16),
    ('Outer', 2, 0.15, 0.16), ('Thumb', 0, 0.07, 0.14),
]:
    ids = group_ids('Edit ' + name)
    tip = group_ids('Edit ' + name + ' Tip')
    assert tip <= ids
    boundary = {a for edge in mesh.edges for a, b in (edge.vertices, tuple(reversed(edge.vertices))) if a in ids and b not in ids}
    base = max(original[i][axis] for i in boundary)
    end = max(original[i][axis] for i in ids)
    length = end - base
    assert length > 0 and boundary
    transverse = (0, 1) if axis == 2 else (1, 2)
    # Center derived from the shaft, before the rounded tip narrows.
    shaft = [i for i in ids if 0.45 <= (original[i][axis]-base)/length <= 0.75]
    center = {j: (min(original[i][j] for i in shaft)+max(original[i][j] for i in shaft))/2 for j in transverse}
    widths_before = [max(original[i][j] for i in tip)-min(original[i][j] for i in tip) for j in transverse]
    for i in ids:
        p = original[i]
        t = (p[axis]-base)/length
        blend = smooth(t)
        slim = smooth(t/0.8)
        v = mesh.vertices[i]
        v.co[axis] = p[axis] + extension*length*blend
        for j in transverse:
            v.co[j] = center[j] + (p[j]-center[j])*(1-taper*slim)
    assert all((mesh.vertices[i].co-original[i]).length < 1e-9 for i in boundary)
    widths_after = [max(mesh.vertices[i].co[j] for i in tip)-min(mesh.vertices[i].co[j] for i in tip) for j in transverse]
    new_end = max(mesh.vertices[i].co[axis] for i in ids)
    results[name] = {'base': base, 'length_before': length, 'length_after': new_end-base,
                     'extension_percent': 100*((new_end-base)/length-1),
                     'transverse_axes': list(transverse), 'tip_width_before': widths_before,
                     'tip_width_after': widths_after, 'tip_width_change_percent': [100*(a/b-1) for a,b in zip(widths_after,widths_before)],
                     'boundary_vertices_fixed': len(boundary), 'vertices': len(ids)}
mesh.update()
after_geometry = geometry_check()
assert after_geometry == before_geometry
assert hashes() == before_hash
assert all(math.isfinite(c) for v in mesh.vertices for c in v.co)
assert sorted(a.name for a in bpy.data.actions) == ['Fist', 'Open', 'Pointing', 'Thumbs Up']
rig = bpy.data.objects['AuthoredHandRig']
rig.data.pose_position = 'REST'
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True)
bpy.context.view_layer.objects.active = ob
report = {'mesh':ob.name, 'vertices':len(mesh.vertices), 'edges':len(mesh.edges), 'faces':len(mesh.polygons),
          'topology_sha256':before_hash[0], 'groups_sha256':before_hash[1],
          'topology_and_groups_unchanged':hashes()==before_hash, 'finite_coordinates':True,
          'geometry_before':before_geometry, 'geometry_after':after_geometry,
          'actions':sorted(a.name for a in bpy.data.actions), 'fingers':results}
with open(REPORT,'w',encoding='utf8') as f:
    json.dump(report,f,indent=2)
assert not os.path.exists(OUTPUT)
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
print(json.dumps(report, indent=2))
