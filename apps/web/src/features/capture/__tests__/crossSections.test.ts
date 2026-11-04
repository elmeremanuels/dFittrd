import { describe, expect, it } from 'vitest';
import { LEVELS, placeLevels, TORSO_FRACTIONS, landmarkSpans } from '../crossSections';
import { POSE } from '../landmarks';
import { FRAME, figure } from './fixtures';

describe('crossSections.placeLevels', () => {
  const lm = figure();
  const levels = placeLevels(lm, FRAME.width / FRAME.height);
  const byLevel = Object.fromEntries(levels.map((l) => [l.level, l]));

  it('returns all 12 levels in FitSignature order', () => {
    expect(levels.map((l) => l.level)).toEqual([...LEVELS]);
  });

  it('places chest at 37.5 % and waist at 62.5 % of shoulder→hip', () => {
    const sy = (lm[POSE.LEFT_SHOULDER]!.y + lm[POSE.RIGHT_SHOULDER]!.y) / 2;
    const hy = (lm[POSE.LEFT_HIP]!.y + lm[POSE.RIGHT_HIP]!.y) / 2;
    expect(byLevel.bust!.y).toBeCloseTo(sy + 0.375 * (hy - sy), 6);
    expect(byLevel.waist!.y).toBeCloseTo(sy + 0.625 * (hy - sy), 6);
    expect(TORSO_FRACTIONS.bust).toBe(0.375);
    expect(TORSO_FRACTIONS.waist).toBe(0.625);
  });

  it('orders the levels top to bottom on the torso and legs', () => {
    const order = ['neck', 'shoulder', 'bust', 'underbust', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(byLevel[order[i]!]!.y).toBeGreaterThan(byLevel[order[i - 1]!]!.y);
    }
    expect(byLevel.neck!.y).toBeGreaterThan(lm[POSE.NOSE]!.y);
    expect(byLevel.neck!.y).toBeLessThan(lm[POSE.LEFT_SHOULDER]!.y);
  });

  it('places knee and wrist from landmarks and limb levels on the limb axis', () => {
    expect(byLevel.knee!.y).toBeCloseTo(lm[POSE.LEFT_KNEE]!.y, 6);
    expect(byLevel.knee!.x).toBeCloseTo(lm[POSE.LEFT_KNEE]!.x, 6);
    // the upper arm lies on the shoulder→elbow segment of an A-pose: x is between the two
    expect(byLevel.upperArm!.x).toBeGreaterThan(lm[POSE.LEFT_SHOULDER]!.x);
    expect(byLevel.upperArm!.x).toBeLessThan(lm[POSE.LEFT_ELBOW]!.x);
    expect(byLevel.upperArm!.axisDeg).toBeGreaterThan(10);
    expect(byLevel.wrist!.y).toBeLessThan(lm[POSE.LEFT_WRIST]!.y);
    expect(byLevel.thigh!.axisDeg).toBeLessThan(15);
  });

  it('uses the right limbs when asked', () => {
    const right = placeLevels(lm, FRAME.width / FRAME.height, 'right');
    const knee = right.find((l) => l.level === 'knee')!;
    expect(knee.x).toBeCloseTo(lm[POSE.RIGHT_KNEE]!.x, 6);
  });

  it('throws on a short landmark array', () => {
    expect(() => placeLevels(lm.slice(0, 10))).toThrow(RangeError);
  });

  it('landmarkSpans reports a plausible shoulder breadth and torso', () => {
    const s = landmarkSpans(lm);
    expect(s.biacromialX * FRAME.width).toBeCloseTo(40 * 4.07, 0);
    expect(s.hipMidY).toBeGreaterThan(s.shoulderMidY);
    expect(s.heelY).toBeGreaterThan(s.kneeY);
  });
});
