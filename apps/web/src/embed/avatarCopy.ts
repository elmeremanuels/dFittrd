/**
 * Helpers around the avatar prompt's text (DECISIONS.md D19). The text itself is in the embed's
 * catalogue, `strings/en.ts` (D21: English only for now), read through `embedStrings`.
 */
import { EMBED_LOCALE, embedStrings, type EmbedLocale } from './strings';

/**
 * C30 around the name of the switch as the shopper sees it in the footer: the text before the
 * label, the label, the text after.
 */
export function c30Parts(locale: EmbedLocale = EMBED_LOCALE): { before: string; label: string; after: string } {
  const s = embedStrings(locale);
  const [before = '', after = ''] = s.avatar.claims.c30.split('{remember}');
  return { before, label: s.rememberLabel, after };
}

/** C30 as one sentence, exactly as shown. */
export function c30Text(locale: EmbedLocale = EMBED_LOCALE): string {
  const p = c30Parts(locale);
  return `${p.before}${p.label}${p.after}`;
}
