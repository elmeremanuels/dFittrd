# Decisions (ADR log)

Decisions taken when the project was handed over to the AI builder (Nov 2026). Each entry says what was decided, why, and what it rules out. Supporting research lives in `docs/research/`.

## D1 — Name: **Curtain** (renamed from Paskamer, Nov 2026)

The founder asked for every Dutch term to be English. "Paskamer" is Dutch for "fitting room", so the brand needed an English name. The literal translations are taken in this exact market: "Fitting Room" (a Shopify app and several iOS apps), "FitRoom" (fitroom.app, 1M+ users), "Tryroom" (a Shopify try-on app) and "Twirl" (a web dress try-on). "Curtain" has no try-on or sizing product in web searches. It keeps the fitting-room idea and carries the privacy promise in one word: what happens behind the curtain stays there (D3). Tagline: *your private fitting room*. Merchant button: "Try it on".

- Package scope: `@curtain/*`. SDK attribute: `data-curtain-product`. Shopify namespace `$app:curtain`, Woo meta `_curtain_*`. Placeholder domain `curtain.fit` (api., app., media.).
- Known weakness: "curtain" is also a home-furnishing product, so generic search results and some Shopify stores sell curtains. Use the brand with the tagline or a wordmark, never the bare word in ads.
- Dutch stays available as a translation (SDK `nl` strings, Shopify `nl.json`, Woo `nl_NL.po`) for Dutch shoppers and merchants. English is the default everywhere.
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
