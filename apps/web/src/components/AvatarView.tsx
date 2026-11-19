import { motion, useReducedMotion } from 'motion/react';
import { useId, useMemo, type ReactNode } from 'react';
import type { FitResult } from '@curtain/fit-engine';
import { fitGapsForRender } from '@curtain/fit-engine';
import { ESTIMATE_DISCLAIMER, type GarmentPayload, type UserBody } from '@curtain/schema';
import { adjustColor, bodyGeometry, bodyPath, fabricLook, garmentGeometry, isHex, levelY, STANDARD_SKIN_HEX, VIEW_H, VIEW_W, HEAD_TOP_Y, type FigureFamily } from '@/render/body';
import { faceInk, figureOutline, neutralFace, SKIN_SHADE } from '@/render/face';
import { skin2d, type Skin2dShading } from '@/render/skin2d';
import { ESTIMATE_LABEL_LINES, EstimateBadge } from './EstimateBadge';
import { SizeRingsChips, SizeRingsLayer } from './SizeRings';
import type { RingOverlay } from '@/render/rings';

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
  /**
   * Thumbnail size (the size peek next to the shop's button): no padding, mirror backdrop or drop
   * shadow, and the estimate badge alone, shortened to "Estimate" (its title keeps the full
   * disclaimer). The badge stays: every render is labelled an estimate (AGENTS.md rule 3).
   */
  compact?: boolean;
  /**
   * Size rings (route R5): the garment's graded girths of the size on screen plus ghosts of its
   * neighbours, drawn over the figure. Ignored in `compact` mode (too small to read).
   */
  rings?: RingOverlay | null;
  /** Skirt hem sweep of this size, cm (ring input): the drawn hem then matches the hem ring. */
  hemSweepCm?: number | null;
  /**
   * Where the estimate badge and the body chip sit on the full-size figure, in a strip of their
   * own either way, so they never lie across the face: `top` (the app) above the head, `bottom`
   * (the embed) under the figure, which is drawn above it, so they cover neither the feet nor a long hem.
   * The estimate badge is then narrow (two lines) and sticky: while the strip is below the window
   * or behind a bar at the bottom of the host's screen (`--estimate-clear`, that bar's height), the
   * badge rides up the left edge of the frame, beside the head and never over the face, so
   * whatever part of the figure is on screen is labelled an estimate (AGENTS.md rule 3). It needs
   * a frame that does not make a scroll box of its own (`overflow: clip`, not `hidden`). The
   * host's bar must be stacked above this track (`z-10`): the body chip does not ride, so it
   * passes behind the bar.
   */
  labelsAt?: 'top' | 'bottom';
  /** The estimate badge's text on two short lines, for `labelsAt="bottom"` (defaults to the app's wording). */
  estimateLines?: readonly [string, string];
  /**
   * The figure as it was before the neutral face: no face and no outline. Only for the hero
   * render's person image, which goes to a render provider: what a line-drawn face does to that
   * render is not tested, so that input stays what it was.
   */
  plain?: boolean;
  /**
   * The body family (slice M1b): `male` draws the male figure from the male body family's
   * measurements (broader shoulders, straighter torso, no bust), with the same neutral face, skin
   * colour and estimate labels. Only next to a required 3D view on the male body that has settled
   * (D20 point 3: a men's product never goes live with a 2D figure only); EmbedApp decides that.
   * Default `female`: today's figure, unchanged.
   */
  family?: FigureFamily;
  /**
   * How the skin is shaded. `flat` (default): today's figure, unchanged. `skin-v2` (opt-in, D22
   * point 3, for the look review): shades in linear light that keep the skin's hue, a warm shadow
   * edge, a faint sheen and an outline that reads on every tone (`render/skin2d.ts`).
   */
  skinShading?: Skin2dShading;
}

const NO_MEDIA: AvatarMedia = { faceUrl: null, baseFrame: null };

/**
 * The mirror (render path B v0), store-free: every input is a prop, so the standalone embed can
 * draw it from its own in-memory profile. `Avatar` (Avatar.tsx) wires it to the app store.
 * Layers: mirror backdrop → body (captured base frame when present, else parametric silhouette in
 * the user's skin tone) → shadow → garment overlay keyed by garment id (outline from the fit
 * engine's per-point slack, hem from lengthCm, look from fabric) → the neutral standard face on the
 * head (D19: one generic drawing for everybody, never a likeness), or the face tile where the app
 * has one. Always carries the estimate badge.
 */
export function AvatarView({ garment, fit, size, isLoading = false, bare = false, measurements, heightCm, skinHex = null, media = NO_MEDIA, bodyLabel, compact = false, rings = null, hemSweepCm = null, labelsAt = 'top', plain = false, estimateLines = ESTIMATE_LABEL_LINES, family = 'female', skinShading = 'flat' }: AvatarViewProps): ReactNode {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();

  const body = useMemo(() => bodyGeometry(measurements, heightCm, family), [measurements, heightCm, family]);
  const gaps = useMemo(() => (fit ? fitGapsForRender(fit, size ?? undefined) : null), [fit, size]);
  const geom = useMemo(() => (garment ? garmentGeometry({ garment, gaps, body, hemSweepCm }) : null), [garment, gaps, body, hemSweepCm]);
  const look = useMemo(() => (garment ? fabricLook(garment.fabric) : null), [garment]);

  const skin = isHex(skinHex) ? skinHex! : STANDARD_SKIN_HEX;
  const face = useMemo(() => neutralFace(body), [body]);
  const v2 = skinShading === 'skin-v2' ? skin2d(skin) : null;
  const ink = v2 ? faceInk(skin, v2.head) : faceInk(skin);
  const outline = v2 ? v2.outline : figureOutline(skin);
  // In the embed's narrow frame the labels get their own strip under the figure's feet.
  const labelsBelow = labelsAt === 'bottom' && !bare && !compact;
  // At the top they get a strip above the head (they lay across the face of the neutral head, D19).
  const labelsAbove = labelsAt === 'top' && !bare && !compact;
  const colour = garment && isHex(garment.primaryColorHex) ? garment.primaryColorHex : '#888888';
  const ids = {
    skinTex: `${uid}-skin`,
    fabric: `${uid}-fab`,
    bodyClip: `${uid}-bodyclip`,
    headClip: `${uid}-head`,
    shade: `${uid}-shade`,
    skinGrad: `${uid}-skingrad`,
    sheen: `${uid}-sheen`,
    side: `${uid}-side`,
    strain: `${uid}-strain`,
  };
  const bodyD = bodyPath(body);
  const headCy = HEAD_TOP_Y + body.headRy;
  const hasBody = !!measurements && Object.keys(measurements).length > 0;
  const onWhom = media.baseFrame ? 'over your capture' : hasBody ? 'on a body drawn from your measurements' : 'on a reference body';

  return (
    <div className={`relative flex h-full w-full items-center justify-center ${compact ? 'p-0' : labelsBelow ? 'px-3 pt-3 pb-16' : labelsAbove ? 'px-3 pt-11 pb-3' : 'p-3'}`} data-testid="mirror">
      {compact ? null : <div className="absolute inset-3 rounded-[2.2rem] border border-white/40 bg-gradient-to-br from-white/35 to-white/5 shadow-inner" aria-hidden />}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={`relative h-full w-auto max-w-full ${compact ? '' : 'drop-shadow-[0_20px_40px_rgba(26,22,18,0.18)]'}`}
        role="img"
        data-skin={skin.toUpperCase()}
        {...(family === 'male' ? { 'data-figure': 'male' } : {})}
        {...(v2 ? { 'data-skin-shading': 'skin-v2' } : {})}
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
          {v2 ? (
            <>
              {/* skin-v2: lit from the viewer's right like the 3D key light; every stop keeps the skin's hue */}
              <radialGradient id={ids.skinGrad} cx="58%" cy="32%" r="68%">
                <stop offset="0%" stopColor={v2.lit} />
                <stop offset="55%" stopColor={v2.mid} />
                <stop offset="100%" stopColor={v2.shadow} />
              </radialGradient>
              <linearGradient id={ids.side} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={v2.side} stopOpacity={v2.sideLeft} />
                <stop offset="42%" stopColor={v2.side} stopOpacity="0" />
                <stop offset="80%" stopColor={v2.side} stopOpacity="0" />
                <stop offset="100%" stopColor={v2.side} stopOpacity={v2.sideRight} />
              </linearGradient>
              <linearGradient id={ids.sheen} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="46%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="66%" stopColor="#ffffff" stopOpacity={v2.sheen} />
                <stop offset="88%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </>
          ) : (
            <radialGradient id={ids.skinGrad} cx="50%" cy="35%" r="65%">
              <stop offset="0%" stopColor={adjustColor(skin, SKIN_SHADE.light)} />
              <stop offset="100%" stopColor={adjustColor(skin, SKIN_SHADE.dark)} />
            </radialGradient>
          )}
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
            {/* The outline keeps a light figure visible on the light backdrop (1.1:1 without it at the lightest swatch). */}
            <path d={bodyD} fill={`url(#${ids.skinGrad})`} {...(plain ? {} : { stroke: outline, strokeWidth: 1.6, strokeLinejoin: 'round' as const, 'data-outline': outline.toUpperCase() })} data-testid="figure-body" />
            {v2 ? (
              <>
                <path d={bodyD} fill={`url(#${ids.side})`} />
                <path d={bodyD} fill={`url(#${ids.sheen})`} />
              </>
            ) : (
              <path d={bodyD} fill={`url(#${ids.shade})`} opacity="0.5" />
            )}
            <rect width={VIEW_W} height={VIEW_H} filter={`url(#${ids.skinTex})`} clipPath={`url(#${ids.bodyClip})`} pointerEvents="none" style={{ mixBlendMode: 'overlay' }} />
          </g>
        )}

        {/* Neutral standard face (D19): the same drawing for everybody, from the head's size only */}
        {!plain && !media.faceUrl && !media.baseFrame ? (
          <g data-testid="neutral-face" data-ink={ink} aria-hidden opacity={isLoading ? 0.4 : 1} fill="none" stroke={ink} strokeWidth={face.stroke} strokeLinecap="round" strokeLinejoin="round">
            {face.eyes.map((e) => (
              <ellipse key={e.cx} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={ink} stroke="none" />
            ))}
            {face.brows.map((d) => (
              <path key={d} d={d} />
            ))}
            <path d={face.nose} strokeWidth={face.noseStroke} />
            <path d={face.mouth} />
          </g>
        ) : null}

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

        {rings && !compact ? <SizeRingsLayer overlay={rings} /> : null}

        {/* floor shadow */}
        <ellipse cx={VIEW_W / 2} cy={levelY('sole') + 6} rx={body.hipHalf + 18} ry={5} fill="rgba(26,22,18,0.12)" />
      </svg>

      {rings && !compact ? <SizeRingsChips overlay={rings} topRem={labelsAbove ? 2.75 : 0.75} bottomRem={labelsBelow ? 4 : 0.75} /> : null}
      {!bare && compact ? (
        <span className="chip pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 bg-ink/85 px-1.5 py-0 text-[9px] whitespace-nowrap text-cream shadow" title={ESTIMATE_DISCLAIMER} data-testid="estimate-badge">
          Estimate
        </span>
      ) : null}
      {labelsBelow ? (
        // The track is the frame's inner height: the badge's own place is the strip at its foot,
        // and `sticky` lifts it along the track while that strip is out of sight. The track hugs
        // the frame's edge and the badge is as narrow as its text allows, so a riding badge takes
        // as little of the figure as it can (it still crosses the left arm and a wide hem).
        <div className="pointer-events-none absolute inset-x-2 top-3 bottom-4 z-10 flex items-end gap-1" data-testid="avatar-labels">
          <EstimateBadge lines={estimateLines} className="sticky shrink-0 px-1.5 py-0.5 text-[10px] leading-tight" style={{ bottom: 'calc(var(--estimate-clear, 0px) + 0.375rem)' }} />
          {garment && !media.baseFrame ? <span className="chip min-w-0 rounded-xl bg-white/70 px-2 py-0.5 text-[10px] leading-tight" data-testid="avatar-body-chip">{bodyLabel ?? (hasBody ? 'Body from your measurements' : 'Reference body · add your measurements')}</span> : null}
          {media.baseFrame ? <span className="chip min-w-0 rounded-xl bg-white/70 px-2 py-0.5 text-[10px] leading-tight">Your capture · garment overlay</span> : null}
        </div>
      ) : labelsAbove ? (
        // A strip of their own above the head: one row of narrow chips (two or three short lines).
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-1" data-testid="avatar-labels">
          <EstimateBadge lines={estimateLines} className="shrink-0 px-1.5 py-0.5 text-[10px] leading-tight" />
          {garment && !media.baseFrame ? <span className="chip min-w-0 rounded-xl bg-white/70 px-1.5 py-0.5 text-[10px] leading-tight">{bodyLabel ?? (hasBody ? 'Body from your measurements' : 'Reference body · add your measurements')}</span> : null}
          {media.baseFrame ? <span className="chip min-w-0 rounded-xl bg-white/70 px-1.5 py-0.5 text-[10px] leading-tight">Your capture · garment overlay</span> : null}
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

