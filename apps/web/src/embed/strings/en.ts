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

/** Girth bands, plus `short` / `long` for a length (men's inseam, sleeve, body length; slice M2b). */
export type FitBand = 'tight' | 'snug' | 'good' | 'roomy' | 'loose' | 'short' | 'long';
export type ChartColumn = 'bust' | 'waist' | 'hip' | 'shoulder' | 'thigh' | 'inseam' | 'footLengthCm' | 'footEu' | 'neck' | 'sleeve' | 'length' | 'rise';
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

/**
 * The live "Use my face" row of the slice 6 spike (behind `VITE_AVATAR_FACE_ON_HEAD`, off by
 * default; counsel has not answered, D20.4). The claims are variant A of the consent copy (the
 * photo stays on the device), word for word; the rest are labels that state nothing about data.
 */
export interface FaceSpikeStrings {
  c6: string;
  c7: string;
  /** Switched off again. */
  c9: string;
  yes: string;
  no: string;
  /** Under the avatar while a face is shown. */
  c27: string;
  working: string;
  notFound: string;
  turned: string;
  small: string;
  failed: string;
}

/**
 * The live face photo rows of slices 4 and 5 (behind `VITE_AVATAR_FACE_PHOTO=live`, off by default;
 * counsel has not answered, D20.4). `claims` are variant A of the consent copy (the photo stays on
 * the device), word for word (`avatarCopy.test.ts` checks each one against the document; `{age}` is
 * the document's `[16]` placeholder). `ui` are labels and hints that state nothing about anybody's
 * data: what to press, how to take a better photo.
 */
export interface FacePhotoClaims {
  /** "Use my face": what happens. */
  c6: string;
  c7: string;
  /** On yes. */
  faceOnYes: string;
  /** On no. */
  faceOnNo: string;
  /** Switched off again. */
  c9: string;
  yes: string;
  no: string;
  /** Under the avatar while a face is shown. */
  c27: string;
  /** Above the camera items; `{age}` is the age of the document's placeholder. */
  c5: string;
  /** "Match my skin tone" with the photo offer: both sentences of C11, and C12 (variant A). */
  c11: string;
  c12: string;
  /** On yes of the skin row: a photo is read only after asking; the shopper chooses. */
  c26: string;
  /** "Remember my photo on this device": the switch and what it does. */
  c19Label: string;
  c19: string;
  /** "Delete my photo": the button and what it does. */
  c20Label: string;
  c20: string;
}

export interface FacePhotoUi {
  takePhoto: string;
  choosePhoto: string;
  ageConfirm: (age: number) => string;
  readFromPhoto: string;
  skinAskNo: string;
  workingFace: string;
  workingSkin: string;
  /** The suggestion from the photo: a proposal, never the answer. */
  suggestion: (n: number, total: number) => string;
  suggested: string;
  orPick: string;
  matchHint: string;
  /** "Remember my photo" needs the footer's "Remember me" switch (its label) to be on. */
  needsRemember: (rememberLabel: string) => string;
  /** Accessible name of the face tile preview in the prompt. */
  preview: string;
  notFound: string;
  failed: string;
  notices: Record<'turned' | 'small' | 'bright' | 'dark' | 'side' | 'cast', string>;
}

export interface EmbedCatalogue {
  avatar: { claims: AvatarClaims; ui: AvatarUi; faceSpike: FaceSpikeStrings; facePhoto: { claims: FacePhotoClaims; ui: FacePhotoUi } };
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
    /** A men's garment (slice M2) names some fields as menswear does. */
    labelsMen: Partial<Record<AboutField, string>>;
    /** How to measure, shown under a men's field. */
    hintsMen: Partial<Record<AboutField, string>>;
    /** Under the men's fields: they are typed in, never estimated. */
    mensTyped: string;
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
    withoutThemMen: (bottom: boolean) => string;
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
    /** A two-dimensional size (W/L) picked axis by axis. */
    sizeAxes: (waist: string, leg: string) => string;
    /** A W/L chart whose leg could not be checked: the heading names the waist only (slice M2b). */
    waistOnly: (waist: string) => string;
    noneFits: string;
    adjusted: (direction: 'up' | 'down', from: string, preference: FitPreference) => string;
    compare: string;
    /** A "Compare sizes" chip for a pull-on size whose waistband does not stretch over the hips (no score shown). */
    compareNoPullOn: string;
    /** In place of the fit score when the recommended pull-on size's band only just passes the hips (the engine's score ignores that). */
    scorePullOnTight: string;
    /** A "Compare sizes" chip for a pull-on size whose band only just passes the hips (no score shown, as for the recommendation). */
    compareJustPullsOn: string;
    /** "Selected on the shop page" when that size's band does not stretch over the hips. */
    onPageNoPullOn: (size: string) => string;
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
    /**
     * The waist row of "How size … fits you" for a pull-on size whose band only just passes (`marginal`) or does not
     * pass (`blocked`) the hips: the check in place of the chart word, and the chart word kept as the line under it.
     */
    pointPullOn: { marginal: string; blocked: string };
    pointByChart: (gap: string, band: string) => string;
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
    /** Column names of a men's chart that differ from `columns`. */
    columnsMen: Partial<Record<ChartColumn, string>>;
    caption: (type: 'body' | 'garment', units: Units) => string;
    note: Record<'body' | 'garment', string>;
    recommended: string;
    notGiven: string;
  };
  fit: {
    /** Fit points by key; a point without a name here is shown by its key. */
    points: Record<string, string>;
    /** Names of a men's garment's points that differ from `points` (slice M2: "Chest", never "Bust"). */
    pointsMen: Record<string, string>;
    bands: Record<FitBand, string>;
    asDesigned: string;
    moreRoom: (length: string) => string;
    /** A men's chest whose room follows from fitting the waist (fit engine `waistLedCm`). */
    moreRoomForWaist: (length: string) => string;
    lessRoom: (length: string) => string;
    /** A length point (inseam, sleeve, body length). */
    lengthRight: string;
    longer: (length: string) => string;
    shorter: (length: string) => string;
    notes: {
      closest: (size: string, band: string, point: string) => string;
      band: (band: string, point: string, o: { stretch: boolean; suggest: 'up' | 'down' | null }) => string;
      add: (points: string[]) => string;
      fitsWell: (size: string) => string;
      /** The size was chosen to fit the waist, so it is roomier at the chest (men's tops). */
      waistLed: (chest: string) => string;
      /** A W/L chart whose leg could not be checked (no inseam column, or no inside leg). */
      legUnchecked: (waist: string) => string;
      /**
       * Pull-on garments (fit engine `SizeFit.pullOn`). `short`: the band is short of the hips at
       * the stretch the shop measured, within the allowance; otherwise it only just reaches.
       */
      pullOnTight: (o: { short: boolean }) => string;
      /** No size's waistband passes the hips; `size` is the least short one. */
      pullOnNone: (size: string) => string;
      /** The pull-on check could not run: no hips measurement. `pullOnUncheckedShort` is the size peek's line. */
      pullOnUnchecked: string;
      pullOnUncheckedShort: string;
      /** The size's waistband numbers were not measured by the shop; `rough`: extrapolated beyond the measured sizes. */
      tapeEstimated: (size: string, o: { rough: boolean }) => string;
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
    /** A W/L chart whose leg could not be checked: the waist is known, no full size is (the line and its note). */
    waistOnly: (waist: string) => string;
    waistOnlyNote: string;
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
  realism: {
    /** The label on every AI image (hard rule 3). */
    label: string;
    title: string;
    explain: string;
    consent: string;
    start: (size: string) => string;
    working: string;
    alt: (garment: string, size: string) => string;
    caption: string;
    refused: string;
    reason: (code: string) => string;
    failed: string;
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
    /** A W/L chart whose leg could not be checked: the waist is picked, the leg on screen is not advice. */
    waistOnly: (waist: string) => string;
    looking: (size: string) => string;
    rings: (size: string) => string;
    ringName: (key: string) => string;
    hemNote: string;
    /** A server drape bake: drawn in one plain colour. */
    plainColour: string;
    /** A server drape bake: where the size's garment measurements come from. */
    provenance: (size: string, provenance: 'measured' | 'interpolated' | 'extrapolated') => string;
    /** A server drape bake: the shopper lies beyond the bodies the size was draped on. */
    held: (size: string) => string;
    /**
     * A server drape bake: beyond the last body the size was draped on, short of a body it was not draped on (that
     * body's hip, with its unit). `rule` is the bake's stated reason: `pull-on`, the band cannot be pulled over that body.
     */
    between: (size: string, refusedHip: string, rule: 'pull-on' | null) => string;
    /** A server drape bake: at or beyond a body the size was not draped on (`rule` as for `between`); the size is not drawn. */
    refused: (size: string, refusedHip: string, rule: 'pull-on' | null) => string;
    /** A server drape bake: the size advice says the band of this size does not go over the shopper's hips; it is not drawn. */
    adviceBlocked: (size: string) => string;
    /** A server drape bake: the sizes differ little in the picture; the room is in the size rings. */
    sizesAlike: string;
    /** A size too small for this body (the fit engine says it does not close at `where`, the body `larger` larger): not draped, not drawn. */
    notDrawn: (size: string, where: string, larger: string) => string;
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
    facePhoto: {
      claims: {
        c6: 'We use a photo of your face to draw your face on the avatar.',
        c7: 'The photo stays on your device. It is never sent to us.',
        faceOnYes: 'Your device asks if we may use the camera. You can also pick a photo you already have.',
        faceOnNo: 'Nothing happens. The avatar keeps the standard face.',
        c9: 'Your face is taken off the avatar and deleted from this device.',
        yes: 'Yes, use my photo',
        no: 'No, keep the standard face',
        c27: 'Your face on an estimated body',
        c5: 'The photo and the scan are for people aged {age} or older.',
        c11: 'Pick your skin colour yourself. Or let us read it from your photo.',
        c12: 'Reading it happens on your device.',
        c26: 'If you want us to read it from a photo, we ask first. You always choose the final colour.',
        c19Label: 'Remember my photo on this device',
        c19: 'Off: your face is gone when you close this window. On: it is saved on this device, for this shop only. Not with us.',
        c20Label: 'Delete my photo',
        c20: 'Removes your face, and the colour we read from it, from this device. Right now.',
      },
      ui: {
        takePhoto: 'Take a photo',
        choosePhoto: 'Choose a photo',
        ageConfirm: (age) => `I am ${age} or older`,
        readFromPhoto: 'Read it from my photo',
        skinAskNo: 'No, I will pick it myself',
        workingFace: 'Drawing your face…',
        workingSkin: 'Looking at the colour…',
        suggestion: (n, total) => `Your photo points to colour ${n} of ${total}, or one next to it. Hold your hand next to the row and tap the colour that looks right to you.`,
        suggested: 'From your photo',
        orPick: 'Try another photo, or pick the colour yourself.',
        matchHint: 'Pick your skin colour below, so your face and the avatar match.',
        needsRemember: (label) => `To switch this on, first switch on "${label}" at the bottom of this window.`,
        preview: 'Your face as it is drawn on the avatar',
        notFound: 'No face was found in that picture. Try another one, facing the camera.',
        failed: 'That did not work. Try another picture.',
        notices: {
          turned: 'Your head is turned in that picture. One straight from the front works best.',
          small: 'Your face is small in that picture. A closer one works best.',
          bright: 'Part of your face is very bright in that picture. Soft daylight works best.',
          dark: 'That picture is dark. More light works best.',
          side: 'The light comes from one side in that picture. Facing a window works best.',
          cast: 'The light in that picture is coloured. Daylight works best.',
        },
      },
    },
    faceSpike: {
      c6: 'We use a photo of your face to draw your face on the avatar.',
      c7: 'The photo stays on your device. It is never sent to us.',
      c9: 'Your face is taken off the avatar and deleted from this device.',
      yes: 'Yes, use my photo',
      no: 'No, keep the standard face',
      c27: 'Your face on an estimated body',
      working: 'Drawing your face…',
      notFound: 'No face was found in that picture. Try another one, facing the camera.',
      turned: 'Your head is turned. A picture straight from the front works best.',
      small: 'Your face is small in that picture. A closer one works best.',
      failed: 'That did not work. Try another picture.',
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
    labels: {
      height: 'Height',
      weight: 'Weight',
      bust: 'Bust / chest',
      waist: 'Waist',
      hip: 'Hip',
      inseam: 'Inseam',
      footEu: 'Shoe size (EU)',
      neck: 'Neck',
      sleeve: 'Arm length',
      shoulder: 'Shoulder width',
      thigh: 'Thigh',
    },
    labelsMen: { bust: 'Chest', hip: 'Seat', inseam: 'Inside leg' },
    hintsMen: {
      bust: 'Round the fullest part, under the arms',
      waist: 'Round your natural waist, between the lowest rib and the hip bone',
      hip: 'Round the fullest part of the seat',
      inseam: 'Crotch to floor, without shoes',
      neck: 'Round the base of the neck, where a collar sits',
      sleeve: 'Shoulder bone to wrist, over a bent elbow',
      shoulder: 'Across the back, shoulder bone to shoulder bone',
      thigh: 'Round the fullest part of one thigh, just under the crotch',
    },
    mensTyped: 'Neck, arm length and shoulder width are only used when you type them in. We never estimate them.',
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
    withoutThemMen: (bottom) =>
      `Optional. Without them we estimate ${bottom ? 'waist and seat' : 'chest and waist'} from your height and weight${bottom ? '' : ', and do not check shoulders, neck or sleeves'}.`,
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
    sizeAxes: (waist, leg) => `Waist ${waist} · Leg ${leg}`,
    waistOnly: (waist) => `Waist ${waist} fits you best`,
    noneFits: 'No size fits well',
    adjusted: (direction, from, preference) => `One size ${direction} from ${from} for your ${preference} preference.`,
    compare: 'Compare sizes',
    compareNoPullOn: 'too small to pull on',
    scorePullOnTight: 'Only just pulls on',
    compareJustPullsOn: 'only just pulls on',
    onPageNoPullOn: (size) => `Selected on the shop page: ${size}. Its waistband does not stretch over your hips.`,
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
    pointPullOn: { marginal: 'Only just pulls on', blocked: 'Too small to pull on' },
    pointByChart: (gap, band) => `By the size chart: ${band.toLowerCase()}, ${gap}`,
    estimated: (points) => `${points.join(', ')} estimated from your height and weight. Add your own measurements for a higher confidence.`,
    chosen: (size) => `Size ${size} selected on the shop page`,
    chooseOnPage: 'Choose size {size} on the shop page.',
    choose: (size) => `Choose size ${size}`,
    chooseAnyway: (size) => `Select size ${size} anyway`,
  },
  chart: {
    title: 'Size chart',
    size: 'Size',
    columns: {
      bust: 'Bust',
      waist: 'Waist',
      hip: 'Hip',
      shoulder: 'Shoulders',
      thigh: 'Thigh',
      inseam: 'Inseam',
      footLengthCm: 'Foot length',
      footEu: 'EU size',
      neck: 'Neck',
      sleeve: 'Sleeve',
      length: 'Length',
      rise: 'Rise',
    },
    columnsMen: { bust: 'Chest', hip: 'Seat' },
    caption: (type, units) => `${type === 'body' ? 'Body measurements' : 'Garment measurements'}, in ${units === 'imperial' ? 'inches' : 'centimetres'}`,
    note: {
      body: 'The body each size is made for. Compare with your own measurements.',
      garment: 'Measured on the finished garment, so it includes the room the design allows.',
    },
    recommended: 'Recommended',
    notGiven: 'not given',
  },
  fit: {
    points: { bust: 'Bust', waist: 'Waist', hip: 'Hip', shoulder: 'Shoulders', thigh: 'Thigh', inseam: 'Leg length', foot: 'Foot', neck: 'Neck', sleeve: 'Sleeve', length: 'Length' },
    pointsMen: { bust: 'Chest', hip: 'Seat', length: 'Body length', shoulder: 'Shoulder width' },
    bands: { tight: 'Tight', snug: 'Snug', good: 'Good fit', roomy: 'Roomy', loose: 'Loose', short: 'Short', long: 'Long' },
    asDesigned: 'as designed',
    moreRoom: (length) => `${length} more room than designed`,
    moreRoomForWaist: (length) => `${length} more room, so the waist fits`,
    lessRoom: (length) => `${length} less room than designed`,
    lengthRight: 'the right length',
    longer: (length) => `${length} longer than ideal`,
    shorter: (length) => `${length} shorter than ideal`,
    notes: {
      closest: (size, band, point) => `Closest is ${size}, ${lower(band)} at the ${lower(point)}`,
      band: (band, point, o) =>
        `${band} at the ${lower(point)}${o.stretch ? ' (stretch fabric there)' : ''}${o.suggest === 'up' ? ' — consider a size up' : o.suggest === 'down' ? ' — consider a size down' : ''}`,
      add: (points) => `Add your ${list(points.map(lower))} ${points.length > 1 ? 'measurements' : 'measurement'} under Edit my measurements for a more confident result`,
      fitsWell: (size) => `Size ${size} fits you well`,
      waistLed: (chest) => `Sized to fit your waist, so it is roomier at the ${lower(chest)}`,
      legUnchecked: (waist) => `Waist ${waist} fits you best. We could not check the leg length: add your inside leg, or choose your usual leg`,
      pullOnTight: (o) =>
        o.short
          ? 'To pull it on, the waistband has to stretch over your hips a little more than is comfortable'
          : 'To pull it on, the waistband only just stretches over your hips',
      pullOnNone: (size) => `No size stretches over your hips to pull it on. The closest is ${size}`,
      pullOnUnchecked: 'Add your hips measurement under Edit my measurements so we can check that the waistband goes over your hips',
      pullOnUncheckedShort: 'We have not checked that the waistband goes over your hips',
      tapeEstimated: (size, o) =>
        o.rough
          ? `Size ${size} was not measured by the shop. Its waistband numbers are a rough estimate`
          : `Size ${size} was not measured by the shop. Its waistband numbers are estimated from the sizes next to it`,
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
    waistOnly: (waist) => `Waist ${waist} fits you best`,
    waistOnlyNote: 'The leg length is not checked yet. Open the fitting room to add your inside leg.',
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
  realism: {
    label: 'AI-enhanced estimate',
    title: 'Make it look real',
    explain: 'We send the 3D drawing above (not a photo of you) to our image partner, who makes it look like a photo. We check that the length, the fit and the colour stayed the same as in 3D, or we do not show it. Nothing is kept.',
    consent: 'I agree to send the 3D drawing for one picture.',
    start: (size) => `Make size ${size} look real`,
    working: 'Making the picture…',
    alt: (garment, size) => `AI-enhanced estimate of ${garment} in size ${size}, made from the 3D estimate`,
    caption: 'AI-enhanced estimate, made from the 3D estimate. It is not a photo of you and not a photo of the garment on a person.',
    refused: 'We did not show the picture: it changed the garment compared with the 3D estimate.',
    reason: (code) =>
      ({
        hem: 'The length moved.',
        waist: 'The waist moved.',
        width: 'The fit changed.',
        colour: 'The colour changed.',
        silhouette: 'The outline changed.',
        garment_outline: 'The outline of the garment changed.',
        size_difference: 'It no longer looked like this size.',
        unverifiable: 'We could not check this garment’s colour.',
        provider: 'The image partner did not answer.',
      })[code] ?? 'It did not pass our checks.',
    failed: 'The picture could not be made. The 3D estimate above is unchanged.',
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
    waistOnly: (waist) => `The size advice picked waist ${waist}; the leg length was not checked.`,
    looking: (size) => `You are looking at size ${size}.`,
    rings: (size) => `Size rings of size ${size} (estimate)`,
    ringName: (key) => (key === 'hip' ? 'Hips' : key.charAt(0).toUpperCase() + key.slice(1)),
    hemNote: 'The 3D drape does not show the hem width yet; see the hem ring on the figure above.',
    plainColour: 'Shown in one plain colour; the print is not drawn.',
    provenance: (size, p) => (p === 'measured' ? `Size ${size} is built from the shop’s tape.` : `Size ${size} is not on the shop’s tape; it is ${p} from the sizes that are.`),
    held: (size) => `Your hips are outside the bodies size ${size} was draped on, so it is shown on the nearest one.`,
    between: (size, hip, rule) =>
      `Your hips are past the largest body size ${size} was draped on, so it is shown on that body; ${rule === 'pull-on' ? `its band does not stretch over the model with ${hip} hips, so size ${size} was not draped on it` : `size ${size} was not draped on a body with ${hip} hips`}.`,
    refused: (size, hip, rule) =>
      `Size ${size} is not drawn: ${rule === 'pull-on' ? `its band does not stretch over the model with ${hip} hips` : `it was not draped on a body with ${hip} hips`}, and yours are at least that.`,
    adviceBlocked: (size) => `Size ${size} is not drawn: the size advice says its band does not stretch over your hips.`,
    sizesAlike: 'In 3D the sizes look much alike; how much room each size gives is in the size rings.',
    notDrawn: (size, where, larger) => `Size ${size} is not drawn: it does not close at the ${where} on a body like yours (the body is ${larger} larger than the garment, more than its fabric gives). The size advice says how it fits.`,
  },
};
