"""Resolve the waistband's relaxed and stretched girth per size from band-model.json (R2 spike).

`measured` wins when the founder has filled it; otherwise the named ASSUMED variant. Pure Python (no Blender, no numpy),
so the drape script, the grid driver, the bake and the doc all read the same numbers.

What drives the simulation (see band-model.json README):
- relaxedGirthCm (+ gradePerSizeCm): the band's rest girth per size (Blender per-vertex shrink of the band particles).
- stretchedGirthCm: the stretch ratio stretched / relaxed sets the band's tension stiffness,
  elastic = elasticToFabricStiffness x (refRatio - 1) / (ratio - 1): an easier-stretching band is softer. At the
  reference ratio (1.5) this is the first run's fixed 0.08. ASSUMED mapping (linear spring, not calibrated).
- hemSweepCm: not a simulation input (the hem comes from the reconstructed garment); hem_check() compares it with the
  rest geometry's hem girth and warns when they differ by more than 5 %.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_RATIO = 1.05  # a band that stretches less than 5 % is treated as 5 % (keeps the stiffness finite)


def load(path: str | None = None) -> dict:
    with open(path or os.environ.get("BAND_MODEL") or os.path.join(HERE, "band-model.json")) as fh:
        return json.load(fh)


def _elastic(model: dict, ratio: float) -> float:
    a = model["assumed"]
    ref = a.get("stiffnessReferenceStretchRatio", 1.5)
    return a["elasticToFabricStiffness"] * (ref - 1.0) / (max(ratio, MIN_RATIO) - 1.0)


def band_girth(model: dict, variant: str, size: str) -> dict:
    """{'relaxedCm', 'stretchedCm', 'stretchRatio', 'elasticToFabricStiffness', 'source'} for one size.
    variant 'measured' uses the measured block."""
    a = model["assumed"]
    waist = a["chartWaistCm"]
    if variant == "measured":
        m = model.get("measured")
        if not m:
            raise SystemExit("band-model.json: `measured` is empty: the band is not measured yet (use an assumed variant)")
        if not (m.get("relaxedGirthCm", 0) > 0 and m.get("stretchedGirthCm", 0) > 0):
            raise SystemExit("band-model.json: `measured` needs relaxedGirthCm and stretchedGirthCm > 0")
        sizes = sorted(waist, key=float)
        step = m.get("gradePerSizeCm")
        steps = sizes.index(size) - sizes.index(m["sampleSize"])
        grade = (waist[size] - waist[m["sampleSize"]]) if step is None else steps * step
        ratio = m["stretchedGirthCm"] / m["relaxedGirthCm"]
        relaxed = m["relaxedGirthCm"] + grade
        return {"relaxedCm": relaxed, "stretchedCm": relaxed * ratio, "stretchRatio": round(ratio, 4),
                "elasticToFabricStiffness": round(_elastic(model, ratio), 5), "source": "measured"}
    v = a["variants"][variant]
    relaxed = waist[size] + v["offsetCm"] if v["graded"] else v["fixedCm"]
    ratio = v.get("stretchRatio", a["stretchRatio"])
    return {"relaxedCm": relaxed, "stretchedCm": relaxed * ratio, "stretchRatio": ratio,
            "elasticToFabricStiffness": round(_elastic(model, ratio), 5), "source": f"ASSUMED {variant}"}


def drape_key(girth: dict, pushout_cm: float, restmode: str, tension_floor: float = 0.0) -> dict:
    """Everything a drape's result depends on beyond body, size, rest geometry and the solver constants: the grid driver
    re-runs a cached drape when this differs (e.g. after `measured` is filled or corrected)."""
    key = {"relaxedCm": round(girth["relaxedCm"], 2), "stretchedCm": round(girth["stretchedCm"], 2),
           "elastic": round(girth["elasticToFabricStiffness"], 5), "pushoutCm": round(pushout_cm, 3), "restmode": restmode}
    if restmode == "graded":
        key["tensionFloor"] = round(tension_floor, 3)
    return key


def cached_key(drape_json: dict) -> dict:
    """The key of a finished drape. Drapes from before the key existed used pushout 0.8, restmode pushed and the fixed
    0.08 stiffness (= stretch ratio 1.5), so their key is rebuilt from those defaults."""
    if "config" in drape_json:
        return drape_json["config"]
    b = drape_json["band"]
    return {"relaxedCm": round(b["relaxedCm"], 2), "stretchedCm": round(b["stretchedCm"], 2), "elastic": 0.08,
            "pushoutCm": 0.8, "restmode": "pushed"}


def hem_check(model: dict, rest_meta: dict, tolerance: float = 0.05) -> dict | None:
    """Measured hem sweep against the rest geometry of the sample size. None when not measured."""
    m = model.get("measured")
    if not m or not m.get("hemSweepCm"):
        return None
    row = next(s for s in rest_meta["sizes"] if s["size"] == m["sampleSize"])
    if "hemSweepMaxCm" not in row:
        raise SystemExit("rest.json has no hemSweepMaxCm: re-run export-rest.ts")
    out = {"measuredCm": m["hemSweepCm"], "restEdgeCm": row["hemEdgeGirthCm"], "restMaxCm": row["hemSweepMaxCm"]}
    out["diff"] = round(out["restMaxCm"] / out["measuredCm"] - 1, 3)
    out["ok"] = abs(out["diff"]) <= tolerance
    return out


if __name__ == "__main__":
    import sys
    mdl = load()
    rest = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else None
    hc = hem_check(mdl, rest) if rest else None
    if hc is None:
        print("hem sweep: not measured (band-model.json `measured.hemSweepCm`)")
    else:
        print(("OK" if hc["ok"] else "WARNING") + f" hem sweep: measured {hc['measuredCm']} cm, rest geometry max "
              f"{hc['restMaxCm']} cm (edge {hc['restEdgeCm']} cm), {hc['diff']:+.1%}")
