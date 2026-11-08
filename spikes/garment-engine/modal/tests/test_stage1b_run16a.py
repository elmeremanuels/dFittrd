"""Stage 1b after run 16a (stage1b-qa-0.10.0): the defects five independent reviews found in run 16a's stills that QA 0.9.0
passed, each as a synthetic scene (the 480x832 layout of test_stage1b_run15.py; numpy only):

- holes along the palazzo's legs: the mannequin colour model excluded a grey print OFF our body (composite + unpasted)
- grey shoulder caps and a grey band along the sleeves: the engines draw a narrower shoulder than ours (conform_edges,
  edge_profile, the `body_beside` type check)
- the yoke shelf above the palazzo's legs: the trouser conform to a stepped proxy (no proxy conform for trousers,
  width_steps)
- the palazzo's crotch split 26 rows high with our thighs in it (crotch_height)
- a mixed-engine pair and a back in another colour (pick_engine prefer, view_colour)
- the cardigan's sleeves swapped left/right on the back (side_colour)
- the skirt's front waist 26 px below its back's (view_agreement top gap)
- the blouse's difference mask counting bare forearm as garment (still_garment_mask bare_rgb)
- the back prompt carrying the front's buttons (back_description)
- the replay of a 0.9.0 job (unconform_mask) and the CPU recompose run 16b uses (recompose_job, run_phase0 options)
- 0.10.1 (review of 0.10.0): the palazzo's crotch strip showing our grey thighs where the engine drew cloth
  (paste_gap_cloth, gap_mannequin), the pixel hash a reviewed still is pinned by (--dress-expect), the beside-text
Run 16a's real stills are not fixtures (shop photos stay out of git); their numbers are in the README."""
import json
import os
import sys

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
sys.path.insert(0, MODAL_DIR)
sys.path.insert(0, HERE)

import phase0_dress as dq  # noqa: E402
import phase0_lib as lib  # noqa: E402
from test_stage1b_run15 import BARE4, STUDIO, TOP4, TROUSERS4, box, print4, render4, up  # noqa: E402


def stripes(a=(170, 30, 40), b=(230, 170, 180)):
    img = np.zeros(BARE4.shape + (3,), np.float64)
    img[:] = a
    img[:, (np.arange(480) // 6) % 2 == 1] = b
    return img


# --- 1. off our body: a grey print is cloth, a grey leg the engine drew is not -----------------------------


def test_composite_pastes_a_grey_print_off_our_body_but_not_a_leg_the_engine_drew():
    """Run 16a's palazzo front (Qwen): grey-blue print patches on the proxy's legs beside our slimmer legs were excluded as
    mannequin and the composite showed studio background there (992 px of holes, unseen by 0.9.0). A grey body the engine
    drew under the hem (run 14's azure: FASHN's legs beside ours) must still stay out."""
    gap = dq.trouser_gap_zone(TROUSERS4, BARE4)
    region, _ = dq.edit_region(TROUSERS4, BARE4, "bottoms", open_crotch=gap)
    p = dq.qa_proxy(TROUSERS4, gap)
    off = p & ~dq.pg.dilate(BARE4, 2)
    patch = off & up(box(40, 140, 50, 150))  # grey print inside the left leg, off our body
    hem = np.zeros_like(BARE4)
    hem[:720] = True
    trousers = p & hem
    leg = off & up(box(40, 182, 50, 194))  # below the hem: a grey leg the engine drew beside ours
    gen = render4([(trousers, stripes()), (patch, (122, 122, 124)), (leg, (110, 110, 110))], seed=11)
    chosen = trousers & ~patch & region
    garment, rec = dq.still_garment_mask(gen, chosen, BARE4, p, region, bg=STUDIO)
    assert garment[patch & region].mean() > 0.9, garment[patch & region].mean()
    assert not garment[leg].any()
    bare_rgb = render4([], seed=11)
    # 0.9.0 counted our body only; the hole off it is now counted, and the grey leg is not
    hole = dq.unpasted_cloth(gen, chosen, bare_rgb, BARE4, region, STUDIO, rec["mannequin"], proxy=p)
    assert hole["off_body_px"] >= 0.8 * (patch & region).sum()
    ok = dq.unpasted_cloth(gen, garment, bare_rgb, BARE4, region, STUDIO, rec["mannequin"], proxy=p)
    assert ok["off_body_px"] == 0
    legacy = dq.unpasted_cloth(gen, chosen, bare_rgb, BARE4, region, STUDIO, rec["mannequin"])
    assert legacy["off_body_px"] == 0  # without the proxy: the 0.9.0 measure, blind to it


def test_composite_drops_bare_mannequin_the_difference_mask_counted_as_garment():
    """Run 16a's blouse front: the difference prior (SAM 2 disagreed) counted the bare forearm below Qwen's short sleeves as
    garment; sleeve cover and the views' sleeve gap were measured on it. With our bare render the pixels that ARE our
    mannequin and join the bare body outside the mask are dropped (the composite shows the same pixels either way)."""
    region, _ = dq.edit_region(TOP4, BARE4, "tops")
    forearm = up(box(33, 64, 43, 80)) | up(box(77, 64, 87, 80))
    gen = render4([(TOP4 & ~forearm, print4())], seed=12)
    bare_rgb = render4([], seed=13)
    chosen = TOP4 & region
    plain, _ = dq.still_garment_mask(gen, chosen, BARE4, TOP4, region)
    garment, rec = dq.still_garment_mask(gen, chosen, BARE4, TOP4, region, bare_rgb=bare_rgb)
    assert plain[forearm & BARE4].mean() > 0.99  # 0.9.0: kept
    assert rec["dropped_mannequin_px"] > 0.9 * (forearm & BARE4 & region).sum() and not garment[forearm & BARE4].any()
    before = dq.garment_body(plain, TOP4, BARE4, kind="top", erode_px=8)
    after = dq.garment_body(garment, TOP4, BARE4, kind="top", erode_px=8)
    assert after["sleeve_cover"] < before["sleeve_cover"] - 0.2 and after["see_through"] <= before["see_through"] + 0.001


# --- 2. our body beside the cloth: conformed, and what is left fails ---------------------------------------


def shoulder_scene(seed=14):
    """A top drawn 8 px (at 832) narrower than our arms on their outer side down to the elbow, background painted there
    (run 16a: azure's shoulder caps, the cardigan's band along the sleeves)."""
    region, _ = dq.edit_region(TOP4, BARE4, "tops")
    cut = up(box(33, 44, 36, 70)) | up(box(84, 44, 87, 70))  # the sleeve's outer 12 px, 8 of them on our arm
    wedge = cut & BARE4
    garment = TOP4 & ~cut & region
    gen = render4([(cut, STUDIO), (TOP4 & ~cut, print4())], seed=seed)
    return region, wedge, garment, gen


def test_conform_edges_covers_our_body_beside_the_cloth_with_the_engines_own_pixels():
    region, wedge, garment, gen = shoulder_scene()
    before = dq.edge_profile(garment, BARE4, gen, STUDIO, kind="top")
    assert before["px"] >= 0.9 * wedge.sum() and before["max_px"] == 16  # 8 px a side, both sides of a row
    out, mask, rec = dq.conform_edges(gen, garment, BARE4, region, STUDIO, kind="top")
    assert rec["applied"] and rec["rows"] > 90 and rec["max_px"] <= 9
    after = dq.edge_profile(mask, BARE4, out, STUDIO, kind="top")
    assert after["px"] <= 0.05 * before["px"], after
    assert (mask[wedge]).mean() > 0.95
    # only the outer band moves: the middle of the body is the engine's own pixels, untouched
    assert (out[:, 200:280] == gen[:, 200:280]).all() and (mask[:, 200:280] == garment[:, 200:280]).all()
    # never narrows, stays in the region
    assert (mask >= garment).all() and not (mask & ~region & ~garment).any()
    # a top drawn over our arms needs nothing
    _, same, rec2 = dq.conform_edges(render4([(TOP4, print4())]), TOP4 & region, BARE4, region, STUDIO, kind="top")
    assert not rec2["applied"] and (same == (TOP4 & region)).all()


def test_our_body_beside_the_cloth_is_a_type_failure_when_it_is_left():
    region, wedge, garment, gen = shoulder_scene()
    edges = dq.edge_profile(garment, BARE4, gen, STUDIO, kind="top")
    q = dq.still_qa(garment, BARE4 | garment, BARE4, TOP4, region, kind="top", edges=edges)
    assert any(f.startswith("our mannequin beside the garment") for f in q["type_failures"]), q["failures"]
    assert q["body_beside"]["px"] == edges["px"]
    out, mask, _ = dq.conform_edges(gen, garment, BARE4, region, STUDIO, kind="top")
    q2 = dq.still_qa(mask, BARE4 | mask, BARE4, TOP4, region, kind="top", edges=dq.edge_profile(mask, BARE4, out, STUDIO, kind="top"))
    assert not any(f.startswith("our mannequin beside") for f in q2["failures"]), q2["failures"]
    # an arm the engine drew (mannequin grey, not background) beside a sleeveless top is not "beside the cloth"
    gen_arm = render4([(TOP4 & ~(up(box(33, 44, 36, 70)) | up(box(84, 44, 87, 70))), print4())], seed=14)
    assert dq.edge_profile(garment, BARE4, gen_arm, STUDIO, kind="top")["px"] == 0


def test_compose_candidate_is_the_app_path_and_records_each_step():
    region, wedge, garment, gen = shoulder_scene()
    img, mask, rec = dq.compose_candidate(gen, garment, BARE4, render4([], seed=14), TOP4, region, STUDIO, kind="top")
    assert set(rec) == {"composite_mask", "conform", "conform_edges", "unpasted", "edges", "gap_mannequin"}
    assert rec["gap_mannequin"] is None  # not trousers: no strip
    assert rec["conform_edges"]["applied"] and not rec["conform"]["applied"]  # a top: no hip conform
    assert rec["edges"]["px"] <= 0.05 * wedge.sum() and mask[wedge].mean() > 0.95


# --- 3. the shelf and the high crotch --------------------------------------------------------------------


def test_a_step_in_the_outline_is_a_shelf_and_a_taper_is_not():
    """Run 16a's palazzo back: hips stretched to the proxy's hip block over legs left as drawn, 8 / 12 px steps at row 448."""
    skirt_p = up(box(44, 80, 76, 196))
    region, _ = dq.edit_region(skirt_p, BARE4, "bottoms")
    shelf = up(box(42, 80, 78, 112)) | up(box(45, 112, 75, 196))  # 12 px a side at 832
    q = dq.still_qa(shelf & region, BARE4 | shelf, BARE4, skirt_p, region, kind="skirt")
    assert any(f.startswith("shelf in the outline") for f in q["type_failures"]), q["failures"]
    assert q["width_steps"]["max_step_px"] >= 12
    taper = np.zeros_like(BARE4)
    for y in range(320, 784):
        half = 128 - int((y - 320) * 8 / 464)  # 8 px narrower a side over the whole length: no step
        taper[y, 240 - half:240 + half] = True
    q2 = dq.still_qa(taper & region, BARE4 | taper, BARE4, skirt_p, region, kind="skirt")
    assert q2["width_steps"]["steps"] == [] and not any(f.startswith("shelf") for f in q2["failures"])
    assert dq.width_steps(shelf, BARE4, kind="top", step_px=6)["steps"] == []  # a top's outline jumps at the armpits


def test_trousers_split_far_above_the_proxys_crotch_with_our_mannequin_between_fail():
    """Run 16a's palazzo (FASHN, both views): the legs split at row 436, 26 rows above the proxy's 462, our grey thighs
    between them; Qwen's split on the proxy's line."""
    gap = dq.trouser_gap_zone(TROUSERS4, BARE4)
    region, _ = dq.edit_region(TROUSERS4, BARE4, "bottoms", open_crotch=gap)
    p = dq.qa_proxy(TROUSERS4, gap)
    ok = dq.crotch_height(p, p, BARE4)
    assert ok["rise_px"] == 0
    pc = ok["proxy_crotch_row"]
    high = p.copy()
    high[pc - 28:pc, 220:260] = False  # an inverted V 28 rows high, our thighs in it
    c = dq.crotch_height(high, p, BARE4)
    assert c["rise_px"] >= 25 and c["mannequin_above_proxy_crotch_px"] > 150
    q = dq.still_qa(high & region, BARE4 | high, BARE4, p, region, kind="trousers", garment_full=high)
    assert any(f.startswith("crotch too high") for f in q["type_failures"]), q["failures"]
    q_ok = dq.still_qa(p & region, BARE4 | p, BARE4, p, region, kind="trousers", garment_full=p)
    assert not any(f.startswith("crotch") for f in q_ok["failures"])


# --- 4. the pair: same engine, same colour, same waist, sides not swapped --------------------------------


def _cand(engine, fid, score=0.95):
    return {"engine": engine, "qa": {"pass": True, "score": score, "type_failures": [], "fidelity": {"pass": True, "score": fid}}}


def test_the_back_takes_the_fronts_engine_when_its_fidelity_is_close():
    """Run 16a's palazzo: Qwen front, FASHN back by a 0.003 fidelity margin, two different-looking trousers."""
    d = dq.pick_engine([_cand("fashn", 0.867), _cand("qwen", 0.864)], prefer="qwen")
    assert d["engine"] == "qwen" and "front's engine" in d["reason"]
    d = dq.pick_engine([_cand("fashn", 0.90), _cand("qwen", 0.86)], prefer="qwen")  # beyond the margin: the better one
    assert d["engine"] == "fashn"
    failing = _cand("qwen", 0.87)
    failing["qa"]["pass"] = False
    assert dq.pick_engine([_cand("fashn", 0.80), failing], prefer="qwen")["engine"] == "fashn"  # never a failing still
    assert dq.pick_engine([_cand("fashn", 0.867), _cand("qwen", 0.864)])["engine"] == "fashn"


def _solid(rgb, mask):
    img = np.zeros(mask.shape + (3,), np.uint8)
    img[:] = rgb
    return img, mask


def test_front_and_back_stills_must_agree_in_colour_about_as_well_as_the_shop_photos():
    """Run 16a's blouse: a cream front and a dark orange-brown back (dE 13.7) where the shop photos differ by 4.7."""
    m = np.ones((40, 40), bool)
    shop_f, shop_b = _solid((210, 180, 165), m), _solid((204, 178, 166), m)
    same = dq.view_colour(_solid((171, 151, 140), m), _solid((168, 150, 141), m), shop_f, shop_b)
    assert same["pass"] and same["limit"] == dq.VIEW_COLOUR["min_limit_delta_e"]
    off = dq.view_colour(_solid((171, 151, 140), m), _solid((155, 119, 104), m), shop_f, shop_b)
    assert off["pass"] is False and off["delta_e"] > 10
    qa = {"pass": True, "failures": [], "type_failures": []}
    dq.apply_view_colour(qa, off)
    assert not qa["pass"] and qa["failures"][0].startswith("views disagree: front and back stills differ in colour") and qa["type_failures"] == []
    # a shop pair that itself differs a lot widens the limit
    wide = dq.view_colour(_solid((171, 151, 140), m), _solid((155, 119, 104), m), _solid((230, 230, 230), m), _solid((120, 60, 40), m))
    assert wide["pass"]


def _two_sides(left, right, mid=(230, 220, 205)):
    img = np.zeros((60, 100, 3), np.uint8)
    img[:] = mid
    img[:, :15] = left
    img[:, 85:] = right
    return img, np.ones((60, 100), bool)


def test_sleeves_swapped_or_lost_against_the_shop_photo_of_the_same_view_fail():
    """Run 16a's cardigan back (Qwen): camel sleeve viewer-left and brown viewer-right in the shop back, the other way round
    in the still; FASHN's back drew both sleeves cream."""
    camel, brown, cream = (174, 140, 115), (81, 39, 26), (225, 215, 200)
    shop = _two_sides(camel, brown)
    assert dq.side_colour(*_two_sides(camel, brown), *shop)["pass"]
    sw = dq.side_colour(*_two_sides(brown, camel), *shop)
    assert sw["pass"] is False and sw["cosine"] < 0 and "swapped" in sw["failures"][0]
    lost = dq.side_colour(*_two_sides(cream, cream), *shop)
    assert lost["pass"] is False and "lost" in lost["failures"][0]
    plain = dq.side_colour(*_two_sides(brown, camel), *_two_sides(cream, cream))
    assert plain["pass"] and "alike" in plain["note"]
    region = np.ones((60, 100), bool)
    q = dq.still_qa(region, region, region, region, region, kind="top", side=sw)
    assert any(f.startswith("side colours: left and right swapped") for f in q["failures"]) and not q["type_failures"]


def test_a_skirts_waistband_must_sit_at_the_same_height_front_and_back():
    """Run 16a's skirt: the front's waistband 26 px below the back's (top offsets 0.113 vs 0.040 of the proxy's length)."""
    skirt_p = up(box(44, 87, 76, 176))
    back = skirt_p.copy()
    front = skirt_p.copy()
    front[:348 + 40] = False
    bf = dq.garment_body(front, skirt_p, BARE4, kind="skirt", erode_px=8)
    bb = dq.garment_body(back, skirt_p, BARE4, kind="skirt", erode_px=8)
    assert bb["top_offset"] == 0.0 and bf["top_offset"] > 0.1
    va = dq.view_agreement(bf, bb)
    assert va["pass"] is False and va["top_gap"] > dq.VIEW_THRESHOLDS["max_view_top_gap"] and "waist" in va["failures"][0]
    assert dq.view_agreement(bb, bb)["pass"]
    tops = dq.garment_body(TOP4, TOP4, BARE4, kind="top", erode_px=8)
    assert tops["top_offset"] is None  # a top's neckline differs front to back by design


# --- 5. the back prompt ------------------------------------------------------------------------------------


def test_the_back_prompt_drops_the_fronts_neckline_and_buttons():
    """Run 16a's cardigan back: "with a deep V neckline open to the underbust, buttoned below it" and Qwen drew a button."""
    d = "a long-sleeved cardigan in a heavy acrylic and wool fabric, with a deep V neckline open to the underbust, buttoned below it"
    assert lib.back_description(d) == "a long-sleeved cardigan in a heavy acrylic and wool fabric"
    keep = "an ankle-length maxi A-line skirt in a fluid viscose fabric, worn at the waist on a bare torso, one closed skirt that falls from the waist to the hem and covers both legs"
    assert lib.back_description(keep) == keep
    m = {"category": "outerwear", "product_name": "Woodstock", "prompt": {"description": d}, "control": {"proxy": {"kind": "outerwear"}}}
    back, neg = lib.qwen_dress_prompt(m, "back", False)
    assert "buttoned" not in back and "neckline open" not in back and lib.QWEN_BACK_NEGATIVE in neg
    front, fneg = lib.qwen_dress_prompt(m, "front", False)
    assert "buttoned below it" in front and lib.QWEN_BACK_NEGATIVE not in fneg
    inv, _ = lib.qwen_dress_prompt(m, "back", True)  # an invented back copies the dressed front still: unchanged
    assert "buttoned below it" in inv


# --- 6. replays and the run 16b recompose -------------------------------------------------------------------


def test_unconform_mask_inverts_the_hip_conform_for_a_replay_of_a_0_9_0_job():
    skirt_p = up(box(44, 80, 76, 196))
    region, _ = dq.edit_region(skirt_p, BARE4, "bottoms")
    drawn = up(box(46, 80, 74, 196)) & region
    gen = render4([(drawn, stripes())], seed=15)
    out, mask, rec = dq.conform_to_proxy(gen, drawn, skirt_p, BARE4, region, kind="skirt")
    assert rec["applied"]
    back, urec = dq.unconform_mask(out, gen, mask)
    assert urec["rows"] >= rec["rows"] - 2 and urec["median_match_error_8bit"] < 3
    assert dq.pg.iou(back, drawn) > 0.98 and dq.pg.iou(mask, drawn) < dq.pg.iou(back, drawn)


def _write(path, arr):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = np.asarray(arr)
    Image.fromarray(a.astype(np.uint8) * 255 if a.dtype == bool else a.astype(np.uint8)).save(path)


def synthetic_job(tmp_path, *, hash_in_record="h" * 64):
    """A finished stage 1b job of a top (0.9.0 layout: raw outputs, saved composite masks, record.json), both views by
    Qwen, the right shoulder cap left grey as in run 16a."""
    job = str(tmp_path / "job")
    region, wedge, garment, gen = shoulder_scene(seed=16)
    views = []
    for name, frame in (("front", 0), ("back", 80)):
        _write(f"{job}/dress/bare_{name}.png", render4([], seed=17))
        _write(f"{job}/dress/bare_mask_{name}.png", BARE4)
        _write(f"{job}/dress/proxy_mask_{name}.png", TOP4)
        _write(f"{job}/dress/proxy_{name}.png", render4([(TOP4, (184, 173, 158))], seed=18))
        _write(f"{job}/stage1b/raw/{name}_qwen.png", gen)
        _write(f"{job}/stage1b/candidates/{name}_qwen_garment_mask.png", garment)
        views.append({"view": name, "frame": frame, "invented": False, "bare_rgb": f"dress/bare_{name}.png", "bare_mask": f"dress/bare_mask_{name}.png",
                      "proxy_mask": f"dress/proxy_mask_{name}.png", "proxy_rgb": f"dress/proxy_{name}.png", "still": f"stage1b/{name}.png",
                      "garment_mask": f"stage1b/garment_mask_{name}.png"})
    m = {"job_id": "top-1", "input_hash": "h" * 64, "category": "top", "control": {"proxy": {"kind": "top"}},
         "stage1b": {"views": views, "sources": [], "background_rgb": list(STUDIO), "invented_back": False, "target": {"proxy_kind": "top"}}}
    rec = {"job_id": "top-1", "input_hash": hash_in_record, "qa_version": "stage1b-qa-0.9.0", "engine": "qwen",
           "views": [{"view": v["view"], "candidates": [{"engine": "qwen", "mask_source": "sam2"}]} for v in views]}
    with open(f"{job}/stage1b/record.json", "w") as f:
        json.dump(rec, f)
    _write(f"{job}/stage1b/front.png", gen)  # the 0.9.0 still, with the grey cap
    return job, m


def test_recompose_remakes_the_stills_from_the_saved_raw_outputs_and_keeps_the_runs_record(tmp_path):
    job, m = synthetic_job(tmp_path)
    old_front = np.asarray(Image.open(f"{job}/stage1b/front.png"))
    rec = dq.recompose_job(job, m, pins={"front": "qwen", "back": "qwen"})
    assert rec["qa_version"] == dq.STAGE1B_QA_VERSION and rec["recomposed"]["from_qa_version"] == "stage1b-qa-0.9.0"
    assert os.path.exists(f"{job}/stage1b/record.before_recompose.json")
    for v in rec["views"]:
        assert v["engine"] == "qwen"
        cand = v["candidates"][0]
        assert cand["conform_edges"]["applied"] and cand["qa"]["body_beside"]["px"] <= 20
        assert cand["composite_mask"]["chosen_basis"].startswith("the saved composite mask")
    assert rec["summary"]["usable_for_stage2"], [v["qa"]["failures"] for v in rec["views"]]
    new_front = np.asarray(Image.open(f"{job}/stage1b/front.png"))
    assert (new_front != old_front).any() and os.path.exists(f"{job}/stage1b/garment_mask_back.png")
    with open(f"{job}/stage1b/record.json") as f:
        assert json.load(f)["recomposed"]["pins"] == {"front": "qwen", "back": "qwen"}
    # deterministic, and a second recompose starts from the engine run's record
    again = dq.recompose_job(job, m, pins={"front": "qwen", "back": "qwen"})
    assert (np.asarray(Image.open(f"{job}/stage1b/front.png")) == new_front).all()
    assert again["recomposed"]["from_qa_version"] == "stage1b-qa-0.9.0"
    with pytest.raises(ValueError, match="pinned engine"):
        dq.recompose_job(job, m, pins={"front": "fashn"})


def test_recompose_refuses_a_record_for_other_inputs(tmp_path):
    job, m = synthetic_job(tmp_path, hash_in_record="x" * 64)
    with pytest.raises(ValueError, match="input_hash"):
        dq.recompose_job(job, m)
    with pytest.raises(FileNotFoundError):
        dq.recompose_job(str(tmp_path / "nothing"), m)


def test_dress_pins_parse_and_refuse_nonsense():
    assert lib.parse_dress_pins("front=qwen, back=fashn") == {"front": "qwen", "back": "fashn"}
    assert lib.parse_dress_pins("") == {} and lib.parse_dress_pins(None) == {}
    for bad in ("side=qwen", "front=idm", "front"):
        with pytest.raises(ValueError):
            lib.parse_dress_pins(bad)


def test_run_phase0_reuse_options_refuse_a_new_draw_and_a_record_for_other_inputs():
    pytest.importorskip("modal")
    import run_phase0

    mode = lambda **kw: run_phase0._reuse_mode(**{"dress": False, "dress_only": False, "reuse_dress": False, "recompose_dress": False, "dress_pin": "", **kw})  # noqa: E731
    assert mode() is None and mode(reuse_dress=True) == "reuse" and mode(recompose_dress=True, dress_pin="front=qwen") == "recompose"
    for bad in ({"reuse_dress": True, "recompose_dress": True}, {"recompose_dress": True, "dress": True}, {"reuse_dress": True, "dress_only": True},
                {"dress_pin": "front=qwen"}, {"reuse_dress": True, "dress_pin": "front=qwen"}):
        with pytest.raises(SystemExit):
            mode(**bad)
    with pytest.raises(ValueError):
        mode(recompose_dress=True, dress_pin="front=idm")
    m = {"job_id": "a-1", "input_hash": "h"}
    ok = {"job_id": "a-1", "input_hash": "h", "summary": {}, "views": []}
    assert run_phase0._reused_record_problem(m, ok) is None
    assert "input_hash" in run_phase0._reused_record_problem(m, {**ok, "input_hash": "x"})
    assert "job" in run_phase0._reused_record_problem(m, {**ok, "job_id": "b-2"})
    assert "summary" in run_phase0._reused_record_problem(m, {"job_id": "a-1", "input_hash": "h"})
    with open(os.path.join(MODAL_DIR, "run_phase0.py"), encoding="utf-8") as f:
        src = f.read()
    assert "stage1_dress.recompose.remote(job_id" in src and "_dress_gate(m, job_dir, dress_record" in src


# --- 0.10.1: the trouser gap strip (review of 0.10.0) --------------------------------------------------------


def _crotch_scene():
    """Our thighs touching below the crotch (rows 480-560 at 4x: inside the gap strip), trousers drawn across the strip with
    the engine's own narrow background gap from row 560 down."""
    gap = dq.trouser_gap_zone(TROUSERS4, BARE4)
    region, _ = dq.edit_region(TROUSERS4, BARE4, "bottoms", open_crotch=gap)
    p = dq.qa_proxy(TROUSERS4, gap)
    bare = BARE4.copy()
    bare[480:560, 228:252] = True
    assert (gap & bare).sum() > 600
    cloth = (TROUSERS4 | gap) & ~up(box(59, 140, 61, 200))  # an 8 px slit of studio background from row 560
    rng = np.random.default_rng(21)

    def render(layers):
        img = np.empty(bare.shape + (3,), np.float64)
        img[:] = STUDIO
        img[bare] = (117, 117, 117)
        for m, c in layers:
            img[m] = c[m] if np.ndim(c) == 3 else c
        return np.clip(np.rint(img + rng.normal(0, 1.5, img.shape)), 0, 255).astype(np.uint8)

    gen = render([(cloth, stripes())])
    return gap, region, p, bare, render([]), gen, cloth & region


def test_the_trouser_gap_strip_pastes_the_cloth_the_engine_drew_and_flags_our_thighs_left_in_it():
    """Run 16a's palazzo on 0.10.0 (Qwen, both views): the strip between the legs (out of the edit region) showed our bare
    render, two grey thigh wedges cut straight at the crotch row, where Qwen drew closed cloth (front 715, back 657 px) and
    QA passed it. 0.10.1 pastes the engine's cloth there and fails what of our body is left (`our mannequin in the crotch`)."""
    gap, region, p, bare, bare_rgb, gen, chosen = _crotch_scene()
    # 0.10.0: no strip given, nothing pasted in it: our thighs show, and the new check sees them
    img0, g0, rec0 = dq.compose_candidate(gen, chosen, bare, bare_rgb, p, region, STUDIO, kind="trousers")
    assert rec0["gap_mannequin"] is None and not (g0 & gap & bare).any()
    left = dq.gap_mannequin(g0, bare, img0, gap, STUDIO)
    assert left["px"] > 600 and left["raw_cloth_px"] > 600
    q0 = dq.still_qa(g0, bare | g0, bare, p, region, kind="trousers", garment_full=g0, gap_body=left)
    assert any(f.startswith("our mannequin in the crotch") for f in q0["type_failures"]), q0["failures"]
    # 0.10.1: the cloth is pasted, the engine's own gap stays open, nothing of our body is left in the strip
    img, g, rec = dq.compose_candidate(gen, chosen, bare, bare_rgb, p, region, STUDIO, kind="trousers", gap=gap)
    gm = rec["gap_mannequin"]
    assert gm["px"] <= 40 and gm["pasted_px"] > 600, gm
    slit = up(box(59, 140, 61, 196))
    assert not g[slit & ~bare].any()
    q = dq.still_qa(g, bare | g, bare, p, region, kind="trousers", garment_full=g, gap_body=gm)
    assert not any(f.startswith("our mannequin in the crotch") for f in q["failures"]), q["failures"]
    assert q["gap_mannequin"]["px"] == gm["px"]


def test_our_thighs_the_engine_drew_in_the_strip_stay_out_and_fail():
    """An engine that kept our grey thighs in the strip (FASHN's palazzo, run 16a: 696 px) is not pasted (it is our body,
    not cloth) and the strip check fails it."""
    gap, region, p, bare, bare_rgb, gen, chosen = _crotch_scene()
    thighs = gap & bare
    gen2 = gen.copy()
    gen2[thighs] = bare_rgb[thighs]
    img, g, rec = dq.compose_candidate(gen2, chosen & ~thighs, bare, bare_rgb, p, region, STUDIO, kind="trousers", gap=gap)
    assert rec["gap_mannequin"]["px"] > 0.8 * thighs.sum()
    q = dq.still_qa(g, bare | g, bare, p, region, kind="trousers", garment_full=g, gap_body=rec["gap_mannequin"])
    assert any(f.startswith("our mannequin in the crotch") for f in q["type_failures"])


def test_gap_mannequin_ignores_our_ankles_below_the_hems():
    gap, region, p, bare, bare_rgb, gen, chosen = _crotch_scene()
    short = np.zeros_like(bare)
    short[:600] = True
    img, g, rec = dq.compose_candidate(gen, chosen & short, bare, bare_rgb, p, region, STUDIO, kind="trousers", gap=gap & short)
    full_gap = dq.gap_mannequin(g, bare, img, gap, STUDIO)
    assert full_gap["rows"] is None or full_gap["rows"][1] < 600


def test_pixel_hash_is_of_the_decoded_pixels_and_dress_expect_checks_it(tmp_path):
    a = np.random.default_rng(3).integers(0, 255, (8, 6, 3), dtype=np.uint8)
    h = lib.pixel_sha256(a.tobytes(), 6, 8)
    for lvl in (0, 9):  # another PNG encoder setting: other file bytes, same pixels
        Image.fromarray(a).save(tmp_path / f"a{lvl}.png", compress_level=lvl)
        b = np.asarray(Image.open(tmp_path / f"a{lvl}.png").convert("RGB"))
        assert lib.pixel_sha256(b.tobytes(), 6, 8) == h
    assert lib.pixel_sha256(a.tobytes(), 8, 6) != h  # the size is part of it
    with pytest.raises(ValueError):
        lib.pixel_sha256(a.tobytes(), 5, 8)
    assert lib.parse_dress_expect(f"front={h[:12]}, back={h.upper()}") == {"front": h[:12], "back": h}
    for bad in ("front=abc", "side=" + h, "front=" + "g" * 12):
        with pytest.raises(ValueError):
            lib.parse_dress_expect(bad)
    assert lib.dress_expect_problems({"front": h[:12]}, {"front": h}) == []
    assert "not the one reviewed" in lib.dress_expect_problems({"front": h[:12]}, {"front": "0" * 64})[0]
    assert "no still" in lib.dress_expect_problems({"back": h[:12]}, {"back": None})[0]


def test_recompose_records_the_pixel_hash_and_run_phase0_checks_options_before_the_upload():
    with open(os.path.join(MODAL_DIR, "phase0_dress.py"), encoding="utf-8") as f:
        assert 'rec["still_pixel_sha256"] = lib.pixel_sha256(' in f.read()
    with open(os.path.join(MODAL_DIR, "run_phase0.py"), encoding="utf-8") as f:
        src = f.read()
    body = src[src.index("def main("):]
    assert body.index("_reuse_mode(") < body.index("pm.upload_job(") and body.index("_dress_expect(") < body.index("pm.upload_job(")
    assert "lib.dress_expect_problems(expect, got)" in body and body.index("dress_expect_problems") < body.index("_dress_gate(")


def test_run_phase0_dress_expect_needs_a_reuse_mode():
    pytest.importorskip("modal")
    import run_phase0

    assert run_phase0._dress_expect("recompose", "front=" + "a" * 12) == {"front": "a" * 12}
    assert run_phase0._dress_expect(None, "") == {}
    for reuse, text in ((None, "front=" + "a" * 12), ("recompose", "front=xyz")):
        with pytest.raises(SystemExit):
            run_phase0._dress_expect(reuse, text)


def test_the_beside_failure_names_where_on_the_garment_not_shoulder_caps():
    """Run 16a's skirt front: the 0.10.0 text blamed shoulder caps for the bare belly above a waistband drawn 40 px low."""
    g = np.zeros((832, 480), bool)
    g[360:800, 150:330] = True
    assert "near the garment's top" in dq._edge_where([363, 398], g)
    assert "hem" in dq._edge_where([760, 790], g)
    with open(os.path.join(MODAL_DIR, "phase0_dress.py"), encoding="utf-8") as f:
        assert "(grey shoulder caps or a grey band along a sleeve)\")" not in f.read()
