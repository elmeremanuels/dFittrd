"""Stage 2 after the first GPU run: control mode, prompt guard and the per-frame garment-consistency metric.

Run from spikes/garment-engine/modal:  python -m pytest -q tests
Pure Python (no Modal, numpy or GPU), except the app checks, which skip without `modal`, and the exporter
round trip, which skips without Node, the spike's node_modules and `pnpm build:packages`.
"""
import copy
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
SPIKE_DIR = os.path.dirname(MODAL_DIR)
sys.path.insert(0, MODAL_DIR)

import phase0_lib as lib  # noqa: E402


@pytest.fixture()
def manifest():
    with open(os.path.join(HERE, "fixtures", "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


# --- control mode -----------------------------------------------------------------------------------


def test_fixture_is_a_proxy_job_and_old_manifests_read_as_bare(manifest):
    assert lib.control_mode(manifest) == "proxy"
    assert manifest["control"]["proxy"]["kind"] == "top"
    assert manifest["hash_inputs"]["control"]["mode"] == "proxy"
    assert all(c["proxy_mask_dir"] for c in manifest["clips"])
    old = copy.deepcopy(manifest)
    del old["control"]["mode"]
    assert lib.control_mode(old) == "bare"
    old["control"]["mode"] = "depth"
    with pytest.raises(lib.ManifestError, match="unknown control mode"):
        lib.control_mode(old)


def test_control_mode_is_part_of_the_hash(manifest):
    h = copy.deepcopy(manifest["hash_inputs"])
    h["control"] = {"mode": "bare", "proxy": None}
    assert lib.input_hash(h) != manifest["input_hash"]


# --- prompts ----------------------------------------------------------------------------------------


def test_fixture_prompts_pass_and_hold_no_title_or_brand(manifest):
    assert lib.prompt_problems(manifest) == []
    p = lib.video_prompts(manifest)
    for key in ("turntable", "motion"):
        assert manifest["product_name"].lower() not in p[key].lower()
        assert manifest["hash_inputs"]["product"]["brand"].lower() not in p[key].lower()
    assert manifest["hash_inputs"]["prompt"] == manifest["prompt"]


def test_prompt_guard_refuses_title_brand_quotes_and_missing_negatives(manifest):
    bad = copy.deepcopy(manifest)
    bad["prompt"]["turntable"] = f'The garment "{manifest["product_name"]}" on a mannequin.'
    bad["prompt"]["motion"] = f"A tee by {manifest['hash_inputs']['product']['brand']}, moving."
    bad["prompt"]["negative"] = "blurry, captions"
    problems = lib.prompt_problems(bad)
    assert any("product title" in p for p in problems)
    assert any("brand" in p for p in problems)
    assert any("quoted text" in p for p in problems)
    for term in lib.PROMPT_REQUIRED_NEGATIVE:
        assert any(f"lacks {term!r}" in p for p in problems)
    # "textile" does not count as "text".
    bad["prompt"]["negative"] = "textile, letters, words, watermark, logo"
    assert lib.prompt_problems(bad)[-1] == "negative prompt lacks 'text'"


def test_prompt_guard_wants_the_wrong_garment_in_the_negative(manifest):
    dress = copy.deepcopy(manifest)
    dress["prompt"]["kind"] = "dress"
    assert "negative prompt lacks 'trousers'" in lib.prompt_problems(dress)
    dress["prompt"]["negative"] += ", trousers"
    assert lib.prompt_problems(dress) == []
    trousers = copy.deepcopy(manifest)
    trousers["prompt"]["kind"] = "trousers"
    trousers["prompt"]["negative"] = "text, letters, words, watermark, logo, trousers"
    assert {"negative prompt lacks 'dress'", "negative prompt lacks 'skirt'"} <= set(lib.prompt_problems(trousers))


def test_a_manifest_without_prompts_must_be_re_exported(manifest):
    old = copy.deepcopy(manifest)
    del old["prompt"]
    with pytest.raises(lib.ManifestError, match="re-export"):
        lib.video_prompts(old)
    assert any("re-export" in p for p in lib.prompt_problems(old))


# --- consistency metric -----------------------------------------------------------------------------

W, H = 40, 60
BG = (233, 233, 231)  # close to, not exactly, the studio grey: the model's background is its own


def scene(rects, colour=(90, 110, 160), bg=BG):
    """RGB frame and mask with filled rectangles (x0, y0, x1, y1), exclusive ends."""
    rgb = bytearray(bytes(bg) * (W * H))
    mask = bytearray(W * H)
    for x0, y0, x1, y1 in rects:
        for y in range(y0, y1):
            for x in range(x0, x1):
                k = y * W + x
                mask[k] = 1
                rgb[3 * k:3 * k + 3] = bytes(colour)
    return rgb, mask


# A mannequin with a dress proxy: torso 14..26 from row 8 to 30, the dress one block from row 22 to 48
# (no gap between the legs), legs below it. The trousers version has the same block split at x 19..21.
TORSO = (14, 8, 26, 30)
DRESS = (10, 22, 30, 48)
LEGS = [(13, 48, 18, 58), (22, 48, 27, 58)]
TROUSERS = [(10, 22, 30, 32), (10, 32, 19, 48), (21, 32, 30, 48)]


def test_a_dress_frame_on_a_dress_proxy_passes():
    _, control = scene([TORSO, DRESS, *LEGS])
    _, proxy = scene([DRESS])
    rgb, _ = scene([TORSO, DRESS, *LEGS])
    fg = lib.frame_foreground(rgb, W, H)
    row = lib.frame_consistency(fg, control, proxy, W, H)
    assert row["silhouette_iou"] > 0.95 and row["zone_iou"] > 0.95 and row["garment_cover"] > 0.95
    assert row["zone_rows"] == [22, 48]
    assert lib.consistency_flags(row) == []


def test_trousers_on_a_dress_proxy_are_flagged():
    _, control = scene([TORSO, DRESS, *LEGS])
    _, proxy = scene([DRESS])
    # The model drew trousers: the gap between the legs is background, and the legs are narrower.
    rgb, _ = scene([TORSO, (12, 22, 28, 32), (12, 32, 19, 58), (21, 32, 28, 58)])
    row = lib.frame_consistency(lib.frame_foreground(rgb, W, H), control, proxy, W, H)
    reasons = lib.consistency_flags(row)
    assert row["garment_cover"] < lib.CONSISTENCY_THRESHOLDS["min_garment_cover"]
    assert any("proxy covered" in r for r in reasons)


def test_a_dress_on_a_trouser_proxy_is_flagged():
    _, control = scene([TORSO, *TROUSERS, *LEGS])
    _, proxy = scene(TROUSERS)
    # The model closed the legs into a skirt, flaring wider than the trousers.
    rgb, _ = scene([TORSO, (6, 22, 34, 50), *LEGS])
    row = lib.frame_consistency(lib.frame_foreground(rgb, W, H), control, proxy, W, H)
    assert row["zone_iou"] < lib.CONSISTENCY_THRESHOLDS["min_zone_iou"]
    assert any("garment-zone IoU" in r for r in lib.consistency_flags(row))


# Side view: the legs overlap into one column, so the control has no gap below the hem.
SIDE_TORSO = (16, 8, 24, 30)
SIDE_DRESS = (13, 22, 27, 48)
SIDE_LEGS = [(17, 48, 23, 58)]


def test_drift_is_visible_in_a_front_view_and_blind_in_a_side_view():
    _, control = scene([TORSO, DRESS, *LEGS])
    _, proxy = scene([DRESS])
    assert lib.gap_rows(control, W, H, 48, H) == 10
    assert lib.drift_visible(control, proxy, W, H) is True
    # Trousers proxy: the gap is in the proxy itself.
    _, tcontrol = scene([TORSO, *TROUSERS, *LEGS])
    _, tproxy = scene(TROUSERS)
    assert lib.drift_visible(tcontrol, tproxy, W, H) is True
    # Side view: the trousers drift draws the same single column the legs make, and the numbers pass.
    _, scontrol = scene([SIDE_TORSO, SIDE_DRESS, *SIDE_LEGS])
    _, sproxy = scene([SIDE_DRESS])
    assert lib.drift_visible(scontrol, sproxy, W, H) is False
    rgb, _ = scene([SIDE_TORSO, (14, 22, 26, 58)])
    row = lib.frame_consistency(lib.frame_foreground(rgb, W, H), scontrol, sproxy, W, H, rgb=rgb)
    assert row["drift_visible"] is False
    s = lib.consistency_summary([{"clip": "turntable_a", "j": 40, "frame": 40, **row}], mode="proxy")
    assert s["blind_frames"] == [{"clip": "turntable_a", "j": 40, "frame": 40}]
    assert s["drift_visible"] is None
    assert "90 and 270 degrees" in s["label"]


def test_a_light_garment_is_reported_as_low_contrast():
    _, control = scene([TORSO, DRESS, *LEGS])
    _, proxy = scene([DRESS])
    dark, _ = scene([TORSO, DRESS, *LEGS])
    assert lib.proxy_contrast(dark, proxy, W, H) > lib.CONSISTENCY_MIN_CONTRAST
    # A cream dress on the light-grey background: the foreground loses it and the cover drops.
    rgb, _ = scene([TORSO, *LEGS])
    for y in range(DRESS[1], DRESS[3]):
        for x in range(DRESS[0], DRESS[2]):
            k = y * W + x
            rgb[3 * k:3 * k + 3] = bytes((242, 235, 221))
    row = lib.frame_consistency(lib.frame_foreground(rgb, W, H), control, proxy, W, H, rgb=rgb)
    assert row["contrast"] < lib.CONSISTENCY_MIN_CONTRAST
    assert row["garment_cover"] < lib.CONSISTENCY_THRESHOLDS["min_garment_cover"]
    s = lib.consistency_summary([{"clip": "turntable_a", "j": 0, "frame": 0, **row}], mode="proxy")
    assert s["low_contrast_frames"] == [{"clip": "turntable_a", "j": 0, "frame": 0, "contrast": row["contrast"]}]
    assert "light-grey" in s["label"]


def test_background_is_read_from_the_border_and_small_specks_are_dropped():
    rgb, mask = scene([TORSO, DRESS])
    assert lib.border_colour(rgb, W, H) == BG
    k = 2 * W + 2  # one stray pixel near the corner
    rgb[3 * k:3 * k + 3] = b"\x00\x00\x00"
    fg = lib.frame_foreground(rgb, W, H)
    assert fg[k] == 0
    assert lib.mask_iou(fg, mask) > 0.97


def test_bare_control_reports_only_the_silhouette():
    rgb, control = scene([TORSO, DRESS])
    row = lib.frame_consistency(lib.frame_foreground(rgb, W, H), control, None, W, H)
    assert row["zone_iou"] is None and row["garment_cover"] is None
    s = lib.consistency_summary([{"clip": "turntable_a", "j": 0, "frame": 0, **row}], mode="bare")
    assert s["reference"].startswith("bare mannequin: NOT a garment reference")
    assert s["zone_iou"] is None and s["silhouette_iou"]["min"] == row["silhouette_iou"]


def test_summary_lists_flagged_frames_per_clip_with_initial_thresholds():
    ok = {"silhouette_iou": 0.95, "zone_iou": 0.93, "garment_cover": 0.97, "zone_rows": [1, 2]}
    drift = {"silhouette_iou": 0.9, "zone_iou": 0.7, "garment_cover": 0.6, "zone_rows": [1, 2]}
    rows = [{"clip": "turntable_a", "j": j, "frame": j, **(drift if j == 20 else ok)} for j in range(41)]
    rows += [{"clip": "motion", "j": j, "frame": j, **ok} for j in range(5)]
    s = lib.consistency_summary(rows, mode="proxy")
    assert s["frames"] == 46 and s["flagged"] == 1 and s["pass"] is False
    assert s["flagged_frames"] == [{"clip": "turntable_a", "j": 20, "frame": 20, "reasons": lib.consistency_flags(drift)}]
    assert s["per_clip"]["turntable_a"]["flagged"] == 1 and s["per_clip"]["motion"]["flagged"] == 0
    assert s["garment_cover"] == {"min": 0.6, "mean": round((40 * 0.97 + 0.6 + 5 * 0.97) / 46, 4)}
    assert s["thresholds"] == lib.CONSISTENCY_THRESHOLDS and "not tuned" in s["thresholds_note"]
    assert len(s["frames_detail"]) == 46
    assert lib.consistency_summary(rows, mode="proxy", thresholds={"min_garment_cover": 0.5, "min_zone_iou": 0.5})["flagged"] == 0


def test_plan_pairs_every_clip_frame_with_its_control_and_proxy_masks(manifest):
    plan = lib.consistency_plan(manifest)
    assert len(plan) == sum(len(c["frame_indices"]) for c in manifest["clips"])
    b = [p for p in plan if p["clip"] == "turntable_b"]
    assert b[0] == {"clip": "turntable_b", "j": 0, "frame": 4, "generated": "stage2/clips/turntable_b/0000.png", "control_mask": "control/mask/0004.png", "proxy_mask": "control/proxy_mask/0004.png"}
    assert b[-1]["frame"] == 0
    mo = [p for p in plan if p["clip"] == "motion"]
    assert mo[2]["control_mask"] == "motion/mask/0002.png" and mo[2]["proxy_mask"] == "motion/proxy_mask/0002.png"
    assert {p["clip"] for p in lib.consistency_plan(manifest, ["motion"])} == {"motion"}
    bare = copy.deepcopy(manifest)
    for c in bare["clips"]:
        c["proxy_mask_dir"] = None
    assert all(p["proxy_mask"] is None for p in lib.consistency_plan(bare))


def test_subsample_keeps_every_stride_th_pixel():
    vals = bytearray(range(6 * 4))
    out, w, h = lib.subsample(vals, 6, 4, 2)
    assert (w, h) == (3, 2) and list(out) == [0, 2, 4, 12, 14, 16]
    rgb = bytearray(range(3 * 3 * 3))
    out, w, h = lib.subsample(rgb, 3, 3, 2, channels=3)
    assert (w, h) == (2, 2) and list(out[:6]) == [0, 1, 2, 6, 7, 8]


# --- the apps ---------------------------------------------------------------------------------------


def test_stage2_uses_the_manifest_prompts_and_records_control_prompt_and_consistency():
    with open(os.path.join(MODAL_DIR, "stage2_video.py"), encoding="utf-8") as f:
        src = f.read()
    assert 'm["product_name"]' not in src, "the product title must never reach the video model"
    assert "lib.prompt_problems(m)" in src and 'prompts["negative"]' in src
    for key in ('"control_mode": mode_control', '"prompt": {k: prompts.get(k)', 'record["consistency"] = summary'):
        assert key in src


def test_stage2_registers_the_cpu_consistency_function_without_a_gpu():
    pytest.importorskip("modal")
    import warnings

    import run_phase0
    import stage2_video

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        names = set(stage2_video.app.registered_functions)
        assert names == {"download_weights", "generate", "score_consistency"}
        assert "score_consistency" in set(run_phase0.app.registered_functions)


def test_run_phase0_gate_refuses_bad_prompts(manifest, tmp_path):
    pytest.importorskip("modal")
    import run_phase0

    assert run_phase0._dress_gate(manifest, str(tmp_path), None, accept_failed=False, allow_invented=False) == []
    bad = copy.deepcopy(manifest)
    bad["prompt"]["turntable"] = f"{manifest['product_name']} on a mannequin"
    assert any(r.startswith("prompt: turntable prompt contains the product title") for r in run_phase0._dress_gate(bad, str(tmp_path), None, accept_failed=False, allow_invented=False))
    s = run_phase0._base_summary(manifest, {})
    assert s["control_mode"] == "proxy" and s["control_proxy"] == "top" and s["prompt"] == manifest["prompt"]["description"]


# --- round trip through the TypeScript exporter --------------------------------------------------------


def _tsx():
    tsx = os.path.join(SPIKE_DIR, "node_modules", ".bin", "tsx")
    built = os.path.exists(os.path.join(SPIKE_DIR, "..", "..", "packages", "mannequin", "dist"))
    return tsx if shutil.which("node") and os.path.exists(tsx) and built else None


@pytest.mark.parametrize("control", ["proxy", "bare"])
def test_exporter_control_option_round_trip(tmp_path, control):
    tsx = _tsx()
    if tsx is None:
        pytest.skip("needs Node, the spike's node_modules and `pnpm build:packages`")
    subprocess.run(
        [tsx, os.path.join(SPIKE_DIR, "src", "exportCli.ts"), "--product", "aalter-studio-2", "--frames", "8", "--width", "64", "--height", "112",
         "--motion-frames", "5", "--synthetic-photos", "--no-synthetic", "--control", control, "--out", str(tmp_path)],
        check=True, capture_output=True, text=True, cwd=SPIKE_DIR,
    )
    m = lib.load_manifest(str(tmp_path / "aalter-studio-2" / "manifest.json"))
    assert lib.control_mode(m) == control and lib.prompt_problems(m) == []
    assert m["prompt"]["kind"] == "dress" and "trousers" in m["prompt"]["negative"]
    plan = lib.consistency_plan(m)
    for item in plan:
        assert (tmp_path / "aalter-studio-2" / item["control_mask"]).exists()
        if control == "proxy":
            assert (tmp_path / "aalter-studio-2" / item["proxy_mask"]).exists()
        else:
            assert item["proxy_mask"] is None
