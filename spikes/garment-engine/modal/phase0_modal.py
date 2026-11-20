"""Modal plumbing shared by the Phase 0 apps: the two Volumes and moving a job directory in and out.

Volumes (created on first use, in the workspace of the Modal token):
- curtain-phase0-weights: model weights (downloaded once per pinned revision) and the compiled gsplat
  CUDA extension cache.
- curtain-phase0-jobs: one directory per job id (`<productId>-<first 12 of input_hash>`), holding the
  exporter's files and the stage outputs (stage2/, stage4/).

The job id contains the input hash, so an uploaded job never changes under the same id.
"""
from __future__ import annotations

import os
import time

import modal

import phase0_lib as lib

WEIGHTS_VOLUME = "curtain-phase0-weights"
JOBS_VOLUME = "curtain-phase0-jobs"
WEIGHTS_DIR = "/weights"
JOBS_DIR = "/jobs"

weights = modal.Volume.from_name(WEIGHTS_VOLUME, create_if_missing=True)
jobs = modal.Volume.from_name(JOBS_VOLUME, create_if_missing=True)


def _is_file(entry) -> bool:
    t = getattr(entry, "type", None)
    return getattr(t, "name", str(t)) == "FILE" or t == 1


def load_local_job(job_dir: str) -> dict:
    """Reads and checks <job_dir>/manifest.json on the caller's computer."""
    path = os.path.join(job_dir, "manifest.json")
    if not os.path.exists(path):
        raise SystemExit(f"{path} not found: run `pnpm --filter @curtain/garment-spike export:phase0` first (see modal/README.md)")
    return lib.load_manifest(path)


def upload_job(job_dir: str, job_id: str, *, force: bool = False) -> int:
    """Uploads the exporter's files (not stage outputs) to /<job_id>/ in the jobs Volume. Skips when present."""
    if not force:
        try:
            if jobs.listdir(f"/{job_id}/manifest.json"):
                print(f"[upload] {job_id} already in Volume {JOBS_VOLUME}; skipping (same id = same inputs)")
                return 0
        except Exception:  # noqa: BLE001 - not found raises; any other error surfaces in the upload below
            pass
    files = lib.job_input_files(job_dir)
    t0 = time.time()
    with jobs.batch_upload(force=True) as batch:
        for rel in files:
            batch.put_file(os.path.join(job_dir, rel), f"/{job_id}/{rel}")
    size = sum(os.path.getsize(os.path.join(job_dir, r)) for r in files)
    print(f"[upload] {len(files)} files, {size / 1e6:.1f} MB to {JOBS_VOLUME}:/{job_id} in {time.time() - t0:.1f} s")
    return len(files)


def download_dir(job_dir: str, job_id: str, sub: str) -> int:
    """Copies /<job_id>/<sub>/ from the jobs Volume into <job_dir>/<sub>/. Returns the file count."""
    n = 0
    try:
        entries = jobs.listdir(f"/{job_id}/{sub}", recursive=True)
    except Exception as e:  # noqa: BLE001
        print(f"[download] nothing at {JOBS_VOLUME}:/{job_id}/{sub} ({e})")
        return 0
    for entry in entries:
        if not _is_file(entry):
            continue
        rel = entry.path.lstrip("/")
        prefix = f"{job_id}/"
        local = os.path.join(job_dir, rel[len(prefix):] if rel.startswith(prefix) else rel)
        os.makedirs(os.path.dirname(local), exist_ok=True)
        with open(local, "wb") as f:
            for chunk in jobs.read_file(entry.path):
                f.write(chunk)
        n += 1
    print(f"[download] {n} files from {JOBS_VOLUME}:/{job_id}/{sub} to {os.path.join(job_dir, sub)}")
    return n
