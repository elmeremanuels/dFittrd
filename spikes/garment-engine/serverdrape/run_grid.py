"""R2 spike driver: run the Blender drapes (drape_blender.py) for bodies x sizes x band variants, two at a time.

python3 run_grid.py <outDir> <bodyIds,...> <sizes,...> <bandVariants,...> [frames]
Writes <outDir>/drapes/<band>/<body>__<size>.bin/.json; skips a drape whose JSON exists.
BLENDER env var: the blender binary (default /opt/tools/blender-4.2.23-linux-x64/blender).
"""
import itertools
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = os.environ.get("BLENDER", "/opt/tools/blender-4.2.23-linux-x64/blender")


def job(out, body, size, band, frames):
    d = os.path.join(out, "drapes", band)
    os.makedirs(d, exist_ok=True)
    base = os.path.join(d, f"{body}__{size}")
    if os.path.exists(base + ".json"):
        return base, "cached"
    cmd = [BLENDER, "-b", "--factory-startup", "-P", os.path.join(HERE, "drape_blender.py"), "--",
           "--body", os.path.join(out, "bodies", body + ".obj"), "--rest", os.path.join(out, "rest"), "--size", size,
           "--band", band, "--out", base + ".bin", "--json", base + ".json", "--frames", str(frames)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    with open(base + ".log", "w") as fh:
        fh.write(r.stdout[-20000:] + r.stderr[-20000:])
    return base, "ok" if os.path.exists(base + ".json") else "FAILED"


def main():
    out, bodies, sizes, bands = sys.argv[1], sys.argv[2].split(","), sys.argv[3].split(","), sys.argv[4].split(",")
    frames = int(sys.argv[5]) if len(sys.argv) > 5 else 72
    jobs = list(itertools.product(bands, bodies, sizes))
    with ThreadPoolExecutor(int(os.environ.get("JOBS", "2"))) as ex:
        for base, status in ex.map(lambda j: job(out, j[1], j[2], j[0], frames), jobs):
            print(status, base, flush=True)


if __name__ == "__main__":
    main()
