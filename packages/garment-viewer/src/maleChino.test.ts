/**
 * The POM chino on the male body in the viewer (men-3d-plan slices M3/M4): the SYNTHETIC men's test chino W/L of the
 * spike (not a product), built from its flat measurements, passes the device check for a men's garment only, welds back
 * to the builder's mesh, and drapes on the male table bodies S to XXL in the size the fit engine gives each: the band
 * and the seat stay outside the drawn body, the tape after the drape stays near the input, and the strain at the crotch
 * is bounded and said. A size too small for the body is not draped and not drawn, by the fit engine's own bands.
 * Every case runs twice: built on the male shape v1 (the default) and on v2, each draped on bodies of its own shape; a
 * bundle is refused on the other shape. No WebGL: the drape is the one the mount runs (`prepareFit` + `relax`).
 */
import { describe, expect, it } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE } from '@curtain/mannequin';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { buildPomChinoBundle } from '../../../spikes/garment-engine/src/pomChinoBundle';
import { SYNTHETIC_CHINO_BASE_SIZE, SYNTHETIC_CHINO_BODY, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM } from '../../../spikes/garment-engine/src/pomChinoSynthetic';
import { loadBundleFrom } from './bundle';
import { checkBundle } from './bundleCheck';
import { chinoDrape, loadChino, serve, type ChinoDrapeMetrics } from '../test/chinoDrape';
import { openSession, prepareFit, sewnNotDrawn, viewerMaterial } from './engine';
import { GarmentViewError, planAvatar } from './mount';
import { LEG_TOP_FILLET_CM, SEAT_BRIDGE_BELOW_CM, SEAT_BRIDGE_FADE, isTapeTrouser, trouserField, trouserNoCollide, trouserNotDrawn, trouserSeams, wornBodyRings } from './trouser';

const RECOMMENDED = { S: '32/32', M: '34/32', L: '38/32', XL: '40/32', XXL: '44/32' } as const;
const fullBody = (id: keyof typeof MALE_REFERENCE) => {
  const t = MALE_REFERENCE[id];
  return { measurements: { bust: t.chest, waist: t.waist, hip: t.hip, thigh: t.thigh, inseam: t.inseam }, heightCm: t.stature };
};

/**
 * What is bounded per shape, from the runs of the branches that measured it (docs/reports/claude/men-chino-v2.md, then
 * chino-crotch-v2.md). The crotch: how far the drape lets the crotch point drop below where the builder put it
 * (`crotchDropCm`), and how far the seam hangs under the body in all (`crotchBelowCm`, per body: the size's rises on that
 * body, the band's slide and the drape together). Pixels: drawn body in front of the cloth, four views, per body.
 * On v2 the pixels were 175 to 274 and the largest edge near the crotch point 33 % while its thighs crossed the centre
 * plane; they are 0 to 30 and 11 % since they part (chino-crotch-v2).
 */
const BOUNDS = {
  v1: {
    seatShortCm: 3.4, crotchDropCm: 3.9, crotchP99: 14, crotchMax: 24, bandDropCm: 0,
    pixels: { S: 120, M: 20, L: 15, XL: 25, XXL: 100 },
    crotchBelowCm: { S: 6.8, M: 3.9, L: 3.6, XL: 4.3, XXL: 4.4 },
  },
  v2: {
    seatShortCm: 1.9, crotchDropCm: 2.7, crotchP99: 11, crotchMax: 14, bandDropCm: 3,
    pixels: { S: 50, M: 25, L: 15, XL: 15, XXL: 25 },
    crotchBelowCm: { S: 7.8, M: 4.4, L: 5, XL: 3.1, XXL: 3.3 },
  },
} as const;

describe.each(['v1', 'v2'] as const)('the POM chino on the male shape %s', (shape) => {
  const built = buildPomChinoBundle(SYNTHETIC_CHINO_PAYLOAD.id, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM, SYNTHETIC_CHINO_BASE_SIZE, { bodyOfWaist: SYNTHETIC_CHINO_BODY, maleShape: shape });
  const other = shape === 'v1' ? 'v2' : 'v1';
  const B = BOUNDS[shape];

  describe('the bundle on the device', () => {
    it('passes the device check for the men’s garment on its own body shape only and says it is a tape-built trouser', async () => {
      const bundle = await loadChino(built);
      const meta = { anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa };
      expect(checkBundle(meta, SYNTHETIC_CHINO_PAYLOAD, shape)).toMatchObject({ family: 'male', baseSize: '34/32', qaFlags: ['tape_built_no_chart_check'] });
      expect(checkBundle(meta, SYNTHETIC_CHINO_PAYLOAD, other)).toBeNull();
      expect(checkBundle(meta, { ...SYNTHETIC_CHINO_PAYLOAD, audience: 'women' }, shape)).toBeNull();
      expect(isTapeTrouser(bundle.anchors)).toBe(true);
      expect(bundle.anchors.category).toBe('bottom');
      // No other bundle is one: a reconstructed garment and the tee keep every rule they had.
      const dress = buildBundle('aalter-studio-2', { skipSeparation: true });
      const otherBundle = await loadBundleFrom(serve(dress.files), '/b', 'aalter-studio-2', { withPayload: false });
      expect(isTapeTrouser(otherBundle.anchors)).toBe(false);
      expect(isTapeTrouser({ category: 'top', builder: 'pom-chino-0.2.0' })).toBe(false);
      expect(isTapeTrouser({ category: 'bottom' })).toBe(false);
      expect(trouserSeams(otherBundle.anchors, 10)).toBeNull();
      expect(trouserNotDrawn({ anchors: otherBundle.anchors, grading: otherBundle.grading }, {}, computeFit(MOCK_GARMENTS_BY_ID['aalter-studio-2']!, fullBody('XXL')), 'S')).toBeNull();
    });

    it('welds back to the builder’s mesh, vertex for vertex (the textured file duplicates vertices at the seams)', async () => {
      const bundle = await loadChino(built);
      const base = built.base.mesh;
      expect(bundle.render).toBeDefined();
      expect(bundle.baseMesh.positions.length).toBe(base.positions.length);
      for (let i = 0; i < base.positions.length; i++) expect(Math.abs(bundle.baseMesh.positions[i]! - base.positions[i]!)).toBeLessThan(1e-3);
      expect(Array.from(bundle.baseMesh.indices)).toEqual(Array.from(base.indices));
    });

    it('mounts on the male body family and on its own shape only', async () => {
      const bundle = await loadChino(built);
      expect(planAvatar(bundle.anchors, { family: 'male' }, undefined, shape).m.shape.family).toBe('male');
      expect(() => planAvatar(bundle.anchors, { family: 'female', heightCm: 168 }, undefined, shape)).toThrow();
      expect(() => planAvatar(bundle.anchors, { family: 'male' }, undefined, other)).toThrow(GarmentViewError);
    });

    it('keeps the collision exemption only below the hip ring', async () => {
      const bundle = await loadChino(built);
      const plan = planAvatar(bundle.anchors, { family: 'male' }, undefined, shape);
      const session = openSession(plan.m, bundle, SYNTHETIC_CHINO_PAYLOAD);
      const hip = plan.m.morphHeights.hip;
      let above = 0, below = 0;
      for (let i = 0; i < session.noCollide.length; i++) {
        if (!session.noCollide[i]) continue;
        if (bundle.baseMesh.positions[3 * i + 1]! >= hip) above++;
        else below++;
      }
      expect(above).toBe(0);
      expect(below).toBeGreaterThan(0);
      expect(Array.from(trouserNoCollide(plan.m, Uint8Array.of(1, 1), [0, hip + 1, 0, 0, hip - 1, 0]))).toEqual([0, 1]);
    });

    it('is draped against a body whose leg tops are joined to the torso: wider at hip height on a body of ellipses, untouched on drawn outlines', async () => {
      const bundle = await loadChino(built);
      const plan = planAvatar(bundle.anchors, { family: 'male' }, undefined, shape);
      const joined = trouserField(plan.field);
      if (shape === 'v2') {
        // Drawn outlines have no ledge; without the body's heights the field is handed back as it is.
        expect(joined).toBe(plan.field);
        return;
      }
      expect(trouserField(plan.field)).toBe(joined);
      const t = plan.field.torso, j = joined.torso;
      let wider = 0, firstUnchanged = -1;
      for (let k = 0; k < t.data.length / 5; k++) {
        if (t.data[5 * k] !== 1) continue;
        expect(j.data[5 * k + 3]!).toBeGreaterThanOrEqual(t.data[5 * k + 3]!);
        // The depth is the torso's wherever the torso is the deeper: the centre seams do not move.
        expect(j.data[5 * k + 4]!).toBeGreaterThanOrEqual(t.data[5 * k + 4]!);
        if (j.data[5 * k + 3]! > t.data[5 * k + 3]! + 1e-6) wider++;
        else if (firstUnchanged < 0 && wider > 0) firstUnchanged = t.lo + k * t.stepCm;
      }
      expect(wider).toBeGreaterThan(2);
      // Back to the drawn torso within the fillet above the leg tops, well under the waistband.
      expect(firstUnchanged).toBeGreaterThan(plan.m.morphHeights.hip - 4);
      expect(firstUnchanged).toBeLessThan(plan.m.morphHeights.hip + LEG_TOP_FILLET_CM + 1);
      expect(joined.legs).toBe(plan.field.legs);
    });

    it('is draped against a seat whose hollow at the centre back is bridged (drawn outlines only): the hull from the hip ring up, the drawn body at the front, at the band and under the seat', async () => {
      const bundle = await loadChino(built);
      const plan = planAvatar(bundle.anchors, { family: 'male' }, undefined, shape);
      const Y = plan.m.morphHeights;
      const bridged = trouserField(plan.field, Y);
      if (shape === 'v1') {
        // A body of ellipses has no hollow: the same field as without the heights (the leg tops joined).
        expect(bridged).toBe(trouserField(plan.field));
        expect(bridged.torso.polar).toBeUndefined();
        return;
      }
      expect(trouserField(plan.field, Y)).toBe(bridged);
      expect(bridged.legs).toBe(plan.field.legs);
      expect(bridged.torso.data).toBe(plan.field.torso.data);
      const a = plan.field.torso.polar!, b = bridged.torso.polar!;
      const stride = a.n + 3, back = (3 * a.n) / 4, front = a.n / 4;
      const row = (y: number): number => Math.round((y - a.lo) / a.stepCm) * stride + 3;
      let deepest = 0;
      for (let k = 0; k < a.data.length / stride; k++) for (let j = 0; j < a.n; j++) {
        const d = b.data[k * stride + 3 + j]! - a.data[k * stride + 3 + j]!;
        // Never inside the drawn body; and only the back half is touched.
        expect(d).toBeGreaterThanOrEqual(0);
        if (j < a.n / 2) expect(d).toBe(0);
        deepest = Math.max(deepest, d);
      }
      // At the hip ring the centre back is 1.5 to 4 cm further out (the hollow between the buttocks), the centre front where it was.
      const hipBack = b.data[row(Y.hip) + back]! - a.data[row(Y.hip) + back]!;
      expect(hipBack).toBeGreaterThan(1.5);
      expect(hipBack).toBeLessThan(4);
      expect(deepest).toBeLessThan(4);
      expect(b.data[row(Y.hip) + front]).toBe(a.data[row(Y.hip) + front]);
      // Back to the drawn body under the seat and from 65 % of the way to the waist ring (where the band is read).
      for (const y of [Y.hip - SEAT_BRIDGE_BELOW_CM - 0.5, Y.hip + SEAT_BRIDGE_FADE[1] * (Y.waist - Y.hip) + 0.5, Y.waist]) expect(b.data[row(y) + back], `at ${y.toFixed(1)}`).toBe(a.data[row(y) + back]);
    });

    it('reads the waist where the fit engine read it: a band with room keeps its girth, a band under tension is laid on the body it meets', async () => {
      const bundle = await loadChino(built);
      const band = bundle.grading.sizes.find((s) => s.size === '34/32')!.targets.waist!;
      expect(wornBodyRings(bundle.grading, '34/32', { size: '34/32', gaps: {}, bands: {}, easeTargets: {}, slackCm: { waist: 3 } }, { waist: 86 }).waist).toBeCloseTo(band - 3, 6);
      expect(wornBodyRings(bundle.grading, '34/32', { size: '34/32', gaps: {}, bands: {}, easeTargets: {}, slackCm: { waist: -1.5 } }, { waist: 86 }).waist).toBeCloseTo(band + 1.5, 6);
      expect(wornBodyRings(bundle.grading, '34/32', null, { waist: 86 })).toEqual({ waist: 86 });
    });

    it('hands the drape its seams and its grain; a path that names no vertex of the mesh is dropped', async () => {
      const bundle = await loadChino(built);
      const n = bundle.baseMesh.positions.length / 3;
      const s = trouserSeams(bundle.anchors, n)!;
      expect(s.paths).toHaveLength(6);
      expect(s.stretch).toBeCloseTo(0.01, 9);
      expect(s.grain).toMatchObject({ stretch: 0.02, shorten: 0.005 });
      expect(trouserSeams({ ...bundle.anchors, seams: { stretchPct: 1, paths: [[0, n], [0, 1]] } }, n)!.paths).toEqual([[0, 1]]);
      expect(trouserSeams({ ...bundle.anchors, seams: { stretchPct: 1, paths: [[0, n]] } }, n)).toBeNull();
      const { seams: _none, ...without } = bundle.anchors;
      expect(trouserSeams(without, n)).toBeNull();
      // On the cloth: pairs with a longest distance; only neighbours on the grain have a shortest one.
      const plan = planAvatar(bundle.anchors, { family: 'male' }, undefined, shape);
      const session = openSession(plan.m, bundle, SYNTHETIC_CHINO_PAYLOAD);
      const f = prepareFit(session, plan.avatar, plan.field, computeFit(SYNTHETIC_CHINO_PAYLOAD, fullBody('M')), '34/32', viewerMaterial('product', bundle.material));
      expect(f.cloth.seams!.length).toBe(2 * f.cloth.seamMax!.length);
      expect(f.cloth.seamMin!.some((x) => x > 0)).toBe(true);
      for (let e = 0; e < f.cloth.seamMax!.length; e++) expect(f.cloth.seamMin![e]!).toBeLessThanOrEqual(f.cloth.seamMax![e]!);
    });
  });

  describe('draped on the table bodies S to XXL', () => {
    const drapes = new Map<string, ChinoDrapeMetrics>();
    const builtEase = (size: string): number => built.tape.find((t) => t.size === size)!.levels.crotchEaseCm;
    it('drapes every body in the size the fit engine recommends', async () => {
      const bundle = await loadChino(built);
      for (const id of MALE_BODY_SHAPE_IDS) {
        const r = chinoDrape(built, bundle, id, null);
        expect(r.metrics.recommended, id).toBe(RECOMMENDED[id]);
        expect(r.metrics.size).toBe(RECOMMENDED[id]);
        expect(r.metrics.notDrawn).toBeUndefined();
        drapes.set(id, r.metrics);
      }
    }, 120_000);

    it('holds the tape after the drape: waistband within 2.5 cm, thigh within 2 cm, inseam within 1.2 cm, the rises within 1.5 cm; the seat row a little short', () => {
      for (const [id, m] of drapes) {
        // The band is pinned where it was placed: its own length is the tape's plus what the body under it asks.
        expect(m.waistCm!.drapedRow - m.waistCm!.tape, `${id} waist`).toBeGreaterThan(-0.2);
        expect(m.waistCm!.drapedRow - m.waistCm!.tape, `${id} waist`).toBeLessThan(2.5);
        expect(Math.abs(m.thighCm!.drapedRow - m.thighCm!.tape), `${id} thigh`).toBeLessThan(2);
        expect(Math.abs(m.inseamCm!.draped - m.inseamCm!.tape), `${id} inseam`).toBeLessThan(1.2);
        // The seat’s row of cloth is shorter than the tape after the drape (v1: 2.4 to 3.0 cm, v2: 0.7 to 1.5), never longer.
        expect(m.seatCm!.drapedRow, `${id} seat`).toBeLessThanOrEqual(m.seatCm!.tape + 0.5);
        expect(m.seatCm!.tape - m.seatCm!.drapedRow, `${id} seat`).toBeLessThan(B.seatShortCm);
        // A tape round the outside of the seat row still holds the body's seat.
        expect(m.seatCm!.drapedHull, `${id} seat hull`).toBeGreaterThan(MALE_REFERENCE[id as keyof typeof MALE_REFERENCE].hip);
        // The device shows the size's own rises (built, not morphed), and the seams keep them in the drape.
        for (const rise of [m.frontRiseCm!, m.backRiseCm!]) {
          expect(Math.abs(rise.graded - rise.tape), `${id} rise as shown`).toBeLessThan(0.06);
          expect(Math.abs(rise.draped - rise.tape), `${id} rise after the drape`).toBeLessThan(1.5);
        }
      }
    });

    it('keeps the drawn body under the cloth within what is reported for each body, none of it under the crotch on M to XXL, and the band where it was placed', () => {
      for (const [id, m] of drapes) {
        expect(m.showThroughPixels, `${id} pixels`).toBeLessThan(B.pixels[id as keyof typeof B.pixels]);
        // Seen from the front, no body shows between the legs under the crotch (the patch male shape v2 had on M to XXL: 40 to 97 pixels there).
        const front = Object.entries(m.showThroughBy!).filter(([k]) => k.startsWith('front ') && k.endsWith(' thigh')).reduce((n, [, v]) => n + v, 0);
        expect(front, `${id} front, crotch to 12 cm under it`).toBeLessThan(shape === 'v2' ? 5 : 45);
        expect(m.band!.dropCm, `${id} band`).toBeLessThanOrEqual(B.bandDropCm);
        expect(Math.abs(m.band!.bandGirthCm - m.waistCm!.tape), `${id} band girth read on its own plane`).toBeLessThan(1.5);
      }
    });

    it('says what the crotch does: the seam hangs where the size’s rises put it on that body plus what the drape adds; its strain is bounded', () => {
      for (const [id, m] of drapes) {
        const added = m.crotchBelowBodyCm! - builtEase(m.size) - m.band!.dropCm;
        expect(added, `${id} crotch drop in the drape`).toBeGreaterThan(0);
        expect(added, `${id} crotch drop in the drape`).toBeLessThan(B.crotchDropCm);
        expect(m.crotchBelowBodyCm, `${id} crotch`).toBeLessThan(B.crotchBelowCm[id as keyof typeof B.crotchBelowCm]);
        expect(m.crotchBelowBodyCm, `${id} crotch`).toBeGreaterThan(0);
        expect(m.strainPct!.p99, `${id} p99`).toBeLessThan(8);
        expect(m.strainPct!.seatP99, `${id} seat p99`).toBeLessThan(9.5);
        expect(m.strainPct!.crotchP99, `${id} crotch p99`).toBeLessThan(B.crotchP99);
        expect(m.strainPct!.crotchMax, `${id} crotch max`).toBeLessThan(B.crotchMax);
      }
    });
  });

  describe('a size the fit engine calls too small is not drawn', () => {
    it('declares the anchor and the shortfall instead of a stretched garment; a size with room is drawn', async () => {
      const bundle = await loadChino(built);
      const plan = planAvatar(bundle.anchors, { family: 'male', heightCm: 179, bust: 123, waist: 111, hip: 114.5 }, undefined, shape);
      const session = openSession(plan.m, bundle, SYNTHETIC_CHINO_PAYLOAD);
      const fit = computeFit(SYNTHETIC_CHINO_PAYLOAD, fullBody('XXL'));
      expect(sewnNotDrawn(session, plan.avatar, fit, '30/32')).toEqual({ anchor: 'waist', bodyLargerCm: 33.7 });
      expect(sewnNotDrawn(session, plan.avatar, fit, '38/32')).toEqual({ anchor: 'waist', bodyLargerCm: 13.1 });
      expect(sewnNotDrawn(session, plan.avatar, fit, '42/32')).toMatchObject({ anchor: 'waist' });
      expect(sewnNotDrawn(session, plan.avatar, fit, '44/32')).toBeNull();
      // The fixture's own chart stops at W38: on the XL and XXL bodies every one of its sizes is declared, none is stretched on.
      for (const id of ['XL', 'XXL'] as const) {
        const f = computeFit(SYNTHETIC_CHINO_PAYLOAD, fullBody(id));
        for (const w of ['30', '32', '34', '36', '38']) expect(chinoDrape(built, bundle, id, `${w}/32`).metrics.notDrawn, `${id} ${w}`).toBeDefined();
        expect(f.recommendedSize).not.toBeNull();
      }
    });

    it('a size too large is drawn where it would sit: the band slides to where the body fills it, further for a larger size', async () => {
      const bundle = await loadChino(built);
      const a = chinoDrape(built, bundle, 'M', '36/32').metrics, b = chinoDrape(built, bundle, 'M', '42/32').metrics;
      expect(a.notDrawn).toBeUndefined();
      expect(a.band!.dropCm).toBeGreaterThan(0);
      expect(a.band!.pastHips).toBe(false);
      expect(b.band!.dropCm).toBeGreaterThan(a.band!.dropCm + 5);
      // On the v1 body no height fills a W42 band: it would not stay up. The v2 body's seat holds it, 16 cm down.
      if (shape === 'v1') expect(b.band!.pastHips).toBe(true);
    }, 60_000);
  });
});
