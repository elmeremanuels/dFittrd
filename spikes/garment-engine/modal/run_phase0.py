"""Phase 0 for one product on Modal: stage 2 (video) then stage 4 (reconstruction), with a cost summary.

  modal run spikes/garment-engine/modal/run_phase0.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2

Steps:
  1. check the job manifest (input_hash, pinned versions, front + back photos) and upload the job once
  2. download the pinned Wan2.2-Fun-A14B-Control weights into the weights Volume (once)
  3. stage 2: generate turntable_a, turntable_b and motion; assemble the 160 turntable frames
  4. stage 4 on the generated frames (source stage2) and, unless --no-synthetic-recon, on the exporter's
     synthetic frames (source synthetic: same camera path, known garment, so the error is measured)
  5. download stage2/ and stage4/ into the job dir and write cost_summary.json; print the cost table

Options: --steps 40 --iterations 10000 --triangles 12000 --skip-video (reuse stage2/ already in the Volume)
         --no-synthetic-recon --control-encoding linear|inverse --no-pin-frames --force-upload
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
import stage2_video  # noqa: E402
import stage4_recon  # noqa: E402

app = modal.App("curtain-phase0")
app.include(stage2_video.app)
app.include(stage4_recon.app)


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
    summary: dict = {"job_id": job_id, "input_hash": m["input_hash"], "synthetic_photos": synthetic_photos, "settings": cfg}

    if not skip_video:
        print("[phase0] weights:", stage2_video.download_weights.remote())
        t = time.time()
        rec = stage2_video.generate.remote(job_id, steps=steps, control_encoding=control_encoding, pin_frames=not no_pin_frames)
        costs.append(_with_wall(rec["cost"], cfg["gpu_video"], time.time() - t))
        summary["stage2"] = {k: rec[k] for k in ("clips", "turntable_frames_assembled", "seams", "load_seconds", "steps")}
        print(f"[phase0] stage 2: {len(rec['clips'])} clips, {rec['turntable_frames_assembled']} turntable frames, seams {rec['seams']}")

    sources = ["stage2"] + ([] if no_synthetic_recon or not m.get("synthetic") else ["synthetic"])
    calls = {}
    for source in sources:
        calls[source] = (time.time(), stage4_recon.reconstruct.spawn(job_id, source=source, iterations=iterations, triangles=triangles))
    for source, (t, call) in calls.items():
        try:
            met = call.get()
        except Exception as e:  # noqa: BLE001 - report and keep the other source's result
            print(f"[phase0] stage 4 ({source}) failed: {e}")
            summary[f"stage4_{source}"] = {"error": str(e)}
            continue
        costs.append(_with_wall(met["cost"], cfg["gpu_recon"], time.time() - t))
        summary[f"stage4_{source}"] = {k: met[k] for k in ("mask_mode", "psnr_masked", "mask_iou", "mesh", "vs_truth", "seconds")}
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
