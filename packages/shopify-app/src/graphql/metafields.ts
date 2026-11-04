/**
 * Metafield mutations: definitions (install), `metafieldsSet` on products (write-back so the shop
 * stays source of truth, D6) and the app-data metafields the theme app extension reads.
 */
import { SHOPIFY_METAFIELD_NAMESPACE, toShopifyMetafields, type GarmentPayload } from '@paskamer/schema';
import { assertNoUserErrors, type AdminGraphqlClient, type UserError } from './client';
import { productGid } from './products';

export const METAFIELD_DEFINITION_CREATE = /* GraphQL */ `
  mutation PaskamerDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id key namespace }
      userErrors { field message code }
    }
  }
`;

export const METAFIELD_DEFINITIONS_QUERY = /* GraphQL */ `
  query PaskamerDefinitions($namespace: String!, $cursor: String) {
    metafieldDefinitions(ownerType: PRODUCT, namespace: $namespace, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id key name type { name } pinnedPosition }
    }
  }
`;

export const METAFIELDS_SET = /* GraphQL */ `
  mutation PaskamerMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace ownerType }
      userErrors { field message code }
    }
  }
`;

export const CURRENT_APP_INSTALLATION_QUERY = /* GraphQL */ `
  query PaskamerInstallation { currentAppInstallation { id } }
`;

export interface MetafieldsSetInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface MetafieldsSetResult {
  metafields: Array<{ id: string; key: string; namespace: string; ownerType: string }>;
}

/** Up to 25 metafields per `metafieldsSet` call (Shopify limit); batches transparently. */
export async function metafieldsSet(client: AdminGraphqlClient, inputs: ReadonlyArray<MetafieldsSetInput>): Promise<MetafieldsSetResult> {
  const out: MetafieldsSetResult = { metafields: [] };
  for (let i = 0; i < inputs.length; i += 25) {
    const batch = inputs.slice(i, i + 25);
    const data = await client.request<{ metafieldsSet: { metafields: MetafieldsSetResult['metafields'] | null; userErrors: UserError[] } }>(METAFIELDS_SET, {
      metafields: batch,
    });
    assertNoUserErrors(data.metafieldsSet.userErrors, 'metafieldsSet');
    out.metafields.push(...(data.metafieldsSet.metafields ?? []));
  }
  return out;
}

/** Write a (partial) GarmentPayload back to the product's `$app:paskamer` metafields. */
export async function setProductMetafields(client: AdminGraphqlClient, gidOrExternalId: string, payload: Partial<GarmentPayload>): Promise<MetafieldsSetResult> {
  const inputs = toShopifyMetafields(payload, productGid(gidOrExternalId));
  if (inputs.length === 0) return { metafields: [] };
  return metafieldsSet(client, inputs);
}

export async function getCurrentAppInstallationId(client: AdminGraphqlClient): Promise<string> {
  const data = await client.request<{ currentAppInstallation: { id: string } }>(CURRENT_APP_INSTALLATION_QUERY);
  return data.currentAppInstallation.id;
}

/**
 * App-data metafields (owner = AppInstallation). The theme app extension reads them in Liquid as
 * `app.metafields.paskamer.public_key` etc., so the merchant never has to paste a key. The
 * namespace deliberately has no `$app:` prefix: the AppInstallation owner already isolates it.
 */
export const APP_DATA_NAMESPACE = 'paskamer' as const;
export const APP_DATA_KEYS = {
  publicKey: 'public_key',
  apiUrl: 'api_url',
  appUrl: 'app_url',
} as const;

export interface AppDataConfig {
  /** `pk_live_…` — the SDK's `data-shop`. Never the secret key. */
  publicKeyPrefix: string;
  /** API origin for `data-api` (the extension is served from Shopify's CDN, so the SDK cannot derive it). */
  apiUrl: string;
  appUrl?: string;
}

export function appDataMetafieldInputs(ownerId: string, cfg: AppDataConfig): MetafieldsSetInput[] {
  if (!/^pk_(live|test)_[A-Za-z0-9]{6,32}$/.test(cfg.publicKeyPrefix)) {
    throw new Error('appDataMetafieldInputs: publicKeyPrefix must be a public pk_live_/pk_test_ key (never sk_)');
  }
  const out: MetafieldsSetInput[] = [
    { ownerId, namespace: APP_DATA_NAMESPACE, key: APP_DATA_KEYS.publicKey, type: 'single_line_text_field', value: cfg.publicKeyPrefix },
    { ownerId, namespace: APP_DATA_NAMESPACE, key: APP_DATA_KEYS.apiUrl, type: 'url', value: cfg.apiUrl },
  ];
  if (cfg.appUrl) out.push({ ownerId, namespace: APP_DATA_NAMESPACE, key: APP_DATA_KEYS.appUrl, type: 'url', value: cfg.appUrl });
  return out;
}

export async function setAppDataMetafields(client: AdminGraphqlClient, cfg: AppDataConfig): Promise<MetafieldsSetResult> {
  const ownerId = await getCurrentAppInstallationId(client);
  return metafieldsSet(client, appDataMetafieldInputs(ownerId, cfg));
}

export { SHOPIFY_METAFIELD_NAMESPACE };
