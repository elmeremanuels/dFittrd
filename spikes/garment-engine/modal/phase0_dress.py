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
    stage1b-qa-0.6.1: these three are also listed as ``type_failures``. They are a different garment, not a provisional
    silhouette or fidelity miss, so ``--accept-failed-dress`` does not override them: ``run_phase0`` stops before stage 2.

``after run 15`` (stage1b-qa-0.7.0)
    Run 15's blouse and cardigan stills were torn and paid for stage 2 anyway (--accept-failed-dress). Three causes,
    all in our code around the engine: (1) the composite pasted only the garment MASK over our bare render, and for
    the blouse front that mask was the difference against the proxy-dressed target, whose beige (0.72, 0.68, 0.62)
    is the blouse's cream ground (SAM 2 disagreed, IoU 0.43): 0.108 of the garment's outline showed our mannequin.
    ``still_garment_mask`` adds what our grey mannequin colour model (``phase0_garment.segment_garment``) says is not
    mannequin inside the proxy. (2) The shop photo's SAM 2 mask had holes (the cardigan back: 8,422 px in the knit
    sleeves); FASHN fills everything outside the mask with grey 127 and copied it as grey sleeves.
    ``clean_source_mask`` closes and fills it. (3) The trousers' edit region was one block: the proxy's 6 px gap
    between the palazzo legs vanished in the 25 px margin. ``trouser_gap_zone`` keeps a gap open (see
    ``edit_region(open_crotch=...)``). New TYPE checks, never overridden by --accept-failed-dress: mannequin seen
    through the garment (``see_through``), a body far shorter than the proxy (``body_length``), front and back of
    different garments (``view_agreement``: length or sleeves), and merged legs measured on what the engine drew
    (the unclipped mask), not on the clipped composite.

``after run 16a`` (stage1b-qa-0.10.0)
    Five reviews of run 16a's stills (stage 1b only) found visible defects QA 0.9.0 passed. In our code: (1) the composite
    called a grey print OFF our body mannequin and showed studio background there (the palazzo's leg holes):
    ``still_garment_mask`` applies the mannequin colour test only on our body, and ``unpasted_cloth(proxy=...)`` counts
    what is drawn off it; (2) the engines draw a narrower shoulder than our mannequin's square caps and background beside
    it (grey caps above azure's sleeves in runs 14-16a, a grey band along the cardigan's sleeves): ``conform_edges`` stretches
    the garment's outer band over our body, ``edge_profile`` measures what is left (TYPE: ``body_beside``); (3) the trouser
    conform to the proxy's stepped hip block made a shelf: trousers are no longer conformed to the proxy (``conform_edges``
    covers our hips), and ``width_steps`` fails a step (TYPE); (4) per-view selection mixed engines: ``pick_engine(prefer=)``;
    (5) the difference mask counted bare forearm as garment: ``still_garment_mask(bare_rgb=...)``. In the engines' drawing,
    now checked: a crotch split high above the proxy's with our mannequin in it (``crotch_height``, TYPE), a back in another
    colour (``view_colour``), sleeves swapped left/right (``side_colour``), a waistband at another height front and back
    (``view_agreement`` top gap, TYPE). ``compose_candidate`` is the one path the GPU app and the replay share;
    ``recompose_job`` re-makes a finished job's stills on CPU (run 16b: stage 2 pins what was reviewed).

``for run 17a`` (stage1b-qa-0.11.0)
    A draw plan (lib.parse_draw_plan) draws several seeds of both engines per view; ``finalize_draws`` scores every candidate
    with the replay code and ``pick_pair`` takes a front/back pair only when the pair checks the one-pair app applies all pass
    (``back_view_checks``, ``view_agreement``, ``view_colour``). ``import_kept`` carries a candidate over from an earlier run
    of the same job (``archive_stage1b`` moves that run into stage1b/history/), re-scored, never redrawn. No threshold changed.

``after run 16b`` (stage1b-qa-0.12.0)
    Run 16a's azure back carried a cut tie string 12 rows below the hem (pasted by ``still_garment_mask``'s outside-the-proxy
    step); stage 2 grew it into a cream flap. ``trim_strands`` (in ``compose_candidate``) leaves at most a few thin strings
    hanging below the hem outside the proxy out of the paste (recorded); ``hanging_strands`` in ``still_qa`` fails any left
    (TYPE). A fringe (more pieces) is never trimmed, only flagged. No other threshold changed.

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

STAGE1B_QA_VERSION = "stage1b-qa-0.12.0"

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
    # stage1b-qa-0.7.0 (after run 15), TYPE checks. Measured on run 15's pinned masks (replay, `rescore_job`):
    #   see_through   blouse front 0.108, back 0.044, cardigan back 0.037; azure 0 / 0, skirt 0 / 0, palazzo 0 / 0,
    #                 run 14 azure 0 / 0
    #   body_length   blouse front 0.295, cardigan front 0.469; every other view 0.89-1.05 (run 14 azure 0.892 / 0.895)
    "max_see_through": 0.02,  # our mannequin inside the garment's own outline, on the eroded proxy, share of that outline
    "min_body_length": 0.70,  # garment bottom / proxy bottom from the proxy's top edge, central body columns (not trousers)
    # stage1b-qa-0.8.0 (founder's review of run 15's skirt: "see the hips"), a TYPE check. In the hip zone (`hip_profile`)
    # a row is short when the garment stops at least `hip_short_frac` of the height (5 px at 832, about 2 cm) inside the
    # proxy's run on either side. Run 15 replay (`hip_profile` on the pasted masks): skirt front 64 / 64 rows short
    # (median 8 / 8 px per side), back 94 / 94 (8 / 5 px); azure 9 / 67 rows at <= 3 px (0 at 5 px), back 0; run 14 azure
    # 0 / 0. The video then opened the skirt into a side slit (frames 20, 40), the stills showing our hip beside it.
    "hip_short_frac": 0.006,
    "max_hip_short_frac": 0.5,  # share of the hip-zone rows that may be short
    # ... and our mannequin must show beside the garment (between it and the proxy's edge) in more than this share of the
    # zone rows: a garment narrower than the proxy's ease but over our hips is not this failure (run 15 skirt 1.0 / 1.0,
    # azure 0 / 0). Both conditions together.
    "max_hip_exposed_frac": 0.25,
    "min_hip_rows": 12,  # rows for 832 px frames; scaled: fewer zone rows, not checked
    # stage1b-qa-0.9.0 (review of 0.8.0), a TYPE check: cloth the engine drew on our body inside the edit region that the
    # composite does not paste (`unpasted_cloth`), share of the pasted garment. Run 15 raw outputs: the blouse front on the
    # 0.8.0 composite mask 551 px, 0.0141 (rows 428-444, the shirt-tail notch), 0 on the 0.9.0 mask; on the masks run 15
    # pasted, blouse 0.542 / 0.046, cardigan back 0.024 (torn); controls: azure 0-0.0003, skirt 0-0.0028, palazzo 0-0.0005,
    # cardigan front 0.005 (pasted) / 0 (0.9.0). Provisional.
    "max_unpasted_frac": 0.005,
    # stage1b-qa-0.10.0 (run 16a), TYPE checks; measured on run 16a, 15 and 14 (README, "Stage 1b after run 16a"):
    # our body past the cloth's edge where the engine drew background (`edge_profile`, after `conform_edges`); fails when
    # both are exceeded. Run 16a after the conform: azure front 0, back 57 px (the flat top of the right shoulder cap, 5 rows,
    # up to 13 px wide: a grey tick visible at 2x; runs 14 / 15: 56 / 46), blouse front (Qwen) 94, cardigan front (Qwen) 297
    # (the whole shoulder slope); before the conform azure was ~340 / 225 px. Set to flag the azure tick: it is visible.
    "max_body_beside_px": 40,
    "max_body_beside_frac": 0.0005,
    # a step in the outline (`width_steps`), share of the height (6 px at 832)
    "max_width_step_frac": 0.0072,
    # trousers: legs splitting more than this share of the height (12 px at 832) above the proxy's crotch with our mannequin
    # showing between them (`crotch_height`)
    "max_crotch_rise_frac": 0.015,
    "max_crotch_mannequin_px": 150,
    # trousers (stage1b-qa-0.10.1, review of 0.10.0): our mannequin left showing inside the gap strip between the legs
    # (`gap_mannequin`), px at 832. Run 16a's palazzo on 0.10.0 (the strip never pasted): Qwen front 734, back 742, FASHN
    # 734 / 742: two grey thigh wedges at the crotch, visible at 1x. Same scale as `max_body_beside_px`. TYPE check.
    "max_gap_mannequin_px": 40,
}
# stage1b-qa-0.7.0: front and back of the same garment. Run 15 (the masks stage 1b pinned): length gap cardigan 0.458,
# blouse 0.632 (torn front), azure 0.007, run 14 azure 0.003, skirt 0.037; sleeve cover gap cardigan 0.638 (long knit
# sleeves on the front, grey sleeves on the back), blouse 0.162. Checked only when the proxy has sleeves (their pixels at
# least `min_proxy_sleeve_share` of the proxy: cardigan 0.44, blouse 0.32; azure 0.04, a proxy without sleeves).
VIEW_THRESHOLDS: dict[str, float] = {
    "max_view_length_gap": 0.25,
    "max_view_sleeve_gap": 0.40,
    "min_proxy_sleeve_share": 0.15,
    # stage1b-qa-0.10.0 (run 16a's skirt: the front's waistband 26 px lower than the back's, top offsets 0.113 vs 0.040 of the
    # proxy's length; a waist step in the 3D). Skirts and trousers.
    "max_view_top_gap": 0.05,
}
# Columns this far (share of the height; 6 px at 832) outside the proxy's torso run count as sleeve.
SLEEVE_PAD_FRAC = 0.0072
# Shop photo masks (SAM 2 on a busy photo): closed by this share of the photo's long side (4 px at 1200), then holes up to
# `SOURCE_HOLE_FRAC` of the photo filled. Run 15: the cardigan back's knit sleeves gained 13,136 px (4.8 % of the mask;
# FASHN had drawn them grey from the 127 fill); every other photo of the five 48-332 px (0.02-0.11 %).
SOURCE_CLOSE_FRAC = 0.0035
SOURCE_HOLE_FRAC = 0.01
# Trousers: the gap kept open between the proxy's legs, from its crotch down, at least this share of the height wide
# (20 px at 832, about 8 cm at the turntable distance). Run 15's palazzo proxy leaves 6 px there; the 25 px edit margin
# closed it, so FASHN was given one block to paint and drew a skirt (259 / 259 merged rows).
TROUSER_GAP_FRAC = 0.024
# Shares of the frame height (scaled per still): the band's dilation (12 px at 832) and erosion (8 px), and how far above
# the garment's own hem a leg-gap row must lie (8 px: a tiered or curved hem dips at the centre; run 13's FASHN
# babydoll has 5 open rows right at its hem, 531-535 with the hem at 535).
# `hem_extend_frac` (0.06 of 832 px = 50 rows, about 20 cm; review of run 13): the band runs on this far below the
# proxy's hem, straight down at the hem's width, so a midi dress against the default knee proxy passes the band (before,
# +20 rows past the proxy hem gave garment inside 0.952 < 0.96). The edit region is NOT extended (FASHN's input stays
# as on GPU run 13): a dress more than the edit margin (25 px) past the proxy hem is still cut by the region and fails
# `min_inside_fraction`; an open issue (README).
SILHOUETTE_BAND = {"band_dilate_frac": 0.015, "band_erode_frac": 0.01, "hem_tol_frac": 0.01, "hem_extend_frac": 0.06}
_ROW_KEYS = ("min_skirt_zone_rows", "min_leg_gap_rows", "min_merged_leg_rows", "min_hip_rows")
_PX_KEYS = ("max_body_beside_px", "max_crotch_mannequin_px", "max_gap_mannequin_px")
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
    "front, neckline not deeper than the back photo's. Type checks (never overridden): legs merged, a bodice on a skirt or "
    "trousers, an open front closed, our mannequin seen through the garment, a body far shorter than the proxy, front and "
    "back of different garments (0.7.0), a garment narrower than the proxy at the hips (0.8.0), cloth the engine drew that the composite does not paste (0.9.0), our mannequin beside the cloth's edge, a shelf in the outline, "
    "a crotch split too high, a waistband at another height front and back (0.10.0), a thin piece hanging below the hem (0.12.0); also front and back of another colour and "
    "sleeves swapped against the shop photo (0.10.0, not type checks). Provisional thresholds (runs 12-16a and the synthetic dress). A "
    "check, not a measurement; every still is a generated estimate."
)


def scaled(height: int, thresholds: Mapping[str, float] | None = None) -> dict[str, float]:
    t = {**STILL_QA_THRESHOLDS, **(thresholds or {})}
    for k in _ROW_KEYS:
        if thresholds is None or k not in thresholds:
            t[k] = max(1, int(round(t[k] * height / 832.0)))
    for k in _PX_KEYS:  # pixel counts scale with the area
        if thresholds is None or k not in thresholds:
            t[k] = max(1, int(round(t[k] * (height / 832.0) ** 2)))
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


def trouser_gap_zone(proxy: np.ndarray, bare: np.ndarray, min_px: int | None = None) -> np.ndarray:
    """Trousers: the strip between the proxy's two legs, from the first row where the proxy leaves the legs' axis open
    (the crotch) to its hem, at least `min_px` wide (default `TROUSER_GAP_FRAC` of the height), centred on the proxy's
    own gap. Empty where the proxy never splits (a side view, a skirt). It is taken out of the edit region and painted
    as our bare render in the engine's input, so the engine sees the legs apart instead of one block to fill."""
    p = np.asarray(proxy, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    h, w = p.shape
    zone = np.zeros_like(p)
    legs = pg.leg_rows(b)
    if legs is None:
        return zone
    min_px = max(1, int(round(TROUSER_GAP_FRAC * h))) if min_px is None else int(min_px)
    _, _, x0, x1 = legs
    ax = (x0 + x1) // 2
    for y in range(int(_rows(p)[0]) if p.any() else h, h):
        row = p[y]
        if row[ax] or not row[x0:ax].any() or not row[ax + 1:x1].any():
            continue
        a = ax
        while a > 0 and not row[a - 1]:
            a -= 1
        c = ax
        while c < w - 1 and not row[c + 1]:
            c += 1
        mid = (a + c) / 2.0
        half = max((c - a + 1) / 2.0, min_px / 2.0)
        zone[y, max(0, int(round(mid - half))):min(w, int(round(mid + half)))] = True
    return zone


def qa_proxy(proxy: np.ndarray, gap: np.ndarray | None) -> np.ndarray:
    """The proxy the QA compares a still with: the proxy minus the trouser gap kept open in the engine's input (the
    engine was shown the legs that far apart, so the strip is neither placeholder left over nor torso to cover)."""
    p = np.asarray(proxy, dtype=bool)
    return p if gap is None else p & ~np.asarray(gap, dtype=bool)


def engine_target(target: np.ndarray, bare_rgb: np.ndarray, gap: np.ndarray | None) -> np.ndarray:
    """The proxy-dressed render the engine dresses, with the trouser gap painted as our bare render (studio background,
    the inner thighs where they show): the placeholder legs no longer touch in the engine's input."""
    t = np.asarray(target)
    if gap is None or not np.asarray(gap, dtype=bool).any():
        return t
    out = t.copy()
    g = np.asarray(gap, dtype=bool)
    out[g] = np.asarray(bare_rgb)[g]
    return out


def edit_margin_px(tryon_cat: str, height: int) -> int:
    return max(1, int(round(EDIT_MARGIN_FRAC[tryon_cat] * height)))


def edit_region(
    proxy: np.ndarray, bare: np.ndarray, tryon_cat: str, margin_px: int | None = None, sleeve_band_frac: float | None = None,
    keep_open: bool = False,
    open_crotch: np.ndarray | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    """The area the try-on engine may change: the proxy plus the mannequin's arms in a band below the proxy's top
    edge (sleeves, `sleeve_band_frac` of the height, default `SLEEVE_BAND_FRAC`), dilated by `margin_px` (default
    `EDIT_MARGIN_FRAC`), minus everything above the neckline. `keep_open` (outerwear): the proxy's front opening
    (`front_opening_zone`), eroded by half the margin so the fronts' edges may still move into it, is taken out, so a
    masked engine cannot close the front. `open_crotch` (trousers, `trouser_gap_zone`): taken out after the dilation,
    so the region keeps two legs. Returns (mask, record)."""
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
    crotch_px = 0
    if open_crotch is not None:
        gap = np.asarray(open_crotch, dtype=bool)
        crotch_px = int((region & gap).sum())
        region &= ~gap
    return region, {
        "kept_open_px": opening_px,
        "crotch_gap_px": crotch_px,
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


def fashn_person_labels(region: np.ndarray, bare: np.ndarray, proxy: np.ndarray, label_ids: Mapping[str, int], garment_label: str,
                        keep_visible: np.ndarray | None = None) -> np.ndarray:
    """FASHN's person label map for masked mode (segmentation_free=False): the edit region gets the category's
    garment label (FASHN greys it out and dresses it), the head above the proxy `face` and the rest of our
    mannequin `hands` (both are in FASHN's exclusion set: kept as they are). We never run FASHN's own parser.

    `keep_visible` (trousers: `trouser_gap_zone`) is labelled `feet`, which FASHN's `create_clothing_agnostic_image`
    (pinned commit) excludes from its grey inpaint area for lower-body garments; without it the bounding-box part of
    that area greys the strip between the legs too, and the engine sees one block."""
    region = np.asarray(region, dtype=bool)
    bare = np.asarray(bare, dtype=bool)
    top = int(_rows(proxy)[0])
    lab = np.zeros(region.shape, np.uint8)
    keep = bare & ~region
    lab[keep] = label_ids["hands"]
    head = keep.copy()
    head[top:] = False
    lab[head] = label_ids["face"]
    if keep_visible is not None:
        lab[np.asarray(keep_visible, dtype=bool) & ~region] = label_ids["feet"]
    lab[region] = label_ids[garment_label]
    return lab


def clean_source_mask(mask: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    """The shop photo's garment mask (SAM 2) closed by `SOURCE_CLOSE_FRAC` of the long side and with its enclosed holes up
    to `SOURCE_HOLE_FRAC` of the photo filled. FASHN replaces every pixel outside this mask with grey 127 in its garment
    image (`create_garment_image`) and copies that grey as cloth: run 15's cardigan back had 8,422 px of holes in its knit
    sleeves and FASHN drew grey sleeves (lum 123, chroma 2 on 75 % of the proxy's sleeve pixels). Only adds pixels."""
    m = np.asarray(mask, dtype=bool)
    h, w = m.shape
    r = max(1, int(round(SOURCE_CLOSE_FRAC * max(h, w))))
    closed = pg.erode(pg.dilate(m, r), r) | m
    filled = pg.fill_holes(closed, int(SOURCE_HOLE_FRAC * h * w))
    return filled, {"close_px": r, "max_hole_px": int(SOURCE_HOLE_FRAC * h * w), "added_px": int((filled & ~m).sum()),
                    "added_share": 0.0 if not m.any() else round(float((filled & ~m).sum()) / float(m.sum()), 4)}


UNPASTED = {"diff": 40, "bg_tol": 12}
REST_MIN_CHROMA = 1.25


# stage1b-qa-0.10.0 (run 16a): pixels of the chosen mask on our body that are our mannequin as drawn (mannequin grey, within
# `MANNEQUIN_MATCH_TOL` levels of our bare render) and join the bare body outside the mask are not garment. Run 16a's blouse
# front: the difference prior (SAM 2 disagreed, IoU 0.31) counted about 4,300 px of bare forearm and open V neck as garment,
# so sleeve cover, torso cover and the views' sleeve gap were measured on a mask 11 % too big. Removing them changes no
# pixel of the composite by more than this tolerance (they show our bare render either way).
MANNEQUIN_MATCH_TOL = 20


def still_garment_mask(gen: np.ndarray, chosen: np.ndarray, bare: np.ndarray, proxy: np.ndarray, region: np.ndarray,
                       grow_px: int | None = None, bg: Sequence[int] | None = None,
                       bare_rgb: np.ndarray | None = None) -> tuple[np.ndarray, dict[str, Any]]:
    """The garment mask the composite pastes: the chosen mask (SAM 2, or the difference against the proxy-dressed target
    when SAM 2 disagreed) plus every pixel inside the proxy (or within `grow_px` of the chosen mask) that our grey
    mannequin colour model (`phase0_garment.segment_garment`, sampled from the still's own head) says is not mannequin,
    clipped to the edit region. Run 15's blouse front: the difference mask lost the cream ground of the print (it is the
    proxy's beige), 21,112 px pasted, 0.108 of the outline showed our mannequin; with this 40,303 px and 0.0. When the
    garment itself reads as mannequin grey (`ambiguous_with_mannequin`), colour cannot tell them apart and the chosen mask
    is kept as it is. What the engine drew as bare mannequin (grey) stays out, so `see_through` still sees it."""
    c = np.asarray(chosen, dtype=bool)
    r = np.asarray(region, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    h = c.shape[0]
    grow_px = max(1, int(round(0.004 * h))) if grow_px is None else int(grow_px)
    seg, info = pg.segment_garment(gen, bare, r, proxy)
    rec = {"version": pg.GARMENT_SEGMENT_VERSION, "ambiguous_with_mannequin": bool(info["ambiguous_with_mannequin"]),
           "mannequin": info["mannequin"], "grow_px": grow_px, "chosen_px": int((c & r).sum()), "dropped_mannequin_px": 0}
    if info["ambiguous_with_mannequin"]:
        out = c & r
    else:
        if bare_rgb is not None:
            # stage1b-qa-0.10.0: our mannequin as drawn inside the chosen mask, joined to the bare body outside it, is not garment.
            g3 = np.asarray(gen)[..., :3]
            same = np.abs(g3.astype(np.int16) - np.asarray(bare_rgb)[..., :3].astype(np.int16)).max(axis=2) <= MANNEQUIN_MATCH_TOL
            drop = c & b & same & pg.mannequin_like(g3, info["mannequin"])
            outside = b & ~c
            drop = pg.keep_touching(drop | outside, outside) & drop
            rec["dropped_mannequin_px"] = int((drop & r).sum())
            c = c & ~drop
        allowed = (np.asarray(proxy, dtype=bool) | pg.dilate(c, grow_px)) & r
        # Only what is clearly not mannequin is added: the colour test at twice the chroma ceiling. Run 15's cardigan
        # front: FASHN drew a bare midriff in a warm grey (chroma 8-15, lum 116-140), which the strict test calls cloth.
        # stage1b-qa-0.10.0 (run 16a): only ON our body (2 px band). Off it there is no mannequin to confuse with cloth: run
        # 16a's palazzo front (Qwen) has grey-blue print patches (median chroma 8, lum 123) on the proxy's legs beside our
        # slimmer legs; the colour test called them mannequin and the composite showed studio background there, 992 px of
        # white holes along both legs, which QA did not see (`unpasted_cloth` counted our body only).
        # Off it, only the strict test (the model's own chroma ceiling, no margin): a body the engine drew beside ours (run
        # 14's azure: FASHN's legs, offset from ours under the hem) is still not pasted.
        g3m = np.asarray(gen)[..., :3]
        near_b = pg.dilate(b, 2)
        loose = (pg.mannequin_like(g3m, info["mannequin"], 2.0, pg.SEGMENT_DEFAULTS["mannequin_lum_margin"]) & near_b) | (pg.mannequin_like(g3m, info["mannequin"]) & ~near_b)
        # Never studio background (`bg`, within `UNPASTED["bg_tol"]`; stage1b-qa-0.9.0): on our body the segmenter counts
        # whatever is not mannequin grey as cloth, and where FASHN drew slimmer legs than ours it painted background beside
        # them. Run 14's azure front on the 0.7.0 / 0.8.0 composite: white slivers pasted down our legs below the hem
        # (the garment-coloured hem moved from about row 531 to 566, a 27 / 109 row leg gap; the pasted mask: 0).
        if bg is not None:
            loose = loose | (np.abs(np.asarray(gen)[..., :3].astype(np.int16) - np.asarray(bg, dtype=np.int16)).max(axis=2) <= UNPASTED["bg_tol"])
        add = seg & allowed & ~loose
        # Off our body, grey pieces between garment rows above and below are a grey print, not a body (stage1b-qa-0.10.0).
        grey_off = seg & allowed & ~near_b & pg.mannequin_like(g3m, info["mannequin"])
        if bg is not None:
            grey_off &= ~(np.abs(g3m.astype(np.int16) - np.asarray(bg, dtype=np.int16)).max(axis=2) <= UNPASTED["bg_tol"])
        add |= _sandwiched(grey_off, (c | add) & ~grey_off, max(1, int(round(SANDWICH_FRAC * h))))
        # ... and pale pieces (within 40 levels of the studio background, so `segment_garment` may call them background) that
        # the garment encloses off our body: run 16a's palazzo front, a pale blue highlight inside the left leg (108 px).
        if bg is not None:
            enclosed = pg.fill_holes(c | add, int(0.01 * h * c.shape[1])) & ~(c | add) & ~near_b & r
            notbg = np.abs(g3m.astype(np.int16) - np.asarray(bg, dtype=np.int16)).max(axis=2) > UNPASTED["bg_tol"]
            add |= enclosed & notbg & np.asarray(proxy, dtype=bool)
            # Opened by 1 px with the chosen mask (stage1b-qa-0.9.0): the 1-2 px anti-aliased line between FASHN's slimmer leg
        # and its background (light grey, neither mannequin nor background) is not cloth; gaps inside the garment still fill.
        add &= pg.dilate(pg.erode(add | c, 1), 1)
        if bg is not None:
            # After that opening (stage1b-qa-0.10.0): every other piece of the engine's output off our body inside the proxy
            # that is not background (nor its anti-aliased edge, 1 px from it), not a grey body the engine drew, and joins the
            # garment: the specks the opening left along the palazzo's legs.
            isbg = ~notbg
            # (`~b`, not the 2 px band: next to our body the bare render is background too, run 16a's palazzo front kept
            # 55 px of specks there)
            grey = pg.mannequin_like(g3m, info["mannequin"]) & ~b
            grey &= ~_sandwiched(grey, (c | add) & ~grey, max(1, int(round(SANDWICH_FRAC * h))))
            off = r & np.asarray(proxy, dtype=bool) & ~b & notbg & ~pg.dilate(isbg, 1) & ~grey
            add |= pg.keep_touching(off | c | add, c | add) & off
        out = (c | add) & r
        # stage1b-qa-0.9.0 (review of 0.8.0): also what the engine drew in the rest of the edit region (outside the proxy
        # and more than `grow_px` from the chosen mask), when it is clearly not mannequin and joins the garment. Run 15's
        # blouse front: the difference mask missed the pale shirt-tail below the proxy (rows 420-446), 828 px drawn and
        # not pasted, a straight cut with our grey mannequin below it.
        rest = seg & r & ~loose & ~out
        if rest.any():
            # (`loose` holds the background too: FASHN's floor over our feet below the palazzo hem, run 15 back.)
            # Each joined piece is kept only when its median chroma is above `REST_MIN_CHROMA` x the mannequin's ceiling:
            # FASHN's floor highlight and shadow under the palazzo hem are grey or white (run 15: pieces of 61-341 px at
            # median chroma 3-4), the blouse's shirt-tail is a pale cream print (879 px at 11; the mannequin ceiling 6.0).
            # A white or grey garment is then extended only inside the proxy and near its chosen mask, as in 0.8.0.
            joined = _chromatic_pieces(pg.keep_touching(rest | out, out) & rest, gen, REST_MIN_CHROMA * float(info["mannequin"]["chroma_max"]))
            rec["added_outside_px"] = int(joined.sum())
            out = out | joined
        else:
            rec["added_outside_px"] = 0
    rec["added_px"] = int((out & ~c).sum())
    rec["px"] = int(out.sum())
    return out, rec


def _sandwiched(cand: np.ndarray, cloth: np.ndarray, d: int) -> np.ndarray:
    """`cand` pixels with `cloth` within `d` rows above AND within `d` rows below in the same column (inside a garment's
    vertical extent, not under its hem)."""
    c = np.asarray(cloth, dtype=bool)
    h = c.shape[0]
    cs = np.vstack([np.zeros((1, c.shape[1]), np.int32), np.cumsum(c, axis=0, dtype=np.int32)])  # cs[k] = rows < k
    y = np.arange(h)
    above = cs[y] - cs[np.maximum(0, y - d)]
    below = cs[np.minimum(h, y + 1 + d)] - cs[y + 1]
    return np.asarray(cand, dtype=bool) & (above > 0) & (below > 0)


# Off our body, a mannequin-grey piece of the engine's output is cloth when the garment lies above AND below it in its column
# within this share of the height (a grey print patch inside a trouser leg); else it is a body the engine drew (run 14's
# azure: FASHN's legs beside ours, under the hem).
SANDWICH_FRAC = 0.05


def _chromatic_pieces(pieces: np.ndarray, rgb: np.ndarray, floor: float) -> np.ndarray:
    """The connected pieces of `pieces` whose median chroma is above `floor` (not grey or white)."""
    _, chroma = pg._lum_chroma(np.asarray(rgb)[..., :3])
    lab, n = pg.label(pieces)
    keep = np.zeros(n + 1, dtype=bool)
    for i in range(1, n + 1):
        keep[i] = float(np.median(chroma[lab == i])) > floor
    return keep[lab]


def unpasted_cloth(gen: np.ndarray, garment: np.ndarray, bare_rgb: np.ndarray, bare: np.ndarray, region: np.ndarray, bg: Sequence[int],
                   mannequin: Mapping[str, Any] | None = None, proxy: np.ndarray | None = None) -> dict[str, Any]:
    """What the engine drew in the edit region as cloth that the composite does NOT paste (stage1b-qa-0.9.0, review of
    0.8.0): pixels of the region outside the garment mask that differ from our bare render by more than `diff`, are not
    studio background (within `bg_tol` of it) and, where `mannequin` (the still's own colour model, from
    `still_garment_mask`) is given, not mannequin grey at twice its chroma ceiling. The composite shows our bare render
    there: a notch cut into the garment (run 15's blouse front hem on the 0.7.0 path: 828 px). `see_through` cannot see
    it: it measures inside the garment's own outline. Only pixels on our body (`bare`) count; the engine's own
    background beside a slimmer body is not cloth, nor a grey or white piece (`REST_MIN_CHROMA`, as in
    `still_garment_mask`)."""
    g = np.asarray(gen)[..., :3].astype(np.int16)
    m = np.asarray(garment, dtype=bool)
    r = np.asarray(region, dtype=bool)
    diff = np.abs(g - np.asarray(bare_rgb)[..., :3].astype(np.int16)).max(axis=2) > UNPASTED["diff"]
    background = np.abs(g - np.asarray(bg, dtype=np.int16)).max(axis=2) <= UNPASTED["bg_tol"]
    b = np.asarray(bare, dtype=bool)
    cand = r & ~m & b & diff & ~background
    if mannequin is not None:
        cand &= ~pg.mannequin_like(np.asarray(gen)[..., :3], mannequin, 2.0, pg.SEGMENT_DEFAULTS["mannequin_lum_margin"])
    # Only what touches the pasted garment (a notch in it), and not single specks along its anti-aliased edge.
    cand = pg.dilate(pg.erode(cand, 1), 1) & cand
    joined = pg.keep_touching(cand | pg.dilate(m, 1), m) & cand
    if mannequin is not None:
        # The same rule as `still_garment_mask`: grey or white pieces (FASHN's floor under a hem) are not cloth.
        joined = _chromatic_pieces(joined, gen, REST_MIN_CHROMA * float(mannequin["chroma_max"]))
    # stage1b-qa-0.10.0 (run 16a): OFF our body, inside the proxy (where the garment belongs), the composite shows studio
    # background; whatever the engine drew there that is not background and not mannequin grey by the STRICT test (the model's
    # chroma ceiling, not twice it) is a hole in the still. Run 16a's palazzo front: 992 px of grey-blue print, unseen by 0.9.0.
    off_px = 0
    if proxy is not None:
        # pale cloth differs from the background by less than `diff`: off our body, a not-background pixel the garment
        # encloses counts as well
        # (not its anti-aliased edge: 1 px from the background; no opening, a speck in a leg is a hole too)
        off = r & ~m & ~b & np.asarray(proxy, dtype=bool) & ~background & ~pg.dilate(background, 1)
        if mannequin is not None:
            # strict mannequin grey is not cloth (an engine-drawn leg beside ours) unless the garment lies above and below it
            grey = off & pg.mannequin_like(np.asarray(gen)[..., :3], mannequin)
            off = (off & ~grey) | _sandwiched(grey, m, max(1, int(round(SANDWICH_FRAC * m.shape[0]))))
        off = pg.keep_touching(off | pg.dilate(m, 1), m) & off
        off_px = int(off.sum())
        joined = joined | off
    rows = _rows(joined)
    n, gn = int(joined.sum()), int(m.sum())
    return {"px": n, "frac": None if gn == 0 else round(n / gn, 4), "rows": None if len(rows) == 0 else [int(rows[0]), int(rows[-1])],
            "off_body_px": off_px, "params": dict(UNPASTED), "mannequin_excluded": mannequin is not None,
            "mannequin_excluded_note": "on our body only; off the body (inside the proxy) every non-background pixel counts" if proxy is not None else "on our body only"}


def _torso_run(proxy: np.ndarray) -> tuple[int, int, int, int, int] | None:
    """(top, bottom row, x0, x1, centre column) of the proxy's body: its run through the centre column at 60 % of its
    height. None when the centre column is open there (trousers between the legs) or the proxy is empty."""
    p = np.asarray(proxy, dtype=bool)
    if not p.any():
        return None
    ys, xs = np.nonzero(p)
    top, bot = int(ys.min()), int(ys.max())
    cx = int(round(float(xs.mean())))
    y = int(top + 0.6 * (bot - top))
    if not p[y, cx]:
        return None
    x0 = cx
    while x0 > 0 and p[y, x0 - 1]:
        x0 -= 1
    x1 = cx
    while x1 < p.shape[1] - 1 and p[y, x1 + 1]:
        x1 += 1
    return top, bot, x0, x1, cx


def garment_body(garment: np.ndarray, proxy: np.ndarray, bare: np.ndarray, *, kind: str, erode_px: int,
                 exclude: np.ndarray | None = None) -> dict[str, Any]:
    """Shape of the pasted garment against the proxy (stage1b-qa-0.7.0).

    see_through   our mannequin INSIDE the garment's own outline (enclosed holes of the garment mask on the proxy eroded
                  by `erode_px`, on our bare silhouette), as a share of the outline there; `exclude` (an outerwear front
                  opening) does not count. A torn still (run 15 blouse, cardigan back) shows the mannequin through it.
    body_length   (median lowest garment row - proxy top) / (median lowest proxy row - proxy top) over the central half
                  of the proxy's body (`_torso_run`); None for trousers and when the run is not found. A cropped bolero
                  drawn for a hip-length cardigan (run 15) reaches 0.469 of the proxy.
    sleeve_cover  share of the proxy's sleeve pixels (outside the torso run by `SLEEVE_PAD_FRAC`) the garment covers, and
                  sleeve_share, those pixels as a share of the proxy (a proxy without sleeves has only shoulder corners)."""
    g = np.asarray(garment, dtype=bool)
    p = np.asarray(proxy, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    h = g.shape[0]
    e = pg.erode(p, int(erode_px)) & b
    if exclude is not None:
        e &= ~pg.dilate(np.asarray(exclude, dtype=bool), int(erode_px))
    filled = pg.fill_holes(g, g.size)
    outline = int((filled & e).sum())
    holes = int((filled & ~g & e).sum())
    out: dict[str, Any] = {"see_through": None if outline == 0 else round(holes / outline, 4), "see_through_px": holes,
                           "body_length": None, "sleeve_cover": None, "sleeve_share": None, "top_offset": None}
    if kind in ("skirt", "trousers") and p.any():
        # stage1b-qa-0.10.0: where the waistband sits on the body axis, (garment top - proxy top) / proxy length, median over
        # the central columns; `view_agreement` compares front and back (run 16a's skirt: front 0.113, back 0.040).
        cxa = _proxy_axis(p)
        hw = max(1, int(round(0.02 * h)))
        pr = _rows(p)
        gt = [int(np.nonzero(g[:, c])[0][0]) for c in range(max(0, cxa - hw), min(p.shape[1], cxa + hw + 1)) if g[:, c].any()]
        pt = [int(np.nonzero(p[:, c])[0][0]) for c in range(max(0, cxa - hw), min(p.shape[1], cxa + hw + 1)) if p[:, c].any()]
        if gt and pt:
            out["top_offset"] = round((float(np.median(gt)) - float(np.median(pt))) / max(1.0, float(pr[-1] - pr[0])), 4)
    run = _torso_run(p)
    if run is None:
        return out
    top, _, x0, x1, cx = run
    if kind != "trousers":
        hw = max(1, (x1 - x0) // 4)
        cols = range(max(0, cx - hw), min(p.shape[1], cx + hw + 1))
        pb = [int(np.nonzero(p[:, c])[0].max()) for c in cols if p[:, c].any()]
        gb = [int(np.nonzero(g[:, c])[0].max()) if g[:, c].any() else top for c in cols]
        if pb:
            pbm = float(np.median(pb))
            out["body_length"] = round((float(np.median(gb)) - top) / max(1.0, pbm - top), 4)
    pad = max(1, int(round(SLEEVE_PAD_FRAC * h)))
    X = np.arange(p.shape[1])[None, :]
    sleeve = p & ((X < x0 - pad) | (X > x1 + pad))
    n = int(sleeve.sum())
    out["sleeve_share"] = round(n / max(1, int(p.sum())), 4)
    out["sleeve_cover"] = None if n == 0 else round(float((g & sleeve).sum()) / n, 4)
    return out


# Hip conform (stage1b-qa-0.8.0). FASHN's agnostic image hides our mannequin inside a grey box from the waist down
# (candidates/<view>_fashn_agnostic.png), so it redraws the body under a skirt from the pose alone, slimmer than ours,
# and fits the skirt to that body: run 15's skirt at row 428 (front) spans x 176-306 where our hips span 170-309 and the
# proxy 165-314. The composite pastes it onto our wider bare render and our hips show beside it. `conform_to_proxy`
# widens each garment row of a skirt or dress to the proxy's run (never narrows), at most by `max_stretch`.
CONFORM = {"max_stretch": 1.25, "ramp_frac": 0.03, "ramp_out_frac": 0.06, "smooth_rows": 9, "min_fill": 0.8, "pad_frac": 0.015}
# stage1b-qa-0.9.0 (review of 0.8.0): trousers too, above the crotch only (their legs below it are left as drawn). Run 15's
# palazzo is narrower than the proxy at the hips on the app path (85 / 85 and 75 / 75 rows, median 5 / 14 and 5 / 12 px);
# a correct two-leg draw with the same fit would otherwise be stopped by the never-overridden hip check.
# stage1b-qa-0.10.0 (run 16a): NOT trousers any more. The trousers proxy's hip block is wider than its legs and ends in a step
# (row ~450 at the back camera); widening FASHN's palazzo hips to it over legs left as drawn made a yoke shelf, 8 / 12 px, at
# row 448. A trouser's hips are now stretched over OUR body only (`conform_edges`), which tapers into the thighs.
CONFORM_KINDS = frozenset({"skirt", "dress"})


def _centre_run(row: np.ndarray, cx: int) -> tuple[int, int] | None:
    if cx < 0 or cx >= len(row) or not row[cx]:
        return None
    x0 = cx
    while x0 > 0 and row[x0 - 1]:
        x0 -= 1
    x1 = cx
    while x1 < len(row) - 1 and row[x1 + 1]:
        x1 += 1
    return x0, x1


def _proxy_axis(proxy: np.ndarray) -> int:
    xs = np.nonzero(np.asarray(proxy, dtype=bool))[1]
    return int(round(float(xs.mean()))) if len(xs) else 0


def _garment_top(garment: np.ndarray, cx: int, half: int) -> int | None:
    col = np.asarray(garment, dtype=bool)[:, max(0, cx - half):cx + half + 1].any(axis=1)
    ys = np.nonzero(col)[0]
    return int(ys[0]) if len(ys) else None


def hip_zone(garment: np.ndarray, proxy: np.ndarray, legs: tuple[int, int, int, int] | None, kind: str) -> tuple[int, int] | None:
    """Rows (y0, y1 exclusive) of the hips: from the garment's own top (skirt, trousers; a lower waistband is not a
    gap) or the lower 30 % of the proxy's torso above the crotch (dress), to the crotch (`legs[0]`). None for tops,
    outerwear, a view without separate legs, or an empty proxy."""
    p = np.asarray(proxy, dtype=bool)
    if kind not in ("skirt", "dress", "trousers") or legs is None or not p.any():
        return None
    h = p.shape[0]
    rows = np.nonzero(p.any(axis=1))[0]
    top, crotch = int(rows[0]), int(legs[0])
    cx = _proxy_axis(p)
    y0 = top if kind != "dress" else crotch - int(round(0.3 * (crotch - top)))
    gt = _garment_top(garment, cx, max(1, int(round(0.012 * h))))
    if gt is None:
        return None
    y0 = max(y0, gt + max(1, int(round(0.01 * h))))
    return (y0, crotch) if crotch > y0 else None


def hip_profile(garment: np.ndarray, proxy: np.ndarray, bare: np.ndarray, legs: tuple[int, int, int, int] | None, *, kind: str,
                short_px: int) -> dict[str, Any]:
    """Is the garment as wide as the proxy at the hips? Per row of `hip_zone`: the proxy's run through its axis, and how
    far inside it the garment's outermost pixel (within that run) stops on each side. A row is short when either side
    stops `short_px` or more inside; `body_exposed_px` / `exposed_rows` count our bare mannequin between the garment
    and the proxy's edge (what the composite shows beside the garment)."""
    g = np.asarray(garment, dtype=bool)
    p = np.asarray(proxy, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    zone = hip_zone(g, p, legs, kind)
    out: dict[str, Any] = {"zone": None if zone is None else list(zone), "rows": 0, "short_rows": 0, "short_frac": None,
                           "median_short_px": None, "max_short_px": None, "body_exposed_px": 0, "exposed_rows": 0, "exposed_frac": None,
                           "short_px": int(short_px)}
    if zone is None:
        return out
    cx = _proxy_axis(p)
    left, right, exposed, exposed_rows = [], [], 0, 0
    for y in range(*zone):
        run = _centre_run(p[y], cx)
        if run is None:
            continue
        x0, x1 = run
        gx = np.nonzero(g[y, x0:x1 + 1])[0]
        if len(gx) == 0:
            continue
        sl, sr = int(gx[0]), int(x1 - x0 - gx[-1])
        left.append(sl)
        right.append(sr)
        e = int(b[y, x0:x0 + sl].sum()) + int(b[y, x1 + 1 - sr:x1 + 1].sum())
        exposed += e
        exposed_rows += int(e > 0)
    if not left:
        return out
    L, R = np.array(left), np.array(right)
    short = (L >= short_px) | (R >= short_px)
    out.update({"rows": len(L), "short_rows": int(short.sum()), "short_frac": round(float(short.mean()), 4),
                "median_short_px": [float(np.median(L)), float(np.median(R))], "max_short_px": [int(L.max()), int(R.max())],
                "body_exposed_px": int(exposed), "exposed_rows": exposed_rows, "exposed_frac": round(exposed_rows / len(L), 4)})
    return out


def _smooth(v: np.ndarray, k: int) -> np.ndarray:
    if k <= 1 or len(v) < k:
        return v
    pad = k // 2
    vp = np.pad(v, pad, mode="edge")
    return np.array([float(np.median(vp[i:i + k])) for i in range(len(v))])


def conform_to_proxy(gen: np.ndarray, garment: np.ndarray, proxy: np.ndarray, bare: np.ndarray, region: np.ndarray, *, kind: str,
                     params: Mapping[str, float] | None = None) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """(still, garment mask, record): each garment row of the hips of a skirt or trousers (from its own top; trousers
    only down to the crotch, their legs are left as drawn) or a dress (from the hip
    zone, with a ramp of `ramp_frac` of the height above it) down to the crotch stretched sideways to the proxy's run
    through its axis where it falls short of it, by linear resampling of the engine's own pixels; below the crotch the
    stretch ramps out over `ramp_out_frac` of the height (50 rows at 832), so the skirt below keeps the flare the engine
    drew (the proxy's flare is a guess). Never narrows, never moves pixels outside the garment's
    row span into it, at most `max_stretch` per row (a row needing more is left as drawn, and the hip check sees it).
    The shortfalls are median-smoothed over `smooth_rows` rows so the edge stays a smooth curve. Rows whose garment
    covers less than `min_fill` of its own span (an open garment) are left as drawn. Other kinds: unchanged."""
    c = {**CONFORM, **(params or {})}
    g = np.asarray(garment, dtype=bool)
    p = np.asarray(proxy, dtype=bool)
    r = np.asarray(region, dtype=bool)
    img = np.asarray(gen)
    rec: dict[str, Any] = {"applied": False, "kind": kind, "params": c, "rows": 0, "capped_rows": 0, "added_px": 0, "max_stretch": 1.0}
    if kind not in CONFORM_KINDS or not g.any() or not p.any():
        rec["note"] = "not a skirt, dress or trousers (or empty): unchanged"
        return img, g, rec
    h, w = g.shape
    legs = pg.leg_rows(np.asarray(bare, dtype=bool))
    cx = _proxy_axis(p)
    gt = _garment_top(g, cx, max(1, int(round(0.012 * h))))
    if gt is None:
        rec["note"] = "no garment on the proxy's axis: unchanged"
        return img, g, rec
    zone = hip_zone(g, p, legs, kind)
    if zone is None:
        rec["note"] = "no hip zone (no separate legs in this view): unchanged"
        return img, g, rec
    ramp = max(1, int(round(c["ramp_frac"] * h)))
    if kind in ("skirt", "trousers"):
        # From the garment's own top, ramping in over `ramp` rows (stage1b-qa-0.9.0): stretched in full from its first
        # row, a slanted waistband (run 15's skirt front) was squared off to the proxy's width, a shelf at the waist.
        start = gt
    else:
        start = max(gt, zone[0] - ramp)
    crotch = zone[1]
    ramp_out = max(1, int(round(c["ramp_out_frac"] * h)))
    pad = max(1, int(round(c["pad_frac"] * h)))
    end = crotch if kind == "trousers" else min(h, crotch + ramp_out)
    ys, spans = [], []
    for y in range(start, end):
        run = _centre_run(p[y], cx)
        if run is None:
            continue
        x0, x1 = run
        lo, hi = max(0, x0 - pad), min(w - 1, x1 + pad)
        gx = np.nonzero(g[y, lo:hi + 1])[0]
        if len(gx) < 2:
            continue
        gl, gr = lo + int(gx[0]), lo + int(gx[-1])
        if g[y, gl:gr + 1].mean() < c["min_fill"]:
            continue
        ys.append(y)
        spans.append((gl, gr, x0, x1))
    if not ys:
        rec["note"] = "no garment rows on the proxy: unchanged"
        return img, g, rec
    S = np.array(spans, dtype=np.float64)
    short_l = _smooth(np.maximum(0.0, S[:, 0] - S[:, 2]), int(c["smooth_rows"]))
    short_r = _smooth(np.maximum(0.0, S[:, 3] - S[:, 1]), int(c["smooth_rows"]))
    out = img.astype(np.float64).copy()
    mask = g.copy()
    rows = capped = added = 0
    worst = 1.0
    for i, y in enumerate(ys):
        wgt = 1.0 if ramp == 0 else float(np.clip((y - start) / ramp, 0.0, 1.0))
        if y >= crotch:
            wgt *= float(np.clip(1.0 - (y - crotch) / ramp_out, 0.0, 1.0))
        gl, gr = int(S[i, 0]), int(S[i, 1])
        nl = int(round(gl - wgt * short_l[i]))
        nr = int(round(gr + wgt * short_r[i]))
        if nl >= gl and nr <= gr:
            continue
        stretch = (nr - nl) / max(1.0, float(gr - gl))
        if stretch > c["max_stretch"]:
            capped += 1
            continue
        xs = np.arange(nl, nr + 1)
        sx = gl + (xs - nl) * (gr - gl) / max(1, nr - nl)
        x_lo = np.floor(sx).astype(int)
        x_hi = np.minimum(x_lo + 1, w - 1)
        f = (sx - x_lo)[:, None]
        src = img[y].astype(np.float64)
        out[y, nl:nr + 1] = src[x_lo] * (1 - f) + src[x_hi] * f
        new_row = g[y, np.clip(np.rint(sx).astype(int), 0, w - 1)]
        before = int(mask[y].sum())
        mask[y, nl:nr + 1] = new_row
        mask[y] &= r[y]
        added += int(mask[y].sum()) - before
        rows += 1
        worst = max(worst, stretch)
    # `headroom`: how far the largest stretch applied sits below the cap (review of 0.8.0: run 15's skirt back needed 1.235 on
    # the pasted mask, 1.146 with 4 rows capped on the 0.9.0 composite; a slimmer draw caps more rows, and the hip check
    # then sees them as drawn).
    rec.update({"applied": rows > 0, "rows": rows, "capped_rows": capped, "added_px": added, "max_stretch": round(worst, 4),
                "headroom": round(float(c["max_stretch"]) - worst, 4),
                "start_row": int(start), "median_short_px": [float(np.median(short_l)), float(np.median(short_r))]})
    return np.clip(np.rint(out), 0, 255).astype(np.uint8), mask, rec


# stage1b-qa-0.10.0 (run 16a): the garment's outer edge against OUR body. The engines draw a person's shoulder slope and arm,
# narrower than our mannequin's square shoulder caps and arms, and paint studio background beside them; the composite pastes
# the garment onto our bare render, so our grey shows beside the cloth: azure (FASHN) front and back, wedges 6-13 px wide
# over rows ~228-276 above both puffed sleeves (about 340 / 225 px; the same in runs 14 and 15, never flagged); the
# cardigan front (Qwen), a 5-7 px grey band along both shoulders and upper sleeves, rows 238-365 (1,337 px); the blouse's
# shoulder caps. `conform_edges` stretches each such garment row sideways over our body (the hip conform's method, per side,
# by linear resampling of the engine's own pixels); `edge_profile` measures what is left, and QA fails it (`body_beside`).
EDGE_CONFORM = {"max_px_frac": 0.024, "max_stretch": 1.5, "pad_px": 1, "band_factor": 3.0, "min_band_frac": 0.012, "smooth_rows": 5, "inset_px": 1,
                "top_depth_frac": 0.0, "min_bg_share": 0.8}
# `edge_profile` (the QA) also looks upwards over the shoulders' flat tops, this share of the height below the garment's top.
# The conform does not (`top_depth_frac` 0): stretched upwards, run 16a's azure back shoulder grew a vertical streak.
EDGE_PROFILE_TOP_DEPTH_FRAC = 0.06


def _edge_rows(garment: np.ndarray, bare: np.ndarray, still: np.ndarray, bg: Sequence[int], y0: int, y1: int,
               bg_tol: int = 12, sides: tuple[int, ...] = (-1, 1), min_bg_share: float = 1.0) -> list[tuple[int, int, int, int, int]]:
    """Per row in [y0, y1) and side (-1 left, +1 right): (y, side, garment edge, body edge, garment run length) where our
    body runs on, unbroken, from the garment's outermost pixel outwards and the still shows studio background over that run
    (the engine drew no body there). An arm hanging apart from the garment (background between them) is another run and
    not counted; an arm the engine drew (mannequin grey, not background) is not such a row. On transposed arrays, side -1 is the top of each column.
    `min_bg_share`: the share of that body run the still must show as background (1.0 for the conform; the QA's
    `edge_profile` counts a run that is mostly background, so an anti-aliased fleck does not hide a grey cap)."""
    g = np.asarray(garment, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    isbg = np.abs(np.asarray(still)[..., :3].astype(np.int16) - np.asarray(bg, dtype=np.int16)).max(axis=2) <= bg_tol
    out = []
    for y in range(max(0, y0), min(g.shape[0], y1)):
        gx = np.nonzero(g[y])[0]
        bx = np.nonzero(b[y])[0]
        if len(gx) == 0 or len(bx) == 0:
            continue
        gl, gr = int(gx[0]), int(gx[-1])
        # our body's run that touches the garment's outer pixel (an arm hanging apart from the hips is another run)
        bl = gl
        while bl > 0 and b[y, bl - 1] and not g[y, bl - 1]:
            bl -= 1
        br = gr
        while br < g.shape[1] - 1 and b[y, br + 1] and not g[y, br + 1]:
            br += 1
        if -1 in sides and bl < gl and isbg[y, bl:gl].mean() >= min_bg_share:
            n = gl
            while n + 1 < g.shape[1] and g[y, n + 1]:
                n += 1
            out.append((y, -1, gl, bl, n - gl + 1))
        if 1 in sides and br > gr and isbg[y, gr + 1:br + 1].mean() >= min_bg_share:
            n = gr
            while n - 1 >= 0 and g[y, n - 1]:
                n -= 1
            out.append((y, 1, gr, br, gr - n + 1))
    return out


def _edge_span(garment: np.ndarray, bare: np.ndarray, kind: str) -> tuple[int, int] | None:
    """Rows checked for our body beside the garment: from the garment's top to the crotch (a dress, skirt or trousers: below
    it our legs show under a hem by design, and the hips have their own check) or to the garment's bottom (tops)."""
    rows = _rows(np.asarray(garment, dtype=bool))
    if len(rows) == 0:
        return None
    legs = pg.leg_rows(np.asarray(bare, dtype=bool)) if kind in ("dress", "skirt", "trousers") else None
    y1 = int(legs[0]) if legs is not None else int(rows[-1]) + 1
    return (int(rows[0]), y1) if y1 > rows[0] else None


def _top_columns(garment: np.ndarray, span: tuple[int, int], depth_frac: float) -> tuple[int, int, np.ndarray]:
    """The columns whose garment top lies in the upper `depth_frac` of the height below the garment's top (the shoulders):
    the vertical pass looks at their tops only (never a hem: our legs run on below it by design)."""
    g = np.asarray(garment, dtype=bool)
    h, w = g.shape
    top = np.where(g.any(axis=0), np.argmax(g, axis=0), h)
    ok = top < span[0] + int(round(depth_frac * h))
    return 0, w, ok


def _conform_pass(img: np.ndarray, out: np.ndarray, g: np.ndarray, mask: np.ndarray, bare: np.ndarray, region: np.ndarray, bg: Sequence[int],
                  y0: int, y1: int, sides: tuple[int, ...], c: Mapping[str, float], h: int, keep: np.ndarray | None = None) -> dict[str, int | float]:
    """One pass of `conform_edges` over the rows of 2-D arrays (the vertical pass hands in transposed views)."""
    w = g.shape[1]
    max_px = max(1, int(round(c["max_px_frac"] * h)))
    min_band = max(2, int(round(c["min_band_frac"] * h)))
    inset = int(c["inset_px"])
    found = [e for e in _edge_rows(g, bare, img, bg, y0, y1, sides=sides, min_bg_share=c["min_bg_share"]) if keep is None or keep[e[0]]]
    core = pg.erode(g, inset) if inset > 0 else g
    short = {(y, side): abs(ge - be) for y, side, ge, be, _ in found}
    k = int(c["smooth_rows"]) // 2
    rows: set[int] = set()
    capped = added = worst_px = 0
    worst = 1.0
    for y, side, ge, be, run in found:
        near = [short[(yy, side)] for yy in range(y - k, y + k + 1) if (yy, side) in short]
        need = abs(ge - be)
        s = max(need, int(round(float(np.median(near)))))
        if s > max_px:
            capped += 1
            continue
        s += int(c["pad_px"])
        # The source band starts at the garment's core (eroded by `inset_px`), not its edge: the edge is anti-aliased against
        # the engine's background, and near a flat top edge (a shoulder's top) the whole row is edge. Stretched, it drew a light
        # line along run 16a's azure back shoulder; such a row now starts deep inside and is capped (the QA sees it).
        cx_ = np.nonzero(core[y])[0]
        if len(cx_) == 0:
            capped += 1
            continue
        ci = int(cx_[0]) if side < 0 else int(cx_[-1])
        lead = abs(ci - ge)
        band = min(run - lead, max(min_band, int(round(c["band_factor"] * s))))
        if band < 2:
            capped += 1
            continue
        stretch = (band + s + lead) / max(1, band)
        if stretch > c["max_stretch"]:
            capped += 1
            continue
        if side < 0:
            src0, src1, dst0, dst1 = ci, ci + band - 1, max(0, ge - s), ci + band - 1
        else:
            src0, src1, dst0, dst1 = ci - band + 1, ci, ci - band + 1, min(w - 1, ge + s)
        xs = np.arange(dst0, dst1 + 1)
        sx = src0 + (xs - dst0) * (src1 - src0) / max(1, dst1 - dst0)
        x_lo = np.floor(sx).astype(int)
        x_hi = np.minimum(x_lo + 1, w - 1)
        f = (sx - x_lo)[:, None]
        src = img[y].astype(np.float64)
        before = int(mask[y].sum())
        out[y, dst0:dst1 + 1] = src[x_lo] * (1 - f) + src[x_hi] * f
        mask[y, dst0:dst1 + 1] = True
        mask[y] &= region[y] | g[y]
        added += int(mask[y].sum()) - before
        rows.add(y)
        worst = max(worst, stretch)
        worst_px = max(worst_px, s)
    return {"rows": len(rows), "capped": capped, "added": added, "max_stretch": round(worst, 4), "max_px": worst_px}


def conform_edges(gen: np.ndarray, garment: np.ndarray, bare: np.ndarray, region: np.ndarray, bg: Sequence[int], *, kind: str,
                  params: Mapping[str, float] | None = None) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """(still, garment mask, record): where our body runs on past the garment's outermost pixel and the engine drew background
    there (`_edge_rows`), the garment's outer band (`band_factor` x the shortfall, at least `min_band_frac` of the height, at
    most the run, starting `inset_px` inside the anti-aliased edge) is stretched over our body (+ `pad_px`) by linear resampling
    of the engine's own pixels; the rest of the row is untouched (stretching the whole run shifted the print row by row:
    streaks). Two passes: sideways per row (shoulder slopes, sleeves, a waist), then upwards per column over the shoulders'
    flat tops (`top_depth_frac`). Shortfalls are median-smoothed over `smooth_rows` neighbours. A row needing more than
    `max_px_frac` of the height or a band stretch above `max_stretch` is left as drawn (`edge_profile` and the QA see it).
    Never narrows; stays in the edit region."""
    c = {**EDGE_CONFORM, **(params or {})}
    g = np.asarray(garment, dtype=bool)
    r = np.asarray(region, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    img = np.asarray(gen)
    h, w = g.shape
    rec: dict[str, Any] = {"applied": False, "kind": kind, "params": c, "rows": 0, "capped_rows": 0, "added_px": 0, "max_stretch": 1.0, "max_px": 0}
    span = _edge_span(g, b, kind)
    if span is None:
        rec["note"] = "empty garment: unchanged"
        return img, g, rec
    out = img.astype(np.float64).copy()
    mask = g.copy()
    side = _conform_pass(img, out, g, mask, b, r, bg, span[0], span[1], (-1, 1), c, h)
    mid = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    out2 = mid.astype(np.float64).transpose(1, 0, 2).copy()
    mask2 = mask.T.copy()
    _, _, keep = _top_columns(mask, span, c["top_depth_frac"])
    top = _conform_pass(mid.transpose(1, 0, 2), out2, mask.T, mask2, b.T, r.T, bg, 0, w, (-1,), c, h, keep=keep)
    final = np.clip(np.rint(out2.transpose(1, 0, 2)), 0, 255).astype(np.uint8)
    mask = mask2.T
    rec.update({"applied": bool(side["rows"] or top["rows"]), "rows": side["rows"], "capped_rows": side["capped"] + top["capped"],
                "added_px": int((mask & ~g).sum()), "max_stretch": max(side["max_stretch"], top["max_stretch"]),
                "max_px": max(side["max_px"], top["max_px"]), "span": list(span), "sideways": side, "upwards": top})
    return final, mask, rec


def edge_profile(garment: np.ndarray, bare: np.ndarray, still: np.ndarray, bg: Sequence[int], *, kind: str,
                 top_depth_frac: float | None = None) -> dict[str, Any]:
    """Our body beside the garment (stage1b-qa-0.10.0): per row of `_edge_span` and side, and per shoulder column above the
    garment's top, the body pixels past the garment's outermost pixel where the still shows studio background. In the pinned
    still those pixels are our grey mannequin sticking out of the cloth (shoulder caps, a band along a sleeve)."""
    g = np.asarray(garment, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    span = _edge_span(g, b, kind)
    out: dict[str, Any] = {"span": None if span is None else list(span), "rows": 0, "px": 0, "max_px": 0, "row_range": None}
    if span is None:
        return out
    px = np.zeros_like(g)
    for y, side, ge, be, _ in _edge_rows(g, b, still, bg, *span, min_bg_share=0.5):
        lo, hi = (be, ge) if side < 0 else (ge + 1, be + 1)
        px[y, lo:hi] = True
    _, _, keep = _top_columns(g, span, EDGE_PROFILE_TOP_DEPTH_FRAC if top_depth_frac is None else top_depth_frac)
    for x, _, ge, be, _ in _edge_rows(g.T, b.T, np.asarray(still).transpose(1, 0, 2), bg, 0, g.shape[1], sides=(-1,), min_bg_share=0.5):
        if keep[x]:
            px[be:ge, x] = True
    if not px.any():
        return out
    ys = _rows(px)
    widths = px.sum(axis=1)
    out.update({"rows": int((widths > 0).sum()), "px": int(px.sum()), "max_px": int(widths.max()), "row_range": [int(ys[0]), int(ys[-1])]})
    return out


def width_steps(garment: np.ndarray, bare: np.ndarray, *, kind: str, step_px: int, persist: int = 3, proxy: np.ndarray | None = None) -> dict[str, Any]:
    """A shelf (stage1b-qa-0.10.0, run 16a's palazzo back): from the garment's top + 3 % of the height to the crotch + 6 %, the
    outermost garment column on a side moving INWARD by more than `step_px` from one row to the next and staying in for
    `persist` rows. Run 16a: the 0.9.0 trouser conform widened FASHN's hips to the proxy's hip block, which itself ends in a
    step at row ~450, over legs left as drawn: 8 px left and 12 px right at row 448, a yoke ledge above the legs. Skirts,
    dresses and trousers only (a top's outline jumps at the armpits by design)."""
    g = np.asarray(garment, dtype=bool)
    out: dict[str, Any] = {"rows": None, "steps": [], "step_px": int(step_px), "max_step_px": 0}
    if kind not in ("dress", "skirt", "trousers") or not g.any():
        return out
    legs = pg.leg_rows(np.asarray(bare, dtype=bool))
    if legs is None:
        return out
    h = g.shape[0]
    rows = _rows(g)
    y0 = int(rows[0]) + int(round(0.03 * h))
    if kind == "dress":
        # a dress: from its hip zone (the lower 30 % of the torso), less the conform's ramp: above it the sleeves are the outline
        zone = hip_zone(g, np.asarray(proxy, dtype=bool), legs, kind) if proxy is not None else None
        if zone is None:
            return out
        y0 = max(y0, zone[0] - int(round(CONFORM["ramp_frac"] * h)))
    y1 = min(int(rows[-1]) - persist, int(legs[0]) + int(round(0.06 * h)))
    out["rows"] = [y0, y1]
    L = np.full(h, -1)
    R = np.full(h, -1)
    pm = None if proxy is None else np.asarray(proxy, dtype=bool)
    pad = max(1, int(round(CONFORM["pad_frac"] * h)))
    for y in range(y0, y1 + persist + 1):
        row = g[y]
        if pm is not None and pm[y].any():
            # only the garment over the proxy's own span of the row (+ the conform's pad): a sleeve or hand hanging beside the
            # hips is not the garment's outline (run 16a's azure back: its sleeve ends at row 369, a 42 px "step")
            px = np.nonzero(pm[y])[0]
            row = row.copy()
            row[:max(0, int(px[0]) - pad)] = False
            row[int(px[-1]) + pad + 1:] = False
        xs = np.nonzero(row)[0]
        if len(xs):
            L[y], R[y] = xs[0], xs[-1]
    worst = 0
    for y in range(y0, y1):
        if L[y] < 0 or L[y + 1] < 0:
            continue
        nxt = slice(y + 1, y + 1 + persist)
        if (L[nxt] < 0).any():
            continue
        dl = int(L[nxt].min() - L[y])  # inward on the left = to the right
        dr = int(R[y] - R[nxt].max())
        for side, d in (("left", dl), ("right", dr)):
            worst = max(worst, d)
            if d > step_px:
                out["steps"].append({"row": int(y + 1), "side": side, "px": d})
    out["max_step_px"] = int(worst)
    return out


def crotch_height(garment: np.ndarray, proxy: np.ndarray, bare: np.ndarray) -> dict[str, Any]:
    """Trousers (stage1b-qa-0.10.0, run 16a's palazzo, FASHN both views): the first row below the garment's top where the
    body axis is open between its two legs for good, against the proxy's own crotch (the same rule on the proxy), and our
    mannequin showing between the legs above the proxy's crotch (bare, not garment). FASHN drew the split 22-26 rows above
    the proxy's crotch with our grey thighs in it; Qwen's crotch sat on the proxy's line."""
    g = np.asarray(garment, dtype=bool)
    p = np.asarray(proxy, dtype=bool)
    b = np.asarray(bare, dtype=bool)
    out: dict[str, Any] = {"garment_crotch_row": None, "proxy_crotch_row": None, "rise_px": None, "mannequin_above_proxy_crotch_px": 0}
    if not g.any() or not p.any():
        return out
    cx = _proxy_axis(p)

    def first_open(m: np.ndarray, run: int = 5) -> int | None:
        rows = np.nonzero(m.any(axis=1))[0]
        col = m[:, max(0, cx - 1):cx + 2].any(axis=1)
        for y in range(int(rows[0]), int(rows[-1]) - run + 1):
            if not col[y:y + run].any() and m[y, :max(0, cx - 1)].any() and m[y, cx + 2:].any():
                return y
        return None

    gc, pc = first_open(g), first_open(p)
    out["garment_crotch_row"], out["proxy_crotch_row"] = gc, pc
    if gc is not None and pc is not None:
        out["rise_px"] = int(pc - gc)
        if gc < pc:
            zone = np.zeros_like(g)
            zone[gc:pc] = True
            out["mannequin_above_proxy_crotch_px"] = int((zone & b & ~g).sum())
    return out


def unconform_mask(conformed: np.ndarray, raw: np.ndarray, mask: np.ndarray, search_px: int = 30) -> tuple[np.ndarray, dict[str, Any]]:
    """For a REPLAY of a 0.8.0 / 0.9.0 job, which saved the conformed still and its (conformed) composite mask but not the mask
    before the conform: the mask as it was before `conform_to_proxy`, estimated row by row. A conformed row differs from the
    raw output only over the stretched span [nl, nr]; the source span [gl, gr] is found by matching the conformed row with
    the raw row resampled (search within `search_px` of each end), and the mask row is resampled back. An estimate (the
    record says so); jobs since 0.10.0 save the chosen mask (`candidates/<view>_<engine>_chosen_mask.png`) instead."""
    c = np.asarray(conformed).astype(np.float64)
    r = np.asarray(raw).astype(np.float64)
    m = np.asarray(mask, dtype=bool)
    h, w = m.shape
    out = m.copy()
    rows, err = 0, []
    differ = np.abs(c - r).max(axis=2) > 2
    for y in np.nonzero(differ.any(axis=1))[0]:
        xs = np.nonzero(differ[y])[0]
        nl, nr = int(xs[0]), int(xs[-1])
        if nr - nl < 4:
            continue
        seg = c[y, nl:nr + 1]
        best = None
        for gl in range(nl, min(nr - 2, nl + search_px) + 1):
            grs = np.arange(max(gl + 2, nr - search_px), nr + 1)
            if len(grs) == 0:
                continue
            t = np.arange(nr - nl + 1)[None, :] / max(1, nr - nl)
            sx = gl + t * (grs[:, None] - gl)
            lo = np.floor(sx).astype(int)
            hi = np.minimum(lo + 1, w - 1)
            f = (sx - lo)[..., None]
            pred = r[y][lo] * (1 - f) + r[y][hi] * f
            e = np.abs(pred - seg[None]).mean(axis=(1, 2))
            k = int(np.argmin(e))
            if best is None or e[k] < best[0]:
                best = (float(e[k]), gl, int(grs[k]))
        if best is None:
            continue
        e, gl, gr = best
        row = m[y].copy()
        row[nl:nr + 1] = False
        src = nl + (np.arange(gl, gr + 1) - gl) * (nr - nl) / max(1, gr - gl)
        row[gl:gr + 1] = m[y, np.clip(np.rint(src).astype(int), 0, w - 1)]
        out[y] = row
        rows += 1
        err.append(e)
    return out, {"rows": rows, "median_match_error_8bit": None if not err else round(float(np.median(err)), 2),
                 "basis": "estimate: the conform inverted row by row from the saved conformed still and raw output"}


def compose_candidate(gen: np.ndarray, chosen: np.ndarray, bare: np.ndarray, bare_rgb: np.ndarray, proxy_q: np.ndarray, region: np.ndarray,
                      bg: Sequence[int], *, kind: str, gap: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """One engine output to the still the composite pastes and its mask (stage1b-qa-0.10.0): `still_garment_mask` on the chosen
    mask, `conform_to_proxy` (skirt and dress hips), `conform_edges` (the garment's outer edge over our body), then what QA
    needs from it: `unpasted_cloth` and `edge_profile`. The GPU app and the replay (`rescore_job`) both call this, so a replay
    predicts the app. Returns (still, garment mask, record with composite_mask, conform, conform_edges, unpasted, edges)."""
    garment, comp = still_garment_mask(gen, chosen, bare, proxy_q, region, bg=bg, bare_rgb=bare_rgb)
    img, garment, conf = conform_to_proxy(gen, garment, proxy_q, bare, region, kind=kind)
    img, garment, conf_e = conform_edges(img, garment, bare, region, bg, kind=kind)
    man = None if comp["ambiguous_with_mannequin"] else comp["mannequin"]
    # Trousers (stage1b-qa-0.10.1, review of 0.10.0): the cloth the engine drew in the gap strip between the legs, which the
    # edit region leaves out, is pasted too; then what of our body still shows in the strip is measured (`gap_mannequin`).
    garment, gap_paste = paste_gap_cloth(img, garment, bare, bare_rgb, gap, bg, man)
    # stage1b-qa-0.12.0 (run 16b's cream hem flap): a cut string hanging below the hem outside the proxy is not pasted
    garment, strands = trim_strands(garment, proxy_q)
    unpasted = unpasted_cloth(img, garment, bare_rgb, bare, region, bg, man, proxy=proxy_q)
    edges = edge_profile(garment, bare, img, bg, kind=kind)
    gap_m = gap_mannequin(garment, bare, img, gap, bg)
    if gap_m is not None:
        gap_m["pasted_px"], gap_m["pasted_background_px"] = gap_paste["px"], gap_paste.get("background_px", 0)
    return img, garment, {"composite_mask": comp, "conform": conf, "conform_edges": conf_e, "unpasted": unpasted, "edges": edges, "gap_mannequin": gap_m,
                          "strands": strands}


def paste_gap_cloth(img: np.ndarray, garment: np.ndarray, bare: np.ndarray, bare_rgb: np.ndarray, gap: np.ndarray | None, bg: Sequence[int],
                    mannequin: Mapping[str, Any] | None) -> tuple[np.ndarray, dict[str, Any]]:
    """Trousers (stage1b-qa-0.10.1): the garment mask plus what the engine drew as cloth inside `gap` (`trouser_gap_zone`,
    outside the edit region): not studio background (`UNPASTED["bg_tol"]`), not our bare render as drawn (within
    `MANNEQUIN_MATCH_TOL` of it on our body and, with `mannequin`, mannequin grey), joined to the garment. Run 16a's palazzo
    on 0.10.0: the strip showed our bare render, two grey thigh wedges with a straight cut at the crotch row, where Qwen had
    drawn closed cloth with a narrow tapering gap (front 715, back 657 px). The engine's own background gap stays out."""
    g = np.asarray(garment, dtype=bool)
    if gap is None or not np.asarray(gap, dtype=bool).any():
        return g, {"px": 0}
    z = np.asarray(gap, dtype=bool)
    i3 = np.asarray(img)[..., :3].astype(np.int16)
    notbg = np.abs(i3 - np.asarray(bg, dtype=np.int16)).max(axis=2) > UNPASTED["bg_tol"]
    as_bare = (np.abs(i3 - np.asarray(bare_rgb)[..., :3].astype(np.int16)).max(axis=2) <= MANNEQUIN_MATCH_TOL) & np.asarray(bare, dtype=bool)
    if mannequin is not None:
        as_bare &= pg.mannequin_like(i3.astype(np.uint8), mannequin, 2.0, pg.SEGMENT_DEFAULTS["mannequin_lum_margin"])
    cand = z & notbg & ~as_bare & ~g
    add = pg.keep_touching(cand | g, g) & cand
    # The engine's own gap where it is wider than ours: its background over our inner thigh, within 2 px of the cloth just
    # pasted, is pasted as well (the edge of the gap the engine drew), else a 1-3 px grey seam of our thigh runs down both
    # sides of the gap (run 16a's palazzo, Qwen: front 19, back 85 px).
    edge_bg = z & ~notbg & np.asarray(bare, dtype=bool) & ~g & pg.dilate(add, 2)
    return g | add | edge_bg, {"px": int(add.sum()), "background_px": int(edge_bg.sum())}


def gap_mannequin(garment: np.ndarray, bare: np.ndarray, still: np.ndarray, gap: np.ndarray | None, bg: Sequence[int]) -> dict[str, Any] | None:
    """Trousers (stage1b-qa-0.10.1): our body inside the gap strip between the legs (`trouser_gap_zone`) that the composite
    does not cover, i.e. grey mannequin thighs showing in the crotch of the pinned still. `raw_cloth_px`: of those, where the
    engine's output is not studio background (it drew cloth or our thighs there); `raw_background_px`: where the engine drew
    its own gap wider than ours. Only rows with cloth left and right of the strip count (below a hem our ankles
    show by design). None when there is no strip (not trousers, or the proxy never splits)."""
    if gap is None or not np.asarray(gap, dtype=bool).any():
        return None
    z = np.asarray(gap, dtype=bool)
    g = np.asarray(garment, dtype=bool)
    # only rows where both legs are still cloth (left and right of the strip): below a leg's hem our ankles and feet show as they should
    both = np.zeros(z.shape[0], dtype=bool)
    for y in np.nonzero(z.any(axis=1))[0]:
        xs = np.nonzero(z[y])[0]
        both[y] = bool(g[y, :xs[0]].any() and g[y, xs[-1] + 1:].any())
    expo = z & np.asarray(bare, dtype=bool) & ~g & both[:, None]
    notbg = np.abs(np.asarray(still)[..., :3].astype(np.int16) - np.asarray(bg, dtype=np.int16)).max(axis=2) > UNPASTED["bg_tol"]
    ys = _rows(expo)
    return {"gap_px": int(z.sum()), "body_in_gap_px": int((z & np.asarray(bare, dtype=bool)).sum()), "px": int(expo.sum()),
            "raw_cloth_px": int((expo & notbg).sum()), "raw_background_px": int((expo & ~notbg).sum()),
            "rows": None if len(ys) == 0 else [int(ys[0]), int(ys[-1])]}


# stage1b-qa-0.12.0 (run 16b): thin pieces hanging below the hem. Run 16a's azure back (FASHN): a cut tie string, 4-6 px wide, hangs
# 12 rows below the hem at the mannequin's left; `still_garment_mask` pastes it (the 0.9.0 step that adds joined chromatic
# pieces outside the proxy, made for run 15's blouse shirt-tail: the string is cream, chroma above the mannequin's), and stage 2
# grew it into a cream flap swinging at the hem in 75 of 160 turntable frames. Run 14's azure (FASHN): two dark strings 30 rows
# below the back hem between the legs and one below the front hem, never flagged. A string is not garment body.
#   width_frac      pieces narrower than this share of the height (an opening by a 7 px square at 832) are thin
#   min_hang_frac   ... and reaching this share of the height (8 rows at 832) below the hem of the cloth beside them
#   min_elongation  ... and at least this many times taller than wide (a sliver along the hem is not a string)
#   max_trim_pieces / max_trim_frac  the composite leaves out at most this many pieces, at most this share of the garment; more
#                   (a fringe, tassels: a design) is not trimmed, and the TYPE check stops the still for a person to look at
STRANDS = {"width_frac": 0.008, "min_hang_frac": 0.01, "min_elongation": 1.5, "proxy_pad_px": 1, "min_outside_share": 0.5,
           "max_trim_pieces": 4, "max_trim_frac": 0.01}


def hanging_strands(garment: np.ndarray, proxy: np.ndarray | None = None, params: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Thin pieces of `garment` hanging below the hem (stage1b-qa-0.12.0): what an opening by a (2r+1) square (r from
    `STRANDS["width_frac"]`) removes, per 4-connected piece, whose lowest row lies at least `min_hang_frac` of the height below
    the lowest row of the opened garment in the piece's columns and 2r+1 columns either side (the local hem) and below the
    opened garment's lowest row anywhere (the hem, not a sleeve end), and that is at least that many rows tall and
    `min_elongation` times taller than wide (a speck or a sliver along the hem is not a string). `outside_share`: of the piece's pixels below that hem, the share outside the
    proxy (dilated by `proxy_pad_px`). Returns {params, pieces: [{rows, cols, px, below_px, hang_rows, hem_row, outside_share}],
    px (below the hem, all pieces), below (HxW int: 1 + the piece's index on its pixels below the hem, else 0)}."""
    s = {**STRANDS, **(params or {})}
    g = np.asarray(garment, dtype=bool)
    h, w = g.shape
    r = max(1, int(round(s["width_frac"] * h / 2)))
    min_hang = max(2, int(round(s["min_hang_frac"] * h)))
    body = pg.dilate(pg.erode(g, r), r) & g
    thin = g & ~body
    has = body.any(axis=0)
    bottom = np.where(has, h - 1 - np.argmax(body[::-1], axis=0), -1)
    hem_all = int(bottom.max()) if has.any() else -1
    pd = None if proxy is None else pg.dilate(np.asarray(proxy, dtype=bool), int(s["proxy_pad_px"]))
    below_all = np.zeros(g.shape, dtype=np.int32)
    pieces: list[dict[str, Any]] = []
    lab, n = pg.label(thin)
    if n:
        ys_all, xs_all = np.nonzero(lab)
        ls = lab[ys_all, xs_all]
        order = np.argsort(ls, kind="stable")
        ys_all, xs_all, ls = ys_all[order], xs_all[order], ls[order]
        starts = np.searchsorted(ls, np.arange(1, n + 2))
        win = 2 * r + 1
        for i in range(n):
            ys, xs = ys_all[starts[i]:starts[i + 1]], xs_all[starts[i]:starts[i + 1]]
            if len(ys) == 0:
                continue
            x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
            nb = bottom[max(0, x0 - win):min(w, x1 + win + 1)]
            nb = nb[nb >= 0]
            if nb.size == 0:
                continue  # no cloth above or beside it: not hanging from this garment's hem
            hem = int(nb.max())
            hang = y1 - hem
            if hang < min_hang or y1 <= hem_all or (y1 - y0 + 1) < max(min_hang, s["min_elongation"] * (x1 - x0 + 1)):
                continue
            bel = ys > hem
            out_share = None if pd is None else round(float((~pd[ys[bel], xs[bel]]).sum()) / max(1, int(bel.sum())), 3)
            below_all[ys[bel], xs[bel]] = len(pieces) + 1
            pieces.append({"rows": [y0, y1], "cols": [x0, x1], "px": int(len(ys)), "below_px": int(bel.sum()), "hang_rows": hang,
                           "hem_row": hem, "outside_share": out_share})
    return {"params": {**s, "open_px": 2 * r + 1, "min_hang_rows": min_hang}, "pieces": pieces, "px": int((below_all > 0).sum()), "below": below_all}


def trim_strands(garment: np.ndarray, proxy: np.ndarray, params: Mapping[str, float] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
    """The composite's side of `hanging_strands` (stage1b-qa-0.12.0): the part below the hem of each thin hanging piece that lies
    mostly outside the proxy (`min_outside_share`) is not pasted, when there are at most `max_trim_pieces` such pieces covering at
    most `max_trim_frac` of the garment (a cut string or two; more is a fringe or tassels, a design: left as drawn and stopped by
    the TYPE check for a person to look at). Nothing is painted: our bare render shows there, as below any hem. Inside the proxy
    nothing is trimmed (left to the check). Returns (mask, record: trimmed pieces and px, untrimmed pieces and why)."""
    s = {**STRANDS, **(params or {})}
    g = np.asarray(garment, dtype=bool)
    found = hanging_strands(g, proxy, s)
    cand = [p for p in found["pieces"] if (p["outside_share"] or 0.0) >= s["min_outside_share"]]
    rec: dict[str, Any] = {"params": found["params"], "found": len(found["pieces"]), "trimmed": [], "trimmed_px": 0, "not_trimmed": [], "reason": None,
                           "note": None}
    if not cand:
        rec["not_trimmed"] = found["pieces"]
        rec["reason"] = "no thin piece hangs below the hem outside the proxy" if not found["pieces"] else "inside the proxy: left to the check"
        return g, rec
    px = sum(p["below_px"] for p in cand)
    if len(cand) > s["max_trim_pieces"] or px > s["max_trim_frac"] * max(1, int(g.sum())):
        rec["not_trimmed"] = found["pieces"]
        rec["reason"] = (f"{len(cand)} pieces, {px} px: more than {s['max_trim_pieces']} pieces or {s['max_trim_frac']} of the garment "
                         "(a fringe or tassels?): left as drawn, for a person to look at")
        return g, rec
    keep_ids = {id(p) for p in cand}
    drop = np.isin(found["below"], [i + 1 for i, p in enumerate(found["pieces"]) if id(p) in keep_ids])
    rec["trimmed"] = cand
    rec["trimmed_px"] = int((drop & g).sum())
    rec["not_trimmed"] = [p for p in found["pieces"] if id(p) not in keep_ids]
    rec["note"] = strands_trim_note(rec)
    return g & ~drop, rec


def strands_trim_note(rec: Mapping[str, Any] | None) -> str | None:
    """The visible line for a `trim_strands` record that left pixels out (stage1b-qa-0.12.0, review of run 17a: a trim is never
    silent): None when nothing was trimmed. Goes to the candidate's QA warnings, the stage 1b summary warnings and the logs."""
    if not rec or not rec.get("trimmed_px"):
        return None
    ps = rec["trimmed"]
    rows = [min(p["hem_row"] + 1 for p in ps), max(p["rows"][1] for p in ps)]
    cols = [min(p["cols"][0] for p in ps), max(p["cols"][1] for p in ps)]
    return (f"left out {rec['trimmed_px']} px of {len(ps)} thin piece(s) the engine drew hanging below the hem outside the proxy (a cut string "
            f"or a sliver), rows "
            f"{rows[0]}-{rows[1]}, columns {cols[0]}-{cols[1]} (our bare render shows there; nothing painted; not a QA failure)")


def view_agreement(front: Mapping[str, Any] | None, back: Mapping[str, Any] | None, thresholds: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Front and back still of the same garment? `front` / `back` are the `garment_body` records of the two stills. The
    body lengths (each against its own proxy view) may differ by at most `max_view_length_gap`, and when the proxy has
    sleeves (`min_proxy_sleeve_share`) their sleeve cover by at most `max_view_sleeve_gap`. Run 15's cardigan: a cropped
    front with long knit sleeves and a full-length sleeveless back. A TYPE check (never overridden)."""
    t = {**VIEW_THRESHOLDS, **(thresholds or {})}
    out: dict[str, Any] = {"length_gap": None, "sleeve_gap": None, "top_gap": None, "thresholds": t, "failures": []}
    if not front or not back:
        out["pass"] = None
        out["note"] = "not checked: a view has no garment record"
        return out
    lf, lb = front.get("body_length"), back.get("body_length")
    if lf is not None and lb is not None:
        out["length_gap"] = round(abs(float(lf) - float(lb)), 4)
        if out["length_gap"] > t["max_view_length_gap"]:
            out["failures"].append(f"front and back differ in length: body length {lf:.3f} vs {lb:.3f} of the proxy (gap {out['length_gap']:.3f} > {t['max_view_length_gap']}; two different garments)")
    tf, tb = front.get("top_offset"), back.get("top_offset")
    if tf is not None and tb is not None:
        out["top_gap"] = round(abs(float(tf) - float(tb)), 4)
        if out["top_gap"] > t["max_view_top_gap"]:
            out["failures"].append(f"front and back differ at the waist: waistband {tf:.3f} vs {tb:.3f} of the proxy's length below its top "
                                   f"(gap {out['top_gap']:.3f} > {t['max_view_top_gap']}; a step at the waist)")
    sf, sb = front.get("sleeve_cover"), back.get("sleeve_cover")
    share = min(float(front.get("sleeve_share") or 0.0), float(back.get("sleeve_share") or 0.0))
    if sf is not None and sb is not None and share >= t["min_proxy_sleeve_share"]:
        out["sleeve_gap"] = round(abs(float(sf) - float(sb)), 4)
        if out["sleeve_gap"] > t["max_view_sleeve_gap"]:
            out["failures"].append(f"front and back differ in sleeves: sleeve cover {sf:.3f} vs {sb:.3f} of the proxy's sleeves (gap {out['sleeve_gap']:.3f} > {t['max_view_sleeve_gap']}; two different garments)")
    out["pass"] = not out["failures"]
    return out


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
    # texture: candidate edge density / shop edge density, when the shop garment is printed. 0.35 until stage1b-qa-0.9.0;
    # raised after run 15's blouse back (FASHN: the right palette, the print washed out to a pale blotchy shirt; 0.404 on
    # the 0.9.0 composite). FASHN stills that looked right: azure 0.63-0.82 (runs 14 and 15), skirt 0.91, blouse front
    # 0.95; Qwen's solid blue azure 0.17-0.21. One product sets this floor: provisional.
    "min_edge_ratio": 0.5,
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


# stage1b-qa-0.10.0 (run 16a). Front and back stills of one garment are lit by the same studio light, so their colours must
# agree about as well as the shop's front and back photos do. Run 16a: the blouse's Qwen back came out a dark orange-brown
# (median Lab L 53) against a cream front (L 64): still dE 13.7 where the shop photos differ by 4.7; print fidelity passed it
# because it normalises exposure first (gain 2.28: dE 7.9 normalised, 22.1 not). The palazzo's mixed pair (Qwen front, FASHN
# back) differs by about 11. A failure fails the back still (not a type failure: a colour, not a shape).
VIEW_COLOUR = {"min_limit_delta_e": 8.0, "shop_factor": 2.0}
# The garment's outer columns (`edge_share` of its width a side: in a posed shop photo and on our A-pose these are the sleeves):
# when the shop photo's two sides differ strongly (|dLab| >= `min_shop_asym`), the still's must point the same way (cosine of the
# two left-minus-right Lab vectors >= 0 when the still's own difference is at least half of `min_shop_asym`: else SWAPPED) and must
# not vanish (below `min_kept` of the shop's: LOST). Run 16a's cardigan back (Qwen): camel sleeve on the viewer's left and brown on
# the right in the shop back, the other way round in the still (cosine < 0; the wearer's right arm brown from the front and camel
# from the back). FASHN's cardigan back drew both sleeves cream (lost). Outer 15 %: a third took in the argyle body of the 3/4
# shop front and read it as swapped.
SIDE_COLOUR = {"min_shop_asym": 15.0, "min_kept": 0.25, "edge_share": 0.15}


def _median_lab(rgb: np.ndarray, mask: np.ndarray, max_px: int = 60000) -> np.ndarray | None:
    m = np.asarray(mask, dtype=bool)
    if not m.any():
        return None
    px = np.asarray(rgb)[..., :3][m]
    px = px[:: max(1, int(np.ceil(len(px) / max_px)))].astype(np.float64)
    return np.median(srgb_to_lab(px), axis=0)


def view_colour(front: tuple[np.ndarray, np.ndarray], back: tuple[np.ndarray, np.ndarray], shop_front: tuple[np.ndarray, np.ndarray] | None,
                shop_back: tuple[np.ndarray, np.ndarray] | None, params: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Median Lab Delta E between the front and back stills' garments against the limit max(`min_limit_delta_e`,
    `shop_factor` x the shop photos' own front/back Delta E). Each argument is (rgb, garment mask)."""
    t = {**VIEW_COLOUR, **(params or {})}
    lf, lb = _median_lab(*front), _median_lab(*back)
    out: dict[str, Any] = {"params": t, "delta_e": None, "shop_delta_e": None, "limit": None, "failures": [], "pass": None}
    if lf is None or lb is None:
        out["note"] = "not checked: an empty garment"
        return out
    de = float(np.linalg.norm(lf - lb))
    shop = None
    if shop_front is not None and shop_back is not None:
        sf, sb = _median_lab(*shop_front), _median_lab(*shop_back)
        if sf is not None and sb is not None:
            shop = float(np.linalg.norm(sf - sb))
    limit = max(t["min_limit_delta_e"], t["shop_factor"] * (shop or 0.0))
    out.update({"delta_e": round(de, 2), "shop_delta_e": None if shop is None else round(shop, 2), "limit": round(limit, 2),
                "median_lab_front": [round(float(x), 1) for x in lf], "median_lab_back": [round(float(x), 1) for x in lb]})
    if de > limit:
        out["failures"].append(f"front and back stills differ in colour: median Delta E {de:.1f} > {limit:.1f} (the shop photos differ by "
                               f"{'?' if shop is None else f'{shop:.1f}'}; lit alike, so one view was drawn in another colour)")
    out["pass"] = not out["failures"]
    return out


def _side_labs(rgb: np.ndarray, mask: np.ndarray, third: float) -> tuple[np.ndarray, np.ndarray] | None:
    m = np.asarray(mask, dtype=bool)
    xs = np.nonzero(m.any(axis=0))[0]
    if len(xs) < 6:
        return None
    x0, x1 = int(xs[0]), int(xs[-1]) + 1
    k = max(1, int(round((x1 - x0) * third)))
    left, right = m.copy(), m.copy()
    left[:, x0 + k:] = False
    right[:, :x1 - k] = False
    a, b = _median_lab(rgb, left), _median_lab(rgb, right)
    return None if a is None or b is None else (a, b)


def side_colour(still: np.ndarray, still_mask: np.ndarray, shop: np.ndarray, shop_mask: np.ndarray,
                params: Mapping[str, float] | None = None) -> dict[str, Any]:
    """The garment's left and right outer columns (as seen) in the still against the shop photo of the SAME view (`SIDE_COLOUR`)."""
    t = {**SIDE_COLOUR, **(params or {})}
    out: dict[str, Any] = {"params": t, "shop_asym": None, "still_asym": None, "cosine": None, "failures": [], "pass": None}
    a, b = _side_labs(still, still_mask, t["edge_share"]), _side_labs(shop, shop_mask, t["edge_share"])
    if a is None or b is None:
        out["note"] = "not checked: an empty garment"
        return out
    da, db = a[0] - a[1], b[0] - b[1]
    shop_n, still_n = float(np.linalg.norm(db)), float(np.linalg.norm(da))
    cos = None if shop_n == 0 or still_n == 0 else float(np.dot(da, db) / (shop_n * still_n))
    out.update({"shop_asym": round(shop_n, 2), "still_asym": round(still_n, 2), "cosine": None if cos is None else round(cos, 3),
                "shop_left_right_lab": [[round(float(x), 1) for x in b[0]], [round(float(x), 1) for x in b[1]]],
                "still_left_right_lab": [[round(float(x), 1) for x in a[0]], [round(float(x), 1) for x in a[1]]]})
    if shop_n < t["min_shop_asym"]:
        out["note"] = "the shop photo's two sides are alike: not checked"
        out["pass"] = True
        return out
    if still_n >= 0.5 * t["min_shop_asym"] and cos is not None and cos < 0:
        out["failures"].append(f"left and right swapped against the shop photo: the sides differ by {still_n:.1f} the other way round "
                               f"(cosine {cos:.2f}; the shop's {shop_n:.1f}; e.g. the dark sleeve drawn on the other arm)")
    elif still_n < t["min_kept"] * shop_n:
        out["failures"].append(f"the sides' colours lost: they differ by {still_n:.1f} where the shop photo's differ by {shop_n:.1f} (< {t['min_kept']} x; "
                               f"e.g. two sleeves of different colours drawn alike)")
    out["pass"] = not out["failures"]
    return out


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


def _edge_where(rr: Sequence[int | None], garment: np.ndarray) -> str:
    """Where a row range lies against the garment's own height: "shoulders / top", "waist / middle" or "hem / bottom" third
    (stage1b-qa-0.10.1: the failure text named shoulder caps for run 16a's skirt, whose grey band is the belly above a low
    waistband)."""
    ys = _rows(garment)
    if rr[0] is None or rr[1] is None or len(ys) == 0:
        return "rows unknown"
    y0, y1 = int(ys[0]), int(ys[-1])
    mid = (rr[0] + rr[1]) / 2.0
    f = 0.0 if y1 == y0 else (mid - y0) / (y1 - y0)
    part = "near the garment's top (a waistband, neckline or shoulders)" if f < 1 / 3 else "in the garment's middle third" if f < 2 / 3 else "near the garment's hem"
    return f"rows {rr[0]}-{rr[1]} of the garment's {y0}-{y1}, {part}"


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
    unpasted: Mapping[str, Any] | None = None,
    edges: Mapping[str, Any] | None = None,
    side: Mapping[str, Any] | None = None,
    gap_body: Mapping[str, Any] | None = None,
    trimmed: Mapping[str, Any] | None = None,
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
    # Merged legs are measured on what the engine DREW (the unclipped garment): since stage1b-qa-0.7.0 a trouser region
    # keeps a gap between the legs, so the clipped composite has two legs whatever the engine painted there.
    prof_drawn = pg.gap_profile(gf, p, legs) if kind == "trousers" else prof
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
    body = garment_body(g, p, b, kind=kind, erode_px=band["erode_px"], exclude=zone if zone_px else None)
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
    # The garment-type checks (a different garment drawn: trousers as a skirt, a skirt or trousers with a bodice, an
    # open front closed) are listed in `type_failures` as well: `--accept-failed-dress` never overrides them
    # (`phase0_lib.stage1b_summary` `type_failed_views`, `run_phase0._dress_gate`), so a wrong garment cannot reach stage 2.
    n_before_type = len(failures)
    if kind == "trousers" and trouser_rows >= t["min_merged_leg_rows"] and prof_drawn["merged_leg_rows"] / trouser_rows > t["max_merged_leg_frac"]:
        failures.append(f"legs merged: the garment closes the body axis between the legs in {prof_drawn['merged_leg_rows']}/{trouser_rows} leg rows where the proxy's legs stand apart (trousers drawn as a skirt)")
    if kind in ("skirt", "trousers") and above_frac > t["max_above_waist_frac"]:
        failures.append(f"garment above the waistband: {above_frac:.3f} of the garment lies more than {band['dilate_px']} px above the proxy's top edge > {t['max_above_waist_frac']} (a {kind} drawn with a bodice)")
    if opening_cover is not None and opening_cover > t["max_opening_cover"]:
        failures.append(f"front opening closed: the garment covers {opening_cover:.3f} of the proxy's front opening ({zone_px} px) > {t['max_opening_cover']} (an open front drawn closed)")
    st = body["see_through"]
    if st is not None and st > t["max_see_through"]:
        failures.append(f"see-through: our mannequin shows inside the garment's outline on {st:.3f} of it ({body['see_through_px']} px) > {t['max_see_through']} (a torn garment)")
    bl = body["body_length"]
    if bl is not None and bl < t["min_body_length"]:
        failures.append(f"body too short: the garment reaches {bl:.3f} of the proxy's length in the body columns < {t['min_body_length']} (a cropped or shrunken garment)")
    un_frac = None if unpasted is None else unpasted.get("frac")
    if un_frac is not None and un_frac > t["max_unpasted_frac"]:
        rows = unpasted.get("rows")
        failures.append(f"garment cut by the composite: {unpasted['px']} px the engine drew as cloth on our body are not pasted ({un_frac:.3f} of the garment"
                        f"{f', rows {rows[0]}-{rows[1]}' if rows else ''}) > {t['max_unpasted_frac']} (our mannequin shows in a notch)")
    hips = hip_profile(g, p, b, legs, kind=kind, short_px=max(1, int(round(t["hip_short_frac"] * h))))
    if (hips["rows"] >= t["min_hip_rows"] and hips["short_frac"] is not None and hips["short_frac"] > t["max_hip_short_frac"]
            and hips["exposed_frac"] > t["max_hip_exposed_frac"]):
        ml, mr = hips["median_short_px"]
        failures.append(f"narrow at the hips: the garment stops {hips['short_px']}+ px inside the proxy in {hips['short_rows']}/{hips['rows']} hip rows "
                        f"(median {ml:.0f} / {mr:.0f} px left / right) > {t['max_hip_short_frac']}, our mannequin beside it in {hips['exposed_rows']} rows "
                        f"({hips['body_exposed_px']} px) > {t['max_hip_exposed_frac']} "
                        f"(the video opens a side slit there)")
    # stage1b-qa-0.10.0 (run 16a), TYPE checks.
    if edges is not None and gn:
        e_frac = edges["px"] / gn
        if edges["px"] > t["max_body_beside_px"] and e_frac > t["max_body_beside_frac"]:
            rr = edges.get("row_range") or [None, None]
            failures.append(f"our mannequin beside the garment: {edges['px']} px of our body stick out past the cloth's edge where the engine drew no body "
                            f"({e_frac:.4f} of the garment, {edges['rows']} rows {rr[0]}-{rr[1]}, up to {edges['max_px']} px wide) > {t['max_body_beside_frac']} "
                            f"({_edge_where(rr, g)}: our grey body shows past the cloth's edge where the engine drew background)")
    steps = width_steps(g, b, kind=kind, step_px=max(1, int(round(t["max_width_step_frac"] * h))), proxy=p)
    if steps["steps"]:
        st0 = steps["steps"][0]
        failures.append(f"shelf in the outline: the garment's {st0['side']} edge steps {st0['px']} px inward at row {st0['row']} "
                        f"({len(steps['steps'])} step(s) > {steps['step_px']} px; a ledge the 3D would carry)")
    crotch = crotch_height(g, p, b) if kind == "trousers" else None
    if crotch is not None and crotch["rise_px"] is not None:
        if crotch["rise_px"] > t["max_crotch_rise_frac"] * h and crotch["mannequin_above_proxy_crotch_px"] > t["max_crotch_mannequin_px"]:
            failures.append(f"crotch too high: the legs split at row {crotch['garment_crotch_row']}, {crotch['rise_px']} rows above the proxy's "
                            f"({crotch['proxy_crotch_row']}), our mannequin showing between them ({crotch['mannequin_above_proxy_crotch_px']} px)")
    if gap_body is not None and gap_body.get("px", 0) > t["max_gap_mannequin_px"]:
        rr = gap_body.get("rows") or [None, None]
        failures.append(f"our mannequin in the crotch: {gap_body['px']} px of our body show in the gap between the legs (rows {rr[0]}-{rr[1]}; "
                        f"{gap_body['raw_cloth_px']} px where the engine drew cloth or our thighs, {gap_body['raw_background_px']} px where it drew "
                        f"background) > {t['max_gap_mannequin_px']} (grey thighs where the trousers should be)")
    # stage1b-qa-0.12.0 (run 16b), TYPE: a thin piece hanging below the hem in the pasted mask (the composite leaves out at most
    # a few cut strings outside the proxy, `trim_strands`; what is left here is inside the proxy, or too many to be strings)
    strands = hanging_strands(g, p)
    strands.pop("below")
    if strands["pieces"]:
        s0 = max(strands["pieces"], key=lambda q: q["hang_rows"])
        failures.append(f"thin piece hanging below the hem: {len(strands['pieces'])} piece(s), {strands['px']} px below the hem; the longest "
                        f"rows {s0['rows'][0]}-{s0['rows'][1]}, columns {s0['cols'][0]}-{s0['cols'][1]}, {s0['hang_rows']} rows below the cloth "
                        f"beside it (narrower than {strands['params']['open_px']} px: a string, a fragment or a dark sliver the engine drew or the composite "
                        "pasted; the video swings it into a flap)")
    # stage1b-qa-0.12.0 (review of run 17a): what `trim_strands` left out of this still is a warning, never silent
    trim_note = strands_trim_note(trimmed)
    if trim_note:
        warnings.append(trim_note)
    type_failures = failures[n_before_type:]
    if fidelity is not None and fidelity.get("pass") is False:
        failures.extend(f"print fidelity: {f}" for f in fidelity.get("failures", []))
    if side is not None and side.get("pass") is False:
        failures.extend(f"side colours: {f}" for f in side.get("failures", []))
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
        "merged_leg_rows": prof_drawn["merged_leg_rows"],
        "merged_leg_rows_basis": "unclipped garment (what the engine drew)" if kind == "trousers" else "garment mask (clipped)",
        "garment_body": body,
        "hips": hips,
        "unpasted": None if unpasted is None else dict(unpasted),
        "body_beside": None if edges is None else dict(edges),
        "gap_mannequin": None if gap_body is None else dict(gap_body),
        "width_steps": steps,
        "hanging_strands": strands,
        "strands_trimmed": None if not trim_note else {"trimmed_px": int(trimmed["trimmed_px"]), "pieces": [dict(q) for q in trimmed["trimmed"]], "note": trim_note},
        "crotch": crotch,
        "side_colour": None if side is None else dict(side),
        "above_waist_px": above_px,
        "above_waist_fraction": round(above_frac, 4),
        "front_opening_px": zone_px,
        "front_opening_cover": None if opening_cover is None else round(opening_cover, 4),
        "fidelity": None if fidelity is None else dict(fidelity),
        "thresholds": t,
        "warn_only": sorted(STILL_QA_WARN_ONLY - hard),
        "pass": not failures,
        "failures": failures,
        "type_failures": list(type_failures),
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


# stage1b-qa-0.10.0 (run 16a's palazzo: Qwen front by fidelity 0.853 vs 0.836, FASHN back by 0.867 vs 0.864, a pair of two
# different-looking trousers): the back takes the front's engine when that candidate passes and its print fidelity is within
# this margin of the best.
SAME_ENGINE_MARGIN = 0.02


def pick_engine(candidates: Sequence[Mapping[str, Any]], prefer: str | None = None) -> dict[str, Any]:
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

    def best_of(pool: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
        # max() keeps the first of equal keys: the earlier candidate (FASHN before Qwen, the lower seed) wins a tie
        return max(pool, key=key)

    # stage1b-qa-0.11.0: a candidate is named by `id` (lib.candidate_id: the engine, or engine@seed for a draw plan); the
    # returned `engine` is the picked candidate's engine and `candidate` its id (equal for a run with one draw per engine).
    fid_failed = [cid(c) for c in ok if (_fid(c) or {}).get("pass") is False]
    passing = [c for c in ok if c["qa"].get("pass") and cid(c) not in fid_failed]
    out: dict[str, Any] = {
        "order": "pass all hard checks -> highest print fidelity -> highest silhouette score; a fidelity failure is never picked",
        "passed": [cid(c) for c in passing],
        "fidelity_failed": fid_failed,
        "scores": {cid(c): c["qa"].get("score") for c in ok},
        "fidelity": {cid(c): (_fid(c) or {}).get("score") for c in ok},
        "rejected_still": None,
    }
    picked = lambda c, **kw: {**out, "engine": c["engine"], "candidate": cid(c), **kw}  # noqa: E731
    if not ok:
        return {**out, "engine": None, "candidate": None, "reason": "every engine failed with an error"}
    if passing:
        best = best_of(passing)
        why = "the only candidate that passes every check" if len(passing) == 1 else "passes every check; highest print fidelity, then silhouette score"
        same_pool = [c for c in passing if c["engine"] == prefer]
        same = best_of(same_pool) if same_pool else None
        if same is not None and same is not best:
            fb, fs = (_fid(best) or {}).get("score"), (_fid(same) or {}).get("score")
            if fb is not None and fs is not None and float(fs) >= float(fb) - SAME_ENGINE_MARGIN:
                return picked(same, prefer=prefer,
                              reason=f"passes every check; the front's engine, its print fidelity {float(fs):.3f} within {SAME_ENGINE_MARGIN} of the best ({cid(best)} {float(fb):.3f})")
        return picked(best, reason=why, prefer=prefer)
    pool = [c for c in ok if cid(c) not in fid_failed]
    # A candidate with a TYPE failure (a different garment drawn: trousers as a skirt, torn, shrunken) is shown only when
    # every candidate has one: with --accept-failed-dress a still that fails only provisional checks can still be used,
    # and run 16's palazzo runs both engines so Qwen's two legs can stand in for FASHN's skirt.
    typed_ok = [c for c in pool if not (c["qa"].get("type_failures") or [])]
    out["type_failed"] = [cid(c) for c in ok if (c["qa"].get("type_failures") or [])]
    if typed_ok:
        why = "no engine passed QA: best of the candidates without a type failure whose print fidelity did not fail, rejected"
        return picked(best_of(typed_ok), reason=why)
    if pool:
        return picked(best_of(pool), reason="no engine passed QA: best of the candidates whose print fidelity did not fail, rejected")
    best = best_of(ok)
    return {**out, "engine": None, "candidate": None, "rejected_still": cid(best),
            "reason": "no engine passed QA and every candidate failed print fidelity: none picked; the highest fidelity is kept as rejected"}


def cid(c: Mapping[str, Any]) -> str:
    """A candidate record's name (lib.candidate_id): `id`, else its `engine` (records before stage1b-qa-0.11.0)."""
    return str(c.get("id") or c["engine"])


def shown_candidate(decision: Mapping[str, Any]) -> str | None:
    """The candidate a view shows: the picked one, else the one kept as rejected (every candidate failed print fidelity)."""
    return decision.get("candidate") or decision.get("rejected_still")


# --- several draws per view: pick the front/back PAIR (stage1b-qa-0.11.0, run 17a) ---------------------------------------
#
# Run 16a drew one candidate per engine and view and picked each view on its own; a front and back that each passed could still
# disagree (the skirt: FASHN's back waist 0.034, its front 0.113 below the proxy's top; the blouse: a cream front and an
# orange-brown back). With a draw plan (lib.parse_draw_plan: several seeds, both engines, a view kept from the earlier run)
# every front that passes is paired with every back that passes, and a pair is eligible only when the SAME pair checks the
# single-pair app applies all pass: back_view_checks, view_agreement (length, sleeves, waistband: a TYPE check) and
# view_colour. No threshold is changed. Among eligible pairs: same engine first (one drawing style), then the higher of the
# two views' lower print fidelity (2 decimals), then the higher lower silhouette score; the earlier pair wins a tie. Every
# pair is recorded with its failures. When no pair is eligible the views are shown by the per-view order (pick_engine) and
# the pair checks of that shown pair fail the back, as before.

PAIR_ORDER = ("eligible = both candidates pass every check of their own and back_view, view_agreement and view_colour pass for the pair; "
              "then same engine -> higher min print fidelity (2 decimals) -> higher min silhouette score -> earlier pair")


def _own_ok(c: Mapping[str, Any]) -> bool:
    return "error" not in c and bool((c.get("qa") or {}).get("pass")) and (_fid(c) or {}).get("pass") is not False


def pair_checks(front: tuple[np.ndarray, np.ndarray], back: tuple[np.ndarray, np.ndarray], front_qa: Mapping[str, Any] | None,
                back_qa: Mapping[str, Any] | None, shop_front: tuple[np.ndarray, np.ndarray] | None,
                shop_back: tuple[np.ndarray, np.ndarray] | None) -> dict[str, Any]:
    """The checks between one front and one back still (each (rgb, garment mask)), exactly those the single-pair app applies to
    its back: `back_view_checks` (only with both shop photos), `view_agreement` on the two `garment_body` records, `view_colour`."""
    if shop_front is not None and shop_back is not None:
        bv = back_view_checks(front[0], front[1], back[0], back[1], shop_front[0], shop_front[1], shop_back[0], shop_back[1])
    else:
        bv = {"pass": None, "failures": [], "note": "not checked: no front and back shop photo"}
    va = view_agreement((front_qa or {}).get("garment_body"), (back_qa or {}).get("garment_body"))
    vc = view_colour(front, back, shop_front, shop_back)
    return {"back_view": bv, "view_agreement": va, "view_colour": vc}


def pick_pair(fronts: Sequence[Mapping[str, Any]], backs: Sequence[Mapping[str, Any]], checks: Mapping[tuple[str, str], Mapping[str, Any]]) -> dict[str, Any]:
    """`fronts` / `backs`: candidate records (id or engine, qa with pass and fidelity); `checks`: (front id, back id) -> `pair_checks`
    (pairs missing from it are not eligible). Returns the pair table (every pair with its failures) and the picked ids, or None
    for both when no pair is eligible (the caller then shows the views by `pick_engine`)."""
    table: list[dict[str, Any]] = []
    best_key: tuple | None = None
    best: dict[str, Any] | None = None
    for i, f in enumerate(fronts):
        for j, b in enumerate(backs):
            fails: list[str] = []
            for side, c in (("front", f), ("back", b)):
                if "error" in c:
                    fails.append(f"{side} {cid(c)}: {c['error']}")
                elif not _own_ok(c):
                    fails.append(f"{side} {cid(c)}: fails its own QA ({len((c.get('qa') or {}).get('failures') or [])} failures)")
            chk = checks.get((cid(f), cid(b)))
            if chk is None:
                fails.append("pair checks not run")
            else:
                for name in ("back_view", "view_agreement", "view_colour"):
                    fails += [f"{name}: {x}" for x in (chk.get(name) or {}).get("failures") or []]
            ff, fb = (_fid(f) or {}).get("score"), (_fid(b) or {}).get("score")
            min_fid = None if ff is None or fb is None else round(min(float(ff), float(fb)), 4)
            sf, sb = (f.get("qa") or {}).get("score"), (b.get("qa") or {}).get("score")
            min_score = None if sf is None or sb is None else round(min(float(sf), float(sb)), 4)
            row = {"front": cid(f), "back": cid(b), "same_engine": f.get("engine") == b.get("engine"), "min_fidelity": min_fid, "min_score": min_score,
                   "eligible": not fails, "failures": fails}
            # the margins a reviewer weighs (review of 0.11.0: the pick does not rank by them): torso cover per view and
            # each view's waistband (garment top below the proxy's top, a share of the proxy's length)
            for side, c in (("front", f), ("back", b)):
                q = c.get("qa") or {}
                row[f"{side}_torso_cover"] = (q.get("silhouette_band") or {}).get("torso_cover")
                row[f"{side}_top_offset"] = (q.get("garment_body") or {}).get("top_offset")
            if chk is not None:
                row["delta_e"] = (chk.get("view_colour") or {}).get("delta_e")
                row["top_gap"] = (chk.get("view_agreement") or {}).get("top_gap")
            table.append(row)
            if not fails:
                k = (row["same_engine"], round(min_fid if min_fid is not None else -1.0, 2), min_score if min_score is not None else 0.0, -(i * len(backs) + j))
                if best_key is None or k > best_key:
                    best_key, best = k, row
    n_ok = sum(r["eligible"] for r in table)
    out = {"order": PAIR_ORDER, "pairs": table, "eligible": n_ok, "front": None, "back": None}
    if best is None:
        out["reason"] = f"no eligible pair among {len(table)}: the views are shown by the per-view order, rejected"
        return out
    out.update({"front": best["front"], "back": best["back"],
                "reason": f"{n_ok} of {len(table)} pairs eligible; picked {best['front']} + {best['back']}"
                          f"{' (same engine)' if best['same_engine'] else ''}, min print fidelity {best['min_fidelity']}, min silhouette score {best['min_score']}"})
    return out


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


def _version_at_least(version: str | None, ref: tuple[int, int, int]) -> bool:
    """`stage1b-qa-0.8.0` >= (0, 8, 0); None or an unparsable version is False."""
    if not version:
        return False
    try:
        parts = tuple(int(x) for x in version.rsplit("-", 1)[-1].split(".")[:3])
    except ValueError:
        return False
    return parts >= ref


def _read_mask(path: str) -> np.ndarray:
    from PIL import Image

    a = np.asarray(Image.open(path).convert("L"))
    return a > 127


def _read_rgb(path: str) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"))


def candidate_entries(job_dir: str, view: str) -> list[tuple[str, str]]:
    """(id, stem) of every candidate of `view` in a finished stage 1b job: `raw/<stem>.png` with
    `candidates/<stem>_garment_mask.png` (lib.parse_candidate_stem: `front_fashn`, `front_qwen_s44`). Ordered FASHN before Qwen,
    then by seed: the order ties are broken in. `stage1b/history/` (earlier runs) is not looked at."""
    import phase0_lib as lib

    raw_dir = os.path.join(job_dir, lib.STAGE1B_DIR, "raw")
    found: list[tuple[int, int, str, str]] = []
    for fn in sorted(os.listdir(raw_dir)) if os.path.isdir(raw_dir) else []:
        stem, ext = os.path.splitext(fn)
        parsed = lib.parse_candidate_stem(stem) if ext == ".png" else None
        if parsed is None or parsed[0] != view:
            continue
        if not os.path.exists(os.path.join(job_dir, lib.STAGE1B_DIR, "candidates", f"{stem}_garment_mask.png")):
            continue
        eng, _, seed = parsed[1].partition("@")
        found.append((lib.STAGE1B_ENGINES.index(eng), int(seed) if seed else -1, parsed[1], stem))
    return [(c, st) for _, _, c, st in sorted(found)]


def chosen_mask_from_saved(raw_engine: np.ndarray, saved: np.ndarray, region: np.ndarray, *, chosen_path: str | None, conformed_path: str | None,
                           app_saved: bool, mask_source: str | None, target: np.ndarray | None, bg: Sequence[int]) -> tuple[np.ndarray, str]:
    """The chosen mask (before the composite's additions and the conforms) from which the app path is rebuilt, and where it came from:
    0.10.0+: saved by the app;  before 0.8.0: the saved mask is the chosen one;  0.8.0 / 0.9.0: the difference prior when that was
    chosen (exact, recomputed), else the saved composite mask with the conform inverted (estimate)."""
    if chosen_path and os.path.exists(chosen_path):
        return _read_mask(chosen_path) & region, "the chosen mask the app saved"
    if not app_saved:
        return saved & region, "the saved (chosen) mask of a job before 0.8.0"
    if str(mask_source or "").startswith("difference") and target is not None:
        return garment_prior(raw_engine, target, region, bg) & region, "the difference prior, recomputed (exact)"
    if conformed_path and os.path.exists(conformed_path):
        um, urec = unconform_mask(_read_rgb(conformed_path), raw_engine, saved)
        return um & region, f"the saved composite mask with the conform inverted ({urec['rows']} rows, match error {urec['median_match_error_8bit']}; an estimate, a superset of the chosen mask)"
    return saved & region, "the saved composite mask (no conform applied; a superset of the chosen mask)"


def rescore_job(job_dir: str, manifest: Mapping[str, Any], path: str = "app", stills_dir: str | None = None,
                pins: Mapping[str, str] | None = None) -> dict[str, Any]:
    """QA v2 on the stage 1b outputs already in `job_dir`, per engine candidate when the job has them
    (`stage1b/raw/<view>_<engine>.png` with `stage1b/candidates/<view>_<engine>_garment_mask[_unclipped].png`, from
    stage1b-qa-0.3.0), else the single still (`stage1b/raw/<view>.png`, `stage1b/garment_mask_<view>.png`); then the
    engine choice (`pick_engine`), the garment colour of each shop photo (`garment_colour`) and the back-view checks.
    For a job exported before 0.4.0 the proxy mask is control/proxy_mask/<frame>.png (same proxy, same camera) and
    the garment mask is the one stage 1b made against the BARE render (clipped only to v1's wide margin, so it
    serves as the unclipped mask here); the record says so. Print fidelity needs the shop photo and its SAM 2 mask
    (`stage1b/source/<role>_mask.png`).

    `path`: "app" (default) predicts what the current GPU app would paste from the same raw outputs: since 0.10.0 every job
    is rebuilt with `compose_candidate` from its chosen mask (saved by the app since 0.10.0; the saved mask before 0.8.0;
    for 0.8.0 / 0.9.0 jobs the difference prior recomputed when that was chosen, else the saved composite mask with the
    conform inverted by `unconform_mask`, an estimate; `composite_mask.chosen_basis` says which). "pasted" scores the
    masks the run actually pasted (run 15: its difference / SAM 2 masks, the torn blouse), with the conform only replayed.
    `stills_dir`: write each candidate's replayed composite and mask there, to look at. `pins`: view -> candidate (an engine, or
    engine@seed for a draw plan's candidates).

    stage1b-qa-0.11.0: candidates are found by file name (`candidate_entries`), so a draw plan's several seeds per view are
    scored too; when any candidate is named engine@seed the front/back PAIR is picked (`pick_pair`, `pairs` in the result),
    else each view by `pick_engine` as before."""
    import json

    import phase0_lib as lib

    if path not in ("app", "pasted"):
        raise ValueError(f"path must be 'app' or 'pasted', not {path!r}")
    saved_version = None
    rec_path = os.path.join(job_dir, lib.STAGE1B_DIR, "record.json")
    if os.path.exists(os.path.join(job_dir, lib.STAGE1B_DIR, "record.before_recompose.json")):
        # a recomposed job (`recompose_job`): the engine run's own record says how its masks were made
        rec_path = os.path.join(job_dir, lib.STAGE1B_DIR, "record.before_recompose.json")
    if os.path.exists(rec_path):
        with open(rec_path, encoding="utf-8") as f:
            saved_version = json.load(f).get("qa_version")
    app_saved = _version_at_least(saved_version, (0, 8, 0))

    spec = manifest["stage1b"]
    kind = ((manifest.get("control") or {}).get("proxy") or {}).get("kind") or (spec.get("target") or {}).get("proxy_kind") or manifest["category"]
    tryon_cat = lib.tryon_category(manifest["category"])
    bg = tuple(spec["background_rgb"])
    p = lambda rel: os.path.join(job_dir, rel)  # noqa: E731
    # stage1b-qa-0.10.0: the app path is always rebuilt from the chosen mask (`compose_candidate`); see the per-candidate
    # `composite_mask.chosen_basis` for where that mask came from (saved, recomputed, or estimated for a 0.8.0 / 0.9.0 job).
    rebuild = path == "app"
    out: dict[str, Any] = {"version": STAGE1B_QA_VERSION, "kind": kind, "views": {}, "colour": {}, "path": path, "saved_qa_version": saved_version,
                           "mask_basis": ("rebuilt as the current app would (compose_candidate) from the chosen mask; per candidate composite_mask.chosen_basis" if rebuild else
                                          "the masks the run pasted (the conform only replayed for a job before 0.8.0)")}
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
    all_arrays: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]] = {}
    for v in spec["views"]:
        name, frame = v["view"], int(v["frame"])
        proxy_rel = v.get("proxy_mask") or f"{manifest['control']['proxy_mask_dir']}/{frame:04d}.png"
        bare_rgb = _read_rgb(p(v["bare_rgb"]))
        bare = _read_mask(p(v["bare_mask"]))
        proxy = _read_mask(p(proxy_rel))
        h, w = bare.shape
        gap = trouser_gap_zone(proxy, bare) if kind == "trousers" else None
        region, region_rec = edit_region(proxy, bare, tryon_cat, keep_open=kind == "outerwear", open_crotch=gap)
        # The proxy as the engine was given it: trousers with the gap between the legs kept open (`qa_proxy`).
        proxy_q = qa_proxy(proxy, gap)
        target = _read_rgb(p(v["proxy_rgb"])) if v.get("proxy_rgb") else None
        shop = shops.get(name if not v.get("invented") else "front")
        found = candidate_entries(job_dir, name)
        ids = [c for c, _ in found]
        if pins and pins.get(name):
            # `pins` (view -> candidate): only that candidate is scored and can be picked (run 16b reuses run 16a's outputs with
            # the engine chosen per view after review; a draw plan's candidates are pinned as engine@seed)
            if pins[name] not in ids:
                raise ValueError(f"{name}: pinned engine {pins[name]!r} has no candidate in this job (have {ids})")
            found = [(c, st) for c, st in found if c == pins[name]]
        entries = [(c, f"{lib.STAGE1B_DIR}/raw/{st}.png", f"{lib.STAGE1B_DIR}/candidates/{st}_garment_mask.png",
                    f"{lib.STAGE1B_DIR}/candidates/{st}_garment_mask_unclipped.png", st) for c, st in found]
        if not entries:
            entries = [(None, f"{lib.STAGE1B_DIR}/raw/{name}.png", v["garment_mask"], v.get("garment_mask_unclipped") or f"{lib.STAGE1B_DIR}/garment_mask_unclipped_{name}.png", f"{name}_still")]
        cands: list[dict[str, Any]] = []
        arrays: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        saved_cands = {}
        if os.path.exists(rec_path):
            with open(rec_path, encoding="utf-8") as f:
                for sv in json.load(f).get("views", []):
                    if sv.get("view") == name:
                        saved_cands = {cid(c): c for c in sv.get("candidates", []) if c.get("id") or c.get("engine")}
        for eng, raw_rel, mask_rel, unclipped_rel, stem in entries:
            conformed_rel = f"{lib.STAGE1B_DIR}/candidates/{stem}_conformed.png" if eng else None
            chosen_rel = f"{lib.STAGE1B_DIR}/candidates/{stem}_chosen_mask.png" if eng else None
            saved = _read_mask(p(mask_rel))
            garment_full = _read_mask(p(unclipped_rel)) if os.path.exists(p(unclipped_rel)) else saved
            raw_engine = _read_rgb(p(raw_rel))  # the engine's output, never conformed
            conformed = None
            src_c = saved_cands.get(eng) or {}
            if rebuild:
                chosen, basis = chosen_mask_from_saved(raw_engine, saved, region, chosen_path=p(chosen_rel) if chosen_rel else None,
                                                       conformed_path=p(conformed_rel) if conformed_rel else None, app_saved=app_saved,
                                                       mask_source=src_c.get("mask_source"), target=target, bg=bg)
                kept_from = src_c.get("kept") or (src_c.get("drawn") or {}).get("kept") or {}  # a draw record, or a finalized one
                if kept_from.get("chosen_mask_basis"):
                    # a candidate kept from an earlier run (`import_kept`): its chosen mask was rebuilt then, from that run's files
                    basis = f"kept from {kept_from.get('from')}: {kept_from['chosen_mask_basis']}"
                raw, garment, comp = compose_candidate(raw_engine, chosen, bare, bare_rgb, proxy_q, region, bg, kind=kind, gap=gap)
                comp["chosen_basis"] = basis
                conformed = {**comp["conform"], "basis": "app path: compose_candidate (still_garment_mask, conform_to_proxy, conform_edges)"}
                garment_full = garment_full | garment
                unpasted, edges, gap_body = comp["unpasted"], comp["edges"], comp["gap_mannequin"]
            else:
                if conformed_rel and os.path.exists(p(conformed_rel)):
                    raw_rel = conformed_rel
                raw = _read_rgb(p(raw_rel))
                garment = saved & region
                _, comp = still_garment_mask(raw, garment, bare, proxy_q, region, bg=bg)
                unpasted = unpasted_cloth(raw, garment, bare_rgb, bare, region, bg, None if comp["ambiguous_with_mannequin"] else comp["mannequin"], proxy=proxy_q)
                edges = edge_profile(garment, bare, raw_engine, bg, kind=kind)
                gap_body = gap_mannequin(garment, bare, raw, gap, bg)
            fgb = lib.keep_large_components(lib.mask_not(lib.background_mask(raw.tobytes(), w, h, bg, 10)), w, h, 0.02)
            fg = np.frombuffer(bytes(fgb), np.uint8).reshape(h, w).astype(bool)
            keep = bare & ~region
            mae = float(np.abs(raw.astype(np.int16) - bare_rgb.astype(np.int16))[keep].mean()) if keep.any() else None
            residue = proxy_residue(raw, target, proxy_q, garment) if target is not None else None
            fid = print_fidelity(raw, garment, shop[0], shop[1]) if shop is not None and garment.any() else None
            side = side_colour(raw, garment, shops[name][0], shops[name][1]) if (not v.get("invented") and name in shops and garment.any()) else None
            qa = still_qa(garment, fg, bare, proxy_q, region, kind=kind, mannequin_mae=mae, residue=residue, garment_full=garment_full,
                          sleeve_band_px=region_rec["sleeve_band_px"], fidelity=fid, rgb=raw, bare_rgb=bare_rgb, unpasted=unpasted, edges=edges, side=side,
                          gap_body=gap_body, trimmed=comp.get("strands") if rebuild else None)
            qa["score"] = qa_score(qa)
            if conformed is not None:
                conformed["hips_after"] = qa["hips"]
            # "pasted": what the conform would do with the pasted mask (a replay on CPU; a 0.8.0+ record has it already).
            if path == "pasted" and not app_saved:
                c_img, c_mask, c_rec = conform_to_proxy(raw, garment, proxy_q, bare, region, kind=kind)
                c_rec["basis"] = "pasted mask (not the app path)"
                legs_c = pg.leg_rows(bare)
                c_rec["hips_after"] = hip_profile(c_mask, proxy_q, bare, legs_c, kind=kind, short_px=max(1, int(round(qa["thresholds"]["hip_short_frac"] * h))))
                conformed = c_rec
            label = eng or "still"
            cands.append({
                "id": label,
                "engine": label.partition("@")[0],
                "seed": int(label.partition("@")[2]) if "@" in label else src_c.get("seed"),
                "raw": raw_rel,
                "garment_mask": mask_rel,
                "garment_mask_unclipped": unclipped_rel if os.path.exists(p(unclipped_rel)) else f"{mask_rel} (no unclipped mask: used as is)",
                "candidate_colour": garment_colour(raw, garment),
                "qa": qa,
                "composite_mask": comp if rebuild else None,
                "conform_replay": conformed,
                "conform_edges": comp.get("conform_edges") if rebuild else None,
                # stage1b-qa-0.12.0: the same key as the GPU app's candidate record (stage1_dress.dress)
                "strands": comp.get("strands") if rebuild else None,
            })
            arrays[label] = (raw, garment)
            if stills_dir:
                # The replayed composite (our bare render with the garment pasted), to look at: <stills_dir>/<view>_<engine>.png
                from PIL import Image

                os.makedirs(stills_dir, exist_ok=True)
                Image.fromarray(np.where(garment[..., None], raw, bare_rgb).astype(np.uint8)).save(os.path.join(stills_dir, f"{stem}.png"))
                Image.fromarray(garment.astype(np.uint8) * 255).save(os.path.join(stills_dir, f"{stem}_mask.png"))
                cands[-1]["replayed_still"] = os.path.join(stills_dir, f"{stem}.png")
                cands[-1]["replayed_mask"] = os.path.join(stills_dir, f"{stem}_mask.png")
        out["views"][name] = {
            "proxy_mask": proxy_rel,
            "edit_region": region_rec,
            "mannequin_grey": grey_collision(bare_rgb, bare),
            "candidates": cands,
        }
        all_arrays[name] = arrays
    bv = next(v for v in spec["views"] if v["view"] == "back")
    real_back = not bv.get("invented") and "back" in src
    pair_mode = any("@" in c["id"] for vv in out["views"].values() for c in vv["candidates"])
    decisions: dict[str, dict[str, Any]] = {}
    if pair_mode and {"front", "back"} <= set(out["views"]):
        fr, bk = out["views"]["front"]["candidates"], out["views"]["back"]["candidates"]
        shop_f, shop_b = shops.get("front"), (shops.get("back") if real_back else None)
        checks = {}
        for f in fr:
            for b in bk:
                if f["id"] in all_arrays["front"] and b["id"] in all_arrays["back"]:
                    checks[(f["id"], b["id"])] = pair_checks(all_arrays["front"][f["id"]], all_arrays["back"][b["id"]], f["qa"], b["qa"], shop_f, shop_b)
        pp = pick_pair(fr, bk, checks)
        out["pairs"] = pp
        for name, side in (("front", fr), ("back", bk)):
            d = pick_engine(side)
            if pp[name] is not None:
                c = next(x for x in side if x["id"] == pp[name])
                d = {**d, "engine": c["engine"], "candidate": c["id"], "rejected_still": None, "reason": f"pair: {pp['reason']}"}
            decisions[name] = d
        if pp["front"] is None:
            decisions["back"] = pick_engine(bk, prefer=decisions["front"].get("engine"))
    for name in out["views"]:
        if name not in decisions:
            decisions[name] = pick_engine(out["views"][name]["candidates"], prefer=decisions.get("front", {}).get("engine") if name == "back" else None)
        decision = decisions[name]
        shown = shown_candidate(decision)
        out["views"][name]["selection"] = decision
        out["views"][name]["qa"] = next(c["qa"] for c in out["views"][name]["candidates"] if c["id"] == shown) if shown else None
        if shown:
            picked[name] = all_arrays[name][shown]
    if real_back and {"front", "back"} <= set(shops) and {"front", "back"} <= set(picked):
        (sf, sfm), (sb, sbm) = shops["front"], shops["back"]
        out["back_view"] = back_view_checks(picked["front"][0], picked["front"][1], picked["back"][0], picked["back"][1], sf, sfm, sb, sbm)
        out["back_view"]["note"] = "the picked (or shown-as-rejected) front and back candidates, whether or not the front passed"
        bq0 = out["views"]["back"].get("qa")
        if bq0 is not None and out["back_view"]["failures"]:
            # as the app does (stage1_dress.dress): a back that reads as a front fails the back still (since 0.10.0 in the replay too)
            bq0["failures"] = list(bq0.get("failures") or []) + [f"back view: {f}" for f in out["back_view"]["failures"]]
            bq0["pass"] = False
    else:
        out["back_view"] = {"pass": None, "failures": [], "note": "not checked: invented back, no shop segmentation or no picked still"}
    fq, bq = (out["views"].get(n, {}).get("qa") for n in ("front", "back"))
    out["view_agreement"] = view_agreement((fq or {}).get("garment_body"), (bq or {}).get("garment_body"))
    apply_view_agreement(bq, out["view_agreement"])
    if {"front", "back"} <= set(picked):
        out["view_colour"] = view_colour(picked["front"], picked["back"], shops.get("front"), shops.get("back") if not bv.get("invented") else None)
        apply_view_colour(bq, out["view_colour"])
    else:
        out["view_colour"] = {"pass": None, "failures": [], "note": "not checked: a view has no picked still"}
    return out


RECOMPOSE_LABEL = ("RECOMPOSED on CPU from an earlier stage 1b run's saved engine outputs (no engine was run again): the composite, the "
                   "conforms and the QA of the current version on the same raw stills, so a later stage 2 pins stills that were reviewed")


def write_stills(job_dir: str, manifest: Mapping[str, Any], scored: Mapping[str, Any], *, accept_failed: bool) -> list[dict[str, Any]]:
    """The pinned stills from a `rescore_job(path="app", stills_dir=...)` result, as `stage1_dress.dress` writes them: per view our
    bare render with the shown candidate pasted goes to the manifest's still path when its QA passes (or with `accept_failed`;
    a type failure still stops stage 2 in `run_phase0._dress_gate`), else to `rejected/`; an earlier still is removed first.
    Records the file and pixel sha256 of each still. Returns the view records."""
    import hashlib
    import shutil

    from PIL import Image

    import phase0_lib as lib

    out_dir = os.path.join(job_dir, lib.STAGE1B_DIR)
    views = []
    for v in manifest["stage1b"]["views"]:
        name = v["view"]
        sv = scored["views"][name]
        sel = sv["selection"]
        shown = shown_candidate(sel)
        cand = next((c for c in sv["candidates"] if c["id"] == shown), None)
        still_path = os.path.join(job_dir, v["still"])
        if os.path.exists(still_path):
            os.remove(still_path)  # never leave the earlier run's still behind
        rec: dict[str, Any] = {"view": name, "frame": v["frame"], "invented": v.get("invented", False), "engine": None if cand is None else cand["engine"],
                               "candidate": shown, "selection": sel, "qa": None if cand is None else cand["qa"], "candidates": sv["candidates"]}
        if cand is not None:
            qa = cand["qa"]
            img = Image.open(cand["replayed_still"]).convert("RGB")
            if qa["pass"] or accept_failed:
                img.save(still_path)
                shutil.copyfile(cand["replayed_mask"], os.path.join(job_dir, v["garment_mask"]))
                rec["still"] = v["still"]
                with open(still_path, "rb") as f:
                    rec["still_sha256"] = hashlib.sha256(f.read()).hexdigest()
                arr = np.asarray(img)
                rec["still_pixel_sha256"] = lib.pixel_sha256(arr.tobytes(), arr.shape[1], arr.shape[0])
                rec["qa_overridden"] = not qa["pass"]
            else:
                os.makedirs(os.path.join(out_dir, "rejected"), exist_ok=True)
                rej = f"{lib.STAGE1B_DIR}/rejected/{name}.png"
                img.save(os.path.join(job_dir, rej))
                rec["still"] = None
                rec["rejected"] = rej
        else:
            rec["qa"] = {"pass": False, "failures": ["no candidate to show"], "type_failures": []}
        views.append(rec)
    return views


# What a draw plan's record carries over from the GPU part into the finished record, and through a later recompose.
_RECOMPOSE_KEYS = ("stage", "job_id", "input_hash", "engine", "engines", "models", "seed", "steps", "category", "tryon_category", "proxy_kind",
                   "target", "source_kind", "invented_back", "cost")
_PLAN_KEYS = ("gpu_name", "load_seconds", "plan", "kept", "archived", "prompt_version", "colour_phrases")
_RUN_KEYS = _RECOMPOSE_KEYS + _PLAN_KEYS


def recompose_job(job_dir: str, manifest: Mapping[str, Any], *, pins: Mapping[str, str] | None = None, accept_failed: bool = False) -> dict[str, Any]:
    """Re-make a finished stage 1b job's pinned stills with the CURRENT composite and QA from its saved raw engine outputs
    (stage1b-qa-0.10.0, run 16b): `rescore_job(path="app")` per view (only the `pins` candidate when given), then `write_stills`.
    The masks and record.json are rewritten; the run's own record is kept as `record.before_recompose.json`.
    Refuses a job whose stage 1b record was made for other inputs (input_hash)."""
    import json
    import shutil

    import phase0_lib as lib

    out_dir = os.path.join(job_dir, lib.STAGE1B_DIR)
    rec_path = os.path.join(out_dir, "record.json")
    if not os.path.exists(rec_path):
        raise FileNotFoundError(f"{rec_path}: no stage 1b run to recompose (run stage 1b first)")
    with open(rec_path, encoding="utf-8") as f:
        before = json.load(f)
    if before.get("input_hash") != manifest.get("input_hash"):
        raise ValueError(f"stage 1b record is for input_hash {before.get('input_hash')!r}, the manifest has {manifest.get('input_hash')!r}: not the same job")
    keep = os.path.join(out_dir, "record.before_recompose.json")
    if not os.path.exists(keep):
        shutil.copyfile(rec_path, keep)
    else:
        with open(keep, encoding="utf-8") as f:
            before = json.load(f)  # recomposing twice starts from the GPU run's record, not from the last recompose
    stills_tmp = os.path.join(out_dir, "recomposed")
    scored = rescore_job(job_dir, manifest, path="app", stills_dir=stills_tmp, pins=pins)
    spec = manifest["stage1b"]
    views = write_stills(job_dir, manifest, scored, accept_failed=accept_failed)
    _merge_provenance(views, before)
    record = {k: before.get(k) for k in _RECOMPOSE_KEYS}
    record.update({k: before[k] for k in _PLAN_KEYS if k in before})
    record.update({
        "qa_version": STAGE1B_QA_VERSION,
        "recomposed": {"from_qa_version": before.get("qa_version"), "pins": dict(pins or {}), "accept_failed": accept_failed,
                       "mask_basis": scored["mask_basis"], "label": RECOMPOSE_LABEL},
        "views": views,
        "back_view": scored["back_view"],
        "view_agreement": scored["view_agreement"],
        "view_colour": scored.get("view_colour"),
        "summary": lib.stage1b_summary(views, invented_back=bool(spec.get("invented_back"))),
        "label": lib.STAGE1B_LABEL,
    })
    if "pairs" in scored:
        record["pairs"] = scored["pairs"]
    with open(rec_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    return record


def _merge_provenance(views: list[dict[str, Any]], run_record: Mapping[str, Any]) -> None:
    """Adds what the GPU part recorded about each candidate (seed, steps, prompt, method, pose, the FASHN agnostic image, a kept
    candidate's origin) to the scored candidate records, matched by id; also the view's shop segmentation and edit region."""
    by_view = {r.get("view"): r for r in run_record.get("views") or []}
    for v in views:
        rv = by_view.get(v["view"]) or {}
        for k in ("source", "source_segmentation", "edit_region", "mannequin_grey", "target", "colour_phrase"):
            if k in rv and k not in v:
                v[k] = rv[k]
        drawn = {cid(c): c for c in rv.get("candidates") or [] if c.get("id") or c.get("engine")}
        for c in v["candidates"]:
            d = drawn.get(c["id"])
            if not d:
                continue
            c["drawn"] = {k: d[k] for k in ("seed", "steps", "method", "prompt", "negative_prompt", "prompt_version", "colour_phrase", "pose", "agnostic",
                                             "model_output_size", "mask_source", "sam_score", "sam_prior_iou", "seconds", "kept", "error") if k in d}


# --- run 17a: archive the earlier run, keep a view from it, finish a draw plan ------------------------------------------


def archive_stage1b(out_dir: str, stamp: str) -> str | None:
    """Moves everything in a job's stage1b/ except history/ into stage1b/history/<stamp>/ (stage1b-qa-0.11.0). A new stage 1b run
    starts clean: run 16a left no stale candidates of another engine or seed for a later replay to pick up (a qwen-only run after
    a both-engine run kept FASHN's files), and the earlier run stays in the Volume to keep a view from and to audit. Returns the
    history directory relative to `out_dir`, or None when there was nothing to move."""
    import shutil

    if not os.path.isdir(out_dir):
        return None
    names = [n for n in sorted(os.listdir(out_dir)) if n != "history"]
    if not names:
        return None
    rel = os.path.join("history", stamp)
    dest = os.path.join(out_dir, rel)
    k = 1
    while os.path.exists(dest):
        k += 1
        rel = os.path.join("history", f"{stamp}-{k}")
        dest = os.path.join(out_dir, rel)
    os.makedirs(dest)
    for n in names:
        shutil.move(os.path.join(out_dir, n), os.path.join(dest, n))
    return rel


def find_kept(out_dir: str, view: str, engine: str, seed: int | None, input_hash: str, *, include_current: bool = True) -> dict[str, Any]:
    """The candidate a draw plan keeps (`keep:<engine>[@seed]`): the newest earlier stage 1b run of THIS job (same input_hash) in
    `out_dir` (when `include_current`) or `out_dir/history/*` whose record lists a candidate of `view` by `engine` (and `seed`)
    without an error, with its raw output and garment mask on disk. Raises FileNotFoundError naming what was looked at, and
    ValueError when no seed is given and that run has more than one candidate of `engine` for `view` (keep:<engine>@<seed>)."""
    import json

    import phase0_lib as lib

    dirs = [""] if include_current else []
    hist = os.path.join(out_dir, "history")
    if os.path.isdir(hist):
        dirs += [os.path.join("history", n) for n in sorted(os.listdir(hist), reverse=True)]
    looked = []
    for rel in dirs:
        d = os.path.join(out_dir, rel)
        rp = os.path.join(d, "record.json")
        if os.path.exists(os.path.join(d, "record.before_recompose.json")):
            rp = os.path.join(d, "record.before_recompose.json")  # the engine run's record names how its masks were made
        if not os.path.exists(rp):
            looked.append(f"{rel or '.'}: no record")
            continue
        with open(rp, encoding="utf-8") as f:
            rec = json.load(f)
        if rec.get("input_hash") != input_hash:
            looked.append(f"{rel or '.'}: input_hash {str(rec.get('input_hash'))[:12]}")
            continue
        for v in rec.get("views") or []:
            if v.get("view") != view:
                continue
            if seed is None:  # a seedless keep names one candidate only when that run drew one of the engine for the view
                seeds = [c.get("seed", rec.get("seed")) for c in v.get("candidates") or [] if c.get("engine") == engine and "error" not in c]
                if len(seeds) > 1:
                    raise ValueError(f"keep:{engine} for the {view} is ambiguous: {rel or '.'} has {len(seeds)} {engine} candidates "
                                     f"(seeds {', '.join(str(x) for x in seeds)}); name the reviewed one as keep:{engine}@<seed>")
            for c in v.get("candidates") or []:
                if c.get("engine") != engine or "error" in c:
                    continue
                c_seed = c.get("seed", rec.get("seed"))
                if seed is not None and c_seed != seed:
                    continue
                stem = lib.candidate_stem(view, cid(c))
                if not (os.path.exists(os.path.join(d, "raw", f"{stem}.png")) and os.path.exists(os.path.join(d, "candidates", f"{stem}_garment_mask.png"))):
                    looked.append(f"{rel or '.'}: {stem} files missing")
                    continue
                return {"dir": rel, "stem": stem, "engine": engine, "seed": None if c_seed is None else int(c_seed), "qa_version": rec.get("qa_version"),
                        "candidate": c, "steps": (rec.get("steps") or {}).get(engine) if isinstance(rec.get("steps"), Mapping) else rec.get("steps")}
        looked.append(f"{rel or '.'}: no {view} {engine}{'' if seed is None else f'@{seed}'} candidate")
    raise FileNotFoundError(f"keep:{engine}{'' if seed is None else f'@{seed}'} for the {view}: no earlier stage 1b run of this job has it ({'; '.join(looked) or 'nothing in ' + out_dir})")


def import_kept(job_dir: str, manifest: Mapping[str, Any], view: str, found: Mapping[str, Any]) -> dict[str, Any]:
    """Copies a kept candidate (`find_kept`, from stage1b/history/) into this run's stage1b/ under its plan name
    (`<view>_<engine>_s<seed>`) and saves its chosen mask (rebuilt from that run's files by `chosen_mask_from_saved`, the replay's
    rule), so the finalize scores it with the CURRENT QA and pairs it like a new draw. Nothing is redrawn and nothing passes
    unchecked. Returns the candidate's draw record (id, engine, seed, kept: origin, then-QA version, chosen-mask basis)."""
    import shutil

    import phase0_lib as lib

    out = os.path.join(job_dir, lib.STAGE1B_DIR)
    src = os.path.join(out, found["dir"])
    if found["seed"] is None:
        raise ValueError(f"keep {view} {found['engine']}: the earlier run records no seed, so the candidate cannot be named")
    new_id = lib.candidate_id(found["engine"], found["seed"])
    stem = lib.candidate_stem(view, new_id)
    v = next(x for x in manifest["stage1b"]["views"] if x["view"] == view)
    spec = manifest["stage1b"]
    kind = ((manifest.get("control") or {}).get("proxy") or {}).get("kind") or (spec.get("target") or {}).get("proxy_kind") or manifest["category"]
    tryon_cat = lib.tryon_category(manifest["category"])
    bare = _read_mask(os.path.join(job_dir, v["bare_mask"]))
    proxy = _read_mask(os.path.join(job_dir, v.get("proxy_mask") or f"{manifest['control']['proxy_mask_dir']}/{int(v['frame']):04d}.png"))
    gap = trouser_gap_zone(proxy, bare) if kind == "trousers" else None
    region, _ = edit_region(proxy, bare, tryon_cat, keep_open=kind == "outerwear", open_crotch=gap)
    target = _read_rgb(os.path.join(job_dir, v["proxy_rgb"])) if v.get("proxy_rgb") else None
    os.makedirs(os.path.join(out, "raw"), exist_ok=True)
    os.makedirs(os.path.join(out, "candidates"), exist_ok=True)
    copied = []
    for sub, suffix in (("raw", ""), ("candidates", "_garment_mask"), ("candidates", "_garment_mask_unclipped"), ("candidates", "_conformed"),
                        ("candidates", "_chosen_mask"), ("candidates", "_fashn_agnostic")):
        a = os.path.join(src, sub, f"{found['stem']}{suffix}.png")
        if os.path.exists(a):
            shutil.copyfile(a, os.path.join(out, sub, f"{stem}{suffix}.png"))
            copied.append(f"{sub}/{stem}{suffix}.png")
    c = found["candidate"]
    raw_engine = _read_rgb(os.path.join(out, "raw", f"{stem}.png"))
    saved = _read_mask(os.path.join(out, "candidates", f"{stem}_garment_mask.png"))
    chosen, basis = chosen_mask_from_saved(raw_engine, saved, region, chosen_path=os.path.join(out, "candidates", f"{stem}_chosen_mask.png"),
                                           conformed_path=os.path.join(out, "candidates", f"{stem}_conformed.png"),
                                           app_saved=_version_at_least(found.get("qa_version"), (0, 8, 0)), mask_source=c.get("mask_source"), target=target,
                                           bg=tuple(spec["background_rgb"]))
    _save_mask(chosen, os.path.join(out, "candidates", f"{stem}_chosen_mask.png"))
    rec = {k: c[k] for k in ("method", "prompt", "negative_prompt", "pose", "agnostic", "model_output_size", "mask_source", "sam_score", "sam_prior_iou") if k in c}
    rec.update({"id": new_id, "engine": found["engine"], "seed": found["seed"], "steps": found.get("steps"),
                "kept": {"from": f"{lib.STAGE1B_DIR}/{found['dir']}", "stem_then": found["stem"], "qa_version": found.get("qa_version"),
                         "qa_pass_then": (c.get("qa") or {}).get("pass"), "chosen_mask_basis": basis, "files": copied,
                         "note": "kept from an earlier run of this job: not redrawn; scored and paired with the current QA like a new draw"}})
    return rec


def _save_mask(mask: np.ndarray, path: str) -> None:
    from PIL import Image

    Image.fromarray(np.asarray(mask, dtype=bool).astype(np.uint8) * 255).save(path)


FINALIZE_LABEL = ("draw plan: every candidate scored on CPU from its saved files with the app's composite and QA (rescore_job, path app), the front/back "
                  "pair picked by pick_pair; the GPU part only drew and saved the candidates")


def finalize_draws(job_dir: str, manifest: Mapping[str, Any], *, accept_failed: bool = False) -> dict[str, Any]:
    """The second half of a draw-plan run (stage1b-qa-0.11.0, run 17a): stage1_dress.dress drew every candidate of the plan and
    saved its files and a draw record (record.json, `finalized: false`); here each candidate is scored with the same code a
    replay uses, the pair is picked (`pick_pair`), and the stills, masks and the finished record.json are written
    (`write_stills`). One code path for the run and its replay; a CPU function on Modal (stage1_dress.finalize)."""
    import json

    import phase0_lib as lib

    out_dir = os.path.join(job_dir, lib.STAGE1B_DIR)
    rec_path = os.path.join(out_dir, "record.json")
    with open(rec_path, encoding="utf-8") as f:
        drawn = json.load(f)
    if drawn.get("input_hash") != manifest.get("input_hash"):
        raise ValueError(f"stage 1b record is for input_hash {drawn.get('input_hash')!r}, the manifest has {manifest.get('input_hash')!r}")
    if not drawn.get("plan"):
        raise ValueError("finalize_draws: this stage 1b record is not a draw plan's (no `plan`); use recompose_job")
    empty = [v["view"] for v in manifest["stage1b"]["views"] if not candidate_entries(job_dir, v["view"])]
    if empty:
        # every draw of a view failed (the GPU part recorded why): nothing to score; the record says so and stage 2 cannot start
        why = {v.get("view"): v.get("error") or "; ".join(c.get("error", "") for c in v.get("candidates") or []) for v in drawn.get("views") or []}
        views = [{"view": v["view"], "candidate": None, "still": None, "candidates": next((x.get("candidates") for x in drawn.get("views") or [] if x.get("view") == v["view"]), []),
                  "qa": {"pass": False, "failures": [f"no candidate to score: {why.get(v['view']) or 'no draw saved'}"] if v["view"] in empty else ["the other view has no candidate: no pair"],
                         "type_failures": []}} for v in manifest["stage1b"]["views"]]
        record = {k: drawn[k] for k in _RUN_KEYS if k in drawn}
        record.update({"qa_version": STAGE1B_QA_VERSION, "finalized": {"label": FINALIZE_LABEL, "error": f"no candidate for {', '.join(empty)}"}, "views": views,
                       "summary": lib.stage1b_summary(views, invented_back=bool(manifest["stage1b"].get("invented_back"))), "label": lib.STAGE1B_LABEL})
        with open(rec_path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2)
        return record
    scored = rescore_job(job_dir, manifest, path="app", stills_dir=os.path.join(out_dir, "candidates", "stills"))
    views = write_stills(job_dir, manifest, scored, accept_failed=accept_failed)
    _merge_provenance(views, drawn)
    record = {k: drawn[k] for k in _RUN_KEYS if k in drawn}
    record.update({
        "qa_version": STAGE1B_QA_VERSION,
        "finalized": {"label": FINALIZE_LABEL, "mask_basis": scored["mask_basis"]},
        "views": views,
        "pairs": scored.get("pairs"),
        "back_view": scored["back_view"],
        "view_agreement": scored["view_agreement"],
        "view_colour": scored.get("view_colour"),
        "summary": lib.stage1b_summary(views, invented_back=bool(manifest["stage1b"].get("invented_back"))),
        "accept_failed": accept_failed,
        "label": lib.STAGE1B_LABEL,
    })
    with open(rec_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    return record


def apply_view_agreement(back_qa: dict[str, Any] | None, agreement: Mapping[str, Any]) -> None:
    """A failed `view_agreement` fails the back still as a TYPE failure (listed in `type_failures`, so
    `--accept-failed-dress` never overrides it and `run_phase0` stops before stage 2)."""
    if back_qa is None or not agreement.get("failures"):
        return
    fs = [f"views disagree: {f}" for f in agreement["failures"]]
    back_qa["failures"] = list(back_qa.get("failures") or []) + fs
    back_qa["type_failures"] = list(back_qa.get("type_failures") or []) + fs
    back_qa["pass"] = False


def apply_view_colour(back_qa: dict[str, Any] | None, colour: Mapping[str, Any]) -> None:
    """A failed `view_colour` fails the back still (a hard failure, not a type failure: a colour, not a shape)."""
    if back_qa is None or not colour.get("failures"):
        return
    back_qa["failures"] = list(back_qa.get("failures") or []) + [f"views disagree: {f}" for f in colour["failures"]]
    back_qa["pass"] = False


def main(argv: Sequence[str] | None = None) -> int:
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Stage 1b QA v2 on a finished job's stills (CPU)")
    ap.add_argument("job_dir")
    ap.add_argument("--out", help="write the JSON here (default: print)")
    ap.add_argument("--path", choices=("app", "pasted"), default="app",
                    help="app (default): rebuild the composite as the current GPU app would; pasted: score the masks the run pasted")
    ap.add_argument("--stills", help="write each candidate's replayed composite here (<view>_<engine>.png), to look at")
    a = ap.parse_args(argv)
    with open(os.path.join(a.job_dir, "manifest.json"), encoding="utf-8") as f:
        m = json.load(f)
    rec = rescore_job(a.job_dir, m, path=a.path, stills_dir=a.stills)
    print(f"[stage1b-qa] {rec['version']} path {rec['path']}: {rec['mask_basis']}", file=sys.stderr)
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
    va = rec["view_agreement"]
    print(f"[stage1b-qa] views agree: {va.get('pass')} length gap {va.get('length_gap')} sleeve gap {va.get('sleeve_gap')} {va.get('failures')}", file=sys.stderr)
    for name, v in rec["views"].items():
        q = v.get("qa") or {}
        body = q.get("garment_body") or {}
        hp = q.get("hips") or {}
        print(f"[stage1b-qa] {name}: hips short {hp.get('short_rows')}/{hp.get('rows')} rows (median {hp.get('median_short_px')} px, max {hp.get('max_short_px')}, "
              f"mannequin beside {hp.get('body_exposed_px')} px)", file=sys.stderr)
        for c in v["candidates"]:
            cr = c.get("conform_replay")
            if cr:
                ha = cr.get("hips_after") or {}
                print(f"[stage1b-qa] {name}/{c['engine']} conform ({cr.get('basis')}): rows {cr['rows']} capped {cr['capped_rows']} +{cr['added_px']} px max stretch {cr['max_stretch']}; "
                      f"hips after: short {ha.get('short_rows')}/{ha.get('rows')} (median {ha.get('median_short_px')})", file=sys.stderr)
        up = q.get("unpasted") or {}
        print(f"[stage1b-qa] {name}: drawn but not pasted {up.get('px')} px ({up.get('frac')}, rows {up.get('rows')})", file=sys.stderr)
        print(f"[stage1b-qa] {name}: see-through {body.get('see_through')} body length {body.get('body_length')} sleeve cover {body.get('sleeve_cover')} "
              f"(sleeve share {body.get('sleeve_share')}); TYPE failures (never overridden): {q.get('type_failures')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
