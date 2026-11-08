"""Phase 0 stage 2 on Modal: image -> video with Wan2.2-Fun-A14B-Control (research doc, shortlist A).

For one exported job it generates three 81-frame clips at 16 fps, each driven by the depth video the
exporter rendered (control/depth_vis or motion/depth_vis), so the camera pose of every generated frame
is the pose we rendered. Since phase0-export-0.2.0 that depth shows our mannequin WEARING a coarse proxy
garment from the category and chart (manifest `control.mode` = proxy, the default; `bare` = the bare
mannequin, which turned a dress into trousers in the first GPU run):

  turntable_a  front -> back  (start frame = front still, end frame = back still)
  turntable_b  back -> front  (start frame = back still,  end frame = front still)
  motion       the stored motion clip from the fixed motion camera (no pinned frame since export 0.3.0: the
               front still is drawn at the turntable camera, 320 cm, the motion camera stands at 520 cm, and
               run 11a's motion clip jumped in scale after its pinned first frame; older manifests still pin it)

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
Options: --steps 40  --clips turntable_a,turntable_b,motion  --control-encoding linear|inverse
         --no-pin-frames (reference image + control only)  --download-only
         --consistency-only (re-score stage2/ already in the Volume)  --consistency-stride 2

Environment: CURTAIN_MODAL_GPU_VIDEO (default H100), CURTAIN_MODAL_REGION (e.g. eu, 1.15x),
CURTAIN_MODAL_TIMEOUT_VIDEO (s, default 10800), CURTAIN_MODAL_MEMORY_VIDEO_MB (default 131072),
CURTAIN_WAN_MEMORY_MODE (default model_cpu_offload). Every record this writes is an ESTIMATE.

NOT TESTED: nothing in this file has run on a GPU yet (the build container cannot reach Modal). The
VideoX-Fun calls follow examples/wan2.2_fun/predict_v2v_control.py at the pinned commit.
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


@app.function(
    image=image,
    gpu=CFG["gpu_video"],
    volumes={pm.WEIGHTS_DIR: pm.weights, pm.JOBS_DIR: pm.jobs},
    timeout=CFG["timeout_video"],
    memory=CFG["memory_video_mb"],
    region=CFG["region"],
)
def generate(job_id: str, steps: int = 40, clip_ids: list[str] | None = None, control_encoding: str = "linear", pin_frames: bool = True, guidance_scale: float = 6.0, shift: float = 5.0) -> dict:
    import subprocess

    import imageio.v2 as imageio
    import numpy as np
    import torch
    from diffusers import FlowMatchEulerDiscreteScheduler
    from omegaconf import OmegaConf
    from PIL import Image
    from videox_fun.dist import set_multi_gpus_devices
    from videox_fun.models import AutoencoderKLWan, AutoTokenizer, Wan2_2Transformer3DModel, WanT5EncoderModel
    from videox_fun.pipeline import Wan2_2FunControlPipeline
    from videox_fun.utils.fp8_optimization import convert_model_weight_to_float8, convert_weight_dtype_wrapper, replace_parameters_by_name
    from videox_fun.utils.utils import filter_kwargs, get_image_latent, get_image_to_video_latent, get_video_to_video_latent, save_videos_grid

    t_start = time.time()
    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    problems = lib.prompt_problems(m)
    if problems:
        raise lib.ManifestError("stage 2 prompts refused: " + "; ".join(problems))
    prompts = lib.video_prompts(m)
    mode_control = lib.control_mode(m)
    if not os.path.exists(os.path.join(MODEL_DIR, ".complete.json")):
        raise RuntimeError("weights not in the Volume yet: run download_weights first (run_phase0.py and this app's entrypoint do)")
    out = f"{job}/stage2"
    os.makedirs(out, exist_ok=True)
    gpu_name = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()

    # Model, as in VideoX-Fun examples/wan2.2_fun/predict_v2v_control.py at the pinned commit.
    t0 = time.time()
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
    load_s = time.time() - t0

    width, height = m["camera"]["width"], m["camera"]["height"]
    sample_size = [height, width]
    photo = lambda role: os.path.join(job, lib.photo_path(m, role))  # noqa: E731
    wanted = clip_ids or [c["id"] for c in m["clips"]]
    clips_out = []
    for ci, clip in enumerate(c for c in m["clips"] if c["id"] in wanted):
        t1 = time.time()
        n = len(clip["frame_indices"])
        control_mp4 = f"/tmp/control_{clip['id']}.mp4"
        _control_video(job, m, clip, control_encoding, control_mp4)
        start = photo(clip["first_photo"]) if pin_frames and clip.get("first_photo") else None
        end = photo(clip["last_photo"]) if pin_frames and clip.get("last_photo") else None
        seed = int(m["seeds"]["video"]) + ci
        generator = torch.Generator(device=device).manual_seed(seed)
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
        clips_out.append({"id": clip["id"], "frames": int(frames.shape[0]), "seed": seed, "start": clip.get("first_photo") if start else None, "end": clip.get("last_photo") if end else None, "seconds": round(time.time() - t1, 1)})
        print(f"[stage2] {clip['id']}: {frames.shape[0]} frames in {time.time() - t1:.0f} s")

    # One frame per camera pose, plus drift at the frames both half turns render.
    assembled, seams_out = 0, []
    done = {c["id"] for c in clips_out}
    if {"turntable_a", "turntable_b"} <= done:
        assignments, seams = lib.turntable_assembly(m)
        os.makedirs(f"{out}/frames", exist_ok=True)
        for idx, cid, j in assignments:
            Image.open(f"{out}/clips/{cid}/{j:04d}.png").save(f"{out}/frames/{idx:04d}.png")
            assembled += 1
        for idx, owners in seams:
            a, b = (np.asarray(Image.open(f"{out}/clips/{cid}/{j:04d}.png"), dtype=np.float64) for cid, j in owners[:2])
            seams_out.append({"frame": idx, "clips": [o[0] for o in owners], "mean_abs_diff_8bit": round(float(np.abs(a - b).mean()), 2)})

    gpu_seconds = time.time() - t_start
    record = {
        "stage": "stage2_video",
        "job_id": job_id,
        "input_hash": m["input_hash"],
        "model": VIDEO,
        "gpu_name": gpu_name,
        "memory_mode": mode,
        "steps": steps,
        "guidance_scale": guidance_scale,
        "shift": shift,
        "control_encoding": control_encoding,
        "control_mode": mode_control,
        "control_proxy": (m["control"].get("proxy") or {}).get("kind"),
        "prompt": {k: prompts.get(k) for k in ("version", "kind", "description", "turntable", "motion", "negative")},
        "pin_frames": pin_frames,
        "load_seconds": round(load_s, 1),
        "clips": clips_out,
        "turntable_frames_assembled": assembled,
        "seams": seams_out,
        "synthetic_photos": any(p.get("synthetic") for p in m["photos"]),
        "stills": lib.photo_provenance(m),
        "cost": lib.cost_record("stage2_video", gpu=CFG["gpu_video"], region=CFG["region"], gpu_seconds=gpu_seconds),
        "label": "generated video: an estimate of the garment, not a measurement (AGENTS.md rule 3)",
    }
    with open(f"{out}/record.json", "w") as f:
        json.dump(record, f, indent=2)
    pm.jobs.commit()
    return record


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
def main(job_dir: str, steps: int = 40, clips: str = "", control_encoding: str = "linear", no_pin_frames: bool = False, download_only: bool = False, force_upload: bool = False, consistency_only: bool = False, consistency_stride: int = lib.CONSISTENCY_STRIDE):
    m = pm.load_local_job(job_dir)
    job_id = m["job_id"]
    problems = lib.prompt_problems(m)
    if problems and not (download_only or consistency_only):
        raise SystemExit("[stage2] prompts refused: " + "; ".join(problems))
    print(f"[stage2] control {lib.control_mode(m)}; prompt: {lib.video_prompts(m)['description'] if not problems else '(invalid)'}")
    if consistency_only:
        print(consistency_line(score_consistency.remote(job_id, stride=consistency_stride)))
    elif not download_only:
        pm.upload_job(job_dir, job_id, force=force_upload)
        print("[stage2] weights:", download_weights.remote())
        t = time.time()
        record = generate.remote(job_id, steps=steps, clip_ids=[c for c in clips.split(",") if c] or None, control_encoding=control_encoding, pin_frames=not no_pin_frames)
        record["cost"] = lib.cost_record("stage2_video", gpu=CFG["gpu_video"], region=CFG["region"], gpu_seconds=record["cost"]["gpu_seconds"], wall_seconds=time.time() - t)
        with open(os.path.join(job_dir, "stage2_record.local.json"), "w") as f:
            json.dump(record, f, indent=2)
        print(json.dumps({k: record[k] for k in ("clips", "turntable_frames_assembled", "seams", "load_seconds")}, indent=2))
        print(lib.format_cost_table([record["cost"]]))
        print(consistency_line(score_consistency.remote(job_id, stride=consistency_stride)))
    pm.download_dir(job_dir, job_id, "stage2")
