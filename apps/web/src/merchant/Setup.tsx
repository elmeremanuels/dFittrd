/**
 * The merchant console's first-run checklist and "Leaving Curtain" panel. The steps and the leaving lines come from
 * @curtain/schema `merchantSetup.ts` (one English catalogue, D21), the same list the Shopify admin shows; the
 * console's own lines around them are in `strings.ts`.
 */
import { Check, QrCode } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MERCHANT_SETUP_TEXT, merchantPlanText, type SetupResponse } from '@curtain/schema';
import { merchantStrings } from './strings';

/** Where each step's button goes inside the console (the platform screens are named in the step's words). */
const TARGET_ROUTE: Record<string, string> = { charts: '/merchant/products', measure: '/merchant/products?next=measure', theme: '/merchant/products', connect: '/merchant/login' };

export function SetupChecklist({ setup, onConfirm, live }: { setup: SetupResponse; onConfirm: (body: { buttonConfirmed?: boolean; phoneConfirmed?: boolean }) => Promise<void>; live: boolean }): ReactNode {
  const t = merchantStrings().setup;
  const [showCode, setShowCode] = useState(setup.next === 'phone');
  const [busy, setBusy] = useState(false);
  const pct = Math.round((100 * setup.doneCount) / setup.total);
  const confirm = async (key: string): Promise<void> => {
    setBusy(true);
    try {
      await onConfirm(key === 'button' ? { buttonConfirmed: true } : { phoneConfirmed: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card space-y-3 bg-white/80" aria-labelledby="setup-heading" data-testid="setup-checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup-heading" className="font-display text-2xl">
          {MERCHANT_SETUP_TEXT.heading}
        </h2>
        <p className="text-sm font-semibold" role="status" aria-live="polite" data-testid="setup-progress">
          {setup.headline}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/10" aria-hidden>
        <div className="h-full rounded-full bg-coral" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-ink-soft">{MERCHANT_SETUP_TEXT.intro}</p>
      <ol className="divide-y divide-ink/10">
        {setup.steps.map((s) => {
          const current = s.key === setup.next;
          return (
            <li key={s.key} data-step={s.key} aria-current={current ? 'step' : undefined} className={`flex gap-3 py-3 ${current ? '-mx-3 rounded-2xl bg-coral/5 px-3' : ''}`}>
              <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold ${s.done ? 'border-ok bg-ok text-white' : 'border-ink/30'}`} aria-hidden>
                {s.done ? <Check className="h-4 w-4" /> : s.number}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">
                  {t.stepTitle(s.number, s.title)}
                  <span className="sr-only">{s.done ? t.done : t.todo}</span>
                  {!s.done ? <span className="text-xs font-normal text-ink-mute">{t.minutes(s.minutes)}</span> : null}
                </p>
                <p className="text-sm text-ink-soft">{s.detail}</p>
                {!s.done && (s.action || s.confirmLabel) ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {s.action?.target === 'phone' ? (
                      <button type="button" className={current ? 'btn-primary min-h-9 px-4 text-sm' : 'btn-ghost min-h-9 px-4 text-sm'} onClick={() => setShowCode((v) => !v)}>
                        <QrCode className="h-4 w-4" aria-hidden /> {s.action.label}
                      </button>
                    ) : s.action && s.action.target !== 'connect' ? (
                      <Link to={TARGET_ROUTE[s.action.target] ?? '/merchant'} className={current ? 'btn-primary min-h-9 px-4 text-sm' : 'btn-ghost min-h-9 px-4 text-sm'}>
                        {s.action.target === 'theme' && setup.platform === 'woocommerce' ? t.seeProducts : s.action.label}
                      </Link>
                    ) : null}
                    {s.confirmLabel && live ? (
                      <button type="button" className="btn-ghost min-h-9 px-4 text-sm" disabled={busy} onClick={() => void confirm(s.key)}>
                        {s.confirmLabel}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {s.key === 'phone' && showCode && !s.done ? (
                  setup.phoneCheck ? (
                    <div className="mt-2 flex flex-wrap items-center gap-4 rounded-2xl border border-ink/10 bg-white p-3" data-testid="phone-check">
                      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.phoneCheck.qrSvg)}`} alt={t.codeAlt(setup.phoneCheck.name)} width={144} height={144} className="rounded-lg bg-white" />
                      <div className="min-w-0 flex-1 space-y-2 text-sm">
                        <p className="font-medium">{setup.phoneCheck.name}</p>
                        <p className="text-ink-soft">{t.phoneHelp}</p>
                        <a className="btn-ghost min-h-9 px-4 text-sm" href={setup.phoneCheck.url} target="_blank" rel="noopener noreferrer">
                          {t.openProduct}
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-mute">{t.noCode}</p>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** How to leave, and what happens to the data (plain words; no shopper data was ever held). */
export function LeavingCurtain({ platform }: { platform: SetupResponse['platform'] }): ReactNode {
  const t = merchantPlanText(platform);
  return (
    <details className="card bg-white/80" data-testid="leaving">
      <summary className="cursor-pointer font-display text-xl">{t.leaving.heading}</summary>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
        {t.leaving.steps.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ol>
      <p className="mt-3 text-sm font-medium">{merchantStrings().setup.yourData}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">
        {t.leaving.data.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </details>
  );
}
