import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/api/client';
import { classifyError, flowReducer, INITIAL_FLOW, type FlowEvent, type FlowState } from '../flow';

const run = (events: FlowEvent[], from: FlowState = INITIAL_FLOW): FlowState => events.reduce(flowReducer, from);

describe('embed flow state machine', () => {
  it('new shopper: loading → about → result', () => {
    const s1 = run([{ type: 'resolved', paused: false, remembered: false }]);
    expect(s1.step).toBe('about');
    const s2 = flowReducer(s1, { type: 'submitAbout', scan: false });
    expect(s2).toEqual({ step: 'result', blocked: null, returning: false, editing: false });
  });

  it('optional scan: about → scan → result on done or skip', () => {
    const scan = run([{ type: 'resolved', paused: false, remembered: false }, { type: 'submitAbout', scan: true }]);
    expect(scan.step).toBe('scan');
    expect(flowReducer(scan, { type: 'scanDone' }).step).toBe('result');
    expect(flowReducer(scan, { type: 'scanSkipped' }).step).toBe('result');
  });

  it('returning shopper goes straight to the result and can edit', () => {
    const s = run([{ type: 'resolved', paused: false, remembered: true }]);
    expect(s).toMatchObject({ step: 'result', returning: true });
    const edit = flowReducer(s, { type: 'edit' });
    expect(edit).toMatchObject({ step: 'about', editing: true });
    expect(flowReducer(edit, { type: 'submitAbout', scan: false })).toMatchObject({ step: 'result', editing: false, returning: false });
  });

  it('a paused shop blocks before the form, and a 402 later blocks the result', () => {
    expect(run([{ type: 'resolved', paused: true, remembered: true }])).toMatchObject({ step: 'blocked', blocked: 'paused' });
    const result = run([{ type: 'resolved', paused: false, remembered: true }, { type: 'paused' }]);
    expect(result).toMatchObject({ step: 'blocked', blocked: 'paused' });
    // paused is final: retry does nothing
    expect(flowReducer(result, { type: 'retry' })).toBe(result);
  });

  it('failures block; only offline / error can be retried', () => {
    for (const kind of ['expired', 'incomplete', 'paused'] as const) {
      const s = run([{ type: 'failed', kind }]);
      expect(s).toMatchObject({ step: 'blocked', blocked: kind });
      expect(flowReducer(s, { type: 'retry' })).toBe(s);
    }
    for (const kind of ['offline', 'error'] as const) {
      expect(flowReducer(run([{ type: 'failed', kind }]), { type: 'retry' })).toEqual(INITIAL_FLOW);
    }
  });

  it('ignores events that do not apply to the current step', () => {
    const about = run([{ type: 'resolved', paused: false, remembered: false }]);
    expect(flowReducer(about, { type: 'scanDone' })).toBe(about);
    expect(flowReducer(about, { type: 'edit' })).toBe(about);
    expect(flowReducer(about, { type: 'resolved', paused: true, remembered: false })).toBe(about);
    expect(flowReducer(INITIAL_FLOW, { type: 'submitAbout', scan: false })).toBe(INITIAL_FLOW);
  });

  it('forget me returns to About you', () => {
    const s = run([{ type: 'resolved', paused: false, remembered: true }, { type: 'forgotten' }]);
    expect(s).toEqual({ step: 'about', blocked: null, returning: false, editing: false });
    expect(flowReducer(INITIAL_FLOW, { type: 'forgotten' })).toBe(INITIAL_FLOW);
  });

  it('classifies resolve errors into screens', () => {
    expect(classifyError(new NetworkError('x'))).toBe('offline');
    expect(classifyError(new ApiError(410, 'gone', 'expired'))).toBe('expired');
    expect(classifyError(new ApiError(401, 'invalid_try_token', 'bad'))).toBe('expired');
    expect(classifyError(new ApiError(409, 'already_resolved', 'other device'))).toBe('expired');
    expect(classifyError(new ApiError(402, 'shop_paused', 'paused'))).toBe('paused');
    expect(classifyError(new ApiError(422, 'product_incomplete', 'todo'))).toBe('incomplete');
    expect(classifyError(new ApiError(404, 'not_found', 'gone'))).toBe('incomplete');
    expect(classifyError(new ApiError(500, 'internal', 'boom'))).toBe('error');
  });
});
