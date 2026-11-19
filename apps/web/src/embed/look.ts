/**
 * The avatar's look in the embed (docs/research/photo-avatar-plan.md slice 1, DECISIONS.md D19).
 *
 * A look is a colour the shopper picked by hand from the ten swatches of the Monk Skin Tone scale.
 * Nothing here reads a photo or a camera: a tone is never guessed and then shown as a fact. The
 * type is local to the embed on purpose: it is not in `@curtain/schema`, so it cannot drift onto
 * the wire, into the fit signature, a postMessage or a merchant DTO.
 *
 * The photo-based face (D19) is not built. `facePhotoEnabled` is the flag for its row in the avatar
 * prompt: off unless the build sets `VITE_AVATAR_FACE_PHOTO=1`, and even then the row is a disabled
 * "coming soon" line. It stays off until counsel has answered (D20 point 4).
 */
import { MONK_SWATCHES } from '@/features/capture/faceSkin';

export { STANDARD_SKIN_HEX } from '@/render/body';

export interface SkinLook {
  /** Monk Skin Tone class, 1 (lightest) to 10 (darkest). */
  monk: number;
  /** The swatch's colour, `#RRGGBB`. */
  hex: string;
  /** How the colour was chosen. Only by hand so far. */
  source: 'picked';
}

export const MONK_CLASSES: readonly number[] = MONK_SWATCHES.map((_, i) => i + 1);

/** The look for a Monk class the shopper picked; null for anything that is not a class. */
export function lookForMonk(monk: number): SkinLook | null {
  const hex = Number.isInteger(monk) ? MONK_SWATCHES[monk - 1] : undefined;
  return hex ? { monk, hex: hex.toUpperCase(), source: 'picked' } : null;
}

/** A stored value read back: a look only when it is exactly one of the ten swatches. */
export function parseLook(value: unknown): SkinLook | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SkinLook>;
  const look = typeof v.monk === 'number' ? lookForMonk(v.monk) : null;
  return look && typeof v.hex === 'string' && v.hex.toUpperCase() === look.hex && v.source === 'picked' ? look : null;
}

/** The build flag of the photo-based face row. Default off. */
export function facePhotoEnabled(env: { VITE_AVATAR_FACE_PHOTO?: string } = import.meta.env): boolean {
  return env.VITE_AVATAR_FACE_PHOTO === '1';
}

/**
 * Slice 6 spike: `VITE_AVATAR_FACE_ON_HEAD=1` makes the "Use my face" row live (variant A: the photo
 * is read on the device and drawn on the 3D head; nothing is sent). Off in every normal build, where
 * the row stays the disabled "coming soon" line of `facePhotoEnabled`. Counsel has not answered (D20.4).
 */
export function faceOnHeadEnabled(env: { VITE_AVATAR_FACE_ON_HEAD?: string } = import.meta.env): boolean {
  return env.VITE_AVATAR_FACE_ON_HEAD === '1';
}
