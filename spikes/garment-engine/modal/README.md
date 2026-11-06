# Phase 0 on Modal: stage 1b (dressing stills), stage 2 (video) and stage 4 (reconstruction)

GPU half of the Phase 0 spike (`docs/ENGINE-HANDOFF.md`), following shortlist A of `docs/research/garment-engine.md`:

- **Stage 1b** (optional, for shop photos): dresses our bare mannequin, rendered at the front and back camera of the turntable, from a shop photo of the garment on a person or flat-lay. Garment segmentation with Grounding DINO + SAM 2.1, try-on with FASHN VTON v1.5 or Qwen-Image-Edit-2511 (all Apache-2.0), alignment QA against our silhouette. Its output is the front and back still stage 2 pins. See [Stage 1b](#stage-1b-dress-our-mannequin-from-shop-photos).

- **Stage 2**: Wan2.2-Fun-A14B-Control (Apache-2.0), driven by the depth video of our own bare mannequin along the fixed turntable path, with the front and back stills pinned at the first and last frame of each half turn. Because the control video is our own render, the camera pose of every generated frame is known.
- **Stage 4**: 2D Gaussian splatting with gsplat's `rasterization_2dgs` (Apache-2.0) plus a mask loss, then Open3D TSDF fusion (MIT), cleanup and decimation to 8–15k triangles, written as `.glb`.

> **Status: nothing in this folder has run on a GPU.** The build container that wrote it cannot reach Modal, because the network proxy blocks gRPC. Everything that needs Modal or a GPU is untested; see [What is not tested](#what-is-not-tested). No cost or quality number here is measured. Every cost figure is an **estimate**: list price × seconds.

## Files

| File | What it is | Needs |
| --- | --- | --- |
| `smoke.py` | Modal hello world: CPU function, GPU cold start, torch matmul | Modal |
| `smoke_cpu.py` | The same without a GPU (login, image, remote call) | Modal |
| `stage1_dress.py` | Stage 1b app: weights download (once), `dress` (segment the shop photo, try-on onto our render, garment mask, alignment QA, composite, record) | Modal, GPU |
| `stage2_video.py` | Stage 2 app: weights download (once), `generate` (3 clips, assembled turntable, drift check, cost record) | Modal, GPU |
| `stage4_recon.py` | Stage 4 app: `reconstruct` (2DGS → TSDF → mesh → `.glb` + metrics + cost record) | Modal, GPU |
| `run_phase0.py` | Runs stage 2 and stage 4 for one product (stage 1b first with `--dress`) and prints the cost summary | Modal, GPU |
| `phase0_lib.py` | Pure Python: manifest checks and `input_hash`, pinned versions, pose conversions, clip assembly, cost estimate, settings; stage 1b pins, settings, manifest wiring, mask operations and alignment QA | nothing |
| `phase0_mesh.py` | GPU-free half of stage 4: TSDF fusion, mannequin removal, cleanup, decimation, truth comparison, `.glb` | numpy, scipy, Open3D, trimesh |
| `phase0_modal.py` | The two Volumes; job upload and download | Modal |
| `requirements-stage{1,2,4}.in` / `.txt` | Direct pins / full lock of each GPU image (stage1 = stage 1b) | — |
| `requirements-local.txt` | `modal`, `pytest` for your computer | — |
| `requirements-mesh-test.txt` | Optional: runs `tests/test_phase0_mesh.py` | — |
| `tests/` | pytest suite, plus a small exported job as a fixture | — |

The job files come from the TypeScript exporter in `spikes/garment-engine/src/export*.ts` (`pnpm --filter @curtain/garment-spike export:phase0`).

## Pinned versions

| What | Pin |
| --- | --- |
| Video weights | `alibaba-pai/Wan2.2-Fun-A14B-Control` @ `297be6d520f54908e124be0298e2317ee50ffdf4` (69.0 GB: two 28.6 GB transformers, an 11.4 GB T5 encoder and a 0.5 GB VAE) |
| Video code | VideoX-Fun @ `3e8d6867d3bff699bc85cd839f9802a5faa73aa3` (2025-09-18, Wan2.2-Fun era; its 2026 head imports Flux2/LTX2/Ministral3 and would need far newer diffusers/transformers) |
| Reconstruction | gsplat 1.5.3 (`937e29912570c372bed6747a5c9bf85fed877bae`), Open3D 0.19.0 |
| Python packages | Every package in each image, from `requirements-stage2.txt` and `requirements-stage4.txt` (uv lock for linux x86_64, Python 3.11) |
| Images | Stage 2 uses `debian_slim` with Python 3.11. Stage 4 uses `nvidia/cuda:12.6.3-devel-ubuntu22.04`, because gsplat's CUDA extension is compiled when the image is built. |

The pins appear twice, once in `phase0_lib.PINNED_MODELS` and once in `PINNED_MODELS` in `src/exportJob.ts`. The manifest carries them and is part of `input_hash`, and the Modal apps refuse a manifest whose pins differ. A pytest and a vitest check that the two copies agree. To change a pin, change both files, regenerate the lock (command in each stage file), re-export, and regenerate `tests/fixtures/` (command in `tests/test_phase0_lib.py`).

## Run it on your computer

All commands start at the repository root, on macOS or Linux with Node 22, pnpm 10 and Python 3.10–3.13.

### 1. Build the spike's dependencies (once)

```sh
flock /tmp/curtain-pnpm.lock pnpm install   # or plain `pnpm install` on a computer without the lock helper
pnpm build:packages
```

### 2. Modal client (once)

```sh
python3 -m venv .venv-modal && . .venv-modal/bin/activate
pip install -r spikes/garment-engine/modal/requirements-local.txt
modal setup
```

`modal setup` opens a browser to log in and writes the token to `~/.modal.toml`. That file is outside the repository; never copy the token into the repo. For CI, set `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` in the environment instead.

### 3. Smoke test (about a minute)

```sh
modal run spikes/garment-engine/modal/smoke.py
```

It prints `square(42) = 1764`, then `gpu_probe: {'gpu': '<name>, <memory>', 'cuda': True, 'matmul_20x_4096_s': …, 'in_container_s': …, 'wall_incl_cold_start_s': …}` and a line with the GPU and region. If this fails, nothing below will work: check `modal token current` and the plan's GPU access.

### 4. Export a job

With the merchant's photos:

```sh
pnpm --filter @curtain/garment-spike export:phase0 -- --product aalter-studio-2 \
  --front ~/phase0/aalter/front.jpg --back ~/phase0/aalter/back.jpg --detail ~/phase0/aalter/collar.jpg
```

For a dry run without photos, use the spike's synthetic garment rendered at the front and the back. The manifest marks these stills `synthetic: true`.

```sh
pnpm --filter @curtain/garment-spike export:phase0 -- --product all --synthetic-photos
```

The exporter prints one line per product, for example `[export:phase0] aalter-studio-2: job aalter-studio-2-<12 hex>, 160 turntable frames + 81 motion frames at 480×832, photos front (synthetic), back (synthetic), 1052 files, 17.6 MB, 14004 ms → …/out/phase0/aalter-studio-2`. Here it takes about 15 s per product. Output goes to `spikes/garment-engine/out/phase0/<productId>/`, which is gitignored:

| Path | Content |
| --- | --- |
| `manifest.json` | Product id and name, photos by role with sha256, base size, size chart as garment girths per anchor ring, fabric (`material.json` format), mannequin version and `.glb` sha256, camera, control encoding, clips, seeds, pinned models, `hash_inputs`, `input_hash` |
| `cameras_opencv.json` | `K` and a world-to-camera `w2c` per frame. OpenCV axes (x right, y down, z forward). World = mannequin space in metres, +Y up, +Z front. Pixel-corner origin (cx = W/2), as in COLMAP, Nerfstudio and gsplat; subtract 0.5 for Open3D/OpenCV. |
| `transforms.json` | The same poses for Nerfstudio (`transform_matrix` = camera-to-world, OpenGL axes). `file_path` points at `frames/NNNN.png`, which stage 2 fills. |
| `control/depth_mm/`, `control/depth_vis/`, `control/mask/` | Bare-mannequin depth (16-bit PNG, mm, 0 = background), the 8-bit control frames (near = 255) and the silhouette, for the 160 frames of `turntable_mid` |
| `motion/…` | The same for the 81 frames of the motion clip, seen from the fixed motion camera (radius 520 cm, so the raised arms stay in frame) |
| `mannequin.glb` | Base-size mannequin (M) in metres |
| `photos/` | `front`, `back` and `detail_N` |
| `synthetic/` | The synthetic garment dressed along the same path (`rgb/`, `garment_mask/`, `transforms.json`, `garment_truth.glb`), so stage 4 can be measured against a known mesh |

The front and back images must already show the garment **on the mannequin**, since they are the first and last frames of the video. For shop photos (garment on a person, or flat-lay) export with `--on-model` or `--flat-lay` instead and run stage 1b first ([Stage 1b](#stage-1b-dress-our-mannequin-from-shop-photos)). Otherwise use `--synthetic-photos`, or stills that someone has dressed by hand.

### 5. Cheapest real GPU test first: stage 4 on the synthetic frames

```sh
modal run spikes/garment-engine/modal/stage4_recon.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2 --source synthetic
```

This needs no video model. The first run builds the image, including compiling gsplat's CUDA kernels, which takes several minutes. The run then prints the training loss every 1000 steps, a JSON block (`mask_mode`, `psnr_masked`, `mask_iou` for train and held-out views, `mesh` (triangles, watertight, within budget), `vs_truth` (chamfer distance in cm, F-score at 1 and 2 cm against the true garment) and `seconds`), then the cost table. It downloads `stage4/synthetic/garment.glb` and `metrics.json` into the job dir.

### 6. One product end to end

```sh
CURTAIN_MODAL_REGION=eu modal run spikes/garment-engine/modal/run_phase0.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2
```

The run goes through these steps:

1. Checks the manifest and uploads the job to the `curtain-phase0-jobs` Volume. It skips the upload if that job id is already there; the id contains the input hash.
2. Downloads the 69 GB of weights into `curtain-phase0-weights`. This happens only the first time and prints `{'cached': False, 'bytes': …, 'download_s': …}`. Later runs print `cached: True`.
3. Runs stage 2. Per clip it prints `[stage2] turntable_a: 81 frames in … s`, then `[phase0] stage 2: 3 clips, 160 turntable frames, seams [...]`. The seams are the mean absolute 8-bit difference between the two half turns at the back frame and at the front frame: a drift check on the pinned frames.
4. Runs stage 4 on the generated frames and on the synthetic frames, in parallel.
5. Downloads `stage2/` (clips as mp4 and PNG, the 160 assembled `frames/`, `record.json`) and `stage4/<source>/`, and writes `cost_summary.json`.
6. Prints the cost table:

```
ESTIMATE (GPU list price x seconds; the Modal invoice is the measurement)
stage                     gpu         region       gpu s   wall s      low     high
stage2_video              H100        eu             …        …       $…       $…
stage4_recon[stage2]      L40S        eu             …        …       $…       $…
stage4_recon[synthetic]   L40S        eu             …        …       $…       $…
total                                                …                $…       $…
research doc estimate per product, one attempt: $1.3 (4-step) to $5.6 (40-step), also an estimate
```

In the table, `low` uses the seconds inside the container, model load included. `high` uses your wall clock, which also includes queueing and cold start.

Useful flags:

- `--steps 40`: denoising steps.
- `--skip-video`: reuse the `stage2/` outputs already in the Volume.
- `--no-synthetic-recon`
- `--control-encoding inverse`: 1/depth instead of linear depth.
- `--no-pin-frames`: reference image plus control only, no start or end frame.
- `--iterations 10000`, `--triangles 12000`
- `--force-upload`

Each stage also runs on its own:

```sh
modal run spikes/garment-engine/modal/stage2_video.py --job-dir … [--clips turntable_a] [--steps 40]
```

### Alternative: run through GitHub Actions

`.github/workflows/modal.yml` runs every line of `.github/modal/run.txt` on a GitHub runner when that file changes on a `claude/*` branch. GitHub runners can reach Modal. The workflow needs the repository secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`, and it uploads `spikes/garment-engine/out/` as an artifact.

The workflow does not build the workspace packages. It also passes only `CURTAIN_MODAL_GPU` and `CURTAIN_MODAL_REGION` through, not `CURTAIN_MODAL_GPU_VIDEO` or `CURTAIN_MODAL_GPU_RECON`, so the defaults apply. A first GPU run of this pipeline would therefore be:

```
pnpm build:packages && pnpm --filter @curtain/garment-spike export:phase0 -- --product aalter-studio-2 --synthetic-photos
modal run spikes/garment-engine/modal/stage4_recon.py --job-dir spikes/garment-engine/out/phase0/aalter-studio-2 --source synthetic
```

The job timeout is 120 minutes. Stage 2 with 40 steps, plus the first 69 GB weight download, may not fit in that.

### 7. Tests (no Modal, no GPU)

```sh
cd spikes/garment-engine/modal
python -m pytest -q tests                                    # 57 pass with requirements-local.txt; the mesh tests skip without numpy/Open3D
pip install -r requirements-mesh-test.txt && python -m pytest -q tests   # Python 3.10–3.12: 59 expected (33 before stage 1b; not re-run with Open3D since)
pnpm --filter @curtain/garment-spike test                    # includes the exporter tests (vitest)
```

## Stage 1b: dress our mannequin from shop photos

> **Validation tool, nothing measured yet.** `stage1_dress.py` has not run on Modal or a GPU. Every still it makes is generated (an estimate, AGENTS.md rule 3). When no back photo exists it **invents** the back; D13 says the merchant owns the back, so an invented back is for validation runs only and is flagged in the manifest, the stage 1b record, the stage 2 record (`stills`), `cost_summary.json` (`invented_back`, `invented_roles`, `stills`, read from the manifest, so also when stage 1b ran as its own step before `run_phase0.py`) and every log line. Shop photos and everything derived from them stay in `spikes/garment-engine/out/` (gitignored) and in the Modal jobs Volume; never commit them.

### Export a job from shop photos

```sh
pnpm --filter @curtain/garment-spike export:phase0 -- --product <id> --on-model \
  --front ~/shop/<product>/front.jpg [--back ~/shop/<product>/back.jpg] [--detail …]
```

`--on-model` means the photos show the garment on a person, `--flat-lay` a flat-lay or ghost mannequin. The exporter then writes:

| Path | Content |
| --- | --- |
| `dress/source_front.<ext>`, `dress/source_back.<ext>` | The shop photos, byte for byte (their sha256 is part of `input_hash`) |
| `dress/bare_front.png`, `dress/bare_back.png` | Our bare mannequin rendered at turntable frame 0 and N/2: same camera (`cameras_opencv.json`), same light, studio background `[235, 235, 235]`. The silhouettes are `control/mask/0000.png` and `control/mask/<N/2>.png` |
| `manifest.json` | `photos` front/back point at `stage1b/front.png` / `stage1b/back.png` with `produced_by: "stage1b"`, `sha256: null` and `invented` (true for a back without a photo); a `stage1b` section lists the sources, the two views and `invented_back` |

The product's category picks the try-on category (`dress` → one-pieces, `top`/`outerwear` → tops, `bottom` → bottoms). The spike exporter knows only its own product ids; a product from a shop must be added to `src/product.ts` first.

### Run stage 1b

```sh
modal run spikes/garment-engine/modal/stage1_dress.py --job-dir spikes/garment-engine/out/phase0/<id> [--engine fashn|qwen]
```

or as the first step of the full run (stage 2 only starts when both stills passed QA and, for an invented back, with `--allow-invented-back`):

```sh
modal run spikes/garment-engine/modal/run_phase0.py --job-dir spikes/garment-engine/out/phase0/<id> --dress --dress-engine fashn --allow-invented-back
modal run spikes/garment-engine/modal/run_phase0.py --job-dir … --dress --dress-only   # stage 1b only, no video
```

Per view (front first, then back) the app:

1. finds the garment in the shop photo: Grounding DINO box for the category prompt, SAM 2.1 mask from that box; writes `stage1b/source/<view>_mask.png` and a cut-out on studio grey;
2. dresses our render of that view: `fashn` = FASHN VTON v1.5 (person = our render, garment = shop photo, maskless, 30 steps), `qwen` = Qwen-Image-Edit-2511 (picture 1 = our render, picture 2 = the cut-out, 40 steps). Without a back photo the back is generated from the front photo (fashn) or from the dressed front still (qwen) and marked invented;
3. resizes the output to the frame (`stage1b/raw/<view>.png`), finds the garment by difference to our render, refines it with SAM 2 using that box (`mask_source` says which mask won), and runs the alignment QA;
4. pastes only the garment pixels into our bare render (`--no-composite` keeps the raw model output), so the mannequin, the light and the background of the pinned still are exactly those of the control video.

Alignment QA (`phase0_lib.alignment_qa`, thresholds in `STAGE1B_QA_THRESHOLDS`, **initial values, not tuned on any real output**):

| Metric | Meaning | Pass |
| --- | --- | --- |
| `inside_fraction` | Garment pixels inside our silhouette dilated by a margin (8 % of the frame height for one-pieces, 4 % tops, 6 % bottoms; about 16 cm for a dress) | ≥ 0.97 |
| `silhouette_iou` | Where no cloth covers the mannequin, the generated mannequin against ours: did the model keep pose and camera? | ≥ 0.90 |
| `cover_fraction` | Share of our silhouette the garment covers | ≥ 0.05 |
| `mannequin_mae_8bit` | Uncovered mannequin pixels, generated vs ours, before compositing | ≤ 25 |
| `touches_border` | Garment reaches the frame edge | false |

A still that passes goes to `stage1b/<view>.png`, where stage 2 reads it. A still that fails goes to `stage1b/rejected/<view>.png`, and stage 2 will not start (`--accept-failed` on the app or `--accept-failed-dress` on `run_phase0.py` overrides; the record then says `qa_overridden: true`). `stage1b/record.json` holds the pins, the engine, steps and seed, per view the method, the shop-photo segmentation, the DWPose keypoints found on our mannequin (fashn), the mask source, the QA numbers and the still's sha256, the summary and the cost estimate.

### Licences and what we do not use

FASHN VTON v1.5's weights and code are Apache-2.0, but its pipeline imports the **FASHN Human Parser**, a SegFormer fine-tune under the NVIDIA Source Code License for SegFormer (research or evaluation only), and the `fashn-human-parser` pip package inherits that licence. The image installs `fashn-vton` from its pinned commit with `--no-deps`, fails the build if `fashn_human_parser` is importable, provides the label constants itself, and feeds the pipeline our SAM 2 mask as its label map. `fashn-human-parser` is on the banned-model list. Details and the other candidates: research doc, section "Stage 1b".

### Pins (stage 1b)

| What | Pin |
| --- | --- |
| Garment box | `IDEA-Research/grounding-dino-base` @ `12bdfa3120f3e7ec7b434d90674b3396eccf88eb` (Apache-2.0, 0.9 GB) |
| Garment mask | `facebook/sam2.1-hiera-large` @ `665f8e2ad61cf5f53d65644ff27c8ee525124610` (Apache-2.0, 0.9 GB, transformers format) |
| Try-on | `fashn-ai/fashn-vton-1.5` @ `7720683168567eb5a2a4c67f15116c6e29c83ded` (Apache-2.0, 1.9 GB), code `fashn-AI/fashn-vton-1.5` @ `7c0f10af3f91ad4048fe9729c470a13ef905d25a`, DWPose ONNX `fashn-ai/DWPose` @ `548b5df25b84d9f4aac0611dfa1c2a7a12f15571` (Apache-2.0, 0.35 GB) |
| Image edit | `Qwen/Qwen-Image-Edit-2511` @ `6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9` (Apache-2.0, 57.7 GB) |
| Python packages | `requirements-stage1.txt` (uv lock, Python 3.11, linux x86_64); diffusers 0.37.1 because Qwen-Image-Edit-2511's transformer config sets `zero_cond_t`, which 0.36.0 does not know |

These pins live in `phase0_lib.STAGE1B_MODELS` and are written to `stage1b/record.json`. They are not part of `PINNED_MODELS` or `input_hash`, so adding stage 1b changed no existing job id.

### Settings

| Variable | Default | Effect |
| --- | --- | --- |
| `CURTAIN_MODAL_GPU_DRESS` | `H100` | GPU for `dress`. Qwen-Image-Edit-2511 needs about 58 GB in bf16; for `--engine fashn` alone an `L4` or `L40S` is enough (about 8 GB) |
| `CURTAIN_QWEN_CPU_OFFLOAD` | `0` | `1` = `enable_model_cpu_offload()` for a GPU with less memory (slower) |
| `CURTAIN_MODAL_TIMEOUT_DRESS` | 3600 s | Function timeout |
| `CURTAIN_MODAL_MEMORY_DRESS_MB` | 65536 | Container RAM |

The GitHub workflow passes only `CURTAIN_MODAL_GPU` and `CURTAIN_MODAL_REGION`, so on GitHub Actions the defaults apply.

### Cost (estimate, not measured)

No stage 1b run has happened, so there is no measured time. Planning figures: FASHN's model card gives about 5 s per image on an H100 at 30 steps; Qwen-Image-Edit-2511 at 40 steps on 1 MP has no published H100 time in the sources read, assume minutes per image. With model loading, one product (two views) is in the order of 2–5 GPU minutes on an H100 at Modal `eu`: about **$0.15–0.40** (3.95 $/h × 1.15). The first run also downloads about 4 GB (fashn) or 60 GB (qwen) of weights on a CPU container. The research doc's earlier "about $0.04 per product on an L40S" assumed one minute and is likely low for the Qwen engine. The record's `cost` block is list price × GPU seconds, marked `estimate: true`; the Modal invoice is the measurement.

### Not tested (stage 1b)

Everything that needs Modal or a GPU: the image build (the lock resolves; `pip install --no-deps` of fashn-vton and the parser check are untested), the weight downloads, the transformers calls for Grounding DINO and SAM 2 (written against transformers 4.57.3's documented API, not executed), FASHN's pipeline with our label maps in place of its parser, **whether DWPose finds a body on our grey mannequin** (the record counts the keypoints it found; if it finds none, FASHN's output will be poor and the qwen engine is the fallback), whether either model keeps our mannequin's pose and camera (that is what the QA measures), the QA thresholds, the back views, timings and costs. Tested without a GPU: the manifest wiring end to end through the TypeScript exporter, the mask operations, the alignment QA on synthetic scenes, the stage 2 gate in `run_phase0.py`, the requirement pins, and that the apps register without function-name clashes.

## Settings (environment variables)

| Variable | Default | Effect |
| --- | --- | --- |
| `CURTAIN_MODAL_REGION` | none (Modal picks) | `eu` pins the EEA at a 1.15× price. `eu-west`/`eu-north`/`eu-south` cost 1.75×. Region selection needs a Modal plan that allows it. |
| `CURTAIN_MODAL_GPU_VIDEO` | `H100` | GPU for stage 2. The A14B model needs about 80 GB of VRAM, or CPU offload. |
| `CURTAIN_MODAL_GPU_RECON` | `L40S` | GPU for stage 4. The image compiles kernels for `A100`, `A10`, `L4`, `L40S` and `H100`. |
| `CURTAIN_MODAL_TIMEOUT_VIDEO` / `_RECON` / `_DOWNLOAD` | 10800 / 3600 / 7200 s | Function timeouts |
| `CURTAIN_MODAL_MEMORY_VIDEO_MB` | 131072 | Container RAM for stage 2. The offloaded weights need about 70 GB. |
| `CURTAIN_WAN_MEMORY_MODE` | `model_cpu_offload` | `model_full_load`, `model_cpu_offload`, `model_cpu_offload_and_qfloat8` or `sequential_cpu_offload`, as in VideoX-Fun |

These variables are read when the app file is imported. Set them on the same command line as `modal run`.

## Expected cost (estimates, not measurements)

All figures come from the research doc (§5 list prices, §6 assumptions), at Modal `eu` (1.15×). They cover GPU time only: CPU and memory seconds, Volume storage and failed attempts are not included.

| Run | Estimate |
| --- | --- |
| `smoke.py` | Cents: about a minute of L4 time, cold start included |
| Weights download | One-time. It runs on a CPU container, not a GPU; the time and price are not estimated here. |
| Stage 2, 40 steps, 3 clips of 81 frames at 480×832 | About 60 min of H100 time ≈ **$4.5** (third-party estimate of about 20 min per clip at 720p; 480p should be faster, CPU offload slower) |
| Stage 4, one source, 10k iterations | About 20 min of L40S time ≈ **$0.75** (research doc assumption for 30k iterations; no published number for this setting) |
| `run_phase0.py`, one product (stage 2 + 2 × stage 4) | ≈ **$6** for one attempt. The research doc's range for one product and one method is $1.3–5.6. |
| Phase 0 budget in the research doc | $250 for GPU and API, failed runs included |

Every run writes its own cost record (`stage2/record.json` → `cost`, `stage4/<source>/metrics.json` → `cost`, `cost_summary.json`) with `"estimate": true`, the GPU, the region, the GPU seconds and the price source. Replace the estimates above with the Modal invoice in the Phase 0 write-up (acceptance item "Cost").

## What is not tested

Tested here:

- The exporter: vitest for pose conventions, PNG encoding, depth range, manifest hash stability and photo rules.
- `phase0_lib`: pytest, including the stage 1b helpers (`tests/test_stage1_dress.py`; its exporter round trip needs Node and `pnpm build:packages`, and skips otherwise).
- `phase0_mesh`: pytest with Open3D. This includes fusing depth rendered with the exporter's cameras and getting the surface back. Separately, fusing all 160 exported bare-mannequin depth frames reproduced `mannequin.glb` to 0.31 cm mean (voxel 0.4 cm) and the mannequin-removal step dropped 99.9% of its vertices. That was a one-off check, not a committed test.
- The four Modal apps import under modal 1.6.3, and their functions and `App.include` register without name clashes.

Not tested, because each of these needs Modal or a GPU:

- Any `modal run`, including `smoke.py` from this container.
- Both image builds: the lock files resolve, but no image has been built. The gsplat CUDA compile at build time is the step most likely to need a fix.
- The Wan2.2 weights download and loading, the memory modes, and whether 128 GB of RAM is enough.
- Whether **Wan2.2-Fun-A14B-Control accepts start and end frames together with a control video**. The VideoX-Fun example passes `start_image=None` by default. If the pinned frames do not hold, use `--no-pin-frames`, or try the InP variant as the research doc suggests.
- Whether the depth encoding suits the model: it was trained on depth from a monocular estimator, not our linear metric encoding (`--control-encoding inverse` is the alternative).
- Video quality, the turntable assembly on real output, and the seam drift numbers.
- gsplat 2DGS training: learning rates, densification and the mask loss on our scenes, the iteration count, and the median-depth TSDF on thin cloth.
- The `foreground` mask mode on generated frames, followed by removing the mannequin in 3D. Garment within `--remove-cm` (0.6 cm) of the body is removed with it. Stage 3's garment masks (`stage3/garment_mask/`, used automatically when present) are the real answer.
- Timings, GPU seconds and costs.

Built but not run: the dressing stills (stage 1b, see its section). Not built: stage 3 on generated frames, the 4-step LightWan path, the hosted Kling path (shortlist B), NeuS reconstruction (method B), texture projection, and the Koyeb comparison.

## Privacy

Only product data leaves the computer: merchant product photos, the mannequin and the size chart (D3, AGENTS.md rule 1). No shopper photo, measurement or device id goes into any job. Generated videos and meshes are estimates, labelled as such in every record (rule 3). Fit and size stay with `@curtain/fit-engine` on the device (rule 4). Nothing here computes a fit.
