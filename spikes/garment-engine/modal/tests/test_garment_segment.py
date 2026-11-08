"""Garment masks of generated frames, consistency v2 and stage 4's alpha targets (modal/phase0_garment.py).

Run from spikes/garment-engine/modal:  python -m pytest -q tests   (skips without numpy and Pillow)

tests/fixtures/run11a/ holds half-resolution (240x416) crops of the REAL stage 2 output of run 11a
(aalter-studio-2, proxy control, synthetic stills; no shop image): generated frames 0 and 80 (the pinned
front and back stills, so the synthetic garment mask is their truth) and 20, the job's own masks at those
cameras (bare mannequin rendered from mannequin.glb, control, proxy), the consistency reference (the pinned
stills carried to the camera through the visual hull), and run 10's frame 20, where the dress was drawn as
trousers with the product name above it. Frames 89 and 141 add run 10's borderline frames scored against the
same scene: 89 (9 frames past the back still) passes the garment IoU (0.86 at full resolution) and is caught
only by the skirt-zone cover; 141 is where the leg-gap check fires (13 gap rows at full resolution, the most
in run 10). Run 11a's own frames 89 and 141 pass.
"""
import json
import os
import sys

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("PIL")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import phase0_garment as pg  # noqa: E402
import phase0_lib as lib  # noqa: E402

RUN11 = os.path.join(HERE, "fixtures", "run11a")
# Pixel parameters are for 480x832 frames; the fixtures are half that.
HALF = {"envelope_px": 20, "speck_frac": 0.02}


def rgb(name):
    return pg._read_rgb(os.path.join(RUN11, name))


def mask(name):
    return pg._read_mask(os.path.join(RUN11, name))


def segment(frame, image=None):
    i = f"{frame:04d}"
    prox = mask(f"proxy_{i}.png")
    return pg.segment_garment(rgb(image or f"generated_{i}.png"), mask(f"bare_{i}.png"), mask(f"control_{i}.png") | prox, prox, HALF)


# --- segmentation -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("frame", [0, 80])
def test_pinned_frames_of_run_11a_match_the_synthetic_truth(frame):
    """Frames 0 and 80 are the pinned synthetic stills: their garment mask is known. Cream (#F2EBDD) on the
    light-grey studio: the first metric's border-colour foreground lost a quarter of it."""
    g, info = segment(frame)
    truth = mask(f"truth_{frame:04d}.png")
    assert pg.iou(g, truth) >= 0.95
    assert not info["ambiguous_with_mannequin"]
    assert info["mannequin"]["chroma_max"] <= 14  # grey mannequin sampled from the head
    assert info["stray_px"] == 0


def test_the_first_metric_lost_the_cream_dress_the_new_one_finds_it():
    """Consistency v1 flagged frame 0 (the pinned still itself) with silhouette IoU 0.74 in run 11a."""
    frame = rgb("generated_0000.png")
    h, w = frame.shape[:2]
    fg_v1 = np.frombuffer(lib.frame_foreground(np.ascontiguousarray(frame).tobytes(), w, h), dtype=np.uint8).reshape(h, w).astype(bool)
    truth = mask("truth_0000.png")
    g, _ = segment(0)
    # v1's foreground includes the mannequin; even against garment + mannequin it misses the light garment.
    assert pg.iou(fg_v1, truth | mask("bare_0000.png")) < 0.85
    assert pg.iou(g, truth) > pg.iou(fg_v1 & ~(mask("bare_0000.png") & ~truth), truth) + 0.1


def test_a_light_garment_on_the_light_background_is_found_on_the_body():
    """Inside our bare silhouette nothing is background: a garment 3 levels off the background is found."""
    h, w = 120, 80
    img = np.full((h, w, 3), 236, np.uint8)
    bare = np.zeros((h, w), bool)
    bare[10:110, 30:50] = True  # the body
    img[bare] = (115, 115, 115)  # grey mannequin
    garment = np.zeros((h, w), bool)
    garment[30:80, 28:52] = True  # 2 px wider than the body on each side
    img[garment] = (239, 236, 233)  # nearly the background colour
    g, info = pg.segment_garment(img, bare, garment | bare, garment, {"envelope_px": 6})
    # The outer 2 px of the body (aliasing, small misalignment) and the garment off the body need
    # background evidence, which 3 levels are not: there it is missed, never invented.
    inner = pg.erode(bare, 2)
    assert pg.iou(g & inner, garment & inner) > 0.95
    assert not (g & ~garment).any()


def test_a_hand_in_front_of_the_skirt_stays_mannequin_and_shaded_garment_stays_garment():
    h, w = 120, 80
    img = np.full((h, w, 3), 236, np.uint8)
    bare = np.zeros((h, w), bool)
    bare[5:115, 30:50] = True
    img[bare] = (110, 110, 110)
    proxy = np.zeros((h, w), bool)
    proxy[30:90, 26:54] = True
    img[proxy] = (225, 215, 195)
    img[50:60, 36:44] = (120, 119, 116)  # shaded fold inside the proxy: grey, reads as mannequin colour
    hand = np.zeros((h, w), bool)
    hand[70:80, 35:45] = True
    img[hand] = (100, 100, 100)  # the hand our control shows in front of the proxy
    g, _ = pg.segment_garment(img, bare, proxy | bare, proxy & ~hand, {"envelope_px": 6})
    assert g[55, 40]  # the fold is filled
    assert not g[hand].any()


def test_glb_reader_matches_stage4b(tmp_path):
    import stage4b_retexture as s4b

    pos = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
    faces = [(0, 1, 2), (0, 2, 3), (0, 3, 1)]
    data = s4b.write_glb(pos, faces)
    P, F = pg.read_glb_mesh(data)
    ref = s4b.read_glb(data)
    assert np.allclose(P, np.asarray(ref["positions"]))
    assert (F == np.asarray(ref["faces"])).all()


def test_components_holes_and_reconstruction():
    m = np.zeros((10, 10), bool)
    m[1:5, 1:5] = True
    m[2:4, 2:4] = False  # a hole
    m[7:9, 7:9] = True
    lab, n = pg.label(m)
    assert n == 2
    filled = pg.fill_holes(m, 10)
    assert filled[2:4, 2:4].all()
    assert not pg.fill_holes(m, 3)[2:4, 2:4].any()  # hole of 4 px > 3
    seed = np.zeros_like(m)
    seed[8, 8] = True
    assert pg.keep_touching(m, seed).sum() == 4
    assert pg.drop_small(m, 0.5).sum() == 12


# --- consistency v2 -------------------------------------------------------------------------------------


def test_run_11a_frame_20_passes_and_run_10_frame_20_is_flagged():
    ref, bare = mask("reference_0020.png"), mask("bare_0020.png")
    good, _ = segment(20)
    row = {"garment_px": int(good.sum()), **pg.frame_garment_consistency(good, ref, bare, kind="dress", reference_kind="pinned hull")}
    assert row["garment_iou"] > 0.85
    assert pg.garment_flags(row, "dress") == []

    bad, info = segment(20, "run10_generated_0020.png")
    row = {"garment_px": int(bad.sum()), **pg.frame_garment_consistency(bad, ref, bare, kind="dress", reference_kind="pinned hull"),
           "stray_frac": info["stray_px"] / bad.size}
    flags = pg.garment_flags(row, "dress")
    assert any("IoU" in f for f in flags), flags
    # The product name above the mannequin is reported as an artefact, apart from garment drift.
    assert pg.artefact_flags(row)


T_HALF = pg.scaled_thresholds(416)


def score(frame, image=None, kind="dress"):
    i = f"{frame:04d}"
    g, info = segment(frame, image)
    row = {"garment_px": int(g.sum()), **pg.frame_garment_consistency(g, mask(f"reference_{i}.png"), mask(f"bare_{i}.png"), kind=kind, reference_kind="pinned hull", envelope_out_px=int(T_HALF["envelope_out_px"]))}
    return row, pg.garment_flags(row, kind, T_HALF)


@pytest.mark.parametrize("frame", [20, 89, 141])
def test_run_11a_frames_pass_with_margin(frame):
    row, flags = score(frame)
    assert flags == []
    assert row["skirt_cover"] >= 0.95  # run 11a min 0.962 over 98 frames at full resolution; threshold 0.90
    assert row["leg_gap_rows"] <= 1


def test_borderline_run_10_frame_89_passes_the_iou_and_is_caught_by_the_skirt_zone():
    """Run 10 frame 89: trousers with touching legs 9 frames past the back still. Its garment IoU passes the
    0.82 threshold and there is no background gap between the legs, which is how v2 missed such frames."""
    row, flags = score(89, "run10_generated_0089.png")
    assert row["garment_iou"] >= pg.CONSISTENCY_V2_THRESHOLDS["min_garment_iou"]
    assert row["leg_gap_rows"] == 0
    assert row["skirt_zone_rows"] >= T_HALF["min_skirt_zone_rows"]
    assert row["skirt_cover"] < 0.85
    assert len(flags) == 1 and flags[0].startswith("skirt zone covered"), flags


def test_leg_gap_check_fires_on_run_10_frame_141():
    """The leg-gap threshold was a share of all leg rows (15%) and never fired on run 10 (at most 13 of
    about 190 rows); now an absolute count and a share of the skirt zone (crotch to the reference hem)."""
    row, flags = score(141, "run10_generated_0141.png")
    assert row["leg_gap_rows"] >= T_HALF["min_leg_gap_rows"]
    assert any(f.startswith("gap between the legs") for f in flags), flags
    old = {**row, "leg_zone_rows": 95}  # the old rule: >15% of the leg rows and >= 3 rows
    assert not (old["leg_gap_rows"] >= 3 and old["leg_gap_rows"] / old["leg_zone_rows"] > 0.15)


def test_thresholds_scale_with_the_frame_and_keep_overrides():
    full = pg.scaled_thresholds(832)
    assert full == pg.CONSISTENCY_V2_THRESHOLDS
    assert T_HALF["min_skirt_zone_rows"] == 10 and T_HALF["min_leg_gap_rows"] == 2 and T_HALF["envelope_out_px"] == 6
    assert pg.scaled_thresholds(416, {"min_leg_gap_rows": 4})["min_leg_gap_rows"] == 4
    assert T_HALF["min_skirt_cover"] == full["min_skirt_cover"]


def test_motion_flags_a_garment_larger_than_the_posed_proxy():
    """The posed proxy is an envelope: the garment must cover it AND stay inside it (dilated). Run 11a's
    motion clip passed every frame on cover alone although garment_inside fell to 0.36 (scale jump at
    j=0-3, blocks at the feet merged into the garment)."""
    h, w = 200, 100
    bare = np.zeros((h, w), bool)
    bare[10:190, 40:60] = True
    proxy = np.zeros((h, w), bool)
    proxy[40:110, 30:70] = True  # a knee dress
    maxi = np.zeros((h, w), bool)
    maxi[40:185, 28:72] = True  # drawn as a maxi: covers the proxy, but much is outside it
    row = {"garment_px": int(maxi.sum()), **pg.frame_garment_consistency(maxi, proxy, bare, kind="top", reference_kind="proxy envelope", envelope_out_px=3)}
    assert row["reference_cover"] == 1.0
    flags = pg.garment_flags(row, "top")
    assert any("outside the posed proxy envelope" in f for f in flags), flags
    same = proxy.copy()
    same[40:112, 29:71] = True  # 2 px wider and longer: inside the dilated envelope
    row = {"garment_px": int(same.sum()), **pg.frame_garment_consistency(same, proxy, bare, kind="top", reference_kind="proxy envelope", envelope_out_px=3)}
    assert row["outside_envelope"] == 0.0 and pg.garment_flags(row, "top") == []


def test_reference_at_the_pinned_frame_is_the_still_and_frame_0_passes():
    ref = mask("reference_0000.png")
    g, _ = segment(0)
    assert pg.iou(g, ref) > 0.95


def test_leg_drift_checks_dress_and_trousers():
    h, w = 100, 60
    bare = np.zeros((h, w), bool)
    bare[5:50, 20:40] = True  # torso
    bare[50:95, 20:28] = True  # left leg
    bare[50:95, 32:40] = True  # right leg
    legs = pg.leg_rows(bare)
    assert legs is not None and legs[0] == 50
    skirt = np.zeros((h, w), bool)
    skirt[20:80, 16:44] = True
    trousers = np.zeros((h, w), bool)
    trousers[20:50, 18:42] = True
    trousers[50:80, 18:29] = True
    trousers[50:80, 31:42] = True
    as_trousers = {"garment_px": 1, **pg.frame_garment_consistency(trousers, skirt, bare, kind="dress", reference_kind="pinned hull")}
    assert as_trousers["leg_gap_rows"] == 30
    assert any("gap between the legs" in f for f in pg.garment_flags(as_trousers, "dress"))
    as_skirt = {"garment_px": 1, **pg.frame_garment_consistency(skirt, trousers, bare, kind="trousers", reference_kind="pinned hull")}
    assert as_skirt["merged_leg_rows"] == 30
    assert any("legs merged" in f for f in pg.garment_flags(as_skirt, "trousers"))
    # Side view: legs overlap, no leg rows, nothing to check.
    side = np.zeros((h, w), bool)
    side[5:95, 25:35] = True
    assert pg.leg_rows(side) is None


def test_thresholds_against_both_runs():
    """Measured on CPU at full resolution: run 11a (no drift) must pass, run 10's borderline frames that the
    garment IoU lets through must fail. One product: the margins are small and the values provisional."""
    t = pg.CONSISTENCY_V2_THRESHOLDS
    run11a = {"garment_iou_min": 0.8516, "envelope_cover_min": 0.8479, "skirt_cover_min": 0.9625, "leg_gap_max": 2}
    run10_iou_passes = {"a10": (0.8717, 0.875), "b89": (0.8558, 0.8139), "b93": (0.8324, 0.7824), "b95": (0.8207, 0.7683), "b142": (0.8271, 0.7979), "a68": (0.827, 0.7661)}
    assert t["min_garment_iou"] < run11a["garment_iou_min"] and t["min_envelope_cover"] < run11a["envelope_cover_min"]
    assert t["min_skirt_cover"] < run11a["skirt_cover_min"] and t["min_leg_gap_rows"] > run11a["leg_gap_max"]
    for name, (giou, cover) in run10_iou_passes.items():
        assert giou >= t["min_garment_iou"] and cover < t["min_skirt_cover"], name


def _flap_scene():
    """A front view at 1/4 scale: torso and legs, a skirt hull and a garment with a flap at the image-left hem."""
    h, w = 208, 120
    bare = np.zeros((h, w), bool)
    bare[10:110, 45:75] = True  # torso
    bare[110:200, 47:58] = True  # left leg
    bare[110:200, 62:73] = True  # right leg
    hull = np.zeros((h, w), bool)
    hull[40:130, 38:82] = True  # the pinned stills' hull: a skirt to row 130
    return bare, hull


def test_off_reference_counts_a_hem_flap_per_side_and_ignores_the_body():
    """Runs 16b/17b: a cream flap beside the hem at the image-left side, cloth the stills do not have. The
    garment IoU missed most of those frames; `off_reference` counts it, per image side, off our mannequin."""
    bare, hull = _flap_scene()
    t = pg.scaled_thresholds(208)
    margin = int(t["off_reference_margin_px"])
    assert margin == 2 and t["max_off_reference_px"] == 25 and t["off_reference_envelope_px"] == 2
    clean = hull.copy()
    row = {"garment_px": int(clean.sum()), **pg.frame_garment_consistency(clean, hull, bare, kind="dress", reference_kind="pinned hull"),
           **pg.off_reference(clean, hull, bare, margin_px=margin)}
    assert row["off_reference_px"] == 0 and pg.garment_flags(row, "dress", t) == []
    flap = hull.copy()
    flap[100:140, 22:38] = True  # beside and below the hem, image-left: 16 x 40, 2 px of it within the margin
    flap[60:80, 82:84] = True  # 2 px wider at the right hip: within the margin
    flap[130:150, 47:58] = True  # longer over the left leg: on the bare mannequin, not counted here (hem_offset_px)
    flap[5:20, 30:36] = True  # above the zone (shoulder height): not counted
    off = pg.off_reference(flap, hull, bare, margin_px=margin)
    assert off["off_reference_px"] == off["off_reference_left_px"] > 0 and off["off_reference_right_px"] == 0
    # The flap minus the 2 px margin around the hull (rows 100-131 / cols 22-35 and rows 132-139 / cols 22-37).
    assert off["off_reference_px"] == 32 * 14 + 8 * 16
    row = {"garment_px": int(flap.sum()), **pg.frame_garment_consistency(flap, hull, bare, kind="dress", reference_kind="pinned hull"), **off}
    flags = pg.garment_flags(row, "dress", t)
    assert any("off the pinned stills' hull" in f and "image-left" in f for f in flags), flags
    # Trousers and tops are not flagged on it (thresholds set on one dress); the count is still recorded.
    assert not any("off the pinned" in f for f in pg.garment_flags(row, "trousers", t))
    # Frames without the field (motion, records before 0.4.0) are unaffected.
    assert not any("off the pinned" in f for f in pg.garment_flags({k: v for k, v in row.items() if not k.startswith("off_reference")}, "dress", t))


def test_off_reference_spans_group_consecutive_frames_per_clip():
    def r(clip, j, px, left=None):
        return {"clip": clip, "j": j, "frame": j + (80 if clip == "turntable_b" else 0), "off_reference_px": px,
                "off_reference_left_px": px if left is None else left, "off_reference_right_px": px - (px if left is None else left)}
    rows = [r("turntable_a", 0, 0), r("turntable_a", 1, 500), r("turntable_a", 2, 900), r("turntable_a", 3, 10),
            r("turntable_a", 4, 700, left=100), r("turntable_b", 0, 600), r("turntable_b", 1, 800),
            {"clip": "motion", "j": 0, "frame": 0}]
    spans = pg.off_reference_spans(rows, 400)
    assert spans == [
        {"clip": "turntable_a", "j0": 1, "j1": 2, "frame0": 1, "frame1": 2, "frames": 2, "max_px": 900, "side": "image-left"},
        {"clip": "turntable_a", "j0": 4, "j1": 4, "frame0": 4, "frame1": 4, "frames": 1, "max_px": 700, "side": "image-right"},
        {"clip": "turntable_b", "j0": 0, "j1": 1, "frame0": 80, "frame1": 81, "frames": 2, "max_px": 800, "side": "image-left"},
    ]
    summary = pg.consistency_v2_summary([{**x, "flagged": False, "reasons": [], "drift_visible": True} for x in rows], kind="dress", thresholds=pg.scaled_thresholds(832))
    assert len(summary["off_reference_spans"]) == 3 and summary["per_clip"]["turntable_a"]["off_reference_px"]["max"] == 900
    assert summary["per_clip"]["motion"]["off_reference_px"] is None
    assert pg.consistency_v2_summary([], kind="trousers", thresholds=pg.scaled_thresholds(832))["off_reference_spans"] == []


def test_off_reference_thresholds_against_azure_palm_runs():
    """Measured on CPU on the azure palm baby-doll dress (480x832, hull carved with the 8 px envelope): run 15
    (small flap) at most 346 px outside its frames 139-140 (764: its own flap and background filled between
    the legs); runs 16b/17b over the threshold through turntable_b j18/20-78 (frames 98/100-158) and 17b's
    turntable_a 19-30. The margin on run 15 is about 54 px. With the
    4 px envelope of the IoU check every run read 900+ px at frames 1-8 (the stills' hem overhang carved off
    the hull next to the pin), so the check has its own looser hull. One product: provisional."""
    t = pg.CONSISTENCY_V2_THRESHOLDS
    # score_job on the clip frames (garment-consistency-0.4.0): run 15 outside b j59-60 at most 346 px (a j1,
    # image-right: the front still's hem against the hull next to the pin); b j60 764 px.
    run15_clean_max, run15_flap_frame = 346, 764
    run17b = {"a j20": 526, "a j24": 1020, "a j29": 2249, "b j18": 415, "b j24": 651, "b j40": 725, "b j60": 1237, "b j78": 420}
    run16b = {"b j20": 413, "b j40": 856, "b j52": 1490, "b j78": 438}
    assert run15_clean_max < t["max_off_reference_px"] < run15_flap_frame
    assert all(v > t["max_off_reference_px"] for v in [*run17b.values(), *run16b.values()])
    assert t["off_reference_envelope_px"] > pg.REFERENCE_DEFAULTS["envelope_px"]


# --- stage 4 alpha targets --------------------------------------------------------------------------------


def test_alpha_target_check_on_run_11a_pinned_frames(tmp_path):
    """The masks stage 4 trains on for run 11a, against the synthetic truth where it is the truth."""
    from PIL import Image

    job = tmp_path / "job"
    (job / "stage2" / "garment_mask").mkdir(parents=True)
    (job / "synthetic" / "garment_mask").mkdir(parents=True)
    for frame in (0, 80):
        g, _ = segment(frame)
        Image.fromarray((g * 255).astype(np.uint8)).save(job / "stage2" / "garment_mask" / f"{frame:04d}.png")
        Image.fromarray((mask(f"truth_{frame:04d}.png") * 255).astype(np.uint8)).save(job / "synthetic" / "garment_mask" / f"{frame:04d}.png")
    m = {"camera": {"frames": 160}, "synthetic": {"garment_mask_dir": "synthetic/garment_mask"},
         "photos": [{"role": "front", "synthetic": True}, {"role": "back", "synthetic": True}]}
    check = pg.alpha_target_check(str(job), m)
    assert set(check["pinned_iou"]) == {"0", "80"}
    assert min(check["pinned_iou"].values()) >= 0.95
    real = {**m, "photos": [{"role": "front", "synthetic": False}, {"role": "back", "synthetic": False}]}
    assert pg.alpha_target_check(str(job), real) is None


def _mask_job(tmp_path, ids=(0, 1, 2)):
    """A job dir with stage2/frames and a fake segmentation that writes masks + record like the real one."""
    from PIL import Image

    job = tmp_path / "job"
    (job / "stage2" / "frames").mkdir(parents=True)
    for i in ids:
        Image.fromarray(np.full((8, 8, 3), 10 * i, np.uint8)).save(job / "stage2" / "frames" / f"{i:04d}.png")
    calls = []

    def write(job_dir, manifest, *, frames_dir, out_dir):
        calls.append(frames_dir)
        os.makedirs(os.path.join(job_dir, out_dir), exist_ok=True)
        for i in ids:
            Image.fromarray(np.full((8, 8), 255 if i % 2 else 0, np.uint8)).save(os.path.join(job_dir, out_dir, f"{i:04d}.png"))
        rec = {"segmentation": pg.GARMENT_SEGMENT_VERSION, **pg.mask_set_hashes(job_dir, ids, frames_dir=frames_dir, out_dir=out_dir)}
        with open(os.path.join(job_dir, out_dir, pg.MASK_RECORD), "w") as f:
            json.dump(rec, f)
        return rec

    return job, list(ids), write, calls


def test_stage4_masks_are_reused_only_for_the_same_frames_and_segmentation(tmp_path):
    from PIL import Image

    job, ids, write, calls = _mask_job(tmp_path)
    first = pg.ensure_turntable_masks(str(job), {}, ids, write=write)
    assert first["computed_here"] and len(calls) == 1 and "no mask record" in first["reason"]
    again = pg.ensure_turntable_masks(str(job), {}, ids, write=write)
    assert not again["computed_here"] and len(calls) == 1
    assert again["record"]["frames_sha256"] == first["record"]["frames_sha256"]
    # Stage 2 re-run under the same job id (or --skip-video over other frames): the frames change.
    Image.fromarray(np.full((8, 8, 3), 99, np.uint8)).save(job / "stage2" / "frames" / "0001.png")
    stale = pg.ensure_turntable_masks(str(job), {}, ids, write=write)
    assert stale["computed_here"] and "frames changed" in stale["reason"]
    assert stale["record"]["frames_sha256"] != first["record"]["frames_sha256"]
    # An older segmentation version.
    rec_path = job / "stage2" / "garment_mask" / pg.MASK_RECORD
    rec = json.loads(rec_path.read_text())
    rec_path.write_text(json.dumps({**rec, "segmentation": "garment-segment-0.0.1"}))
    assert "segmentation garment-segment-0.0.1" in pg.ensure_turntable_masks(str(job), {}, ids, write=write)["reason"]
    # A mask edited after its record; masks without any record (written before the record existed).
    Image.fromarray(np.zeros((8, 8), np.uint8)).save(job / "stage2" / "garment_mask" / "0001.png")
    assert "masks changed" in pg.mask_record_check(str(job), ids)[1]
    rec_path.unlink()
    assert "no mask record" in pg.mask_record_check(str(job), ids)[1]


def test_write_turntable_masks_records_hashes(tmp_path):
    """The real writer on run 11a's pinned frame 0 (half resolution, bare and control given as masks)."""
    import shutil

    from PIL import Image

    job = tmp_path / "job"
    for d in ("stage2/frames", "control/mask", "control/proxy_mask", "control/bare_mask"):
        (job / d).mkdir(parents=True)
    shutil.copy(os.path.join(RUN11, "generated_0000.png"), job / "stage2" / "frames" / "0000.png")
    for src, d in (("control", "control/mask"), ("proxy", "control/proxy_mask"), ("bare", "control/bare_mask")):
        shutil.copy(os.path.join(RUN11, f"{src}_0000.png"), job / d / "0000.png")
    w, h = Image.open(job / "stage2" / "frames" / "0000.png").size
    (job / "cameras.json").write_text(json.dumps({"K": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "frames": [{"index": 0, "w2c": np.eye(4).tolist()}]}))
    m = {"camera": {"opencv": "cameras.json", "width": w, "height": h, "frames": 1},
         "control": {"mode": "proxy", "mask_dir": "control/mask", "proxy_mask_dir": "control/proxy_mask", "bare_mask_dir": "control/bare_mask"}}
    rec = pg.write_turntable_masks(str(job), m, params=HALF)
    assert rec["segmentation"] == pg.GARMENT_SEGMENT_VERSION and rec["frames"] == 1
    assert rec["frames_sha256"] == pg.file_set_sha256([str(job / "stage2" / "frames" / "0000.png")])
    assert rec["masks_sha256"] == pg.file_set_sha256([str(job / "stage2" / "garment_mask" / "0000.png")])
    assert json.loads((job / "stage2" / "garment_mask" / pg.MASK_RECORD).read_text())["masks_sha256"] == rec["masks_sha256"]
    assert pg.mask_record_check(str(job), [0]) == (json.loads((job / "stage2" / "garment_mask" / pg.MASK_RECORD).read_text()), None)
    g = pg._read_mask(str(job / "stage2" / "garment_mask" / "0000.png"))
    assert pg.iou(g, mask("truth_0000.png")) >= 0.95


def test_stage4_and_run_phase0_wire_the_alpha_targets():
    src = open(os.path.join(os.path.dirname(HERE), "stage4_recon.py"), encoding="utf-8").read()
    assert 'stage2_masks: str = "garment"' in src
    assert '"alpha_targets": alpha_targets' in src
    assert "pg.ensure_turntable_masks(job, m, sorted(w2cs))" in src and '"masks_sha256": rec["masks_sha256"]' in src
    assert pg.STAGE4_MASK_SOURCES == ("garment", "foreground")
    run = open(os.path.join(os.path.dirname(HERE), "run_phase0.py"), encoding="utf-8").read()
    assert "stage2_masks=stage2_masks" in run
    # Recorded whether or not stage 2 ran in this call (--skip-video) and whether its scoring failed.
    assert 'summary["stage4_masks"] = stage2_masks' in run
    assert run.index('summary["stage4_masks"]') > run.index("if not skip_video:") and run.index('summary["stage4_masks"]') < run.index("for source in sources:")


def test_scene_reads_the_exported_bare_mask(tmp_path):
    """Exports from 0.3.0 carry control/bare_mask; older proxy jobs render it from mannequin.glb."""
    from PIL import Image

    with open(os.path.join(HERE, "fixtures", "manifest.json"), encoding="utf-8") as f:
        m = json.load(f)
    assert m["control"]["bare_mask_dir"] == "control/bare_mask" and m["motion"]["bare_mask_dir"] == "motion/bare_mask"
    job = tmp_path
    for name in ("cameras_opencv.json",):
        with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as f:
            (job / name).write_text(f.read())
    (job / "control" / "bare_mask").mkdir(parents=True)
    w, h = m["camera"]["width"], m["camera"]["height"]
    b = np.zeros((h, w), np.uint8)
    b[10:100, 20:40] = 255
    Image.fromarray(b).save(job / "control" / "bare_mask" / "0003.png")
    scene = pg.JobScene(str(job), m)
    assert (scene.bare("turntable", 3) == (b > 0)).all()
    assert scene.bare_source["turntable"] == "exported bare mask"
