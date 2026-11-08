# Second shop: nobodyschild.com (refinement P4, CPU only)

8 Nov 2026. Branch `claude/shop2`. **No GPU was used**: no Modal run, nothing under `.github/` changed. Every number below comes from CPU code in this repo; the GPU stages are proposed, not run.

## The shop, and what it is not

**Nobody's Child** (nobodyschild.com, UK, GBP, Shopify) is a **test shop chosen by us**. It is **not a partner**: it has not been contacted, has given no consent and has no relationship with Curtain. We read public storefront data only: `/products.json` (15 pages, 3,680 products), the public size guide (`/pages/size-guide`) and the product pages of five products. robots.txt allows all three; requests were spaced (3 s) and sent with an honest user agent. One attempt to fetch a page with a browser user agent was blocked by our own tooling before it ran, and was not repeated. **Before any public use** of the shop's name, photos, or renders and bundles made from them, we need its written permission. Raw downloads are gitignored (`spikes/garment-engine/data/nobodyschild/raw/`).

Why this shop:

- **A different size system.** UK 4–24 and XS–XL, with **its own printed body chart** (bust, waist, hip in cm, EU and US labels, inside leg per trouser length). Bohohippychic prints no chart and uses AU sizes.
- **Another data shape.** The description is a list of bullets ("V-neck", "Shirred waist"). The facts are elsewhere: a structured tag taxonomy (`length:midi`, `product-type:wide leg trousers`, `fabric-group:cotton`), and on the product page the composition ("Main: 100% Cotton"), **the size the model wears** and a **wearing length**.
- **Photos at 1600 × 2080** (85 % of apparel images reach the 1600 px rule; Bohohippychic serves 800 × 1200 at most).
- A **Regular/Petite length option** on 400 of 3,047 apparel products.

Candidates considered: rouje.com (France, FR 34–44) has no composition and no size chart in its public data, and its product text is French. thinkingmu.com (Spain) uses letter sizes only. Both were left out.

## What was built

| Part | File |
| --- | --- |
| Shop-agnostic importer: size guide → body chart (numeric, letter, inside leg, defects); product page → composition, model size, wearing length (read only inside the product's own blocks); category, subcategory and pattern block from product type and tags; wearing-length plausibility; size offer against the chart; payload builder | `spikes/garment-engine/src/shopImport.ts` |
| The Nobody's Child adapter: product-type map, selection with reasons and runners-up, rejected types, image classification by eye | `src/shops/nobodyschild.ts` |
| CLI (`shop:import`), same sha256 pinning of the hand classification as `shop:bohohippychic` | `src/shopImportCli.ts` |
| 3D-readiness check shared by both shops (a base size stated by the shop is no longer a reason) | `src/shopReadiness.ts` |
| Size advice through the plugin's path on test bodies (`size-advice:shop`) | `src/shopSizeAdvice.ts`, `scripts/size-advice-shop.ts` |
| Stage 1b preflight on CPU (manifest, plan, inputs, edit region, positive and negative control) | `modal/stage1b_preflight.py` |
| Exporter accepts `--shop nobodyschild`; photo choice prefers a plain background over an earlier busy one | `src/product.ts` |
| Tests | `src/shopImport.test.ts` (23), `modal/tests/test_stage1b_preflight.py` (4) |

Bohohippychic keeps its own importer (`shop.ts`, AU text parsing). It was not migrated to the adapter: its rebuilt `products.json` and `images.json` are byte-identical after the shared readiness change, and that was checked.

## The five products

| Kind | Product | Sizes | Fabric | Base size | Length | Photos (front / back) | Completeness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dress | `ezra-midi-dress-2616487001` | UK 4–18 | 100% cotton | UK 8 (shop) | 130 cm shoulder_to_hem | #3 / #5, straight, plain backdrop | 0.636 |
| top | `sallie-top-2617136001` | UK 4–18 | 100% cotton | UK 8 (shop) | 53 cm | #4 / #5 (3/4 back crop, hair over the back) | 0.636 |
| skirt | `ronda-skirt-2614903002` | UK 4–18 | 100% cotton | UK 8 (shop) | 90 cm waist_to_hem | #4 / #5, straight | 0.618 |
| trousers | `topaz-trousers-2616025001` | UK 4–18 | 100% cotton | UK 8 (shop) | none (inside leg 79 cm, tag "regular") | #5 / #4, straight | 0.588 |
| outerwear | `tie-neck-df-jacket-2616863001` | XS–XL | 51% wool, 49% polyester | S (shop) | 59 cm | #9 / #5 | 0.636 |

Every base size is **stated by the shop** (the photographed size), unlike Bohohippychic where AU 12 was our guess. All five are still incomplete: none has a flat-lay photo, a colour hex or a EUR price, and none is invented.

## What the second shop exposes

Defects in our code that the second shop found, and fixed here:

1. **Product pages carry other products' facts.** A Shopify theme page holds shop-the-look and cross-sell drawers, each with a model size and a wearing length. On the Ronda skirt's page the first "Wearing length is: 53cm" belongs to the matching Sallie top. A first, whole-page parse took it for the skirt. The parser now reads only inside the product's own blocks (`product-page__details--model-size`, `accordion-fabric-and-care`) and its element boundaries; a test pins the case. The skirt's own length is 90 cm.
2. **The AU-only importer would misread UK sizes.** `shop.ts` treats any numeric size option as AU and applies the AU chart. Nobody's Child's "4, 6, 8 …" would pass silently. The adapter brings the shop's own chart instead.
3. **The photo choice picked a street photo** when a studio photo of the same role came later. It now prefers a plain background (no change for Bohohippychic, whose photos are all busy).

Defects in the shop's data (reported, not corrected):

4. **The size guide contradicts itself.** The letter table prints EU "32-24" for XS. It gives US M as "6-8" in the inch table and "8-10" in the cm table, and L as "10-12" and "12-14". Each letter row is the body of the **top** of its UK range (S = UK 10, M = UK 14). This is consistent, but it means a UK 8 shopper's "S" is cut for a UK 10 body.
5. **Unusable or doubtful lengths:** "Wearing length is: 4.7cm" on `bonnie-collared-blouse` (a typo). `rue-tailored-wide-leg-trousers` prints 60 cm, which cannot be a trouser outseam or inseam. A length is now checked against a range per category and band. Trousers never take a "wearing length", because the shop does not say outseam or inseam.
6. **Shared photos:** Sallie top #1/#3/#4 are the same files as Ronda skirt #3/#1/#4 (sha256). The topaz trousers' back legs are plain while the front carries the tile print, so a stage 1b back must not copy the front's print.
7. **Colour tags are coarse:** the black-and-blue check set is tagged `colour-group:white`. Colour stays out of the payload, as on Bohohippychic.

Gaps in the engine that the second shop shows (open, not fixed here):

8. **Ezra's proxy is probably about 10 cm too long.** With 130 cm shoulder_to_hem, the proxy's hem sits at 8.7 % of body height on our mannequin (just above the ankle). In the shop photo the hem is at about 13–16 % of the 174 cm model's height (lower calf). This is measured by eye on one photo, so it is an estimate. Either the wearing length is not HPS to hem at the photographed size, or our flat-lay length rule over-reads it. Stage 1b QA will judge the length against this proxy, so check it before the GPU run (see the proposal). **The inputs also disagree on the length band:** the stage 2 prompt says "a midi … dress", the P0 prediction says maxi (from 130 cm) and the proxy ends at the ankle, while the shop tags the dress `length:midaxi` and the photo shows the hem at the lower calf. **The proxy skirt is also too narrow:** the photo shows a relaxed A-line with puff sleeves and a front slit; the proxy is a near-column skirt (hem flare 1.1) with plain short sleeves. Stage 1b QA silhouette bands may therefore be judged against a target that is too narrow; report the margins in the R10 check (d).
9. **Fabric weight is one number per fibre.** All three cotton products get the library's 240 gsm. A pinstripe cotton dress and a shirred top are lighter. The jacket's "double-faced" wool (stated in the description) is far heavier than the 241 gsm from its fibres, because the construction is not parsed. The drape prediction is affected.
10. **"Shirred" is read as "smock".** The prediction engine turns the title word into a smock cut with a 1.35 hem flare for the Ronda skirt. The photos show a modest A-line with a shirred yoke. The shirred bodice of the Sallie top and Ezra's shirred waist stretch, but GarmentPayload v1 has no stretch zone for a bodice.
11. **Boxy outerwear.** The jacket is "relaxed fit, dropped shoulders", and its proxy is a close body + ease shell with set-in sleeves. This is the same gap as refinement R8 (cardigan), now on a second product.
12. **No TYPE check for a closed jacket.** The outerwear TYPE check guards a front opening. A buttoned jacket has no opening, so a pullover drawn instead would pass stage 1b QA (the preflight reports "no negative control").
13. **No shoulder width** in the shop's chart either, so the shoulder fit point is skipped for dresses, tops and outerwear on both shops.
14. **Petite.** 400 apparel products offer Regular/Petite. A body chart has one body per size. Petite lengths are not modelled; the importer warns.
15. **Completeness asks a skirt for `sizeChart.inseam`.** The bottom category lists inseam for skirts too. This is a small schema quirk.

## Size advice (fit engine, the plugin's path)

`size-advice:shop` resolves each draft with `sizeAdviceGarment` and runs `computeFit` for eight synthetic test bodies. The bodies are the shop's rows UK 8/12/16, halfway between rows, a pear shape (UK 10 top, UK 14 hip), an apple shape (UK 12 with a UK 16 waist) and a UK 12 with the long inside leg. The output goes to `out/eval/nobodyschild-size-advice.json` (gitignored).

- **Self-consistency holds on 25 checked cases.** Of the 40 shop-chart cases (8 bodies × 5 products), 25 have an expectation: the 15 exact-row cases (UK 8/12/16 × 5 products) each give **exactly** the row's size (the jacket through the letter chart: UK 8 → S, 12 → M, 16 → L), and the 10 between-row cases each give one of the two neighbouring sizes (always the upper one for the numeric products, the letter covering both for the jacket). The other 15 cases (pear, apple, tall) have no expected size and are judged by eye below. The exact-row check accepts only the row's own size, so it catches a one-size error: a test runs it on our UK template, which fails all three exact rows (negative control). An earlier version of the check accepted a neighbour on exact rows and could not have seen that error; the review of 8 Nov caught it.
- **The chart choice moves the advice by one size.** On the same bodies, our UK template (a median of Kite, Seasalt and Hobbs) recommends one size up on all 15 exact rows (8 → 10, 12 → 14, 16 → 18). An AU-only import of the labels gives one size up on 14 of 15; the exception is the Ronda skirt at UK 12, where the AU reading gives 12. The shop's UK 8 body (86/68/93) is larger than the template's UK 8 (83/66/91). So a merchant's own chart must win over a template, and the plugin must not fall back to a template silently.
- **Advice that contradicts itself.** For the pear body the dress gets "10" with "Tight at the hips — consider sizing up" (`fits: false`), and the apple body gets "12" with a tight waist. The engine returns the best-scoring size even when it is not wearable. The plugin must show it as "closest size", not as a recommendation. This is already the engine's contract (`recommendedSize` vs `fits`), but we have not checked it in the embed.
- **Wrong advice for length.** The tall body on the topaz trousers gets "Tight at the inseam — consider sizing up". Sizing up does not lengthen a trouser that has one length for every size. A length point should say "will be short", not "size up". This is a fit-engine note defect, not fixed here (engines stay pure and keep their vectors; this needs a spec change).

## Phase 0 jobs on CPU

Exported with `export:phase0 -- --shop nobodyschild --product <handle> --front-image N --back-image M` (export 0.6.0; about 20–25 s and 1,544 files each; `out/phase0/<handle>/`, gitignored). Job ids:

| Product | Job id | Proxy | Stage 2 prompt (neutral) |
| --- | --- | --- | --- |
| dress | `ezra-midi-dress-2616487001-393b321414d1` | dress | "a midi short-sleeved dress in a cotton fabric, one closed skirt …" |
| top | `sallie-top-2617136001-241ef07d6c35` | top | "a sleeveless top in a cotton fabric" |
| skirt | `ronda-skirt-2614903002-5830844cfbaa` | skirt | "an ankle-length maxi skirt in a cotton fabric, worn at the waist on a bare torso …" |
| trousers | `topaz-trousers-2616025001-eacf5345dfb4` | trousers | "full-length wide-leg trousers in a cotton fabric, … two separate trouser legs …" |
| outerwear | `tie-neck-df-jacket-2616863001-9c27e58f90c4` | outerwear | "a long-sleeved jacket in a wool and polyester fabric" |

Looked at by eye: every shop photo against its proxy-dressed target (front and back) and the side depth frame 40.

- The dress proxy has short sleeves, a closed skirt and a hem at the ankle (see 8).
- The top proxy is sleeveless and ends at the high hip. The shop shows it ending at the skirt's waistband on a 5'10" model, which is plausible for 53 cm.
- The skirt proxy runs from the waist to the ankle and matches the photos. The shop tags it "midi"; on our mannequin 90 cm is ankle length, as on the 5'7" model.
- The trouser proxy has two wide legs, a gap and a hem at the ankle. The photos show the hem on the floor.
- The jacket proxy is narrow, with set-in sleeves (see 11).

The skirt prompt says "maxi" where the shop says "midi". The 90 cm length decides this, and the photos agree with the length.

**P0 prediction** (`prediction.json` in each job):

| Product | Kind / band | Length | Hem flare | Fabric |
| --- | --- | --- | --- | --- |
| dress | maxi (from 130 cm) | printed 130 cm | 1.1 | 240 gsm |
| top | cropped | printed 53 cm | 1.05 | 240 gsm |
| skirt | maxi | 90 cm | 1.35 ("smock", see 10) | 240 gsm |
| trousers | full, wide-leg | ankle, σ 10 cm (no length) | 1.1 | 240 gsm |
| jacket | hip | printed 59 cm | 1.05 | 241 gsm, twill, outerwear marked high-risk |

Every route is `gpu`: P0 never skips a GPU run.

**Stage 1b preflight** (`python -I modal/stage1b_preflight.py <jobs>`): all five pass the manifest, plan and input checks. The proxy passes QA v2 on both views of every product (positive control). The wrong garment fails as a TYPE failure for the skirt (a bodice drawn) and the trousers (legs merged), on both views. The dress, the top and the closed jacket have no TYPE negative control (see 12). As a cross-check, Bohohippychic's palazzo, maxi skirt and cardigan jobs give the same result, and the cardigan's open front is caught. What the preflight cannot check without the GPU: the garment segmentation of the shop photo (Grounding DINO + SAM 2), so no garment colour and no print fidelity, and the try-on itself.

## Proposed GPU run (not run)

Order: stage 1b only first (cheap, and its TYPE checks stop a wrong garment before stage 2), look at the stills, then stage 2 + stage 4t for the products whose stills pass.

| Step | Per product | Five products |
| --- | --- | --- |
| Stage 1b, both engines, a small draw plan (H100, about 2–5 GPU min) | $0.20–0.40 | $1–2 |
| Stage 2, parallel half turns (2 × H100, about 930–960 GPU s, GPU only) | $1.02–1.05 | $5.1–5.3 |
| Stage 2 memory reservation (128 GiB per clip container, about $0.15 each) | about $0.30 | about $1.5 |
| Stage 4t (CPU, in the repo) | – | – |
| **Total, one attempt** | **about $1.5–1.8** | **about $8–9** |

These are list-price estimates from runs 13 and 17d (`spikes/garment-engine/modal/README.md`). Parallel stage 2 has not run on a GPU yet (refinement P1), so its figure is unmeasured, and the Modal invoice is the measurement. With one stage 1b retry for two products, budget about $10.

Before the run:

- (a) Decide on Ezra's length (gap 8). Either measure on a second photo, or accept the proxy and let QA warn. Settle its length band (midi, midaxi or maxi) so the stage 2 prompt, the P0 prediction and the proxy all say the same thing.
- (b) Prefer the jacket's on-model #9 over the hanger #4. The hanger shot is the only no-model photo, but it is 960 × 1248 on a blue wall.
- (c) Accept that the top's only back photo is a 3/4 crop with the hair over the back. Stage 1b may invent too much; the record says so.
- (d) R10: stage 1b QA thresholds were tuned on one shop. This run is their first test on a second one; report the margins (including Ezra's narrow proxy skirt, gap 8).
- (e) Permission for the run itself (founder decision). The GPU run uploads the shop's public photos to a third-party GPU provider (Modal) and creates derived renders and bundles. We **assume** an internal GPU run on public photos does not need the shop's permission; that is a legal assumption, not a conclusion, and the founder decides it before the run. All outputs stay internal.

Command (CI workflow as for runs 13–17, from the repo root), per product:

```sh
pnpm --filter @curtain/garment-spike export:phase0 -- --shop nobodyschild --product ezra-midi-dress-2616487001 --front-image 3 --back-image 5
# then the existing GitHub Actions workflow with --dress-only --dress-engine both on out/phase0/<handle>
```

Whether an internal GPU run needs the shop's permission is open (see (e)): we assume it does not, and the founder decides. Permission **is** needed before any render or bundle is shown outside the team.
