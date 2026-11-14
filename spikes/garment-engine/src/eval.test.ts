import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mockGarment } from '@curtain/schema';
import { CHART_TOLERANCE_CM, evaluateGarment, frontOpeningCap, SIMULATED_ERROR } from './eval';
import { evalBundle, PLACEHOLDER_COLOR_HEX } from './evalBundle';
import { cropMesh, fixtureMannequin as m, reconstructedDress, shopPayload, syntheticDress, syntheticSkirt } from './evalFixtures';
import { readGarmentGlb } from './evalMesh';
import { radialMorph } from './garment';
import { shopProduct } from './product';
import { proxySpec } from './proxy';

const fixture = mockGarment('aalter-studio-2');
const src = { kind: 'stage4' as const, path: 'stage4/stage2/garment.glb', simulatedError: null };

describe('evaluateGarment: synthetic dress', () => {
  // The spike's synthetic garment is built with its shoulder_to_hem as a vertical drop (garment.ts); a
  // shop's printed length is flat-lay (the default). Same choice as report-bohohippychic for this product.
  const r = evaluateGarment({ productId: 'aalter-studio-2', payload: fixture, baseSize: 'M', mesh: reconstructedDress(), mannequin: m, source: src, printedLength: 'drop' });

  it('reports the error per anchor before calibration, after the global scale and after calibration', () => {
    const chest = r.rows.find((x) => x.anchor === 'chest')!;
    expect(chest.critical).toBe(true);
    expect(chest.chartCm).toBe(100);
    expect(chest.beforeCm!).toBeGreaterThan(CHART_TOLERANCE_CM); // 3.5 % too big + 1.8 cm bias
    expect(Math.abs(chest.afterGlobalCm!)).toBeLessThan(Math.abs(chest.beforeCm!));
    expect(Math.abs(chest.afterCm!)).toBeLessThan(0.2); // the tape re-measures the morphed mesh: not exactly 0
    expect(chest.pass).toBe(true);
    expect(r.agreement.pass).toBe(true);
    expect(r.before.pass).toBe(false);
    expect(r.calibration.globalScale).toBeCloseTo(1 / 1.035, 1);
    expect(r.warnings).toEqual([]);
  });

  it('measures every ring of the category and compares lengths with the payload', () => {
    expect(r.rows.map((x) => x.anchor)).toEqual(expect.arrayContaining(['chest', 'waist', 'hip', 'upper_arm']));
    const hem = r.lengths.find((l) => l.id === 'shoulder_to_hem')!;
    expect(hem.printedCm).toBe(fixture.lengthCm!.shoulder_to_hem);
    expect(Math.abs(hem.diffCm!)).toBeLessThan(1);
    expect(r.lengths.find((l) => l.id === 'sleeve_length')!.measuredCm).not.toBeNull();
  });

  it('grades to every size in the chart', () => {
    expect(r.grading!.sizes.map((s) => s.size)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    expect(r.grading!.sizes[0]!.targets.chest).toBeLessThan(r.grading!.sizes[4]!.targets.chest!);
  });

  it('applies the simulated error to a ground truth, and a truth needs no correction', () => {
    const truth = evaluateGarment({ productId: 'aalter-studio-2', payload: fixture, baseSize: 'M', mesh: syntheticDress(), mannequin: m, source: { kind: 'synthetic-truth', path: 'synthetic/garment_truth.glb', simulatedError: null } });
    expect(Math.abs(truth.rows.find((x) => x.anchor === 'chest')!.beforeCm!)).toBeLessThan(0.5);
    const sim = evaluateGarment({ productId: 'aalter-studio-2', payload: fixture, baseSize: 'M', mesh: syntheticDress(), mannequin: m, source: { kind: 'synthetic-truth', path: 'synthetic/garment_truth.glb', simulatedError: SIMULATED_ERROR } });
    expect(sim.before.maxAbsCm).toBeCloseTo(r.before.maxAbsCm!, 1);
    expect(sim.source.sha256).toBe(truth.source.sha256); // the hash is of the file as read
  });
});

describe('evaluateGarment: what fails', () => {
  it('flags a reconstruction whose size is far off', () => {
    const big = radialMorph(m, syntheticDress(), new Uint8Array(syntheticDress().positions.length / 3), { girthScaleAt: () => 1.25 });
    const r = evaluateGarment({ productId: 'x', payload: fixture, baseSize: 'M', mesh: big, mannequin: m, source: src });
    expect(r.warnings.some((w) => /global scale/.test(w))).toBe(true);
    expect(r.before.maxAbsCm!).toBeGreaterThan(20);
  });

  it('fails chart agreement at a critical ring the garment has no loop at, without inventing a girth', () => {
    const shop = shopPayload('azure-palm-baby-doll-dress');
    const skirtOnly = syntheticSkirt();
    const r = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: skirtOnly, mannequin: m, source: src });
    const chest = r.rows.find((x) => x.anchor === 'chest')!;
    expect(chest.measuredCm).toBeNull();
    expect(chest.pass).toBe(false);
    expect(chest.note).toMatch(/does not go round this ring/);
    expect(r.agreement.pass).toBe(false);
    expect(r.agreement.missing).toEqual(['chest']);
  });

  it('bridges a cardigan\'s own front opening (from its description) as the fronts laid closed, and nothing wider or elsewhere', () => {
    const shop = shopPayload('woodstock-wanderer-knit-cardi');
    const cardi = shopProduct('bohohippychic', JSON.parse(readFileSync(new URL('../data/bohohippychic/products.json', import.meta.url), 'utf8')) as unknown, shop.handle);
    const opening = proxySpec(m, cardi.payload, 'S-M', { features: cardi.features! }).frontOpening!;
    expect(opening.kind).toBe('v');
    const chestCap = frontOpeningCap(opening, m.morphHeights.chest);
    expect(chestCap).toBeGreaterThan(6 + 1);
    expect(chestCap).toBeLessThan(20);
    const open = cropMesh(reconstructedDress(), (x, y, z) => !(z > 0 && Math.abs(x) < 3) && y > m.morphHeights.hip - 5);
    const ev = (mesh: typeof open, frontOpening: typeof opening | null, handle = shop.handle, payload = shop.payload, size = 'S-M') =>
      evaluateGarment({ productId: handle, payload, baseSize: size, mesh, mannequin: m, source: src, frontOpening });
    const r = ev(open, opening);
    expect(r.category).toBe('outerwear');
    // The 6 cm cut lies inside the V's width at the chest: bridged, and the note says so.
    expect(r.agreement.missing).toEqual([]);
    const chest = r.rows.find((x) => x.anchor === 'chest')!;
    expect(chest.measuredCm).not.toBeNull();
    expect(chest.note).toMatch(/front opening [\d.]+ cm bridged/);
    // The bridged arc is not counted as cloth.
    expect(chest.tapeCoverage!).toBeLessThan(1);
    // The waist lies below the V (it ends at the underbust, buttoned below): no opening there, so the cut is a hole.
    expect(r.rows.find((x) => x.anchor === 'waist')!.measuredCm).toBeNull();
    // Outerwear whose description gives no opening: the same cut is a hole at the chest.
    expect(ev(open, null).agreement.missing).toEqual(['chest']);
    // A gap at the front wider than the V there + the slack is a hole, not the opening.
    const wide = cropMesh(reconstructedDress(), (x, y, z) => !(z > 0 && Math.abs(x) < chestCap / 2 + 3) && y > m.morphHeights.hip - 5);
    expect(ev(wide, opening).agreement.missing).toEqual(['chest']);
    // The same cut on a top is still no girth: the tape bridges holes up to 4 cm, never a 6 cm opening, outside outerwear.
    const top = shopPayload('rosewater-blouse');
    const rt = ev(open, opening, top.handle, top.payload, '12');
    expect(rt.agreement.missing).toEqual(['chest']);
    expect(rt.agreement.pass).toBe(false);
    // And a cardigan cut open at the BACK is a hole, not a front opening.
    const back = cropMesh(reconstructedDress(), (x, y, z) => !(z < 0 && Math.abs(x) < 3) && y > m.morphHeights.hip - 5);
    expect(ev(back, opening).agreement.missing).toEqual(['chest']);
  });
});

describe('evaluateGarment: a bottom (skirt cut from the synthetic dress)', () => {
  const shop = shopPayload('crimson-wildflower-maxi-skirt');
  const r = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: syntheticSkirt(), mannequin: m, source: src });

  it('calibrates the waist against the AU chart plus the a-line block ease the fit engine uses; the a-line hip is reported, not calibrated', () => {
    expect(r.critical).toEqual(['waist']);
    // AU 12 waist 77.5 + 3 (BLOCKS['a-line'].ease.waist, as computeFit); the category default +2 was used before drape-prior P0.
    expect(r.rows.find((x) => x.anchor === 'waist')!.chartCm).toBe(80.5);
    const hip = r.rows.find((x) => x.anchor === 'hip')!;
    expect(hip.chartCm).toBe(109);
    expect(hip.notFitted).toBe(true);
    expect(hip.note).toMatch(/a-line/);
    expect(Object.keys(r.calibration.ringCorrections)).not.toContain('hip');
    expect(r.agreement.pass).toBe(true);
    expect(r.rows.find((x) => x.anchor === 'thigh')?.note).toMatch(/both legs|no chart value/);
  });

  it('reports the outseam and grades to AU 8–16', () => {
    expect(r.lengths.find((l) => l.id === 'outseam')!.measuredCm!).toBeGreaterThan(50);
    expect(r.grading!.sizes.map((s) => s.size)).toEqual(['8', '10', '12', '14', '16']);
  });
});

describe('evalBundle', () => {
  const shop = shopPayload('azure-palm-baby-doll-dress');
  const r = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: reconstructedDress(), mannequin: m, source: src });
  const b = evalBundle(r, shop.payload);

  it('writes the spike bundle files plus payload.json and eval.json, deterministically', () => {
    expect(Object.keys(b.files).sort()).toEqual(['anchors.json', 'base.glb', 'eval.json', 'grading.json', 'material.json', 'payload.json', 'qa.json']);
    const again = evalBundle(r, shop.payload);
    expect(again.inputHash).toBe(b.inputHash);
    expect(again.files['qa.json']).toBe(b.files['qa.json']);
    expect(Buffer.from(again.files['base.glb']).equals(Buffer.from(b.files['base.glb']))).toBe(true);
    expect(b.bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it('carries the calibrated mesh, the payload and a colour whose source is stated', () => {
    const mesh = readGarmentGlb(b.files['base.glb']).mesh;
    expect(mesh.indices.length).toBe(r.baseMesh.indices.length);
    expect(JSON.parse(b.files['payload.json'])).toEqual(shop.payload);
    const mat = JSON.parse(b.files['material.json']) as { baseColorHex: string; provenance: Record<string, string> };
    expect(mat.baseColorHex).toBe(PLACEHOLDER_COLOR_HEX);
    expect(mat.provenance.baseColorHex).toMatch(/placeholder/);
    expect(JSON.parse(evalBundle(r, shop.payload, { meanColorHex: '#336699' }).files['material.json']).baseColorHex).toBe('#336699');
    const qa = JSON.parse(b.files['qa.json']) as { synthetic: boolean; chartAgreement: { pass: boolean; critical: string[] } };
    expect(qa.synthetic).toBe(false);
    expect(qa.chartAgreement.critical).toEqual(['chest']); // empire block: waist and hip hang free
    const grading = JSON.parse(b.files['grading.json']) as { sizes: { size: string }[] };
    expect(grading.sizes.map((s) => s.size)).toEqual(['8', '10', '12', '14', '16']);
  });
});

describe('evaluateGarment: the low-rise waist reading (a recorded founder decision, src/lowRise.ts)', () => {
  const shop = shopPayload('crimson-wildflower-maxi-skirt');
  // The synthetic skirt with everything above 4 cm under the waist ring cut away: a band worn low, as run 17d's.
  const low = cropMesh(syntheticSkirt(), (_x, y) => y < m.morphHeights.waist - 4);
  const natural = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: low, mannequin: m, source: src });
  const choice = { kind: 'low-rise' as const, decision: 'test: founder, 2026-11-09' };
  const lowRise = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: low, mannequin: m, source: src, waistReading: choice });

  it('by default the waist has no girth and chart agreement fails (nothing invented)', () => {
    expect(natural.agreement.pass).toBe(false);
    expect(natural.agreement.missing).toEqual(['waist']);
    expect(natural.agreement.waistReading).toBeUndefined();
    expect(natural.rows.find((x) => x.anchor === 'waist')!.afterCm).toBeNull();
  });

  it('with the switch, the band is compared with the chart waist plus the stated body offset, calibrated at its own height, and flagged everywhere', () => {
    const wr = lowRise.agreement.waistReading!;
    expect(wr.decision).toBe(choice.decision);
    expect(wr.dropCm).toBeGreaterThan(4);
    // The body is wider at the band than at the waist ring: the target is the chart's waist plus that, never the band's own girth.
    expect(wr.offsetCm).toBeGreaterThan(0);
    expect(wr.targetCm).toBeCloseTo(wr.chartWaistCm + wr.offsetCm, 1);
    expect(wr.chartWaistCm).toBe(80.5);
    const row = lowRise.rows.find((x) => x.anchor === 'waist')!;
    expect(row.note).toMatch(/LOW-RISE READING \(founder decision: test: founder/);
    expect(row.beforeCm).toBeCloseTo(row.measuredCm! - wr.targetCm, 1);
    expect(Math.abs(row.afterCm!)).toBeLessThanOrEqual(CHART_TOLERANCE_CM);
    expect(lowRise.agreement.pass).toBe(true);
    expect(lowRise.agreement.missing).toEqual([]);
    expect(lowRise.warnings.some((w) => /LOW-RISE by founder decision/.test(w))).toBe(true);
    const qa = JSON.parse(evalBundle(lowRise, shop.payload).files['qa.json'] as string) as { chartAgreement: { waistReading?: { kind: string; decision: string } } };
    expect(qa.chartAgreement.waistReading).toMatchObject({ kind: 'low-rise', decision: choice.decision });
    const qaNatural = JSON.parse(evalBundle(natural, shop.payload).files['qa.json'] as string) as { chartAgreement: Record<string, unknown> };
    expect('waistReading' in qaNatural.chartAgreement).toBe(false);
  });

  it('does nothing without a decision, or on a skirt that reaches the waist ring (and says so)', () => {
    const anon = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: low, mannequin: m, source: src, waistReading: { kind: 'low-rise', decision: ' ' } });
    expect(anon.agreement.pass).toBe(false);
    expect(anon.warnings.some((w) => /not applied/.test(w))).toBe(true);
    const full = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: syntheticSkirt(), mannequin: m, source: src, waistReading: choice });
    expect(full.agreement.waistReading).toBeUndefined();
    expect(full.warnings.some((w) => /reaches the waist ring/.test(w))).toBe(true);
  });
});

describe('evaluateGarment: trousers whose seat goes round both thighs at the thigh ring', () => {
  it('reports the loop as the seat, never as a leg girth: not calibrated, not graded', () => {
    const shop = shopPayload('rosewater-palazzo-pants');
    // The synthetic skirt stands in for a seat that reaches below the thigh ring (stage 4t 0.4.0 sews the legs on below it).
    const r = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: syntheticSkirt(), mannequin: m, source: src });
    const thigh = r.rows.find((x) => x.anchor === 'thigh')!;
    expect(thigh.measuredCm).toBeNull();
    expect(thigh.note).toMatch(/the seat.*not a leg girth/);
    expect(Object.keys(r.calibration.ringCorrections)).not.toContain('thigh');
    for (const s of r.grading!.sizes) expect((s.targets as Record<string, number>).thigh).toBeUndefined();
  });
});
