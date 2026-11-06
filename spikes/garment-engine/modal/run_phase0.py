"""Phase 0 for one product on Modal: stage 2 (video) then stage 4 (reconstruction), with a cost summary.

  modal run spikes/garment-engine/modal/run_phase0.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2

Steps:
  0. optional, --dress: stage 1b dresses our mannequin from the shop photos of a job exported with
     --on-model/--flat-lay (stage1_dress.py) and writes the front/back stills stage 2 pins. Stage 2 does
     not start when a still failed QA (unless --accept-failed-dress) or when the back was invented and
     --allow-invented-back is missing. A job whose stills come from stage 1b cannot run stage 2 before them.
  1. check the job manifest (input_hash, pinned versions, front + back photos) and upload the job once
  2. download the pinned Wan2.2-Fun-A14B-Control weights into the weights Volume (once)
  3. stage 2: generate turntable_a, turntable_b and motion with the manifest's neutral prompts (refused
     when lib.prompt_problems finds the title, the brand or a missing negative term) and the control
     the exporter rendered (`control.mode`: proxy garment by default); assemble the 160 turntable frames;
     score every generated frame against the control silhouette (stage2_video.score_consistency, CPU)
  4. stage 4 on the generated frames (source stage2) and, unless --no-synthetic-recon, on the exporter's
     synthetic frames (source synthetic: same camera path, known garment, so the error is measured)
  5. download stage2/ and stage4/ into the job dir and write cost_summary.json; print the cost table

Options: --steps 40 --iterations 10000 --triangles 12000 --skip-video (reuse stage2/ already in the Volume)
         --no-synthetic-recon --control-encoding linear|inverse --no-pin-frames --force-upload
         --dress --dress-engine fashn|qwen --dress-steps N --accept-failed-dress --allow-invented-back --dress-only
         --stage2-masks garment|foreground (stage 4's alpha targets on the generated frames; recorded)
Every number this prints about cost is an ESTIMATE (list price x GPU seconds); the Modal invoice is
the measurement. NOT TESTED on a GPU: the build container cannot reach Modal.
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import modal  # noqa: E402

import phase0_lib as lib  # noqa: E402
import phase0_modal as pm  # noqa: E402
import stage1_dress  # noqa: E402
import stage2_video  # noqa: E402
import stage4_recon  # noqa: E402

app = modal.App("curtain-phase0")
app.include(stage1_dress.app)
app.include(stage2_video.app)
app.include(stage4_recon.app)


def _dress_gate(m: dict, job_dir: str, dress_record: dict | None, *, accept_failed: bool, allow_invented: bool) -> list[str]:
    """Reasons not to start stage 2 on this job's pinned stills and prompts (empty = go)."""
    reasons = [f"prompt: {p}" for p in lib.prompt_problems(m)]
    pending = lib.stills_pending(m, lambda rel: os.path.exists(os.path.join(job_dir, rel)))
    if pending:
        reasons.append(f"stage 1b stills missing for {', '.join(pending)}: run with --dress (or stage1_dress.py) first")
    if dress_record is not None and not dress_record["summary"]["usable_for_stage2"] and not accept_failed:
        reasons.append(f"stage 1b QA failed for {', '.join(dress_record['summary']['failed_views'])} (see stage1b/record.json); --accept-failed-dress overrides")
    if lib.invented_roles(m) and not allow_invented:
        reasons.append("the back still is INVENTED (no back photo, D13); pass --allow-invented-back for a validation run")
    return reasons


def _base_summary(m: dict, cfg: dict) -> dict:
    """The head of cost_summary.json. The invented-back flag comes from the manifest, so it is there
    whether stage 1b ran in this call (--dress) or before it (stage1_dress.py on its own)."""
    prov = lib.photo_provenance(m)
    summary = {
        "job_id": m["job_id"],
        "input_hash": m["input_hash"],
        "synthetic_photos": any(p.get("synthetic") for p in m["photos"]),
        "invented_back": prov["invented_back"],
        "invented_roles": prov["invented_roles"],
        "stills": prov["photos"],
        "control_mode": lib.control_mode(m),
        "control_proxy": (m["control"].get("proxy") or {}).get("kind"),
        "prompt": (m.get("prompt") or {}).get("description"),
        "settings": cfg,
    }
    if prov["invented_roles"]:
        summary["label"] = prov["label"]
    return summary


def _with_wall(cost: dict, gpu: str, wall: float) -> dict:
    return lib.cost_record(cost["stage"], gpu=gpu, region=stage2_video.CFG["region"], gpu_seconds=cost["gpu_seconds"], wall_seconds=wall)


@app.local_entrypoint()
def main(
    job_dir: str,
    steps: int = 40,
    iterations: int = 10000,
    triangles: int = 12000,
    skip_video: bool = False,
    no_synthetic_recon: bool = False,
    control_encoding: str = "linear",
    no_pin_frames: bool = False,
    force_upload: bool = False,
    dress: bool = False,
    dress_engine: str = "fashn",
    dress_steps: int = 0,
    accept_failed_dress: bool = False,
    allow_invented_back: bool = False,
    dress_only: bool = False,
    stage2_masks: str = "garment",
):
    cfg = stage2_video.CFG
    m = pm.load_local_job(job_dir)
    job_id = m["job_id"]
    synthetic_photos = any(p.get("synthetic") for p in m["photos"])
    print(f"[phase0] job {job_id} ({m['product_name']}, base size {m['base_size']}), GPU video {cfg['gpu_video']}, recon {cfg['gpu_recon']}, region {cfg['region'] or 'any'}")
    if synthetic_photos:
        print("[phase0] the front/back stills are SYNTHETIC renders (dry run), not merchant photos")
    t_all = time.time()
    pm.upload_job(job_dir, job_id, force=force_upload)
    costs: list[dict] = []
    summary: dict = _base_summary(m, cfg)

    dress_record = None
    if dress or dress_only:
        dcfg = stage1_dress.CFG
        t = time.time()
        dress_record = stage1_dress.run_local(job_dir, engine=dress_engine, steps=dress_steps, seed=None, composite=True, accept_failed=accept_failed_dress, category="", force_upload=force_upload)
        costs.append(lib.cost_record("stage1b_dress", gpu=dcfg["gpu_dress"], region=dcfg["region"], gpu_seconds=dress_record["cost"]["gpu_seconds"], wall_seconds=time.time() - t))
        summary["stage1b"] = {"engine": dress_engine, "summary": dress_record["summary"], "views": [{k: v.get(k) for k in ("view", "invented", "method", "mask_source", "qa", "still")} for v in dress_record["views"]]}
    if lib.invented_roles(m):
        print("[phase0] WARNING: " + lib.INVENTED_BACK_LABEL)
    stop = [] if (skip_video or dress_only) else _dress_gate(m, job_dir, dress_record, accept_failed=accept_failed_dress, allow_invented=allow_invented_back)
    if stop or dress_only:
        for r in stop:
            print(f"[phase0] not starting stage 2: {r}")
        summary["costs"] = costs
        summary["cost_total"] = lib.summarize_costs(costs)
        summary["stopped_before_stage2"] = stop or ["--dress-only"]
        summary["wall_seconds"] = round(time.time() - t_all, 1)
        with open(os.path.join(job_dir, "cost_summary.json"), "w") as f:
            json.dump(summary, f, indent=2)
        if costs:
            print(lib.format_cost_table(costs))
        if stop:
            raise SystemExit(1)
        return

    if not skip_video:
        print("[phase0] weights:", stage2_video.download_weights.remote())
        t = time.time()
        rec = stage2_video.generate.remote(job_id, steps=steps, control_encoding=control_encoding, pin_frames=not no_pin_frames)
        costs.append(_with_wall(rec["cost"], cfg["gpu_video"], time.time() - t))
        summary["stage2"] = {k: rec[k] for k in ("clips", "turntable_frames_assembled", "seams", "load_seconds", "steps", "control_mode")}
        print(f"[phase0] stage 2: {len(rec['clips'])} clips, {rec['turntable_frames_assembled']} turntable frames, seams {rec['seams']}")
        try:
            cons = stage2_video.score_consistency.remote(job_id)
            summary["stage2"]["consistency"] = {k: v for k, v in cons.items() if k != "frames_detail"}
            print(stage2_video.consistency_line(cons).replace("[stage2]", "[phase0] stage 2"))
        except Exception as e:  # noqa: BLE001 - the metric must not cost the stage 4 run
            print(f"[phase0] stage 2 consistency scoring failed: {e}")
            summary["stage2"]["consistency"] = {"error": str(e)}

    summary["stage4_masks"] = stage2_masks  # stage 4's alpha targets on the generated frames, whatever stage 2 did
    sources = ["stage2"] + ([] if no_synthetic_recon or not m.get("synthetic") else ["synthetic"])
    calls = {}
    for source in sources:
        calls[source] = (time.time(), stage4_recon.reconstruct.spawn(job_id, source=source, iterations=iterations, triangles=triangles, stage2_masks=stage2_masks))
    for source, (t, call) in calls.items():
        try:
            met = call.get()
        except Exception as e:  # noqa: BLE001 - report and keep the other source's result
            print(f"[phase0] stage 4 ({source}) failed: {e}")
            summary[f"stage4_{source}"] = {"error": str(e)}
            continue
        costs.append(_with_wall(met["cost"], cfg["gpu_recon"], time.time() - t))
        summary[f"stage4_{source}"] = {k: met.get(k) for k in ("mask_mode", "alpha_targets", "psnr_masked", "mask_iou", "mesh", "vs_truth", "seconds")}
        print(f"[phase0] stage 4 ({source}): {met['mesh']['triangles']} triangles, mask IoU {met['mask_iou']}, vs truth {met['vs_truth']}")

    pm.download_dir(job_dir, job_id, "stage2")
    for source in sources:
        pm.download_dir(job_dir, job_id, f"stage4/{source}")
    summary["costs"] = costs
    summary["cost_total"] = lib.summarize_costs(costs)
    summary["wall_seconds"] = round(time.time() - t_all, 1)
    with open(os.path.join(job_dir, "cost_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print()
    print(lib.format_cost_table(costs))
    print(f"[phase0] wrote {os.path.join(job_dir, 'cost_summary.json')}; outputs in {job_dir}/stage2 and {job_dir}/stage4")
