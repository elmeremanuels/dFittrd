"""R2 spike (docs/research/step3-serverdrape-spike.md): Anny bodies along ONE shape axis, in the mannequin frame.

Server-side only. Runs in a venv with `pip install anny==0.6.2` (Apache-2.0 code, CC0 assets) and CPU torch; never the
`[smpl]` or `[examples]` extras, never the smplx topology (only the default `anny` topology and rig are used here).

The axis: t in [-1, 1] runs along the skirt's AU body chart (payload sizeChart, body chart): hip(t) = 104 + 10 t cm,
waist(t) = 77.5 + 10 t cm, so t = -1, 0, 1 are the chart's AU 8, 12, 16 bodies. Every body is a female Anny (gender 1,
age 0.5, muscle 0.5) at the canonical mannequin M's stature (168 cm); four parameters are solved per body (Gauss-Newton,
finite differences) to hit stature, chart hip and chart waist: phenotypes `height` and `weight` (with a soft prior
weight ~ 0.5 + 0.3 t) and the local changes `measure-hips-circ-incr` and a waist knob w in [-1, 2] (`measure-waist-circ-incr` = min(w, 1),
then `torso-scale-horiz-incr` = `torso-scale-depth-incr` = max(w - 1, 0)), each local change within Anny's own range
(no phenotype extrapolation). So the set of bodies is a 1-D curve in
Anny's parameter space, not a principal direction of a population.

Measurements (tape-like): girth = perimeter of the convex hull of the horizontal slice of the torso (arm-skinned
triangles removed). hip = girth at the height of the fullest point of the buttocks (largest back extent between 44 % and
60 % of stature); waist = smallest girth between 59 % and 67 % of stature (natural waist; the mannequin ring is at 62 %).

Mannequin frame (packages/mannequin): Y up, cm, floor at y = 0, front +Z, torso centred on x = z = 0. Anny is Z up,
metres, front -Y. Mapping: (x, y, z)_mannequin = 100 * (x, z - zmin, -y)_anny, then x and z shifted so the centre of the
hip slice's bounding box is on the axis (as the mannequin's hip ellipse, cx = cz = 0). A proper rotation (no mirror).

Writes <out>/<id>.obj (triangles, mannequin frame), <out>/armmask.bin (uint8 per vertex) and <out>/bodies.json (parameters, achieved girths, ring heights).
Usage: python anny_bodies.py <outDir> [t1,t2,...]   (default -1,0,1,-0.4; -0.4 is the held-out body: hip 100, waist 73.5)
"""
import json
import sys
import time

import numpy as np
import torch
import anny
import roma

STATURE_CM = 168.0  # mannequin M (packages/mannequin shapes.ts)
HELD_OUT_T = -0.4
ARM_RAISE_DEG = 20.0


def chart(t: float) -> tuple[float, float]:
    """(hip, waist) cm of the skirt's AU body chart at axis value t (AU 8 = -1, 12 = 0, 16 = 1)."""
    return 104.0 + 10.0 * t, 77.5 + 10.0 * t


def au_label(t: float) -> str:
    return f"AU{12 + 4 * t:g}"


def hull_perimeter(p: np.ndarray) -> float:
    p = p[np.lexsort((p[:, 1], p[:, 0]))]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo: list = []
    up: list = []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in p[::-1]:
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0:
            up.pop()
        up.append(q)
    h = np.array(lo[:-1] + up[:-1])
    return float(np.sum(np.linalg.norm(h - np.roll(h, 1, 0), axis=1)))


class Body:
    def __init__(self) -> None:
        self.model = anny.Anny(local_changes="default").to(dtype=torch.float32)
        m = self.model
        self.faces = np.asarray(m.faces)
        bi = m.vertex_bone_indices.numpy()
        bw = m.vertex_bone_weights.numpy()
        arm_words = ("clavicle", "shoulder", "upperarm", "lowerarm", "wrist", "finger", "metacarpal", "hand", "thumb")
        arm_bones = {i for i, l in enumerate(m.bone_labels) if any(k in l for k in arm_words)}
        dominant = bi[np.arange(len(bi)), bw.argmax(1)]
        self.is_arm = np.array([d in arm_bones for d in dominant])
        torso_tris = self.faces[~self.is_arm[self.faces].any(1)]
        self.edges = np.concatenate([torso_tris[:, [0, 1]], torso_tris[:, [1, 2]], torso_tris[:, [2, 0]]])
        # Anny's rest A-pose, with both upper arms raised 20 degrees more (about the bone's local y axis): in the rest
        # pose the hands hang beside the hips (lowest point ~91 cm, at the hip line) where a skirt of the larger sizes
        # would brush them; raised, the hands are ~65 cm out and above 104 cm, clear of the skirt.
        self.pose = torch.eye(4)[None, None].repeat(1, m.bone_count, 1, 1)
        for side, sign in (("L", -1.0), ("R", 1.0)):
            rv = torch.zeros(3)
            rv[1] = sign * np.radians(ARM_RAISE_DEG)
            self.pose[0, m.bone_labels.index(f"upperarm01.{side}"), :3, :3] = roma.rotvec_to_rotmat(rv)
        self.leg_bones = {l: i for i, l in enumerate(m.bone_labels) if l in ("upperleg01.L", "lowerleg01.L", "foot.L")}

    def vertices(self, params: dict) -> np.ndarray:
        """Posed vertices (arms raised, see __init__), Anny frame, metres."""
        ph = {k: 0.5 for k in self.model.phenotype_labels}
        ph.update(gender=1.0, age=0.5, muscle=0.5, weight=params["weight"], height=params["height"])
        w = params["waist"]
        # The waist knob runs past Anny's +1 of `measure-waist-circ-incr` into torso width and depth (w in [-1, 2]):
        # on its own that local change tops out at about 79 cm on the AU 16 body (chart: 87.5).
        lc = {
            "measure-hips-circ-incr": params["hips"],
            "measure-waist-circ-incr": min(w, 1.0),
            "torso-scale-horiz-incr": max(w - 1.0, 0.0),
            "torso-scale-depth-incr": max(w - 1.0, 0.0),
        }
        with torch.no_grad():
            out = self.model(pose_parameters=self.pose, phenotype_kwargs=ph, local_changes_kwargs=lc)
        self.bone_heads = out["bone_poses"][0, :, :3, 3].numpy()
        return out["vertices"][0].numpy().astype(np.float64)

    def girth(self, v: np.ndarray, z: float) -> float:
        a = v[self.edges[:, 0]]
        b = v[self.edges[:, 1]]
        s = (a[:, 2] - z) * (b[:, 2] - z) < 0
        a, b = a[s], b[s]
        if len(a) < 3:
            return float("nan")
        t = (z - a[:, 2]) / (b[:, 2] - a[:, 2])
        return hull_perimeter(a[:, :2] + t[:, None] * (b[:, :2] - a[:, :2]))

    def measure(self, v: np.ndarray) -> dict:
        zmin = v[:, 2].min()
        stature = v[:, 2].max() - zmin
        torso = v[~self.is_arm]
        band = (torso[:, 2] > zmin + 0.44 * stature) & (torso[:, 2] < zmin + 0.60 * stature)
        hip_z = torso[band][np.argmax(torso[band][:, 1]), 2]  # back is +Y in Anny
        zs = np.linspace(zmin + 0.59 * stature, zmin + 0.67 * stature, 33)
        gs = np.array([self.girth(v, z) for z in zs])
        i = int(np.nanargmin(gs))
        return {
            "statureCm": stature * 100,
            "hipCm": self.girth(v, hip_z) * 100,
            "hipY": (hip_z - zmin) * 100,
            "waistCm": gs[i] * 100,
            "waistY": (zs[i] - zmin) * 100,
        }


def solve(body: Body, t: float) -> tuple[dict, dict, np.ndarray]:
    hip_t, waist_t = chart(t)
    target = np.array([STATURE_CM, hip_t, waist_t])
    prior_weight = 0.5 + 0.3 * t
    # Unknowns: phenotype height and weight, local changes hips and waist. Three girth/stature targets plus a soft prior
    # that keeps `weight` near 0.5 + 0.3 t (PRIOR_CM per unit), so the curve stays smooth along t.
    x = np.array([0.62, prior_weight, 0.0, 0.0])
    lo = np.array([0.0, 0.0, -1.0, -1.0])
    hi = np.array([1.0, 1.0, 1.0, 2.0])
    PRIOR_CM = 4.0

    def f(x):
        p = {"height": x[0], "weight": x[1], "hips": x[2], "waist": x[3]}
        meas = body.measure(body.vertices(p))
        y = np.array([meas["statureCm"], meas["hipCm"], meas["waistCm"]])
        return np.append(y - target, PRIOR_CM * (x[1] - prior_weight)), meas, p

    for _ in range(10):
        r, meas, p = f(x)
        if np.max(np.abs(r[:3])) < 0.15:
            break
        J = np.zeros((4, 4))
        for j in range(4):
            d = np.zeros(4)
            d[j] = 0.02
            J[:, j] = (f(x + d)[0] - r) / 0.02
        x = np.clip(x - np.linalg.lstsq(J, r, rcond=None)[0], lo, hi)
    v = body.vertices(p)
    return p, body.measure(v), v


def to_mannequin(body: Body, v: np.ndarray, meas: dict) -> tuple[np.ndarray, dict]:
    zmin = v[:, 2].min()
    out = np.stack([v[:, 0], v[:, 2] - zmin, -v[:, 1]], axis=1) * 100.0
    # Centre the hip slice's bounding box on the axis.
    hy = meas["hipY"]
    a = out[body.edges[:, 0]]
    b = out[body.edges[:, 1]]
    s = (a[:, 1] - hy) * (b[:, 1] - hy) < 0
    tt = (hy - a[s][:, 1]) / (b[s][:, 1] - a[s][:, 1])
    p = a[s][:, [0, 2]] + tt[:, None] * (b[s][:, [0, 2]] - a[s][:, [0, 2]])
    c = (p.min(0) + p.max(0)) / 2
    out[:, 0] -= c[0]
    out[:, 2] -= c[1]
    heads = body.bone_heads
    ring = {
        # Leg ring heights from the left leg's bones (Anny rig), mannequin frame.
        "crotchY": float(min(out[~body.is_arm][np.abs(out[~body.is_arm][:, 0]) < 1.0][:, 1].min(), 999)),
        "kneeY": float((heads[body.leg_bones["lowerleg01.L"], 2] - zmin) * 100),
        "ankleY": float((heads[body.leg_bones["foot.L"], 2] - zmin) * 100),
    }
    return out, ring


def write_obj(path: str, v: np.ndarray, f: np.ndarray) -> None:
    with open(path, "w") as fh:
        fh.write("# Anny 0.6.2 body (Apache-2.0 code, CC0 assets), mannequin frame: Y up, cm, front +Z\n")
        fh.write("".join(f"v {a:.4f} {b:.4f} {c:.4f}\n" for a, b, c in v))
        fh.write("".join(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in f))


def main() -> None:
    out_dir = sys.argv[1]
    ts = [float(s) for s in sys.argv[2].split(",")] if len(sys.argv) > 2 else [-1.0, 0.0, 1.0, HELD_OUT_T]
    t0 = time.process_time()
    body = Body()
    bodies = []
    for t in ts:
        c0 = time.process_time()
        p, meas, v = solve(body, t)
        mv, ring = to_mannequin(body, v, meas)
        bid = f"t{t:+.2f}"
        write_obj(f"{out_dir}/{bid}.obj", mv, body.faces)
        hip_t, waist_t = chart(t)
        entry = {
            "id": bid,
            "t": t,
            "label": au_label(t),
            "heldOut": t not in (-1.0, 0.0, 1.0),
            "target": {"statureCm": STATURE_CM, "hipCm": hip_t, "waistCm": waist_t},
            "params": {"gender": 1.0, "age": 0.5, "muscle": 0.5, **{k: round(float(x), 5) for k, x in p.items()}},
            "achieved": {k: round(float(x), 2) for k, x in meas.items()},
            "rings": {k: round(x, 2) for k, x in ring.items()},
            "cpuSeconds": round(time.process_time() - c0, 1),
        }
        bodies.append(entry)
        print(json.dumps(entry))
    # Arm-skinned vertices (same topology for every body): the drape's push-out ignores them (the A-pose hands hang
    # beside the hips, outside the skirt; the cloth still collides with them).
    body.is_arm.astype(np.uint8).tofile(f"{out_dir}/armmask.bin")
    with open(f"{out_dir}/bodies.json", "w") as fh:
        json.dump({"axis": "AU body chart: hip 104 + 10 t, waist 77.5 + 10 t (t = -1, 0, 1: AU 8, 12, 16)", "anny": anny.__version__ if hasattr(anny, "__version__") else "0.6.2", "bodies": bodies, "cpuSecondsTotal": round(time.process_time() - t0, 1)}, fh, indent=1)


if __name__ == "__main__":
    main()
