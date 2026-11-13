/**
 * Mappings between the D15 anchor ids and the names used before D15: the fit engine's points
 * (`FIT_POINTS` in `@curtain/schema`), the scan's cross-section levels (`LEVELS` in
 * `apps/web/src/features/capture/crossSections.ts`, = `FS_GIRTH_LEVELS`) and the garment `lengthCm`
 * keys. The names are declared here as literals so the package keeps zero dependencies; the tests
 * compare them with `@curtain/schema`.
 */
import type { AnchorId, AnchorLength, AnchorRing } from './vocabulary';

// ---------------------------------------------------------------------------
// Fit points
// ---------------------------------------------------------------------------

/** Fit points that have an anchor. `foot` is not an anchor (shoes have no garment mesh). */
export type AnchoredFitPoint = 'bust' | 'waist' | 'hip' | 'shoulder' | 'thigh' | 'inseam';

/**
 * Fit point → anchor id. `bust` → `chest`, and `shoulder` → `shoulder_width` (R1): the fit point and
 * every size chart mean the width across the back, not the D15 `shoulder` ring (a ~100 cm girth),
 * so a shoulder gap is never keyed under the ring. No fit point maps onto the `shoulder` ring.
 */
export const FIT_POINT_TO_ANCHOR: Readonly<Record<AnchoredFitPoint, AnchorId>> = {
  bust: 'chest',
  waist: 'waist',
  hip: 'hip',
  shoulder: 'shoulder_width',
  thigh: 'thigh',
  inseam: 'inseam',
};

/** Anchor id → fit point, for the anchors the fit engine scores. */
export const ANCHOR_TO_FIT_POINT: Readonly<Partial<Record<AnchorId, AnchoredFitPoint>>> = invert(FIT_POINT_TO_ANCHOR);

/** The anchor of a fit point, `undefined` for `foot` and unknown names. */
export function fitPointToAnchor(point: string): AnchorId | undefined {
  return own(FIT_POINT_TO_ANCHOR, point);
}

/** The fit point of an anchor, `undefined` when the fit engine does not score that anchor. */
export function anchorToFitPoint(anchor: string): AnchoredFitPoint | undefined {
  return own(ANCHOR_TO_FIT_POINT, anchor);
}

// ---------------------------------------------------------------------------
// Scan levels
// ---------------------------------------------------------------------------

/** The scan's 12 cross-section levels (capture `LEVELS`, schema `FS_GIRTH_LEVELS`). */
export const SCAN_LEVELS = [
  'neck',
  'shoulder',
  'bust',
  'underbust',
  'waist',
  'hip',
  'thigh',
  'knee',
  'calf',
  'ankle',
  'upperArm',
  'wrist',
] as const;
export type ScanLevel = (typeof SCAN_LEVELS)[number];

/** Scan level → ring. `bust` → `chest`, `upperArm` → `upper_arm`; the others keep their name. */
export const SCAN_LEVEL_TO_ANCHOR: Readonly<Record<ScanLevel, AnchorRing>> = {
  neck: 'neck',
  shoulder: 'shoulder',
  bust: 'chest',
  underbust: 'underbust',
  waist: 'waist',
  hip: 'hip',
  thigh: 'thigh',
  knee: 'knee',
  calf: 'calf',
  ankle: 'ankle',
  upperArm: 'upper_arm',
  wrist: 'wrist',
};

/** Ring → scan level (a bijection: every ring is measured by exactly one level). */
export const ANCHOR_TO_SCAN_LEVEL: Readonly<Record<AnchorRing, ScanLevel>> = invert(SCAN_LEVEL_TO_ANCHOR) as Record<AnchorRing, ScanLevel>;

export function scanLevelToAnchor(level: string): AnchorRing | undefined {
  return own(SCAN_LEVEL_TO_ANCHOR, level);
}

export function anchorToScanLevel(anchor: string): ScanLevel | undefined {
  return own(ANCHOR_TO_SCAN_LEVEL, anchor);
}

/** Re-key a per-level record (e.g. scan girths) by ring id. Unknown keys are dropped. */
export function scanValuesToAnchors<T>(byLevel: Readonly<Partial<Record<string, T>>>): Partial<Record<AnchorRing, T>> {
  const out: Partial<Record<AnchorRing, T>> = {};
  for (const [level, value] of Object.entries(byLevel)) {
    const ring = scanLevelToAnchor(level);
    if (ring !== undefined && value !== undefined) out[ring] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Garment lengthCm keys
// ---------------------------------------------------------------------------

/** Garment `lengthCm` key → length anchor (schema `LENGTH_KEYS`). Keys without an anchor are absent. */
export const LENGTH_KEY_TO_ANCHOR: Readonly<Record<string, AnchorLength>> = {
  shoulder_to_waist: 'shoulder_to_waist',
  shoulder_to_hem: 'shoulder_to_hem',
  waist_to_hem: 'waist_to_hem',
  sleeve_length: 'sleeve',
  inseam: 'inseam',
  rise: 'rise',
};

export function lengthKeyToAnchor(key: string): AnchorLength | undefined {
  return own(LENGTH_KEY_TO_ANCHOR, key);
}

// ---------------------------------------------------------------------------

function own<V>(table: Readonly<Partial<Record<string, V>>>, key: string): V | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function invert<K extends string, V extends string>(table: Readonly<Record<K, V>>): Partial<Record<V, K>> {
  const out: Partial<Record<V, K>> = {};
  for (const [k, v] of Object.entries(table) as [K, V][]) out[v] = k;
  return out;
}
