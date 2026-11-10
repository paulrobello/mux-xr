"""Render concept directions for XR pane frames.

Run: Blender --background --python-exit-code 1 --python scripts/assets/pane-frame-concepts.py -- <out-dir>

Every frame is a cross-section profile swept along a path in the pane's flat
x/y plane and then bent with the same arc warp the runtime applies, so each
concept stays valid for any pane size and curvature.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

WIDTH = 1.28
HEIGHT = 0.72
RADIANS = 0.62
RADIUS = WIDTH / RADIANS

Profile = list[tuple[float, float]]
Path2 = list[tuple[float, float]]


def warp(x: float, y: float, z: float) -> Vector:
    theta = x / RADIUS
    r = RADIUS - z
    # Blender is Z-up: the pane faces -Y, toward the viewer.
    return Vector((r * math.sin(theta), -(RADIUS - r * math.cos(theta)), y))


def rounded_rect(half_w: float, half_h: float, radius: float, step: float = 0.02) -> Path2:
    points: Path2 = []
    corners = [
        (half_w - radius, half_h - radius, 0.0),
        (-half_w + radius, half_h - radius, 90.0),
        (-half_w + radius, -half_h + radius, 180.0),
        (half_w - radius, -half_h + radius, 270.0),
    ]
    for index, (cx, cy, start) in enumerate(corners):
        for k in range(9):
            a = math.radians(start + k * 90.0 / 8)
            points.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
        nx, ny, nstart = corners[(index + 1) % 4]
        a = math.radians(nstart)
        end = (nx + radius * math.cos(a), ny + radius * math.sin(a))
        begin = points[-1]
        length = math.dist(begin, end)
        count = max(1, int(length / step))
        for k in range(1, count):
            t = k / count
            points.append((begin[0] + (end[0] - begin[0]) * t, begin[1] + (end[1] - begin[1]) * t))
    return points


def line(a: tuple[float, float], b: tuple[float, float], step: float = 0.02) -> Path2:
    count = max(1, int(math.dist(a, b) / step))
    return [(a[0] + (b[0] - a[0]) * k / count, a[1] + (b[1] - a[1]) * k / count) for k in range(count + 1)]


def corner_path(sx: float, sy: float, half_w: float, half_h: float, radius: float, arm: float) -> Path2:
    """An L-shaped path around one corner; sx/sy pick the quadrant."""
    cx, cy = sx * (half_w - radius), sy * (half_h - radius)
    points = line((sx * (half_w - radius - arm), sy * half_h), (cx, sy * half_h))
    for k in range(1, 9):
        a = math.radians(90.0 - k * 90.0 / 8)
        points.append((cx + sx * radius * math.cos(a), cy + sy * radius * math.sin(a)))
    points += line((sx * half_w, cy), (sx * half_w, sy * (half_h - radius - arm)))[1:]
    return points


def sweep(name: str, path: Path2, profile: Profile, closed: bool, material: bpy.types.Material) -> bpy.types.Object:
    """Profile points are (outward, depth); depth is toward the viewer."""
    bm = bmesh.new()
    count = len(path)
    rings: list[list[bmesh.types.BMVert]] = []
    for index, (px, py) in enumerate(path):
        prev = path[(index - 1) % count] if closed or index > 0 else path[index]
        nxt = path[(index + 1) % count] if closed or index < count - 1 else path[index]
        tx, ty = nxt[0] - prev[0], nxt[1] - prev[1]
        length = math.hypot(tx, ty) or 1.0
        tx, ty = tx / length, ty / length
        # Outward normal, oriented away from the pane centre.
        nx, ny = ty, -tx
        if nx * px + ny * py < 0:
            nx, ny = -nx, -ny
        rings.append([bm.verts.new(warp(px + nx * u, py + ny * u, v)) for u, v in profile])
    spans = count if closed else count - 1
    size = len(profile)
    for index in range(spans):
        a, b = rings[index], rings[(index + 1) % count]
        for k in range(size):
            bm.faces.new((a[k], a[(k + 1) % size], b[(k + 1) % size], b[k]))
    if not closed:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


def slab(name: str, x0: float, x1: float, y0: float, y1: float, z: float, material: bpy.types.Material) -> bpy.types.Object:
    bm = bmesh.new()
    cols = max(2, int((x1 - x0) / 0.02))
    grid = [
        [bm.verts.new(warp(x0 + (x1 - x0) * c / cols, y, z)) for c in range(cols + 1)] for y in (y0, y1)
    ]
    uv = bm.loops.layers.uv.new()
    for c in range(cols):
        face = bm.faces.new((grid[0][c], grid[0][c + 1], grid[1][c + 1], grid[1][c]))
        for loop, (du, dv) in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = ((c + du) / cols, dv)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


def pbr(name: str, color: tuple[float, float, float], rough: float, metal: float, emit: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes["Principled BSDF"]
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Roughness"].default_value = rough
    node.inputs["Metallic"].default_value = metal
    if emit:
        node.inputs["Emission Color"].default_value = (*color, 1)
        node.inputs["Emission Strength"].default_value = emit
    return mat


def terminal_material() -> bpy.types.Material:
    w, h = 1024, 576
    rng = random.Random(7)
    px = [0.012, 0.02, 0.03, 1.0] * (w * h)
    palette = [(0.62, 0.78, 0.7), (0.45, 0.7, 0.95), (0.9, 0.78, 0.45), (0.8, 0.82, 0.85), (0.85, 0.45, 0.5)]
    for row in range(30):
        y0 = h - 24 - row * 18
        x = 20 + (rng.choice((0, 0, 16, 32)))
        for _ in range(rng.randint(1, 7)):
            run = rng.randint(20, 150)
            color = rng.choice(palette)
            for yy in range(y0, y0 + 7):
                for xx in range(x, min(w - 20, x + run)):
                    if (xx // 3) % 3 != 2:
                        i = (yy * w + xx) * 4
                        px[i : i + 3] = color
            x += run + 14
            if x > w - 180:
                break
    image = bpy.data.images.new("terminal", w, h)
    image.pixels = px
    mat = bpy.data.materials.new("terminal")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Specular IOR Level"].default_value = 0.1
    links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.6
    return mat


def build(concept: str) -> None:
    hw, hh = WIDTH / 2, HEIGHT / 2
    dark = pbr("frame-dark", (0.035, 0.05, 0.065), 0.42, 0.85)
    mid = pbr("frame-mid", (0.11, 0.14, 0.17), 0.55, 0.7)
    accent = pbr("accent", (0.15, 0.75, 1.0), 0.4, 0.0, 6.0)
    slab("screen", -hw, hw, -hh, hh, 0.0, terminal_material())

    if concept == "A":
        # Slim chamfered bezel with a recessed light line on the inner lip.
        path = rounded_rect(hw + 0.004, hh + 0.004, 0.022)
        sweep("bezel", path, [(0.0, -0.012), (0.0, 0.006), (0.006, 0.012), (0.02, 0.012), (0.026, 0.004), (0.026, -0.012)], True, dark)
        sweep("light", rounded_rect(hw + 0.002, hh + 0.002, 0.02), [(-0.001, 0.004), (0.002, 0.004), (0.002, 0.0075), (-0.001, 0.0075)], True, accent)
    elif concept == "B":
        # Instrument frame: stepped bezel, heavy chin with a title plate and status light.
        path = rounded_rect(hw + 0.004, hh + 0.004, 0.012)
        sweep("bezel", path, [(0.0, -0.016), (0.0, 0.004), (0.01, 0.014), (0.022, 0.014), (0.022, 0.008), (0.034, 0.008), (0.04, 0.0), (0.04, -0.016)], True, dark)
        chin_top, chin_bot = -hh - 0.044, -hh - 0.1
        sweep("chin", line((-hw - 0.044, (chin_top + chin_bot) / 2), (hw + 0.044, (chin_top + chin_bot) / 2)),
              [(-0.028, -0.016), (-0.028, 0.004), (-0.02, 0.012), (0.02, 0.012), (0.028, 0.004), (0.028, -0.016)], False, mid)
        slab("plate", -0.2, 0.2, chin_bot + 0.014, chin_top - 0.014, 0.0125, pbr("plate", (0.02, 0.03, 0.04), 0.3, 0.2))
        slab("status", hw - 0.08, hw - 0.03, chin_bot + 0.024, chin_top - 0.024, 0.0128, accent)
        for sx in (-1, 1):
            sweep(f"strut{sx}", line((sx * (hw - 0.12), -hh - 0.04), (sx * (hw - 0.12), chin_top + 0.004)),
                  [(-0.01, -0.016), (-0.01, 0.006), (0.01, 0.006), (0.01, -0.016)], False, dark)
    else:
        # Floating corner brackets and hairline rails; the glass edge stays open.
        prof = [(0.004, -0.008), (0.004, 0.008), (0.01, 0.014), (0.022, 0.014), (0.028, 0.006), (0.028, -0.008)]
        for sx in (-1, 1):
            for sy in (-1, 1):
                sweep(f"corner{sx}{sy}", corner_path(sx, sy, hw, hh, 0.03, 0.13), prof, False, dark)
                sweep(f"glow{sx}{sy}", corner_path(sx, sy, hw + 0.002, hh + 0.002, 0.03, 0.09),
                      [(0.0, 0.002), (0.003, 0.002), (0.003, 0.006), (0.0, 0.006)], False, accent)
        for sy in (-1, 1):
            sweep(f"rail{sy}", line((-hw + 0.2, sy * hh), (hw - 0.2, sy * hh)),
                  [(0.008, -0.003), (0.008, 0.003), (0.013, 0.003), (0.013, -0.003)], False, mid)


def stage() -> bpy.types.Object:
    scene = bpy.context.scene
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.006, 0.012, 1)
    scene.world = world
    for name, loc, energy, size, color in (
        ("key", (-1.4, -2.2, 1.6), 160, 2.0, (0.75, 0.85, 1.0)),
        ("rim", (2.2, -1.2, 0.6), 110, 1.5, (1.0, 0.8, 0.65)),
        ("fill", (0.0, -2.5, -1.2), 40, 3.0, (0.6, 0.7, 1.0)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.size, data.color = energy, size, color
        light = bpy.data.objects.new(name, data)
        light.location = loc
        light.rotation_euler = (Vector((0, -0.1, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(light)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.view_settings.view_transform = "Standard"
    return cam


def aim(cam: bpy.types.Object, location: tuple[float, float, float], target: tuple[float, float, float], lens: float) -> None:
    cam.location = location
    cam.data.lens = lens
    cam.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    out = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for concept in ("A", "B", "C"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        cam = stage()
        build(concept)
        for view, location, target, lens in (
            ("front", (0.35, -2.1, 0.1), (0.0, -0.05, -0.03), 40),
            ("corner", (-0.95, -0.8, -0.52), (-0.5, -0.1, -0.34), 55),
        ):
            aim(cam, location, target, lens)
            bpy.context.scene.render.filepath = str(out / f"frame-{concept}-{view}.png")
            bpy.ops.render.render(write_still=True)
            tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" and o.name != "screen" for p in o.data.polygons)
            print(f"CONCEPT {concept} {view} frame_tris={tris}")


main()
