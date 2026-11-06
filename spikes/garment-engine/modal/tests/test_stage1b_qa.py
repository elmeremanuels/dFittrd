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
    assert dq.qa_score(q) > dq.qa_score(r)


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
    assert vac["pass"], vac["failures"]  # what the app used to see: the cut never showed
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
    # A real babydoll can be narrower and shorter than the proxy's guessed flare: low skirt cover, no leg gap.
    narrow = box(47, 42, 73, 120) | box(48, 120, 72, 136)
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
