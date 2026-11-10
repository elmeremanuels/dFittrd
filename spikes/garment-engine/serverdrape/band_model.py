"""Resolve the waistband's relaxed and stretched girth per size from band-model.json (R2 spike).

`measured` wins when the founder has filled it; otherwise the named ASSUMED variant. Pure Python (no Blender, no numpy),
so the drape script, the bake and the doc all read the same numbers.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load(path: str | None = None) -> dict:
    with open(path or os.path.join(HERE, "band-model.json")) as fh:
        return json.load(fh)


def band_girth(model: dict, variant: str, size: str) -> dict:
    """{'relaxedCm', 'stretchedCm', 'source'} for one size. variant 'measured' uses the measured block."""
    a = model["assumed"]
    waist = a["chartWaistCm"]
    if variant == "measured":
        m = model.get("measured")
        if not m:
            raise SystemExit("band-model.json: `measured` is empty: the band is not measured yet (use an assumed variant)")
        sizes = sorted(waist, key=float)
        step = m.get("gradePerSizeCm")
        steps = sizes.index(size) - sizes.index(m["sampleSize"])
        grade = (waist[size] - waist[m["sampleSize"]]) if step is None else steps * step
        ratio = m["stretchedGirthCm"] / m["relaxedGirthCm"]
        relaxed = m["relaxedGirthCm"] + grade
        return {"relaxedCm": relaxed, "stretchedCm": relaxed * ratio, "source": "measured"}
    v = a["variants"][variant]
    relaxed = waist[size] + v["offsetCm"] if v["graded"] else v["fixedCm"]
    return {"relaxedCm": relaxed, "stretchedCm": relaxed * a["stretchRatio"], "source": f"ASSUMED {variant}"}
