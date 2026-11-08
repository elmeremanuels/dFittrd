"""Phase 0 stage 2 on Modal: image -> video with Wan2.2-Fun-A14B-Control (research doc, shortlist A).

For one exported job it generates the two 81-frame turntable clips at 16 fps (and, with --motion, the motion clip),
each driven by the depth video the exporter rendered (control/depth_vis or motion/depth_vis), so the camera pose of every generated frame
is the pose we rendered. Since phase0-export-0.2.0 that depth shows our mannequin WEARING a coarse proxy
garment from the category and chart (manifest `control.mode` = proxy, the default; `bare` = the bare
mannequin, which turned a dress into trousers in the first GPU run):

  turntable_a  front -> back  (start frame = front still, end frame = back still)
  turntable_b  back -> front  (start frame = back still,  end frame = front still)
  motion       OPT-IN (--motion; stage 4 and stage 4t use only the turntable): the stored motion clip from the fixed motion camera (no pinned frame since export 0.3.0: the
               front still is drawn at the turntable camera, 320 cm, the motion camera stands at 520 cm, and
               run 11a's motion clip jumped in scale after its pinned first frame; older manifests still pin it)

Since stage2-parallel-0.1.0 every clip runs in its own GPU container (`generate_clip`, spawned together, each loading
the model), so the wall clock is about one clip plus one load instead of the sum; `assemble` (CPU) then builds the
turntable and writes the record. The seed of a clip is the video seed plus its index in the manifest (turntable_a 43,
turntable_b 44, motion 45), as in the one-container runs up to run 17d. A clip that fails is reported (record
`complete: false`, `failed_clips`) and no turntable is assembled; the clip that finished stays in the jobs Volume.

The front still is also the reference image of every clip. The prompts come from the manifest
(`prompt`: a neutral description from category, colour, length, sleeves and fabric, never the product
title or brand; the negative prompt bans text, letters, logos and the wrong garment); the app refuses a
manifest whose prompts fail `lib.prompt_problems`. The 160 turntable poses are then filled from the two
half turns (stage2/frames/NNNN.png, matching transforms.json); the frames both clips render (the back
and the front) are compared as a drift check. Then `score_consistency` (CPU, no GPU) segments the garment
in every generated frame (phase0_garment: against our own bare mannequin and a background model), compares
it with the pinned stills carried to that camera, writes the per-frame numbers and the flagged frames into
stage2/record.json (`consistency`; the first proxy-silhouette metric as `consistency_v1`) and the turntable's
garment masks into stage2/garment_mask/ (stage 4's alpha targets).

Run (from the repo root, after `pnpm --filter @curtain/garment-spike export:phase0`):
  modal run spikes/garment-engine/modal/stage2_video.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2
Options: --steps 40  --motion (add the motion clip)  --clips turntable_a,turntable_b,motion  --control-encoding linear|inverse
         --no-pin-frames (reference image + control only)  --download-only
         --consistency-only (re-score stage2/ already in the Volume)  --consistency-stride 2

Environment: CURTAIN_MODAL_GPU_VIDEO (default H100), CURTAIN_MODAL_REGION (e.g. eu, 1.15x),
CURTAIN_MODAL_TIMEOUT_CLIP (s per clip container, default 2400; 'H100!' in CURTAIN_MODAL_GPU_VIDEO pins the type), CURTAIN_MODAL_MEMORY_VIDEO_MB (default 131072),
CURTAIN_WAN_MEMORY_MODE (default model_cpu_offload). Every record this writes is an ESTIMATE.

The one-container version ran on GPUs through GitHub Actions (runs 10 to 17d). NOT TESTED on a GPU: the parallel
runner (stage2-parallel-0.1.0, generate_clip / assemble / run_stage2); its wiring is tested with mocked calls
(tests/test_stage2_parallel.py). The VideoX-Fun calls follow examples/wan2.2_fun/predict_v2v_control.py at the pinned commit.
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

CFG = lib.settings()
VIDEO = lib.PINNED_MODELS["video"]
MODEL_DIR = f"{pm.WEIGHTS_DIR}/hf/{VIDEO['id']}@{VIDEO['revision']}"
VXF_DIR = "/opt/VideoX-Fun"
WAN_CONFIG = f"{VXF_DIR}/config/wan2.2/wan_civitai_i2v.yaml"

# Every Python package is pinned: requirements-stage2.in holds the direct pins (versions of the
# VideoX-Fun commit's era, Sept 2025), requirements-stage2.txt the full lock compiled from it with
#   uv pip compile requirements-stage2.in --python-version 3.11 --python-platform x86_64-manylinux_2_31 --no-header --no-annotate -o requirements-stage2.txt
REQUIREMENTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements-stage2.txt")

# The prompts are in the manifest (`prompt`, written by the exporter from fixed vocabulary). The first GPU
# run used a prompt with the product title in quotes, and the title appeared as text in a frame.

app = modal.App("curtain-phase0-stage2-video")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install_from_requirements(REQUIREMENTS)
    .run_commands(
        f"git clone https://github.com/aigc-apps/VideoX-Fun {VXF_DIR}",
        f"cd {VXF_DIR} && git checkout {VIDEO['code_revision']}",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "PYTHONPATH": VXF_DIR})
    .add_local_python_source("phase0_lib", "phase0_modal", "phase0_garment")
)


@app.function(image=image, volumes={pm.WEIGHTS_DIR: pm.weights}, timeout=CFG["timeout_download"], region=CFG["region"])
def download_weights() -> dict:
    """Downloads the pinned Wan2.2-Fun-A14B-Control snapshot into the weights Volume once."""
    from huggingface_hub import snapshot_download

    marker = os.path.join(MODEL_DIR, ".complete.json")
    if os.path.exists(marker):
        with open(marker) as f:
            return {"cached": True, **json.load(f)}
    t0 = time.time()
    snapshot_download(repo_id=VIDEO["id"], revision=VIDEO["revision"], local_dir=MODEL_DIR)
    size = sum(os.path.getsize(os.path.join(r, n)) for r, _, fs in os.walk(MODEL_DIR) for n in fs)
    info = {"repo": VIDEO["id"], "revision": VIDEO["revision"], "bytes": size, "download_s": round(time.time() - t0, 1)}
    with open(marker, "w") as f:
        json.dump(info, f)
    pm.weights.commit()
    return {"cached": False, **info}


def _control_video(job: str, m: dict, clip: dict, encoding: str, out_path: str) -> None:
    """Writes the clip's control frames as an mp4 at the clip's fps (x264 crf 0; grey frames, so chroma subsampling loses nothing)."""
    import imageio.v2 as imageio
    import numpy as np

    frames = []
    for i in clip["frame_indices"]:
        if encoding == "linear":
            img = imageio.imread(os.path.join(job, clip["control_dir"], f"{i:04d}.png"))
        else:
            near, far = (m["control"]["near_cm"], m["control"]["far_cm"]) if clip["kind"] == "turntable" else (m["motion"]["near_cm"], m["motion"]["far_cm"])
            mm = imageio.imread(os.path.join(job, clip["depth_mm_dir"], f"{i:04d}.png")).astype(np.float64)
            d = np.maximum(mm / 10.0, 1e-6)
            v = 1 + 254 * (1 / d - 1 / far) / (1 / near - 1 / far)  # same formula as lib.control_value
            img = np.where(mm > 0, np.clip(np.floor(v + 0.5), 1, 255), 0).astype(np.uint8)
        frames.append(np.repeat(img[..., None], 3, axis=2))
    imageio.mimsave(out_path, frames, fps=clip["fps"], codec="libx264", quality=None, ffmpeg_params=["-crf", "0"])


def _load_pipeline():
    """The Wan2.2-Fun control pipeline, as in VideoX-Fun examples/wan2.2_fun/predict_v2v_control.py at the pinned
    commit. Runs in every clip container (one load per container: ~13-16 s from the weights Volume in run 17d)."""
    import torch
    from diffusers import FlowMatchEulerDiscreteScheduler
    from omegaconf import OmegaConf
    from videox_fun.dist import set_multi_gpus_devices
    from videox_fun.models import AutoencoderKLWan, AutoTokenizer, Wan2_2Transformer3DModel, WanT5EncoderModel
    from videox_fun.pipeline import Wan2_2FunControlPipeline
    from videox_fun.utils.fp8_optimization import convert_model_weight_to_float8, convert_weight_dtype_wrapper, replace_parameters_by_name
    from videox_fun.utils.utils import filter_kwargs

    dtype = torch.bfloat16
    device = set_multi_gpus_devices(1, 1)
    config = OmegaConf.load(WAN_CONFIG)
    tkw = config["transformer_additional_kwargs"]
    boundary = tkw.get("boundary", 0.875)
    load_t = lambda sub: Wan2_2Transformer3DModel.from_pretrained(  # noqa: E731
        os.path.join(MODEL_DIR, tkw.get(sub, "transformer")), transformer_additional_kwargs=OmegaConf.to_container(tkw), low_cpu_mem_usage=True, torch_dtype=dtype)
    transformer = load_t("transformer_low_noise_model_subpath")
    transformer_2 = load_t("transformer_high_noise_model_subpath") if tkw.get("transformer_combination_type", "single") == "moe" else None
    vae = AutoencoderKLWan.from_pretrained(os.path.join(MODEL_DIR, config["vae_kwargs"].get("vae_subpath", "vae")), additional_kwargs=OmegaConf.to_container(config["vae_kwargs"])).to(dtype)
    tokenizer = AutoTokenizer.from_pretrained(os.path.join(MODEL_DIR, config["text_encoder_kwargs"].get("tokenizer_subpath", "tokenizer")))
    text_encoder = WanT5EncoderModel.from_pretrained(
        os.path.join(MODEL_DIR, config["text_encoder_kwargs"].get("text_encoder_subpath", "text_encoder")),
        additional_kwargs=OmegaConf.to_container(config["text_encoder_kwargs"]), low_cpu_mem_usage=True, torch_dtype=dtype).eval()
    scheduler = FlowMatchEulerDiscreteScheduler(**filter_kwargs(FlowMatchEulerDiscreteScheduler, OmegaConf.to_container(config["scheduler_kwargs"])))
    pipeline = Wan2_2FunControlPipeline(transformer=transformer, transformer_2=transformer_2, vae=vae, tokenizer=tokenizer, text_encoder=text_encoder, scheduler=scheduler)
    mode = CFG["wan_memory_mode"]
    if mode == "sequential_cpu_offload":
        for t in (transformer, transformer_2):
            if t is not None:
                replace_parameters_by_name(t, ["modulation"], device=device)
                t.freqs = t.freqs.to(device=device)
        pipeline.enable_sequential_cpu_offload(device=device)
    elif mode == "model_cpu_offload_and_qfloat8":
        for t in (transformer, transformer_2):
            if t is not None:
                convert_model_weight_to_float8(t, exclude_module_name=["modulation"], device=device)
                convert_weight_dtype_wrapper(t, dtype)
        pipeline.enable_model_cpu_offload(device=device)
    elif mode == "model_cpu_offload":
        pipeline.enable_model_cpu_offload(device=device)
    else:
        pipeline.to(device=device)
    return pipeline, device, boundary, mode


@app.function(
    image=image,
    gpu=CFG["gpu_video"],
    volumes={pm.WEIGHTS_DIR: pm.weights, pm.JOBS_DIR: pm.jobs},
    timeout=CFG["timeout_clip"],
    memory=CFG["memory_video_mb"],
    region=CFG["region"],
)
def generate_clip(job_id: str, clip_id: str, seed: int, steps: int = 40, control_encoding: str = "linear", pin_frames: bool = True, guidance_scale: float = 6.0, shift: float = 5.0) -> dict:
    """One clip in its own GPU container (stage2-parallel-0.1.0): loads the model, generates the clip with the given
    seed, writes stage2/<clip>.mp4 and stage2/clips/<clip>/NNNN.png and commits the jobs Volume, so a clip that
    finished is kept when the other clip's container fails. The pinned stills (first_photo / last_photo) and the
    reference image are the same as in the one-container runs up to run 17d."""
    import subprocess

    import imageio.v2 as imageio
    import numpy as np
    import torch
    from videox_fun.utils.utils import get_image_latent, get_image_to_video_latent, get_video_to_video_latent, save_videos_grid

    t_start = time.time()
    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    problems = lib.prompt_problems(m)
    if problems:
        raise lib.ManifestError("stage 2 prompts refused: " + "; ".join(problems))
    prompts = lib.video_prompts(m)
    clip = next((c for c in m["clips"] if c["id"] == clip_id), None)
    if clip is None:
        raise lib.ManifestError(f"no clip {clip_id!r} in the manifest")
    if not os.path.exists(os.path.join(MODEL_DIR, ".complete.json")):
        raise RuntimeError("weights not in the Volume yet: run download_weights first (run_phase0.py and this app's entrypoint do)")
    out = f"{job}/stage2"
    os.makedirs(out, exist_ok=True)
    gpu_name = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()

    t0 = time.time()
    pipeline, device, boundary, mode = _load_pipeline()
    load_s = time.time() - t0

    width, height = m["camera"]["width"], m["camera"]["height"]
    sample_size = [height, width]
    photo = lambda role: os.path.join(job, lib.photo_path(m, role))  # noqa: E731
    t1 = time.time()
    n = len(clip["frame_indices"])
    control_mp4 = f"/tmp/control_{clip['id']}.mp4"
    _control_video(job, m, clip, control_encoding, control_mp4)
    start = photo(clip["first_photo"]) if pin_frames and clip.get("first_photo") else None
    end = photo(clip["last_photo"]) if pin_frames and clip.get("last_photo") else None
    generator = torch.Generator(device=device).manual_seed(int(seed))
    with torch.no_grad():
        inpaint_video, inpaint_mask, _clip_image = get_image_to_video_latent(start, end, video_length=n, sample_size=sample_size)
        ref = get_image_latent(photo("front"), sample_size=sample_size)
        control, _, _, _ = get_video_to_video_latent(control_mp4, video_length=n, sample_size=sample_size, fps=clip["fps"], ref_image=None)
        prompt = prompts["motion"] if clip["kind"] == "motion" else prompts["turntable"]
        sample = pipeline(
            prompt, num_frames=n, negative_prompt=prompts["negative"], height=height, width=width, generator=generator,
            guidance_scale=guidance_scale, num_inference_steps=steps, video=inpaint_video, mask_video=inpaint_mask,
            control_video=control, control_camera_video=None, ref_image=ref, boundary=boundary, shift=shift,
        ).videos
    save_videos_grid(sample, f"{out}/{clip['id']}.mp4", fps=clip["fps"])
    frames = (sample[0].permute(1, 2, 3, 0).float().clamp(0, 1).cpu().numpy() * 255).round().astype(np.uint8)  # [t, h, w, c]
    cdir = f"{out}/clips/{clip['id']}"
    os.makedirs(cdir, exist_ok=True)
    for j, fr in enumerate(frames):
        imageio.imwrite(f"{cdir}/{j:04d}.png", fr)
    seconds = time.time() - t1
    print(f"[stage2] {clip['id']}: {frames.shape[0]} frames in {seconds:.0f} s (model load {load_s:.0f} s, {gpu_name})")
    pm.jobs.commit()
    return {
        "id": clip["id"], "kind": clip["kind"], "frames": int(frames.shape[0]), "seed": int(seed),
        "start": clip.get("first_photo") if start else None, "end": clip.get("last_photo") if end else None,
        "seconds": round(seconds, 1), "load_seconds": round(load_s, 1), "gpu_name": gpu_name, "memory_mode": mode,
        "gpu_seconds": round(time.time() - t_start, 1),
    }


@app.function(image=image, volumes={pm.JOBS_DIR: pm.jobs}, timeout=1800, region=CFG["region"])
def assemble(job_id: str, plan: list[dict], done: list[dict], failed: list[dict], settings: dict, costs: dict) -> dict:
    """CPU, after the clip containers: fills the 160 turntable poses from the two half turns (stage2/frames), compares
    the frames both render (the seam drift check) and writes stage2/record.json. A clip whose PNGs are not all in the
    Volume counts as failed. When a requested turntable clip failed, no frames are assembled and stale stage2/frames
    and stage2/garment_mask from an earlier run are removed, so nothing downstream reads frames this record does not
    describe; the record says `complete: false` and lists the failures. When only the opt-in motion clip failed, the
    turntable is still assembled (`complete: false`, frames > 0): stage 4 can run, the failure is reported."""
    import shutil

    import numpy as np
    from PIL import Image

    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    out = f"{job}/stage2"
    os.makedirs(out, exist_ok=True)
    ok, failed = [], list(failed)
    for c in done:
        n = int(c["frames"])
        have = sum(os.path.exists(f"{out}/clips/{c['id']}/{j:04d}.png") for j in range(n))
        if n > 0 and have == n:
            ok.append(c)
        else:
            failed.append({"id": c["id"], "error": f"{have}/{n} frames in the Volume"})
    outcome = lib.stage2_outcome(m, plan, ok, failed)

    assembled, seams_out, removed = 0, [], []
    if outcome["turntable"]:
        assignments, seams = lib.turntable_assembly(m)
        os.makedirs(f"{out}/frames", exist_ok=True)
        for idx, cid, j in assignments:
            Image.open(f"{out}/clips/{cid}/{j:04d}.png").save(f"{out}/frames/{idx:04d}.png")
            assembled += 1
        for idx, owners in seams:
            a, b = (np.asarray(Image.open(f"{out}/clips/{cid}/{j:04d}.png"), dtype=np.float64) for cid, j in owners[:2])
            seams_out.append({"frame": idx, "clips": [o[0] for o in owners], "mean_abs_diff_8bit": round(float(np.abs(a - b).mean()), 2)})
    elif outcome["turntable_requested"]:
        for sub in ("frames", "garment_mask"):
            if os.path.isdir(f"{out}/{sub}"):
                shutil.rmtree(f"{out}/{sub}")
                removed.append(f"stage2/{sub}")

    prompts = lib.video_prompts(m)
    mode_control = lib.control_mode(m)
    names = sorted({c.get("gpu_name") for c in ok if c.get("gpu_name")})
    mismatch = lib.stage2_gpu_mismatch(ok)
    if mismatch:
        print(f"[stage2] WARNING: the clip containers ran on different GPUs ({' / '.join(mismatch)}); pin with CURTAIN_MODAL_GPU_VIDEO='H100!' for comparison runs")
    record = {
        "stage": "stage2_video",
        "runner": lib.STAGE2_RUNNER,
        "job_id": job_id,
        "input_hash": m["input_hash"],
        "model": VIDEO,
        "gpu_name": "; ".join(names),
        "gpu_mismatch": mismatch,
        "memory_mode": next((c.get("memory_mode") for c in ok), CFG["wan_memory_mode"]),
        **settings,
        "control_mode": mode_control,
        "control_proxy": (m["control"].get("proxy") or {}).get("kind"),
        "prompt": {k: prompts.get(k) for k in ("version", "kind", "description", "turntable", "motion", "negative")},
        "motion": any(c["kind"] == "motion" for c in plan),
        "planned_clips": [c["id"] for c in plan],
        "complete": outcome["complete"],
        "failed_clips": outcome["failed"],
        "removed_stale": removed,
        # paid once per container: the sum over the containers (per clip in `clips`)
        "load_seconds": round(sum(float(c.get("load_seconds") or 0) for c in ok), 1),
        "clips": [{k: c.get(k) for k in ("id", "frames", "seed", "start", "end", "seconds", "load_seconds", "gpu_seconds", "gpu_name")} for c in ok],
        "turntable_frames_assembled": assembled,
        "seams": seams_out,
        "synthetic_photos": any(p.get("synthetic") for p in m["photos"]),
        "stills": lib.photo_provenance(m),
        "cost": costs["total"],
        "costs": costs["records"],
        "parallel": costs["parallel"],
        "label": "generated video: an estimate of the garment, not a measurement (AGENTS.md rule 3)",
    }
    with open(f"{out}/record.json", "w") as f:
        json.dump(record, f, indent=2)
    pm.jobs.commit()
    return record


def run_stage2(m: dict, *, steps: int = 40, clip_ids: list[str] | None = None, motion: bool = False, control_encoding: str = "linear", pin_frames: bool = True,
               guidance_scale: float = 6.0, shift: float = 5.0, clip_fn=None, assemble_fn=None) -> dict:
    """Stage 2 for one job, from the local entrypoint: one `generate_clip` container per clip, spawned together (the
    turntable pair by default, the motion clip only with `motion`), then gathered one by one. A clip that raises is
    recorded as failed and the others are still gathered (each container has committed its own clip); `assemble`
    then writes the record, which says `complete: false` when any clip failed. The caller stops before stage 4 when no
    turntable was assembled (`turntable_frames_assembled == 0`) and writes the returned record locally
    (`sync_local_record`), so a failed `assemble` never leaves an earlier run's record.json in the job dir.
    `clip_fn` / `assemble_fn` replace the Modal functions in tests."""
    clip_fn = clip_fn or generate_clip
    assemble_fn = assemble_fn or assemble
    job_id = m["job_id"]
    plan = lib.stage2_clip_plan(m, clip_ids, motion=motion)
    t_stage = time.time()
    calls = {}
    for c in plan:
        calls[c["id"]] = (time.time(), clip_fn.spawn(job_id, c["id"], c["seed"], steps=steps, control_encoding=control_encoding, pin_frames=pin_frames, guidance_scale=guidance_scale, shift=shift))
    results, walls, failed = {}, {}, []
    for cid, (t, call) in calls.items():
        try:
            results[cid] = call.get()
        except Exception as e:  # noqa: BLE001 - keep gathering: the other clip is committed in the Volume
            failed.append({"id": cid, "error": f"{type(e).__name__}: {e}"})
            print(f"[stage2] {cid} FAILED: {type(e).__name__}: {e}")
        walls[cid] = time.time() - t
    stage_wall = time.time() - t_stage
    costs = lib.stage2_costs(plan, results, walls, gpu=CFG["gpu_video"], region=CFG["region"], stage_wall_seconds=stage_wall)
    print(lib.stage2_parallel_line(costs["parallel"]))
    settings = {"steps": steps, "guidance_scale": guidance_scale, "shift": shift, "control_encoding": control_encoding, "pin_frames": pin_frames}
    done = [results[c["id"]] for c in plan if c["id"] in results]
    try:
        return assemble_fn.remote(job_id, plan, done, failed, settings, costs)
    except Exception as e:  # noqa: BLE001 - the GPU time is spent: report it, never a half job
        print(f"[stage2] assemble FAILED: {type(e).__name__}: {e}")
        return {"stage": "stage2_video", "runner": lib.STAGE2_RUNNER, "job_id": job_id, "input_hash": m.get("input_hash"), "complete": False, "planned_clips": [c["id"] for c in plan],
                "failed_clips": failed + [{"id": "assemble", "error": f"{type(e).__name__}: {e}"}], "clips": [{k: c.get(k) for k in ("id", "frames", "seed", "seconds", "load_seconds", "gpu_seconds")} for c in done],
                "turntable_frames_assembled": 0, "seams": [], "load_seconds": costs["parallel"]["load_seconds_total"], "steps": steps, "control_mode": lib.control_mode(m),
                "motion": any(c["kind"] == "motion" for c in plan), "cost": costs["total"], "costs": costs["records"], "parallel": costs["parallel"]}


def stage2_failure_line(rec: dict) -> str:
    """One log line for a stage 2 run that did not complete (empty when it did)."""
    if rec.get("complete", True):
        return ""
    got = [c["id"] for c in rec.get("clips", [])]
    fails = "; ".join(f"{f['id']}: {f['error']}" for f in rec.get("failed_clips", []))
    if stage2_turntable_usable(rec):
        return f"[stage2] INCOMPLETE: {fails}; generated {', '.join(got)}; turntable assembled ({rec['turntable_frames_assembled']} frames), stage 4 runs"
    return f"[stage2] INCOMPLETE: {fails}; generated {', '.join(got) or 'nothing'} (kept in the jobs Volume); no turntable assembled, stage 4 not started"


def stage2_turntable_usable(rec: dict) -> bool:
    """Stage 4 can run on this record: the 160 turntable frames were assembled (a failed motion clip does not block it)."""
    return int(rec.get("turntable_frames_assembled") or 0) > 0


def sync_local_record(job_dir: str, rec: dict) -> list[str]:
    """After download_dir on an incomplete stage 2: the returned record is the truth for this run. Writes it to
    <job_dir>/stage2/record.json (when `assemble` failed, the Volume still holds an earlier run's record, which would
    otherwise be downloaded and reported as done) and, when no turntable was assembled, removes the local
    stage2/frames and stage2/garment_mask (an earlier run's, downloaded or left in the job dir). Returns what it removed."""
    import shutil

    out = os.path.join(job_dir, "stage2")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "record.json"), "w") as f:
        json.dump(rec, f, indent=2)
    removed = []
    if not stage2_turntable_usable(rec):
        for sub in ("frames", "garment_mask"):
            if os.path.isdir(os.path.join(out, sub)):
                shutil.rmtree(os.path.join(out, sub))
                removed.append(f"stage2/{sub}")
    return removed


@app.function(image=image, volumes={pm.JOBS_DIR: pm.jobs}, timeout=3600, region=CFG["region"])
def score_consistency(job_id: str, stride: int = lib.CONSISTENCY_STRIDE, v1: bool = True, masks: bool = True) -> dict:
    """Per-frame garment consistency of the generated clips (CPU only), written into stage2/record.json:

    consistency     v2 (phase0_garment): each frame's garment, segmented against our own bare mannequin and a
                    background model, vs the pinned stills carried to that camera through a visual hull (the
                    proxy only bounds the depth); motion frames vs the posed proxy as a loose envelope; leg
                    drift checks; artefacts (text, props) reported apart
    consistency_v1  the first metric (frame foreground vs the proxy silhouette), kept for comparison; it
                    flagged 233/243 frames of run 11a, where no frame drifted (`v1=False` skips it)

    With `masks`, also writes stage2/garment_mask/NNNN.png for the assembled turntable: stage 4's alpha
    targets for source stage2 (`--stage2-masks garment`)."""
    import imageio.v2 as imageio
    import numpy as np

    import phase0_garment as pg

    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    rec_path = f"{job}/stage2/record.json"
    with open(rec_path) as f:
        record = json.load(f)
    done = [c["id"] for c in record.get("clips", [])]

    summary = pg.score_job(job, m, done)
    record["consistency"] = summary
    if masks and os.path.isdir(f"{job}/stage2/frames"):
        try:
            record["garment_masks"] = pg.write_turntable_masks(job, m)
            record["garment_masks"]["vs_synthetic_truth"] = pg.alpha_target_check(job, m)
        except FileNotFoundError as e:
            record["garment_masks"] = {"error": f"turntable incomplete: {e}"}

    if v1:
        t0 = time.time()

        def mask(rel: str) -> np.ndarray:
            a = np.asarray(imageio.imread(os.path.join(job, rel)))
            return (a[..., 0] if a.ndim == 3 else a)[::stride, ::stride] > 127

        rows = []
        for item in lib.consistency_plan(m, done):
            rgb = np.asarray(imageio.imread(os.path.join(job, item["generated"])))[..., :3][::stride, ::stride]
            h, w = rgb.shape[:2]
            rgb_bytes = np.ascontiguousarray(rgb, dtype=np.uint8).tobytes()
            fg = lib.frame_foreground(rgb_bytes, w, h)
            ctrl = mask(item["control_mask"]).astype(np.uint8).tobytes()
            prox = mask(item["proxy_mask"]).astype(np.uint8).tobytes() if item["proxy_mask"] else None
            rows.append({"clip": item["clip"], "j": item["j"], "frame": item["frame"], **lib.frame_consistency(fg, ctrl, prox, w, h, rgb=rgb_bytes)})
        v1s = lib.consistency_summary(rows, mode=lib.control_mode(m), stride=stride)
        v1s["seconds"] = round(time.time() - t0, 1)
        v1s["superseded_by"] = "consistency (v2)"
        record["consistency_v1"] = v1s
    with open(rec_path, "w") as f:
        json.dump(record, f, indent=2)
    pm.jobs.commit()
    return summary


def consistency_line(c: dict) -> str:
    """One log line: drift-flagged frames, artefact frames and the worst numbers (consistency v2)."""
    if "version" not in c:  # a v1 block
        worst = lambda k: "n/a" if not c.get(k) else f"{c[k]['min']:.3f}"  # noqa: E731
        return f"[stage2] consistency v1 vs {c['control_mode']} control: {c['flagged']}/{c['frames']} frames flagged; min silhouette IoU {worst('silhouette_iou')}"
    flagged = ", ".join(f"{f['clip']}#{f['j']}" for f in c["flagged_frames"][:12]) + (" ..." if len(c["flagged_frames"]) > 12 else "")
    iou = c.get("garment_iou") or {}
    return (
        f"[stage2] garment consistency ({c['version']}): {c['flagged']}/{c['frames']} frames flagged for drift"
        f"{f' ({flagged})' if flagged else ''}; garment IoU min {iou.get('min', 'n/a')} mean {iou.get('mean', 'n/a')}; "
        f"{len(c.get('artefact_frames', []))} frames with artefacts (text, props), {len(c.get('blind_frames', []))} frames blind to leg drift"
        + off_reference_line(c.get("off_reference_spans") or [])
    )


def off_reference_line(spans: list) -> str:
    """The off-reference spans (garment off the stills' hull below the hips: a flap or panel), for the log."""
    if not spans:
        return ""
    return "; off the stills' hull below the hips: " + ", ".join(f"{s['clip']} j{s['j0']}-{s['j1']} ({s['frames']} frames, max {s['max_px']} px, {s['side']})" for s in spans)


@app.local_entrypoint()
def main(job_dir: str, steps: int = 40, clips: str = "", motion: bool = False, control_encoding: str = "linear", no_pin_frames: bool = False, download_only: bool = False, force_upload: bool = False, consistency_only: bool = False, consistency_stride: int = lib.CONSISTENCY_STRIDE):
    m = pm.load_local_job(job_dir)
    job_id = m["job_id"]
    problems = lib.prompt_problems(m)
    if problems and not (download_only or consistency_only):
        raise SystemExit("[stage2] prompts refused: " + "; ".join(problems))
    print(f"[stage2] control {lib.control_mode(m)}; prompt: {lib.video_prompts(m)['description'] if not problems else '(invalid)'}")
    if consistency_only:
        print(consistency_line(score_consistency.remote(job_id, stride=consistency_stride)))
    elif not download_only:
        clip_ids = [c for c in clips.split(",") if c] or None
        try:
            plan = lib.stage2_clip_plan(m, clip_ids, motion=motion)  # an unknown clip fails here, before any GPU time
        except lib.ManifestError as e:
            raise SystemExit(f"[stage2] {e}") from None
        print("[stage2] clips " + ", ".join(f"{c['id']} (seed {c['seed']})" for c in plan) + ", one GPU container each")
        pm.upload_job(job_dir, job_id, force=force_upload)
        print("[stage2] weights:", download_weights.remote())
        record = run_stage2(m, steps=steps, clip_ids=clip_ids, motion=motion, control_encoding=control_encoding, pin_frames=not no_pin_frames)
        with open(os.path.join(job_dir, "stage2_record.local.json"), "w") as f:
            json.dump(record, f, indent=2)
        print(json.dumps({k: record.get(k) for k in ("clips", "turntable_frames_assembled", "seams", "load_seconds", "complete", "failed_clips")}, indent=2))
        print(lib.format_cost_table(record["costs"]))
        if not record.get("complete", False):
            pm.download_dir(job_dir, job_id, "stage2")
            sync_local_record(job_dir, record)
            if not stage2_turntable_usable(record):
                raise SystemExit(stage2_failure_line(record))
            print(stage2_failure_line(record))
        print(consistency_line(score_consistency.remote(job_id, stride=consistency_stride)))
    pm.download_dir(job_dir, job_id, "stage2")
