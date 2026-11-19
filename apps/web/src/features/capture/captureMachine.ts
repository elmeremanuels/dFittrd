/**
 * Pure state logic of the capture step (flow, manual-form validation, conversion to fusion input)
 * so it can be unit-tested without a DOM. The React components only render this state.
 */
import type { BodyMeasurementKey, ManualMethod } from '@curtain/schema';
import { appStrings } from '../../strings';
import type { ManualEntries } from './fuse';
import type { Sex } from './types';

export type Stage = 'intro' | 'face' | 'body' | 'manual' | 'fusion';
export const STAGES: readonly Stage[] = ['intro', 'face', 'body', 'manual', 'fusion'];

export interface FlowCaps {
  /** Camera + Worker + OffscreenCanvas available (null = not probed yet). */
  camera: boolean | null;
  /** MediaPipe models loaded in the worker. */
  models: 'idle' | 'loading' | 'ready' | 'failed';
}

/** The stage after `stage`, skipping camera stages when capture is impossible. */
export function nextStage(stage: Stage, caps: FlowCaps): Stage {
  const cameraOk = caps.camera === true && caps.models !== 'failed';
  switch (stage) {
    case 'intro':
      return cameraOk ? 'face' : 'manual';
    case 'face':
      return cameraOk ? 'body' : 'manual';
    case 'body':
      return 'manual';
    case 'manual':
      return 'fusion';
    case 'fusion':
      return 'fusion';
    default:
      return 'manual';
  }
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export interface ManualForm {
  height: string;
  weight: string;
  bust: string;
  waist: string;
  hip: string;
  footEu: string;
  method: ManualMethod;
  sex: Sex;
}

export const EMPTY_MANUAL_FORM: ManualForm = {
  height: '',
  weight: '',
  bust: '',
  waist: '',
  hip: '',
  footEu: '',
  method: 'memory',
  sex: 'unspecified',
};

export const MANUAL_RANGES: Record<'height' | 'weight' | 'bust' | 'waist' | 'hip' | 'footEu', readonly [number, number]> = {
  height: [120, 230],
  weight: [30, 250],
  bust: [60, 180],
  waist: [45, 180],
  hip: [60, 190],
  footEu: [30, 52],
};

export type ManualField = keyof typeof MANUAL_RANGES;
export const MANUAL_FIELDS: readonly ManualField[] = ['height', 'weight', 'bust', 'waist', 'hip', 'footEu'];

export function parseNumber(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Field → error message; empty object when valid. Height is the only required field. */
export function validateManual(form: ManualForm): Partial<Record<ManualField, string>> {
  const errors: Partial<Record<ManualField, string>> = {};
  for (const f of MANUAL_FIELDS) {
    const raw = form[f];
    const n = parseNumber(raw);
    if (raw.trim() === '') {
      if (f === 'height') errors[f] = appStrings().capture.measurements.errors.heightNeeded;
      continue;
    }
    if (n === null) {
      errors[f] = appStrings().capture.measurements.errors.notANumber;
      continue;
    }
    const [lo, hi] = MANUAL_RANGES[f];
    if (n < lo || n > hi) errors[f] = appStrings().capture.measurements.errors.range(lo, hi);
  }
  return errors;
}

/** Convert the form to fusion entries; `remeasures` override individual fields with the tape method. */
export function manualEntries(form: ManualForm, remeasures: Partial<Record<BodyMeasurementKey, number>> = {}): ManualEntries {
  const out: ManualEntries = {};
  for (const f of MANUAL_FIELDS) {
    const n = parseNumber(form[f]);
    if (n !== null && n > 0) out[f] = n;
  }
  for (const [k, v] of Object.entries(remeasures) as [BodyMeasurementKey, number | undefined][]) {
    if (v !== undefined && Number.isFinite(v) && v > 0) out[k] = { value: v, method: 'tape' };
  }
  return out;
}

const MEASUREMENT_KEYS: readonly BodyMeasurementKey[] = ['height', 'weight', 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot', 'footLengthCm', 'footEu', 'neck', 'sleeve'];
const TAPE_KEYS = ['bust', 'waist', 'hip', 'thigh', 'shoulder', 'inseam'] as const;
const METHOD_KEYS: readonly ManualMethod[] = ['tape', 'memory', 'guess'];

/**
 * A record whose values are read from the catalogue each time one is looked up, so the tables
 * below hold no text of their own and follow the interface locale (DECISIONS.md D21).
 */
function fromCatalogue<K extends string, V>(keys: readonly K[], read: (key: K) => V): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const key of keys) Object.defineProperty(out, key, { enumerable: true, get: () => read(key) });
  return out;
}

export const MEASUREMENT_LABELS: Record<BodyMeasurementKey, string> = fromCatalogue(MEASUREMENT_KEYS, (k) => appStrings().capture.measurements.labels[k]);

export const MEASUREMENT_UNITS: Record<BodyMeasurementKey, string> = fromCatalogue(MEASUREMENT_KEYS, (k) => appStrings().capture.measurements.units[k]);

/** ISO 8559-1 tape instructions shown in the remeasure UI. */
export const TAPE_INSTRUCTIONS: Partial<Record<BodyMeasurementKey, string>> = fromCatalogue(TAPE_KEYS, (k) => appStrings().capture.measurements.tape[k]);

export const METHOD_LABELS: Record<ManualMethod, { label: string; hint: string }> = fromCatalogue(METHOD_KEYS, (k) => appStrings().capture.measurements.methods[k]);

/** Body-scan protocol timing: 8 s total, front first then the side turn. */
export const SCAN_PROTOCOL = { totalMs: 8000, turnAtMs: 4000, minFramesFront: 6 } as const;

export function protocolPhase(elapsedMs: number): 'front' | 'side' | 'done' {
  if (elapsedMs >= SCAN_PROTOCOL.totalMs) return 'done';
  return elapsedMs < SCAN_PROTOCOL.turnAtMs ? 'front' : 'side';
}

export function confidencePercent(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}
