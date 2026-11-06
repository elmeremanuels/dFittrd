/**
 * "About you" for the standalone embed (docs/STANDALONE.md §1.3.2): height, weight, fit preference,
 * optional age range and sizing chart, and an optional "I know my measurements" section. Pure, so
 * it is unit-tested without a DOM.
 *
 * Girths the shopper does not enter come from the population prior through the capture feature's
 * `fuseProfile` (source 'prior', σ ≈ 2–4 cm), so the fit engine sees an honestly lower confidence.
 * Nothing in here is ever sent to the server.
 */
import { computeFit, isPointFit, sigmaFromBodyProfile, type FitResult, type PointFit, type SizeFit } from '@curtain/fit-engine';
import { toUserBody, type BodyMeasurementKey, type BodyProfile, type GarmentCategory, type GarmentPayload, type UserBody } from '@curtain/schema';
import { fuseProfile, type ManualEntries } from '@/features/capture/fuse';
import type { Sex } from '@/features/capture/types';
import { cmToFtIn, cmToIn, ftInToCm, inToCm, IN_PER_FT, isUnits, kgToLb, lbToKg, lengthText, metricText, numberText, round1, type Units } from './units';

export const FIT_PREFERENCES = ['snug', 'regular', 'relaxed'] as const;
export type FitPreference = (typeof FIT_PREFERENCES)[number];

export const AGE_RANGES = ['', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

/** What the shopper typed while in imperial units (the metric fields hold the converted value). */
export interface ImperialEntries {
  heightFt: string;
  heightIn: string;
  /** lb */
  weight: string;
  /** in */
  bust: string;
  waist: string;
  hip: string;
  inseam: string;
}

export type ImperialKey = keyof ImperialEntries;

export const EMPTY_IMPERIAL: ImperialEntries = { heightFt: '', heightIn: '', weight: '', bust: '', waist: '', hip: '', inseam: '' };

/**
 * The About-you answers. `height`, `weight` and the girths are always the canonical METRIC values
 * (cm, kg) the fit engine reads, whatever `units` the shopper types in; `imperial` keeps the
 * imperial text as typed (see units.ts).
 */
export interface AboutForm {
  height: string;
  weight: string;
  /** The system the inputs are shown in. */
  units: Units;
  imperial: ImperialEntries;
  preference: FitPreference;
  /** Optional, stays on this device; not used by the fit engine. */
  ageRange: AgeRange;
  /** Which population prior to use for missing girths. */
  sex: Sex;
  /** "I know my measurements" section open. */
  knowsMeasurements: boolean;
  bust: string;
  waist: string;
  hip: string;
  inseam: string;
  footEu: string;
  /** "Measured with a tape" (σ 1.5 cm) vs. from memory (σ 2.5 cm). */
  tape: boolean;
}

export const EMPTY_ABOUT: AboutForm = {
  height: '',
  weight: '',
  units: 'metric',
  imperial: EMPTY_IMPERIAL,
  preference: 'regular',
  ageRange: '',
  sex: 'unspecified',
  knowsMeasurements: false,
  bust: '',
  waist: '',
  hip: '',
  inseam: '',
  footEu: '',
  tape: false,
};

export type AboutField = 'height' | 'weight' | 'bust' | 'waist' | 'hip' | 'inseam' | 'footEu';

export const ABOUT_RANGES: Record<AboutField, readonly [number, number]> = {
  height: [120, 230],
  weight: [30, 250],
  bust: [60, 180],
  waist: [45, 180],
  hip: [60, 190],
  inseam: [50, 110],
  footEu: [30, 52],
};

export const ABOUT_LABELS: Record<AboutField, string> = {
  height: 'Height',
  weight: 'Weight',
  bust: 'Bust / chest',
  waist: 'Waist',
  hip: 'Hip',
  inseam: 'Inseam',
  footEu: 'Shoe size (EU)',
};

/** Metric units of each field (the canonical values). For the shopper's own units use `unitFor`. */
export const ABOUT_UNITS: Record<AboutField, string> = { height: 'cm', weight: 'kg', bust: 'cm', waist: 'cm', hip: 'cm', inseam: 'cm', footEu: 'EU' };

/**
 * The optional tape fields worth asking for this garment under "I know my measurements" (inseam
 * only for bottoms). Shoes have none: their only fit point is the shoe size, which is required.
 */
export function measurementFieldsFor(category: GarmentCategory): AboutField[] {
  if (category === 'shoes') return [];
  if (category === 'bottom') return ['waist', 'hip', 'inseam'];
  return ['bust', 'waist', 'hip'];
}

/**
 * Fields this garment cannot be fitted without (F1): the population prior fills girths, never a
 * shoe size, so shoes always ask for it on the main About-you screen.
 */
export function requiredFieldsFor(category: GarmentCategory): AboutField[] {
  return category === 'shoes' ? ['footEu'] : [];
}

const REQUIRED_TEXT: Record<Units, Partial<Record<AboutField, string>>> = {
  metric: { height: 'Enter your height in cm', weight: 'Enter your weight in kg', footEu: 'Enter your EU shoe size' },
  imperial: { height: 'Enter your height in feet and inches', weight: 'Enter your weight in lb', footEu: 'Enter your EU shoe size' },
};

/** Fields typed in imperial units when `units` is imperial (the EU shoe size never is). */
export function isImperialField(f: AboutField): f is Exclude<AboutField, 'footEu'> {
  return f !== 'footEu';
}

/** The unit shown next to a field. Height in imperial has two inputs (ft and in): its total is in inches. */
export function unitFor(field: AboutField, units: Units): string {
  if (field === 'footEu') return 'EU';
  if (units === 'metric') return field === 'weight' ? 'kg' : 'cm';
  return field === 'weight' ? 'lb' : 'in';
}

/**
 * The accepted range in the shopper's units (height in imperial: total inches). The imperial
 * bounds are the metric ones converted and rounded inwards, so every value inside them is inside
 * the metric range the fit engine was validated for.
 */
export function rangeFor(field: AboutField, units: Units): readonly [number, number] {
  const [lo, hi] = ABOUT_RANGES[field];
  if (units === 'metric' || !isImperialField(field)) return [lo, hi];
  const conv = field === 'weight' ? kgToLb : cmToIn;
  return [Math.ceil(conv(lo) - 1e-9), Math.floor(conv(hi) + 1e-9)];
}

const ftIn = (totalIn: number): string => `${Math.floor(totalIn / IN_PER_FT)} ft ${totalIn % IN_PER_FT} in`;

/** "Between 120 and 230 cm" / "Between 4 ft 0 in and 7 ft 6 in" / "Between 67 and 551 lb". */
export function rangeText(field: AboutField, units: Units): string {
  const [lo, hi] = rangeFor(field, units);
  if (units === 'imperial' && field === 'height') return `Between ${ftIn(lo)} and ${ftIn(hi)}`;
  return `Between ${lo} and ${hi} ${unitFor(field, units)}`;
}

type FieldRead = { state: 'empty' } | { state: 'invalid'; message: string } | { state: 'ok'; metric: number };

const readNumber = (raw: string, toMetric: (n: number) => number): FieldRead => {
  if (raw.trim() === '') return { state: 'empty' };
  const n = parseDecimal(raw);
  return n === null ? { state: 'invalid', message: 'Enter a number' } : { state: 'ok', metric: toMetric(n) };
};

function readHeightFtIn(ftRaw: string, inRaw: string): FieldRead {
  if (ftRaw.trim() === '' && inRaw.trim() === '') return { state: 'empty' };
  const ft = ftRaw.trim() === '' ? 0 : parseDecimal(ftRaw);
  const inches = inRaw.trim() === '' ? 0 : parseDecimal(inRaw);
  if (ft === null || inches === null) return { state: 'invalid', message: 'Enter a number' };
  if (ft < 0 || !Number.isInteger(ft)) return { state: 'invalid', message: 'Enter whole feet, e.g. 5 ft 7 in' };
  if (inches < 0 || inches >= IN_PER_FT) return { state: 'invalid', message: 'Inches go from 0 to 11.9' };
  return { state: 'ok', metric: ftInToCm(ft, inches) };
}

/** A field's value in metric (cm / kg / EU), read from what the shopper typed in their units. */
function readField(form: AboutForm, f: AboutField): FieldRead {
  if (form.units === 'metric' || !isImperialField(f)) return readNumber(form[f], (n) => n);
  if (f === 'height') return readHeightFtIn(form.imperial.heightFt, form.imperial.heightIn);
  if (f === 'weight') return readNumber(form.imperial.weight, lbToKg);
  return readNumber(form.imperial[f], inToCm);
}

/**
 * Type into an imperial input: keeps the text as typed and sets the canonical metric field to its
 * exact conversion (0.1 cm / 0.1 kg), or empty while the text is empty or not a number.
 */
export function setImperialEntry(form: AboutForm, key: ImperialKey, value: string): AboutForm {
  const imperial = { ...form.imperial, [key]: value };
  const field: Exclude<AboutField, 'footEu'> = key === 'heightFt' || key === 'heightIn' ? 'height' : key;
  const next: AboutForm = { ...form, imperial };
  const read = readField({ ...next, units: 'imperial' }, field);
  next[field] = read.state === 'ok' ? metricText(read.metric) : '';
  return next;
}

/** Imperial text for a canonical metric value (height: inches to the nearest half). */
function imperialFrom(field: Exclude<AboutField, 'footEu'>, metric: number): Partial<ImperialEntries> {
  if (field === 'height') {
    const { ft, in: inches } = cmToFtIn(metric);
    return { heightFt: String(ft), heightIn: numberText(inches, 1) };
  }
  return { [field]: numberText(field === 'weight' ? kgToLb(metric) : cmToIn(metric), 1) };
}

const IMPERIAL_FIELDS = ['height', 'weight', 'bust', 'waist', 'hip', 'inseam'] as const;

/**
 * Switch the inputs to `units`. The canonical metric values never change, so the fit stays exactly
 * the same. Imperial text the shopper typed is kept while it still converts to the metric value;
 * otherwise (they typed in cm since) it is rewritten from the metric value.
 */
export function switchUnits(form: AboutForm, units: Units): AboutForm {
  if (units === form.units) return form;
  if (units === 'metric') return { ...form, units };
  const imperial: ImperialEntries = { ...form.imperial };
  for (const f of IMPERIAL_FIELDS) {
    const metric = parseDecimal(form[f]);
    const typed = readField({ ...form, units: 'imperial', imperial }, f);
    if (metric === null) {
      if (f === 'height') Object.assign(imperial, { heightFt: '', heightIn: '' });
      else imperial[f] = '';
      continue;
    }
    if (typed.state === 'ok' && round1(typed.metric) === round1(metric)) continue;
    Object.assign(imperial, imperialFrom(f, metric));
  }
  return { ...form, units, imperial };
}

/** A stored or partial About-you form (saved before units existed) as a complete one. */
export function normalizeAbout(raw: Partial<AboutForm> | null | undefined): AboutForm {
  const base: AboutForm = { ...EMPTY_ABOUT, ...(raw ?? {}) };
  return { ...base, units: isUnits(base.units) ? base.units : 'metric', imperial: { ...EMPTY_IMPERIAL, ...(raw?.imperial ?? {}) } };
}

export function parseDecimal(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Field → message; empty object when the form can be submitted. Height and weight are required.
 * Checks what the shopper typed in their own units (`form.units`).
 */
export function validateAbout(form: AboutForm, category: GarmentCategory): Partial<Record<AboutField, string>> {
  const errors: Partial<Record<AboutField, string>> = {};
  const required: AboutField[] = ['height', 'weight', ...requiredFieldsFor(category)];
  const fields: AboutField[] = [...required, ...(form.knowsMeasurements ? measurementFieldsFor(category) : [])];
  for (const f of fields) {
    const read = readField(form, f);
    if (read.state === 'empty') {
      const text = required.includes(f) ? REQUIRED_TEXT[form.units][f] : undefined;
      if (text) errors[f] = text;
      continue;
    }
    if (read.state === 'invalid') {
      errors[f] = read.message;
      continue;
    }
    // The metric range is the one the fit engine was validated for; imperial entries are checked
    // on their exact conversion and the message shows the (inward-rounded) bounds in their units.
    const [lo, hi] = ABOUT_RANGES[f];
    const n = round1(read.metric);
    if (n < lo || n > hi) errors[f] = rangeText(f, form.units);
  }
  return errors;
}

/** Manual entries for `fuseProfile` (only the fields the shopper actually typed). */
export function aboutEntries(form: AboutForm, category: GarmentCategory): ManualEntries {
  const out: ManualEntries = {};
  const put = (key: BodyMeasurementKey, raw: string): void => {
    const n = parseDecimal(raw);
    if (n !== null && n > 0) out[key] = n;
  };
  put('height', form.height);
  put('weight', form.weight);
  for (const f of requiredFieldsFor(category)) put(f, form[f]);
  if (form.knowsMeasurements) for (const f of measurementFieldsFor(category)) put(f, form[f]);
  return out;
}

/**
 * The on-device body profile from the About-you form: typed values as 'manual', the rest of
 * bust / waist / hip / thigh from the population prior ('prior', lower confidence).
 */
export function profileFromAbout(form: AboutForm, category: GarmentCategory, now = Date.now()): BodyProfile {
  return fuseProfile({
    manual: aboutEntries(form, category),
    manualMethod: form.tape ? 'tape' : 'memory',
    sex: form.sex,
    now,
  }).profile;
}

/**
 * After the camera scan (F5): keep what the shopper typed on About you that the scan's own form
 * does not ask for (inseam for bottoms, the shoe size). The scan's values win wherever it has one.
 */
export function mergeAboutIntoScan(scan: BodyProfile, form: AboutForm, category: GarmentCategory, now = Date.now()): BodyProfile {
  const typed = Object.keys(aboutEntries(form, category)) as BodyMeasurementKey[];
  const missing = typed.filter((k) => scan.measurements[k] === undefined);
  if (missing.length === 0) return scan;
  const fromAbout = profileFromAbout(form, category, now).measurements;
  const measurements = { ...scan.measurements };
  for (const k of missing) if (fromAbout[k]) measurements[k] = fromAbout[k];
  return { ...scan, measurements };
}

/** Which measurements came from the prior (shown as "estimated from height and weight"). */
export function priorKeys(profile: BodyProfile): BodyMeasurementKey[] {
  return (Object.entries(profile.measurements) as [BodyMeasurementKey, { source: string } | undefined][]).filter(([, m]) => m?.source === 'prior').map(([k]) => k);
}

export interface EmbedFit {
  userBody: UserBody;
  fit: FitResult;
}

export function fitForProfile(garment: GarmentPayload, profile: BodyProfile): EmbedFit {
  const userBody = toUserBody(profile);
  const sigma = sigmaFromBodyProfile(profile);
  return { userBody, fit: computeFit(garment, userBody, sigma ? { sigma } : undefined) };
}

/** A neighbour within this score of the engine's pick may be chosen for a snug / relaxed preference. */
export const PREFERENCE_SCORE_SLACK = 0.12;

export interface SizeAdvice {
  /** The size we recommend after the preference (null when nothing fits). */
  size: string | null;
  /** The closest size when nothing fits; equals `size` otherwise. */
  closest: string | null;
  /** The engine's own recommendation before the preference. */
  engineSize: string | null;
  /** The preference moved the recommendation by one size. */
  adjusted: 'down' | 'up' | null;
  /**
   * No size could be scored at all (F1): the garment's fit points are all missing from the profile
   * (a shoe without a shoe size, a shoulder-only chart). We cannot recommend anything yet, and the
   * engine's placeholder (its first size, confidence 0) is never shown or reported.
   */
  noPoints: boolean;
}

/** True when the engine could not score a single size (it then falls back to the first size). */
export function hasNoFitPoints(fit: FitResult): boolean {
  return fit.perSize.length === 0 || fit.perSize.every((s) => s.score === null);
}

/**
 * Apply the fit preference on top of the engine: 'snug' takes the next smaller size, 'relaxed'
 * the next larger one, but only when that size is wearable (no tight point) and scores within
 * PREFERENCE_SCORE_SLACK of the engine's pick. Otherwise the engine's size stands.
 */
export function adviseSize(fit: FitResult, preference: FitPreference): SizeAdvice {
  if (hasNoFitPoints(fit)) return { size: null, closest: null, engineSize: null, adjusted: null, noPoints: true };
  const engineSize = fit.recommendedSize;
  if (engineSize === null) return { size: null, closest: fit.closestSize, engineSize: null, adjusted: null, noPoints: false };
  const base: SizeAdvice = { size: engineSize, closest: engineSize, engineSize, adjusted: null, noPoints: false };
  if (preference === 'regular') return base;
  const idx = fit.perSize.findIndex((s) => s.size === engineSize);
  const pick = fit.perSize[idx];
  const neighbour = fit.perSize[preference === 'snug' ? idx - 1 : idx + 1];
  if (idx < 0 || !pick || !neighbour || !neighbour.wearable || neighbour.score === null) return base;
  if (pick.score !== null && neighbour.score < pick.score - PREFERENCE_SCORE_SLACK) return base;
  return { size: neighbour.size, closest: neighbour.size, engineSize, adjusted: preference === 'snug' ? 'down' : 'up', noPoints: false };
}

/** The recommended size and its direct neighbours, in chart order. */
export function neighbourSizes(fit: FitResult, centre: string | null): SizeFit[] {
  const idx = fit.perSize.findIndex((s) => s.size === centre);
  if (idx < 0) return fit.perSize.slice(0, 3);
  return fit.perSize.slice(Math.max(0, idx - 1), idx + 2);
}

/** Which About-you field supplies each fit point (points the form cannot collect are absent). */
const FIELD_FOR_POINT: Partial<Record<string, AboutField>> = { bust: 'bust', waist: 'waist', hip: 'hip', inseam: 'inseam', foot: 'footEu' };
/** The engine flags a point below this confidence as low-confidence (fit-engine LOW_CONFIDENCE_BELOW). */
const LOW_POINT_CONFIDENCE = 0.7;

const meanPointConfidence = (s: SizeFit | undefined): { mean: number; used: number } => {
  const used = s ? s.points.filter(isPointFit) : [];
  return { mean: used.length === 0 ? 0 : used.reduce((a, p) => a + p.confidence, 0) / used.length, used: used.length };
};

/**
 * The confidence of `size`, computed the way computeFit computes it for its own pick
 * (mean point confidence × true-to-size factor × used / applicable points). The engine's factor
 * for this garment and body is recovered from its own pick, so no engine internals are duplicated.
 */
export function sizeConfidence(fit: FitResult, size: string): number {
  const engineName = fit.closestSize ?? fit.recommendedSize;
  if (size === engineName) return fit.confidence;
  const engine = meanPointConfidence(fit.perSize.find((p) => p.size === engineName));
  const target = meanPointConfidence(fit.perSize.find((p) => p.size === size));
  if (engine.mean <= 0 || engine.used === 0) return fit.confidence;
  const factor = fit.confidence / (engine.mean * engine.used);
  return Math.max(0, Math.min(1, Math.round(target.mean * target.used * factor * 1000) / 1000));
}

const lower = (point: string): string => pointLabel(point).toLowerCase();

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Shopper-facing notes for the size on screen (COPY-2, F3): built from that size's own points, in
 * plain words, with hints only for measurements the About-you form can actually collect.
 */
export function embedNotes(fit: FitResult, advice: SizeAdvice, category: GarmentCategory, profile: BodyProfile): string[] {
  const size = advice.size ?? advice.closest;
  const idx = fit.perSize.findIndex((p) => p.size === size);
  const s = fit.perSize[idx];
  if (!s) return [];
  const used = s.points.filter(isPointFit);
  const notes: string[] = [];
  if (!advice.size) {
    const worst = used.reduce<PointFit | undefined>((w, p) => (w === undefined || p.score < w.score ? p : w), undefined);
    if (worst) notes.push(`Closest is ${s.size}, ${bandText(worst.band).toLowerCase()} at the ${lower(worst.point)}`);
  }
  // No "size up/down" advice after the preference already moved the size (it would contradict it).
  const suggest = !advice.adjusted;
  for (const p of used) {
    const where = `at the ${lower(p.point)}`;
    const extra = p.inZone ? ' (stretch fabric there)' : '';
    if (p.band === 'tight') notes.push(`Tight ${where}${extra}${suggest && idx + 1 < fit.perSize.length ? ' — consider a size up' : ''}`);
    else if (p.band === 'snug') notes.push(`Snug ${where}${extra}`);
    else if (p.band === 'roomy') notes.push(`Roomy ${where}${extra}`);
    else if (p.band === 'loose') notes.push(`Loose ${where}${extra}${suggest && idx > 0 ? ' — consider a size down' : ''}`);
  }
  // Measurements worth adding: points we skipped for lack of a value, or that rest on an estimate.
  const collectable = new Set<AboutField>([...measurementFieldsFor(category), ...requiredFieldsFor(category)]);
  const add: string[] = [];
  for (const p of s.points) {
    const field = FIELD_FOR_POINT[p.point];
    if (!field || !collectable.has(field)) continue;
    const missing = !isPointFit(p) && p.omitted === 'user';
    const weak = isPointFit(p) && (p.confidence < LOW_POINT_CONFIDENCE || profile.measurements[field as BodyMeasurementKey]?.source === 'prior');
    if ((missing || weak) && !add.includes(lower(p.point))) add.push(lower(p.point));
  }
  if (add.length > 0) notes.push(`Add your ${joinWords(add)} ${add.length > 1 ? 'measurements' : 'measurement'} under Edit my measurements for a more confident result`);
  if (notes.length === 0) notes.push(`Size ${s.size} fits you well`);
  return notes;
}

/**
 * The FitResult as FitPanel shows it in the embed (F3, COPY-2): the score, confidence, notes and
 * "fits" of the size we actually recommend after the preference, never the engine pick's. No
 * tie-break label (developer jargon).
 */
export function fitWithAdvice(fit: FitResult, advice: SizeAdvice, category: GarmentCategory, profile: BodyProfile): FitResult {
  const size = advice.size ?? advice.closest;
  const s = fit.perSize.find((p) => p.size === size);
  if (!s) return { ...fit, tieBreak: null };
  return {
    ...fit,
    recommendedSize: advice.size,
    closestSize: s.size,
    score: s.score,
    confidence: advice.adjusted ? sizeConfidence(fit, s.size) : fit.confidence,
    fits: advice.size !== null && s.wearable,
    notes: embedNotes(fit, advice, category, profile),
    tieBreak: null,
  };
}

export function usablePoints(size: SizeFit | undefined): PointFit[] {
  return size ? size.points.filter(isPointFit) : [];
}

const POINT_LABEL: Record<string, string> = { bust: 'Bust', waist: 'Waist', hip: 'Hip', shoulder: 'Shoulders', thigh: 'Thigh', inseam: 'Leg length', foot: 'Foot' };

export function pointLabel(point: string): string {
  return POINT_LABEL[point] ?? point;
}

const BAND_TEXT: Record<PointFit['band'], string> = { tight: 'Tight', snug: 'Snug', good: 'Good fit', roomy: 'Roomy', loose: 'Loose' };

export function bandText(band: PointFit['band']): string {
  return BAND_TEXT[band];
}

/** "2.0 cm more room than designed" / "0.6 in less room …", relative to the ease the garment is designed for. */
export function gapText(p: PointFit, units: Units = 'metric'): string {
  const d = Math.round(p.gapCm * 10) / 10;
  if (Math.abs(d) < 0.5) return 'as designed';
  return d > 0 ? `${lengthText(d, units)} more room than designed` : `${lengthText(Math.abs(d), units)} less room than designed`;
}
