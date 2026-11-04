import { describe, expect, it } from 'vitest';
import { PASS_REASONS, SWIPE_ACTIONS, SWIPE_LEARNING_RATE, SWIPE_SIGN, SwipeEventSchema, type SwipeEvent } from './swipe';

describe('swipe types', () => {
  it('match taste-engine-spec.md exactly', () => {
    expect(SWIPE_ACTIONS).toEqual(['love', 'pass', 'save', 'less']);
    expect(PASS_REASONS).toEqual(['fit', 'price', 'colour', 'style', 'unknown']);
    expect(SWIPE_LEARNING_RATE).toEqual({ love: 0.12, save: 0.18, pass: 0.06, less: 0.2 });
    expect(SWIPE_SIGN).toEqual({ love: 1, save: 1, pass: -1, less: -1 });
  });

  it('validates the test-vector event shapes', () => {
    const love: SwipeEvent = { itemId: 'aalter-studio-1', action: 'love', at: 1_730_000_000_000, sizeAtSwipe: 'M', fitScore: 1, dealIndex: 0 };
    const pass: SwipeEvent = { itemId: 'raw-denim-01', action: 'pass', at: 1_730_000_000_000, sizeAtSwipe: null, fitScore: 0.2, reasons: ['fit'], dealIndex: 3 };
    expect(SwipeEventSchema.safeParse(love).success).toBe(true);
    expect(SwipeEventSchema.safeParse(pass).success).toBe(true);
    expect(SwipeEventSchema.parse(JSON.parse(JSON.stringify(pass)))).toEqual(pass);
  });

  it('rejects unknown actions, reasons and out-of-range scores', () => {
    const base = { itemId: 'x', at: 1, sizeAtSwipe: null, fitScore: null, dealIndex: 0 };
    expect(SwipeEventSchema.safeParse({ ...base, action: 'like' }).success).toBe(false);
    expect(SwipeEventSchema.safeParse({ ...base, action: 'pass', reasons: ['mood'] }).success).toBe(false);
    expect(SwipeEventSchema.safeParse({ ...base, action: 'love', fitScore: 1.5 }).success).toBe(false);
    expect(SwipeEventSchema.safeParse({ ...base, action: 'love', dealIndex: -1 }).success).toBe(false);
  });
});
