/**
 * English strings: see `../en.ts` for which part of `apps/web` this file covers (DECISIONS.md D21).
 *
 * The consumer app: one section per route or component. A `{name}` in a string marks the place of
 * an element; the screen splits it with `parts()` from `@/embed/strings`.
 */
import type { SwipeAction, WardrobeState } from '@curtain/schema';

/** The kinds of line in the on-device privacy ledger (`ClientLedgerEntry['kind']` in `@/db/db`). */
type LedgerKind = 'signature_sync' | 'swipe_batch' | 'wardrobe_sync' | 'hero_render' | 'pairing' | 'erase' | 'device' | 'export' | 'fit';

export interface AppStrings {
  /** Used by several screens. */
  common: {
    brand: string;
    units: { cm: string; kg: string; eu: string };
  };
  /** `routes/AppShell.tsx`: bottom nav and the development switcher. */
  shell: {
    navLabel: string;
    rail: string;
    wardrobe: string;
    profile: string;
    toSync: (n: number) => string;
    devSwitcher: string;
    customer: string;
    merchant: string;
  };
  /** `routes/LegalRoute.tsx`: the frame around the legal documents (their text is `docs/legal/*.md`). */
  legal: {
    documentTitle: (title: string) => string;
    eyebrow: string;
    navLabel: string;
    privacy: string;
    terms: string;
  };
  /** `routes/PairRoute.tsx`. */
  pair: {
    invalid: string;
    eyebrow: string;
    title: string;
    intro: string;
    fieldLabel: string;
    placeholder: string;
    open: string;
    pairedShops: string;
    none: string;
    paused: string;
    privacy: string;
  };
  /** `routes/ProfileRoute.tsx`. */
  profile: {
    ledgerKinds: Record<LedgerKind, string>;
    ledgerFailed: string;
    ledgerHttp: (status: number) => string;
    eyebrow: string;
    title: string;
    measurements: string;
    remeasure: string;
    /** `{add}` is the link (`addThem`). */
    noMeasurements: string;
    addThem: string;
    measurementMeta: (source: string, confidence: string) => string;
    scanTapeDisagree: string;
    scanQuality: (percent: string) => string;
    colours: string;
    undertoneOf: (undertone: string) => string;
    palette: string;
    undertoneOnly: (undertone: string) => string;
    noSeason: string;
    styleDna: string;
    refinedBy: (swipes: number) => string;
    renders: string;
    consentLabel: string;
    consent: Record<'avatar' | 'heroOptIn', { title: string; text: string }>;
    waitingToSync: (n: number) => string;
    allSynced: string;
    lastSynced: (when: string) => string;
    retryNow: string;
    yourData: string;
    exportAll: string;
    deleteScan: string;
    deleteAll: string;
    confirmScan: string;
    confirmAll: string;
    deleting: string;
    yesDelete: string;
    cancel: string;
  };
  /** `routes/TryRoute.tsx`. */
  try: {
    linkFailed: string;
    unknownDemoGarment: (id: string) => string;
    loading: string;
    errorTitle: string;
    toRail: string;
    tryingFrom: string;
    paused: string;
    otherSize: string;
    sizeToPreview: string;
    tooSmallToPullOn: string;
    fitNotes: string;
    loveThis: string;
    loved: string;
    love: string;
    saveToWardrobe: string;
    inWardrobe: string;
    save: string;
    backTo: (shop: string) => string;
    privacy: (expires: string) => string;
  };
  /** `routes/WardrobeRoute.tsx`. */
  wardrobe: {
    states: Record<WardrobeState, string>;
    eyebrow: string;
    title: string;
    empty: string;
    openRail: string;
    size: (size: string) => string;
    sizeUnknown: string;
    less: string;
    more: string;
    statusOf: (item: string) => string;
    teaches: string;
    openInShop: string;
  };
  /** `components/Onboarding.tsx`. */
  onboarding: {
    hints: { bust: string; waist: string; hip: string; footEu: string };
    steps: {
      welcome: { title: string; subtitle: string };
      measurements: { title: string; subtitle: string };
      vibes: { title: string; subtitle: string };
      capture: { title: string; subtitle: string };
      done: { title: string; subtitleCaptured: string; subtitleLater: string };
    };
    /** `{you}` is the emphasised word (`fitsYouEmphasis`). */
    fitsYou: string;
    fitsYouEmphasis: string;
    learnsTaste: string;
    staysOnDevice: string;
    howMeasuredLegend: string;
    howMeasuredLabel: string;
    vibesLabel: string;
    doneCaptured: string;
    doneTyped: string;
    progress: string;
    enter: string;
    next: string;
    measurementsNote: string;
  };
  /** `components/SwipeDeck.tsx`. */
  deck: {
    actions: Record<SwipeAction, string>;
    openDna: string;
    openProfile: string;
    gsm: (weight: number) => string;
    shop: string;
    colourAfterPhoto: string;
    swipeActions: string;
    exhausted: string;
    settingUp: string;
    leftOut: (n: number) => string;
    pairToSee: string;
    passedComeBack: string;
    pairShop: string;
    wardrobe: string;
  };
  /** `components/Card.tsx`: the direction marks over a dragged card. */
  card: Record<SwipeAction, string>;
  /** `components/Ledger.tsx`. */
  ledger: {
    title: string;
    empty: string;
    fieldsSent: string;
    bytes: (n: number) => string;
  };
  /** `components/StyleDnaDialog.tsx` and `components/TasteRadial.tsx`. */
  styleDna: {
    title: string;
    close: string;
    archetype: string;
    note: string;
    axis: (label: string, percent: number) => string;
  };
  /** `components/ColourChip.tsx`. */
  colourChip: {
    title: (percent: number, target: string) => string;
  };
  /**
   * `components/CohortBars.tsx`. The cohort counts whole calendar months only (launch-readiness
   * finding 1), so the card says which month it runs to.
   */
  cohort: {
    title: string;
    people: (n: number) => string;
    empty: (k: number) => string;
    through: (month: string) => string;
    kept: (percent: number) => string;
    bar: (size: string, n: number) => string;
  };
  /** `store/store.ts`: the name of the bundled demo shop. */
  store: {
    demoShopName: string;
  };
  /** `api/client.ts`: error messages a screen may print when the server sent none. */
  api: {
    networkError: (method: string, path: string) => string;
    httpStatus: (status: number) => string;
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (period: string): string => {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

export const APP_EN: AppStrings = {
  common: {
    brand: 'Curtain',
    units: { cm: 'cm', kg: 'kg', eu: 'EU' },
  },
  shell: {
    navLabel: 'Primary',
    rail: 'Rail',
    wardrobe: 'Wardrobe',
    profile: 'Profile',
    toSync: (n) => `${n} to sync`,
    devSwitcher: 'Development view switcher',
    customer: 'Customer',
    merchant: 'Merchant',
  },
  legal: {
    documentTitle: (title) => `${title} · Curtain`,
    eyebrow: 'Curtain · your private fitting room',
    navLabel: 'Legal',
    privacy: 'Privacy',
    terms: 'Terms',
  },
  pair: {
    invalid: 'Paste the “Try it on” link or the code shown under the QR.',
    eyebrow: 'Pair a shop',
    title: 'Bring a shop into your fitting room',
    intro: 'Tap “Try it on” on a product page, or scan the QR with your camera. On this phone you can also paste the link.',
    fieldLabel: 'Try link or code',
    placeholder: 'https://app.curtain.fit/try/…',
    open: 'Open try-on',
    pairedShops: 'Paired shops',
    none: 'No shop paired yet — the rail shows the demo collection.',
    paused: 'paused',
    privacy: 'A shop never sees your measurements, photos, device id or anything that identifies you — only totals across shoppers.',
  },
  profile: {
    ledgerKinds: {
      signature_sync: 'Fit signature synced',
      swipe_batch: 'Swipes synced',
      wardrobe_sync: 'Wardrobe synced',
      hero_render: 'Hero render requested',
      pairing: 'Shop pairing',
      erase: 'Erase request',
      device: 'Anonymous device registered',
      export: 'Export requested',
      fit: 'Size shown on a shop page',
    },
    ledgerFailed: 'failed (will retry)',
    ledgerHttp: (status) => `HTTP ${status}`,
    eyebrow: 'Profile',
    title: 'You, on this device',
    measurements: 'Measurements',
    remeasure: 'Remeasure',
    noMeasurements: 'No measurements yet. {add} to see fit.',
    addThem: 'Add them',
    measurementMeta: (source, confidence) => `${source} · confidence ${confidence}`,
    scanTapeDisagree: 'scan and tape disagree',
    scanQuality: (percent) => `Scan quality ${percent}.`,
    colours: 'Your colours',
    undertoneOf: (undertone) => `${undertone} undertone`,
    palette: 'Palette',
    undertoneOnly: (undertone) => `Undertone: ${undertone} (estimate from your face photo).`,
    noSeason: 'Take the face photo in the capture step to get a season estimate for colour matching.',
    styleDna: 'Style DNA',
    refinedBy: (swipes) => `Refined by ${swipes} swipes.`,
    renders: 'Renders',
    consentLabel: 'Render consent',
    consent: {
      avatar: { title: 'On-device only (default)', text: 'Every look is drawn on this phone from your measurements and the shop’s garment data. Nothing is uploaded.' },
      heroOptIn: {
        title: 'Hero render (opt-in)',
        text: 'For a share-worthy picture we send an anonymised avatar render (base frame with your face removed) plus the flat-lay to an AI provider. Never a raw photo. Deleted within 24 h and listed in your ledger with provider and model.',
      },
    },
    waitingToSync: (n) => `${n} item${n === 1 ? '' : 's'} waiting to sync (offline-safe).`,
    allSynced: 'Everything is synced.',
    lastSynced: (when) => `Fit signature last synced ${when}.`,
    retryNow: 'Retry now',
    yourData: 'Your data',
    exportAll: 'Export everything (JSON)',
    deleteScan: 'Delete my scan',
    deleteAll: 'Delete everything',
    confirmScan: 'Delete the scan, base frame, face tile and measurements from this device?',
    confirmAll: 'Delete everything on this device and ask the server to erase your pseudonymous account (DELETE /v1/me)?',
    deleting: 'Deleting…',
    yesDelete: 'Yes, delete',
    cancel: 'Cancel',
  },
  try: {
    linkFailed: 'This link could not be opened.',
    unknownDemoGarment: (id) => `Unknown demo garment ${id}`,
    loading: 'Opening the fitting room…',
    errorTitle: 'We could not open this link',
    toRail: 'Go to your rail',
    tryingFrom: 'Trying on from',
    paused: 'This shop has paused Curtain try-ons. You can still see the estimate; swipes are not counted for the shop.',
    otherSize: 'See it in another size',
    sizeToPreview: 'Size to preview',
    tooSmallToPullOn: 'too small to pull on',
    fitNotes: 'Fit notes',
    loveThis: 'Love this',
    loved: 'Loved',
    love: 'Love',
    saveToWardrobe: 'Save to wardrobe',
    inWardrobe: 'In wardrobe',
    save: 'Save',
    backTo: (shop) => `Back to ${shop}`,
    privacy: (expires) => `The shop only learns that this item was opened — never your measurements or photos. The try link expires ${expires}.`,
  },
  wardrobe: {
    states: { saved: 'Saved', bought: 'Bought', kept: 'Kept', returned: 'Returned' },
    eyebrow: 'Wardrobe',
    title: 'Saved fits',
    empty: 'Swipe up or tap “Save” on the rail to keep an item here with its recommended size.',
    openRail: 'Open the rail',
    size: (size) => `Size ${size}`,
    sizeUnknown: 'Size not known',
    less: 'Less',
    more: 'More',
    statusOf: (item) => `Status of ${item}`,
    teaches: 'Marking an item kept or returned teaches the fit engine how this brand runs on you.',
    openInShop: 'Open in shop',
  },
  onboarding: {
    hints: {
      bust: 'Around the fullest part, tape level.',
      waist: 'Narrowest point, relaxed.',
      hip: 'Fullest part of the hips.',
      footEu: 'Your usual EU shoe size.',
    },
    steps: {
      welcome: { title: 'Welcome to Curtain', subtitle: 'Your private fitting room. Realistic fit, your taste, nothing leaves your phone.' },
      measurements: { title: 'Your measurements', subtitle: 'They drive the fit directly, and keep the scan honest.' },
      vibes: { title: 'Your style vibe', subtitle: 'Pick what resonates. The deck learns the rest from your swipes.' },
      capture: { title: 'Capture', subtitle: 'A face photo and an 8-second video, measured on this device.' },
      done: { title: 'You are set', subtitleCaptured: 'Your capture is stored encrypted on this phone.', subtitleLater: 'You can add a scan later from your profile.' },
    },
    fitsYou: 'See how a size M really fits {you}.',
    fitsYouEmphasis: 'you',
    learnsTaste: 'Swipe a rail that learns your taste.',
    staysOnDevice: 'Photos and video never leave this device.',
    howMeasuredLegend: 'How did you measure?',
    howMeasuredLabel: 'How did you measure',
    vibesLabel: 'Style vibes',
    doneCaptured: 'Only an 80-number fit signature can sync — no photo, no face or skin data. You will see it in your privacy ledger.',
    doneTyped: 'Your typed measurements are stored on this device only.',
    progress: 'Progress',
    enter: 'Enter the fitting room',
    next: 'Next',
    measurementsNote: 'Stored on this device only. Height is required; everything else is optional.',
  },
  deck: {
    actions: { pass: 'Pass', less: 'Less like this', love: 'Love', save: 'Save to wardrobe' },
    openDna: 'Open your Style DNA',
    openProfile: 'Open your profile',
    gsm: (weight) => `${weight} gsm`,
    shop: 'Shop',
    colourAfterPhoto: 'Colour match after your face photo',
    swipeActions: 'Swipe actions',
    exhausted: 'You have seen the whole rail',
    settingUp: 'Setting up your rail…',
    leftOut: (n) => `${n} item${n === 1 ? '' : 's'} were left out because no size fits.`,
    pairToSee: 'Pair a shop to see its real catalogue here.',
    passedComeBack: 'Passed items come back later; loved and saved ones are in your wardrobe.',
    pairShop: 'Pair a shop',
    wardrobe: 'Wardrobe',
  },
  card: { love: 'Love', pass: 'Pass', save: 'Save', less: 'Less like this' },
  ledger: {
    title: 'Privacy ledger',
    empty: 'Nothing has left this device yet.',
    fieldsSent: 'Fields sent',
    bytes: (n) => `${n} bytes`,
  },
  styleDna: {
    title: 'Your Style DNA',
    close: 'Close Style DNA',
    archetype: 'Primary archetype',
    note: 'On-device estimate from your swipes and onboarding vibes. Nothing about your body is in here.',
    axis: (label, percent) => `${label} ${percent}%`,
  },
  colourChip: {
    title: (percent, target) => `Colour match ${percent}% against your ${target} (estimate)`,
  },
  cohort: {
    title: 'What others kept',
    people: (n) => `${n} ${n === 1 ? 'person' : 'people'}`,
    empty: (k) => `Shown once at least ${k} people have tried this item in a month.`,
    through: (month) => `Counted in whole months, up to the end of ${monthName(month)}. Sizes chosen by only a few people are hidden.`,
    kept: (percent) => `${percent}% kept what they bought.`,
    bar: (size, n) => `Size ${size}: ${n}`,
  },
  store: {
    demoShopName: 'Curtain demo rail',
  },
  api: {
    networkError: (method, path) => `network error on ${method} ${path}`,
    httpStatus: (status) => `HTTP ${status}`,
  },
};
