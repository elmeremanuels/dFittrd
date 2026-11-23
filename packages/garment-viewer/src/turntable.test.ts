import { describe, expect, it } from 'vitest';
import {
  nextReducedStep,
  reducedStepDeg,
  REDUCED_MOTION_STEPS,
  turnAngleAt,
  turnRunning,
  TURN_DURATION_MS,
} from './turntable';

describe('turnAngleAt', () => {
  it('returns the start angle at t=0', () => {
    expect(turnAngleAt(0, 45)).toBe(45);
    expect(turnAngleAt(0, 0)).toBe(0);
    expect(turnAngleAt(0, 315)).toBe(315);
  });

  it('returns start + 360 at t = duration', () => {
    expect(turnAngleAt(TURN_DURATION_MS, 45)).toBe(405);
    expect(turnAngleAt(TURN_DURATION_MS, 0)).toBe(360);
  });

  it('returns start + 360 for t > duration (clamped)', () => {
    expect(turnAngleAt(TURN_DURATION_MS + 1000, 0)).toBe(360);
  });

  it('returns the start angle for t < 0', () => {
    expect(turnAngleAt(-1, 45)).toBe(45);
  });

  it('produces a smooth ease-in: angle at 10% of duration is small', () => {
    const a = turnAngleAt(TURN_DURATION_MS * 0.1, 0);
    // Cubic ease-in-out: at 10%, the eased value is 4 * 0.1^3 = 0.004, so angle ≈ 1.44°.
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(20);
  });

  it('reaches about 180° at the midpoint', () => {
    const a = turnAngleAt(TURN_DURATION_MS * 0.5, 0);
    // At t=0.5: eased = 0.5 (inflection point of cubic ease-in-out).
    expect(a).toBeCloseTo(180, 0);
  });

  it('produces a smooth ease-out: angle near the end is close to 360°', () => {
    const a = turnAngleAt(TURN_DURATION_MS * 0.9, 0);
    expect(a).toBeGreaterThan(340);
    expect(a).toBeLessThan(360);
  });

  it('preserves the start offset throughout the turn', () => {
    const start = 45;
    const a = turnAngleAt(TURN_DURATION_MS * 0.5, start);
    expect(a).toBeCloseTo(start + 180, 0);
  });

  it('accepts a custom duration', () => {
    const a = turnAngleAt(2000, 0, 4000);
    expect(a).toBeCloseTo(180, 0);
  });
});

describe('turnRunning', () => {
  it('false before the turn starts', () => {
    expect(turnRunning(0)).toBe(false);
    expect(turnRunning(-1)).toBe(false);
  });

  it('true during the turn', () => {
    expect(turnRunning(1)).toBe(true);
    expect(turnRunning(TURN_DURATION_MS - 1)).toBe(true);
    expect(turnRunning(TURN_DURATION_MS / 2)).toBe(true);
  });

  it('false at and after the turn ends', () => {
    expect(turnRunning(TURN_DURATION_MS)).toBe(false);
    expect(turnRunning(TURN_DURATION_MS + 1)).toBe(false);
  });
});

describe('reduced motion steps', () => {
  it('has the five preset angles plus return to front', () => {
    expect(REDUCED_MOTION_STEPS).toEqual([0, 45, 90, 180, 315, 0]);
  });

  it('nextReducedStep cycles through the steps', () => {
    expect(nextReducedStep(-1)).toBe(0);
    expect(nextReducedStep(0)).toBe(1);
    expect(nextReducedStep(4)).toBe(5);
    expect(nextReducedStep(5)).toBe(0); // wraps
  });

  it('reducedStepDeg returns the correct angle for each step', () => {
    expect(reducedStepDeg(0)).toBe(0);
    expect(reducedStepDeg(1)).toBe(45);
    expect(reducedStepDeg(2)).toBe(90);
    expect(reducedStepDeg(3)).toBe(180);
    expect(reducedStepDeg(4)).toBe(315);
    expect(reducedStepDeg(5)).toBe(0);
    // Wraps
    expect(reducedStepDeg(6)).toBe(0);
  });
});
