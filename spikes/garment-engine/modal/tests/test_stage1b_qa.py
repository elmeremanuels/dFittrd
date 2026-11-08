"""Stage 1b after run 12: proxy-dressed target, edit region, QA v2 (leg gap, proxy silhouette), back-view checks,
engine choice and the Qwen instruction. numpy only (skipped without it); no Modal, no GPU.

Run 12's real stills are not fixtures (they are derived from shop photos, which stay out of git); their numbers
are in the README ("Stage 1b after run 12"), computed with `python phase0_dress.py <job dir>`.
"""
import ast
import copy
import json
import math
import os
import subprocess
import sys

import pytest

np = pytest.importorskip("numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import phase0_dress as dq  # noqa: E402
import phase0_lib as lib  # noqa: E402

W, H = 120, 208  # a quarter of 480x832
STUDIO = (235, 235, 235)


def box(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


def mannequin():
    """Head, torso, two legs apart from the crotch (row 120) down, arms hanging beside the torso."""
    return box(54, 10, 66, 40) | box(46, 40, 74, 120) | box(47, 120, 57, 200) | box(63, 120, 73, 200) | box(34, 45, 42, 110) | box(78, 45, 86, 110)


def dress_proxy():
    """One closed volume from below the neck (row 42) to the knee (row 160), wider than the legs."""
    return box(44, 42, 76, 160)


BARE = mannequin()
PROXY = dress_proxy()
REGION, REGION_REC = dq.edit_region(PROXY, BARE, "one-pieces")
SHORTS = box(45, 42, 75, 120) | box(46, 120, 58, 145) | box(62, 120, 74, 145)  # the run 12 failure: a romper


def foreground(garment):
    return BARE | garment


def test_edit_region_is_the_proxy_plus_margin_and_sleeves_never_the_head_or_feet():
    assert REGION_REC["margin_px"] == dq.edit_margin_px("one-pieces", H) == round(0.03 * H)
    assert REGION[PROXY].all()
    assert not REGION[:30].any()  # head
    assert not REGION[180:].any()  # lower legs and feet
    top = REGION_REC["proxy_top_row"]
    assert REGION[top + 5, 35]  # upper arm in the sleeve band
    assert not REGION[top + REGION_REC["sleeve_band_px"] + REGION_REC["margin_px"] + 2, 35]  # forearm
    with pytest.raises(ValueError, match="empty proxy"):
        dq.edit_region(np.zeros((H, W), bool), BARE, "one-pieces")


def test_fashn_labels_mark_the_region_as_the_garment_and_keep_the_rest_of_the_mannequin():
    lab = dq.fashn_person_labels(REGION, BARE, PROXY, lib.FASHN_LABEL_IDS, lib.FASHN_GARMENT_LABEL["one-pieces"])
    ids = lib.FASHN_LABEL_IDS
    assert (lab[REGION] == ids["dress"]).all()
    assert lab[20, 60] == ids["face"] and lab[195, 50] == ids["hands"]
    assert (lab[~(REGION | BARE)] == 0).all()
    # Both kept labels are in FASHN's exclusion set for a one-piece (hands and identity labels).
    assert "face" in lib.FASHN_IDENTITY_LABELS


def test_qa_passes_a_dress_and_fails_run12s_romper_for_the_leg_gap():
    dress = PROXY & ~box(44, 150, 76, 160) | box(43, 140, 77, 150)  # a slightly shorter, fuller dress
    q = dq.still_qa(dress, foreground(dress), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert q["pass"], q["failures"]
    assert q["leg_gap_rows"] == 0 and q["skirt_cover"] >= 0.75 and q["garment_proxy_iou"] > 0.85
    r = dq.still_qa(SHORTS, foreground(SHORTS), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert not r["pass"] and r["leg_gap"] is True
    assert any(f.startswith("leg gap") for f in r["failures"])
    assert r["leg_gap_rows"] >= 20 and r["skirt_cover"] < 0.7
    assert r["garment_proxy_iou"] < q["garment_proxy_iou"] and r["silhouette_iou"] < q["silhouette_iou"]
    # The same garment is fine for trousers' proxy kind: no leg-gap check there.
    t = dq.still_qa(SHORTS, foreground(SHORTS), BARE, PROXY, REGION, kind="trousers", mannequin_mae=5.0)
    assert not t["leg_gap"]
    assert dq.qa_score(q) >= dq.qa_score(r)


def test_qa_flags_placeholder_left_overs_garment_outside_the_region_and_a_moved_mannequin():
    dress = PROXY.copy()
    q = dq.still_qa(dress, foreground(dress), BARE, PROXY, REGION, kind="dress", residue=0.3)
    assert any("placeholder" in f for f in q["failures"])
    cape = dress | box(5, 50, 30, 150)
    q = dq.still_qa(cape, foreground(cape), BARE, PROXY, REGION, kind="dress")
    assert any("cut by the edit region" in f for f in q["failures"])
    q = dq.still_qa(dress, foreground(dress), BARE, PROXY, REGION, kind="dress", mannequin_mae=40.0)
    assert any("MAE" in f for f in q["failures"])


def test_proxy_residue_and_garment_prior_against_the_target():
    target = np.full((H, W, 3), STUDIO, np.uint8)
    target[BARE] = (128, 128, 128)
    target[PROXY] = (184, 173, 158)
    gen = target.copy()
    half = PROXY & box(0, 0, W, 100)
    gen[half] = (40, 90, 200)
    assert dq.proxy_residue(gen, target, PROXY, half) == pytest.approx(1 - half.sum() / PROXY.sum())
    prior = dq.garment_prior(gen, target, REGION, STUDIO)
    assert (prior & half).sum() / half.sum() > 0.95 and not (prior & ~REGION).any()


def test_pick_engine_prefers_a_passing_still_then_the_score():
    a = {"engine": "fashn", "qa": {"pass": False, "score": 0.9}}
    b = {"engine": "qwen", "qa": {"pass": True, "score": 0.7}}
    d = dq.pick_engine([a, b])
    assert d["engine"] == "qwen" and d["passed"] == ["qwen"] and d["scores"] == {"fashn": 0.9, "qwen": 0.7}
    d = dq.pick_engine([a, {"engine": "qwen", "qa": {"pass": False, "score": 0.5}}])
    assert d["engine"] == "fashn" and "rejected" in d["reason"]
    assert dq.pick_engine([{"engine": "qwen", "error": "x", "qa": {"pass": False}}])["engine"] is None


def _print(seed, shape=(80, 50)):
    rng = np.random.default_rng(seed)
    small = rng.integers(0, 255, (8, 5, 3)).astype(np.uint8)
    return np.kron(small, np.ones((shape[0] // 8, shape[1] // 5, 1), np.uint8))


def test_back_view_checks_mirror_difference_and_neckline():
    mask = np.ones((80, 50), bool)
    front, back = _print(1), _print(2)
    shop_front, shop_back = _print(3), _print(4)
    ok = dq.back_view_checks(front, mask, back, mask, shop_front, mask, shop_back, mask)
    assert ok["pass"] and ok["mirror_diff_ratio"] > 0.5
    # A back that is the front mirrored: no difference, while the shop's back differs from its front.
    same = dq.back_view_checks(front, mask, front[:, ::-1], mask, shop_front, mask, shop_back, mask)
    assert not same["pass"] and same["mirror_diff_ratio"] < 0.05
    # A plain garment: the shop's back looks like its front too, so a plain back passes.
    plain = np.full((80, 50, 3), 90, np.uint8)
    assert dq.back_view_checks(plain, mask, plain, mask, plain, mask, plain, mask)["pass"]
    # Front features on the back: a V neckline on the still while the shop's back is closed.
    vneck = mask.copy()
    for y in range(20):
        vneck[y, 25 - (20 - y) // 2: 25 + (20 - y) // 2 + 1] = False
    r = dq.back_view_checks(front, mask, back, vneck, shop_front, vneck, shop_back, mask)
    assert r["shop_back_closed"] is True and r["neckline_depth"]["back_still"] > 0.2
    assert not r["pass"] and any("front features" in f for f in r["failures"])
    assert dq.neckline_depth(mask) == 0.0 and dq.neckline_depth(np.zeros((4, 4), bool)) is None


def test_engine_choices_and_the_qwen_instruction(tmp_path):
    assert lib.dress_engines("both") == ["fashn", "qwen"] and lib.dress_engines("qwen") == ["qwen"]
    with pytest.raises(ValueError, match="both"):
        lib.dress_engines("idm")
    with open(os.path.join(HERE, "fixtures", "manifest.json"), encoding="utf-8") as f:
        m = json.load(f)
    m = copy.deepcopy(m)
    m["control"]["proxy"]["kind"] = "dress"
    front, neg = lib.qwen_dress_prompt(m, "front", False)
    assert "dress the mannequin in this exact garment: " + m["prompt"]["description"] in front.lower()
    assert "same pose, same camera" in front.lower() and "plain light-grey background" in front.lower()
    assert m["product_name"].lower() not in front.lower()
    assert "shorts" in neg and "romper" in neg
    back, _ = lib.qwen_dress_prompt(m, "back", False)
    assert "back view" in back and "back of the garment" in back
    inv, _ = lib.qwen_dress_prompt(m, "back", True)
    assert "back view" in inv and "front" in inv
    bad = copy.deepcopy(m)
    bad["prompt"]["description"] = f"a {m['product_name']} top"
    with pytest.raises(ValueError, match="product title"):
        lib.qwen_dress_prompt(bad, "front", False)
    assert lib.neutral_description({"category": "dress"}) == "a dress"


# --- after the run 12 review -----------------------------------------------------------------------------


def sleeved(rows_below_top):
    """A dress with sleeves on both arms down to `rows_below_top` rows below the proxy's top edge."""
    top = int(np.nonzero(PROXY.any(axis=1))[0][0])
    return PROXY | box(34, 45, 42, top + rows_below_top) | box(78, 45, 86, top + rows_below_top)


def test_sleeve_band_keeps_run12s_elbow_sleeves_that_the_old_band_cut():
    # Run 12 (480x832): proxy top row 235, the azure dress's puffed sleeves end at rows ~350 (front) and ~365 (back).
    # The 0.10 band (+25 px margin) stopped the region at row 343; 0.14 reaches row 376.
    assert dq.SLEEVE_BAND_FRAC["one-pieces"] >= 0.14
    bare = np.zeros((832, 480), bool)
    bare[200:800, 200:280] = True
    bare[240:600, 150:170] = True  # an arm
    proxy = np.zeros((832, 480), bool)
    proxy[235:570, 190:290] = True
    _, rec = dq.edit_region(proxy, bare, "one-pieces")
    assert rec["proxy_top_row"] == 235 and rec["arm_rows_end"] >= 366
    _, old = dq.edit_region(proxy, bare, "one-pieces", sleeve_band_frac=0.10)
    assert old["arm_rows_end"] == 235 + 83 + 25 < 350
    # At the test scale (H 208, top row 42): an elbow sleeve 31 rows (0.15 H) below the top ends inside the region now
    # (arm rows to 42 + 29 + 6 = 77), and was cut by the 0.10 band (to 42 + 21 + 6 = 69).
    g = sleeved(31)
    assert not (g & ~REGION).any()
    old_region, _ = dq.edit_region(PROXY, BARE, "one-pieces", sleeve_band_frac=0.10)
    assert (g & ~old_region).any()


def test_inside_fraction_is_measured_on_the_unclipped_mask_so_a_cut_sleeve_fails():
    long_sleeves = sleeved(68)  # down to the wrists: past the band
    clipped = long_sleeves & REGION
    vac = dq.still_qa(clipped, foreground(long_sleeves), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert vac["inside_fraction"] == 1.0 and vac["cut_px"] == 0 and vac["inside_basis"].startswith("clipped")
    assert not any("cut by the edit region" in f for f in vac["failures"])  # what the app used to see: the cut never showed
    q = dq.still_qa(clipped, foreground(long_sleeves), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, garment_full=long_sleeves)
    assert q["inside_basis"] == "unclipped" and q["cut_px"] == int((long_sleeves & ~REGION).sum()) > 0
    assert q["inside_fraction"] < 0.97 and q["cut_fraction"] > 0.03
    assert q["cut_rows"][0] == REGION_REC["arm_rows_end"] and not q["pass"]
    assert any("cut by the edit region" in f and "sleeve" in f for f in q["failures"])
    # A sleeve that fits the region is not flagged.
    fits = sleeved(31)
    ok = dq.still_qa(fits & REGION, foreground(fits), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, garment_full=fits)
    assert ok["inside_fraction"] == 1.0 and ok["pass"], ok["failures"]


def test_unclipped_garment_follows_the_garment_past_the_region_but_not_a_repainted_mannequin_far_away():
    target = np.full((H, W, 3), STUDIO, np.uint8)
    target[BARE] = (116, 116, 116)
    target[PROXY] = (184, 173, 158)
    long_sleeves = sleeved(68)
    gen = target.copy()
    gen[long_sleeves] = (40, 90, 200)
    gen[box(48, 185, 56, 200)] = (60, 60, 60)  # the model re-rendered a shin darker: changed, but not garment
    inner = dq.garment_prior(gen, target, REGION, STUDIO)
    assert not (inner & ~REGION).any()
    full = dq.unclipped_garment(gen, target, REGION, STUDIO, ring_px=REGION_REC["sleeve_band_px"])
    assert (full & long_sleeves & ~REGION).sum() > 0.9 * (long_sleeves & ~REGION & dq.pg.dilate(REGION, REGION_REC["sleeve_band_px"])).sum()
    assert not full[185:200, 48:56].any()
    sam = np.zeros((H, W), bool)
    sam[110:116, 34:42] = True
    assert dq.unclipped_garment(gen, target, REGION, STUDIO, ring_px=2, refined=sam)[sam].all()


def test_proxy_shape_checks_warn_until_retuned_and_the_leg_gap_stays_hard():
    # A real babydoll can be narrower and shorter than the proxy's guessed flare: low skirt cover, no leg gap. It covers
    # our hips (since stage1b-qa-0.8.0 a garment narrower than our own hips, mannequin beside it, is a type failure:
    # test_stage1b_run15.test_a_skirt_narrower_than_the_proxy_at_the_hips_is_a_type_failure).
    narrow = box(46, 42, 74, 120) | box(47, 120, 73, 128) | box(48, 128, 72, 136)  # tapering (a 2 px step is a shelf since 0.10.0)
    q = dq.still_qa(narrow, foreground(narrow), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert q["leg_gap_rows"] == 0 and q["skirt_cover"] < 0.7
    assert q["pass"], q["failures"]
    assert any("skirt zone" in w and "warning only" in w for w in q["warnings"])
    assert set(q["warn_only"]) == {"min_garment_proxy_iou", "min_skirt_cover"}
    hard = dq.still_qa(narrow, foreground(narrow), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, hard_checks=("min_skirt_cover", "min_garment_proxy_iou"))
    assert not hard["pass"] and any("skirt zone" in f for f in hard["failures"]) and not hard["warnings"]
    # Run 12's romper still fails, on the leg gap.
    r = dq.still_qa(SHORTS, foreground(SHORTS), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert not r["pass"] and r["leg_gap"] and any("skirt zone" in w for w in r["warnings"])


def test_front_still_is_the_backs_reference_only_when_it_passed_or_was_accepted():
    assert dq.front_reference({"pass": True}, False) == (True, None)
    ok, why = dq.front_reference({"pass": False, "failures": ["leg gap: 76/109"]}, False)
    assert not ok and "failed QA" in why and "leg gap" in why
    assert dq.front_reference({"pass": False, "failures": ["x"]}, True) == (True, None)


def test_grey_collision_measures_how_close_our_mannequin_is_to_fashns_fill():
    rgb = np.zeros((4, 4, 3), np.uint8)
    rgb[:2] = 120
    rgb[2:] = 60
    m = np.ones((4, 4), bool)
    g = dq.grey_collision(rgb, m)
    assert g["fill_value"] == 127 and g["share_within_tol"] == 0.5 and g["median"] == 90.0
    assert dq.grey_collision(rgb, np.zeros((4, 4), bool)) is None


def _calculate_dimensions(target_area, ratio):
    """diffusers 0.37.1 pipeline_qwenimage_edit_plus.calculate_dimensions, copied for the check."""
    width = math.sqrt(target_area * ratio)
    height = width / ratio
    width = round(width / 32) * 32
    height = round(height / 32) * 32
    return width, height


def test_qwen_canvas_is_the_size_the_pipeline_encodes_picture_1_at():
    assert lib.qwen_canvas(480, 832) == (768, 1344) == _calculate_dimensions(1024 * 1024, 480 / 832)
    for w, h in ((480, 832), (512, 768), (720, 1280), (832, 480), (1024, 1024)):
        cw, ch = lib.qwen_canvas(w, h)
        assert (cw, ch) == _calculate_dimensions(1024 * 1024, w / h) and cw % 32 == 0 and ch % 32 == 0
    # The old canvas was one 16-px token column wider than picture 1's latents.
    assert lib.fit_size(480, 832, 1024 * 1024) == (784, 1344)
    src = open(os.path.join(os.path.dirname(HERE), "stage1_dress.py"), encoding="utf-8").read()
    assert "lib.qwen_canvas(W, H)" in src and "lib.fit_size(" not in src
    assert "qwen_mod.calculate_dimensions(qwen_mod.VAE_IMAGE_SIZE" in src and '"picture1_vae_size"' in src


def test_stage1_app_uses_the_unclipped_mask_and_a_passing_front_only():
    src = open(os.path.join(os.path.dirname(HERE), "stage1_dress.py"), encoding="utf-8").read()
    ast.parse(src)
    assert "dq.unclipped_garment(" in src and "garment_full=garment_full" in src
    assert "dq.front_reference(qa, accept_failed)" in src
    assert 'pick = {"final": final, "gen": arr["gen_np"], "garment": arr["garment"]} if usable else None' in src
    assert "create_clothing_agnostic_image = recording_agnostic" in src and "_fashn_agnostic.png" in src
    assert "dq.grey_collision(" in src


def test_model_pin_says_qwen_edits_the_proxy_dressed_mannequin():
    use = lib.STAGE1B_MODELS["qwen"]["use"]
    assert "proxy-dressed" in use and "bare" not in use


def test_rescore_cli_runs_in_isolated_mode(tmp_path):
    script = os.path.join(os.path.dirname(HERE), "phase0_dress.py")
    r = subprocess.run([sys.executable, "-I", script, "--help"], cwd=str(tmp_path), capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    assert "job_dir" in r.stdout


# --- after run 13: colour from pixels, print fidelity, leg gap above the hem, silhouette band, engine order ---------
#
# Run 13's real stills are not fixtures either; their numbers are in the README ("Stage 1b after run 13"). The scenes
# below are synthetic stand-ins with the same structure (a pastel print on cream, a solid blue repaint, a babydoll
# shorter than the proxy with a tiered hem, run 12's romper).

CREAM, SAGE, PEACH, SKY, LILAC = (242, 235, 221), (160, 180, 150), (245, 195, 165), (150, 190, 230), (195, 170, 215)


def pastel_print(h=160, w=100, seed=0):
    """A cream ground with scattered pastel motifs (sage leaves, peach, light blue, lilac), as the azure print. Motifs are
    3-8 px tall and 2-5 px wide (run 13's leaves are larger than that on the 832-px still); a 1-px motif is averaged
    away by garment_colour's 3 x 3 smoothing, as sensor noise is (colour-0.2.0)."""
    rng = np.random.default_rng(seed)
    img = np.empty((h, w, 3), np.uint8)
    img[:] = CREAM
    for _ in range(280):
        y, x = rng.integers(0, h - 8), rng.integers(0, w - 5)
        img[y:y + rng.integers(3, 9), x:x + rng.integers(2, 6)] = [SAGE, PEACH, SKY, LILAC][rng.integers(0, 4)]
    return img


def shaded(rgb, h=160, w=100):
    """A solid colour with soft vertical shading (folds), +-25 %."""
    f = 1.0 + 0.25 * np.sin(2 * np.pi * np.arange(w) / 40.0)
    return np.clip(np.asarray(rgb, np.float64)[None, None, :] * f[None, :, None] * np.ones((h, 1, 1)), 0, 255).astype(np.uint8)


FULL = np.ones((160, 100), bool)


def test_garment_colour_comes_from_pixels_a_print_is_multicolour_on_its_ground_and_a_black_dress_is_black():
    azure = dq.garment_colour(pastel_print(), FULL)
    assert azure["kind"] == "print" and azure["phrase"] == "multicolour print on cream"
    assert "blue" not in azure["phrase"]  # run 13: the name said "Azure", the garment is a cream print
    black = dq.garment_colour(shaded((20, 20, 22)), FULL)
    assert black["kind"] == "solid" and black["phrase"] == "black"
    blue = dq.garment_colour(shaded((30, 110, 190)), FULL)
    assert blue["kind"] == "solid" and "blue" in blue["phrase"]
    assert dq.garment_colour(pastel_print(), np.zeros((160, 100), bool))["phrase"] is None
    # Two far colours of a plain garment are both named; shades of one colour are not.
    two = shaded((20, 20, 22))
    two[:, 50:] = 245
    assert dq.garment_colour(two, FULL)["phrase"] in ("black and white", "white and black")
    assert dq.garment_colour(shaded((20, 20, 22)), FULL)["kind"] == "solid"  # black and charcoal shades: one colour


def test_print_fidelity_passes_the_same_print_and_fails_a_solid_repaint_and_a_lost_print():
    shop = pastel_print(seed=1)
    ok = dq.print_fidelity(pastel_print(seed=2), FULL, shop, FULL)
    assert ok["pass"], ok["failures"]
    assert ok["lab_hellinger"] < 0.3 and ok["median_delta_e"] < 5 and ok["edge_ratio"] > 0.6 and ok["shop_printed"]
    blue = dq.print_fidelity(shaded((30, 90, 170)), FULL, shop, FULL)  # run 13's Qwen
    assert not blue["pass"] and blue["lab_hellinger"] > 0.8 and blue["median_delta_e"] > 40
    assert any("palette" in f for f in blue["failures"])
    plain = np.empty_like(shop)
    plain[:] = CREAM  # the right ground, the print gone
    lost = dq.print_fidelity(plain, FULL, shop, FULL)
    assert not lost["pass"] and any("print lost" in f for f in lost["failures"])
    assert ok["score"] > blue["score"]
    # A plain shop garment: the texture ratio is recorded, not checked.
    p = dq.print_fidelity(shaded((20, 20, 22)), FULL, shaded((25, 25, 25)), FULL)
    assert p["pass"] and not p["shop_printed"]


def test_still_qa_fails_a_candidate_whose_print_fidelity_failed():
    dress = PROXY.copy()
    fid = {"pass": False, "score": 0.0, "failures": ["palette differs from the shop photo's garment: Lab histogram distance 0.998 > 0.6"]}
    q = dq.still_qa(dress, foreground(dress), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, fidelity=fid)
    assert not q["pass"] and q["failures"] == ["print fidelity: " + fid["failures"][0]] and q["fidelity"]["score"] == 0.0


def babydoll():
    """Shorter than the proxy (hem row 140 of the proxy's 160), a tiered hem that dips at the centre: the garment leaves
    the axis open between the legs in the 2 rows just above its hem at the sides (run 13 FASHN: rows 531-535, hem 535)."""
    g = box(45, 42, 75, 141)
    g[138:141, 58:62] = False  # the dip at the centre
    return g


def test_leg_gap_counts_rows_above_the_garments_own_hem_only():
    g = babydoll()
    q = dq.still_qa(g, foreground(g), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, sleeve_band_px=REGION_REC["sleeve_band_px"])
    assert q["leg_gap_rows_all"] == 3 and q["leg_gap_rows"] == 0 and q["garment_hem_rows"] == [140, 140]
    assert not q["leg_gap"] and q["pass"], q["failures"]
    # Run 12's romper: the gap runs from the crotch (row 120) to near its hem (row 144): it still fails.
    r = dq.still_qa(SHORTS, foreground(SHORTS), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert r["leg_gap"] and r["leg_gap_rows"] >= 20 and r["leg_gap_rows_all"] > r["leg_gap_rows"]
    gap = dq.leg_gap_above_hem(SHORTS, PROXY, dq.pg.leg_rows(BARE), hem_tol=2)
    assert gap["hem_row"] == 144 and gap["gap_rows_span"] == [120, 141]


def test_silhouette_band_passes_a_shorter_narrower_dress_and_fails_an_open_front_and_a_repaint():
    g = babydoll()
    q = dq.still_qa(g, foreground(g), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert q["silhouette_iou"] < 0.95 and q["silhouette_band"]["torso_cover"] == 1.0 and q["silhouette_band"]["garment_inside"] == 1.0
    assert q["pass"], q["failures"]
    # Run 12's romper is open down to the waist: the eroded proxy torso is not covered.
    open_front = SHORTS & ~box(56, 42, 64, 95)
    r = dq.still_qa(open_front, foreground(open_front), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert r["silhouette_band"]["torso_cover"] < 0.92 and any("proxy torso" in f for f in r["failures"])
    # Run 13's Qwen back repainted the whole figure: garment and foreground far outside the target.
    repaint = box(20, 30, 100, 190)
    x = dq.still_qa(repaint, foreground(repaint), BARE, PROXY, REGION, kind="dress", garment_full=repaint)
    b = x["silhouette_band"]
    assert b["garment_inside"] < 0.6 and b["foreground_outside"] > 0.3
    assert sum("silhouette band" in f for f in x["failures"]) >= 2
    assert "min_silhouette_iou" not in x["thresholds"]


def test_pick_engine_order_hard_checks_then_fidelity_then_silhouette_and_never_a_fidelity_failure():
    def cand(engine, ok, fid_ok, fid, sil):
        return {"engine": engine, "qa": {"pass": ok and fid_ok, "score": sil, "fidelity": {"pass": fid_ok, "score": fid}}}

    # Run 13 front: Qwen (solid blue) had the better old score; FASHN (the print) failed the old silhouette IoU narrowly.
    d = dq.pick_engine([cand("fashn", False, True, 0.75, 0.75), cand("qwen", False, False, 0.0, 0.95)])
    assert d["engine"] == "fashn" and d["fidelity_failed"] == ["qwen"] and "rejected" in d["reason"]
    # Both pass: the higher fidelity wins although its silhouette score is lower; a near tie falls to the silhouette.
    d = dq.pick_engine([cand("fashn", True, True, 0.80, 0.90), cand("qwen", True, True, 0.70, 0.99)])
    assert d["engine"] == "fashn" and d["passed"] == ["fashn", "qwen"] and "fidelity" in d["reason"]
    d = dq.pick_engine([cand("fashn", True, True, 0.801, 0.90), cand("qwen", True, True, 0.799, 0.99)])
    assert d["engine"] == "qwen"
    # Everyone failed fidelity: nothing is picked; the highest fidelity is only kept as the rejected still.
    d = dq.pick_engine([cand("fashn", True, False, 0.3, 0.9), cand("qwen", True, False, 0.1, 0.99)])
    assert d["engine"] is None and d["rejected_still"] == "fashn" and d["passed"] == []
    assert dq.pick_engine([{"engine": "qwen", "error": "x", "qa": {"pass": False}}])["engine"] is None


def _manifest_0_4_0():
    with open(os.path.join(HERE, "fixtures", "manifest.json"), encoding="utf-8") as f:
        m = json.load(f)
    m = copy.deepcopy(m)
    m["control"]["proxy"]["kind"] = "dress"
    m["product_name"] = "Azure Palm Baby Doll Dress"
    desc = "knee-length babydoll dress in a fluid viscose fabric, one closed skirt that falls from the waist to the hem and covers both legs"
    m["prompt"]["description"] = "a blue " + desc
    m["prompt"]["turntable"] = "A blue " + desc + ", dressed on a plain mid-grey studio mannequin."
    m["prompt"]["colour"] = {"name": "blue", "source": "a colour word of the product name, mapped to a plain colour name (the word itself is not used)"}
    return m, "a " + desc


def test_qwen_instruction_names_the_measured_colour_never_a_colour_from_the_product_name():
    m, desc = _manifest_0_4_0()  # run 13's manifest (export 0.4.0): "blue" from "Azure"
    assert lib.neutral_description(m) == desc
    colour = dq.garment_colour(pastel_print(), FULL)
    text, neg = lib.qwen_dress_prompt(m, "front", False, colour=colour)
    assert "blue" not in text.lower() and "colours: multicolour print on cream, as in picture 2" in text
    assert "solid colour" in neg
    text, neg = lib.qwen_dress_prompt(m, "front", False)
    assert "blue" not in text.lower() and "solid colour" not in neg
    # A merchant colour (primaryColorHex) stays unless a colour was measured, which then replaces it.
    m["prompt"]["colour"] = {"name": "black", "source": "primaryColorHex #111111 → nearest basic colour"}
    m["prompt"]["description"] = "a black " + desc[2:]
    assert lib.neutral_description(m).startswith("a black ")
    text, _ = lib.qwen_dress_prompt(m, "front", False, colour={"phrase": "black", "kind": "solid"})
    assert text.lower().count("black") == 1 and "colours: black" in text
    # Stage 2 refuses a manifest whose colour came from the product name.
    m2, _ = _manifest_0_4_0()
    assert any("word of the product name" in p for p in lib.prompt_problems(m2))


def test_stage1_app_measures_the_colour_scores_fidelity_and_never_pins_a_fidelity_failure():
    src = open(os.path.join(os.path.dirname(HERE), "stage1_dress.py"), encoding="utf-8").read()
    assert "dq.garment_colour(np.asarray(src), smask)" in src and 'colour=s.get("colour")' in src
    assert "dq.print_fidelity(gen_np, garment, np.asarray(s[\"image\"]), s[\"mask\"])" in src and "fidelity=fid" in src
    assert 'sleeve_band_px=region_rec["sleeve_band_px"]' in src
    assert 'shown = decision["engine"] or decision.get("rejected_still")' in src


# --- review of run 13: colour naming of dark solids, exposure-normalised fidelity, short-inseam romper, hem by colour,
# a dress longer than the proxy ----------------------------------------------------------------------------------


def noisy_jpeg(rgb, shade=0.5, noise=8.0, h=200, w=120, seed=3):
    """A plain garment with fold shading (`shade`), sensor noise (sigma `noise`) and JPEG q85: the review's probe."""
    import io

    from PIL import Image

    rng = np.random.default_rng(seed)
    s = 1.0 - shade * (0.5 + 0.5 * np.sin(np.linspace(0, 1, w) * 12))[None, :]
    img = np.clip(np.asarray(rgb, np.float64)[None, None, :] * s[..., None] * np.ones((h, 1, 1)) + rng.normal(0, noise, (h, w, 3)), 0, 255)
    buf = io.BytesIO()
    Image.fromarray(img.astype(np.uint8)).save(buf, "JPEG", quality=85)
    return np.array(Image.open(buf).convert("RGB"))


DARK_SOLIDS = {
    "black": ((18, 18, 18), "black"),
    "navy": ((30, 40, 85), "navy blue"),
    "purple": ((80, 40, 110), "purple"),
    "dark green": ((25, 60, 35), "olive green"),
    "brown": ((80, 50, 30), "brown"),
    "teal": ((20, 100, 100), "teal"),
    "burgundy": ((90, 25, 35), "burgundy"),
    "olive": ((70, 80, 45), "olive green"),
}


@pytest.mark.parametrize("name", sorted(DARK_SOLIDS))
@pytest.mark.parametrize("shade,noise", [(0.3, 4.0), (0.5, 8.0)])
def test_garment_colour_names_a_shaded_noisy_dark_solid_by_its_hue_never_two_colours_or_a_print(name, shade, noise):
    rgb, want = DARK_SOLIDS[name]
    c = dq.garment_colour(noisy_jpeg(rgb, shade, noise), np.ones((200, 120), bool))
    # Before the review: purple -> "navy blue and purple", dark green -> "olive green and black", black (sigma 8) ->
    # "multicolour print on black" (accent 0.19), burgundy 0.45.
    assert c["kind"] == "solid" and c["phrase"] == want, (c["phrase"], c["accent_share"], c["names"])
    assert c["accent_share"] < 0.05 and not c["printed_by_edges"]


def test_garment_colour_still_names_real_two_tones_and_the_prompt_says_solid_colour_only_for_an_edge_printed_garment():
    full = np.ones((200, 120), bool)
    for a, b, want in (((20, 20, 22), (245, 245, 245), {"black", "light grey", "white"}), ((20, 20, 22), (200, 30, 40), {"black", "red"})):
        img = noisy_jpeg(a, 0.3, 6.0)
        img[:, 60:] = noisy_jpeg(b, 0.3, 6.0)[:, 60:]
        c = dq.garment_colour(img, full)
        assert c["kind"] == "two-tone" and set(c["phrase"].split(" and ")) <= want, c["phrase"]
    m, _ = _manifest_0_4_0()
    purple = dq.garment_colour(noisy_jpeg((80, 40, 110)), full)
    text, neg = lib.qwen_dress_prompt(m, "front", False, colour=purple)
    assert "colours: purple, as in picture 2" in text and "navy" not in text and "solid colour" not in neg
    printed = dq.garment_colour(pastel_print(), FULL)
    assert printed["printed_by_edges"] and "solid colour, plain fabric" in lib.qwen_dress_prompt(m, "front", False, colour=printed)[1]
    # A "print" by chromaticity whose edges say plain (or a record from before colour-0.2.0): no "solid colour" negative.
    for c in ({**printed, "printed_by_edges": False}, {"phrase": "multicolour print on black", "kind": "print"}):
        assert "solid colour" not in lib.qwen_dress_prompt(m, "front", False, colour=c)[1]


def _ground(img, rgb):
    """The print's cream ground recoloured to `rgb`, motifs kept."""
    out = img.copy()
    out[(img == CREAM).all(axis=2)] = rgb
    return out


def test_print_fidelity_tolerates_a_darker_render_and_fails_a_tint_or_another_ground():
    shop = pastel_print(seed=1)
    cand = pastel_print(seed=2).astype(np.float64)
    for k in (0.85, 0.75, 0.65):  # 0.75 failed before (median Delta E 21.9 on run 13's FASHN front)
        r = dq.print_fidelity(np.clip(cand * k, 0, 255).astype(np.uint8), FULL, shop, FULL)
        assert r["pass"], (k, r["failures"])
        assert r["median_delta_e"] < 3 and r["lab_hellinger"] < 0.15
    dark = dq.print_fidelity((cand * 0.65).astype(np.uint8), FULL, shop, FULL)
    assert dark["median_delta_e_unnormalised"] > 20 and dark["exposure_gain"] > 2  # what 0.1.0 compared
    for tint in ((1.0, 0.85, 0.9), (1.0, 1.0, 0.8), (0.85, 0.92, 1.0)):
        r = dq.print_fidelity(np.clip(cand * np.array(tint), 0, 255).astype(np.uint8), FULL, shop, FULL)
        assert not r["pass"] and any("palette" in f or "median colour" in f for f in r["failures"]), (tint, r)
    for ground in ((200, 235, 215), (240, 200, 210), (245, 230, 150)):  # mint, light pink, yellow ground: the same motifs
        r = dq.print_fidelity(_ground(pastel_print(seed=2), ground), FULL, shop, FULL)
        assert not r["pass"], (ground, r["median_delta_e"], r["lab_hellinger"])
    # Black against charcoal grey: beyond any lighting change (the gain), though the hue is the same.
    r = dq.print_fidelity(shaded((64, 64, 64)), FULL, shaded((18, 18, 18)), FULL)
    assert not r["pass"] and r["exposure_gain"] < 1 / 3 and any("exposure gain" in f for f in r["failures"])


def test_a_closed_romper_with_a_short_inseam_fails_the_leg_gap():
    # Torso closed to the crotch (row 120), then 4 rows of shorts on each leg: before the review all 4 gap rows lay
    # within the hem allowance of the romper's own hem (row 123) and it passed every hard check.
    romper = box(45, 42, 75, 120) | box(46, 120, 58, 124) | box(62, 120, 74, 124)
    q = dq.still_qa(romper, foreground(romper), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert q["garment_hem_rows"] == [123, 123] and q["leg_gap_hem_excused"] is False
    assert q["leg_gap"] and q["leg_gap_rows"] == 4 and not q["pass"]
    # The babydoll's hem is far below the crotch: its dip at the hem is still excused.
    g = babydoll()
    b = dq.still_qa(g, foreground(g), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert b["leg_gap_hem_excused"] and b["leg_gap_rows"] == 0 and b["pass"], b["failures"]


GREY = (110, 110, 110)


def dressed_rgb(garment):
    """Studio background, our grey mannequin, the pastel print where `garment` is."""
    img = np.empty((H, W, 3), np.uint8)
    img[:] = STUDIO
    img[BARE] = GREY
    tile = np.tile(pastel_print(h=H // 2 + 1, w=W // 2 + 1), (2, 2, 1))[:H, :W]
    img[garment] = tile[garment]
    return img


def test_hem_comes_from_the_clipped_garment_and_its_colour_not_from_repainted_legs():
    g = babydoll()
    legs_repaint = box(47, 141, 57, 166) | box(63, 141, 73, 166)  # FASHN's repainted legs under the hem, inside the region
    bare_rgb = dressed_rgb(np.zeros((H, W), bool))
    # garment_full runs onto the legs, the clipped garment stops at the hem: the hem is the clipped garment's.
    q = dq.still_qa(g, foreground(g), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, garment_full=g | legs_repaint)
    assert q["garment_hem_rows"] == [140, 140] and "never the unclipped" in q["garment_hem_basis"] and q["pass"], q["failures"]
    # The garment mask itself bleeds onto the legs: by mask the hem is at row 165 and the open rows between the legs count
    # (the run 12-style false fail); by colour (the still and our bare render) the hem stays at the dress's.
    bled = g | legs_repaint
    by_mask = dq.still_qa(bled, foreground(bled), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert by_mask["garment_hem_rows"] == [165, 165] and by_mask["leg_gap"]
    by_colour = dq.still_qa(bled, foreground(bled), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0,
                            rgb=dressed_rgb(g), bare_rgb=bare_rgb)
    assert by_colour["garment_hem_rows"] == [140, 140] and "garment-coloured" in by_colour["garment_hem_basis"]
    assert not by_colour["leg_gap"] and by_colour["pass"], by_colour["failures"]
    # A grey garment on our grey mannequin: colour cannot separate them, the hem comes from the mask (a grey romper's
    # legs are not dropped from it).
    grey_romper = SHORTS
    img = dressed_rgb(np.zeros((H, W), bool))
    img[grey_romper] = (118, 118, 118)
    r = dq.still_qa(grey_romper, foreground(grey_romper), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, rgb=img, bare_rgb=bare_rgb)
    assert "too close" in r["garment_hem_basis"] and r["garment_hem_rows"] == [144, 144] and r["leg_gap"]


def test_silhouette_band_lets_a_dress_run_longer_than_the_proxys_guessed_hem_but_not_into_the_feet(monkeypatch):
    midi = box(44, 42, 76, 172)  # 12 rows (about 6 % of the height) past the proxy's knee hem at row 160
    q = dq.still_qa(midi, foreground(midi), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert q["silhouette_band"]["garment_inside"] >= 0.96 and q["silhouette_band"]["hem_extend_px"] == 12
    monkeypatch.setitem(dq.SILHOUETTE_BAND, "hem_extend_frac", 0.0)  # the band before the review
    old = dq.still_qa(midi, foreground(midi), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert old["silhouette_band"]["garment_inside"] < 0.96
    monkeypatch.undo()
    to_feet = box(44, 42, 76, 205)
    f = dq.still_qa(to_feet, foreground(to_feet), BARE, PROXY, REGION, kind="dress", mannequin_mae=5.0, residue=0.0, garment_full=to_feet)
    assert f["silhouette_band"]["garment_inside"] < 0.96 and not f["pass"]
