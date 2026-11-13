"""Stage 1b for run 17a (stage1b-qa-0.11.0, qwen-dress-prompt-0.2.0): the three products still open after run 16a / QA 0.10.1
(the skirt's low front waist, the blouse's orange-brown Qwen back, the cardigan's swapped back sleeves) get

- two fixes of our Qwen INPUT: the back no longer carries the open-front negative ("closed pullover, high round neckline", which
  is what the cardigan's shop back shows), the back keeps every part on its side of picture 2, and one colour phrase names both
  views when the two shop cut-outs are one colour (the blouse: "cream" front, "peach" back, dE 4.7);
- a draw plan: several seeds and both engines per view in one container, a view KEPT from run 16a (the skirt's good FASHN back),
  every candidate scored by the replay code, and the front/back PAIR picked only when the pair checks the app already applies
  (back view, view agreement incl. the waistband, view colour) pass. No threshold changes.

Synthetic scenes (the 480x832 layout of test_stage1b_run15.py; numpy only). The CPU replay on run 16a's real outputs is in the
README ("Run 17a")."""
import json
import os
import shutil
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
from test_stage1b_run15 import BARE4, box, up  # noqa: E402
from test_stage1b_run16a import _write, synthetic_job  # noqa: E402

CARDIGAN = "a long-sleeved cardigan in a heavy acrylic and wool fabric, with a deep V neckline open to the underbust, buttoned below it"


def _cardigan_manifest():
    return {"category": "outerwear", "product_name": "Woodstock Wanderer", "prompt": {"description": CARDIGAN},
            "control": {"proxy": {"kind": "outerwear", "front_opening": {"kind": "v"}}}}


# --- 1. the Qwen instruction (qwen-dress-prompt-0.2.0) --------------------------------------------------------------------


def test_the_open_front_negative_is_for_the_front_only():
    """Run 16a's cardigan back NEG carried "closed pullover, jumper closed at the front, high round neckline": its shop back is a
    closed knit with a round neck, so the negative fought picture 2."""
    m = _cardigan_manifest()
    _, fneg = lib.qwen_dress_prompt(m, "front", False)
    _, bneg = lib.qwen_dress_prompt(m, "back", False)
    _, ineg = lib.qwen_dress_prompt(m, "back", True)
    assert lib.QWEN_OPEN_FRONT_NEGATIVE in fneg
    assert lib.QWEN_OPEN_FRONT_NEGATIVE not in bneg and "closed pullover" not in bneg and lib.QWEN_BACK_NEGATIVE in bneg
    assert "closed pullover" not in ineg  # an invented back is a back too


def test_the_back_keeps_every_part_on_its_side_of_picture_2():
    """Run 16a's cardigan back (Qwen): the brown sleeve drawn on the viewer's left, where the shop back shows camel."""
    m = _cardigan_manifest()
    back, _ = lib.qwen_dress_prompt(m, "back", False)
    front, _ = lib.qwen_dress_prompt(m, "front", False)
    assert "on the side of the picture where picture 2 shows it" in back and "left sleeve" in back
    assert "on the side of the picture" not in front
    assert lib.QWEN_PROMPT_VERSION == "qwen-dress-prompt-0.2.0"
    skirt = {"category": "bottom", "product_name": "Crimson", "prompt": {"description": "an ankle-length maxi A-line skirt"}, "control": {"proxy": {"kind": "skirt"}}}
    sback, _ = lib.qwen_dress_prompt(skirt, "back", False)
    assert lib.QWEN_BACK_SIDES in sback and "sleeve" not in sback  # a skirt has no sleeves to name


def test_one_colour_phrase_names_both_views_when_the_cut_outs_are_one_colour():
    """Run 16a's blouse: the front cut-out read "multicolour print on cream" (Lab 79.5/7.9/9.3), the back "on peach"
    (75.1/9.0/10.8), dE 4.7 across a naming boundary; Qwen drew the back orange-brown (dE 19.6 against its front)."""
    blouse = {"front": {"phrase": "multicolour print on cream", "median_lab": [79.5, 7.9, 9.3]},
              "back": {"phrase": "multicolour print on peach", "median_lab": [75.1, 9.0, 10.8]}}
    out = lib.view_colour_phrases(blouse)
    assert out["front"]["phrase"] == out["back"]["phrase"] == "multicolour print on cream"
    assert "front shop cut-out" in out["back"]["source"] and out["back"]["delta_e"] == pytest.approx(4.7, abs=0.1)
    # the cardigan: an argyle front on peach and a plain cream back really differ (dE 15.5): each keeps its own
    cardi = {"front": {"phrase": "multicolour print on peach", "median_lab": [64.1, 9.8, 13.8]},
             "back": {"phrase": "multicolour print on cream", "median_lab": [77.8, 4.3, 9.2]}}
    out = lib.view_colour_phrases(cardi)
    assert out["back"]["phrase"] == "multicolour print on cream" and out["back"]["source"] == "the back shop cut-out"
    assert out["back"]["delta_e"] > lib.SHARED_COLOUR_MAX_DELTA_E
    # no back measured: nothing to share
    assert lib.view_colour_phrases({"front": blouse["front"]})["front"]["phrase"] == "multicolour print on cream"
    # the phrase reaches the instruction as the only colour words
    m = {"category": "top", "product_name": "Rosewater Blouse", "prompt": {"description": "a half-sleeved blouse in a fluid viscose fabric"},
         "control": {"proxy": {"kind": "top"}}}
    text, _ = lib.qwen_dress_prompt(m, "back", False, colour={"phrase": lib.view_colour_phrases(blouse)["back"]["phrase"]})
    assert "colours: multicolour print on cream, as in picture 2" in text and "peach" not in text
    assert lib.SHARED_COLOUR_MAX_DELTA_E == dq.VIEW_COLOUR["min_limit_delta_e"]


# --- 2. draw plans and candidate names ------------------------------------------------------------------------------------


def test_draw_plans_parse_and_refuse_what_cannot_run():
    plan = lib.parse_draw_plan("front=fashn@44-47,qwen@43-44; back=keep:fashn,fashn@44-45,qwen@43")
    assert plan["front"]["draws"] == [["fashn", 44], ["fashn", 45], ["fashn", 46], ["fashn", 47], ["qwen", 43], ["qwen", 44]]
    assert plan["back"] == {"draws": [["fashn", 44], ["fashn", 45], ["qwen", 43]], "keep": {"engine": "fashn", "seed": None}}
    assert lib.draw_plan_engines(plan) == "both" and lib.draw_plan_engines(lib.parse_draw_plan("front=qwen@1;back=qwen@2")) == "qwen"
    assert lib.describe_draw_plan(plan).startswith("front: fashn@44, fashn@45") and "back: keep fashn, fashn@44" in lib.describe_draw_plan(plan)
    assert lib.parse_draw_plan("") is None and lib.parse_draw_plan(None) is None
    assert lib.parse_draw_plan("front=fashn@1;back=keep:qwen@43")["back"]["keep"] == {"engine": "qwen", "seed": 43}
    # 6 FASHN + 3 Qwen draws + a Qwen load: an estimate in the order of run 16a's 195 GPU s for 2 + 2
    assert 300 < lib.draw_plan_seconds(plan) < 400
    for bad in ("front=fashn@44",                      # no back
                "front=fashn@44;back=idm@1",           # unknown engine
                "front=fashn@44,fashn@44;back=qwen@1",  # the same draw twice
                "front=fashn@47-44;back=qwen@1",       # backwards
                "front=fashn@1-30;back=qwen@1",        # more than MAX_PLAN_DRAWS
                "front=keep:fashn;back=keep:qwen",     # nothing drawn: that is --recompose-dress
                "front=fashn@1;back=keep:fashn,keep:qwen",
                "front=fashn@1;back=keep:fashn@43,fashn@43",
                "side=fashn@1;back=qwen@1", "front=fashn@1;front=qwen@1;back=qwen@1", "front=fashn;back=qwen@1"):
        with pytest.raises(ValueError):
            lib.parse_draw_plan(bad)


def test_candidates_are_named_by_engine_and_seed_and_pins_take_the_seed():
    assert lib.candidate_id("fashn", None) == "fashn" and lib.candidate_id("qwen", 44) == "qwen@44"
    assert lib.candidate_stem("front", "fashn") == "front_fashn" and lib.candidate_stem("back", "qwen@44") == "back_qwen_s44"
    assert lib.parse_candidate_stem("back_qwen_s44") == ("back", "qwen@44") and lib.parse_candidate_stem("front_fashn") == ("front", "fashn")
    for not_a_candidate in ("front", "front_fashn_agnostic", "front_idm", "side_qwen_s1", "front_qwen_s"):
        assert lib.parse_candidate_stem(not_a_candidate) is None
    assert lib.parse_dress_pins("front=fashn@45,back=qwen") == {"front": "fashn@45", "back": "qwen"}
    for bad in ("front=fashn@", "front=fashn@x", "front=keep:fashn"):
        with pytest.raises(ValueError):
            lib.parse_dress_pins(bad)


def test_candidate_entries_find_every_draw_in_engine_then_seed_order(tmp_path):
    job = str(tmp_path)
    for stem in ("front_qwen_s44", "front_fashn_s47", "front_fashn_s44", "front_fashn", "back_qwen_s43", "front_qwen_s45"):
        _write(f"{job}/stage1b/raw/{stem}.png", np.zeros((4, 4, 3), np.uint8))
        if stem != "front_qwen_s45":  # no garment mask: not a candidate
            _write(f"{job}/stage1b/candidates/{stem}_garment_mask.png", np.ones((4, 4), bool))
    _write(f"{job}/stage1b/raw/front.png", np.zeros((4, 4, 3), np.uint8))
    _write(f"{job}/stage1b/history/x/raw/front_qwen_s1.png", np.zeros((4, 4, 3), np.uint8))
    assert [c for c, _ in dq.candidate_entries(job, "front")] == ["fashn", "fashn@44", "fashn@47", "qwen@44"]
    assert dq.candidate_entries(job, "back") == [("qwen@43", "back_qwen_s43")]


# --- 3. picking among several draws -------------------------------------------------------------------------------------


def _c(cid, fid, score=0.95, ok=True, fid_ok=True, type_failures=()):
    eng = cid.partition("@")[0]
    return {"id": cid, "engine": eng, "qa": {"pass": ok, "score": score, "type_failures": list(type_failures), "failures": [] if ok else ["x"],
                                            "fidelity": {"pass": fid_ok, "score": fid}}}


def test_pick_engine_names_the_candidate_among_seeds_of_one_engine():
    d = dq.pick_engine([_c("fashn@44", 0.86), _c("fashn@45", 0.90), _c("qwen@44", 0.91)], prefer="fashn")
    # the best FASHN seed (0.90) is within the margin of Qwen's 0.91: the front's engine, and the candidate is named
    assert d["engine"] == "fashn" and d["candidate"] == "fashn@45" and "front's engine" in d["reason"]
    assert set(d["scores"]) == {"fashn@44", "fashn@45", "qwen@44"}
    d = dq.pick_engine([_c("fashn@44", 0.86, ok=False), _c("fashn@45", 0.80, fid_ok=False)])
    assert d["candidate"] == "fashn@44" and d["fidelity_failed"] == ["fashn@45"]
    d = dq.pick_engine([_c("fashn@44", 0.70, fid_ok=False), _c("fashn@45", 0.72, fid_ok=False)])
    assert d["candidate"] is None and d["rejected_still"] == "fashn@45" and dq.shown_candidate(d) == "fashn@45"
    # equal keys: the earlier candidate (the lower seed) wins, so a replay is deterministic
    assert dq.pick_engine([_c("fashn@44", 0.9), _c("fashn@45", 0.9)])["candidate"] == "fashn@44"


def _ok_checks():
    return {"back_view": {"pass": True, "failures": []}, "view_agreement": {"pass": True, "failures": [], "top_gap": 0.0},
            "view_colour": {"pass": True, "failures": [], "delta_e": 2.0}}


def test_pick_pair_takes_only_pairs_whose_pair_checks_pass_and_prefers_one_engine():
    fronts = [_c("fashn@44", 0.92), _c("qwen@44", 0.95), _c("fashn@45", 0.93, ok=False)]
    backs = [_c("fashn@43", 0.89), _c("qwen@43", 0.90)]
    checks = {(f["id"], b["id"]): _ok_checks() for f in fronts for b in backs}
    checks[("qwen@44", "qwen@43")]["view_colour"] = {"pass": False, "failures": ["front and back stills differ in colour: median Delta E 19.6 > 9.5"], "delta_e": 19.6}
    pp = dq.pick_pair(fronts, backs, checks)
    # eligible: fashn@44+fashn@43, fashn@44+qwen@43, qwen@44+fashn@43; one engine first -> FASHN/FASHN
    assert (pp["front"], pp["back"]) == ("fashn@44", "fashn@43") and pp["eligible"] == 3 and "same engine" in pp["reason"]
    rows = {(r["front"], r["back"]): r for r in pp["pairs"]}
    assert len(rows) == 6 and not rows[("qwen@44", "qwen@43")]["eligible"] and rows[("qwen@44", "qwen@43")]["delta_e"] == 19.6
    assert any("view_colour" in f for f in rows[("qwen@44", "qwen@43")]["failures"])
    assert not rows[("fashn@45", "fashn@43")]["eligible"] and "fails its own QA" in rows[("fashn@45", "fashn@43")]["failures"][0]
    # no same-engine pair: the higher of the two views' lower fidelity (fashn@44 + qwen@43: 0.90; qwen@44 + fashn@43: 0.89)
    checks[("fashn@44", "fashn@43")]["view_agreement"] = {"pass": False, "failures": ["front and back differ at the waist"], "top_gap": 0.079}
    pp = dq.pick_pair(fronts, backs, checks)
    assert (pp["front"], pp["back"]) == ("fashn@44", "qwen@43") and pp["eligible"] == 2
    # nothing eligible: no pick, the caller shows the views by pick_engine and the pair checks fail the back
    pp = dq.pick_pair(fronts, backs, {})
    assert pp["front"] is None and pp["back"] is None and pp["eligible"] == 0 and "no eligible pair" in pp["reason"]
    assert all("pair checks not run" in r["failures"] for r in pp["pairs"])


def test_a_kept_back_is_only_paired_with_a_front_whose_waistband_agrees():
    """The skirt: run 16a's FASHN back (waistband 0.034 of the proxy below its top) passes on its own; its FASHN front put the
    waistband at 0.113 (a step at the waist, a TYPE failure of the pair). A kept back must still pass view agreement with the
    front it is paired with: a low front is never picked beside it, a front drawn at the proxy's waist is."""
    skirt_p = up(box(44, 87, 76, 176))
    back = skirt_p.copy()
    low, ok = skirt_p.copy(), skirt_p.copy()
    low[:348 + 40] = False
    ok[:348 + 4] = False
    body = lambda g: dq.garment_body(g, skirt_p, BARE4, kind="skirt", erode_px=8)  # noqa: E731
    fronts = [_c("fashn@44", 0.92), _c("fashn@45", 0.90)]
    backs = [_c("fashn@43", 0.89)]
    checks = {}
    for f, g in zip(fronts, (low, ok)):
        va = dq.view_agreement(body(g), body(back))
        checks[(f["id"], "fashn@43")] = {"back_view": {"pass": True, "failures": []}, "view_agreement": va, "view_colour": {"pass": True, "failures": []}}
    assert checks[("fashn@44", "fashn@43")]["view_agreement"]["pass"] is False
    pp = dq.pick_pair(fronts, backs, checks)
    assert (pp["front"], pp["back"]) == ("fashn@45", "fashn@43")  # the lower fidelity, but the only front that agrees
    assert any("waist" in f for f in next(r for r in pp["pairs"] if r["front"] == "fashn@44")["failures"])


# --- 4. archive, keep, finalize -------------------------------------------------------------------------------------------


def test_archive_moves_the_earlier_run_into_history(tmp_path):
    out = str(tmp_path / "stage1b")
    assert dq.archive_stage1b(out, "t") is None  # nothing there
    _write(f"{out}/raw/front_fashn.png", np.zeros((2, 2, 3), np.uint8))
    with open(f"{out}/record.before_recompose.json", "w") as f:
        f.write("{}")
    assert dq.archive_stage1b(out, "t") == os.path.join("history", "t")
    assert sorted(os.listdir(out)) == ["history"] and os.path.exists(f"{out}/history/t/raw/front_fashn.png")
    _write(f"{out}/raw/front_qwen.png", np.zeros((2, 2, 3), np.uint8))
    assert dq.archive_stage1b(out, "t") == os.path.join("history", "t-2")  # the same stamp twice: a new directory
    assert os.path.exists(f"{out}/history/t/raw/front_fashn.png") and os.path.exists(f"{out}/history/t-2/raw/front_qwen.png")


def _seeded_job(tmp_path, seed=43):
    job, m = synthetic_job(tmp_path)
    with open(f"{job}/stage1b/record.json") as f:
        rec = json.load(f)
    rec["seed"] = seed
    with open(f"{job}/stage1b/record.json", "w") as f:
        json.dump(rec, f)
    return job, m


def test_find_kept_takes_the_newest_run_of_this_job_with_that_candidate(tmp_path):
    job, m = _seeded_job(tmp_path)
    out = f"{job}/stage1b"
    f = dq.find_kept(out, "back", "qwen", None, m["input_hash"])
    assert f["dir"] == "" and f["stem"] == "back_qwen" and f["seed"] == 43 and f["qa_version"] == "stage1b-qa-0.9.0"
    rel = dq.archive_stage1b(out, "run16a")
    with pytest.raises(FileNotFoundError, match="no earlier stage 1b run"):
        dq.find_kept(out, "back", "fashn", None, m["input_hash"])  # no FASHN candidate in that run
    assert dq.find_kept(out, "back", "qwen", 43, m["input_hash"], include_current=False)["dir"] == rel
    for bad in ({"seed": 44}, {"input_hash": "x" * 64}):
        with pytest.raises(FileNotFoundError):
            dq.find_kept(out, "back", "qwen", bad.get("seed"), bad.get("input_hash", m["input_hash"]))


def _plan_job(tmp_path):
    """Run 17a in miniature: run 16a's job (Qwen on both views, seed 43) archived, its back KEPT, two new front draws:
    qwen@44 as good as the earlier front, qwen@45 cut off at mid-body (a cropped garment)."""
    job, m = _seeded_job(tmp_path)
    out = f"{job}/stage1b"
    arch = dq.archive_stage1b(out, "run16a")
    kept = dq.import_kept(job, m, "back", dq.find_kept(out, "back", "qwen", None, m["input_hash"], include_current=False))
    hist = f"{out}/{arch}"
    garment = np.asarray(Image.open(f"{hist}/candidates/front_qwen_garment_mask.png")) > 127
    gen = np.asarray(Image.open(f"{hist}/raw/front_qwen.png"))
    short = garment.copy()
    short[up(box(0, 110, 120, 208))] = False
    drawn = []
    for sd, g in ((44, garment), (45, short)):
        stem = f"front_qwen_s{sd}"
        img = gen.copy()
        img[garment & ~g] = (235, 235, 235)  # the engine drew studio background below its short hem
        _write(f"{out}/raw/{stem}.png", img)
        for suffix in ("_garment_mask", "_garment_mask_unclipped", "_chosen_mask"):
            _write(f"{out}/candidates/{stem}{suffix}.png", g)
        drawn.append({"id": f"qwen@{sd}", "engine": "qwen", "seed": sd, "steps": 40, "mask_source": "sam2", "prompt_version": lib.QWEN_PROMPT_VERSION})
    plan = lib.parse_draw_plan("front=qwen@44-45;back=keep:qwen")
    rec = {"stage": "stage1b_dress", "job_id": m["job_id"], "input_hash": m["input_hash"], "engine": "qwen", "plan": plan, "kept": {"back": kept},
           "archived": arch, "qa_version": dq.STAGE1B_QA_VERSION, "seed": None, "finalized": False,
           "views": [{"view": "front", "candidates": drawn}, {"view": "back", "candidates": [kept]}], "summary": {"usable_for_stage2": False}}
    with open(f"{out}/record.json", "w") as f:
        json.dump(rec, f)
    return job, m, kept


def test_a_kept_candidate_is_copied_under_its_plan_name_and_rescored_not_redrawn(tmp_path):
    job, m, kept = _plan_job(tmp_path)
    assert kept["id"] == "qwen@43" and kept["kept"]["from"] == "stage1b/history/run16a" and kept["kept"]["qa_version"] == "stage1b-qa-0.9.0"
    assert "conform inverted" in kept["kept"]["chosen_mask_basis"] or "saved composite mask" in kept["kept"]["chosen_mask_basis"]
    for f in ("raw/back_qwen_s43.png", "candidates/back_qwen_s43_garment_mask.png", "candidates/back_qwen_s43_chosen_mask.png"):
        assert os.path.exists(f"{job}/stage1b/{f}"), f
    raw_then = np.asarray(Image.open(f"{job}/stage1b/history/run16a/raw/back_qwen.png"))
    assert (np.asarray(Image.open(f"{job}/stage1b/raw/back_qwen_s43.png")) == raw_then).all()  # the same pixels, not a new draw


def test_finalize_picks_the_pair_writes_the_stills_and_records_every_pair(tmp_path):
    job, m, _ = _plan_job(tmp_path)
    rec = dq.finalize_draws(job, m)
    assert rec["qa_version"] == dq.STAGE1B_QA_VERSION and rec["plan"]["back"]["keep"] == {"engine": "qwen", "seed": None}
    pp = rec["pairs"]
    assert (pp["front"], pp["back"]) == ("qwen@44", "qwen@43"), pp
    rows = {(r["front"], r["back"]): r for r in pp["pairs"]}
    assert rows[("qwen@44", "qwen@43")]["eligible"] and not rows[("qwen@45", "qwen@43")]["eligible"]
    assert rec["summary"]["usable_for_stage2"], [v["qa"]["failures"] for v in rec["views"]]
    by = {v["view"]: v for v in rec["views"]}
    assert by["front"]["candidate"] == "qwen@44" and by["back"]["candidate"] == "qwen@43" and by["back"]["engine"] == "qwen"
    for v in rec["views"]:
        assert os.path.exists(f"{job}/{v['still']}") and len(v["still_pixel_sha256"]) == 64
    back_c = next(c for c in by["back"]["candidates"] if c["id"] == "qwen@43")
    assert back_c["drawn"]["kept"]["from"] == "stage1b/history/run16a" and back_c["composite_mask"]["chosen_basis"].startswith("kept from")
    q45 = next(c for c in by["front"]["candidates"] if c["id"] == "qwen@45")
    assert not q45["qa"]["pass"] and q45["drawn"]["seed"] == 45
    assert os.path.exists(f"{job}/stage1b/candidates/stills/front_qwen_s45.png")  # every candidate's composite, for the review
    # a later recompose of the picked pair gives the same pixels (run 17b pins the reviewed stills)
    hashes = {v["view"]: v["still_pixel_sha256"] for v in rec["views"]}
    again = dq.recompose_job(job, m, pins={"front": "qwen@44", "back": "qwen@43"})
    assert {v["view"]: v["still_pixel_sha256"] for v in again["views"]} == hashes
    kept_again = next(c for v in again["views"] if v["view"] == "back" for c in v["candidates"] if c["id"] == "qwen@43")
    assert kept_again["composite_mask"]["chosen_basis"].startswith("kept from stage1b/history/run16a")
    assert again["plan"] == rec["plan"] and again["kept"]["back"]["id"] == "qwen@43"
    with pytest.raises(ValueError, match="pinned engine"):
        dq.recompose_job(job, m, pins={"front": "qwen@46"})


def test_finalize_without_an_eligible_pair_shows_the_views_rejected_and_fails_the_back(tmp_path):
    job, m, _ = _plan_job(tmp_path)
    # only the cropped front: no pair can pass, and the pair checks of the shown pair fail the back
    os.remove(f"{job}/stage1b/raw/front_qwen_s44.png")
    rec = dq.finalize_draws(job, m)
    assert rec["pairs"]["front"] is None and "no eligible pair" in rec["pairs"]["reason"]
    assert not rec["summary"]["usable_for_stage2"] and "front" in rec["summary"]["failed_views"]
    assert not os.path.exists(f"{job}/stage1b/front.png") and os.path.exists(f"{job}/stage1b/rejected/front.png")


def test_finalize_refuses_a_record_that_is_not_a_plan_or_not_this_job(tmp_path):
    job, m = _seeded_job(tmp_path)
    with pytest.raises(ValueError, match="not a draw plan"):
        dq.finalize_draws(job, m)
    job2, m2, _ = _plan_job(tmp_path / "b")
    with pytest.raises(ValueError, match="input_hash"):
        dq.finalize_draws(job2, {**m2, "input_hash": "x" * 64})


def test_a_legacy_job_is_still_picked_per_view(tmp_path):
    """Run 16a's records (one draw per engine) are scored and picked as before: no pair table, the same stills."""
    job, m = synthetic_job(tmp_path)
    rec = dq.rescore_job(job, m)
    assert "pairs" not in rec and rec["views"]["front"]["selection"]["candidate"] == "qwen"


# --- 5. the apps: options checked before any upload or spend --------------------------------------------------------------


def test_stage1_dress_refuses_a_plan_it_cannot_run():
    pytest.importorskip("modal")
    import stage1_dress

    plan = lib.parse_draw_plan("front=fashn@44;back=qwen@43")
    m = {"stage1b": {"invented_back": False}}
    stage1_dress.check_plan(m, plan, engine="", seed=None)
    stage1_dress.check_plan(m, None, engine="both", seed=44)  # no plan: nothing to check
    for kw in ({"engine": "both", "seed": None}, {"engine": "", "seed": 44}):
        with pytest.raises(ValueError):
            stage1_dress.check_plan(m, plan, **kw)
    with pytest.raises(ValueError, match="back photo"):
        stage1_dress.check_plan({"stage1b": {"invented_back": True}}, plan, engine="", seed=None)
    with pytest.raises(SystemExit):
        stage1_dress.parse_plan_option("front=fashn@44")


def test_run_phase0_checks_the_draw_plan_before_the_upload():
    pytest.importorskip("modal")
    import run_phase0

    m = {"stage1b": {"invented_back": False}}
    dp = lambda **kw: run_phase0._draw_plan(m, **{"dress": True, "dress_only": False, "reuse": None, "dress_engine": "", "text": "front=fashn@44;back=keep:fashn", **kw})  # noqa: E731
    assert dp()["back"]["keep"]["engine"] == "fashn" and dp(text="") is None and dp(dress=False, dress_only=True) is not None
    for bad in ({"dress": False}, {"reuse": "recompose"}, {"dress_engine": "both"}, {"text": "front=fashn@44"}):
        with pytest.raises(SystemExit):
            dp(**bad)
    with pytest.raises(SystemExit):
        run_phase0._draw_plan({"stage1b": {"invented_back": True}}, dress=True, dress_only=False, reuse=None, dress_engine="", text="front=fashn@1;back=qwen@1")
    with open(os.path.join(MODAL_DIR, "run_phase0.py"), encoding="utf-8") as f:
        body = f.read()
    body = body[body.index("def main("):]
    assert body.index("_draw_plan(") < body.index("pm.upload_job(") and "plan=plan)" in body


def test_the_gpu_app_draws_a_plan_and_leaves_scoring_to_finalize():
    with open(os.path.join(MODAL_DIR, "stage1_dress.py"), encoding="utf-8") as f:
        src = f.read()
    for needle in ("lib.candidate_stem(name, cand_id)", 'f"{lib.STAGE1B_DIR}/raw/{stem}.png"', "_chosen_mask.png", "_garment_mask_unclipped.png",
                   'c["qa"] = {"pass": None, "failures": [], "note": "scored by finalize"}', "dq.archive_stage1b(out", "dq.finalize_draws(job, m",
                   "lib.view_colour_phrases(", 'rec["still_pixel_sha256"] = lib.pixel_sha256(', "prepare.remote(job_id, plan)", "finalize.remote(job_id"):
        assert needle in src, needle
    prep = src[src.index("def prepare("):src.index("def finalize(")]
    # a missing keep stops before anything moves
    assert prep.index("dq.find_kept(out, view") < prep.index("dq.archive_stage1b(") < prep.index("dq.import_kept(")


def test_keep_and_finalize_reproduce_run16a_stills_on_the_replay_path_when_data_is_present():
    """Run 16a's real outputs are not in git; when the scratch copy is there (CI is not), keeping azure's two FASHN candidates and
    finalizing gives the pixels run 16b pins (README, "Run 17a")."""
    src = os.environ.get("CURTAIN_RUN16A_AZURE")
    if not src or not os.path.isdir(src):
        pytest.skip("run 16a's azure job not available (set CURTAIN_RUN16A_AZURE)")
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        job = os.path.join(d, "job")
        shutil.copytree(src, job)
        with open(os.path.join(job, "manifest.json")) as f:
            m = json.load(f)
        out = os.path.join(job, "stage1b")
        arch = dq.archive_stage1b(out, "run16a")
        shutil.copytree(os.path.join(out, arch, "source"), os.path.join(out, "source"))
        kept = {v: dq.import_kept(job, m, v, dq.find_kept(out, v, "fashn", None, m["input_hash"], include_current=False)) for v in ("front", "back")}
        rec = {"stage": "stage1b_dress", "job_id": m["job_id"], "input_hash": m["input_hash"], "plan": {"front": {}, "back": {}}, "kept": kept,
               "views": [{"view": v, "candidates": [k]} for v, k in kept.items()]}
        with open(os.path.join(out, "record.json"), "w") as f:
            json.dump(rec, f)
        r = dq.finalize_draws(job, m)
        got = {v["view"]: v["still_pixel_sha256"][:24] for v in r["views"]}
        assert got == {"front": "d4cbc556b400eeb9c145f9c1", "back": "695c51459ff080c9657cdfbd"}


# --- 5. review of 0.11.0 --------------------------------------------------------------------------------------------------


def test_a_seedless_keep_is_refused_when_the_earlier_run_drew_that_engine_more_than_once(tmp_path):
    """Review F2: a finalized draw plan lists several seeds of one engine; `keep:qwen` would take the lowest seed, not the pair
    the reviewer picked. The keep must then name the seed, and that still works."""
    job, m = _seeded_job(tmp_path)
    out = f"{job}/stage1b"
    with open(f"{out}/record.json") as f:
        rec = json.load(f)
    back = next(v for v in rec["views"] if v["view"] == "back")
    q43 = next(c for c in back["candidates"] if c["engine"] == "qwen")
    back["candidates"].append({**q43, "seed": 44, "id": "qwen@44"})
    with open(f"{out}/record.json", "w") as f:
        json.dump(rec, f)
    with pytest.raises(ValueError, match="ambiguous"):
        dq.find_kept(out, "back", "qwen", None, m["input_hash"])
    assert dq.find_kept(out, "back", "qwen", 43, m["input_hash"])["seed"] == 43


def test_the_pair_table_shows_each_views_torso_cover_and_waistband():
    """Review F4: the pick does not rank by margin, so the table carries the numbers a reviewer weighs against the thresholds."""
    f, b = _c("fashn@44", 0.92), _c("fashn@43", 0.89)
    f["qa"].update({"silhouette_band": {"torso_cover": 0.9213}, "garment_body": {"top_offset": 0.031}})
    b["qa"].update({"silhouette_band": {"torso_cover": 0.95}, "garment_body": {"top_offset": 0.034}})
    row = dq.pick_pair([f], [b], {("fashn@44", "fashn@43"): _ok_checks()})["pairs"][0]
    assert (row["front_torso_cover"], row["back_torso_cover"], row["front_top_offset"], row["back_top_offset"]) == (0.9213, 0.95, 0.031, 0.034)


def test_the_shared_colour_threshold_is_the_view_colour_floor():
    """Review F6: one colour phrase for both views below the floor under which the QA holds the two stills to one colour anyway."""
    assert lib.SHARED_COLOUR_MAX_DELTA_E == dq.VIEW_COLOUR["min_limit_delta_e"]


def test_paid_draws_come_home_when_the_dress_itself_fails():
    """Review F5: the download runs in `finally` around the GPU dress as well as the finalize, and each plan draw is committed."""
    with open(os.path.join(MODAL_DIR, "stage1_dress.py"), encoding="utf-8") as f:
        src = f.read()
    body = src[src.index("def run_local("):src.index("def parse_plan_option(")]
    assert body.index("try:") < body.index("dress.remote(") < body.index("finalize.remote(") < body.index("finally:") < body.index("pm.download_dir(")
    assert "pm.jobs.commit()  # each paid draw" in src
