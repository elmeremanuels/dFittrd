import { describe, expect, it } from 'vitest';
import { anchorGaps } from '@curtain/fit-engine';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, type Mesh } from '@curtain/mannequin';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { measureRing } from '../../../spikes/garment-engine/src/anchoring';
import { bodyField, buildAvatar, makeCollider, mannequinMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { clothParams, createCloth, stepCloth, strainQuantile } from './cloth';
import { advance, jobCollider, type DrapeJob } from './drapeJob';
import { armCapLifter, CUFF_LEASH_CM, defaultTrio, drapeJobOf, heatFor, necklineStrain, openSession, pinLoosePieces, prepareFit, relax, viewerMaterial, yokeHeight } from './engine';
import { armpitDistance } from './core/garment';
import { anchorLabels, fitForBody, frontOutline } from './fitting';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canonical = buildMannequinMesh(m);

function spikeBundle(id: 'aalter-studio-2' | 'monochrome-03'): SpikeBundle {
  const b = buildBundle(id, { skipSeparation: true });
  return {
    productId: id,
    anchors: JSON.parse(b.files['anchors.json']) as SpikeBundle['anchors'],
    grading: JSON.parse(b.files['grading.json']) as SpikeBundle['grading'],
    material: JSON.parse(b.files['material.json']) as SpikeBundle['material'],
    qa: JSON.parse(b.files['qa.json']) as SpikeBundle['qa'],
    baseMesh: meshFromGlb(b.files['base.glb']),
  };
}

const dress = spikeBundle('aalter-studio-2');
const session = openSession(m, dress);
const meas = mannequinMeasurements(m);
const avatar = buildAvatar(m, canonical, meas);
const field = bodyField(m, avatar);
const fit = fitForBody(session.payload, meas);
const chestRing = m.rings.find((r) => r.id === 'chest')!;
const girth = (positions: ArrayLike<number>, indices: Uint32Array): number => measureRing({ positions: Float64Array.from(positions), indices, vertexPart: new Uint8Array(0), partNames: [] } as Mesh, chestRing)!.circumferenceCm;

describe('bundle', () => {
  it('reads base.glb back in cm', () => {
    const b = buildBundle('monochrome-03', { skipSeparation: true });
    const mesh = meshFromGlb(b.files['base.glb']);
    expect(mesh.indices).toEqual(b.baseMesh.indices);
    let worst = 0;
    for (let i = 0; i < mesh.positions.length; i++) worst = Math.max(worst, Math.abs(mesh.positions[i]! - b.baseMesh.positions[i]!));
    expect(worst).toBeLessThan(1e-3);
  });

  it('picks S, M and L', () => {
    expect(defaultTrio(['XS', 'S', 'M', 'L', 'XL'], 'M')).toEqual(['S', 'M', 'L']);
    expect(defaultTrio(['36', '38', '40', '42'], '40')).toEqual(['38', '40', '42']);
  });
});

describe('fitting on the device', () => {
  it('reads the gaps from the fit engine unchanged (rule 4)', () => {
    for (const size of ['S', 'M', 'L']) {
      const f = prepareFit(session, avatar, field, fit, size, viewerMaterial('product', dress.material));
      expect(f.gaps).toEqual(anchorGaps(fit, size));
    }
  });

  it('places a loop with room at body + slack, which is the graded girth', () => {
    const f = prepareFit(session, avatar, field, fit, 'L', viewerMaterial('product', dress.material));
    const chest = f.placement.anchors.find((a) => a.anchor === 'chest')!;
    expect(chest.state).toBe('room');
    expect(chest.placedCm).toBeCloseTo(meas.bust + f.gaps!.slackCm.chest!, 6);
    expect(Math.abs(chest.placedCm - chest.gradedCm)).toBeLessThan(0.1);
  });

  it('pulls a too-small loop onto the body and says when it cannot close', () => {
    const big = { bust: 104, waist: 90, hip: 112 };
    const bigAvatar = buildAvatar(m, canonical, big);
    expect(bigAvatar.rings.chest).toBeCloseTo(104, 6);
    const f = prepareFit(session, bigAvatar, bodyField(m, bigAvatar), fitForBody(session.payload, big), 'XS', viewerMaterial('product', dress.material));
    const chest = f.placement.anchors.find((a) => a.anchor === 'chest')!;
    expect(chest.slackCm).toBeLessThan(0);
    expect(chest.placedCm).toBeCloseTo(104, 6);
    expect(chest.state).toBe('open'); // 0 % stretch cotton
    expect(f.lines.some((l) => l.tone === 'strain' && l.text.startsWith('Does not close at the chest'))).toBe(true);
  });

  it('relaxes in about 1.5 s of cloth without exploding, outside the body, and keeps S < M < L', () => {
    const girths: number[] = [];
    for (const size of ['S', 'M', 'L']) {
      const f = prepareFit(session, avatar, field, fit, size, viewerMaterial('product', dress.material));
      const t0 = performance.now();
      const pos = relax(f);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(10_000);
      // Up to the 1.5 s cap, or earlier once calm (early exit), never less than the minimum.
      expect(f.cloth.time).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(f.cloth.time).toBeGreaterThanOrEqual(f.params.minDurationS - 1e-6);
      expect(pos.every(Number.isFinite)).toBe(true);
      // PBD with 6 iterations stretches a little under gravity; the worst edges sit at the armpit,
      // where the v0 mannequin's arm overlaps the torso.
      expect(strainQuantile(f.cloth, 0.99)).toBeLessThan(0.12);
      expect(strainQuantile(f.cloth, 1)).toBeLessThan(0.35);
      const collide = makeCollider(field, 0, session.chains, f.noCollide);
      const probe = Float32Array.from(pos);
      let inside = 0;
      for (let i = 0; i < probe.length / 3; i++) if (collide(probe, i)) inside++;
      expect(inside / (probe.length / 3)).toBeLessThan(0.01);
      girths.push(girth(pos, f.indices));
    }
    expect(girths[0]!).toBeLessThan(girths[1]!);
    expect(girths[1]!).toBeLessThan(girths[2]!);
  }, 60_000);

  it('drapes a silk skirt closer to the legs than a linen one', () => {
    const offset = (preset: 'linen' | 'silk'): number => {
      const f = prepareFit(session, avatar, field, fit, 'L', viewerMaterial(preset, dress.material));
      const pos = relax(f);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < pos.length / 3; i++) {
        if (session.chains[i] !== 0) continue;
        const y = pos[3 * i + 1]!;
        if (y > m.morphHeights.hip - 7 || y < 30) continue; // the skirt: below the hip, where drape shows
        sum += Math.hypot(pos[3 * i]!, pos[3 * i + 2]!);
        n++;
      }
      return sum / n;
    };
    expect(offset('silk')).toBeLessThan(offset('linen') - 1);
  }, 60_000);

  it('colours the garment from the gaps: tighter size, redder chest', () => {
    const red = (size: string): number => {
      const f = prepareFit(session, avatar, field, fit, size, viewerMaterial('product', dress.material));
      const c = heatFor(f, session.chains);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < session.chains.length; i++) {
        if (session.chains[i] !== 0 || Math.abs(f.cloth.pos[3 * i + 1]! - m.morphHeights.chest) > 1) continue;
        sum += c[3 * i]! - c[3 * i + 2]!;
        n++;
      }
      return sum / n;
    };
    expect(red('S')).toBeGreaterThan(red('M'));
    expect(red('M')).toBeGreaterThan(red('L'));
  });
});

describe('neckline on small sizes (regression: 21–33 % edge strain before the yoke was settled)', () => {
  const tee = spikeBundle('monochrome-03');
  const teeSession = openSession(m, tee);
  const teeFit = fitForBody(teeSession.payload, meas);
  it.each([
    ['aalter-studio-2', 'XS'],
    ['aalter-studio-2', 'S'],
    ['monochrome-03', 'XS'],
    ['monochrome-03', 'S'],
    ['monochrome-03', 'M'],
  ] as const)('%s %s keeps every neckline edge within 12 % of its rest length, before and after the drape', (id, size) => {
    const [sess, bundle, result] = id === 'aalter-studio-2' ? [session, dress, fit] : [teeSession, tee, teeFit];
    const f = prepareFit(sess, avatar, field, result, size, viewerMaterial('product', bundle.material));
    expect(necklineStrain(f, m)).toBeLessThan(0.12);
    relax(f);
    expect(necklineStrain(f, m)).toBeLessThan(0.12);
  }, 30_000);
});

describe('tee edge strain on the v0 mannequin (backs the README figure: p99 11–24 % for XS–L)', () => {
  const tee = spikeBundle('monochrome-03');
  const teeSession = openSession(m, tee);
  const teeFit = fitForBody(teeSession.payload, meas);
  it.each(['XS', 'S', 'M', 'L'] as const)('monochrome-03 %s stays below 25 %% p99 and 45 %% max edge strain after the drape', (size) => {
    const f = prepareFit(teeSession, avatar, field, teeFit, size, viewerMaterial('product', tee.material));
    relax(f);
    expect(strainQuantile(f.cloth, 0.99)).toBeLessThan(0.25);
    expect(strainQuantile(f.cloth, 1)).toBeLessThan(0.45);
  }, 30_000);
});

describe('drape off the main thread', () => {
  it('a worker job (structured clone, time slices) gives exactly the drape of relax()', () => {
    const a = prepareFit(session, avatar, field, fit, 'S', viewerMaterial('silk', dress.material));
    const b = prepareFit(session, avatar, field, fit, 'S', viewerMaterial('silk', dress.material));
    const job = structuredClone({ ...drapeJobOf(b), id: 1 }) as DrapeJob;
    const collide = jobCollider(job);
    let slices = 0;
    while (!advance(job, collide, 5)) slices++;
    expect(slices).toBeGreaterThan(1);
    expect(Array.from(job.cloth.pos)).toEqual(Array.from(relax(a)));
    expect(job.cloth.time).toBeCloseTo(a.cloth.time, 9);
  }, 30_000);
});

describe('size readability without the fit map', () => {
  it('labels each anchor with the graded value and the fit engine gap, an estimate marked', () => {
    const gaps = anchorGaps(fit, 'S');
    const labels = anchorLabels(dress.grading, 'S', gaps, m.morphHeights);
    expect(labels.map((l) => l.anchor)).toEqual(['shoulder_width', 'chest', 'waist', 'hip']);
    const entry = dress.grading.sizes.find((x) => x.size === 'S')!;
    for (const l of labels) {
      expect(l.valueCm).toBe(entry.targets[l.anchor]);
      expect(l.gapCm).toBe(gaps?.gaps[l.anchor as keyof NonNullable<typeof gaps>['gaps']]);
    }
    const chest = labels.find((l) => l.anchor === 'chest')!;
    expect(chest.estimate).toBe(false);
    expect(chest.text).toMatch(/^chest 96(\.0)? · [+−±]\d/);
    expect(labels.find((l) => l.anchor === 'shoulder_width')!.height).toBe(m.morphHeights.shoulder);
    // The tee's chart has no waist: its waist value is an estimate.
    const tee = spikeBundle('monochrome-03');
    expect(anchorLabels(tee.grading, 'M', null, m.morphHeights).find((l) => l.anchor === 'waist')!.text).toMatch(/^waist ≈\d/);
  });

  it('outlines S inside L at the chest without exaggeration: the width ratio follows the girths', () => {
    const outline = (size: string) => {
      const f = prepareFit(session, avatar, field, fit, size, viewerMaterial('product', dress.material));
      return { pts: frontOutline(relax(f), session.chains), girth: girth(f.cloth.pos, f.indices) };
    };
    const widthAt = (pts: [number, number][], y: number) => {
      const near = pts.filter((p) => Math.abs(p[1] - y) < 0.6);
      return Math.max(...near.map((p) => p[0])) - Math.min(...near.map((p) => p[0]));
    };
    const S = outline('S');
    const L = outline('L');
    expect(S.pts[0]).toEqual(S.pts[S.pts.length - 1]); // closed
    const y = m.morphHeights.chest;
    expect(widthAt(S.pts, y)).toBeLessThan(widthAt(L.pts, y));
    expect(widthAt(L.pts, y) / widthAt(S.pts, y)).toBeLessThan((L.girth / S.girth) * 1.05);
  }, 30_000);
});

describe('avatar', () => {
  it('is the canonical mannequin for the mannequin measurements', () => {
    let worst = 0;
    for (let i = 0; i < canonical.positions.length; i++) worst = Math.max(worst, Math.abs(avatar.mesh.positions[i]! - canonical.positions[i]!));
    expect(worst).toBeLessThan(1e-9);
  });

  it('scales the rings to typed measurements', () => {
    const a = buildAvatar(m, canonical, { bust: 100, waist: 80, hip: 108 });
    expect(a.rings.chest).toBeCloseTo(100, 6);
    expect(a.rings.waist).toBeCloseTo(80, 6);
    expect(a.rings.hip).toBeCloseTo(108, 6);
    const torso = a.mesh.partNames.indexOf('torso');
    const tris: number[] = [];
    for (let t = 0; t < a.mesh.indices.length; t += 3) if (a.mesh.vertexPart[a.mesh.indices[t]!] === torso) tris.push(a.mesh.indices[t]!, a.mesh.indices[t + 1]!, a.mesh.indices[t + 2]!);
    const g = measureRing({ ...a.mesh, indices: Uint32Array.from(tris) }, m.rings.find((r) => r.id === 'waist')!)!.circumferenceCm;
    expect(Math.abs(g - 80) / 80).toBeLessThan(0.01);
  });
});

describe('sleeve pieces (stage 4t: tubes of their own, not sewn to the bodice)', () => {
  // A bodice tube round the torso and a sleeve tube along the left arm: rings of 24 particles.
  const tube = (centre: (k: number) => [number, number, number], u: readonly number[], v: readonly number[], radius: (k: number) => number, rings: number, offset: number, pos: number[], idx: number[]): void => {
    for (let k = 0; k < rings; k++) for (let c = 0; c < 24; c++) {
      const a = (2 * Math.PI * c) / 24, o = centre(k), r = radius(k);
      pos.push(o[0] + r * (Math.cos(a) * u[0]! + Math.sin(a) * v[0]!), o[1] + r * (Math.cos(a) * u[1]! + Math.sin(a) * v[1]!), o[2] + r * (Math.cos(a) * u[2]! + Math.sin(a) * v[2]!));
    }
    for (let k = 0; k < rings - 1; k++) for (let c = 0; c < 24; c++) {
      const a = offset + k * 24 + c, b = offset + k * 24 + ((c + 1) % 24);
      idx.push(a, a + 24, b + 24, a, b + 24, b);
    }
  };
  const garment = (cuffRadius: number): { pos: Float64Array; idx: Uint32Array; sleeve: number; along: (i: number) => number } => {
    const pos: number[] = [], idx: number[] = [];
    tube((k) => [0, m.morphHeights.shoulder - 2 - 2 * k, 0], [1, 0, 0], [0, 0, 1], () => 20, 40, 0, pos, idx);
    const sleeve = pos.length / 3;
    const arm = m.arms.left;
    // From 1 cm above the joint to 30 cm down the arm: a puff of 7.5 cm narrowing over the last 6 cm to the cuff.
    const s = (k: number): number => -1 + k * 1.55;
    tube((k) => [arm.joint[0] + arm.axis[0] * s(k), arm.joint[1] + arm.axis[1] * s(k), arm.joint[2] + arm.axis[2] * s(k)], arm.u, arm.v, (k) => (k <= 16 ? 7.5 : 7.5 + ((k - 16) / 4) * (cuffRadius - 7.5)), 21, sleeve, pos, idx);
    const along = (i: number): number => (pos[3 * i]! - arm.joint[0]) * arm.axis[0] + (pos[3 * i + 1]! - arm.joint[1]) * arm.axis[1] + (pos[3 * i + 2]! - arm.joint[2]) * arm.axis[2];
    return { pos: Float64Array.from(pos), idx: Uint32Array.from(idx), sleeve, along };
  };

  it('pins the whole sleeve head down to the armpit, underside included, not only what lies above the yoke', () => {
    const g = garment(m.armAt(30, 1)!.a + 1);
    const n = g.pos.length / 3;
    const pinned = new Uint8Array(n);
    const yoke = yokeHeight(m);
    for (let i = 0; i < n; i++) if (g.pos[3 * i + 1]! >= yoke) pinned[i] = 1; // what the yoke rule pins
    const yokeOnly = Uint8Array.from(pinned);
    pinLoosePieces(m, g.pos, g.idx, pinned);
    const head = armpitDistance(m);
    let headParticles = 0, headPinnedByYoke = 0;
    for (let i = g.sleeve; i < n; i++) {
      if (g.along(i) > head) continue;
      headParticles++;
      headPinnedByYoke += yokeOnly[i]!;
      expect(pinned[i]).toBe(1);
    }
    // The yoke alone holds only the top of the head: the case that let the sleeves pivot down.
    expect(headPinnedByYoke).toBeLessThan(headParticles);
    // The bodice is not touched.
    for (let i = 0; i < g.sleeve; i++) expect(pinned[i]).toBe(yokeOnly[i]);
  });

  it('marks a gathered cuff (close to the arm, narrower than the puff) for the leash, never pins it, and leaves a wide cuff free', () => {
    for (const [cuffRadius, held] of [[m.armAt(30, 1)!.a + 1, true], [8, false]] as const) {
      const g = garment(cuffRadius);
      const n = g.pos.length / 3;
      const pinned = new Uint8Array(n), cuffs = new Uint8Array(n);
      pinLoosePieces(m, g.pos, g.idx, pinned, g.pos, cuffs);
      let cuff = 0, cuffMarked = 0, cuffPinned = 0, mid = 0;
      for (let i = g.sleeve; i < n; i++) {
        const s = g.along(i);
        if (s >= 29) {
          cuff++;
          cuffMarked += cuffs[i]!;
          cuffPinned += pinned[i]!;
        } else if (s > 10 && s < 25) mid += pinned[i]! + cuffs[i]!;
      }
      expect(cuffMarked).toBe(held ? cuff : 0);
      expect(cuffPinned).toBe(0);
      expect(mid).toBe(0);
    }
  });

  it('holds a leashed particle within CUFF_LEASH_CM of its anchor while gravity pulls it', () => {
    // Two pinned particles and a free one hanging below them on long edges: free, it falls; leashed, it stays within the leash.
    const start = [0, 100, 0, 1, 100, 0, 0.5, 99, 0];
    const rest = [0, 100, 0, 1, 100, 0, 0.5, 80, 0];
    const idx = [0, 1, 2];
    const drop = (leash: number): number => {
      const c = createCloth(start, rest, idx, (i) => i < 2, () => false);
      c.leash[2] = leash;
      const params = clothParams(viewerMaterial('linen', { baseColorHex: '#ffffff' } as never), 1.5);
      for (let f = 0; f < 60; f++) stepCloth(c, params, null, 1);
      return Math.hypot(c.pos[6]! - start[6]!, c.pos[7]! - start[7]!, c.pos[8]! - start[8]!);
    };
    expect(drop(0)).toBeGreaterThan(5);
    expect(drop(CUFF_LEASH_CM)).toBeLessThanOrEqual(CUFF_LEASH_CM + 1e-4);
  });

  it('lifts cloth out of the arm cap (a smaller size grades the shoulder inwards into it) but leaves the underarm alone', () => {
    const f = m.arms.left;
    const lift = armCapLifter(m, 0.35);
    const at = (s: number, ru: number, rv = 0): Float32Array => Float32Array.from([0, 1, 2].map((d) => f.joint[d]! + s * f.axis[d]! + ru * f.u[d]! + rv * f.v[d]!));
    const radial = (p: Float32Array, s: number): number => Math.hypot(...[0, 1, 2].map((d) => p[d]! - f.joint[d]! - s * f.axis[d]!));
    // On top of the cap (u points up and out on the left arm), 1 cm inside the surface: out to surface + clearance.
    const a3 = m.armAt(3, 1)!.a;
    const top = at(3, a3 - 1);
    expect(lift(top, 0)).toBe(true);
    expect(radial(top, 3)).toBeCloseTo(a3 + 0.35, 3);
    expect(lift(top, 0)).toBe(false);
    // Above the joint the cap narrows to its pole (a cone): a point outside the cone stays.
    expect(lift(at(-3, 2.5), 0)).toBe(false);
    expect(lift(at(-1, 3), 0)).toBe(true);
    // Under the arm, where the v0 arm runs into the torso: never pushed.
    expect(lift(at(3, -(a3 - 1)), 0)).toBe(false);
    // Below the armpit the collider handles the arm: not this.
    expect(lift(at(armpitDistance(m) + 2, 1), 0)).toBe(false);
  });
});
