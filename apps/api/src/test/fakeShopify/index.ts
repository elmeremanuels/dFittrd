/**
 * A stateful fake of the Shopify platform for the offline contract harness
 * (apps/api/src/shopify/contract.test.ts). It plays every part Shopify plays for Curtain:
 *
 *  - the OAuth endpoint `POST https://{shop}/admin/oauth/access_token`: token exchange (an App
 *    Bridge ID token → an expiring offline token + refresh token) and refresh-token rotation, with
 *    the request and error shapes from
 *    https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange;
 *  - the GraphQL Admin API `POST https://{shop}/admin/api/{version}/graphql.json`: every document is
 *    parsed and validated with graphql-js against `admin-2026-10.excerpt.graphql`, then executed
 *    against in-memory state (products, `$app:curtain` metafields, metafield definitions, app-data
 *    metafields, app subscriptions, bulk operations). Validation failures are answered the way
 *    Shopify answers them (HTTP 200 with `errors`) and recorded in `violations`;
 *  - the bulk-operation result file (ungrouped JSONL, children after all parents: the 2026-01+
 *    default and the hardest order for the parser);
 *  - the merchant and the admin: install (managed installation), ID tokens (HS256, signed with the
 *    app's client secret), approving / declining a charge, uninstalling, GDPR requests;
 *  - webhook deliveries with the documented headers and `X-Shopify-Hmac-Sha256` over the raw body,
 *    retried with the same `X-Shopify-Webhook-Id` while the endpoint answers non-2xx.
 *
 * Behaviour that is documented is cited in place. Behaviour that is NOT documented and is assumed
 * here is marked ASSUMPTION; those are exactly the items docs/LAUNCH-SHOPIFY.md checks on a store.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSchema, execute, parse, validate, type DocumentNode, type GraphQLSchema, Kind, visit, type FieldNode } from 'graphql';

export const FAKE_SCHEMA_SDL = readFileSync(fileURLToPath(new URL('./admin-2026-10.excerpt.graphql', import.meta.url)), 'utf8');
let schemaCache: GraphQLSchema | null = null;
export function fakeAdminSchema(): GraphQLSchema {
  return (schemaCache ??= buildSchema(FAKE_SCHEMA_SDL));
}

/** Stable Admin API versions on 2026-11-09 (https://shopify.dev/docs/api/usage/versioning). */
export const SUPPORTED_API_VERSIONS = ['2026-01', '2026-04', '2026-07', '2026-10'] as const;

/** Token-format strings are assembled at runtime so the repository never holds one (secret scan). */
const ACCESS_PREFIX = 'shp' + 'at_';
const REFRESH_PREFIX = 'shp' + 'rt_';

export interface FakeMetafield {
  id: string;
  namespace: string; // as stored and returned: resolved (app--{appId}--curtain) or plain (curtain)
  key: string;
  type: string;
  value: string;
}

export interface FakeProduct {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | 'UNLISTED';
  tags: string[];
  collections: string[];
  descriptionHtml: string;
  price: string;
  currencyCode: string;
  sizes: string[];
  category: { id: string; name: string; fullName: string } | null;
  imageUrl: string;
  metafields: FakeMetafield[];
}

export interface FakeSubscription {
  id: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'DECLINED' | 'CANCELLED' | 'FROZEN' | 'EXPIRED';
  test: boolean;
  trialDays: number;
  returnUrl: string;
  createdAt: Date;
  lineItems: Array<{ id: string; price: { amount: string; currencyCode: string }; interval: string }>;
}

export interface FakeDefinition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  type: string;
  ownerType: string;
  validations: Array<{ name: string; value: string }>;
  access: { admin?: string; storefront?: string };
}

export interface WebhookDelivery {
  topic: string;
  webhookId: string;
  eventId: string;
  body: string;
  headers: Record<string, string>;
  attempts: number;
  lastStatus: number | null;
}

export interface FakeStore {
  domain: string;
  shopGid: string;
  numericId: number;
  name: string;
  billingCurrency: string;
  shopCurrency: string;
  devStore: boolean;
  primaryDomain: string;
  installed: boolean;
  installationId: string;
  scopes: string;
  products: Map<string, FakeProduct>;
  /** App-data metafields on the AppInstallation (key `namespace.key`); deleted on uninstall. */
  appData: Map<string, FakeMetafield>;
  definitions: Map<string, FakeDefinition>;
  subscriptions: FakeSubscription[];
  bulk: Map<string, { id: string; status: string; query: string; createdAt: Date; polls: number; jsonl: string; objectCount: number }>;
}

export interface FakeShopifyOptions {
  apiKey: string;
  apiSecret: string;
  /** The numeric app id `$app` expands to (https://shopify.dev/docs/apps/build/metafields). */
  appId?: string;
  distribution: 'public' | 'custom';
  /** The app's scopes from shopify.app.toml (managed installation grants exactly these). */
  scopes?: string;
  now: () => Date;
  /** Where webhooks go: the api under test. Returns the HTTP status. */
  deliver?: (req: { url: string; headers: Record<string, string>; body: string }) => Promise<number>;
  webhookUrl?: string;
}

export interface Violation {
  operation: string;
  messages: string[];
}

export interface RecordedRequest {
  kind: 'oauth' | 'graphql' | 'bulk-download';
  shop: string;
  operationName?: string;
  rootFields?: string[];
  variables?: Record<string, unknown>;
  body?: Record<string, string>;
  status: number;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export class FakeShopify {
  readonly stores = new Map<string, FakeStore>();
  readonly requests: RecordedRequest[] = [];
  readonly violations: Violation[] = [];
  /** Deprecated fields the code selects (Product.featuredImage, Product.images in 2026-10). */
  readonly deprecatedUses = new Set<string>();
  readonly webhooks: WebhookDelivery[] = [];
  /** Access tokens: value → shop, expiry, revoked. */
  private readonly tokens = new Map<string, { shop: string; expiresAt: Date | null; revoked: boolean }>();
  private readonly refreshTokens = new Map<string, { shop: string; expiresAt: Date; used: boolean }>();
  readonly appId: string;
  private seq = 1000;

  constructor(readonly opts: FakeShopifyOptions) {
    this.appId = opts.appId ?? '2841567';
  }

  private nextId(): number {
    return ++this.seq;
  }

  /** `$app:curtain` → `app--{appId}--curtain`; `$app` → `app--{appId}`; anything else unchanged. */
  resolveNamespace(ns: string | undefined | null): string {
    const n = ns ?? '$app';
    if (n === '$app') return `app--${this.appId}`;
    if (n.startsWith('$app:')) return `app--${this.appId}--${n.slice(5)}`;
    return n;
  }

  // ---- merchant / platform actions --------------------------------------------------------------

  addStore(domain: string, over: Partial<Pick<FakeStore, 'billingCurrency' | 'shopCurrency' | 'devStore' | 'primaryDomain' | 'name'>> = {}): FakeStore {
    const numericId = this.nextId();
    const store: FakeStore = {
      domain,
      shopGid: `gid://shopify/Shop/${numericId}`,
      numericId,
      name: over.name ?? domain.replace(/\.myshopify\.com$/, ''),
      billingCurrency: over.billingCurrency ?? 'USD',
      shopCurrency: over.shopCurrency ?? over.billingCurrency ?? 'USD',
      devStore: over.devStore ?? false,
      primaryDomain: over.primaryDomain ?? domain,
      installed: false,
      installationId: '',
      scopes: '',
      products: new Map(),
      appData: new Map(),
      definitions: new Map(),
      subscriptions: [],
      bulk: new Map(),
    };
    this.stores.set(domain, store);
    return store;
  }

  store(domain: string): FakeStore {
    const s = this.stores.get(domain);
    if (!s) throw new Error(`fake: no store ${domain}`);
    return s;
  }

  /**
   * Managed installation: the merchant approves the scopes declared in shopify.app.toml and lands in
   * the embedded app (https://shopify.dev/docs/apps/build/authentication-authorization/app-installation).
   * No code reaches the app; the app's first request is a token exchange with the page's ID token.
   */
  install(domain: string): void {
    const s = this.store(domain);
    s.installed = true;
    s.installationId = `gid://shopify/AppInstallation/${this.nextId()}`;
    s.scopes = this.opts.scopes ?? 'read_products,write_products';
  }

  addProduct(domain: string, p: Partial<FakeProduct> & { title: string }, curtain: Record<string, { type: string; value: string }> = {}): FakeProduct {
    const s = this.store(domain);
    const n = this.nextId();
    const product: FakeProduct = {
      id: `gid://shopify/Product/${n}`,
      handle: p.handle ?? p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: p.title,
      vendor: p.vendor ?? s.name,
      productType: p.productType ?? 'Dresses',
      status: p.status ?? 'ACTIVE',
      tags: p.tags ?? [],
      collections: p.collections ?? [],
      descriptionHtml: p.descriptionHtml ?? '<p>Linen.</p>',
      price: p.price ?? '129.95',
      currencyCode: p.currencyCode ?? s.shopCurrency,
      sizes: p.sizes ?? ['8', '10', '12', '14'],
      category: p.category ?? { id: 'gid://shopify/TaxonomyCategory/aa-1-4', name: 'Dresses', fullName: 'Apparel & Accessories > Clothing > Dresses' },
      imageUrl: p.imageUrl ?? `https://cdn.shopify.com/s/files/1/${n}/front.jpg`,
      metafields: [],
    };
    for (const [key, v] of Object.entries(curtain)) {
      product.metafields.push({ id: `gid://shopify/Metafield/${this.nextId()}`, namespace: this.resolveNamespace('$app:curtain'), key, type: v.type, value: v.value });
    }
    s.products.set(product.id, product);
    return product;
  }

  /** An App Bridge ID token (session token) for this shop, HS256 with the client secret. */
  idToken(domain: string, over: { expiresInSec?: number; aud?: string; secret?: string; iatOffsetSec?: number } = {}): string {
    const now = Math.floor(this.opts.now().getTime() / 1000) + (over.iatOffsetSec ?? 0);
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({
        iss: `https://${domain}/admin`,
        dest: `https://${domain}`,
        aud: over.aud ?? this.opts.apiKey,
        sub: '74291',
        exp: now + (over.expiresInSec ?? 60),
        nbf: now - 1,
        iat: now - 1,
        jti: randomUUID(),
        sid: randomBytes(16).toString('hex'),
      }),
    );
    const sig = createHmac('sha256', over.secret ?? this.opts.apiSecret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  }

  /**
   * The merchant approves a pending charge on the confirmation page. With the default replacement
   * behaviour the shop's other ACTIVE subscription is cancelled ("Shopify replaces the old one on
   * approval"). Both changes are delivered as app_subscriptions/update unless `dropWebhooks`.
   */
  async approve(domain: string, subscriptionId: string, opts: { dropWebhooks?: boolean } = {}): Promise<void> {
    const s = this.store(domain);
    const sub = s.subscriptions.find((x) => x.id === subscriptionId);
    if (!sub || sub.status !== 'PENDING') throw new Error(`fake: ${subscriptionId} is not pending`);
    // Development stores accept only test charges (ASSUMPTION on the exact failure; documented that they cannot be billed).
    if (s.devStore && !sub.test) throw new Error('fake: a development store cannot approve a real charge');
    const replaced = s.subscriptions.filter((x) => x.status === 'ACTIVE');
    for (const old of replaced) {
      old.status = 'CANCELLED';
      if (!opts.dropWebhooks) await this.webhook(domain, 'app_subscriptions/update', this.subscriptionPayload(s, old));
    }
    sub.status = 'ACTIVE';
    if (!opts.dropWebhooks) await this.webhook(domain, 'app_subscriptions/update', this.subscriptionPayload(s, sub));
  }

  async decline(domain: string, subscriptionId: string): Promise<void> {
    const s = this.store(domain);
    const sub = s.subscriptions.find((x) => x.id === subscriptionId);
    if (!sub || sub.status !== 'PENDING') throw new Error(`fake: ${subscriptionId} is not pending`);
    sub.status = 'DECLINED';
    await this.webhook(domain, 'app_subscriptions/update', this.subscriptionPayload(s, sub));
  }

  /**
   * The merchant uninstalls. Documented: app/uninstalled is delivered; shop/redact follows 48 hours
   * later (https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance); app-data
   * metafields belong to the installation.
   * ASSUMPTIONS (community reports, not reference docs): the app's subscriptions are cancelled
   * without an app_subscriptions/update reaching the app; app-owned (`$app`) product metafields
   * and their definitions survive the uninstall.
   */
  async uninstall(domain: string): Promise<void> {
    const s = this.store(domain);
    s.installed = false;
    for (const [t, v] of this.tokens) if (v.shop === domain) this.tokens.set(t, { ...v, revoked: true });
    for (const [t, v] of this.refreshTokens) if (v.shop === domain) this.refreshTokens.set(t, { ...v, used: true });
    for (const sub of s.subscriptions) if (sub.status === 'ACTIVE' || sub.status === 'PENDING' || sub.status === 'FROZEN') sub.status = 'CANCELLED';
    s.appData.clear();
    await this.webhook(domain, 'app/uninstalled', {
      id: s.numericId,
      name: s.name,
      email: `owner@${s.primaryDomain}`,
      domain: s.primaryDomain,
      myshopify_domain: s.domain,
      currency: s.shopCurrency,
      plan_name: s.devStore ? 'partner_test' : 'basic',
    });
  }

  async shopRedact(domain: string): Promise<number> {
    const s = this.store(domain);
    return this.webhook(domain, 'shop/redact', { shop_id: s.numericId, shop_domain: s.domain });
  }

  async customersDataRequest(domain: string): Promise<number> {
    const s = this.store(domain);
    return this.webhook(domain, 'customers/data_request', {
      shop_id: s.numericId,
      shop_domain: s.domain,
      orders_requested: [299938, 280263],
      customer: { id: 191167, email: 'john@example.com', phone: '555-625-1199' },
      data_request: { id: 9999 },
    });
  }

  async customersRedact(domain: string): Promise<number> {
    const s = this.store(domain);
    return this.webhook(domain, 'customers/redact', {
      shop_id: s.numericId,
      shop_domain: s.domain,
      customer: { id: 191167, email: 'john@example.com', phone: '555-625-1199' },
      orders_to_redact: [299938, 280263],
    });
  }

  /** products/update as Shopify sends it (REST-shaped payload with `admin_graphql_api_id`). */
  async productUpdated(domain: string, productId: string): Promise<number> {
    const p = this.store(domain).products.get(productId);
    if (!p) throw new Error('fake: no product');
    return this.webhook(domain, 'products/update', { id: Number(p.id.split('/').pop()), admin_graphql_api_id: p.id, title: p.title, handle: p.handle, status: p.status.toLowerCase() });
  }

  private subscriptionPayload(s: FakeStore, sub: FakeSubscription): Record<string, unknown> {
    const li = sub.lineItems[0]!;
    return {
      app_subscription: {
        admin_graphql_api_id: sub.id,
        name: sub.name,
        status: sub.status,
        admin_graphql_api_shop_id: s.shopGid,
        created_at: sub.createdAt.toISOString(),
        updated_at: this.opts.now().toISOString(),
        currency: li.price.currencyCode,
        price: li.price.amount,
        interval: li.interval.toLowerCase(),
      },
    };
  }

  // ---- webhooks ---------------------------------------------------------------------------------

  /**
   * One delivery: documented headers (https://shopify.dev/docs/api/webhooks/latest) and an HMAC of
   * the raw body with the client secret (https://shopify.dev/docs/apps/build/webhooks/subscribe/https).
   */
  async webhook(domain: string, topic: string, payload: unknown, opts: { secret?: string; omit?: string[] } = {}): Promise<number> {
    const body = JSON.stringify(payload);
    const webhookId = randomUUID();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-shopify-topic': topic,
      'x-shopify-hmac-sha256': createHmac('sha256', opts.secret ?? this.opts.apiSecret).update(body, 'utf8').digest('base64'),
      'x-shopify-shop-domain': domain,
      'x-shopify-api-version': '2026-10',
      'x-shopify-webhook-id': webhookId,
      'x-shopify-event-id': randomUUID(),
      'x-shopify-triggered-at': this.opts.now().toISOString(),
    };
    for (const h of opts.omit ?? []) delete headers[h];
    const d: WebhookDelivery = { topic, webhookId, eventId: headers['x-shopify-event-id']!, body, headers, attempts: 0, lastStatus: null };
    this.webhooks.push(d);
    return this.attempt(d);
  }

  private async attempt(d: WebhookDelivery): Promise<number> {
    if (!this.opts.deliver) return 0;
    d.attempts += 1;
    d.lastStatus = await this.opts.deliver({ url: this.opts.webhookUrl ?? '/shopify/webhooks', headers: d.headers, body: d.body });
    return d.lastStatus;
  }

  /** Shopify retries a delivery that got no 2xx "8 times over the next 4 hours", same webhook id. */
  async retryFailedDeliveries(): Promise<number> {
    let n = 0;
    for (const d of this.webhooks) {
      if (d.lastStatus !== null && (d.lastStatus < 200 || d.lastStatus > 299) && d.attempts < 9) {
        await this.attempt(d);
        n++;
      }
    }
    return n;
  }

  // ---- HTTP: the fetch the api is given --------------------------------------------------------

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/fake-shopify-bulk/')) return this.bulkDownload(url);
    const store = this.stores.get(url.hostname);
    if (!store) return new Response('not found', { status: 404 });
    if (init?.method === 'POST' && url.pathname === '/admin/oauth/access_token') return this.oauth(store, init);
    const m = /^\/admin\/api\/([^/]+)\/graphql\.json$/.exec(url.pathname);
    if (init?.method === 'POST' && m) return this.graphql(store, m[1]!, init);
    return new Response('not found', { status: 404 });
  };

  private readBody(init: RequestInit): Record<string, string> {
    const headers = new Headers(init.headers);
    const raw = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? '');
    if ((headers.get('content-type') ?? '').includes('application/json')) {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
    }
    return Object.fromEntries(new URLSearchParams(raw));
  }

  private issueTokens(store: FakeStore, expiring: boolean) {
    const access = ACCESS_PREFIX + randomBytes(16).toString('hex');
    const now = this.opts.now();
    // "Acquiring a new one retires older ones, but retired tokens stay valid until their expires_in ends."
    this.tokens.set(access, { shop: store.domain, expiresAt: expiring ? new Date(now.getTime() + 3600_000) : null, revoked: false });
    if (!expiring) return { access_token: access, scope: store.scopes };
    const refresh = REFRESH_PREFIX + randomBytes(16).toString('hex');
    this.refreshTokens.set(refresh, { shop: store.domain, expiresAt: new Date(now.getTime() + 7_776_000_000), used: false });
    return { access_token: access, scope: store.scopes, expires_in: 3600, refresh_token: refresh, refresh_token_expires_in: 7_776_000 };
  }

  private oauth(store: FakeStore, init: RequestInit): Response {
    const body = this.readBody(init);
    const rec = (status: number) => {
      this.requests.push({ kind: 'oauth', shop: store.domain, body: { ...body, client_secret: body.client_secret ? '[redacted]' : '', subject_token: body.subject_token ? '[jwt]' : '', refresh_token: body.refresh_token ? '[rt]' : '' }, status });
    };
    if (body.client_id !== this.opts.apiKey || body.client_secret !== this.opts.apiSecret) {
      rec(401);
      return json({ error: 'invalid_client' }, 401);
    }
    if (body.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
      if (body.subject_token_type !== 'urn:ietf:params:oauth:token-type:id_token') {
        rec(400);
        return json({ error: 'invalid_request', error_description: 'unsupported subject_token_type' }, 400);
      }
      // "If the ID token is expired or invalid, the request fails with 400 Bad Request."
      if (!this.verifyIdToken(store.domain, body.subject_token ?? '') || !store.installed) {
        rec(400);
        return json({ error: 'invalid_subject_token', error_description: 'Invalid subject token.' }, 400);
      }
      const requested = body.requested_token_type ?? 'urn:shopify:params:oauth:token-type:offline-access-token';
      if (requested !== 'urn:shopify:params:oauth:token-type:offline-access-token') {
        rec(400);
        return json({ error: 'invalid_request' }, 400);
      }
      rec(200);
      return json(this.issueTokens(store, body.expiring === '1' || body.expiring === 'true'));
    }
    if (body.grant_type === 'refresh_token') {
      const rt = this.refreshTokens.get(body.refresh_token ?? '');
      // A terminal refresh failure is 401 {"error":"invalid_request"} (implement-token-exchange#refresh).
      if (!rt || rt.used || rt.shop !== store.domain || rt.expiresAt <= this.opts.now() || !store.installed) {
        rec(401);
        return json({ error: 'invalid_request' }, 401);
      }
      rt.used = true;
      rec(200);
      return json(this.issueTokens(store, true));
    }
    rec(400);
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  private verifyIdToken(domain: string, token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const sig = createHmac('sha256', this.opts.apiSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    if (sig !== parts[2]) return false;
    const p = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { exp: number; aud: string; dest: string };
    return p.aud === this.opts.apiKey && p.dest === `https://${domain}` && p.exp * 1000 > this.opts.now().getTime();
  }

  /** Expire every access token now (to drive the api's refresh path). */
  expireAccessTokens(domain: string): void {
    for (const [t, v] of this.tokens) if (v.shop === domain) this.tokens.set(t, { ...v, expiresAt: new Date(this.opts.now().getTime() - 1000) });
  }

  validAccessTokens(domain: string): number {
    const now = this.opts.now();
    return [...this.tokens.values()].filter((v) => v.shop === domain && !v.revoked && (v.expiresAt === null || v.expiresAt > now)).length;
  }

  private async graphql(store: FakeStore, version: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = headers.get('x-shopify-access-token') ?? '';
    const t = this.tokens.get(token);
    const record = (status: number, extra: Partial<RecordedRequest> = {}) => this.requests.push({ kind: 'graphql', shop: store.domain, status, ...extra });
    if (!(SUPPORTED_API_VERSIONS as readonly string[]).includes(version)) {
      record(404);
      return json({ errors: 'Not Found' }, 404);
    }
    if (!t || t.revoked || t.shop !== store.domain || (t.expiresAt && t.expiresAt <= this.opts.now()) || !store.installed) {
      record(401);
      return json({ errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }, 401);
    }
    const { query, variables = {} } = JSON.parse(String(init.body)) as { query: string; variables?: Record<string, unknown> };
    let doc: DocumentNode;
    try {
      doc = parse(query);
    } catch (e) {
      this.violations.push({ operation: '(unparsable)', messages: [(e as Error).message] });
      record(200);
      return json({ errors: [{ message: (e as Error).message }] });
    }
    const opName = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION)?.name?.value ?? '(anonymous)';
    const errors = validate(fakeAdminSchema(), doc);
    this.collectDeprecated(doc);
    const roots = rootFieldsOf(doc);
    if (errors.length) {
      this.violations.push({ operation: opName, messages: errors.map((e) => e.message) });
      record(200, { operationName: opName, rootFields: roots, variables });
      return json({ errors: errors.map((e) => ({ message: e.message, extensions: { code: 'undefinedField' } })) });
    }
    const result = await execute({ schema: fakeAdminSchema(), document: doc, variableValues: variables, rootValue: this.root(store), contextValue: store });
    if (result.errors?.length) this.violations.push({ operation: opName, messages: result.errors.map((e) => e.message) });
    record(200, { operationName: opName, rootFields: roots, variables });
    return json({ data: result.data ?? null, ...(result.errors ? { errors: result.errors.map((e) => ({ message: e.message })) } : {}), extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 10, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1990, restoreRate: 100 } } } });
  }

  private collectDeprecated(doc: DocumentNode): void {
    const deprecated = new Set(['featuredImage', 'images']);
    visit(doc, {
      Field: (node: FieldNode) => {
        if (deprecated.has(node.name.value)) this.deprecatedUses.add(`Product.${node.name.value}`);
      },
    });
  }

  /** Validate a bulk query document the way bulkOperationRunQuery does (schema + documented limits). */
  bulkQueryProblems(query: string): string[] {
    let doc: DocumentNode;
    try {
      doc = parse(query);
    } catch (e) {
      return [(e as Error).message];
    }
    const problems = validate(fakeAdminSchema(), doc).map((e) => e.message);
    this.collectDeprecated(doc);
    // "up to five connections, with a maximum nesting depth of two levels"; at least one connection.
    const connections: number[] = [];
    const walk = (sel: readonly { kind: string }[] | undefined, depth: number) => {
      for (const s of sel ?? []) {
        if (s.kind !== Kind.FIELD) continue;
        const f = s as FieldNode;
        const sub = f.selectionSet?.selections;
        const isConnection = !!sub?.some((x) => x.kind === Kind.FIELD && ((x as FieldNode).name.value === 'edges' || (x as FieldNode).name.value === 'nodes'));
        if (isConnection) connections.push(depth + 1);
        walk(sub, isConnection ? depth + 1 : depth);
      }
    };
    const op = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
    if (op && op.kind === Kind.OPERATION_DEFINITION) walk(op.selectionSet.selections, 0);
    if (connections.length === 0) problems.push('bulk query has no connection');
    if (connections.length > 5) problems.push(`bulk query has ${connections.length} connections (max 5)`);
    if (Math.max(0, ...connections) > 2) problems.push('bulk query nests connections deeper than two levels');
    return problems;
  }

  // ---- resolvers ---------------------------------------------------------------------------------

  private productView(store: FakeStore, p: FakeProduct) {
    const conn = <T>(items: T[], first?: number | null) => {
      const list = items.slice(0, first ?? items.length);
      return { nodes: list, edges: list.map((node, i) => ({ cursor: `c${i}`, node })), pageInfo: { hasNextPage: list.length < items.length, hasPreviousPage: false, startCursor: null, endCursor: null } };
    };
    const mfView = (m: FakeMetafield) => ({ ...m, jsonValue: safeJson(m.value), ownerType: 'PRODUCT', compareDigest: 'x' });
    return {
      __typename: 'Product',
      id: p.id,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      productType: p.productType,
      status: p.status,
      onlineStoreUrl: p.status === 'ACTIVE' ? `https://${store.primaryDomain}/products/${p.handle}` : null,
      onlineStorePreviewUrl: `https://${store.domain}/products/${p.handle}?preview_key=fake`,
      descriptionHtml: p.descriptionHtml,
      category: p.category ? { __typename: 'TaxonomyCategory', ...p.category } : null,
      featuredImage: { id: `gid://shopify/ProductImage/${p.id.split('/').pop()}1`, url: p.imageUrl },
      images: (a: { first?: number }) => conn([{ id: `gid://shopify/ProductImage/${p.id.split('/').pop()}1`, url: p.imageUrl }], a.first),
      priceRangeV2: { minVariantPrice: { amount: p.price, currencyCode: p.currencyCode }, maxVariantPrice: { amount: p.price, currencyCode: p.currencyCode } },
      options: () => [{ id: `gid://shopify/ProductOption/${p.id.split('/').pop()}`, name: 'Size', position: 1, optionValues: p.sizes.map((s, i) => ({ id: `gid://shopify/ProductOptionValue/${i}`, name: s })) }],
      variants: (a: { first?: number }) =>
        conn(
          p.sizes.map((s, i) => ({ __typename: 'ProductVariant', id: `gid://shopify/ProductVariant/${p.id.split('/').pop()}${i}`, title: s, price: p.price, selectedOptions: [{ name: 'Size', value: s }] })),
          a.first,
        ),
      metafield: (a: { namespace?: string; key: string }) => {
        const ns = this.resolveNamespace(a.namespace ?? '$app');
        const m = p.metafields.find((x) => x.namespace === ns && x.key === a.key);
        return m ? mfView(m) : null;
      },
      metafields: (a: { namespace?: string; first?: number }) => {
        const ns = a.namespace === undefined ? null : this.resolveNamespace(a.namespace);
        return conn(p.metafields.filter((m) => ns === null || m.namespace === ns).map(mfView), a.first);
      },
    };
  }

  /** Shopify search syntax, the subset Curtain sends: status:, -status:, tag:, product_type:, collection_id:. */
  private matches(p: FakeProduct, query: string | null | undefined): boolean {
    if (!query) return true;
    const terms = query.match(/-?[a-z_]+:(?:"(?:[^"\\]|\\.)*"|\S+)/g) ?? [];
    return terms.every((term) => {
      const neg = term.startsWith('-');
      const [field, ...rest] = (neg ? term.slice(1) : term).split(':');
      const raw = rest.join(':');
      const value = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
      let ok: boolean;
      switch (field) {
        case 'status':
          ok = p.status.toLowerCase() === value.toLowerCase();
          break;
        case 'tag':
          ok = p.tags.some((t) => t.toLowerCase() === value.toLowerCase());
          break;
        case 'product_type':
          ok = p.productType.toLowerCase() === value.toLowerCase();
          break;
        case 'collection_id':
          ok = p.collections.includes(value);
          break;
        default:
          throw new Error(`fake: unsupported search field ${field}`);
      }
      return neg ? !ok : ok;
    });
  }

  private root(store: FakeStore): Record<string, unknown> {
    const products = () => [...store.products.values()];
    const subView = (s: FakeSubscription) => ({
      __typename: 'AppSubscription',
      id: s.id,
      name: s.name,
      status: s.status,
      test: s.test,
      trialDays: s.trialDays,
      createdAt: s.createdAt.toISOString(),
      currentPeriodEnd: s.status === 'ACTIVE' ? new Date(this.opts.now().getTime() + 30 * 86400_000).toISOString() : null,
      returnUrl: s.returnUrl,
      lineItems: s.lineItems.map((li) => ({ id: li.id, plan: { pricingDetails: { __typename: 'AppRecurringPricing', price: li.price, interval: li.interval } } })),
    });
    const bulkView = (b: { id: string; status: string; query: string; createdAt: Date; objectCount: number; jsonl: string }) => ({
      __typename: 'BulkOperation',
      id: b.id,
      status: b.status,
      errorCode: null,
      createdAt: b.createdAt.toISOString(),
      completedAt: b.status === 'COMPLETED' ? this.opts.now().toISOString() : null,
      objectCount: String(b.status === 'COMPLETED' ? b.objectCount : 0),
      rootObjectCount: '0',
      fileSize: b.status === 'COMPLETED' ? String(Buffer.byteLength(b.jsonl)) : null,
      url: b.status === 'COMPLETED' && b.jsonl ? `https://storage.googleapis.com/fake-shopify-bulk/${encodeURIComponent(store.domain)}/${encodeURIComponent(b.id)}.jsonl` : null,
      partialDataUrl: null,
      query: b.query,
      type: 'QUERY',
    });
    const page = <T>(items: T[], first: number | null | undefined, after: string | null | undefined) => {
      const start = after ? Number(after.replace(/^o/, '')) : 0;
      const n = Math.min(first ?? 50, 250);
      const list = items.slice(start, start + n);
      const end = start + list.length;
      return { nodes: list, edges: list.map((node, i) => ({ cursor: `o${start + i + 1}`, node })), pageInfo: { hasNextPage: end < items.length, hasPreviousPage: start > 0, startCursor: list.length ? `o${start + 1}` : null, endCursor: list.length ? `o${end}` : null } };
    };
    return {
      shop: () => ({ id: store.shopGid, name: store.name, myshopifyDomain: store.domain, currencyCode: store.shopCurrency, primaryDomain: { host: store.primaryDomain, url: `https://${store.primaryDomain}` }, plan: { partnerDevelopment: store.devStore, shopifyPlus: false, publicDisplayName: store.devStore ? 'Development' : 'Basic' } }),
      shopBillingPreferences: () => ({ currency: store.billingCurrency }),
      currentAppInstallation: () => ({
        __typename: 'AppInstallation',
        id: store.installationId,
        activeSubscriptions: store.subscriptions.filter((s) => s.status === 'ACTIVE').map(subView),
        metafield: (a: { namespace?: string; key: string }) => {
          const m = store.appData.get(`${this.resolveNamespace(a.namespace ?? '$app')}.${a.key}`);
          return m ? { ...m, jsonValue: safeJson(m.value), ownerType: 'API_PERMISSION', compareDigest: 'x' } : null;
        },
      }),
      product: (a: { id: string }) => {
        const p = store.products.get(a.id);
        return p ? this.productView(store, p) : null;
      },
      products: (a: { first?: number; after?: string; query?: string }) =>
        page(
          products()
            .filter((p) => this.matches(p, a.query))
            .map((p) => this.productView(store, p)),
          a.first,
          a.after,
        ),
      productsCount: (a: { query?: string; limit?: number }) => {
        const n = products().filter((p) => this.matches(p, a.query)).length;
        const limit = a.limit ?? 10000;
        return { count: Math.min(n, limit), precision: n > limit ? 'AT_LEAST' : 'EXACT' };
      },
      node: (a: { id: string }) => {
        for (const b of store.bulk.values()) {
          if (b.id === a.id) {
            b.polls += 1;
            if (b.status === 'CREATED') b.status = 'RUNNING';
            else if (b.status === 'RUNNING' && b.polls >= 2) b.status = 'COMPLETED';
            return bulkView(b);
          }
        }
        const p = store.products.get(a.id);
        return p ? this.productView(store, p) : null;
      },
      nodes: (a: { ids: string[] }) => a.ids.map((id) => (store.products.get(id) ? this.productView(store, store.products.get(id)!) : null)),
      metafieldDefinitions: (a: { ownerType: string; namespace?: string; first?: number; after?: string }) => {
        const ns = a.namespace ? this.resolveNamespace(a.namespace) : null;
        const defs = [...store.definitions.values()].filter((d) => d.ownerType === a.ownerType && (ns === null || d.namespace === ns)).map((d) => ({ ...d, type: { name: d.type, category: 'TEXT' }, pinnedPosition: null }));
        return page(defs, a.first, a.after);
      },

      // ---- mutations ----
      metafieldDefinitionCreate: (a: { definition: { namespace?: string; key: string; name: string; type: string; ownerType: string; validations?: Array<{ name: string; value: string }>; access?: { admin?: string; storefront?: string } } }) => {
        const d = a.definition;
        const ns = this.resolveNamespace(d.namespace ?? '$app');
        const errs: Array<{ field: string[]; message: string; code: string }> = [];
        if (!/^[a-zA-Z0-9_-]{2,64}$/.test(d.key)) errs.push({ field: ['definition', 'key'], message: 'Key is invalid', code: 'INVALID' });
        if (!KNOWN_TYPES.has(d.type)) errs.push({ field: ['definition', 'type'], message: `Type ${d.type} is not supported`, code: 'INCLUSION' });
        for (const v of d.validations ?? []) {
          const allowed = VALIDATIONS_BY_TYPE[d.type] ?? [];
          if (!allowed.includes(v.name)) errs.push({ field: ['definition', 'validations'], message: `Validation ${v.name} is not allowed for ${d.type}`, code: 'INVALID_OPTION' });
          if (v.name === 'choices') {
            const c = safeJson(v.value);
            if (!Array.isArray(c) || c.some((x) => typeof x !== 'string')) errs.push({ field: ['definition', 'validations'], message: 'choices must be a JSON list of strings', code: 'INVALID' });
          }
        }
        if (store.definitions.has(`${ns}.${d.key}.${d.ownerType}`)) errs.push({ field: ['definition', 'key'], message: `Key is in use for ${d.ownerType.toLowerCase()} metafields on the '${d.namespace}' namespace.`, code: 'TAKEN' });
        if (errs.length) return { createdDefinition: null, userErrors: errs };
        const def: FakeDefinition = { id: `gid://shopify/MetafieldDefinition/${this.nextId()}`, namespace: ns, key: d.key, name: d.name, type: d.type, ownerType: d.ownerType, validations: d.validations ?? [], access: d.access ?? {} };
        store.definitions.set(`${ns}.${d.key}.${d.ownerType}`, def);
        return { createdDefinition: { ...def, type: { name: def.type, category: 'TEXT' }, pinnedPosition: null }, userErrors: [] };
      },
      metafieldsSet: (a: { metafields: Array<{ ownerId: string; namespace?: string; key: string; type?: string; value: string }> }) => {
        // ASSUMPTION: the documented limit is 25 per call (the package batches at 25).
        if (a.metafields.length > 25) return { metafields: null, userErrors: [{ field: ['metafields'], message: 'Exceeds the maximum input size of 25', code: 'LESS_THAN_OR_EQUAL_TO', elementIndex: null }] };
        const out: unknown[] = [];
        const errs: unknown[] = [];
        a.metafields.forEach((m, i) => {
          const ns = this.resolveNamespace(m.namespace ?? '$app');
          if (m.ownerId === store.installationId) {
            const type = m.type ?? 'single_line_text_field';
            const mf: FakeMetafield = { id: `gid://shopify/Metafield/${this.nextId()}`, namespace: ns, key: m.key, type, value: m.value };
            store.appData.set(`${ns}.${m.key}`, mf);
            out.push({ ...mf, jsonValue: safeJson(mf.value), ownerType: 'API_PERMISSION', compareDigest: 'x' });
            return;
          }
          const p = store.products.get(m.ownerId);
          if (!p) {
            errs.push({ field: ['metafields', String(i), 'ownerId'], message: 'Owner does not exist.', code: 'INVALID', elementIndex: i });
            return;
          }
          const def = store.definitions.get(`${ns}.${m.key}.PRODUCT`);
          const type = m.type ?? def?.type;
          if (!type) {
            errs.push({ field: ['metafields', String(i), 'type'], message: "Type can't be blank.", code: 'BLANK', elementIndex: i });
            return;
          }
          if (def && def.type !== type) {
            errs.push({ field: ['metafields', String(i), 'type'], message: `Type must be ${def.type}`, code: 'INVALID_TYPE', elementIndex: i });
            return;
          }
          const bad = valueProblem(type, m.value, def);
          if (bad) {
            errs.push({ field: ['metafields', String(i), 'value'], message: bad, code: 'INVALID_VALUE', elementIndex: i });
            return;
          }
          const existing = p.metafields.find((x) => x.namespace === ns && x.key === m.key);
          if (existing) {
            existing.value = m.value;
            existing.type = type;
          } else p.metafields.push({ id: `gid://shopify/Metafield/${this.nextId()}`, namespace: ns, key: m.key, type, value: m.value });
          const mf = p.metafields.find((x) => x.namespace === ns && x.key === m.key)!;
          out.push({ ...mf, jsonValue: safeJson(mf.value), ownerType: 'PRODUCT', compareDigest: 'x' });
        });
        // metafieldsSet is atomic: "if one of the metafields fails, none are saved" (ASSUMPTION on the exact wording).
        if (errs.length) return { metafields: [], userErrors: errs };
        return { metafields: out, userErrors: [] };
      },
      appSubscriptionCreate: (a: { name: string; lineItems: Array<{ plan: { appRecurringPricingDetails?: { price: { amount: string | number; currencyCode: string }; interval?: string } } }>; returnUrl: string; test?: boolean; trialDays?: number }) => {
        // https://shopify.dev/docs/apps/launch/distribution: custom distribution "Can't charge merchants
        // through Shopify's app billing system". The message is the one developers report.
        if (this.opts.distribution === 'custom') return { appSubscription: null, confirmationUrl: null, userErrors: [{ field: null, message: 'Custom apps cannot use the Billing API' }] };
        const errs: Array<{ field: string[] | null; message: string }> = [];
        if (!/^https:\/\//.test(a.returnUrl)) errs.push({ field: ['returnUrl'], message: 'Return url must be https' });
        const recurring = a.lineItems.filter((li) => li.plan.appRecurringPricingDetails);
        if (recurring.length > 1) errs.push({ field: ['lineItems'], message: 'Only one plan per type is allowed' });
        for (const li of recurring) {
          const c = li.plan.appRecurringPricingDetails!.price.currencyCode;
          // ASSUMPTION: a price is accepted in USD or in the shop's billing currency, not a third one.
          if (c !== 'USD' && c !== store.billingCurrency) errs.push({ field: ['lineItems', '0', 'plan', 'appRecurringPricingDetails', 'price', 'currencyCode'], message: `Currency must be USD or ${store.billingCurrency}` });
          if (!(Number(li.plan.appRecurringPricingDetails!.price.amount) > 0)) errs.push({ field: ['lineItems'], message: 'Price must be greater than 0' });
        }
        if (errs.length) return { appSubscription: null, confirmationUrl: null, userErrors: errs };
        const n = this.nextId();
        const sub: FakeSubscription = {
          id: `gid://shopify/AppSubscription/${n}`,
          name: a.name,
          status: 'PENDING',
          test: a.test ?? false,
          trialDays: a.trialDays ?? 0,
          returnUrl: a.returnUrl,
          createdAt: this.opts.now(),
          lineItems: recurring.map((li, i) => ({
            id: `gid://shopify/AppSubscriptionLineItem/${n}${i}?v=1&index=${i}`,
            price: { amount: String(li.plan.appRecurringPricingDetails!.price.amount), currencyCode: li.plan.appRecurringPricingDetails!.price.currencyCode },
            interval: li.plan.appRecurringPricingDetails!.interval ?? 'EVERY_30_DAYS',
          })),
        };
        store.subscriptions.push(sub);
        return {
          appSubscription: subView(sub),
          confirmationUrl: `https://${store.domain}/admin/charges/${this.appId}/${n}/RecurringApplicationCharge/confirm_recurring_application_charge?signature=fake`,
          userErrors: [],
        };
      },
      appSubscriptionCancel: (a: { id: string }) => {
        const s = store.subscriptions.find((x) => x.id === a.id);
        if (!s) return { appSubscription: null, userErrors: [{ field: ['id'], message: 'Subscription not found' }] };
        s.status = 'CANCELLED';
        return { appSubscription: subView(s), userErrors: [] };
      },
      bulkOperationRunQuery: (a: { query: string; groupObjects: boolean }) => {
        const problems = this.bulkQueryProblems(a.query);
        if (problems.length) {
          this.violations.push({ operation: 'bulkOperationRunQuery(inner query)', messages: problems });
          return { bulkOperation: null, userErrors: problems.map((m) => ({ field: ['query'], message: m, code: 'INVALID' })) };
        }
        if ([...store.bulk.values()].some((b) => b.status === 'CREATED' || b.status === 'RUNNING')) {
          return { bulkOperation: null, userErrors: [{ field: null, message: 'A bulk query operation for this app and shop is already in progress', code: 'OPERATION_IN_PROGRESS' }] };
        }
        const queryArg = /products\(query:\s*"((?:[^"\\]|\\.)*)"\)/.exec(a.query)?.[1]?.replace(/\\(.)/g, '$1');
        const id = `gid://shopify/BulkOperation/${this.nextId()}`;
        const { jsonl, count } = this.bulkJsonl(store, queryArg, a.groupObjects);
        const b = { id, status: 'CREATED', query: a.query, createdAt: this.opts.now(), polls: 0, jsonl, objectCount: count };
        store.bulk.set(id, b);
        return { bulkOperation: bulkView(b), userErrors: [] };
      },
      bulkOperationCancel: (a: { id: string }) => {
        const b = store.bulk.get(a.id);
        if (!b) return { bulkOperation: null, userErrors: [{ field: ['id'], message: 'not found' }] };
        b.status = 'CANCELED';
        return { bulkOperation: bulkView(b), userErrors: [] };
      },
    };
  }

  /**
   * JSONL as a 2026-01+ bulk export writes it without `groupObjects`: one line per object, children
   * carry `__parentId`, and children are NOT next to their parent (here: every product first, then
   * every child), https://shopify.dev/docs/api/admin-graphql/latest/mutations/bulkOperationRunQuery.
   */
  private bulkJsonl(store: FakeStore, query: string | undefined, grouped: boolean): { jsonl: string; count: number } {
    const roots: string[] = [];
    const children: string[] = [];
    const list = [...store.products.values()].filter((p) => this.matches(p, query));
    for (const p of list) {
      const v = this.productView(store, p);
      roots.push(
        JSON.stringify({ id: p.id, handle: v.handle, title: v.title, vendor: v.vendor, productType: v.productType, status: v.status, onlineStoreUrl: v.onlineStoreUrl, category: p.category ? { name: p.category.name, fullName: p.category.fullName } : null, featuredImage: { url: p.imageUrl }, priceRangeV2: { minVariantPrice: { amount: p.price, currencyCode: p.currencyCode } } }),
      );
      const kids = [
        JSON.stringify({ id: `gid://shopify/ProductImage/${p.id.split('/').pop()}1`, url: p.imageUrl, __parentId: p.id }),
        ...p.sizes.map((s, i) => JSON.stringify({ id: `gid://shopify/ProductVariant/${p.id.split('/').pop()}${i}`, price: p.price, selectedOptions: [{ name: 'Size', value: s }], __parentId: p.id })),
        ...p.metafields.filter((m) => m.namespace === this.resolveNamespace('$app:curtain')).map((m) => JSON.stringify({ id: m.id, namespace: m.namespace, key: m.key, type: m.type, value: m.value, __parentId: p.id })),
      ];
      if (grouped) roots.push(...kids);
      else children.push(...kids);
    }
    const lines = [...roots, ...children];
    return { jsonl: lines.length ? lines.join('\n') + '\n' : '', count: lines.length };
  }

  private bulkDownload(url: URL): Response {
    const [, , domain, file] = url.pathname.split('/');
    const store = this.stores.get(decodeURIComponent(domain ?? ''));
    const id = decodeURIComponent((file ?? '').replace(/\.jsonl$/, ''));
    const b = store?.bulk.get(id);
    this.requests.push({ kind: 'bulk-download', shop: store?.domain ?? '', status: b ? 200 : 404 });
    if (!b) return new Response('not found', { status: 404 });
    return new Response(b.jsonl, { status: 200, headers: { 'content-type': 'application/jsonl' } });
  }
}

function rootFieldsOf(doc: DocumentNode): string[] {
  const out: string[] = [];
  for (const d of doc.definitions) {
    if (d.kind !== Kind.OPERATION_DEFINITION) continue;
    for (const s of d.selectionSet.selections) if (s.kind === Kind.FIELD) out.push(s.name.value);
  }
  return out;
}

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Metafield types Curtain uses (https://shopify.dev/docs/apps/build/custom-data/metafields/list-of-data-types). */
const KNOWN_TYPES = new Set(['single_line_text_field', 'multi_line_text_field', 'json', 'number_decimal', 'number_integer', 'url', 'color', 'boolean', 'list.single_line_text_field', 'list.url']);

/** Validation options per type (list-of-validation-options); ASSUMPTION for the exact sets. */
const VALIDATIONS_BY_TYPE: Record<string, string[]> = {
  single_line_text_field: ['min', 'max', 'regex', 'choices'],
  'list.single_line_text_field': ['min', 'max', 'regex', 'choices', 'list.min', 'list.max'],
  multi_line_text_field: ['min', 'max', 'regex'],
  number_decimal: ['min', 'max', 'max_precision'],
  number_integer: ['min', 'max'],
  json: ['schema'],
  url: ['allowed_domains'],
  'list.url': ['allowed_domains', 'list.min', 'list.max'],
  color: [],
  boolean: [],
};

function valueProblem(type: string, value: string, def: FakeDefinition | undefined): string | null {
  const choices = def?.validations.find((v) => v.name === 'choices');
  const allowed = choices ? (JSON.parse(choices.value) as string[]) : null;
  switch (type) {
    case 'json':
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'Value must be valid JSON.';
      }
    case 'single_line_text_field':
      if (value.includes('\n')) return 'Value must be a single line.';
      if (allowed && !allowed.includes(value)) return `Value does not exist in provided choices: ${JSON.stringify(allowed)}.`;
      return null;
    case 'list.single_line_text_field': {
      const v = safeJson(value);
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return 'Value must be a JSON array of strings.';
      if (allowed && v.some((x) => !allowed.includes(x as string))) return 'Value does not exist in provided choices.';
      return null;
    }
    case 'number_decimal':
      return /^-?\d+(\.\d+)?$/.test(value) ? null : 'Value must be a decimal.';
    case 'number_integer':
      return /^-?\d+$/.test(value) ? null : 'Value must be an integer.';
    case 'url':
      return /^https?:\/\//.test(value) ? null : 'Value must be a URL.';
    case 'color':
      return /^#[0-9a-fA-F]{6}$/.test(value) ? null : 'Value must be a hex color.';
    case 'boolean':
      return value === 'true' || value === 'false' ? null : 'Value must be true or false.';
    default:
      return null;
  }
}
