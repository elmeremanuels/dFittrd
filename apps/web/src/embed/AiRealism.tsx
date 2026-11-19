/**
 * "AI-enhanced estimate" (D22): next to the 3D view, only when the server flag is on (`aiRealism` in
 * GET /v1/try). The shopper agrees first; then the 3D view exports its render passes (never a photo,
 * never the face texture), the server makes the picture and checks it against the 3D estimate, and
 * this panel shows it, always under the "AI-enhanced estimate" label, or says why it was not shown.
 */
import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ESTIMATE_DISCLAIMER, type RealismRequest, type RealismResponse } from '@curtain/schema';
import { realismRequest, type ExportedPasses, type PngEncoder } from './realism';
import { embedStrings } from './strings';

export function AiEstimateLabel({ className = '' }: { className?: string }): ReactNode {
  return (
    <span className={`chip bg-ink/85 text-cream shadow ${className}`} title={ESTIMATE_DISCLAIMER} data-testid="ai-estimate-label">
      <Sparkles className="h-3 w-3" aria-hidden /> {embedStrings().realism.label}
    </span>
  );
}

type State = { s: 'idle' } | { s: 'working' } | { s: 'done'; res: Extract<RealismResponse, { status: 'ok' }> } | { s: 'refused'; reasons: string[] } | { s: 'failed' };

export interface AiRealismProps {
  garmentName: string;
  size: string;
  ids: { productId: string; shopId: string };
  /** The mounted 3D view's export (null: not ready). */
  exportPasses: () => ExportedPasses | null;
  request: (req: RealismRequest) => Promise<RealismResponse>;
  encode?: PngEncoder;
}

/** A picture is for one size: the host keys the panel by size, so a size change starts it afresh. */
export function AiRealismPanel({ garmentName, size, ids, exportPasses, request, encode }: AiRealismProps): ReactNode {
  const t = embedStrings().realism;
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ s: 'idle' });
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const start = async (): Promise<void> => {
    const passes = exportPasses();
    if (!passes) return setState({ s: 'failed' });
    setState({ s: 'working' });
    try {
      const res = await request(realismRequest(passes, ids, encode));
      if (!alive.current) return;
      setState(res.status === 'ok' ? { s: 'done', res } : { s: 'refused', reasons: res.reasons });
    } catch {
      if (alive.current) setState({ s: 'failed' });
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-line bg-white/70 p-2.5" data-testid="ai-realism">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t.title}</h4>
        {/* The label is there in every state, not only on the picture. */}
        <AiEstimateLabel className="text-[10px]" />
      </div>
      {state.s === 'done' ? (
        <figure className="relative mt-2 overflow-hidden rounded-lg bg-cream">
          <img src={`data:image/png;base64,${state.res.imageBase64}`} alt={t.alt(garmentName, size)} className="w-full" data-testid="ai-realism-image" />
          <AiEstimateLabel className="pointer-events-none absolute top-2 left-2 text-[10px]" />
          <figcaption className="mt-1.5 text-[11px] leading-snug text-ink-mute">
            {t.caption} {ESTIMATE_DISCLAIMER}
          </figcaption>
        </figure>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-soft">{t.explain}</p>
          <label className="mt-1.5 flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="ai-realism-consent" />
            <span>{t.consent}</span>
          </label>
          <button type="button" className="btn-ghost mt-2 w-full text-sm" disabled={!consent || state.s === 'working'} onClick={() => void start()} data-testid="ai-realism-start">
            {state.s === 'working' ? t.working : t.start(size)}
          </button>
          {state.s === 'refused' ? (
            <p role="status" className="mt-1.5 text-xs text-coral-ink" data-testid="ai-realism-refused">
              {t.refused} {state.reasons.map((r) => t.reason(r)).join(' ')}
            </p>
          ) : null}
          {state.s === 'failed' ? (
            <p role="alert" className="mt-1.5 text-xs text-coral-ink">
              {t.failed}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
