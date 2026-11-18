# @curtain/schema

Single source of truth for every Curtain wire type (docs/DECISIONS.md D8). Isomorphic
(browser + Node), one runtime dependency (`zod` 4). Everything else in the monorepo imports its
types from here; nothing here does I/O.

```sh
pnpm --filter @curtain/schema typecheck   # tsc --noEmit
pnpm --filter @curtain/schema test        # vitest (104 tests)
pnpm --filter @curtain/schema build       # tsup (esm + cjs + d.ts) + dist/*.schema.json
pnpm --filter @curtain/schema lint        # eslint
```

## Public API (`import … from '@curtain/schema'`)

### `garment.ts` — GarmentPayload v1 (handoff §3.1, extended)

- `GarmentPayloadSchema` / `GarmentPayload` — the full per-item payload. Required:
  `schemaVersion: 1`, `id`, `brand`, `name`, `category`, `priceEur`, `primaryColorHex`, `fabric`
  (`primary`, `stretchPct`, `drape`), `patternBlock`, **`sizeChartType: 'garment' | 'body'`**,
  `sizeChart` (≥ 1 row). Optional: `subcategory`, `productUrl`, `colorways`, `productPhotos`,
  `flatLayPhoto`, `ease`, `lengthCm`, `sizingNotes`, `trueToSizeScore`, `criticalFitPoints`,
  `stretchZones`, `styleTags` (0..1 per taste axis).
- `GarmentPayloadDraftSchema` / `GarmentPayloadDraft` — only `id`, `name`, `brand` required; what
  the plugins may upsert before the merchant has filled everything in.
- `SizeRowSchema` / `SizeRow` — `size` + optional `bust`, `waist`, `hip`, `shoulder`, `thigh`,
  `inseam`, `footEu`, `footLengthCm` (cm).
- Vocabularies and types: `GARMENT_CATEGORIES` / `GarmentCategory`, `FIT_POINTS` / `FitPoint`,
  `PATTERN_BLOCKS` / `PatternBlock` (literal union `| (string & {})`), `FABRIC_PRIMARIES` /
  `FabricPrimary` (same escape), `STRETCH_ZONES`, `TASTE_AXES`, `LENGTH_KEYS`, `CATEGORY_POINTS`.
- `parseGarmentPayload(unknown)`, `safeParseGarmentPayload(unknown)`.

`sizeChartType` is mandatory because the same chart recommends a different size depending on
whether rows are garment or body measurements (fit-engine-spec.md T14).

### `completeness.ts`

`completenessScore(garment: unknown) → { score: 0..1, missing: { field, reason, weight, severity }[], status: 'active' | 'incomplete', checked }`.
Heavy (3): `category`, `sizeChartType`, `sizeChart`, `fabric.primary`, `flatLayPhoto`.
Medium (2): `fabric.stretchPct`, `fabric.drape`, `ease`, `lengthCm`, `criticalFitPoints`.
Light (1): `sizeChart.<point>` for the category's default points, `primaryColorHex`,
`productPhotos`, `trueToSizeScore`, `fabric.opacity`, `fabric.sheen`, `colorways`, `styleTags`.
Checks are category-aware (shoes and accessories skip ease/lengths/critical points).
`status === 'active'` iff no heavy field is missing and `score >= ACTIVE_THRESHOLD` (0.5).
`missingFields(garment)` returns the dotted paths for the `missing_fields text[]` column.

### `fitSignature.ts` — FitSignature v1 (80 floats, the only body data that syncs)

- `FS_INDEX` — index map from body-scan.md: `girth` 0–11, `sigma` 12–23, `aspect` 24–35,
  `length` 36–47, `posture` 48–55, `shape` 56–65, `demographics` 66–71, `prefs` 72–77,
  `VERSION` 78, `QUALITY` 79. Per-key maps (`FS_INDEX.girth.bust === 2`) and block ranges.
- Key lists: `FS_GIRTH_LEVELS`, `FS_LENGTH_KEYS`, `FS_POSTURE_KEYS`, `FS_SHAPE_KEYS`,
  `FS_DEMOGRAPHIC_KEYS`, `FS_PREF_KEYS`, `FS_AGE_BUCKETS`.
- `encodeFitSignature(profile) → number[80]`, `decodeFitSignature(vec) → FitSignatureProfile`,
  `quantiseFitSignature(vec)`, `toFitSignatureWire(profile)`, `toFloat32(vec)`.
- Quantisation (`FS_QUANT`): girths 0.5 cm, sigmas 0.25 cm, lengths 1 cm; aspect/posture 0.01,
  shape 0.001, prefs 0.05, quality 0.01. **0 means "unknown"** and is dropped on decode.
- `FitSignatureWireSchema` — body of `PUT /v1/me/signature`: `{ version: 1, vector: number[80], quality }`
  (refined so `vector[78] === version` and `vector[79] ≈ quality`).
- `fitSignatureFromBodyProfile(profile, extras?)` lifts the on-device `BodyProfile` into the
  signature (the fit-point `shoulder` is a breadth → `lengths.biacromialBreadth`).
- No face, skin or hair values are ever encoded (tested).

### `body.ts` — body types shared by capture and the fit engine

- `BodyProfile` (on-device, never synced): `measurements: Partial<Record<Point | 'footLengthCm' | 'footEu' | 'height' | 'weight', { mean, sigma, source: 'scan' | 'manual' | 'fused' | 'prior' }>>`,
  `conflicts`, `manualMethod`, `captureQuality`, `posture`, `history`.
- `UserBody` — exactly the fit-engine input: `measurements: Partial<Record<Point | 'footLengthCm' | 'footEu', number>>`, `confidence?`, `history?`.
- `toUserBody(profile)` — means + `confidenceFromSigma` per point (conflicting points capped at 0.5).
- `confidenceFromSigma(σ)` = clamp(0.95 − 0.26·(σ − 1.66), 0.2, 0.98); `fuseMeasurements`,
  `measurementsAgree`, `MANUAL_SIGMA_CM`.

### `swipe.ts`

`SwipeAction`, `PassReason`, `SwipeEvent` (+ zod schemas) exactly as taste-engine-spec.md, plus
`SWIPE_LEARNING_RATE` and `SWIPE_SIGN`.

### `api.ts` — route DTOs

Every `/v1` route from docs/ARCHITECTURE.md: devices (`DeviceCreateRequest`, `DeviceTokenResponse`),
`SignaturePutRequest`, ledger/erase/export, `TryResolveResponse`, `ShopProductsQuery/Response`,
`SwipeBatchRequest/Response` (≤ 100, no body data), wardrobe, **hero render**
(`PersonInputSchema.kind` is the literal `'avatarRender'` only — never add a member),
`HeroRenderRequest/Status` (status always carries `disclaimer`, retention ≤ 24 h), `FitCohortResponse`,
`SdkSessionRequest/Response`, merchant products (`MerchantProductUpsertRequest` = draft,
`MerchantProductValidateResponse`, list, delete), `UsageResponse`, `MerchantLedgerResponse`,
`AnalyticsSwipesResponse` (k-anonymity floor), key rotation. `validateGarmentDraft(payload)`
implements the validate dry-run. `API_ROUTES` lists the method + path per DTO.
`ESTIMATE_DISCLAIMER` is the default render label.

### `mappings/shopify.ts`, `mappings/woo.ts`

- `SHOPIFY_METAFIELD_NAMESPACE = '$app:curtain'`, `SHOPIFY_METAFIELD_DEFINITIONS` (key, type,
  payload path, heavy, pin) → create on install. `fromShopifyProduct(productNode, metafields?, { warnings })
  → Partial<GarmentPayload>`, `toShopifyMetafields(payload, ownerId)`, `shopifyExternalId(gid)`.
- `WOO_META_PREFIX = '_curtain_'`, `WOO_META_KEYS` (meta box fields), `fromWooMeta(product, meta?, { warnings, currency })`,
  `toWooMeta(payload)`.
- Both mappings are lenient: invalid JSON or values are dropped per field and reported through the
  `warnings` sink; the result is a draft for `completenessScore` / `GarmentPayloadSchema`.
- `mappings/common.ts` exports the coercers (`coerceSizeChart`, `coerceFabric`, `inferCategory`, …). `coerceUnit` (0..1 fields such as `trueToSizeScore`) accepts a fraction, an explicit percentage (`"92%"`) or a whole number 2..100 read as a percentage; a fraction above 1 such as `1.5` is rejected, not read as 1.5 %.

### Garment tape and closure (`garmentTape.ts`)

Two optional fields on `GarmentPayload` (and the draft). Absent = the behaviour from before they existed.

- `closure?: 'pull-on' | 'zip' | 'button' | 'drawstring' | 'wrap' | 'other'` (`GARMENT_CLOSURES`). Only `'pull-on'`
  (no opening: the stretched waistband has to pass the hips) changes the fit engine's result.
- `garmentTape?: GarmentTapeRow[]`: per size (matched to `sizeChart` by label, trimmed and case-insensitive) up to five
  values of the garment lying flat, girths doubled: `waistRelaxed`, `waistStretched`, `hip` (with optional
  `depthBelowBandCm`), `hemSweep`, `length`. Every value is `{ cm, provenance }` with
  `provenance: 'measured' | 'interpolated' | 'extrapolated'`. A value without a provenance is rejected, so an
  unmeasured size cannot be stored as measured. One row per size; `waistStretched` may not be smaller than `waistRelaxed`.
- `fillGarmentTape(chart, measuredRows)` builds `garmentTape` for every chart size from the sizes the shop measured
  (`MeasuredTapeRow`, plain cm). Rule: a measured size keeps its value; a size between two measured sizes lies on the
  straight line between its nearest measured neighbours (`interpolated`); a size outside them continues the line
  through the two nearest measured sizes (`extrapolated`); with one measured size only the two band fields
  step with the chart's waist step (`extrapolated`); hip, hem sweep and length get no value on the other sizes,
  because one sample says nothing about how they grade. Position on the line: the chart waist for the two band fields, the chart hip for the
  others, the row index when the chart lacks the column. Each field is filled on its own. This is the rule of the
  spike (`apps/web/src/render/ringInputs.ts` `fillSizes`) except for the one-sample case, where the spike steps
  every field. The spike's copy still exists and feeds only the ring overlay; the two are not shared yet.
  `fillGarmentTape` throws a `RangeError` naming the size when a measured size has a stretched band smaller than
  its relaxed band (a typing mistake the row schema would refuse later without saying where it came from).
- `worstTapeProvenance(values)`.
- Fixtures: `PILOT_SKIRT_TAPE_MEASURED` (the shop's AU 8, 10, 14), `PILOT_SKIRT_CHART_ONLY` and
  `PILOT_PULL_ON_SKIRT` (the same skirt with `closure` and the filled tape). Not in `MOCK_GARMENTS`.
- Not checked by the schema: that every tape label exists in `sizeChart` (the draft schema is a `.partial()` of the
  payload object, which rules out a cross-field refinement there). The fit engine ignores a row it cannot match.
  `completenessScore` does not look at these fields.

### The "Garment measurements" form (`garmentTapeForm.ts`, `garmentTapeFormCases.ts`, `mappings/tape.ts`)

What both merchant admins (Shopify app, WooCommerce meta box) send and check. Nothing here concerns a shopper.

- `checkGarmentTapeInput({ category, chart, closure, measured })` → `{ ok, errors, warnings, measuredSizes, garmentTape?, closure? }`.
  `measured` holds only the sizes the shop ticked as measured (plain cm, `MeasuredTapeInputRow`, an empty input is
  `null`). Errors stop a save (`unknown_size`, `duplicate_size`, `empty_measured`, `not_a_number`, `out_of_range`,
  `depth_out_of_range`, `stretched_below_relaxed`, `unknown_closure`, `no_chart`); warnings do not (`looks_flat`,
  `hip_no_depth`, `hip_depth_mixed`, `not_bottom`, `no_closure`, `pull_on_no_stretch`, `few_sizes`,
  `edge_unmeasured`, `not_increasing`). The other sizes are filled by `fillGarmentTape` and labelled
  `TAPE_PROVENANCE_LABELS` ("estimated" / "rough estimate"). Every sentence is in `GARMENT_TAPE_MESSAGES`, the one
  English catalogue (D21). The order of the issues is part of the contract: the PHP twin gives the same list.
- `GARMENT_TAPE_FORM_CASES`: shared cases (every issue code at least once). The WooCommerce plugin exports them with
  the TypeScript answers to `tests/fixtures/garment-tape.json` and its PHP twin must give the same.
- Wire: `GarmentTapeWriteRequestSchema` (`PUT /shopify/products/:id/garment-tape`, `dryRun` checks and fills without
  writing) and `GarmentTapeFormResponseSchema` (also the `GET`).
- Stored as the filled tape: Shopify metafields `closure` (single line) and `garment_tape` (json), WooCommerce meta
  `_curtain_closure` and `_curtain_garment_tape`. `coerceClosure` / `coerceGarmentTape` read them back leniently and
  match the tape to the CURRENT chart (`refillGarmentTape`): sizes the chart no longer has are dropped with a warning,
  the estimates are filled again from the measured values, measured values are never changed.
  `measuredFromGarmentTape(tape)` gives the form back what the shop typed.

### Audience and men's data (photo-avatar plan slice 3; decision D20)

- `GarmentPayload.audience?: 'women' | 'men' | 'unisex'` (`GARMENT_AUDIENCES`). Optional: absent = not
  specified = the behaviour from before the field. The JSON Schema carries it as a closed enum.
  Under D20 the web layer shows "Men's clothing: coming soon" for `men` until the male 3D pipeline
  works; this package only carries the value.
- `audience.ts`: `bustLabelKey(audience)` → `'chest'` for men and unisex, else `'bust'`;
  `fitPointLabelKey(point, audience)`, `fitPointLabel(point, audience)` (English). The stored fit
  point stays `bust` everywhere; only the printed word changes. Pure, no DOM.
- `mappings/audience.ts`: `inferAudience(hints)` / `inferAudienceDecision(hints)` read the override,
  a gender attribute, product type, category, tags, title and collections, strongest first, as whole
  words ("women" is not read as "men"). `coerceAudienceOverride`, the word lists and
  `AUDIENCE_CASES` (`mappings/audienceCases.ts`, replayed by the WooCommerce plugin's PHP twin) are
  exported.
  - **The men's gate (D20 point 3, plan slice M0) reads these.** The rule itself lives in the api
    (`apps/api/src/services/readiness.ts`, behind the server flag `MEN_3D_GATE`, default off). This
    package carries the wire parts: `MEN_COMING_SOON_CODE` (`'men_coming_soon'`, the 422 code),
    `SdkSessionResponse.productState?: 'coming_soon'`, `TryResolveResponse.requires3d?: true`,
    `MerchantProductSummary.menGate?: 'coming_soon' | 'audience_unconfirmed'`, and
    `FromShopifyOptions.onAudience(decision)`, which reports the source of the audience so the api
    can keep it (`isWeakAudienceSource`: a title or a collection alone does not gate a product;
    neither does an unknown source). `MerchantProductUpsertQuerySchema` (`?audienceSource=` on the
    merchant PUT) lets a caller that inferred the audience itself report the source, and
    `TryResolveQuerySchema` / `TRY_CAP_REQUIRES_3D` (`?caps=requires3d` on `GET /v1/try/:token`)
    is how a client says it enforces `requires3d`.
    All four fields are optional and absent for every product that is not a gated men's product.
  - **It runs for every product on its next sync**, also for products that predate the field: the
    field is optional in the schema, but a shop's payloads gain an audience wherever the product
    data names one. The merchant override (Shopify metafield `audience`, Woo meta
    `_curtain_audience`) corrects it; the value `none` sends nothing.
  - The singular words "man", "woman", "lady", "dame", "heer", "vrouw" are names as often as
    audiences. They are read anywhere only in the override and the gender attribute; in a product
    type, category, tag or collection only as the whole value or a whole path segment ("Man",
    "Man > Jeans", "gender:man"); never in a title. So "Iron Man", "Spider-Man", "Isle of Man
    souvenirs", "Lady Gaga" and "Notre Dame" say nothing.
  - A word after "not" / "niet" / "from" (up to two words back) is skipped ("not for men",
    "borrowed from the men"); a word before "fit", "style", "cut", "look" or "inspired" is a style
    ("Women's Tee (Men's fit)" is women's); a Dutch or German compound needs a clothing word after
    the prefix (`herenjeans` yes, Herrenberg and Herentals no).
  - It is still a guess from text: "Men in Black Tee" reads as men's. `isWeakAudienceSource(source)`
    is true for `title` and `collections`; under D20 the web layer should not hide Try it on for a
    `men` that rests on a weak source without the merchant's confirmation. The payload does not
    carry the source: that wiring is not built.
- `chartTemplatesMen.ts`: generic men's **body** templates, not any brand's chart, each cell the
  median of published charts read on 2026-11-13 with the source tables in the file:
  `MENS_LETTER_BODY_TEMPLATE` (XS–3XL; chest, waist, seat; XXL and 3XL marked weak because the
  sources differ by more than `MENS_WEAK_SPREAD_CM` = 10 cm), `MENS_EU_BODY_TEMPLATE` (44–58, German /
  Dutch numbering; every size is marked weak, two sources per cell; BAUR's misprinted size 52 seat is
  interpolated), `MENS_JEANS_WL_BODY_TEMPLATE` (W/L grid; waist and inside leg only, in effect the
  inch label in cm). `jeansSizeLabel`, `parseJeansSize`.
  - **Not offered yet.** Each source carries `terms` (the publisher's terms page, read 2026-11-14,
    and what it says). No source allows commercial use: Nike and Arc'teryx license content for
    personal, non-commercial use only, Rab forbids commercial use without authorisation, OTTO
    reserves commercial text and data mining, Swix, Lidl, BAUR and Outdoor Renner are silent, BCF's
    terms could not be read. The three templates therefore carry `legalReview: 'pending'` and are
    left out of `OFFERED_CHART_TEMPLATES`, `chartTemplatesDto()` and the WooCommerce asset. They
    still resolve by id. To release after counsel (Naomi) has answered: remove `legalReview` from
    the templates. Open questions for her: are body measurement tables facts that may be reused;
    may the source rows be stored verbatim in the repository (database right); the same for the
    women's templates, which are offered today and rest on the same kind of source.
- `fixtures/mens.ts`: `MENS_OXFORD_SHIRT`, `MENS_STRAIGHT_JEANS`, `MENS_TEST_BODIES` (slim, medium,
  broad; invented numbers). Kept out of `MOCK_GARMENTS`.

### `fixtures/`

`MOCK_GARMENTS` (41 payloads, 6 categories, 12 brands), `MOCK_GARMENTS_BY_ID`,
`MOCK_GARMENTS_BY_CATEGORY`, `mockGarment(id)`, `PROTOTYPE_GARMENT_IDS`
(`aalter-studio-1`, `monochrome-02`, `raw-denim-01` — charts identical to the fit-engine
`WRAP` / `SLIP` / `JEANS` fixtures, `sizeChartType: 'body'`), `indigo-04` = taste-engine `JACKET`.

### `jsonschema.ts` and `dist/*.schema.json`

`garmentJsonSchema()`, `garmentDraftJsonSchema()`, `fitSignatureJsonSchema()`,
`swipeEventJsonSchema()`, `allJsonSchemas()` — JSON Schema draft 2020-12 via `z.toJSONSchema`.
The build writes `dist/garment.schema.json`, `dist/garment-draft.schema.json`,
`dist/fit-signature.schema.json`, `dist/swipe-event.schema.json`; the PHP plugin ships the garment
schemas. Also exported as `@curtain/schema/garment.schema.json`.
