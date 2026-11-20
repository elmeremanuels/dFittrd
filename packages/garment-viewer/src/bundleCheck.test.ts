import { describe, expect, it } from 'vitest';
import { mockGarment } from '@curtain/schema';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { checkBundle, gradingLabel } from './bundleCheck';

const b = buildBundle('aalter-studio-2', { skipSeparation: true });
const meta = { anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa: JSON.parse(b.files['qa.json']) };
const garment = mockGarment('aalter-studio-2');

describe('checkBundle on the device', () => {
  it('accepts the bundle for its own product chart', () => {
    expect(checkBundle(meta, garment)?.sizes).toEqual(garment.sizeChart.map((r) => r.size));
  });
  it('falls back (null) when the live chart has a size the bundle has not graded', () => {
    expect(checkBundle(meta, { sizeChart: [...garment.sizeChart, { ...garment.sizeChart[0]!, size: 'XXXL' }] })).toBeNull();
  });
  it('maps shop labels onto grading labels by size key', () => {
    expect(gradingLabel(['S', 'M'], ' m ')).toBe('M');
    expect(gradingLabel(['S', 'M'], 'L')).toBeNull();
  });
});
