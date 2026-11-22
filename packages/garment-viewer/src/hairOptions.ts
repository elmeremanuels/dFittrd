/**
 * The shopper's hair choice for the realistic body spike (D28): one of ten hair types, one of four lengths and a colour.
 * Small and free of geometry, so the mount can validate the option without loading the hair code (`realisticHair.ts`,
 * a lazy chunk). A choice is a display value only: the shopper picks it by hand, it is never read from a photo, and
 * this package never stores or sends it (no request carries it, and the AI-layer passes are rendered without the hair).
 */

/** The common typing scale: 1 straight; 2A–2C wavy; 3A–3C curly; 4A–4C coily. */
export const HAIR_TYPES = ['1', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C'] as const;
export type HairType = (typeof HAIR_TYPES)[number];

/** For 3C to 4C a length is also a volume: the hair grows out and up and shrinks (a long 4C is an afro). */
export const HAIR_LENGTHS = ['short', 'chin', 'shoulder', 'long'] as const;
export type HairLength = (typeof HAIR_LENGTHS)[number];

/** The natural palette offered to the shopper (sRGB). Any other `#rrggbb` is accepted as well. */
export const HAIR_PALETTE = {
  black: '#1f1b19',
  'dark-brown': '#3b2a20',
  brown: '#5c3d29',
  'light-brown': '#8a6544',
  auburn: '#7a3420',
  copper: '#a8512a',
  'dark-blonde': '#9e7c4d',
  blonde: '#cdaa6a',
  platinum: '#e4d9c2',
  grey: '#a29f99',
} as const;
export type HairColourId = keyof typeof HAIR_PALETTE;
export const HAIR_COLOURS = Object.keys(HAIR_PALETTE) as HairColourId[];

/** `MountOptions.hair`: `colour` is a palette id (`HAIR_COLOURS`) or `#rrggbb`. */
export interface HairOptions {
  type: HairType;
  length: HairLength;
  colour: string;
}

/** A validated choice: the colour resolved to `#rrggbb` (lower case). */
export interface HairChoice {
  type: HairType;
  length: HairLength;
  hex: string;
}

/** The hair a host asked for, or null (bald, as before) for anything that is not a full, valid choice. */
export function hairOf(value: unknown): HairChoice | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<Record<keyof HairOptions, unknown>>;
  const type = HAIR_TYPES.find((t) => t === v.type);
  const length = HAIR_LENGTHS.find((l) => l === v.length);
  const c = typeof v.colour === 'string' ? v.colour.trim().toLowerCase() : '';
  const hex = c in HAIR_PALETTE ? HAIR_PALETTE[c as HairColourId] : /^#[0-9a-f]{6}$/.test(c) ? c : null;
  return type && length && hex ? { type, length, hex } : null;
}

/** A short tag of a choice, e.g. `4C-long-#1f1b19` (for `canvas.dataset.hair` and the picture tags). */
export const hairTag = (h: HairChoice): string => `${h.type}-${h.length}-${h.hex}`;
