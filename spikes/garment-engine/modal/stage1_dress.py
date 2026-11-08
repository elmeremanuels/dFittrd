"""Phase 0 stage 1b on Modal: dress OUR mannequin from a shop photo (docs/research/garment-engine.md, "Stage 1b").

Stage 2 pins a front and a back still of the garment on our canonical mannequin at frames 0 and N/2 of
the turntable. A shop photo shows the garment on a person (or flat-lay), not on our mannequin. For a job
exported with `--on-model` or `--flat-lay` (src/exportCli.ts, export 0.4.0 or later) this app produces those
two stills.

After run 12 (FASHN maskless on the BARE mannequin drew the Azure Palm babydoll dress as a romper over the
two legs, and the "back" as a front) the engine dresses the PROXY-DRESSED mannequin instead:

  1. segment the garment in each shop photo: Grounding DINO box from a category prompt -> SAM 2.1 mask
     (both Apache-2.0); the mask and a cut-out on studio grey are kept for the record. The back view uses
     the BACK photo when there is one
  2. target = dress/proxy_<view>.png: our mannequin wearing the control proxy (one closed volume for a dress)
     in a flat beige, rendered by the exporter at the camera of frame 0 or N/2. Edit region = the proxy plus a
     sleeve band on the arms, dilated by a category margin, never the head (phase0_dress.edit_region)
  3. dress the target with one engine, or both (`--engine both`: each view by both, the still that passes QA
     with the best score is pinned, both are recorded under `candidates`):
       fashn  FASHN VTON v1.5 (Apache-2.0), category dress -> one-pieces, MASKED mode: its person label map is
              ours (edit region = the category's garment label, the rest of the mannequin kept), so it
              repaints the proxy region only and fills a dress volume, not two legs. Its packaged human
              parser (NVIDIA SegFormer licence, non-commercial) is NOT installed
       qwen   Qwen-Image-Edit-2511 (Apache-2.0): picture 1 = the proxy-dressed render, picture 2 = the SAM 2
              cut-out of the shop photo, instruction built from the manifest's neutral description and the
              colour measured on the cut-out (lib.qwen_dress_prompt: "dress the mannequin in this exact garment:
              <description>; colours: <phrase>, as in picture 2", "back view" for the back camera; never the
              product title, the brand or a colour word of the product name)
  4. without a back photo the back is GENERATED (fashn: the front photo onto the back target; qwen: the
     dressed front still as picture 2) and marked `invented: true` in every record (D13: validation only)
  5. garment mask on each generated still: difference to the proxy-dressed target inside the edit region,
     refined by SAM 2, clipped to the region for the composite; the same mask NOT clipped is kept for the QA
     (inside fraction and cut share: a sleeve past the region fails); QA v2 (phase0_dress.still_qa): silhouette tolerance band against the proxy-dressed silhouette,
     garment against the proxy, leg gap and skirt cover below the crotch for a dress or skirt, mannequin
     outside the edit region against our render, placeholder left-overs; for the back also
     phase0_dress.back_view_checks against the chosen front still and the shop photos; print fidelity
     (phase0_dress.print_fidelity: Lab palette and edge density against the shop photo's garment). Selection
     (phase0_dress.pick_engine, stage1b-qa-0.4.0): pass every hard check -> highest print fidelity -> highest
     silhouette-band score; a candidate that fails print fidelity is never picked (only a front still that
     passed QA, or with --accept-failed, serves as the back's reference). The v1 numbers
     against the bare mannequin are kept as `qa_v1_vs_bare`. The pinned still is our BARE render with only
     the garment pixels pasted in: the placeholder never appears, and where the garment leaves the proxy
     region uncovered the bare mannequin shows
  6. outputs in the job dir (Volume curtain-phase0-jobs):
       stage1b/front.png, stage1b/back.png            the pinned stills, written ONLY when QA passes
                                                     (or with --accept-failed, which the record says)
       stage1b/garment_mask_<view>.png               0/255, the chosen engine's (clipped to the edit region)
       stage1b/garment_mask_unclipped_<view>.png     the same garment not clipped to the region (QA)
       stage1b/edit_region_<view>.png                what the engines were allowed to change
       stage1b/raw/<view>.png, raw/<view>_<engine>.png  model outputs resized to the frame, uncomposited
       stage1b/candidates/<view>_<engine>_garment_mask.png, _garment_mask_unclipped.png
      stage1b/candidates/<view>_<engine>_conformed.png   the raw output with a skirt's or dress's hips widened to the proxy
                                                    (dq.conform_to_proxy) and the garment's outer edge stretched over our
                                                    body where the engine drew background (dq.conform_edges, 0.10.0);
                                                    raw/<view>.png is this one when it exists
       stage1b/candidates/<view>_<engine>_chosen_mask.png  the mask the composite starts from (0.10.0): replays are exact
       stage1b/record.before_recompose.json         after `recompose` (CPU, 0.10.0): this run's own record; record.json then
                                                    holds the stills re-made from the saved raw outputs (no engine run)
       stage1b/candidates/<view>_fashn_agnostic.png  the clothing-agnostic image FASHN saw (its grey inpaint area)
       stage1b/rejected/<view>.png                   a still that failed QA
       stage1b/source/<view>_mask.png, _cutout.png   the shop-photo segmentation
       stage1b/record.json                           pins, parameters, per view the candidates, the selection,
                                                     QA v2 and v1, back-view checks, summary, cost estimate

Run (from the repo root, after `pnpm --filter @curtain/garment-spike export:phase0 -- --product <id> --on-model --front … [--back …]`):
  modal run spikes/garment-engine/modal/stage1_dress.py --job-dir spikes/garment-engine/out/phase0/<id> [--engine fashn|qwen|both]
Options: --engine fashn|qwen|both (default fashn)  --steps N (default per engine: fashn 30, qwen 40)  --seed N (default: the
         manifest's video seed)  --no-composite  --accept-failed  --category one-pieces|tops|bottoms
         --download-only  --force-upload
         --draws "front=fashn@44-47,qwen@43;back=keep:fashn,qwen@43" (stage1b-qa-0.11.0, run 17a; not with --engine / --seed):
         a draw plan (phase0_lib.parse_draw_plan). `prepare` (CPU) archives the earlier stage1b/ into stage1b/history/<utc>/ and
         copies the kept candidate from it; `dress` (GPU) draws every engine@seed of the plan in one container and saves each
         as <view>_<engine>_s<seed>; `finalize` (CPU, phase0_dress.finalize_draws) scores every candidate with the replay code,
         picks the front/back pair whose pair checks pass (phase0_dress.pick_pair) and writes the stills and the record with
         every pair. Every run (with or without a plan) first moves the earlier stage1b/ into stage1b/history/.

Environment: CURTAIN_MODAL_GPU_DRESS (default H100; `both` and `qwen` need it), CURTAIN_MODAL_REGION,
CURTAIN_MODAL_TIMEOUT_DRESS (s, default 3600), CURTAIN_MODAL_MEMORY_DRESS_MB (default 65536), CURTAIN_QWEN_CPU_OFFLOAD (0/1).
Every output is a GENERATED estimate (AGENTS.md rule 3) and every cost is an ESTIMATE.

TESTED ON A GPU: run 12 ran the earlier version (FASHN maskless on the bare mannequin) on an H100. NOT TESTED:
this version (proxy-dressed target, FASHN masked mode, the Qwen engine, --engine both, QA v2 inside the app).
The QA v2 functions ran on CPU on run 12's real stills (README, "Stage 1b after run 12"); the pure parts are
tested by tests/test_stage1_dress.py and tests/test_stage1b_qa.py.
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
ENGINE_WEIGHTS = {"fashn": ("detector", "segmenter", "fashn"), "qwen": ("detector", "segmenter", "qwen"), "both": ("detector", "segmenter", "fashn", "qwen")}

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
    .add_local_python_source("phase0_lib", "phase0_modal", "phase0_garment", "phase0_dress")
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
    keys = sorted({k for e in engines for k in ENGINE_WEIGHTS[e]})  # engines may hold "both"
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
def dress(job_id: str, engine: str = "fashn", steps: int = 0, seed: int | None = None, composite: bool = True, accept_failed: bool = False, category: str = "",
          plan: dict | None = None, prepared: dict | None = None) -> dict:
    """One stage 1b run on the GPU. Without `plan`: each view by `engine` (one draw per engine at `seed`), selection and stills here.
    With `plan` (lib.parse_draw_plan, stage1b-qa-0.11.0): every draw of the plan per view in this one container (the models load
    once), each saved as candidate `<view>_<engine>_s<seed>` with its chosen, garment and unclipped masks; no QA and no stills
    here: `finalize` (CPU) scores every candidate, picks the pair and writes the stills. `prepared` is what `prepare` (CPU, before
    this) did: the earlier stage1b/ archived and the kept candidates imported."""
    import subprocess

    import numpy as np
    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor, Sam2Model, Sam2Processor

    import phase0_dress as dq

    if plan is not None:
        engine = lib.draw_plan_engines(plan)
    engines = lib.dress_engines(engine)
    t_start = time.time()
    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    views = lib.stage1b_plan(m)
    spec = m["stage1b"]
    out = f"{job}/{lib.STAGE1B_DIR}"
    if plan is not None:
        if spec["invented_back"]:
            raise RuntimeError("a draw plan needs a back photo (an invented back is drawn from the picked front still)")
        if prepared is None:
            raise RuntimeError("a draw plan runs after `prepare` (archive and keeps); call run_local")
        for view, kc in (prepared.get("kept") or {}).items():
            missing = [f for f in kc["kept"]["files"] if not os.path.exists(os.path.join(out, f))]
            if missing:
                raise RuntimeError(f"kept {view} candidate {kc['id']}: files missing in the Volume ({missing})")
            # a kept engine@seed is named like a draw: the plan must not draw it again (it would overwrite the kept files)
            if any(lib.candidate_id(e, sd) == kc["id"] for e, sd in plan[view]["draws"]):
                raise RuntimeError(f"the plan draws {kc['id']} for the {view} and keeps the earlier run's {kc['id']}: drop one")
        archived = prepared.get("archived")
    else:
        # stage1b-qa-0.11.0: a new run starts clean; the earlier run moves to stage1b/history/<utc>/ (no stale candidates)
        archived = dq.archive_stage1b(out, time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    for key in ENGINE_WEIGHTS[engine]:
        if not os.path.exists(os.path.join(weights_dir(key), ".complete.json")):
            raise RuntimeError(f"weights for {key} not in the Volume yet: run download_dress_weights first (this app's entrypoint does)")
    tryon_cat = category or lib.tryon_category(m["category"])
    if tryon_cat not in lib.GARMENT_PROMPT:
        raise ValueError(f"category {tryon_cat!r}: use one of {', '.join(lib.GARMENT_PROMPT)}")
    kind = spec["target"]["proxy_kind"]
    steps_for = {e: (steps or ENGINE_STEPS[e]) for e in engines}
    seed = int(m["seeds"]["video"]) if seed is None else int(seed)
    W, H = int(m["camera"]["width"]), int(m["camera"]["height"])
    bg = tuple(spec["background_rgb"])
    v1_margin = lib.align_margin_px(tryon_cat, H)
    for sub in ("", "raw", "rejected", "source", "candidates"):
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

    # Engines (both stay loaded with --engine both: about 8 + 58 GB in bf16 on an 80 GB H100).
    fashn_pipe = qwen_pipe = parser = None
    poses: list[dict] = []
    agnostic: list = []  # FASHN's clothing-agnostic person images, one per call
    if "fashn" in engines:
        _install_parser_stand_in()
        sys.path.insert(0, os.path.join(FASHN_CODE_DIR, "src"))
        from fashn_vton import TryOnPipeline

        parser = _MaskParser()

        class _Pipeline(TryOnPipeline):
            def _setup_hp_model(self):
                self.hp_model = parser

        fashn_pipe = _Pipeline(weights_dir=weights_dir("fashn"))
        detect_pose = fashn_pipe.pose_model
        # Record the clothing-agnostic image FASHN actually sees (pipeline.py imports the function by name). Its
        # inpaint area is wider than our edit region: the hybrid contour/bounding-box mask, dilated about 33 px
        # left/right and 16 px up/down at 864 px, background included; only the composite is held to the region.
        import fashn_vton.pipeline as fashn_pipeline_mod

        make_agnostic = fashn_pipeline_mod.create_clothing_agnostic_image

        def recording_agnostic(*a, **k):
            ca = make_agnostic(*a, **k)
            agnostic.append(np.asarray(ca).copy())
            return ca

        fashn_pipeline_mod.create_clothing_agnostic_image = recording_agnostic

        def recording_pose(img):
            pose = detect_pose(img)
            subset = pose["bodies"]["subset"]
            poses.append({"body_keypoints_visible": int((subset >= 0).sum()), "of": int(subset.size)})
            return pose

        fashn_pipe.pose_model = recording_pose
    if "qwen" in engines:
        from diffusers import QwenImageEditPlusPipeline

        qwen_pipe = QwenImageEditPlusPipeline.from_pretrained(weights_dir("qwen"), torch_dtype=torch.bfloat16)
        if CFG["qwen_cpu_offload"]:
            qwen_pipe.enable_model_cpu_offload()
        else:
            qwen_pipe.to(dev)
        qwen_pipe.set_progress_bar_config(disable=True)
    load_s = time.time() - t0

    def load_rgb(rel: str) -> Image.Image:
        img = Image.open(os.path.join(job, rel)).convert("RGB")
        s = SOURCE_MAX_SIDE / max(img.size)
        return img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS) if s < 1 else img

    def read_mask(rel: str) -> np.ndarray:
        return np.asarray(Image.open(os.path.join(job, rel)).convert("L")) > 127

    def save_mask(arr: np.ndarray, rel: str) -> str:
        Image.fromarray((np.asarray(arr) > 0).astype(np.uint8) * 255).save(os.path.join(job, rel))
        return rel

    def run_engine(eng: str, name: str, invented: bool, target: Image.Image, labels: np.ndarray, s: dict, front_pick: dict | None, seed: int, stem: str,
                   colour: dict | None) -> tuple[Image.Image, dict]:
        """One engine on one view at `seed`: the generated image (model size) and what it was given."""
        meta: dict = {"steps": steps_for[eng], "seed": seed, "target": "proxy-dressed render"}
        if eng == "fashn":
            n_pose, n_agn = len(poses), len(agnostic)
            garment_labels = np.frombuffer(bytes(lib.fashn_label_map(s["mask"].astype(np.uint8).tobytes(), tryon_cat, kind)), np.uint8).reshape(s["mask"].shape)
            parser.queue = [labels, garment_labels]
            result = fashn_pipe(
                person_image=target,
                garment_image=s["image"],
                category=tryon_cat,
                garment_photo_type="flat-lay" if spec["source_kind"] == "flat_lay" else "model",
                num_timesteps=steps_for[eng],
                seed=seed,
                segmentation_free=False,  # masked: only the edit region (our label map) is repainted
            )
            meta["method"] = "fashn (masked, edit region = proxy + margin): shop photo onto our proxy-dressed render" + (" (FRONT photo onto the BACK view: invented back)" if invented else "")
            meta["pose"] = {"mannequin": poses[n_pose] if len(poses) > n_pose else None, "garment_photo": poses[n_pose + 1] if len(poses) > n_pose + 1 else None}
            if len(agnostic) > n_agn:
                ca = agnostic[n_agn]
                rel = f"{lib.STAGE1B_DIR}/candidates/{stem}_fashn_agnostic.png"
                Image.fromarray(ca.astype(np.uint8)).save(os.path.join(job, rel))
                grey = (ca == 127).all(axis=2)
                meta["agnostic"] = {"image": rel, "size": [int(ca.shape[1]), int(ca.shape[0])], "fill_127_px": int(grey.sum())}
                if ca.shape[:2] == region.shape:
                    meta["agnostic"]["fill_outside_edit_region_px"] = int((grey & ~region).sum())
            return result.images[0], meta
        if invented:
            if front_pick is None:
                raise RuntimeError(f"the invented back needs a front still that passed QA ({front_note or 'no front still'}); --accept-failed overrides")
            pictures = [target, front_pick["final"]]
            meta["method"] = "qwen: invented back from the dressed front still (no back photo)"
        else:
            pictures = [target, s["cutout"]]
            meta["method"] = f"qwen: SAM 2 garment cut-out of the {'back' if name == 'back' else 'front'} shop photo onto our proxy-dressed render"
        # The colour words come from the garment cut-outs' pixels (dq.garment_colour), never from the product name; one phrase for
        # both views when the two cut-outs are one colour (lib.view_colour_phrases, qwen-dress-prompt-0.2.0).
        prompt, negative = lib.qwen_dress_prompt(m, name, invented, colour=colour)
        # The canvas is the size the pipeline VAE-encodes picture 1 at (multiples of 32), so output and picture-1
        # latents share one token grid; the pipeline's default would follow image[-1], the garment cut-out.
        cw, ch = lib.qwen_canvas(W, H)
        from diffusers.pipelines.qwenimage import pipeline_qwenimage_edit_plus as qwen_mod

        p1 = tuple(int(x) for x in qwen_mod.calculate_dimensions(qwen_mod.VAE_IMAGE_SIZE, target.width / target.height))
        if p1 != (cw, ch):
            raise RuntimeError(f"Qwen canvas {(cw, ch)} differs from the size the pipeline encodes picture 1 at {p1}")
        with torch.inference_mode():
            gen = qwen_pipe(
                image=pictures,
                prompt=prompt,
                negative_prompt=negative,
                true_cfg_scale=4.0,
                guidance_scale=1.0,
                num_inference_steps=steps_for[eng],
                height=ch,
                width=cw,
                generator=torch.Generator(device="cpu").manual_seed(seed),
            ).images[0]
        meta.update({"prompt": prompt, "negative_prompt": negative, "prompt_version": lib.QWEN_PROMPT_VERSION, "canvas": [cw, ch], "picture1_vae_size": list(p1)})
        return gen, meta

    sources: dict[str, dict] = {}
    colour_phrases: dict[str, dict] = {}

    def segment(src_view: str) -> None:
        """Garment box (Grounding DINO) and mask (SAM 2) of the shop photo for `src_view`, once; the cut-out and its colour."""
        if src_view in sources:
            return
        src_rel = next(x["source"] for x in views if x["view"] == src_view and x["source"]) if src_view == "back" else next(x["source"] for x in views if x["view"] == "front")
        src = load_rgb(src_rel)
        box, det_score, label = detect(src)
        if box is None:
            raise RuntimeError(f"no {lib.GARMENT_PROMPT[tryon_cat]!r} found in {src_rel}")
        smask_sam, sam_score = sam_mask(src, box)
        # Holes in SAM 2's mask become FASHN's grey 127 in its garment image, drawn as grey cloth (run 15).
        smask, mask_cleanup = dq.clean_source_mask(smask_sam)
        arr = np.asarray(src).copy()
        arr[~smask] = bg
        y0, y1 = np.where(smask.any(axis=1))[0][[0, -1]]
        x0, x1 = np.where(smask.any(axis=0))[0][[0, -1]]
        pad = int(0.04 * max(src.size))
        cut = Image.fromarray(arr).crop((max(0, x0 - pad), max(0, y0 - pad), min(src.width, x1 + 1 + pad), min(src.height, y1 + 1 + pad)))
        cut.save(os.path.join(job, f"{lib.STAGE1B_DIR}/source/{src_view}_cutout.png"))
        colour = dq.garment_colour(np.asarray(src), smask)
        sources[src_view] = {
            "image": src,
            "mask": smask,
            "cutout": cut,
            "colour": colour,
            "record": {
                "photo": src_rel,
                "size": list(src.size),
                "box": [round(x, 1) for x in box],
                "detector_score": round(det_score, 3),
                "detector_label": label,
                "sam_score": round(sam_score, 3),
                "garment_px": int(smask.sum()),
                "sam_px": int(smask_sam.sum()),
                "mask_cleanup": mask_cleanup,
                "mask": save_mask(smask, f"{lib.STAGE1B_DIR}/source/{src_view}_mask.png"),
                "cutout": f"{lib.STAGE1B_DIR}/source/{src_view}_cutout.png",
                "colour": colour,
            },
        }

    view_records: list[dict] = []
    front_pick: dict | None = None
    front_note: str | None = None
    front_engine: str | None = None
    shown_arrays: dict[str, tuple] = {}
    for v in views:
        t1 = time.time()
        name = v["view"]
        rec: dict = {"view": name, "frame": v["frame"], "invented": v["invented"], "source": v["source"], "engines": engines, "target": v["proxy_rgb"]}
        pick: dict | None = None
        try:
            bare = Image.open(os.path.join(job, v["bare_rgb"])).convert("RGB")
            target = Image.open(os.path.join(job, v["proxy_rgb"])).convert("RGB")
            for img, rel in ((bare, v["bare_rgb"]), (target, v["proxy_rgb"])):
                if img.size != (W, H):
                    raise RuntimeError(f"{rel} is {img.size}, expected {(W, H)}")
            bare_mask = read_mask(v["bare_mask"])
            proxy = read_mask(v["proxy_mask"])
            # Trousers: a gap kept open between the proxy's legs (out of the region, painted as our bare render in the
            # engine's input, visible in FASHN's agnostic image); the QA compares with the proxy minus that gap.
            crotch_gap = dq.trouser_gap_zone(proxy, bare_mask) if kind == "trousers" else None
            region, region_rec = dq.edit_region(proxy, bare_mask, tryon_cat, keep_open=kind == "outerwear", open_crotch=crotch_gap)
            proxy_q = dq.qa_proxy(proxy, crotch_gap)
            if crotch_gap is not None:
                target = Image.fromarray(dq.engine_target(np.asarray(target), np.asarray(bare), crotch_gap))
            rec["edit_region"] = {**region_rec, "mask": save_mask(region, f"{lib.STAGE1B_DIR}/edit_region_{name}.png")}
            # FASHN fills its inpaint area with grey 127, close to our mannequin's own grey: the record says how close.
            rec["mannequin_grey"] = dq.grey_collision(np.asarray(bare), bare_mask)
            person_labels = dq.fashn_person_labels(region, bare_mask, proxy, lib.FASHN_LABEL_IDS, lib.fashn_garment_label(tryon_cat, kind), keep_visible=crotch_gap)

            # 1. The shop photo for this view: garment box and mask (the back photo for the back; the front photo for an invented
            #    back). With a back photo both are segmented before the first draw: one colour phrase may name both (Qwen).
            src_view = name if v["source"] else "front"
            segment(src_view)
            if not spec["invented_back"] and "qwen" in engines and not colour_phrases:
                for role in ("front", "back"):
                    segment(role)
                colour_phrases.update(lib.view_colour_phrases({role: sources[role]["colour"] for role in ("front", "back")}))
            s = sources[src_view]
            rec["source_segmentation"] = s["record"]
            qwen_colour = s.get("colour")
            if name in colour_phrases and qwen_colour is not None:
                qwen_colour = {**qwen_colour, "phrase": colour_phrases[name]["phrase"]}
                rec["colour_phrase"] = colour_phrases[name]

            # 2. Each engine dresses our proxy-dressed render; 3. garment mask, QA v2 (and the v1 numbers against
            #    the bare mannequin, for comparison), back-view checks.
            bare_np, target_np = np.asarray(bare), np.asarray(target)
            candidates: list[dict] = []
            # without a plan: one draw per engine at `seed`, named by the engine (front_fashn); with a plan: each engine@seed
            # of the view (front_fashn_s44), plus the candidate kept from the earlier run (`prepare`: already in stage1b/)
            draws = [(e, int(sd)) for e, sd in plan[name]["draws"]] if plan is not None else [(e, seed) for e in engines]
            for eng, sd in draws:
                cand_id = lib.candidate_id(eng, sd if plan is not None else None)
                stem = lib.candidate_stem(name, cand_id)
                c: dict = {"id": cand_id, "engine": eng}
                tc = time.time()
                try:
                    gen, meta = run_engine(eng, name, v["invented"], target, person_labels, s, front_pick, sd, stem, qwen_colour)
                    if eng == "qwen" and rec.get("colour_phrase"):
                        meta["colour_phrase"] = rec["colour_phrase"]
                    c.update(meta)
                    c["model_output_size"] = list(gen.size)
                    gen = gen.convert("RGB").resize((W, H), Image.LANCZOS)
                    raw_rel = f"{lib.STAGE1B_DIR}/raw/{stem}.png"
                    gen.save(os.path.join(job, raw_rel))
                    c["raw"] = raw_rel
                    gen_np = np.asarray(gen)
                    prior = dq.garment_prior(gen_np, target_np, region, bg)
                    refined = rmask = None
                    if prior.any():
                        ys, xs = np.nonzero(prior)
                        p4 = 4
                        rmask, rscore = sam_mask(gen, [max(0, int(xs.min()) - p4), max(0, int(ys.min()) - p4), min(W, int(xs.max()) + 1 + p4), min(H, int(ys.max()) + 1 + p4)])
                        refined = (rmask & region).astype(np.uint8).tobytes()
                        c["sam_score"] = round(rscore, 3)
                    gb, mask_source, agree = lib.choose_garment_mask(prior.astype(np.uint8).tobytes(), refined)
                    chosen_mask = np.frombuffer(bytes(gb), np.uint8).reshape(H, W).astype(bool) & region
                    # stage1b-qa-0.10.0: the chosen mask is saved, so a later replay (`rescore_job`, `recompose_job`) rebuilds
                    # the app path exactly.
                    c["chosen_mask"] = save_mask(chosen_mask, f"{lib.STAGE1B_DIR}/candidates/{stem}_chosen_mask.png")
                    # The composite (dq.compose_candidate, shared with the replay): the chosen mask plus what is not our grey
                    # mannequin (run 15's blouse; off our body, inside the proxy, every non-background piece since 0.10.0:
                    # run 16a's palazzo holes), the hips of a skirt or dress widened to the proxy (run 15's skirt; trousers no
                    # longer: run 16a's shelf), the garment's outer edge stretched over our body where the engine drew
                    # background (run 16a's grey shoulder caps), and the QA inputs `unpasted` (a notch or hole) and `edges`
                    # (our body still beside the cloth). The raw output above stays as drawn.
                    conf_np, garment, comp = dq.compose_candidate(gen_np, chosen_mask, bare_mask, bare_np, proxy_q, region, bg, kind=kind, gap=crotch_gap)
                    c["composite_mask"], c["conform"], c["conform_edges"] = comp["composite_mask"], comp["conform"], comp["conform_edges"]
                    c["gap_mannequin"] = comp["gap_mannequin"]
                    unpasted, edges = comp["unpasted"], comp["edges"]
                    if c["conform"]["applied"] or c["conform_edges"]["applied"]:
                        gen_np = conf_np
                        gen = Image.fromarray(conf_np)
                        conf_rel = f"{lib.STAGE1B_DIR}/candidates/{stem}_conformed.png"
                        gen.save(os.path.join(job, conf_rel))
                        c["conformed"] = conf_rel
                    # The same garment NOT clipped to the region: QA's inside fraction and cut share are measured on
                    # it (on `garment` they are 1.0 and 0 by construction), so a sleeve the composite would chop fails.
                    garment_full = dq.unclipped_garment(gen_np, target_np, region, bg, ring_px=region_rec["sleeve_band_px"] or region_rec["margin_px"],
                                                        refined=rmask if mask_source == "sam2" else None) | garment
                    c.update({"mask_source": mask_source, "sam_prior_iou": None if agree is None else round(agree, 4)})
                    if plan is not None:
                        # a draw plan: no QA here; `finalize` (CPU) scores every candidate from these files, as a replay does
                        c["qa"] = {"pass": None, "failures": [], "note": "scored by finalize"}
                    else:
                        fg_b = lib.keep_large_components(lib.mask_not(lib.background_mask(gen_np.tobytes(), W, H, bg, 10)), W, H, 0.02)
                        fg = np.frombuffer(bytes(fg_b), np.uint8).reshape(H, W).astype(bool)
                        keep = bare_mask & ~region
                        mae = float(np.abs(gen_np.astype(np.int16) - bare_np.astype(np.int16))[keep].mean()) if keep.any() else None
                        residue = dq.proxy_residue(gen_np, target_np, proxy_q, garment)
                        # Print fidelity: the candidate's garment against the shop photo's (palette and print); a failure is never picked.
                        fid = dq.print_fidelity(gen_np, garment, np.asarray(s["image"]), s["mask"]) if garment.any() else None
                        # Left and right against the shop photo of the same view (0.10.0: run 16a's cardigan back, sleeves swapped).
                        side = dq.side_colour(gen_np, garment, np.asarray(s["image"]), s["mask"]) if (garment.any() and not v["invented"]) else None
                        qa = dq.still_qa(garment, fg, bare_mask, proxy_q, region, kind=kind, mannequin_mae=mae, residue=residue, garment_full=garment_full,
                                         sleeve_band_px=region_rec["sleeve_band_px"], fidelity=fid, rgb=gen_np, bare_rgb=bare_np, unpasted=unpasted,
                                         edges=edges, side=side, gap_body=comp["gap_mannequin"])
                        c["candidate_colour"] = dq.garment_colour(gen_np, garment)
                        g_b = garment.astype(np.uint8).tobytes()
                        v1 = lib.alignment_qa(g_b, fg_b, bare_mask.astype(np.uint8).tobytes(), W, H, v1_margin,
                                              mannequin_mae=lib.mean_abs_diff(gen_np.tobytes(), bare_np.tobytes(), lib.mask_andnot(bare_mask.astype(np.uint8).tobytes(), g_b)))
                        c["qa_v1_vs_bare"] = {k: v1[k] for k in ("inside_fraction", "silhouette_iou", "cover_fraction", "mannequin_mae_8bit", "pass", "failures")}
                        if name == "back":
                            if v["invented"]:
                                c["back_view"] = {"pass": None, "note": "invented back: no back photo to compare with"}
                            elif front_pick is None or "front" not in sources:
                                c["back_view"] = {"pass": None, "note": f"back-view checks not run: {front_note or 'no front still'}"}
                            else:
                                bvc = dq.back_view_checks(front_pick["gen"], front_pick["garment"], gen_np, garment,
                                                          np.asarray(sources["front"]["image"]), sources["front"]["mask"], np.asarray(s["image"]), s["mask"])
                                c["back_view"] = bvc
                                if not bvc["pass"]:
                                    qa["failures"] = qa["failures"] + [f"back view: {f}" for f in bvc["failures"]]
                                    qa["pass"] = False
                        qa["score"] = dq.qa_score(qa)
                        c["qa"] = qa
                    c["garment_mask"] = save_mask(garment, f"{lib.STAGE1B_DIR}/candidates/{stem}_garment_mask.png")
                    c["garment_mask_unclipped"] = save_mask(garment_full, f"{lib.STAGE1B_DIR}/candidates/{stem}_garment_mask_unclipped.png")
                    c["_arrays"] = {"gen": gen, "gen_np": gen_np, "garment": garment, "garment_full": garment_full}
                except Exception as e:  # noqa: BLE001 - record the failure, keep the other engine
                    c["error"] = f"{type(e).__name__}: {e}"
                    c["qa"] = {"pass": False, "failures": [c["error"]]}
                c["seconds"] = round(time.time() - tc, 1)
                candidates.append(c)
                if plan is not None:
                    print(f"[stage1b] {name} / {cand_id}: {'drawn' if 'error' not in c else c['error']} in {c['seconds']} s")
                    pm.jobs.commit()  # each paid draw reaches the Volume now: a later timeout or OOM does not lose it (--download-only fetches it)
                else:
                    print(f"[stage1b] {name} / {eng}: QA {'pass' if c['qa'].get('pass') else 'FAIL'} score {c['qa'].get('score')} {c['qa'].get('failures', [])}")

            if plan is not None:
                kept = (prepared.get("kept") or {}).get(name)
                rec["candidates"] = ([kept] if kept else []) + [{k: val for k, val in c.items() if k != "_arrays"} for c in candidates]
                rec["qa"] = {"pass": False, "failures": ["not finalized: a draw plan's candidates are scored and paired by finalize"], "type_failures": []}
                if not any("error" not in c for c in rec["candidates"]):
                    raise RuntimeError("; ".join(c.get("error", "") for c in candidates))
            else:
                # The back takes the front's engine when it passes and its fidelity is within dq.SAME_ENGINE_MARGIN (0.10.0).
                decision = dq.pick_engine(candidates, prefer=front_engine if name == "back" else None)
                rec["selection"] = decision
                rec["candidates"] = [{k: val for k, val in c.items() if k != "_arrays"} for c in candidates]
                # `engine` is the candidate the view shows (pinned when it passed); when every candidate failed print fidelity
                # none is picked and the highest fidelity is only kept as the rejected still.
                shown = dq.shown_candidate(decision)
                chosen = next((c for c in candidates if c["id"] == shown), None)
                if chosen is None:
                    raise RuntimeError("; ".join(c.get("error", "") for c in candidates))
                arr = chosen["_arrays"]
                shown_arrays[name] = (arr["gen_np"], arr["garment"])
                if name == "front":
                    front_engine = chosen["engine"]
                rec["candidate"] = shown
                rec.update({k: chosen.get(k) for k in ("engine", "method", "prompt", "pose", "mask_source", "sam_prior_iou", "qa", "qa_v1_vs_bare", "back_view", "model_output_size")})
                raw_rel = f"{lib.STAGE1B_DIR}/raw/{name}.png"
                arr["gen"].save(os.path.join(job, raw_rel))
                rec["raw"] = raw_rel
                rec["garment_mask"] = save_mask(arr["garment"], v["garment_mask"])
                rec["garment_mask_unclipped"] = save_mask(arr["garment_full"], f"{lib.STAGE1B_DIR}/garment_mask_unclipped_{name}.png")
                # 4. The pinned still: our BARE render, with the garment pasted in (the garment lies in the edit region).
                #    Where the proxy is not covered by the garment, our bare mannequin shows: the placeholder never does.
                final = Image.frombytes("RGB", (W, H), bytes(lib.composite(bare.tobytes(), arr["gen"].tobytes(), arr["garment"].astype(np.uint8).tobytes()))) if composite else arr["gen"]
                rec["composited"] = composite
                qa = chosen["qa"]
                if qa["pass"] or accept_failed:
                    final.save(os.path.join(job, v["still"]))
                    rec["still"] = v["still"]
                    rec["still_sha256"] = _sha256(os.path.join(job, v["still"]))
                    # the decoded pixels' hash (0.11.0): run_phase0 --reuse-dress --dress-expect can pin a still of this run
                    rec["still_pixel_sha256"] = lib.pixel_sha256(np.asarray(final.convert("RGB")).tobytes(), W, H)
                    rec["qa_overridden"] = not qa["pass"]
                else:
                    rejected = f"{lib.STAGE1B_DIR}/rejected/{name}.png"
                    final.save(os.path.join(job, rejected))
                    rec["still"] = None
                    rec["rejected"] = rejected
                # The front still is the back's reference (Qwen's invented back, the back-view checks) only when it
                # passed QA or the operator accepted failed stills.
                usable, why_not = dq.front_reference(qa, accept_failed)
                pick = {"final": final, "gen": arr["gen_np"], "garment": arr["garment"]} if usable else None
                if name == "front" and why_not:
                    rec["not_back_reference"] = why_not
        except Exception as e:  # noqa: BLE001 - record the failure, keep the other view
            rec["error"] = f"{type(e).__name__}: {e}"
            rec["qa"] = {"pass": False, "failures": [rec["error"]]}
        if name == "front":
            front_pick = pick
            front_note = rec.get("not_back_reference") or (f"front still failed: {rec['error']}" if "error" in rec else None)
        rec["seconds"] = round(time.time() - t1, 1)
        if v["invented"]:
            rec["label"] = lib.INVENTED_BACK_LABEL
        view_records.append(rec)
        print(f"[stage1b] {name}: {rec.get('engine') or 'no engine'} picked ({(rec.get('selection') or {}).get('reason')}); QA {'pass' if rec['qa'].get('pass') else 'FAIL'} {rec['qa'].get('failures', [])}")

    # Front and back of the same garment (stage1b-qa-0.7.0): length and sleeves of the two shown stills. A failure is a
    # TYPE failure on the back (never overridden by --accept-failed-dress; run_phase0 stops before stage 2).
    by_view = {r["view"]: r for r in view_records if plan is None}  # a draw plan's pair checks run in finalize
    agreement = dq.view_agreement(((by_view.get("front") or {}).get("qa") or {}).get("garment_body"),
                                  ((by_view.get("back") or {}).get("qa") or {}).get("garment_body"))
    if "back" in by_view:
        by_view["back"]["view_agreement"] = agreement
        dq.apply_view_agreement(by_view["back"].get("qa"), agreement)
        if agreement.get("failures"):
            print(f"[stage1b] front and back disagree (type failure): {agreement['failures']}")
        # Colour of the two shown stills against the shop photos' own front/back difference (0.10.0; not a type failure).
        if {"front", "back"} <= set(shown_arrays):
            shop_f = (np.asarray(sources["front"]["image"]), sources["front"]["mask"]) if "front" in sources else None
            shop_b = (np.asarray(sources["back"]["image"]), sources["back"]["mask"]) if "back" in sources else None
            vcol = dq.view_colour(shown_arrays["front"], shown_arrays["back"], shop_f, shop_b)
            by_view["back"]["view_colour"] = vcol
            dq.apply_view_colour(by_view["back"].get("qa"), vcol)
            if vcol.get("failures"):
                print(f"[stage1b] front and back differ in colour: {vcol['failures']}")

    model_pins = {k: M[k] for k in ENGINE_WEIGHTS[engine]}
    record = {
        "stage": "stage1b_dress",
        "job_id": job_id,
        "input_hash": m["input_hash"],
        "engine": engine,
        "engines": engines,
        "models": model_pins,
        "gpu_name": gpu_name,
        "steps": steps_for,
        "seed": seed,
        "category": m["category"],
        "tryon_category": tryon_cat,
        "proxy_kind": kind,
        "target": spec["target"],
        "source_kind": spec["source_kind"],
        "qa_version": dq.STAGE1B_QA_VERSION,
        "qa_v1_margin_px": v1_margin,
        "composite": composite,
        "accept_failed": accept_failed,
        "load_seconds": round(load_s, 1),
        "archived": archived,
        "prompt_version": lib.QWEN_PROMPT_VERSION,
        "colour_phrases": colour_phrases or None,
        "views": view_records,
        "summary": lib.stage1b_summary(view_records, invented_back=bool(spec["invented_back"])),
        "invented_back": bool(spec["invented_back"]),
        "cost": lib.cost_record("stage1b_dress", gpu=CFG["gpu_dress"], region=CFG["region"], gpu_seconds=time.time() - t_start),
        "label": lib.STAGE1B_LABEL,
    }
    if plan is not None:
        record.update({"plan": plan, "kept": prepared.get("kept") or None, "seed": None, "finalized": False})
    with open(f"{out}/record.json", "w") as f:
        json.dump(record, f, indent=2)
    pm.jobs.commit()
    return record


@app.function(image=image, volumes={pm.JOBS_DIR: pm.jobs}, timeout=1800, memory=8192, cpu=2.0, region=CFG["region"])
def recompose(job_id: str, pins: dict | None = None, accept_failed: bool = False) -> dict:
    """CPU only, no engine (stage1b-qa-0.10.0, run 16b): re-make this job's pinned stills from the raw engine outputs a
    finished stage 1b run left in the jobs Volume, with the current composite, conforms and QA
    (`phase0_dress.recompose_job`; `pins` = view -> engine). Stage 2 then pins stills that were reviewed, not a new draw."""
    import phase0_dress as dq

    t0 = time.time()
    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    record = dq.recompose_job(job, m, pins=pins, accept_failed=accept_failed)
    record["recomposed"]["cpu_seconds"] = round(time.time() - t0, 1)
    with open(f"{job}/{lib.STAGE1B_DIR}/record.json", "w") as f:
        json.dump(record, f, indent=2)
    pm.jobs.commit()
    return record


@app.function(image=image, volumes={pm.JOBS_DIR: pm.jobs}, timeout=1800, memory=8192, cpu=2.0, region=CFG["region"])
def prepare(job_id: str, plan: dict) -> dict:
    """CPU, before a draw plan's GPU run (stage1b-qa-0.11.0): moves the earlier stage1b/ into stage1b/history/<utc>/ and imports
    each kept candidate from it (`phase0_dress.find_kept`, `import_kept`). A keep that is not there stops here, before the GPU."""
    import phase0_dress as dq

    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    out = f"{job}/{lib.STAGE1B_DIR}"
    found = {}
    for view, p in plan.items():  # look before moving anything: a missing keep leaves the Volume as it was
        if p.get("keep"):
            found[view] = dq.find_kept(out, view, p["keep"]["engine"], p["keep"]["seed"], m["input_hash"])
    archived = dq.archive_stage1b(out, time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    kept = {}
    for view, p in plan.items():
        if p.get("keep"):
            f = dq.find_kept(out, view, p["keep"]["engine"], p["keep"]["seed"], m["input_hash"], include_current=False)
            kept[view] = dq.import_kept(job, m, view, f)
            print(f"[stage1b] keeping {view} {kept[view]['id']} from {kept[view]['kept']['from']} (QA {kept[view]['kept']['qa_version']} then: pass={kept[view]['kept']['qa_pass_then']}); "
                  f"chosen mask: {kept[view]['kept']['chosen_mask_basis']}")
    pm.jobs.commit()
    return {"archived": archived, "kept": kept, "looked_before_archive": {v: f["dir"] or "." for v, f in found.items()}}


@app.function(image=image, volumes={pm.JOBS_DIR: pm.jobs}, timeout=1800, memory=16384, cpu=4.0, region=CFG["region"])
def finalize(job_id: str, accept_failed: bool = False) -> dict:
    """CPU, after a draw plan's GPU run (stage1b-qa-0.11.0): every candidate scored, the pair picked, the stills written
    (`phase0_dress.finalize_draws`, the code a replay runs)."""
    import phase0_dress as dq

    t0 = time.time()
    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    record = dq.finalize_draws(job, m, accept_failed=accept_failed)
    record["finalized"]["cpu_seconds"] = round(time.time() - t0, 1)
    with open(f"{job}/{lib.STAGE1B_DIR}/record.json", "w") as f:
        json.dump(record, f, indent=2)
    pm.jobs.commit()
    return record


def check_plan(m: dict, plan: dict | None, *, engine: str, seed: int | None) -> None:
    """Refuses a draw plan that cannot run on this job, before anything is uploaded (ValueError): an invented back (drawn from
    the picked front still, so not in a plan), or --engine / --seed given with it (the plan names both)."""
    if plan is None:
        return
    if (m.get("stage1b") or {}).get("invented_back"):
        raise ValueError("--draws needs a back photo: an invented back is drawn from the picked front still (run without --draws)")
    if engine:
        raise ValueError("--draws names the engine of every draw: drop --engine")
    if seed is not None:
        raise ValueError("--draws names the seed of every draw: drop --seed")


def run_local(job_dir: str, *, engine: str, steps: int, seed: int | None, composite: bool, accept_failed: bool, category: str, force_upload: bool,
              plan: dict | None = None) -> dict:
    """Upload, weights, dress, download; shared by this entrypoint and run_phase0.py --dress. With `plan` (lib.parse_draw_plan):
    prepare (CPU: archive, keeps) -> dress (GPU: every draw) -> finalize (CPU: score, pair, stills)."""
    m = pm.load_local_job(job_dir)
    lib.stage1b_plan(m)
    check_plan(m, plan, engine="", seed=None)  # the callers refuse --engine / --seed with a plan themselves
    engine = lib.draw_plan_engines(plan) if plan is not None else engine
    lib.dress_engines(engine)  # refuse an unknown engine before uploading anything
    job_id = m["job_id"]
    if plan is not None:
        print(f"[stage1b] draw plan: {lib.describe_draw_plan(plan)}; about {lib.draw_plan_seconds(plan):.0f} GPU s (an estimate)")
    pm.upload_job(job_dir, job_id, force=force_upload)
    prepared = prepare.remote(job_id, plan) if plan is not None else None
    print("[stage1b] weights:", download_dress_weights.remote([engine]))
    t = time.time()
    try:
        record = dress.remote(job_id, engine=engine, steps=steps, seed=seed, composite=composite, accept_failed=accept_failed, category=category, plan=plan, prepared=prepared)
        gpu_s = record["cost"]["gpu_seconds"]
        if plan is not None:
            record = finalize.remote(job_id, accept_failed=accept_failed)
    finally:  # the draws are paid for: bring home whatever the Volume holds even when the dress (timeout, OOM) or the finalize fails
        pm.download_dir(job_dir, job_id, lib.STAGE1B_DIR)
    record["cost"] = lib.cost_record("stage1b_dress", gpu=CFG["gpu_dress"], region=CFG["region"], gpu_seconds=gpu_s, wall_seconds=time.time() - t)
    os.makedirs(os.path.join(job_dir, lib.STAGE1B_DIR), exist_ok=True)
    with open(os.path.join(job_dir, lib.STAGE1B_DIR, "record.local.json"), "w") as f:
        json.dump(record, f, indent=2)
    s = record["summary"]
    for row in (record.get("pairs") or {}).get("pairs") or []:
        print(f"[stage1b] pair {row['front']} + {row['back']}: eligible={row['eligible']} dE={row.get('delta_e')} waist gap={row.get('top_gap')} "
              f"(waistband front {row.get('front_top_offset')} back {row.get('back_top_offset')}) torso cover front {row.get('front_torso_cover')} back {row.get('back_torso_cover')} {row['failures']}")
    if record.get("pairs"):
        print(f"[stage1b] pairs: {record['pairs'].get('reason')}")
    for v in record["views"]:
        for c in v.get("candidates", []):
            q = c.get("qa", {})
            f = q.get("fidelity") or {}
            b = q.get("silhouette_band") or {}
            print(f"[stage1b] {v['view']} / {c.get('id') or c['engine']}: pass={q.get('pass')} fidelity={f.get('score')} (hellinger {f.get('lab_hellinger')}, dE {f.get('median_delta_e')}, "
                  f"edges {f.get('edge_ratio')}) colour={(c.get('candidate_colour') or {}).get('phrase')!r} silhouette band inside={b.get('garment_inside')} torso={b.get('torso_cover')} "
                  f"outside={b.get('foreground_outside')} (iou {q.get('silhouette_iou')}) garment_proxy_iou={q.get('garment_proxy_iou')} "
                  f"leg_gap_rows={q.get('leg_gap_rows')}/{q.get('skirt_zone_rows')} (all {q.get('leg_gap_rows_all')}, hem {q.get('garment_hem_rows')}) skirt_cover={q.get('skirt_cover')} inside={q.get('inside_fraction')} mae={q.get('mannequin_mae_8bit')} "
                  f"cut_px={q.get('cut_px')} residue={q.get('proxy_residue')} back_view={(c.get('back_view') or {}).get('pass')} {q.get('failures', [])} warnings={q.get('warnings', [])}")
        q = v.get("qa", {})
        print(f"[stage1b] {v['view']}{' (INVENTED)' if v.get('invented') else ''}: picked {v.get('candidate') or v.get('engine')} ({(v.get('selection') or {}).get('reason')}), pass={q.get('pass')} "
              f"still pixel sha256 {v.get('still_pixel_sha256')} {q.get('failures', [])}")
    for w in s["warnings"]:
        print(f"[stage1b] WARNING: {w}")
    print(f"[stage1b] usable for stage 2: {s['usable_for_stage2']}" + ("" if s["usable_for_stage2"] else " (failed views: " + ", ".join(s["failed_views"]) + "; see stage1b/rejected/)"))
    return record


def parse_plan_option(text: str) -> dict | None:
    """--draws for a local entrypoint: the parsed plan, or SystemExit with the parser's reason (before any upload or spend)."""
    try:
        return lib.parse_draw_plan(text)
    except ValueError as e:
        raise SystemExit(f"[stage1b] {e}") from None


@app.local_entrypoint()
def main(job_dir: str, engine: str = "", steps: int = 0, seed: int = -1, no_composite: bool = False, accept_failed: bool = False, category: str = "", download_only: bool = False,
         force_upload: bool = False, draws: str = ""):
    if download_only:
        m = pm.load_local_job(job_dir)
        pm.download_dir(job_dir, m["job_id"], lib.STAGE1B_DIR)
        return
    plan = parse_plan_option(draws)
    if plan is not None:
        try:
            check_plan(pm.load_local_job(job_dir), plan, engine=engine, seed=None if seed < 0 else seed)
        except ValueError as e:
            raise SystemExit(f"[stage1b] {e}") from None
    record = run_local(job_dir, engine=engine or "fashn", steps=steps, seed=None if seed < 0 else seed, composite=not no_composite, accept_failed=accept_failed, category=category,
                       force_upload=force_upload, plan=plan)
    print(lib.format_cost_table([record["cost"]]))
