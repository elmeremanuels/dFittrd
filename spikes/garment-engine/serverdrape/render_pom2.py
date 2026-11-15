"""POM v2 review renders (write-up section 9): builds render_blender.py specs and runs Blender. Review only.

python3 render_pom2.py <outPng> <view> <title> <item> [<item> ...] [--close] [--floor -0.4]
<item> = root:set:body:size:label   (root = a serverdrape output directory; label may contain spaces, '|' = newline)
label "auto" (optionally "auto|extra line") is built from the drape's JSON: size and provenance, the body, how the
band holds by the wear rule, and the pull-on margin against the body's widest girth below the band.
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


PROV = {"measured": "measured", "interpolated": "INTERPOLATED", "extrapolated": "EXTRAPOLATED"}


def auto_label(root: str, dset: str, body: str, size: str) -> str:
    j = json.load(open(os.path.join(root, "drapes", dset, f"{body}__{size}.json")))
    prov = PROV[j["band"]["source"].split(" ")[0]]
    f, p = j["wear"]["fit"], j["wear"]["pullOn"]
    how = {"stretched": f"band stretched +{f.get('stretchedByCm')} cm", "relaxed": "band holds relaxed", "loose": f"band LOOSE by {f.get('looseByCm')} cm",
           "cannot be worn": f"CANNOT BE WORN: body {f.get('overLimitCm')} cm|over the stretched band. Not draped"}[f["status"]]
    m = p["marginCm"]
    pull = f"pull-on: passes by {m} cm" if m >= 2 else (f"pull-on: FAILS by {-m} cm" if m <= -2 else f"pull-on: marginal ({m:+.1f} cm)")
    return f"AU {size} {prov}|on body {j['bodyLabel']}|{how}|{pull}"


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
    # Frame: 0.55 m below the soles (the plinth and the hem) to 2.55 m (four label lines above the heads), arms included.
    width, height = 400 * max(n, 4) + 300, 1250  # at least four columns wide, so the title clears the labels
    half_h = 1.55
    half_w = max(half_h * width / height, ((n - 1) * 0.75 + 1.7) / 2)
    spec = {"items": spec_items, "view": view, "title": title.replace("|", "\n"), "colour": "#A44B48", "floorM": floor, "labelSize": 0.042,
            "width": width, "height": height, "samples": 24, "camDistanceM": half_w / 0.36 - 0.3, "labelZM": 2.22}
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
