"""POM v2 (write-up section 9): the wear rule, the pull-on check and the gathered seam. Pure numpy; no Blender.

Founder answers of 15 Nov 2026 (data/bohohippychic/tape/crimson-wildflower-maxi-skirt.json `founderAnswers`):
- WEAR RULE: every skirt is worn above the hip, just below the navel. Where the band sits is therefore a PLACEMENT
  RULE, not something a band force decides: the band is pinned on a ring at that level.
- CLOSURE: pull-on elastic only. To get the skirt on, the band's stretched girth must pass the widest girth of the
  body below the wear level. Reported here; the sizing decision belongs to @curtain/fit-engine.
- GATHER: the skirt is gathered directly into the band: the panel's top edge is longer than the band and is laid onto
  it in folds (`pleated_ring`).

What is ASSUMED here (none of it measured): the band's top edge sits BELOW_NAVEL_CM under the navel; the band is
BAND_CM high; the simulated ring stands CLEARANCE_CM off the body (collision margin, not a garment property); the
gathers have PARTICLES_PER_FOLD mesh particles per fold (the pitch is limited by the mesh, real gathers are finer).
"""
import numpy as np

BELOW_NAVEL_CM = 2.0       # ASSUMED: "just below the navel" = the band's top edge 2 cm under it
BAND_CM = 4.0              # ASSUMED band height (as pom_rest.py)
CLEARANCE_CM = 0.6         # the pinned ring's distance from the body (collision thicknesses 0.3 + 0.3 cm)
PARTICLES_PER_FOLD = 4     # ASSUMED gather pitch in mesh particles (4 x about 1 cm = a fold every 3-4 cm)


def read_obj(path: str) -> tuple[np.ndarray, np.ndarray]:
    v, f = [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                f.append([int(x.split("/")[0]) - 1 for x in line.split()[1:4]])
    return np.array(v), np.array(f, dtype=np.int64)


def convex_hull(p: np.ndarray) -> np.ndarray:
    """Convex hull of 2-D points, counter-clockwise, no repeated first point."""
    p = p[np.lexsort((p[:, 1], p[:, 0]))]

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for q in p:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in p[::-1]:
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0:
            up.pop()
        up.append(q)
    return np.array(lo[:-1] + up[:-1])


def perimeter(poly: np.ndarray) -> float:
    return float(np.linalg.norm(poly - np.roll(poly, -1, axis=0), axis=1).sum())


class BodySections:
    """Horizontal sections of a body mesh in the mannequin frame (Y up, cm), arm-skinned triangles removed."""

    def __init__(self, verts: np.ndarray, faces: np.ndarray, arm: np.ndarray) -> None:
        tris = faces[~arm[faces].any(1)]
        e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
        self.a, self.b = verts[e[:, 0]], verts[e[:, 1]]

    def hull(self, y: float) -> np.ndarray:
        """Convex hull (x, z) of the section at height y: what a tape around the body there lies on."""
        y = y + 1e-7  # never exactly on a row of vertices
        s = (self.a[:, 1] - y) * (self.b[:, 1] - y) < 0
        a, b = self.a[s], self.b[s]
        if len(a) < 3:
            raise ValueError(f"no body section at y = {y}")
        t = (y - a[:, 1]) / (b[:, 1] - a[:, 1])
        return convex_hull(a[:, [0, 2]] + t[:, None] * (b[:, [0, 2]] - a[:, [0, 2]]))

    def girth(self, y: float) -> float:
        return perimeter(self.hull(y))

    def widest(self, y_top: float, y_bottom: float, step: float = 0.5) -> tuple[float, float]:
        """(girth, height) of the widest section between two heights."""
        ys = np.arange(y_bottom, y_top + 1e-9, step)
        gs = np.array([self.girth(y) for y in ys])
        i = int(np.argmax(gs))
        return float(gs[i]), float(ys[i])


def wear_level(navel_y: float, below_navel_cm: float = BELOW_NAVEL_CM) -> dict:
    """Heights (cm) of the band on a body whose navel is at navel_y: the placement rule."""
    top = navel_y - below_navel_cm
    return {"navelY": round(navel_y, 2), "bandTopY": round(top, 2), "bandMidY": round(top - BAND_CM / 2, 2),
            "seamY": round(top - BAND_CM, 2), "belowNavelCm": below_navel_cm, "bandCm": BAND_CM}


PLACEMENT_SHIFTS_CM = (-2.0, -1.0, 0.0, 1.0, 2.0)  # band moved down (-) or up (+) from the ASSUMED level
PLACEMENT_UNCERTAINTY_CM = 2.0  # stated, not measured: the offset and band height are ASSUMED and Anny's navel is
                                # about 2 cm high against the usual 0.60 of stature (review, section 9.2)


def placement_sensitivity(sections: "BodySections", navel_y: float, relaxed: float, stretched: float) -> dict:
    """How the band-fit verdict depends on the ASSUMED placement (review finding, 15 Nov 2026). The body's girth changes
    by about 2 cm per cm of height below the navel, so a verdict within a few cm of a limit is a statement about the
    assumed offset, not about the garment. Returns the body's girth and the status with the band's mid height shifted
    by PLACEMENT_SHIFTS_CM (+ = higher), the local slope (cm of girth per cm the band moves up; negative), and
    `flipsAtShiftCm`: the smallest shift (to 0.1 cm, within +-4 cm) at which the status's class (loose / holds /
    cannot be worn) changes, or None. `insideUncertainty` is True when that shift is within PLACEMENT_UNCERTAINTY_CM."""
    mid = wear_level(navel_y)["bandMidY"]

    def cls(shift: float) -> str:
        s = band_fit(sections.girth(mid + shift), relaxed, stretched)["status"]
        return s if s in ("loose", "cannot be worn") else "holds"

    at = [{"shiftCm": d, "bodyGirthCm": round(sections.girth(mid + d), 1), "status": band_fit(sections.girth(mid + d), relaxed, stretched)["status"]}
          for d in PLACEMENT_SHIFTS_CM]
    base, flip = cls(0.0), None
    for k in range(1, 41):
        hits = [d for d in (k / 10, -k / 10) if cls(d) != base]
        if hits:
            flip = hits[0]
            break
    slope = (sections.girth(mid + 1.0) - sections.girth(mid - 1.0)) / 2.0
    return {"atShift": at, "girthPerCmUp": round(slope, 2), "flipsAtShiftCm": flip,
            "flipsTo": cls(flip) if flip is not None else None,
            "insideUncertainty": bool(flip is not None and abs(flip) <= PLACEMENT_UNCERTAINTY_CM),
            "uncertaintyCm": PLACEMENT_UNCERTAINTY_CM}


def band_fit(body_girth: float, relaxed: float, stretched: float) -> dict:
    """The band on a body of this girth at the wear level: its girth is the body's, clamped to [relaxed, stretched].
    status: 'relaxed' (within 0.5 cm of the relaxed girth), 'stretched' (by stretchedByCm), 'loose' (the body is smaller
    than the relaxed band by looseByCm: by rule it still sits there, flagged), 'cannot be worn' (the body is larger
    than the stretched limit by overLimitCm: not draped)."""
    girth = min(max(body_girth, relaxed), stretched)
    out = {"bodyGirthCm": round(body_girth, 1), "relaxedCm": round(relaxed, 1), "stretchedCm": round(stretched, 1),
           "bandGirthCm": round(girth, 1)}
    if body_girth > stretched:
        return {**out, "status": "cannot be worn", "overLimitCm": round(body_girth - stretched, 1), "wearable": False}
    if body_girth < relaxed - 0.5:
        return {**out, "status": "loose", "looseByCm": round(relaxed - body_girth, 1), "wearable": True}
    if body_girth <= relaxed + 0.5:
        return {**out, "status": "relaxed", "stretchedByCm": round(max(body_girth - relaxed, 0.0), 1), "wearable": True}
    return {**out, "status": "stretched", "stretchedByCm": round(body_girth - relaxed, 1),
            "ofStretchRange": round((body_girth - relaxed) / (stretched - relaxed), 2), "wearable": True}


def pull_on(widest_girth: float, stretched: float) -> dict:
    """Pull-on closure: the stretched band against the body's widest girth below the wear level (a consequence to
    report, not a sizing decision)."""
    return {"widestGirthCm": round(widest_girth, 1), "stretchedCm": round(stretched, 1),
            "marginCm": round(stretched - widest_girth, 1), "passes": bool(stretched >= widest_girth)}


def offset_curve(hull: np.ndarray, delta: float, step_deg: float = 4.0) -> np.ndarray:
    """The convex hull offset outwards by delta (straight edges joined by arcs): a dense closed polyline. Its length
    is perimeter(hull) + 2 pi delta up to the arc discretisation."""
    n = len(hull)
    pts = []
    for i in range(n):
        p, a, b = hull[i], hull[i - 1], hull[(i + 1) % n]
        d0, d1 = p - a, b - p
        a0 = np.arctan2(d0[1], d0[0]) - np.pi / 2   # outward normal of the incoming edge (hull is counter-clockwise)
        a1 = np.arctan2(d1[1], d1[0]) - np.pi / 2
        while a1 < a0:
            a1 += 2 * np.pi
        k = max(int(np.ceil(np.degrees(a1 - a0) / step_deg)), 1)
        for t in np.linspace(a0, a1, k + 1):
            pts.append(p + delta * np.array([np.cos(t), np.sin(t)]))
    return np.array(pts)


def resample(curve: np.ndarray, frac: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Points and outward unit normals of a closed convex polyline (x, z) at arc-length fractions `frac`, measured from
    the centre front (x = 0, largest z) towards +x: the parametrisation of pom_rest.py's rings."""
    c = np.concatenate([curve, curve[:1]])
    seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
    keep = np.concatenate([[True], seg > 1e-9])
    c = c[keep]
    seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    total = s[-1]
    # Centre front: the crossing of x = 0 with the largest z.
    best, s0 = -np.inf, 0.0
    for i in range(len(c) - 1):
        x0, x1 = c[i, 0], c[i + 1, 0]
        if (x0 <= 0 <= x1 or x1 <= 0 <= x0) and x0 != x1:
            t = x0 / (x0 - x1)
            z = c[i, 1] + t * (c[i + 1, 1] - c[i, 1])
            if z > best:
                best, s0 = z, s[i] + t * seg[i]
    # The hull is counter-clockwise in (x, z); towards +x from the front means decreasing arc length.
    at = (s0 - np.asarray(frac) * total) % total
    pts = np.stack([np.interp(at, s, c[:, 0]), np.interp(at, s, c[:, 1])], 1)
    i = np.clip(np.searchsorted(s, at, side="right") - 1, 0, len(seg) - 1)
    tan = (c[i + 1] - c[i]) / seg[i][:, None]
    nrm = np.stack([tan[:, 1], -tan[:, 0]], 1)  # right of a counter-clockwise tangent = outwards
    return pts, nrm


def ring_length(p: np.ndarray) -> float:
    return float(np.linalg.norm(p - np.roll(p, -1, axis=0), axis=1).sum())


def smooth_ring(hull: np.ndarray, delta: float, frac: np.ndarray) -> np.ndarray:
    return resample(offset_curve(hull, delta), frac)[0]


def pleated_ring(hull: np.ndarray, delta_min: float, frac: np.ndarray, fabric_length: float, folds: int) -> dict:
    """The gathered seam: `len(frac)` particles whose closed polyline has the fabric's length, laid in `folds` radial
    folds on the hull offset. The innermost point of every fold stays delta_min off the hull. Returns the points, the
    fold amplitude (cm, half the fold depth) and the girth of the ring's centre line.
    If the fabric is not longer than the ring at delta_min, there is nothing to gather: the ring is widened until its
    polyline has the fabric's length (amplitude 0)."""
    def ring(amp: float, extra: float = 0.0):
        pts, nrm = resample(offset_curve(hull, delta_min + amp + extra), frac)
        return pts + (amp * np.sin(2 * np.pi * folds * np.asarray(frac)))[:, None] * nrm

    if ring_length(ring(0.0)) >= fabric_length:
        lo, hi = 0.0, 0.0
        base = ring_length(ring(0.0))
        if base > fabric_length + 1e-6:
            return {"points": ring(0.0), "amplitudeCm": 0.0, "folds": 0, "centreGirthCm": round(base, 2),
                    "fabricShortByCm": round(base - fabric_length, 2)}
    lo, hi = 0.0, 1.0
    while ring_length(ring(hi)) < fabric_length:
        hi *= 2
        if hi > 64:
            raise ValueError("pleated_ring: fabric far longer than the ring can take")
    for _ in range(50):
        mid = (lo + hi) / 2
        if ring_length(ring(mid)) < fabric_length:
            lo = mid
        else:
            hi = mid
    amp = (lo + hi) / 2
    return {"points": ring(amp), "amplitudeCm": round(amp, 3), "folds": folds,
            "centreGirthCm": round(perimeter(hull) + 2 * np.pi * (delta_min + amp), 2), "fabricShortByCm": 0.0}


def fold_count(ring_xz: np.ndarray, min_depth_cm: float = 0.3) -> dict:
    """Folds in a closed ring of particles (x, z): the ring's distance from its own smoothed copy changes sign once per
    half fold (after a second high-pass, so a plain oval counts no folds). Counts the outward bulges deeper than min_depth_cm; also the ring's length over its hull (1 = no folds)."""
    n = len(ring_xz)
    w = max(n // 12, 3) | 1
    pad = np.concatenate([ring_xz[-w:], ring_xz, ring_xz[:w]])
    k = np.ones(w) / w
    sm = np.stack([np.convolve(pad[:, c], k, mode="same") for c in range(2)], 1)[w:-w]
    c = ring_xz.mean(0)
    d = np.linalg.norm(ring_xz - c, axis=1) - np.linalg.norm(sm - c, axis=1)
    d = d - np.convolve(np.concatenate([d[-w:], d, d[:w]]), k, mode="same")[w:-w]  # drop what smoothing a plain oval leaves
    count, i = 0, 0
    sign = np.sign(d)
    start = int(np.argmax(sign <= 0)) if (sign <= 0).any() else 0
    dd = np.roll(d, -start)
    while i < n:
        if dd[i] > 0:
            j = i
            while j < n and dd[j] > 0:
                j += 1
            if dd[i:j].max() >= min_depth_cm / 2:
                count += 1
            i = j
        else:
            i += 1
    return {"folds": count, "lengthOverHull": round(ring_length(ring_xz) / perimeter(convex_hull(ring_xz)), 3),
            "depthP95Cm": round(float(np.percentile(np.abs(d), 95)) * 2, 2)}
