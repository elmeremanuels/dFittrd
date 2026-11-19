/**
 * English strings of the merchant console's 3D estimate review (DECISIONS.md D21: one English catalogue per surface,
 * read through one lookup; a translation pack is one more catalogue). The rest of the console predates this file and
 * still writes its English inline; new console text goes here.
 */
import type { BakeCheckId, GarmentAssetStatus, TapeProvenance } from '@curtain/schema';

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
  hidden: (s: { belowFloor: number; complementary: number }, k: number, noun: { one: string; many: string }) => string;
  derivedNote: string;
  sizeHiddenNote: (k: number) => string;
  neverSends: (k: number) => string;
  abandonedHint: (k: number) => string;
}

const plural = (n: number, noun: { one: string; many: string }) => `${n} ${n === 1 ? noun.one : noun.many}`;
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

export const MERCHANT_EN: { assets: AssetReviewCatalogue; analytics: AnalyticsCatalogue } = {
  analytics: ANALYTICS_EN,
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
export function merchantStrings(): typeof MERCHANT_EN {
  return MERCHANT_EN;
}
