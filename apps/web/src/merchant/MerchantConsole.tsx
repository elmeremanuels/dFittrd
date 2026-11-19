import { AlertCircle, BarChart3, LogOut, ShieldCheck, ShoppingCart, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { CATEGORY_TEXT, MERCHANT_PLAN_TEXT, type SetupResponse } from '@curtain/schema';
import type { AnalyticsAbandonedResponse, AnalyticsFitSizesResponse, AnalyticsPeriodsResponse, AnalyticsSuppression, AnalyticsSwipesResponse, BillingAnomaliesResponse, MerchantLedgerResponse, MerchantProductsResponse, UsageResponse } from '@curtain/schema';
import { MERCHANT_KEY_PATTERN, NetworkError, type MerchantApi } from '@/api/client';
import { Ledger, type LedgerLine } from '@/components/Ledger';
import { dayIso, pct, titleCase } from '@/lib/format';
import { api } from '@/store';
import { merchantStrings } from './strings';
import { planPriceText, planState, planStatusText } from './plan';
import { mockAbandonedAnalytics, mockAnalytics, mockAnomalies, mockFitSizes, mockLedger, mockPeriods, mockProducts, mockSetup, mockUsage } from './mock';
import { LeavingCurtain, SetupChecklist } from './Setup';

const SESSION_KEY = 'curtain.merchantKey';

export function readMerchantKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeMerchantKey(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(SESSION_KEY, key);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export function MerchantLogin(): ReactNode {
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const k = key.trim();
    if (!MERCHANT_KEY_PATTERN.test(k)) {
      setError('That is not a Curtain secret key. Copy it again from where Curtain showed it to you: it starts with “sk_”. It stays in this browser tab only.');
      return;
    }
    writeMerchantKey(k);
    navigate('/merchant', { replace: true });
  };
  if (readMerchantKey()) return <Navigate to="/merchant" replace />;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream px-6 py-10">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 bg-white/80">
        <header>
          <p className="eyebrow">Curtain for shops</p>
          <h1 className="font-display text-3xl">Merchant console</h1>
        </header>
        <label htmlFor="merchant-key" className="eyebrow block">
          Secret key
        </label>
        <input id="merchant-key" type="password" autoComplete="off" className="field-input font-sans text-base" value={key} onChange={(e) => setKey(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'merchant-key-error' : undefined} placeholder="sk_test_…" />
        {error ? (
          <p id="merchant-key-error" role="alert" className="text-xs text-coral-ink">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary w-full">
          Open console
        </button>
        <p className="text-xs text-ink-mute">Ask Curtain support for your console key (the WordPress plugin keeps its own key hidden, so it cannot show it to you). On Shopify you do not need this page: everything is under Apps → Curtain in your Shopify admin.</p>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface MerchantData {
  mode: 'live' | 'mock';
  products: MerchantProductsResponse;
  usage: UsageResponse;
  /** Swipe aggregates of `period`; null when no month is closed yet or this api version does not serve it. */
  analytics: AnalyticsSwipesResponse | null;
  ledger: MerchantLedgerResponse;
  /** Standalone fit-shown sizes (carry-over #18); null when this api version does not serve it. */
  fitSizes: AnalyticsFitSizesResponse | null;
  /** Abandoned opens, k floor on distinct shoppers (carry-over #19). */
  abandoned: AnalyticsAbandonedResponse | null;
  /** Billing anomaly signal: daily cap and spikes (carry-over #7). */
  anomalies: BillingAnomaliesResponse | null;
  range: { from: string; to: string };
  /** The closed months analytics can show (launch-readiness finding 1); null on an older api. */
  periods: AnalyticsPeriodsResponse | null;
  /** The month the analytics sections show, or null when none is closed yet. */
  period: string | null;
  setPeriod: (period: string) => void;
  /** The first-run checklist; null on an older api without the route. */
  setup: SetupResponse | null;
  /** Ticks step 4 or 5 by hand and refreshes the list. */
  confirmSetup: (body: { buttonConfirmed?: boolean; phoneConfirmed?: boolean }) => Promise<void>;
}

type BaseData = Omit<MerchantData, 'analytics' | 'fitSizes' | 'abandoned' | 'period' | 'setPeriod' | 'confirmSetup'>;
type MonthData = Pick<MerchantData, 'analytics' | 'fitSizes' | 'abandoned'> & { period: string | null };

/** Optional sections: an older api without the route must not take the whole console down. */
const optional = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export function MerchantLayout(): ReactNode {
  const navigate = useNavigate();
  const key = readMerchantKey();
  const [base, setBase] = useState<BaseData | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86_400_000);
    const range = { from: dayIso(from), to: dayIso(to) };
    const m: MerchantApi = api.merchant(key);
    (async () => {
      try {
        const [products, usage, ledger, anomalies, periods, setup] = await Promise.all([m.products(), m.usage(range.from, range.to), m.ledger(), optional(m.usageAnomalies(range.from, range.to)), optional(m.analyticsPeriods()), optional(m.setup())]);
        if (cancelled) return;
        setBase({ mode: 'live', products, usage, ledger, anomalies, range, periods, setup });
        setPeriod(periods?.periods[0] ?? null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof NetworkError || (e instanceof Error && e.name === 'ApiError' && (e as { status?: number }).status === 404)) {
          const periods = mockPeriods();
          const products = mockProducts();
          setBase({ mode: 'mock', products, usage: mockUsage(range.from, range.to), ledger: mockLedger(), anomalies: mockAnomalies(range.from, range.to), range, periods, setup: mockSetup(products) });
          setPeriod(periods.periods[0] ?? null);
        } else if (e instanceof Error && e.name === 'ApiError' && [401, 403].includes((e as { status?: number }).status ?? 0)) {
          setError('This key was not accepted. It may have been replaced: sign out and paste the newest key from your Curtain settings (WooCommerce → Curtain, or the Curtain app in Shopify).');
        } else {
          setError('Your shop could not be loaded just now. Check your internet connection and reload the page; if it keeps happening, email Curtain support.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Analytics come one closed calendar month at a time (launch-readiness finding 1).
  const [fetched, setFetched] = useState<MonthData | null>(null);
  useEffect(() => {
    if (!key || !base || base.mode !== 'live' || !period) return;
    let cancelled = false;
    const m: MerchantApi = api.merchant(key);
    void Promise.all([optional(m.analyticsSwipes(period)), optional(m.analyticsFitSizes(period)), optional(m.analyticsAbandoned(period))]).then(([analytics, fitSizes, abandoned]) => {
      if (!cancelled) setFetched({ period, analytics, fitSizes, abandoned });
    });
    return () => {
      cancelled = true;
    };
  }, [key, base, period]);
  const month = useMemo((): MonthData | null => {
    if (!base) return null;
    if (!period) return { period: null, analytics: null, fitSizes: null, abandoned: null };
    if (base.mode === 'mock') return { period, analytics: mockAnalytics(period), fitSizes: mockFitSizes(period), abandoned: mockAbandonedAnalytics(period, base.usage) };
    return fetched?.period === period ? fetched : null;
  }, [base, period, fetched]);

  const confirmSetup = async (body: { buttonConfirmed?: boolean; phoneConfirmed?: boolean }): Promise<void> => {
    if (!key || base?.mode !== 'live') return;
    const setup = await api.merchant(key).updateSetup(body);
    setBase((b) => (b ? { ...b, setup } : b));
  };
  const data: MerchantData | null = base && month ? { ...base, ...month, setPeriod, confirmSetup } : null;

  if (!key) return <Navigate to="/merchant/login" replace />;

  return (
    <div className="min-h-dvh bg-cream text-ink">
      <header className="border-b border-ink/10 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <p className="eyebrow">Curtain for shops</p>
            <h1 className="font-display text-2xl">Merchant console</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Console sections">
            {[
              ['/merchant', 'Overview'],
              ['/merchant/products', 'Products'],
              ['/merchant/usage', 'Usage & plan'],
              ['/merchant/analytics', 'Swipes'],
              ['/merchant/ledger', 'Privacy ledger'],
            ].map(([to, label]) => (
              <NavLink key={to} to={to!} end={to === '/merchant'} className={({ isActive }) => `rounded-full px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-ink text-cream' : 'text-ink-soft hover:bg-ink/5'}`}>
                {label}
              </NavLink>
            ))}
            <button
              type="button"
              className="btn-ghost ml-2 min-h-9 px-3 text-xs"
              onClick={() => {
                writeMerchantKey(null);
                navigate('/merchant/login', { replace: true });
              }}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
            </button>
          </nav>
        </div>
        {base?.mode === 'mock' ? (
          <p className="bg-warn/10 px-6 py-2 text-center text-xs text-warn" role="status">
            API unreachable — showing demo data with the real response shapes. Nothing here is from your shop.
          </p>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        {error ? (
          <p role="alert" className="card text-sm text-bad">
            {error}
          </p>
        ) : !data ? (
          <p className="text-sm text-ink-soft" role="status">
            Loading your shop…
          </p>
        ) : (
          <Outlet context={data} />
        )}
      </main>
    </div>
  );
}

import { useOutletContext } from 'react-router';
export function useMerchantData(): MerchantData {
  return useOutletContext<MerchantData>();
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function StatCard({ label, value, hint, icon, tone = 'ink' }: { label: string; value: string; hint?: string; icon: ReactNode; tone?: 'ink' | 'ok' | 'warn' | 'bad' }): ReactNode {
  const toneClass = { ink: 'text-ink', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[tone];
  return (
    <div className="card bg-white/80">
      <div className="mb-3 flex items-start justify-between">
        <span className="rounded-xl bg-cream p-2 text-ink-soft">{icon}</span>
        {hint ? <span className={`text-xs font-semibold ${toneClass}`}>{hint}</span> : null}
      </div>
      <p className="eyebrow">{label}</p>
      <p className="font-display text-3xl">{value}</p>
    </div>
  );
}

export function MerchantOverview(): ReactNode {
  const d = useMerchantData();
  const abandoned = d.abandoned && d.abandoned.totals.sessions > 0 ? { opens: d.abandoned.totals.sessions, abandoned: d.abandoned.totals.sessions - d.abandoned.totals.withFit } : null;
  const t = merchantStrings().analytics;
  const k = d.analytics?.kAnonymityFloor ?? d.periods?.kAnonymityFloor ?? 5;
  const shown = d.analytics?.byProduct ?? [];
  const totalSwipes = shown.reduce((n, p) => n + p.love + p.pass + p.save + p.less, 0);
  const saves = shown.reduce((n, p) => n + p.save, 0);
  return (
    <div className="space-y-6">
      {d.setup && d.setup.next !== null ? <SetupChecklist setup={d.setup} onConfirm={d.confirmSetup} live={d.mode === 'live'} /> : null}
      <PeriodPicker />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Fit sessions (30 d)" value={d.usage.totals.fitSessions.toLocaleString()} icon={<TrendingUp className="h-5 w-5" aria-hidden />} hint={`${d.usage.plan.name} plan`} />
        <StatCard label="Save rate" value={totalSwipes ? pct(saves / totalSwipes) : '—'} icon={<ShoppingCart className="h-5 w-5" aria-hidden />} hint={`${totalSwipes} swipes`} />
        <StatCard
          label="Abandoned opens"
          value={abandoned ? abandoned.abandoned.toLocaleString() : '—'}
          icon={<BarChart3 className="h-5 w-5" aria-hidden />}
          hint={abandoned ? `${pct(abandoned.abandoned / abandoned.opens)} of ${abandoned.opens} opens` : t.abandonedHint(k)}
          tone={abandoned ? 'warn' : 'ink'}
        />
        <StatCard label="Products not ready yet" value={String(d.products.counts.incomplete)} icon={<AlertCircle className="h-5 w-5" aria-hidden />} hint={d.products.counts.incomplete > 0 ? 'see Products for what to do' : 'all ready'} tone={d.products.counts.incomplete > 0 ? 'bad' : 'ok'} />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SizeDistribution analytics={d.analytics} fitSizes={d.fitSizes} />
        <section className="card space-y-2 bg-white/80">
          <h2 className="font-display text-xl">What Curtain never sends you</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>No measurement, photo, fit signature or device id — ever.</li>
            <li>{t.neverSends(k)}</li>
            <li>Per-session sizes and scores are not returned to your page; order attribution is off by default.</li>
          </ul>
          <p className="flex items-center gap-2 text-xs text-ink-mute">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Fit is computed on the shopper’s phone.
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * Sizes recommended to shoppers, from both sources side by side (carry-over #18): the on-page fit
 * (standalone sessions, counted per session) and the app's swipe deck (counted per swipe). Each
 * source applies the k floor on its own, so a size can appear in one source only.
 */
function SizeDistribution({ analytics, fitSizes }: { analytics: AnalyticsSwipesResponse | null; fitSizes: AnalyticsFitSizesResponse | null }): ReactNode {
  const t = merchantStrings().analytics;
  const onPage = new Map((fitSizes?.bySize ?? []).map((s) => [s.size, s.sessions]));
  const swipes = new Map((analytics?.bySize ?? []).map((s) => [s.size, s.love + s.pass + s.save + s.less]));
  const sizes = [...new Set([...onPage.keys(), ...swipes.keys()])];
  const onPageTotal = Math.max(1, [...onPage.values()].reduce((n, v) => n + v, 0));
  const swipeTotal = Math.max(1, [...swipes.values()].reduce((n, v) => n + v, 0));
  const bar = (label: string, share: number, tone: string) => (
    <div className="h-2 overflow-hidden rounded-full bg-ink/10" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={label}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${share * 100}%` }} />
    </div>
  );
  return (
    <section className="card space-y-3 bg-white/80" aria-labelledby="size-distribution">
      <h2 id="size-distribution" className="font-display text-xl">
        Sizes recommended
      </h2>
      <p className="flex flex-wrap gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-full bg-coral" aria-hidden /> On your product page (standalone fit, per session)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-full bg-ink" aria-hidden /> In the Curtain app (at swipe time, per swipe)
        </span>
      </p>
      {sizes.length === 0 ? (
        <p className="text-sm text-ink-mute">Shown once enough shoppers have seen a size.</p>
      ) : (
        <ul className="space-y-3">
          {sizes.map((size) => {
            const page = onPage.get(size);
            const swipe = swipes.get(size);
            return (
              <li key={size} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Size {size}</span>
                  <span className="tabular-nums text-ink-soft">
                    {page !== undefined ? `${page} on page` : 'on page: —'} · {swipe !== undefined ? `${swipe} swipes` : 'swipes: —'}
                  </span>
                </div>
                {bar(`Size ${size} on your product page: ${page ?? 0} sessions`, (page ?? 0) / onPageTotal, 'bg-coral')}
                {bar(`Size ${size} at swipe time: ${swipe ?? 0} swipes`, (swipe ?? 0) / swipeTotal, 'bg-ink')}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-ink-mute">Bars show each size’s share within its source. {t.sizeHiddenNote(fitSizes?.kAnonymityFloor ?? analytics?.kAnonymityFloor ?? 5)}</p>
      {fitSizes ? <HiddenNote suppression={fitSizes.suppression} k={fitSizes.kAnonymityFloor} noun={{ one: 'size', many: 'sizes' }} /> : null}
    </section>
  );
}

/** Where a WooCommerce or Shopify merchant does each next step (the console itself does not edit products). */
const WHERE_TO_DO_IT: Record<SetupResponse['platform'], string> = {
  woocommerce: 'You do these in WordPress: open the product under Products and scroll to the “Curtain” box (size chart, then Garment measurements), then press Update.',
  shopify: 'You do these in Shopify: Apps → Curtain, then open the product from its list.',
};

export function MerchantProducts(): ReactNode {
  const d = useMerchantData();
  const platform = d.setup?.platform ?? 'woocommerce';
  const onlyMeasure = typeof location !== 'undefined' && new URLSearchParams(location.search).get('next') === 'measure';
  const items = onlyMeasure ? d.products.items.filter((p) => p.next?.key === 'measure') : d.products.items;
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">Products</h2>
        <p className="text-sm text-ink-soft">
          {d.products.counts.active} ready · {d.products.counts.incomplete} not ready yet{d.products.counts.archived ? ` · ${d.products.counts.archived} hidden` : ''}
        </p>
      </header>
      <p className="text-sm text-ink-soft" data-testid="where-to-do-it">
        {onlyMeasure ? 'These products give a size already and would be more exact with your own measurements. ' : ''}
        {WHERE_TO_DO_IT[platform]}
      </p>
      {d.products.items.length === 0 ? (
        <p className="card bg-white/80 text-sm text-ink-soft">No products yet. Your published products come in by themselves a minute or two after you connect; reload this page to look again.</p>
      ) : (
      <div className="overflow-x-auto rounded-3xl border border-ink/10 bg-white/80">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Size advice</th>
              <th className="px-4 py-3">What to do next</th>
              <th className="px-4 py-3">
                <span className="sr-only">{merchantStrings().assets.open3d}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {items.map((p) => {
              const tone = p.next?.tone ?? (p.status === 'active' ? 'success' : 'critical');
              const score = p.adviceScore ?? Math.round(p.score * 100);
              return (
              <tr key={p.externalId} data-testid={`product-${p.externalId}`}>
                <td className="px-4 py-3">
                  <p className="font-medium">{p.name}</p>
                </td>
                <td className="px-4 py-3">{p.category ? (CATEGORY_TEXT[p.category] ?? titleCase(p.category)) : '—'}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${tone === 'success' ? 'border-ok/30 bg-ok/10 text-ok' : tone === 'warning' ? 'border-warn/30 bg-warn/10 text-warn' : 'border-bad/30 bg-bad/10 text-bad'}`}>{p.next?.badge ?? (p.status === 'active' ? 'Ready' : 'Not ready yet')}</span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label={`Size advice ${score} out of 100`}>
                      <div className={`h-full ${tone === 'success' ? 'bg-ok' : 'bg-coral'}`} style={{ width: `${score}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-ink-mute">{score} / 100</span>
                  </div>
                  {/* The men's gate (D20 point 3): why shoppers do not get the fitting room for this product, and the next step. */}
                  {p.menGate === 'coming_soon' ? (
                    <span className="chip mt-1 block w-fit" data-testid="men-gate-badge" title="Shoppers see “Men’s clothing: coming soon” for this product. It opens once the shop has the 3D estimate on and an approved 3D bundle on the male body exists for it.">
                      Men’s: coming soon
                    </span>
                  ) : p.menGate === 'audience_unconfirmed' ? (
                    <span className="chip mt-1 block w-fit" data-testid="men-gate-badge" title="We read “men” from the title or a collection only, or the product has not been synced since we started asking where the audience comes from. Set the audience on the product to confirm it, or sync it again; until then it is shown as before.">
                      Men’s: confirm audience
                    </span>
                  ) : null}
                </td>
                <td className="max-w-sm px-4 py-3 text-ink-soft">{p.next?.text ?? (p.missingFields.length ? `Missing: ${p.missingFields.join(', ')}` : '—')}</td>
                <td className="px-4 py-3">
                  <Link to={`/merchant/products/${encodeURIComponent(p.externalId)}/3d`} className="chip whitespace-nowrap hover:bg-white" data-testid={`open-3d-${p.externalId}`}>
                    {merchantStrings().assets.open3d}
                  </Link>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

/** The one Curtain plan (D17): flat price, every try-on session included, sessions counted for analytics only. */
function PlanCard({ plan, live }: { plan: UsageResponse['plan']; live: boolean }): ReactNode {
  const state = planState(plan);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  // WooCommerce (Stripe): a Checkout for the Curtain plan; Shopify shops approve in the Shopify admin.
  const canCheckout = live && plan.switchVia === 'stripe' && state === 'legacy';
  const startCheckout = async (): Promise<void> => {
    const key = readMerchantKey();
    if (!key) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const r = await api.merchant(key).stripeCheckout();
      location.assign(r.checkoutUrl);
    } catch (e) {
      setSwitchError(e instanceof Error ? e.message : 'Could not start the switch.');
      setSwitching(false);
    }
  };
  return (
    <section className="card space-y-2 bg-white/80" aria-labelledby="plan-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="plan-heading" className="font-display text-xl">
          Curtain
        </h2>
        <p className="font-medium tabular-nums">{state === 'legacy' ? 'Old plan price' : planPriceText(plan)}</p>
      </div>
      <p className="text-sm text-ink-soft">{MERCHANT_PLAN_TEXT.oneLine} A daily fair-use limit stops automated traffic; your price stays the same.</p>
      <p className={`text-sm ${state === 'paused' ? 'text-bad' : state === 'active' ? 'text-ok' : state === 'legacy' ? 'text-warn' : 'text-ink-mute'}`} data-testid="plan-status">
        {planStatusText(plan)}
      </p>
      {canCheckout ? (
        <button type="button" className="btn-primary" disabled={switching} onClick={() => void startCheckout()}>
          Switch to Curtain ({planPriceText({ priceUsdPerMonth: plan.priceUsdPerMonth })})
        </button>
      ) : null}
      {switchError ? <p className="text-sm text-bad">{switchError}</p> : null}
    </section>
  );
}

export function MerchantUsage(): ReactNode {
  const d = useMerchantData();
  const u = d.usage;
  const used = u.plan.sessionsUsedThisPeriod;
  const max = Math.max(1, ...u.days.map((x) => x.fitSessions));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Plan" value={u.plan.name === 'free' ? 'No plan' : 'Curtain'} icon={<ShoppingCart className="h-5 w-5" aria-hidden />} hint={u.plan.paused ? 'paused' : u.plan.name === 'free' ? 'not subscribed' : u.plan.legacyPlan ? 'retired plan: switch' : planPriceText(u.plan)} tone={u.plan.paused ? 'bad' : 'ok'} />
        <StatCard label="Sessions this period" value={used.toLocaleString()} icon={<TrendingUp className="h-5 w-5" aria-hidden />} hint="counted for analytics, not billed" />
        <StatCard label="Hero renders (30 d)" value={u.totals.heroRenders.toLocaleString()} icon={<BarChart3 className="h-5 w-5" aria-hidden />} hint={`$${u.totals.costUsd.toFixed(2)} provider cost`} />
      </div>
      <PlanCard plan={u.plan} live={d.mode === 'live'} />
      <LeavingCurtain platform={d.setup?.platform ?? 'woocommerce'} />
      {d.anomalies ? <BillingAlerts report={d.anomalies} /> : null}
      <section className="card space-y-3 bg-white/80">
        <h2 className="font-display text-xl">Fit sessions per day</h2>
        <p className="text-xs text-ink-mute">
          {u.from} → {u.to}. One session = one product resolved by one shopper with a fit result written (D7).
        </p>
        <ol className="flex h-40 items-end gap-0.5" aria-label="Fit sessions per day">
          {u.days.map((day) => (
            <li key={day.day} className="flex-1" title={`${day.day}: ${day.fitSessions} sessions`}>
              <div className="w-full rounded-t bg-ink" style={{ height: `${(day.fitSessions / max) * 100}%` }} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={day.fitSessions} aria-label={`${day.day}: ${day.fitSessions} sessions`} />
            </li>
          ))}
        </ol>
        {u.plan.paused ? <p className="text-sm text-bad">No active subscription: the “Try it on” button still renders; shoppers see a “shop paused” screen until the Curtain plan is active again.</p> : null}
      </section>
    </div>
  );
}

/** Billing anomaly signal (carry-over #7): the daily cap and days far above the usual volume. */
function BillingAlerts({ report }: { report: BillingAnomaliesResponse }): ReactNode {
  const t = report.today;
  return (
    <section className="card space-y-3 bg-white/80" aria-labelledby="billing-alerts">
      <h2 id="billing-alerts" className="font-display text-xl">
        Unusual traffic
      </h2>
      <p className="text-xs text-ink-mute">
        Today {t.billedSessions.toLocaleString()} counted sessions (usual day: {t.trailingAverage.toFixed(1)}). We flag a day above {t.spikeThreshold.toLocaleString()} and stop counting at the fair-use cap of {report.dailyCap.toLocaleString()} a day. Your price stays the same either way.
      </p>
      {t.capReached || t.spike ? (
        <p role="alert" className={`text-sm ${t.capReached ? 'text-bad' : 'text-warn'}`}>
          {t.capReached ? 'Today’s fair-use cap is reached: further sessions today are not counted. Shoppers still get their size. Contact us if this is a real rush.' : 'Today is far above your usual volume. If you did not run a campaign, tell us: it can be automated traffic.'}
        </p>
      ) : null}
      {report.anomalies.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing unusual in this range.</p>
      ) : (
        <ul className="divide-y divide-ink/10 text-sm">
          {report.anomalies.map((a) => (
            <li key={`${a.day}-${a.kind}`} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-medium">
                {a.day} · {a.kind === 'cap_reached' ? 'Daily cap reached' : 'Spike'}
              </span>
              <span className="tabular-nums text-ink-soft">
                {a.kind === 'cap_reached' ? `${a.deniedSessions.toLocaleString()} sessions not counted (cap ${a.threshold.toLocaleString()})` : `${a.billedSessions.toLocaleString()} counted vs usual ${a.trailingAverage.toFixed(1)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SwipeTable({ title, rows, keyName }: { title: string; rows: { key: string; love: number; pass: number; save: number; less: number }[]; keyName: string }): ReactNode {
return (
  <section className="card bg-white/80">
    <h2 className="mb-2 font-display text-xl">{title}</h2>
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wider text-ink-mute">
        <tr>
          <th className="py-1">{keyName}</th>
          <th className="py-1 text-right">Love</th>
          <th className="py-1 text-right">Save</th>
          <th className="py-1 text-right">Pass</th>
          <th className="py-1 text-right">Less</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/10">
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-1.5 font-medium">{r.key}</td>
            <td className="py-1.5 text-right tabular-nums">{r.love}</td>
            <td className="py-1.5 text-right tabular-nums">{r.save}</td>
            <td className="py-1.5 text-right tabular-nums">{r.pass}</td>
            <td className="py-1.5 text-right tabular-nums">{r.less}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);
}

/** The month the analytics sections show: closed calendar months only, newest first. */
function PeriodPicker(): ReactNode {
  const d = useMerchantData();
  const t = merchantStrings().analytics;
  const p = d.periods;
  if (!p) return <p className="text-sm text-ink-soft">{t.noMonthLive}</p>;
  const availableOn = new Date(p.openPeriodAvailableAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (!d.period) return <p className="card bg-white/80 text-sm text-ink-soft">{t.noMonthYet(availableOn)}</p>;
  return (
    <section className="card space-y-2 bg-white/80" aria-labelledby="analytics-month">
      <div className="flex flex-wrap items-center gap-3">
        <label id="analytics-month" htmlFor="analytics-month-select" className="eyebrow">
          {t.monthLabel}
        </label>
        <select id="analytics-month-select" className="field-input w-auto min-w-40 py-1.5 font-sans text-sm" value={d.period} onChange={(e) => d.setPeriod(e.target.value)}>
          {p.periods.map((m) => (
            <option key={m} value={m}>
              {t.monthName(m)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-ink-soft">{t.monthNote(t.monthName(d.period), t.monthName(p.openPeriod), availableOn)}</p>
      <p className="text-xs text-ink-mute">{t.whyMonths}</p>
    </section>
  );
}

/** Says in plain English how many rows are hidden and why (below the floor, or hidden with them so they cannot be subtracted out). */
function HiddenNote({ suppression, k, noun }: { suppression: AnalyticsSuppression; k: number; noun: { one: string; many: string } }): ReactNode {
  return (
    <p className="flex items-start gap-2 text-xs text-ink-soft" role="note">
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> <span>{merchantStrings().analytics.hidden(suppression, k, noun)}</span>
    </p>
  );
}

export function MerchantAnalytics(): ReactNode {
  const d = useMerchantData();
  const t = merchantStrings().analytics;
  const a = d.analytics;
  return (
    <div className="space-y-6">
      <PeriodPicker />
      {a ? (
        <>
          <section className="space-y-1">
            <HiddenNote suppression={a.suppression} k={a.kAnonymityFloor} noun={{ one: 'product or size', many: 'products or sizes' }} />
            <p className="text-xs text-ink-mute">{t.derivedNote} Pass reasons are inferred on the shopper’s phone.</p>
          </section>
          <SwipeTable title="By product" keyName="Product" rows={a.byProduct.map((p) => ({ key: p.externalId, ...p }))} />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <SwipeTable title="By colour" keyName="Hue" rows={a.byColour.map((c) => ({ key: c.hue, ...c }))} />
            <SwipeTable title="By fabric" keyName="Fabric" rows={a.byFabric.map((f) => ({ key: f.fabric, ...f }))} />
            <SwipeTable title="By size" keyName="Size" rows={a.bySize.map((s) => ({ key: s.size, ...s }))} />
          </div>
          <section className="card bg-white/80">
            <h2 className="mb-2 font-display text-xl">Why shoppers pass</h2>
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {a.byProduct.slice(0, 8).map((p) => (
                <li key={p.externalId} className="rounded-2xl border border-ink/10 p-3 text-xs">
                  <p className="mb-1 font-medium">{p.externalId}</p>
                  {Object.entries(p.passReasons).map(([r, n]) => (
                    <p key={r} className="flex justify-between text-ink-soft">
                      <span>{titleCase(r)}</span>
                      <span className="tabular-nums">{n}</span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

export function MerchantLedgerRoute(): ReactNode {
  const d = useMerchantData();
  const lines: LedgerLine[] = d.ledger.entries.map((e) => ({
    id: e.id,
    at: e.at,
    title: `Hero render · ${e.productExternalId}`,
    detail: `${e.provider} / ${e.model} · deleted after ${e.retentionHours} h`,
    fields: e.inputs,
  }));
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">Everything Curtain sent to an AI provider on behalf of your shoppers. Inputs are the anonymised avatar render and your product imagery — never a shopper photo.</p>
      <Ledger lines={lines} title="Provider ledger" emptyText="No hero renders yet." />
    </div>
  );
}
