# @paskamer/schema

Single source of truth for every Paskamer wire type (docs/DECISIONS.md D8). Isomorphic
(browser + Node), one runtime dependency (`zod` 4). Everything else in the monorepo imports its
types from here; nothing here does I/O.

```sh
pnpm --filter @paskamer/schema typecheck   # tsc --noEmit
pnpm --filter @paskamer/schema test        # vitest (104 tests)
pnpm --filter @paskamer/schema build       # tsup (esm + cjs + d.ts) + dist/*.schema.json
pnpm --filter @paskamer/schema lint        # eslint
```

## Public API (`import … from '@paskamer/schema'`)

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

- `SHOPIFY_METAFIELD_NAMESPACE = '$app:paskamer'`, `SHOPIFY_METAFIELD_DEFINITIONS` (key, type,
  payload path, heavy, pin) → create on install. `fromShopifyProduct(productNode, metafields?, { warnings })
  → Partial<GarmentPayload>`, `toShopifyMetafields(payload, ownerId)`, `shopifyExternalId(gid)`.
- `WOO_META_PREFIX = '_paskamer_'`, `WOO_META_KEYS` (meta box fields), `fromWooMeta(product, meta?, { warnings, currency })`,
  `toWooMeta(payload)`.
- Both mappings are lenient: invalid JSON or values are dropped per field and reported through the
  `warnings` sink; the result is a draft for `completenessScore` / `GarmentPayloadSchema`.
- `mappings/common.ts` exports the coercers (`coerceSizeChart`, `coerceFabric`, `inferCategory`, …).

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
schemas. Also exported as `@paskamer/schema/garment.schema.json`.
