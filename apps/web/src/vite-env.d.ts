/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** `1` shows the disabled "Use my face: coming soon" row in the avatar prompt (default: hidden). */
  readonly VITE_AVATAR_FACE_PHOTO?: string;
  /** `1` (slice 6 spike only): the "Use my face" row is live and draws the face on the 3D head, on the device (default: off). */
  readonly VITE_AVATAR_FACE_ON_HEAD?: string;
  /** `1` saves the picked skin colour on the device under "Remember me" (default: memory only). */
  readonly VITE_AVATAR_REMEMBER_LOOK?: string;
  /** 3D view lighting for the look review: `neutral` or `neutral-v2` (default and anything else: `classic`, today's look). */
  readonly VITE_VIEWER_LIGHTING?: string;
  /** 3D view head for the look review: `neutral-v2` (default and anything else: the viewer's own default, today's head). */
  readonly VITE_VIEWER_HEAD?: string;
  readonly VITE_AVATAR_SKIN?: string;
  /** `v2`: the male body v2 in the 3D view and the male 2D figure together (default and anything else: v1). */
  readonly VITE_MALE_SHAPE?: string;
  /** Preview: a women's 3D body at the typed height (`womenHeightFlag`); off unless "1". */
  readonly VITE_WOMEN_3D_HEIGHT?: string;
  /** Spike: `realistic-spike` draws the women's 3D body as the realistic body (`realisticBodyFlag`); off otherwise. */
  readonly VITE_VIEWER_BODY?: string;
}
