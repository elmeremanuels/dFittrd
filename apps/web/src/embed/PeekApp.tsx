/**
 * The size peek's UI (`/embed/peek`, logic in peek.ts): "Your size: M", one fit note, a thumbnail of
 * the shopper's own figure in that size (labelled an estimate) and a button that asks the SDK to
 * open the full overlay. With no remembered profile it renders nothing and tells the SDK to stay
 * at zero height.
 *
 * The shown peek has one fixed height (`PEEK_HEIGHT`), posted once: every line is clamped to one
 * line and the box clips, so neither the outcome (a size, no size fits, can't recommend yet), the
 * length of the size label nor which note was picked changes what the page can measure, whatever
 * width the page gives the frame (see peek.ts).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AvatarView } from '@/components/AvatarView';
import { loadPeek, PEEK_HEIGHT, type PeekDeps, type PeekParams, type PeekResult } from './peek';
import { postCollapse } from './peekGate';
import { envelope } from './protocol';

type PeekState = { kind: 'loading' } | { kind: 'none' } | { kind: 'shown'; data: PeekResult };

export function PeekApp({ params, deps }: { params: PeekParams | null; deps: PeekDeps }): ReactNode {
  const [state, setState] = useState<PeekState>({ kind: 'loading' });

  // One load per mount, also when StrictMode runs the effect twice: a second run would repeat the lookup.
  const loading = useRef<Promise<PeekResult | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loading.current ??= (params ? loadPeek(params, deps) : Promise.resolve(null)).catch(() => null);
    void loading.current.then((data) => {
      if (!cancelled) setState(data ? { kind: 'shown', data } : { kind: 'none' });
    });
    return () => {
      cancelled = true;
    };
  }, [params, deps]);

  // Nothing to show: collapse. The message holds the height only, so it may go to the parent
  // origin the browser reports without checking the shop's allowed origins.
  useEffect(() => {
    if (state.kind === 'none') postCollapse(deps);
  }, [state.kind, deps]);

  // Shown: the one fixed height, to the shop's own origin only, once. Never measured, never re-posted.
  const target = state.kind === 'shown' ? state.data.targetOrigin : null;
  const postedTo = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!target || !deps.parent || postedTo.current === target) return;
    postedTo.current = target;
    deps.parent.postMessage(envelope({ type: 'curtain:peek-size', height: PEEK_HEIGHT }), target);
  }, [target, deps.parent]);

  if (state.kind !== 'shown') return null;
  const { garment, remembered, embedFit, outcome, targetOrigin } = state.data;
  const open = (): void => deps.parent?.postMessage(envelope({ type: 'curtain:peek-open' }), targetOrigin);
  const size = outcome.kind === 'size' ? outcome.size : null;

  return (
    <div
      className="flex items-center gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-cream p-2 text-ink"
      style={{ height: PEEK_HEIGHT, boxSizing: 'border-box' }}
      data-testid="peek"
      data-outcome={outcome.kind}
    >
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-xl bg-white/70" data-testid="peek-avatar">
        {embedFit ? (
          <AvatarView compact garment={garment} fit={embedFit.fit} size={size} measurements={embedFit.userBody.measurements} heightCm={remembered.profile.measurements.height?.mean} />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm leading-6" data-testid="peek-size">
          {size ? (
            <>
              Your size: <strong className="font-display text-xl leading-6">{size}</strong>
            </>
          ) : outcome.kind === 'none' ? (
            'No size fits well'
          ) : (
            'Can’t recommend a size yet'
          )}
        </p>
        <p className="truncate text-xs leading-5 text-ink-soft" data-testid="peek-note">
          {outcome.note}
        </p>
        <button type="button" onClick={open} className="block max-w-full truncate rounded text-left text-sm font-semibold leading-6 text-coral-ink underline underline-offset-2" data-testid="peek-open">
          {size ? `See how size ${size} fits you` : 'Open the fitting room'}
        </button>
        <p className="truncate text-[11px] leading-4 text-ink-mute">Only you can see this. The shop can’t.</p>
      </div>
    </div>
  );
}
