"""Re-bind the thumb along the owner's tracked neutral thumb direction.

Run headless on pre-edit.blend: Blender -b pre-edit.blend --python rebind.py
The authored thumb pointed sideways (+X) while the tracked neutral thumb points forward
beside the index, so the runtime rotated thumb_01 about 75 degrees from bind before any
motion and linear-blend skinning collapsed the thumb root on crimp poses. This script
poses thumb_01-03 along the mirror-averaged neutral directions, bakes the deformed mesh,
applies the pose as the new rest, re-keys the four actions so every bone keeps its posed
armature-space orientation and widens the wrist/thumb_01 weight blend around the thumb
root. Skin behind the thumb_01 head keeps no thumb share (before the bake and after the
blend), so the heel neither turns with the thumb in the bake nor wings out at runtime.
The bake uses dual-quaternion skinning, and the pit it digs in the web on the back of the
root is lifted back out. Finally three skin-only helper bones at the thumb_01 head take the
wrist/thumb_01 band (root and web helpers, half the turn) and the tapered heel share (heel
helper, root travel only). Writes rebound.blend (before the weight change) and
candidate.blend.
"""
import bpy
import json
import math
import os
from pathlib import Path

from mathutils import Matrix, Quaternion, Vector

OUT = Path(__file__).resolve().parent
DEST = Path(os.environ.get('REBIND_OUT', str(OUT)))
REFERENCE = OUT.parents[2] / 'src' / 'xr' / 'hand-neutral-reference.json'
BLEND_RADIUS = float(os.environ.get('BLEND_RADIUS', '0.06'))    # around the thumb_01 head (m); 0 keeps the v5 split
BLEND_ITERATIONS = int(os.environ.get('BLEND_ITERATIONS', '300'))
# Optional limit: skip vertices more than this far below the thumb_01 head (m). Off by default.
BLEND_BELOW = float(os.environ.get('BLEND_BELOW', '1'))
# Optional extra in-plane turn of the bind about the depth axis (degrees). Off by default;
# turning toward the closed-slide direction added flips.
BIND_TURN = float(os.environ.get('BIND_TURN', '0'))
# Taper thumb_01 share to zero over this distance behind the thumb_01 head along its bind axis (m);
# skin below the root that follows the thumb winged out when the thumb crossed the palm. 0 disables.
THUMB_TAPER = float(os.environ.get('THUMB_TAPER', '0.025'))
# Passes that lift back-of-hand vertices where the bake dug a pit (0 disables).
POCKET_PASSES = int(os.environ.get('POCKET_PASSES', '10'))
# Skin-only helper bones: wrist children with the thumb_01 rest, which the runtime turns and moves
# by a share of thumb_01's motion (src/xr/rigged-hand.ts THUMB_HELPERS). The wrist/thumb_01 band is
# re-expressed through the half-turn root and web helpers, so no vertex blends bones more than half
# a thumb_01 turn apart, and the tapered heel share moves to the travel-only heel helper. 0 disables.
HELPER = os.environ.get('HELPER', '1') == '1'
HELPER_NAME = 'thumb_root_helper'
HEEL_NAME = 'thumb_heel_helper'
WEB_NAME = 'thumb_web_helper'
# Half-width (m) of the crossfade at the thumb_01 head that hands the re-expressed share ahead of the
# head to the web helper (0: no web helper).
HELPER_SPLIT = float(os.environ.get('HELPER_SPLIT', '0.015'))
# Each metre of a vertex's offset from the head toward the index counts this much toward the web
# side of the split, so the back of the web between thumb and index stays on the web helper.
HELPER_INWARD = float(os.environ.get('HELPER_INWARD', '0.5'))
# The re-expression fades out over this distance ahead of the thumb_01 head (m), so the shaft keeps thumb_01.
HELPER_AHEAD = float(os.environ.get('HELPER_AHEAD', '0.015'))
# Share of the tapered heel weight handed to the heel helper instead of the wrist.
HELPER_TAPER = float(os.environ.get('HELPER_TAPER', '1'))
# Turn shares keyed into the actions; they must match THUMB_HELPERS in src/xr/rigged-hand.ts.
HELPER_TURN = {HELPER_NAME: 0.5, WEB_NAME: 0.5}
# Bake with dual-quaternion (volume-preserving) skinning so the bind carries no LBS root collapse.
BAKE_DQS = os.environ.get('BAKE_DQS', '1') == '1'
THUMB = ('thumb_01', 'thumb_02', 'thumb_03')
ACTIONS = ('Open', 'Fist', 'Pointing', 'Thumbs Up')
CHECK_FRAMES = (1, 7, 13, 19, 25, 31, 37)

rig = bpy.data.objects['AuthoredHandRig']
hand = bpy.data.objects['AuthoredHandMesh']
me = hand.data
scene = bpy.context.scene
view = bpy.context.view_layer
if bpy.context.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
assert rig.matrix_world == Matrix.Identity(4) and hand.matrix_world == Matrix.Identity(4)
assert [m.type for m in hand.modifiers] == ['ARMATURE'] and me.shape_keys is None
assert all(rig.pose.bones[n].rotation_mode == 'QUATERNION' for n in THUMB)


def gltf_to_blender(v: Vector) -> Vector:
    return Vector((v.x, -v.z, v.y))


def neutral_direction(joint: str) -> tuple[Vector, dict]:
    """Mirror-average of both hands' neutral -Z axis, in Blender armature space.

    One mesh serves both hands; the runtime basis is right-handed, so the left hand sees
    the authored depth axis flipped. The average zeroes the depth component so each hand
    keeps the same small residual swing toward its own palm.
    """
    reference = json.loads(REFERENCE.read_text())
    sides = {}
    for side in ('left', 'right'):
        x, y, z, w = reference[side][joint]
        sides[side] = Quaternion((w, x, y, z)) @ Vector((0.0, 0.0, -1.0))
    average = (sides['left'] + sides['right']) / 2
    average.z = 0.0
    average = Quaternion(Vector((0.0, 0.0, 1.0)), math.radians(BIND_TURN)) @ average.normalized()
    target = gltf_to_blender(average)
    residual = {s: round(math.degrees(gltf_to_blender(d).angle(target)), 2) for s, d in sides.items()}
    return target, residual


def pose_matrices() -> dict[str, Matrix]:
    view.update()
    return {pb.name: pb.matrix.copy() for pb in rig.pose.bones}


def channelbag(action):
    return action.layers[0].strips[0].channelbag(action.slots[0])


def weight(v, name: str) -> float:
    index = hand.vertex_groups[name].index
    return next((g.weight for g in v.groups if g.group == index), 0.0)


# Reference pose of every action, to prove the re-keyed actions look the same.
before_poses = {}
for name in ACTIONS:
    rig.animation_data.action = bpy.data.actions[name]
    for frame in CHECK_FRAMES:
        scene.frame_set(frame)
        before_poses[(name, frame)] = pose_matrices()
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
view.update()
rest_before = {b.name: b.matrix_local.copy() for b in rig.data.bones}
lengths = {b.name: b.length for b in rig.data.bones}
parents = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
coords_before = [v.co.copy() for v in me.vertices]
min_z_before = min(c.z for c in coords_before)
thumb_weighted = [sum(weight(v, n) for n in THUMB) > 0 for v in me.vertices]

targets = {}
swings = {}
for name in THUMB:
    joint = 'thumb-phalanx-distal' if name == 'thumb_03' else 'thumb-phalanx-proximal'
    target, residual = neutral_direction(joint)
    targets[name] = residual
    pb = rig.pose.bones[name]
    view.update()
    current = pb.matrix.copy()
    direction = current.col[1].to_3d().normalized()
    swing = direction.rotation_difference(target)
    swings[name] = round(math.degrees(swing.angle), 2)
    rotation = (swing.to_matrix() @ current.to_3x3()).to_4x4()
    pb.matrix = Matrix.Translation(current.translation) @ rotation
    view.update()
    assert pb.matrix.col[1].to_3d().normalized().angle(target) < 1e-5, name
posed = pose_matrices()

tapered: dict[int, float] = {}


def taper_thumb_share(head: Vector, axis: Vector) -> list[float]:
    """Move thumb_01 share behind the thumb_01 head to wrist, smoothly to zero over THUMB_TAPER."""
    a_index, b_index = hand.vertex_groups['wrist'].index, hand.vertex_groups['thumb_01'].index
    moved = []
    for v in me.vertices:
        behind = -(v.co - head).dot(axis)
        if behind <= 0:
            continue
        w = {g.group: g.weight for g in v.groups}
        thumb_share = w.get(b_index, 0.0)
        if thumb_share <= 0:
            continue
        t = min(behind / THUMB_TAPER, 1.0)
        keep = 1 - t * t * (3 - 2 * t)
        removed = thumb_share * (1 - keep)
        if removed <= 0:
            continue
        if thumb_share * keep < 1e-4:
            hand.vertex_groups['thumb_01'].remove([v.index])
        else:
            hand.vertex_groups['thumb_01'].add([v.index], thumb_share * keep, 'REPLACE')
        hand.vertex_groups['wrist'].add([v.index], w.get(a_index, 0.0) + removed, 'REPLACE')
        moved.append(removed)
        tapered[v.index] = removed
    return moved


pre_taper = {'vertices': 0}
if THUMB_TAPER > 0:
    # Skin behind the thumb root must not turn with the thumb in the bake either, or the heel
    # is baked into a lateral shoulder that no later weight change can remove.
    pre_taper['vertices'] = len(taper_thumb_share(posed['thumb_01'].translation, posed['thumb_01'].col[1].to_3d().normalized()))
    thumb_weighted = [sum(weight(v, n) for n in THUMB) > 0 for v in me.vertices]
# Bake the posed skin into the base mesh.
modifier = hand.modifiers[0]
preserve = modifier.use_deform_preserve_volume
modifier.use_deform_preserve_volume = BAKE_DQS
view.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
evaluated = hand.evaluated_get(depsgraph)
baked = evaluated.to_mesh()
assert len(baked.vertices) == len(me.vertices)
for v, b in zip(me.vertices, baked.vertices):
    v.co = b.co
evaluated.to_mesh_clear()
modifier.use_deform_preserve_volume = preserve

def ring_pits(coords: list, links: dict[int, list[int]]) -> list[float]:
    """Depth of each vertex below the mean of its 2-ring, along the outward normal (m)."""
    normals = [v.normal.copy() for v in me.vertices]
    out = []
    for i in range(len(coords)):
        ring = set(links[i])
        for j in links[i]:
            ring.update(links[j])
        ring.discard(i)
        mean = sum((coords[j] for j in ring), Vector()) / len(ring)
        out.append((mean - coords[i]).dot(normals[i]))
    return out


pocket = {'passes': POCKET_PASSES, 'vertices': 0}
if POCKET_PASSES > 0:
    # The 70 degree turn digs a pit into the web on the back of the thumb root. Smooth only the
    # back-side vertices whose 2-ring pit the bake deepened, plus two rings around them.
    links: dict[int, list[int]] = {v.index: [] for v in me.vertices}
    for e in me.edges:
        a, b = e.vertices
        links[a].append(b)
        links[b].append(a)
    me.update()
    after = ring_pits([v.co.copy() for v in me.vertices], links)
    saved = [v.co.copy() for v in me.vertices]
    for v, c in zip(me.vertices, coords_before):
        v.co = c
    me.update()
    before = ring_pits(coords_before, links)
    # Orient so a convex surface reads negative whatever the normal convention.
    if sorted(before)[len(before) // 2] > 0:
        after, before = [-x for x in after], [-x for x in before]
    for v, c in zip(me.vertices, saved):
        v.co = c
    me.update()
    seeds = {i for i in range(len(me.vertices)) if thumb_weighted[i] and me.vertices[i].co.y > 0.002 and after[i] - before[i] > 0.0003}
    mask = set(seeds)
    for _ in range(2):
        mask |= {j for i in mask for j in links[i] if thumb_weighted[j]}
    sign = -1.0 if sorted(ring_pits(coords_before, links))[len(me.vertices) // 2] > 0 else 1.0
    for _ in range(POCKET_PASSES):
        # Raise each masked vertex along its normal by half the depth it sits below its
        # pre-bake 2-ring relation; convex skin never moves inward.
        me.update()
        current = [v.co.copy() for v in me.vertices]
        now = ring_pits(current, links)
        for i in mask:
            excess = sign * now[i] - before[i]
            if excess > 0:
                me.vertices[i].co = current[i] + sign * 0.5 * excess * me.vertices[i].normal
    me.update()
    pocket.update({'seeds': len(seeds), 'vertices': len(mask), 'max_bake_pit_mm': round(1000 * max((after[i] - before[i] for i in seeds), default=0.0), 2)})
outside = max((me.vertices[i].co - coords_before[i]).length for i in range(len(me.vertices)) if not thumb_weighted[i])
assert outside < 1e-7, outside

# Apply the pose as the new rest.
view.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name in THUMB:
    rig.data.edit_bones[name].matrix = posed[name]
bpy.ops.object.mode_set(mode='OBJECT')
for pb in rig.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
view.update()
for b in rig.data.bones:
    assert abs(b.length - lengths[b.name]) < 1e-6, b.name
    assert (b.parent.name if b.parent else None) == parents[b.name], b.name
    if b.name not in THUMB:
        assert (b.matrix_local - rest_before[b.name]).to_quaternion().angle < 1e-6 and (b.head_local - rest_before[b.name].translation).length < 1e-7, b.name
    else:
        assert (b.matrix_local.translation - posed[b.name].translation).length < 1e-6, b.name
        assert b.matrix_local.to_quaternion().rotation_difference(posed[b.name].to_quaternion()).angle < 1e-5, b.name

# Re-key: basis_new = (newRelRest^-1 @ oldRelRest) @ basis_old keeps each armature-space pose.
def relative_rest(rest: dict[str, Matrix], name: str) -> Quaternion:
    parent = parents[name]
    local = rest[name] if parent is None else rest[parent].inverted() @ rest[name]
    return local.to_quaternion()


rest_after = {b.name: b.matrix_local.copy() for b in rig.data.bones}
corrections = {n: relative_rest(rest_after, n).inverted() @ relative_rest(rest_before, n) for n in THUMB}
for name in ACTIONS:
    bag = channelbag(bpy.data.actions[name])
    for bone, q in corrections.items():
        curves = [bag.fcurves.find(f'pose.bones["{bone}"].rotation_quaternion', index=i) for i in range(4)]
        assert all(curves) and len({len(c.keyframe_points) for c in curves}) == 1, (name, bone)
        for k in range(len(curves[0].keyframe_points)):
            for attr in ('co', 'handle_left', 'handle_right'):
                old = Quaternion([getattr(c.keyframe_points[k], attr)[1] for c in curves])
                new = q @ old
                for i, c in enumerate(curves):
                    point = getattr(c.keyframe_points[k], attr)
                    point[1] = new[i]
        for c in curves:
            c.update()
pose_error = 0.0
for name in ACTIONS:
    rig.animation_data.action = bpy.data.actions[name]
    for frame in CHECK_FRAMES:
        scene.frame_set(frame)
        after = pose_matrices()
        for bone, m in after.items():
            ref = before_poses[(name, frame)][bone]
            pose_error = max(pose_error, math.degrees(m.to_quaternion().rotation_difference(ref.to_quaternion()).angle))
            assert (m.translation - ref.translation).length < 1e-6, (name, frame, bone)
assert pose_error < 0.5, pose_error
rig.animation_data.action = bpy.data.actions['Open']
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(DEST / 'rebound.blend'), copy=True)

neighbours: dict[int, list[int]] = {v.index: [] for v in me.vertices}
for e in me.edges:
    a, b = e.vertices
    neighbours[a].append(b)
    neighbours[b].append(a)
head = rig.data.bones['thumb_01'].head_local
# Widen the wrist/thumb_01 split around the thumb root, keeping each vertex's sum. The opposing
# thumb root travels about 40 mm on a closed hand; a short blend shears and folds the inner band.
assert max((me.vertices[i].co - coords_before[i]).length for i in range(len(me.vertices)) if not thumb_weighted[i]) < 1e-7
assert abs(min(v.co.z for v in me.vertices) - min_z_before) < 1e-6
blend = {'radius_m': BLEND_RADIUS, 'vertices': 0}
if BLEND_RADIUS > 0:
    a_index, b_index = hand.vertex_groups['wrist'].index, hand.vertex_groups['thumb_01'].index

    def pair(v) -> tuple[float, float]:
        w = {g.group: g.weight for g in v.groups}
        return w.get(a_index, 0.0), w.get(b_index, 0.0)

    region = {v.index for v in me.vertices if sum(pair(v)) > 0.9 and (v.co - head).length < BLEND_RADIUS and v.co.z > head.z - BLEND_BELOW}
    shares = {v.index: pair(v)[1] / sum(pair(v)) for v in me.vertices if sum(pair(v)) > 0}
    original = {i: shares[i] for i in region}
    for _ in range(BLEND_ITERATIONS):
        nxt = dict(shares)
        for i in region:
            ns = [shares.get(j, 0.0) for j in neighbours[i]]
            nxt[i] = 0.5 * shares[i] + 0.5 * sum(ns) / len(ns)
        shares = nxt
    for i in region:
        total = sum(pair(me.vertices[i]))
        for group, value in (('wrist', total * (1 - shares[i])), ('thumb_01', total * shares[i])):
            if value < 1e-4:
                hand.vertex_groups[group].remove([i])
            else:
                hand.vertex_groups[group].add([i], value, 'REPLACE')
    changes = [abs(shares[i] - original[i]) for i in region]
    blend.update({'iterations': BLEND_ITERATIONS, 'below_m': BLEND_BELOW, 'vertices': len(region), 'max_share_change': round(max(changes), 3), 'mean_share_change': round(sum(changes) / len(changes), 3)})

taper = {'distance_m': THUMB_TAPER, 'vertices': 0}
if THUMB_TAPER > 0:
    tapered.clear()
    moved = taper_thumb_share(head, rig.data.bones['thumb_01'].matrix_local.col[1].to_3d().normalized())
    taper.update({'vertices': len(moved), 'max_share_moved': round(max(moved), 3) if moved else 0.0})

helper = {'enabled': HELPER, 'vertices': 0}
if HELPER:
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    source = rig.data.edit_bones['thumb_01']
    names = (HELPER_NAME, HEEL_NAME) + ((WEB_NAME,) if HELPER_SPLIT > 0 else ())
    for name in names:
        bone = rig.data.edit_bones.new(name)
        bone.head, bone.tail, bone.roll = source.head.copy(), source.tail.copy(), source.roll
        bone.parent = rig.data.edit_bones['wrist']
        bone.use_connect = False
        bone.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')
    for name in names:
        rig.data.bones[name]['restLength'] = rig.data.bones[name].length
        hm, tm = rig.data.bones[name].matrix_local, rig.data.bones['thumb_01'].matrix_local
        assert max(abs(hm[r][c] - tm[r][c]) for r in range(4) for c in range(4)) < 1e-6
        hand.vertex_groups.new(name=name)
    a_index, b_index = hand.vertex_groups['wrist'].index, hand.vertex_groups['thumb_01'].index
    head = rig.data.bones['thumb_01'].head_local
    axis = rig.data.bones['thumb_01'].matrix_local.col[1].to_3d().normalized()
    for v in me.vertices:
        w = {g.group: g.weight for g in v.groups}
        wa, wb = w.get(a_index, 0.0), w.get(b_index, 0.0)
        total = wa + wb
        wh = HELPER_TAPER * tapered.get(v.index, 0.0)
        if wh > 0:
            wa -= wh
            total = wa + wb
            hand.vertex_groups[HEEL_NAME].add([v.index], wh, 'REPLACE')
            if wa < 1e-4:
                hand.vertex_groups['wrist'].remove([v.index])
            else:
                hand.vertex_groups['wrist'].add([v.index], wa, 'REPLACE')
        if wb <= 0 or total <= 0:
            helper['vertices'] += wh > 0
            continue
        t = wb / total
        along = (v.co - head).dot(axis)
        m = 1.0 if along <= 0 else max(0.0, 1.0 - along / HELPER_AHEAD) if HELPER_AHEAD > 0 else 0.0
        m = m * m * (3 - 2 * m)
        if m <= 0:
            helper['vertices'] += wh > 0
            continue
        if t < 0.5:
            remap = (1 - 2 * t, 2 * t, 0.0)
        else:
            remap = (0.0, 2 * (1 - t), 2 * t - 1)
        new = [total * (m * r + (1 - m) * o) for r, o in zip(remap, (1 - t, 0.0, t))]
        front = 0.0
        if HELPER_SPLIT > 0:
            side = along + HELPER_INWARD * max(0.0, head.x - v.co.x)
            x = min(max((side + HELPER_SPLIT) / (2 * HELPER_SPLIT), 0.0), 1.0)
            front = x * x * (3 - 2 * x)
        groups = [('wrist', new[0]), (HELPER_NAME, new[1] * (1 - front)), ('thumb_01', new[2])]
        if HELPER_SPLIT > 0:
            groups.append((WEB_NAME, new[1] * front))
        for grp, value in groups:
            if value < 1e-4:
                hand.vertex_groups[grp].remove([v.index])
            else:
                hand.vertex_groups[grp].add([v.index], value, 'REPLACE')
        helper['vertices'] += 1
    # Key the turning helpers in every action at thumb_01's keys, so a clip consumer sees the
    # same blend the runtime builds.
    keyed = 0
    for name in ACTIONS:
        bag = channelbag(bpy.data.actions[name])
        curves = [bag.fcurves.find('pose.bones["thumb_01"].rotation_quaternion', index=i) for i in range(4)]
        frames = sorted({k.co[0] for k in curves[0].keyframe_points})
        for helper_name, share in HELPER_TURN.items():
            if helper_name not in rig.data.bones:
                continue
            path = f'pose.bones["{helper_name}"].rotation_quaternion'
            keys = [bag.fcurves.new(path, index=i, group_name=helper_name) for i in range(4)]
            for frame in frames:
                q = Quaternion([c.evaluate(frame) for c in curves]).normalized()
                value = Quaternion().slerp(q, share)
                for i, c in enumerate(keys):
                    c.keyframe_points.insert(frame, value[i])
            keyed += len(frames)
    helper['action_keys'] = keyed
    helper.update({'ahead_m': HELPER_AHEAD, 'web_split_m': HELPER_SPLIT, 'heel_taper_share': HELPER_TAPER})

report = {
    'neutral_residual_deg': targets, 'bind_swing_deg': swings,
    'action_pose_error_deg': round(pose_error, 4),
    'bake': 'dual-quaternion' if BAKE_DQS else 'linear',
    'pocket_fix': pocket,
    'max_displacement_outside_thumb_m': outside,
    'wrist_thumb_blend': blend,
    'thumb_taper': taper,
    'thumb_taper_before_bake': pre_taper,
    'helper': helper,
}
(DEST / 'rebind.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(DEST / 'candidate.blend'), copy=True)
print('REBIND ' + json.dumps(report))
