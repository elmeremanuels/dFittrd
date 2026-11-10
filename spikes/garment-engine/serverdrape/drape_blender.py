"""R2 spike: drape one graded size of the skirt on one Anny body with Blender cloth (server side only).

Blender 4.2 LTS, headless: blender -b --factory-startup -P drape_blender.py -- --body B.obj --rest DIR --size 12
  --band W-6 --out OUT.bin [--frames 96] [--json OUT.json]
Blender is GPL and runs here as a separate server-side tool; nothing of it is bundled or shipped.

Method (docs/research/step3-serverdrape-spike.md):
- Body: the Anny OBJ (mannequin frame, cm) as a collision object (friction 10, outer thickness 3 mm); a floor at y = 0.
- Rest geometry: the graded mesh of the size (export-rest.ts), moved up by (body hip height - mannequin hip height) so
  it sits on this body where it sat on mannequin M. The waistband particles (top 4 cm) get shorter rest
  lengths (Blender's per-vertex shrink, isotropic: the 4 cm band also gets shorter by the same factor) so the band's
  rest girth is the band model's relaxed girth (band-model.json: measured, or an ASSUMED variant);
  the fabric below keeps its graded girth, so a band shorter than the fabric gathers it. The band is softer than the
  fabric (structural stiffness vertex group; the ratio is assumed in band-model.json).
- Start shape: the rest geometry pushed radially out of the body (ray from outside towards the vertical axis, arms
  ignored) plus `--pushout` cm (default 0.8), so no particle starts inside. Blender builds the springs from this start
  shape. Two rest modes (`--restmode`):
  * `pushed` (the first run's mode): the springs keep the pushed lengths, so a size smaller than the body starts at the
    body's girth + push-out with no tension (the push-out offset then sets that size's girth), and the band shrink acts
    on the pushed band girth.
  * `graded`: every pushed particle in the hip/waist zone (rest height above the body's hip - TENSION_BELOW_HIP_CM)
    also gets a per-vertex shrink max(r_rest / r_start, `--tensionfloor`), so the springs return towards the graded rest
    lengths: a size smaller than the body is under tension there and the push-out offset drops out. Blender's shrink is
    isotropic, so the vertical springs at that particle shorten by the same factor (a side effect: tight zones also
    pull up). The zone and the floor exist because the rest geometry is a reconstructed drape, not a pattern: with
    every pushed particle restored and no floor ("gradedall") the legs (A-pose) and the inward-turned hem pushed
    particles out by up to 1.9x, and restoring that pulled the AU 8 skirt 18 cm down the body. A rest shape key would be the exact tool, but Blender 4.2 ignores `rest_shape_key` (tested
    again: a grid with a half-size rest key falls bit-identical to one without).
  The band then contracts onto the body.
- Solver: Blender cloth (implicit integration, mass-spring with angular bending), self-collision on, body collision,
  gravity, no pins and no cling: the band is held only by its own elastic tension and friction.
- Output: settled positions (Float32 xyz, cm, mannequin frame) and a JSON with CPU seconds, settle trace and checks.
"""
import json
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import band_model  # noqa: E402

MANNEQUIN_HIP_Y = 87.36  # packages/mannequin morphHeights.hip, shape M
TENSION_BELOW_HIP_CM = 12.0  # restmode graded: the tension zone reaches this far below the body's hip line
CM = 0.01


def args() -> dict:
    a = sys.argv[sys.argv.index("--") + 1:]
    out = {"frames": "96", "band": "W-6", "json": None, "quality": "10", "mass": "physical", "bending": "0.005",
           "pushout": "0.8", "restmode": "pushed", "model": None, "tensionfloor": "0.9"}
    for i in range(0, len(a), 2):
        out[a[i].lstrip("-")] = a[i + 1]
    return out


def to_blender(p: np.ndarray) -> np.ndarray:
    """Mannequin (x, y up, z front) cm -> Blender (x, -z, y) m: a rotation about x, no mirror."""
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1) * CM


def from_blender(p: np.ndarray) -> np.ndarray:
    return np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1) / CM


def read_obj(path: str) -> tuple[np.ndarray, np.ndarray]:
    v, f = [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                f.append([int(x.split("/")[0]) - 1 for x in line.split()[1:4]])
    return np.array(v), np.array(f, dtype=np.int64)


def mesh_object(name: str, verts: np.ndarray, faces: np.ndarray) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def hull_perimeter(p: np.ndarray) -> float:
    p = p[np.lexsort((p[:, 1], p[:, 0]))]

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for q in p:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in p[::-1]:
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0:
            up.pop()
        up.append(q)
    h = np.array(lo[:-1] + up[:-1])
    return float(np.sum(np.linalg.norm(h - np.roll(h, 1, 0), axis=1)))


def main() -> None:
    a = args()
    t_wall = time.time()
    t_cpu = time.process_time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24

    # Body.
    bodies_json = json.load(open(os.path.join(os.path.dirname(a["body"]), "bodies.json")))
    body_id = os.path.basename(a["body"])[:-4]
    body_meta = next(b for b in bodies_json["bodies"] if b["id"] == body_id)
    bv, bf = read_obj(a["body"])
    arm = np.fromfile(os.path.join(os.path.dirname(a["body"]), "armmask.bin"), dtype=np.uint8).astype(bool)
    body = mesh_object("body", to_blender(bv), bf)
    col = body.modifiers.new("collision", "COLLISION")
    body.collision.thickness_outer = 0.003
    body.collision.thickness_inner = 0.02
    body.collision.cloth_friction = 10.0
    body.collision.damping = 0.5
    floor = mesh_object("floor", np.array([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], float), np.array([[0, 1, 2], [0, 2, 3]]))
    floor.modifiers.new("collision", "COLLISION")
    floor.collision.cloth_friction = 10.0
    torso_faces = bf[~arm[bf].any(1)]
    bvh_torso = BVHTree.FromPolygons([Vector(x) for x in to_blender(bv)], torso_faces.tolist())
    bvh_body = BVHTree.FromPolygons([Vector(x) for x in to_blender(bv)], bf.tolist())

    # Garment rest geometry.
    meta = json.load(open(os.path.join(a["rest"], "rest.json")))
    size = a["size"]
    srow = next(s for s in meta["sizes"] if s["size"] == size)
    rest = np.fromfile(os.path.join(a["rest"], srow["file"]), dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(os.path.join(a["rest"], "indices.bin"), dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    band = np.fromfile(os.path.join(a["rest"], "band.bin"), dtype=np.uint8).astype(bool)
    dy = body_meta["achieved"]["hipY"] - MANNEQUIN_HIP_Y
    rest[:, 1] += dy
    bm = band_model.load(a["model"])
    girth = band_model.band_girth(bm, a["band"], size)
    pushout = float(a["pushout"]) * CM
    restmode = a["restmode"]
    assert restmode in ("pushed", "graded", "gradedall"), restmode
    floor = float(a["tensionfloor"]) if restmode == "graded" else 0.0
    k = girth["relaxedCm"] / srow["bandGradedGirthCm"]

    # Start shape: pushed radially out of the body (torso and legs; arms ignored).
    start = to_blender(rest)
    pushed = 0
    ratio = np.ones(len(start))  # r_rest / r_start per particle (1 = not pushed)
    for i, p in enumerate(start):
        r = float(np.hypot(p[0], p[1]))
        if r < 1e-4:
            continue
        d = Vector((p[0] / r, p[1] / r, 0.0))
        o = Vector((d.x * 0.9, d.y * 0.9, p[2]))
        hit = bvh_torso.ray_cast(o, -d, 0.9)
        if hit[0] is None:
            continue
        rb = float(np.hypot(hit[0].x, hit[0].y)) + pushout
        if r < rb:
            start[i, 0] = d.x * rb
            start[i, 1] = d.y * rb
            ratio[i] = r / rb
            pushed += 1

    if a.get("dumpratio"):
        ratio.astype(np.float32).tofile(a["dumpratio"])
    garment = mesh_object("skirt", start, idx)
    for poly in garment.data.polygons:
        poly.use_smooth = True
    # The band's relaxed girth: Blender's per-vertex shrink (rest lengths x (1 - shrink)). A "rest shape key" was tried
    # first and Blender 4.2 ignored it (drapes with different band girths came out bit-identical), so it is not used.
    if restmode == "graded":
        zone = rest[:, 1] > body_meta["achieved"]["hipY"] - TENSION_BELOW_HIP_CM
        tens = np.where(zone, np.maximum(ratio, floor), 1.0)
    elif restmode == "gradedall":
        tens = ratio
    else:
        tens = np.ones(len(ratio))
    scale = np.where(band, k, 1.0) * tens
    shrink = garment.vertex_groups.new(name="shrink")
    for i in np.nonzero(scale < 1.0)[0]:
        shrink.add([int(i)], float(1.0 - scale[i]), "REPLACE")
    vg = garment.vertex_groups.new(name="fabric")
    vg.add([int(i) for i in np.nonzero(~band)[0]], 1.0, "REPLACE")

    # Rest area -> mass per particle (fabric gsm).
    tri = to_blender(rest)[idx]
    area = float(0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1).sum())
    cloth = garment.modifiers.new("cloth", "CLOTH")
    s = cloth.settings
    s.quality = int(a["quality"])
    # "physical": the fabric's gsm spread over the particles (~2.8e-5 kg each): against Blender's preset stiffnesses the
    # cloth then hardly sags (a stiff tube). "preset": Blender's silk preset vertex mass (0.15 kg), which its stiffness
    # presets are tuned against. Neither is calibrated to this fabric (stage 7 calibration is open).
    s.mass = area * meta["weightGsm"] / 1000.0 / len(rest) if a["mass"] == "physical" else 0.15
    s.air_damping = 1.0
    s.vertex_group_shrink = "shrink"
    s.shrink_min = 0.0
    s.shrink_max = 1.0
    # Viscose challis (drape 0.85): between Blender's silk (5) and cotton (15) presets. ASSUMED mapping, not calibrated.
    fabric_tension = 10.0
    elastic = fabric_tension * girth["elasticToFabricStiffness"]
    s.tension_stiffness = elastic
    s.tension_stiffness_max = fabric_tension
    s.compression_stiffness = elastic
    s.compression_stiffness_max = fabric_tension
    s.shear_stiffness = 1.0
    s.shear_stiffness_max = 5.0
    s.vertex_group_structural_stiffness = "fabric"
    s.vertex_group_shear_stiffness = "fabric"
    s.bending_stiffness = float(a["bending"])
    s.bending_model = "ANGULAR"
    cs = cloth.collision_settings
    cs.use_collision = True
    cs.distance_min = 0.003
    cs.collision_quality = 3
    cs.use_self_collision = True
    cs.self_distance_min = 0.002
    cs.self_friction = 5.0
    cs.friction = 5.0
    frames = int(a["frames"])
    cloth.point_cache.frame_start = 1
    cloth.point_cache.frame_end = frames
    scene.frame_start = 1
    scene.frame_end = frames

    prev = None
    trace = []
    t_sim = time.process_time()
    w_sim = time.time()
    co = np.zeros(len(rest) * 3, dtype=np.float32)
    for f in range(1, frames + 1):
        scene.frame_set(f)
        ev = garment.evaluated_get(bpy.context.evaluated_depsgraph_get())
        ev.data.vertices.foreach_get("co", co)
        cur = co.reshape(-1, 3).astype(np.float64)
        if prev is not None and f % 4 == 0:
            trace.append([f, round(float(np.linalg.norm(cur - prev, axis=1).max() / CM), 3), round(float(np.linalg.norm(cur - prev, axis=1).mean() / CM), 4)])
        prev = cur.copy()
    cpu_sim = time.process_time() - t_sim
    wall_sim = time.time() - w_sim

    final = from_blender(prev)
    final.astype(np.float32).tofile(a["out"])

    # Checks: particles inside the body, band height and girth, band strain against the band model.
    inside = 0
    depth = []
    for p in prev:
        loc, n, _, dist = bvh_body.find_nearest(Vector(p))
        if loc is not None and (Vector(p) - loc).dot(n) < 0:
            inside += 1
            depth.append(dist / CM)
    top = final[band]
    band_y = float(np.mean(top[:, 1]))
    ring = final[band & (final[:, 1] > np.percentile(top[:, 1], 50))]
    band_girth = hull_perimeter(ring[:, [0, 2]])
    res = {
        "body": body_id,
        "bodyLabel": body_meta["label"],
        "t": body_meta["t"],
        "size": size,
        "band": {**girth, "variant": a["band"], "gradedCm": srow["bandGradedGirthCm"], "restScale": round(k, 4), "settledGirthCm": round(band_girth, 1), "settledMeanY": round(band_y, 2), "startMeanY": round(float(rest[band][:, 1].mean()), 2), "strainVsRelaxed": round(band_girth / girth["relaxedCm"] - 1, 3), "pastStretched": band_girth > girth["stretchedCm"]},
        "dyCm": round(dy, 2),
        "config": band_model.drape_key(girth, float(a["pushout"]), restmode, floor),
        "tensionParticles": int((tens < 1.0).sum()),
        "pushedOut": pushed,
        "pushedRatioMin": round(float(ratio.min()), 3),
        "particles": len(rest),
        "triangles": len(idx),
        "frames": frames,
        "fps": 24,
        "quality": s.quality,
        "massPerParticleKg": s.mass,
        "massMode": a["mass"],
        "bendingStiffness": s.bending_stiffness,
        "insideBody": inside,
        "insideDepthCmP95": round(float(np.percentile(depth, 95)), 2) if depth else 0.0,
        "settle": trace[-6:],
        "cpuSecondsSim": round(cpu_sim, 1),
        "wallSecondsSim": round(wall_sim, 1),
        "cpuSecondsTotal": round(time.process_time() - t_cpu, 1),
        "wallSecondsTotal": round(time.time() - t_wall, 1),
        "blender": bpy.app.version_string,
        "threads": scene.render.threads,
    }
    if a.get("json"):
        json.dump(res, open(a["json"], "w"), indent=1)
    print("RESULT " + json.dumps(res))


main()
