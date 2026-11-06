"""Report digit centreline offset from the bone chain, digit width, and web crotch heights (mm)."""
import bpy, json, sys
from mathutils import Vector
rig = bpy.data.objects['AuthoredHandRig']; hand = bpy.data.objects['AuthoredHandMesh']
me = hand.data; gi = {g.name: g.index for g in hand.vertex_groups}; B = rig.data.bones
def members(name):
    return [v.co for v in me.vertices if any(g.group == gi[name] and g.weight > 0.5 for g in v.groups)]
res = {}
for d in ('index', 'middle', 'outer'):
    vs = members('Edit ' + d.capitalize())
    h = B[d + '_01'].head_local; t = B[d + '_03'].tail_local
    ax = (t - h).normalized(); L = (t - h).length
    side = Vector((ax.z, 0, -ax.x))  # in-plane perpendicular, +X-ish
    rows = []
    for k in range(-2, 11):
        s = k / 10 * L
        sel = [c for c in vs if abs((c - h).dot(ax) - s) < 2.0e-3]
        if len(sel) < 6: continue
        lat = [(c - h).dot(side) for c in sel]
        rows.append([round(s * 1000, 1), round((max(lat) + min(lat)) / 2 * 1000, 2), round((max(lat) - min(lat)) * 1000, 1)])
    res[d] = rows
def top(x):
    sel = [v.co.z for v in me.vertices if abs(v.co.x - x) < 1.5e-3]
    return max(sel)
prof = [[xi, round(top(xi / 1000) * 1000, 1)] for xi in range(-48, 46, 2)]
res['crotch_middle_outer'] = min((p for p in prof if -46 <= p[0] <= -16), key=lambda p: p[1])
res['crotch_index_middle'] = min((p for p in prof if 16 <= p[0] <= 44), key=lambda p: p[1])
res['profile'] = prof
print('MEASURE ' + json.dumps(res))
