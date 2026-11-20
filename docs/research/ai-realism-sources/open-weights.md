# Open-weight render-to-photo models: licences, structure control, cost, on-device (read 2026-11-19)

Task: turn our 3D render (mannequin in a draped garment on flat cream, plus depth, normal and segmentation passes) into a photorealistic person wearing the same garment, with the same silhouette, hem and waist position and colour. Only open weights whose licence allows our commercial use.

Rules for this note:
- Every licence below was read on 2026-11-19 from the URL given, unless it is marked **not verified**.
- Quotes are as returned by the page fetch. Where a card only shows a licence *tag* (no file read), the note says "tag".
- Timings are **published** only where a source is named. Anything else is marked **estimate**.
- This note does not repeat `docs/research/garment-engine.md` section 5 (GPU hosts) or section 7 (licence table). Wan2.2 / Wan2.2-Fun / VACE-Fun, Qwen-Image-Edit, FASHN VTON, LTX-2 (Condition, $10M), SAM 2 and BiRefNet are already rated there and are only cross-referenced here.

---

## Summary table

| Model | Licence (as read) | Commercial for us? | Structure control | Speed (published / estimate) | Est. € per 1 MP image, self-hosted | On device |
| --- | --- | --- | --- | --- | --- | --- |
| **FLUX.2 [klein] 4B** (distilled) and **klein base 4B** | Apache-2.0 | **ALLOWED** | Edit with reference image (render in, photo out); no official ControlNet; community depth LoRA (licence not verified) | "sub-second" (card, GPU not stated); 4 steps | ≈ $0.001–0.002 on L40S (estimate) | Best candidate, but not in a phone browser yet (see §On-device) |
| FLUX.2 [klein] **9B** | FLUX Non-Commercial License | **BANNED** | — | — | — | — |
| **Z-Image-Turbo** + **Z-Image-Turbo-Fun-Controlnet-Union 2.1** | Apache-2.0 / Apache-2.0 | **ALLOWED** | Canny, Depth, Pose, MLSD, HED, Scribble, Gray, Inpaint, Tile | 8 steps; "sub-second" on H800 (card); ≈2.3 s on RTX 4090 (community, not primary) | ≈ $0.002 on L40S (estimate) | ONNX q4f16 WebGPU/WebNN port exists; no timings |
| **Qwen-Image-Edit-2509 / 2511** (+ Lightning LoRA) | Apache-2.0 / Apache-2.0 | **ALLOWED** | 2509: "Native Support for ControlNet: Including depth maps, edge maps, keypoint maps"; multi-image edit | 40 steps base; 4 steps with Lightning, "≈10x faster" (card) | ≈ $0.006–0.01 on H100 (estimate) | No (20B) |
| **Qwen-Image** + InstantX **ControlNet-Union** / DiffSynth Blockwise Depth | Apache-2.0 / tag apache-2.0 / tag apache-2.0 | **ALLOWED** | Canny, soft edge, depth, pose (no normal) | not published | ≈ $0.01–0.02 on H100, 40 steps (estimate); 8-step Lightning LoRA lowers it | No |
| **SDXL base 1.0** + **xinsir controlnet-union-sdxl-1.0 (ProMax)** + diffusers depth | CreativeML Open RAIL++-M / tag apache-2.0 / tag openrail++ | **ALLOWED** (use-based restrictions) | 12 controls incl. **Normal**, Depth, Canny, Segment; ProMax adds inpaint/outpaint/tile | not published | ≈ $0.003 on L4 (estimate) | Core ML SDXL on iPhone 15 Pro Max: 31 s at 768² (Apple) — too slow, no SDXL ControlNet on Core ML |
| **IC-Light v1** (SD1.5 relight, fc / fbc) | code Apache-2.0; weights tag creativeml-openrail-m | **ALLOWED** | Foreground-conditioned relight; background-conditioned relight | not published | ≈ $0.001 on L4 (estimate) | SD1.5-class: possible natively, not in browser at quality |
| IC-Light **v2** (Flux-based) | "the license will be non-commercial only"; weights not released | **BANNED** (and unavailable) | — | — | — | — |
| **SD 3.5 Large / Large Turbo / Medium** + SD3.5 ControlNets (Depth, Canny, Blur) | Stability AI Community License | **CONDITION**: commercial only under USD 1M annual revenue, and registration | Depth, Canny, (Blur) | 28–40 steps; Turbo 4 steps | ≈ $0.01–0.02 on H100, 40 steps (estimate) | No |
| **SD-Turbo** (2.1 distilled) | Stability AI Community License (file read) | **CONDITION** (as SD3.5) | none native | 1–4 steps; "within one second" on RTX 4090 in browser (Microsoft) | — | Yes on desktop WebGPU; quality is 512² SD2.1-class |
| **SDXL-Turbo** | tag `sai-nc-community` | **BANNED** (non-commercial tag) — LICENSE file not read | — | — | — | — |
| **HiDream-I1 / E1-1** | MIT (transformer) + Llama 3.1 Community License (text encoder) + FLUX.1 schnell VAE (Apache-2.0) | **ALLOWED with Llama 3.1 terms** | E1 is an instruction editor; no ControlNet found | not published (17B) | ≈ $0.02 on H100 (estimate) | No |
| **FLUX.1 [schnell]** | Apache-2.0 | **ALLOWED** — but **no commercially licensed ControlNet found** | Every FLUX.1 ControlNet checked is dev-licensed (non-commercial) | 1–4 steps | — | No (12B) |
| **Chroma1-HD** (schnell derivative) | Apache-2.0 ("fully Apache 2.0 licensed") | ALLOWED | no ControlNet mentioned | — | — | No |
| **Sana / Sana Sprint 1.6B** | Apache-2.0 tag + Apache-2.0 GitHub LICENSE, but card: "intended for research purposes only"; Gemma terms for text encoder | **CHECK** (conflicting statements) | Sana Sprint ControlNet: 0.25 s on H100 (card) | Sprint: 0.1 s / 1 step on H100; 0.31 s on RTX 4090 (card) | very low | Small enough to be interesting; no port found |
| **Lumina-Image 2.0** | tag apache-2.0 | ALLOWED | no ControlNet mentioned | 50 steps | — | No |
| **CogView4-6B** | Apache-2.0 | ALLOWED | no ControlNet | 13–35 GB VRAM (card) | — | No |
| **Kolors** | Kolors model licence: registration for commercial use, Chinese law | **CONDITION** (registration; PRC law and courts) | ControlNet only as Spaces; weights not verified | — | — | No |
| **LTX-Video 0.9.6+ / 13B** | LTX-Video Open Weights License: paid commercial licence for revenue ≥ $10M | CONDITION (as LTX-2) | ICLoRA Depth, Pose, Canny (0.9.7) | — | — | No |
| **Wan2.1-VACE-14B** | Apache-2.0 | ALLOWED (already in §7) | depth, pose, mask, reference | — | — | No |
| Hunyuan*, FLUX.1/2 [dev], all FLUX.1-dev ControlNets | non-commercial / EU excluded | **BANNED** | — | — | — | — |
| **Segmentation:** MediaPipe multiclass selfie | Apache-2.0 (model card) | ALLOWED | classes: hair, body skin, face skin, **clothes**, others | real-time | — | **Yes, Web** (`@mediapipe/tasks-vision`) |
| BiRefNet | MIT | ALLOWED | matting | — | — | ONNX ports exist (not read) |
| SAM 2.1 | Apache-2.0 | ALLOWED | prompted masks; tiny 38.9 M params, 91.2 FPS A100 | — | — | tiny is portable (no web timing read) |
| RMBG-2.0 (BRIA) | CC BY-NC 4.0 | **BANNED** | — | — | — | — |

---

## Allowed vs banned for us

**ALLOWED (licence permits our commercial use as read today):**
- FLUX.2 [klein] 4B and klein base 4B (Apache-2.0)
- Z-Image-Turbo (Apache-2.0) and alibaba-pai Z-Image-Turbo-Fun-Controlnet-Union (original, 2.0, 2.1: Apache-2.0)
- Qwen-Image, Qwen-Image-Edit-2509, Qwen-Image-Edit-2511 (Apache-2.0); InstantX Qwen-Image-ControlNet-Union (tag apache-2.0); DiffSynth Qwen-Image-Blockwise-ControlNet-Depth (tag apache-2.0); lightx2v Qwen-Image-Lightning and Qwen-Image-Edit-2511-Lightning (tag apache-2.0)
- SDXL base 1.0 (CreativeML Open RAIL++-M, use restrictions in Attachment A); xinsir controlnet-union-sdxl-1.0 incl. ProMax (tag apache-2.0); diffusers controlnet-depth-sdxl-1.0 (tag openrail++)
- IC-Light v1 (code Apache-2.0, weights tag creativeml-openrail-m)
- FLUX.1 [schnell], Chroma1-HD (Apache-2.0) — base models only, no usable ControlNet
- HiDream-I1 / E1-1 (MIT + Llama 3.1 Community License for the text encoder)
- Lumina-Image 2.0, CogView4-6B (Apache-2.0)
- Wan2.1-VACE / Wan2.2 family (Apache-2.0; already in §7)
- Segmentation: MediaPipe multiclass selfie segmenter (Apache-2.0), BiRefNet (MIT), SAM 2.1 (Apache-2.0)
- On-device ports that inherit Apache-2.0: litert-community/FLUX.2-klein-4B-LiteRT, cgb/flux2-klein-4b-onnx-webgpu, lwanming/Z-Image-Turbo-opt; PrismML Bonsai Image 4B ("will be released ... under the Apache 2.0 license": **not yet verified as released**)

**CONDITION (allowed only under a threshold or registration; avoid as default):**
- SD 3.5 (Large, Large Turbo, Medium) and SD3.5 ControlNets, SD-Turbo: Stability AI Community License, under USD 1M revenue, must register.
- Kolors: registration questionnaire; licence governed by PRC law.
- LTX-Video 0.9.x / 13B: paid licence for revenue ≥ $10M.
- Sana / Sana Sprint: Apache-2.0 file but "research purposes only" on the card; resolve before use.

**BANNED (add or keep in `bannedModels.ts`):**
- FLUX.2 [klein] **9B** — FLUX Non-Commercial License. Suggested token: `flux.2-klein-9b` (must not match the 4B; pin 4B by exact id).
- IC-Light v2 — "non-commercial only" (and weights not released). Suggested token: `ic-light-v2` / `iclight-v2` (review the matcher against `iclight_sd15_*`).
- SDXL-Turbo — Hugging Face tag `sai-nc-community`. Suggested token: `sdxl-turbo`.
- RMBG-2.0 — CC BY-NC 4.0. Suggested token: `rmbg-2.0`. (RMBG-1.4 is also non-commercial per the IC-Light README.)
- Every FLUX.1 ControlNet checked (Shakker-Labs FLUX.1-dev-ControlNet-Union-Pro-2.0: `flux-1-dev-non-commercial-license`; BFL FLUX.1-Depth-dev: FLUX.1 [dev] Non-Commercial License; InstantX/Jasper/XLabs FLUX.1-dev ControlNets per search, not individually re-read). Most are already caught by `flux.1-dev`; `flux.1-depth-dev` and `flux.1-canny-dev` are **not** caught by the current substring and should be added.
- Existing: Hunyuan, FLUX.1/2 [dev], Kontext-dev, CatVTON, IDM-VTON, OOTDiffusion, FitDiT, SMPL family.

---

## Per-model notes

### FLUX.2 [klein] 4B / klein base 4B (Black Forest Labs)
- URLs: https://huggingface.co/black-forest-labs/FLUX.2-klein-4B, https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B (read 2026-11-19)
- Licence: Apache-2.0. Card: "Open weights available for commercial use under the Apache 2.0 license". Base card: outputs may be used commercially "as described in the Apache 2.0 license"; trademark note: modified versions "must not cause confusion or imply sponsorship or endorsement."
- **9B is different**: same card says 9B is released "under a non-commercial license" (FLUX Non-Commercial License). Banned.
- Capabilities: text-to-image, image editing, multi-reference editing. That is the structure route: feed the render (and optionally the flat garment photo) as references and ask for "photo of a woman wearing this garment, same pose, same framing". No official ControlNet; a community depth LoRA exists (`thedeoxen/refcontrol-FLUX.2-klein-4B-reference-depth-lora`, licence **not verified**).
- Speed: distilled, 4 steps, "sub-second" end-to-end (GPU not named); ~13 GB VRAM, RTX 3090/4070 and above. Base: 50 steps.
- Cost (estimate): 1–2 s on an L40S incl. reference tokens → Modal `eu` L40S $1.95/h × 1.15 = $2.24/h = $0.00062/s → **≈ $0.001 per image** plus cold start.
- On-device: see the on-device section; this is the model with the most phone ports.

### Z-Image-Turbo (Alibaba Tongyi-MAI) + Z-Image-Turbo-Fun-Controlnet-Union (alibaba-pai)
- URLs: https://huggingface.co/Tongyi-MAI/Z-Image-Turbo, https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1 (read 2026-11-19)
- Licence: metadata "apache-2.0" on both (no separate commercial text; Apache-2.0 grants it). Search results also showed Apache-2.0 on the original Union and 2.0 cards (not re-read).
- Control (2.1 card): Canny, Depth, Pose, MLSD, HED; Scribble (2601+); Gray (2602); inpainting "also supported"; separate Tile model. `control_context_scale` 0.65–1.00. Lite variant (5 layers, ~1.9 GB). No normal-map mode — use Depth + HED/Canny from our normal pass.
- Speed: 8 NFEs, "sub-second inference latency" on H800 (card, no figure); "fits comfortably within 16G VRAM consumer devices". Community: ≈2.3 s at 1024², 8 steps on RTX 4090 (repeated in several blogs; no primary benchmark — treat as unverified).
- Cost (estimate): ~3 s on L40S with ControlNet → **≈ $0.002 per image**.
- Z-Image-Edit: **not released** as far as could be verified today.
- On-device: https://huggingface.co/lwanming/Z-Image-Turbo-opt — ONNX for ONNX Runtime Web (WebNN/WebGPU), text encoder + transformer Q4F16, Apache-2.0; no timings or hardware given. 6B params: not phone-class.

### Qwen-Image / Qwen-Image-Edit-2509 / 2511 (+ ControlNets, Lightning)
- URLs: https://huggingface.co/Qwen/Qwen-Image, https://huggingface.co/Qwen/Qwen-Image-Edit-2509, https://huggingface.co/Qwen/Qwen-Image-Edit-2511 (read 2026-11-19)
- Licence: "Qwen-Image is licensed under Apache 2.0." (all three cards).
- Control: Edit-2509: "Native Support for ControlNet: Including depth maps, edge maps, keypoint maps, and more." Edit-2511 card does not repeat this. Both take one or more input images — so render + depth can go in together.
- ControlNets for Qwen-Image (T2I): InstantX/Qwen-Image-ControlNet-Union (tag apache-2.0; canny, soft edge, depth, pose; scale 0.8–1.0) https://huggingface.co/InstantX/Qwen-Image-ControlNet-Union; DiffSynth-Studio/Qwen-Image-Blockwise-ControlNet-Depth (tag apache-2.0) https://huggingface.co/DiffSynth-Studio/Qwen-Image-Blockwise-ControlNet-Depth.
- Speed: 20B, BF16, example 40 steps, true CFG 4.0 — no timing published. Lightning: https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning (tag apache-2.0) "reduce the original inference steps to just 4 steps", "≈10x faster than standard 40-step inference"; https://huggingface.co/lightx2v/Qwen-Image-Lightning 8 steps on Qwen-Image.
- Cost (estimate): 4-step Edit on H100 ~5 s → Modal `eu` H100 $3.95 × 1.15 = $4.54/h = $0.00126/s → **≈ $0.006**; 40-step ~30–50 s → $0.04–0.06.
- On-device: no.

### SDXL base 1.0 + xinsir ControlNet Union (ProMax) + diffusers depth
- URLs: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md, https://huggingface.co/xinsir/controlnet-union-sdxl-1.0, https://huggingface.co/diffusers/controlnet-depth-sdxl-1.0 (read 2026-11-19)
- SDXL licence: CreativeML Open RAIL++-M. Grant: "a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare, publicly display, publicly perform, sublicense, and distribute the Complementary Material, the Model, and Derivatives of the Model." SaaS: "You may host for Third Party remote access purposes (e.g. software-as-a-service)". Output: "Licensor claims no rights in the Output You generate using the Model." Attachment A forbids e.g. "To generate or disseminate personal identifiable information that can be used to harm an individual" and discrimination — our product must pass these on to users (RAIL requires the use restrictions be passed on in downstream terms). Card text "intended for research purposes only" is a usage note, not a licence term.
- xinsir union: tag apache-2.0 (licence text not shown). Controls: Openpose, Depth, Canny, Lineart, AnimeLineart, Mlsd, Scribble, Hed, Pidi, Teed, Segment, **Normal**; ProMax adds Tile Deblur/Variation/Super-Resolution, Inpainting, Outpainting. This is the **only union ControlNet found with a normal-map mode and a segmentation mode**, which matches our depth+normal+seg passes exactly.
- diffusers depth SDXL: tag openrail++.
- Speed: not published. Estimate ~6–10 s at 1024², 30 steps on an L4 → Modal `eu` L4 $0.80 × 1.15 = $0.92/h → **≈ $0.002–0.003 per image**.
- Quality: older than FLUX.2/Qwen/Z-Image for skin and hands, but the most mature control stack (multi-ControlNet, IP-Adapter, inpainting).

### IC-Light v1 / v2 (lllyasviel)
- URLs: https://github.com/lllyasviel/IC-Light, https://huggingface.co/lllyasviel/ic-light, https://github.com/lllyasviel/IC-Light/discussions/98 (read 2026-11-19)
- v1: repo "Apache-2.0 license"; weights tag `creativeml-openrail-m` (licence text not shown). Models `iclight_sd15_fc` (text + foreground) and `iclight_sd15_fbc` (text + foreground + background, "does not require careful prompting"). SD1.5-based (from file names). README notes the RMBG 1.4 remover "is for non-commercial use" and suggests BiRefNet for commercial projects. **ALLOWED** — useful as a final harmonise/relight pass after the person is generated.
- v2 (Flux-based, Oct 27 2024): maintainer: "You can only use the hf space to test for now" and "unlike V1, the license will be non-commercial only." Weights not released; Space reported broken (Aug 2025). **BANNED.**

### Stable Diffusion 3.5 (Large, Large Turbo, ControlNets) and SD-Turbo
- URLs: https://huggingface.co/stabilityai/stable-diffusion-3.5-large, https://huggingface.co/stabilityai/stable-diffusion-3.5-large-turbo, https://huggingface.co/stabilityai/stable-diffusion-3.5-large-controlnet-depth, https://stability.ai/community-license-agreement, https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md (read 2026-11-19)
- Licence: Stability AI Community License. Card: "Free for research, non-commercial, and commercial use for organizations or individuals with less than $1M in total annual revenue." / "For individuals and organizations with annual revenue above $1M: please contact us to get an Enterprise License." Agreement §III: grant "for any Commercial Purpose"; if you "generate more than USD $1,000,000 in annual revenue", "any licenses granted to You under this Agreement shall terminate as of such date"; "You must register with Stability AI." Outputs: "You own any outputs generated from the Models or Derivative Works to the extent permitted by applicable law." Outputs may not be used "to create or improve any foundational generative AI model".
- ControlNets: Depth (this repo), Canny (`canny_8b.safetensors`), Blur mentioned. Strength 0.7, Euler 50–60 steps best.
- SD-Turbo: LICENSE.md is the Community License (July 5 2024), §2 non-commercial and §3 commercial with the $1M limit.
- **CONDITION**: fine for a pilot, a liability once revenue passes $1M. Not recommended as the default path.

### SDXL-Turbo
- https://huggingface.co/stabilityai/sdxl-turbo (read 2026-11-19): licence tag "sai-nc-community"; card points to stability.ai/license for commercial use. LICENSE file **not read**. Treat as **BANNED** (NC tag) unless the file says otherwise.

### HiDream-I1 / HiDream-E1-1
- URLs: https://huggingface.co/HiDream-ai/HiDream-I1-Full, https://huggingface.co/HiDream-ai/HiDream-E1-1 (read 2026-11-19)
- "The Transformer models in this repository are licensed under the MIT License." Outputs usable commercially. VAE from FLUX.1 [schnell] (Apache-2.0). Text encoder Meta-Llama-3.1-8B-Instruct "licensed under the Llama 3.1 Community License Agreement" (700M-MAU clause, attribution; not re-read today).
- 17B, no ControlNet found. E1-1 is an editor (prompt-driven). Heavy; no reason to prefer it over Qwen-Image-Edit.

### FLUX.1 [schnell] and its ControlNets
- https://huggingface.co/black-forest-labs/FLUX.1-schnell (read 2026-11-19): "Released under the apache-2.0 licence, the model can be used for personal, scientific, and commercial purposes." 1–4 steps.
- ControlNets: Shakker-Labs FLUX.1-dev-ControlNet-Union-Pro-2.0 — "flux-1-dev-non-commercial-license", base FLUX.1-dev. BFL FLUX.1-Depth-dev — "FLUX.1 [dev] Non-Commercial License". Search found no Apache-2.0 ControlNet trained for schnell; the InstantX, Jasper and XLabs FLUX.1 ControlNets are all dev-based (from search results, not each re-read). Using a dev-licensed ControlNet with schnell does not launder the licence. **Schnell is allowed but has no structure control for us.**
- Chroma1-HD (https://huggingface.co/lodestones/Chroma1-HD): "fully Apache 2.0 licensed", schnell-based, 8.9B; no ControlNet.

### Sana / Sana Sprint (NVIDIA)
- URLs: https://github.com/NVlabs/Sana/blob/main/LICENSE, https://huggingface.co/Efficient-Large-Model/Sana_Sprint_1.6B_1024px, https://huggingface.co/Efficient-Large-Model/Sana_1600M_1024px_BF16_diffusers (read 2026-11-19)
- GitHub LICENSE: Apache License 2.0, "Copyright 2024 Nvidia". HF cards: "This model is released under the Apache License 2.0" **and** "The model is intended for research purposes only." Text encoder Gemma-2-2B-IT under Gemma Terms of Use. The HF repo's own LICENSE file was **not read**. Status **CHECK**: not the NVIDIA Source Code License-NC, but resolve the conflict in writing before use.
- Speed (Sprint card, 1024²): 0.1 s at 1 step on H100; ControlNet 0.25 s; 0.31 s on RTX 4090. The fastest controllable model found; 1.6B params makes it a future on-device candidate.

### Lumina-Image 2.0, CogView4-6B
- https://huggingface.co/Alpha-VLLM/Lumina-Image-2.0: tag apache-2.0; 2B (card says 3B in metadata); 50 steps; no ControlNet.
- https://huggingface.co/zai-org/CogView4-6B: "This model is released under the Apache 2.0 License"; 13–35 GB VRAM depending on offload; no ControlNet.
- Allowed, but no structure control; not useful for us.

### Kolors (Kuaishou)
- https://huggingface.co/Kwai-Kolors/Kolors, https://huggingface.co/Kwai-Kolors/Kolors/blob/main/MODEL_LICENSE (read 2026-11-19)
- Card: "Kolors are fully open-sourced for academic research." / "For commercial use, please fill out this questionnaire and sent it to kwai-kolors@kuaishou.com for registration." Licence: products over "100 million monthly active users" or cloud vendors need a separate licence; governed "by the laws of China"; no using outputs "to improve any other large model". **CONDITION** (registration). Not recommended.

### LTX-Video (Lightricks)
- https://huggingface.co/Lightricks/LTX-Video/blob/main/LTX-Video-Open-Weights-License-0.X.txt (read 2026-11-19): "entities with annual revenues of at least $10,000,000" "are eligible to obtain a paid commercial use license"; unlicensed commercial use above that "is strictly prohibited"; Attachment A requires AI content be disclaimed as machine-generated. ICLoRA Depth / Pose / Canny for 13B 0.9.7. **CONDITION**, same as LTX-2 in §7.

### Wan2.1-VACE-14B / Wan2.2-TI2V-5B
- https://huggingface.co/Wan-AI/Wan2.1-VACE-14B: "The models in this repository are licensed under the Apache 2.0 License." Depth, pose, mask conditions; reference-to-video. Wan2.1 T2V can do T2I with `--frame_num 1`.
- https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B: Apache-2.0; "We claim no rights over the your generated contents"; 24 GB for 720p; 5 s 720p "in under 9 minutes" on one consumer GPU. Already in §7; listed for the short-video variant of the render-to-photo idea (depth-controlled turntable).

---

## On-device

| Route | Source (read 2026-11-19) | Result |
| --- | --- | --- |
| FLUX.2 klein 4B, browser, ONNX Runtime WebGPU | https://huggingface.co/cgb/flux2-klein-4b-onnx-webgpu | Apache-2.0; ~6.5 GB first download (q4 text encoder 2.20 GB, q8 transformer 4.14 GB); **512², 4 steps ≈ 22 s "on a recent discrete GPU"**; text-to-image only |
| FLUX.2 klein 4B, browser (other port) | search result only | 1024², 4 steps, warm, 26.41 s on Apple WebGPU (author's report; **not verified**) |
| FLUX.2 klein 4B, Android LiteRT | https://huggingface.co/litert-community/FLUX.2-klein-4B-LiteRT | Apache-2.0; **Pixel 8a: 306 s for 256², 4 steps; edit 328–369 s**; 256² only; peak ~912 MB by streaming graphs; one reference image supported |
| Bonsai Image 4B (1-bit / ternary FLUX.2 klein 4B), iPhone | https://prismml.com/news/bonsai-image-4b | Apache-2.0 promised ("will be released"); **iPhone 17 Pro Max: 512² in 9.4 s**; M4 Pro ~6 s; 1.5–2.4 GB active memory; full klein 4B "does not fit" on that iPhone; no editing mentioned; vendor numbers, no quality benchmark |
| BFL on-device announcement (June 4, 2026) | https://bfl.ai/blog/flux2-klein-on-device | ASUS ProArt RTX laptops only; target "sub-5-second ... on an 8GB VRAM laptop"; no phone |
| Z-Image-Turbo ONNX WebNN/WebGPU | https://huggingface.co/lwanming/Z-Image-Turbo-opt | Apache-2.0, Q4F16; no timings |
| SD-Turbo in browser (ORT Web WebGPU) | Microsoft blog 2024-02-29 (via search) | "within one second" on RTX 4090; 512² SD2.1-class quality; Community License (CONDITION) |
| Apple ml-stable-diffusion (Core ML) | https://github.com/apple/ml-stable-diffusion | MIT code; SD2.1 512²: 7.9 s iPhone 14 Pro Max; **SDXL 768²: 31 s iPhone 15 Pro Max**; "ControlNet is not yet supported for Stable Diffusion XL"; >2 GB peak memory |
| Qualcomm AI Hub ControlNet-Canny | https://aihub.qualcomm.com/models/controlnet_canny | Apache-2.0 + Qualcomm Generative AI terms; SD-class, 1.4 GB; page shows "not supported" on listed chipsets, no latency |
| MediaPipe Image Generator (SD1.5 + face/edge/depth plugins) | guide URL now redirects to the general MediaPipe overview | **not verified** today; the dedicated guide page no longer renders; launched Oct 2023 as experimental Android-only |
| SnapGen / SnapGen++ (Snap) | https://snap-research.github.io/snapgen/ | 1024² in 1.4 s on iPhone 16 Pro Max (paper); **no weights, no code, no licence** — not usable |

**Verdict:** Not feasible in a phone browser today. The best measured phone number is a vendor-compressed 1-bit FLUX.2 klein 4B at 512² in 9.4 s on an iPhone 17 Pro Max as a **native** app; Android via LiteRT is 5 minutes at 256²; browser WebGPU is ~22 s at 512² on a *discrete desktop* GPU with a 6.5 GB download. None of the on-device ports offer depth/normal ControlNet, and none reach 1 MP photoreal quality. Keep the hero render on the server; revisit in 2027 with Bonsai Image (once weights ship), a native-app path, and Sana Sprint 1.6B if its licence clears.

What does run on-device today: **segmentation of the AI output** — MediaPipe multiclass selfie segmenter (Apache-2.0 per its model card dated May 10 2023; classes background, hair, body skin, face skin, clothes, others; Web via `@mediapipe/tasks-vision`). Use it to check that the generated "clothes" mask matches our render's garment mask (silhouette/hem drift test) without shipping the image anywhere.

---

## GPU prices used (read 2026-11-19)

- Modal https://modal.com/pricing: L4 $0.000222/s (~$0.80/h), A10 $0.000306/s, L40S $0.000542/s (~$1.95/h), A100 80 GB $0.000694/s (~$2.50/h), H100 $0.001097/s (~$3.95/h), H200 $0.001261/s, B200 $0.001736/s. Region multiplier https://modal.com/docs/guide/region-selection: `eu` 1.15×, `eu-west/-north/-south` 1.75×. Effective `eu`: L4 $0.92/h, L40S $2.24/h, H100 $4.54/h.
- RunPod Serverless https://www.runpod.io/pricing: 24 GB (L4/A5000/3090) $0.75/h; RTX 4090 $1.34/h; 48 GB L40/L40S $1.89/h; A6000/A40 $1.22/h; A100 80 GB $2.99/h; H100 $5.89/h. **Note: higher than §5 (L40S $1.75, A100 $2.72, H100 $5.39) — §5 should be updated.** EU data-centre list still not verified.
- Scaleway https://www.scaleway.com/en/pricing/gpu/: HTTP 403 today — **not verified**.
- OVH, AU hosts: not read.

Per-image costs in the table are `GPU seconds (estimate) × Modal eu rate`, excluding cold start (≈ 1 s boot + model load; a 20B model load can be 30–60 s, which dominates unless a warm pool is kept).

---

## How the allowed models map to our passes (design note, not tested)

1. Keep the garment pixels: inpaint everything **outside** the garment mask (person, skin, hair, background) with depth + normal (+ segment) control, so silhouette, hem and colour cannot drift. SDXL + xinsir ProMax (inpaint + normal + segment) or Z-Image-Turbo Union 2.1 (inpaint + depth + HED) do this directly.
2. Or edit the whole render: FLUX.2 klein 4B / Qwen-Image-Edit-2509 with the render (and depth map, for 2509) as input images; then re-composite the original garment pixels where the drift test fails.
3. Harmonise: IC-Light v1 `fbc` relight with the cream background, low denoise.
4. Verify: MediaPipe multiclass "clothes" mask vs our render mask (IoU, hem row, waist row, mean Lab colour); reject and retry on drift. Label every output an estimate (hard rule 3).
