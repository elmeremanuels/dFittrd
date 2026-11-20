/**
 * Helpers around the avatar prompt's text (DECISIONS.md D19). The text itself is in the embed's
 * catalogue, `strings/en.ts` (D21: English only for now), read through `embedStrings`.
 */
import { embedStrings, parts, type EmbedCatalogue } from './strings';

/**
 * C30 around the name of the switch as the shopper sees it in the footer: the text before the
 * label, the label, the text after.
 */
export function c30Parts(s: EmbedCatalogue = embedStrings()): { before: string; label: string; after: string } {
  const [before, after] = parts(s.avatar.claims.c30, 'remember');
  return { before, label: s.rememberLabel, after };
}

/** C30 as one sentence, exactly as shown. */
export function c30Text(s: EmbedCatalogue = embedStrings()): string {
  const p = c30Parts(s);
  return `${p.before}${p.label}${p.after}`;
}
