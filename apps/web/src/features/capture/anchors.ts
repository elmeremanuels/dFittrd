/**
 * Scan levels → D15 anchor ids (docs/DECISIONS.md D15). Naming only: the scan keeps measuring and
 * storing per `Level` exactly as before; this module only says which shared anchor ring each level
 * is, so the fit engine, the garment asset and the 3D viewer can read scan girths by anchor id.
 * `bust` → `chest` and `upperArm` → `upper_arm`; the other ten keep their name.
 */
import { SCAN_LEVEL_TO_ANCHOR, scanValuesToAnchors, type AnchorRing } from '@curtain/anchors';
import type { Level } from './types';

/** Every capture level and its ring (a bijection onto the 12 rings, in `LEVELS` order). */
export const LEVEL_ANCHORS: Readonly<Record<Level, AnchorRing>> = SCAN_LEVEL_TO_ANCHOR;

/** The ring a capture level measures. */
export function levelAnchor(level: Level): AnchorRing {
  return LEVEL_ANCHORS[level];
}

/** Re-key per-level values (girths, sigmas…) by ring id. Values stay on the device (D3). */
export function byAnchor<T>(perLevel: Readonly<Partial<Record<Level, T>>>): Partial<Record<AnchorRing, T>> {
  return scanValuesToAnchors(perLevel);
}
