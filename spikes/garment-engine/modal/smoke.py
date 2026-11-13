"""Phase 0 smoke test on Modal (docs/ENGINE-HANDOFF.md, D16).

Checks three things before any real pipeline work, and prints what they cost:
1. a CPU function runs remotely (the Modal hello world),
2. a GPU container starts and sees its GPU (cold start time),
3. a small PyTorch matmul runs on that GPU (warm compute works).

Run:  modal run spikes/garment-engine/modal/smoke.py
Needs MODAL_TOKEN_ID and MODAL_TOKEN_SECRET in the environment (never in git).
CURTAIN_MODAL_GPU picks the GPU (default L4). CURTAIN_MODAL_REGION=eu pins the EU
region (needs a Modal plan that allows region selection; costs about 1.15x).
"""
import os
import time

import modal

GPU = os.environ.get("CURTAIN_MODAL_GPU") or "L4"
REGION = os.environ.get("CURTAIN_MODAL_REGION") or None

app = modal.App("curtain-phase0-smoke")
gpu_image = modal.Image.debian_slim(python_version="3.11").pip_install("torch==2.5.1")


@app.function(timeout=60)
def square(x: int) -> int:
    print("This code is running on a remote Modal worker.")
    return x * x


@app.function(gpu=GPU, image=gpu_image, timeout=600, region=REGION)
def gpu_probe() -> dict:
    import subprocess

    import torch

    started = time.time()
    info = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
    a = torch.randn(4096, 4096, device="cuda")
    torch.cuda.synchronize()
    t0 = time.time()
    for _ in range(20):
        a = a @ a
        a = a / a.norm()
    torch.cuda.synchronize()
    return {
        "gpu": info,
        "cuda": torch.cuda.is_available(),
        "matmul_20x_4096_s": round(time.time() - t0, 3),
        "in_container_s": round(time.time() - started, 3),
    }


@app.local_entrypoint()
def main():
    print("square(42) =", square.remote(42))
    t = time.time()
    result = gpu_probe.remote()
    result["wall_incl_cold_start_s"] = round(time.time() - t, 1)
    print("gpu_probe:", result)
    print(f"GPU={GPU} region={REGION or 'any'}; check the Modal dashboard for the exact cost of this run.")
