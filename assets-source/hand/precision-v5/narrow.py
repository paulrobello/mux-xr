"""Move the index and outer digits toward the middle finger and taper the palm top to match.

Run headless on pre-edit.blend: Blender -b pre-edit.blend --python narrow.py (then root_weights.py)
NARROW_INDEX / NARROW_OUTER (m) set each digit's inward move; NARROW_OUT names the saved .blend.
Moves vertices and the index/outer bone chains only (pure translation, so action
keys and restLength are unchanged); topology, weights and groups are kept.
"""
import bpy
import hashlib
import json
import os
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
SHIFTS = {1.0: float(os.environ.get('NARROW_INDEX', '0.017')), -1.0: float(os.environ.get('NARROW_OUTER', '0.014'))}
DIGIT_LOCK = float(os.environ.get('NARROW_LOCK', '0.9'))   # digit weight that moves rigidly
TAPER_LOW = float(os.environ.get('NARROW_LOW', '0.08'))   # palm below this height stays put
SOLVE_ITERATIONS = 3000
SOLVER = os.environ.get('NARROW_SOLVER', 'biharmonic')
RELAX_STEPS = int(os.environ.get('NARROW_RELAX', '4'))
WEB_ROUND = int(os.environ.get('NARROW_WEB_ROUND', '60'))   # smoothing passes around each web floor
WEB_RADIUS = float(os.environ.get('NARROW_WEB_RADIUS', '0.018'))
WEB_FLOOR_Z = float(os.environ.get('NARROW_WEB_Z', '0.126'))
EDGE_OFFSET = float(os.environ.get('NARROW_EDGE_OFFSET', '0.013'))   # outer palm edge spot, from the outer root
EDGE_Z = float(os.environ.get('NARROW_EDGE_Z', '0.112'))
EDGE_RADIUS = float(os.environ.get('NARROW_EDGE_RADIUS', '0.026'))

rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
me = hand.data
assert len(me.vertices) == 2850
if bpy.context.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
gi = {g.name: g.index for g in hand.vertex_groups}


def smooth(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def weight(v, prefix: str) -> float:
    ids = {gi[f'{prefix}_0{i}'] for i in (1, 2, 3)}
    return sum(g.weight for g in v.groups if g.group in ids)


def topology_digest() -> str:
    return hashlib.sha256(repr([(p.vertices[:]) for p in me.polygons] + [sorted((g.group, round(g.weight, 6)) for g in v.groups) for v in me.vertices]).encode()).hexdigest()


before = topology_digest()


def bone_x(prefix: str) -> float:
    side = {'index': 1.0, 'outer': -1.0}.get(prefix)
    return rig.data.bones[f'{prefix}_01'].head_local.x - (side * SHIFTS[side] if side else 0.0)

# Digits fixed at their shift, middle/thumb/lower palm fixed at zero, the rest interpolated so
# the palm and webs taper without creases.
import numpy as np
n = len(me.vertices)
co = np.array([v.co[:] for v in me.vertices])
fixed = np.zeros(n, dtype=bool)
dx = np.zeros(n)
for v in me.vertices:
    i = v.index
    if weight(v, 'index') > DIGIT_LOCK:
        fixed[i], dx[i] = True, -SHIFTS[1.0]
    elif weight(v, 'outer') > DIGIT_LOCK:
        fixed[i], dx[i] = True, SHIFTS[-1.0]
    elif weight(v, 'middle') > DIGIT_LOCK or weight(v, 'thumb') > 0.3 or v.co.z < TAPER_LOW:
        fixed[i] = True
rows, cols = [], []
for e in me.edges:
    a, b = e.vertices
    rows += [a, b]; cols += [b, a]
rows, cols = np.array(rows), np.array(cols)
degree = np.bincount(rows, minlength=n)
if SOLVER == 'harmonic':
    for _ in range(SOLVE_ITERATIONS):
        mean = np.bincount(rows, weights=dx[cols], minlength=n) / degree
        dx = np.where(fixed, dx, mean)
else:
    # Biharmonic: the displacement leaves each fixed region with zero slope, so no crease
    # forms along the lock and palm boundaries.
    lap = -np.eye(n)
    lap[rows, cols] = 1.0 / degree[rows]
    bi = lap.T @ lap
    free = ~fixed
    dx[free] = np.linalg.solve(bi[np.ix_(free, free)], -bi[np.ix_(free, fixed)] @ dx[fixed])
for v in me.vertices:
    v.co.x += dx[v.index]
moved = {i: 1.0 for i in range(n) if not fixed[i] and abs(dx[i]) > 1e-5}

# Relax the free band so the remaining gradient leaves no crease.
neighbours = {v.index: [] for v in me.vertices}
for e in me.edges:
    a, b = e.vertices
    neighbours[a].append(b)
    neighbours[b].append(a)
for _ in range(RELAX_STEPS):
    for factor in (0.5, -0.53):
        snapshot = [v.co.copy() for v in me.vertices]
        for i in moved:
            mean = sum((snapshot[j] for j in neighbours[i]), Vector()) / len(neighbours[i])
            me.vertices[i].co = snapshot[i].lerp(mean, factor)
# The narrowed webs end in a pinched V; smoothing around each web floor with a radial falloff
# rounds it back into a U and fades the crease below it.
# The outer palm edge also dips then flares below the outer root, so it gets the same treatment.
spots = [(Vector(((bone_x('index') + bone_x('middle')) / 2, 0.0, WEB_FLOOR_Z)), WEB_RADIUS),
         (Vector(((bone_x('middle') + bone_x('outer')) / 2, 0.0, WEB_FLOOR_Z)), WEB_RADIUS),
         (Vector((bone_x('outer') - EDGE_OFFSET, 0.0, EDGE_Z)), EDGE_RADIUS)]
falloff = {}
for v in me.vertices:
    for f, radius in spots:
        d = ((v.co.x - f.x) ** 2 + (v.co.z - f.z) ** 2) ** 0.5
        if d < radius:
            falloff[v.index] = max(falloff.get(v.index, 0.0), (1 - d / radius) ** 2)
for _ in range(WEB_ROUND):
    snapshot = [v.co.copy() for v in me.vertices]
    for i, k in falloff.items():
        mean = sum((snapshot[j] for j in neighbours[i]), Vector()) / len(neighbours[i])
        me.vertices[i].co = snapshot[i].lerp(mean, 0.5 * k)
me.update()
assert topology_digest() == before

bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
# Connected bones share head/tail, so capture every target before assigning any.
targets = {}
for prefix, side in (('index', 1.0), ('outer', -1.0)):
    for i in (1, 2, 3):
        b = rig.data.edit_bones[f'{prefix}_0{i}']
        offset = Vector((-side * SHIFTS[side], 0.0, 0.0))
        targets[b.name] = (b.head + offset, b.tail + offset)
for name, (head, tail) in targets.items():
    rig.data.edit_bones[name].head = head
    rig.data.edit_bones[name].tail = tail
bpy.ops.object.mode_set(mode='OBJECT')
B = rig.data.bones
for n in ('index_01', 'index_02', 'index_03', 'outer_01', 'outer_02', 'outer_03'):
    assert abs(B[n]['restLength'] - B[n].length) < 1e-6, n
report = {
    'shift_m': {'index': SHIFTS[1.0], 'outer': SHIFTS[-1.0]},
    'params': {'solver': SOLVER, 'digit_lock': DIGIT_LOCK, 'taper_low': TAPER_LOW, 'solve_iterations': SOLVE_ITERATIONS, 'relax_steps': RELAX_STEPS, 'web_round': WEB_ROUND, 'web_radius': WEB_RADIUS, 'web_floor_z': WEB_FLOOR_Z, 'edge': [EDGE_OFFSET, EDGE_Z, EDGE_RADIUS]},
    'bones_mm': {n: [[round(x * 1000, 2) for x in B[n].head_local], [round(x * 1000, 2) for x in B[n].tail_local]] for n in ('index_01', 'middle_01', 'outer_01')},
    'topology_and_weights_sha256': before,
}
target = OUT / os.environ.get('NARROW_OUT', 'narrowed.blend')
(target.with_suffix('.json')).write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(target), copy=True)
print('NARROW ' + json.dumps(report))
