/**
 * Test tooling (outside `src`, not part of the package): the POM chino of the spike draped the way the mount drapes it
 * (`prepareFit` + `relax`) on a male table body, and taped afterwards along its own rows and seams. Shared by
 * `src/maleChino.test.ts` and the opt-in `src/pomChinoShots.test.ts`.
 */
import { computeFit } from '@curtain/fit-engine';
import { MALE_REFERENCE, type Mesh } from '@curtain/mannequin';
import type { PomChinoBundle } from '../../../spikes/garment-engine/src/pomChinoBundle';
import { measurePomChino } from '../../../spikes/garment-engine/src/pomChino';
import { pokes } from '../../../spikes/garment-engine/src/pokeThrough';
import { SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM } from '../../../spikes/garment-engine/src/pomChinoSynthetic';
import { loadBundleFrom, type FetchLike, type SpikeBundle } from '../src/bundle';
import { strainQuantile, type Cloth } from '../src/cloth';
import { gradedMesh, hullPerimeter, openSession, prepareFit, relax, sewnNotDrawn, viewerMaterial } from '../src/engine';
import { planAvatar } from '../src/mount';

/** The bundle files as the dev server or the asset route would serve them. */
export function serve(files: Record<string, string | Uint8Array>): FetchLike {
  return async (url) => {
    const data = files[url.split('/').pop()!];
    if (data === undefined) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, json: async () => JSON.parse(data as string) as unknown, arrayBuffer: async () => { const u = data as Uint8Array; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; } };
  };
}

export async function loadChino(built: PomChinoBundle): Promise<SpikeBundle> {
  return loadBundleFrom(serve(built.files), '/b', SYNTHETIC_CHINO_PAYLOAD.id, { withPayload: false });
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const pct = (x: number): number => Math.round(x * 1000) / 10;

export interface ChinoDrapeMetrics {
  body: string;
  size: string;
  recommended: string | null;
  notDrawn?: { anchor: string; bodyLargerCm: number };
  /** Girths as full girths, cm: the size's tape, the graded cloth before the drape and after it (the row's own length, and a tape laid round its outside). */
  waistCm?: { tape: number; graded: number; drapedRow: number; drapedHull: number };
  seatCm?: { tape: number; graded: number; drapedRow: number; drapedHull: number };
  thighCm?: { tape: number; graded: number; drapedRow: number; drapedHull: number };
  inseamCm?: { tape: number; graded: number; draped: number; crotchToHemDropCm: number };
  /** The rises along the crotch seam: the size's tape, the graded cloth (the device does not grade the rises) and after the drape. */
  frontRiseCm?: { tape: number; graded: number; draped: number };
  backRiseCm?: { tape: number; graded: number; draped: number };
  /** Edge strain: the 99th percentile over the whole cloth; the 99th percentile and the largest within 8 cm of the crotch point; the same over the seat (crotch row to the band, away from the pinned band). */
  strainPct?: { p99: number; crotchP99: number; crotchMax: number; seatP99: number; seatMax: number };
  /** The band: how far it slid down to where the body fills it (`slideWaistband`), and whether it would not stay up. */
  band?: { dropCm: number; pastHips: boolean; bandGirthCm: number; bodyAtBandCm: number } | null;
  /** Pixels of drawn body in front of the cloth by under 2 cm, four views at 3 px/cm, between the hem and the band. */
  showThroughPixels?: number;
  /** The same by view, body part and region (seat: from 4 cm above the crotch up; thigh: down to 12 cm under it; leg; ankle: the lowest 20 cm). */
  showThroughBy?: Record<string, number>;
  /** Crotch point after the drape against the drawn body's crotch (positive: the seam hangs below the body), cm. */
  crotchBelowBodyCm?: number;
  hemAboveFloorCm?: number;
  drapeMs?: number;
}

export interface ChinoDrapeResult {
  metrics: ChinoDrapeMetrics;
  /** The drawn body and the draped cloth in the body's space (absent when the size is not drawn). */
  drawn?: { body: Mesh; cloth: Pick<Mesh, 'positions' | 'indices'>; pos: Float32Array };
}

/** Drape `size` (null: the size the fit engine recommends, else its closest) on the male table body `id`. */
export function chinoDrape(built: PomChinoBundle, bundle: SpikeBundle, id: keyof typeof MALE_REFERENCE, size: string | null): ChinoDrapeResult {
  const t = MALE_REFERENCE[id];
  const plan = planAvatar(bundle.anchors, { family: 'male', heightCm: t.stature, bust: t.chest, waist: t.waist, hip: t.hip, shoulderCm: t.shoulderWidth });
  const session = openSession(plan.m, bundle, SYNTHETIC_CHINO_PAYLOAD);
  // The fit as the embed computes it for a shopper who also gave thigh and inside leg (the table's): without an inside leg
  // the fit engine picks no leg length, so no full W/L size is recommended.
  const fit = computeFit(SYNTHETIC_CHINO_PAYLOAD, { measurements: { bust: t.chest, waist: t.waist, hip: t.hip, thigh: t.thigh, inseam: t.inseam }, heightCm: t.stature });
  const label = size ?? fit.recommendedSize ?? fit.closestSize!;
  const row = SYNTHETIC_CHINO_POM.find((r) => r.size === label)!;
  const notDrawn = sewnNotDrawn(session, plan.avatar, fit, label);
  if (notDrawn) return { metrics: { body: id, size: label, recommended: fit.recommendedSize, notDrawn } };
  const f = prepareFit(session, plan.avatar, plan.field, fit, label, viewerMaterial('product', bundle.material));
  const base = built.base;
  const graded = measurePomChino(base, gradedMesh(session, label).positions);
  const t0 = Date.now();
  const pos = relax(f);
  const drapeMs = Date.now() - t0;
  const draped = measurePomChino(base, pos);
  const hull = (ids: readonly number[]): number => hullPerimeter(ids.map((i) => [pos[3 * i]!, pos[3 * i + 2]!] as [number, number]));
  const girth = (key: 'waistWidthCm' | 'seatWidthCm' | 'thighWidthCm', ids: readonly number[]) => ({ tape: r1(2 * row[key]), graded: r1(2 * graded[key]), drapedRow: r1(2 * draped[key]), drapedHull: r1(hull(ids)) });
  const top = base.torsoRows[base.torsoRows.length - 1]!;
  // Strain by region, on the rest positions of the edges' ends.
  const strains = rawStrains(f.cloth);
  const cp = base.crotchPoint;
  const rest = base.mesh.positions;
  const near = (i: number): boolean => Math.hypot(rest[3 * i]! - rest[3 * cp]!, rest[3 * i + 1]! - rest[3 * cp + 1]!, rest[3 * i + 2]! - rest[3 * cp + 2]!) < 8;
  const seat = (i: number): boolean => rest[3 * i + 1]! >= base.levels.crotchY && rest[3 * i + 1]! <= base.levels.bandTopY - 6;
  const region = (inside: (i: number) => boolean): { p99: number; max: number } => {
    const s: number[] = [];
    for (let e = 0; e < strains.length; e++) if (inside(f.cloth.edges[2 * e]!) && inside(f.cloth.edges[2 * e + 1]!)) s.push(strains[e]!);
    s.sort((a, b) => a - b);
    return { p99: pct(s[Math.floor(0.99 * (s.length - 1))] ?? 0), max: pct(s[s.length - 1] ?? 0) };
  };
  const crotch = region(near), seatR = region(seat);
  const lifted = Float64Array.from(pos);
  for (let i = 1; i < lifted.length; i += 3) lifted[i] = lifted[i]! + plan.garmentLiftCm;
  let topY = -Infinity, hemY = Infinity;
  for (const i of top) topY = Math.max(topY, lifted[3 * i + 1]!);
  for (const i of base.legRows[0][0]!) hemY = Math.min(hemY, lifted[3 * i + 1]!);
  let px = 0;
  const by: Record<string, number> = {};
  const crotchLine = MALE_REFERENCE[id].inseam;
  const band = (y: number): string => (y >= topY - 2.5 || y <= hemY + 1.5 ? 'out' : y > crotchLine + 4 ? 'seat' : y > crotchLine - 12 ? 'thigh' : y > 20 ? 'leg' : 'ankle');
  for (const [view, yaw] of [['front', 0], ['left', Math.PI / 2], ['back', Math.PI], ['right', -Math.PI / 2]] as const) for (const [k, v] of Object.entries(pokes(plan.avatar.mesh, { positions: lifted, indices: f.indices }, yaw, band, 300, 600))) if (!k.endsWith(' out')) {
    px += v;
    by[`${view} ${k}`] = (by[`${view} ${k}`] ?? 0) + v;
  }
  const bodyCrotch = MALE_REFERENCE[id].inseam;
  return {
    metrics: {
      body: id,
      size: label,
      recommended: fit.recommendedSize,
      waistCm: girth('waistWidthCm', top),
      seatCm: girth('seatWidthCm', base.torsoRows[base.seatRow]!),
      thighCm: girth('thighWidthCm', base.legRows[0][base.thighRow]!),
      inseamCm: { tape: r1(row.inseamCm), graded: r1(graded.inseamCm), draped: r1(draped.inseamCm), crotchToHemDropCm: r1(pos[3 * cp + 1]! - pos[3 * base.inseam[base.inseam.length - 1]! + 1]!) },
      frontRiseCm: { tape: r1(row.frontRiseCm), graded: r1(graded.frontRiseCm), draped: r1(draped.frontRiseCm) },
      backRiseCm: { tape: r1(row.backRiseCm), graded: r1(graded.backRiseCm), draped: r1(draped.backRiseCm) },
      strainPct: { p99: pct(strainQuantile(f.cloth, 0.99)), crotchP99: crotch.p99, crotchMax: crotch.max, seatP99: seatR.p99, seatMax: seatR.max },
      band: f.band ? { dropCm: f.band.dropCm, pastHips: f.band.pastHips, bandGirthCm: f.band.bandGirthCm, bodyAtBandCm: f.band.bodyAtBandCm } : null,
      showThroughPixels: px,
      showThroughBy: by,
      crotchBelowBodyCm: r1(bodyCrotch - (pos[3 * cp + 1]! + plan.garmentLiftCm)),
      hemAboveFloorCm: r1(hemY),
      drapeMs,
    },
    drawn: { body: plan.avatar.mesh, cloth: { positions: lifted, indices: f.indices }, pos },
  };
}

/** Edge strains in edge order (`edgeStrains` sorts them). */
function rawStrains(cloth: Cloth): Float32Array {
  const out = new Float32Array(cloth.edgeRest.length);
  for (let e = 0; e < out.length; e++) {
    const a = cloth.edges[2 * e]!, b = cloth.edges[2 * e + 1]!;
    const d = Math.hypot(cloth.pos[3 * a]! - cloth.pos[3 * b]!, cloth.pos[3 * a + 1]! - cloth.pos[3 * b + 1]!, cloth.pos[3 * a + 2]! - cloth.pos[3 * b + 2]!);
    out[e] = cloth.edgeRest[e]! > 0 ? d / cloth.edgeRest[e]! - 1 : 0;
  }
  return out;
}
