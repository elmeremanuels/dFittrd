# Phase 0 on Modal: stage 1b (dressing stills), stage 2 (video) and stage 4 (reconstruction)

GPU half of the Phase 0 spike (`docs/ENGINE-HANDOFF.md`), following shortlist A of `docs/research/garment-engine.md`:

- **Stage 1b** (optional, for shop photos): dresses our bare mannequin, rendered at the front and back camera of the turntable, from a shop photo of the garment on a person or flat-lay. Garment segmentation with Grounding DINO + SAM 2.1, try-on with FASHN VTON v1.5 or Qwen-Image-Edit-2511 (all Apache-2.0), alignment QA against our silhouette. Its output is the front and back still stage 2 pins. See [Stage 1b](#stage-1b-dress-our-mannequin-from-shop-photos).

- **Stage 2**: Wan2.2-Fun-A14B-Control (Apache-2.0), driven by the depth video of our own mannequin **wearing a coarse proxy garment** (from the category and the size chart; `--control bare` renders the bare mannequin) along the fixed turntable path, with the front and back stills pinned at the first and last frame of each half turn. Because the control video is our own render, the camera pose of every generated frame is known. The prompts are neutral (no product title, no brand) and every generated frame's garment is scored against the pinned stills carried to its camera. See [Stage 2 after run 10](#stage-2-after-run-10-control-proxy-neutral-prompts-consistency-metric) and [Stage 2 after run 11](#stage-2-after-run-11-garment-masks-consistency-v2-stage-4-alpha-targets-proxy-length).
- **Stage 4**: 2D Gaussian splatting with gsplat's `rasterization_2dgs` (Apache-2.0) plus a mask loss (on generated frames: our garment masks by default), then Open3D TSDF fusion (MIT), cleanup and decimation to 8–15k triangles, written as `.glb`.

> **Status.** The build container that wrote this folder cannot reach Modal (the network proxy blocks gRPC); runs go through GitHub Actions. Stage 4 on synthetic frames and one full `run_phase0.py` (run 10: stage 2 on an H100, about 24 min, cost estimate $1.59; stage 4 on an L40S) have run there. Run 10 showed the dress turning into trousers between the pinned frames and the product name rendered as text; run 11a (proxy control, neutral prompts) kept the dress a dress and drew no text; its consistency and stage 4 numbers were wrong for reasons in our code, fixed and re-measured on its output on CPU (see [Stage 2 after run 11](#stage-2-after-run-11-garment-masks-consistency-v2-stage-4-alpha-targets-proxy-length)); export 0.3.0 and the new stage 4 alpha targets **have not run on a GPU yet**. See [What is not tested](#what-is-not-tested). Every cost figure is an **estimate**: list price × seconds.

## Files

| File | What it is | Needs |
| --- | --- | --- |
| `smoke.py` | Modal hello world: CPU function, GPU cold start, torch matmul | Modal |
| `smoke_cpu.py` | The same without a GPU (login, image, remote call) | Modal |
| `stage1_dress.py` | Stage 1b app: weights download (once), `dress` (segment the shop photo, try-on onto our render, garment mask, alignment QA, composite, record) | Modal, GPU |
| `stage2_video.py` | Stage 2 app: weights download (once), `generate` (3 clips with the manifest's prompts, assembled turntable, drift check, cost record), `score_consistency` (CPU: per-frame silhouette vs the control proxy) | Modal, GPU |
| `stage4_recon.py` | Stage 4 app: `reconstruct` (2DGS → TSDF → mesh → `.glb` + metrics + cost record) | Modal, GPU |
| `stage4b_retexture.py` | Stage 4b app (CPU, pure Python, no video model): re-textures a cut family's reference mesh for one colour/print variant from the variant's stage 1b front/back stills; writes `stage4b/<source>/variants/<id>/{texture.png, material.json, preview.glb, record.json}` and `variants.json` into the reference job | Modal (CPU) |
| `run_phase0.py` | Runs stage 2 and stage 4 for one product (stage 1b first with `--dress`) and prints the cost summary | Modal, GPU |
| `phase0_lib.py` | Pure Python: manifest checks and `input_hash`, pinned versions, pose conversions, clip assembly, cost estimate, settings; stage 1b pins, settings, manifest wiring, mask operations and alignment QA; stage 2 control mode, prompt guard and garment-consistency metric | nothing |
| `phase0_garment.py` | numpy + Pillow, CPU: garment masks of generated frames (against our bare mannequin and a background model), consistency v2 (pinned stills carried by the camera through a visual hull), stage 4 alpha targets and their check against the synthetic truth; `python phase0_garment.py <job> --write-masks --score` | numpy, Pillow |
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
| `manifest.json` | Product id and name, `product_source` (spike fixture or shop), photos by role with sha256, base size, size chart as garment girths per anchor ring, fabric (`material.json` format), mannequin version and `.glb` sha256, camera, control mode, proxy spec and encoding, stage 2 prompts, clips, seeds, pinned models, `hash_inputs`, `input_hash` (control mode, proxy spec and prompts are hashed) |
| `cameras_opencv.json` | `K` and a world-to-camera `w2c` per frame. OpenCV axes (x right, y down, z forward). World = mannequin space in metres, +Y up, +Z front. Pixel-corner origin (cx = W/2), as in COLMAP, Nerfstudio and gsplat; subtract 0.5 for Open3D/OpenCV. |
| `transforms.json` | The same poses for Nerfstudio (`transform_matrix` = camera-to-world, OpenGL axes). `file_path` points at `frames/NNNN.png`, which stage 2 fills. |
| `control/depth_mm/`, `control/depth_vis/`, `control/mask/` | Control depth (16-bit PNG, mm, 0 = background), the 8-bit control frames (near = 255) and the silhouette, for the 160 frames of `turntable_mid`: the mannequin wearing the proxy garment (`--control proxy`, default) or the bare mannequin (`--control bare`) |
| `control/proxy_mask/`, `control/proxy.glb` | Proxy mode only: where the proxy is visible per frame (the reference of the consistency metric), and the proxy volume in metres (inspection only) |
| `motion/…` | The same for the 81 frames of the motion clip, seen from the fixed motion camera (radius 520 cm, so the raised arms stay in frame); the proxy is posed with the mannequin's rig |
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
python -m pytest -q tests                                    # with requirements-local.txt; the mesh tests skip without numpy/Open3D, the garment tests without numpy/Pillow
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

The product's category picks the try-on category (`dress` → one-pieces, `top`/`outerwear` → tops, `bottom` → bottoms). `dress/bare_mask_<view>.png` is the bare mannequin's silhouette at that frame: the alignment QA compares with our mannequin, not with the control proxy.

### Export a product of a validated shop

```sh
pnpm --filter @curtain/garment-spike shop:bohohippychic -- --fetch-images   # images of the committed images.json into data/bohohippychic/raw/ (gitignored); writes no JSON
pnpm --filter @curtain/garment-spike export:phase0 -- --shop bohohippychic --product azure-palm-baby-doll-dress
```

The payload, size chart and base size (AU 12, ours) come from the committed `data/bohohippychic/products.json`, the photos from `images.json` and `raw/`: per role a no-model photo on a plain background first, else the first photo of that role that shows the whole garment (`--front-image N` / `--back-image N` pick positions by hand). `--on-model` or `--flat-lay` follow from the chosen front photo. Without `raw/<handle>/` the exporter stops and names the `--fetch-images` command. The hand classification (front/back, on model) is keyed by image position and pinned by the sha256 in the **committed** `images.json`: `--fetch-images` downloads from the committed URLs and refuses bytes with another hash before writing them, and the exporter checks the hash again. Neither rewrites `images.json`, so on a fresh runner a changed or reordered shop photo fails the run instead of silently taking the old classification. A full `shop:bohohippychic -- --fetch` (local maintenance: re-reads the catalogue and rebuilds `products.json` and `images.json`) refuses to write when any image's hash, URL or position changed, until the classification in `src/shopSelection.ts` was reviewed and it is re-run with `--accept-image-changes`. Re-fetching is never the fix for a hash mismatch. Only the five validation products can be exported; a runner-up such as `seraphina-embroidered-mirror-work-maxi-dress` has no payload or image classification yet. The synthetic garment (stage 4 truth) exists for dresses and tops only; trousers, skirts and outerwear export without `synthetic/`.

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

## Stage 2 after run 10: control proxy, neutral prompts, consistency metric

Run 10 (GitHub Actions, aalter-studio-2, synthetic stills) followed the pinned front and back frames and the camera path, but between them the dress turned into trousers (frames 20, 60, 100) and the product name appeared as text in frame 20; stage 4 on those frames reached a mask IoU of 0.90, against 0.99 on the synthetic truth. Two causes: the control depth showed the **bare** mannequin (two separate legs), and the prompt held the product title in quotes. Export 0.2.0 changes three things. None of them has run on a GPU yet.

**Control proxy** (`src/proxy.ts`, `--control proxy|bare`, default `proxy`, in the manifest as `control.mode` / `control.proxy` and in `input_hash`). The control video shows our mannequin wearing a coarse, closed garment volume built only from the category and the chart at the base size:

| Kind | Proxy |
| --- | --- |
| dress | one closed volume from just below the neck to the hem (chart length), chart girths + ease at chest, waist and hip, flaring below the hip and always clearing both legs; sleeves when the product gives a sleeve length |
| skirt (a bottom whose subcategory or pattern says skirt) | one closed volume from the waist to the hem |
| trousers (other bottoms) | a seat from the waist to the crotch, then two closed legs to the hem (outseam or inseam), with a gap between them; wide-leg patterns widen the legs |
| top, outerwear | torso shell to the hem (default just below the hip) and sleeves to the sleeve length (outerwear without one: to the wrist) |

Girths follow `evalChart`: a garment chart as printed (a one-size product's flat measurements, doubled by the shop parser), a body chart plus the product's ease, else the fit engine's category default ease; rings without a chart value get the mannequin's girth plus a proxy default. A girth below the mannequin's body + 1 cm is raised and the spec says so. A test measures the proxy mesh at every anchor and finds the chart value within 1 cm, and checks that a dress or skirt proxy has no gap between the legs in the rendered depth (front, back and diagonals) while trousers keep theirs. The proxy is only the control signal: no anchor, grading or fit step reads it, and it never appears in an output.

**Prompts** (manifest `prompt`, hashed). A neutral description made only of fixed vocabulary: colour (nearest basic colour of `primaryColorHex`, else a colour word of the name mapped to a plain colour; the word itself is not used), length, sleeves, a plain style word and the fabric, e.g. *"a blue knee-length babydoll dress in a fluid viscose fabric, one closed skirt that falls from the waist to the hem and covers both legs"*. Never the product title, the brand or quotes. The negative prompt always holds text, letters, words, captions, typography, watermark, logo, label and brand name, plus trousers / pants / shorts / two separate legs of fabric for a dress or skirt, and dress / skirt / gown for trousers. `stage2_video.py` and `run_phase0.py` refuse a manifest whose prompts fail `lib.prompt_problems` (title, brand, quotes, missing negative terms) or that has no prompts (exported before 0.2.0: re-export).

**Garment consistency v1** (superseded after run 11 by v2, see the next section; still written as `stage2/record.json` → `consistency_v1`). (`stage2_video.score_consistency`, a CPU function that runs after `generate`; `cost_summary.json` → `stage2.consistency` without the per-frame list). For every generated clip frame, at stride 2: the frame's foreground (background colour estimated from the border, opened, small specks dropped) against the control silhouette at the same pose (`silhouette_iou`), the same IoU within the rows the proxy spans (`zone_iou`), and the share of the visible proxy the frame covers (`garment_cover`). A frame is flagged when one is below `CONSISTENCY_THRESHOLDS` (0.85 / 0.80 / 0.90, **initial values, not tuned on real output**). Trousers drawn over a dress proxy leave the gap between the legs uncovered (low `garment_cover`); a skirt drawn over a trouser proxy fills the gap (low `zone_iou`). The record lists every frame, the flagged frames with reasons, and min/mean per metric overall and per clip. With `--control bare` only the silhouette IoU is reported, and the record says the bare mannequin is no garment reference.

What the metric cannot see, and says so in the record (`label`, `blind_frames`, `low_contrast_frames`):

- **Side views.** Trousers over a dress proxy show up as background between the legs. Around 90° and 270° the legs overlap, so a drifted frame has the same silhouette as a correct one and passes. Each frame carries `drift_visible` (our own control has a gap between the legs below the proxy's hem, or the proxy itself has one, within the proxy's columns); frames without it are listed in `blind_frames`, and `drift_visible` in the summary gives min/mean over the frames that can show drift. Read a pass on blind frames as "no evidence", not as "consistent".
- **Light garments.** The foreground is everything that differs from the border colour by more than 20 levels. White, cream and light-grey garments (Celeste White, Luna Cami White, the Heirloom lace) merge into the light-grey background and all three numbers drop for that reason alone. Each frame carries `contrast` (mean colour inside the proxy vs the background, max over channels); frames below `CONSISTENCY_MIN_CONTRAST` (40) are listed in `low_contrast_frames`.
- **The proxy's guessed flare.** `garment_cover` is measured against the proxy, whose dress flare is a default (hem_flare 1.35 for a babydoll, e.g. Azure Palm with girths 102/84/81.5/110). A correct but narrower dress covers less of it and can fall below 0.90. Set `min_garment_cover` per proxy kind from the first proxy-control run (run 11), not before.

Re-score without the GPU: `modal run spikes/garment-engine/modal/stage2_video.py --job-dir … --consistency-only`.

## Stage 2 after run 11: garment masks, consistency v2, stage 4 alpha targets, proxy length

Run 11a (GitHub Actions, aalter-studio-2, export 0.2.0 with the proxy control, synthetic stills) kept the dress a dress in every frame and drew no text. Three of its numbers were wrong for reasons in our code, not in the video:

- **Consistency v1 flagged 233 of 243 frames**, frame 0 included, which is the pinned still itself (silhouette IoU 0.74). v1's "garment" was every pixel 20 levels off the border colour: a cream dress (#F2EBDD) on the light-grey studio loses its light parts, and every frame was compared with the coarse proxy silhouette. 188 of the frames re-scored with v1 on run 10 were low-contrast.
- **Stage 4 on the generated frames reached mask IoU 0.84** (run 10: 0.90). Stage 4 trained against the same kind of border-colour foreground (`phase0_mesh.foreground_mask`, mannequin included). Emulated here on the pinned frames, that target misses 15,142 and 17,988 of the 72,378 garment pixels (21% and 25%; IoU 0.67 / 0.64 with the garment, 0.82 / 0.78 with garment + mannequin). The 0.84 is the reconstruction agreeing with a poor target, not a property of the garment.
- **The hem.** The generated hem was reported higher than the truth. Measured, it is not: the proxy's hem is the synthetic truth's hem in all 160 frames (both 26.6 cm above the floor, `shoulder_to_hem` 112 cm; proxy and truth garment masks overlap at IoU 0.996–0.999), and the generated garment's hem sits a median 1 px (0.3 cm) **below** the truth's (90th percentile 7 px; up to 41 px in 22 frames where a leg or shadow touches the hem).

**Garment masks** (`phase0_garment.segment_garment`, numpy + Pillow, CPU). The garment in a generated frame is found from what we know about the scene: our bare mannequin's full silhouette at the same camera (exported as `control/bare_mask/` and `motion/bare_mask/` since export 0.3.0; for older proxy jobs rendered from `mannequin.glb` at the turntable cameras, or the visible mannequin outside the proxy in the motion clip). Inside it a pixel is mannequin or garment, never background, so a light garment is found there whatever its contrast. The mannequin colour model (chroma ceiling and brightness range) is sampled from the frame's own head, hands and legs; where our control shows bare mannequin a looser test applies (colour bleeds from the cuffs onto the hands). Outside the body the garment is what differs from a smooth background model (a quadratic per channel fitted outside the loose envelope: noise about 0.5 levels, thresholds 6/14 with hysteresis) and connects to the garment on the body. Holes are filled except where our control shows mannequin in front (a hand over the skirt). A garment the colour of the grey mannequin cannot be told from it (`ambiguous_with_mannequin`; on the body the proxy is used then). Text, logos and props far from the envelope are counted as `stray_px`.

**Consistency v2** (`stage2_video.score_consistency` → `stage2/record.json` `consistency`; v1 stays as `consistency_v1` for comparison). Each generated turntable frame's garment mask is compared with the **pinned stills carried to its camera**: a 1 cm visual hull carved by the front and back still's garment masks (tight) and by the proxy silhouette of every other camera dilated by 4 px (loose: it only bounds the depth that two opposite stills cannot see), projected back. Motion frames (posed, no hull) are compared with the posed proxy as an envelope, both ways: the share of the proxy the garment covers (`reference_cover`) and the share of the garment outside the proxy dilated by 12 px (`outside_envelope`: a longer or wider garment, a scale jump, a prop merged into the garment). Drift checks, only where our mannequin's legs stand apart (`drift_visible`): for a dress or skirt, the share of the reference covered in the **skirt zone** (the leg rows where the reference covers the body axis, from the crotch to the reference's hem; `skirt_cover`) and rows where the garment leaves the axis open between two legs (`leg_gap_rows`); for trousers, rows where the garment covers the axis between the reference's two legs (`merged_leg_rows`). Text and props are reported apart as `artefact_frames`, not as drift. Thresholds (`CONSISTENCY_V2_THRESHOLDS`, row and pixel counts for 832-px frames, scaled by `scaled_thresholds`): `min_garment_iou` 0.82; `min_skirt_cover` 0.90 where the skirt zone has ≥ 20 rows; leg gap ≥ 4 rows and > 3% of the skirt zone; `min_envelope_cover` 0.82 and `max_outside_envelope` 0.10 (motion); merged legs > 15% and ≥ 3 rows; stray > 0.05% of the frame.

**The thresholds are provisional.** They are set on one product and two runs (run 11a, run 10 scored against run 11a's scene), so the margins are small: garment IoU 0.82 against run 11a's minimum 0.852 (about 0.03; run 10's frames 10–15 frames past a pinned still score 0.82–0.87, the same range), skirt cover 0.90 against run 11a's minimum 0.962 (about 0.06, while run 10's frames that pass the IoU score 0.77–0.875 there), leg gap 4 rows against run 11a's maximum 2. Re-tune when a second product or run is scored. The first leg-gap rule (> 15% of all leg rows, about 29 of 190) never fired on run 10: its trouser legs touch, leaving at most 13 gap rows on the axis. Run 10 is caught where it is narrower than the dress below the crotch, which `skirt_cover` measures there, apart from the whole-frame IoU (a dress drawn narrower lowers both; trousers lower `skirt_cover` far more).

Measured on run 11a output (CPU), and on run 10's frames scored against the same job (same product, cameras and stills; run 10 was exported with the bare control, so its frames are scored with run 11a's proxy and bare masks):

| | Run 11a (no frame drifted) | Run 10 (dress drawn as trousers) |
| --- | --- | --- |
| v1 flagged (before) | 233 / 243 (record) | 243 / 243 (re-scored here, stride 2) |
| v2 flagged for drift, garment-consistency-0.2.0 (IoU only) | 0 / 243 | 166 / 243: turntable_a 57/81, turntable_b 46/81, motion 63/81 |
| v2 flagged for drift, garment-consistency-0.3.0 (skirt zone, leg gap by rows, motion both ways) | **17 / 243**, all motion (garment outside the posed proxy, below) | **202 / 243**: turntable_a 60/81, turntable_b 74/81, motion 68/81 |
| of those, turntable frames caught without the IoU | 0 | 31 (frames 10, 68–69, 81–95, 142–154) |
| leg-gap check fired | 0 (max 2 rows) | 10 frames (up to 13 rows) |
| v2 garment IoU vs pinned stills, turntable | min 0.852, mean 0.922 | min 0.583, mean 0.782 |
| v2 skirt cover, turntable frames with a skirt zone ≥ 20 rows | min 0.962 (98 frames) | min 0.555; borderline a10 0.875, b89 0.814, b93 0.782 |
| v2 posed-proxy cover, motion | min 0.848, mean 0.990 | median 0.808 |
| v2 garment outside the posed proxy, motion | max 0.51; > 0.10 in 17 frames | max 0.51; > 0.10 in 7 frames |
| v2 artefact frames | 81 (all motion frames, see below) | 98 (20 turntable frames with the product name as text, 78 motion) |

With 0.2.0, run 10's frames within about 15 frames of a pinned still passed (frames 0–10, 68–95, 142–159) on the IoU alone. With 0.3.0 the turntable frames that still pass are 0–9, 70–80 and 155–159, within about 10 frames of a pinned still. Frames 20, 60 and 100, the ones reported in run 10, are flagged on both.

**Motion, both ways.** 0.2.0 checked only that the garment covers the posed proxy, so run 11a's motion clip passed 81/81 although `garment_inside` fell to 0.36 (j = 0–3) and was below 0.9 in 23 frames. 0.3.0 flags 17 of run 11a's motion frames for garment outside the envelope: the scale jump at j = 0–4, and j = 46, 48, 68–80, where the blocks at the feet merge into the garment mask or the hem is drawn below the proxy. They are real defects of that clip (see "Motion clip" below), so run 11a's "0/243 for drift" applied to the turntable only.

Segmentation, measured on run 11a output (CPU), 160 assembled frames: IoU with the synthetic truth **0.979 at frame 0 and 0.976 at frame 80** (the pinned stills, where the truth is exact); 0.903–0.990, mean 0.959, over all 160 frames (a loose number: away from the pinned frames the model draws its own garment, e.g. a narrower dress at frames 122–129). On the exporter's own synthetic renders of the same garment: mean 0.998, min 0.991. 0 frames ambiguous with the mannequin; garment contrast off the body median 72 levels. About 0.3 s per frame.

**Stage 4 alpha targets** (`--stage2-masks garment|foreground`, default `garment`, on `stage4_recon.py` and `run_phase0.py`; `cost_summary.json` → `stage4_masks` records the choice in every run, `--skip-video` included; `metrics.json` → `alpha_targets` records the source, the segmentation version, the sha256 of the frame set and of the mask set, whether the masks were computed in that call and why, and, for synthetic stills, `vs_synthetic_truth`). `garment` trains on `stage2/garment_mask/` and skips the 3D mannequin removal; `foreground` is the old behaviour. The masks carry `stage2/garment_mask/record.json` (segmentation version, sha256 of the frames they came from and of the masks); stage 4 reuses them only when that record matches the current segmentation version and the frames and masks on disk, and segments again otherwise (no record, stage 2 re-run under the same job id, `--skip-video` over older frames, an older segmentation). On run 11a's 160 frames (CPU): 44 s to segment, then reused. The masks stage 4 would get for run 11a: IoU with the synthetic truth 0.979 / 0.976 at the pinned frames (CPU; the stage 4 IoU itself needs a GPU run). Locally: `python phase0_garment.py <job dir> --write-masks --score`.

**Stage 4 again on run 11a's generated frames.** The export version is part of the input hash, so exporting aalter-studio-2 with 0.3.0 gives a new job id with no stage 2 in the Volume; `run_phase0.py --skip-video` would find nothing to reuse. Run 11a's job (`aalter-studio-2-28080a938e84`, export 0.2.0) is still in the jobs Volume with its `stage2/frames`, so stage 4 runs on it by id, without a local export, and segments the masks there (that job has no `stage2/garment_mask`):

    modal run spikes/garment-engine/modal/stage4_recon.py --job-id aalter-studio-2-28080a938e84 --job-dir spikes/garment-engine/out/phase0/run11a-stage4 --source stage2

`--job-id` refuses a `--job-dir` whose manifest names another job and never uploads.

**Proxy length.** The proxy's hem already followed `shoulder_to_hem` / `waist_to_hem` / `outseam` exactly (a test now measures the mesh's lowest point near the body axis for every product with a length). The case that could disagree was a product without a length exported with synthetic stills: the synthetic garment then defaults to 105 cm (dress) / 64 cm (top) while the proxy used pattern words or the knee. Export 0.3.0 gives the proxy the synthetic garment's length in that case (`length_source: "synthetic stills: …"`); with merchant photos the product's own rule stays.

**Motion clip.** All 81 motion frames of run 11a are artefact frames: dark blocks around the feet in every frame, and the clip starts with the front still drawn at the turntable camera (320 cm) while the motion camera stands at 520 cm, so frame 0 is a larger figure that cross-fades into the smaller one. Export 0.3.0 no longer pins a still in the motion clip (the front still stays its reference image). Not run on a GPU yet.

## Stage 4b: re-texture a cut family's variants

Shops sell one cut in many colours and prints. The full pipeline runs once per cut family (`data/bohohippychic/families.json`, `src/families.ts`), for its reference member; every other member only needs stage 4b:

```sh
# reference: full run (stage 1b -> 2 -> 4); variant: its own export and stage 1b stills only
modal run spikes/garment-engine/modal/run_phase0.py --job-dir <reference job> --dress
modal run spikes/garment-engine/modal/run_phase0.py --job-dir <variant job> --dress --dress-only
modal run spikes/garment-engine/modal/stage4b_retexture.py --ref-job-dir <reference job> --source stage2 \
  --variant-job-dir <variant job> --variant-id <handle> --family-id <families.json id>
# dry run on the reference's synthetic frames (known print, no variant job):
modal run spikes/garment-engine/modal/stage4b_retexture.py --ref-job-dir <reference job> --source synthetic --synthetic-variant
```

The variant's stills are projected through the reference's turntable cameras at frame 0 and N/2 (the variant's `cameras_opencv.json` must be equal), with a z-buffer of the garment mesh, the variant's stage 1b garment mask and a grazing-angle cut; what neither still sees is filled by mirroring the nearest seen print around the turntable axis (the mean camera centre of `cameras_opencv.json`, recorded as `settings.axis_xz`). A real variant without `stage1b/garment_mask_<view>.png` is refused, because the z-buffer holds only the garment mesh and skin or mannequin colour would bake into the texture; `--allow-missing-mask` accepts it and writes a warning into `record.json` (`warnings`). Options: `--texture-size 1024 --min-cos 0.2 --depth-eps-cm 1.0 --recon-if-missing --download-only --force-upload --allow-missing-mask`. `CURTAIN_MODAL_GPU_RETEXTURE` (default empty) keeps it on CPU.

**Not run on Modal.** Tested here: GLB I/O, the atlas, the z-buffer and visibility, the projection and fill on a synthetic quad and cylinder seen from the exporter's cameras, the axis from the cameras, the mask refusal and the records (`tests/test_stage4b_retexture.py`). A 12k-triangle cylinder at 480×832 with a 1024 texture takes about 4 s locally. No CPU price is in the research doc, so its cost record has no dollar figure.

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

- The exporter: vitest for pose conventions, PNG encoding, depth range, manifest hash stability and photo rules; the control proxy (girths at the anchors, closed parts, no gap between the legs for a dress or skirt, a gap for trousers); shop products from the committed `products.json` / `images.json` with stand-in image bytes; the prompts (no title, brand or distinctive title word for all seven products).
- Stage 2's prompt guard and consistency metric (`tests/test_stage2_control.py`): synthetic frames where trousers over a dress proxy and a skirt over a trouser proxy are flagged, a dress over a dress proxy passes, a side view is reported as blind to leg drift, and a cream dress is reported as low contrast.
- Stage 4b's pure helpers (`tests/test_stage4b_retexture.py`).
- The garment masks, consistency v2 and the alpha-target check (`tests/test_garment_segment.py`, numpy + Pillow): half-resolution frames of run 11a's real output in `tests/fixtures/run11a/` (pinned frames 0 and 80 reach IoU ≥ 0.95 with the synthetic truth; run 11a frames 20, 89 and 141 pass; run 10 frame 20 is flagged with an artefact, its borderline frame 89 passes the IoU and is caught by the skirt zone, its frame 141 fires the leg-gap check), synthetic scenes for a light garment, a hand over the skirt, the leg checks and a garment larger than the posed proxy; the mask record (a re-run stage 2, an older segmentation, an edited mask and a missing record each make stage 4 segment again).
- The proxy geometry is part of `input_hash` (the sha256 of `control/proxy.glb` sits in `hash_inputs.control.proxy`), so a change to the proxy mesh code changes the job id even without a `PROXY_VERSION` bump, and `--skip-video` cannot reuse stage 2 outputs made with other control frames.
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
- Consistency v2 and the garment masks on a second product and on a garment the colour of the mannequin; the thresholds are set on one product (run 11a, run 10) and are provisional (margins about 0.03 on the garment IoU and 0.06 on the skirt cover). Whether stage 4 with garment masks beats the 0.84 / 0.90 of runs 11a / 10. Export 0.3.0 (bare masks, no motion pin) in a GPU run. The dress proxy is rigid with the pelvis in the motion clip, so a stepping leg can show through it there.
- gsplat 2DGS training: learning rates, densification and the mask loss on our scenes, the iteration count, and the median-depth TSDF on thin cloth.
- The `foreground` mask mode on generated frames, followed by removing the mannequin in 3D. Garment within `--remove-cm` (0.6 cm) of the body is removed with it. Stage 3's garment masks (`stage3/garment_mask/`, used automatically when present) are the real answer.
- Timings, GPU seconds and costs.

Built but not run: the dressing stills (stage 1b, see its section) and the variant re-texture (stage 4b). Not built: stage 3 on generated frames, the 4-step LightWan path, the hosted Kling path (shortlist B), NeuS reconstruction (method B), texture projection from the merchant photos onto the reference mesh itself, and the Koyeb comparison.

## Privacy

Only product data leaves the computer: merchant product photos, the mannequin and the size chart (D3, AGENTS.md rule 1). No shopper photo, measurement or device id goes into any job. Generated videos and meshes are estimates, labelled as such in every record (rule 3). Fit and size stay with `@curtain/fit-engine` on the device (rule 4). Nothing here computes a fit.
