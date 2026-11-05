"""Rebuild the palm adjustment from the preserved pre-edit mesh.

Run inside the live Blender scene with __file__ set to this script's path.
All non-palm coordinates and all group memberships stay fixed.
"""
import bpy
import bmesh
import hashlib
import heapq
import json
import math
from pathlib import Path

out: Path = Path(__file__).resolve().parent
original: str = '/path/to/editable-hand.blend'
obj = bpy.data.objects['AuthoredHandMesh']
mesh = obj.data
assert bpy.data.filepath == original and obj.mode == 'OBJECT' and mesh.shape_keys is None
palm_group: int = obj.vertex_groups['Edit Palm'].index
finger_names: tuple[str, ...] = ('Edit Index', 'Edit Index Tip', 'Edit Middle', 'Edit Middle Tip', 'Edit Outer', 'Edit Outer Tip', 'Edit Thumb', 'Edit Thumb Tip')
finger_groups: set[int] = {obj.vertex_groups[name].index for name in finger_names}
palm: set[int] = {v.index for v in mesh.vertices if any(g.group == palm_group and g.weight > 0 for g in v.groups)}
fingers: set[int] = {v.index for v in mesh.vertices if any(g.group in finger_groups and g.weight > 0 for g in v.groups)}
fixed: set[int] = set(range(len(mesh.vertices))) - palm
assert palm and fingers and fingers <= fixed

# Bring in only the original mesh coordinates. Never open or write the snapshot.
existing_materials: set[str] = {m.name for m in bpy.data.materials}
with bpy.data.libraries.load(str(out / 'pre-edit.blend')) as (source, target):
    assert mesh.name in source.meshes
    target.meshes = [mesh.name]
snapshot = target.meshes[0]
assert len(snapshot.vertices) == len(mesh.vertices)
assert all(tuple(snapshot.vertices[i].co) == tuple(mesh.vertices[i].co) for i in fixed)
assert all((snapshot.vertices[i].co.x, snapshot.vertices[i].co.z) == (mesh.vertices[i].co.x, mesh.vertices[i].co.z) for i in palm)
for i in palm:
    mesh.vertices[i].co.y = snapshot.vertices[i].co.y
bpy.data.meshes.remove(snapshot)
for material in list(bpy.data.materials):
    if material.name not in existing_materials and material.users == 0:
        bpy.data.materials.remove(material)
mesh.update()

def digest(items: object) -> str:
    return hashlib.sha256(repr(items).encode()).hexdigest()

def invariants() -> dict[str, str]:
    return {
        'groups_weights': digest(([(g.index, g.name) for g in obj.vertex_groups], [[(g.group, g.weight) for g in v.groups] for v in mesh.vertices])),
        'topology': digest(([(e.vertices[:]) for e in mesh.edges], [tuple(p.vertices) for p in mesh.polygons])),
        'non_palm_coordinates': digest([(i, tuple(mesh.vertices[i].co)) for i in sorted(fixed)]),
        'finger_coordinates': digest([(i, tuple(mesh.vertices[i].co)) for i in sorted(fingers)]),
        'all_xz': digest([(v.co.x, v.co.z) for v in mesh.vertices]),
        'action_names_and_ranges': digest([(a.name, a.frame_range[:]) for a in bpy.data.actions]),
        'bone_rest_positions': digest([(a.name, [(b.name, tuple(b.head_local), tuple(b.tail_local), b.parent.name if b.parent else None) for b in a.bones]) for a in bpy.data.armatures]),
    }

def thickness() -> float:
    ys: list[float] = [mesh.vertices[i].co.y for i in palm]
    return max(ys) - min(ys)

before: dict[str, str] = invariants()
old_thickness: float = thickness()
adj: list[list[tuple[int, float]]] = [[] for _ in mesh.vertices]
for e in mesh.edges:
    a, b = e.vertices
    length: float = (mesh.vertices[a].co - mesh.vertices[b].co).length
    adj[a].append((b, length))
    adj[b].append((a, length))
distance: list[float] = [math.inf] * len(mesh.vertices)
heap: list[tuple[float, int]] = []
for i in fixed:
    distance[i] = 0.0
    heapq.heappush(heap, (0.0, i))
transition: float = 0.035
while heap:
    d, i = heapq.heappop(heap)
    if d != distance[i] or d > transition:
        continue
    for j, length in adj[i]:
        nd: float = d + length
        if j in palm and nd < distance[j]:
            distance[j] = nd
            heapq.heappush(heap, (nd, j))
for i in palm:
    t: float = min(distance[i] / transition, 1.0)
    blend: float = t * t * (3.0 - 2.0 * t)
    mesh.vertices[i].co.y *= 1.0 - 0.14 * blend
mesh.update()
after: dict[str, str] = invariants()
assert before == after, (before, after)
bm = bmesh.new()
bm.from_mesh(mesh)
invalid: dict[str, int] = {'open_edges': sum(e.is_boundary for e in bm.edges), 'nonmanifold_edges': sum(not e.is_manifold for e in bm.edges), 'zero_area_faces': sum(f.calc_area() < 1e-12 for f in bm.faces)}
bm.free()
assert not any(invalid.values()), invalid
report = {'palm_thickness_before': old_thickness, 'palm_thickness_after': thickness(), 'reduction_percent': 100 * (1 - thickness() / old_thickness), 'palm_vertices': len(palm), 'fixed_non_palm_vertices': len(fixed), 'finger_vertices_unchanged': len(fingers), 'transition_distance': transition, 'invariants_before': before, 'invariants_after': after, 'mesh_validation': invalid}
(out / 'measurements.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'candidate.blend'), copy=True)
bpy.ops.wm.save_as_mainfile(filepath=original)
print(json.dumps(report, indent=2))
