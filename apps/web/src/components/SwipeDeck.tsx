import { BarChart2, Bookmark, Heart, ShoppingBag, ThumbsDown, User, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { SwipeAction } from '@paskamer/schema';
import { eur } from '@/lib/format';
import { colourTarget } from '@/lib/season';
import { useApp } from '@/store';
import { fitFor } from '@/store/fit';
import { useCaptureMedia } from '@/store/media';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { ColourChip } from './ColourChip';
import { EstimateDisclaimer } from './EstimateBadge';
import { FitPanel } from './FitPanel';
import { StyleDnaDialog } from './StyleDnaDialog';

const ACTIONS: { action: SwipeAction; label: string; icon: ReactNode; className: string; large?: boolean }[] = [
  { action: 'pass', label: 'Pass', icon: <X className="h-6 w-6" aria-hidden />, className: 'bg-white text-ink-soft' },
  { action: 'less', label: 'Less like this', icon: <ThumbsDown className="h-5 w-5" aria-hidden />, className: 'bg-white text-ink-soft' },
  { action: 'love', label: 'Love', icon: <Heart className="h-8 w-8" aria-hidden />, className: 'bg-coral text-white', large: true },
  { action: 'save', label: 'Save to wardrobe', icon: <Bookmark className="h-5 w-5" aria-hidden />, className: 'bg-white text-ink-soft' },
];

/**
 * The deck: cards come from the taste engine (`dealNext` over the paired or bundled catalogue),
 * the fit from the on-device fit engine (memoised, no artificial delay), all four actions go
 * through `applySwipe` with the size and score at swipe time.
 */
export function SwipeDeck(): ReactNode {
  const current = useApp((s) => s.deck.current);
  /** Increments on every deal, so a re-dealt (previously passed) garment still gets a fresh card. */
  const dealIndex = useApp((s) => s.taste.dealIndex);
  const exhausted = useApp((s) => s.deck.exhausted);
  const notInYourSize = useApp((s) => s.deck.notInYourSize);
  const fitCtx = useApp((s) => s.fitCtx);
  const swipe = useApp((s) => s.swipe);
  const profile = useApp((s) => s.taste.profile);
  const season = useApp((s) => s.settings.season);
  const undertone = useApp((s) => s.settings.undertone);
  const catalogSource = useApp((s) => s.catalogSource);
  const media = useCaptureMedia();
  const [showDna, setShowDna] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Deal whenever the deck is empty but not exhausted: on mount, and after the store resets it
    // (paired catalogue arrived in hydrate, re-measure, a new shop paired). Idempotent under StrictMode.
    if (current || exhausted) return;
    const s = useApp.getState();
    if (!s.deck.current && !s.deck.exhausted) s.dealNext();
  }, [current, exhausted]);

  const garment = current?.garment ?? null;
  const fit = useMemo(() => (garment ? fitFor(fitCtx, garment) : null), [garment, fitCtx]);
  const hasMeasurements = useApp((s) => s.hasMeasurements)();
  const target = colourTarget(season, undertone);
  const rendering = media.loading;

  const act = async (action: SwipeAction): Promise<void> => {
    if (!garment || busy || rendering) return;
    setBusy(true);
    try {
      await swipe(action);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between px-5 pt-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-coral/15" aria-hidden>
            <Heart className="h-4 w-4 text-coral" fill="currentColor" />
          </span>
          <span className="font-display text-xl font-medium tracking-tight">Paskamer</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowDna(true)} aria-label="Open your Style DNA" className="rounded-full border border-ink/10 bg-white p-2 shadow-sm">
            <BarChart2 className="h-5 w-5 text-ink-soft" aria-hidden />
          </button>
          <Link to="/profile" aria-label="Open your profile" className="rounded-full border border-ink/10 bg-white p-2 shadow-sm">
            <User className="h-5 w-5 text-ink-soft" aria-hidden />
          </Link>
        </div>
      </header>

      <StyleDnaDialog open={showDna} profile={profile} onClose={() => setShowDna(false)} />

      <div className="relative min-h-0 flex-1 px-4">
        {garment ? (
          // keyed by the dealt card: each card gets fresh motion values and commit state (a swiped
          // card's fly-off offset and `committed` flag must not carry over to the next one)
          <Card key={`${dealIndex}:${garment.id}`} id={garment.id} disabled={busy || rendering} onSwipe={act}>
            <Avatar garment={garment} fit={fit} isLoading={rendering} />
            {/* bounded so the panel never hides most of the mirror on a short phone (≈ 270 px card at 667 px) */}
            <div className="absolute right-3 bottom-3 left-3 z-10 max-h-[48%] overflow-hidden rounded-2xl" key={garment.id}>
              <FitPanel fit={fit} hasMeasurements={hasMeasurements} />
            </div>
          </Card>
        ) : (
          <EmptyDeck exhausted={exhausted} notInYourSize={notInYourSize} catalogSource={catalogSource} />
        )}
      </div>

      {garment ? (
        <div className="px-5 pt-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow text-coral-ink">{garment.brand}</p>
              <h2 className="font-display text-xl leading-tight" title={garment.name}>
                {garment.name}
              </h2>
              <p className="mt-0.5 text-xs text-ink-mute">
                {garment.fabric.primary}
                {garment.fabric.weightGsm ? ` · ${garment.fabric.weightGsm} gsm` : ''} · {garment.patternBlock}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-2xl">{eur(garment.priceEur)}</p>
              {garment.productUrl ? (
                <a href={garment.productUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-ink-soft hover:text-ink">
                  <ShoppingBag className="h-3 w-3" aria-hidden /> Shop
                </a>
              ) : null}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ColourChip hex={garment.primaryColorHex} target={target} />
            {!target ? <span className="chip">Colour match after your face photo</span> : null}
          </div>
          <EstimateDisclaimer className="mt-2" />
        </div>
      ) : null}

      <div className="action-ring px-5 pt-3 pb-2" role="group" aria-label="Swipe actions">
        {ACTIONS.map((a) => (
          <button
            key={a.action}
            type="button"
            aria-label={a.label}
            title={a.label}
            disabled={!garment || busy || rendering}
            onClick={() => void act(a.action)}
            className={`flex items-center justify-center rounded-full border border-ink/10 shadow-xl transition-transform motion-safe:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${a.large ? 'h-18 w-18' : 'h-13 w-13'} ${a.className}`}
          >
            {a.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyDeck({ exhausted, notInYourSize, catalogSource }: { exhausted: boolean; notInYourSize: number; catalogSource: 'mock' | 'paired' }): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center" data-testid="deck-empty">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-coral/15">
        <Bookmark className="h-8 w-8 text-coral" aria-hidden />
      </div>
      <h2 className="font-display text-2xl">{exhausted ? 'You have seen the whole rail' : 'Setting up your rail…'}</h2>
      <p className="max-w-xs text-sm text-ink-soft">
        {notInYourSize > 0 ? `${notInYourSize} item${notInYourSize === 1 ? '' : 's'} were left out because no size fits. ` : ''}
        {catalogSource === 'mock' ? 'Pair a shop to see its real catalogue here.' : 'Passed items come back later; loved and saved ones are in your wardrobe.'}
      </p>
      <div className="flex gap-2">
        <Link to="/pair" className="btn-primary">
          Pair a shop
        </Link>
        <Link to="/wardrobe" className="btn-ghost">
          Wardrobe
        </Link>
      </div>
    </div>
  );
}

export default SwipeDeck;
