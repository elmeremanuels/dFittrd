import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createLookup, EMBED_LOCALE, embedLocales, embedStrings, type EmbedCatalogue, type EmbedLocale } from '../strings';
import { EN } from '../strings/en';

/**
 * DECISIONS.md D21: English first, translation packs later. The seam: one catalogue per locale,
 * one lookup. These tests prove a pack is "add a file and register it" without shipping one.
 */
describe('embed strings (D21)', () => {
  it('ships English only, and the embed asks for English', () => {
    expect(embedLocales()).toEqual(['en']);
    expect(EMBED_LOCALE).toBe('en');
    expect(embedStrings()).toBe(EN);
    expect(embedStrings('en')).toBe(EN);
    const files = readdirSync(fileURLToPath(new URL('../strings/', import.meta.url))).sort();
    expect(files).toEqual(['en.ts', 'index.ts']);
  });

  it('an unknown locale falls back to English', () => {
    for (const locale of ['nl', 'nl-NL', 'nl_BE', 'fr-FR', 'xx', '', 'toString', '__proto__']) {
      expect(embedStrings(locale as EmbedLocale), locale).toBe(EN);
    }
    expect(embedStrings(null as unknown as EmbedLocale)).toBe(EN);
  });

  it('a registered pack is picked up: exact locale, then its language, else English', () => {
    // A test-only pack. Registering a real one is one more entry in CATALOGUES (strings/index.ts).
    const FAKE: EmbedCatalogue = { ...EN, loading: '[xx] loading', actions: { tryAgain: '[xx] again', backToShop: '[xx] back' } };
    const FAKE_REGION: EmbedCatalogue = { ...FAKE, loading: '[xx-yy] loading' };
    const lookup = createLookup<EmbedCatalogue>({ en: EN, xx: FAKE, 'xx-yy': FAKE_REGION });
    expect(lookup('xx')).toBe(FAKE);
    expect(lookup('xx').actions.backToShop).toBe('[xx] back');
    expect(lookup('XX_zz')).toBe(FAKE);
    expect(lookup('xx-YY').loading).toBe('[xx-yy] loading');
    expect(lookup('en-AU')).toBe(EN);
    expect(lookup('zz')).toBe(EN);
    expect(lookup(undefined)).toBe(EN);
  });

  it('the embed never chooses its text by the browser or the shop page language', () => {
    const dir = fileURLToPath(new URL('../', import.meta.url));
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n))) {
      const src = readFileSync(`${dir}${f}`, 'utf8');
      expect(src, f).not.toMatch(/isDutchLocale|AvatarLang|embedStrings\((?!\)|EMBED_LOCALE\)|locale\))/);
    }
  });
});
