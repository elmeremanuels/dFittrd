/**
 * The POM chino on the male body in the viewer (men-3d-plan slices M3/M4): the SYNTHETIC men's test chino W/L of the
 * spike (not a product), built from its flat measurements, passes the device check for a men's garment only, welds back
 * to the builder's mesh, and drapes on the male table bodies S to XXL in the size the fit engine gives each: the band
 * and the seat stay outside the drawn body, the tape after the drape stays near the input, and the strain at the crotch
 * is bounded and said. A size too small for the body is not draped and not drawn, by the fit engine's own bands.
 * No WebGL: the drape is the one the mount runs (`prepareFit` + `relax`).
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
import { openSession, sewnNotDrawn } from './engine';
import { planAvatar } from './mount';
import { isTapeTrouser, trouserNoCollide, trouserNotDrawn, wornBodyRings } from './trouser';

const built = buildPomChinoBundle(SYNTHETIC_CHINO_PAYLOAD.id, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM, SYNTHETIC_CHINO_BASE_SIZE, { bodyOfWaist: SYNTHETIC_CHINO_BODY });
const RECOMMENDED = { S: '32/32', M: '34/32', L: '38/32', XL: '40/32', XXL: '44/32' } as const;
const fullBody = (id: keyof typeof MALE_REFERENCE) => {
  const t = MALE_REFERENCE[id];
  return { measurements: { bust: t.chest, waist: t.waist, hip: t.hip, thigh: t.thigh, inseam: t.inseam }, heightCm: t.stature };
};

describe('the POM chino bundle on the device', () => {
  it('passes the device check for the men’s garment only and says it is a tape-built trouser', async () => {
    const bundle = await loadChino(built);
    const meta = { anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa };
    expect(checkBundle(meta, SYNTHETIC_CHINO_PAYLOAD)).toMatchObject({ family: 'male', baseSize: '34/32', qaFlags: ['tape_built_no_chart_check'] });
    expect(checkBundle(meta, { ...SYNTHETIC_CHINO_PAYLOAD, audience: 'women' })).toBeNull();
    expect(isTapeTrouser(bundle.anchors)).toBe(true);
    expect(bundle.anchors.category).toBe('bottom');
    // No other bundle is one: a reconstructed garment and the tee keep every rule they had.
    const dress = buildBundle('aalter-studio-2', { skipSeparation: true });
    const other = await loadBundleFrom(serve(dress.files), '/b', 'aalter-studio-2', { withPayload: false });
    expect(isTapeTrouser(other.anchors)).toBe(false);
    expect(isTapeTrouser({ category: 'top', builder: 'pom-chino-0.1.0' })).toBe(false);
    expect(isTapeTrouser({ category: 'bottom' })).toBe(false);
    expect(trouserNotDrawn({ anchors: other.anchors, grading: other.grading }, {}, computeFit(MOCK_GARMENTS_BY_ID['aalter-studio-2']!, fullBody('XXL')), 'S')).toBeNull();
  });

  it('welds back to the builder’s mesh, vertex for vertex (the textured file duplicates vertices at the seams)', async () => {
    const bundle = await loadChino(built);
    const base = built.base.mesh;
    expect(bundle.render).toBeDefined();
    expect(bundle.baseMesh.positions.length).toBe(base.positions.length);
    for (let i = 0; i < base.positions.length; i++) expect(Math.abs(bundle.baseMesh.positions[i]! - base.positions[i]!)).toBeLessThan(1e-3);
    expect(Array.from(bundle.baseMesh.indices)).toEqual(Array.from(base.indices));
  });

  it('mounts on the male body family only', async () => {
    const bundle = await loadChino(built);
    expect(planAvatar(bundle.anchors, { family: 'male' }).m.shape.family).toBe('male');
    expect(() => planAvatar(bundle.anchors, { family: 'female', heightCm: 168 })).toThrow();
  });

  it('keeps the collision exemption only below the hip ring', async () => {
    const bundle = await loadChino(built);
    const plan = planAvatar(bundle.anchors, { family: 'male' });
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

  it('reads the waist where the fit engine read it: a band with room keeps its girth, a band under tension is laid on the body it meets', async () => {
    const bundle = await loadChino(built);
    const band = bundle.grading.sizes.find((s) => s.size === '34/32')!.targets.waist!;
    expect(wornBodyRings(bundle.grading, '34/32', { size: '34/32', gaps: {}, bands: {}, easeTargets: {}, slackCm: { waist: 3 } }, { waist: 86 }).waist).toBeCloseTo(band - 3, 6);
    expect(wornBodyRings(bundle.grading, '34/32', { size: '34/32', gaps: {}, bands: {}, easeTargets: {}, slackCm: { waist: -1.5 } }, { waist: 86 }).waist).toBeCloseTo(band + 1.5, 6);
    expect(wornBodyRings(bundle.grading, '34/32', null, { waist: 86 })).toEqual({ waist: 86 });
  });
});

describe('the POM chino draped on the male table bodies S to XXL', () => {
  const drapes = new Map<string, ChinoDrapeMetrics>();
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

  it('holds the tape: waistband within 2 cm, thigh within 3 cm, inseam within 1 cm of the input; the seat row hangs in folds', () => {
    for (const [id, m] of drapes) {
      // The band is pinned where it was placed: its own length is the tape's plus what the body under it asks (≤ 2 cm).
      expect(m.waistCm!.drapedRow - m.waistCm!.tape, `${id} waist`).toBeGreaterThan(-0.2);
      expect(m.waistCm!.drapedRow - m.waistCm!.tape, `${id} waist`).toBeLessThan(2);
      expect(Math.abs(m.thighCm!.drapedRow - m.thighCm!.tape), `${id} thigh`).toBeLessThan(3);
      expect(Math.abs(m.inseamCm!.draped - m.inseamCm!.tape), `${id} inseam`).toBeLessThan(1);
      // The seat's row of cloth is shorter than the tape after the drape (it folds between its vertices), never longer.
      expect(m.seatCm!.drapedRow, `${id} seat`).toBeLessThanOrEqual(m.seatCm!.tape + 0.5);
      expect(m.seatCm!.tape - m.seatCm!.drapedRow, `${id} seat`).toBeLessThan(5);
      // A tape round the outside of the seat row still holds the body's seat.
      expect(m.seatCm!.drapedHull, `${id} seat hull`).toBeGreaterThan(MALE_REFERENCE[id as keyof typeof MALE_REFERENCE].hip);
    }
  });

  it('keeps the drawn body under the cloth, and the band where it was placed', () => {
    for (const [id, m] of drapes) {
      expect(m.showThroughPixels, `${id} pixels`).toBeLessThan(150);
      expect(m.band!.dropCm, `${id} band`).toBe(0);
      expect(Math.abs(m.band!.bandGirthCm - m.waistCm!.tape), `${id} band girth read on its own plane`).toBeLessThan(1.5);
    }
  });

  it('says what the crotch does: the seam hangs 3 to 6 cm under the body, its strain is bounded', () => {
    for (const [id, m] of drapes) {
      expect(m.crotchBelowBodyCm, `${id} crotch`).toBeGreaterThan(2.5);
      expect(m.crotchBelowBodyCm, `${id} crotch`).toBeLessThan(6);
      expect(m.strainPct!.p99, `${id} p99`).toBeLessThan(16);
      expect(m.strainPct!.seatP99, `${id} seat p99`).toBeLessThan(17);
      expect(m.strainPct!.crotchP99, `${id} crotch p99`).toBeLessThan(28);
      expect(m.strainPct!.crotchMax, `${id} crotch max`).toBeLessThan(65);
    }
  });
});

describe('a chino size the fit engine calls too small is not drawn', () => {
  it('declares the anchor and the shortfall instead of a stretched garment; a size with room is drawn', async () => {
    const bundle = await loadChino(built);
    const plan = planAvatar(bundle.anchors, { family: 'male', heightCm: 179, bust: 123, waist: 111, hip: 114.5 });
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

  it('a size too large is drawn where it would sit: the band slides to where the body fills it, and past the hips it says so', async () => {
    const bundle = await loadChino(built);
    const a = chinoDrape(built, bundle, 'M', '36/32').metrics, b = chinoDrape(built, bundle, 'M', '42/32').metrics;
    expect(a.notDrawn).toBeUndefined();
    expect(a.band!.dropCm).toBeGreaterThan(0);
    expect(a.band!.pastHips).toBe(false);
    expect(b.band!.pastHips).toBe(true);
  }, 60_000);
});
