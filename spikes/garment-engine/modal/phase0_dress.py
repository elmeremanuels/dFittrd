"""Stage 1b after run 12: dress the PROXY-DRESSED mannequin, and check the still against the proxy. numpy only.

Run 12 (GitHub Actions + Modal, Bohohippychic azure-palm-baby-doll-dress, export 0.2.0, FASHN v1.5 maskless on
our BARE mannequin) transferred the print, colours and puffed sleeves, but dressed the mannequin as a romper:
two separate legs under the garment and an open front, where the shop photo shows a knee-length babydoll
dress. The "back" still was a front-like view with another neckline. The QA failed both stills, for the wrong
reasons (silhouette IoU 0.81 and MAE 30/36 against the bare mannequin); stage 2 then copied the wrong shape.

From export 0.4.0 the exporter renders our mannequin WEARING the control proxy (one closed volume from the neck
to the hem for a dress, flat neutral material) at the front and back camera (`dress/proxy_<view>.png`,
`dress/proxy_mask_<view>.png`). This module holds the CPU half of stage 1b on that target:

``edit_region``
    The area the engine may change: the proxy dilated by the category margin, plus a sleeve band on the arms
    just below the shoulders, never the head. FASHN gets it as its person label map (masked mode); for the
    Qwen engine and for both engines it bounds the garment mask and the composite.

``still_qa``
    QA v2 of one dressed still. Its silhouette is compared with the proxy-dressed silhouette (bare mannequin
    + proxy), the garment with the proxy, and for a dress or skirt the skirt zone below the crotch is
    checked for a gap between the legs and for cover, as consistency v2 does for stage 2 frames
    (`phase0_garment.leg_rows` / `gap_profile`).

``back_view_checks``
    The back still must not be a front: its garment matches the proxy's back silhouette (in ``still_qa``),
    it differs from the mirrored front still at least half as much as the shop's back photo differs from
    its mirrored front photo, and its neckline is not deeper than the back photo's when the shop's back is
    closed and its front is open (a heuristic, recorded with its numbers).

Every threshold here is PROVISIONAL: set on run 12's two stills (the failure) and the exporter's synthetic
dress at the same cameras (a positive control, a render, not a model output). Every still is a generated
estimate (AGENTS.md rule 3).
"""
from __future__ import annotations

import os
import sys
from typing import Any, Mapping, Sequence

import numpy as np

# `python -I phase0_dress.py <job>` (isolated mode, the way to run it on an untrusted job dir) does not put the
# script's directory on sys.path; phase0_garment and phase0_lib live next to this file.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import phase0_garment as pg  # noqa: E402

STAGE1B_QA_VERSION = "stage1b-qa-0.3.0"

# The proxy is dilated by this share of the frame height to give the edit region (0.03 of 832 px = 25 px, about 10 cm
# at the turntable distance): enough for ease and a fuller flare, small enough that the region keeps the proxy's
# shape (FASHN sees only the outline of what it may repaint). phase0_lib.ALIGN_MARGIN_FRAC (0.08 for one-pieces)
# made a box around the whole figure. Provisional.
EDIT_MARGIN_FRAC = {"one-pieces": 0.03, "tops": 0.02, "bottoms": 0.03}
# Rows below the proxy's top edge where the mannequin's arms may be dressed (sleeves), as a share of the frame
# height. 0.14 of 832 px = 116 px, about 45 cm at the turntable distance: an elbow or puffed three-quarter sleeve.
# Run 12's azure babydoll (puffed elbow sleeves) ends at about rows 350 (front) and 365 (back) with the proxy's
# top edge at row 235; the earlier 0.10 band stopped the region at row 343 (with the 25 px margin) and cut
# 1075 / 1140 px of sleeve (inside 0.974 / 0.971); 0.12 still cut the back (inside 0.997); 0.14 keeps all of it
# (1.000 / 1.000). A longer sleeve is still cut: QA v2 measures the cut on the UNCLIPPED garment mask
# (`still_qa(garment_full=...)`, `cut_fraction`) and fails it. Provisional; a sleeve length from the product
# (the proxy's sleeves) would be better than a fixed band.
SLEEVE_BAND_FRAC = {"one-pieces": 0.14, "tops": 0.14, "bottoms": 0.0}
# The edit region stops this far (share of the height) above the proxy's top edge: the neckline, not the head.
NECK_MARGIN_FRAC = 0.02

# Measured on run 12 output (CPU) and on the exporter's synthetic dress at frames 0 and 80 (azure-palm, 480x832):
#   silhouette_iou      run 12 front 0.766, back 0.762     synthetic 0.961 / 0.960
#   garment_proxy_iou   run 12 0.504 / 0.490               synthetic 0.932 / 0.932
#   skirt_cover         run 12 0.377 / 0.350               synthetic 0.846 / 0.846 (narrower flare than the proxy)
#   leg_gap_rows        run 12 76 / 67 of 109 skirt rows   synthetic 0 / 0
#   mannequin MAE outside the edit region: run 12 13.0 / 16.0 with the 0.10 sleeve band, 11.4 / 14.6 with 0.14
#                       (FASHN re-renders the whole frame)
#   inside_fraction (garment in the edit region): run 12 0.974 / 0.971 with the 0.10 sleeve band, 1.000 / 1.000 with
#                       0.14 (stage 1b's v1 masks, not clipped to this region); synthetic 1.0 / 1.0
STILL_QA_THRESHOLDS: dict[str, float] = {
    "min_inside_fraction": 0.97,  # garment pixels inside the edit region
    "min_silhouette_iou": 0.85,  # foreground vs the proxy-dressed silhouette (bare mannequin + proxy)
    "min_garment_proxy_iou": 0.70,  # garment vs the proxy silhouette
    "min_cover_fraction": 0.05,  # the garment covers this much of the bare mannequin at least
    "max_mannequin_mae_8bit": 25.0,  # mannequin outside the edit region, generated vs our bare render
    "max_proxy_residue": 0.05,  # share of the proxy where the flat placeholder was left as it was
    "min_skirt_cover": 0.70,  # dress/skirt: proxy covered in the skirt zone (crotch to the proxy hem)
    "min_skirt_zone_rows": 20,  # rows for 832 px frames; scaled
    "min_leg_gap_rows": 4,  # rows for 832 px frames; scaled
    "max_leg_gap_frac": 0.03,  # share of the skirt zone
}
_ROW_KEYS = ("min_skirt_zone_rows", "min_leg_gap_rows")
# Checks that only WARN until re-tuned on a generated dress: both compare with the proxy, whose flare is a guess
# (hem_flare 1.35 for a babydoll), and the only positive control so far is the exporter's synthetic dress, a render
# on the same mesh family as the proxy. A correct but narrower or shorter dress could fall below them. The leg gap
# stays the hard dress-shape failure (run 12's romper fails it in 76 / 67 of 109 skirt rows). Pass `hard_checks`
# to `still_qa` to make them fail again.
STILL_QA_WARN_ONLY = frozenset({"min_garment_proxy_iou", "min_skirt_cover"})

# Back view. Measured on run 12 output (CPU): stills back vs mirrored front 26.1, shop back vs mirrored shop front
# 28.7 (ratio 0.91: this check does NOT catch run 12's back, whose print differs from the front's); neckline depth
# shop front 0.127, shop back 0.006, back still 0.117, front still 0.187 (this one does).
BACK_THRESHOLDS: dict[str, float] = {
    "min_mirror_diff_ratio": 0.5,  # stills' difference / shop photos' difference
    "neckline_closed_back_gap": 0.05,  # the shop back counts as closed when its neckline is this much shallower than the front's
    "max_neckline_excess": 0.05,  # back still's neckline depth minus the shop back's
}
BLOCK_GRID = (48, 80)  # block means over the garment's box, columns x rows

QA_LABEL = (
    "stage 1b QA v2 (export 0.4.0, proxy-dressed target): the still's silhouette against our mannequin wearing the "
    "proxy, the garment against the proxy, the skirt zone for a gap between the legs and for cover (dress/skirt), "
    "the mannequin outside the edit region against our render, proxy left-overs; back view: not a mirrored front, "
    "neckline not deeper than the back photo's. Provisional thresholds (run 12 and the synthetic dress). A check, "
    "not a measurement; every still is a generated estimate."
)


def scaled(height: int, thresholds: Mapping[str, float] | None = None) -> dict[str, float]:
    t = {**STILL_QA_THRESHOLDS, **(thresholds or {})}
    for k in _ROW_KEYS:
        if thresholds is None or k not in thresholds:
            t[k] = max(1, int(round(t[k] * height / 832.0)))
    return t


def _rows(m: np.ndarray) -> np.ndarray:
    return np.nonzero(np.asarray(m, dtype=bool).any(axis=1))[0]


def edit_margin_px(tryon_cat: str, height: int) -> int:
    return max(1, int(round(EDIT_MARGIN_FRAC[tryon_cat] * height)))


def edit_region(
    proxy: np.ndarray, bare: np.ndarray, tryon_cat: str, margin_px: int | None = None, sleeve_band_frac: float | None = None
) -> tuple[np.ndarray, dict[str, Any]]:
    """The area the try-on engine may change: the proxy plus the mannequin's arms in a band below the proxy's top
    edge (sleeves, `sleeve_band_frac` of the height, default `SLEEVE_BAND_FRAC`), dilated by `margin_px` (default
    `EDIT_MARGIN_FRAC`), minus everything above the neckline. Returns (mask, record)."""
    proxy = np.asarray(proxy, dtype=bool)
    bare = np.asarray(bare, dtype=bool)
    h = proxy.shape[0]
    rows = _rows(proxy)
    if len(rows) == 0:
        raise ValueError("empty proxy mask: export 0.4.0 renders dress/proxy_mask_<view>.png with the proxy visible")
    top = int(rows[0])
    band = int(round((SLEEVE_BAND_FRAC[tryon_cat] if sleeve_band_frac is None else float(sleeve_band_frac)) * h))
    neck = int(round(NECK_MARGIN_FRAC * h))
    margin_px = edit_margin_px(tryon_cat, h) if margin_px is None else int(margin_px)
    core = proxy.copy()
    if band > 0:
        core[top:top + band] |= bare[top:top + band]
    region = pg.dilate(core, margin_px)
    region[: max(0, top - neck)] = False
    return region, {
        "margin_px": int(margin_px),
        "sleeve_band_px": band,
        "neck_margin_px": neck,
        "proxy_top_row": top,
        "arm_rows_end": top + band + int(margin_px),  # the region holds no arm below this row: a longer sleeve is cut
        "px": int(region.sum()),
    }


def grey_collision(rgb: np.ndarray, mask: np.ndarray, value: int = 127, tol: int = 12) -> dict[str, float] | None:
    """How close our mannequin's grey is to FASHN's agnostic fill (`mask_value=127` in
    preprocessing/agnostic.create_clothing_agnostic_image at the pinned commit): share of the mannequin's pixels
    within `tol` of `value` on every channel, and the median and 75th percentile of their mean. A high share means
    FASHN sees its grey inpaint area merge into our grey arms, legs and neck: only the outline separates them."""
    m = np.asarray(mask, dtype=bool)
    if not m.any():
        return None
    px = np.asarray(rgb, dtype=np.int16)[m]
    mean = px.mean(axis=1)
    return {
        "fill_value": int(value),
        "tol": int(tol),
        "share_within_tol": round(float((np.abs(px - value).max(axis=1) <= tol).mean()), 3),
        "median": round(float(np.median(mean)), 1),
        "p75": round(float(np.percentile(mean, 75)), 1),
    }


def fashn_person_labels(region: np.ndarray, bare: np.ndarray, proxy: np.ndarray, label_ids: Mapping[str, int], garment_label: str) -> np.ndarray:
    """FASHN's person label map for masked mode (segmentation_free=False): the edit region gets the category's
    garment label (FASHN greys it out and dresses it), the head above the proxy `face` and the rest of our
    mannequin `hands` (both are in FASHN's exclusion set: kept as they are). We never run FASHN's own parser."""
    region = np.asarray(region, dtype=bool)
    bare = np.asarray(bare, dtype=bool)
    top = int(_rows(proxy)[0])
    lab = np.zeros(region.shape, np.uint8)
    keep = bare & ~region
    lab[keep] = label_ids["hands"]
    head = keep.copy()
    head[top:] = False
    lab[head] = label_ids["face"]
    lab[region] = label_ids[garment_label]
    return lab


def garment_prior(gen: np.ndarray, target: np.ndarray, region: np.ndarray, bg: Sequence[int], *, diff: int = 24, bg_tol: int = 10) -> np.ndarray:
    """Garment from the dressed still: inside the edit region, pixels that differ from the proxy-dressed target
    and are not studio background; opened by 1 px, specks dropped."""
    g = np.asarray(gen, dtype=np.int16)
    t = np.asarray(target, dtype=np.int16)
    changed = np.abs(g - t).max(axis=2) > diff
    background = (np.abs(g - np.asarray(bg, dtype=np.int16)).max(axis=2) <= bg_tol)
    m = changed & ~background & np.asarray(region, dtype=bool)
    m = pg.dilate(pg.erode(m, 1), 1)
    return pg.drop_small(m, 0.1)


def unclipped_garment(
    gen: np.ndarray,
    target: np.ndarray,
    region: np.ndarray,
    bg: Sequence[int],
    *,
    ring_px: int,
    refined: np.ndarray | None = None,
    diff: int = 24,
    bg_tol: int = 10,
) -> np.ndarray:
    """The garment WITHOUT the clip to the edit region, for the QA's inside fraction and cut share: the difference
    prior in the region grown by `ring_px`, kept only where it connects to the prior inside the region (so the
    model's re-rendered mannequin far away does not count), united with SAM 2's mask (`refined`, not clipped) when
    the app chose it. A sleeve that runs past the region shows up here and is lost in the clipped mask."""
    r = np.asarray(region, dtype=bool)
    inner = garment_prior(gen, target, r, bg, diff=diff, bg_tol=bg_tol)
    wide = garment_prior(gen, target, pg.dilate(r, int(ring_px)), bg, diff=diff, bg_tol=bg_tol)
    lab, n = pg.label(wide | inner)
    keep = np.zeros(n + 1, bool)
    keep[np.unique(lab[inner])] = True
    keep[0] = False
    full = keep[lab]
    if refined is not None:
        full |= np.asarray(refined, dtype=bool)
    return full


def proxy_residue(gen: np.ndarray, target: np.ndarray, proxy: np.ndarray, garment: np.ndarray, tol: int = 12) -> float | None:
    """Share of the proxy where the still still shows the flat placeholder (within `tol` of the target) and no garment."""
    proxy = np.asarray(proxy, dtype=bool)
    n = int(proxy.sum())
    if n == 0:
        return None
    same = np.abs(np.asarray(gen, np.int16) - np.asarray(target, np.int16)).max(axis=2) <= tol
    return float((same & proxy & ~np.asarray(garment, dtype=bool)).sum()) / n


def still_qa(
    garment: np.ndarray,
    foreground: np.ndarray,
    bare: np.ndarray,
    proxy: np.ndarray,
    region: np.ndarray,
    *,
    kind: str,
    mannequin_mae: float | None = None,
    residue: float | None = None,
    thresholds: Mapping[str, float] | None = None,
    garment_full: np.ndarray | None = None,
    hard_checks: Sequence[str] = (),
) -> dict[str, Any]:
    """QA v2 of one dressed still (masks are HxW bool). `kind` is the proxy kind (dress, skirt, trousers, top, outerwear).

    `garment` is the mask the composite pastes (clipped to the region); `garment_full` the same garment NOT clipped
    to it (`unclipped_garment`). inside_fraction, the cut share and the border check use `garment_full`: on the
    clipped mask they are 1.0 / 0 / false by construction (`inside_basis` says which one was used). Checks in
    `STILL_QA_WARN_ONLY` go to `warnings` unless named in `hard_checks`.

    silhouette_iou     foreground vs bare mannequin + proxy (the proxy-dressed silhouette, not the bare one)
    garment_proxy_iou  garment vs proxy: at the back camera, the proxy's back silhouette
    leg gap, skirt     dress/skirt: rows in the skirt zone (crotch to the proxy's hem, where our legs stand apart and
                       the proxy covers the axis) where the garment leaves the axis open between two legs, and the
                       share of the proxy covered there (phase0_garment.gap_profile, as consistency v2)
    """
    g = np.asarray(garment, dtype=bool)
    fg = np.asarray(foreground, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    p = np.asarray(proxy, dtype=bool)
    r = np.asarray(region, dtype=bool)
    h, w = g.shape
    t = scaled(h, thresholds)
    gn, bn = int(g.sum()), int(b.sum())
    gf = g if garment_full is None else (np.asarray(garment_full, dtype=bool) | g)
    gfn = int(gf.sum())
    cut_px = int((gf & ~r).sum())
    inside = 1.0 if gfn == 0 else float((gf & r).sum()) / gfn
    sil = pg.iou(fg, b | p)
    gp_iou = pg.iou(g, p)
    cover = 0.0 if bn == 0 else float((g & b).sum()) / bn
    border = bool(gf[0].any() or gf[-1].any() or gf[:, 0].any() or gf[:, -1].any())
    cut_rows = _rows(gf & ~r)
    legs = pg.leg_rows(b) if kind in ("dress", "skirt", "trousers") else None
    prof = pg.gap_profile(g, p, legs)
    skirt_rows = prof["skirt_zone_rows"]
    skirt_cover = None if prof["skirt_zone_ref_px"] == 0 else prof["skirt_zone_cover_px"] / prof["skirt_zone_ref_px"]
    failures: list[str] = []
    warnings: list[str] = []
    hard = set(hard_checks)

    def soft(key: str, msg: str) -> None:
        if key in STILL_QA_WARN_ONLY and key not in hard:
            warnings.append(f"{msg} (provisional, warning only)")
        else:
            failures.append(msg)

    if gn == 0:
        failures.append("empty garment mask")
    if inside < t["min_inside_fraction"]:
        rows = f", rows {int(cut_rows[0])}-{int(cut_rows[-1])}" if len(cut_rows) else ""
        failures.append(f"garment cut by the edit region: inside {inside:.3f} < {t['min_inside_fraction']} ({cut_px} px outside{rows}; a sleeve or hem the composite would chop)")
    if sil < t["min_silhouette_iou"]:
        failures.append(f"silhouette vs our mannequin wearing the proxy: IoU {sil:.3f} < {t['min_silhouette_iou']}")
    if gp_iou < t["min_garment_proxy_iou"]:
        soft("min_garment_proxy_iou", f"garment vs the proxy silhouette: IoU {gp_iou:.3f} < {t['min_garment_proxy_iou']}")
    if cover < t["min_cover_fraction"]:
        failures.append(f"garment covers {cover:.3f} of the mannequin < {t['min_cover_fraction']}")
    if border:
        failures.append("garment touches the frame border")
    if mannequin_mae is not None and mannequin_mae > t["max_mannequin_mae_8bit"]:
        failures.append(f"mannequin outside the edit region differs from our render: MAE {mannequin_mae:.1f} > {t['max_mannequin_mae_8bit']}")
    if residue is not None and residue > t["max_proxy_residue"]:
        failures.append(f"placeholder proxy left on {residue:.3f} of the proxy > {t['max_proxy_residue']}")
    leg_gap_fail = False
    if kind in ("dress", "skirt") and skirt_rows >= t["min_skirt_zone_rows"]:
        if prof["leg_gap_rows"] >= t["min_leg_gap_rows"] and prof["leg_gap_rows"] / skirt_rows > t["max_leg_gap_frac"]:
            leg_gap_fail = True
            failures.append(f"leg gap: the garment leaves the body axis open between two legs in {prof['leg_gap_rows']}/{skirt_rows} skirt-zone rows (a {kind} drawn as shorts or trousers)")
        if skirt_cover is not None and skirt_cover < t["min_skirt_cover"]:
            soft("min_skirt_cover", f"skirt zone: proxy covered {skirt_cover:.3f} < {t['min_skirt_cover']} below the crotch")
    return {
        "version": STAGE1B_QA_VERSION,
        "reference": "proxy-dressed mannequin",
        "garment_px": gn,
        "proxy_px": int(p.sum()),
        "edit_region_px": int(r.sum()),
        "inside_fraction": round(inside, 4),
        "inside_basis": "clipped (vacuous: 1.0 by construction)" if garment_full is None else "unclipped",
        "cut_px": cut_px,
        "cut_fraction": 0.0 if gfn == 0 else round(cut_px / gfn, 4),
        "cut_rows": None if len(cut_rows) == 0 else [int(cut_rows[0]), int(cut_rows[-1])],
        "silhouette_iou": round(sil, 4),
        "garment_proxy_iou": round(gp_iou, 4),
        "cover_fraction": round(cover, 4),
        "touches_border": border,
        "mannequin_mae_8bit": None if mannequin_mae is None else round(float(mannequin_mae), 2),
        "proxy_residue": None if residue is None else round(residue, 4),
        "legs": None if legs is None else list(legs),
        "skirt_zone_rows": skirt_rows,
        "leg_gap_rows": prof["leg_gap_rows"],
        "leg_gap": leg_gap_fail,
        "skirt_cover": None if skirt_cover is None else round(skirt_cover, 4),
        "thresholds": t,
        "warn_only": sorted(STILL_QA_WARN_ONLY - hard),
        "pass": not failures,
        "failures": failures,
        "warnings": warnings,
        "label": QA_LABEL,
    }


def qa_score(qa: Mapping[str, Any]) -> float:
    """A ranking between engines for one view (higher is better); not a quality measurement. Mean of the
    silhouette IoU, the garment-proxy IoU, the skirt cover (1 where not applicable) and 1 - MAE/50."""
    parts = [qa.get("silhouette_iou") or 0.0, qa.get("garment_proxy_iou") or 0.0]
    parts.append(1.0 if qa.get("skirt_cover") is None else float(qa["skirt_cover"]))
    mae = qa.get("mannequin_mae_8bit")
    parts.append(1.0 if mae is None else max(0.0, 1.0 - float(mae) / 50.0))
    return round(sum(parts) / len(parts), 4)


def pick_engine(candidates: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """`candidates`: one record per engine with `engine`, `qa` (pass, score) or `error`. The passing candidate with
    the best score; when none passes, the best score (the still is rejected). Returns the decision record."""
    ok = [c for c in candidates if "error" not in c]
    passing = [c for c in ok if c["qa"].get("pass")]
    pool = passing or ok
    if not pool:
        return {"engine": None, "reason": "every engine failed with an error", "passed": []}
    best = max(pool, key=lambda c: c["qa"].get("score", 0.0))
    return {
        "engine": best["engine"],
        "reason": ("passes QA with the best score" if passing else "no engine passed QA: best score, rejected"),
        "passed": [c["engine"] for c in passing],
        "scores": {c["engine"]: c["qa"].get("score") for c in ok},
    }


def front_reference(qa: Mapping[str, Any], accept_failed: bool) -> tuple[bool, str | None]:
    """May the front still be the reference for the back (Qwen's invented back takes it as picture 2; the back-view
    checks compare with it)? Only when it passed QA, or when the operator accepted failed stills. Returns (ok, why not)."""
    if qa.get("pass"):
        return True, None
    if accept_failed:
        return True, None
    return False, "front still failed QA: " + "; ".join(qa.get("failures") or ["no QA"])


# --- back view -------------------------------------------------------------------------------------------


def block_means(img: np.ndarray, mask: np.ndarray, grid: tuple[int, int] = BLOCK_GRID) -> tuple[np.ndarray, np.ndarray]:
    """Mean colour of the garment in a grid of blocks over its bounding box: (grid_h x grid_w x 3, filled)."""
    m = np.asarray(mask, dtype=bool)
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        raise ValueError("empty garment mask")
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a = np.asarray(img, dtype=np.float64)[y0:y1, x0:x1]
    mk = m[y0:y1, x0:x1]
    gw, gh = grid
    by = (np.arange(y1 - y0) * gh) // (y1 - y0)
    bx = (np.arange(x1 - x0) * gw) // (x1 - x0)
    idx = (by[:, None] * gw + bx[None, :])[mk]
    cnt = np.bincount(idx, minlength=gw * gh).astype(np.float64)
    out = np.stack([np.bincount(idx, weights=a[..., c][mk], minlength=gw * gh) for c in range(3)], axis=1)
    out = out / np.maximum(cnt, 1)[:, None]
    return out.reshape(gh, gw, 3), (cnt > 0).reshape(gh, gw)


def mirror_difference(front: np.ndarray, front_mask: np.ndarray, back: np.ndarray, back_mask: np.ndarray) -> tuple[float, float]:
    """Mean 8-bit difference between the back and the horizontally mirrored front, block means over each
    garment's box (so different crops and sizes compare): (difference, share of blocks both fill)."""
    a, ma = block_means(np.asarray(front)[:, ::-1], np.asarray(front_mask, dtype=bool)[:, ::-1])
    b, mb = block_means(back, back_mask)
    k = ma & mb
    return (float(np.abs(a - b)[k].mean()) if k.any() else 0.0), float(k.mean())


def neckline_depth(mask: np.ndarray) -> float | None:
    """How far down the body axis the garment's top edge sits below its highest point, as a share of the garment's
    height: a V-neck or open front is deep, a closed back shallow. The axis is the middle of the garment's columns
    in its top third (sleeves are symmetric). A heuristic."""
    m = np.asarray(mask, dtype=bool)
    ys, _ = np.nonzero(m)
    if len(ys) == 0:
        return None
    top, bottom = int(ys.min()), int(ys.max())
    hgt = max(1, bottom - top)
    cols = np.nonzero(m[top:top + hgt // 3 + 1].any(axis=0))[0]
    ax = int((cols[0] + cols[-1]) // 2)
    band = m[:, max(0, ax - 2):ax + 3].all(axis=1)
    hit = np.nonzero(band)[0]
    return None if len(hit) == 0 else round((int(hit[0]) - top) / hgt, 4)


def back_view_checks(
    front_still: np.ndarray,
    front_garment: np.ndarray,
    back_still: np.ndarray,
    back_garment: np.ndarray,
    shop_front: np.ndarray,
    shop_front_mask: np.ndarray,
    shop_back: np.ndarray,
    shop_back_mask: np.ndarray,
    thresholds: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Is the back still a back? (The mask-vs-proxy-back-silhouette part is `still_qa` at the back camera.)

    mirror  the stills' back-vs-mirrored-front difference must be at least `min_mirror_diff_ratio` of the shop
            photos' (a plain garment's back and front look alike in the shop too, so the bar drops with them)
    neck    when the shop's back neckline is closed (shallower than its front by `neckline_closed_back_gap`), the
            back still's neckline may be at most `max_neckline_excess` deeper than the shop back's
    """
    t = {**BACK_THRESHOLDS, **(thresholds or {})}
    still_diff, still_overlap = mirror_difference(front_still, front_garment, back_still, back_garment)
    shop_diff, shop_overlap = mirror_difference(shop_front, shop_front_mask, shop_back, shop_back_mask)
    ratio = None if shop_diff <= 0 else still_diff / shop_diff
    necks = {"front_still": neckline_depth(front_garment), "back_still": neckline_depth(back_garment), "shop_front": neckline_depth(shop_front_mask), "shop_back": neckline_depth(shop_back_mask)}
    failures: list[str] = []
    if ratio is not None and ratio < t["min_mirror_diff_ratio"]:
        failures.append(f"back still is close to the mirrored front still: difference {still_diff:.1f} is {ratio:.2f} of the shop photos' {shop_diff:.1f} < {t['min_mirror_diff_ratio']}")
    closed_back = None
    if None not in (necks["shop_front"], necks["shop_back"], necks["back_still"]):
        closed_back = necks["shop_front"] - necks["shop_back"] >= t["neckline_closed_back_gap"]
        if closed_back and necks["back_still"] - necks["shop_back"] > t["max_neckline_excess"]:
            failures.append(
                f"front features on the back: neckline depth {necks['back_still']:.3f} of the garment height vs the back photo's {necks['shop_back']:.3f} "
                f"(front photo {necks['shop_front']:.3f}); a heuristic"
            )
    return {
        "mirror_diff_8bit": round(still_diff, 2),
        "mirror_overlap": round(still_overlap, 3),
        "shop_mirror_diff_8bit": round(shop_diff, 2),
        "shop_mirror_overlap": round(shop_overlap, 3),
        "mirror_diff_ratio": None if ratio is None else round(ratio, 3),
        "neckline_depth": necks,
        "shop_back_closed": closed_back,
        "thresholds": t,
        "pass": not failures,
        "failures": failures,
    }


# --- re-score a finished stage 1b job on CPU -------------------------------------------------------------


def _read_mask(path: str) -> np.ndarray:
    from PIL import Image

    a = np.asarray(Image.open(path).convert("L"))
    return a > 127


def _read_rgb(path: str) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"))


def rescore_job(job_dir: str, manifest: Mapping[str, Any]) -> dict[str, Any]:
    """QA v2 on the stage 1b outputs already in `job_dir` (stage1b/raw/<view>.png, stage1b/garment_mask_<view>.png).
    For a job exported before 0.4.0 the proxy mask is control/proxy_mask/<frame>.png (same proxy, same camera) and
    the garment mask is the one stage 1b made against the BARE render (clipped only to v1's wide margin, so it
    serves as the unclipped mask here); the record says so. From stage1b-qa-0.3.0 the app also writes the
    unclipped mask (`stage1b/garment_mask_unclipped_<view>.png`), which is used when present."""
    import phase0_lib as lib

    spec = manifest["stage1b"]
    kind = ((manifest.get("control") or {}).get("proxy") or {}).get("kind") or (spec.get("target") or {}).get("proxy_kind") or manifest["category"]
    tryon_cat = lib.tryon_category(manifest["category"])
    bg = tuple(spec["background_rgb"])
    out: dict[str, Any] = {"version": STAGE1B_QA_VERSION, "kind": kind, "views": {}}
    stills: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for v in spec["views"]:
        name, frame = v["view"], int(v["frame"])
        p = lambda rel: os.path.join(job_dir, rel)  # noqa: E731
        proxy_rel = v.get("proxy_mask") or f"{manifest['control']['proxy_mask_dir']}/{frame:04d}.png"
        raw = _read_rgb(p(f"{lib.STAGE1B_DIR}/raw/{name}.png"))
        bare_rgb = _read_rgb(p(v["bare_rgb"]))
        bare = _read_mask(p(v["bare_mask"]))
        proxy = _read_mask(p(proxy_rel))
        saved = _read_mask(p(v["garment_mask"]))
        unclipped_rel = v.get("garment_mask_unclipped") or f"{lib.STAGE1B_DIR}/garment_mask_unclipped_{name}.png"
        garment_full = _read_mask(p(unclipped_rel)) if os.path.exists(p(unclipped_rel)) else saved
        h, w = bare.shape
        region, region_rec = edit_region(proxy, bare, tryon_cat)
        garment = saved & region
        fgb = lib.keep_large_components(lib.mask_not(lib.background_mask(raw.tobytes(), w, h, bg, 10)), w, h, 0.02)
        fg = np.frombuffer(bytes(fgb), np.uint8).reshape(h, w).astype(bool)
        keep = bare & ~region
        mae = float(np.abs(raw.astype(np.int16) - bare_rgb.astype(np.int16))[keep].mean()) if keep.any() else None
        target = _read_rgb(p(v["proxy_rgb"])) if v.get("proxy_rgb") else None
        residue = proxy_residue(raw, target, proxy, garment) if target is not None else None
        qa = still_qa(garment, fg, bare, proxy, region, kind=kind, mannequin_mae=mae, residue=residue, garment_full=garment_full)
        qa["score"] = qa_score(qa)
        out["views"][name] = {
            "proxy_mask": proxy_rel,
            "garment_mask": v["garment_mask"],
            "garment_mask_unclipped": unclipped_rel if os.path.exists(p(unclipped_rel)) else f"{v['garment_mask']} (pre-0.3.0 mask, not clipped to this region)",
            "edit_region": region_rec,
            "mannequin_grey": grey_collision(bare_rgb, bare),
            "qa": qa,
        }
        stills[name] = (raw, garment)
    src = {s["role"]: s for s in spec.get("sources", [])}
    bv = next(v for v in spec["views"] if v["view"] == "back")
    shop_masks = {r: os.path.join(job_dir, f"{lib.STAGE1B_DIR}/source/{r}_mask.png") for r in ("front", "back")}
    if not bv.get("invented") and "back" in src and all(os.path.exists(x) for x in shop_masks.values()):
        def shop(role: str) -> tuple[np.ndarray, np.ndarray]:
            from PIL import Image

            m = _read_mask(shop_masks[role])
            img = Image.open(os.path.join(job_dir, src[role]["path"])).convert("RGB").resize((m.shape[1], m.shape[0]), Image.LANCZOS)
            return np.asarray(img), m

        (sf, sfm), (sb, sbm) = shop("front"), shop("back")
        out["back_view"] = back_view_checks(stills["front"][0], stills["front"][1], stills["back"][0], stills["back"][1], sf, sfm, sb, sbm)
    else:
        out["back_view"] = {"pass": None, "failures": [], "note": "not checked: invented back or no shop segmentation"}
    return out


def main(argv: Sequence[str] | None = None) -> int:
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Stage 1b QA v2 on a finished job's stills (CPU)")
    ap.add_argument("job_dir")
    ap.add_argument("--out", help="write the JSON here (default: print)")
    a = ap.parse_args(argv)
    with open(os.path.join(a.job_dir, "manifest.json"), encoding="utf-8") as f:
        m = json.load(f)
    rec = rescore_job(a.job_dir, m)
    text = json.dumps(rec, indent=2)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    for name, v in rec["views"].items():
        q = v["qa"]
        print(f"[stage1b-qa] {name}: pass={q['pass']} silhouette_iou={q['silhouette_iou']} garment_proxy_iou={q['garment_proxy_iou']} "
              f"leg_gap_rows={q['leg_gap_rows']}/{q['skirt_zone_rows']} skirt_cover={q['skirt_cover']} inside={q['inside_fraction']} cut_px={q['cut_px']} "
              f"mae={q['mannequin_mae_8bit']} {q['failures']} warnings={q['warnings']}", file=sys.stderr)
    print(f"[stage1b-qa] back view: {rec['back_view'].get('pass')} {rec['back_view'].get('failures')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
