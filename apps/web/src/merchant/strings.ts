/**
 * English strings of the merchant console (DECISIONS.md D21: one English catalogue per surface, read through one
 * lookup; a translation pack is one more catalogue). Every word the console itself writes is here: the login, the
 * sections, the first-run checklist's own lines, the plan display and the 3D estimate review. Words that reach the
 * console from elsewhere stay where they are: the checklist steps and plan lines of @curtain/schema, and the api's
 * own product advice. `strings.test.ts` fails when interface text is written inline in the console again.
 */
import type { BakeCheckId, GarmentAssetStatus, SetupResponse, TapeProvenance } from '@curtain/schema';

export interface AssetReviewCatalogue {
  title: (product: string) => string;
  back: string;
  intro: string;
  none: string;
  loading: string;
  loadFailed: string;
  open3d: string;
  status: Record<GarmentAssetStatus, string>;
  live: string;
  version: (version: string, mb: string, date: string) => string;
  estimate: string;
  check: {
    title: string;
    passed: string;
    passedDone: string;
    refused: string;
    notRun: string;
    none: string;
    checked: (date: string) => string;
    reason: (reason: string) => string;
    titles: Record<BakeCheckId, string>;
    passMark: string;
    failMark: string;
    notRunMark: string;
  };
  tape: {
    title: string;
    intro: string;
    hipAt: (cm: number | null) => string;
    size: string;
    source: string;
    hip: string;
    hem: string;
    band: string;
    draped: string;
    drapedRange: (lo: number, hi: number) => string;
    provenance: Record<TapeProvenance, string>;
    provenanceNote: Record<TapeProvenance, string>;
    notDrawn: (size: string, hips: string, reason: string) => string;
    measureMore: string;
    cm: (n: number) => string;
    none: string;
  };
  flags: { title: string };
  actions: { approve: string; reject: string; reasonLabel: string; reasonPlaceholder: string; confirmReject: string; cancel: string; working: string; refusedHelp: string; failed: string };
  rejected: (reason: string) => string;
}

/** Why analytics come in whole months and why a row is hidden (launch-readiness finding 1, D3). */
export interface AnalyticsCatalogue {
  monthLabel: string;
  monthName: (period: string) => string;
  noMonthYet: (availableOn: string) => string;
  noMonthLive: string;
  monthNote: (month: string, nextMonth: string, availableOn: string) => string;
  whyMonths: string;
  hidden: (s: { belowFloor: number; complementary: number }, k: number, noun: Noun) => string;
  derivedNote: string;
  sizeHiddenNote: (k: number) => string;
  neverSends: (k: number) => string;
  abandonedHint: (k: number) => string;
}

type Noun = { one: string; many: string };

/** Login, layout and the sections of the console (overview, products, usage, swipes, ledger). */
export interface ConsoleCatalogue {
  eyebrow: string;
  title: string;
  /** Shown where a value is not known or not there. */
  none: string;
  login: { keyLabel: string; keyPlaceholder: string; badKey: string; open: string; help: string };
  nav: { label: string; overview: string; products: string; usage: string; swipes: string; ledger: string; signOut: string };
  demoBanner: string;
  loading: string;
  keyRefused: string;
  loadFailed: string;
  overview: {
    fitSessions: string;
    planHint: (plan: string) => string;
    saveRate: string;
    swipes: (n: number) => string;
    abandoned: string;
    abandonedOf: (share: string, opens: number) => string;
    notReady: string;
    notReadyHint: string;
    allReady: string;
    neverTitle: string;
    neverMeasure: string;
    neverSession: string;
    fitOnPhone: string;
  };
  sizes: {
    title: string;
    legendPage: string;
    legendApp: string;
    empty: string;
    size: (size: string) => string;
    counts: (page: number | undefined, swipes: number | undefined) => string;
    barPage: (size: string, sessions: number) => string;
    barSwipe: (size: string, swipes: number) => string;
    barsNote: string;
    noun: Noun;
  };
  products: {
    title: string;
    counts: (ready: number, notReady: number, hidden: number) => string;
    onlyMeasure: string;
    whereToDoIt: Record<SetupResponse['platform'], string>;
    empty: string;
    product: string;
    kind: string;
    advice: string;
    next: string;
    ready: string;
    notReady: string;
    scoreLabel: (score: number) => string;
    score: (score: number) => string;
    menSoon: string;
    menSoonTitle: string;
    menConfirm: string;
    menConfirmTitle: string;
    missing: (fields: string[]) => string;
  };
  usage: {
    plan: string;
    noPlan: string;
    planName: string;
    paused: string;
    notSubscribed: string;
    retired: string;
    sessions: string;
    sessionsHint: string;
    heroRenders: string;
    providerCost: (usd: string) => string;
    perDay: string;
    perDayNote: (from: string, to: string) => string;
    dayBar: (day: string, sessions: number) => string;
    pausedNote: string;
    oldPrice: string;
    fairUse: string;
    switchTo: (price: string) => string;
    switchFailed: string;
  };
  alerts: {
    title: string;
    today: (counted: string, usual: string, flagAbove: string, cap: string) => string;
    capReached: string;
    spike: string;
    nothing: string;
    line: (day: string, capReached: boolean) => string;
    notCounted: (denied: string, cap: string) => string;
    counted: (counted: string, usual: string) => string;
  };
  swipes: {
    love: string;
    save: string;
    pass: string;
    less: string;
    noun: Noun;
    passReasonsNote: string;
    byProduct: string;
    product: string;
    byColour: string;
    hue: string;
    byFabric: string;
    fabric: string;
    bySize: string;
    size: string;
    whyPass: string;
  };
  ledger: { intro: string; title: string; empty: string; entryTitle: (product: string) => string; entryDetail: (provider: string, model: string, hours: number) => string };
}

/** The console's own lines around the first-run checklist (the steps themselves come from @curtain/schema). */
export interface SetupCatalogue {
  stepTitle: (number: number, title: string) => string;
  done: string;
  todo: string;
  minutes: (minutes: number) => string;
  seeProducts: string;
  codeAlt: (product: string) => string;
  phoneHelp: string;
  openProduct: string;
  noCode: string;
  yourData: string;
}

/** The plan's price and status line (plan.ts). */
export interface PlanCatalogue {
  perMonth: (usd: string) => string;
  perMonthCharged: (charged: string, usd: string) => string;
  paused: string;
  none: string;
  active: string;
  legacy: (legacyPlan: string, viaShopify: boolean) => string;
}

const plural = (n: number, noun: Noun) => `${n} ${n === 1 ? noun.one : noun.many}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const ANALYTICS_EN: AnalyticsCatalogue = {
  monthLabel: 'Month',
  monthName: (period) => {
    const [y, m] = period.split('-');
    return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
  },
  noMonthYet: (availableOn) => `Your first month of shopper analytics appears on ${availableOn}, once the month is over.`,
  noMonthLive: 'Shopper analytics are not available from this server yet.',
  monthNote: (month, nextMonth, availableOn) => `Figures for ${month}. A finished month never changes. ${nextMonth} appears on ${availableOn}.`,
  whyMonths:
    'Analytics come in whole calendar months, never from any day to any day. With free dates, comparing two ranges that differ by one day would show what a handful of shoppers did that day.',
  hidden: (s, k, noun) => {
    if (s.belowFloor === 0 && s.complementary === 0) return `Nothing is hidden this month: every ${noun.one} had at least ${k} shoppers.`;
    const parts: string[] = [];
    if (s.belowFloor > 0) parts.push(`${plural(s.belowFloor, noun)} ${s.belowFloor === 1 ? 'is' : 'are'} hidden because fewer than ${k} shoppers were in ${s.belowFloor === 1 ? 'it' : 'each'}.`);
    if (s.complementary > 0)
      parts.push(
        `${plural(s.complementary, noun)} ${s.complementary === 1 ? 'is' : 'are'} hidden as well, although ${s.complementary === 1 ? 'it' : 'each'} had enough shoppers, so the small hidden ${s.belowFloor === 1 ? noun.one : noun.many} cannot be worked out by subtracting the rows shown from a total.`,
      );
    return parts.join(' ');
  },
  derivedNote: 'Colour, fabric and size count only the products and sizes shown above, so they never include a hidden product.',
  sizeHiddenNote: (k) => `Sizes seen by fewer than ${k} shoppers are hidden, and sometimes one more size with them, so a hidden size cannot be worked out from the totals.`,
  neverSends: (k) => `Shopper aggregates only for groups of at least ${k} people, in whole calendar months.`,
  abandonedHint: (k) => `shown once ${k} shoppers opened a product in a month`,
};

export const CONSOLE_EN: ConsoleCatalogue = {
  eyebrow: 'Curtain for shops',
  title: 'Merchant console',
  none: '—',
  login: {
    keyLabel: 'Secret key',
    // Built in two parts: a literal in real key format is refused by push protection (AGENTS.md).
    keyPlaceholder: 'sk_' + 'test_…',
    badKey: 'That is not a Curtain secret key. Copy it again from where Curtain showed it to you: it starts with “sk_”. It stays in this browser tab only.',
    open: 'Open console',
    help: 'Ask Curtain support for your console key (the WordPress plugin keeps its own key hidden, so it cannot show it to you). On Shopify you do not need this page: everything is under Apps → Curtain in your Shopify admin.',
  },
  nav: { label: 'Console sections', overview: 'Overview', products: 'Products', usage: 'Usage & plan', swipes: 'Swipes', ledger: 'Privacy ledger', signOut: 'Sign out' },
  demoBanner: 'API unreachable — showing demo data with the real response shapes. Nothing here is from your shop.',
  loading: 'Loading your shop…',
  keyRefused: 'This key was not accepted. It may have been replaced: sign out and paste the newest key from your Curtain settings (WooCommerce → Curtain, or the Curtain app in Shopify).',
  loadFailed: 'Your shop could not be loaded just now. Check your internet connection and reload the page; if it keeps happening, email Curtain support.',
  overview: {
    fitSessions: 'Fit sessions (30 d)',
    planHint: (plan) => `${plan} plan`,
    saveRate: 'Save rate',
    swipes: (n) => `${n} swipes`,
    abandoned: 'Abandoned opens',
    abandonedOf: (share, opens) => `${share} of ${opens} opens`,
    notReady: 'Products not ready yet',
    notReadyHint: 'see Products for what to do',
    allReady: 'all ready',
    neverTitle: 'What Curtain never sends you',
    neverMeasure: 'No measurement, photo, fit signature or device id — ever.',
    neverSession: 'Per-session sizes and scores are not returned to your page; order attribution is off by default.',
    fitOnPhone: 'Fit is computed on the shopper’s phone.',
  },
  sizes: {
    title: 'Sizes recommended',
    legendPage: 'On your product page (standalone fit, per session)',
    legendApp: 'In the Curtain app (at swipe time, per swipe)',
    empty: 'Shown once enough shoppers have seen a size.',
    size: (size) => `Size ${size}`,
    counts: (page, swipes) => `${page !== undefined ? `${page} on page` : 'on page: —'} · ${swipes !== undefined ? `${swipes} swipes` : 'swipes: —'}`,
    barPage: (size, sessions) => `Size ${size} on your product page: ${sessions} sessions`,
    barSwipe: (size, swipes) => `Size ${size} at swipe time: ${swipes} swipes`,
    barsNote: 'Bars show each size’s share within its source.',
    noun: { one: 'size', many: 'sizes' },
  },
  products: {
    title: 'Products',
    counts: (ready, notReady, hidden) => `${ready} ready · ${notReady} not ready yet${hidden ? ` · ${hidden} hidden` : ''}`,
    // Ends in a space: the line about where to do it follows.
    onlyMeasure: 'These products give a size already and would be more exact with your own measurements. ',
    whereToDoIt: {
      woocommerce: 'You do these in WordPress: open the product under Products and scroll to the “Curtain” box (size chart, then Garment measurements), then press Update.',
      shopify: 'You do these in Shopify: Apps → Curtain, then open the product from its list.',
    },
    empty: 'No products yet. Your published products come in by themselves a minute or two after you connect; reload this page to look again.',
    product: 'Product',
    kind: 'Kind',
    advice: 'Size advice',
    next: 'What to do next',
    ready: 'Ready',
    notReady: 'Not ready yet',
    scoreLabel: (score) => `Size advice ${score} out of 100`,
    score: (score) => `${score} / 100`,
    menSoon: 'Men’s: coming soon',
    menSoonTitle: 'Shoppers see “Men’s clothing: coming soon” for this product. It opens once the shop has the 3D estimate on and an approved 3D bundle on the male body exists for it.',
    menConfirm: 'Men’s: confirm audience',
    menConfirmTitle:
      'We read “men” from the title or a collection only, or the product has not been synced since we started asking where the audience comes from. Set the audience on the product to confirm it, or sync it again; until then it is shown as before.',
    missing: (fields) => `Missing: ${fields.join(', ')}`,
  },
  usage: {
    plan: 'Plan',
    noPlan: 'No plan',
    planName: 'Curtain',
    paused: 'paused',
    notSubscribed: 'not subscribed',
    retired: 'retired plan: switch',
    sessions: 'Sessions this period',
    sessionsHint: 'counted for analytics, not billed',
    heroRenders: 'Hero renders (30 d)',
    providerCost: (usd) => `$${usd} provider cost`,
    perDay: 'Fit sessions per day',
    perDayNote: (from, to) => `${from} → ${to}. One session = one product resolved by one shopper with a fit result written (D7).`,
    dayBar: (day, sessions) => `${day}: ${sessions} sessions`,
    pausedNote: 'No active subscription: the “Try it on” button still renders; shoppers see a “shop paused” screen until the Curtain plan is active again.',
    oldPrice: 'Old plan price',
    fairUse: 'A daily fair-use limit stops automated traffic; your price stays the same.',
    switchTo: (price) => `Switch to Curtain (${price})`,
    switchFailed: 'Could not start the switch.',
  },
  alerts: {
    title: 'Unusual traffic',
    today: (counted, usual, flagAbove, cap) =>
      `Today ${counted} counted sessions (usual day: ${usual}). We flag a day above ${flagAbove} and stop counting at the fair-use cap of ${cap} a day. Your price stays the same either way.`,
    capReached: 'Today’s fair-use cap is reached: further sessions today are not counted. Shoppers still get their size. Contact us if this is a real rush.',
    spike: 'Today is far above your usual volume. If you did not run a campaign, tell us: it can be automated traffic.',
    nothing: 'Nothing unusual in this range.',
    line: (day, capReached) => `${day} · ${capReached ? 'Daily cap reached' : 'Spike'}`,
    notCounted: (denied, cap) => `${denied} sessions not counted (cap ${cap})`,
    counted: (counted, usual) => `${counted} counted vs usual ${usual}`,
  },
  swipes: {
    love: 'Love',
    save: 'Save',
    pass: 'Pass',
    less: 'Less',
    noun: { one: 'product or size', many: 'products or sizes' },
    passReasonsNote: 'Pass reasons are inferred on the shopper’s phone.',
    byProduct: 'By product',
    product: 'Product',
    byColour: 'By colour',
    hue: 'Hue',
    byFabric: 'By fabric',
    fabric: 'Fabric',
    bySize: 'By size',
    size: 'Size',
    whyPass: 'Why shoppers pass',
  },
  ledger: {
    intro: 'Everything Curtain sent to an AI provider on behalf of your shoppers. Inputs are the anonymised avatar render and your product imagery — never a shopper photo.',
    title: 'Provider ledger',
    empty: 'No hero renders yet.',
    entryTitle: (product) => `Hero render · ${product}`,
    entryDetail: (provider, model, hours) => `${provider} / ${model} · deleted after ${hours} h`,
  },
};

export const SETUP_EN: SetupCatalogue = {
  stepTitle: (number, title) => `${number}. ${title}`,
  done: ' (done)',
  todo: ' (to do)',
  minutes: (minutes) => ` · about ${minutes} min`,
  seeProducts: 'See which products show it',
  codeAlt: (product) => `Code for ${product}`,
  phoneHelp: 'Point your phone’s camera at the code and tap the link it shows. On the product page, tap “Try it on”, type a height and weight, and look at the size it suggests.',
  openProduct: 'Open the product page ↗',
  noCode: 'Once a product has a size chart and is published in your shop, its code appears here.',
  yourData: 'Your data',
};

export const PLAN_EN: PlanCatalogue = {
  perMonth: (usd) => `${usd} per month`,
  perMonthCharged: (charged, usd) => `${charged} per month (${usd})`,
  paused: 'Paused: shoppers see a short “taking a break” note instead of a size until the plan is active again.',
  none: 'Not started yet.',
  active: 'Active.',
  legacy: (legacyPlan, viaShopify) =>
    `Still billed on the retired “${legacyPlan}” plan at its old price. ${
      viaShopify ? 'Open Curtain in your Shopify admin and approve the Curtain plan to switch.' : 'Switch to the Curtain plan below; the old subscription is cancelled when the new one starts.'
    }`,
};

export interface MerchantCatalogue {
  assets: AssetReviewCatalogue;
  analytics: AnalyticsCatalogue;
  console: ConsoleCatalogue;
  setup: SetupCatalogue;
  plan: PlanCatalogue;
}

export const MERCHANT_EN: MerchantCatalogue = {
  analytics: ANALYTICS_EN,
  console: CONSOLE_EN,
  setup: SETUP_EN,
  plan: PLAN_EN,
  assets: {
    title: (product) => `3D estimate · ${product}`,
    back: 'Back to products',
    intro: 'Shoppers see a 3D estimate of this product only after you approve a version. Each version below says how it was built and what the automatic check found.',
    none: 'No 3D version has been imported for this product yet.',
    loading: 'Loading the 3D versions…',
    loadFailed: 'Could not load the 3D versions.',
    open3d: '3D estimate',
    status: {
      awaiting_approval: 'Waiting for your approval',
      approved: 'Approved',
      rejected: 'Rejected by you',
      superseded: 'Replaced by a newer version',
      refused: 'Refused by the automatic check',
    },
    live: 'Live for shoppers',
    version: (version, mb, date) => `Version ${version.slice(0, 8)} · ${mb} MB · imported ${date}`,
    estimate: 'Built from your tape measurements and draped on our server. Shoppers see it labelled an estimate, never a measurement.',
    check: {
      title: 'Automatic check',
      passed: 'Every check passed. Look at the sizes below, then approve.',
      passedDone: 'Every check passed.',
      refused: 'This version was refused and cannot be approved. Fix what is listed, then import it again.',
      notRun: 'This version was imported before the automatic check existed.',
      none: 'not run',
      checked: (date) => `Checked ${date}`,
      reason: (reason) => `${reason.charAt(0).toUpperCase() + reason.slice(1)}.`,
      titles: {
        readable: 'The 3D file names its tape, rings and bodies',
        file_size: 'Small enough for a phone to download',
        sizes_have_geometry: 'Every size has a 3D garment',
        refusals_declared: 'Sizes that cannot be shown say why',
        provenance: 'Measured and estimated sizes match your tape',
        at_rest: 'The fabric came to rest in every drape',
        tape_rings: 'Hip and hem match your tape',
        inside_body: 'No fabric inside the body',
        size_order: 'Sizes grow where your tape grows',
      },
      passMark: 'Passed',
      failMark: 'Failed',
      notRunMark: 'Not run',
    },
    tape: {
      title: 'Your tape, per size',
      intro: 'What each size of the 3D estimate is built from. Only the sizes you measured are your numbers; the others are our estimates.',
      hipAt: (cm) => (cm === null ? 'Hip (C): you did not say how far below the band you measured it.' : `Hip (C): measured ${cm} cm below the top of the band.`),
      size: 'Size',
      source: 'From',
      hip: 'Hip (C)',
      hem: 'Hem (D)',
      band: 'Band stretched (B)',
      draped: 'Numbers in cm. Under each tape number: what the 3D garment measures there, across the bodies it was draped on.',
      drapedRange: (lo, hi) => `3D ${Math.abs(hi - lo) < 0.05 ? lo : `${lo}–${hi}`}`,
      provenance: { measured: 'Measured', interpolated: 'Estimated', extrapolated: 'Rough estimate' },
      provenanceNote: {
        measured: 'your tape',
        interpolated: 'between two sizes you measured',
        extrapolated: 'beyond the sizes you measured',
      },
      notDrawn: (size, hips, reason) => `Size ${size} is not drawn on a body with ${hips} hips: ${reason}.`,
      measureMore: 'Measuring the estimated sizes turns them into your own numbers and makes the 3D estimate of those sizes firmer.',
      cm: (n) => `${n} cm`,
      none: '—',
    },
    flags: { title: 'Read before approving' },
    actions: {
      approve: 'Approve for shoppers',
      reject: 'Reject',
      reasonLabel: 'Why are you rejecting it?',
      reasonPlaceholder: 'e.g. the hem looks too short',
      confirmReject: 'Reject this version',
      cancel: 'Cancel',
      working: 'Saving…',
      refusedHelp: 'A refused version cannot be approved.',
      failed: 'That did not work. Try again.',
    },
    rejected: (reason) => `You rejected it: ${reason}`,
  },
};

/** The console's string lookup (English only, D21). */
export function merchantStrings(): MerchantCatalogue {
  return MERCHANT_EN;
}
