"""Build a rigged hand from source.blend (long-fingers-v1) in Blender 5.2.

Run in Blender: blender source.blend --background --python rig_hand.py --python animate_hand.py
The original mesh is left in the scene, hidden; exports are written beside this script.
"""
import bpy
import json
import os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
source = bpy.data.objects['Hand.001']
# Source lies in YZ. Blender Z is finger direction; glTF's exporter maps Z to +Y.
scale = 0.6
origin = source.data.vertices[0].co.copy()
def convert(v: Vector) -> Vector:
    p = v - origin
    return Vector((p.z, p.x, -p.y)) * scale
points = [convert(v.co) for v in source.data.vertices]
chains = {'thumb': (3, 10, 9), 'index': (4, 11, 8), 'middle': (5, 12, 1), 'outer': (6, 13, 2)}
# Use the evaluated Skin/Subdivision surface while preserving the editable source.
depsgraph = bpy.context.evaluated_depsgraph_get()
evaluated = source.evaluated_get(depsgraph)
mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
hand = bpy.data.objects.new('AuthoredHandMesh', mesh)
# Keep the orange every served hand has used (d4ebf2f through precision-v6); the owner's source file shades it blue.
HAND_ORANGE = (0.7988739013671875, 0.14490041136741638, 0.00849889125674963, 1.0)
for material in mesh.materials:
    material.diffuse_color = HAND_ORANGE
    if material.use_nodes:
        for node in material.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Base Color'].default_value = HAND_ORANGE
bpy.context.scene.collection.objects.link(hand)
for v in mesh.vertices:
    v.co = convert(v.co)
for poly in mesh.polygons:
    poly.use_smooth = True
armature = bpy.data.armatures.new('AuthoredHandSkeleton')
rig = bpy.data.objects.new('AuthoredHandRig', armature)
bpy.context.scene.collection.objects.link(rig)
rig.show_in_front = True
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
root = armature.edit_bones.new('wrist')
root.head, root.tail = points[0], points[7]
segments = [('wrist', points[0], points[7], None, None)]
for digit, indices in chains.items():
    p0, p1, p3 = [points[i] for i in indices]
    p2 = p1.lerp(p3, 0.5)
    coords = [p0, p1, p2, p3]
    parent = root
    for i in range(3):
        name = f'{digit}_{i+1:02d}'
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = coords[i], coords[i+1]
        bone.parent = parent
        bone.use_connect = i > 0
        previous = 'wrist' if i == 0 else f'{digit}_{i:02d}'
        following = f'{digit}_{i+2:02d}' if i < 2 else None
        segments.append((name, coords[i], coords[i+1], previous, following))
        parent = bone
bpy.ops.object.mode_set(mode='OBJECT')
# The runtime rejects a bone without a positive restLength glTF extra (metres).
for bone in armature.bones:
    bone['restLength'] = float(bone.length)
for name, *_ in segments:
    hand.vertex_groups.new(name=name)
# Assign smooth anatomical weights along each digit's axis, blending into the palm.
def smooth(edge0: float, edge1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x-edge0)/(edge1-edge0)))
    return t*t*(3.0-2.0*t)

for vertex in mesh.vertices:
    point = vertex.co
    contributions = []
    for digit, indices in chains.items():
        start, joint, end = [points[i] for i in indices]
        axis = (end-start).normalized()
        length = (end-start).dot(axis)
        along = (point-start).dot(axis)
        closest = start + axis * max(0.0, min(length, along))
        distance = (point-closest).length
        activation = smooth(-0.014, 0.012, along)
        affinity = 1.0 / (distance*distance + 0.000025)**2
        contributions.append((digit, along, (joint-start).dot(axis), length, activation, affinity))
    total_affinity = sum(c[5] for c in contributions)
    weights = {'wrist': 0.0}
    for digit, along, joint, length, activation, affinity in contributions:
        portion = affinity / total_affinity
        weights['wrist'] += portion * (1.0-activation)
        first_transition = smooth(joint-0.010, joint+0.010, along)
        second_joint = (joint+length)*0.5
        second_transition = smooth(second_joint-0.008, second_joint+0.008, along)
        weights[f'{digit}_01'] = portion*activation*(1.0-first_transition)
        weights[f'{digit}_02'] = portion*activation*first_transition*(1.0-second_transition)
        weights[f'{digit}_03'] = portion*activation*first_transition*second_transition
    strongest = sorted(weights.items(), key=lambda item: item[1], reverse=True)[:4]
    total = sum(weight for _, weight in strongest)
    for group, weight in strongest:
        if weight > 0.00001:
            hand.vertex_groups[group].add([vertex.index], weight/total, 'REPLACE')
hand.parent = rig
mod = hand.modifiers.new('Hand armature', 'ARMATURE')
mod.object = rig
source.hide_set(True)
source.hide_render = True
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
hand.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, 'authored-hand.staged.glb'), export_format='GLB', use_selection=True, use_active_scene=True, export_animations=False, export_extras=True)
# glTF uses x, z, -y from Blender space.
def gltf(v: Vector) -> list[float]:
    return [round(v.x, 8), round(v.z, 8), round(-v.y, 8)]
metadata = {'axes': '+X thumb, +Y wrist to fingers, +Z thickness', 'units': 'metres', 'wrist_origin': gltf(points[0]), 'bones': {name: {'head': gltf(a), 'tail': gltf(b)} for name,a,b,_,_ in segments}, 'vertices': len(mesh.vertices), 'triangles': sum(len(p.vertices)-2 for p in mesh.polygons), 'source': 'long-fingers-v1/source.blend'}
with open(os.path.join(HERE, 'rig-metadata.json'), 'w') as stream:
    json.dump(metadata, stream, indent=2)
print(json.dumps(metadata))
