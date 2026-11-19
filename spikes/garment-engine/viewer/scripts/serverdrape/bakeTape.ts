/**
 * What a tape-built bake states about itself for the import's bake check (@curtain/garment-viewer `bakeGate.ts`):
 * the tape it was built from (qa.json `tape`), and the rings and bodies it was draped on (base.glb `curtainBake`).
 * Shared by `bake-pom.ts` (the POM v2 drapes) and `bake-pom-rest-fixture.ts` (the test fixture).
 */
import { pullOnCheck } from '@curtain/fit-engine';
import type { DrapeBakeBody, DrapeBakeRing, SizeProvenance } from '../../../../../packages/garment-viewer/src/drapeBake';

/** rest.json of `pom_rest.py`. */
export interface RestJson {
  assumed: { hipBelowTopCm: number };
  rings: { hipRing: number; start: number[]; size: number[] };
  sizes: { size: string; provenance: SizeProvenance; tape: Record<string, { cm: number; source: string }> }[];
}

const KEYS = ['relaxedGirthCm', 'stretchedGirthCm', 'hipCm', 'hemSweepCm', 'lengthCm'] as const;

/** rest.json's free-text source ("interpolated (between AU 10 and 14)") as the provenance word it starts with. */
export function provenanceOf(source: string): SizeProvenance {
  const w = source.trim().split(/[\s(]/)[0]!.toLowerCase();
  if (w === 'measured' || w === 'interpolated' || w === 'extrapolated') return w;
  throw new Error(`tape source "${source}" is not measured, interpolated or extrapolated`);
}

/**
 * qa.json `tape`. `hipBelowBandCm`: where the hip girth C was measured, cm below the top of the band; `null` when the
 * shop did not say (the pilot skirt: the 20 cm of `pom_rest.py` is the builder's assumption, not the shop's).
 */
export function qaTape(rest: RestJson, hipBelowBandCm: number | null): Record<string, unknown> {
  return {
    hipBelowBandCm,
    note: hipBelowBandCm === null ? `the shop did not state the hip distance; the bake places the hip line ${rest.assumed.hipBelowTopCm} cm below the top edge (ASSUMED)` : undefined,
    sizes: rest.sizes.map((s) => ({ size: s.size, provenance: s.provenance, tape: Object.fromEntries(KEYS.map((k) => [k, { cm: s.tape[k]!.cm, source: provenanceOf(s.tape[k]!.source) }])) })),
  };
}

/** The hip-line ring and the hem ring (the last ring) of the shared POM mesh. */
export function tapeRings(rest: RestJson): { hip: DrapeBakeRing; hem: DrapeBakeRing } {
  const { hipRing, start, size } = rest.rings;
  return { hip: { start: start[hipRing]!, count: size[hipRing]! }, hem: { start: start[start.length - 1]!, count: size[size.length - 1]! } };
}

/** The pilot skirt's chart line (payload.json sizeChart): bust 95 + 10 t, waist 77.5 + 10 t, hip 104 + 10 t. */
export const chartBody = (t: number): DrapeBakeBody => ({ t, bust: 95 + 10 * t, waist: 77.5 + 10 * t, hip: 104 + 10 * t });

/** At rest by the stated threshold of `pom2_measure.py` (§9.5), from a drape's settle trace [frame, max, mean, ...]. */
export function restFromTrace(trace: number[][] | undefined, frames: number | undefined): { atRest: boolean; maxMoveCmPerFrame: number; meanMoveCmPerFrame: number } | null {
  if (!trace?.length) return null;
  const last = frames ?? trace[trace.length - 1]![0]!;
  const tail = trace.filter((t) => t[0]! > last - 24);
  if (!tail.length) return null;
  const max = Math.max(...tail.map((t) => t[1]!));
  const mean = tail.reduce((s, t) => s + t[2]!, 0) / tail.length;
  return { atRest: max < 0.25 && mean < 0.02, maxMoveCmPerFrame: Math.round(max * 1000) / 1000, meanMoveCmPerFrame: Math.round(mean * 10000) / 10000 };
}

/**
 * Why a size is not draped on a body whose hips its band cannot be pulled over, or null when it goes on: the fit
 * engine's own `pullOnCheck` (the stretched band from the tape against the body's hip, blocked when short by more than
 * the allowance), so the 3D view never dresses a body in a size the size advice says does not go on (§10.9).
 */
export function pullOnRefusal(stretched: { cm: number; source: string }, hipCm: number): string | null {
  const p = pullOnCheck({ cm: stretched.cm, provenance: provenanceOf(stretched.source) }, hipCm);
  if (p.status !== 'blocked') return null;
  return `its band cannot be pulled over ${hipCm} cm hips: ${p.bandStretchedCm} cm at full stretch, ${Math.round(-p.marginCm * 10) / 10} cm short (the size advice allows ${p.allowanceCm} cm)`;
}

/**
 * The bodies one size is draped on (axis values): every chart body where it can be worn (`refusal` null) and, where
 * the chart body above its last one is refused, the highest of the in-between bodies (`own`: the sizes' own chart
 * bodies) below that one where it can be worn and a drape exists, as its upper body. Base = the draped body nearest
 * t = 0. Every body beyond the drapes is declared not draped with its reason; a refused body between two drapes, or a
 * body beyond them that has no reason, is an error (the import's bake check refuses both).
 */
export function planSizeBodies(chart: number[], own: number[], refusal: (t: number) => string | null, hasDrape: (t: number) => boolean): { baseT: number; targetT: number[]; notDraped: { t: number; reason: string }[] } {
  const draped = chart.filter((t) => refusal(t) === null);
  if (draped.length === 0) throw new Error('the size cannot be worn on any chart body');
  const top = Math.max(...draped);
  const above = chart.filter((t) => t > top).sort((a, b) => a - b)[0];
  if (above !== undefined) {
    const stand = own.filter((t) => t > top && t < above && refusal(t) === null && hasDrape(t)).sort((a, b) => b - a)[0];
    if (stand !== undefined) draped.push(stand);
  }
  draped.sort((a, b) => a - b);
  const all = [...chart, ...own].sort((a, b) => a - b);
  for (const t of draped) if (!hasDrape(t)) throw new Error(`the size can be worn on the body at t = ${t} but has no drape there`);
  const lo = draped[0]!, hi = draped[draped.length - 1]!;
  for (const t of all) if (t > lo && t < hi && refusal(t) !== null) throw new Error(`a refused body (t = ${t}) lies between two drapes of the size`);
  const notDraped = all
    .filter((t) => t < lo || t > hi)
    .map((t) => {
      const reason = refusal(t);
      if (!reason) throw new Error(`no drape on the body at t = ${t}, beyond the size's drapes, and no reason why`);
      return { t, reason };
    });
  const baseT = draped.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  return { baseT, targetT: draped.filter((t) => t !== baseT), notDraped };
}
