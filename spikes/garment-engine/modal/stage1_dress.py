"""Phase 0 stage 1b on Modal: dress OUR mannequin from a shop photo (docs/research/garment-engine.md, "Stage 1b").

Stage 2 pins a front and a back still of the garment on our canonical mannequin at frames 0 and N/2 of
the turntable. A shop photo shows the garment on a person (or flat-lay), not on our mannequin. For a job
exported with `--on-model` or `--flat-lay` (src/exportCli.ts) this app produces those two stills:

  1. segment the garment in each shop photo: Grounding DINO box from a category prompt -> SAM 2.1 mask
     (both Apache-2.0); the mask and a cut-out on studio grey are kept for the record
  2. dress our bare-mannequin render at that view (dress/bare_<view>.png, rendered by the exporter with the
     camera of cameras_opencv.json frame 0 or N/2) with one engine:
       fashn  FASHN VTON v1.5 (Apache-2.0): person = our render, garment = the shop photo, maskless mode.
              Its packaged human parser (NVIDIA SegFormer licence, non-commercial) is NOT installed; the
              pipeline gets our SAM 2 mask as its label map instead
       qwen   Qwen-Image-Edit-2511 (Apache-2.0): picture 1 = our render, picture 2 = the garment cut-out,
              prompt "dress the mannequin, keep pose, camera, light and background"
  3. back: from the back photo when there is one. Without one the back is GENERATED (fashn: the front photo
     onto the back render; qwen: the dressed front still as picture 2) and marked `invented: true` in
     every record (D13: the merchant owns the back; this is for validation runs only)
  4. garment mask on the generated still: difference to our render (the stage 3 idea) refined by SAM 2
     with that box; alignment QA against our silhouette (phase0_lib.alignment_qa); then the still stage 2
     pins is our bare render with only the garment pixels pasted in (mannequin, light and background stay
     exactly ours, so the still agrees with the control video)
  5. outputs in the job dir (Volume curtain-phase0-jobs):
       stage1b/front.png, stage1b/back.png            the pinned stills, written ONLY when QA passes
                                                     (or with --accept-failed, which the record says)
       stage1b/garment_mask_<view>.png               0/255
       stage1b/raw/<view>.png                        the model output resized to the frame, uncomposited
       stage1b/rejected/<view>.png                   a still that failed QA
       stage1b/source/<view>_mask.png, _cutout.png   the shop-photo segmentation
       stage1b/record.json                           pins, parameters, per-view QA, summary, cost estimate

Run (from the repo root, after `pnpm --filter @curtain/garment-spike export:phase0 -- --product <id> --on-model --front … [--back …]`):
  modal run spikes/garment-engine/modal/stage1_dress.py --job-dir spikes/garment-engine/out/phase0/<id>
Options: --engine fashn|qwen  --steps N (engine default: fashn 30, qwen 40)  --seed N (default: the
         manifest's video seed)  --no-composite  --accept-failed  --category one-pieces|tops|bottoms
         --download-only  --force-upload

Environment: CURTAIN_MODAL_GPU_DRESS (default H100), CURTAIN_MODAL_REGION, CURTAIN_MODAL_TIMEOUT_DRESS (s,
default 3600), CURTAIN_MODAL_MEMORY_DRESS_MB (default 65536), CURTAIN_QWEN_CPU_OFFLOAD (0/1).
Every output is a GENERATED estimate (AGENTS.md rule 3) and every cost is an ESTIMATE.

NOT TESTED: nothing in this file has run on a GPU or on Modal (the build container cannot reach Modal).
The model calls follow the model cards and the pinned library versions; the pure parts are in
phase0_lib.py and are tested by tests/test_stage1_dress.py.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import modal  # noqa: E402

import phase0_lib as lib  # noqa: E402
import phase0_modal as pm  # noqa: E402

CFG = lib.stage1b_settings()
M = lib.STAGE1B_MODELS
FASHN_CODE_DIR = "/opt/fashn-vton"
REQUIREMENTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements-stage1.txt")
ENGINE_STEPS = {"fashn": 30, "qwen": 40}
SOURCE_MAX_SIDE = 1536  # shop photos are scaled down to this before segmentation and try-on


def weights_dir(key: str) -> str:
    return f"{pm.WEIGHTS_DIR}/hf/{M[key]['id']}@{M[key]['revision']}"


# Which weights each engine needs (the segmentation models are always needed).
ENGINE_WEIGHTS = {"fashn": ("detector", "segmenter", "fashn"), "qwen": ("detector", "segmenter", "qwen")}

QWEN_NEGATIVE = "person, human, face, hands, skin, hair, extra limbs, changed pose, different camera angle, cropped, text, watermark, logo, blurry, busy background"
QWEN_PROMPTS = {
    "front": (
        "Picture 1 is a plain mid-grey studio mannequin seen from the front. Picture 2 is a garment: {name} ({category}). "
        "Dress the mannequin of picture 1 in exactly this garment, with the same colour, print, fabric, length, neckline and sleeves as picture 2. "
        "Keep the mannequin, its pose, the camera, the framing, the light and the plain light-grey background of picture 1 exactly as they are. "
        "No person, no face, no extra clothing, no accessories, no text."
    ),
    "back_photo": (
        "Picture 1 is a plain mid-grey studio mannequin seen from behind. Picture 2 is the back of a garment: {name} ({category}). "
        "Dress the mannequin of picture 1 in exactly this garment seen from behind, with the same colour, print, fabric, length and details as picture 2. "
        "Keep the mannequin, its pose, the camera, the framing, the light and the plain light-grey background of picture 1 exactly as they are. "
        "No person, no face, no extra clothing, no accessories, no text."
    ),
    "back_invented": (
        "Picture 1 is a plain mid-grey studio mannequin seen from behind. Picture 2 shows the same mannequin from the front wearing a garment: {name} ({category}). "
        "Dress the mannequin of picture 1 in the same garment seen from behind: same colour, print, fabric and length; a plain back with no added details. "
        "Keep the mannequin, its pose, the camera, the framing, the light and the plain light-grey background of picture 1 exactly as they are. "
        "No person, no face, no extra clothing, no accessories, no text."
    ),
}

app = modal.App("curtain-phase0-stage1b-dress")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install_from_requirements(REQUIREMENTS)
    .run_commands(
        f"git clone https://github.com/fashn-AI/fashn-vton-1.5 {FASHN_CODE_DIR}",
        f"cd {FASHN_CODE_DIR} && git checkout {M['fashn']['code_revision']}",
        # --no-deps: its declared dependency fashn-human-parser carries a non-commercial licence; the
        # other dependencies are pinned in requirements-stage1.txt. The last command fails the build if
        # the parser ever ends up in the image.
        f"pip install --no-deps {FASHN_CODE_DIR}",
        "python -c \"import importlib.util, sys; sys.exit(importlib.util.find_spec('fashn_human_parser') is not None)\"",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .add_local_python_source("phase0_lib", "phase0_modal")
)


@app.function(image=image, volumes={pm.WEIGHTS_DIR: pm.weights}, timeout=CFG["timeout_download"], region=CFG["region"])
def download_dress_weights(engines: list[str]) -> dict:
    """Downloads the pinned snapshots an engine needs into the weights Volume, once per revision."""
    from huggingface_hub import snapshot_download

    patterns = {
        "detector": ["config.json", "model.safetensors", "preprocessor_config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.txt"],
        "segmenter": ["config.json", "model.safetensors", "preprocessor_config.json", "processor_config.json"],
        "fashn": ["model.safetensors"],
        "qwen": None,
    }
    out = {}
    keys = sorted({k for e in engines for k in ENGINE_WEIGHTS[e]})
    for key in keys:
        target = weights_dir(key)
        marker = os.path.join(target, ".complete.json")
        if os.path.exists(marker):
            with open(marker) as f:
                out[key] = {"cached": True, **json.load(f)}
            continue
        t0 = time.time()
        snapshot_download(repo_id=M[key]["id"], revision=M[key]["revision"], local_dir=target, allow_patterns=patterns[key])
        if key == "fashn":  # TryOnPipeline expects <weights>/dwpose/{yolox_l,dw-ll_ucoco_384}.onnx
            snapshot_download(repo_id=M["fashn"]["pose_id"], revision=M["fashn"]["pose_revision"], local_dir=os.path.join(target, "dwpose"), allow_patterns=["*.onnx"])
        size = sum(os.path.getsize(os.path.join(r, n)) for r, _, fs in os.walk(target) for n in fs)
        info = {"repo": M[key]["id"], "revision": M[key]["revision"], "bytes": size, "download_s": round(time.time() - t0, 1)}
        with open(marker, "w") as f:
            json.dump(info, f)
        pm.weights.commit()
        out[key] = {"cached": False, **info}
    return out


def _install_parser_stand_in() -> None:
    """fashn_vton imports its label constants and FashnHumanParser from the fashn_human_parser package,
    which we do not install (non-commercial licence). This module provides the constants from the
    published label table and a FashnHumanParser that refuses to load, before fashn_vton is imported."""
    mod = types.ModuleType("fashn_human_parser")
    mod.LABELS_TO_IDS = dict(lib.FASHN_LABEL_IDS)
    mod.IDS_TO_LABELS = {i: n for n, i in lib.FASHN_LABEL_IDS.items()}
    mod.CATEGORY_TO_BODY_COVERAGE = dict(lib.FASHN_CATEGORY_TO_BODY_COVERAGE)
    mod.BODY_COVERAGE_TO_LABELS = {k: list(v) for k, v in lib.FASHN_BODY_COVERAGE_TO_LABELS.items()}
    mod.IDENTITY_LABELS = list(lib.FASHN_IDENTITY_LABELS)

    class FashnHumanParser:  # noqa: D401 - stand-in
        def __init__(self, *a, **k):
            raise RuntimeError("fashn-human-parser is not used (NVIDIA SegFormer licence, non-commercial); stage1_dress.py supplies SAM 2 masks")

    mod.FashnHumanParser = FashnHumanParser
    sys.modules["fashn_human_parser"] = mod


class _MaskParser:
    """Takes the place of the human parser inside TryOnPipeline: returns the label maps queued for the
    next call (person first, then garment), resized to the image the pipeline passes in."""

    def __init__(self):
        self.queue = []

    def predict(self, img_np):
        import numpy as np
        from PIL import Image

        if not self.queue:
            raise RuntimeError("no label map queued for the try-on call")
        lab = self.queue.pop(0)
        h, w = img_np.shape[:2]
        if lab.shape != (h, w):
            lab = np.asarray(Image.fromarray(lab).resize((w, h), Image.NEAREST))
        return lab


def _sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


@app.function(
    image=image,
    gpu=CFG["gpu_dress"],
    volumes={pm.WEIGHTS_DIR: pm.weights, pm.JOBS_DIR: pm.jobs},
    timeout=CFG["timeout_dress"],
    memory=CFG["memory_dress_mb"],
    region=CFG["region"],
)
def dress(job_id: str, engine: str = "fashn", steps: int = 0, seed: int | None = None, composite: bool = True, accept_failed: bool = False, category: str = "") -> dict:
    import subprocess

    import numpy as np
    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor, Sam2Model, Sam2Processor

    if engine not in lib.STAGE1B_ENGINES:
        raise ValueError(f"engine {engine!r}: use one of {', '.join(lib.STAGE1B_ENGINES)}")
    t_start = time.time()
    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    views = lib.stage1b_plan(m)
    spec = m["stage1b"]
    for key in ENGINE_WEIGHTS[engine]:
        if not os.path.exists(os.path.join(weights_dir(key), ".complete.json")):
            raise RuntimeError(f"weights for {key} not in the Volume yet: run download_dress_weights first (this app's entrypoint does)")
    tryon_cat = category or lib.tryon_category(m["category"])
    if tryon_cat not in lib.GARMENT_PROMPT:
        raise ValueError(f"category {tryon_cat!r}: use one of {', '.join(lib.GARMENT_PROMPT)}")
    steps = steps or ENGINE_STEPS[engine]
    seed = int(m["seeds"]["video"]) if seed is None else int(seed)
    W, H = int(m["camera"]["width"]), int(m["camera"]["height"])
    bg = tuple(spec["background_rgb"])
    margin = lib.align_margin_px(tryon_cat, H)
    out = f"{job}/{lib.STAGE1B_DIR}"
    for sub in ("", "raw", "rejected", "source"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    for v in views:  # a re-run must not leave an older pinned still behind
        p = os.path.join(job, v["still"])
        if os.path.exists(p):
            os.remove(p)
    gpu_name = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
    dev = "cuda"

    # Segmentation models (always loaded; small).
    t0 = time.time()
    det_proc = AutoProcessor.from_pretrained(weights_dir("detector"))
    det = AutoModelForZeroShotObjectDetection.from_pretrained(weights_dir("detector")).to(dev).eval()
    sam_proc = Sam2Processor.from_pretrained(weights_dir("segmenter"))
    sam = Sam2Model.from_pretrained(weights_dir("segmenter")).to(dev).eval()

    def detect(img: Image.Image) -> tuple[list[float] | None, float | None, str | None]:
        inputs = det_proc(images=img, text=lib.GARMENT_PROMPT[tryon_cat], return_tensors="pt").to(dev)
        with torch.no_grad():
            res = det(**inputs)
        r = det_proc.post_process_grounded_object_detection(res, inputs.input_ids, threshold=0.3, text_threshold=0.25, target_sizes=[img.size[::-1]])[0]
        if len(r["scores"]) == 0:
            return None, None, None
        i = int(torch.argmax(r["scores"]))
        labels = r.get("text_labels") or r.get("labels")
        return [float(x) for x in r["boxes"][i].tolist()], float(r["scores"][i]), str(labels[i]) if labels is not None else None

    def sam_mask(img: Image.Image, box: list[float]) -> tuple[np.ndarray, float]:
        inputs = sam_proc(images=img, input_boxes=[[box]], return_tensors="pt").to(dev)
        with torch.no_grad():
            res = sam(**inputs, multimask_output=False)
        masks = sam_proc.post_process_masks(res.pred_masks.cpu(), inputs["original_sizes"])[0]
        return masks[0, 0].numpy().astype(bool), float(res.iou_scores[0, 0, 0])

    # Engine.
    if engine == "fashn":
        _install_parser_stand_in()
        sys.path.insert(0, os.path.join(FASHN_CODE_DIR, "src"))
        from fashn_vton import TryOnPipeline

        parser = _MaskParser()

        class _Pipeline(TryOnPipeline):
            def _setup_hp_model(self):
                self.hp_model = parser

        pipe = _Pipeline(weights_dir=weights_dir("fashn"))
        poses: list[dict] = []
        detect_pose = pipe.pose_model

        def recording_pose(img):
            pose = detect_pose(img)
            subset = pose["bodies"]["subset"]
            poses.append({"body_keypoints_visible": int((subset >= 0).sum()), "of": int(subset.size)})
            return pose

        pipe.pose_model = recording_pose
    else:
        from diffusers import QwenImageEditPlusPipeline

        pipe = QwenImageEditPlusPipeline.from_pretrained(weights_dir("qwen"), torch_dtype=torch.bfloat16)
        if CFG["qwen_cpu_offload"]:
            pipe.enable_model_cpu_offload()
        else:
            pipe.to(dev)
        pipe.set_progress_bar_config(disable=True)
    load_s = time.time() - t0

    def load_rgb(rel: str) -> Image.Image:
        img = Image.open(os.path.join(job, rel)).convert("RGB")
        s = SOURCE_MAX_SIDE / max(img.size)
        return img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS) if s < 1 else img

    def save_mask(arr: np.ndarray, rel: str) -> str:
        Image.fromarray((arr > 0).astype(np.uint8) * 255).save(os.path.join(job, rel))
        return rel

    words = {"name": m["product_name"], "category": m["category"]}
    sources: dict[str, dict] = {}
    view_records: list[dict] = []
    front_still: Image.Image | None = None
    for v in views:
        t1 = time.time()
        name = v["view"]
        rec: dict = {"view": name, "frame": v["frame"], "invented": v["invented"], "source": v["source"], "engine": engine}
        try:
            bare = Image.open(os.path.join(job, v["bare_rgb"])).convert("RGB")
            if bare.size != (W, H):
                raise RuntimeError(f"{v['bare_rgb']} is {bare.size}, expected {(W, H)}")
            bare_mask = np.asarray(Image.open(os.path.join(job, v["bare_mask"])).convert("L")) > 127

            # 1. The shop photo for this view: garment box and mask.
            src_view = name if v["source"] else "front"
            if src_view not in sources:
                src_rel = v["source"] or next(s["source"] for s in views if s["view"] == "front")
                src = load_rgb(src_rel)
                box, det_score, label = detect(src)
                if box is None:
                    raise RuntimeError(f"no {lib.GARMENT_PROMPT[tryon_cat]!r} found in {src_rel}")
                smask, sam_score = sam_mask(src, box)
                arr = np.asarray(src).copy()
                arr[~smask] = bg
                y0, y1 = np.where(smask.any(axis=1))[0][[0, -1]]
                x0, x1 = np.where(smask.any(axis=0))[0][[0, -1]]
                pad = int(0.04 * max(src.size))
                cut = Image.fromarray(arr).crop((max(0, x0 - pad), max(0, y0 - pad), min(src.width, x1 + 1 + pad), min(src.height, y1 + 1 + pad)))
                cut.save(os.path.join(job, f"{lib.STAGE1B_DIR}/source/{src_view}_cutout.png"))
                sources[src_view] = {
                    "image": src,
                    "mask": smask,
                    "cutout": cut,
                    "record": {
                        "photo": src_rel,
                        "size": list(src.size),
                        "box": [round(x, 1) for x in box],
                        "detector_score": round(det_score, 3),
                        "detector_label": label,
                        "sam_score": round(sam_score, 3),
                        "garment_px": int(smask.sum()),
                        "mask": save_mask(smask, f"{lib.STAGE1B_DIR}/source/{src_view}_mask.png"),
                        "cutout": f"{lib.STAGE1B_DIR}/source/{src_view}_cutout.png",
                    },
                }
            s = sources[src_view]
            rec["source_segmentation"] = s["record"]

            # 2. Dress our render.
            if engine == "fashn":
                n_pose = len(poses)
                parser.queue = [np.zeros((H, W), np.uint8), np.frombuffer(bytes(lib.fashn_label_map(s["mask"].astype(np.uint8).tobytes(), tryon_cat)), np.uint8).reshape(s["mask"].shape)]
                result = pipe(
                    person_image=bare,
                    garment_image=s["image"],
                    category=tryon_cat,
                    garment_photo_type="flat-lay" if spec["source_kind"] == "flat_lay" else "model",
                    num_timesteps=steps,
                    seed=seed,
                    segmentation_free=True,
                )
                gen = result.images[0]
                rec["method"] = "fashn: shop photo onto our render" + (" (FRONT photo onto the BACK view: invented back)" if v["invented"] else "")
                rec["pose"] = {"mannequin": poses[n_pose] if len(poses) > n_pose else None, "garment_photo": poses[n_pose + 1] if len(poses) > n_pose + 1 else None}
            else:
                if v["invented"]:
                    if front_still is None:
                        raise RuntimeError("the invented back needs the front still, which failed")
                    pictures, prompt = [bare, front_still], QWEN_PROMPTS["back_invented"]
                    rec["method"] = "qwen: invented from the dressed front still (no back photo)"
                else:
                    pictures, prompt = [bare, s["cutout"]], QWEN_PROMPTS["front" if name == "front" else "back_photo"]
                    rec["method"] = "qwen: garment cut-out onto our render"
                cw, ch = lib.fit_size(W, H, 1024 * 1024, 16)
                with torch.inference_mode():
                    gen = pipe(
                        image=pictures,
                        prompt=prompt.format(**words),
                        negative_prompt=QWEN_NEGATIVE,
                        true_cfg_scale=4.0,
                        guidance_scale=1.0,
                        num_inference_steps=steps,
                        height=ch,
                        width=cw,
                        generator=torch.Generator(device="cpu").manual_seed(seed),
                    ).images[0]
                rec["prompt"] = prompt.format(**words)
                rec["canvas"] = [cw, ch]
            rec["model_output_size"] = list(gen.size)
            gen = gen.convert("RGB").resize((W, H), Image.LANCZOS)
            raw_rel = f"{lib.STAGE1B_DIR}/raw/{name}.png"
            gen.save(os.path.join(job, raw_rel))

            # 3. Garment mask on the generated still, QA, composite.
            gen_b, bare_b = gen.tobytes(), bare.tobytes()
            prior = lib.garment_prior(gen_b, bare_b, W, H, bg)
            box = lib.bbox(prior, W, H)
            refined = None
            if box is not None:
                p = 4
                rmask, rscore = sam_mask(gen, [max(0, box[0] - p), max(0, box[1] - p), min(W, box[2] + p), min(H, box[3] + p)])
                refined = rmask.astype(np.uint8).tobytes()
                rec["sam_score"] = round(rscore, 3)
            garment, mask_source, agree = lib.choose_garment_mask(prior, refined)
            foreground = lib.keep_large_components(lib.mask_not(lib.background_mask(gen_b, W, H, bg, 10)), W, H, 0.02)
            bare_m = bare_mask.astype(np.uint8).tobytes()
            mae = lib.mean_abs_diff(gen_b, bare_b, lib.mask_andnot(bare_m, garment))
            qa = lib.alignment_qa(garment, foreground, bare_m, W, H, margin, mannequin_mae=mae)
            rec.update({"mask_source": mask_source, "sam_prior_iou": None if agree is None else round(agree, 4), "qa": qa})
            g_arr = np.frombuffer(bytes(garment), np.uint8).reshape(H, W)
            rec["garment_mask"] = save_mask(g_arr, v["garment_mask"])
            final = Image.frombytes("RGB", (W, H), bytes(lib.composite(bare_b, gen_b, garment))) if composite else gen
            rec["composited"] = composite
            rec["raw"] = raw_rel
            if qa["pass"] or accept_failed:
                final.save(os.path.join(job, v["still"]))
                rec["still"] = v["still"]
                rec["still_sha256"] = _sha256(os.path.join(job, v["still"]))
                rec["qa_overridden"] = not qa["pass"]
            else:
                rejected = f"{lib.STAGE1B_DIR}/rejected/{name}.png"
                final.save(os.path.join(job, rejected))
                rec["still"] = None
                rec["rejected"] = rejected
            if name == "front":
                front_still = final
        except Exception as e:  # noqa: BLE001 - record the failure, keep the other view
            rec["error"] = f"{type(e).__name__}: {e}"
            rec["qa"] = {"pass": False, "failures": [rec["error"]]}
        rec["seconds"] = round(time.time() - t1, 1)
        if v["invented"]:
            rec["label"] = lib.INVENTED_BACK_LABEL
        view_records.append(rec)
        print(f"[stage1b] {name}: {rec.get('method', 'failed')}; QA {'pass' if rec['qa'].get('pass') else 'FAIL'} {rec['qa'].get('failures', [])}")

    model_pins = {k: M[k] for k in ENGINE_WEIGHTS[engine]}
    record = {
        "stage": "stage1b_dress",
        "job_id": job_id,
        "input_hash": m["input_hash"],
        "engine": engine,
        "models": model_pins,
        "gpu_name": gpu_name,
        "steps": steps,
        "seed": seed,
        "category": m["category"],
        "tryon_category": tryon_cat,
        "source_kind": spec["source_kind"],
        "align_margin_px": margin,
        "composite": composite,
        "accept_failed": accept_failed,
        "load_seconds": round(load_s, 1),
        "views": view_records,
        "summary": lib.stage1b_summary(view_records, invented_back=bool(spec["invented_back"])),
        "invented_back": bool(spec["invented_back"]),
        "cost": lib.cost_record("stage1b_dress", gpu=CFG["gpu_dress"], region=CFG["region"], gpu_seconds=time.time() - t_start),
        "label": lib.STAGE1B_LABEL,
    }
    with open(f"{out}/record.json", "w") as f:
        json.dump(record, f, indent=2)
    pm.jobs.commit()
    return record


def run_local(job_dir: str, *, engine: str, steps: int, seed: int | None, composite: bool, accept_failed: bool, category: str, force_upload: bool) -> dict:
    """Upload, weights, dress, download; shared by this entrypoint and run_phase0.py --dress."""
    m = pm.load_local_job(job_dir)
    lib.stage1b_plan(m)
    job_id = m["job_id"]
    pm.upload_job(job_dir, job_id, force=force_upload)
    print("[stage1b] weights:", download_dress_weights.remote([engine]))
    t = time.time()
    record = dress.remote(job_id, engine=engine, steps=steps, seed=seed, composite=composite, accept_failed=accept_failed, category=category)
    record["cost"] = lib.cost_record("stage1b_dress", gpu=CFG["gpu_dress"], region=CFG["region"], gpu_seconds=record["cost"]["gpu_seconds"], wall_seconds=time.time() - t)
    pm.download_dir(job_dir, job_id, lib.STAGE1B_DIR)
    os.makedirs(os.path.join(job_dir, lib.STAGE1B_DIR), exist_ok=True)
    with open(os.path.join(job_dir, lib.STAGE1B_DIR, "record.local.json"), "w") as f:
        json.dump(record, f, indent=2)
    s = record["summary"]
    for v in record["views"]:
        q = v.get("qa", {})
        print(f"[stage1b] {v['view']}{' (INVENTED)' if v.get('invented') else ''}: pass={q.get('pass')} inside={q.get('inside_fraction')} silhouette_iou={q.get('silhouette_iou')} cover={q.get('cover_fraction')} mae={q.get('mannequin_mae_8bit')} mask={v.get('mask_source')} {q.get('failures', [])}")
    for w in s["warnings"]:
        print(f"[stage1b] WARNING: {w}")
    print(f"[stage1b] usable for stage 2: {s['usable_for_stage2']}" + ("" if s["usable_for_stage2"] else " (failed views: " + ", ".join(s["failed_views"]) + "; see stage1b/rejected/)"))
    return record


@app.local_entrypoint()
def main(job_dir: str, engine: str = "fashn", steps: int = 0, seed: int = -1, no_composite: bool = False, accept_failed: bool = False, category: str = "", download_only: bool = False, force_upload: bool = False):
    if download_only:
        m = pm.load_local_job(job_dir)
        pm.download_dir(job_dir, m["job_id"], lib.STAGE1B_DIR)
        return
    record = run_local(job_dir, engine=engine, steps=steps, seed=None if seed < 0 else seed, composite=not no_composite, accept_failed=accept_failed, category=category, force_upload=force_upload)
    print(lib.format_cost_table([record["cost"]]))
