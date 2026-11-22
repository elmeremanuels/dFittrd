/**
 * Starting camera angle per garment type (D30): the 3D view opens at a default angle chosen by
 * the garment's category. Dresses and tops open at three-quarter (45° azimuth), the other types
 * at front (0°). The shopper can always rotate freely.
 */
import type { GarmentCategory } from '@curtain/schema';

/** Azimuth and elevation (degrees) of the camera's starting position relative to the figure. */
export interface InitialView {
  /** Horizontal rotation around the figure: 0° = front, 45° = three-quarter right. */
  azimuthDeg: number;
  /** Vertical tilt: 0° = level, positive = looking slightly down. */
  elevationDeg: number;
}

/** Three-quarter view: 45° to the right, level. */
const THREE_QUARTER: InitialView = { azimuthDeg: 45, elevationDeg: 0 };

/** Front view: straight on, level. */
const FRONT: InitialView = { azimuthDeg: 0, elevationDeg: 0 };

/**
 * The starting camera angle for a garment category. Dresses and tops open at three-quarter
 * (the shopper sees the drape from the side); the other types open at front.
 */
export function initialViewFor(category: GarmentCategory | undefined | null): InitialView {
  if (category === 'dress' || category === 'top') return THREE_QUARTER;
  return FRONT;
}
