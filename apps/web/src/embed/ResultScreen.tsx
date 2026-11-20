/**
 * Result (docs/STANDALONE.md §1.3.4–5): the recommended size, neighbouring sizes to compare, the
 * per-point fit for the size on screen, the avatar with the garment overlay, the confidence and
 * the estimate disclaimer, and the "Choose size X" action.
 */
import { CheckCircle2, Pencil, Sparkles } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { BodyProfile, GarmentPayload } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { EstimateDisclaimer } from '@/components/EstimateBadge';
import { FitPanel } from '@/components/FitPanel';
import { shownSizeScore } from '@/lib/fitScore';
import { pct } from '@/lib/format';
import type { FigureFamily } from '@/render/body';
import { ringInputsFor } from '@/render/ringInputs';
import { ringOverlayFor } from '@/render/rings';
import { notDrawnNote, notDrawnSentence } from './notDrawn';
import { bandText, fitWithAdvice, gapText, neighbourSizes, pointLabelFor, priorKeys, usablePoints, waistOnlyOf, type EmbedFit, type FitPreference, type SizeAdvice } from './aboutYou';
import { UnitToggle } from './EmbedScreens';
import { SizeChartTable } from './SizeChartTable';
import { embedStrings, parts } from './strings';
import type { Units } from './units';
import { avatarSkinFlag, maleShapeFlag } from './look';

const TABS = ['fit', 'chart'] as const;
type TabKey = (typeof TABS)[number];

const BAND_CLASS: Record<string, string> = {
  tight: 'bg-bad/10 text-bad',
  snug: 'bg-warn/10 text-warn',
  good: 'bg-ok/10 text-ok',
  roomy: 'bg-ink/5 text-ink-soft',
  loose: 'bg-warn/10 text-warn',
  short: 'bg-warn/10 text-warn',
  long: 'bg-warn/10 text-warn',
};

export interface ResultScreenProps {
  garment: GarmentPayload;
  profile: BodyProfile;
  embedFit: EmbedFit;
  advice: SizeAdvice;
  preference: FitPreference;
  selected: string;
  onSelect: (size: string) => void;
  onChoose: () => void;
  onEdit: () => void;
  returning: boolean;
  /** Set after "Choose" when the size could not be posted to the shop page. */
  chooseFallback: string | null;
  /** Set after "Choose" when the size was sent to the shop page. */
  chosen: string | null;
  currentVariantSize: string | null;
  /** Rendered below the result (the optional "See it on me" panel). */
  extra?: ReactNode;
  /** The shop gave no fabric stretch (`TryResolveResponse.stretchAssumed`): one line says stretch was not taken into account. */
  stretchAssumed?: boolean;
  avatarRef?: React.RefObject<HTMLDivElement | null>;
  units: Units;
  onUnits: (u: Units) => void;
  /** The skin colour the shopper picked for the avatar (null: the standard colour). */
  skinHex?: string | null;
  /** Tapping the avatar opens the avatar prompt (D19). Without it the figure is not a control. */
  onAvatar?: (() => void) | undefined;
  /** The visible and spoken name of that control (the prompt's title). */
  avatarLabel?: string;
  /**
   * The 2D figure's body (slice M1b). `male` only for a men's product whose required 3D view on
   * the male body is mounted: the result is hidden until that view has settled (EmbedApp).
   */
  figure?: FigureFamily;
  /**
   * The shopper's own face tile (slice 5, `VITE_AVATAR_FACE_PHOTO=live` only): drawn on the 2D
   * head, shown large in a round chip on the figure, with the label C27 under the figure. A
   * `blob:` URL of this page; never sent.
   */
  face?: { url: string; label: string } | null;
}

export function ResultScreen({
  garment,
  profile,
  embedFit,
  advice,
  preference,
  selected,
  onSelect,
  onChoose,
  onEdit,
  returning,
  chooseFallback,
  chosen,
  currentVariantSize,
  extra,
  stretchAssumed = false,
  avatarRef,
  units,
  onUnits,
  skinHex = null,
  onAvatar,
  avatarLabel,
  figure = 'female',
  face = null,
}: ResultScreenProps): ReactNode {
  const { fit, userBody } = embedFit;
  const t = embedStrings().result;
  const shown = useMemo(() => fitWithAdvice(fit, advice, garment.category, profile, garment), [fit, advice, garment, profile]);
  // Men's garments (slice M2) name their points as menswear does: "Chest", "Seat", "Sleeve".
  const pointLabel = (point: string): string => pointLabelFor(point, garment.audience);
  const [tab, setTab] = useState<TabKey>('fit');
  const [showRings, setShowRings] = useState(true);
  const heightCm = profile.measurements.height?.mean;
  const ringInputs = useMemo(() => ringInputsFor(garment), [garment]);
  const priorGirths = useMemo(() => priorKeys(profile), [profile]);
  const rings = useMemo(
    () => (advice.noPoints ? null : ringOverlayFor({ garment, fit, size: selected, measurements: userBody.measurements, heightCm, inputs: ringInputs, units, estimated: priorGirths, family: figure, maleShape: maleShapeFlag() })),
    [advice.noPoints, garment, fit, selected, userBody.measurements, heightCm, ringInputs, units, priorGirths, figure],
  );
  // The size on screen cannot be worn on this body (the size advice): the figure shows the body alone and this says why.
  const figureBlock = useMemo(() => notDrawnNote(fit, selected), [fit, selected]);
  // The sticky "Choose size" bar lies over the bottom of the window. Its height goes to the figure
  // as `--estimate-clear`, so the figure's estimate label stays above the bar (AGENTS.md rule 3).
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    if (!bar) return;
    const measure = (): void => setBarHeight(Math.ceil(bar.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [bar]);
  const tabsId = useId();
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  // WAI-ARIA tabs: arrow keys, Home and End move between the tabs (automatic activation).
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const i = TABS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    const target = TABS[next];
    if (!target) return;
    e.preventDefault();
    setTab(target);
    tabRefs.current[target]?.focus();
  };

  // F1: no size could be scored (e.g. a shoe without a shoe size): ask for what is missing instead
  // of presenting the engine's placeholder as a recommendation.
  if (advice.noPoints) {
    const shoes = garment.category === 'shoes';
    return (
      <div className="space-y-4 pb-2" data-testid="embed-result">
        <div>
          <p className="eyebrow text-coral-ink">{returning ? t.welcomeBack : t.eyebrow}</p>
          <h2 className="font-display text-3xl leading-tight" tabIndex={-1} data-step-heading data-testid="no-points-title">
            {t.noPointsTitle}
          </h2>
          <p className="mt-1 text-sm text-ink-soft" data-testid="no-points-text">
            {shoes ? t.noPointsShoes : t.noPointsOther}
          </p>
        </div>
        <div className="flex justify-end">
          <UnitToggle units={units} onChange={onUnits} />
        </div>
        <SizeChartTable garment={garment} recommended={null} units={units} />
        <div className="sticky bottom-0 z-20 -mx-4 bg-gradient-to-t from-cream via-cream to-cream/0 px-4 pt-4 pb-2">
          <button type="button" className="btn-coral w-full" onClick={onEdit} data-testid="edit-measurements">
            <Pencil className="h-4 w-4" aria-hidden /> {shoes ? t.addShoeSize : t.edit}
          </button>
        </div>
      </div>
    );
  }

  const sizes = neighbourSizes(fit, advice.size ?? advice.closest);
  // A men's W/L chart whose leg could not be checked (slice M2b): the waist is named, no leg is.
  const waistOnly = waistOnlyOf(fit, advice);
  const selectedFit = fit.perSize.find((s) => s.size === selected);
  const points = usablePoints(selectedFit);
  const selectedPullOn = selectedFit?.pullOn?.status;
  const estimated = priorKeys(profile).filter((k) => points.some((p) => p.point === k));
  const [chooseBefore, chooseAfter] = parts(t.chooseOnPage, 'size');
  const onPageSize = currentVariantSize && fit.perSize.some((s) => s.size === currentVariantSize) ? currentVariantSize : null;
  const onPageBlocked = onPageSize !== null && fit.perSize.find((s) => s.size === onPageSize)?.pullOn?.status === 'blocked';
  // The engine scores the chart, not the band over the hips: a 100% next to "only just stretches over
  // your hips" contradicts itself, so a marginal pull-on size shows the check instead of the number.
  const advisedPullOn = fit.perSize.find((s) => s.size === (advice.size ?? advice.closest))?.pullOn;
  const scoreNote = advice.size && advisedPullOn?.status === 'marginal' ? t.scorePullOnTight : undefined;

  return (
    <div className="space-y-4 pb-2" data-testid="embed-result" style={{ '--estimate-clear': `${barHeight}px` } as CSSProperties}>
      <div>
        <p className="eyebrow text-coral-ink">{returning ? t.welcomeBack : t.eyebrow}</p>
        <h2 className="font-display text-3xl leading-tight" tabIndex={-1} data-step-heading>
          {advice.size ? t.recommend(advice.size) : waistOnly !== null ? t.waistOnly(waistOnly) : t.noneFits}
        </h2>
        {advice.size && fit.sizeAxes?.waist !== undefined && fit.sizeAxes.leg !== undefined && advice.size === fit.closestSize ? (
          <p className="text-sm text-ink-soft" data-testid="size-axes">
            {t.sizeAxes(fit.sizeAxes.waist, fit.sizeAxes.leg)}
          </p>
        ) : null}
        {advice.adjusted ? (
          <p className="text-xs text-ink-soft">{t.adjusted(advice.adjusted, advice.engineSize ?? '', preference)}</p>
        ) : null}
        {stretchAssumed ? (
          <p className="mt-1 text-xs text-ink-soft" data-testid="stretch-not-used">
            {t.stretchNotUsed}
          </p>
        ) : null}
        {advice.size || waistOnly !== null ? (
          <button type="button" onClick={onEdit} className="chip mt-2 hover:bg-white" data-testid="edit-measurements">
            <Pencil className="h-3.5 w-3.5" aria-hidden /> {t.edit}
          </button>
        ) : null}
      </div>

      <FitPanel fit={shown} hasMeasurements scoreNote={scoreNote} waistOnly={waistOnly} />

      {sizes.length > 1 ? (
        <div className="space-y-1.5">
          <p className="eyebrow" id="compare-label">
            {t.compare}
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="compare-label">
            {sizes.map((s) => (
              <button
                key={s.size}
                type="button"
                role="radio"
                aria-checked={selected === s.size}
                onClick={() => onSelect(s.size)}
                className={`chip min-h-10 px-3.5 text-sm ${selected === s.size ? 'border-ink bg-ink text-white' : ''}`}
              >
                {s.size}
                {/* A pull-on size whose band does not pass (or only just passes) the hips: the pull-on check, not the chart score. */}
                {s.pullOn?.status === 'blocked' ? (
                  <span className="text-xs opacity-75" data-testid={`compare-no-pull-on-${s.size}`}>{t.compareNoPullOn}</span>
                ) : s.pullOn?.status === 'marginal' ? (
                  <span className="text-xs opacity-75" data-testid={`compare-just-pulls-on-${s.size}`}>{t.compareJustPullsOn}</span>
                ) : shownSizeScore(s) !== null ? (
                  <span className="text-xs opacity-75">{pct(shownSizeScore(s))}</span>
                ) : null}
                {s.size === advice.size ? <span className="sr-only">{t.recommendedMark}</span> : null}
              </button>
            ))}
          </div>
          {onPageSize && onPageSize !== advice.size ? (
            onPageBlocked ? (
              <p className="text-xs font-medium text-bad" data-testid="on-page-no-pull-on">
                {t.onPageNoPullOn(onPageSize)}
              </p>
            ) : (
              <p className="text-xs text-ink-mute">{t.onPage(onPageSize)}</p>
            )
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-grid grid-cols-2 gap-1 rounded-full border border-ink/10 bg-white/60 p-1" role="tablist" aria-label={t.details}>
            {TABS.map((key) => (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[key] = el;
                }}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`${tabsId}-panel-${key}`}
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={onTabKey}
                className={`min-h-9 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === key ? 'bg-ink text-white' : 'text-ink-soft hover:bg-white'}`}
                data-testid={`tab-${key}`}
              >
                {t.tabs[key]}
              </button>
            ))}
          </div>
          <UnitToggle units={units} onChange={onUnits} />
        </div>
        <div role="tabpanel" id={`${tabsId}-panel-fit`} aria-labelledby={`${tabsId}-tab-fit`} hidden={tab !== 'fit'}>
        <div className="grid items-start gap-4 min-[500px]:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[15rem] space-y-1.5">
            {/* The chip that says what tapping the figure does sits above it, so it is on screen
                with the head at phone height (under the figure it was below the fold). */}
            <div className={`relative ${onAvatar ? 'pt-10' : ''}`}>
              {/* overflow-clip, not hidden: the frame must not be a scroll box, or the estimate label could not ride above the bar. */}
              <div ref={avatarRef} className="mirror-frame aspect-[5/9] w-full overflow-clip border-[8px]">
                <AvatarView garment={garment} fit={fit} size={selected} measurements={userBody.measurements} heightCm={heightCm} skinHex={skinHex} bodyLabel={t.bodyLabel} estimateLines={t.estimateLines} labelsAt="bottom" rings={showRings ? rings : null} hemSweepCm={ringInputs?.hem?.sweepCm[selected] ?? null} family={figure} maleShape={maleShapeFlag()} skinShading={avatarSkinFlag()} {...(face ? { media: { faceUrl: face.url, baseFrame: null, faceStyle: 'tile' as const } } : {})} />
              </div>
              {face ? (
                // The head is about 30 px wide at phone size: the face is shown large here as well.
                <span className="pointer-events-none absolute top-12 left-1 z-10 inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-cream shadow-md" aria-hidden data-testid="face-chip">
                  <img src={face.url} alt="" className="h-full w-full object-cover" />
                </span>
              ) : null}
              {onAvatar ? (
                // D19: the control sits where people look for it. The whole figure is the button;
                // the chip above it says what it does.
                <button
                  type="button"
                  onClick={onAvatar}
                  aria-haspopup="dialog"
                  className="group absolute inset-0 flex items-start justify-center rounded-[2.5rem] focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-cream focus-visible:outline-none"
                  data-testid="avatar-open"
                >
                  <span className="chip min-h-8 max-w-full bg-white/90 px-3 py-1 text-xs leading-tight shadow group-hover:bg-white">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-coral" aria-hidden />
                    {avatarLabel ?? embedStrings().avatar.ui.open}
                  </span>
                </button>
              ) : null}
            </div>
            {figureBlock ? (
              <p className="text-[11px] leading-snug text-ink-mute" role="status" data-testid="figure-not-drawn" data-anchor={figureBlock.anchor} data-reason={figureBlock.reason}>
                {notDrawnSentence(figureBlock, selected, garment.audience, units)}
              </p>
            ) : null}
            {face ? (
              <p className="text-center text-xs font-semibold text-ink" data-testid="face-label">
                {face.label}
              </p>
            ) : null}
            {rings ? (
              <div className="space-y-1 text-[11px] leading-snug text-ink-mute" data-testid="size-rings-legend">
                <button type="button" className="chip min-h-8 px-2.5 text-xs" aria-pressed={showRings} onClick={() => setShowRings((v) => !v)} data-testid="size-rings-toggle">
                  {showRings ? t.hideRings : t.showRings}
                </button>
                {showRings ? (
                  <>
                    <p>
                      <span className="font-semibold text-ink">{t.ringsSolid(rings.size)}</span>
                      {rings.ghosts.length > 0 ? ` ${t.ringsGhost(rings.ghosts.map((g) => g.size))}` : ''} {t.ringsEstimates}
                    </p>
                    {rings.notes.map((n) => (
                      <p key={n}>{n}</p>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {points.length > 0 ? (
            <section className="card space-y-2 p-3" aria-labelledby="points-title">
              <h3 id="points-title" className="eyebrow">
                {t.pointsTitle(selected)}
              </h3>
              <ul className="divide-y divide-ink/5" data-testid="fit-points">
                {points.map((p) => {
                  // The waist of a pull-on size whose band only just passes (or does not pass) the hips: the check, not
                  // "Good fit" (the engine's waist word scores the chart; next to "Only just pulls on" it contradicts it).
                  const pull = p.point === 'waist' && (selectedPullOn === 'marginal' || selectedPullOn === 'blocked') ? selectedPullOn : null;
                  return (
                    <li key={p.point} className="flex items-center justify-between gap-3 py-1.5 text-sm" data-testid={`fit-point-${p.point}`} data-point={p.point}>
                      <span className="min-w-0">
                        <span className="font-medium">{pointLabel(p.point)}</span>
                        <span className="block text-xs text-ink-mute">{pull ? t.pointByChart(gapText(p, units), bandText(p.band)) : gapText(p, units)}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${pull ? (BAND_CLASS[pull === 'blocked' ? 'tight' : 'snug'] ?? '') : (BAND_CLASS[p.band] ?? '')}`}>{pull ? t.pointPullOn[pull] : bandText(p.band)}</span>
                    </li>
                  );
                })}
              </ul>
              {estimated.length > 0 ? (
                <p className="text-xs text-ink-mute">{t.estimated(estimated.map(pointLabel))}</p>
              ) : null}
            </section>
          ) : null}
        </div>
        </div>
        <div role="tabpanel" id={`${tabsId}-panel-chart`} aria-labelledby={`${tabsId}-tab-chart`} hidden={tab !== 'chart'}>
          <SizeChartTable garment={garment} recommended={advice.size} units={units} />
        </div>
      </div>

      <EstimateDisclaimer />

      {extra}

      {/* z-20: above the figure's label track (z-10), whose body chip scrolls behind this bar. */}
      <div ref={setBar} className="sticky bottom-0 z-20 -mx-4 space-y-2 bg-gradient-to-t from-cream via-cream to-cream/0 px-4 pt-4 pb-2" data-testid="choose-bar">
        {chosen ? (
          <p role="status" className="flex items-center justify-center gap-2 text-sm font-medium text-ok">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> {t.chosen(chosen)}
          </p>
        ) : null}
        {chooseFallback ? (
          <p role="status" className="rounded-2xl bg-white/80 p-3 text-center text-sm" data-testid="choose-fallback">
            {chooseBefore}
            <span className="font-display text-lg">{chooseFallback}</span>
            {chooseAfter}
          </p>
        ) : null}
        {advice.size ? (
          <button type="button" className="btn-coral w-full" onClick={onChoose} data-testid="choose-size">
            {t.choose(selected)}
          </button>
        ) : (
          // UX-2: nothing fits well, so the primary action is to check the measurements; picking the
          // closest size stays possible, but as a deliberate, secondary choice.
          <>
            <button type="button" className="btn-coral w-full" onClick={onEdit} data-testid="edit-measurements">
              <Pencil className="h-4 w-4" aria-hidden /> {t.edit}
            </button>
            <button type="button" className="btn-ghost w-full" onClick={onChoose} data-testid="choose-size">
              {t.chooseAnyway(selected)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
