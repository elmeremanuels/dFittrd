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

export const MERCHANT_EN: { assets: AssetReviewCatalogue } = {
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
