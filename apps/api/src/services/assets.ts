/**
 * Garment assets (docs/ENGINE-HANDOFF.md §Stage 8, D13, D16): import a bundle directory, approve or
 * reject it, and the asset ref `GET /v1/try` hands the embed.
 *
 * - Import copies the five bundle files (never payload.json, renders or photos) to
 *   ASSET_DIR/<shopId>/<productId>/<version>/, version = the first 16 hex of their sha256. It is
 *   idempotent per version, and every import starts as `awaiting_approval`.
 * - Approval (the merchant, D13) sets `products.active_asset_version` and supersedes the previous one.
 * - `activeAssetRef` is null unless the shop has the 3D estimate switched on (`settings.garment3d`,
 *   until D17 prices it), the active version is approved, and the bundle still covers the live chart.
 *
 * No shopper data is involved anywhere: the files are public product data.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, desc, eq, ne } from 'drizzle-orm';
import { checkGarmentBundle, GARMENT_BUNDLE_FILES, garmentQaFlagNote, garmentQaFlags, type GarmentAssetRef, type GarmentBundleMeta, type GarmentBundleProblem, type GarmentPayload, type MerchantGarmentAsset } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { garmentAssets, products, type ShopSettings } from '../db/schema.js';
import type { Env } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';

type AssetRow = typeof garmentAssets.$inferSelect;
type ProductRow = typeof products.$inferSelect;

export class AssetImportError extends Error {
  constructor(readonly problem: GarmentBundleProblem | 'missing_file') {
    super(`bundle rejected: ${problem}`);
  }
}

export interface BundleOnDisk {
  version: string;
  bytes: number;
  baseSize: string;
  sizes: string[];
  qa: Record<string, unknown>;
  inputHash: string | null;
}

/** Read and check a bundle directory against the product's chart sizes. */
export async function readBundleDir(dir: string, chartSizes: readonly string[]): Promise<BundleOnDisk> {
  const hash = createHash('sha256');
  const json: Record<string, Record<string, unknown>> = {};
  let bytes = 0;
  for (const name of GARMENT_BUNDLE_FILES) {
    let buf: Buffer;
    try {
      buf = await readFile(join(dir, name));
    } catch {
      throw new AssetImportError('missing_file');
    }
    bytes += buf.length;
    hash.update(`${name}\0${buf.length}\0`).update(buf);
    if (name.endsWith('.json')) {
      try {
        json[name] = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
      } catch {
        throw new AssetImportError('format');
      }
    }
  }
  const r = checkGarmentBundle({ anchors: json['anchors.json']!, grading: json['grading.json']!, material: json['material.json']!, qa: json['qa.json']!, bytes }, chartSizes);
  if (!r.ok) throw new AssetImportError(r.problem);
  const qa = json['qa.json']!;
  return { version: hash.digest('hex').slice(0, 16), bytes, baseSize: r.info.baseSize, sizes: r.info.sizes, qa, inputHash: typeof qa.inputHash === 'string' ? qa.inputHash : null };
}

const chartSizesOf = (p: ProductRow): string[] => (Array.isArray(p.payload.sizeChart) ? p.payload.sizeChart.map((r) => String((r as { size?: unknown }).size ?? '')) : []);

export function assetDir(env: Env, shopId: string, productId: string, version: string): string {
  return resolve(env.ASSET_DIR, shopId, productId, version);
}

/** Import a bundle for a product of the shop. Idempotent per version; always `awaiting_approval` when new. */
export async function importBundle(db: Db, env: Env, shopId: string, productExternalId: string, dir: string): Promise<{ asset: AssetRow; created: boolean }> {
  const product = await db.query.products.findFirst({ where: and(eq(products.shopId, shopId), eq(products.externalId, productExternalId)) });
  if (!product) throw notFound('product');
  const bundle = await readBundleDir(dir, chartSizesOf(product));
  const existing = await db.query.garmentAssets.findFirst({ where: and(eq(garmentAssets.productId, product.id), eq(garmentAssets.version, bundle.version)) });
  if (existing) {
    // Re-importing the same bytes after a merchant rejection puts that version back up for review.
    if (existing.status !== 'rejected') return { asset: existing, created: false };
    const [reopened] = await db.update(garmentAssets).set({ status: 'awaiting_approval', rejectReason: null }).where(eq(garmentAssets.id, existing.id)).returning();
    return { asset: reopened!, created: false };
  }
  const target = assetDir(env, shopId, product.id, bundle.version);
  const tmp = `${target}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  for (const name of GARMENT_BUNDLE_FILES) await copyFile(join(dir, name), join(tmp, name));
  await rm(target, { recursive: true, force: true });
  await rename(tmp, target);
  const [asset] = await db
    .insert(garmentAssets)
    .values({ shopId, productId: product.id, version: bundle.version, status: 'awaiting_approval', qa: bundle.qa, baseSize: bundle.baseSize, sizes: bundle.sizes, bundlePath: target, bytes: bundle.bytes, inputHash: bundle.inputHash })
    .returning();
  return { asset: asset!, created: true };
}

async function ownAsset(db: Db, shopId: string, assetId: string): Promise<AssetRow> {
  const a = await db.query.garmentAssets.findFirst({ where: and(eq(garmentAssets.id, assetId), eq(garmentAssets.shopId, shopId)) });
  if (!a) throw notFound('asset');
  return a;
}

/** D13: the merchant approves a version; it goes live and the previous live version is superseded. */
export async function approveAsset(db: Db, shopId: string, assetId: string, by: string, now: Date = new Date()): Promise<AssetRow> {
  const a = await ownAsset(db, shopId, assetId);
  if (a.status === 'rejected') throw badRequest('asset_rejected', 'a rejected asset cannot be approved; import the bundle again to put it back up for review');
  await db
    .update(garmentAssets)
    .set({ status: 'superseded' })
    .where(and(eq(garmentAssets.productId, a.productId), eq(garmentAssets.status, 'approved'), ne(garmentAssets.id, a.id)));
  const [row] = await db.update(garmentAssets).set({ status: 'approved', approvedAt: now, approvedBy: by, rejectReason: null }).where(eq(garmentAssets.id, a.id)).returning();
  await db.update(products).set({ activeAssetVersion: a.version, updatedAt: now }).where(eq(products.id, a.productId));
  return row!;
}

export async function rejectAsset(db: Db, shopId: string, assetId: string, reason: string, now: Date = new Date()): Promise<AssetRow> {
  const a = await ownAsset(db, shopId, assetId);
  const [row] = await db.update(garmentAssets).set({ status: 'rejected', rejectReason: reason }).where(eq(garmentAssets.id, a.id)).returning();
  const product = await db.query.products.findFirst({ where: eq(products.id, a.productId) });
  if (product?.activeAssetVersion === a.version) await db.update(products).set({ activeAssetVersion: null, updatedAt: now }).where(eq(products.id, a.productId));
  return row!;
}

export async function listAssets(db: Db, shopId: string, productExternalId: string): Promise<MerchantGarmentAsset[]> {
  const product = await db.query.products.findFirst({ where: and(eq(products.shopId, shopId), eq(products.externalId, productExternalId)) });
  if (!product) throw notFound('product');
  const rows = await db.query.garmentAssets.findMany({ where: eq(garmentAssets.productId, product.id), orderBy: [desc(garmentAssets.createdAt)], limit: 100 });
  return rows.map((r) => assetDto(r, product));
}

export function assetDto(r: AssetRow, product: Pick<ProductRow, 'externalId' | 'activeAssetVersion'>): MerchantGarmentAsset {
  const qa = r.qa as GarmentBundleMeta['qa'];
  const pass = qa.chartAgreement?.pass === true;
  const flags = garmentQaFlags(qa) ?? [];
  return {
    id: r.id,
    productExternalId: product.externalId,
    version: r.version,
    status: r.status,
    live: r.status === 'approved' && product.activeAssetVersion === r.version,
    bytes: r.bytes,
    baseSize: r.baseSize,
    sizes: r.sizes,
    qaPass: pass,
    // A reading the bundle passed under by a recorded decision (a low-rise waist): shown to the merchant, never silent.
    qaFlags: flags,
    qaNotes: flags.map((f) => garmentQaFlagNote(f, qa)),
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectReason: r.rejectReason,
  };
}

export function assetBaseUrl(env: Env): string {
  return (env.ASSET_BASE_URL ?? `${env.PUBLIC_API_URL.replace(/\/+$/, '')}/assets`).replace(/\/+$/, '');
}

/**
 * The asset ref for `GET /v1/try`, or null: the shop has the 3D estimate on, the product's active
 * version is approved, and the bundle grades every size of the live chart (else today's flow).
 */
export async function activeAssetRef(db: Db, env: Env, shop: { id: string; settings: ShopSettings }, product: ProductRow, garment: GarmentPayload): Promise<GarmentAssetRef | null> {
  if (shop.settings.garment3d !== true || !product.activeAssetVersion) return null;
  const a = await db.query.garmentAssets.findFirst({ where: and(eq(garmentAssets.productId, product.id), eq(garmentAssets.version, product.activeAssetVersion)) });
  if (!a || a.status !== 'approved' || a.shopId !== shop.id) return null;
  const r = checkGarmentBundle(
    {
      anchors: { format: 'curtain.garment.anchors' },
      grading: { format: 'curtain.garment.grading', baseSize: a.baseSize, sizes: a.sizes.map((size) => ({ size })) },
      material: { format: 'curtain.garment.material' },
      qa: a.qa as { format?: unknown; chartAgreement?: { pass?: unknown } },
      bytes: a.bytes,
    },
    garment.sizeChart.map((row) => row.size),
  );
  if (!r.ok) return null;
  try {
    await stat(join(a.bundlePath, 'base.glb'));
  } catch {
    return null; // the files are gone (volume not restored): no 3D, never a broken button
  }
  return { version: a.version, baseUrl: `${assetBaseUrl(env)}/${shop.id}/${product.id}/${a.version}`, baseSize: r.info.baseSize, sizes: r.info.sizes, label: 'estimate' };
}
