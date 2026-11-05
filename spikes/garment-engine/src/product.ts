/**
 * From a `@curtain/schema` garment payload to what the pipeline uses: the size chart re-keyed by
 * anchor id as garment girths, the synthetic garment spec at the base size, and material.json from
 * the fabric library.
 */
import { FIT_POINT_TO_ANCHOR, type AnchorRing } from '@curtain/anchors';
import { FABRIC_LIBRARY_VERSION, duplicateSizeLabels, isFabricConstructionId, lookupFabricId, mockGarment, resolveFabric, sizeLabelKey, type GarmentPayload } from '@curtain/schema';
import type { GarmentSpec, SpikeCategory } from './garment';

/** The two Phase 0 spike products from the schema fixtures: a long-sleeved shirt dress (body chart) and a T-shirt (garment chart). */
export const SPIKE_PRODUCT_IDS = ['aalter-studio-2', 'monochrome-03'] as const;

/**
 * Fallback ease per category (cm) for a body chart whose product gives none for a point. Same
 * numbers as the fit engine's category defaults (`packages/fit-engine/src/constants.ts`).
 */
export const CATEGORY_DEFAULT_EASE: Readonly<Record<SpikeCategory, Partial<Record<'bust' | 'waist' | 'hip', number>>>> = {
  dress: { bust: 6, waist: 4, hip: 6 },
  top: { bust: 8, waist: 8, hip: 6 },
};

/** Girth points of the chart that are anchor rings. `shoulder` is a width in charts, not the shoulder ring girth, so it is not used as a girth. */
const GIRTH_POINTS = ['bust', 'waist', 'hip'] as const;

export interface ChartRow {
  size: string;
  /** Garment girths per ring, cm. */
  rings: Partial<Record<AnchorRing, number>>;
  /** Rings whose value is body + the category default ease (no product ease given). */
  defaultEase: AnchorRing[];
}

export interface GarmentChart {
  productId: string;
  category: SpikeCategory;
  type: 'body' | 'garment';
  rows: ChartRow[];
}

/** The size chart as garment girths per anchor ring. Throws on duplicate size labels (finding #2). */
export function garmentChart(p: GarmentPayload): GarmentChart {
  if (p.category !== 'dress' && p.category !== 'top') throw new Error(`spike supports dress and top, not ${p.category}`);
  const dup = duplicateSizeLabels(p.sizeChart);
  if (dup.length > 0) throw new Error(`duplicate size labels: ${dup.join(', ')}`);
  const category = p.category;
  const type = p.sizeChartType === 'garment' ? 'garment' : 'body';
  const rows = p.sizeChart.map((row) => {
    const rings: Partial<Record<AnchorRing, number>> = {};
    const defaultEase: AnchorRing[] = [];
    for (const point of GIRTH_POINTS) {
      const v = row[point];
      if (v === undefined) continue;
      const anchor = FIT_POINT_TO_ANCHOR[point] as AnchorRing;
      if (type === 'garment') rings[anchor] = v;
      else {
        const productEase = p.ease?.[point];
        if (productEase === undefined) defaultEase.push(anchor);
        rings[anchor] = v + (productEase ?? CATEGORY_DEFAULT_EASE[category][point] ?? 0);
      }
    }
    return { size: row.size, rings, defaultEase };
  });
  return { productId: p.id, category, type, rows };
}

export function chartRow(chart: GarmentChart, size: string): ChartRow {
  const row = chart.rows.find((r) => sizeLabelKey(r.size) === sizeLabelKey(size));
  if (!row) throw new Error(`size ${size} not in the chart of ${chart.productId}`);
  return row;
}

/** Synthetic garment spec at the base size. */
export function garmentSpec(p: GarmentPayload, baseSize = 'M'): GarmentSpec {
  const chart = garmentChart(p);
  const base = chartRow(chart, baseSize);
  const len = p.lengthCm ?? {};
  return {
    id: p.id,
    name: p.name,
    category: chart.category,
    colorHex: p.primaryColorHex,
    baseSize,
    rings: base.rings,
    shoulderToHemCm: len.shoulder_to_hem ?? (chart.category === 'dress' ? 105 : 64),
    sleeveCm: len.sleeve_length ?? 0,
    hemFlare: chart.category === 'dress' ? (p.patternBlock === 'a-line' ? 1.25 : 1.1) : 1,
  };
}

export function spikeProduct(id: (typeof SPIKE_PRODUCT_IDS)[number]): GarmentPayload {
  return mockGarment(id);
}

export interface MaterialJson {
  format: 'curtain.garment.material';
  formatVersion: 1;
  productId: string;
  fabricLibraryVersion: string;
  baseColorHex: string;
  fibres: { id: string; pct: number }[];
  construction: string | null;
  weightGsm: number;
  stretchPct: number;
  drape: number;
  bendStiffness: number;
  sheen: number;
  opacity: number;
  texture: string;
  simulation: Record<string, number>;
  provenance: Record<string, string>;
  unknownFibres: string[];
}

/** material.json: the product's fabric resolved through the `@curtain/schema` fabric library (stage 7 input). */
export function materialJson(p: GarmentPayload): MaterialJson {
  const f = p.fabric;
  // `primary` may name the construction ("denim") while `blend` holds the fibres (R3): keep it.
  const primaryId = lookupFabricId(f.primary);
  const r = resolveFabric({
    composition: (f.blend ?? [[f.primary, 100]]).map(([fibre, pct]) => ({ fibre, pct })),
    ...(primaryId && isFabricConstructionId(primaryId) ? { construction: primaryId } : {}),
    ...(f.weightGsm !== undefined ? { weightGsm: f.weightGsm } : {}),
    stretchPct: f.stretchPct,
    drape: f.drape,
    ...(f.sheen !== undefined ? { sheen: f.sheen } : {}),
    ...(f.opacity !== undefined ? { opacity: f.opacity } : {}),
  });
  return {
    format: 'curtain.garment.material',
    formatVersion: 1,
    productId: p.id,
    fabricLibraryVersion: FABRIC_LIBRARY_VERSION,
    baseColorHex: p.primaryColorHex,
    fibres: r.fibres,
    construction: r.construction ?? null,
    weightGsm: r.weightGsm,
    stretchPct: r.stretchPct,
    drape: r.drape,
    bendStiffness: r.bendStiffness,
    sheen: r.sheen,
    opacity: r.opacity,
    texture: r.texture,
    simulation: { ...r.simulation },
    provenance: { ...r.provenance },
    unknownFibres: r.unknown,
  };
}
