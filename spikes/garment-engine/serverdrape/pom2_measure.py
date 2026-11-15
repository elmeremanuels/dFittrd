"""POM v2 measurements (write-up section 9). Pure numpy; no Blender.

python3 pom2_measure.py fit <root> [sizes] [bodyIds]        the wear rule and the pull-on check, no drape needed
python3 pom2_measure.py drapes <root> <set> <body:size,...> [--json OUT]   what the simulation gave
python3 pom2_measure.py blend <root> <set> <size> [heldOutBody]            device blend against the direct drape

Two kinds of numbers, kept apart in the output:
- IMPOSED (`imposed`): where the band sits, its girth, the lengths of the fabric's rings and meridians. The wear rule
  and pom_rest.py put them there; reading them back only shows that nothing stretched.
- SIMULATED (`simulated`): the hem's hull and extent, the silhouette (hull girth, front width, side depth) at the
  body's hip and knee and at the hem, the folds below the seam (how far the imposed gathers carry down), whether the
  cloth came to rest, particles inside the body.
At rest (REST_*): mean particle movement over the last 24 frames below 0.02 cm per frame (0.5 cm/s) and the largest
below 0.25 cm per frame. A stated threshold, not a physical law.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import band_model  # noqa: E402
import wear_rule  # noqa: E402
from pom_measure import slice_at  # noqa: E402

REST_MEAN, REST_MAX = 0.02, 0.25
FOLD_RINGS_BELOW_SEAM = (2, 5, 10, 16)  # ring intervals below the seam (about 2, 5.5, 11 cm; 16 = the tape's hip line)
PROV = {"measured": "measured", "interpolated": "INTERPOLATED", "extrapolated": "EXTRAPOLATED"}


def load_bodies(root: str) -> dict:
    return {b["id"]: b for b in json.load(open(os.path.join(root, "bodies", "bodies.json")))["bodies"]}


def sections(root: str, body_id: str) -> wear_rule.BodySections:
    v, f = wear_rule.read_obj(os.path.join(root, "bodies", body_id + ".obj"))
    arm = np.fromfile(os.path.join(root, "bodies", "armmask.bin"), dtype=np.uint8).astype(bool)
    return wear_rule.BodySections(v, f, arm)


def fit_row(root: str, body: dict, size: str, model: dict) -> dict:
    sec = sections(root, body["id"])
    lvl = wear_rule.wear_level(body["achieved"]["navelY"])
    g = band_model.band_girth(model, "measured", size)
    widest, at = sec.widest(lvl["seamY"], body["rings"]["crotchY"])
    return {"size": size, "provenance": PROV[g["source"].split(" ")[0]], "body": body["id"], "bodyLabel": body["label"],
            "bodyHipCm": body["achieved"]["hipCm"], "bodyWaistCm": body["achieved"]["waistCm"], **lvl,
            "fit": wear_rule.band_fit(sec.girth(lvl["bandMidY"]), g["relaxedCm"], g["stretchedCm"]),
            "pullOnHull": {**wear_rule.pull_on(widest, g["stretchedCm"]), "atY": round(at, 1)},
            "pullOnHip": wear_rule.pull_on(body["achieved"]["hipCm"], g["stretchedCm"])}


def fit(root: str, sizes: list[str], body_ids: list[str] | None) -> list[dict]:
    model = band_model.load()
    bodies = load_bodies(root)
    rows = [fit_row(root, bodies[b], s, model) for b in (body_ids or sorted(bodies, key=lambda k: bodies[k]["t"])) for s in sizes]
    for r in rows:
        f = r["fit"]
        how = {"stretched": f"stretched by {f.get('stretchedByCm')} cm", "relaxed": "holds relaxed", "loose": f"LOOSE by {f.get('looseByCm')} cm",
               "cannot be worn": f"CANNOT BE WORN (body {f.get('overLimitCm')} cm over the stretched limit)"}[f["status"]]
        print(f"AU {r['size']} [{r['provenance']}] on {r['bodyLabel']} (hip {r['bodyHipCm']}): body at the band {f['bodyGirthCm']} cm, band "
              f"{f['relaxedCm']}-{f['stretchedCm']}: {how}; pull-on: stretched {f['stretchedCm']} against hip {r['bodyHipCm']} "
              f"({r['pullOnHip']['marginCm']:+.1f}) / widest hull {r['pullOnHull']['widestGirthCm']} ({r['pullOnHull']['marginCm']:+.1f})")
    return rows


def extent(pos: np.ndarray, idx: np.ndarray, y: float) -> dict:
    """Hull girth, front width (x extent) and side depth (z extent) of the mesh's section at height y."""
    d = pos[idx][:, :, 1] - y
    cut = (d < 0).any(1) & ~(d < 0).all(1)
    pts = []
    for t, h in zip(pos[idx[cut]], d[cut]):
        for k in range(3):
            h0, h1 = h[k], h[(k + 1) % 3]
            if (h0 < 0) != (h1 < 0):
                pts.append(t[k] + h0 / (h0 - h1) * (t[(k + 1) % 3] - t[k]))
    if len(pts) < 3:
        return {"hull": None, "width": None, "depth": None}
    p = np.array(pts)[:, [0, 2]]
    return {"hull": round(wear_rule.perimeter(wear_rule.convex_hull(p)), 1), "width": round(float(np.ptp(p[:, 0])), 1),
            "depth": round(float(np.ptp(p[:, 1])), 1)}


def measure(root: str, dset: str, body_id: str, size: str) -> dict:
    meta = json.load(open(os.path.join(root, "rest", "rest.json")))
    body = load_bodies(root)[body_id]
    srow = next(s for s in meta["sizes"] if s["size"] == size)
    base = os.path.join(root, "drapes", dset, f"{body_id}__{size}")
    j = json.load(open(base + ".json"))
    out = {"size": size, "provenance": PROV[srow["provenance"]], "body": body_id, "bodyLabel": body["label"], "profile": meta.get("profile"),
           "status": j.get("status", "draped"), "wear": {k: v for k, v in j["wear"].items() if k != "seam"}, "seam": j["wear"].get("seam")}
    if out["status"] != "draped":
        return out
    idx = np.fromfile(os.path.join(root, "rest", "indices.bin"), dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    pos = np.fromfile(base + ".bin", dtype=np.float32).reshape(-1, 3).astype(np.float64)
    rs, rn = meta["rings"]["start"], meta["rings"]["size"]
    ring = [pos[a:a + n] for a, n in zip(rs, rn)]
    band = np.fromfile(os.path.join(root, "rest", "band.bin"), dtype=np.uint8).astype(bool)
    seam_k = max(k for k in range(len(rs)) if band[rs[k]])
    hem = ring[-1]
    tail = [t for t in j["settleFull"] if t[0] > j["frames"] - 24]
    mean_move, max_move = float(np.mean([t[2] for t in tail])), float(max(t[1] for t in tail))
    floor_cm = j["config"].get("floorCm", 0.0)
    out["imposed"] = {
        "bandTopY": j["wear"]["bandTopY"], "bandGirthCm": j["wear"]["fit"]["bandGirthCm"], "simulatedSeamCentreGirthCm": j["wear"]["seam"]["centreGirthCm"],
        "seamFolds": j["wear"]["seam"]["folds"], "seamFoldDepthCm": round(2 * j["wear"]["seam"]["amplitudeCm"], 2),
        "hipRingPathCm": round(wear_rule.ring_length(ring[meta["rings"]["hipRing"]]), 1), "hipTapeCm": srow["tape"]["hipCm"]["cm"],
        "hemRingPathCm": round(wear_rule.ring_length(hem), 1), "hemTapeCm": srow["tape"]["hemSweepCm"]["cm"],
        "fabricStrain": j["fabricStrain"],
    }
    out["simulated"] = {
        "hemHullCm": j["hemEdgeHullLast24FramesCm"], "hemY": round(float(hem[:, 1].mean()), 1), "hemMinY": round(float(pos[:, 1].min()), 1),
        "hemOnFloor": bool(pos[:, 1].min() < floor_cm + 2.5), "floorCm": floor_cm,
        "hem": {"hull": round(wear_rule.perimeter(wear_rule.convex_hull(hem[:, [0, 2]])), 1), "width": round(float(np.ptp(hem[:, 0])), 1),
                "depth": round(float(np.ptp(hem[:, 2])), 1)},
        "atBodyHip": extent(pos, idx, body["achieved"]["hipY"]), "atKnee": extent(pos, idx, body["rings"]["kneeY"]),
        "at15AboveHem": extent(pos, idx, float(hem[:, 1].mean()) + 15.0),
        "bodyHipCm": body["achieved"]["hipCm"],
        "foldsBelowSeam": {str(n): {"belowSeamCm": round(float(ring[seam_k][:, 1].mean() - ring[seam_k + n][:, 1].mean()), 1),
                                     **wear_rule.fold_count(ring[seam_k + n][:, [0, 2]])} for n in FOLD_RINGS_BELOW_SEAM},
        "movementLast24": {"meanCmPerFrame": round(mean_move, 4), "maxCmPerFrame": round(max_move, 3)},
        "atRest": bool(mean_move < REST_MEAN and max_move < REST_MAX),
        "insideBody": j["insideBody"], "insideDepthP95Cm": j["insideDepthCmP95"], "pushedOutAtStart": j["pushedOut"],
        "cpuS": j["cpuSecondsSim"], "wallS": j["wallSecondsSim"], "frames": j["frames"], "particles": j["particles"],
    }
    return out


def blend(root: str, dset: str, size: str, held: str = "t-0.40") -> dict:
    """Piecewise-linear blend along the body axis (what the device does with baked morph targets) against the direct
    drape on the held-out body. The band is pinned by rule on every body, so its error is the body-shape error of the
    rule's ring, not a drape error: reported with and without the band particles."""
    bodies = load_bodies(root)
    t = bodies[held]["t"]
    grid = sorted((b for b in bodies.values() if b["t"] in (-1.0, 0.0, 1.0)), key=lambda b: b["t"])
    lo = max((b for b in grid if b["t"] <= t), key=lambda b: b["t"])
    hi = min((b for b in grid if b["t"] >= t), key=lambda b: b["t"])
    w = (t - lo["t"]) / (hi["t"] - lo["t"])

    def load(b):
        return np.fromfile(os.path.join(root, "drapes", dset, f"{b}__{size}.bin"), dtype=np.float32).reshape(-1, 3).astype(np.float64)

    mix, direct = (1 - w) * load(lo["id"]) + w * load(hi["id"]), load(held)
    band = np.fromfile(os.path.join(root, "rest", "band.bin"), dtype=np.uint8).astype(bool)
    meta = json.load(open(os.path.join(root, "rest", "rest.json")))
    hem = slice(meta["rings"]["start"][-1], None)
    d = np.linalg.norm(mix - direct, axis=1)

    def hull(p):
        return round(wear_rule.perimeter(wear_rule.convex_hull(p[hem][:, [0, 2]])), 1)

    out = {"size": size, "between": [lo["id"], hi["id"]], "weightOfUpper": round(w, 2), "heldOut": held,
           "rmsCm": round(float(np.sqrt((d ** 2).mean())), 2), "p95Cm": round(float(np.percentile(d, 95)), 2), "maxCm": round(float(d.max()), 2),
           "rmsFabricCm": round(float(np.sqrt((d[~band] ** 2).mean())), 2), "rmsBandCm": round(float(np.sqrt((d[band] ** 2).mean())), 2),
           "hemHullBlendCm": hull(mix), "hemHullDirectCm": hull(direct),
           "hemRingPathBlendCm": round(wear_rule.ring_length(mix[hem]), 1), "hemRingPathDirectCm": round(wear_rule.ring_length(direct[hem]), 1)}
    print(json.dumps(out))
    return out


def main() -> None:
    argv = list(sys.argv[1:])
    out = None
    if "--json" in argv:
        i = argv.index("--json")
        out = argv[i + 1]
        del argv[i:i + 2]
    cmd, root = argv[0], argv[1]
    if cmd == "fit":
        rows = fit(root, (argv[2] if len(argv) > 2 else "8,10,12,14,16").split(","), argv[3].split(",") if len(argv) > 3 else None)
    elif cmd == "drapes":
        rows = [measure(root, argv[2], *p.split(":")) for p in argv[3].split(",")]
        for r in rows:
            print(json.dumps(r))
    elif cmd == "blend":
        rows = [blend(root, argv[2], argv[3], *(argv[4:5]))]
    else:
        raise SystemExit(__doc__)
    if out:
        json.dump(rows, open(out, "w"), indent=1)


if __name__ == "__main__":
    main()
