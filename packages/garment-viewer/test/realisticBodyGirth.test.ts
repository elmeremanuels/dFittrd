/**
 * The realistic body's girths, measured by an independent slicer (`independentSlice.ts`) against the TYPED
 * measurements and the ring table `buildBody` makes, never against the fit's own target or measure (review of 21 Nov,
 * finding 1: with the fit's own slicer and `fitTargetOf` as the reference, a hip target 5 % off or a measure 2 % long
 * left every test green). Every ring centre must lie inside its drawn section (no nearest-loop fallback), and the
 * section's centre near the ring's (finding 2: the wrist section was 5 to 7 cm in front of the wrist ring).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBody, meshRingCircumference, type Mannequin, type Mesh } from '@curtain/mannequin';
import { BASE_SHAPE_ID, bodyShape, buildMannequin } from '@curtain/mannequin';
import { IDENTITY_MORPH, bodyField } from '../src/body';
import { planAvatar } from '../src/mount';
import { conformToField, decodeRealisticBody, fitRealisticBody, fitTargetOf, type FitTarget } from '../src/realisticBody';
import { mirrored, sectionRound, type V3 } from './independentSlice';

const asset = decodeRealisticBody(readFileSync(new URL('../assets/realistic-body/female-v1.crb', import.meta.url)));

/** The spike's five test bodies (female, cm). */
const BODIES = {
  slim: { heightCm: 164, bust: 80, waist: 62, hip: 88 },
  mid: { heightCm: 168, bust: 92, waist: 74, hip: 100 },
  full: { heightCm: 170, bust: 116, waist: 98, hip: 122 },
  tall: { heightCm: 182, bust: 92, waist: 74, hip: 100 },
  petite: { heightCm: 152, bust: 84, waist: 66, hip: 92 },
} as const;
/** Bodies away from the middle: the reviewer's extremes and the two corners of the input box. */
const EXTREMES = {
  veryFull: { heightCm: 165, bust: 145, waist: 135, hip: 155 },
  bigBustSmallHip: { heightCm: 166, bust: 118, waist: 72, hip: 86 },
  pear: { heightCm: 162, bust: 82, waist: 68, hip: 124 },
  apple: { heightCm: 160, bust: 104, waist: 108, hip: 100 },
  cornerSmall: { heightCm: 130, bust: 60, waist: 45, hip: 65 },
  cornerLarge: { heightCm: 220, bust: 160, waist: 150, hip: 170 },
} as const;

/** The pass bound of the spike (route doc §7). */
const TOLERANCE_PCT = 0.5;
/** How far the centre of a ring's drawn section may be from the ring centre, cm. */
const CENTRE_CM = 0.5;

type RingRef = Pick<Mannequin['rings'][number], 'id' | 'centre' | 'normal' | 'u' | 'v' | 'part' | 'circumferenceCm'>;

/** Every ring (both sides for the limbs) of `rings`, measured on `mesh`; the problems found, empty when it passes. */
function check(mesh: Pick<Mesh, 'positions' | 'indices' | 'partNames' | 'vertexPart'>, rings: readonly RingRef[], girthOf: (id: string) => number = (id) => rings.find((r) => r.id === id)!.circumferenceCm): string[] {
  const problems: string[] = [];
  for (const r0 of rings) {
    for (const r of r0.centre[0] !== 0 ? [r0, mirrored(r0 as RingRef & { centre: V3; normal: V3; u: V3; v: V3 })] : [r0]) {
      const name = `${r.id}${r === r0 ? '' : ' (right)'}`;
      const want = girthOf(r.id);
      const s = sectionRound(mesh.positions, mesh.indices, r.centre as V3, r.normal as V3, r.u as V3, r.v as V3);
      if (!s) {
        problems.push(`${name}: centre outside the section`);
        continue;
      }
      const e = (100 * (s.loopCm - want)) / want;
      if (Math.abs(e) > TOLERANCE_PCT) problems.push(`${name}: ${e.toFixed(2)} %`);
      // The mannequin's own measure, a second opinion on the loop (it too needs the centre inside).
      const g = meshRingCircumference(mesh as Mesh, r);
      if (g === null || Math.abs(g - s.loopCm) > 1e-3 * want) problems.push(`${name}: meshRingCircumference ${g === null ? 'none' : g.toFixed(2)} against ${s.loopCm.toFixed(2)}`);
      const off = Math.hypot(...s.centre);
      if (off > CENTRE_CM) problems.push(`${name}: section centre ${off.toFixed(2)} cm from the ring centre`);
      if (s.tapeCm > s.loopCm + 1e-6) problems.push(`${name}: tape over loop`);
    }
  }
  return problems;
}

const typedOf = (b: { bust: number; waist: number; hip: number }) => (id: string, table: number): number => (id === 'chest' ? b.bust : id === 'waist' ? b.waist : id === 'hip' ? b.hip : table);

describe('realistic body: girths against the typed body, independent slicer', () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: the typed bust, waist and hip, and all 12 rings of buildBody (both sides), within ${TOLERANCE_PCT} %; every centre inside its section`, () => {
      const m = buildBody({ family: 'female', ...body });
      // The ring table carries the typed girths as they are.
      expect(m.rings.find((r) => r.id === 'chest')!.circumferenceCm).toBeCloseTo(body.bust, 9);
      expect(m.rings.find((r) => r.id === 'waist')!.circumferenceCm).toBeCloseTo(body.waist, 9);
      expect(m.rings.find((r) => r.id === 'hip')!.circumferenceCm).toBeCloseTo(body.hip, 9);
      const fit = fitRealisticBody(asset, fitTargetOf(m));
      const typed = typedOf(body);
      expect(check(fit.mesh, m.rings, (id) => typed(id, m.rings.find((r) => r.id === id)!.circumferenceCm))).toEqual([]);
    });
  }

  for (const [name, body] of Object.entries(EXTREMES)) {
    it(`${name}: all 12 rings of buildBody (both sides) within ${TOLERANCE_PCT} %, every centre inside its section`, () => {
      const m = buildBody({ family: 'female', ...body });
      expect(check(fitRealisticBody(asset, fitTargetOf(m)).mesh, m.rings)).toEqual([]);
    });
  }

  it('the drawn body of the viewer (the morphed base body, girths only) against the girths the avatar was given', () => {
    const plan = planAvatar({ category: 'dress' }, { bust: 104, waist: 90, hip: 112 });
    const target = fitTargetOf(plan.drawn, plan.avatar.rings, plan.drawnScaleAt);
    const fit = fitRealisticBody(asset, target);
    // The rings where they are drawn (the morph scales the centres too), with the avatar's own girths.
    const rings = plan.drawn.rings.map((r) => ({ ...r, centre: target.rings.find((t) => t.id === r.id)!.centre }));
    const typed = typedOf({ bust: 104, waist: 90, hip: 112 });
    expect(check(fit.mesh, rings, (id) => typed(id, plan.avatar.rings[id as keyof typeof plan.avatar.rings]))).toEqual([]);
    expect(buildMannequin(bodyShape(BASE_SHAPE_ID)).statureCm).toBe(plan.drawn.statureCm);
  });
});

describe('negative controls: the same check fails when the fit is wrong in the ways that matter', () => {
  const m = buildBody({ family: 'female', ...BODIES.mid });
  const target = fitTargetOf(m);
  const scaled = (t: FitTarget, f: (id: string) => number): FitTarget => ({ ...t, rings: t.rings.map((r) => ({ ...r, girthCm: r.girthCm * f(r.id) })) });

  it('a hip target 5 % high (what fitTargetOf with the hip × 1.05 does) fails at the hip and only there', () => {
    const fit = fitRealisticBody(asset, scaled(target, (id) => (id === 'hip' ? 1.05 : 1)));
    expect(check(fit.mesh, m.rings)).toEqual([expect.stringMatching(/^hip: 5\.0\d %$/)]);
  });

  it("a measure 2 % long in the fit (what sectionOf's loop × 1.02 does: the fit stops 2 % short) fails at every ring", () => {
    const fit = fitRealisticBody(asset, scaled(target, () => 1 / 1.02));
    const problems = check(fit.mesh, m.rings);
    for (const r of m.rings) expect(problems.some((p) => p.startsWith(`${r.id}: -1.9`))).toBe(true);
  });

  it('the arm left where the rigid placement puts it (no centring) fails: the wrist section is not round the wrist ring', () => {
    const fit = fitRealisticBody(asset, target, { centreArms: false });
    const problems = check(fit.mesh, m.rings);
    expect(problems).toContain('wrist: centre outside the section');
    expect(problems).toContain('wrist (right): centre outside the section');
  });

  it('no girth correction at all fails on every body', () => {
    for (const body of Object.values(BODIES)) {
      const mb = buildBody({ family: 'female', ...body });
      expect(check(fitRealisticBody(asset, fitTargetOf(mb), { iterations: 0 }).mesh, mb.rings).length).toBeGreaterThan(0);
    }
  });
});

describe('the conformed display mesh under a garment', () => {
  // The torso from 15 cm under the hip ring to 2 cm over the chest ring (the review's zone), the arms bare.
  const bodies = { mid: BODIES.mid, full: BODIES.full, bigBustSmallHip: EXTREMES.bigBustSmallHip, veryFull: EXTREMES.veryFull };
  for (const [name, body] of Object.entries(bodies)) {
    it(`${name}: chest within 1.5 %, underbust, waist and hip within 1 % of the typed body (pull only: up to 3 % under)`, () => {
      const mb = buildBody({ family: 'female', ...body });
      const fit = fitRealisticBody(asset, fitTargetOf(mb));
      const field = bodyField(mb, IDENTITY_MORPH);
      const zone = { yLo: mb.morphHeights.hip - 15, yHi: mb.morphHeights.chest + 2, armS: [0, 0] as [number, number] };
      const conformed = conformToField(fit.mesh, asset, field, mb.landmarks.crotch[1], zone);
      const pulled = conformToField(fit.mesh, asset, field, mb.landmarks.crotch[1], zone, { keepGirth: false });
      const err = (mesh: Mesh, id: string): number => {
        const r = mb.rings.find((x) => x.id === id)!;
        const s = sectionRound(mesh.positions, mesh.indices, r.centre as V3, r.normal as V3, r.u as V3, r.v as V3)!;
        return (100 * (s.loopCm - r.circumferenceCm)) / r.circumferenceCm;
      };
      expect(Math.abs(err(conformed, 'chest'))).toBeLessThanOrEqual(1.5);
      for (const id of ['underbust', 'waist', 'hip']) expect(Math.abs(err(conformed, id))).toBeLessThanOrEqual(1);
      // The control: the pull alone takes more than 1.5 % off the chest.
      expect(err(pulled, 'chest')).toBeLessThan(-1.5);
    });
  }
});
