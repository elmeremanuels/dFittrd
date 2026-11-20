# AI virtual try-on engines — landscape and recommendation

> Researched 2026-11-04 by parallel research + fact-check agents. Figures were spot-checked against primary sources; corrections from the fact-check are listed at the end and override the report body where they conflict. Not legal advice.

## Summary

Late-2026 landscape, researched 2026-11-04. Three tiers exist: (1) purpose-built try-on APIs that take a person photo + a garment photo (flat-lay or on-model) and a category hint — FASHN (tryon-v1.6 / tryon-max), Google Vertex AI Virtual Try-On (virtual-try-on-001, GA, $0.06/img), Kling Kolors VTO (v1.5, ~$0.07, fal endpoint now deprecated), Alibaba OutfitAnyone/aitryon-plus (~$0.072), BFL FLUX VTO v2 (EU endpoint, <4 s claim), plus open-weight models (FASHN VTON 1.5 Apache-2.0, Leffa MIT; IDM-VTON/OOTDiffusion/CatVTON/FitDiT are non-commercial); (2) general multi-reference image editors steered by prompt — Google Nano Banana 2.1/Pro (up to 14 reference images, $0.034–$0.24/img), OpenAI gpt-image-2/2.5/1.5 (token-billed, ~$0.03–0.13/img), xAI grok-imagine-image-2.0 ($0.04/img, up to 5 source images); (3) image-to-video animators for a 'hero' clip from an already-rendered try-on still — xAI grok-imagine-video-1.5 ($0.08/s, up to 15 s, 14 reference images), Kling 3.0 i2v ($0.084–0.126/s via fal), Veo 3.1 (Gemini API preview shut down 2026-10-22; GA only on Vertex; replacement gemini-omni-1.1-flash ≈$0.10/s), Alibaba Wan 2.6/2.7 i2v ($0.10/s 720p, $0.15/s 1080p), Runway Gen-4.5 ($0.12/s), Luma Ray3.2 ($0.30 per 5 s @720p); true video try-on (garment onto a moving person) exists only as Decart Lucy VTON (realtime/batch, 720p, $0.02/s), Segmind Video Tryon (price unpublished) and non-commercial research code (MagicTryOn, CatV2TON, ViViD). Key findings: no engine accepts structured fabric/size-chart metadata — fabric type, weight, drape and the chosen size must be expressed as prompt text and/or encoded in the garment/avatar image you send; the only independent multi-model benchmark found (ionio.ai, 160 pairs × 5 models) rates Kling best for identity/body preservation, FASHN best for one-pieces and sequin/silk fabrics, Nano Banana Pro most flexible but with skin-tone/proportion drift and safety-filter refusals on slip dresses; Grok Imagine has no try-on endpoint and no independent try-on evaluation — the founder's observation is about its image-to-video fabric motion, which is real but is an animation of a still, not a fit render. On privacy: every server-side neural try-on requires a picture of the user to leave the device; the honest design is to send a locally rendered avatar (SMPL-X body + face tile) instead of the raw capture, use providers that contractually do not train and delete quickly (FASHN: no training unless opt-in, 3-day output deletion, base64 inputs deleted at completion; Vertex: no training, cache can be disabled; OpenAI: no training, 30-day abuse log, ZDR-eligible image endpoints; xAI: no training, 30-day retention, team-wide ZDR), and offer a self-hosted FASHN VTON 1.5 path on the founder's own GPU VPS (~8 GB VRAM) so images never leave first-party infrastructure.

## Recommendation

PRIMARY (v1 image try-on): FASHN hosted API — tryon-v1.6 for tops/bottoms/one-pieces with garment_photo_type='flat-lay' (the merchant payload's flatLayPhoto maps 1:1), mode='balanced' (~8 s, $0.075), and tryon-max (prompt + 2K, ~25 s, $0.225) for the shareable hero still and for shoes/bags/accessories. Rationale: only dedicated engine with explicit flat-lay and one-piece handling, best benchmark result on dresses/sequins/silk, 5–17 s, no training unless opt-in, 3-day output deletion, base64 inputs deleted at completion, DPA available, and an Apache-2.0 open-weight sibling (FASHN VTON 1.5, ~8 GB VRAM) that lets the founder move the exact same adapter onto a GPU VPS in Docker when volume or privacy demands it. FALLBACK #1: Google Vertex AI Virtual Try-On (virtual-try-on-001, $0.06, GA, no-training contract, EU regions, SynthID) — route here on FASHN PoseError/timeout or for merchants that require Google-only processing; FALLBACK #2 (creative/edge cases such as layered outfits, exotic garments, or when fabric/size wording must steer the render): Nano Banana 2.1 or Pro via Vertex AI (not the free Gemini tier), with the fit engine's chosen size and the fabric descriptor rendered into the prompt and the result labelled 'generated estimate'. Run a 2-week bake-off on ~50 real merchant SKUs (incl. 15 dresses, 15 bottoms) before locking these, scoring identity similarity, garment-shape accuracy and proportion drift, and include BFL FLUX VTO v2 (EU endpoint, multi-garment) and Kling Kolors as challengers. VIDEO (optional, hero only): animate the FASHN/Vertex try-on STILL — never the raw capture — with xAI grok-imagine-video-1.5 ($0.08/s, ≤15 s, ZDR toggle, no training) as default and Kling 3.0 i2v via fal ($0.084/s, best cloth-physics anecdotes) as alternate; prompt with the fabric descriptor ('240 gsm linen, fluid drape, slow turn'). Grok is therefore kept exactly where the founder saw it shine (fabric motion from a photo), but is not asked to do garment transfer or sizing. DO NOT use IDM-VTON/OOTDiffusion/CatVTON/FitDiT in production (non-commercial licences) — this supersedes the handoff's §6 'hosted IDM-VTON or OOTDiffusion' fallback. SIZE/FIT: no engine honours a size chart; keep fit score + size recommendation in the deterministic fit engine (handoff §4.1–4.2), and encode the chosen size visually by rendering the garment onto the avatar at the correct ease in Path B before/alongside the neural render, plus the mandatory 'estimate' disclaimer.

## Integration notes

PRIVACY — honest answer: every server-side neural try-on (all vendors above) needs an image of the user; none can honour 'raw photos never leave the device' literally. Recommended architecture (three tiers, user-selectable, default = Tier 1):
Tier 1 'Avatar render' (default, privacy-preserving): on-device, fit the SMPL-X mesh + face tile (handoff §2.1), then render a neutral-pose, neutral-background 1024×1536 avatar image (user's proportions, skin tone, hair, face tile composited, fitted base layer). Send ONLY this derived render + the merchant garment image to the try-on provider. The raw capture photo/video never leaves the phone; what leaves is a synthetic image of a person, which is still personal data (face) but is reproducible and minimal. Optional extra step: send the render with a generic/blurred face, then re-composite the user's real face tile locally after the result returns (works because try-on engines leave the head region untouched; FASHN/Kling preserve head pixels well).
Tier 2 'Self-hosted': FASHN VTON 1.5 (Apache-2.0) in Docker on the founder's GPU VPS (RTX 4090 / L4 / A10 class, ≥8 GB VRAM; ~5–10 s/img). Same adapter interface, zero third-party retention, cost ≈ GPU hours only. Requires the VPS to have a GPU — confirm.
Tier 3 'Hero render' (explicit opt-in, per-render consent + ledger entry): hosted FASHN tryon-max / Vertex / Nano Banana / video animator, using base64 inputs (deleted on completion at FASHN), Vertex with disableCache, xAI with ZDR + own upload_url, OpenAI ZDR-eligible image endpoints. Show provider name + retention window in the Privacy ledger.
On-device neural try-on is research-only today (Mobile-VTON, CVPR 2026, 1024×768, CC BY-NC-SA, no shipped Core ML/TFLite runtime) — not viable for v1; Path B 2D warp remains the on-device renderer.
Never ship API keys to the client; all adapters live in the backend; merchant SDK calls the backend with a short-lived token.

FABRIC / SIZE METADATA: no engine takes structured input. Map payload → prompt text for prompt-capable engines (FASHN tryon-max, Nano Banana, Grok, FLUX VTO): e.g. `${fabric.primary} ${fabric.weightGsm} gsm, ${drapeWord(fabric.drape)} drape, ${sheenWord}, ${opacityWord}, size ${size} fitting ${easeWord(gap)}`. For non-prompt engines (FASHN v1.6, Vertex, Kling) the only lever is the garment image: pre-process the flat-lay (background-removed, colour-corrected to primaryColorHex) and, for size, render the Path-B warped garment onto the avatar first and pass that as 'model' photo type so the neural engine refines rather than re-fits.

COST MODEL (per rendered item): FASHN v1.6 $0.075 (balanced) → ~€0.07; Vertex $0.06; Nano Banana 2.1 $0.034; self-hosted ≈ $0.005–0.01; hero video 6 s Grok $0.48 / Kling $0.50–0.76. A 10-card swipe session ≈ $0.75 hosted or <$0.10 self-hosted; charge merchants per API call or monthly (founder's plan).

ADAPTER INTERFACE (TypeScript, backend-only):
```ts
export type GarmentCategory = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory';
export interface GarmentInput {
  id: string;
  category: GarmentCategory;
  flatLayPhoto?: Uint8Array;        // preferred (background-removed PNG)
  productPhotos?: Uint8Array[];     // on-model fallbacks
  primaryColorHex?: string;
  fabric?: { primary: string; weightGsm?: number; stretchPct?: number; drape?: number; opacity?: number; sheen?: number };
  patternBlock?: string;
  size?: string;                    // chosen by the fit engine
  fitGapCm?: Partial<Record<'bust'|'waist'|'hip'|'shoulder', number>>; // from §4.1
}
export interface PersonInput {
  kind: 'avatarRender' | 'userPhoto'; // 'userPhoto' only allowed in the opt-in tier
  image: Uint8Array;                   // 3:4 portrait, full body, neutral background
  faceTile?: Uint8Array;               // optional, for local re-composite (never sent)
  consentTier: 'avatar' | 'selfHosted' | 'heroOptIn';
}
export interface TryOnOptions {
  quality: 'fast' | 'balanced' | 'quality';
  resolution?: '1k' | '2k' | '4k';
  numSamples?: 1 | 2 | 3 | 4;
  seed?: number;
  preservePose?: boolean;
  promptHint?: string;                 // fabric/size language, built by promptFromMetadata()
  timeoutMs?: number;
}
export interface TryOnResult {
  images: { png: Uint8Array; width: number; height: number; watermark?: 'synthid' | 'none' }[];
  provider: string; model: string; costUsd: number; latencyMs: number;
  retention: { vendorDeletesAfterHours: number | null; trainedOn: false | 'unknown' };
  disclaimer: 'generated-estimate';
}
export interface VideoOptions { durationSec: 4 | 6 | 8 | 10 | 12 | 15; resolution: '480p' | '720p' | '1080p'; promptHint?: string; }
export interface VideoResult { mp4: Uint8Array; durationSec: number; provider: string; model: string; costUsd: number; }

export interface TryOnProvider {
  readonly name: string;
  readonly capabilities: {
    categories: GarmentCategory[];
    acceptsFlatLay: boolean; acceptsPrompt: boolean; multiGarment: boolean;
    maxResolution: '1k' | '2k' | '4k'; video: boolean;
    privacy: { trainsOnInputs: boolean; retentionHours: number | null; euResidency: boolean; zdrAvailable: boolean; selfHosted: boolean };
  };
  estimateCost(opts: TryOnOptions): number;
  tryOn(person: PersonInput, garment: GarmentInput, opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult>;
  tryOnOutfit?(person: PersonInput, garments: GarmentInput[], opts: TryOnOptions): Promise<TryOnResult>; // FLUX VTO / aitryon-plus
  animate?(still: Uint8Array, garment: GarmentInput, opts: VideoOptions, signal?: AbortSignal): Promise<VideoResult>; // Grok / Kling 3.0
  healthCheck(): Promise<{ ok: boolean; p50LatencyMs?: number }>;
}

// Router: picks provider by consent tier, category, capability and health; falls through on PoseError/timeout.
export class TryOnRouter {
  constructor(private providers: TryOnProvider[], private policy: { tierAllowList: Record<PersonInput['consentTier'], string[]>; maxCostUsd: number }) {}
  async render(person: PersonInput, garment: GarmentInput, opts: TryOnOptions): Promise<TryOnResult> { /* order: self-hosted FASHN → FASHN API → Vertex VTO → Nano Banana (prompt) ; respect policy.tierAllowList */ throw new Error('impl'); }
}
```
Concrete adapters for v1: FashnProvider (tryon-v1.6 + tryon-max; maps category dress/outerwear→'one-pieces'/'tops', flatLayPhoto→garment_photo_type:'flat-lay', returns base64), FashnSelfHostedProvider (same request shape against the Docker service), VertexTryOnProvider (virtual-try-on-001, disableCache, EU region), NanoBananaProvider (gemini-nano-banana-2.1 via Vertex, 4 character refs = avatar render, prompt from metadata), GrokVideoProvider.animate (grok-imagine-video-1.5, ZDR header check, own upload_url), KlingVideoProvider.animate (fal kling-video/v3). All adapters log provider/model/cost/retention into the Privacy ledger entry shown in the app. Always stamp outputs with the 'estimate' disclaimer required by the founder.

## Candidates

### xAI Grok Imagine — image (grok-imagine-image-2.0) + video (grok-imagine-video-1.5 / -lite / grok-imagine-video edit)

- **vendor**: xAI
- **kind**: General image editor + image-to-video animator (no dedicated try-on endpoint)
- **inputs**: Image edit: text prompt + up to 5 source images (URL or base64). Video: text, or a start image, up to 14 reference images and 3 voice references, pinned first/mid/last frames; duration configurable up to 15 s. Cannot take a size chart or fabric metadata except as prompt text; cannot be told 'this is a flat-lay of a dress, category one-piece'.
- **outputs**: Up to 10 images per request; async video (poll /v1/videos/{id}); generated media can optionally be persisted via Files API or pushed to your own upload_url.
- **apiAvailability**: GA. POST https://api.x.ai/v1/images/generations, /v1/images/edits, /v1/videos/generations; docs https://docs.x.ai/developers/model-capabilities/imagine. Rate limits: image 6 rps, video 10 rps. US-only regional endpoint (us.api.x.ai) has NO image/video APIs.
- **pricing**: grok-imagine-image-2.0 $0.04/image; grok-imagine-image $0.02; grok-imagine-video-1.5 $0.080/s (official pricing page and model page list a flat rate; a search summary of the pricing page claimed resolution tiers $0.08/480p, $0.14/720p, $0.25/1080p plus $0.01 per input image — treat as unverified); -1.5-lite $0.02/s; grok-imagine-video (editing) $0.05/s. No batch discount for media. A 6 s 'hero' clip ≈ $0.48.
- **quality**: No independent virtual-try-on test exists. Third-party reviews of the video model praise fabric motion and physics (e.g. rain sliding down clothing), which matches the founder's observation — but that is animation of an existing image, not a garment transfer. As a prompt-driven editor it has no pose/garment segmentation, so garment-shape, print continuity and size/ease fidelity are not controllable; also documented safety issues around clothing removal mean clothing-change prompts may be moderated unpredictably.
- **latency**: Images: seconds (not published). Video: asynchronous, tens of seconds to minutes for 12–15 s clips (not published).
- **license**: Commercial API use permitted under xAI API terms; generated media subject to content-policy review.
- **privacy**: xAI 'never trains on your API inputs or outputs without explicit permission'; all requests/responses stored encrypted for 30 days for abuse auditing, then deleted. Team-wide Zero Data Retention toggle available (disables Batch/Files; under ZDR you must supply your own output upload URL). Default endpoint does not guarantee a processing region (no EU residency).
- **verdict**: Not a try-on engine. Use only as the optional video-hero animator applied to an already-rendered try-on still (so the raw user photo never goes to xAI). Cheapest quality-tier i2v with contractual no-training and ZDR; good fit for the 'optional video' adapter method, not for v1 image try-on.
- **sources**: https://docs.x.ai/developers/model-capabilities/imagine · https://docs.x.ai/developers/pricing · https://docs.x.ai/developers/models/grok-imagine-video-1.5 · https://docs.x.ai/developers/models/grok-imagine-image-2.0 · https://docs.x.ai/developers/faq/security · https://grokimagine2.io/review · https://www.yahoo.com/news/articles/surprisingly-easy-grok-undress-193059076.html

### Google Vertex AI Virtual Try-On (virtual-try-on-001)

- **vendor**: Google Cloud (Vertex AI / 'Gemini Enterprise Agent Platform')
- **kind**: Dedicated try-on API
- **inputs**: One person image + productImages[] (one garment product photo; PNG/JPEG ≤10 MB). Docs do not list garment categories or flat-lay vs on-model control; single garment per request, no multi-garment compositing. No metadata inputs.
- **outputs**: 1–4 base64 PNGs (or to a GCS storageUri). SynthID watermark + C2PA Content Credentials applied by default (per third-party review).
- **apiAvailability**: GA (replaced virtual-try-on-preview-08-04). REST regional endpoint or google-genai SDK with Vertex. Docs: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-virtual-try-on-images. 50 online requests/min/region.
- **pricing**: $0.06 per output image (Vertex AI pricing page, Imagen table 'Virtual Try-On' row); reseller Pixazo quotes $0.063. Some third-party reviews say pricing requires sales contact — the official page row is the reference.
- **quality**: Google's consumer 'Try On' (Doppl/Shopping) is built on this lineage and renders full-body from a selfie; no independent API benchmark of dresses/lower-body found. Expect good garment fidelity and identity preservation on standard tops/dresses; limited control (no prompt, no category param).
- **latency**: Not published; synchronous online prediction, typically several seconds.
- **license**: Commercial use under Google Cloud terms; outputs watermarked.
- **privacy**: Strong: Google 'won't use your data to train or fine-tune any AI/ML models without your prior permission'; implicit caching ≤24 h, can be disabled per project (disableCache); abuse logging may apply under GCP ToS. EU regional endpoints available for data residency (confirm for this model).
- **verdict**: Best privacy/compliance posture of the hosted options and cheapest dedicated engine ($0.06). Weakness: opaque controls (no category, no flat-lay flag, no prompt). Strong candidate as fallback or even primary if an in-house test shows good one-piece/lower-body results.
- **sources**: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-virtual-try-on-images · https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes · https://docs.cloud.google.com/vertex-ai/generative-ai/pricing · https://www.pixazo.ai/blog/introducing-google-virtual-try-on-api-on-pixazo-api · https://innvesti.com/reports/best-virtual-try-on-apis-multi-brand-retailers-2026/ · https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance · https://blog.google/products-and-platforms/products/shopping/studio-quality-digital-try-on/

### Google Nano Banana family (gemini-nano-banana-2.1, gemini-3.1-flash-image, gemini-3.1-flash-lite-image, gemini-3-pro-image; gemini-2.5-flash-image deprecated)

- **vendor**: Google (Gemini API / Vertex AI)
- **kind**: General multi-reference image generation/editing (prompt-driven try-on)
- **inputs**: Text + up to 14 reference images per request (2.1 / 3.1 Flash: up to 10 object + 4 character images; Pro: 6 object + 5 character + 3 style). Flat-lay + fabric metadata can be given as prompt text ('240 gsm linen, fluid drape, size M with 4 cm waist ease') but is not enforced.
- **outputs**: 1K default, 2K/4K available (0.5K on 3.1 Flash only); every image carries SynthID.
- **apiAvailability**: GA on Gemini API (AI Studio) and Vertex AI. Docs: https://aistudio.google.com/docs/image-generation. gemini-2.5-flash-image deprecated, shutdown 2027-03-15.
- **pricing**: Per image (Standard): nano-banana-2.1 $0.0336 (1K) / $0.0504 (2K) / $0.113 (4K); 3.1-flash-image $0.045 (0.5K) / $0.067 (1K) / $0.101 (2K) / $0.151 (4K); 3.1-flash-lite-image $0.0336; gemini-3-pro-image $0.134 (1K & 2K) / $0.24 (4K); 2.5-flash-image $0.039. Batch ≈50% off for 2.1/lite/2.5.
- **quality**: Independent 160-pair test (ionio.ai): Nano Banana Pro 99.4% completion, cheapest run, strongest creative flexibility and handles exotic garments (saree) better than FASHN, but highest cell-to-cell variance, subtle skin-tone and body-proportion drift, and safety filter blocked silk slip-dresses/swim shorts (workaround: 'editorial fashion photo' phrasing). Not a measured-fit renderer.
- **latency**: Several seconds to ~20 s for Pro at 2K/4K (not officially published).
- **license**: Commercial use allowed; SynthID watermark mandatory.
- **privacy**: Gemini API free tier: inputs ARE used to improve products. Paid tier: not used. Via Vertex AI: no training, caching ≤24 h and disable-able, EU regions available. Keys server-side only.
- **verdict**: Best 'creative fallback' for garments a dedicated VTON model refuses or mangles (layered outfits, accessories, unusual silhouettes) and for prompt-steerable fabric/size language. Not primary: proportion/skin drift violates the 'looks like them' north star. Use through Vertex (not the free Gemini tier).
- **sources**: https://aistudio.google.com/docs/pricing · https://aistudio.google.com/docs/image-generation · https://www.ionio.ai/blog/vton · https://github.com/AhmedFahim13/eos/pull/7 · https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance

### Google Veo 3.1 / Gemini Omni Flash (video)

- **vendor**: Google
- **kind**: Image-to-video / reference-to-video animator
- **inputs**: Text, first-frame image, first+last frame, reference images ('generate videos from references'); Omni Flash also takes video for conversational editing with character consistency.
- **outputs**: 720p/1080p/4K clips with audio (Veo 3.1); SynthID.
- **apiAvailability**: Veo 3.1 preview in the Gemini API was SHUT DOWN 2026-10-22 (veo-3.1-generate-preview, -fast, -lite). GA Veo 3.1 remains on Vertex AI ('Gemini Enterprise Agent Platform'); Gemini API migration path is gemini-omni-1.1-flash.
- **pricing**: Veo 3.1 (per second, with audio, as last published for Gemini API): Standard $0.40 (720p/1080p) / $0.60 (4K); Fast $0.10 / $0.12 / $0.30; Lite $0.05 / $0.08. Gemini Omni Flash ≈ $0.10/s 720p ($17.50 per 1M video output tokens).
- **quality**: No independent garment-motion test found; vendor-adjacent reviews rank Kling 3.0 and Seedance ahead of Veo on cloth physics; Veo praised for audio/narrative.
- **latency**: Async, 1–3 minutes typical (not officially published).
- **license**: Commercial; watermarked.
- **privacy**: Vertex: no training, EU residency; Gemini API paid tier: no training.
- **verdict**: Viable video-hero option inside a Google-only stack, but pricier than Grok/Kling per second and the Gemini API preview churn (shutdown with 1-week notice) is a reliability risk. Secondary.
- **sources**: https://aistudio.google.com/docs/video · https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/overview · https://benchlm.ai/media-pricing/veo · https://magichour.ai/blog/veo-3-pricing · https://invideo.io/faq/what-is-the-best-ai-video-model-for-fashion-product/

### Kling / Kolors Virtual Try-On v1.5 (+ Kling 3.0 image-to-video)

- **vendor**: Kuaishou (Kling AI Open Platform); resold via fal.ai, 302.ai, CometAPI
- **kind**: Dedicated try-on API (image) + general i2v animator
- **inputs**: human_image (front-facing, full body visible) + cloth_image (flat-lay with clean edges preferred). One garment per request; no category param; no metadata.
- **outputs**: 768×1024 image. Kling 3.0 i2v: start image (+ optional end image), 'Elements' reference images, prompt, optional audio.
- **apiAvailability**: Official Kling API (kling.ai/document-api; try-on docs page did not render in fetch) sold in prepaid units: trial 100 units $4.90, 15,000 units $1,050. fal endpoint fal-ai/kling/v1-5/kolors-virtual-try-on is marked 'no longer supported' (deprecated) as of this check; 302.ai $0.10/call; CometAPI ~$0.066. Kling 3.0 i2v on fal: fal-ai/kling-video/v3/standard/image-to-video.
- **pricing**: Try-on ≈ $0.07/image (fal, AIgateway, Kling package math); failed generations not charged. Kling 3.0 i2v: $0.084/s (no audio), $0.126/s (audio), $0.154/s (voice control) — 5 s clip ≈ $0.42–0.77.
- **quality**: ionio benchmark: 100% success, fastest batch, LEAST identity drift and most photographic; fal review: 'dress fabric draped convincingly', preserved pose/skin tone/body shape. Weaknesses: changes backgrounds, sometimes reshapes silhouettes/proportions, cannot switch garment type (skirt→pants), struggles with layering, works best upper-body/front-facing. Kling 3.0 video: multiple blog tests credit it with the best cloth dynamics among i2v models (silk vs denim move differently), degrades beyond ~5–6 s.
- **latency**: Try-on: ~10–20 s (batch of 160 in ~45 min); video async.
- **license**: fal page: 'cleared for commercial use'. Official Kling ToS language is murkier (consumer ToS reserves input-training rights per ConductAtlas).
- **privacy**: Kling API privacy policy: data stored on servers in Singapore; personal information 'will not be used for ... model training' beyond stated purposes; retention 'as long as necessary' (no fixed window). Consumer-side ToS reportedly allows training with opt-out — must get written API-level confirmation. No EU residency.
- **verdict**: Best fidelity-per-dollar for identity/body preservation and the strongest i2v cloth physics, but the fal endpoint is deprecated, the official API is prepaid-unit Chinese-platform billing, and data residency/training terms are unclear for an EU privacy-first product. Use as a benchmark reference and possible fallback via an aggregator with a DPA; Kling 3.0 i2v is a strong video-hero alternative to Grok.
- **sources**: https://fal.ai/models/fal-ai/kling/v1-5/kolors-virtual-try-on · https://fal.ai/learn/tools/best-virtual-try-on-apis-2026 · https://www.ionio.ai/blog/vton · https://pricingsaas.com/companies/klingai · https://302.ai/product/detail/kling-virtual-try-on · https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video · https://kling.ai/document-api/guides/protocols/privacy-policy.md · https://conductatlas.com/platform/kling-ai/kling-ai-terms-of-service/user-content-license/ · https://flowith.io/blog/kling-3-vs-luma-dream-machine-physics

### OpenAI GPT Image (gpt-image-2, gpt-image-2.5-sunburst/flare, gpt-image-1.5, gpt-image-1-mini)

- **vendor**: OpenAI
- **kind**: General image generation/editing (prompt-driven try-on)
- **inputs**: Text + multiple input images via /v1/images/edits or Responses API; metadata only as prompt text.
- **outputs**: Up to 1536×1024-class outputs by quality tier; no watermark requirement documented.
- **apiAvailability**: GA. Docs/pricing: https://developers.openai.com/api/docs/pricing. Third-party trackers report gpt-image-1.5 and gpt-image-1-mini retiring 2026-12-01 — verify.
- **pricing**: Token-billed: image input $8/M (cached $2/M), image output $30/M (gpt-image-2/2.5) or $32/M (1.5); mini $2.50/$8. Effective ≈ $0.009 / $0.034 / $0.133 per 1024² image at low/medium/high (gpt-image-1.5); input images for a 2-image try-on add roughly $0.01–0.02. Batch = 50% off.
- **quality**: No try-on-specific controls or benchmarks; general editors tend to drift faces/body proportions; strong on prompt adherence. Not evaluated in the ionio test.
- **latency**: ~10–40 s for high quality (not officially published).
- **license**: Commercial use allowed.
- **privacy**: API data not used for training by default; abuse-monitoring logs up to 30 days; /v1/images/generations and /edits are ZDR-eligible (gpt-image-2.5, 2, 1.5, 1-mini) with CSAM-scan exception. No EU-only processing guarantee by default (EU data residency exists for some enterprise projects).
- **verdict**: Serviceable creative fallback with good privacy terms, but offers nothing over Nano Banana via Vertex for this use case and has weaker identity preservation evidence. Keep as an optional adapter, not v1.
- **sources**: https://developers.openai.com/api/docs/pricing · https://developers.openai.com/api/docs/guides/your-data · https://www.aifreeapi.com/en/posts/gpt-image-1-5-pricing-api · https://costgoat.com/pricing/openai-images

### FASHN.ai — tryon-v1.6, tryon-max, and open-weight FASHN VTON 1.5

- **vendor**: FASHN AI
- **kind**: Dedicated try-on API (+ Apache-2.0 self-hostable model)
- **inputs**: tryon-v1.6: model_image + garment_image, category auto|tops|bottoms|one-pieces, garment_photo_type auto|flat-lay|model (flat-lay covers ghost-mannequin), mode performance|balanced|quality, num_samples 1–4, segmentation_free, moderation_level, seed. tryon-max: model_image + product_image + optional prompt (e.g. 'tuck in shirt', fabric/size words), resolution 1k|2k|4k, generation_mode fast|balanced|quality, num_images 1–4; supports clothing, shoes, hats, jewelry, bags. Raises PoseError if no body pose detected. No structured metadata — prompt only on tryon-max.
- **outputs**: v1.6: 864×1296 processing resolution, PNG/JPEG via CDN URL (3-day) or base64 (60 min). tryon-max: up to 4K (~16 MP).
- **apiAvailability**: GA, pay-as-you-go, async (prediction id + poll). Docs: https://docs.fashn.ai/api-reference/tryon-v1-6 and /tryon-max. Also on fal (fal-ai/fashn/tryon/v1.6 $0.075). Rate limit 50 req/min, 6 concurrent by default. Open weights: https://huggingface.co/fashn-ai/fashn-vton-1.5 (Apache-2.0, 972M params, ~2 GB, ~8 GB VRAM, ~5 s on H100).
- **pricing**: $0.075/credit, min $7.50; v1.6 = 1 credit/image; tryon-max = 1–5 credits (fast 1k=1, balanced 2k=3, quality 4k=5); monthly plans reduce per-credit cost (third-party: ~$0.049 at $1,249/mo tier); failed requests free.
- **quality**: ionio benchmark: best on one-pieces and sequin/silk fabrics; all 160 succeeded once category 'one-pieces' (not 'dresses') was used; fal review: floral midi dress print continuous, pose/proportions held. Weakness: exotic garment types (saree → short dress), occasional opaque failures/cold starts; a small dev test found Nano Banana Pro better on hard garments. Explicit flat-lay flag and one-piece category are exactly what the merchant payload supplies.
- **latency**: v1.6: ~5 s (performance), ~8 s (balanced), ~12–17 s (quality). tryon-max: ~10 s (fast 1k), ~25 s (balanced 2k), ~55 s (quality 4k).
- **license**: Hosted API: commercial. FASHN VTON 1.5 weights/code: Apache-2.0 (commercial OK) — the only production-grade commercially licensed open VTON model found.
- **privacy**: Outputs deleted after 3 days; base64 inputs deleted when the request completes; customer content not used for training unless opt-in; DPA available. Processing region not stated (ask). Self-hosting removes the vendor entirely.
- **verdict**: PRIMARY for v1: purpose-built, understands flat-lays and one-pieces, cheap, fast, best privacy terms among dedicated hosted engines, and an Apache-2.0 open model in the same lineage gives a VPS self-host exit path behind the same adapter.
- **sources**: https://docs.fashn.ai/api-reference/tryon-v1-6 · https://docs.fashn.ai/api-reference/tryon-max · https://fashn.ai/products/api · https://huggingface.co/fashn-ai/fashn-vton-1.5 · https://github.com/fashn-AI/fashn-vton-1.5 · https://fashn.ai/blog/comparing-the-top-4-open-source-virtual-try-on-viton-models · https://www.ionio.ai/blog/vton · https://fal.ai/learn/tools/best-virtual-try-on-apis-2026

### fal.ai hosted try-on endpoints (FLUX VTO Pro, image-apps-v2, Leffa, cat-vton, flux-2-lora-gallery, Lucy 2.1 VTON realtime)

- **vendor**: fal.ai (models by BFL, Leffa authors, CatVTON authors, Decart, fal)
- **kind**: Hosted inference marketplace (multiple try-on models)
- **inputs**: All take person image + garment image; FLUX VTO Pro adds a required prompt and supports a 2×2 multi-garment grid; Leffa has garment_type upper|lower|dress; cat-vton has upper|lower|overall|inner|outer; image-apps-v2 has preserve_pose; Lucy VTON takes a live/recorded video + garment reference.
- **outputs**: FLUX VTO: keeps person aspect, person ≤2 MP; image-apps-v2 up to 4K; Lucy 720p video.
- **apiAvailability**: All GA on fal with queue/sync modes. Endpoints: fal-ai/flux-pro/v1/vto, fal-ai/image-apps-v2/virtual-try-on, fal-ai/leffa/virtual-tryon, fal-ai/cat-vton, fal-ai/flux-2-lora-gallery/virtual-tryon, decart/lucy2-vton/realtime. (fal-ai/idm-vton: no live price found.)
- **pricing**: FLUX VTO Pro $0.0375 first input MP + $0.005/extra MP + $0.005/output MP; image-apps-v2 $0.04/image; Leffa $0.10; cat-vton $0.00125/compute-second (≈$0.01–0.02); flux-2-lora $0.021/MP; Lucy VTON $0.02/s of video.
- **quality**: fal's own 2026 review: FLUX VTO transferred dress colour/cut well, prompt-steerable; Leffa gave clean full-length dress placement but altered the model's face; cat-vton kept dress print but is research-only; image-apps-v2 simplest, no prompt; Lucy is live/video but not evaluated on dresses.
- **latency**: FLUX VTO <4 s (BFL claim); others 5–20 s; Lucy realtime over WebRTC.
- **license**: FLUX VTO/commercial; Leffa MIT ('commercial-cleared' per fal); cat-vton CC BY-NC-SA (research only); image-apps-v2 not stated.
- **privacy**: fal privacy policy has no explicit no-training statement for API inputs; enterprise customers governed by DPA; generated media URLs public for a retention window (third-party: ≥7 days unless overridden). Weaker than FASHN/Vertex/OpenAI/xAI on paper — negotiate DPA before sending user-derived images.
- **verdict**: Useful as a multi-engine playground and as a fallback route (FLUX VTO Pro is the most interesting: multi-garment, prompt, EU endpoint available direct from BFL). Avoid cat-vton/IDM-VTON for production (non-commercial).
- **sources**: https://fal.ai/learn/tools/best-virtual-try-on-apis-2026 · https://fal.ai/models/fal-ai/leffa/virtual-tryon · https://fal.ai/models/fal-ai/cat-vton · https://fal.ai/models/fal-ai/image-apps-v2/virtual-try-on · https://fal.ai/privacy · https://docs.platform.decart.ai/models/realtime/virtual-try-on

### Black Forest Labs FLUX VTO (flux-tools/vto-v2)

- **vendor**: Black Forest Labs
- **kind**: Dedicated try-on API
- **inputs**: person image + garment image (packshot on plain background best) + REQUIRED prompt ('The person of image 1, maintaining exactly their face and pose, wearing the {garment} of image 2'); multi-garment via 2×2 grid; seed, safety_tolerance 0–5.
- **outputs**: Up to 4 MP (v2), follows person image resolution; jpeg/png/webp; signed URLs valid 10 min.
- **apiAvailability**: GA since 2026-05-28. https://api.bfl.ai/v1/flux-tools/vto-v2 with EU (api.eu.bfl.ai) and US regional endpoints; docs https://docs.bfl.ai/flux_tools/flux_vto. Also on fal and Runware.
- **pricing**: Not published on bfl.ai pricing page at time of check (calculator lists FLUX VTO without a rate); fal resale ≈ $0.04–0.05 per 1 MP image.
- **quality**: Vendor: swaps up to four garments in <4 s preserving logos/prints/stitching; fal review: dress colour/cut transferred well, prompt steers how garment is worn. No independent dress/lower-body benchmark.
- **latency**: <4 s claimed; regional endpoint saves ~1 s.
- **license**: Commercial; swimwear/lingerie unsupported by default; user must hold likeness rights.
- **privacy**: EU regional endpoint is a real GDPR advantage; training/retention terms not on the docs page — check BFL Trust & Security page/DPA.
- **verdict**: Strongest contender for fallback #1 alongside Vertex: EU endpoint, prompt control (fabric words), multi-garment outfits, fast. Needs own price confirmation and an in-house dress/lower-body test.
- **sources**: https://docs.bfl.ai/flux_tools/flux_vto · https://bfl.ai/blog/flux-vto-virtual-try-on-at-catalog-scale · https://bfl.ai/pricing · https://fal.ai/learn/tools/best-virtual-try-on-apis-2026

### Replicate — cuuupid/idm-vton (and other community VTON models)

- **vendor**: Replicate (model by KAIST)
- **kind**: Hosted open-source inference
- **inputs**: human image + garment image + garment description text + category (upper/lower/dresses).
- **outputs**: Single image.
- **apiAvailability**: GA; https://replicate.com/cuuupid/idm-vton; runs on A100 80 GB.
- **pricing**: ≈$0.024/run (~41 runs per $1), varies with inputs.
- **quality**: In FASHN's 2025 head-to-head IDM-VTON had the best fabric texture/colour among open models and handles dresses; weaker than CatVTON on baggy jeans; SDXL-based, ~2024 quality.
- **latency**: ~17–18 s per prediction.
- **license**: CC BY-NC-SA 4.0 — NON-COMMERCIAL. Same for OOTDiffusion, CatVTON, FitDiT.
- **privacy**: Replicate deletes API prediction inputs/outputs/logs after 1 hour by default; no explicit training statement found (check ToS/DPA).
- **verdict**: Prototype/eval only. Cannot ship commercially; the handoff's original fallback ('hosted IDM-VTON or OOTDiffusion') must be replaced by FASHN/Vertex/FLUX VTO.
- **sources**: https://replicate.com/cuuupid/idm-vton · https://replicate.com/docs/topics/predictions/data-retention.md · https://github.com/XQ0820/open-virtual-try-on-models · https://fashn.ai/blog/comparing-the-top-4-open-source-virtual-try-on-viton-models

### Open-source self-hostable try-on models (for the founder's VPS)

- **vendor**: Various (FASHN, Leffa/ByteDance, Alibaba OmniTry, Qwen, research groups)
- **kind**: Self-hosted models
- **inputs**: person image + garment image; Leffa and CatVTON take garment_type; OmniTry is mask-free and handles accessories; Qwen-Image-Edit + try-on LoRA is prompt-driven.
- **outputs**: Typically 768×1024 to 1024×768; FASHN 1.5 similar; Qwen-Image-Edit up to ~1 MP+.
- **apiAvailability**: Weights on Hugging Face; wrap in your own FastAPI/Docker service. GPU required — a CPU-only VPS is not viable (FASHN model card: 'dedicated GPU recommended').
- **pricing**: Infra only. Commercially usable: FASHN VTON 1.5 (~8 GB VRAM, ~5 s on H100, runs on RTX 30xx/40xx) ⇒ an RTX 4090/L4 VPS at ~€0.3–0.8/h amortises to <$0.01/image at volume. Leffa (MIT; ~6 s on A100). OmniTry needs ≥28 GB VRAM and sits on FLUX.1-Fill-dev (non-commercial base). Qwen-Image-Edit-2509 (Apache) is 20B params ⇒ 40+ GB class GPU. Non-commercial (do not ship): IDM-VTON, OOTDiffusion, CatVTON (<8 GB), FitDiT, Voost, MagicTryOn (video), CatV2TON (no license), Mobile-VTON (CVPR 2026 on-device, CC BY-NC-SA).
- **quality**: FASHN 1.5 is 'production-grade' per vendor and the only Apache model tested at scale; Leffa clean dress placement but face drift; open video models (ViViD Apache code, CatV2TON, MagicTryOn) are research quality, 24+ GB VRAM.
- **latency**: 5–15 s per image on a single consumer/datacentre GPU; batch throughput ~4–10 img/min per GPU.
- **license**: See above — only FASHN VTON 1.5 (Apache-2.0) and Leffa (MIT) are safely commercial.
- **privacy**: Best possible: images never leave founder-controlled infrastructure; Docker-hostable; no third-party retention.
- **verdict**: FASHN VTON 1.5 on a GPU VPS is the recommended v1.5/v2 'privacy tier' and cost floor; implement it behind the same adapter as the hosted FASHN API. Needs a GPU host (the founder's current VPS plan must include one or rent a GPU box).
- **sources**: https://github.com/XQ0820/open-virtual-try-on-models · https://huggingface.co/fashn-ai/fashn-vton-1.5 · https://fashn.ai/blog/comparing-the-top-4-open-source-virtual-try-on-viton-models · https://arxiv.org/abs/2603.00947 · https://huggingface.co/AndrewChoyCS/Mobile-VTON · https://arxiv.org/html/2508.13632v1

### Alibaba Cloud Model Studio — OutfitAnyone / aitryon-plus (image) and Wan 2.6/2.7 i2v (video)

- **vendor**: Alibaba Cloud
- **kind**: Dedicated try-on API + i2v animator
- **inputs**: aitryon(-plus): frontal full-body portrait + garment flat-lay photos (top and/or bottom garment URLs); aitryon-parsing-v1 for segmentation; aitryon-refiner for upscaling. Wan i2v: start image + prompt (+ audio).
- **outputs**: Try-on image (Plus improves texture/logo reconstruction); Wan: 720p/1080p clips.
- **apiAvailability**: GA on Model Studio (international region Singapore). Docs: https://www.alibabacloud.com/help/en/model-studio/outfitanyone, /aitryon-plus-api, /wan2-7-i2v. Try-on rate limits 10 RPS / 5 concurrent.
- **pricing**: aitryon CNY 0.20/img; aitryon-plus ≈ $0.0717/img (400 free images); refiner CNY 0.225–0.30; parsing CNY 0.004. Wan 2.6/2.7 i2v $0.10/s (720p), $0.15/s (1080p); Wan 2.6 Flash reportedly $0.05/s.
- **quality**: No independent benchmark found; the top+bottom two-garment input is unique and maps well to 'full outfit' renders. Wan videos: good motion, no try-on-specific evidence.
- **latency**: Async tasks, ~10–30 s (not published).
- **license**: Commercial.
- **privacy**: International data processed in Singapore; retention/training terms per Alibaba Cloud Model Studio terms (not verified here); no EU residency.
- **verdict**: Interesting secondary fallback (two-garment outfits, cheap), but non-EU residency and thin independent evidence keep it out of v1.
- **sources**: https://help.aliyun.com/en/model-studio/aitryon-plus · https://help.aliyun.com/en/model-studio/billing-for-outfitanyone · https://www.alibabacloud.com/help/en/model-studio/outfitanyone · https://www.alibabacloud.com/help/en/model-studio/wan2-7-i2v · https://www.alibabacloud.com/help/en/model-studio/wan2-6-i2v

### Runway (Gen-4.5, Gen-4 Turbo, Aleph 2.0) and Luma (Ray3.2, Uni-1.1)

- **vendor**: Runway; Luma AI
- **kind**: General image-to-video / video-edit APIs
- **inputs**: Image/text → video; Runway Aleph and Luma V2V edit existing video (pose/depth/face conditioning on Luma); Luma Uni-1.1 image edit accepts up to 8 reference images.
- **outputs**: Runway 720p–1080p clips; Luma 540p/720p/1080p, 5 or 10 s.
- **apiAvailability**: Both GA (docs.dev.runwayml.com; lumalabs.ai/api).
- **pricing**: Runway: $0.01/credit; Gen-4.5 12 credits/s ($0.12/s), Gen-4 Turbo 5 credits/s ($0.05/s), Aleph 2.0 28 credits/s. Luma Ray3.2 I2V: $0.15 / $0.30 / $1.20 per 5 s at 540p/720p/1080p; V2V 5 s $0.72–2.16; Uni-1.1 image edit $0.0434 (Max $0.103).
- **quality**: Neither has a try-on feature or garment-physics evidence; Luma V2V 'handles the SKU' marketing hints at product swaps but rejects image refs on video edits.
- **latency**: Async, 1–3 min.
- **license**: Commercial.
- **privacy**: Not verified in this pass; no no-training statement captured.
- **verdict**: No advantage over Grok/Kling/Wan for the hero clip; Luma V2V could matter later for 'animate my scan video' but needs a privacy review. Not for v1.
- **sources**: https://lumalabs.ai/api/pricing · https://www.activepieces.com/blog/runway-api-pricing-per-second-for-every-video-model · https://unifically.com/blogs/runway-gen-4

### Video try-on specialists: Decart Lucy VTON (3.6), Segmind Video Tryon, research (MagicTryOn, CatV2TON, ViViD, Fashion-VDM, iTryOn)

- **vendor**: Decart; Segmind; academic
- **kind**: Video virtual try-on (garment onto moving person)
- **inputs**: Lucy: live webcam/WebRTC stream or ≤200 MB MP4 + prompt + optional garment reference (≥512 px, plain background). Segmind: reference image + person video, ≤50 s.
- **outputs**: Lucy 720p (1280×720 / 720×1280); Segmind unspecified.
- **apiAvailability**: Lucy GA (wss://api.decart.ai/v1/stream; POST /v1/jobs/lucy-vton-latest; SDKs incl. Android/Swift); Segmind serverless API; research code only on GitHub.
- **pricing**: Lucy $0.02/s via fal (fast mode 2×); Segmind unpublished; research = GPU cost.
- **quality**: Not evaluated on dresses/lower body by any source; research SOTA (Fashion-VDM, MagicTryOn) still shows garment flicker; Lucy is impressive for live but prompt-steered.
- **latency**: Lucy realtime; Segmind ~2 min for a clip.
- **license**: Lucy/Segmind commercial; MagicTryOn CC BY-NC-SA; CatV2TON no license; ViViD Apache code with unverified weights.
- **privacy**: Requires streaming the user's raw video to the vendor — directly conflicts with the handoff's non-negotiable. Decart docs have no data-use statement.
- **verdict**: Do not use on raw user video. Could later animate a rendered avatar video. Not for v1.
- **sources**: https://docs.platform.decart.ai/models/realtime/virtual-try-on · https://www.segmind.com/models/video-tryon · https://arxiv.org/html/2505.21325v1 · https://icml.cc/virtual/2026/poster/65275 · https://github.com/XQ0820/open-virtual-try-on-models

## Open questions

- Does the founder's VPS have (or can it rent) an NVIDIA GPU with ≥8 GB VRAM? Without it the self-hosted FASHN VTON 1.5 tier is impossible and v1 must be hosted-only.
- Vertex AI Virtual Try-On: supported garment categories (dresses, bottoms, shoes?) and whether it is served from EU regions — docs do not say; needs a quota/region check in the GCP console and an in-house dress/lower-body test.
- FASHN: processing region (EU?) and DPA terms for sending avatar renders; whether Tier II/III monthly pricing (~$0.049/img) applies at the founder's expected volume.
- Grok Imagine video pricing conflict: official pricing page shows flat $0.080/s for grok-imagine-video-1.5 while a search summary of the same page reported 480p/720p/1080p tiers ($0.08/$0.14/$0.25) and a $0.01 input-image charge — confirm in the console before budgeting; also confirm image/video are covered by the 30-day/no-training statements (FAQ says 'all API requests and responses').
- Kling: official API (not fal) training/retention terms for uploaded person images; fal's Kolors try-on endpoint is already deprecated — is there a v2 try-on model on the official platform?
- BFL FLUX VTO v2 direct pricing and data-use terms (not on the pricing page); it is the only dedicated try-on API with an EU endpoint and should be tested.
- OpenAI gpt-image-1.5 / 1-mini retirement date (third parties say 2026-12-01) and whether gpt-image-2.5 is worth testing as the creative fallback instead of Nano Banana.
- Legal: a rendered avatar still contains the user's face — confirm with counsel whether the 'generic face + local re-composite' variant is required for the default tier under GDPR/EU AI Act, and whether SynthID/C2PA-watermarked outputs (Vertex, Nano Banana) are acceptable for the in-app mirror.
- No independent benchmark covers lower-body garments (trousers/skirts) across these engines; the planned 50-SKU bake-off must include them and measure proportion drift against the user's measurements.
- Video try-on on the user's own 360° scan video is excluded by the privacy rule; decide whether a future 'animate the avatar' feature (Grok/Kling i2v from the try-on still) is enough for the shoppable-video and shared-Rooms use cases.

## Fact-check corrections

**Overall trust:** High on the core recommendation and most numbers. Verified against primary sources: FASHN v1.6/tryon-max parameters, credits, latencies, rate limits and privacy terms; FASHN VTON 1.5 Apache-2.0 / 972M / ~8 GB / ~5 s H100; Vertex virtual-try-on-001 GA (23 Jan 2026, preview discontinued) at $0.06/image with C2PA; Nano Banana per-image prices, 14-reference limits, free-tier training and gemini-2.5-flash-image shutdown 2027-03-15; Veo 3.1 Gemini-API preview shutdown 2026-10-22 and gemini-omni-1.1-flash ≈$0.10/s; Vertex Veo 3.1 $0.40/s (720p/1080p) and $0.60/s 4K; xAI image/video model names, $0.04 and $0.08/s, 5 source images, 14 references, 15 s, 30-day retention, no-training, team-wide ZDR with own upload_url; OpenAI token prices, ZDR eligibility for the listed image models, 30-day abuse logs, EU residency conditions, and the 2026-12-01 retirement of gpt-image-1.5/1-mini; fal Kolors v1.5 deprecated at $0.07; fal prices for FLUX VTO Pro, image-apps-v2, Leffa, cat-vton, flux-2-lora, Lucy; Kling 3.0 fal prices; Runway Gen-4.5/Gen-4 Turbo/Aleph credits; Luma Ray3.2 and Uni-1.1 prices; Replicate idm-vton ~$0.024, non-commercial, 1-hour retention; Mobile-VTON CVPR 2026 CC BY-NC-SA with no mobile runtime; BFL VTO v2 EU/US endpoints and required prompt; the ionio 160-pair benchmark findings; Segmind video-tryon ≤50 s with no published price. Weak spots: the FASHN volume-tier claim is stale (tiers closed to new customers), Alibaba aitryon-plus availability outside China is unconfirmed and its cited docs no longer exist, Leffa's 'safely commercial' label ignores its OpenRAIL base weights, Lucy batch pricing is 2× what is stated, the Grok 'pricing conflict' was a preview-vs-GA mix-up, and the video tier is a generation behind (Kling 4.0/O3, Seedance 2.5, Hailuo H3 missing). None of the errors changes the PRIMARY=FASHN / FALLBACK=Vertex VTO conclusion; the Vertex EU-region question is in fact resolved in Vertex's favour.

- **Claim:** FASHN: "monthly plans reduce per-credit cost (third-party: ~$0.049 at $1,249/mo tier)" and open question about whether Tier II/III pricing applies at the founder's volume
  - **Problem:** Official FASHN pricing lists only On-Demand at $0.075/credit (min $7.50 / 100 credits). The FASHN help page states Tier I/II/III API plans "are no longer available to new customers" (only existing subscribers keep tier top-up rates such as $0.0488). The $1,249/mo figure does not appear anywhere official; the only tier prices found were annual ($2,490/yr Tier II, $12,490/yr Tier III) and those are closed to new customers.
  - **Correction:** Budget at $0.075/image flat; no volume tier is available to a new customer. Drop the open question or re-phrase it as 'negotiate an enterprise rate'.
  - Source: https://fashn.ai/pricing ; https://help.fashn.ai/plans-and-pricing/api-pricing ; https://fashn.ai/products/api
- **Claim:** Open-source models output "typically 768×1024 to 1024×768; FASHN 1.5 similar"
  - **Problem:** The FASHN VTON 1.5 model card states output resolution is 576×864 (inputs processed at that size). That is noticeably lower than the hosted v1.6 (864×1296 processing) and matters for a 'hero' render.
  - **Correction:** FASHN VTON 1.5 self-hosted = 576×864 output; plan an upscaler (or use hosted tryon-max) for shareable images.
  - Source: https://huggingface.co/fashn-ai/fashn-vton-1.5
- **Claim:** Vertex Virtual Try-On: "PNG/JPEG ≤10 MB", "50 online requests/min/region", and open question 'whether it is served from EU regions — docs do not say'
  - **Problem:** The Gemini Enterprise Agent Platform model page for virtual-try-on-001 says max file size for inline data/console uploads is 7 MB (the older Vertex page says 10 MB — the two docs conflict), does not state a 50 RPM quota (the quotas page has no virtual-try-on row at all; 'Fixed quota: Not supported'), and DOES list supported regions, including Europe: europe-west1, europe-west4, europe-west8, europe-west9, europe-southwest1, europe-north1 (plus US, Canada, asia-northeast1, asia-southeast1, me-central1). Max 2 input images per prompt, up to 4 outputs, C2PA supported.
  - **Correction:** EU residency for virtual-try-on-001 is documented (six EU regions) — the open question is answered. Treat the 50 RPM figure as unverified and size uploads to ≤7 MB.
  - Source: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/vto/virtual-try-on-001 ; https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/virtual-try-on-001 ; https://docs.cloud.google.com/vertex-ai/generative-ai/docs/quotas
- **Claim:** Grok Imagine video pricing conflict: official $0.080/s vs. a search summary reporting 480p/720p/1080p tiers ($0.08/$0.14/$0.25) plus $0.01 per input image
  - **Problem:** The tiered numbers ($0.08/s 480p, $0.14/s 720p, +$0.01 input image) are the pricing of the earlier grok-imagine-video-1.5-preview model, not the GA model. The current official pricing page and the grok-imagine-video-1.5 model page both list a single rate: 'Output: $0.080 per second', with no per-input-image charge and no resolution tiers. Resellers (Runway: 10/16/29 credits/s by resolution + 1 credit per image reference; Segmind) do add resolution tiers, but those are reseller prices. The model page also states availability only in us-east-1, us-west-2, us-saltlake-2 (US processing), and the regions page says image/video APIs are not served by the US endpoint and the global endpoint 'may route requests between regions'.
  - **Correction:** Use $0.080/s flat (direct xAI). Remove the open question; note that resellers price by resolution and that video processing is US-only with no EU guarantee.
  - Source: https://docs.x.ai/developers/pricing ; https://docs.x.ai/developers/models/grok-imagine-video-1.5 ; https://docs.x.ai/developers/regions ; https://docs.dev.runwayml.com/guides/pricing/ ; https://www.imagine.art/blogs/grok-imagine-video-1-5-pricing
- **Claim:** Leffa (MIT) is one of only two models that are 'safely commercial'
  - **Problem:** Leffa's own code and weights are MIT, but the Hugging Face repo bundles the base diffusion weights it runs on: 'stable-diffusion-inpainting' and 'stable-diffusion-xl-1.0-inpainting-0.1' (CreativeML OpenRAIL-M / OpenRAIL++-M licences with use-based restrictions, not MIT). The 20.9 GB pose_transfer.pth and 7.2 GB virtual_tryon.pth checkpoints also imply far more than the '~6 s on A100' footnote suggests (a developer write-up puts VRAM at 20–24 GB).
  - **Correction:** Leffa is 'commercial-permissive with OpenRAIL use restrictions', not plain MIT end-to-end, and needs a 24 GB-class GPU; FASHN VTON 1.5 is the only clean Apache-2.0 option.
  - Source: https://huggingface.co/franciszzj/Leffa/tree/main ; https://huggingface.co/franciszzj/Leffa ; https://github.com/XQ0820/open-virtual-try-on-models
- **Claim:** Decart Lucy VTON: '$0.02/s via fal (fast mode 2×)' for 'realtime/batch'
  - **Problem:** Decart's own pricing page lists realtime lucy-vton-3.6/3.5 at $0.02/s (fast mode $0.04/s) but batch video (720p MP4) at $0.04/s. The report applies the realtime rate to both modes.
  - **Correction:** Realtime $0.02/s; batch $0.04/s; fast realtime $0.04/s. Decart docs still contain no data-retention statement.
  - Source: https://docs.platform.decart.ai/getting-started/pricing ; https://docs.platform.decart.ai/models/realtime/virtual-try-on
- **Claim:** Alibaba OutfitAnyone/aitryon-plus: 'GA on Model Studio (international region Singapore). Docs: https://www.alibabacloud.com/help/en/model-studio/aitryon-plus-api', '≈ $0.0717/img (400 free images)'
  - **Problem:** The cited international URLs (alibabacloud.com/help/en/model-studio/aitryon-plus-api, /outfitanyone, /billing-for-outfitanyone) now resolve to a generic model directory that lists no try-on model at all (only qwen-image-3.0-pro, wan2.7-image-pro, wan3.0-video, happyhorse-1.1-*). The only live pricing is on the China-site (help.aliyun.com): aitryon CNY 0.20/img, aitryon-plus CNY 0.50/img (~$0.07), 400 free images, 10 RPS / 5 concurrent. No USD/Singapore price for aitryon-plus was found. The '$0.0717' is a currency conversion of the CNY price, not a published international rate.
  - **Correction:** Treat aitryon-plus as 'China-region Model Studio, international availability unconfirmed'. Wan 2.7 i2v international pricing ($0.10/s 720p, $0.15/s 1080p, Singapore) does check out, and wan3.0-video is now listed as the newer model.
  - Source: https://www.alibabacloud.com/help/en/model-studio/aitryon-plus-api ; https://www.alibabacloud.com/help/en/model-studio/billing-for-outfitanyone ; https://help.aliyun.com/en/model-studio/billing-for-outfitanyone ; https://www.alibabacloud.com/help/en/model-studio/wan2-7-i2v
- **Claim:** Kling 3.0 i2v via fal is the strongest i2v alternate for the hero clip ("Kling 3.0 i2v: $0.084/s …")
  - **Problem:** Kling 3.0 pricing on fal checks out, but Kling 4.0 is already generally available via API (fal: 3–30 s clips at 720p/1080p; Runway: 12.56–18.8 credits/s; third-party quotes of fal at $0.157/s 720p and $0.235/s 1080p, audio included) and Kling O3 also exists. The report presents 3.0 as the current generation.
  - **Correction:** List Kling 4.0 (and O3) as the current Kling video models; keep 3.0 Standard as the cheap option ($0.084/s) and note 4.0 is ~2× the price.
  - Source: https://fal.ai/explore/image-to-video-apis ; https://docs.dev.runwayml.com/guides/pricing/ ; https://aireiter.com/blog/kling-4-0-api-pricing-fal-cost-vs-seedance-vidu ; https://www.llmreference.com/model/kling-4.0/fal-api
- **Claim:** BFL FLUX VTO pricing: 'Not published on bfl.ai pricing page (calculator lists FLUX VTO without a rate)'
  - **Problem:** The bfl.ai pricing calculator does list FLUX VTO and shows a single '$0.048 per image' rate, but without clearly attributing it to a named model or resolution, so it cannot be confirmed as the VTO v2 price. The docs page also does not state the '<4 s' latency; that figure and the 'up to four garments' and 'swimwear/lingerie not supported under the default policy' statements come from the launch blog (28 May 2026), which says 'available publicly now' rather than 'GA'.
  - **Correction:** Say: 'bfl.ai calculator shows ~$0.048/image for FLUX VTO (unconfirmed per-model); fal resale $0.0375 first MP + $0.005/MP'. Keep latency/garment claims but cite the blog, not the docs.
  - Source: https://bfl.ai/pricing ; https://docs.bfl.ai/flux_tools/flux_vto ; https://bfl.ai/blog/flux-vto-virtual-try-on-at-catalog-scale

### Candidates the report missed

- Amazon Nova Canvas virtual try-on (amazon.nova-canvas-v1:0; GARMENT mask with UPPER_BODY/LOWER_BODY/FULL_BODY/FOOTWEAR classes, eu-west-1 region, ~$0.04–0.08/img) — the only hyperscaler try-on with an EU region besides Google, but it reached Bedrock end-of-life on 2026-09-30 with no announced try-on successor (Nova 2 Omni is preview, no try-on feature documented). Worth a sentence so nobody re-discovers it: https://aws.amazon.com/blogs/aws/amazon-nova-canvas-update-virtual-try-on-and-style-options-now-available ; https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle-legacy.html
- Oxygen-TryOn (JD.com, arXiv 2607.21694, July 2026) — an 'any-item', multi-item, mask-free try-on foundation model (MLLM + MMDiT, built on JoyAI-Image-Edit) claiming SOTA over GPT-Image-2 and FLUX.2; weights are on Hugging Face (LYAWWH/Oxygen-TryOn, gated — returned 401) and the GitHub repo was 404 at check time, so license and VRAM are unknown. Should be on the self-host watch-list: https://arxiv.org/pdf/2607.21694 ; https://huggingface.co/LYAWWH/Oxygen-TryOn
- Kling 4.0 and Kling O3 image-to-video (fal, Runway, official platform) — current Kling generation, 3–30 s, 720p/1080p; replaces the report's 'Kling 3.0' as the cloth-physics benchmark: https://fal.ai/explore/image-to-video-apis ; https://docs.dev.runwayml.com/guides/pricing/
- ByteDance Seedream 5.0 Pro Edit — multi-reference image editor (up to 10 reference images, ~$0.045–0.075/image, 2K) that competes directly with Nano Banana / gpt-image for the 'creative fallback' tier and is hosted on fal/Runway: https://docs.dev.runwayml.com/guides/pricing/ ; https://www.atlascloud.ai/blog/ai-updates/seedream-5-0-pro-price
- ByteDance Seedance 2.0/2.5 and MiniMax Hailuo H3 image-to-video — the models most often cited for cloth/physics realism alongside Kling; Seedance 2.5 does up to 30 s at 480p–1080p (fal Seedance 2.0 Fast $0.2419/s 720p; Hailuo H3 ~$0.1625/s 2K via Segmind). Not evaluated in the report's video tier: https://fal.ai/explore/image-to-video-apis ; https://blog.segmind.com/minimax-h3-vs-seedance-2-5-api-pricing-and-8-real-clips/
- Perfect Corp YouCam 'AI Clothes Try-on' API (enterprise fashion VTO vendor; pay-as-you-go units, free trial ~40 units ≈ 20 try-ons; company under a pending acquisition closing Q4 2026) — the main enterprise incumbent the report omits: https://www.perfectcorp.com/business/news/WeAreDevelopers ; https://www.businesswire.com/news/home/20260115898437/en/Perfect
- Runway API as a single-contract aggregator — now resells grok_imagine_1_5 (with resolution tiers), kling 4, veo3.1, seedance 2.5, gemini_omni_flash, nano_banana_2.1, gemini_image3_pro and gpt_image_2.5 at $0.01/credit, which could simplify DPA/billing for a multi-engine router: https://docs.dev.runwayml.com/guides/pricing/
- OpenAI Sora 2 / Videos API — explicitly note it is NOT an option: sora-2 and sora-2-pro and the Videos API were shut down on 2026-09-24 with no replacement: https://developers.openai.com/api/docs/deprecations
- OpenAI gpt-image-1 — already shut down 2026-10-23 (report only mentions 1.5/1-mini retiring 2026-12-01, which is confirmed); any integration must target gpt-image-2 or gpt-image-2.5-sunburst/flare: https://developers.openai.com/api/docs/deprecations
- Alibaba Model Studio wan3.0-video and happyhorse-1.1-i2v — the international catalogue now lists these as the current video models above Wan 2.7: https://www.alibabacloud.com/help/en/model-studio/aitryon-plus-api (resolves to the model directory)
- TryOn API (tryonapi.com) — a router exposing 14 try-on / gen-AI models across 7 providers behind one endpoint; low priority but relevant to the proposed TryOnRouter design: https://innvesti.com/reports/best-virtual-try-on-apis-multi-brand-retailers-2026/
