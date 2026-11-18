/**
 * The drape bake (docs/research/step3-serverdrape-spike.md §10): the weights the device blends with, the file round
 * trip (writer → base.glb → reader), the loader's bake path and the device's last step (laid out of the drawn body).
 * Pure logic: what the pictures look like is in apps/web/e2e/garment3dBake.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { bodyField, buildAvatar, makeCollider, mannequinMeasurements } from './body';
import { loadBundleFrom, type FetchLike } from './bundle';
import { DRAPE_BAKE_FORMAT, bakeAxis, bakePlace, bakeWeights, blendBakedSize, drapeBakeMetaOf, settleOnBody, type DrapeBakeMeta } from './drapeBake';
import { readDrapeBake } from './drapeBakeRead';
import { writeDrapeBake } from './drapeBakeWrite';
import { bakedDrapes } from './mount';

/** An open tube of radius r round the Y axis from y0 to y1, C columns, R + 1 rows. */
function tube(r: number, y0: number, y1: number, C = 24, R = 6): { pos: Float32Array; idx: Uint32Array } {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= R; i++) for (let c = 0; c < C; c++) {
    const a = (2 * Math.PI * c) / C;
    pos.push(r * Math.sin(a), y0 + ((y1 - y0) * i) / R, r * Math.cos(a));
  }
  for (let i = 0; i < R; i++) for (let c = 0; c < C; c++) {
    const a = i * C + c, b = i * C + ((c + 1) % C);
    idx.push(a, a + C, b + C, a, b + C, b);
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

const meta = (over: Partial<DrapeBakeMeta> = {}): DrapeBakeMeta => ({
  format: DRAPE_BAKE_FORMAT,
  formatVersion: 1,
  axis: { measure: 'hip', hipAtZero: 104, hipPerUnit: 10, label: 'test chart' },
  quantStepCm: 0.05,
  plainColourHex: '#9d3f3b',
  plainColourSource: 'test',
  sizes: [
    { size: '8', baseT: 0, targetT: [-1, 0.5], provenance: 'measured', notDraped: [{ t: 1, reason: 'cannot be worn' }] },
    { size: '12', baseT: 0, targetT: [-1, 1], provenance: 'interpolated' },
  ],
  source: 'test',
  ...over,
});

describe('bakeWeights', () => {
  it('is piecewise linear between the two nearest bodies and holds at the ends', () => {
    const s = { baseT: 0, targetT: [-1, 1] };
    expect(bakeWeights(s, -0.4)).toEqual({ weights: [0.4, 0], clamped: false });
    expect(bakeWeights(s, 0.3).weights.map((w) => +w.toFixed(6))).toEqual([0, 0.3]);
    expect(bakeWeights(s, 0)).toEqual({ weights: [0, 0], clamped: false });
    expect(bakeWeights(s, 1)).toEqual({ weights: [0, 1], clamped: false });
    expect(bakeWeights(s, 2.5)).toEqual({ weights: [0, 1], clamped: true });
    expect(bakeWeights(s, -3)).toEqual({ weights: [1, 0], clamped: true });
  });

  it('uses the nearest body a refused combination leaves (AU 8: t = 0.5 instead of 1)', () => {
    const s = { baseT: 0, targetT: [-1, 0.5] };
    expect(bakeWeights(s, 0.25).weights).toEqual([0, 0.5]);
    expect(bakeWeights(s, 0.8)).toEqual({ weights: [0, 1], clamped: true });
    expect(bakeWeights(s, -0.5).weights).toEqual([0.5, 0]);
  });

  it('says where the shopper lies against the bodies a size was and was not draped on (AU 8: refused on t = 1)', () => {
    const s8 = { baseT: 0, targetT: [-1, 0.5], notDraped: [{ t: 1, reason: 'cannot be worn' }] };
    expect(bakePlace(s8, 0.2)).toMatchObject({ place: 'within', refusedT: null });
    expect(bakePlace(s8, 0.8)).toMatchObject({ place: 'between', refusedT: 1, weights: [0, 1] });
    expect(bakePlace(s8, 1)).toMatchObject({ place: 'refused', refusedT: 1 });
    expect(bakePlace(s8, 1.7)).toMatchObject({ place: 'refused', refusedT: 1 });
    // The refused body is above: below the range the size is only held.
    expect(bakePlace(s8, -1.5)).toMatchObject({ place: 'held', refusedT: null });
    expect(bakePlace({ baseT: 0, targetT: [-1, 1] }, 1.5)).toMatchObject({ place: 'held', refusedT: null });
  });

  it('refuses an axis value that is not a number instead of showing the base drape as the shopper’s', () => {
    expect(() => bakeWeights({ baseT: 0, targetT: [-1, 1] }, Number.NaN)).toThrow(RangeError);
  });

  it('places the shopper on the chart by the hip', () => {
    expect(bakeAxis(meta(), 100)).toBeCloseTo(-0.4, 9);
    expect(bakeAxis(meta(), 114)).toBeCloseTo(1, 9);
  });
});

describe('base.glb round trip', () => {
  const t = tube(18, 40, 100);
  const shift = (p: Float32Array, dr: number, dy: number): Float32Array => Float32Array.from(p, (v, i) => (i % 3 === 1 ? v + dy : v * (1 + dr / 18)));
  const drapes = [
    { size: '8', base: t.pos, targets: [shift(t.pos, -2, 0.5), shift(t.pos, 1, -0.3)] },
    { size: '12', base: shift(t.pos, 1, 0), targets: [shift(t.pos, -1, 0.2), shift(t.pos, 3, -0.6)] },
  ];

  it('reads back every drape within half a grid step, and blends to the target drape at its body', async () => {
    const glb = await writeDrapeBake({ meta: meta(), indices: t.idx, drapes });
    const bake = await readDrapeBake(glb);
    expect(bake.vertexCount).toBe(t.pos.length / 3);
    expect(Array.from(bake.indices)).toEqual(Array.from(t.idx));
    expect(bake.meta.sizes.map((s) => s.provenance)).toEqual(['measured', 'interpolated']);
    for (const d of drapes) {
      const s = bake.sizes.get(d.size)!;
      const err = (a: Float32Array, b: Float32Array): number => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0);
      expect(err(s.base, d.base)).toBeLessThanOrEqual(0.025 + 1e-4);
      for (let k = 0; k < d.targets.length; k++) {
        const w = bakeWeights(s, s.targetT[k]!).weights;
        // base + delta: up to one step (both rounded).
        expect(err(blendBakedSize(s, w), d.targets[k]!)).toBeLessThanOrEqual(0.05 + 1e-4);
      }
    }
  });

  it('is compressed: smaller than the raw int16 positions', async () => {
    const glb = await writeDrapeBake({ meta: meta(), indices: t.idx, drapes });
    expect(glb.byteLength).toBeLessThan(6 * (t.pos.length / 3) * 6 + 2 * t.idx.length);
  });

  it('refuses a bake it cannot read, and reads an ordinary base.glb as no bake', async () => {
    expect(drapeBakeMetaOf({ asset: {} })).toBeNull();
    expect(() => drapeBakeMetaOf({ asset: { extras: { curtainBake: { format: 'other' } } } })).toThrow();
    await expect(writeDrapeBake({ meta: meta(), indices: t.idx, drapes: drapes.slice(0, 1) })).rejects.toThrow(/size 12/);
  });

  it('refuses metadata that would place the shopper at no number or on bodies it cannot name', () => {
    const bad = (over: Partial<DrapeBakeMeta>): (() => unknown) => () => drapeBakeMetaOf({ asset: { extras: { curtainBake: meta(over) } } });
    expect(bad({})).not.toThrow();
    expect(bad({ axis: { measure: 'hip', hipAtZero: 104, hipPerUnit: 0, label: '' } })).toThrow(/axis/);
    expect(bad({ axis: { measure: 'hip', hipAtZero: Number.NaN, hipPerUnit: 10, label: '' } })).toThrow(/axis/);
    expect(bad({ sizes: [{ size: '8', baseT: 0, targetT: [Number.POSITIVE_INFINITY], provenance: 'measured' }] })).toThrow(/finite/);
    expect(bad({ sizes: [{ size: '8', baseT: Number.NaN, targetT: [1], provenance: 'measured' }] })).toThrow(/finite/);
    expect(bad({ sizes: [{ size: '8', baseT: 0, targetT: [0], provenance: 'measured' }] })).toThrow(/twice/);
    expect(bad({ sizes: [{ size: '8', baseT: 0, targetT: [1], provenance: 'guessed' as never }] })).toThrow(/provenance/);
    expect(bad({ sizes: [{ size: '8', baseT: 0, targetT: [1], provenance: 'measured', notDraped: [{ t: Number.NaN, reason: 'x' }] }] })).toThrow(/notDraped/);
  });

  it('refuses a morph target of another vertex count, and sizes with other triangles', async () => {
    expect(() => blendBakedSize({ base: new Float32Array(9), targets: [new Float32Array(6)] }, [1])).toThrow(/vertex count/);
    const glb = await writeDrapeBake({ meta: meta(), indices: t.idx, drapes });
    // Rewrite the JSON chunk: the second size's mesh gets a copy of an accessor with three fewer elements.
    const shorten = (pick: (prim: { indices: number; targets?: { POSITION: number }[] }) => { get: () => number; set: (i: number) => void }): Uint8Array => {
      const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
      const jsonLen = dv.getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as { accessors: { count: number }[]; meshes: { primitives: { indices: number; targets?: { POSITION: number }[] }[] }[] };
      const slot = pick(json.meshes[1]!.primitives[0]!);
      json.accessors.push({ ...json.accessors[slot.get()]!, count: json.accessors[slot.get()]!.count - 3 });
      slot.set(json.accessors.length - 1);
      let text = JSON.stringify(json);
      while (text.length % 4) text += ' ';
      const head = new TextEncoder().encode(text);
      const rest = glb.subarray(20 + jsonLen);
      const out = new Uint8Array(20 + head.length + rest.length);
      const o = new DataView(out.buffer);
      out.set(glb.subarray(0, 12));
      o.setUint32(8, out.length, true);
      o.setUint32(12, head.length, true);
      o.setUint32(16, 0x4e4f534a, true);
      out.set(head, 20);
      out.set(rest, 20 + head.length);
      return out;
    };
    await expect(readDrapeBake(shorten((p) => ({ get: () => p.indices, set: (i) => (p.indices = i) })))).rejects.toThrow(/other triangles/);
    await expect(readDrapeBake(shorten((p) => ({ get: () => p.targets![0]!.POSITION, set: (i) => (p.targets![0]!.POSITION = i) })))).rejects.toThrow(/another vertex count/);
  });

  it('loads as a bundle whose anchors name the bake: no grading of a base mesh, the base size as baseMesh', async () => {
    const glb = await writeDrapeBake({ meta: meta(), indices: t.idx, drapes });
    const files: Record<string, unknown> = {
      'anchors.json': { format: 'curtain.garment.anchors', productId: 'p', baseSize: '12', category: 'bottom', unit: 'cm', mannequin: { version: '0.1.0', shape: 'M' }, synthetic: false, rings: {}, drapeBake: 'base.glb' },
      'grading.json': { format: 'curtain.garment.grading', baseSize: '12', sizes: [{ size: '8' }, { size: '12' }] },
      'material.json': { format: 'curtain.garment.material' },
      'qa.json': { format: 'curtain.garment.qa' },
    };
    const fetchFn: FetchLike = async (url) => {
      const name = url.split('/').pop()!;
      return { ok: true, status: 200, json: async () => files[name], arrayBuffer: async () => glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer };
    };
    const b = await loadBundleFrom(fetchFn, '/a', 'p', { withPayload: false });
    expect(b.bake?.sizes.size).toBe(2);
    expect(b.baseMesh.positions.length).toBe(t.pos.length);
    expect(b.baseMesh.positions[0]).toBeCloseTo(drapes[1]!.base[0]!, 1);
    expect(b.render).toBeUndefined();
  });
});

describe('on the drawn body', () => {
  const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
  const meas = { ...mannequinMeasurements(m), hip: 100, waist: 73.5 };
  const field = bodyField(m, buildAvatar(m, buildMannequinMesh(m), meas));

  it('moves particles inside the body out to the clearance and lays a hem below the soles on the floor', () => {
    // A tube far too narrow at the hip (radius 10 cm: inside the body) that runs 2 cm below the floor.
    const t = tube(10, -2, 95);
    const pos = Float32Array.from(t.pos);
    const r = settleOnBody(pos, makeCollider(field, 0.35));
    expect(r.body).toBeGreaterThan(0);
    expect(r.floor).toBe(24);
    expect(Math.min(...pos.filter((_, i) => i % 3 === 1))).toBeGreaterThanOrEqual(0);
    // Settled particles are no longer inside: a second pass moves nothing.
    expect(settleOnBody(pos, makeCollider(field, 0.35)).body).toBe(0);
  });

  it('gives every size its blend at the shopper’s hip and says when the shopper is beyond its bodies', async () => {
    const t = tube(30, 20, 100);
    const drapes = [
      { size: '8', base: t.pos, targets: [t.pos, t.pos] },
      { size: '12', base: t.pos, targets: [t.pos, t.pos] },
    ];
    const bake = await readDrapeBake(await writeDrapeBake({ meta: meta(), indices: t.idx, drapes }));
    const atHeld = bakedDrapes(bake, field, 100);
    expect([...atHeld.keys()]).toEqual(['8', '12']);
    expect(atHeld.get('8')!.place).toBe('within');
    expect(atHeld.get('8')!.pushed).toBe(0);
    const big = bakedDrapes(bake, field, 112);
    expect(big.get('8')).toMatchObject({ place: 'between', refusedHipCm: 114 }); // t = 0.8: past AU 8's last body (0.5), short of the refused one (1)
    expect(big.get('12')!.place).toBe('within');
    const bigger = bakedDrapes(bake, field, 116);
    expect(bigger.get('8')).toMatchObject({ place: 'refused', refusedHipCm: 114 });
    expect(bigger.get('12')).toMatchObject({ place: 'held', refusedHipCm: null });
  });
});
