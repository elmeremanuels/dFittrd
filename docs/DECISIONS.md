# Decisions (ADR log)

Decisions taken when the project was handed over to the AI builder (Nov 2026). Each entry says what was decided, why, and what it rules out. Supporting research lives in `docs/research/`.

## D1 — Name: **Curtain** (renamed from Paskamer, Nov 2026)

The founder asked for every Dutch term to be English. "Paskamer" is Dutch for "fitting room", so the brand needed an English name. The literal translations are taken in this exact market: "Fitting Room" (a Shopify app and several iOS apps), "FitRoom" (fitroom.app, 1M+ users), "Tryroom" (a Shopify try-on app) and "Twirl" (a web dress try-on). "Curtain" has no try-on or sizing product in web searches. It keeps the fitting-room idea and carries the privacy promise in one word: what happens behind the curtain stays there (D3). Tagline: *your private fitting room*. Merchant button: "Try it on".

- Package scope: `@curtain/*`. SDK attribute: `data-curtain-product`. Shopify namespace `$app:curtain`, Woo meta `_curtain_*`. Placeholder domain `curtain.fit` (api., app., media.).
- Known weakness: "curtain" is also a home-furnishing product, so generic search results and some Shopify stores sell curtains. Use the brand with the tagline or a wordmark, never the bare word in ads.
- Dutch stays available as a translation (SDK `nl` strings, Shopify `nl.json`, Woo `nl_NL.po`) for Dutch shoppers and merchants. English is the default everywhere. *Superseded by D21 (15 Nov 2026): the interface is English only, no Dutch is shipped, and the Dutch files are drafts outside the builds until a translation pack is added.*
- Still to do by the founder: trademark clearance (BOIP/EUIPO/USPTO, classes 9, 35, 42), domains (`curtain.fit`, `getcurtain.com`, `curtain.app`), and app-store and Shopify App Store names. Not legal advice. The earlier naming research stays in `docs/research/naming.md` as history.

## D2 — Monorepo, one backend, one PWA, two plugins

pnpm workspaces. The consumer app stays React 19 + Vite + Tailwind 4 (PWA first; Capacitor shell later behind `src/platform/*`). ONE Node process (Fastify) is the app API, merchant API, SDK host, Shopify app backend and job runner (pg-boss, in-process). ONE Postgres. ONE Caddy for TLS and static files. No Redis, no object store, no separate worker, no second web framework.

Why: a solo founder has to keep this alive. Every extra container is a 3 a.m. failure mode. Judged best on feasibility by all three panel lenses. Runs unchanged on the founder's VPS (Docker Compose) and later on Fly/Railway/Cloud Run.

Rules out: Turborepo, Remix/React Router server for Shopify, MinIO, Valkey, OTel stack, React Native/Expo for v1.

## D3 — Privacy by construction, provable in CI

Handoff §2.2 is non-negotiable: raw photos/video never leave the device.

- The backend has **no route that accepts a user photo**. The only image-accepting route is the opt-in hero render, and its `PersonInput.kind` type has no `'userPhoto'` member — the API client cannot serialise a raw frame.
- Capture runs in a Web Worker; frames never hit storage. One encrypted base frame (AES-GCM, non-extractable WebCrypto key) and one face tile persist in IndexedDB.
- What syncs: the ~80-float fit signature (no face/skin/hair values), swipe events, wardrobe states, pairings. A client-side privacy ledger logs every network write; the server mirrors it.
- Per-(device, shop) pseudonym on pairings; merchants never see a device id, a measurement, or a photo. Merchant aggregates have a configurable k-anonymity floor (default 5 for pilots, raise later).
- Build-time guards: `packages/tryon-providers` is server-only (`"browser": false` + lint rule); any `VITE_*` env containing `KEY`/`SECRET` fails the build; CI greps the web bundle for secret patterns. A Playwright privacy e2e runs onboarding with a fake camera and asserts no image MIME / no request body > 8 KB leaves the page.
- Models, fonts and the SDK are served from our own origin: onboarding makes zero third-party requests.
- GDPR: `DELETE /v1/me` erases everything in one call; `GET /v1/me/export` (Art. 20). Shopify `customers/*` topics are no-op + log (we hold no customer PII); `shop/redact` purges the shop.

## D4 — AI provider strategy

No engine accepts a size chart or fabric metadata; fit and size stay in our deterministic fit engine. Neural try-on is an **opt-in hero render**, never the default path.

- Default render (on-device, Path B): 2D mesh warp of the merchant's flat-lay onto the user's own segmented base frame, per-point ease from the fit result, hem sag from `fabric.drape`. Passes the recognition test without any mesh fitting. Always labelled "estimate".
- Hero render (opt-in, server): `FashnProvider` (tryon-v1.6 flat-lay, tryon-max for hero; no training unless opt-in, 3-day deletion, Apache-2.0 self-hostable sibling for a GPU VPS later). Fallback stub: Google Vertex Virtual Try-On (`virtual-try-on-001`, EU regions documented). Creative fallback stub: Nano Banana via Vertex. **Video**: xAI Grok Imagine (`grok-imagine-video-1.5`, $0.08/s) animates the hero *still* — the raw capture never goes to xAI; this is exactly where the founder saw it shine (fabric motion), not garment transfer.
- Provider order and keys are env-only in `apps/api`. Non-commercial models (IDM-VTON, OOTDiffusion, CatVTON, FitDiT) are banned from the provider registry by lint.
- Before locking providers: 2-week bake-off on ~50 real SKUs incl. dresses and bottoms. See `docs/research/tryon-engines.md`.
- Gemini is therefore not special; the `@google/genai` client-side wiring is removed.

## D5 — Body scan: on-device, MediaPipe, analytic v1

`@mediapipe/tasks-vision` (Apache-2.0, self-hosted assets) Pose Landmarker + multiclass selfie segmenter + Face Landmarker in a worker. v1 measurement = 12 cross-section widths (front) × depths (side) → Ramanujan ellipse girths, blended with a height/weight population prior (Bartol et al. 2022), fused with manual entries by inverse-variance weighting. Confidence mapping reproduces the handoff targets (scan-only ≈ 60 %, scan + agreeing tape ≈ 95 %, conflict → remeasure).

Rules out for v1: SMPL-X (non-commercial licence; commercial licensing now via Max Planck Innovation, unquoted), a trained regressor (BodyM is CC BY-NC; train on consented pilot data later), commercial scan SDKs (all cloud). Mesh fit (Anny, Apache-2.0) + ONNX regressor are post-MVP drop-ins behind the same `measure.ts` interface. Expected v1 accuracy: 3–4 cm scan-only, ~1.5–2 cm fused — adequate for 4–6 cm size steps. See `docs/research/body-scan.md`.

Skin tone: multi-point CIELAB sampling → ITA → Monk Skin Tone class, undertone from hue angle, rule-based 12-season *estimate*, user confirms the swatch.

## D6 — Merchant side: Shopify app + WooCommerce plugin, SDK bundled

- Shopify: managed installation / token exchange via `@shopify/shopify-api` (no hand-rolled OAuth), declarative webhooks in `shopify.app.toml` (incl. the three GDPR topics), metafields in namespace `$app:curtain` so the shop stays source of truth, `bulkOperationRunQuery` for backfill, Billing API usage line with `cappedAmount`. One theme app extension ("Try it on" block) that bundles `sdk.js`.
- WooCommerce: PHP 8.3 plugin; meta box for the §3.1 fields; push on save with HMAC; SDK bundled in the zip (WP.org no-remote-code rule); no telemetry before Connect; HPOS-compatible; `uninstall.php`.
- Merchant identity for Woo: Connect round-trip → Stripe Checkout (the Stripe customer is the identity; no separate login system).
- The app reads garments from **our** backend (synced, normalised), not from the shop's API. One schema, one auth, caching, and it is what makes the merchant console possible.
- `completenessScore(garment)` in `packages/schema` with per-field reasons; a validate dry-run endpoint gives inline feedback in both plugins.

## D7 — Billing unit: the try-on session

One try-on session = one product resolved by one user with a fit result written, idempotent by intent token. Counted identically by Shopify `appUsageRecordCreate` and a Stripe meter. Plugin paid (Starter plan + overage), app free. Below plan → the button still renders; the deep link shows a "shop paused" screen. Never break the merchant's page.

*Changed by D25 point 5 (20 Nov 2026):* below plan the button is hidden. The SDK asks the api whether the shop is paused before it shows a button, and opens nothing on a paused answer. "Never break the merchant's page" stands: an outage never removes a working shop's button.

Order attribution (hidden cart attribute → `order_outcomes`) is schema-ready but **off by default**: it would create a re-identification bridge between our pseudonymous users and the merchant's customer records. If enabled later: disclose in the grant sheet, store only an HMAC of the order id, strip customer fields from webhook payloads, never return per-session size/score to the merchant page.

## D8 — Engines are pure packages with test vectors

`packages/fit-engine` and `packages/taste-engine` are pure TypeScript, zero runtime deps, fully covered by the test vectors in `docs/research/fit-engine-spec.md` and `taste-engine-spec.md`. `packages/schema` (zod) is the single source of truth for every wire type and exports JSON Schema for the PHP plugin.

## D9 — Hosting: founder's VPS first

`infra/docker-compose.yml` with caddy + api + postgres. Web bundle is static files behind Caddy (rsync deploy). GitHub Actions builds the api image. Nightly encrypted `pg_dump`. Moving to managed cloud later is a `DATABASE_URL` change.

## D10 — Honest schedule

The handoff's eight weeks is realistically 12–16 weeks of solo work; the risk is the on-device capture pipeline, not the backend. Sequence: engines → backend + persistence → capture → Path B → first platform end-to-end → second platform → billing → hero render + bake-off.

## D11 — Standalone first: the shop works without the consumer app

The founder wants to start with the plugin alone. The "Try it on" button now opens the full fit
experience in an overlay on the merchant's own page (an iframe on our origin). The overlay has
quick measurements or an optional camera scan, a size recommendation and the per-point fit, and it
selects the chosen size on the product page. Shoppers install nothing. The consumer app (deck,
wardrobe, Style DNA, cross-shop profile) becomes an optional extra and the old QR/deep-link flow
stays behind `data-mode="app"`. The billing unit stays the try-on session: in standalone mode it is
billed when the first fit result is shown (`POST /v1/try/:token/fit-shown`). Measurements never
leave the shopper's browser in this mode. Full contract: `docs/STANDALONE.md`.

## D12 — Own garment engine (revises D4)

We build an image → video → 3D pipeline per product and an on-device fitting renderer. Hosted AI try-on (FASHN and others) stays available as an optional photo finish. Why: hosted try-on ignores size and fabric, and showing size is the product. Per-product processing keeps the cost per shopper near zero. Full plan: `docs/ENGINE-HANDOFF.md`.

## D13 — The merchant owns the views

Front and back photos are required for an asset; detail photos are recommended. The merchant approves every asset before shoppers see it. Why: generated back views and details are where models invent things; one extra photo removes the largest source of error and draws a clear line of responsibility.

## D14 — Video is the separation and measurement engine

The pipeline renders the garment on our own canonical mannequin with a known camera path and a known motion. Garment versus mannequin and the measurement points are both derived from that video. Why: we own the mannequin geometry, so every pixel that is not mannequin is garment, every mannequin ring is a known measurement point, and cloth that moves differently from the body during motion is garment.

## D15 — One anchor vocabulary

Body scan, fit engine, garment asset and renderer all use the same named anchors: the 12 rings (neck, shoulder, chest, underbust, waist, hip, thigh, knee, calf, ankle, upper_arm, wrist) and the lengths (shoulder_to_waist, shoulder_to_hem, waist_to_hem, sleeve, inseam, rise). Why: the size advice and the picture come from the same numbers, so they can never contradict each other.

Amended Nov 2026 (review finding R1): one breadth, `shoulder_width`, joins the vocabulary. The fit point `shoulder` and every size chart's shoulder column are a width across the back (~40 cm), while the ring `shoulder` is the torso girth at the shoulder line (~100 cm). The fit point now maps to `shoulder_width`, so a width gap is never keyed under the girth ring. The asset carries it too: `grading.json` stores a `shoulder_width` target per size (from the chart's shoulder column, with the product's shoulder ease on a body chart), `anchors.json` records it with notional seam points at ±width/2 on the shoulder ring's height, and it drives the size-to-size grading of the yoke: when the chart has no shoulder girth, the `shoulder` ring grades by the width ratio (logged as an estimate), so the yoke's width changes between sizes by that ratio. It does not set the yoke's absolute width. The synthetic base mesh is lofted from the mannequin torso, so its body half-width at the shoulder ring is the mannequin torso's plus clearance (about 21.6 cm on the ring for both spike products, widening to about 26 cm within 0.75 cm of it where the torso meets the arm junction), against chart half-widths of 19.75 cm (aalter-studio-2) and 25 cm (monochrome-03). The `anchors.json` seam points are chart points, not features on the mesh: for aalter-studio-2 they sit inside the mannequin torso (half-width 21.06 cm), for monochrome-03 outside the ring. `spikes/garment-engine/src/grading.test.ts` pins this gap. Placing or scaling the yoke so its half-width is width/2 needs real seam geometry (a reconstruction with seams, or a synthetic build that tailors the yoke) and is open.

## D16 — Assets in file storage behind Caddy; GPU work on a hosted GPU service

The VPS orchestrates and serves; it never runs models. Asset bundles (a few MB per product) live on a disk volume served by Caddy under immutable, versioned paths and are included in the nightly backup. GPU work runs per job on a hosted service that scales to zero, in an EU region. This keeps the spirit of D9 (no object store, small VPS). D3 is unchanged: garment assets are public product data; the shopper's body and photos stay on the device.

Pilot permission (8 Nov 2026): the founder states that Bohohippychic has granted permission to use its name, logo, product photos and the 3D bundles derived from them, on the website and in demos. The founder keeps the written confirmation on file outside the repository (see `docs/REFINEMENT.md` B1).

Amended Nov 2026 (branch `claude/plugin-v1`): until the GPU pipeline runs, bundles are imported by hand (`pnpm --filter @curtain/api asset:import`, or `node dist/scripts/import-asset.js` in the api container). The import checks the bundle (format, at most 3 MB, QA chart agreement, every size of the live chart graded), copies only the five bundle files (never `payload.json`, renders or shop photos) to `ASSET_DIR/<shopId>/<productId>/<sha256-16>/` and records it as `awaiting_approval`; shoppers see only the version the merchant approved (D13). Caddy serves `/assets/*` from the `assets` volume, read-only, immutable, CORP cross-origin, ACAO the app origin, no access log; the volume is in the nightly backup. Until D17 prices 3D, a per-shop switch `settings.garment3d` (off by default, set by hand for the pilot) gates the asset ref on `GET /v1/try`.

## D17 — Price: USD 8.99 per month, flat

Founder decision (Nov 2026). One plan for the standalone plugin at USD 8.99 per month per shop, billed through the Shopify Billing API (Stripe for WooCommerce), in line with flat-priced size apps such as SmartSize. No usage charge per try-on session: the session stays the unit we count (D7) for analytics and abuse limits, and the per-plan daily caps and anomaly alerts stay as fair-use protection. Shops billed in another currency are charged the converted amount through the existing rate table, with USD as the base. The 3D garment engine (D12) is not part of this plan; its pricing is decided after Phase 0.

## D18 — Drape prediction engine fills look parameters, never sizing

Founder request (Nov 2026): once the engine knows how a garment behaves, predict how a related garment drapes ("a silk dress behaves like a silk skirt") and use that to fill gaps in merchant data. We build `@curtain/drape-prior`: a pure, zero-dependency package (D8) that predicts the material (bending, stretch, shear, mass, damping, friction, sheen, opacity) from a hierarchical fabric table calibrated by every GPU asset and anchored by about ten physical swatches, and predicts the cut (flare, off-anchor ease, length behaviour, sleeve volume, depth) from rules, then from approved exemplars of the same cut class or of a shared body region. Material transfers across categories; shape transfers only within a cut class or region (skirt region dress ↔ skirt). The visible shape always comes from simulating the predicted pattern with the predicted material, through the same solver the device ships. A router decides per product between a full GPU run, a predicted asset (stage 1b stills + two-view stage 4t, no stage 2) and stage 4b re-texture.

Why: stage 2 is about 90 % of the ~$1.63 per product, the fabric library's drape values are estimates, and thin categories (12 Skirts full runs on Bohohippychic) need to borrow. Estimated GPU saving on Bohohippychic: about 15–35 % with scraped data, up to about 50 % once merchants confirm the fabric; measured in shadow mode before it is relied on.

What it rules out: prediction never writes into `GarmentPayload` and never feeds `@curtain/fit-engine` (`computeFit` reads `fabric.stretchPct`); predicted anchor girths equal the fit-engine target (D15). Nothing skips a GPU run before gate G1; every predicted asset still needs the stage 1b observation, merchant approval (D13) and the estimate label. No dynamics are fitted to generated motion (it follows the control proxy). No shopper data, no third-party models. Phase 1: rules, logging, shadow mode, coverage-ordered GPU queue; Phase 2: 3D-ready merchant fields; Phase 3: predicted assets live per gated cell. Full design: `docs/PREDICTION-ENGINE.md`.

## D19 — The shopper chooses what is processed on a server; a face photo may go, a body photo never (revises D3 for the face only)

Founder decision (13 Nov 2026). Every mannequin gets a neutral standard face, so the avatar never looks unfinished. The shopper decides what is sent to or processed on a server. The control sits where people look for it: tapping the avatar opens the prompt that explains, per item, what happens ("use my face", "match my skin tone", "scan my body") and where it is processed. Nothing is sent before the shopper says yes in that prompt, and each item can be switched off again there.

What is allowed, only after that yes: a **face photo** (head and neck) may be uploaded for processing into the avatar's face and skin tone. It is encrypted in transit, processed in memory, deleted as soon as the result is returned, never written to storage or logs, never used for training, and never shown or passed to the merchant. The result (face texture, head shape, skin tone) lives on the device like the rest of the profile.

What stays as it was: **body measurements are typed in by hand by default**; the camera body scan stays optional and stays on the device. No route may accept a body photo or body video, with or without consent. Merchants never receive a measurement, a photo or a device id. Every render stays labelled an estimate. Where the device can do the work itself (skin tone, landmarks, fitting the head), it does it on the device, and the server step is used only for what the device cannot do well.

Why: shoppers want to see their own face and skin tone next to the garment, and most accept sending a face photo as long as they never have to send a photo of their body. Before this ships to real shoppers: explicit consent wording, the privacy policy and the merchant data-processing terms need a lawyer's review (face data is biometric or sensitive data in several jurisdictions), and the upload route needs its own abuse limits and a test that proves nothing is stored.

Addition (13 Nov 2026, founder): the prompt itself speaks plain human language, one or two short sentences per item ("We use your photo to draw your face on the avatar. It is deleted right after."). The full legal text is not shown in the prompt; it is one tap away behind a link ("Read the full privacy terms"). The plain text must never promise more than the legal text does.

## D20 — Skin tone in the hero render, a remembered photo, men's garments only with 3D, and who reviews the legal text

Founder decisions (13 Nov 2026), answering the open questions of `docs/research/photo-avatar-plan.md`.

1. **"See it on me" may carry the shopper's skin tone.** The hero render stays opt-in as it is; when the shopper has chosen or confirmed a skin tone, that tone (a colour value, nothing else) may go with the avatar render so the result matches what they see. No photo, no face, no measurement goes with it. This revises D3 for this one value on this one opt-in route; the fit signature still carries no colour data.
2. **The embed may remember the photo for the next visit.** Rule: the face photo result (face tile, face texture, skin tone) may be kept on the device, encrypted, per shop site, so a returning shopper sees themselves at once. The avatar prompt says so in plain language, "Delete my photo" and "Forget me" remove it, and it is never kept on a server.
3. **No men's product goes live with a 2D figure only.** A men's garment is shown with the full experience (male body, 3D drape, men's fit points) or not at all. Until that works, men's products show "Men's clothing: coming soon" in place of the Try it on flow. So the male 3D pipeline (plan slice 8) is part of the scope, not an optional later step.
4. **Naomi reviews the legal text.** The consent copy, the privacy terms draft and the counsel brief go to her; the photo-based face stays behind its flag until she has answered.

## D21 — English first; translation packs later

Founder decision (15 Nov 2026). The shopper and merchant interface is built in English only for now. Other languages come later as translation packs, added without code changes. Until then: no interface text switches on the browser or shop language, and no second language is written in the code. Every interface string lives in one English catalogue per surface, read through a single lookup, so a pack is one more catalogue. The Dutch drafts written so far (avatar prompt, men's "coming soon" line) are kept as source material under `docs/`, not shipped.

## D22 — Head v3 is the default; an AI realism layer comes on top; skin tones must improve

Founder decision (19 Nov 2026), after the look review of head v3 (`docs/reports/claude-head-v3.md`).

1. **Head `neutral-v3` is the default head in the embed's 3D view, as a base.** The build flag `VITE_VIEWER_HEAD=neutral` still gives the old head. Lighting stays `classic` until the founder approves a lighting change.
2. **The 3D mannequin is the base, not the end state.** An AI layer is to turn the 3D render into a realistic image ("from 3D modelling to AI-realistic"). It must keep the garment's cut, size difference and colour from the 3D estimate, stay labelled an estimate (rule 3), use only commercially licensed models (rule 6), and never take a shopper photo of the body (rule 1). A face reaches it only under D19.
3. **Skin tones must look better** than today's flat shading, on the 3D mannequin and the 2D figure, for every Monk tone.

## D23 — Aggregates come in closed calendar months, frozen, with complementary suppression

Engineering decision (19 Nov 2026, branch `claude/analytics-kfloor`), from launch-readiness finding 1: with a free `from`/`to`, a merchant could subtract `[d1, d2]` from `[d1, d3]` and see a group below the k floor (D3). It applies to every k-floored answer: the merchant analytics (`swipes`, `fit-sizes`, `abandoned`) and the shopper cohort (`/v1/fit/cohort`).

- **One period size: the calendar month in UTC.** No route takes a date range for k-floored data. Months are disjoint, so two allowed questions cover the same rows or none. Weeks would show more often but hide far more for a small shop; months and weeks together are not allowed, because a month minus its whole weeks is a few days. Changing to weeks later is one constant and needs care: answers already given in months must not be re-cut.
- **Closed and frozen.** A month is served from 24 h after it ends; the first answer is stored (`analytics_snapshots`) and served from then on. An erasure or a late upload after that changes nothing anyone can see, so "before minus after" is empty. Erasure still deletes the shopper's rows; the stored aggregate never held fewer than K people. Raising `K_ANON` hides months frozen under the lower floor instead of recomputing them.
- **Complementary suppression.** A row or size bucket is shown with at least K distinct shoppers, and the hidden ones of a table together hold at least K, so a total from anywhere (the usage page) minus the shown rows is never a small group. Colour, fabric and the size table are sums of shown cells only.
- **The cohort** is a sum of one frozen, floored cell per shop and closed month, so it changes only by whole months that each cleared the floor. The current month never shows.

Cost: a new shop sees its first analytics on the 2nd of the following month, and small products are hidden more often. Counts inside a shown group (loves, passes, fits, the kept rate) stay as measures of that group, as before. Billing counters (`/v1/merchant/usage`, `usage/anomalies`) keep their daily range: they count sessions, with no shopper attribute. `apps/api/src/kfloor.property.test.ts` attacks all of this with every linear combination of allowed answers.

## D24 — We build the platform; merchants and shoppers fill it

Founder decision (20 Nov 2026), given while answering the open-issues advice (point 10, the WooCommerce product with a fabric but no drape data).

1. **Curtain is a platform.** Where a value or a behaviour is about the merchant's own shop or garments (what happens with incomplete data, fabrics, charts, tape values, wording choices), it is a merchant setting in the dashboard with a sensible default, not a rule we fix in code. Where it is about the shopper, the shopper fills it.
2. **We do not have to prefill everything.** Prefill only what makes the first use work: defaults, and data from public sources (for example a mill's or manufacturer's published fabric data), always marked with where it came from.
3. **A fabric library grows in the background.** Fabrics that merchants enter are kept so that merchants can later pick a fabric from a list. What is shared across shops, and in what form, needs a rule before anything is shared (a merchant's supplier data may be confidential); until then a merchant sees their own fabrics and the public ones only.
4. **Point 10 itself:** a product with an incomplete fabric is let through without the fabric, with a notice, and whether to let through or refuse is a merchant setting.

Not open to a merchant setting: the hard rules of AGENTS.md (shopper data on the device, every render labelled an estimate, the k floor, licences), D19 and D20.

## D25 — Founder answers on the merchant-settings inventory

Founder decisions (20 Nov 2026), answering the open questions of `docs/research/merchant-settings-inventory.md`. Point 1 replaces D24 point 4's wording "without the fabric".

1. **Incomplete fabric: leave out only the missing part.** What the merchant entered (name, blend, a valid stretch) is kept; the product goes through with a notice.
2. **"Hold the product back" is built, but kept out of the first-run steps.** The default is to let the product through.
3. **Fabric sharing sits under "help improve the product".** When the merchant agrees to that, their fabric values are shared anonymously (no shop name, no supplier name, no product). Without it, a merchant's fabrics stay private to the shop. This replaces a per-fabric switch.
4. **Fabric data: do what improves quality fastest.** Engineering reading: first the confirmed stretch and the named choices in the product form and the per-shop fabric table (slice 2), because a wrong stretch is what makes advice wrong; collecting mill data comes after and only from sources whose terms allow it.
5. **Paused plan: the button is hidden.** This changes D7, which kept the button with a "shop paused" note.
6. **The age-range question is removed.** Nothing uses it.
7. **A shop may hide "Fit by Curtain".** The estimate label is not part of that and stays (rule 3). The price at which 3D and the AI layer become switchable is still open (D17).

## D26 — Founder answers on the open-issues advice (second round)

Founder decisions (20 Nov 2026), from the document "Curtain: open punten met advies". The founder follows the advice on every row left empty; the rows below were answered in words.

1. **The Shopify demo app is named "FitCurtain".** It is a custom app for one shop, a demo; the name "curtain.fit" is kept free for the public app.
2. **The price at which 3D and the AI layer can be switched on (D17) is not set now.** It is decided after the trial with printed garments.
3. **A size that is tight but still larger than the body stays drawn** (OI-102). Only a size that cannot be worn is not drawn.
4. **The real-phone test is this week**, one iPhone and one Android. The legal texts go to Naomi today. Both are founder actions.
5. **Male body v2 and its 2D figure are judged after the chino session.**
6. **The risk that a merchant derives one shopper from the analytics with fake shoppers is accepted for the pilot**, with monthly periods (D23). To be revisited before unknown shops are admitted.
7. **Hip height is a field per product**, prefilled per garment kind (skirt: 20 cm below the band), changeable by the merchant. **Where a skirt sits is a fixed rule** (band 2 cm under the navel). **Slit length and weight are optional fields.** From Caron we collect only, for the pilot garments, the hip depth, slit length and weight of the red skirt. **The 2.5 cm pull-on allowance stays fixed.**

On the empty rows the advice stands, among them: the four build items before launch (OI-48, 49, 66, the password hint of OI-99) and the small ones (OI-45, 69, 70, 83, 104, 105); the per-shop face-photo switch as a merchant setting before the face photo goes on (OI-57); no server route for the face photo (OI-65); the AI trial after launch (OI-33) with a monthly cap per shop first (OI-41); men's items wait for a men's shop and a real tee.

## D27 — The live 3D face may stay stylised

Founder decision (20 Nov 2026), on the question raised by `docs/research/realistic-avatar-route.md`: the face in the live 3D view may stay stylised, while the AI realism layer carries the photoreal face in the still. Consequence: the work on the realistic body goes into body shape, skin and lighting first; realistic hair and face geometry are not part of the spike, and the CC-BY hair question does not need an answer now.

## D28 — Hair: own-built, ten hair types in four lengths

Founder decision (21 Nov 2026). The live 3D view gets our own procedural hair (no third-party hair asset), stylised to match the stylised face of D27. Not four styles, but every combination of:

- **Ten hair types**, the common typing scale: 1 (straight), 2A, 2B, 2C (wavy, loose to defined S-waves), 3A, 3B, 3C (curly, loose loops to tight corkscrews), 4A, 4B, 4C (coily, defined coils to tight zig-zag coils with the most volume).
- **Four lengths:** short, chin, shoulder, long. For types 3C to 4C length is also volume: the hair grows out and up, not only down, and shrinks (a "long" 4C is an afro, not hair to the waist).
- **Colour** chosen by the shopper. Hair type, length and colour are shopper choices stored on the device only, like the skin tone; they are never inferred from a photo and never sent to a server.

The founder's reference chart (photos of real people) is a reference only: no photo or part of one is used as a texture or in the repo. The photoreal hair stays with the AI realism layer (D27). Performance bound: the hair adds no more than the body itself to the frame time and asset size; a type and length that does not fit within that is drawn simpler and labelled so in the report.

## D29 — Three AI builders, and Qwen stops at go-live

Founder, 22 Nov 2026. The build work is split across three AI agents.

| Agent | Role |
|---|---|
| Claude | Manager. Plans, writes work orders, merges, decides what goes to `main` and reports to the founder. |
| Google (Antigravity, on the founder's computer) | Supervisor and project manager. Reviews Qwen's work and the visual result, keeps the Linear board in order, and builds the heavy visual work. |
| Qwen (Qwen Code on the founder's computer, under the founder's QwenCloud Token Plan) | Workhorse. Builds the Linear issues labelled `Qwen`. |

- Google works in rounds when the founder's computer is on. It is never a step that Qwen's work waits on.
- Nothing reaches `main` without Claude's check.
- **Qwen is disconnected at go-live.** Before the first production deploy:
  - the Token Plan is cancelled and its keys are deleted in QwenCloud;
  - every Qwen key is removed from the cloud environment's network secrets;
  - Qwen Code is removed from the founder's computer, or its Linear connection is.
  - After that, no `qwen/*` branch is merged.
- Qwen never sees secrets or shopper data. The repo holds neither (D19, AGENTS.md rule 2).
- Qwen's code goes to Alibaba Cloud (Singapore region). That is accepted for the build phase only.

**Update, 22 Nov 2026.** The founder's QwenCloud key is a Token Plan key. It only works on `token-plan.maas.qwencloudapi.com`. Token Plan terms allow interactive use in coding and agent tools only, never automation scripts or headless batch calls. So:

- Claude does not run Qwen headless.
- Qwen runs in Qwen Code on the founder's computer. It takes its issues from Linear itself, like Google in Antigravity, and Linear stays the single point of control.
- Running Qwen from the cloud needs either a pay-as-you-go key on `maas.qwencloudapi.com`, or written permission from Alibaba.

