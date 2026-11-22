/**
 * The overlay's 3D estimate (docs/ENGINE-HANDOFF.md §On-device fitting): the product's approved
 * bundle on an avatar built from the shopper's own girths, draped in Web Workers, one size at a
 * time. Everything happens on the device (D3): the only network traffic is GETs of the bundle
 * files under `baseUrl`. The size shown is the size the embed's own fit-engine result recommends
 * (AGENTS.md rule 4, D15): this module takes that FitResult and never computes a fit itself.
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, familyShape, type Mannequin } from '@curtain/mannequin';
import type { FitResult } from '@curtain/fit-engine';
import type { GarmentPayload } from '@curtain/schema';
import { initialViewFor } from './initialView';
import { bodyFamilyOf, bodyField, buildAvatar, buildTypedAvatar, bundleFamilyOf, bundleMaleShapeOf, girthInput, isTypedBody, mannequinMeasurements, sanitiseMeasurements, type Avatar, type BodyField, type BodyMeasurements, type BodyOptions } from './body';
import { loadBundleFrom, type FetchLike } from './bundle';
import { checkBundle, gradingLabel } from './bundleCheck';
import { redrawOnContextRestored } from './contextRestore';
import { isSettled, stepCloth } from './cloth';
import { makeCollider } from './collide';
import type { MaterialJson } from './core/types';
import { bakeAxis, bakePlace, blendBakedSize, settleOnBody, type BakePlace, type DrapeBake, type SizeProvenance } from './drapeBake';
import { DrapePool } from './drapePool';
import { DEFAULT_DRAPE, drapeJobOf, openSession, prepareFit, viewerMaterial, type DrapeOptions, type FitInstance } from './engine';
import { notDrawnSizes, type NotDrawn } from './notDrawn';
import * as THREE from 'three';
import { faceUvOf } from '@curtain/mannequin';
import type { FaceTexture } from './faceOverlay';
import { skinShadingOf, type SkinShading } from './skin';
import { Figure, Stage, lightingOf, meshGeometry, parseSkinHex, renderPasses, type Lighting, type LookExtras } from './scene';
import { neighbourSize, PASS_HEIGHT, PASS_WIDTH, type ExportPassesOptions, type ViewerPasses } from './passes';

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
   * unfinished). `egg`: the plain v0 head. `neutral-v2` (opt-in, for the look review): head v2 of
   * `@curtain/mannequin` (open eyes, brows, ears, a jaw and brow per family, no neck seam).
   * `neutral-v3` (opt-in, for the review of 19 Nov 2026): head v3 (v2's defects fixed, short
   * sculpted hair, about 24k triangles). Fixed at mount; `setLook` does not change it.
   */
  head?: HeadKind;
  /**
   * Slice 6 spike (behind the host's face flag, off by default): the shopper's face, baked on the
   * device into the head v2 face frame, laid over the front of the head. Only with `head:
   * 'neutral-v2'`; ignored otherwise. Can be set and removed with `setLook`. Never sent or stored here.
   */
  face?: FaceTexture | null;
  /**
   * How a picked skin colour is shaded. `flat` (default): one colour with plain diffuse shading, as
   * before. `skin-v2` (opt-in, for the look review of D22 point 3): pre-integrated scattering with a
   * slightly red shadow edge, a soft sheen and per-tone exposure care (`skin.ts`). The garment is not
   * affected. The grey mannequin (no `skinHex`) is the same either way. `setLook` changes it only when
   * the new look names it; a look without `shading` keeps the one of the mount.
   */
  shading?: SkinShading;
}

export type HeadKind = 'neutral' | 'egg' | 'neutral-v2' | 'neutral-v3';

/** The head a host asked for: `egg`, `neutral-v2` and `neutral-v3` when asked by name, else `neutral`. */
export function headOf(value: unknown): HeadKind {
  return value === 'egg' || value === 'neutral-v2' || value === 'neutral-v3' ? value : 'neutral';
}

export interface MountOptions {
  /** Directory URL of the approved bundle (`asset.baseUrl` from `GET /v1/try`). */
  baseUrl: string;
  /**
   * The male body's shape (`BuildOptions.maleShape` of `@curtain/mannequin`): `v1` (the default,
   * every section an ellipse) or `v2` (non-elliptical sections, chest, back, deltoids, seat and a
   * joined crotch). Read only for a male body; a female body is built exactly as without it.
   * A male bundle is shown only on the shape it was built on (anchors.json and qa.json
   * `mannequin.maleShape`, absent = v1): with the other shape the mount is `GarmentViewError('incompatible')`.
   */
  maleShape?: 'v1' | 'v2';
  /** The product's garment as the embed got it (its size chart is the shop's live chart). */
  garment: GarmentPayload;
  /** The embed's own fit-engine result: the 3D view never recomputes it. */
  fit: FitResult;
  /** The size to show first (the recommended or the selected size). */
  size: string;
  /**
   * The shopper's body, cm (local profile; never sent anywhere): the girths `bust` (or `chest`),
   * `waist`, `hip` as before, and optionally `family` (`female` by default), `heightCm` and
   * `shoulderCm` (`BodyInput` of `@curtain/mannequin`). With girths only, the body is built as
   * before. Values outside the drawn range are held at its ends without an error: bust 60 to 160,
   * waist 45 to 150, hip 65 to 170, height 130 to 220 cm (`MEASUREMENT_LIMITS`,
   * `BODY_INPUT_LIMITS`); the host validates what the shopper types. A family other than the one the bundle was draped on is `GarmentViewError('incompatible')`:
   * a garment is never shown in 3D on a body of the other family. A bundle names its family in
   * anchors.json and qa.json (`mannequin.family`, absent = female; slice M1); a men's garment
   * (`audience: 'men'`) needs a male-built bundle and every other garment a female-built one
   * (`garmentBundleFor` of @curtain/schema), so the host passes `family: 'male'` for a men's
   * garment. That check reads the bundle, so it comes after the bundle's GETs.
   */
  body: BodyOptions;
  /** Skin colour and head of the figure; `setLook` changes the colour without a remount. */
  look?: AvatarLook;
  /**
   * `classic` (default): lights and tone mapping as before. `neutral`: white lights and neutral
   * tone mapping, so skin and garment colours are not shifted. It changes how every garment looks.
   * `neutral-v2` (opt-in): `neutral` plus a thin outline where bare skin meets the backdrop and a
   * contact shadow, so a light skin does not vanish against the cream (`LOOK_EXTRAS` in scene.ts).
   * Anything else is `classic`.
   */
  lighting?: Lighting;
  /** Overrides of the lighting's outline, contact shadow, backdrop and rim: for the look comparison pages only, not for hosts. */
  lookExtras?: Partial<LookExtras>;
  /** Called on every state change (the overlay shows a spinner, then the canvas). */
  onState?: (state: GarmentViewState) => void;
  fetch?: FetchLike;
  /** Drape settings (step-3 control: cling switch, girth loops, waistband model); default `DEFAULT_DRAPE`, the drape as before. */
  drape?: DrapeOptions;
  /** Starting camera angle (D30); default `initialViewFor(garment.category)`. A merchant setting can override this later. */
  initialView?: { azimuthDeg: number; elevationDeg: number };
}

export interface GarmentView {
  /** Show another size (drapes it if needed). Returns false when the bundle has no such size. */
  setSize(size: string): boolean;
  /** The sizes the bundle can show. */
  sizes: string[];
  /** Change the figure's look in place (no remount, no new drape). `skinHex` and `face` can change after the mount; `head` cannot. */
  setLook(look: AvatarLook | null | undefined): void;
  /**
   * Where a point of the figure is on the canvas now (CSS px from its top left). `head` is the
   * middle of the face of the drawn body: D19 puts the avatar prompt behind a tap on the avatar,
   * and this is where the host places that control. It is a point only: the package draws no
   * control and gives the canvas no accessible name. The host supplies a real, labelled button of
   * at least 44 × 44 CSS px there (the head is about 60 px high at phone size) and moves it when
   * the shopper turns or zooms the view. Reads the canvas size first, like a rendered frame does.
   */
  toScreen(point: 'head' | readonly [number, number, number]): { x: number; y: number };
  /**
   * What the picture rests on, for the host's estimate label. `device`: the garment is draped on this device (the
   * bundle's texture when it has one). `bake`: drapes made on the server per size and blended here (`drapeBake.ts`); the
   * garment is drawn in one plain colour (`plainColour`), and per size whether its measurements were measured on the
   * shop's tape or interpolated / extrapolated from it, and where the shopper lies against the bodies it was draped on
   * (`place`, `BakePlace` of `drapeBake.ts`: `held` and `between` are shown on the nearest draped body; `refused` is at
   * or beyond a body the bake did not drape that size on, so the size is not drawn, `refusedHipCm` is that body's hip and
   * `refusedRule` its reason when the bake states one: `pull-on`, the band cannot be pulled over that body). A size the
   * embed's own fit result says cannot be worn (`adviceBlocked`, `notDrawn`: the one rule of `notDrawn.ts`, the same as
   * the device drape's) is not drawn either, wherever it lies against the bodies: the 3D view never dresses the shopper
   * in a size the size advice blocks.
   */
  source: GarmentViewSource;
  /**
   * The render passes of the AI realism layer (D22, `passes.ts`): colour, depth, normals, garment
   * and figure masks of the size on screen, from the front camera on the flat backdrop, plus the
   * neighbouring size's garment mask when that size is draped. Standard head and body colour, never
   * the shopper's face texture or picked skin colour. The view on screen is put back after. Null
   * while the size on screen is still draping.
   */
  exportPasses(options?: ExportPassesOptions): ViewerPasses | null;
  dispose(): void;
}

export type GarmentViewSource =
  /** `notDrawn`: the sizes not draped on this body, and why (`notDrawn.ts`: the fit engine's block, any garment): the body is drawn without the garment. */
  | { kind: 'device'; notDrawn: Record<string, NotDrawn> }
  | { kind: 'bake'; plainColour: true; sizes: Record<string, BakedSizeView> };

/** One size of a baked view, for the host's label. */
export interface BakedSizeView {
  provenance: SizeProvenance;
  place: BakePlace;
  /** Hip of the nearest body beyond the shopper's side that the size was not draped on, cm; null when there is none. */
  refusedHipCm: number | null;
  /** Why the bake did not drape the size on that body, when it states a rule (`DrapeBakeRefusal.rule`); else null. */
  refusedRule: 'pull-on' | null;
  /** The embed's fit result says this size cannot be worn on the shopper's body (`notDrawn.ts`): not drawn. */
  adviceBlocked: boolean;
  /** Where and why (`adviceBlocked`); null when the size advice does not block the size. */
  notDrawn: NotDrawn | null;
}

/** Clearance of the drawn body for a baked drape, cm: the on-device drape's (`prepareFit`). */
const BAKE_CLEARANCE_CM = 0.35;

/** The baked drape of every size at the shopper's place on the axis, laid out of the drawn body. Pure (no WebGL). */
export function bakedDrapes(bake: DrapeBake, field: BodyField, hipCm: number): Map<string, { pos: Float32Array; place: BakePlace; refusedHipCm: number | null; refusedRule: 'pull-on' | null; pushed: number; floored: number }> {
  const t = bakeAxis(bake.meta, hipCm);
  const out = new Map<string, { pos: Float32Array; place: BakePlace; refusedHipCm: number | null; refusedRule: 'pull-on' | null; pushed: number; floored: number }>();
  const collide = makeCollider(field, BAKE_CLEARANCE_CM);
  const { hipAtZero, hipPerUnit } = bake.meta.axis;
  for (const [label, size] of bake.sizes) {
    const { weights, place, refusedT, refusedRule } = bakePlace(size, t);
    const pos = blendBakedSize(size, weights);
    const r = settleOnBody(pos, collide);
    const refusedHipCm = refusedT === null ? null : Math.round((hipAtZero + hipPerUnit * refusedT) * 10) / 10;
    out.set(label, { pos, place, refusedHipCm, refusedRule, pushed: r.body, floored: r.floor });
  }
  return out;
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

/** What `mountGarmentView` draws and drapes on, decided before any WebGL: the bundle's base body, the avatar and its collision field. */
export interface AvatarPlan {
  /** The body the bundle's garment was draped on. */
  m: Mannequin;
  head: HeadKind;
  avatar: Avatar;
  field: BodyField;
  /** How far the garment is drawn above where the bundle has it, cm (0 without a typed height). */
  garmentLiftCm: number;
  /** Stature of a typed body, cm; 0 for the morphed base body (the camera frame of before). */
  statureCm: number;
  /** The middle of the face of the drawn body: 93.5 % of its stature, at the front of the head. */
  headPoint: readonly [number, number, number];
}

/**
 * The avatar for a bundle and the host's `body` and `look`. Pure (no WebGL, no I/O), so the rules
 * of the mount are unit-tested here. Drape guard: the drawn body is of the family the bundle's
 * garment was draped on, and for a male bundle of the male shape it was built on (`maleShape`,
 * `v1` when absent, against anchors.json `mannequin.maleShape`), or this throws
 * `GarmentViewError('incompatible')` and there is no 3D view.
 */
export function planAvatar(anchors: { category: string; mannequin?: { family?: unknown; maleShape?: unknown } }, bodyOptions: BodyOptions | null | undefined, look?: AvatarLook | null, maleShape?: 'v1' | 'v2'): AvatarPlan {
  const body: BodyOptions = bodyOptions ?? {};
  const family = bundleFamilyOf(anchors);
  if (bodyFamilyOf(body) !== family) throw new GarmentViewError('incompatible');
  if (family === 'male' && bundleMaleShapeOf(anchors) !== (maleShape === 'v2' ? 'v2' : 'v1')) throw new GarmentViewError('incompatible');
  const build = family === 'male' && maleShape === 'v2' ? ({ maleShape: 'v2' } as const) : {};
  const m = buildMannequin(family === 'male' ? familyShape('male')! : bodyShape(BASE_SHAPE_ID), build);
  const head = headOf(look?.head);
  let avatar: Avatar, field: BodyField, garmentLiftCm = 0, statureCm = 0;
  if (isTypedBody(body)) {
    // A typed height or shoulder width: the body is built from the measurements (`buildBody`).
    const typed = buildTypedAvatar(m, body, anchors.category, { head }, build);
    ({ avatar, field, garmentLiftCm, statureCm } = typed);
  } else {
    avatar = buildAvatar(m, buildMannequinMesh(m, { head }), sanitiseMeasurements(girthInput(body), mannequinMeasurements(m)));
    field = bodyField(m, avatar);
  }
  const drawn = statureCm || m.statureCm;
  return { m, head, avatar, field, garmentLiftCm, statureCm, headPoint: [0, 0.935 * drawn, 0.055 * drawn] };
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
  const ok = checkBundle({ anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa }, opts.garment, opts.maleShape === 'v2' ? 'v2' : 'v1');
  if (!ok) {
    state('error');
    throw new GarmentViewError('incompatible');
  }

  let plan: AvatarPlan;
  try {
    plan = planAvatar(bundle.anchors, opts.body, opts.look, opts.maleShape);
  } catch (e) {
    state('error');
    throw e;
  }
  const { m, avatar, field, garmentLiftCm: lift, statureCm: stature, headPoint } = plan;
  if (bundle.bake) {
    // A bake was draped on the girth avatar (`buildAvatar`); a typed body (height, shoulders) is another body, on which
    // the drapes would float or cut in. No 3D view rather than a garment drawn on a body it was not draped on.
    if (isTypedBody(opts.body ?? {})) {
      state('error');
      throw new GarmentViewError('incompatible');
    }
    return mountBaked(canvas, opts, bundle.bake, bundle.material, ok, plan, state);
  }
  const session = openSession(m, bundle, opts.garment);
  const material = viewerMaterial('product', bundle.material);
  const stage = new Stage(canvas, { controls: true, lighting: lightingOf(opts.lighting), ...(opts.lookExtras ? { extras: opts.lookExtras } : {}) });
  const n = bundle.baseMesh.positions.length / 3;
  const tex = bundle.render && bundle.textureImage ? { ...bundle.render, image: bundle.textureImage } : null;
  const figure = new Figure(meshGeometry(avatar.mesh), bundle.baseMesh.indices, n, tex);
  figure.setMaterial(material);
  let shading = skinShadingOf(opts.look?.shading);
  figure.setSkinShading(shading, lightingOf(opts.lighting));
  figure.setSkin(parseSkinHex(opts.look?.skinHex));
  const faceUv = plan.head === 'neutral-v2' ? faceUvOf(avatar.mesh) : null;
  figure.setFace(opts.look?.face, faceUv);
  stage.setSkinTone(parseSkinHex(opts.look?.skinHex));
  figure.garment.position.y = lift;
  stage.scene.add(figure.group);
  const view = opts.initialView ?? initialViewFor(opts.garment.category);
  stage.frame(60, stature, view.azimuthDeg);

  interface Live {
    fit: FitInstance;
    jobId: number | null;
    dirty: boolean;
  }
  const fits = new Map<string, Live>();
  const settledPos = (label: string): Float32Array | null => {
    const l = fits.get(label);
    return l && l.jobId === null && isSettled(l.fit.cloth, l.fit.params) ? l.fit.cloth.pos : null;
  };
  let pool: DrapePool | null = DrapePool.create(() => {
    // A worker failed: step on the main thread from here on.
    pool = null;
    for (const f of fits.values()) f.jobId = null;
  });
  let current = '';
  let disposed = false;

  // A size the fit engine says cannot be worn on this body, whatever the garment: not draped, not drawn (`notDrawn.ts`).
  const notDrawn = notDrawnSizes(opts.fit, ok.sizes);

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
        // The worker's solver time for the size on show, ms (a timing only; read by the demo scripts for the reports).
        if (p.done && label === current) canvas.dataset.solveMs = String(Math.round(p.computeMs));
        if (label === current) wake();
      });
    }
    return l;
  };

  const neighbours = (label: string): string[] => {
    const i = ok.sizes.indexOf(label);
    return [ok.sizes[i - 1], ok.sizes[i + 1]].filter((s): s is string => !!s && !notDrawn[s]);
  };

  const setSize = (size: string): boolean => {
    const label = gradingLabel(ok.sizes, size);
    if (!label) return false;
    current = label;
    canvas.dataset.size = label;
    const refused = !!notDrawn[label];
    figure.garment.visible = !refused;
    canvas.dataset.garment = refused ? 'not-drawn' : 'drawn';
    if (refused) {
      state('settled');
      wake(100);
      return true;
    }
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
  // A lost WebGL context comes back empty and a settled view is idle: draw the size on screen again.
  const stopContextRestore = redrawOnContextRestored(canvas, () => {
    const live = fits.get(current);
    if (live) live.dirty = true;
    wake(300);
  });

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
    const more = busy || performance.now() < awakeUntil;
    // The frame the loop stops on is the one that stays on screen: it is drawn with everything (the outline of neutral-v2).
    stage.render(!more);
    if (!raf && !disposed && more) raf = requestAnimationFrame(tick);
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
    source: { kind: 'device', notDrawn },
    exportPasses(o) {
      if (disposed) return null;
      const pos = settledPos(current);
      if (!pos) return null;
      const nb = o?.neighbour === null ? null : (o?.neighbour ?? neighbourSize(ok.sizes, current));
      const nbPos = nb ? settledPos(nb) : null;
      return passesOf(stage, figure, plan, material.baseColorHex, current, pos, nb && nbPos ? { size: nb, pos: nbPos } : null, o);
    },
    setLook(look) {
      if (disposed) return;
      // The shading stays what it was unless the new look names one.
      if (look?.shading !== undefined) shading = skinShadingOf(look.shading);
      figure.setSkinShading(shading, lightingOf(opts.lighting));
      figure.setSkin(parseSkinHex(look?.skinHex));
      stage.setSkinTone(parseSkinHex(look?.skinHex));
      figure.setFace(look?.face, faceUv);
      wake(100);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      stopContextRestore();
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

/**
 * The drape bake path of `mountGarmentView`: no drape on the device. Every size is the server's drapes blended to the
 * shopper's hip on the chart axis and laid out of the drawn avatar (`bakedDrapes`), in the bake's one plain colour.
 */
function mountBaked(canvas: HTMLCanvasElement, opts: MountOptions, bake: DrapeBake, bundleMaterial: MaterialJson, ok: { sizes: string[]; baseSize: string }, plan: AvatarPlan, state: (s: GarmentViewState) => void): GarmentView {
  const { avatar, field, garmentLiftCm: lift, statureCm: stature, headPoint } = plan;
  const material = { ...viewerMaterial('product', bundleMaterial), baseColorHex: bake.meta.plainColourHex };
  const stage = new Stage(canvas, { controls: true, lighting: lightingOf(opts.lighting), ...(opts.lookExtras ? { extras: opts.lookExtras } : {}) });
  const figure = new Figure(meshGeometry(avatar.mesh), bake.indices, bake.vertexCount, null);
  figure.setMaterial(material);
  let shading = skinShadingOf(opts.look?.shading);
  figure.setSkinShading(shading, lightingOf(opts.lighting));
  figure.setSkin(parseSkinHex(opts.look?.skinHex));
  const faceUv = plan.head === 'neutral-v2' ? faceUvOf(avatar.mesh) : null;
  figure.setFace(opts.look?.face, faceUv);
  stage.setSkinTone(parseSkinHex(opts.look?.skinHex));
  figure.garment.position.y = lift;
  stage.scene.add(figure.group);
  const view = opts.initialView ?? initialViewFor(opts.garment.category);
  stage.frame(60, stature, view.azimuthDeg);
  const drapes = bakedDrapes(bake, field, avatar.measurements.hip);
  // The sizes the embed's own fit result says cannot be worn on the shopper's body: the same rule as the device drape
  // (`notDrawn.ts`; the view never recomputes the fit). A band that does not pass the hips is one case of it.
  const notDrawn = notDrawnSizes(opts.fit, ok.sizes);
  const blocked = new Set(Object.keys(notDrawn));
  const sizes: Record<string, BakedSizeView> = {};
  for (const [label, s] of bake.sizes) {
    const d = drapes.get(label)!;
    sizes[label] = { provenance: s.provenance, place: d.place, refusedHipCm: d.refusedHipCm, refusedRule: d.refusedRule, adviceBlocked: blocked.has(label), notDrawn: notDrawn[label] ?? null };
  }
  let disposed = false;
  let raf = 0;
  let awakeUntil = 0;
  function tick(): void {
    raf = 0;
    if (disposed) return;
    const more = performance.now() < awakeUntil;
    stage.render(!more);
    if (more) raf = requestAnimationFrame(tick);
  }
  function wake(ms = 0): void {
    awakeUntil = Math.max(awakeUntil, performance.now() + ms);
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  }
  const onControls = (): void => wake(600);
  stage.controls.addEventListener('change', onControls);
  stage.controls.addEventListener('start', onControls);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => wake(100)) : null;
  resizeObserver?.observe(canvas);
  const stopContextRestore = redrawOnContextRestored(canvas, () => wake(300));
  const setSize = (size: string): boolean => {
    const label = gradingLabel(ok.sizes, size);
    const d = label ? drapes.get(label) : undefined;
    if (!label || !d) return false;
    canvas.dataset.size = label;
    figure.setPositions(d.pos);
    // The bake did not drape this size on a body like the shopper's, or the size advice blocks it at the shopper's
    // hip: the body is drawn without it.
    const drawn = d.place !== 'refused' && !blocked.has(label);
    figure.garment.visible = drawn;
    canvas.dataset.garment = drawn ? 'drawn' : 'not-drawn';
    state('settled');
    wake(100);
    return true;
  };
  if (!setSize(opts.size) && !setSize(ok.baseSize)) {
    state('error');
    figure.dispose();
    stage.renderer.dispose();
    throw new GarmentViewError('incompatible');
  }
  wake(500);
  return {
    setSize,
    sizes: ok.sizes.filter((s) => drapes.has(s)),
    source: { kind: 'bake', plainColour: true, sizes },
    exportPasses(o) {
      if (disposed) return null;
      const label = canvas.dataset.size ?? '';
      const d = drapes.get(label);
      // No passes of a size that is not drawn (refused by the bake, or blocked by the size advice): there is no garment to enhance.
      if (!d || d.place === 'refused' || blocked.has(label)) return null;
      const nb = o?.neighbour === null ? null : (o?.neighbour ?? neighbourSize(ok.sizes, label));
      const nd = nb ? drapes.get(nb) : undefined;
      return passesOf(stage, figure, plan, material.baseColorHex, label, d.pos, nb && nd && nd.place !== 'refused' && !blocked.has(nb) ? { size: nb, pos: nd.pos } : null, o);
    },
    toScreen(point) {
      const p = point === 'head' ? headPoint : point;
      stage.resize();
      stage.camera.updateMatrixWorld();
      return stage.toScreen(new THREE.Vector3(p[0], p[1], p[2]));
    },
    setLook(look) {
      if (disposed) return;
      // The shading stays what it was unless the new look names one.
      if (look?.shading !== undefined) shading = skinShadingOf(look.shading);
      figure.setSkinShading(shading, lightingOf(opts.lighting));
      figure.setSkin(parseSkinHex(look?.skinHex));
      stage.setSkinTone(parseSkinHex(look?.skinHex));
      figure.setFace(look?.face, faceUv);
      wake(100);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      stopContextRestore();
      stage.controls.removeEventListener('change', onControls);
      stage.controls.removeEventListener('start', onControls);
      figure.dispose();
      stage.controls.dispose();
      stage.renderer.dispose();
    },
  };
}

/** Shared by both mount paths: the passes of the size on screen. */
function passesOf(stage: Stage, figure: Figure, plan: AvatarPlan, garmentHex: string, size: string, pos: Float32Array, neighbour: { size: string; pos: Float32Array } | null, o: ExportPassesOptions | undefined): ViewerPasses {
  const ring = (id: string): number => plan.m.rings.find((r) => r.id === id)?.centre[1] ?? 0;
  const stature = plan.statureCm || plan.m.statureCm;
  return renderPasses(stage, figure, {
    width: o?.width ?? PASS_WIDTH,
    height: o?.height ?? PASS_HEIGHT,
    statureCm: stature,
    waistY: ring('waist'),
    hipY: ring('hip'),
    neighbour,
    current: pos,
    size,
    garmentHex,
  });
}

export type { BodyMeasurements, BodyOptions };
