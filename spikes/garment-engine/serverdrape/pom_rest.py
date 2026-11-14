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
N_AROUND = 120
N_BAND, N_YOKE, N_SKIRT = 6, 19, 67  # ring intervals: band, band-hip, hip-hem (about 0.7 / 0.85 / 0.85-1.8 cm)
SKIRT_GROWTH = 2.06       # last / first ring spacing below the hip (follows the girth: near-equilateral triangles)
WEIGHT_GSM = 165          # product material (viscose challis), as the eval bundle's material.json
UV_V0, UV_V1 = 0.0398, 0.676  # the stage-4t texture's v at the garment's top and bottom edge


def ring_distances(length: float) -> np.ndarray:
    """Distance from the top edge of every ring (same count for every size, so the sizes share one topology)."""
    band = np.linspace(0, BAND_CM, N_BAND + 1)
    yoke = np.linspace(BAND_CM, HIP_BELOW_TOP_CM, N_YOKE + 1)[1:]
    j = np.arange(1, N_SKIRT + 1) / N_SKIRT
    skirt = HIP_BELOW_TOP_CM + (length - HIP_BELOW_TOP_CM) * (SKIRT_GROWTH ** j - 1) / (SKIRT_GROWTH - 1)
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


def build(size: str, model: dict) -> dict:
    tv = {f: band_model.tape_value(model, f, size) for f in ("relaxedGirthCm", "stretchedGirthCm", "hipCm", "hemSweepCm", "lengthCm")}
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
    pos = np.zeros((len(s), N_AROUND, 3))
    uv = np.zeros((len(s), N_AROUND, 2))
    for k in range(len(s)):
        f = (np.arange(N_AROUND) + 0.5 * (k % 2)) / N_AROUND   # alternate rings are staggered half a step
        tk = np.interp(f, frac, t)
        nrm = np.stack([b * np.sin(tk), a * np.cos(tk)], 1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        pos[k, :, 0] = a * np.sin(tk) + delta[k] * nrm[:, 0]
        pos[k, :, 2] = Z0_CM + b * np.cos(tk) + delta[k] * nrm[:, 1]
        pos[k, :, 1] = y[k]
        uv[k, :, 0] = f
        uv[k, :, 1] = UV_V0 + (UV_V1 - UV_V0) * s[k] / length
    ring_len = np.linalg.norm(pos - np.roll(pos, -1, axis=1), axis=2).sum(1)  # inscribed polygon: a little under g
    return {"size": size, "pos": pos.reshape(-1, 3), "uv": uv.reshape(-1, 2), "s": s, "g": g, "y": y, "ringLen": ring_len,
            "tape": {f: {"cm": round(v, 2), "source": src} for f, (v, src) in tv.items()}, "hipRing": hip_ring}


def triangles(rings: int) -> np.ndarray:
    tri = []
    for k in range(rings - 1):
        for i in range(N_AROUND):
            a0, a1 = k * N_AROUND + i, k * N_AROUND + (i + 1) % N_AROUND
            b0, b1 = a0 + N_AROUND, a1 + N_AROUND
            tri += [(a0, a1, b0), (a1, b1, b0)] if k % 2 == 0 else [(a0, b1, b0), (a0, a1, b1)]
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
            idx = triangles(len(r["s"]))
            p = r["pos"]
            n = np.cross(p[idx[:, 1]] - p[idx[:, 0]], p[idx[:, 2]] - p[idx[:, 0]])
            c = p[idx].mean(1) - np.array([0, 0, Z0_CM])
            if (n[:, [0, 2]] * c[:, [0, 2]]).sum() < 0:
                idx = idx[:, [0, 2, 1]]
            idx.tofile(os.path.join(out, "indices.bin"))
            (np.repeat(r["s"] <= BAND_CM + 1e-6, N_AROUND)).astype(np.uint8).tofile(os.path.join(out, "band.bin"))
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
            "areaM2": round(float(area) / 1e4, 3), "edgeCm": {"min": round(float(el.min()), 2), "mean": round(float(el.mean()), 2), "max": round(float(el.max()), 2)},
        })
    meta = {
        "kind": "pom", "productId": "crimson-wildflower-maxi-skirt",
        "source": "tape measurements only (serverdrape/pom_rest.py); no photo reconstruction",
        "assumed": {"hipBelowTopCm": HIP_BELOW_TOP_CM, "bandCm": BAND_CM, "fabricGirthAtBand": "= the band's stretched girth",
                    "startEllipseAspect": ASPECT, "startCentreZCm": Z0_CM, "profile": "piecewise linear girth: top - hip - hem"},
        "vertexCount": int(len(rows) and N_AROUND * (N_BAND + N_YOKE + N_SKIRT + 1)), "triangleCount": int(len(idx)),
        "rings": {"around": N_AROUND, "count": N_BAND + N_YOKE + N_SKIRT + 1, "hipRing": N_BAND + N_YOKE},
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
