"""Add the per-side thumb_fold_right / thumb_fold_left corrective shape keys to candidate.blend.

Blender -b --factory-startup candidate.blend --python corrective.py
The JSON holds glTF mesh-space bind positions and deltas (+X thumb, +Y fingers, +Z palm); Blender
mesh space is (x, -z, y). Each JSON vertex must match exactly one Blender vertex within 1e-5 m.
The keys stay at value 0, so actions and the default glTF weights are unchanged; the runtime drives
only the key of the hand's own side.
"""
import json
import os
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

HERE = Path(__file__).resolve().parent
OUT = Path(os.environ.get('CORRECTIVE_OUT', str(HERE / 'candidate.blend')))
NAMES = ('thumb_fold_right', 'thumb_fold_left')

hand = bpy.data.objects['AuthoredHandMesh']
mesh = hand.data
tree = KDTree(len(mesh.vertices))
for vertex in mesh.vertices:
    tree.insert(vertex.co, vertex.index)
tree.balance()


def blender(values):
    x, y, z = values
    return Vector((x, -z, y))


if mesh.shape_keys is None:
    hand.shape_key_add(name='Basis', from_mix=False)
for name in NAMES:
    data = json.loads((HERE / f'{name}.json').read_text())
    assert data['name'] == name, (name, data['name'])
    assert name not in mesh.shape_keys.key_blocks, f'{name} already present'
    key = hand.shape_key_add(name=name, from_mix=False)
    key.value = 0.0
    key.slider_min = 0.0
    key.slider_max = 1.0
    seen = set()
    largest = 0.0
    for k in range(len(data['indices'])):
        position = blender(data['positions'][3 * k:3 * k + 3])
        matches = tree.find_range(position, 1e-5)
        assert len(matches) == 1, (k, position, len(matches))
        index = matches[0][1]
        assert index not in seen, index
        seen.add(index)
        delta = blender(data['deltas'][3 * k:3 * k + 3])
        key.data[index].co = mesh.vertices[index].co + delta
        largest = max(largest, delta.length)
    print(f'CORRECTIVE {name} vertices {len(seen)} largest {largest * 1000:.1f} mm')
for path in OUT.parent.glob('*.blend1'):
    path.unlink()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
for path in OUT.parent.glob('*.blend1'):
    path.unlink()
print(f'CORRECTIVE saved {OUT.name}')
