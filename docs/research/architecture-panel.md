# Architecture panel (Nov 2026)

> Three independent architecture proposals (ship-fast, privacy-by-design, merchant-first) were judged by three lenses (solo-founder feasibility, privacy & correctness, merchant adoption & revenue). The decisions in docs/DECISIONS.md are the composite. Full proposals follow for reference.

## Judge verdict — winner: DressingRoom v1 — one backend, one PWA, two plugins (solo-founder cut)

- **DressingRoom v1 — one backend, one PWA, two plugins (solo-founder cut)** — 7.8
  - Strengths: Solo-founder feasibility: 8/10. Soundness: 7/10. This is the only proposal whose runtime surface one person can actually keep alive: ONE Fastify process (API + merchant API + SDK host + Shopify app + pg-boss jobs), ONE Postgres, ONE Caddy. No Redis/Valkey, no MinIO, no separate worker, no Turborepo, no second web framework, no OpenTelemetry stack, no git-lfs. The frontend deploy is an rsync; the backend deploy is `compose pull && up -d`; rollback is a tag. The technical bets are chosen to delete work rather than add it: Path B warps the flat-lay onto the user's OWN segmented front frame, which passes the §9 recognition test for free and removes SMPL-X/Anny mesh fitting, three.js, the ONNX regressor and the SMPL-X licence question from v1 in one move. Analytic ellipse girths + height/weight prior + inverse-variance fusion with manual entries is honest about accuracy (3–4 cm scan-only, ~1.5–2 cm fused) and is adequate for 4–6 cm size steps. Anonymous device JWTs remove email/password/reset infra. A single hosted provider (FASHN) behind an explicit opt-in, with the router and stubs present, means the bake-off is a config change later. The privacy architecture is enforced by construction (PersonInput.kind has no 'userPhoto' member; only one image-accepting route; capture in a Worker; AES-GCM base frame; same-origin model files; one-call GDPR erase). The tradeoffs section is the most self-aware of the three and every deferral (Capacitor, regressor, second provider, cohort from signatures, ads surface) names the slot that stays open for it. 'JOBS=1 second replica' is the right-sized scaling escape hatch. The founder could realistically have a dev store round-tripping a garment to a fit score by week 6 — which is exactly the handoff's §8 item 2.
  - Weaknesses: (1) The Shopify piece is the stalest part: a hand-rolled /shopify/auth → /shopify/callback authorization-code OAuth dance in a Fastify plugin. Shopify has moved new apps to managed installation / token exchange and declarative webhooks in shopify.app.toml; custom OAuth plus a 'static HTML + App Bridge CDN' admin page is more code AND more App Store review risk than using the current CLI template patterns. Proposal 3 is right that this matters. (2) Merchant identity for WooCommerce is undefined: the console lives at app.<domain>/merchant 'behind shop login' and keys are issued 'after signing up with shop domain', but the proposal has deliberately built no email/login infra. Something (magic link via a transactional mailer, or Stripe Checkout email as identity à la Proposal 3's Connect flow) has to be chosen and it is not. (3) The capture timeline (weeks 3–4: pose gating, multiclass segmentation at two angles, 12 cross-sections, Lab k-means skin/season, fusion/conflict UI, encrypted base frame, AND Path B with three Playwright visual tests) is the least believable two weeks in the plan; realistically 4–5 weeks solo. (4) Billing unit 'fit_session per distinct product in a swipe batch' is vague and gameable compared with Proposal 3's 'one try-on session with a fit result written, idempotent by intent'. (5) kept/returned only from user self-reporting in the wardrobe — no order attribution — so the merchant analytics and trueToSizeScore feedback loop are weak; schema has no slot for order outcomes. (6) webhook_log stores status only, not payload, so a failed Shopify sync cannot be replayed. (7) Serving sdk.v1.js only from the VPS puts the founder's box in every merchant page's critical path and would fail WP.org's no-remote-code rule if the plugin is ever listed there. (8) On-device head anonymisation + local face re-composite for hero renders is a clever but non-trivial extra in week 8; it should be an explicit optional. (9) Both platforms shipped end-to-end in consecutive weeks 5 and 6 is the single biggest schedule risk; neither Proposal 2 nor 3 does this.
- **DressingRoom — privacy-by-design, multi-tenant architecture (web/PWA first, VPS-hosted, native-ready)** — 5
  - Strengths: Solo-founder feasibility: 3/10. Soundness: 8/10. Architecturally the most rigorous document on the panel. The privacy claims are turned into engineering artefacts a solo founder could actually point to in a merchant sales call or a later DPIA: a Playwright e2e that completes onboarding with a synthetic video and asserts no request body > 8 KB and no image MIME ever leaves; ESLint boundary rules (getUserMedia only in packages/capture, ai-adapters importable only from api/worker, VITE_*KEY* fails the build); CSP connect-src pinned to api; a data-map generated from zod .describe()+pii tags with a CI diff gate; a per-(user,shop) pseudonym and an explicit grant sheet at pairing so a shop can never join users across shops; k≥20 aggregates; content_hash no-op upserts; webhook_inbox with payload for replay; retention sweep; `GET /me/export` for Art. 20. The erasure cascade and the 'losing the phone loses the scan, by design' framing are correct. The managed-cloud path (RLS and pg-boss carry over; MinIO→S3; Valkey→Redis) is genuinely config-only. The tradeoffs section is honest that server-side try-on is never literally 'nothing leaves'.
  - Weaknesses: This is a platform team's architecture, not a solo founder's. Count the moving parts on the VPS: caddy, api ×2, worker ×2, shopify-app (a SECOND framework — Remix — with its own server), merchant-console (a separate origin and build), postgres 17 with three roles + pg_partman, valkey, minio, pgbackrest sidecar, a migrate service, plus optional otel-collector/prometheus/grafana/loki and a GPU vton profile; secrets via sops+age; models via git-lfs. Every one of those is a thing that can be down at 3 a.m. for one operator. RLS with SET LOCAL per request, a non-owner api role and mandatory cross-tenant tests is real ongoing ops and query-shape discipline that buys nothing until there are two merchants. The on-device pipeline is maximal rather than minimal: MediaPipe + onnxruntime-web (webgpu→wasm) + three.js for an Anny mesh fit by Gauss-Newton on morph targets + a 4-view silhouette atlas + a 1024×1536 avatar render + thin-plate-spline warp with a WebGL2 fabric shader — scheduled for week 4 alongside keyframes, masks, girths and signature sync. That is months of work for one person, not one week, and the trained regressor it leans on cannot exist yet (BodyM is CC BY-NC; the proposal admits it). Hash-chained double-entry ledger, WebAuthn-style device challenge auth, magic links + passkeys, rooms tables, 13-month swipe partitions, SSE fan-out, per-shop region flags — all premature at zero users. The Shopify choice is stale: it specifies Remix + @shopify/shopify-app-remix, which Shopify has folded into the React Router 7 template (Proposal 3 is correct on this), so the founder would be scaffolding on a deprecated path. The 8 vCPU / 32 GB baseline VPS is 2–4× what the product needs. Billing introduces a server-side metered 'fit badge' path and a first-party pairing cookie on the merchant's domain — a second fit path and a new privacy surface, for a feature the founder did not ask for. Net: the ideas are excellent; the plan as written would still be in week 3 of its own schedule in month four.
- **DressingRoom — merchant-first architecture (plugin is the product, app is the sensor)** — 6.3
  - Strengths: Solo-founder feasibility: 5/10. Soundness: 8/10. The sharpest commercial thinking on the panel and the most current on platform facts. It correctly identifies that Shopify App Store and WP.org review queues are the real schedule risk and places both submissions at weeks 4–5 so a bounce can be absorbed, while custom distribution + a direct zip let the pilot shops run before approval. It uses Shopify managed installation (token exchange, no custom OAuth code), declarative webhooks in shopify.app.toml, bulkOperationRunQuery for the initial backfill, the React Router 7 template (correctly noting Remix was folded into it), Polaris web components, and $app:dressingroom metafields so the shop remains source of truth across uninstall/reinstall. The billing unit — one try-on session with a fit result written, idempotent by intent — is the only one of the three that Shopify usage records and Stripe meters count identically and that merchants understand. Order attribution via a hidden cart attribute `_dr_session` (Ajax Cart API) → orders/create + refunds/create → order_outcomes closes the kept/returned loop that trueToSizeScore and the merchant return analytics depend on; Proposal 1 has no equivalent. completenessScore with per-field reasons + a /merchant/garments/validate dry-run gives merchants inline feedback. Bundling sdk.js into the theme extension assets and the WP plugin zip satisfies WP.org's no-remote-code rule and takes the VPS out of the merchant page's critical path. go.<domain> redirect host with desktop smart banner, pendingIntent stored before onboarding completes, desktop QR status polling that flips to 'Your size: M' and selects the variant, physical-store pairing codes, Action Scheduler + HPOS compatibility, 'no telemetry before Connect' — all are details someone who has shipped a commerce plugin would know. Noting that the AGENTS.md Next.js warning belongs to an unrelated repo is correct.
  - Weaknesses: For the solo-founder lens it is still too much surface: six hostnames; apps/web + apps/api + worker + apps/console + packages/console-ui + apps/shopify (a React Router 7 node server) + apps/wordpress; Redis/BullMQ, MinIO, a Python rembg/BiRefNet imageprep container, restic backup container, pgvector, two api replicas, a migrate one-shot and three build one-shots. Two consoles (embedded + standalone) and two billing systems are argued convincingly as unavoidable, but they are still two of everything for one person. The sequencing inverts the founder's north star: five weeks of billing, attribution, consoles and review submissions happen before any capture or render exists, so the first pilot try-ons are manual-measurement text scores on a placeholder — the §1 'it looks like them / like the garment / like that garment on that body' promise, the thing the founder actually cares about, is not tested until week 8. Week 6 then crams the entire capture pipeline (face step, 8-s video gating, 4-view silhouettes, analytic girths, fusion, Anny mesh fit, atlas, Dexie, signature sync, PWA offline) into one week, and week 7 crams Path B for six categories plus the whole ai-adapters package plus hero render — neither is credible. Week 2 (bulk sync + imageprep + Polaris form + metafield definitions + completeness queue) is similarly optimistic. read_orders + Protected Customer Data approval adds a Partner Dashboard review step on the critical path. Ads/promoted items in /deck, predictions table, pgvector, physical-store pairing, CSV import — all nice, none needed before the first paying merchant. 'App is the sensor' is a defensible revenue framing but it is not the founder's product; the handoff is explicit that the render quality is what prevents returns.

**Grafts:**

- From P3 — Shopify install mechanics: keep P1's single Fastify process, but replace the hand-rolled /shopify/auth → /shopify/callback authorization-code OAuth with Shopify managed installation / token exchange and declarative webhooks in shopify.app.toml (incl. the three GDPR topics). @shopify/shopify-api supports token exchange, so this is less code than P1 wrote and removes the main App Store review risk.
- From P3 — treat review queues as the critical path: use a custom-distribution install link for the pilot Shopify store from week 5 so approval never blocks the pilot, and still submit the App Store listing (privacy policy, GDPR webhook tests) as soon as the end-to-end works; keep a direct-download zip for the pilot Woo store and decide on WP.org listing later.
- From P3 — bundle sdk.js into the theme app extension's assets/ and into the WooCommerce plugin zip at build time (a copy step from packages/sdk), keeping /sdk/v1.js only for custom/headless shops. This takes the VPS out of every merchant page's critical path and satisfies the WP.org no-remote-code rule for free.
- From P3 — define the billing unit as one try-on session: a `try_sessions` row becomes billable only when the app PATCHes it with a fit result, idempotent by intent/token. Replace P1's 'fit_session per distinct product in a swipe batch' with this; it is the unit Shopify appUsageRecordCreate and a Stripe Billing Meter count identically.
- From P3 — order attribution, schema now and webhooks in week 7: have the SDK set a hidden cart attribute `_dr_session` via /cart/update.js (Shopify) or a `dr_session` cookie copied to order meta at woocommerce_checkout_create_order (Woo); add an `order_outcomes` table (ordered/kept/returned, kept = 30 days without refund) fed by orders/create + refunds/create and POST /v1/merchant/orders. This closes the kept/returned loop that trueToSizeScore and recommendSize history need, instead of relying on users marking wardrobe items.
- From P3 — `completenessScore(garment)` with per-field reasons in packages/schema and a POST /v1/merchant/products/validate dry-run endpoint, so the Woo meta box and the Shopify admin page show inline 'missing ease, size chart has no shoulder' feedback and the console's completeness queue is computed from one function.
- From P3 — Woo merchant identity via a Connect round-trip: plugin POSTs /merchant/woo/connect {siteUrl, nonce} → redirect to the console → Stripe Checkout (the Stripe customer email is the merchant identity, no separate login system) → /merchant/woo/complete returns sk/pk in a one-time signed token the plugin stores encrypted. This fills P1's undefined 'shop login' gap without building email auth.
- From P3 — a `go.<domain>/t/:token` redirect host that 302s to the PWA route, marks the session 'opened', serves a smart-banner fallback on desktop UAs; store a `pendingIntent` in IndexedDB so a shopper who arrives before onboarding resumes the try-on after capture. Desktop QR status polling ('Your size: M · estimate' + variant preselect) is a v1.1 follow-up on the same rows.
- From P3 — initial Shopify backfill with bulkOperationRunQuery + bulk_operations/finish webhook (JSONL download) instead of walking products at 2 req/s; and store the webhook payload in P1's webhook_log so failed syncs can be replayed.
- From P2 — the Playwright privacy e2e: run onboarding in Chromium with --use-fake-device-for-media-stream and a synthetic .y4m, intercept all traffic, assert only /models/* GETs + /v1/devices + PUT /v1/me/signature occur, no request body > 8 KB, no image MIME anywhere. One test, runs on every PR, and gives the founder a provable 'raw photos never leave' claim.
- From P2 — the cheap build-time guards: packages/tryon-providers package.json `"browser": false` + ESLint no-restricted-imports outside apps/api; getUserMedia/MediaRecorder allowed only in features/capture; any VITE_ env name containing KEY/SECRET fails the build; CI greps the built web bundle for 'FASHN_', 'sk_', 'STRIPE' strings (P3 has the same grep).
- From P2 — per-(device, shop) pseudonym column on `pairings` and a grant sheet at pairing time ('Share your fit signature with Aalter Studio? They see sizes that fit you, never your measurements or photos'); merchant analytics and the merchant ledger key on the pseudonym, never on device_id, so shops can never join users across shops.
- From P2 — `content_hash` on products so unchanged upserts are no-ops, plus a nightly retention sweep job that also prunes webhook_log (> 90 days) and expired try_sessions, extending P1's pruneRenders cron.
- From P2 — `GET /v1/me/export` (Art. 20 JSON of signature meta, swipes, wardrobe, ledger) next to DELETE /v1/me; it is a few lines over the same tables and it completes the GDPR story the ledger starts. Skip the hash chain and the generated data-map for v1; add a `pii` tag to zod fields now so the data-map script is a one-day task later.
- From P2 and P3 — sequence one platform first: do whichever platform the first pilot shop runs end-to-end in week 5 and the second in week 7 (P1 schedules both in consecutive weeks 5–6, its biggest schedule risk). Use the freed week for capture, which is under-budgeted in every proposal.

**Synthesis:** Judged through the solo-founder-feasibility lens, Proposal 1 wins clearly, and it is not close. The prototype today is ~1,060 lines of mocked React with a 56-line fit heuristic, no capture, no backend and a Gemini key compiled into the client bundle. Whatever is chosen has to be built by one person who also has to be the merchant-support desk and the on-call. Proposal 1 is the only plan that treats that as the binding constraint: one process, one database, one reverse proxy, no Redis, no object store, no worker tier, no second web framework, no observability stack. Its two cleverest bets both delete work rather than add it — warping the flat-lay onto the user's own segmented front frame passes the recognition test without SMPL-X/Anny mesh fitting, three.js, an ONNX regressor or a model licence; anonymous device JWTs remove the entire email/password/reset surface. Its tradeoffs section is the most honest of the three and every deferral leaves a slot open.

Proposal 2 is the best architecture document and the worst plan for this founder. Its privacy mechanisms (Playwright no-image-bytes e2e, ESLint boundary rules, per-shop pseudonyms, grant sheet, generated data-map) are excellent and several are cheap enough to graft. But the runtime it specifies — Remix (stale; Shopify folded it into the React Router 7 template), a separate console origin, MinIO, Valkey, pgbackrest, RLS with three roles, pg_partman, hash-chained ledgers, WebAuthn device auth, Anny mesh fitting with a trained regressor that cannot exist yet — is a platform team's year, scheduled as a solo founder's eight weeks. It would still be in its own week 3 by month four.

Proposal 3 is the most commercially literate and the most current on platform facts (managed installation, declarative webhooks, RR7 template, bulk operations, WP.org rules, review queues as critical path, cart-attribute order attribution, session-based billing). Those are precisely the things a solo founder gets wrong from training-data memory, which is why most of the grafts come from it. But its surface (six hostnames, two consoles, Redis, MinIO, a Python rembg container, two api replicas) is still too much, and its sequencing defers the founder's actual product — a render that looks like them, like the garment, like that garment on that body — to weeks 6–8, where it then crams months of capture and render work into two weeks.

The composite recommendation: ship Proposal 1's runtime and sequencing, but (a) swap its hand-rolled Shopify OAuth for managed installation + declarative webhooks, (b) bundle sdk.js into both plugins, (c) adopt the try-on-session billing unit and the `_dr_session` order-attribution schema, (d) use Proposal 3's Connect/Stripe round-trip to give Woo merchants an identity without building login, (e) add Proposal 2's Playwright privacy e2e, build-time secret/boundary guards and per-shop pseudonym, and (f) do one platform in week 5 and the other in week 7, spending the freed week on capture. Even so, the founder should expect the eight-week plan to be 12–16 weeks of solo work; the honest schedule risk in all three proposals is the on-device capture pipeline, not the backend.

## Judge verdict — winner: DressingRoom — privacy-by-design, multi-tenant architecture (web/PWA first, VPS-hosted, native-ready)

- **DressingRoom v1 — one backend, one PWA, two plugins (solo-founder cut)** — 6.5
  - Strengths: Most honest about what can actually be built by one person in 8 weeks, and the simplest system to keep correct: one Fastify process, pg-boss in-process (no Redis), Caddy, Postgres. Correctly deletes the prototype's client-side Gemini wiring (@google/genai, express, dotenv, the vite `define` block). Several privacy mechanisms are genuinely by-construction: `PersonInput.kind` has no 'userPhoto' member at the type level (the strongest of the three on this point); capture runs in a worker and only one still persists, AES-GCM with a non-extractable key; models and fonts same-origin so onboarding makes zero third-party requests; anonymous device accounts with no email; one-call DELETE /v1/me; cohort bars derived from wardrobe states, explicitly never from signatures; no server-side fit path at all, so no measurement-probing surface exists. Path B on the user's own segmented frame is the cheapest way to pass the recognition test, and it is privacy-neutral because it never leaves the device.
  - Weaknesses: The hero path breaks the handoff's non-negotiable: what is sent to FASHN is the user's real segmented body photo with the head blurred, i.e. a lightly processed raw photo, not a synthetic avatar. 'The route rejects any image whose metadata flag `kind` is not avatarRender' is a client-set label, not a construction guarantee; and 'FASHN leaves the head region untouched' is an unverified assumption the local face re-composite depends on. Merchant console shares the consumer PWA origin, so a merchant session on the same browser shares the IndexedDB origin that holds the encrypted base frame and its (non-extractable but same-origin-usable) key. SDK endpoint is CORS * and authenticated only by a non-secret key prefix, so anyone can mint try sessions and pairings for a shop. Shopify `shop/redact` is lumped into 'answer 200 with nothing to return', which is wrong: it requires purging the shop's data. Merchant swipe analytics have no k-anonymity floor, so a 10-tester pilot shop can see near-individual behaviour. COOP/COEP is justified for 'SIMD wasm' (it is needed for SharedArrayBuffer/threads, not SIMD) and will break cross-origin flat-lay images unless CORP headers are added. No CSP connect-src allow-list, no automated test that image bytes never leave, no data map; the privacy story is policy plus code review rather than CI-enforced.
- **DressingRoom — privacy-by-design, multi-tenant architecture (web/PWA first, VPS-hosted, native-ready)** — 7.5
  - Strengths: The only proposal that turns 'raw photos never leave the device' into something a CI job can fail on: CSP `connect-src 'self' https://api.<domain>` enforced by the browser; a Playwright privacy e2e that intercepts onboarding traffic and asserts no image MIME and no large bodies; ESLint boundary rules (getUserMedia only in packages/capture, ai-adapters importable only by api/worker, VITE_ names containing KEY/SECRET fail the build); a zod-driven data map with pii tags that gates PRs. Hero input is a synthetic avatar render from a mesh, never a photo, and the server validator rejects anything not 1024×1536 or carrying EXIF/ICC. Tenant isolation is real: RLS with the api role unable to bypass, separate migrator role, no FK from tenant.* to app.users, per-(user, shop) pseudonyms, k≥20 aggregates, cross-tenant tests. Taste engine never syncs. Hash-chained ledger with a verify endpoint; erasure cascade incl. object storage; nightly retention sweep; partitioned swipes with 13-month retention; backups contain no media by construction. Local-store types have no slot for video frames.
  - Weaknesses: Three correctness holes undercut the privacy claims. (1) `PersonInput.kind === 'userPhoto'` is accepted under heroOptIn: the router permits a raw user photo, and only the route validator's dimension check stands between that and a provider. P1 removes the member from the type; P2 should too. (2) `POST /merchant/fit {pseudonym, productId}` and `/sdk/badge` return P(fit) per size to the merchant/merchant page; a merchant can create synthetic products whose size charts vary one point by 1 cm and recover the user's girths to the quantisation step. 'No measurements returned' is false in effect; nothing rate-limits or restricts this. (3) The tier allow-list sends the default 'avatar' tier to hosted FASHN/Vertex/Nano Banana, and composite.ts bakes the face tile into the avatar render; the blurred-face variant is 'optional'. So identity-bearing imagery can go to a US-hosted provider without the per-render consent the text promises for Tier 3. Smaller errors: `customers/redact` is said to map to erasure 'via pseudonym', but Shopify sends the shop's customer id and no such mapping exists by design (should be no-op + log, as P3 states); `shops.region` picks processors, but residency is the user's concern, not the shop's; k≥20 with a 10-tester pilot shows nothing and has no override; Remix + shopify-app-remix is the superseded template (now React Router 7). Soundness is the weak side: Turborepo, Valkey, MinIO, pgBackRest, OTel stack, a separate worker app, a separate console app, a Remix app, Anny mesh fit + ONNX regressor + 4-view atlas by week 4, all for one founder; the 8-week plan is not credible, and 'users' with email_hash/email_enc adds a PII class the handoff never asked for.
- **DressingRoom — merchant-first architecture (plugin is the product, app is the sensor)** — 7
  - Strengths: Most platform-correct of the three: React Router 7 Shopify template (not Remix), managed installation/token exchange, declarative webhooks in shopify.app.toml, `$app:dressingroom` metafield namespace so the shop stays source of truth across uninstall, bulk operations for backfill, Managed Pricing correctly rejected because it cannot meter, Protected Customer Data at minimum level, GDPR topics handled correctly (customers/redact no-op+log, shop/redact purge 48 h after uninstall). WP.org constraints are respected (no remote code: SDK bundled into both plugins, External services disclosure, no telemetry before Connect, Action Scheduler, HPOS, uninstall.php) and the review queues are placed on the critical path. Billing per try-on session is the privacy-aligned unit: because fit is computed on-device, 'per API call' would bill nothing and push the design toward server-side fit. Ads are targeted by the on-device taste engine so the merchant never receives targeting data. Per-shop granular consent (signatureFit, swipeEvents, colourSeason). CI greps client bundles for secret patterns plus a runtime browser guard on ai-adapters. Non-commercial VTON models banned by lint. Correctly notes the AGENTS.md in /home/user/CV-Builder-Bold is for an unrelated project.
  - Weaknesses: Its reason to exist creates identity linkages the other two avoid. `_dr_session` cart attribute plus orders/create and refunds/create means our DB holds (merchant order id ↔ pseudonymous user) while the merchant holds (order id ↔ name, email, address): a two-table join away from re-identifying every consumer. `GET /sdk/intents/:id/status` hands recommendedSize and fitScore for one identifiable session to the merchant's page in real time, and that page's JS belongs to the merchant. `webhook_inbox.payload jsonb` stores the raw orders/create payload for 30 days; depending on the approved Protected Customer Data level it carries customer fields, contradicting 'we never store customer name/email/address'. Merchant ledger k-anonymity is only ≥5. Local IndexedDB encryption is 'optionally' AES-GCM, a weaker commitment. `vector(80)` on fit_signatures is 'insurance' for a cross-user body kNN that is itself a sensitive feature nobody has consented to. The deferred `/sdk/size-hint` has the same measurement-probe exposure as P2's merchant fit. Soundness: the consumer capture and Path B render arrive in weeks 6–7, so the founder's three §9 tests (recognition, fabric, size) are attempted in the last fortnight; six hostnames, Redis, MinIO, imageprep, a Shopify node server and two consoles is a lot of surface for one operator; feeding a Path-B-warped composite to FASHN as the 'model' photo is unproven.

**Grafts:**

- From P1: remove 'userPhoto' from the PersonInput union at the type level (not a router policy) and give the on-device base frame a distinct branded type the API client cannot serialise, so the only thing POST /renders can ever carry is the synthetic avatar render.
- From P1: collapse the runtime to Caddy + one api image (pg-boss in-process, JOBS=1 env for a jobs-only replica later) + Postgres; drop Valkey, MinIO, pgBackRest, the OTel profile and the separate worker/console apps from v1. Keep P2's RLS, pseudonyms, CSP, privacy e2e, data map and ledger; those are code, not containers.
- From P1: ship the analytic ellipse + height/weight prior + inverse-variance fusion as the week-3/4 measurement path and keep Path B warping onto the user's own segmented front frame as the on-device-only recognisability path; move Anny mesh fit, ONNX regressor and 4-view atlas to post-MVP. The silhouette atlas slot stays so the mesh renderer can replace the base frame later.
- From P1: make on-device head anonymisation + local face re-composite mandatory (not optional) whenever the provider is hosted, strip the face tile before egress, and require the per-render consent sheet for every hosted provider regardless of tier; the 'avatar' tier allow-list must not include hosted providers without that acknowledgement.
- From P1: cohort bars and 'bodies like yours' derive only from wardrobe states, never from fit_signatures; drop pgvector-style kNN over signatures from the roadmap unless separately consented.
- From P3: adopt the Shopify platform facts verbatim: React Router 7 template (@shopify/shopify-app-react-router), managed installation/token exchange, declarative webhooks in shopify.app.toml, $app:dressingroom metafields so the shop remains source of truth, bulk operations for backfill, Billing API usage line with cappedAmount (Managed Pricing cannot meter), Protected Customer Data at minimum level, customers/redact = no-op + log, shop/redact = purge 48 h after uninstall.
- From P3: bundle the SDK into the theme app extension and the WordPress plugin assets instead of serving it from cdn.<domain>; satisfies the WP.org no-remote-code rule and removes a third-party request from every merchant product page. Keep the CDN copy only for custom/headless integrations.
- From P3: bill per try-on session (one product resolved by one user, idempotent by intent id, counted only when a fit result exists) instead of per fit_call; this keeps fit computation on-device without starving the billing meter and removes the incentive to build the server-side /merchant/fit path.
- From P3: per-shop granular consent at pairing time (signatureFit, swipeEvents, colourSeason) with colour-season label shared only on explicit toggle; pendingIntent stored when the deep link arrives before onboarding is finished.
- From P3: CI step that greps every client bundle (web, console, Shopify app client) for sk_/FASHN_/VERTEX/XAI_ patterns, plus the runtime `typeof window` guard in ai-adapters; and the ESLint rule banning IDM-VTON/OOTDiffusion/CatVTON/FitDiT from the provider registry for licence reasons.
- From P3: submit to Shopify App Store and WP.org review by weeks 4–5 with custom-distribution and direct-zip fallbacks for the pilot shops; replay GDPR webhooks from signed fixtures in CI; monthly restore drill.
- From P3 (with modification): if order attribution is adopted for the kept/returned loop, disclose it in the grant sheet, store only an HMAC of the merchant order id on the consumer side (never the raw order id), strip customer fields from the orders/create payload before it is written to webhook_inbox, and never return per-session size or fitScore to the merchant page; deliver the variant pre-select to the user's own browser only after the per-shop consent toggle.
- Required fix to the winner (not a graft): either drop POST /merchant/fit and /sdk/badge from v1, or bound them: published products only, size chart content_hash frozen for 24 h before a product is fit-queryable, per-pseudonym daily cap, coarse P(fit) buckets, and a ledger row the user can see per call. Make k-anonymity configurable (k=20 default, pilot override) and move the residency/processor choice from shops.region to a user-facing consent that names the processing region.

**Synthesis:** Through a privacy-and-correctness lens the handoff sets one hard rule (raw photos and video never leave the device; only the ~80-float signature and swipe events sync) and one delegated constraint (AI keys server-side only). All three proposals delete the prototype's client-side Gemini wiring and put AI keys behind the API, so the key rule is met everywhere; the differentiator is whether the photo rule is enforced by construction or by policy, and whether the merchant-facing surfaces leak body data by inference.

P2 wins because it is the only design where the non-negotiable is verifiable: a browser-enforced CSP, an e2e test that fails if an image MIME or large body leaves during onboarding, lint boundaries on getUserMedia and ai-adapters, a generated data map that gates PRs, a type system with no slot for frames, a synthetic avatar as the only image the server accepts, RLS that the api role cannot bypass, per-shop pseudonyms and an append-only hash-chained ledger. But it must be corrected before it is built: it still lets 'userPhoto' through the router under heroOptIn, its merchant fit/badge endpoints are a measurement-probing oracle, its default avatar tier can reach hosted providers with the face tile composited in and no per-render consent, and its customers/redact mapping cannot exist. It is also badly overbuilt for a solo founder and leans on the superseded Remix template; its 8-week sequence is not credible.

P1 is the most buildable and has the best type-level guard (no 'userPhoto' member), but its hero path sends the user's real segmented body photo with a blurred head, which is a processed raw photo and a direct deviation from §2.2; its 'kind' flag check is a label not a guarantee; and it gets shop/redact wrong, has no k-anonymity floor and no CI-enforced privacy test. P3 is the most platform-correct (Shopify RR7 template, managed install, declarative webhooks, Protected Customer Data, WP.org rules, correct GDPR topic semantics) and its session-based billing is the privacy-aligned meter, but its core mechanism, order attribution plus per-session size/fitScore to the merchant page plus raw order payloads in webhook_inbox, builds a re-identification bridge between our pseudonymous users and the merchant's customer records, and it only attempts the founder's §9 render bar in the last two weeks.

The recommended build is therefore P2's privacy skeleton (CSP, privacy e2e, data map, RLS, pseudonyms, ledger, synthetic-avatar-only renders) on P1's runtime (one api image with pg-boss, Caddy, Postgres; analytic measurements first, Path B on-device on the user's own frame, mesh fit later) with P3's platform facts, bundled SDK, session billing unit, granular pairing consent, and early review submissions. Order attribution and any server-side fit from the signature should be either dropped from v1 or bounded as listed in the grafts, because those are the two places where the otherwise strong 'shops never see a measurement' claim quietly becomes false.

## Judge verdict — winner: DressingRoom — merchant-first architecture (plugin is the product, app is the sensor)

- **DressingRoom v1 — one backend, one PWA, two plugins (solo-founder cut)** — 6
  - Strengths: Merchant lens 5 / soundness 8. The most shippable plan: one Fastify process, one Postgres, Caddy, no Redis/MinIO/worker, CI to GHCR — a solo founder can actually run this at 3 a.m. Pricing is simple and explainable (Starter €29 incl. 500 fit sessions, €0.05 overage, 14-day trial) and uses the mandatory Shopify Billing API plus Stripe for Woo; 'below plan → paused screen but never break the merchant page' is exactly right. Both platforms round-trip a real SKU by week 6, which is realistic. Metafield namespace mirrors the payload so the shop stays source of truth. Shopify GDPR webhooks correctly answered as 'we hold no customer PII'. The capture pipeline comes early (weeks 3–4) so the shopper-side demo merchants evaluate is credible before the first install.
  - Weaknesses: It cannot tell a merchant whether DressingRoom made them money. Order attribution (orders/paid, refunds) is explicitly post-MVP and 'kept/returned' comes only from shoppers self-reporting in the wardrobe, so the prototype console's Conversion and Return Rate tiles — the thing a merchant renews on — cannot be populated. The SDK 'only learns opened': nothing flows back to the PDP, so no variant preselect, no size chip, no conversion lift on the merchant's own page. Billing counts a 'fit session' per distinct product in POST /v1/swipes, which means deck browsing inside the app bills the merchant for sessions they never initiated — a dispute waiting to happen. The embedded Shopify admin is one static HTML page with App Bridge (no onboarding checklist, no 'complete your garments' queue) and the merchant console lives inside the mobile-first consumer bundle; both will read as amateur in App Store review and in a merchant's first 20 minutes. The Woo plugin injects sdk.v1.js from api.<domain> and there is no WP.org submission plan at all — zip-only distribution caps Woo adoption, and remote-script loading would need justification if they ever submit. Shopify app written as a hand-rolled Fastify plugin (custom OAuth) rather than managed install + declarative webhooks adds review risk and maintenance. Only one pricing tier and no ad or prediction surface, so the founder's revenue levers beyond subscription are schema-only.
- **DressingRoom — privacy-by-design, multi-tenant architecture (web/PWA first, VPS-hosted, native-ready)** — 5
  - Strengths: Merchant lens 4 / soundness 7. The strongest privacy-as-a-selling-point story for EU brands: Postgres RLS with a non-owner api role and cross-tenant tests, per-(user,shop) pseudonyms, a generated data map and DPIA/ROPA docs, a Playwright e2e asserting no image bytes leave during onboarding, a per-shop region flag that drops US-processed providers, per-shop daily AI cost caps and a circuit breaker in the router. These are the artefacts an enterprise procurement/security questionnaire asks for. Batch upsert with per-item errors and content_hash no-op upserts, a product health endpoint (missing fields + flat-lay quality), an 'abandoned opens' analytics endpoint (the founder's 'afgebroken sales'), Sunset/Deprecation headers and SRI on the SDK are all good merchant-API hygiene. Separate console origin with shared @dressingroom/ui is the right shape.
  - Weaknesses: Its billing model would bill almost nothing. Plans are priced on 'fit calls', but fit runs on-device in the main flow; fit_calls are only generated by /sdk/badge and /merchant/fit, which require a pairing cookie the SDK somehow sets on the shop domain after the user pairs on a different device — an unexplained mechanism. The core try-on (sdk_open → app → on-device fit) is therefore free, the Free tier includes 500 of the rare metered calls, and overage is €0.004. Revenue is structurally decoupled from value delivered. No order webhooks at all, so no conversion or return attribution — kept/returned is user self-report, same ROI gap as P1. k≥20 anonymity on every merchant aggregate means a typical small Shopify store (dozens of try-ons a month) sees an empty dashboard for months — the cohort of merchants most likely to install gets the least insight; the author concedes this. Merchant integration is sequenced last and the platform choice is deferred ('whichever the pilot shop runs', the other in week 7), billing in week 7, so first revenue is week 8 at best and a Shopify review bounce falls outside the eight weeks. The Shopify app is on the Remix template, which Shopify folded into the React Router 7 template in 2025 — new code on a deprecated base. A grant sheet ('Share your fit signature with Aalter Studio?') sits in the handshake critical path and will cost completion rate. Operationally this is the heaviest plan (Turbo, RLS roles, Valkey, MinIO, pgBackRest, OTel/Prometheus/Loki, hash-chained ledger, data-map CI gate, Remix app server, two api + two worker replicas) for one founder, and the capture pipeline includes an Anny mesh fit and ONNX regressor that are not needed to pass the handoff's §9 tests in v1.
- **DressingRoom — merchant-first architecture (plugin is the product, app is the sensor)** — 8
  - Strengths: Merchant lens 8.5 / soundness 7. The only proposal whose data model can populate the prototype's console: orders/create + refunds/create (Shopify) and checkout/refund hooks (Woo) carry a hidden _dr_session attribute into order_outcomes, a nightly rollup marks 'kept' after 30 days, analytics_daily feeds conversion, return rate, size heatmap vs ordered vs returned, conflicts, and feeds trueToSizeScore back to the merchant ('runs small: 23% returned M after we recommended L'). That is the renewal argument. The billing unit — one try-on session, counted only once a fit result is written, idempotent by intent, identical under Shopify usage records and Stripe meters — is the only pricing in the panel that is both explainable and aligned with value; Starter/Growth/Scale with €0.05 overage, hero renders as pass-through, and an ad CPM give three revenue levers. The handshake closes the loop on the merchant's page: desktop QR polls /sdk/intents/:id/status, shows 'Your size: M · estimate', preselects the variant and sets the cart attribute — real conversion lift on the PDP, not just an app open. Shopify work is current and review-literate: managed installation, declarative webhooks in shopify.app.toml, React Router 7 template, Polaris web components, bulkOperationRunQuery backfill, metafieldsSet so data survives uninstall, an onboarding checklist that deep-links to the theme editor, a 'Complete your garments' queue driven by completenessScore, CSV import, a dry-run /merchant/garments/validate for inline form errors. The WooCommerce plan is the only one that can pass WP.org review (bundled SDK, no telemetry before Connect, External Services disclosure, HPOS, Action Scheduler, uninstall.php) and it schedules both store reviews at weeks 4–5 so a bounce can be fixed inside the eight weeks, with custom-distribution/zip for the pilot meanwhile. k≥5 aggregates mean small shops see data. Physical-store pairing code is a cheap extra sales channel.
  - Weaknesses: Scope is the risk. Six hostnames, Redis + BullMQ, MinIO, a rembg container, pgvector, a React Router 7 node server, a standalone console and an embedded one, WP.org SVN automation, k6, restic — a lot of moving parts for one operator, and some are unjustified for v1 (pgvector 'insurance', a separate go. host, Redis just for 10-minute intents). The consumer side is starved: capture arrives in week 6 and Path B in week 7, so the Shopify reviewer in week 4 and the week-8 pilot merchants evaluate a shopper experience that ran on manual measurements only weeks earlier — merchants judge the product by what their shoppers see, and the recognition/fabric/size bar gets one week. read_orders plus Protected Customer Data approval is an extra Partner Dashboard step the plan acknowledges but does not schedule. Billing every session with a fit result still charges for bounces that happen after the fit (included quota mitigates, but merchants will ask). Minor technical slips: zod 4 with zod-to-json-schema (zod 4 has native JSON Schema; the old package does not support it), and the consent screen is in the handshake path like P2 (though lighter).

**Grafts:**

- From P1: collapse the runtime to one process for v1 — replace BullMQ+Redis with pg-boss in the api process (JOBS=1 env lets a second replica take jobs only), keep intents in Postgres with a 10-minute TTL instead of Redis, and serve go.dressingroom.app routes from the api host. Same Caddy + Postgres + api image; MinIO and rembg can stay as the only extras. This removes two services and one failure mode from P3 without touching its merchant surface.
- From P1: pull consumer capture forward. P1 ships measurements in week 3 and face/skin + Path B first cut in week 4; P3 can do the same by moving the Woo plugin/WP.org submission from week 5 to week 6 and the standalone console to week 7 (Woo merchants in the pilot can use the direct-download zip and Stripe Checkout link without the console). Shopify review in week 4 and the week-8 pilot then show real renders, which is what merchants actually evaluate.
- From P1: 'never break the merchant's page' — when a shop is past_due or past its cap, the SDK still renders the button and the deep link shows a 'shop paused' screen; P3 only specifies soft limits for Woo. Make this explicit for Shopify too (cappedAmount reached → sessions continue, overage stops accruing, email the merchant).
- From P1: the explicit products.status 'incomplete' + missing_fields[] column and per-product completeness surfaced in the embedded admin on day one (P3 has completenessScore but the week-2 checklist should show it per product before any form exists). Also P1's rsync web deploy (5-second frontend-only deploy) and single-cert Caddyfile.
- From P2: the privacy proof artefacts as sales collateral for EU brands — the Playwright e2e that intercepts all onboarding traffic and asserts no image MIME / no body > 8 KB, the generated data-map → DPIA/ROPA/sub-processor list, and the ESLint boundary rule that fails the build if ai-adapters is imported from a browser package. These cost ~2 days and answer the security questionnaire a mid-size brand will send before paying for Growth.
- From P2: per-shop region flag ('eu' | 'any') that removes US-processed providers (xAI, hosted FASHN) from the TryOnRouter allow-list, plus the per-shop daily AI cost cap and the 60 s circuit breaker. Hero renders are pass-through billed in P3, so a runaway provider directly produces a merchant invoice dispute; the cap prevents it.
- From P2: Postgres RLS on every shop_id table with a non-owner api role and a cross-tenant integration test. P3 relies on application-level scoping only; RLS is cheap now and is the first thing an enterprise brand's security review asks about. Also P2's content_hash no-op upsert for product-sync (avoids re-running imagePrep on every Shopify webhook) and GET /merchant/products/:id/health with flat-lay quality, not just missing fields.
- From P2: GET /merchant/analytics/abandoned (sdk open → no save, aggregated). P3 stores intent status 'abandoned' and tryon_sessions.outcome but has no console surface for the founder's 'afgebroken sales analyseren'; add it to analytics_daily and console-ui.
- From P2: Sunset/Deprecation headers and X-DR-Schema-Version on the merchant API, SRI hash published for cdn.dressingroom.app/sdk.js, and GET /sdk/config button-copy overrides — small things that make the custom/headless integration path (Etsy/Amazon-style merchants on the founder's list) credible.
- Fix in the winner itself: drop pgvector (vector(80) can be real[80] until kNN is actually queried), swap zod-to-json-schema for zod 4's native z.toJSONSchema, and add the Protected Customer Data request to the week-4 submission checklist so read_orders is approved before the week-8 pilot needs attribution.

**Synthesis:** Through the merchant-adoption-and-revenue lens the decisive question is: can a merchant install in 20 minutes, see their shoppers convert on their own product page, and see proof of ROI (conversion, return rate) in a console that justifies the invoice? Only P3 answers all three. Its order/refund attribution via a hidden cart attribute is what lets the prototype's console tiles be real numbers; its session-based billing is the only pricing on the panel that is both explainable and tied to value (P2's 'fit calls' metric would bill almost nothing because fit runs on-device, and P1 bills merchants for in-app deck swipes they never initiated); its desktop QR → status poll → variant preselect is the only flow that creates conversion lift on the PDP rather than just an app open; and it is the only plan that is current on Shopify (managed install, declarative webhooks, React Router 7 template) and can pass WP.org review (bundled SDK, no telemetry before Connect), with both reviews scheduled early enough that a bounce fits inside the eight weeks. P1 is the most honest about what one founder can operate and should be mined for its runtime simplicity and its earlier consumer-capture schedule, because P3's biggest weakness is that the 'sensor' — the shopper experience merchants actually judge — arrives in weeks 6–7. P2 is the strongest privacy and multi-tenant engineering document but, as a revenue plan, it decouples price from value, hides data from small merchants behind k≥20, has no order attribution, and defers the merchant integration to the end. Recommendation: build P3's merchant surface (billing unit, attribution, analytics_daily, Shopify RR7 app, WP.org-compliant plugin, two consoles on console-ui) on P1's runtime (single api process with pg-boss, Postgres-held intents, Caddy, no Redis), pull capture and Path B forward into weeks 3–4 by sliding the Woo/console work one week later, and add P2's RLS, region flag, cost cap and privacy proof tests as the EU-brand sales collateral.

---

## Proposal: DressingRoom v1 — one backend, one PWA, two plugins (solo-founder cut)

_Ship-fast solo-founder pragmatism. Every decision below is chosen to minimise the number of things that can be down at 3 a.m.: ONE Node process (Fastify) that is the app API, the merchant API, the SDK host, the Shopify app backend and the job runner; ONE Postgres; ONE Caddy for TLS and static files. No Redis, no separate worker, no CDN, no Remix, no React Native. The consumer app stays the existing Vite+React 19+Tailwind 4 code, moved into a monorepo and turned into an installable PWA. The body scan is on-device MediaPipe with an analytic measurement baseline (no trained regressor, no 3D mesh in v1). Path B rendering is a Canvas 2D mesh warp of the merchant flat-lay onto the user's OWN segmented front frame, done on the phone, which passes the handoff's recognition test for free. Neural try-on is a single hosted adapter (FASHN) behind an explicit opt-in. Target: a Shopify dev store and a WooCommerce store both round-tripping a real garment payload to a real fit score by end of week 6._

### Layout

pnpm 10 workspaces, no Turborepo (root scripts call `pnpm -r --filter`), TypeScript project references via tsconfig.base.json, vitest everywhere, one GitHub Actions workflow (test + build + docker build + push to GHCR).

```
dressingroom/
├─ package.json                  # workspaces root; scripts: dev, build, test, typecheck, db:migrate, release
├─ pnpm-workspace.yaml           # apps/*, packages/*
├─ tsconfig.base.json
├─ .github/workflows/ci.yml
├─ docs/HANDOFF.md
├─ apps/
│  ├─ web/                       # consumer PWA = the existing Vite prototype, moved here
│  │  ├─ index.html
│  │  ├─ vite.config.ts          # react + tailwind + vite-plugin-pwa; the Gemini `define` block is deleted
│  │  ├─ public/models/          # self-hosted @mediapipe/tasks-vision wasm + pose_landmarker_full/lite, selfie_multiclass_256x256, face_landmarker (fetched by scripts/fetch-models.sh at build)
│  │  ├─ public/fonts/           # Fraunces + Inter woff2, self-hosted
│  │  └─ src/
│  │     ├─ main.tsx · App.tsx · index.css        # index.css @theme tokens kept
│  │     ├─ routes/              # react-router 7: /onboarding, /deck, /try/:token, /wardrobe, /profile, /pair, /merchant/*
│  │     ├─ components/          # Onboarding, SwipeDeck, Avatar, TasteRadial, MerchantConsole — kept, rewired
│  │     ├─ features/capture/    # CameraView, scan.worker.ts, poseGate.ts, segment.ts, crossSections.ts, measure.ts, faceSkin.ts, fuse.ts
│  │     ├─ features/render/     # pathB.ts (canvas mesh warp), uvTemplates/{top,bottom,dress,outerwear}.ts, fabricLook.ts, disclaimer.tsx
│  │     ├─ features/fit/        # useFit() over @dressingroom/fit-engine, cohort bars
│  │     ├─ features/privacy/    # Ledger.tsx (shared by app + merchant console), consent.ts
│  │     ├─ db/                  # dexie.ts (IndexedDB schema v1), outbox.ts, crypto.ts (WebCrypto key)
│  │     ├─ api/                 # client.ts: typed fetch from apps/api OpenAPI via openapi-typescript
│  │     └─ platform/            # camera.ts, storage.ts, share.ts, deepLink.ts — web impls now; Capacitor impls later behind the same interface
│  └─ api/                       # THE backend (Fastify 5, Node 22)
│     ├─ Dockerfile
│     ├─ drizzle/                # SQL migrations (drizzle-kit generate)
│     └─ src/
│        ├─ server.ts            # builds Fastify, registers plugins, starts pg-boss, serves /sdk + /app static in prod
│        ├─ env.ts               # zod-validated process.env; the only place secrets are read
│        ├─ db/schema.ts · db/client.ts
│        ├─ auth/                # deviceToken.ts (JWT), shopKey.ts (HMAC), shopifySession.ts
│        ├─ routes/app.ts · routes/try.ts · routes/sdk.ts · routes/merchant.ts · routes/admin.ts
│        ├─ shopify/             # mounts @dressingroom/shopify-app plugin at /shopify
│        ├─ jobs/                # pg-boss handlers: renderHero, syncShopifyProduct, rollupUsage, pruneRenders
│        ├─ tryon/               # router.ts (policy), ledger.ts
│        └─ billing/             # shopifyBilling.ts, stripe.ts, usage.ts
├─ packages/
│  ├─ schema/                    # @dressingroom/schema — zod, shared by everything TS
│  ├─ fit-engine/                # @dressingroom/fit-engine — pure TS, zero deps
│  ├─ taste-engine/              # @dressingroom/taste-engine — pure TS, zero deps
│  ├─ tryon-providers/           # @dressingroom/tryon-providers — server-only adapters + TryOnRouter
│  ├─ sdk/                       # @dressingroom/sdk — vanilla TS → dist/sdk.v1.js (IIFE, <6 KB)
│  ├─ shopify-app/               # @dressingroom/shopify-app — Fastify plugin + shopify.app.toml + extensions/try-button (theme app extension)
│  └─ woocommerce-plugin/        # PHP 8.3 WordPress plugin; `pnpm build` zips dist/dressingroom-woocommerce.zip
└─ infra/
   ├─ docker-compose.yml · Caddyfile · .env.example
   └─ scripts/deploy.sh · backup.sh · fetch-models.sh
```

Rule: anything that imports Node APIs lives in apps/api or packages/tryon-providers; apps/web and packages/sdk are browser-only; packages/schema, fit-engine, taste-engine are isomorphic with zero runtime deps (fit/taste) or only zod (schema).

### Packages

- **apps/web** — Consumer PWA (mobile-first). Onboarding capture, swipe deck, wardrobe, profile/privacy ledger, deep-link try-on, and the merchant console (same bundle, /merchant/* routes behind shop login). Wrappable by Capacitor later without code changes because device access goes through src/platform/*. _[React 19, Vite 6, Tailwind 4, motion 12, lucide-react, react-router 7, Dexie 4 (IndexedDB), vite-plugin-pwa (Workbox, installable, offline shell), @mediapipe/tasks-vision 1.2.2 (self-hosted assets), Web Workers + OffscreenCanvas, Canvas 2D for Path B. No @google/genai, no express, no three.js in v1.]_
  - features/capture/scan.worker.ts — PoseLandmarker VIDEO mode gating (full body visible, tilt < 5°, A-pose), picks 0°/90° frames, runs selfie_multiclass segmenter; frames never leave the worker except the one chosen front 'base frame'
  - features/capture/measure.ts — 12 cross-section widths (front) × depths (side) at landmark-derived levels → Ramanujan ellipse girths, blended with height/weight/sex prior (Bartol-style coefficients); per-girth sigma
  - features/capture/faceSkin.ts — FaceLandmarker + skin class → Lab k-means → ITA/Monk class, undertone, 12-season estimate; face tile crop with background removed
  - features/capture/fuse.ts — inverse-variance fusion of scan/manual/prior, agreement test, conflict flag → 'remeasure this one' UI; confidence = clamp(0.95−0.26·(σ−1.66), 0.2, 0.98)
  - features/render/pathB.ts — triangulated mesh warp of flat-lay PNG onto the user's base-frame silhouette: 12 control rows × per-row gap from fit.perSize, hem sag from fabric.drape, specular/opacity from sheen/opacity; composites over base frame, stamps 'estimate' disclaimer
  - db/dexie.ts — tables bodyProfile, baseFrame (AES-GCM encrypted blob), renders (LRU 50), wardrobe, swipes, outbox, ledger, settings
  - api/client.ts + db/outbox.ts — all backend calls go through one typed client; writes are queued in IndexedDB and flushed with retry (offline-safe)
  - platform/deepLink.ts — handles https://app.<domain>/try/:token (PWA scope) and later dressingroom:// via Capacitor App plugin
  - components/Avatar.tsx — kept mirror frame + layer slots; body layer = base frame, garment layer = pathB output
  - components/MerchantConsole.tsx — re-themed; products list, sync status, Privacy ledger, plan/usage
- **apps/api** — The single deployable backend: app API, merchant API, SDK handshake, Shopify app host, job runner, static host for sdk.v1.js and the built PWA. _[Node 22, Fastify 5, @fastify/type-provider-zod (routes typed from @dressingroom/schema, OpenAPI emitted for the web client), Drizzle ORM + postgres-js, pg-boss 10 (Postgres-backed queue, runs in-process), jose (JWT), pino, @shopify/shopify-api, stripe. One Docker image.]_
  - server.ts — registers routes under /v1, /shopify, /sdk, /healthz; starts pg-boss workers in the same process (JOBS=1 env lets a second replica later take jobs only)
  - auth/deviceToken.ts — anonymous device accounts: POST /v1/devices returns {deviceId, jwt 30d}; no email/password in v1
  - auth/shopKey.ts — merchant key `dr_live_…` + HMAC-SHA256 over body+timestamp for WooCommerce and SDK server calls; Shopify uses session tokens
  - routes/try.ts — resolves tryToken → garment payload + shop branding, records pairing
  - routes/merchant.ts — product upsert/list, usage, ledger, billing status
  - jobs/renderHero.ts — opt-in neural render via TryOnRouter, writes ledger row, stores result 24 h max
  - jobs/syncShopifyProduct.ts — on products/update webhook, pulls metafields + images, normalises to GarmentPayload
  - billing/usage.ts — one row per fit session; nightly rollup; Shopify usage record / Stripe metered push
- **packages/schema** — Single source of truth for every wire type: GarmentPayload v1 (full §3.1 incl. colorways, photos, flatLayPhoto, ease, lengthCm, sizeChart with shoulder, sizingNotes, trueToSizeScore, criticalFitPoints, stretchZones, sizeChartType 'garment'|'body', schemaVersion), FitSignature v1 (80 floats, index map), SwipeEvent, FitResult, API request/response DTOs, Shopify metafield ↔ payload mapping table, WooCommerce meta key list. _[TypeScript + zod 3. Exports zod schemas, inferred types, JSON Schema (zod-to-json-schema) consumed by the PHP plugin's validator and by Shopify metafield definitions.]_
  - garment.ts
  - fitSignature.ts (FS_INDEX constants: girths 0–11, sigmas 12–23, aspect 24–35, lengths 36–47, posture 48–55, shape 56–65, demographics 66–71, prefs 72–77, version/quality 78–79)
  - swipe.ts
  - api.ts (route DTOs)
  - mappings/shopify.ts, mappings/woo.ts
- **packages/fit-engine** — Deterministic fit score + size recommendation exactly per handoff §4.1–4.2, extended with sigma-aware scoring. Pure functions, zero deps, 100% unit-tested with the test vectors from the audit's fitEngineSpec. _[Pure TypeScript, no runtime deps, vitest.]_
  - computeFit(body: BodyMeasurements, garment: GarmentPayload, opts): FitResult — per size: gap = chart[point] − (body[point].mean + easeRequired[category][point]); band scoring with P(gap ∈ [0, easeTarget+2]) under N(mean, σ²); weights from criticalFitPoints; pattern-block rules (a-line/wrap ignore hip, column weights hip, bias caps stretch); stretchPct and stretchZones soften the tight band
  - recommendSize — argmax with tie band ±0.05, sizingNotes bias ('runs small' → up one), history tie-break, returns null when every size < 0.4
  - easeTable.ts — category × point ease targets
  - notes.ts — human notes ('snug at bust, 1.5 cm under ease')
- **packages/taste-engine** — Swipe → taste state. applySwipe (love/pass/save/less), pass-reason inference (colour distance, fit score, price), 50-card penalty memory for colour×fabric×cut, rankDeck, Style DNA axes for TasteRadial. _[Pure TypeScript, zero deps, vitest.]_
  - applySwipe.ts
  - penaltyMemory.ts
  - rankDeck.ts
  - colourHarmony.ts (ΔE in Lab vs seasonal palette → colour-match chip, feeds colour affinities)
  - styleDna.ts (fixed axis order for the radar)
- **packages/tryon-providers** — Server-only AI adapters behind one interface, plus the router. v1 ships FashnProvider (tryon-v1.6 flat-lay for stills, tryon-max for hero) and MockProvider (returns the input with a stamp; used in dev/tests). VertexTryOnProvider and GrokVideoProvider are stubs with the interface implemented but disabled by env until the bake-off. _[TypeScript, undici fetch, sharp (resize/strip EXIF/≤7 MB), no SDKs.]_
  - types.ts (TryOnProvider, PersonInput, GarmentInput, TryOnOptions, TryOnResult, VideoOptions)
  - promptFromMetadata.ts
  - providers/fashn.ts, providers/vertex.ts (stub), providers/grokVideo.ts (stub), providers/mock.ts
  - router.ts — picks by consentTier allow-list, category, health; falls through on PoseError/timeout; enforces maxCostUsd
- **packages/sdk** — Merchant drop-in: <script src="https://api.<domain>/sdk/v1.js" data-shop="…"> + <button data-dressingroom-product="…">. Finds buttons, calls the handshake endpoint, opens the universal link on mobile, shows a QR modal on desktop. Also exposes window.DressingRoom.open(productId). _[Vanilla TypeScript, tsup → IIFE, inline QR via a 1 KB QR encoder, no deps, < 6 KB gzipped. Served from the api container (no separate CDN).]_
  - index.ts (autoinit, button scan, MutationObserver for SPA storefronts)
  - handshake.ts (POST /v1/sdk/sessions)
  - qrModal.ts
  - styles.ts (coral/cream tokens, prefers-reduced-motion)
- **packages/shopify-app** — Shopify app as a Fastify plugin (OAuth install, session storage in Postgres, webhooks products/update + app/uninstalled, metafield definition creation on install, Billing API) plus a Shopify CLI project holding ONE theme app extension (app block 'Try in DressingRoom' that injects sdk.v1.js and the button) and a minimal embedded admin page (settings + sync status + plan) served from the same backend. _[@shopify/shopify-api 11 (no Remix, no Polaris build chain; the embedded page is a static HTML + App Bridge CDN script), Shopify CLI 3 for `shopify app deploy` of the extension, GraphQL Admin API 2026-10.]_
  - plugin.ts (registers /shopify/auth, /shopify/callback, /shopify/webhooks, /shopify/admin)
  - metafields.ts — namespace `dressingroom`, keys mirror GarmentPayload (fabric_json, ease_json, size_chart_json, pattern_block, sizing_notes, critical_fit_points, flat_lay_image)
  - sync.ts — product + metafields + images → GarmentPayload via @dressingroom/schema mappings
  - billing.ts — appSubscriptionCreate (Starter €29/mo incl. 500 fit sessions) + appUsageRecordCreate (€0.05/extra session)
  - extensions/try-button/ (Liquid block + schema)
  - shopify.app.toml
- **packages/woocommerce-plugin** — WordPress/WooCommerce plugin: settings page (API key, backend URL), product-edit meta box for the garment fields (fabric, ease, size chart table, pattern block, sizing notes, critical fit points, flat-lay image picker), pushes the GarmentPayload to the backend on save (woocommerce_update_product), injects sdk.v1.js + button on single product pages, exposes a signed read endpoint as fallback. _[PHP 8.3, WordPress plugin API, WooCommerce 9 hooks, wp_remote_post with HMAC, Composer-free, PHPUnit + Brain Monkey tests, built to a zip by `pnpm --filter woocommerce-plugin build`.]_
  - dressingroom.php (bootstrap)
  - includes/class-settings.php
  - includes/class-product-meta.php (meta box + sanitisation against the JSON Schema exported from @dressingroom/schema)
  - includes/class-sync.php (push on save, retry queue via WP cron)
  - includes/class-frontend.php (script + button injection)
  - includes/class-rest.php (/wp-json/dressingroom/v1/products/{id})

### Data model

POSTGRES 16 (Drizzle schema, all ids uuid, timestamps tz):

- shops(id, platform 'shopify'|'woocommerce', domain unique, name, api_key_hash, api_key_prefix, plan 'free'|'starter'|'pro', billing_ref, settings jsonb {brandColor, logoUrl, adsEnabled}, installed_at, uninstalled_at)
- shopify_sessions(id text pk, shop_id fk, access_token encrypted, scope, expires_at) — @shopify/shopify-api session storage
- products(id, shop_id fk, external_id, handle, payload jsonb (GarmentPayload v1), schema_version int, category, price_eur numeric, primary_color_hex, status 'active'|'incomplete'|'archived', missing_fields text[], updated_at; unique(shop_id, external_id); GIN index on payload)
- product_images(id, product_id fk, kind 'flat_lay'|'product', url, width, height, processed_url (bg-removed flat-lay PNG served by us), processed_at)
- devices(id, token_version int, platform, app_version, created_at, last_seen_at) — the 'user' in v1; no PII
- fit_signatures(device_id pk fk, version int, vector real[80], quality real, updated_at) — the ONLY body data server-side
- pairings(device_id, shop_id, paired_at, source 'link'|'qr'; pk(device_id, shop_id))
- try_sessions(id, token_jti unique, shop_id, product_id, device_id null, created_at, resolved_at, expires_at) — SDK handshake → app resolution
- swipe_events(id, device_id, shop_id, product_id, action 'love'|'pass'|'save'|'less', size_recommended, fit_score real, reason text null, at) — partitioned by month later, not now
- wardrobe_items(device_id, product_id, size, state 'saved'|'bought'|'kept'|'returned', updated_at; pk(device_id, product_id))
- usage_events(id, shop_id, device_id, kind 'fit_session'|'hero_render', cost_usd numeric, at) + usage_daily(shop_id, day, fit_sessions int, hero_renders int, cost_usd; pk(shop_id, day))
- render_jobs(id, device_id, product_id, tier 'heroOptIn', provider, model, status, cost_usd, latency_ms, result_path (local volume, deleted after 24 h), error, created_at, finished_at)
- ledger_entries(id, device_id, kind 'signature_sync'|'swipe_batch'|'hero_render'|'pairing', payload_summary jsonb {bytes, fields, provider, retentionHours}, at) — the server copy of the Privacy ledger; the app also keeps its own
- webhook_log(id, shop_id, topic, external_id, status, received_at) — idempotency
- pgboss.* — queue schema managed by pg-boss

ON-DEVICE (IndexedDB via Dexie, database 'dressingroom', schema v1; never synced):
- bodyProfile{1}: measurements {12 girths + 12 lengths: mean, sigma, source 'scan'|'manual'|'fused', conflict bool}, posture, skin {Lab, ITA, monk, undertone, season, hairLab, irisLab}, manualMethod, captureQuality, createdAt
- baseFrame{1}: AES-GCM blob of the chosen front frame (1024×1536, background replaced with cream) + mask PNG + side-frame mask polygon; key lives in IndexedDB 'keys' store as a non-extractable CryptoKey
- faceTile{1}: 256×256 PNG blob (background removed)
- silhouette{1}: front/side polygon atlases at the 12 levels (what Path B warps against)
- renders: {productId+size → PNG blob, at} LRU 50, cleared on logout
- wardrobe, swipes (mirror of server, for offline), taste (state of taste-engine, incl. penalty memory ring buffer of 50)
- outbox: pending API writes {method, path, body, attempts}
- ledger: every network write with bytes + field names, mirrored server-side
- settings: consentTier (default 'avatar'), heroOptIn per-render acknowledgements, device jwt
localStorage is used only for 'onboarded' and the last tab.

### API surface

Base https://api.<domain>. All /v1 routes are zod-typed; OpenAPI at /v1/openapi.json feeds the web client. Versioning is path-based; breaking changes → /v2 alongside.

APP (bearer device JWT, except POST /v1/devices):
- POST /v1/devices → {deviceId, token}
- POST /v1/devices/rotate
- PUT /v1/me/signature {version, vector[80], quality} → ledger entry
- DELETE /v1/me → deletes device, signature, swipes, wardrobe, pairings (GDPR erase, one call)
- GET /v1/me/ledger
- GET /v1/try/:token → {shop{id,name,brandColor}, garment: GarmentPayload}; marks try_session resolved, creates pairing
- GET /v1/shops/:shopId/products?cursor&category → GarmentPayload[] (the deck source once paired)
- GET /v1/products/:id → GarmentPayload
- POST /v1/swipes (batch ≤100 SwipeEvent) → also writes usage_events(fit_session) per distinct product
- PUT /v1/wardrobe/:productId {size, state}
- GET /v1/wardrobe
- POST /v1/renders/hero {productId, size, personImage (base64 avatar render), consent:{tier:'heroOptIn', ack:true}} → 202 {jobId} ; GET /v1/renders/:jobId → {status, imageUrl (signed, 24 h), provider, model, retentionHours, disclaimer}
- GET /v1/fit/cohort/:productId → {sizeHistogram, keptRate} from aggregated wardrobe states (never from signatures in v1)

SDK (public, CORS *, rate-limited by shop):
- GET /sdk/v1.js
- POST /v1/sdk/sessions {shopKeyPrefix, productExternalId, pageUrl} → {tryUrl: https://app.<domain>/try/<jwt 10 min>, qrSvg}

MERCHANT (WooCommerce: `Authorization: DR-HMAC key=…, ts=…, sig=…`; Shopify: session token):
- PUT /v1/merchant/products/:externalId (GarmentPayload) → {status, missingFields}
- DELETE /v1/merchant/products/:externalId
- GET /v1/merchant/products?status
- POST /v1/merchant/products/:externalId/flat-lay (multipart) → background removal job, processed_url
- GET /v1/merchant/usage?from&to
- GET /v1/merchant/ledger (what our backend sent to AI providers on behalf of this shop's try-ons)
- GET /v1/merchant/analytics/swipes?from&to → aggregates by product/colour/fabric/size (purchase-prediction seed; no body data)
- POST /v1/merchant/keys/rotate

SHOPIFY (mounted from @dressingroom/shopify-app):
- GET /shopify/auth, GET /shopify/callback, POST /shopify/webhooks (HMAC verified; products/update, products/delete, app/uninstalled, app_subscriptions/update, GDPR topics customers/data_request, customers/redact, shop/redact → all answer 200 with nothing to return because we hold no customer PII), GET /shopify/admin (embedded settings page), POST /shopify/billing/subscribe

BILLING (Woo): POST /v1/merchant/billing/checkout → Stripe Checkout URL; POST /v1/billing/stripe/webhook

OPS: GET /healthz, GET /readyz (db + pg-boss), GET /metrics (pino stats → text, no Prometheus in v1), static /app/* in prod (built PWA, served by Caddy directly, api is fallback).

### Privacy architecture

Enforced by construction, not by policy:
1. No upload endpoint accepts a photo in the default tier. The only route that takes an image is POST /v1/renders/hero and it is gated by consentTier 'heroOptIn' with a per-render acknowledgement that is stored in the ledger and shown as provider + model + retention window. The route rejects any image whose metadata flag `kind` is not 'avatarRender' — what is sent is the segmented base frame with the real face REPLACED by a neutral blurred head on device, and the user's real face tile is re-composited locally after the result returns (FASHN leaves the head region untouched).
2. Capture pipeline runs entirely in a Web Worker; video frames never leave the worker, never hit IndexedDB. Exactly one still (the base frame) and the face tile persist, AES-GCM encrypted with a non-extractable WebCrypto key. 'Delete my scan' wipes both plus derived data in one Dexie transaction.
3. What syncs: the 80-float fit signature (quantised, no face/skin/hair values), swipe events, wardrobe states, pairings. The app keeps a client-side ledger of every network write (bytes + field list) and the server keeps the mirror; the Profile screen and the merchant console render the same <Ledger/> component.
4. Model files (MediaPipe wasm + .task) and fonts are served from our own origin, so the scan step makes zero third-party requests. The PWA service worker caches them for offline onboarding.
5. Server: devices are anonymous (uuid + JWT), no email, no IP stored past pino's 7-day log rotation; Postgres volume on the VPS, nightly encrypted pg_dump to the founder's object storage. AI keys live only in apps/api env (FASHN_API_KEY etc.), never reach the client, and the api logs provider/model/cost/retention per job.
6. Every render carries the persistent 'estimate · generated, not measured' label (features/render/disclaimer.tsx) and exported hero images are watermarked; in-app renders are memory/IndexedDB only, no gallery save unless the user taps Export.
7. GDPR hooks: DELETE /v1/me erases everything server-side; Shopify GDPR webhooks are handled; the fit signature is documented in the ledger as pseudonymous personal data (legal review later, as delegated).

### AI provider abstraction

packages/tryon-providers, server-only. Interface (trimmed from the research digest; this is what is implemented in week 8):

```ts
export type GarmentCategory = 'top'|'bottom'|'dress'|'outerwear'|'shoes'|'accessory';
export interface GarmentInput { id: string; category: GarmentCategory; flatLayPng?: Uint8Array; productPhotos?: Uint8Array[]; primaryColorHex?: string; fabric?: GarmentPayload['fabric']; patternBlock?: string; size?: string; fitGapCm?: Partial<Record<'bust'|'waist'|'hip'|'shoulder', number>> }
export interface PersonInput { kind: 'avatarRender'; image: Uint8Array; consentTier: 'heroOptIn' }   // 'userPhoto' is intentionally not a member in v1
export interface TryOnOptions { quality: 'balanced'|'quality'; resolution?: '1k'|'2k'; seed?: number; promptHint?: string; timeoutMs?: number }
export interface TryOnResult { png: Uint8Array; width: number; height: number; provider: string; model: string; costUsd: number; latencyMs: number; retention: { vendorDeletesAfterHours: number|null; trainedOn: false|'unknown' }; disclaimer: 'generated-estimate' }
export interface TryOnProvider {
  readonly name: string;
  readonly capabilities: { categories: GarmentCategory[]; acceptsFlatLay: boolean; acceptsPrompt: boolean; maxResolution: '1k'|'2k'; privacy: { trainsOnInputs: boolean; retentionHours: number|null; euResidency: boolean; selfHosted: boolean } };
  estimateCost(opts: TryOnOptions): number;
  tryOn(person: PersonInput, garment: GarmentInput, opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult>;
  animate?(still: Uint8Array, garment: GarmentInput, opts: { durationSec: 6; promptHint?: string }): Promise<{ mp4: Uint8Array; costUsd: number; provider: string; model: string }>;
  healthCheck(): Promise<{ ok: boolean }>;
}
export class TryOnRouter { constructor(providers: TryOnProvider[], policy: { order: string[]; maxCostUsd: number }); render(...): Promise<TryOnResult> }
```

v1 wiring: providers = [FashnProvider (tryon-v1.6, garment_photo_type 'flat-lay', mode 'balanced', $0.075; tryon-max for 'quality'), MockProvider]. Order from env TRYON_ORDER="fashn,mock"; VertexTryOnProvider (virtual-try-on-001, europe-west4, disableCache) exists as a stub and is switched on only if the 50-SKU bake-off says so; GrokVideoProvider.animate is a stub for the hero clip (US-only processing, flagged in the ledger). promptFromMetadata() turns fabric/size/gap into the prompt for prompt-capable engines. Self-hosted FASHN VTON 1.5 (Apache-2.0, 576×864) is a later FashnSelfHostedProvider with the same request shape — it needs a GPU the VPS does not have today, so it is not in v1. The default try-on path (Path B warp) does not touch this package at all.

### Merchant integration

ONE flow for both platforms, differing only in how the product reaches our Postgres.

Install:
- Shopify: merchant installs from the dev-store install link → /shopify/auth → OAuth → shops row + shopify_sessions; on install we create metafield definitions in namespace `dressingroom` and register webhooks; merchant adds the 'Try in DressingRoom' app block (theme app extension) to the product template in the theme editor — no code. Embedded admin page shows: fields completeness per product, sync status, plan.
- WooCommerce: upload zip → Settings → paste api key (generated in our merchant console at app.<domain>/merchant after signing up with shop domain) → plugin posts a hello (PUT /v1/merchant/shops/self) and starts injecting the script + button on single product pages.

Product sync (push, never pull from the app):
- Shopify: products/update webhook → pg-boss job syncShopifyProduct → GraphQL product + metafields + images → mappings/shopify.ts → GarmentPayload → products.upsert; missing fields → status 'incomplete' + missing_fields shown in admin. Initial backfill on install walks all products (paginated, 2 req/s).
- WooCommerce: on woocommerce_update_product the plugin builds the payload from product meta (our meta box) + WC data (price, images, attributes) and PUTs it with HMAC; failures retry via WP cron. The signed /wp-json/dressingroom/v1/products/{id} endpoint exists only as a debugging/backfill fallback for our side to pull.
- Flat-lay: merchant uploads via the meta box / metafield; our job runs background removal (sharp + a fixed white-threshold matte in v1; rembg container is a later addition) and colour-corrects to primaryColorHex, stores processed_url. Deck cards and Path B use processed_url.

Handshake (deep link / QR):
1. Shopper taps the button → sdk.v1.js POST /v1/sdk/sessions {shopKeyPrefix, productExternalId} → {tryUrl, qrSvg}; the backend mints a 10-minute JWT (jti stored in try_sessions).
2. Mobile: location.href = tryUrl (https://app.<domain>/try/<jwt>) — if the PWA is installed it opens in-app (manifest scope), else the web app opens in the browser and offers 'Add to home screen'. Desktop: modal with the QR of the same URL.
3. App resolves GET /v1/try/:token → garment + shop → computeFit on-device → Path B render → mirror. Pairing row created, so the shop's catalogue appears as a deck source.
4. Nothing from the shopper goes back to the merchant site; the SDK only learns 'opened'.

Webhooks we send to merchants: none in v1. Merchants read aggregates from the console (GET /v1/merchant/analytics/swipes) — kept/returned outcomes come from the shopper marking wardrobe items, not from order webhooks (orders/paid webhook for conversion attribution is post-MVP).

Billing (plugin paid, app free, per founder):
- Shopify: Starter €29/mo via appSubscriptionCreate with 500 fit sessions included, overage €0.05/session posted nightly with appUsageRecordCreate from usage_daily; 14-day trial. Plan state updates from app_subscriptions/update webhook.
- WooCommerce: Stripe Checkout subscription (same Starter price + metered price for overage), customer portal link in the merchant console, plan state from Stripe webhooks. Below plan or trial expired → SDK still renders the button but tryUrl returns a 'shop paused' screen (never break the merchant's page).
- Ads toggle: shops.settings.adsEnabled flag stored now, no ad surface built in v1.

### Deployment

infra/docker-compose.yml, three services, one VPS (4 vCPU / 8 GB is plenty):

- caddy (caddy:2.9): ports 80/443, automatic Let's Encrypt. Caddyfile: `app.<domain>` → file_server from /srv/web (built PWA, immutable asset cache, SPA fallback to index.html, Cache-Control no-cache on index.html and sw.js; CSP allows self only; COOP/COEP headers for the MediaPipe SIMD wasm) ; `api.<domain>` → reverse_proxy api:3000 (also /sdk/v1.js with 1 h cache, /renders/* signed URLs). Both hostnames on one cert set. The WordPress/Shopify dev tunnel in development is Shopify CLI's own tunnel / `cloudflared` for Woo — not part of compose.
- api (ghcr.io/<founder>/dressingroom-api:<sha>, node:22-alpine multi-stage, runs `drizzle-kit migrate` on start then server.ts): env from infra/.env (DATABASE_URL, JWT_SECRET, SHOP_KEY_PEPPER, SHOPIFY_API_KEY/SECRET, STRIPE_SECRET/WEBHOOK_SECRET, FASHN_API_KEY, TRYON_ORDER, PUBLIC_APP_URL, PUBLIC_API_URL). Volume /data/renders (hero results, pruned after 24 h by a pg-boss cron). pg-boss runs in this process. restart: unless-stopped, healthcheck /readyz.
- postgres (postgres:16-alpine): volume /data/pg; `infra/scripts/backup.sh` (pg_dump | age-encrypt | rclone to object storage) in the host crontab nightly.
- web is not a container: `pnpm --filter web build` output is copied into the caddy volume by deploy.sh (rsync), so a frontend-only deploy is a 5-second file copy.

Deploy: GitHub Actions builds the api image and the web bundle on push to main; infra/scripts/deploy.sh on the VPS does `docker compose pull && docker compose up -d` + rsync of web. Rollback = previous image tag. Logs: pino → stdout → `docker logs`; uptime via a free external pinger on /healthz. Staging = a second compose project on the same VPS with `-staging` hostnames pointed at the dev stores.

Moving to managed cloud later: the api image runs unchanged on Fly/Railway/Cloud Run; swap DATABASE_URL to managed Postgres; Caddy's job goes to the platform's edge. Nothing in the code knows about Docker.

### MVP sequence

1. Week 1 — Monorepo + engines. Move the prototype to apps/web, create packages/schema (full §3.1 GarmentPayload with sizeChartType + schemaVersion, FitSignature index map, SwipeEvent), packages/fit-engine (computeFit, recommendSize, ease table, pattern-block rules, sigma-aware bands, 20 test vectors), packages/taste-engine (applySwipe, penalty memory, rankDeck, colour harmony). Delete @google/genai, express, the Vite define block, README. Regenerate fixtures against the full schema. CI green.
2. Week 2 — Backend skeleton + persistence. apps/api with Fastify, Drizzle migrations for shops/products/devices/fit_signatures/swipe_events/wardrobe/try_sessions/usage/ledger, device JWT, routes /v1/devices, /v1/me/signature, /v1/swipes, /v1/wardrobe, /v1/products, OpenAPI → web client. apps/web: Dexie schema, outbox, react-router routes, SwipeDeck/TasteRadial/Avatar rewired to computeFit + taste-engine, 4th ring button, estimate badge, Profile screen with the Ledger. Compose up on the VPS with Caddy TLS; staging live.
3. Week 3 — Capture, part 1 (measurements). Camera route, scan.worker with PoseLandmarker gating and multiclass segmenter on the 0°/90° frames, 12-level widths/depths → ellipse girths blended with the height/weight prior, per-girth sigma, manual-entry method selector, inverse-variance fusion + conflict UI, confidence mapping. bodyProfile + encrypted baseFrame + silhouette in IndexedDB. Fit signature v1 built and synced; ledger shows it.
4. Week 4 — Capture, part 2 (face/skin) + Path B first cut. FaceLandmarker skin sampling → Lab/ITA/Monk/undertone/season with user-confirmed swatch, face tile. features/render/pathB.ts: mesh warp of the processed flat-lay onto the base-frame silhouette for top/dress/bottom with per-row gap from fit.perSize and hem sag from drape; the three handoff tests (recognition/fabric/size) as Playwright screenshot tests on one fixture body. Mirror now shows the user.
5. Week 5 — Shopify end-to-end. packages/shopify-app: OAuth, session storage, metafield definitions, products/update + uninstall + GDPR webhooks, syncShopifyProduct job, embedded admin page with completeness; theme app extension with the button; packages/sdk built and served at /sdk/v1.js; /v1/sdk/sessions + /v1/try/:token; app /try route; QR modal. Dev store: tap button → mirror shows the fitted garment with size recommendation.
6. Week 6 — WooCommerce end-to-end + merchant console. packages/woocommerce-plugin: settings, meta box with the garment fields and flat-lay picker, push-on-save with HMAC, script/button injection; backend HMAC auth, flat-lay background-removal job; MerchantConsole re-themed on §7 tokens showing products/completeness/usage/ledger/swipe aggregates. Both stores round-trip real SKUs. Invite 10 testers; start the tape-measure pilot (test–retest).
7. Week 7 — Hardening + billing + wardrobe. Shopify Billing (Starter + usage records), Stripe Checkout for Woo, usage rollup, plan gating; DELETE /v1/me; PWA offline shell + model caching; wardrobe states kept/returned feeding recommendSize history; cohort bars from wardrobe aggregates; outerwear/shoes/accessory Path B templates (accessory = overlay only). Fix whatever the testers broke.
8. Week 8 — Hero render (opt-in) + bake-off start. packages/tryon-providers with FashnProvider + MockProvider + router, POST /v1/renders/hero with consent gate, on-device head anonymisation and local face re-composite, 24 h pruning, ledger entries with provider/retention, watermark on export. Kick off the 2-week 50-SKU bake-off (FASHN v1.6 vs Vertex VTO vs Nano Banana) using the merchant fixtures; Grok/Kling animate stays a stub. Ship v1 to the two stores; Capacitor shell is the first post-MVP item.

### Trade-offs

- App reads garments from OUR backend, not the shop's API (handoff §3.2 says the app asks the shop). Gain: one schema, one auth, CORS-free, caching, works when the shop is slow. Cost: we are a sync hop; merchants must keep metadata in our metafields/meta box. Accepted — it is also what makes the merchant console possible.
- Path B warps onto the user's own segmented front frame instead of a rendered 3D (Anny/SMPL-X) avatar. Gain: recognition test passed in week 4, no mesh fitting, no three.js, no licensing (SMPL-X commercial terms are now via Max Planck Innovation and unquoted). Cost: single pose/angle, loose clothing in the capture shows through, body-shape edits (hair/make-up scenarios) are harder. The silhouette atlas slot stays so a mesh renderer can replace the base frame later.
- No trained measurement regressor in v1 (analytic ellipse + height/weight prior + manual fusion). Expected 3–4 cm scan-only, ~1.5–2 cm fused — adequate for 4–6 cm size steps but not for 'measure-free' onboarding. BodyM is CC BY-NC, so training data must come from the consented pilot anyway; the regressor is a drop-in replacement for measure.ts.
- Anonymous device accounts, no login. Gain: zero PII, no email infra, no password reset. Cost: losing the phone loses the profile and the wardrobe is not visible 'on web/desktop' (handoff §5) until an optional passkey/email link is added post-MVP.
- Jobs run in the api process with pg-boss, no Redis/worker. Gain: one container. Cost: a burst of hero renders competes with request handling; mitigated by JOBS=1 letting a second replica of the same image take only jobs when needed.
- Fastify plugin instead of Shopify's Remix template. Gain: no second framework, no Polaris build, the Shopify app is just routes in the one backend. Cost: the embedded admin page is deliberately minimal (one static page + App Bridge); richer merchant UI lives in our own console, which is fine for a solo founder.
- PWA + Capacitor later, not Expo. Gain: the capture pipeline (MediaPipe web, OffscreenCanvas, WebCrypto, IndexedDB) ships once and runs unchanged in WKWebView/Chrome WebView. Cost: iOS PWA install friction and no native camera controls; Safari ≥16.4 required for SIMD wasm. Expo would mean rewriting capture against native MediaPipe wrappers that are immature.
- Hosted FASHN only for neural try-on, no Vertex/Nano Banana/Grok adapters live in v1. Gain: one key, one bill ($0.075/image, no volume tier exists for new customers). Cost: no fallback on PoseError until the bake-off picks a second provider; the router and stubs are there so that is a config change, not a build.
- No CDN for sdk.js and model files; everything comes from the VPS behind Caddy. Gain: zero extra services, same-origin privacy story. Cost: merchant page load depends on the VPS; sdk.js is <6 KB and cached 1 h, so acceptable until traffic justifies a CDN in front of Caddy.
- Billing is minimal (one Starter plan + overage). Per-API-call pricing, ads, purchase prediction and 'shop together' are schema-ready (usage_events, shops.settings.adsEnabled, swipe aggregates, pairings) but have no UI; they come after the first paying merchant.

---

## Proposal: DressingRoom — privacy-by-design, multi-tenant architecture (web/PWA first, VPS-hosted, native-ready)

_Privacy-by-design and scale. Every decision below is tested against three rules: (1) raw photos/video never leave the device, enforced by construction (the backend has no endpoint that accepts them and the PWA's CSP forbids any other origin); (2) the only body data that ever syncs is the ~80-float fit signature, pseudonymised per shop, with a user-readable ledger of every byte that left the phone; (3) merchants are hard-isolated tenants (Postgres row-level security + per-tenant pseudonyms + k-anonymous aggregates) so the same backend serves one shop or five thousand. The consumer app stays a React 19 + Vite + Tailwind 4 PWA with all on-device ML in a Web Worker behind a thin platform boundary, so a Capacitor shell (first) or Expo (later) wraps it without touching the engines. GDPR Art. 25 'provability' is treated as an engineering deliverable: the data map is generated from the zod schemas in CI, and e2e tests assert that no network request body during onboarding contains image bytes._

### Layout

pnpm 10 workspaces + Turborepo 2 (task graph + remote-less cache), Node 22, TypeScript 5.8 project references, one `tsconfig.base.json`. Current prototype (`/home/user/dfittrd/src`) moves to `apps/web/src`; `@google/genai`, `express`, `dotenv`, the `vite.config.ts` define block, `.env.example` GEMINI key and `metadata.json` are deleted.

```
dressingroom/
├── package.json                      # root: "turbo run build test lint typecheck", engines node>=22 pnpm>=10
├── pnpm-workspace.yaml               # apps/*, packages/*, tools/*
├── turbo.json
├── tsconfig.base.json
├── .github/workflows/ci.yml          # typecheck, vitest, playwright privacy e2e, docker build, data-map diff gate
├── apps/
│   ├── web/                          # consumer PWA (React 19 + Vite 6 + Tailwind 4 + motion + lucide)
│   │   ├── public/manifest.webmanifest
│   │   ├── src/app/                  # routes (TanStack Router): /onboarding, /deck, /wardrobe, /rooms, /profile, /privacy, /t/:token, /pair
│   │   ├── src/features/{onboarding,capture,deck,wardrobe,profile,privacy,pairing,merchant-preview}/
│   │   ├── src/platform/             # the native boundary: camera.ts, storage.ts, deeplink.ts, share.ts, haptics.ts (web impls; Capacitor impls later)
│   │   ├── src/workers/capture.worker.ts
│   │   ├── src/sw.ts                 # service worker (workbox): shell + /models/* cache, never caches /v1/renders
│   │   └── vite.config.ts
│   ├── api/                          # Fastify 5 backend, versioned /v1, OpenAPI generated from zod (fastify-type-provider-zod)
│   │   ├── src/server.ts
│   │   ├── src/plugins/{auth,tenant,rls,ratelimit,ledger,metrics}.ts
│   │   ├── src/routes/v1/{app,merchant,sdk,webhooks,ops}/
│   │   ├── src/services/{products,signature,fit,swipes,renders,billing,privacy,pairing}/
│   │   ├── src/jobs/                 # pg-boss handlers: product-sync, media-process, render, meter-rollup, retention-sweep, erasure
│   │   └── src/db/{schema.ts,client.ts}        # drizzle-orm
│   ├── worker/                       # same image as api, entry `node dist/jobs/main.js` (pg-boss consumer)
│   ├── merchant-console/             # React + Vite, separate origin console.<domain>; uses @dressingroom/ui + api-client
│   ├── shopify-app/                  # Shopify app (Remix + @shopify/shopify-app-remix), embedded admin UI, metafield definitions, GDPR webhooks
│   ├── woocommerce-plugin/           # PHP 8.3 WordPress plugin "dressingroom-for-woocommerce" (composer, phpunit, WPCS)
│   │   ├── dressingroom.php
│   │   ├── includes/{class-dr-settings.php,class-dr-product-meta.php,class-dr-rest.php,class-dr-webhooks.php,class-dr-sdk-loader.php}
│   │   ├── assets/admin.js
│   │   └── schema/garment.schema.json  # generated from packages/schema (zod → JSON Schema), validated with opis/json-schema
│   └── sdk/                          # ~5 KB vanilla TS, builds to cdn.<domain>/sdk/v1.js (iife, SRI hash published)
├── packages/
│   ├── schema/                       # @dressingroom/schema  (zod, JSON Schema + TS types export)
│   ├── fit-engine/                   # @dressingroom/fit-engine   pure TS, zero deps
│   ├── taste-engine/                 # @dressingroom/taste-engine pure TS, zero deps
│   ├── capture/                      # @dressingroom/capture  on-device scan (MediaPipe tasks-vision, onnxruntime-web, three)
│   ├── render/                       # @dressingroom/render   path-B 2D parametric warp (Canvas2D/WebGL2)
│   ├── local-store/                  # @dressingroom/local-store Dexie repos, WebCrypto envelope, outbox
│   ├── api-client/                   # @dressingroom/api-client typed fetch client generated from openapi.json
│   ├── ai-adapters/                  # @dressingroom/ai-adapters TryOnProvider + router (server-only, "browser": false)
│   ├── ui/                           # @dressingroom/ui tokens, fonts (self-hosted), PrivacyLedger, PlaceholderBadge, CohortBars, TasteRadial
│   └── config/                       # eslint (incl. boundary rules), prettier, tsconfig presets
├── models/                           # self-hosted ML assets served same-origin at /models/<sha>/… (git-lfs): pose_landmarker_full.task, face_landmarker.task, selfie_multiclass_256x256.tflite, tasks-vision wasm, anny-base.glb, girth-regressor.onnx
├── infra/
│   ├── compose/{docker-compose.yml,docker-compose.gpu.yml,docker-compose.observability.yml,Caddyfile,.env.example}
│   ├── docker/{api.Dockerfile,web.Dockerfile,vton.Dockerfile}
│   ├── migrations/                   # drizzle-kit SQL migrations incl. RLS policies
│   └── scripts/{backup.sh,restore.sh,rotate-secrets.sh,retention-sweep.sql}
├── tools/
│   ├── bakeoff/                      # try-on provider bake-off harness (50 SKUs, scoring)
│   ├── fixtures/                     # generates valid §3.1 payloads from schema
│   └── data-map/                     # emits docs/privacy/data-map.md from zod `.describe()` + pii tags
└── docs/
    ├── HANDOFF.md
    ├── adr/0001-pwa-first.md … 
    ├── privacy/{data-map.md (generated),dpia.md,ropa.md,retention.md}
    └── api/openapi.json (generated)
```

### Packages

- **@dressingroom/schema** — Single source of truth for every wire type: §3.1 garment payload, fit signature v1, swipe event, privacy ledger entry, merchant webhook bodies. Consumed by web, api, SDK, Shopify app, and exported to JSON Schema for the PHP plugin. Every field carries `.describe()` plus a `pii: 'none'|'pseudonymous'|'personal'|'special'` tag that the data-map generator reads. _[TypeScript, zod 3.x, zod-to-json-schema; no runtime deps beyond zod]_
  - garment.ts (Garment, Fabric, SizeChartRow with `shoulder`, `sizeChartType: 'garment'|'body'`, `schemaVersion`)
  - fitSignature.ts (80-slot Float32 layout from the digest, quantisation rules, `pii: 'pseudonymous'`)
  - swipeEvent.ts (action, inferred reason, sizeAtSwipe, fitScore)
  - ledger.ts (LedgerEntry: what left, to whom, retention, hash-chain prev)
  - merchant.ts (ProductUpsert batch, FitBadgeRequest/Response)
  - versions.ts (migrations between schemaVersion 1→n)
- **@dressingroom/fit-engine** — Deterministic fit score + size recommendation per handoff §4.1–4.2, probabilistic on sigma (P(gap in [0, ease+2]) under N(mean, sigma_fused²)). Runs identically on-device and in the api's `/merchant/fit` badge path so the merchant never needs raw measurements. _[Pure TypeScript, zero deps, vitest with the handoff test vectors]_
  - computeFit(body, garment, size) → {score, perPoint, notes, confidence}
  - recommendSize(body, garment, history) → {size|null, tieBand, biasApplied}
  - easeTable.ts (category × patternBlock ease targets)
  - criticalPoints.ts (weighting, A-line hip ignore rule, stretchZones relief)
  - fromSignature.ts (signature vector → body means/sigmas without any image data)
- **@dressingroom/taste-engine** — Style DNA: applySwipe, 50-card penalty memory for colour×fabric×cut, rankDeck, colour-season harmony (ΔE to seasonal palette). Runs only on-device; the server never sees the taste vector. _[Pure TypeScript, zero deps]_
  - applySwipe(profile, event)
  - penaltyMemory.ts (ring buffer of 50)
  - rankDeck(candidates, profile, bodyFitHints)
  - colourHarmony.ts (Lab/ΔE2000, season palettes)
  - inferPassReason(garment, fit, profile)
- **@dressingroom/capture** — On-device onboarding pipeline (handoff §2.1 A/B/C): face tile + skin Lab/ITA/Monk, 8 s body video → 4 key frames → masks → 12 cross-section girths with sigma → Anny mesh fit → silhouette atlas → fit signature. Frames never leave the worker; output is numbers + small PNGs. _[TypeScript Web Worker + OffscreenCanvas; @mediapipe/tasks-vision 1.2.2, onnxruntime-web 1.31.1 (webgpu→wasm fallback), three 0.187.0; assets loaded only from same-origin /models/]_
  - gate.ts (full-body visible, tilt, A-pose, distance)
  - keyframes.ts (0/90/180/270 selection)
  - segment.ts (multiclass selfie segmenter, clothes/skin ratio = quality)
  - girths.ts (ellipse baseline + ONNX regressor + sigma head)
  - fusion.ts (inverse-variance fusion with manual + prior, conflict test)
  - face.ts (ITA/Monk/undertone/season, identity tile)
  - meshFit.ts (Gauss-Newton on Anny morph targets)
  - atlas.ts (4-view silhouette atlas + avatar render 1024×1536 for Tier 1)
  - signature.ts (→ @dressingroom/schema FitSignature)
- **@dressingroom/render** — Render path B: warp the merchant's background-removed flat-lay onto the user's silhouette atlas using category UV templates with 12 control rows, per-point ease from fit.perSize, drape → hem sag, sheen/opacity/weightGsm → shading. Produces the in-app mirror image with the mandatory estimate badge baked in. _[TypeScript, Canvas2D + WebGL2 mesh warp; no deps]_
  - uvTemplates/{top,bottom,dress,outerwear,shoes,accessory}.ts
  - warp.ts (thin-plate spline / mesh grid)
  - fabricShader.ts
  - composite.ts (body → shadow → garment → face tile)
  - disclaimer.ts (badge + invisible watermark on export)
- **@dressingroom/local-store** — All durable client state: body profile, capture artefacts, signature copy, wardrobe, taste, products cache, swipe outbox, local ledger mirror. Encrypted at rest with a non-extractable AES-GCM CryptoKey held in IndexedDB; never stores video frames (type system has no slot for them). _[TypeScript, Dexie 4, WebCrypto; swappable to Capacitor SQLite via the same repository interfaces]_
  - db.ts (schema versions)
  - repos/{bodyProfile,captureArtifacts,wardrobe,taste,products,ledger}.ts
  - outbox.ts (swipes/signature/ledger with retry + backoff)
  - crypto.ts (envelope encryption, key wrap for later native keychain)
  - erase.ts (local wipe mirrored to DELETE /v1/me)
- **@dressingroom/api-client** — Typed client for /v1 generated from the api's OpenAPI; one place that knows auth headers, schema-version header and retries. Used by web, merchant-console, Shopify app. _[TypeScript, openapi-typescript + openapi-fetch]_
  - generated/paths.d.ts
  - client.ts
  - auth.ts (device key / passkey, token refresh)
- **@dressingroom/ai-adapters** — Server-only TryOnProvider interface (from the research digest, adopted verbatim with ledger emission added) + router by consent tier/category/health/cost cap. Keys come from env at the api/worker only; package.json marks `browser: false` and an ESLint boundary rule forbids importing it from apps/web or packages used by it. _[TypeScript, undici fetch, zod for provider responses; vitest with recorded fixtures]_
  - types.ts (GarmentInput, PersonInput, TryOnResult, VideoResult, TryOnProvider)
  - router.ts (TryOnRouter: selfHosted → fashn → vertex → nanoBanana; fallthrough on PoseError/timeout; per-shop maxCostUsd)
  - providers/{fashn,fashnSelfHosted,vertexVto,nanoBanana,grokVideo,klingVideo}.ts
  - promptFromMetadata.ts
  - preprocess.ts (flat-lay bg removal + colour correction via sharp)
  - ledger.ts (provider/model/cost/retention → LedgerEntry)
- **@dressingroom/ui** — Design system tokens (coral/cream/ink, Fraunces/Inter self-hosted), shared components used by consumer app and merchant console: PrivacyLedger, PlaceholderBadge, CohortBars, TasteRadial, MirrorFrame, ActionRing (4 buttons). _[React 19, Tailwind 4 `@theme` tokens, motion]_
  - tokens.css
  - PrivacyLedger.tsx
  - PlaceholderBadge.tsx
  - CohortBars.tsx
  - TasteRadial.tsx
  - MirrorFrame.tsx
- **apps/api (+ apps/worker)** — Versioned HTTP API for app, SDK, plugins and console; multi-tenant via Postgres RLS; background jobs via pg-boss; privacy ledger as an append-only hash chain; billing meters. _[Node 22, Fastify 5, fastify-type-provider-zod, drizzle-orm, pg-boss 10, @fastify/rate-limit (Valkey), pino, OpenTelemetry, sharp (worker only)]_
  - plugins/tenant.ts (resolves shop from API key/JWT, `SET LOCAL app.shop_id`)
  - plugins/rls.ts (per-request transaction with app.user_id/app.shop_id)
  - services/privacy (ledger, erasure cascade, export)
  - services/products (normalisers: shopify, woocommerce, generic)
  - services/renders (Tier 3 only; validates 1024×1536 avatar render, strips metadata, TTL 24 h)
  - services/billing (Shopify usage charges, Stripe metered)
  - jobs/retention-sweep
- **apps/sdk** — Drop-in `<script src="https://cdn.<domain>/sdk/v1.js">` + `<button data-dressingroom-product="…">`. Creates a short-lived session, opens the deep link / shows QR, optionally renders the size badge. Sends no customer data: no cookies read, no PII, only shop id + product id + a random session nonce. _[Vanilla TypeScript, esbuild iife ≤5 KB gz, SRI]_
  - mount.ts
  - session.ts
  - deeplink.ts (universal link + custom scheme fallback + QR for desktop)
  - badge.ts (fit badge only after user pairing cookie exists)
- **apps/shopify-app** — Shopify app: OAuth install, metafield definitions under namespace `dressingroom` (fabric, ease, lengthCm, sizeChart, sizingNotes, criticalFitPoints, flatLay file ref), theme app extension that injects sdk.js, products/* and GDPR webhooks forwarded to api, Billing API usage plan. _[Remix + @shopify/shopify-app-remix, Polaris, Node 22; it is a thin shell, business logic lives in api]_
  - app/routes/auth.*
  - app/routes/webhooks.*
  - extensions/theme-app-extension/
  - app/metafields.ts
  - app/billing.ts
- **apps/woocommerce-plugin** — WordPress/WooCommerce plugin: settings page (API key from merchant console), product-edit meta box for the §3.1 fields with JSON Schema validation, REST endpoint `/wp-json/dressingroom/v1/products/:id` (signed), outbound webhooks on product save, sdk.js enqueue on single-product pages. _[PHP 8.3, WP 6.x, WooCommerce 9.x, composer (opis/json-schema), phpunit, WPCS]_
  - class-dr-product-meta.php
  - class-dr-rest.php
  - class-dr-webhooks.php (HMAC-SHA256 with per-shop secret)
  - class-dr-sdk-loader.php
- **apps/merchant-console** — Merchant web console: product payload health, fit-call usage, k-anonymous size/colour/fabric demand aggregates (purchase-prediction dashboards), privacy ledger of what the shop has received, API keys, billing. _[React 19 + Vite + Tailwind 4, @dressingroom/ui, api-client]_
  - features/products
  - features/analytics (cohort bars, size heatmap)
  - features/ledger
  - features/billing

### Data model

**Postgres 17 (one database, schemas `app`, `tenant`, `ops`), drizzle-orm, every tenant table carries `shop_id` and has an RLS policy `USING (shop_id = current_setting('app.shop_id', true)::uuid)`; consumer tables use `app.user_id`. The api role is NOT table owner and cannot bypass RLS; a separate `migrator` role runs migrations.**

Tenant/merchant (`tenant.*`):
- `shops(id uuid pk, slug citext unique, platform enum(shopify,woocommerce,custom), domain, region enum(eu,us), plan, status, created_at)`
- `shop_installs(shop_id fk, platform_shop_id, access_token_enc bytea (AES-GCM via sops-managed KEK), scopes text[], webhook_secret_enc bytea, installed_at, uninstalled_at)`
- `shop_api_keys(id, shop_id, key_hash (argon2id), prefix, scopes text[], created_at, last_used_at, revoked_at)`
- `products(id uuid, shop_id, external_id, payload jsonb CHECK (schema-validated in api), schema_version int, category text GENERATED, price_eur numeric GENERATED, content_hash bytea, status enum(active,draft,archived), updated_at; UNIQUE(shop_id, external_id))`
- `product_media(id, shop_id, product_id, kind enum(flatlay,product,flatlay_processed), storage_key, sha256, width, height, processed_at)` — object storage, no user media ever lands here
- `webhook_inbox(id, shop_id, platform, topic, external_event_id, hmac_ok bool, payload jsonb, received_at, processed_at; UNIQUE(platform, external_event_id))`
- `usage_meters(shop_id, period date, metric enum(fit_calls,sdk_opens,renders,hero_renders), count bigint; pk(shop_id,period,metric))`
- `billing_subscriptions(shop_id, provider enum(shopify,stripe), external_id, plan, status, current_period_end)`
- `shop_aggregates(shop_id, period, dimension enum(size,colour,fabric,cut,pass_reason), key, count, distinct_users)` — written only by the rollup job; rows with `distinct_users < 20` are never exposed (k-anonymity)

Consumer (`app.*`):
- `users(id uuid, email_hash bytea unique null, email_enc bytea null, created_at, deleted_at)` — account is optional; device-first
- `devices(id, user_id, public_key bytea (WebAuthn/ECDSA P-256), label, last_seen_at, revoked_at)`
- `fit_signatures(user_id pk, schema_version, vector real[80], quality real, updated_at)` — current only; previous versions overwritten, no history
- `user_shop_grants(user_id, shop_id, pseudonym uuid unique, scope enum(signature,signature_season), granted_at, revoked_at)` — a shop only ever sees `pseudonym`; different shops cannot join on it
- `swipe_events(id, user_id, shop_id, product_id, action enum(love,pass,save,less), size_at_swipe, fit_score, reason, client_ts, created_at) PARTITION BY RANGE(created_at)` — 13-month retention, then only `shop_aggregates` survive
- `wardrobe_items(user_id, shop_id, product_id, size, state enum(saved,bought,kept,returned), updated_at)`
- `render_jobs(id, user_id, shop_id, product_id, tier enum(avatar,self_hosted,hero), provider, model, status, cost_usd, retention_hours, input_sha256, output_key, expires_at, created_at)` — output in object storage with 24 h lifecycle; input deleted on completion
- `privacy_ledger(id bigserial, user_id, event enum(signature_sync,grant,revoke,swipe_batch,render_request,export,erasure), counterparty (shop_id | provider name), summary jsonb, prev_hash bytea, hash bytea, created_at)` — append-only (no UPDATE/DELETE grant), hash-chained, mirrored to the client ledger so both sides can prove the sequence
- `rooms, room_members, room_messages` (shop-together; messages reference product ids only, never renders) — week 6+
- `erasure_requests(user_id, requested_at, completed_at, scope)`

Ops (`ops.*`): pg-boss tables, `audit_log(actor_type, actor_id, action, target, ip_hash, created_at)`, `schema_migrations`.

**Object storage (MinIO on the VPS, S3 later)**: bucket `merchant-media` (flat-lays, processed flat-lays, public-read via Caddy with cache), bucket `ephemeral-renders` (lifecycle delete 24 h, private, signed GET). No bucket for user uploads exists.

**On-device IndexedDB (Dexie 4, AES-GCM envelope, key non-extractable):**
- `bodyProfile` — 12 girths + 12 lengths with mean/sigma/source(scan|manual|fused)/confidence, manual entries + 'how measured', skin Lab stats, Monk class, undertone, season estimate, hair/iris colour
- `captureArtifacts` — landmarks (4 frames), optional masks, silhouette atlas (4 PNGs), identity face tile PNG, avatar render PNG (1024×1536), Anny phenotype/morph vector, capture quality features. No slot for video frames; the type is `never`
- `fitSignature` — local copy + last-synced hash
- `products` — cached payloads + processed flat-lays with ETag
- `renders` — in-memory LRU only (not persisted); hero renders persisted only after explicit 'keep' with the watermark
- `swipeOutbox`, `signatureOutbox`, `ledgerOutbox` — queued, retried, dropped on erasure
- `taste` — Style DNA vector + penalty ring; never synced
- `wardrobe` — mirror of server rows for offline
- `ledger` — local mirror of privacy_ledger with chain verification
- `settings` — consent tier (default avatar), shop grants cache

Rule: the server can reconstruct nothing about a body beyond the 80 floats; the device can reconstruct everything from its own store; losing the device loses the scan (by design — the user re-scans in 60 s).

### API surface

All under `https://api.<domain>/v1`; OpenAPI generated from zod; `X-DR-Schema-Version` header for the garment payload version; breaking changes only via `/v2`; `Sunset` + `Deprecation` headers. Auth: consumer = device ECDSA signature (WebAuthn-style challenge) → 15-min JWT; merchant plugins = `Authorization: Bearer dr_live_…` API key (argon2 hash); console = magic link + passkey; SDK = unauthenticated but shop-scoped and rate-limited by origin; webhooks = platform HMAC.

**Consumer app**
- `POST /auth/device/challenge`, `POST /auth/device/verify` → JWT; `POST /auth/magic-link`, `POST /auth/magic-link/verify` (optional account to link a second device)
- `GET /me`, `DELETE /me` (erasure cascade: signatures, grants, swipes, wardrobe, renders, ledger finalised with an erasure entry), `GET /me/export` (Art. 20 JSON)
- `PUT /me/signature` (body: FitSignature v1; validated: exactly 80 finite floats, quantised; server rejects anything else) · `DELETE /me/signature`
- `GET /me/ledger?cursor=` · `GET /me/ledger/verify` (returns chain head hash)
- `POST /me/grants` {shopId, scope} → {pseudonym} · `DELETE /me/grants/:shopId`
- `POST /swipes` (batch ≤100 SwipeEvent) · `GET /me/wardrobe` · `PUT /me/wardrobe/:productId` {size,state}
- `GET /shops/:slug` (public card) · `GET /shops/:slug/products/:externalId` (full §3.1 payload + processed flat-lay URL) · `GET /shops/:slug/products?cursor&category` (deck candidates; ranking happens on-device)
- `GET /feed?cursor&shops=` (cross-shop candidate pool for paired shops; no taste data sent)
- `POST /pair` {code} (QR/deep-link token → product + shop + proposed grant) · `GET /t/:token` is served by the PWA, not the API
- `POST /renders` {productId, tier:'hero', avatarRender: base64 PNG ≤7 MB, consent:true} → 202 {jobId}; `GET /renders/:id` → {status, signedUrl (24 h), provider, model, retentionHours, disclaimer:'generated-estimate'}; `DELETE /renders/:id`. Tier 1 and self-hosted renders use the same route with `tier:'avatar'|'selfHosted'`; the request validator rejects any image that is not 1024×1536 or carries EXIF/ICC beyond sRGB.

**SDK (shop-scoped, CORS allow-list = shop domain)**
- `GET /sdk/config?shop=slug` (button copy, colours, whether fit badge enabled)
- `POST /sdk/sessions` {shop, productId, nonce} → {token (JWT, aud=shop, exp 5 min), deepLink, qrPngUrl}
- `POST /sdk/badge` {shop, productId, pairingToken (first-party cookie set after /pair)} → {sizes:[{size,pFit}], recommended} — computed from the signature by the fit-engine; no measurements returned

**Merchant (API key or console session; every query runs under RLS with that shop_id)**
- `POST /merchant/products:batchUpsert` (≤500 payloads, validated against schema; returns per-item errors) · `GET /merchant/products?cursor` · `DELETE /merchant/products/:externalId` · `GET /merchant/products/:externalId/health` (missing fields, flat-lay quality)
- `POST /merchant/media/upload-url` {productId, kind} → presigned PUT; `POST /merchant/media/:id/process` (bg removal + colour correction job)
- `POST /merchant/fit` {pseudonym, productId} → per-size P(fit) (server-side fit-engine; metered)
- `GET /merchant/analytics/sizes|colours|fabrics|cuts|pass-reasons?period` (k≥20 aggregates only) · `GET /merchant/analytics/abandoned` (sdk open → no save, aggregated)
- `GET /merchant/ledger` (what this shop received: pseudonym grants, fit calls; no user ids)
- `GET /merchant/usage` · `GET /merchant/billing` · `POST /merchant/billing/portal`
- `POST /merchant/api-keys` · `DELETE /merchant/api-keys/:id` · `PUT /merchant/settings` (ads toggle, badge on/off, region)

**Platform webhooks (HMAC verified, idempotent via webhook_inbox)**
- `POST /webhooks/shopify/:topic` (products/create|update|delete, app/uninstalled, shop/redact, customers/redact, customers/data_request, app_subscriptions/update)
- `POST /webhooks/woocommerce/:shopId` (product.updated|deleted, X-WC-Webhook-Signature)
- `POST /webhooks/stripe`

**Ops (internal network only)**: `GET /healthz`, `GET /readyz`, `GET /metrics`, `GET /openapi.json` (public, cached).

### Privacy architecture

**Data classes and where they live**
1. Raw capture (photo, video frames): Web Worker memory only, in `@dressingroom/capture`. Never written to IndexedDB (the store types have no slot), never sent (no API route accepts video or more than one image, and that one route only accepts the 1024×1536 avatar render). CSP on app.<domain>: `connect-src 'self' https://api.<domain>; img-src 'self' data: blob: https://cdn.<domain>; worker-src 'self'; default-src 'self'` — the browser itself blocks any third-party call. ML assets are served same-origin from `/models/<sha>/`, so onboarding makes no request to any CDN.
2. Derived identity data (face tile, skin Lab/ITA/Monk, hair, silhouette atlas, mesh params, avatar render, measurements with sigma): IndexedDB, AES-GCM encrypted with a non-extractable CryptoKey; on Capacitor later, the wrapping key moves to Keychain/Keystore via `src/platform/storage.ts`.
3. Fit signature (80 floats, no face/skin/hair/colour values, girths quantised 0.5 cm, lengths 1 cm): the only body data that syncs, to `fit_signatures`; still pseudonymous personal data and labelled so in the ledger and ROPA.
4. Behaviour (swipes, wardrobe): synced, per-shop pseudonymised, 13-month raw retention then aggregates only.
5. Tier-3 hero renders: explicit per-render consent dialog naming provider + retention; input deleted on completion; output expires in 24 h; ledger entry with provider/model/cost/retention; providers configured with no-training/ZDR options (FASHN base64 inputs, Vertex `disableCache` + EU region, xAI ZDR). Consent tier default is 'avatar'; the avatar render is a synthetic image, and the optional blurred-face variant with local face re-composite is the default when the provider is hosted.

**Tenant isolation (ready for thousands of shops)**
- Postgres RLS on every `shop_id` table with the api role unable to bypass; per-request `SET LOCAL app.shop_id`; integration tests that run as shop A and assert zero rows from shop B.
- Per-(user, shop) pseudonym; shops never receive user ids, emails, measurements or signatures — only `P(fit)` per size and k≥20 aggregates. Cross-shop correlation is impossible without the `user_shop_grants` table, which only the api role reads.
- Per-shop API keys, webhook secrets and rate limits; per-shop AI cost cap (`maxCostUsd/day`) in the router; per-shop region flag selects EU-only providers.
- Merchant media and consumer data are in different schemas and different buckets; no foreign key from `tenant.*` to `app.users`.

**Provable minimisation (GDPR Art. 25/30)**
- `tools/data-map` walks the zod schemas and emits `docs/privacy/data-map.md` (field, pii class, purpose, storage location, retention, recipients); CI fails if the map changes without an ADR touching `docs/privacy/`.
- Playwright privacy e2e: completes onboarding with a synthetic video while intercepting all network traffic; asserts (a) only `/models/*` GETs, `/auth/*`, `PUT /me/signature` and `/me/ledger` calls occur, (b) no request body > 8 KB, (c) no image MIME in any request. Runs on every PR.
- ESLint boundary rules: `getUserMedia`/`MediaRecorder` only inside `packages/capture`; `@dressingroom/ai-adapters` importable only from `apps/api` and `apps/worker`; `VITE_` env names containing KEY/SECRET fail the build.
- Double-entry privacy ledger: every server-side event that touches user data appends a hash-chained row and returns the hash; the client mirrors it and the Profile → Privacy screen (and the merchant console's Privacy ledger panel, scoped to that shop) render the same component from `@dressingroom/ui`. `GET /me/ledger/verify` lets the user (or an auditor) check the chain.
- Erasure: `DELETE /me` cascades in one job (signatures, grants, swipes, wardrobe, renders + object storage, device keys), finalises the ledger with an erasure entry, and the client wipes IndexedDB; Shopify `customers/redact` maps to the same job via pseudonym.
- Retention sweep job nightly: renders > 24 h, swipe partitions > 13 months, webhook_inbox > 90 days, audit_log > 12 months.
- Backups: pgBackRest to an encrypted off-site bucket (age-encrypted), 30-day retention; backups contain no raw media by construction.
- Sub-processors: AI providers appear only in Tier 3 and are listed with their DPA/ZDR status in `docs/privacy/ropa.md`; Tier 2 (self-hosted FASHN VTON 1.5 in Docker, only if the VPS has a GPU) is the path to zero sub-processors.
- Native-readiness: the privacy boundary is `apps/web/src/platform/*` + `packages/capture`; a Capacitor shell changes camera/storage implementations only, and the MediaPipe `.task` bundles are the same files the native SDKs load.

### AI provider abstraction

Adopt the research digest's `TryOnProvider`/`TryOnRouter` interface as `packages/ai-adapters` with these binding decisions:

- Package is server-only: `"exports"` has `"browser": false`, ESLint `no-restricted-imports` forbids it outside `apps/api` and `apps/worker`; secrets are read by a single `providersFromEnv()` factory (`FASHN_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS` + `VERTEX_REGION=europe-west4`, `XAI_API_KEY`, `FAL_KEY`, `VTON_SELF_HOSTED_URL`) and never serialised into job payloads or logs (pino redact paths).
- Interface additions over the digest: `tryOn(...)` receives a `ctx: { shopId, userPseudonym, consentTier, region: 'eu'|'any', maxCostUsd }` and must return `retention` + `costUsd`; the router appends a `LedgerEntry` (provider, model, costUsd, retentionHours, trainedOn) before resolving, so a render can never complete without a ledger row.
- Router policy (config, not code): `tierAllowList = { avatar: ['fashn-selfhosted','fashn','vertex-vto','nano-banana'], selfHosted: ['fashn-selfhosted'], heroOptIn: ['fashn-max','vertex-vto','nano-banana','grok-video','kling-video'] }`; `region: 'eu'` removes xAI (US-only processing) and FASHN hosted unless the shop accepts; order self-hosted → FASHN v1.6 → Vertex VTO → Nano Banana; fall through on `PoseError`, timeout (>30 s) or `healthCheck().ok === false` (circuit breaker, 60 s half-open); per-shop daily cost cap; prompt-capable engines get `promptFromMetadata(garment, size, fitGapCm)`.
- Inputs: `PersonInput.kind === 'userPhoto'` is rejected unless `consentTier === 'heroOptIn'` — enforced in the router, not the adapters. `faceTile` is a client-only field and is stripped by the API before the job is enqueued.
- Adapters for v1: `FashnProvider` (tryon-v1.6 balanced $0.075; `tryon-max` for hero; `flatLayPhoto → garment_photo_type:'flat-lay'`; dress/outerwear → one-pieces/tops), `FashnSelfHostedProvider` (same shape against `vton` compose service; 576×864 output → sharp upscale ×2 for display), `VertexTryOnProvider` (virtual-try-on-001, `disableCache`, EU region, ≤7 MB inputs), `NanoBananaProvider` (Vertex, prompt from metadata, labelled 'generated estimate'), `GrokVideoProvider.animate` (grok-imagine-video-1.5, $0.08/s, ZDR header asserted, animates the try-on still only), `KlingVideoProvider.animate` (fal kling 3.0 standard $0.084/s; 4.0 behind a flag).
- Execution: `POST /renders` enqueues a pg-boss job; the worker runs the router, writes output to `ephemeral-renders` with 24 h lifecycle, updates `render_jobs`, deletes the input object; the client polls `GET /renders/:id` or receives an SSE event. Every output gets the estimate badge + invisible watermark in the worker before storage.
- Testing: adapters are tested against recorded fixtures (no live keys in CI); `tools/bakeoff` runs the 2-week 50-SKU bake-off (identity similarity, garment-shape accuracy, proportion drift) and writes a scoreboard that sets the router order in config.
- The current prototype's `@google/genai` client dependency and `define: { 'process.env.GEMINI_API_KEY' }` are removed in week 1; there is no client-side AI code path at all.

### Merchant integration

**Install**
- Shopify: merchant installs the app from the App Store → OAuth in `apps/shopify-app` → `POST /v1/internal/shops` creates `shops` + `shop_installs` (token encrypted) → app creates metafield definitions (`dressingroom.fabric`, `.ease`, `.lengthCm`, `.sizeChart`, `.sizingNotes`, `.trueToSizeScore`, `.criticalFitPoints`, `.stretchZones`, `.flatLay` file reference) → registers webhooks → theme app extension injects `sdk.js` + the button on PDPs → Billing API subscription with usage line item.
- WooCommerce: merchant creates an account in the console, gets an API key (`dr_live_…`), pastes it into the plugin settings; plugin calls `POST /v1/merchant/handshake` {siteUrl, wcVersion} → api issues a per-shop webhook secret; plugin registers WC webhooks (`product.updated`, `product.deleted`) pointing to `/v1/webhooks/woocommerce/:shopId`; plugin enqueues `sdk.js` on `is_product()` pages.
- Custom/headless shops: console + API key + `POST /merchant/products:batchUpsert` directly.

**Product sync**
- Source of truth stays in the shop. Shopify webhook or Woo webhook → `webhook_inbox` (HMAC verified, idempotent on event id) → pg-boss `product-sync` job → platform normaliser maps native fields + metafields/meta into the §3.1 payload → zod validation → `products.payload` upsert with `content_hash` (no-op if unchanged) → `media-process` job downloads the flat-lay into `merchant-media`, removes background, colour-corrects to `primaryColorHex`, stores `flatlay_processed`.
- Validation feedback loops back: Shopify app shows a Polaris banner per product ('missing ease, size chart has no shoulder'); Woo meta box shows inline JSON Schema errors; console shows `GET /merchant/products/:id/health`.
- Initial backfill: `product-sync` iterates the Shopify GraphQL bulk export / WC REST pagination with per-shop rate limits; thousands of shops are handled by pg-boss queue partitioning on `shop_id` and a per-shop concurrency of 2.

**Deep link / QR handshake**
1. Shopper clicks `<button data-dressingroom-product="aalter-studio-1">`.
2. `sdk.js` calls `POST /v1/sdk/sessions` {shop, productId, nonce} → `{token, deepLink, qrPngUrl}`; the token is a 5-minute JWT (aud = shop, sub = productId) — no customer data.
3. Mobile: SDK navigates to `https://app.<domain>/t/<token>` (universal link; opens the PWA/installed app; `dressingroom://try?t=` fallback when Capacitor exists). Desktop: SDK shows a modal with the QR encoding the same URL.
4. The PWA route `/t/:token` calls `POST /v1/pair` {code: token}; if the shop is not yet granted, the app shows the grant sheet ('Share your fit signature with Aalter Studio? They see sizes that fit you, never your measurements or photos') → `POST /me/grants` → pseudonym. The ledger records the grant.
5. App fetches `GET /shops/:slug/products/:id`, runs the fit engine on-device, renders path B, shows the mirror. The 'Does it fit?' badge on the shop's PDP is enabled only after pairing, via a first-party cookie set on the shop domain by the SDK that carries the pairing token (opaque, shop-scoped); the SDK then calls `POST /sdk/badge` which returns `P(fit)` per size.

**Webhooks to merchants**: none in v1 beyond their own platform's; the console and `GET /merchant/analytics/*` cover reporting. Shopify's mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are implemented and map to export/erasure jobs by pseudonym.

**Billing** (plugin paid, app free, per the founder): metered `fit_calls` (badge + merchant fit API), `sdk_opens`, `hero_renders` from `usage_meters`; Shopify via Billing API usage charges with a capped monthly amount; WooCommerce/custom via Stripe Billing metered prices + customer portal; plans: Free (500 fit calls/mo, no hero renders), Shop (€49/mo incl. 10 k fit calls, €0.004 per extra), Hero renders passed through at cost ×2 (≈€0.15 FASHN, ≈€1 video). 'Ads/promote' toggle is a per-shop boolean that only affects ranking weight inside the user's own paired-shop feed; the app never exports targeting data.

**Uninstall**: `app/uninstalled` or plugin deactivation → shop status `uninstalled`, products archived, API keys revoked, grants kept for 30 days then purged, aggregates retained.

### Deployment

**Docker Compose on the founder's VPS (Ubuntu 24.04, 8 vCPU / 32 GB / NVMe baseline; GPU optional via profile)** — `infra/compose/docker-compose.yml`:

- `caddy` (caddy:2, the only container on the `edge` network, ports 80/443, automatic Let's Encrypt TLS + HTTP/3): routes `app.<domain>` → static `web` build (immutable `/assets/*`, `/models/*` with `Cache-Control: immutable`, security headers incl. the CSP above, COOP/COEP for WebGPU/SIMD), `api.<domain>` → `api:3000`, `console.<domain>` → static console build, `cdn.<domain>` → `/sdk/v1.js` + `merchant-media` bucket via `minio` with 1-year cache, `shop.<domain>` → `shopify-app:3000`. Rate limiting at the edge (caddy-ratelimit) in addition to the api's Valkey-backed limiter.
- `web` / `console`: build stage only (multi-stage `web.Dockerfile`); output volume mounted into caddy — no Node at runtime.
- `api` (2 replicas, `node:22-alpine`, non-root, read-only FS, healthcheck `/readyz`), `worker` (same image, pg-boss consumer, `sharp` present, replicas 2).
- `shopify-app` (Remix node server).
- `postgres` (postgres:17, `shared_buffers` 8 GB, `pg_partman` for swipe partitions, RLS roles `api`, `migrator`, `readonly`), `migrate` one-shot service runs drizzle migrations before api starts.
- `valkey` (rate limits, SDK session nonce cache, SSE fan-out; no persistent data).
- `minio` (S3 API; buckets `merchant-media` public-read via caddy, `ephemeral-renders` with 24 h ILM rule, `backups` write-only).
- `pgbackrest` sidecar: nightly full + hourly WAL to `backups`, mirrored with `rclone` to an off-site bucket encrypted with age; `scripts/restore.sh` tested monthly.
- Profile `gpu` (`docker-compose.gpu.yml`): `vton` (FASHN VTON 1.5, Apache-2.0, nvidia runtime, ≥8 GB VRAM, internal network only) — enables Tier 2.
- Profile `observability`: `otel-collector`, `prometheus`, `grafana`, `loki`; api/worker emit OpenTelemetry traces + pino JSON logs with PII redaction.
- Networks: `edge` (caddy only) and `internal` (everything else); no container except caddy publishes a port. Secrets via `.env` generated from `infra/compose/secrets.sops.yaml` (sops + age); never committed.
- CI/CD: GitHub Actions builds images tagged by git SHA, pushes to GHCR, runs migrations in a job container, then `docker compose pull && up -d --wait` over SSH with `--no-deps` rolling restart of api/worker; rollback = previous tag.
- Managed-cloud path later: api/worker/shopify-app are stateless 12-factor images; swap `postgres` → managed Postgres (RLS and pg-boss carry over), `minio` → S3/R2 (same SDK), `caddy` → load balancer + object CDN, `valkey` → managed Redis. Nothing in the app code changes; only `infra/`.
- Capacity: one VPS handles ~200 req/s on the api comfortably (fit badge is a pure-TS computation, ~50 µs); thousands of shops are bounded by product-sync queue throughput (pg-boss, partitioned by shop) and object storage, not by compute; hero renders are off-box at providers or on the GPU profile.

### MVP sequence

1. Week 1 — Foundation: pnpm/Turbo monorepo, move prototype to apps/web, delete client AI wiring, packages/schema (zod §3.1 + FitSignature v1 + SwipeEvent + LedgerEntry, JSON Schema export), packages/fit-engine with handoff test vectors, packages/taste-engine (applySwipe, penalty memory, rankDeck), packages/ui tokens + self-hosted fonts + PlaceholderBadge, CI with typecheck/vitest, data-map generator, ESLint boundary rules.
2. Week 2 — Backend skeleton on the VPS: apps/api (Fastify, drizzle, RLS migrations, device auth, PUT /me/signature, GET /me/ledger, swipes batch, shops/products read routes, merchant batchUpsert, API keys), apps/worker + pg-boss, docker-compose (caddy TLS, postgres, valkey, minio, api, worker, pgbackrest), deploy pipeline; privacy ledger hash chain; DELETE /me erasure job.
3. Week 3 — Local store + capture part 1: packages/local-store (Dexie + AES-GCM, outbox), packages/capture worker with MediaPipe Pose/Face/Segmenter self-hosted under /models, capture gate UI, face step (ITA/Monk/season, identity tile), manual measurements with 'how measured' and fusion/conflict UI; Playwright privacy e2e (no image bytes leave) goes green.
4. Week 4 — Capture part 2 + signature: body video keyframes, masks, analytic girths + sigma, Anny mesh fit (morph targets) and 4-view silhouette atlas + 1024×1536 avatar render, FitSignature assembly and sync, Profile/Privacy screen with the ledger; confidence mapping (60/95/conflict) wired to the fit engine.
5. Week 5 — Merchant integration, one real shop: apps/sdk (sessions, deep link, QR), /t/:token pairing + grant sheet, apps/woocommerce-plugin (meta box, REST, webhooks, SDK loader) OR apps/shopify-app (choose whichever the pilot shop runs; the other follows in week 7), product-sync + media-process jobs (flat-lay bg removal), merchant console v0 (products health, API keys). First real §3.1 payloads flow end-to-end.
6. Week 6 — Render path B + deck rewire: packages/render (UV templates for top/bottom/dress, mesh warp, drape sag, fabric shading, estimate badge), SwipeDeck on real renders with fit indicator + notes, 4-button action ring, Style DNA fed by real swipes, wardrobe sync, kept/returned logging; visual regression tests for the §9 recognition/fabric/size bar (S/M/L and linen/wool/silk screenshots).
7. Week 7 — Second platform + billing + analytics: the other plugin (Shopify app with metafields + GDPR webhooks, or Woo), usage meters, Shopify Billing / Stripe metered, console analytics with k≥20 aggregates (size heatmap, cohort bars, pass reasons, abandoned opens), merchant Privacy ledger panel, SDK fit badge via /sdk/badge.
8. Week 8 — Hero renders + hardening: packages/ai-adapters (FASHN v1.6/max, Vertex VTO, Nano Banana) behind POST /renders with per-render consent + ledger + 24 h expiry + watermark, bake-off harness started on 50 SKUs, Tier 2 self-hosted FASHN profile if the VPS has a GPU, retention sweep, backup restore drill, load test (200 req/s), DPIA/ROPA docs from the generated data map, PWA install prompt + offline shell, Capacitor spike (camera + storage adapters in src/platform) to validate the native boundary.

### Trade-offs

**PWA-first over Expo now.** The on-device pipeline runs in a Web Worker with WASM/WebGL (WebGPU where available), which is slower than native MediaPipe (full-pose ~30–55 ms/frame vs ~20 ms) and loses the scan if the user clears site data; in exchange one codebase ships in 8 weeks and the native boundary (`src/platform`, `packages/capture`) is proven by a Capacitor spike in week 8 rather than guessed. The cost is accepted: iOS Safari quirks (WebGPU in WKWebView, 'Add to Home Screen' friction) and no App Store presence until the Capacitor shell.

**Signature-only sync means no cross-device body profile.** Losing the phone means re-scanning (~60 s). Alternatives (encrypted server backup of the body profile with a user-held key) were rejected for v1 because they add a path by which derived face data leaves the device; revisit only with client-side E2E encryption and explicit opt-in.

**Server-side try-on is never literally 'no image leaves the device'.** The default Tier 1 sends a synthetic avatar render (optionally with a blurred face re-composited locally); Tier 3 sends it to a hosted provider under per-render consent. This is honest in the ledger and the consent copy, and Tier 2 (self-hosted FASHN VTON 1.5) exists specifically so the founder can remove third parties entirely — at the cost of a GPU on the VPS and 576×864 output needing upscaling. Path B (2D warp) remains the only renderer that is fully on-device, and it is the one the deck uses by default.

**Postgres RLS + per-shop pseudonyms over separate databases per tenant.** One database scales to thousands of small shops with simple ops and cheap aggregates; the price is that a bug in the tenant plugin is the single point of failure, mitigated by the api role being unable to bypass RLS, mandatory cross-tenant tests, and no FK from tenant tables to users. Database-per-tenant is reserved for a future enterprise tier (Shein/Amazon-scale brands from the founder's list) and would need the shard key already present (`shop_id`) — nothing else changes.

**Fit badge computed server-side from the signature** (so merchants' PDPs can show 'size M fits' without the app open) means the server runs the fit engine on personal data; it is the same pure package, logged in the ledger per call, metered for billing, and returns only P(fit) per size. The alternative (badge computed in the app and pushed to the shop) would leak more and be slower.

**pg-boss + Valkey instead of Kafka/BullMQ**: fewer moving parts on one VPS; the ceiling (~1–2 k jobs/s) is far above product-sync and render volumes for years. **MinIO over local disk**: adds a container but makes the S3 move later a config change. **Caddy over nginx/Traefik**: automatic TLS and a 30-line config; less tunable at very high throughput, irrelevant at this scale.

**Taste engine stays on-device** so the server cannot build a preference profile; the consequence is that cross-shop feed ranking and the founder's 'app knows who to target' idea work only through aggregates and the user's own device. Merchant 'prediction' dashboards are therefore k-anonymous (≥20 users) and aggregate-only, which limits insight for tiny shops but is what keeps the plugin sellable to privacy-sensitive EU brands.

**Not done in 8 weeks**: Rooms/shop-together chat, hairstyle/makeup variants, in-app payments, Etsy/Amazon/Temu/Shein integrations (they do not expose the §3.1 fields; they would need a generic 'estimated from product photos' path with lower confidence), Path A cloth physics, and the trained ONNX girth regressor (analytic ellipse + priors ship first; training waits for consented pilot data because BodyM is CC BY-NC).

---

## Proposal: DressingRoom — merchant-first architecture (plugin is the product, app is the sensor)

_Merchant-integration first. The paid artefact is the plugin (Shopify app + WooCommerce plugin); the consumer PWA is free and exists to generate billable "try-on sessions" and fit outcomes for merchants. Every design decision below is ranked by: (1) a merchant can install, enrich products and get billed within 20 minutes without talking to us; (2) the garment catalog lives on OUR backend (normalised §3.1 payloads synced from the shop), so the app never calls a shop API directly and analytics/prediction come for free; (3) body data stays on-device and the only server-side body artefact is the 80-float signature, which makes the GDPR/App-review story short. Billing unit = one try-on session (an SDK/QR intent resolved by a user for one product), not a compute call — this is what Shopify Billing usage records and Stripe meters count identically. Shopify's app template is now the React Router 7 template (the "Remix template" was renamed/migrated in 2025); we use `@shopify/shopify-app-react-router`, which is the same thing._

### Layout

pnpm 10 workspaces + Turborepo, Node 22 (.nvmrc), TypeScript 5.8 project references, single `pnpm-workspace.yaml` with `catalog:` pinning react/zod/fastify versions once. The existing /home/user/dfittrd/src moves verbatim into apps/web/src in week 1 (then gets refactored); @google/genai, express, dotenv and the `define` block in vite.config.ts are deleted.

```
dressingroom/
├── package.json                 # private, scripts: dev/build/test/lint/typecheck via turbo
├── pnpm-workspace.yaml          # packages: apps/*, packages/*; catalog: { react: 19.x, zod: 4.x, fastify: 5.x, ... }
├── turbo.json                   # pipeline: build depends ^build; test; typecheck; lint
├── tsconfig.base.json           # strict, moduleResolution bundler, paths none (use workspace deps)
├── .nvmrc (22) · .npmrc (engine-strict) · .editorconfig · .gitignore
├── .github/workflows/
│   ├── ci.yml                   # pnpm i --frozen-lockfile, turbo typecheck/test/build, phpcs+phpunit for wordpress
│   ├── deploy-vps.yml           # build images -> ghcr.io, ssh `docker compose pull && up -d` (tag = git sha)
│   ├── shopify-deploy.yml       # `shopify app deploy` (extensions + config) on tag
│   └── wporg-release.yml        # build plugin zip, 10up/action-wordpress-plugin-deploy to WP.org SVN on tag
├── apps/
│   ├── web/                     # consumer PWA  (React 19 + Vite 6 + Tailwind 4 + motion + Dexie)   -> app.dressingroom.app
│   │   ├── index.html · vite.config.ts (vite-plugin-pwa, no define block) · public/models/ (MediaPipe wasm+.task, ONNX, self-hosted)
│   │   └── src/{app,features/{onboarding,capture,deck,mirror,wardrobe,profile,pair,tryon},platform/{storage,net,camera},workers/}
│   ├── api/                     # Fastify 5 HTTP API + BullMQ workers (one image, two commands)        -> api.dressingroom.app, go.dressingroom.app
│   │   └── src/{server.ts,worker.ts,routes/v1/{auth,me,pairings,tryon,garments,deck,events,render,sdk,merchant,webhooks},db/{schema,migrations},jobs/,services/,plugins/}
│   ├── console/                 # standalone merchant console (React 19 + Vite + Tailwind 4) for WooCommerce/other merchants -> console.dressingroom.app
│   ├── shopify/                 # Shopify app: React Router 7 template (@shopify/shopify-app-react-router) + Polaris web components -> shopify.dressingroom.app
│   │   ├── shopify.app.toml     # scopes, declarative webhooks, app_proxy none
│   │   ├── app/routes/{app._index,app.garments.$id,app.billing,app.settings,webhooks.$topic,auth.$}.tsx
│   │   └── extensions/
│   │       ├── theme-tryon/     # theme app extension: blocks/tryon-button.liquid, blocks/sdk-embed.liquid (app embed), assets/dressingroom-sdk.js (copied from packages/sdk at build)
│   │       └── (none else in v1)
│   └── wordpress/               # WooCommerce plugin (PHP 8.3, declares Requires PHP 8.2, GPLv2+)   slug: dressingroom-virtual-try-on
│       ├── dressingroom-virtual-try-on.php · uninstall.php · readme.txt · composer.json (PSR-4, no runtime deps -> no scoping needed)
│       ├── src/{Plugin.php,Admin/{SettingsPage,ProductDataTab,CsvImporter},Sync/{Queue,Pusher,Normalizer? (no: raw push)},Rest/{Routes,Hmac},Front/{Button,Block,Assets},Orders/{Attribution,Hooks},Billing/LicenseClient}
│       ├── assets/{dressingroom-sdk.js (copied from packages/sdk), admin-garment-form.js, garment.schema.json (generated from packages/schema)}
│       ├── blocks/tryon-button/block.json
│       └── tests/ (PHPUnit + wp-env), .phpcs.xml.dist (WordPress-Extra + WooCommerce-Core)
├── packages/
│   ├── schema/                  # @dressingroom/schema — zod 4: GarmentPayloadV1, FitSignatureV1, events, API DTOs, normalisers, JSON-schema export
│   ├── fit-engine/              # @dressingroom/fit-engine — pure TS, zero deps
│   ├── taste-engine/            # @dressingroom/taste-engine — pure TS, zero deps
│   ├── sdk/                     # @dressingroom/sdk — vanilla TS -> dist/sdk.js (<5 KB gz), IIFE, no deps
│   ├── api-client/              # @dressingroom/api-client — typed fetch client generated from apps/api OpenAPI (openapi-typescript + openapi-fetch)
│   ├── ai-adapters/             # @dressingroom/ai-adapters — server-only TryOnProvider adapters + router (throws if imported in a browser)
│   ├── capture/                 # @dressingroom/capture — on-device pipeline (MediaPipe tasks-vision 1.2.2, onnxruntime-web 1.31.1), worker-first, framework-free
│   ├── render/                  # @dressingroom/render — path-B 2D parametric warp on Canvas/OffscreenCanvas, framework-free
│   ├── console-ui/              # @dressingroom/console-ui — React components shared by apps/console and apps/shopify (stat cards, size heatmap, cohort bars, privacy ledger panel)
│   ├── ui/                      # @dressingroom/ui — design tokens (@theme cream/coral/ink, self-hosted Fraunces/Inter), PlaceholderBadge, MirrorFrame
│   └── config/                  # shared eslint/prettier/tsconfig presets
├── infra/
│   ├── compose.yaml · compose.prod.yaml · compose.gpu.yaml (profile) · Caddyfile · .env.example
│   ├── docker/{api.Dockerfile,web.Dockerfile,console.Dockerfile,shopify.Dockerfile,imageprep.Dockerfile}
│   └── scripts/{backup.sh,restore-drill.sh,deploy.sh}
└── docs/ (HANDOFF.md, ARCHITECTURE.md, MERCHANT-ONBOARDING.md, PRIVACY-LEDGER.md, API.md generated from OpenAPI)
```

### Packages

- **packages/schema (@dressingroom/schema)** — Single source of truth for every wire shape: the §3.1 garment payload, the 80-float fit signature, swipe/outcome events, try-on intents, API DTOs. Consumed by web, api, console, shopify, sdk; exported as JSON Schema for the PHP plugin's admin form. _[TypeScript, zod 4, zod-to-json-schema build step; no runtime deps besides zod]_
  - garment.v1.ts — GarmentPayloadV1 (adds schemaVersion:1, sizeChartType:'garment'|'body', colorways[], flatLayPhoto, productPhotos[], ease, lengthCm, sizingNotes, trueToSizeScore, criticalFitPoints, stretchZones, sizeChart[].shoulder) + completenessScore(garment) 0–1 with per-field reasons
  - fitSignature.v1.ts — layout constants for the 80 slots exactly as the body-scan digest (girths 0–11, sigmas 12–23, aspect 24–35, lengths 36–47, posture 48–55, shape coeffs 56–65, demographics 66–71, prefs 72–77, version 78, quality 79), encode/decode Float32Array<->base64, quantisation
  - events.ts — SwipeEvent(love|pass|save|less, reason, recommendedSize), TryOnOutcome(cart|ordered|kept|returned), clientEventId for idempotency
  - intent.ts — TryOnIntent {shopId, productRef, intentId, status pending|opened|fitted|abandoned}
  - normalize/shopify.ts, normalize/woocommerce.ts — platform product JSON + our metafields/post-meta -> GarmentPayloadV1 (one normaliser in TS; the PHP plugin pushes raw)
  - api/*.ts — request/response schemas used by fastify-type-provider-zod to generate OpenAPI
  - json-schema/ — build output garment.schema.json shipped into apps/wordpress/assets and used by the Shopify Polaris form
- **packages/fit-engine (@dressingroom/fit-engine)** — Deterministic §4.1/§4.2 fit score + size recommendation; runs on-device in the app (full measurements + sigmas) and on the server against a signature only (merchant size-hint widget later). Same code, same test vectors. _[Pure TypeScript, zero dependencies, vitest; published as ESM + CJS]_
  - easeTable.ts — ease_required and ease_target per category × patternBlock (wrap, a-line, sheath, column, straight, bias…), stretch tolerance from fabric.stretchPct and stretchZones
  - computeFit.ts — gap_at_point per criticalFitPoint, handoff bands (-2 / 0 / ease_target+2 / +4), A-line hip ignore rule, sizingNotes offset, weights -> score 0–1 per size + notes[]
  - probabilistic.ts — P(gap in [0, ease_target+2]) under N(mean, sigma_fused²) when sigmas are present (digest §4.1 hook); 'measure your waist to be sure' nudge
  - recommendSize.ts — argmax with tie band, sizingNotes bias ('runs small' -> +1), history tie-break (kept/returned), recommendedSize: null when nothing fits
  - fromSignature.ts — adapter that feeds computeFit from FitSignatureV1 (girths + sigmas) instead of a BodyProfile
  - __tests__/vectors.json — the handoff's 168 cm / 88-70-96 wrap-dress case and ~40 more
- **packages/taste-engine (@dressingroom/taste-engine)** — §5 swipe signals: affinity update, pass-reason inference, 50-card penalty memory, deck ranking, colour harmony vs skin/hair season. On-device only in v1; the server receives the raw events, never the vector. _[Pure TypeScript, zero deps, vitest]_
  - applySwipe.ts — updates affinities over colour / fabric / cut / silhouette / price band
  - inferPassReason.ts — colour ΔE to liked palette, fit score < 0.5, price > p80 -> reason enum
  - penaltyMemory.ts — ring buffer of 50 (colour×fabric×cut) tuples with decay
  - rankDeck.ts — scores candidate garments (paired-shop items + promoted ads, 'promoted' flag preserved) for the SwipeDeck
  - colourHarmony.ts — Lab ΔE2000 of primaryColorHex vs the user's 12-season palette -> 'colour match' chip score
- **packages/sdk (@dressingroom/sdk)** — The merchant-facing drop-in: finds `[data-dressingroom-product]` buttons, creates a try-on intent, opens the deep link on mobile or renders a QR + polls on desktop, pre-selects the recommended variant when the phone reports back, and writes the hidden cart attribute for order attribution. _[Vanilla TypeScript, esbuild -> IIFE dist/sdk.js (<5 KB gzip), no deps; copied at build into the Shopify theme extension assets and the WordPress plugin assets (so neither platform loads remote code)]_
  - boot.ts — reads data-dressingroom-shop / data-dressingroom-pk from the script tag, fetches /v1/sdk/shops/:pk/config once (cached 1h)
  - intent.ts — POST /v1/sdk/intents, opens https://go.dressingroom.app/t/<intentId> (mobile) or shows QR modal (desktop) and polls /status every 2 s for 3 min
  - attribution.ts — on 'fitted' status: sets cart attribute `_dr_session` (Shopify Ajax Cart API /cart/update.js; Woo: cookie `dr_session` read server-side) and selects the variant whose size option matches
  - ui.ts — button theme (coral/ink tokens), QR modal, 'Your size: M · estimate' chip; all strings overridable
  - adapters/{shopify,woo,generic}.ts — how to find product id + variant selector on each platform
- **packages/ai-adapters (@dressingroom/ai-adapters)** — Server-only TryOnProvider implementations + router (digest interface verbatim) and the image-prep client. Never bundled into any browser app; API keys only via process.env in the api/worker containers. _[TypeScript, undici fetch, zod for provider responses; guard module throws when `typeof window !== 'undefined'`; package.json `exports` with a `browser: false` condition]_
  - types.ts — GarmentInput, PersonInput, TryOnOptions, TryOnResult, VideoOptions, TryOnProvider (as in the research digest)
  - router.ts — TryOnRouter: order selfHostedFashn -> fashnApi -> vertexVto -> nanoBanana; tierAllowList per consentTier; falls through on PoseError/timeout; maxCostUsd
  - providers/fashn.ts (tryon-v1.6 flat-lay + tryon-max), providers/fashnSelfHosted.ts, providers/vertexVto.ts (virtual-try-on-001, europe-west4, disableCache), providers/nanoBanana.ts, providers/grokVideo.ts (animate, ZDR header check), providers/klingVideo.ts (fal, animate)
  - promptFromMetadata.ts — fabric/size/ease -> prompt text for prompt-capable engines
  - imageprep.ts — client for the rembg Docker service (flat-lay background removal + colour correction to primaryColorHex)
  - ledger.ts — builds the privacy-ledger entry (provider, model, retention, cost) every call must emit
- **packages/capture (@dressingroom/capture)** — On-device onboarding pipeline: face/skin/hair analysis, 8 s body-video gating + 4-view silhouettes, analytic girths + ONNX regressor, manual-measurement fusion with sigmas, Anny-derived mesh fit, silhouette atlas + face tile. Framework-free so a Capacitor shell runs the identical code in a WebView. _[TypeScript, @mediapipe/tasks-vision 1.2.2 (self-hosted wasm/.task), onnxruntime-web 1.31.1 (webgpu with wasm fallback), three 0.187.0 for the mesh, Web Workers + OffscreenCanvas]_
  - face/analyze.ts (ITA, Lab k-means, Monk class, undertone, season estimate, identity tile)
  - body/gate.ts, body/views.ts, body/segment.ts, body/measure.ts (12 levels, Ramanujan ellipse), body/regressor.ts (ONNX), fusion/fuse.ts (inverse-variance, agreement test, confidence mapping 60/95)
  - mesh/fitAnny.ts (Gauss-Newton on girths/lengths) + atlas/exportAtlas.ts (4-view silhouette PNGs)
  - signature/build.ts — BodyProfile -> FitSignatureV1 (the ONLY exported body artefact)
- **packages/render (@dressingroom/render)** — Render path B: warp the merchant's background-removed flat-lay onto the user's silhouette atlas using a category UV template (12 control rows), per-point ease gap from the fit engine (S/M/L must read tight/fits/loose), fabric.drape for hem sag, sheen/opacity/weightGsm for the material look. Also produces the neutral 'avatar render' used as PersonInput for hero renders. _[TypeScript, Canvas 2D mesh warp (OffscreenCanvas in a worker), WebGL2 optional for the lighting pass; no React dependency]_
  - templates/{top,bottom,dress,outerwear,shoes,accessory}.ts — UV control grids
  - warp.ts, drape.ts, material.ts, composite.ts (body silhouette -> shadow -> garment -> face tile)
  - avatarRender.ts — neutral-pose 1024×1536 render with blurred face option for Tier-1 hero requests
  - disclaimer.ts — burns the 'estimate' label/watermark into any exported bitmap
- **apps/web (consumer PWA)** — The free consumer app: onboarding/capture, try-on resolve from deep links, mirror, swipe deck, wardrobe, profile + privacy ledger, shop pairing (QR). Installable PWA first; Capacitor shell later wraps the same build. _[React 19, Vite 6, Tailwind 4 (@theme tokens from packages/ui), motion 12, lucide, Dexie 4 (IndexedDB), vite-plugin-pwa (Workbox), TanStack Query, @dressingroom/api-client, zustand for ephemeral UI state]_
  - features/tryon/ResolveIntent.tsx — handles /t/:intentId, pairing consent, calls POST /v1/tryon/resolve, runs computeFit on-device, posts status
  - features/capture/* — thin React over packages/capture workers
  - features/mirror/Mirror.tsx — keeps the prototype's mirror frame + layer slots, garment layer now from packages/render; persistent PlaceholderBadge 'estimate'
  - features/deck/SwipeDeck.tsx — prototype chrome + 4-button ring, rankDeck, outbox events
  - platform/storage/db.ts — Dexie schema (bodyProfile, fitCache, tasteState, outbox, garmentCache, wardrobe, ledger)
  - platform/net/sync.ts — outbox flush (events, signature) with backoff; the only network writes the app ever makes
- **apps/api (Fastify API + workers)** — Versioned HTTP API for the app, both plugins, the SDK and the consoles; webhook receivers; BullMQ workers for product sync, image prep, usage reporting, analytics rollups and hero renders. One Docker image, `node dist/server.js` vs `node dist/worker.js`. _[Node 22, Fastify 5, fastify-type-provider-zod + @fastify/swagger (OpenAPI 3.1), Drizzle ORM + drizzle-kit (Postgres 16 + pgvector), BullMQ on Redis 7, jose (ES256 JWT), @fastify/rate-limit, pino, undici, @shopify/shopify-api for Admin GraphQL/HMAC, stripe SDK, AWS SDK S3 client against MinIO]_
  - routes/v1/* — see API surface
  - services/catalog.ts — upsert normalised garments, completeness scoring, image ingestion
  - services/billing.ts — plan enforcement middleware, usage_records, Shopify appUsageRecordCreate + Stripe meter events
  - services/intent.ts — intent lifecycle in Redis (TTL 10 min) + Postgres session row on resolve
  - jobs/shopifyBulkSync.ts, jobs/webhookProcess.ts, jobs/imagePrep.ts, jobs/usageReporter.ts (daily), jobs/analyticsRollup.ts (nightly), jobs/heroRender.ts (ai-adapters router), jobs/retention.ts (purge expired renders, uninstalled shops)
  - plugins/auth.ts — three principals: device JWT (app), shop API key sk_/pk_ (plugin/SDK), Shopify session token (embedded app), console session
- **apps/shopify (Shopify app)** — Public Shopify App Store app: managed install/OAuth, declarative webhooks, Billing API subscription + usage, metafield definitions, garment-data editor (writes metafields so the shop stays source of truth), embedded merchant console, theme app extension with the button + SDK embed. _[Shopify CLI 3.x React Router 7 template (@shopify/shopify-app-react-router), Polaris web components, App Bridge, @shopify/shopify-app-session-storage-postgresql (schema shopify_sessions in the same Postgres), Vite build, Node 22 server; theme app extension (Liquid + assets)]_
  - shopify.app.toml — scopes: write_products (metafields), read_orders, read_themes? (no), webhooks: products/create|update|delete, bulk_operations/finish, app/uninstalled, app_subscriptions/update, orders/create, refunds/create, customers/data_request, customers/redact, shop/redact
  - app/routes/app._index.tsx — onboarding checklist (plan -> sync -> complete garments -> add block) + console-ui overview
  - app/routes/app.garments.$id.tsx — Polaris form validated with garment.schema.json, metafieldsSet into namespace $app:dressingroom (type json), flat-lay picker from Files
  - app/routes/app.billing.tsx — appSubscriptionCreate (recurring + usage line, cappedAmount, 14-day trial), confirmation redirect
  - app/routes/webhooks.$topic.tsx — HMAC verify, forward to api /webhooks/shopify (single processing path)
  - extensions/theme-tryon/blocks/tryon-button.liquid (app block, product template) + blocks/sdk-embed.liquid (app embed) + assets/dressingroom-sdk.js
- **apps/wordpress (WooCommerce plugin)** — Free WP.org plugin that (a) adds a DressingRoom product-data tab + CSV import, (b) pushes raw product JSON + our meta to the API on change (Action Scheduler), (c) renders the Try button (hook, shortcode, block) with the bundled SDK, (d) attributes orders/refunds, (e) connects the site to a paid account (Stripe) via license key. Passes WP.org review: no remote code, no telemetry before connect, GPLv2+, full escaping/nonces/caps, uninstall cleanup, 'External services' disclosure. _[PHP 8.3 (Requires PHP 8.2, WP 6.6+, WC 9+), declare(strict_types=1), PSR-4 via Composer autoload (no third-party runtime deps -> no PHP-Scoper), HPOS-compatible, Action Scheduler (bundled with WC), WP REST API, PHPCS WordPress-Extra + WooCommerce-Core, PHPUnit via wp-env]_
  - Admin/SettingsPage — Connect button (signed round-trip to console.dressingroom.app/connect), API key storage (encrypted with AUTH_KEY salt), sync status, ads toggle, auto-insert button toggle
  - Admin/ProductDataTab — 'DressingRoom' tab: fabric, ease, lengths, patternBlock, criticalFitPoints, stretchZones, sizingNotes, size-chart grid keyed on pa_size terms, flat-lay media picker; meta keys `_dressingroom_*`; JS form validated with garment.schema.json
  - Sync/Queue + Sync/Pusher — enqueue on save_post_product / woocommerce_update_product / variation save; batches of 50 to PUT /v1/merchant/garments/batch with HMAC; initial full sync job
  - Rest/Routes — dressingroom/v1/health, /products/{id} (HMAC-signed pull for resync), /sync (admin-only trigger)
  - Front/Button + Front/Block — woocommerce_single_product_summary priority 35, [dressingroom_button] shortcode, blocks/tryon-button block.json for block themes; wp_enqueue_script of bundled assets/dressingroom-sdk.js
  - Orders/Attribution — copies `dr_session` cookie to order meta at woocommerce_checkout_create_order; order completed / refunded hooks -> POST /v1/merchant/orders
- **apps/console + packages/console-ui** — Merchant console for non-Shopify merchants (standalone) and the component library both consoles share: overview stats, size heatmap, conflict list, cohort bars, buying-advice predictions, privacy ledger panel, billing/usage, ads toggle. _[React 19 + Vite + Tailwind 4 + @dressingroom/ui tokens; console-ui is plain React with no router/data deps (data passed in); charts with a thin SVG layer (no heavy chart lib)]_
  - console-ui: StatCardGrid, SizeHeatmap, CohortBars, ConflictTable, PredictionCards (demand by colour/fabric/size), PrivacyLedgerPanel (same component rendered in the consumer app's profile), UsageMeter
  - apps/console: routes /connect (Woo handshake), /overview, /garments (completeness queue), /analytics, /billing, /settings (ads toggle), /ledger; auth via magic-link email session
- **infra/** — Everything needed to run the whole product on the founder's VPS with one `docker compose up`, and to move to managed cloud later without code changes (S3-compatible storage, plain Postgres, Redis). _[Docker Compose v2, Caddy 2 (auto TLS), pgvector/pgvector:pg16, redis:7, minio, rembg (python) image, optional GPU profile for self-hosted FASHN VTON 1.5]_
  - compose.yaml (dev) / compose.prod.yaml (images from ghcr, restart policies, healthchecks, resource limits)
  - Caddyfile — six hosts, HSTS, compression, long-cache for /sdk.js and /models/*, CORS only on /v1/sdk/*
  - scripts/backup.sh — nightly pg_dump + minio mirror to offsite via restic; restore-drill.sh run monthly

### Data model

SERVER — Postgres 16 (+ pgvector), schema via Drizzle in apps/api/src/db/schema. Money as integer cents; all timestamps timestamptz; every row has created_at/updated_at; soft-delete only where GDPR requires audit (shops).

Merchant side
- merchants(id uuid pk, name, billing_email, stripe_customer_id null, created_at)
- shops(id uuid pk, merchant_id fk, platform enum('shopify','woocommerce'), external_domain unique (myshopify domain | site_url), display_name, status enum('installing','active','suspended','uninstalled'), ads_enabled bool default false, ads_daily_budget_cents int null, plan_code, locale, currency, timezone, uninstalled_at null)
- shop_credentials(shop_id pk/fk, access_token_enc bytea (AES-256-GCM, key from env MASTER_KEY, per-row IV), scopes text[], webhook_secret_enc bytea, rotated_at)
- api_keys(id, shop_id fk, kind enum('public','secret'), prefix text ('pk_live_…'/'sk_live_…' first 10 chars for lookup), key_hash (argon2id), scopes text[], last_used_at, revoked_at) — Woo plugin uses sk_, SDK uses pk_
- products(id uuid, shop_id fk, external_id text, handle, title, vendor, status enum('active','draft','archived'), raw_json jsonb (platform snapshot), raw_updated_at, synced_at; unique(shop_id, external_id))
- garments(id uuid, shop_id fk, product_id fk, payload jsonb NOT NULL (GarmentPayloadV1, validated on write), schema_version int, completeness_score numeric(3,2), validation_errors jsonb, published bool (completeness ≥ 0.7 and flat-lay present), size_chart_type enum('garment','body'), updated_at) — one garment per product; sizes and colorways live inside payload; a GIN index on payload for category/fabric queries
- garment_images(id, garment_id fk, kind enum('flat_lay','product','colorway'), source_url, storage_key (MinIO), bg_removed bool, dominant_hex, width, height, bytes)
- variant_map(shop_id, garment_id, external_variant_id, size text, colorway text) — lets webhooks/orders map a Shopify/Woo variant to (garment, size)
- plans(code pk, name, monthly_cents, included_sessions int, overage_cents_per_session int, hero_render_cents int, ad_cpm_cents int, platform_price_ids jsonb)
- subscriptions(id, shop_id fk, plan_code fk, platform enum('shopify_billing','stripe'), platform_subscription_id, status enum('trial','active','past_due','cancelled'), trial_ends_at, current_period_start, current_period_end, capped_amount_cents)
- usage_records(id, shop_id fk, period_date date, metric enum('tryon_session','fit_call','hero_render','ad_impression'), qty int, reported_at null, platform_record_id null; unique(shop_id, period_date, metric))
- webhook_inbox(id, platform, shop_id null, topic, external_event_id, hmac_ok bool, payload jsonb, received_at, processed_at, attempts, error; unique(platform, external_event_id)) — idempotency + replay
- sync_jobs(id, shop_id, kind enum('bulk_initial','incremental','images'), status, total, done, started_at, finished_at, error)
- order_outcomes(id, shop_id fk, external_order_id, external_line_id, garment_id fk, size, tryon_session_id fk null, status enum('ordered','kept','returned'), amount_cents, ts; unique(shop_id, external_order_id, external_line_id)) — kept = 30 days after fulfilment without refund (rollup job)
- analytics_daily(shop_id, garment_id null, day date, tryons, loves, passes, saves, less, carts, orders, returns, size_dist jsonb {XS:..}, conflicts int, pass_reasons jsonb; pk(shop_id, garment_id, day)) — materialised nightly; the console only reads this table, never events
- predictions(shop_id, day, kind enum('colour','fabric','size','cut'), payload jsonb) — buying advice computed from analytics_daily + taste-engine aggregates

Consumer side (pseudonymous; no email, no name, no images)
- app_users(id uuid pk, device_pubkey_hash, locale, created_at, deleted_at null) — anonymous device identity; email/passkey optional later for cross-device
- refresh_tokens(id, user_id, token_hash, expires_at, revoked_at)
- fit_signatures(user_id pk/fk, version int, vec vector(80), quality numeric, updated_at) — current only; history is not kept (privacy)
- pairings(id, user_id fk, shop_id fk, source enum('intent','qr','deck'), consent jsonb {signatureFit:true, swipeEvents:true, colourSeason:false}, created_at, revoked_at)
- tryon_sessions(id uuid, user_id fk, shop_id fk, garment_id fk, intent_id null, source enum('sdk','qr','deck','ad','wardrobe'), opened_at, fit_score numeric null, recommended_size text null, fit_confidence numeric null, outcome enum('none','cart','ordered') , billable bool, billed_period_date null) — THE billable row; fit_score/size are written by the app after on-device computation
- swipe_events(id uuid (client id), user_id, garment_id, shop_id, action enum('love','pass','save','less'), reason jsonb, recommended_size, client_ts, received_at; pk(id) gives idempotency)
- wardrobe_items(user_id, garment_id, size, state enum('saved','ordered','kept','returned'), ts; pk(user_id, garment_id))
- privacy_ledger(id, user_id fk, event enum('signature_sync','events_sync','pairing','hero_render','account_delete'), provider null, model null, retention_hours null, summary text, ts) — rendered 1:1 in the app and (aggregated, shop-scoped) in the merchant console
- hero_renders(id, user_id, garment_id, size, provider, model, cost_cents, latency_ms, retention_hours, storage_key (MinIO bucket with 24 h lifecycle), status, expires_at)
- intents live in Redis (hash dr:intent:<id>, TTL 10 min): {shopId, productRef, status, sessionId, size}; only persisted via tryon_sessions.intent_id

ON-DEVICE — IndexedDB via Dexie (apps/web/src/platform/storage/db.ts), never synced, optionally AES-GCM encrypted with a non-extractable WebCrypto key held in the same origin:
- bodyProfile (1 row): measurements{12 girths,12 lengths} with sigma each, fused values, manual entries + 'how measured', landmarks, 4 silhouette atlas PNG blobs, face tile blob, skin Lab/Monk/undertone/season, hair/iris colour, captureQuality, Anny coefficients, schemaVersion
- fitSignature (1 row): last built FitSignatureV1 + syncedAt (so the ledger can show exactly what left)
- garmentCache (LRU 500): payload + bg-removed flat-lay blob + fetchedAt
- fitCache: (garmentId, size, bodyProfileVersion) -> FitResult
- tasteState (1 row): affinities, penalty ring buffer, season palette
- outbox: pending SwipeEvent/TryOnOutcome/sessionStatus rows with clientEventId, attempts
- wardrobe: local mirror of wardrobe_items + render thumbnails (in-app only; no gallery save)
- ledger: local copy of privacy_ledger rows (append-only)
- pendingIntent: intent captured before onboarding finished
Raw camera frames and video exist only inside the capture Web Worker's memory and are never written to IndexedDB, Cache Storage or the file system. Renders are kept in memory/Blob URLs and are not persisted unless the user explicitly exports (watermarked).

### API surface

Base: https://api.dressingroom.app/v1 (OpenAPI 3.1 generated from zod; breaking changes -> /v2, additive changes carry `x-schema-version`). Four principals, enforced by apps/api/src/plugins/auth.ts: (A) app = device JWT bearer; (M) merchant = `Authorization: Bearer sk_live_…` (Woo plugin, console) or Shopify session token exchanged for a shop-scoped JWT (embedded app); (P) public SDK = `pk_live_…` in body + CORS allow-list from shop config, rate-limited per key + IP; (W) webhook = platform HMAC. Every write is idempotent by client id or platform event id.

Consumer app (A)
- POST /auth/device {pubkey, proof} -> {accessToken (15 min), refreshToken (90 d), userId}
- POST /auth/refresh · POST /auth/logout
- GET /me · DELETE /me (erase: signatures, events, pairings, ledger entry 'account_delete'; 30-day tombstone)
- PUT /me/fit-signature {version, vecB64, quality} -> ledger entry; GET /me/fit-signature/meta (no vector returned)
- GET /me/ledger?cursor
- GET /pairings · POST /pairings {shopId | pairingCode, consent} · DELETE /pairings/:id
- POST /tryon/resolve {intentId} | {shopId, productRef} -> {session:{id}, shop:{id,name,ads}, garment: GarmentPayloadV1 + imageUrls, pairingRequired:boolean} — creates tryon_sessions (billable) once pairing consent exists
- PATCH /tryon/sessions/:id {fitScore, recommendedSize, fitConfidence} — written after on-device computeFit; also flips the intent to 'fitted' for the desktop QR poller
- POST /tryon/sessions/:id/outcome {outcome:'cart'|'ordered'}
- GET /garments/:id · GET /shops/:shopId/garments?cursor&category
- GET /deck?cursor -> candidate garments from paired shops + promoted (ads_enabled) shops, each flagged promoted:true; ranking happens on-device
- POST /events [{id, type:'swipe'|'outcome', …}] -> {accepted[], duplicates[]} (batch ≤ 100)
- GET /me/wardrobe · PUT /me/wardrobe/:garmentId {size, state}
- POST /render/hero {garmentId, size, person:{kind:'avatarRender', imageB64, blurredFace:boolean}, consent:{tier:'heroOptIn', providerAck:true}} -> 202 {jobId}; GET /render/jobs/:id -> {status, imageUrl (signed, 24 h), provider, model, retentionHours, disclaimer:'generated-estimate'}
- GET /shops/:id/public (name, logo, privacy summary for the pairing consent screen)

Public SDK (P, CORS)
- GET /sdk/shops/:pk/config -> {shopId, name, buttonTheme, deepLinkBase:'https://go.dressingroom.app/t/', adsEnabled}
- POST /sdk/intents {pk, product:{externalId, variantId?, url}} -> {intentId, link, qrSvgUrl, expiresAt}
- GET /sdk/intents/:id/status -> {status:'pending'|'opened'|'fitted'|'expired', recommendedSize?, fitScore?, variantId?}
- (v1.1) POST /sdk/size-hint {pk, product, userToken} — inline size recommendation computed server-side from the stored signature (fit-engine fromSignature) for returning users who linked the browser; billed as fit_call

Deep-link host go.dressingroom.app (Caddy -> api)
- GET /t/:intentId -> 302 to https://app.dressingroom.app/t/:intentId (PWA route); marks intent 'opened'; serves a smart-banner HTML fallback when the UA is desktop

Merchant / plugin (M)
- POST /merchant/woo/connect {siteUrl, adminEmail, nonce, wcVersion, wpVersion} -> {connectUrl} ; POST /merchant/woo/complete {nonce} -> {shopId, sk, pk} (called by console after Stripe Checkout succeeds)
- GET /merchant/shop · PATCH /merchant/shop {adsEnabled, adsDailyBudgetCents, defaultEaseOverrides}
- PUT /merchant/garments/batch [{externalId, raw (platform product JSON), meta (our fields)}] -> per item {garmentId, completeness, errors[]} (api normalises; ≤ 50/batch)
- DELETE /merchant/garments/:externalId
- POST /merchant/garments/validate {meta} -> {completeness, errors[]} (dry run for the admin form)
- POST /merchant/images (multipart, ≤ 7 MB) -> {imageId, bgRemovedUrl} (queues imagePrep)
- GET /merchant/sync · POST /merchant/sync/full
- POST /merchant/orders [{externalOrderId, lines:[{externalLineId, externalVariantId, qty, amountCents}], drSession?, status:'ordered'|'returned'}]
- GET /merchant/analytics/overview?from&to · GET /merchant/analytics/garments?sort=tryons · GET /merchant/analytics/garments/:id/sizes (heatmap: recommended-size distribution vs ordered vs returned) · GET /merchant/analytics/conflicts (garments whose recommended size ≠ ordered size or with high pass-reason 'fit') · GET /merchant/analytics/predictions
- GET /merchant/ledger — shop-scoped aggregate of what users shared (counts of signatures used, events, hero renders by provider); k-anonymity ≥ 5
- GET /merchant/billing · POST /merchant/billing/checkout {planCode} (Stripe Checkout URL; Woo only) · GET /merchant/usage?period
- POST /merchant/api-keys/rotate
- GET /merchant/pairing-code -> {code, qrSvg} (physical-store pairing)

Shopify embedded app -> api (M via session-token exchange): same /merchant/* routes; sync is triggered server-side by the api worker using the stored offline token (bulkOperationRunQuery), so the Shopify app itself only edits metafields and renders UI.

Webhooks (W)
- POST /webhooks/shopify (X-Shopify-Hmac-Sha256 verified with the app secret; topic header routes): products/create|update|delete, bulk_operations/finish, app/uninstalled, app_subscriptions/update, orders/create, refunds/create, customers/data_request, customers/redact, shop/redact — all land in webhook_inbox first, processed by the worker, 200 within 1 s
- POST /webhooks/stripe (signature verified): checkout.session.completed, customer.subscription.updated|deleted, invoice.payment_failed
- POST /webhooks/ai/:provider/:jobId (fal/xAI async callbacks, HMAC with per-job secret)

Ops: GET /healthz (process), GET /readyz (pg+redis+minio), GET /metrics (Prometheus, internal network only), GET /openapi.json.

### Privacy architecture

Principle made structural, not procedural: the backend has NO endpoint that accepts a raw photo or video from the consumer app. The only image-accepting consumer route is POST /v1/render/hero, which (a) requires consent tier 'heroOptIn' per request, (b) accepts only the synthetic avatar render produced by packages/render (3:4, neutral pose, optional blurred face that is re-composited locally after the result returns), (c) validates size ≤ 7 MB and dimensions, (d) deletes the input and output after 24 h (MinIO lifecycle) and (e) writes a privacy_ledger row naming provider, model and vendor retention. If the VPS gets a GPU, Tier 2 (self-hosted FASHN VTON 1.5 in compose.gpu.yaml) becomes the default for hero renders and the ledger says 'processed on DressingRoom servers, deleted on completion'.

What leaves the device, by principal:
1. App -> api: 80-float fit signature (quantised, version-stamped), swipe/outcome events, session fit score + recommended size, wardrobe state, pairing consents. Never: measurements in cm (except as encoded in the signature — documented as such in the ledger), landmarks, masks, atlas, face tile, skin/hair colour. Colour season label only if the user grants that consent toggle per shop.
2. Merchant -> api: products, our metafields/meta, images, orders (line items + hidden `_dr_session` attribute only).
3. api -> merchant: aggregates from analytics_daily with k ≥ 5; never a signature, never per-user rows. The console's Privacy ledger panel shows the merchant exactly this list.
4. api -> AI vendors: only Tier-3 hero requests; adapters are forced through the TryOnRouter whose tierAllowList refuses 'userPhoto' PersonInput in production builds.

Fit computation runs on-device with full measurements + sigmas (best quality, zero leakage); the server-side fit (fromSignature) exists only for the optional on-site size-hint widget and is explicitly a lower-fidelity path. Billing counts sessions, not computations, so privacy does not cost the merchant anything.

Shopify specifics: scopes limited to write_products (metafields) + read_orders; Protected Customer Data access declared at the minimum level with no optional customer fields — orders/create payloads we consume use only line_items, note_attributes and financial status; we never store customer name/email/address. GDPR topics customers/data_request (answer: we hold no customer data keyed to the shop's customer id; sessions are keyed to our pseudonymous user), customers/redact (no-op + log), shop/redact (purge shop rows 48 h after uninstall) are implemented and tested in CI with signed fixtures. WooCommerce: plugin sends nothing until the merchant clicks Connect; readme.txt 'External services' section lists api.dressingroom.app, what is sent and the privacy policy URL (WP.org rule).

Keys and secrets: all AI/provider/Shopify/Stripe keys exist only in /srv/dressingroom/.env (0600) and are injected into api/worker containers; packages/ai-adapters cannot be imported by Vite builds (exports condition + runtime guard), and CI greps the web/console/shopify client bundles for 'sk_', 'FASHN_', 'VERTEX', 'XAI_' strings and fails the build on a hit. Shop access tokens are AES-256-GCM encrypted at rest with MASTER_KEY; rotating MASTER_KEY is a documented script.

Data residency: VPS in the EU (Hetzner/OVH class), Vertex VTO pinned to europe-west4, FASHN and xAI are US-processed and labelled so in the ledger entry the user sees before confirming a hero render. Retention: tryon_sessions and swipe_events are kept 18 months (needed for kept/returned learning), analytics_daily indefinitely (aggregate), hero renders 24 h, intents 10 min, webhook_inbox 30 days. User erase (DELETE /me) removes everything keyed to the user within 24 h and leaves a ledger tombstone.

On-device: capture frames stay inside the Web Worker; IndexedDB stores derived data only, encrypted with a non-extractable WebCrypto key; the PWA's service worker never caches /v1 responses that contain garment images for longer than 7 days; exported images carry the burned-in 'estimate' watermark; the app has no share-to-gallery action by default (founder: images only in the app).

### AI provider abstraction

packages/ai-adapters implements the research digest's TypeScript interface verbatim (GarmentCategory, GarmentInput, PersonInput{kind, image, faceTile never sent, consentTier}, TryOnOptions, TryOnResult{provider, model, costUsd, latencyMs, retention, disclaimer:'generated-estimate'}, VideoOptions/VideoResult, TryOnProvider{name, capabilities, estimateCost, tryOn, tryOnOutfit?, animate?, healthCheck}, TryOnRouter). Concrete v1 adapters: FashnProvider (tryon-v1.6 balanced for tops/bottoms/one-pieces with garment_photo_type 'flat-lay'; tryon-max for hero stills and shoes/bags/accessories; base64 in/out; $0.075 flat — no volume tier for new customers), FashnSelfHostedProvider (same request shape against the compose.gpu.yaml service; 576×864 output so the worker upscales 2× before storing), VertexTryOnProvider (virtual-try-on-001, europe-west4, disableCache, ≤ 7 MB inputs), NanoBananaProvider (Vertex-hosted, prompt from promptFromMetadata(), labelled 'generated estimate'), GrokVideoProvider.animate (grok-imagine-video-1.5, $0.080/s, ZDR header asserted or the call is refused, own upload_url, US-only noted in ledger), KlingVideoProvider.animate (fal kling 3.0 standard as cheap alternate, 4.0 ≈ 2× price behind a flag). IDM-VTON/OOTDiffusion/CatVTON/FitDiT are banned by an eslint rule on the provider registry (non-commercial licences).

Routing policy (apps/api/src/services/renderPolicy.ts, env-configurable): consentTier 'avatar' -> [fashnSelfHosted, fashnApi, vertexVto]; 'selfHosted' -> [fashnSelfHosted] only; 'heroOptIn' -> [fashnSelfHosted, fashnApi(tryon-max), vertexVto, nanoBanana]. Fall-through on PoseError, HTTP 5xx, timeout (opts.timeoutMs default 30 s) and healthCheck failure (cached 60 s); maxCostUsd per job from the shop's plan (hero renders are a pass-through line item). Size/fabric are encoded before the neural step: the worker asks packages/render (run in Node via @napi-rs/canvas) for the path-B warped garment on the avatar at the fit engine's chosen size and passes that as the 'model' photo for non-prompt engines, and promptFromMetadata() builds `${fabric.primary} ${weightGsm} gsm, ${drapeWord} drape, ${sheenWord}, size ${size} fitting ${easeWord}` for prompt engines. Every result is stamped disclaimer:'generated-estimate' and the worker burns the watermark before storing. Non-try-on AI is behind the same pattern: ImagePrepProvider (rembg self-hosted; BiRefNet model) for flat-lay cleanup, and later TextProvider for the personal-shopping-assistant (any LLM, server-side only). Adapters are selected by env (RENDER_PROVIDERS=fashnSelfHosted,fashnApi,vertexVto) so the founder can switch vendors or go fully self-hosted without a code change; a 2-week bake-off harness (apps/api/src/jobs/bakeoff.ts, 50 real SKUs, identity/garment-shape/proportion scores) runs the same adapters before the policy is locked.

### Merchant integration

SHOPIFY (public App Store app, custom-distribution build for the pilot)
1. Install: merchant clicks Install -> Shopify managed installation (token exchange, no custom OAuth code) -> offline access token encrypted into shop_credentials; shops row 'installing'; webhooks are declarative in shopify.app.toml so they exist before the first request. metafieldDefinitionCreate runs once: namespace $app:dressingroom, keys garment (type json, validated against garment.schema.json), pinned to the product admin page.
2. Plan: first screen is Billing: appSubscriptionCreate with two line items — recurring (Starter €29 / Growth €99 per 30 days, 14-day trial) and usage (appUsagePricingDetails, cappedAmount = €200 default, terms '€0.05 per try-on session over the included quota; hero renders €0.25') -> confirmationUrl -> app_subscriptions/update webhook flips subscriptions.status 'active'. Managed Pricing is not used because it cannot meter usage.
3. Sync: worker runs bulkOperationRunQuery over products/variants/images/metafields; bulk_operations/finish webhook -> download JSONL -> normalize/shopify.ts -> garments + variant_map + garment_images (flat-lay queued to imagePrep). Incremental: products/* webhooks -> webhook_inbox -> same normaliser. Garment completeness < 0.7 (no flat-lay, no size chart, no fabric) shows in the 'Complete your garments' queue; the merchant fills the Polaris form (writes metafieldsSet so the shop remains source of truth and survives uninstall/reinstall) or uploads a CSV we map.
4. Storefront: theme app extension with two blocks. App embed 'DressingRoom SDK' injects the bundled dressingroom-sdk.js with data-dressingroom-shop="{{ shop.permanent_domain }}" and the pk; app block 'Try in DressingRoom' renders <button data-dressingroom-product="{{ product.id }}" data-dressingroom-variant="{{ product.selected_or_first_available_variant.id }}">. Merchant adds the block in the theme editor (we deep-link them to it from the onboarding checklist). Themes without app-block support fall back to a documented snippet.
5. Handshake: click -> SDK POST /v1/sdk/intents -> mobile: open https://go.dressingroom.app/t/<id> (opens the PWA; if not onboarded, pendingIntent is stored and resumed after capture); desktop: QR modal of the same URL, polling /status. The app calls POST /v1/tryon/resolve: if the user has no pairing with the shop it shows the consent screen (shop name, what the shop receives, nothing else) and creates the pairing; a tryon_sessions row is created (billable). The app computes fit on-device, PATCHes the session with score/size, which flips the intent to 'fitted'; the desktop SDK shows 'Your size: M · estimate' and selects the matching variant; the SDK sets the hidden cart attribute _dr_session via /cart/update.js.
6. Attribution: orders/create webhook -> note_attributes._dr_session -> order_outcomes(ordered) linked to the session; refunds/create -> 'returned'; nightly rollup marks 'kept' after 30 days, writes analytics_daily, feeds the fit engine's trueToSizeScore suggestion back to the merchant ('this dress runs small: 23% returned size M after we recommended L').
7. Lifecycle: app/uninstalled -> shop 'uninstalled', keys revoked, usage finalised; shop/redact 48 h later purges rows; reinstall restores from metafields.

WOOCOMMERCE (free plugin on WP.org; paid account on our side)
1. Install plugin -> Settings -> 'Connect to DressingRoom' -> plugin POSTs /merchant/woo/connect (site URL, nonce) and redirects the admin to console.dressingroom.app/connect?nonce= -> merchant creates an account (magic link), picks a plan, pays via Stripe Checkout (subscription with a flat price + a metered price on a Billing Meter 'tryon_session'; 14-day trial) -> console calls /merchant/woo/complete -> redirects back to wp-admin with sk/pk in a one-time signed token; the plugin stores them encrypted. No telemetry before this click (WP.org rule).
2. Product data: 'DressingRoom' tab in the product data metabox (fabric, ease, lengths, patternBlock, criticalFitPoints, stretchZones, sizingNotes, size chart grid keyed on the product's size attribute terms, flat-lay from the media library); meta `_dressingroom_*`. CSV import mapped to the same meta. Validation in the admin JS form uses garment.schema.json; completeness is returned by /merchant/garments/validate and shown inline.
3. Sync: save hooks enqueue an Action Scheduler job that pushes raw WC product JSON + our meta to PUT /merchant/garments/batch (HMAC with sk; 50 per batch); 'Sync all' runs the full catalog in the background with progress in the settings page; the api normalises with normalize/woocommerce.ts. The plugin also exposes dressingroom/v1/products/{id} (HMAC-signed) so the api can pull-resync a stale item.
4. Storefront: bundled assets/dressingroom-sdk.js enqueued on single-product pages (no remote script), button auto-inserted at woocommerce_single_product_summary priority 35 (toggle), plus shortcode and a block.json block for block themes. Same intent/QR/deep-link flow; on 'fitted' the SDK selects the variation and sets a `dr_session` cookie.
5. Attribution: woocommerce_checkout_create_order copies the cookie to order meta `_dr_session`; order completed/refunded hooks POST /merchant/orders. HPOS-compatible.
6. Billing: usageReporter job reports daily tryon_session counts to Stripe meter events; Stripe webhooks keep subscriptions in sync; past_due -> soft limit (button keeps working, hero renders and ads off, email).

SHARED
- Plans (plans table): Starter €29/mo incl. 500 sessions, Growth €99/mo incl. 3,000, Scale custom; overage €0.05/session; hero render €0.25 pass-through; ads CPM €2. Shopify merchants pay through Shopify Billing (mandatory for app charges), Woo merchants through Stripe; one usage_records table feeds both reporters.
- Ads toggle: shops.ads_enabled + daily budget. When on, the shop's published garments enter /v1/deck for users who are NOT paired with it, flagged promoted; the on-device taste engine decides who actually sees them ('the app knows who to target' without the merchant receiving any user data); each deck impression is an ad_impression usage record capped by the daily budget. Users can hide a shop's promoted items.
- Merchant console: Shopify merchants use the embedded app, Woo merchants console.dressingroom.app; both render packages/console-ui from the same /merchant/analytics/* routes: try-ons, conversion, return rate, conflicts, size heatmap per garment, cohort bars, pass-reason breakdown, buying-advice predictions, privacy ledger, usage meter, billing.
- Physical-store pairing: /merchant/pairing-code QR on a counter card pairs the shop without a product intent.

### Deployment

Single VPS (8 vCPU / 16 GB / NVMe, EU datacentre; GPU optional later), Ubuntu 24.04, Docker Engine + Compose v2, deploy user with the repo's infra/ checked out at /srv/dressingroom, secrets in /srv/dressingroom/.env (0600, never committed). DNS: app., api., go., console., shopify., cdn. -> the VPS IP.

compose.prod.yaml services (all on an internal network; only caddy publishes 80/443/443-udp):
- caddy (caddy:2, volumes caddy_data for certs): automatic TLS via Let's Encrypt (HTTP-01), HTTP/3, HSTS. Caddyfile routes: app.dressingroom.app -> file_server from the web-dist volume (SPA fallback, /models/* and /assets/* immutable cache 1 y, service worker no-cache); api.dressingroom.app and go.dressingroom.app -> reverse_proxy api:8080; console.dressingroom.app -> file_server console-dist; shopify.dressingroom.app -> reverse_proxy shopify:3000; cdn.dressingroom.app -> file_server sdk-dist (/sdk.js, versioned /sdk/v1.x.js, CORS *). /metrics and /webhooks/ai/* are restricted (internal / allow-listed CIDRs).
- api (ghcr.io/<org>/dressingroom-api:<sha>, node:22-alpine, non-root, `node dist/server.js`, 2 replicas, healthcheck /readyz, 1 GB mem limit)
- worker (same image, `node dist/worker.js`, 1 replica, concurrency per queue; runs sync, webhooks, imagePrep, usageReporter, analyticsRollup, heroRender, retention)
- migrate (same image, one-shot `drizzle-kit migrate`, api depends_on: condition service_completed_successfully)
- web-build / console-build / sdk-build (one-shot images that copy their dist into named volumes caddy serves; rebuilt per deploy)
- shopify (ghcr.io/<org>/dressingroom-shopify:<sha>, React Router 7 node server, SHOPIFY_* env, session storage in Postgres schema shopify_sessions)
- postgres (pgvector/pgvector:pg16, volume pg_data, shared_buffers 2 GB, daily pg_dump by backup)
- redis (redis:7-alpine, appendonly yes, maxmemory 512 MB allkeys-lru only for the cache DB; BullMQ uses a separate DB index with noeviction)
- minio (minio/minio, buckets garment-images (public-read via Caddy signed URLs), hero-renders (24 h lifecycle), backups; console port internal only)
- imageprep (python 3.12 + rembg/BiRefNet, CPU, HTTP on 7000, 2 GB limit)
- backup (alpine + restic, cron 03:00: pg_dump | restic backup to an offsite S3/Backblaze bucket; minio mirror; 30 daily / 12 monthly retention; restore-drill.sh monthly)
- profiles: gpu -> fashn-vton (nvidia runtime, FASHN VTON 1.5, port 7100); observability -> prometheus + grafana + loki (pino JSON logs via docker driver); dev compose.yaml adds mailpit, and the Shopify CLI tunnel runs on the developer machine, not the VPS.

CI/CD (GitHub Actions): ci.yml on PR (pnpm install --frozen-lockfile, turbo typecheck/test/build, phpcs + phpunit via wp-env for apps/wordpress, bundle-secret grep); deploy-vps.yml on main: build api/shopify/web/console/sdk images -> ghcr, then ssh `cd /srv/dressingroom && docker compose -f compose.prod.yaml pull && docker compose up -d --remove-orphans` (migrate runs first, zero-downtime via two api replicas and Caddy health checks); shopify-deploy.yml on tag `shopify-v*` runs `shopify app deploy --force` for extensions/config; wporg-release.yml on tag `wp-v*` builds the plugin zip (composer install --no-dev, copies sdk + json schema) and pushes to WP.org SVN. Rollback = redeploy the previous sha tag.

Hardening: ufw (22/80/443 only), fail2ban, unattended-upgrades, Docker log rotation, Caddy rate limits on /v1/sdk/* and /webhooks/*, @fastify/rate-limit per principal, Postgres only on the internal network, MASTER_KEY/JWT keys generated by infra/scripts/bootstrap.sh. Moving to managed cloud later = point DATABASE_URL at managed Postgres, S3_ENDPOINT at real S3, REDIS_URL at managed Redis, and run the same images on a container service; nothing in the code changes.

### MVP sequence

1. Week 1 — Foundation + the pure engines. Bootstrap the pnpm/turbo monorepo; move the prototype to apps/web and delete the Gemini/express wiring; create packages/schema (GarmentPayloadV1 + completenessScore + JSON-schema export), packages/fit-engine (computeFit/recommendSize with the handoff test vectors), packages/taste-engine (applySwipe/penaltyMemory/rankDeck) — all green in vitest. Stand up apps/api skeleton (Fastify, Drizzle migrations for merchants/shops/products/garments/api_keys/webhook_inbox, auth plugin, OpenAPI) and infra/compose.prod.yaml with Caddy TLS on the founder's VPS; /healthz live on api.dressingroom.app by Friday.
2. Week 2 — Shopify app core. Scaffold apps/shopify from the React Router 7 template with Postgres session storage; managed install, declarative webhooks incl. the three GDPR topics, metafield definition creation, bulk initial sync + products/* incremental sync through webhook_inbox -> normalize/shopify.ts -> garments/variant_map/garment_images; imageprep service for flat-lays; 'Complete your garments' Polaris form writing metafields; completeness queue. A dev store shows 20 synced garments with scores.
3. Week 3 — SDK, theme extension, deep link/QR, first end-to-end. Build packages/sdk (intents, QR modal, status polling, variant select, cart attribute); theme app extension (app embed + app block); api routes /sdk/*, go.dressingroom.app/t/:id, /tryon/resolve, pairings + consent screen, tryon_sessions, PATCH session, /events batch with Dexie outbox in the app. The dev store's product page -> phone -> fit computed on-device (manual measurements only) -> size shown back on the desktop page. Pairing ledger entries visible in the app's profile screen.
4. Week 4 — Billing, attribution, analytics, console v1, submit to Shopify review. appSubscriptionCreate with recurring + usage lines and trial; usageReporter (appUsageRecordCreate) and plan-enforcement middleware; orders/create + refunds/create attribution via _dr_session; analyticsRollup -> analytics_daily; packages/console-ui (stat cards, size heatmap, cohort bars, conflicts, privacy ledger panel) rendered in the embedded app; ads toggle persisted and wired into /v1/deck with 'promoted' flag; App Store listing, privacy policy, GDPR webhook tests; submit for review (review time is the critical path, so this cannot slip past week 4).
5. Week 5 — WooCommerce plugin + Stripe. apps/wordpress: settings page with Connect flow, encrypted key storage, product-data tab + CSV import validated by garment.schema.json, Action Scheduler sync to /merchant/garments/batch, bundled SDK button (hook/shortcode/block), order/refund attribution, HPOS declaration, uninstall.php, readme with External services; apps/console standalone (connect, overview, garments queue, billing, settings) with Stripe Checkout + Billing Meter + webhooks; PHPCS/PHPUnit in CI; submit to WP.org (another multi-week review queue, so it goes in now).
6. Week 6 — Consumer capture v1 + persistence + signature. packages/capture: face step (MediaPipe FaceLandmarker + segmenter, ITA/Monk/undertone/season, identity tile), manual measurements with 'how measured' sigmas, 8-s video gating + 4-view silhouettes + analytic girths (regressor stubbed by the population prior), inverse-variance fusion with the 60/95/conflict confidence rule and remeasure prompt, Anny mesh fit + silhouette atlas; Dexie bodyProfile; FitSignatureV1 built and synced with ledger entry; fit engine switched to the probabilistic path; PWA installable (manifest, service worker, self-hosted models under /models/, offline deck).
7. Week 7 — Render path B + hero render behind a flag. packages/render: UV templates for top/bottom/dress/outerwear (shoes/accessory get a placement template), warp with per-point ease from fit.perSize so S/M/L read tight/fits/loose, drape hem sag, sheen/opacity material pass, face-tile composite, burned-in 'estimate' badge; mirror and deck rewired to real renders with the prototype's frame; Playwright visual regression for the §9 fabric and size tests. packages/ai-adapters with FashnProvider + VertexTryOnProvider + router + ledger entries; POST /v1/render/hero opt-in flow (consent sheet naming provider/retention), heroRender worker, 24-h MinIO lifecycle; bake-off harness started on 50 real SKUs.
8. Week 8 — Pilot + hardening. One real Shopify shop and one real WooCommerce shop live on paid trial; fix normaliser edge cases (size attributes named differently, multi-colorway products); load test /sdk/intents and /tryon/resolve (k6, 50 rps); backups + restore drill; rate limits, fail2ban, uptime alerts; GDPR webhooks replayed from fixtures; usage reconciliation vs Shopify/Stripe; docs/MERCHANT-ONBOARDING.md and docs/PRIVACY-LEDGER.md; founder sign-off on the three §9 bars with real garments. Wardrobe & Rooms, size-hint widget, Grok/Kling video, Capacitor shell and the trained ONNX regressor are explicitly post-MVP.

### Trade-offs

1. Catalog on our backend instead of 'app asks the shop's API' (handoff §3.2): costs a sync pipeline and storage, but removes CORS/rate-limit/auth problems on the client, makes the plugin thinner (push raw, normalise once in TS), and is what makes merchant analytics, predictions and ads possible at all. The shop stays the source of truth for Shopify (metafields) so uninstall/reinstall is lossless; for Woo the meta lives in the merchant's database for the same reason.

2. Bill per try-on session, not per compute call: fit is computed on-device (privacy and quality win), so a 'per API call' price would bill nothing. A session (one product resolved by one user) is countable identically by Shopify Billing usage records and Stripe meters, is understandable to merchants, and cannot be gamed by the app's retry logic (idempotent by intent). Downside: a user who opens a product and bounces still counts; mitigated by only counting sessions with a fit result written, and by the included quota.

3. Two billing systems are unavoidable: Shopify mandates its Billing API for App Store apps (and takes its cut), WordPress has nothing, so Woo merchants pay via Stripe. One plans/usage_records model feeds two reporters; the console shows the same numbers. Managed Pricing on Shopify was rejected because it cannot meter overage.

4. Two consoles (embedded Shopify app + standalone console) sharing packages/console-ui, rather than one iframe'd console: Shopify review requires an embedded, App Bridge-driven app, and Woo merchants need a place outside wp-admin for billing. The cost is two shells; the components, routes and data are shared.

5. React Router 7 template, not 'Remix': this is the current Shopify template (Remix was folded into React Router 7); writing a Remix v2 app today would be built on a deprecated package. Polaris web components rather than Polaris React for the same reason.

6. Bundled SDK copies in both plugins versus one CDN script: slightly slower propagation of SDK fixes (needs a plugin release) but it satisfies the WP.org 'no remote code' rule and Shopify's extension asset model, avoids a third-party request on the merchant's page, and removes cdn.dressingroom.app from the critical path. cdn.dressingroom.app/sdk.js still exists for custom/Etsy/Amazon-style integrations.

7. PWA-first consumer app limits deep links: iOS Safari cannot register universal links for a PWA, so the go.dressingroom.app link opens in the browser tab (which is fine for the QR/desktop flow and acceptable for mobile), and camera access via getUserMedia works but without native capture polish. Capacitor later gives universal links and native camera without changing packages/capture or render. Expo was rejected for v1 because it would fork the UI and the MediaPipe web pipeline.

8. Single VPS = single point of failure: accepted for the pilot in exchange for cost and simplicity; mitigated by two api replicas, nightly offsite backups with a monthly restore drill, and S3/Postgres/Redis indirection so moving to managed services is config-only. Caddy over Traefik/nginx for zero-config TLS; Compose over Kubernetes because one operator runs this.

9. Drizzle over Prisma and pgvector from day one: Drizzle keeps SQL visible and works with vector(80) and jsonb GIN indexes without escape hatches; pgvector is cheap insurance for the 'bodies like yours bought M' kNN even though v1 does not query it.

10. Hosted FASHN/Vertex for hero renders means a synthetic avatar image of the user does leave the device on explicit opt-in — the only place the 'nothing leaves' promise is softened, and it is labelled per render in the ledger. The self-hosted FASHN VTON 1.5 path removes the third party but needs a GPU the VPS does not have today and outputs 576×864; if the founder values the hard privacy line over hero quality, adding a GPU is the lever, not a code change.

11. Review queues are the real schedule risk: Shopify App Store and WP.org reviews each take weeks and can bounce; both submissions are placed at weeks 4 and 5 so a rejection can be fixed inside the eight weeks, and custom-distribution (Shopify) plus a direct-download zip (Woo) let the pilot shops run before approval.

12. Shopify orders data: we take read_orders and declare minimal Protected Customer Data access to get line items + the hidden cart attribute; this adds a Partner Dashboard approval step but is the only way to close the kept/returned loop that the fit engine's trueToSizeScore and the merchant's return analytics depend on.

13. No Next.js anywhere (the AGENTS.md in /home/user/CV-Builder-Bold is for an unrelated project): Vite SPAs + Fastify keep the PWA, the console and the API independently deployable and keep the Shopify app on Shopify's own template.

