/**
 * The POM chino builder (men-3d-plan slices M3/M4) on the SYNTHETIC chino measurements (not a product): one welded
 * piece with three openings, every measurement it builds to within 0.5 cm of the tape in every size, a waistband where
 * the fit engine reads the waist, UVs that weld back to the same mesh, and a bundle the shared gate admits for a men's
 * product only, flagged as built from the tape.
 */
import { describe, expect, it } from 'vitest';
import { anchorGaps, computeFit } from '@curtain/fit-engine';
import { MALE_REFERENCE, buildMannequin, familyShape, topology } from '@curtain/mannequin';
import { SYNTHETIC_MENS_CHINO_WL, checkGarmentBundle, garmentQaFlags } from '@curtain/schema';
import { readTexturedGlb } from './glbTextured';
import { POM_CHINO_ASSUMPTIONS, bodyGirthAt, buildPomChino, measurePomChino, sliceChinoGirths, wornWaistHeight } from './pomChino';
import { CHINO_GATED_KEYS, POM_CHINO_TAPE_TOLERANCE_CM, buildPomChinoBundle } from './pomChinoBundle';
import { SYNTHETIC_CHINO_BASE_SIZE, SYNTHETIC_CHINO_BODY, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM } from './pomChinoSynthetic';

const male = buildMannequin(familyShape('male', 'M')!);
const baseRow = SYNTHETIC_CHINO_POM.find((r) => r.size === SYNTHETIC_CHINO_BASE_SIZE)!;
const bundle = buildPomChinoBundle(SYNTHETIC_CHINO_PAYLOAD.id, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM, SYNTHETIC_CHINO_BASE_SIZE, { bodyOfWaist: SYNTHETIC_CHINO_BODY });
const meta = () => ({ anchors: JSON.parse(bundle.files['anchors.json']), grading: JSON.parse(bundle.files['grading.json']), material: JSON.parse(bundle.files['material.json']), qa: JSON.parse(bundle.files['qa.json']), bytes: Object.values(bundle.files).reduce((n, f) => n + f.length, 0) });

describe('the SYNTHETIC chino chart', () => {
  it('is the fixture chart, every row unchanged, with W40 to W44 added', () => {
    expect(SYNTHETIC_CHINO_PAYLOAD.sizeChart.slice(0, SYNTHETIC_MENS_CHINO_WL.sizeChart.length)).toEqual(SYNTHETIC_MENS_CHINO_WL.sizeChart);
    expect(SYNTHETIC_CHINO_PAYLOAD.sizeChart.map((r) => r.size).filter((s) => s.endsWith('/32'))).toEqual(['30/32', '32/32', '34/32', '36/32', '38/32', '40/32', '42/32', '44/32']);
    expect(SYNTHETIC_CHINO_PAYLOAD.id).toBe(SYNTHETIC_MENS_CHINO_WL.id);
    expect(SYNTHETIC_CHINO_PAYLOAD.name).toMatch(/SYNTHETIC.*not a product/);
  });
});

describe('buildPomChino on the male M body', () => {
  const b = buildPomChino(male, baseRow);

  it('is one welded, consistently wound piece with three openings: the waist and two hems', () => {
    const t = topology(b.mesh);
    expect(t.components).toBe(1);
    expect(t.nonManifoldEdges).toBe(0);
    expect(t.inconsistentEdges).toBe(0);
    expect(t.degenerateTriangles).toBe(0);
    const N = b.legRows[0][0]!.length, T = b.torsoRows[1]!.length;
    expect(t.boundaryEdges).toBe(T + 2 * N);
    // The two legs share the fork's vertices on the crotch row (the crotch seam) and nothing else.
    const crotch = [b.legRows[0][b.legRows[0].length - 1]!, b.legRows[1][b.legRows[1].length - 1]!];
    const shared = crotch[0]!.filter((id) => crotch[1]!.includes(id));
    expect(shared.length).toBe(N - T / 2 + 1);
    for (const id of shared) expect(b.mesh.positions[3 * id]).toBe(0);
    expect(shared).toContain(b.crotchPoint);
    expect(b.triPanel.length).toBe(b.mesh.indices.length / 3);
  });

  it('reproduces every measurement it builds to; the plane cut agrees with the rows', () => {
    const got = measurePomChino(b), cut = sliceChinoGirths(b);
    for (const k of CHINO_GATED_KEYS) expect(Math.abs(got[k] - baseRow[k]), k).toBeLessThan(0.02);
    expect(Math.abs(cut.seatWidthCm - baseRow.seatWidthCm)).toBeLessThan(0.05);
    expect(Math.abs(cut.thighWidthCm - baseRow.thighWidthCm)).toBeLessThan(0.05);
    expect(Math.abs(cut.kneeWidthCm - baseRow.kneeWidthCm)).toBeLessThan(0.05);
    // The outseam is not built to: taped and reported.
    expect(Math.abs(got.outseamCm - baseRow.outseamCm)).toBeLessThan(1.5);
  });

  it('puts the waistband where the fit engine reads the waist, the crotch seam under the body, the back higher than the front', () => {
    const A = POM_CHINO_ASSUMPTIONS;
    expect(b.levels.wornWaistY).toBeGreaterThan(male.morphHeights.hip);
    expect(b.levels.wornWaistY).toBeLessThan(male.morphHeights.waist);
    expect(b.levels.bandCentreY + b.levels.bandBelowWornCm).toBeCloseTo(b.levels.wornWaistY, 1);
    expect(b.levels.bandBelowWornCm).toBeLessThan(0.5);
    expect(b.levels.crotchEaseCm).toBeGreaterThanOrEqual(A.minCrotchEaseCm - 1e-6);
    expect(b.levels.bandTopBackY).toBeGreaterThan(b.levels.bandTopFrontY);
    expect(b.levels.tiltCm).toBeLessThan(A.tiltRangeCm[1]);
  });

  it('reads the worn waist as the fit engine does: its body girth there is the waistband less the engine’s slack, within the body’s own curve', () => {
    // The fit engine interpolates the girth between waist and seat; the builder interpolates the height. On the mannequin the two differ by its profile between the rings.
    for (const id of ['S', 'M', 'L', 'XL', 'XXL'] as const) {
      const t = MALE_REFERENCE[id];
      const fit = computeFit(SYNTHETIC_CHINO_PAYLOAD, { measurements: { bust: t.chest, waist: t.waist, hip: t.hip, thigh: t.thigh, inseam: t.inseam }, heightCm: t.stature });
      // Garment minus body where the fit engine read the waist: the body's girth there is the waistband less that slack.
      const worn = baseRow.waistWidthCm * 2 - anchorGaps(fit, '34/32')!.slackCm.waist!;
      expect(worn).toBeGreaterThan(t.waist);
      expect(worn).toBeLessThan(t.hip);
      const body = buildMannequin(familyShape('male', id)!);
      const girth = bodyGirthAt(body, wornWaistHeight(body, 27))!;
      expect(Math.abs(girth - worn), id).toBeLessThan(1.6);
    }
  });

  it('records a measurement tighter than the body instead of hiding it', () => {
    const small = SYNTHETIC_CHINO_POM.find((r) => r.size === '30/32')!;
    const tightOne = buildPomChino(male, small);
    expect(tightOne.tight.map((t) => t.where)).toContain('waist');
    expect(Math.abs(measurePomChino(tightOne).waistWidthCm - small.waistWidthCm)).toBeLessThan(0.02);
    expect(b.tight.map((t) => t.where)).not.toContain('seat');
  });
});

describe('the POM chino bundle', () => {
  it('passes the tape gate on every size, on the male table body its waist belongs to', () => {
    expect(bundle.tape.map((t) => t.size)).toEqual(SYNTHETIC_CHINO_POM.map((r) => r.size));
    for (const t of bundle.tape) expect(t.maxAbsCm, t.size).toBeLessThanOrEqual(POM_CHINO_TAPE_TOLERANCE_CM);
    expect(Math.max(...bundle.tape.map((t) => t.maxAbsCm))).toBeLessThan(0.1);
    expect(JSON.parse(bundle.files['qa.json']).pomTape).toMatchObject({ pass: true, checkedOnly: ['outseamCm'] });
  });

  it('says where the rises do not reach the worn waist: the band then sits lower, the crotch seam stays under the body', () => {
    for (const t of bundle.tape) {
      expect(t.levels.crotchEaseCm, t.size).toBeGreaterThanOrEqual(POM_CHINO_ASSUMPTIONS.minCrotchEaseCm - 1e-6);
      if (t.levels.bandBelowWornCm > 0.01) expect(t.levels.crotchEaseCm, t.size).toBeCloseTo(POM_CHINO_ASSUMPTIONS.minCrotchEaseCm, 2);
    }
    // On this chart and these bodies: at the worn waist up to W34, lower from W36 up (the rise grows 0.5 cm per waist, the bodies more).
    const below = Object.fromEntries(bundle.tape.filter((t) => t.size.endsWith('/32')).map((t) => [t.size, t.levels.bandBelowWornCm]));
    expect(below['30/32']).toBe(0);
    expect(below['34/32']).toBeLessThan(0.5);
    expect(below['44/32']).toBeGreaterThan(4);
  });

  it('is graded by the device to every girth and the inseam within 0.05 cm; the rises are not graded and say by how much', () => {
    for (const g of bundle.gradingCheck) {
      for (const k of ['waistWidthCm', 'seatWidthCm', 'thighWidthCm', 'kneeWidthCm', 'legOpeningWidthCm', 'inseamCm'] as const) expect(Math.abs(g.errorCm[k]), `${g.size} ${k}`).toBeLessThan(0.05);
      expect(Math.abs(g.errorCm.frontRiseCm), g.size).toBeLessThan(0.5);
      expect(Math.abs(g.errorCm.backRiseCm), g.size).toBeLessThan(1.5);
    }
  });

  it('passes the shared gate for the men’s product only, flagged as built from the tape', () => {
    const sizes = SYNTHETIC_CHINO_PAYLOAD.sizeChart.map((r) => r.size);
    const m = meta();
    expect(m.bytes).toBeLessThan(600_000);
    const ok = checkGarmentBundle(m, sizes, { family: 'male' });
    expect(ok).toMatchObject({ ok: true, info: { baseSize: '34/32', family: 'male', qaFlags: ['tape_built_no_chart_check'] } });
    expect(checkGarmentBundle(m, sizes, { family: 'female' })).toEqual({ ok: false, problem: 'family_mismatch' });
    // The fixture's own chart (W30 to W38) is covered too.
    expect(checkGarmentBundle(m, SYNTHETIC_MENS_CHINO_WL.sizeChart.map((r) => r.size), { family: 'male' }).ok).toBe(true);
    expect(checkGarmentBundle(m, [...sizes, '46/32'], { family: 'male' })).toEqual({ ok: false, problem: 'chart_mismatch' });
    expect(garmentQaFlags(m.qa)).toEqual(['tape_built_no_chart_check']);
    expect(m.anchors).toMatchObject({ category: 'bottom', synthetic: true, builder: expect.stringMatching(/^pom-chino-/) });
    expect(m.qa.meshHealth).toMatchObject({ pieces: 1, nonManifoldEdges: 0, inconsistentEdges: 0, withinBudget: true });
  });

  it('carries UVs per panel: six pieces, the welded vertices first, nothing folded over, the atlas embedded', () => {
    const layout = bundle.layout!;
    const n = bundle.base.mesh.positions.length / 3;
    for (let r = 0; r < n; r++) expect(layout.remap[r]).toBe(r);
    expect(layout.remap.length).toBeGreaterThan(n);
    expect(layout.islands.map((i) => i.panel)).toEqual(['front_l', 'front_r', 'back_l', 'back_r', 'waistband_l', 'waistband_r']);
    for (let i = 0; i < layout.uvs.length; i++) expect(layout.uvs[i]! >= 0 && layout.uvs[i]! <= 1).toBe(true);
    // Left and right pieces are mirror images: the same size on the pattern.
    const w = (k: number): number => layout.islands[k]!.max[0] - layout.islands[k]!.min[0];
    expect(w(0)).toBeCloseTo(w(1), 6);
    expect(w(2)).toBeCloseTo(w(3), 6);
    expect(w(2)).toBeGreaterThan(w(0)); // the back piece is the wider
    // No triangle is folded over on the pattern (all of a piece's triangles keep one orientation).
    for (let p = 0; p < 6; p++) {
      let pos = 0, neg = 0;
      for (let t = 0; t < bundle.base.triPanel.length; t++) {
        if (bundle.base.triPanel[t] !== p) continue;
        const [a, b, c] = [layout.indices[3 * t]!, layout.indices[3 * t + 1]!, layout.indices[3 * t + 2]!];
        const area = (layout.patternCm[2 * b]! - layout.patternCm[2 * a]!) * (layout.patternCm[2 * c + 1]! - layout.patternCm[2 * a + 1]!) - (layout.patternCm[2 * b + 1]! - layout.patternCm[2 * a + 1]!) * (layout.patternCm[2 * c]! - layout.patternCm[2 * a]!);
        if (area > 1e-9) pos++;
        else if (area < -1e-9) neg++;
      }
      expect(Math.min(pos, neg), layout.islands[p]!.panel).toBe(0);
    }
    const glb = readTexturedGlb(bundle.files['base.glb']);
    expect(glb.image?.mimeType).toBe('image/png');
    expect(glb.uvs!.length / 2).toBe(layout.remap.length);
    expect(JSON.parse(bundle.files['qa.json']).texture).toMatchObject({ kind: 'synthetic-detail', licence: 'CC0-1.0' });
  });

  it('is deterministic', () => {
    const again = buildPomChinoBundle(SYNTHETIC_CHINO_PAYLOAD.id, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM, SYNTHETIC_CHINO_BASE_SIZE, { bodyOfWaist: SYNTHETIC_CHINO_BODY });
    expect(again.files['qa.json']).toBe(bundle.files['qa.json']);
    expect(Buffer.from(again.files['base.glb']).equals(Buffer.from(bundle.files['base.glb']))).toBe(true);
  });
});
