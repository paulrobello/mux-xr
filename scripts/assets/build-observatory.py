"""Build the approved Mux XR observation deck in an isolated Blender process.

Run with Blender --background --factory-startup --python-exit-code 1 --python
scripts/assets/build-observatory.py. -- --verify-only checks the staged export.
-- --no-render preserves existing previews while rebuilding geometry.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import random
import shutil
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from observatory_lib import (beam, box, canonicalize_glb, material, mesh_stats, select_only, sha256,
                             triangulate, validate_glb, xyz)

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "assets-source/observatory"
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--repro" in ARGS:
    OUT = OUT / "repro"


def save_source(path: Path) -> None:
    if path.exists():
        archive = OUT / "archive" / f"{path.stem}.{sha256(path)[:12]}.blend"
        archive.parent.mkdir(exist_ok=True)
        if not archive.exists():
            shutil.copy2(path, archive)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def planet_map() -> bpy.types.Image:
    """Author an equirectangular color map with periodic analytic cloud fields."""
    width, height = 2048, 1024
    u, v = np.meshgrid(np.linspace(0, 2 * np.pi, width, endpoint=False),
                       np.linspace(-np.pi / 2, np.pi / 2, height))
    x, y, z = np.cos(v) * np.cos(u), np.cos(v) * np.sin(u), np.sin(v)
    def field(scale: float, seed: int) -> np.ndarray:
        grid=np.random.default_rng(seed).random((64,64,64)).astype(np.float32)
        coords=[(a+2)*scale for a in (x,y,z)]
        cells=[np.floor(a).astype(np.int32) for a in coords]
        weights=[a-b for a,b in zip(coords,cells)]
        weights=[a*a*(3-2*a) for a in weights]
        result=np.zeros_like(x)
        for dx in (0,1):
            for dy in (0,1):
                for dz in (0,1):
                    weight=np.ones_like(x)
                    for dimension,offset in enumerate((dx,dy,dz)):
                        weight*=weights[dimension] if offset else 1-weights[dimension]
                    result+=weight*grid[(cells[0]+dx)%64,(cells[1]+dy)%64,(cells[2]+dz)%64]
        return result
    land=field(2.4,31)*.60+field(5,32)*.25+field(11,33)*.10+field(24,34)*.05
    continents = np.clip((land - .48) * 14.0, 0, 1)
    ocean = np.array([.025, .09, .16])
    rock = np.array([.12, .20, .19])
    colors = ocean[None, None, :] * (1-continents[:, :, None]) + rock[None, None, :] * continents[:, :, None]
    clouds = field(9,61)*.6+field(23,62)*.27+field(47,63)*.13
    clouds = np.clip((clouds-.50)*3.5, 0, .72)
    colors = colors * (1-clouds[:, :, None]) + np.array([.48,.60,.65])[None,None,:] * clouds[:,:,None]
    ice = np.clip((np.abs(z)-.91)*10, 0, .6)
    colors = colors * (1-ice[:,:,None]) + np.array([.32,.42,.45])[None,None,:] * ice[:,:,None]
    rgba = np.concatenate((colors, np.ones((height,width,1))), axis=2).astype(np.float32)
    image = bpy.data.images.new("observatory_planet_basecolor", width=width, height=height)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(OUT / "maps/planet-basecolor.png")
    image.file_format = "PNG"
    image.save()
    image.pack()
    return image


def build(detail: str, texture: bpy.types.Image) -> tuple[bpy.types.Object, dict]:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.name = "observatory"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    bpy.context.collection.name = "observatory"
    segments = 3 if detail == "high" else 1
    mats = {
        "hull": material("hull_"+detail, (.038,.055,.071), .6, .4, .035),
        "edge": material("edge_"+detail, (.016,.025,.036), .72, .25, .05),
        "floor": material("floor_"+detail, (.032,.043,.052), .86, .12, .035),
        "inset": material("inset_"+detail, (.006,.012,.019), .8, .1, .1),
        "alloy": material("alloy_"+detail, (.17,.145,.10), .52, .55, .02),
        "cool": material("cool_"+detail, (.07,.30,.39), .5, 0, .7),
        "warm": material("warm_"+detail, (.50,.24,.085), .6, 0, .5),
        "display": material("display_"+detail, (.018,.075,.10), .8, 0, .5),
        "star": material("star_"+detail, (.42,.52,.63), .7, 0, .85),
    }
    root = bpy.data.objects.new("observatory", None)
    bpy.context.collection.objects.link(root)
    root["pieceId"] = "observatory"
    root["units"] = "metres"
    root["purpose"] = "static terminal reading environment"
    def slab(name: str, pos: tuple, size: tuple, key: str, bevel: float = .03) -> bpy.types.Object:
        return box(name,pos,size,mats[key],bevel,segments)
    def strut(name: str, a: tuple, b: tuple, width: float, depth: float, key: str) -> bpy.types.Object:
        return beam(name,a,b,width,depth,mats[key],segments)

    # A seam-separated floor extends behind the viewer without entering the reading volume.
    slab("deck_foundation", (0,-.24,-1), (13,.42,14), "edge", .09)
    for column in range(-3,3):
        for row in range(-3,4):
            slab(f"deck_{column}_{row}",(column*1.8+.9,.005,row*1.8-1), (1.77,.06,1.77),"floor",.012)
    for side in (-1,1):
        slab(f"walkway_inlay_{side}",(side*2.55,.047,-1.7),(.028,.015,10.1),"alloy",.004)
        for z in (-5.7,-3.9,-2.1,-.3,1.5,3.3):
            slab(f"edge_light_{side}_{z}",(side*4.45,.075,z),(.035,.025,1.25),"cool",.005)
        slab(f"threshold_{side}",(side*5.5,.14,-1.4),(1.6,.28,11.7),"hull",.07)

    aperture = [(-5.25,.24),(-5.25,4.1),(-3.75,5.7),(3.75,5.7),
                (5.25,4.1),(5.25,.24)]
    # Successive frame planes make the opening read as a thick pressure hull.
    for station, z in enumerate((-6.25,-5.5,-4.75)):
        for i,(a,b) in enumerate(zip(aperture,aperture[1:])):
            strut(f"aperture_{station}_{i}",(a[0],a[1],z),(b[0],b[1],z),
                  .23 if station != 1 else .34,.30,"hull" if station == 1 else "edge")
        for i,(a,b) in enumerate(zip(aperture,aperture[1:])):
            if station == 1:
                strut(f"aperture_reveal_{i}",(a[0]*.977,a[1],z+.20),
                      (b[0]*.977,b[1],z+.20),.025,.027,"cool")
    slab("window_sill",(0,.16,-5.5),(10.7,.30,1.8),"hull",.05)
    slab("window_sill_inlay",(0,.319,-5.36),(9.8,.018,.024),"alloy",.003)
    # Deep side ribs and segmented pressure panels frame both peripheral views.
    for side in (-1,1):
        for station,z in enumerate((-4.3,-1.9,.5,2.9,5.3)):
            strut(f"rib_lower_{side}_{station}",(side*5.95,.25,z),(side*5.95,3.7,z),.22,.22,"hull")
            strut(f"rib_crown_{side}_{station}",(side*5.95,3.7,z),(side*3.8,5.7,z),.22,.22,"hull")
            slab(f"wall_panel_{side}_{station}",(side*6.15,2.15,z+.96),(.18,3.8,1.85),"edge",.03)
            roof=slab(f"roof_haunch_{side}_{station}",(side*4.97,4.76,z+.96),(3.12,.15,2.29),"edge",.025)
            roof.rotation_euler[1]=side*math.atan2(2.0,2.35)
            slab(f"wall_recess_{side}_{station}",(side*6.035,2.25,z+.96),(.022,1.8,1.5),"inset",.015)
            slab(f"wall_stripe_{side}_{station}",(side*6.005,3.08,z+.96),(.028,.025,1.28),"alloy",.004)
            for slot in range(5):
                slab(f"wall_vent_{side}_{station}_{slot}",(side*6.005,.68+slot*.09,z+.96),(.03,.025,1.1),"inset",.003)
        for z in (-3.1,1.7):
            slab(f"service_bay_{side}_{z}",(side*5.60,1.25,z),(.72,1.72,1.4),"hull",.07)
            slab(f"service_bay_face_{side}_{z}",(side*5.205,1.4,z),(.04,.85,1.1),"inset",.015)
            slab(f"bay_status_{side}_{z}",(side*5.175,1.7,z-.32),(.025,.06,.20),"warm",.009)
            slab(f"console_{side}_{z}",(side*4.85,1.05,z),(.80,.24,1.40),"edge",.04)
            slab(f"console_screen_{side}_{z}",(side*4.85,1.18,z),(.58,.015,.86),"display",.018)
            for mark in range(4):
                slab(f"console_tick_{side}_{z}_{mark}",(side*4.85,1.192,z-.24+mark*.14),(.36,.006,.012),"cool",.002)
    for z in (-3.1,-.7,1.7,4.1):
        slab(f"ceiling_panel_{z}",(0,5.86,z),(7.7,.22,2.28),"edge",.04)
        for side in (-1,1):
            slab(f"ceiling_inset_{side}_{z}",(side*2.95,5.73,z),(.54,.025,1.55),"inset",.01)
            slab(f"ceiling_light_{side}_{z}",(side*2.95,5.70,z),(.026,.018,1.15),"cool",.004)
    # Small collar fasteners and sill louvers provide scale without cluttering the view.
    for side in (-1,1):
        for y in (.55,1.25,1.95,2.65,3.35):
            slab(f"frame_lock_{side}_{y}",(side*5.10,y,-5.28),(.24,.11,.10),"alloy",.018)
    for x in np.linspace(-4.8,4.8,33):
        slab(f"sill_vent_{x:.2f}",(float(x),.316,-5.84),(.12,.012,.28),"inset",.005)

    planet_mat = material("planet_"+detail,(.09,.15,.19),1,0,.23)
    node = planet_mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = texture
    shader = planet_mat.node_tree.nodes.get("Principled BSDF")
    planet_mat.node_tree.links.new(node.outputs["Color"],shader.inputs["Base Color"])
    planet_mat.node_tree.links.new(node.outputs["Color"],shader.inputs["Emission Color"])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128 if detail=="high" else 96,
        ring_count=64 if detail=="high" else 48, radius=11.0, location=xyz((13,12,-69)))
    planet = bpy.context.object
    planet.name = "observatory_distant_planet"
    planet.data.name = planet.name
    planet.rotation_euler = (.17,-.25,.7)
    planet.data.materials.append(planet_mat)
    for polygon in planet.data.polygons:
        polygon.use_smooth = True
    # Sparse stars are actual tiny octahedra, merged into one draw call.
    rng = random.Random(712026)
    vertices, faces = [], []
    for i in range(116):
        x,y,z = rng.uniform(-110,110),rng.uniform(-20,85),rng.uniform(-150,-125)
        radius = rng.uniform(.035,.090)
        center = xyz((x,y,z))
        offset = len(vertices)
        vertices.extend([tuple(center + Vector(delta)*radius) for delta in
                         ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1))])
        faces.extend([tuple(offset+j for j in face) for face in
                      ((0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5))])
    mesh=bpy.data.meshes.new("observatory_starfield")
    mesh.from_pydata(vertices,[],faces)
    stars=bpy.data.objects.new("observatory_starfield",mesh)
    bpy.context.collection.objects.link(stars)
    mesh.materials.append(mats["star"])
    objects=[obj for obj in bpy.context.scene.objects if obj.type=="MESH"]
    triangulate(objects)
    for obj in objects:
        obj.parent=root
    bpy.context.view_layer.update()
    stats = mesh_stats(objects)
    # The keep-out test is conservative and checks each authored component before batching.
    violations=[]
    for obj in objects:
        points=[obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        points=[(p.x,p.z,-p.y) for p in points]
        lo=[min(p[i] for p in points) for i in range(3)]
        hi=[max(p[i] for p in points) for i in range(3)]
        if all(hi[i] > (-2,.4,-4)[i] and lo[i] < (2,2.8,-.5)[i] for i in range(3)):
            violations.append(obj.name)
    assert not violations, violations
    stats["terminalVolumeIntersections"] = violations
    if detail=="low":
        groups=[(mat,[obj for obj in objects if obj.data.materials[0] == mat])
                for mat in [*mats.values(),planet_mat]]
        for mat,group in groups:
            if group:
                select_only(group)
                if len(group)>1:
                    bpy.ops.object.join()
                merged=bpy.context.object
                merged.name=mat.name.removesuffix("_low")+"_mesh"
                merged.data.name=merged.name
                merged.parent=root
        bpy.context.view_layer.update()
    return root,stats


def preview_rig() -> None:
    scene=bpy.context.scene
    scene.render.engine="CYCLES"
    scene.cycles.device="CPU"
    scene.cycles.samples=12
    scene.cycles.use_denoising=True
    scene.render.resolution_x=960
    scene.render.resolution_y=600
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.use_stamp=False
    if scene.world is None:
        scene.world=bpy.data.worlds.new("observatory_preview_world")
    scene.world.use_nodes=True
    scene.world.node_tree.nodes.get("Background").inputs["Color"].default_value=(.00005,.00008,.00015,1)
    scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value=1
    scene.view_settings.view_transform="AgX"
    for name,pos,color,energy,size in (
        ("key",(0,4,-2),(.40,.62,1.0),850,7),
        ("fill",(0,2,3),(.22,.38,.60),650,6),
        ("window",(0,4,-12),(.43,.63,.78),1200,8),
    ):
        light=bpy.data.lights.new("observatory_preview_"+name,"AREA")
        light.energy,light.color,light.shape,light.size=energy,color,"DISK",size
        obj=bpy.data.objects.new(light.name,light)
        scene.collection.objects.link(obj)
        obj.location=xyz(pos)
        obj.rotation_euler=(xyz((0,1,-3))-obj.location).to_track_quat("-Z","Y").to_euler()
    light=bpy.data.lights.new("observatory_preview_sun","SUN")
    light.energy=2
    light.angle=.05
    obj=bpy.data.objects.new(light.name,light)
    scene.collection.objects.link(obj)
    obj.rotation_euler=(.4,-.55,-.5)
    data=bpy.data.cameras.new("observatory_preview_camera")
    camera=bpy.data.objects.new(data.name,data)
    scene.collection.objects.link(camera)
    scene.camera=camera
    camera.location=xyz((0,1.6,1.0))
    camera.rotation_euler=(xyz((0,2,-10))-camera.location).to_track_quat("-Z","Y").to_euler()
    data.lens=21
    data.clip_end=300
    bpy.context.view_layer.update()


def render(name: str) -> None:
    bpy.context.scene.render.filepath=str(OUT / "previews" / (name+".png"))
    bpy.ops.render.render(write_still=True)


def main() -> None:
    path=OUT / "staging/observatory.glb"
    if "--verify-only" in ARGS:
        print(json.dumps(validate_glb(path),indent=2))
        return
    for directory in (OUT,OUT/"staging",OUT/"maps",OUT/"previews"):
        directory.mkdir(parents=True,exist_ok=True)
    bpy.context.preferences.filepaths.save_version=0
    image=planet_map()
    root,high=build("high",image)
    preview_rig()
    save_source(OUT/"observatory-high.blend")
    if "--no-render" not in ARGS:
        render("high-eye")
    root,low=build("low",image)
    preview_rig()
    save_source(OUT/"observatory-low.blend")
    if "--no-render" not in ARGS:
        render("low-eye")
        camera=bpy.context.scene.camera
        camera.location=xyz((1.0,1.75,4.5))
        camera.rotation_euler=(xyz((-1,2.0,-6))-camera.location).to_track_quat("-Z","Y").to_euler()
        camera.data.lens=18
        render("low-interior")
    meshes=[obj for obj in root.children if obj.type=="MESH"]
    select_only([root,*meshes])
    bpy.ops.export_scene.gltf(filepath=str(path),export_format="GLB",use_selection=True,
        use_active_scene=True,export_yup=True,export_apply=True,export_extras=True,
        export_cameras=False,export_lights=False,export_texcoords=True,export_normals=True,
        export_materials="EXPORT",export_image_format="AUTO")
    canonicalize_glb(path)
    exported=validate_glb(path)
    expected=mesh_stats(meshes)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    imported=mesh_stats(list(bpy.context.scene.objects))
    assert imported["triangles"] == exported["triangles"] == expected["triangles"]
    assert len([obj for obj in bpy.context.scene.objects if not obj.parent])==1
    assert bpy.data.objects.get("observatory") is not None
    for kind in ("min","max"):
        assert max(abs(a-b) for a,b in zip(expected["bounds"][kind],imported["bounds"][kind]))<.001
    for loaded in bpy.data.images:
        if loaded.type=="IMAGE":
            assert max(loaded.size)<=2048
    if "--no-render" not in ARGS:
        preview_rig()
        render("reimport-eye")
    files=[OUT/"observatory-high.blend",OUT/"observatory-low.blend",path,OUT/"maps/planet-basecolor.png",
           Path(__file__),Path(__file__).with_name("observatory_lib.py")]
    report={
        "pieceId":"observatory","version":1,"route":"scripted","blender":bpy.app.version_string,
        "authoringAgent":{"harness":"Codex","model":"gpt-6-astra"},
        "license":"Original project-authored geometry and procedural color map. MIT project default. No external assets.",
        "coordinateFrame":{"units":"metres","up":"+Y","forward":"-Z","origin":[0,0,0],
                           "eye":[0,1.6,0],"planetCenter":[13,12,-69],"planetRadius":11},
        "high":high,"lowBeforeBatching":low,"exported":exported,"reimport":imported,
        "texture":{"role":"baseColor and emissive color","size":[2048,1024],"transfer":"sRGB",
                   "method":"Deterministic analytic equirectangular color field, materialized to PNG. No Blender-only shader at runtime.",
                   "decodedBaseBytes":2048*1024*4,"normalOrORMMaps":"Not used. Geometry retains bevels, PBR metallic and roughness are scalar constants."},
        "lods":{"count":1,"reason":"Single static background comfortably below triangle cap. No additional LOD required by project contract."},
        "determinism":{"method":"Canonical cyclic triangle indices and sorted triangles; UVs quantized to 1e-6 to remove exporter float roundoff. Verify two fresh process GLB hashes.",
                       "check":"See reproducibility.json for independent build comparison."},
        "render":{"backend":"Cycles CPU","samples":12,"dimensions":[960,600],"timingClaim":False,
                  "cameraPosition":[0,1.6,1],"cameraTarget":[0,2,-10],"lensMm":21},
        "validation":{"pass":True,"checks":["GLB parses","single stable root","triangle budget","draw-call budget",
            "material budget","embedded textures","texture dimension budget","byte budget","no exported lights or cameras",
            "finite transforms","clean Blender reimport","reimport bounds within 1 mm","terminal volume clear"]},
        "approval":{"concept":"Recorded by root in docs/blender-kit-project.md","ownerVisual":"pending",
                    "runtimeQuest":"pending root integration and real-device review"},
        "files":[{"path":str(file.relative_to(REPO)),"sha256":sha256(file),"bytes":file.stat().st_size} for file in files],
    }
    (OUT/"report.json").write_text(json.dumps(report,indent=2)+"\n")
    print("OBSERVATORY_VALIDATED "+json.dumps(exported,sort_keys=True))


if __name__=="__main__":
    main()
