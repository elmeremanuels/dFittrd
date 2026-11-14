/**
 * The text of the avatar prompt (DECISIONS.md D19), English and Dutch.
 *
 * `claims` is copied word for word from `docs/legal/avatar-consent-copy.md` (sections 2 and 3,
 * variant A: nothing leaves the device). `avatarCopy.test.ts` reads that file and fails when a
 * line here is not in it, so the prompt cannot drift from the text counsel reviews. The plain text
 * must never promise more than the legal text (D19): where a sentence of the copy describes
 * something this build does not do (reading the colour from a photo, C11's second sentence, C12,
 * C26), that sentence is left out rather than shown.
 *
 * `ui` holds the small labels the copy document does not give (close, coming soon, the names of
 * the swatches). They state nothing about what happens to anybody's data.
 */
export type AvatarLang = 'en' | 'nl';

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
  /** `{remember}` is the label of the embed's own "Remember me" switch. */
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
}

/** The label of the footer's switch, which is English in every locale so far. */
export const REMEMBER_LABEL = 'Remember me on this shop';

const EN: AvatarClaims = {
  title: 'Make the avatar look like you',
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
};

const NL: AvatarClaims = {
  title: 'Laat de avatar op jou lijken',
  c1: 'Jij kiest. Alles staat uit tot jij het aanzet.',
  c2: 'Je krijgt hoe dan ook je maatadvies.',
  c3: 'De winkel ziet je foto, je gezicht en je lichaamsmaten nooit.',
  c4: 'We gebruiken je foto niet om je te herkennen, niet om AI iets te leren en niet voor reclame.',
  termsLink: 'Lees de volledige privacyvoorwaarden',
  faceName: 'Gebruik mijn gezicht',
  faceOff: 'De avatar heeft een standaardgezicht.',
  skinName: 'Mijn huidskleur',
  c11Pick: 'Kies zelf je huidskleur.',
  skinOff: 'De avatar heeft een standaardkleur.',
  skinOnYes: 'Kies een kleur uit de rij.',
  c30: 'Staat "{remember}" aan? Dan wordt je kleur op dit apparaat bewaard, bij je andere antwoorden.',
  c14: 'De avatar krijgt weer de standaardkleur. Jouw kleur wordt van dit apparaat gewist.',
  bodyOff: 'Je typt je maten in.',
};

const UI_EN: AvatarUi = {
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
  open: EN.title,
};

const UI_NL: AvatarUi = {
  close: 'Sluiten',
  done: 'Klaar',
  comingSoon: 'Komt binnenkort',
  on: 'Aan',
  off: 'Uit',
  measurementsName: 'Mijn maten',
  typeMeasurements: 'Mijn maten intypen',
  swatch: (n, total) => `Kleur ${n} van ${total}`,
  lightest: 'lichtste',
  darkest: 'donkerste',
  picked: (n, total) => `Kleur ${n} van ${total} staat op de avatar.`,
  open: NL.title,
};

export const AVATAR_CLAIMS: Record<AvatarLang, AvatarClaims> = { en: EN, nl: NL };
export const AVATAR_UI: Record<AvatarLang, AvatarUi> = { en: UI_EN, nl: UI_NL };

/** C30 with the name of the switch as the shopper sees it in the footer. */
export function c30Text(lang: AvatarLang): string {
  return AVATAR_CLAIMS[lang].c30.replace('{remember}', REMEMBER_LABEL);
}
