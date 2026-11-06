import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { WARDROBE_STATES, isKnownWardrobeSize, type FitCohortResponse, type WardrobeState } from '@curtain/schema';
import { CohortBars } from '@/components/CohortBars';
import { eur } from '@/lib/format';
import { api, MOCK_SHOP_ID, useApp } from '@/store';

const STATE_LABEL: Record<WardrobeState, string> = { saved: 'Saved', bought: 'Bought', kept: 'Kept', returned: 'Returned' };

/** Item ids are only unique within one shop (#22): rows, cohort cache and toggles key by shop + id. */
const rowKey = (w: { shopId: string; productId: string }): string => `${w.shopId}:${w.productId}`;

/** Saved items with their size; bought → kept / returned feeds the fit engine's history (handoff §4.2). */
export function WardrobeRoute(): ReactNode {
  const wardrobe = useApp((s) => s.wardrobe);
  const setWardrobeState = useApp((s) => s.setWardrobeState);
  const [open, setOpen] = useState<string | null>(null);
  const [cohort, setCohort] = useState<Record<string, FitCohortResponse | null>>({});

  const toggle = (key: string): void => {
    const next = open === key ? null : key;
    setOpen(next);
    if (!next || next in cohort) return;
    const item = wardrobe.find((w) => rowKey(w) === next);
    if (!item || item.shopId === MOCK_SHOP_ID) {
      setCohort((c) => ({ ...c, [next]: null }));
      return;
    }
    api.fitCohort(item.productId, item.shopId).then(
      (r) => setCohort((c) => ({ ...c, [next]: r })),
      () => setCohort((c) => ({ ...c, [next]: null })),
    );
  };

  return (
    <div className="h-full space-y-4 overflow-y-auto px-5 py-4">
      <header>
        <p className="eyebrow">Wardrobe</p>
        <h1 className="font-display text-3xl">Saved fits</h1>
      </header>
      {wardrobe.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-ink-soft">Swipe up or tap “Save” on the rail to keep an item here with its recommended size.</p>
          <Link to="/deck" className="btn-primary mt-3">
            Open the rail
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {wardrobe.map((w) => (
            <li key={rowKey(w)} className="card space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-12 w-12 shrink-0 rounded-2xl border border-ink/10" style={{ backgroundColor: w.garment.primaryColorHex }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{w.garment.brand}</p>
                  <p className="truncate font-medium" title={w.garment.name}>
                    {w.garment.name}
                  </p>
                  <p className="text-xs text-ink-mute">
                    {isKnownWardrobeSize(w.size) ? `Size ${w.size}` : 'Size not known'} · {eur(w.garment.priceEur)} · {STATE_LABEL[w.state]}
                  </p>
                </div>
                <button type="button" className="btn-ghost min-h-9 px-3 text-xs" aria-expanded={open === rowKey(w)} onClick={() => toggle(rowKey(w))}>
                  {open === rowKey(w) ? 'Less' : 'More'}
                </button>
              </div>
              {open === rowKey(w) ? (
                <div className="space-y-3">
                  <div role="radiogroup" aria-label={`Status of ${w.garment.name}`} className="grid grid-cols-4 gap-1">
                    {WARDROBE_STATES.map((s) => (
                      <button key={s} type="button" role="radio" aria-checked={w.state === s} onClick={() => void setWardrobeState(w.shopId, w.productId, s)} className={`rounded-full border px-2 py-1.5 text-xs font-medium ${w.state === s ? 'border-coral bg-coral text-ink' : 'border-ink/10 bg-white/60 text-ink-soft'}`}>
                        {STATE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-mute">Marking an item kept or returned teaches the fit engine how this brand runs on you.</p>
                  {w.garment.productUrl ? (
                    <a href={w.garment.productUrl} target="_blank" rel="noreferrer noopener" className="btn-ghost w-full">
                      Open in shop
                    </a>
                  ) : null}
                  <CohortBars cohort={cohort[rowKey(w)] ?? null} highlight={isKnownWardrobeSize(w.size) ? w.size : null} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
