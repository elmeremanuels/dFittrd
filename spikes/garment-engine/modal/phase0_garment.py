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
    noise sigma measured on run 11a about 0.5 levels instead of the 20-level tolerance), with hysteresis:
    weak pixels count only when they connect to the garment on the body. Holes up to 1% of the frame
    (`hole_frac`) are filled.

``garment_reference``
    What the garment should look like at every turntable camera: the visual hull carved by the pinned
    front and back stills' garment masks (tight) and by the proxy silhouette of every other camera
    dilated by a few centimetres (loose: the proxy only bounds the depth, which two opposite stills
    cannot see), projected back into each camera.

``frame_garment_consistency``
    One generated garment mask against its reference: IoU, the share of the reference covered and of the
    garment outside it, and the drift checks of run 10: for a dress or skirt, how much of the reference's
    closed skirt below the crotch the garment covers (run 10's trousers had touching legs, so they rarely
    left a background gap on the axis) and rows where the garment splits into two legs with background
    between them; for trousers, rows where the reference has two legs and the garment one.

``off_reference``
    (consistency 0.4.0) Garment the pinned stills do not have, below the hips: pixels of the frame's garment
    more than a few px outside the visual hull, off our bare mannequin, per image side. Runs 16b and 17b
    drew a cream hem flap at the image-left side of turntable_b (frames ~95-159) and a pale panel beside the
    hem of turntable_a (13-31); the garment IoU flagged only b 114-127, and stage 4t fitted the flap as hem
    girth (157.7 cm vs 149.5 in run 15). Measured on its own hull, carved with a looser envelope (8 px
    instead of 4): the stills overhang the control proxy at the hem by up to ~17 px a side, and the 4 px
    envelope carves that overhang off the hull at the cameras next to the pins, so every run (run 15 too)
    would read 900+ px off the reference at frames 1-8 and 150-159 though nothing was drawn there.

Everything is a drift check, not a measurement of the garment (AGENTS.md rule 3).
"""
from __future__ import annotations

import json
import os
from typing import Any, Mapping, Sequence

import numpy as np

GARMENT_SEGMENT_VERSION = "garment-segment-0.1.0"
CONSISTENCY_V2_VERSION = "garment-consistency-0.4.0"

SEGMENT_DEFAULTS: dict[str, float] = {
    "envelope_px": 40,  # the garment lies within the control silhouette dilated by this much
    "body_band_px": 2,  # the outer band of the bare silhouette needs background evidence too (aliasing, small misalignment)
    "bg_lo": 6.0,  # weak foreground: max channel difference from the background model (8-bit) ...
    "bg_hi": 14.0,  # ... strong foreground
    "bg_sigma_lo": 4.0,  # or this many noise sigmas, whichever is larger
    "bg_sigma_hi": 8.0,
    "mannequin_chroma_margin": 3.0,  # over the head's 99th percentile chroma
    "mannequin_lum_margin": 10.0,  # below the darkest and above the brightest sampled level
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


_GLB_DTYPE = {5120: "<i1", 5121: "<u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
_GLB_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _glb_node_matrix(node: Mapping[str, Any]) -> np.ndarray:
    if "matrix" in node:
        return np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4).T  # column-major
    qx, qy, qz, qw = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    r = np.array([
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * np.asarray(node.get("scale", (1.0, 1.0, 1.0)))[None, :]
    m[:3, 3] = node.get("translation", (0.0, 0.0, 0.0))
    return m


def read_glb_mesh(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """(positions [n,3], faces [m,3]) of every triangle primitive under the default scene of a .glb, node
    transforms applied (the same subset of glTF as stage4b_retexture.read_glb, in numpy, so the stage 2
    image needs no other module)."""
    import struct

    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("not a GLB")
    _, length = struct.unpack_from("<II", data, 4)
    gltf, binary, off = None, b"", 12
    while off + 8 <= min(length, len(data)):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binary = chunk
        off += 8 + clen
    if gltf is None:
        raise ValueError("GLB without a JSON chunk")

    def accessor(i: int) -> np.ndarray:
        acc = gltf["accessors"][i]
        view = gltf["bufferViews"][acc["bufferView"]]
        n = _GLB_NCOMP[acc["type"]]
        dt = np.dtype(_GLB_DTYPE[acc["componentType"]])
        start = int(view.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
        stride = int(view.get("byteStride", 0)) or n * dt.itemsize
        count = int(acc["count"])
        raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (count - 1) + n * dt.itemsize if count else 0, offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, shape=(count, n * dt.itemsize), strides=(stride, 1)) if count else raw.reshape(0, n * dt.itemsize)
        return np.ascontiguousarray(rows).view(dt).reshape(count, n)

    pos: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    base = 0

    def visit(ni: int, parent: np.ndarray) -> None:
        nonlocal base
        node = gltf["nodes"][ni]
        m = parent @ _glb_node_matrix(node)
        if "mesh" in node:
            for prim in gltf["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                p = accessor(prim["attributes"]["POSITION"]).astype(np.float64)
                p = p @ m[:3, :3].T + m[:3, 3]
                idx = accessor(prim["indices"]).reshape(-1).astype(np.int64) if "indices" in prim else np.arange(len(p))
                pos.append(p)
                faces.append(idx.reshape(-1, 3) + base)
                base += len(p)
        for c in node.get("children", []):
            visit(c, m)

    scenes = gltf.get("scenes")
    roots = scenes[gltf.get("scene", 0)].get("nodes", []) if scenes else range(len(gltf.get("nodes", [])))
    for ni in roots:
        visit(ni, np.eye(4))
    if not faces:
        raise ValueError("GLB without triangles")
    return np.concatenate(pos), np.concatenate(faces)


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
    # Seeds: the garment on the body, and strong foreground well inside the proxy (where only the visible
    # part of a posed mannequin is known, the garment on the body is not).
    seed = drop_small(on_body | (strong & erode(prior_m, 3)), p["speck_frac"])
    if not seed.any():
        seed = strong
    g = keep_touching(cand, seed)
    r = int(p["open_r"])
    if r > 0:
        g = dilate(erode(g, r), r) | (g & on_body)
    # Holes: shaded garment inside the proxy reads as grey and is filled; mannequin seen in front of the
    # garment in our control (a hand over the skirt) stays out.
    keep_out = manq & dilate(visible, 2)
    g = g | (fill_holes(g, int(p["hole_frac"] * h * w)) & ~keep_out)
    g = drop_small(g, p["speck_frac"])
    outside = g & ~bare
    # Strong foreground far from where any garment can be: text, logos, props (run 10 drew the product
    # name above the mannequin). Components under 20 px are noise.
    stray = (dbg > hi) & ~env
    stray_px = 0
    if stray.any():
        lab, n = label(stray)
        sizes = np.bincount(lab.ravel(), minlength=n + 1)[1:]
        stray_px = int(sizes[sizes >= 20].sum())
    info = {
        "version": GARMENT_SEGMENT_VERSION,
        "garment_px": int(g.sum()),
        "background": {"source": bg_source, "mean_rgb": [round(float(v), 1) for v in bg.reshape(-1, 3).mean(axis=0)], "sigma": [round(float(v), 2) for v in sigma], "lo": round(lo, 2), "hi": round(hi, 2)},
        "mannequin": model,
        "core_mannequin_frac": None if core_manq is None else round(core_manq, 4),
        "ambiguous_with_mannequin": bool(ambiguous),
        # Garment contrast against the background where only the background model can find it (off the body).
        "contrast_off_body": None if not outside.any() else round(float(np.median(dbg[outside])), 2),
        "stray_px": stray_px,
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


REFERENCE_DEFAULTS = {"voxel_m": 0.01, "envelope_px": 4, "carve_every": 2, "splat_px": 2}


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


def leg_rows(bare: np.ndarray, min_rows: int = 4) -> tuple[int, int, int, int] | None:
    """Rows and columns where our bare mannequin's legs stand apart: (y0, y1, x0, x1), y1 exclusive. A leg
    row has background on the body axis (the middle of the lowest third of the silhouette, where only the
    legs are) between two runs; the hands beside the hips do not count, since the hips cover the axis
    there. None when fewer than `min_rows` such rows exist (side views: the legs overlap)."""
    bare = np.asarray(bare, dtype=bool)
    rows = np.nonzero(bare.any(axis=1))[0]
    if len(rows) == 0:
        return None
    top, bottom = int(rows[0]), int(rows[-1]) + 1
    low = bare[top + 2 * (bottom - top) // 3:bottom]
    xs = np.nonzero(low.any(axis=0))[0]
    axis = int(round((xs[0] + xs[-1]) / 2))
    split = []
    for y in range(top + (bottom - top) // 3, bottom):
        if bare[y, axis]:
            continue
        rr = runs(bare[y])
        left = [r for r in rr if r[1] <= axis]
        right = [r for r in rr if r[0] > axis]
        if left and right:
            split.append((y, left[-1][0], right[0][1]))
    if len(split) < min_rows:
        return None
    # The longest stretch of consecutive leg rows (from the crotch down to the feet).
    best, cur = [split[0]], [split[0]]
    for s0, s1 in zip(split, split[1:]):
        cur = cur + [s1] if s1[0] == s0[0] + 1 else [s1]
        if len(cur) > len(best):
            best = cur
    if len(best) < min_rows:
        return None
    return best[0][0], best[-1][0] + 1, min(s[1] for s in best), max(s[2] for s in best)


def gap_profile(garment: np.ndarray, reference: np.ndarray, legs: tuple[int, int, int, int] | None, axis: int | None = None) -> dict[str, int]:
    """Within the leg rows: rows where the reference covers the body axis (between the legs) but the garment
    leaves it open with garment on both sides (`leg_gap_rows`: a dress or skirt drawn as trousers), and rows
    where the reference leaves the axis open between two legs but the garment covers it (`merged_leg_rows`:
    trousers drawn as a skirt). `leg_zone_rows` counts the leg rows where either covers the leg columns.

    The skirt zone is the leg rows where the reference covers the body axis: from the crotch down to the
    reference's hem, where a dress or skirt is one closed volume and trousers are two. `skirt_zone_rows`
    counts them; `skirt_zone_ref_px` / `skirt_zone_cover_px` are the reference pixels in those rows and how
    many of them the garment covers. Trousers drawn with touching legs leave no background gap on the axis
    (run 10: at most 13 gap rows), but they are narrower than the dress there, which this measures."""
    out = {"leg_gap_rows": 0, "merged_leg_rows": 0, "leg_zone_rows": 0, "skirt_zone_rows": 0, "skirt_zone_ref_px": 0, "skirt_zone_cover_px": 0}
    if legs is None:
        return out
    y0, y1, x0, x1 = legs
    ax = (x0 + x1) // 2 if axis is None else axis
    for y in range(y0, y1):
        g, r = garment[y], reference[y]
        if r[ax]:
            out["skirt_zone_rows"] += 1
            out["skirt_zone_ref_px"] += int(r.sum())
            out["skirt_zone_cover_px"] += int((g & r).sum())
        if not (g[x0:x1].any() or r[x0:x1].any()):
            continue
        out["leg_zone_rows"] += 1
        g_both = g[x0:ax].any() and g[ax + 1:x1].any()
        r_both = r[x0:ax].any() and r[ax + 1:x1].any()
        if r[ax] and not g[ax] and g_both:
            out["leg_gap_rows"] += 1
        elif r_both and not r[ax] and g[ax]:
            out["merged_leg_rows"] += 1
    return out


# Measured on CPU on run 11a (no frame drifted) and on run 10's clips scored against run 11a's scene (the dress
# drawn as trousers between the pinned frames); one product, so every value here is PROVISIONAL until a second
# product or run is scored. Row and pixel counts are for 480x832 frames: `scaled_thresholds` scales them.
CONSISTENCY_V2_THRESHOLDS: dict[str, float] = {
    # Turntable frames, against the pinned stills carried by the camera. Run 11a turntable min 0.852 (margin
    # about 0.03); run 10 frames 10-15 past a pinned still score 0.82-0.87 and pass this, so the skirt-zone
    # check below carries those.
    "min_garment_iou": 0.82,
    # Dress/skirt, turntable and motion: share of the reference covered in the skirt zone (crotch to the
    # reference hem). Run 11a min 0.962 over 98 frames with a skirt zone; run 10's borderline frames: a10
    # 0.875, b89 0.814, b93 0.782, b95 0.768, b142 0.798, a68 0.766.
    "min_skirt_cover": 0.90,
    "min_skirt_zone_rows": 20,  # below this the skirt zone is a few rows at a side view: not checked
    # Motion frames (posed, no hull): against the posed proxy, a loose envelope.
    "min_envelope_cover": 0.82,  # run 11a motion min 0.848; run 10 motion median 0.808
    # ... and the other side: garment pixels outside the posed proxy dilated by `envelope_out_px`, as a share
    # of the garment (a longer or wider garment than the proxy, a scale jump, a prop merged into the garment).
    "max_outside_envelope": 0.10,
    "envelope_out_px": 12,
    # Leg drift checks: absolute rows (run 11a: at most 2 gap rows; run 10: up to 13) and a share of the
    # skirt zone (dress/skirt) or of the leg rows (trousers).
    "min_leg_gap_rows": 4,
    "max_leg_gap_frac": 0.03,
    "max_merged_leg_frac": 0.15,
    "min_drift_rows": 3,  # merged-leg check: at least this many rows
    # Strong foreground outside the loose envelope (text, logos), share of the frame.
    "max_stray_frac": 0.0005,
    # Dress/skirt turntable frames: garment off the pinned stills' hull below the hips (`off_reference`):
    # a flap, panel or second hem the stills do not have. Pixels more than `off_reference_margin_px`
    # outside the hull, off our bare mannequin, in rows below `off_reference_zone_frac` of the bare
    # silhouette's height; the hull for this check is carved with `off_reference_envelope_px` (see
    # `off_reference`). Azure palm, CPU, clip frames at 480x832: run 15 max 346 px at
    # turntable_a j1-8 / b j76-79 (image-right: the front still's hem against the hull next to the pin) and 764
    # at b j60 (frame 140: its own small flap and background filled between the legs); runs 16b/17b 413-1490 px
    # over turntable_b j18/20-78 and (17b) 456-2249 over turntable_a j19-30. Margin on run 15 about 54 px.
    # One product: PROVISIONAL.
    "max_off_reference_px": 400,
    "off_reference_margin_px": 6,
    "off_reference_envelope_px": 8,
    "off_reference_zone_frac": 0.45,
}

_ROW_THRESHOLDS = ("min_skirt_zone_rows", "min_leg_gap_rows", "min_drift_rows", "envelope_out_px", "off_reference_margin_px", "off_reference_envelope_px")
_AREA_THRESHOLDS = ("max_off_reference_px",)


def scaled_thresholds(height: int, thresholds: Mapping[str, float] | None = None) -> dict[str, float]:
    """The thresholds for frames `height` pixels tall (the defaults are for 832)."""
    t = {**CONSISTENCY_V2_THRESHOLDS, **(thresholds or {})}
    f = height / 832.0
    for k in _ROW_THRESHOLDS:
        if thresholds is None or k not in thresholds:
            t[k] = max(1, int(round(t[k] * f)))
    for k in _AREA_THRESHOLDS:
        if thresholds is None or k not in thresholds:
            t[k] = max(1, int(round(t[k] * f * f)))
    return t


def off_reference_mask(garment: np.ndarray, reference: np.ndarray, bare: np.ndarray, *, margin_px: int, zone_frac: float = 0.45) -> tuple[np.ndarray, int | None]:
    """The pixels `off_reference` counts (garment more than `margin_px` outside `reference`, off `bare`, in the rows
    below `zone_frac` of the bare silhouette's height) as a mask, and the body axis column that splits them into
    image-left and image-right (None, with an empty mask, when there is no bare silhouette or no garment)."""
    g = np.asarray(garment, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    ys = np.nonzero(b.any(axis=1))[0]
    if len(ys) == 0 or not g.any():
        return np.zeros(g.shape, dtype=bool), None
    top, bottom = int(ys[0]), int(ys[-1])
    y0 = top + int(zone_frac * (bottom - top))
    o = g & ~dilate(np.asarray(reference, dtype=bool), max(1, int(margin_px))) & ~b
    o[:y0] = False
    low = b[top + 2 * (bottom - top) // 3:bottom + 1]
    xs = np.nonzero(low.any(axis=0))[0]
    return o, int(round((xs[0] + xs[-1]) / 2))


def off_reference(garment: np.ndarray, reference: np.ndarray, bare: np.ndarray, *, margin_px: int, zone_frac: float = 0.45) -> dict[str, int]:
    """Garment pixels more than `margin_px` outside `reference` (the pinned stills' hull at this camera), off
    our bare mannequin, in the rows below `zone_frac` of the bare silhouette's height (hips down): cloth the
    stills do not have, such as the hem flap runs 16b/17b drew. Split at the body axis (the middle of the
    bare silhouette's lowest third) into image-left and image-right. It counts what the frame's garment
    mask holds; it changes nothing (the masks stay stage 4's alpha targets as segmented)."""
    out = {"off_reference_px": 0, "off_reference_left_px": 0, "off_reference_right_px": 0}
    o, axis = off_reference_mask(garment, reference, bare, margin_px=margin_px, zone_frac=zone_frac)
    if axis is None:
        return out
    out["off_reference_px"] = int(o.sum())
    out["off_reference_left_px"] = int(o[:, :axis].sum())
    out["off_reference_right_px"] = out["off_reference_px"] - out["off_reference_left_px"]
    return out


def frame_garment_consistency(garment: np.ndarray, reference: np.ndarray, bare: np.ndarray, *, kind: str, reference_kind: str, envelope_out_px: int | None = None) -> dict[str, Any]:
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
    out_px = CONSISTENCY_V2_THRESHOLDS["envelope_out_px"] * g.shape[0] / 832.0 if envelope_out_px is None else envelope_out_px
    outside = int((g & ~dilate(r, max(1, int(round(out_px))))).sum())
    return {
        "reference": reference_kind,
        "garment_px": gn,
        "garment_iou": round(iou(g, r), 4),
        "reference_cover": None if rn == 0 else round(inter / rn, 4),
        "garment_inside": None if gn == 0 else round(inter / gn, 4),
        "outside_envelope": None if gn == 0 else round(outside / gn, 4),
        "hem_offset_px": None if gh is None or rh is None else gh - rh,
        **{k: v for k, v in gp.items() if not k.startswith("skirt_zone_") or k == "skirt_zone_rows"},
        "skirt_cover": None if gp["skirt_zone_ref_px"] == 0 else round(gp["skirt_zone_cover_px"] / gp["skirt_zone_ref_px"], 4),
        "drift_visible": legs is not None,
    }


def garment_flags(row: Mapping[str, Any], kind: str, thresholds: Mapping[str, float] | None = None) -> list[str]:
    """Garment drift of one frame. `thresholds` as `scaled_thresholds` gives them for the frame size."""
    t = {**CONSISTENCY_V2_THRESHOLDS, **(thresholds or {})}
    out: list[str] = []
    if row["garment_px"] == 0:
        return ["no garment found"]
    if row["reference"] == "pinned hull":
        if row["garment_iou"] < t["min_garment_iou"]:
            out.append(f"garment IoU vs the pinned stills {row['garment_iou']:.3f} < {t['min_garment_iou']}")
    else:
        if row["reference_cover"] is not None and row["reference_cover"] < t["min_envelope_cover"]:
            out.append(f"posed proxy covered {row['reference_cover']:.3f} < {t['min_envelope_cover']}")
        if row.get("outside_envelope") is not None and row["outside_envelope"] > t["max_outside_envelope"]:
            out.append(f"{row['outside_envelope']:.3f} of the garment outside the posed proxy envelope > {t['max_outside_envelope']} "
                       "(a larger or longer garment, a scale jump, or a prop merged into it)")
    off = row.get("off_reference_px")
    if kind in ("dress", "skirt") and off is not None and off > t["max_off_reference_px"]:
        side = "image-left" if row["off_reference_left_px"] >= row["off_reference_right_px"] else "image-right"
        out.append(f"{off} px of garment off the pinned stills' hull below the hips (left {row['off_reference_left_px']}, right {row['off_reference_right_px']}; "
                   f"mostly {side}) > {int(t['max_off_reference_px'])}: a flap or panel the stills do not have")
    skirt_rows = row.get("skirt_zone_rows") or 0
    if kind in ("dress", "skirt") and skirt_rows >= t["min_skirt_zone_rows"]:
        if row.get("skirt_cover") is not None and row["skirt_cover"] < t["min_skirt_cover"]:
            out.append(f"skirt zone covered {row['skirt_cover']:.3f} < {t['min_skirt_cover']} (narrower than the reference below the crotch: trousers or a narrower garment)")
        if row["leg_gap_rows"] >= t["min_leg_gap_rows"] and row["leg_gap_rows"] / skirt_rows > t["max_leg_gap_frac"]:
            out.append(f"gap between the legs in {row['leg_gap_rows']}/{skirt_rows} skirt-zone rows (dress/skirt drawn as trousers)")
    zone = row.get("leg_zone_rows") or 0
    if zone and kind == "trousers" and row["merged_leg_rows"] >= t["min_drift_rows"] and row["merged_leg_rows"] / zone > t["max_merged_leg_frac"]:
        out.append(f"legs merged in {row['merged_leg_rows']}/{zone} leg rows (trousers drawn as a skirt)")
    return out


def artefact_flags(row: Mapping[str, Any], thresholds: Mapping[str, float] | None = None) -> list[str]:
    """Problems of the frame that are not garment drift: strong foreground outside the loose envelope
    (text, a logo, props such as the blocks run 11a drew around the feet in the motion clip)."""
    t = {**CONSISTENCY_V2_THRESHOLDS, **(thresholds or {})}
    if row.get("stray_frac") is not None and row["stray_frac"] > t["max_stray_frac"]:
        return [f"foreground outside the garment envelope on {row['stray_frac']:.4f} of the frame (text, logo or prop)"]
    return []


CONSISTENCY_V2_LABEL = (
    "garment consistency v2: each generated frame's garment (segmented against our own bare mannequin and a "
    "background model) vs the pinned front/back stills carried to that camera through a visual hull (the "
    "proxy only bounds the depth the two stills cannot see); motion frames vs the posed proxy as a loose "
    "envelope, both ways (proxy covered, garment outside it). Drift checks: for a dress or skirt the share of "
    "the reference covered below the crotch (`skirt_cover`) and a gap between the legs, for trousers merged "
    "legs, only in frames where our mannequin's legs stand apart (`drift_visible`); for a dress or skirt "
    "on the turntable, garment off the stills' hull below the hips (`off_reference_px`, per image side: a flap "
    "or panel the stills do not have; spans in `off_reference_spans`). Thresholds are provisional "
    "(one product). A drift check, not a measurement of the "
    "garment. A garment the colour of the grey mannequin cannot be told from it by colour "
    "(`ambiguous_with_mannequin`): on the body the proxy is used instead."
)


def score_job(job_dir: str, manifest: Mapping[str, Any], clip_ids: Sequence[str] | None = None, *, thresholds: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Consistency v2 for every generated clip frame of a job (stage2/clips/<clip>/NNNN.png). Returns the
    `consistency` block for stage2/record.json."""
    import time

    t0 = time.time()
    scene = JobScene(job_dir, manifest)
    proxy_spec = manifest["control"].get("proxy") or {}
    kind = proxy_spec.get("kind") or {"dress": "dress", "top": "top", "outerwear": "outerwear"}.get(manifest.get("category"), "dress")
    stills = stills_garment_masks(scene)
    ref = garment_reference(scene, stills)
    t = scaled_thresholds(scene.height, thresholds)
    # The off-reference check's own hull, carved with a looser envelope (see `off_reference`).
    ref_off = garment_reference(scene, stills, {"envelope_px": int(t["off_reference_envelope_px"])})
    off_cache: dict[int, np.ndarray] = {}
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
            off: dict[str, Any] = {}
            if ckind == "turntable":
                if idx not in ref_cache:
                    ref_cache[idx] = ref["project"](idx)
                    off_cache[idx] = ref_off["project"](idx)
                reference, rk = ref_cache[idx], "pinned hull"
                off = off_reference(g, off_cache[idx], bare, margin_px=int(t["off_reference_margin_px"]), zone_frac=float(t["off_reference_zone_frac"]))
            else:
                pr = scene.proxy(ckind, idx)
                reference, rk = (pr if pr is not None else scene.control(ckind, idx)), "proxy envelope"
            row = {"clip": clip["id"], "j": j, "frame": idx, **frame_garment_consistency(g, reference, bare, kind=kind, reference_kind=rk, envelope_out_px=int(t["envelope_out_px"])), **off,
                   "ambiguous_with_mannequin": info["ambiguous_with_mannequin"], "contrast_off_body": info["contrast_off_body"],
                   "stray_frac": round(info["stray_px"] / rgb.shape[0] / rgb.shape[1], 5)}
            row["reasons"] = garment_flags(row, kind, t)
            row["flagged"] = bool(row["reasons"])
            row["artefacts"] = artefact_flags(row, t)
            rows.append(row)
    return consistency_v2_summary(rows, kind=kind, thresholds=t, stills={v: {"frame": s["frame"], "source": s["source"]} for v, s in stills.items()},
                                  bare_source=dict(scene.bare_source), reference={"voxels": int(len(ref["points"])), "voxel_m": ref["voxel_m"], "pinned_frames": ref["pinned_frames"], "carved_frames": len(ref["carved_frames"])},
                                  seconds=round(time.time() - t0, 1))


def consistency_v2_summary(rows: Sequence[Mapping[str, Any]], *, kind: str, thresholds: Mapping[str, float], **extra: Any) -> dict[str, Any]:
    def stats(rs: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {"frames": len(rs), "flagged": sum(1 for r in rs if r["flagged"]), "artefacts": sum(1 for r in rs if r.get("artefacts"))}
        for k in ("garment_iou", "reference_cover", "garment_inside", "outside_envelope", "skirt_cover"):
            vals = [r[k] for r in rs if r.get(k) is not None]
            out[k] = None if not vals else {"min": round(min(vals), 4), "mean": round(sum(vals) / len(vals), 4)}
        offs = [r["off_reference_px"] for r in rs if r.get("off_reference_px") is not None]
        out["off_reference_px"] = None if not offs else {"max": max(offs), "mean": round(sum(offs) / len(offs), 1)}
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
        "thresholds_note": "PROVISIONAL: set on one product, run 11a (no drift) and run 10 (dress drawn as trousers), CPU; margins about 0.03 (garment IoU) and 0.06 (skirt cover); off-reference (0.4.0) set on azure palm runs 15/16b/17b (run 15 max 346 px outside its own flap frames 139-140, threshold 400); see modal/README.md",
        **stats(rows),
        "per_clip": {c: stats(rs) for c, rs in clips.items()},
        "flagged_frames": flagged,
        # Not garment drift, reported apart: text, logos, props outside the envelope.
        "artefact_frames": [{**ref(r), "reasons": r["artefacts"]} for r in rows if r.get("artefacts")],
        # Garment off the pinned stills' hull below the hips (a flap or panel), as spans of consecutive frames.
        "off_reference_spans": off_reference_spans(rows, thresholds["max_off_reference_px"]) if kind in ("dress", "skirt") and "max_off_reference_px" in thresholds else [],
        "blind_frames": [ref(r) for r in rows if not r["drift_visible"]],
        "ambiguous_frames": [ref(r) for r in rows if r.get("ambiguous_with_mannequin")],
        "pass": not flagged,
        "label": CONSISTENCY_V2_LABEL,
        **extra,
        "frames_detail": list(rows),
    }


def off_reference_spans(rows: Sequence[Mapping[str, Any]], max_px: float) -> list[dict[str, Any]]:
    """Consecutive frames of one clip whose `off_reference_px` exceeds `max_px`: {clip, j0, j1, frame0,
    frame1, frames, max_px, side} (j1/frame1 inclusive; side: where most of the pixels are, image-left or
    image-right). For the record and the report, so a flap shows as one finding with its extent."""
    out: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for r in rows:
        v = r.get("off_reference_px")
        hit = v is not None and v > max_px
        if hit and cur is not None and cur["clip"] == r["clip"] and r["j"] == cur["j1"] + 1:
            cur.update(j1=r["j"], frame1=r["frame"], frames=cur["frames"] + 1, max_px=max(cur["max_px"], v))
            cur["_l"] += r["off_reference_left_px"]
            cur["_r"] += r["off_reference_right_px"]
            continue
        if cur is not None:
            out.append(cur)
            cur = None
        if hit:
            cur = {"clip": r["clip"], "j0": r["j"], "j1": r["j"], "frame0": r["frame"], "frame1": r["frame"], "frames": 1, "max_px": v,
                   "_l": r["off_reference_left_px"], "_r": r["off_reference_right_px"]}
    if cur is not None:
        out.append(cur)
    for s in out:
        s["side"] = "image-left" if s.pop("_l") >= s.pop("_r") else "image-right"
    return out


# --- stage 4 alpha targets ---------------------------------------------------------------------------------

STAGE2_MASK_DIR = "stage2/garment_mask"
STAGE4_MASK_SOURCES = ("garment", "foreground")


MASK_RECORD = "record.json"


def file_set_sha256(paths: Sequence[str]) -> str:
    """One sha256 over a set of files: each file's base name and the sha256 of its bytes, in the given order."""
    import hashlib

    h = hashlib.sha256()
    for p in paths:
        with open(p, "rb") as f:
            h.update(os.path.basename(p).encode("utf-8") + b"\0" + hashlib.sha256(f.read()).digest())
    return h.hexdigest()


def mask_set_hashes(job_dir: str, ids: Sequence[int], *, frames_dir: str = "stage2/frames", out_dir: str = STAGE2_MASK_DIR) -> dict[str, Any]:
    """The hashes that tie a mask set to the frames it was segmented from (job-relative dirs, NNNN.png)."""
    ids = sorted(int(i) for i in ids)
    return {
        "frames_dir": frames_dir,
        "frames_sha256": file_set_sha256([os.path.join(job_dir, frames_dir, f"{i:04d}.png") for i in ids]),
        "masks_sha256": file_set_sha256([os.path.join(job_dir, out_dir, f"{i:04d}.png") for i in ids]),
        "frame_ids": [ids[0], ids[-1], len(ids)] if ids else [],
    }


def write_turntable_masks(job_dir: str, manifest: Mapping[str, Any], *, frames_dir: str = "stage2/frames", out_dir: str = STAGE2_MASK_DIR, params: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Garment masks of the assembled turntable (stage 4's alpha targets for source stage2), 8-bit 0/255,
    one per camera, into `out_dir` (job-relative), and `out_dir`/record.json: the segmentation version and
    the sha256 of the frame set and of the mask set (`mask_record_check` compares them before a reuse).
    Returns that record: frames, ambiguous frames, garment px, hashes."""
    from PIL import Image

    scene = JobScene(job_dir, manifest)
    os.makedirs(os.path.join(job_dir, out_dir), exist_ok=True)
    px, ambiguous, low = [], [], []
    ids = sorted(scene.w2c)
    for idx in ids:
        path = os.path.join(job_dir, frames_dir, f"{idx:04d}.png")
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        g, info = scene.segment(_read_rgb(path), "turntable", idx, params)
        Image.fromarray((g * 255).astype(np.uint8)).save(os.path.join(job_dir, out_dir, f"{idx:04d}.png"))
        px.append(int(g.sum()))
        if info["ambiguous_with_mannequin"]:
            ambiguous.append(idx)
        c = info["contrast_off_body"]
        if c is not None:
            low.append(c)
    record = {
        "dir": out_dir,
        "segmentation": GARMENT_SEGMENT_VERSION,
        "params": {**SEGMENT_DEFAULTS, **(params or {})},
        "frames": len(px),
        "garment_px": {"min": min(px), "mean": round(sum(px) / len(px), 1), "max": max(px)} if px else None,
        "ambiguous_frames": ambiguous,
        "contrast_off_body": {"min": round(min(low), 2), "median": round(float(np.median(low)), 2)} if low else None,
        "bare_source": dict(scene.bare_source),
        **mask_set_hashes(job_dir, ids, frames_dir=frames_dir, out_dir=out_dir),
    }
    with open(os.path.join(job_dir, out_dir, MASK_RECORD), "w") as f:
        json.dump(record, f, indent=1)
    return record


def mask_record_check(job_dir: str, ids: Sequence[int], *, frames_dir: str = "stage2/frames", out_dir: str = STAGE2_MASK_DIR) -> tuple[dict[str, Any] | None, str | None]:
    """(record, None) when the masks in `out_dir` can be reused: their record.json names the current
    segmentation version and the sha256 of the current frames and of the masks on disk. Else (record or
    None, the reason to segment again): no record, an older segmentation, frames from another stage 2 run
    (same job id, re-run or --skip-video over older frames), masks changed or missing."""
    rec_path = os.path.join(job_dir, out_dir, MASK_RECORD)
    if not os.path.exists(rec_path):
        return None, "no mask record (masks from before the record, or none)"
    with open(rec_path) as f:
        rec = json.load(f)
    if rec.get("segmentation") != GARMENT_SEGMENT_VERSION:
        return rec, f"segmentation {rec.get('segmentation')} != {GARMENT_SEGMENT_VERSION}"
    if rec.get("frames_dir") != frames_dir:
        return rec, f"masks of {rec.get('frames_dir')}, not {frames_dir}"
    missing = [i for i in ids if not os.path.exists(os.path.join(job_dir, out_dir, f"{int(i):04d}.png")) or not os.path.exists(os.path.join(job_dir, frames_dir, f"{int(i):04d}.png"))]
    if missing:
        return rec, f"{len(missing)} masks or frames missing (first {missing[0]})"
    now = mask_set_hashes(job_dir, ids, frames_dir=frames_dir, out_dir=out_dir)
    if now["frames_sha256"] != rec.get("frames_sha256"):
        return rec, "the frames changed since the masks were written"
    if now["masks_sha256"] != rec.get("masks_sha256"):
        return rec, "the masks changed since their record was written"
    return rec, None


def ensure_turntable_masks(job_dir: str, manifest: Mapping[str, Any], ids: Sequence[int], *, frames_dir: str = "stage2/frames", out_dir: str = STAGE2_MASK_DIR, write: Any = None) -> dict[str, Any]:
    """Stage 4's alpha targets for source stage2: reuses `out_dir` only when `mask_record_check` passes,
    else segments the frames again (`write`, default `write_turntable_masks`). Returns {record,
    computed_here, reason} for metrics.json."""
    rec, why = mask_record_check(job_dir, ids, frames_dir=frames_dir, out_dir=out_dir)
    if why is None:
        return {"record": rec, "computed_here": False, "reason": "reused: segmentation version and frame/mask hashes match"}
    rec = (write or write_turntable_masks)(job_dir, manifest, frames_dir=frames_dir, out_dir=out_dir)
    return {"record": rec, "computed_here": True, "reason": f"computed here: {why}"}


def alpha_target_check(job_dir: str, manifest: Mapping[str, Any], mask_dir: str = STAGE2_MASK_DIR) -> dict[str, Any] | None:
    """IoU of stage 4's alpha targets with the synthetic truth masks, when the job's stills are the synthetic
    garment (dry runs): at the pinned frames (0, N/2) the generated frame IS the still, so this is a real
    check of the segmentation; at the other frames the video model draws its own garment, so the IoU is a
    loose comparison (it mixes segmentation error with the model's deviation from the synthetic garment).
    None when the job has no synthetic truth or real stills."""
    syn = manifest.get("synthetic")
    if not syn or not all(p.get("synthetic") for p in manifest["photos"] if p.get("role") in ("front", "back")):
        return None
    n = int(manifest["camera"]["frames"])
    vals: dict[int, float] = {}
    for idx in range(n):
        a = os.path.join(job_dir, mask_dir, f"{idx:04d}.png")
        b = os.path.join(job_dir, syn["garment_mask_dir"], f"{idx:04d}.png")
        if os.path.exists(a) and os.path.exists(b):
            vals[idx] = round(iou(_read_mask(a), _read_mask(b)), 4)
    if not vals:
        return None
    pinned = {str(i): vals[i] for i in (0, n // 2) if i in vals}
    v = list(vals.values())
    return {
        "pinned_iou": pinned,
        "all_frames_iou": {"frames": len(v), "min": min(v), "mean": round(sum(v) / len(v), 4), "worst_frame": min(vals, key=vals.get)},
        "note": "pinned frames: the generated frame is the synthetic still, a real check; other frames: loose (the model's garment is not the synthetic one)",
    }


OFF_REFERENCE_MASK_DIR = "stage2/off_reference_mask"
OFF_REFERENCE_MASKS_VERSION = "off-reference-masks-0.1.0"


def write_off_reference_masks(job_dir: str, manifest: Mapping[str, Any], *, mask_dir: str = STAGE2_MASK_DIR, out_dir: str = OFF_REFERENCE_MASK_DIR, thresholds: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Consistency 0.4.0's off-reference pixels (`off_reference_mask`) of stage 4's alpha targets (the assembled
    turntable's garment masks in `mask_dir`, one per camera), as 8-bit 0/255 masks in `out_dir`, and
    `out_dir`/record.json: per frame the pixel count, per image side, and whether it exceeds
    `max_off_reference_px` (flagged); the spans of flagged frames; the sha256 of the garment masks they were cut
    from. CPU, on a downloaded job. Stage 4t (`src/stage4t.ts`, `offReference`) reads them to leave these pixels
    and the flagged frames out of the fit and the bake, as an evidence choice it records; the garment masks
    stay as segmented. Only for a dress or skirt (the check's kinds); other kinds get a record with no frames."""
    from PIL import Image

    scene = JobScene(job_dir, manifest)
    proxy_spec = manifest["control"].get("proxy") or {}
    kind = proxy_spec.get("kind") or {"dress": "dress", "top": "top", "outerwear": "outerwear"}.get(manifest.get("category"), "dress")
    t = scaled_thresholds(scene.height, thresholds)
    ids = sorted(scene.w2c)
    rows: list[dict[str, Any]] = []
    if kind in ("dress", "skirt"):
        stills = stills_garment_masks(scene)
        ref_off = garment_reference(scene, stills, {"envelope_px": int(t["off_reference_envelope_px"])})
        os.makedirs(os.path.join(job_dir, out_dir), exist_ok=True)
        for idx in ids:
            g = _read_mask(os.path.join(job_dir, mask_dir, f"{idx:04d}.png"))
            o, axis = off_reference_mask(g, ref_off["project"](idx), scene.bare("turntable", idx), margin_px=int(t["off_reference_margin_px"]), zone_frac=float(t["off_reference_zone_frac"]))
            Image.fromarray((o * 255).astype(np.uint8)).save(os.path.join(job_dir, out_dir, f"{idx:04d}.png"))
            n = int(o.sum())
            left = 0 if axis is None else int(o[:, :axis].sum())
            rows.append({"clip": "turntable", "j": idx, "frame": idx, "off_reference_px": n, "off_reference_left_px": left, "off_reference_right_px": n - left,
                         "flagged": n > t["max_off_reference_px"]})
    record = {
        "version": OFF_REFERENCE_MASKS_VERSION,
        "consistency": CONSISTENCY_V2_VERSION,
        "kind": kind,
        "dir": out_dir,
        "garment_mask_dir": mask_dir,
        "thresholds": {k: t[k] for k in ("max_off_reference_px", "off_reference_margin_px", "off_reference_envelope_px", "off_reference_zone_frac")},
        "frames": [{k: r[k] for k in ("frame", "off_reference_px", "off_reference_left_px", "off_reference_right_px", "flagged")} for r in rows],
        "flagged_frames": [r["frame"] for r in rows if r["flagged"]],
        "spans": [{k: v for k, v in s.items() if k not in ("clip", "j0", "j1")} for s in off_reference_spans(rows, t["max_off_reference_px"])],
        "garment_masks_sha256": file_set_sha256([os.path.join(job_dir, mask_dir, f"{i:04d}.png") for i in ids]) if rows else None,
        "note": "pixels of the assembled turntable's garment masks (stage 4's alpha targets) more than off_reference_margin_px outside the pinned stills' visual hull (carved with off_reference_envelope_px), off our bare mannequin, hips down: cloth the stills do not have (a flap or panel). Frames above max_off_reference_px are flagged. The garment masks are not changed.",
    }
    if rows:
        with open(os.path.join(job_dir, out_dir, "record.json"), "w") as f:
            json.dump(record, f, indent=1)
    return record


def record_clip_ids(job_dir: str) -> list[str] | None:
    """The clips stage2/record.json says this run generated (None without a record: score every clip on disk). Since
    stage2-parallel-0.1.0 the motion clip is opt-in, so a job dir can hold an earlier run's stage2/clips/motion/ that the
    current record does not describe; it is not scored then."""
    path = os.path.join(job_dir, "stage2", "record.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        clips = json.load(f).get("clips")
    return [c["id"] for c in clips] if isinstance(clips, list) else None


def main(argv: Sequence[str] | None = None) -> int:
    """CPU only, on a downloaded job: garment masks for stage 4, the alpha-target check and consistency v2."""
    import argparse

    ap = argparse.ArgumentParser(description=main.__doc__)
    ap.add_argument("job_dir")
    ap.add_argument("--write-masks", action="store_true", help=f"write {STAGE2_MASK_DIR}/ from stage2/frames")
    ap.add_argument("--score", action="store_true", help="consistency v2 of stage2/clips (prints the summary, writes stage2/consistency_v2.json; report:bohohippychic reads it in place of stage2/record.json's consistency when its version is at least the record's and it is not older than the record, src/evalJob.ts withRescoredConsistency)")
    ap.add_argument("--write-off-reference", action="store_true", help=f"write {OFF_REFERENCE_MASK_DIR}/ (the off-reference pixels of {STAGE2_MASK_DIR}/, consistency 0.4.0) for stage 4t")
    a = ap.parse_args(argv)
    with open(os.path.join(a.job_dir, "manifest.json")) as f:
        m = json.load(f)
    if a.write_masks:
        print(json.dumps(write_turntable_masks(a.job_dir, m), indent=1))
        print(json.dumps(alpha_target_check(a.job_dir, m), indent=1))
    if a.write_off_reference:
        rec = write_off_reference_masks(a.job_dir, m)
        print(json.dumps({k: v for k, v in rec.items() if k != "frames"}, indent=1))
    if a.score:
        c = score_job(a.job_dir, m, record_clip_ids(a.job_dir))
        with open(os.path.join(a.job_dir, "stage2", "consistency_v2.json"), "w") as f:
            json.dump(c, f, indent=1)
        print(json.dumps({k: v for k, v in c.items() if k not in ("frames_detail", "label")}, indent=1)[:4000])
    return 0


if __name__ == "__main__":
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    raise SystemExit(main())
