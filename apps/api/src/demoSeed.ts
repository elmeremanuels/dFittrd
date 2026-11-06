/**
 * Local demo seed (docs/STANDALONE.md §4). Idempotent: running it again keeps the shops, their
 * public keys and the products. Used by `pnpm --filter @curtain/api demo` (src/demo.ts) and tested
 * in demoSeed.test.ts. Never used by the production server.
 */
import { eq } from 'drizzle-orm';
import { MOCK_GARMENTS_BY_ID, type GarmentPayload } from '@curtain/schema';
import type { Db } from './db/client.js';
import { shops, type ShopSettings } from './db/schema.js';
import type { Env } from './env.js';
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

export interface DemoProductInfo {
  externalId: string;
  name: string;
  brand: string;
  category: GarmentPayload['category'];
  priceEur: number | null;
  sizes: string[];
  photo: string | null;
  status: string;
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

export async function seedDemo(db: Db, env: Env, opts: { storefrontOrigin?: string; appOrigin?: string } = {}): Promise<DemoManifest> {
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
      });
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
