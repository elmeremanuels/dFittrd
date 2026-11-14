"""Measure draped skirts against the tape: hull girth AND path length of the cross-section (13 Nov 2026).

python3 pom_measure.py <root> <drapeSet> <bodyId> <sizes,...> [--json OUT.json]
<root> is a serverdrape output directory (bodies/, rest/, drapes/<set>/<body>__<size>.bin), for the reconstructed rest
geometry (out/serverdrape) or the POM one (out/serverdrape-pom).

On a body a 112-126 cm garment hip hangs in folds, so two numbers per cross-section:
- hull: the convex-hull perimeter of the slice (what a loose tape around the draped skirt, or the eye, sees);
- path: the length of the slice curve itself, folds included (the fabric that is there).
Slices (garment-relative, as relgirth.ts): hip = at the distance below the settled top edge at which the rest geometry
has its hip line (mannequin hip, y 87.36); hem15 = 15 cm above the settled bottom edge; hipBody = at the body's hip
height. For a POM rest geometry (rest.json kind "pom") also the material rings themselves, which are what the tape
measured on the flat garment: hipRing and hemRing (the ring of particles at the tape's hip line and at the hem edge):
ringPath = the length of that ring of fabric after draping, ringHull = its convex hull.
ringPath is NOT a result: pom_rest.py built that ring at exactly the tape girth and the cloth hardly stretches, so
ringPath = tape is imposed by the rest geometry (it is a sanity check that nothing stretched). The simulation's outputs
are the hulls, the band height and the silhouette: `front` gives the front-view width (x extent) of the draped skirt at
fractions of its settled length, for comparison with a front product photo (photo_silhouette below).
python3 pom_measure.py --photo-mask MASK.png   prints the same width / length profile of a garment mask (needs Pillow;
the shop's photo and its mask stay out of the repo).
Pure numpy; no Blender.
"""
import json
import os
import sys

import numpy as np

MANNEQUIN_HIP_Y = 87.36
HEM_ABOVE_CM = 15.0


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


def slice_at(pos: np.ndarray, idx: np.ndarray, y: float) -> dict:
    """Hull perimeter and path length (cm) of the mesh's cross-section at height y."""
    d = pos[idx][:, :, 1] - y                      # (T, 3) signed heights
    below = d < 0
    cut = below.any(1) & ~below.all(1)
    tri, dd = pos[idx[cut]], d[cut]
    a, b = [], []
    for t, h in zip(tri, dd):
        pts = []
        for k in range(3):
            h0, h1 = h[k], h[(k + 1) % 3]
            if (h0 < 0) != (h1 < 0):
                s = h0 / (h0 - h1)
                pts.append(t[k] + s * (t[(k + 1) % 3] - t[k]))
        a.append(pts[0])
        b.append(pts[1])
    if len(a) < 3:
        return {"hull": float("nan"), "path": float("nan")}
    a, b = np.array(a)[:, [0, 2]], np.array(b)[:, [0, 2]]
    return {"hull": round(hull_perimeter(np.concatenate([a, b])), 1), "path": round(float(np.linalg.norm(a - b, axis=1).sum()), 1)}


FRACTIONS = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)


def front_profile(pos: np.ndarray, idx: np.ndarray, top_y: float, hem_y: float) -> dict:
    """Front-view width (x extent, cm) of the draped mesh at fractions of its settled length (0 = top edge), and the
    same divided by that length (scale-free, comparable with a photo)."""
    length = top_y - hem_y
    out = {}
    for f in FRACTIONS:
        y = top_y - f * length
        d = pos[idx][:, :, 1] - y
        cut = (d < 0).any(1) != (d < 0).all(1)
        xs = []
        for t, h in zip(pos[idx[cut]], d[cut]):
            for k in range(3):
                h0, h1 = h[k], h[(k + 1) % 3]
                if (h0 < 0) != (h1 < 0):
                    xs.append(t[k][0] + h0 / (h0 - h1) * (t[(k + 1) % 3][0] - t[k][0]))
        w = max(xs) - min(xs) if xs else float("nan")
        out[str(f)] = {"widthCm": round(w, 1), "overLength": round(w / length, 3)}
    return out


def photo_silhouette(mask_path: str) -> dict:
    """Width / length of a front garment mask at the same fractions (pixels cancel). A perspective photo of a posed
    model: good to a few percent of the length, no better."""
    from PIL import Image
    m = np.array(Image.open(mask_path).convert("L")) > 127
    rows = np.nonzero(m.any(1))[0]
    y0, y1 = int(rows[0]), int(rows[-1])
    out = {}
    for f in FRACTIONS:
        xs = np.nonzero(m[int(round(y0 + f * (y1 - y0)))])[0]
        out[str(f)] = {"overLength": round(float(xs[-1] - xs[0]) / (y1 - y0), 3)}
    return out


def ring_slices(meta: dict) -> list[slice]:
    r = meta["rings"]
    if "start" in r:
        return [slice(a, a + n) for a, n in zip(r["start"], r["size"])]
    return [slice(k * r["around"], (k + 1) * r["around"]) for k in range(r["count"])]  # the first POM mesh: 120 per ring


def closed_polyline_at(ring: np.ndarray, frac_ring: np.ndarray, frac: np.ndarray) -> np.ndarray:
    """Points on the closed polyline `ring` (particles at arc fractions frac_ring, increasing) at fractions `frac`."""
    fr = np.concatenate([frac_ring - 1, frac_ring, frac_ring + 1])
    return np.stack([np.interp(frac, fr, np.tile(ring[:, c], 3)) for c in range(3)], 1)


def measure(root: str, drape_set: str, body_id: str, size: str) -> dict:
    meta = json.load(open(os.path.join(root, "rest", "rest.json")))
    body = next(b for b in json.load(open(os.path.join(root, "bodies", "bodies.json")))["bodies"] if b["id"] == body_id)
    srow = next(s for s in meta["sizes"] if s["size"] == size)
    rest = np.fromfile(os.path.join(root, "rest", srow["file"]), dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(os.path.join(root, "rest", "indices.bin"), dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    base = os.path.join(root, "drapes", drape_set, f"{body_id}__{size}")
    pos = np.fromfile(base + ".bin", dtype=np.float32).reshape(-1, 3).astype(np.float64)
    j = json.load(open(base + ".json"))
    top = rest[:, 1] > rest[:, 1].max() - 0.5
    bottom = rest[:, 1] < rest[:, 1].min() + 0.5
    top_y, hem_y = float(pos[top, 1].mean()), float(pos[bottom, 1].mean())
    out = {
        "size": size, "provenance": srow.get("provenance", "reconstructed"),
        "topY": round(top_y, 1), "hemY": round(hem_y, 1), "hemMinY": round(float(pos[:, 1].min()), 1),
        "bandY": j["band"]["settledMeanY"], "bandGirth": j["band"]["settledGirthCm"], "bandRelaxed": j["band"]["relaxedCm"],
        "bandSource": j["band"]["source"],
        "hip": slice_at(pos, idx, top_y - (float(rest[:, 1].max()) - MANNEQUIN_HIP_Y)),
        "hipBody": slice_at(pos, idx, body["achieved"]["hipY"]),
        "hem15": slice_at(pos, idx, hem_y + HEM_ABOVE_CM),
        "rest": {"hip": slice_at(rest, idx, MANNEQUIN_HIP_Y - 0.01), "hem15": slice_at(rest, idx, float(rest[:, 1].min()) + HEM_ABOVE_CM)},
        "front": front_profile(pos, idx, top_y, hem_y),
        "settledLength": round(top_y - hem_y, 1),
        "bandForce": j.get("cloth", {}).get("bandLimitForceOverWeight"), "floorCm": j.get("config", {}).get("floorCm", 0.0),
        "inside": j["insideBody"], "cpuS": j["cpuSecondsSim"], "wallS": j["wallSecondsSim"], "frames": j["frames"],
        "settleLast": j["settle"][-1], "fabricStrain": j.get("fabricStrain"),
    }
    if meta.get("kind") == "pom":
        hr = meta["rings"]["hipRing"]
        ring = [pos[sl] for sl in ring_slices(meta)]
        for name, k, tape in (("hipRing", hr, "hipCm"), ("hemRing", -1, "hemSweepCm")):
            r = ring[k]
            out[name] = {"tape": srow["tape"][tape]["cm"], "tapeSource": srow["tape"][tape]["source"].split(" ")[0],
                         "ringPath": round(float(np.linalg.norm(r - np.roll(r, -1, 0), axis=1).sum()), 1),
                         "ringHull": round(hull_perimeter(r[:, [0, 2]]), 1), "meanY": round(float(r[:, 1].mean()), 1),
                         "ySpread": round(float(r[:, 1].max() - r[:, 1].min()), 1)}
        # Length along the fabric, top edge to hem (mean over the meridians): the point of ring k + 1 under a particle
        # of ring k is the point of that ring's polyline at the same arc fraction (alternate rings are staggered).
        total = 0.0
        for k in range(len(ring) - 1):
            fa = (np.arange(len(ring[k])) + 0.5 * (k % 2)) / len(ring[k])
            fb = (np.arange(len(ring[k + 1])) + 0.5 * ((k + 1) % 2)) / len(ring[k + 1])
            total += float(np.linalg.norm(ring[k] - closed_polyline_at(ring[k + 1], fb, fa), axis=1).mean())
        out["lengthAlongFabric"] = round(total, 1)
        out["lengthTape"] = srow["tape"]["lengthCm"]["cm"]
    return out


def main() -> None:
    if sys.argv[1] == "--photo-mask":
        print(json.dumps(photo_silhouette(sys.argv[2])))
        return
    root, drape_set, body_id, sizes = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(",")
    rows = [measure(root, drape_set, body_id, s) for s in sizes]
    for r in rows:
        print(json.dumps(r))
    lo, hi = rows[0], rows[-1]
    spread = {k: {m: round(hi[k][m] - lo[k][m], 1) for m in ("hull", "path")} for k in ("hip", "hipBody", "hem15")}
    spread["rest"] = {k: {m: round(hi["rest"][k][m] - lo["rest"][k][m], 1) for m in ("hull", "path")} for k in ("hip", "hem15")}
    for k in ("hipRing", "hemRing"):
        if k in lo:
            spread[k] = {m: round(hi[k][m] - lo[k][m], 1) for m in ("tape", "ringPath", "ringHull")}
    print(json.dumps({"spread": f"AU {hi['size']} - AU {lo['size']}", **spread}))
    if "--json" in sys.argv:
        json.dump({"root": root, "set": drape_set, "body": body_id, "sizes": rows, "spread": spread}, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)


if __name__ == "__main__":
    main()
