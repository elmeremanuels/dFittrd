"""R2 spike: penetration check and a projection-only polish of blended garments (no cling, no simulation).

blender -b --factory-startup -P polish_blender.py -- --body B.obj --in A.bin[,B.bin...]
For every garment file: counts particles inside the body (nearest surface point, normal test), writes <name>__polished.bin
with each inside particle moved to the surface plus 2 mm along the surface normal, and prints one JSON line per file.
This is the "polish" the plan asks to measure with and without; it only removes interpenetration, it never pulls cloth
towards the body (the cling that collapsed the spread in the browser drape is not used).
"""
import json
import sys
import time

import bpy  # noqa: F401  (runs inside Blender)
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CLEAR_CM = 0.2


def args():
    a = sys.argv[sys.argv.index("--") + 1:]
    return {a[i].lstrip("-"): a[i + 1] for i in range(0, len(a), 2)}


def read_obj(path):
    v, f = [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                f.append([int(x.split("/")[0]) - 1 for x in line.split()[1:4]])
    return np.array(v), f


def main():
    a = args()
    bv, bf = read_obj(a["body"])
    bvh = BVHTree.FromPolygons([Vector(x) for x in bv], bf)  # mannequin frame, cm
    for path in a["in"].split(","):
        t0 = time.process_time()
        g = np.fromfile(path, dtype=np.float32).reshape(-1, 3).astype(np.float64)
        out = g.copy()
        depth = []
        for i, p in enumerate(g):
            loc, n, _, dist = bvh.find_nearest(Vector(p))
            if loc is not None and (Vector(p) - loc).dot(n) < 0:
                depth.append(dist)
                out[i] = np.array(loc + n * CLEAR_CM)
        dst = path[:-4] + "__polished.bin"
        out.astype(np.float32).tofile(dst)
        print("POLISH " + json.dumps({"file": path, "inside": len(depth), "depthCmP95": round(float(np.percentile(depth, 95)), 2) if depth else 0.0, "depthCmMax": round(float(max(depth)), 2) if depth else 0.0, "cpuSeconds": round(time.process_time() - t0, 2), "out": dst}))


main()
