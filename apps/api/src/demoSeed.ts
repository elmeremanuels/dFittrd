/**
 * Local demo seed (docs/STANDALONE.md §4). Idempotent: running it again keeps the shops, their
 * public keys and the products. Used by `pnpm --filter @curtain/api demo` (src/demo.ts) and tested
 * in demoSeed.test.ts. Never used by the production server.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { checkGarmentTapeInput, garmentQaFlags, MOCK_GARMENTS_BY_ID, type AudienceSource, type GarmentPayload, type GarmentQaFlag, type MeasuredTapeInputRow } from '@curtain/schema';
import type { Db } from './db/client.js';
import { shops, type ShopSettings } from './db/schema.js';
import type { Env } from './env.js';
import { approveAsset, AssetImportError, importBundle, rejectAsset } from './services/assets.js';
import { embedAllowedOrigins } from './services/embed.js';
import { upsertProduct } from './services/products.js';
import { createShop, findShopByDomain, issueMerchantKeys } from './services/shops.js';

export const DEMO_STOREFRONT_ORIGIN = 'http://localhost:5180';
export const DEMO_APP_ORIGIN = 'http://localhost:3000';

export interface DemoShopSpec {
  key: 'woocommerce' | 'shopify';
  platform: 'woocommerce' | 'shopify';
  domain: string;
  name: string;
  /** Storefront path of this shop's product page style in the demo storefront. */
  storefrontPath: string;
  products: string[];
}

/** Dresses, tops and bottoms (plus one jacket) from the schema fixtures. */
export const DEMO_SHOPS: DemoShopSpec[] = [
  {
    key: 'woocommerce',
    platform: 'woocommerce',
    domain: 'aalter-studio.localhost',
    name: 'Aalter Studio',
    storefrontPath: '/woo/',
    products: [
      'aalter-studio-1',
      'aalter-studio-2',
      'rue-marais-dress-01',
      'linde-dress-01',
      'monochrome-02',
      'brouwer-knit-01',
      'noord-top-01',
      'rue-marais-top-01',
      'raw-denim-01',
      'noord-bottom-01',
      'rue-marais-bottom-01',
      'aalter-outer-01',
    ],
  },
  {
    key: 'shopify',
    platform: 'shopify',
    domain: 'aalter-studio-demo.myshopify.com',
    name: 'Aalter Studio (Shopify)',
    storefrontPath: '/dawn/',
    products: ['aalter-studio-1', 'kaap-dress-01', 'noord-dress-01', 'monochrome-03', 'linde-top-01', 'kaap-top-01', 'indigo-03', 'kaap-bottom-01', 'linde-bottom-01'],
  },
];

/**
 * A garment bundle for the demo's optional 3D estimate (D16). Bundles are git-ignored, generated or
 * shop-derived files: when `dir` is missing the product simply has no 3D view (today's flow).
 * `payload: true` takes the product itself from the bundle's payload.json (an evaluated shop
 * product that is not a schema fixture); its photos are replaced by the storefront's illustration.
 */
export interface DemoGarmentBundle {
  shop: DemoShopSpec['key'];
  externalId: string;
  dir: string;
  payload?: boolean;
  /** Storefront illustration colour (and its colourway name) for a product from payload.json. */
  colorHex?: string;
  colorName?: string;
  /**
   * The QA flags this bundle must import with, exactly (`garmentQaFlags`; default none). The low-rise skirt names
   * `low_rise_waist` and `precalibration_outside_tolerance`: the import gate passes it only under that recorded reading,
   * and any other outcome (refused, or passed with other flags) leaves the product without 3D instead of approving it.
   */
  qaFlags?: GarmentQaFlag[];
  /**
   * The product itself when the bundle folder (git-ignored) is missing: the product is then seeded
   * without 3D instead of being left out, so the size advice can be shown on every checkout.
   */
  fallbackPayload?: GarmentPayload;
  /**
   * What the shop typed in its "Garment measurements" form (closure, the sizes it measured). Run
   * through the same check and fill as the merchant admins (`checkGarmentTapeInput`); a check with
   * an error stops the seed.
   */
  tape?: { closure: string | null; measured: readonly MeasuredTapeInputRow[] };
  /**
   * Where the product's audience was read from, as a Shopify sync stores it (`upsertProduct`). The
   * men's gate gates only a known strong source, so a men's demo product passes `productType`.
   */
  audienceSource?: AudienceSource;
}

/** The closure and filled tape a merchant's form would store for this product. */
export function demoTapeFields(g: Pick<GarmentPayload, 'category' | 'sizeChart'>, tape: NonNullable<DemoGarmentBundle['tape']>): Pick<GarmentPayload, 'closure' | 'garmentTape'> {
  const check = checkGarmentTapeInput({ category: g.category, chart: g.sizeChart, closure: tape.closure, measured: tape.measured });
  if (!check.ok) throw new Error(`demo seed: garment tape refused: ${check.errors.map((e) => e.message).join(' ')}`);
  return { ...(check.closure ? { closure: check.closure } : {}), ...(check.garmentTape ? { garmentTape: check.garmentTape } : {}) };
}

/** Storefront details of a product that is not a schema fixture (the demo storefront draws it from these). */
export interface DemoProductDetails {
  name: string;
  category: string;
  subcategory?: string;
  patternBlock?: string;
  primaryColorHex: string;
  colorways: { name: string; hex: string }[];
  sizeChart: GarmentPayload['sizeChart'];
  sizeChartType?: string;
  lengthCm: Record<string, number>;
}

export interface DemoProductInfo {
  externalId: string;
  name: string;
  brand: string;
  category: GarmentPayload['category'];
  priceEur: number | null;
  sizes: string[];
  photo: string | null;
  status: string;
  /** The approved 3D bundle version when the product has the 3D estimate (D16), else null. */
  asset3d: string | null;
  /** QA readings that bundle passed under (`garmentQaFlags`, e.g. `low_rise_waist`): shown, never silent. */
  asset3dFlags?: GarmentQaFlag[];
  details?: DemoProductDetails;
}

export interface DemoShopInfo {
  key: DemoShopSpec['key'];
  shopId: string;
  name: string;
  platform: DemoShopSpec['platform'];
  publicKey: string;
  allowedOrigins: string[];
  products: DemoProductInfo[];
}

export interface DemoManifest {
  generatedAt: string;
  apiUrl: string;
  appUrl: string;
  sdkUrl: string;
  storefrontOrigin: string;
  /** The primary demo shop ("Aalter Studio", WooCommerce) for convenience. */
  publicKey: string;
  productExternalIds: string[];
  shops: DemoShopInfo[];
}

export async function seedDemo(
  db: Db,
  env: Env,
  opts: { storefrontOrigin?: string; appOrigin?: string; bundles?: DemoGarmentBundle[]; warn?: (message: string) => void } = {},
): Promise<DemoManifest> {
  const warn = opts.warn ?? ((m: string) => console.warn(`[demo seed] ${m}`));
  const storefront = opts.storefrontOrigin ?? DEMO_STOREFRONT_ORIGIN;
  const appOrigin = opts.appOrigin ?? DEMO_APP_ORIGIN;
  const embedOrigins = [...new Set([storefront, appOrigin])];
  const out: DemoShopInfo[] = [];

  for (const spec of DEMO_SHOPS) {
    const settings: ShopSettings = {
      brandColor: '#FF5A3C',
      embedOrigins,
      ...(spec.platform === 'woocommerce' ? { siteUrl: storefront } : {}),
    };
    let shop = await findShopByDomain(db, spec.domain);
    if (!shop) shop = await createShop(db, { platform: spec.platform, domain: spec.domain, name: spec.name, plan: 'curtain', settings });
    // Keep the demo usable even if someone paused it in an earlier run.
    await db
      .update(shops)
      .set({ name: spec.name, plan: 'curtain', paused: false, uninstalledAt: null, settings: { ...shop.settings, ...settings }, updatedAt: new Date() })
      .where(eq(shops.id, shop.id));
    // pk_test_… built at runtime by the key service (never a literal); stable across runs.
    if (!shop.apiKeyPrefix) await issueMerchantKeys(db, env, shop);
    const fresh = (await findShopByDomain(db, spec.domain))!;

    const products: DemoProductInfo[] = [];
    for (const id of spec.products) {
      const g = MOCK_GARMENTS_BY_ID[id];
      if (!g) throw new Error(`demo seed: no fixture garment ${id}`);
      // UX-3: the fixtures' placeholder photos (a third-party host) become the demo storefront's own
      // illustration, so the embed header shows the same garment and the demo makes no outside request.
      const photo = `${storefront}/img/${encodeURIComponent(id)}.svg`;
      const r = await upsertProduct(db, fresh.id, id, { ...g, productPhotos: [photo], flatLayPhoto: photo });
      products.push({
        externalId: id,
        name: g.name,
        brand: g.brand,
        category: g.category,
        priceEur: g.priceEur ?? null,
        sizes: g.sizeChart.map((s) => s.size),
        photo,
        status: r.product.status,
        asset3d: null,
      });
    }
    const hasBundle = (b: DemoGarmentBundle) => existsSync(join(b.dir, 'base.glb'));
    const bundles = (opts.bundles ?? []).filter((b) => b.shop === spec.key && (hasBundle(b) || (b.payload && b.fallbackPayload)));
    // Products from payload.json go first, in the order the bundles are listed.
    let payloadAt = 0;
    for (const b of bundles) {
      if (b.payload) {
        const fromBundle = existsSync(join(b.dir, 'payload.json'));
        const raw0 = fromBundle ? (JSON.parse(readFileSync(join(b.dir, 'payload.json'), 'utf8')) as GarmentPayload) : b.fallbackPayload!;
        // The shop's garment measurements, as its admin form would have stored them.
        const raw: GarmentPayload = b.tape ? { ...raw0, ...demoTapeFields(raw0, b.tape) } : raw0;
        const photo = `${storefront}/img/${encodeURIComponent(b.externalId)}.svg`;
        const color = b.colorHex ?? '#4F8FC0';
        const colorName = b.colorName ?? 'Azure';
        // Shop photos never enter the demo: the storefront draws the garment itself.
        const g = { ...raw, id: b.externalId, productUrl: undefined, productPhotos: [photo], flatLayPhoto: photo, primaryColorHex: color };
        const r = await upsertProduct(db, fresh.id, b.externalId, g, b.audienceSource ? { audienceSource: b.audienceSource } : {});
        const info: DemoProductInfo = {
          externalId: b.externalId,
          name: raw.name,
          brand: raw.brand,
          category: raw.category,
          priceEur: raw.priceEur ?? null,
          sizes: raw.sizeChart.map((x) => x.size),
          photo,
          status: r.product.status,
          asset3d: null,
          details: { name: raw.name, category: raw.category, subcategory: raw.subcategory, patternBlock: raw.patternBlock, primaryColorHex: color, colorways: [{ name: colorName, hex: color }], sizeChart: raw.sizeChart, sizeChartType: raw.sizeChartType, lengthCm: (raw.lengthCm ?? {}) as Record<string, number> },
        };
        const at = products.findIndex((p) => p.externalId === b.externalId);
        if (at >= 0) products[at] = info;
        else products.splice(payloadAt++, 0, info);
      }
      const product = products.find((p) => p.externalId === b.externalId);
      if (!product || !hasBundle(b)) continue;
      let asset;
      try {
        ({ asset } = await importBundle(db, env, fresh.id, b.externalId, b.dir));
      } catch (err) {
        // The import gate refused it (e.g. qa_failed): that product has no 3D view; the demo still starts.
        if (!(err instanceof AssetImportError)) throw err;
        warn(`${b.externalId}: ${err.message} (${b.dir}); the product is shown without 3D`);
        continue;
      }
      const flags = garmentQaFlags(asset.qa as { chartAgreement?: { waistReading?: unknown } }) ?? [];
      const want = [...(b.qaFlags ?? [])].sort();
      if (flags.length !== want.length || [...flags].sort().some((f, i) => f !== want[i])) {
        warn(`${b.externalId}: bundle ${asset.version} passed the import gate with QA flags [${flags.join(', ')}], expected [${want.join(', ')}]; not approved, the product is shown without 3D`);
        if (asset.status === 'approved') await rejectAsset(db, fresh.id, asset.id, `demo seed: QA flags [${flags.join(', ')}], expected [${want.join(', ')}]`);
        continue;
      }
      // The demo merchant approves its own bundle (D13), standing in for a person; a real shop does this in the admin,
      // where the asset API gives each flag a plain sentence (`qaNotes`) and no approval screen shows them yet.
      if (asset.status !== 'approved') await approveAsset(db, fresh.id, asset.id, 'demo-seed');
      product.asset3d = asset.version;
      if (flags.length) product.asset3dFlags = flags;
    }
    if (bundles.some(hasBundle)) {
      await db
        .update(shops)
        .set({ settings: { ...fresh.settings, garment3d: true } })
        .where(eq(shops.id, fresh.id));
    }
    out.push({
      key: spec.key,
      shopId: fresh.id,
      name: fresh.name,
      platform: spec.platform,
      publicKey: fresh.apiKeyPrefix!,
      allowedOrigins: embedAllowedOrigins(fresh, null),
      products,
    });
  }

  const primary = out[0]!;
  return {
    generatedAt: new Date().toISOString(),
    apiUrl: env.PUBLIC_API_URL,
    appUrl: env.PUBLIC_APP_URL,
    sdkUrl: `${env.PUBLIC_API_URL}/sdk/v1.js`,
    storefrontOrigin: storefront,
    publicKey: primary.publicKey,
    productExternalIds: primary.products.map((p) => p.externalId),
    shops: out,
  };
}
