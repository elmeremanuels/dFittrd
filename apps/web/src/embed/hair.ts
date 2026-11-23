/**
 * The shopper's hair choice for the realistic body (D28, OI-170): one of ten types, one of four
 * lengths and a colour from the natural palette. The choice is picked by hand, kept on the device
 * like the skin tone, and never sent anywhere or inferred from a photo.
 *
 * The types, lengths and palette mirror `@curtain/garment-viewer/hairOptions` exactly so the
 * viewer's `hairOf` accepts what the picker produces.
 */

/** The common typing scale: 1 straight; 2A–2C wavy; 3A–3C curly; 4A–4C coily. */
export const HAIR_TYPES = ['1', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C'] as const;
export type HairType = (typeof HAIR_TYPES)[number];

export const HAIR_LENGTHS = ['short', 'chin', 'shoulder', 'long'] as const;
export type HairLength = (typeof HAIR_LENGTHS)[number];

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

/** The hair choice as the picker stores it (colour is a palette id). */
export interface HairPick {
  type: HairType;
  length: HairLength;
  colour: HairColourId;
}

/** A stored value read back: a pick only when it is exactly one of the valid options. */
export function parseHairPick(value: unknown): HairPick | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<HairPick>;
  const type = HAIR_TYPES.find((t) => t === v.type);
  const length = HAIR_LENGTHS.find((l) => l === v.length);
  const colour = HAIR_COLOURS.find((c) => c === v.colour);
  return type && length && colour ? { type, length, colour } : null;
}

/** The picker's choice as the viewer expects it (`MountOptions.hair`). */
export function hairPickToOptions(pick: HairPick): { type: HairType; length: HairLength; colour: string } {
  return { type: pick.type, length: pick.length, colour: pick.colour };
}
