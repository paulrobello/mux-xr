"""Smooth the depth profile at the palm/finger join, preserving X/Z and rig data.

Run in the original rest-pose scene via Blender MCP. The immutable pre-edit blend
supplies coordinates on every run, so rerunning does not compound the change.
"""
import bpy
import bmesh
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
host_config = Path(__file__).resolve().parents[3] / '.local' / 'host-config.json'
LIVE = str(Path(json.loads(host_config.read_text())['handSource']).expanduser().resolve())
obj = bpy.data.objects['AuthoredHandMesh']
mesh = obj.data
assert bpy.data.filepath == LIVE and obj.mode == 'OBJECT' and mesh.shape_keys is None
assert bpy.data.objects['AuthoredHandRig'].data.pose_position == 'REST'
old_materials = set(bpy.data.materials)
with bpy.data.libraries.load(str(OUT / 'pre-edit.blend')) as (source, target):
    assert mesh.name in source.meshes
    target.meshes = [mesh.name]
snapshot = target.meshes[0]
assert len(snapshot.vertices) == len(mesh.vertices)
assert [(tuple(e.vertices)) for e in snapshot.edges] == [(tuple(e.vertices)) for e in mesh.edges]
assert [(tuple(p.vertices)) for p in snapshot.polygons] == [(tuple(p.vertices)) for p in mesh.polygons]
assert all((a.co.x, a.co.z) == (b.co.x, b.co.z) for a, b in zip(snapshot.vertices, mesh.vertices))
for v, original in zip(mesh.vertices, snapshot.vertices):
    v.co.y = original.co.y
bpy.data.meshes.remove(snapshot)
for material in list(bpy.data.materials):
    if material not in old_materials and material.users == 0:
        bpy.data.materials.remove(material)
mesh.update()

def digest(value: object) -> str:
    return hashlib.sha256(repr(value).encode()).hexdigest()

def invariants() -> dict[str, str]:
    return {
        'xz': digest([(v.co.x, v.co.z) for v in mesh.vertices]),
        'groups_weights': digest(([(g.index, g.name) for g in obj.vertex_groups], [[(g.group, g.weight) for g in v.groups] for v in mesh.vertices])),
        'topology': digest(([tuple(e.vertices) for e in mesh.edges], [tuple(p.vertices) for p in mesh.polygons])),
        'outside_transition': digest([(v.index, tuple(v.co)) for v in mesh.vertices if v.co.z <= .09 or v.co.z >= .16 or v.co.x >= .095]),
        'actions': digest([(a.name, a.frame_range[:]) for a in bpy.data.actions]),
        'rest_bones': digest([(a.name, [(b.name, tuple(b.head_local), tuple(b.tail_local), b.parent.name if b.parent else None) for b in a.bones]) for a in bpy.data.armatures]),
        'scene_objects': digest([(o.name, o.type, tuple(o.location)) for o in bpy.context.scene.objects]),
        'materials': digest([(m.name, m.users) for m in bpy.data.materials]),
    }

def envelope(z: float) -> tuple[float, float]:
    ys = []
    for e in mesh.edges:
        a, b = (mesh.vertices[i].co for i in e.vertices)
        if (a.z-z)*(b.z-z) <= 0 and a.z != b.z:
            t = (z-a.z)/(b.z-a.z)
            x = a.x + t*(b.x-a.x)
            if abs(x) < .06:
                ys.append(a.y + t*(b.y-a.y))
    return (min(ys), max(ys))

before = invariants()
side_before = {f'{z/1000:.3f}': envelope(z/1000) for z in range(90,161,2)}
z0, z1 = .09, .16
# End slopes match the measured local envelope. Hermite interpolation removes
# the shoulder while keeping both ends tangent to their existing profiles.
e0, e1 = envelope(z0)[1], envelope(z1)[1]
m0, m1 = -.101, -.115
original = [(v.co.x, v.co.y, v.co.z) for v in mesh.vertices]
cache = {}
for x, y, z in original:
    if not z0 < z < z1 or x >= .095:
        continue
    if z not in cache:
        env = envelope(z)[1]
        t = (z-z0)/(z1-z0)
        h00, h10 = 2*t**3-3*t**2+1, t**3-2*t**2+t
        h01, h11 = -2*t**3+3*t**2, t**3-t**2
        target_y = h00*e0 + h10*(z1-z0)*m0 + h01*e1 + h11*(z1-z0)*m1
        cache[z] = min(1.0, target_y/env)
for v in mesh.vertices:
    x, y, z = original[v.index]
    if not z0 < z < z1 or x >= .095:
        continue
    # Fade over the thumb root, leaving its distal form untouched.
    u = max(0.0, min(1.0, (x-.065)/.03))
    fade = 1.0-u*u*(3.0-2.0*u)
    v.co.y = y*(1.0 + fade*(cache[z]-1.0))
mesh.update()
after = invariants()
assert before == after, (before, after)
bm = bmesh.new(); bm.from_mesh(mesh)
validation = {'open_edges': sum(e.is_boundary for e in bm.edges), 'nonmanifold_edges': sum(not e.is_manifold for e in bm.edges), 'zero_area_faces': sum(f.calc_area()<1e-12 for f in bm.faces)}
bm.free()
assert not any(validation.values()), validation
changed = [(v.index, original[v.index][1], v.co.y) for v in mesh.vertices if v.co.y != original[v.index][1]]
report = {'transition_z': [z0,z1], 'endpoint_depths': [e0,e1], 'endpoint_slopes': [m0,m1], 'changed_vertices': len(changed), 'max_depth_displacement': max(abs(c-a) for _,a,c in changed), 'invariants_before': before, 'invariants_after': after, 'mesh_validation': validation, 'side_envelope_before': side_before, 'side_envelope_after': {f'{z/1000:.3f}': envelope(z/1000) for z in range(90,161,2)}}
(OUT/'measurements.json').write_text(json.dumps(report,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'candidate.blend'), copy=True)
bpy.ops.wm.save_as_mainfile(filepath=LIVE)
print(json.dumps(report,indent=2))
