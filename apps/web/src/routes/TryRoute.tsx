import { Bookmark, ExternalLink, Heart, PauseCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MOCK_GARMENTS_BY_ID, type FitCohortResponse, type TryResolveResponse } from '@curtain/schema';
import { Avatar } from '@/components/Avatar';
import { CohortBars } from '@/components/CohortBars';
import { ColourChip } from '@/components/ColourChip';
import { EstimateDisclaimer } from '@/components/EstimateBadge';
import { FitPanel } from '@/components/FitPanel';
import { eur } from '@/lib/format';
import { colourTarget } from '@/lib/season';
import { api, MOCK_SHOP, useApp } from '@/store';
import { fitFor } from '@/store/fit';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: TryResolveResponse };

/**
 * Deep link from a merchant page: GET /v1/try/:token → shop banner + garment → fit + mirror.
 * Not onboarded yet → the token is stored as pendingIntent and resumed after onboarding.
 * Tokens of the form `mock:<garment id>` resolve to a bundled fixture (dev / e2e only).
 */
export function TryRoute(): ReactNode {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const hydrated = useApp((s) => s.hydrated);
  const onboarded = useApp((s) => s.settings.onboarded);
  const setPendingIntent = useApp((s) => s.setPendingIntent);
  const addPairedShop = useApp((s) => s.addPairedShop);
  const fitCtx = useApp((s) => s.fitCtx);
  const hasMeasurements = useApp((s) => s.hasMeasurements)();
  const swipe = useApp((s) => s.swipe);
  const season = useApp((s) => s.settings.season);
  const undertone = useApp((s) => s.settings.undertone);
  const wardrobe = useApp((s) => s.wardrobe);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [cohort, setCohort] = useState<FitCohortResponse | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [done, setDone] = useState<'love' | 'save' | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!onboarded) {
      void setPendingIntent(token).then(() => navigate('/onboarding', { replace: true }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await resolve(token);
        if (cancelled) return;
        setState({ status: 'ready', data });
        await setPendingIntent(null);
        if (data.shop.id !== MOCK_SHOP.id) {
          try {
            const products = await api.shopProducts(data.shop.id);
            await addPairedShop(data.shop, products.items);
          } catch {
            await addPairedShop(data.shop, [data.garment]);
          }
          api.fitCohort(data.garment.id).then(setCohort, () => setCohort(null));
        }
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'This link could not be opened.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, onboarded, token, navigate, setPendingIntent, addPairedShop]);

  const garment = state.status === 'ready' ? state.data.garment : null;
  const fit = useMemo(() => (garment ? fitFor(fitCtx, garment) : null), [garment, fitCtx]);
  const renderSize = size ?? fit?.recommendedSize ?? fit?.closestSize ?? null;
  const target = colourTarget(season, undertone);
  const saved = garment ? wardrobe.some((w) => w.productId === garment.id) : false;

  if (state.status === 'loading') return <p className="p-6 text-center text-sm text-ink-soft">Opening the fitting room…</p>;
  if (state.status === 'error')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="font-display text-2xl">We could not open this link</h1>
        <p className="text-sm text-ink-soft">{state.message}</p>
        <Link to="/deck" className="btn-primary">
          Go to your rail
        </Link>
      </div>
    );

  const { shop, trySession } = state.data;
  const g = state.data.garment;
  const act = async (action: 'love' | 'save'): Promise<void> => {
    await swipe(action, { garment: g, shopId: shop.id, intentToken: trySession.intentToken });
    setDone(action);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 px-5 py-3" style={shop.brandColor ? { borderBottom: `3px solid ${shop.brandColor}` } : undefined}>
        {shop.logoUrl ? <img src={shop.logoUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-bold text-cream">{shop.name.slice(0, 1)}</span>}
        <div className="min-w-0">
          <p className="eyebrow">Trying on from</p>
          <p className="truncate font-medium">{shop.name}</p>
        </div>
      </header>
      {shop.paused ? (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-2xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          <PauseCircle className="h-5 w-5 shrink-0" aria-hidden /> This shop has paused Curtain try-ons. You can still see the estimate; swipes are not counted for the shop.
        </div>
      ) : null}
      <div className="px-4">
        <div className="mirror-frame mx-auto aspect-[5/8] w-full max-w-[22rem]">
          <Avatar garment={g} fit={fit} size={renderSize} />
          <div className="absolute right-3 bottom-3 left-3">
            <FitPanel fit={fit} hasMeasurements={hasMeasurements} compact />
          </div>
        </div>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-coral-ink">{g.brand}</p>
            <h1 className="font-display text-2xl leading-tight">{g.name}</h1>
            <p className="text-xs text-ink-mute">
              {g.fabric.primary} · {g.patternBlock}
            </p>
          </div>
          <p className="font-display text-2xl">{eur(g.priceEur)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ColourChip hex={g.primaryColorHex} target={target} />
        </div>
        {fit && fit.perSize.length > 1 ? (
          <div className="space-y-1">
            <p className="eyebrow">See it in another size</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size to preview">
              {fit.perSize.map((s) => (
                <button key={s.size} type="button" role="radio" aria-checked={renderSize === s.size} onClick={() => setSize(s.size)} className={`chip ${renderSize === s.size ? 'border-coral bg-coral text-ink' : ''}`}>
                  {s.size}
                  {s.score !== null ? <span className="text-xs opacity-80">{Math.round(s.score * 100)}%</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {fit ? (
          <ul className="space-y-0.5 text-xs text-ink-soft" aria-label="Fit notes">
            {fit.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        ) : null}
        <EstimateDisclaimer />
        <div className="flex gap-2">
          <button type="button" className="btn-coral flex-1" disabled={done !== null} onClick={() => void act('love')} aria-label="Love this">
            <Heart className="h-5 w-5" aria-hidden /> {done === 'love' ? 'Loved' : 'Love'}
          </button>
          <button type="button" className="btn-primary flex-1" disabled={saved || done === 'save'} onClick={() => void act('save')} aria-label="Save to wardrobe">
            <Bookmark className="h-5 w-5" aria-hidden /> {saved ? 'In wardrobe' : 'Save'}
          </button>
        </div>
        {g.productUrl ? (
          <a href={g.productUrl} target="_blank" rel="noreferrer noopener" className="btn-ghost w-full">
            <ExternalLink className="h-4 w-4" aria-hidden /> Back to {shop.name}
          </a>
        ) : null}
        <CohortBars cohort={cohort} highlight={fit?.recommendedSize ?? null} />
        <p className="text-xs text-ink-mute">The shop only learns that this item was opened — never your measurements or photos. The try link expires {new Date(trySession.expiresAt).toLocaleTimeString()}.</p>
      </div>
    </div>
  );
}

async function resolve(token: string): Promise<TryResolveResponse> {
  if (token.startsWith('mock:')) {
    const id = token.slice(5);
    const garment = MOCK_GARMENTS_BY_ID[id];
    if (!garment) throw new Error(`Unknown demo garment ${id}`);
    const now = new Date();
    return {
      shop: MOCK_SHOP,
      garment,
      trySession: { id: '00000000-0000-4000-8000-0000000000aa', expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(), intentToken: `mock-intent-${id}-${now.getTime()}` },
      pairing: { created: false, pairedAt: now.toISOString() },
    };
  }
  return api.resolveTry(token);
}
