/**
 * The Phase 0 write-up for the bohohippychic.com.au validation set
 * (docs/research/phase0-bohohippychic.md), generated from whatever exists: the committed selection
 * (data/bohohippychic/products.json, images.json), the GPU stages' records in each job dir, the
 * evaluation of each stage 4 mesh, and the headless renders. Pure: data in, Markdown out.
 *
 * Rules the text follows: a stage that has not run says "not run"; no number appears that a record
 * or a measurement did not produce; every cost is labelled an estimate (list price × seconds) until
 * someone reads the Modal invoice; renders live under `out/` and are linked, not committed.
 */
import { CATEGORY_ANCHORS } from '@curtain/anchors';
import type { GarmentPayload } from '@curtain/schema';
import { CHART_TOLERANCE_CM, SOURCE_LABEL } from './eval';
import { evalMaterial } from './evalBundle';
import { arr, num, obj, str, type CostRecord, type JobFiles, type ProductEval } from './evalJob';
import { VIEW_IOU_PASS } from './evalView';

export interface ShopImage {
  position: number;
  role: string;
  onModel: boolean;
  background: string;
  garmentFullyVisible: boolean;
  notes: string;
  width: number;
  height: number;
  sha256: string;
}

export interface ShopProduct {
  handle: string;
  productType: string;
  payload: GarmentPayload;
  baseSize: string;
  why: string;
  runnersUp: { handle: string; whyNot: string }[];
  warnings: string[];
  threeD: { ready: boolean; reasons: string[] };
  completeness: { score: number; status: string } | null;
  /** The shop's printed garment measurements per size (from the selection's evidence), when it printed any. */
  printed?: PrintedRow[];
}

/** One row of a shop's printed garment table, cm. `Length` is read as shoulder to hem, as the payload's `lengthCm` does. */
export interface PrintedRow {
  size: string;
  values: Partial<Record<'chest' | 'waist' | 'hip' | 'shoulder_to_hem', number>>;
}

const PRINTED_COLUMNS: Readonly<Record<string, keyof PrintedRow['values']>> = { bust: 'chest', chest: 'chest', waist: 'waist', hip: 'hip', hips: 'hip', length: 'shoulder_to_hem' };

/**
 * Parses the selection's `evidence.printedTable` (`size-per-row: "Size Bust Length 8 94cm 90cm 10 …"`).
 * Returns [] when the text is not a size-per-row table with known column names.
 */
export function parsePrintedTable(evidence: string | null | undefined): PrintedRow[] {
  const m = evidence?.match(/size-per-row:\s*"([^"]*)"/i);
  if (!m) return [];
  const tokens = m[1]!.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() !== 'size') return [];
  const cols: (keyof PrintedRow['values'] | null)[] = [];
  let i = 1;
  while (i < tokens.length && !/\d/.test(tokens[i]!)) cols.push(PRINTED_COLUMNS[tokens[i++]!.toLowerCase()] ?? null);
  if (cols.length === 0) return [];
  const rows: PrintedRow[] = [];
  while (i + cols.length < tokens.length) {
    const size = tokens[i]!;
    const values: PrintedRow['values'] = {};
    for (let c = 0; c < cols.length; c++) {
      const v = Number.parseFloat((tokens[i + 1 + c] ?? '').replace(/cm$/i, ''));
      if (!Number.isFinite(v)) return [];
      if (cols[c]) values[cols[c]!] = v;
    }
    rows.push({ size, values });
    i += 1 + cols.length;
  }
  return rows;
}

export interface RenderShot {
  /** Path relative to the repository root. */
  file: string;
  shape: 'XS' | 'M' | 'XXL';
  /** Each figure turned about its own axis: front 0°, three-quarter 45°, side 90° (absent in older renders.json: front). */
  view?: 'front' | 'three-quarter' | 'side';
  fitMap: boolean;
  sizes: string[];
  /** Per shown size: drape wall time, ms. */
  settleMs: number[];
}

export interface ProductRenders {
  shots: RenderShot[];
  problems: string[];
}

export interface ProductSection {
  shop: ShopProduct;
  images: ShopImage[];
  job: JobFiles;
  /** Job dir relative to the repository root. */
  jobRel: string;
  eval: ProductEval | null;
  evalError: string | null;
  /** Bundle dir relative to the repository root, when a bundle was written. */
  bundleRel: string | null;
  renders: ProductRenders | null;
}

export interface SyntheticSection {
  productId: string;
  eval: ProductEval | null;
  evalError: string | null;
  bundleRel: string | null;
  renders: ProductRenders | null;
}

export interface ReportInput {
  date: string;
  shop: { domain: string; brand: string; currency: string };
  products: ProductSection[];
  synthetic: SyntheticSection | null;
  /** Blind page with the shop products pre-selected (viewer dev server). */
  blindUrl: string;
  /** Screenshot of that page, relative to the repository root, when the render run made it. */
  blindShot: string | null;
  /** Path from the report's folder to the repository root, for links. */
  toRoot: string;
  /** Clothing categories of the shop without a validation product, with the reason (a deviation the founder confirms). */
  uncoveredCategories?: readonly { productType: string; reason: string }[];
  /** Hand-written Markdown (run history, judgement), inserted verbatim after the acceptance table; its source file is named in `writtenSource`. */
  written?: string | null;
  writtenSource?: string | null;
  /**
   * Set by hand when the current assets are not fit for the five-person panel (why, in one sentence).
   * The size and fabric rows then say not to run the panel yet, so the generated table and the
   * hand-written verdict agree.
   */
  panelHold?: string | null;
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

const cm = (x: number | null | undefined, signed = false): string => (x === null || x === undefined ? '—' : `${signed && x > 0 ? '+' : ''}${x.toFixed(2)}`);
const yes = (b: boolean): string => (b ? 'yes' : 'no');
const usd = (x: number | null): string => (x === null ? '—' : `$${x.toFixed(2)}`);
const secs = (x: number | null): string => (x === null ? '—' : `${x.toFixed(0)} s`);
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const link = (input: ReportInput, rel: string, text = rel): string => `[${text}](${input.toRoot}/${rel.split('/').map(encodeURIComponent).join('/')})`;

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline status from the job dir
// ---------------------------------------------------------------------------

export type StageState = 'done' | 'failed' | 'not run' | 'not built' | 'blocked' | 'n/a';

export interface StageStatus {
  stage: string;
  state: StageState;
  detail: string;
}

/** The front and back photo the selection would use: the first fully visible front, the first back. */
export function plannedPhotos(images: readonly ShopImage[]): { front: ShopImage | null; back: ShopImage | null } {
  return {
    front: images.find((i) => i.role === 'front' && i.garmentFullyVisible) ?? images.find((i) => i.role === 'front') ?? null,
    back: images.find((i) => i.role === 'back') ?? null,
  };
}

export interface UsedInputs {
  exported: boolean;
  sourceKind: string | null;
  /** Photo position per view, matched by sha256 against images.json; null when not matched. */
  front: { path: string; position: number | null } | null;
  back: { path: string; position: number | null } | null;
  inventedBack: boolean | null;
}

export function usedInputs(job: JobFiles, images: readonly ShopImage[]): UsedInputs {
  const s1b = obj(job.manifest?.stage1b);
  if (!job.manifest) return { exported: false, sourceKind: null, front: null, back: null, inventedBack: null };
  if (!s1b) return { exported: true, sourceKind: 'pinned stills supplied directly (no stage 1b)', front: null, back: null, inventedBack: false };
  const find = (role: 'front' | 'back') => {
    const s = arr(s1b.sources).map(obj).find((x) => str(x?.role) === role);
    if (!s) return null;
    const sha = str(s.sha256);
    return { path: str(s.path) ?? '?', position: images.find((i) => i.sha256 === sha)?.position ?? null };
  };
  return { exported: true, sourceKind: str(s1b.source_kind), front: find('front'), back: find('back'), inventedBack: s1b.invented_back === true };
}

export function stageStatuses(p: { shop?: ShopProduct; eval: ProductEval | null; evalError: string | null; bundleRel: string | null }, job: JobFiles | null): StageStatus[] {
  const out: StageStatus[] = [];
  const shop = p.shop ?? null;
  if (shop) {
    out.push({ stage: '1 ingest and validate', state: shop.threeD.ready ? 'done' : 'failed', detail: shop.threeD.ready ? 'photos meet the contract' : `photo contract not met: ${shop.threeD.reasons.join('; ')}` });
  }
  if (!job || !job.exists || !job.manifest) {
    out.push({ stage: 'job export', state: 'blocked', detail: shop ? 'no job dir: `src/product.ts` does not know the shop products yet, so `export:phase0 -- --on-model` cannot export them' : 'no job dir' });
  } else {
    out.push({ stage: 'job export', state: 'done', detail: `job ${str(job.manifest.job_id) ?? '?'}, input hash ${(str(job.manifest.input_hash) ?? '?').slice(0, 12)}` });
  }
  const s1 = job?.stage1b;
  if (job?.manifest && !obj(job.manifest.stage1b)) out.push({ stage: '1b dress the mannequin', state: 'n/a', detail: 'the job pins its stills directly' });
  else if (!s1) out.push({ stage: '1b dress the mannequin', state: 'not run', detail: 'no stage1b/record.json' });
  else {
    const sum = obj(s1.summary);
    const failed = arr(sum?.failed_views).map(String);
    out.push({ stage: '1b dress the mannequin', state: sum?.pass === true ? 'done' : 'failed', detail: `engine ${str(s1.engine) ?? '?'}; QA ${sum?.pass === true ? 'pass' : `failed on ${failed.join(', ') || '?'}`}${s1.invented_back === true ? '; back INVENTED (no back photo)' : ''}${obj(s1)?.accept_failed === true ? '; QA overridden (--accept-failed)' : ''}` });
  }
  const s2 = job?.stage2;
  if (!s2) out.push({ stage: '2 image to video', state: 'not run', detail: 'no stage2/record.json' });
  else {
    const seams = arr(s2.seams).map((x) => num(obj(x)?.mean_abs_diff_8bit)).filter((x): x is number => x !== null);
    out.push({ stage: '2 image to video', state: 'done', detail: `${str(obj(s2.model)?.id) ?? 'model ?'}, ${num(s2.steps) ?? '?'} steps, ${num(s2.turntable_frames_assembled) ?? '?'} turntable frames; seam drift ${seams.length ? seams.map((s) => s.toFixed(1)).join(' / ') : '—'} (8-bit mean abs)` });
  }
  if (job?.stage3Masks) out.push({ stage: '3 separation', state: 'done', detail: `${job.stage3Masks} garment masks` });
  else if (job?.stage2Masks?.count) {
    const rec = job.stage2Masks.record;
    out.push({ stage: '3 separation', state: 'done', detail: `${job.stage2Masks.count} garment masks of the generated frames (\`stage2/garment_mask/\`, ${str(rec?.segmentation) ?? 'segmentation ?'}; ${arr(rec?.ambiguous_frames).length} frames ambiguous with the mannequin); stage 4 trains on them` });
  } else out.push({ stage: '3 separation', state: 'not built', detail: 'no stage 3 on generated frames yet; stage 4 falls back to its foreground mask mode' });
  const s4 = job?.stage4.stage2;
  if (!s4) out.push({ stage: '4 reconstruction', state: 'not run', detail: 'no stage4/stage2/' });
  else {
    const mesh = obj(s4.metrics?.mesh);
    const iou = obj(s4.metrics?.mask_iou);
    out.push({ stage: '4 reconstruction', state: s4.glb ? 'done' : 'failed', detail: s4.glb ? `${num(mesh?.triangles) ?? '?'} triangles, mask IoU train ${num(iou?.train) ?? '—'} / holdout ${num(iou?.holdout) ?? '—'}` : 'metrics without garment.glb' });
  }
  const ev = p.eval;
  if (ev) {
    const r = ev.result;
    out.push({ stage: '5 anchoring and calibration', state: 'done', detail: `${SOURCE_LABEL[r.source.kind]}; global scale ${r.calibration.globalScale.toFixed(3)}` });
    out.push({ stage: '6 grading', state: r.grading ? 'done' : 'failed', detail: r.grading ? `${r.grading.sizes.map((s) => s.size).join(', ')}` : r.gradingError ?? '?' });
    out.push({ stage: '7 QA (chart, view, mesh)', state: 'done', detail: `chart ${r.agreement.pass ? 'pass' : 'FAIL'}, view ${ev.view.views.length ? ev.view.views.map((v) => `${v.view} ${v.iou.toFixed(3)}`).join(', ') : 'no reference'}, ${r.health.triangles} triangles` });
    out.push({ stage: '8 bundle', state: ev.bundle ? 'done' : 'failed', detail: ev.bundle ? `${(ev.bundle.bytes / 1024).toFixed(0)} KB${p.bundleRel ? ` in \`${p.bundleRel}/\`` : ''}` : 'not written (no grading)' });
  } else {
    for (const s of ['5 anchoring and calibration', '6 grading', '7 QA (chart, view, mesh)', '8 bundle']) out.push({ stage: s, state: 'not run', detail: p.evalError ?? 'needs a stage 4 mesh' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Costs and timings
// ---------------------------------------------------------------------------

export interface CostTotal {
  records: CostRecord[];
  gpuSeconds: number | null;
  wallSeconds: number | null;
  usdLow: number | null;
  usdHigh: number | null;
}

export function costTotal(job: JobFiles | null): CostTotal {
  const records = job?.costs ?? [];
  const total = obj(job?.costSummary?.cost_total);
  const sum = (f: (c: CostRecord) => number | null): number | null => {
    const v = records.map(f).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  return {
    records,
    gpuSeconds: num(total?.gpu_seconds) ?? sum((c) => c.gpuSeconds),
    wallSeconds: num(job?.costSummary?.wall_seconds) ?? sum((c) => c.wallSeconds),
    usdLow: num(total?.usd_estimate_low) ?? sum((c) => c.usdLow),
    usdHigh: num(total?.usd_estimate_high) ?? sum((c) => c.usdHigh ?? c.usdLow),
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function evalTables(input: ReportInput, ev: ProductEval, bundleRel: string | null, printed: readonly PrintedRow[] = []): string[] {
  const r = ev.result;
  const out: string[] = [];
  out.push(`Mesh: ${SOURCE_LABEL[r.source.kind]} (\`${r.source.path}\`, sha256 ${r.source.sha256.slice(0, 12)}).${r.source.simulatedError ? ` Simulated reconstruction error applied first: global scale ${r.source.simulatedError.globalScale}, per-ring bias ${Object.entries(r.source.simulatedError.ringBiasCm).map(([k, v]) => `${k} ${v! > 0 ? '+' : ''}${v} cm`).join(', ')}, noise ${r.source.simulatedError.noiseCm} cm.` : ''}`);
  out.push('');
  const nf = r.chart.notFitted;
  out.push(`**Chart agreement** at base size ${r.baseSize} (tolerance ±${r.agreement.toleranceCm} cm at the critical anchors: ${r.critical.join(', ') || 'none'}). Global scale ${r.calibration.globalScale.toFixed(4)}, from ${Object.keys(r.calibration.ringCorrections).join(', ') || 'no ring'}.${nf ? ` The \`${nf.block}\` pattern block does not fit ${nf.rings.join(' and ')} (${nf.label}; the fit engine skips ${nf.rings.length > 1 ? 'them' : 'it'} too), so ${nf.rings.length > 1 ? 'they are' : 'it is'} reported but neither critical nor calibrated.` : ''} Girths are a tape measure round the outside of the slice (\`src/tape.ts\`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.`);
  out.push('');
  out.push(
    table(
      ['Anchor', 'Critical', 'Chart (cm)', 'Ease', 'Reconstructed, tape (cm)', 'Slice polyline (cm)', 'Before', 'After global scale', 'After calibration', 'Pass'],
      r.rows.filter((row) => row.chartCm !== null || row.critical).map((row) => [
        row.anchor,
        yes(row.critical),
        cm(row.chartCm),
        row.ease ? `${cm(row.ease.cm, true)}${row.ease.isDefault ? ' (category default)' : ''}` : '—',
        `${cm(row.measuredCm)}${row.tapeCoverage !== null && row.tapeCoverage < 0.995 ? ` (cloth on ${Math.round(row.tapeCoverage * 100)} % of the way round)` : ''}`,
        row.polylineCm === null ? (row.measuredCm === null ? '—' : 'open or none') : cm(row.polylineCm),
        cm(row.beforeCm, true),
        cm(row.afterGlobalCm, true),
        cm(row.afterCm, true),
        row.pass === null ? (row.notFitted ? 'not fitted' : '—') : row.pass ? 'pass' : `FAIL${row.note ? ` (${row.note})` : ''}`,
      ]),
    ),
  );
  out.push('');
  out.push(`Before calibration max |error| ${cm(r.before.maxAbsCm)} cm (${r.before.pass ? 'within' : 'outside'} ±${CHART_TOLERANCE_CM}); after the global scale alone ${cm(r.afterGlobal.maxAbsCm)} cm (${r.afterGlobal.pass ? 'within' : 'outside'}); after per-ring calibration ${r.agreement.pass ? 'pass' : 'FAIL'}. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.`);
  const other = r.rows.filter((row) => row.chartCm === null && !row.critical && row.measuredCm !== null);
  if (other.length) out.push('', `Other rings measured (no chart value, scaled by the global scale only): ${other.map((row) => `${row.anchor} ${cm(row.measuredCm)}`).join(', ')} cm.`);
  const noGirth = CATEGORY_ANCHORS[r.category].rings.filter((id) => r.measurements.rings[id] === undefined);
  if (noGirth.length) out.push('', `No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): ${noGirth.join(', ')}.`);
  if (r.lengths.length) {
    out.push('', '**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):', '');
    out.push(table(['Length', 'Mesh (cm)', 'Printed (cm)', 'Difference', 'Note'], r.lengths.map((l) => [l.id, cm(l.measuredCm), cm(l.printedCm), cm(l.diffCm, true), l.note ?? ''])));
  }
  if (r.grading && printed.length) {
    const keys = (['chest', 'waist', 'hip', 'shoulder_to_hem'] as const).filter((k) => printed.some((p) => p.values[k] !== undefined));
    out.push('', `**Grading against the shop's printed garment table** (graded targets in grading.json minus what the shop printed per size; the base size is calibrated to the chart, the other sizes follow the chart's steps; the shop's "Length" is read as shoulder to hem):`, '');
    out.push(
      table(
        ['Size', ...keys.flatMap((k) => [`${k} graded`, `${k} printed`, 'diff'])],
        r.grading.sizes.map((g) => {
          const pr = printed.find((p) => p.size === g.size);
          return [g.size, ...keys.flatMap((k) => {
            const t = (g.targets as Partial<Record<string, number>>)[k];
            const pv = pr?.values[k];
            return [cm(t ?? null), cm(pv ?? null), t !== undefined && pv !== undefined ? cm(Math.round((t - pv) * 100) / 100, true) : '—'];
          })];
        }),
      ),
    );
  }
  out.push('', '**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills\' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):', '');
  if (ev.view.views.length) {
    out.push(table(['View', 'Reference', 'IoU visible', 'IoU silhouette', `Pass (visible ≥ ${VIEW_IOU_PASS}, initial)`, 'Invented back'], ev.view.views.map((v) => [v.view, `${v.reference} \`${v.referencePath}\``, v.iou.toFixed(3), v.silhouetteIou === undefined ? '—' : v.silhouetteIou.toFixed(3), v.pass ? 'pass' : 'FAIL', v.invented ? 'YES' : 'no'])));
  } else out.push('No reference masks.');
  if (ev.view.shopPhotos.length) {
    out.push('', 'Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):', '');
    out.push(table(['View', 'Normalised IoU', 'Mirrored', 'Aspect render / photo'], ev.view.shopPhotos.map((s) => [s.view, s.normalisedIou.toFixed(3), yes(s.mirrored), `${s.aspectRender} / ${s.aspectPhoto}`])));
  }
  const tt = ev.view.turntable ?? [];
  if (tt.length) {
    const angles = [...new Set(tt.map((t) => t.angleDeg))];
    out.push('', 'Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):', '');
    out.push(
      table(
        ['Angle', 'Frame', 'Calibrated: visible', 'Calibrated: silhouette', 'Reconstructed: visible', 'Reconstructed: silhouette', 'Picture'],
        angles.map((a) => {
          const c = tt.find((t) => t.angleDeg === a && t.mesh === 'calibrated');
          const rr = tt.find((t) => t.angleDeg === a && t.mesh === 'reconstructed');
          const f = (x: number | undefined): string => (x === undefined ? '—' : x.toFixed(3));
          return [`${a}°`, String(c?.frame ?? rr?.frame ?? '—'), f(c?.iouVisible), f(c?.iouSilhouette), f(rr?.iouVisible), f(rr?.iouSilhouette), bundleRel ? link(input, `${bundleRel}/view/turntable_${a}.png`, `turntable_${a}.png`) : '—'];
        }),
      ),
      '',
      'Each picture: the stage 2 frame, the calibrated mesh in its stage 4 vertex colours on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).',
    );
  }
  for (const n of ev.view.notes) out.push('', `- ${n}`);
  if (bundleRel && ev.view.views.length) out.push('', `Overlays: ${ev.view.views.map((v) => link(input, `${bundleRel}/view/${v.view}_overlay.png`, `${v.view}`)).join(', ')} (grey both, red reference only, blue render only).`);
  const h = r.health;
  const ib = r.insideBody;
  out.push('', `**Cloth inside the mannequin** (vertices more than ${ib.calibrated.toleranceCm} cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): ${(ib.reconstructed.share * 100).toFixed(1)} % as reconstructed (${ib.reconstructed.vertices} vertices), ${(ib.calibrated.share * 100).toFixed(1)} % after calibration.`);
  out.push('', `**Mesh health** (mesh as evaluated): ${h.triangles} triangles (budget ${h.triangleBudget[0]}–${h.triangleBudget[1]}: ${h.withinBudget ? 'within' : 'OUTSIDE'}), ${h.vertices} vertices, ${h.components} components, ${h.boundaryEdges} boundary edges, ${h.nonManifoldEdges} non-manifold edges, ${h.inconsistentEdges} flipped edges, ${h.degenerateTriangles} degenerate triangles. Not checked: ${h.notChecked.join('; ')}.`);
  if (r.warnings.length) out.push('', '**Warnings**', '', ...r.warnings.map((w) => `- ${w}`));
  out.push('', `Evaluation time on the build machine: read ${ev.readMs} ms, measure ${r.timingsMs.measure} ms, calibrate ${r.timingsMs.calibrate} ms, grade ${r.timingsMs.grade} ms, view renders ${ev.viewMs} ms.`);
  return out;
}

function costLines(job: JobFiles | null): string[] {
  const c = costTotal(job);
  if (!c.records.length) return ['No cost records (no GPU stage has run for this product).'];
  const out = [
    'All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.',
    '',
    table(['Stage', 'GPU', 'Region', 'GPU s', 'Wall s', 'Estimate low', 'Estimate high'], c.records.map((r) => [r.stage, r.gpu ?? '—', r.region ?? '—', secs(r.gpuSeconds), secs(r.wallSeconds), usd(r.usdLow), usd(r.usdHigh)])),
    '',
    `Total: ${secs(c.gpuSeconds)} GPU, ${secs(c.wallSeconds)} wall, ${usd(c.usdLow)}–${usd(c.usdHigh)} (estimate).`,
  ];
  return out;
}

function renderLines(input: ReportInput, r: ProductRenders | null): string[] {
  if (!r) return ['Not rendered yet (`report:bohohippychic -- --renders` after the bundles exist).'];
  const out: string[] = [];
  if (r.shots.length) {
    out.push('Stored under `out/` (gitignored); attach them separately.', '');
    out.push(table(['Body', 'View', 'Fit map', 'Sizes', 'Drape per size', 'File'], r.shots.map((s) => [s.shape === 'M' ? 'M mannequin' : `${s.shape} shape`, s.view ?? 'front', yes(s.fitMap), s.sizes.join(', '), s.settleMs.map((ms) => `${(ms / 1000).toFixed(2)} s`).join(', '), link(input, s.file, s.file.split('/').pop() ?? s.file)])));
  }
  if (r.problems.length) out.push('', '**Render problems**', '', ...r.problems.map((p) => `- ${p}`));
  return out;
}

function productSection(input: ReportInput, p: ProductSection, i: number): string[] {
  const s = p.shop;
  const out: string[] = [];
  out.push(`### ${i + 1}. ${s.payload.name} (\`${s.handle}\`)`, '');
  out.push(`${s.productType} → category \`${s.payload.category}\`${s.payload.subcategory ? ` (${s.payload.subcategory})` : ''}. Completeness ${s.completeness ? `${s.completeness.score.toFixed(3)}, ${s.completeness.status}` : '—'}.`, '');
  out.push(`**Why this product:** ${s.why}${s.runnersUp.length ? ` Runners-up: ${s.runnersUp.map((r) => `\`${r.handle}\``).join(', ')}.` : ''}`, '');

  // Inputs
  const plan = plannedPhotos(p.images);
  const used = usedInputs(p.job, p.images);
  out.push('**Inputs**', '');
  out.push(
    table(
      ['#', 'Role', 'On model', 'Background', 'Fully visible', 'Size (px)', 'Use'],
      p.images.map((img) => {
        const use = used.front?.position === img.position ? 'front (used)' : used.back?.position === img.position ? 'back (used)' : plan.front === img ? 'front (planned)' : plan.back === img ? 'back (planned)' : '';
        return [String(img.position), img.role, yes(img.onModel), img.background, yes(img.garmentFullyVisible), `${img.width}×${img.height}`, use];
      }),
    ),
  );
  out.push('');
  if (used.exported) out.push(`Job exported: source kind ${used.sourceKind ?? '?'}; front ${used.front ? `\`${used.front.path}\` (photo ${used.front.position ?? 'not matched'})` : '—'}; back ${used.back ? `\`${used.back.path}\` (photo ${used.back.position ?? 'not matched'})` : 'none'}; invented back: **${used.inventedBack === null ? '—' : used.inventedBack ? 'YES' : 'no'}**.`);
  else out.push(`Job not exported yet. Planned: front = photo ${plan.front?.position ?? '—'}, back = photo ${plan.back?.position ?? '—'} (a real back photo, so the back would not be invented). Both are on a model (\`--on-model\`).`);
  out.push('');

  // Chart and fabric
  const rows = s.payload.sizeChart;
  const base = rows.find((r) => r.size === s.baseSize);
  out.push(`**Chart:** ${s.payload.sizeChartType} chart, sizes ${rows.map((r) => r.size).join(', ')}; base size ${s.baseSize} (our default, not stated by the shop)${base ? `: body bust ${base.bust ?? '—'}, waist ${base.waist ?? '—'}, hip ${base.hip ?? '—'} cm` : ''}. ${s.payload.ease && Object.keys(s.payload.ease).length ? `Product ease from the printed garment table: ${Object.entries(s.payload.ease).map(([k, v]) => `${k} +${v} cm`).join(', ')}; other points take the fit engine's category default ease.` : "No garment measurements printed: all points take the fit engine's category default ease."}${s.payload.lengthCm ? ` Printed lengths: ${Object.entries(s.payload.lengthCm).map(([k, v]) => `${k} ${v} cm`).join(', ')}.` : ''}`, '');
  const mat = evalMaterial(s.payload, null);
  out.push(`**Fabric resolved** (fabric library ${mat.fabricLibraryVersion}): ${mat.fibres.map((f) => `${f.pct}% ${f.id}`).join(', ')}${mat.construction ? `, ${mat.construction}` : ''}; ${mat.weightGsm} g/m², stretch ${mat.stretchPct} %, drape ${mat.drape}, bend ${mat.bendStiffness}, sheen ${mat.sheen}, opacity ${mat.opacity}. Display colour: ${mat.provenance.baseColorHex}.`, '');
  if (s.warnings.length) out.push('Data warnings from the selection:', '', ...s.warnings.map((w) => `- ${w}`), '');

  // Status
  out.push('**Pipeline status**', '');
  out.push(table(['Stage', 'State', 'Detail'], stageStatuses(p, p.job).map((x) => [x.stage, x.state, x.detail])), '');

  // Metrics
  out.push('**Metrics**', '');
  if (p.eval) out.push(...evalTables(input, p.eval, p.bundleRel, s.printed ?? []));
  else out.push(`Chart agreement, view agreement and mesh health: not measured (${p.evalError ?? 'no stage 4 mesh in the job dir'}).`);
  out.push('');
  out.push(...costLines(p.job.exists ? p.job : null), '');
  out.push('**Renders**', '', ...renderLines(input, p.renders), '');
  return out;
}

// ---------------------------------------------------------------------------
// Acceptance verdicts
// ---------------------------------------------------------------------------

export interface Verdict {
  item: string;
  state: 'met' | 'not met' | 'not yet measurable' | 'needs people' | 'measured, partly';
  text: string;
}

export function verdicts(input: ReportInput): Verdict[] {
  const ps = input.products;
  const evaluated = ps.filter((p) => p.eval);
  const passing = evaluated.filter((p) => p.eval!.result.agreement.pass);
  const rendered = ps.filter((p) => p.renders?.shots.length);
  const withCost = ps.filter((p) => p.job.costs.length);
  const views = evaluated.filter((p) => p.eval!.view.views.length);
  const out: Verdict[] = [];
  const hold = input.panelHold?.trim() ? ` **Do not run the panel on these assets yet:** ${input.panelHold.trim()}` : '';
  out.push({
    item: 'Size test',
    state: 'needs people',
    text: `Five people who did not build it must pick the smaller size, without labels, in at least 4 of 5 products on the blind page (size mode). Bundles for the test: ${evaluated.length} of ${ps.length} products; renders made for ${rendered.length}. Not run with people yet.${hold}`,
  });
  out.push({ item: 'Fabric test', state: 'needs people', text: `Same five people, fabric mode of the same page (linen versus silk of the same garment). Not run with people yet.${hold}` });
  out.push({
    item: 'Chart agreement',
    state: evaluated.length < ps.length ? 'not yet measurable' : passing.length >= 4 ? 'met' : 'not met',
    text: evaluated.length
      ? `${passing.length} of ${evaluated.length} evaluated products within ±${CHART_TOLERANCE_CM} cm at their critical anchors after calibration (${ps.length - evaluated.length} without a stage 4 mesh); 4 of 5 needed. After per-ring calibration this is close to 0 by construction, so also read the error before calibration: ${evaluated.map((p) => {
          const r = p.eval!.result;
          const after = Number.isFinite(r.agreement.maxAbsCm) ? `${cm(r.agreement.maxAbsCm)} cm` : 'no girth';
          const one = r.critical.length === 1 ? ', 0 by construction with one critical anchor' : '';
          return `${p.shop.handle} at ${r.critical.join(', ') || 'no anchor'}: max |error| ${cm(r.before.maxAbsCm)} cm before calibration, ${cm(r.afterGlobal.maxAbsCm)} cm after the global scale${one}, ${after} after calibration`;
        }).join('; ')}.`
      : `No product has a stage 4 mesh yet; 4 of 5 must be within ±${CHART_TOLERANCE_CM} cm.`,
  });
  out.push({
    item: 'View agreement',
    state: 'needs people',
    text: `The merchant must confirm that the front and back renders are recognisably their garment. IoU against the pinned stills (visible with the mannequin in front / garment silhouette alone): ${views.length ? views.map((p) => `${p.shop.handle} ${p.eval!.view.views.map((v) => `${v.view} ${v.iou.toFixed(2)} / ${v.silhouetteIou?.toFixed(2) ?? '—'}`).join(', ')}`).join('; ') : 'not measured yet'}. Every pinned still on this set comes from stage 1b (generated from photos on a model), so a high IoU says stages 2–4 kept what stage 1b drew, not that stage 1b drew the shop's garment.`,
  });
  out.push({
    item: 'Cost',
    state: withCost.length === ps.length ? 'met' : withCost.length ? 'measured, partly' : 'not yet measurable',
    text: withCost.length
      ? `Measured for ${withCost.length} of ${ps.length} products (GPU seconds and wall time measured; dollars are list-price estimates until the Modal invoice is read): ${withCost.map((p) => {
          const c = costTotal(p.job);
          return `${p.shop.handle} ${secs(c.gpuSeconds)} GPU, ${secs(c.wallSeconds)} wall, ${usd(c.usdLow)}–${usd(c.usdHigh)}`;
        }).join('; ')}.`
      : 'No GPU run on these products yet, so no GPU seconds, wall time or cost.',
  });
  out.push({ item: 'Write-up', state: 'not met', text: 'This document covers the per-product results. Chosen models and licences are in docs/research/garment-engine.md; failures and the tolerances to use from Phase 1 can only be set once the GPU runs above exist.' });
  return out;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function renderReport(input: ReportInput): string {
  const out: string[] = [];
  out.push(`# Phase 0 on ${input.shop.domain} (generated)`, '');
  out.push(`Generated ${input.date} by \`pnpm --filter @curtain/garment-spike report:bohohippychic\` (\`spikes/garment-engine/scripts/report-bohohippychic.ts\`). Do not edit by hand: re-run it after every GPU run. Renders and bundles live under \`spikes/garment-engine/out/\`, which is gitignored: the links to them below resolve only in a checkout where the GPU outputs are in \`out/phase0/\` and this script has run with \`-- --renders\`; elsewhere they are attached separately.`, '');
  out.push(`${input.shop.brand} gave the founder consent to use its public product data and photos for this internal validation, before anything is installed on its site. Selection, AU chart and photo classification: \`spikes/garment-engine/data/bohohippychic/\` and \`docs/research/au-size-chart.md\`. Everything below that comes from a model is an estimate (AGENTS.md rule 3).`, '');

  // Summary
  out.push('## Summary', '');
  out.push(
    table(
      ['Product', 'Category', 'Back photo', 'Stage 1b', 'Stage 2', 'Stage 4', 'Chart agreement', 'View IoU front / back', 'Cost (estimate)'],
      input.products.map((p) => {
        const st = stageStatuses(p, p.job);
        const state = (name: string) => st.find((x) => x.stage.startsWith(name))?.state ?? '—';
        const used = usedInputs(p.job, p.images);
        const back = used.exported ? (used.inventedBack ? 'INVENTED' : used.back ? 'real' : '—') : plannedPhotos(p.images).back ? 'real (planned)' : 'none';
        const ev = p.eval;
        const vs = ev?.view.views ?? [];
        const c = costTotal(p.job.exists ? p.job : null);
        return [
          `\`${p.shop.handle}\``,
          p.shop.payload.category,
          back,
          state('1b'),
          state('2 '),
          state('4 '),
          ev ? `${ev.result.agreement.pass ? 'pass' : 'FAIL'} (before ${cm(ev.result.before.maxAbsCm)} cm, after ${Number.isFinite(ev.result.agreement.maxAbsCm) ? cm(ev.result.agreement.maxAbsCm) : '—'} cm)` : 'not measured',
          vs.length ? ['front', 'back'].map((v) => vs.find((x) => x.view === v)?.iou.toFixed(2) ?? '—').join(' / ') : '—',
          c.records.length ? `${usd(c.usdLow)}–${usd(c.usdHigh)}` : '—',
        ];
      }),
    ),
    '',
  );

  out.push('## Phase 0 acceptance', '');
  out.push(table(['Item', 'State', 'Evidence'], verdicts(input).map((v) => [v.item, v.state, v.text])), '');
  out.push(`Blind test page with these products pre-selected: \`${input.blindUrl}\` (viewer dev server, \`pnpm --filter @curtain/garment-spike viewer\`). It needs the bundles in \`out/eval/\`, so run the report with GPU outputs first.${input.panelHold?.trim() ? ' Not for the panel yet (see the size test row).' : ''}${input.blindShot ? ` Screenshot: ${link(input, input.blindShot, 'blind page')}.` : ''}`, '');

  if (input.written?.trim()) {
    out.push(input.written.trim(), '');
    if (input.writtenSource) out.push(`*The section above is written by hand in \`${input.writtenSource}\` and copied in by the report script; everything else is generated.*`, '');
  }

  out.push('## What this set can and cannot show', '');
  out.push(
    [
      '- Every shop photo is worn by a model in a styled set, at 800 × 1200 px. The engine\'s photo contract (D13) is not met by any product, so these runs test the `--on-model` path: stage 1b generates the pinned stills on our mannequin from those photos. View agreement against the pinned stills therefore measures stages 2–4, not whether stage 1b reproduced the garment.',
      "- The base size AU 12 (S-M for the cardigan) is our default; the shop does not say which size was photographed. Chart agreement is against the AU body chart plus ease at that size.",
      '- Calibration scales each critical ring to its chart value, so after calibration the chart agreement is near 0 by construction. The informative numbers are the error before calibration and after the global scale.',
      '- An open-front garment (the cardigan) has no girth at the chest, waist or hip unless the reconstruction closes it (the tape bridges holes up to 4 cm, not a front opening); the evaluation reports that as a failure at those anchors rather than guessing a girth.',
      "- Critical anchors follow the fit engine: the category's points minus those the product's pattern block skips (an empire babydoll hangs from the bust, so its waist and hip are reported but not calibrated).",
      '- The XS and XXL renders use the viewer\'s avatar: the M mannequin morphed to the XS or XXL ring girths at chest, waist and hip (stature and arms stay M).',
      '- Trousers and skirts hang from their waistband in the viewer; that is checked only on a skirt cut from the synthetic dress (a unit test and one headless render), never on a reconstructed bottom.',
      ...(input.uncoveredCategories ?? []).map((u) => `- **Not covered: ${u.productType}.** The request was one product from each clothing category; this one has none. ${u.reason}`),
    ].join('\n'),
    '',
  );

  out.push('## Products', '');
  input.products.forEach((p, i) => out.push(...productSection(input, p, i)));

  const syn = input.synthetic;
  if (syn) {
    out.push('## Tooling dry run on the synthetic spike product', '');
    out.push(`Not a shop product. \`${syn.productId}\` is the spike's synthetic shirt dress; it shows that this tooling runs end to end without GPU outputs. Its numbers say nothing about the engine on real photos.`, '');
    if (syn.eval) {
      out.push(...evalTables(input, syn.eval, syn.bundleRel), '');
      out.push(`Bundle: ${syn.eval.bundle ? `${(syn.eval.bundle.bytes / 1024).toFixed(0)} KB${syn.bundleRel ? ` in \`${syn.bundleRel}/\`` : ''}` : 'not written'}.`, '');
    } else out.push(`Not evaluated: ${syn.evalError ?? '?'}.`, '');
    out.push('**Renders**', '', ...renderLines(input, syn.renders), '');
  }

  out.push('## How to update this document', '');
  out.push(
    [
      '1. Per product, the GPU run on GitHub Actions leaves `spikes/garment-engine/out/phase0/<handle>/` (stage1b/, stage2/, stage4/stage2/garment.glb, cost_summary.json). Download the artifact into that folder.',
      '2. `pnpm build:packages && pnpm --filter @curtain/garment-spike report:bohohippychic -- --renders` evaluates every product that has a stage 4 mesh, writes the bundles to `out/eval/<handle>/`, renders sizes 8, 12 and 16 on the M mannequin (front, three-quarter and side) and the XS and XXL shapes with and without the fit map, compares the mesh with the stage 2 turntable at 0°, 90° and 180°, and rewrites this file. The hand-written part comes from `spikes/garment-engine/data/bohohippychic/phase0-written.md`.',
      '3. Run the blind tests with five people on the blind page above, export the CSV, and record the result in `docs/STATUS.md` with the run ids.',
    ].join('\n'),
    '',
  );
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
