/**
 * Product node → GarmentPayload (ARCHITECTURE "Merchant sync"): normalise with
 * @curtain/schema's `fromShopifyProduct`, score with `completenessScore`, validate with
 * `GarmentPayloadSchema`. The api upserts the draft; status/missing fields come from here.
 */
import {
  completenessScore,
  fromShopifyProduct,
  safeParseGarmentPayload,
  shopifyExternalId,
  type CompletenessResult,
  type GarmentPayload,
  type GarmentPayloadDraft,
  type MappingWarning,
  type ShopifyProductNode,
} from '@curtain/schema';

export interface SyncOptions {
  /** Brand fallback when the product has no vendor and no brand metafield (usually the shop name). */
  defaultBrand?: string;
}

export interface SyncedProduct {
  externalId: string;
  handle: string | null;
  /** What the api stores (GarmentPayloadDraftSchema: id, name, brand required). */
  draft: Partial<GarmentPayload>;
  /** Fully valid payload when every required field is present, else null. */
  payload: GarmentPayload | null;
  completeness: CompletenessResult;
  warnings: MappingWarning[];
  /** True when the product must be archived instead of upserted (deleted/archived in Shopify). */
  archived: boolean;
  /** False when the node could not even yield id + name (log and skip). */
  usable: boolean;
}

/** Shopify product statuses that must not appear in the app. */
export function shouldArchive(node: ShopifyProductNode | null | undefined): boolean {
  if (!node) return true;
  const s = (node.status ?? '').toUpperCase();
  return s === 'ARCHIVED';
}

/** Draft products are synced but stay `incomplete` until published: the app only serves 'active'. */
export function isPublished(node: ShopifyProductNode): boolean {
  const s = (node.status ?? 'ACTIVE').toUpperCase();
  return s === 'ACTIVE';
}

export function syncProductNode(node: ShopifyProductNode | null, opts: SyncOptions = {}): SyncedProduct {
  if (!node) {
    return { externalId: '', handle: null, draft: {}, payload: null, completeness: completenessScore({}), warnings: [], archived: true, usable: false };
  }
  const warnings: MappingWarning[] = [];
  const draft = fromShopifyProduct(node, undefined, { warnings, defaultBrand: opts.defaultBrand });
  const externalId = draft.id ?? shopifyExternalId(node.id);
  if (!draft.brand && opts.defaultBrand) draft.brand = opts.defaultBrand;
  const usable = Boolean(draft.id && draft.name && draft.brand);
  const completeness = completenessScore(draft);
  const parsed = safeParseGarmentPayload(draft);
  return {
    externalId,
    handle: node.handle ?? null,
    draft,
    payload: parsed.success ? parsed.data : null,
    completeness,
    warnings,
    archived: shouldArchive(node),
    usable,
  };
}

/** Bulk/backfill helper: every usable, non-archived product. Skips are reported, never thrown. */
export function syncProductNodes(nodes: ReadonlyArray<ShopifyProductNode>, opts: SyncOptions = {}): { products: SyncedProduct[]; archived: string[]; skipped: string[] } {
  const products: SyncedProduct[] = [];
  const archived: string[] = [];
  const skipped: string[] = [];
  for (const node of nodes) {
    const r = syncProductNode(node, opts);
    if (r.archived) archived.push(r.externalId);
    else if (!r.usable) skipped.push(r.externalId || node.id);
    else products.push(r);
  }
  return { products, archived, skipped };
}

/** The draft shape the api's PUT /v1/merchant/products/:externalId accepts (contract 3/7). */
export function toMerchantUpsertBody(r: SyncedProduct): GarmentPayloadDraft {
  return { ...r.draft, id: r.externalId, name: r.draft.name ?? '', brand: r.draft.brand ?? '' } as GarmentPayloadDraft;
}
