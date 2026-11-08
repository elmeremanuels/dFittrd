"""Pure-Python helpers for the Phase 0 Modal apps (docs/ENGINE-HANDOFF.md, docs/research/garment-engine.md).

No third-party imports here, and never `modal`: this module is imported by the Modal apps (inside
and outside the container) and by the local pytest suite, which runs without Modal, numpy or a GPU.

What lives here:
- pinned model and code versions (must equal PINNED_MODELS in src/exportJob.ts),
- job manifest loading and input_hash verification (canonical JSON identical to the exporter),
- camera pose conversions between OpenCV world-to-camera and Nerfstudio/OpenGL camera-to-world,
- turntable clip assembly (two half-turn clips -> one frame per camera pose),
- the GPU cost estimate (list prices from the research doc; always marked as an estimate),
- run settings from environment variables (GPU type, region, timeouts),
- stage 1b helpers (pins, settings, manifest wiring, mask operations, alignment QA),
- stage 2's control mode, prompt guard and per-frame garment-consistency metric.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
from typing import Any, Iterable, Mapping, Sequence

MANIFEST_FORMAT = "curtain.phase0.job"
MANIFEST_VERSION = 1
EXPORTER_PREFIX = "@curtain/garment-spike phase0-export-"

# Must equal PINNED_MODELS in spikes/garment-engine/src/exportJob.ts (a pytest and a vitest check it).
PINNED_MODELS: dict[str, dict[str, str]] = {
    "video": {
        "id": "alibaba-pai/Wan2.2-Fun-A14B-Control",
        "revision": "297be6d520f54908e124be0298e2317ee50ffdf4",
        "code_url": "https://github.com/aigc-apps/VideoX-Fun",
        "code_revision": "3e8d6867d3bff699bc85cd839f9802a5faa73aa3",
        "licence": "Apache-2.0",
    },
    "recon": {
        "id": "gsplat",
        "version": "1.5.3",
        "code_url": "https://github.com/nerfstudio-project/gsplat",
        "code_revision": "937e29912570c372bed6747a5c9bf85fed877bae",
        "method": "2dgs",
        "mesher": "open3d",
        "mesher_version": "0.19.0",
        "licence": "Apache-2.0 (gsplat), MIT (Open3D)",
    },
}

PHOTO_ROLES = ("front", "back", "detail")
TRIANGLE_BUDGET = (8000, 15000)


class ManifestError(ValueError):
    """The job manifest is missing, malformed, tampered with, or pinned to other model versions."""


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def canonical_json(x: Any) -> str:
    """Sorted keys, no whitespace, UTF-8 as is: the same string as canonicalJson() in exportJob.ts."""
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def input_hash(hash_inputs: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(hash_inputs).encode("utf-8")).hexdigest()


_REQUIRED = (
    "job_id", "product_id", "base_size", "chart", "fabric", "mannequin", "photos", "camera",
    "control", "motion", "clips", "seeds", "models", "hash_inputs", "input_hash",
)


def check_manifest(m: Mapping[str, Any], *, check_pins: bool = True) -> dict[str, Any]:
    """Validates a parsed manifest and returns it. Raises ManifestError with every problem found."""
    problems: list[str] = []
    if m.get("format") != MANIFEST_FORMAT:
        problems.append(f"format is {m.get('format')!r}, expected {MANIFEST_FORMAT!r}")
    if m.get("format_version") != MANIFEST_VERSION:
        problems.append(f"format_version is {m.get('format_version')!r}, expected {MANIFEST_VERSION}")
    missing = [k for k in _REQUIRED if k not in m]
    if missing:
        problems.append("missing keys: " + ", ".join(missing))
        raise ManifestError("; ".join(problems))
    if input_hash(m["hash_inputs"]) != m["input_hash"]:
        problems.append("input_hash does not match hash_inputs (the manifest was edited by hand; re-run the exporter)")
    if not str(m["job_id"]).endswith(str(m["input_hash"])[:12]):
        problems.append("job_id does not end with the first 12 characters of input_hash")
    roles = [p.get("role") for p in m["photos"]]
    for role in ("front", "back"):
        if roles.count(role) != 1:
            problems.append(f"exactly one {role} photo is required (handoff D13), found {roles.count(role)}")
    for p in m["photos"]:
        if p.get("role") not in PHOTO_ROLES:
            problems.append(f"unknown photo role {p.get('role')!r}")
    if check_pins and m["models"] != PINNED_MODELS:
        problems.append(
            "pinned model versions differ between the manifest and phase0_lib.PINNED_MODELS; "
            "update both src/exportJob.ts and modal/phase0_lib.py together, then re-export"
        )
    frames = m["camera"].get("frames")
    for clip in m["clips"]:
        idx = clip.get("frame_indices") or []
        if (len(idx) - 1) % 4 != 0:
            problems.append(f"clip {clip.get('id')}: {len(idx)} frames, Wan2.2 needs 4k+1")
        if clip.get("kind") == "turntable" and any(not (0 <= i < frames) for i in idx):
            problems.append(f"clip {clip.get('id')}: frame index outside 0..{frames - 1}")
    if problems:
        raise ManifestError("; ".join(problems))
    return dict(m)


def load_manifest(path: str, *, check_pins: bool = True) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return check_manifest(json.load(f), check_pins=check_pins)


def photo_path(manifest: Mapping[str, Any], role: str) -> str:
    for p in manifest["photos"]:
        if p["role"] == role:
            return p["path"]
    raise ManifestError(f"no {role} photo in the manifest")


# ---------------------------------------------------------------------------
# Poses (row-major 4x4 lists; world = mannequin space in metres, +Y up, +Z front)
# ---------------------------------------------------------------------------

Mat = list[list[float]]


def mat_mul(a: Sequence[Sequence[float]], b: Sequence[Sequence[float]]) -> Mat:
    return [[sum(a[r][k] * b[k][c] for k in range(len(b))) for c in range(len(b[0]))] for r in range(len(a))]


def invert_rigid(m: Sequence[Sequence[float]]) -> Mat:
    """Inverse of [R|t; 0 0 0 1] with orthonormal R."""
    rt = [[m[c][r] for c in range(3)] for r in range(3)]
    t = [m[0][3], m[1][3], m[2][3]]
    out = [[rt[r][0], rt[r][1], rt[r][2], -sum(rt[r][k] * t[k] for k in range(3))] for r in range(3)]
    return out + [[0.0, 0.0, 0.0, 1.0]]


def flip_camera_axes(c2w: Sequence[Sequence[float]]) -> Mat:
    """OpenGL <-> OpenCV camera axes: c2w . diag(1, -1, -1, 1)."""
    return [[row[0], -row[1], -row[2], row[3]] for row in c2w]


def opengl_c2w_to_opencv_w2c(c2w: Sequence[Sequence[float]]) -> Mat:
    return invert_rigid(flip_camera_axes(c2w))


def opencv_w2c_to_opengl_c2w(w2c: Sequence[Sequence[float]]) -> Mat:
    return flip_camera_axes(invert_rigid(w2c))


def camera_centre(w2c: Sequence[Sequence[float]]) -> list[float]:
    return [row[3] for row in invert_rigid(w2c)[:3]]


def k_integer_centres(k: Sequence[Sequence[float]]) -> Mat:
    """The exporter's K uses the pixel-corner origin (COLMAP, Nerfstudio, gsplat). Open3D and plain
    OpenCV put the centre of pixel (0,0) at (0,0): shift the principal point by -0.5."""
    return [[k[0][0], k[0][1], k[0][2] - 0.5], [k[1][0], k[1][1], k[1][2] - 0.5], [0.0, 0.0, 1.0]]


def project(k: Sequence[Sequence[float]], w2c: Sequence[Sequence[float]], p: Sequence[float]) -> tuple[float, float, float]:
    """World point (m) -> pixel (u, v) in K's convention and depth z (m) along the optical axis."""
    x, y, z = (w2c[r][0] * p[0] + w2c[r][1] * p[1] + w2c[r][2] * p[2] + w2c[r][3] for r in range(3))
    return k[0][0] * x / z + k[0][2], k[1][1] * y / z + k[1][2], z


def poses_from_transforms(transforms: Mapping[str, Any]) -> tuple[Mat, dict[int, Mat]]:
    """(K, {frame index: OpenCV world-to-camera}) from a Nerfstudio transforms.json written by the exporter."""
    k = [[transforms["fl_x"], 0.0, transforms["cx"]], [0.0, transforms["fl_y"], transforms["cy"]], [0.0, 0.0, 1.0]]
    poses = {int(f["curtain_frame"]): opengl_c2w_to_opencv_w2c(f["transform_matrix"]) for f in transforms["frames"]}
    return k, poses


def poses_from_opencv(cameras: Mapping[str, Any]) -> tuple[Mat, dict[int, Mat]]:
    """(K, {frame index: OpenCV world-to-camera}) from cameras_opencv.json."""
    return [list(map(float, r)) for r in cameras["K"]], {int(f["index"]): [list(map(float, r)) for r in f["w2c"]] for f in cameras["frames"]}


def max_abs_diff(a: Sequence[Sequence[float]], b: Sequence[Sequence[float]]) -> float:
    return max(abs(x - y) for ra, rb in zip(a, b) for x, y in zip(ra, rb))


# ---------------------------------------------------------------------------
# Clips
# ---------------------------------------------------------------------------


def turntable_assembly(manifest: Mapping[str, Any]) -> tuple[list[tuple[int, str, int]], list[tuple[int, list[tuple[str, int]]]]]:
    """Maps every camera-path frame to the (clip id, frame within clip) that provides it.

    The first clip that covers an index wins (turntable_a gives 0..N/2, turntable_b the rest). Returns
    (assignments sorted by frame index, seams) where seams lists the indices that more than one clip
    renders, e.g. the back (N/2) and the front (0, the last frame of turntable_b). Comparing the
    clips at the seams measures how well the pinned frames hold.
    """
    frames = int(manifest["camera"]["frames"])
    owner: dict[int, tuple[str, int]] = {}
    seen: dict[int, list[tuple[str, int]]] = {}
    for clip in manifest["clips"]:
        if clip["kind"] != "turntable":
            continue
        for j, idx in enumerate(clip["frame_indices"]):
            seen.setdefault(idx, []).append((clip["id"], j))
            owner.setdefault(idx, (clip["id"], j))
    missing = [i for i in range(frames) if i not in owner]
    if missing:
        raise ManifestError(f"turntable clips do not cover frames {missing[:8]}{'...' if len(missing) > 8 else ''}")
    assignments = [(i, owner[i][0], owner[i][1]) for i in range(frames)]
    seams = [(i, s) for i, s in sorted(seen.items()) if len(s) > 1]
    return assignments, seams


def control_value(depth_mm: int, near_cm: float, far_cm: float, mode: str = "linear") -> int:
    """8-bit control value of one depth sample (0 = background).

    linear:  the exporter's depth_vis encoding (near = 255, far = 1, linear in depth).
    inverse: linear in 1/depth over the same range (closer to the relative inverse depth that
             monocular depth models such as Depth Anything produce); an option to try if Wan2.2-Fun's
             depth control reacts badly to the linear encoding.
    """
    if depth_mm <= 0:
        return 0
    d = depth_mm / 10.0
    if mode == "linear":
        v = 1 + 254 * (far_cm - d) / (far_cm - near_cm)
    elif mode == "inverse":
        v = 1 + 254 * (1 / d - 1 / far_cm) / (1 / near_cm - 1 / far_cm)
    else:
        raise ValueError(f"unknown control encoding {mode!r}")
    return max(1, min(255, int(math.floor(v + 0.5))))


def triangle_target(requested: int | None) -> int:
    lo, hi = TRIANGLE_BUDGET
    return 12000 if requested is None else max(lo, min(hi, int(requested)))


# ---------------------------------------------------------------------------
# Cost estimate
# ---------------------------------------------------------------------------

PRICE_SOURCE = "docs/research/garment-engine.md section 5, Modal list prices read 2026-11-05, GPU only"

# Modal base list prices in USD per GPU-hour (research doc section 5).
MODAL_GPU_USD_PER_HOUR: dict[str, float] = {
    "L4": 0.80,
    "A10": 1.10,
    "L40S": 1.95,
    "A100-80GB": 2.50,
    "H100": 3.95,
}
_GPU_ALIASES = {"A10G": "A10", "A100-80G": "A100-80GB", "H100!": "H100"}

# Region multipliers (research doc section 5). No region = Modal picks one, no multiplier.
MODAL_REGION_MULTIPLIER: dict[str, float] = {"": 1.0, "eu": 1.15, "eu-west": 1.75, "eu-north": 1.75, "eu-south": 1.75}

# Research doc section 6: estimated cost per product, one attempt (not measured).
RESEARCH_ESTIMATE_PER_PRODUCT_USD = {"self_hosted_4_step": 1.3, "hosted_kling": 2.7, "self_hosted_40_step": 5.6}


def parse_gpu(gpu: str) -> tuple[str, int]:
    """'H100' -> ('H100', 1); 'L40S:2' -> ('L40S', 2); aliases normalised."""
    name, _, count = gpu.strip().partition(":")
    name = name.upper()
    return _GPU_ALIASES.get(name, name), int(count) if count else 1


def gpu_usd_per_hour(gpu: str, region: str | None) -> tuple[float | None, list[str]]:
    """Price per hour for a Modal GPU spec in a region, with notes. None when the table has no price."""
    notes: list[str] = []
    name, count = parse_gpu(gpu)
    base = MODAL_GPU_USD_PER_HOUR.get(name)
    if base is None:
        notes.append(f"no list price for GPU {name!r} in the research doc; cost left empty")
    mult = MODAL_REGION_MULTIPLIER.get(region or "")
    if mult is None:
        notes.append(f"no region multiplier for {region!r} in the research doc; cost left empty")
    if base is None or mult is None:
        return None, notes
    return base * count * mult, notes


def cost_record(stage: str, *, gpu: str, region: str | None, gpu_seconds: float, wall_seconds: float | None = None, extra: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """One stage run: GPU seconds x list price. `gpu_seconds` is the in-container time of the function
    (model load included, container boot not); `wall_seconds` is the caller's wall clock (queue and cold
    start included), which gives the upper end. Always an estimate: the Modal invoice is the measurement."""
    price, notes = gpu_usd_per_hour(gpu, region)
    low = None if price is None else round(price * gpu_seconds / 3600, 4)
    high = None if price is None or wall_seconds is None else round(price * max(gpu_seconds, wall_seconds) / 3600, 4)
    return {
        "stage": stage,
        "estimate": True,
        "gpu": gpu,
        "region": region or "any",
        "gpu_seconds": round(gpu_seconds, 1),
        "wall_seconds": None if wall_seconds is None else round(wall_seconds, 1),
        "usd_per_hour": None if price is None else round(price, 4),
        "usd_estimate_low": low,
        "usd_estimate_high": high,
        "price_source": PRICE_SOURCE,
        "not_included": "CPU and memory seconds, storage, egress, failed attempts",
        "notes": notes,
        **(dict(extra) if extra else {}),
    }


def summarize_costs(records: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    rs = list(records)
    known = [r for r in rs if r.get("usd_estimate_low") is not None]
    low = round(sum(r["usd_estimate_low"] for r in known), 4)
    high = round(sum(r.get("usd_estimate_high") or r["usd_estimate_low"] for r in known), 4)
    return {
        "estimate": True,
        "stages": len(rs),
        "stages_without_price": [r["stage"] for r in rs if r.get("usd_estimate_low") is None],
        "gpu_seconds": round(sum(r.get("gpu_seconds", 0) for r in rs), 1),
        "usd_estimate_low": low,
        "usd_estimate_high": high,
        "research_estimate_per_product_usd": RESEARCH_ESTIMATE_PER_PRODUCT_USD,
        "price_source": PRICE_SOURCE,
    }


def format_cost_table(records: Iterable[Mapping[str, Any]]) -> str:
    rs = list(records)
    s = summarize_costs(rs)
    money = lambda v: "n/a" if v is None else f"${v:.2f}"  # noqa: E731
    lines = ["ESTIMATE (GPU list price x seconds; the Modal invoice is the measurement)",
             f"{'stage':<26}{'gpu':<12}{'region':<9}{'gpu s':>9}{'wall s':>9}{'low':>9}{'high':>9}"]
    for r in rs:
        wall = "" if r.get("wall_seconds") is None else f"{r['wall_seconds']:.0f}"
        lines.append(f"{r['stage']:<26}{r['gpu']:<12}{r['region']:<9}{r['gpu_seconds']:>9.0f}{wall:>9}{money(r.get('usd_estimate_low')):>9}{money(r.get('usd_estimate_high')):>9}")
    lines.append(f"{'total':<47}{s['gpu_seconds']:>9.0f}{'':>9}{money(s['usd_estimate_low']):>9}{money(s['usd_estimate_high']):>9}")
    r = RESEARCH_ESTIMATE_PER_PRODUCT_USD
    lines.append(f"research doc estimate per product, one attempt: ${r['self_hosted_4_step']:.1f} (4-step) to ${r['self_hosted_40_step']:.1f} (40-step), also an estimate")
    for row in rs:
        for n in row.get("notes", []):
            lines.append(f"note ({row['stage']}): {n}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

DEFAULTS = {
    "CURTAIN_MODAL_GPU_VIDEO": "H100",
    "CURTAIN_MODAL_GPU_RECON": "L40S",
    "CURTAIN_MODAL_TIMEOUT_VIDEO": "10800",
    "CURTAIN_MODAL_TIMEOUT_RECON": "3600",
    "CURTAIN_MODAL_TIMEOUT_DOWNLOAD": "7200",
    "CURTAIN_MODAL_MEMORY_VIDEO_MB": "131072",
    "CURTAIN_WAN_MEMORY_MODE": "model_cpu_offload",
}
WAN_MEMORY_MODES = ("model_full_load", "model_cpu_offload", "model_cpu_offload_and_qfloat8", "sequential_cpu_offload")
MODAL_MAX_TIMEOUT_S = 24 * 3600


def settings(environ: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Run settings from the environment, validated. Read at import time by the Modal apps."""
    env = os.environ if environ is None else environ
    get = lambda k: (env.get(k) or DEFAULTS.get(k, "")).strip()  # noqa: E731

    def seconds(k: str) -> int:
        v = int(get(k))
        if not 60 <= v <= MODAL_MAX_TIMEOUT_S:
            raise ValueError(f"{k}={v}: use 60..{MODAL_MAX_TIMEOUT_S} seconds")
        return v

    region = get("CURTAIN_MODAL_REGION") or None
    mode = get("CURTAIN_WAN_MEMORY_MODE")
    if mode not in WAN_MEMORY_MODES:
        raise ValueError(f"CURTAIN_WAN_MEMORY_MODE={mode!r}: use one of {', '.join(WAN_MEMORY_MODES)}")
    return {
        "region": region,
        "gpu_video": get("CURTAIN_MODAL_GPU_VIDEO"),
        "gpu_recon": get("CURTAIN_MODAL_GPU_RECON"),
        "timeout_video": seconds("CURTAIN_MODAL_TIMEOUT_VIDEO"),
        "timeout_recon": seconds("CURTAIN_MODAL_TIMEOUT_RECON"),
        "timeout_download": seconds("CURTAIN_MODAL_TIMEOUT_DOWNLOAD"),
        "memory_video_mb": int(get("CURTAIN_MODAL_MEMORY_VIDEO_MB")),
        "wan_memory_mode": mode,
    }


# ---------------------------------------------------------------------------
# Job files
# ---------------------------------------------------------------------------

OUTPUT_DIRS = ("stage2", "stage4")


def job_input_files(job_dir: str) -> list[str]:
    """Relative paths of the exporter's files in a local job dir (stage outputs left out), sorted."""
    out: list[str] = []
    for root, dirs, files in os.walk(job_dir):
        rel_root = os.path.relpath(root, job_dir)
        if rel_root == ".":
            dirs[:] = [d for d in dirs if d not in OUTPUT_DIRS]
        for name in files:
            out.append(os.path.normpath(os.path.join(rel_root, name)).replace(os.sep, "/"))
    return sorted(out)


# ---------------------------------------------------------------------------
# Stage 1b: dress our mannequin from a shop photo (stage1_dress.py)
# ---------------------------------------------------------------------------
#
# Stage 2 pins a front and a back still of the garment ON OUR mannequin at frames 0 and N/2. When a job
# was exported with --on-model / --flat-lay, those stills do not exist yet: the manifest's front/back
# photos point at stage1b/front.png and stage1b/back.png (`produced_by: "stage1b"`), and its `stage1b`
# section lists the shop photos and the bare-mannequin renders. Everything below is pure Python on flat
# sequences (bytes, bytearray or lists): a mask is w*h values (non-zero = in), an RGB image 3*w*h bytes,
# row-major. The Modal app converts its numpy arrays with .tobytes(); the tests build small ones by hand.

# Pinned revisions read from the Hugging Face API and `git ls-remote` on 2026-11-06. Licences were read
# from each repository's licence file or model card on that date (docs/research/garment-engine.md,
# section "Stage 1b"). Not part of PINNED_MODELS: stage 1b is a validation step, and adding it there
# would change every job's input_hash. stage1_dress.py writes these pins into stage1b/record.json.
STAGE1B_MODELS: dict[str, dict[str, Any]] = {
    "detector": {
        "id": "IDEA-Research/grounding-dino-base",
        "revision": "12bdfa3120f3e7ec7b434d90674b3396eccf88eb",
        "licence": "Apache-2.0",
        "use": "text-prompted box around the garment in the shop photo and in the dressed still",
    },
    "segmenter": {
        "id": "facebook/sam2.1-hiera-large",
        "revision": "665f8e2ad61cf5f53d65644ff27c8ee525124610",
        "licence": "Apache-2.0",
        "use": "garment mask from the detector's box",
    },
    "fashn": {
        "id": "fashn-ai/fashn-vton-1.5",
        "revision": "7720683168567eb5a2a4c67f15116c6e29c83ded",
        "code_url": "https://github.com/fashn-AI/fashn-vton-1.5",
        "code_revision": "7c0f10af3f91ad4048fe9729c470a13ef905d25a",
        "pose_id": "fashn-ai/DWPose",
        "pose_revision": "548b5df25b84d9f4aac0611dfa1c2a7a12f15571",
        "licence": "Apache-2.0 (weights and code); DWPose and YOLOX Apache-2.0",
        "not_used": "fashn-human-parser: NVIDIA Source Code License for SegFormer (non-commercial). "
        "stage1_dress.py installs without it and feeds the pipeline our SAM 2 garment mask instead",
    },
    "qwen": {
        "id": "Qwen/Qwen-Image-Edit-2511",
        "revision": "6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9",
        "licence": "Apache-2.0",
        "use": "multi-image edit: our proxy-dressed mannequin + the SAM 2 garment cut-out, and the invented back",
    },
}
STAGE1B_ENGINES = ("fashn", "qwen")
# --engine / --dress-engine choices: one engine, or `both` (each view dressed by both, the still that passes QA
# with the best score is pinned, both are recorded).
DRESS_ENGINE_CHOICES = STAGE1B_ENGINES + ("both",)
STAGE1B_DIR = "stage1b"
# The first export whose stage 1b views carry the proxy-dressed target (dress/proxy_<view>.png, proxy_mask).
STAGE1B_TARGET_EXPORT = "phase0-export-0.4.0"


def dress_engines(choice: str) -> list[str]:
    """The engines one stage 1b call runs, in order (FASHN first: seconds, then Qwen: minutes)."""
    if choice not in DRESS_ENGINE_CHOICES:
        raise ValueError(f"engine {choice!r}: use one of {', '.join(DRESS_ENGINE_CHOICES)}")
    return list(STAGE1B_ENGINES) if choice == "both" else [choice]

STAGE1B_DEFAULTS = {
    # Qwen-Image-Edit (20B transformer + 7B text encoder, about 58 GB in bf16) fits an H100 without
    # offload. FASHN VTON needs about 8 GB; set CURTAIN_MODAL_GPU_DRESS=L4 or L40S for a fashn-only run.
    "CURTAIN_MODAL_GPU_DRESS": "H100",
    "CURTAIN_MODAL_TIMEOUT_DRESS": "3600",
    "CURTAIN_MODAL_TIMEOUT_DOWNLOAD": "7200",
    "CURTAIN_MODAL_MEMORY_DRESS_MB": "65536",
    "CURTAIN_QWEN_CPU_OFFLOAD": "0",
}


def stage1b_settings(environ: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Stage 1b run settings from the environment, validated. Read at import time by stage1_dress.py."""
    env = os.environ if environ is None else environ
    get = lambda k: (env.get(k) or STAGE1B_DEFAULTS.get(k, "")).strip()  # noqa: E731

    def seconds(k: str) -> int:
        v = int(get(k))
        if not 60 <= v <= MODAL_MAX_TIMEOUT_S:
            raise ValueError(f"{k}={v}: use 60..{MODAL_MAX_TIMEOUT_S} seconds")
        return v

    offload = get("CURTAIN_QWEN_CPU_OFFLOAD").lower()
    if offload not in ("0", "1", "true", "false"):
        raise ValueError(f"CURTAIN_QWEN_CPU_OFFLOAD={offload!r}: use 0 or 1")
    return {
        "region": get("CURTAIN_MODAL_REGION") or None,
        "gpu_dress": get("CURTAIN_MODAL_GPU_DRESS"),
        "timeout_dress": seconds("CURTAIN_MODAL_TIMEOUT_DRESS"),
        "timeout_download": seconds("CURTAIN_MODAL_TIMEOUT_DOWNLOAD"),
        "memory_dress_mb": int(get("CURTAIN_MODAL_MEMORY_DRESS_MB")),
        "qwen_cpu_offload": offload in ("1", "true"),
    }


# Product category (@curtain/schema GARMENT_CATEGORIES) -> FASHN VTON category.
TRYON_CATEGORY = {"dress": "one-pieces", "top": "tops", "outerwear": "tops", "bottom": "bottoms"}
# Grounding DINO text prompts (lower case, each phrase ends with a dot, as the model expects).
GARMENT_PROMPT = {"one-pieces": "dress. jumpsuit.", "tops": "top. shirt. blouse. jacket.", "bottoms": "skirt. pants. shorts."}
# The FASHN human-parser label table as published on its model card (huggingface.co/fashn-ai/
# fashn-human-parser, "Label Definitions"). We never load that model or its package (non-commercial
# licence); fashn_vton imports these constants from it, so stage1_dress.py provides them itself, and
# writes our SAM 2 garment mask as a label map: the pipeline keeps the garment-image pixels whose label
# belongs to the category, so the garment pixels get FASHN_GARMENT_LABEL[category].
FASHN_LABELS = ("background", "face", "hair", "top", "dress", "skirt", "pants", "belt", "bag", "hat", "scarf", "glasses", "arms", "hands", "legs", "feet", "torso", "jewelry")
FASHN_LABEL_IDS = {name: i for i, name in enumerate(FASHN_LABELS)}
FASHN_CATEGORY_TO_BODY_COVERAGE = {"tops": "upper", "bottoms": "lower", "one-pieces": "full"}
FASHN_BODY_COVERAGE_TO_LABELS = {
    "upper": ["top", "dress", "scarf"],
    "lower": ["skirt", "pants", "belt"],
    "full": ["top", "dress", "scarf", "skirt", "pants", "belt"],
}
FASHN_IDENTITY_LABELS = ["face", "hair", "jewelry", "bag", "glasses", "hat"]
FASHN_GARMENT_LABEL = {"one-pieces": "dress", "tops": "top", "bottoms": "skirt"}


def fashn_garment_label(tryon_cat: str, kind: str | None = None) -> str:
    """The FASHN label our garment pixels and the edit region get: the category's, except `pants` for a trousers
    proxy (bottoms default to `skirt`; a palazzo labelled skirt is still a lower-body garment to FASHN, but the label
    should not say skirt where the control and the proxy say two legs)."""
    if tryon_cat == "bottoms" and kind == "trousers":
        return "pants"
    return FASHN_GARMENT_LABEL[tryon_cat]


def fashn_label_map(garment: Sequence[int], tryon_cat: str, kind: str | None = None) -> bytearray:
    """Our garment mask as a FASHN label map (0 = background, garment = the category's label id)."""
    label = FASHN_LABEL_IDS[fashn_garment_label(tryon_cat, kind)]
    return bytearray(label if v else 0 for v in garment)
# Garment pixels may extend past the bare silhouette (ease, flare, sleeves): margin as a fraction of
# the frame height. 0.08 of 832 px is about 16 cm at the turntable distance. Initial values, not tuned.
ALIGN_MARGIN_FRAC = {"one-pieces": 0.08, "tops": 0.04, "bottoms": 0.06}
# QA thresholds per still. Initial values, not tuned on real output (no GPU run yet).
STAGE1B_QA_THRESHOLDS = {
    "min_inside_fraction": 0.97,  # garment pixels inside the dilated mannequin silhouette
    "min_silhouette_iou": 0.90,  # uncovered mannequin vs our render: pose and camera held
    "min_cover_fraction": 0.05,  # the garment covers at least this much of the mannequin
    "max_mannequin_mae_8bit": 25.0,  # uncovered mannequin pixels vs our render, before compositing
}
STAGE1B_LABEL = "generated still: our mannequin dressed from a shop photo by a model, an estimate (AGENTS.md rule 3)"
INVENTED_BACK_LABEL = "INVENTED BACK: no back photo was given, the model made it up; validation only, never for a published asset (D13)"


# Qwen-Image-Edit-2511 instructions (stage 1b, export 0.4.0). Picture 1 is our mannequin wearing the proxy in a flat
# beige; picture 2 the garment cut out of the shop photo by SAM 2 (or, for an invented back, the dressed front still).
# Built from the manifest's NEUTRAL description (prompt.description: length, sleeves, style, fabric; a colour only from
# primaryColorHex) plus the colour measured from the cut-out (`qwen_dress_prompt(colour=...)`), never the product title,
# the brand or a colour word of the name (run 10 rendered the title as text; run 13 painted "Azure" blue).
QWEN_DRESS_PROMPTS = {
    "front": (
        "Picture 1 shows a plain grey studio mannequin from the front, wearing a plain beige placeholder garment. "
        "Picture 2 is the garment, cut out of a shop photo. "
        "Dress the mannequin in this exact garment: {description}. "
        "The garment replaces the beige placeholder completely, with the same colour, print, fabric, length, neckline and sleeves as picture 2. "
        "Same pose, same camera, same framing, plain light-grey background. No person, no face, no extra clothing, no text."
    ),
    "back": (
        "Picture 1 shows a plain grey studio mannequin from behind, a back view, wearing a plain beige placeholder garment. "
        "Picture 2 is the back of the garment, cut out of a shop photo taken from behind. "
        "Dress the mannequin in this exact garment, back view: {description}. "
        "Show the back of the garment as picture 2 shows it, not its front: no front neckline and no front opening. "
        "{sides}"
        "The garment replaces the beige placeholder completely. "
        "Same pose, same camera, same framing, plain light-grey background. No person, no face, no extra clothing, no text."
    ),
    "back_invented": (
        "Picture 1 shows a plain grey studio mannequin from behind, a back view, wearing a plain beige placeholder garment. "
        "Picture 2 shows the same mannequin from the front wearing a garment. "
        "Dress the mannequin of picture 1 in the same garment, back view: {description}; same colour, print, fabric and length, "
        "a plain back with no front neckline, no front opening and no added details. "
        "The garment replaces the beige placeholder completely. "
        "Same pose, same camera, same framing, plain light-grey background. No person, no face, no extra clothing, no text."
    ),
}
QWEN_NEGATIVE = "person, human, face, hands, skin, hair, extra limbs, changed pose, different camera angle, cropped, text, letters, watermark, logo, blurry, busy background, beige placeholder"
QWEN_KIND_NEGATIVE = {
    "dress": "trousers, pants, shorts, romper, jumpsuit, two separate legs of fabric",
    "skirt": "trousers, pants, shorts, two separate legs of fabric, dress, bodice, top",
    "trousers": "dress, skirt, gown, one closed skirt between the legs, skort, overskirt, peplum, bodice, top",
}
# Outerwear whose proxy has a front opening (control-proxy-0.3.0): the closed garment it must not turn into. FRONT view only
# (qwen-dress-prompt-0.2.0): run 16a's cardigan back was told "no closed pullover, no high round neckline", which is what its
# shop back photo shows (a closed knit back with a round neck).
QWEN_OPEN_FRONT_NEGATIVE = "closed pullover, jumper closed at the front, high round neckline"
# The back (qwen-dress-prompt-0.2.0): every part stays on its side of picture 2; the sleeves named for kinds that have them.
QWEN_BACK_SIDES = "Keep every part on the side of the picture where picture 2 shows it. "
QWEN_BACK_SLEEVE_SIDES = ("Keep every part on the side of the picture where picture 2 shows it: a sleeve on the left of picture 2 is the left sleeve "
                          "of the result, in the colour it has there, and the same for the right. ")
_NO_SLEEVES = frozenset({"skirt", "trousers"})
# The version of the Qwen instruction rules, in every candidate record (run 17a: the first GPU draws of 0.2.0).
#   0.1.0  run 13-16a
#   0.2.0  the back: front-only clauses dropped and QWEN_BACK_NEGATIVE (stage1b-qa-0.10.0), every part kept on its side of
#          picture 2 (run 16a's cardigan back: sleeve colours swapped), no open-front negative; one colour phrase for both
#          views when the two shop cut-outs are one colour (`view_colour_phrases`; run 16a's blouse: "cream" / "peach")
QWEN_PROMPT_VERSION = "qwen-dress-prompt-0.2.0"
# Two shop cut-outs whose median Lab differ by less than this are ONE garment colour, named once for both views. The same
# number as phase0_dress.VIEW_COLOUR["min_limit_delta_e"]: below it the QA would hold the two stills to one colour anyway.
SHARED_COLOUR_MAX_DELTA_E = 8.0


# The exporter's colour came from a word of the product name before neutral-prompt-0.2.0 (export 0.5.0): run 13's
# "Azure Palm" became "blue", and Qwen painted the cream print solid blue. Such a colour is dropped here, so a job
# exported with 0.4.0 gets the measured colour too.
NAME_COLOUR_SOURCE = "a colour word of the product name"


def neutral_description(m: Mapping[str, Any], drop_colour: bool = False) -> str:
    """The manifest's neutral description (export 0.2.0+), else the plain category. A colour the exporter took from a
    word of the product name (before export 0.5.0) is removed; with `drop_colour` any colour of the description is
    (stage 1b names the colour it measured on the garment cut-out instead)."""
    d = ((m.get("prompt") or {}).get("description") or "").strip()
    colour = (m.get("prompt") or {}).get("colour") or {}
    name = colour.get("name")
    if d and name and (drop_colour or str(colour.get("source", "")).startswith(NAME_COLOUR_SOURCE)):
        hit = re.match(r"^(a|an) " + re.escape(str(name)) + r" (.+)$", d)
        if hit:
            rest = hit.group(2)
            d = ("an " if rest[:1].lower() in "aeiou" else "a ") + rest
        else:
            d = re.sub(r"\b" + re.escape(str(name)) + r" ", "", d, count=1)
    return d or f"a {m['category']}"


def qwen_dress_prompt(m: Mapping[str, Any], view: str, invented: bool, colour: Mapping[str, Any] | None = None) -> tuple[str, str]:
    """(instruction, negative prompt) for Qwen-Image-Edit at `view`. `colour` is `phase0_dress.garment_colour` of the
    shop photo's garment cut-out: its phrase is the only colour the instruction names ("colours: multicolour print on
    cream, as in picture 2"); a print whose edge density also says printed (`printed_by_edges`) adds "solid colour, plain
    fabric" to the negative. Raises ValueError when the
    instruction would carry the product title or the brand."""
    key = "front" if view == "front" else ("back_invented" if invented else "back")
    phrase = (colour or {}).get("phrase")
    description = neutral_description(m, drop_colour=bool(phrase))
    if key == "back":
        description = back_description(description)
    if phrase:
        description = f"{description}; colours: {phrase}, as in picture 2"
    kind = ((m.get("control") or {}).get("proxy") or {}).get("kind") or ((m.get("stage1b") or {}).get("target") or {}).get("proxy_kind")
    sides = QWEN_BACK_SIDES if kind in _NO_SLEEVES else QWEN_BACK_SLEEVE_SIDES
    text = QWEN_DRESS_PROMPTS[key].format(description=description, sides=sides)
    product = (m.get("hash_inputs") or {}).get("product") or {}
    for what, value in (("product title", m.get("product_name")), ("brand", product.get("brand"))):
        if value and str(value).strip().lower() in text.lower():
            raise ValueError(f"stage 1b instruction contains the {what} {value!r}")
    neg = QWEN_NEGATIVE + (", " + QWEN_KIND_NEGATIVE[kind] if kind in QWEN_KIND_NEGATIVE else "")
    if key == "front" and kind == "outerwear" and ((m.get("control") or {}).get("proxy") or {}).get("front_opening"):
        neg += ", " + QWEN_OPEN_FRONT_NEGATIVE
    # "solid colour, plain fabric" pushes Qwen towards a print: only when the chromaticity rule AND the cut-out's edge
    # density both say "printed" (a plain dark garment once read as a print from noise; colour-0.2.0 records the edges).
    if (colour or {}).get("kind") == "print" and (colour or {}).get("printed_by_edges") is True:
        neg += ", solid colour, plain fabric"
    if key == "back":
        neg += ", " + QWEN_BACK_NEGATIVE
    return text, neg


# stage1b-qa-0.10.0 (run 16a): the back instruction carried the front's features ("a long-sleeved cardigan ..., with a deep V
# neckline open to the underbust, buttoned below it") and Qwen drew a front button on the cardigan's plain knit back. For a
# back drawn from a real back photo, clauses about the neckline, buttons, an opening or a placket are dropped, and the
# negative prompt names them. Not tried on a GPU yet.
_FRONT_ONLY = re.compile(r"\b(neckline|neck|button\w*|opening|open|placket|zip\w*|v[- ]neck|wrap|lapel\w*|collar\w*|tie[sd]?)\b", re.I)
QWEN_BACK_NEGATIVE = "buttons on the back, front opening, front neckline, placket"


def view_colour_phrases(colours: Mapping[str, Mapping[str, Any] | None], max_delta_e: float = SHARED_COLOUR_MAX_DELTA_E) -> dict[str, dict[str, Any]]:
    """The colour words each view's Qwen instruction names, from `phase0_dress.garment_colour` of the shop cut-outs (`colours`:
    role -> record with `phrase` and `median_lab`). When a front and a back photo were both measured and their median Lab differ
    by less than `max_delta_e`, the garment is one colour and both views name the FRONT's phrase (run 16a's blouse: front
    "multicolour print on cream" L 79.5, back "on peach" L 75.1, dE 4.7, a naming boundary; Qwen drew the back orange-brown).
    Otherwise each view keeps its own (run 16a's cardigan: an argyle front on peach and a plain cream back, dE 15.5, really
    different). Measured from pixels only, never from the product name. Returns role -> {phrase, source, delta_e}."""
    out: dict[str, dict[str, Any]] = {}
    f, b = colours.get("front") or {}, colours.get("back") or {}
    de = None
    if f.get("median_lab") is not None and b.get("median_lab") is not None:
        de = round(math.dist([float(x) for x in f["median_lab"]], [float(x) for x in b["median_lab"]]), 2)
    for role, c in colours.items():
        c = c or {}
        out[role] = {"phrase": c.get("phrase"), "source": f"the {role} shop cut-out", "delta_e": de}
    if de is not None and de < max_delta_e and f.get("phrase") and "back" in out:
        out["back"] = {"phrase": f["phrase"], "source": f"the front shop cut-out (the back cut-out, {b.get('phrase')!r}, is within dE {de} < {max_delta_e}: one colour)",
                       "delta_e": de}
    return out


def back_description(description: str) -> str:
    """The neutral description without the clauses that describe the garment's front (see `_FRONT_ONLY`). Clauses are the
    parts split at ", with ", "; " and ", "; the first (the garment itself) is always kept."""
    parts = re.split(r"(, with |; |, )", description)
    keep = [parts[0]]
    i = 1
    while i < len(parts) - 1:
        sep, clause = parts[i], parts[i + 1]
        if not _FRONT_ONLY.search(clause):
            keep.append(sep + clause)
        i += 2
    return "".join(keep)


def tryon_category(category: str) -> str:
    try:
        return TRYON_CATEGORY[category]
    except KeyError:
        raise ManifestError(f"stage 1b has no try-on category for product category {category!r}; known: {', '.join(TRYON_CATEGORY)}") from None


def align_margin_px(tryon_cat: str, height: int) -> int:
    return max(1, int(round(ALIGN_MARGIN_FRAC[tryon_cat] * height)))


def stage1b_plan(m: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The two views stage 1b must produce, checked against the manifest. Raises ManifestError."""
    spec = m.get("stage1b")
    if not spec:
        raise ManifestError("this job has no stage1b section: export it with --on-model or --flat-lay (src/exportCli.ts)")
    problems: list[str] = []
    views = {v.get("view"): v for v in spec.get("views", [])}
    if set(views) != {"front", "back"}:
        problems.append(f"stage1b views are {sorted(views)}, expected back and front")
        raise ManifestError("; ".join(problems))
    frames = int(m["camera"]["frames"])
    if views["front"]["frame"] != 0 or views["back"]["frame"] != frames // 2:
        problems.append(f"stage1b views must sit at frames 0 and {frames // 2} (the pinned frames)")
    if not views["front"].get("source"):
        problems.append("stage1b needs a front source photo")
    if spec.get("source_kind") not in ("on_model", "flat_lay"):
        problems.append(f"unknown source_kind {spec.get('source_kind')!r}")
    sources = {s["role"]: s for s in spec.get("sources", [])}
    for name, v in views.items():
        if bool(v.get("invented")) != (v.get("source") is None):
            problems.append(f"{name}: invented must be true exactly when there is no source photo")
        if v.get("source") is not None and sources.get(name, {}).get("path") != v["source"]:
            problems.append(f"{name}: source {v['source']!r} is not in stage1b.sources")
        photo = next((p for p in m["photos"] if p.get("role") == name), None)
        if photo is None or photo.get("path") != v.get("still") or photo.get("produced_by") != STAGE1B_DIR:
            problems.append(f"{name}: the manifest's {name} photo must point at {v.get('still')!r} with produced_by stage1b")
        elif bool(photo.get("invented")) != bool(v.get("invented")):
            problems.append(f"{name}: the photo's invented flag differs from the stage1b view")
    if bool(spec.get("invented_back")) != bool(views["back"].get("invented")):
        problems.append("invented_back differs from the back view")
    if not all(views[n].get("proxy_rgb") and views[n].get("proxy_mask") for n in views) or (spec.get("target") or {}).get("kind") != "proxy_dressed":
        problems.append(
            f"stage1b views have no proxy-dressed target (dress/proxy_<view>.png): exported before {STAGE1B_TARGET_EXPORT}; "
            "re-export (run 12 dressed the BARE mannequin and FASHN drew a romper over the two legs)"
        )
    if problems:
        raise ManifestError("; ".join(problems))
    return [dict(views["front"]), dict(views["back"])]


def stills_pending(m: Mapping[str, Any], exists) -> list[str]:
    """Roles (front/back) whose pinned still is produced by stage 1b and is not there yet. `exists(rel_path)`."""
    return [p["role"] for p in m["photos"] if p.get("role") in ("front", "back") and p.get("produced_by") == STAGE1B_DIR and not exists(p["path"])]


def invented_roles(m: Mapping[str, Any]) -> list[str]:
    return [p["role"] for p in m["photos"] if p.get("invented")]


def photo_provenance(m: Mapping[str, Any]) -> dict[str, Any]:
    """Where the pinned stills come from, for every record downstream of them (stage 2 record.json,
    cost_summary.json): read from the manifest, so it holds whether stage 1b ran in this call or before."""
    roles = invented_roles(m)
    out: dict[str, Any] = {
        "invented_back": "back" in roles,
        "invented_roles": roles,
        "photos": [{k: p.get(k) for k in ("role", "produced_by", "invented", "synthetic")} for p in m["photos"] if p.get("role") in ("front", "back")],
    }
    if roles:
        out["label"] = INVENTED_BACK_LABEL
    return out


# --- masks and images (flat, row-major) ------------------------------------------------------------


def _check(mask: Sequence[int], w: int, h: int) -> None:
    if len(mask) != w * h:
        raise ValueError(f"mask has {len(mask)} values, expected {w}x{h}={w * h}")


def mask_count(a: Sequence[int]) -> int:
    return sum(1 for v in a if v)


def mask_and(a: Sequence[int], b: Sequence[int]) -> bytearray:
    return bytearray(1 if x and y else 0 for x, y in zip(a, b, strict=True))


def mask_or(a: Sequence[int], b: Sequence[int]) -> bytearray:
    return bytearray(1 if x or y else 0 for x, y in zip(a, b, strict=True))


def mask_andnot(a: Sequence[int], b: Sequence[int]) -> bytearray:
    return bytearray(1 if x and not y else 0 for x, y in zip(a, b, strict=True))


def mask_not(a: Sequence[int]) -> bytearray:
    return bytearray(0 if v else 1 for v in a)


def mask_iou(a: Sequence[int], b: Sequence[int]) -> float:
    inter = union = 0
    for x, y in zip(a, b, strict=True):
        if x or y:
            union += 1
            if x and y:
                inter += 1
    return 1.0 if union == 0 else inter / union


def dilate(mask: Sequence[int], w: int, h: int, r: int) -> bytearray:
    """Dilation by a (2r+1)^2 square (Chebyshev distance <= r), outside the frame counts as empty. O(w*h)."""
    _check(mask, w, h)
    if r <= 0:
        return bytearray(1 if v else 0 for v in mask)
    tmp = bytearray(w * h)
    for y in range(h):
        row = y * w
        pref = [0] * (w + 1)
        for x in range(w):
            pref[x + 1] = pref[x] + (1 if mask[row + x] else 0)
        for x in range(w):
            if pref[min(w, x + r + 1)] - pref[max(0, x - r)]:
                tmp[row + x] = 1
    out = bytearray(w * h)
    for x in range(w):
        pref = [0] * (h + 1)
        for y in range(h):
            pref[y + 1] = pref[y] + tmp[y * w + x]
        for y in range(h):
            if pref[min(h, y + r + 1)] - pref[max(0, y - r)]:
                out[y * w + x] = 1
    return out


def erode(mask: Sequence[int], w: int, h: int, r: int) -> bytearray:
    """Erosion by the same square; outside the frame counts as inside (a mask touching the border keeps it)."""
    return mask_not(dilate(mask_not(mask), w, h, r))


def components(mask: Sequence[int], w: int, h: int) -> list[list[int]]:
    """4-connected components as lists of pixel indices, largest first."""
    _check(mask, w, h)
    seen = bytearray(w * h)
    comps: list[list[int]] = []
    for start in range(w * h):
        if not mask[start] or seen[start]:
            continue
        seen[start] = 1
        stack, comp = [start], []
        while stack:
            k = stack.pop()
            comp.append(k)
            x, y = k % w, k // w
            for n, ok in ((k - 1, x > 0), (k + 1, x < w - 1), (k - w, y > 0), (k + w, y < h - 1)):
                if ok and mask[n] and not seen[n]:
                    seen[n] = 1
                    stack.append(n)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def keep_large_components(mask: Sequence[int], w: int, h: int, min_frac: float = 0.1) -> bytearray:
    """Keeps the largest component and every other one at least `min_frac` of its size (a skirt split by an arm stays)."""
    comps = components(mask, w, h)
    out = bytearray(w * h)
    if not comps:
        return out
    floor = len(comps[0]) * min_frac
    for comp in comps:
        if len(comp) < floor:
            break
        for k in comp:
            out[k] = 1
    return out


def bbox(mask: Sequence[int], w: int, h: int) -> tuple[int, int, int, int] | None:
    """(x0, y0, x1, y1) with x1, y1 exclusive, or None for an empty mask."""
    _check(mask, w, h)
    rows = [y for y in range(h) if any(mask[y * w:(y + 1) * w])]
    if not rows:
        return None
    cols = [x for x in range(w) if any(mask[y * w + x] for y in range(rows[0], rows[-1] + 1))]
    return cols[0], rows[0], cols[-1] + 1, rows[-1] + 1


def touches_border(mask: Sequence[int], w: int, h: int) -> bool:
    b = bbox(mask, w, h)
    return b is not None and (b[0] == 0 or b[1] == 0 or b[2] == w or b[3] == h)


def rgb_diff_mask(a: Sequence[int], b: Sequence[int], w: int, h: int, threshold: int) -> bytearray:
    """1 where the largest per-channel absolute difference exceeds `threshold` (8-bit)."""
    if len(a) != 3 * w * h or len(b) != 3 * w * h:
        raise ValueError("RGB images must be 3*w*h bytes")
    return bytearray(
        1 if max(abs(a[i] - b[i]), abs(a[i + 1] - b[i + 1]), abs(a[i + 2] - b[i + 2])) > threshold else 0
        for i in range(0, 3 * w * h, 3)
    )


def background_mask(rgb: Sequence[int], w: int, h: int, bg: Sequence[int], tol: int) -> bytearray:
    """1 where every channel is within `tol` of the studio background colour."""
    if len(rgb) != 3 * w * h:
        raise ValueError("RGB image must be 3*w*h bytes")
    r0, g0, b0 = bg
    return bytearray(
        1 if abs(rgb[i] - r0) <= tol and abs(rgb[i + 1] - g0) <= tol and abs(rgb[i + 2] - b0) <= tol else 0
        for i in range(0, 3 * w * h, 3)
    )


def mean_abs_diff(a: Sequence[int], b: Sequence[int], mask: Sequence[int]) -> float | None:
    """Mean absolute 8-bit difference over the masked pixels (all three channels), None when the mask is empty."""
    total = n = 0
    for k, v in enumerate(mask):
        if v:
            i = 3 * k
            total += abs(a[i] - b[i]) + abs(a[i + 1] - b[i + 1]) + abs(a[i + 2] - b[i + 2])
            n += 3
    return None if n == 0 else total / n


def composite(bare: Sequence[int], generated: Sequence[int], mask: Sequence[int]) -> bytearray:
    """Our bare render with the generated pixels pasted inside the garment mask: mannequin, light and
    background stay exactly ours, so the still matches the control video at the pinned frame."""
    out = bytearray(bare)
    for k, v in enumerate(mask):
        if v:
            out[3 * k:3 * k + 3] = bytes(generated[3 * k:3 * k + 3])
    return out


def garment_prior(generated: Sequence[int], bare: Sequence[int], w: int, h: int, bg: Sequence[int], *, diff_threshold: int = 24, bg_tol: int = 10, open_r: int = 1) -> bytearray:
    """Garment from the dressed still alone: pixels that differ from our bare render and are not studio
    background, opened by `open_r` and reduced to the large components. The stage 3 difference idea;
    it misses a garment the colour of the mannequin, which is why SAM 2 refines it."""
    diff = rgb_diff_mask(generated, bare, w, h, diff_threshold)
    fg = mask_not(background_mask(generated, w, h, bg, bg_tol))
    m = mask_and(diff, fg)
    if open_r > 0:
        m = dilate(erode(m, w, h, open_r), w, h, open_r)
    return keep_large_components(m, w, h)


def choose_garment_mask(prior: Sequence[int], refined: Sequence[int] | None, min_agreement: float = 0.5) -> tuple[bytearray, str, float | None]:
    """SAM 2's mask when it agrees with the difference prior (IoU >= min_agreement), else the prior.
    Returns (mask, source, iou)."""
    if refined is None or mask_count(refined) == 0:
        return bytearray(prior), "difference", None
    iou = mask_iou(prior, refined)
    if mask_count(prior) == 0 or iou >= min_agreement:
        return bytearray(1 if v else 0 for v in refined), "sam2", iou
    return bytearray(prior), "difference (sam2 disagreed)", iou


def alignment_qa(
    garment: Sequence[int],
    foreground: Sequence[int],
    bare_mask: Sequence[int],
    w: int,
    h: int,
    margin_px: int,
    *,
    mannequin_mae: float | None = None,
    thresholds: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Checks that a dressed still is pixel-aligned with our mannequin at the pinned camera.

    garment     the garment mask in the still
    foreground  everything that is not studio background in the generated still (mannequin + garment)
    bare_mask   our bare-mannequin silhouette at the same frame (dress/bare_mask_<view>.png; NOT
                control/mask, which includes the proxy garment since phase0-export-0.2.0)

    inside_fraction   share of garment pixels within the silhouette dilated by `margin_px`
    silhouette_iou    IoU of (foreground - garment) and (bare - garment): where no cloth covers the
                      mannequin, the generated mannequin must sit exactly where ours is (pose, camera)
    cover_fraction    share of the silhouette the garment covers (0 = nothing was dressed)
    mannequin_mae     mean 8-bit difference of the uncovered mannequin, generated vs ours (given by the caller)
    """
    t = {**STAGE1B_QA_THRESHOLDS, **(thresholds or {})}
    _check(garment, w, h)
    _check(foreground, w, h)
    _check(bare_mask, w, h)
    g = mask_count(garment)
    b = mask_count(bare_mask)
    inside = mask_count(mask_and(garment, dilate(bare_mask, w, h, margin_px)))
    inside_fraction = 1.0 if g == 0 else inside / g
    sil_iou = mask_iou(mask_andnot(foreground, garment), mask_andnot(bare_mask, garment))
    cover = 0.0 if b == 0 else mask_count(mask_and(garment, bare_mask)) / b
    border = touches_border(garment, w, h)
    failures: list[str] = []
    if g == 0:
        failures.append("empty garment mask")
    if inside_fraction < t["min_inside_fraction"]:
        failures.append(f"garment outside the dilated silhouette: inside {inside_fraction:.3f} < {t['min_inside_fraction']}")
    if sil_iou < t["min_silhouette_iou"]:
        failures.append(f"mannequin moved or changed: silhouette IoU {sil_iou:.3f} < {t['min_silhouette_iou']}")
    if cover < t["min_cover_fraction"]:
        failures.append(f"garment covers {cover:.3f} of the mannequin < {t['min_cover_fraction']}")
    if border:
        failures.append("garment touches the frame border")
    if mannequin_mae is not None and mannequin_mae > t["max_mannequin_mae_8bit"]:
        failures.append(f"uncovered mannequin differs from our render: MAE {mannequin_mae:.1f} > {t['max_mannequin_mae_8bit']}")
    return {
        "garment_px": g,
        "silhouette_px": b,
        "margin_px": margin_px,
        "inside_fraction": round(inside_fraction, 4),
        "silhouette_iou": round(sil_iou, 4),
        "cover_fraction": round(cover, 4),
        "touches_border": border,
        "mannequin_mae_8bit": None if mannequin_mae is None else round(mannequin_mae, 2),
        "thresholds": t,
        "pass": not failures,
        "failures": failures,
    }


def fit_size(w: int, h: int, area: int, multiple: int = 16) -> tuple[int, int]:
    """(W, H) with the aspect of w x h, about `area` pixels, both multiples of `multiple` (the edit model's canvas)."""
    s = math.sqrt(area / (w * h))
    return max(multiple, int(round(w * s / multiple)) * multiple), max(multiple, int(round(h * s / multiple)) * multiple)


# Qwen-Image-Edit-Plus (diffusers 0.37.1, pipeline_qwenimage_edit_plus.py) encodes every input picture for the VAE
# at calculate_dimensions(VAE_IMAGE_SIZE = 1024 * 1024, width / height), rounded to multiples of 32. The output
# canvas must be that same size for picture 1 (our proxy-dressed render), or the output latent grid is a token
# column wider or narrower than picture 1's and the model, which copies positions token for token, can draw the
# mannequin shifted or scaled against the turntable camera. fit_size(480, 832, 1 MP, 16) gives 784 x 1344 (49 x 84
# tokens of 16 px) against picture 1's 768 x 1344 (48 x 84).
QWEN_VAE_IMAGE_AREA = 1024 * 1024


def qwen_canvas(w: int, h: int, area: int = QWEN_VAE_IMAGE_AREA) -> tuple[int, int]:
    """(W, H) of diffusers' `calculate_dimensions(area, w / h)` in the Qwen-Image-Edit-Plus pipeline: the size a
    w x h input picture is VAE-encoded at, multiples of 32. stage1_dress.py passes it as the output canvas and checks
    it against the pipeline's own function at run time."""
    ratio = w / h
    width = math.sqrt(area * ratio)
    height = width / ratio
    return int(round(width / 32) * 32), int(round(height / 32) * 32)


def candidate_id(engine: str, seed: int | None) -> str:
    """A stage 1b candidate's name: the engine for a one-draw-per-engine run (run 16a and before), `engine@seed` for a draw
    plan (`parse_draw_plan`, run 17a), where one view can hold several draws of one engine."""
    return engine if seed is None else f"{engine}@{int(seed)}"


def candidate_stem(view: str, cid: str) -> str:
    """File stem of a candidate: raw/<stem>.png, candidates/<stem>_garment_mask.png, ... (`front_fashn`, `front_fashn_s44`)."""
    eng, _, seed = cid.partition("@")
    return f"{view}_{eng}" + (f"_s{int(seed)}" if seed else "")


_STEM = re.compile(r"^(front|back)_(fashn|qwen)(?:_s(\d+))?$")


def parse_candidate_stem(stem: str) -> tuple[str, str] | None:
    """`front_fashn_s44` -> ("front", "fashn@44"), `back_qwen` -> ("back", "qwen"); None for anything else."""
    hit = _STEM.match(stem)
    return None if not hit else (hit.group(1), candidate_id(hit.group(2), None if hit.group(3) is None else int(hit.group(3))))


_PIN = re.compile(r"^(fashn|qwen)(?:@(\d+))?$")


def parse_dress_pins(text: str | None) -> dict[str, str]:
    """"front=qwen,back=fashn@44" -> {"front": "qwen", "back": "fashn@44"} (the run_phase0 --dress-pin option; a draw plan's
    candidates are named engine@seed)."""
    out: dict[str, str] = {}
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        view, _, eng = part.partition("=")
        view, eng = view.strip(), eng.strip()
        if view not in ("front", "back") or not _PIN.match(eng):
            raise ValueError(f"--dress-pin: {part!r} is not front|back=fashn|qwen[@seed]")
        out[view] = eng
    return out


# Run 17a: several draws per view in one container (the models load once), each candidate scored, then the front/back PAIR
# picked by the pair checks (phase0_dress.pick_pair). A cap so a typo ("44-4400") cannot buy a thousand draws.
MAX_PLAN_DRAWS = 24
_DRAW = re.compile(r"^(fashn|qwen)@(\d+)(?:-(\d+))?$")
_KEEP = re.compile(r"^keep:(fashn|qwen)(?:@(\d+))?$")


def parse_draw_plan(text: str | None) -> dict[str, dict[str, Any]] | None:
    """The --draws / --dress-draws option: "front=fashn@44-47,qwen@43-44;back=keep:fashn,qwen@43" ->
    {"front": {"draws": [["fashn", 44], ...], "keep": None}, "back": {"draws": [["qwen", 43]], "keep": {"engine": "fashn", "seed": None}}}.

    Per view (both views are required): `engine@seed` or `engine@first-last` draws, and at most one `keep:engine[@seed]`, the
    candidate of that engine (and seed) from this job's earlier stage 1b run in the jobs Volume, re-scored with the current QA
    and never re-drawn. None for an empty text. Raises ValueError for anything else: an unknown view or engine, a duplicate
    draw, a view without a candidate, no draw at all (re-scoring only is --recompose-dress), or more than `MAX_PLAN_DRAWS`."""
    if not (text or "").strip():
        return None
    plan: dict[str, dict[str, Any]] = {}
    for part in str(text).split(";"):
        part = part.strip()
        if not part:
            continue
        view, eq, items = part.partition("=")
        view = view.strip()
        if view not in ("front", "back") or not eq:
            raise ValueError(f"--draws: {part!r} is not front|back=<engine@seed[-seed]>[,...][,keep:<engine>[@seed]]")
        if view in plan:
            raise ValueError(f"--draws: {view} given twice")
        draws: list[list[Any]] = []
        keep = None
        for item in items.split(","):
            item = item.strip()
            d, k = _DRAW.match(item), _KEEP.match(item)
            if d:
                a = int(d.group(2))
                b = int(d.group(3)) if d.group(3) is not None else a
                if b < a:
                    raise ValueError(f"--draws: {item!r}: the seed range runs backwards")
                if b - a + 1 > MAX_PLAN_DRAWS:
                    raise ValueError(f"--draws: {item!r} is more than {MAX_PLAN_DRAWS} draws")
                for sd in range(a, b + 1):
                    if [d.group(1), sd] in draws:
                        raise ValueError(f"--draws: {view} draws {d.group(1)}@{sd} twice")
                    draws.append([d.group(1), sd])
            elif k:
                if keep is not None:
                    raise ValueError(f"--draws: {view} keeps two candidates; keep at most one per view")
                keep = {"engine": k.group(1), "seed": None if k.group(2) is None else int(k.group(2))}
            else:
                raise ValueError(f"--draws: {item!r} in {view} is not engine@seed, engine@first-last or keep:engine[@seed]")
        if keep is not None and keep["seed"] is not None and [keep["engine"], keep["seed"]] in draws:
            raise ValueError(f"--draws: {view} keeps and draws {keep['engine']}@{keep['seed']}")
        plan[view] = {"draws": draws, "keep": keep}
    missing = [v for v in ("front", "back") if v not in plan]
    if missing:
        raise ValueError(f"--draws: no plan for {', '.join(missing)} (both views need at least one draw or a keep)")
    n = sum(len(p["draws"]) for p in plan.values())
    if n == 0:
        raise ValueError("--draws: nothing to draw (keeping only is a re-score: use --recompose-dress)")
    if n > MAX_PLAN_DRAWS:
        raise ValueError(f"--draws: {n} draws > {MAX_PLAN_DRAWS}")
    return plan


def describe_draw_plan(plan: Mapping[str, Mapping[str, Any]]) -> str:
    """"front: fashn@44, qwen@43; back: keep fashn, qwen@43 (3 draws)" for the log."""
    parts = []
    for view, p in plan.items():
        items = [candidate_id(e, sd) for e, sd in p["draws"]]
        if p.get("keep"):
            items.insert(0, "keep " + candidate_id(p["keep"]["engine"], p["keep"]["seed"]))
        parts.append(f"{view}: {', '.join(items)}")
    return "; ".join(parts) + f" ({sum(len(p['draws']) for p in plan.values())} draws)"


def draw_plan_engines(plan: Mapping[str, Mapping[str, Any]]) -> str:
    """The engine weights a plan needs, as a --engine choice ("fashn", "qwen" or "both"); a keep loads no engine."""
    used = {e for p in plan.values() for e, _ in p["draws"]}
    return "both" if used == {"fashn", "qwen"} else next(iter(used))


# GPU seconds per draw on an H100 in run 16a (FASHN 5.2-8.5 s, Qwen 65.5-68.2 s) and the model load (FASHN 9.6-15 s, both
# 42.6-77.7 s); segmentation, masks and the finalize are on top. An ESTIMATE printed before the spend, not a measurement.
PLAN_SECONDS = {"fashn": 8.0, "qwen": 68.0, "load_fashn": 15.0, "load_qwen": 78.0, "per_view": 10.0}


def draw_plan_seconds(plan: Mapping[str, Mapping[str, Any]]) -> float:
    eng = draw_plan_engines(plan)
    s = sum(PLAN_SECONDS[e] for p in plan.values() for e, _ in p["draws"]) + 2 * PLAN_SECONDS["per_view"]
    s += PLAN_SECONDS["load_qwen"] if eng in ("qwen", "both") else PLAN_SECONDS["load_fashn"]
    return s


def pixel_sha256(rgb: bytes, w: int, h: int) -> str:
    """sha256 of a still's decoded pixels (8-bit RGB, row-major) with its size: the same image gives the same hash whatever
    the PNG encoder (zlib level, numpy / Pillow version), unlike a hash of the file (run 16b, review of 0.10.0)."""
    if len(rgb) != w * h * 3:
        raise ValueError(f"pixel_sha256: {len(rgb)} bytes is not {w}x{h} RGB")
    return hashlib.sha256(f"{w}x{h}x3:".encode() + bytes(rgb)).hexdigest()


def parse_dress_expect(text: str | None) -> dict[str, str]:
    """"front=<hex>,back=<hex>" -> {"front": ..., "back": ...} (the run_phase0 --dress-expect option): the pixel hash
    (`pixel_sha256`) each recomposed still must have; a hex prefix of at least 12 characters is enough."""
    out: dict[str, str] = {}
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        view, _, hx = part.partition("=")
        view, hx = view.strip(), hx.strip().lower()
        if view not in ("front", "back") or not re.fullmatch(r"[0-9a-f]{12,64}", hx):
            raise ValueError(f"--dress-expect: {part!r} is not front|back=<12-64 hex characters of the pixel sha256>")
        out[view] = hx
    return out


def dress_expect_problems(expect: Mapping[str, str], got: Mapping[str, str | None]) -> list[str]:
    """Each view whose still's pixel hash does not start with the expected one (a missing still counts)."""
    out = []
    for view, hx in expect.items():
        g = got.get(view)
        if g is None:
            out.append(f"{view}: no still to compare with the reviewed one (expected pixel sha256 {hx})")
        elif not g.startswith(hx):
            out.append(f"{view}: the still is not the one reviewed: pixel sha256 {g[:16]}..., expected {hx[:16]}...")
    return out


def stage1b_summary(views: Sequence[Mapping[str, Any]], *, invented_back: bool) -> dict[str, Any]:
    """Overall verdict over the per-view QA records; an invented back is a warning on every summary."""
    failed = [v["view"] for v in views if not v.get("qa", {}).get("pass")]
    # A garment-type failure (stage1b-qa-0.6.1 `type_failures`: legs merged, a bodice on a skirt or trousers, an open
    # front closed) is a different garment: `--accept-failed-dress` does not override it (run_phase0._dress_gate).
    type_failed = [v["view"] for v in views if (v.get("qa") or {}).get("type_failures")]
    warnings = [INVENTED_BACK_LABEL] if invented_back else []
    # stage1b-qa-0.12.0 (review of run 17a): engine pixels the composite left out of a picked still (a cut string below the hem,
    # `phase0_dress.trim_strands`) are named here, non-blocking: a still with pixels removed never passes silently
    for v in views:
        st = (v.get("qa") or {}).get("strands_trimmed") or {}
        if st.get("note"):
            warnings.append(f"{v['view']} still: {st['note']}")
    return {
        "pass": not failed,
        "failed_views": failed,
        "type_failed_views": type_failed,
        "type_failures": {v["view"]: list(v["qa"]["type_failures"]) for v in views if (v.get("qa") or {}).get("type_failures")},
        "invented_back": invented_back,
        "warnings": warnings,
        "label": STAGE1B_LABEL,
        "usable_for_stage2": not failed,
    }


# ---------------------------------------------------------------------------
# Stage 2: control mode, prompts and the per-frame garment-consistency metric
# ---------------------------------------------------------------------------
#
# The first GPU run (GitHub Actions run 10) drove Wan2.2-Fun-A14B-Control with the depth of the BARE
# mannequin (two separate legs) and a prompt holding the product title: between the pinned frames the
# dress turned into trousers (frames 20, 60, 100) and the title appeared as text in frame 20. Exports
# from phase0-export-0.2.0 on render the control with the mannequin wearing a coarse proxy garment
# (manifest `control.mode`, `control.proxy`, `control.proxy_mask_dir`) and carry neutral prompts
# (`prompt`). Stage 2 checks the prompts before it spends GPU time, and scores every generated frame
# against the proxy silhouette so drift shows up as numbers in stage2/record.json.

CONTROL_MODES = ("proxy", "bare")
# Always in the negative prompt (the title was rendered as text), matched as whole words.
PROMPT_REQUIRED_NEGATIVE = ("text", "letters", "words", "watermark", "logo")
# Per proxy kind: the garment the video must not turn into.
PROMPT_KIND_NEGATIVE = {
    "dress": ("trousers",),
    "skirt": ("trousers", "dress", "bodice"),
    "trousers": ("dress", "skirt", "bodice", "skort", "overskirt"),
    # A top or outerwear garment must not be drawn down to a dress (the exporter bans "dress, long skirt, trousers").
    "top": ("dress",),
    "outerwear": ("dress",),
}
# Outerwear with a front opening (manifest control.proxy.front_opening, export 0.6.0): it must stay open.
PROMPT_OPEN_FRONT_NEGATIVE = ("closed pullover",)

# Per-frame consistency thresholds. INITIAL VALUES, not tuned on any real output: set them from the
# first run with the proxy control. Computed on masks subsampled by CONSISTENCY_STRIDE.
CONSISTENCY_THRESHOLDS = {
    "min_silhouette_iou": 0.85,  # generated foreground vs control silhouette (mannequin + proxy), whole frame
    "min_zone_iou": 0.80,  # the same within the rows the proxy spans (the garment zone)
    "min_garment_cover": 0.90,  # share of the visible proxy the generated foreground covers
}
CONSISTENCY_STRIDE = 2
# The generated background is "plain light-grey" but not exactly ours: estimated per frame from the border.
CONSISTENCY_BG_TOL = 20
# A garment whose mean colour inside the proxy is within this many 8-bit levels of the background (per
# channel, max) is "low contrast": the border-colour foreground cannot separate it (white, cream and
# light-grey garments on the light-grey studio background), so its three numbers are unreliable.
CONSISTENCY_MIN_CONTRAST = 2 * CONSISTENCY_BG_TOL
# Rows with two or more runs (a gap between the legs) needed for a frame to count as drift-visible.
CONSISTENCY_MIN_GAP_ROWS = 2
CONSISTENCY_LABEL = (
    "garment consistency: generated frame silhouette vs the control proxy's, per frame (a drift check, "
    "not a measurement of the garment; the proxy is a coarse control signal). Blind spots: a dress turning "
    "into trousers is only visible where the legs are apart in the control (front/back views); around 90 and "
    "270 degrees the legs overlap and such frames read as consistent (`drift_visible` false, listed in "
    "`blind_frames`). White, cream and light-grey garments merge into the light-grey background, so their "
    "numbers drop for reasons other than drift (`low_contrast_frames`). garment_cover is measured against the "
    "proxy's guessed flare (dress default hem_flare 1.35): a correct but narrower garment can fall below it. "
    "Thresholds are initial values, to be set per proxy kind from the first proxy-control run."
)


def control_mode(m: Mapping[str, Any]) -> str:
    """'proxy' or 'bare'. Manifests before phase0-export-0.2.0 have no mode: their control was the bare mannequin."""
    mode = m["control"].get("mode", "bare")
    if mode not in CONTROL_MODES:
        raise ManifestError(f"unknown control mode {mode!r}; expected one of {', '.join(CONTROL_MODES)}")
    return mode


def video_prompts(m: Mapping[str, Any]) -> dict[str, Any]:
    """The stage 2 prompts the exporter wrote (turntable, motion, negative, description, kind)."""
    p = m.get("prompt")
    if not isinstance(p, Mapping) or not all(isinstance(p.get(k), str) and p.get(k) for k in ("turntable", "motion", "negative")):
        raise ManifestError("the manifest has no stage 2 prompt (exported before phase0-export-0.2.0); re-export the job")
    return dict(p)


def _has_word(text: str, phrase: str) -> bool:
    return re.search(r"(?<![a-z])" + re.escape(phrase.lower()) + r"(?![a-z])", text.lower()) is not None


def prompt_problems(m: Mapping[str, Any]) -> list[str]:
    """Reasons not to send the manifest's prompts to the video model (empty = fine): the product title or
    brand in a positive prompt, quoted text, or a negative prompt without the text/logo terms and, for a
    dress, skirt or trousers, without the garment the video must not turn into."""
    try:
        p = video_prompts(m)
    except ManifestError as e:
        return [str(e)]
    problems: list[str] = []
    product = m.get("hash_inputs", {}).get("product", {}) if isinstance(m.get("hash_inputs"), Mapping) else {}
    names = [("product title", m.get("product_name") or product.get("name")), ("brand", product.get("brand"))]
    for key in ("turntable", "motion"):
        text = p[key]
        for what, value in names:
            if value and str(value).strip().lower() in text.lower():
                problems.append(f"{key} prompt contains the {what} {value!r}")
        if '"' in text or "“" in text or "”" in text:
            problems.append(f"{key} prompt contains quoted text (models render it as letters)")
    colour = p.get("colour") if isinstance(p.get("colour"), Mapping) else {}
    if colour.get("name") and str(colour.get("source", "")).startswith(NAME_COLOUR_SOURCE):
        problems.append(
            f"prompt colour {colour['name']!r} was taken from a word of the product name (a print or collection name: run 13's "
            "\"Azure Palm\" cream print became blue); re-export with phase0-export-0.5.0 or later"
        )
    opening = ((m.get("control") or {}).get("proxy") or {}).get("front_opening") if isinstance(m.get("control"), Mapping) else None
    for term in PROMPT_REQUIRED_NEGATIVE + PROMPT_KIND_NEGATIVE.get(p.get("kind", ""), ()) + (PROMPT_OPEN_FRONT_NEGATIVE if opening else ()):
        if not _has_word(p["negative"], term):
            problems.append(f"negative prompt lacks {term!r}")
    return problems


def subsample(values: Sequence[int], w: int, h: int, stride: int, channels: int = 1) -> tuple[bytearray, int, int]:
    """Every `stride`-th pixel in x and y (nearest, no filtering): (values, w', h')."""
    if len(values) != w * h * channels:
        raise ValueError(f"expected {w}x{h}x{channels} values, got {len(values)}")
    if stride <= 1:
        return bytearray(values), w, h
    w2, h2 = (w + stride - 1) // stride, (h + stride - 1) // stride
    out = bytearray(w2 * h2 * channels)
    o = 0
    for y in range(0, h, stride):
        row = y * w
        for x in range(0, w, stride):
            i = (row + x) * channels
            out[o:o + channels] = bytes(values[i:i + channels])
            o += channels
    return out, w2, h2


def border_colour(rgb: Sequence[int], w: int, h: int, band: int = 2) -> tuple[int, int, int]:
    """Per-channel median of the pixels within `band` of the frame border: the frame's background colour."""
    if len(rgb) != 3 * w * h:
        raise ValueError("RGB image must be 3*w*h bytes")
    chans: list[list[int]] = [[], [], []]
    for y in range(h):
        for x in range(w):
            if band <= x < w - band and band <= y < h - band:
                continue
            i = 3 * (y * w + x)
            for c in range(3):
                chans[c].append(rgb[i + c])
    return tuple(sorted(ch)[len(ch) // 2] for ch in chans)  # type: ignore[return-value]


def frame_foreground(rgb: Sequence[int], w: int, h: int, *, tol: int = CONSISTENCY_BG_TOL, bg: Sequence[int] | None = None) -> bytearray:
    """Everything that is not background in a generated frame (mannequin + garment), opened by one pixel
    and reduced to its large components. The background colour is estimated from the border unless given."""
    colour = tuple(bg) if bg is not None else border_colour(rgb, w, h)
    fg = mask_not(background_mask(rgb, w, h, colour, tol))
    fg = dilate(erode(fg, w, h, 1), w, h, 1)
    return keep_large_components(fg, w, h, min_frac=0.05)


def gap_rows(mask: Sequence[int], w: int, h: int, y0: int, y1: int, x0: int = 0, x1: int | None = None) -> int:
    """Rows in [y0, y1) where the mask, between columns x0 and x1, has two or more separate runs: a gap
    between the legs (or between trouser legs)."""
    _check(mask, w, h)
    x1 = w if x1 is None else x1
    n = 0
    for y in range(max(0, y0), min(h, y1)):
        row = y * w
        runs, prev = 0, 0
        for x in range(max(0, x0), min(w, x1)):
            v = 1 if mask[row + x] else 0
            if v and not prev:
                runs += 1
            prev = v
        if runs >= 2:
            n += 1
    return n


def drift_visible(control: Sequence[int], proxy: Sequence[int], w: int, h: int, min_rows: int = CONSISTENCY_MIN_GAP_ROWS) -> bool:
    """Whether a dress<->trousers drift can show up in this frame's silhouette: the control (mannequin +
    proxy) has a gap between the legs below the proxy's hem, or the proxy itself has one (trousers),
    within the proxy's columns. Around 90/270 degrees the legs overlap, there is no gap, and a drift
    leaves the silhouette unchanged. A heuristic on our own render, not on the generated frame."""
    box = bbox(proxy, w, h)
    if box is None:
        return False
    x0, y0, x1, y1 = box
    return gap_rows(control, w, h, y1, h, x0, x1) >= min_rows or gap_rows(proxy, w, h, y0, y1, x0, x1) >= min_rows


def proxy_contrast(rgb: Sequence[int], proxy: Sequence[int], w: int, h: int, bg: Sequence[int] | None = None) -> float | None:
    """Max over channels of |mean colour inside the proxy - background colour| (8-bit). Low values mean
    the garment is close to the background colour and the foreground mask cannot see it."""
    if len(rgb) != 3 * w * h:
        raise ValueError("RGB image must be 3*w*h bytes")
    _check(proxy, w, h)
    colour = tuple(bg) if bg is not None else border_colour(rgb, w, h)
    sums = [0, 0, 0]
    n = 0
    for k, v in enumerate(proxy):
        if v:
            n += 1
            for c in range(3):
                sums[c] += rgb[3 * k + c]
    if n == 0:
        return None
    return round(max(abs(sums[c] / n - colour[c]) for c in range(3)), 2)


def frame_consistency(fg: Sequence[int], control: Sequence[int], proxy: Sequence[int] | None, w: int, h: int, *, rgb: Sequence[int] | None = None) -> dict[str, Any]:
    """One generated frame against the control: silhouette IoU over the frame and within the rows the
    proxy spans (the garment zone), and the share of the visible proxy the frame covers. With a proxy it
    also says whether a leg drift could be seen at all (`drift_visible`) and, given the frame's `rgb`,
    the garment's contrast against the background (`contrast`). Without a proxy (control mode bare)
    only the silhouette IoU exists."""
    _check(fg, w, h)
    _check(control, w, h)
    out: dict[str, Any] = {"silhouette_iou": round(mask_iou(fg, control), 4), "zone_iou": None, "garment_cover": None, "zone_rows": None, "drift_visible": None, "contrast": None}
    if proxy is None:
        return out
    _check(proxy, w, h)
    box = bbox(proxy, w, h)
    if box is None:
        return out
    _, y0, _, y1 = box
    lo, hi = y0 * w, y1 * w
    out["zone_iou"] = round(mask_iou(fg[lo:hi], control[lo:hi]), 4)
    p = mask_count(proxy)
    out["garment_cover"] = round(mask_count(mask_and(fg, proxy)) / p, 4)
    out["zone_rows"] = [y0, y1]
    out["drift_visible"] = drift_visible(control, proxy, w, h)
    if rgb is not None:
        out["contrast"] = proxy_contrast(rgb, proxy, w, h)
    return out


def consistency_flags(row: Mapping[str, Any], thresholds: Mapping[str, float] | None = None) -> list[str]:
    t = {**CONSISTENCY_THRESHOLDS, **(thresholds or {})}
    reasons: list[str] = []
    if row["silhouette_iou"] < t["min_silhouette_iou"]:
        reasons.append(f"silhouette IoU {row['silhouette_iou']:.3f} < {t['min_silhouette_iou']}")
    if row.get("zone_iou") is not None and row["zone_iou"] < t["min_zone_iou"]:
        reasons.append(f"garment-zone IoU {row['zone_iou']:.3f} < {t['min_zone_iou']}")
    if row.get("garment_cover") is not None and row["garment_cover"] < t["min_garment_cover"]:
        reasons.append(f"proxy covered {row['garment_cover']:.3f} < {t['min_garment_cover']}")
    return reasons


def consistency_summary(rows: Sequence[Mapping[str, Any]], *, mode: str, stride: int = CONSISTENCY_STRIDE, thresholds: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Stage 2's `consistency` block: every frame with its numbers and flags, the flagged frames, and
    min/mean per metric (overall and per clip). `rows` carry clip, j (frame in the clip), frame (camera
    index or motion index) and the frame_consistency numbers."""
    t = {**CONSISTENCY_THRESHOLDS, **(thresholds or {})}
    frames = []
    for r in rows:
        reasons = consistency_flags(r, t)
        frames.append({**r, "flagged": bool(reasons), "reasons": reasons})

    def stats(rs: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {"frames": len(rs), "flagged": sum(1 for r in rs if r["flagged"])}
        for k in ("silhouette_iou", "zone_iou", "garment_cover"):
            vals = [r[k] for r in rs if r.get(k) is not None]
            out[k] = None if not vals else {"min": round(min(vals), 4), "mean": round(sum(vals) / len(vals), 4)}
        return out

    clips: dict[str, list[Mapping[str, Any]]] = {}
    for f in frames:
        clips.setdefault(f["clip"], []).append(f)
    flagged = [{"clip": f["clip"], "j": f["j"], "frame": f["frame"], "reasons": f["reasons"]} for f in frames if f["flagged"]]
    ref = lambda f: {"clip": f["clip"], "j": f["j"], "frame": f["frame"]}  # noqa: E731
    blind = [ref(f) for f in frames if f.get("drift_visible") is False]
    low = [{**ref(f), "contrast": f["contrast"]} for f in frames if f.get("contrast") is not None and f["contrast"] < CONSISTENCY_MIN_CONTRAST]
    visible = [f for f in frames if f.get("drift_visible") is True]
    return {
        "reference": "control proxy (mannequin wearing the coarse proxy garment)" if mode == "proxy" else "bare mannequin: NOT a garment reference, only the silhouette IoU is reported",
        "control_mode": mode,
        "stride": stride,
        "thresholds": t,
        "thresholds_note": "initial values, not tuned on real output",
        **stats(frames),
        "per_clip": {c: stats(rs) for c, rs in clips.items()},
        "flagged_frames": flagged,
        # Frames where a leg drift cannot change the silhouette: their passing numbers prove nothing.
        "blind_frames": blind,
        "drift_visible": stats(visible) if visible else None,
        # Frames whose garment is close to the background colour: their numbers are unreliable either way.
        "low_contrast_frames": low,
        "min_contrast": CONSISTENCY_MIN_CONTRAST,
        "pass": not flagged,
        "label": CONSISTENCY_LABEL,
        "frames_detail": frames,
    }


def consistency_plan(m: Mapping[str, Any], clip_ids: Iterable[str] | None = None) -> list[dict[str, Any]]:
    """What to score: per generated clip frame, the generated PNG (stage2/clips/<clip>/NNNN.png), the
    control silhouette and the proxy mask (None in bare mode), as job-relative paths."""
    wanted = set(clip_ids) if clip_ids is not None else None
    plan = []
    for clip in m["clips"]:
        if wanted is not None and clip["id"] not in wanted:
            continue
        pdir = clip.get("proxy_mask_dir")
        for j, idx in enumerate(clip["frame_indices"]):
            plan.append({
                "clip": clip["id"], "j": j, "frame": idx,
                "generated": f"stage2/clips/{clip['id']}/{j:04d}.png",
                "control_mask": f"{clip['mask_dir']}/{idx:04d}.png",
                "proxy_mask": f"{pdir}/{idx:04d}.png" if pdir else None,
            })
    return plan
