/**
 * The embed's screen state machine (docs/STANDALONE.md §1.3). Pure reducer, unit-tested.
 *
 *   loading ──resolved──▶ about ──submit──▶ result          (no scan)
 *      │         │           └──submit+scan──▶ scan ──done/skip──▶ result
 *      │         ├─(remembered profile)──────────────────────────▶ result (returning)
 *      │         └─(shop paused)──▶ blocked:paused
 *      └──failed──▶ blocked:{expired | paused | incomplete | offline | busy | error}
 *   result ──edit──▶ about ;  any ──paused (fit-shown 402)──▶ blocked:paused
 *   blocked:{offline | busy | error} ──retry──▶ loading ;  forgotten ──▶ about
 */
import { ApiError, NetworkError } from '@/api/client';

export type BlockedKind = 'expired' | 'paused' | 'incomplete' | 'offline' | 'busy' | 'error';
export type Step = 'loading' | 'about' | 'scan' | 'result' | 'blocked';

export interface FlowState {
  step: Step;
  blocked: BlockedKind | null;
  /** The result came from a remembered profile (shows "Edit my measurements" prominently). */
  returning: boolean;
  /** About-you was reopened from the result. */
  editing: boolean;
}

export type FlowEvent =
  | { type: 'resolved'; paused: boolean; remembered: boolean }
  | { type: 'failed'; kind: BlockedKind }
  | { type: 'submitAbout'; scan: boolean }
  | { type: 'scanDone' }
  | { type: 'scanSkipped' }
  | { type: 'edit' }
  | { type: 'paused' }
  | { type: 'retry' }
  | { type: 'forgotten' };

export const INITIAL_FLOW: FlowState = { step: 'loading', blocked: null, returning: false, editing: false };

const RETRYABLE: readonly BlockedKind[] = ['offline', 'busy', 'error'];

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'resolved':
      if (state.step !== 'loading') return state;
      if (event.paused) return { ...state, step: 'blocked', blocked: 'paused' };
      return event.remembered ? { step: 'result', blocked: null, returning: true, editing: false } : { step: 'about', blocked: null, returning: false, editing: false };
    case 'failed':
      if (state.step !== 'loading') return state;
      return { ...state, step: 'blocked', blocked: event.kind };
    case 'submitAbout':
      if (state.step !== 'about') return state;
      return { ...state, step: event.scan ? 'scan' : 'result', editing: false, returning: false };
    case 'scanDone':
    case 'scanSkipped':
      if (state.step !== 'scan') return state;
      return { ...state, step: 'result' };
    case 'edit':
      if (state.step !== 'result') return state;
      return { ...state, step: 'about', editing: true };
    case 'paused':
      return { ...state, step: 'blocked', blocked: 'paused' };
    case 'retry':
      if (state.step !== 'blocked' || !state.blocked || !RETRYABLE.includes(state.blocked)) return state;
      return INITIAL_FLOW;
    case 'forgotten':
      if (state.step === 'blocked' || state.step === 'loading') return state;
      return { step: 'about', blocked: null, returning: false, editing: false };
    default:
      return state;
  }
}

/** Map a resolve error to the screen that explains it. */
export function classifyError(e: unknown): BlockedKind {
  if (e instanceof NetworkError) return 'offline';
  if (e instanceof ApiError) {
    if (e.status === 402 || e.code === 'shop_paused') return 'paused';
    // Rate limit (device minting or try lookups per IP, AVAIL-1): many shoppers behind one NAT IP.
    if (e.status === 429) return 'busy';
    if (e.status === 410 || e.code === 'invalid_try_token' || e.code === 'already_resolved' || e.status === 401) return 'expired';
    if (e.status === 422 || e.code === 'product_incomplete' || e.status === 404) return 'incomplete';
    return 'error';
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'error';
}
