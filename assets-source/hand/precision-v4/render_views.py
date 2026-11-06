"""Render front views (rest and spread) of the hand to PNGs named by the RENDER_TAG env var."""
import bpy, math, os
from mathutils import Euler, Vector, Quaternion
tag = os.environ.get('RENDER_TAG', 'view')
out = os.environ.get('RENDER_DIR', '/tmp')
scene = bpy.context.scene
rig = bpy.data.objects['AuthoredHandRig']; hand = bpy.data.objects['AuthoredHandMesh']
for o in scene.objects:
    o.hide_render = o not in (hand,)
cam_data = bpy.data.cameras.new('ReviewCam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 0.27
cam = bpy.data.objects.new('ReviewCam', cam_data); scene.collection.objects.link(cam)
cam.location = (0.02, -0.6, 0.11); cam.rotation_euler = (math.pi / 2, 0, 0)
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 900; scene.render.resolution_y = 900
scene.render.film_transparent = False
rig.animation_data.action = bpy.data.actions['Open']; scene.frame_set(1)
def shot(name):
    scene.render.filepath = os.path.join(out, f'{tag}-{name}.png'); bpy.ops.render.render(write_still=True)
shot('front')
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = Quaternion()
spread = {'index_01': -0.22, 'outer_01': 0.22}
for n, a in spread.items():
    rig.pose.bones[n].rotation_quaternion = Quaternion((0, 0, 1), a)
bpy.context.view_layer.update()
shot('spread')
cam.location = (0.02, 0.6, 0.11); cam.rotation_euler = (math.pi / 2, 0, math.pi)
shot('spread-back')
