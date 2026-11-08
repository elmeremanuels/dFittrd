"""Tests for stage 1b (dress our mannequin from a shop photo): the pure helpers in phase0_lib, the
manifest wiring, and static checks on stage1_dress.py. No Modal, numpy or GPU needed; the tests that
import the Modal apps skip without `modal`, and the exporter round trip skips without Node and tsx.

Run from spikes/garment-engine/modal:  python -m pytest -q tests
"""
import ast
import copy
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import warnings

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
SPIKE_DIR = os.path.dirname(MODAL_DIR)
REPO = os.path.dirname(os.path.dirname(SPIKE_DIR))
sys.path.insert(0, MODAL_DIR)

import phase0_lib as lib  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
STUDIO = (235, 235, 235)
GREY = (128, 128, 128)


def load(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return json.load(f)


TARGET = {"kind": "proxy_dressed", "proxy_kind": "top", "proxy_glb_sha256": "c" * 64, "proxy_rgb": [0.72, 0.68, 0.62]}


def on_model(base, *, back=False, kind="on_model"):
    """The fixture manifest turned into an --on-model export, the way src/exportJob.ts writes one
    (src/exportJob.ts and the round trip test below keep the two in step)."""
    m = copy.deepcopy(base)
    n = m["camera"]["frames"]
    sources = [{"role": "front", "path": "dress/source_front.jpg", "sha256": "a" * 64, "source": "front.jpg"}]
    if back:
        sources.append({"role": "back", "path": "dress/source_back.jpg", "sha256": "b" * 64, "source": "back.jpg"})
    m["photos"] = [
        {"role": r, "path": f"stage1b/{r}.png", "sha256": None, "synthetic": False, "source": "stage 1b", "produced_by": "stage1b", "invented": r == "back" and not back}
        for r in ("front", "back")
    ]
    m["stage1b"] = {
        "dir": "stage1b",
        "source_kind": kind,
        "sources": sources,
        "views": [
            {"view": v, "frame": f, "source": (None if v == "back" and not back else f"dress/source_{v}.jpg"), "bare_rgb": f"dress/bare_{v}.png",
             "bare_mask": f"control/mask/{f:04d}.png", "proxy_rgb": f"dress/proxy_{v}.png", "proxy_mask": f"dress/proxy_mask_{v}.png",
             "still": f"stage1b/{v}.png", "garment_mask": f"stage1b/garment_mask_{v}.png", "invented": v == "back" and not back}
            for v, f in (("front", 0), ("back", n // 2))
        ],
        "invented_back": not back,
        "background_rgb": list(STUDIO),
        "target": TARGET,
        "record": "stage1b/record.json",
        "note": "",
    }
    m["hash_inputs"]["photos"] = [{"role": s["role"], "sha256": s["sha256"], "synthetic": False} for s in sources]
    m["hash_inputs"]["stage1b"] = {"source_kind": kind, "invented_back": not back, "target": TARGET}
    m["input_hash"] = lib.input_hash(m["hash_inputs"])
    m["job_id"] = f"{m['product_id']}-{m['input_hash'][:12]}"
    return m


@pytest.fixture()
def manifest():
    return load("manifest.json")


# --- settings, category, pins ------------------------------------------------------------------------


def test_stage1b_settings_defaults_and_overrides():
    s = lib.stage1b_settings({})
    assert s == {"region": None, "gpu_dress": "H100", "timeout_dress": 3600, "timeout_download": 7200, "memory_dress_mb": 65536, "qwen_cpu_offload": False}
    s = lib.stage1b_settings({"CURTAIN_MODAL_GPU_DRESS": "L40S", "CURTAIN_MODAL_REGION": "eu", "CURTAIN_QWEN_CPU_OFFLOAD": "1"})
    assert (s["gpu_dress"], s["region"], s["qwen_cpu_offload"]) == ("L40S", "eu", True)
    with pytest.raises(ValueError, match="CURTAIN_MODAL_TIMEOUT_DRESS"):
        lib.stage1b_settings({"CURTAIN_MODAL_TIMEOUT_DRESS": "5"})
    with pytest.raises(ValueError, match="CURTAIN_QWEN_CPU_OFFLOAD"):
        lib.stage1b_settings({"CURTAIN_QWEN_CPU_OFFLOAD": "maybe"})
    # The stage 2/4 settings are untouched by the stage 1b variables.
    assert lib.settings({"CURTAIN_MODAL_GPU_DRESS": "L4"})["gpu_video"] == "H100"


def test_cost_record_for_stage1b_is_an_estimate_from_the_price_table():
    r = lib.cost_record("stage1b_dress", gpu=lib.stage1b_settings({})["gpu_dress"], region="eu", gpu_seconds=120)
    assert r["estimate"] is True and r["usd_estimate_low"] == round(3.95 * 1.15 * 120 / 3600, 4)


def test_tryon_category_mapping():
    assert [lib.tryon_category(c) for c in ("dress", "top", "outerwear", "bottom")] == ["one-pieces", "tops", "tops", "bottoms"]
    with pytest.raises(lib.ManifestError, match="shoes"):
        lib.tryon_category("shoes")
    for cat in ("one-pieces", "tops", "bottoms"):
        assert lib.GARMENT_PROMPT[cat].endswith(".") and lib.GARMENT_PROMPT[cat] == lib.GARMENT_PROMPT[cat].lower()
        assert lib.FASHN_GARMENT_LABEL[cat] in lib.FASHN_BODY_COVERAGE_TO_LABELS[lib.FASHN_CATEGORY_TO_BODY_COVERAGE[cat]]
    assert lib.align_margin_px("one-pieces", 832) == 67 and lib.align_margin_px("tops", 832) == 33


def test_fashn_label_table_matches_the_published_card():
    assert len(lib.FASHN_LABELS) == 18 and lib.FASHN_LABEL_IDS["background"] == 0
    assert (lib.FASHN_LABEL_IDS["top"], lib.FASHN_LABEL_IDS["dress"], lib.FASHN_LABEL_IDS["skirt"], lib.FASHN_LABEL_IDS["torso"], lib.FASHN_LABEL_IDS["jewelry"]) == (3, 4, 5, 16, 17)
    assert list(lib.fashn_label_map(bytes([0, 1, 1, 0]), "one-pieces")) == [0, 4, 4, 0]
    assert list(lib.fashn_label_map([1, 0], "tops")) == [3, 0]


def test_stage1b_pins_are_exact_commercial_and_not_in_the_hashed_pins():
    for key, pin in lib.STAGE1B_MODELS.items():
        assert re.fullmatch(r"[0-9a-f]{40}", pin["revision"]), key
        assert "Apache-2.0" in pin["licence"], key
    assert re.fullmatch(r"[0-9a-f]{40}", lib.STAGE1B_MODELS["fashn"]["code_revision"])
    assert re.fullmatch(r"[0-9a-f]{40}", lib.STAGE1B_MODELS["fashn"]["pose_revision"])
    assert set(lib.STAGE1B_MODELS).isdisjoint(lib.PINNED_MODELS)  # stage 1b pins do not change any input_hash


def _banned():
    src = open(os.path.join(REPO, "packages", "tryon-providers", "src", "bannedModels.ts"), encoding="utf-8").read()
    body = re.search(r"export const BANNED_MODELS = \[([\s\S]*?)\] as const;", src).group(1)
    return [re.sub(r"[^a-z0-9]", "", b.lower()) for b in re.findall(r"'([^']+)'", body)]


def test_no_stage1b_model_is_on_the_banned_list_and_the_fashn_parser_is():
    banned = _banned()
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731 - same matching as registry.ts isBanned
    for key, pin in lib.STAGE1B_MODELS.items():
        for field in ("id", "code_url", "pose_id"):
            if field in pin:
                assert not any(b in norm(pin[field]) for b in banned), f"{key}.{field} {pin[field]} is banned"
    assert any(b in norm("fashn-ai/fashn-human-parser") for b in banned)


# --- manifest wiring ---------------------------------------------------------------------------------


def test_plan_lists_front_then_back_at_the_pinned_frames(manifest):
    m = lib.check_manifest(on_model(manifest))
    front, back = lib.stage1b_plan(m)
    assert (front["view"], front["frame"], back["view"], back["frame"]) == ("front", 0, "back", m["camera"]["frames"] // 2)
    assert front["source"] == "dress/source_front.jpg" and front["invented"] is False
    assert back["source"] is None and back["invented"] is True
    assert lib.invented_roles(m) == ["back"]
    with_back = lib.check_manifest(on_model(manifest, back=True, kind="flat_lay"))
    assert [v["invented"] for v in lib.stage1b_plan(with_back)] == [False, False]
    assert lib.invented_roles(with_back) == []


def test_plan_refuses_a_job_without_stage1b_or_with_inconsistent_flags(manifest):
    with pytest.raises(lib.ManifestError, match="--on-model"):
        lib.stage1b_plan(manifest)
    m = on_model(manifest)
    bad = copy.deepcopy(m)
    bad["stage1b"]["views"][1]["frame"] = 1
    with pytest.raises(lib.ManifestError, match="frames 0 and"):
        lib.stage1b_plan(bad)
    bad = copy.deepcopy(m)
    bad["photos"][1]["invented"] = False  # the back is invented but the photo entry hides it
    with pytest.raises(lib.ManifestError, match="invented flag"):
        lib.stage1b_plan(bad)
    bad = copy.deepcopy(m)
    bad["stage1b"]["invented_back"] = False
    with pytest.raises(lib.ManifestError, match="invented_back"):
        lib.stage1b_plan(bad)
    bad = copy.deepcopy(m)
    bad["photos"][0]["path"] = "photos/front.png"
    with pytest.raises(lib.ManifestError, match="must point at"):
        lib.stage1b_plan(bad)
    old = copy.deepcopy(m)  # exported before 0.4.0: dressed the bare mannequin (run 12)
    for v in old["stage1b"]["views"]:
        del v["proxy_rgb"], v["proxy_mask"]
    del old["stage1b"]["target"]
    with pytest.raises(lib.ManifestError, match="proxy-dressed target"):
        lib.stage1b_plan(old)
    bad = copy.deepcopy(m)
    bad["stage1b"]["views"][0]["source"] = None
    bad["stage1b"]["views"][0]["invented"] = True
    with pytest.raises(lib.ManifestError, match="front source"):
        lib.stage1b_plan(bad)


def test_stills_pending_until_stage1b_writes_them(manifest, tmp_path):
    m = on_model(manifest)
    exists = lambda rel: (tmp_path / rel).exists()  # noqa: E731
    assert lib.stills_pending(m, exists) == ["front", "back"]
    (tmp_path / "stage1b").mkdir()
    (tmp_path / "stage1b" / "front.png").write_bytes(b"x")
    assert lib.stills_pending(m, exists) == ["back"]
    assert lib.stills_pending(manifest, lambda rel: False) == []  # supplied stills are never pending


def test_stage1b_section_does_not_change_the_hash_of_ordinary_jobs(manifest):
    # The exporter leaves hash_inputs.stage1b out unless --on-model; an on-model job is a different job.
    assert "stage1b" not in manifest["hash_inputs"]
    assert on_model(manifest)["input_hash"] != manifest["input_hash"]
    assert on_model(manifest)["input_hash"] != on_model(manifest, back=True)["input_hash"]


# --- masks and images ----------------------------------------------------------------------------------


def rect(w, h, x0, y0, x1, y1):
    return bytearray(1 if x0 <= k % w < x1 and y0 <= k // w < y1 else 0 for k in range(w * h))


def paint(w, h, mask, rgb, base=None):
    out = bytearray(base) if base is not None else bytearray(STUDIO * (w * h))
    for k, v in enumerate(mask):
        if v:
            out[3 * k:3 * k + 3] = bytes(rgb)
    return out


def test_dilate_and_erode_by_a_square():
    w, h = 9, 7
    dot = rect(w, h, 4, 3, 5, 4)
    assert lib.dilate(dot, w, h, 2) == rect(w, h, 2, 1, 7, 6)
    assert lib.dilate(dot, w, h, 0) == dot
    assert lib.erode(rect(w, h, 2, 1, 7, 6), w, h, 2) == dot
    edge = rect(w, h, 0, 0, 3, 3)  # outside the frame counts as inside for erosion
    assert lib.erode(edge, w, h, 1) == rect(w, h, 0, 0, 2, 2)
    with pytest.raises(ValueError):
        lib.dilate(dot, w, h + 1, 1)


def test_iou_counts_components_and_bbox():
    w, h = 10, 6
    a, b = rect(w, h, 0, 0, 4, 4), rect(w, h, 2, 0, 6, 4)
    assert lib.mask_iou(a, b) == pytest.approx(8 / 24)
    assert lib.mask_iou(bytes(w * h), bytes(w * h)) == 1.0
    assert lib.mask_count(lib.mask_or(a, b)) == 24 and lib.mask_count(lib.mask_andnot(a, b)) == 8
    big, small, speck = rect(w, h, 0, 0, 5, 5), rect(w, h, 7, 0, 9, 2), rect(w, h, 9, 5, 10, 6)
    m = lib.mask_or(lib.mask_or(big, small), speck)
    assert [len(c) for c in lib.components(m, w, h)] == [25, 4, 1]
    assert lib.keep_large_components(m, w, h, 0.1) == lib.mask_or(big, small)
    assert lib.bbox(small, w, h) == (7, 0, 9, 2) and lib.bbox(bytes(w * h), w, h) is None
    assert lib.touches_border(small, w, h) and not lib.touches_border(rect(w, h, 1, 1, 3, 3), w, h)


def test_rgb_masks_mean_difference_and_composite():
    w, h = 4, 3
    body = rect(w, h, 1, 0, 3, 3)
    bare = paint(w, h, body, GREY)
    cloth = rect(w, h, 1, 1, 3, 2)
    gen = paint(w, h, cloth, (200, 30, 30), bare)
    assert lib.rgb_diff_mask(gen, bare, w, h, 24) == cloth
    assert lib.background_mask(bare, w, h, STUDIO, 10) == lib.mask_not(body)
    assert lib.mean_abs_diff(gen, bare, cloth) == pytest.approx((72 + 98 + 98) / 3)
    assert lib.mean_abs_diff(gen, bare, bytes(w * h)) is None
    shifted = bytearray(gen)
    shifted[0:3] = b"\x00\x00\x00"  # a generated pixel outside the garment mask is discarded
    assert lib.composite(bare, shifted, cloth) == gen
    assert lib.fit_size(480, 832, 1024 * 1024) == (784, 1344)
    fw, fh = lib.fit_size(480, 832, 1024 * 1024)
    assert fw % 16 == 0 and fh % 16 == 0 and abs(fw / fh - 480 / 832) < 0.01


# A small synthetic scene: our "mannequin" (head, torso, legs, arms) and a dress on the torso.
W, H = 40, 64


def mannequin(arm_dx=0):
    m = rect(W, H, 17, 2, 23, 9)  # head
    m = lib.mask_or(m, rect(W, H, 14, 9, 26, 34))  # torso
    m = lib.mask_or(m, rect(W, H, 15, 34, 19, 60))  # legs
    m = lib.mask_or(m, rect(W, H, 21, 34, 25, 60))
    m = lib.mask_or(m, rect(W, H, 10 - arm_dx, 10, 13 - arm_dx, 32))  # arms
    return lib.mask_or(m, rect(W, H, 27 + arm_dx, 10, 30 + arm_dx, 32))


DRESS = rect(W, H, 13, 10, 27, 46)  # covers the torso, flares 1 px, ends at the knees


def test_alignment_qa_passes_a_dressed_still_on_our_mannequin():
    bare = mannequin()
    fg = lib.mask_or(bare, DRESS)
    q = lib.alignment_qa(DRESS, fg, bare, W, H, margin_px=3, mannequin_mae=4.0)
    assert q["pass"], q["failures"]
    assert q["inside_fraction"] == 1.0 and q["silhouette_iou"] == 1.0
    assert 0.3 < q["cover_fraction"] < 0.8 and not q["touches_border"]


def test_alignment_qa_fails_a_garment_outside_the_silhouette():
    bare = mannequin()
    wide = rect(W, H, 2, 10, 38, 46)  # a cape far past the margin
    q = lib.alignment_qa(wide, lib.mask_or(bare, wide), bare, W, H, margin_px=3)
    assert not q["pass"] and q["inside_fraction"] < 0.97
    assert any("outside the dilated silhouette" in f for f in q["failures"])
    # The margin is what lets a flared skirt through.
    flare = rect(W, H, 11, 30, 29, 50)
    assert lib.alignment_qa(flare, lib.mask_or(bare, flare), bare, W, H, margin_px=4)["inside_fraction"] == 1.0


def test_alignment_qa_fails_when_the_model_moved_the_mannequin():
    bare = mannequin()
    moved = lib.mask_or(mannequin(arm_dx=4), DRESS)  # arms drawn 4 px further out: pose not held
    q = lib.alignment_qa(DRESS, moved, bare, W, H, margin_px=3)
    assert not q["pass"] and q["silhouette_iou"] < 0.9
    assert any("mannequin moved" in f for f in q["failures"])


def test_alignment_qa_fails_empty_border_and_recoloured_mannequin():
    bare = mannequin()
    empty = lib.alignment_qa(bytes(W * H), bare, bare, W, H, margin_px=3)
    assert not empty["pass"] and "empty garment mask" in empty["failures"]
    long_ = rect(W, H, 13, 10, 27, 64)
    border = lib.alignment_qa(long_, lib.mask_or(bare, long_), bare, W, H, margin_px=3)
    assert "garment touches the frame border" in border["failures"]
    grey = lib.alignment_qa(DRESS, lib.mask_or(bare, DRESS), bare, W, H, margin_px=3, mannequin_mae=60.0)
    assert any("MAE" in f for f in grey["failures"])
    loose = lib.alignment_qa(DRESS, lib.mask_or(bare, DRESS), bare, W, H, margin_px=3, mannequin_mae=60.0, thresholds={"max_mannequin_mae_8bit": 80})
    assert loose["pass"]


def test_garment_prior_finds_a_coloured_garment_and_misses_a_grey_one():
    bare_m = mannequin()
    bare = paint(W, H, bare_m, GREY)
    red = paint(W, H, DRESS, (190, 40, 50), bare)
    prior = lib.garment_prior(red, bare, W, H, STUDIO)
    assert lib.mask_iou(prior, DRESS) > 0.95
    # A garment the colour of the mannequin: the difference sees nothing (the spike's known stage 3
    # limit), so the SAM 2 mask is taken.
    grey = paint(W, H, DRESS, (131, 129, 127), bare)
    assert lib.mask_count(lib.garment_prior(grey, bare, W, H, STUDIO)) == 0
    mask, source, iou = lib.choose_garment_mask(lib.garment_prior(grey, bare, W, H, STUDIO), DRESS)
    assert (source, iou, mask) == ("sam2", 0.0, DRESS)


def test_choose_garment_mask_prefers_sam2_only_when_it_agrees():
    assert lib.choose_garment_mask(DRESS, None)[1] == "difference"
    assert lib.choose_garment_mask(DRESS, bytes(W * H))[1] == "difference"
    close = rect(W, H, 13, 10, 27, 44)
    m, src, iou = lib.choose_garment_mask(DRESS, close)
    assert src == "sam2" and iou > 0.9 and m == close
    far = rect(W, H, 0, 50, 10, 60)
    m, src, iou = lib.choose_garment_mask(DRESS, far)
    assert src.startswith("difference") and iou == 0.0 and m == DRESS


def test_summary_flags_failed_views_and_an_invented_back():
    ok = {"view": "front", "qa": {"pass": True}}
    bad = {"view": "back", "qa": {"pass": False}}
    s = lib.stage1b_summary([ok, ok | {"view": "back"}], invented_back=True)
    assert s["pass"] and s["usable_for_stage2"] and s["warnings"] == [lib.INVENTED_BACK_LABEL]
    assert "INVENTED" in lib.INVENTED_BACK_LABEL and "D13" in lib.INVENTED_BACK_LABEL
    s = lib.stage1b_summary([ok, bad], invented_back=False)
    assert not s["usable_for_stage2"] and s["failed_views"] == ["back"] and s["warnings"] == []
    assert "estimate" in s["label"]


# --- the Modal app, statically --------------------------------------------------------------------------


def _source(name):
    return open(os.path.join(MODAL_DIR, name), encoding="utf-8").read()


def _reqs(name):
    with open(os.path.join(MODAL_DIR, name), encoding="utf-8") as f:
        return [line.split("#")[0].strip() for line in f if line.split("#")[0].strip()]


def test_stage1_requirements_are_pinned_locked_and_leave_out_the_parser():
    direct, lock = _reqs("requirements-stage1.in"), _reqs("requirements-stage1.txt")
    assert lock and all("==" in r for r in direct + lock)
    locked = {r.split("==")[0].lower().replace("_", "-"): r.split("==")[1] for r in lock}
    for r in direct:
        name, version = r.split("==")
        assert locked.get(name.lower().replace("_", "-")) == version, f"{r} not in the lock"
    assert not any("fashn" in r.lower() for r in direct + lock)
    assert locked["diffusers"] >= "0.37.1"  # zero_cond_t (Qwen-Image-Edit-2511)


def test_stage1_app_installs_fashn_without_dependencies_and_checks_the_parser_is_absent():
    src = _source("stage1_dress.py")
    ast.parse(src)
    assert "pip install --no-deps {FASHN_CODE_DIR}" in src
    assert "find_spec('fashn_human_parser') is not None" in src
    assert "git checkout {M['fashn']['code_revision']}" in src
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") in ("pip_install", "uv_pip_install"):
            pytest.fail("stage1_dress.py must install from requirements-stage1.txt only")
    # Run 12: FASHN maskless on the bare mannequin drew a romper. The engines now get the proxy-dressed target and
    # FASHN runs masked with our edit region as its label map.
    assert "segmentation_free=False" in src and "segmentation_free=True" not in src
    assert 'v["proxy_rgb"]' in src and "dq.edit_region(" in src and "dq.fashn_person_labels(" in src
    assert "lib.qwen_dress_prompt(m, name" in src and "product_name" not in src
    assert '"phase0_garment", "phase0_dress"' in src  # shipped into the image
    # The invented back is flagged in the record of the view and in the summary.
    assert 'rec["label"] = lib.INVENTED_BACK_LABEL' in src and "invented_back=bool(spec[\"invented_back\"])" in src


def test_stage1_app_and_run_phase0_register_without_name_clashes():
    modal = pytest.importorskip("modal")  # noqa: F841
    import run_phase0
    import stage1_dress
    import stage2_video
    import stage4_recon

    def names(a):
        with warnings.catch_warnings():  # App.registered_functions is deprecated in modal 1.6, still present
            warnings.simplefilter("ignore")
            return set(a.registered_functions)

    s1, s2, s4 = names(stage1_dress.app), names(stage2_video.app), names(stage4_recon.app)
    assert s1 == {"download_dress_weights", "dress", "recompose"}  # recompose: CPU, stage1b-qa-0.10.0 (run 16b)
    assert s1.isdisjoint(s2) and s1.isdisjoint(s4), "App.include would let one function shadow another"
    assert names(run_phase0.app) == s1 | s2 | s4
    assert set(stage1_dress.ENGINE_STEPS) == set(lib.STAGE1B_ENGINES)
    assert set(stage1_dress.ENGINE_WEIGHTS) == set(lib.DRESS_ENGINE_CHOICES)
    assert set(stage1_dress.ENGINE_WEIGHTS["both"]) == set(stage1_dress.ENGINE_WEIGHTS["fashn"]) | set(stage1_dress.ENGINE_WEIGHTS["qwen"])


def test_run_phase0_does_not_start_stage2_on_missing_failed_or_invented_stills(manifest, tmp_path):
    pytest.importorskip("modal")
    import run_phase0

    m = on_model(manifest)
    gate = lambda rec=None, **kw: run_phase0._dress_gate(m, str(tmp_path), rec, **{"accept_failed": False, "allow_invented": False, **kw})  # noqa: E731
    assert any("missing for front, back" in r for r in gate())
    (tmp_path / "stage1b").mkdir()
    for v in ("front", "back"):
        (tmp_path / "stage1b" / f"{v}.png").write_bytes(b"x")
    assert [r for r in gate() if "INVENTED" in r] and len(gate()) == 1
    assert gate(allow_invented=True) == []
    failed = {"summary": {"usable_for_stage2": False, "failed_views": ["back"]}}
    assert any("QA failed for back" in r for r in gate(failed, allow_invented=True))
    assert gate(failed, allow_invented=True, accept_failed=True) == []
    assert run_phase0._dress_gate(manifest, str(tmp_path), None, accept_failed=False, allow_invented=False) == []
    # A different garment (stage1b-qa-0.6.1 type_failures) is never overridden by --accept-failed-dress.
    typed = {"summary": {"usable_for_stage2": False, "failed_views": ["front"], "type_failed_views": ["front"], "type_failures": {"front": ["legs merged: 80/120 rows"]}}}
    reasons = gate(typed, allow_invented=True, accept_failed=True)
    assert len(reasons) == 1 and "different garment in front (front: legs merged)" in reasons[0], reasons
    # Stage 1b run on its own before this call: its record.json decides.
    (tmp_path / "stage1b" / "record.json").write_text(json.dumps(typed))
    assert any("different garment" in r for r in gate(allow_invented=True, accept_failed=True))
    (tmp_path / "stage1b" / "record.json").write_text(json.dumps(failed))
    assert gate(allow_invented=True, accept_failed=True) == []


def test_photo_provenance_reads_the_invented_back_from_the_manifest(manifest):
    prov = lib.photo_provenance(on_model(manifest))
    assert prov["invented_back"] is True and prov["invented_roles"] == ["back"] and prov["label"] == lib.INVENTED_BACK_LABEL
    assert [(p["role"], p["produced_by"], p["invented"]) for p in prov["photos"]] == [("front", "stage1b", False), ("back", "stage1b", True)]
    real = lib.photo_provenance(on_model(manifest, back=True))
    assert real["invented_back"] is False and real["invented_roles"] == [] and "label" not in real
    assert lib.photo_provenance(manifest)["invented_back"] is False


def test_stage2_record_carries_the_stills_provenance():
    with open(os.path.join(MODAL_DIR, "stage2_video.py"), encoding="utf-8") as f:
        assert '"stills": lib.photo_provenance(m)' in f.read()


def test_run_phase0_summary_flags_an_invented_back_when_stage1b_ran_on_its_own(manifest, tmp_path, monkeypatch):
    """The documented flow: stage1_dress.py first, then run_phase0.py without --dress. The summary must
    still say the back is invented, from the manifest, without a stage 1b record in this call."""
    pytest.importorskip("modal")
    import phase0_modal as pm
    import run_phase0

    m = on_model(manifest)
    (tmp_path / "stage1b").mkdir()
    for v in ("front", "back"):
        (tmp_path / "stage1b" / f"{v}.png").write_bytes(b"x")
    monkeypatch.setattr(pm, "load_local_job", lambda job_dir: m)
    monkeypatch.setattr(pm, "upload_job", lambda *a, **kw: None)
    main = run_phase0.main.info.raw_f
    with pytest.raises(SystemExit):
        main(str(tmp_path))  # no --dress, no --allow-invented-back: the gate stops before stage 2
    s = json.loads((tmp_path / "cost_summary.json").read_text())
    assert s["invented_back"] is True and s["invented_roles"] == ["back"] and s["label"] == lib.INVENTED_BACK_LABEL
    assert "stage1b" not in s and any("INVENTED" in r for r in s["stopped_before_stage2"])
    assert [p["invented"] for p in s["stills"]] == [False, True]
    assert run_phase0._base_summary(on_model(manifest, back=True), {})["invented_back"] is False


# --- round trip through the TypeScript exporter --------------------------------------------------------


def _tsx():
    tsx = os.path.join(SPIKE_DIR, "node_modules", ".bin", "tsx")
    built = os.path.exists(os.path.join(REPO, "packages", "mannequin", "dist"))
    return tsx if shutil.which("node") and os.path.exists(tsx) and built else None


def _png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", head[16:24])


def _export(tmp_path, name, *args):
    tsx = _tsx()
    if tsx is None:
        pytest.skip("needs Node, the spike's node_modules and `pnpm build:packages`")
    out = tmp_path / name
    subprocess.run(
        [tsx, os.path.join(SPIKE_DIR, "src", "exportCli.ts"), "--product", "monochrome-03", "--frames", "8", "--width", "64", "--height", "112", "--motion-frames", "5", "--no-synthetic", "--out", str(out), *args],
        check=True, capture_output=True, text=True, timeout=300, cwd=SPIKE_DIR,
    )
    return out / "monochrome-03"


def test_exporter_on_model_job_round_trip(tmp_path):
    shop = tmp_path / "shop"
    shop.mkdir()
    (shop / "front.jpg").write_bytes(b"not decoded by the exporter: front")
    (shop / "back.webp").write_bytes(b"not decoded by the exporter: back")
    job = _export(tmp_path, "a", "--on-model", "--front", str(shop / "front.jpg"))
    m = lib.load_manifest(str(job / "manifest.json"))
    front, back = lib.stage1b_plan(m)
    assert m["stage1b"]["source_kind"] == "on_model" and m["stage1b"]["invented_back"] is True
    assert lib.invented_roles(m) == ["back"] and back["source"] is None
    for v in (front, back):
        assert _png_size(job / v["bare_rgb"]) == (64, 112) and (job / v["bare_mask"]).exists()
        # 0.4.0: the proxy-dressed target and the visible proxy, also for the (default) proxy control
        assert _png_size(job / v["proxy_rgb"]) == (64, 112) and (job / v["proxy_mask"]).exists()
    assert m["stage1b"]["target"]["kind"] == "proxy_dressed" and m["hash_inputs"]["stage1b"]["target"] == m["stage1b"]["target"]
    assert m["stage1b"]["target"]["proxy_glb_sha256"] == m["control"]["proxy"]["glb_sha256"]
    bare_ctl = lib.load_manifest(str(_export(tmp_path, "e", "--on-model", "--control", "bare", "--front", str(shop / "front.jpg")) / "manifest.json"))
    assert bare_ctl["control"]["proxy"] is None and bare_ctl["stage1b"]["target"]["proxy_kind"] == m["stage1b"]["target"]["proxy_kind"]
    assert (job / "dress" / "source_front.jpg").read_bytes() == (shop / "front.jpg").read_bytes()
    assert not (job / "photos").exists()
    assert lib.stills_pending(m, lambda rel: (job / rel).exists()) == ["front", "back"]
    assert "stage1b/" not in lib.job_input_files(str(job))  # nothing produced yet, nothing uploaded from it

    flat = lib.load_manifest(str(_export(tmp_path, "b", "--flat-lay", "--front", str(shop / "front.jpg"), "--back", str(shop / "back.webp")) / "manifest.json"))
    assert flat["stage1b"]["source_kind"] == "flat_lay" and not flat["stage1b"]["invented_back"]
    assert [v["source"] for v in lib.stage1b_plan(flat)] == ["dress/source_front.jpg", "dress/source_back.webp"]
    assert flat["input_hash"] != m["input_hash"]

    # The file name is not hashed; the bytes and the kind are.
    (shop / "renamed.jpg").write_bytes((shop / "front.jpg").read_bytes())
    renamed = lib.load_manifest(str(_export(tmp_path, "c", "--on-model", "--front", str(shop / "renamed.jpg")) / "manifest.json"))
    assert renamed["input_hash"] == m["input_hash"]
    plain = lib.load_manifest(str(_export(tmp_path, "d", "--front", str(shop / "front.jpg"), "--back", str(shop / "back.webp")) / "manifest.json"))
    assert plain["stage1b"] is None and plain["input_hash"] != flat["input_hash"]


def test_exporter_refuses_contradictory_on_model_options(tmp_path):
    shop = tmp_path / "shop"
    shop.mkdir()
    (shop / "back.jpg").write_bytes(b"b")
    with pytest.raises(subprocess.CalledProcessError) as e:
        _export(tmp_path, "x", "--on-model", "--back", str(shop / "back.jpg"))
    assert "front photo" in e.value.stderr
    with pytest.raises(subprocess.CalledProcessError) as e:
        _export(tmp_path, "y", "--on-model", "--flat-lay", "--front", str(shop / "back.jpg"))
    assert "exclude each other" in e.value.stderr
    with pytest.raises(subprocess.CalledProcessError) as e:
        _export(tmp_path, "z", "--on-model", "--synthetic-photos", "--front", str(shop / "back.jpg"))
    assert "exclude each other" in e.value.stderr
