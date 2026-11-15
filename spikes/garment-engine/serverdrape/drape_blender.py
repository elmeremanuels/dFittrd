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
- Wear mode (`--wear navel`, POM v2, write-up section 9; founder answer of 15 Nov 2026: every skirt is worn just below
  the navel, pull-on elastic, gathered directly into the band). The band is then PLACED, not simulated: its particles
  are pinned on rings round the body at the wear level (wear_rule.py: band top edge 2 cm under the body's navel
  landmark, girth = the body's girth there clamped to the tape's [relaxed, stretched]); there is no band force and no
  shrink. A body larger than the stretched limit is NOT draped (the JSON says "cannot be worn"). The rest geometry's
  top edge (pom_rest.py --profile tube | cone) is longer than the band: the start shape is the developable rest shape
  with the top edge at the wear level, and the pinned particles are moved (an animated shape key, frames 1-24) onto the
  band rings, the seam ring laid in radial folds that take up the extra length (wear_rule.pleated_ring). What the
  cloth does below the seam is the simulation's output. `--massscale` multiplies the particle mass (fabric weight).
  The four band rings above the seam are NOT a model of the band: they are the panel's mesh rings (rest length = the
  fabric's 112-128 cm) pinned as smooth rings on the body (17-31 % shorter, no folds), the same for every size on one
  body. Nothing simulated depends on them (pinned particles do not move); they are only what the render draws as the
  band. `fabricStrain` below excludes them.
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
import wear_rule  # noqa: E402

PIN_FRAMES = (1, 24)  # wear mode: the pinned band moves from the start shape onto the body over these frames

MANNEQUIN_HIP_Y = 87.36  # packages/mannequin morphHeights.hip, shape M
TENSION_BELOW_HIP_CM = 12.0  # restmode graded: the tension zone reaches this far below the body's hip line
# Cloth presets (`--cloth`). Both are ASSUMED, not calibrated to the fabric (stage 7 calibration is open).
# - default: the first runs' values: the physical particle mass (about 2.8e-5 kg) against stiffnesses and an air drag
#   of the order of Blender's presets, which are tuned for 0.15-0.3 kg per particle. In Blender's cloth every force is
#   proportional to one of these constants, so only their RATIO to the mass matters: `default` is a cloth four orders
#   stiffer and more air-damped per unit weight than Blender's silk. It cannot fold under its own weight (the "stiff
#   tubes" of the first write-up) and creeps instead of falling.
# - viscose-soft (13 Nov 2026, for the POM rest geometry): viscose challis 165 gsm, a fluid, light woven. Rationale:
#   run the cloth in the regime Blender's own fabric presets are tuned for and pick the drapiest one that does not
#   stretch: Silk's mass (0.15), bending (0.05), shear and compression (5) and air drag (1); Cotton's tension (15) and
#   damping (5), because a woven viscose does not grow under its own weight (bundle stretchPct 1.5) and the damping
#   settles the hem sooner. The fabric's 165 gsm does NOT enter this preset (review finding, 14 Nov 2026): the
#   particle mass is the preset's 0.15 (scaled by the size's fabric area per particle against `massRefAreaCm2`, so
#   every size and mesh has the same simulated weight per unit area), and the band force is a multiple of that
#   SIMULATED weight, so a heavier or lighter fabric would drape identically. "Viscose 165 gsm" is met only by the
#   choice of preset. The band's tension is set so that pulling it to its MEASURED stretched girth takes
#   `bandLimitForceOverWeight` x the skirt's weight (ASSUMED 3; for the real 0.27-0.31 kg skirt that would be about
#   8-9 N, an ordinary waistband elastic; not measured; override with --bandforce), so a band that stretches further
#   is softer, as in band_model.py. Gravity is switched on after the band has contracted (frames `ramp`): the POM rest
#   shape starts with the band at the fabric's girth, wider than the waist, and would fall before the band grips.
CLOTH = {
    "default": {"mass": None, "tension": 10.0, "compression": 10.0, "shear": 5.0, "bending": 0.005, "damping": None, "ramp": None,
                "airDamping": 1.0, "bandLimitForceOverWeight": None, "massRefAreaCm2": None},
    "viscose-soft": {"mass": 0.15, "tension": 15.0, "compression": 5.0, "shear": 5.0, "bending": 0.05, "damping": 5.0, "ramp": [10, 30],
                     "airDamping": 1.0, "bandLimitForceOverWeight": 3.0, "massRefAreaCm2": 1.44},
}
CM = 0.01


def args() -> dict:
    a = sys.argv[sys.argv.index("--") + 1:]
    out = {"frames": "96", "band": "W-6", "json": None, "quality": "10", "mass": "physical", "bending": None, "cloth": "default",
           "pushout": "0.8", "restmode": "pushed", "model": None, "tensionfloor": "0.9", "floor": "0", "wear": "none", "massscale": "1", "clearance": None}
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
    # --floor: height of the floor in cm (default 0, the soles). A negative value stands the body on a plinth, so a
    # hem longer than the leg hangs free instead of crumpling on the floor (for hem measurements).
    floor_z = float(a["floor"]) * CM
    floor = mesh_object("floor", np.array([[-1.5, -1.5, floor_z], [1.5, -1.5, floor_z], [1.5, 1.5, floor_z], [-1.5, 1.5, floor_z]], float), np.array([[0, 1, 2], [0, 2, 3]]))
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
    bm = band_model.load(a["model"])
    girth = band_model.band_girth(bm, a["band"], size)
    wear = None
    if a["wear"] == "navel":
        # Placement rule: the band's top edge sits just below the navel landmark; nothing about it is simulated.
        sections = wear_rule.BodySections(bv, bf, arm)
        wear = wear_rule.wear_level(body_meta["achieved"]["navelY"])
        dy = wear["bandTopY"] - float(rest[:, 1].max())
        wear["fit"] = wear_rule.band_fit(sections.girth(wear["bandMidY"]), girth["relaxedCm"], girth["stretchedCm"])
        widest, widest_y = sections.widest(wear["seamY"], body_meta["rings"]["crotchY"])
        wear["pullOn"] = {**wear_rule.pull_on(widest, girth["stretchedCm"]), "widestAtY": round(widest_y, 1),
                          "range": "wear level down to the crotch (below it the legs' stance sets the hull, not the body)"}
        wear["bodyHipY"] = body_meta["achieved"]["hipY"]
        if not wear["fit"]["wearable"]:
            res = {"body": body_id, "bodyLabel": body_meta["label"], "t": body_meta["t"], "size": size, "status": "cannot be worn",
                   "wear": wear, "band": {**girth, "variant": a["band"]},
                   "config": {**band_model.drape_key(girth, float(a["pushout"]), a["restmode"], 0.0, a["cloth"], {}), "wear": "navel",
                              "profile": meta.get("profile", "v1")}}
            if a.get("json"):
                json.dump(res, open(a["json"], "w"), indent=1)
            print("RESULT " + json.dumps(res))
            return
    else:
        dy = body_meta["achieved"]["hipY"] - MANNEQUIN_HIP_Y
    rest[:, 1] += dy
    pushout = float(a["pushout"]) * CM
    restmode = a["restmode"]
    assert restmode in ("pushed", "graded", "gradedall"), restmode
    floor = float(a["tensionfloor"]) if restmode == "graded" else 0.0
    preset = dict(CLOTH[a["cloth"]])
    if a["bending"] is not None:
        preset["bending"] = float(a["bending"])
    overrides = {}  # experiment overrides; part of the drape cache key (band_model.drape_key)
    if a.get("air"):
        preset["airDamping"] = overrides["air"] = float(a["air"])
    if a.get("bandforce"):  # override the ASSUMED band force (x the skirt's weight at the stretched girth)
        preset["bandLimitForceOverWeight"] = overrides["bandForce"] = float(a["bandforce"])
    if float(a["floor"]) != 0.0:
        overrides["floorCm"] = float(a["floor"])
    if a.get("ramp"):  # gravity ramp frames "start,end": a later ramp lets the band contract onto the body first
        preset["ramp"] = [int(x) for x in a["ramp"].split(",")]
        overrides["rampStart"], overrides["rampEnd"] = preset["ramp"]
    if float(a["massscale"]) != 1.0:
        overrides["massScale"] = float(a["massscale"])
    # --clearance (wear mode): the pinned rings' distance from the body in cm instead of wear_rule.CLEARANCE_CM. Only
    # for the sensitivity run of section 9.5: how far the imposed seam ring carries into the "simulated" hip hull.
    clearance = wear_rule.CLEARANCE_CM
    if a["clearance"] is not None:
        clearance = overrides["clearanceCm"] = float(a["clearance"])
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
    if wear:
        scale = np.ones(len(rest))  # the band is pinned at its girth: no shrink
        # Pin targets. Band rings above the seam: smooth rings CLEARANCE_CM off the body's section hull at their own
        # height (further off when the body is smaller than the relaxed band: loose). Seam ring (the lowest band
        # ring): the fabric's top edge, laid in folds that take up its extra length.
        import pom_rest
        rs, rn = meta["rings"]["start"], meta["rings"]["size"]
        band_rings = [kk for kk in range(len(rs)) if band[rs[kk]]]
        target = rest.copy()
        relaxed = girth["relaxedCm"]
        seam = None
        for kk in band_rings:
            sl = slice(rs[kk], rs[kk] + rn[kk])
            y = float(rest[sl, 1].mean())
            hull = sections.hull(y)
            delta = clearance + max(0.0, (relaxed - wear_rule.perimeter(hull)) / (2 * np.pi))
            frac = pom_rest.ring_fractions(kk, rn[kk])
            if kk == band_rings[-1]:
                fabric = wear_rule.ring_length(to_blender(rest[sl])[:, :2]) / CM
                seam = wear_rule.pleated_ring(hull, delta, frac, fabric, max(int(round(rn[kk] / wear_rule.PARTICLES_PER_FOLD)), 1))
                xz = seam.pop("points")
                seam.update({"fabricTopEdgeCm": round(fabric, 2), "bodyGirthAtSeamCm": round(wear_rule.perimeter(hull), 1),
                             "particles": int(rn[kk]), "y": round(y, 2),
                             "gatherRatioSimulated": round(fabric / seam["centreGirthCm"], 3),
                             "gatherRatioOnBand": round(fabric / wear["fit"]["bandGirthCm"], 3)})
            else:
                xz = wear_rule.smooth_ring(hull, delta, frac)
            target[sl, 0], target[sl, 2] = xz[:, 0], xz[:, 1]
        wear["seam"] = seam
        wear["clearanceCm"] = clearance
        garment.shape_key_add(name="Basis")
        worn = garment.shape_key_add(name="worn")
        tb = to_blender(target)
        for i in np.nonzero(band)[0]:
            worn.data[int(i)].co = tb[i].tolist()
        for fr, v in ((PIN_FRAMES[0], 0.0), (PIN_FRAMES[1], 1.0)):
            worn.value = v
            worn.keyframe_insert("value", frame=fr)
        pin = garment.vertex_groups.new(name="pin")
        pin.add([int(i) for i in np.nonzero(band)[0]], 1.0, "REPLACE")
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
    s.mass = preset["mass"] or (area * meta["weightGsm"] / 1000.0 / len(rest) if a["mass"] == "physical" else 0.15)
    if preset["mass"] and preset["massRefAreaCm2"]:  # the same simulated weight per unit area for every size and mesh
        s.mass = preset["mass"] * (area * 1e4 / len(rest)) / preset["massRefAreaCm2"]
    s.mass *= float(a["massscale"])  # fabric weight relative to the preset's (stiffnesses unchanged)
    s.air_damping = preset["airDamping"]
    if wear:
        s.vertex_group_mass = "pin"
    else:
        s.vertex_group_shrink = "shrink"
    s.shrink_min = 0.0
    s.shrink_max = 1.0
    # Viscose challis (drape 0.85): between Blender's silk (5) and cotton (15) presets. ASSUMED mapping, not calibrated.
    fabric_tension = preset["tension"]
    elastic = fabric_tension * girth["elasticToFabricStiffness"]
    if preset["bandLimitForceOverWeight"] and not wear:
        # Hoop tension of the band at strain e (Blender: spring force = stiffness / mean spring length x elongation;
        # gravity force = 0.001 x mass x g): T(e) = elastic x e x R, R = sum over band edges of L^2 cos^4(angle to the
        # horizontal) / (girth x mean spring length). Solve T(stretchRatio - 1) = factor x weight.
        sm = to_blender(rest)
        e_all = np.unique(np.sort(np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]]), axis=1), axis=0)
        d_all = sm[e_all[:, 0]] - sm[e_all[:, 1]]
        l_all = np.linalg.norm(d_all, axis=1)
        inb = band[e_all].all(1)
        cos2 = 1.0 - (d_all[inb, 2] / l_all[inb]) ** 2
        r_band = float((l_all[inb] ** 2 * cos2 ** 2).sum() / (srow["bandGradedGirthCm"] * CM * l_all.mean()))
        weight = 0.001 * s.mass * len(rest) * 9.81
        elastic = preset["bandLimitForceOverWeight"] * weight / (r_band * (girth["stretchRatio"] - 1.0))
    comp = preset["compression"]
    if wear:  # no band spring: every unpinned spring is fabric
        elastic = fabric_tension
        s.tension_stiffness = s.tension_stiffness_max = fabric_tension
        s.compression_stiffness = s.compression_stiffness_max = comp
    elif elastic <= fabric_tension:
        s.tension_stiffness = elastic
        s.tension_stiffness_max = fabric_tension
        s.compression_stiffness = min(elastic, comp)
        s.compression_stiffness_max = comp
        s.vertex_group_structural_stiffness = "fabric"
    else:  # a band stiffer than the (softened) fabric: Blender only interpolates upwards, so the group is the band
        bg = garment.vertex_groups.new(name="bandgroup")
        bg.add([int(i) for i in np.nonzero(band)[0]], 1.0, "REPLACE")
        s.tension_stiffness = fabric_tension
        s.tension_stiffness_max = elastic
        s.compression_stiffness = comp
        s.compression_stiffness_max = max(comp, elastic)
        s.vertex_group_structural_stiffness = "bandgroup"
    s.shear_stiffness = preset["shear"] if wear else min(1.0, preset["shear"])
    s.shear_stiffness_max = preset["shear"]
    if not wear:
        s.vertex_group_shear_stiffness = "fabric"
    s.bending_stiffness = preset["bending"]
    if preset["damping"] is not None:
        s.tension_damping = s.compression_damping = s.shear_damping = preset["damping"]
    if preset["ramp"]:
        # Gravity off while the band contracts onto the body, then ramped on (animated, so the cache is not reset).
        for fr, w in ((1, 0.0), (preset["ramp"][0], 0.0), (preset["ramp"][1], 1.0)):
            s.effector_weights.gravity = w
            s.effector_weights.keyframe_insert("gravity", frame=fr)
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
    hem_edge = rest[:, 1] < rest[:, 1].min() + 0.5  # the bottom ring(s): its hull is traced to show the settle noise
    hem_trace = []
    for f in range(1, frames + 1):
        scene.frame_set(f)
        ev = garment.evaluated_get(bpy.context.evaluated_depsgraph_get())
        ev.data.vertices.foreach_get("co", co)
        cur = co.reshape(-1, 3).astype(np.float64)
        if prev is not None and f % 4 == 0:
            trace.append([f, round(float(np.linalg.norm(cur - prev, axis=1).max() / CM), 3), round(float(np.linalg.norm(cur - prev, axis=1).mean() / CM), 4), round(float(np.percentile(cur[:, 2], 2) / CM), 2)])
            if os.environ.get("DRAPE_DEBUG"):
                print("TRACE", trace[-1], "gravity weight", ev.modifiers["cloth"].settings.effector_weights.gravity, flush=True)
        if f > frames - 24 and hem_edge.sum() >= 8:
            hem_trace.append(round(hull_perimeter(cur[hem_edge][:, :2]) / CM, 1))
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
    # Fabric strain: settled / start edge lengths outside the band (the start shape is the rest shape there).
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    e = e[~band[e].any(1)]
    l0 = np.linalg.norm(start[e[:, 0]] - start[e[:, 1]], axis=1)
    l1 = np.linalg.norm(prev[e[:, 0]] - prev[e[:, 1]], axis=1)
    strain = l1 / l0 - 1
    ring = final[band & (final[:, 1] > np.percentile(top[:, 1], 50))]
    band_girth = hull_perimeter(ring[:, [0, 2]])
    res = {
        "body": body_id,
        "bodyLabel": body_meta["label"],
        "t": body_meta["t"],
        "size": size,
        "band": {**girth, "variant": a["band"], "gradedCm": srow["bandGradedGirthCm"], "restScale": round(k, 4), "settledGirthCm": round(band_girth, 1), "settledMeanY": round(band_y, 2), "startMeanY": round(float(rest[band][:, 1].mean()), 2), "strainVsRelaxed": round(band_girth / girth["relaxedCm"] - 1, 3), "pastStretched": band_girth > girth["stretchedCm"]},
        "dyCm": round(dy, 2),
        "config": {**band_model.drape_key(girth, float(a["pushout"]), restmode, floor, a["cloth"], overrides),
                   **({"wear": "navel", "profile": meta.get("profile", "v1")} if wear else {})},
        "status": "draped",
        "wear": wear,
        "cloth": {"preset": a["cloth"], **preset, "bandTension": round(float(elastic), 4),
                  "simulatedWeightUnits": round(0.001 * s.mass * len(rest) * 9.81, 4), "realWeightAt165GsmN": round(area * meta["weightGsm"] / 1000.0 * 9.81, 3)},
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
        "fabricStrain": {"mean": round(float(strain.mean()), 4), "p5": round(float(np.percentile(strain, 5)), 4), "p95": round(float(np.percentile(strain, 95)), 4)},
        "insideBody": inside,
        "insideDepthCmP95": round(float(np.percentile(depth, 95)), 2) if depth else 0.0,
        "settle": trace[-6:],
        "settleUnit": "cm per frame (1/24 s), sampled every 4th frame: [frame, max, mean, 2nd percentile height]",
        "hemEdgeHullLast24FramesCm": {"min": min(hem_trace), "max": max(hem_trace), "mean": round(float(np.mean(hem_trace)), 1)} if hem_trace else None,
        "settleFull": trace if a["cloth"] != "default" else None,
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
