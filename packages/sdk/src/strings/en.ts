/**
 * The SDK's English catalogue (DECISIONS.md D21): every string the button, the QR modal, the
 * overlay, the toast and the size peek show. A translation pack is one more file of this shape,
 * registered in `../i18n.ts`.
 */
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

export const EN: Strings = {
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
