/**
 * Blind test page (blind.html) for the Phase 0 size and fabric tests: two settled renders of the
 * same product side by side on the canonical mannequin, in two sizes (or linen versus silk), in a
 * seeded random order and with no labels anywhere on the page. Answers stay in localStorage until
 * exported as CSV. `document.documentElement.dataset.blindState` is `setup`, `preparing`, `ready`
 * or `done`.
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { bodyField, buildAvatar, mannequinMeasurements } from './body';
import { listBundles, loadBundle } from './bundle';
import { makeTrials, parseStored, respond, summarise, toCsv, type BlindMode, type BlindResponse, type BlindTrial, type Side } from './blind';
import { openSession, prepareFit, relax, sizeLabels, viewerMaterial, type GarmentSession } from './engine';
import { fitForBody } from './fitting';
import { Figure, Stage, meshGeometry } from './scene';

const STORE_KEY = 'curtain.spike.blind.v1';
const SPACING_CM = 80;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
const setState = (s: 'setup' | 'preparing' | 'ready' | 'done'): void => {
  document.documentElement.dataset.blindState = s;
};

function loadRows(): BlindResponse[] {
  try {
    return parseStored(localStorage.getItem(STORE_KEY));
  } catch {
    return [];
  }
}
function saveRows(rows: readonly BlindResponse[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rows));
  } catch {
    $('count').textContent = 'Could not save to this browser (storage blocked); export before closing the tab.';
  }
}

let rows = loadRows();
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const meas = mannequinMeasurements(m);
const avatar = buildAvatar(m, buildMannequinMesh(m), meas);
const field = bodyField(m, avatar);
const bodyGeometry = meshGeometry(avatar.mesh);
const stage = new Stage($<HTMLCanvasElement>('stage'), { controls: true, autoRotate: true });
const sessions = new Map<string, GarmentSession>();
const settled = new Map<string, Float32Array>();
let figures: Figure[] = [];
let figuresFor = '';

const run = { participant: '', mode: 'size' as BlindMode, seed: 0, trials: [] as BlindTrial[], k: 0, shownAt: 0 };

function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

async function session(id: string): Promise<GarmentSession> {
  let s = sessions.get(id);
  if (!s) {
    s = openSession(m, await loadBundle(fetch, id));
    sessions.set(id, s);
  }
  return s;
}

/** Settled garment for one side: a size with the product's fabric, or the base size in linen or silk. */
function settledFor(s: GarmentSession, mode: BlindMode, variant: string): { pos: Float32Array; material: ReturnType<typeof viewerMaterial> } {
  const material = viewerMaterial(mode === 'fabric' ? (variant === 'silk' ? 'silk' : 'linen') : 'product', s.bundle.material);
  const size = mode === 'fabric' ? s.bundle.grading.baseSize : variant;
  const key = `${s.bundle.productId}|${mode}|${variant}`;
  let pos = settled.get(key);
  if (!pos) {
    pos = relax(prepareFit(s, avatar, field, fitForBody(s.payload, meas), size, material));
    settled.set(key, pos);
  }
  return { pos, material };
}

function renderSummary(): void {
  $('count').textContent = `${rows.length} answer${rows.length === 1 ? '' : 's'} stored.`;
  const table = $('summary');
  table.replaceChildren(
    ...summarise(rows).map((s) => {
      const tr = document.createElement('tr');
      for (const text of [s.participant, s.mode, `${s.correct}/${s.trials} right`, `${s.productsRight}/${s.products} products`]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
}

function show(section: 'setup' | 'trial' | 'done'): void {
  for (const id of ['setup', 'trial', 'done'] as const) $(id).hidden = id !== section;
}

async function showTrial(): Promise<void> {
  const trial = run.trials[run.k]!;
  setState('preparing');
  $<HTMLButtonElement>('pick-left').disabled = true;
  $<HTMLButtonElement>('pick-right').disabled = true;
  $('progress').textContent = `Pair ${run.k + 1} of ${run.trials.length}`;
  $('question').textContent = run.mode === 'size' ? 'Which one is the smaller size?' : 'Which one is silk?';
  $('status').textContent = 'Preparing…';
  figures.forEach((f) => (f.group.visible = false));
  await new Promise((r) => setTimeout(r, 30)); // let the page paint before the synchronous drape
  const s = await session(trial.productId);
  if (figuresFor !== trial.productId) {
    for (const f of figures) {
      stage.scene.remove(f.group);
      f.dispose();
    }
    const n = s.bundle.baseMesh.positions.length / 3;
    figures = [-1, 1].map((x) => {
      const f = new Figure(bodyGeometry, s.bundle.baseMesh.indices, n);
      f.group.position.x = (x * SPACING_CM) / 2;
      stage.scene.add(f.group);
      return f;
    });
    figuresFor = trial.productId;
  }
  ([trial.left, trial.right] as const).forEach((variant, i) => {
    const { pos, material } = settledFor(s, run.mode, variant);
    figures[i]!.setMaterial(material);
    figures[i]!.setPositions(pos);
    figures[i]!.setHeat(null);
    figures[i]!.group.visible = true;
  });
  stage.frame(SPACING_CM + 60);
  $('status').textContent = '';
  $<HTMLButtonElement>('pick-left').disabled = false;
  $<HTMLButtonElement>('pick-right').disabled = false;
  run.shownAt = performance.now();
  setState('ready');
}

function pick(side: Side): void {
  if (document.documentElement.dataset.blindState !== 'ready') return;
  const trial = run.trials[run.k]!;
  rows = [...rows, respond(trial, { participant: run.participant, seed: run.seed, chosen: side, responseMs: performance.now() - run.shownAt, at: new Date() })];
  saveRows(rows);
  renderSummary();
  run.k++;
  if (run.k < run.trials.length) {
    void showTrial();
    return;
  }
  const mine = summarise(rows.filter((r) => r.participant === run.participant && r.seed === run.seed))[0];
  $('done-text').textContent = mine ? `Thank you. ${mine.correct} of ${mine.trials} pairs answered.` : 'Thank you.';
  figures.forEach((f) => (f.group.visible = false));
  show('done');
  setState('done');
}

async function start(): Promise<void> {
  setState('setup');
  renderSummary();
  run.seed = newSeed();
  $('seed').textContent = String(run.seed);
  try {
    const { products, hint } = await listBundles(fetch);
    if (products.length === 0) throw new Error(hint ?? 'No bundles in out/.');
    $('products').replaceChildren(
      ...products.map((p) => {
        const label = document.createElement('label');
        label.className = 'row';
        const box = Object.assign(document.createElement('input'), { type: 'checkbox', value: p, checked: true });
        label.append(box, document.createTextNode(` ${p}`));
        return label;
      }),
    );
  } catch (err) {
    $('status').textContent = err instanceof Error ? err.message : String(err);
  }

  $('start').addEventListener('click', async () => {
    const participant = $<HTMLInputElement>('participant').value.trim();
    if (!participant) {
      $<HTMLInputElement>('participant').focus();
      return;
    }
    const ids = [...document.querySelectorAll<HTMLInputElement>('#products input:checked')].map((b) => b.value);
    if (ids.length === 0) return;
    run.participant = participant;
    run.mode = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value === 'fabric' ? 'fabric' : 'size';
    const products = await Promise.all(ids.map(async (id) => ({ id, sizes: sizeLabels(await session(id)) })));
    run.trials = makeTrials(run.mode, products, run.seed);
    run.k = 0;
    show('trial');
    await showTrial();
  });
  $('pick-left').addEventListener('click', () => pick('left'));
  $('pick-right').addEventListener('click', () => pick('right'));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') pick('left');
    if (e.key === 'ArrowRight') pick('right');
  });
  $('next').addEventListener('click', () => {
    run.seed = newSeed();
    $('seed').textContent = String(run.seed);
    $<HTMLInputElement>('participant').value = '';
    show('setup');
    setState('setup');
  });
  $('export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `curtain-blind-test-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('clear').addEventListener('click', () => {
    if (!confirm(`Delete all ${rows.length} stored answers on this device?`)) return;
    rows = [];
    saveRows(rows);
    renderSummary();
  });

  const loop = (): void => {
    stage.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void start();
