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
    + proxy) through a tolerance band (`silhouette_band`, stage1b-qa-0.4.0), the garment with the proxy, and for
    a dress or skirt the skirt zone below the crotch is checked for a gap between the legs ABOVE the garment's
    own hem (`leg_gap_above_hem`) and for cover, as consistency v2 does for stage 2 frames
    (`phase0_garment.leg_rows` / `gap_profile`).

``garment_colour``, ``print_fidelity``, ``pick_engine`` (after run 13; colour-0.2.0 and fidelity-0.2.0 after its review)
    The colour words of the Qwen instruction come from the shop cut-out's pixels, never the product name (dark plain
    garments stay one plain colour under shading and noise); each candidate's garment is compared with the shop photo's
    at the shop photo's exposure (Lab palette, edge density); the engine choice is
    pass every hard check -> highest print fidelity -> highest silhouette score, and a fidelity failure is
    never picked.

``garment kind`` (stage1b-qa-0.6.0, the other Bohohippychic categories)
    Trousers must keep two legs: rows where the proxy's legs stand apart but the garment closes the body axis between
    them (``merged_leg_rows`` of ``phase0_garment.gap_profile``) fail beyond ``max_merged_leg_frac`` of the leg rows. A
    skirt or trousers must not grow a bodice: garment more than the band's dilation above the proxy's top edge (the
    waistband) fails beyond ``max_above_waist_frac``. An outerwear proxy with a front opening (control-proxy-0.3.0) must
    stay open: the opening zone (`front_opening_zone`: our mannequin visible between the proxy's two fronts) is kept out
    of the edit region, and a garment covering more than ``max_opening_cover`` of it fails (a cardigan drawn closed).

``back_view_checks``
    The back still must not be a front: its garment matches the proxy's back silhouette (in ``still_qa``),
    it differs from the mirrored front still at least half as much as the shop's back photo differs from
    its mirrored front photo, and its neckline is not deeper than the back photo's when the shop's back is
    closed and its front is open (a heuristic, recorded with its numbers).

Every threshold here is PROVISIONAL: set on run 12's two stills (the romper), run 13's four candidates (FASHN's
correct print on both views, Qwen's solid blue) and the exporter's synthetic dress at the same cameras (a positive
control, a render, not a model output). One product. Every still is a generated
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

STAGE1B_QA_VERSION = "stage1b-qa-0.6.0"

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
#   silhouette_iou      run 12 front 0.766, back 0.762     synthetic 0.961 / 0.960 (run 13: FASHN 0.836 / 0.828, Qwen
#                       0.847 / 0.336; no longer a check, see the silhouette band below)
#   silhouette band     garment inside / torso cover / foreground outside, front and back (stage1b-qa-0.4.0; 0.5.0 runs
#                       the band 50 rows on below the proxy hem: FASHN inside 0.981 / 0.988, Qwen 0.929 / 0.452):
#                       run 13 FASHN 0.978 / 0.967 / 0.013 and 0.979 / 1.000 / 0.009 (pass)
#                       run 13 Qwen  0.929 / 0.953 / 0.027 and 0.393 / 0.591 / 0.507 (fail: inside; all three)
#                       run 12 romper 0.997 / 0.840 / 0.002 and 0.995 / 0.850 / 0.003 (fail: torso cover)
#   leg gap above the garment's hem (hem tolerance 8 rows): run 13 FASHN 0 / 0 (all rows 5 / 1, at its hem 535 / 533),
#                       Qwen 3 / 0 (all 12 / 0), run 12 romper 67 / 58 (all 76 / 67). Since stage1b-qa-0.5.0 the
#                       tolerance applies only to a hem more than 2 x 8 rows below the crotch (a closed romper with a
#                       4-14 row inseam fails: 4-14 counted rows), and the hem comes from garment-coloured pixels
#                       (run 13 FASHN with its UNCLIPPED mask as the garment: hem 533 / 532 by colour, 588 / 592 by mask)
#   garment_proxy_iou   run 12 0.504 / 0.490               synthetic 0.932 / 0.932
#   skirt_cover         run 12 0.377 / 0.350               synthetic 0.846 / 0.846 (narrower flare than the proxy)
#   leg_gap_rows        run 12 76 / 67 of 109 skirt rows   synthetic 0 / 0
#   mannequin MAE outside the edit region: run 12 13.0 / 16.0 with the 0.10 sleeve band, 11.4 / 14.6 with 0.14
#                       (FASHN re-renders the whole frame)
#   inside_fraction (garment in the edit region): run 12 0.974 / 0.971 with the 0.10 sleeve band, 1.000 / 1.000 with
#                       0.14 (stage 1b's v1 masks, not clipped to this region); synthetic 1.0 / 1.0
STILL_QA_THRESHOLDS: dict[str, float] = {
    "min_inside_fraction": 0.97,  # garment pixels inside the edit region
    # Silhouette tolerance band (0.4.0, replaces `silhouette_iou >= 0.85`: the proxy is coarse, and run 13's correct
    # FASHN babydoll scored 0.836 / 0.828 because it is shorter and narrower than the proxy's guessed flare).
    "min_garment_inside": 0.96,  # garment (unclipped) inside the proxy + sleeve band, dilated by `band_dilate_frac`
    "min_torso_cover": 0.92,  # garment covers the proxy, eroded by `band_erode_frac`, from its top edge to the crotch
    "max_foreground_outside": 0.03,  # still's foreground outside (bare + proxy) dilated by `band_dilate_frac`
    "min_garment_proxy_iou": 0.70,  # garment vs the proxy silhouette
    "min_cover_fraction": 0.05,  # the garment covers this much of the bare mannequin at least
    "max_mannequin_mae_8bit": 25.0,  # mannequin outside the edit region, generated vs our bare render
    "max_proxy_residue": 0.05,  # share of the proxy where the flat placeholder was left as it was
    "min_skirt_cover": 0.70,  # dress/skirt: proxy covered in the skirt zone (crotch to the proxy hem)
    "min_skirt_zone_rows": 20,  # rows for 832 px frames; scaled
    "min_leg_gap_rows": 4,  # rows for 832 px frames; scaled
    "max_leg_gap_frac": 0.03,  # share of the skirt zone
    # stage1b-qa-0.6.0, other garment kinds. PROVISIONAL, not yet seen on a generated trouser, skirt or cardigan still:
    # set from the proxy-dressed renders (the proxy itself: 0 merged rows, 0 above the waist, 0 of the opening covered)
    # with room for a model that draws a wider leg, a waistband a little higher, or the fronts' edges into the opening.
    "max_merged_leg_frac": 0.25,  # trousers: leg rows (proxy legs apart) where the garment closes the axis
    "min_merged_leg_rows": 4,  # rows for 832 px frames; scaled
    "max_above_waist_frac": 0.05,  # skirt/trousers: share of the garment above the proxy's top edge + the band's dilation
    "max_opening_cover": 0.5,  # outerwear with an opening: share of the front opening zone the garment covers
    "min_opening_px": 200,  # below this the view has no opening zone (a back view, a closed proxy): not checked
}
# Shares of the frame height (scaled per still): the band's dilation (12 px at 832) and erosion (8 px), and how far above
# the garment's own hem a leg-gap row must lie (8 px: a tiered or curved hem dips at the centre; run 13's FASHN
# babydoll has 5 open rows right at its hem, 531-535 with the hem at 535).
# `hem_extend_frac` (0.06 of 832 px = 50 rows, about 20 cm; review of run 13): the band runs on this far below the
# proxy's hem, straight down at the hem's width, so a midi dress against the default knee proxy passes the band (before,
# +20 rows past the proxy hem gave garment inside 0.952 < 0.96). The edit region is NOT extended (FASHN's input stays
# as on GPU run 13): a dress more than the edit margin (25 px) past the proxy hem is still cut by the region and fails
# `min_inside_fraction`; an open issue (README).
SILHOUETTE_BAND = {"band_dilate_frac": 0.015, "band_erode_frac": 0.01, "hem_tol_frac": 0.01, "hem_extend_frac": 0.06}
_ROW_KEYS = ("min_skirt_zone_rows", "min_leg_gap_rows", "min_merged_leg_rows")
# Not a check since stage1b-qa-0.4.0: recorded for comparison with the run 12 / run 13 records.
LEGACY_MIN_SILHOUETTE_IOU = 0.85
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
    f"stage 1b QA v2 ({STAGE1B_QA_VERSION}, proxy-dressed target): the still's silhouette against our mannequin wearing the "
    "proxy through a tolerance band (garment inside the dilated proxy, run on below its guessed hem, covering the eroded proxy "
    "torso), the garment against the proxy, the skirt zone for a gap between the legs above the garment's own hem (taken "
    "from garment-coloured pixels) and for cover (dress/skirt), the mannequin outside the edit region against our render, "
    "proxy left-overs, print fidelity against the shop photo's garment at the same exposure; back view: not a mirrored "
    "front, neckline not deeper than the back photo's. Provisional thresholds (run 12, run 13 and the synthetic dress). A "
    "check, not a measurement; every still is a generated estimate."
)


def scaled(height: int, thresholds: Mapping[str, float] | None = None) -> dict[str, float]:
    t = {**STILL_QA_THRESHOLDS, **(thresholds or {})}
    for k in _ROW_KEYS:
        if thresholds is None or k not in thresholds:
            t[k] = max(1, int(round(t[k] * height / 832.0)))
    return t


def _rows(m: np.ndarray) -> np.ndarray:
    return np.nonzero(np.asarray(m, dtype=bool).any(axis=1))[0]


def front_opening_zone(proxy: np.ndarray, bare: np.ndarray) -> np.ndarray:
    """Our mannequin visible BETWEEN the proxy's two fronts: per row, the run of mannequin-not-proxy pixels through the
    proxy's centre column that has proxy on both ends. Empty for a closed proxy and at the back camera; for an outerwear
    proxy with a front opening (control-proxy-0.3.0) the V or the open front at the front camera."""
    p = np.asarray(proxy, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    zone = np.zeros_like(p)
    cols = np.nonzero(p.any(axis=0))[0]
    rows = _rows(p)
    if len(cols) == 0:
        return zone
    ax = int(round(float(np.nonzero(p)[1].mean())))
    free = b & ~p
    w = p.shape[1]
    for y in range(int(rows[0]), int(rows[-1]) + 1):
        if not free[y, ax]:
            continue
        x0 = ax
        while x0 > 0 and free[y, x0 - 1]:
            x0 -= 1
        x1 = ax
        while x1 < w - 1 and free[y, x1 + 1]:
            x1 += 1
        if x0 > 0 and x1 < w - 1 and p[y, x0 - 1] and p[y, x1 + 1]:
            zone[y, x0:x1 + 1] = True
    return zone


def edit_margin_px(tryon_cat: str, height: int) -> int:
    return max(1, int(round(EDIT_MARGIN_FRAC[tryon_cat] * height)))


def edit_region(
    proxy: np.ndarray, bare: np.ndarray, tryon_cat: str, margin_px: int | None = None, sleeve_band_frac: float | None = None,
    keep_open: bool = False,
) -> tuple[np.ndarray, dict[str, Any]]:
    """The area the try-on engine may change: the proxy plus the mannequin's arms in a band below the proxy's top
    edge (sleeves, `sleeve_band_frac` of the height, default `SLEEVE_BAND_FRAC`), dilated by `margin_px` (default
    `EDIT_MARGIN_FRAC`), minus everything above the neckline. `keep_open` (outerwear): the proxy's front opening
    (`front_opening_zone`), eroded by half the margin so the fronts' edges may still move into it, is taken out, so a
    masked engine cannot close the front. Returns (mask, record)."""
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
    opening_px = 0
    if keep_open:
        zone = pg.erode(front_opening_zone(proxy, bare), max(1, int(margin_px) // 2))
        opening_px = int(zone.sum())
        region &= ~zone
    return region, {
        "kept_open_px": opening_px,
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


# --- garment colour and print fidelity (stage1b-qa-0.4.0, after run 13) -----------------------------------
#
# Run 13 (stage 1b only, both engines, proxy-dressed target): the Qwen instruction said "a blue knee-length babydoll
# dress", "blue" taken from the product name ("Azure Palm" is the name of a print; the garment is a pastel tropical
# print on cream), and Qwen painted a solid blue dress on both views. FASHN transferred the print. The QA had no
# look at the garment's colours, and the old score picked Qwen's front. From here the colour words of an instruction
# come from the garment's own pixels (`garment_colour`), and each candidate is compared with the shop photo's garment
# (`print_fidelity`); a candidate that fails it is never picked.


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB (8-bit, ...x3) to CIE L*a*b* (D65)."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    d = 6.0 / 29.0
    f = np.where(xyz > d ** 3, np.cbrt(xyz), xyz / (3 * d * d) + 4.0 / 29.0)
    return np.stack([116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])], axis=-1)


# Plain colour names and their sRGB (the TypeScript exporter's BASIC_COLOURS in src/product.ts, plus three pastels a
# print's ground is often made of). Matched in Lab with lightness at half weight, so shading does not change the name.
COLOUR_NAMES: tuple[tuple[str, tuple[int, int, int]], ...] = (
    ("black", (17, 17, 17)), ("charcoal grey", (64, 64, 64)), ("grey", (128, 128, 128)), ("light grey", (200, 200, 200)), ("white", (250, 250, 250)),
    ("cream", (242, 235, 221)), ("beige", (215, 196, 160)), ("camel", (193, 154, 107)), ("brown", (110, 70, 40)), ("burgundy", (107, 31, 42)),
    ("red", (200, 30, 40)), ("coral", (255, 110, 90)), ("peach", (245, 195, 165)), ("orange", (235, 130, 30)), ("mustard yellow", (215, 170, 40)),
    ("yellow", (245, 220, 80)), ("olive green", (91, 107, 60)), ("green", (40, 140, 70)), ("sage green", (160, 180, 150)), ("mint green", (170, 220, 190)),
    ("teal", (20, 120, 120)), ("light blue", (150, 190, 230)), ("blue", (40, 90, 190)), ("navy blue", (30, 40, 85)), ("purple", (110, 60, 150)),
    ("lilac", (195, 170, 215)), ("pink", (235, 150, 175)),
)
_NAME_LAB = srgb_to_lab(np.array([c for _, c in COLOUR_NAMES], dtype=np.float64))
_L_WEIGHT = 0.5

# Is the garment a print? Measured on chromaticity (r, g) = (R, G) / (R + G + B), which shading (a darker or lighter
# fold of the same fabric) leaves unchanged: the share of lit pixels whose chromaticity lies more than a distance from
# the garment's median chromaticity. At or above `print_share` the garment is "multicolour print on <ground>" (the
# ground is the median colour's name).
#
# Sensor and JPEG noise moves the chromaticity of a dark pixel far more than a light one's (a fixed 8-bit error divided
# by a small R + G + B). Before the review of run 13 the rule took every pixel with R + G + B >= 60 and a fixed 0.03:
# every dark plain garment with noise sigma 8 (JPEG q85) was a print (black 0.19, navy 0.19-0.26, burgundy 0.45). Since
# then (colour-0.2.0) the image is first averaged over `smooth_px` x `smooth_px` garment pixels (a print's motifs are
# larger than that; noise drops by that factor), the lit floor is R + G + B >= `lit_floor`, and the distance a pixel must
# exceed grows on dark pixels: max(`accent_distance`, `accent_noise_rgb` / (R + G + B)), i.e. a fixed 8-bit change of
# the channel shares. Measured (CPU) after the change: run 13's shop cut-outs 0.167 / 0.248 (front / back), FASHN's
# stills 0.184 / 0.177, Qwen's solid blue 0.020 / 0.017; synthetic shaded dark solids (black, navy, dark green, burgundy,
# brown, teal, purple, olive, grey, red; fold shading 0.3-0.5, noise sigma 4 and 8, JPEG q85) all 0.000 (0.085 at most
# without the smoothing, 0.19-0.49 before the change). A print whose motifs are 1-2 px wide at the image's scale is
# averaged away too; at shop-photo and 832-px still scale the azure print's motifs are far larger.
COLOUR_VERSION = "colour-0.2.0"
COLOUR_THRESHOLDS = {
    "accent_distance": 0.03,
    "accent_noise_rgb": 12.0,  # 8-bit levels: the distance threshold on a pixel is at least this / (R + G + B)
    "lit_floor": 90,  # R + G + B: darker pixels (deep shadow) do not vote on print vs plain
    "smooth_px": 3,  # box average over the garment before the chromaticity is taken
    "print_share": 0.12,
    "min_px": 200,  # fewer garment pixels: no colour (the instruction then names none)
    "two_tone_share": 0.25,  # a garment whose two far-apart colour names each hold this share is named by both ("black and white")
    # Two names of one garment are the SAME colour when their pixels' median hue (a*b* angle) lies within this many
    # degrees (both chromatic, chroma >= `chromatic_c`), or when one is black / charcoal grey / grey whose pixels are
    # still tinted towards the other's hue (chroma >= `tint_c`, within `tint_hue_deg`): fold shading of a dark colour
    # (plain purple -> "navy blue" + "purple", dark green -> "olive green" + "black", brown -> "brown" + "black").
    "same_hue_deg": 35.0,
    "chromatic_c": 8.0,
    "tint_c": 3.0,
    "tint_hue_deg": 50.0,
    # Print evidence from texture (the shop garment scaled to `edge_height_px` rows, as `print_fidelity` compares it):
    # "solid colour, plain fabric" goes into the Qwen negative prompt only when the edges also say "printed"
    # (FIDELITY_THRESHOLDS["min_shop_edge_density"]).
    "edge_height_px": 300,
}
_ACHROMATIC = {"black", "charcoal grey", "grey", "light grey", "white"}
_DARK_NEUTRAL = {"black", "charcoal grey", "grey"}


def _nearest_names(lab: np.ndarray) -> np.ndarray:
    w = np.array([_L_WEIGHT ** 2, 1.0, 1.0])
    d = (((lab[:, None, :] - _NAME_LAB[None]) ** 2) * w).sum(axis=-1)
    return d.argmin(axis=1)


def _box_mean(rgb: np.ndarray, mask: np.ndarray, k: int) -> np.ndarray:
    """Mean of `rgb` over the garment pixels in a k x k window (mask-normalised: the background does not bleed in)."""
    if k <= 1:
        return np.asarray(rgb, dtype=np.float64)
    m = np.asarray(mask, dtype=np.float64)
    f = np.asarray(rgb, dtype=np.float64) * m[..., None]
    r = k // 2

    def box(a: np.ndarray) -> np.ndarray:
        for axis in (0, 1):
            pad = [(0, 0)] * a.ndim
            pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(a, pad), axis=axis)
            n = a.shape[axis]
            a = np.take(c, np.arange(k, k + n), axis=axis) - np.take(c, np.arange(0, n), axis=axis)
        return a

    return box(f) / np.maximum(box(m), 1e-9)[..., None]


def _hue_deg(ab: np.ndarray) -> float:
    return float(np.degrees(np.arctan2(ab[1], ab[0])))


def _hue_gap(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def _same_colour(a: str, b: str, ab_a: np.ndarray, ab_b: np.ndarray, t: Mapping[str, float]) -> bool:
    """Are two colour names of one garment shades of the same colour? (`ab_*`: median a*b* of the pixels with that name.)"""
    if any(a in s and b in s for s in _SHADES):
        return True
    ca, cb = float(np.hypot(*ab_a)), float(np.hypot(*ab_b))
    gap = _hue_gap(_hue_deg(ab_a), _hue_deg(ab_b))
    if a not in _ACHROMATIC and b not in _ACHROMATIC:
        return ca >= t["chromatic_c"] and cb >= t["chromatic_c"] and gap <= t["same_hue_deg"]
    for n, c, other, oc in ((a, ca, b, cb), (b, cb, a, ca)):
        if n in _DARK_NEUTRAL and other not in _ACHROMATIC and c >= t["tint_c"] and oc >= t["chromatic_c"] and gap <= t["tint_hue_deg"]:
            return True
    return False


def _hue_name(ground: str, med: np.ndarray, top: Sequence[str], t: Mapping[str, float]) -> str:
    """The name of a solid garment whose pixels fall under several names that `_same_colour` folded into one: the
    chromatic name whose hue is nearest the median colour's (a shaded purple is "purple", not "navy blue"; a dark green
    whose median reads "black" is "olive green"), or the median's own name for a neutral or a single name."""
    c = float(np.hypot(med[1], med[2]))
    cands = [n for n in dict.fromkeys([ground, *top]) if n not in _ACHROMATIC]
    if c < t["tint_c"] or not cands or (ground in _ACHROMATIC and ground not in _DARK_NEUTRAL):
        return ground
    if ground in _ACHROMATIC and c < t["chromatic_c"] and not [n for n in top if n not in _ACHROMATIC]:
        return ground
    h = _hue_deg(med[1:])
    lab = {n: _NAME_LAB[[x for x, _ in COLOUR_NAMES].index(n)] for n in cands}
    return min(cands, key=lambda n: _hue_gap(h, _hue_deg(lab[n][1:])))


def garment_edge_density(rgb: np.ndarray, mask: np.ndarray, height: int | None = None) -> float | None:
    """Edge density (`edge_density`, FIDELITY_THRESHOLDS' L* threshold) of the garment scaled DOWN to `height` rows
    (default COLOUR_THRESHOLDS["edge_height_px"]; never up), so a shop photo and a still compare at similar scale."""
    m = np.asarray(mask, dtype=bool)
    rows = _rows(m)
    if len(rows) == 0:
        return None
    height = int(COLOUR_THRESHOLDS["edge_height_px"] if height is None else height)
    img, mk = (rgb, m) if int(rows[-1]) - int(rows[0]) + 1 <= height else _scale_to_height(rgb, m, height)
    return edge_density(img, mk, FIDELITY_THRESHOLDS["edge_threshold_l"])


def garment_colour(rgb: np.ndarray, mask: np.ndarray, *, max_px: int = 60000) -> dict[str, Any]:
    """A plain colour description of the garment from its own pixels (the shop photo's SAM 2 cut-out), never from the
    product name: "multicolour print on <ground>" when enough lit pixels differ in chromaticity from the median (noise
    allowed for, see COLOUR_THRESHOLDS; the ground is the median colour's name, matched in Lab), "<a> and <b>" for two
    colours of similar share that are not shades of one colour (black and white stripes, which chromaticity does not
    separate; `_same_colour`), else the median colour's name ("black"); none (`phrase` None) without enough pixels.
    Returns the phrase, the kind (solid | two-tone | print | none), the texture evidence (`edge_density`,
    `printed_by_edges`) and the numbers behind it."""
    t = COLOUR_THRESHOLDS
    m = np.asarray(mask, dtype=bool)
    n_px = int(m.sum())
    if n_px < t["min_px"]:
        return {"phrase": None, "kind": "none", "version": COLOUR_VERSION, "source": "garment cut-out: too few pixels, no colour", "px": n_px}
    step = int(np.ceil(n_px / max_px))
    px = np.asarray(rgb)[m][::step]
    lab = srgb_to_lab(px)
    med = np.median(lab, axis=0)
    # Print rule on the smoothed image (see COLOUR_THRESHOLDS).
    sm = _box_mean(rgb, m, int(t["smooth_px"]))[m][::step]
    tot = sm.sum(axis=1)
    lit = tot >= t["lit_floor"]
    accent = 0.0
    if lit.any():
        ch = sm[lit, :2] / tot[lit, None]
        thr = np.maximum(t["accent_distance"], t["accent_noise_rgb"] / tot[lit])
        accent = float((np.linalg.norm(ch - np.median(ch, axis=0), axis=1) > thr).mean())
    names = _nearest_names(lab)
    share = np.bincount(names, minlength=len(COLOUR_NAMES)) / len(names)
    order = [int(i) for i in np.argsort(-share)[:5]]
    ground = COLOUR_NAMES[int(_nearest_names(med[None])[0])][0]
    top = [i for i in order if share[i] >= t["two_tone_share"]]
    group_ab = {i: np.median(lab[names == i, 1:], axis=0) for i in top}
    edges = garment_edge_density(rgb, m)
    printed_by_edges = edges is not None and edges >= FIDELITY_THRESHOLDS["min_shop_edge_density"]
    if accent >= t["print_share"]:
        kind, phrase = "print", f"multicolour print on {ground}"
    elif len(top) >= 2 and not _same_colour(COLOUR_NAMES[top[0]][0], COLOUR_NAMES[top[1]][0], group_ab[top[0]], group_ab[top[1]], t):
        kind, phrase = "two-tone", f"{COLOUR_NAMES[top[0]][0]} and {COLOUR_NAMES[top[1]][0]}"
    else:
        kind, phrase = "solid", _hue_name(ground, med, [COLOUR_NAMES[i][0] for i in top], t)
    return {
        "phrase": phrase,
        "kind": kind,
        "version": COLOUR_VERSION,
        "source": "garment cut-out pixels (chromaticity and Lab), never the product name",
        "px": n_px,
        "median_lab": [round(float(x), 1) for x in med],
        "accent_share": round(accent, 3),
        "edge_density": None if edges is None else round(edges, 4),
        "printed_by_edges": bool(printed_by_edges),
        "names": [[COLOUR_NAMES[i][0], round(float(share[i]), 3)] for i in order if share[i] > 0],
        "thresholds": dict(t),
    }


# Shading of one colour gives neighbouring names (black / charcoal grey, blue / navy blue): only a far second name counts.
# `_same_colour` also folds two names whose pixels share a hue, and a dark neutral tinted towards the other name's hue.
_SHADES = [{"black", "charcoal grey", "grey"}, {"grey", "light grey", "white", "cream"}, {"cream", "beige", "white"}, {"blue", "navy blue", "light blue"},
           {"red", "burgundy", "coral"}, {"green", "olive green", "sage green", "mint green"}, {"pink", "coral", "peach"}, {"purple", "lilac"}]


# Print fidelity: the candidate's garment (its mask on the generated still) against the shop photo's garment (SAM 2
# mask). Since fidelity-0.2.0 (review of run 13) the candidate is first brought to the shop garment's exposure: its
# linear RGB times one gain so the two median luminances match, and the palette is compared after that. The 0.1.0
# check compared absolute L*: a correct garment rendered 25 % darker failed (median Delta E 21.9) while clearly wrong
# ground colours passed (pink tint 17.1, mint ground 18.0); the limits only held because Qwen's error was huge.
#
# Measured on CPU, run 13's FASHN front still (exposure, saturation and tint changes applied to the still) against the
# real shop cut-out; Hellinger / median Delta E after the exposure gain (fidelity-0.1.0's numbers, before it, in brackets):
#   as is (gain 1.13)            0.060 / 2.0  (0.096 / 4.5)      FASHN back 0.080 / 2.3; run 12 FASHN (romper, right
#   exposure x1.15 .. x0.65      0.059-0.068 / 2.0-2.2            print, run 13's shop masks) 0.161 / 5.6, 0.102 / 3.0
#     (gain 0.83 .. 2.94; x0.75 was 0.437 / 21.9, a fail)
#   exposure x0.55 / x0.45       gain 4.2 / 6.4: fails the gain (and 0.214 / 10.7, 0.433 / 21.7)
#   saturation -25 % / -50 %     0.116 / 3.9, 0.190 / 5.7          (lighting and render differences: pass)
#   mild pink / yellow tint      0.258 / 7.5, 0.266 / 8.2          (pass: below what this check resolves)
#   ground recoloured white      0.251 / 9.5                       (pass: cream vs white is below it too)
#   pink / blue / yellow / green tint   0.451 / 13.6, 0.326 / 12.1, 0.516 / 18.0, 0.501 / 15.4     (fail)
#   ground -> light pink / light blue / mint / yellow  0.424 / 14.2, 0.454 / 18.8, 0.467 / 14.6, 0.625 / 27.2 (fail)
#   run 13 Qwen solid blue       0.942 / 62.6 (front), 0.952 / 55.0 (back)                        (fail)
# Synthetic solids: black vs charcoal grey fails the gain (0.15), red vs burgundy and navy vs black fail the palette;
# white vs light grey passes (gain 1.40, a lightness difference this check cannot tell from lighting).
# The limits sit between the largest lighting/render difference (0.19 / 5.7) and the smallest hue change that must fail
# (0.33 / 12.1; either limit failing fails). Edge density: run 13 FASHN 0.80 / 0.64 of the shop's, Qwen 0.17 / 0.21,
# run 12 0.80 / 0.76; the shop photo is scaled so its garment is as tall as the candidate's before the edges are counted.
FIDELITY_VERSION = "fidelity-0.2.0"
FIDELITY_THRESHOLDS = {
    "max_lab_hellinger": 0.35,  # palette after the exposure gain: joint L*a*b* histogram (8 x 10 x 10 bins), Hellinger distance
    "max_median_delta_e": 10.0,  # palette after the exposure gain: the two garments' median colours
    "max_exposure_gain": 3.0,  # linear-light gain that brings the candidate's median luminance to the shop's (x0.65 sRGB = 2.9)
    "min_edge_ratio": 0.35,  # texture: candidate edge density / shop edge density, when the shop garment is printed
    "min_shop_edge_density": 0.15,  # below this the shop garment counts as plain: the texture ratio is recorded, not checked
    "edge_threshold_l": 4.0,  # L* change per pixel (central difference) that counts as an edge
}
_LUMA = np.array([0.2126729, 0.7151522, 0.0721750])


def _linear(rgb: np.ndarray) -> np.ndarray:
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _unlinear(lin: np.ndarray) -> np.ndarray:
    c = np.clip(lin, 0.0, 1.0)
    return 255.0 * np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1.0 / 2.4) - 0.055)


_HIST_RANGE = ((0.0, 100.0), (-40.0, 40.0), (-40.0, 60.0))
_HIST_BINS = (8, 10, 10)


def lab_histogram(lab: np.ndarray) -> np.ndarray:
    # Each sample is shared linearly between its two nearest bin centres per axis (fidelity-0.2.0): with hard bins a
    # flat colour on a bin edge jumped bins after a 1-level change (a synthetic print darkened x0.65 and normalised back
    # read 0.27 instead of 0.03).
    lo = np.array([r[0] for r in _HIST_RANGE])
    hi = np.array([r[1] for r in _HIST_RANGE])
    n = np.array(_HIST_BINS)
    u = np.clip((np.asarray(lab, dtype=np.float64).reshape(-1, 3) - lo) / (hi - lo) * n - 0.5, 0.0, n - 1.0)
    i0 = np.minimum(np.floor(u).astype(int), n - 2)
    f = u - i0
    hist = np.zeros(int(np.prod(n)))
    for corner in range(8):
        bits = np.array([(corner >> a) & 1 for a in range(3)])
        w = np.prod(np.where(bits[None] == 1, f, 1.0 - f), axis=1)
        idx = np.ravel_multi_index(tuple((i0 + bits[None])[:, a] for a in range(3)), _HIST_BINS)
        hist += np.bincount(idx, weights=w, minlength=hist.size)
    hist = hist.reshape(_HIST_BINS)
    # Smoothed over neighbouring bins ([1, 2, 1] / 4 twice per axis), so one colour on a bin edge (a solid fabric whose
    # b* is -1 in one photo and +1 in the other) does not read as two different palettes.
    for axis in range(3):
        for _ in range(2):
            pad = np.moveaxis(np.pad(hist, [(1, 1) if a == axis else (0, 0) for a in range(3)], mode="edge"), axis, 0)
            hist = np.moveaxis((pad[:-2] + 2 * pad[1:-1] + pad[2:]) / 4.0, 0, axis)
    hist = hist.ravel()
    return hist / max(1e-12, hist.sum())


def hellinger(p: np.ndarray, q: np.ndarray) -> float:
    return float(np.sqrt(max(0.0, 1.0 - float(np.sqrt(p * q).sum()))))


def edge_density(rgb: np.ndarray, mask: np.ndarray, threshold_l: float, erode_px: int = 3) -> float | None:
    """Share of the garment's pixels (mask eroded by `erode_px`, so the outline does not count) where L* changes by more
    than `threshold_l` per pixel: a print has many edges, a plain fabric few (folds only)."""
    lum = srgb_to_lab(rgb)[..., 0]
    gy = np.zeros_like(lum)
    gx = np.zeros_like(lum)
    gy[1:-1] = (lum[2:] - lum[:-2]) / 2.0
    gx[:, 1:-1] = (lum[:, 2:] - lum[:, :-2]) / 2.0
    inner = pg.erode(np.asarray(mask, dtype=bool), erode_px)
    if not inner.any():
        return None
    return float((np.hypot(gx, gy)[inner] > threshold_l).mean())


def _scale_to_height(rgb: np.ndarray, mask: np.ndarray, height: int) -> tuple[np.ndarray, np.ndarray]:
    from PIL import Image

    m = np.asarray(mask, dtype=bool)
    rows = _rows(m)
    s = height / max(1, int(rows[-1]) - int(rows[0]) + 1)
    h, w = m.shape
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    img = Image.fromarray(np.asarray(rgb, dtype=np.uint8)).resize((nw, nh), Image.LANCZOS)
    mk = Image.fromarray(m.astype(np.uint8) * 255).resize((nw, nh), Image.NEAREST)
    return np.asarray(img), np.asarray(mk) > 127


def print_fidelity(cand_rgb: np.ndarray, cand_mask: np.ndarray, shop_rgb: np.ndarray, shop_mask: np.ndarray,
                   thresholds: Mapping[str, float] | None = None, *, max_px: int = 60000) -> dict[str, Any]:
    """Does the candidate's garment carry the shop garment's colours and print? Exposure: the candidate is scaled in
    linear light to the shop garment's median luminance (`exposure_gain`; a gain beyond `max_exposure_gain` either way
    fails: black against charcoal). Palette, after that gain: Hellinger distance between the two garments' joint Lab
    histograms and the Delta E of their median colours (either failing fails the candidate: run 13's Qwen painted the
    cream print solid blue; the unnormalised numbers are recorded too). Texture: the candidate's edge density against
    the shop's, with the shop garment scaled to the candidate garment's height (fails only when the shop garment is printed and the
    candidate lost most of it). `score` = 1 - Hellinger (higher is better), the first key of `pick_engine`."""
    t = {**FIDELITY_THRESHOLDS, **(thresholds or {})}
    cm = np.asarray(cand_mask, dtype=bool)
    sm = np.asarray(shop_mask, dtype=bool)
    if not cm.any() or not sm.any():
        return {"pass": False, "score": 0.0, "failures": ["no garment pixels to compare"], "thresholds": t}

    def sample(rgb: np.ndarray, m: np.ndarray) -> np.ndarray:
        px = np.asarray(rgb)[m]
        return px[:: max(1, int(np.ceil(len(px) / max_px)))].astype(np.float64)

    pc, ps = sample(cand_rgb, cm), sample(shop_rgb, sm)
    # Exposure: the candidate's linear RGB times one gain so its median luminance is the shop garment's (a studio render
    # against a shop photo differs in light, not in fabric). The palette is compared after it; the gain itself is checked
    # on its own, loosely (`max_exposure_gain`).
    lin_c, lin_s = _linear(pc), _linear(ps)
    y_c, y_s = float(np.median(lin_c @ _LUMA)), float(np.median(lin_s @ _LUMA))
    gain = (y_s + 1e-4) / (y_c + 1e-4)
    lc_raw, ls = srgb_to_lab(pc), srgb_to_lab(ps)
    lc = srgb_to_lab(_unlinear(lin_c * min(max(gain, 1.0 / t["max_exposure_gain"]), t["max_exposure_gain"])))
    hel = hellinger(lab_histogram(lc), lab_histogram(ls))
    hel_raw = hellinger(lab_histogram(lc_raw), lab_histogram(ls))
    med_c, med_s = np.median(lc, axis=0), np.median(ls, axis=0)
    de = float(np.linalg.norm(med_c - med_s))
    de_raw = float(np.linalg.norm(np.median(lc_raw, axis=0) - med_s))
    crow = _rows(cm)
    s_rgb, s_m = _scale_to_height(shop_rgb, sm, int(crow[-1]) - int(crow[0]) + 1)
    e_c = edge_density(cand_rgb, cm, t["edge_threshold_l"])
    e_s = edge_density(s_rgb, s_m, t["edge_threshold_l"])
    ratio = None if not e_s or e_c is None else e_c / e_s
    printed = e_s is not None and e_s >= t["min_shop_edge_density"]
    failures: list[str] = []
    if not 1.0 / t["max_exposure_gain"] <= gain <= t["max_exposure_gain"]:
        failures.append(f"lightness differs from the shop photo's garment beyond a lighting change: exposure gain {gain:.2f} outside 1/{t['max_exposure_gain']}-{t['max_exposure_gain']}")
    if hel > t["max_lab_hellinger"]:
        failures.append(f"palette differs from the shop photo's garment: Lab histogram distance {hel:.3f} > {t['max_lab_hellinger']}")
    if de > t["max_median_delta_e"]:
        failures.append(f"median colour differs from the shop photo's garment: Delta E {de:.1f} > {t['max_median_delta_e']}")
    if printed and ratio is not None and ratio < t["min_edge_ratio"]:
        failures.append(f"print lost: edge density {e_c:.3f} is {ratio:.2f} of the shop garment's {e_s:.3f} < {t['min_edge_ratio']}")
    return {
        "lab_hellinger": round(hel, 4),
        "median_delta_e": round(de, 2),
        "version": FIDELITY_VERSION,
        "exposure_gain": round(gain, 3),
        "lab_hellinger_unnormalised": round(hel_raw, 4),
        "median_delta_e_unnormalised": round(de_raw, 2),
        "median_lab_candidate": [round(float(x), 1) for x in med_c],
        "median_lab_shop": [round(float(x), 1) for x in med_s],
        "edge_density_candidate": None if e_c is None else round(e_c, 4),
        "edge_density_shop": None if e_s is None else round(e_s, 4),
        "edge_ratio": None if ratio is None else round(ratio, 3),
        "shop_printed": bool(printed),
        "score": round(1.0 - hel, 4),
        "thresholds": t,
        "pass": not failures,
        "failures": failures,
    }


def region_core(proxy: np.ndarray, bare: np.ndarray, sleeve_band_px: int) -> np.ndarray:
    """The proxy plus our mannequin's arms in the sleeve band below the proxy's top edge: `edit_region` before its
    dilation and neck cut."""
    p = np.asarray(proxy, dtype=bool)
    core = p.copy()
    rows = _rows(p)
    if len(rows) and sleeve_band_px > 0:
        top = int(rows[0])
        core[top:top + sleeve_band_px] |= np.asarray(bare, dtype=bool)[top:top + sleeve_band_px]
    return core


def _extend_down(envelope: np.ndarray, proxy: np.ndarray, d: int, ext: int) -> np.ndarray:
    """`envelope` plus the dilated proxy's lowest row carried `ext` rows further down: the proxy's hem is a length GUESS
    (a knee proxy for every dress without "maxi" or length data), so a longer dress is allowed to run on below it
    (and a dress shorter than it already passes)."""
    env = np.asarray(envelope, dtype=bool).copy()
    rows = _rows(proxy)
    if ext <= 0 or len(rows) == 0:
        return env
    hem = int(rows[-1])
    row = pg.dilate(np.asarray(proxy, dtype=bool), d)[hem]
    env[hem:min(env.shape[0], hem + d + ext + 1)] |= row
    return env


def silhouette_band(garment: np.ndarray, garment_full: np.ndarray, foreground: np.ndarray, bare: np.ndarray, proxy: np.ndarray,
                    legs: tuple[int, int, int, int] | None, sleeve_band_px: int) -> dict[str, Any]:
    """The still against the proxy-dressed silhouette with a tolerance band instead of one IoU (the proxy is coarse: its
    flare and length are guesses, so a correct but shorter or narrower dress loses IoU it should not).

    garment_inside      share of the (unclipped) garment inside the proxy + sleeve band dilated by `band_dilate_frac`
                        of the height, the proxy's hem row carried `hem_extend_frac` further down (a longer dress than
                        the proxy's guessed length): nothing drawn far past the target (run 13's Qwen back repainted the
                        whole figure)
    torso_cover         share of the proxy, eroded by `band_erode_frac`, between its top edge and the crotch (`legs`;
                        the whole eroded proxy without legs) that the garment covers: the body of the garment is there
                        and closed (run 12's romper, open down to the waist, covers less)
    foreground_outside  share of the still's foreground outside (bare + proxy) dilated the same: a moved or re-drawn
                        mannequin or a garment far outside
    """
    g = np.asarray(garment, dtype=bool)
    gf = np.asarray(garment_full, dtype=bool) | g
    fg = np.asarray(foreground, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    p = np.asarray(proxy, dtype=bool)
    h = g.shape[0]
    d = max(1, int(round(SILHOUETTE_BAND["band_dilate_frac"] * h)))
    e = max(1, int(round(SILHOUETTE_BAND["band_erode_frac"] * h)))
    ext = max(0, int(round(SILHOUETTE_BAND["hem_extend_frac"] * h)))
    outer = _extend_down(pg.dilate(region_core(p, b, sleeve_band_px), d), p, d, ext)
    torso = pg.erode(p, e)
    if legs is not None:
        torso[legs[0]:] = False
    gfn, tn, fgn = int(gf.sum()), int(torso.sum()), int(fg.sum())
    inside = 0.0 if gfn == 0 else float((gf & outer).sum()) / gfn
    cover = 0.0 if tn == 0 else float((g & torso).sum()) / tn
    outside = 0.0 if fgn == 0 else float((fg & ~_extend_down(pg.dilate(b | p, d), p, d, ext)).sum()) / fgn
    return {
        "dilate_px": d,
        "hem_extend_px": ext,
        "erode_px": e,
        "garment_inside": round(inside, 4),
        "torso_cover": round(cover, 4),
        "torso_rows": None if tn == 0 else [int(_rows(torso)[0]), int(_rows(torso)[-1])],
        "foreground_outside": round(outside, 4),
        "score": round((inside + cover) / 2.0, 4),
    }


def _lab_bins(lab: np.ndarray) -> np.ndarray:
    lo = np.array([r[0] for r in _HIST_RANGE])
    hi = np.array([r[1] for r in _HIST_RANGE])
    n = np.array(_HIST_BINS)
    idx = np.clip(((lab - lo) / (hi - lo) * n).astype(int), 0, n - 1)
    return np.ravel_multi_index((idx[..., 0], idx[..., 1], idx[..., 2]), _HIST_BINS)


# `garment_coloured` is used only when the colour rule tells the two apart on the pixels we know: at most
# `max_leak` of our bare render's leg pixels read as garment, and at least `min_recall` of the garment's own pixels
# above the crotch do. Otherwise (a grey garment on our grey mannequin: leak 0.37-0.63) the hem comes from the mask,
# so a grey romper's legs are not lost from it. Run 13: FASHN leak 0.0 / recall 0.86 (front), 0.0 / 0.89 (back); Qwen
# 0.0 / 1.0.
HEM_COLOUR = {"max_leak": 0.10, "min_recall": 0.70}


def garment_coloured(rgb: np.ndarray, garment: np.ndarray, bare_rgb: np.ndarray, bare: np.ndarray, crotch: int) -> np.ndarray | None:
    """The garment pixels whose colour is the garment's and not our mannequin's: a pixel counts when the garment's own
    palette (its pixels above the crotch, smoothed Lab histogram) is likelier for its colour than the mannequin's legs'
    palette (our bare render below the crotch). FASHN repaints the legs and boots under a short dress; a garment mask
    that bleeds onto them (run 13: the unclipped mask runs to rows 588 / 599, the hem is at 535 / 533) would otherwise
    move the hem down onto the legs. None when the rule cannot separate the two (`HEM_COLOUR`)."""
    g = np.asarray(garment, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    top = g.copy()
    top[crotch:] = False
    legs = b.copy()
    legs[:crotch] = False
    if not top.any() or not legs.any():
        return None
    pg_ = lab_histogram(srgb_to_lab(np.asarray(rgb)[top]))
    pm = lab_histogram(srgb_to_lab(np.asarray(bare_rgb)[legs]))

    def is_garment(px: np.ndarray) -> np.ndarray:
        bins = _lab_bins(srgb_to_lab(px))
        return pg_[bins] > pm[bins]

    if float(is_garment(np.asarray(bare_rgb)[legs]).mean()) > HEM_COLOUR["max_leak"] or float(is_garment(np.asarray(rgb)[top]).mean()) < HEM_COLOUR["min_recall"]:
        return None
    out = np.zeros_like(g)
    out[g] = is_garment(np.asarray(rgb)[g])
    # Specular highlights on the repainted legs fall in the garment's light bins one pixel at a time: open by 1 px.
    return pg.dilate(pg.erode(out, 1), 1) & g


_HEM_MIN_PX = 3  # a hem row from `hem_mask` needs this many pixels in the leg's column band


def leg_gap_above_hem(garment: np.ndarray, reference: np.ndarray, legs: tuple[int, int, int, int] | None, hem_tol: int,
                      hem_mask: np.ndarray | None = None, hem_basis: str = "garment mask") -> dict[str, Any]:
    """Leg-gap rows (the reference covers the body axis, the garment leaves it open with garment on both sides) counted
    only ABOVE the garment's own hem: the hem is the lowest garment row in each leg's column band (left and right of
    the axis), the higher of the two, and a row within `hem_tol` rows of it is excused only when that hem lies more
    than 2 x `hem_tol` below the crotch.

    A dress shorter than the proxy (run 13's FASHN babydoll ends at row 535, the proxy at 568) leaves our legs visible
    below its hem inside the proxy's skirt zone, and its tiered hem dips at the centre: that is not a romper. A romper
    has two legs of fabric that reach down past the crotch, so its gap runs from the crotch to near its hem (run 12:
    rows 462-537), far above it. A closed romper with a SHORT inseam has its hem right under the crotch: without the
    2 x `hem_tol` condition every one of its gap rows lay within `hem_tol` of its hem and it passed (review of run 13:
    up to about 13 rows, 5 cm at 832 px); with it, those rows count.

    `hem_mask` (default `garment`): the pixels the hem is taken from, e.g. `garment_coloured` (the garment's colour,
    not FASHN's repainted legs); `hem_basis` names it in the record."""
    out: dict[str, Any] = {"leg_gap_rows": 0, "leg_gap_rows_all": 0, "hem_rows": None, "hem_row": None, "hem_tol": int(hem_tol), "gap_rows_span": None,
                           "hem_basis": hem_basis, "hem_excused": None}
    if legs is None:
        return out
    g = np.asarray(garment, dtype=bool)
    hm = g if hem_mask is None else np.asarray(hem_mask, dtype=bool)
    r = np.asarray(reference, dtype=bool)
    y0, y1, x0, x1 = legs
    ax = (x0 + x1) // 2
    hems = []
    for cols in (slice(x0, ax), slice(ax + 1, x1)):
        ys = np.nonzero(hm[:, cols].sum(axis=1) >= (_HEM_MIN_PX if hem_mask is not None else 1))[0]
        hems.append(int(ys[-1]) if len(ys) else None)
    out["hem_rows"] = hems
    hem = None if None in hems else min(hems)
    out["hem_row"] = hem
    excuse = hem is not None and hem - y0 > 2 * hem_tol
    out["hem_excused"] = bool(excuse)
    counted: list[int] = []
    for y in range(y0, y1):
        if r[y, ax] and not g[y, ax] and g[y, x0:ax].any() and g[y, ax + 1:x1].any():
            out["leg_gap_rows_all"] += 1
            if hem is None or not excuse or y < hem - hem_tol:
                if hem is None or y <= hem:
                    counted.append(y)
    out["leg_gap_rows"] = len(counted)
    out["gap_rows_span"] = [counted[0], counted[-1]] if counted else None
    return out


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
    sleeve_band_px: int | None = None,
    fidelity: Mapping[str, Any] | None = None,
    rgb: np.ndarray | None = None,
    bare_rgb: np.ndarray | None = None,
) -> dict[str, Any]:
    """QA v2 of one dressed still (masks are HxW bool). `kind` is the proxy kind (dress, skirt, trousers, top, outerwear).

    `garment` is the mask the composite pastes (clipped to the region); `garment_full` the same garment NOT clipped
    to it (`unclipped_garment`). inside_fraction, the cut share and the border check use `garment_full`: on the
    clipped mask they are 1.0 / 0 / false by construction (`inside_basis` says which one was used). Checks in
    `STILL_QA_WARN_ONLY` go to `warnings` unless named in `hard_checks`.

    silhouette band    `silhouette_band`: garment inside the dilated proxy (+ sleeve band), covering the eroded proxy
                       torso, foreground not far outside (0.4.0; `silhouette_iou` vs bare + proxy is still recorded)
    garment_proxy_iou  garment vs proxy: at the back camera, the proxy's back silhouette
    leg gap, skirt     dress/skirt: rows in the skirt zone (crotch to the proxy's hem) ABOVE the garment's own hem where
                       the garment leaves the axis open between two legs (`leg_gap_above_hem`), and the share of the
                       proxy covered there (phase0_garment.gap_profile, as consistency v2). The hem is taken from the
                       clipped `garment` (never `garment_full`), restricted to garment-coloured pixels
                       (`garment_coloured`) when the still (`rgb`) and our bare render (`bare_rgb`) are given
    print fidelity     `fidelity` (from `print_fidelity`, the still against the shop photo's garment), when given:
                       its failures fail the still
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
    if sleeve_band_px is None:
        sleeve_band_px = int(round(SLEEVE_BAND_FRAC["one-pieces"] * h)) if kind in ("dress", "top", "outerwear") else 0
    band = silhouette_band(g, gf, fg, b, p, legs if kind in ("dress", "skirt") else None, int(sleeve_band_px))
    prof = pg.gap_profile(g, p, legs)
    hem_tol = max(1, int(round(SILHOUETTE_BAND["hem_tol_frac"] * h)))
    hem_mask, basis = None, "garment mask (clipped; never the unclipped mask)"
    if legs is not None and rgb is not None and bare_rgb is not None:
        hem_mask = garment_coloured(rgb, g, bare_rgb, b, legs[0])
        basis = ("garment mask, garment-coloured pixels (not our mannequin's legs)" if hem_mask is not None
                 else "garment mask (clipped): garment and mannequin palettes too close to separate by colour")
    gap = leg_gap_above_hem(g, p, legs, hem_tol, hem_mask=hem_mask, hem_basis=basis)
    # Trousers: leg rows where the proxy's legs stand apart (the axis open between them) and the garment closes it.
    trouser_rows = 0
    if legs is not None and kind == "trousers":
        y0, y1, x0, x1 = legs
        ax = (x0 + x1) // 2
        trouser_rows = sum(1 for y in range(y0, y1) if not p[y, ax] and p[y, x0:ax].any() and p[y, ax + 1:x1].any())
    # Skirt/trousers: garment above the proxy's top edge (the waistband) by more than the band's dilation: a bodice.
    prow = _rows(p)
    above_px = 0
    if kind in ("skirt", "trousers") and len(prow):
        cut = max(0, int(prow[0]) - band["dilate_px"])
        above_px = int(gf[:cut].sum())
    above_frac = 0.0 if gfn == 0 else above_px / gfn
    # Outerwear: the front opening must stay open.
    zone = front_opening_zone(p, b) if kind == "outerwear" else np.zeros_like(p)
    zone_px = int(zone.sum())
    opening_cover = None if zone_px < t["min_opening_px"] else float((gf & zone).sum()) / zone_px
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
    if band["garment_inside"] < t["min_garment_inside"]:
        failures.append(f"silhouette band: garment inside the proxy + sleeves dilated by {band['dilate_px']} px {band['garment_inside']:.3f} < {t['min_garment_inside']} (drawn past the target)")
    if band["torso_cover"] < t["min_torso_cover"]:
        failures.append(f"silhouette band: garment covers {band['torso_cover']:.3f} of the proxy torso eroded by {band['erode_px']} px < {t['min_torso_cover']} (open or missing body)")
    if band["foreground_outside"] > t["max_foreground_outside"]:
        failures.append(f"silhouette band: {band['foreground_outside']:.3f} of the still's foreground lies outside our mannequin wearing the proxy dilated by {band['dilate_px']} px > {t['max_foreground_outside']}")
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
        n = gap["leg_gap_rows"]
        if n >= t["min_leg_gap_rows"] and n / skirt_rows > t["max_leg_gap_frac"]:
            leg_gap_fail = True
            failures.append(
                f"leg gap: the garment leaves the body axis open between two legs in {n}/{skirt_rows} skirt-zone rows above its own hem "
                f"(row {gap['hem_row']}) (a {kind} drawn as shorts or trousers)"
            )
        if skirt_cover is not None and skirt_cover < t["min_skirt_cover"]:
            soft("min_skirt_cover", f"skirt zone: proxy covered {skirt_cover:.3f} < {t['min_skirt_cover']} below the crotch")
    if kind == "trousers" and trouser_rows >= t["min_merged_leg_rows"] and prof["merged_leg_rows"] / trouser_rows > t["max_merged_leg_frac"]:
        failures.append(f"legs merged: the garment closes the body axis between the legs in {prof['merged_leg_rows']}/{trouser_rows} leg rows where the proxy's legs stand apart (trousers drawn as a skirt)")
    if kind in ("skirt", "trousers") and above_frac > t["max_above_waist_frac"]:
        failures.append(f"garment above the waistband: {above_frac:.3f} of the garment lies more than {band['dilate_px']} px above the proxy's top edge > {t['max_above_waist_frac']} (a {kind} drawn with a bodice)")
    if opening_cover is not None and opening_cover > t["max_opening_cover"]:
        failures.append(f"front opening closed: the garment covers {opening_cover:.3f} of the proxy's front opening ({zone_px} px) > {t['max_opening_cover']} (an open front drawn closed)")
    if fidelity is not None and fidelity.get("pass") is False:
        failures.extend(f"print fidelity: {f}" for f in fidelity.get("failures", []))
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
        "silhouette_iou_note": f"recorded, not a check since stage1b-qa-0.4.0 (was >= {LEGACY_MIN_SILHOUETTE_IOU}); see silhouette_band",
        "silhouette_band": band,
        "silhouette_score": band["score"],
        "garment_proxy_iou": round(gp_iou, 4),
        "cover_fraction": round(cover, 4),
        "touches_border": border,
        "mannequin_mae_8bit": None if mannequin_mae is None else round(float(mannequin_mae), 2),
        "proxy_residue": None if residue is None else round(residue, 4),
        "legs": None if legs is None else list(legs),
        "skirt_zone_rows": skirt_rows,
        "leg_gap_rows": gap["leg_gap_rows"],
        "leg_gap_rows_all": gap["leg_gap_rows_all"],
        "garment_hem_rows": gap["hem_rows"],
        "garment_hem_basis": gap["hem_basis"],
        "leg_gap_hem_excused": gap["hem_excused"],
        "leg_gap_hem_tol": gap["hem_tol"],
        "leg_gap": leg_gap_fail,
        "skirt_cover": None if skirt_cover is None else round(skirt_cover, 4),
        "trouser_leg_rows": trouser_rows,
        "merged_leg_rows": prof["merged_leg_rows"],
        "above_waist_px": above_px,
        "above_waist_fraction": round(above_frac, 4),
        "front_opening_px": zone_px,
        "front_opening_cover": None if opening_cover is None else round(opening_cover, 4),
        "fidelity": None if fidelity is None else dict(fidelity),
        "thresholds": t,
        "warn_only": sorted(STILL_QA_WARN_ONLY - hard),
        "pass": not failures,
        "failures": failures,
        "warnings": warnings,
        "label": QA_LABEL,
    }


def qa_score(qa: Mapping[str, Any]) -> float:
    """A ranking between engines for one view (higher is better); not a quality measurement. Since stage1b-qa-0.4.0
    the silhouette band's score (mean of garment inside and torso cover); `pick_engine` ranks by print fidelity first."""
    sc = qa.get("silhouette_score")
    if sc is not None:
        return round(float(sc), 4)
    parts = [qa.get("silhouette_iou") or 0.0, qa.get("garment_proxy_iou") or 0.0]
    parts.append(1.0 if qa.get("skirt_cover") is None else float(qa["skirt_cover"]))
    mae = qa.get("mannequin_mae_8bit")
    parts.append(1.0 if mae is None else max(0.0, 1.0 - float(mae) / 50.0))
    return round(sum(parts) / len(parts), 4)


def _fid(c: Mapping[str, Any]) -> dict[str, Any] | None:
    f = (c.get("qa") or {}).get("fidelity")
    return f if isinstance(f, Mapping) else None


def pick_engine(candidates: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """`candidates`: one record per engine with `engine`, `qa` (pass, score, fidelity) or `error`.

    Order (stage1b-qa-0.4.0): only a candidate that passes every hard check can be pinned; among those, the highest
    print fidelity (`fidelity.score`, to 2 decimals so a near tie falls through), then the highest silhouette score.
    A candidate whose print fidelity FAILED is never picked, not even as the rejected still to look at (run 13: Qwen's
    solid blue front had the better old score and was picked over FASHN's correct print). When none passes, the still
    written to `rejected/` is the best of the others by the same order; when every candidate failed fidelity, the one
    with the highest fidelity is shown as rejected (`rejected_still`), and `engine` is None."""
    ok = [c for c in candidates if "error" not in c]

    def key(c: Mapping[str, Any]) -> tuple[float, float]:
        f = _fid(c)
        return (round(float(f["score"]), 2) if f and f.get("score") is not None else -1.0, float(c["qa"].get("score") or 0.0))

    fid_failed = [c["engine"] for c in ok if (_fid(c) or {}).get("pass") is False]
    passing = [c for c in ok if c["qa"].get("pass") and c["engine"] not in fid_failed]
    out: dict[str, Any] = {
        "order": "pass all hard checks -> highest print fidelity -> highest silhouette score; a fidelity failure is never picked",
        "passed": [c["engine"] for c in passing],
        "fidelity_failed": fid_failed,
        "scores": {c["engine"]: c["qa"].get("score") for c in ok},
        "fidelity": {c["engine"]: (_fid(c) or {}).get("score") for c in ok},
        "rejected_still": None,
    }
    if not ok:
        return {**out, "engine": None, "reason": "every engine failed with an error"}
    if passing:
        best = max(passing, key=key)
        why = "the only candidate that passes every check" if len(passing) == 1 else "passes every check; highest print fidelity, then silhouette score"
        return {**out, "engine": best["engine"], "reason": why}
    pool = [c for c in ok if c["engine"] not in fid_failed]
    if pool:
        best = max(pool, key=key)
        return {**out, "engine": best["engine"], "reason": "no engine passed QA: best of the candidates whose print fidelity did not fail, rejected"}
    best = max(ok, key=key)
    return {**out, "engine": None, "rejected_still": best["engine"], "reason": "no engine passed QA and every candidate failed print fidelity: none picked; the highest fidelity is kept as rejected"}


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
    """QA v2 on the stage 1b outputs already in `job_dir`, per engine candidate when the job has them
    (`stage1b/raw/<view>_<engine>.png` with `stage1b/candidates/<view>_<engine>_garment_mask[_unclipped].png`, from
    stage1b-qa-0.3.0), else the single still (`stage1b/raw/<view>.png`, `stage1b/garment_mask_<view>.png`); then the
    engine choice (`pick_engine`), the garment colour of each shop photo (`garment_colour`) and the back-view checks.
    For a job exported before 0.4.0 the proxy mask is control/proxy_mask/<frame>.png (same proxy, same camera) and
    the garment mask is the one stage 1b made against the BARE render (clipped only to v1's wide margin, so it
    serves as the unclipped mask here); the record says so. Print fidelity needs the shop photo and its SAM 2 mask
    (`stage1b/source/<role>_mask.png`)."""
    import phase0_lib as lib

    spec = manifest["stage1b"]
    kind = ((manifest.get("control") or {}).get("proxy") or {}).get("kind") or (spec.get("target") or {}).get("proxy_kind") or manifest["category"]
    tryon_cat = lib.tryon_category(manifest["category"])
    bg = tuple(spec["background_rgb"])
    p = lambda rel: os.path.join(job_dir, rel)  # noqa: E731
    out: dict[str, Any] = {"version": STAGE1B_QA_VERSION, "kind": kind, "views": {}, "colour": {}}
    src = {s["role"]: s for s in spec.get("sources", [])}
    shops: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for role in ("front", "back"):
        mpath = p(f"{lib.STAGE1B_DIR}/source/{role}_mask.png")
        if role in src and os.path.exists(mpath):
            from PIL import Image

            m = _read_mask(mpath)
            img = Image.open(p(src[role]["path"])).convert("RGB")
            if img.size != (m.shape[1], m.shape[0]):
                img = img.resize((m.shape[1], m.shape[0]), Image.LANCZOS)
            shops[role] = (np.asarray(img), m)
            out["colour"][role] = garment_colour(shops[role][0], m)
    picked: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for v in spec["views"]:
        name, frame = v["view"], int(v["frame"])
        proxy_rel = v.get("proxy_mask") or f"{manifest['control']['proxy_mask_dir']}/{frame:04d}.png"
        bare_rgb = _read_rgb(p(v["bare_rgb"]))
        bare = _read_mask(p(v["bare_mask"]))
        proxy = _read_mask(p(proxy_rel))
        h, w = bare.shape
        region, region_rec = edit_region(proxy, bare, tryon_cat, keep_open=kind == "outerwear")
        target = _read_rgb(p(v["proxy_rgb"])) if v.get("proxy_rgb") else None
        shop = shops.get(name if not v.get("invented") else "front")
        engines = [e for e in ("fashn", "qwen") if os.path.exists(p(f"{lib.STAGE1B_DIR}/raw/{name}_{e}.png")) and os.path.exists(p(f"{lib.STAGE1B_DIR}/candidates/{name}_{e}_garment_mask.png"))]
        entries = [(e, f"{lib.STAGE1B_DIR}/raw/{name}_{e}.png", f"{lib.STAGE1B_DIR}/candidates/{name}_{e}_garment_mask.png", f"{lib.STAGE1B_DIR}/candidates/{name}_{e}_garment_mask_unclipped.png") for e in engines]
        if not entries:
            entries = [(None, f"{lib.STAGE1B_DIR}/raw/{name}.png", v["garment_mask"], v.get("garment_mask_unclipped") or f"{lib.STAGE1B_DIR}/garment_mask_unclipped_{name}.png")]
        cands: list[dict[str, Any]] = []
        arrays: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        for eng, raw_rel, mask_rel, unclipped_rel in entries:
            raw = _read_rgb(p(raw_rel))
            saved = _read_mask(p(mask_rel))
            garment_full = _read_mask(p(unclipped_rel)) if os.path.exists(p(unclipped_rel)) else saved
            garment = saved & region
            fgb = lib.keep_large_components(lib.mask_not(lib.background_mask(raw.tobytes(), w, h, bg, 10)), w, h, 0.02)
            fg = np.frombuffer(bytes(fgb), np.uint8).reshape(h, w).astype(bool)
            keep = bare & ~region
            mae = float(np.abs(raw.astype(np.int16) - bare_rgb.astype(np.int16))[keep].mean()) if keep.any() else None
            residue = proxy_residue(raw, target, proxy, garment) if target is not None else None
            fid = print_fidelity(raw, garment, shop[0], shop[1]) if shop is not None and garment.any() else None
            qa = still_qa(garment, fg, bare, proxy, region, kind=kind, mannequin_mae=mae, residue=residue, garment_full=garment_full,
                          sleeve_band_px=region_rec["sleeve_band_px"], fidelity=fid, rgb=raw, bare_rgb=bare_rgb)
            qa["score"] = qa_score(qa)
            label = eng or "still"
            cands.append({
                "engine": label,
                "raw": raw_rel,
                "garment_mask": mask_rel,
                "garment_mask_unclipped": unclipped_rel if os.path.exists(p(unclipped_rel)) else f"{mask_rel} (no unclipped mask: used as is)",
                "candidate_colour": garment_colour(raw, garment),
                "qa": qa,
            })
            arrays[label] = (raw, garment)
        decision = pick_engine(cands)
        shown = decision["engine"] or decision.get("rejected_still")
        out["views"][name] = {
            "proxy_mask": proxy_rel,
            "edit_region": region_rec,
            "mannequin_grey": grey_collision(bare_rgb, bare),
            "candidates": cands,
            "selection": decision,
            "qa": next(c["qa"] for c in cands if c["engine"] == shown) if shown else None,
        }
        if shown:
            picked[name] = arrays[shown]
    bv = next(v for v in spec["views"] if v["view"] == "back")
    if not bv.get("invented") and "back" in src and {"front", "back"} <= set(shops) and {"front", "back"} <= set(picked):
        (sf, sfm), (sb, sbm) = shops["front"], shops["back"]
        out["back_view"] = back_view_checks(picked["front"][0], picked["front"][1], picked["back"][0], picked["back"][1], sf, sfm, sb, sbm)
        out["back_view"]["note"] = "the picked (or shown-as-rejected) front and back candidates, whether or not the front passed"
    else:
        out["back_view"] = {"pass": None, "failures": [], "note": "not checked: invented back, no shop segmentation or no picked still"}
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
    for role, c in rec["colour"].items():
        print(f"[stage1b-qa] shop {role} colour: {c.get('phrase')!r} (accent share {c.get('accent_share')}, {c.get('names')})", file=sys.stderr)
    for name, v in rec["views"].items():
        for c in v["candidates"]:
            q, f = c["qa"], c["qa"].get("fidelity") or {}
            b = q["silhouette_band"]
            print(f"[stage1b-qa] {name}/{c['engine']}: pass={q['pass']} band inside={b['garment_inside']} torso={b['torso_cover']} outside={b['foreground_outside']} "
                  f"(iou {q['silhouette_iou']}) leg_gap={q['leg_gap_rows']}/{q['skirt_zone_rows']} (all {q['leg_gap_rows_all']}, hem {q['garment_hem_rows']}) "
                  f"fidelity hel={f.get('lab_hellinger')} dE={f.get('median_delta_e')} edges={f.get('edge_ratio')} colour={c['candidate_colour'].get('phrase')!r} "
                  f"{q['failures']}", file=sys.stderr)
        print(f"[stage1b-qa] {name}: selection {v['selection']['engine']} ({v['selection']['reason']})", file=sys.stderr)
    print(f"[stage1b-qa] back view: {rec['back_view'].get('pass')} {rec['back_view'].get('failures')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
