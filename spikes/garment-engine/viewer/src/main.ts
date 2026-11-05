/**
 * Spike viewer page (index.html): a spike bundle on the canonical mannequin or a body from typed
 * measurements, graded to a size, placed anchor by anchor from the fit engine's gaps, relaxed with a
 * short cloth simulation, with size switching, a fit map and two fabric presets.
 *
 * `document.documentElement.dataset.viewerState` is `loading`, `draping`, `settled` or `error`
 * (the smoke script waits on it).
 */
import * as THREE from 'three';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import type { FitResult } from '@curtain/fit-engine';
import { bodyField, buildAvatar, mannequinMeasurements, sanitiseMeasurements, type Avatar, type BodyField, type BodyMeasurements } from './body';
import { listBundles, loadBundle } from './bundle';
import { stepCloth, isSettled } from './cloth';
import { FABRIC_PRESETS, heatFor, openSession, prepareFit, sizeLabels, viewerMaterial, type FabricPreset, type FitInstance, type GarmentSession } from './engine';
import { fitForBody } from './fitting';
import { Figure, Stage, meshGeometry } from './scene';

type Layout = 'toggle' | 'side';
type BodyMode = 'mannequin' | 'custom';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
const setViewerState = (s: 'loading' | 'draping' | 'settled' | 'error'): void => {
  document.documentElement.dataset.viewerState = s;
};

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canonical = buildMannequinMesh(m);
const MANNEQUIN = mannequinMeasurements(m);
const SPACING_CM = 78;

const params = new URLSearchParams(location.search);
const state = {
  productId: params.get('product') ?? '',
  body: 'mannequin' as BodyMode,
  custom: { ...MANNEQUIN } as BodyMeasurements,
  size: params.get('size') ?? '',
  layout: (params.get('layout') === 'side' ? 'side' : 'toggle') as Layout,
  fabric: ((FABRIC_PRESETS as readonly string[]).includes(params.get('fabric') ?? '') ? params.get('fabric') : 'product') as FabricPreset,
  heat: params.get('heat') === '1',
};

const stage = new Stage($<HTMLCanvasElement>('stage'), { controls: true });
const sessions = new Map<string, GarmentSession>();
const avatars = new Map<string, { avatar: Avatar; field: BodyField; geometry: THREE.BufferGeometry }>();
const fitResults = new Map<string, FitResult>();
const fits = new Map<string, FitInstance & { startedAt: number; settledMs: number | null }>();
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
    const sizes = state.layout === 'side' ? trioAround(labels, state.size) : [state.size];

    if (figureProduct !== state.productId || figures.length !== sizes.length) {
      for (const f of figures) {
        stage.scene.remove(f.group);
        f.dispose();
      }
      const n = s.bundle.baseMesh.positions.length / 3;
      figures = sizes.map(() => new Figure(av.geometry, s.bundle.baseMesh.indices, n));
      figures.forEach((f, k) => {
        f.group.position.x = (k - (sizes.length - 1) / 2) * SPACING_CM;
        stage.scene.add(f.group);
      });
      figureProduct = state.productId;
      stage.frame((sizes.length - 1) * SPACING_CM + 60);
    }
    shown = sizes.map((size, k) => {
      const key = `${state.productId}|${size}|${bodyKey(b)}|${state.fabric}`;
      if (!fits.has(key)) fits.set(key, { ...prepareFit(s, av.avatar, av.field, fit, size, vm), startedAt: performance.now(), settledMs: null });
      const figure = figures[k]!;
      figure.setBody(av.geometry);
      figure.setMaterial(vm);
      figure.setPositions(fits.get(key)!.cloth.pos);
      return { size, key, figure };
    });
    updateHeat();

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
    $('qa').textContent = `${s.bundle.anchors.category}, base ${s.bundle.grading.baseSize}, ${qa.meshHealth.triangles.toLocaleString('en')} triangles. Chart agreement ${qa.chartAgreement.pass ? 'pass' : 'FAIL'}; residual after global scale ${qa.calibration.residualAfterGlobalCm.maxAbs} cm.${qa.synthetic ? ' Synthetic.' : ''}`;
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
  if (state.layout !== 'side') {
    if (box.childElementCount) box.replaceChildren();
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
}

const BUDGET_MS = 14;

function tick(): void {
  const t0 = performance.now();
  const pending = shown.filter(({ key }) => {
    const f = fits.get(key)!;
    return !isSettled(f.cloth, f.params);
  });
  if (pending.length > 0) {
    // Round-robin one frame per pending figure until the budget is spent.
    let progressed = true;
    while (progressed && performance.now() - t0 < BUDGET_MS) {
      progressed = false;
      for (const { key } of pending) {
        const f = fits.get(key)!;
        if (isSettled(f.cloth, f.params)) continue;
        stepCloth(f.cloth, f.params, f.collide, 1);
        progressed = true;
        if (isSettled(f.cloth, f.params)) f.settledMs = performance.now() - f.startedAt;
      }
    }
    for (const { key, figure } of pending) figure.setPositions(fits.get(key)!.cloth.pos);
    if (state.heat) updateHeat();
  }
  const all = shown.map(({ key }) => fits.get(key)!);
  const status = $('status');
  if (document.documentElement.dataset.viewerState !== 'error' && all.length > 0) {
    const done = all.every((f) => isSettled(f.cloth, f.params));
    const simT = Math.min(...all.map((f) => f.cloth.time));
    if (done) {
      const ms = Math.max(...all.map((f) => f.settledMs ?? 0));
      status.textContent = `Settled: ${all[0]!.params.durationS} s of cloth in ${(ms / 1000).toFixed(2)} s (${shown.map((x) => x.size).join(', ')}).`;
      if (document.documentElement.dataset.viewerState === 'draping') setViewerState('settled');
    } else status.textContent = `Draping ${shown.map((x) => x.size).join(', ')}… ${simT.toFixed(1)} / ${all[0]!.params.durationS} s`;
  }
  stage.render();
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
  $('reset').addEventListener('click', () => stage.frame((shown.length - 1) * SPACING_CM + 60));
  $('redrape').addEventListener('click', () => {
    for (const { key } of shown) fits.delete(key);
    void refresh();
  });
}

async function start(): Promise<void> {
  setViewerState('loading');
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
