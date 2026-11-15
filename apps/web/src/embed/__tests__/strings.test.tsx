// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { c30Text } from '../avatarCopy';
import { BlockedScreen, EmbedFooter } from '../EmbedScreens';
import { peekNote } from '../peek';
import { createLookup, DEFAULT_EMBED_LOCALE, embedLocales, embedStrings, parts, setEmbedLocale, swapCatalogues, uiLocaleOf, type EmbedCatalogue } from '../strings';
import { EN } from '../strings/en';

/** A test-only pack. Registering a real one is one more entry in CATALOGUES (strings/index.ts). */
const FAKE: EmbedCatalogue = {
  ...EN,
  loading: '[xx] loading',
  rememberLabel: '[xx] remember',
  actions: { tryAgain: '[xx] again', backToShop: '[xx] back' },
  blocked: { ...EN.blocked, paused: { title: '[xx] paused', text: '[xx] paused text' } },
  footer: { ...EN.footer, forget: '[xx] forget', fitBy: '{brand} [xx] fit' },
  fit: { ...EN.fit, notes: { ...EN.fit.notes, fitsWell: (size) => `[xx] ${size} ok` } },
};

/**
 * DECISIONS.md D21: English first, translation packs later. The seam: one catalogue per locale,
 * one lookup, one place that says which locale the embed is shown in. These tests prove a pack is
 * "add a file and register it" without shipping one.
 */
describe('embed strings (D21)', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    cleanup();
    restore?.();
    restore = null;
    setEmbedLocale(null);
  });

  it('ships English only, and the embed reads English', () => {
    expect(embedLocales()).toEqual(['en']);
    expect(DEFAULT_EMBED_LOCALE).toBe('en');
    expect(embedStrings()).toBe(EN);
    expect(embedStrings('en')).toBe(EN);
    const files = readdirSync(`${import.meta.dirname}/../strings/`).sort();
    expect(files).toEqual(['en.ts', 'index.ts']);
  });

  it('a locale without a pack reads English, also when the integration asks for it', () => {
    for (const locale of ['nl', 'nl-NL', 'nl_BE', 'fr-FR', 'xx', '', 'toString', '__proto__']) {
      expect(embedStrings(locale), locale).toBe(EN);
      setEmbedLocale(locale);
      expect(embedStrings(), locale).toBe(EN);
    }
    expect(embedStrings(null)).toBe(EN);
  });

  it('a registered pack is picked up: exact locale, then its language, else English', () => {
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

  it('reads the interface locale from the embed URL only when it is a language tag', () => {
    expect(uiLocaleOf('?ui=nl')).toBe('nl');
    expect(uiLocaleOf('?shop=pk_x&ui=pt-BR')).toBe('pt-BR');
    expect(uiLocaleOf('?ui=nl_NL')).toBe('nl_NL');
    for (const bad of ['', '?ui=', '?ui=<script>', '?ui=n', '?ui=nl-', '?locale=nl', '?ui=' + 'a'.repeat(40)]) expect(uiLocaleOf(bad), bad).toBeNull();
  });

  it('with a registered pack, the screens show it for a shop that asks for it, with no other change', () => {
    restore = swapCatalogues({ en: EN, xx: FAKE });
    // What the entry does (mountRouter.tsx) with the URL the SDK built from data-locale="xx-YY".
    setEmbedLocale(uiLocaleOf('?ui=xx-YY'));
    render(
      <>
        <BlockedScreen kind="paused" onRetry={() => undefined} onClose={() => undefined} />
        <EmbedFooter remember onRemember={() => undefined} onForget={() => undefined} forgetStatus={null} appUrl="https://app.example" />
      </>,
    );
    expect(screen.getByRole('heading', { name: '[xx] paused' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '[xx] again' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '[xx] remember' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '[xx] forget' })).toBeInTheDocument();
    // A pack may move the wordmark: the screen follows the mark in the string.
    expect(screen.getByText(/\[xx\] fit/).textContent).toBe('Curtain [xx] fit');
    // Text built outside React follows too.
    expect(peekNote([], 'M')).toBe('[xx] M ok');
    expect(c30Text()).toContain('[xx] remember');
    // A shop that names no locale, or English, stays English.
    setEmbedLocale(uiLocaleOf(''));
    expect(embedStrings()).toBe(EN);
    setEmbedLocale('en');
    expect(embedStrings()).toBe(EN);
  });

  it('splits a string around the mark for an element', () => {
    expect(parts('Fit by {brand}', 'brand')).toEqual(['Fit by ', '']);
    expect(parts('{size} is yours', 'size')).toEqual(['', ' is yours']);
    expect(parts('no mark', 'size')).toEqual(['no mark', '']);
  });

  /** Every source file of the embed, subfolders included, without the tests and the catalogues. */
  function sources(dir: string, rel = ''): { name: string; src: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) return e.name === '__tests__' || (rel === '' && e.name === 'strings') ? [] : sources(`${dir}${e.name}/`, `${rel}${e.name}/`);
      return /\.tsx?$/.test(e.name) ? [{ name: `${rel}${e.name}`, src: readFileSync(`${dir}${e.name}`, 'utf8') }] : [];
    });
  }
  const EMBED_DIR = `${import.meta.dirname}/../`;

  it('the embed never chooses its text by the browser or the shop page language', () => {
    const files = sources(EMBED_DIR);
    expect(files.length).toBeGreaterThan(15);
    for (const { name, src } of files) {
      // Screens read the interface locale; none passes a locale of its own, whatever it is called.
      expect(src, name).not.toMatch(/isDutchLocale|AvatarLang|embedStrings\((?!\))/);
      // The interface locale is set in one place, from the `ui` mark on the embed's own URL.
      const sets = src.match(/setEmbedLocale\([^\n]*/g) ?? [];
      expect(sets, name).toEqual(name === 'mountRouter.tsx' ? ['setEmbedLocale(uiLocaleOf(location.search));'] : []);
    }
    const lookup = readFileSync(`${EMBED_DIR}strings/index.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(lookup).not.toMatch(/navigator|documentElement|\.lang\b|referrer|context/);
  });

  it('the embed screens hold no interface text of their own: it is in the catalogue', () => {
    const jsxText = /^\s*[A-Z][A-Za-z’']*( [A-Za-z’'0-9-]+)+[.…:]?\s*$|>[A-Z][a-z]+( [A-Za-z]+)+[^<{]*<|(aria-label|label|alt|title|placeholder)="[^"]*[A-Za-z]{3}|\?\s*'[A-Z][a-z]+ [^']*'\s*:/;
    for (const { name, src } of sources(EMBED_DIR).filter((f) => f.name.endsWith('.tsx'))) {
      const hits = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && jsxText.test(l));
      expect(hits, name).toEqual([]);
    }
  });
});
