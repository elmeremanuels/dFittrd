/** WCAG 2.x contrast helpers (A11Y-2): merchant colours are only used as text when they pass. */

/** `#rgb` / `#rrggbb` → [r, g, b] in 0–255, or null. */
export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** Contrast ratio between two hex colours (1–21), or 1 when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return 1;
  const [l1, l2] = [luminance(pa), luminance(pb)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** `color` when it reaches `min` (AA body text: 4.5) against `background`, else null. */
export function readableTextColor(color: string | null | undefined, background: string, min = 4.5): string | null {
  if (!color || !parseHex(color)) return null;
  return contrastRatio(color, background) >= min ? color : null;
}
