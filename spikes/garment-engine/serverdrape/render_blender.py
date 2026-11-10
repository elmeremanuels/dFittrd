"""R2 spike: render draped skirts on Anny bodies side by side (Blender Cycles, CPU, headless). Review renders only.

blender -b --factory-startup -P render_blender.py -- --spec SPEC.json --out OUT.png
SPEC: {"items": [{"body": "x.obj", "garment": "y.bin", "indices": "indices.bin", "label": "AU 8"}, ...],
       "view": "front" | "side" | "back", "title": "...", "colour": "#A44B48", "width": 1500, "height": 900}
garment may be null (body only). Flat colour, no product texture (shop images stay out of the repo).
"""
import json
import sys

import bpy
import numpy as np
from mathutils import Vector

CM = 0.01


def args() -> dict:
    a = sys.argv[sys.argv.index("--") + 1:]
    return {a[i].lstrip("-"): a[i + 1] for i in range(0, len(a), 2)}


def to_blender(p: np.ndarray) -> np.ndarray:
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1) * CM


def read_obj(path: str):
    v, f = [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                f.append([int(x.split("/")[0]) - 1 for x in line.split()[1:4]])
    return np.array(v), np.array(f)


def obj(name, verts, faces, mat, dx):
    me = bpy.data.meshes.new(name)
    me.from_pydata((verts + np.array([dx, 0, 0])).tolist(), [], faces.tolist())
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def material(name, hexcol, rough=0.7, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    h = hexcol.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    b.inputs["Base Color"].default_value = (*[c ** 2.2 for c in rgb], 1)
    b.inputs["Roughness"].default_value = rough
    return m


def main():
    a = args()
    spec = json.load(open(a["spec"]))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = int(spec.get("samples", 24))
    sc.cycles.use_denoising = True
    sc.render.resolution_x = spec.get("width", 1500)
    sc.render.resolution_y = spec.get("height", 900)
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.93, 0.9, 0.86, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    sc.world = world
    skin = material("skin", "#BFB6AC", 0.6)
    cloth = material("cloth", spec.get("colour", "#A44B48"), 0.8)
    items = spec["items"]
    gap = spec.get("gapM", 0.75)
    n = len(items)
    rot = {"front": 0, "side": 90, "back": 180, "three": 30}[spec.get("view", "front")]
    for i, it in enumerate(items):
        dx = (i - (n - 1) / 2) * gap
        bv, bf = read_obj(it["body"])
        pb = to_blender(bv)
        if it.get("garment"):
            g = np.fromfile(it["garment"], dtype=np.float32).reshape(-1, 3).astype(np.float64)
            gi = np.fromfile(it["indices"], dtype=np.uint32).reshape(-1, 3).astype(np.int64)
            pg = to_blender(g)
        th = np.radians(rot)
        R = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]])
        obj(f"body{i}", pb @ R.T, bf, skin, dx)
        if it.get("garment"):
            obj(f"skirt{i}", pg @ R.T, gi, cloth, dx)
        # Label as text.
        bpy.ops.object.text_add(location=(dx - 0.12, 0.3, 1.86))
        t = bpy.context.object
        t.data.body = it.get("label", "")
        t.data.size = 0.07
        t.rotation_euler = (np.radians(90), 0, 0)
        t.data.materials.append(material(f"ink{i}", "#1A1612", 0.9))
    if spec.get("title"):
        bpy.ops.object.text_add(location=(-(n - 1) / 2 * gap - 0.3, 0.3, 1.98))
        t = bpy.context.object
        t.data.body = spec["title"]
        t.data.size = 0.055
        t.rotation_euler = (np.radians(90), 0, 0)
        t.data.materials.append(material("inkt", "#1A1612", 0.9))
    width = (n - 1) * gap + 0.9
    cam_d = spec.get("camDistanceM", max(4.6, width * 1.25))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    cam.location = (0, -cam_d, 1.0)
    cam.rotation_euler = (np.radians(90), 0, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    for loc, e in (((-2.5, -3.5, 3.5), 900), ((3, -2, 2), 400), ((0, 3, 3), 300)):
        L = bpy.data.objects.new("l", bpy.data.lights.new("l", "AREA"))
        L.data.energy = e
        L.data.size = 3
        L.location = loc
        L.rotation_euler = (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(L)
    floor = bpy.data.meshes.new("floor")
    floor.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new("floor", floor)
    floor.materials.append(material("floorm", "#E8E1D7", 0.9))
    sc.collection.objects.link(fo)
    sc.render.filepath = a["out"]
    bpy.ops.render.render(write_still=True)


main()
