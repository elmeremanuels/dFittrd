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
    # Run 15's skirt front: drawn narrower and with the waistband lower than the proxy's, but down to the hem. The
    # provisional torso cover fails it; no type check does.
    skirt_proxy = box(44, 80, 76, 196)
    skirt = box(46, 92, 74, 198)
    s = qa(skirt, skirt_proxy, "skirt", "bottoms")
    assert s["type_failures"] == [], s["type_failures"]
    assert s["garment_body"]["body_length"] >= 1.0


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


# --- 5. the app wires it in --------------------------------------------------------------------------------


def test_stage1_app_uses_the_run15_fixes():
    with open(os.path.join(MODAL_DIR, "stage1_dress.py"), encoding="utf-8") as f:
        src = f.read()
    for needle in ("dq.clean_source_mask(smask_sam)", "dq.still_garment_mask(gen_np, chosen_mask, bare_mask, proxy_q, region)",
                   "open_crotch=crotch_gap", "keep_visible=crotch_gap", "dq.engine_target(", "dq.view_agreement(", "dq.apply_view_agreement(",
                   "dq.still_qa(garment, fg, bare_mask, proxy_q, region"):
        assert needle in src, needle
    assert dq.STAGE1B_QA_VERSION == "stage1b-qa-0.7.0"
    json.dumps(dq.VIEW_THRESHOLDS)
