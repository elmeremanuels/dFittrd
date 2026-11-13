import type { ReactNode } from 'react';
import type { FitResult } from '@curtain/fit-engine';
import type { GarmentPayload } from '@curtain/schema';
import { useApp } from '@/store';
import { useCaptureMedia } from '@/store/media';
import { AvatarView } from './AvatarView';

export interface AvatarProps {
  garment: GarmentPayload | null;
  fit: FitResult | null;
  /** Size to render; defaults to the recommended (or closest) size. */
  size?: string | null;
  isLoading?: boolean;
  /** Hide the chrome (badge) e.g. inside a thumbnail. The disclaimer still applies to the parent. */
  bare?: boolean;
}

/** The app's mirror: `AvatarView` fed from the app store (profile, skin tone, captured media). */
export function Avatar(props: AvatarProps): ReactNode {
  const profile = useApp((s) => s.profile);
  const fitCtx = useApp((s) => s.fitCtx);
  const skinHex = useApp((s) => s.settings.skinHex);
  const media = useCaptureMedia();
  return <AvatarView {...props} measurements={fitCtx?.userBody.measurements ?? null} heightCm={profile?.measurements.height?.mean} skinHex={skinHex} media={media} />;
}

export default Avatar;
