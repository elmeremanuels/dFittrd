/**
 * The fork in src/core must behave exactly like the spike it was copied from until the spike is
 * promoted (docs/STATUS.md, claude/plugin-v1). Test-only imports of the spike.
 */
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape, buildMannequin } from '@curtain/mannequin';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { assignChains as spikeChains } from '../../../spikes/garment-engine/src/garment';
import { applyGrading as spikeGrading, type GradingJson } from '../../../spikes/garment-engine/src/grading';
import { topEdgePlane as spikeTopEdge } from '../../../spikes/garment-engine/src/waistband';
import { weldWithRemap as spikeWeld } from '../../../spikes/garment-engine/src/evalMesh';
import { assignChains } from '../src/core/garment';
import { applyGrading } from '../src/core/grading';
import { topEdgePlane } from '../src/core/waistband';
import { weldWithRemap } from '../src/core/weld';
import { meshFromGlb } from '../src/bundle';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const b = buildBundle('aalter-studio-2', { skipSeparation: true });
const mesh = meshFromGlb(b.files['base.glb']);
const grading = JSON.parse(b.files['grading.json']) as GradingJson;

describe('fork parity with spikes/garment-engine', () => {
  it('assigns the same chains and grades every size identically', () => {
    const chains = assignChains(m, mesh);
    expect(chains).toEqual(spikeChains(m, mesh));
    for (const { size } of grading.sizes) expect(applyGrading(m, mesh, chains, grading, size).positions).toEqual(spikeGrading(m, mesh, chains, grading, size).positions);
  });
  it('finds the same top edge and welds the same way', () => {
    expect(topEdgePlane(mesh)).toEqual(spikeTopEdge(mesh));
    expect(weldWithRemap(mesh).remap).toEqual(spikeWeld(mesh).remap);
  });
});
