import { and, asc, desc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  GarmentPayloadDraftSchema,
  GarmentPayloadSchema,
  completenessScore,
  sizeAdviceGarment,
  type AudienceSource,
  type GarmentPayload,
  type GarmentPayloadDraft,
  type MerchantProductSummary,
} from '@curtain/schema';
import type { Db } from '../db/client.js';
import { productImages, products, type ProductStatus } from '../db/schema.js';
import { contentHash } from '../lib/crypto.js';

export type ProductRow = typeof products.$inferSelect;

export interface UpsertResult {
  product: ProductRow;
  changed: boolean;
  score: number;
  missingFields: string[];
  status: 'active' | 'incomplete';
}

/**
 * Merchant upsert: validates the draft, runs completenessScore, stores status + missing field
 * paths. Equal content hash → no-op (returns changed: false and leaves updated_at alone).
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
  const draft = GarmentPayloadDraftSchema.parse({ ...(input as object), id: externalId });
  const completeness = completenessScore(draft);
  const missingFields = completeness.missing.map((m) => m.field);
  // Stored status = try-able for size advice (the same predicate GET /v1/try uses); the score stays
  // the full completeness (render and taste fields included).
  const status: 'active' | 'incomplete' = sizeAdviceGarment(draft).ok ? 'active' : 'incomplete';
  const hash = contentHash(draft);
  const existing = await db.query.products.findFirst({ where: and(eq(products.shopId, shopId), eq(products.externalId, externalId)) });
  if (existing && existing.contentHash === hash && existing.status !== 'archived') {
    if (opts.audienceSource !== undefined && opts.audienceSource !== existing.audienceSource) {
      // Same content, but the sync now knows the source (products stored before the column existed).
      const [row] = await db.update(products).set({ audienceSource: opts.audienceSource }).where(eq(products.id, existing.id)).returning();
      return { product: row!, changed: false, score: completeness.score, missingFields, status };
    }
    return { product: existing, changed: false, score: completeness.score, missingFields, status };
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
  };
  const [row] = await db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({ target: [products.shopId, products.externalId], set: values })
    .returning();
  await syncImages(db, row!.id, draft);
  return { product: row!, changed: true, score: completeness.score, missingFields, status };
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
 * advice does not read (`sizeAdviceGarment`). Null when category, chart type or chart is missing.
 */
export function asTryGarment(row: ProductRow, opts: { colorHex?: string } = {}): GarmentPayload | null {
  const r = sizeAdviceGarment(row.payload, opts);
  return r.ok ? r.garment : null;
}

/** A stored payload that validates as a full GarmentPayload (the app's deck needs every field). */
export function asGarment(row: ProductRow): GarmentPayload | null {
  const parsed = GarmentPayloadSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
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
    // Only for a men's product under the men's gate; absent otherwise, so the body is unchanged.
    ...(menGate ? { menGate } : {}),
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
