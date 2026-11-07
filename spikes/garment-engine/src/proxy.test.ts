import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, cameraMatrices, topology, transformPoint4, turntablePath, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import { mockGarment, type GarmentPayload } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { measureRing } from './anchoring';
import { evalChart, evalChartRow } from './evalChart';
import { PROXY_ID, controlFrame, depthRange, idMask } from './exportJob';
import { generateGarment } from './garment';
import { garmentLengths } from './garmentLength';
import { SPIKE_PRODUCT_IDS, garmentSpec } from './product';
import { MIN_CLEARANCE_CM, buildProxy, proxyKind, proxyRecord, type ProxyKind } from './proxy';
import { render } from './raster';
import { MANNEQUIN_GREY, MANNEQUIN_ID } from './separation';

const m: Mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
const body: Mesh = buildMannequinMesh(m);
const shopFile = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic', 'products.json'), 'utf8')) as {
  products: { handle: string; payload: GarmentPayload; baseSize: string }[];
};

/** The spike fixtures and the five committed Bohohippychic drafts, at their base sizes. */
const PRODUCTS: [string, GarmentPayload, string][] = [
  ...SPIKE_PRODUCT_IDS.map((id): [string, GarmentPayload, string] => [id, mockGarment(id), 'M']),
  ...shopFile.products.map((p): [string, GarmentPayload, string] => [p.handle, p.payload, p.baseSize]),
];
const product = (id: string): [GarmentPayload, string] => {
  const hit = PRODUCTS.find(([pid]) => pid === id)!;
  return [hit[1], hit[2]];
};

describe('control proxy: kind', () => {
  it('follows the category, and the word "skirt" for bottoms', () => {
    const kinds = Object.fromEntries(PRODUCTS.map(([id, p]) => [id, proxyKind(p)]));
    expect(kinds).toEqual({
      'aalter-studio-2': 'dress',
      'monochrome-03': 'top',
      'azure-palm-baby-doll-dress': 'dress',
      'rosewater-blouse': 'top',
      'rosewater-palazzo-pants': 'trousers',
      'crimson-wildflower-maxi-skirt': 'skirt',
      'woodstock-wanderer-knit-cardi': 'outerwear',
    } satisfies Record<string, ProxyKind>);
    expect(() => proxyKind({ ...mockGarment('aalter-studio-2'), category: 'shoes' })).toThrow(/no control proxy/);
  });
});

describe.each(PRODUCTS)('control proxy of %s', (_id, payload, baseSize) => {
  const { spec, mesh } = buildProxy(m, payload, baseSize);

  it('has the chart girths (with ease) at every anchor it passes, within 1 cm, measured on the mesh', () => {
    const chart = evalChartRow(evalChart(payload), baseSize).rings;
    const fromChart = spec.anchors.filter((a) => chart[a] !== undefined);
    expect(fromChart.length).toBeGreaterThanOrEqual(payload.category === 'bottom' ? 2 : 1);
    for (const a of spec.anchors) {
      const ring = m.rings.find((r) => r.id === a)!;
      const measured = measureRing(mesh, ring);
      expect(measured, a).not.toBeNull();
      expect(Math.abs(measured!.circumferenceCm - spec.girths[a]!), a).toBeLessThan(1);
      const c = chart[a];
      if (c !== undefined && spec.girthSource[a] !== 'pattern block: wide leg') expect(Math.abs(measured!.circumferenceCm - c), `${a} vs chart ${c}`).toBeLessThan(1);
      expect(spec.girths[a]!).toBeGreaterThanOrEqual(m.shape.rings[a].circumferenceCm + MIN_CLEARANCE_CM);
    }
  });

  it('is made of closed, outward-facing parts named for the rig', () => {
    const t = topology(mesh);
    expect(t.boundaryEdges).toBe(0);
    expect(t.nonManifoldEdges).toBe(0);
    expect(t.volumes.every((v) => v > 0)).toBe(true);
    const names = mesh.partNames;
    expect(names[0]).toBe('body');
    for (const n of names) expect(n).toMatch(/^(body|leg_[lr]|sleeve_[lr])$/);
    expect(names.includes('leg_l')).toBe(spec.kind === 'trousers');
    expect(names.includes('sleeve_l')).toBe(spec.sleeveCm > 0);
  });

  it('records a hashable spec (finite numbers, rounded)', () => {
    const rec = proxyRecord(spec);
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
    expect(rec.kind).toBe(spec.kind);
    expect(spec.hemY).toBeLessThan(spec.topY);
  });
});

/** Pixel column of the body's vertical axis (x = 0, z = 0) at height y in a frame. */
function axisPixel(frame: ReturnType<typeof turntablePath>['frames'][number], width: number, height: number, y: number): [number, number] {
  const { viewProjection } = cameraMatrices(frame, width / height);
  const p: Vec3 = [0, y, 0];
  const [x, yy, , w] = transformPoint4(viewProjection, p);
  return [Math.floor(((x / w + 1) / 2) * width), Math.floor(((1 - yy / w) / 2) * height)];
}

/** Rows between the crotch and the hem where the control silhouette is empty on the body axis (a gap between the legs). */
function gapRows(payload: GarmentPayload | null, baseSize: string, frameIdx: number[]): number {
  const W = 192, H = 336;
  const path = turntablePath(m, 'turntable_mid', { frames: 8 });
  const proxy = payload ? buildProxy(m, payload, baseSize) : null;
  const items = [{ positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID }, ...(proxy ? [{ positions: proxy.mesh.positions, indices: proxy.mesh.indices, color: MANNEQUIN_GREY, id: PROXY_ID }] : [])];
  const range = depthRange(body.positions, path.frames);
  const hemY = proxy ? proxy.spec.hemY : m.morphHeights.knee;
  let gaps = 0;
  for (const i of frameIdx) {
    const f = path.frames[i]!;
    const r = render(items, f, W, H);
    const c = controlFrame(r, range.nearCm - 40, range.farCm + 40);
    const [, top] = axisPixel(f, W, H, m.landmarks.crotch[1] - 3);
    const [, bottom] = axisPixel(f, W, H, hemY + 3);
    for (let py = top; py <= bottom; py++) {
      const [px] = axisPixel(f, W, H, m.landmarks.crotch[1]);
      if (c.depthMm[py * W + px] === 0) gaps++;
    }
  }
  return gaps;
}

describe('control proxy in the depth frames', () => {
  const frontBackAndDiagonals = [0, 1, 3, 4, 5, 7];

  it('the bare mannequin shows a gap between the legs (what drove run 10 into trousers)', () => {
    expect(gapRows(null, 'M', [0, 4])).toBeGreaterThan(20);
  });

  it.each(['aalter-studio-2', 'azure-palm-baby-doll-dress', 'crimson-wildflower-maxi-skirt'])('a dress or skirt proxy (%s) has no gap between the legs, front, back and diagonals', (id) => {
    const [p, size] = product(id);
    expect(gapRows(p, size, frontBackAndDiagonals)).toBe(0);
  });

  it('a trouser proxy keeps the gap between its two legs', () => {
    const [p, size] = product('rosewater-palazzo-pants');
    expect(gapRows(p, size, [0, 4])).toBeGreaterThan(20);
  });

  it('the proxy mask is where the proxy is visible, inside the control silhouette', () => {
    const [p, size] = product('azure-palm-baby-doll-dress');
    const proxy = buildProxy(m, p, size);
    const f = turntablePath(m, 'turntable_mid', { frames: 8 }).frames[0]!;
    const r = render([{ positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID }, { positions: proxy.mesh.positions, indices: proxy.mesh.indices, color: MANNEQUIN_GREY, id: PROXY_ID }], f, 96, 160);
    const c = controlFrame(r, 300, 500);
    const pm = idMask(r, PROXY_ID);
    let inProxy = 0;
    for (let k = 0; k < pm.length; k++) {
      if (pm[k]) {
        inProxy++;
        expect(c.mask[k]).toBe(255);
      }
    }
    expect(inProxy).toBeGreaterThan(500);
  });
});

describe('control proxy: the hem follows the product length exactly', () => {
  /** Lowest point of the mesh within 15 cm of the body axis (the hem, not a sleeve hanging past it in the A-pose). */
  const lowestY = (mesh: Mesh): number => {
    let y = Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) if (Math.abs(mesh.positions[i]!) < 15) y = Math.min(y, mesh.positions[i + 1]!);
    return y;
  };

  it('puts the mesh hem at the chart length for every product with a length, not only the spec', () => {
    let checked = 0;
    for (const [id, payload, size] of PRODUCTS) {
      const { spec, mesh } = buildProxy(m, payload, size);
      // The mesh's lowest point near the axis is the hem ring: a closed cap at hemY, nothing below it.
      expect(lowestY(mesh), id).toBeCloseTo(spec.hemY, 6);
      const len = (payload.lengthCm ?? {}) as Partial<Record<string, number>>;
      if (spec.lengthSource.includes('clamped')) continue;
      if ((spec.kind === 'dress' || spec.kind === 'top' || spec.kind === 'outerwear') && len.shoulder_to_hem !== undefined) {
        // A printed shoulder_to_hem is a flat-lay length: along the proxy's front from the HPS, not a vertical drop.
        expect(spec.lengthDefinition, id).toBe('hps_surface');
        const along = garmentLengths(m, mesh).find((l) => l.definition === 'hps_surface')!.lengthCm!;
        expect(Math.abs(along - len.shoulder_to_hem), id).toBeLessThan(0.3);
        expect(spec.hemDropCm, id).toBeLessThan(len.shoulder_to_hem);
        checked++;
      } else if (spec.kind === 'trousers' && len.outseam !== undefined) {
        expect(m.morphHeights.waist - spec.hemY, id).toBeCloseTo(len.outseam, 6);
        checked++;
      } else if (spec.kind === 'skirt' && len.waist_to_hem !== undefined) {
        expect(m.morphHeights.waist - spec.hemY, id).toBeCloseTo(len.waist_to_hem, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('aalter-studio-2 with synthetic stills: the proxy hem is the synthetic garment truth hem (run 11a: both 26.6 cm above the floor)', () => {
    // The spike's synthetic garment drops its shoulder_to_hem vertically; the exporter passes it as the override (exportJob).
    const payload = mockGarment('aalter-studio-2');
    const synth = garmentSpec(payload, 'M').shoulderToHemCm;
    const proxy = buildProxy(m, payload, 'M', { shoulderToHemCm: synth, lengthSource: 'synthetic stills' });
    const truth = generateGarment(m, garmentSpec(payload, 'M'));
    expect(lowestY(proxy.mesh)).toBeCloseTo(lowestY(truth), 6);
    expect(proxy.spec.hemY).toBeCloseTo(m.landmarks.hps[1] - 112, 6);
    expect(proxy.spec.lengthDefinition).toBe('drop');
  });

  it('run 14 babydoll (printed Length 91 cm): the hem ends 91 cm along the front, about 10 cm above a 91 cm vertical drop', () => {
    const [p, size] = product('azure-palm-baby-doll-dress');
    const { spec, mesh } = buildProxy(m, p, size);
    expect(spec.lengthCm).toBe(91);
    const lengths = garmentLengths(m, mesh);
    expect(Math.abs(lengths.find((l) => l.definition === 'hps_surface')!.lengthCm! - 91)).toBeLessThan(0.3);
    // 0.1.0 put the hem at the knee (47.6 cm); a flat-lay 91 cm ends well above it on our mannequin.
    expect(spec.hemY - (m.landmarks.hps[1] - 91)).toBeGreaterThan(5);
    expect(spec.hemY).toBeGreaterThan(m.morphHeights.knee + 5);
  });

  it('takes an explicit shoulder-to-hem override (the synthetic stills) and records where it came from', () => {
    const payload = mockGarment('aalter-studio-2');
    const { lengthCm: _drop, ...rest } = payload;
    const noLength = rest as GarmentPayload;
    const own = buildProxy(m, noLength, 'M').spec;
    const synth = garmentSpec(noLength, 'M').shoulderToHemCm;
    // Without a length the proxy and the synthetic garment disagree (proxy: pattern words or the knee).
    expect(Math.abs(m.landmarks.hps[1] - own.hemY - synth)).toBeGreaterThan(1);
    const { spec, mesh } = buildProxy(m, noLength, 'M', { shoulderToHemCm: synth, lengthSource: 'synthetic stills' });
    expect(m.landmarks.hps[1] - spec.hemY).toBeCloseTo(synth, 6);
    expect(spec.lengthSource).toBe('synthetic stills');
    expect(lowestY(mesh)).toBeCloseTo(lowestY(generateGarment(m, garmentSpec(noLength, 'M'))), 6);
  });

  it('refuses the shoulder-to-hem override for skirt and trousers proxies instead of ignoring it', () => {
    for (const id of ['crimson-wildflower-maxi-skirt', 'rosewater-palazzo-pants']) {
      const [p, size] = product(id);
      expect(() => buildProxy(m, p, size, { shoulderToHemCm: 100 })).toThrow(/shoulderToHemCm override given for a (skirt|trousers) proxy/);
    }
  });
});

describe('control proxy: lengths, sleeves and one-size', () => {
  it('takes the hem from the chart lengths and the sleeves from sleeve_length', () => {
    const aalter = buildProxy(m, mockGarment('aalter-studio-2'), 'M').spec;
    expect(aalter.lengthSource).toMatch(/shoulder_to_hem 112/);
    expect(aalter.lengthCm).toBe(112);
    expect(aalter.lengthDefinition).toBe('hps_surface');
    expect(m.landmarks.hps[1] - aalter.hemY).toBeLessThan(112);
    expect(aalter.sleeveCm).toBeGreaterThan(50);
    const [pants, size] = product('rosewater-palazzo-pants');
    const palazzo = buildProxy(m, pants, size).spec;
    expect(palazzo.lengthSource).toMatch(/outseam 99/);
    expect(palazzo.notes.join(' ')).toMatch(/wide leg/);
    const [skirt, s2] = product('crimson-wildflower-maxi-skirt');
    expect(buildProxy(m, skirt, s2).spec.lengthSource).toMatch(/maxi/);
    const [cardi, s3] = product('woodstock-wanderer-knit-cardi');
    expect(buildProxy(m, cardi, s3).spec.sleeveSource).toMatch(/outerwear default/);
  });

  it('builds a one-size garment from its flat measurements (garment chart) and raises a girth below the body', () => {
    const base = mockGarment('monochrome-03');
    const oneSize: GarmentPayload = { ...base, sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 124 }] };
    const { spec, mesh } = buildProxy(m, oneSize, 'ONE');
    expect(spec.girths.chest).toBe(124);
    expect(spec.girthSource.chest).toBe('garment chart');
    expect(spec.notes.join(' ')).toMatch(/one size/);
    expect(Math.abs(measureRing(mesh, m.rings.find((r) => r.id === 'chest')!)!.circumferenceCm - 124)).toBeLessThan(1);
    const tight = buildProxy(m, { ...oneSize, sizeChart: [{ size: 'ONE', bust: 80 }] }, 'ONE').spec;
    expect(tight.girths.chest).toBe(m.shape.rings.chest.circumferenceCm + MIN_CLEARANCE_CM);
    expect(tight.girthSource.chest).toBe('raised to clear the mannequin');
  });
});
