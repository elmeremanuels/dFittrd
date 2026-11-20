/**
 * Size advice readiness — the one predicate for "can a shopper get a size for this product?" in the
 * standalone plugin (D11, D17: size advice without the 3D engine).
 *
 * The full GarmentPayload also carries what the render and the taste engine need (price, colour,
 * pattern block, fabric, flat-lay). None of that is needed to recommend a size: the fit engine reads
 * the category, the chart and its type, and falls back to category defaults for the block and to
 * 0 % stretch for the fabric. So a product is try-able as soon as these three fields are valid, and
 * the rest is filled with documented defaults. The try route (`GET /v1/try/:token`), the stored
 * product status and the admin checklist all use this module, so they can never disagree.
 */
import { completenessScore, type MissingField } from './completeness';
import { GARMENT_SCHEMA_VERSION, GarmentPayloadSchema, type Fabric, type GarmentPayload } from './garment';

/** The fields a product needs before the plugin can recommend a size. */
export const SIZE_ADVICE_FIELDS = ['category', 'sizeChartType', 'sizeChart'] as const;
export type SizeAdviceField = (typeof SIZE_ADVICE_FIELDS)[number];

/**
 * Defaults for the fields size advice does not read. The pattern block is not a known block, so the
 * fit engine uses its category defaults; the fabric is a non-stretch woven, the cautious choice
 * (a stretch fabric would allow a tighter size).
 */
export const SIZE_ADVICE_DEFAULTS = Object.freeze({
  priceEur: 0,
  primaryColorHex: '#8A8178',
  patternBlock: 'unspecified',
  fabric: Object.freeze({ primary: 'woven', stretchPct: 0, drape: 0.5 }) as Readonly<Fabric>,
});

export interface SizeAdviceOptions {
  /** Colour for the product swatch when the product has none (e.g. the shop's brand colour). */
  colorHex?: string;
}

export type SizeAdviceResult =
  | { ok: true; garment: GarmentPayload; /** Payload paths filled with a default. */ defaulted: string[] }
  | { ok: false; missing: MissingField[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Resolve a stored (possibly partial) product into a garment the embed can size. Present fields are
 * kept as they are and must be valid; absent fields outside `SIZE_ADVICE_FIELDS` get a default.
 */
export function sizeAdviceGarment(draft: unknown, opts: SizeAdviceOptions = {}): SizeAdviceResult {
  const g = isObject(draft) ? draft : {};
  const required = new Set<string>(SIZE_ADVICE_FIELDS);
  const missing = completenessScore(g).missing.filter((m) => required.has(m.field));
  if (missing.length) return { ok: false, missing };

  const defaulted: string[] = [];
  const out: Record<string, unknown> = { ...g, schemaVersion: GARMENT_SCHEMA_VERSION };
  if (typeof g.priceEur !== 'number') {
    out.priceEur = SIZE_ADVICE_DEFAULTS.priceEur;
    defaulted.push('priceEur');
  }
  if (typeof g.primaryColorHex !== 'string' || !HEX.test(g.primaryColorHex)) {
    out.primaryColorHex = opts.colorHex && HEX.test(opts.colorHex) ? opts.colorHex : SIZE_ADVICE_DEFAULTS.primaryColorHex;
    defaulted.push('primaryColorHex');
  }
  if (typeof g.patternBlock !== 'string' || !g.patternBlock.trim()) {
    out.patternBlock = SIZE_ADVICE_DEFAULTS.patternBlock;
    defaulted.push('patternBlock');
  }
  const fabric = isObject(g.fabric) ? g.fabric : {};
  const base = SIZE_ADVICE_DEFAULTS.fabric;
  const mergedFabric: Record<string, unknown> = { ...fabric };
  for (const key of ['primary', 'stretchPct', 'drape'] as const) {
    const v = fabric[key];
    const present = key === 'primary' ? typeof v === 'string' && v.trim().length > 0 : typeof v === 'number' && Number.isFinite(v);
    if (!present) {
      mergedFabric[key] = base[key];
      defaulted.push(`fabric.${key}`);
    }
  }
  out.fabric = mergedFabric;

  const parsed = GarmentPayloadSchema.safeParse(out);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join('.') || '(root)';
    return { ok: false, missing: [{ field, reason: `invalid value${first ? `: ${first.message}` : ''}`, weight: 3, severity: 'heavy' }] };
  }
  return { ok: true, garment: parsed.data, defaulted };
}

/** True when `sizeAdviceGarment` resolves: the product can be sized in the embed. */
export function isSizeAdviceReady(draft: unknown): boolean {
  return sizeAdviceGarment(draft).ok;
}
