# Curtain Fit Engine — Implementation Handoff

Nov 5, 2026 · @Elmer

## TL;DR

We build our own garment engine: every product a merchant publishes is turned, once, from photos into a video and from the video into a 3D garment that is anchored to our body measurement points. The shopper's device puts that garment on a personal avatar in the right size, interactively, and the fit engine that already exists decides how tight or loose it sits.

- **Why our own engine:** AI try-on providers return one flat picture and ignore size. A size S and a size L look the same. Our engine makes size and fabric visible, which is the whole point of the product.
- **Why per product:** the expensive work runs once per product per shop on the server. After that, every shopper fits it on their own device at almost no cost, so cost scales with the catalogue and stays flat with traffic.
- **Why video in the middle:** a generated turntable and motion video of the garment on our own known mannequin is how the engine separates the garment from the mannequin and how it finds the measurement points. We control the mannequin, the camera path and the motion, so the geometry is known.
- **What the merchant owns:** the back view and the details. The merchant supplies front, back and detail photos and approves the result. The engine never has to invent a side of the garment.
- **End state:** a shopper opens "Try it on", sees their own avatar wearing the garment, rotates it, switches between S, M and L and sees the difference, and gets the size advice from the same numbers that drive the picture.

This handoff starts from branch `claude/takeover-foundation` as described in the November build handoff. Phase 0 is a 3–4 week spike on 5 products; the full engine is 4–6 months after a successful spike.

## Starting point

Most of what the engine needs on the edges already exists in the repo; what is missing is the middle: the garment pipeline and the 3D fitting on the device.

| Existing piece | Path | Role in the engine | Change needed |
| --- | --- | --- | --- |
| Garment payload v1, completeness score | `packages/schema` | Input contract for the pipeline | Add a media block with required views (v2), asset types, pipeline status |
| Fit engine with per-point fit and render gaps | `packages/fit-engine` | Source of truth for size and for how tight or loose each anchor sits | Expose per-anchor gaps in the anchor vocabulary below; no change to the maths |
| 12 body cross-sections from the scan, prior and fusion | `apps/web/src/features/capture` | The shopper's anchors | Name the 12 rings with the shared anchor ids; output a body shape for the avatar |
| Product sync, meta box, Shopify admin page | `packages/shopify-app`, `packages/woocommerce-plugin` | Where the merchant supplies photos and approves | Photo role picker (front, back, detail), approval view |
| Merchant console | `apps/web` `/merchant` | Pipeline status, preview, approval, anchor correction | New Assets section |
| Jobs on pg-boss | `apps/api` | Orchestrates pipeline runs | New job types and a GPU worker callback |
| AI provider router, circuit breaker, banned-model lint | `packages/tryon-providers` | Pattern for calling hosted video and 3D models | New provider kinds: video generation, reconstruction |
| Standalone embed and SDK | `apps/web` `/embed`, `packages/sdk` | Where the shopper sees the 3D fitting | New 3D viewer, fallback to the current drawn overlay |
| Infra: one Fastify, one Postgres, Caddy on the VPS | `infra/` | Orchestration and asset serving | GPU work goes to a hosted GPU service; assets need file storage (decision D16) |

Nothing in the current product breaks while the engine is built. A product without an approved asset keeps today's flow: size advice plus the drawn overlay. The pilot path from the November handoff (Shopify API bump, server live, hardening) stays the first priority and is a prerequisite for Phase 3 below.

## Decisions

Five new decisions extend `docs/DECISIONS.md`; D12 revises D4, the others are new. Add them to that file in the same format as D1–D11.

| # | Decision | Reason |
| --- | --- | --- |
| D12 | **Own garment engine.** We build an image → video → 3D pipeline per product and an on-device fitting renderer. Hosted AI try-on (FASHN and others) stays available as an optional photo finish. Revises D4. | Hosted try-on ignores size and fabric; showing size is the product. Per-product processing keeps the cost per shopper near zero. |
| D13 | **The merchant owns the views.** Front and back photos are required for an asset; detail photos are recommended. The merchant approves every asset before shoppers see it. | Generated back views and details are where models invent things. A merchant has the garment in hand; one extra photo removes the largest source of error and gives us a clear line of responsibility. |
| D14 | **Video is the separation and measurement engine.** The pipeline renders the garment on our own canonical mannequin with a known camera path and a known motion. Garment versus mannequin and the measurement points are both derived from that video. | We own the mannequin geometry, so every pixel that is not mannequin is garment, every mannequin ring is a known measurement point, and cloth that moves differently from the body during motion is garment. |
| D15 | **One anchor vocabulary.** Body scan, fit engine, garment asset and renderer all use the same named anchors (the 12 scan rings plus the length points). | The size advice and the picture come from the same numbers, so they can never contradict each other. |
| D16 | **Assets live in file storage behind Caddy, GPU work runs on a hosted GPU service.** The VPS orchestrates and serves; it never runs models. | D9 says no object store; asset bundles of a few MB per product need a home. A disk volume served by Caddy with immutable, versioned paths keeps D9's spirit. GPU rental per job keeps the VPS small. |

D3 (privacy by construction) is unchanged: garment assets are public product data; the shopper's body and photos stay on the device. The optional photo finish follows the open founder decision about sending a shopper photo.

## Architecture

The engine has two halves joined by one asset bundle and one anchor vocabulary: the server builds the garment once per product, the device fits it to the shopper.

Server, once per product (7 steps): merchant photos and data → ingest and validate → image to video on the canonical mannequin → separation → reconstruction → anchoring and grading → drape parameters and QA → versioned bundle, published on merchant approval.

Device, per shopper (6 steps): load the approved bundle → build the avatar from local measurements → morph the garment to the chosen size → place it anchor by anchor using the fit engine's gaps → short cloth drape → render, rotate, switch sizes; only the chosen size and a confidence go back to the API.

The server publishes a versioned bundle per shop and product; the device combines it with the shopper's body, and only the chosen size and a confidence go back to the API.

## Merchant input contract

An asset is only built when the product has a front photo, a back photo, a size chart with a declared base size, and fabric data; everything else improves quality but does not block.

### Photos

| Role | Required | Rules |
| --- | --- | --- |
| `front` | Yes | Garment fully visible, on a plain background, on a hanger, flat-lay or ghost mannequin. Long edge ≥ 1600 px. No model wearing it. |
| `back` | Yes | Same setup and distance as the front. |
| `detail` | Recommended, up to 4 | Collar, closure, print, pocket, hem, fabric close-up. |
| `side` | Optional | Helps for outerwear and wide skirts. |
| `on_model` | Optional | Used only as a reference for drape in QA, never as geometry. |

The merchant picks the role per photo from the product's existing images; no separate upload is needed when the shop already has the shots. Ingest rejects a set with a clear reason per photo (too small, garment cut off, a person in the frame, front and back look identical).

### Garment data

Already in payload v1 and reused as is: category, subcategory, `patternBlock`, size chart (garment or body chart), fabric (`primary`, `weightGsm`, `stretchPct`, `drape`, `opacity`, `sheen`), ease, `lengthCm`, sizing notes. New and required for an asset:

- `baseSize`: the size the photographed sample is in. Grading to other sizes starts from here.
- `sampleMeasurements` (recommended): the merchant measures the photographed sample flat at chest, waist, hip, length and sleeve. This is the strongest calibration signal the pipeline gets and takes 2 minutes with a tape.

### Schema changes in `packages/schema`

1. `GarmentMediaV2`: `{ role, url, width, height, sha256 }[]`, with a zod refinement that requires one `front` and one `back` for `assetEligible`.
2. `GarmentPayload` v2 adds `media`, `baseSize`, `sampleMeasurements?`. v1 stays readable; a v1 product simply has no asset.
3. Completeness score gets a separate "3D ready" track with reasons ("add a back photo", "set the base size").
4. Shopify metafield and Woo meta mappings for the new fields, plus JSON Schema export for the PHP plugin.
5. New types: `AnchorId`, `GarmentAsset`, `AssetStatus`, `SizeGrading` (see Data model).

## Prefill: fabric library and merchant video

The engine starts from three layers of data, in this order of trust: merchant photos and video, a fabric library we prefill ourselves, and AI-generated video to fill what is still missing.

### Fabric library

A versioned library in `packages/schema` (`fabrics.ts`) with the 50 most used fibres and fabrics, so a merchant picks "linen" or "jersey" and the engine already knows how it behaves.

- **12 base fibres:** polyester, cotton, viscose, nylon, elastane, acrylic, wool, linen, lyocell, silk, modal, hemp.
- **38 constructions and finishes:** denim, jersey, flannel, chambray, canvas, corduroy, molton, terry, poplin, seersucker, fleece, velvet, French terry, teddy, faux fur, cashmere, merino, tweed, felt, satin, tulle, lace, chiffon, organza, taffeta, brocade, jacquard, softshell, mesh, neoprene, ripstop, membrane laminate, piqué, gabardine, leather, faux leather, suede, microfibre suede.

Per entry: id, names in English and Dutch, type (fibre or construction), typical weight range in gsm, stretch range, drape, bend stiffness, sheen, opacity, surface texture preset (for normal and roughness maps), and default simulation parameters. Brand names (Lycra, Tencel, Gore-Tex, Alcantara) are aliases that map to a generic entry.

Resolving a product: fibre blend gives the base behaviour, the construction overrides it (cotton jersey stretches, cotton poplin does not), and elastane adds stretch by its share. The values are researched from published textile data in Phase 1, then calibrated against real swatches and merchant video. The library is prefill only: the merchant confirms or corrects, and per-product calibration (below) beats the library.

The merchant does not type this in: the existing mappings in `packages/schema` already read fabric from product titles and descriptions ("100% linnen"); extend them to the library ids and show the result for confirmation.

### Merchant video (optional, recommended)

A merchant may add one short video per product: 10–20 s of the garment on a mannequin or hanger, turning slowly, or worn by a model while walking. Real frames are better than generated ones, so the pipeline uses them in two ways:

1. **Geometry:** frames from a turning garment are used as extra real views next to the front and back photos; generated video only fills the angles nobody filmed.
2. **Drape calibration:** the swing and fold of the cloth in motion is compared with our simulation of the same motion, and the fabric parameters for this product are tuned until they match. This gives a per-product fabric profile that overrides the library.

Order of trust in every stage: merchant photo, merchant video, fabric library, generated video.

## Garment pipeline

The pipeline turns one product into one versioned asset bundle in eight stages; stages 2–4 are the engine and carry the research risk, the others are ordinary engineering.

### The canonical mannequin (build first)

Everything rests on one asset we own: a neutral mannequin mesh in a fixed A-pose, available in a small set of body shapes that span the size range (for example 5 shapes from XS to XXL). For each shape we store the 3D position of every anchor ring. The mannequin has a flat, uniform, mid-grey material with a UV checker variant for debugging. Camera paths (turntable at three heights) and one motion clip (arms raise, half turn, step) are fixed and stored with it. Because we render it ourselves, we know the camera pose and the mannequin surface in every frame of every video.

### Stage 1 — Ingest and validate

- Download the role-tagged photos, hash them, store the originals in the asset workspace.
- Checks: resolution, garment fully in frame (segmentation mask touches no border), no person detected, front and back differ, colour cast within limits.
- Segment the garment from the background in each photo; keep the masks.
- Output: clean garment cut-outs per view, or a rejection with reasons sent back to the merchant.

### Stage 2 — Image to video

Generate two videos per product with an image-to-video model that accepts a camera path and reference images (front and back as conditioning):

1. **Turntable:** the garment dressed on the canonical mannequin in the base-size shape, 360°, fixed camera path, neutral studio light.
2. **Motion:** the same dressed mannequin performing the stored motion clip.

The merchant's front and back photos are pinned at the 0° and 180° frames, so the model only interpolates between two real views. A third render with no garment, same path and same light, comes from our own renderer at no cost.

When the merchant supplied a video, its frames are pinned at their estimated angles as well, so the generator fills fewer gaps. The motion video then also serves as the reference for drape calibration in stage 7.

### Stage 3 — Separation

Per frame, garment = dressed frame minus the bare-mannequin frame, refined by a segmentation model. The motion video adds a second signal: pixels that move with the mannequin surface are skin of the mannequin, pixels that lag, swing or fold are cloth. Combining both gives a per-frame garment mask with a confidence. The inside of the garment (the part touching the mannequin) is taken from the known mannequin surface plus the ease from the size chart.

### Stage 4 — Reconstruction

With known camera poses and garment masks, reconstruct the garment as a surface (Gaussian or surfel-based reconstruction fitted to a mesh). Then:

- Remesh to a clean, simulation-ready mesh with a budget of about 8–15k triangles.
- Project the merchant's photos back onto the mesh for the front and back texture; generated frames only fill the sides. Real pixels always win where they exist.
- Bake normal and roughness maps from the detail photos and the fabric parameters.

### Stage 5 — Anchoring

Intersect the garment mesh with each known anchor ring of the mannequin. Per anchor we store the garment loop (its vertices), its circumference, and its offset from the body. Length points (shoulder to hem, sleeve, inseam) come from the mesh along the mannequin's known lines. Then calibrate: compare the measured circumferences at the base size with the size chart and `sampleMeasurements`, and apply one global scale plus per-ring corrections. The residual after calibration is a QA metric.

### Stage 6 — Grading

Other sizes are deformations between anchor loops: for each size, the size-chart deltas per anchor give a target circumference and length, and the mesh is morphed smoothly between neighbouring rings. Per size we store only the per-anchor targets (a few dozen numbers); the device applies the morph. Grading rules for missing chart columns follow standard grading increments per category and are logged as an estimate.

### Stage 7 — Drape parameters and QA

Map fabric data to simulation parameters (stretch and bend stiffness, mass from `weightGsm`, damping from `drape`) and material parameters (sheen, opacity). Then run automatic QA:

| Check | Pass when |
| --- | --- |
| Chart agreement | Calibrated circumference within tolerance of the chart at every critical anchor (tolerance set in Phase 0) |
| View agreement | Render at 0° and 180° matches the merchant's front and back silhouettes above a set overlap |
| Colour | Colour difference between render and photo below a set threshold |
| Mesh health | Watertight where expected, no self-intersection, triangle budget met |
| Simulation | 3 s drape on the base mannequin settles without explosion |

An asset that fails goes to manual review; one that passes goes to the merchant for approval.

### Stage 8 — Store and publish

Write an immutable bundle per `shop / product / assetVersion`: mesh (`.glb`, Draco-compressed), textures (KTX2), `anchors.json`, `grading.json`, `material.json`, a preview turntable video and thumbnails. Target bundle size under 3 MB. On merchant approval the product's `activeAssetVersion` points at it; re-runs create a new version and never overwrite.

## On-device fitting and rendering

The shopper's device loads the approved asset, builds the avatar from local measurements, places the garment on the avatar anchor by anchor, runs a short drape, and lets the shopper rotate and switch sizes; nothing about the body leaves the device.

### Anchor vocabulary (D15)

One enum in `packages/schema`, used everywhere:

- **Rings (12, from the scan):** `neck`, `shoulder`, `chest`, `underbust`, `waist`, `hip`, `thigh`, `knee`, `calf`, `ankle`, `upper_arm`, `wrist`.
- **Lengths:** `shoulder_to_waist`, `shoulder_to_hem`, `waist_to_hem`, `sleeve`, `inseam`, `rise`.
- **Breadth (added Nov 2026, review finding R1, see D15):** `shoulder_width`, the width across the back (seam to seam) that the fit point `shoulder` and size charts mean, measured at the height of the `shoulder` ring; the ring `shoulder` stays the girth. `grading.json` carries a `shoulder_width` target per size and the yoke is placed from it.

The scan already measures the 12 rings; give them these ids. The fit engine's per-point output is re-keyed to the same ids. A garment uses the subset its category needs.

### Avatar

- **v1 body:** a parametric body built from the shopper's fused measurements (typed, scan, prior). Use a body model with a licence that allows commercial use, or our own low-parameter model fitted to the 12 rings and lengths. Check the licence before the first line of code (SMPL-family models need a commercial licence).
- **Look v1:** neutral, skin tone from the existing face/skin-tone estimate, simple hair shape and colour. Labelled as an estimate (the disclaimer pattern from the original plan).
- **Look v2 (Phase 5):** a personal avatar from the shopper's own 360° video, reconstructed on the device where the hardware allows, bound to the same parametric body so anchors still line up.

### Fitting

1. Load the base mesh and morph it to the chosen size with `grading.json`.
2. For each anchor, the fit engine gives the gap between the garment loop and the body ring (it already computes this).
3. Positive gap: the loop sits at body + gap and the cloth hangs. Negative gap within the stretch limit: the loop is pulled onto the body and the stretch is shown as tension. Negative gap beyond the stretch limit: the garment does not close; show the strain clearly and say so in text.
4. Run a short position-based cloth simulation with collision against the body, using the material parameters, for about 1–2 s until it settles. Cache the settled shape per size so switching back is instant.
5. Optional overlay: a heat map of tension and room per area, using the same numbers as the size advice.

### Rendering and interaction

- Three.js on WebGL2 with WebGPU where available; PBR material with sheen and opacity from `material.json`.
- Interactions: drag to rotate, pinch to zoom, size switcher (S, M, L shown side by side or toggled), fabric close-up from the detail texture, reset view.
- Lazy-load the 3D viewer as a separate chunk so the SDK stays inside its 8 KB budget; the viewer loads inside the embed iframe only.

### Performance budgets

| Budget | Target |
| --- | --- |
| Asset download | ≤ 3 MB per product |
| Viewer chunk | ≤ 400 KB gzipped |
| Time to first frame on a mid-range phone | ≤ 2.5 s on 4G |
| Drape settle | ≤ 2 s |
| Frame rate while rotating | ≥ 30 fps on a mid-range phone |
| Fallback | Drawn overlay from today when WebGL2 is missing or the budget is missed |

Privacy stays as in D3: the body shape is computed and used in the browser; the server receives at most the chosen size and a confidence, as it does today.

## Data model, API and infrastructure

The API gains two tables, six endpoints and four job types; the GPU work runs outside the VPS and reports back through a signed callback.

### New packages and apps

| Path | What it is | Tech |
| --- | --- | --- |
| `packages/anchors` | Anchor enum, ring geometry helpers, grading morph (shared by worker and browser) | Pure TypeScript |
| `packages/garment-viewer` | 3D viewer, fitting, cloth simulation, size switcher | TypeScript, Three.js |
| `packages/mannequin` | Canonical mannequin meshes, anchor rings, camera paths, motion clip, plus a build script | Assets + TypeScript |
| `services/garment-worker` | The pipeline stages 1–8 as one container image, run on a hosted GPU service | Python (models and reconstruction live in this ecosystem) |

### Tables (Drizzle)

- `garment_assets`: `id`, `shop_id`, `product_id`, `version`, `status` (`queued`, `running`, `failed`, `needs_review`, `awaiting_approval`, `approved`, `rejected`, `superseded`), `stage`, `qa` (jsonb with every metric), `bundle_path`, `bytes`, `gpu_seconds`, `cost_cents`, `input_hash`, `created_at`, `approved_at`, `approved_by`.
- `garment_asset_events`: append-only log per asset (stage started or finished, error, merchant action), for the console timeline and for cost accounting.
- `products.active_asset_version` points at the approved version.

### Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `POST /v1/merchant/products/:id/assets` | Merchant | Start a run (also triggered on product save when the 3D inputs changed) |
| `GET /v1/merchant/products/:id/assets` | Merchant | Versions, status, QA, preview links |
| `POST /v1/merchant/assets/:assetId/approve` | Merchant | Approve; sets the active version |
| `POST /v1/merchant/assets/:assetId/reject` | Merchant | Reject with a reason, optional anchor corrections that trigger a re-run from stage 5 |
| `POST /v1/internal/assets/:assetId/callback` | HMAC from the worker | Stage progress, results, errors |
| `GET /assets/:shop/:product/:version/*` | Public, immutable cache headers | Serve the bundle files through Caddy |

`GET /v1/try/:token` adds `asset: { version, baseUrl, sizes } | null` so the embed knows whether to load the 3D viewer.

### Jobs (pg-boss)

- `asset.dispatch`: build the job manifest (photos, payload, mannequin version), call the GPU service, store the remote job id.
- `asset.poll`: fallback poll for runs whose callback did not arrive.
- `asset.finalize`: verify bundle hashes, write files to the asset volume, compute QA status, notify the merchant.
- `asset.gc`: delete superseded bundles after a retention period.

Idempotency: a run is keyed by `input_hash` (photos + relevant payload fields + mannequin and pipeline version). Same hash, same asset; no double GPU spend.

### Infrastructure

- Asset volume mounted into the api container and served by Caddy at `/assets/` with long cache lifetimes; included in the nightly backup.
- GPU: one container image deployed on a hosted GPU service that bills per second and scales to zero. Choose in Phase 0 by price per run, cold-start time and the EU region requirement.
- Hosted video or 3D models are called through the provider pattern of `packages/tryon-providers` (router, circuit breaker, banned-model lint) when a stage uses an API instead of a self-hosted model.
- Secrets for the GPU service and model APIs live only in the api and worker environment, never in client bundles (existing secret scan covers this).

## Merchant and shopper UX

The merchant gets one new job, tagging photos and approving a preview; the shopper gets a 3D view inside the existing overlay, with today's flow as the fallback.

### Merchant

- **Shopify admin page and Woo meta box:** a "3D" panel per product. Pick the role for each existing product image (front, back, detail), set the base size, optionally enter the sample measurements. A checklist shows what is missing for "3D ready".
- **Photo guide:** a short page with three example shots (hanger, flat-lay, ghost mannequin) and the rules from the input contract. Link it from the panel.
- **Status:** queued, building (with the current stage), ready for your approval, needs attention (with the reason), live.
- **Approval view (console `/merchant/assets/:id`):** the preview turntable, the asset on three mannequin shapes in base size and one size up and down, and the merchant's own front and back photo beside the matching renders. Buttons: Approve, Reject with reason. Anchor correction: drag a ring marker up or down on the base mannequin when a waist or hem sits wrong; this re-runs from stage 5 only.
- **Bulk:** "Build 3D for all ready products" with a cost estimate before start, and a per-month limit tied to the plan.

### Shopper (standalone embed and app)

1. About you stays as it is today.
2. Result screen: when the product has an asset, the avatar area becomes the 3D viewer with the recommended size already on. A size switcher shows neighbouring sizes; the per-point text ("2.8 cm more room at the waist") stays under the viewer and matches what is shown.
3. Controls: rotate, zoom, "Show fit map" toggle, fabric close-up.
4. A short label under the viewer: the picture is an estimate based on your measurements and the shop's data.
5. "Choose size" works as today.
6. In the consumer app, rail cards show a still from the settled 3D fit; tapping a card opens the same viewer.

Without an asset, or on a device below the budget, the shopper sees today's drawn overlay with no visible error.

## Phased plan

Six phases; Phase 0 is a go/no-go gate, Phases 1–3 make the engine live for one pilot shop in about 4–6 months, Phases 4–5 widen and deepen it. Effort is for one developer working with an AI builder.

### Phase 0 — Spike (3–4 weeks), gate: go or stop

Scope: canonical mannequin v0 in 3 shapes, 5 products from the pilot shop (dresses and tops) with merchant front and back photos, stages 2–5 as scripts with manual steps allowed, one fitted render per product in two sizes on two body shapes. Compare at least two candidate video models and two reconstruction methods.

Acceptance:

- [ ] **Size test:** five people who did not build it can tell, without labels, which render is the smaller size in at least 4 of 5 products.
- [ ] **Fabric test:** the same garment rendered with linen and with silk parameters is told apart by those five people.
- [ ] **Chart agreement:** calibrated circumference within ±2 cm of the size chart at the critical anchors for at least 4 of 5 products.
- [ ] **View agreement:** front and back renders are recognisably the merchant's garment (merchant confirms).
- [ ] **Cost:** GPU cost and wall time per product measured and written down.
- [ ] **Write-up:** chosen models, their licences for commercial use, failures and the tolerances to use from Phase 1.

If the size test fails, stop and reconsider before spending months.

### Phase 1 — Pipeline MVP (6–8 weeks)

Scope: `services/garment-worker` with stages 1–8 automated for dresses and tops, `packages/mannequin` v1 with 5 shapes, schema v2, fabric library v1 with the 50 entries, merchant video intake and drape calibration, tables, endpoints, jobs, asset volume, QA metrics.

Acceptance:

- [ ] 20 products run end to end without manual steps; at least 80% pass automatic QA.
- [ ] A re-run with the same inputs reuses the asset (no GPU spend).
- [ ] Bundles ≤ 3 MB; cost per product within the Phase 0 estimate plus 25%.
- [ ] `pnpm check` green, new code covered by tests, worker stages unit-tested on fixtures.

### Phase 2 — On-device fitting (6–8 weeks, can start halfway Phase 1 on Phase 0 assets)

Scope: `packages/anchors`, `packages/garment-viewer`, avatar v1, simulation, size switcher, fit map, fallback, scan rings re-keyed to the anchor enum.

Acceptance:

- [ ] All performance budgets met on one mid-range Android and one recent iPhone.
- [ ] The size and fabric tests from Phase 0 pass again in the real viewer.
- [ ] For every product and size, the viewer's tension and room per anchor match the fit engine's per-point output exactly (automated test).
- [ ] SDK stays ≤ 8 KB gzipped; Playwright e2e covers viewer load, size switch and fallback.

### Phase 3 — Merchant integration and pilot (4–6 weeks)

Prerequisite: the pilot path from the November handoff is done (Shopify API bump, server live, hardening) and every "Before pilot" item in Carry-over is closed. Scope: Shopify panel, console approval view with anchor correction, Woo panel, bulk build with cost estimate, plan limits. Then 10–20 products live at the pilot shop.

Acceptance:

- [ ] The merchant tags photos and approves assets without help.
- [ ] Shoppers on the pilot shop use the 3D view; sessions, size chosen and returns are measured against products without 3D.

### Phase 4 — More categories (4–6 weeks)

Trousers, skirts, outerwear, knitwear. Each category needs its own anchor subset, grading rules and QA tolerances. Shoes and accessories stay on today's flow.

### Phase 5 — Personal avatar and photo finish (8–12 weeks, research)

Avatar look v2 from the shopper's own video, bound to the parametric body. Optional photo-realistic finish of a settled 3D frame through a hosted model, conditioned on depth and pose so the size difference survives. Acceptance: the recognition test from the original plan (people recognise themselves at a glance in a plain white tee). Requires the founder decision on shopper photos.

## Costs, risks and open questions

The cost per product is unknown until Phase 0 measures it; the biggest risk is that generated video does not hold the garment's real shape well enough to show a size difference.

### Costs

- **Per product (one-off):** GPU time for two generated videos, separation and reconstruction. Measure in Phase 0; plan pricing only after that. Re-runs only happen when photos or fit data change.
- **Per shopper:** asset download from our own server; no model calls. Near zero.
- **Pricing implication:** the merchant pays per product built (or a number of products per plan) next to the existing per-session price. Decide with the founder's pricing decision.

### Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Video model drifts from the merchant's photos between 0° and 180° | Sides of the garment are invented | Pin real views at fixed frames; require a side photo for wide garments; QA view agreement; merchant approval |
| Separation leaves mannequin in the garment or cuts cloth away | Holes or a garment glued to the body | Bare-mannequin difference plus motion signal; mesh health check; manual review queue |
| Reconstructed shape is too smooth to show tension | Size test fails | Calibrate with chart and sample measurements; drive tension from the fit engine numbers on the device, independent of the reconstruction's detail |
| Model licences forbid commercial use | Cannot ship | Licence check in the Phase 0 write-up; extend the banned-model lint to video and 3D models |
| Mid-range phones miss the budget | Slow or broken viewer | Lower triangle count per device tier; fallback to today's overlay |
| Merchants skip back photos | Few products become 3D | Show "3D ready" in the completeness score; photo guide; bulk tagging |
| Hosted GPU service changes price or region | Cost or GDPR exposure | Worker is one container image, portable between services; EU region required |

### Open questions

- [ ] Which body model can we use commercially, or do we build our own low-parameter model?
- [ ] Tolerances for chart agreement and view agreement (set from Phase 0 data).
- [ ] Pricing for asset builds, and how many builds a plan includes.
- [ ] Do merchants accept responsibility for approved assets in the terms of service?
- [ ] Which GPU service, given cost per run, cold start and EU region?
- [ ] Is the shopper's own video avatar (Phase 5) reconstructed on the device, or once on a server with consent?

## Carry-over from the November handoff

All 24 open findings from the November build handoff are placed on this plan below; three must close before Phase 1 because the pipeline depends on them, and eight before the pilot.

| # | Finding | Severity | Status | When | Why now, and the action |
| --- | --- | --- | --- | --- | --- |
| 1 | SSRF guard resolves DNS but does not pin it | Medium | Open | Before Phase 1 | Stage 1 downloads merchant photos and video from shop URLs. Pin DNS in `apps/api/src/lib/safeFetch.ts` and route every ingest download (worker included) through it. |
| 2 | Duplicate size labels in a size chart are not rejected | Low | Open | Before Phase 1 | Grading reads the chart per size label. Reject duplicates in schema `garment.ts` and fit-engine `summary.ts`. |
| 3 | "Boot cut jeans" classified as shoes | Low | Open | Before Phase 1 | Category picks the anchor subset; a wrong category builds a wrong asset. Fix in `mappings/common.ts` together with the fabric mapping work. |
| 4 | Shopify API version pinned to `2025-10` | High | Open | Before pilot | Pilot runs on Shopify. Bump in api `env.ts`, `packages/shopify-app` and `infra/.env.example`. |
| 5 | The api carries its own Shopify GraphQL and billing client next to the shared helpers | Low | Partly fixed | Before pilot | Remove the duplicate first, so the version bump and the currency fix happen in one place. |
| 6 | Shopify billing always charges in EUR | Medium | Open | Before pilot | The pilot shop bills in AUD; non-EUR shops get an error. Fix in `apps/api/src/shopify/client.ts` and the shopify-app billing. |
| 7 | Standalone billing rate-limited per IP only | Medium | Open | Before pilot | Add per-plan caps and merchant alerts for unusual billing (`apps/api/src/routes/try.ts`). |
| 8 | Deck swipes in the app can be billed by bots | Medium | Open | Before pilot | Pairing check and a per-shop daily cap on the swipe path (`routes/app.ts`); required once app mode is on. |
| 9 | No `DELETE /v1/me/signature` | Medium | Open | Before pilot | "Delete my scan" must remove the fit signature on the server. |
| 10 | Device token past 30 days cannot rotate | Medium | Partly fixed | Before pilot | Re-registering orphans server data out of reach of delete. Finish rotation in `auth/device.ts` and the web client. |
| 11 | Shop logo and overlay product photo load from the merchant's server | Low | Partly fixed | Before pilot | Proxy or cache the logo. In the 3D path, textures come from our bundle, which removes the product photo load. |
| 12 | Woo manual-key Connect has no proof of domain ownership | High | Open | Before the first Woo merchant | Add a domain proof (file or meta tag) in the `woo/connect` route. |
| 13 | Woo signed backfill endpoint has no server-side signer | Medium | Open | Before the first Woo merchant | Implement the signed request on the server, or remove the endpoint from `class-rest.php`. |
| 14 | SDK is `UNLICENSED` but ships inside a GPL plugin | High | Open | Before WordPress.org | Founder decision. The 3D viewer loads inside our iframe and does not ship in the plugin. |
| 15 | Plugin readme "Tested up to" stale; Connect redirect not restricted to `checkout.stripe.com` | Low | Open | Before WordPress.org | Update headers; restrict the redirect in `class-settings.php`. |
| 16 | Scan head-top row includes hair, girths 1–3% low; face step says "models not available" while loading | Medium | Open | Phase 2 | The avatar is built from these rings, so the bias shows in every fit. Fix in `features/capture`. |
| 17 | About 58% of the population prior goes into girth means | Medium | Open | Phase 2 and pilot | Tune the prior weight with the tape-measured volunteers (`measure.ts`). |
| 18 | Console does not show the size distribution from standalone sessions | Low | Open | Phase 3 | The pilot compares sizes chosen with and without 3D; read the stored data in `services/analytics.ts`. |
| 19 | Abandoned-opens analytics applies k-anonymity to sessions, not people | Low | Open | Phase 3 | Fix together with the pilot analytics. |
| 20 | Items without fit points never earn the fit term in deck ranking | Medium | Open | Later (app) | Accessories stay on today's flow in the engine as well (`taste-engine/src/rank.ts`). |
| 21 | No hero-render ("photo of you") screen in the consumer app | High | Superseded | Phase 5 | Replaced by the optional photo finish of a settled 3D frame in Phase 5. |
| 22 | Item ids not namespaced by shop in the app | Medium | Partly fixed | Later (app) | Server side fixed; finish in `taste-engine` and `apps/web/src/store`. |
| 23 | `/v1/swipes` rejects a whole batch for one bad event | Low | Partly fixed | Later (app) | Accept valid events, report the rejected ones. |
| 24 | Wardrobe size null in one type, "ONE" for unknown sizes | Low | Partly fixed | Later (app) | Align the types in `taste-engine` and schema `WardrobePutRequest`. |

Product scope still open from November: cross-shop profiles in standalone mode, shopping with friends, order attribution (off by design) and merchant buying advice. The "true mesh warp of the garment photo" is replaced by this engine.

### Founder decisions, accounts and pilot

The November to-dos still stand; some now gate a specific phase of the engine.

**Decisions**

- [ ] Shopper's own face in renders: gates Phase 5 only.
- [ ] Brand name Curtain: trademark clearance (BOIP, EUIPO, USPTO; classes 9, 35, 42), domains and app-store names.
- [ ] SDK licence: before the WordPress.org submission.
- [ ] Pricing: plan levels, price per try-on session, overage price, and now also the price or allowance for asset builds.

**Accounts and keys**

- [ ] Merge `claude/takeover-foundation` to `main` or open a pull request so CI runs, before the engine branch starts.
- [ ] GPU service account and API access to the candidate video models: needed for Phase 0.
- [ ] Shopify Partner account and a development store: Phase 3 prerequisite.
- [ ] The VPS with a domain, now including the asset volume and its backup.
- [ ] Stripe account with product, meter and webhook endpoint.
- [ ] WordPress + WooCommerce test site.
- [ ] FASHN key (optionally Vertex, Grok): now only needed for the Phase 5 photo finish.

**Pilot**

- [ ] 2–3 shops that fill fit data for 10–20 products, now including front and back photos, base size and optionally a video.
- [ ] 10–20 volunteers with a tape measure: they calibrate the scan and also serve as the panel for the size and fabric tests.

## Rules for the builder

The repo rules in `AGENTS.md` still apply; these add what the engine needs.

1. **Start with Phase 0 on a new branch** from `claude/takeover-foundation`. Keep spike code in `spikes/garment-engine/`; promote only what passes the gate.
2. **Privacy:** no route accepts a shopper photo or video; the body shape never leaves the browser. Merchant photos are product data and may be processed on the GPU service.
3. **Real pixels win:** wherever a merchant photo covers a part of the garment, its texture is used over a generated frame.
4. **One source of truth for fit:** the viewer reads per-anchor gaps from the fit engine. Never compute fit a second time in the renderer.
5. **Determinism:** pipeline runs are keyed by `input_hash` and pin model versions, mannequin version and seeds. Store all of them in the asset record.
6. **Licences:** before adding any model or body model, record its licence in `docs/research/` and extend the banned-model lint. No model without a commercial licence.
7. **Budgets are tests:** bundle size, viewer chunk size and the SDK budget fail the build when exceeded.
8. **Never overwrite an asset:** every change is a new version; approval switches the pointer.
9. **Fallback always works:** a product without an approved asset behaves exactly as today. Cover this with e2e tests.
10. **Secrets:** GPU and model keys only in the api and worker environment; no token-shaped literals in tests.
11. **Record decisions:** add D12–D16 to `docs/DECISIONS.md` in the first commit; add new decisions there as they are made.
12. **Report per phase:** at the end of every phase update `docs/STATUS.md` with what passed, what failed, measured costs and open findings, in the format of the November handoff.
