/**
 * Size advice for a validated shop's products, through the same path the plugin uses: the stored
 * draft resolved by `sizeAdviceGarment` (@curtain/schema, defaults for the fields size advice does not
 * read), then `computeFit` (@curtain/fit-engine, on-device in production). Used to check the advice
 * outside Bohohippychic (refinement P4) on test bodies. Test bodies are synthetic measurement sets,
 * never a person's data. Pure, no I/O.
 */
import { computeFit, type FitResult } from '@curtain/fit-engine';
import { sizeAdviceGarment, type GarmentPayloadDraft, type SizeRow, type UserBody } from '@curtain/schema';

export interface TestBody {
  id: string;
  /** What the body is, and what a correct advice looks like. */
  note: string;
  measurements: UserBody['measurements'];
  /** Sizes a correct advice may give for a body chart row (the row itself, or a neighbour when between sizes). */
  expect?: string[];
}

export interface AdviceRow {
  handle: string;
  body: string;
  chart: string;
  recommended: string | null;
  closest: string | null;
  score: number | null;
  fits: boolean;
  expect?: string[];
  ok?: boolean;
  /** Per point at the closest size: band and gap (cm). */
  points: string[];
  notes: string[];
  defaulted: string[];
}

function pointsOf(r: FitResult): string[] {
  const s = r.closestIndex !== undefined ? r.perSize[r.closestIndex] : undefined;
  if (!s) return [];
  return s.points.map((p) => ('band' in p ? `${p.point} ${p.band} ${p.gapCm > 0 ? '+' : ''}${p.gapCm}` : `${p.point} omitted (${p.omitted})`));
}

/** Size advice for one product draft and a set of bodies; `chartLabel` names the chart in the output. */
export function adviseProduct(handle: string, draft: GarmentPayloadDraft, bodies: readonly TestBody[], chartLabel: string, chart?: SizeRow[]): AdviceRow[] {
  const g = sizeAdviceGarment(chart ? { ...draft, sizeChart: chart } : draft);
  if (!g.ok) return bodies.map((b) => ({ handle, body: b.id, chart: chartLabel, recommended: null, closest: null, score: null, fits: false, points: [], notes: [`not size-advice ready: ${g.missing.map((m) => m.field).join(', ')}`], defaulted: [] }));
  return bodies.map((b) => {
    const r = computeFit(g.garment, { measurements: b.measurements });
    const row: AdviceRow = {
      handle,
      body: b.id,
      chart: chartLabel,
      recommended: r.recommendedSize,
      closest: r.closestSize,
      score: r.score,
      fits: r.fits,
      points: pointsOf(r),
      notes: r.notes,
      defaulted: g.defaulted,
    };
    if (b.expect) {
      row.expect = b.expect;
      row.ok = r.recommendedSize !== null && b.expect.includes(r.recommendedSize);
    }
    return row;
  });
}

/**
 * Test bodies from a body chart: the rows themselves (advice must give exactly that size; a neighbour
 * would hide a one-size error such as the UK template's) and a body halfway between two rows (either
 * neighbour is acceptable).
 */
export function chartBodies(rows: readonly SizeRow[], picks: readonly string[], insideLegCm: number): TestBody[] {
  const out: TestBody[] = [];
  const idx = (s: string) => rows.findIndex((r) => r.size === s);
  for (const s of picks) {
    const i = idx(s);
    const r = rows[i];
    if (!r || r.bust === undefined || r.waist === undefined || r.hip === undefined) continue;
    out.push({ id: `chart-${s}`, note: `exactly the shop's body row ${s}`, measurements: { bust: r.bust, waist: r.waist, hip: r.hip, inseam: insideLegCm }, expect: [r.size] });
  }
  for (let k = 0; k + 1 < picks.length; k++) {
    const a = rows[idx(picks[k]!)];
    const b = rows[idx(picks[k]!) + 1];
    if (!a || !b) continue;
    const mid = (x?: number, y?: number) => (x !== undefined && y !== undefined ? Math.round(((x + y) / 2) * 10) / 10 : undefined);
    out.push({ id: `between-${a.size}-${b.size}`, note: `halfway between rows ${a.size} and ${b.size}`, measurements: { bust: mid(a.bust, b.bust)!, waist: mid(a.waist, b.waist)!, hip: mid(a.hip, b.hip)!, inseam: insideLegCm }, expect: [a.size, b.size] });
  }
  return out;
}
