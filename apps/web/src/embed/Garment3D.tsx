/**
 * "See it in 3D (estimate)" (docs/ENGINE-HANDOFF.md §On-device fitting, D16): the product's
 * approved garment bundle draped on a model built from the shopper's own girths, in this iframe.
 *
 * - Shown only when `GET /v1/try` sent an asset ref (the shop has the 3D estimate on, the merchant
 *   approved the bundle and it covers the live chart), WebGL2 is available and the shop is not paused.
 * - Nothing is fetched or imported before the click; then the viewer chunk is loaded with
 *   `import()` and the bundle files are GET from `asset.baseUrl`. Nothing about the body goes up (D3).
 * - The view takes the embed's own FitResult and size; it never computes a fit (rule 4, D15).
 * - Always labelled an estimate (rule 3). On any error it closes and the 2D figure above stays.
 */
import { Box, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FitResult } from '@curtain/fit-engine';
import type * as GarmentViewer from '@curtain/garment-viewer';
import type { GarmentAssetRef, GarmentPayload, UserBody } from '@curtain/schema';
import { EstimateBadge } from '@/components/EstimateBadge';

type ViewerModule = typeof GarmentViewer;
type View = Awaited<ReturnType<ViewerModule['mountGarmentView']>>;

/** WebGL2 on a throwaway canvas (the viewer chunk is not loaded for this check). */
export function hasWebGL2(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

export interface Garment3DProps {
  asset: GarmentAssetRef | null | undefined;
  paused: boolean;
  garment: GarmentPayload;
  fit: FitResult;
  /** The size on screen (ResultScreen's `selected`). */
  size: string;
  /** The size the advice picked (null when nothing fits well). */
  recommended: string | null;
  measurements: UserBody['measurements'];
  onSelect: (size: string) => void;
  /** Tests inject these; the app uses the real chunk and the real check. */
  loadViewer?: () => Promise<ViewerModule>;
  webgl2?: () => boolean;
}

type Phase = 'idle' | 'loading' | 'draping' | 'settled' | 'failed';

export function Garment3D({ asset, paused, garment, fit, size, recommended, measurements, onSelect, loadViewer = () => import('@curtain/garment-viewer'), webgl2 = hasWebGL2 }: Garment3DProps): ReactNode {
  const [supported] = useState(() => !!asset && webgl2());
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef(size);

  useEffect(() => {
    if (!open || !asset) return;
    let cancelled = false;
    void (async () => {
      try {
        const mod = await loadViewer();
        if (cancelled || !canvasRef.current) return;
        const view = await mod.mountGarmentView(canvasRef.current, {
          baseUrl: asset.baseUrl,
          garment,
          fit,
          size: sizeRef.current,
          body: { bust: measurements.bust, waist: measurements.waist, hip: measurements.hip },
          onState: (s) => {
            if (!cancelled) setPhase(s === 'error' ? 'failed' : s);
          },
        });
        if (cancelled) view.dispose();
        else viewRef.current = view;
      } catch {
        if (!cancelled) setPhase('failed');
      }
    })();
    return () => {
      cancelled = true;
      viewRef.current?.dispose();
      viewRef.current = null;
    };
    // The bundle, garment, fit and body are fixed for one open; size changes go through setSize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset?.baseUrl]);

  useEffect(() => {
    sizeRef.current = size;
    viewRef.current?.setSize(size);
  }, [size]);

  if (!asset || paused || !supported) return null;
  const sizes = asset.sizes;

  if (!open)
    return (
      <section className="mt-4" aria-label="3D estimate">
        <button type="button" className="chip w-full justify-center py-2.5 text-sm hover:bg-white" onClick={() => {
            setPhase('loading');
            setOpen(true);
          }}
          data-testid="garment3d-open"
        >
          <Box className="h-4 w-4" aria-hidden /> See it in 3D (estimate)
        </button>
      </section>
    );

  return (
    <section className="mt-4 rounded-2xl border border-line bg-white/60 p-3" aria-label="3D estimate" data-testid="garment3d">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">3D estimate · size {size}</h3>
        <button type="button" className="chip px-2 py-1 text-xs" onClick={() => setOpen(false)} aria-label="Close the 3D view">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {phase === 'failed' ? (
        <p className="mt-2 text-sm text-ink-soft" role="status" data-testid="garment3d-failed">
          The 3D view isn’t available on this device. The figure above shows how size {size} fits.
        </p>
      ) : (
        <div className="relative mt-2 aspect-[3/4] w-full overflow-hidden rounded-xl bg-cream">
          <canvas ref={canvasRef} className="h-full w-full touch-none" data-testid="garment3d-canvas" aria-label={`3D estimate of size ${size} on a model with your measurements`} />
          {phase === 'loading' || phase === 'draping' ? (
            <span className="chip pointer-events-none absolute top-2 left-2 bg-white/90 text-xs" role="status">
              {phase === 'loading' ? 'Loading…' : 'Draping…'}
            </span>
          ) : null}
          <EstimateBadge className="pointer-events-none absolute bottom-2 left-2 text-[10px]" />
        </div>
      )}
      {sizes.length > 1 && phase !== 'failed' ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Size in 3D">
          {sizes.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={s === size} className={`chip min-h-8 px-2.5 text-xs ${s === size ? 'border-ink bg-ink text-white' : ''}`} onClick={() => onSelect(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-xs leading-snug text-ink-mute" data-testid="garment3d-label">
        3D estimate on a model with your measurements, not a photo.{' '}
        {recommended ? `Size ${recommended} was picked by the size advice.` : 'No size fits well; the size advice decides, not this picture.'}
        {recommended && recommended !== size ? ` You are looking at size ${size}.` : ''}
      </p>
    </section>
  );
}
