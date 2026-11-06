/**
 * Environment — the ONLY place secrets are read (AGENTS.md hard rule 2, DECISIONS.md D3).
 *
 * Every other module receives an `Env` object; nothing else touches `process.env`. In
 * production every secret must be set; in development/test, missing secrets fall back to
 * deterministic dev values so `pnpm dev` and the test-suite run without a .env file.
 */
import { randomBytes } from 'node:crypto';
import { DEFAULT_API_VERSION as SHOPIFY_DEFAULT_API_VERSION } from '@curtain/shopify-app';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Log client IPs (default off: the privacy architecture keeps no IP past the 7-day docker log rotation). */
  LOG_IPS: bool.default(false),
  /** `1` turns this replica into a jobs-only worker (no HTTP listener). `0` disables jobs in this process. */
  JOBS: z.enum(['0', '1', 'both']).default('both'),

  DATABASE_URL: z.string().default('postgres://curtain:curtain@localhost:5432/curtain'),

  /** Public origins — used for deep links, signed render URLs and CORS. */
  PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.url().default('http://localhost:3001'),
  /** Extra CORS origins for /v1 app routes (the SDK route is always `*`). */
  CORS_ORIGINS: csv,

  // ---- secrets -------------------------------------------------------------------------
  /** HS256 key for device JWTs, try tokens and signed render URLs (≥ 32 chars). */
  JWT_SECRET: optionalSecret,
  /** Pepper for per-(device, shop) pseudonyms and merchant key hashing. */
  SHOP_KEY_PEPPER: optionalSecret,
  /** 32-byte hex key (64 chars) for AES-256-GCM at rest: Shopify access tokens, merchant HMAC secrets. */
  ENCRYPTION_KEY: optionalSecret,

  // ---- product knobs -------------------------------------------------------------------
  K_ANON: z.coerce.number().int().min(1).default(5),
  DEVICE_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TRY_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(600),
  SDK_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  /** GET /v1/try/:token and POST /v1/try/:token/fit-shown, per client IP per minute (SEC-1). */
  TRY_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(60),
  /**
   * Anomaly cap: at most this many standalone (fit-shown) sessions are billed per shop per UTC day.
   * Above it fit-shown still answers 200 with `billed: false` and logs a warning (SEC-1).
   */
  EMBED_BILLED_SESSIONS_PER_DAY: z.coerce.number().int().min(1).default(5000),
  /** Optional absolute path to sdk.v1.js; default resolves @curtain/sdk from node_modules. */
  SDK_FILE: z.string().optional(),

  // ---- renders ------------------------------------------------------------------------
  RENDERS_DIR: z.string().default('./data/renders'),
  RENDER_RETENTION_HOURS: z.coerce.number().min(1).max(24).default(24),
  TRYON_ORDER: z.string().default('mock'),
  TRYON_MAX_COST_USD: z.coerce.number().nonnegative().default(0.5),
  TRYON_DAILY_CAP_USD: z.coerce.number().nonnegative().default(25),
  TRYON_REQUIRE_EU: bool.default(false),
  FASHN_API_KEY: optionalSecret,
  FASHN_EU_RESIDENCY_CONFIRMED: bool.default(false),
  VERTEX_TRYON_ENABLED: bool.default(false),
  VERTEX_PROJECT: z.string().optional(),
  VERTEX_LOCATION: z.string().default('europe-west4'),
  /** Static OAuth2 token for dev; in production the GCE metadata server is used. */
  VERTEX_ACCESS_TOKEN: optionalSecret,
  XAI_API_KEY: optionalSecret,
  XAI_ZDR: bool.default(false),

  // ---- Shopify -------------------------------------------------------------------------
  SHOPIFY_API_KEY: optionalSecret,
  SHOPIFY_API_SECRET: optionalSecret,
  /** Admin API version; the default is the one pinned constant in @curtain/shopify-app (2026-10, #4). */
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/).default(SHOPIFY_DEFAULT_API_VERSION),
  SHOPIFY_SCOPES: z.string().default('read_products,write_products'),
  /** The app's handle (shopify.app.toml `handle`): /shopify/auth/callback redirects to admin.shopify.com/store/<s>/apps/<handle>. */
  SHOPIFY_APP_HANDLE: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).default('curtain'),
  /** GraphQL endpoint template for tests/mocks; `{shop}` is replaced by the shop domain. */
  SHOPIFY_ADMIN_URL_TEMPLATE: z.string().default('https://{shop}/admin/api/{version}/graphql.json'),

  // ---- Stripe (WooCommerce billing) ---------------------------------------------------
  STRIPE_SECRET: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_OVERAGE: z.string().optional(),
  STRIPE_API_URL: z.url().default('https://api.stripe.com'),

  // ---- billing integrity (carry-over #7, #8, #10) -------------------------------------
  /**
   * Per-plan daily cap on billed fit sessions per shop (fit-shown and the app's swipe path share
   * it): max(BILLED_DAILY_CAP_MIN, ceil(includedSessions / 30 × BILLED_DAILY_CAP_FACTOR)), never
   * above EMBED_BILLED_SESSIONS_PER_DAY. Above the cap a session answers `billed: false`.
   */
  BILLED_DAILY_CAP_FACTOR: z.coerce.number().positive().default(10),
  BILLED_DAILY_CAP_MIN: z.coerce.number().int().min(1).default(100),
  /** Anomaly signal: a day's billed sessions above FACTOR × the trailing daily average (and at least MIN). */
  BILLING_ANOMALY_FACTOR: z.coerce.number().min(1).default(3),
  BILLING_ANOMALY_MIN_SESSIONS: z.coerce.number().int().min(1).default(20),
  BILLING_ANOMALY_TRAILING_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /**
   * POST /v1/devices per client IP per hour (anonymous device minting). High on purpose (AVAIL-1):
   * the standalone embed mints a device on every open when it may not keep one (Remember me off,
   * private mode, blocked third-party storage), and many shoppers share one IP behind carrier NAT
   * or shop Wi-Fi. Billing does not depend on this limit: fit-shown bills once per device, product
   * and day, under the per-shop daily cap. A 429 shows the embed's "busy" screen with a retry.
   */
  DEVICE_CREATE_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(300),
  /** An expired but validly signed device token may still rotate (only rotate) for this many days past expiry. */
  DEVICE_TOKEN_ROTATE_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(180),

  // ---- media proxy + domain proof (carry-over #11, #12) --------------------------------
  /** GET /v1/sdk/media: largest merchant image we proxy (bytes). */
  MEDIA_PROXY_MAX_BYTES: z.coerce.number().int().min(1024).default(5 * 1024 * 1024),
  /** In-memory cache for proxied images, in MB (per api process). */
  MEDIA_PROXY_CACHE_MB: z.coerce.number().int().min(1).default(64),
  /** How long a proxied image is served from that cache (and the browser's max-age), in seconds. */
  MEDIA_PROXY_CACHE_TTL_SEC: z.coerce.number().int().min(60).default(3600),
  /** GET /v1/sdk/media per client IP per minute. */
  MEDIA_PROXY_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(240),
  /**
   * WooCommerce manual-key Connect: require the domain proof (the plugin serves the nonce at
   * /wp-json/curtain/v1/verify or in a meta tag) before keys are issued. Turn off only for local
   * development against a WordPress on a private address.
   */
  WOO_DOMAIN_PROOF: bool.default(true),

  // ---- D17 flat plan + expiring Shopify offline tokens (A3) ---------------------------------
  /**
   * Free trial of the one Curtain plan (USD 8.99 per month, D17), Shopify and Stripe alike. The
   * pre-D17 plans had 14 days; the default is 7 until the founder confirms the length. The clock
   * starts when the first subscription becomes active (Shopify ACTIVE, Stripe trialing or active),
   * not when it is created; a shop that subscribes again gets only what is left of its first trial.
   */
  BILLING_TRIAL_DAYS: z.coerce.number().int().min(0).max(30).default(7),
  /**
   * Force Shopify test charges (staging). Unset: test charges on partner development stores and
   * whenever NODE_ENV is not production; a merchant's request can never ask for one in production.
   */
  SHOPIFY_BILLING_TEST: bool.optional(),
  /** Stripe price id of the Curtain plan: recurring, USD 8.99 per month, licensed (no meter). */
  STRIPE_PRICE_CURTAIN: z.string().optional(),
  /** Request expiring offline tokens with refresh tokens at token exchange (App Store 3.1.2). */
  SHOPIFY_EXPIRING_OFFLINE_TOKENS: bool.default(true),
  /** Refresh an expiring offline access token this many seconds before it expires. */
  SHOPIFY_TOKEN_REFRESH_MARGIN_SEC: z.coerce.number().int().min(0).max(1800).default(300),
  /**
   * Dormant shops: the daily token job refreshes every session whose refresh token expires within
   * this many days (the refresh token lives 90 days; it must be used before then), and migrates
   * stored non-expiring tokens.
   */
  SHOPIFY_REFRESH_TOKEN_RENEW_DAYS: z.coerce.number().int().min(1).max(80).default(30),
});

export type Env = z.infer<typeof EnvSchema> & {
  JWT_SECRET: string;
  SHOP_KEY_PEPPER: string;
  ENCRYPTION_KEY: string;
  /** True when secrets were generated because they were missing (never in production). */
  devSecrets: boolean;
};

const DEV_FALLBACKS = {
  JWT_SECRET: 'dev-jwt-secret-do-not-use-in-production-0123456789',
  SHOP_KEY_PEPPER: 'dev-pepper-do-not-use-in-production',
  ENCRYPTION_KEY: '0'.repeat(64),
} as const;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/** Parses an env source (default `process.env`). Throws `EnvError` with every problem listed. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new EnvError(`Invalid environment:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const prod = e.NODE_ENV === 'production';
  const missing: string[] = [];
  const pick = (name: keyof typeof DEV_FALLBACKS): string => {
    const v = e[name];
    if (v) return v;
    if (prod) missing.push(name);
    return DEV_FALLBACKS[name];
  };
  const JWT_SECRET = pick('JWT_SECRET');
  const SHOP_KEY_PEPPER = pick('SHOP_KEY_PEPPER');
  const ENCRYPTION_KEY = pick('ENCRYPTION_KEY');
  if (missing.length) throw new EnvError(`Missing required secrets in production: ${missing.join(', ')}`);
  if (JWT_SECRET.length < 32) throw new EnvError('JWT_SECRET must be at least 32 characters');
  if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) throw new EnvError('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  if (e.SHOPIFY_API_KEY && !e.SHOPIFY_API_SECRET) throw new EnvError('SHOPIFY_API_SECRET is required when SHOPIFY_API_KEY is set');
  if (e.VERTEX_TRYON_ENABLED && !e.VERTEX_PROJECT) throw new EnvError('VERTEX_PROJECT is required when VERTEX_TRYON_ENABLED=1');
  const devSecrets = !e.JWT_SECRET || !e.SHOP_KEY_PEPPER || !e.ENCRYPTION_KEY;
  return { ...e, JWT_SECRET, SHOP_KEY_PEPPER, ENCRYPTION_KEY, devSecrets };
}

/** Test helper: a fully valid env with random secrets and overrides. */
export function testEnv(overrides: Partial<Record<keyof z.input<typeof EnvSchema>, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_SECRET: randomBytes(32).toString('hex'),
    SHOP_KEY_PEPPER: randomBytes(16).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    PUBLIC_APP_URL: 'https://app.curtain.test',
    PUBLIC_API_URL: 'https://api.curtain.test',
    ...overrides,
  });
}

export const isShopifyConfigured = (env: Env): boolean => Boolean(env.SHOPIFY_API_KEY && env.SHOPIFY_API_SECRET);
export const isStripeConfigured = (env: Env): boolean => Boolean(env.STRIPE_SECRET && env.STRIPE_PRICE_STARTER);
