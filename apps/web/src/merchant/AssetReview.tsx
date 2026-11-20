/**
 * The merchant's review of a product's 3D estimate versions (D13: the merchant approves every asset). For a server drape
 * bake it shows the import's automatic bake check (`qa.bakeCheck`: every check, passed or failed with its reason), and
 * the tape each size is built from with its provenance (measured / estimated / rough estimate), next to what the 3D
 * drape measured at the hip line and the hem. No shopper data is involved anywhere.
 */
import { ArrowLeft, Check, CircleSlash, Minus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { BakeCheckReport, GarmentAssetStatus, MerchantGarmentAsset } from '@curtain/schema';
import { api } from '@/store';
import { readMerchantKey, useMerchantData } from './MerchantConsole';
import { mockAssets } from './mock';
import { merchantStrings } from './strings';

const STATUS_CLASS: Record<GarmentAssetStatus, string> = {
  awaiting_approval: 'border-warn/30 bg-warn/10 text-warn',
  approved: 'border-ok/30 bg-ok/10 text-ok',
  rejected: 'border-bad/30 bg-bad/10 text-bad',
  superseded: '',
  refused: 'border-bad/30 bg-bad/10 text-bad',
};
const PROVENANCE_CLASS = { measured: 'border-ok/30 bg-ok/10 text-ok', interpolated: 'border-warn/30 bg-warn/10 text-warn', extrapolated: 'border-bad/30 bg-bad/10 text-bad' } as const;

const day = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function MerchantAssetReview(): ReactNode {
  const t = merchantStrings().assets;
  const { externalId = '' } = useParams();
  const d = useMerchantData();
  const product = d.products.items.find((p) => p.externalId === externalId);
  // Demo data (api unreachable) is there at once; the live list loads below.
  const [assets, setAssets] = useState<MerchantGarmentAsset[] | null>(() => (d.mode === 'mock' ? mockAssets(externalId) : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = readMerchantKey();
    if (d.mode === 'mock' || !key) return;
    api
      .merchant(key)
      .assets(externalId)
      .then((r) => !cancelled && setAssets(r.assets))
      .catch(() => !cancelled && setError(t.loadFailed));
    return () => {
      cancelled = true;
    };
  }, [d.mode, externalId, t.loadFailed]);

  const act = async (asset: MerchantGarmentAsset, action: { approve: true } | { reason: string }): Promise<void> => {
    if (d.mode === 'mock') {
      // Demo data: the same transitions the api makes, kept in this tab only.
      setAssets((list) =>
        (list ?? []).map((a) => {
          if (a.id === asset.id) return 'approve' in action ? { ...a, status: 'approved', live: true, approvedAt: new Date().toISOString() } : { ...a, status: 'rejected', live: false, rejectReason: action.reason };
          return 'approve' in action && a.status === 'approved' ? { ...a, status: 'superseded', live: false } : a;
        }),
      );
      return;
    }
    const m = api.merchant(readMerchantKey() ?? '');
    const r = 'approve' in action ? await m.approveAsset(asset.id) : await m.rejectAsset(asset.id, action.reason);
    setAssets(await m.assets(externalId).then((x) => x.assets, () => (assets ?? []).map((a) => (a.id === r.asset.id ? r.asset : a))));
  };

  return (
    <section className="space-y-4" aria-labelledby="asset-review-title">
      <Link to="/merchant/products" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t.back}
      </Link>
      <header className="space-y-1">
        <h2 id="asset-review-title" className="font-display text-2xl">
          {t.title(product?.name ?? externalId)}
        </h2>
        <p className="max-w-2xl text-sm text-ink-soft">{t.intro}</p>
      </header>
      {error ? (
        <p role="alert" className="card text-sm text-bad">
          {error}
        </p>
      ) : !assets ? (
        <p className="text-sm text-ink-soft" role="status">
          {t.loading}
        </p>
      ) : assets.length === 0 ? (
        <p className="card text-sm text-ink-soft">{t.none}</p>
      ) : (
        <ul className="space-y-4">
          {assets.map((a) => (
            <li key={a.id}>
              <AssetCard asset={a} onAct={act} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssetCard({ asset, onAct }: { asset: MerchantGarmentAsset; onAct: (a: MerchantGarmentAsset, action: { approve: true } | { reason: string }) => Promise<void> }): ReactNode {
  const t = merchantStrings().assets;
  const report = asset.bakeCheck;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (action: { approve: true } | { reason: string }): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      await onAct(asset, action);
      setRejecting(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  // A version that passed the check carries no flag; the notes of an older import stay in front of the merchant.
  const notes = asset.qaNotes ?? [];
  return (
    <article className="card space-y-4 bg-white/80" data-testid={`asset-${asset.status}`} aria-label={t.version(asset.version, (asset.bytes / 1048576).toFixed(2), day(asset.createdAt))}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-ink-mute">{t.version(asset.version, (asset.bytes / 1048576).toFixed(2), day(asset.createdAt))}</p>
          <p className="mt-0.5 text-xs text-ink-soft">{t.estimate}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className={`chip ${STATUS_CLASS[asset.status]}`} data-testid="asset-status">
            {t.status[asset.status]}
          </span>
          {asset.live ? <span className="chip border-ok/30 bg-ok/10 text-ok">{t.live}</span> : null}
        </div>
      </header>

      {asset.status === 'rejected' && asset.rejectReason ? <p className="text-sm text-bad">{t.rejected(asset.rejectReason)}</p> : null}

      {report ? <CheckList report={report} awaiting={asset.status === 'awaiting_approval'} /> : <p className="text-sm text-ink-soft">{t.check.notRun}</p>}

      {notes.length > 0 && asset.status !== 'refused' ? (
        <section className="rounded-2xl border border-warn/30 bg-warn/10 p-3" aria-label={t.flags.title}>
          <h3 className="eyebrow text-warn">{t.flags.title}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report?.tape ? <TapeTable report={report} /> : null}

      {asset.status === 'awaiting_approval' ? (
        rejecting ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim()) void run({ reason: reason.trim() });
            }}
          >
            <label htmlFor={`reason-${asset.id}`} className="eyebrow block">
              {t.actions.reasonLabel}
            </label>
            <input id={`reason-${asset.id}`} className="field-input w-full font-sans text-base" value={reason} maxLength={500} placeholder={t.actions.reasonPlaceholder} onChange={(e) => setReason(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-ghost border-bad/40 text-bad" disabled={busy || !reason.trim()}>
                {busy ? t.actions.working : t.actions.confirmReject}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setRejecting(false)}>
                {t.actions.cancel}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void run({ approve: true })} data-testid="approve">
              {busy ? t.actions.working : t.actions.approve}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setRejecting(true)}>
              {t.actions.reject}
            </button>
          </div>
        )
      ) : asset.status === 'refused' ? (
        <p className="text-xs text-ink-mute">{t.actions.refusedHelp}</p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-xs text-bad">
          {t.actions.failed}
        </p>
      ) : null}
    </article>
  );
}

function CheckList({ report, awaiting }: { report: BakeCheckReport; awaiting: boolean }): ReactNode {
  const t = merchantStrings().assets.check;
  return (
    <section className="space-y-2" aria-labelledby={`check-${report.checkedAt}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`check-${report.checkedAt}`} className="eyebrow">
          {t.title}
        </h3>
        <span className="text-xs text-ink-mute">{t.checked(day(report.checkedAt))}</span>
      </div>
      <p className={`text-sm font-medium ${report.pass ? 'text-ok' : 'text-bad'}`} data-testid="check-summary">
        {report.pass ? (awaiting ? t.passed : t.passedDone) : t.refused}
      </p>
      <ul className="divide-y divide-ink/5 rounded-2xl border border-ink/10 bg-white/60" data-testid="check-list">
        {report.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 px-3 py-2 text-sm">
            {c.pass === true ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label={t.passMark} />
            ) : c.pass === false ? (
              <X className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-label={t.failMark} />
            ) : (
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-ink-mute" aria-label={t.notRunMark} />
            )}
            <span className="min-w-0">
              <span className={c.pass === false ? 'font-medium text-bad' : c.pass === null ? 'text-ink-mute' : ''}>{t.titles[c.id]}</span>
              {c.pass === false
                ? c.reasons.map((r) => (
                    <span key={r} className="block text-xs text-ink-soft">
                      {t.reason(r)}
                    </span>
                  ))
                : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TapeTable({ report }: { report: BakeCheckReport }): ReactNode {
  const t = merchantStrings().assets.tape;
  const tape = report.tape!;
  const range = (size: string, key: 'hipRingCm' | 'hemRingCm'): [number, number] | null => {
    const v = report.drapes.filter((x) => x.size === size).map((x) => x[key]);
    return v.length ? [Math.min(...v), Math.max(...v)] : null;
  };
  const estimated = tape.sizes.some((s) => s.provenance !== 'measured');
  return (
    <section className="space-y-2" aria-labelledby={`tape-${report.checkedAt}`}>
      <h3 id={`tape-${report.checkedAt}`} className="eyebrow">
        {t.title}
      </h3>
      <p className="text-xs text-ink-soft">{t.intro}</p>
      <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-white/60">
        <table className="w-full text-sm" data-testid="tape-table">
          <thead className="text-left text-[11px] tracking-wider text-ink-mute uppercase">
            <tr>
              <th className="px-2 py-2 sm:px-3">{t.size}</th>
              <th className="hidden px-3 py-2 sm:table-cell">{t.source}</th>
              <th className="px-2 py-2 text-right sm:px-3">{t.hip}</th>
              <th className="px-2 py-2 text-right sm:px-3">{t.hem}</th>
              <th className="hidden px-3 py-2 text-right sm:table-cell">{t.band}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/5">
            {tape.sizes.map((s) => {
              const hip = range(s.size, 'hipRingCm');
              const hem = range(s.size, 'hemRingCm');
              return (
                <tr key={s.size} data-testid={`tape-row-${s.size}`}>
                  <td className="px-2 py-2 font-medium sm:px-3">
                    {s.size}
                    {/* narrow screens: the provenance under the size, so hip and hem fit beside it */}
                    <span className={`chip mt-1 block w-fit px-1.5 py-0 text-[11px] font-normal sm:hidden ${PROVENANCE_CLASS[s.provenance]}`}>{t.provenance[s.provenance]}</span>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <span className={`chip px-2 py-0.5 text-xs ${PROVENANCE_CLASS[s.provenance]}`}>{t.provenance[s.provenance]}</span>
                    <span className="block text-[11px] text-ink-mute">{t.provenanceNote[s.provenance]}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                    {s.hipCm}
                    {hip ? <span className="block text-[11px] whitespace-nowrap text-ink-mute">{t.drapedRange(hip[0], hip[1])}</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                    {s.hemSweepCm}
                    {hem ? <span className="block text-[11px] whitespace-nowrap text-ink-mute">{t.drapedRange(hem[0], hem[1])}</span> : null}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{s.stretchedGirthCm ?? t.none}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-mute">{t.draped}</p>
      <p className="text-xs text-ink-mute">{t.hipAt(tape.hipBelowBandCm)}</p>
      {tape.sizes.flatMap((s) =>
        s.notDraped.map((n) => (
          <p key={`${s.size}-${n.bodyHipCm}`} className="flex items-start gap-1.5 text-xs text-ink-soft">
            <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {t.notDrawn(s.size, t.cm(n.bodyHipCm), n.reason)}
          </p>
        )),
      )}
      {estimated ? <p className="text-xs text-ink-soft">{t.measureMore}</p> : null}
    </section>
  );
}
