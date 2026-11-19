import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { WARDROBE_STATES, isKnownWardrobeSize, type FitCohortResponse } from '@curtain/schema';
import { CohortBars } from '@/components/CohortBars';
import { eur } from '@/lib/format';
import { api, MOCK_SHOP_ID, useApp } from '@/store';
import { appStrings } from '@/strings';

/** Item ids are only unique within one shop (#22): rows, cohort cache and toggles key by shop + id. */
const rowKey = (w: { shopId: string; productId: string }): string => `${w.shopId}:${w.productId}`;

/** Saved items with their size; bought → kept / returned feeds the fit engine's history (handoff §4.2). */
export function WardrobeRoute(): ReactNode {
  const wardrobe = useApp((s) => s.wardrobe);
  const setWardrobeState = useApp((s) => s.setWardrobeState);
  const [open, setOpen] = useState<string | null>(null);
  const t = appStrings().app.wardrobe;
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
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 className="font-display text-3xl">{t.title}</h1>
      </header>
      {wardrobe.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-ink-soft">{t.empty}</p>
          <Link to="/deck" className="btn-primary mt-3">
            {t.openRail}
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
                    {isKnownWardrobeSize(w.size) ? t.size(w.size) : t.sizeUnknown} · {eur(w.garment.priceEur)} · {t.states[w.state]}
                  </p>
                </div>
                <button type="button" className="btn-ghost min-h-9 px-3 text-xs" aria-expanded={open === rowKey(w)} onClick={() => toggle(rowKey(w))}>
                  {open === rowKey(w) ? t.less : t.more}
                </button>
              </div>
              {open === rowKey(w) ? (
                <div className="space-y-3">
                  <div role="radiogroup" aria-label={t.statusOf(w.garment.name)} className="grid grid-cols-4 gap-1">
                    {WARDROBE_STATES.map((s) => (
                      <button key={s} type="button" role="radio" aria-checked={w.state === s} onClick={() => void setWardrobeState(w.shopId, w.productId, s)} className={`rounded-full border px-2 py-1.5 text-xs font-medium ${w.state === s ? 'border-coral bg-coral text-ink' : 'border-ink/10 bg-white/60 text-ink-soft'}`}>
                        {t.states[s]}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ink-mute">{t.teaches}</p>
                  {w.garment.productUrl ? (
                    <a href={w.garment.productUrl} target="_blank" rel="noreferrer noopener" className="btn-ghost w-full">
                      {t.openInShop}
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
