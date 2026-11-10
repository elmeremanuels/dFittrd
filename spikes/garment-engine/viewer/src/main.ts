/**
 * Spike viewer page (index.html): a spike bundle on the canonical mannequin or a body from typed
 * measurements, graded to a size, placed anchor by anchor from the fit engine's gaps, relaxed with a
 * short cloth simulation, with size switching, a fit map, two fabric presets, per-anchor numbers on
 * the model (side by side) and overlaid silhouette outlines.
 *
 * The drape runs in Web Workers (`drapePool.ts`), one size per worker, so it is never time-sliced
 * against rendering; without module workers it falls back to stepping on the main thread. Settled
 * shapes are cached per product, size, body and fabric, and the neighbouring sizes are draped in the
 * background once the shown ones have settled, so a size switch is usually instant.
 *
 * URL parameters (all optional): `product`, `size`, `layout=side`, `fabric`, `heat=1`, `outlines=1`;
 * `shape=XS|M|XXL` puts the canonical mannequin's girths of that body shape on the avatar (a
 * canonical shape, not a person's measurements); `sizes=8,12,16` fixes the sizes shown side by side
 * (when the chart has all of them) instead of the selected size and its neighbours. The headless
 * renders of `report:bohohippychic` (`viewer/render-eval.mjs`) use them.
 *
 * `document.documentElement.dataset` for the smoke script: `viewerState` is `loading`, `draping`,
 * `settled` or `error`; `settle` is a JSON list of `{ key, size, ms, computeMs, clothS }` of the shown
 * sizes; `neckStrain` is the largest neckline edge strain among them; `drapeWorkers` the pool size.
 */
import * as THREE from 'three';
import { BASE_SHAPE_ID, BODY_SHAPE_IDS, bodyShape, buildMannequin, buildMannequinMesh, type BodyShapeId } from '@curtain/mannequin';
import type { FitResult } from '@curtain/fit-engine';
import { bodyField, buildAvatar, mannequinMeasurements, sanitiseMeasurements, type Avatar, type BodyField, type BodyMeasurements } from './body';
import { listBundles, loadBundle } from './bundle';
import { stepCloth, isSettled } from './cloth';
import { DrapePool } from './drapePool';
import { FABRIC_PRESETS, drapeJobOf, drapeOptionsFrom, heatFor, necklineStrain, openSession, prepareFit, sizeLabels, viewerMaterial, type FabricPreset, type FitInstance, type GarmentSession } from './engine';
import { anchorLabels, fitForBody, frontAt, frontOutline, type AnchorLabel } from './fitting';
import { Figure, Outlines, Stage, meshGeometry, type OutlineSpec } from './scene';

type Layout = 'toggle' | 'side';
type BodyMode = 'mannequin' | 'custom';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
/**
 * The chart line under the viewer. After the global scale the residual is 0 by construction when one
 * critical anchor sets the scale, so show the error before calibration and the final residual too.
 */
const chartCaption = (qa: { chartAgreement: { maxAbsCm: number | null; pass: boolean; critical?: string[] }; calibration: { residualBeforeCm: { maxAbs: number }; residualAfterGlobalCm: { maxAbs: number } } }): string => {
  const c = qa.chartAgreement;
  const at = c.critical?.length ? ` at ${c.critical.join(', ')}` : '';
  const one = c.critical?.length === 1 ? ', 0 by construction with one anchor' : '';
  // No girth at a critical anchor: the calibration had no ring, so its "residual before" (0 over no ring) is not an error of 0.
  if (c.maxAbsCm === null) return `Chart agreement ${c.pass ? 'pass' : 'FAIL'}${at}: no girth at a critical anchor, so no error before or after calibration.`;
  const after = `${c.maxAbsCm.toFixed(2)} cm`;
  return `Chart agreement ${c.pass ? 'pass' : 'FAIL'}${at}: max error ${qa.calibration.residualBeforeCm.maxAbs.toFixed(2)} cm before calibration, ${after} after (${qa.calibration.residualAfterGlobalCm.maxAbs.toFixed(2)} cm after the global scale alone${one}).`;
};
const setViewerState = (s: 'loading' | 'draping' | 'settled' | 'error'): void => {
  document.documentElement.dataset.viewerState = s;
};

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canonical = buildMannequinMesh(m);
const SPACING_CM = 78;

const params = new URLSearchParams(location.search);
const shapeParam = params.get('shape') ?? BASE_SHAPE_ID;
const SHAPE: BodyShapeId = (BODY_SHAPE_IDS as readonly string[]).includes(shapeParam) ? (shapeParam as BodyShapeId) : BASE_SHAPE_ID;
/** The canonical body: the M mannequin, or its avatar morphed to another canonical shape's chest, waist and hip girths. */
const MANNEQUIN = SHAPE === BASE_SHAPE_ID ? mannequinMeasurements(m) : mannequinMeasurements({ ...m, shape: bodyShape(SHAPE) });
const fixedSizes = (params.get('sizes') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
/** `view=front|three-quarter|side`: each figure turns about its own axis (0°, 45°, 90°), so sizes side by side stay apart. */
const VIEW_YAW_DEG: Readonly<Record<string, number>> = { front: 0, 'three-quarter': 45, side: 90 };
const viewYawDeg = VIEW_YAW_DEG[params.get('view') ?? 'front'] ?? 0;
/** Step-3 control (docs/research/shortcut-to-step3.md): `cling=0`, `loops=<retain>`, `rings=hip,waist`, `band=<relaxed>:<stretched>` (cm, an assumption unless `bandMeasured=1`). Fixed per page load. */
const DRAPE = drapeOptionsFrom((k) => params.get(k));
const state = {
  productId: params.get('product') ?? '',
  body: 'mannequin' as BodyMode,
  custom: { ...MANNEQUIN } as BodyMeasurements,
  size: params.get('size') ?? '',
  layout: (params.get('layout') === 'side' ? 'side' : 'toggle') as Layout,
  fabric: ((FABRIC_PRESETS as readonly string[]).includes(params.get('fabric') ?? '') ? params.get('fabric') : 'product') as FabricPreset,
  heat: params.get('heat') === '1',
  outlines: params.get('outlines') === '1',
};

const stage = new Stage($<HTMLCanvasElement>('stage'), { controls: true });
const sessions = new Map<string, GarmentSession>();
const avatars = new Map<string, { avatar: Avatar; field: BodyField; geometry: THREE.BufferGeometry }>();
const fitResults = new Map<string, FitResult>();
interface LiveFit extends FitInstance {
  startedAt: number;
  /** Wall time from start to settled, ms. */
  settledMs: number | null;
  /** Solver time, ms (worker compute, or main-thread stepping). */
  computeMs: number;
  /** Worker job id, or `null` when stepped on the main thread. */
  jobId: number | null;
  /** Positions changed since the figure last showed them. */
  dirty: boolean;
  /** Label anchor points on the model, recomputed when the positions change. */
  labels: { label: AnchorLabel; at: [number, number, number] }[] | null;
}

const fits = new Map<string, LiveFit>();
let pool: DrapePool | null = DrapePool.create((err) => {
  // A worker that fails to load or crashes: step everything that is left on the main thread.
  console.warn('drape worker failed, stepping on the main thread', err);
  pool = null;
  for (const f of fits.values()) f.jobId = null;
});
document.documentElement.dataset.drapeWorkers = String(pool?.size ?? 0);
const outlines = new Outlines(stage);
let outlineKey = '';
let figures: Figure[] = [];
let figureProduct = '';
let shown: { size: string; key: string; figure: Figure }[] = [];
let heatBuffer = new Float32Array(0);

const measurements = (): BodyMeasurements => (state.body === 'mannequin' ? MANNEQUIN : state.custom);
const bodyKey = (b: BodyMeasurements): string => `${b.bust}/${b.waist}/${b.hip}`;

function avatarFor(b: BodyMeasurements) {
  const k = bodyKey(b);
  let a = avatars.get(k);
  if (!a) {
    const avatar = buildAvatar(m, canonical, b);
    a = { avatar, field: bodyField(m, avatar), geometry: meshGeometry(avatar.mesh) };
    avatars.set(k, a);
  }
  return a;
}

function fitFor(session: GarmentSession, b: BodyMeasurements): FitResult {
  const k = `${session.bundle.productId}|${bodyKey(b)}`;
  let r = fitResults.get(k);
  if (!r) {
    r = fitForBody(session.payload, b);
    fitResults.set(k, r);
  }
  return r;
}

/** The sizes shown side by side: `?sizes=` when the chart has all of them, else the selected size and its neighbours. */
function shownSizes(labels: readonly string[], size: string): string[] {
  return fixedSizes.length > 1 && fixedSizes.every((x) => labels.includes(x)) ? [...fixedSizes] : trioAround(labels, size);
}

/** The selected size and its neighbours (three when the chart has them). */
function trioAround(labels: readonly string[], size: string): string[] {
  if (labels.length <= 3) return [...labels];
  const i = Math.max(0, labels.indexOf(size));
  const lo = Math.max(0, Math.min(i - 1, labels.length - 3));
  return labels.slice(lo, lo + 3);
}

async function session(): Promise<GarmentSession> {
  let s = sessions.get(state.productId);
  if (!s) {
    const bundle = await loadBundle(fetch, state.productId);
    s = openSession(m, bundle);
    sessions.set(state.productId, s);
  }
  return s;
}

function pressed(container: HTMLElement, attr: string, value: string): void {
  for (const b of container.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
}

function renderSizeButtons(s: GarmentSession, fit: FitResult): void {
  const box = $('sizes');
  box.replaceChildren(
    ...sizeLabels(s).map((label) => {
      const b = document.createElement('button');
      b.textContent = label === fit.recommendedSize ? `${label} ★` : label;
      b.dataset.size = label;
      b.dataset.testid = `size-${label}`;
      b.setAttribute('aria-pressed', String(label === state.size));
      b.addEventListener('click', () => {
        state.size = label;
        void refresh();
      });
      return b;
    }),
  );
}

let generation = 0;

async function refresh(): Promise<void> {
  const gen = ++generation;
  try {
    setViewerState('loading');
    const s = await session();
    if (gen !== generation) return; // a newer refresh took over while the bundle loaded
    const labels = sizeLabels(s);
    if (!labels.includes(state.size)) state.size = labels.includes(s.bundle.grading.baseSize) ? s.bundle.grading.baseSize : labels[0]!;
    const b = measurements();
    const av = avatarFor(b);
    const fit = fitFor(s, b);
    const vm = viewerMaterial(state.fabric, s.bundle.material);
    const sizes = state.layout === 'side' ? shownSizes(labels, state.size) : [state.size];

    if (figureProduct !== state.productId || figures.length !== sizes.length) {
      for (const f of figures) {
        stage.scene.remove(f.group);
        f.dispose();
      }
      const n = s.bundle.baseMesh.positions.length / 3;
      const tex = s.bundle.render && s.bundle.textureImage ? { ...s.bundle.render, image: s.bundle.textureImage } : null;
      figures = sizes.map(() => new Figure(av.geometry, s.bundle.baseMesh.indices, n, tex));
      figures.forEach((f, k) => {
        f.group.position.x = (k - (sizes.length - 1) / 2) * SPACING_CM;
        f.group.rotation.y = (viewYawDeg * Math.PI) / 180;
        stage.scene.add(f.group);
      });
      figureProduct = state.productId;
      stage.frame((sizes.length - 1) * SPACING_CM + 60);
    }
    shown = sizes.map((size, k) => {
      const key = ensureFit(s, size);
      const figure = figures[k]!;
      figure.setBody(av.geometry);
      figure.setMaterial(vm);
      figure.setPositions(fits.get(key)!.cloth.pos);
      return { size, key, figure };
    });
    cancelStale();
    updateHeat();
    outlineKey = '';
    $('outline-legend').hidden = !state.outlines;

    renderSizeButtons(s, fit);
    pressed($('layout'), 'layout', state.layout);
    pressed($('fabric'), 'fabric', state.fabric);
    $('legend').hidden = !state.heat;
    const conf = Math.round(fit.confidence * 100);
    $('advice').textContent = fit.recommendedSize
      ? `Fit engine: size ${fit.recommendedSize} (confidence ${conf} %).`
      : `Fit engine: nothing fits well; closest is ${fit.closestSize ?? 'none'}.`;
    $('fabric-info').textContent = `${vm.label}: drape ${vm.drape}, bend ${vm.bendStiffness}, sheen ${vm.sheen}, stretch ${vm.stretchPct} %, ${vm.weightGsm} g/m².`;
    const qa = s.bundle.qa;
    $('qa').textContent = `${s.bundle.anchors.category}, base ${s.bundle.grading.baseSize}, ${qa.meshHealth.triangles.toLocaleString('en')} triangles. ${chartCaption(qa)}${qa.synthetic ? ' Synthetic.' : ''}`;
    renderLines();
    setViewerState('draping');
  } catch (err) {
    setViewerState('error');
    $('status').innerHTML = '';
    const e = document.createElement('span');
    e.className = 'error';
    e.textContent = err instanceof Error ? err.message : String(err);
    $('status').append(e);
  }
}

const fitKey = (size: string): string => `${state.productId}|${size}|${bodyKey(measurements())}|${state.fabric}`;

/** The fit of a size for the current product, body and fabric: cached, or prepared and sent to a worker. */
function ensureFit(s: GarmentSession, size: string): string {
  const key = fitKey(size);
  if (fits.has(key)) return key;
  const b = measurements();
  const av = avatarFor(b);
  const f: LiveFit = { ...prepareFit(s, av.avatar, av.field, fitFor(s, b), size, viewerMaterial(state.fabric, s.bundle.material), 1.5, DRAPE), startedAt: performance.now(), settledMs: null, computeMs: 0, jobId: null, dirty: true, labels: null };
  fits.set(key, f);
  if (pool) {
    f.jobId = pool.start(drapeJobOf(f), (p) => {
      f.cloth.pos.set(p.pos);
      f.cloth.time = p.time;
      f.cloth.calmFrames = p.calmFrames;
      f.computeMs = p.computeMs;
      f.dirty = true;
      f.labels = null;
      if (p.done) {
        f.jobId = null;
        f.settledMs = performance.now() - f.startedAt;
      }
    });
  }
  return key;
}

/**
 * Cancel drapes still running for another product, body or fabric (typing three measurements fires
 * three refreshes; their drapes would otherwise queue ahead of the one on screen). Unfinished fits
 * are dropped from the cache; finished ones stay.
 */
function cancelStale(): void {
  const prefix = `${state.productId}|`;
  const suffix = `|${bodyKey(measurements())}|${state.fabric}`;
  for (const [key, f] of fits) {
    if (f.jobId === null || (key.startsWith(prefix) && key.endsWith(suffix))) continue;
    pool?.cancel(f.jobId);
    fits.delete(key);
  }
}

const settled = (f: LiveFit): boolean => f.jobId === null && isSettled(f.cloth, f.params);

/** Once the shown sizes have settled, drape the neighbouring sizes in the background (workers only). */
function prefetch(): void {
  const s = sessions.get(state.productId);
  if (!s || !pool || pool.pending > 0) return;
  for (const size of shownSizes(sizeLabels(s), state.size)) ensureFit(s, size);
}

function renderLines(): void {
  const list = $('lines');
  list.replaceChildren();
  const showFor = state.layout === 'side' ? shown : shown.filter((x) => x.size === state.size);
  for (const { size, key } of showFor) {
    const f = fits.get(key)!;
    if (f.lines.length === 0) {
      const li = document.createElement('li');
      li.textContent = `${size}: the fit engine has no fit points for this garment and body.`;
      list.append(li);
    }
    for (const line of f.lines) {
      const li = document.createElement('li');
      li.className = line.tone;
      li.textContent = state.layout === 'side' ? `${size}: ${line.text}` : line.text;
      list.append(li);
    }
  }
}

function updateHeat(): void {
  const s = sessions.get(state.productId);
  if (!s) return;
  for (const { key, figure } of shown) {
    if (!state.heat) {
      figure.setHeat(null);
      continue;
    }
    const f = fits.get(key)!;
    if (heatBuffer.length !== f.cloth.pos.length) heatBuffer = new Float32Array(f.cloth.pos.length);
    figure.setHeat(heatFor(f, s.chains, heatBuffer));
  }
}

function updateLabels(): void {
  const box = $('labels');
  const anchorsBox = $('anchor-labels');
  if (state.layout !== 'side') {
    if (box.childElementCount) box.replaceChildren();
    if (anchorsBox.childElementCount) anchorsBox.replaceChildren();
    return;
  }
  const rec = fitResults.get(`${state.productId}|${bodyKey(measurements())}`)?.recommendedSize;
  while (box.childElementCount < shown.length) box.append(document.createElement('div'));
  while (box.childElementCount > shown.length) box.lastElementChild!.remove();
  shown.forEach(({ size, figure }, k) => {
    const p = stage.toScreen(new THREE.Vector3(figure.group.position.x, 4, 0));
    const el = box.children[k] as HTMLElement;
    el.textContent = size === rec ? `${size} ★` : size;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  });
  // Per-anchor numbers on the model: the graded garment value and the fit engine's gap.
  const s = sessions.get(state.productId);
  const items: { text: string; x: number; y: number }[] = [];
  const toCamera = new THREE.Vector3();
  for (const { key, figure } of shown) {
    const f = fits.get(key);
    // The labels sit on the unturned front; a turned figure (`view=`) shows none.
    if (!f || !s || viewYawDeg !== 0) continue;
    if (!f.labels) {
      f.labels = [];
      for (const label of anchorLabels(s.bundle.grading, f.size, f.gaps, m.morphHeights)) {
        const at = frontAt(f.cloth.pos, f.chains, label.height);
        if (at) f.labels.push({ label, at });
      }
    }
    for (const { label, at } of f.labels) {
      const world = new THREE.Vector3(at[0] + figure.group.position.x, at[1], at[2] + 0.5);
      // Only while the front of the garment faces the camera.
      if (toCamera.copy(stage.camera.position).sub(world).z <= 0) continue;
      const p = stage.toScreen(world);
      items.push({ text: label.text, x: p.x, y: p.y });
    }
  }
  while (anchorsBox.childElementCount < items.length) anchorsBox.append(document.createElement('div'));
  while (anchorsBox.childElementCount > items.length) anchorsBox.lastElementChild!.remove();
  items.forEach((it, k) => {
    const el = anchorsBox.children[k] as HTMLElement;
    if (el.textContent !== it.text) el.textContent = it.text;
    el.style.left = `${it.x}px`;
    el.style.top = `${it.y}px`;
  });
}

/** Outline colours, smallest size first; the smallest is dashed so the order reads without colour too. */
const OUTLINE_COLOURS = ['#2166ab', '#1a1612', '#ff5a3c'] as const;

/** Silhouette outlines of the selected size and its neighbours, overlaid on the selected size's figure. */
function updateOutlines(): void {
  const s = sessions.get(state.productId);
  const anchor = shown.find((x) => x.size === state.size) ?? shown[0];
  // Only the figure under the outlines is see-through; its neighbours stay as they are.
  for (const { figure } of shown) figure.setFaded(state.outlines && figure === anchor?.figure);
  if (!state.outlines || !s) {
    if (outlineKey !== 'off') outlines.clear();
    outlineKey = 'off';
    return;
  }
  const trio = trioAround(sizeLabels(s), state.size);
  const keys = trio.map((size) => ensureFit(s, size));
  const stamp = `${keys.map((k) => `${k}@${fits.get(k)!.cloth.time.toFixed(3)}`).join(',')}|${anchor?.figure.group.position.x}`;
  if (stamp === outlineKey) return;
  outlineKey = stamp;
  const specs: OutlineSpec[] = trio.map((size, k) => {
    const f = fits.get(keys[k]!)!;
    return { size, points: frontOutline(f.cloth.pos, f.chains), color: OUTLINE_COLOURS[k] ?? '#1a1612', dashed: k === 0 };
  });
  outlines.set(specs, anchor?.figure.group.position.x ?? 0);
  $('outline-legend').replaceChildren(
    ...specs.map((sp) => {
      const span = document.createElement('span');
      span.style.color = sp.color;
      const i = document.createElement('i');
      if (sp.dashed) i.className = 'dashed';
      const t = document.createElement('b');
      t.textContent = sp.size;
      t.style.color = 'var(--ink)';
      span.append(i, t);
      return span;
    }),
  );
}

const BUDGET_MS = 14;

function tick(): void {
  const t0 = performance.now();
  // Main-thread fallback: fits without a worker job are stepped round-robin within a frame budget.
  const local = shown.map(({ key }) => fits.get(key)!).filter((f) => f.jobId === null && !isSettled(f.cloth, f.params));
  let progressed = local.length > 0;
  while (progressed && performance.now() - t0 < BUDGET_MS) {
    progressed = false;
    for (const f of local) {
      if (isSettled(f.cloth, f.params)) continue;
      const s0 = performance.now();
      stepCloth(f.cloth, f.params, f.collide, 1);
      f.computeMs += performance.now() - s0;
      f.dirty = true;
      f.labels = null;
      progressed = true;
      if (isSettled(f.cloth, f.params)) f.settledMs = performance.now() - f.startedAt;
    }
  }
  const s = sessions.get(state.productId);
  for (const { key, figure } of shown) {
    const f = fits.get(key)!;
    if (!f.dirty) continue;
    figure.setPositions(f.cloth.pos);
    f.dirty = false;
    if (state.heat && s) {
      if (heatBuffer.length !== f.cloth.pos.length) heatBuffer = new Float32Array(f.cloth.pos.length);
      figure.setHeat(heatFor(f, s.chains, heatBuffer));
    }
  }
  const all = shown.map(({ key }) => fits.get(key)!);
  const status = $('status');
  if (document.documentElement.dataset.viewerState !== 'error' && all.length > 0) {
    const done = all.every(settled);
    if (done) {
      const per = shown.map(({ size }, k) => `${size} ${((all[k]!.settledMs ?? 0) / 1000).toFixed(2)} s`).join(', ');
      const where = pool ? `${pool.size} worker${pool.size === 1 ? '' : 's'}` : 'main thread';
      status.textContent = `Settled (${where}): ${per}; cloth ${Math.max(...all.map((f) => f.cloth.time)).toFixed(2)} s at most.`;
      if (document.documentElement.dataset.viewerState === 'draping') {
        const m0 = sessions.get(state.productId)!.m;
        document.documentElement.dataset.settle = JSON.stringify(shown.map(({ size, key }, k) => ({ key, size, ms: Math.round(all[k]!.settledMs ?? 0), computeMs: Math.round(all[k]!.computeMs), clothS: Math.round(all[k]!.cloth.time * 100) / 100 })));
        document.documentElement.dataset.neckStrain = String(Math.max(...all.map((f) => necklineStrain(f, m0))));
        setViewerState('settled');
      }
      prefetch();
    } else {
      const simT = Math.min(...all.map((f) => f.cloth.time));
      status.textContent = `Draping ${shown.map((x) => x.size).join(', ')}… ${simT.toFixed(1)} / ${all[0]!.params.durationS} s`;
    }
  }
  updateOutlines();
  stage.render();
  outlines.resize();
  updateLabels();
  requestAnimationFrame(tick);
}

function wire(): void {
  $<HTMLSelectElement>('product').addEventListener('change', (e) => {
    state.productId = (e.target as HTMLSelectElement).value;
    state.size = '';
    void refresh();
  });
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="body"]')) {
    r.addEventListener('change', () => {
      state.body = r.value === 'custom' ? 'custom' : 'mannequin';
      void refresh();
    });
  }
  const ids = { bust: 'm-bust', waist: 'm-waist', hip: 'm-hip' } as const;
  for (const [k, id] of Object.entries(ids) as [keyof BodyMeasurements, string][]) {
    const input = $<HTMLInputElement>(id);
    input.value = String(state.custom[k]);
    input.addEventListener('change', () => {
      state.custom = sanitiseMeasurements({ ...state.custom, [k]: input.value }, state.custom);
      for (const [kk, iid] of Object.entries(ids) as [keyof BodyMeasurements, string][]) $<HTMLInputElement>(iid).value = String(state.custom[kk]);
      state.body = 'custom';
      document.querySelector<HTMLInputElement>('input[name="body"][value="custom"]')!.checked = true;
      void refresh();
    });
  }
  for (const b of $('layout').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      state.layout = b.dataset.layout === 'side' ? 'side' : 'toggle';
      void refresh();
    });
  }
  for (const b of $('fabric').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      state.fabric = (b.dataset.fabric ?? 'product') as FabricPreset;
      void refresh();
    });
  }
  const heat = $<HTMLInputElement>('heat');
  heat.checked = state.heat;
  heat.addEventListener('change', () => {
    state.heat = heat.checked;
    $('legend').hidden = !state.heat;
    updateHeat();
  });
  const outlineBox = $<HTMLInputElement>('outlines');
  outlineBox.checked = state.outlines;
  outlineBox.addEventListener('change', () => {
    state.outlines = outlineBox.checked;
    $('outline-legend').hidden = !state.outlines;
    outlineKey = '';
  });
  $('reset').addEventListener('click', () => stage.frame((shown.length - 1) * SPACING_CM + 60));
  $('redrape').addEventListener('click', () => {
    for (const { key } of shown) {
      const f = fits.get(key);
      if (f?.jobId != null) pool?.cancel(f.jobId);
      fits.delete(key);
    }
    void refresh();
  });
}

async function start(): Promise<void> {
  setViewerState('loading');
  if (SHAPE !== BASE_SHAPE_ID) $('mannequin-label').textContent = `Canonical shape ${SHAPE} (M mannequin at ${MANNEQUIN.bust}/${MANNEQUIN.waist}/${MANNEQUIN.hip})`;
  wire();
  try {
    const { products, hint } = await listBundles(fetch);
    if (products.length === 0) throw new Error(hint ?? 'No bundles in out/.');
    const select = $<HTMLSelectElement>('product');
    select.replaceChildren(...products.map((p) => Object.assign(document.createElement('option'), { value: p, textContent: p })));
    if (!products.includes(state.productId)) state.productId = products[0]!;
    select.value = state.productId;
  } catch (err) {
    setViewerState('error');
    $('status').textContent = err instanceof Error ? err.message : String(err);
    return;
  }
  await refresh();
  requestAnimationFrame(tick);
}

void start();
