import { GARMENT_SCHEMA_VERSION, type GarmentPayload, type SizeRow } from '../garment';

type Grade = Partial<Omit<SizeRow, 'size'>>;

/** Graded size chart: `base` is the first size, every next size adds `step` (linear grading, as real charts do). */
export function grade(sizes: readonly string[], base: Grade, step: Grade): SizeRow[] {
  return sizes.map((size, i) => {
    const row: SizeRow = { size };
    for (const key of Object.keys(base) as (keyof Grade)[]) {
      const b = base[key];
      const s = step[key] ?? 0;
      if (b !== undefined) row[key] = Math.round((b + s * i) * 10) / 10;
    }
    return row;
  });
}

const PH = 'https://placehold.co';

/** Product photo placeholder, cream background (handoff §7 tokens). */
export function productPhoto(label: string, n = 1): string {
  return `${PH}/800x1000/F5EFE7/1A1612.png?text=${encodeURIComponent(`${label} ${n}`)}`;
}

/** Flat-lay placeholder: garment on white. */
export function flatLay(id: string): string {
  return `${PH}/1000x1000/FFFFFF/1A1612.png?text=${encodeURIComponent(`flat-lay ${id}`)}`;
}

export type GarmentSeed = Omit<GarmentPayload, 'schemaVersion' | 'productPhotos' | 'flatLayPhoto'> &
  Partial<Pick<GarmentPayload, 'productPhotos' | 'flatLayPhoto'>>;

/** Fill `schemaVersion`, product photos and flat-lay placeholders. */
export function garment(seed: GarmentSeed): GarmentPayload {
  return {
    schemaVersion: GARMENT_SCHEMA_VERSION,
    ...seed,
    productPhotos: seed.productPhotos ?? [productPhoto(seed.name, 1), productPhoto(seed.name, 2)],
    flatLayPhoto: seed.flatLayPhoto ?? flatLay(seed.id),
  };
}

export const XS_XL = ['XS', 'S', 'M', 'L', 'XL'] as const;
export const XS_L = ['XS', 'S', 'M', 'L'] as const;
export const S_XL = ['S', 'M', 'L', 'XL'] as const;
export const EU_34_44 = ['34', '36', '38', '40', '42', '44'] as const;
