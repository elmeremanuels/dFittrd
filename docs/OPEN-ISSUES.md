# Open issues

One consolidated list of every open issue named in the reports under `docs/reports/` and in `docs/STATUS.md`, deduplicated.
Compiled on 19 Nov 2026 from the reports listed below; issues that a later report or the code shows as fixed are at the end.

## Reports read

| Short name | Path | Sections read |
|---|---|---|
| head-v3 | `docs/reports/claude-head-v3.md` | Open issues, Verdict |
| platform-checks | `docs/reports/claude-platform-checks.md` | Open issues |
| ai-realism | `docs/reports/claude/ai-realism.md` | Not done, and why |
| analytics-kfloor | `docs/reports/claude/analytics-kfloor.md` | Measured, assumed, not covered; Other open findings of the launch-readiness report |
| bake-qa-gate | `docs/reports/claude/bake-qa-gate.md` | Measured, assumed, not done; Open issues |
| face-2d | `docs/reports/claude/face-2d-slice5.md` | Assumed, not measured; Honest look; Open issues |
| face-on-head | `docs/reports/claude/face-on-head-spike.md` | MediaPipe finding; Assumed, not measured; Open issues |
| launch-readiness | `docs/reports/claude/launch-readiness.md` | Review findings (Open); Measured versus assumed; Open issues |
| male-2d-v2 | `docs/reports/claude/male-2d-v2.md` | Open issues |
| male-shape-v2 | `docs/reports/claude/male-shape-v2.md` | Open issues |
| men-admin-columns | `docs/reports/claude/men-admin-columns.md` | Measured vs assumed; Open issues |
| men-m1b | `docs/reports/claude/men-m1b-2d.md` | Open issues |
| men-m3-tee | `docs/reports/claude/men-m3-tee.md` | Open issues |
| men-tee-v2 | `docs/reports/claude/men-tee-v2.md` | Verdict; Open issues |
| dress-not-drawn | `docs/reports/claude/dress-not-drawn.md` (added 20 Nov 2026) | Verdict; Assumed; Open issues |
| merchant-onboarding | `docs/reports/claude/merchant-onboarding.md` | Measured vs assumed; Open issues (not fixed here) |
| pom-gate | `docs/reports/claude/pom-gate.md` | Diagnosis; Review findings; Open issues |
| privacy-wall | `docs/reports/claude/privacy-wall.md` | Summary; Open issues |
| skin-v2 | `docs/reports/claude/skin-v2.md` | What I measured and what I assumed; Open issues; Verdict |
| STATUS | `docs/STATUS.md` | Founder decisions open; Known gaps (carried items expanded from `docs/STATUS-HISTORY.md` "Known gaps") |
| men-m2 | no report file exists. Notes taken from `docs/research/men-3d-plan.md` ("Status: slices M2a and M2b built", "Not done in M1, and still open") and commit `c35cdc1` | Not done |

Marks: **needs-founder** (a decision or an action only the founder can take), **needs-counsel** (legal review),
**needs-real-device** (needs a real phone, real GPU, paid provider, real Shopify store, real VPS, real garment or real volunteers),
**engineering** (can be done in the repository). Each row has exactly one mark. "Size" is a guess.

Counts: needs-founder 18, needs-counsel 7, needs-real-device 15, engineering 64. Total 104 open rows.

## needs-founder

| Id | Issue | Status | Source |
|---|---|---|---|
| OI-01 | Shopify custom app or public app for the pilot. The choice cannot be changed per app. Advice: custom for the pilot. | open | STATUS (decision 1), launch-readiness (F1) |
| OI-02 | VPS region and purchase. Advice: Sydney, 2 vCPU / 2 GB / 40 GB, Ubuntu 24.04. The price ("roughly USD 12–24 a month") is assumed, not checked on the provider's page. | open | STATUS (decision 2), launch-readiness (F2, Measured versus assumed) |
| OI-03 | Merge PR #1 into `main`, after the parallel branches are merged into it and its CI is green. | open | STATUS (decision 3), launch-readiness (F3) |
| OI-04 | Approve the first deploy through the `production` environment's required reviewer. Whether the founder's GitHub plan allows required reviewers on a private repository is assumed; check before runbook step 6. | open | STATUS (decision 4), launch-readiness (F4, Measured versus assumed) |
| OI-05 | Accept PHP 8.1 as the WooCommerce minimum (8.0 is end of life). Not on the Shopify pilot path. | open | STATUS (decision 5), launch-readiness (F5) |
| OI-06 | `MEN_3D_GATE=1` in production. `infra/.env.example` and `apps/api/src/env.ts` still default to 0, against D20 point 3. The same file carries a second open founder switch, `MEN_3D_GATE_SHOES_ACCESSORIES`. | open | STATUS (decision 6), launch-readiness (finding 3, F6), analytics-kfloor ("Left") |
| OI-07 | Pilot price arrangement: a custom app cannot bill through Shopify, so write down with the merchant either a free pilot or USD 8.99 a month invoiced outside Shopify. Trial length (`BILLING_TRIAL_DAYS`, default 7) is only needed for public billing. | open | STATUS (pilot table, decision 8), launch-readiness (F8) |
| OI-08 | `@curtain/sdk` is `UNLICENSED` but ships inside a WordPress.org plugin, which must be GPL-compatible (#14). A founder and legal call, needed before a WP.org listing. | open | STATUS (decision 8, Known gaps) |
| OI-09 | The WooCommerce plugin slug `curtain-woocommerce` breaks the WordPress.org trademark rule (Plugin Check warning). Decide a new slug before listing. | open | platform-checks |
| OI-10 | WooCommerce: a product with a fabric but no drape is refused as a whole (400). The merchant now sees why. Decide whether the payload builder should leave out an incomplete fabric instead. | open | platform-checks |
| OI-11 | A WooCommerce merchant cannot get into the merchant console alone: Connect stores the secret key encrypted and never shows it, and the console asks for it. Decide: a one-time console link from the plugin, or show the key once. | open | merchant-onboarding (1) |
| OI-12 | WooCommerce Disconnect only clears local settings; it does not cancel billing or delete the shop on the api. A `DELETE /v1/merchant/shops/self` with a Stripe cancel would close it; decide whether deletion is immediate or delayed. | open | merchant-onboarding (2) |
| OI-13 | Lighting and skin shading defaults. D22 keeps `classic` lighting until the founder approves a change. Under `classic` the male under-jaw of head v3 is 13–14 L\* dark and Monk 1–3 stay grey-white; `neutral-v2` fixes both. skin-v2 is ready for the look review and is off by default. Both reports recommend deciding after one real-phone check. | open | head-v3 (1, Verdict), skin-v2 (1, Verdict) |
| OI-14 | Short bodies (130 cm) get a small head on an adult neck. Needs a decision on body proportions (should the head scale less than stature?), not a change to the head. | open | head-v3 (2) |
| OI-15 | Look review of the male 2D figure v2 and male shape v2 (both off by default). The hip-corner nub and the neck flare are left until the founder has looked. | open | male-2d-v2, male-shape-v2 |
| OI-16 | A merchant can run K−1 fake shoppers next to one real one and read that shopper's size from the aggregates (device creation is open). Rate limits help; the real fix is paired devices only, which is a product decision. Also in D23 for the founder to overrule: periods are months, not ISO weeks. | open | analytics-kfloor |
| OI-17 | The skirt's hip line is taken 20 cm below the top edge (`pom_rest.py`, an assumed depth). The pilot shop never stated the distance; ask them. | open | bake-qa-gate (Assumed) |
| OI-102 | Not-drawn rule: a size the fit engine bands `tight` but that is still larger than the body (one size down on a woven dress: 2 cm left over the bust) is drawn, because the cloth closes. The engine does not call that size wearable. Decide whether "not wearable" should mean "not drawn"; it is one line in `wearBlock` and hides one more size down on every woven garment. | open | dress-not-drawn (Assumed) |

## needs-counsel

| Id | Issue | Status | Source |
|---|---|---|---|
| OI-18 | Legal review of the privacy policy, terms and consent copy before real shoppers (D19, D20 point 4). The in-app privacy page is a draft ("Not in force", `[DATE OF PUBLICATION]` placeholder). | open | STATUS (decision 7), launch-readiness (F7), face-2d (1) |
| OI-19 | Face-photo labels that are not in the copy document and must go to counsel with it: the age box ("I am 16 or older"), "Take a photo", "Choose a photo", "Read it from my photo", "No, I will pick it myself", the suggestion sentence, "From your photo", the six photo hints, the match hint and the "Remember me first" hint. | open | face-2d (1) |
| OI-20 | Minimum age for the face photo. The copy's `[16]` placeholder is shown as 16 (`FACE_PHOTO_MIN_AGE`); counsel decides the number. The box is a self-declaration, not an age check. | open | face-2d (2) |
| OI-21 | Two "remember" switches: "Remember my photo" needs "Remember me on this shop" on, and turning "Remember me" off wipes the stored face. Founder and counsel to confirm. Also confirm the claim "Deleted from this device" (tile dropped, `blob:` URL revoked, stored row and key deleted; when the browser frees the memory cannot be tested). | open | face-2d (6, 7) |
| OI-22 | The men's body size-chart templates are held back for legal review. Two blank men's garment templates are offered; the body templates are not. | open | men-admin-columns, STATUS (What is built) |
| OI-23 | What the MediaPipe usage-log message (`odml.pa.googleapis.com/v1/log`) holds was never decoded (from the code: task type, running mode, timings). It is now refused twice, but it deserves a line in the privacy terms review. | open | privacy-wall (5), face-on-head |
| OI-24 | Licence confirmations made by an agent, not a lawyer: the Anny row in `docs/LICENSES.md` comes from the spike's tool table, not the upstream licence file; the Monk swatch values and licence were checked against Wikipedia's citation, not Google's page; licences beyond the two MediaPipe sources were not read at source. | open | analytics-kfloor, skin-v2 (7), face-on-head (Assumed) |

## needs-real-device

| Id | Issue | Status | Source |
|---|---|---|---|
| OI-25 | Nothing has run against a real Shopify store, Let's Encrypt, GHCR, the GitHub workflows or a real VPS (runbook steps 8–14, `docs/LAUNCH-SHOPIFY.md` part D). The Shopify dashboard and CLI 5.0.1 are assumed to behave as the 9 Nov doc describes. | open | STATUS (What was verified), launch-readiness (Measured versus assumed) |
| OI-26 | Two Shopify behaviours to check on the dev store (step D2): `choices` on the list-type metafield `critical_fit_points` may be refused, and token exchange sends JSON while the doc sample is form-encoded. | open | platform-checks |
| OI-27 | Merchant onboarding was measured against a fake Shopify, a stub App Bridge and test shims, with no real store, no real WordPress and no real phone. The theme editor step is assumed at 2 minutes (runbook step 12). | open | merchant-onboarding (Measured vs assumed, 6) |
| OI-28 | The men's chart columns are not proven in real WordPress or Shopify: screenshots come from harnesses, the meta box's jQuery behaviour was not run, and the Docker WordPress e2e (`e2e/run.mjs`) was not run for this change. | open | men-admin-columns (Measured vs assumed) |
| OI-29 | No frame cost measured on a real phone GPU. In the software renderer head v3 costs +13–15 % over v1 and skin-v2 +17–25 % (body alone). The tee's frame rate and the drape settle time are also unmeasured on a phone. | open | head-v3 (7), skin-v2 (3, 8), men-m3-tee, STATUS (carried: spike viewer) |
| OI-30 | Face photo flow not run on a real phone: iOS Safari and Android Chrome inside a merchant iframe, phone timings, memory pressure, `OffscreenCanvas` in workers, and whether `capture="user"` opens the front camera. The plan's acceptance asks for a manual check on both platforms. | open | face-2d (Assumed), face-on-head (Assumed, Open issues) |
| OI-31 | The scan worker's GPU path was the first default and is slow under SwiftShader. The GPU-or-CPU choice must be measured on real phones. | open | face-on-head |
| OI-32 | Synthetic faces only. Real photos (hair over the forehead, glasses, beards, head covering, busy backgrounds, JPEG noise) were never tried; the edge gate is tuned on seven synthetic faces; the light notice thresholds are untuned (a "cast" false alarm); dark brows on Monk 9–10 may read worse than in the renders. Needs the slice 9 test set of real photos. | open | face-2d (Honest look, 10), face-on-head (Assumed) |
| OI-33 | AI realism: no call to any real provider was made (no keys, no paid calls). The fal fields `image_size` and `sync_mode`, the ControlNet checkpoint fal runs, and real latency are not verified. | open | ai-realism |
| OI-34 | Real-tee calibration: tape one real tee flat (the seven inputs plus armhole depth and neck), build it, compare with its photos, project its flat-lay photo with a measured scale, and settle the across-shoulder convention. Nothing in the tee work was measured on a real tee. | open | men-m3-tee, men-tee-v2 |
| OI-35 | The scan prior blend puts about 58 % of the population prior into the girth means (#17). Revisit with tape-measured volunteers. | open | STATUS (Known gaps, carried) |
| OI-36 | Assumed body values never measured on people: the male relief sizes, the 2D head half-width (7.7 cm), the deltoid standing 10 % proud, neck and limb depth ratios, the male foot length (27 cm). | open | male-shape-v2, men-m1b |
| OI-37 | The pull-on allowance (2.5 cm, 0 when extrapolated) is the fit engine's assumed value; the bake and its check inherit it. The bake-check tolerance ±max(2 cm, 2 %) is also a judgement. Needs real garments on real hips. | open | pom-gate (4), bake-qa-gate (Assumed) |
| OI-38 | Docker Hub rate-limits anonymous pulls (hit again on 19 Nov). Run `docker login` on the server, or pull through `mirror.gcr.io`. | open | STATUS (Known gaps), launch-readiness, platform-checks |
| OI-101 | The one not-drawn rule was not seen in a browser on the azure dress, the photo skirt or the POM skirt bake: their bundles are git-ignored and need a GPU reconstruction or Blender drapes. Covered by unit tests on their payloads only. `apps/web/e2e/garment3dBake.spec.ts` had its expected wording changed and was not run. | open | dress-not-drawn (1) |

## engineering

| Id | Issue | Size | Status | Source |
|---|---|---|---|---|
| OI-39 | Shopify `Product.featuredImage` / `Product.images` are deprecated in 2026-10. Moving to `featuredMedia` / `media` changes `ShopifyProductNodeSchema` and the bulk parser (`packages/shopify-app/src/graphql/products.ts`, `bulk.ts`). | medium | open | platform-checks, STATUS (Known gaps) |
| OI-40 | WooCommerce rename state: with the chart saved as 6… and the tape still naming 8, row 8 is dropped and other rows are re-estimated, so the merchant sees "rough estimate" on rows until the orphan row is fixed. Documented behaviour, but confusing. | medium | open | platform-checks |
| OI-41 | AI realism has no per-shop monthly cap; only a per-request cost cap and a per-IP rate limit. Needed before the flag goes on. | medium | open | ai-realism |
| OI-42 | AI realism refuses printed garments: the colour-key segmentation works for plain colours only. Learned segmentation (MediaPipe multiclass, Apache-2.0) is the next step. | large | open | ai-realism |
| OI-43 | The AI realism route is synchronous with a 60 s provider timeout. Move it to the job queue if real latency is long. | medium | open | ai-realism |
| OI-44 | No Modal adapter for AI realism (the fallback's next step; needs GPU runs to prove). | medium | open | ai-realism |
| OI-45 | `apps/web/src/embed/__tests__/avatarPrompt.test.tsx` failed once in a full embed run (a timing flake); it passed alone and in two more full runs. | small | open | ai-realism |
| OI-46 | The k-floor property tests use a linear attacker. Not covered: inference from non-negativity and bounds, and rates as such. A merchant also learns when the complementary rule fired ("the hidden ones together had fewer than K"). | large | open | analytics-kfloor |
| OI-47 | Analytics cohort: a wardrobe item changed in a later month counts in both months' cells, which over-counts `n` slightly and mixes kept-rate months. | small | open | analytics-kfloor |
| OI-48 | No committed go-live smoke script. The rehearsal's 46 edge checks were never committed; runbook step 9 lists a short manual set instead. | medium | open | launch-readiness, analytics-kfloor |
| OI-49 | `docker build -f apps/api/Dockerfile .` was not run after the bake-gate change to the Dockerfile (the garment-viewer copy). launch-readiness built the image on 19 Nov on its own branch; whether that build included this change is not verified. | small | open | bake-qa-gate (2) |
| OI-50 | The swipe deck sends the engine's `fitScore` with each swipe, including that of a blocked closest size. A blocked size scoring 0.999 can rank a garment that does not pull on. Web deck and `packages/taste-engine`. | medium | open | bake-qa-gate (3) |
| OI-51 | The merchant console has inline English everywhere except the new 3D review, which uses the catalogue (`apps/web/src/merchant/`). | medium | fixed in claude/loose-ends (every console string in `merchant/strings.ts`, guard test) | bake-qa-gate (4) |
| OI-52 | The 3D bake review exists only in the web merchant console, not in the Shopify embedded admin. | large | open | bake-qa-gate (5) |
| OI-53 | `refusals_declared` lets a size skip a body inside its draped range (the real bake does this for AU 10–16 at t = +0.5). The phone's blend across that body is not checked; the spike measured it at 1.4–1.9 cm RMS. `packages/garment-viewer/src/bakeGate.ts`. | medium | open | bake-qa-gate (6) |
| OI-54 | Drape start shape: `drape_blender.py` pushes particles that start inside the body out by 0.8 cm and Blender builds springs from that shape, so the hip line is born stretched (up to +7.1 %, one segment +15.7 %) where hip ease is under about 15 cm. The pull-on rule hides it on the current 3-body grid only. Fix the start shape, then re-make every drape. Needs Blender and the git-ignored `out/`. | large | open | pom-gate (1, Diagnosis) |
| OI-55 | The 3D view is stricter than the advice at hips 114–115 for AU 16: the avatar is 3 cm wider below its hip ring than its hip, so the advice recommends AU 16 at hip 114 and the 3D view does not draw it. | medium | open | pom-gate (2) |
| OI-56 | A bake refusal for a reason other than pull-on only has to state a reason; the gate cannot recompute it. | medium | open | pom-gate (3) |
| OI-57 | No per-shop kill switch for the face photo (gate G7). Only the build flag `VITE_AVATAR_FACE_PHOTO` exists; the session endpoint sends no `photo` / `face` flag. Needs `packages/schema` and `apps/api`. | medium | open | face-2d (3) |
| OI-58 | No live selfie. "Take a photo" is a file input with `capture="user"` (one frame); the plan's median of 5–10 frames through `getUserMedia`, with live light gates, is not built. | medium | open | face-2d (4) |
| OI-59 | The hue measured from the photo is not kept when the shopper picks another class; the confirmed colour is always the swatch. Left out on purpose until white balance (slice 9) exists. | medium | open | face-2d (5) |
| OI-60 | "See it on me" sends the standard figure with no tone. D20.1 allows the skin tone; it is not wired, so copy lines C13 and C28 are not shown. The face must never be sent (rule 1, gate G3). | medium | open | face-2d (8) |
| OI-61 | 2D face tile leftovers: the chip sits on the 2D figure only, not beside the 3D view; the tile on the male 2D figure was never tried; the top of the head is bare above the face oval because the figure has no hair (hair picker, plan slice 2, not built). | medium | open | face-2d (9, Honest look) |
| OI-62 | The face is not wired into the embed's 3D view: `Garment3D` does not pass `look.face` and `EmbedApp` does not pass the `faceOnHead` row. The viewer side is unit-tested but never seen in a browser with a garment. When wired, the hero allowlist test needs a case with a face present (G3), and the face is not stored anywhere (slice 7). | medium | open | face-on-head |
| OI-63 | `calmHead` widens the head with the bust and `faceUvOf` reads the widened head, so the face maps up to about 6 % narrower than drawn on large bodies. | small | open | face-on-head |
| OI-64 | The face yaw estimate overshoots by about 20 %. | small | open | face-on-head |
| OI-65 | No D19 face upload route exists. When it is built it needs its own abuse limits and the nothing-stored test (`docs/legal/` test spec). | large | open | STATUS (Known gaps), launch-readiness |
| OI-66 | Cross-origin isolation (COEP/COOP `require-corp`) is set in production but not in the preview, so the e2e runs MediaPipe without threads and the isolation is untested. | medium | open | privacy-wall (1) |
| OI-67 | Embed framing is `frame-ancestors https:`, not per shop. A per-shop value would need the embed document served by the api. | large | open | privacy-wall (2) |
| OI-68 | No CSP reporting in production (deliberate: reports carry URLs with try tokens). A violation in production is silent; the e2e suite is the only detector. | medium | open | privacy-wall (3) |
| OI-69 | `apps/web/e2e/privacyModels.spec.ts` needs the models (about 50 MB, not in git) and skips without them, so CI does not run it. A CI job would fetch them with `pnpm --filter @curtain/web models` and cache them. | small | open | privacy-wall (4) |
| OI-70 | The demo storefront (`apps/demo-shop`) and the marketing site were not re-run after the CSP work; the site's own CSP is unchanged. | small | open | privacy-wall (6) |
| OI-71 | Head v3 on the darkest and palest tones: hair on Monk 9–10 is nearly invisible (still a very dark shade of the skin under skin-v2), eyes and brows on Monk 9–10 vanish, hair on very pale skin has a greyish edge, and on Monk 8 a thin light line shows along the hairline under skin-v2. | medium | open | head-v3 (3), skin-v2 (2, pictures) |
| OI-72 | Head v3 cosmetic defects: the male crop's straight front hairline reads cap-like; faint shading bands at the back of the neck; small lid steps at the eye corners in close-ups. | small | open | head-v3 (4, 5) |
| OI-73 | Hair adds up to 1.6 cm above stature, so the figure is that much taller in the frame. Garments and fit are unaffected. | small | open | head-v3 (6) |
| OI-74 | skin-v2 tuning: the red shadow edge is too subtle to see at phone size (scale 1.2 chosen by eye); the see-through dress shifts by up to 1.2 ΔE over skin; the 2D figure is 4–5 L\* below the swatch on Monk 1–6 and Monk 6 is 5 ΔE off. | medium | open | skin-v2 (4, 5, 6) |
| OI-75 | skin-v2 is untested on the drape-bake mount and in a production embed build with `VITE_AVATAR_SKIN=skin-v2`; the report's pictures were not re-rendered after the merge with `claude/garment-engine`. | small | open | skin-v2 (8, Merged) |
| OI-76 | `Figure.setBody` (`packages/garment-viewer/src/scene.ts`, about line 720) puts the shared grey material back on a figure that has a skin colour when the new geometry has the same vertex-colour setting (its final `else`). Only the spike's `main.ts` calls it. Still present in the code on 19 Nov. | small | fixed in claude/loose-ends (`scene.ts`, test in `look.test.ts`) | skin-v2 (9) |
| OI-77 | Male shape v2 cannot be switched on until every male bundle is re-draped on the v2 body. `spikes/garment-engine`, `mannequinFor` and `build:assets` still build the v1 male body; the viewer only borrows the v1 twin for the collision exemption. | large | open | male-shape-v2, male-2d-v2 |
| OI-78 | The tee must be built on male shape v2: the builder misses its tape by up to 3.3 cm there, and the armholes of the v1-built tee strain 11–20 % from L up on v2. | medium | open | men-tee-v2 |
| OI-79 | `shapeForBody`'s arm-clearance rule runs on v1 geometry. The v2 chest is broader from L up, so a typed very large chest with narrow shoulders could let the arm touch the chest ring. All tested bodies keep the gap. | small | open | male-shape-v2 |
| OI-80 | `torsoAt` / `legAt` / `armAt` on a v2 body return an envelope ellipse, not the section's girth ellipse, so cloth stands a little off the flat sides of the torso. The deltoid also adds 0.1 cm over ANSUR's bideltoid breadth. | medium | open | male-shape-v2 |
| OI-81 | Male 2D figure v2: a nub at the hip corners and a flare at the neck (needs a change to the smoothing). The ratio table is measured on the five table bodies only; a body far outside S–XXL is held at the end rows. | small | open | male-2d-v2 |
| OI-82 | 2D figures: no hands on either figure, a slight shoulder kink on the male one, and S…XXL differences are subtle in the frame. | medium | open | men-m1b |
| OI-83 | The female 2D figure has a hole at the left armpit (fill rule). It is pinned by the golden, so fixing it means updating the golden on purpose. `apps/web/src/render/body.ts`. | small | open | men-m1b |
| OI-84 | Ring and body-chip strings are inline in `apps/web/src/render/rings.ts` and `AvatarView.tsx`, not in the string catalogue (D21). | small | fixed in claude/loose-ends (`apps/web/src/strings/en/shared.ts`, guard test) | men-m1b |
| OI-85 | Shopify: re-assigning a chart without a sleeve column leaves an older `sleeve_convention` metafield in the shop, because `metafieldsSet` cannot delete. Fit is not affected. | small | open | men-admin-columns |
| OI-86 | Shopify, existing shops: the `critical_fit_points` metafield's `choices` validation still lists the 7 women's points, and the new `sleeve_convention` definition is only created by the install or definition-sync path, which must be run again. | small | open | men-admin-columns |
| OI-87 | WooCommerce: a 61st chart row is cut without a message (`array_slice` to `Vocab::SIZE_CHART_MAX_ROWS` in `class-sanitizer.php`), so it is never checked. | small | open | men-admin-columns |
| OI-88 | WooCommerce: the meta box shows the men's columns only on a men's product, a chart that has them, or after a men's template is picked. On a product whose audience is "infer" and empty the merchant must first pick "Made for: men". | small | open | men-admin-columns |
| OI-89 | PHP `Payload_Builder` skips a chart row without a size label, while TypeScript refuses the whole chart. Predates the men's work. | small | open | men-admin-columns |
| OI-90 | Men's fit (M2) leftovers: the unconfirmed-template rule of MT10 is not built (the payload has no confirm flag); gate condition 3 is not done; MT17 covers the TypeScript tables only; every new ease and the admin's plausible ranges are assumed until three real charts per block are read. | medium | open | men-m2 (`docs/research/men-3d-plan.md`), men-admin-columns (Assumed) |
| OI-91 | Waist-only W/L wording gap on the result screen. When the leg cannot be checked the heading says "Waist 32 fits you best" (`ResultScreen.tsx`), but the 3D note (`Garment3D.tsx`, `t.noneFits`) and the peek (`PeekApp.tsx`) still say "No size fits well" for the same result. Seen by reading the code; no report records it and it was not run. | small | fixed in claude/loose-ends (heading, fit panel, 3D label and size peek name the waist) | men-m2 (commit `c35cdc1`; code reading) |
| OI-92 | While a required 3D view loads on a men's product, the overlay shows an empty panel with no spinner. | small | not an issue any more: the pending state shows `LoadingScreen` with its spinner (`EmbedApp.tsx`, read 19 Nov) | men-m2 notes (`docs/research/men-3d-plan.md`, "Not done in M1, and still open") |
| OI-93 | Tee grading: the seat lift (up to 3 cm) stands in for grading the yoke by the body. A device grading with a neck ring would let XL and XXL sit where they were built; it needs a rule for how the tape's neck width grades. | medium | open | men-tee-v2 |
| OI-94 | Tee underarm strain at XL (p99 16.8 %, proxy 4.1 %): the assumed 2 cm armhole drop is used up by the lift. Measure a deeper armhole for large sizes, or a lift limited by the armpit. | medium | open | men-tee-v2 |
| OI-96 | Tee print: stripes do not match across the armhole or exactly at the side seams; the import of a merchant photo's two calibration numbers (px per cm, HPS centre) is not built; sleeves get no photo projection; the flattening is not conformal at the sleeve cap (29 % at p99), which matters for text prints. | large | open | men-tee-v2 |
| OI-97 | Men's trousers are not built (M3 scope). | large | open | men-m3-tee |
| OI-98 | `qa.json` `meshHealth.triangleBudget` says [8000, 15000] and the tee has 7,618 triangles; nothing checks the lower bound (`spikes/garment-engine/src/evalMesh.ts`, `pomBundle.ts`). Also, the tape check builds each size on the male table body of the same label, so a shop size that is not a table label is checked on the base body only. | small | open | men-m3-tee, men-tee-v2 |
| OI-99 | Merchant setup gaps: the console's step 4 does not see the WooCommerce plugin's "Show button" setting; bulk chart assign exists only on Shopify; step 5 ticks on any try session with `fitShownAt`, not only billed ones; the QR step does not say that a password-protected store shows the password page first; the old completeness `score` still exists in the api beside `adviceScore`. | medium | open | merchant-onboarding (3, 4, 5, 7, 8) |
| OI-100 | Carried from earlier passes, not re-verified on 19 Nov: capture's `headTopRow` includes hair and biases girths low by 1–3 % (#16); Woo Connect needs WordPress at the host root (SEC-2); no per-shop or global device-mint budget (AVAIL-1); a lost rotated token orphans the old device's rows (AUTH-1); one api serves one Shopify app, so pilot and App Store apps side by side need multi-app support; Polaris web components for Built for Shopify; about 3 s of api 502s per deploy (single replica). | large | open | STATUS (Known gaps, carried; details in `docs/STATUS-HISTORY.md`) |
| OI-103 | The underbust seam of a dress is not a fit point: the advice reads the bust alone, so a seam shorter than the underbust is not checked and the not-drawn rule cannot block on it. Needs a body number (ask or estimate), a tape field for the seam (relaxed, stretched), engine ease and tight rules with vectors, then `underbust` in `WEAR_POINTS`. Product decision first. | large | open | dress-from-tape (4), dress-not-drawn |
| OI-104 | The size-ring chips under the 3D view of a men's garment read "Bust" (`view3d.ringName` capitalises the ring key); the fit list, the 2D ring and the not-drawn sentence read "chest". | small | open | dress-not-drawn (4) |
| OI-105 | A size that is not drawn shows a plain body with only a sentence to say why; on a phone the sentence can sit under the sticky "Choose size" bar. The peek thumbnail and the app's own 2D figure also show the body alone for a blocked size, with only an accessible name. Not looked at in a browser there. `trouserNotDrawn` in `trouser.ts` is now unused by the view. | small | open | dress-not-drawn (5, 6, 7) |

## Resolved since reported

| Reported issue | Reported in | Resolved by | Check |
|---|---|---|---|
| Merchant analytics took any date range, so two overlapping ranges could be subtracted to see a group below the k floor. | launch-readiness (finding 1), STATUS (Known gaps; that entry is now stale) | analytics-kfloor, D23: closed calendar months, frozen, with complementary suppression | verified: `ANALYTICS_PERIOD_GRANULARITY` in `apps/api/src/routes/merchant.ts`, D23 in `docs/DECISIONS.md` |
| `docs/LICENSES.md` did not list Anny. | launch-readiness (finding 2), STATUS (Known gaps; stale) | analytics-kfloor | verified: Anny 0.6.2 row in `docs/LICENSES.md` (the upstream licence check stays open as OI-24) |
| The real POM v2 bake was expected to be refused by `at_rest` (AU 10 on the AU 8 body). | bake-qa-gate (1) | pom-gate: re-draped at 288 frames, passes 9 of 9 | not verified (the bake lives in the git-ignored `out/`) |
| No `connect-src 'self'` CSP for the app and embed, and no privacy e2e that runs with the real models. | face-on-head, face-2d (12) | privacy-wall | verified: `connect-src 'self'` in `infra/Caddyfile`, `apps/web/e2e/privacyModels.spec.ts` exists (running it in CI stays open as OI-69) |
| The face-2d branch depended on the face-on-head spike being merged. | face-2d (11) | merge `b9eb1d2` | verified: `apps/web/src/features/capture/sameOriginOnly.ts` exists |
| The fit-point list said "Bust" for a men's product. | men-m1b, male-2d-v2 | men-m2 | verified for the fit list and the 2D ring (`pointsMen`, `labelsMen` in `apps/web/src/embed/strings/en.ts`; `rings.ts`); the 3D chips are not verified |
| Men's chart columns missing from the PHP and Shopify-admin mirrors; `sleeveConvention` missing from the plugin mappings. | men-m2 notes | men-admin-columns | not verified beyond the report |
| The 2D figure for a men's product was the female one. | men-m2 notes (M1 "still open") | men-m1b | not verified beyond the report |
| Tee: chest girth lost in the drape (1.4–4.5 cm), shoulder-line strain at XL/XXL (26–37 %), peaks at the shoulder points, plain colour only. | men-m3-tee | men-tee-v2: girth loops, seat lift, smoothed yoke, UVs and print (costs are open as OI-93, OI-94, OI-96) | not verified (report measurements only) |
| Male shape v2 needed the 2D figure's seat and its golden to move with it. | male-shape-v2 | male-2d-v2 ("the 2D side no longer blocks it") | not verified beyond the report |
| Head v3 was "not the default yet". | head-v3 (Verdict) | D22: `neutral-v3` is the default head; lighting stays `classic` (open as OI-13) | verified: D22 in `docs/DECISIONS.md` |
| Head v3's hair shared the skin material under skin-v2. | skin-v2 (2) | fixed in the same report after its first review | not verified |
| "The simulation could not put it on" in the embed's refusal sentences where the band is the reason. | orchestrator brief for claude/loose-ends | pom-gate review (`d59e1cd`): `view3d.between` / `refused` / `adviceBlocked` name the band | verified: no such text in `apps/web` or `packages`; unit and e2e tests assert "simulation" is absent. One stale line in `packages/garment-viewer/README.md` corrected in claude/loose-ends |
| The size advice blocks AU 8 from hip 96.6 but the 3D view drew it up to the 99 cm body with a "between" note. | orchestrator brief | pom-gate review: `BakedSizeView.adviceBlocked` (`mount.ts`, `Garment3D.tsx`): a size the advice blocks is not drawn | verified in code and in `garment3d.test.tsx`; the e2e `garment3dBake.spec.ts` was not re-run here |
| The gate fixture `packages/garment-viewer/fixtures/pom-v2-rest` drapes AU 8 on hip 104. | orchestrator brief | pom-gate review: fixture rebuilt with the bake's plan | verified: `base.glb` declares AU 8 `notDraped` with `rule: 'pull-on'` on hips 99, 104, 109 and 114, draped on 94 only |
| The bake gate does not check pull-on against the tape. | orchestrator brief | pom-gate review: `refusals_declared` in `bakeGate.ts` runs the fit engine's `pullOnCheck` with the tape's stretched band on every draped body and every `pull-on` refusal | verified: code read, `bakeGate.test.ts` passes (two pull-on cases). A refusal with another reason is still only required to state one (OI-56) |
| The not-drawn rule covered sewn tops only; every other bundle drew a stretched garment on a body it does not close on (was OI-95). Also: the tape-built dress too small was drawn stretched. | men-tee-v2, dress-from-tape (3) | dress-not-drawn: one rule for every garment from the fit engine's `wearBlock` (`packages/garment-viewer/src/notDrawn.ts`, `apps/web/src/embed/notDrawn.ts`), in 3D and on the 2D figure | verified: unit tests per garment, `dressNotDrawn.spec.ts` in the built embed, the dress, tee and chino in the real stack. Not seen in a browser on the azure dress, photo skirt or the bake (OI-101) |
