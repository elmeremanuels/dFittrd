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
import { GarmentAssetRefSchema } from './garmentAsset';
import { AUDIENCE_SOURCES } from './mappings/audience';
import { garmentTapeChartIssues } from './garmentTapeForm';
import { IncompleteProductDataSchema, ProductHeldBackSchema, ProductNoticesSchema } from './incompleteData';
import { PRODUCT_NEXT_STEPS, SETUP_STEPS, SETUP_TARGETS } from './merchantSetup';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const ESTIMATE_DISCLAIMER = 'Estimate — generated from your measurements and the shop’s garment data, not a photo of you.';

/**
 * D20 point 3 (men's gate, plan slice M0): the error code of a men's product that is not ready for
 * the full 3D experience. `GET /v1/try/:token`, `GET /v1/products/:id` and `POST /v1/renders/hero`
 * answer 422 with this code and no product data; the embed shows "Men's clothing: coming soon".
 */
export const MEN_COMING_SOON_CODE = 'men_coming_soon';

/** What a shopper gets for a product. Absent on the wire means `ready` (today's flow). */
export const PRODUCT_SHOPPER_STATES = ['coming_soon'] as const;
export const ProductShopperStateSchema = z.enum(PRODUCT_SHOPPER_STATES);
export type ProductShopperState = z.infer<typeof ProductShopperStateSchema>;

/**
 * The men's gate as the merchant sees it per product. `coming_soon`: shoppers see "Men's clothing:
 * coming soon" until the product has an approved 3D bundle on the male body and the shop has the 3D
 * estimate on. `audience_unconfirmed`: the audience `men` was guessed from a title or a collection
 * only, or its source is unknown (not synced since the gate, or sent without `audienceSource`), so
 * the product is not gated until the merchant sets the audience or the next sync reports a strong source.
 */
export const MERCHANT_MEN_GATE_STATES = ['coming_soon', 'audience_unconfirmed'] as const;

const uuid = z.uuid();
const isoDate = z.iso.datetime({ offset: true });
const dateOnly = z.iso.date();
/** A calendar month in UTC, `YYYY-MM` (merchant analytics periods, cohort months). */
export const analyticsMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a calendar month, YYYY-MM');
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
  /** Below plan → the app shows the "shop paused" screen (D7; the button on the shop page is hidden, D25 point 5). */
  paused: z.boolean().default(false),
  /**
   * D25 point 7: `true` only when the shop switched "Show 'Fit by Curtain'" off. The embed then
   * leaves the wordmark out. The estimate label is not part of it and always stays (AGENTS.md
   * rule 3). Absent: the wordmark is shown.
   */
  hideWordmark: z.literal(true).optional(),
});
export type ShopBranding = z.infer<typeof ShopBrandingSchema>;

/** GET /v1/try/:token */
export const TryResolveParamsSchema = z.object({ token: z.string().min(16).max(4096) });
/**
 * Men's gate (D20 point 3): the capability a client names on `GET /v1/try/:token?caps=requires3d`
 * to say it enforces `requires3d` (the result is shown only with the working 3D view, else the
 * coming-soon screen). Without it a product that needs the rule answers 422 `men_coming_soon`, so
 * an embed build from before the rule never draws the 2D figure for it.
 */
export const TRY_CAP_REQUIRES_3D = 'requires3d';
/** `caps`: comma-separated capability names; unknown names are ignored. */
export const TryResolveQuerySchema = z.object({ caps: z.string().max(128).optional() });
export type TryResolveQuery = z.infer<typeof TryResolveQuerySchema>;
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
  /**
   * The product's approved 3D bundle (D13, D16), only when the shop has the 3D estimate switched on
   * and the bundle still matches the live chart. Absent or null: the overlay behaves as before.
   * Optional so older embeds keep parsing.
   */
  asset: GarmentAssetRefSchema.nullable().optional(),
  /**
   * D20 point 3 (men's gate, plan slice M0): `true` only for a men's product that passed the gate.
   * The embed may show it only with the working 3D view: when `asset` is missing or the 3D view
   * fails on the device, it shows "Men's clothing: coming soon" with no figure and no size. Absent
   * for every other product (and whenever the gate is off): the overlay behaves as before.
   */
  requires3d: z.literal(true).optional(),
  /**
   * D22 (AI realism layer): `true` only when the server flag `AI_REALISM` is on and the product has
   * a 3D asset. The embed then offers the "AI-enhanced estimate" next to the 3D view. Absent: nothing changes.
   */
  aiRealism: z.literal(true).optional(),
  /**
   * `true` only when the shop gave no fabric stretch for this product (not an accessory), so size
   * advice assumes 0 % (`sizeAdviceGarment`'s `defaulted`). The embed then says in one line that
   * stretch was not taken into account. Absent: the stretch comes from the shop.
   */
  stretchAssumed: z.literal(true).optional(),
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
  /** People counted in the months shown (a month below the floor is left out entirely). */
  n: z.number().int().nonnegative(),
  kAnonymityFloor: z.number().int().min(1),
  /** Sizes that clear the floor; empty when no month clears it. */
  sizeHistogram: z.record(z.string(), z.number().int().nonnegative()),
  keptRate: z.number().min(0).max(1).nullable(),
  /**
   * Last calendar month counted (UTC). The cohort is a sum of whole closed months, each frozen once counted and each
   * shown only when it clears the floor, so it never changes by fewer than `kAnonymityFloor` people. Null when no
   * month is closed yet. Optional for older servers.
   */
  through: analyticsMonth.nullable().optional(),
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

/**
 * GET /v1/sdk/shop?shop=<public key prefix> (public, CORS *, cacheable for a minute). The SDK asks
 * this before it shows a button: a shop whose plan is paused shows no button (D25 point 5).
 */
export const SdkShopStatusQuerySchema = z.object({ shop: z.string().regex(/^pk_(live|test)_[A-Za-z0-9]{6,32}$/) });
export const SdkShopStatusResponseSchema = z.object({ paused: z.boolean() });
export type SdkShopStatusResponse = z.infer<typeof SdkShopStatusResponseSchema>;

export const SdkSessionResponseSchema = z.object({
  /** https://app.<domain>/try/<jwt 10 min> */
  tryUrl: httpUrl,
  /** `${PUBLIC_APP_URL}/embed/<token>`: the iframe of the standalone overlay. On every response. */
  embedUrl: httpUrl,
  /** Inline SVG for the desktop QR modal (app mode). Omitted for `surface: 'embed'`. */
  qrSvg: z.string().min(1).optional(),
  expiresAt: isoDate,
  /** Below plan. The SDK then hides the button and opens nothing (D25 point 5, which changes D7). */
  shopPaused: z.boolean(),
  /**
   * D20 point 3 (men's gate, plan slice M0): `coming_soon` for a men's product without the full 3D
   * experience. The session is still minted and the overlay shows "Men's clothing: coming soon";
   * the SDK may act on this later (slice M0b: the line in place of the button). Absent: ready.
   */
  productState: ProductShopperStateSchema.optional(),
});
export type SdkSessionResponse = z.infer<typeof SdkSessionResponseSchema>;

// ---------------------------------------------------------------------------
// MERCHANT — products
// ---------------------------------------------------------------------------

export const MerchantProductParamsSchema = z.object({ externalId: z.string().min(1).max(128) });

/**
 * PUT /v1/merchant/products/:externalId?audienceSource= — where the caller read the payload's
 * `audience` from (`AUDIENCE_SOURCES`), when it knows (the WooCommerce plugin infers the audience
 * itself). Kept next to the product, not in the payload. The men's gate only gates a men's
 * product on a known strong source; without this the audience stays unconfirmed.
 */
export const MerchantProductUpsertQuerySchema = z.object({ audienceSource: z.enum(AUDIENCE_SOURCES).optional() });
export type MerchantProductUpsertQuery = z.infer<typeof MerchantProductUpsertQuerySchema>;

/**
 * PUT /v1/merchant/products/:externalId — accepts a draft; the server computes completeness.
 *
 * The fabric is taken as it comes: a part that is present but not valid (stretch 150) does not fail
 * the request. The server leaves that part out, keeps the rest and reports it (`notices.leftOut`,
 * D25 point 1). Every other field is validated as `GarmentPayloadDraftSchema` does.
 */
export const MerchantProductUpsertRequestSchema = GarmentPayloadDraftSchema.extend({
  fabric: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Fabric (see GarmentPayload.fabric). Every part is optional; a part that is not valid is left out and reported in notices.leftOut.'),
});
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
  /** What was assumed and what was left out (incompleteData.ts). Both lists are empty for a complete product. Absent on an older api. */
  notices: ProductNoticesSchema.optional(),
  /**
   * Set when the shop holds products with incomplete data back (`incompleteProductData: 'hold-back'`):
   * the product was stored (this is a 200) but is not ready, `status` is `incomplete`, and shoppers
   * do not get it until `fields` are completed. Null otherwise. Absent on an older api.
   */
  heldBack: ProductHeldBackSchema.nullable().optional(),
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
  // The merchant PUT refuses these with 422 invalid_garment_tape; the dry run must not call them fine.
  // Checked on the draft shape, as the PUT does (it takes a draft): a missing chart is both a schema issue and this one.
  const draft = GarmentPayloadDraftSchema.safeParse(payload);
  if (draft.success) for (const message of garmentTapeChartIssues(draft.data)) issues.push({ path: 'garmentTape', message });
  return { valid: parsed.success && issues.length === 0, issues, completeness: completenessScore(payload) };
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
  /** The men's gate for this product (`MERCHANT_MEN_GATE_STATES`). Absent: not a gated men's product, or the gate is off. */
  menGate: z.enum(MERCHANT_MEN_GATE_STATES).optional(),
  /** The product is held back for incomplete data (shop setting `hold-back`). Absent: it is not. */
  heldBack: ProductHeldBackSchema.optional(),
  /**
   * What the last save assumed and left out for this product (D25 point 1): `defaulted` as size
   * advice reads the stored product now, `leftOut` as recorded at the last save. Absent on an older api.
   */
  notices: ProductNoticesSchema.optional(),
  /** The shop measured at least one size of this garment itself (garment tape with a `measured` value). Absent on an older api. */
  measured: z.boolean().optional(),
  /** What the merchant should do next for this product, in plain words (`productNextStep`). Absent on an older api. */
  next: z
    .object({ key: z.enum(PRODUCT_NEXT_STEPS), badge: z.string(), tone: z.enum(['critical', 'warning', 'success']), text: z.string(), action: z.string().nullable(), sizeAdvice: z.boolean() })
    .optional(),
  /** 0 to 100: how good the size advice for this product can be (`sizeAdviceScore`; leaves out what only the 3D view uses). */
  adviceScore: z.number().int().min(0).max(100).optional(),
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

/**
 * Merchant analytics periods (launch-readiness finding 1): one calendar month in UTC, `YYYY-MM`. Analytics never take
 * an arbitrary from/to. Months are disjoint, so no two allowed queries overlap; a month is served only once it is over
 * (plus `ANALYTICS_PERIOD_GRACE_HOURS`), and the first answer for a closed month is frozen, so asking again later can
 * never show a difference of a few shoppers.
 */
export const ANALYTICS_PERIOD_GRANULARITY = 'month' as const;
export const ANALYTICS_PERIOD_GRACE_HOURS = 24;
export const AnalyticsPeriodQuerySchema = z.object({ period: analyticsMonth }).strict();
export type AnalyticsPeriodQuery = z.infer<typeof AnalyticsPeriodQuerySchema>;

/**
 * Why groups are hidden. `belowFloor`: fewer than `kAnonymityFloor` distinct shoppers. `complementary`: enough
 * shoppers, but hidden as well so the small hidden groups cannot be worked out by subtracting the shown rows from a
 * total (the hidden rows together always hold at least `kAnonymityFloor` shoppers, or there are none).
 */
export const AnalyticsSuppressionSchema = z.object({ belowFloor: z.number().int().nonnegative(), complementary: z.number().int().nonnegative() });
export type AnalyticsSuppression = z.infer<typeof AnalyticsSuppressionSchema>;

const analyticsPeriodFields = {
  /** The calendar month (UTC) these aggregates cover. */
  period: analyticsMonth,
  /** First and last day of `period`, for display. */
  from: dateOnly,
  to: dateOnly,
  kAnonymityFloor: z.number().int().min(1),
  /** Hidden groups (rows and size buckets), `suppression.belowFloor + suppression.complementary`. */
  suppressedGroups: z.number().int().nonnegative(),
  suppression: AnalyticsSuppressionSchema,
};

/** GET /v1/merchant/analytics/periods — the closed months a merchant can ask for, newest first. */
export const AnalyticsPeriodsResponseSchema = z.object({
  granularity: z.literal(ANALYTICS_PERIOD_GRANULARITY),
  kAnonymityFloor: z.number().int().min(1),
  /** Closed months, newest first (at most 24). Empty until the shop's first month is over. */
  periods: z.array(analyticsMonth),
  /** The month in progress: never served, it is still changing. */
  openPeriod: analyticsMonth,
  /** When `openPeriod` becomes available. */
  openPeriodAvailableAt: isoDate,
});
export type AnalyticsPeriodsResponse = z.infer<typeof AnalyticsPeriodsResponseSchema>;

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

/**
 * GET /v1/merchant/analytics/swipes?period=YYYY-MM — aggregates only, k-anonymity floor applied with complementary
 * suppression. Products are the base table (each product's size histogram nested in it); colour, fabric and size
 * are sums of the shown products and shown size buckets only, so they never contain a hidden product.
 */
const swipeCounts = z.object({
  love: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  save: z.number().int().nonnegative(),
  less: z.number().int().nonnegative(),
});
export const AnalyticsSwipesResponseSchema = z.object({
  ...analyticsPeriodFields,
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
  merchantAnalyticsPeriods: 'GET /v1/merchant/analytics/periods',
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
 * GET /v1/merchant/analytics/fit-sizes?period=YYYY-MM — sizes recommended in standalone (on-page) fit
 * sessions. A size is reported only when at least `kAnonymityFloor` distinct shoppers got it, and the
 * hidden sizes together hold at least that many shoppers (complementary suppression), so a total from
 * elsewhere (the usage page) minus the shown sizes is never a group below the floor. `totals` cover the
 * reported sizes only.
 */
export const AnalyticsFitSizesResponseSchema = z.object({
  ...analyticsPeriodFields,
  bySize: z.array(z.object({ size: z.string(), sessions: z.number().int().nonnegative() })),
  totals: z.object({ sessions: z.number().int().nonnegative() }),
});
export type AnalyticsFitSizesResponse = z.infer<typeof AnalyticsFitSizesResponseSchema>;

/**
 * GET /v1/merchant/analytics/abandoned?period=YYYY-MM — opens that never got a fit, k floor on distinct shoppers
 * with complementary suppression; `totals` cover the reported products only.
 */
export const AnalyticsAbandonedResponseSchema = z.object({
  ...analyticsPeriodFields,
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

// ---- AI realism layer (D22, docs/research/ai-realism-layer.md) -------------------------------

/** Label code of every AI-enhanced image (hard rule 3); the words live in the client catalogues (D21). */
export const AI_ENHANCED_LABEL = 'ai-enhanced-estimate' as const;

const pngBase64 = z.string().min(16).max(4 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'base64 PNG');

/**
 * POST /v1/renders/realism. The 3D view's render passes (packages/garment-viewer `exportPasses`)
 * and nothing else: there is no person, photo or face field, and unknown keys are refused
 * (`strictObject`), so a photo cannot ride along under another name (AGENTS.md hard rule 1).
 */
export const RealismRequestSchema = z.strictObject({
  productId: z.string().min(1).max(128),
  shopId: uuid,
  size: z.string().min(1).max(16),
  passes: z.strictObject({
    kind: z.literal('renderPasses'),
    width: z.number().int().min(256).max(1024),
    height: z.number().int().min(256).max(1536),
    colourPng: pngBase64,
    depthPng: pngBase64,
    normalPng: pngBase64,
    garmentMaskPng: pngBase64,
    figureMaskPng: pngBase64,
    neighbour: z.strictObject({ size: z.string().min(1).max(16), garmentMaskPng: pngBase64 }).optional(),
    meta: z.strictObject({
      statureCm: z.number().min(50).max(250),
      waistRow: z.number().int().min(0).max(1536),
      hipRow: z.number().int().min(0).max(1536),
      backdropHex: HexColorSchema,
      garmentHex: HexColorSchema,
    }),
  }),
  consent: z.strictObject({ tier: z.literal('heroOptIn'), ack: z.literal(true), acknowledgedAt: isoDate }),
});
export type RealismRequest = z.infer<typeof RealismRequestSchema>;

export const REALISM_REFUSAL_REASONS = ['not_a_render', 'dimensions', 'unverifiable', 'silhouette', 'garment_outline', 'colour', 'hem', 'waist', 'width', 'size_difference', 'provider'] as const;
export type RealismRefusalReason = (typeof REALISM_REFUSAL_REASONS)[number];

export const RealismMetricsSchema = z.object({
  silhouetteIoU: z.number(),
  garmentIoU: z.number(),
  colourDeltaE00: z.number(),
  hemShiftCm: z.number(),
  waistShiftCm: z.number(),
  waistWidthDeltaCm: z.number(),
  hipWidthDeltaCm: z.number(),
  sizeSeparation: z.object({ neighbour: z.string(), visible: z.boolean(), ok: z.boolean() }).nullable(),
});
export type RealismMetrics = z.infer<typeof RealismMetricsSchema>;

/** 200 from POST /v1/renders/realism: the checked image inline (nothing is stored), or a refusal. Always labelled. */
export const RealismResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    mimeType: z.literal('image/png'),
    imageBase64: z.string().min(16),
    width: z.number().int(),
    height: z.number().int(),
    label: z.literal(AI_ENHANCED_LABEL),
    disclaimer: z.string().min(1),
    provider: z.string().max(64),
    model: z.string().max(64),
    metrics: RealismMetricsSchema,
  }),
  z.object({
    status: z.literal('refused'),
    reasons: z.array(z.enum(REALISM_REFUSAL_REASONS)).min(1),
    label: z.literal(AI_ENHANCED_LABEL),
    disclaimer: z.string().min(1),
    metrics: RealismMetricsSchema.nullable(),
  }),
]);
export type RealismResponse = z.infer<typeof RealismResponseSchema>;

// ---------------------------------------------------------------------------
// MERCHANT — first-run checklist (merchantSetup.ts)
// ---------------------------------------------------------------------------

export const SetupStepSchema = z.object({
  key: z.enum(SETUP_STEPS),
  number: z.number().int().min(1).max(5),
  title: z.string(),
  done: z.boolean(),
  detail: z.string(),
  action: z.object({ label: z.string(), target: z.enum(SETUP_TARGETS) }).nullable(),
  confirmLabel: z.string().nullable(),
  minutes: z.number(),
});

/** A product page to open on a phone for step 5: the first product that gives a size. */
export const SetupPhoneCheckSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  /** The storefront product page (https only). */
  url: z.string(),
  /** Inline SVG QR code of `url`, generated by the api (no third party). */
  qrSvg: z.string(),
});

/** GET /v1/merchant/setup (and the `setup` part of GET /shopify/charts/onboarding). */
export const SetupResponseSchema = z.object({
  steps: z.array(SetupStepSchema),
  next: z.enum(SETUP_STEPS).nullable(),
  doneCount: z.number().int(),
  total: z.number().int(),
  headline: z.string(),
  platform: z.enum(['shopify', 'woocommerce']),
  /** The first product to open for "measure one skirt": a skirt (bottom) with a chart, else any product with a chart. */
  measureProduct: z.object({ externalId: z.string(), name: z.string() }).nullable(),
  phoneCheck: SetupPhoneCheckSchema.nullable(),
});
export type SetupResponse = z.infer<typeof SetupResponseSchema>;

/** PUT /v1/merchant/setup: tick steps 4 and 5 by hand (the api cannot look inside a theme or a phone). */
export const SetupUpdateRequestSchema = z.object({ buttonConfirmed: z.boolean().optional(), phoneConfirmed: z.boolean().optional() });

// ---------------------------------------------------------------------------
// MERCHANT — settings (D24; merchant-settings inventory row S2)
// ---------------------------------------------------------------------------

/**
 * GET /v1/merchant/settings — the merchant's own choices. A fixed list of keys: billing and
 * operator values in the shop's stored settings are not part of it and cannot be read or written here.
 */
export const MerchantSettingsResponseSchema = z.object({
  /** What happens with a product whose data is incomplete (incompleteData.ts). Default `let-through`. */
  incompleteProductData: IncompleteProductDataSchema,
  /** D25 point 7: the "Fit by Curtain" wordmark in the popup. Default on. Never the estimate label (rule 3). Optional so a console still reads an older api. */
  showFitByCurtain: z.boolean().optional(),
  /** Read-only here: the name comes from the shop platform (the plugin's hello, the Shopify install). */
  shopName: z.string().optional(),
  platform: z.enum(['shopify', 'woocommerce']).optional(),
  /** The shop's colour in the popup header; null when none is set. */
  brandColor: HexColorSchema.nullable().optional(),
  /** The shop's logo; null when none is set. Stored, not drawn in the popup yet (inventory row S16). */
  logoUrl: httpUrl.nullable().optional(),
});
export type MerchantSettingsResponse = z.infer<typeof MerchantSettingsResponseSchema>;

/** PUT /v1/merchant/settings — only the keys named here; an unknown key is refused. Left-out keys keep their value. */
export const MerchantSettingsUpdateRequestSchema = z.strictObject({
  incompleteProductData: IncompleteProductDataSchema.optional(),
  showFitByCurtain: z.boolean().optional(),
  /** `null` removes the colour. */
  brandColor: HexColorSchema.nullable().optional(),
  /** `null` removes the logo. https only: the popup's page is https. */
  logoUrl: z.url({ protocol: /^https$/ }).max(2048).nullable().optional(),
});
export type MerchantSettingsUpdateRequest = z.infer<typeof MerchantSettingsUpdateRequestSchema>;
