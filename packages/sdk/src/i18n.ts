/** UI strings. English is the default; Dutch follows the page language (`<html lang="nl">`) or `data-locale`. */
export interface Strings {
  button: string;
  title: string;
  scan: string;
  openLink: string;
  expires: (minutes: number) => string;
  paused: string;
  pausedShort: string;
  error: string;
  close: string;
  qrAlt: string;
  /** Must stay identical to ESTIMATE_DISCLAIMER in @paskamer/schema (asserted in tests). */
  disclaimer: string;
}

/** Mirrors `ESTIMATE_DISCLAIMER` from @paskamer/schema. Copied so the SDK stays dependency-free. */
export const ESTIMATE_DISCLAIMER =
  'Estimate — generated from your measurements and the shop’s garment data, not a photo of you.';

const en: Strings = {
  button: 'Try in Paskamer',
  title: 'Try it on in Paskamer',
  scan: 'Scan with your phone to try it on in Paskamer',
  openLink: 'On this device instead? Open the link',
  expires: (m) => `This code expires in ${m} min`,
  paused: 'This shop’s fitting room is taking a short break. Please try again later.',
  pausedShort: 'This shop’s fitting room is paused right now — the app will explain.',
  error: 'We couldn’t open the fitting room right now. Please try again in a moment.',
  close: 'Close',
  qrAlt: 'QR code that opens this garment in Paskamer',
  disclaimer: ESTIMATE_DISCLAIMER,
};

const nl: Strings = {
  button: 'Pas in Paskamer',
  title: 'Pas het in Paskamer',
  scan: 'Scan met je telefoon om het te passen in Paskamer',
  openLink: 'Liever op dit apparaat? Open de link',
  expires: (m) => `Deze code verloopt over ${m} min`,
  paused: 'De paskamer van deze winkel is even gesloten. Probeer het later opnieuw.',
  pausedShort: 'De paskamer van deze winkel is momenteel gepauzeerd — de app legt het uit.',
  error: 'We konden de paskamer nu niet openen. Probeer het zo nog eens.',
  close: 'Sluiten',
  qrAlt: 'QR-code die dit kledingstuk opent in Paskamer',
  disclaimer: 'Schatting — berekend uit je maten en de kledinggegevens van de winkel, niet uit een foto van jou.',
};

export const STRINGS: Record<'en' | 'nl', Strings> = { en, nl };

/** Pick a string table from an explicit locale, else the document language, else the browser language. */
export function pickStrings(locale?: string | null): Strings {
  const tag = (
    locale ||
    (typeof document !== 'undefined' && document.documentElement.lang) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'en'
  ).toLowerCase();
  return tag.startsWith('nl') ? nl : en;
}
