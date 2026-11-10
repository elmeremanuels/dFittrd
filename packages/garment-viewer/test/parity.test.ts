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
import { LOOSE_TOP_PIN_CM, pinLoosePieces } from '../src/engine';
import { LOOSE_TOP_PIN_CM as SPIKE_LOOSE_TOP_PIN_CM, pinLoosePieces as spikePinLoosePieces, anchorLoops as spikeAnchorLoops, bandFor as spikeBandFor, drapeOptionsFrom as spikeDrapeOptionsFrom, DEFAULT_DRAPE as SPIKE_DEFAULT_DRAPE } from '../../../spikes/garment-engine/viewer/src/engine';
import { anchorLoops, bandFor, drapeOptionsFrom, DEFAULT_DRAPE } from '../src/engine';
import { clothParams } from '../src/cloth';
import { clothParams as spikeClothParams } from '../../../spikes/garment-engine/viewer/src/cloth';

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
  it('pins loose pieces the same way (sleeves, and the unsewn leg tubes of a bottom at their top)', () => {
    expect(LOOSE_TOP_PIN_CM).toBe(SPIKE_LOOSE_TOP_PIN_CM);
    // Two tubes of the synthetic dress's mesh cut apart: the largest piece and one loose piece.
    const n = mesh.positions.length / 3;
    const cut = Array.from(mesh.indices).filter((_, k, a) => {
      const t = k - (k % 3);
      const y = (mesh.positions[3 * a[t]! + 1]! + mesh.positions[3 * a[t + 1]! + 1]! + mesh.positions[3 * a[t + 2]! + 1]!) / 3;
      return y < 90 || y > 92;
    });
    for (const bottom of [false, true]) {
      const a = new Uint8Array(n), b = new Uint8Array(n);
      expect(pinLoosePieces(m, mesh.positions, cut, a, mesh.positions, undefined, bottom)).toBe(spikePinLoosePieces(m, mesh.positions, cut, b, mesh.positions, undefined, bottom));
      expect(a).toEqual(b);
    }
  });
  it('has the same step-3 drape controls (cling switch, girth loops, band grading, options)', () => {
    const mat = { drape: 0.85, bendStiffness: 0.04, stretchPct: 1.5, simulation: { damping: 0.035 } };
    for (const cling of [true, false]) expect(clothParams(mat, 1.5, { cling })).toEqual(spikeClothParams(mat, 1.5, { cling }));
    expect(DEFAULT_DRAPE).toEqual(SPIKE_DEFAULT_DRAPE);
    const q = new URLSearchParams('cling=0&loops=0.95&rings=hip&band=72:97');
    expect(drapeOptionsFrom((k) => q.get(k))).toEqual(spikeDrapeOptionsFrom((k) => q.get(k)));
    const chains = assignChains(m, mesh);
    const pins = new Uint8Array(chains.length);
    for (const { size } of grading.sizes) {
      const g = applyGrading(m, mesh, chains, grading, size);
      expect(anchorLoops(m, g.positions, g.indices, chains, pins, 1)).toEqual(spikeAnchorLoops(m, g.positions, g.indices, chains, pins, 1));
      const spec = { relaxedCm: 72, stretchedCm: 97, assumed: true };
      expect(bandFor(spec, grading, size)).toEqual(spikeBandFor(spec, grading, size));
    }
  });
});
