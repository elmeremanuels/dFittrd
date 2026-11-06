# Garment engine — Phase 0 research (models, licences, GPU, cost)

> Researched 2026-11-05 for Phase 0 of `docs/ENGINE-HANDOFF.md`. Every licence and price below was read from the linked primary page (model card, licence file, vendor pricing page or docs) on that date unless it is marked **unverified**. Prices are list prices in USD unless stated, before tax and before any promotion. Not legal advice: the licence calls in section 7 should be confirmed by counsel before Phase 1 ships anything.

## Decision summary

| Question | Recommendation for Phase 0 | Why |
| --- | --- | --- |
| Video model A (self-hosted) | **Wan2.2-Fun-A14B-Control** (with the VACE-Fun and InP variants as fallbacks), run on our own GPU container in the EU | Apache-2.0 weights; takes a reference image plus a control video, so we render the depth/normal video of our own mannequin turntable and the camera path is exact by construction; the InP variant pins first and last frames |
| Video model B (hosted) | **Kling 3.0 Pro image-to-video** (via fal or the Runway API) | Start frame + end frame for pinning 0° and 180°, up to 3 reference images per element, 3–15 s, $0.112–0.12/s; strongest cloth-motion anecdotes in our earlier research |
| Reconstruction method A | **2D Gaussian splatting in gsplat** (`simple_trainer_2dgs.py`) + mask loss + TSDF fusion in Open3D | Apache-2.0 / MIT; surfel-based so it gives clean depth and normals; the original 2DGS code is non-commercial, gsplat's re-implementation is not |
| Reconstruction method B | **NeuS-style SDF with masks** via instant-nsr-pl (MIT) or sdfstudio (Apache-2.0) | Watertight mesh directly from the SDF; a different failure mode from splatting, which is what a comparison needs |
| Body model for avatar v1 | **Anny** (NAVER Labs, Apache-2.0, MakeHuman-derived) with our own fit to the 12 anchor rings on top | Free for commercial use, interpretable phenotype sliders, all ages; Meta's MHR (Apache-2.0) is the runner-up |
| GPU service | **Modal** in region `eu` for Phase 0; **Koyeb** (Paris/Frankfurt) measured alongside | Per-second billing, scale to zero, custom containers, a documented EU region with a 1.15× multiplier; Koyeb has the lowest list prices of the EU-capable options |
| Cost per product, Phase 0 | **About $1.3–5.6 per product per attempt** (estimate, section 6) | Dominated by video generation; self-hosted video drops to about $0.25 per product once a distilled 4-step Wan checkpoint holds up |

Two findings change the plan slightly:

1. **No hosted video API we could verify accepts an explicit camera trajectory on its current models.** Veo 3.1's model page does not mention camera control ([Vertex AI Veo 3.1](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate)); Kling 3.0 Pro on fal lists start/end images and elements but no camera parameter ([fal Kling 3.0 Pro API](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api)); Luma Ray 2 takes camera motion as prompt phrases and "concepts" ([Luma docs](https://docs.lumalabs.ai/docs/video-generation)). Kling's older `camera_control` field (six axes, −10…10) is documented only in third-party mirrors and could not be confirmed on Kling's own capability map (JavaScript-only page) — **unverified**. Hosted models therefore get the turntable as **two pinned half-turns** (front→back with first = front and last = back, then back→front) plus a prompt, and the pipeline must **re-estimate camera poses** on their output. The self-hosted Wan Fun path is the only one where the camera path is enforced.
2. **No hosted video model we checked offers an EU processing region.** Veo 3.1 lists only `us-central1`; Alibaba's Wan 2.7 lists Beijing, Singapore and Tokyo ([Model Studio Wan 2.7 i2v](https://www.alibabacloud.com/help/en/model-studio/wan2-7-i2v)); Runway, fal and Kling publish no region on the pages we read. Merchant photos are product data (handoff rule 2), so this is not a D3 problem, but D16 and the risk table ask for an EU region. **Founder call:** accept US/Asia processing of merchant product photos for the hosted candidate in Phase 0, or test the self-hosted path only.

## 1. Image-to-video models with reference images and camera control

What the pipeline needs (handoff stage 2): the garment dressed on *our* mannequin, a fixed 360° turntable path, the merchant's front and back pinned at 0° and 180°, a second clip with a fixed motion, and reproducible output (pinned model version and seed).

Before any video model runs, the merchant's flat-lay or ghost-mannequin photo must be turned into "garment on our mannequin, front view" and "… back view". That is a try-on onto a mannequin render: FASHN VTON 1.5 (Apache-2.0, [licence](https://github.com/FASHN-AI/fashn-vton-1.5/blob/main/LICENSE)) or Qwen-Image-Edit (Apache-2.0, [licence](https://github.com/QwenLM/Qwen-Image/blob/main/LICENSE)) can do it self-hosted; FLUX.1 Kontext [dev] cannot (non-commercial, section 7). These two dressed stills are the keyframes every video model below receives.

| Model | Licence for our use | Hosted / self-host | Price | Max res / length | Camera control | Reference / keyframe conditioning | EU |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Wan2.2 I2V-A14B / TI2V-5B** ([repo](https://github.com/Wan-Video/Wan2.2), [model card](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B)) | Apache-2.0; "we claim no rights over your generated contents" | Self-host (A14B needs ≥80 GB VRAM on one GPU; 5B runs in 24 GB); hosted on fal | fal: $0.04/s 480p, $0.06/s 580p, $0.08/s 720p ([fal](https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video)); endpoint deprecated 2027-01-04 | 720p; 5B: 1280×704 at 24 fps | None in the base model | Start image; fal exposes an optional end image | Self-host in any EU GPU region |
| **Wan2.2-Fun-A14B-Control / -Control-Camera / -InP / VACE-Fun** ([VideoX-Fun](https://github.com/aigc-apps/VideoX-Fun), [Control card](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control), [Camera card](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera)) | Apache-2.0 | Self-host only | GPU time only (section 6) | 512/768/1024 multi-res; trained on 81 frames at 16 fps (5B variants: 121 frames at 24 fps) | **Control:** depth / pose / canny / MLSD video + trajectory; **Control-Camera:** pans and zooms (trajectory file format not documented on the card — **unverified**) | Control: reference image + control video; InP: first and last frame; VACE-Fun: subject reference + control | Self-host in EU |
| LightWan2.2-A14B 4-step distillation ([card](https://huggingface.co/lightx2v/LightWan2.2-A14B)) | Apache-2.0 | Self-host | 720p I2V in 26.7 s vs 2,685 s for the 40-step base, **measured on an RTX 5090 with NVFP4 kernels**; quality claim not backed by metrics | as Wan2.2 | as base | as base | Self-host |
| **Kling 3.0 Pro** | Proprietary API; fal tags it "commercial use" | Hosted only | fal: $0.112/s (audio off) ([fal](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video)); Runway API: $0.09/s standard, $0.12/s pro, no audio ([Runway pricing](https://docs.dev.runwayml.com/guides/pricing/)) | 3–15 s; resolution not stated on the fal page | Not on 3.0 pages; legacy `camera_control` **unverified** | Start image, end image, elements with 1–3 reference images each | No region published |
| **Veo 3.1 / 3.1 Fast** ([Vertex](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate)) | Google Cloud terms (commercial) | Hosted | Via Runway API: $0.20/s (Veo 3.1, no audio), $0.10/s (Fast, no audio); Vertex price page did not render for us — **unverified** | 4, 6 or 8 s; up to 4K (Generate), 1080p (Fast); 24 fps | Not mentioned | First + last frame; "asset images" (count not stated); reference-to-video limited to 8 s | `us-central1` only |
| Runway Gen-4 Turbo / Gen-4.5 | Runway API terms | Hosted | $0.05/s / $0.12/s ([Runway pricing](https://docs.dev.runwayml.com/guides/pricing/)) | not verified | not verified | First frame; last-frame support **unverified** (API reference page did not render) | No region published |
| Wan 2.7 i2v (Alibaba Model Studio) | Alibaba Cloud terms | Hosted | Singapore $0.10/s 720p, $0.15/s 1080p ([Model Studio](https://www.alibabacloud.com/help/en/model-studio/wan2-7-i2v)) | 1080p; length not on the page | not on the page | not on the page | Beijing, Singapore, Tokyo only |
| Seedance 2 / 2.5, MiniMax Hailuo 3, Grok Imagine 1.5 | Vendor terms | Hosted (Runway API lists all three) | Seedance 2: $0.30/s 720p (min 56 credits); Hailuo 3: $0.10/s 768p + $0.02 per reference or keyframe; Grok Imagine 1.5: $0.16/s 720p ([Runway pricing](https://docs.dev.runwayml.com/guides/pricing/)) | not verified | not verified | Hailuo 3 bills keyframes and reference images explicitly | No region published |
| Luma Ray 2 / Ray 2 Flash ([docs](https://docs.lumalabs.ai/docs/video-generation)) | Luma API terms | Hosted | not on the docs page — **unverified** | 540p–4K; 5 s in examples | Camera phrases in the prompt + `concepts` keys | `frame0` / `frame1` keyframes | not stated |
| LTX-2 ([card](https://huggingface.co/Lightricks/LTX-2), [licence](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2)) | LTX-2 Community License: free below **$10M annual revenue**, paid licence above | Self-host | GPU time | 768×512, 121 frames at 24 fps in the example; limits not stated | IC-LoRAs mentioned, camera control not documented | Image-to-video | Self-host |
| SV4D 2.0 ([card](https://huggingface.co/stabilityai/sv4d2.0)) | Stability Community License: free below **$1M annual revenue** ([licence page](https://stability.ai/license)) | Self-host | GPU time | 576×576, 48 images (12 frames × 4 views) per run | Novel-view synthesis at chosen angles | 12-frame single-view video in | Self-host |
| CogVideoX 1.5-5B I2V ([licence](https://huggingface.co/zai-org/CogVideoX1.5-5B-I2V/blob/main/LICENSE)) | CogVideoX License: commercial after registration, below 1M monthly visits | Self-host | GPU time | not checked | via CameraCtrl-style add-ons only | Image-to-video | Self-host |
| ReCamMaster ([repo](https://github.com/KlingTeam/ReCamMaster)) | MIT (code); open release is built on Wan2.1-1.3B and "may not achieve the same performance" as the paper | Self-host | GPU time | as Wan2.1-1.3B | Re-renders a video along 10 preset trajectories | Source video in | Self-host |
| HunyuanVideo 1.5 / I2V | **Not licensed in the EU** ([licence](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/main/LICENSE)) | — | — | — | — | — | **Banned** |
| SV3D | **Non-commercial** (`sv3d-nc-community` tag; licence text gated) ([card](https://huggingface.co/stabilityai/sv3d)) | — | — | — | — | — | **Banned** |

### Shortlist for the Phase 0 comparison

- **A — Wan2.2-Fun-A14B-Control (self-hosted, EU).** Render our mannequin turntable (and the motion clip) in our own renderer, export per-frame depth (or normal) maps, and feed them as the control video with the dressed-front still as reference. The camera pose of every generated frame is then the pose we rendered, which is exactly what stages 3–5 need. Use the InP variant for the "front first, back last" half-turns if the control model drifts at 180°, and VACE-Fun if the reference is not held. Start on the 40-step base for quality and test the 4-step LightWan distillation for cost. Risk: 81 frames at 16 fps is 5 s per clip, so a turntable is two or three clips chained at pinned frames.
- **B — Kling 3.0 Pro (hosted).** Two 5 s half-turns with start/end frames pinned to the dressed front and back stills, the garment photos as element references, and a fixed prompt ("slow 180° turntable, locked camera height, studio light"). Poses must be re-estimated (VGGT-1B-Commercial or MapAnything-apache, section 2) or registered against the bare-mannequin render. If Kling drifts, swap in Veo 3.1 (first/last frame, up to 4K) through the same adapter.

Both go behind the `packages/tryon-providers` provider pattern with pinned model versions and seeds (handoff rule 5).

## 2. 3D reconstruction from posed video with masks

Key licence trap: the reference Gaussian-splatting code from Inria, and most papers built on it (2DGS, GOF, SuGaR, MILo, PGSR), is **research-only**. Commercial-safe implementations exist and implement the same ideas.

| Method / code | Licence | What it gives | Speed on one GPU | Mesh quality notes |
| --- | --- | --- | --- | --- |
| **gsplat** ([repo](https://github.com/nerfstudio-project/gsplat), [examples](https://github.com/nerfstudio-project/gsplat/tree/main/examples)) | Apache-2.0 | 3DGS, **2DGS** (`simple_trainer_2dgs.py`), 3DGUT; depth rendering | "up to 4× less GPU memory and up to 15% less time" than the Inria code; absolute times not published — **measure in Phase 0** | 2DGS surfels give consistent depth/normals; mesh via TSDF fusion (we add Open3D; gsplat ships no mesher) |
| Open3D ([licence](https://github.com/isl-org/Open3D/blob/main/LICENSE)) | MIT | TSDF fusion, remeshing, cleanup | seconds to minutes per object (**unverified estimate**) | Standard; resolution set by voxel size |
| nerfstudio / splatfacto ([licence](https://github.com/nerfstudio-project/nerfstudio/blob/main/LICENSE)) | Apache-2.0 | Training framework around gsplat | as gsplat | as gsplat |
| 3DGRUT ([licence](https://github.com/nv-tlabs/3dgrut/blob/main/LICENSE)) | Apache-2.0 | Ray-traced Gaussians (NVIDIA) | not checked | not a mesher |
| Brush ([licence](https://github.com/ArthurBrussee/brush/blob/main/LICENSE)) | Apache-2.0 | Gaussian splatting in Rust/WebGPU | not checked | no mesh extraction found |
| **instant-nsr-pl** ([licence](https://github.com/bennyguo/instant-nsr-pl/blob/main/LICENSE)) | MIT | NeuS with hash grids, masks | not verified (minutes-scale claims in the README were not checked) | Watertight SDF mesh via marching cubes |
| **sdfstudio** ([licence](https://github.com/autonomousvision/sdfstudio/blob/main/LICENSE)) | Apache-2.0 | NeuS, VolSDF, MonoSDF, neus-facto | not verified | SDF meshes, monocular priors help thin cloth |
| NeuS ([licence](https://github.com/Totoro97/NeuS/blob/main/LICENSE)) | MIT | Original NeuS | hours per object (NeuS2's gallery quotes 8 h for NeuS) | Good but slow |
| TRELLIS.2-4B ([licence](https://github.com/microsoft/TRELLIS.2/blob/main/LICENSE), [card](https://huggingface.co/microsoft/TRELLIS.2-4B)) | MIT | Image-to-3D, not posed-video reconstruction | not checked | Useful as a sanity baseline from front + back photos only |
| SAM 3D Objects ([licence](https://github.com/facebookresearch/sam-3d-objects/blob/main/LICENSE)) | SAM License: broad grant incl. commercial use; bans military/ITAR uses | Single-image object reconstruction | not checked | baseline only |
| VGGT-1B-Commercial ([README](https://github.com/facebookresearch/vggt)) | VGGT licence, commercial use allowed (gated application); **the original VGGT-1B checkpoint is CC BY-NC 4.0** | Feed-forward camera poses + depth from frames | seconds | For re-estimating poses on hosted video |
| MapAnything ([README](https://github.com/facebookresearch/map-anything)) | Code Apache-2.0; **`facebook/map-anything-apache` checkpoint only** — `facebook/map-anything` is CC BY-NC 4.0 | Feed-forward multi-view geometry | seconds | Alternative pose estimator |
| Graphdeco 3DGS, 2DGS, GOF, SuGaR, MILo | **Gaussian-Splatting License, non-commercial** ([3DGS](https://github.com/graphdeco-inria/gaussian-splatting/blob/main/LICENSE.md), [2DGS](https://github.com/hbb1/2d-gaussian-splatting/blob/main/LICENSE.md), [GOF](https://github.com/autonomousvision/gaussian-opacity-fields/blob/main/LICENSE.md), [MILo](https://github.com/Anttwo/MILo)) | — | — | **Banned** |
| PGSR ([licence](https://github.com/zju3dv/PGSR/blob/main/LICENSE.md)) | Commercial only by e-mail permission | — | — | **Banned** until permission |
| Instant-NGP, NeuS2, Neuralangelo ([NGP](https://github.com/NVlabs/instant-ngp/blob/master/LICENSE.txt), [NeuS2](https://github.com/19reborn/NeuS2/blob/main/LICENSE.txt), [Neuralangelo](https://github.com/NVlabs/neuralangelo/blob/main/LICENSE.md)) | NVIDIA Source Code License, "research or evaluation purposes only" | NeuS2: 5 min per synthetic object | — | **Banned** |
| DUSt3R, MASt3R ([DUSt3R](https://github.com/naver/dust3r/blob/main/LICENSE), [MASt3R](https://github.com/naver/mast3r/blob/main/LICENSE)) | CC BY-NC-SA 4.0 | — | — | **Banned** |

Separation (stage 3) building blocks, all commercial-safe: SAM 2 (Apache-2.0, [licence](https://github.com/facebookresearch/sam2/blob/main/LICENSE)), SAM 3 (SAM License, [licence](https://github.com/facebookresearch/sam3/blob/main/LICENSE)), BiRefNet (MIT, [licence](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)).

### Shortlist

- **A — gsplat 2DGS** with our known (or re-estimated) cameras, a mask loss from stage 3, and a depth prior from the bare-mannequin render inside the garment; mesh by Open3D TSDF, then remesh to 8–15k triangles.
- **B — NeuS via instant-nsr-pl** (fall back to sdfstudio neus-facto) with the same masks. Expected trade-off: B is watertight by construction but smoother; A keeps folds but needs the TSDF step to close the surface. Both run in minutes-to-tens-of-minutes per object on one GPU — **no primary page gave a number for our setting, so wall time is a Phase 0 measurement.**

## 3. Garment-specific methods

| Method | What it does | Licence | Usable? |
| --- | --- | --- | --- |
| GarmentCode / pygarment ([licence](https://github.com/maria-korosteleva/GarmentCode/blob/main/LICENSE)) | Programmatic sewing patterns, simulation-based data generation | MIT (code). Body measurement presets come from [GarmentMeasurements](https://github.com/mbotsch/GarmentMeasurements), licence **unverified**; GarmentCodeData dataset licence **unverified** | Yes (code); useful for grading rules and a pattern-space prior |
| Garment-Pattern-Generator / NeuralTailor ([licence](https://github.com/maria-korosteleva/Garment-Pattern-Generator/blob/master/LICENSE), [estimation repo](https://github.com/maria-korosteleva/Garment-Pattern-Estimation)) | Pattern generation; pattern estimation from point clouds | MIT | Yes |
| ChatGarment ([repo](https://github.com/biansy000/ChatGarment)) | Image/text → GarmentCode pattern with a VLM | Apache-2.0 (code); base VLM weight licence chain **unverified** | Maybe, after checking the weights |
| Design2GarmentCode ([licence](https://github.com/Style3D/design2garmentcode-impl/blob/main/LICENSE)) | Multimodal design → GarmentCode program | MIT | Yes (code) |
| AIpparel ([repo](https://github.com/georgeNakayama/AIpparel-Code)) | Multimodal sewing-pattern model | MIT per GitHub metadata; licence file not found at the usual path — **unverified** | Check before use |
| HOOD, ContourCraft ([HOOD](https://github.com/dolorousrtur/hood/blob/main/LICENSE), [ContourCraft](https://github.com/dolorousrtur/ContourCraft/blob/main/LICENSE)) | Learned garment simulation | MIT (code), but they install and use SMPL bodies (`pip install smplx`) | Code yes; the SMPL dependency must be replaced with our own body |
| Garment3DGen ([licence](https://github.com/nsarafianos/Garment3DGen/blob/main/LICENSE.md)) | Image → simulation-ready garment mesh | CC BY-NC 4.0 | **Banned** |
| GarmentDreamer ([licence](https://github.com/boqian-li/GarmentDreamer/blob/main/LICENSE)) | Text → garment via 3DGS | CC BY-NC 4.0 | **Banned** |
| SMPLicit ([licence](https://github.com/enriccorona/SMPLicit/blob/main/LICENSE)) | Implicit clothed-body model | MPI non-commercial | **Banned** |
| Sewformer, GarVerseLOD, Gaussian Garments, GarmentCrafter ([Sewformer](https://github.com/sail-sg/sewformer), [GarVerseLOD](https://github.com/zhongjinluo/GarVerseLOD), [Gaussian Garments](https://github.com/eth-ait/Gaussian-Garments), [GarmentCrafter](https://github.com/humansensinglab/garment-crafter)) | Pattern recovery; single-image garment recon; multi-view garment avatars; garment editing | **No licence file** (all rights reserved) | **Banned** until the authors grant a licence |
| Commercial tools: CLO 3D, Style3D | Pattern-based simulation | Commercial seat licences (not researched) | Optional for building mannequin/garment test fixtures |

The handoff's approach (video → masks → mesh, then anchor and grade with our own rings) does not depend on any of these. GarmentCode is the one worth borrowing from in Phase 1 for grading increments.

## 4. Body models for avatar v1

| Model | Licence | Parameters | Notes |
| --- | --- | --- | --- |
| **Anny** ([repo](https://github.com/naver/anny), [licence](https://github.com/naver/anny/blob/main/LICENSE), [blog](https://europe.naverlabs.com/blog/anny-a-free-to-use-3d-human-parametric-model-for-all-ages/)) | Apache-2.0, "no registration or gated downloads" | Phenotype sliders in [0,1] (age, height, weight, muscle …), local shape changes, rig; v0.6.2 (2026-10-26) adds compact phenotype blendshapes | Built on MakeHuman (CC0 assets), calibrated to WHO data. Do **not** use its optional "smplx" topology, which is SMPL-X and non-commercial. The blog marks the dataset with an asterisk — check its terms if we ever use it |
| **MHR — Momentum Human Rig** ([repo](https://github.com/facebookresearch/MHR)) | Apache-2.0 | 45 identity, 204 pose, 72 expression parameters; 7 LODs | Strong alternative; non-linear pose correctives are a neural net, heavier in the browser |
| MakeHuman / MPFB2 ([MakeHuman licence](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md), [MPFB2 licence](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md)) | Assets CC0 1.0; **code GPLv3** | Targets/modifiers | Use the CC0 assets offline (e.g. to build mannequin shapes); never ship GPL code in our bundles |
| SMPL / SMPL-X ([licence](https://github.com/vchoutas/smplx/blob/main/LICENSE)) | Non-commercial; also forbids training commercial networks with it | 10–300 shape | Commercial licence now sold directly by **Max Planck Innovation** after Epic Games acquired Meshcapade ([MPG, 2026-02-18](https://www.mpg.de/26082348/max-planck-spin-off-draws-epic-games-to-tubingen)); price not published (**unverified**) |
| STAR, SUPR ([STAR](https://github.com/ahmedosman/STAR/blob/master/LICENSE), [SUPR](https://github.com/ahmedosman/SUPR/blob/master/LICENSE)) | Non-commercial; same training ban | — | **Banned** |
| Own low-parameter model | ours | ~12 rings + 6 lengths | Always needed on top: the fit engine's anchors are the source of truth (D15) |

**Recommendation:** Anny as the template mesh and shape space, fitted on device to the shopper's 12 rings and lengths by a small solver of our own (the "own low-parameter model" becomes the fitting layer, not a new mesh). Export Anny's phenotype blendshapes once to glTF morph targets so the browser needs no PyTorch. Build the canonical mannequin shapes (XS–XXL) from the same Anny space so the server mannequin and the device avatar share topology and anchor rings. Keep MHR as the fallback if Anny's body shapes do not span the size range well enough in Phase 0.

## 5. Hosted GPU services (per-second, scale to zero, EU)

| Service | L4 / 24 GB class | A10 | L40S / 48 GB | A100 80 GB | H100 | Billing | Scale to zero, cold start | EU region | Container |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Modal** ([pricing](https://modal.com/pricing), [regions](https://modal.com/docs/guide/region-selection), [cold start](https://modal.com/docs/guide/cold-start)) | $0.80/h | $1.10/h | $1.95/h | $2.50/h | $3.95/h | Per second | Yes; containers "boot in about one second" plus model load; memory snapshots; default scale-down 60 s (2 s–20 min) | `eu` (EEA) at **1.15×**, `eu-west/-north/-south` at 1.75× | Custom images |
| **Koyeb** ([pricing](https://www.koyeb.com/pricing), [regions](https://www.koyeb.com/docs/reference/regions)) | $0.70/h | — | $1.20/h | $1.60/h (variant not stated) | $2.50/h | Per second | Scale to zero advertised; cold start not published — **measure** | Frankfurt (FRA), Paris (PAR); which GPUs per region **unverified** | Docker |
| **RunPod Serverless** ([pricing](https://www.runpod.io/pricing), [billing](https://docs.runpod.io/serverless/pricing), [config](https://docs.runpod.io/serverless/endpoints/endpoint-configurations)) | $0.75/h (24 GB pool) | (24 GB pool) | $1.75/h | $2.72/h | $5.39/h | Per second, flex workers; cold start and idle timeout (default 5 s) are billed | Yes; FlashBoot on by default in the console | Endpoints can be restricted to data centres; EU data-centre list not on the pages read — **unverified** | Docker |
| **Baseten** ([pricing](https://www.baseten.co/pricing/), [regions](https://docs.baseten.co/deployment/regional-deployments)) | $0.85/h | $1.21/h (A10G) | — | $4.00/h | $6.50/h | Per minute | Scale to zero advertised | `eu` for verified organisations, GPU deployments only | Truss / custom |
| **Replicate** ([pricing](https://replicate.com/pricing)) | T4 $0.81/h | — | $3.51/h | $5.04/h | $5.49/h | Per second; private models also billed for setup and idle | Not stated for private models | None published | Cog |
| **Scaleway** ([GPU pricing](https://www.scaleway.com/en/pricing/gpu/)) | €0.79/h (L4-1-24G, PAR-1) | — | PAR-2, price not shown | — | PAR-2, price not shown | Hourly instances | No serverless GPU found | Paris | VM / Kubernetes |
| **OVHcloud AI Deploy** ([product](https://www.ovhcloud.com/en/public-cloud/ai-deploy/)) | — | — | — | — | €3.10/h H100 (2024 announcement, **stale**) | Per minute (2024 announcement) | Scale to zero **unverified** | France (Gravelines and others) | Docker |
| Lambda | — | — | — | — | — | On-demand instances, no serverless product found | No | **not verified** | VM |

**Recommendation:** Modal `eu` for Phase 0 (effective H100 ≈ $4.54/h, L40S ≈ $2.24/h, L4 ≈ $0.92/h after the 1.15× multiplier); deploy the same image to Koyeb Frankfurt and record cold start and price per run for the Phase 0 write-up. Replicate and Scaleway are out (no EU serverless, or no scale to zero). The worker stays one portable container (handoff risk table).

## 6. Cost estimate per product (Phase 0) — ESTIMATE

**This is an estimate, not a measurement.** Phase 0 must replace every number with measured GPU seconds and invoices (acceptance item "Cost").

Assumptions:

- Video per product: turntable as two 5 s half-turns + one 5 s motion clip = **15 s at 720p**, one attempt. Phase 0 will run ~3 seeds per model, so multiply video cost by 3 for the spike budget.
- Dressing stills (front and back on the mannequin): self-hosted FASHN VTON 1.5 or Qwen-Image-Edit, ~1 min on an L40S ≈ $0.04 per product.
- Self-hosted Wan2.2-A14B at 720p, 81 frames, 40 steps: **~20 min per 5 s clip on one H100** (third-party estimate; the official README's timing table is an image and was not read; LightX2V reports 2,685 s on an RTX 5090). 4-step distilled: **~1 min per clip** (assumption; the 26.7 s figure is from an RTX 5090 with NVFP4 kernels that an H100 lacks).
- Separation: SAM 2 over ~250 frames on an L4, ~3 min.
- Reconstruction: 2DGS or NeuS, ~20 min on an L40S per method, plus ~2 min TSDF/remesh on CPU.
- Overhead: one cold start of ~2 min per stage container (3 stages) at the stage's GPU price.
- GPU prices: Modal `eu` (1.15×) from section 5.

| Item | Hosted video (Kling 3.0 Pro) | Self-hosted Wan2.2 40-step | Self-hosted Wan2.2 4-step |
| --- | --- | --- | --- |
| Dressing stills | $0.04 | $0.04 | $0.04 |
| Video, 15 s | 15 × $0.112 = **$1.68** | 3 × 20 min H100 = 60 min × $4.54/h = **$4.54** | 3 × 1 min = 3 min × $4.54/h = **$0.23** |
| Pose re-estimation (hosted only) | ~$0.02 | — | — |
| Separation | $0.05 | $0.05 | $0.05 |
| Reconstruction, one method | 20 min × $2.24/h = $0.75 | $0.75 | $0.75 |
| Cold starts | ~$0.20 | ~$0.25 | ~$0.25 |
| **Per product, one attempt** | **≈ $2.7** | **≈ $5.6** | **≈ $1.3** |

Phase 0 spike budget: 5 products × (2 video models × 3 seeds) × (2 reconstruction methods), i.e. 6 video runs and 12 reconstructions per product, comes to roughly **5 × (3 × $1.68 + 3 × $4.54 + 12 × $0.75 + overhead) ≈ 5 × $28 ≈ $140**, plus Veo 3.1 as a reserve ($0.20/s × 15 s × 3 seeds × 5 products ≈ $45). Budget **$250** for GPU and API in Phase 0 including failed runs. For Phase 1 pricing, the 4-step self-hosted path suggests **≈ $1–2 per product build**, if its quality holds.

## 7. Licence table and banned-model list

Status: **OK** = commercial use allowed for us; **Condition** = allowed under a threshold or registration; **Banned** = added to `packages/tryon-providers/src/bannedModels.ts`.

| Name | Category | Licence | Status |
| --- | --- | --- | --- |
| Wan2.2 (I2V, TI2V), Wan2.2-Fun (Control, Control-Camera, InP), VACE-Fun, LightWan2.2 | Video | Apache-2.0 | OK |
| Wan2.1-VACE | Video | Apache-2.0 ([VACE](https://github.com/ali-vilab/VACE)); VACE-LTX-Video-0.9 is RAIL-M | OK |
| Kling 3.0, Veo 3.1, Runway Gen-4.x, Seedance, Hailuo, Grok Imagine, Wan 2.7 hosted, Luma Ray 2 | Video (API) | Vendor API terms; outputs usable commercially per vendor/fal tags | OK (terms not reviewed in full) |
| LTX-2 | Video | LTX-2 Community License, free below $10M revenue | Condition |
| SV4D 2.0, Stable Video Diffusion | Video / novel view | Stability Community License, free below $1M revenue | Condition |
| CogVideoX-5B / 1.5 | Video | CogVideoX License, registration + below 1M monthly visits | Condition |
| ReCamMaster (open release) | Video | MIT | OK |
| HunyuanVideo, Hunyuan3D (Tencent Hunyuan Community License) | Video / 3D | Excludes EU, UK, South Korea | **Banned** (`hunyuan`) |
| SV3D | Novel view | `sv3d-nc-community` | **Banned** (`sv3d`) |
| FLUX.1 [dev], FLUX.1 Kontext [dev], FLUX.2 [dev] weights ([Kontext](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev), [FLUX.2](https://huggingface.co/black-forest-labs/FLUX.2-dev)) | Image edit | FLUX (dev) Non-Commercial License | **Banned** (`flux.1-dev`, `flux.1-kontext-dev`, `flux.2-dev`) |
| FASHN VTON 1.5, Qwen-Image-Edit, Leffa | Image / try-on | Apache-2.0, Apache-2.0, MIT ([Leffa](https://github.com/franciszzj/Leffa)) | OK |
| IDM-VTON, OOTDiffusion, CatVTON, FitDiT | Try-on | CC BY-NC-SA 4.0 | **Banned** (existing) |
| CatV2TON, Magic-TryOn | Video try-on | No licence file | **Banned** (`catv2ton`, `magictryon`) |
| Mobile-VTON | Try-on | CC BY-NC-SA per `tryon-engines.md`; repo shows no licence | **Banned** (`mobile-vton`) |
| ViViD | Video try-on | Apache-2.0 per its [licence file](https://github.com/alibaba-yuanjing-aigclab/ViViD) — note: `tryon-engines.md` lists it as non-commercial; the file says otherwise | OK (re-check before use) |
| gsplat, nerfstudio, 3DGRUT, Brush, sdfstudio | Reconstruction | Apache-2.0 | OK |
| instant-nsr-pl, NeuS, Open3D, TRELLIS / TRELLIS.2 | Reconstruction | MIT | OK |
| VGGT-1B-Commercial | Poses | VGGT licence (commercial, gated) | OK — **VGGT-1B (original) is CC BY-NC 4.0** |
| MapAnything-apache | Poses | Apache-2.0 | OK — **`facebook/map-anything` is CC BY-NC 4.0** |
| SAM 2, SAM 3, SAM 3D Objects, BiRefNet | Segmentation / 3D | Apache-2.0, SAM License, SAM License, MIT | OK |
| Inria 3DGS, 2DGS, GOF, SuGaR, MILo | Reconstruction | Gaussian-Splatting License (non-commercial) | **Banned** (`graphdeco-inria`, `2d-gaussian-splatting`, `gaussian-opacity-fields`, `anttwo`) |
| PGSR | Reconstruction | Commercial by permission only | **Banned** (`pgsr`) |
| Instant-NGP, NeuS2, Neuralangelo | Reconstruction | NVIDIA Source Code License (non-commercial) | **Banned** (`instant-ngp`, `neus2`, `neuralangelo`) |
| DUSt3R, MASt3R | Poses | CC BY-NC-SA 4.0 | **Banned** (`dust3r`, `mast3r`) |
| GarmentCode, Garment-Pattern-Generator/Estimation, Design2GarmentCode, HOOD, ContourCraft | Garment | MIT | OK (HOOD/ContourCraft need SMPL replaced) |
| ChatGarment | Garment | Apache-2.0 code; weights **unverified** | Check |
| AIpparel | Garment | MIT per GitHub metadata, file **unverified** | Check |
| Garment3DGen, GarmentDreamer | Garment | CC BY-NC 4.0 | **Banned** |
| SMPLicit | Garment / body | MPI non-commercial | **Banned** (`smpl`) |
| Sewformer, GarVerseLOD, Gaussian Garments, GarmentCrafter | Garment | No licence file | **Banned** |
| Anny, MHR | Body | Apache-2.0 | OK |
| MakeHuman / MPFB2 | Body | Assets CC0, code GPLv3 | OK (assets only) |
| SMPL, SMPL+H, SMPL-X | Body | MPI non-commercial; commercial via Max Planck Innovation | **Banned** (`smpl`, `smpl-x`) unless we buy a licence |
| STAR, SUPR | Body | MPI non-commercial | **Banned** (`ahmedosman/star`, `ahmedosman/supr`) |

The banned list is a substring match with separators ignored (`registry.ts`). Two limits follow from that and are handled by review, not by the lint:

- STAR and SUPR are banned by their repository path only; the bare names would also match "start" and "superb".
- VGGT-1B vs VGGT-1B-Commercial and `map-anything` vs `map-anything-apache` share a prefix, so the non-commercial checkpoints cannot be banned without also banning the commercial ones. Pin the commercial ids exactly.

## Open points for Phase 0

- Confirm the Wan2.2-Fun control-video and camera-trajectory input formats in VideoX-Fun's code (not documented on the model cards).
- Measure Wan2.2-A14B wall time on H100 at 720p for 40 and 4 steps; the only published 4-step figure is on Blackwell hardware.
- Check Kling's own API capability map for `camera_control` on 3.x models, and whether fal or Kling offers EU processing.
- Read Vertex AI's Veo price list directly (page did not render) if Veo becomes the hosted candidate.
- Get the Max Planck Innovation SMPL-X quote only if Anny and MHR both fail the size range.
- Founder call: hosted video models process merchant product photos outside the EU (section "Decision summary", point 2).

## Stage 1b — dressing our mannequin from shop photos (researched 2026-11-06)

**Problem.** Stage 2 pins a front and a back still of the garment *on our canonical mannequin* at frame 0 and frame N/2 of the turntable (same camera as the control video). A shop's public product photos show the garment on a person, or flat-lay. Stage 1b turns those photos into the two pinned stills: segment the garment, put it on our bare-mannequin render without moving the mannequin or the camera, and check the result. It is needed for the first validation on real shop data (public product photos used with the shop owner's consent, before anything is installed on their site); for a published asset the merchant still supplies front and back (D13). Code: `spikes/garment-engine/modal/stage1_dress.py`, helpers in `phase0_lib.py`, usage in `modal/README.md`. Nothing here has run on a GPU yet.

### Choice

| Role | Model (pinned revision) | Licence, as read | Weights | Decision |
| --- | --- | --- | --- | --- |
| Garment box from text | Grounding DINO base, `IDEA-Research/grounding-dino-base` @ `12bdfa31…` | Apache-2.0 ([licence file](https://github.com/IDEA-Research/GroundingDINO/blob/main/LICENSE), HF tag) | Downloadable, not gated, 0.9 GB (safetensors) | **Use** (prompt per category, e.g. `dress. jumpsuit.`) |
| Garment mask from the box | SAM 2.1 Hiera-L, `facebook/sam2.1-hiera-large` @ `665f8e2a…` | Apache-2.0 ([licence file](https://github.com/facebookresearch/sam2/blob/main/LICENSE), HF tag) | Downloadable, not gated, 0.9 GB, transformers format | **Use** (box prompt; also refines the garment mask on the dressed still) |
| Try-on, engine A (default) | FASHN VTON v1.5, `fashn-ai/fashn-vton-1.5` @ `77206831…`, code `fashn-AI/fashn-vton-1.5` @ `7c0f10af…` | Apache-2.0 for weights ([model card](https://huggingface.co/fashn-ai/fashn-vton-1.5)) and code ([licence file](https://github.com/fashn-AI/fashn-vton-1.5/blob/main/LICENSE)); DWPose and YOLOX Apache-2.0 | Downloadable, not gated, 1.9 GB + DWPose ONNX 0.35 GB (`fashn-ai/DWPose` @ `548b5df2…`, Apache-2.0) | **Use, without its human parser** (below). 972M MMDiT in pixel space, output 576×864, about 8 GB VRAM, about 5 s per image on an H100 (model card). Takes on-model or flat-lay garment photos, categories tops / bottoms / one-pieces |
| Image edit, engine B | Qwen-Image-Edit-2511, `Qwen/Qwen-Image-Edit-2511` @ `6f3ccc0b…` | Apache-2.0 (HF model card tag; the [Qwen-Image licence file](https://github.com/QwenLM/Qwen-Image/blob/main/LICENSE) is Apache-2.0; the HF repo itself has no licence file) | Downloadable, not gated, 57.7 GB | **Use** as the second engine and for the invented back: multi-image edit (picture 1 = our render, picture 2 = the garment). Needs diffusers ≥ 0.37.1 (`zero_cond_t` in its transformer config); 2509 is the fallback on diffusers 0.36.0 |
| Human parsing | FASHN Human Parser, `fashn-ai/fashn-human-parser` (SegFormer-B4 fine-tune) | **NVIDIA Source Code License for SegFormer**: "may be used … non-commercially", i.e. research or evaluation only ([licence](https://github.com/NVlabs/SegFormer/blob/master/LICENSE)); the `fashn-human-parser` pip package's licence file says it inherits it | Downloadable | **Banned** (`fashn-human-parser`). FASHN VTON's pipeline imports and loads it by default: we install `fashn-vton` with `--no-deps`, fail the image build if the parser is importable, and pass our SAM 2 mask as the label map |
| Human parsing | Sapiens (`facebook/sapiens-*`) | CC BY-NC 4.0 (HF licence tag) | Downloadable | **Banned** (`facebook/sapiens`) |
| Human parsing | SegFormer clothes fine-tunes (ATR/LIP-style) | Base weights `nvidia/mit-b*` carry the SegFormer licence (HF tag `other`); fine-tunes inherit it | — | Avoid; not banned by name (no single id to match) |
| Text-prompted segmentation | SAM 3, `facebook/sam3` | SAM License (19 Nov 2025): commercial use allowed, with trade-control, attribution-in-publications, no-reverse-engineering and indemnity terms; California law | Gated, manual approval on Hugging Face | Not for Phase 0 (a CI run would need an approved token); a later option if counsel accepts the terms |
| Background removal | BiRefNet | MIT | Downloadable | Not needed: SAM 2 with a box covers flat-lay as well |
| Image edit | FLUX.1 Kontext [dev] | Non-commercial | — | Banned (section 7) |
| Try-on | IDM-VTON, CatVTON, OOTDiffusion, FitDiT | CC BY-NC-SA 4.0 | — | Banned (section 7) |

Not reviewed: the training-data terms behind DWPose (COCO-WholeBody, UBody) and FASHN VTON's 18M training pairs. The weights' licences are Apache-2.0; counsel should confirm that is enough before Phase 1.

### How a still is made

1. **Shop photo → garment.** Grounding DINO finds the garment box for the category prompt, SAM 2.1 cuts the mask. The person in the photo is never sent to the edit model: the qwen engine gets only the cut-out on studio grey. In the fashn engine the try-on model sees the photo with every non-garment pixel greyed by its own preprocessing (our mask as label map), but its DWPose step runs on the full photo to read the garment's pose. Everything runs in our Modal container; no third-party API sees the photos.
2. **Try-on onto our render.** The bare mannequin at frame 0 / N/2 is rendered by the exporter (`dress/bare_front.png`, `dress/bare_back.png`) with the turntable camera and light. FASHN runs in its maskless mode (it may draw the garment wider than any original outfit); Qwen gets a prompt that fixes mannequin, pose, camera, framing, light and background.
3. **Back.** From the back photo when there is one. Without one the back is generated (FASHN: the front photo onto the back render; Qwen: the dressed front still as reference) and flagged `invented` in the manifest, the record, the summary and the logs. The stage 2 runner refuses an invented back unless `--allow-invented-back` is given.
4. **Garment mask on the output.** Difference to our bare render (the stage 3 idea), refined by SAM 2 with that box; SAM 2 wins when the two agree (IoU ≥ 0.5) or when the difference finds nothing (a garment the colour of the mannequin).
5. **Alignment QA**, against our silhouette at that frame: share of garment pixels inside the silhouette dilated by a category margin (8 % of the frame height for one-pieces), silhouette IoU of the uncovered mannequin (did the model keep pose and camera?), covered share, uncovered-mannequin colour difference, border contact. Thresholds are first guesses and must be set from the first real runs.
6. **Composite.** The pinned still is our bare render with only the garment pixels pasted in, so mannequin, light and background match the control video exactly. Garment shadows on the mannequin are lost; that is the price of exact alignment.

### Risks

- **DWPose on a grey mannequin.** FASHN conditions on DWPose keypoints of the person image. Whether DWPose finds a body on our untextured mannequin is unknown; the record counts the keypoints it found. If it fails, rendering the keypoints from our own rig (we know every joint) is the fix; the qwen engine needs no pose.
- **Pose and camera drift.** Both models are trained on photos of people; neither promises to leave a mannequin's pose untouched. The silhouette IoU catches drift, the composite hides small drift of the uncovered body but not of the garment.
- **Invented backs** are where models make things up (D13). They are allowed only to exercise the pipeline on shops without back photos; their numbers must be reported separately.
- **Hosted alternative.** The provider registry's hosted FASHN API would avoid the GPU work but sends the shop photos to FASHN's service (processing location not checked for this section); not used here, a founder call like the hosted video question.

### Cost (estimate)

One product (two views) ≈ 2–5 H100 minutes including model loading ≈ $0.15–0.40 at Modal `eu`; first run also downloads about 4 GB (fashn) or 60 GB (qwen) of weights. FASHN's 5 s per image is from its model card; no Qwen-Image-Edit-2511 timing was found in the sources read. Not measured.

## Cut families and stage 4b — build once per cut, swap the print (2026-11-06)

**Problem.** Shops sell one cut in many colours and prints. The first real GPU run (GitHub Actions run 10) cost about $1.59 for stage 2 alone (Wan2.2-Fun-A14B-Control, H100, about 24 min; list price × seconds, an estimate) and it is also where the garment drifts: between the pinned front and back frames the dress turned into trousers and the product title appeared as text. A colour variant should not pay for, or risk, that step again.

**Families** (`spikes/garment-engine/src/families.ts`, CLI `families:bohohippychic`, output `data/bohohippychic/families.json`). Products are one cut when product type, size values, title stem and description match after removing colour words, print words, variant codes (PWP1) and shop boilerplate; measurements stay in the comparison. Rule 4b (added after review) also joins two descriptions of one type, size set and stem when their measurement numbers are identical (at least two) and their word sets overlap by a Jaccard of 0.9 or more, compared against every group already in the family so that similarity never chains; it absorbs one-phrase copy edits such as "Best seller in store" or "Crafted in a deep navy,", and each member joined this way carries its Jaccard and a note. A silhouette check on the main photo (foreground mask, scale-normalised IoU, threshold 0.6) splits false merges. Per family a reference member (best photos: no model, then resolution, then image count) gets the full run; a member whose fabric or size chart differs from it gets its own.

**Which types count.** Only types the engine can build today count as garment types: Dresses, Tops, Pants, Skirts, Jackets & Knits and the shop's catch-all Clothing (tees, tops and dresses). **Jumpsuits & Sets** (Nomad Overalls, pant suits) is reported in its own bucket: there is no engine category for a garment that spans torso and legs, the schema reads the type as "dress" (a proxy without legs), there is no control proxy with legs and no validation product. An earlier version of this table counted it as a garment type, so 7 of its "saved" runs had no pipeline.

| bohohippychic.com.au, 667 products (public catalogue, 2026-11-06) | All types | Garment types (buildable) | Jumpsuits & Sets (once the category exists) |
| --- | --- | --- | --- |
| Products | 667 | 525 | 12 |
| Exact description rule: full runs / need only stage 4b | 595 / 72 | 461 / **64** | 5 / 7 |
| With rule 4b: full runs / need only stage 4b | 567 / 100 | 434 / **91** | 4 / 8 |
| Members joined by rule 4b | 31 | 29 | 2 |
| Members with their own asset (fabric or chart differs from the reference) | 2 | 2 | 0 |
| Largest family | Earthweave Knit Top, 31 colours (29 by the exact rule) | | |
| Same stem, copy not similar enough (not merged; merchant can confirm) | | 34 groups, up to 43 more runs | |

At run 10's stage 2 cost ($1.59, an estimate) the saved garment runs are about **$100** of video generation with the exact rule (64 runs) and about **$145** with rule 4b (91 runs), before stage 1b and stage 4. The two members with their own asset were joined by rule 4b and then caught by the fabric comparison (Earthweave Purple has no "Material" line; the Chocolate Drift Lace Blouse's fabric reads differently), which is the intended safety net. Limits: rule 4b was checked by reading the joined copy of five families (Earthweave Purple, Haven Midi, Drift Lace Blouse, Nomad Cotton Jacket, Marlow Crochet Lace Top: every difference is a colour sentence or a styling suggestion), not by looking at all 29 members' photos; copy without measurements never joins, so near misses stay (e.g. one Earthweave group with rewritten copy and other measurements). Title stems are over-stripped where a print word is part of the name (Desert Bloom → "desert dress"); only the id changes, since the description must still match. The silhouette check refused all 94 main photos it looked at, because every one is a model in a styled set (busy border), so on this shop it split nothing. It works on plain-backdrop photos in the tests and takes a garment mask from a segmentation model (stage 1b's Grounding DINO + SAM 2) when one is supplied.

**Stage 4b** (`spikes/garment-engine/modal/stage4b_retexture.py`). Inputs: the reference's `stage4/<source>/garment.glb` and the variant's front and back stills on our mannequin from stage 1b, with their garment masks; the cameras are the known turntable cameras at frame 0 and N/2 (checked equal to the reference's). Per texel the mesh point is projected into both stills and takes the real pixel where it is visible (inside the frame and the mask, nearest surface in the mesh's own z-buffer, not at a grazing angle). The sides no still sees are filled by **mirroring the nearest seen print across the visibility boundary**, row by row in a cylinder grid around the turntable axis: simple, deterministic, documented, and no generative model. Output per variant, inside the reference's bundle: `texture.png`, `material.json` (the reference's fabric with the variant's colour and texture), `preview.glb`, `record.json` with coverage, input hashes and cost, plus the bundle index `variants.json`. Stage 4 writes no UVs yet, so stage 4b lays out one atlas cell per triangle (`garment_uv.glb`, shared by the family).

- **Licences:** no model is used; the container installs only `pillow==11.3.0` (HPND/MIT-CMU).
- **Cost (estimate):** CPU only. The pure-Python core took about 4 s locally for 12k triangles, two 480×832 stills and a 1024 texture; with container start a variant should cost cents. The research doc has no Modal CPU price, so the record leaves the dollar figure empty and keeps the seconds. Not measured on Modal.
- **Inputs it refuses:** a real variant without stage 1b garment masks (the z-buffer holds only the garment mesh, so skin or mannequin colour would bake into the texture; `--allow-missing-mask` accepts it as a recorded warning). The turntable axis for the fill is the mean camera centre of `cameras_opencv.json`, not a fixed origin.
- **Risks:** the variant inherits the reference's geometry, so a variant whose cut differs (a false merge) gets a wrong shape with a right print; the stage 1b stills of reference and variant must agree in pose, or the print lands off the mesh; the mirrored side is an estimate (labelled in every record, AGENTS.md rule 3) and a print with a direction (text, a single motif) will look reflected there.

## Stage 2 control after the first GPU run (2026-11-06)

**What run 10 showed.** The first full `run_phase0.py` (GitHub Actions run 10, aalter-studio-2 with synthetic stills; stage 2 on an H100 for about 24 minutes, cost estimate $1.59; stage 4 on an L40S) held the pinned front and back frames and the camera path. Between the pinned frames the dress became trousers (frames 20, 60 and 100), and frame 20 showed the product name as text. Stage 4 on the generated frames reached a mask IoU of 0.90, against 0.99 on the synthetic truth. Wan2.2-Fun-A14B-Control follows its control video closely, and that video showed the bare mannequin with two separate legs. The positive prompt held the product title in quotes, and video models render quoted text as letters.

**Change (export 0.2.0, not yet run on a GPU).**

1. **Control proxy.** The control depth and silhouette show the mannequin wearing a coarse, closed proxy garment built from the category and the size chart (`spikes/garment-engine/src/proxy.ts`):
   - dress or skirt: one volume around both legs down to the chart length;
   - trousers: two legs with a gap between them;
   - top or outerwear: a torso shell with sleeves.

   The girths are the chart's at the base size, with ease. The proxy is a control signal only and never an output. `--control bare` keeps the old behaviour. The mode and the proxy spec are part of `input_hash`.
2. **Neutral prompts.** The prompts are built from fixed vocabulary: category, colour, length, sleeves and fabric. They contain no title or brand. The negative prompt lists text, letters, words, watermark and logo, plus the opposite garment (trousers for a dress or skirt, a dress or skirt for trousers). Both prompts are written into the manifest, and stage 2 refuses a manifest that fails the check.
3. **Garment-consistency metric.** Every generated frame's silhouette is compared with the control proxy's at the same pose: IoU over the whole frame, IoU within the garment rows, and the share of the proxy that the frame covers. The flagged frames go into `stage2/record.json`, so the next run reports drift as numbers. The thresholds are first guesses. Its blind spots are recorded with it: around 90° and 270° the legs overlap, so a dress-to-trousers drift does not change the silhouette (`blind_frames`, frames without a leg gap in our control); white, cream and light-grey garments merge into the light-grey background (`low_contrast_frames`); and `garment_cover` is measured against the proxy's default flare, so a correct but narrower dress can be flagged. `min_garment_cover` is to be set per proxy kind from run 11.
4. **Proxy geometry in the hash.** `input_hash` covers the sha256 of `control/proxy.glb`, not only the proxy spec, so a change to the proxy mesh code changes the job id and cached stage 2 outputs are not reused against different control frames.

Usage, file layout and what is not tested: `spikes/garment-engine/modal/README.md`, section "Stage 2 after run 10".

**Risks.**
- The model may copy the proxy's coarse shape (flare, hem line, no waist definition) instead of the pinned stills. A proxy that is too tight or too loose then becomes the garment's silhouette in the video. The proxy only has to be right in topology (one volume or two legs); its girths come from the chart.
- In the motion clip the dress proxy moves rigidly with the pelvis, so a stepping leg can push through it.
- If the drift persists with the proxy, the next options are the VACE-Fun or InP variants, a lower control strength, or the hosted path (shortlist B).
