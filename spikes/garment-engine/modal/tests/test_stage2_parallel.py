"""Stage 2 with one GPU container per clip and the motion clip opt-in (stage2-parallel-0.1.0).

Run from spikes/garment-engine/modal:  python -m pytest -q tests
The plan, outcome and cost helpers are pure Python. The runner, `assemble` and run_phase0's wiring need `modal`
(skipped without it); every Modal call is replaced by a fake, nothing reaches Modal or a GPU.
"""
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
sys.path.insert(0, MODAL_DIR)

import phase0_lib as lib  # noqa: E402


@pytest.fixture()
def manifest():
    with open(os.path.join(HERE, "fixtures", "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


# --- which clips, which seed ---------------------------------------------------------------------------


def test_motion_is_off_by_default_and_seeds_match_the_three_clip_runs(manifest):
    plan = lib.stage2_clip_plan(manifest)
    assert [(c["id"], c["seed"]) for c in plan] == [("turntable_a", 43), ("turntable_b", 44)]
    full = lib.stage2_clip_plan(manifest, motion=True)
    # Runs up to 17d: seed = video seed + position, all three clips generated -> 43, 44, 45. Unchanged.
    assert [(c["id"], c["seed"]) for c in full] == [("turntable_a", 43), ("turntable_b", 44), ("motion", 45)]


def test_a_clip_keeps_its_seed_whatever_else_runs(manifest):
    assert [(c["id"], c["seed"]) for c in lib.stage2_clip_plan(manifest, ["turntable_b"])] == [("turntable_b", 44)]
    assert [(c["id"], c["seed"]) for c in lib.stage2_clip_plan(manifest, ["motion"])] == [("motion", 45)]
    assert [c["id"] for c in lib.stage2_clip_plan(manifest, ["turntable_a"], motion=True)] == ["turntable_a", "motion"]
    with pytest.raises(lib.ManifestError, match="unknown clip spin"):
        lib.stage2_clip_plan(manifest, ["spin"])


def test_the_plan_does_not_touch_the_manifest_or_its_hash(manifest):
    before = json.dumps(manifest, sort_keys=True)
    lib.stage2_clip_plan(manifest)
    lib.stage2_clip_plan(manifest, motion=True)
    assert json.dumps(manifest, sort_keys=True) == before
    assert lib.input_hash(manifest["hash_inputs"]) == manifest["input_hash"]  # same job id, same Volume directory


# --- outcome --------------------------------------------------------------------------------------------


def test_outcome_complete_only_when_every_planned_clip_came_back(manifest):
    plan = lib.stage2_clip_plan(manifest)
    a, b = ({"id": "turntable_a"}, {"id": "turntable_b"})
    ok = lib.stage2_outcome(manifest, plan, [a, b], [])
    assert ok["complete"] and ok["turntable"] and ok["failed"] == []
    half = lib.stage2_outcome(manifest, plan, [a], [{"id": "turntable_b", "error": "boom"}])
    assert not half["complete"] and not half["turntable"] and half["generated"] == ["turntable_a"]
    assert half["failed"] == [{"id": "turntable_b", "error": "boom"}] and half["turntable_requested"]
    lost = lib.stage2_outcome(manifest, plan, [a], [])
    assert not lost["complete"] and lost["failed"] == [{"id": "turntable_b", "error": "no result returned"}]
    motion_only = lib.stage2_outcome(manifest, lib.stage2_clip_plan(manifest, ["motion"]), [{"id": "motion"}], [])
    assert motion_only["complete"] and not motion_only["turntable"] and not motion_only["turntable_requested"]


# --- cost ----------------------------------------------------------------------------------------------


def test_costs_sum_both_containers_with_their_own_model_load(manifest):
    plan = lib.stage2_clip_plan(manifest)
    results = {"turntable_a": {"gpu_seconds": 480.0, "load_seconds": 16.0, "gpu_name": "H100"}, "turntable_b": {"gpu_seconds": 466.0, "load_seconds": 13.0, "gpu_name": "H100"}}
    c = lib.stage2_costs(plan, results, {"turntable_a": 495.0, "turntable_b": 497.0}, gpu="H100", region=None, stage_wall_seconds=497.0)
    assert [r["stage"] for r in c["records"]] == ["stage2_video[turntable_a]", "stage2_video[turntable_b]"]
    assert c["parallel"]["containers"] == 2 and c["parallel"]["gpu_seconds"] == 946.0
    assert c["parallel"]["load_seconds_total"] == 29.0 and c["parallel"]["wall_seconds"] == 497.0
    s = lib.summarize_costs(c["records"])
    assert s["gpu_seconds"] == 946.0
    assert s["usd_estimate_low"] == pytest.approx(3.95 * 946 / 3600, abs=1e-3)
    assert s["usd_estimate_high"] == pytest.approx(3.95 * (495 + 497) / 3600, abs=1e-3)
    assert c["total"]["gpu_seconds"] == 946.0 and c["total"]["usd_estimate_low"] == s["usd_estimate_low"] and c["total"]["usd_estimate_high"] == s["usd_estimate_high"]
    assert c["total"]["wall_seconds"] == 497.0 and c["total"]["containers"] == 2
    line = lib.stage2_parallel_line(c["parallel"])
    assert "2 GPU containers" in line and "wall 497 s" in line and "GPU 946 s" in line and "paid per container" in line
    table = lib.format_cost_table(c["records"])
    assert "stage2_video[turntable_a]" in table and "stage2_video[turntable_b]" in table


def test_a_failed_container_is_costed_by_its_wall_time(manifest):
    plan = lib.stage2_clip_plan(manifest)
    c = lib.stage2_costs(plan, {"turntable_a": {"gpu_seconds": 480.0, "load_seconds": 16.0}}, {"turntable_a": 490.0, "turntable_b": 120.0}, gpu="H100", region=None, stage_wall_seconds=490.0)
    bad = c["records"][1]
    assert bad["failed"] and bad["gpu_seconds"] == 0 and bad["wall_seconds"] == 120.0
    assert bad["usd_estimate_low"] == 0 and bad["usd_estimate_high"] == pytest.approx(3.95 * 120 / 3600, abs=1e-4)
    assert any("failed" in n for n in bad["notes"])


# --- downstream without the motion clip --------------------------------------------------------------------


def test_consistency_plan_and_assembly_need_no_motion_clip(manifest):
    plan = lib.consistency_plan(manifest, ["turntable_a", "turntable_b"])
    assert {p["clip"] for p in plan} == {"turntable_a", "turntable_b"} and len(plan) == 10
    assignments, seams = lib.turntable_assembly(manifest)  # turntable clips only, motion never involved
    assert {cid for _, cid, _ in assignments} == {"turntable_a", "turntable_b"} and len(seams) == 2
    rows = [{"clip": p["clip"], "j": p["j"], "frame": p["frame"], "silhouette_iou": 0.95, "zone_iou": 0.9, "garment_cover": 0.97, "flags": []} for p in plan]
    s = lib.consistency_summary(rows, mode="proxy", stride=2)
    assert set(s["per_clip"]) == {"turntable_a", "turntable_b"}


# --- the runner with fake Modal calls ------------------------------------------------------------------------


class FakeCall:
    def __init__(self, log, result=None, error=None):
        self.log, self.result, self.error = log, result, error

    def get(self):
        self.log.append(("get", self.result["id"] if self.result else "error"))
        if self.error:
            raise self.error
        return self.result


class FakeClipFn:
    def __init__(self, fail=()):
        self.log, self.fail, self.spawned = [], set(fail), []

    def spawn(self, job_id, clip_id, seed, **kw):
        self.log.append(("spawn", clip_id))
        self.spawned.append({"job_id": job_id, "clip_id": clip_id, "seed": seed, **kw})
        if clip_id in self.fail:
            return FakeCall(self.log, error=RuntimeError(f"CUDA out of memory in {clip_id}"))
        return FakeCall(self.log, result={"id": clip_id, "kind": "motion" if clip_id == "motion" else "turntable", "frames": 5, "seed": seed, "start": None, "end": None,
                                          "seconds": 450.0, "load_seconds": 15.0, "gpu_name": "NVIDIA H100 80GB HBM3", "memory_mode": "model_cpu_offload", "gpu_seconds": 470.0})


class FakeRemote:
    def __init__(self, fn):
        self.fn, self.calls = fn, []

    def remote(self, *a, **kw):
        self.calls.append((a, kw))
        return self.fn(*a, **kw)


def _s2():
    pytest.importorskip("modal")
    import stage2_video

    return stage2_video


def test_runner_spawns_every_clip_before_gathering_and_passes_the_seeds(manifest):
    s2 = _s2()
    clip_fn = FakeClipFn()
    asm = FakeRemote(lambda job_id, plan, done, failed, settings, costs: {"complete": not failed, "clips": done, "failed_clips": failed, "costs": costs["records"], "parallel": costs["parallel"], "settings": settings})
    rec = s2.run_stage2(manifest, steps=40, clip_fn=clip_fn, assemble_fn=asm)
    assert clip_fn.log[:2] == [("spawn", "turntable_a"), ("spawn", "turntable_b")], "both containers start before any result is awaited"
    assert [(s["clip_id"], s["seed"], s["steps"], s["pin_frames"]) for s in clip_fn.spawned] == [("turntable_a", 43, 40, True), ("turntable_b", 44, 40, True)]
    assert all(s["job_id"] == manifest["job_id"] for s in clip_fn.spawned)
    assert rec["complete"] and [c["id"] for c in rec["clips"]] == ["turntable_a", "turntable_b"]
    assert rec["parallel"]["containers"] == 2 and rec["parallel"]["gpu_seconds"] == 940.0 and rec["parallel"]["load_seconds_total"] == 30.0
    (args, _), = asm.calls
    assert [c["id"] for c in args[1]] == ["turntable_a", "turntable_b"] and args[3] == []
    assert args[4] == {"steps": 40, "guidance_scale": 6.0, "shift": 5.0, "control_encoding": "linear", "pin_frames": True}


def test_runner_with_motion_spawns_a_third_container(manifest):
    s2 = _s2()
    clip_fn = FakeClipFn()
    s2.run_stage2(manifest, motion=True, clip_fn=clip_fn, assemble_fn=FakeRemote(lambda *a: {"complete": True}))
    assert [(s["clip_id"], s["seed"]) for s in clip_fn.spawned] == [("turntable_a", 43), ("turntable_b", 44), ("motion", 45)]


def test_one_failed_clip_keeps_the_other_and_reports_the_failure(manifest):
    s2 = _s2()
    clip_fn = FakeClipFn(fail={"turntable_a"})
    seen = {}

    def assemble(job_id, plan, done, failed, settings, costs):
        seen.update(done=done, failed=failed, costs=costs)
        return {"complete": False, "clips": done, "failed_clips": failed, "turntable_frames_assembled": 0, "seams": [], "costs": costs["records"]}

    rec = s2.run_stage2(manifest, clip_fn=clip_fn, assemble_fn=FakeRemote(assemble))
    assert ("get", "turntable_b") in clip_fn.log, "the second clip is still gathered after the first failed"
    assert [c["id"] for c in seen["done"]] == ["turntable_b"]
    assert seen["failed"][0]["id"] == "turntable_a" and "CUDA out of memory" in seen["failed"][0]["error"]
    assert [r.get("failed", False) for r in seen["costs"]["records"]] == [True, False]
    assert not rec["complete"]
    line = s2.stage2_failure_line(rec)
    assert "INCOMPLETE" in line and "turntable_a" in line and "generated turntable_b" in line and "stage 4 not started" in line
    assert s2.stage2_failure_line({"complete": True}) == ""


def test_a_failed_assemble_is_reported_with_the_spent_gpu_time(manifest):
    s2 = _s2()

    def boom(*a):
        raise ConnectionError("volume unavailable")

    rec = s2.run_stage2(manifest, clip_fn=FakeClipFn(), assemble_fn=FakeRemote(boom))
    assert rec["complete"] is False and rec["failed_clips"][-1]["id"] == "assemble"
    assert len(rec["costs"]) == 2 and rec["parallel"]["gpu_seconds"] == 940.0 and rec["turntable_frames_assembled"] == 0


# --- assemble on a job directory (CPU, fake Volume) ------------------------------------------------------------


class FakeVolume:
    def __init__(self):
        self.commits = 0

    def reload(self):
        pass

    def commit(self):
        self.commits += 1


def _job(tmp_path, manifest, clips):
    from PIL import Image

    job = tmp_path / manifest["job_id"]
    (job / "stage2").mkdir(parents=True)
    (job / "manifest.json").write_text(json.dumps(manifest))
    for cid in clips:
        d = job / "stage2" / "clips" / cid
        d.mkdir(parents=True)
        for j in range(5):
            Image.new("RGB", (8, 8), (100 + j, 50, 50)).save(d / f"{j:04d}.png")
    return job


def _assemble(s2, monkeypatch, tmp_path, manifest, done_ids, failed):
    import phase0_modal as pm

    vol = FakeVolume()
    monkeypatch.setattr(pm, "JOBS_DIR", str(tmp_path))
    monkeypatch.setattr(pm, "jobs", vol)
    plan = lib.stage2_clip_plan(manifest)
    done = [{"id": c, "kind": "turntable", "frames": 5, "seed": 43 + i, "seconds": 450.0, "load_seconds": 15.0, "gpu_seconds": 470.0, "gpu_name": "H100"} for i, c in enumerate(done_ids)]
    results = {c["id"]: c for c in done}
    costs = lib.stage2_costs(plan, results, {c: 480.0 for c in ("turntable_a", "turntable_b")}, gpu="H100", region=None, stage_wall_seconds=480.0)
    rec = s2.assemble.local(manifest["job_id"], plan, done, failed, {"steps": 40, "guidance_scale": 6.0, "shift": 5.0, "control_encoding": "linear", "pin_frames": True}, costs)
    return rec, vol


@pytest.mark.filterwarnings("ignore:The assemble function is executing locally")
def test_assemble_builds_the_turntable_without_a_motion_clip(manifest, tmp_path, monkeypatch):
    s2 = _s2()
    pytest.importorskip("numpy")
    pytest.importorskip("PIL")
    job = _job(tmp_path, manifest, ["turntable_a", "turntable_b"])
    rec, vol = _assemble(s2, monkeypatch, tmp_path, manifest, ["turntable_a", "turntable_b"], [])
    assert rec["complete"] and rec["motion"] is False and rec["planned_clips"] == ["turntable_a", "turntable_b"]
    assert rec["turntable_frames_assembled"] == 8 and len(rec["seams"]) == 2
    assert sorted(os.listdir(job / "stage2" / "frames")) == [f"{i:04d}.png" for i in range(8)]
    assert rec["load_seconds"] == 30.0 and rec["cost"]["gpu_seconds"] == 940.0 and len(rec["costs"]) == 2
    assert json.loads((job / "stage2" / "record.json").read_text())["complete"] is True and vol.commits == 1
    assert [c["seed"] for c in rec["clips"]] == [43, 44]


@pytest.mark.filterwarnings("ignore:The assemble function is executing locally")
def test_assemble_after_a_failed_clip_writes_no_half_turntable(manifest, tmp_path, monkeypatch):
    s2 = _s2()
    pytest.importorskip("numpy")
    pytest.importorskip("PIL")
    job = _job(tmp_path, manifest, ["turntable_b"])
    for sub in ("frames", "garment_mask"):  # an earlier run's outputs under the same job id
        (job / "stage2" / sub).mkdir()
        (job / "stage2" / sub / "0000.png").write_bytes(b"old")
    rec, _ = _assemble(s2, monkeypatch, tmp_path, manifest, ["turntable_b"], [{"id": "turntable_a", "error": "RuntimeError: boom"}])
    assert rec["complete"] is False and rec["turntable_frames_assembled"] == 0
    assert rec["failed_clips"] == [{"id": "turntable_a", "error": "RuntimeError: boom"}] and [c["id"] for c in rec["clips"]] == ["turntable_b"]
    assert not (job / "stage2" / "frames").exists() and not (job / "stage2" / "garment_mask").exists()
    assert rec["removed_stale"] == ["stage2/frames", "stage2/garment_mask"]
    assert (job / "stage2" / "clips" / "turntable_b" / "0004.png").exists(), "the clip that finished is kept"


@pytest.mark.filterwarnings("ignore:The assemble function is executing locally")
def test_assemble_counts_a_clip_with_missing_frames_as_failed(manifest, tmp_path, monkeypatch):
    s2 = _s2()
    pytest.importorskip("numpy")
    pytest.importorskip("PIL")
    job = _job(tmp_path, manifest, ["turntable_a", "turntable_b"])
    os.remove(job / "stage2" / "clips" / "turntable_b" / "0003.png")
    rec, _ = _assemble(s2, monkeypatch, tmp_path, manifest, ["turntable_a", "turntable_b"], [])
    assert rec["complete"] is False and rec["failed_clips"] == [{"id": "turntable_b", "error": "4/5 frames in the Volume"}]
    assert rec["turntable_frames_assembled"] == 0


# --- run_phase0 wiring ---------------------------------------------------------------------------------------


def _phase0(monkeypatch, manifest, tmp_path, clip_fn):
    pytest.importorskip("modal")
    import phase0_modal as pm
    import run_phase0
    import stage2_video
    import stage4_recon

    calls = {"reconstruct": 0, "consistency": 0}

    class Recon:
        def spawn(self, *a, **kw):
            calls["reconstruct"] += 1

            class C:
                def get(self):
                    return {"cost": lib.cost_record("stage4_recon[stage2]", gpu="L40S", region=None, gpu_seconds=100.0), "mesh": {"triangles": 12000}, "mask_iou": 0.97, "vs_truth": None}
            return C()

    def consistency(job_id, **kw):
        calls["consistency"] += 1
        return {"version": "garment-consistency-0.4.0", "flagged": 0, "frames": 10, "flagged_frames": [], "garment_iou": {"min": 0.9, "mean": 0.95}}

    def assemble(job_id, plan, done, failed, settings, costs):
        ok = not failed
        return {"clips": done, "turntable_frames_assembled": 8 if ok else 0, "seams": [], "load_seconds": 30.0, "steps": settings["steps"], "control_mode": "proxy",
                "motion": False, "complete": ok, "failed_clips": failed, "parallel": costs["parallel"], "cost": costs["total"], "costs": costs["records"]}

    monkeypatch.setattr(pm, "load_local_job", lambda job_dir: manifest)
    monkeypatch.setattr(pm, "upload_job", lambda *a, **kw: None)
    monkeypatch.setattr(pm, "download_dir", lambda *a, **kw: 0)
    monkeypatch.setattr(stage2_video, "download_weights", FakeRemote(lambda: {"cached": True}))
    monkeypatch.setattr(stage2_video, "generate_clip", clip_fn)
    monkeypatch.setattr(stage2_video, "assemble", FakeRemote(assemble))
    monkeypatch.setattr(stage2_video, "score_consistency", FakeRemote(consistency))
    monkeypatch.setattr(stage4_recon, "reconstruct", Recon())
    return run_phase0.main.info.raw_f, calls


def test_run_phase0_runs_the_turntable_pair_in_parallel_and_sums_the_containers(manifest, tmp_path, monkeypatch):
    clip_fn = FakeClipFn()
    main, calls = _phase0(monkeypatch, manifest, tmp_path, clip_fn)
    main(str(tmp_path), no_synthetic_recon=True)
    assert [s["clip_id"] for s in clip_fn.spawned] == ["turntable_a", "turntable_b"]
    s = json.loads((tmp_path / "cost_summary.json").read_text())
    assert [c["stage"] for c in s["costs"]] == ["stage2_video[turntable_a]", "stage2_video[turntable_b]", "stage4_recon[stage2]"]
    assert s["cost_total"]["gpu_seconds"] == 1040.0
    assert s["stage2"]["complete"] is True and s["stage2"]["motion"] is False and s["stage2"]["parallel"]["containers"] == 2
    assert calls == {"reconstruct": 1, "consistency": 1}


def test_run_phase0_with_motion_adds_the_third_container(manifest, tmp_path, monkeypatch):
    clip_fn = FakeClipFn()
    main, _ = _phase0(monkeypatch, manifest, tmp_path, clip_fn)
    main(str(tmp_path), no_synthetic_recon=True, motion=True)
    assert [(s["clip_id"], s["seed"]) for s in clip_fn.spawned] == [("turntable_a", 43), ("turntable_b", 44), ("motion", 45)]
    s = json.loads((tmp_path / "cost_summary.json").read_text())
    assert [c["stage"] for c in s["costs"]][:3] == ["stage2_video[turntable_a]", "stage2_video[turntable_b]", "stage2_video[motion]"]


def test_run_phase0_stops_before_stage4_when_a_clip_failed(manifest, tmp_path, monkeypatch):
    main, calls = _phase0(monkeypatch, manifest, tmp_path, FakeClipFn(fail={"turntable_b"}))
    with pytest.raises(SystemExit) as e:
        main(str(tmp_path), no_synthetic_recon=True)
    assert e.value.code == 1
    assert calls == {"reconstruct": 0, "consistency": 0}
    s = json.loads((tmp_path / "cost_summary.json").read_text())
    assert s["stopped_after_stage2"][0]["id"] == "turntable_b" and s["stage2"]["complete"] is False
    assert [c["stage"] for c in s["costs"]] == ["stage2_video[turntable_a]", "stage2_video[turntable_b]"] and s["costs"][1]["failed"]


def test_rescoring_a_job_dir_follows_the_record_not_stale_clip_folders(tmp_path):
    pytest.importorskip("numpy")
    pytest.importorskip("PIL")
    import phase0_garment as pg

    assert pg.record_clip_ids(str(tmp_path)) is None
    (tmp_path / "stage2").mkdir()
    (tmp_path / "stage2" / "record.json").write_text(json.dumps({"clips": [{"id": "turntable_a"}, {"id": "turntable_b"}]}))
    assert pg.record_clip_ids(str(tmp_path)) == ["turntable_a", "turntable_b"]
