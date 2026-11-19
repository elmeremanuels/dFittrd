/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** `1` shows the disabled "Use my face: coming soon" row in the avatar prompt (default: hidden). */
  readonly VITE_AVATAR_FACE_PHOTO?: string;
  /** `1` saves the picked skin colour on the device under "Remember me" (default: memory only). */
  readonly VITE_AVATAR_REMEMBER_LOOK?: string;
  /** 3D view lighting for the look review: `neutral` or `neutral-v2` (default and anything else: `classic`, today's look). */
  readonly VITE_VIEWER_LIGHTING?: string;
  /** 3D view head for the look review: `neutral-v2` (default and anything else: the viewer's own default, today's head). */
  readonly VITE_VIEWER_HEAD?: string;
}
