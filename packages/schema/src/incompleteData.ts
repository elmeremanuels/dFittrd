/**
 * Incomplete product data (D24 point 4, D25 points 1 and 2; merchant-settings inventory row S1).
 *
 * A product may arrive with fabric details that are missing or not valid. Only that part is left
 * out; what the merchant entered and is valid (a name, a blend, a stretch value) is kept. What then
 * happens to the product is the shop's choice, `incompleteProductData`:
 *
 *  - `let-through` (the default): the product is stored and sized, and the answer lists what was
 *    assumed (`defaulted`) and what was left out (`leftOut`);
 *  - `hold-back`: the product is stored as not ready, with the reason, until the merchant completes
 *    it. It is still stored (HTTP 200), so a chart fix in the same save is kept and the data that
 *    was live before does not stay live.
 *
 * "Incomplete" means: the fabric stretch is not known (missing, or left out because it was not
 * valid) on a product that is not an accessory, or any fabric value had to be left out. A missing
 * drape alone is not incomplete. Category, chart type and chart stay required under both choices
 * (`sizeAdviceGarment`).
 */
import { z } from 'zod';
import { FabricSchema } from './garment';

export const INCOMPLETE_PRODUCT_DATA_POLICIES = ['let-through', 'hold-back'] as const;
export type IncompleteProductDataPolicy = (typeof INCOMPLETE_PRODUCT_DATA_POLICIES)[number];
export const DEFAULT_INCOMPLETE_PRODUCT_DATA: IncompleteProductDataPolicy = 'let-through';
export const IncompleteProductDataSchema = z.enum(INCOMPLETE_PRODUCT_DATA_POLICIES);

/** A value that was present but not valid, and was left out of the stored product. */
export const LeftOutValueSchema = z.object({
  /** Dotted payload path, e.g. `fabric.stretchPct`. */
  field: z.string(),
  /** Why the value was not valid (the validator's message, English). The value itself is not echoed. */
  reason: z.string(),
});
export type LeftOutValue = z.infer<typeof LeftOutValueSchema>;

/** What the server did with incomplete data on an upsert. Both lists are empty for a complete product. */
export const ProductNoticesSchema = z.object({
  /** Payload paths size advice fills with a default (`sizeAdviceGarment`'s `defaulted`), e.g. `fabric.stretchPct` (0 % assumed). Empty while the product cannot be sized. */
  defaulted: z.array(z.string()),
  leftOut: z.array(LeftOutValueSchema),
});
export type ProductNotices = z.infer<typeof ProductNoticesSchema>;

export const PRODUCT_HELD_BACK_REASONS = ['incomplete_product_data'] as const;
/** Why a product is held back (shop setting `hold-back`), and the payload paths to complete. */
export const ProductHeldBackSchema = z.object({
  reason: z.enum(PRODUCT_HELD_BACK_REASONS),
  fields: z.array(z.string()).min(1),
});
export type ProductHeldBack = z.infer<typeof ProductHeldBackSchema>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const FABRIC_KEYS = Object.keys(FabricSchema.shape) as Array<keyof typeof FabricSchema.shape>;

/**
 * Leaves out the parts of a fabric that are present but not valid (stretch 150, drape "fluid"),
 * and reports each. Valid parts and unknown keys are returned untouched; `null` and `''` count as
 * absent and are dropped without a report. Anything that is not an object is returned as it is.
 */
export function leaveOutInvalidFabricParts(fabric: unknown): { fabric: unknown; leftOut: LeftOutValue[] } {
  if (!isObject(fabric)) return { fabric, leftOut: [] };
  const out: Record<string, unknown> = { ...fabric };
  const leftOut: LeftOutValue[] = [];
  for (const key of FABRIC_KEYS) {
    const value = out[key];
    if (value === undefined) continue;
    if (value === null || value === '') {
      delete out[key];
      continue;
    }
    const parsed = FabricSchema.shape[key].safeParse(value);
    if (parsed.success) continue;
    delete out[key];
    const first = parsed.error.issues[0];
    leftOut.push({ field: `fabric.${key}`, reason: first?.message ?? 'invalid value' });
  }
  return { fabric: out, leftOut };
}

/**
 * The same for a whole product payload (only `fabric` is touched): the input of the draft schema
 * on the merchant upsert. Never throws; a payload that is not an object is returned as it is.
 */
export function leaveOutInvalidParts(payload: unknown): { payload: unknown; leftOut: LeftOutValue[] } {
  if (!isObject(payload) || payload.fabric === undefined) return { payload, leftOut: [] };
  const { fabric, leftOut } = leaveOutInvalidFabricParts(payload.fabric);
  return { payload: { ...payload, fabric }, leftOut };
}

/**
 * The payload paths that make a product's data incomplete in the sense of the shop setting (see the
 * file comment). Empty: the setting does not apply to this product.
 */
export function incompleteProductDataFields(draft: unknown, leftOut: readonly LeftOutValue[] = []): string[] {
  const fields = new Set(leftOut.map((l) => l.field));
  const g = isObject(draft) ? draft : {};
  const fabric = isObject(g.fabric) ? g.fabric : {};
  const stretchKnown = FabricSchema.shape.stretchPct.safeParse(fabric.stretchPct).success;
  if (!stretchKnown && g.category !== 'accessory') fields.add('fabric.stretchPct');
  return [...fields].sort();
}

/** `hold-back` + incomplete data → the stored reason; otherwise null (the product is let through). */
export function heldBackFor(policy: IncompleteProductDataPolicy, draft: unknown, leftOut: readonly LeftOutValue[] = []): ProductHeldBack | null {
  if (policy !== 'hold-back') return null;
  const fields = incompleteProductDataFields(draft, leftOut);
  return fields.length ? { reason: 'incomplete_product_data', fields } : null;
}
