/**
 * The pilot skirt's shop tape: the file parses, the committed products.json entry is exactly what
 * `applyTape` makes of it (so a rebuild by shop:bohohippychic and the committed file agree), and
 * the payload still passes the draft schema.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GarmentPayloadDraftSchema, type GarmentPayloadDraft } from '@curtain/schema';
import { computeFit, type FitGarment } from '@curtain/fit-engine';
import { applyTape, hipEaseIfOneNumber, parseTape, type TapeApplicable } from './shopTape';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic');
const HANDLE = 'crimson-wildflower-maxi-skirt';
const FILE = `tape/${HANDLE}.json`;
const raw = JSON.parse(readFileSync(join(dataDir, FILE), 'utf8')) as unknown;
const products = (JSON.parse(readFileSync(join(dataDir, 'products.json'), 'utf8')) as { products: (TapeApplicable & { handle: string })[] }).products;
const entry = products.find((p) => p.handle === HANDLE)!;

/** The payload as it was before the tape: no length (and no ease: the tape never sets one). */
function withoutTape(payload: GarmentPayloadDraft): GarmentPayloadDraft {
  const bare = { ...payload };
  delete bare.lengthCm;
  delete bare.ease;
  return bare;
}

/** The whole entry as the shop text alone gives it: payload, evidence and the tape note stripped. */
function entryWithoutTape(e: TapeApplicable & { handle: string }): TapeApplicable & { handle: string } {
  const evidence = { ...e.evidence };
  delete evidence.lengthCm;
  const bare = { ...e, payload: withoutTape(e.payload), evidence };
  delete bare.tape;
  return bare;
}

describe('shop tape measurements', () => {
  it('parses the pilot skirt tape: AU 8, 10 and 14 measured, 12 and 16 not', () => {
    const tape = parseTape(raw);
    expect(tape.measuredSizes).toEqual(['8', '10', '14']);
    expect(tape.notMeasuredSizes).toEqual(['12', '16']);
    expect(tape.sizes['8']).toEqual({ waistRelaxedCm: 67, waistStretchedCm: 94, hipCm: 112, hemSweepCm: 230, lengthCm: 103 });
    expect(tape.productId).toBe(entry.payload.id);
  });

  it('refuses a file that gives values to a size it lists as not measured, or a band that does not stretch', () => {
    const tape = parseTape(raw);
    expect(() => parseTape({ ...tape, sizes: { ...tape.sizes, '12': tape.sizes['10'] } })).toThrow(/exactly the measuredSizes/);
    expect(() => parseTape({ ...tape, sizes: { ...tape.sizes, '8': { ...tape.sizes['8'], waistStretchedCm: 60 } } })).toThrow(/stretched band/);
    expect(() => parseTape({ format: 'other' })).toThrow();
  });

  it('puts into the payload what v1 can carry faithfully: one length, the mean of the measured sizes; no hip ease', () => {
    const bare = withoutTape(entry.payload);
    const applied = applyTape({ ...entry, payload: bare }, parseTape(raw), FILE);
    expect(applied.payload.lengthCm).toEqual({ waist_to_hem: 103.3 });
    expect(applied.payload.ease).toBeUndefined();
    expect(Object.keys(applied.tape!.inPayload)).toEqual(['lengthCm.waist_to_hem']);
    expect(applied.tape?.notInPayload.length).toBe(5);
    // garment hip 112 / 122 / 126 minus chart hip 94 / 99 / 109 = 18 / 23 / 17: uneven, not corrected, and why no ease.hip
    expect(applied.tape?.notInPayload.join(' ')).toMatch(/ease\.hip .* is left out: garment hip minus chart hip is 18 \/ 23 \/ 17 cm at AU 8, 10, 14/);
    expect(GarmentPayloadDraftSchema.safeParse(applied.payload).success).toBe(true);
    // idempotent
    expect(applyTape(applied, parseTape(raw), FILE)).toEqual(applied);
  });

  it('one ease.hip number would misstate the garment hip by up to 5.3 cm (why it is left out)', () => {
    const one = hipEaseIfOneNumber(parseTape(raw), entry.payload.sizeChart!)!;
    expect(one.perSizeEaseCm).toEqual([18, 23, 17]);
    expect(one.meanEaseCm).toBe(19.3);
    expect(one.rows).toEqual([
      { size: '8', source: 'measured', tapeHipCm: 112, oneNumberHipCm: 113.3, errorCm: 1.3 },
      { size: '10', source: 'measured', tapeHipCm: 122, oneNumberHipCm: 118.3, errorCm: -3.7 },
      { size: '12', source: 'interpolated', tapeHipCm: 124, oneNumberHipCm: 123.3, errorCm: -0.7 },
      { size: '14', source: 'measured', tapeHipCm: 126, oneNumberHipCm: 128.3, errorCm: 2.3 },
      { size: '16', source: 'extrapolated', tapeHipCm: 128, oneNumberHipCm: 133.3, errorCm: 5.3 },
    ]);
  });

  it('the committed products.json entry is the shop-text entry with the tape applied', () => {
    const bare = entryWithoutTape(entry);
    expect(bare.payload.lengthCm).toBeUndefined();
    expect(bare.tape).toBeUndefined();
    expect(applyTape(bare, parseTape(raw), FILE)).toEqual(entry);
    expect(entry.tape?.file).toBe(FILE);
    expect(entry.payload.ease).toBeUndefined();
    expect(entry.completeness.missing.map((m) => m.field)).not.toContain('lengthCm');
    expect(entry.completeness.missing.map((m) => m.field)).toContain('ease');
  });

  it('the fit engine gives the three test bodies the same size and waist band with and without the tape length', () => {
    const bare = withoutTape(entry.payload);
    const bodies = { slim: { bust: 82, waist: 64, hip: 90 }, average: { bust: 93, waist: 76, hip: 102 }, curvy: { bust: 106, waist: 86, hip: 116 } };
    const picks: string[] = [];
    for (const m of Object.values(bodies)) {
      const before = computeFit(bare as FitGarment, { measurements: m });
      const after = computeFit(entry.payload as FitGarment, { measurements: m });
      // the A-line block skips the hip, and the engine reads no length: nothing changes
      expect(after).toEqual(before);
      picks.push(after.recommendedSize ?? '-');
    }
    expect(picks).toEqual(['8', '12', '16']);
  });
});
