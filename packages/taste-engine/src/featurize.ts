/**
 * featurize(garment) — taste-engine-spec.md §featurize.
 */
import type { GarmentCategory } from '@paskamer/schema';
import { hueBin } from './colour';
import { AXES, type Axis, type AxisVector, type FeaturizableGarment, type ItemFeatures, type Silhouette } from './types';
import { clamp, zeroAxes } from './util';

type AxisWeights = Readonly<Partial<AxisVector>>;

/** patternBlock → axis contributions (spec table). Unknown blocks contribute nothing. */
export const PATTERN_BLOCK_AXES: Readonly<Record<string, AxisWeights>> = Object.freeze({
  wrap: { bohemian: 0.5, classic: 0.3 },
  'a-line': { classic: 0.4, bohemian: 0.2 },
  sheath: { classic: 0.5, minimal: 0.4 },
  column: { classic: 0.5, minimal: 0.4 },
  bodycon: { avantGarde: 0.2, sporty: 0.2 },
  bias: { minimal: 0.5, classic: 0.2 },
  oversized: { avantGarde: 0.4, minimal: 0.3 },
  boxy: { avantGarde: 0.4, minimal: 0.3 },
  straight: { classic: 0.4, minimal: 0.3 },
  'wide-leg': { bohemian: 0.3, avantGarde: 0.2 },
  skinny: { sporty: 0.3 },
  shirt: { classic: 0.5, minimal: 0.2 },
  't-shirt': { sporty: 0.4, minimal: 0.3 },
  trapeze: { avantGarde: 0.4, bohemian: 0.2 },
  tent: { avantGarde: 0.4, bohemian: 0.2 },
});

/** fabric.primary → axis contributions (spec table). Unknown fabrics contribute nothing. */
export const FABRIC_AXES: Readonly<Record<string, AxisWeights>> = Object.freeze({
  linen: { bohemian: 0.4 },
  silk: { minimal: 0.3, classic: 0.2 },
  denim: { classic: 0.2, sporty: 0.3 },
  wool: { classic: 0.3 },
  cashmere: { classic: 0.3, minimal: 0.2 },
  tencel: { minimal: 0.3 },
  modal: { minimal: 0.3 },
  cotton: { sporty: 0.1, minimal: 0.1 },
  jersey: { sporty: 0.4 },
  technical: { sporty: 0.6 },
  leather: { avantGarde: 0.3 },
});

/**
 * Category default ease for bust/waist/hip (fit-engine-spec.md §Step 2 `CATEGORY_EASE`),
 * used when the garment's `ease` omits a point. Shoes/accessories have no girth ease.
 */
export const CATEGORY_EASE: Readonly<Record<GarmentCategory, Readonly<{ bust?: number; waist?: number; hip?: number }>>> =
  Object.freeze({
    top: { bust: 8, waist: 8, hip: 6 },
    dress: { bust: 6, waist: 4, hip: 6 },
    bottom: { waist: 2, hip: 5 },
    outerwear: { bust: 12, waist: 12, hip: 10 },
    shoes: {},
    accessory: {},
  });

/** Σ of bust/waist/hip ease (garment value, else category default, else 0). */
export function easeTotal(g: Pick<FeaturizableGarment, 'category' | 'ease'>): number {
  const defaults = CATEGORY_EASE[g.category] ?? {};
  let total = 0;
  for (const p of ['bust', 'waist', 'hip'] as const) total += g.ease?.[p] ?? defaults[p] ?? 0;
  return total;
}

/** <6 fitted, 6–14 regular, 15–24 relaxed, >24 oversized (the gaps 14–15 / 24–25 round down). */
export function silhouetteFromEase(total: number): Silhouette {
  if (total < 6) return 'fitted';
  if (total < 15) return 'regular';
  if (total <= 24) return 'relaxed';
  return 'oversized';
}

function hasStyleTags(tags: FeaturizableGarment['styleTags']): tags is NonNullable<FeaturizableGarment['styleTags']> {
  return !!tags && AXES.some((a) => typeof tags[a] === 'number');
}

/** Axis vector for a garment: merchant styleTags when present, else the block + fabric tables, clamped to [0,1]. */
export function axesOf(g: Pick<FeaturizableGarment, 'patternBlock' | 'fabric' | 'styleTags'>): AxisVector {
  const out = zeroAxes();
  if (hasStyleTags(g.styleTags)) {
    for (const a of AXES) out[a] = clamp(g.styleTags[a] ?? 0, 0, 1);
    return out;
  }
  const block = PATTERN_BLOCK_AXES[g.patternBlock] ?? {};
  const fabric = FABRIC_AXES[g.fabric.primary] ?? {};
  for (const a of AXES) out[a] = clamp(round((block[a] ?? 0) + (fabric[a] ?? 0)), 0, 1);
  return out;
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function featurize(g: FeaturizableGarment): ItemFeatures {
  return {
    axes: axesOf(g),
    silhouette: silhouetteFromEase(easeTotal(g)),
    hue: hueBin(g.primaryColorHex),
    fabric: g.fabric.primary,
    cut: g.patternBlock,
    priceEur: g.priceEur,
  };
}

/**
 * styleMatch(axes, v) = Σ axes[a]·v[a] / Σ v[a] — 0..1, 0.5 is neutral, Σv = 0 → 0.5.
 */
export function styleMatch(axes: Readonly<AxisVector>, v: Readonly<Partial<AxisVector>>): number {
  let num = 0;
  let den = 0;
  for (const a of AXES as readonly Axis[]) {
    const w = v[a] ?? 0;
    if (w <= 0) continue;
    num += axes[a] * w;
    den += w;
  }
  return den === 0 ? 0.5 : num / den;
}
