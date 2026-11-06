"""Garment masks of generated frames and the stage 2 garment-consistency metric (v2). numpy + Pillow.

Run 11a (the first stage 2 run with the proxy control) kept the dress a dress in every frame, yet the
first consistency metric flagged 233 of 243 frames, frame 0 (the pinned still itself) included. It had
two faults: the "garment" was everything that differed from the border colour by 20 levels, which loses
a cream dress on the light-grey background, and every frame was compared with the coarse proxy
silhouette. Stage 4 on the same frames trained against that same border-colour foreground.

This module replaces both:

``segment_garment``
    The garment in one generated frame, from what we know about the scene rather than from the frame
    alone. Our bare mannequin's silhouette at the same camera is known (rendered from mannequin.glb or
    exported as control/bare_mask): inside it a pixel is either mannequin or garment, never background,
    so a light garment on a light background is still found there. The mannequin colour model (plain
    grey: its chroma and brightness) is sampled from the frame's own head, hands and feet (the bare
    silhouette away from the proxy). Outside the body the garment is what differs from a smooth
    background model (a quadratic per channel, fitted to the frame outside the loose envelope, so the
    noise floor is about 1.5 levels instead of the 20-level tolerance), with hysteresis: weak pixels
    count only when they connect to the garment on the body. Holes up to 0.2% of the frame are filled.

``garment_reference``
    What the garment should look like at every turntable camera: the visual hull carved by the pinned
    front and back stills' garment masks (tight) and by the proxy silhouette of every other camera
    dilated by a few centimetres (loose: the proxy only bounds the depth, which two opposite stills
    cannot see), projected back into each camera.

``frame_garment_consistency``
    One generated garment mask against its reference: IoU, and the drift checks of run 10: for a dress
    or skirt, rows below the crotch where the garment splits into two legs with background between them
    while the reference is closed; for trousers, rows where the reference has two legs and the garment
    one.

Everything is a drift check, not a measurement of the garment (AGENTS.md rule 3).
"""
from __future__ import annotations

import json
import math
import os
from typing import Any, Mapping, Sequence

import numpy as np

GARMENT_SEGMENT_VERSION = "garment-segment-0.1.0"
CONSISTENCY_V2_VERSION = "garment-consistency-0.2.0"

SEGMENT_DEFAULTS: dict[str, float] = {
    "envelope_px": 40,  # the garment lies within the control silhouette dilated by this much
    "body_band_px": 2,  # the outer band of the bare silhouette needs background evidence too (aliasing, small misalignment)
    "bg_lo": 6.0,  # weak foreground: max channel difference from the background model (8-bit) ...
    "bg_hi": 14.0,  # ... strong foreground
    "bg_sigma_lo": 4.0,  # or this many noise sigmas, whichever is larger
    "bg_sigma_hi": 8.0,
    "mannequin_chroma_margin": 4.0,  # over the samples' 99th percentile chroma
    "mannequin_lum_margin": 15.0,  # beyond the samples' 0.5 / 99.5 percentile brightness
    "mannequin_loose_factor": 2.0,  # where our control shows bare mannequin, a looser chroma ceiling (colour bleed at the cuffs)
    "mannequin_min_samples": 300,
    "ambiguous_core_frac": 0.5,  # the garment core reads as mannequin colour: garment ~ mannequin grey
    "hole_frac": 0.01,  # holes up to this share of the frame are filled (not where our control shows bare mannequin)
    "speck_frac": 0.02,  # components below this share of the largest are dropped
    "open_r": 1,
}

# Default mannequin colour model when the frame shows too little bare mannequin to sample: the exporter's
# MANNEQUIN_GREY under the studio light, as Wan2.2 drew it in runs 10 and 11a (chroma <= 8, mean 110-118).
DEFAULT_MANNEQUIN = {"chroma_max": 14.0, "lum_min": 40.0, "lum_max": 190.0, "source": "default grey"}


# --- morphology and components on bool arrays -----------------------------------------------------------


def _box_any(m: np.ndarray, r: int, axis: int) -> np.ndarray:
    n = m.shape[axis]
    c = np.cumsum(m, axis=axis, dtype=np.int32)
    c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
    hi = np.minimum(np.arange(n) + r + 1, n)
    lo = np.maximum(np.arange(n) - r, 0)
    return (np.take(c, hi, axis=axis) - np.take(c, lo, axis=axis)) > 0


def dilate(m: np.ndarray, r: int) -> np.ndarray:
    """Dilation by a (2r+1)^2 square; outside the frame counts as empty."""
    m = np.asarray(m, dtype=bool)
    if r <= 0:
        return m.copy()
    return _box_any(_box_any(m, r, 1), r, 0)


def erode(m: np.ndarray, r: int) -> np.ndarray:
    """Erosion by the same square; outside the frame counts as inside."""
    return ~dilate(~np.asarray(m, dtype=bool), r)


def label(m: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected components (run-based union-find): (labels, n), 0 = empty, labels 1..n."""
    m = np.asarray(m, dtype=bool)
    h, w = m.shape
    d = np.diff(np.pad(m.astype(np.int8), ((0, 0), (1, 1))), axis=1)
    sy, sx = np.nonzero(d == 1)
    _, ex = np.nonzero(d == -1)
    n = len(sy)
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    row_start = np.searchsorted(sy, np.arange(h + 1))
    for y in range(1, h):
        a0, a1 = row_start[y - 1], row_start[y]
        b0, b1 = row_start[y], row_start[y + 1]
        i, j = a0, b0
        while i < a1 and j < b1:
            if sx[i] < ex[j] and sx[j] < ex[i]:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[max(ri, rj)] = min(ri, rj)
            if ex[i] < ex[j]:
                i += 1
            else:
                j += 1
    roots = np.array([find(k) for k in range(n)], dtype=np.int64)
    uniq, ids = np.unique(roots, return_inverse=True)
    lab = np.zeros((h, w), dtype=np.int32)
    for k in range(n):
        lab[sy[k], sx[k]:ex[k]] = ids[k] + 1
    return lab, len(uniq)


def keep_touching(mask: np.ndarray, seed: np.ndarray) -> np.ndarray:
    """The components of `mask` that contain a pixel of `seed` (morphological reconstruction)."""
    lab, n = label(mask)
    if n == 0:
        return np.zeros_like(mask, dtype=bool)
    hit = np.unique(lab[np.asarray(seed, dtype=bool) & (lab > 0)])
    return np.isin(lab, hit[hit > 0])


def drop_small(mask: np.ndarray, frac: float) -> np.ndarray:
    """Drops components smaller than `frac` of the largest."""
    lab, n = label(mask)
    if n <= 1:
        return np.asarray(mask, dtype=bool).copy()
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    sizes[0] = 0
    keep = np.nonzero(sizes >= frac * sizes.max())[0]
    return np.isin(lab, keep[keep > 0])


def fill_holes(mask: np.ndarray, max_px: int) -> np.ndarray:
    """Fills holes (empty components not touching the frame border) of at most `max_px` pixels."""
    mask = np.asarray(mask, dtype=bool)
    lab, n = label(~mask)
    if n == 0:
        return mask.copy()
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    fill = np.ones(n + 1, dtype=bool)
    fill[0] = False
    fill[border] = False
    fill &= sizes <= max_px
    return mask | fill[lab]


def iou(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=bool)
    b = np.asarray(b, dtype=bool)
    u = int((a | b).sum())
    return 1.0 if u == 0 else float((a & b).sum()) / u


# --- the bare mannequin's silhouette from mannequin.glb ---------------------------------------------------


def read_glb_mesh(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """(positions [n,3] metres, faces [m,3]) of every triangle primitive in a .glb (stage 4b's reader)."""
    import stage4b_retexture as s4b

    mesh = s4b.read_glb(data)
    return np.asarray(mesh["positions"], dtype=np.float64), np.asarray(mesh["faces"], dtype=np.int64)


def project_points(K: Sequence[Sequence[float]], w2c: Sequence[Sequence[float]], pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Pixel coordinates (pixel-corner origin, as the exporter's K) and camera depth of world points."""
    K = np.asarray(K, dtype=np.float64)
    w2c = np.asarray(w2c, dtype=np.float64)
    pc = pts @ w2c[:3, :3].T + w2c[:3, 3]
    z = pc[:, 2]
    uv = (pc @ K.T)[:, :2] / np.maximum(z, 1e-9)[:, None]
    return uv, z


def render_silhouette(positions: np.ndarray, faces: np.ndarray, K: Sequence[Sequence[float]], w2c: Sequence[Sequence[float]], width: int, height: int) -> np.ndarray:
    """Silhouette of a triangle mesh at one camera (Pillow polygons; pixel centres at +0.5, as the exporter's
    rasterizer). Within a pixel of the exporter's own control/mask along the outline."""
    from PIL import Image, ImageDraw

    uv, z = project_points(K, w2c, positions)
    tri = uv[faces] - 0.5
    ok = (z[faces] > 0.05).all(axis=1)
    im = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(im)
    for t in tri[ok]:
        draw.polygon([(float(t[0, 0]), float(t[0, 1])), (float(t[1, 0]), float(t[1, 1])), (float(t[2, 0]), float(t[2, 1]))], fill=255)
    return np.asarray(im) > 127


# --- garment segmentation -------------------------------------------------------------------------------


def background_model(rgb: np.ndarray, exclude: np.ndarray, step: int = 4) -> tuple[np.ndarray, np.ndarray, str]:
    """Smooth studio background: a quadratic in (x, y) per channel, fitted (twice, the second time without
    outliers) to the pixels outside `exclude`. Returns (bg [h,w,3] float, noise sigma per channel, source)."""
    h, w, _ = rgb.shape
    ys, xs = np.mgrid[0:h:step, 0:w:step]
    keep = ~np.asarray(exclude, dtype=bool)[::step, ::step]
    vals = rgb[::step, ::step][keep].astype(np.float64)
    if len(vals) < 200:
        band = np.concatenate([rgb[:2].reshape(-1, 3), rgb[-2:].reshape(-1, 3), rgb[:, :2].reshape(-1, 3), rgb[:, -2:].reshape(-1, 3)]).astype(np.float64)
        med = np.median(band, axis=0)
        sigma = np.maximum(1.4826 * np.median(np.abs(band - med), axis=0), 0.5)
        return np.broadcast_to(med, rgb.shape).astype(np.float64), sigma, "border median (too little background outside the envelope)"

    def design(x: np.ndarray, y: np.ndarray) -> np.ndarray:
        x = x / w - 0.5
        y = y / h - 0.5
        return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=-1)

    A = design(xs[keep].astype(np.float64), ys[keep].astype(np.float64))
    coef, *_ = np.linalg.lstsq(A, vals, rcond=None)
    res = vals - A @ coef
    mad = np.median(np.abs(res), axis=0)
    inl = (np.abs(res) <= 4 * 1.4826 * mad + 1.0).all(axis=1)
    if inl.sum() > 100:
        coef, *_ = np.linalg.lstsq(A[inl], vals[inl], rcond=None)
        res = vals[inl] - A[inl] @ coef
    sigma = np.maximum(1.4826 * np.median(np.abs(res - np.median(res, axis=0)), axis=0), 0.5)
    gy, gx = np.mgrid[0:h, 0:w]
    bg = design(gx.astype(np.float64), gy.astype(np.float64)) @ coef
    return bg, sigma, "quadratic fit outside the envelope"


def _lum_chroma(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    f = rgb.astype(np.float32)
    return f.mean(axis=2), f.max(axis=2) - f.min(axis=2)


def head_rows(bare: np.ndarray, frac: float = 0.08) -> np.ndarray:
    """The top `frac` of our bare silhouette's height: the head, which no garment covers."""
    rows = np.nonzero(np.asarray(bare, dtype=bool).any(axis=1))[0]
    out = np.zeros_like(bare, dtype=bool)
    if len(rows):
        y1 = rows[0] + max(4, int(frac * (rows[-1] + 1 - rows[0])))
        out[rows[0]:y1] = bare[rows[0]:y1]
    return out


def mannequin_model(rgb: np.ndarray, head: np.ndarray, visible: np.ndarray, p: Mapping[str, float]) -> dict[str, Any]:
    """Grey mannequin colour model: the chroma ceiling and the brightest level from the head (never covered),
    the darkest level from every pixel where our control shows bare mannequin (head, hands, legs below the
    proxy) whose chroma is within that ceiling (a garment that hangs past the proxy is not grey)."""
    lum, chroma = _lum_chroma(rgb)
    head = np.asarray(head, dtype=bool)
    n = int(head.sum())
    if n < p["mannequin_min_samples"] // 3:
        return {**DEFAULT_MANNEQUIN, "samples": n}
    cmax = float(max(np.percentile(chroma[head], 99) + p["mannequin_chroma_margin"], 6.0))
    vis = np.asarray(visible, dtype=bool) & (chroma <= cmax)
    lv = lum[vis | head]
    return {
        "chroma_max": round(cmax, 2),
        "lum_min": round(float(np.percentile(lv, 0.5) - p["mannequin_lum_margin"]), 2),
        "lum_max": round(float(np.percentile(lum[head], 99.5) + p["mannequin_lum_margin"]), 2),
        "source": "sampled from the frame: head (chroma, brightest), visible bare mannequin (darkest)",
        "samples": int((vis | head).sum()),
    }


def mannequin_like(rgb: np.ndarray, model: Mapping[str, Any], chroma_factor: float = 1.0, lum_extra: float = 0.0) -> np.ndarray:
    lum, chroma = _lum_chroma(rgb)
    return (chroma <= model["chroma_max"] * chroma_factor) & (lum >= model["lum_min"] - lum_extra) & (lum <= model["lum_max"])


def segment_garment(rgb: np.ndarray, bare: np.ndarray, envelope: np.ndarray, prior: np.ndarray | None = None, params: Mapping[str, float] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
    """Garment mask of one generated frame.

    rgb       [h, w, 3] uint8, the generated frame
    bare      our bare mannequin's full silhouette at this camera (not occluded by any garment)
    envelope  where the garment may be: the control silhouette (mannequin + proxy); dilated by
              `envelope_px`, so a garment wider than the proxy is still found
    prior     the proxy's visible mask at this camera (optional): keeps the proxy region out of the
              mannequin colour samples and tells whether the garment colour can be told from the grey
    """
    p = {**SEGMENT_DEFAULTS, **(params or {})}
    rgb = np.asarray(rgb)[..., :3]
    h, w, _ = rgb.shape
    bare = np.asarray(bare, dtype=bool)
    envelope = np.asarray(envelope, dtype=bool) | bare
    env = dilate(envelope, int(p["envelope_px"]))
    prior_m = np.zeros_like(bare) if prior is None else np.asarray(prior, dtype=bool)

    bg, sigma, bg_source = background_model(rgb, env)
    dbg = np.abs(rgb.astype(np.float64) - bg).max(axis=2)
    s = float(sigma.max())
    lo = max(p["bg_lo"], p["bg_sigma_lo"] * s)
    hi = max(p["bg_hi"], p["bg_sigma_hi"] * s)

    # Where our own control shows the bare mannequin (head, hands, legs below the proxy).
    visible = bare & ~dilate(prior_m, 2) if prior is not None else bare
    fgm = dbg > hi
    model = mannequin_model(rgb, erode(head_rows(bare), 2) & fgm, erode(visible, 3) & fgm, p)
    # Only where the mannequin can be: inside our bare silhouette (plus a 2 px band for misalignment).
    # Where the control shows bare mannequin, a looser test (colour bleeds from the cuffs onto the hands);
    # inside the proxy the strict one (a shaded light garment turns grey).
    near_body = dilate(bare, 2)
    manq = near_body & (mannequin_like(rgb, model) | (dilate(visible, 2) & mannequin_like(rgb, model, p["mannequin_loose_factor"], p["mannequin_lum_margin"])))

    inner = erode(bare, int(p["body_band_px"]))
    core = erode(prior_m & bare, 4)
    core_n = int(core.sum())
    core_manq = float(manq[core].mean()) if core_n else None
    ambiguous = core_manq is not None and core_manq > p["ambiguous_core_frac"]

    if ambiguous:
        on_body = inner & prior_m  # cannot tell garment from mannequin by colour: trust the proxy on the body
    else:
        on_body = inner & ~manq
    weak = env & ~manq & (dbg > lo)
    strong = env & ~manq & (dbg > hi)
    cand = on_body | weak
    seed = drop_small(on_body, p["speck_frac"]) if on_body.any() else strong
    g = keep_touching(cand, seed)
    r = int(p["open_r"])
    if r > 0:
        g = dilate(erode(g, r), r) | (g & on_body)
    # Holes: shaded garment inside the proxy reads as grey and is filled; mannequin seen in front of the
    # garment in our control (a hand over the skirt) stays out.
    keep_out = manq & visible
    g = g | (fill_holes(g, int(p["hole_frac"] * h * w)) & ~keep_out)
    g = drop_small(g, p["speck_frac"])
    outside = g & ~bare
    info = {
        "version": GARMENT_SEGMENT_VERSION,
        "garment_px": int(g.sum()),
        "background": {"source": bg_source, "mean_rgb": [round(float(v), 1) for v in bg.reshape(-1, 3).mean(axis=0)], "sigma": [round(float(v), 2) for v in sigma], "lo": round(lo, 2), "hi": round(hi, 2)},
        "mannequin": model,
        "core_mannequin_frac": None if core_manq is None else round(core_manq, 4),
        "ambiguous_with_mannequin": bool(ambiguous),
        # Garment contrast against the background where only the background model can find it (off the body).
        "contrast_off_body": None if not outside.any() else round(float(np.median(dbg[outside])), 2),
        "contrast_on_body": None if not (g & bare).any() else round(float(np.median(dbg[g & bare])), 2),
    }
    return g, info


# --- the job: masks per frame -----------------------------------------------------------------------------


def _read_mask(path: str) -> np.ndarray:
    from PIL import Image

    a = np.asarray(Image.open(path))
    return (a[..., 0] if a.ndim == 3 else a) > 127


def _read_rgb(path: str) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"))


class JobScene:
    """What a job knows about each camera: our bare silhouette, the control silhouette and the proxy mask.

    The bare silhouette comes from `control.bare_mask_dir` / `motion.bare_mask_dir` (exported since
    phase0-export-0.3.0), from control/mask in bare mode, or else is rendered from mannequin.glb at the
    turntable cameras. The motion clip of an older proxy job has no bare silhouette (the mannequin is
    posed); there the visible mannequin outside the proxy (control mask minus proxy mask) stands in.
    """

    def __init__(self, job_dir: str, manifest: Mapping[str, Any]):
        self.job = job_dir
        self.m = manifest
        with open(os.path.join(job_dir, manifest["camera"]["opencv"])) as f:
            self.cams = json.load(f)
        self.K = self.cams["K"]
        self.w2c = {fr["index"]: fr["w2c"] for fr in self.cams["frames"]}
        self.width, self.height = int(manifest["camera"]["width"]), int(manifest["camera"]["height"])
        self.mode = manifest["control"].get("mode", "bare")
        self._mesh: tuple[np.ndarray, np.ndarray] | None = None
        self.bare_source: dict[str, str] = {}

    def _section(self, kind: str) -> Mapping[str, Any]:
        return self.m["control"] if kind == "turntable" else self.m["motion"]

    def control(self, kind: str, idx: int) -> np.ndarray:
        return _read_mask(os.path.join(self.job, self._section(kind)["mask_dir"], f"{idx:04d}.png"))

    def proxy(self, kind: str, idx: int) -> np.ndarray | None:
        d = self._section(kind).get("proxy_mask_dir")
        return _read_mask(os.path.join(self.job, d, f"{idx:04d}.png")) if d else None

    def bare(self, kind: str, idx: int) -> np.ndarray:
        sec = self._section(kind)
        if sec.get("bare_mask_dir"):
            self.bare_source[kind] = "exported bare mask"
            return _read_mask(os.path.join(self.job, sec["bare_mask_dir"], f"{idx:04d}.png"))
        if self.mode == "bare":
            self.bare_source[kind] = "control mask (bare control)"
            return self.control(kind, idx)
        if kind == "turntable":
            if self._mesh is None:
                with open(os.path.join(self.job, self.m["mannequin"]["glb"]), "rb") as f:
                    self._mesh = read_glb_mesh(f.read())
            self.bare_source[kind] = "rendered from mannequin.glb"
            return render_silhouette(*self._mesh, self.K, self.w2c[idx], self.width, self.height)
        self.bare_source[kind] = "visible mannequin outside the proxy (posed mannequin not exported)"
        c, pr = self.control(kind, idx), self.proxy(kind, idx)
        return c & ~pr if pr is not None else c

    def segment(self, rgb: np.ndarray, kind: str, idx: int, params: Mapping[str, float] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        ctrl = self.control(kind, idx)
        pr = self.proxy(kind, idx)
        return segment_garment(rgb, self.bare(kind, idx), ctrl if pr is None else (ctrl | pr), pr, params)


def stills_garment_masks(scene: JobScene) -> dict[str, dict[str, Any]]:
    """The pinned stills' garment masks: stage 1b's when it wrote them, else segmented from the still at
    its camera (frame 0 = front, N/2 = back). {view: {frame, mask, source}}"""
    import phase0_lib as lib

    n = int(scene.m["camera"]["frames"])
    out: dict[str, dict[str, Any]] = {}
    for view, idx in (("front", 0), ("back", n // 2)):
        s1b = os.path.join(scene.job, "stage1b", f"garment_mask_{view}.png")
        if os.path.exists(s1b):
            out[view] = {"frame": idx, "mask": _read_mask(s1b), "source": f"stage1b/garment_mask_{view}.png"}
            continue
        try:
            path = os.path.join(scene.job, lib.photo_path(scene.m, view))
        except Exception:  # noqa: BLE001 - no still for this view
            continue
        g, info = scene.segment(_read_rgb(path), "turntable", idx)
        out[view] = {"frame": idx, "mask": g, "source": f"segmented from {lib.photo_path(scene.m, view)}", "info": info}
    return out


# --- reference: pinned stills carried to every camera through a visual hull -------------------------------


REFERENCE_DEFAULTS = {"voxel_m": 0.01, "envelope_px": 10, "carve_every": 2, "splat_px": 2}


def garment_reference(scene: JobScene, stills: Mapping[str, Mapping[str, Any]], params: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Visual hull of the garment in mannequin space: voxels inside the pinned stills' garment masks (tight)
    and inside every other carved camera's proxy (or control) silhouette dilated by `envelope_px` (loose: it
    only bounds the depth the two opposite stills cannot see). `project(idx)` gives its silhouette at a
    turntable camera. Units: metres."""
    p = {**REFERENCE_DEFAULTS, **(params or {})}
    K = scene.K
    w, h = scene.width, scene.height
    pinned = {int(s["frame"]): np.asarray(s["mask"], dtype=bool) for s in stills.values()}
    if not pinned:
        raise ValueError("no pinned still to build the garment reference from")
    # Bounds: everything inside the dilated control silhouettes of the front and the side camera.
    idxs = sorted(scene.w2c)
    side = idxs[len(idxs) // 4]
    env = {i: dilate(scene.control("turntable", i) if scene.proxy("turntable", i) is None else (scene.proxy("turntable", i) | scene.control("turntable", i)), int(p["envelope_px"])) for i in idxs[:: int(p["carve_every"])]}
    lo = np.array([-1.0, 0.0, -0.6])
    hi = np.array([1.0, 2.0, 0.6])
    v = float(p["voxel_m"])
    gx = np.arange(lo[0], hi[0], v) + v / 2
    gy = np.arange(lo[1], hi[1], v) + v / 2
    gz = np.arange(lo[2], hi[2], v) + v / 2
    X, Y, Z = np.meshgrid(gx, gy, gz, indexing="ij")
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)

    def inside(mask: np.ndarray, idx: int, pts: np.ndarray) -> np.ndarray:
        uv, z = project_points(K, scene.w2c[idx], pts)
        x = np.floor(uv[:, 0]).astype(np.int64)
        y = np.floor(uv[:, 1]).astype(np.int64)
        ok = (z > 0) & (x >= 0) & (x < w) & (y >= 0) & (y < h)
        out = np.zeros(len(pts), dtype=bool)
        out[ok] = mask[y[ok], x[ok]]
        return out

    for idx in (0, side):  # cheap pre-cut with two loose envelopes
        if idx in env:
            pts = pts[inside(env[idx], idx, pts)]
    for idx, mask in pinned.items():
        pts = pts[inside(mask, idx, pts)]
    for idx, mask in env.items():
        if idx in pinned:
            continue
        pts = pts[inside(mask, idx, pts)]
    splat = int(p["splat_px"])

    def project(idx: int) -> np.ndarray:
        if idx in pinned:
            return pinned[idx].copy()
        uv, z = project_points(K, scene.w2c[idx], pts)
        x = np.floor(uv[:, 0]).astype(np.int64)
        y = np.floor(uv[:, 1]).astype(np.int64)
        ok = (z > 0) & (x >= 0) & (x < w) & (y >= 0) & (y < h)
        m = np.zeros((h, w), dtype=bool)
        m[y[ok], x[ok]] = True
        m = erode(dilate(m, splat), splat)
        return fill_holes(m, int(0.002 * w * h))

    return {"points": pts, "voxel_m": v, "pinned_frames": sorted(pinned), "carved_frames": sorted(env), "project": project, "params": p}


# --- per-frame consistency v2 -----------------------------------------------------------------------------


def runs(row: np.ndarray) -> list[tuple[int, int]]:
    d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0].tolist(), np.nonzero(d == -1)[0].tolist()))


def leg_rows(bare: np.ndarray) -> tuple[int, int, int, int] | None:
    """Rows and columns where our bare mannequin's legs stand apart: (y0, y1, x0, x1), y1 exclusive, from
    the first row below the torso where the silhouette within the central columns splits into two runs
    down to the last such row. None in a side view (the legs overlap)."""
    bare = np.asarray(bare, dtype=bool)
    rows = np.nonzero(bare.any(axis=1))[0]
    if len(rows) == 0:
        return None
    top, bottom = rows[0], rows[-1] + 1
    hip = top + int(0.45 * (bottom - top))
    split = []
    for y in range(hip, bottom):
        rr = runs(bare[y])
        if len(rr) < 2:
            continue
        # The two runs nearest the body axis (the median column of the lower body) must flank it.
        xs = np.nonzero(bare[hip:bottom].any(axis=0))[0]
        axis = (xs[0] + xs[-1]) / 2
        left = [r for r in rr if r[1] <= axis]
        right = [r for r in rr if r[0] >= axis]
        if left and right:
            split.append((y, left[-1][0], right[0][1]))
    if len(split) < 4:
        return None
    ys = [s[0] for s in split]
    return ys[0], ys[-1] + 1, min(s[1] for s in split), max(s[2] for s in split)


def gap_profile(garment: np.ndarray, reference: np.ndarray, legs: tuple[int, int, int, int] | None) -> dict[str, int]:
    """Within the leg rows (and columns): rows where the reference is one closed run but the garment splits
    into two or more with a gap of >= 2 px (`leg_gap_rows`, a dress or skirt turning into trousers), and rows
    where the reference has two runs but the garment one (`merged_leg_rows`, trousers turning into a skirt).
    Rows count only where both cover the leg columns at all."""
    out = {"leg_gap_rows": 0, "merged_leg_rows": 0, "leg_zone_rows": 0}
    if legs is None:
        return out
    y0, y1, x0, x1 = legs
    for y in range(y0, y1):
        g = runs(garment[y, x0:x1])
        r = runs(reference[y, x0:x1])
        if not g or not r:
            continue
        out["leg_zone_rows"] += 1
        g_gap = len(g) >= 2 and max(b[0] - a[1] for a, b in zip(g, g[1:])) >= 2
        r_gap = len(r) >= 2 and max(b[0] - a[1] for a, b in zip(r, r[1:])) >= 2
        if g_gap and not r_gap:
            out["leg_gap_rows"] += 1
        elif r_gap and not g_gap:
            out["merged_leg_rows"] += 1
    return out


CONSISTENCY_V2_THRESHOLDS: dict[str, float] = {
    # Turntable frames, against the pinned stills carried by the camera (see the README for how these were
    # set on run 11a, where no frame drifted, and run 10, where the dress became trousers between the
    # pinned frames).
    "min_garment_iou": 0.80,
    # Motion frames (posed, no hull): against the posed proxy, a loose envelope only.
    "min_envelope_cover": 0.75,
    # Drift checks, share of the leg rows.
    "max_leg_gap_frac": 0.15,
    "max_merged_leg_frac": 0.15,
}


def frame_garment_consistency(garment: np.ndarray, reference: np.ndarray, bare: np.ndarray, *, kind: str, reference_kind: str) -> dict[str, Any]:
    """One generated frame's garment mask against its reference (`reference_kind`: 'pinned hull' or 'proxy
    envelope'). `kind` is the proxy kind (dress, skirt, trousers, top, outerwear)."""
    g = np.asarray(garment, dtype=bool)
    r = np.asarray(reference, dtype=bool)
    gn, rn = int(g.sum()), int(r.sum())
    inter = int((g & r).sum())
    legs = leg_rows(bare) if kind in ("dress", "skirt", "trousers") else None
    gp = gap_profile(g, r, legs)
    hem = lambda m: None if not m.any() else int(np.nonzero(m.any(axis=1))[0][-1])  # noqa: E731
    gh, rh = hem(g), hem(r)
    return {
        "reference": reference_kind,
        "garment_px": gn,
        "garment_iou": round(iou(g, r), 4),
        "reference_cover": None if rn == 0 else round(inter / rn, 4),
        "garment_inside": None if gn == 0 else round(inter / gn, 4),
        "hem_offset_px": None if gh is None or rh is None else gh - rh,
        **gp,
        "drift_visible": legs is not None,
    }


def garment_flags(row: Mapping[str, Any], kind: str, thresholds: Mapping[str, float] | None = None) -> list[str]:
    t = {**CONSISTENCY_V2_THRESHOLDS, **(thresholds or {})}
    out: list[str] = []
    if row["garment_px"] == 0:
        return ["no garment found"]
    if row["reference"] == "pinned hull":
        if row["garment_iou"] < t["min_garment_iou"]:
            out.append(f"garment IoU vs the pinned stills {row['garment_iou']:.3f} < {t['min_garment_iou']}")
    elif row["reference_cover"] is not None and row["reference_cover"] < t["min_envelope_cover"]:
        out.append(f"posed proxy covered {row['reference_cover']:.3f} < {t['min_envelope_cover']}")
    zone = row.get("leg_zone_rows") or 0
    if zone:
        if kind in ("dress", "skirt") and row["leg_gap_rows"] / zone > t["max_leg_gap_frac"]:
            out.append(f"gap between the legs in {row['leg_gap_rows']}/{zone} leg rows (dress/skirt drawn as trousers)")
        if kind == "trousers" and row["merged_leg_rows"] / zone > t["max_merged_leg_frac"]:
            out.append(f"legs merged in {row['merged_leg_rows']}/{zone} leg rows (trousers drawn as a skirt)")
    return out


CONSISTENCY_V2_LABEL = (
    "garment consistency v2: each generated frame's garment (segmented against our own bare mannequin and a "
    "background model) vs the pinned front/back stills carried to that camera through a visual hull (the "
    "proxy only bounds the depth the two stills cannot see); motion frames vs the posed proxy as a loose "
    "envelope. Drift checks: a gap between the legs for a dress or skirt, merged legs for trousers, only in "
    "frames where our mannequin's legs stand apart (`drift_visible`). A drift check, not a measurement of the "
    "garment. A garment the colour of the grey mannequin cannot be told from it by colour "
    "(`ambiguous_with_mannequin`): on the body the proxy is used instead."
)


def score_job(job_dir: str, manifest: Mapping[str, Any], clip_ids: Sequence[str] | None = None, *, thresholds: Mapping[str, float] | None = None, write_masks: str | None = None, frames_dir: str | None = None) -> dict[str, Any]:
    """Consistency v2 for every generated clip frame of a job (stage2/clips/<clip>/NNNN.png), plus the
    garment masks of the assembled turntable (stage2/frames) when `frames_dir` is given; masks are written
    to `write_masks`/NNNN.png (the stage 4 alpha targets). Returns the `consistency` block."""
    import time

    from PIL import Image

    t0 = time.time()
    scene = JobScene(job_dir, manifest)
    proxy_spec = manifest["control"].get("proxy") or {}
    kind = proxy_spec.get("kind") or {"dress": "dress", "top": "top", "outerwear": "outerwear"}.get(manifest.get("category"), "dress")
    stills = stills_garment_masks(scene)
    ref = garment_reference(scene, stills)
    t = {**CONSISTENCY_V2_THRESHOLDS, **(thresholds or {})}
    wanted = set(clip_ids) if clip_ids is not None else None
    rows: list[dict[str, Any]] = []
    ref_cache: dict[int, np.ndarray] = {}
    for clip in manifest["clips"]:
        if wanted is not None and clip["id"] not in wanted:
            continue
        ckind = clip.get("kind", "motion" if clip["id"] == "motion" else "turntable")
        for j, idx in enumerate(clip["frame_indices"]):
            path = os.path.join(job_dir, "stage2", "clips", clip["id"], f"{j:04d}.png")
            if not os.path.exists(path):
                continue
            rgb = _read_rgb(path)
            g, info = scene.segment(rgb, ckind, idx)
            bare = scene.bare(ckind, idx)
            if ckind == "turntable":
                if idx not in ref_cache:
                    ref_cache[idx] = ref["project"](idx)
                reference, rk = ref_cache[idx], "pinned hull"
            else:
                pr = scene.proxy(ckind, idx)
                reference, rk = (pr if pr is not None else scene.control(ckind, idx)), "proxy envelope"
            row = {"clip": clip["id"], "j": j, "frame": idx, **frame_garment_consistency(g, reference, bare, kind=kind, reference_kind=rk),
                   "ambiguous_with_mannequin": info["ambiguous_with_mannequin"], "contrast_off_body": info["contrast_off_body"]}
            row["reasons"] = garment_flags(row, kind, t)
            row["flagged"] = bool(row["reasons"])
            rows.append(row)
    masks_written = 0
    if frames_dir and write_masks:
        os.makedirs(write_masks, exist_ok=True)
        for idx in sorted(scene.w2c):
            path = os.path.join(frames_dir, f"{idx:04d}.png")
            if not os.path.exists(path):
                continue
            g, _ = scene.segment(_read_rgb(path), "turntable", idx)
            Image.fromarray((g * 255).astype(np.uint8)).save(os.path.join(write_masks, f"{idx:04d}.png"))
            masks_written += 1
    return consistency_v2_summary(rows, kind=kind, thresholds=t, stills={v: {"frame": s["frame"], "source": s["source"]} for v, s in stills.items()},
                                  bare_source=dict(scene.bare_source), reference={"voxels": int(len(ref["points"])), "voxel_m": ref["voxel_m"], "pinned_frames": ref["pinned_frames"], "carved_frames": len(ref["carved_frames"])},
                                  masks_written=masks_written, seconds=round(time.time() - t0, 1))


def consistency_v2_summary(rows: Sequence[Mapping[str, Any]], *, kind: str, thresholds: Mapping[str, float], **extra: Any) -> dict[str, Any]:
    def stats(rs: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {"frames": len(rs), "flagged": sum(1 for r in rs if r["flagged"])}
        for k in ("garment_iou", "reference_cover", "garment_inside"):
            vals = [r[k] for r in rs if r.get(k) is not None]
            out[k] = None if not vals else {"min": round(min(vals), 4), "mean": round(sum(vals) / len(vals), 4)}
        return out

    clips: dict[str, list[Mapping[str, Any]]] = {}
    for r in rows:
        clips.setdefault(r["clip"], []).append(r)
    ref = lambda r: {"clip": r["clip"], "j": r["j"], "frame": r["frame"]}  # noqa: E731
    flagged = [{**ref(r), "reasons": r["reasons"]} for r in rows if r["flagged"]]
    return {
        "version": CONSISTENCY_V2_VERSION,
        "segmentation": GARMENT_SEGMENT_VERSION,
        "proxy_kind": kind,
        "thresholds": dict(thresholds),
        "thresholds_note": "set on run 11a (no drift) and run 10 (dress drawn as trousers), CPU, see modal/README.md",
        **stats(rows),
        "per_clip": {c: stats(rs) for c, rs in clips.items()},
        "flagged_frames": flagged,
        "blind_frames": [ref(r) for r in rows if not r["drift_visible"]],
        "ambiguous_frames": [ref(r) for r in rows if r.get("ambiguous_with_mannequin")],
        "pass": not flagged,
        "label": CONSISTENCY_V2_LABEL,
        **extra,
        "frames_detail": list(rows),
    }
