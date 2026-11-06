/**
 * Postgres schema (docs/ARCHITECTURE.md "Postgres (Drizzle)", architecture-panel.md proposal 1
 * "Data model", adjusted by DECISIONS.md: per-(device, shop) pseudonym on pairings, try-on
 * session billing with intent tokens (D7), order_outcomes schema-only, webhook_log with payload.
 *
 * Privacy invariants: `fit_signatures.vector` is the ONLY body data on the server; no table holds
 * a photo, an e-mail, or an IP address. Merchant-facing queries never join on device_id — they go
 * through `pairings.pseudonym` or aggregates with the k-anonymity floor.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { GarmentPayloadDraft, LedgerEntry, PairingSource, SdkSurface } from '@curtain/schema';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

export const PLATFORMS = ['shopify', 'woocommerce'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLANS = ['free', 'starter', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export interface ShopSettings {
  brandColor?: string;
  logoUrl?: string;
  adsEnabled?: boolean;
  siteUrl?: string;
  /** Shopify: the storefront's primary domain host (e.g. `shop.example`), read at token exchange. */
  primaryDomain?: string;
  /**
   * Extra storefront origins the standalone embed may `postMessage` to (docs/STANDALONE.md §2),
   * e.g. a headless storefront. Exact origins (`https://shop.example`), set by the merchant.
   */
  embedOrigins?: string[];
  pluginVersion?: string;
  platformVersion?: string;
  /** Shopify: `gid://shopify/AppSubscription/…` usage line item for appUsageRecordCreate. */
  usageLineItemId?: string;
  /** Shopify: subscription status from app_subscriptions/update. */
  subscriptionStatus?: string;
  /** Stripe: customer id (the merchant identity for WooCommerce, D6). */
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  includedSessions?: number;
  overageEurPerSession?: number;
  /** Shopify: ISO 4217 currency the subscription is charged in (shopBillingPreferences at subscribe time). */
  billingCurrency?: string;
  /** Shopify: units of billingCurrency per 1 EUR, fixed for the running subscription. */
  billingEurRate?: number;
}

export const shops = pgTable(
  'shops',
  {
    id: id(),
    platform: text('platform').$type<Platform>().notNull(),
    domain: text('domain').notNull(),
    name: text('name').notNull(),
    /** `pk_live_…` — stable public prefix, used by the SDK; identifies the shop in PK-HMAC auth. */
    apiKeyPrefix: text('api_key_prefix'),
    /** scrypt hash of the secret `sk_…` key (Bearer auth). */
    apiKeyHash: text('api_key_hash'),
    /** AES-GCM copy of the secret (needed to verify HMAC signatures). */
    apiKeyEnc: text('api_key_enc'),
    /**
     * HMAC(pepper, secret) — an indexed, deterministic lookup so `Bearer sk_…` auth is one row
     * fetch + one scrypt instead of scrypt over every shop (unauthenticated CPU DoS otherwise).
     */
    apiKeyLookup: text('api_key_lookup'),
    previousKeyHash: text('previous_key_hash'),
    previousKeyEnc: text('previous_key_enc'),
    previousKeyLookup: text('previous_key_lookup'),
    previousKeyValidUntil: ts('previous_key_valid_until'),
    plan: text('plan').$type<Plan>().notNull().default('free'),
    paused: boolean('paused').notNull().default(false),
    /** Stripe subscription id or Shopify AppSubscription gid. */
    billingRef: text('billing_ref'),
    periodStart: date('period_start', { mode: 'string' }),
    settings: jsonb('settings').$type<ShopSettings>().notNull().default({}),
    /** WooCommerce Connect round-trip (D6). */
    connectTokenHash: text('connect_token_hash'),
    connectTokenExpiresAt: ts('connect_token_expires_at'),
    connectState: text('connect_state').$type<'pending' | 'paid' | 'manual' | 'complete'>(),
    installedAt: ts('installed_at').notNull().defaultNow(),
    uninstalledAt: ts('uninstalled_at'),
    purgeAfter: ts('purge_after'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shops_domain_uq').on(t.domain),
    uniqueIndex('shops_api_key_prefix_uq').on(t.apiKeyPrefix),
    index('shops_api_key_lookup_idx').on(t.apiKeyLookup),
    index('shops_previous_key_lookup_idx').on(t.previousKeyLookup),
  ],
);

export const shopifySessions = pgTable('shopify_sessions', {
  id: text('id').primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  shopDomain: text('shop_domain').notNull(),
  /** AES-GCM encrypted offline access token. */
  accessTokenEnc: text('access_token_enc').notNull(),
  scope: text('scope'),
  isOnline: boolean('is_online').notNull().default(false),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const PRODUCT_STATUS = ['active', 'incomplete', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[number];

export const products = pgTable(
  'products',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    handle: text('handle'),
    payload: jsonb('payload').$type<GarmentPayloadDraft>().notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    category: text('category'),
    priceEur: doublePrecision('price_eur'),
    primaryColorHex: text('primary_color_hex'),
    status: text('status').$type<ProductStatus>().notNull().default('incomplete'),
    score: real('score').notNull().default(0),
    missingFields: text('missing_fields').array().notNull().default(sql`'{}'::text[]`),
    contentHash: text('content_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    uniqueIndex('products_shop_external_uq').on(t.shopId, t.externalId),
    index('products_shop_status_idx').on(t.shopId, t.status),
    index('products_payload_gin').using('gin', t.payload),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'flat_lay' | 'product'>().notNull(),
    url: text('url').notNull(),
    width: integer('width'),
    height: integer('height'),
    processedUrl: text('processed_url'),
    processedAt: ts('processed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('product_images_product_idx').on(t.productId)],
);

export const devices = pgTable('devices', {
  id: id(),
  tokenVersion: integer('token_version').notNull().default(0),
  platform: text('platform').$type<'web' | 'ios' | 'android'>().notNull(),
  appVersion: text('app_version').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
});

export const fitSignatures = pgTable('fit_signatures', {
  deviceId: uuid('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  vector: real('vector').array().notNull(),
  quality: real('quality').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const pairings = pgTable(
  'pairings',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** HMAC(pepper, device + shop): what the merchant side sees instead of a device id. */
    pseudonym: text('pseudonym').notNull(),
    source: text('source').$type<PairingSource>().notNull().default('link'),
    pairedAt: ts('paired_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.shopId] }), index('pairings_shop_pseudonym_idx').on(t.shopId, t.pseudonym)],
);

export const trySessions = pgTable(
  'try_sessions',
  {
    id: id(),
    tokenJti: text('token_jti').notNull(),
    /** Idempotency token of the billable fit session (D7); handed to the app on resolve. */
    intentToken: text('intent_token').notNull(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    surface: text('surface').$type<SdkSurface>().notNull().default('button'),
    /**
     * Origin (scheme + host + port, never path or query) of the merchant page that opened the
     * session. Only used to extend the embed's postMessage targets when it belongs to the shop.
     */
    pageOrigin: text('page_origin'),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    resolvedAt: ts('resolved_at'),
    /** Set when the first swipe with a fit result arrived — the session became billable. */
    billedAt: ts('billed_at'),
    /** Standalone embed (POST /v1/try/:token/fit-shown): size label + confidence only, never measurements. */
    fitShownAt: ts('fit_shown_at'),
    recommendedSize: text('recommended_size'),
    fitConfidence: real('fit_confidence'),
  },
  (t) => [
    uniqueIndex('try_sessions_jti_uq').on(t.tokenJti),
    uniqueIndex('try_sessions_intent_uq').on(t.intentToken),
    index('try_sessions_shop_created_idx').on(t.shopId, t.createdAt),
  ],
);

export const swipeEvents = pgTable(
  'swipe_events',
  {
    id: id(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** GarmentPayload.id (shop-scoped external id). */
    itemId: text('item_id').notNull(),
    clientId: text('client_id').notNull(),
    action: text('action').$type<'love' | 'pass' | 'save' | 'less'>().notNull(),
    sizeRecommended: text('size_recommended'),
    fitScore: real('fit_score'),
    reasons: text('reasons').array(),
    dealIndex: integer('deal_index').notNull().default(0),
    at: ts('at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('swipe_events_device_client_uq').on(t.deviceId, t.clientId),
    index('swipe_events_shop_at_idx').on(t.shopId, t.at),
    index('swipe_events_device_idx').on(t.deviceId),
  ],
);

export const wardrobeItems = pgTable(
  'wardrobe_items',
  {
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    size: text('size').notNull(),
    state: text('state').$type<'saved' | 'bought' | 'kept' | 'returned'>().notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.shopId, t.productId] }), index('wardrobe_product_idx').on(t.productId)],
);

export const USAGE_KINDS = ['fit_session', 'hero_render'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    kind: text('kind').$type<UsageKind>().notNull(),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    /** `intent:<token>` for deep-link sessions, `deck:<device>:<product>:<day>` for deck swipes. */
    idempotencyKey: text('idempotency_key').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('usage_events_idem_uq').on(t.idempotencyKey), index('usage_events_shop_at_idx').on(t.shopId, t.at)],
);

export const usageDaily = pgTable(
  'usage_daily',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    fitSessions: integer('fit_sessions').notNull().default(0),
    heroRenders: integer('hero_renders').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    /** When the nightly rollup pushed this day to Shopify appUsageRecordCreate / Stripe meter. */
    pushedAt: ts('pushed_at'),
    pushedSessions: integer('pushed_sessions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.day] })],
);

/** Kinds of billing anomaly (carry-over #7); mirrored by `BILLING_ANOMALY_KIND_NAMES` in @curtain/schema. */
export const BILLING_ANOMALY_KINDS = ['cap_reached', 'spike'] as const;
export type BillingAnomalyKind = (typeof BILLING_ANOMALY_KINDS)[number];

/**
 * One row per shop, UTC day and kind (migration 0003). Shop-level counters only: no device id,
 * no product, no size (D3). `cap_reached`: sessions refused because the day's cap was full
 * (`denied_sessions`). `spike`: the day's billed sessions went above the anomaly threshold.
 * Written by services/usage.ts (`checkDailyCap`, `noteBilled`).
 */
export const billingAnomalies = pgTable(
  'billing_anomalies',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    kind: text('kind').$type<BillingAnomalyKind>().notNull(),
    billedSessions: integer('billed_sessions').notNull().default(0),
    deniedSessions: integer('denied_sessions').notNull().default(0),
    threshold: integer('threshold').notNull().default(0),
    trailingAverage: real('trailing_average').notNull().default(0),
    firstAt: ts('first_at').notNull().defaultNow(),
    lastAt: ts('last_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.day, t.kind] })],
);
export type BillingAnomalyRow = typeof billingAnomalies.$inferSelect;

export const RENDER_STATUS = ['queued', 'running', 'done', 'failed', 'expired'] as const;
export type RenderStatus = (typeof RENDER_STATUS)[number];

export const renderJobs = pgTable(
  'render_jobs',
  {
    id: id(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    size: text('size').notNull(),
    tier: text('tier').$type<'heroOptIn'>().notNull().default('heroOptIn'),
    consentAcknowledgedAt: ts('consent_acknowledged_at').notNull(),
    videoSeconds: integer('video_seconds'),
    provider: text('provider'),
    model: text('model'),
    status: text('status').$type<RenderStatus>().notNull().default('queued'),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms'),
    /** Local volume paths (RENDERS_DIR); deleted after RENDER_RETENTION_HOURS. */
    personPath: text('person_path'),
    resultPath: text('result_path'),
    videoPath: text('video_path'),
    retentionHours: real('retention_hours').notNull().default(24),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('render_jobs_device_idx').on(t.deviceId), index('render_jobs_expires_idx').on(t.expiresAt)],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'set null' }),
    /** For the merchant ledger view (hero renders only); never joined back to the device for merchants. */
    productExternalId: text('product_external_id'),
    kind: text('kind').$type<LedgerEntry['kind']>().notNull(),
    payloadSummary: jsonb('payload_summary').$type<LedgerEntry['payloadSummary']>().notNull(),
    inputs: text('inputs').array(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('ledger_device_at_idx').on(t.deviceId, t.at), index('ledger_shop_kind_idx').on(t.shopId, t.kind, t.at)],
);

export const webhookLog = pgTable(
  'webhook_log',
  {
    id: id(),
    platform: text('platform').$type<Platform | 'stripe'>().notNull(),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'set null' }),
    shopDomain: text('shop_domain'),
    topic: text('topic').notNull(),
    externalId: text('external_id'),
    /** Provider event id (X-Shopify-Webhook-Id / Stripe event id) for idempotency. */
    eventId: text('event_id'),
    /** Full payload kept for replay. Shopify customer PII never arrives (we hold none; GDPR topics are no-op). */
    payload: jsonb('payload').$type<unknown>().notNull(),
    status: text('status').$type<'received' | 'processed' | 'failed' | 'ignored' | 'duplicate'>().notNull().default('received'),
    error: text('error'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [uniqueIndex('webhook_log_event_uq').on(t.platform, t.eventId), index('webhook_log_shop_topic_idx').on(t.shopId, t.topic)],
);

/**
 * Order attribution (D7) — schema only, OFF by default. If enabled later: HMAC of the order id,
 * no customer fields, never per-session size/score back to the merchant page.
 */
export const orderOutcomes = pgTable(
  'order_outcomes',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    orderIdHmac: text('order_id_hmac').notNull(),
    size: text('size'),
    outcome: text('outcome').$type<'ordered' | 'kept' | 'returned'>().notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('order_outcomes_uq').on(t.shopId, t.orderIdHmac, t.productId)],
);

export const schema = {
  shops,
  shopifySessions,
  products,
  productImages,
  devices,
  fitSignatures,
  pairings,
  trySessions,
  swipeEvents,
  wardrobeItems,
  usageEvents,
  usageDaily,
  billingAnomalies,
  renderJobs,
  ledgerEntries,
  webhookLog,
  orderOutcomes,
};
export type Schema = typeof schema;
