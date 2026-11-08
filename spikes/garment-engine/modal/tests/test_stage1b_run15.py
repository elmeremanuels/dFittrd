"""Stage 1b after run 15 (stage1b-qa-0.7.0): the composite mask that lost a cream print on the beige proxy, holes in the
shop photo's mask that FASHN drew as grey cloth, the trouser region that gave FASHN one block to paint, and the TYPE
checks that stop a torn, shrunken or two-garment pair of stills before stage 2 even with --accept-failed-dress.
Synthetic scenes at a quarter of 480x832 (the layout of test_stage1b_qa.py); numpy only. Run 15's real stills are not
fixtures (shop photos stay out of git); their numbers are in the README, from `python -I phase0_dress.py <job dir>`."""
import json
import os
import sys

import pytest

np = pytest.importorskip("numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
sys.path.insert(0, MODAL_DIR)

import phase0_dress as dq  # noqa: E402
import phase0_lib as lib  # noqa: E402

W, H = 120, 208
STUDIO = (235, 235, 235)
GREY = (117, 117, 117)  # our mannequin under the studio light (run 15: median 116)
BEIGE = (184, 173, 158)  # the proxy's flat placeholder, rgb (0.72, 0.68, 0.62)


def box(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


BARE = box(54, 10, 66, 40) | box(46, 40, 74, 120) | box(47, 120, 57, 200) | box(63, 120, 73, 200) | box(34, 45, 42, 110) | box(78, 45, 86, 110)
SLEEVES = box(33, 44, 43, 80) | box(77, 44, 87, 80)
TOP = box(44, 42, 76, 125) | SLEEVES  # a hip-length top with sleeves to the elbow


def render(mask_colours, bare=BARE, seed=0):
    """Our studio, the grey mannequin, then (mask, colour or image) layers; a little noise."""
    img = np.empty((H, W, 3), np.float64)
    img[:] = STUDIO
    img[bare] = GREY
    for m, c in mask_colours:
        img[m] = c[m] if np.ndim(c) == 3 else c
    img += np.random.default_rng(seed).normal(0, 1.5, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def cream_print(seed=1):
    """A light print whose ground is the proxy's own beige (run 15's blouse: cream ground, pink and lavender motifs)."""
    rng = np.random.default_rng(seed)
    img = np.empty((H, W, 3), np.float64)
    img[:] = BEIGE
    for _ in range(140):
        y, x = rng.integers(0, H), rng.integers(0, W)
        img[max(0, y - 2):y + 3, max(0, x - 2):x + 3] = rng.choice([(214, 150, 160), (200, 200, 222), (230, 205, 190)])
    return img


# --- 1. the composite mask (full 480x832: the mannequin colour model samples the head) ---------------------


def up(m):
    return np.kron(np.asarray(m, bool), np.ones((4, 4), bool))


BARE4, TOP4 = up(BARE), up(TOP)


def render4(layers, seed=0):
    img = np.empty(BARE4.shape + (3,), np.float64)
    img[:] = STUDIO
    img[BARE4] = GREY
    for m, c in layers:
        img[m] = c[m] if np.ndim(c) == 3 else c
    img += np.random.default_rng(seed).normal(0, 1.5, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def print4(seed=1):
    return np.kron(cream_print(seed), np.ones((4, 4, 1)))


def test_composite_mask_keeps_a_print_whose_ground_is_the_proxys_beige():
    region, _ = dq.edit_region(TOP4, BARE4, "tops")
    target = render4([(TOP4, BEIGE)])
    gen = render4([(TOP4, print4())], seed=2)
    prior = dq.garment_prior(gen, target, region, STUDIO)
    # The difference against the target loses the ground (run 15's blouse front: 21,112 px kept, about 40,000 drawn).
    assert prior.sum() < 0.5 * TOP4.sum()
    garment, rec = dq.still_garment_mask(gen, prior, BARE4, TOP4, region)
    assert not rec["ambiguous_with_mannequin"] and rec["mannequin"]["source"].startswith("sampled")
    assert garment[TOP4 & BARE4].mean() > 0.97, garment[TOP4 & BARE4].mean()
    body = dq.garment_body(garment, TOP4, BARE4, kind="top", erode_px=8)
    assert body["see_through"] < 0.01 and body["body_length"] > 0.97, body
    assert rec["added_px"] > 0 and (garment <= region).all()


def test_composite_mask_leaves_out_mannequin_the_engine_drew_inside_the_garment():
    """A torn garment stays torn in the mask (and the QA sees it): grey mannequin and warm grey skin are not cloth."""
    region, _ = dq.edit_region(TOP4, BARE4, "tops")
    hole = up(box(52, 70, 66, 95))
    skin = up(box(48, 100, 72, 110))
    gen = render4([(TOP4, print4()), (hole, GREY), (skin, (128, 121, 117))], seed=3)  # run 15 cardigan: midriff chroma 8-15
    chosen = TOP4 & ~hole & ~skin
    garment, _ = dq.still_garment_mask(gen, chosen, BARE4, TOP4, region)
    assert not garment[hole].any() and garment[skin].mean() < 0.05
    body = dq.garment_body(garment, TOP4, BARE4, kind="top", erode_px=8)
    assert body["see_through"] > 0.05


def test_composite_mask_keeps_the_chosen_mask_when_the_garment_is_mannequin_grey():
    region, _ = dq.edit_region(TOP4, BARE4, "tops")
    gen = render4([(TOP4, (120, 120, 120))], seed=4)
    chosen = TOP4 & ~up(box(50, 60, 60, 70))
    garment, rec = dq.still_garment_mask(gen, chosen, BARE4, TOP4, region)
    assert rec["ambiguous_with_mannequin"] and (garment == (chosen & region)).all()


# --- 2. the shop photo's mask ----------------------------------------------------------------------------


def test_source_mask_holes_are_filled_and_a_wide_opening_is_not_bridged():
    m = np.zeros((1200, 800), bool)
    m[300:1000, 150:650] = True  # the garment
    m[350:900, 150:200] = False  # an opening to the side (between arm and body): stays
    speckle = np.zeros_like(m)
    rng = np.random.default_rng(0)
    for _ in range(200):  # the cardigan back's knit sleeves: SAM 2 holes of a few px
        y, x = rng.integers(420, 880, 2) * [1, 1]
        speckle[y:y + 3, 520 + x % 100:523 + x % 100] = True
    v = np.zeros_like(m)
    for y in range(300, 520):  # a V opening 60 px wide at the top
        half = int(30 * (520 - y) / 220)
        v[y, 400 - half:400 + half] = True
    torn = m & ~speckle & ~v
    out, rec = dq.clean_source_mask(torn)
    assert out[speckle & m].all()
    assert rec["close_px"] == 4 and rec["added_px"] >= int((speckle & m).sum())
    assert not out[350:900, 150:170].any()  # the side opening
    assert not out[300:380, 385:415].any()  # the V near the neck (wider than the closing) stays open
    assert (out >= torn).all()  # only adds
    clean, rec2 = dq.clean_source_mask(m)
    assert rec2["added_px"] == 0 and (clean == m).all()


# --- 3. TYPE checks: torn, shrunken, two garments --------------------------------------------------------


def qa(garment, proxy, kind, cat):
    region, rec = dq.edit_region(proxy, BARE, cat, keep_open=kind == "outerwear")
    g = garment & region
    return dq.still_qa(g, BARE | garment, BARE, proxy, region, kind=kind, garment_full=garment, sleeve_band_px=rec["sleeve_band_px"])


def test_a_torn_top_fails_as_a_type_failure_and_a_whole_one_passes():
    good = qa(TOP, TOP, "top", "tops")
    assert good["pass"], good["failures"]
    assert good["garment_body"]["see_through"] == 0.0 and good["garment_body"]["body_length"] == pytest.approx(1.0, abs=0.02)
    torn = TOP.copy()
    for y in range(55, 120, 10):
        for x in range(48, 72, 8):
            torn[y:y + 4, x:x + 4] = False  # holes inside the outline: our mannequin shows through
    bad = qa(torn, TOP, "top", "tops")
    assert bad["garment_body"]["see_through"] > dq.STILL_QA_THRESHOLDS["max_see_through"]
    assert any(f.startswith("see-through") for f in bad["type_failures"]), bad["type_failures"]


def test_a_cropped_garment_fails_and_a_skirt_with_a_lower_waistband_does_not():
    bolero = box(44, 42, 76, 70) | SLEEVES  # run 15's cardigan front: sleeves and a scrap of front
    r = qa(bolero, TOP, "outerwear", "tops")
    assert r["garment_body"]["body_length"] < dq.STILL_QA_THRESHOLDS["min_body_length"]
    assert any(f.startswith("body too short") for f in r["type_failures"]), r["type_failures"]
    # A skirt with its waistband lower than the proxy's, as wide as the proxy and down to the hem: no type failure.
    skirt_proxy = box(44, 80, 76, 196)
    low = box(44, 92, 76, 198)
    s = qa(low, skirt_proxy, "skirt", "bottoms")
    assert s["type_failures"] == [], s["type_failures"]
    assert s["garment_body"]["body_length"] >= 1.0
    assert s["hips"]["short_rows"] == 0 and s["hips"]["zone"][0] > 92  # the hip zone starts at the garment's own top


def test_a_skirt_narrower_than_the_proxy_at_the_hips_is_a_type_failure():
    """Run 15's skirt (founder: "see the hips"): drawn narrower than the proxy (3 px a side at a quarter of 832; run 15
    8-12 px at full size) and than our hips, which show beside it in both stills; the video opened a side slit there.
    0.7.0 let it through; 0.8.0 stops it."""
    skirt_proxy = box(44, 80, 76, 196)
    narrow = box(47, 92, 73, 198)
    s = qa(narrow, skirt_proxy, "skirt", "bottoms")
    hips = s["hips"]
    assert hips["zone"] == [94, 120]  # from the garment's own top + 2 rows to the crotch (our legs part at row 120)
    assert hips["short_rows"] == hips["rows"] and hips["rows"] >= s["thresholds"]["min_hip_rows"]
    assert hips["median_short_px"] == [3.0, 3.0] and hips["exposed_frac"] == 1.0  # our hips (46-74) beside it
    assert any(f.startswith("narrow at the hips") for f in s["type_failures"]), s["type_failures"]
    # Narrower than the proxy's ease but over our hips: not this failure (the mannequin does not show).
    over = box(45, 92, 75, 198)  # 1 px a side inside the proxy (44-76), over our hips (46-74)
    e = qa(over, skirt_proxy, "skirt", "bottoms")
    assert e["hips"]["short_frac"] == 1.0 and e["hips"]["exposed_frac"] == 0.0
    assert not any(f.startswith("narrow at the hips") for f in e["type_failures"]), e["type_failures"]
    # The babydoll of test_stage1b_qa before 0.8.0 (box 47-73 over our 46-74 hips) now fails here as it should.
    from test_stage1b_qa import PROXY as DRESS_PROXY, REGION as DRESS_REGION
    old = box(47, 42, 73, 120) | box(48, 120, 72, 136)
    d = dq.still_qa(old, BARE | old, BARE, DRESS_PROXY, DRESS_REGION, kind="dress", mannequin_mae=5.0, residue=0.0)
    assert any(f.startswith("narrow at the hips") for f in d["type_failures"]), d["type_failures"]
    # One side short in a quarter of the rows only (a hand, a fold): not a failure.
    folds = skirt_proxy.copy()
    folds[100:106, 44:47] = False
    f = qa(folds, skirt_proxy, "skirt", "bottoms")
    assert 0 < f["hips"]["short_frac"] <= 0.5 and not any(x.startswith("narrow") for x in f["type_failures"])
    # Tops and outerwear have no hip zone (arms beside the hips); trousers are checked above the crotch.
    assert qa(TOP, TOP, "top", "tops")["hips"]["zone"] is None
    tr = dq.hip_profile(box(46, 80, 74, 122), box(44, 80, 76, 122), BARE, (120, 200, 47, 73), kind="trousers", short_px=2)
    assert tr["short_rows"] == tr["rows"] > 0


def test_front_and_back_of_different_garments_fail_on_the_back_as_a_type_failure():
    front = dq.garment_body(box(44, 42, 76, 70) | SLEEVES, TOP, BARE, kind="outerwear", erode_px=2)
    back = dq.garment_body(box(44, 42, 76, 125), TOP, BARE, kind="outerwear", erode_px=2)  # a sleeveless vest
    va = dq.view_agreement(front, back)
    assert va["pass"] is False and va["length_gap"] > 0.25 and va["sleeve_gap"] > 0.4
    same = dq.view_agreement(dq.garment_body(TOP, TOP, BARE, kind="top", erode_px=2), dq.garment_body(TOP, TOP, BARE, kind="top", erode_px=2))
    assert same["pass"] and same["failures"] == []
    # Sleeves are compared only where the proxy has them (azure's proxy: shoulder corners only).
    dress = box(44, 42, 76, 160)
    a = dq.garment_body(dress, dress, BARE, kind="dress", erode_px=2)
    b = dq.garment_body(box(44, 42, 76, 160) | SLEEVES, dress, BARE, kind="dress", erode_px=2)
    assert dq.view_agreement(a, b)["sleeve_gap"] is None and dq.view_agreement(a, b)["pass"]
    back_qa = {"pass": True, "failures": [], "type_failures": []}
    dq.apply_view_agreement(back_qa, va)
    assert back_qa["pass"] is False and len(back_qa["type_failures"]) == 2
    assert all(f.startswith("views disagree") for f in back_qa["type_failures"])
    s = lib.stage1b_summary([{"view": "front", "qa": {"pass": True, "failures": [], "type_failures": []}}, {"view": "back", "qa": back_qa}], invented_back=False)
    assert s["type_failed_views"] == ["back"]
    assert dq.view_agreement(None, back)["pass"] is None


def test_the_gate_stops_a_view_disagreement_even_with_accept_failed_dress(tmp_path):
    pytest.importorskip("modal")
    import run_phase0

    front = {"view": "front", "qa": {"pass": True, "failures": [], "type_failures": []}}
    back = {"view": "back", "qa": {"pass": True, "failures": [], "type_failures": []}}
    dq.apply_view_agreement(back["qa"], {"failures": ["front and back differ in sleeves: x"]})
    rec = {"summary": lib.stage1b_summary([front, back], invented_back=False)}
    m = {"photos": [], "prompt": {"description": "a blouse", "negative": "text, dress"}}
    reasons = [r for r in run_phase0._dress_gate(m, str(tmp_path), rec, accept_failed=True, allow_invented=True) if "different garment" in r]
    assert reasons and "back: views disagree" in reasons[0]


# --- 4. trousers: two legs in the engine's input; merged legs on what it drew ---------------------------


PROXY_TROUSERS = box(44, 80, 76, 122) | box(44, 122, 59, 196) | box(61, 122, 76, 196)  # wide legs 2 px apart (palazzo)


def test_trouser_region_keeps_a_gap_the_margin_would_close():
    old, _ = dq.edit_region(PROXY_TROUSERS, BARE, "bottoms")
    assert old[130:190, 60].all()  # run 15: the 2 px gap vanished in the margin, one block to paint
    gap = dq.trouser_gap_zone(PROXY_TROUSERS, BARE)
    assert gap.sum() > 0 and not gap[:120].any()
    widths = gap.sum(axis=1)[gap.any(axis=1)]
    assert widths.min() >= round(dq.TROUSER_GAP_FRAC * H) - 1
    region, rec = dq.edit_region(PROXY_TROUSERS, BARE, "bottoms", open_crotch=gap)
    assert rec["crotch_gap_px"] > 0 and not region[130:190, 60].any() and region[130:190, 50].all() and region[130:190, 70].all()
    # FASHN sees the strip: labelled `feet`, which its agnostic image keeps for lower-body garments.
    labels = dq.fashn_person_labels(region, BARE, PROXY_TROUSERS, lib.FASHN_LABEL_IDS, "pants", keep_visible=gap)
    assert (labels[gap] == lib.FASHN_LABEL_IDS["feet"]).all()
    assert "feet" not in lib.FASHN_BODY_COVERAGE_TO_LABELS["lower"]
    # ... painted as our bare render (studio and inner thighs), not the touching placeholder legs.
    target = render([(PROXY_TROUSERS, BEIGE)])
    bare_rgb = render([])
    painted = dq.engine_target(target, bare_rgb, gap)
    assert (painted[gap] == bare_rgb[gap]).all() and (painted[~gap] == target[~gap]).all()
    # No gap for a skirt or a dress (the proxy never splits) and none at a side view.
    assert dq.trouser_gap_zone(box(44, 80, 76, 196), BARE).sum() == 0
    assert dq.trouser_gap_zone(PROXY_TROUSERS, box(50, 10, 70, 200)).sum() == 0


def test_merged_legs_are_measured_on_what_the_engine_drew_not_on_the_clipped_composite():
    gap = dq.trouser_gap_zone(PROXY_TROUSERS, BARE)
    region, rec = dq.edit_region(PROXY_TROUSERS, BARE, "bottoms", open_crotch=gap)
    p = dq.qa_proxy(PROXY_TROUSERS, gap)
    skirt = box(44, 80, 76, 196)  # run 15: FASHN drew one closed skirt
    r = dq.still_qa(skirt & region, BARE | skirt, BARE, p, region, kind="trousers", garment_full=skirt)
    assert any(f.startswith("legs merged") for f in r["type_failures"]), r["failures"]
    assert r["merged_leg_rows_basis"].startswith("unclipped")
    legs = p  # trousers drawn as the engine was shown them
    ok = dq.still_qa(legs & region, BARE | legs, BARE, p, region, kind="trousers", garment_full=legs)
    assert ok["type_failures"] == [] and ok["pass"], ok["failures"]
    assert dq.qa_proxy(PROXY_TROUSERS, None) is PROXY_TROUSERS


# --- 5. the hips conformed to the proxy (stage1b-qa-0.8.0) ------------------------------------------------


SKIRT_PROXY4 = up(box(44, 80, 76, 196))


def striped_skirt(inset):
    """A skirt `inset` px a side narrower than the proxy (full 480x832), vertical red and pink stripes 6 px wide."""
    g = SKIRT_PROXY4.copy()
    g[:, :176 + inset] = False
    g[:, 304 - inset:] = False
    stripes = np.zeros(BARE4.shape + (3,), np.float64)
    stripes[:] = (170, 30, 40)
    stripes[:, (np.arange(480) // 6) % 2 == 1] = (230, 170, 180)
    return g, render4([(g, stripes)], seed=5)


def test_conform_widens_a_skirt_to_the_proxy_at_the_hips_and_leaves_the_rest():
    region, _ = dq.edit_region(SKIRT_PROXY4, BARE4, "bottoms")
    g, gen = striped_skirt(8)
    legs = dq.pg.leg_rows(BARE4)
    before = dq.hip_profile(g, SKIRT_PROXY4, BARE4, legs, kind="skirt", short_px=5)
    assert before["short_rows"] == before["rows"] > 0 and before["median_short_px"] == [8.0, 8.0]
    out, mask, rec = dq.conform_to_proxy(gen, g, SKIRT_PROXY4, BARE4, region, kind="skirt")
    assert rec["applied"] and rec["capped_rows"] == 0 and rec["max_stretch"] == pytest.approx(136 / 120, abs=0.02)
    after = dq.hip_profile(mask, SKIRT_PROXY4, BARE4, legs, kind="skirt", short_px=5)
    # 0.9.0: the stretch ramps in over 25 rows from the skirt's top (a slanted waistband is not squared off), so only
    # rows near the top may still be short, far under the check's share.
    ramp = int(round(dq.CONFORM["ramp_frac"] * 832))
    assert after["short_frac"] <= 0.25 and after["short_frac"] < dq.STILL_QA_THRESHOLDS["max_hip_short_frac"]
    top = 320
    assert g[top + 2].sum() < mask[top + 2].sum() < SKIRT_PROXY4[top + 2].sum()  # partly stretched at the top
    # Below the ramp the hip rows (to the crotch, row 480) span the proxy, filled with the skirt's own colours.
    for y in (top + ramp + 5, 400, 470):
        assert mask[y].sum() == SKIRT_PROXY4[y].sum() and (mask[y] == SKIRT_PROXY4[y]).all()
        reds = out[y][mask[y]]
        assert (np.abs(reds.astype(int) - (117, 117, 117)).max(axis=1) > 30).all()  # no mannequin grey pasted in
    # Below the crotch the stretch ramps out over 50 rows; further down the skirt is as drawn.
    ramp_out = int(round(dq.CONFORM["ramp_out_frac"] * 832))
    y = 480 + ramp_out + 5
    assert (mask[y] == g[y]).all() and (out[y] == gen[y]).all()
    assert (mask[480 + ramp_out // 2].sum() - g[480 + ramp_out // 2].sum()) in range(4, 13)
    # Never narrows: a skirt as wide as the proxy is left alone; nor outside the edit region.
    same, same_mask, rec2 = dq.conform_to_proxy(gen, SKIRT_PROXY4, SKIRT_PROXY4, BARE4, region, kind="skirt")
    assert not rec2["applied"] and (same_mask == SKIRT_PROXY4).all()
    assert (mask <= region).all()


def test_conform_caps_the_stretch_and_the_hip_check_still_fails():
    region, _ = dq.edit_region(SKIRT_PROXY4, BARE4, "bottoms")
    g, gen = striped_skirt(24)  # 136 / 88 = 1.55 > 1.25: an engine that drew a much slimmer skirt
    out, mask, rec = dq.conform_to_proxy(gen, g, SKIRT_PROXY4, BARE4, region, kind="skirt")
    assert rec["capped_rows"] > 0
    legs = dq.pg.leg_rows(BARE4)
    assert dq.hip_profile(mask, SKIRT_PROXY4, BARE4, legs, kind="skirt", short_px=5)["short_frac"] > dq.STILL_QA_THRESHOLDS["max_hip_short_frac"]


def test_conform_leaves_tops_outerwear_and_open_rows_alone():
    region, _ = dq.edit_region(TOP4, BARE4, "tops")
    gen = render4([(TOP4, print4())])
    narrow = TOP4 & ~up(box(44, 42, 46, 125))
    for kind in ("top", "outerwear"):
        out, mask, rec = dq.conform_to_proxy(gen, narrow, TOP4, BARE4, region, kind=kind)
        assert not rec["applied"] and (mask == narrow).all() and (out == gen).all()
    # A skirt open in the middle of its rows (an engine's slit) is not stretched across the gap.
    region_s, _ = dq.edit_region(SKIRT_PROXY4, BARE4, "bottoms")
    g, gen_s = striped_skirt(8)
    g[:, 220:260] = False
    _, mask, rec = dq.conform_to_proxy(gen_s, g, SKIRT_PROXY4, BARE4, region_s, kind="skirt")
    assert not mask[:, 225:255].any()


TROUSERS4 = up(PROXY_TROUSERS)


def test_trousers_are_not_conformed_to_the_proxy_but_their_hips_cover_our_body():
    """0.10.0 (run 16a's palazzo back): widening the hips to the trousers proxy's hip block, which ends in a step, over legs
    left as drawn made a yoke shelf. Trousers are no longer conformed to the proxy; where the engine drew them slimmer than
    OUR hips (background beside them), `conform_edges` stretches the cloth over our body, which tapers into the thighs."""
    gap = dq.trouser_gap_zone(TROUSERS4, BARE4)
    region, _ = dq.edit_region(TROUSERS4, BARE4, "bottoms", open_crotch=gap)
    p = dq.qa_proxy(TROUSERS4, gap)
    legs = dq.pg.leg_rows(BARE4)
    crotch = legs[0]
    hips = np.zeros_like(BARE4)
    hips[320:crotch] = True  # the proxy's top (row 80 at quarter scale) to the crotch
    drawn = p & ~(up(box(44, 80, 48, 200)) & hips) & ~(up(box(72, 80, 76, 200)) & hips)  # 8 px inside OUR hips a side
    stripes = np.zeros(BARE4.shape + (3,), np.float64)
    stripes[:] = (170, 30, 40)
    stripes[:, (np.arange(480) // 6) % 2 == 1] = (230, 170, 180)
    gen = render4([(BARE4 & hips & ~drawn, STUDIO), (drawn, stripes)], seed=6)
    same, same_mask, rec = dq.conform_to_proxy(gen, drawn & region, p, BARE4, region, kind="trousers")
    assert not rec["applied"] and (same_mask == (drawn & region)).all() and "trousers" not in dq.CONFORM_KINDS
    before = dq.edge_profile(drawn & region, BARE4, gen, STUDIO, kind="trousers")
    assert before["px"] > 0
    out, mask, er = dq.conform_edges(gen, drawn & region, BARE4, region, STUDIO, kind="trousers")
    # only the garment's first row is left (its core, eroded by 1 px, is empty there): it stays counted
    assert er["applied"] and er["capped_rows"] <= 2
    after = dq.edge_profile(mask, BARE4, out, STUDIO, kind="trousers")
    assert after["px"] <= 2 * 8 and after["px"] < before["px"] / 20
    assert not (BARE4 & hips & region & ~mask)[legs[0] - 40:legs[0]].any()  # our hips covered
    assert (mask[crotch:] == (drawn & region)[crotch:]).all() and (out[crotch:] == gen[crotch:]).all()  # legs as drawn
    assert dq.width_steps(mask, BARE4, kind="trousers", step_px=6, proxy=p)["steps"] == []
    q = dq.still_qa(mask, BARE4 | mask, BARE4, p, region, kind="trousers", edges=dq.edge_profile(mask, BARE4, out, STUDIO, kind="trousers"))
    assert not q["type_failures"], q["type_failures"]


def test_composite_mask_closes_a_notch_below_the_proxy_but_not_with_the_floor():
    """0.9.0 (review of 0.8.0): run 15's blouse front, the shirt-tail drawn below the proxy's hem and missed by the chosen
    mask, was left out of the composite (a straight cut, our grey below it): now added when it joins the garment and is
    not grey. The engine's floor (white highlight, grey shadow) over our feet is not added."""
    region, _ = dq.edit_region(TOP4, BARE4, "tops")
    tail = up(box(44, 125, 76, 131)) & region & ~TOP4  # below the proxy, inside the region's margin
    assert tail.sum() > 100
    cream = np.zeros(BARE4.shape + (3,), np.float64)
    cream[:] = (226, 206, 196)  # the print's pale ground, chroma 30
    floor = up(box(46, 131, 74, 133)) & region & ~TOP4 & ~tail
    gen = render4([(TOP4, print4()), (tail, cream), (floor, (250, 250, 250))], seed=7)
    chosen = TOP4 & ~up(box(60, 115, 76, 125))  # the difference mask missed the right side of the hem
    garment, rec = dq.still_garment_mask(gen, chosen, BARE4, TOP4, region, bg=STUDIO)
    assert garment[tail].mean() > 0.95 and rec["added_outside_px"] > 0
    assert not garment[floor].any()
    bare_rgb = render4([], seed=7)
    hole = dq.unpasted_cloth(gen, garment & ~tail, bare_rgb, BARE4, region, STUDIO, rec["mannequin"])
    assert hole["frac"] > dq.STILL_QA_THRESHOLDS["max_unpasted_frac"] and hole["px"] >= 0.9 * (tail & BARE4).sum()  # on our body only
    ok = dq.unpasted_cloth(gen, garment, bare_rgb, BARE4, region, STUDIO, rec["mannequin"])
    assert ok["px"] == 0
    # The QA lists it as a TYPE failure (a notch the video would carry), never overridden.
    q = dq.still_qa(garment & ~tail, BARE4 | garment, BARE4, TOP4, region, kind="top", unpasted=hole)
    assert any(f.startswith("garment cut by the composite") for f in q["type_failures"]), q["failures"]


def test_pick_engine_prefers_a_candidate_without_a_type_failure():
    fashn = {"engine": "fashn", "qa": {"pass": False, "score": 0.95, "failures": ["legs merged"], "type_failures": ["legs merged"], "fidelity": {"pass": True, "score": 0.9}}}
    qwen = {"engine": "qwen", "qa": {"pass": False, "score": 0.80, "failures": ["silhouette band"], "type_failures": [], "fidelity": {"pass": True, "score": 0.6}}}
    d = dq.pick_engine([fashn, qwen])
    assert d["engine"] == "qwen" and d["type_failed"] == ["fashn"]
    d2 = dq.pick_engine([fashn])
    assert d2["engine"] == "fashn"  # every candidate has one: shown as rejected, the gate stops it


# --- 6. the app wires it in --------------------------------------------------------------------------------


def test_stage1_app_uses_the_run15_fixes():
    with open(os.path.join(MODAL_DIR, "stage1_dress.py"), encoding="utf-8") as f:
        src = f.read()
    for needle in ("dq.clean_source_mask(smask_sam)", "dq.compose_candidate(gen_np, chosen_mask, bare_mask, bare_np, proxy_q, region, bg, kind=kind, gap=crotch_gap)", "unpasted=unpasted",
                   "gap_body=comp[\"gap_mannequin\"]",
                   "open_crotch=crotch_gap", "keep_visible=crotch_gap", "dq.engine_target(", "dq.view_agreement(", "dq.apply_view_agreement(",
                   "dq.still_qa(garment, fg, bare_mask, proxy_q, region", "edges=edges, side=side", "_chosen_mask.png",
                   "dq.pick_engine(candidates, prefer=", "dq.view_colour(", "dq.apply_view_colour(", "_conformed.png"):
        assert needle in src, needle
    assert dq.STAGE1B_QA_VERSION == "stage1b-qa-0.10.1"
    json.dumps(dq.VIEW_THRESHOLDS)


def test_rescore_rebuilds_the_app_path_only_for_jobs_before_0_8_0():
    assert dq._version_at_least("stage1b-qa-0.8.0", (0, 8, 0)) and dq._version_at_least("stage1b-qa-0.10.1", (0, 8, 0))
    assert not dq._version_at_least("stage1b-qa-0.7.0", (0, 8, 0)) and not dq._version_at_least(None, (0, 8, 0))
    assert not dq._version_at_least("garbage", (0, 8, 0))
    with pytest.raises(ValueError):
        dq.rescore_job("/nonexistent", {"stage1b": {}}, path="both")
