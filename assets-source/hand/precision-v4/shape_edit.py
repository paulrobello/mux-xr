"""Straighten the outer digit onto one axis and deepen the finger webs.

Run headless on pre-edit.blend: Blender -b pre-edit.blend --python shape_edit.py
Moves vertices and the outer bone chain only; topology, weights, groups and
actions are kept. Writes candidate.blend beside this script (never the owner file).
"""
import bpy
import hashlib
import json
import math
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
OUTER_BASE_INWARD = 0.0     # move the outer base centre this far toward the middle finger (m)
WEB_DEPTH = 0.010           # lower each web crotch by this much (m)
WEB_FLAT = 0.011            # half-width that drops rigidly, covering the whole crotch U (m)
WEB_HALF_WIDTH = 0.027      # lateral reach where the drop has faded out (m)
WEB_RELAX_STEPS = 10        # Taubin smoothing passes over the edited web and outer-base vertices
WEB_RAMP = 0.050            # vertical ramp below the crotch over which the edit fades in (m)

rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
scene = bpy.context.scene
me = hand.data
names = ('Open', 'Fist', 'Pointing', 'Thumbs Up')
assert len(me.vertices) == 2850 and set(a.name for a in bpy.data.actions) >= set(names)
if bpy.context.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
gi = {g.name: g.index for g in hand.vertex_groups}
B = rig.data.bones


def smooth(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def weight(v, names_: tuple[str, ...]) -> float:
    ids = {gi[n] for n in names_}
    return sum(g.weight for g in v.groups if g.group in ids)


def topology_digest() -> str:
    return hashlib.sha256(repr([(p.vertices[:]) for p in me.polygons] + [sorted((g.group, round(g.weight, 6)) for g in v.groups) for v in me.vertices]).encode()).hexdigest()


before_topology = topology_digest()

# 1. Outer digit: smooth centreline relative to its bone line, then a straight target line.
outer = ('outer_01', 'outer_02', 'outer_03')
h = B['outer_01'].head_local.copy()
t = B['outer_03'].tail_local.copy()
ax = (t - h).normalized()
L = (t - h).length
side = Vector((ax.z, 0.0, -ax.x))  # in the palm plane, perpendicular to the digit
members = [v.co.copy() for v in me.vertices if any(g.group == gi['Edit Outer'] and g.weight > 0.5 for g in v.groups)]


def centre(s: float) -> float:
    rows = [c for c in members if abs((c - h).dot(ax) - s) < 0.004]
    lat = [(c - h).dot(side) for c in rows]
    return (max(lat) + min(lat)) / 2


samples = [(i / 20 * L, centre(i / 20 * L)) for i in range(0, 21)]
# Kernel-smooth the noisy slice midpoints.
smoothed = []
for s, _ in samples:
    ws = [(math.exp(-((s - s2) / 0.006) ** 2), c) for s2, c in samples]
    smoothed.append((s, sum(w * c for w, c in ws) / sum(w for w, _ in ws)))
base_offset = smoothed[0][1] + OUTER_BASE_INWARD
tip_offset = smoothed[-1][1]


def target(s: float) -> float:
    u = max(0.0, min(1.0, s / L))
    return base_offset + (tip_offset - base_offset) * u


def current(s: float) -> float:
    s = max(0.0, min(L, s))
    i = min(len(smoothed) - 2, int(s / L * 20))
    (s0, c0), (s1, c1) = smoothed[i], smoothed[i + 1]
    return c0 + (c1 - c0) * (s - s0) / (s1 - s0)


for v in me.vertices:
    w = weight(v, outer)
    if w <= 0:
        continue
    s = (v.co - h).dot(ax)
    v.co = v.co + side * (w * (target(s) - current(s)))

# Move the outer bone chain onto the straightened mesh axis, preserving joint fractions.
old_q = {n: B[n].matrix_local.to_quaternion() for n in outer}
keys = {}
for action in names:
    rig.animation_data.action = bpy.data.actions[action]
    for frame in (1, 25, 37):
        scene.frame_set(frame)
        keys[action, frame] = {n: rig.pose.bones[n].rotation_quaternion.copy() for n in outer}
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
chain = [rig.data.edit_bones[n] for n in outer]
fractions = [0.0] + [((b.tail - h).dot(ax)) / L for b in chain]
new_head = h + side * base_offset
new_tip = h + ax * L + side * tip_offset
points = [new_head.lerp(new_tip, f) for f in fractions]
for i, b in enumerate(chain):
    b.head = points[i]
    b.tail = points[i + 1]
bpy.ops.object.mode_set(mode='OBJECT')
for n in outer:
    B[n]['restLength'] = float(B[n].length)
for action in names:
    rig.animation_data.action = bpy.data.actions[action]
    for frame in (1, 25, 37):
        scene.frame_set(frame)
        for n in outer:
            conversion = B[n].matrix_local.to_quaternion().inverted() @ old_q[n]
            pb = rig.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = conversion @ keys[action, frame][n] @ conversion.inverted()
            pb.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=n)
rig.animation_data.action = bpy.data.actions['Open']
scene.frame_set(1)


# 2. Webs: lower each crotch and narrow its fillet.
def top_z(x: float) -> float:
    return max(v.co.z for v in me.vertices if abs(v.co.x - x) < 0.0015)


def crotch(x0: float, x1: float) -> tuple[float, float]:
    xs = [x0 + (x1 - x0) * i / 40 for i in range(41)]
    return min(((x, top_z(x)) for x in xs), key=lambda p: p[1])


gaps = [crotch(-0.046, -0.016), crotch(0.016, 0.044)]
moved: dict[int, float] = {}
for v in me.vertices:
    dz = 0.0
    for gx, gz in gaps:
        lateral = 1.0 - smooth(WEB_FLAT, WEB_HALF_WIDTH, abs(v.co.x - gx))
        vertical = smooth(gz - WEB_RAMP, gz, v.co.z) * (1.0 - smooth(gz + 0.005, gz + 0.035, v.co.z))
        dz = max(dz, WEB_DEPTH * lateral * vertical)
    v.co.z -= dz
    moved[v.index] = dz / WEB_DEPTH
# The outer-digit shift blends into the palm at partial weights; relax that seam too.
for v in me.vertices:
    w = weight(v, outer)
    if 0.05 < w < 0.95 and v.co.z < 0.16:
        moved[v.index] = max(moved.get(v.index, 0.0), 0.5)
# Taubin (shrink-free) relaxation of the edited regions so fillet edges leave no crease.
neighbours = {v.index: [] for v in me.vertices}
for e in me.edges:
    a, b = e.vertices
    neighbours[a].append(b)
    neighbours[b].append(a)
for _ in range(WEB_RELAX_STEPS):
    for factor in (0.5, -0.53):
        snapshot = [v.co.copy() for v in me.vertices]
        for i, f in moved.items():
            if f <= 0.02:
                continue
            mean = sum((snapshot[j] for j in neighbours[i]), Vector()) / len(neighbours[i])
            me.vertices[i].co = snapshot[i].lerp(mean, factor * min(1.0, f * 2.0))
me.update()
assert topology_digest() == before_topology
report = {
    'outer_smoothed_centre_offset_mm': [[round(s * 1000, 1), round(c * 1000, 2)] for s, c in smoothed],
    'outer_new_bones_mm': {n: [[round(x * 1000, 2) for x in B[n].head_local], [round(x * 1000, 2) for x in B[n].tail_local]] for n in outer},
    'web_crotches_before_mm': [[round(x * 1000, 1), round(z * 1000, 1)] for x, z in gaps],
    'params': {'outer_base_inward': OUTER_BASE_INWARD, 'web_depth': WEB_DEPTH, 'web_flat': WEB_FLAT, 'web_half_width': WEB_HALF_WIDTH, 'web_ramp': WEB_RAMP, 'web_relax_steps': WEB_RELAX_STEPS},
    'topology_and_weights_sha256': before_topology,
}
(OUT / 'shape-edit-report.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'candidate.blend'), copy=True)
print('SHAPE ' + json.dumps(report))
