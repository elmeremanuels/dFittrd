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
  /**
   * How the colour was chosen: `picked` by hand, or `photo`: picked while a suggestion read from a
   * face photo was on screen (slice 4). Either way the shopper tapped the swatch; a `photo` look
   * goes with "Delete my photo" (C20) and is only ever stored with the face (D20.2), never in the
   * look row of C30.
   */
  source: 'picked' | 'photo';
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

/** A look read back from the face record: either source, still exactly one of the ten swatches. */
export function parseAnyLook(value: unknown): SkinLook | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SkinLook>;
  if (v.source !== 'picked' && v.source !== 'photo') return null;
  const look = parseLook({ ...v, source: 'picked' });
  return look ? { ...look, source: v.source } : null;
}

/**
 * The build flag of the photo-based face row, `VITE_AVATAR_FACE_PHOTO`. Default off:
 *   - unset (every normal build): no face row, no photo anywhere in the prompt;
 *   - `1`: the disabled "coming soon" row (what a build shows until counsel has answered, D20.4);
 *   - `live`: slices 4 and 5, all on the device (consent copy variant A). For review builds and
 *     the tests only, until counsel and the founder say otherwise.
 */
export type FacePhotoMode = 'off' | 'soon' | 'live';

export function facePhotoMode(env: { VITE_AVATAR_FACE_PHOTO?: string } = import.meta.env): FacePhotoMode {
  const v = env.VITE_AVATAR_FACE_PHOTO;
  return v === 'live' ? 'live' : v === '1' ? 'soon' : 'off';
}

/** The face row is drawn at all (the "coming soon" line or the live row). */
export function facePhotoEnabled(env: { VITE_AVATAR_FACE_PHOTO?: string } = import.meta.env): boolean {
  return facePhotoMode(env) !== 'off';
}

/** The age the camera items are for: the document's placeholder `[16]` (consent copy C5), not yet confirmed by counsel. */
export const FACE_PHOTO_MIN_AGE = 16;

/**
 * Slice 6 spike: `VITE_AVATAR_FACE_ON_HEAD=1` makes the "Use my face" row live (variant A: the photo
 * is read on the device and drawn on the 3D head; nothing is sent). Off in every normal build, where
 * the row stays the disabled "coming soon" line of `facePhotoEnabled`. Counsel has not answered (D20.4).
 */
export function faceOnHeadEnabled(env: { VITE_AVATAR_FACE_ON_HEAD?: string } = import.meta.env): boolean {
  return env.VITE_AVATAR_FACE_ON_HEAD === '1';
}

/**
 * Skin shading `skin-v2` (D22 point 3, the look review of branch claude/skin-v2) for a build:
 * `VITE_AVATAR_SKIN=skin-v2` shades the 2D figure (`render/skin2d.ts`) and the 3D mannequin
 * (`look.shading` of the viewer) the new way. Anything else, and every normal build: `flat`, today's
 * shading, unchanged. Not set anywhere until the founder approves it from the pictures.
 */
export function avatarSkinFlag(env: { VITE_AVATAR_SKIN?: string } = import.meta.env): 'flat' | 'skin-v2' {
  return env.VITE_AVATAR_SKIN === 'skin-v2' ? 'skin-v2' : 'flat';
}
