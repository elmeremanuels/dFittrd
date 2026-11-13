import { describe, expect, it } from 'vitest';
import { EMPTY_MANUAL_FORM, SCAN_PROTOCOL, manualEntries, nextStage, parseNumber, protocolPhase, validateManual } from '../captureMachine';
import { neighbourhood, retainedIndices } from '../frameRetainer';
import { choosePoseVariant } from '../models';

describe('capture flow', () => {
  it('walks intro → face → body → manual → fusion with a camera and models', () => {
    const caps = { camera: true, models: 'ready' } as const;
    expect(nextStage('intro', caps)).toBe('face');
    expect(nextStage('face', caps)).toBe('body');
    expect(nextStage('body', caps)).toBe('manual');
    expect(nextStage('manual', caps)).toBe('fusion');
    expect(nextStage('fusion', caps)).toBe('fusion');
  });

  it('skips the camera stages without a camera or when the models failed', () => {
    expect(nextStage('intro', { camera: false, models: 'idle' })).toBe('manual');
    expect(nextStage('intro', { camera: true, models: 'failed' })).toBe('manual');
    expect(nextStage('face', { camera: true, models: 'failed' })).toBe('manual');
  });

  it('protocol: 4 s front, 4 s side, 8 s total', () => {
    expect(SCAN_PROTOCOL.totalMs).toBe(8000);
    expect(protocolPhase(0)).toBe('front');
    expect(protocolPhase(3999)).toBe('front');
    expect(protocolPhase(4000)).toBe('side');
    expect(protocolPhase(8000)).toBe('done');
  });
});

describe('manual form', () => {
  it('requires height, validates ranges, accepts decimal commas', () => {
    expect(validateManual(EMPTY_MANUAL_FORM).height).toMatch(/height/i);
    const ok = validateManual({ ...EMPTY_MANUAL_FORM, height: '168', bust: '92,5' });
    expect(ok).toEqual({});
    expect(validateManual({ ...EMPTY_MANUAL_FORM, height: '168', waist: '20' }).waist).toMatch(/between/);
    expect(validateManual({ ...EMPTY_MANUAL_FORM, height: 'abc' }).height).toMatch(/number/);
    expect(parseNumber(' 70,5 ')).toBe(70.5);
    expect(parseNumber('')).toBeNull();
  });

  it('converts to fusion entries, with tape-method overrides for remeasures', () => {
    const e = manualEntries({ ...EMPTY_MANUAL_FORM, height: '168', bust: '92', footEu: '39' }, { bust: 94 });
    expect(e.height).toBe(168);
    expect(e.footEu).toBe(39);
    expect(e.bust).toEqual({ value: 94, method: 'tape' });
    expect(e.waist).toBeUndefined();
  });
});

describe('frame retention policy', () => {
  it('keeps best ± 1 for front and side plus the two latest frames', () => {
    const keep = retainedIndices({ frontIndex: 10, sideIndex: 40, latestIndex: 50 });
    expect([...keep].sort((a, b) => a - b)).toEqual([9, 10, 11, 39, 40, 41, 49, 50]);
    expect([...retainedIndices({ frontIndex: -1, sideIndex: -1, latestIndex: 0 })]).toEqual([0]);
    expect(neighbourhood(5, (i) => i !== 6)).toEqual([4, 5]);
    expect(neighbourhood(0, () => true)).toEqual([0, 1]);
  });
});

describe('model variant choice', () => {
  it('prefers lite on low-end devices', () => {
    expect(choosePoseVariant({ hardwareConcurrency: 4, deviceMemory: 4 })).toBe('lite');
    expect(choosePoseVariant({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe('full');
    expect(choosePoseVariant({})).toBe('lite');
  });
});
