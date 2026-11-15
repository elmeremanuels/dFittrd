"""POM v2 review renders (write-up section 9): builds render_blender.py specs and runs Blender. Review only.

python3 render_pom2.py <outPng> <view> <title> <item> [<item> ...] [--close] [--floor -0.4]
<item> = root:set:body:size:label   (root = a serverdrape output directory; label may contain spaces, '|' = newline)
label "auto" (optionally "auto|extra line") is built from the drape's JSON: size and provenance, the body, how the
band holds by the wear rule (with a warning when that verdict changes class if the ASSUMED band level moves by at most
wear_rule.PLACEMENT_UNCERTAINTY_CM), and the pull-on margins: stretched band minus the body's chart hip / minus the
widest hull below the band. The pull-on line carries NO pass / fail word unless the hip margin is clearly outside what
every size shows on its own chart body (0 to +2 on the hip, -0.4 to -2 on the hull): the check as defined (the shop's
comfortable stretch against a rigid hull) says "at the limit" for a size on the body it is cut for, so a "FAILS" there
was the check's miscalibration, not a property of the product (review finding, 15 Nov 2026).
--close: a close-up of the band and the first 30 cm (the gathers).
Every title must say ESTIMATE; every label must carry measured / INTERPOLATED / EXTRAPOLATED (the caller's job, checked).
"""
import json
import os
import subprocess
import sys
import tempfile

BLENDER = os.environ.get("BLENDER", "/opt/tools/blender-4.2.23-linux-x64/blender")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
PULL_ON_OWN_BODY_BAND_CM = 2.5  # hip margins within +-2.5 cm are what a size shows on its own chart body: no verdict


PROV = {"measured": "measured", "interpolated": "INTERPOLATED", "extrapolated": "EXTRAPOLATED"}


def auto_label(root: str, dset: str, body: str, size: str) -> str:
    j = json.load(open(os.path.join(root, "drapes", dset, f"{body}__{size}.json")))
    prov = PROV[j["band"]["source"].split(" ")[0]]
    f, p = j["wear"]["fit"], j["wear"]["pullOn"]
    return "|".join([f"AU {size} {prov}", f"on body {j['bodyLabel']}", band_line(root, body, j), pull_line(root, body, p)])


def band_line(root: str, body: str, j: dict) -> str:
    """How the band holds at the ASSUMED level, and whether that verdict survives moving the level."""
    import numpy as np
    import wear_rule
    f = j["wear"]["fit"]
    how = {"stretched": f"band stretched +{f.get('stretchedByCm')} cm", "relaxed": "band holds relaxed", "loose": f"band LOOSE by {f.get('looseByCm')} cm",
           "cannot be worn": f"band {f.get('overLimitCm')} cm short: not draped"}[f["status"]]
    v, fc = wear_rule.read_obj(os.path.join(root, "bodies", body + ".obj"))
    arm = np.fromfile(os.path.join(root, "bodies", "armmask.bin"), dtype=np.uint8).astype(bool)
    s = wear_rule.placement_sensitivity(wear_rule.BodySections(v, fc, arm), j["wear"]["navelY"], f["relaxedCm"], f["stretchedCm"])
    if s["insideUncertainty"]:
        d = s["flipsAtShiftCm"]
        how += f"|NOT A VERDICT (level ASSUMED):|'{s['flipsTo']}' if band {abs(d)} cm {'higher' if d > 0 else 'lower'}"
    return how


def pull_line(root: str, body: str, p: dict) -> str:
    """Stretched band minus chart hip / minus widest hull. A word only when clearly outside the own-chart-body range."""
    hip = next(b for b in json.load(open(os.path.join(root, "bodies", "bodies.json")))["bodies"] if b["id"] == body)["achieved"]["hipCm"]
    m_hip, m_hull = p["stretchedCm"] - hip, p["marginCm"]
    word = ("clear" if m_hip > PULL_ON_OWN_BODY_BAND_CM else
            "short at the shop's stretch" if m_hip < -PULL_ON_OWN_BODY_BAND_CM else "as on its own chart body")
    return f"pull-on hip/hull: {m_hip:+.1f} / {m_hull:+.1f} cm|({word})"


def main() -> None:
    argv = sys.argv[1:]
    close = "--close" in argv
    if close:
        argv.remove("--close")
    floor = -0.4
    if "--floor" in argv:
        i = argv.index("--floor")
        floor = float(argv[i + 1])
        del argv[i:i + 2]
    out, view, title, items = argv[0], argv[1], argv[2], argv[3:]
    assert "ESTIMATE" in title, "every render is labelled ESTIMATE"
    spec_items = []
    for it in items:
        root, dset, body, size, label = it.split(":", 4)
        if label.startswith("auto"):
            label = auto_label(root, dset, body, size) + label[4:]
        assert any(w in label for w in ("measured", "INTERPOLATED", "EXTRAPOLATED", "body only")), label
        garment = os.path.join(root, "drapes", dset, f"{body}__{size}.bin") if size != "-" else None
        if garment and not os.path.exists(garment):
            garment = None  # not draped (cannot be worn): the body alone, the label says why
        spec_items.append({"body": os.path.join(root, "bodies", body + ".obj"), "garment": garment,
                           "indices": os.path.join(root, "rest", "indices.bin"), "label": label.replace("|", "\n")})
    n = len(spec_items)
    # Frame: 0.6 m below the soles (the plinth and the hem) to 2.7 m (up to eight label lines above the heads), arms included.
    width, height = 400 * max(n, 4) + 300, 1330  # at least four columns wide, so the title clears the labels
    half_h = 1.65
    half_w = max(half_h * width / height, ((n - 1) * 0.75 + 1.7) / 2)
    spec = {"items": spec_items, "view": view, "title": title.replace("|", "\n"), "colour": "#A44B48", "floorM": floor, "labelSize": 0.042,
            "width": width, "height": height, "samples": 24, "camDistanceM": half_w / 0.36 - 0.3, "labelZM": 2.29}
    if close:
        spec.update({"camZM": 0.86, "lensMm": 50, "gapM": 0.55, "camDistanceM": max(1.3, ((n - 1) * 0.55 + 0.55) * 1.25),
                     "height": 640, "width": max(520 * n, 1040), "labelSize": 0.016, "rake": True})
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(spec, fh)
    r = subprocess.run([BLENDER, "-b", "--factory-startup", "-P", os.path.join(HERE, "render_blender.py"), "--", "--spec", fh.name, "--out", out],
                       capture_output=True, text=True)
    os.unlink(fh.name)
    if not os.path.exists(out):
        sys.exit(r.stdout[-3000:] + r.stderr[-3000:])
    print(out)


if __name__ == "__main__":
    main()
