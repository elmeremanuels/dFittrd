/**
 * Shopify Admin API client (GraphQL, API version from env — 2025-10), token exchange, webhook
 * HMAC verification and the two Billing mutations. Pure fetch; no SDK. The offline access token
 * is stored AES-GCM encrypted in shopify_sessions (server key from env.ts).
 */
import { eq } from 'drizzle-orm';
import { SHOPIFY_METAFIELD_DEFINITIONS, SHOPIFY_METAFIELD_NAMESPACE, type ShopifyProductNode } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { shopifySessions } from '../db/schema.js';
import type { Env } from '../env.js';
import { decryptString, encryptString, hmacBase64, safeEqual } from '../lib/crypto.js';
import { isShopifyDomain } from '../auth/shopifySessionToken.js';
import type { FetchLike } from '../context.js';

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly errors?: unknown,
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

export interface GraphqlResult<T> {
  data: T;
  extensions?: unknown;
}

export const PRODUCT_QUERY = /* GraphQL */ `
  query CurtainProduct($id: ID!, $namespace: String!) {
    product(id: $id) {
      id
      handle
      title
      vendor
      productType
      status
      onlineStoreUrl
      category { name fullName }
      featuredImage { url }
      images(first: 20) { nodes { url } }
      priceRangeV2 { minVariantPrice { amount currencyCode } }
      variants(first: 50) { nodes { price selectedOptions { name value } } }
      metafields(namespace: $namespace, first: 50) { nodes { namespace key type value } }
    }
  }
`;

export const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query CurtainProducts($cursor: String, $namespace: String!) {
    products(first: 50, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        vendor
        productType
        status
        onlineStoreUrl
        category { name fullName }
        featuredImage { url }
        images(first: 20) { nodes { url } }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        variants(first: 50) { nodes { price selectedOptions { name value } } }
        metafields(namespace: $namespace, first: 50) { nodes { namespace key type value } }
      }
    }
  }
`;

export const APP_SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation CurtainSubscribe($name: String!, $returnUrl: URL!, $test: Boolean, $trialDays: Int, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, trialDays: $trialDays, lineItems: $lineItems) {
      userErrors { field message }
      confirmationUrl
      appSubscription { id status lineItems { id plan { pricingDetails { __typename } } } }
    }
  }
`;

export const APP_USAGE_RECORD_CREATE = /* GraphQL */ `
  mutation CurtainUsage($subscriptionLineItemId: ID!, $description: String!, $price: MoneyInput!, $idempotencyKey: String!) {
    appUsageRecordCreate(subscriptionLineItemId: $subscriptionLineItemId, description: $description, price: $price, idempotencyKey: $idempotencyKey) {
      userErrors { field message }
      appUsageRecord { id }
    }
  }
`;

export const METAFIELD_DEFINITION_CREATE = /* GraphQL */ `
  mutation CurtainDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id key }
      userErrors { field message code }
    }
  }
`;

export interface SubscriptionPlanInput {
  name: string;
  returnUrl: string;
  priceEurPerMonth: number;
  cappedAmountEur: number;
  overageTerms: string;
  trialDays: number;
  test: boolean;
}

export class ShopifyClient {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly fetchImpl: FetchLike,
  ) {}

  configured(): boolean {
    return Boolean(this.env.SHOPIFY_API_KEY && this.env.SHOPIFY_API_SECRET);
  }

  adminUrl(shopDomain: string): string {
    return this.env.SHOPIFY_ADMIN_URL_TEMPLATE.replace('{shop}', shopDomain).replace('{version}', this.env.SHOPIFY_API_VERSION);
  }

  /** HMAC-SHA256 (base64) of the raw body with the API secret — `X-Shopify-Hmac-Sha256`. */
  verifyWebhookHmac(rawBody: Uint8Array | string, header: string | undefined): boolean {
    if (!header || !this.env.SHOPIFY_API_SECRET) return false;
    return safeEqual(hmacBase64(this.env.SHOPIFY_API_SECRET, rawBody), header);
  }

  async graphql<T>(shopDomain: string, accessToken: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(this.adminUrl(shopDomain), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': accessToken, accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let body: { data?: T; errors?: unknown } = {};
    try {
      body = text ? (JSON.parse(text) as typeof body) : {};
    } catch {
      throw new ShopifyApiError(`Shopify returned non-JSON (${res.status})`, res.status);
    }
    if (!res.ok) throw new ShopifyApiError(`Shopify GraphQL HTTP ${res.status}`, res.status, body.errors ?? text);
    if (body.errors) throw new ShopifyApiError('Shopify GraphQL errors', res.status, body.errors);
    if (!body.data) throw new ShopifyApiError('Shopify GraphQL: empty data', res.status);
    return body.data;
  }

  /**
   * Token exchange (managed installation, D6): session token → offline access token.
   * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
   */
  async tokenExchange(shopDomain: string, sessionToken: string): Promise<{ accessToken: string; scope: string }> {
    if (!this.configured()) throw new ShopifyApiError('Shopify is not configured');
    if (!isShopifyDomain(shopDomain)) throw new ShopifyApiError('invalid shop domain');
    const res = await this.fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.env.SHOPIFY_API_KEY,
        client_secret: this.env.SHOPIFY_API_SECRET,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: sessionToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new ShopifyApiError(body.error_description ?? body.error ?? `token exchange failed (${res.status})`, res.status, body);
    }
    return { accessToken: body.access_token, scope: body.scope ?? '' };
  }

  sessionId(shopDomain: string): string {
    return `offline_${shopDomain}`;
  }

  async saveOfflineSession(shopId: string, shopDomain: string, accessToken: string, scope: string): Promise<void> {
    const values = {
      id: this.sessionId(shopDomain),
      shopId,
      shopDomain,
      accessTokenEnc: encryptString(accessToken, this.env.ENCRYPTION_KEY),
      scope,
      isOnline: false,
      updatedAt: new Date(),
    };
    await this.db.insert(shopifySessions).values(values).onConflictDoUpdate({ target: shopifySessions.id, set: values });
  }

  async accessTokenFor(shopDomain: string): Promise<string | null> {
    const row = await this.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.id, this.sessionId(shopDomain)) });
    return row ? decryptString(row.accessTokenEnc, this.env.ENCRYPTION_KEY) : null;
  }

  async deleteSessions(shopId: string): Promise<void> {
    await this.db.delete(shopifySessions).where(eq(shopifySessions.shopId, shopId));
  }

  async fetchProduct(shopDomain: string, accessToken: string, gid: string): Promise<ShopifyProductNode | null> {
    const data = await this.graphql<{ product: ShopifyProductNode | null }>(shopDomain, accessToken, PRODUCT_QUERY, {
      id: gid,
      namespace: SHOPIFY_METAFIELD_NAMESPACE,
    });
    return data.product;
  }

  async fetchProductsPage(shopDomain: string, accessToken: string, cursor: string | null) {
    const data = await this.graphql<{ products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProductNode[] } }>(
      shopDomain,
      accessToken,
      PRODUCTS_PAGE_QUERY,
      { cursor, namespace: SHOPIFY_METAFIELD_NAMESPACE },
    );
    return data.products;
  }

  /** Starter plan: recurring line + usage line with cappedAmount (D6). Returns the confirmation URL. */
  async appSubscriptionCreate(shopDomain: string, accessToken: string, plan: SubscriptionPlanInput) {
    const data = await this.graphql<{
      appSubscriptionCreate: {
        userErrors: Array<{ field: string[] | null; message: string }>;
        confirmationUrl: string | null;
        appSubscription: { id: string; status: string; lineItems: Array<{ id: string; plan: { pricingDetails: { __typename: string } } }> } | null;
      };
    }>(shopDomain, accessToken, APP_SUBSCRIPTION_CREATE, {
      name: plan.name,
      returnUrl: plan.returnUrl,
      test: plan.test,
      trialDays: plan.trialDays,
      lineItems: [
        { plan: { appRecurringPricingDetails: { price: { amount: plan.priceEurPerMonth, currencyCode: 'EUR' }, interval: 'EVERY_30_DAYS' } } },
        { plan: { appUsagePricingDetails: { cappedAmount: { amount: plan.cappedAmountEur, currencyCode: 'EUR' }, terms: plan.overageTerms } } },
      ],
    });
    const r = data.appSubscriptionCreate;
    if (r.userErrors.length) throw new ShopifyApiError(r.userErrors.map((e) => e.message).join('; '), undefined, r.userErrors);
    const usageLine = r.appSubscription?.lineItems.find((l) => l.plan.pricingDetails.__typename === 'AppUsagePricing');
    return { confirmationUrl: r.confirmationUrl, subscriptionId: r.appSubscription?.id ?? null, usageLineItemId: usageLine?.id ?? null };
  }

  async appUsageRecordCreate(shopDomain: string, accessToken: string, input: { lineItemId: string; description: string; amountEur: number; idempotencyKey: string }) {
    const data = await this.graphql<{ appUsageRecordCreate: { userErrors: Array<{ message: string }>; appUsageRecord: { id: string } | null } }>(
      shopDomain,
      accessToken,
      APP_USAGE_RECORD_CREATE,
      {
        subscriptionLineItemId: input.lineItemId,
        description: input.description,
        price: { amount: input.amountEur, currencyCode: 'EUR' },
        idempotencyKey: input.idempotencyKey,
      },
    );
    const r = data.appUsageRecordCreate;
    if (r.userErrors.length) throw new ShopifyApiError(r.userErrors.map((e) => e.message).join('; '), undefined, r.userErrors);
    return r.appUsageRecord?.id ?? null;
  }

  /** Creates the $app:curtain metafield definitions (idempotent: TAKEN errors are ignored). */
  async ensureMetafieldDefinitions(shopDomain: string, accessToken: string): Promise<{ created: string[]; existing: string[] }> {
    const created: string[] = [];
    const existing: string[] = [];
    for (const def of SHOPIFY_METAFIELD_DEFINITIONS) {
      const data = await this.graphql<{ metafieldDefinitionCreate: { createdDefinition: { key: string } | null; userErrors: Array<{ code?: string; message: string }> } }>(
        shopDomain,
        accessToken,
        METAFIELD_DEFINITION_CREATE,
        {
          definition: {
            name: def.name,
            namespace: SHOPIFY_METAFIELD_NAMESPACE,
            key: def.key,
            type: def.type,
            description: def.description,
            ownerType: 'PRODUCT',
            pin: def.pin,
            access: { admin: 'MERCHANT_READ_WRITE', storefront: 'NONE' },
          },
        },
      );
      const r = data.metafieldDefinitionCreate;
      if (r.createdDefinition) created.push(def.key);
      else if (r.userErrors.some((e) => e.code === 'TAKEN')) existing.push(def.key);
      else throw new ShopifyApiError(`metafield definition ${def.key}: ${r.userErrors.map((e) => e.message).join('; ')}`);
    }
    return { created, existing };
  }
}
