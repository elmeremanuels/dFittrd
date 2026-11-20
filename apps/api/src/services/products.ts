import { and, asc, desc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  GarmentPayloadDraftSchema,
  GarmentPayloadSchema,
  completenessScore,
  hasShopMeasurements,
  heldBackFor,
  leaveOutInvalidParts,
  productNextStep,
  sizeAdviceScore,
  sizeAdviceGarment,
  type AudienceSource,
  type GarmentPayload,
  type GarmentPayloadDraft,
  type IncompleteProductDataPolicy,
  type MerchantProductSummary,
  type ProductHeldBack,
  type ProductNotices,
} from '@curtain/schema';
import type { Db } from '../db/client.js';
import { productImages, products, shops, type ProductStatus } from '../db/schema.js';
import { contentHash } from '../lib/crypto.js';

export type ProductRow = typeof products.$inferSelect;

export interface UpsertResult {
  product: ProductRow;
  /** The stored row changed: new content, or the same content now held back or released. */
  changed: boolean;
  score: number;
  missingFields: string[];
  status: 'active' | 'incomplete';
  /** What size advice assumes for this product and which values were left out (D25 point 1). */
  notices: ProductNotices;
  /** Set when the shop's setting holds this product back; the product is stored all the same. */
  heldBack: ProductHeldBack | null;
}

/** Compared field by field: jsonb does not keep the key order the row was written with. */
const sameHeldBack = (a: ProductHeldBack | null, b: ProductHeldBack | null): boolean =>
  a === null || b === null ? a === b : a.reason === b.reason && a.fields.length === b.fields.length && a.fields.every((f, i) => f === b.fields[i]);

const storedLeftOut = (leftOut: ProductNotices['leftOut']): ProductNotices['leftOut'] | null => (leftOut.length ? leftOut : null);
const sameLeftOut = (a: ProductNotices['leftOut'] | null, b: ProductNotices['leftOut']): boolean =>
  (a ?? []).length === b.length && (a ?? []).every((l, i) => l.field === b[i]!.field && l.reason === b[i]!.reason);

async function incompleteProductDataOf(db: Db, shopId: string): Promise<IncompleteProductDataPolicy> {
  const [row] = await db.select({ policy: shops.incompleteProductData }).from(shops).where(eq(shops.id, shopId)).limit(1);
  return row?.policy ?? 'let-through';
}

/**
 * Status and held-back state of a draft under the shop's setting. `active` = try-able for size
 * advice (the same predicate GET /v1/try uses) and not held back.
 */
function readinessOf(draft: GarmentPayloadDraft, policy: IncompleteProductDataPolicy, leftOut: ProductNotices['leftOut'] = []) {
  const advice = sizeAdviceGarment(draft);
  const heldBack = heldBackFor(policy, draft, leftOut);
  const status: 'active' | 'incomplete' = advice.ok && !heldBack ? 'active' : 'incomplete';
  return { status, heldBack, defaulted: advice.ok ? advice.defaulted : [] };
}

/**
 * Merchant upsert: validates the draft, runs completenessScore, stores status + missing field
 * paths. Equal content hash → no-op (returns changed: false and leaves updated_at alone).
 *
 * Incomplete data (D24 point 4, D25 point 1): a fabric value that is present but not valid is left
 * out and reported, the rest of the fabric is kept. The shop's `incompleteProductData` setting then
 * decides: `let-through` stores and sizes the product (0 % stretch assumed when it is missing);
 * `hold-back` stores it as `incomplete` with `heldBack`. Neither throws for incomplete data, so a
 * chart fix in the same save is kept and the data that was live before does not stay live.
 */
export async function upsertProduct(
  db: Db,
  shopId: string,
  externalId: string,
  input: unknown,
  /**
   * `audienceSource`: where the payload's audience was read from, when the caller knows (the
   * Shopify sync, or `?audienceSource=` on the merchant PUT). Left out: unknown; the stored source
   * is then kept as long as the payload's audience value is the same (a chart edit does not turn a
   * confirmed or an unconfirmed audience into something else) and cleared when the audience
   * changes. The men's gate reads it and never gates on an unknown source (services/readiness.ts).
   */
  opts: { handle?: string | null; audienceSource?: AudienceSource | null } = {},
): Promise<UpsertResult> {
  const cleaned = leaveOutInvalidParts({ ...(input as object), id: externalId });
  const draft = GarmentPayloadDraftSchema.parse(cleaned.payload);
  const completeness = completenessScore(draft);
  const missingFields = completeness.missing.map((m) => m.field);
  // Stored status = try-able for size advice and not held back; the score stays the full
  // completeness (render and taste fields included).
  const policy = await incompleteProductDataOf(db, shopId);
  const { status, heldBack, defaulted } = readinessOf(draft, policy, cleaned.leftOut);
  // An accessory's size does not depend on stretch: no "no stretch" notice for it (as in the list and the popup).
  const notices: ProductNotices = { defaulted: defaulted.filter((f) => !stretchDoesNotApply(f, draft.category)), leftOut: cleaned.leftOut };
  const result = { score: completeness.score, missingFields, status, notices, heldBack };
  const hash = contentHash(draft);
  const existing = await db.query.products.findFirst({ where: and(eq(products.shopId, shopId), eq(products.externalId, externalId)) });
  if (existing && existing.contentHash === hash && existing.status !== 'archived') {
    const audienceChanged = opts.audienceSource !== undefined && opts.audienceSource !== existing.audienceSource;
    // Same content, but the shop's setting now holds it back or lets it through: the stored state follows.
    const stateChanged = !sameHeldBack(existing.heldBack, heldBack) || !sameLeftOut(existing.leftOut, cleaned.leftOut);
    if (audienceChanged || stateChanged) {
      const [row] = await db
        .update(products)
        .set({
          // Same content, but the sync now knows the source (products stored before the column existed).
          ...(audienceChanged ? { audienceSource: opts.audienceSource } : {}),
          ...(stateChanged ? { status: status as ProductStatus, heldBack, leftOut: storedLeftOut(cleaned.leftOut), updatedAt: new Date() } : {}),
        })
        .where(eq(products.id, existing.id))
        .returning();
      return { product: row!, changed: stateChanged, ...result };
    }
    return { product: existing, changed: false, ...result };
  }
  const values = {
    shopId,
    externalId,
    handle: opts.handle ?? existing?.handle ?? null,
    payload: draft,
    schemaVersion: draft.schemaVersion ?? 1,
    category: draft.category ?? null,
    priceEur: typeof draft.priceEur === 'number' ? draft.priceEur : null,
    primaryColorHex: draft.primaryColorHex ?? null,
    status: status as ProductStatus,
    score: completeness.score,
    missingFields,
    contentHash: hash,
    updatedAt: new Date(),
    archivedAt: null,
    audienceSource: opts.audienceSource !== undefined ? opts.audienceSource : existing && existing.payload.audience === draft.audience ? existing.audienceSource : null,
    heldBack,
    leftOut: storedLeftOut(cleaned.leftOut),
  };
  const [row] = await db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({ target: [products.shopId, products.externalId], set: values })
    .returning();
  await syncImages(db, row!.id, draft);
  return { product: row!, changed: true, ...result };
}

/**
 * Applies a changed `incompleteProductData` setting to the products the shop already has, so that
 * switching to `hold-back` holds them and switching back releases them without a re-sync. It
 * judges the stored payload (a missing stretch) and the values the last save left out (stored
 * beside it). Archived products are left alone. Returns how many rows changed.
 */
export async function reapplyIncompleteProductData(db: Db, shopId: string, policy: IncompleteProductDataPolicy): Promise<number> {
  const rows = await db.select().from(products).where(eq(products.shopId, shopId));
  let n = 0;
  for (const row of rows) {
    if (row.status === 'archived') continue;
    const { status, heldBack } = readinessOf(row.payload, policy, row.leftOut ?? []);
    if (sameHeldBack(row.heldBack, heldBack)) continue;
    await db.update(products).set({ status: status as ProductStatus, heldBack, updatedAt: new Date() }).where(eq(products.id, row.id));
    n++;
  }
  return n;
}

async function syncImages(db: Db, productId: string, draft: GarmentPayloadDraft): Promise<void> {
  const existing = await db.select().from(productImages).where(eq(productImages.productId, productId));
  const wanted = new Map<string, 'flat_lay' | 'product'>();
  if (draft.flatLayPhoto) wanted.set(draft.flatLayPhoto, 'flat_lay');
  for (const url of draft.productPhotos ?? []) if (!wanted.has(url)) wanted.set(url, 'product');
  for (const img of existing) if (!wanted.has(img.url)) await db.delete(productImages).where(eq(productImages.id, img.id));
  const have = new Set(existing.map((i) => i.url));
  const inserts = [...wanted].filter(([url]) => !have.has(url)).map(([url, kind]) => ({ productId, url, kind }));
  if (inserts.length) await db.insert(productImages).values(inserts);
}

export async function archiveProduct(db: Db, shopId: string, externalId: string): Promise<boolean> {
  const rows = await db
    .update(products)
    .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(products.shopId, shopId), eq(products.externalId, externalId)))
    .returning({ id: products.id });
  return rows.length > 0;
}

export async function findProduct(db: Db, shopId: string, externalId: string): Promise<ProductRow | undefined> {
  return db.query.products.findFirst({ where: and(eq(products.shopId, shopId), eq(products.externalId, externalId)) });
}

export async function findProductById(db: Db, id: string): Promise<ProductRow | undefined> {
  return db.query.products.findFirst({ where: eq(products.id, id) });
}

/**
 * The garment the standalone embed sizes: the stored payload with defaults for the fields size
 * advice does not read (`sizeAdviceGarment`). Null when category, chart type or chart is missing,
 * and for a product the shop holds back for incomplete data.
 */
export function asTryGarment(row: ProductRow, opts: { colorHex?: string } = {}): GarmentPayload | null {
  return tryGarment(row, opts)?.garment ?? null;
}

/**
 * The same garment, with what the shopper must be told about it: `stretchAssumed` when the shop
 * gave no fabric stretch and size advice therefore assumes 0 % (never for an accessory, whose
 * size does not depend on it).
 */
export function tryGarment(row: ProductRow, opts: { colorHex?: string } = {}): { garment: GarmentPayload; stretchAssumed: boolean } | null {
  // Held back by the shop's setting: not ready for shoppers, on any route.
  if (row.heldBack) return null;
  const r = sizeAdviceGarment(row.payload, opts);
  if (!r.ok) return null;
  return { garment: r.garment, stretchAssumed: r.garment.category !== 'accessory' && r.defaulted.includes('fabric.stretchPct') };
}

/** `fabric.stretchPct` on an accessory: assumed, but it changes nothing and is never reported. */
const stretchDoesNotApply = (field: string, category: string | null | undefined): boolean => field === 'fabric.stretchPct' && category === 'accessory';

/** What the merchant's product list says was assumed and left out (D25 point 1). Render-only defaults (price, colour, block) are not listed. */
function noticesOf(row: ProductRow): ProductNotices {
  const r = row.status === 'archived' ? null : sizeAdviceGarment(row.payload);
  const defaulted = r?.ok ? r.defaulted.filter((f) => f.startsWith('fabric.') && !stretchDoesNotApply(f, row.category)) : [];
  return { defaulted, leftOut: row.leftOut ?? [] };
}

/**
 * A stored payload that validates as a full GarmentPayload (the app's deck needs every field).
 * Null for a product the shop holds back: held back means not shown to shoppers on any route (the
 * app's product page, hero renders, the AI-enhanced estimate), also when the payload is complete.
 */
export function asGarment(row: ProductRow): GarmentPayload | null {
  if (row.heldBack) return null;
  const parsed = GarmentPayloadSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

/** The merchant-facing next step and size-advice score of one product (@curtain/schema merchantSetup.ts). */
function nextOf(row: ProductRow): Pick<MerchantProductSummary, 'measured' | 'next' | 'adviceScore'> {
  const p = { status: row.status, category: row.category, missingFields: row.missingFields, measured: hasShopMeasurements(row.payload.garmentTape) };
  return { measured: p.measured, next: productNextStep(p), adviceScore: sizeAdviceScore(p) };
}

export function toSummary(row: ProductRow, flatLayProcessedUrl: string | null = null, menGate?: MerchantProductSummary['menGate']): MerchantProductSummary {
  const cat = row.category as MerchantProductSummary['category'];
  return {
    externalId: row.externalId,
    name: row.payload.name,
    category: cat ?? null,
    status: row.status,
    score: row.score,
    missingFields: row.missingFields,
    flatLayProcessedUrl,
    updatedAt: row.updatedAt.toISOString(),
    ...nextOf(row),
    // Only for a men's product under the men's gate; absent otherwise, so the body is unchanged.
    ...(menGate ? { menGate } : {}),
    ...(row.heldBack ? { heldBack: row.heldBack } : {}),
    notices: noticesOf(row),
  };
}

/** Keyset pagination on (external_id) — stable and index-backed. */
export function encodeIdCursor(externalId: string): string {
  return Buffer.from(externalId).toString('base64url');
}
export function decodeIdCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  const s = Buffer.from(cursor, 'base64url').toString('utf8');
  return s.length ? s : null;
}

export async function listActiveGarments(
  db: Db,
  shopId: string,
  q: { cursor?: string; category?: string; limit: number },
  /** The men's gate (`withoutComingSoon`): drops rows that are not ready for shoppers. The cursor still walks every row. */
  keep: (rows: ProductRow[]) => Promise<ProductRow[]> = async (rows) => rows,
) {
  const after = decodeIdCursor(q.cursor);
  const conds: SQL[] = [eq(products.shopId, shopId), eq(products.status, 'active')];
  if (q.category) conds.push(eq(products.category, q.category));
  if (after) conds.push(gt(products.externalId, after));
  const rows = await db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(asc(products.externalId))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const items = (await keep(page)).map(asGarment).filter((g): g is GarmentPayload => g !== null);
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > q.limit && last ? encodeIdCursor(last.externalId) : null };
}

export async function listMerchantProducts(
  db: Db,
  shopId: string,
  q: { status?: ProductStatus; cursor?: string; limit: number },
  /** The men's gate badge per row (`merchantMenGate`); the default adds nothing. */
  menGateOf: (row: ProductRow) => Promise<MerchantProductSummary['menGate']> = async () => undefined,
) {
  const after = decodeIdCursor(q.cursor);
  const conds: SQL[] = [eq(products.shopId, shopId)];
  if (q.status) conds.push(eq(products.status, q.status));
  if (after) conds.push(gt(products.externalId, after));
  const rows = await db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(asc(products.externalId))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const ids = page.map((p) => p.id);
  const flatLays = ids.length
    ? await db
        .select({ productId: productImages.productId, processedUrl: productImages.processedUrl })
        .from(productImages)
        .where(and(eq(productImages.kind, 'flat_lay'), or(...ids.map((i) => eq(productImages.productId, i)))))
    : [];
  const flatByProduct = new Map(flatLays.map((f) => [f.productId, f.processedUrl]));
  const countRows = await db
    .select({ status: products.status, n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.shopId, shopId))
    .groupBy(products.status);
  const counts = { active: 0, incomplete: 0, archived: 0 };
  for (const c of countRows) counts[c.status] = c.n;
  const last = page[page.length - 1];
  const items: MerchantProductSummary[] = [];
  for (const p of page) items.push(toSummary(p, flatByProduct.get(p.id) ?? null, await menGateOf(p)));
  return {
    items,
    nextCursor: rows.length > q.limit && last ? encodeIdCursor(last.externalId) : null,
    counts,
  };
}

export const notArchived = () => or(isNull(products.archivedAt), sql`false`);
export const newestFirst = () => desc(products.updatedAt);
