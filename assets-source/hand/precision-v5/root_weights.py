"""Widen two short skin blends: wrist-to-outer_01 at the outer digit root, thumb_02-to-thumb_03 at the thumb's last joint.

Run headless on narrowed.blend: Blender -b narrowed.blend --python root_weights.py
A short blend bunches the skin into a bump when the outer digit splays and creases the
bent thumb. Only each pair's split changes; their sum, every other group, the vertex
positions and the topology are kept. Writes candidate.blend.
"""
import bpy
import hashlib
import json
import os
from pathlib import Path

OUT = Path(__file__).resolve().parent
RADIUS = float(os.environ.get('ROOT_RADIUS', '0.026'))   # region around the outer_01 head (m)
ITERATIONS = int(os.environ.get('ROOT_ITERATIONS', '30'))
THUMB_RADIUS = float(os.environ.get('THUMB_RADIUS', '0.014'))   # around the thumb_03 head (m)
THUMB_ITERATIONS = int(os.environ.get('THUMB_ITERATIONS', '20'))

rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
me = hand.data
if bpy.context.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')


def faces_digest() -> str:
    return hashlib.sha256(repr([p.vertices[:] for p in me.polygons] + [v.co[:] for v in me.vertices]).encode()).hexdigest()


neighbours: dict[int, list[int]] = {v.index: [] for v in me.vertices}
for e in me.edges:
    x, y = e.vertices
    neighbours[x].append(y)
    neighbours[y].append(x)


def smooth_split(first: str, second: str, inside, iterations: int) -> dict:
    """Diffuse the first/second share over the vertices `inside` accepts, keeping each vertex's sum."""
    a_index, b_index = hand.vertex_groups[first].index, hand.vertex_groups[second].index

    def pair(v) -> tuple[float, float]:
        w = {g.group: g.weight for g in v.groups}
        return w.get(a_index, 0.0), w.get(b_index, 0.0)

    region = {v.index for v in me.vertices if sum(pair(v)) > 0.9 and inside(v)}
    shares = {v.index: pair(v)[1] / sum(pair(v)) for v in me.vertices if sum(pair(v)) > 0}
    original = {i: shares[i] for i in region}
    for _ in range(iterations):
        nxt = dict(shares)
        for i in region:
            ns = [shares.get(j, 0.0) for j in neighbours[i]]
            nxt[i] = 0.5 * shares[i] + 0.5 * sum(ns) / len(ns)
        shares = nxt
    for i in region:
        total = sum(pair(me.vertices[i]))
        for name, value in ((first, total * (1 - shares[i])), (second, total * shares[i])):
            if value < 1e-4:
                hand.vertex_groups[name].remove([i])
            else:
                hand.vertex_groups[name].add([i], value, 'REPLACE')
    changes = [abs(shares[i] - original[i]) for i in region]
    return {'vertices': len(region), 'max_share_change': round(max(changes), 3), 'mean_share_change': round(sum(changes) / len(changes), 3)}


before = faces_digest()
outer_head = rig.data.bones['outer_01'].head_local
outer = smooth_split('wrist', 'outer_01', lambda v: (v.co - outer_head).length < RADIUS and v.co.x < outer_head.x + 0.002, ITERATIONS)
# The thumb's last joint now bends about 45 degrees on a fist; a wider blend keeps it from creasing.
thumb_head = rig.data.bones['thumb_03'].head_local
thumb = smooth_split('thumb_02', 'thumb_03', lambda v: (v.co - thumb_head).length < THUMB_RADIUS, THUMB_ITERATIONS)
me.update()
assert faces_digest() == before
report = {'outer_root': {'radius_m': RADIUS, 'iterations': ITERATIONS, **outer},
          'thumb_joint': {'radius_m': THUMB_RADIUS, 'iterations': THUMB_ITERATIONS, **thumb}}
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / os.environ.get('ROOT_OUT', 'candidate.blend')), copy=True)
print('ROOTW ' + json.dumps(report))
