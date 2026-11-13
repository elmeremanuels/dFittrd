"""Phase 0 for one product on Modal: stage 2 (video) then stage 4 (reconstruction), with a cost summary.

  modal run spikes/garment-engine/modal/run_phase0.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2

Steps:
  0. optional, --dress: stage 1b dresses our PROXY-DRESSED mannequin (export 0.4.0+) from the shop photos of a
     job exported with --on-model/--flat-lay (stage1_dress.py; --dress-engine fashn|qwen|both, `both` runs each
     view through both engines and pins the still that passes QA v2 with the best score) and writes the
     front/back stills stage 2 pins. Stage 2 does
     not start when a still failed QA (unless --accept-failed-dress; a garment-type failure, stage1b-qa-0.6.1
     `type_failures`, is never overridden) or when the back was invented and
     --allow-invented-back is missing. A job whose stills come from stage 1b cannot run stage 2 before them.
  1. check the job manifest (input_hash, pinned versions, front + back photos) and upload the job once
  2. download the pinned Wan2.2-Fun-A14B-Control weights into the weights Volume (once)
  3. stage 2: generate turntable_a and turntable_b (the motion clip only with --motion; stage 4 and 4t do not use it), each in
     its own GPU container in parallel (stage2_video.run_stage2; a failed turntable clip stops the run before stage 4;
     a failed --motion clip is reported and stage 4 still runs), with the manifest's neutral prompts (refused
     when lib.prompt_problems finds the title, the brand or a missing negative term) and the control
     the exporter rendered (`control.mode`: proxy garment by default); assemble the 160 turntable frames;
     score every generated frame against the control silhouette (stage2_video.score_consistency, CPU)
  4. stage 4 on the generated frames (source stage2) and, unless --no-synthetic-recon, on the exporter's
     synthetic frames (source synthetic: same camera path, known garment, so the error is measured)
  5. download stage2/ and stage4/ into the job dir and write cost_summary.json; print the cost table

Options: --steps 40 --motion (also the motion clip, a third container) --iterations 10000 --triangles 12000 --skip-video (reuse stage2/ already in the Volume)
         --no-synthetic-recon --control-encoding linear|inverse --no-pin-frames --force-upload
         --dress --dress-engine fashn|qwen|both --dress-steps N --accept-failed-dress --allow-invented-back --dress-only
         --stage2-masks garment|foreground (stage 4's alpha targets on the generated frames; recorded)
         --reuse-dress (stage 1b's stills as the jobs Volume holds them; no engine) | --recompose-dress [--dress-pin front=qwen,back=qwen]
         (re-make them on CPU from the saved raw outputs with the current composite and QA, stage1b-qa-0.10.x; the gate then
         reads that record). Neither redraws a still, so stage 2 pins what was reviewed.
         --dress-expect front=<hex>,back=<hex> (with either: the pixel sha256 of each reviewed still, `phase0_lib.pixel_sha256`
         of the decoded RGB, at least 12 hex characters; a recomposed still that differs stops before stage 2)
         --dress-draws "front=fashn@44-47,qwen@43;back=keep:fashn,qwen@43" (with --dress / --dress-only, stage1b-qa-0.11.0: a
         draw plan, `phase0_lib.parse_draw_plan`; several seeds per view in one container, a view kept from the earlier run,
         the front/back pair picked by the pair checks; replaces --dress-engine; checked before the upload)
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
    if m.get("stage1b"):
        try:
            lib.stage1b_plan(m)
        except lib.ManifestError as e:
            reasons.append(f"stage 1b: {e}")
    pending = lib.stills_pending(m, lambda rel: os.path.exists(os.path.join(job_dir, rel)))
    if pending:
        reasons.append(f"stage 1b stills missing for {', '.join(pending)}: run with --dress (or stage1_dress.py) first")
    if dress_record is None and m.get("stage1b"):
        # Stage 1b ran before this call (stage1_dress.py on its own): its record still decides the type checks.
        rec_path = os.path.join(job_dir, lib.STAGE1B_DIR, "record.json")
        if os.path.exists(rec_path):
            with open(rec_path) as f:
                dress_record = json.load(f)
    if dress_record is not None and not dress_record["summary"]["usable_for_stage2"] and not accept_failed:
        reasons.append(f"stage 1b QA failed for {', '.join(dress_record['summary']['failed_views'])} (see stage1b/record.json); --accept-failed-dress overrides")
    # A different garment (trousers drawn as a skirt, a bodice on a skirt or trousers, an open front closed) is never
    # overridden: --accept-failed-dress only accepts the provisional silhouette and fidelity checks. Stage 2 is about
    # 90% of a product's GPU cost (run 14: about $1.47 of $1.6).
    type_failed = (dress_record or {}).get("summary", {}).get("type_failed_views") or []
    if type_failed:
        detail = "; ".join(f"{view}: {', '.join(f.split(':')[0] for f in fs)}" for view, fs in (dress_record["summary"].get("type_failures") or {}).items())
        reasons.append(f"stage 1b drew a different garment in {', '.join(type_failed)} ({detail}); --accept-failed-dress does not override this")
    if lib.invented_roles(m) and not allow_invented:
        reasons.append("the back still is INVENTED (no back photo, D13); pass --allow-invented-back for a validation run")
    return reasons


def _reuse_mode(*, dress: bool, dress_only: bool, reuse_dress: bool, recompose_dress: bool, dress_pin: str) -> str | None:
    """None (stage 1b runs or is not used), "reuse" or "recompose". Refuses contradictory options before any spend."""
    if reuse_dress and recompose_dress:
        raise SystemExit("[phase0] --reuse-dress and --recompose-dress: pick one")
    mode = "recompose" if recompose_dress else "reuse" if reuse_dress else None
    if mode and (dress or dress_only):
        raise SystemExit(f"[phase0] --{mode}-dress uses the stage 1b outputs already in the Volume: it cannot run with --dress / --dress-only (a new draw)")
    lib.parse_dress_pins(dress_pin)  # a malformed pin fails here, before any spend
    if dress_pin and mode != "recompose":
        raise SystemExit("[phase0] --dress-pin needs --recompose-dress (it picks the engine per view among the saved candidates)")
    return mode


def _draw_plan(m: dict, *, dress: bool, dress_only: bool, reuse: str | None, dress_engine: str, text: str) -> dict | None:
    """--dress-draws (a draw plan, stage1b-qa-0.11.0), refused before the upload when it cannot run: a malformed plan, without
    --dress / --dress-only, with --reuse-dress / --recompose-dress (no new draw), with --dress-engine (the plan names the engines),
    or for a job without a back photo."""
    try:
        plan = lib.parse_draw_plan(text)
    except ValueError as e:
        raise SystemExit(f"[phase0] {e}") from None
    if plan is None:
        return None
    if reuse:
        raise SystemExit(f"[phase0] --dress-draws is a new draw: it cannot run with --{reuse}-dress")
    if not (dress or dress_only):
        raise SystemExit("[phase0] --dress-draws needs --dress or --dress-only")
    try:
        stage1_dress.check_plan(m, plan, engine=dress_engine, seed=None)
    except ValueError as e:
        raise SystemExit(f"[phase0] {str(e).replace('--engine', '--dress-engine').replace('--draws', '--dress-draws')}") from None
    return plan


def _dress_expect(reuse: str | None, text: str) -> dict[str, str]:
    """--dress-expect (pixel hashes of the reviewed stills), refused without --reuse-dress / --recompose-dress."""
    try:
        expect = lib.parse_dress_expect(text)
    except ValueError as e:
        raise SystemExit(f"[phase0] {e}") from None
    if expect and not reuse:
        raise SystemExit("[phase0] --dress-expect needs --recompose-dress or --reuse-dress (it checks the reused stills)")
    return expect


def _reused_record_problem(m: dict, record: dict) -> str | None:
    """Why a stage 1b record from the Volume must not feed this job's stage 2 (None = fine)."""
    if record.get("input_hash") != m.get("input_hash"):
        return f"the stage 1b record in the Volume is for input_hash {record.get('input_hash')!r}, this export has {m.get('input_hash')!r}"
    if record.get("job_id") not in (None, m.get("job_id")):
        return f"the stage 1b record is for job {record.get('job_id')!r}, not {m.get('job_id')!r}"
    if "summary" not in record or "views" not in record:
        return "the stage 1b record has no summary or views"
    return None


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
    dress_engine: str = "",
    dress_steps: int = 0,
    accept_failed_dress: bool = False,
    allow_invented_back: bool = False,
    dress_only: bool = False,
    stage2_masks: str = "garment",
    reuse_dress: bool = False,
    recompose_dress: bool = False,
    dress_pin: str = "",
    dress_expect: str = "",
    dress_draws: str = "",
    motion: bool = False,
):
    cfg = stage2_video.CFG
    m = pm.load_local_job(job_dir)
    job_id = m["job_id"]
    synthetic_photos = any(p.get("synthetic") for p in m["photos"])
    print(f"[phase0] job {job_id} ({m['product_name']}, base size {m['base_size']}), GPU video {cfg['gpu_video']}, recon {cfg['gpu_recon']}, region {cfg['region'] or 'any'}")
    if synthetic_photos:
        print("[phase0] the front/back stills are SYNTHETIC renders (dry run), not merchant photos")
    t_all = time.time()
    # the reuse options are checked before the upload (review of 0.10.0): a contradictory set stops before anything is sent
    reuse = _reuse_mode(dress=dress, dress_only=dress_only, reuse_dress=reuse_dress, recompose_dress=recompose_dress, dress_pin=dress_pin)
    expect = _dress_expect(reuse, dress_expect)
    plan = _draw_plan(m, dress=dress, dress_only=dress_only, reuse=reuse, dress_engine=dress_engine, text=dress_draws)
    dress_engine = lib.draw_plan_engines(plan) if plan is not None else (dress_engine or "fashn")
    pm.upload_job(job_dir, job_id, force=force_upload)
    costs: list[dict] = []
    summary: dict = _base_summary(m, cfg)

    dress_record = None
    if reuse:
        # stage1b-qa-0.10.0 (run 16b): no engine runs. The jobs Volume keeps /<job_id>/stage1b/ from the earlier stage 1b run
        # (the job id holds the input hash, so a re-export of the same inputs lands on the same directory); --recompose-dress
        # re-makes its stills with the current composite and QA on CPU, --reuse-dress takes them as they are.
        t = time.time()
        if reuse == "recompose":
            dress_record = stage1_dress.recompose.remote(job_id, pins=lib.parse_dress_pins(dress_pin) or None, accept_failed=accept_failed_dress)
        n = pm.download_dir(job_dir, job_id, lib.STAGE1B_DIR)
        rec_path = os.path.join(job_dir, lib.STAGE1B_DIR, "record.json")
        if n == 0 or not os.path.exists(rec_path):
            raise SystemExit(f"[phase0] no stage 1b outputs for {job_id} in the jobs Volume: run stage 1b (--dress) first")
        with open(rec_path) as f:
            dress_record = json.load(f)
        problem = _reused_record_problem(m, dress_record)
        if problem:
            raise SystemExit(f"[phase0] {problem}")
        # The stills' decoded pixels (`still_pixel_sha256`, hashed by the recompose in the Modal image, numpy / Pillow as pinned
        # there) against the ones reviewed (--dress-expect): a still that differs stops before stage 2. The local client has
        # only `modal` installed, so the hash is read from the record, not recomputed here.
        got = {v["view"]: (v.get("still_pixel_sha256") if v.get("still") else None) for v in dress_record["views"]}
        for view, hx in got.items():
            print(f"[phase0] stage 1b {view} still pixel sha256: {hx}")
        bad = lib.dress_expect_problems(expect, got)
        if bad:
            raise SystemExit("[phase0] not starting stage 2: " + "; ".join(bad))
        summary["stage1b"] = {"reused": reuse, "still_pixel_sha256": got, "expected_pixel_sha256": expect or None, "qa_version": dress_record.get("qa_version"), "recomposed": dress_record.get("recomposed"),
                              "summary": dress_record["summary"], "seconds": round(time.time() - t, 1),
                              "views": [{k: v.get(k) for k in ("view", "engine", "selection", "qa", "still", "still_sha256")} for v in dress_record["views"]]}
        print(f"[phase0] stage 1b {reuse}d from the Volume (QA {dress_record.get('qa_version')}): usable for stage 2 {dress_record['summary']['usable_for_stage2']}, "
              f"engines {[(v['view'], v.get('engine')) for v in dress_record['views']]}")
        for w in dress_record["summary"].get("warnings", []):
            print(f"[phase0] stage 1b WARNING: {w}")
    elif dress or dress_only:
        lib.dress_engines(dress_engine)  # an unknown engine fails here, before any GPU time
        dcfg = stage1_dress.CFG
        t = time.time()
        dress_record = stage1_dress.run_local(job_dir, engine=dress_engine, steps=dress_steps, seed=None, composite=True, accept_failed=accept_failed_dress, category="",
                                              force_upload=force_upload, plan=plan)
        costs.append(lib.cost_record("stage1b_dress", gpu=dcfg["gpu_dress"], region=dcfg["region"], gpu_seconds=dress_record["cost"]["gpu_seconds"], wall_seconds=time.time() - t))
        summary["stage1b"] = {
            "engine": dress_engine,
            "plan": plan,
            "pairs": {k: (dress_record.get("pairs") or {}).get(k) for k in ("reason", "front", "back", "eligible")} if plan is not None else None,
            "qa_version": dress_record.get("qa_version"),
            "target": dress_record.get("target"),
            "summary": dress_record["summary"],
            "views": [
                {
                    **{k: v.get(k) for k in ("view", "invented", "engine", "candidate", "selection", "method", "mask_source", "qa", "back_view", "still", "still_pixel_sha256")},
                    "candidates": [{k: c.get(k) for k in ("id", "engine", "qa", "back_view", "error", "seconds")} for c in v.get("candidates", [])],
                }
                for v in dress_record["views"]
            ],
        }
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
        rec = stage2_video.run_stage2(m, steps=steps, motion=motion, control_encoding=control_encoding, pin_frames=not no_pin_frames)
        costs.extend(rec["costs"])  # one record per GPU container (each pays its own model load)
        summary["stage2"] = {k: rec.get(k) for k in ("clips", "turntable_frames_assembled", "seams", "load_seconds", "steps", "control_mode", "motion", "complete", "failed_clips", "parallel", "gpu_mismatch")}
        print(f"[phase0] stage 2: {len(rec['clips'])} clips, {rec['turntable_frames_assembled']} turntable frames, seams {rec['seams']}")
        if not rec.get("complete", False):
            print(stage2_video.stage2_failure_line(rec).replace("[stage2]", "[phase0] stage 2"))
        if not stage2_video.stage2_turntable_usable(rec):
            # A failed turntable clip (or assemble) never gives a half job: no stage 4 on stale or missing frames. What
            # finished stays in the Volume. The returned record replaces whatever stage2/record.json the Volume held.
            pm.download_dir(job_dir, job_id, "stage2")
            stage2_video.sync_local_record(job_dir, rec)
            summary["costs"] = costs
            summary["cost_total"] = lib.summarize_costs(costs)
            summary["stopped_after_stage2"] = rec.get("failed_clips") or ["stage 2: no turntable assembled"]
            summary["wall_seconds"] = round(time.time() - t_all, 1)
            with open(os.path.join(job_dir, "cost_summary.json"), "w") as f:
                json.dump(summary, f, indent=2)
            print(lib.format_cost_table(costs))
            raise SystemExit(1)
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
