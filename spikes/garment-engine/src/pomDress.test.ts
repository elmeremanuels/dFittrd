import { describe, expect, it } from 'vitest';
import { checkGarmentBundle, garmentQaFlags } from '@curtain/schema';
import { buildPomDress, measurePomDress, pomDressErrors } from './pomDress';
import { POM_DRESS_TAPE_TOLERANCE_CM, auChartBody, buildPomDressBundle } from './pomDressBundle';
import { SYNTHETIC_DRESS_ID, SYNTHETIC_DRESS_MEASURED, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE, SYNTHETIC_TAPE_DRESS, fillDressTape } from './pomDressSynthetic';

describe('the SYNTHETIC dress tape', () => {
  it('labels AU 8, 12, 16 measured and fills AU 10 and 14 on the line between them', () => {
    expect(SYNTHETIC_DRESS_TAPE.provenance).toEqual({ 8: 'measured', 10: 'interpolated', 12: 'measured', 14: 'interpolated', 16: 'measured' });
    const ten = SYNTHETIC_DRESS_POM.find((r) => r.size === '10')!;
    expect(ten.bustWidthCm).toBe(48.5);
    expect(ten.lengthCm).toBe(71);
    expect(ten.strapLengthCm).toBe(46);
  });
  it('refuses a size outside the measured ones', () => {
    expect(() => fillDressTape(['6', '8'], SYNTHETIC_DRESS_MEASURED)).toThrow(/outside the measured sizes/);
    expect(() => fillDressTape(['18'], SYNTHETIC_DRESS_MEASURED)).toThrow(/outside the measured sizes/);
  });
});

describe('the tape-built dress', () => {
  it('holds every input within the gate on a second stature, and moves with it', () => {
    const row = SYNTHETIC_DRESS_POM.find((r) => r.size === '12')!;
    const levels: Record<number, { top: number; seam: number; hem: number }> = {};
    for (const h of [156, 180]) {
      const body = auChartBody('12', h)!;
      const b = buildPomDress(body, row, { rowStepCm: 2.4 });
      const err = pomDressErrors(row, measurePomDress(b.mesh.positions, b));
      expect(Math.max(...Object.values(err).map(Math.abs)), `${h} cm`).toBeLessThanOrEqual(POM_DRESS_TAPE_TOLERANCE_CM);
      levels[h] = { top: b.levels.topY - body.morphHeights.chest, seam: b.levels.seamY - body.morphHeights.underbust, hem: b.levels.hemY - body.morphHeights.knee };
    }
    // The same strap puts the top edge lower on the short body's bust and higher on the tall one's; the hem ends lower on the short leg.
    expect(levels[156]!.top).toBeLessThan(levels[180]!.top);
    expect(levels[156]!.hem).toBeLessThan(levels[180]!.hem - 5);
  }, 240_000);

  it('packs a bundle that passes the tape gate and the bundle check, flagged tape-built', () => {
    const b = buildPomDressBundle(SYNTHETIC_DRESS_ID, SYNTHETIC_TAPE_DRESS, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE.provenance);
    for (const t of b.tape) {
      expect(t.maxAbsCm, `AU ${t.size}`).toBeLessThanOrEqual(POM_DRESS_TAPE_TOLERANCE_CM);
      expect(t.tight, `AU ${t.size}`).toEqual([]);
    }
    const anchors = JSON.parse(b.files['anchors.json']) as { support: { pinFromCm: number; cling: boolean; seamsAtCm: number[] }; rings: Record<string, unknown> };
    const qa = JSON.parse(b.files['qa.json']) as { meshHealth: { nonManifoldEdges: number; inconsistentEdges: number; withinBudget: boolean }; tapeProvenance: { sizes: Record<string, string> }; chartAgreement: { kind: string; pass: boolean } };
    expect(Object.keys(anchors.rings).sort()).toEqual(['chest', 'hip', 'thigh', 'underbust', 'waist']);
    expect(anchors.support.cling).toBe(false);
    expect(anchors.support.seamsAtCm).toHaveLength(1);
    expect(qa.meshHealth).toMatchObject({ nonManifoldEdges: 0, inconsistentEdges: 0, withinBudget: true });
    expect(qa.tapeProvenance.sizes).toEqual(SYNTHETIC_DRESS_TAPE.provenance);
    expect(garmentQaFlags(qa)).toEqual(['tape_built_no_chart_check']);
    const bytes = Object.values(b.files).reduce((n, d) => n + (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength), 0);
    const check = checkGarmentBundle({ anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa: JSON.parse(b.files['qa.json']), bytes }, SYNTHETIC_TAPE_DRESS.sizeChart.map((r) => r.size), { family: 'female' });
    expect(check.ok).toBe(true);
    // What the device's grading of the base size misses against the tape: bounded, and largest where the morph cannot reach.
    for (const g of b.gradingCheck) for (const [k, v] of Object.entries(g.errorCm)) expect(Math.abs(v!), `AU ${g.size} ${k}`).toBeLessThanOrEqual(0.6);
  }, 240_000);
});
