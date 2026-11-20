# @curtain/tryon-providers

Server-only adapters for the **opt-in hero render** (decision D4) plus the `TryOnRouter` that
picks one. Nothing in here may run in a browser: `package.json` has `"browser": false`, the entry
point throws `ServerOnlyViolation` when a `window`/`document` global exists, and ESLint forbids
browser globals. Keys are read in `apps/api/src/env.ts` and passed in as constructor arguments —
this package never touches `process.env`.

What it guarantees (AGENTS.md hard rules):

- `PersonInput.kind` is the single literal `'avatarRender'`; there is no `'userPhoto'` member and
  `consentTier` is `'heroOptIn'`. The device sends a composited avatar render; the face tile stays
  on the device and is not part of `PersonInput` at all.
- Every `TryOnResult` / `VideoResult` carries `disclaimer: 'generated-estimate'`.
- Every input image is normalised with sharp before it leaves our infrastructure: EXIF/ICC/XMP
  stripped, orientation applied, sRGB, resized to fit 1024 × 1536, PNG.
- `BANNED_MODELS` (`idm-vton`, `ootdiffusion`, `catvton`, `fitdit`, `smpl-x`) can neither be
  registered (`ProviderRegistry` throws) nor referenced in source (`pnpm lint` runs
  `scripts/check-banned-models.mjs`).
- Fit and size are never computed here; `GarmentInput.size` / `fitGapCm` come from the on-device
  fit engine and are only turned into prompt words.

## Public API

```ts
import {
  TryOnRouter, FashnProvider, VertexTryOnProvider, GrokVideoProvider, MockProvider,
  promptFromMetadata, motionPromptFromMetadata, parseOrder,
  type PersonInput, type GarmentInput, type TryOnOptions, type TryOnResult, type LedgerRecord,
} from '@curtain/tryon-providers';

const router = new TryOnRouter({
  providers: [
    new FashnProvider({ apiKey: env.FASHN_API_KEY }),                              // 'fashn'      tryon-v1.6  $0.075/img
    new FashnProvider({ apiKey: env.FASHN_API_KEY, model: 'tryon-max' }),          // 'fashn-max'  tryon-max   $0.075–0.375/img
    new VertexTryOnProvider({                                                      // 'vertex-tryon' virtual-try-on-001 $0.06/img
      enabled: env.VERTEX_TRYON_ENABLED, projectId: env.VERTEX_PROJECT, location: env.VERTEX_LOCATION,
      getAccessToken: () => auth.getAccessToken(), cachingDisabled: true,
    }),
    new GrokVideoProvider({ apiKey: env.XAI_API_KEY, zdr: true, getUploadTarget }), // 'grok-video' grok-imagine-video-1.5 $0.08/s
    new MockProvider(),                                                            // 'mock' dev/tests, $0
  ],
  policy: { order: parseOrder(env.TRYON_ORDER), maxCostUsd: 0.25, requireEuResidency: false, dailyCapUsd: 50 },
  onLedger: (record) => db.insert(ledgerEntries).values(record),
});

const { result, ledger, attempts } = await router.render(person, garment, { quality: 'balanced' });
const clip = await router.animate(result.images[0].png, garment, { durationSec: 6, resolution: '720p' });
```

### Types (`types.ts`)

`GarmentCategory`, `GarmentInput`, `PersonInput`, `TryOnOptions`, `TryOnResult`, `VideoOptions`,
`VideoResult`, `ProviderCapabilities` (incl. `privacy: { trainsOnInputs, retentionHours,
euResidency, zdrAvailable, selfHosted }` and `region`), `TryOnProvider`, `LedgerRecord`, `FetchLike`.

### Errors (`errors.ts`)

All errors extend `TryOnError` with `code` and `fallthrough`. Fall-through (router tries the next
provider): `PoseError`, `TimeoutError`, `RateLimitError`, `AuthError`, `ProviderError`,
`ProviderDisabledError`. Terminal: `ModerationError`, `ImageInputError`, `UnsupportedError`,
`ConfigError`, `PolicyError`, `BudgetExceededError`, `AbortedError`. When every provider was
skipped or failed the router throws `NoProviderAvailableError` with an `attempts` list.

### Router (`router.ts`)

`new TryOnRouter({ providers, policy: { order, maxCostUsd, requireEuResidency?, dailyCapUsd? },
circuit?, spend?, clock?, onLedger?, onAttempt? })`

- walks `policy.order`; skips unknown names, providers without the category, providers that
  train on inputs, non-EU providers when `requireEuResidency`, estimates above `maxCostUsd`,
  anything that would break `dailyCapUsd` (UTC day; `MemorySpendStore` by default, pass a
  Postgres-backed `SpendStore` from `usage_daily` in `apps/api`), and unhealthy providers;
- circuit breaker: 3 consecutive vendor failures open the circuit for 60 s (half-open probe after);
- returns `{ result, ledger, attempts }`, `ledger` = `{ provider, model, costUsd, retentionHours,
  trainedOn, region, kind, latencyMs, at }` for `ledger_entries`.

### Prompt text (`promptFromMetadata.ts`)

`drapeWord`, `sheenWord`, `opacityWord` (0–1 scales from handoff §3.1), `easeWord(gapCm)`,
`promptFromMetadata(garment)` → `"wrap dress, 240 gsm linen, fluid drape, matte, opaque,
non-stretch woven, colour #C97A4F, size M fitting close-fitting at the bust, relaxed at the waist.
Keep the person's face, body proportions and pose exactly as shown."`, and
`motionPromptFromMetadata(garment)` for the video animator.

## Providers

| name | model | endpoint | cost | privacy |
|---|---|---|---|---|
| `fashn` | `tryon-v1.6` | `POST https://api.fashn.ai/v1/run`, poll `GET /v1/status/:id` | $0.075 / sample | no training unless opt-in, base64 inputs deleted on completion, outputs ≤ 72 h, region not documented |
| `fashn-max` | `tryon-max` | same | credits × $0.075 (balanced 2k = $0.225) | same; prompt-capable; shoes/accessories |
| `vertex-tryon` | `virtual-try-on-001` | `POST https://{location}-aiplatform.googleapis.com/v1/projects/{p}/locations/{l}/publishers/google/models/virtual-try-on-001:predict` | $0.06 / image | no training, cache ≤ 24 h (0 with `cachingDisabled`), EU regions, SynthID + C2PA (`watermark: 'synthid'`) |
| `grok-video` | `grok-imagine-video-1.5` | `POST https://api.x.ai/v1/videos/generations`, poll `GET /v1/videos/:id` | $0.08 / s | no training, 30-day retention or ZDR (then **own `upload_url` required**), US-only → `euResidency: false` |
| `mock` | `mock-stamp` | none | $0 | returns the avatar stamped `ESTIMATE · MOCK · <garmentId>` |

Category mapping for FASHN v1.6: `top→tops`, `bottom→bottoms`, `dress→one-pieces`,
`outerwear→tops`; `shoes`/`accessory` only on `tryon-max`. `garment_photo_type` is `flat-lay`
when `flatLayPhoto` is present, else `model`. Vertex and v1.6 ignore `promptHint`.

## Environment variables (read in `apps/api/src/env.ts`, never here)

| var | used for |
|---|---|
| `FASHN_API_KEY` | `FashnProvider.apiKey` |
| `VERTEX_TRYON_ENABLED` | `VertexTryOnProvider.enabled` (adapter stays registered but is skipped when false) |
| `VERTEX_PROJECT`, `VERTEX_LOCATION` | GCP project and regional endpoint (`europe-west4` recommended) |
| `XAI_API_KEY`, `XAI_ZDR` | `GrokVideoProvider.apiKey` / `zdr` |
| `TRYON_ORDER` | comma-separated provider names for `policy.order`, e.g. `fashn,vertex-tryon` (`parseOrder`) |
| `TRYON_MAX_COST_USD`, `TRYON_DAILY_CAP_USD`, `TRYON_REQUIRE_EU` | router policy |

The Vertex access token comes from `apps/api` (ADC / service account, scope
`https://www.googleapis.com/auth/cloud-platform`); this package has no Google SDK dependency.

## Run

```bash
pnpm --filter @curtain/tryon-providers typecheck
pnpm --filter @curtain/tryon-providers test        # vitest, HTTP mocked with undici MockAgent
pnpm --filter @curtain/tryon-providers lint        # eslint + banned-model scan
pnpm --filter @curtain/tryon-providers build       # tsc → dist/
```

## Manual verification before go-live

- FASHN: confirm the `return_base64` output element format (data URI vs bare base64 — both are
  accepted) and the processing region/DPA; the `/v1/status` error names beyond `PoseError`,
  `ImageLoadError` are matched by pattern.
- Vertex: `addWatermark`, `baseSteps`, `safetySetting`, `personGeneration`, `outputOptions` are
  carried over from the preview API and only sent when configured; disabling implicit caching is
  a project-level data-governance setting, `cachingDisabled` records it for the ledger.
- xAI: `image.url` is sent as a `data:image/png;base64,…` URI; verify the account accepts data
  URIs for video input (otherwise hand it a signed URL from our own storage).
