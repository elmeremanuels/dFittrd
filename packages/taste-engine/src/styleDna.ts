/**
 * Style DNA display model — taste-engine-spec.md §Style DNA display.
 * Pure projection of the profile; no fabricated numbers.
 */
import { AXES, type Axis, type TasteProfile } from './types';
import { topAxis } from './util';

/** Archetype copy per dominant axis. */
export const ARCHETYPE_COPY: Readonly<Record<Axis, string>> = Object.freeze({
  bohemian: 'Free Spirit',
  minimal: 'Modern Minimalist',
  classic: 'Timeless Classic',
  avantGarde: 'Avant-Garde',
  sporty: 'Athleisure',
});

/** Display labels for the TasteRadial axes. */
export const AXIS_LABELS: Readonly<Record<Axis, string>> = Object.freeze({
  bohemian: 'Bohemian',
  minimal: 'Minimal',
  classic: 'Classic',
  avantGarde: 'Avant-Garde',
  sporty: 'Sporty',
});

export interface StyleDnaAxis {
  axis: Axis;
  label: string;
  /** profile.axes[axis], 0..1 */
  value: number;
}

export interface StyleDna {
  /** TasteRadial axes in fixed order (bohemian, minimal, classic, avantGarde, sporty). */
  axes: StyleDnaAxis[];
  /** argmax axis (first wins ties). */
  archetype: Axis;
  /** ARCHETYPE_COPY[archetype] */
  archetypeLabel: string;
  /** round(axes[archetype] · 100) */
  percent: number;
  /** `Refined by ${swipeCount} swipes` */
  subtitle: string;
  swipeCount: number;
}

export function styleDna(profile: TasteProfile): StyleDna {
  const archetype = topAxis(profile.axes);
  return {
    axes: AXES.map((axis) => ({ axis, label: AXIS_LABELS[axis], value: profile.axes[axis] })),
    archetype,
    archetypeLabel: ARCHETYPE_COPY[archetype],
    percent: Math.round(profile.axes[archetype] * 100),
    subtitle: `Refined by ${profile.swipeCount} swipes`,
    swipeCount: profile.swipeCount,
  };
}
