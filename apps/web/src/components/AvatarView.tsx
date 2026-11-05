import { motion, useReducedMotion } from 'motion/react';
import { useId, useMemo, type ReactNode } from 'react';
import type { FitResult } from '@curtain/fit-engine';
import { fitGapsForRender } from '@curtain/fit-engine';
import type { GarmentPayload, UserBody } from '@curtain/schema';
import { adjustColor, bodyGeometry, bodyPath, fabricLook, garmentGeometry, isHex, levelY, VIEW_H, VIEW_W, HEAD_TOP_Y } from '@/render/body';
import { EstimateBadge } from './EstimateBadge';

export interface AvatarMedia {
  faceUrl: string | null;
  baseFrame: { url: string; width: number; height: number } | null;
}

export interface AvatarViewProps {
  garment: GarmentPayload | null;
  fit: FitResult | null;
  /** Size to render; defaults to the recommended (or closest) size. */
  size?: string | null;
  isLoading?: boolean;
  /** Hide the chrome (badge) e.g. inside a thumbnail. The disclaimer still applies to the parent. */
  bare?: boolean;
  /** Fit-engine measurements of the body to draw (null → reference body). */
  measurements: UserBody['measurements'] | null;
  heightCm?: number | undefined;
  skinHex?: string | null;
  media?: AvatarMedia;
  /** Label of the body chip (defaults to the app's wording). */
  bodyLabel?: string;
}

const NO_MEDIA: AvatarMedia = { faceUrl: null, baseFrame: null };

/**
 * The mirror (render path B v0), store-free: every input is a prop, so the standalone embed can
 * draw it from its own in-memory profile. `Avatar` (Avatar.tsx) wires it to the app store.
 * Layers: mirror backdrop → body (captured base frame when present, else parametric silhouette in
 * the user's skin tone) → shadow → garment overlay keyed by garment id (outline from the fit
 * engine's per-point slack, hem from lengthCm, look from fabric) → face tile at the head. Always
 * carries the estimate badge.
 */
export function AvatarView({ garment, fit, size, isLoading = false, bare = false, measurements, heightCm, skinHex = null, media = NO_MEDIA, bodyLabel }: AvatarViewProps): ReactNode {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();

  const body = useMemo(() => bodyGeometry(measurements, heightCm), [measurements, heightCm]);
  const gaps = useMemo(() => (fit ? fitGapsForRender(fit, size ?? undefined) : null), [fit, size]);
  const geom = useMemo(() => (garment ? garmentGeometry({ garment, gaps, body }) : null), [garment, gaps, body]);
  const look = useMemo(() => (garment ? fabricLook(garment.fabric) : null), [garment]);

  const skin = isHex(skinHex) ? skinHex! : '#DFC3A8';
  const colour = garment && isHex(garment.primaryColorHex) ? garment.primaryColorHex : '#888888';
  const ids = {
    skinTex: `${uid}-skin`,
    fabric: `${uid}-fab`,
    bodyClip: `${uid}-bodyclip`,
    headClip: `${uid}-head`,
    shade: `${uid}-shade`,
    skinGrad: `${uid}-skingrad`,
    strain: `${uid}-strain`,
  };
  const bodyD = bodyPath(body);
  const headCy = HEAD_TOP_Y + body.headRy;
  const hasBody = !!measurements && Object.keys(measurements).length > 0;
  const onWhom = media.baseFrame ? 'over your capture' : hasBody ? 'on a body drawn from your measurements' : 'on a reference body';

  return (
    <div className="relative flex h-full w-full items-center justify-center p-3" data-testid="mirror">
      <div className="absolute inset-3 rounded-[2.2rem] border border-white/40 bg-gradient-to-br from-white/35 to-white/5 shadow-inner" aria-hidden />
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="relative h-full w-auto max-w-full drop-shadow-[0_20px_40px_rgba(26,22,18,0.18)]"
        role="img"
        aria-label={garment ? `Estimated look of ${garment.name}${size ? ` in size ${size}` : ''} ${onWhom} — not measured` : hasBody ? 'Your body outline (estimate)' : 'Reference body outline'}
      >
        <defs>
          <filter id={ids.skinTex} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="7" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.12 0" />
          </filter>
          {look ? (
            <filter id={ids.fabric} x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency={`${look.baseFrequency} ${Math.round(look.baseFrequency * look.grain * 1000) / 1000}`} numOctaves={look.numOctaves} seed="3" result="noise" />
              <feDiffuseLighting in="noise" lightingColor="#ffffff" surfaceScale={look.surfaceScale} diffuseConstant="1" result="light">
                <feDistantLight azimuth="45" elevation="62" />
              </feDiffuseLighting>
              {/* arithmetic composite keeps the garment colour (audit: fabricTexture colour loss) */}
              <feComposite in="SourceGraphic" in2="light" operator="arithmetic" k1="0.8" k2="0.3" k3="0" k4="0" result="lit" />
              <feSpecularLighting in="noise" lightingColor="#ffffff" surfaceScale={look.surfaceScale} specularExponent="24" specularConstant="1" result="spec">
                <feDistantLight azimuth="225" elevation="48" />
              </feSpecularLighting>
              <feComposite in="spec" in2="SourceGraphic" operator="in" result="specIn" />
              <feComposite in="lit" in2="specIn" operator="arithmetic" k1="0" k2="1" k3={look.specular * 0.9} k4="0" result="shaded" />
              <feComposite in="shaded" in2="SourceGraphic" operator="in" result="clipped" />
              <feGaussianBlur in="clipped" stdDeviation={look.blur} />
            </filter>
          ) : null}
          <clipPath id={ids.bodyClip}>
            <path d={bodyD} />
          </clipPath>
          <clipPath id={ids.headClip}>
            <ellipse cx={VIEW_W / 2} cy={headCy} rx={body.headR + 2} ry={body.headRy + 2} />
          </clipPath>
          <linearGradient id={ids.shade} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(0,0,0,0.14)" />
            <stop offset="45%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.16)" />
          </linearGradient>
          <radialGradient id={ids.skinGrad} cx="50%" cy="35%" r="65%">
            <stop offset="0%" stopColor={adjustColor(skin, 10)} />
            <stop offset="100%" stopColor={adjustColor(skin, -22)} />
          </radialGradient>
          <radialGradient id={ids.strain} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        {/* Body layer */}
        {media.baseFrame ? (
          <image href={media.baseFrame.url} x="0" y="0" width={VIEW_W} height={VIEW_H} preserveAspectRatio="xMidYMid slice" opacity={isLoading ? 0.4 : 1} data-testid="base-frame" />
        ) : (
          <g opacity={isLoading ? 0.4 : 1}>
            <path d={bodyD} fill={`url(#${ids.skinGrad})`} />
            <path d={bodyD} fill={`url(#${ids.shade})`} opacity="0.5" />
            <rect width={VIEW_W} height={VIEW_H} filter={`url(#${ids.skinTex})`} clipPath={`url(#${ids.bodyClip})`} pointerEvents="none" style={{ mixBlendMode: 'overlay' }} />
          </g>
        )}

        {/* Face tile at the head — under the garment layer, so a hat or scarf sits on top of it */}
        {media.faceUrl && !media.baseFrame ? (
          <g clipPath={`url(#${ids.headClip})`}>
            <image href={media.faceUrl} x={VIEW_W / 2 - body.headR - 2} y={headCy - body.headRy - 2} width={(body.headR + 2) * 2} height={(body.headRy + 2) * 2} preserveAspectRatio="xMidYMid slice" />
          </g>
        ) : null}
        {media.faceUrl && !media.baseFrame ? <ellipse cx={VIEW_W / 2} cy={headCy} rx={body.headR + 2} ry={body.headRy + 2} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" /> : null}

        {/* Garment overlay */}
        {garment && geom && look ? (
          <motion.g
            key={`${garment.id}-${size ?? ''}`}
            initial={reduce ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduce ? 0 : 0.35 }}
            style={{ transformOrigin: '100px 250px' }}
            data-testid="garment-layer"
          >
            <g fill={colour} fillOpacity={look.opacity} filter={`url(#${ids.fabric})`}>
              <path d={geom.path} />
              {geom.extra.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            <g fill={`url(#${ids.shade})`} opacity="0.35" style={{ mixBlendMode: 'multiply' }}>
              <path d={geom.path} />
              {geom.extra.map((d, i) => (
                <path key={`s${i}`} d={d} />
              ))}
            </g>
            {/* folds at loose points: stroke darkens with drape */}
            <g stroke={adjustColor(colour, -40)} strokeOpacity={0.35 + garment.fabric.drape * 0.25} strokeWidth="1.2" strokeLinecap="round" fill="none">
              {geom.folds.map((f, i) => (
                <path key={i} d={`M ${f.x1.toFixed(1)},${f.y1.toFixed(1)} Q ${((f.x1 + f.x2) / 2 + 3).toFixed(1)},${((f.y1 + f.y2) / 2).toFixed(1)} ${f.x2.toFixed(1)},${f.y2.toFixed(1)}`} />
              ))}
            </g>
            {/* strain at tight points: pull highlight + creases */}
            {geom.strain.map((s, i) => (
              <g key={i} opacity={s.intensity} data-testid="strain">
                <ellipse cx={s.x} cy={s.y} rx={body.bustHalf * 0.9} ry={9} fill={`url(#${ids.strain})`} />
                <path d={`M ${s.x - 14},${s.y - 4} q 14,5 28,-3`} stroke={adjustColor(colour, -55)} strokeOpacity="0.5" strokeWidth="1" fill="none" />
                <path d={`M ${s.x - 12},${s.y + 5} q 12,4 24,-2`} stroke={adjustColor(colour, -55)} strokeOpacity="0.35" strokeWidth="1" fill="none" />
              </g>
            ))}
          </motion.g>
        ) : null}

        {/* floor shadow */}
        <ellipse cx={VIEW_W / 2} cy={levelY('sole') + 6} rx={body.hipHalf + 18} ry={5} fill="rgba(26,22,18,0.12)" />
      </svg>

      {!bare ? (
        <div className="pointer-events-none absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1">
          <EstimateBadge className="px-2 py-0.5 text-[10px] whitespace-nowrap" />
          {garment && !media.baseFrame ? <span className="chip bg-white/70 px-2 py-0.5 text-[10px] leading-tight">{bodyLabel ?? (hasBody ? 'Body from your measurements' : 'Reference body · add your measurements')}</span> : null}
          {media.baseFrame ? <span className="chip bg-white/70 px-2 py-0.5 text-[10px] leading-tight">Your capture · garment overlay</span> : null}
        </div>
      ) : null}
      {isLoading ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center" role="status" aria-live="polite">
          <div className="h-10 w-10 rounded-full border-2 border-coral border-t-transparent motion-safe:animate-spin" aria-hidden />
          <p className="mt-3 rounded-full bg-cream/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">Rendering estimate</p>
        </div>
      ) : null}
    </div>
  );
}

