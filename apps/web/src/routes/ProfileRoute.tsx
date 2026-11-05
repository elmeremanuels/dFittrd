import { Download, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { BODY_MEASUREMENT_KEYS, confidenceFromSigma, type BodyMeasurementKey } from '@paskamer/schema';
import { SEASON_TABLE, isSeason } from '@paskamer/taste-engine';
import { MEASUREMENT_LABELS } from '@/features/capture';
import { EstimateBadge } from '@/components/EstimateBadge';
import { Ledger, type LedgerLine } from '@/components/Ledger';
import { TasteRadial } from '@/components/TasteRadial';
import { downloadJson } from '@/platform/download';
import { pct } from '@/lib/format';
import { type ClientLedgerEntry, type ConsentTier } from '@/db/db';
import { useApp } from '@/store';

const UNIT: Record<BodyMeasurementKey, string> = { bust: 'cm', waist: 'cm', hip: 'cm', shoulder: 'cm', thigh: 'cm', inseam: 'cm', foot: 'cm', footLengthCm: 'cm', footEu: 'EU', height: 'cm', weight: 'kg' };

const KIND_TITLE: Record<ClientLedgerEntry['kind'], string> = {
  signature_sync: 'Fit signature synced',
  swipe_batch: 'Swipes synced',
  wardrobe_sync: 'Wardrobe synced',
  hero_render: 'Hero render requested',
  pairing: 'Shop pairing',
  erase: 'Erase request',
  device: 'Anonymous device registered',
  export: 'Export requested',
};

export function ledgerLines(entries: ClientLedgerEntry[]): LedgerLine[] {
  return entries.map((e) => ({
    id: e.id,
    at: e.at,
    title: KIND_TITLE[e.kind],
    detail: `${e.method} ${e.path}`,
    fields: e.fields,
    bytes: e.bytes,
    status: e.status === 'failed' ? 'failed (will retry)' : `HTTP ${e.status}`,
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
        <p className="eyebrow">Profile</p>
        <h1 className="font-display text-3xl">You, on this device</h1>
      </header>

      <section className="card space-y-3" aria-labelledby="measurements-title">
        <div className="flex items-center justify-between">
          <h2 id="measurements-title" className="font-display text-xl">
            Measurements
          </h2>
          <Link to="/onboarding?step=capture" className="btn-ghost min-h-9 px-3 text-xs">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Remeasure
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No measurements yet.{' '}
            <Link to="/onboarding?step=measurements" className="text-coral-ink underline-offset-2 hover:underline">
              Add them
            </Link>{' '}
            to see fit.
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
                      {m.source} · confidence {pct(c)}
                      {conflict ? ' · scan and tape disagree' : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg">
                      {Math.round(m.mean * 2) / 2} {UNIT[key]}
                    </p>
                    {conflict ? (
                      <Link to="/onboarding?step=capture" className="text-xs text-coral-ink underline-offset-2 hover:underline">
                        Remeasure
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {profile?.captureQuality !== undefined ? <p className="text-xs text-ink-mute">Scan quality {pct(profile.captureQuality)}.</p> : null}
      </section>

      <section className="card space-y-2" aria-labelledby="colour-title">
        <div className="flex items-center justify-between">
          <h2 id="colour-title" className="font-display text-xl">
            Your colours
          </h2>
          <EstimateBadge />
        </div>
        {season ? (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">{season.label}</span> · {season.undertone} undertone
            </p>
            <p className="text-xs text-ink-soft">{season.description}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Palette">
              {season.palette.map((p) => (
                <li key={p.hex} className="h-6 w-6 rounded-full border border-ink/10" style={{ backgroundColor: p.hex }} title={p.name} />
              ))}
            </ul>
          </div>
        ) : settings.undertone ? (
          <p className="text-sm">Undertone: {settings.undertone} (estimate from your face photo).</p>
        ) : (
          <p className="text-sm text-ink-soft">Take the face photo in the capture step to get a season estimate for colour matching.</p>
        )}
      </section>

      <section className="card space-y-2" aria-labelledby="taste-title">
        <h2 id="taste-title" className="font-display text-xl">
          Style DNA
        </h2>
        <TasteRadial axes={taste.profile.axes} />
        <p className="text-xs text-ink-mute">Refined by {taste.profile.swipeCount} swipes.</p>
      </section>

      <section className="card space-y-3" aria-labelledby="consent-title">
        <h2 id="consent-title" className="font-display text-xl">
          Renders
        </h2>
        <div role="radiogroup" aria-label="Render consent" className="space-y-2">
          {(
            [
              { tier: 'avatar', title: 'On-device only (default)', text: 'Every look is drawn on this phone from your measurements and the shop’s garment data. Nothing is uploaded.' },
              { tier: 'heroOptIn', title: 'Hero render (opt-in)', text: 'For a share-worthy picture we send an anonymised avatar render (base frame with your face removed) plus the flat-lay to an AI provider. Never a raw photo. Deleted within 24 h and listed in your ledger with provider and model.' },
            ] as { tier: ConsentTier; title: string; text: string }[]
          ).map((o) => (
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
        {outboxPending > 0 ? `${outboxPending} item${outboxPending === 1 ? '' : 's'} waiting to sync (offline-safe).` : 'Everything is synced.'}
        {settings.signatureSyncedAt ? ` Fit signature last synced ${new Date(settings.signatureSyncedAt).toLocaleString()}.` : ''}
        {outboxPending > 0 ? (
          <button type="button" className="underline" onClick={() => void flushOutbox()}>
            Retry now
          </button>
        ) : null}
      </p>

      <section className="card space-y-2" aria-labelledby="data-title">
        <h2 id="data-title" className="font-display text-xl">
          Your data
        </h2>
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void run(async () => downloadJson(`paskamer-export-${Date.now()}.json`, await exportLocal()))}>
          <Download className="h-4 w-4" aria-hidden /> Export everything (JSON)
        </button>
        <button type="button" className="btn-ghost w-full" disabled={busy || !profile} onClick={() => setConfirm('scan')}>
          <Trash2 className="h-4 w-4" aria-hidden /> Delete my scan
        </button>
        <button type="button" className="btn-ghost w-full border-bad/30 text-bad" disabled={busy} onClick={() => setConfirm('all')}>
          <Trash2 className="h-4 w-4" aria-hidden /> Delete everything
        </button>
        {confirm ? (
          <div role="alertdialog" aria-labelledby="confirm-title" className="rounded-2xl border border-bad/30 bg-bad/5 p-3">
            <p id="confirm-title" className="text-sm font-medium">
              {confirm === 'scan' ? 'Delete the scan, base frame, face tile and measurements from this device?' : 'Delete everything on this device and ask the server to erase your pseudonymous account (DELETE /v1/me)?'}
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
                {busy ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
