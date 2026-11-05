"""Set up geometric editing selections on this XR hand in Blender.

This is specific to the current hand's local coordinates and topology. Back up
and inspect the mesh before running it. The script does not save the file.
"""
import bpy
import bmesh

mesh = bpy.data.objects['AuthoredHandMesh']
rig = bpy.data.objects['AuthoredHandRig']
assert bpy.context.object == mesh and mesh.type == 'MESH' and mesh.mode == 'EDIT'
mesh.update_from_editmode()
regions = {name: set() for name in ('Palm', 'Thumb', 'Index', 'Middle', 'Outer')}
tips = {name: set() for name in ('Thumb', 'Index', 'Middle', 'Outer')}
for vertex in mesh.data.vertices:
    x, _, z = vertex.co
    if x > 0.086:
        name = 'Thumb'
    elif z <= 0.135:
        name = 'Palm'
    elif x < -0.027:
        name = 'Outer'
    elif x > 0.026:
        name = 'Index'
    else:
        name = 'Middle'
    regions[name].add(vertex.index)
    if name != 'Palm':
        bone = rig.data.bones[f'{name.lower()}_03']
        point = rig.matrix_world.inverted() @ mesh.matrix_world @ vertex.co
        if (point - bone.head_local).dot(bone.tail_local - bone.head_local) >= 0:
            tips[name].add(vertex.index)

adjacent = [[] for _ in mesh.data.vertices]
for edge in mesh.data.edges:
    a, b = edge.vertices
    adjacent[a].append(b)
    adjacent[b].append(a)

def is_connected(indices: set[int]) -> bool:
    if not indices:
        return False
    pending = {next(iter(indices))}
    visited = set()
    while pending:
        index = pending.pop()
        if index not in visited:
            visited.add(index)
            pending.update(i for i in adjacent[index] if i in indices and i not in visited)
    return visited == indices

assert sum(map(len, regions.values())) == len(mesh.data.vertices)
assert all(is_connected(indices) for indices in regions.values())
assert all(indices < regions[name] and is_connected(indices) for name, indices in tips.items())

bpy.ops.object.mode_set(mode='OBJECT')
for name, indices in regions.items():
    group = mesh.vertex_groups.get(f'Edit {name}') or mesh.vertex_groups.new(name=f'Edit {name}')
    group.remove(range(len(mesh.data.vertices)))
    group.add(sorted(indices), 1.0, 'REPLACE')
    if name != 'Palm':
        tip = mesh.vertex_groups.get(f'Edit {name} Tip') or mesh.vertex_groups.new(name=f'Edit {name} Tip')
        tip.remove(range(len(mesh.data.vertices)))
        tip.add(sorted(tips[name]), 1.0, 'REPLACE')
mesh.vertex_groups.active_index = mesh.vertex_groups['Edit Palm'].index
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(mesh.data)
bm.verts.ensure_lookup_table()
for vertex in bm.verts:
    vertex.select_set(vertex.index in regions['Palm'])
bmesh.update_edit_mesh(mesh.data)
print('Edit groups:', {name: len(indices) for name, indices in regions.items()}, 'tips:', {name: len(indices) for name, indices in tips.items()})
