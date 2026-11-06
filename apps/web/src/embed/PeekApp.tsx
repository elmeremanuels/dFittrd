/**
 * The size peek's UI (`/embed/peek`, logic in peek.ts): "Your size: M", one fit note, a thumbnail of
 * the shopper's own figure in that size (labelled an estimate) and a button that asks the SDK to
 * open the full overlay. With no remembered profile it renders nothing and tells the SDK to stay
 * at zero height.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AvatarView } from '@/components/AvatarView';
import { loadPeek, type PeekDeps, type PeekParams, type PeekResult } from './peek';
import { postCollapse } from './peekGate';
import { envelope } from './protocol';

type PeekState = { kind: 'loading' } | { kind: 'none' } | { kind: 'shown'; data: PeekResult };

export function PeekApp({ params, deps }: { params: PeekParams | null; deps: PeekDeps }): ReactNode {
  const [state, setState] = useState<PeekState>({ kind: 'loading' });
  const rootRef = useRef<HTMLDivElement | null>(null);

  // One load per mount, also when StrictMode runs the effect twice: a second run would mint a
  // second session.
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

  // Shown: report the rendered height (to the shop's own origin only), again whenever it changes.
  const target = state.kind === 'shown' ? state.data.targetOrigin : null;
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!target || !el || !deps.parent) return;
    const parent = deps.parent;
    let last = -1;
    const post = (): void => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      parent.postMessage(envelope({ type: 'curtain:peek-size', height }), target);
    };
    post();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(post);
    ro.observe(el);
    return () => ro.disconnect();
  }, [target, deps.parent]);

  if (state.kind !== 'shown') return null;
  const { garment, remembered, embedFit, advice, note, targetOrigin } = state.data;
  const size = advice.size;
  const open = (): void => deps.parent?.postMessage(envelope({ type: 'curtain:peek-open' }), targetOrigin);

  return (
    <div ref={rootRef} className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-cream p-2 text-ink" data-testid="peek">
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-xl bg-white/70" data-testid="peek-avatar">
        <AvatarView compact garment={garment} fit={embedFit.fit} size={size} measurements={embedFit.userBody.measurements} heightCm={remembered.profile.measurements.height?.mean} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-tight" data-testid="peek-size">
          Your size: <strong className="font-display text-xl">{size}</strong>
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{note}</p>
        <button type="button" onClick={open} className="mt-1 rounded text-sm font-semibold text-coral-ink underline underline-offset-2" data-testid="peek-open">
          See how size {size} fits you
        </button>
        <p className="text-[11px] leading-tight text-ink-mute">Only you can see this. The shop can’t.</p>
      </div>
    </div>
  );
}
