/**
 * `$app:curtain` metafield definitions (D6). The key list is owned by @curtain/schema
 * (`SHOPIFY_METAFIELD_DEFINITIONS`, mirrored by `fromShopifyProduct`); this module turns it into
 * `MetafieldDefinitionInput`s and creates them idempotently on install.
 */
import {
  SHOPIFY_METAFIELD_BY_KEY,
  SHOPIFY_METAFIELD_DEFINITIONS,
  SHOPIFY_METAFIELD_NAMESPACE,
  type ShopifyMetafieldDefinition,
} from '@curtain/schema';
import { ShopifyGraphqlError, type AdminGraphqlClient, type UserError } from './graphql/client';
import { METAFIELD_DEFINITIONS_QUERY, METAFIELD_DEFINITION_CREATE } from './graphql/metafields';

export { SHOPIFY_METAFIELD_BY_KEY, SHOPIFY_METAFIELD_DEFINITIONS, SHOPIFY_METAFIELD_NAMESPACE };
export type { ShopifyMetafieldDefinition };

/** All keys in creation order. */
export const METAFIELD_KEYS: readonly string[] = SHOPIFY_METAFIELD_DEFINITIONS.map((d) => d.key);
/** Keys `completenessScore` treats as heavy (status 'active' requires them, contract 3). */
export const HEAVY_METAFIELD_KEYS: readonly string[] = SHOPIFY_METAFIELD_DEFINITIONS.filter((d) => d.heavy).map((d) => d.key);

export type MetafieldAdminAccess = 'MERCHANT_READ' | 'MERCHANT_READ_WRITE';
export type MetafieldStorefrontAccess = 'NONE' | 'PUBLIC_READ';

export interface MetafieldDefinitionInput {
  name: string;
  namespace: typeof SHOPIFY_METAFIELD_NAMESPACE;
  key: string;
  type: string;
  description: string;
  ownerType: 'PRODUCT';
  pin: boolean;
  access: { admin: MetafieldAdminAccess; storefront: MetafieldStorefrontAccess };
  validations?: Array<{ name: string; value: string }>;
}

export interface DefinitionOptions {
  /** Merchants edit the fields in the product admin (default MERCHANT_READ_WRITE). */
  admin?: MetafieldAdminAccess;
  /** Liquid can always read them; the Storefront API does not need to (default NONE). */
  storefront?: MetafieldStorefrontAccess;
}

/** Validations Shopify can enforce for the scalar fields (JSON fields are checked by completenessScore). */
export function metafieldValidations(def: ShopifyMetafieldDefinition): Array<{ name: string; value: string }> | undefined {
  switch (def.key) {
    case 'size_chart_type':
      return [{ name: 'choices', value: JSON.stringify(['garment', 'body']) }];
    case 'category':
      return [{ name: 'choices', value: JSON.stringify(['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']) }];
    case 'true_to_size_score':
      return [
        { name: 'min', value: '0' },
        { name: 'max', value: '1' },
      ];
    case 'critical_fit_points':
      return [{ name: 'choices', value: JSON.stringify(['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot']) }];
    default:
      return undefined;
  }
}

export function metafieldDefinitionInput(def: ShopifyMetafieldDefinition, opts: DefinitionOptions = {}): MetafieldDefinitionInput {
  const input: MetafieldDefinitionInput = {
    name: def.name,
    namespace: SHOPIFY_METAFIELD_NAMESPACE,
    key: def.key,
    type: def.type,
    description: def.description,
    ownerType: 'PRODUCT',
    pin: def.pin,
    access: { admin: opts.admin ?? 'MERCHANT_READ_WRITE', storefront: opts.storefront ?? 'NONE' },
  };
  const validations = metafieldValidations(def);
  if (validations) input.validations = validations;
  return input;
}

export const METAFIELD_DEFINITION_INPUTS: readonly MetafieldDefinitionInput[] = SHOPIFY_METAFIELD_DEFINITIONS.map((d) => metafieldDefinitionInput(d));

export interface EnsureDefinitionsResult {
  created: string[];
  existing: string[];
}

interface CreatePayload {
  metafieldDefinitionCreate: { createdDefinition: { id: string; key: string } | null; userErrors: UserError[] };
}

/**
 * Create every definition; `TAKEN` (already exists) counts as existing. Any other userError
 * aborts with a ShopifyGraphqlError naming the key, so install logs are actionable.
 */
export async function ensureMetafieldDefinitions(client: AdminGraphqlClient, opts: DefinitionOptions = {}): Promise<EnsureDefinitionsResult> {
  const created: string[] = [];
  const existing: string[] = [];
  for (const def of SHOPIFY_METAFIELD_DEFINITIONS) {
    const data = await client.request<CreatePayload>(METAFIELD_DEFINITION_CREATE, { definition: metafieldDefinitionInput(def, opts) });
    const r = data.metafieldDefinitionCreate;
    if (r.createdDefinition) created.push(def.key);
    else if (r.userErrors.some((e) => e.code === 'TAKEN')) existing.push(def.key);
    else throw new ShopifyGraphqlError(`metafield definition ${def.key}: ${r.userErrors.map((e) => e.message).join('; ') || 'unknown error'}`, 'user_errors', undefined, r.userErrors);
  }
  return { created, existing };
}

export interface ExistingDefinition {
  id: string;
  key: string;
  name: string;
  type: string;
  pinned: boolean;
}

/** List the definitions currently present in our namespace (for the admin page / drift checks). */
export async function listMetafieldDefinitions(client: AdminGraphqlClient): Promise<ExistingDefinition[]> {
  const out: ExistingDefinition[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: {
      metafieldDefinitions: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; key: string; name: string; type: { name: string }; pinnedPosition: number | null }>;
      };
    } = await client.request(METAFIELD_DEFINITIONS_QUERY, { namespace: SHOPIFY_METAFIELD_NAMESPACE, cursor });
    for (const n of data.metafieldDefinitions.nodes) out.push({ id: n.id, key: n.key, name: n.name, type: n.type.name, pinned: n.pinnedPosition !== null });
    if (!data.metafieldDefinitions.pageInfo.hasNextPage || !data.metafieldDefinitions.pageInfo.endCursor) return out;
    cursor = data.metafieldDefinitions.pageInfo.endCursor;
  }
}

/** Keys defined in schema but missing on the shop (drift after a schema update). */
export function missingDefinitionKeys(existing: ReadonlyArray<Pick<ExistingDefinition, 'key'>>): string[] {
  const have = new Set(existing.map((e) => e.key));
  return METAFIELD_KEYS.filter((k) => !have.has(k));
}
