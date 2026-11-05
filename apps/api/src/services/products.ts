import { and, asc, desc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  GarmentPayloadDraftSchema,
  GarmentPayloadSchema,
  completenessScore,
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
export async function upsertProduct(db: Db, shopId: string, externalId: string, input: unknown, opts: { handle?: string | null } = {}): Promise<UpsertResult> {
  const draft = GarmentPayloadDraftSchema.parse({ ...(input as object), id: externalId });
  const completeness = completenessScore(draft);
  const missingFields = completeness.missing.map((m) => m.field);
  const hash = contentHash(draft);
  const existing = await db.query.products.findFirst({ where: and(eq(products.shopId, shopId), eq(products.externalId, externalId)) });
  if (existing && existing.contentHash === hash && existing.status !== 'archived') {
    return { product: existing, changed: false, score: completeness.score, missingFields, status: completeness.status };
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
    status: completeness.status as ProductStatus,
    score: completeness.score,
    missingFields,
    contentHash: hash,
    updatedAt: new Date(),
    archivedAt: null,
  };
  const [row] = await db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({ target: [products.shopId, products.externalId], set: values })
    .returning();
  await syncImages(db, row!.id, draft);
  return { product: row!, changed: true, score: completeness.score, missingFields, status: completeness.status };
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

/** A stored payload that validates as a full GarmentPayload (active products only). */
export function asGarment(row: ProductRow): GarmentPayload | null {
  const parsed = GarmentPayloadSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

export function toSummary(row: ProductRow, flatLayProcessedUrl: string | null = null): MerchantProductSummary {
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

export async function listActiveGarments(db: Db, shopId: string, q: { cursor?: string; category?: string; limit: number }) {
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
  const items = page.map(asGarment).filter((g): g is GarmentPayload => g !== null);
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > q.limit && last ? encodeIdCursor(last.externalId) : null };
}

export async function listMerchantProducts(db: Db, shopId: string, q: { status?: ProductStatus; cursor?: string; limit: number }) {
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
  return {
    items: page.map((p) => toSummary(p, flatByProduct.get(p.id) ?? null)),
    nextCursor: rows.length > q.limit && last ? encodeIdCursor(last.externalId) : null,
    counts,
  };
}

export const notArchived = () => or(isNull(products.archivedAt), sql`false`);
export const newestFirst = () => desc(products.updatedAt);
