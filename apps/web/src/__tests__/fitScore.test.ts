import { describe, expect, it } from 'vitest';
import { PILOT_PULL_ON_SKIRT } from '@curtain/schema';
import { EMPTY_ABOUT, fitForProfile, profileFromAbout } from '@/embed/aboutYou';
import { shownFitScore, shownSizeScore, scoredSizeBlocked } from '@/lib/fitScore';

const fitAt = (waist: number, hip: number) => fitForProfile(PILOT_PULL_ON_SKIRT, profileFromAbout({ ...EMPTY_ABOUT, height: '170', weight: '64', waist: String(waist), hip: String(hip), knowsMeasurements: true }, 'bottom')).fit;

describe('fit scores a surface may show', () => {
  it('a size blocked by the pull-on check has no shown score, whatever the engine scored it', () => {
    expect(shownSizeScore({ score: 0.999, pullOn: { status: 'blocked' } as never })).toBeNull();
    expect(shownSizeScore({ score: 0.8, pullOn: { status: 'marginal' } as never })).toBe(0.8);
    expect(shownSizeScore({ score: 0.7 })).toBe(0.7);
    expect(shownSizeScore({ score: null })).toBeNull();
  });

  it('the pilot skirt at hip 120: the engine gives the closest size a high chart score; nothing shows it', () => {
    const fit = fitAt(95, 120);
    expect(fit.recommendedSize).toBeNull();
    expect(fit.perSize.every((s) => s.pullOn?.status === 'blocked')).toBe(true);
    expect(fit.score).toBeGreaterThan(0.9); // why this file exists
    expect(scoredSizeBlocked(fit)).toBe(true);
    expect(shownFitScore(fit)).toBeNull();
    expect(fit.perSize.map(shownSizeScore)).toEqual(fit.perSize.map(() => null));
  });

  it('a recommended size keeps its score', () => {
    const fit = fitAt(77.5, 104);
    expect(fit.recommendedSize).not.toBeNull();
    expect(shownFitScore(fit)).toBe(fit.score);
  });
});
