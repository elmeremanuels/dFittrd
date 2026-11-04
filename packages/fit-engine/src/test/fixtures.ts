/** Test fixtures named in fit-engine-spec.md §Test vectors. */
import type { UserBody } from '@paskamer/schema';
import type { FitGarment } from '../types';

/** Handoff §3.1 wrap dress (= MOCK_GARMENTS 'aalter-studio-1'). */
export const WRAP: FitGarment = {
  id: 'aalter-studio-1',
  brand: 'Aalter Studio',
  category: 'dress',
  patternBlock: 'wrap',
  fabric: { primary: 'linen', stretchPct: 2, drape: 0.78 },
  ease: { bust: 6, waist: 4, hip: 8 },
  sizeChartType: 'body',
  sizeChart: [
    { size: 'XS', bust: 84, waist: 64, hip: 92, shoulder: 36 },
    { size: 'S', bust: 88, waist: 68, hip: 96, shoulder: 37 },
    { size: 'M', bust: 92, waist: 72, hip: 100, shoulder: 38 },
    { size: 'L', bust: 96, waist: 76, hip: 104, shoulder: 39 },
  ],
  sizingNotes: 'runs small',
  trueToSizeScore: 0.92,
  criticalFitPoints: ['bust', 'shoulder'],
  stretchZones: ['waist-tie'],
};

export const REF: UserBody = {
  measurements: { bust: 88, waist: 70, hip: 96, shoulder: 38 },
  confidence: { bust: 0.95, waist: 0.95, hip: 0.95, shoulder: 0.6 },
};

/** Silk slip top on the bias (= MOCK_GARMENTS 'monochrome-02'). */
export const SLIP: FitGarment = {
  id: 'monochrome-02',
  brand: 'Monochrome',
  category: 'top',
  patternBlock: 'bias',
  fabric: { primary: 'silk', stretchPct: 0, drape: 0.95 },
  ease: { bust: 4, hip: 4 },
  sizeChartType: 'body',
  sizeChart: [
    { size: 'XS', bust: 80, waist: 60, hip: 88 },
    { size: 'S', bust: 84, waist: 64, hip: 92 },
    { size: 'M', bust: 88, waist: 68, hip: 96 },
  ],
  sizingNotes: 'true to size',
  trueToSizeScore: 0.8,
  criticalFitPoints: ['bust'],
};

/** Raw denim straight jeans (= MOCK_GARMENTS 'raw-denim-01'). */
export const JEANS: FitGarment = {
  id: 'raw-denim-01',
  brand: 'Indigo',
  category: 'bottom',
  patternBlock: 'straight',
  fabric: { primary: 'denim', stretchPct: 1, drape: 0.2 },
  ease: { waist: 2, hip: 5 },
  sizeChartType: 'body',
  sizeChart: [
    { size: '26', waist: 66, hip: 91 },
    { size: '27', waist: 68.5, hip: 93.5 },
    { size: '28', waist: 71, hip: 96 },
  ],
  sizingNotes: 'raw denim relaxes ~1 cm at the waist with wear',
  trueToSizeScore: 0.85,
  criticalFitPoints: ['waist'],
};

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Deterministic PRNG for property tests (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
