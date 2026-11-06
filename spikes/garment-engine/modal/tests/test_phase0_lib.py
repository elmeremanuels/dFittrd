"""Tests for phase0_lib (pure Python; no Modal, numpy or GPU needed).

Run from spikes/garment-engine/modal:  python -m pytest -q tests
The fixtures are a small job written by the TypeScript exporter (8 frames, 64x112):
  pnpm --filter @curtain/garment-spike export:phase0 -- --product monochrome-03 --frames 8 \
    --width 64 --height 112 --motion-frames 5 --synthetic-photos --out <tmp>
and copied from <tmp>/monochrome-03/ (manifest.json, cameras_opencv.json, transforms.json).
src/exportJob.test.ts checks that the fixture still matches the exporter.
"""
import ast
import copy
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
sys.path.insert(0, MODAL_DIR)

import phase0_lib as lib  # noqa: E402

FIX = os.path.join(HERE, "fixtures")


def load(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture()
def manifest():
    return load("manifest.json")


# --- manifest -------------------------------------------------------------------------------------


def test_fixture_manifest_is_valid_and_hash_matches_the_exporter(manifest):
    m = lib.check_manifest(manifest)
    assert m["product_id"] == "monochrome-03"
    assert lib.input_hash(m["hash_inputs"]) == m["input_hash"]
    assert m["job_id"].endswith(m["input_hash"][:12])
    assert lib.photo_path(m, "front") == "photos/front.png"
    assert lib.load_manifest(os.path.join(FIX, "manifest.json"))["input_hash"] == m["input_hash"]


def test_hash_is_stable_under_key_order_and_changes_with_content(manifest):
    h = manifest["hash_inputs"]
    reordered = json.loads(json.dumps(h, sort_keys=False), object_pairs_hook=lambda kv: dict(reversed(kv)))
    assert lib.input_hash(reordered) == manifest["input_hash"]
    changed = copy.deepcopy(h)
    changed["seeds"]["video"] += 1
    assert lib.input_hash(changed) != manifest["input_hash"]
    assert lib.canonical_json({"b": 1, "a": [2, {"d": 3, "c": "x"}]}) == '{"a":[2,{"c":"x","d":3}],"b":1}'
    assert lib.canonical_json({"s": "× café"}) == '{"s":"× café"}'  # UTF-8 as is, like JSON.stringify


def test_a_hand_edited_manifest_is_refused(manifest):
    bad = copy.deepcopy(manifest)
    bad["hash_inputs"]["base_size"] = "L"
    with pytest.raises(lib.ManifestError, match="input_hash does not match"):
        lib.check_manifest(bad)


def test_front_and_back_photos_are_required(manifest):
    bad = copy.deepcopy(manifest)
    bad["photos"] = [p for p in bad["photos"] if p["role"] != "back"]
    with pytest.raises(lib.ManifestError, match="exactly one back photo"):
        lib.check_manifest(bad)


def test_pins_must_match_the_modal_side(manifest):
    assert manifest["models"] == lib.PINNED_MODELS
    bad = copy.deepcopy(manifest)
    bad["models"]["video"]["revision"] = "0" * 40
    bad["hash_inputs"]["models"] = bad["models"]
    bad["input_hash"] = lib.input_hash(bad["hash_inputs"])
    bad["job_id"] = f"{bad['product_id']}-{bad['input_hash'][:12]}"
    with pytest.raises(lib.ManifestError, match="pinned model versions differ"):
        lib.check_manifest(bad)
    assert lib.check_manifest(bad, check_pins=False)["input_hash"] == bad["input_hash"]


def test_wrong_format_and_missing_keys():
    with pytest.raises(lib.ManifestError, match="missing keys"):
        lib.check_manifest({"format": lib.MANIFEST_FORMAT, "format_version": 1})
    with pytest.raises(lib.ManifestError, match="format is"):
        lib.check_manifest({"format": "x", "format_version": 1})


# --- poses ----------------------------------------------------------------------------------------


def test_transforms_and_opencv_files_carry_the_same_poses():
    k_ns, ns = lib.poses_from_transforms(load("transforms.json"))
    k_cv, cv = lib.poses_from_opencv(load("cameras_opencv.json"))
    assert sorted(ns) == sorted(cv) == list(range(8))
    assert lib.max_abs_diff(k_ns, k_cv) < 1e-9
    for i in ns:
        # The files round to 6 decimals (micrometres), so rotations are orthonormal to about 1e-6.
        assert lib.max_abs_diff(ns[i], cv[i]) < 5e-6
        # Round trip OpenCV -> OpenGL -> OpenCV.
        assert lib.max_abs_diff(lib.opengl_c2w_to_opencv_w2c(lib.opencv_w2c_to_opengl_c2w(cv[i])), cv[i]) < 1e-5
        ident = lib.mat_mul(cv[i], lib.invert_rigid(cv[i]))
        assert lib.max_abs_diff(ident, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) < 1e-5


def test_frame_0_is_front_and_frame_n_over_2_is_back():
    _, cv = lib.poses_from_opencv(load("cameras_opencv.json"))
    front, back, left = lib.camera_centre(cv[0]), lib.camera_centre(cv[4]), lib.camera_centre(cv[2])
    assert front[2] > 3 and abs(front[0]) < 1e-6  # 3.2 m in front, on +Z
    assert back[2] < -3 and abs(back[0]) < 1e-6
    assert left[0] > 3  # frame N/4 sees the mannequin's left (+X)
    assert cv[0][2][2] < -0.99  # optical axis of frame 0 points to -Z (at the mannequin's front)
    assert cv[4][2][2] > 0.99


def test_projection_and_principal_point_conventions():
    cams = load("cameras_opencv.json")
    k, cv = lib.poses_from_opencv(cams)
    assert k[0][2] == cams["width"] / 2 and k[1][2] == cams["height"] / 2  # pixel-corner origin
    look_at_height = 0.52 * load("manifest.json")["mannequin"]["stature_cm"] / 100
    u, v, z = lib.project(k, cv[0], [0.0, look_at_height, 0.0])
    assert abs(u - cams["width"] / 2) < 1e-3 and abs(v - cams["height"] / 2) < 1e-3
    stature = load("manifest.json")["mannequin"]["stature_cm"] / 100
    assert abs(z - ((3.2**2 + ((0.6 - 0.52) * stature) ** 2) ** 0.5)) < 1e-5  # camera at 0.6 x stature, aimed at 0.52 x stature
    u_head = lib.project(k, cv[0], [0.0, 1.6, 0.0])[1]
    assert u_head < v  # image y points down
    k_int = lib.k_integer_centres(k)
    assert k_int[0][2] == k[0][2] - 0.5 and k_int[1][2] == k[1][2] - 0.5


# --- clips ----------------------------------------------------------------------------------------


def test_turntable_assembly_covers_every_frame_once(manifest):
    assignments, seams = lib.turntable_assembly(manifest)
    assert [a[0] for a in assignments] == list(range(8))
    assert assignments[0] == (0, "turntable_a", 0)
    assert assignments[4] == (4, "turntable_a", 4)
    assert assignments[5] == (5, "turntable_b", 1)
    assert seams == [(0, [("turntable_a", 0), ("turntable_b", 4)]), (4, [("turntable_a", 4), ("turntable_b", 0)])]


def test_turntable_assembly_full_size():
    m = {"camera": {"frames": 160}, "clips": [
        {"id": "turntable_a", "kind": "turntable", "frame_indices": list(range(81))},
        {"id": "turntable_b", "kind": "turntable", "frame_indices": [(80 + i) % 160 for i in range(81)]},
        {"id": "motion", "kind": "motion", "frame_indices": list(range(81))},
    ]}
    assignments, seams = lib.turntable_assembly(m)
    assert len(assignments) == 160 and assignments[159] == (159, "turntable_b", 79)
    assert [s[0] for s in seams] == [0, 80]
    m["clips"][1]["frame_indices"] = m["clips"][1]["frame_indices"][:40]
    with pytest.raises(lib.ManifestError, match="do not cover"):
        lib.turntable_assembly(m)


def test_control_value_matches_the_exporter_encoding(manifest):
    near, far = manifest["control"]["near_cm"], manifest["control"]["far_cm"]
    assert lib.control_value(0, near, far) == 0
    assert lib.control_value(int(near * 10), near, far) == 255
    assert lib.control_value(int(far * 10), near, far) == 1
    mid = lib.control_value(int((near + far) * 5), near, far)
    assert 126 <= mid <= 129
    inv = lib.control_value(int((near + far) * 5), near, far, "inverse")
    assert inv < mid  # 1/depth spends more of the 8 bits near the camera, so the middle sits lower
    assert lib.control_value(int(near * 10), near, far, "inverse") == 255
    assert lib.control_value(int(far * 10), near, far, "inverse") == 1
    with pytest.raises(ValueError):
        lib.control_value(3000, near, far, "log")


def test_triangle_target_is_clamped_to_the_budget():
    assert lib.triangle_target(None) == 12000
    assert lib.triangle_target(500) == 8000
    assert lib.triangle_target(40000) == 15000


# --- cost -----------------------------------------------------------------------------------------


def test_cost_record_uses_the_research_price_table_and_is_marked_estimate():
    r = lib.cost_record("stage2_video", gpu="H100", region="eu", gpu_seconds=3600, wall_seconds=3720)
    assert r["estimate"] is True
    assert r["usd_per_hour"] == pytest.approx(3.95 * 1.15)
    assert r["usd_estimate_low"] == pytest.approx(4.5425)
    assert r["usd_estimate_high"] == pytest.approx(4.5425 * 3720 / 3600, abs=1e-4)
    assert lib.cost_record("x", gpu="L40S:2", region=None, gpu_seconds=1800)["usd_estimate_low"] == pytest.approx(1.95)
    assert lib.cost_record("x", gpu="a10g", region=None, gpu_seconds=3600)["usd_per_hour"] == pytest.approx(1.10)


def test_unknown_gpu_or_region_gives_no_price_instead_of_a_guess():
    r = lib.cost_record("x", gpu="B200", region="eu", gpu_seconds=100)
    assert r["usd_estimate_low"] is None and "no list price" in r["notes"][0]
    r = lib.cost_record("x", gpu="H100", region="ap-south", gpu_seconds=100)
    assert r["usd_estimate_low"] is None and "no region multiplier" in r["notes"][0]


def test_summary_and_table():
    rs = [
        lib.cost_record("stage2_video", gpu="H100", region="eu", gpu_seconds=3600, wall_seconds=3700),
        lib.cost_record("stage4_recon", gpu="L40S", region="eu", gpu_seconds=1200, wall_seconds=1300),
        lib.cost_record("other", gpu="B200", region="eu", gpu_seconds=10),
    ]
    s = lib.summarize_costs(rs)
    assert s["estimate"] is True
    assert s["usd_estimate_low"] == pytest.approx(4.5425 + 1.95 * 1.15 / 3)
    assert s["stages_without_price"] == ["other"]
    table = lib.format_cost_table(rs)
    assert table.startswith("ESTIMATE")
    assert "stage4_recon" in table and "n/a" in table


# --- settings -------------------------------------------------------------------------------------


def test_settings_defaults_and_overrides():
    s = lib.settings({})
    assert s["region"] is None and s["gpu_video"] == "H100" and s["gpu_recon"] == "L40S"
    s = lib.settings({"CURTAIN_MODAL_REGION": "eu", "CURTAIN_MODAL_GPU_RECON": "A100-80GB", "CURTAIN_MODAL_TIMEOUT_RECON": "1800"})
    assert s["region"] == "eu" and s["gpu_recon"] == "A100-80GB" and s["timeout_recon"] == 1800
    with pytest.raises(ValueError, match="CURTAIN_MODAL_TIMEOUT_VIDEO"):
        lib.settings({"CURTAIN_MODAL_TIMEOUT_VIDEO": "10"})
    with pytest.raises(ValueError, match="CURTAIN_WAN_MEMORY_MODE"):
        lib.settings({"CURTAIN_WAN_MEMORY_MODE": "fast"})


def test_job_input_files_skip_stage_outputs(tmp_path):
    for p in ["manifest.json", "control/mask/0000.png", "stage2/frames/0000.png", "stage4/synthetic/garment.glb", "photos/front.png"]:
        f = tmp_path / p
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
    assert lib.job_input_files(str(tmp_path)) == ["control/mask/0000.png", "manifest.json", "photos/front.png"]


# --- the Modal apps -------------------------------------------------------------------------------


def test_phase0_lib_does_not_import_modal_or_third_party_packages():
    tree = ast.parse(open(os.path.join(MODAL_DIR, "phase0_lib.py"), encoding="utf-8").read())
    imported = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    imported |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    assert imported <= {"__future__", "hashlib", "json", "math", "os", "typing"}


@pytest.mark.parametrize("name", ["stage2_video.py", "stage4_recon.py", "run_phase0.py", "phase0_modal.py", "phase0_mesh.py", "smoke.py"])
def test_modal_apps_parse_and_pin_inline_packages(name):
    tree = ast.parse(open(os.path.join(MODAL_DIR, name), encoding="utf-8").read())  # syntax check without importing modal
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") in ("pip_install", "uv_pip_install"):
            for v in node.args:
                if isinstance(v, ast.Constant) and isinstance(v.value, str):
                    assert "==" in v.value, f"{name}: unpinned package {v.value!r}"


def _reqs(name):
    with open(os.path.join(MODAL_DIR, name), encoding="utf-8") as f:
        return [line.split("#")[0].strip() for line in f if line.split("#")[0].strip()]


@pytest.mark.parametrize("stage", ["stage2", "stage4"])
def test_image_requirements_are_fully_pinned_and_locked(stage):
    direct, lock = _reqs(f"requirements-{stage}.in"), _reqs(f"requirements-{stage}.txt")
    assert lock and all("==" in r for r in direct + lock)
    locked = {r.split("==")[0].lower().replace("_", "-"): r.split("==")[1] for r in lock}
    for r in direct:
        name, version = r.split("==")
        assert locked.get(name.lower().replace("_", "-")) == version, f"{stage}: {r} not in the lock"


def test_recon_requirements_match_the_pinned_versions():
    direct = _reqs("requirements-stage4.in")
    assert f"gsplat=={lib.PINNED_MODELS['recon']['version']}" in direct
    assert f"open3d=={lib.PINNED_MODELS['recon']['mesher_version']}" in direct
