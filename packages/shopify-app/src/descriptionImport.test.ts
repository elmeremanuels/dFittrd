import { describe, expect, it } from 'vitest';
import { descriptionLines, fabricStatement, oneSizeLabel, parseDescriptionMeasurements, proposeFromDescription } from './descriptionImport';

const oneSize = { options: [{ name: 'Size', optionValues: [{ name: 'One Size' }] }] };
const multi = { options: [{ name: 'Size', optionValues: [{ name: '8' }, { name: '10' }, { name: '12' }] }] };

describe('description text', () => {
  it('turns HTML into lines and decodes entities', () => {
    expect(descriptionLines('<p>Bust&nbsp;120cm<br>Length 95cm</p><ul><li>100% rayon</li></ul><script>x()</script>')).toEqual(['Bust 120cm', 'Length 95cm', '100% rayon']);
    expect(descriptionLines(null)).toEqual([]);
  });

  it('reads circumferences, flat widths (doubled), inches, ranges and lengths', () => {
    expect(parseDescriptionMeasurements('Bust: 120cm, Waist 110 cm. Length 95cm')).toEqual([
      { point: 'bust', cm: 120, doubled: false, fitsBody: false, evidence: 'Bust: 120cm,' },
      { point: 'waist', cm: 110, doubled: false, fitsBody: false, evidence: 'Waist 110 cm.' },
      { point: 'length', cm: 95, doubled: false, fitsBody: false, evidence: 'Length 95cm' },
    ]);
    const flat = parseDescriptionMeasurements('Measurements laid flat: pit to pit 56cm, length 70cm');
    expect(flat.find((m) => m.point === 'bust')).toMatchObject({ cm: 112, doubled: true });
    expect(flat.find((m) => m.point === 'length')).toMatchObject({ cm: 70, doubled: false });
    expect(parseDescriptionMeasurements('Chest 44 inches')[0]).toMatchObject({ point: 'bust', cm: 112 });
    expect(parseDescriptionMeasurements('Hips 120-130cm circumference')[0]).toMatchObject({ point: 'hip', cm: 125, doubled: false });
  });

  it('keeps a flat cue with its own measurement only', () => {
    const r = parseDescriptionMeasurements('Chest laid flat 55cm, Waist 100cm');
    expect(r.map((m) => [m.point, m.cm, m.doubled])).toEqual([
      ['bust', 110, true],
      ['waist', 100, false],
    ]);
  });

  it('marks "fits up to" as the body it fits, and ignores implausible numbers', () => {
    expect(parseDescriptionMeasurements('Fits bust up to 120cm')[0]).toMatchObject({ point: 'bust', fitsBody: true });
    expect(parseDescriptionMeasurements('Bust 5cm wide trim')).toEqual([]);
  });

  it('finds the fabric sentence, skipping styling advice', () => {
    expect(fabricStatement(['Pair it with denim shorts for summer.', 'Made from soft rayon with a little stretch.'])).toBe('Made from soft rayon with a little stretch.');
    expect(fabricStatement(['Fabric: 95% cotton, 5% elastane'])).toBe('95% cotton, 5% elastane');
    expect(fabricStatement(['A lovely dress.'])).toBeUndefined();
  });
});

describe('one size detection', () => {
  it('reads the size option or the default variant', () => {
    expect(oneSizeLabel(oneSize)).toEqual({ oneSize: true, label: 'ONE' });
    expect(oneSizeLabel({ options: [{ name: 'Size', optionValues: [{ name: 'S-M' }] }] })).toEqual({ oneSize: true, label: 'S-M' });
    expect(oneSizeLabel(multi)).toEqual({ oneSize: false, label: null });
    expect(oneSizeLabel({ options: [{ name: 'Title', optionValues: [{ name: 'Default Title' }] }] })).toEqual({ oneSize: true, label: 'ONE' });
    expect(oneSizeLabel({ options: [{ name: 'Colour', optionValues: [{ name: 'Red' }, { name: 'Blue' }] }] })).toEqual({ oneSize: false, label: null });
  });
});

describe('proposeFromDescription', () => {
  it('proposes a one-size garment chart, a length and a fabric with evidence', () => {
    const p = proposeFromDescription({
      title: 'Boho kaftan',
      descriptionHtml: '<p>Our flowing kaftan is made from 100% rayon.</p><p>Bust 140cm circumference. Length 110cm.</p><p>Pair it with sandals.</p>',
      ...oneSize,
    });
    expect(p.oneSize).toBe(true);
    expect(p.proposal).toEqual({ sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }] });
    expect(p.lengthCm).toEqual({ shoulder_to_hem: 110 });
    expect(p.fabric?.primary).toBe('viscose');
    expect(p.fabric?.blend).toEqual([['viscose', 100]]);
    expect(p.fabricStatement).toBe('Our flowing kaftan is made from 100% rayon.');
    expect(p.evidence.some((e) => e.startsWith('bust:'))).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it('proposes a body chart for "fits up to" text', () => {
    const p = proposeFromDescription({ title: 'Wrap top', descriptionHtml: 'Fits bust up to 110cm', ...oneSize });
    expect(p.proposal?.sizeChartType).toBe('body');
    expect(p.warnings.join(' ')).toMatch(/body chart/);
  });

  it('never makes a chart for a multi-size product, but still proposes the fabric', () => {
    const p = proposeFromDescription({ title: 'Midi', descriptionHtml: 'Linen. Bust 96cm', ...multi });
    expect(p.proposal).toBeNull();
    expect(p.fabric?.primary).toBe('linen');
    expect(p.warnings[0]).toMatch(/several sizes/);
  });

  it('says so when a one-size description has no girth', () => {
    const p = proposeFromDescription({ title: 'Scarf', descriptionHtml: 'Length 180cm', ...oneSize });
    expect(p.proposal).toBeNull();
    expect(p.lengthCm).toEqual({ shoulder_to_hem: 180 });
    expect(p.warnings[0]).toMatch(/No bust, waist or hip/);
  });
});
