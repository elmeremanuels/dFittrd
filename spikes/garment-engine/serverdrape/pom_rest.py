"""Variant POM: the skirt's rest geometry built from the shop's tape measurements alone (no photo reconstruction).

python3 pom_rest.py <outDir> [sizes, default 8,10,12,14,16]
Writes the same files as viewer/scripts/serverdrape/export-rest.ts, so drape_blender.py, run_grid.py and bake.ts run
unchanged on it: rest-<size>.bin (Float32 xyz, cm, mannequin frame), indices.bin (Uint32), band.bin (Uint8), uvs.bin
(Float32 uv) and rest.json. Our own geometry code (numpy only); no pattern library.

The garment (a plain A-line, pull-on elastic band), per size, from five tape numbers (band_model.tape_value: measured
for AU 8/10/14, INTERPOLATED for 12, EXTRAPOLATED for 16; rest.json carries the provenance of every number):
- fabric girth along the skirt, piecewise linear in the distance s from the top edge:
    s = 0                 the fabric at the band = the band's STRETCHED girth. ASSUMED: an elastic casing stretches until
                          the fabric lies flat, so the stretched limit is the cut girth of the fabric there.
    s = HIP_BELOW_TOP_CM  the tape hip girth. The distance is ASSUMED (20 cm, the usual pattern hip depth; the shop's
                          sketch does not give it).
    s = length            the tape hem sweep.
- the top BAND_CM (ASSUMED 4 cm) are the band particles; drape_blender.py shortens their rest length to the band's
  RELAXED girth, which gathers the fabric into the band.
Rest shape: a constant-slope surface over an ellipse (every ring is the ellipse offset outwards along its normals).
That surface is developable: ring k has exactly the girth g(s_k) and every meridian exactly the length s, so the
mesh carries the flat lengths of the fabric (Blender takes its springs from this start shape). The ellipse (aspect and
z offset ASSUMED) only keeps the start shape clear of the body; it is not a garment property.
The hip ring is placed at the mannequin hip height (87.36 cm), where drape_blender.py aligns it with each body's hip.
Mesh (review finding, 14 Nov 2026): uniform density. The first POM mesh had 120 particles on every ring and ring
spacing growing towards the hem, so a particle near the hem stood for about 6 times the fabric area of one at the band;
Blender's cloth gives every particle the same mass, which made the hem fabric about 6 times lighter per unit area
than the band. Now every ring has its own particle count (girth / EDGE_CM, counts taken from the measured AU 10 profile
and shared by all sizes: one topology) and the rings are evenly spaced, so the area per particle is uniform within a
size (rest.json areaPerParticleCm2). rest.json `rings.start` / `rings.size` give each ring's particles.
UVs: u around (0 at the centre front), v along the length, mapped onto the stage-4t texture's cylinder layout so the
existing texture can be reused in review renders (the print is then stretched sideways: the texture was baked on a
garment half as wide).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import band_model  # noqa: E402

HIP_BELOW_TOP_CM = 20.0   # ASSUMED
BAND_CM = 4.0             # ASSUMED (as export-rest.ts: the top 4 cm)
ASPECT = 1.24             # ASSUMED start-shape ellipse, half-width x : half-depth z
Z0_CM = 2.5               # ASSUMED start-shape centre (the waist sits in front of the hip on the Anny bodies)
MANNEQUIN_HIP_Y = 87.36
EDGE_CM = 1.3             # target particle spacing along a ring (mesh resolution, not a garment property)
N_BAND, N_YOKE, N_SKIRT = 4, 14, 74  # ring intervals: band, band-hip, hip-hem (1.0 / 1.14 / about 1.12 cm = EDGE x 0.87)
COUNT_SIZE = "10"         # the ring particle counts come from this (measured) size's girth profile
WEIGHT_GSM = 165          # product material (viscose challis), as the eval bundle's material.json
UV_V0, UV_V1 = 0.0398, 0.676  # the stage-4t texture's v at the garment's top and bottom edge


def ring_distances(length: float) -> np.ndarray:
    """Distance from the top edge of every ring (same count for every size, so the sizes share one topology)."""
    band = np.linspace(0, BAND_CM, N_BAND + 1)
    yoke = np.linspace(BAND_CM, HIP_BELOW_TOP_CM, N_YOKE + 1)[1:]
    skirt = np.linspace(HIP_BELOW_TOP_CM, length, N_SKIRT + 1)[1:]
    return np.concatenate([band, yoke, skirt])


def girth_at(s: np.ndarray, top: float, hip: float, hem: float, length: float) -> np.ndarray:
    return np.interp(s, [0, HIP_BELOW_TOP_CM, length], [top, hip, hem])


def ellipse(perimeter: float, n: int = 20000):
    """Half-axes (a along x, b along z) of the ASPECT ellipse with this perimeter, and a dense arc-length table."""
    t = np.linspace(0, 2 * np.pi, n + 1)
    unit = np.stack([ASPECT * np.sin(t), np.cos(t)], 1)
    seg = np.linalg.norm(np.diff(unit, axis=0), axis=1)
    b = perimeter / seg.sum()
    return ASPECT * b, b, t, np.concatenate([[0], np.cumsum(seg)]) / seg.sum()


def tape(size: str, model: dict) -> dict:
    return {f: band_model.tape_value(model, f, size) for f in ("relaxedGirthCm", "stretchedGirthCm", "hipCm", "hemSweepCm", "lengthCm")}


def ring_counts(model: dict) -> np.ndarray:
    """Particles per ring, the same for every size (one topology): the COUNT_SIZE girth profile / EDGE_CM."""
    tv = tape(COUNT_SIZE, model)
    top, hip, hem, length = (tv[f][0] for f in ("stretchedGirthCm", "hipCm", "hemSweepCm", "lengthCm"))
    return np.maximum(np.rint(girth_at(ring_distances(length), top, hip, hem, length) / EDGE_CM), 8).astype(int)


def build(size: str, model: dict) -> dict:
    counts = ring_counts(model)
    start = np.concatenate([[0], np.cumsum(counts)])
    tv = tape(size, model)
    top, hip, hem, length = (tv[f][0] for f in ("stretchedGirthCm", "hipCm", "hemSweepCm", "lengthCm"))
    s = ring_distances(length)
    g = girth_at(s, top, hip, hem, length)
    delta = (g - top) / (2 * np.pi)                      # outward offset of the ring from the top ellipse
    ddelta, ds = np.diff(delta), np.diff(s)
    drop = np.sqrt(np.maximum(ds ** 2 - ddelta ** 2, 0))  # constant slope per segment: meridian length = ds exactly
    y = -np.concatenate([[0], np.cumsum(drop)])
    hip_ring = N_BAND + N_YOKE
    y += MANNEQUIN_HIP_Y - y[hip_ring]
    a, b, t, frac = ellipse(top)
    pos = np.zeros((start[-1], 3))
    uv = np.zeros((start[-1], 2))
    ring_len = np.zeros(len(s))
    for k in range(len(s)):
        f = ring_fractions(k, counts[k])
        tk = np.interp(f, frac, t)
        nrm = np.stack([b * np.sin(tk), a * np.cos(tk)], 1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        r = pos[start[k]:start[k + 1]]
        r[:, 0] = a * np.sin(tk) + delta[k] * nrm[:, 0]
        r[:, 2] = Z0_CM + b * np.cos(tk) + delta[k] * nrm[:, 1]
        r[:, 1] = y[k]
        uv[start[k]:start[k + 1], 0] = f
        uv[start[k]:start[k + 1], 1] = UV_V0 + (UV_V1 - UV_V0) * s[k] / length
        ring_len[k] = np.linalg.norm(r - np.roll(r, -1, axis=0), axis=1).sum()  # inscribed polygon: a little under g
    # Fabric area per particle, per ring: girth x (half the spacing to each neighbour ring) / particles.
    half = np.concatenate([[0], np.diff(s) / 2]) + np.concatenate([np.diff(s) / 2, [0]])
    return {"size": size, "pos": pos, "uv": uv, "s": s, "g": g, "y": y, "ringLen": ring_len, "counts": counts, "start": start,
            "areaPerParticle": g * half / counts,
            "tape": {f: {"cm": round(v, 2), "source": src} for f, (v, src) in tv.items()}, "hipRing": hip_ring}


def ring_fractions(k: int, n: int) -> np.ndarray:
    """Arc-length fraction around the ring of each particle of ring k (alternate rings staggered half a step)."""
    return (np.arange(n) + 0.5 * (k % 2)) / n


def triangles(counts: np.ndarray) -> np.ndarray:
    """Stitch consecutive rings with different particle counts: walk both rings by arc-length fraction."""
    start = np.concatenate([[0], np.cumsum(counts)])
    tri = []
    for k in range(len(counts) - 1):
        na, nb = int(counts[k]), int(counts[k + 1])
        fa = np.concatenate([ring_fractions(k, na), [ring_fractions(k, na)[0] + 1]])
        fb = np.concatenate([ring_fractions(k + 1, nb), [ring_fractions(k + 1, nb)[0] + 1]])
        i = j = 0
        while i < na or j < nb:
            a0, b0 = start[k] + i % na, start[k + 1] + j % nb
            if j >= nb or (i < na and fa[i + 1] <= fb[j + 1]):
                tri.append((a0, start[k] + (i + 1) % na, b0))
                i += 1
            else:
                tri.append((a0, start[k + 1] + (j + 1) % nb, b0))
                j += 1
    return np.array(tri, dtype=np.uint32)


def main() -> None:
    out = sys.argv[1]
    sizes = (sys.argv[2] if len(sys.argv) > 2 else "8,10,12,14,16").split(",")
    os.makedirs(out, exist_ok=True)
    model = band_model.load()
    idx = None
    rows = []
    heights = [100, 95, 87, 75, 60, 40, 20]
    for size in sizes:
        r = build(size, model)
        if idx is None:
            idx = triangles(r["counts"])
            p = r["pos"]
            n = np.cross(p[idx[:, 1]] - p[idx[:, 0]], p[idx[:, 2]] - p[idx[:, 0]])
            c = p[idx].mean(1) - np.array([0, 0, Z0_CM])
            if (n[:, [0, 2]] * c[:, [0, 2]]).sum() < 0:
                idx = idx[:, [0, 2, 1]]
            idx.tofile(os.path.join(out, "indices.bin"))
            (np.repeat(r["s"] <= BAND_CM + 1e-6, r["counts"])).astype(np.uint8).tofile(os.path.join(out, "band.bin"))
            r["uv"].astype(np.float32).tofile(os.path.join(out, "uvs.bin"))
        r["pos"].astype(np.float32).tofile(os.path.join(out, f"rest-{size}.bin"))
        edge = r["pos"][idx]
        el = np.linalg.norm(edge - np.roll(edge, 1, axis=1), axis=2)
        area = 0.5 * np.linalg.norm(np.cross(edge[:, 1] - edge[:, 0], edge[:, 2] - edge[:, 0]), axis=1).sum()
        provenance = sorted({v["source"].split(" ")[0] for v in r["tape"].values()})
        rows.append({
            "size": size, "file": f"rest-{size}.bin",
            "provenance": provenance[0] if len(provenance) == 1 else "/".join(provenance),
            "tape": r["tape"],
            "topY": float(r["y"][0]), "hemY": float(r["y"][-1]),
            # drape_blender.py shrinks the band particles by relaxed / this (the fabric's girth at the band).
            "bandGradedGirthCm": r["tape"]["stretchedGirthCm"]["cm"],
            "hemEdgeGirthCm": round(float(r["g"][-1]), 1), "hemSweepMaxCm": round(float(r["g"][-1]), 1),
            "girths": {str(h): round(float(np.interp(h, r["y"][::-1], r["g"][::-1])), 1) for h in heights},
            "ringPolygonCm": {"top": round(float(r["ringLen"][0]), 2), "hip": round(float(r["ringLen"][r["hipRing"]]), 2), "hem": round(float(r["ringLen"][-1]), 2)},
            "areaPerParticleCm2": {"min": round(float(r["areaPerParticle"][1:-1].min()), 3), "max": round(float(r["areaPerParticle"][1:-1].max()), 3),
                                   "mean": round(float(area) / len(r["pos"]), 3)},
            "areaM2": round(float(area) / 1e4, 3), "edgeCm": {"min": round(float(el.min()), 2), "mean": round(float(el.mean()), 2), "max": round(float(el.max()), 2)},
        })
    meta = {
        "kind": "pom", "productId": "crimson-wildflower-maxi-skirt",
        "source": "tape measurements only (serverdrape/pom_rest.py); no photo reconstruction",
        "assumed": {"hipBelowTopCm": HIP_BELOW_TOP_CM, "bandCm": BAND_CM, "fabricGirthAtBand": "= the band's stretched girth",
                    "startEllipseAspect": ASPECT, "startCentreZCm": Z0_CM, "profile": "piecewise linear girth: top - hip - hem",
                    "construction": "one plain cone; the product photos show a gathered tier seam and a side slit, which this ignores"},
        "vertexCount": int(r["start"][-1]), "triangleCount": int(len(idx)),
        "rings": {"count": N_BAND + N_YOKE + N_SKIRT + 1, "hipRing": N_BAND + N_YOKE, "start": [int(x) for x in r["start"][:-1]],
                  "size": [int(x) for x in r["counts"]], "edgeCm": EDGE_CM, "countsFromSize": COUNT_SIZE},
        "weightGsm": WEIGHT_GSM, "colour": "#A44B48", "mannequin": {"hipY": MANNEQUIN_HIP_Y}, "heights": heights, "sizes": rows,
    }
    json.dump(meta, open(os.path.join(out, "rest.json"), "w"), indent=1)
    for r in rows:
        t = r["tape"]
        print(f"AU {r['size']} [{r['provenance']}]: band {t['relaxedGirthCm']['cm']} -> fabric top {t['stretchedGirthCm']['cm']}, hip {t['hipCm']['cm']}, "
              f"hem {t['hemSweepCm']['cm']}, length {t['lengthCm']['cm']} cm; rest y {r['hemY']:.1f}..{r['topY']:.1f}; ring polygons {r['ringPolygonCm']}; "
              f"area {r['areaM2']} m2; edges {r['edgeCm']}")


if __name__ == "__main__":
    main()
