# Hosted structure-controlled "render to photo" services: research notes

Read at the source on **2026-11-19** (WebSearch + WebFetch, plus `curl` of two Google/AWS pricing pages whose tables do not survive WebFetch). No sign-ups, no paid calls. Anything not read today is marked **not verified**. Not legal advice. This file adds to `docs/research/tryon-engines.md` and does not repeat it.

**Use case:** the input is a grey or skin-toned mannequin wearing a draped garment, rendered on cream `#F5EFE7`, with depth, normal and garment-mask passes. The output must be a photoreal person. Cut, silhouette, hem and waist line, and exact colour must survive. The input never contains a photo of a real body.

---

## Summary table

| # | Service / endpoint | Structure control that takes our passes | Price at about 1 MP (official page) | EU / AU processing | Retention of inputs and outputs | Commercial use of outputs | Trains on inputs? |
|---|---|---|---|---|---|---|---|
| 1 | **fal `fal-ai/z-image/turbo/controlnet`** (Z-Image-Turbo, Apache-2.0, with Fun-ControlNet-Union, Apache-2.0) | **Yes.** `image_url` is the control image. `preprocess` takes none/canny/depth/pose, so our own depth pass can go in with `none`. `control_scale` 0–1 (default 0.75), `control_start` / `control_end` | **$0.0065 / MP** | Not stated. DPA uses SCCs, so it is probably not EU. **Not verified** | Payloads are kept **90 days** by default. Header `X-Fal-Store-IO: 0` disables this. CDN expiry is set with `X-Fal-Object-Lifecycle-Preference`. ZDR "contact sales" | Page shows a "Commercial use" badge. fal terms give no ownership. Weights are Apache-2.0 | "Company will not use Client Content to create, train…" |
| 2 | **FASHN `model-swap`** (`POST /v1/run`, `model_name: "model-swap"`) | Garment-preserving identity swap: "preserving clothing and outfit details", keeps pose. No depth or canny input. Whether a mannequin render is accepted is **not verified** | 1–5 credits at **$0.075 / credit**. 1k fast = $0.075, 1k balanced = $0.15, 1k quality = $0.225. Face ref +3 credits | Not stated (subprocessors) | CDN outputs deleted after **3 days**. Base64 inputs deleted at completion. Request records kept until deletion is requested | "you own the outputs … You may use them for personal or commercial purposes" | No, unless you opt in |
| 3 | **Stability AI Control Structure** (`POST https://api.stability.ai/v2beta/stable-image/control/structure`; Bedrock `stability.stable-image-control-structure-v1:0`) | **Yes.** It takes an RGB image (our render), and `control_strength` 0–1 (default 0.7). Output resolution matches the input | **$0.05** direct (5 credits at $0.01). **$0.07** on Bedrock | Direct: **not verified**. Bedrock: **US only** (us-east-1/2, us-west-2, geo cross-region) | Direct: not stated. Bedrock: account-level `data_retention_mode: none` gives ZDR | "we assign to you all of our right, title, and interest (if any) in the Outputs" | Direct: yes by default, with an opt-out toggle. Bedrock: content is not shared with the provider |
| 4 | **Google Vertex `gemini-3.1-flash-image`** (Nano Banana 2.x family) | Multi-image edit steered by prompt. A depth or normal pass can be sent as an extra reference image, but there is **no explicit control weight** | **$0.067** at 1K (1120 tokens) | **EU multi-region (`eu`) supported.** No AU | Cache deleted within 24 h, and can be disabled. Abuse-monitoring logs apply | "Google does not assert any ownership rights in any new intellectual property created in the Generated Output" | No ("without Customer's prior permission") |
| 5 | **BFL FLUX.2 [pro] / [flex] / Kontext** (`/v1/flux-2-pro`, `/v1/flux-2-flex`, `/v1/flux-kontext-pro`) | Up to 8 reference images, structure by prompt only. BFL: "Expecting pixel-perfect structural matching: FLUX.2 interprets structure semantically." FLUX.1 Depth/Canny [pro] are **deprecated** | FLUX.2 pro $0.03 for the first MP plus $0.015/MP per reference. Flex $0.05/MP. Kontext pro $0.04 | **EU: `api.eu.bfl.ai`** ("Multi-cluster routing limited to EU regions"). No AU | Results expire after 10 min. Input retention is not stated | EU Dev ToS: "you own all right, title, and interest in and to Output" | **Yes:** "the Company may use Inputs and Outputs to train and improve its artificial intelligence models". No opt-out found |
| 6 | **Bria** (`/v2/image/edit/relight`, `/image/edit/product/virtual-tryon`, FIBO Edit) | Relight and VTO. The v1 ControlNet depth/canny "guidance methods" are **not in today's docs index**, so **not verified as live** | VTO **$0.032**. FIBO Edit $0.032. Relight is not priced on the page | Not stated. Enterprise "in your own cloud" exists | Outputs expire after **3 days**. Inputs are "not retained beyond what's needed to process the request" | Output assignment covers Bria's own models (Legal Lobby summary). Full T&Cs are on Google Drive and **not read** | "customer content will not be used to train generative models" |
| 7 | **fal `fal-ai/iclight-v2`** (relight) | Relight only, with `initial_latent` direction and `mask_image_url` | **$0.10 / MP** | As fal | As fal | "Commercial use" badge. The licence of the underlying weights is **not verified** | As fal |
| 8 | **Photoroom** Plus API (Virtual Model, AI Relighting) | Virtual Model takes "a flat lay or ghost mannequin image". It does not take our 3D render or passes | **$0.10** per Plus image | **US only.** EU-only residency is "not available today" | Sync images are discarded on response | Not verified | No by default on API |
| 9 | **OpenAI `gpt-image-2` / 2.5** edits | Mask plus prompt. No depth control | Token-billed. The historical table gives gpt-image-2 high at $0.211 for 1024², which is **not a current rate card** | EU processing for images "requires additional approval". AU: storage only, no image processing | 30-day abuse log. ZDR-eligible with approval | Covered in the prior doc | No |
| 10 | **Adobe Firefly Services** (`/v3/images/generate-async`, `structure.strength` 1–100) | Structure reference ("image outline and depth") | Enterprise contract. Rate card returned 403. **Not verified** | Not verified | Not verified | Not verified | Not verified |

**Dead or withdrawn as of today:** Vertex `imagen-3.0-capability-001` (canny/scribble controlled customisation) is listed as **discontinued** with `gemini-2.5-flash-image` as its replacement. Amazon **Nova Canvas** (CANNY_EDGE / SEGMENTATION conditioning, available in eu-west-1) reached **EOL on 2026-09-30**. BFL **FLUX.1 Depth/Canny [pro]** "are deprecated and will no longer be supported in the BFL API".

**Banned-list reminder:** fal and Replicate host many FLUX.1 [dev] ControlNet/LoRA endpoints, such as `fal-ai/flux-control-lora-depth` and Replicate `flux-depth-dev`. `flux.1-dev` is on our banned list, so these are excluded even where the host shows a "commercial" badge. `fal-ai/iris-z/depth-to-image` is "FLUX.2-based" with an unstated base checkpoint. If that is FLUX.2 [dev] it is banned, so treat it as excluded until its weights are pinned.

---

## 1. fal.ai: Z-Image-Turbo ControlNet (best structure control per dollar)

- **Endpoint:** `fal-ai/z-image/turbo/controlnet` (sync `https://fal.run/fal-ai/z-image/turbo/controlnet`). There is also a LoRA variant, `fal-ai/z-image/turbo/controlnet/lora`, at $0.01/MP.
- **Control** (from https://fal.ai/models/fal-ai/z-image/turbo/controlnet/llms.txt):
  - `image_url` is the control image.
  - `preprocess`: none (default), canny, depth or pose. With `none` we can send our depth pass directly, or a canny/edge image made from the normal pass.
  - `control_scale` 0–1 (default 0.75), `control_start` 0–1 (default 0), `control_end` 0–1 (default 0.8).
  - `num_inference_steps` 1–8, plus `enable_safety_checker`.
  - Only one control image per call. Union multi-control is not exposed.
- **Weights licence:**
  - Tongyi-MAI/Z-Image-Turbo: "License: apache-2.0" (https://huggingface.co/Tongyi-MAI/Z-Image-Turbo).
  - alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union: "License: apache-2.0". It supports Canny, HED, Depth, Pose and MLSD (https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union).
  - The fal page shows a "Commercial use" badge and "License | Commercial use permitted".
  - The fal endpoint does not say which ControlNet checkpoint it runs. **Not verified.**
- **Price:** "$0.0065 per megapixels" (same llms.txt). Prompt expansion adds 0.0025.
- **Latency:** not published; the page only says "super-fast". 8 steps by default.
- **fal terms** (https://fal.ai/terms, "Last Updated: September 8, 2026"):
  - Access is "for your own personal or internal business use".
  - "Company does not represent, warrant, or covenant that any Output Content will be original."
  - fal grants no ownership of outputs. API Services terms (https://fal.ai/legal/api-services) say the terms do not "otherwise entitle Client to any Intellectual Property Rights in any Output Content". Rights therefore come from the model licence (Apache-2.0 here).
  - **Training:** "Company will not use Client Content to create, train, develop (directly or indirectly) Company's products or services." The exception is APIs marked "Pending Enterprise Ready".
- **Retention** (https://fal.ai/docs/model-apis/data-retention):
  - "Request inputs and outputs are stored in the platform for **90 days** by default."
  - Opt out per request with `X-Fal-Store-IO: 0`, or ask for an account-wide default.
  - CDN files expire via `X-Fal-Object-Lifecycle-Preference` (`expiration_duration_seconds`).
  - Payloads and outputs can be deleted via the Platform API.
  - "ZDR isn't enabled by default … contact the fal sales team."
  - Input CDN files are not deleted by that API, so send inputs as data URIs rather than uploading them to fal storage. This is our inference, not fal's guidance.
- **Region:** not stated anywhere I read. The DPA (https://fal.ai/legal/data-processing-addendum) handles EEA transfers "follow[ing] the SCCs" (Module 2), which implies processing outside the EEA. No EU or AU region option. **Not verified.**
- **Person restrictions:** a safety checker is on by default. Nothing person-specific was found.

## 2. FASHN: model-swap, plus try-on with a rendered person

- **Endpoint:** `POST https://api.fashn.ai/v1/run` with `model_name: "model-swap"` (https://docs.fashn.ai/api-reference/model-swap.md).
  - It can "change the identity of fashion models in existing images while preserving clothing and outfit details". Garments, pose and styling stay the same.
  - Inputs: `model_image` ("Source fashion model image containing the clothing and pose to preserve"), an optional `prompt`, an optional `face_reference` (+~20 s, +3 credits), `resolution` 1k/2k/4k, and `generation_mode` fast/balanced/quality.
  - Whether a grey mannequin 3D render counts as a "fashion model image" is **not verified** and needs a bake-off test. A skin-toned render is more likely to pass.
- **Related endpoints:**
  - `tryon-v1.6` describes `model_image` only as "Primary image of the person". It does not say whether a render is acceptable. It processes at 864 × 1296. Latency is ~5 s (performance), ~8 s (balanced) or 12–17 s (quality). Cost is 1 credit.
  - Others: `product-to-model` (accepts ghost-mannequin packshots per https://fashn.ai/product-to-model), `model-create`, `face-to-model`, `edit`, `reframe`.
- **Structure control:** implicit only. No depth, normal or strength input.
- **Price:** "$0.075 /credit", minimum purchase $7.50 (https://fashn.ai/pricing). For model-swap:

  | Mode | 1k | 2k | 4k |
  |---|---|---|---|
  | fast | 1 credit | 2 credits | 3 credits |
  | balanced | 2 credits | 3 credits | 4 credits |
  | quality | 3 credits | 4 credits | 5 credits |

  That works out to **$0.075–$0.225 at 1k**.
- **Terms** (https://fashn.ai/legal/terms-of-service; no date shown on the page):
  - "As between you and FASHN, and to the extent permitted by applicable law, you own the outputs generated for you."
  - "You may use them for personal or commercial purposes in accordance with your subscription plan."
  - "FASHN will not use Customer Content to train, fine-tune, or otherwise improve FASHN or third-party AI models…" unless you opt in.
- **Retention** (https://docs.fashn.ai/api-overview/data-retention-privacy.md):
  - CDN outputs are "Scheduled for deletion after three days".
  - The base64 input copy is removed at completion, with a fallback cleanup after one day.
  - `return_base64` outputs last about an hour.
  - Request records are "Not deleted automatically". To delete them, email legal@fashn.ai.
  - "There is currently no deletion endpoint." A DPA is available.
- **Region:** not specified ("processed by FASHN's AI and infrastructure providers", Subprocessor List). **Not verified.**

## 3. Stability AI: Control Structure, Sketch and Style (direct API and AWS Bedrock)

- **Endpoint:** `POST https://api.stability.ai/v2beta/stable-image/control/structure` (https://docs.stability.ai/api-reference/control/structure).
  - `image` is jpeg/png/webp, 4,096–9,437,184 px, aspect ratio 1:2.5 to 2.5:1.
  - `control_strength` is a float 0–1, default 0.7.
  - Other fields: `prompt`, `negative_prompt`, `style_preset` (including `photographic`), `output_format`.
  - "The resolution of the generated image will match that of the input image."
  - It takes our RGB render (or a depth visualisation). The Bedrock card describes the model as "guided by structural inputs like depth maps and edge detection". It does not expose separate depth and canny channels.
- **Related services:** Control Sketch ($0.05), Style Guide ($0.05), Replace Background & Relight ($0.08), Search and Replace, and Inpaint ($0.05).
- **Price** (https://docs.stability.ai/pricing): 1 credit = $0.01, Control Structure = 5 credits, so **$0.05**. Stable Image Ultra is $0.08 and SD 3.5 Large is $0.065. On Bedrock (https://aws.amazon.com/bedrock/pricing/): "Stable Image Control Structure $0.07", "Region: Oregon, N. Virginia, Ohio".
- **Terms** (https://stability.ai/terms-of-service, "Effective: September 30, 2026"):
  - "we assign to you all of our right, title, and interest (if any) in the Outputs … So as between Stability and you, you own the Output".
  - **Training:** "we may use Content to improve and develop our Services … you can opt-out to prevent us from using your Inputs and Outputs to train our models".
  - The Platform API opt-out is the account toggle "Training: Improve the Model for Everyone" set to "No" (https://stability.ai/privacy-center).
- **Retention:**
  - Direct API retention is not stated on either page, and there is no ZDR. **Not verified.**
  - On Bedrock (https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html), mode `none` means "Zero data retention. No request or response data is written to durable storage by AWS or shared with the model provider". Also: "Amazon Bedrock does not share your content with model providers for any current mode."
- **Region:**
  - Bedrock model card: in-Region **not** supported; Geo US cross-region only (us-east-1, us-east-2, us-west-2); no EU or APAC (https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-control-structure.html).
  - Direct API region: **not verified**.
- **Latency:** not published.

## 4. Google Vertex AI: Gemini image models (Imagen control is gone)

- **Imagen controlled customisation:** `imagen-3.0-capability-001` with `CONTROL_TYPE_CANNY` / `CONTROL_TYPE_SCRIBBLE` and no depth. Today's doc lists it as **discontinued**, replaced by `gemini-2.5-flash-image`, and says "We recommend updating your model endpoints before June 30, 2026" (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/edit-controlled). It is not usable for new work.
- **Gemini image models:** `gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image` and `gemini-3.1-flash-lite-image`.
  - Structure comes from the prompt plus reference images, with no control weight.
  - The render can go in as image 1 and the depth or normal pass as image 2, with an instruction to keep silhouette, hem and colour.
  - Expect drift. The prior doc notes "skin-tone/proportion drift".
- **Price** (curl of https://cloud.google.com/vertex-ai/generative-ai/pricing):
  - Gemini 3.1 Flash Image: "1120 tokens ($0.067) for 1K (roughly 1MP)", plus 1120 tokens per input image.
  - Gemini 3 Pro Image: "1120 tokens ($0.134) for 1K and 2K".
  - Gemini 3.1 Flash-Lite Image: "1120 tokens ($0.034) for 1K".
  - Virtual Try-On: $0.06. Imagen 3 "Customize an image": $0.04 (still on the price list, but the model is discontinued).
- **Region** (curl of https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations, "compare-yes" cells):
  - `gemini-3.1-flash-image`: Global, **US multi-region, EU multi-region** (`https://aiplatform.eu.rep.googleapis.com`).
  - `gemini-2.5-flash-image`: europe-west1, europe-west4, europe-north1, europe-central2, europe-west8 and europe-southwest1, plus US regions.
  - `gemini-3-pro-image`: Global only.
  - `virtual-try-on-001`: europe-west1/4/8/9, europe-north1, europe-southwest1, asia-southeast1, asia-northeast1, and others.
  - **No australia-southeast1 for any image model.**
- **Terms** (https://cloud.google.com/terms/service-terms):
  - "Generated Output is Customer Data. As between Customer and Google, Google does not assert any ownership rights in any new intellectual property created in the Generated Output."
  - "Google will not use Customer Data to train or fine-tune any AI/ML models without Customer's prior permission or instruction."
- **Retention** (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention):
  - Cache is "deleted no later than 24 hours after it's written". `"disableCache": true` turns off all caching.
  - "Google may log prompts to detect potential abuse".
  - "Zero data retention may not be possible when using some Advanced AI features."
- **Person restrictions:** generic `personGeneration` `allow_adult` is the default, celebrities are blocked (Responsible AI settings page, seen in search snippet only). Forum reports describe IMAGE_SAFETY blocks on the 3.x image models. EU-specific behaviour is **not verified**.

## 5. Black Forest Labs: FLUX.2 / Kontext / VTO

- **Endpoints** (https://docs.bfl.ai/llms.txt): `/v1/flux-2-max`, `/v1/flux-2-pro`, `/v1/flux-2-flex`, `/v1/flux-2-klein-*`, `/v1/flux-kontext-pro` / `-max`, `/v1/flux-tools/vto-v2`, and FLUX.1 Fill [pro].
- **Depth and canny:**
  - No depth or canny endpoints appear in today's docs index. A doc page for `/v1/flux-pro-1.0-depth` returned 404.
  - BFL's tools announcement says FLUX.1 Depth and Canny "are deprecated and will no longer be supported in the BFL API".
- **FLUX.2 [flex] parameters:**
  - `input_image` … `input_image_8`, `guidance` 1.5–10, `steps` 1–50, `safety_tolerance` 0–7.
  - "The specification does not define any strength or control parameters."
  - The guide says: "Instead of dedicated ControlNet inputs, FLUX.2 uses its multi-reference editing system to achieve structural control." It also warns: "Expecting pixel-perfect structural matching: FLUX.2 interprets structure semantically." (https://docs.bfl.ai/guides/usecases_editing_controlnets)
- **Price** (https://bfl.ai/pricing):
  - FLUX.2 [pro]: "1st MP $0.03; additional MP $0.015; reference image $0.015/MP".
  - FLUX.2 [flex]: $0.05 per MP and per reference MP.
  - FLUX.2 [max]: $0.07.
  - Kontext [pro]: $0.04/img. Kontext [max]: $0.08/img.
  - FLUX VTO: "1st MP $0.0375".
- **Region** (https://docs.bfl.ai/api_integration/integration_guidelines): `api.eu.bfl.ai`, "European Multi-cluster Endpoint", "Multi-cluster routing limited to EU regions", "GDPR compliant". There is also `api.us.bfl.ai`. No AU endpoint.
- **Retention:** "Generated images expire after 10 minutes and become inaccessible." Input retention is not stated.
- **Terms:**
  - EU Developer ToS (https://bfl.ai/legal/eu-developer-terms-of-service, "Last Revised on August 26, 2026"):
    - "As between you and us, you own all right, title, and interest in and to Output."
    - "You and your End Users may use Outputs for your or their own personal or commercial purposes".
  - FLUX API Service Terms §2(b) (https://bfl.ai/legal/flux-api-service-terms, revised August 4, 2026; the EU version is revised August 26, 2026):
    - "**the Company may use Inputs and Outputs to train and improve its artificial intelligence models**".
    - The licence is "perpetual, irrevocable, worldwide, non-exclusive, and fully sublicensable".
    - No opt-out was found in either document.
  - Our inputs contain no real person, but this clause still matters for merchant garment imagery.
- **Latency:** not verified today.

## 6. Bria AI

- **Docs:** base `https://engine.prod.bria-api.com/v2`, with no regional endpoints.
  - Relight is `POST /v2/image/edit/relight` ("Modify the lighting setup (direction and atmosphere)"). Its parameters were **not read**.
  - VTO is `POST /image/edit/product/virtual-tryon` (`person_image` plus 1–3 `garment_images`, "No prompt needed"). Whether a render is accepted as the person image is **not verified**.
- **ControlNet:** the legacy `controlnet_depth` / `controlnet_canny` guidance (scale 0–1, up to 4 methods) appeared only in search snippets of older docs. It is **absent from today's docs index**, so **not verified as available**.
- **Price** (https://bria.ai/pricing): "Virtual Try-On (fashion): $0.032 / Image", "Fibo Edit: $0.032 / Image". Relight is not listed.
- **Retention** (https://docs.bria.ai/getting-started/asset-retention.md):
  - "Images expire after 3 days".
  - Inputs "are not retained beyond what's needed to process the request".
- **Terms** (https://bria.ai/legal-lobby summary only; the T&Cs are Google Drive PDFs and were not read):
  - "customer content will not be used to train generative models".
  - "the assignment of rights in output, apply solely to Bria's models".
  - Indemnity is for enterprise only (docs.bria.ai/safety, seen in search snippet only).
- **Region:** not stated. An enterprise "in-your-own-cloud" deployment option exists.

## 7. fal: other relevant endpoints

- **`fal-ai/iclight-v2`:** relight with `image_url`, `prompt`, `initial_latent` (None/Left/Right/Top/Bottom), `mask_image_url` (our garment mask could protect the garment) and `lowres_denoise` (default 0.98). Price "$0.10 per megapixel". The page shows a "Commercial use" badge. The provenance and licence of the IC-Light v2 weights are **not verified**; it is reportedly FLUX-based, so check before use.
- **`fal-ai/ltx-2.3-quality/render-to-real`:** "Turn a stylized 3D / CG / game render into photorealistic footage". It takes video input (`video_url`) and an optional first-frame `image_url`, outputs 480p/720p, and has a "Commercial use" badge. Price not shown. It is relevant only to a future video path. A single-frame use is untested.
- **`fal-ai/image-preprocessors/depth-anything/v2`:** not needed, since we have true depth.

## 8. Replicate

- **Retention** (https://replicate.com/docs/topics/predictions/data-retention): "all input parameters, output values, output files, and logs are automatically removed after an hour" for API predictions.
- **Region and training:** not stated. **Not verified.**
- **Models:**
  - `black-forest-labs/flux-depth-pro` is still listed, but BFL has deprecated it. Its price was not shown on the page.
  - The `*-dev` and other FLUX.1 [dev] ControlNets are banned for us.
  - Replicate inherits each model's licence ("agreeing to the Black Forest Labs API agreement").
- It adds nothing over fal for our need.

## 9. OpenAI gpt-image

- **Data residency** (https://developers.openai.com/api/docs/guides/data-residency.md):
  - EU (`eu.api.openai.com`) offers regional processing for `/v1/images/edits`, but "Image support in these regions requires additional approval. Contact sales."
  - Australia: storage only. Image processing is not listed.
- **Retention** (https://developers.openai.com/api/docs/guides/your-data.md): images endpoints keep abuse logs for "30 days" and are ZDR-eligible for `gpt-image-2`, `gpt-image-1.5` and `gpt-image-1-mini`. Also: "data sent to the OpenAI API is not used to train or improve OpenAI models."
- **Price** (https://developers.openai.com/api/docs/pricing): `gpt-image-2` output "$30.00" per 1M tokens. The per-image calculator was not read.
- **Structure control:** mask plus prompt only. No depth control.

## 10. Adobe Firefly Services

- **Endpoint:** `POST https://firefly-api.adobe.io/v3/images/generate-async` with `structure.imageReference.source.uploadId` and `structure.strength` 1–100 (default 50). It "uses a reference image to apply structural characteristics (like image outline and depth)" (https://developer.adobe.com/firefly-services/docs/firefly-api/guides/concepts/structure-image-reference/).
- **Price, region, retention, terms:** enterprise contract only. The rate card page returned 403. **Not verified.** This is the only other first-party structure-strength API found, so it is worth a sales call if indemnity matters.

## 11. Others checked briefly

- **Photoroom** (https://www.photoroom.com/api/pricing; https://www.photoroom.com/platform/security, seen in search snippet only):
  - Plus is "$0.10" per image and includes Virtual Model and AI Relighting.
  - Virtual Model inputs are "a flat lay or ghost mannequin image", which is not our render.
  - Infrastructure is in the US. EU-only residency is "not available today".
  - API images are not used for training by default.
- **Runway** `gen4_image`: reference images only, with no structure control. Prices came from secondary sources (5 credits at 720p, 8 at 1080p, $0.01/credit). **Not verified at source.**
- **Krea API**: Krea 2 models have image-to-image `strength` (default 0.99, per a search snippet of krea.ai/docs). No depth control was found. Pricing **not verified**.
- **Leonardo**: v1 `controlnets` with `preprocessorId` exist, but the depth and pose IDs for current models were not found. Several of its models are FLUX.1 [dev], which is banned. **Not verified.**
- **AWS Nova Canvas**: had CANNY_EDGE / SEGMENTATION conditioning and was in eu-west-1, but reached **EOL on 2026-09-30** (model card). Nova 2 Omni image generation was reported as preview in July 2026 by a secondary source. **Not verified.**
- **Clipdrop**: not checked.

---

## Implications for Curtain

1. No hosted first-party API today exposes depth **and** normal ControlNet channels with per-channel weights. The best real structure lock is an **open Apache-2.0 ControlNet hosted on fal** (Z-Image-Turbo + Fun-ControlNet-Union): our depth pass goes in with `preprocess: none`, `control_scale` about 0.8–1.0 and `control_end` 1.0. The trade-off is fal's 90-day payload default, which must be disabled per request, and no EU region.
2. **Colour:** none of these services guarantees exact colour. The robust approach is to composite. Use the garment-segmentation pass to paste the original garment albedo/shading back over the output, or to restrict generation to non-garment pixels: fal `iclight-v2` `mask_image_url`, BFL Fill, or OpenAI mask edits. A colour-delta check (ΔE against the merchant swatch) should gate the result.
3. **EU residency:** only BFL (`api.eu.bfl.ai`; but trains on inputs) and Vertex `gemini-3.1-flash-image` (EU multi-region; no training; prompt-level structure only) were verified as EU-resident. **No service verified AU processing.**
4. Every output is still a generated estimate (hard rule 3), and the inputs are renders, so hard rule 1 is unaffected.
