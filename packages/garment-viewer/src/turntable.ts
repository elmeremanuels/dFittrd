/**
 * Slow turn ("rondje draaien") in the viewer (WO-022, CUR-36, phase F).
 *
 * The shopper taps "Turn around". The camera orbits the figure once slowly (~8 s for 360°)
 * with ease-in and ease-out, then stops at the starting view (D30, `initialViewFor`). Nothing
 * deforms. If the shopper drags during the turn, the turn stops at once.
 *
 * `prefers-reduced-motion`: no automatic turn. The button instead steps through preset angles:
 * front → three-quarter → side → back → three-quarter (other side).
 *
 * All timing is a pure function of elapsed time, unit-tested without a clock or a renderer.
 */

/** Duration of one full turn, ms. */
export const TURN_DURATION_MS = 8000;

/**
 * Camera azimuth (degrees) at time `t` ms into a turn that starts at `startDeg` and turns 360°.
 * Eased with a cubic ease-in-out so the camera accelerates gently and decelerates to a stop.
 */
export function turnAngleAt(tMs: number, startDeg: number, durationMs: number = TURN_DURATION_MS): number {
  if (tMs <= 0) return startDeg;
  if (tMs >= durationMs) return startDeg + 360;
  const p = tMs / durationMs;
  // Cubic ease-in-out: slow start, fast middle, slow end.
  const eased = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
  return startDeg + eased * 360;
}

/** Whether the turn is still running at time `t`. */
export function turnRunning(tMs: number, durationMs: number = TURN_DURATION_MS): boolean {
  return tMs > 0 && tMs < durationMs;
}

/**
 * The preset azimuth steps for `prefers-reduced-motion` (no continuous turn).
 * front → three-quarter right → side right → back → three-quarter left → front.
 */
export const REDUCED_MOTION_STEPS: readonly number[] = [0, 45, 90, 180, 315, 0];

/**
 * The next step index in the reduced-motion sequence, wrapping back to 0 after the last.
 * `current` is the index of the step currently shown; -1 means "not stepped yet" (start from 0).
 */
export function nextReducedStep(current: number): number {
  return (current + 1) % REDUCED_MOTION_STEPS.length;
}

/** The azimuth (degrees) of a reduced-motion step. */
export function reducedStepDeg(index: number): number {
  return REDUCED_MOTION_STEPS[index % REDUCED_MOTION_STEPS.length] ?? 0;
}
