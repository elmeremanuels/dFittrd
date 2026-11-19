// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EstimateBadge } from '@/components/EstimateBadge';
import { setEmbedLocale } from '@/embed/strings';
import { appLocales, appStrings, DEFAULT_UI_LOCALE, setUiLocale, swapAppCatalogues, type AppCatalogue } from './index';
import { EN } from './en';

/**
 * DECISIONS.md D21 for everything in `apps/web` outside the embed's own screens: the components the
 * embed shares with the app, the camera scan and the consumer app read one catalogue (`@/strings`),
 * and no interface text is written in a component. The embed's screens have the same test in
 * `embed/__tests__/strings.test.tsx`, the merchant console in `merchant/strings.test.ts`.
 */
describe('app strings (D21)', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    cleanup();
    restore?.();
    restore = null;
    setEmbedLocale(null);
  });

  it('ships English only', () => {
    expect(appLocales()).toEqual(['en']);
    expect(DEFAULT_UI_LOCALE).toBe('en');
    expect(appStrings()).toBe(EN);
    expect(readdirSync(`${import.meta.dirname}/`).sort()).toEqual(['en', 'en.ts', 'index.ts', 'strings.test.tsx']);
    for (const locale of ['nl', 'nl-NL', 'fr_FR', 'xx', '', 'toString', '__proto__']) {
      setUiLocale(locale);
      expect(appStrings(), locale).toBe(EN);
    }
  });

  it('a registered pack is read by a shared component inside the embed, through the embed’s one locale', () => {
    const FAKE: AppCatalogue = { ...EN, shared: { ...EN.shared, estimate: { ...EN.shared.estimate, label: '[xx] estimate' } } };
    restore = swapAppCatalogues({ en: EN, xx: FAKE });
    // The embed's entry names the locale once (mountRouter.tsx); the shared components follow it.
    setEmbedLocale('xx-YY');
    expect(appStrings()).toBe(FAKE);
    render(<EstimateBadge />);
    expect(screen.getByText('[xx] estimate')).toBeInTheDocument();
    cleanup();
    setEmbedLocale(null);
    expect(appStrings()).toBe(EN);
    render(<EstimateBadge />);
    expect(screen.getByText(EN.shared.estimate.label)).toBeInTheDocument();
  });

  /** Every source file under `src/`, without tests, catalogues, dev harnesses, and the two surfaces with a guard of their own. */
  const SRC = `${import.meta.dirname}/../`;
  const SKIP_DIRS = new Set(['__tests__', 'strings', 'dev', 'embed', 'merchant', 'scripts']);
  function sources(dir: string, rel = ''): { name: string; src: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : sources(`${dir}${e.name}/`, `${rel}${e.name}/`);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [{ name: `${rel}${e.name}`, src: readFileSync(`${dir}${e.name}`, 'utf8') }] : [];
    });
  }
  const code = (src: string): string[] => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));

  // The embed's own rule (a line of JSX text, text between tags, a text attribute, a sentence in a ternary) ...
  const jsxText = /^\s*[A-Z][A-Za-z’']*( [A-Za-z’'0-9-]+)+[.…:]?\s*$|>[A-Z][a-z]+( [A-Za-z]+)+[^<{]*<|(aria-label|label|alt|title|placeholder)="[^"]*[A-Za-z]{3}|\?\s*'[A-Z][a-z]+ [^']*'\s*:/;
  // ... and stricter ones: any word between tags, a one-word JSX text line, a text attribute or prop written as a
  // string or a template, and a state setter or default given a sentence.
  const stricter = [
    />\s*[A-Za-z][a-z]{2,}[^<>{}=()]*<\//,
    /^\s*[A-Z][a-z]+[.…:!?]?\s*$/,
    /\b(aria-label|alt|title|placeholder|label|hint|subtitle|emptyText)=\{?[`'"][^`'"]*[A-Za-z]{3}/,
    /\b(setError|setStatus|setMessage|setNotice)\(\s*[`'"][A-Z]/,
    /\b(title|label|hint|subtitle|text|message|emptyText)\s*[:=]\s*[`'"][A-Z][a-z]+ [a-z]/,
  ];
  // A sentence in a string or a template anywhere (the way `render/rings.ts` used to build its notes). A developer's
  // error message (`new Error`, an assertion) is not interface text.
  const sentence = /[`'"](?:[A-Z][a-z’']+|\$\{[^}]+\}) [a-z’']+ [a-z’'${][^`'"]*[`'"]/;
  const developer = /new [A-Za-z]*Error\(|console\.|\bassert\(|=== '|!== '/;
  const flagged = (name: string, l: string): boolean => (name.endsWith('.tsx') && jsxText.test(l)) || stricter.some((re) => re.test(l)) || (sentence.test(l) && !developer.test(l));

  it('no component, route, render helper or scan step holds interface text of its own', () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(60);
    for (const { name, src } of files) {
      const lines = code(src);
      const hits = lines.filter((l) => flagged(name, l));
      expect(hits, name).toEqual([]);
    }
  });

  it('the guard catches the ways text used to be written', () => {
    const bad = [
      '        <p>Hello there</p>',
      '          Add your measurements',
      '      <button aria-label="Close it" />',
      '      <input placeholder={`Type here`} />',
      "      {done ? 'All done here' : null}",
      '          Estimate',
      "    setError('Could not save');",
      "  welcome: { title: 'Welcome to Curtain' },",
      '        <span className="chip">Your capture · garment overlay</span>',
      "    notes.push('Body girths marked “about” are estimated from your height and weight.');",
      "    const which = allChart ? 'Rings show the garment' : `The ${name} ring shows the chart`;",
    ];
    for (const l of bad) expect(flagged('x.tsx', l), l).toBe(true);
    const fine = [
      '        <p className="text-sm">{t.title}</p>',
      '      <button aria-label={t.close} />',
      "    case 'silk':",
      '    return (',
      "  const tone = band === 'tight' ? 'text-bad' : 'text-ok';",
      '          {t.label}',
      "    if (!ctx) throw new Error('2d context unavailable in this worker');",
    ];
    for (const l of fine) expect(flagged('x.tsx', l), l).toBe(false);
  });

  it('nothing outside the embed’s lookup names the interface locale, and the lookup never reads the browser', () => {
    for (const { name, src } of sources(SRC)) expect(src, name).not.toMatch(/setUiLocale\(|swapAppCatalogues\(/);
    const lookup = readFileSync(`${SRC}strings/index.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(lookup).not.toMatch(/navigator|documentElement|\.lang\b|referrer/);
  });
});
