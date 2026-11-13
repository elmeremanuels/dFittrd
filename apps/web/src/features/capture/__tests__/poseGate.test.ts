import { describe, expect, it } from 'vitest';
import { classifyView, frontScore, gateFeatures, gateFrame, gateHint, heightSpanStable, selectFrames, sideScore } from '../poseGate';
import type { FrameFeatures } from '../types';
import { FRAME, figure } from './fixtures';

const stableSpans = (lm: ReturnType<typeof figure>): number[] => Array(8).fill(gateFeatures(lm, FRAME).heightSpan);

describe('poseGate', () => {
  it('classifies a frontal A-pose figure as front and passes the gate when stable', () => {
    const lm = figure();
    const f = gateFeatures(lm, FRAME);
    expect(f.view).toBe('front');
    expect(f.frontalRatio).toBeGreaterThan(0.6);
    expect(f.tiltDeg).toBeLessThan(1);
    expect(f.armGapRatio).toBeGreaterThan(0.3);
    const g = gateFrame(lm, FRAME, stableSpans(lm));
    expect(g.ok).toBe(true);
    expect(g.reasons).toEqual([]);
  });

  it('is unstable before the span history fills', () => {
    const g = gateFrame(figure(), FRAME, []);
    expect(g.ok).toBe(false);
    expect(g.reasons).toContain('unstable');
  });

  it('rejects arms at the side (not an A-pose)', () => {
    const lm = figure({ elbowX: 21 });
    const g = gateFrame(lm, FRAME, stableSpans(lm));
    expect(g.reasons).toContain('arms_not_in_a_pose');
    expect(gateHint(g.reasons)).toMatch(/arms/i);
  });

  it('rejects a tilted body axis (> 5°)', () => {
    const lm = figure({ tiltDeg: 8 });
    const g = gateFrame(lm, FRAME, stableSpans(lm));
    expect(g.features.tiltDeg).toBeGreaterThan(5);
    expect(g.reasons).toContain('tilted');
  });

  it('rejects low visibility and a head off-frame', () => {
    const lowVis = figure({ visibility: 0.6 });
    expect(gateFrame(lowVis, FRAME, stableSpans(lowVis)).reasons).toContain('low_visibility');
    const off = figure({ shiftYPx: 200 });
    const g = gateFrame(off, FRAME, stableSpans(off));
    expect(g.reasons).toContain('too_close_to_edge');
  });

  it('rejects a figure that is too small in the frame', () => {
    const small = figure({ scale: 0.5 });
    const g = gateFrame(small, FRAME, stableSpans(small));
    expect(g.reasons).toContain('too_small');
    expect(gateHint(g.reasons)).toMatch(/step back/i);
  });

  it('classifies side and back views', () => {
    expect(classifyView(figure({ view: 'side' }), FRAME)).toBe('left');
    expect(classifyView(figure({ view: 'back' }), FRAME)).toBe('back');
    expect(classifyView([], FRAME)).toBe('none');
  });

  it('heightSpanStable tolerates 2 % jitter and rejects 10 %', () => {
    expect(heightSpanStable([0.8, 0.805, 0.795, 0.8, 0.802])).toBe(true);
    expect(heightSpanStable([0.8, 0.9, 0.8, 0.7, 0.8])).toBe(false);
    expect(heightSpanStable([0.8])).toBe(false);
  });

  it('selects the best front and side frames of a recording', () => {
    const front = figure();
    const side = figure({ view: 'side' });
    const tilted = figure({ tiltDeg: 7 });
    const seq = [tilted, front, front, front, front, side, side, side, side];
    const spans: number[] = [];
    const frames: FrameFeatures[] = seq.map((lm, index) => {
      const gate = gateFrame(lm, FRAME, spans);
      spans.push(gate.features.heightSpan);
      return { index, timestamp: index * 66, gate };
    });
    const sel = selectFrames(frames);
    expect(sel).not.toBeNull();
    // the first stable, untilted front frame wins (index 0 is tilted, 1 has too little span history)
    expect([2, 3, 4]).toContain(sel?.frontIndex);
    expect(sel?.sideIndex).toBeGreaterThanOrEqual(5);
    expect(frontScore(front && gateFeatures(front, FRAME))).toBeGreaterThan(0);
    expect(sideScore(gateFeatures(side, FRAME), [])).toBeGreaterThan(0);
    expect(sideScore(gateFeatures(side, FRAME), ['arms_not_in_a_pose'])).toBeGreaterThan(0);
    expect(sideScore(gateFeatures(side, FRAME), ['low_visibility'])).toBeGreaterThan(0); // far-side occlusion
    expect(sideScore({ ...gateFeatures(side, FRAME), visibilityMin: 0.2 }, ['low_visibility'])).toBe(0);
    expect(sideScore(gateFeatures(side, FRAME), ['tilted'])).toBe(0);
  });

  it('returns null when no front frame is usable', () => {
    const frames: FrameFeatures[] = [{ index: 0, timestamp: 0, gate: gateFrame(figure({ tiltDeg: 9 }), FRAME, []) }];
    expect(selectFrames(frames)).toBeNull();
    expect(gateHint(['no_person'])).toMatch(/step into/i);
    expect(gateHint([])).toMatch(/hold/i);
  });
});
