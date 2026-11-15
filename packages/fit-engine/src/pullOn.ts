/**
 * Garment tape readings (docs/MERCHANT-MEASUREMENTS.md; spike §9.2 of
 * docs/research/step3-serverdrape-spike.md): the pull-on check and the elastic-band waist reading.
 *
 * Both run only when the garment carries the data (`closure`, `garmentTape`). Without it nothing
 * here is reached and `computeFit` returns exactly what it returned before these fields existed.
 *
 * Pure, zero dependencies: only types come from @curtain/schema.
 */
import type { GarmentTapeRow, TapeProvenance } from '@curtain/schema';
import { positive, round1 } from './math';
import type { BandEdges, PullOnCheck, PullOnStatus, TapeTuning } from './types';

/**
 * The numbers behind the two readings. Every one of them is a CHOICE, not a measurement; README
 * §Garment tape says where each comes from and `opts.tapeTuning` overrides them for sensitivity runs.
 */
export const TAPE_TUNING: Readonly<TapeTuning> = {
  /**
   * A band that is short of the hips by up to this much, at the stretch the shop called
   * comfortable, still goes on. Half of the 5 cm hip step between two sizes of a body chart.
   */
  pullOnAllowanceCm: 2.5,
  /** Below this margin (and not blocked) a size carries the warning "only just passes". */
  pullOnMarginalBelowCm: 2.5,
  /** Extra shortfall tolerated when the stretched band was extrapolated, not measured. */
  pullOnExtrapolatedExtraCm: 2.5,
  /** Equal fit: the size whose band reaches the hips wins over one that is short within the allowance. */
  pullOnPreferPassing: true,
  /** Share of the band's stretch range that counts as easy; above it the waist reads snug. */
  easyStretchShare: 0.5,
  /** Multipliers on the result's confidence by the worst provenance of the tape values used. */
  provenanceConfidence: { measured: 1, interpolated: 0.9, extrapolated: 0.7 },
};

const PROVENANCES: readonly TapeProvenance[] = ['measured', 'interpolated', 'extrapolated'];

/** The worse of two provenances (extrapolated over interpolated over measured). */
export function worseProvenance(a: TapeProvenance | undefined, b: TapeProvenance | undefined): TapeProvenance | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return PROVENANCES.indexOf(a) >= PROVENANCES.indexOf(b) ? a : b;
}

export function resolveTuning(override: Partial<TapeTuning> | undefined): TapeTuning {
  if (!override || typeof override !== 'object') return TAPE_TUNING;
  const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
  const pc = override.provenanceConfidence;
  return {
    pullOnAllowanceCm: num(override.pullOnAllowanceCm, TAPE_TUNING.pullOnAllowanceCm, 0, 50),
    pullOnMarginalBelowCm: num(override.pullOnMarginalBelowCm, TAPE_TUNING.pullOnMarginalBelowCm, -50, 50),
    pullOnExtrapolatedExtraCm: num(override.pullOnExtrapolatedExtraCm, TAPE_TUNING.pullOnExtrapolatedExtraCm, 0, 50),
    pullOnPreferPassing: typeof override.pullOnPreferPassing === 'boolean' ? override.pullOnPreferPassing : TAPE_TUNING.pullOnPreferPassing,
    easyStretchShare: num(override.easyStretchShare, TAPE_TUNING.easyStretchShare, 0, 1),
    provenanceConfidence: {
      measured: num(pc?.measured, TAPE_TUNING.provenanceConfidence.measured, 0, 1),
      interpolated: num(pc?.interpolated, TAPE_TUNING.provenanceConfidence.interpolated, 0, 1),
      extrapolated: num(pc?.extrapolated, TAPE_TUNING.provenanceConfidence.extrapolated, 0, 1),
    },
  };
}

/** A tape value read defensively: a positive number of cm and a known provenance, else nothing. */
export interface ReadTapeValue {
  cm: number;
  provenance: TapeProvenance;
}

function readValue(v: unknown): ReadTapeValue | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { cm, provenance } = v as { cm?: unknown; provenance?: unknown };
  const n = positive(cm);
  if (n === undefined || !PROVENANCES.includes(provenance as TapeProvenance)) return undefined;
  return { cm: n, provenance: provenance as TapeProvenance };
}

/** What the engine reads of one size's tape row: the two band values. */
export interface BandTape {
  relaxed?: ReadTapeValue;
  stretched?: ReadTapeValue;
}

const labelKey = (label: unknown): string => String(label ?? '').trim().toUpperCase();

/**
 * The band values per chart row (same order as `sizes`). Labels are matched like the schema's
 * `sizeLabelKey` (trimmed, upper-cased). A label that two tape rows share is ambiguous and is not
 * read. `null` when the garment has no usable tape at all.
 */
export function bandTapePerSize(garmentTape: unknown, sizes: readonly string[]): (BandTape | undefined)[] | null {
  if (!Array.isArray(garmentTape) || garmentTape.length === 0) return null;
  const byKey = new Map<string, BandTape | 'ambiguous'>();
  for (const raw of garmentTape as readonly (Partial<GarmentTapeRow> | null | undefined)[]) {
    if (!raw || typeof raw !== 'object') continue;
    const key = labelKey(raw.size);
    if (byKey.has(key)) {
      byKey.set(key, 'ambiguous');
      continue;
    }
    const band: BandTape = {};
    const relaxed = readValue(raw.waistRelaxed);
    const stretched = readValue(raw.waistStretched);
    if (relaxed) band.relaxed = relaxed;
    if (stretched) band.stretched = stretched;
    byKey.set(key, band);
  }
  let any = false;
  const out = sizes.map((size) => {
    const band = byKey.get(labelKey(size));
    if (band === undefined || band === 'ambiguous' || (!band.relaxed && !band.stretched)) return undefined;
    any = true;
    return band;
  });
  return any ? out : null;
}

/**
 * The pull-on check of one size: the band at the stretch the shop measured against the wearer's
 * hip girth.
 *
 * `marginCm = stretched band − body hip`. `blocked` when the band is short by more than the
 * allowance (plus the extra when the band value is extrapolated), `marginal` when it is within
 * the allowance or clears by less than `pullOnMarginalBelowCm`, `clear` otherwise.
 */
export function pullOnCheck(stretched: ReadTapeValue, bodyHipCm: number, tuning: TapeTuning = TAPE_TUNING): PullOnCheck {
  const marginCm = round1(stretched.cm - bodyHipCm);
  const allowanceCm = tuning.pullOnAllowanceCm + (stretched.provenance === 'extrapolated' ? tuning.pullOnExtrapolatedExtraCm : 0);
  const status: PullOnStatus = marginCm < -allowanceCm ? 'blocked' : marginCm < tuning.pullOnMarginalBelowCm ? 'marginal' : 'clear';
  return {
    status,
    marginCm,
    bandStretchedCm: round1(stretched.cm),
    bodyHipCm: round1(bodyHipCm),
    allowanceCm,
    provenance: stretched.provenance,
  };
}

/** An elastic band the waist can be read from: both values known and the band actually stretches. */
export interface ElasticBand {
  relaxedCm: number;
  stretchedCm: number;
  provenance: TapeProvenance;
}

export function elasticBandOf(band: BandTape | undefined): ElasticBand | undefined {
  if (!band?.relaxed || !band.stretched) return undefined;
  if (!(band.stretched.cm > band.relaxed.cm)) return undefined;
  return {
    relaxedCm: band.relaxed.cm,
    stretchedCm: band.stretched.cm,
    provenance: worseProvenance(band.relaxed.provenance, band.stretched.provenance) as TapeProvenance,
  };
}

/**
 * The waist read from the band's measured range in place of chart waist + ease.
 *
 * Reported gap: `relaxed band − body waist` (negative = the band is stretched by that much), with
 * an ease target of 0: an elastic band is meant to grip. With `R = stretched − relaxed` and
 * `k = easyStretchShare`:
 *
 * | body waist                              | band  |
 * |-----------------------------------------|-------|
 * | above stretched            (gap < −R)   | tight |
 * | relaxed + kR … stretched   (gap < −kR)  | snug  |
 * | relaxed − good … relaxed + kR           | good  |
 * | down to relaxed − loose                 | roomy |
 * | below that                              | loose |
 *
 * `good` and `loose` are the slacks the point already had (2 and 4 cm, +4 in a stretch zone).
 * When the body's hip is known, `loose` is at least `hip − waist`: a band longer than the natural
 * waist is not loose until it is as long as the hips; until then it settles lower, where the body
 * is as wide as the band, and reads roomy.
 *
 * The classification is `bandFor` on the shifted gap `gap + kR` with these edges, so the
 * sigma-aware variant works on it unchanged.
 */
export function elasticWaistReading(
  band: ElasticBand,
  bodyWaistCm: number,
  pointEdges: BandEdges,
  tuning: TapeTuning = TAPE_TUNING,
  bodyHipCm?: number,
): { gapCm: number; shiftedGap: number; edges: BandEdges; tightLimit: number; closenessCm: number } {
  const range = band.stretchedCm - band.relaxedCm;
  const easy = tuning.easyStretchShare * range;
  const gapCm = round1(band.relaxedCm - bodyWaistCm);
  const looseSlack = bodyHipCm === undefined ? pointEdges.looseSlack : Math.max(pointEdges.looseSlack, bodyHipCm - bodyWaistCm);
  return {
    gapCm,
    shiftedGap: gapCm + easy,
    edges: {
      tightLimit: -(range - easy),
      easeTarget: easy,
      goodSlack: pointEdges.goodSlack,
      looseSlack,
      snugOk: pointEdges.snugOk,
    },
    tightLimit: round1(-range),
    closenessCm: elasticCloseness(gapCm, easy, pointEdges.goodSlack),
  };
}

/**
 * How far a band reading is from the band's designed state, in cm, for the closest-ease
 * tie-break (which otherwise uses |gap|). A band is made to be stretched, so stretch and slack do
 * not count alike: slack counts in full; stretch is scaled so that the end of the easy range
 * (`kR`) is as far as the end of `good` on the slack side (`goodSlack`). With k = 0 there is no
 * easy range and stretch counts in full.
 */
export function elasticCloseness(gapCm: number, easyCm: number, goodSlack: number): number {
  if (gapCm >= 0) return gapCm;
  return easyCm > 0 ? (-gapCm * goodSlack) / easyCm : -gapCm;
}

const cm = (x: number): string => String(round1(Math.abs(x)));

/**
 * The English notes of the tape readings, in one place (the engine's notes are English, like the
 * rest of `FitResult.notes`). A surface with its own catalogue (D21) phrases the same facts from
 * `SizeFit.pullOn`, `PointFit.elasticBand` and `FitResult.tapeProvenance`.
 */
export const TAPE_NOTES = {
  marginal: (c: PullOnCheck): string =>
    c.marginCm === 0
      ? 'The waistband only just stretches over your hips (nothing to spare)'
      : c.marginCm > 0
        ? `The waistband only just stretches over your hips (about ${cm(c.marginCm)} cm to spare)`
      : `The waistband only just stretches over your hips (about ${cm(c.marginCm)} cm short at a comfortable stretch)`,
  smallerBlocked: (size: string, c: PullOnCheck): string =>
    `Size ${size} is not recommended: its waistband does not stretch over your hips (about ${cm(c.marginCm)} cm short)`,
  noneGoesOn: (size: string, c: PullOnCheck): string =>
    `No size stretches over your hips — the closest is ${size}, about ${cm(c.marginCm)} cm short at a comfortable stretch`,
  hipMissing: "We don't have your hips measurement yet — we can't check that the waistband goes over your hips",
  provenance: (size: string, p: TapeProvenance): string | null =>
    p === 'extrapolated'
      ? `Size ${size} was not measured by the shop — its waistband numbers are a rough estimate`
      : p === 'interpolated'
        ? `Size ${size} was not measured by the shop — its waistband numbers are estimated from the sizes next to it`
        : null,
  summaryMarginal: 'the waistband only just passes your hips',
  summaryNoneGoesOn: (size: string): string => `No size stretches over your hips — the closest is ${size} (estimate).`,
} as const;
