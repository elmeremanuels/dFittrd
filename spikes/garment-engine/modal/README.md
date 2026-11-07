# Phase 0 on Modal: stage 1b (dressing stills), stage 2 (video) and stage 4 (reconstruction)

GPU half of the Phase 0 spike (`docs/ENGINE-HANDOFF.md`), following shortlist A of `docs/research/garment-engine.md`:

- **Stage 1b** (optional, for shop photos): dresses our mannequin **wearing the coarse proxy** (export 0.4.0; before: the bare mannequin), rendered at the front and back camera of the turntable, from a shop photo of the garment on a person or flat-lay. Garment segmentation with Grounding DINO + SAM 2.1, try-on with FASHN VTON v1.5, Qwen-Image-Edit-2511 or both (all Apache-2.0), QA against the proxy silhouette (a tolerance band) with a leg-gap check and print fidelity against the shop photo; the instruction's colour is measured on the garment cut-out, never taken from the product name. Its output is the front and back still stage 2 pins. See [Stage 1b](#stage-1b-dress-our-mannequin-from-shop-photos), [after run 12](#stage-1b-after-run-12-proxy-dressed-target-both-engines-leg-gap-true-back) and [after run 13](#stage-1b-after-run-13-colour-from-pixels-print-fidelity-leg-gap-above-the-hem-silhouette-band).

- **Stage 2**: Wan2.2-Fun-A14B-Control (Apache-2.0), driven by the depth video of our own mannequin **wearing a coarse proxy garment** (from the category and the size chart; `--control bare` renders the bare mannequin) along the fixed turntable path, with the front and back stills pinned at the first and last frame of each half turn. Because the control video is our own render, the camera pose of every generated frame is known. The prompts are neutral (no product title, no brand) and every generated frame's garment is scored against the pinned stills carried to its camera. See [Stage 2 after run 10](#stage-2-after-run-10-control-proxy-neutral-prompts-consistency-metric) and [Stage 2 after run 11](#stage-2-after-run-11-garment-masks-consistency-v2-stage-4-alpha-targets-proxy-length).
- **Stage 4**: 2D Gaussian splatting with gsplat's `rasterization_2dgs` (Apache-2.0) plus a mask loss (on generated frames: our garment masks by default), then Open3D TSDF fusion (MIT), cleanup and decimation to 8–15k triangles, written as `.glb`.

> **Status.** The build container that wrote this folder cannot reach Modal (the network proxy blocks gRPC); runs go through GitHub Actions. Stage 4 on synthetic frames and one full `run_phase0.py` (run 10: stage 2 on an H100, about 24 min, cost estimate $1.59; stage 4 on an L40S) have run there. Run 10 showed the dress turning into trousers between the pinned frames and the product name rendered as text; run 11a (proxy control, neutral prompts) kept the dress a dress and drew no text; its consistency and stage 4 numbers were wrong for reasons in our code, fixed and re-measured on its output on CPU (see [Stage 2 after run 11](#stage-2-after-run-11-garment-masks-consistency-v2-stage-4-alpha-targets-proxy-length)); export 0.3.0 and the new stage 4 alpha targets **have not run on a GPU yet**. Run 12 (Bohohippychic azure-palm-baby-doll-dress, stage 1b with FASHN on the bare mannequin, then stage 2 and 4, cost estimate $1.73) dressed the babydoll dress as a romper; run 13 (stage 1b only, both engines on the proxy-dressed target of export 0.4.0, cost estimate $0.21) got the right dress from FASHN and a solid blue one from Qwen, whose instruction took "blue" from the product name; export 0.5.0 and QA `stage1b-qa-0.4.0` / `0.5.0` (after a review of run 13's QA) that follow from it ([Stage 1b after run 13](#stage-1b-after-run-13-colour-from-pixels-print-fidelity-leg-gap-above-the-hem-silhouette-band)) **have not run on a GPU yet**. See [What is not tested](#what-is-not-tested). Every cost figure is an **estimate**: list price × seconds.

## Files

| File | What it is | Needs |
| --- | --- | --- |
| `smoke.py` | Modal hello world: CPU function, GPU cold start, torch matmul | Modal |
| `smoke_cpu.py` | The same without a GPU (login, image, remote call) | Modal |
| `stage1_dress.py` | Stage 1b app: weights download (once), `dress` (segment the shop photo, try-on onto our proxy-dressed render with one engine or both, garment mask, QA v2, back-view checks, composite, record) | Modal, GPU |
| `phase0_dress.py` | numpy, CPU: stage 1b edit region, FASHN label map, garment prior against the proxy-dressed target, garment colour from the cut-out, QA v2 (silhouette band, leg gap above the hem, skirt cover, placeholder left-overs, print fidelity), back-view checks, engine choice; `python phase0_dress.py <job>` re-scores a finished job's stills, per engine candidate | numpy, Pillow |
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
modal run spikes/garment-engine/modal/stage1_dress.py --job-dir spikes/garment-engine/out/phase0/<id> [--engine fashn|qwen|both]
```

or as the first step of the full run (stage 2 only starts when both stills passed QA and, for an invented back, with `--allow-invented-back`):

```sh
modal run spikes/garment-engine/modal/run_phase0.py --job-dir spikes/garment-engine/out/phase0/<id> --dress --dress-engine both --allow-invented-back
modal run spikes/garment-engine/modal/run_phase0.py --job-dir … --dress --dress-only   # stage 1b only, no video
```

The steps and the QA below are the version run 12 ran (export 0.2.0, bare mannequin). From export 0.4.0 stage 1b dresses the proxy-dressed mannequin and QA v2 replaces this table: see [Stage 1b after run 12](#stage-1b-after-run-12-proxy-dressed-target-both-engines-leg-gap-true-back). The v1 numbers are still recorded per candidate as `qa_v1_vs_bare`.

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

A still that passes goes to `stage1b/<view>.png`, where stage 2 reads it. A still that fails goes to `stage1b/rejected/<view>.png`, and stage 2 will not start (`--accept-failed` on the app or `--accept-failed-dress` on `run_phase0.py` overrides; the record then says `qa_overridden: true`). A garment-type failure (stage1b-qa-0.6.1 `type_failures`: trousers with merged legs, a skirt or trousers with a bodice, an open front drawn closed) is never overridden: `run_phase0.py` stops before stage 2 whatever the flag says. `stage1b/record.json` holds the pins, the engine, steps and seed, per view the method, the shop-photo segmentation, the DWPose keypoints found on our mannequin (fashn), the mask source, the QA numbers and the still's sha256, the summary and the cost estimate.

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

## Stage 1b after run 12: proxy-dressed target, both engines, leg gap, true back

Run 12 (GitHub Actions + Modal, H100 for stages 1b and 2, L40S for stage 4) ran Bohohippychic `azure-palm-baby-doll-dress` end to end from its public shop photos (front #1, back #4, on model): job `azure-palm-baby-doll-dress-e50eae989373`, export 0.2.0, stage 1b with FASHN v1.5 in maskless mode on the **bare** mannequin, `--accept-failed-dress`. Cost estimate $1.62–1.73 for the run, of which stage 1b $0.03–0.12 (30 GPU s, 107 s wall).

What the stills show, looked at by eye:

- FASHN transferred the print, the colours and the puffed elbow sleeves convincingly.
- It dressed our mannequin as a **romper**: two separate legs of fabric over the thighs, ending mid-thigh, and an open front down to the waist. The shop photo shows a knee-length babydoll dress, one closed skirt. Maskless mode lets the model keep our visible bare legs, and it fitted the garment around them.
- The **back** still is a front-like view with another neckline (a scoop that shows the grey chest), not the closed back of the back photo. Our mannequin has no face; DWPose found 18/18 keypoints on both views, so FASHN has no way to know it is looking at a back.
- The QA failed both stills (silhouette IoU 0.808 / 0.806, mannequin MAE 30.4 / 36.0), but for the wrong reason: it compared with the bare mannequin and saw a moved mannequin, not a dress drawn as shorts. Stage 2 then copied the wrong shape faithfully: the pinned stills dominate the proxy control.

### What changed (export 0.4.0, `stage1_dress.py`, `phase0_dress.py`)

**Target: the proxy-dressed mannequin.** The exporter renders, per view, our mannequin wearing the same coarse proxy as the stage 2 control (one closed volume from below the neck to the hem for a dress) in a flat neutral beige (`STAGE1B_PROXY_RGB` 0.72/0.68/0.62, distinct from the grey mannequin and the studio background): `dress/proxy_<view>.png`, and the visible proxy `dress/proxy_mask_<view>.png`. They are built in every control mode (also `--control bare`) and hashed (`stage1b.target`, with the proxy's glb hash). `stage1b_plan` refuses a job without them (exported before 0.4.0). The rendered proxy mask of the azure job is pixel-identical to run 12's `control/proxy_mask/0000.png`.

**Edit region** (`phase0_dress.edit_region`): the proxy plus the mannequin's arms in a sleeve band (14 % of the frame height below the proxy's top edge; 10 % before the review below, which cut run 12's sleeves), dilated by a category margin (`EDIT_MARGIN_FRAC`: 3 % of the height for one-pieces = 25 px, about 10 cm; 2 % tops; 3 % bottoms), cut 2 % above the proxy's top edge (never the head). The old 8 % margin made a box around the whole figure. Saved as `stage1b/edit_region_<view>.png`.

**Engines** (`--engine fashn|qwen|both`, `--dress-engine` on `run_phase0.py`):

| Engine | Inputs | Notes |
| --- | --- | --- |
| `fashn` | person = proxy-dressed render, garment = shop photo (front or back), category dress → one-pieces, **masked** (`segmentation_free=False`) | Our label map takes the parser's place: the edit region gets the category's garment label (FASHN greys it and repaints it), the head `face`, the rest of the mannequin `hands` (both in FASHN's exclusion set, kept as they are). It can no longer see two legs under the garment. But FASHN greys its area with 127, so the beige proxy never reaches the model: what it gets from the proxy is the **outline** of its mask (plus DWPose), and its own inpaint area is wider than our edit region (see the review below) |
| `qwen` | picture 1 = proxy-dressed render, picture 2 = the SAM 2 cut-out of the shop photo (the back photo for the back), 40 steps, canvas = the size the pipeline VAE-encodes picture 1 at (768 × 1344 for 480 × 832) | Instruction from the manifest's neutral description (`lib.qwen_dress_prompt`), e.g. *"Dress the mannequin in this exact garment: a blue knee-length babydoll dress in a fluid viscose fabric, one closed skirt that falls from the waist to the hem and covers both legs. The garment replaces the beige placeholder completely … Same pose, same camera, same framing, plain light-grey background."* The back says *"a back view"* and *"Show the back of the garment as picture 2 shows it, not its front: no front neckline and no front opening"*. Never the title or brand (refused). Negative adds *trousers, pants, shorts, romper, jumpsuit, two separate legs of fabric* for a dress |
| `both` | each view through both engines (both pipelines stay loaded: about 8 + 58 GB on the H100) | The candidate that passes QA with the best `qa_score` (mean of silhouette IoU, garment-proxy IoU, skirt cover and 1 − MAE/50; a ranking, not a quality measure) is pinned; if none passes, the best score goes to `rejected/`. Both are recorded (`views[].candidates`, `raw/<view>_<engine>.png`, `candidates/<view>_<engine>_garment_mask.png`, `selection`) |

The garment mask is the difference to the proxy-dressed target inside the edit region, refined by SAM 2 and clipped to the region for the composite; the same garment **not** clipped (`garment_mask_unclipped_<view>.png`) is what the QA's inside fraction is measured on. The pinned still is still our **bare** render with only the garment pasted in: the placeholder never appears, and where the garment leaves the proxy region uncovered our bare mannequin shows.

**QA v2** (`phase0_dress.still_qa`, `STILL_QA_THRESHOLDS`, version `stage1b-qa-0.3.0`; from `stage1b-qa-0.4.0` the silhouette IoU is replaced by a tolerance band, the leg gap counts only rows above the garment's own hem, print fidelity is added and the engine order changed: [after run 13](#stage-1b-after-run-13-colour-from-pixels-print-fidelity-leg-gap-above-the-hem-silhouette-band); row counts for 832-px frames, scaled; "warn" = recorded under `warnings`, does not fail the still until re-tuned, `hard_checks` makes it fail):

| Metric | Meaning | Pass |
| --- | --- | --- |
| `silhouette_iou` | Foreground of the generated still vs our mannequin **wearing the proxy** (bare ∪ proxy), not the bare mannequin | ≥ 0.85 |
| `garment_proxy_iou` | Garment mask vs the proxy silhouette; at the back camera, the proxy's back silhouette | ≥ 0.70, **warn** |
| leg gap (`leg_gap_rows`, `leg_gap`) | Dress or skirt: rows of the skirt zone (from the crotch, where our legs stand apart, to the proxy's hem) where the garment leaves the body axis open between two legs, as consistency v2 (`phase0_garment.leg_rows`, `gap_profile`) | fail at ≥ 4 rows and > 3 % of the zone |
| `skirt_cover` | Share of the proxy the garment covers in the skirt zone | ≥ 0.70, **warn** |
| `inside_fraction`, `cut_px`, `cut_rows` | Garment pixels inside the edit region, on the **unclipped** garment mask (`inside_basis`): a sleeve or hem the region (and so the composite) would chop | ≥ 0.97 |
| `mannequin_mae_8bit` | Mannequin outside the edit region, generated vs our render | ≤ 25 |
| `proxy_residue` | Share of the proxy still showing the flat placeholder | ≤ 0.05 |
| `cover_fraction`, `touches_border` | As v1 | ≥ 0.05, false |

**True back** (`phase0_dress.back_view_checks`, back view with a back photo; the chosen front still and both shop photos are compared, result in `back_view` and, on failure, in the QA failures):

- the back still's garment must match the proxy's back silhouette (`garment_proxy_iou` above);
- **mirror**: the back still must differ from the horizontally mirrored front still (block means over each garment's box, 48 × 80) at least half as much as the shop's back photo differs from its mirrored front photo (`min_mirror_diff_ratio` 0.5; for a plain garment both are small, so the bar drops with them);
- **neckline** (a heuristic): when the shop's back is closed (its neckline at least 0.05 of the garment height shallower than the front's), the back still's neckline may be at most 0.05 deeper than the back photo's.

### Measured on run 12 output (CPU)

`python phase0_dress.py <run 12 job dir>` on the real run 12 stills (`stage1b/raw/<view>.png`, the garment masks stage 1b made, `dress/bare_mask_<view>.png`, `control/proxy_mask/0000.png` and `0080.png`, the shop photos and their SAM 2 masks). The same QA on the exporter's synthetic dress at the same two cameras (a render with a known dress, the positive control; not a model output) is in the last column.

| | Run 12 front | Run 12 back | Synthetic dress, frame 0 / 80 |
| --- | --- | --- | --- |
| v1 (record; recomputed here to the digit): silhouette IoU vs the bare mannequin | 0.808 FAIL | 0.806 FAIL | — |
| v1: mannequin MAE (uncovered, vs bare) | 30.4 FAIL | 36.0 FAIL | — |
| v1: inside / cover | 1.000 / 0.532 | 1.000 / 0.518 | — |
| v2 `silhouette_iou` vs bare ∪ proxy | **0.766 FAIL** | **0.762 FAIL** | 0.961 / 0.960 |
| v2 `garment_proxy_iou` | **0.504 FAIL** | **0.490 FAIL** | 0.932 / 0.932 |
| v2 leg gap (rows of the skirt zone) | **76 / 109 FAIL** | **67 / 109 FAIL** | 0 / 109 |
| v2 `skirt_cover` | **0.377 FAIL** | **0.350 FAIL** | 0.846 / 0.846 |
| v2 garment hem (row) vs proxy hem (row 568) | 539 | 531 | 566 |
| v2 `inside_fraction` (edit region), sleeve band 10 % → 14 % | 0.974 → 1.000 | 0.971 → 1.000 | 1.000 |
| v2 mannequin MAE outside the edit region, band 10 % → 14 % | 13.0 → 11.4 | 16.0 → 14.6 | 0 |
| v2 `proxy_residue` | not measurable (no proxy target in run 12) | | |
| back view: mirror difference stills / shop photos | — | 26.1 / 28.7 = **0.91, passes** | — |
| back view: neckline depth back still / back photo / front photo / front still | — | 0.117 / 0.006 / 0.127 / 0.187: **FAIL** (front features on the back) | — |

So both run 12 stills fail QA v2 **for the right reason**: the leg gap (the romper's two legs below the crotch), with the low skirt cover and garment-proxy IoU that come with it. The MAE no longer fails (outside the edit region FASHN changed the mannequin by 13–16 levels; the composite replaces it anyway). The back fails the neckline heuristic: its open neckline is the front's, the back photo's is closed. The **mirror check does not catch run 12's back** (ratio 0.91): the print differs between the two stills, so pixel statistics see a different image; only the shape cue (neckline) sees a front. The synthetic dress passes every check. Thresholds are set between these two cases, one product: re-tune on the first proxy-dressed run.

### Review of the rework (QA `stage1b-qa-0.3.0`; CPU on run 12's stills, no GPU)

- **Sleeve band.** On run 12 the region (proxy top row 235, band 83 px, margin 25 px) stopped at row 343 on the arms; the azure dress's puffed sleeves end at about rows 350 (front) and 365 (back). That was most of the 2.6–2.9 % of garment outside the region, and a correct dress would have been pinned with its sleeves chopped at a horizontal line. `SLEEVE_BAND_FRAC` is now 0.14 for one-pieces and tops (116 px; region to row 376, `arm_rows_end` in the record): inside fraction 1.000 / 1.000 on run 12 (0.12 still cut the back: 0.997). A longer sleeve is still cut, and now fails (next point). A band from the product's sleeve length would be better.
- **Inside fraction was vacuous.** The app ANDed the garment mask with the region before the QA, so `inside_fraction` was 1.0 by construction (run 12's 0.974 / 0.971 came from the re-score on the old v1 masks). The app now also builds the garment without the clip (`phase0_dress.unclipped_garment`: the difference prior in the region grown by the sleeve band, kept where it connects to the garment, plus SAM 2's unclipped mask when SAM won), saves it, and `still_qa(garment_full=…)` measures `inside_fraction`, `cut_px`, `cut_rows` and the border check on it. A garment the region would chop fails with "garment cut by the edit region".
- **Qwen canvas.** `fit_size(480, 832, 1 MP, 16)` gave 784 × 1344, while diffusers 0.37.1 (`pipeline_qwenimage_edit_plus.calculate_dimensions`) VAE-encodes picture 1 at 768 × 1344 (multiples of 32): 49 against 48 token columns, so the mannequin could come out about 2 % narrower or shifted (up to about 10 px at the right edge) after the resize to 480 × 832, straight into the silhouette IoU, the MAE and the composite. The canvas is now `lib.qwen_canvas` (the same formula), checked against the pipeline's own function at run time and recorded as `canvas` and `picture1_vae_size`. Explicit sizes stay: the pipeline's default would follow the last picture, the garment cut-out.
- **FASHN's grey.** FASHN's `create_clothing_agnostic_image` (pinned commit) greys `buffer_mask | hybrid(contour, bounding box)` dilated about 33 px left/right and 16 px up/down at 864 px, minus identity/hands/feet labels, with value 127, background inside the box included. So FASHN's inpaint area is wider than proxy + 25 px (only the composite is held to the region), and the beige proxy is greyed out before the model sees it. Our bare mannequin's grey is median 116, 75th percentile 124, and 56 % of its pixels are within 12 of 127 on every channel (`mannequin_grey` in the record and the re-score): the grey area merges into the grey arms, legs and neck. FASHN's benefit from the proxy is the mask outline, plus DWPose. The app now saves the agnostic image FASHN saw (`candidates/<view>_fashn_agnostic.png`, with its 127-filled pixels inside and outside our region in the record), so the first GPU run shows what it was given. Open: shade the target's mannequin away from 127 in the exporter. The label map itself checks out against the pinned commit (label ids as the model card, `hands` and `face` in the exclusion set, the stand-in provides every symbol `pipeline.py` and `agnostic.py` import, the call signature matches).
- **Proxy-shape checks warn.** `garment_proxy_iou ≥ 0.70` and `skirt_cover ≥ 0.70` are measured against a proxy whose flare is a default (hem_flare 1.35), and their only positive control is the exporter's synthetic dress, a render on the proxy's own mesh family. A correct but narrower or shorter dress could fail them. They are now warnings (`STILL_QA_WARN_ONLY`) until reviewed on the first proxy-dressed run (both are logged per candidate); the leg gap stays the hard dress-shape failure. Run 12 still fails, on the leg gap and the silhouette.
- **Front reference.** A rejected front still was still used as picture 2 of Qwen's invented back and as the reference of the back-view checks. Now only a front that passed QA (or `--accept-failed`) is the reference; otherwise the record says why (`not_back_reference`, `back_view.note`), and the invented back is not generated.
- `python -I phase0_dress.py <job>` works (the module puts its own directory on `sys.path` before importing `phase0_garment`). The Qwen model pin now says it edits the proxy-dressed mannequin.

### Not tested (after run 12)

Nothing of this section has run on a GPU: export 0.4.0, FASHN in masked mode with our label map (written against `fashn_vton` at the pinned commit, `pipeline.py` and `preprocessing/agnostic.py` read, not executed), the Qwen engine and its instruction, `--engine both` with both pipelines in one container (memory), the back-view checks inside the app, timings and cost. The first Qwen run also downloads 57.7 GB of weights on a CPU container (`CURTAIN_MODAL_TIMEOUT_DOWNLOAD`, 2 h), which may not fit next to stage 2 in a 120-minute GitHub job: run it with `--dress-only` first. Neither engine knows our faceless mannequin's back from its front except through the instruction (Qwen) and the garment photo; the back-view checks are there to catch it. Cost estimate for `both` on an H100: FASHN seconds plus Qwen minutes per view, about $0.20–0.50 per product (not measured).

Re-run this product (from the repo root; the 0.4.0 export changes the job id, expected `azure-palm-baby-doll-dress-6d2f2611a144`):

```sh
pnpm build:packages
pnpm --filter @curtain/garment-spike shop:bohohippychic -- --fetch-images
git diff --exit-code -- spikes/garment-engine/data/bohohippychic/images.json spikes/garment-engine/data/bohohippychic/products.json
pnpm --filter @curtain/garment-spike export:phase0 -- --shop bohohippychic --product azure-palm-baby-doll-dress
modal run spikes/garment-engine/modal/run_phase0.py --job-dir spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress --dress --dress-engine both --no-synthetic-recon
```

Without `--accept-failed-dress` stage 2 starts only when both stills pass QA v2, so a failed stage 1b costs stage 1b only. Re-score a finished job on CPU: `python -I spikes/garment-engine/modal/phase0_dress.py spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress`.

## Stage 1b after run 13: colour from pixels, print fidelity, leg gap above the hem, silhouette band

Run 13 (GitHub Actions + Modal, H100, `--dress-only --dress-engine both`) ran stage 1b alone on the same Bohohippychic `azure-palm-baby-doll-dress` (front #1, back #4, on model), export 0.4.0 (proxy-dressed target), job `azure-palm-baby-doll-dress-6d2f2611a144`, seed 43. Model load 42.5 s; FASHN 7.1 s / 4.6 s per view, Qwen 65.5 s / 65.3 s; 189 GPU s, cost estimate about $0.21 (GPU only, list price).

What the stills show, looked at by eye:

- **FASHN** dressed both views as a knee-length babydoll with the shop's pastel tropical print on cream, puffed sleeves and a tiered skirt: the right answer. It is shorter and narrower than the proxy, so our legs show below its hem inside the proxy's skirt zone.
- **Qwen** ignored picture 2's print and painted a **solid blue** dress on both views. Its instruction said *"a blue knee-length babydoll dress"*: the exporter had taken "blue" from the product name ("Azure Palm" names the print; the garment is cream and pastel). On the back it repainted the whole figure.
- The QA failed every candidate. FASHN narrowly: silhouette IoU vs the proxy-dressed mannequin 0.836 / 0.828 < 0.85, and a "leg gap" of 5 / 109 rows on the front, which are the rows at its own tiered hem (531–535, hem at 535), not a romper. The old `qa_score` then put **Qwen's blue front** (0.836 vs 0.756) into `rejected/front.png` as the "best": wrong.

### What changed (export 0.5.0, `stage1b-qa-0.4.0`)

**1. Colour from pixels, never from the name.** `src/product.ts` `promptColour` (prompt version `neutral-prompt-0.2.0`, export `phase0-export-0.5.0`) takes the colour from `primaryColorHex` (merchant data) or names none; the product-name lookup (`azure → blue`, `rosewater → pink`, `rust → rust orange`, …) is gone, also for the synthetic garment's colour (the fallback colour now). Stage 1b measures the colour on the shop photo's SAM 2 cut-out (`phase0_dress.garment_colour`): a print when at least `print_share` 0.12 of the pixels lie more than 0.03 from the median in chromaticity (r, g) = (R, G)/(R+G+B), which shading does not change; then *"multicolour print on <ground>"*, the ground being the median colour's name in Lab (the exporter's basic colours plus peach, mint and sage). Two far-apart names with ≥ 25 % each give *"<a> and <b>"*; otherwise the median colour's name. Too few pixels: no colour. `lib.qwen_dress_prompt(..., colour=)` appends *"; colours: <phrase>, as in picture 2"* (dropping any colour of the manifest's description) and, for a print, *"solid colour, plain fabric"* to the negative. A manifest from export 0.4.0 has its name-derived colour removed by `lib.neutral_description`, and `lib.prompt_problems` refuses it for stage 2 (re-export). Stored in the record as `source_segmentation.colour` and per candidate `candidate_colour`.

**2. Print fidelity** (`phase0_dress.print_fidelity`, in `still_qa(fidelity=…)`): the candidate's garment pixels (its mask on the raw still) against the shop photo's garment (photo + SAM 2 mask). Palette: Hellinger distance of the joint L\*a\*b\* histograms (8 × 10 × 10 bins over L 0–100, a −40–40, b −40–60, smoothed over neighbouring bins so one colour on a bin edge is not two palettes) **> 0.60 fails**, Delta E of the median colours **> 20 fails**. Texture: edge density (share of pixels inside the eroded mask where L\* changes by more than 4 per pixel), the shop garment scaled to the candidate garment's height first; when the shop garment is printed (density ≥ 0.15) a ratio **< 0.35 fails** ("print lost"). `fidelity.score` = 1 − Hellinger.

**3. Leg gap above the garment's own hem** (`phase0_dress.leg_gap_above_hem`): the hem is the lowest garment row in each leg's column band (left and right of the body axis), the higher of the two; a gap row counts only when it lies more than `hem_tol_frac` 0.01 of the height (8 rows at 832) above it. A dress shorter than the proxy, with a hem that dips at the centre, no longer counts as a romper; a romper's gap runs from the crotch to near its hem and still does. `leg_gap_rows_all` keeps the old count.

**4. Silhouette tolerance band** (`phase0_dress.silhouette_band`) replaces `silhouette_iou ≥ 0.85` (still recorded, not checked): the proxy is coarse (default flare, length from the chart). Three hard checks, dilation 0.015 and erosion 0.01 of the height (12 / 8 px at 832): **garment inside** the proxy plus the sleeve band, dilated, ≥ 0.96 (unclipped garment); **torso cover**: the garment covers ≥ 0.92 of the eroded proxy from its top edge to the crotch; **foreground outside** our mannequin wearing the proxy, dilated, ≤ 0.03. `silhouette_score` = mean of inside and torso cover.

**5. Engine selection** (`phase0_dress.pick_engine`): pass every hard check → highest print fidelity (`fidelity.score`, to 2 decimals) → highest silhouette score; the record keeps `order`, `reason`, `passed`, `fidelity_failed` and both scores per engine. A candidate that fails print fidelity is **never** picked, not even as the rejected still to look at; when every candidate fails fidelity, `engine` is null and the highest fidelity goes to `rejected/` as `rejected_still`.

### Measured on run 13 and run 12 output (CPU)

`python -I phase0_dress.py <job dir>` (it now scores each engine's candidate, `raw/<view>_<engine>.png` with `candidates/<view>_<engine>_garment_mask[_unclipped].png`, and picks). Run 12 is the FASHN romper on the bare mannequin (its masks were made against the bare render; proxy masks from `control/proxy_mask/0000.png` / `0080.png`).

| Front / back | Run 13 FASHN | Run 13 Qwen | Run 12 FASHN (romper) |
| --- | --- | --- | --- |
| Shop cut-out colour (`garment_colour`) | multicolour print on cream (accent share 0.179 / 0.260, median Lab 79.5 1.8 9.3 / 76.9 2.5 9.5) | same | same |
| Candidate colour | multicolour print on light grey (0.200 / 0.193) | navy blue / light blue (0.075 / 0.084) | multicolour print on light grey (0.138 / 0.188) |
| Fidelity: Lab Hellinger (fail > 0.60) | 0.096 / 0.083 | **0.966 / 0.957** | 0.201 / 0.137 |
| Fidelity: median Delta E (fail > 20) | 4.6 / 2.4 | **61.2 / 57.6** | 9.0 / 5.1 |
| Fidelity: edge density ratio (fail < 0.35) | 0.80 (0.360 / 0.449) / 0.64 (0.312 / 0.486) | **0.17 / 0.21** | 0.80 / 0.76 |
| Fidelity | pass / pass | **FAIL / FAIL** | pass / pass |
| Old `silhouette_iou` (was ≥ 0.85; recorded only) | 0.836 / 0.828 | 0.847 / 0.336 | 0.766 / 0.762 |
| Band: garment inside (≥ 0.96) | 0.978 / 0.979 | **0.929** / **0.393** | 0.997 / 0.995 |
| Band: torso cover (≥ 0.92) | 0.967 / 1.000 | 0.953 / **0.591** | **0.840 / 0.850** |
| Band: foreground outside (≤ 0.03) | 0.013 / 0.009 | 0.027 / **0.507** | 0.002 / 0.003 |
| Leg-gap rows above the hem / all (fail ≥ 4 and > 3 % of 109) | 0 / 5 and 0 / 1 (hems 535 / 533) | 3 / 12 and 0 / 0 | **67 / 76 and 58 / 67** (hems 537 / 529) |
| Other hard checks | pass (inside 1.000 / 0.998, MAE 7.5 / 8.7) | back: cut by the region (inside 0.497), MAE 75.3 | — |
| Warnings (not checks) | garment-proxy IoU 0.640 / 0.645, skirt cover 0.697 / 0.643 | IoU 0.686 / 0.450 | IoU 0.504 / 0.490, skirt cover 0.377 / 0.350 |
| **QA v2 (0.4.0)** | **pass / pass** | **fail / fail** | **fail / fail** |
| Selection | **fashn** on both views ("the only candidate that passes every check"; fidelity 0.904 / 0.917 vs 0.034 / 0.043) | `fidelity_failed` | rejected (no candidate passes) |

Back-view checks with FASHN's front and back: pass (mirror ratio 0.91; neckline depth back still 0.038 vs back photo 0.006, within 0.05). Run 12's back still fails the neckline as before (0.117).

So on the two runs FASHN's stills pass every hard check and are picked; Qwen's fail print fidelity (palette and texture), and on the back also the band, the cut and the MAE; run 12's romper fails the leg gap above its own hem and the torso cover (its front is open down to the waist) but **passes** print fidelity, as it should (the print is right, the shape is wrong). Margins are thin where noted: garment inside 0.978 / 0.979 against 0.96 (FASHN) and 0.929 (Qwen front); torso cover 0.92 sits between 0.85 (romper) and 0.967 (FASHN front). Every threshold is set on one product, two runs: re-check on the next product. The colour description was also checked on synthetic scenes (tests: a pastel print on cream → "multicolour print on cream", never blue; a shaded black dress → "black"; black and white halves → "black and white").

### Not tested (after run 13)

Nothing of this section has run on a GPU: the Qwen instruction with the measured colour (whether Qwen then keeps the print is open; the fidelity check is what catches it if not), export 0.5.0, the selection inside the app. Print fidelity compares a studio render with a shop photo under other light (FASHN's colours are about 4 L\* darker); a garment whose shop photo is strongly lit or tinted may fail the median Delta E (since `fidelity-0.2.0` exposure is normalised: see the review below; a tinted light is still a palette change). Stage 2's prompt has no colour for a shop product without `primaryColorHex` (the pinned stills carry it); passing stage 1b's measured colour into the stage 2 prompt is open. The Qwen candidate's sleeves past the sleeve band (front, rows 376–416) fail the band; a sleeve length from the product would serve both the band and the edit region.

### Review of run 13's QA (`stage1b-qa-0.5.0`, `colour-0.2.0`, `fidelity-0.2.0`; CPU only, no GPU)

Run 13's stills were looked at: FASHN's are the right answer on both views (the knee-length babydoll in the shop's pastel tropical print, puffed sleeves, tiered skirt), Qwen's are a solid blue dress and, on the back, a repainted figure. The 0.4.0 checks pick FASHN on both views, but a review with probes on the real stills and synthetic scenes found five weaknesses. Each is fixed below and covered by tests in `tests/test_stage1b_qa.py`.

**1. Colour words of dark plain garments** (`garment_colour`, `colour-0.2.0`). Shaded plain garments (sin folds, JPEG q85) were named as two colours: plain purple came out as *"navy blue and purple"*, dark green as *"olive green and black"*, brown as *"brown and black"*, teal and olive with *"charcoal grey"*. With noise sigma 8, every dark plain garment came out as a print (black 0.19, navy 0.19–0.26, burgundy 0.45 accent share). The wrong phrase went into Qwen's instruction, and for a "print" *"solid colour, plain fabric"* went into its negative prompt. Changes:
- Two names count as one colour when their pixels share a hue (a\*b\* angle within 35°), or when one of them is black, charcoal or grey still tinted towards the other's hue (`_same_colour`).
- Such a folded solid is named by the chromatic name nearest the median's hue (`_hue_name`).
- The print rule smooths 3 × 3 first, uses a lit floor of R+G+B ≥ 90, and needs a chromaticity distance of max(0.03, 12 / (R+G+B)), so a fixed 8-bit change counts the same on a dark pixel as on a light one.
- *"solid colour, plain fabric"* goes into the negative prompt only when the cut-out's edge density also says printed (`printed_by_edges`, ≥ 0.15 at 300 rows).

After the change, all 8 dark solids × 2 shading/noise settings are named by their hue with accent 0.000. Before the change, accent was 0.19–0.49; without the smoothing it would still reach 0.085. Black/white and black/red halves stay two-tone. Run 13: shop 0.167 / 0.248 (*multicolour print on cream*), FASHN 0.184 / 0.177, Qwen 0.020 / 0.017. Limit: a print whose motifs are 1–2 px wide at the image's scale is averaged away too.

**2. Print fidelity at the shop photo's exposure** (`print_fidelity`, `fidelity-0.2.0`). Median ΔE ≤ 20 on absolute L\* failed a correct garment rendered 25 % darker (x0.75: 21.9) and passed clearly wrong grounds (pink tint 17.1, mint ground 18.0). Changes:
- The candidate is now scaled in linear light so that its median luminance matches the shop garment's (`exposure_gain`). A gain beyond 1/3–3 fails, which catches black against charcoal.
- The palette is then compared with limits **Hellinger ≤ 0.35, median ΔE ≤ 10**.
- The histogram uses linear (tent) bin assignment, so a flat colour on a bin edge no longer jumps bins.

The unnormalised numbers stay in the record. Measured on run 13's FASHN front against the real shop cut-out (Hellinger / ΔE after the gain):

| Change applied to the still | After the gain | Result |
| --- | --- | --- |
| as is (gain 1.13) | 0.060 / 2.0 (0.1.0: 0.096 / 4.5) | pass |
| exposure x1.15 … x0.65 (gain 0.83 … 2.94) | 0.059–0.068 / 2.0–2.2 (0.1.0 at x0.75: 0.437 / 21.9, fail) | pass |
| exposure x0.55 / x0.45 (gain 4.2 / 6.4) | 0.214 / 10.7, 0.433 / 21.7 | fail (gain) |
| saturation −25 % / −50 % | 0.116 / 3.9, 0.190 / 5.7 | pass |
| mild pink / yellow tint | 0.258 / 7.5, 0.266 / 8.2 | pass (below resolution) |
| ground recoloured white | 0.251 / 9.5 | pass (cream vs white is below resolution) |
| pink / blue / yellow / green tint | 0.451 / 13.6, 0.326 / 12.1, 0.516 / 18.0, 0.501 / 15.4 | fail |
| ground to light pink / light blue / mint / yellow | 0.424 / 14.2, 0.454 / 18.8, 0.467 / 14.6, 0.625 / 27.2 | fail |
| run 13 Qwen front / back (gain 5.17 / 3.17) | 0.942 / 62.6, 0.952 / 55.0 | fail |

Other reference points: FASHN back 0.080 / 2.3, and run 12's FASHN (right print, scored against run 13's shop masks) 0.161 / 5.6 and 0.102 / 3.0. The limits sit between the largest lighting or render difference (0.19 / 5.7) and the smallest hue change that must fail (0.33 / 12.1). On synthetic solids, white against light grey passes (gain 1.40): a pure lightness difference cannot be told from lighting.

**3. Closed romper with a short inseam** (`leg_gap_above_hem`). The 8-row hem allowance covered every gap row of a romper whose hem sits right under the crotch. On run 13's front geometry, 6- and 10-row shorts passed every hard check (a hole of about 13 rows, 5 cm at 832 px). Rows near the hem are now excused only when the hem lies more than 2 × 8 rows below the crotch (`leg_gap_hem_excused`). The same probes, re-run:
- 4, 6, 10 and 14-row shorts fail with 4, 6, 10 and 14 counted rows; 20 rows fail with 11.
- Tops ending 10/20/40 rows above the crotch fail torso cover (0.908 / 0.851 / 0.742).
- Trousers to the ankle fail (109/109 rows).
- FASHN's babydoll passes.

**4. Hem from garment-coloured pixels** (`garment_coloured`, `still_qa(rgb=, bare_rgb=)`). The hem was taken from the clipped garment mask, so the pass depended on SAM 2's mask leaving out FASHN's repainted legs. With the unclipped mask as the garment, the hem was at 588 / 592 and the correct babydoll failed the leg gap (38 / 36 rows).

The hem now comes from the garment pixels whose colour is likelier under the garment's own palette (its pixels above the crotch) than under our mannequin's legs (our bare render). The garment palette is opened by 1 px, and a hem row needs at least 3 pixels per leg band. With the unclipped mask, the hem is then 533 / 532 and the still passes. The colour rule is used only when it separates the two on known pixels (at most 10 % of our legs read as garment, at least 70 % of the garment does). Run 13: FASHN 0.0 / 0.86, Qwen 0.0 / 1.0. A grey garment (leak 0.37–0.63) falls back to the mask, so a grey romper's legs stay in its hem. The record says which (`garment_hem_basis`).

**5. A dress longer than the proxy's guessed hem** (`silhouette_band`, `hem_extend_frac` 0.06). Every dress without "maxi" or length data gets the knee proxy. A dress 20 rows (about 8 cm) longer than it failed the band (garment inside 0.952), while a shorter one passed. The band now runs on 50 rows (about 20 cm) below the proxy hem, straight down at the hem's width. A dress reaching the feet still fails.

**Open:** the edit region is not extended (FASHN's input stays as on run 13). A dress more than the 25 px edit margin past the proxy hem is still cut by the region and fails `min_inside_fraction` (+40 rows: inside 0.954), and FASHN cannot draw it longer than the region anyway. A length from the product, or a downward margin on the region, would need a GPU run.

Run 13 re-scored (`python -I phase0_dress.py <job dir>`):

| Front / back | FASHN | Qwen |
| --- | --- | --- |
| Band: garment inside | 0.981 / 0.988 | 0.929 / 0.452 |
| Hem rows | 533–537 / 532–535 (garment-coloured) | — |
| Leg-gap rows | 0 / 0 | — |
| Fidelity (Hellinger / ΔE / edge ratio) | 0.060 / 2.0 / 0.80 and 0.080 / 2.3 / 0.64 | 0.942 / 62.6 and 0.952 / 55.0, gain 5.17 / 3.17 |
| Result | **pass / pass** | **fail / fail** |
| Selection | **fashn** on both views | — |

Back-view checks: pass (mirror ratio 0.91).

**Not tested:** none of this has run on a GPU. Use run 13's recipe (stage 1b only, both engines) to confirm the selection there.

## Stage 1b after run 15: torn and shrunken stills, the trouser region, type checks (`stage1b-qa-0.7.0`)

Run 15 (GitHub Actions run 42402554810, code at 91ed5b2, FASHN, `--accept-failed-dress`) ran one product per category. The azure dress (stage 1b passed) and the maxi skirt (front failed only the provisional torso cover, 0.727: drawn narrower, waistband lower) look right. The blouse and the cardigan stills were broken and stage 2 ran on them anyway (about $1.64 and $1.65), because `--accept-failed-dress` overrode every failure they had. The palazzo was stopped by the merged-legs type check (259 / 255 of 259 / 255 rows). Every number below was measured on CPU on run 15's own files (`stage1b/raw`, `candidates/`, masks, `source/`, `record.json`, `log.txt`).

### Causes, with the evidence

1. **Blouse front torn: the composite, not FASHN.** FASHN's raw front (`raw/front_fashn.png`) is a whole half-sleeved blouse. Stage 1b pastes only the garment MASK onto our bare render, and SAM 2 disagreed with the difference prior (IoU 0.427), so the prior was pasted: pixels that differ from the proxy-dressed target by more than 24 levels. The target's placeholder beige (0.72, 0.68, 0.62) is the blouse's cream ground, so the mask kept 21,112 px of a garment of about 40,000; 0.108 of the outline that was pasted showed our mannequin through it. The back (SAM 2's mask, holes at the print) showed 0.044.
2. **Black panels in stage 2: the stills.** The stage 2 frames are dark exactly where the pinned stills show our grey mannequin inside the proxy outline (blouse frames 20 and 100, cardigan 100-140), while the depth control there is the proxy's cloth surface, and the azure and skirt videos (whole stills) have none. Wan2.2 drew those patches as dark cloth. Nothing in stage 2 masks or blackens its conditioning; no stage 2 change.
3. **Cardigan back grey sleeves: holes in the shop photo's mask.** SAM 2's mask of the back photo had 8,422 px of enclosed holes in the knit sleeves (median colour (84, 39, 25), the brown sleeve). FASHN's `create_garment_image` (pinned commit) sets every pixel outside our mask to grey 127, and FASHN drew grey sleeves: 75 % of the proxy's back sleeve pixels are grey-like in its raw (lum 123, chroma 2); 1.9 % on the front.
4. **Cardigan front cropped: FASHN's reading of the photo, partly ours.** FASHN drew an open cropped cardigan ending at the underbust over a drawn bare midriff (navel) and a grey waistband, not the buttoned hip-length cardigan. In its garment image the model's hair covers her right shoulder (SAM 2 leaves out the shoulder, the collar and the top of that front; not fixable by segmentation), and the lace top under the V is grey 127. The kept-open V notch is not the cause: it is 745 px, mean value 125.5 against FASHN's fill of 127 (22.6 % exactly 127), so FASHN's input hardly shows it. **Not fixed**: run 16 runs stage 1b alone on it with both engines.
5. **Palazzo drawn as a skirt: our edit region was one block.** The palazzo proxy's legs stand 6 px apart (2.4 cm) on most of 259 leg rows; the 25 px edit margin closed the gap, and FASHN's agnostic image (re-computed here on CPU with the pinned `agnostic.py` + `masks.py`: 0 px differ from the one run 15 saved) is one grey rectangle from the waist to the feet. The shop photo itself shows no gap between the legs either.

### What changed

- `clean_source_mask`: the shop photo's SAM 2 mask is closed by 0.35 % of the long side (4 px at 1200) and its enclosed holes up to 1 % of the photo are filled; only adds pixels. Run 15's masks: cardigan back +13,136 px (4.8 %, the sleeves), cardigan front +1,487, every other photo 48-332 px (0.02-0.11 %). The record has `source_segmentation.mask_cleanup` and `sam_px`.
- `still_garment_mask`: the composite pastes the chosen mask plus every pixel inside the proxy (or within 0.4 % of the height of the chosen mask) that our mannequin colour model (`phase0_garment.segment_garment`, sampled from the still's own head) does not call mannequin, also at twice its chroma ceiling (FASHN's drawn midriff, chroma 8-15, stays out). A garment that reads as mannequin grey keeps the chosen mask. Replayed on run 15's raw outputs (with the pinned masks as the chosen ones): blouse front 21,112 → 39,073 px, see-through 0.108 → 0.002, body length 0.295 → 1.005; back 31,922 → 35,748 px, see-through 0.044 → 0; azure +1,468 / +1,395 px, skirt +1,609 / +1,768 px, no change in any check.
- Trousers (`trouser_gap_zone`, `edit_region(open_crotch=...)`, `engine_target`, `qa_proxy`): a strip between the proxy's legs from its crotch down, at least 2.4 % of the height wide (20 px at 832), is taken out of the edit region, painted as our bare render in the engine's input (FASHN and Qwen) and labelled `feet` in FASHN's person label map, which its agnostic step keeps visible for lower-body garments. Re-computed with FASHN's own agnostic code on run 15's palazzo views: 4,708 / 4,644 px of the strip visible in 257 / 253 rows (0 before). The QA compares with the proxy minus the strip. Merged legs are counted on the unclipped garment (what the engine drew), so the composite's gap cannot hide a skirt; run 15's palazzo still fails with 259 / 255 merged rows.
- New TYPE checks (listed in `type_failures`: `--accept-failed-dress` does not override them, `run_phase0` stops before stage 2): **see-through** > 0.02 (our mannequin in the enclosed holes of the garment mask on the eroded proxy; an outerwear opening excluded), **body too short** < 0.70 (garment bottom over proxy bottom from the proxy's top, central half of the body columns; not trousers), and on the back still **views disagree**: body lengths more than 0.25 apart, or sleeve cover more than 0.40 apart when the proxy's sleeves are at least 15 % of it.

### Run 15 re-scored (`python -I phase0_dress.py <job dir>`, the stills and masks as pinned)

| View | see-through | body length | sleeve cover | Type failures (0.7.0) |
| --- | --- | --- | --- | --- |
| azure front / back | 0 / 0 | 0.993 / 0.987 | (no proxy sleeves) | none |
| run 14 azure front / back | 0 / 0 | 0.892 / 0.895 | (no proxy sleeves) | none |
| skirt front / back | 0 / 0 | 1.051 / 1.014 | — | none (front still fails the provisional torso cover 0.727) |
| blouse front / back | **0.108** / **0.044** | **0.295** / 0.927 | 0.447 / 0.609 | front: see-through, body too short; back: see-through, views disagree (length gap 0.632) |
| cardigan front / back | 0 / **0.037** | **0.469** / 0.927 | 0.905 / **0.267** | front: body too short; back: see-through, views disagree (length gap 0.459, sleeve gap 0.638) |
| palazzo front / back | 0 / 0 | — | — | legs merged 259 / 255 rows (as before) |

So 0.7.0 would have stopped the blouse and the cardigan after stage 1b (about $0.03-0.07 each instead of $1.64-1.65) and lets azure and the skirt through. With the new composite on the same raw outputs the blouse passes every check, front and back (torso cover 0.989 / 0.952, length gap 0.078); the cardigan still fails (front body length 0.620, views disagree: length gap 0.318, sleeve gap 0.633). Thresholds are provisional: one run, five products.

**Not tested on a GPU:** the cleaned shop masks as FASHN input, the trouser strip in FASHN's and Qwen's input, Qwen on trousers and outerwear. The cardigan front's cause is not fixed.

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

**Prompts** (manifest `prompt`, hashed). A neutral description made only of fixed vocabulary: colour (nearest basic colour of `primaryColorHex`, else none; until export 0.5.0 a colour word of the name, which run 13 showed is a print name: see [Stage 1b after run 13](#stage-1b-after-run-13-colour-from-pixels-print-fidelity-leg-gap-above-the-hem-silhouette-band)), length, sleeves, a plain style word and the fabric, e.g. *"a knee-length babydoll dress in a fluid viscose fabric, one closed skirt that falls from the waist to the hem and covers both legs"*. Never the product title, the brand or quotes. The negative prompt always holds text, letters, words, captions, typography, watermark, logo, label and brand name, plus trousers / pants / shorts / two separate legs of fabric for a dress or skirt, and dress / skirt / gown for trousers. `stage2_video.py` and `run_phase0.py` refuse a manifest whose prompts fail `lib.prompt_problems` (title, brand, quotes, missing negative terms, a colour taken from the product name) or that has no prompts (exported before 0.2.0: re-export).

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
