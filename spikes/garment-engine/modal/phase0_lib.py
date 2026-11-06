"""Pure-Python helpers for the Phase 0 Modal apps (docs/ENGINE-HANDOFF.md, docs/research/garment-engine.md).

No third-party imports here, and never `modal`: this module is imported by the Modal apps (inside
and outside the container) and by the local pytest suite, which runs without Modal, numpy or a GPU.

What lives here:
- pinned model and code versions (must equal PINNED_MODELS in src/exportJob.ts),
- job manifest loading and input_hash verification (canonical JSON identical to the exporter),
- camera pose conversions between OpenCV world-to-camera and Nerfstudio/OpenGL camera-to-world,
- turntable clip assembly (two half-turn clips -> one frame per camera pose),
- the GPU cost estimate (list prices from the research doc; always marked as an estimate),
- run settings from environment variables (GPU type, region, timeouts).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
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
