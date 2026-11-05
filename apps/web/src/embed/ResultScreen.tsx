/**
 * Result (docs/STANDALONE.md §1.3.4–5): the recommended size, neighbouring sizes to compare, the
 * per-point fit for the size on screen, the avatar with the garment overlay, the confidence and
 * the estimate disclaimer, and the "Choose size X" action.
 */
import { CheckCircle2, Pencil } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import type { BodyProfile, GarmentPayload } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { EstimateDisclaimer } from '@/components/EstimateBadge';
import { FitPanel } from '@/components/FitPanel';
import { pct } from '@/lib/format';
import { bandText, fitWithAdvice, gapText, neighbourSizes, pointLabel, priorKeys, usablePoints, type EmbedFit, type FitPreference, type SizeAdvice } from './aboutYou';

const BAND_CLASS: Record<string, string> = {
  tight: 'bg-bad/10 text-bad',
  snug: 'bg-warn/10 text-warn',
  good: 'bg-ok/10 text-ok',
  roomy: 'bg-ink/5 text-ink-soft',
  loose: 'bg-warn/10 text-warn',
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
  avatarRef?: React.RefObject<HTMLDivElement | null>;
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
  avatarRef,
}: ResultScreenProps): ReactNode {
  const { fit, userBody } = embedFit;
  const shown = useMemo(() => fitWithAdvice(fit, advice, garment.category, profile), [fit, advice, garment.category, profile]);

  // F1: no size could be scored (e.g. a shoe without a shoe size): ask for what is missing instead
  // of presenting the engine's placeholder as a recommendation.
  if (advice.noPoints) {
    const shoes = garment.category === 'shoes';
    return (
      <div className="space-y-4 pb-2" data-testid="embed-result">
        <div>
          <p className="eyebrow text-coral-ink">{returning ? 'Welcome back' : 'Your fit'}</p>
          <h2 className="font-display text-3xl leading-tight" tabIndex={-1} data-step-heading data-testid="no-points-title">
            We can’t recommend a size yet
          </h2>
          <p className="mt-1 text-sm text-ink-soft" data-testid="no-points-text">
            {shoes
              ? 'Shoes are sized by your foot. Add your EU shoe size and we’ll check the fit.'
              : 'This item is sized by measurements we don’t have for you yet. Add your measurements, or use the shop’s size chart for this one.'}
          </p>
        </div>
        <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-cream via-cream to-cream/0 px-4 pt-4 pb-2">
          <button type="button" className="btn-coral w-full" onClick={onEdit} data-testid="edit-measurements">
            <Pencil className="h-4 w-4" aria-hidden /> {shoes ? 'Add my shoe size' : 'Edit my measurements'}
          </button>
        </div>
      </div>
    );
  }

  const sizes = neighbourSizes(fit, advice.size ?? advice.closest);
  const selectedFit = fit.perSize.find((s) => s.size === selected);
  const points = usablePoints(selectedFit);
  const estimated = priorKeys(profile).filter((k) => points.some((p) => p.point === k));
  const onPageSize = currentVariantSize && fit.perSize.some((s) => s.size === currentVariantSize) ? currentVariantSize : null;

  return (
    <div className="space-y-4 pb-2" data-testid="embed-result">
      <div>
        <p className="eyebrow text-coral-ink">{returning ? 'Welcome back' : 'Your fit'}</p>
        <h2 className="font-display text-3xl leading-tight" tabIndex={-1} data-step-heading>
          {advice.size ? `We recommend ${advice.size}` : 'No size fits well'}
        </h2>
        {advice.adjusted ? (
          <p className="text-xs text-ink-soft">
            One size {advice.adjusted} from {advice.engineSize} for your {preference} preference.
          </p>
        ) : null}
        {advice.size ? (
          <button type="button" onClick={onEdit} className="chip mt-2 hover:bg-white" data-testid="edit-measurements">
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit my measurements
          </button>
        ) : null}
      </div>

      <FitPanel fit={shown} hasMeasurements />

      {sizes.length > 1 ? (
        <div className="space-y-1.5">
          <p className="eyebrow" id="compare-label">
            Compare sizes
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
                {s.score !== null ? <span className="text-xs opacity-75">{pct(s.score)}</span> : null}
                {s.size === advice.size ? <span className="sr-only">(recommended)</span> : null}
              </button>
            ))}
          </div>
          {onPageSize && onPageSize !== advice.size ? <p className="text-xs text-ink-mute">Selected on the shop page: {onPageSize}</p> : null}
        </div>
      ) : null}

      <div className="grid items-start gap-4 min-[500px]:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div ref={avatarRef} className="mirror-frame mx-auto aspect-[5/8] w-full max-w-[15rem] border-[8px]">
          <AvatarView garment={garment} fit={fit} size={selected} measurements={userBody.measurements} heightCm={profile.measurements.height?.mean} bodyLabel="Body from your answers" />
        </div>
        {points.length > 0 ? (
          <section className="card space-y-2 p-3" aria-labelledby="points-title">
            <h3 id="points-title" className="eyebrow">
              How size {selected} fits you
            </h3>
            <ul className="divide-y divide-ink/5" data-testid="fit-points">
              {points.map((p) => (
                <li key={p.point} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{pointLabel(p.point)}</span>
                    <span className="block text-xs text-ink-mute">{gapText(p)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${BAND_CLASS[p.band] ?? ''}`}>{bandText(p.band)}</span>
                </li>
              ))}
            </ul>
            {estimated.length > 0 ? (
              <p className="text-xs text-ink-mute">
                {estimated.map(pointLabel).join(', ')} estimated from your height and weight. Add your own measurements for a higher confidence.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <EstimateDisclaimer />

      {extra}

      <div className="sticky bottom-0 -mx-4 space-y-2 bg-gradient-to-t from-cream via-cream to-cream/0 px-4 pt-4 pb-2">
        {chosen ? (
          <p role="status" className="flex items-center justify-center gap-2 text-sm font-medium text-ok">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Size {chosen} selected on the shop page
          </p>
        ) : null}
        {chooseFallback ? (
          <p role="status" className="rounded-2xl bg-white/80 p-3 text-center text-sm" data-testid="choose-fallback">
            Choose size <span className="font-display text-lg">{chooseFallback}</span> on the shop page.
          </p>
        ) : null}
        {advice.size ? (
          <button type="button" className="btn-coral w-full" onClick={onChoose} data-testid="choose-size">
            Choose size {selected}
          </button>
        ) : (
          // UX-2: nothing fits well, so the primary action is to check the measurements; picking the
          // closest size stays possible, but as a deliberate, secondary choice.
          <>
            <button type="button" className="btn-coral w-full" onClick={onEdit} data-testid="edit-measurements">
              <Pencil className="h-4 w-4" aria-hidden /> Edit my measurements
            </button>
            <button type="button" className="btn-ghost w-full" onClick={onChoose} data-testid="choose-size">
              Select size {selected} anyway
            </button>
          </>
        )}
      </div>
    </div>
  );
}
