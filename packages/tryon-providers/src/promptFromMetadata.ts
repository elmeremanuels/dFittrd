import type { FitPoint, GarmentInput } from './types.js';

/**
 * No try-on engine accepts structured fabric or size data (research doc, "FABRIC / SIZE
 * METADATA"). For prompt-capable engines (FASHN tryon-max, Nano Banana, Grok video) the only
 * lever is text, so this module turns the merchant payload + the on-device fit result into
 * short, concrete wording. Scales follow handoff §3.1: drape/opacity/sheen are 0–1.
 */

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** 0 = stiff … 1 = fluid */
export function drapeWord(drape: number): string {
  const d = clamp01(drape);
  if (d < 0.2) return 'stiff, structured';
  if (d < 0.4) return 'crisp';
  if (d < 0.6) return 'soft';
  if (d < 0.8) return 'fluid';
  return 'very fluid, liquid';
}

/** 0 = matte … 1 = shiny */
export function sheenWord(sheen: number): string {
  const s = clamp01(sheen);
  if (s < 0.2) return 'matte';
  if (s < 0.45) return 'low sheen';
  if (s < 0.7) return 'soft sheen';
  if (s < 0.9) return 'glossy';
  return 'high-gloss';
}

/** 0 = sheer … 1 = opaque */
export function opacityWord(opacity: number): string {
  const o = clamp01(opacity);
  if (o < 0.3) return 'sheer';
  if (o < 0.6) return 'semi-sheer';
  if (o < 0.85) return 'lightly opaque';
  return 'opaque';
}

/**
 * Garment-minus-body gap in cm (handoff §4.1). Negative = garment smaller than body.
 * Returns a fit word such as "snug" or "relaxed".
 */
export function easeWord(gapCm: number): string {
  if (!Number.isFinite(gapCm)) return 'true to size';
  if (gapCm < -4) return 'very tight, pulling';
  if (gapCm < -1) return 'tight';
  if (gapCm < 1.5) return 'close-fitting';
  if (gapCm < 4) return 'true to size';
  if (gapCm < 8) return 'relaxed';
  if (gapCm < 14) return 'loose';
  return 'oversized';
}

const FIT_POINT_ORDER: readonly FitPoint[] = ['bust', 'waist', 'hip', 'shoulder'];

/** "fitting close-fitting at the bust, relaxed at the waist" (only points that were measured). */
export function fitGapPhrase(fitGapCm: GarmentInput['fitGapCm']): string {
  if (!fitGapCm) return '';
  const parts: string[] = [];
  for (const point of FIT_POINT_ORDER) {
    const gap = fitGapCm[point];
    if (typeof gap === 'number' && Number.isFinite(gap)) parts.push(`${easeWord(gap)} at the ${point}`);
  }
  return parts.join(', ');
}

export function fabricPhrase(fabric: GarmentInput['fabric']): string {
  if (!fabric) return '';
  const parts: string[] = [];
  const primary = fabric.primary.trim();
  const weight = fabric.weightGsm;
  if (typeof weight === 'number' && weight > 0) parts.push(`${Math.round(weight)} gsm ${primary}`);
  else if (primary) parts.push(primary);
  if (typeof fabric.drape === 'number') parts.push(`${drapeWord(fabric.drape)} drape`);
  if (typeof fabric.sheen === 'number') parts.push(sheenWord(fabric.sheen));
  if (typeof fabric.opacity === 'number') parts.push(opacityWord(fabric.opacity));
  if (typeof fabric.stretchPct === 'number') {
    if (fabric.stretchPct >= 15) parts.push('stretchy jersey-like');
    else if (fabric.stretchPct >= 5) parts.push('slight stretch');
    else parts.push('non-stretch woven');
  }
  return parts.join(', ');
}

/**
 * Builds the prompt hint for a still try-on. Example:
 * "wrap dress, 240 gsm linen, fluid drape, matte, opaque, non-stretch woven, colour #C97A4F,
 *  size M fitting close-fitting at the bust, relaxed at the waist. Keep the person's face, body
 *  proportions and pose exactly as shown."
 */
export function promptFromMetadata(garment: GarmentInput): string {
  const segments: string[] = [];
  const kind = garment.patternBlock ? `${garment.patternBlock} ${garment.category}` : garment.category;
  segments.push(kind);
  const fabric = fabricPhrase(garment.fabric);
  if (fabric) segments.push(fabric);
  if (garment.primaryColorHex) segments.push(`colour ${garment.primaryColorHex}`);
  const fit = fitGapPhrase(garment.fitGapCm);
  if (garment.size && fit) segments.push(`size ${garment.size} fitting ${fit}`);
  else if (garment.size) segments.push(`size ${garment.size}`);
  else if (fit) segments.push(`fitting ${fit}`);
  return `${segments.join(', ')}. Keep the person's face, body proportions and pose exactly as shown.`;
}

/**
 * Prompt for the optional hero video: animates an already rendered still; the fabric words
 * drive the motion ("fluid drape, slow turn").
 */
export function motionPromptFromMetadata(garment: GarmentInput): string {
  const fabric = fabricPhrase(garment.fabric);
  const motion = garment.fabric && typeof garment.fabric.drape === 'number' && garment.fabric.drape >= 0.6
    ? 'fabric sways and settles naturally'
    : 'fabric holds its shape with subtle movement';
  const subject = fabric ? `${garment.category} in ${fabric}` : garment.category;
  return `The person turns slowly in place, ${motion}, ${subject}. Static camera, neutral background, keep face and body proportions unchanged.`;
}
