"""Check committed observatory artifacts without requiring Blender or third-party modules."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import struct


def check() -> None:
    repo = Path(__file__).resolve().parents[2]
    report = json.loads((repo / "assets-source/observatory/report.json").read_text())
    for record in report["files"]:
        path = repo / record["path"]
        assert path.stat().st_size == record["bytes"], path
        assert hashlib.sha256(path.read_bytes()).hexdigest() == record["sha256"], path
    path = repo / "assets-source/observatory/staging/observatory.glb"
    raw = path.read_bytes()
    assert raw[:4] == b"glTF" and struct.unpack_from("<I", raw, 4)[0] == 2
    assert struct.unpack_from("<I", raw, 8)[0] == len(raw)
    json_length = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20:20 + json_length])
    binary = raw[28 + json_length:]
    primitives = [primitive for mesh in document["meshes"] for primitive in mesh["primitives"]]
    triangles = sum(document["accessors"][p["indices"]]["count"] // 3 for p in primitives)
    assert triangles <= 60000 and triangles == report["exported"]["triangles"]
    assert len(primitives) <= 16 and len(document["materials"]) <= 16
    assert len(raw) <= 12 * 1024 * 1024
    assert not document.get("cameras")
    assert "KHR_lights_punctual" not in document.get("extensions", {})
    assert all("uri" not in buffer for buffer in document["buffers"])
    roots = document["scenes"][document.get("scene", 0)]["nodes"]
    assert len(roots) == 1 and document["nodes"][roots[0]]["name"] == "observatory"
    for node in document["nodes"]:
        assert all(math.isfinite(value) for key in ("matrix", "translation", "rotation", "scale")
                   for value in node.get(key, []))
    for image in document.get("images", []):
        assert "uri" not in image and image["mimeType"] == "image/png"
        view = document["bufferViews"][image["bufferView"]]
        offset = view.get("byteOffset", 0)
        png = binary[offset:offset + view["byteLength"]]
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        width, height = struct.unpack_from(">II", png, 16)
        assert 0 < width <= 2048 and 0 < height <= 2048
    for primitive in primitives:
        for kind in ("POSITION", "NORMAL"):
            accessor = document["accessors"][primitive["attributes"][kind]]
            assert accessor["componentType"] == 5126 and accessor["type"] == "VEC3"
            view = document["bufferViews"][accessor["bufferView"]]
            offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            stride = view.get("byteStride", 12)
            for index in range(accessor["count"]):
                vector = struct.unpack_from("<fff", binary, offset + index * stride)
                assert all(math.isfinite(value) for value in vector)
                if kind == "NORMAL":
                    assert abs(sum(value * value for value in vector) - 1) < .014
    assert report["validation"]["pass"] is True
    assert report["lowBeforeBatching"]["terminalVolumeIntersections"] == []
    evidence_path = repo / "assets-source/observatory/reproducibility.json"
    if evidence_path.exists():
        evidence = json.loads(evidence_path.read_text())
        digest = hashlib.sha256(raw).hexdigest()
        assert evidence["primarySha256"] == evidence["rebuildSha256"] == digest
        assert evidence["byteIdentical"] is True
        for name, expected in evidence["previewBinding"]["files"].items():
            preview = repo / "assets-source/observatory/previews" / name
            assert hashlib.sha256(preview.read_bytes()).hexdigest() == expected
    print(json.dumps({"observatory": "pass", "triangles": triangles, "drawCalls": len(primitives),
                      "materials": len(document["materials"]), "bytes": len(raw)}, sort_keys=True))


if __name__ == "__main__":
    check()
