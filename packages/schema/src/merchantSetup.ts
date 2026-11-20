/**
 * The merchant's first-run checklist and the per-product "what to do next", in plain English (D21: one
 * English catalogue). Used by the Shopify embedded admin (through `GET /shopify/charts/onboarding`), the
 * merchant console (`GET /v1/merchant/setup`) and the WooCommerce settings page (a PHP copy of the words,
 * kept in step by `merchantSetup.test.ts`).
 *
 * The five steps a new shop walks, in order:
 *
 *   1. Connect              the shop is linked to Curtain
 *   2. Add a size chart     at least one product has a size chart (and says whether it is body or garment sizes)
 *   3. Measure one skirt    at least one product has the shop's own garment measurements (docs/MERCHANT-MEASUREMENTS.md)
 *   4. Turn the button on   the "Try it on" button is on the product page
 *   5. Check it on your phone  a size was shown on a product page
 *
 * Every step ticks itself from facts the api already has (products, try sessions, fit sessions); steps 4
 * and 5 can also be ticked by hand, because the api cannot look inside a theme. No fact here is about a
 * shopper: counts of the shop's own sessions only (rule 4).
 */
import type { GarmentTape } from './garmentTape';

export const SETUP_STEPS = ['connect', 'chart', 'measure', 'button', 'phone'] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number];

export type SetupPlatform = 'shopify' | 'woocommerce';

/** Where a step's button takes the merchant. The page maps each to its own screen. */
export const SETUP_TARGETS = ['connect', 'charts', 'measure', 'theme', 'phone'] as const;
export type SetupTarget = (typeof SETUP_TARGETS)[number];

export interface SetupFacts {
  connected: boolean;
  /** Products Curtain knows (not archived). 0 right after install, while the import runs. */
  productsTotal: number;
  /** Products with a size chart and its type. */
  productsWithChart: number;
  /** Products with at least one size the shop measured itself. */
  productsMeasured: number;
  /** "Try it on" was opened on a product page in the last 30 days (by anyone: the button is live). */
  buttonOpened: boolean;
  /** Sizes shown to shoppers in the last 30 days. */
  fitSessions: number;
  /** The merchant said the button is on (Shopify: saved the theme block). */
  buttonConfirmed: boolean;
  /** The merchant said they checked it on their phone. */
  phoneConfirmed: boolean;
}

export interface SetupStep {
  key: SetupStepKey;
  /** 1 to 5. */
  number: number;
  title: string;
  done: boolean;
  /** One or two plain sentences: what to do, or what was found. */
  detail: string;
  /** The button next to the step; null when the step needs no button (connected). */
  action: { label: string; target: SetupTarget } | null;
  /** Steps 4 and 5 can be ticked by hand: the label of that button, while not done. */
  confirmLabel: string | null;
  /** About how long the step takes a first-time merchant, in minutes (shown as a hint). */
  minutes: number;
}

export interface SetupProgress {
  steps: SetupStep[];
  next: SetupStepKey | null;
  doneCount: number;
  total: number;
  /** Heading line over the list. */
  headline: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Every word of the checklist (D21). */
export const MERCHANT_SETUP_TEXT = Object.freeze({
  heading: 'Get set up',
  intro: 'Five short steps to the “Try it on” button with a good size on your product pages. Each one ticks itself when it is done.',
  progress: (done: number, total: number): string => (done === total ? 'All done. Shoppers can find their size on your product pages.' : `${done} of ${total} done`),
  hideWhenDone: 'You can close this list; it stays under “Setup” if you need it again.',
  steps: {
    connect: {
      title: 'Connect your shop',
      todo: { shopify: 'Open Curtain from your Shopify admin (Apps → Curtain).', woocommerce: 'In WordPress, go to WooCommerce → Curtain and click “Connect to Curtain”.' },
      doneImporting: 'Connected. We are bringing in your products from your shop; this usually takes a minute or two.',
      done: (products: number) => `Connected. ${plural(products, 'product', 'products')} brought in from your shop.`,
      action: 'Connect',
      minutes: 1,
    },
    chart: {
      title: 'Add a size chart',
      todo: {
        shopify: 'Pick the standard size chart for your country (Australian sizes 6 to 20 are ready to use), untick the sizes you do not sell, and add it to your dresses and skirts in one go.',
        woocommerce: 'Open a dress or skirt under Products. In the Curtain box choose “Start from a template” (Australian sizes are ready to use), press “Use template”, remove the sizes you do not sell and press Update.',
      },
      done: (n: number) => `${plural(n, 'product has', 'products have')} a size chart.`,
      action: 'Add a size chart',
      minutes: 3,
    },
    measure: {
      title: 'Measure one skirt',
      todo: 'Lay one skirt flat and measure five numbers on three sizes (the smallest, the largest and one in between). About 3 minutes per size. This is what stops us recommending a size that will not go over the hips.',
      done: (n: number) => `${plural(n, 'product has', 'products have')} your own measurements. Thank you: these make the biggest difference.`,
      action: 'Measure a skirt',
      minutes: 10,
    },
    button: {
      title: 'Turn the button on',
      todo: {
        shopify: 'Open your theme editor: the “Try it on” block is already placed on your product page. Drag it under the size picker if you like, then press Save.',
        woocommerce: 'In WordPress, go to WooCommerce → Curtain, tick “Show button” and save. The button then appears on your product pages by itself.',
      },
      done: 'The “Try it on” button is on your product pages.',
      action: { shopify: 'Open the theme editor', woocommerce: 'Open the Curtain settings' },
      confirm: 'I have saved it',
      minutes: 2,
    },
    phone: {
      title: 'Check it on your phone',
      todo: {
        shopify: 'Scan the code with your phone’s camera (or open the link), tap “Try it on”, type a height and weight and see the size it suggests.',
        woocommerce: 'Open the product link below on your phone (send it to yourself), tap “Try it on”, type a height and weight and see the size it suggests.',
      },
      done: (n: number) => (n > 0 ? `${plural(n, 'size was', 'sizes were')} shown on your product pages in the last 30 days.` : 'You checked it on your phone.'),
      action: 'Show the code',
      confirm: 'It works on my phone',
      minutes: 2,
    },
  },
} as const);

/** The checklist for one shop. Pure: the same facts give the same list. */
export function merchantSetupSteps(f: SetupFacts, platform: SetupPlatform): SetupProgress {
  const t = MERCHANT_SETUP_TEXT.steps;
  const chartDone = f.productsWithChart > 0;
  const measureDone = f.productsMeasured > 0;
  const buttonDone = f.buttonConfirmed || f.buttonOpened || f.fitSessions > 0;
  const phoneDone = f.phoneConfirmed || f.fitSessions > 0;
  const steps: SetupStep[] = [
    {
      key: 'connect',
      number: 1,
      title: t.connect.title,
      done: f.connected,
      detail: !f.connected ? t.connect.todo[platform] : f.productsTotal === 0 ? t.connect.doneImporting : t.connect.done(f.productsTotal),
      action: f.connected ? null : { label: t.connect.action, target: 'connect' },
      confirmLabel: null,
      minutes: t.connect.minutes,
    },
    {
      key: 'chart',
      number: 2,
      title: t.chart.title,
      done: chartDone,
      detail: chartDone ? t.chart.done(f.productsWithChart) : t.chart.todo[platform],
      action: { label: t.chart.action, target: 'charts' },
      confirmLabel: null,
      minutes: t.chart.minutes,
    },
    {
      key: 'measure',
      number: 3,
      title: t.measure.title,
      done: measureDone,
      detail: measureDone ? t.measure.done(f.productsMeasured) : t.measure.todo,
      action: { label: t.measure.action, target: 'measure' },
      confirmLabel: null,
      minutes: t.measure.minutes,
    },
    {
      key: 'button',
      number: 4,
      title: t.button.title,
      done: buttonDone,
      detail: buttonDone ? t.button.done : t.button.todo[platform],
      action: { label: t.button.action[platform], target: 'theme' },
      confirmLabel: buttonDone ? null : t.button.confirm,
      minutes: t.button.minutes,
    },
    {
      key: 'phone',
      number: 5,
      title: t.phone.title,
      done: phoneDone,
      detail: phoneDone ? t.phone.done(f.fitSessions) : t.phone.todo[platform],
      action: { label: t.phone.action, target: 'phone' },
      confirmLabel: phoneDone ? null : t.phone.confirm,
      minutes: t.phone.minutes,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, next: steps.find((s) => !s.done)?.key ?? null, doneCount, total: steps.length, headline: MERCHANT_SETUP_TEXT.progress(doneCount, steps.length) };
}

// ---------------------------------------------------------------------------
// Per product: what to do next
// ---------------------------------------------------------------------------

/** True when the shop measured at least one size of this garment itself (not only our estimates). */
export function hasShopMeasurements(tape: GarmentTape | null | undefined): boolean {
  if (!Array.isArray(tape)) return false;
  return tape.some((row) => [row.waistRelaxed, row.waistStretched, row.hip, row.hemSweep, row.length].some((v) => v?.provenance === 'measured'));
}

export const PRODUCT_NEXT_STEPS = ['category', 'chart', 'chartType', 'measure', 'ready'] as const;
export type ProductNextStepKey = (typeof PRODUCT_NEXT_STEPS)[number];

export interface ProductNextStep {
  key: ProductNextStepKey;
  /** Short badge: "Not ready yet", "Ready", "Ready: better with measurements". */
  badge: string;
  tone: 'critical' | 'warning' | 'success';
  /** One plain sentence: the next thing to do for this product. */
  text: string;
  /** Button label for the action; null when there is nothing to do. */
  action: string | null;
  /** True when shoppers already get a size for it. */
  sizeAdvice: boolean;
}

/** Plain words for the completeness field keys the api returns (`missingFields`). Fields only the 3D view uses are not listed: they are not on the size-advice path. */
export const MISSING_FIELD_TEXT: Readonly<Record<string, string>> = Object.freeze({
  category: 'what kind of garment it is',
  sizeChartType: 'whether the chart is body or garment sizes',
  sizeChart: 'a size chart',
  'fabric.primary': 'the fabric',
  'fabric.stretchPct': 'how much it stretches',
  lengthCm: 'its length',
});

/** Kinds of garment where the waistband decides whether it goes on (the measurement check helps most). */
const BAND_CATEGORIES: ReadonlySet<string> = new Set(['bottom']);

export const PRODUCT_NEXT_TEXT = Object.freeze({
  category: { badge: 'Not ready yet', text: 'Tell us what kind of garment this is (dress, skirt, top…). Shopify’s product type or category is enough.', action: 'Edit product' },
  chart: { badge: 'Not ready yet', text: 'Add a size chart so shoppers can get a size.', action: 'Add a size chart' },
  chartType: { badge: 'Not ready yet', text: 'Say whether the size chart lists body sizes or garment sizes.', action: 'Open the size chart' },
  measureBand: { badge: 'Ready: better with measurements', text: 'Shoppers get a size. Measure the waistband on three sizes so we never suggest a size that will not pull over the hips.', action: 'Measure it' },
  measure: { badge: 'Ready: better with measurements', text: 'Shoppers get a size. Your own garment measurements would make it more exact.', action: 'Measure it' },
  ready: { badge: 'Ready', text: 'Shoppers get a size from your chart and your measurements.', action: null },
  archived: { badge: 'Hidden', text: 'Not published, so shoppers do not see it.', action: null },
} as const);

/**
 * The next step for one product of the products list. `missingFields` and `status` are the api's
 * (`MerchantProductSummary`); `measured` is `hasShopMeasurements` of its tape.
 */
export function productNextStep(p: { status: 'active' | 'incomplete' | 'archived'; category: string | null; missingFields: readonly string[]; measured?: boolean }): ProductNextStep {
  const T = PRODUCT_NEXT_TEXT;
  const missing = new Set(p.missingFields);
  if (p.status === 'archived') return { key: 'ready', ...T.archived, tone: 'warning', sizeAdvice: false };
  if (missing.has('category') || !p.category) return { key: 'category', ...T.category, tone: 'critical', sizeAdvice: false };
  if (missing.has('sizeChart')) return { key: 'chart', ...T.chart, tone: 'critical', sizeAdvice: false };
  if (missing.has('sizeChartType')) return { key: 'chartType', ...T.chartType, tone: 'critical', sizeAdvice: false };
  if (!p.measured) {
    const m = BAND_CATEGORIES.has(p.category) ? T.measureBand : T.measure;
    return { key: 'measure', ...m, tone: 'warning', sizeAdvice: p.status === 'active' };
  }
  return { key: 'ready', ...T.ready, tone: 'success', sizeAdvice: p.status === 'active' };
}

/**
 * The size-advice score shown to the merchant, 0 to 100: the three required fields (60), the shop's own
 * measurements (30) and the fabric (10). Unlike `completenessScore` it leaves out what only the 3D view
 * uses (flat-lay photo, drape, sheen…), so a product that gives shoppers a good size is not shown at 40 %.
 */
export function sizeAdviceScore(p: { category: string | null; missingFields: readonly string[]; measured?: boolean }): number {
  const missing = new Set(p.missingFields);
  let s = 0;
  if (p.category && !missing.has('category')) s += 20;
  if (!missing.has('sizeChart')) s += 20;
  if (!missing.has('sizeChartType')) s += 20;
  if (p.measured) s += 30;
  if (!missing.has('fabric.primary')) s += 10;
  return s;
}

// ---------------------------------------------------------------------------
// Plan, billing and leaving
// ---------------------------------------------------------------------------

/** Plan, uninstall and data-deletion words shared by the Shopify admin and the merchant console. */
export const MERCHANT_PLAN_TEXT = Object.freeze({
  heading: 'Your plan',
  price: (usd: number) => `US$${usd.toFixed(2)} a month`,
  oneLine: 'One plan, one flat price. Every shopper who tries a size is included; nothing is charged per try.',
  arranged:
    'You installed Curtain by a private link, so Shopify cannot put Curtain on your Shopify bill. Curtain arranges payment with you directly; nothing is charged through Shopify.',
  arrangedInactive: 'Your plan is not active yet. Email Curtain and we switch it on; until then shoppers see a short “taking a break” note instead of a size.',
  shopifyBilling: 'Charged on your Shopify bill once you approve it. You can cancel at any time by uninstalling the app.',
  trial: (days: number) => `The first ${days} days are free.`,
  pausedNote: 'While the plan is paused the button is hidden on your product pages. It comes back when the plan is active again.',
  leaving: {
    heading: 'Leaving Curtain',
    steps: {
      shopify: [
        'In your Shopify admin go to Settings → Apps and sales channels → Curtain → Uninstall.',
        'The “Try it on” button disappears from your theme by itself; you do not need to edit the theme.',
        'Billing stops the moment you uninstall.',
      ],
      woocommerce: [
        'In WordPress go to WooCommerce → Curtain → Disconnect, then Plugins → Curtain for WooCommerce → Deactivate → Delete.',
        'The button disappears as soon as you disconnect; nothing more is sent to Curtain.',
        'Disconnecting does not cancel the payment: email Curtain support and we cancel your plan the same day.',
      ],
    },
    data: {
      shopify: [
        'Your size charts and measurements stay in your shop’s own product data, so you keep them if you come back.',
        'On our side your shop, its products and its usage counts are deleted by themselves 48 hours after you uninstall.',
        'We never held a shopper’s photo, measurement or name, so there is nothing about your customers to delete.',
      ],
      woocommerce: [
        'Your size charts and measurements stay in WooCommerce. To remove them too, tick “Delete all Curtain settings and product fit data when the plugin is uninstalled” on the Curtain settings page and save before you delete the plugin.',
        'To have your shop, its products and its usage counts deleted on our side, email Curtain support after you disconnect.',
        'We never held a shopper’s photo, measurement or name, so there is nothing about your customers to delete.',
      ],
    },
  },
} as const);

/** The kind of garment in plain words (the `category` vocabulary of the garment payload). */
export const CATEGORY_TEXT: Readonly<Record<string, string>> = Object.freeze({
  top: 'Top',
  bottom: 'Skirt or trousers',
  dress: 'Dress',
  outerwear: 'Jacket or coat',
  shoes: 'Shoes',
  accessory: 'Accessory',
});

/** The plan and leaving words of one platform, as plain JSON (no functions) for a static page's config. */
export function merchantPlanText(platform: SetupPlatform, priceUsd = 8.99) {
  const t = MERCHANT_PLAN_TEXT;
  return {
    price: t.price(priceUsd),
    oneLine: t.oneLine,
    arranged: t.arranged,
    arrangedInactive: t.arrangedInactive,
    shopifyBilling: t.shopifyBilling,
    pausedNote: t.pausedNote,
    leaving: { heading: t.leaving.heading, steps: [...t.leaving.steps[platform]], data: [...t.leaving.data[platform]] },
  };
}
