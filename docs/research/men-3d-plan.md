# Men in 3D: build plan (D20 point 3), corrected after review

Target file: `docs/research/men-3d-plan.md`. This run was read-only: nothing in the repo was edited, built or run. The plan below applies both reviews; the last section lists what I did not adopt.

Every number carries a mark: **[S]** sourced (URL or repo file given), **[A]** assumed or proposed by us, **[M]** to be measured or calibrated before it becomes a constant.

Checked again in this run (git metadata and file reads only):
- The repo is a git repository on `claude/garment-engine` at ff7dbe2.
- `claude/avatar-malebody` (daaa095) and `claude/avatar-mendata` (fe0e389) are committed branches.
- In `tape-serverdrape`, `pom_rest.py`, `pom_measure.py` and `test_pom.py` are untracked, and three tracked files are modified.
- `docs/LICENSES.md` does not exist.

## Status: slice M0 built (14 Nov 2026, branch `claude/men-gate`)

The gate exists and is **off by default** (`MEN_3D_GATE`, read in `apps/api/src/env.ts`). Merging it changes no response; the founder turns it on.

- **Built:** the one helper (`apps/api/src/services/readiness.ts`) on `/v1/sdk/sessions`, `/v1/try/:token`, `/v1/try/:token/fit-shown`, `/v1/peek`, `/v1/shops/:shopId/products`, `/v1/products/:id`, `/v1/renders/hero` and `/v1/fit/cohort/:productId`; `POST /v1/swipes` (not billed, no size stored) and `GET /v1/renders/:jobId` (a render queued earlier is not served); the modal line in English (a Dutch line was written too; since D21 it is a draft in `docs/i18n/nl-drafts.md`, not shipped); no 2D fallback when the 3D view of a men's product fails or does not settle in 30 s, and the server sends such a product only to a client that asks with `caps=requires3d`; a merchant badge in the web console and on `GET /v1/merchant/products`. Details: `apps/api/README.md` "Men's gate", `apps/web/README.md`.
- **Conditions checked for a men's product to pass:** 2 (approved bundle on the male mannequin) and 4 (shop has 3D on). **Not checked yet:** 1 (supported garment types, section 2) and 3 (men's chart columns, M2a). Nothing can pass before M1 anyway: no bundle carries a mannequin family today.
- **Assumed, for M1 to confirm:** the family is read from `qa.json` as `mannequin.family: 'male'` (the api keeps only `qa.json` of a bundle). If M1 writes it elsewhere, `assetMannequinFamily` in `apps/api/src/services/assets.ts` is the one place to change.
- **Stricter than section 6 on one point:** a men's product with a live male bundle is shown in the overlay only. The size peek, the app's deck and product page, the hero render and app-mode try links draw the 2D figure only, so there it stays coming soon until the male 2D figure (photo-avatar slice 3) exists.
- **Added, not in the plan:** a `men` that was read from a title or a collection only is not gated until the merchant sets the audience (`isWeakAudienceSource`; the source is stored in `products.audience_source`, filled by the Shopify sync). After review (14 Nov 2026): only a known strong source gates. An unknown source (a row synced before the column, a merchant API write that does not say) is treated like a weak one, so a women's product whose title reads as men's is never hidden. The merchant API takes the source as `?audienceSource=` and the WooCommerce plugin sends it. Consequence for the roll-out: a men's product is gated only after its next sync, so the Shopify backfill and a WooCommerce "Sync all" on the new plugin version must run before the flag is turned on (`apps/api/README.md`).
- **Not built, founder decisions still open:** the conflict case (men's and women's words both found: still `unisex`, not gated), the no-signal case (not gated), men's shoes and accessories (switch `MEN_3D_GATE_SHOES_ACCESSORIES`, default: not gated). Also not built: the badge in the Shopify admin and the WooCommerce product list, "waiting men's products do not count against the completeness score", and M0b (the line in place of the button).

## Bottom line

- **First men's types:** the T-shirt family first, then trousers (chinos, jeans). Everything else for men shows "Men's clothing: coming soon".
- **The male body already exists on a branch.** `claude/avatar-malebody` has a five-size male mannequin family with tests. It needs merging, not building. It needs no GPU and no new licence.
- **The gate is the largest correction.** As first written it left five ways for a men's product to appear with a 2D figure. The rule must sit in one server helper used by every route, and a 3D failure on a men's product must never fall back to the 2D figure.
- **Turning the gate on removes today's size advice for men's products in every shop.** That is what D20 asks for, but the founder should know it before M0 merges. The way out is by hand and pilot-only for now: bundles are imported manually and 3D is switched on per shop.
- **The fit engine cannot size menswear today.** It lacks sleeve, rise, body length and neck points, men's eases and two-dimensional sizes (W/L).
- **Geometry from tape measurements (POM) is the first route for tees and trousers, built as a device bundle.** The only existing builder is one untracked skirt script for the server-drape route, which has no go decision. Slice M3 starts with a two-day proof and has a GPU fallback.
- **Effort to the first live men's tee and chino:** about 31 agent-days [A], against 16 to 18 in the photo-avatar plan. The critical path is about 16 days elapsed.
- **GPU spend to get there:** about USD 3.2 for one reference tee and one reference chino [S: list-price estimates in `docs/PREDICTION-ENGINE.md` and `docs/STATUS.md`, measured on women's products], budget USD 10 with re-draws [A].

D20 voids one line of photo-avatar plan slice 3: "men's products get the male 2D figure ... but no 3D drape yet". The male 2D figure can no longer take a product live. It is still needed beside the 3D view (section 6).

## 1. What differs between men and women that matters to us

Body figures are means from ANSUR II (4,082 men, 1,986 women), computed from the public CSVs at https://www.openlab.psu.edu/ansur2/ and reproduced by the reviewer within 0.1 cm. It is a US military sample with mean age 30 and mean male BMI of about 27.7, so it is not a lean sample. Its only waist girth is at the navel.

| Difference | Men | Women | What it changes for us | Source |
|---|---|---|---|---|
| Silhouette | chest 105.9, seat 102.0 cm | bust 94.7, seat 102.1 cm | Scaling the female mannequin cannot give a male body | [S] ANSUR II |
| Neck girth | 39.8 cm | 33.0 cm (+21 %) | Neck is a fit point for shirts | [S] ANSUR II |
| Shoulders (biacromial) | 41.6 cm | 36.5 cm (+14 %) | Shoulder width decides tees and jackets | [S] ANSUR II |
| Stature | 175.6 cm | 162.8 cm | The avatar must scale in height; today it is fixed | [S] ANSUR II |
| Arm and back length | sleeve 89.6, back 47.8 cm | 80.7, 42.5 cm (+11 to 12 %, stature only +8 %) | Male arm and torso proportions | [S] ANSUR II |
| Leg share of stature | 48.2 % | 48.0 % | Ring heights can stay as fractions of stature | [S] ANSUR II |
| Rise (crotch length) | 62.2 cm, 35.4 % of stature | 62.1 cm, 38.1 % | Men's rise must not be copied from the female body | [S] ANSUR II |
| Chest to natural-waist drop | 12 cm | 16 cm | Men's size ladder: waist = chest − 12 | [S] https://en.wikipedia.org/wiki/EN_13402 (reproduces the 2004 edition) |
| What the size is keyed on | chest (tees, knits, jackets), waist + inside leg (trousers), neck + arm (shirts) | bust for tops and dresses | Sizes are often two-dimensional: W32/L34, 15½/34, 40R | [S] EN 13402 via Wikipedia; https://de.wikipedia.org/wiki/Konfektionsgröße |
| Label versus measurement | size-32 jeans reported at 33.5 to 35 in at the band | n/a | A label is never turned into centimetres by the engine | search summary only; https://fashionmagazine.com/style/vanity-sizing/ returned 403 for the reviewer |
| Where trousers sit | below the natural waist | at or near it | The waistband meets a different body girth, the "worn waist" | [A] trade knowledge |
| Ease | dress shirt chest ease 21.5 to 26 cm | engine `shirt` block uses 10 cm | Women's ease tables band a correct men's shirt as "loose" | [S] https://www.paulfredrick.com/pages/dress-shirt-fit-guide (one retailer; that the figures are girths is inferred) |
| Construction | no bust shaping; collar stand, placket, fly, built shoulder | darts, princess seams | Tees and trousers are near-tubes; collars and tailoring need new templates | [A] trade knowledge |
| Returns | 23 % "too small"; trousers and jeans most returned (15 %) | 13 % "too small" | Trousers matter commercially | search summaries only (Tessuti via fashionnetwork.com, Spoke via theindustry.fashion); not opened |

Two corrections to the research:
- **The EN waist is the natural waist** (between the hip bones and the lower ribs), for men as for women. The ANSUR navel waist is a different girth. The statement that ANSUR "reproduces the EN drop" compared two different measures and is withdrawn.
- **The neck gap between EN and ANSUR is a definition difference.** EN measures low and slanted (2 cm below the Adam's apple, at the seventh cervical vertebra). ANSUR has a higher, smaller girth (39.8) and a base girth (43.5); the EN value sits between them. The ANSUR landmark is from the reviewer's memory, not re-read.

## 2. Decision: what we support first

| Men's type | Status | Why |
|---|---|---|
| T-shirt (short sleeve) | **First** | Reuses the `top` template; sized by chest; needs only slice M2a of the fit work |
| Chinos, jeans, plain trousers | **First, after the tee** | Reuses `bottom` with `legs`; needs M2b (lengths, W/L, rise) |
| Long-sleeve tee, sweatshirt, crew knit, shorts | **Second** (slice M6) | Same templates; need the sleeve and length points |
| Polo | Coming soon | A polo drawn without a collar looks wrong |
| Shirt with collar and placket | Coming soon (slice M7) | Needs collar geometry and the neck and sleeve points live |
| Hoodie | Coming soon | The hood is not modelled |
| Overshirt, cardigan, open jacket | Coming soon, cheap later | Reuses `outerwear` with `frontOpening`; untested on a male body |
| Blazer, suit, coat | Coming soon, not scheduled | Structured shoulder does not drape like cloth; needs S/R/L and drop logic |
| Men's shoes and accessories | Open question | They have no 3D for anyone. D20 says "men's garment"; the founder should confirm these keep today's behaviour |

## 3. The male body

### Size run: the branch table is the single source

`claude/avatar-malebody`, file `packages/mannequin/src/families.ts`, already ships S, M, L, XL and XXL. The plan adopts that table; the earlier table in this plan is dropped.

| Size | Chest | Natural waist | Neck (EN definition) | Seat | Stature | Biacromial | Bideltoid | Inside leg | Thigh | Biceps flexed | Wrist | Calf |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S | 90 | 78 | 37.5 | 90.5 | 172.5 | 40 | 46 | 83.5 | 54 | 31 | 16.5 | 35.5 |
| **M (base)** | 98 | 86 | 39.5 | 96 | 174 | 40.5 | 48.5 | 84 | 58.5 | 33.5 | 17 | 37.5 |
| L | 106 | 94 | 41.5 | 102 | 175.5 | 41.5 | 51 | 84.5 | 62.5 | 36 | 17.5 | 39.5 |
| XL | 114 | 102 | 43.5 | 108 | 177 | 42.5 | 53.5 | 85 | 67 | 38.5 | 18 | 41 |
| XXL | 123 | 111 | 45.75 | 114.5 | 179 | 43.5 | 56.5 | 85.5 | 71.5 | 41 | 18.5 | 43.5 |

- **Chest, waist, neck** [S, with a caveat]: midpoints of the two EN steps each letter combines, drop −12, from the Wikipedia reproduction of the 2004 edition.
  - The tables are two editions old (a 2013 and a 2017 edition followed) and may sit in an informative annex. That comes from a search summary of the standards-shop page.
  - The product must not call this ladder "EN" until the standard is bought and read.
- **Seat** [M]: ANSUR line at that chest (about chest − 2).
  - A German trade table puts seat near chest + 4 (size 50: chest 98–101, seat 102–105), but its footnote is a retailer and the column alignment was uncertain.
  - Calibrate on merchant body charts before the chino vectors are fixed.
- **Stature, inside leg, limb girths, breadths** [S data, A method]: ANSUR regression on chest girth.
- **Base size** [A]: M at 98/86. The mean ANSUR man is EN size L (chest 105.9). M is a product choice, not a population mean.
- **Stature is the open founder decision.**
  - The branch uses 172.5 to 179 cm from US data.
  - Dutch men average about 181 cm, with younger cohorts near 183 (search summary of CBS, not opened).
  - A taller base shifts lengths by about 3 % and leaves the girth ladder alone.
  - The shopper's own height drives the avatar either way.
- **Waist level:** natural waist at 0.621 of stature, as on the branch. The trouser band height is a separate value (section 4).
- **Male crotch level:** already inside leg ÷ stature, about 0.48, on the branch. The 0.455 gap remains on the female family only.

### Mannequin (`packages/mannequin`)

- Merge `claude/avatar-malebody`. Female numbers and the female glb hash must stay byte-identical.
- The `underbust` ring stays as geometry (D15) and is never scored for men.

### Anny (`spikes/garment-engine/serverdrape/anny_bodies.py`)

- `gender = 0.0` is male and `1.0` is female in Anny 0.6.2 [S: `anny/models/model_data.py:43`]. The spike hard-codes `1.0` at lines 95 and 218. Document the direction on `annyGenderProb` in `packages/schema/src/fitSignature.ts`.
- Chest, waist, seat and neck steer almost independently on the male base, about ±10 to ±14 cm each [S: one single-thread probe, not a solve, not re-run by either reviewer].
- Extend the solve to height, chest, waist, seat, neck and shoulder distance, with our own slicing.
  - The neck slice must follow the EN definition (low, slanted).
  - The probe's "smallest girth between 83 and 88 %" reads low against it.
- **XXL is unproven.** The best in-range probe reached waist 103.4 against 111 [S, probe]. S to L look reachable, XL probable, XXL unknown [M].
- **Licence:**
  - Code Apache-2.0; `data/mpfb2` and face units CC0; `soma` topology Apache-2.0 [S: bundled licence file, https://github.com/naver/anny].
  - The only non-commercial download path is `paths.py:70-103`, triggered by the `smplx` and `smpl` topologies. Never select those.
  - Pin the version and run the export offline.
  - Do not load `shape_calibration/boys.pth` or `girls.pth`: their licence is not stated and they are not needed.
- **Face and hair:**
  - CC0 packs only (Skins 02, Hair 01, Eyebrows 01, Eyelashes 01, Bodyparts 05) [S: https://static.makehumancommunity.org/assets/assetpacks/index.html, index headings only].
  - Whether MakeHuman hair meshes fit Anny's edited topology is untested [M]. Anny bundles no full skin.

### The shopper's avatar on the device (`packages/garment-viewer/src/body.ts`)

- Today it morphs chest, waist and hip on a fixed-stature female M. For men it needs the male base, stature scaling, and optional neck and shoulder knots.
- Measurement limits per family [A, from the size run ±2 sizes].
- The spike viewer (`spikes/garment-engine/viewer/src`) mirrors the package viewer and is held equal by `test/parity.test.ts`. Every family change lands in both.

## 4. Fit engine: spec change

Applies to `docs/research/fit-engine-spec.md`, `packages/fit-engine` and `packages/schema`. The engine stays pure and dependency-free (rule 5).

### Rule that keeps T1 to T17 green

New behaviour switches on only for the male body family, or when a chart carries one of the new columns. A payload without `audience` and without new columns produces byte-identical output to today.

- `audience: 'men'` always uses men's eases, points and labels.
- `audience: 'unisex'` uses the tables of the body the shopper chose: male body, men's tables. Notes print "chest" for unisex.
- `audience: 'women'` or absent: today's behaviour.

### New fit points, kept apart from body keys

`BODY_MEASUREMENT_KEYS` and `USER_BODY_MEASUREMENT_KEYS` are built from `FIT_POINTS` (`packages/schema/src/body.ts:19,67,130`). Appending `length` and `rise` there would turn garment properties into stored shopper body keys. So:

- `FIT_POINTS` gains only body-side points: `neck` and `sleeve` (the body side is arm length). The order of the existing seven does not change.
- A new, separate list `GARMENT_LENGTH_POINTS` holds `length` (body length) and `rise`. It never enters the stored profile.

| Point | Kind | Body side | Anchor (D15) | Band | Used first by |
|---|---|---|---|---|---|
| `sleeve` | length | EN arm length | length `sleeve` | two-sided: short / long | long-sleeve tee, sweatshirt |
| `length` | garment length | stature and back length | `shoulder_to_hem` | two-sided | tee, knit |
| `rise` | garment length | none; shifts the worn waist | length `rise` | no band of its own | trousers |
| `neck` | girth, narrow | EN neck girth | ring `neck` | ±1 cm [A] | shirts (specified now, live in M7) |

- **One arm-length definition.**
  - The body value is the EN arm length: acromion over the elbow to the wrist, arm bent 90°. It is 64 cm at 172 and 65 at 176 [S, Wikipedia].
  - The avatar's straight arm maps to it by a fixed offset [M].
  - ANSUR "sleeve outseam" (59.4) is not used as the body arm length.
- **Inseam.**
  - The body value is the inside leg, crotch to sole (84 at M).
  - A garment inseam is compared with inside leg − 3 cm [A, the hem sits above the floor; calibrate].
- **Shoulder.**
  - The body value is biacromial breadth (40.5 at M), as on the branch.
  - A garment's seam-to-seam shoulder is compared with biacromial + an offset of about 3.5 cm [A, M]. This replaces the earlier "44 cm" body value.
- **Lengths are not girths.** Fabric stretch never rescues a short sleeve or inseam. Length bands: within ±2 cm fits, beyond ±4 cm fails [A].
- **Sleeve convention is declared per chart:** `shoulder_point` or `centre_back`. A chart without it gets no sleeve score.
- **Two-dimensional sizes.** A size row may carry a second axis (`leg`, later `fitLength` for S/R/L). The engine picks each axis on its own and returns "W34/L32". `SizeChartSchema.max(30)` and `size.max(16)` (`garment.ts:207,164`) must rise.
- **Worn waist.** For men's bottoms the waistband is compared with the body girth at the worn height, interpolated between natural waist and seat by the rise [A, M].
- **W labels.** The engine never derives centimetres from a label.
  - The `avatar-mendata` W/L template does carry centimetres per W (W32 = 81, from two German retailer tables, `chartTemplatesMen.ts:284-312`).
  - That template is kept only as a pre-filled chart the merchant must confirm.
  - A template the merchant has not confirmed gives no waist score and keeps the product in "coming soon".
- **Men's tees score the waist.** Competitors ask men about belly and chest shape (search summary only).
- **Grading increments are two tables.**
  - Numeric steps: 4 cm chest, 4 cm waist, 1 cm neck.
  - Letter steps: 8 / 8 / 2, and 9 / 9 / 2.25 into XXL.
  - Source: Wikipedia, "each range combines two adjacent size steps".

### Men's eases (cm, garment minus body)

| Block | chest | waist | seat | thigh | shoulder | neck | Status |
|---|---|---|---|---|---|---|---|
| tee, regular | 8 | 8 | – | – | 1 | – | [A] |
| knit, sweatshirt | 10 | 10 | – | – | 1.5 | – | [A] |
| chinos, slim / regular | – | 2 | 4 / 6 | 4 / 6 | – | – | [A] |
| jeans, slim / regular | – | 2 | 3 / 5 | 3 / 5 | – | – | [A] |
| shirt, slim / tailored / classic | 14 / 21.5 / 26 | 10 / 16 / 22 | – | – | 1 | 1.5 | chest tailored and classic [S, Paul Fredrick, one retailer]; all else [A] |
| blazer, slim / regular | 6 / 11 | 6 / 10 | – | – | 1 | – | [A]; retailer blogs via search summary give chest 5–7.5 and 10–13 |

No published ease table for men's tees, knits or trousers was found. Every [A] value is calibrated on at least three real merchant charts per block before it ships [M]. These eases land together with the proxy defaults (`spikes/garment-engine/src/predict/rules.ts`), because D15 pins the proxy girth to the fit-engine target.

### New test vectors

Men's reference body **MREF** is the branch's M row: chest 98, natural waist 86, seat 96 [M], thigh 58.5, neck 39.5, biacromial 40.5, stature 174, inside leg 84, EN arm length 64.5 [A, interpolated between 64 and 65]. Expected scores are computed once the eases are fixed.

| # | Slice | Vector | Expected |
|---|---|---|---|
| MT1 | M2a | Men's tee, body chart S to XXL × MREF | `M`, score 1 |
| MT2 | M2a | Same tee as a garment chart, men's tee ease | `M` |
| MT3 | M2a | MT1 payload with `audience` removed | Identical to today's engine output (regression pin) |
| MT4 | M2a | Tee one size up × MREF, `audience: 'men'` | Note reads "Roomy at the chest", never "bust" |
| MT5 | M2a | Belly body (chest 100, waist 104) × tee | Waist is tight in M; recommends the larger size |
| MT5b | M2a | `audience: 'unisex'` with the male body, then the female body | Men's tables and "chest" for the male body; today's output for the female body |
| MT6 | M2b | Chinos, garment chart with waistband cm × MREF | The size whose band matches the worn waist plus ease; thigh is scored |
| MT7 | M2b | Slim chinos, waist fits, thigh 4 cm under | Thigh "tight"; not skipped as in today's `straight` block |
| MT8 | M2b | W32 to W36 × L30/L32/L34 with cm columns | Waist and leg picked independently, one combined label |
| MT9 | M2b | Same grid, garment inseams 76 / 81 / 86 × inside leg 84 | L32 fits (target 81); L30 "short at the leg"; L34 "long at the leg" |
| MT10 | M2b | W/L labels with no cm column, or an unconfirmed template | No waist score, a "needs measurements" note |
| MT11 | M2b | Long-sleeve tee, `stretchPct` 20, sleeve 3 cm short | Still "short" |
| MT12 | M2b | Sleeve column without a declared convention | Sleeve omitted with a note |
| MT13 | M2b | Low-rise jeans × MREF | Waistband compared with the worn-height girth |
| MT14a | M2b | Collar, **garment** chart 39/40/41 × neck 39.5 (spec only) | `41` with ease 1.5; 39 is "tight" |
| MT14b | M2b | Collar, **body** chart (EN label = body neck) 39/40/41 × neck 39.5 | `40` |
| MT15 | M2b | MREF without arm length (as T10) | Sleeve omitted, note, lower confidence |
| MT16 | M2b | Purity, 1,000 random men's bodies and two-axis charts | Never throws; score in [0,1] or null |
| MT17 | M2a | Constants parity, including the PHP and Shopify mirrors | All tables agree |

### Files

- `packages/schema/src/garment.ts`: `FIT_POINTS`, `GARMENT_LENGTH_POINTS`, `SizeRowSchema` columns and second axis, the two caps, `PATTERN_BLOCKS`, `criticalFitPoints` cap.
- `packages/schema/src/body.ts`, `fitSignature.ts`: store and project neck, arm length, height.
- `packages/schema/src/chartTemplates.ts`, `chartTemplatesMen.ts`, `mappings/common.ts`, `completeness.ts`.
- `packages/fit-engine/src/constants.ts`, `computeFit.ts`, `bands.ts`, `types.ts`.
- `packages/anchors/src/mappings.ts`: `neck → neck`, `sleeve → sleeve`, `rise → rise`.
- Mirrors the first plan missed:
  - `packages/woocommerce-plugin/includes/class-vocab.php:22` (sanitizer, payload builder, product meta);
  - `packages/woocommerce-plugin/assets/chart-templates.json`;
  - `packages/shopify-app/admin/index.html`.
- Already on `claude/avatar-mendata`: `audience`, `inferAudience` with a merchant override, the Shopify and WooCommerce mappings, men's letter, 44–58 and W/L templates, a W×L grid accepted by `checkChart`, fixtures and the chest label. Merge it; do not redo it.
- The EU 44–58 template rests on one de.wikipedia formula with a retailer footnote: [M].

## 5. Garment engine, stage by stage

### Is the POM route supported by evidence?

| For | Against |
|---|---|
| The reconstructed skirt was compared with the tape: hip at 87 to 92 % of the tape, hem sweep at 47 to 50 % (`tape-viewer` branch, `spikes/garment-engine/README.md:185-193`). The GPU mesh is not ground truth; the tape is | The only builder, `pom_rest.py`, is 164 untracked lines for one A-line surface of revolution. Several inputs are marked ASSUMED and the hip height 87.36 is hard-coded |
| Tees and trousers are near-tubes; men's charts often print garment measurements | Nothing in it transfers to sleeves, an armhole or a crotch |
| Geometry from garment numbers is body-family neutral; only placement reads the mannequin | It writes `rest-<size>.bin` for the Blender server drape, not the device bundle. Server drape's own verdict is "at the threshold on the hip, not a clean go", with fps not measured |
| CPU only | It makes no texture; the skirt borrowed one and it is visibly stretched |

**Decision:**
- Build a new TypeScript POM builder in `spikes/garment-engine/src/` that emits the five device-bundle files (`base.glb`, `grading.json`, `anchors.json`, `material.json`, `qa.json`). `checkGarmentBundle` and the import then work unchanged.
- `pom_rest.py` is a reference for the arithmetic only. The server-drape route is not on the path to the first men's product.
- `qa.json` reports chart agreement as measured by `src/tape.ts` against the input measurements, since no stage 4t run sits behind a POM asset.
- Start with a two-day proof on one tee. If it fails, use the full GPU pipeline on the male mannequin, which needs no new template for these two types.
- Run one GPU pass per type anyway. It buys the texture fallback, the first men's stage 1b QA thresholds, and a check that the try-on model dresses a male grey mannequin. It is not the truth to compare against.

**Texture on the POM route** [M]: project the merchant's front and back photos (required by D13) onto the front and back panels on CPU. Fallback: stage 1b stills plus a two-view bake at about USD 0.05 to 0.10 per product [S, `docs/PREDICTION-ENGINE.md`]. D18 says nothing skips a GPU run before gate G1; whether a measured POM asset counts as "predicted" is a decision for the lead.

### Changes per stage

| Stage | Change for men | Runs on | Cost per product |
|---|---|---|---|
| Canonical body | One helper `mannequinFor(payload)` for about 9 production call sites (`src/bundle.ts:68`, `src/exportJob.ts:533`, `src/stage4t.ts:425`, `src/eval.ts:268`, `src/evalJob.ts:457`, `src/drapeLogJob.ts:76`, others) and about 20 in tests. `stage4t.ts`, `eval.ts` and `drapeLogJob.ts` already accept `o.mannequin` | CPU | none |
| Manifest and bundle | `mannequin.family` added (absent = female). It enters `input_hash`, so female job ids stay the same | CPU | none |
| POM builder (new) | Tee: front and back panels plus two sleeve tubes. Trousers: seat tube plus two legs from waistband, seat, thigh, knee, leg opening, rises and inseam | CPU | none |
| Grading | Per-family tables, letter and numeric steps kept apart | CPU | none |
| Stage 1b stills | No code change. Thresholds were tuned on womenswear and are provisional [M] | GPU | USD 0.02 to 0.07 [S] |
| Stage 2 turntable | Men's nouns in `src/product.ts`; "chest" in place of "underbust" | GPU, H100 | USD 1.47 to 1.52 measured [S] |
| Stage 4t carving | Pass the male mannequin. Trouser join height and crotch crease were tuned on one palazzo [M] | CPU | none |
| Predictor | Per-audience ease and band tables; new tokens | CPU | none |
| Server drape (not on the first path) | `MANNEQUIN_HIP_Y = 87.36` read from the bundle (`drape_blender.py:47`, `relgirth.ts:16`); rigid waistband; a shoulder-hung model does not exist | CPU | about 95 CPU-seconds per drape [S, spike doc] |
| Viewer, both copies | Reads the family from the bundle, builds that mannequin, refuses a mismatch with `GarmentViewError('incompatible')` | device | none |
| Full GPU run | Reference runs only | GPU | about USD 1.57 to 1.63 [S, women's products] |

## 6. The "Men's clothing: coming soon" gate

### One rule, in one place

A server helper beside `asTryGarment` (`apps/api/src/services/products.ts:98`) decides the state of a product. Every route that serves product or fit data calls it:

- `/v1/try/:token` (`routes/try.ts:62`)
- `/v1/peek` (`try.ts:108`), which today shows a 2D figure and a size in `PeekApp.tsx:66`
- `/v1/shops/:shopId/products` and `/v1/products/:id` (`routes/app.ts:199,209`)
- `/v1/renders/hero` (`routes/renders.ts:29`)
- `/v1/fit/cohort/:productId` (`app.ts:346`)
- `/v1/sdk/sessions` (`routes/sdk.ts:40`), which returns the state so the SDK can act on it later

A men's product gets the flow only when all four hold. Otherwise the helper returns `coming_soon` and no fit data.

1. Its garment type is on the supported list (section 2).
2. An asset is approved by the merchant (D13) and its bundle says `mannequin.family: 'male'`.
3. The size chart has the required men's columns for that type, in centimetres and confirmed (section 8).
4. The shop has 3D switched on (`settings.garment3d`, checked in `services/assets.ts:168`).

### No 2D fallback for men

- Today `apps/web/src/embed/Garment3D.tsx:10` closes on any error and leaves the 2D figure, and `ResultScreen.tsx:212` always draws the 2D `AvatarView`.
- For a product shown on the male body, any 3D failure (no WebGL, bundle fetch error, `incompatible`) must end in the coming-soon or error state: no 2D figure and no size.
- The male 2D figure is still required. The embed and peek draw `AvatarView` above the 3D view, and a female 2D figure above a male 3D body is wrong. This is the "male reference body and path for the 2D figure" from photo-avatar slice 3, in `apps/web/src/render/` and `AvatarView.tsx`. It never appears without working 3D.

### Audience detection

`packages/schema/src/mappings/audience.ts` on `claude/avatar-mendata` reads product type, category, tags, title words and collections, with a merchant override.

| Case | Today on the branch | Proposed | Needs |
|---|---|---|---|
| Men's and women's words both found, no "unisex" word | `unisex` (`audience.ts:108`) | Gated as `men` until the merchant confirms the audience | Founder decision |
| Explicit unisex | `unisex` | Female body: today's flow. Male body: the four conditions apply, else coming soon for that body | Founder to confirm |
| No signal | `undefined` | Today's behaviour, and the merchant list shows "audience not set". No 3D asset can be approved until the audience is confirmed | Founder decision; this is the remaining leak |

### What people see

- **Shopper:** "Men's clothing: coming soon". No size advice, no figure, no measurement prompt.
  - The "Try it on" button is drawn on the shop page by `packages/sdk` (`i18n.ts:30`) and its built copy in `packages/shopify-app/extensions/try-button/assets/sdk.v1.js`. `EmbedApp.tsx` runs only after the click.
  - M0 shows the line inside the modal, which is where the flow would start.
  - Replacing the button itself needs the SDK, the extension asset and the WooCommerce frontend changed: slice M0b, a founder choice.
- **Merchant:** per product, a badge "Men's: coming soon" with the reason and the next step. Waiting men's products do not count against the completeness score.

### How a product leaves the gate

- Per the D16 amendment, bundles are imported by hand (`pnpm --filter @curtain/api asset:import`) and `settings.garment3d` is off by default.
- So for now: the merchant supplies measurements → we build and import the bundle by hand → QA passes → the merchant approves → the flow appears. Men's 3D is pilot-only.
- A merchant-triggered build job does not exist and the pipeline lives under `spikes/`. It is a later slice (M9), not in this estimate.
- **Effect of M0 alone:** every men's product in every shop loses its existing size advice until its shop is in the pilot and its bundle is built. D20 asks for exactly this. The founder should confirm the timing.

## 7. Slices

Each slice merges alone with all existing tests green. Days are agent-days, estimated from reading code [A].

| # | Slice | Days | Acceptance |
|---|---|---|---|
| M0 | The gate: merge `avatar-mendata`; the server helper on all six routes; no-2D-fallback rule; conflict handling; modal line; merchant badge | 5.5 | A men's fixture returns `coming_soon` on every listed route. With 3D forced to fail, a men's product shows no 2D figure and no size. A women's product is unchanged. Fit vectors untouched |
| M0b | Button replaced on the shop page (SDK, Shopify extension asset, WooCommerce frontend) | 2, optional | The shop page shows the line without a click |
| M1 | Merge `avatar-malebody`; `mannequin.family` in the bundle; family check in `garmentBundleFor`, the api import and `mount.ts`; `mannequinFor`; both viewer copies | 3 | Female glb hash and job ids unchanged. A female-built bundle is refused for a men's product in three places. Viewer parity test green |
| M1b | Male 2D figure in `apps/web/src/render/` and `AvatarView.tsx` | 2 | The 2D figure beside a male 3D body is male. It cannot render when 3D is unavailable |
| M2a | Fit engine for tees: audience and unisex switching, men's tee and knit eases, chest label, waist scored, mirrors | 3 | T1 to T17 unchanged; MT1 to MT5b and MT17 green |
| M2b | Fit engine for trousers and lengths: length bands, second axis, worn waist, inseam and arm definitions, caps raised, neck specified | 5 | MT6 to MT16 green; `seat`, `neck`, `sleeve`, `rise` no longer dropped by the mappings; `length` and `rise` absent from stored body keys |
| M3 | TypeScript POM builder to the device bundle, tee then trousers, with photo projection. Starts with a 2-day tee proof | 8.5 | `src/tape.ts` measures the built mesh within 0.5 cm [A] of every input measurement in every size. `checkGarmentBundle` passes. Trouser crotch is closed. Stop rule: tee proof fails after 2 days → GPU pipeline |
| M4 | First men's bundles and the male avatar in the viewer: one tee, one chino, one GPU reference run each | 4 | Both drape on the male body in S, M and XL. Frame rate on a named phone is measured and reported; no baseline exists today. The size shown agrees with the fit engine at every scored point. POM mesh and GPU mesh are each compared with the tape, per ring. The gate opens for these two after approval |
| M5 | Anny male bodies: gender argument, six-unknown solve, EN neck slice, offline pinned export | 4 | S to XL solve within 1 cm [A] of target on chest, waist, seat, neck. XXL reported as reached or not. Offline run fetches nothing; no `smplx` or `smpl` file present |
| M6 | Shorts, long-sleeve tee, sweatshirt, crew knit | 3 | One bundle per type passes QA; sleeve and length vectors green on real charts |
| M7 | Shirt and polo: collar, stand, placket, cuff geometry; neck point live | 8 to 10 | A collar sits on the neck ring in every size; MT14a and MT14b run against a live block |
| M8 | Tailored jacket | not scheduled | – |
| M9 | Merchant-triggered bundle build | not scheduled | – |

- **To the first live tee and chino:** M0, M1, M1b, M2a, M2b, M3 and M4 come to 31 days [A].
- **Critical path:** M1 → M3 → M4, about 15.5 days elapsed.
- **Tee alone:** M2b can be skipped, which saves 5 days of work but nothing on the critical path.
- M5 is not on the path to the first product.

### Parallel tracks and ownership

| Track | Owns | Slices |
|---|---|---|
| E, men's data | `packages/schema/` | M0 (merge, conflict rule), M2a, M2b |
| H, gate | `apps/api/src/routes/`, `apps/api/src/services/`, `apps/web/src/embed/` | M0 |
| H2, shop page and mirrors | `packages/sdk/`, `packages/shopify-app/`, `packages/woocommerce-plugin/` | M0b, mirrors in M2a |
| D, male body | `packages/mannequin/`, `packages/anchors/` | M1 |
| A, viewer and figure | `packages/garment-viewer/`, `apps/web/src/render/`, `AvatarView.tsx` | M1, M1b, M4 |
| F1, fit engine | `packages/fit-engine/`, `docs/research/fit-engine-spec.md` | M2a, M2b |
| F2, garment pipeline | `spikes/garment-engine/src/`, `viewer/`, `modal/` | M1 (`mannequinFor`, spike viewer), M3, M4, M6, M7 |
| F3, Anny | `spikes/garment-engine/serverdrape/` | M5 |
| G, docs | `docs/` | this plan, a new `docs/LICENSES.md`, spec text |

- **Contracts fixed before work starts:**
  - the `audience` field and the new `SizeRow` columns (E);
  - `mannequin.family` in the bundle (D with A);
  - `MountOptions.body` with `family`, `heightCm` and shoulder (A);
  - the gate helper's return shape (H).
- **From day one:** M0 (E, H), M1 (D, A, F2), M1b (A) and M5 (F3). M2a starts when the schema merge lands. M3 needs M1. M4 needs M2a (tee) or M2b (chino), and M3.
- **Merge first, do not redo:** `claude/avatar-mendata` and `claude/avatar-malebody`. The `tape-serverdrape` scripts are untracked reference material.

## 8. What merchants must supply for men's products

Required for every men's product: `audience` confirmed, front and back photos (D13), base size, fabric, and a size chart declared as garment or body measurements.

| Type | Required per size (garment, cm) | Recommended |
|---|---|---|
| Tee, sweatshirt, knit | chest width (pit to pit), shoulder width (seam to seam), body length from the high shoulder point | sleeve length with its convention, hem width, neck opening |
| Long-sleeve variants | the above plus sleeve length and its convention | cuff width |
| Chinos, jeans, trousers | waistband in cm (laid flat ×2), seat, thigh, inseam, front rise | back rise, knee, leg opening |
| Shorts (M6) | waistband, seat, thigh, inseam, leg opening | front rise |

- For W/L products: the cm values per W and the inseam per L, entered or confirmed by the merchant. Labels alone keep the product in "coming soon".
- If the shop measures only the sample size, the others are graded with the men's increments and labelled an estimate. Trousers need at least two measured sizes [A].
- A body chart is accepted for size advice, but the POM route needs garment measurements for the geometry.
- A tape is accurate to about 0.5 cm [S, `docs/research/shortcut-to-step3.md`].

## 9. Risks, and what we will not build

### Risks

| Risk | Effect | Handling |
|---|---|---|
| A route or fallback outside the gate | A men's product with a 2D figure, which D20 forbids | One helper, six routes, a forced-failure test in M0 |
| Audience unknown or conflicting | A men's product on the female figure | Conflict gated as men; audience confirmation required before asset approval; founder decision on the unknown case |
| M0 removes men's size advice everywhere, exit is manual | Merchants with men's products lose a feature | Founder confirms timing; merchant badge explains; M9 later |
| POM builder is new for tops and trousers | M3 slips | 2-day proof with a stop rule; GPU fallback at about USD 1.6 per product |
| No phone frame-rate baseline | M4 acceptance cannot be pass/fail today | Measure and report in M4; set the budget after |
| Men's eases are proposals | Wrong size advice | Three real charts per block before M4 |
| Seat values may be 5 to 7 cm low against trade tables | Chino advice biased | Marked [M]; calibrate on merchant body charts before M2b fixes its vectors |
| Stature from US data, Dutch men about 6 cm taller | Lengths about 3 % short on the base body | Founder decision; shopper height drives the avatar |
| XXL not reachable in Anny | No XXL Anny body | The lofted mannequin has no such limit; report in M5 |
| Size ladder rests on Wikipedia's 2004 reproduction | Dated, possibly only informative | Buy the 2017 standard (price not confirmed); not called "EN" in the product until then |
| ANSUR licence not stated on the download page | Legal uncertainty, low | We ship derived statistics, not the file. The branch README quotes NATICK/TR-15/007 "Approved for public release; distribution is unlimited", not seen at source. A US Government work is public domain in the US only. Record exactly this in `docs/LICENSES.md` |
| Trouser crotch logic tuned on one palazzo | Artefacts on tapered legs | Checked in M4 |
| MakeHuman hair on Anny topology untested | No male hair on Anny bodies | Marked [M]; the lofted mannequin is unaffected |

### What we will not build

- A men's product with a 2D figure only, or size advice without the 3D body (D20).
- Scaling the female mannequin to stand in for a male body.
- Anything on SMPL, SMPL-X, STAR, FLAME or CC BY-NC data; the Anny `smplx` and `smpl` topologies; NvidiaWarp-GarmentCode.
- Tailored jackets, suits with drop logic, S/R/L and hoods, in this plan.
- Centimetres derived from W, collar-inch or letter labels by the engine.
- A server-side fit path, or any men's measurement sent to a merchant (rules 4 and 1).
- CC BY hair and beard packs; CC0 only.
- Big-and-tall and short/stocky size families in the first run.
- The server-drape route as a dependency of the first men's product.

## Not verified

- Current EN 13402-3 (2017), ISO 8559 and both ASTM tables: paywalled, not read.
- Any menswear ease table from a pattern-cutting text.
- The Anny probe numbers (not re-run by either reviewer); a full solve for any men's size.
- Test status of the three branches; whether `pom_rest.py` passes `test_pom.py`. Nothing was run.
- The ANSUR public-release statement at source; the ANSUR neck and sleeve-outseam landmark definitions (reviewer's memory).
- Dutch male stature (CBS, search summary only).
- GPU costs and stage 1b behaviour for men's products.
- Search-summary-only facts: jacket ease, sleeve conventions, suit drop, the vanity-sizing, Tessuti, Spoke, YouGov and SmartSize figures, the edition history of EN 13402-3.
- FreeSewing and GarmentCode per-design and dataset licences.

## Sources

- ANSUR II: https://www.openlab.psu.edu/ansur2/ ; https://www.army.mil/article/188601/for_good_measure_natick_releases_raw_data_from_army_wide_anthropometric_survey (says "available to the public", no licence)
- EN 13402: https://en.wikipedia.org/wiki/EN_13402 ; https://evs.ee/en/evs-en-13402-3-2017 (search summary) ; German sizes: https://de.wikipedia.org/wiki/Konfektionsgröße
- Dutch stature: https://www.cbs.nl/nl-nl/nieuws/2021/37/nederlanders-korter-maar-nog-steeds-lang (search summary)
- Ease: https://www.paulfredrick.com/pages/dress-shirt-fit-guide ; https://theblacktux.com/blogs/resources/essential-suit-measurements-how-to-get-the-perfect-fit ; https://en.wikipedia.org/wiki/Ease_(sewing)
- Vanity sizing and returns (not opened by the reviewer, 403): https://fashionmagazine.com/style/vanity-sizing/ ; https://www.marketplace.org/2010/09/09/your-waist-doesnt-lie-your-pants-do/ ; https://eg.fashionnetwork.com/news/Online-fashion-returns-soar-as-shoppers-lack-size-info,957327.html ; https://www.theindustry.fashion/?p=220166 ; https://yougov.com/en-us/articles/53346-free-fast-and-convenient-how-us-shoppers-want-retail-returns
- Anny: https://github.com/naver/anny ; https://arxiv.org/abs/2511.03589 ; MakeHuman packs: https://static.makehumancommunity.org/assets/assetpacks/index.html
- FreeSewing (MIT, possible seed for M7): https://github.com/freesewing/freesewing

## Repo files this plan rests on

- `/home/user/dfittrd/AGENTS.md`
- `/home/user/dfittrd/docs/DECISIONS.md` (D12, D15, D18, D19, D20; D20 text re-read in this run)
- `/home/user/dfittrd/docs/research/photo-avatar-plan.md`
- `/home/user/dfittrd/docs/ENGINE-HANDOFF.md`
- `/home/user/dfittrd/docs/research/shortcut-to-step3.md`
- `/home/user/dfittrd/docs/research/fit-engine-spec.md`
- `/home/user/dfittrd/docs/research/step3-serverdrape-spike.md`
- `/home/user/dfittrd/packages/fit-engine/src/constants.ts`
- `/home/user/dfittrd/packages/schema/src/garment.ts`
- `/home/user/dfittrd/packages/schema/src/body.ts`
- `/home/user/dfittrd/apps/api/src/routes/try.ts`
- `/home/user/dfittrd/apps/api/src/routes/app.ts`
- `/home/user/dfittrd/apps/api/src/routes/renders.ts`
- `/home/user/dfittrd/apps/api/src/routes/sdk.ts`
- `/home/user/dfittrd/apps/api/src/services/assets.ts`
- `/home/user/dfittrd/apps/api/src/services/products.ts`
- `/home/user/dfittrd/apps/web/src/embed/Garment3D.tsx`
- `/home/user/dfittrd/apps/web/src/embed/ResultScreen.tsx`
- `/home/user/dfittrd/.claude/worktrees/avatar-malebody/packages/mannequin/src/families.ts` (male table and levels read in this run)
- `/home/user/dfittrd/.claude/worktrees/avatar-mendata/packages/schema/src/mappings/audience.ts` (lines 95 to 115 read in this run)
- `/home/user/dfittrd/.claude/worktrees/avatar-mendata/packages/schema/src/chartTemplatesMen.ts` (lines 275 to 315 read in this run)
- `/home/user/dfittrd/.claude/worktrees/tape-serverdrape/spikes/garment-engine/serverdrape/pom_rest.py`
- `/home/user/dfittrd/.claude/worktrees/tape-viewer/spikes/garment-engine/README.md`

The API route, embed and tape-viewer line references come from the feasibility review; I re-read only the files marked "read in this run".

## Critiques not adopted, or adopted only in part

1. **XXL midpoint 123.5 (refutation item 10): not adopted.** I kept 123/111. It is the midpoint of the two EN steps the letter combines (120 and 126), it matches the committed branch table, and the reviewer called either defensible. The wording is now "midpoint of the two steps", not "letter-range midpoint".
2. **Move the base body to a European stature now (refutation item 7): adopted in part.** I did not change the stature numbers. The only Dutch figure is a search summary of CBS, and the committed branch has tested per-size statures. The plan drops the fixed 176 cm, adopts the branch values and puts the choice to the founder as an open decision.
3. **Raise seat values toward the trade table (refutation item 4): adopted as the reviewer worded it, no number changed.** Seat is marked [M]. The German table that suggests chest + 4 has a retailer footnote and an uncertain column alignment, so it is not strong enough to overwrite the ANSUR-based branch values.
4. **Replace the button on the shop page inside M0 (feasibility item 3, first option): adopted in part.** M0 takes the second option the reviewer offered (the line inside the modal) and returns the state from `/v1/sdk/sessions`. The button change is M0b, optional, because it touches three shipped front ends and D20's wording ("in place of the Try it on flow") is met by the modal.
5. **Base size at an EN step, 100/88/40 (gap noted in the refutation review): not adopted.** I kept 98/86/39.5 because it is the committed, tested branch value. It is now marked as an [A] product choice.
6. **Treat the W/L template as forbidden (feasibility item 10): adopted in part.** The template stays, because its centimetres come from two cited retailer tables, but only as a pre-fill the merchant must confirm. The engine rule (no centimetres from a label) and vector MT10 stand.
7. **A build-trigger slice (feasibility item 5): adopted in part.** I took the reviewer's alternative: men's 3D is stated as pilot-only with manual import, and the trigger is listed as M9, unscheduled, outside the estimate.
8. **Paul Fredrick does not source the shirt eases (refutation item 6): adopted in part.** I used the sourced 26 and 21.5 for classic and tailored and marked them as one retailer's figures. The other shirt values are [A].

Everything else in both reviews was applied.
