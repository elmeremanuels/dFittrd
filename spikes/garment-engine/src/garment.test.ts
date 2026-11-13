import { bodyShape, buildMannequin, topology } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { measureGarment, ringGirths } from './anchoring';
import { assignChains, distortGarment, generateGarment, mulberry32 } from './garment';
import { SPIKE_PRODUCT_IDS, chartRow, garmentChart, garmentSpec, materialJson, spikeProduct } from './product';

const m = buildMannequin(bodyShape('M'));

describe.each(SPIKE_PRODUCT_IDS)('synthetic garment %s', (id) => {
  const payload = spikeProduct(id);
  const spec = garmentSpec(payload);
  const mesh = generateGarment(m, spec);
  const meas = measureGarment(m, mesh, spec.category);

  it('has the chart girth of the base size at every chart ring', () => {
    const chart = chartRow(garmentChart(payload), 'M').rings;
    expect(Object.keys(chart).length).toBeGreaterThan(0);
    for (const [ring, cm] of Object.entries(chart)) expect(meas.rings[ring as keyof typeof meas.rings]!.circumferenceCm).toBeCloseTo(cm, 6);
  });

  it('sits outside the body at every ring it covers', () => {
    for (const r of Object.values(meas.rings)) if (r!.offsetCm) expect(r!.offsetCm.min, r!.id).toBeGreaterThan(0);
  });

  it('has the payload lengths', () => {
    expect(meas.lengths.shoulder_to_hem!.lengthCm).toBeCloseTo(spec.shoulderToHemCm, 6);
    expect(meas.lengths.sleeve!.lengthCm).toBeCloseTo(Math.min(spec.sleeveCm, m.morphHeights.wrist + 1.5), 6);
  });

  it('is an open, manifold, consistently oriented surface within the triangle budget', () => {
    const t = topology(mesh);
    expect(t.nonManifoldEdges).toBe(0);
    expect(t.inconsistentEdges).toBe(0);
    expect(t.boundaryEdges).toBeGreaterThan(0); // neckline, hem, sleeve openings
    expect(t.triangles).toBeLessThanOrEqual(15000);
  });

  it('assigns body and sleeve chains from geometry alone, matching the generator labels except around the armhole', () => {
    const chains = assignChains(m, mesh);
    let agree = 0;
    for (let i = 0; i < chains.length; i++) {
      const label = mesh.partNames[mesh.vertexPart[i]!];
      const expected = label === 'sleeve_l' ? 1 : label === 'sleeve_r' ? 2 : 0;
      if (expected === chains[i]) agree++;
      // Every vertex below the armpit level on the torso, and every sleeve vertex past the upper-arm ring, is right.
      else if (label === 'body') expect(mesh.positions[3 * i + 1]!).toBeGreaterThan(m.morphHeights.chest);
      else {
        const arm = label === 'sleeve_l' ? m.arms.left : m.arms.right;
        const p = [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!] as const;
        const s = (p[0] - arm.joint[0]) * arm.axis[0] + (p[1] - arm.joint[1]) * arm.axis[1] + (p[2] - arm.joint[2]) * arm.axis[2];
        expect(s).toBeLessThan(m.morphHeights.upper_arm); // only the sleeve cap, above the upper-arm ring
      }
    }
    expect(agree / chains.length).toBeGreaterThan(0.9); // the sleeve cap (above the armpit) follows the body by design
  });

  it('is deterministic', () => {
    expect(Array.from(generateGarment(m, spec).positions)).toEqual(Array.from(mesh.positions));
  });

  it('distortGarment applies the global scale and per-ring bias', () => {
    const truth = ringGirths(meas);
    const d = ringGirths(measureGarment(m, distortGarment(m, mesh, truth, { globalScale: 1.05, ringBiasCm: { chest: 2 }, noiseCm: 0, seed: 1 }), spec.category));
    expect(d.chest!).toBeCloseTo(truth.chest! * 1.05 + 2, 6);
    if (truth.waist) expect(d.waist!).toBeCloseTo(truth.waist * 1.05, 6);
  });
});

describe('product adapter', () => {
  it('turns a body chart into garment girths with the product ease (and flags the category default)', () => {
    const chart = garmentChart(spikeProduct('aalter-studio-2'));
    expect(chart.type).toBe('body');
    const m = chartRow(chart, 'M');
    expect(m.rings).toEqual({ chest: 90 + 10, waist: 72 + 12, hip: 98 + 6 });
    expect(m.defaultEase).toEqual(['hip']);
    // The chart's shoulder is a width (R1): the breadth shoulder_width with the product's shoulder ease.
    expect(m.breadths).toEqual({ shoulder_width: 38 + 1.5 });
    expect(m.defaultEaseBreadths).toEqual([]);
  });

  it('keeps a garment chart as is and maps bust → chest', () => {
    const chart = garmentChart(spikeProduct('monochrome-03'));
    expect(chart.type).toBe('garment');
    expect(chartRow(chart, 'm').rings).toEqual({ chest: 112 });
    expect(chartRow(chart, 'm').breadths).toEqual({ shoulder_width: 50 });
  });

  it('rejects duplicate size labels', () => {
    const p = spikeProduct('monochrome-03');
    expect(() => garmentChart({ ...p, sizeChart: [...p.sizeChart, { ...p.sizeChart[2]!, size: ' m ' }] })).toThrow(/duplicate/);
  });

  it('resolves material.json through the fabric library', () => {
    const mat = materialJson(spikeProduct('aalter-studio-2'));
    expect(mat.fibres).toEqual([{ id: 'cotton', pct: 100 }]);
    expect(mat.weightGsm).toBe(120);
    expect(mat.provenance.weightGsm).toBe('product');
    expect(mat.simulation).toBeTypeOf('object');
  });

  it('R3: a construction primary with a fibre blend keeps the construction (denim, not a cotton plain weave)', () => {
    const p = spikeProduct('aalter-studio-2');
    const denim = materialJson({ ...p, fabric: { primary: 'denim', blend: [['cotton', 99], ['elastane', 1]], stretchPct: 2, drape: 0.2 } });
    expect(denim.construction).toBe('denim');
    expect(denim.fibres).toEqual([{ id: 'cotton', pct: 99 }, { id: 'elastane', pct: 1 }]);
    expect(denim.bendStiffness).toBeGreaterThan(0.5);
    expect(denim.texture).not.toBe('plain-weave');
    // A fibre primary adds no construction.
    expect(materialJson({ ...p, fabric: { ...p.fabric, primary: 'cotton', blend: [['cotton', 100]] } }).construction).toBeNull();
  });

  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});
