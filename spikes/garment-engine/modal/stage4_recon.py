"""Phase 0 stage 4 on Modal: posed frames + masks -> garment mesh (research doc, reconstruction A).

2D Gaussian splatting with gsplat's own `rasterization_2dgs` (Apache-2.0; never the Inria/2DGS
`diff_surfel_rasterization` backend, which is non-commercial), trained with:
  - an RGB L1 loss composited over a random background outside the mask (the mask loss on colour),
  - an alpha loss against the mask,
  - the 2DGS normal-consistency and distortion regularisers (gsplat's 2DGS example schedule),
  - gsplat's DefaultStrategy densification on the 2DGS gradient.
Gaussians start on the known mannequin surface, pushed out by 1.5 cm (the garment is outside the body).
Then median depth is rendered per view and fused with Open3D's TSDF, the mesh is cleaned, decimated to
8-15k triangles and written as .glb (metres, mannequin space: +Y up, +Z front), with metrics.json.

Sources:
  synthetic  the exporter's synthetic dressed turntable with ground-truth garment masks and a truth mesh,
             so the reconstruction error is measured (chamfer distance, F-score) without any video model
  stage2     stage 2's generated frames (stage2/frames). Masks: stage3/garment_mask if present, else a
             foreground mask from the background colour, and the mannequin is removed in 3D afterwards
             (vertices within --remove-cm of the known mannequin surface or inside it)

Run (from the repo root):
  modal run spikes/garment-engine/modal/stage4_recon.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2 --source synthetic
Options: --iterations 10000 --triangles 12000 --voxel-cm 0.4 --remove-cm 0.6 --download-only

Environment: CURTAIN_MODAL_GPU_RECON (default L40S), CURTAIN_MODAL_REGION, CURTAIN_MODAL_TIMEOUT_RECON.

NOT TESTED: nothing in this file has run on a GPU yet (the build container cannot reach Modal).
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import modal  # noqa: E402

import phase0_lib as lib  # noqa: E402
import phase0_mesh as pmesh  # noqa: E402
import phase0_modal as pm  # noqa: E402

CFG = lib.settings()
RECON = lib.PINNED_MODELS["recon"]
CUDA_ARCHS = "8.0;8.6;8.9;9.0"  # A100, A10, L4/L40S, H100
GSPLAT_EXT_DIR = "/opt/torch_extensions"

# Every Python package is pinned: requirements-stage4.in holds the direct pins (gsplat and Open3D at
# PINNED_MODELS["recon"]), requirements-stage4.txt the full lock compiled from it with
#   uv pip compile requirements-stage4.in --python-version 3.11 --python-platform x86_64-manylinux_2_31 --no-header --no-annotate -o requirements-stage4.txt
REQUIREMENTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements-stage4.txt")

app = modal.App("curtain-phase0-stage4-recon")

image = (
    # The devel image has nvcc, which gsplat needs to compile its CUDA extension (done once, at build time).
    modal.Image.from_registry("nvidia/cuda:12.6.3-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "libgl1", "libgomp1", "libglib2.0-0", "build-essential")
    .pip_install_from_requirements(REQUIREMENTS)
    .env({"TORCH_CUDA_ARCH_LIST": CUDA_ARCHS, "TORCH_EXTENSIONS_DIR": GSPLAT_EXT_DIR, "MAX_JOBS": "8"})
    .run_commands("python -c \"from gsplat.cuda._backend import _C; assert _C is not None, 'gsplat CUDA extension did not build'\"")
    .add_local_python_source("phase0_lib", "phase0_mesh", "phase0_modal")
)


def _load_rgb(path):
    import numpy as np
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def _load_mask(path):
    import numpy as np
    from PIL import Image

    return (np.asarray(Image.open(path).convert("L")) > 127).astype(np.float32)


@app.function(
    image=image,
    gpu=CFG["gpu_recon"],
    volumes={pm.JOBS_DIR: pm.jobs},
    timeout=CFG["timeout_recon"],
    region=CFG["region"],
)
def reconstruct(job_id: str, source: str = "synthetic", iterations: int = 10000, triangles: int = 12000, voxel_cm: float = 0.4, remove_cm: float = 0.6, holdout_every: int = 8) -> dict:
    import math
    import subprocess

    import numpy as np
    import torch
    import torch.nn.functional as F
    import trimesh
    from gsplat import rasterization_2dgs
    from gsplat.strategy import DefaultStrategy

    t_start = time.time()
    pm.jobs.reload()
    job = f"{pm.JOBS_DIR}/{job_id}"
    m = lib.load_manifest(f"{job}/manifest.json")
    out = f"{job}/stage4/{source}"
    os.makedirs(out, exist_ok=True)
    gpu_name = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
    seed = int(m["seeds"]["recon"])
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    dev = torch.device("cuda")

    # ---- inputs -----------------------------------------------------------------------------------
    with open(f"{job}/{m['camera']['opencv']}") as f:
        K, w2cs = lib.poses_from_opencv(json.load(f))
    W, H = m["camera"]["width"], m["camera"]["height"]
    if source == "synthetic":
        if not m.get("synthetic"):
            raise ValueError("this job was exported with --no-synthetic")
        frame_path = lambda i: f"{job}/{m['synthetic']['rgb_dir']}/{i:04d}.png"  # noqa: E731
        mask_path = lambda i: f"{job}/{m['synthetic']['garment_mask_dir']}/{i:04d}.png"  # noqa: E731
        mask_mode = "garment"
    elif source == "stage2":
        frame_path = lambda i: f"{job}/stage2/frames/{i:04d}.png"  # noqa: E731
        stage3 = f"{job}/stage3/garment_mask"
        mask_mode = "garment" if os.path.isdir(stage3) else "foreground"
        mask_path = (lambda i: f"{stage3}/{i:04d}.png") if mask_mode == "garment" else None  # noqa: E731
    else:
        raise ValueError(f"unknown source {source!r}: use synthetic or stage2")
    ids = sorted(w2cs)
    missing = [i for i in ids if not os.path.exists(frame_path(i))]
    if missing:
        raise FileNotFoundError(f"{len(missing)} frames missing for source {source} (first: {frame_path(missing[0])})")
    rgbs = np.stack([_load_rgb(frame_path(i)) for i in ids])
    masks = np.stack([_load_mask(mask_path(i)) if mask_path else pmesh.foreground_mask(rgbs[k]) for k, i in enumerate(ids)])
    holdout = [k for k in range(len(ids)) if holdout_every and k % holdout_every == holdout_every // 2]
    train = [k for k in range(len(ids)) if k not in holdout]
    images = torch.tensor(rgbs, device=dev)
    alphas_gt = torch.tensor(masks, device=dev)[..., None]
    viewmats = torch.tensor(np.array([w2cs[i] for i in ids]), dtype=torch.float32, device=dev)
    Ks = torch.tensor(np.array(K), dtype=torch.float32, device=dev)[None].expand(len(ids), 3, 3).contiguous()

    # ---- init on the known mannequin surface, pushed outwards ----------------------------------------
    body = trimesh.load(f"{job}/{m['mannequin']['glb']}", force="mesh")
    n_init = 60000
    pts, face_idx = trimesh.sample.sample_surface(body, n_init, seed=seed)
    normals = body.face_normals[face_idx]
    pts = pts + normals * (0.015 + 0.005 * rng.standard_normal((n_init, 1)))
    params = torch.nn.ParameterDict({
        "means": torch.nn.Parameter(torch.tensor(pts, dtype=torch.float32)),
        "scales": torch.nn.Parameter(torch.full((n_init, 3), math.log(0.006))),
        "quats": torch.nn.Parameter(torch.rand((n_init, 4))),
        "opacities": torch.nn.Parameter(torch.logit(torch.full((n_init,), 0.1))),
        "colors": torch.nn.Parameter(torch.logit(torch.full((n_init, 3), 0.5))),
    }).to(dev)
    scene_scale = 1.0  # metres; the mannequin fits in a 1 m radius
    lrs = {"means": 1.6e-4 * scene_scale, "scales": 5e-3, "quats": 1e-3, "opacities": 5e-2, "colors": 2.5e-3}
    optimizers = {k: torch.optim.Adam([{"params": params[k], "lr": lr, "name": k}], eps=1e-15) for k, lr in lrs.items()}
    means_sched = torch.optim.lr_scheduler.ExponentialLR(optimizers["means"], gamma=0.01 ** (1.0 / iterations))
    strategy = DefaultStrategy(
        prune_opa=0.05, grow_grad2d=0.0002, grow_scale3d=0.01, prune_scale3d=0.1,
        refine_start_iter=500, refine_stop_iter=int(iterations * 0.5), reset_every=3000, refine_every=100,
        key_for_gradient="gradient_2dgs", verbose=False,
    )
    strategy.check_sanity(params, optimizers)
    state = strategy.initialize_state(scene_scale=scene_scale)
    normal_start, dist_start = int(iterations * 0.25), int(iterations * 0.1)

    def render(idx: list[int], mode: str = "RGB+ED"):
        return rasterization_2dgs(
            means=params["means"], quats=params["quats"], scales=torch.exp(params["scales"]),
            opacities=torch.sigmoid(params["opacities"]), colors=torch.sigmoid(params["colors"]),
            viewmats=viewmats[idx], Ks=Ks[idx], width=W, height=H, render_mode=mode, distloss=True,
            near_plane=0.2, far_plane=20.0,
        )

    # ---- train -------------------------------------------------------------------------------------
    t0 = time.time()
    last = {}
    for step in range(iterations):
        k = int(rng.choice(train))
        colors, alphas, normals_r, normals_d, distort, _median, info = render([k])
        rgb = colors[..., :3]
        bg = torch.rand(1, 1, 1, 3, device=dev)
        rgb = rgb + bg * (1.0 - alphas)
        mask = alphas_gt[k][None]
        target = images[k][None] * mask + bg * (1.0 - mask)
        strategy.step_pre_backward(params, optimizers, state, step, info)
        l_rgb = F.l1_loss(rgb, target)
        l_alpha = F.l1_loss(alphas, mask)
        loss = l_rgb + l_alpha
        if step > normal_start:
            n_r = normals_r[0].permute(2, 0, 1)
            n_d = (normals_d[0] * alphas[0].detach()).permute(2, 0, 1)
            loss = loss + 0.05 * (1 - (n_r * n_d).sum(dim=0)).mean()
        if step > dist_start:
            loss = loss + 0.01 * distort.mean()
        loss.backward()
        strategy.step_post_backward(params, optimizers, state, step, info, packed=False)
        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)
        means_sched.step()
        if step % 1000 == 0 or step == iterations - 1:
            last = {"step": step, "loss": round(loss.item(), 5), "l_rgb": round(l_rgb.item(), 5), "l_alpha": round(l_alpha.item(), 5), "gaussians": int(params["means"].shape[0])}
            print(f"[stage4] {last}")
    train_s = time.time() - t0

    # ---- evaluate views, render median depth, fuse ------------------------------------------------------
    t0 = time.time()
    psnr = {"train": [], "holdout": []}
    iou = {"train": [], "holdout": []}
    depths, colors_u8 = [], []
    with torch.no_grad():
        for k in range(len(ids)):
            colors, alphas, _, _, _, median, _ = render([k])
            a = alphas[0, ..., 0]
            msk = alphas_gt[k][..., 0] > 0.5
            pred_mask = a > 0.5
            split = "holdout" if k in holdout else "train"
            iou[split].append((pred_mask & msk).sum().item() / max((pred_mask | msk).sum().item(), 1))
            if msk.any():
                mse = ((colors[0, ..., :3] - images[k]) ** 2)[msk].mean().item()
                psnr[split].append(10 * math.log10(1.0 / max(mse, 1e-10)))
            depths.append(torch.where(pred_mask & msk, median[0, ..., 0], torch.zeros_like(a)).cpu().numpy().astype(np.float32))
            colors_u8.append((images[k].clamp(0, 1).cpu().numpy() * 255).round().astype(np.uint8))
    mesh = pmesh.fuse_tsdf(depths, colors_u8, K, [w2cs[i] for i in ids], W, H, voxel_cm=voxel_cm)
    fuse_s = time.time() - t0

    # ---- mesh: remove the mannequin (foreground masks only), clean, decimate --------------------------
    t0 = time.time()
    raw_triangles = len(mesh.triangles)
    removed = pmesh.remove_near_surface(mesh, f"{job}/{m['mannequin']['glb']}", remove_cm) if mask_mode == "foreground" else 0
    mesh = pmesh.clean_and_decimate(mesh, triangles)
    mesh_s = time.time() - t0
    glb_bytes = pmesh.write_glb(mesh, f"{out}/garment.glb")
    truth = pmesh.compare_to_truth(mesh, f"{job}/{m['synthetic']['truth_glb']}", seed=seed) if source == "synthetic" and len(mesh.triangles) else None
    mean = lambda xs: round(float(np.mean(xs)), 4) if xs else None  # noqa: E731
    metrics = {
        "format": "curtain.phase0.recon-metrics",
        "job_id": job_id,
        "input_hash": m["input_hash"],
        "source": source,
        "mask_mode": mask_mode,
        "method": RECON,
        "gpu_name": gpu_name,
        "iterations": iterations,
        "frames": {"train": len(train), "holdout": len(holdout), "width": W, "height": H},
        "final": last,
        "psnr_masked": {"train": mean(psnr["train"]), "holdout": mean(psnr["holdout"])},
        "mask_iou": {"train": mean(iou["train"]), "holdout": mean(iou["holdout"])},
        "mesh": {**pmesh.mesh_report(mesh), "triangles_raw": raw_triangles, "removed_mannequin_vertices": removed, "voxel_cm": voxel_cm, "glb_bytes": glb_bytes},
        "vs_truth": truth,
        "seconds": {"train": round(train_s, 1), "fuse": round(fuse_s, 1), "mesh": round(mesh_s, 1)},
        "label": "reconstructed geometry: an estimate, not a measurement (AGENTS.md rule 3)",
    }
    gpu_seconds = time.time() - t_start
    metrics["cost"] = lib.cost_record(f"stage4_recon[{source}]", gpu=CFG["gpu_recon"], region=CFG["region"], gpu_seconds=gpu_seconds)
    with open(f"{out}/metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    pm.jobs.commit()
    return metrics


@app.local_entrypoint()
def main(job_dir: str, source: str = "synthetic", iterations: int = 10000, triangles: int = 12000, voxel_cm: float = 0.4, remove_cm: float = 0.6, download_only: bool = False, force_upload: bool = False):
    m = pm.load_local_job(job_dir)
    job_id = m["job_id"]
    if not download_only:
        pm.upload_job(job_dir, job_id, force=force_upload)
        t = time.time()
        metrics = reconstruct.remote(job_id, source=source, iterations=iterations, triangles=triangles, voxel_cm=voxel_cm, remove_cm=remove_cm)
        metrics["cost"] = lib.cost_record(metrics["cost"]["stage"], gpu=CFG["gpu_recon"], region=CFG["region"], gpu_seconds=metrics["cost"]["gpu_seconds"], wall_seconds=time.time() - t)
        print(json.dumps({k: metrics[k] for k in ("mask_mode", "psnr_masked", "mask_iou", "mesh", "vs_truth", "seconds")}, indent=2))
        print(lib.format_cost_table([metrics["cost"]]))
    pm.download_dir(job_dir, job_id, f"stage4/{source}")
