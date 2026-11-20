import { describe, expect, it } from 'vitest';
import {
  drapeWord,
  easeWord,
  fabricPhrase,
  fitGapPhrase,
  motionPromptFromMetadata,
  opacityWord,
  promptFromMetadata,
  sheenWord,
} from './promptFromMetadata.js';
import type { GarmentInput } from './types.js';

describe('word mappers', () => {
  it('drapeWord covers the 0–1 scale and clamps', () => {
    expect(drapeWord(0)).toBe('stiff, structured');
    expect(drapeWord(0.3)).toBe('crisp');
    expect(drapeWord(0.5)).toBe('soft');
    expect(drapeWord(0.78)).toBe('fluid');
    expect(drapeWord(1)).toBe('very fluid, liquid');
    expect(drapeWord(7)).toBe('very fluid, liquid');
    expect(drapeWord(Number.NaN)).toBe('stiff, structured');
  });

  it('sheenWord and opacityWord', () => {
    expect(sheenWord(0.15)).toBe('matte');
    expect(sheenWord(0.5)).toBe('soft sheen');
    expect(sheenWord(0.95)).toBe('high-gloss');
    expect(opacityWord(0.1)).toBe('sheer');
    expect(opacityWord(0.5)).toBe('semi-sheer');
    expect(opacityWord(0.92)).toBe('opaque');
  });

  it('easeWord reads the garment-minus-body gap in cm', () => {
    expect(easeWord(-6)).toBe('very tight, pulling');
    expect(easeWord(-2)).toBe('tight');
    expect(easeWord(0)).toBe('close-fitting');
    expect(easeWord(3)).toBe('true to size');
    expect(easeWord(6)).toBe('relaxed');
    expect(easeWord(10)).toBe('loose');
    expect(easeWord(20)).toBe('oversized');
    expect(easeWord(Number.NaN)).toBe('true to size');
  });
});

const garment: GarmentInput = {
  id: 'g1',
  category: 'dress',
  patternBlock: 'wrap',
  primaryColorHex: '#C97A4F',
  fabric: { primary: 'linen', weightGsm: 240, stretchPct: 2, drape: 0.78, opacity: 0.92, sheen: 0.15 },
  size: 'M',
  fitGapCm: { bust: 1, waist: 4, hip: 9 },
};

describe('promptFromMetadata', () => {
  it('builds the documented sentence from the merchant payload and fit result', () => {
    const p = promptFromMetadata(garment);
    expect(p).toBe(
      'wrap dress, 240 gsm linen, fluid drape, matte, opaque, non-stretch woven, colour #C97A4F, ' +
        'size M fitting close-fitting at the bust, relaxed at the waist, loose at the hip. ' +
        "Keep the person's face, body proportions and pose exactly as shown.",
    );
  });

  it('degrades gracefully without optional fields', () => {
    expect(promptFromMetadata({ id: 'x', category: 'top' })).toBe(
      "top. Keep the person's face, body proportions and pose exactly as shown.",
    );
    expect(promptFromMetadata({ id: 'x', category: 'top', size: 'L' })).toContain('size L.');
    expect(promptFromMetadata({ id: 'x', category: 'top', fitGapCm: { shoulder: -3 } })).toContain('fitting tight at the shoulder');
  });

  it('fabricPhrase / fitGapPhrase only mention measured values, in fixed order', () => {
    expect(fabricPhrase({ primary: 'silk', sheen: 0.8, stretchPct: 20 })).toBe('silk, glossy, stretchy jersey-like');
    expect(fabricPhrase(undefined)).toBe('');
    expect(fitGapPhrase({ hip: 2, bust: -2 })).toBe('tight at the bust, true to size at the hip');
    expect(fitGapPhrase(undefined)).toBe('');
  });

  it('motionPromptFromMetadata uses drape to pick the motion wording', () => {
    expect(motionPromptFromMetadata(garment)).toContain('fabric sways and settles naturally');
    expect(motionPromptFromMetadata({ ...garment, fabric: { primary: 'denim', drape: 0.2 } })).toContain('holds its shape');
    expect(motionPromptFromMetadata({ id: 'x', category: 'top' })).toContain('top. Static camera');
  });
});
