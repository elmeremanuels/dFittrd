/**
 * Types forked from spikes/garment-engine/src/product.ts and src/anchoring.ts (only what the device
 * side reads). Keep in step with the spike until it is promoted; test/parity.test.ts pins grading.
 */
import type { AnchorBreadth, AnchorLength, AnchorRing } from '@curtain/anchors';
import type { SpikeCategory } from './garment';

/** material.json: the product's fabric resolved through the `@curtain/schema` fabric library. */
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

export interface ChartRow {
  size: string;
  rings: Partial<Record<AnchorRing, number>>;
  defaultEase: AnchorRing[];
  blockEase?: AnchorRing[];
  breadths: Partial<Record<AnchorBreadth, number>>;
  defaultEaseBreadths: AnchorBreadth[];
}

export interface GarmentChart {
  productId: string;
  category: SpikeCategory;
  type: 'body' | 'garment';
  rows: ChartRow[];
}

interface RingMeasurement {
  circumferenceCm: number;
  spansBothLegs: boolean;
}
interface LengthMeasurement {
  lengthCm: number;
  fromMannequin: boolean;
}

/** The subset of the spike's anchoring output that grading reads. */
export interface AnchorMeasurements {
  rings: Partial<Record<AnchorRing, RingMeasurement>>;
  lengths: Partial<Record<AnchorLength, LengthMeasurement>>;
}
