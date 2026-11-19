# AI realism layer: from the 3D estimate to an AI-realistic image (D22)

Research and design for decision D22 point 2: an AI layer turns the 3D render into a realistic image while it keeps the garment's cut, the difference between sizes and the colour of the 3D estimate. Researched on **2026-11-19**. Every licence, price, region and retention statement below was read at the source on that date, unless it is marked **not verified**. Not legal advice. Branch `claude/ai-realism`; the plumbing is in this branch behind the server flag `AI_REALISM`, which is **off**.

## Bottom line

- **Primary: fal.ai `fal-ai/z-image/turbo/controlnet`.** Z-Image-Turbo with the Z-Image-Turbo-Fun-ControlNet-Union. Both sets of weights are Apache-2.0.
  - It takes our depth pass as the control image as it is (`preprocess: none`).
  - It costs $0.0065 per megapixel.
  - fal does not train on client content.
  - Payload storage is off per request (`X-Fal-Store-IO: 0`).
  - Weaknesses: no EU or AU region is documented, and zero data retention needs a sales contract.
  - The adapter is in this branch. It has been tested only against a fake transport.
- **Fallback: the same two Apache-2.0 models, self-hosted on Modal in the `eu` region.**
  - The same weights give the same behaviour, so the same checks and thresholds apply.
  - It runs in the EU, keeps nothing and pins the exact checkpoints.
  - It costs more at pilot traffic because of cold starts.
  - It is the path for any shop that needs EU processing.
  - Not built: it is the next adapter.
- **Hosted alternative with no operations work:** Vertex `gemini-3.1-flash-image` in the EU multi-region, at $0.067 per image.
  - Structure is steered only by the prompt and reference images, so expect more refusals from the checks.
- **On the device: not feasible today** for photoreal output with structure control (see §1.4).
  - What does run on the device is segmentation, which can carry the checks to printed garments later.
- **Proof the layer does not lie:** every AI image is compared with the 3D estimate it came from, and refused when any check fails.
  - The checks are: silhouette IoU, garment IoU, garment colour CIEDE2000, hem shift, waist-line shift, waist and hip widths, and the shown size against its neighbour.
  - An image that passes is labelled **"AI-enhanced estimate"** with the estimate disclaimer. A refusal is labelled too.
- **Pilot cost estimate:** about USD 1 per shop per month at the assumed usage, capped at about USD 2.60 with the cap recommended in §4. That is 11 % to 29 % of the USD 8.99 plan.

## 1. Which models and services can do it

The job is "3D render to photoreal person wearing that garment". The input is a mannequin in a draped garment on the flat cream backdrop `#F5EFE7`, with depth, normal and segmentation passes available. The output must keep the silhouette, the hem and waist positions and the colour. The input never contains a photo of a body (AGENTS.md hard rule 1).

### 1.1 What changed in 2026: first-party structure control is mostly gone

Read today:

- Vertex `imagen-3.0-capability-001` is listed as **discontinued**, replaced by `gemini-2.5-flash-image`. It offered canny and scribble controlled customisation (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/edit-controlled).
- Amazon **Nova Canvas** reached **end of life on 2026-09-30**. It offered canny and segmentation conditioning in eu-west-1 (Bedrock model card).
- BFL FLUX.1 Depth and Canny [pro] "are deprecated and will no longer be supported in the BFL API". FLUX.2 has no control inputs: "Expecting pixel-perfect structural matching: FLUX.2 interprets structure semantically." (https://docs.bfl.ai/guides/usecases_editing_controlnets).
- Most depth endpoints on fal and Replicate run FLUX.1 [dev] LoRAs or ControlNets. Those weights are non-commercial and **banned** (`flux.1-dev`, plus `flux.1-depth-dev` and `flux.1-canny-dev`, added to `bannedModels.ts` in this branch).

So the strongest structure lock is an **open-weight ControlNet**, run by a host or by us.

### 1.2 Hosted services

| Service / endpoint | Structure control for our passes | Price, about 1 MP | EU / AU | Retention | Commercial terms (quote) | Trains on inputs |
|---|---|---|---|---|---|---|
| **fal `fal-ai/z-image/turbo/controlnet`** | `image_url` control image, `preprocess` none/canny/depth/pose, `control_scale` 0–1, `control_start`/`control_end` | "$0.0065 per megapixels" (https://fal.ai/models/fal-ai/z-image/turbo/controlnet/llms.txt) | Not stated. DPA transfers "follow[ing] the SCCs" (https://fal.ai/legal/data-processing-addendum), so probably not EU | "stored in the platform for 90 days by default"; `X-Fal-Store-IO: 0` turns that off; ZDR "contact the fal sales team" (https://fal.ai/docs/model-apis/data-retention) | Page: "License \| Commercial use permitted". Weights: Tongyi-MAI/Z-Image-Turbo "License: apache-2.0", alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union "License: apache-2.0". fal grants no output rights (https://fal.ai/legal/api-services), so the rights come from Apache-2.0 | "Company will not use Client Content to create, train, develop…" (https://fal.ai/terms, updated 8 Sep 2026) |
| **Stability AI Control Structure** `/v2beta/stable-image/control/structure` | One RGB image plus `control_strength` 0–1. "The resolution of the generated image will match that of the input image." | $0.05 (5 credits; https://docs.stability.ai/pricing); $0.07 on Bedrock | Direct API region not verified. Bedrock is **US only** | Direct API not stated. Bedrock offers `data_retention_mode: none` | "we assign to you all of our right, title, and interest (if any) in the Outputs" (https://stability.ai/terms-of-service, effective 30 Sep 2026) | Direct API: yes, unless the account opts out; Bedrock: no |
| **Vertex `gemini-3.1-flash-image`** | Prompt plus reference images; no control weight | "1120 tokens ($0.067) for 1K" (https://cloud.google.com/vertex-ai/generative-ai/pricing) | **EU multi-region**; no AU | Cache deleted within 24 h, can be disabled (`disableCache`); abuse logging | "Google does not assert any ownership rights in any new intellectual property created in the Generated Output" (https://cloud.google.com/terms/service-terms) | "will not use Customer Data to train … without Customer's prior permission" |
| **BFL FLUX.2 [pro]**, `api.eu.bfl.ai` | References only; semantic structure | $0.03 first MP plus $0.015 per reference MP (https://bfl.ai/pricing) | **EU** ("Multi-cluster routing limited to EU regions") | Results expire after 10 min; inputs not stated | "you own all right, title, and interest in and to Output" (EU Developer ToS, 26 Aug 2026) | **Yes**: "the Company may use Inputs and Outputs to train and improve its artificial intelligence models" (FLUX API Service Terms §2(b)); no opt-out found. **Rejected** for that |
| **FASHN `model-swap`** | Garment-preserving identity swap, keeps the pose; no depth input; whether it accepts a mannequin render is **not verified** | $0.075–0.225 at 1k (1–3 credits at "$0.075 /credit") | Not stated | CDN outputs deleted after three days; request records kept until you ask (email) | "you own the outputs … You may use them for personal or commercial purposes" | No, unless you opt in |
| Bria, Photoroom, OpenAI gpt-image, Adobe Firefly, Krea, Leonardo, Runway | Bria's ControlNet is gone from today's docs; Photoroom takes flat-lays only and runs in the US; OpenAI has mask plus prompt only, and EU image processing "requires additional approval"; Firefly structure reference is enterprise only (**not verified**) | — | — | — | — | — |

Full notes, with every quote and URL: `docs/research/ai-realism-sources/hosted-services.md` and `docs/research/ai-realism-sources/open-weights.md` (one section per service or model).

### 1.3 Open weights (self-hosted or through a host)

| Model | Licence as read | For us | Structure control | Cost per 1 MP image on Modal `eu` (estimate) |
|---|---|---|---|---|
| **Z-Image-Turbo + Z-Image-Turbo-Fun-Controlnet-Union 2.1** | Apache-2.0 / Apache-2.0 (https://huggingface.co/Tongyi-MAI/Z-Image-Turbo, https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1) | **Allowed** | Canny, Depth, Pose, MLSD, HED, Scribble, Gray, inpaint; no normal mode | about $0.002 warm (L40S, about 3 s) |
| **SDXL base 1.0 + xinsir controlnet-union-sdxl-1.0 ProMax** | CreativeML Open RAIL++-M: "You may host for Third Party remote access purposes (e.g. software-as-a-service)"; xinsir tag apache-2.0 | **Allowed**, with the use restrictions of Attachment A passed on to users | 12 modes including **Normal, Depth, Segment**, plus inpaint | about $0.003 (L4) |
| **Qwen-Image-Edit-2509 / 2511** (+ Lightning LoRA) | "Qwen-Image is licensed under Apache 2.0." | **Allowed** | 2509: "Native Support for ControlNet: Including depth maps, edge maps, keypoint maps"; multi-image input | about $0.006 at 4 steps (H100); 20B, long cold start |
| **FLUX.2 [klein] 4B** | "Open weights available for commercial use under the Apache 2.0 license" | **Allowed** (pin the exact 4B id) | Reference edit only; no official ControlNet | about $0.001 |
| IC-Light v1 (relight) | code Apache-2.0, weights tag creativeml-openrail-m | Allowed | Foreground or background relight | about $0.001 |
| SD 3.5 + ControlNets, SD-Turbo | Stability Community License: commercial use only below "$1M in total annual revenue", "You must register" | Conditional, not the default | Depth, Canny | — |
| FLUX.1 [schnell] | Apache-2.0 | Allowed, but **no commercially licensed ControlNet exists**: every FLUX.1 ControlNet checked is under the dev non-commercial licence | — | — |
| FLUX.2 klein **9B**, IC-Light **v2**, SDXL-Turbo, RMBG-2.0, FLUX.1 Depth/Canny [dev] | FLUX Non-Commercial; "the license will be non-commercial only"; `sai-nc-community`; CC BY-NC 4.0; FLUX.1 [dev] NC | **Banned**: added to `packages/tryon-providers/src/bannedModels.ts` in this branch | — | — |

GPU prices read today:
- Modal (https://modal.com/pricing): L4 $0.000222/s, L40S $0.000542/s, H100 $0.001097/s.
- Modal `eu` region multiplier: 1.15× (https://modal.com/docs/guide/region-selection).
- RunPod serverless prices went up since `docs/research/garment-engine.md` §5 was written: L40S $1.89/h, H100 $5.89/h. §5 should be updated.
- Scaleway returned 403 (**not verified**). No AU GPU host was read.

### 1.4 On the device

**Not feasible in a phone browser today.**
- The best measured phone number is a native app, not a browser: a vendor-compressed 1-bit FLUX.2 klein 4B made 512² in 9.4 s on an iPhone 17 Pro Max (https://prismml.com/news/bonsai-image-4b). Its weights are promised under Apache-2.0 but not yet released.
- Android LiteRT: 306 s for 256² on a Pixel 8a (https://huggingface.co/litert-community/FLUX.2-klein-4B-LiteRT).
- Browser WebGPU: about 22 s for 512² on a *discrete desktop* GPU, after a 6.5 GB download (https://huggingface.co/cgb/flux2-klein-4b-onnx-webgpu).
- Core ML SDXL: 31 s at 768² on an iPhone 15 Pro Max, and "ControlNet is not yet supported for Stable Diffusion XL" (https://github.com/apple/ml-stable-diffusion).

None of these ports has depth or normal control. Revisit in 2027.

What does run on the device today is the **MediaPipe multiclass selfie segmenter**. It is Apache-2.0 per its model card, has a `clothes` class and runs on the web. It is the way to extend the checks of §2 to printed garments.

### 1.5 Scores

Each criterion is scored 1–5. The weights are: structure control 30 %, licence clarity 20 %, price at pilot scale 15 %, region and retention 20 %, latency and operations for a solo founder 15 %.

| Candidate | Structure | Licence | Price | Region / retention | Ops | **Weighted** |
|---|---|---|---|---|---|---|
| fal Z-Image-Turbo ControlNet | 5 | 4 (the fal page does not name the ControlNet checkpoint) | 5 | 2 | 5 | **4.20** |
| Z-Image-Turbo + ControlNet, self-hosted on Modal `eu` | 5 | 5 | 2 (cold starts at pilot traffic) | 5 | 2 | **4.10** |
| SDXL + xinsir union (normal + depth + seg), Modal `eu` | 5 | 4 (RAIL use restrictions) | 3 | 5 | 2 | 4.05 |
| Vertex gemini-3.1-flash-image (EU) | 2 | 5 | 3 | 5 | 5 | 3.80 |
| Qwen-Image-Edit-2509, self-hosted | 4 | 5 | 2 | 5 | 1 | 3.65 |
| Stability Control Structure | 4 | 4 | 3 | 2 | 5 | 3.60 |
| BFL FLUX.2 pro (EU) | 2 | 2 (trains on inputs) | 4 | 5 | 5 | 3.35 |
| FASHN model-swap | 2 | 5 | 2 | 2 | 5 | 3.05 |
| On device (any) | 1 | 4 | 5 | 5 | 1 | not feasible |

The top two are close, and they are the same model. That is the reason for the choice. The hosted endpoint wins the pilot on price and operations. The self-hosted copy wins on residency, and the fidelity thresholds carry over between them unchanged. The decision to switch is about data and region, not about quality.

**Latency.** No source publishes one for the fal endpoint. The model card says 8 steps and "sub-second inference latency" on an H800. Estimate: 2–5 s end to end, including upload of about 1 MB of passes. The route is synchronous and has a 60 s provider timeout.

## 2. How we prove the layer does not lie

Code: `packages/tryon-providers/src/realism/fidelity.ts`. It is pure, with no dependencies, and every number goes back in the route's answer.

### 2.1 What is compared

The 3D view exports its passes (`packages/garment-viewer/src/passes.ts`, `renderPasses` in `scene.ts`):
- lit colour;
- linear depth;
- view-space normals;
- garment mask and figure mask;
- the neighbouring size's garment mask;
- the projected waist and hip ring rows.

All are drawn from the front camera on the flat backdrop. Then:

1. **Segment the AI image deterministically.**
   - Figure: pixels more than 8 (CIE76) from the backdrop colour.
   - Garment: figure pixels of the garment's colour, judged against the AI image's *own* median garment colour, sampled inside the 3D garment mask shrunk by 3 px (`isGarmentColour`).
     - A chromatic garment (chroma ≥ 15) is keyed by **hue**: within ±20° and at least 35 % of the reference chroma. On the real 3D render of the pilot skirt, the lit edges kept the hue (24° against 29°) at half the chroma. A plain colour key (the first version) cut them off and refused a faithful image (garment IoU 0.848, widths off by 5–6 cm).
     - An achromatic garment (black, grey, white) uses Lab distance with lightness weighted 0.4 (`keyDistance`), within 14.
   - Using the AI image's own colour means a recoloured garment is still found, and then fails on colour, not on outline.
2. **Measure both images the same way** (`featuresOf`):
   - the hem row (lowest row with at least 3 garment px);
   - the waist line (a bottom's top edge, otherwise the middle of the narrowest band near the waist ring);
   - the garment's front width at the waist and hip ring rows.
   - Pixels become cm through the figure height over the drawn stature.
3. **Size to size.** For each feature where the 3D gap between the shown size and its neighbour is at least 0.5 cm, the AI value must stay within half of that gap from the shown size. In other words, it must look more like the shown size than like the neighbour.

### 2.2 Thresholds (any one refuses the image)

| Check | Refuse when | Why this number |
|---|---|---|
| Silhouette IoU (AI figure vs 3D figure) | < 0.90 | A repainted backdrop drops it to 0.17. The neighbour size drawn instead gives 0.85 |
| Garment IoU | < 0.85 | The neighbour size drawn instead gives 0.78. A garment widened 2 cm a side still gives 0.88, which is why IoU alone is not enough and the cm checks exist |
| Garment colour, CIEDE2000 of the medians | > 5.0 | 2.3 is about one just-noticeable difference. Measured: relighting the figure by −7 % gives 2.5, −10 % gives 3.6, −15 % gives 5.3 (refused), −30 % gives 10.6. A hue swap gives 71 |
| Hem shift | > 1.5 cm | Half a typical length step between sizes (about 3 cm). A 4 cm move measures 4.1 |
| Waist-line shift | > 2.0 cm | The waist ring is a band; narrower would refuse straight torsos |
| Front width at waist or hip | > 1.5 cm | About half a grade step of front width. Widening 2 cm a side measures 3.7–3.8 |
| Size separation | AI farther than ½ of the shown→neighbour gap | The test fixture's gaps are 4.4 cm (hem) and 6.3 cm (width). Drawing the neighbour is caught on all three features |
| Unverifiable | Garment within 12 (`keyDistance`) of the backdrop or the body colour | Refused, never passed unchecked |

Measured on the synthetic fixture with the fake provider (`realism.test.ts`, 2026-11-19). Every lie triggers its own reason:

| Fake output | Reasons | Key metrics |
|---|---|---|
| faithful | — (passes) | IoU 1.00 / 1.00, ΔE00 0.14, hem 0 cm |
| hem moved 4 cm | hem, size_difference | hem 4.12 cm |
| colour swapped | colour | ΔE00 71.0, widths ≤ 0.19 cm |
| neighbour size drawn | silhouette, garment_outline, hem, width, size_difference | IoU 0.85 / 0.78 |
| widened 2 cm a side | width, size_difference | width +3.8 cm, IoU 0.92 / 0.88 |
| backdrop repainted | silhouette | IoU 0.17 |

The same lies on a **real WebGL export** of the 3D view: the pilot skirt, POM v2 rest fixture, size 10 with the size-12 neighbour, in `apps/web/e2e/aiRealism.spec.ts`. It is frozen as a regression test in `packages/tryon-providers/fixtures/realism-pom-v2-rest-10` and `realExport.test.ts`.

| Fake output on the real export | Reasons | Key metrics |
|---|---|---|
| faithful | — (passes) | IoU 0.993 / 0.996, ΔE00 0.2, widths ≤ 0.2 cm; size separation hem gap 0.5 cm, width gaps 0.7 cm, ok |
| hem moved 4 cm (size 8) | hem | hem 3.98 cm |
| colour swapped | colour | ΔE00 60.3 |
| widened 2 cm a side | width | width +3.0–3.2 cm |
| relit −10 % / −20 % | — / colour | ΔE00 4.1 / 8.1 |
| backdrop repainted | silhouette | IoU 0.33 |

The real export also found a framing bug: the screen's camera frame left about 8 px under the hem, so a moved hem ran off the picture and measured only 1 cm. The passes now use their own front frame (`passFrame`), with 16 % of the stature as room.

On this fixture the 3D gap between neighbouring sizes is small (hem 0.5 cm, widths about 0.7 cm, "In 3D the sizes look much alike"). The size-separation rule then asks the AI to stay within 0.35 cm, which may refuse real output often. Measure that first.

These thresholds are starting values chosen against synthetic lies and one real export. They must be re-measured on real provider output before the flag goes on; see §5.

### 2.3 What arrives must be our render, not a photo

`checkRenderPasses` (`passes.ts`) refuses the request (422 `not_a_render`) before any provider call unless all of these hold:
- both masks are binary;
- the garment lies inside the figure;
- at least 99.5 % of the background equals the backdrop within ±3 per channel;
- depth is present only on the figure;
- the figure's normals have unit length;
- the figure and garment areas are plausible.

A camera picture fails the flat-backdrop test straight away. The guard catches mistakes and casual misuse; it is **not** a proof. The proof is structural:
- The wire schema `RealismRequestSchema` is a strict object with no person, photo or face field, and unknown keys are refused.
- `passes.kind` is the literal `'renderPasses'`.
- No capture code reaches the panel: capture lives in `features/capture/` only.
- The colour pass is drawn with the **standard head and body colour**. The shopper's face texture (D19) and picked skin colour (D20 point 1, still waiting for the privacy policy, as for the hero render) are taken off for the export and put back after.

### 2.4 How the result is labelled

- Every answer, image or refusal, carries `label: 'ai-enhanced-estimate'` and the estimate disclaimer (hard rule 3).
- In the embed, the words live in the English catalogue (D21). The label **"AI-enhanced estimate"** sits in the panel header in every state and again on the picture.
- The caption says: "AI-enhanced estimate, made from the 3D estimate. It is not a photo of you and not a photo of the garment on a person." It is followed by the estimate disclaimer.
- A refusal says why in plain words ("The length moved. The colour changed.") and shows no picture.
- The 3D view and its own "Estimate · not measured" label stay as they are.

## 3. What was built (flag off)

| Part | Where |
|---|---|
| Pass export from the 3D view (colour from the screen drawing; depth, normals and masks from a non-multisampled render target; neighbour mask; projected waist and hip rows; view restored after) | `packages/garment-viewer/src/passes.ts`, `scene.ts` `renderPasses`, `mount.ts` `GarmentView.exportPasses` |
| Wire types | `packages/schema/src/api.ts`: `RealismRequestSchema` (strict), `RealismResponseSchema`, `AI_ENHANCED_LABEL`, `TryResolveResponse.aiRealism` |
| Passes guard, fidelity checks, CIEDE2000, PNG codec, pipeline, prompt, provider contract, fake provider, fal adapter, synthetic passes | `packages/tryon-providers/src/realism/` |
| Route `POST /v1/renders/realism` | `apps/api/src/routes/realism.ts`. With the flag off it is not registered (404). Device auth, consent, rate limit. Passes are decoded in memory and never written to disk. One privacy-ledger line. Over the cost cap gives 402 |
| Env | `AI_REALISM` (default off), `AI_REALISM_PROVIDER` (`fake`, `fal-z-image`), `FAL_API_KEY` (server only), `AI_REALISM_MAX_COST_USD`, `AI_REALISM_RATE_LIMIT_PER_MIN`. `fake` is refused in production, and `fal-z-image` without a key is refused |
| Embed panel next to the 3D view, only with `aiRealism: true` from `GET /v1/try` (flag on and a 3D asset) | `apps/web/src/embed/AiRealism.tsx`, `realism.ts`, `Garment3D.tsx`, strings in `strings/en.ts` |
| Tests | `tryon-providers` `realism.test.ts` (guard, every lie refused, relight tolerance, labels, banned models, cost cap), `falZImage.test.ts`; `apps/api` `realism.test.ts` (flag off gives 404 and no provider call; no photo field or photo-like pass accepted; hem and colour lies refused; label always present); `apps/web` `aiRealism.test.tsx`; `garment-viewer` `passes.test.ts`; `apps/web/e2e/aiRealism.spec.ts` (real WebGL export in Chromium, not part of `pnpm check`) |

## 4. Cost at the pilot's scale

Assumptions, all estimates:
- The plan includes 5,000 sessions per shop per month as fair use (`billing/plans.ts`).
- 10 % of sessions open the 3D view and 20 % of those ask for the AI picture: about 100 pictures per shop per month.
- Each shown picture costs 1.5 attempts on average, because refusals cost money too: 150 provider calls.
- fal bills $0.0065 per MP, and our 512×768 passes are 0.39 MP. Rounded up to 1 MP (the adapter's `estimateCostUsd`) that is **$0.0065 per call**.

| | Calls per shop per month | USD per shop per month | Share of USD 8.99 |
|---|---|---|---|
| Assumed use, fal | 150 | **0.98** | 11 % |
| Recommended hard cap, fal | 400 | **2.60** | 29 % |
| Assumed use, Modal `eu` self-hosted (cold start about 30 s on an L40S at $2.24/h, so about $0.02 per isolated call; estimate) | 150 | about 3.00 | 33 % |
| Assumed use, Vertex gemini-3.1-flash-image EU ($0.067) | 150 | 10.05 | 112 % |

So at pilot scale the hosted fal endpoint is the only option that leaves margin. Vertex would cost more than the plan.

Not built yet: a **per-shop monthly cap**. Today there is a per-request cost cap and a per-IP rate limit. The cap should be in place before the flag goes on.

## 5. Open points and risks

1. **Thresholds on real output.**
   - Run the fal endpoint on about 30 bundles, at three strengths and two control scales, and measure the false-refusal rate.
   - Target fewer than 20 % refusals of faithful images.
   - Tune only the thresholds that real lies do not need.
2. **Plain colour only.**
   - The colour key works for one-colour garments, which is how drape bakes are drawn. A print needs a segmentation model.
   - The MediaPipe multiclass segmenter (Apache-2.0) is the candidate, on the server or the device. Until then a print is refused as `unverifiable` or by the outline checks.
3. **Body shape is personal data.**
   - The render carries no face and no picked skin colour. Its silhouette, however, comes from the shopper's girths, as the hero render's avatar drawing already does under D3.
   - The privacy policy, the merchant DPA and the consent line need Naomi's review (D20 point 4) before the flag goes on. The same applies to fal's processing outside the EEA under SCCs.
4. **fal details not verified without a key.**
   - Which ControlNet checkpoint fal runs.
   - The `image_size` and `sync_mode` fields.
   - Real latency.
   - The adapter accepts a data URI or a URL in the answer.
5. **Composite option.** Pasting the 3D garment pixels back over the AI image guarantees colour and outline but looks less real. Keep it as the fallback if real output keeps failing the colour check.
6. **The pass guard is not a proof** (§2.3); the strict schema and the client code are.

## 6. Next step for the founder (a recommendation, not an action)

1. **Open a fal.ai account** (pay as you go, no subscription) and buy the smallest credit top-up.
   - Ask fal sales two things in writing: zero data retention on the account, and the processing region (EU or AU).
   - Put the key in the production environment as `FAL_API_KEY`. It is server only.
   - Do not set `AI_REALISM=1` yet.
2. **Estimated monthly cost for the pilot:** about **USD 1 per shop** at the assumed use (150 calls), at most **USD 2.60 per shop** with the 400-call cap. For five pilot shops, budget **about USD 5–13 per month**.
   - The bake-off below adds about USD 1–2 once: about 30 bundles × 6 settings × $0.0065.
3. **Before the flag goes on for real shoppers:**
   - The bake-off on real output (§5.1).
   - The per-shop monthly cap (§4).
   - The learned clothes segmenter, or a "plain colour only" gate, for printed garments (§5.2).
   - Naomi's review of the consent line and of the processing outside the EEA (§5.3).
4. **If a shop or counsel requires EU processing:** open a Modal workspace (already the GPU host of the garment engine) and run the same Z-Image-Turbo and ControlNet weights in the `eu` region. Budget about USD 3 per shop per month at pilot traffic, which is cold-start bound (§4).
