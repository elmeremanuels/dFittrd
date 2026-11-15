/**
 * The neutral standard face of the 2D figure (DECISIONS.md D19: "every mannequin gets a neutral
 * standard face, so the avatar never looks unfinished").
 *
 * It is one fixed drawing for everybody: two eyes, two brows, a nose line and a closed mouth, placed
 * by the head ellipse only. It reads no photo, no landmark and no measurement of a face, so it is
 * never a likeness of the shopper. The only input besides the head size is the skin colour, and only
 * to pick an ink that stays visible on it.
 */
import { CENTER_X, HEAD_TOP_Y, type BodyGeometry } from './body';

export interface NeutralFace {
  /** Eye centres (left, right) and their radii, px. */
  eyes: { cx: number; cy: number; rx: number; ry: number }[];
  /** SVG path data of the brows, the nose and the mouth (stroked, never filled). */
  brows: string[];
  nose: string;
  mouth: string;
  /** Stroke width of the lines, px. */
  stroke: number;
  /** The nose is a thinner line (not a fainter one: every line is drawn at full opacity). */
  noseStroke: number;
}

const f = (v: number): string => v.toFixed(1);

/** The same face for every body: only the head's size and place decide where the lines go. */
export function neutralFace(body: Pick<BodyGeometry, 'headR' | 'headRy'>): NeutralFace {
  const rx = body.headR;
  const ry = body.headRy;
  const cy = HEAD_TOP_Y + ry;
  const eyeY = cy + ry * 0.06;
  const eyeDx = rx * 0.42;
  const browY = eyeY - ry * 0.17;
  const browHalf = rx * 0.2;
  const noseTop = eyeY + ry * 0.1;
  const noseEnd = cy + ry * 0.36;
  const mouthY = cy + ry * 0.58;
  const mouthHalf = rx * 0.3;
  const brow = (side: 1 | -1): string => {
    const x = CENTER_X + side * eyeDx;
    return `M ${f(x - browHalf)},${f(browY + 0.6)} Q ${f(x)},${f(browY - 1.4)} ${f(x + browHalf)},${f(browY + 0.6)}`;
  };
  return {
    eyes: [-1, 1].map((side) => ({ cx: CENTER_X + side * eyeDx, cy: eyeY, rx: Math.max(1.2, rx * 0.085), ry: Math.max(1.4, rx * 0.1) })),
    brows: [brow(-1), brow(1)],
    nose: `M ${f(CENTER_X)},${f(noseTop)} L ${f(CENTER_X - rx * 0.07)},${f(noseEnd)} L ${f(CENTER_X + rx * 0.1)},${f(noseEnd)}`,
    mouth: `M ${f(CENTER_X - mouthHalf)},${f(mouthY)} Q ${f(CENTER_X)},${f(mouthY + ry * 0.07)} ${f(CENTER_X + mouthHalf)},${f(mouthY)}`,
    stroke: Math.max(0.9, rx * 0.06),
    noseStroke: Math.max(0.7, rx * 0.045),
  };
}

/** Relative luminance (WCAG) of a #RGB or #RRGGBB colour; 0.5 for anything else. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const raw = m[1]!;
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const lin = (i: number): number => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

const DARK_INK = '#1F1410';
const LIGHT_INK = '#F2E6DA';

/** WCAG contrast ratio of two colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const shift = (hex: string, amt: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const c = (v: number): number => Math.max(0, Math.min(255, v + amt));
  return `#${((c(n >> 16) << 16) | (c((n >> 8) & 0xff) << 8) | c(n & 0xff)).toString(16).padStart(6, '0')}`;
};

/**
 * The figure is not drawn in the flat skin colour: AvatarView shades it from `SKIN_SHADE.light`
 * to `SKIN_SHADE.dark` (channel steps), and its side shading and grain darken it a little more.
 * `SKIN_SHADE.head` is about where the head ends up (measured on screenshots: 11 to 14 below the
 * swatch at tone 6). The ink is chosen for that colour, and the test checks it over the whole range.
 */
export const SKIN_SHADE = { light: 10, dark: -22, head: -13, darkest: -32 } as const;

/** The skin colour about as it is drawn on the head (the swatch, shaded). */
export function drawnHeadColour(skinHex: string): string {
  return shift(skinHex, SKIN_SHADE.head);
}

/**
 * The ink of the face lines on a skin colour: whichever of a dark brown and a light warm tone
 * stands out more from the head as it is drawn. Between those two inks that is at least 3.8:1 on
 * any colour, so every line can be drawn at full opacity and still reach 3:1 after the shading.
 */
export function faceInk(skinHex: string): string {
  const head = drawnHeadColour(skinHex);
  return contrastRatio(DARK_INK, head) >= contrastRatio(LIGHT_INK, head) ? DARK_INK : LIGHT_INK;
}

const FIGURE_BACKDROP = '#F1ECE6';

/**
 * The outline of the figure: the skin colour, darkened until it stands out 3:1 from the light
 * backdrop of the mirror. On a light skin the fill alone is almost the backdrop's colour (1.1:1 at
 * the lightest swatch), and the head and arms would disappear. On a dark skin it is the fill itself.
 */
export function figureOutline(skinHex: string, backdrop: string = FIGURE_BACKDROP): string {
  for (let amt = 0; amt >= -255; amt -= 4) {
    const c = shift(skinHex, amt);
    if (contrastRatio(c, backdrop) >= 3.2) return c;
  }
  return DARK_INK;
}
