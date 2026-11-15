/**
 * The overlay's 3D estimate (docs/ENGINE-HANDOFF.md §On-device fitting): the product's approved
 * bundle on an avatar built from the shopper's own girths, draped in Web Workers, one size at a
 * time. Everything happens on the device (D3): the only network traffic is GETs of the bundle
 * files under `baseUrl`. The size shown is the size the embed's own fit-engine result recommends
 * (AGENTS.md rule 4, D15): this module takes that FitResult and never computes a fit itself.
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, familyShape } from '@curtain/mannequin';
import type { FitResult } from '@curtain/fit-engine';
import type { GarmentPayload } from '@curtain/schema';
import { bodyFamilyOf, bodyField, buildAvatar, buildTypedAvatar, bundleFamilyOf, girthInput, isTypedBody, mannequinMeasurements, sanitiseMeasurements, type BodyMeasurements, type BodyOptions } from './body';
import { loadBundleFrom, type FetchLike } from './bundle';
import { checkBundle, gradingLabel } from './bundleCheck';
import { isSettled, stepCloth } from './cloth';
import { DrapePool } from './drapePool';
import { DEFAULT_DRAPE, drapeJobOf, openSession, prepareFit, viewerMaterial, type DrapeOptions, type FitInstance } from './engine';
import * as THREE from 'three';
import { Figure, Stage, meshGeometry, parseSkinHex, type Lighting } from './scene';

export type GarmentViewState = 'loading' | 'draping' | 'settled' | 'error';

/**
 * How the figure looks. A look is a display value only: it stays in memory on the device, is
 * never fetched, stored or sent by this package, and is not part of the fit.
 */
export interface AvatarLook {
  /** Skin colour of the mannequin, `#rrggbb`. Absent, null or not such a colour: the default mid-grey. */
  skinHex?: string | null;
  /**
   * `neutral` (default): the neutral standard face of `@curtain/mannequin` (D19: no avatar looks
   * unfinished). `egg`: the plain v0 head. Fixed at mount; `setLook` does not change it.
   */
  head?: 'neutral' | 'egg';
}

export interface MountOptions {
  /** Directory URL of the approved bundle (`asset.baseUrl` from `GET /v1/try`). */
  baseUrl: string;
  /** The product's garment as the embed got it (its size chart is the shop's live chart). */
  garment: GarmentPayload;
  /** The embed's own fit-engine result: the 3D view never recomputes it. */
  fit: FitResult;
  /** The size to show first (the recommended or the selected size). */
  size: string;
  /**
   * The shopper's body, cm (local profile; never sent anywhere): the girths `bust` (or `chest`),
   * `waist`, `hip` as before, and optionally `family` (`female` by default), `heightCm` and
   * `shoulderCm` (`BodyInput` of `@curtain/mannequin`). With girths only, the avatar is built as
   * before. A family other than the one the bundle was draped on is `GarmentViewError('incompatible')`:
   * a garment is never shown in 3D on a body of the other family (every bundle today is female M).
   */
  body: BodyOptions;
  /** Skin colour and head of the figure; `setLook` changes the colour without a remount. */
  look?: AvatarLook;
  /**
   * `classic` (default): lights and tone mapping as before. `neutral`: white lights and neutral
   * tone mapping, so skin and garment colours are not shifted. It changes how every garment looks.
   */
  lighting?: Lighting;
  /** Called on every state change (the overlay shows a spinner, then the canvas). */
  onState?: (state: GarmentViewState) => void;
  fetch?: FetchLike;
  /** Drape settings (step-3 control: cling switch, girth loops, waistband model); default `DEFAULT_DRAPE`, the drape as before. */
  drape?: DrapeOptions;
}

export interface GarmentView {
  /** Show another size (drapes it if needed). Returns false when the bundle has no such size. */
  setSize(size: string): boolean;
  /** The sizes the bundle can show. */
  sizes: string[];
  /** Change the figure's look in place (no remount, no new drape). Only `skinHex` can change after the mount. */
  setLook(look: AvatarLook | null | undefined): void;
  /**
   * Where a point of the figure is on the canvas now (CSS px from its top left), for a tap target
   * or a chip on the head. `head` is the middle of the face of the drawn body.
   */
  toScreen(point: 'head' | readonly [number, number, number]): { x: number; y: number };
  dispose(): void;
}

export class GarmentViewError extends Error {
  constructor(readonly code: 'unsupported' | 'incompatible' | 'load_failed') {
    super(`garment view: ${code}`);
  }
}

/** WebGL2 available (checked on a throwaway canvas, so the real one keeps its own context attributes). */
export function supportsWebGL2(doc: Document = document): boolean {
  try {
    const c = doc.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** Main-thread stepping budget per frame when module workers are unavailable, ms. */
const BUDGET_MS = 12;

export async function mountGarmentView(canvas: HTMLCanvasElement, opts: MountOptions): Promise<GarmentView> {
  const state = (s: GarmentViewState): void => {
    canvas.dataset.state = s;
    opts.onState?.(s);
  };
  state('loading');
  if (!supportsWebGL2(canvas.ownerDocument)) {
    state('error');
    throw new GarmentViewError('unsupported');
  }
  const fetchFn: FetchLike = opts.fetch ?? ((url) => fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' }));
  let bundle;
  try {
    bundle = await loadBundleFrom(fetchFn, opts.baseUrl.replace(/\/+$/, ''), opts.garment.id, { withPayload: false });
  } catch {
    state('error');
    throw new GarmentViewError('load_failed');
  }
  const ok = checkBundle({ anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa }, opts.garment);
  if (!ok) {
    state('error');
    throw new GarmentViewError('incompatible');
  }

  // Drape guard: the drawn body is of the family the bundle's garment was draped on, or there is no 3D view.
  const body: BodyOptions = opts.body ?? {};
  const family = bundleFamilyOf(bundle.anchors);
  if (bodyFamilyOf(body) !== family) {
    state('error');
    throw new GarmentViewError('incompatible');
  }
  const m = buildMannequin(family === 'male' ? familyShape('male')! : bodyShape(BASE_SHAPE_ID));
  const head = opts.look?.head === 'egg' ? 'egg' : 'neutral';
  const session = openSession(m, bundle, opts.garment);
  let avatar, field, lift = 0, stature = 0;
  if (isTypedBody(body)) {
    // A typed height or shoulder width: the body is built from the measurements (`buildBody`).
    const typed = buildTypedAvatar(m, body, bundle.anchors.category, { head });
    ({ avatar, field } = typed);
    lift = typed.garmentLiftCm;
    stature = typed.statureCm;
  } else {
    avatar = buildAvatar(m, buildMannequinMesh(m, { head }), sanitiseMeasurements(girthInput(body), mannequinMeasurements(m)));
    field = bodyField(m, avatar);
  }
  const material = viewerMaterial('product', bundle.material);
  const stage = new Stage(canvas, { controls: true, lighting: opts.lighting });
  const n = bundle.baseMesh.positions.length / 3;
  const tex = bundle.render && bundle.textureImage ? { ...bundle.render, image: bundle.textureImage } : null;
  const figure = new Figure(meshGeometry(avatar.mesh), bundle.baseMesh.indices, n, tex);
  figure.setMaterial(material);
  figure.setSkin(parseSkinHex(opts.look?.skinHex));
  figure.garment.position.y = lift;
  // The middle of the face: 93.5 % of the drawn stature, at the front of the head.
  const drawnStature = stature || m.statureCm;
  const headPoint: readonly [number, number, number] = [0, 0.935 * drawnStature, 0.055 * drawnStature];
  stage.scene.add(figure.group);
  stage.frame(60, stature);

  interface Live {
    fit: FitInstance;
    jobId: number | null;
    dirty: boolean;
  }
  const fits = new Map<string, Live>();
  let pool: DrapePool | null = DrapePool.create(() => {
    // A worker failed: step on the main thread from here on.
    pool = null;
    for (const f of fits.values()) f.jobId = null;
  });
  let current = '';
  let disposed = false;

  const ensure = (label: string): Live => {
    let live = fits.get(label);
    if (live) return live;
    const fit = prepareFit(session, avatar, field, opts.fit, label, material, 1.5, opts.drape ?? DEFAULT_DRAPE);
    live = { fit, jobId: null, dirty: true };
    fits.set(label, live);
    const l = live;
    if (pool) {
      l.jobId = pool.start(drapeJobOf(fit), (p) => {
        fit.cloth.pos.set(p.pos);
        fit.cloth.time = p.time;
        fit.cloth.calmFrames = p.calmFrames;
        l.dirty = true;
        if (p.done) l.jobId = null;
        if (label === current) wake();
      });
    }
    return l;
  };

  const neighbours = (label: string): string[] => {
    const i = ok.sizes.indexOf(label);
    return [ok.sizes[i - 1], ok.sizes[i + 1]].filter((s): s is string => !!s);
  };

  const setSize = (size: string): boolean => {
    const label = gradingLabel(ok.sizes, size);
    if (!label) return false;
    current = label;
    canvas.dataset.size = label;
    const live = ensure(label);
    live.dirty = true;
    state(live.jobId === null && isSettled(live.fit.cloth, live.fit.params) ? 'settled' : 'draping');
    wake();
    return true;
  };

  // Frames run only while something changes (a drape in progress, the orbit controls moving or
  // damping out, a resize); once settled and still, the loop stops so a phone is not kept busy.
  let raf = 0;
  let awakeUntil = 0;
  function wake(ms = 0): void {
    awakeUntil = Math.max(awakeUntil, performance.now() + ms);
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  }
  const onControls = (): void => wake(600);
  stage.controls.addEventListener('change', onControls);
  stage.controls.addEventListener('start', onControls);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => wake(100)) : null;
  resizeObserver?.observe(canvas);

  function tick(): void {
    raf = 0;
    if (disposed) return;
    let busy = false;
    const live = fits.get(current);
    if (live) {
      if (live.jobId === null && !isSettled(live.fit.cloth, live.fit.params)) {
        const t0 = performance.now();
        while (!isSettled(live.fit.cloth, live.fit.params) && performance.now() - t0 < BUDGET_MS) stepCloth(live.fit.cloth, live.fit.params, live.fit.collide, 1);
        live.dirty = true;
      }
      if (live.dirty) {
        figure.setPositions(live.fit.cloth.pos);
        live.dirty = false;
      }
      if (live.jobId === null && isSettled(live.fit.cloth, live.fit.params) && canvas.dataset.state !== 'settled') {
        state('settled');
        // The neighbouring sizes drape in the background, so the size switch is instant.
        if (pool) for (const s of neighbours(current)) ensure(s);
      }
      busy = live.jobId !== null || !isSettled(live.fit.cloth, live.fit.params) || live.dirty;
    }
    stage.render();
    if (!raf && !disposed && (busy || performance.now() < awakeUntil)) raf = requestAnimationFrame(tick);
  }

  if (!setSize(opts.size) && !setSize(ok.baseSize)) {
    state('error');
    throw new GarmentViewError('incompatible');
  }
  wake(500);

  return {
    setSize,
    sizes: ok.sizes,
    toScreen(point) {
      const p = point === 'head' ? headPoint : point;
      stage.resize();
      stage.camera.updateMatrixWorld();
      return stage.toScreen(new THREE.Vector3(p[0], p[1], p[2]));
    },
    setLook(look) {
      if (disposed) return;
      figure.setSkin(parseSkinHex(look?.skinHex));
      wake(100);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      stage.controls.removeEventListener('change', onControls);
      stage.controls.removeEventListener('start', onControls);
      pool?.terminate();
      pool = null;
      figure.dispose();
      stage.controls.dispose();
      stage.renderer.dispose();
    },
  };
}

export type { BodyMeasurements, BodyOptions };
