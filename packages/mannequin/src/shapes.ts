/**
 * The canonical mannequin's body shapes (v0: three, spanning the women's size range XS…XXL).
 *
 * Source of the numbers. The control girths (chest = bust, waist, hip) sit inside the size
 * intervals of EN 13402-3 (women's bust/waist/hip, cm) and agree with the body-type size charts in
 * the `@curtain/schema` fixtures (e.g. `aalter-studio-1`, size M: bust 92, waist 72, hip 100; the
 * graded XS…XL charts step 4 cm per size). Stature follows the ISO 8559-2 convention of a fixed
 * height per size range for women's wear (164 / 168 / 170 cm). The secondary girths (neck, shoulder,
 * underbust, thigh, knee, calf, ankle, upper arm, wrist) are not in those tables; they are
 * representative values in the usual anthropometric proportion to the control girths and are marked
 * as such. v0 is a geometry fixture for the pipeline, not an anthropometric reference: Phase 1 swaps
 * in a measured table (and 5 shapes) without changing any interface.
 *
 * `aspect` is depth / width of the ring's ellipse (`b / a` in `@curtain/anchors`). The `shoulder`
 * ring is the girth of the torso at the shoulder line without the arms (arms are separate tubes in
 * v0), so it is flatter than the others.
 */
import type { AnchorRing } from '@curtain/anchors';

export interface RingSpec {
  /** Girth, cm. */
  circumferenceCm: number;
  /** Depth / width of the ellipse. */
  aspect: number;
}

export const BODY_SHAPE_IDS = ['XS', 'M', 'XXL'] as const;
export type BodyShapeId = (typeof BODY_SHAPE_IDS)[number];

export interface BodyShape {
  id: BodyShapeId;
  statureCm: number;
  rings: Readonly<Record<AnchorRing, RingSpec>>;
  /** Where each number comes from: `table` = EN 13402-3 / fixture control girth, `proportion` = representative value. */
  provenance: Readonly<Record<AnchorRing, 'table' | 'proportion'>>;
}

const ASPECT: Readonly<Record<AnchorRing, number>> = {
  neck: 0.9,
  shoulder: 0.5,
  chest: 0.68,
  underbust: 0.72,
  waist: 0.72,
  hip: 0.68,
  thigh: 0.95,
  knee: 0.95,
  calf: 0.95,
  ankle: 0.85,
  upper_arm: 0.95,
  wrist: 0.75,
};

const PROVENANCE: Readonly<Record<AnchorRing, 'table' | 'proportion'>> = {
  neck: 'proportion',
  shoulder: 'proportion',
  chest: 'table',
  underbust: 'proportion',
  waist: 'table',
  hip: 'table',
  thigh: 'proportion',
  knee: 'proportion',
  calf: 'proportion',
  ankle: 'proportion',
  upper_arm: 'proportion',
  wrist: 'proportion',
};

/** Girths per shape, cm, in `ANCHOR_RINGS` order. */
const GIRTHS: Readonly<Record<BodyShapeId, { stature: number; girths: Readonly<Record<AnchorRing, number>> }>> = {
  XS: {
    stature: 164,
    girths: { neck: 32, shoulder: 94, chest: 80, underbust: 68, waist: 62, hip: 88, thigh: 50, knee: 33, calf: 32, ankle: 20.5, upper_arm: 25, wrist: 14.5 },
  },
  M: {
    stature: 168,
    girths: { neck: 35, shoulder: 102, chest: 92, underbust: 78, waist: 74, hip: 100, thigh: 57, knee: 36, calf: 35, ankle: 22, upper_arm: 28, wrist: 15.5 },
  },
  XXL: {
    stature: 170,
    girths: { neck: 40, shoulder: 120, chest: 116, underbust: 100, waist: 98, hip: 122, thigh: 70, knee: 41, calf: 40, ankle: 24.5, upper_arm: 36, wrist: 17 },
  },
};

function shape(id: BodyShapeId): BodyShape {
  const { stature, girths } = GIRTHS[id];
  const rings = {} as Record<AnchorRing, RingSpec>;
  for (const ring of Object.keys(girths) as AnchorRing[]) rings[ring] = { circumferenceCm: girths[ring], aspect: ASPECT[ring] };
  return { id, statureCm: stature, rings, provenance: PROVENANCE };
}

export const BODY_SHAPES: Readonly<Record<BodyShapeId, BodyShape>> = {
  XS: shape('XS'),
  M: shape('M'),
  XXL: shape('XXL'),
};

/** The shape garments are built on at their base size in Phase 0. */
export const BASE_SHAPE_ID: BodyShapeId = 'M';

export function bodyShape(id: BodyShapeId): BodyShape {
  return BODY_SHAPES[id];
}
