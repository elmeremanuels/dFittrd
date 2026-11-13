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
  /** Overlay loading state. */
  loading: string;
  /** "Open in the Curtain app" link (`data-mode="auto"`). */
  openApp: string;
  /** Toast fallback when the size could not be selected on the page. */
  yourSize: (size: string) => string;
  /** Title of the size peek iframe. */
  peek: string;
  /** Must stay identical to ESTIMATE_DISCLAIMER in @curtain/schema (asserted in tests). */
  disclaimer: string;
}

/** Mirrors `ESTIMATE_DISCLAIMER` from @curtain/schema. Copied so the SDK stays dependency-free. */
export const ESTIMATE_DISCLAIMER =
  'Estimate — generated from your measurements and the shop’s garment data, not a photo of you.';

const en: Strings = {
  button: 'Try it on',
  title: 'Try it on in Curtain',
  scan: 'Scan with your phone to try it on in Curtain',
  openLink: 'On this device instead? Open the link',
  expires: (m) => `This code expires in ${m} min`,
  paused: 'This shop’s fitting room is taking a short break. Please try again later.',
  pausedShort: 'This shop’s fitting room is paused right now — the app will explain.',
  error: 'We couldn’t open the fitting room right now. Please try again in a moment.',
  close: 'Close',
  qrAlt: 'QR code that opens this garment in Curtain',
  loading: 'Loading…',
  openApp: 'Open in the Curtain app',
  yourSize: (z) => `Your size: ${z}`,
  peek: 'Your size',
  disclaimer: ESTIMATE_DISCLAIMER,
};

const nl: Strings = {
  button: 'Try it on',
  title: 'Pas het in Curtain',
  scan: 'Scan met je telefoon om het te passen in Curtain',
  openLink: 'Liever op dit apparaat? Open de link',
  expires: (m) => `Deze code verloopt over ${m} min`,
  paused: 'Curtain is in deze winkel even gesloten. Probeer het later opnieuw.',
  pausedShort: 'Curtain is in deze winkel momenteel gepauzeerd — de app legt het uit.',
  error: 'We konden Curtain nu niet openen. Probeer het zo nog eens.',
  close: 'Sluiten',
  qrAlt: 'QR-code die dit kledingstuk opent in Curtain',
  loading: 'Laden…',
  openApp: 'Open in de Curtain-app',
  yourSize: (z) => `Jouw maat: ${z}`,
  peek: 'Jouw maat',
  disclaimer: 'Schatting — berekend uit je maten en de kledinggegevens van de winkel, niet uit een foto van jou.',
};

export const STRINGS: Record<'en' | 'nl', Strings> = { en, nl };

/**
 * Pick a string table from the shop page's own language: an explicit locale, else `<html lang>`.
 * Never the browser language, so an English shop page always shows English copy.
 */
export function pickStrings(locale?: string | null): Strings {
  const pageLocale = locale || (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
  return pageLocale.toLowerCase().startsWith('nl') ? nl : en;
}

/** The effective locale tag: explicit, else `<html lang>`, else the browser language, else `en`. */
export function localeTag(locale?: string | null): string {
  return (
    locale ||
    (typeof document !== 'undefined' && document.documentElement.lang) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'en'
  );
}
