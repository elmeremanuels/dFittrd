/**
 * API DTOs for the one backend (docs/ARCHITECTURE.md, architecture-panel.md proposal 1,
 * adjusted by docs/DECISIONS.md). Every /v1 route is typed from these schemas via
 * @fastify/type-provider-zod; the web client imports the same types.
 *
 * Privacy invariants encoded here (D3):
 *   - `PersonInputSchema.kind` is the literal `'avatarRender'` ONLY. There is no `'userPhoto'`
 *     member and none may ever be added; the API client cannot serialise a raw frame.
 *   - No route DTO carries a measurement, a photo or a device id to a merchant.
 *   - Every render response carries a non-empty `disclaimer` (AGENTS.md rule 3).
 */
import { z } from 'zod';
import { GarmentCategorySchema, GarmentPayloadDraftSchema, GarmentPayloadSchema, HexColorSchema } from './garment';
import { FitSignatureWireSchema } from './fitSignature';
import { SwipeEventSchema } from './swipe';
import { completenessScore, type CompletenessResult } from './completeness';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const ESTIMATE_DISCLAIMER = 'Estimate — generated from your measurements and the shop’s garment data, not a photo of you.';

const uuid = z.uuid();
const isoDate = z.iso.datetime({ offset: true });
const dateOnly = z.iso.date();
const httpUrl = z.url({ protocol: /^https?$/ });
const cursor = z.string().min(1).max(512);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(1000),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const MissingFieldSchema = z.object({
  field: z.string(),
  reason: z.string(),
  weight: z.number(),
  severity: z.enum(['heavy', 'medium', 'light']),
});

export const CompletenessResultSchema = z.object({
  score: z.number().min(0).max(1),
  missing: z.array(MissingFieldSchema),
  status: z.enum(['active', 'incomplete']),
  checked: z.array(z.string()),
});
// Keep the DTO in lock-step with the function's return type.
const _completenessTypeCheck: z.infer<typeof CompletenessResultSchema> = completenessScore({});
void _completenessTypeCheck;
export type CompletenessResultDto = CompletenessResult;

// ---------------------------------------------------------------------------
// APP — devices (anonymous device accounts; no email, no password)
// ---------------------------------------------------------------------------

export const DEVICE_PLATFORMS = ['web', 'ios', 'android'] as const;

/** POST /v1/devices */
export const DeviceCreateRequestSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  appVersion: z.string().min(1).max(32),
});
export type DeviceCreateRequest = z.infer<typeof DeviceCreateRequestSchema>;

export const DeviceTokenResponseSchema = z.object({
  deviceId: uuid,
  /** Bearer JWT, 30 days. */
  token: z.string().min(1),
  expiresAt: isoDate,
  tokenVersion: z.number().int().nonnegative(),
});
export type DeviceTokenResponse = z.infer<typeof DeviceTokenResponseSchema>;

/** POST /v1/devices/rotate (bearer) → same response, previous token invalidated. */
export const DeviceRotateRequestSchema = z.object({ appVersion: z.string().min(1).max(32).optional() });
export type DeviceRotateRequest = z.infer<typeof DeviceRotateRequestSchema>;

// ---------------------------------------------------------------------------
// APP — me: signature, ledger, erase, export
// ---------------------------------------------------------------------------

/** PUT /v1/me/signature */
export const SignaturePutRequestSchema = FitSignatureWireSchema;
export type SignaturePutRequest = z.infer<typeof SignaturePutRequestSchema>;

export const SignaturePutResponseSchema = z.object({
  updatedAt: isoDate,
  ledgerEntryId: uuid,
});
export type SignaturePutResponse = z.infer<typeof SignaturePutResponseSchema>;

/** `fit`: a size recommendation shown in the standalone embed (size label + confidence only, never measurements). */
export const LEDGER_KINDS = ['signature_sync', 'swipe_batch', 'wardrobe_sync', 'hero_render', 'pairing', 'erase', 'fit'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** One line of the privacy ledger (client and server keep mirrored copies). */
export const LedgerEntrySchema = z.object({
  id: uuid,
  kind: z.enum(LEDGER_KINDS),
  at: isoDate,
  payloadSummary: z.object({
    bytes: z.number().int().nonnegative(),
    /** Top-level field names that were sent — never values. */
    fields: z.array(z.string()).max(64),
    provider: z.string().max(64).optional(),
    model: z.string().max(64).optional(),
    retentionHours: z.number().nonnegative().optional(),
    shopId: uuid.optional(),
  }),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

/** GET /v1/me/ledger?cursor */
export const LedgerListQuerySchema = z.object({ cursor: cursor.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export type LedgerListQuery = z.infer<typeof LedgerListQuerySchema>;
export const LedgerListResponseSchema = z.object({ entries: z.array(LedgerEntrySchema), nextCursor: cursor.nullable() });
export type LedgerListResponse = z.infer<typeof LedgerListResponseSchema>;

/** How a device got paired with a shop: app deep link, desktop QR, or the standalone embed (D11). */
export const PAIRING_SOURCES = ['link', 'qr', 'embed'] as const;
export type PairingSource = (typeof PAIRING_SOURCES)[number];

/** DELETE /v1/me — GDPR erase in one call. */
export const MeDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  tables: z.array(z.string()),
  at: isoDate,
});
export type MeDeleteResponse = z.infer<typeof MeDeleteResponseSchema>;

/** GET /v1/me/export — Art. 20 portability. Everything the server holds for this device. */
export const MeExportResponseSchema = z.object({
  deviceId: uuid,
  exportedAt: isoDate,
  signature: FitSignatureWireSchema.nullable(),
  swipes: z.array(SwipeEventSchema.extend({ shopId: uuid })),
  wardrobe: z.array(z.lazy(() => WardrobeItemSchema)),
  pairings: z.array(z.object({ shopId: uuid, pairedAt: isoDate, source: z.enum(PAIRING_SOURCES) })),
  ledger: z.array(LedgerEntrySchema),
});
export type MeExportResponse = z.infer<typeof MeExportResponseSchema>;

// ---------------------------------------------------------------------------
// APP — try resolve, shop catalogue, products
// ---------------------------------------------------------------------------

export const ShopBrandingSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(120),
  brandColor: HexColorSchema.optional(),
  logoUrl: httpUrl.optional(),
  platform: z.enum(['shopify', 'woocommerce']),
  /** Below plan → the app shows the "shop paused" screen (D7). */
  paused: z.boolean().default(false),
});
export type ShopBranding = z.infer<typeof ShopBrandingSchema>;

/** GET /v1/try/:token */
export const TryResolveParamsSchema = z.object({ token: z.string().min(16).max(4096) });
export type TryResolveParams = z.infer<typeof TryResolveParamsSchema>;

export const TryResolveResponseSchema = z.object({
  shop: ShopBrandingSchema,
  garment: GarmentPayloadSchema,
  trySession: z.object({
    id: uuid,
    expiresAt: isoDate,
    /** Idempotency token for the billable fit session (D7). */
    intentToken: z.string().min(16).max(128),
  }),
  pairing: z.object({ created: z.boolean(), pairedAt: isoDate }),
  /**
   * Standalone embed (docs/STANDALONE.md §2): the shop storefront origins the iframe may use as the
   * `postMessage` targetOrigin. It never posts to `*`.
   */
  embed: z.object({ allowedOrigins: z.array(z.string().min(1).max(256)).max(32) }),
});
export type TryResolveResponse = z.infer<typeof TryResolveResponseSchema>;

/**
 * GET /v1/peek?shop&product&page (device JWT) — the size peek next to the button (apps/web
 * `/embed/peek`). Read-only: it creates no try session and no pairing, writes nothing and bills
 * nothing. Only a device already paired with the shop (it used the fitting room there) gets an
 * answer, and only for a product that is try-able (`active`). `page` is the merchant page's origin
 * as the browser reported it; it joins `allowedOrigins` only when it belongs to the shop.
 */
export const PeekQuerySchema = z.object({
  shop: z.string().regex(/^pk_(live|test)_[A-Za-z0-9]{6,32}$/),
  product: z.string().min(1).max(128),
  page: httpUrl,
});
export type PeekQuery = z.infer<typeof PeekQuerySchema>;

export const PeekResponseSchema = z.object({
  shop: ShopBrandingSchema,
  garment: GarmentPayloadSchema,
  embed: z.object({ allowedOrigins: z.array(z.string().min(1).max(256)).max(32) }),
});
export type PeekResponse = z.infer<typeof PeekResponseSchema>;

/**
 * POST /v1/try/:token/fit-shown (device JWT) — the billing event of the standalone embed (D7, D11).
 * Only the chosen size label and the confidence go up; the body is strict, so a client that tries
 * to send measurements is rejected instead of silently stripped (D3).
 */
export const FitShownRequestSchema = z
  .object({
    intentToken: z.string().min(16).max(128),
    recommendedSize: z.string().min(1).max(16),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type FitShownRequest = z.infer<typeof FitShownRequestSchema>;

/** `billed: false` on a replay of the same intent token (one billable session per intent token). */
export const FitShownResponseSchema = z.object({ billed: z.boolean() });
export type FitShownResponse = z.infer<typeof FitShownResponseSchema>;

/** GET /v1/shops/:shopId/products?cursor&category&limit */
export const ShopProductsQuerySchema = z.object({
  cursor: cursor.optional(),
  category: GarmentCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ShopProductsQuery = z.infer<typeof ShopProductsQuerySchema>;

export const ShopProductsResponseSchema = z.object({
  items: z.array(GarmentPayloadSchema),
  nextCursor: cursor.nullable(),
});
export type ShopProductsResponse = z.infer<typeof ShopProductsResponseSchema>;

/** GET /v1/products/:id */
export const ProductGetResponseSchema = z.object({ shopId: uuid, garment: GarmentPayloadSchema });
export type ProductGetResponse = z.infer<typeof ProductGetResponseSchema>;

// ---------------------------------------------------------------------------
// APP — swipes (batch ≤ 100, no body data)
// ---------------------------------------------------------------------------

export const SwipeWireEventSchema = SwipeEventSchema.extend({
  shopId: uuid,
  /** Client-generated id for idempotent replay from the outbox. */
  clientId: z.string().min(8).max(64),
  /** The try session's intent token when the swipe came from a merchant deep link. */
  intentToken: z.string().min(16).max(128).optional(),
});
export type SwipeWireEvent = z.infer<typeof SwipeWireEventSchema>;

export const SWIPE_BATCH_MAX = 100;

/** POST /v1/swipes — what the client sends (every event valid). */
export const SwipeBatchRequestSchema = z.object({ events: z.array(SwipeWireEventSchema).min(1).max(SWIPE_BATCH_MAX) });
export type SwipeBatchRequest = z.infer<typeof SwipeBatchRequestSchema>;

/**
 * POST /v1/swipes — what the server accepts at the envelope level (carry-over #23). Each event is
 * validated on its own against `SwipeWireEventSchema`, so one malformed event (an older client, a
 * corrupted outbox row) is reported in `rejected` instead of failing the whole batch.
 */
export const SwipeBatchEnvelopeSchema = z.object({ events: z.array(z.unknown()).min(1).max(SWIPE_BATCH_MAX) });
export type SwipeBatchEnvelope = z.infer<typeof SwipeBatchEnvelopeSchema>;

/**
 * Why one event of a batch was not stored. Every reason is permanent: re-sending the same event
 * cannot succeed, so the client drops it. Transient failures (5xx, network) fail the whole batch
 * and nothing of it is stored.
 */
export const SWIPE_REJECT_REASONS = ['invalid_event', 'unknown_shop'] as const;
export type SwipeRejectReason = (typeof SWIPE_REJECT_REASONS)[number];

export const SwipeRejectionSchema = z.object({
  /** Position of the event in the request's `events`. */
  index: z.number().int().nonnegative(),
  /** The event's clientId when it had a readable one. */
  clientId: z.string().max(64).nullable(),
  reason: z.enum(SWIPE_REJECT_REASONS),
  /** Short, value-free description (field path of the first issue for `invalid_event`). */
  detail: z.string().max(200).optional(),
});
export type SwipeRejection = z.infer<typeof SwipeRejectionSchema>;

export const SwipeBatchResponseSchema = z.object({
  /** Events newly stored by this batch. */
  accepted: z.number().int().nonnegative(),
  /** Events already stored by an earlier batch (same device and clientId); idempotent replay. */
  duplicates: z.number().int().nonnegative(),
  /** clientIds that are stored on the server now (accepted plus duplicates): the client deletes these. */
  acceptedClientIds: z.array(z.string().max(64)).max(SWIPE_BATCH_MAX),
  /** Events that were not stored, with the reason; all permanent. */
  rejected: z.array(SwipeRejectionSchema).max(SWIPE_BATCH_MAX),
  /** Distinct billable fit sessions created by this batch. */
  usageEventsCreated: z.number().int().nonnegative(),
  ledgerEntryId: uuid,
});
export type SwipeBatchResponse = z.infer<typeof SwipeBatchResponseSchema>;

// ---------------------------------------------------------------------------
// APP — wardrobe
// ---------------------------------------------------------------------------

export const WARDROBE_STATES = ['saved', 'bought', 'kept', 'returned'] as const;
export type WardrobeState = (typeof WARDROBE_STATES)[number];

/**
 * Wardrobe size when no size was known at save time (nothing fit, no measurements, no fit points):
 * an explicit marker, never a guessed label such as "ONE" (carry-over #24). The taste engine's
 * `SaveOutboxEntry.size` uses the same marker (`UNKNOWN_SIZE` there, guarded to be identical).
 * Cohort size histograms skip it.
 */
export const WARDROBE_SIZE_UNKNOWN = 'unknown' as const;
export type WardrobeSizeUnknown = typeof WARDROBE_SIZE_UNKNOWN;

/** A size label from the product's chart, or `WARDROBE_SIZE_UNKNOWN`. */
export const WardrobeSizeSchema = z.string().min(1).max(16);
export type WardrobeSize = string;

export function isKnownWardrobeSize(size: string | null | undefined): size is string {
  return typeof size === 'string' && size.length > 0 && size !== WARDROBE_SIZE_UNKNOWN;
}

/** PUT /v1/wardrobe/:productId */
export const WardrobePutParamsSchema = z.object({ productId: z.string().min(1).max(128) });
export const WardrobePutRequestSchema = z.object({
  shopId: uuid,
  size: WardrobeSizeSchema,
  state: z.enum(WARDROBE_STATES),
});
export type WardrobePutRequest = z.infer<typeof WardrobePutRequestSchema>;

export const WardrobeItemSchema = z.object({
  productId: z.string().min(1).max(128),
  shopId: uuid,
  size: WardrobeSizeSchema,
  state: z.enum(WARDROBE_STATES),
  updatedAt: isoDate,
});
export type WardrobeItem = z.infer<typeof WardrobeItemSchema>;

/** GET /v1/wardrobe */
export const WardrobeListResponseSchema = z.object({ items: z.array(WardrobeItemSchema) });
export type WardrobeListResponse = z.infer<typeof WardrobeListResponseSchema>;

// ---------------------------------------------------------------------------
// APP — hero render (opt-in, the ONLY image-accepting route)
// ---------------------------------------------------------------------------

/**
 * The person image for a hero render is always the app's own avatar composite (base frame with
 * anonymised head). `kind` is a closed literal: `'avatarRender'`. Do not add members.
 */
export const PersonInputSchema = z.object({
  kind: z.literal('avatarRender'),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  /** Base64 (no data: prefix), ≤ 7 MB decoded. */
  imageBase64: z.string().min(1).max(10_000_000),
  width: z.number().int().min(256).max(4096),
  height: z.number().int().min(256).max(4096),
});
export type PersonInput = z.infer<typeof PersonInputSchema>;
// Compile-time guard: PersonInput.kind must be exactly 'avatarRender'.
type _AssertAvatarOnly = PersonInput['kind'] extends 'avatarRender' ? ('avatarRender' extends PersonInput['kind'] ? true : never) : never;
const _avatarOnly: _AssertAvatarOnly = true;
void _avatarOnly;

export const RENDER_CONSENT_TIER = 'heroOptIn' as const;

/** POST /v1/renders/hero → 202 */
export const HeroRenderRequestSchema = z.object({
  productId: z.string().min(1).max(128),
  shopId: uuid,
  size: z.string().min(1).max(16),
  person: PersonInputSchema,
  consent: z.object({
    tier: z.literal(RENDER_CONSENT_TIER),
    ack: z.literal(true),
    acknowledgedAt: isoDate,
  }),
  /** Optional animated clip of the hero still (xAI Grok Imagine); never the raw capture. */
  video: z.object({ seconds: z.number().int().min(2).max(10) }).optional(),
});
export type HeroRenderRequest = z.infer<typeof HeroRenderRequestSchema>;

export const HeroRenderAcceptedSchema = z.object({
  jobId: uuid,
  status: z.literal('queued'),
  disclaimer: z.string().min(1).default(ESTIMATE_DISCLAIMER),
});
export type HeroRenderAccepted = z.infer<typeof HeroRenderAcceptedSchema>;

export const RENDER_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'expired'] as const;

/** GET /v1/renders/:jobId */
export const HeroRenderStatusSchema = z.object({
  jobId: uuid,
  status: z.enum(RENDER_JOB_STATUSES),
  /** Signed URL, ≤ 24 h. */
  imageUrl: httpUrl.optional(),
  videoUrl: httpUrl.optional(),
  provider: z.string().max(64).optional(),
  model: z.string().max(64).optional(),
  retentionHours: z.number().nonnegative().max(24).default(24),
  disclaimer: z.string().min(1).default(ESTIMATE_DISCLAIMER),
  error: z.string().max(500).optional(),
  createdAt: isoDate,
  finishedAt: isoDate.optional(),
});
export type HeroRenderStatus = z.infer<typeof HeroRenderStatusSchema>;

/** GET /v1/fit/cohort/:productId — aggregated wardrobe states, never signatures (v1). */
export const FitCohortResponseSchema = z.object({
  productId: z.string(),
  n: z.number().int().nonnegative(),
  kAnonymityFloor: z.number().int().min(1),
  /** Empty when n < kAnonymityFloor. */
  sizeHistogram: z.record(z.string(), z.number().int().nonnegative()),
  keptRate: z.number().min(0).max(1).nullable(),
});
export type FitCohortResponse = z.infer<typeof FitCohortResponseSchema>;

// ---------------------------------------------------------------------------
// SDK — handshake from the merchant page
// ---------------------------------------------------------------------------

export const SDK_SURFACES = ['button', 'api', 'embed'] as const;
export type SdkSurface = (typeof SDK_SURFACES)[number];

/** POST /v1/sdk/sessions (public, CORS *, rate-limited per shop) */
export const SdkSessionRequestSchema = z.object({
  shopKeyPrefix: z.string().regex(/^pk_(live|test)_[A-Za-z0-9]{6,32}$/),
  productExternalId: z.string().min(1).max(128),
  pageUrl: httpUrl,
  /**
   * Where the click came from; lets the merchant see "opened" only. `embed` is the standalone
   * overlay on the merchant page (docs/STANDALONE.md): no QR is generated for it.
   */
  surface: z.enum(SDK_SURFACES).default('button'),
});
export type SdkSessionRequest = z.infer<typeof SdkSessionRequestSchema>;

export const SdkSessionResponseSchema = z.object({
  /** https://app.<domain>/try/<jwt 10 min> */
  tryUrl: httpUrl,
  /** `${PUBLIC_APP_URL}/embed/<token>`: the iframe of the standalone overlay. On every response. */
  embedUrl: httpUrl,
  /** Inline SVG for the desktop QR modal (app mode). Omitted for `surface: 'embed'`. */
  qrSvg: z.string().min(1).optional(),
  expiresAt: isoDate,
  /** Below plan: the button still renders, the deep link shows "shop paused" (D7). */
  shopPaused: z.boolean(),
});
export type SdkSessionResponse = z.infer<typeof SdkSessionResponseSchema>;

// ---------------------------------------------------------------------------
// MERCHANT — products
// ---------------------------------------------------------------------------

export const MerchantProductParamsSchema = z.object({ externalId: z.string().min(1).max(128) });

/** PUT /v1/merchant/products/:externalId — accepts a draft; the server computes completeness. */
export const MerchantProductUpsertRequestSchema = GarmentPayloadDraftSchema;
export type MerchantProductUpsertRequest = z.infer<typeof MerchantProductUpsertRequestSchema>;

export const MerchantProductUpsertResponseSchema = z.object({
  externalId: z.string(),
  status: z.enum(['active', 'incomplete']),
  score: z.number().min(0).max(1),
  missingFields: z.array(z.string()),
  /** sha256 of the normalised payload; equal hash → no-op write. */
  contentHash: z.string().length(64),
  changed: z.boolean(),
  updatedAt: isoDate,
});
export type MerchantProductUpsertResponse = z.infer<typeof MerchantProductUpsertResponseSchema>;

/** POST /v1/merchant/products/validate — dry run, nothing stored. Body = anything the plugin has. */
export const MerchantProductValidateRequestSchema = z.object({ payload: z.unknown() });
export type MerchantProductValidateRequest = z.infer<typeof MerchantProductValidateRequestSchema>;

export const MerchantProductValidateResponseSchema = z.object({
  /** True when the payload parses as a full GarmentPayload v1. */
  valid: z.boolean(),
  issues: z.array(ValidationIssueSchema),
  completeness: CompletenessResultSchema,
});
export type MerchantProductValidateResponse = z.infer<typeof MerchantProductValidateResponseSchema>;

/** Implementation of the validate dry-run, shared by the backend and the plugins' tests. */
export function validateGarmentDraft(payload: unknown): MerchantProductValidateResponse {
  const parsed = GarmentPayloadSchema.safeParse(payload);
  const issues: ValidationIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
  return { valid: parsed.success, issues, completeness: completenessScore(payload) };
}

export const PRODUCT_STATUSES = ['active', 'incomplete', 'archived'] as const;

/** GET /v1/merchant/products?status&cursor */
export const MerchantProductsQuerySchema = z.object({
  status: z.enum(PRODUCT_STATUSES).optional(),
  cursor: cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MerchantProductsQuery = z.infer<typeof MerchantProductsQuerySchema>;

export const MerchantProductSummarySchema = z.object({
  externalId: z.string(),
  name: z.string(),
  category: GarmentCategorySchema.nullable(),
  status: z.enum(PRODUCT_STATUSES),
  score: z.number().min(0).max(1),
  missingFields: z.array(z.string()),
  flatLayProcessedUrl: httpUrl.nullable(),
  updatedAt: isoDate,
});
export type MerchantProductSummary = z.infer<typeof MerchantProductSummarySchema>;

export const MerchantProductsResponseSchema = z.object({
  items: z.array(MerchantProductSummarySchema),
  nextCursor: cursor.nullable(),
  counts: z.object({ active: z.number().int(), incomplete: z.number().int(), archived: z.number().int() }),
});
export type MerchantProductsResponse = z.infer<typeof MerchantProductsResponseSchema>;

/** DELETE /v1/merchant/products/:externalId */
export const MerchantProductDeleteResponseSchema = z.object({ externalId: z.string(), status: z.literal('archived') });
export type MerchantProductDeleteResponse = z.infer<typeof MerchantProductDeleteResponseSchema>;

// ---------------------------------------------------------------------------
// MERCHANT — usage, ledger, analytics
// ---------------------------------------------------------------------------

export const DateRangeQuerySchema = z
  .object({ from: dateOnly, to: dateOnly })
  .refine((r) => r.from <= r.to, { message: 'from must be <= to', path: ['to'] });
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

/** D17: one paid plan, `curtain` (USD 8.99 per month, flat). `free` = no active subscription. */
export const PLAN_NAMES = ['free', 'curtain'] as const;

/** GET /v1/merchant/usage?from&to */
export const UsageDaySchema = z.object({
  day: dateOnly,
  fitSessions: z.number().int().nonnegative(),
  heroRenders: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export const UsageResponseSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  days: z.array(UsageDaySchema),
  totals: z.object({
    fitSessions: z.number().int().nonnegative(),
    heroRenders: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  plan: z.object({
    name: z.enum(PLAN_NAMES),
    /** Monthly fair-use reference behind the daily cap (D7); not a billing quota under D17. */
    includedSessions: z.number().int().nonnegative(),
    /** Always 0 since D17 (no per-session charge); kept for older clients. */
    overageEurPerSession: z.number().nonnegative(),
    /** D17 list price in USD per month (0 without a subscription). */
    priceUsdPerMonth: z.number().nonnegative().optional(),
    /** The price the shop is charged and its currency, when a Shopify subscription recorded them. */
    chargePrice: z.number().nonnegative().optional(),
    chargeCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    /**
     * Set while the shop still pays through a retired pre-D17 subscription (`starter` / `pro`, at its
     * old price). The admin and the console then offer "Switch to Curtain" instead of "Subscribed";
     * `switchVia` says where: the Shopify approval screen or a Stripe Checkout (WooCommerce).
     */
    legacyPlan: z.string().min(1).max(32).optional(),
    switchVia: z.enum(['shopify', 'stripe']).optional(),
    periodStart: dateOnly,
    periodEnd: dateOnly,
    sessionsUsedThisPeriod: z.number().int().nonnegative(),
    paused: z.boolean(),
  }),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

/** GET /v1/merchant/ledger — what we sent to AI providers on behalf of this shop's try-ons. */
export const MerchantLedgerEntrySchema = z.object({
  id: uuid,
  at: isoDate,
  kind: z.literal('hero_render'),
  productExternalId: z.string(),
  provider: z.string(),
  model: z.string(),
  retentionHours: z.number().nonnegative(),
  /** Which inputs went to the provider: never a user photo. */
  inputs: z.array(z.enum(['avatarRender', 'flatLayPhoto', 'productPhoto', 'metadataPrompt'])),
});
export type MerchantLedgerEntry = z.infer<typeof MerchantLedgerEntrySchema>;

export const MerchantLedgerResponseSchema = z.object({
  entries: z.array(MerchantLedgerEntrySchema),
  nextCursor: cursor.nullable(),
});
export type MerchantLedgerResponse = z.infer<typeof MerchantLedgerResponseSchema>;

/** GET /v1/merchant/analytics/swipes?from&to — aggregates only, k-anonymity floor applied. */
const swipeCounts = z.object({
  love: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  save: z.number().int().nonnegative(),
  less: z.number().int().nonnegative(),
});
export const AnalyticsSwipesResponseSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  kAnonymityFloor: z.number().int().min(1),
  /** Groups below the floor are dropped and counted here. */
  suppressedGroups: z.number().int().nonnegative(),
  byProduct: z.array(
    swipeCounts.extend({
      externalId: z.string(),
      /** Size recommended at swipe time → count. */
      sizeHistogram: z.record(z.string(), z.number().int().nonnegative()),
      passReasons: z.record(z.string(), z.number().int().nonnegative()),
    }),
  ),
  byColour: z.array(swipeCounts.extend({ hue: z.string() })),
  byFabric: z.array(swipeCounts.extend({ fabric: z.string() })),
  bySize: z.array(swipeCounts.extend({ size: z.string() })),
});
export type AnalyticsSwipesResponse = z.infer<typeof AnalyticsSwipesResponseSchema>;

/** POST /v1/merchant/keys/rotate */
export const MerchantKeyRotateResponseSchema = z.object({
  /** Shown once. */
  apiKey: z.string().regex(/^sk_(live|test)_[A-Za-z0-9]{24,64}$/),
  publicKeyPrefix: z.string().regex(/^pk_(live|test)_[A-Za-z0-9]{6,32}$/),
  rotatedAt: isoDate,
  previousKeyValidUntil: isoDate,
});
export type MerchantKeyRotateResponse = z.infer<typeof MerchantKeyRotateResponseSchema>;

// ---------------------------------------------------------------------------
// Route table (documentation + typed client keys)
// ---------------------------------------------------------------------------

export const API_ROUTES = {
  deviceCreate: 'POST /v1/devices',
  deviceRotate: 'POST /v1/devices/rotate',
  signaturePut: 'PUT /v1/me/signature',
  meDelete: 'DELETE /v1/me',
  meExport: 'GET /v1/me/export',
  meLedger: 'GET /v1/me/ledger',
  tryResolve: 'GET /v1/try/:token',
  tryFitShown: 'POST /v1/try/:token/fit-shown',
  shopProducts: 'GET /v1/shops/:shopId/products',
  productGet: 'GET /v1/products/:id',
  swipesBatch: 'POST /v1/swipes',
  wardrobePut: 'PUT /v1/wardrobe/:productId',
  wardrobeList: 'GET /v1/wardrobe',
  renderHero: 'POST /v1/renders/hero',
  renderStatus: 'GET /v1/renders/:jobId',
  fitCohort: 'GET /v1/fit/cohort/:productId',
  sdkSessions: 'POST /v1/sdk/sessions',
  merchantProductUpsert: 'PUT /v1/merchant/products/:externalId',
  merchantProductValidate: 'POST /v1/merchant/products/validate',
  merchantProductDelete: 'DELETE /v1/merchant/products/:externalId',
  merchantProductsList: 'GET /v1/merchant/products',
  merchantUsage: 'GET /v1/merchant/usage',
  merchantLedger: 'GET /v1/merchant/ledger',
  merchantAnalyticsSwipes: 'GET /v1/merchant/analytics/swipes',
  merchantKeysRotate: 'POST /v1/merchant/keys/rotate',
  meSignatureDelete: 'DELETE /v1/me/signature',
  merchantUsageAnomalies: 'GET /v1/merchant/usage/anomalies',
  merchantAnalyticsFitSizes: 'GET /v1/merchant/analytics/fit-sizes',
  merchantAnalyticsAbandoned: 'GET /v1/merchant/analytics/abandoned',
  sdkMedia: 'GET /v1/sdk/media',
} as const;
export type ApiRouteKey = keyof typeof API_ROUTES;

// ---------------------------------------------------------------------------
// Billing integrity, scan delete, standalone analytics (carry-over #7, #9, #18, #19)
// ---------------------------------------------------------------------------

/** DELETE /v1/me/signature (device JWT) — "Delete my scan": removes only the fit signature row. */
export const SignatureDeleteResponseSchema = z.object({
  /** False when there was no signature on the server (the call is idempotent). */
  deleted: z.boolean(),
  ledgerEntryId: uuid,
  at: isoDate,
});
export type SignatureDeleteResponse = z.infer<typeof SignatureDeleteResponseSchema>;

/**
 * GET /v1/merchant/usage/anomalies?from&to — the merchant-visible billing anomaly signal.
 * `cap_reached`: fit sessions refused (not billed) because the shop's daily cap was full.
 * `spike`: a day's billed sessions above the anomaly threshold (factor × trailing daily average).
 */
export const BILLING_ANOMALY_KIND_NAMES = ['cap_reached', 'spike'] as const;
export const BillingAnomalySchema = z.object({
  day: dateOnly,
  kind: z.enum(BILLING_ANOMALY_KIND_NAMES),
  billedSessions: z.number().int().nonnegative(),
  deniedSessions: z.number().int().nonnegative(),
  threshold: z.number().int().nonnegative(),
  trailingAverage: z.number().nonnegative(),
  firstAt: isoDate,
  lastAt: isoDate,
});
export type BillingAnomaly = z.infer<typeof BillingAnomalySchema>;

export const BillingAnomaliesResponseSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  /** Billed fit sessions per UTC day above which nothing more is billed (derived from the plan). */
  dailyCap: z.number().int().positive(),
  today: z.object({
    day: dateOnly,
    billedSessions: z.number().int().nonnegative(),
    trailingAverage: z.number().nonnegative(),
    spikeThreshold: z.number().int().nonnegative(),
    capReached: z.boolean(),
    spike: z.boolean(),
  }),
  anomalies: z.array(BillingAnomalySchema),
});
export type BillingAnomaliesResponse = z.infer<typeof BillingAnomaliesResponseSchema>;

/**
 * GET /v1/merchant/analytics/fit-sizes?from&to — sizes recommended in standalone (on-page) fit
 * sessions. A size is reported only when at least `kAnonymityFloor` distinct shoppers got it;
 * `totals` cover the reported sizes only, so suppressed sizes cannot be derived by subtraction.
 */
export const AnalyticsFitSizesResponseSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  kAnonymityFloor: z.number().int().min(1),
  suppressedGroups: z.number().int().nonnegative(),
  bySize: z.array(z.object({ size: z.string(), sessions: z.number().int().nonnegative() })),
  totals: z.object({ sessions: z.number().int().nonnegative() }),
});
export type AnalyticsFitSizesResponse = z.infer<typeof AnalyticsFitSizesResponseSchema>;

/** GET /v1/merchant/analytics/abandoned?from&to — opens that never got a fit, k floor on distinct shoppers. */
export const AnalyticsAbandonedResponseSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  kAnonymityFloor: z.number().int().min(1),
  suppressedGroups: z.number().int().nonnegative(),
  totals: z.object({ sessions: z.number().int().nonnegative(), resolved: z.number().int().nonnegative(), withFit: z.number().int().nonnegative() }),
  byProduct: z.array(
    z.object({
      externalId: z.string(),
      sessions: z.number().int().nonnegative(),
      resolved: z.number().int().nonnegative(),
      withFit: z.number().int().nonnegative(),
      abandonedRate: z.number(),
    }),
  ),
});
export type AnalyticsAbandonedResponse = z.infer<typeof AnalyticsAbandonedResponseSchema>;
