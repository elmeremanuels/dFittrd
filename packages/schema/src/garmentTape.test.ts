import { describe, expect, it } from 'vitest';
import { GarmentPayloadDraftSchema, GarmentPayloadSchema, safeParseGarmentPayload } from './garment';
import { GARMENT_CLOSURES, GarmentTapeSchema, fillGarmentTape, worstTapeProvenance, type MeasuredTapeRow } from './garmentTape';
import { MOCK_GARMENTS, PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY, PILOT_SKIRT_TAPE_MEASURED } from './fixtures';
import { garmentDraftJsonSchema, garmentJsonSchema } from './jsonschema';

const CHART = PILOT_SKIRT_CHART_ONLY.sizeChart;
const row = (tape: ReturnType<typeof fillGarmentTape>, size: string) => {
  const r = tape.find((t) => t.size === size);
  if (!r) throw new Error(`no tape row for ${size}`);
  return r;
};

describe('closure and garmentTape on the payload', () => {
  it('are optional: every existing fixture parses to itself, without the new keys', () => {
    for (const g of MOCK_GARMENTS) {
      const parsed = GarmentPayloadSchema.parse(g);
      expect(parsed).toEqual(g);
      expect('closure' in parsed).toBe(false);
      expect('garmentTape' in parsed).toBe(false);
    }
  });

  it('accepts the pilot skirt with closure and tape, and the draft schema accepts them too', () => {
    expect(GarmentPayloadSchema.parse(PILOT_PULL_ON_SKIRT)).toEqual(PILOT_PULL_ON_SKIRT);
    expect(GarmentPayloadSchema.parse(PILOT_SKIRT_CHART_ONLY)).toEqual(PILOT_SKIRT_CHART_ONLY);
    const draft = { id: 'x', name: 'n', brand: 'b', closure: 'pull-on', garmentTape: PILOT_PULL_ON_SKIRT.garmentTape };
    expect(GarmentPayloadDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('knows the closures and rejects others', () => {
    for (const closure of GARMENT_CLOSURES) expect(safeParseGarmentPayload({ ...PILOT_SKIRT_CHART_ONLY, closure }).success).toBe(true);
    expect(safeParseGarmentPayload({ ...PILOT_SKIRT_CHART_ONLY, closure: 'velcro' }).success).toBe(false);
  });

  it('requires a provenance on every value and rejects impossible rows', () => {
    const ok = [{ size: '8', waistRelaxed: { cm: 67, provenance: 'measured' }, waistStretched: { cm: 94, provenance: 'measured' } }];
    expect(GarmentTapeSchema.safeParse(ok).success).toBe(true);
    expect(GarmentTapeSchema.safeParse([{ size: '8', waistRelaxed: { cm: 67 } }]).success).toBe(false);
    expect(GarmentTapeSchema.safeParse([{ size: '8', waistRelaxed: 67 }]).success).toBe(false);
    expect(GarmentTapeSchema.safeParse([{ size: '8', waistRelaxed: { cm: 67, provenance: 'guessed' } }]).success).toBe(false);
    expect(GarmentTapeSchema.safeParse([{ size: '8', waistRelaxed: { cm: 0, provenance: 'measured' } }]).success).toBe(false);
    // stretched smaller than relaxed
    expect(
      GarmentTapeSchema.safeParse([{ size: '8', waistRelaxed: { cm: 67, provenance: 'measured' }, waistStretched: { cm: 60, provenance: 'measured' } }]).success,
    ).toBe(false);
    // one row per size, compared like the chart labels
    expect(GarmentTapeSchema.safeParse([...ok, { size: ' 8 ', hemSweep: { cm: 230, provenance: 'measured' } }]).success).toBe(false);
    expect(GarmentTapeSchema.safeParse([]).success).toBe(false);
  });

  it('keeps the hip depth with the hip value only', () => {
    const hip = [{ size: '8', hip: { cm: 112, provenance: 'measured', depthBelowBandCm: 20 } }];
    expect(GarmentTapeSchema.parse(hip)).toEqual(hip);
    expect(GarmentTapeSchema.safeParse([{ size: '8', hip: { cm: 112, provenance: 'measured', depthBelowBandCm: -1 } }]).success).toBe(false);
  });

  it('is in the JSON Schema as optional properties, full and draft', () => {
    for (const schema of [garmentJsonSchema(), garmentDraftJsonSchema()]) {
      const s = schema as { properties: Record<string, Record<string, unknown>>; required: string[] };
      expect(s.properties.closure).toMatchObject({ type: 'string', enum: [...GARMENT_CLOSURES] });
      expect(s.properties.garmentTape).toMatchObject({ type: 'array', minItems: 1 });
      expect(s.required).not.toContain('closure');
      expect(s.required).not.toContain('garmentTape');
    }
  });
});

describe('fillGarmentTape', () => {
  const tape = fillGarmentTape(CHART, PILOT_SKIRT_TAPE_MEASURED);

  it('keeps the three measured sizes exactly as the shop wrote them', () => {
    for (const m of PILOT_SKIRT_TAPE_MEASURED) {
      expect(row(tape, m.size)).toEqual({
        size: m.size,
        waistRelaxed: { cm: m.waistRelaxedCm, provenance: 'measured' },
        waistStretched: { cm: m.waistStretchedCm, provenance: 'measured' },
        hip: { cm: m.hipCm, provenance: 'measured' },
        hemSweep: { cm: m.hemSweepCm, provenance: 'measured' },
        length: { cm: m.lengthCm, provenance: 'measured' },
      });
    }
  });

  it('interpolates AU 12 between 10 and 14 and extrapolates AU 16 along the 10 to 14 line, labelled', () => {
    // The numbers of docs/research/step3-serverdrape-spike.md §9.2: AU 12 (75.5-105), AU 16 (84.5-115).
    expect(row(tape, '12')).toEqual({
      size: '12',
      waistRelaxed: { cm: 75.5, provenance: 'interpolated' },
      waistStretched: { cm: 105, provenance: 'interpolated' },
      hip: { cm: 124, provenance: 'interpolated' },
      hemSweep: { cm: 254, provenance: 'interpolated' },
      length: { cm: 103.5, provenance: 'interpolated' },
    });
    expect(row(tape, '16')).toEqual({
      size: '16',
      waistRelaxed: { cm: 84.5, provenance: 'extrapolated' },
      waistStretched: { cm: 115, provenance: 'extrapolated' },
      hip: { cm: 128, provenance: 'extrapolated' },
      hemSweep: { cm: 266, provenance: 'extrapolated' },
      length: { cm: 104.5, provenance: 'extrapolated' },
    });
    expect(tape.map((t) => t.size)).toEqual(['8', '10', '12', '14', '16']);
    expect(GarmentTapeSchema.safeParse(tape).success).toBe(true);
  });

  it('never labels a filled value measured', () => {
    const measuredSizes = new Set(PILOT_SKIRT_TAPE_MEASURED.map((m) => m.size));
    for (const t of tape) {
      for (const v of [t.waistRelaxed, t.waistStretched, t.hip, t.hemSweep, t.length]) {
        expect(v?.provenance === 'measured').toBe(measuredSizes.has(t.size));
      }
    }
  });

  it('leave-one-out on the pilot band: how far the rule is off, and in which direction, where we can check it', () => {
    // AU 10 left out and interpolated from 8 and 14; AU 14 and AU 8 left out and extrapolated.
    const without = (size: string) => fillGarmentTape(CHART, PILOT_SKIRT_TAPE_MEASURED.filter((m) => m.size !== size));
    const measured = (size: string) => PILOT_SKIRT_TAPE_MEASURED.find((m) => m.size === size)!.waistStretchedCm!;
    const error = (size: string) => Math.round((row(without(size), size).waistStretched!.cm - measured(size)) * 10) / 10;
    expect(row(without('10'), '10').waistStretched).toEqual({ cm: 99.3, provenance: 'interpolated' });
    expect(row(without('14'), '14').waistStretched).toEqual({ cm: 112, provenance: 'extrapolated' });
    expect(row(without('8'), '8').waistStretched).toEqual({ cm: 95, provenance: 'extrapolated' });
    // Signed: filled minus measured. Positive = the rule says the band is LONGER than it is, the
    // unsafe side for a pull-on check. Both extrapolations are on that side; the interpolation is not.
    expect(error('10')).toBe(-0.7);
    expect(error('14')).toBe(2);
    expect(error('8')).toBe(1);
    // The measured slope falls from 1.2 (8 to 10) to 1.0 (10 to 14) cm of band per cm of chart
    // waist, and AU 16 continues the 1.0: 115 is more likely too long than too short.
    expect((100 - 94) / (72.5 - 67.5)).toBeCloseTo(1.2, 5);
    expect((110 - 100) / (82.5 - 72.5)).toBeCloseTo(1.0, 5);
    expect(row(tape, '16').waistStretched).toEqual({ cm: 115, provenance: 'extrapolated' });
  });

  it('fills each field from its own samples, ignores unknown sizes and matches labels like the chart', () => {
    const measured: MeasuredTapeRow[] = [
      { size: ' 8 ', waistRelaxedCm: 67, waistStretchedCm: 94 },
      { size: '14', waistRelaxedCm: 80, waistStretchedCm: 110, hemSweepCm: 260 },
      { size: 'XL', waistRelaxedCm: 99, waistStretchedCm: 120 },
    ];
    const t = fillGarmentTape(CHART, measured);
    expect(row(t, '8').waistRelaxed).toEqual({ cm: 67, provenance: 'measured' });
    expect(row(t, '10').waistStretched).toEqual({ cm: 99.3, provenance: 'interpolated' });
    // one hem sample: it stays on its own size; nothing is made up for the others
    expect(row(t, '8').hemSweep).toBeUndefined();
    expect(row(t, '16').hemSweep).toBeUndefined();
    expect(row(t, '14').hemSweep).toEqual({ cm: 260, provenance: 'measured' });
    expect(row(t, '8').hip).toBeUndefined();
    expect(t.some((r) => r.size === 'XL')).toBe(false);
  });

  it('one measured size: only the band is stepped with the chart; hip, hem and length get no value elsewhere', () => {
    const t = fillGarmentTape(CHART, [PILOT_SKIRT_TAPE_MEASURED[1]!]); // AU 10 only
    expect(row(t, '10')).toMatchObject({ hip: { cm: 122, provenance: 'measured' }, hemSweep: { cm: 248, provenance: 'measured' }, length: { cm: 103, provenance: 'measured' } });
    for (const size of ['8', '12', '14', '16']) {
      const r = row(t, size);
      expect(r.hip).toBeUndefined();
      expect(r.hemSweep).toBeUndefined();
      expect(r.length).toBeUndefined(); // was 98 / 108 / 113 / 118: a skirt does not grow 5 cm per size
      expect(r.waistRelaxed?.provenance).toBe('extrapolated');
      expect(r.waistStretched?.provenance).toBe('extrapolated');
    }
    expect(t.map((r) => r.waistStretched!.cm)).toEqual([95, 100, 105, 110, 115]);
    expect(GarmentTapeSchema.safeParse(t).success).toBe(true);
  });

  it('refuses a measured size whose stretched band is smaller than its relaxed band, naming the size', () => {
    const typo = PILOT_SKIRT_TAPE_MEASURED.map((m) => (m.size === '10' ? { ...m, waistStretchedCm: 60 } : m));
    expect(() => fillGarmentTape(CHART, typo)).toThrow(RangeError);
    expect(() => fillGarmentTape(CHART, typo)).toThrow('Size 10: the stretched waistband (60 cm) is smaller than the relaxed waistband (71 cm)');
    // equal is allowed (a band that does not stretch), and a size outside the chart is ignored as before
    expect(() => fillGarmentTape(CHART, [{ size: '10', waistRelaxedCm: 71, waistStretchedCm: 71 }])).not.toThrow();
    expect(() => fillGarmentTape(CHART, [{ size: 'XL', waistRelaxedCm: 71, waistStretchedCm: 60 }])).not.toThrow();
    // crossing lines from different sizes (not a typo on one size): the band values are dropped, the rest is kept and valid
    const crossed = fillGarmentTape(CHART, [{ size: '8', waistRelaxedCm: 90, lengthCm: 103 }, { size: '14', waistStretchedCm: 80, lengthCm: 104 }]);
    expect(crossed.every((r) => r.waistRelaxed === undefined && r.waistStretched === undefined)).toBe(true);
    expect(GarmentTapeSchema.safeParse(crossed).success).toBe(true);
  });

  it('uses the row index when the chart lacks the column, and returns nothing without samples', () => {
    const chart = [{ size: 'S' }, { size: 'M' }, { size: 'L' }, { size: 'XL' }];
    const t = fillGarmentTape(chart, [
      { size: 'S', waistStretchedCm: 90 },
      { size: 'L', waistStretchedCm: 100 },
    ]);
    expect(t.map((r) => [r.size, r.waistStretched])).toEqual([
      ['S', { cm: 90, provenance: 'measured' }],
      ['M', { cm: 95, provenance: 'interpolated' }],
      ['L', { cm: 100, provenance: 'measured' }],
      ['XL', { cm: 105, provenance: 'extrapolated' }],
    ]);
    expect(fillGarmentTape(chart, [])).toEqual([]);
    expect(fillGarmentTape([], PILOT_SKIRT_TAPE_MEASURED)).toEqual([]);
  });

  it('copies the hip depth to filled sizes only when every measured size states the same one', () => {
    const same = fillGarmentTape(CHART, PILOT_SKIRT_TAPE_MEASURED.map((m) => ({ ...m, hipDepthBelowBandCm: 20 })));
    expect(row(same, '12').hip).toEqual({ cm: 124, provenance: 'interpolated', depthBelowBandCm: 20 });
    const mixed = fillGarmentTape(CHART, PILOT_SKIRT_TAPE_MEASURED.map((m, i) => ({ ...m, hipDepthBelowBandCm: 20 + i })));
    expect(row(mixed, '10').hip).toEqual({ cm: 122, provenance: 'measured', depthBelowBandCm: 21 });
    expect(row(mixed, '12').hip).toEqual({ cm: 124, provenance: 'interpolated' });
  });

  it('does not change its inputs', () => {
    const chart = Object.freeze(CHART.map((r) => Object.freeze({ ...r })));
    const measured = Object.freeze(PILOT_SKIRT_TAPE_MEASURED.map((r) => Object.freeze({ ...r })));
    expect(fillGarmentTape(chart, measured)).toEqual(tape);
  });
});

describe('worstTapeProvenance', () => {
  it('orders extrapolated over interpolated over measured', () => {
    expect(worstTapeProvenance([])).toBeUndefined();
    expect(worstTapeProvenance(['measured', undefined])).toBe('measured');
    expect(worstTapeProvenance(['measured', 'interpolated'])).toBe('interpolated');
    expect(worstTapeProvenance(['extrapolated', 'interpolated', 'measured'])).toBe('extrapolated');
  });
});
