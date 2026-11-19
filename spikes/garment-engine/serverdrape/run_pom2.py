"""POM v2 driver (write-up section 9): wear-rule drapes, at most two Blender processes at a time.

python3 run_pom2.py <root> <set> <body:size[:frames],body:size[:frames],...> [frames] [-- extra drape_blender.py flags]
A job's own frame count (body:size:frames) overrides the run's (default 144): a drape that did not come to rest is
re-run longer without re-running the others. Writes <root>/drapes/<set>/<body>__<size>.bin/.json/.log. A finished drape is reused when its JSON exists and was
made with the same extra flags and frame count; a combination the wear rule refuses ("cannot be worn") leaves a
JSON without a .bin. Env: BLENDER, JOBS (default 2; the machine is shared: never more than 2), FLOOR_CM (default -40:
the body on a plinth so the hem hangs free; the 103-104 cm skirt worn below the navel reaches the floor at 168 cm).
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = os.environ.get("BLENDER", "/opt/tools/blender-4.2.23-linux-x64/blender")
FLOOR_CM = os.environ.get("FLOOR_CM", "-40")


def job(root: str, dset: str, body: str, size: str, frames: int, extra: list[str]) -> str:
    d = os.path.join(root, "drapes", dset)
    os.makedirs(d, exist_ok=True)
    base = os.path.join(d, f"{body}__{size}")
    run = {"frames": frames, "extra": extra, "floorCm": FLOOR_CM}
    if os.path.exists(base + ".json"):
        if json.load(open(base + ".json")).get("run") == run:
            return f"cached {base}"
        os.remove(base + ".json")
    if os.path.exists(base + ".bin"):
        os.remove(base + ".bin")
    cmd = [BLENDER, "-b", "--factory-startup", "-P", os.path.join(HERE, "drape_blender.py"), "--",
           "--body", os.path.join(root, "bodies", body + ".obj"), "--rest", os.path.join(root, "rest"), "--size", size,
           "--band", "measured", "--out", base + ".bin", "--json", base + ".json", "--frames", str(frames),
           "--cloth", "viscose-soft", "--floor", FLOOR_CM, "--wear", "navel", *extra]
    r = subprocess.run(cmd, capture_output=True, text=True)
    with open(base + ".log", "w") as fh:
        fh.write(r.stdout[-20000:] + r.stderr[-20000:])
    if not os.path.exists(base + ".json"):
        return f"FAILED {base}"
    j = json.load(open(base + ".json"))
    j["run"] = run
    json.dump(j, open(base + ".json", "w"), indent=1)
    return f"{j.get('status', 'draped')} {base}"


def main() -> None:
    argv = sys.argv[1:]
    extra = []
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
        argv = argv[:argv.index("--")]
    root, dset, jobs = argv[0], argv[1], [j.split(":") for j in argv[2].split(",")]
    frames = int(argv[3]) if len(argv) > 3 else 144
    with ThreadPoolExecutor(min(int(os.environ.get("JOBS", "2")), 2)) as ex:
        for line in ex.map(lambda j: job(root, dset, j[0], j[1], int(j[2]) if len(j) > 2 else frames, extra), jobs):
            print(line, flush=True)


if __name__ == "__main__":
    main()
