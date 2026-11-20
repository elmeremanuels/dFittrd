/** Tiny, dependency-free HTML templating for the static site generator. Interpolations are escaped unless wrapped in `raw()` or produced by `html`. */

const SAFE = Symbol('safe-html');

export interface SafeHtml {
  readonly [SAFE]: true;
  readonly value: string;
}

export type Child = SafeHtml | string | number | boolean | null | undefined | readonly Child[];

export function raw(value: string): SafeHtml {
  return { [SAFE]: true, value };
}

export function isSafe(v: unknown): v is SafeHtml {
  return typeof v === 'object' && v !== null && SAFE in v;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function render(child: Child): string {
  if (child === null || child === undefined || child === false || child === true) return '';
  if (typeof child === 'number') return String(child);
  if (typeof child === 'string') return escapeHtml(child);
  if (isSafe(child)) return child.value;
  return (child as readonly Child[]).map(render).join('');
}

export function html(strings: TemplateStringsArray, ...values: Child[]): SafeHtml {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return raw(out);
}

/**
 * Inline emphasis for copy: `*word*` becomes `<em>word</em>` (the coral italic accent of a headline).
 * Everything else is escaped.
 */
export function em(text: string): SafeHtml {
  return raw(escapeHtml(text).replace(/\*([^*]+)\*/g, '<em>$1</em>'));
}

export function attrs(map: Record<string, string | number | boolean | null | undefined>): SafeHtml {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (v === null || v === undefined || v === false) continue;
    parts.push(v === true ? k : `${k}="${escapeHtml(String(v))}"`);
  }
  return raw(parts.length ? ' ' + parts.join(' ') : '');
}
