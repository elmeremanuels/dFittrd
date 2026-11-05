import { describe, expect, it } from 'vitest';
import { anchorGaps } from '@curtain/fit-engine';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, type Mesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { measureRing } from '../../src/anchoring';
import { bodyField, buildAvatar, makeCollider, mannequinMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { strainQuantile } from './cloth';
import { defaultTrio, heatFor, openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';

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
      expect(f.cloth.time).toBeCloseTo(1.5, 6);
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
