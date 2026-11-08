/**
 * Garment assets (docs/ENGINE-HANDOFF.md §Stage 8, D13, D16): the approved 3D bundle of a product,
 * as the embed sees it on `GET /v1/try` (`asset`), as the merchant console lists it, and the bundle
 * check the api (on import and before handing out a ref) and the viewer (after download) share.
 *
 * Privacy (D3): an asset ref is public product data. The shopper's iframe only GETs the files under
 * `baseUrl` after the shopper opts in; nothing about the body goes up.
 */
import { z } from 'zod';
import { sizeLabelKey, type GarmentPayload } from './garment';

/** First 16 hex chars of the sha256 of the bundle files: the immutable asset version. */
export const GarmentAssetVersionSchema = z.string().regex(/^[0-9a-f]{16}$/);

export const GarmentAssetRefSchema = z.object({
  version: GarmentAssetVersionSchema,
  /** Directory of the bundle files (`<api>/assets/<shopId>/<productId>/<version>`), no trailing slash. */
  baseUrl: z.url({ protocol: /^https?$/ }).max(512),
  baseSize: z.string().min(1).max(32),
  sizes: z.array(z.string().min(1).max(32)).min(1).max(32),
  /** AGENTS.md rule 3: a reconstructed garment on a modelled body is an estimate. */
  label: z.literal('estimate'),
});
export type GarmentAssetRef = z.infer<typeof GarmentAssetRefSchema>;

export const GarmentAssetStatusSchema = z.enum(['awaiting_approval', 'approved', 'rejected', 'superseded']);
export type GarmentAssetStatus = z.infer<typeof GarmentAssetStatusSchema>;

/** One asset version in the merchant console (no shopper data, ever). */
export const MerchantGarmentAssetSchema = z.object({
  id: z.uuid(),
  productExternalId: z.string().min(1).max(256),
  version: GarmentAssetVersionSchema,
  status: GarmentAssetStatusSchema,
  live: z.boolean(),
  bytes: z.number().int().nonnegative(),
  baseSize: z.string().min(1).max(32),
  sizes: z.array(z.string()).max(32),
  qaPass: z.boolean(),
  /** QA readings the merchant must see before approving (`garmentQaFlags`), e.g. `low_rise_waist`. */
  qaFlags: z.array(z.enum(['low_rise_waist', 'precalibration_outside_tolerance'])).max(8).optional(),
  /** One plain sentence per flag, in `qaFlags` order (`garmentQaFlagNote`), for the approval screen. */
  qaNotes: z.array(z.string().max(500)).max(8).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  rejectReason: z.string().max(500).nullable(),
});
export type MerchantGarmentAsset = z.infer<typeof MerchantGarmentAssetSchema>;

export const MerchantGarmentAssetListSchema = z.object({ assets: z.array(MerchantGarmentAssetSchema).max(100) });
export const GarmentAssetRejectRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const GarmentAssetActionResponseSchema = z.object({ asset: MerchantGarmentAssetSchema });

// ---------------------------------------------------------------------------
// Bundle check (shared by the api import, the try route and the viewer)
// ---------------------------------------------------------------------------

/** The largest bundle the overlay downloads (base.glb + the JSON files), bytes. */
export const MAX_GARMENT_BUNDLE_BYTES = 3 * 1024 * 1024;

/** The files every asset version holds. payload.json of evaluated bundles is never served. */
export const GARMENT_BUNDLE_FILES = ['base.glb', 'anchors.json', 'grading.json', 'material.json', 'qa.json'] as const;

export interface GarmentBundleMeta {
  anchors: { format?: unknown };
  grading: { format?: unknown; baseSize?: unknown; sizes?: unknown };
  material: { format?: unknown };
  qa: { format?: unknown; chartAgreement?: GarmentChartAgreementMeta };
  /** Total size of the bundle files, bytes, when known. */
  bytes?: number;
}

/** The parts of qa.json `chartAgreement` the gate reads. */
export interface GarmentChartAgreementMeta {
  pass?: unknown;
  waistReading?: unknown;
  toleranceCm?: unknown;
  beforeCalibrationMaxAbsCm?: unknown;
}

export interface GarmentBundleInfo {
  baseSize: string;
  /** Grading size labels, in chart order. */
  sizes: string[];
  /**
   * QA readings the bundle passed under that a person must see before approving it (`garmentQaFlags`): `low_rise_waist` when
   * its chart waist was read at a band below the waist ring by a recorded decision; `precalibration_outside_tolerance` when
   * the chart passed only after calibration and missed by more than the tolerance before it. Empty for an ordinary pass.
   */
  qaFlags: GarmentQaFlag[];
}

export type GarmentQaFlag = 'low_rise_waist' | 'precalibration_outside_tolerance';

/** A plain sentence for a flag, for the merchant to read before approving (never only the code). */
export function garmentQaFlagNote(flag: GarmentQaFlag, qa: GarmentBundleMeta['qa']): string {
  const ca = qa.chartAgreement ?? {};
  if (flag === 'low_rise_waist') {
    const wr = (ca.waistReading ?? {}) as { decision?: unknown; dropCm?: unknown; offsetCm?: unknown; targetCm?: unknown };
    const drop = typeof wr.dropCm === 'number' ? ` ${wr.dropCm} cm` : '';
    return `Waist read at the garment's own band,${drop} below the body's natural waist, by a recorded decision (${String(wr.decision)}), against the chart's waist plus a stated body offset of ${String(wr.offsetCm)} cm (target ${String(wr.targetCm)} cm); the chart does not say where this band sits.`;
  }
  return `Before calibration the garment missed the size chart by ${String(ca.beforeCalibrationMaxAbsCm)} cm, outside the ±${String(ca.toleranceCm)} cm tolerance; it passes only after calibration rescaled it, which is not evidence of fit.`;
}

/**
 * The flags of a bundle's QA, or `null` when a declared reading is malformed (the bundle is then refused, `qa_failed`).
 * `chartAgreement.waistReading` (spikes/garment-engine src/lowRise.ts): a bottom whose band sits below the body's waist,
 * read at the band against the chart's waist plus a stated body offset, by a founder's recorded decision. It is accepted
 * only as `{ kind: 'low-rise', decision: <non-empty>, offsetCm: <finite>, targetCm: <finite> }`, and always flagged.
 * `chartAgreement.beforeCalibrationMaxAbsCm` above `toleranceCm` is flagged `precalibration_outside_tolerance`.
 */
export function garmentQaFlags(qa: GarmentBundleMeta['qa']): GarmentQaFlag[] | null {
  const flags: GarmentQaFlag[] = [];
  const wr = qa.chartAgreement?.waistReading;
  if (wr !== undefined && wr !== null) {
    if (typeof wr !== 'object') return null;
    const o = wr as { kind?: unknown; decision?: unknown; offsetCm?: unknown; targetCm?: unknown };
    if (o.kind !== 'low-rise' || typeof o.decision !== 'string' || o.decision.trim() === '') return null;
    if (typeof o.offsetCm !== 'number' || !Number.isFinite(o.offsetCm) || typeof o.targetCm !== 'number' || !Number.isFinite(o.targetCm)) return null;
    flags.push('low_rise_waist');
  }
  // A pass after calibration over a miss outside tolerance before it: flagged, so a single-anchor automatic pass never looks clean.
  const before = qa.chartAgreement?.beforeCalibrationMaxAbsCm;
  const tol = qa.chartAgreement?.toleranceCm;
  if (typeof before === 'number' && typeof tol === 'number' && Number.isFinite(before) && Number.isFinite(tol) && before > tol) flags.push('precalibration_outside_tolerance');
  return flags;
}

export type GarmentBundleProblem = 'format' | 'too_large' | 'qa_failed' | 'chart_mismatch';

/** Format, size, QA and size coverage of a bundle; `chartSizes` are the product's live size labels. */
export function checkGarmentBundle(meta: GarmentBundleMeta, chartSizes: readonly string[]): { ok: true; info: GarmentBundleInfo } | { ok: false; problem: GarmentBundleProblem } {
  if (meta.anchors.format !== 'curtain.garment.anchors' || meta.grading.format !== 'curtain.garment.grading' || meta.material.format !== 'curtain.garment.material' || meta.qa.format !== 'curtain.garment.qa') {
    return { ok: false, problem: 'format' };
  }
  if (meta.bytes !== undefined && (!Number.isFinite(meta.bytes) || meta.bytes > MAX_GARMENT_BUNDLE_BYTES)) return { ok: false, problem: 'too_large' };
  if (meta.qa.chartAgreement?.pass !== true) return { ok: false, problem: 'qa_failed' };
  const qaFlags = garmentQaFlags(meta.qa);
  if (!qaFlags) return { ok: false, problem: 'qa_failed' };
  const { baseSize, sizes: rows } = meta.grading;
  if (typeof baseSize !== 'string' || !Array.isArray(rows) || rows.length === 0 || rows.length > 32) return { ok: false, problem: 'format' };
  const sizes: string[] = [];
  for (const r of rows as unknown[]) {
    const s = r && typeof r === 'object' ? (r as { size?: unknown }).size : undefined;
    if (typeof s !== 'string' || s.length === 0 || s.length > 32) return { ok: false, problem: 'format' };
    sizes.push(s);
  }
  const graded = new Set(sizes.map(sizeLabelKey));
  if (!graded.has(sizeLabelKey(baseSize))) return { ok: false, problem: 'format' };
  // Every size the shop sells must be graded, or the advice could name a size the picture cannot show.
  if (chartSizes.length === 0 || !chartSizes.every((s) => graded.has(sizeLabelKey(s)))) return { ok: false, problem: 'chart_mismatch' };
  return { ok: true, info: { baseSize, sizes, qaFlags } };
}

/** The bundle check against a garment's live chart: the info, or `null` (fall back to today's flow). */
export function garmentBundleFor(meta: GarmentBundleMeta, garment: Pick<GarmentPayload, 'sizeChart'>): GarmentBundleInfo | null {
  const r = checkGarmentBundle(meta, garment.sizeChart.map((row) => row.size));
  return r.ok ? r.info : null;
}
