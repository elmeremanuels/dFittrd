/**
 * The embed's English catalogue (DECISIONS.md D21): the one place the embed's interface text
 * lives for the strings moved here so far (the avatar prompt, the blocked screens, the loading
 * line). A translation pack is one more file of this shape, registered in `./index.ts`.
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
import type { BlockedKind } from '../flow';

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
}

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
};
