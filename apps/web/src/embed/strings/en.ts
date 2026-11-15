/**
 * The embed's English catalogue (DECISIONS.md D21): the one place the interface text of the
 * embed's own screens lives (header, footer, About you, the result, the size chart, the fit notes,
 * the size peek, "See it on me", the 3D view, the avatar prompt, the blocked screens). A
 * translation pack is one more file of this shape, registered in `./index.ts`. Sentences with a
 * value in them are functions, so a pack can put the value where its language wants it; a
 * `{name}` in a plain string marks where the screen puts an element (see `parts` in `./index.ts`).
 *
 * Not here: text drawn by components the embed shares with the app (`@/components`, `@/render`,
 * `@/features/capture`); see docs/i18n/README.md.
 *
 * `avatar.claims` is copied word for word from `docs/legal/avatar-consent-copy.md` (section 2,
 * variant A: nothing leaves the device). `avatarCopy.test.ts` reads that file and fails when a
 * line here is not in it, so the prompt cannot drift from the text counsel reviews. The plain text
 * must never promise more than the legal text (D19): where a sentence of the copy describes
 * something this build does not do (reading the colour from a photo, C11's second sentence, C12,
 * C26), that sentence is left out rather than shown. The same goes for C30: it is shown only in a
 * build that does save the colour (`store.persistsLooks`); by default the colour is in memory only.
 *
 * `avatar.ui` holds the small labels the copy document does not give (close, coming soon, the
 * names of the swatches). They state nothing about what happens to anybody's data.
 */
import type { AboutField, FitPreference } from '../aboutYou';
import type { BlockedKind } from '../flow';
import type { Units } from '../units';

export type FitBand = 'tight' | 'snug' | 'good' | 'roomy' | 'loose';
export type ChartColumn = 'bust' | 'waist' | 'hip' | 'shoulder' | 'thigh' | 'inseam' | 'footLengthCm' | 'footEu';
type RequiredField = 'height' | 'weight' | 'footEu';

export interface AvatarClaims {
  title: string;
  /** Intro. */
  c1: string;
  c2: string;
  c3: string;
  /** Footer; shown only with the face row, the one row that involves a photo. */
  c4: string;
  termsLink: string;
  faceName: string;
  faceOff: string;
  skinName: string;
  /** C11, first sentence only: nothing reads a photo in this build. */
  c11Pick: string;
  skinOff: string;
  skinOnYes: string;
  /** `{remember}` is the label of the embed's own "Remember me" switch (`rememberLabel`). */
  c30: string;
  c14: string;
  bodyOff: string;
}

export interface AvatarUi {
  close: string;
  done: string;
  comingSoon: string;
  on: string;
  off: string;
  measurementsName: string;
  typeMeasurements: string;
  swatch: (n: number, total: number) => string;
  lightest: string;
  darkest: string;
  picked: (n: number, total: number) => string;
  /** The button on the avatar itself: the prompt's title. */
  open: string;
  /** Credit of the swatches (the Monk Skin Tone Scale is CC BY 4.0: the credit is the licence's condition). */
  swatchCredit: string;
  /** Shown after the terms link when the page behind it is not in the catalogue's language (else empty). */
  termsLanguageNote: string;
}

export interface EmbedCatalogue {
  avatar: { claims: AvatarClaims; ui: AvatarUi };
  /** The screens shown in place of the flow. */
  blocked: Record<BlockedKind, { title: string; text: string }>;
  actions: { tryAgain: string; backToShop: string };
  /** The label of the footer's "Remember me" switch; C30 names it. */
  rememberLabel: string;
  loading: string;
  header: { title: string; privacy: string };
  footer: {
    forget: string;
    saved: string;
    notSaved: string;
    /** `{brand}` is the wordmark. */
    fitBy: string;
    getApp: string;
    forgotten: string;
    forgottenLocalOnly: string;
  };
  units: { legend: string; name: Record<Units, string>; short: Record<Units, string> };
  about: {
    step: string;
    editing: string;
    title: string;
    intro: (numbers: 2 | 3) => string;
    labels: Record<AboutField, string>;
    optional: string;
    heightFeet: string;
    heightInches: string;
    preference: string;
    preferences: Record<FitPreference, string>;
    ageRange: string;
    ageUnset: string;
    bodyType: string;
    sex: { unspecified: string; female: string; male: string };
    knowsMeasurements: string;
    tape: string;
    emptyEstimated: string;
    withoutThem: (bottom: boolean) => string;
    submit: string;
    scan: string;
    scanNote: string;
    errors: {
      required: Record<Units, Record<RequiredField, string>>;
      number: string;
      wholeFeet: string;
      inches: string;
      /** `lo` and `hi` come with their unit when it is written per number (feet and inches). */
      between: (lo: string | number, hi: string | number, unit?: string) => string;
    };
  };
  result: {
    eyebrow: string;
    welcomeBack: string;
    noPointsTitle: string;
    noPointsShoes: string;
    noPointsOther: string;
    addShoeSize: string;
    edit: string;
    recommend: (size: string) => string;
    noneFits: string;
    adjusted: (direction: 'up' | 'down', from: string, preference: FitPreference) => string;
    compare: string;
    recommendedMark: string;
    onPage: (size: string) => string;
    details: string;
    tabs: { fit: string; chart: string };
    bodyLabel: string;
    /** The estimate label on the figure, on two short lines (a narrow badge beside the head). Read together: "Estimate · not measured". */
    estimateLines: readonly [string, string];
    hideRings: string;
    showRings: string;
    ringsSolid: (size: string) => string;
    ringsGhost: (sizes: string[]) => string;
    ringsEstimates: string;
    pointsTitle: (size: string) => string;
    estimated: (points: string[]) => string;
    chosen: (size: string) => string;
    /** `{size}` is the size, set in the display type. */
    chooseOnPage: string;
    choose: (size: string) => string;
    chooseAnyway: (size: string) => string;
  };
  chart: {
    title: string;
    size: string;
    columns: Record<ChartColumn, string>;
    caption: (type: 'body' | 'garment', units: Units) => string;
    note: Record<'body' | 'garment', string>;
    recommended: string;
    notGiven: string;
  };
  fit: {
    /** Fit points by key; a point without a name here is shown by its key. */
    points: Record<string, string>;
    bands: Record<FitBand, string>;
    asDesigned: string;
    moreRoom: (length: string) => string;
    lessRoom: (length: string) => string;
    notes: {
      closest: (size: string, band: string, point: string) => string;
      band: (band: string, point: string, o: { stretch: boolean; suggest: 'up' | 'down' | null }) => string;
      add: (points: string[]) => string;
      fitsWell: (size: string) => string;
    };
  };
  peek: {
    /** `{size}` is the size, set in the display type. */
    yourSize: string;
    noneFits: string;
    unknown: string;
    see: (size: string) => string;
    open: string;
    onlyYou: string;
    unknownNote: string;
    noneNote: string;
  };
  hero: {
    title: string;
    alt: (garment: string, size: string) => string;
    explain: string;
    consent: string;
    working: string;
    start: (size: string) => string;
    failed: string;
    slow: string;
  };
  view3d: {
    label: string;
    open: string;
    heading: (size: string) => string;
    close: string;
    unavailable: (size: string) => string;
    canvas: (size: string) => string;
    loading: string;
    draping: string;
    sizes: string;
    notPhoto: string;
    picked: (size: string) => string;
    noneFits: string;
    looking: (size: string) => string;
    rings: (size: string) => string;
    ringName: (key: string) => string;
    hemNote: string;
  };
}

const lower = (s: string): string => s.toLowerCase();
const list = (words: string[]): string => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

const title = 'Make the avatar look like you';

export const EN: EmbedCatalogue = {
  avatar: {
    claims: {
      title,
      c1: 'You choose. Everything here is off until you switch it on.',
      c2: 'You get your size advice either way.',
      c3: 'The shop never sees your photo, your face or your body measurements.',
      c4: 'We do not use your photo to recognise you, to teach AI, or for ads.',
      termsLink: 'Read the full privacy terms',
      faceName: 'Use my face',
      faceOff: 'The avatar has a standard face.',
      skinName: 'Match my skin tone',
      c11Pick: 'Pick your skin colour yourself.',
      skinOff: 'The avatar has a standard colour.',
      skinOnYes: 'Pick a colour from the row.',
      c30: 'If "{remember}" is on, your colour is saved on this device with your other answers.',
      c14: 'The avatar goes back to the standard colour. Your colour is deleted from this device.',
      bodyOff: 'You type your measurements.',
    },
    ui: {
      close: 'Close',
      done: 'Done',
      comingSoon: 'Coming soon',
      on: 'On',
      off: 'Off',
      measurementsName: 'My measurements',
      typeMeasurements: 'Type my measurements',
      swatch: (n, total) => `Colour ${n} of ${total}`,
      lightest: 'lightest',
      darkest: 'darkest',
      picked: (n, total) => `Colour ${n} of ${total} is on the avatar.`,
      open: title,
      swatchCredit: 'Colours: Monk Skin Tone Scale by Dr. Ellis Monk, CC BY 4.0.',
      termsLanguageNote: '',
    },
  },
  blocked: {
    paused: {
      title: 'Try-on is paused',
      text: 'This shop has paused Curtain for now. You can still use the shop’s own size chart on the product page.',
    },
    expired: {
      title: 'This try-on has expired',
      text: 'For your privacy, a try-on link only works for a few minutes and in one window. Close this and tap “Try it on” again.',
    },
    incomplete: {
      title: 'Not ready for this product yet',
      text: 'The shop has not finished the size data for this item, so we can’t give an honest recommendation.',
    },
    // D20 point 3: no figure and no size for a men's product without the full 3D experience.
    comingSoon: {
      title: 'Men’s clothing: coming soon',
      text: 'The fitting room is not ready for men’s clothing yet. For now, use the shop’s own size chart on the product page.',
    },
    offline: {
      title: 'You seem to be offline',
      text: 'We couldn’t reach Curtain. Check your connection and try again.',
    },
    busy: {
      title: 'Busy right now',
      text: 'A lot of people on your network are using fitting rooms at the moment. Wait a minute and try again.',
    },
    error: {
      title: 'Something went wrong',
      text: 'We couldn’t open the fitting room. Please try again.',
    },
  },
  actions: { tryAgain: 'Try again', backToShop: 'Back to the shop' },
  rememberLabel: 'Remember me on this shop',
  loading: 'Opening your fitting room…',
  header: { title: 'Find your size', privacy: 'Your measurements stay on this device' },
  footer: {
    forget: 'Forget me',
    saved: 'Saved only in this browser, for this shop.',
    notSaved: 'Nothing is saved; closing this window clears it.',
    fitBy: 'Fit by {brand}',
    getApp: 'Get the Curtain app',
    forgotten: 'Forgotten. Nothing about you is stored here any more.',
    forgottenLocalOnly: 'Deleted from this browser. We could not reach Curtain to delete the anonymous device; try again later.',
  },
  units: {
    legend: 'Units',
    name: { metric: 'Metric', imperial: 'Imperial' },
    short: { metric: 'cm · kg', imperial: 'in · lb' },
  },
  about: {
    step: 'Step 1 of 2',
    editing: 'Edit my measurements',
    title: 'About you',
    intro: (numbers) => `${numbers === 3 ? 'Three numbers' : 'Two numbers'} and you’ll see your size. Takes under 30 seconds.`,
    labels: { height: 'Height', weight: 'Weight', bust: 'Bust / chest', waist: 'Waist', hip: 'Hip', inseam: 'Inseam', footEu: 'Shoe size (EU)' },
    optional: '(optional)',
    heightFeet: 'Height, feet',
    heightInches: 'Height, inches',
    preference: 'How do you like it to fit?',
    preferences: { snug: 'Snug', regular: 'Regular', relaxed: 'Relaxed' },
    ageRange: 'Age range',
    ageUnset: 'Prefer not to say',
    bodyType: 'Body type',
    sex: { unspecified: 'Not specified', female: 'Women’s sizing', male: 'Men’s sizing' },
    knowsMeasurements: 'I know my measurements',
    tape: 'Measured with a tape',
    emptyEstimated: 'Anything you leave empty is estimated from your height and weight, with a lower confidence.',
    withoutThem: (bottom) => `Optional. Without them we estimate ${bottom ? 'waist and hip' : 'bust, waist and hip'} from your height and weight.`,
    submit: 'See my size',
    scan: 'More accurate: 30-second scan',
    scanNote: 'The scan runs in this browser. No photo or video leaves your device.',
    errors: {
      required: {
        metric: { height: 'Enter your height in cm', weight: 'Enter your weight in kg', footEu: 'Enter your EU shoe size' },
        imperial: { height: 'Enter your height in feet and inches', weight: 'Enter your weight in lb', footEu: 'Enter your EU shoe size' },
      },
      number: 'Enter a number',
      wholeFeet: 'Enter whole feet, e.g. 5 ft 7 in',
      inches: 'Inches go from 0 to 11.9',
      between: (lo, hi, unit) => (unit ? `Between ${lo} and ${hi} ${unit}` : `Between ${lo} and ${hi}`),
    },
  },
  result: {
    eyebrow: 'Your fit',
    welcomeBack: 'Welcome back',
    noPointsTitle: 'We can’t recommend a size yet',
    noPointsShoes: 'Shoes are sized by your foot. Add your EU shoe size and we’ll check the fit.',
    noPointsOther: 'This item is sized by measurements we don’t have for you yet. Add your measurements, or use the size chart below.',
    addShoeSize: 'Add my shoe size',
    edit: 'Edit my measurements',
    recommend: (size) => `We recommend ${size}`,
    noneFits: 'No size fits well',
    adjusted: (direction, from, preference) => `One size ${direction} from ${from} for your ${preference} preference.`,
    compare: 'Compare sizes',
    recommendedMark: '(recommended)',
    onPage: (size) => `Selected on the shop page: ${size}`,
    details: 'Result details',
    tabs: { fit: 'How it fits', chart: 'Size chart' },
    bodyLabel: 'Body from your answers',
    estimateLines: ['Estimate ·', 'not measured'],
    hideRings: 'Hide size rings',
    showRings: 'Show size rings',
    ringsSolid: (size) => `Solid rings: size ${size}.`,
    ringsGhost: (sizes) => `Faint dashed rings: size ${sizes.join(' and ')}.`,
    ringsEstimates: 'Dashed coloured rings are estimates.',
    pointsTitle: (size) => `How size ${size} fits you`,
    estimated: (points) => `${points.join(', ')} estimated from your height and weight. Add your own measurements for a higher confidence.`,
    chosen: (size) => `Size ${size} selected on the shop page`,
    chooseOnPage: 'Choose size {size} on the shop page.',
    choose: (size) => `Choose size ${size}`,
    chooseAnyway: (size) => `Select size ${size} anyway`,
  },
  chart: {
    title: 'Size chart',
    size: 'Size',
    columns: { bust: 'Bust', waist: 'Waist', hip: 'Hip', shoulder: 'Shoulders', thigh: 'Thigh', inseam: 'Inseam', footLengthCm: 'Foot length', footEu: 'EU size' },
    caption: (type, units) => `${type === 'body' ? 'Body measurements' : 'Garment measurements'}, in ${units === 'imperial' ? 'inches' : 'centimetres'}`,
    note: {
      body: 'The body each size is made for. Compare with your own measurements.',
      garment: 'Measured on the finished garment, so it includes the room the design allows.',
    },
    recommended: 'Recommended',
    notGiven: 'not given',
  },
  fit: {
    points: { bust: 'Bust', waist: 'Waist', hip: 'Hip', shoulder: 'Shoulders', thigh: 'Thigh', inseam: 'Leg length', foot: 'Foot' },
    bands: { tight: 'Tight', snug: 'Snug', good: 'Good fit', roomy: 'Roomy', loose: 'Loose' },
    asDesigned: 'as designed',
    moreRoom: (length) => `${length} more room than designed`,
    lessRoom: (length) => `${length} less room than designed`,
    notes: {
      closest: (size, band, point) => `Closest is ${size}, ${lower(band)} at the ${lower(point)}`,
      band: (band, point, o) =>
        `${band} at the ${lower(point)}${o.stretch ? ' (stretch fabric there)' : ''}${o.suggest === 'up' ? ' — consider a size up' : o.suggest === 'down' ? ' — consider a size down' : ''}`,
      add: (points) => `Add your ${list(points.map(lower))} ${points.length > 1 ? 'measurements' : 'measurement'} under Edit my measurements for a more confident result`,
      fitsWell: (size) => `Size ${size} fits you well`,
    },
  },
  peek: {
    yourSize: 'Your size: {size}',
    noneFits: 'No size fits well',
    unknown: 'Can’t recommend a size yet',
    see: (size) => `See how size ${size} fits you`,
    open: 'Open the fitting room',
    onlyYou: 'Only you can see this. The shop can’t.',
    unknownNote: 'Open the fitting room to add what this item needs.',
    noneNote: 'None of the sizes fits you well. Open the fitting room to compare.',
  },
  hero: {
    title: 'See it on me',
    alt: (garment, size) => `Generated estimate of ${garment} in size ${size} on your avatar`,
    explain: 'We send your avatar (the drawing above, not a photo) and the product image to our render partner for one picture. It is deleted within 24 hours.',
    consent: 'I agree to send my avatar for this one render.',
    working: 'Rendering…',
    start: (size) => `See size ${size} on me`,
    failed: 'The render did not finish.',
    slow: 'The render is taking too long. Try again later.',
  },
  view3d: {
    label: '3D estimate',
    open: 'See it in 3D (estimate)',
    heading: (size) => `3D estimate · size ${size}`,
    close: 'Close the 3D view',
    unavailable: (size) => `The 3D view isn’t available on this device. The figure above shows how size ${size} fits.`,
    canvas: (size) => `3D estimate of size ${size} on a model with your measurements`,
    loading: 'Loading…',
    draping: 'Draping…',
    sizes: 'Size in 3D',
    notPhoto: '3D estimate on a model with your measurements, not a photo.',
    picked: (size) => `Size ${size} was picked by the size advice.`,
    noneFits: 'No size fits well; the size advice decides, not this picture.',
    looking: (size) => `You are looking at size ${size}.`,
    rings: (size) => `Size rings of size ${size} (estimate)`,
    ringName: (key) => (key === 'hip' ? 'Hips' : key.charAt(0).toUpperCase() + key.slice(1)),
    hemNote: 'The 3D drape does not show the hem width yet; see the hem ring on the figure above.',
  },
};
