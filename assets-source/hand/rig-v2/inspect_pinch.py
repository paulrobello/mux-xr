"""Set a near-contact thumb/index test pose and measure tip-surface clearance.

This is a manual diagnostic pose, not one of the four exported actions.
Restore the Open action after capturing its front and side viewport screenshots.
"""
import bpy
import json
from pathlib import Path
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

OUT = Path(__file__).resolve().parent
rig = bpy.data.objects['AuthoredHandRig']
obj = bpy.data.objects['AuthoredHandMesh']
rig.animation_data.action = None
for bone in rig.pose.bones:
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = Quaternion()

def curl_axis(name: str) -> Vector:
    bone = rig.data.bones[name]
    direction = (bone.tail_local-bone.head_local).normalized()
    return bone.matrix_local.to_quaternion().inverted() @ direction.cross(Vector((0,-1,0))).normalized()

for i in range(1,4):
    name = f'thumb_{i:02d}'
    rig.pose.bones[name].rotation_quaternion = Quaternion(curl_axis(name), .98*[1,.8,.6][i-1])
    name = f'index_{i:02d}'
    rig.pose.bones[name].rotation_quaternion = Quaternion(curl_axis(name), 1.24*[1,.85,.6][i-1])
bpy.context.view_layer.update()
ids = {name:{v.index for v in obj.data.vertices if any(g.group == obj.vertex_groups[name].index for g in v.groups)} for name in ('Edit Thumb Tip','Edit Index Tip')}
obj.data.calc_loop_triangles()
triangles = {name:[tuple(t.vertices) for t in obj.data.loop_triangles if set(t.vertices)<=ids[name]] for name in ids}
ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
mesh = ev.to_mesh()
points = [v.co.copy() for v in mesh.vertices]
thumb = BVHTree.FromPolygons(points, triangles['Edit Thumb Tip'], all_triangles=True)
index = BVHTree.FromPolygons(points, triangles['Edit Index Tip'], all_triangles=True)
overlaps = len(thumb.overlap(index))
clearance = min(index.find_nearest(points[v])[3] for v in ids['Edit Thumb Tip'])
assert overlaps == 0 and clearance < .001, (overlaps,clearance)
report = {'thumb_curl_factor':.98,'index_curl_factor':1.24,'tip_triangle_intersections':overlaps,'minimum_thumb_vertex_to_index_surface_m':clearance,'scope':'Only triangles wholly inside the Edit Thumb Tip and Edit Index Tip groups were tested.'}
ev.to_mesh_clear()
(OUT/'pinch-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
