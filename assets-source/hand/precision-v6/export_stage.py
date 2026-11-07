"""Export candidate.blend to hand.staged.glb (Open at frame 1) and verify the glTF contract."""
import bpy, hashlib, json, math, struct
from pathlib import Path
OUT = Path(__file__).resolve().parent
import os
GLB = Path(os.environ.get('EXPORT_GLB', str(OUT / 'hand.staged.glb')))
names = ('Open', 'Fist', 'Pointing', 'Thumbs Up')
rig = bpy.data.objects['AuthoredHandRig']; hand = bpy.data.objects['AuthoredHandMesh']; scene = bpy.context.scene
if bpy.context.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
rig.animation_data.action = bpy.data.actions['Open']; scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); hand.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, use_active_scene=True, export_animations=True, export_animation_mode='ACTIONS', export_anim_slide_to_zero=True, export_extras=True)
with (GLB).open('rb') as f:
    magic, version, _ = struct.unpack('<4sII', f.read(12)); size, kind = struct.unpack('<I4s', f.read(8)); gltf = json.loads(f.read(size))
assert magic == b'glTF' and version == 2 and kind == b'JSON'
assert len(gltf['meshes']) == 1 and len(gltf['skins']) == 1 and len(gltf['skins'][0]['joints']) == len(rig.data.bones)
assert {a['name'] for a in gltf['animations']} == set(names)
for b in rig.data.bones:
    node = next(n for n in gltf['nodes'] if n.get('name') == b.name)
    assert math.isclose(node['extras']['restLength'], b.length, rel_tol=1e-6), b.name
meta = {'axes': '+X thumb, +Y fingers, +Z depth in glTF', 'units': 'metres', 'wrist_origin': [0.0, 0.0, 0.0],
        'bones': {b.name: {'head': [round(b.head_local.x, 8), round(b.head_local.z, 8), round(-b.head_local.y, 8)], 'tail': [round(b.tail_local.x, 8), round(b.tail_local.z, 8), round(-b.tail_local.y, 8)]} for b in rig.data.bones},
        'vertices': len(hand.data.vertices), 'triangles': sum(len(p.vertices) - 2 for p in hand.data.polygons), 'source': 'precision-v6/candidate.blend'}
(GLB.parent/'rig-metadata.json').write_text(json.dumps(meta, indent=2) + '\n')
print('EXPORT ' + hashlib.sha256((GLB).read_bytes()).hexdigest())
