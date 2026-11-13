"""Resolve the waistband's relaxed and stretched girth per size from band-model.json (R2 spike).

`measured` wins when the founder has filled it; otherwise the named ASSUMED variant. `measured` has two forms:
- per size (13 Nov 2026): `tapeFile` (a curtain.spike.tapeMeasurements file, the single source of truth) or an inline
  `sizes` map {size: {relaxedGirthCm, stretchedGirthCm, hemSweepCm, hipCm, lengthCm}}. Sizes that were not measured
  are INTERPOLATED or EXTRAPOLATED (rule: `tape_value`) and every value carries its provenance; never show an
  interpolated or extrapolated value as measured.
- single sample (the first form, still supported): `sampleSize` + one relaxed/stretched girth, graded per size by
  `gradePerSizeCm` or the chart's waist step. Pure Python (no Blender, no numpy),
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
    path = path or os.environ.get("BAND_MODEL") or os.path.join(HERE, "band-model.json")
    with open(path) as fh:
        model = json.load(fh)
    model["_dir"] = os.path.dirname(os.path.abspath(path))  # `measured.tapeFile` is relative to the model file
    return model


def _elastic(model: dict, ratio: float) -> float:
    a = model["assumed"]
    ref = a.get("stiffnessReferenceStretchRatio", 1.5)
    return a["elasticToFabricStiffness"] * (ref - 1.0) / (max(ratio, MIN_RATIO) - 1.0)


# Tape-file field -> band-model field (the tape file says waistRelaxedCm, the band model relaxedGirthCm).
TAPE_FIELDS = {"waistRelaxedCm": "relaxedGirthCm", "waistStretchedCm": "stretchedGirthCm", "hipCm": "hipCm",
               "hemSweepCm": "hemSweepCm", "lengthCm": "lengthCm"}


def measured_sizes(model: dict) -> dict | None:
    """{size: {relaxedGirthCm, stretchedGirthCm, hemSweepCm, hipCm, lengthCm}} of the MEASURED sizes only, or None
    when `measured` is empty or in the single-sample form."""
    m = model.get("measured")
    if not m:
        return None
    if m.get("tapeFile"):
        path = m["tapeFile"] if os.path.isabs(m["tapeFile"]) else os.path.join(model.get("_dir", HERE), m["tapeFile"])
        with open(path) as fh:
            tape = json.load(fh)
        return {s: {TAPE_FIELDS[k]: v for k, v in row.items() if k in TAPE_FIELDS} for s, row in tape["sizes"].items()}
    return m.get("sizes")


def tape_value(model: dict, field: str, size: str) -> tuple[float, str]:
    """(value, provenance) of one per-size tape measurement. Provenance is 'measured', 'interpolated (between A and B)'
    or 'extrapolated (slope of A-B)'. RULE: linear in the AU size number. Between two measured sizes: the straight line
    between the two neighbours. Outside the measured range: the straight line through the two nearest measured sizes,
    continued (so AU 16 continues the AU 10 -> 14 slope). With one measured size there is no slope: its value is used
    for every size and labelled extrapolated."""
    sizes = measured_sizes(model)
    if not sizes:
        raise SystemExit("band-model.json: `measured` has no per-size values")
    have = sorted((s for s in sizes if sizes[s].get(field)), key=float)
    if not have:
        raise SystemExit(f"band-model.json: `measured` has no {field}")
    if size in have:
        return float(sizes[size][field]), "measured"
    x = float(size)
    if len(have) == 1:
        return float(sizes[have[0]][field]), f"extrapolated (only AU {have[0]} measured, no grade)"
    below = [s for s in have if float(s) < x]
    above = [s for s in have if float(s) > x]
    if below and above:
        a, b, kind = below[-1], above[0], "interpolated (between AU {} and {})"
    elif below:
        a, b, kind = have[-2], have[-1], "extrapolated (slope of AU {}-{})"
    else:
        a, b, kind = have[0], have[1], "extrapolated (slope of AU {}-{})"
    va, vb = float(sizes[a][field]), float(sizes[b][field])
    return va + (vb - va) * (x - float(a)) / (float(b) - float(a)), kind.format(a, b)


def band_girth(model: dict, variant: str, size: str) -> dict:
    """{'relaxedCm', 'stretchedCm', 'stretchRatio', 'elasticToFabricStiffness', 'source'} for one size.
    variant 'measured' uses the measured block; its `source` then starts with 'measured', 'interpolated' or
    'extrapolated'."""
    a = model["assumed"]
    waist = a["chartWaistCm"]
    if variant == "measured":
        m = model.get("measured")
        if not m:
            raise SystemExit("band-model.json: `measured` is empty: the band is not measured yet (use an assumed variant)")
        if measured_sizes(model):
            relaxed, src = tape_value(model, "relaxedGirthCm", size)
            stretched, src2 = tape_value(model, "stretchedGirthCm", size)
            if not (relaxed > 0 and stretched > 0):
                raise SystemExit("band-model.json: `measured` needs relaxed and stretched girths > 0")
            ratio = stretched / relaxed
            return {"relaxedCm": round(relaxed, 2), "stretchedCm": round(stretched, 2), "stretchRatio": round(ratio, 4),
                    "elasticToFabricStiffness": round(_elastic(model, ratio), 5),
                    "source": src if src == src2 else f"{src}; stretched {src2}"}
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


def drape_key(girth: dict, pushout_cm: float, restmode: str, tension_floor: float = 0.0, cloth: str = "default") -> dict:
    """Everything a drape's result depends on beyond body, size, rest geometry and the solver constants: the grid driver
    re-runs a cached drape when this differs (e.g. after `measured` is filled or corrected)."""
    key = {"relaxedCm": round(girth["relaxedCm"], 2), "stretchedCm": round(girth["stretchedCm"], 2),
           "elastic": round(girth["elasticToFabricStiffness"], 5), "pushoutCm": round(pushout_cm, 3), "restmode": restmode}
    if restmode == "graded":
        key["tensionFloor"] = round(tension_floor, 3)
    if cloth != "default":
        key["cloth"] = cloth  # drape_blender.py CLOTH preset; absent for the first runs' values
    return key


def cached_key(drape_json: dict) -> dict:
    """The key of a finished drape. Drapes from before the key existed used pushout 0.8, restmode pushed and the fixed
    0.08 stiffness (= stretch ratio 1.5), so their key is rebuilt from those defaults."""
    if "config" in drape_json:
        return drape_json["config"]
    b = drape_json["band"]
    return {"relaxedCm": round(b["relaxedCm"], 2), "stretchedCm": round(b["stretchedCm"], 2), "elastic": 0.08,
            "pushoutCm": 0.8, "restmode": "pushed"}


def hem_check(model: dict, rest_meta: dict, tolerance: float = 0.05) -> list[dict] | None:
    """Hem sweep from the tape against the rest geometry, one row per size that has both (per-size form: every size of
    the rest geometry, with the provenance of the tape value; single-sample form: the sample size). None when the hem
    is not measured."""
    m = model.get("measured")
    if not m:
        return None
    if measured_sizes(model):
        want = [(s["size"], *tape_value(model, "hemSweepCm", s["size"])) for s in rest_meta["sizes"]]
    elif m.get("hemSweepCm"):
        want = [(m["sampleSize"], m["hemSweepCm"], "measured")]
    else:
        return None
    rows = []
    for size, cm, src in want:
        row = next(s for s in rest_meta["sizes"] if s["size"] == size)
        if "hemSweepMaxCm" not in row:
            raise SystemExit("rest.json has no hemSweepMaxCm: re-run export-rest.ts")
        out = {"size": size, "tapeCm": round(cm, 1), "source": src, "restEdgeCm": row["hemEdgeGirthCm"], "restMaxCm": row["hemSweepMaxCm"]}
        out["diff"] = round(out["restMaxCm"] / cm - 1, 3)
        out["ok"] = abs(out["diff"]) <= tolerance
        rows.append(out)
    return rows


def describe(model: dict, sizes: list[str]) -> list[dict]:
    """The resolved band per size with its provenance (for logs, reports and render labels)."""
    return [{"size": s, **band_girth(model, "measured", s)} for s in sizes]


if __name__ == "__main__":
    import sys
    mdl = load()
    rest = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else None
    if measured_sizes(mdl) and rest:
        for b in describe(mdl, [s["size"] for s in rest["sizes"]]):
            print(f"band AU {b['size']}: relaxed {b['relaxedCm']} cm, stretched {b['stretchedCm']} cm, "
                  f"ratio {b['stretchRatio']}, stiffness x{b['elasticToFabricStiffness']} [{b['source']}]")
    hc = hem_check(mdl, rest) if rest else None
    if hc is None:
        print("hem sweep: not measured (band-model.json `measured`)")
    for r in hc or []:
        print(("OK" if r["ok"] else "WARNING") + f" hem sweep AU {r['size']}: tape {r['tapeCm']} cm [{r['source']}], rest "
              f"geometry max {r['restMaxCm']} cm (edge {r['restEdgeCm']} cm), {r['diff']:+.1%}")
