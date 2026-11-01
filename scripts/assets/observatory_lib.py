"""Small, piece-owned Blender helpers. Coordinates are always runtime metres."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import struct

import bpy
from mathutils import Vector


def xyz(point: tuple[float, float, float]) -> Vector:
    return Vector((point[0], -point[2], point[1]))


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0] if objects else None


def material(name: str, color: tuple[float, float, float], roughness: float = 0.6,
             metallic: float = 0.0, emission: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new("observatory_" + name)
    mat.diffuse_color = (*color, 1.0)
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*color, 1.0)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Emission Color"].default_value = (*color, 1.0)
    node.inputs["Emission Strength"].default_value = emission
    return mat


def box(name: str, center: tuple[float, float, float], size: tuple[float, float, float],
        mat: bpy.types.Material, bevel: float, segments: int) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=xyz(center))
    obj = bpy.context.object
    obj.name = "observatory_" + name
    obj.data.name = obj.name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("observatory_edge_radius", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def beam(name: str, a: tuple[float, float, float], b: tuple[float, float, float],
         width: float, depth: float, mat: bpy.types.Material, segments: int,
         bevel: float = 0.025) -> bpy.types.Object:
    start, end = xyz(a), xyz(b)
    delta = end - start
    obj = box(name, (0, 0, 0), (width, delta.length, depth), mat, bevel, segments)
    obj.location = (start + end) / 2
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return obj


def triangulate(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        if obj.type != "MESH":
            continue
        select_only([obj])
        modifier = obj.modifiers.new("observatory_triangles", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mesh_stats(objects: list[bpy.types.Object]) -> dict:
    meshes = [obj for obj in objects if obj.type == "MESH"]
    points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    runtime_points = [(p.x, p.z, -p.y) for p in points]
    assert all(math.isfinite(value) for p in runtime_points for value in p)
    return {
        "objects": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons),
        "bounds": {"min": [min(p[i] for p in runtime_points) for i in range(3)],
                   "max": [max(p[i] for p in runtime_points) for i in range(3)]},
    }


def glb_json(path: Path) -> dict:
    data = path.read_bytes()
    assert data[:4] == b"glTF"
    length = int.from_bytes(data[12:16], "little")
    return json.loads(data[20:20 + length])


def canonicalize_glb(path: Path) -> None:
    """Normalize exporter UV roundoff and equivalent triangle ordering."""
    raw = bytearray(path.read_bytes())
    document = glb_json(path)
    binary_start = 28 + struct.unpack_from("<I", raw, 12)[0]
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            accessor = document["accessors"][primitive["indices"]]
            view = document["bufferViews"][accessor["bufferView"]]
            offset = binary_start + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            code = {5121: "B", 5123: "H", 5125: "I"}[accessor["componentType"]]
            indices = struct.unpack_from("<" + code * accessor["count"], raw, offset)
            triangles = []
            for index in range(0, len(indices), 3):
                triangle = indices[index:index + 3]
                triangles.append(min(triangle, triangle[1:] + triangle[:1], triangle[2:] + triangle[:2]))
            indices = [value for triangle in sorted(triangles) for value in triangle]
            struct.pack_into("<" + code * accessor["count"], raw, offset, *indices)
            if "TEXCOORD_0" in primitive["attributes"]:
                uv = document["accessors"][primitive["attributes"]["TEXCOORD_0"]]
                assert uv["componentType"] == 5126
                view = document["bufferViews"][uv["bufferView"]]
                offset = binary_start + view.get("byteOffset", 0) + uv.get("byteOffset", 0)
                stride = view.get("byteStride", 8)
                for index in range(uv["count"]):
                    pair = struct.unpack_from("<ff", raw, offset + index * stride)
                    pair = [round(value, 6) for value in pair]
                    struct.pack_into("<ff", raw, offset + index * stride, *pair)
    path.write_bytes(raw)


def validate_glb(path: Path) -> dict:
    document = glb_json(path)
    primitives = [p for mesh in document.get("meshes", []) for p in mesh["primitives"]]
    triangles = sum(document["accessors"][p["indices"]]["count"] // 3 for p in primitives)
    assert triangles <= 60000, triangles
    assert len(primitives) <= 16, len(primitives)
    assert len(document.get("materials", [])) <= 16
    assert path.stat().st_size <= 12 * 1024 * 1024
    assert not document.get("cameras")
    assert "KHR_lights_punctual" not in document.get("extensions", {})
    assert all("uri" not in image for image in document.get("images", []))
    assert all("uri" not in buffer for buffer in document["buffers"])
    roots = [document["nodes"][i]["name"] for i in document["scenes"][document.get("scene", 0)]["nodes"]]
    assert roots == ["observatory"], roots
    for node in document["nodes"]:
        assert all(math.isfinite(value) for key in ("matrix", "translation", "rotation", "scale")
                   for value in node.get(key, []))
    return {"triangles": triangles, "drawCalls": len(primitives),
            "materials": len(document.get("materials", [])), "meshes": len(document.get("meshes", [])),
            "nodes": len(document["nodes"]), "embeddedImages": len(document.get("images", [])),
            "bytes": path.stat().st_size, "root": roots[0], "externalReferences": 0}
