import { readFileSync, readdirSync } from 'node:fs';
import { PRODUCT_NOTICE_TEXT, SHOP_SETTINGS_TEXT, heldNowText, productNoticeLines } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { MERCHANT_EN, merchantStrings } from './strings';

/**
 * D21: the merchant console writes no English of its own. Every interface string is in `strings.ts`, read through
 * `merchantStrings()` when a screen renders, so a translation pack is one more catalogue and no code change.
 */
const DIR = `${import.meta.dirname}/`;

/** Every source file of the console, subfolders included, without the catalogue, the demo data and the tests. */
function sources(dir: string, rel = ''): { name: string; src: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(`${dir}${e.name}/`, `${rel}${e.name}/`);
    if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name) || (rel === '' && (e.name === 'strings.ts' || e.name === 'mock.ts'))) return [];
    return [{ name: `${rel}${e.name}`, src: readFileSync(`${dir}${e.name}`, 'utf8') }];
  });
}

/** What inline interface text looks like, one pattern per way of writing it. */
const INLINE: Record<string, RegExp> = {
  // A line that is only words: a JSX text node on a line of its own.
  textLine: /^\s*\(?[A-Za-z]+(['’][a-z]+)?\)?[,:]?( [(“]?([A-Za-z0-9]+(['’][a-z]+)?|[&→=·—–-])[)”]?[,:.]?)+ ?[.…:!?↗]?\s*$/,
  // Words between a tag's `>` and the next `<` or `{` (`=>` and generics such as `Promise<void>;` are not tags).
  textAfterTag: /(?<![=\s])>\s*[·—–-]?\s*[A-Za-z][A-Za-z’':,-]*( [A-Za-z’'0-9(]+)+[^<{>;]*[<{]|(?<![=\s])>\s*[A-Z][a-z’']+([.…:!?]?\s*<| \{)|(?<![=\s])>\s*[·—–-]\s*[a-z]+ ?\{/,
  // Words after an element or an expression on the same line: `<Icon /> Sign out`, `{n} ready`.
  textAfterChild: /(\/>|\})\s*[·—–-]?\s*(?!(catch|else|finally|while|as|satisfies)\b)[A-Za-z][a-z’']*( [A-Za-z’'0-9(]+)+[^<{};]*(<\/|\{|$)/,
  // A JSX line that starts with words and goes on with an expression: `Size {size}`, `Switch to Curtain ({…})`.
  textBeforeChild: /^\s*[A-Z][A-Za-z’']*( [A-Za-z’'0-9(]+)* ?\(?\{/,
  // A readable attribute written as a literal, a template included.
  attribute: /\b(aria-label|aria-description|aria-roledescription|aria-placeholder|aria-valuetext|label|alt|title|placeholder|hint|emptyText|keyName)=(["'][^"']*[A-Za-z]|\{\s*[`'"])/,
  // A ternary or a fallback that yields a sentence or a capitalised word.
  ternary: /[?:]\s*(['"`])[A-Z][a-z’']+(\1| [^'"`]*\1)|(\?\?|\|\|)\s*(['"`])[A-Z][a-z’']+( [^'"`]*)?\4/,
  // A quoted phrase of two or more words (import paths, class lists and keys have no capitalised or sentence shape).
  sentence: /(['"`])[A-Z][a-z]+[.!?…]\1|(['"`]) \([a-z ]+\)\2|(['"`])([A-Z][A-Za-z’']*|[a-z]+)[:,]?( [A-Za-z’'0-9$({→:;,.-]+){2,}[^'"`]*\3|(['"`])[A-Z][a-z’']+[:,]? [a-z’'(][^'"`]*\6/,
  // Words in a template beside a value: `${n} swipes`, `Size ${size}`.
  template: /`[^`]*(\$\{[^`]*\} [a-z]{2,}[a-z ]*|[A-Za-z]{3,} \$\{)[^`]*`/,
  // Text handed straight to an error or a dialogue.
  message: /\b(setError|set[A-Z]\w*Error|confirm|alert|prompt)\(\s*['"`]/,
};

/** A `className={…}` expression, whatever braces it holds, is a class list. */
function withoutClassNames(line: string): string {
  let out = line;
  for (let at = out.indexOf('className={'); at >= 0; at = out.indexOf('className={', at + 1)) {
    let depth = 0;
    let end = at + 10;
    do {
      if (out[end] === '{') depth++;
      if (out[end] === '}') depth--;
      end++;
    } while (depth > 0 && end < out.length);
    out = `${out.slice(0, at)}className${out.slice(end)}`;
  }
  return out;
}

/** The line without what is not interface text although a pattern above would read it so. */
function code(line: string): string {
  return withoutClassNames(line)
    .replace(/\bclassName="[^"]*"/g, 'className')
    .replace(/\b(data-testid|data-step|key|id|htmlFor|aria-labelledby|aria-describedby|to|href|src|style)=("[^"]*"|\{`[^`]*`\})/g, '$1')
    .replace(/\bfrom '[^']*';?/g, 'from');
}
const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);
const hitsOf = (src: string): string[] =>
  src
    .split('\n')
    .filter((l) => !isComment(l))
    .flatMap((l) => {
      const c = code(l).replace(/\/\/.*$/, '');
      const which = Object.entries(INLINE).filter(([, re]) => re.test(c)).map(([name]) => name);
      return which.length ? [`${which.join('+')}: ${l.trim()}`] : [];
    });

describe('merchant console strings (D21)', () => {
  it('one lookup serves the English catalogue, with every section of the console', () => {
    expect(merchantStrings()).toBe(MERCHANT_EN);
    expect(Object.keys(MERCHANT_EN).sort()).toEqual(['analytics', 'assets', 'console', 'plan', 'setup']);
  });

  it('the console screens hold no interface text of their own: it is in the catalogue', () => {
    const files = sources(DIR);
    expect(files.map((f) => f.name).sort()).toEqual(expect.arrayContaining(['AssetReview.tsx', 'MerchantConsole.tsx', 'Setup.tsx', 'plan.ts']));
    for (const { name, src } of files) expect(hitsOf(src), name).toEqual([]);
  });

  it('the lookup is read when a screen renders, never once at module load', () => {
    for (const { name, src } of sources(DIR)) {
      const atTopLevel = src.split('\n').filter((l) => /^(export )?(const|let|var) .*merchantStrings\(\)/.test(l));
      expect(atTopLevel, name).toEqual([]);
      expect(src, name).not.toMatch(/\b(MERCHANT_EN|CONSOLE_EN|SETUP_EN|PLAN_EN|ANALYTICS_EN)\b/);
    }
  });

  it('the guard sees inline text when it comes back', () => {
    const fragment = (s: string): string => s.split('|').join('');
    const bad = [
      '<p>Hel|lo there</p>',
      '          Hel|lo there',
      '<button aria-label="Clo|se it" />',
      '<input placeholder="e.g. a na|me" />',
      "<StatCard label={`Fit ses|sions ${n}`} />",
      "{done ? 'All re|ady' : t.todo}",
      "<span>{ok ? 'Re|ady' : 'Not re|ady yet'}</span>",
      "setError('That did not wo|rk.');",
      "const note = 'Shown once eno|ugh shoppers have seen a size.';",
      'hint={`${n} swi|pes`}',
      '<LogOut aria-hidden /> Sign o|ut',
      '{n} rea|dy · {m} not ready yet',
      '          Size {si|ze}',
      "{value ?? 'Not kno|wn'}",
      '<th className="px-4 py-3">Pro|duct</th>',
      '<span>Si|ze {size}</span>',
      "return 'Act|ive.';",
      "return 'Pau|sed: shoppers see a short note.';",
      '<li>Per-ses|sion sizes and scores are not returned to your page.</li>',
      '<span className="text-xs"> · abo|ut {s.minutes} min</span>',
      "<span className=\"sr-only\">{s.done ? ' (do|ne)' : t.todo}</span>",
    ].map(fragment);
    for (const line of bad) expect(hitsOf(line), line).toHaveLength(1);
    const fine = [
      '<p className="text-sm text-ink-soft">{t.intro}</p>',
      '<StatCard label={o.saveRate} value={totalSwipes ? pct(saves / totalSwipes) : c.none} hint={o.swipes(totalSwipes)} />',
      "const tone = p.next?.tone ?? (p.status === 'active' ? 'success' : 'critical');",
      "<span className={`chip ${tone === 'success' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/30 bg-bad/10 text-bad'}`}>{t.ready}</span>",
      "const day = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });",
      '<ShieldCheck className="h-4 w-4" aria-hidden /> {o.fitOnPhone}',
      "confirmSetup: (body: { buttonConfirmed?: boolean; phoneConfirmed?: boolean }) => Promise<void>;",
      '{s.done ? <Check className="h-4 w-4" /> : s.number}',
      '} catch (e) {',
      "} else if (e instanceof Error && e.name === 'ApiError') {",
      "<NavLink key={to} className={({ isActive }) => `rounded-full px-3 ${isActive ? 'bg-ink text-cream' : 'text-ink-soft hover:bg-ink/5'}`}>",
      'return (',
      "case 'paused':",
    ];
    for (const line of fine) expect(hitsOf(line), line).toEqual([]);
  });

  it('says the shop settings and the fabric notices in the words the Shopify admin uses (@curtain/schema)', () => {
    const t = merchantStrings().console;
    const shared = SHOP_SETTINGS_TEXT;
    expect(t.settings.title).toBe(shared.title);
    expect([t.settings.saving, t.settings.saved, t.settings.failed, t.settings.unavailable]).toEqual([shared.saving, shared.saved, shared.failed, shared.unavailable]);
    expect({ ...t.settings.incomplete, heldNow: undefined }).toEqual({ title: shared.incomplete.title, intro: shared.incomplete.intro, choices: shared.incomplete.choices, defaultMark: shared.incomplete.defaultMark, heldNow: undefined });
    expect(t.settings.popup).toEqual(shared.popup);
    expect([t.settings.incomplete.heldNow(1), t.settings.incomplete.heldNow(4)]).toEqual([heldNowText(1), heldNowText(4)]);
    // The console's intro starts as the Shopify admin's, then adds its own Save button.
    expect(t.settings.intro.startsWith(shared.introSavedAtOnce.replace(/\.$/, ';'))).toBe(true);

    const p = t.products;
    expect([p.heldBack, p.heldBackSetting, p.heldBackNext, p.stretchAssumed]).toEqual([PRODUCT_NOTICE_TEXT.heldBack, PRODUCT_NOTICE_TEXT.heldBackSetting, PRODUCT_NOTICE_TEXT.heldBackNext, PRODUCT_NOTICE_TEXT.stretchAssumed]);
    const held = productNoticeLines({ status: 'incomplete', heldBack: { reason: 'incomplete_product_data', fields: ['fabric.stretchPct', 'fabric.drape'] }, notices: { defaulted: [], leftOut: [{ field: 'fabric.drape', reason: 'x' }, { field: 'fabric.future', reason: 'y' }] } });
    expect(p.heldBackText([p.fabricPart['fabric.stretchPct']!, p.fabricPart['fabric.drape']!])).toBe(held.heldBack);
    expect([p.leftOut(p.fabricPart['fabric.drape']!, p.fabricRule['fabric.drape']!), p.leftOutOther(p.fabricPart.other)]).toEqual(held.leftOut.map((l) => l.text));
    const sized = productNoticeLines({ status: 'active', notices: { defaulted: ['fabric.stretchPct'], leftOut: [{ field: 'fabric.stretchPct', reason: 'x' }] } });
    expect(p.leftOutStretch(p.fabricRule['fabric.stretchPct']!)).toBe(sized.leftOut[0]!.text);
  });
});
