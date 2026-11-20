import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BAKE_CHECK_IDS, bakeCheckRefusal, garmentQaFlags, MAX_GARMENT_BUNDLE_BYTES, passedBakeCheck, type BakeCheckId, type BakeCheckReport } from '@curtain/schema';
import { checkDrapeBake, ringLength, type BakeGateInput } from './bakeGate';
import type { DrapeBake, DrapeBakeMeta } from './drapeBake';
import { readDrapeBake } from './drapeBakeRead';
import { writeDrapeBake } from './drapeBakeWrite';

/**
 * The fixture is the POM v2 rest geometry of the pilot skirt, built from the shop's tape by the committed
 * `pom_rest.py` and laid on the device avatar of each body of the real bake's plan (spikes/garment-engine/viewer/
 * scripts/serverdrape/bake-pom-rest-fixture.ts): AU 8 on hip 94; AU 10 on 94-99; AU 12 on 94-104; AU 14 and AU 16
 * on 94-109; every other body declared not draped because the band cannot be pulled over it (`rule: 'pull-on'`). It is
 * in the exact bake format; it is not a cloth simulation.
 */
const DIR = fileURLToPath(new URL('../fixtures/pom-v2-rest/', import.meta.url));
const json = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Record<string, unknown>;
const FILES = ['base.glb', 'anchors.json', 'grading.json', 'material.json', 'qa.json'];
const BYTES = FILES.reduce((s, f) => s + readFileSync(join(DIR, f)).length, 0);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let bake: DrapeBake;
let good: BakeCheckReport;
const input = (over: Partial<BakeGateInput> = {}): BakeGateInput => ({ glb: new Uint8Array(readFileSync(join(DIR, 'base.glb'))), anchors: json('anchors.json'), grading: json('grading.json'), qa: json('qa.json'), bytes: BYTES, now: new Date('2026-11-19T00:00:00Z'), ...over });

/** The fixture re-written with its metadata and drapes changed: `drapes(size, t, pos)` may edit each drape in place. */
async function variant(edit: { meta?: (m: DrapeBakeMeta) => void; drape?: (size: string, t: number, pos: Float32Array) => void }): Promise<Uint8Array> {
  const meta = clone(bake.meta);
  edit.meta?.(meta);
  const drapes = bake.meta.sizes.map((sm) => {
    const s = bake.sizes.get(sm.size)!;
    const base = Float32Array.from(s.base);
    const targets = s.targets.map((d) => Float32Array.from(base, (v, i) => v + d[i]!));
    edit.drape?.(sm.size, s.baseT, base);
    s.targetT.forEach((t, k) => edit.drape?.(sm.size, t, targets[k]!));
    return { size: sm.size, base, targets };
  });
  // a size dropped from the metadata keeps no drape
  return writeDrapeBake({ meta, indices: bake.indices, drapes: drapes.filter((d) => meta.sizes.some((s) => s.size === d.size)) });
}

/** Scale one ring's particles about the ring's own centre, in the horizontal plane. */
function scaleRing(pos: Float32Array, ring: { start: number; count: number }, k: number): void {
  let cx = 0, cz = 0;
  for (let i = ring.start; i < ring.start + ring.count; i++) { cx += pos[3 * i]!; cz += pos[3 * i + 2]!; }
  cx /= ring.count; cz /= ring.count;
  for (let i = ring.start; i < ring.start + ring.count; i++) { pos[3 * i] = cx + (pos[3 * i]! - cx) * k; pos[3 * i + 2] = cz + (pos[3 * i + 2]! - cz) * k; }
}

const check = (r: BakeCheckReport, id: BakeCheckId) => r.checks.find((c) => c.id === id)!;
const failed = (r: BakeCheckReport): BakeCheckId[] => r.checks.filter((c) => c.pass === false).map((c) => c.id);

beforeAll(async () => {
  bake = await readDrapeBake(new Uint8Array(readFileSync(join(DIR, 'base.glb'))));
  good = await checkDrapeBake(input());
}, 60_000);

describe('the bake check on the POM v2 tape-built skirt', () => {
  it('passes every check, with nothing to approve on the builder’s word', () => {
    expect(good.checks.map((c) => [c.id, c.pass])).toEqual(BAKE_CHECK_IDS.map((id) => [id, true]));
    expect(good.pass).toBe(true);
    // 1 + 2 + 2 + 3 + 3 drapes on the 5 bodies (hips 94, 99, 104, 109, 114)
    expect(good.drapes).toHaveLength(11);
    expect(passedBakeCheck({ bakeCheck: good })).not.toBeNull();
    expect(garmentQaFlags({ chartAgreement: { pass: true, kind: 'tape-built' }, bakeCheck: good })).toEqual([]);
    expect(garmentQaFlags({ chartAgreement: { pass: true, kind: 'tape-built' } })).toEqual(['tape_built_no_chart_check']);
  });

  it('measures the hip line and the hem of every drape against the tape (the numbers the merchant sees)', () => {
    const at = (size: string, t: number) => good.drapes.find((d) => d.size === size && d.t === t)!;
    // AU 10 measured: hip 122, hem 248 on the tape
    expect(at('10', -0.5)).toMatchObject({ bodyHipCm: 99, hipRingCm: 122, hemRingCm: 248.1, insideParticles: 0, atRest: true });
    expect(at('16', 0.5)).toMatchObject({ bodyHipCm: 109, hipRingCm: 128, hemRingCm: 266 });
    expect(good.tape?.sizes.map((s) => [s.size, s.provenance, s.hipCm, s.hemSweepCm])).toEqual([
      ['8', 'measured', 112, 230], ['10', 'measured', 122, 248], ['12', 'interpolated', 124, 254], ['14', 'measured', 126, 260], ['16', 'extrapolated', 128, 266],
    ]);
    expect(good.tape?.hipBelowBandCm).toBeNull();
    expect(good.tape?.sizes[0]!.notDraped.map((n) => n.bodyHipCm)).toEqual([99, 104, 109, 114]);
    expect(good.tape?.sizes[4]!.notDraped).toEqual([{ bodyHipCm: 114, reason: expect.stringMatching(/^its band cannot be pulled over the drawn body with 114 cm hips: 115 cm at full stretch against 117 cm/) }]);
    expect(ringLength(bake.sizes.get('12')!.base, bake.meta.tapeRings!.hem)).toBeCloseTo(254, 0);
  });
});

describe('broken bakes are refused, with a plain reason', () => {
  it('no tape in qa.json: unreadable, nothing else runs', async () => {
    const qa = json('qa.json');
    delete qa.tape;
    const r = await checkDrapeBake(input({ qa }));
    expect(r.pass).toBe(false);
    expect(check(r, 'readable').reasons[0]).toMatch(/states no tape/);
    expect(check(r, 'tape_rings').pass).toBeNull();
    expect(bakeCheckRefusal(r)).toMatch(/^The bake can be read and names its tape, rings and bodies: no\. qa\.json states no tape/);
  });

  it('a bake without its rings or bodies cannot be checked', async () => {
    const r = await checkDrapeBake(input({ glb: await variant({ meta: (m) => { delete m.tapeRings; delete m.bodies; } }) }));
    expect(failed(r)).toEqual(['readable']);
    expect(check(r, 'readable').reasons.join(' ')).toMatch(/hip-line and hem rings.*drawn bodies/);
  });

  it('a body whose hip is off the bake’s axis', async () => {
    const r = await checkDrapeBake(input({ glb: await variant({ meta: (m) => { m.bodies![2]!.hip = 106; } }) }));
    expect(check(r, 'readable').reasons[0]).toBe('the body at axis value 0 has 106 cm hips, but the bake’s axis puts 104 cm there');
  });

  it('a hem 10 % short of the tape', async () => {
    const r = await checkDrapeBake(input({ glb: await variant({ drape: (size, t, pos) => { if (size === '12' && t === -1) scaleRing(pos, bake.meta.tapeRings!.hem, 0.9); } }) }));
    // 228.7 cm is also smaller than AU 10's 248 cm hem on that body: the size order fails with it
    expect(failed(r)).toEqual(['tape_rings', 'size_order']);
    expect(check(r, 'tape_rings').reasons).toEqual(['size 12 on the body with 94 cm hips: the draped hem is 228.7 cm around, the tape says 254 cm (allowed ±5.1 cm)']);
    expect(check(r, 'size_order').reasons[0]).toBe('on the body with 94 cm hips the hem of size 12 (228.7 cm) is smaller than that of size 10 (248.1 cm), but the tape grows from 248 cm to 254 cm');
  });

  it('a size the bundle grades but did not drape', async () => {
    const grading = json('grading.json') as { sizes: { size: string; provenance: string }[] };
    grading.sizes.push({ size: '18', provenance: 'extrapolated' });
    const r = await checkDrapeBake(input({ grading }));
    expect(check(r, 'sizes_have_geometry').reasons[0]).toBe('grading.json grades 8, 10, 12, 14, 16, 18, the bake draped 8, 10, 12, 14, 16');
    // and a size dropped from the bake but still on the tape
    const r2 = await checkDrapeBake(input({ glb: await variant({ meta: (m) => { m.sizes = m.sizes.filter((s) => s.size !== '16'); } }) }));
    expect(check(r2, 'sizes_have_geometry').reasons).toContain('the tape lists 8, 10, 12, 14, 16, the bake draped 8, 10, 12, 14');
  });

  it('a garment that does not hang its tape length (collapsed drape)', async () => {
    const r = await checkDrapeBake(input({ glb: await variant({ drape: (size, t, pos) => { if (size === '14' && t === 0.5) for (let i = 1; i < pos.length; i += 3) pos[i] = 100 + (pos[i]! - 100) * 0.3; } }) }));
    expect(check(r, 'sizes_have_geometry').reasons[0]).toMatch(/^size 14 on the body with 109 cm hips is 3\d\.\d cm tall; the tape says the garment is 104 cm long$/);
    expect(check(r, 'tape_rings').pass).toBeNull();
  });

  it('a body a size was not draped on, without saying why', async () => {
    const r = await checkDrapeBake(input({ glb: await variant({ meta: (m) => { delete m.sizes[0]!.notDraped; } }) }));
    expect(failed(r)).toEqual(['refusals_declared']);
    expect(check(r, 'refusals_declared').reasons).toEqual([99, 104, 109, 114].map((h) => `size 8 has no drape on the body with ${h} cm hips and does not say why`));
  });

  it('a refusal between two drapes of the same size, and one without a reason', async () => {
    // AU 14 (drawn on 94, 104 and 109) declared refused on the 99 cm body, with an empty reason
    const r = await checkDrapeBake(input({ glb: await variant({ meta: (m) => { m.sizes[3]!.notDraped = [{ t: -0.5, reason: ' ' }, ...(m.sizes[3]!.notDraped ?? [])]; } }) }));
    expect(check(r, 'refusals_declared').reasons).toEqual([
      'size 14 is refused on the body with 99 cm hips without a reason',
      'size 14 is refused on the body with 99 cm hips but drawn on bodies either side of it, so the phone would blend through the refusal',
    ]);
  });

  it('a body inside a size’s draped range needs no drape (the phone blends across it), as in the real POM v2 bake', () => {
    // AU 12, 14 and 16 are drawn on 94 and 104 cm hips and have no drape on the 99 cm body between them
    expect(good.pass).toBe(true);
    for (const size of ['12', '14', '16']) expect(good.drapes.some((d) => d.size === size && d.t === -0.5)).toBe(false);
  });

  it('a size draped on a body its band cannot be pulled over (the fit engine’s pull-on check, recomputed)', async () => {
    // AU 12's band stated 5 cm shorter: 100 cm at full stretch, drawn on the 104 cm body (106.8 cm at its widest)
    const qa = json('qa.json') as { tape: { sizes: { tape: { stretchedGirthCm: { cm: number } } }[] } };
    qa.tape.sizes[2]!.tape.stretchedGirthCm.cm = 100;
    const r = await checkDrapeBake(input({ qa }));
    expect(failed(r)).toEqual(['refusals_declared']);
    expect(check(r, 'refusals_declared').reasons).toEqual([
      'size 12 is draped on the body with 104 cm hips, but its band at full stretch is 100 cm against that body’s 106.8 cm at its widest below the waist (6.8 cm short; the size advice allows 2.5 cm short): the band cannot be pulled over it',
      // and its refusals on the 109 and 114 cm bodies still hold
    ]);
  });

  it('a pull-on refusal that does not hold, and one with another reason (only required to say it)', async () => {
    // AU 16's band stated 3 cm longer: 118 cm goes over the 114 cm body's 117 cm, yet the bake declares it cannot
    const qa = json('qa.json') as { tape: { sizes: { tape: { stretchedGirthCm: { cm: number } } }[] } };
    qa.tape.sizes[4]!.tape.stretchedGirthCm.cm = 118;
    const r = await checkDrapeBake(input({ qa }));
    expect(failed(r)).toEqual(['refusals_declared']);
    expect(check(r, 'refusals_declared').reasons).toEqual([
      'size 16 is refused on the body with 114 cm hips because its band cannot be pulled over it, but its band at full stretch is 118 cm against that body’s 117 cm at its widest below the waist (1 cm to spare; the size advice allows 0 cm short): it can',
    ]);
    // A refusal with another reason is only required to say it (the gate cannot recompute it).
    const r2 = await checkDrapeBake(input({ qa, glb: await variant({ meta: (m) => { delete m.sizes[4]!.notDraped![0]!.rule; } }) }));
    expect(r2.pass).toBe(true);
  });

  it('fabric inside the drawn body', async () => {
    const r = await checkDrapeBake(input({ glb: await variant({ drape: (size, t, pos) => { if (size === '14' && t === 0) for (let i = 0; i < 400; i++) { pos[3 * (3000 + i)]! *= 0.5; pos[3 * (3000 + i) + 2]! *= 0.5; } } }) }));
    expect(failed(r)).toContain('inside_body');
    expect(check(r, 'inside_body').reasons[0]).toMatch(/^size 14 on the body with 104 cm hips: \d+ particles inside the drawn body, up to \d+(\.\d)? cm deep$/);
    expect(r.drapes.find((d) => d.size === '14' && d.t === 0)!.insideParticles).toBeGreaterThan(100);
  });

  it('provenance that does not match the tape', async () => {
    const grading = json('grading.json') as { sizes: { size: string; provenance: string }[] };
    grading.sizes[4]!.provenance = 'measured';
    const qa = json('qa.json') as { tape: { sizes: { size: string; provenance: string; tape: Record<string, { source: string }> }[] } };
    qa.tape.sizes[2]!.provenance = 'measured'; // AU 12's numbers are interpolated
    const r = await checkDrapeBake(input({ grading, qa }));
    expect(check(r, 'provenance').reasons).toEqual([
      'size 12 is called measured but its tape numbers are interpolated',
      'size 12 is measured on the tape but interpolated in the bake',
      'size 12 is measured on the tape but interpolated in grading.json',
      'size 16 is extrapolated on the tape but measured in grading.json',
    ]);
    // an extrapolated size that lies between measured ones, and an interpolated one beyond them
    const qa2 = json('qa.json') as typeof qa;
    for (const k of Object.keys(qa2.tape.sizes[2]!.tape)) qa2.tape.sizes[2]!.tape[k]!.source = 'extrapolated';
    qa2.tape.sizes[2]!.provenance = 'extrapolated';
    for (const k of Object.keys(qa2.tape.sizes[4]!.tape)) qa2.tape.sizes[4]!.tape[k]!.source = 'interpolated';
    qa2.tape.sizes[4]!.provenance = 'interpolated';
    const r2 = await checkDrapeBake(input({ qa: qa2 }));
    expect(check(r2, 'provenance').reasons).toContain('size 12 is called extrapolated but lies between two measured sizes (it is interpolated)');
    expect(check(r2, 'provenance').reasons).toContain('size 16 is called interpolated but does not lie between two measured sizes');
  });

  it('sizes that shrink where the tape grows', async () => {
    // AU 14's hip line drawn 3.2 cm smaller (inside the ring tolerance of a tape hip of 124.6), AU 12 stays at 124
    const qa = json('qa.json') as { tape: { sizes: { tape: { hipCm: { cm: number } } }[] } };
    qa.tape.sizes[3]!.tape.hipCm.cm = 124.6;
    const r = await checkDrapeBake(input({ qa, glb: await variant({ drape: (size, t, pos) => { if (size === '14' && t === 0) scaleRing(pos, bake.meta.tapeRings!.hip, 122.8 / 126); } }) }));
    expect(failed(r)).toEqual(['size_order']);
    expect(check(r, 'size_order').reasons).toEqual(['on the body with 104 cm hips the hip-line ring of size 14 (122.8 cm) is smaller than that of size 12 (124 cm), but the tape grows from 124 cm to 124.6 cm']);
  });

  it('a drape that did not come to rest, or does not say', async () => {
    const r = await checkDrapeBake(input({ glb: await variant({ meta: (m) => { m.sizes[1]!.drapes![1] = { t: -1, atRest: true, maxMoveCmPerFrame: 0.285, meanMoveCmPerFrame: 0.01 }; delete m.sizes[2]!.drapes; } }) }));
    expect(failed(r)).toEqual(['at_rest']);
    expect(check(r, 'at_rest').reasons[0]).toBe('size 10 on the body with 94 cm hips was still moving (0.285 cm per frame at most, 0.01 on average; the limits are 0.25 and 0.02)');
    expect(check(r, 'at_rest').reasons[1]).toBe('size 12 on the body with 104 cm hips does not say whether it came to rest');
  });

  it('a bundle over the phone budget', async () => {
    const r = await checkDrapeBake(input({ bytes: MAX_GARMENT_BUNDLE_BYTES + 1 }));
    expect(failed(r)).toEqual(['file_size']);
    expect(check(r, 'file_size').reasons[0]).toBe('the bundle is 3.00 MB; a phone downloads at most 3 MB');
  });

  it('a base.glb that is not a bake', async () => {
    const r = await checkDrapeBake(input({ glb: new Uint8Array([1, 2, 3]) }));
    expect(r.pass).toBe(false);
    expect(check(r, 'readable').reasons[0]).toMatch(/^base\.glb is not a readable drape bake/);
    expect(passedBakeCheck({ bakeCheck: r })).toBeNull();
  });
});
