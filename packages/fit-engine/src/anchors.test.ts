import { ANCHOR_IDS, FIT_POINT_TO_ANCHOR, type AnchorId } from '@curtain/anchors';
import { FIT_POINTS, MOCK_GARMENTS, type UserBody } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { computeFit } from './computeFit';
import { FIT_POINT_ANCHORS, anchorGaps, fitGapsForRender, fitSummary } from './summary';
import { JEANS, REF, SLIP, WRAP } from './test/fixtures';
import { isPointFit, type FitAnchorId, type FitGarment, type FitResult } from './types';

// Compile-time: every FitAnchorId is a D15 AnchorId.
const _assignable: AnchorId = 'chest' as FitAnchorId;

const BODIES: UserBody[] = [
  REF,
  { measurements: { bust: 112, waist: 96, hip: 120, shoulder: 44 } },
  { measurements: { bust: 80, waist: 62, hip: 88, shoulder: 35, thigh: 52, inseam: 76 } },
  { measurements: { waist: 74, hip: 99, thigh: 58, inseam: 81 }, confidence: { waist: 0.5 } },
  { measurements: { bust: 95, waist: 80, hip: 104, shoulder: 40, thigh: 60, inseam: 79, footLengthCm: 25 } },
];

const GARMENTS: FitGarment[] = [WRAP, SLIP, JEANS, ...MOCK_GARMENTS];

describe('anchor ids (D15)', () => {
  it('FIT_POINT_ANCHORS equals @curtain/anchors FIT_POINT_TO_ANCHOR; foot has no anchor', () => {
    expect(FIT_POINT_ANCHORS).toEqual(FIT_POINT_TO_ANCHOR);
    for (const p of FIT_POINTS) {
      if (p === 'foot') expect(FIT_POINT_ANCHORS[p]).toBeUndefined();
      else expect(ANCHOR_IDS).toContain(FIT_POINT_ANCHORS[p]);
    }
    expect(_assignable).toBe('chest');
  });
});

describe('anchorGaps', () => {
  it('equals the per-point output re-keyed, for every garment × body × size', () => {
    let compared = 0;
    for (const g of GARMENTS) {
      for (const body of BODIES) {
        const r = computeFit(g, body);
        for (const size of [undefined, ...r.perSize.map((s) => s.size)]) {
          const render = fitGapsForRender(r, size);
          const anchors = anchorGaps(r, size);
          if (render === null) {
            expect(anchors).toBeNull();
            continue;
          }
          expect(anchors!.size).toBe(render.size);
          for (const field of ['gaps', 'bands', 'easeTargets', 'slackCm'] as const) {
            const rekeyed: Record<string, unknown> = {};
            for (const [p, v] of Object.entries(render[field])) {
              const a = FIT_POINT_ANCHORS[p as keyof typeof FIT_POINT_ANCHORS];
              if (a !== undefined) rekeyed[a] = v;
            }
            expect(anchors![field]).toEqual(rekeyed);
          }
          // And straight from the engine's PointFit rows: same gap, band and ease target.
          const row = r.perSize.find((s) => s.size === render.size)!;
          for (const p of row.points.filter(isPointFit)) {
            const a = FIT_POINT_ANCHORS[p.point];
            if (a === undefined) continue;
            expect(anchors!.gaps[a]).toBe(p.gapCm);
            expect(anchors!.bands[a]).toBe(p.band);
            expect(anchors!.easeTargets[a]).toBe(p.easeTarget);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(200);
  });

  it('wrap dress, recommended size: bust becomes chest, the shoulder width is shoulder_width (never the shoulder ring)', () => {
    expect(anchorGaps(computeFit(WRAP, REF))).toEqual({
      size: 'M',
      gaps: { chest: 4.3, waist: 2.2, hip: 4.4, shoulder_width: 0 },
      bands: { chest: 'good', waist: 'good', hip: 'good', shoulder_width: 'good' },
      easeTargets: { chest: 5.7, waist: 3.8, hip: 7.6, shoulder_width: 1 },
      slackCm: { chest: 10, waist: 6, hip: 12, shoulder_width: 1 },
    });
    expect(Object.keys(anchorGaps(computeFit(WRAP, REF))!.gaps)).not.toContain('shoulder');
  });

  it('shoes: foot is dropped, so no anchors', () => {
    const shoe = MOCK_GARMENTS.find((g) => g.category === 'shoes')!;
    const r = computeFit(shoe, BODIES[4]!);
    const g = anchorGaps(r);
    expect(fitGapsForRender(r)?.gaps.foot).toBeTypeOf('number');
    expect(g).not.toBeNull();
    expect(g!.gaps).toEqual({});
  });

  it('null for an unknown size and an empty chart', () => {
    expect(anchorGaps(computeFit(WRAP, REF), 'XXL')).toBeNull();
    expect(anchorGaps(computeFit({ ...WRAP, sizeChart: [] }, REF))).toBeNull();
  });

  it('computeFit output is unchanged apart from closestIndex', () => {
    const r = computeFit(WRAP, REF);
    expect(r.closestIndex).toBe(2);
    expect(r.perSize[r.closestIndex!]!.size).toBe(r.closestSize);
    expect(computeFit({ ...WRAP, sizeChart: [] }, REF).closestIndex).toBeUndefined();
  });
});

describe('duplicate size labels in an unvalidated chart (finding #2)', () => {
  // Two rows labelled M: the first carries the XS numbers, the second the real M.
  const [xs, s, m, l] = WRAP.sizeChart;
  const dup: FitGarment = { ...WRAP, sizeChart: [xs!, s!, { ...xs!, size: 'M' }, m!, l!] };

  it('the helpers read the chosen row through closestIndex, not the first row labelled M', () => {
    const r = computeFit(dup, REF);
    expect(r.recommendedSize).toBe('M');
    expect(r.closestIndex).toBe(3);
    const chosen = r.perSize[3]!;
    const firstM = r.perSize[2]!;
    const gaps = fitGapsForRender(r)!;
    for (const p of chosen.points.filter(isPointFit)) expect(gaps.gaps[p.point]).toBe(p.gapCm);
    const firstBust = firstM.points.filter(isPointFit).find((p) => p.point === 'bust')!;
    expect(gaps.gaps.bust).not.toBe(firstBust.gapCm);
    expect(fitSummary(r)).toBe(fitSummary(computeFit(WRAP, REF)));
    expect(anchorGaps(r)!.gaps.chest).toBe(gaps.gaps.bust);
  });

  it('an explicitly requested label that two rows share (and is not the chosen one) is ambiguous → null', () => {
    const twoXs: FitGarment = { ...WRAP, sizeChart: [xs!, { ...s!, size: 'XS' }, m!, l!] };
    const r = computeFit(twoXs, REF);
    expect(fitGapsForRender(r, 'XS')).toBeNull();
    expect(anchorGaps(r, 'XS')).toBeNull();
    expect(fitGapsForRender(r, 'L')?.size).toBe('L');
  });

  it('a result without closestIndex never summarises an ambiguous row', () => {
    const r = computeFit(dup, REF);
    const { closestIndex: _drop, ...legacy } = r;
    const old: FitResult = legacy;
    expect(fitSummary(old)).toBe("We can't check the fit of this item yet.");
    expect(fitGapsForRender(old)).toBeNull();
    // With a unique chart the label lookup still works without the index.
    const { closestIndex: _d, ...plain } = computeFit(WRAP, REF);
    expect(fitSummary(plain)).toBe('Size M fits you well (estimate, 84% confidence).');
  });
});
