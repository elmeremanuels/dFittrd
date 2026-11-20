import { Download, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { BODY_MEASUREMENT_KEYS, confidenceFromSigma, type BodyMeasurementKey } from '@curtain/schema';
import { SEASON_TABLE, isSeason } from '@curtain/taste-engine';
import { MEASUREMENT_LABELS } from '@/features/capture';
import { EstimateBadge } from '@/components/EstimateBadge';
import { Ledger, type LedgerLine } from '@/components/Ledger';
import { TasteRadial } from '@/components/TasteRadial';
import { downloadJson } from '@/platform/download';
import { pct } from '@/lib/format';
import { type ClientLedgerEntry, type ConsentTier } from '@/db/db';
import { useApp } from '@/store';
import { parts } from '@/embed/strings';
import { appStrings } from '@/strings';

const UNIT: Record<BodyMeasurementKey, 'cm' | 'kg' | 'eu'> = { bust: 'cm', waist: 'cm', hip: 'cm', shoulder: 'cm', thigh: 'cm', inseam: 'cm', foot: 'cm', footLengthCm: 'cm', footEu: 'eu', height: 'cm', weight: 'kg', neck: 'cm', sleeve: 'cm' };

export function ledgerLines(entries: ClientLedgerEntry[]): LedgerLine[] {
  const t = appStrings().app.profile;
  return entries.map((e) => ({
    id: e.id,
    at: e.at,
    title: t.ledgerKinds[e.kind],
    detail: `${e.method} ${e.path}`,
    fields: e.fields,
    bytes: e.bytes,
    status: e.status === 'failed' ? t.ledgerFailed : t.ledgerHttp(e.status),
  }));
}

export function ProfileRoute(): ReactNode {
  const navigate = useNavigate();
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  const taste = useApp((s) => s.taste);
  const ledger = useApp((s) => s.ledger);
  const outboxPending = useApp((s) => s.outboxPending);
  const setConsent = useApp((s) => s.setConsent);
  const deleteScanLocal = useApp((s) => s.deleteScanLocal);
  const deleteEverything = useApp((s) => s.deleteEverything);
  const exportLocal = useApp((s) => s.exportLocal);
  const flushOutbox = useApp((s) => s.flushOutbox);
  const [confirm, setConfirm] = useState<'scan' | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const t = appStrings().app.profile;
  const units = appStrings().app.common.units;
  const [noneBefore, noneAfter] = parts(t.noMeasurements, 'add');

  const season = settings.season && isSeason(settings.season) ? SEASON_TABLE[settings.season] : null;
  const rows = profile ? BODY_MEASUREMENT_KEYS.filter((k) => profile.measurements[k]).map((k) => ({ key: k, m: profile.measurements[k]! })) : [];

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="h-full space-y-5 overflow-y-auto px-5 py-4">
      <header>
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 className="font-display text-3xl">{t.title}</h1>
      </header>

      <section className="card space-y-3" aria-labelledby="measurements-title">
        <div className="flex items-center justify-between">
          <h2 id="measurements-title" className="font-display text-xl">
            {t.measurements}
          </h2>
          <Link to="/onboarding?step=capture" className="btn-ghost min-h-9 px-3 text-xs">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t.remeasure}
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">
            {noneBefore}
            <Link to="/onboarding?step=measurements" className="text-coral-ink underline-offset-2 hover:underline">
              {t.addThem}
            </Link>
            {noneAfter}
          </p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {rows.map(({ key, m }) => {
              const c = confidenceFromSigma(m.sigma);
              const conflict = profile?.conflicts?.includes(key);
              return (
                <li key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{MEASUREMENT_LABELS[key]}</p>
                    <p className="text-xs text-ink-mute">
                      {t.measurementMeta(m.source, pct(c))}
                      {conflict ? ` · ${t.scanTapeDisagree}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg">
                      {Math.round(m.mean * 2) / 2} {units[UNIT[key]]}
                    </p>
                    {conflict ? (
                      <Link to="/onboarding?step=capture" className="text-xs text-coral-ink underline-offset-2 hover:underline">
                        {t.remeasure}
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {profile?.captureQuality !== undefined ? <p className="text-xs text-ink-mute">{t.scanQuality(pct(profile.captureQuality))}</p> : null}
      </section>

      <section className="card space-y-2" aria-labelledby="colour-title">
        <div className="flex items-center justify-between">
          <h2 id="colour-title" className="font-display text-xl">
            {t.colours}
          </h2>
          <EstimateBadge />
        </div>
        {season ? (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">{season.label}</span> · {t.undertoneOf(season.undertone)}
            </p>
            <p className="text-xs text-ink-soft">{season.description}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label={t.palette}>
              {season.palette.map((p) => (
                <li key={p.hex} className="h-6 w-6 rounded-full border border-ink/10" style={{ backgroundColor: p.hex }} title={p.name} />
              ))}
            </ul>
          </div>
        ) : settings.undertone ? (
          <p className="text-sm">{t.undertoneOnly(settings.undertone)}</p>
        ) : (
          <p className="text-sm text-ink-soft">{t.noSeason}</p>
        )}
      </section>

      <section className="card space-y-2" aria-labelledby="taste-title">
        <h2 id="taste-title" className="font-display text-xl">
          {t.styleDna}
        </h2>
        <TasteRadial axes={taste.profile.axes} />
        <p className="text-xs text-ink-mute">{t.refinedBy(taste.profile.swipeCount)}</p>
      </section>

      <section className="card space-y-3" aria-labelledby="consent-title">
        <h2 id="consent-title" className="font-display text-xl">
          {t.renders}
        </h2>
        <div role="radiogroup" aria-label={t.consentLabel} className="space-y-2">
          {(['avatar', 'heroOptIn'] as const).map((tier): { tier: ConsentTier; title: string; text: string } => ({ tier, ...t.consent[tier] })).map((o) => (
            <button key={o.tier} type="button" role="radio" aria-checked={settings.consentTier === o.tier} onClick={() => void setConsent(o.tier)} className={`w-full rounded-2xl border p-3 text-left ${settings.consentTier === o.tier ? 'border-coral bg-coral/10' : 'border-ink/10 bg-white/60'}`}>
              <p className="text-sm font-medium">{o.title}</p>
              <p className="text-xs text-ink-soft">{o.text}</p>
            </button>
          ))}
        </div>
      </section>

      <Ledger lines={ledgerLines(ledger)} compact />
      <p className="flex items-center gap-2 text-xs text-ink-mute">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        {outboxPending > 0 ? t.waitingToSync(outboxPending) : t.allSynced}
        {settings.signatureSyncedAt ? ` ${t.lastSynced(new Date(settings.signatureSyncedAt).toLocaleString())}` : ''}
        {outboxPending > 0 ? (
          <button type="button" className="underline" onClick={() => void flushOutbox()}>
            {t.retryNow}
          </button>
        ) : null}
      </p>

      <section className="card space-y-2" aria-labelledby="data-title">
        <h2 id="data-title" className="font-display text-xl">
          {t.yourData}
        </h2>
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void run(async () => downloadJson(`curtain-export-${Date.now()}.json`, await exportLocal()))}>
          <Download className="h-4 w-4" aria-hidden /> {t.exportAll}
        </button>
        <button type="button" className="btn-ghost w-full" disabled={busy || !profile} onClick={() => setConfirm('scan')}>
          <Trash2 className="h-4 w-4" aria-hidden /> {t.deleteScan}
        </button>
        <button type="button" className="btn-ghost w-full border-bad/30 text-bad" disabled={busy} onClick={() => setConfirm('all')}>
          <Trash2 className="h-4 w-4" aria-hidden /> {t.deleteAll}
        </button>
        {confirm ? (
          <div role="alertdialog" aria-labelledby="confirm-title" className="rounded-2xl border border-bad/30 bg-bad/5 p-3">
            <p id="confirm-title" className="text-sm font-medium">
              {confirm === 'scan' ? t.confirmScan : t.confirmAll}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1 bg-bad"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (confirm === 'scan') await deleteScanLocal();
                    else {
                      await deleteEverything();
                      navigate('/onboarding', { replace: true });
                    }
                  })
                }
              >
                {busy ? t.deleting : t.yesDelete}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setConfirm(null)}>
                {t.cancel}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
