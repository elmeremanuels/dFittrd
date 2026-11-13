/**
 * Pure parts of the size chart builder in the embedded admin: the per-product completeness
 * checklist with its "Try it on" preview link, and the first-run onboarding steps.
 */
import {
  completenessScore,
  fromShopifyProduct,
  sizeAdviceGarment,
  SIZE_ADVICE_FIELDS,
  shopifyExternalId,
  type GarmentPayload,
  type OnboardingStepKey,
} from '@curtain/schema';
import { adminProductUrl } from './deepLinks';
import type { ProductDetailNode, OnboardingState } from './graphql/charts';

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  /** Without it the product is not try-able: a `SIZE_ADVICE_FIELDS` field (the same predicate as GET /v1/try). */
  required: boolean;
  hint: string;
}

export interface ProductChecklist {
  productId: string;
  title: string;
  /** `active` = a shopper can get a size now (`sizeAdviceGarment` resolves). */
  status: 'active' | 'incomplete';
  score: number;
  items: ChecklistItem[];
  previewUrl: string | null;
  adminUrl: string;
}

/** Checklist rows, in the order a merchant fixes them. `fields` are completeness paths (prefix match). */
const ITEMS: ReadonlyArray<{ key: string; label: string; fields: readonly string[]; hint: string }> = [
  { key: 'sizeChartType', label: 'Chart type (body or garment)', fields: ['sizeChartType'], hint: 'Say whether the rows are the body each size fits or the finished garment. The same numbers give a different size.' },
  { key: 'sizeChart', label: 'Size chart', fields: ['sizeChart'], hint: 'Assign a template or enter the garment measurements per size.' },
  { key: 'category', label: 'Category', fields: ['category'], hint: 'Inferred from the product type; set it when the type is unusual.' },
  { key: 'fabric', label: 'Fabric and stretch', fields: ['fabric.primary', 'fabric.stretchPct', 'fabric.drape'], hint: 'Recommended. Stretch decides how much tighter a size may be; without it Curtain assumes a non-stretch woven. Import it from the description or set it in Metafields → Curtain.' },
  { key: 'lengthCm', label: 'Lengths', fields: ['lengthCm'], hint: 'Optional. Shoulder to hem places the hem on the shopper.' },
];

/**
 * Rows that only matter for the 3D try-on (D12), which is not part of the size-advice plan (D17).
 * Shown only when `opts.render` is set, and never required.
 */
const RENDER_ITEMS: typeof ITEMS = [
  { key: 'flatLayPhoto', label: 'Flat-lay photo', fields: ['flatLayPhoto'], hint: 'Only for the 3D try-on. The garment laid flat on white.' },
];

/** The storefront page with the button: the live URL, or the preview URL while unpublished. */
export function tryItOnPreviewUrl(node: Pick<ProductDetailNode, 'onlineStoreUrl' | 'onlineStorePreviewUrl'>): string | null {
  const url = node.onlineStoreUrl || node.onlineStorePreviewUrl;
  return url && /^https:\/\//.test(url) ? url : null;
}

const TRYABLE_FIELDS: ReadonlySet<string> = new Set(SIZE_ADVICE_FIELDS);

export function productChecklist(node: ProductDetailNode, shopDomain: string, defaultBrand = 'shop', opts: { render?: boolean } = {}): ProductChecklist {
  const draft: Partial<GarmentPayload> = fromShopifyProduct(node, undefined, { defaultBrand });
  const c = completenessScore(draft);
  const missing = new Map(c.missing.map((m) => [m.field, m]));
  const applicable = new Set(c.checked);
  const items: ChecklistItem[] = [];
  for (const it of opts.render ? [...ITEMS, ...RENDER_ITEMS] : ITEMS) {
    const fields = it.fields.filter((f) => applicable.has(f));
    if (!fields.length) continue;
    const gaps = fields.map((f) => missing.get(f)).filter((m): m is NonNullable<typeof m> => m !== undefined);
    items.push({ key: it.key, label: it.label, done: gaps.length === 0, required: fields.some((f) => TRYABLE_FIELDS.has(f)), hint: it.hint });
  }
  const productId = shopifyExternalId(node.id);
  const status = sizeAdviceGarment(draft).ok ? 'active' : 'incomplete';
  return { productId, title: node.title, status, score: c.score, items, previewUrl: tryItOnPreviewUrl(node), adminUrl: adminProductUrl(shopDomain, productId) };
}

/** The heavy completeness fields (a test keeps this in step with `completenessScore`). */
export const HEAVY_FIELDS: ReadonlySet<string> = new Set(['sizeChartType', 'sizeChart', 'category', 'fabric.primary', 'flatLayPhoto']);

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export interface OnboardingFacts extends OnboardingState {
  connected: boolean;
  /** Synced products that have a size chart. */
  productsWithChart: number;
  /** Fit results shown to shoppers in the last 30 days (proof the block works). */
  fitSessions: number;
}

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  done: boolean;
  detail: string;
}

export function onboardingSteps(f: OnboardingFacts): { steps: OnboardingStep[]; next: OnboardingStepKey | null } {
  const steps: OnboardingStep[] = [
    { key: 'connect', label: 'Connect this store', done: f.connected, detail: f.connected ? 'Connected.' : 'Open the app from your Shopify admin.' },
    {
      key: 'template',
      label: 'Pick a size chart template',
      // A chart that reached products proves a template was picked, even if the pick was never saved.
      done: f.templateId !== null || f.productsWithChart > 0,
      detail: f.templateId ? `Template: ${f.templateId}.` : f.productsWithChart > 0 ? 'A chart is assigned.' : 'Your region’s body chart (AU, UK, EU, US), or garment measurements you fill in.',
    },
    {
      key: 'assign',
      label: 'Assign it to products',
      done: f.productsWithChart > 0,
      detail: f.productsWithChart > 0 ? `${f.productsWithChart} product(s) have a size chart.` : 'By collection, tag, product type, or pick products.',
    },
    {
      key: 'themeBlock',
      label: 'Add the “Try it on” block to your theme',
      done: f.themeBlockConfirmed || f.fitSessions > 0,
      detail: 'Opens the theme editor with the block on your product template. Save the theme, then mark this step done.',
    },
    {
      key: 'test',
      label: 'Test it on a product',
      done: f.tested || f.fitSessions > 0,
      detail: f.fitSessions > 0 ? `${f.fitSessions} size recommendation(s) shown to shoppers.` : 'Open a product with a chart, click “Try it on” and get a size.',
    },
  ];
  return { steps, next: steps.find((s) => !s.done)?.key ?? null };
}
