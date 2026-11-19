/**
 * "See it in 3D (estimate)" (docs/ENGINE-HANDOFF.md §On-device fitting, D16): the product's
 * approved garment bundle draped on a model built from the shopper's own girths, in this iframe.
 *
 * - Shown only when `GET /v1/try` sent an asset ref (the shop has the 3D estimate on, the merchant
 *   approved the bundle and it covers the live chart), WebGL2 is available and the shop is not paused.
 * - Nothing is fetched or imported before the click; then the viewer chunk is loaded with
 *   `import()` and the bundle files are GET from `asset.baseUrl`. Nothing about the body goes up (D3).
 * - The view takes the embed's own FitResult and size; it never computes a fit (rule 4, D15).
 * - The skin colour the shopper picked in the avatar prompt goes to the viewer as an in-memory
 *   value (`MountOptions.look.skinHex`, then `view.setLook`). A viewer that does not know these
 *   options yet ignores them; `setLook` is called only when the mounted view has it.
 * - `MountOptions.body` is the three girths, as before, for every product that is not a men's
 *   product: the 3D view of a women's garment is the same with or without the avatar slices. Only
 *   a men's garment adds `family: 'male'` and `heightCm` (packages/mannequin README, `BodyInput`):
 *   the typed body of the viewer moves the garment and has known limits, so it is not switched on
 *   for everybody by a side door. A men's garment on a bundle draped on the female body (or the
 *   reverse) is refused by the viewer (`incompatible`), which a `required` view turns into "coming
 *   soon" (D20 point 3); since slice M1 a male-built bundle mounts on the male body.
 * - Always labelled an estimate (rule 3). On any error it closes and the 2D figure above stays.
 * - `required` (a men's product, D20 point 3: never a 2D figure only): the view opens by itself,
 *   cannot be closed and reports `settled` or `failed`; the embed shows nothing of the result until
 *   it has settled and replaces it by "Men's clothing: coming soon" when it fails. A view that has
 *   not settled within `REQUIRED_3D_TIMEOUT_MS` (a chunk or bundle that never arrives, a viewer
 *   that never reports) counts as failed, so the shopper is never left on the loading screen.
 * - Lighting and head (the look review of 18 Nov 2026): `classic` and the viewer's default head,
 *   today's look, unless the build sets `VITE_VIEWER_LIGHTING` (`neutral`, `neutral-v2`) or
 *   `VITE_VIEWER_HEAD` (`neutral-v2`, `neutral-v3`). Nothing is sent to the viewer for the defaults, so a viewer
 *   that does not know the options gets the same options as before.
 */
import { Box, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FitResult } from '@curtain/fit-engine';
import type * as GarmentViewer from '@curtain/garment-viewer';
import { garmentBodyFamily, type GarmentAssetRef, type GarmentPayload, type UserBody } from '@curtain/schema';
import { EstimateBadge } from '@/components/EstimateBadge';
import { ringInputsFor } from '@/render/ringInputs';
import { ringOverlayFor } from '@/render/rings';
import { embedStrings, type EmbedCatalogue } from './strings';
import { lengthText, type Units } from './units';

type ViewerModule = typeof GarmentViewer;
type BaseView = Awaited<ReturnType<ViewerModule['mountGarmentView']>>;
type BaseMountOptions = Parameters<ViewerModule['mountGarmentView']>[1];

/** The avatar's look as the viewer takes it (docs/research/photo-avatar-plan.md slice 1). In memory only. */
export interface ViewerLook {
  skinHex?: string | undefined;
  /** Only `neutral-v2` or `neutral-v3` is ever sent (the look reviews); absent: the viewer's default head. */
  head?: ViewerHead;
}

export type ViewerLighting = 'classic' | 'neutral' | 'neutral-v2';
/** The opt-in heads of the look reviews (18 and 19 Nov 2026). */
export type ViewerHead = 'neutral-v2' | 'neutral-v3';

/** The 3D view's lighting from the build flag: `classic` (today's) unless the build asks for `neutral` or `neutral-v2`. */
export function viewerLightingFlag(env: { VITE_VIEWER_LIGHTING?: string } = import.meta.env): ViewerLighting {
  const v = env.VITE_VIEWER_LIGHTING;
  return v === 'neutral' || v === 'neutral-v2' ? v : 'classic';
}

/**
 * The 3D view's head. Default `neutral-v3` (founder decision D22, 19 Nov 2026). The build flag VITE_VIEWER_HEAD can pick
 * `neutral-v2`, or `neutral` for the viewer's old default head (returned as null: nothing is sent to the viewer).
 */
export function viewerHeadFlag(env: { VITE_VIEWER_HEAD?: string } = import.meta.env): ViewerHead | null {
  const v = env.VITE_VIEWER_HEAD;
  if (v === 'neutral') return null;
  return v === 'neutral-v2' || v === 'neutral-v3' ? v : 'neutral-v3';
}
/** What a baked view rests on (`GarmentView.source` of the viewer); optional, so this file builds against a viewer without it. */
export type ViewerSource =
  /** `notDrawn`: sizes of a sewn top too small for this body (the fit engine's `open`), not draped and not drawn. */
  | { kind: 'device'; notDrawn?: Record<string, { anchor: string; bodyLargerCm: number }> }
  | { kind: 'bake'; plainColour: boolean; sizes: Record<string, { provenance: 'measured' | 'interpolated' | 'extrapolated'; place: 'within' | 'held' | 'between' | 'refused'; refusedHipCm: number | null }> };
/** The viewer contract of the avatar slices; optional, so this file builds against a viewer without it. */
type View = Omit<BaseView, 'source'> & { setLook?: (look: ViewerLook) => void; source?: ViewerSource };
type MountOptionsWithLook = Omit<BaseMountOptions, 'look' | 'lighting'> & { look?: ViewerLook; lighting?: ViewerLighting };

/**
 * The body family the viewer draws: the garment's audience decides (men → male), else today's
 * figure. The same rule (`garmentBodyFamily`) picks the bundle family the api imports and hands out
 * for the product, so a men's garment reaches the viewer only with a male-built bundle.
 */
export function bodyFamilyFor(garment: Pick<GarmentPayload, 'audience'>): 'female' | 'male' {
  return garmentBodyFamily(garment);
}

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
  /** The shopper's units and height, so the ring numbers match the 2D figure's. */
  units?: Units;
  heightCm?: number | undefined;
  /** Body girths estimated from height and weight (BodyProfile source 'prior'). */
  estimated?: readonly string[];
  /** The skin colour picked in the avatar prompt (null: the viewer's standard body colour). */
  skinHex?: string | null;
  onSelect: (size: string) => void;
  /** The product may only be shown with this view (see the file header). */
  required?: boolean;
  /** With `required`: the view has settled, or it failed (no WebGL2, bundle error, incompatible). */
  onRequiredState?: (state: 'settled' | 'failed') => void;
  /** With `required`: the time the view gets to settle (default `REQUIRED_3D_TIMEOUT_MS`). */
  requiredTimeoutMs?: number;
  /** Lighting and head of the 3D view (default: the build flags, else today's look). */
  lighting?: ViewerLighting;
  head?: ViewerHead | null;
  /** Tests inject these; the app uses the real chunk and the real check. */
  loadViewer?: () => Promise<ViewerModule>;
  webgl2?: () => boolean;
}

/** How long a required 3D view may take to settle before it counts as failed (chunk + bundle + drape). */
export const REQUIRED_3D_TIMEOUT_MS = 30_000;

type Phase = 'idle' | 'loading' | 'draping' | 'settled' | 'failed';

export function Garment3D({ asset, paused, garment, fit, size, recommended, measurements, units = 'metric', heightCm, estimated = [], skinHex = null, onSelect, required = false, onRequiredState, requiredTimeoutMs = REQUIRED_3D_TIMEOUT_MS, lighting = viewerLightingFlag(), head = viewerHeadFlag(), loadViewer = () => import('@curtain/garment-viewer'), webgl2 = hasWebGL2 }: Garment3DProps): ReactNode {
  const [supported] = useState(() => !!asset && webgl2());
  const usable = !!asset && !paused && supported;
  const [open, setOpen] = useState(required && usable);
  const [phase, setPhase] = useState<Phase>(required && usable ? 'loading' : 'idle');
  const [source, setSource] = useState<ViewerSource | null>(null);
  const onRequiredRef = useRef(onRequiredState);
  useEffect(() => {
    onRequiredRef.current = onRequiredState;
  });
  useEffect(() => {
    if (!required) return;
    if (!usable || phase === 'failed') onRequiredRef.current?.('failed');
    else if (phase === 'settled') onRequiredRef.current?.('settled');
  }, [required, usable, phase]);
  // Required view: no answer in time is a failure, and a failure is final (a late `settled` from
  // the viewer must not bring the result back after the embed went to coming soon).
  const waiting = required && open && (phase === 'loading' || phase === 'draping');
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setPhase('failed'), requiredTimeoutMs);
    return () => clearTimeout(timer);
  }, [waiting, requiredTimeoutMs]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef(size);
  const skinRef = useRef(skinHex);
  // The same size-ring numbers as the 2D figure (route R5), as text under the 3D view: the drape
  // can hide part of the graded difference, the rings say it in numbers.
  // The hem is left out: the 3D drape does not show the hem width yet (docs/REFINEMENT.md R3).
  const rings = useMemo(
    () => (open ? ringOverlayFor({ garment, fit, size, measurements, heightCm, inputs: ringInputsFor(garment), units, estimated }) : null),
    [open, garment, fit, size, measurements, heightCm, units, estimated],
  );
  const ringList = rings ? rings.selected.rings.filter((r) => r.key !== 'hem') : [];
  const hemLeftOut = !!rings && rings.selected.rings.some((r) => r.key === 'hem');

  useEffect(() => {
    if (!open || !asset) return;
    let cancelled = false;
    void (async () => {
      try {
        const mod = await loadViewer();
        if (cancelled) return;
        if (!canvasRef.current) {
          // No canvas to draw on: for a required view that is a failure, not a silent stop.
          if (required) setPhase('failed');
          return;
        }
        const family = bodyFamilyFor(garment);
        const body = {
          bust: measurements.bust,
          waist: measurements.waist,
          hip: measurements.hip,
          ...(family === 'male' ? { family, ...(typeof heightCm === 'number' && Number.isFinite(heightCm) && heightCm > 0 ? { heightCm } : {}) } : {}),
        };
        const options: MountOptionsWithLook = {
          baseUrl: asset.baseUrl,
          garment,
          fit,
          size: sizeRef.current,
          body,
          ...(skinRef.current || head ? { look: { ...(skinRef.current ? { skinHex: skinRef.current } : {}), ...(head ? { head } : {}) } } : {}),
          ...(lighting !== 'classic' ? { lighting } : {}),
          onState: (s) => {
            if (!cancelled) setPhase((prev) => (required && prev === 'failed' ? prev : s === 'error' ? 'failed' : s));
          },
        };
        const view: View = await mod.mountGarmentView(canvasRef.current, options as BaseMountOptions);
        if (cancelled) view.dispose();
        else {
          viewRef.current = view;
          setSource(view.source ?? null);
          // The colour may have changed while the bundle loaded.
          if ((options.look?.skinHex ?? null) !== skinRef.current && typeof view.setLook === 'function') view.setLook({ skinHex: skinRef.current ?? undefined });
        }
      } catch {
        if (!cancelled) setPhase('failed');
      }
    })();
    return () => {
      cancelled = true;
      viewRef.current?.dispose();
      viewRef.current = null;
      setSource(null);
    };
    // The bundle, garment, fit and body are fixed for one open; size changes go through setSize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset?.baseUrl]);

  useEffect(() => {
    sizeRef.current = size;
    viewRef.current?.setSize(size);
  }, [size]);

  // A new colour reaches the mounted view without a remount, when the viewer can do that.
  useEffect(() => {
    skinRef.current = skinHex;
    const view = viewRef.current;
    if (view && typeof view.setLook === 'function') view.setLook({ skinHex: skinHex ?? undefined });
  }, [skinHex]);

  if (!asset || paused || !supported) return null;
  const sizes = asset.sizes;
  const t = embedStrings().view3d;

  if (!open)
    return (
      <section className="mt-4" aria-label={t.label}>
        <button type="button" className="chip w-full justify-center py-2.5 text-sm hover:bg-white" onClick={() => {
            setPhase('loading');
            setOpen(true);
          }}
          data-testid="garment3d-open"
        >
          <Box className="h-4 w-4" aria-hidden /> {t.open}
        </button>
      </section>
    );

  return (
    <section className="mt-4 rounded-2xl border border-line bg-white/60 p-3" aria-label={t.label} data-testid="garment3d">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t.heading(size)}</h3>
        {required ? null : (
          <button type="button" className="chip px-2 py-1 text-xs" onClick={() => setOpen(false)} aria-label={t.close}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      {phase === 'failed' ? (
        <p className="mt-2 text-sm text-ink-soft" role="status" data-testid="garment3d-failed">
          {t.unavailable(size)}
        </p>
      ) : (
        <div className="relative mt-2 aspect-[3/4] w-full overflow-hidden rounded-xl bg-cream">
          <canvas ref={canvasRef} className="h-full w-full touch-none" data-testid="garment3d-canvas" aria-label={t.canvas(size)} />
          {phase === 'loading' || phase === 'draping' ? (
            <span className="chip pointer-events-none absolute top-2 left-2 bg-white/90 text-xs" role="status">
              {phase === 'loading' ? t.loading : t.draping}
            </span>
          ) : null}
          {/* Top right: at the bottom it covered the hem of a floor-length skirt; the loading chip is top left. */}
          <EstimateBadge className="pointer-events-none absolute top-2 right-2 text-[10px]" />
        </div>
      )}
      {sizes.length > 1 && phase !== 'failed' ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t.sizes}>
          {sizes.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={s === size} className={`chip min-h-8 px-2.5 text-xs ${s === size ? 'border-ink bg-ink text-white' : ''}`} onClick={() => onSelect(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-xs leading-snug text-ink-mute" data-testid="garment3d-label">
        {t.notPhoto} {recommended ? t.picked(recommended) : t.noneFits}
        {recommended && recommended !== size ? ` ${t.looking(size)}` : ''}
      </p>
      {source?.kind === 'bake' ? <BakeNote t={t} size={size} source={source} units={units} /> : null}
      {source?.kind === 'device' && source.notDrawn?.[size] ? (
        <p className="mt-1 text-[11px] leading-snug text-ink-mute" data-testid="garment3d-not-drawn" data-anchor={source.notDrawn[size]!.anchor}>
          {t.notDrawn(size, t.ringName(source.notDrawn[size]!.anchor).toLowerCase(), lengthText(source.notDrawn[size]!.bodyLargerCm, units))}
        </p>
      ) : null}
      {ringList.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1 text-[11px]" aria-label={t.rings(size)} data-testid="garment3d-rings">
          {ringList.map((r) => (
            <li key={r.key} className="chip px-2 py-0.5" title={r.text}>
              <span className="font-semibold">{t.ringName(r.key)}</span>{' '}
              {r.chip[0].toLowerCase() === t.ringName(r.key).toLowerCase() ? r.chip[1] : `${r.chip[0].toLowerCase()}, ${r.chip[1]}`}
            </li>
          ))}
        </ul>
      ) : null}
      {hemLeftOut && source?.kind !== 'bake' ? (
        <p className="mt-1 text-[11px] leading-snug text-ink-mute" data-testid="garment3d-hem-note">
          {t.hemNote}
        </p>
      ) : null}
    </section>
  );
}

/** Under the label of a server drape bake: plain colour, where the size comes from, and where the shopper lies against the bodies it was draped on. */
function BakeNote({ t, size, source, units }: { t: EmbedCatalogue['view3d']; size: string; source: Extract<ViewerSource, { kind: 'bake' }>; units: Units }): ReactNode {
  const s = source.sizes[size];
  const place = s?.place ?? 'within';
  return (
    <p className="mt-1 text-[11px] leading-snug text-ink-mute" data-testid="garment3d-bake-note" data-place={place}>
      {source.plainColour ? `${t.plainColour} ` : ''}
      {s ? t.provenance(size, s.provenance) : ''}
      {place === 'held' ? ` ${t.held(size)}` : ''}
      {place === 'between' && s?.refusedHipCm != null ? ` ${t.between(size, lengthText(s.refusedHipCm, units))}` : ''}
      {place === 'refused' && s?.refusedHipCm != null ? ` ${t.refused(size, lengthText(s.refusedHipCm, units))}` : ''}
      {` ${t.sizesAlike}`}
    </p>
  );
}
