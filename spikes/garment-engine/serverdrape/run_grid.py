"""R2 spike driver: run the Blender drapes (drape_blender.py) for bodies x sizes x band variants, two at a time.

python3 run_grid.py <outDir> <bodyIds,...> <sizes,...> <bandVariants,...> [frames]
Writes <outDir>/drapes/<band><TAG>/<body>__<size>.bin/.json. A cached drape is reused only when its key (the resolved
band girths and stiffness, push-out, rest mode: band_model.drape_key) matches what band-model.json gives now; otherwise
it is re-run (so correcting `measured` re-drapes). Env: BLENDER (binary), JOBS (2), PUSHOUT (cm, 0.8),
RESTMODE (pushed | graded | gradedall), TENSION_FLOOR (0.9, graded only), TAG (suffix of the output directory, e.g. "+graded"), BAND_MODEL (band-model.json path).
"""
import itertools
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import band_model  # noqa: E402

BLENDER = os.environ.get("BLENDER", "/opt/tools/blender-4.2.23-linux-x64/blender")
PUSHOUT = float(os.environ.get("PUSHOUT", "0.8"))
RESTMODE = os.environ.get("RESTMODE", "pushed")
FLOOR = float(os.environ.get("TENSION_FLOOR", "0.9"))
TAG = os.environ.get("TAG", "")


def job(out, body, size, band, frames, model):
    d = os.path.join(out, "drapes", band + TAG)
    os.makedirs(d, exist_ok=True)
    base = os.path.join(d, f"{body}__{size}")
    want = band_model.drape_key(band_model.band_girth(model, band, size), PUSHOUT, RESTMODE, FLOOR)
    if os.path.exists(base + ".json"):
        have = band_model.cached_key(json.load(open(base + ".json")))
        if have == want:
            return base, "cached"
        print(f"stale {base}: {have} != {want}: re-draping", flush=True)
        os.remove(base + ".json")
    cmd = [BLENDER, "-b", "--factory-startup", "-P", os.path.join(HERE, "drape_blender.py"), "--",
           "--body", os.path.join(out, "bodies", body + ".obj"), "--rest", os.path.join(out, "rest"), "--size", size,
           "--band", band, "--out", base + ".bin", "--json", base + ".json", "--frames", str(frames),
           "--pushout", str(PUSHOUT), "--restmode", RESTMODE, "--tensionfloor", str(FLOOR)]
    if os.environ.get("BAND_MODEL"):
        cmd += ["--model", os.environ["BAND_MODEL"]]
    r = subprocess.run(cmd, capture_output=True, text=True)
    with open(base + ".log", "w") as fh:
        fh.write(r.stdout[-20000:] + r.stderr[-20000:])
    return base, "ok" if os.path.exists(base + ".json") else "FAILED"


def main():
    out, bodies, sizes, bands = sys.argv[1], sys.argv[2].split(","), sys.argv[3].split(","), sys.argv[4].split(",")
    frames = int(sys.argv[5]) if len(sys.argv) > 5 else 72
    model = band_model.load()
    jobs = list(itertools.product(bands, bodies, sizes))
    with ThreadPoolExecutor(int(os.environ.get("JOBS", "2"))) as ex:
        for base, status in ex.map(lambda j: job(out, j[1], j[2], j[0], frames, model), jobs):
            print(status, base, flush=True)


if __name__ == "__main__":
    main()
