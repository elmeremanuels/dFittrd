/**
 * "About you" for the standalone embed (docs/STANDALONE.md §1.3.2): height, weight, fit preference,
 * optional sizing chart, and an optional "I know my measurements" section. Pure, so
 * it is unit-tested without a DOM.
 *
 * Girths the shopper does not enter come from the population prior through the capture feature's
 * `fuseProfile` (source 'prior', σ ≈ 2–4 cm), so the fit engine sees an honestly lower confidence.
 * Nothing in here is ever sent to the server.
 */
import { computeFit, isPointFit, sigmaFromBodyProfile, type FitResult, type PointFit, type SizeFit } from '@curtain/fit-engine';
import { garmentBodyFamily, toUserBody, type BodyMeasurementKey, type BodyProfile, type GarmentCategory, type GarmentPayload, type UserBody } from '@curtain/schema';
import { fuseProfile, type ManualEntries } from '@/features/capture/fuse';
import type { Sex } from '@/features/capture/types';
import { embedStrings } from './strings';
import { cmToFtIn, cmToIn, ftInToCm, inToCm, IN_PER_FT, isUnits, kgToLb, lbToKg, lengthText, metricText, numberText, round1, type Units } from './units';

export const FIT_PREFERENCES = ['snug', 'regular', 'relaxed'] as const;
export type FitPreference = (typeof FIT_PREFERENCES)[number];

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
  /** Men's garments only (men-3d-plan slice M2): neck, arm length, shoulder width. */
  neck: string;
  sleeve: string;
  shoulder: string;
  /** Men's bottoms only, when the chart has a thigh column. */
  thigh: string;
}

export type ImperialKey = keyof ImperialEntries;

export const EMPTY_IMPERIAL: ImperialEntries = { heightFt: '', heightIn: '', weight: '', bust: '', waist: '', hip: '', inseam: '', neck: '', sleeve: '', shoulder: '', thigh: '' };

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
  /** Which population prior to use for missing girths. */
  sex: Sex;
  /** "I know my measurements" section open. */
  knowsMeasurements: boolean;
  bust: string;
  waist: string;
  hip: string;
  inseam: string;
  footEu: string;
  /**
   * Asked only for a men's garment (slice M2), only when its chart has the column, and only ever
   * typed in: neck girth, arm length (shoulder over the bent elbow to the wrist) and shoulder width
   * (across the back, shoulder bone to shoulder bone). Never estimated from height and weight.
   */
  neck: string;
  sleeve: string;
  shoulder: string;
  /**
   * Asked only for a men's bottom whose chart has a thigh column: the girth of one thigh at its
   * fullest. Optional. Typed in, it is stored as 'manual'; left empty, the thigh is what it was
   * before this field existed: the population prior's estimate (source 'prior'), never shown as measured.
   */
  thigh: string;
  /** "Measured with a tape" (σ 1.5 cm) vs. from memory (σ 2.5 cm). */
  tape: boolean;
}

export const EMPTY_ABOUT: AboutForm = {
  height: '',
  weight: '',
  units: 'metric',
  imperial: EMPTY_IMPERIAL,
  preference: 'regular',
  sex: 'unspecified',
  knowsMeasurements: false,
  bust: '',
  waist: '',
  hip: '',
  inseam: '',
  footEu: '',
  neck: '',
  sleeve: '',
  shoulder: '',
  thigh: '',
  tape: false,
};

export type AboutField = 'height' | 'weight' | 'bust' | 'waist' | 'hip' | 'inseam' | 'footEu' | 'neck' | 'sleeve' | 'shoulder' | 'thigh';

/**
 * Accepted ranges, cm (kg, EU). The men's three [A]: wide enough for the male family's S…XXL ±2
 * sizes (neck 37.5–45.75, biacromial 40–43.5, EN arm length about 64 at 172 cm; plan §3 and §4).
 * The thigh [A]: the male family's S…XXL is 54–71.5; the bounds are those the schema calls plausible
 * for a chart's thigh column (35–110).
 */
export const ABOUT_RANGES: Record<AboutField, readonly [number, number]> = {
  height: [120, 230],
  weight: [30, 250],
  bust: [60, 180],
  waist: [45, 180],
  hip: [60, 190],
  inseam: [50, 110],
  footEu: [30, 52],
  neck: [28, 60],
  sleeve: [45, 85],
  shoulder: [30, 60],
  thigh: [35, 110],
};

/** Metric units of each field (the canonical values). For the shopper's own units use `unitFor`. */
export const ABOUT_UNITS: Record<AboutField, string> = { height: 'cm', weight: 'kg', bust: 'cm', waist: 'cm', hip: 'cm', inseam: 'cm', footEu: 'EU', neck: 'cm', sleeve: 'cm', shoulder: 'cm', thigh: 'cm' };

/** What the form reads from a garment beyond its category (men's garments, slice M2). */
export type AboutGarment = Pick<GarmentPayload, 'category'> & Partial<Pick<GarmentPayload, 'audience' | 'sizeChart'>>;

/** A garment cut for men: the form asks the men's measurements and the result shows the men's points. */
export function isMensGarment(garment: Partial<Pick<GarmentPayload, 'audience'>> | null | undefined): boolean {
  return garment?.audience === 'men';
}

const chartHasColumn = (garment: AboutGarment | undefined, key: 'neck' | 'sleeve' | 'shoulder' | 'thigh'): boolean =>
  Array.isArray(garment?.sizeChart) && garment.sizeChart.some((r) => typeof r[key] === 'number' && r[key] > 0);

/**
 * The optional tape fields worth asking for this garment under "I know my measurements" (inseam
 * only for bottoms). Shoes have none: their only fit point is the shoe size, which is required.
 *
 * A men's garment (slice M2): tops ask chest and waist (the waist is scored on men's tops, the seat
 * is not) plus shoulder width, neck and arm length, each only when the size chart has that column;
 * bottoms ask waist, seat and inside leg, plus the thigh when the size chart has that column (optional;
 * left empty, the thigh stays the prior's estimate as before). Without `garment` (or for women's and unisex garments) the
 * list is what it was.
 */
export function measurementFieldsFor(category: GarmentCategory, garment?: AboutGarment): AboutField[] {
  if (category === 'shoes') return [];
  const mens = isMensGarment(garment);
  if (category === 'bottom') return mens && chartHasColumn(garment, 'thigh') ? ['waist', 'hip', 'thigh', 'inseam'] : ['waist', 'hip', 'inseam'];
  if (!mens || category !== 'top') return ['bust', 'waist', 'hip'];
  const extra = (['shoulder', 'neck', 'sleeve'] as const).filter((k) => chartHasColumn(garment, k));
  return ['bust', 'waist', ...extra];
}

/**
 * Fields this garment cannot be fitted without (F1): the population prior fills girths, never a
 * shoe size, so shoes always ask for it on the main About-you screen.
 */
export function requiredFieldsFor(category: GarmentCategory): AboutField[] {
  return category === 'shoes' ? ['footEu'] : [];
}

/**
 * The men's fields: typed in or absent, never estimated (no prior exists for them). The men's thigh
 * is not one of them: it has a prior, which a bottom's fit used before the field existed and still
 * uses while the field is empty (see `profileFromAbout`).
 */
export const MENS_ONLY_FIELDS: readonly AboutField[] = ['neck', 'sleeve', 'shoulder'];

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
  const between = embedStrings().about.errors.between;
  if (units === 'imperial' && field === 'height') return between(ftIn(lo), ftIn(hi));
  return between(lo, hi, unitFor(field, units));
}

type FieldRead = { state: 'empty' } | { state: 'invalid'; message: string } | { state: 'ok'; metric: number };

const readNumber = (raw: string, toMetric: (n: number) => number): FieldRead => {
  if (raw.trim() === '') return { state: 'empty' };
  const n = parseDecimal(raw);
  return n === null ? { state: 'invalid', message: embedStrings().about.errors.number } : { state: 'ok', metric: toMetric(n) };
};

function readHeightFtIn(ftRaw: string, inRaw: string): FieldRead {
  if (ftRaw.trim() === '' && inRaw.trim() === '') return { state: 'empty' };
  const ft = ftRaw.trim() === '' ? 0 : parseDecimal(ftRaw);
  const inches = inRaw.trim() === '' ? 0 : parseDecimal(inRaw);
  if (ft === null || inches === null) return { state: 'invalid', message: embedStrings().about.errors.number };
  if (ft < 0 || !Number.isInteger(ft)) return { state: 'invalid', message: embedStrings().about.errors.wholeFeet };
  if (inches < 0 || inches >= IN_PER_FT) return { state: 'invalid', message: embedStrings().about.errors.inches };
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

const IMPERIAL_FIELDS = ['height', 'weight', 'bust', 'waist', 'hip', 'inseam', 'neck', 'sleeve', 'shoulder', 'thigh'] as const;

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

/**
 * A stored or partial About-you form (saved before units existed) as a complete one. A form saved
 * while the age-range question existed (removed by D25 point 6: nothing used it) still opens; its
 * `ageRange` is dropped here, so it is not kept in memory and is gone from the device at the next save.
 */
export function normalizeAbout(raw: (Partial<AboutForm> & { ageRange?: unknown }) | null | undefined): AboutForm {
  const { ageRange: _removed, ...stored } = raw ?? {};
  const base: AboutForm = { ...EMPTY_ABOUT, ...stored };
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
export function validateAbout(form: AboutForm, category: GarmentCategory, garment?: AboutGarment): Partial<Record<AboutField, string>> {
  const errors: Partial<Record<AboutField, string>> = {};
  const required: AboutField[] = ['height', 'weight', ...requiredFieldsFor(category)];
  const fields: AboutField[] = [...required, ...(form.knowsMeasurements ? measurementFieldsFor(category, garment) : [])];
  for (const f of fields) {
    const read = readField(form, f);
    if (read.state === 'empty') {
      const text = required.includes(f) ? (embedStrings().about.errors.required[form.units] as Partial<Record<AboutField, string>>)[f] : undefined;
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
export function aboutEntries(form: AboutForm, category: GarmentCategory, garment?: AboutGarment): ManualEntries {
  const out: ManualEntries = {};
  const put = (key: BodyMeasurementKey, raw: string): void => {
    const n = parseDecimal(raw);
    if (n !== null && n > 0) out[key] = n;
  };
  put('height', form.height);
  put('weight', form.weight);
  for (const f of requiredFieldsFor(category)) put(f, form[f]);
  if (form.knowsMeasurements) for (const f of measurementFieldsFor(category, garment)) put(f, form[f]);
  return out;
}

/**
 * The prior's body type: what the shopper chose; on a men's garment (slice M2), "Not specified" is
 * read as male, so the estimate of the chest, waist, seat and thigh is the male prior, not the
 * female/male mixture. Every other garment keeps the shopper's choice as before.
 */
export function priorSexFor(form: Pick<AboutForm, 'sex'>, garment?: AboutGarment): Sex {
  return form.sex === 'unspecified' && isMensGarment(garment) ? 'male' : form.sex;
}

/**
 * The on-device body profile from the About-you form: typed values as 'manual', the rest of
 * bust / waist / hip / thigh from the population prior ('prior', lower confidence).
 */
export function profileFromAbout(form: AboutForm, category: GarmentCategory, now = Date.now(), garment?: AboutGarment): BodyProfile {
  return fuseProfile({
    manual: aboutEntries(form, category, garment),
    manualMethod: form.tape ? 'tape' : 'memory',
    sex: priorSexFor(form, garment),
    now,
  }).profile;
}

/**
 * After the camera scan (F5): keep what the shopper typed on About you that the scan's own form
 * does not ask for (inseam for bottoms, the shoe size). The scan's values win wherever it has one.
 */
export function mergeAboutIntoScan(scan: BodyProfile, form: AboutForm, category: GarmentCategory, now = Date.now(), garment?: AboutGarment): BodyProfile {
  const typed = Object.keys(aboutEntries(form, category, garment)) as BodyMeasurementKey[];
  const missing = typed.filter((k) => scan.measurements[k] === undefined);
  if (missing.length === 0) return scan;
  const fromAbout = profileFromAbout(form, category, now, garment).measurements;
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

/**
 * The fit on this device. A men's garment (slice M2) also hands the engine the shopper's height (for
 * a body-length column) and the male body family; every other garment is computed exactly as before.
 * The body family follows the garment (`garmentBodyFamily`), as the 3D view does, so a unisex
 * garment uses today's tables, as the female figure it is drawn on.
 */
export function fitForProfile(garment: GarmentPayload, profile: BodyProfile): EmbedFit {
  const mens = isMensGarment(garment);
  const userBody = toUserBody(profile, mens ? { height: true } : {});
  const sigma = sigmaFromBodyProfile(profile);
  if (!mens) return { userBody, fit: computeFit(garment, userBody, sigma ? { sigma } : undefined) };
  return { userBody, fit: computeFit(garment, userBody, { ...(sigma ? { sigma } : {}), bodyFamily: garmentBodyFamily(garment) }) };
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
/**
 * The waist of a men's W/L chart whose leg could not be checked (slice M2b), or null: no full size is advised, but
 * the waist is known. Every place that would say "no size fits" names the waist instead (result heading, fit
 * panel, 3D label, size peek).
 */
export function waistOnlyOf(fit: FitResult, advice: Pick<SizeAdvice, 'size'>): string | null {
  return !advice.size && fit.sizeAxes?.waist !== undefined && fit.sizeAxes.leg === undefined ? fit.sizeAxes.waist : null;
}

export function adviseSize(fit: FitResult, preference: FitPreference): SizeAdvice {
  if (hasNoFitPoints(fit)) return { size: null, closest: null, engineSize: null, adjusted: null, noPoints: true };
  const engineSize = fit.recommendedSize;
  if (engineSize === null) return { size: null, closest: fit.closestSize, engineSize: null, adjusted: null, noPoints: false };
  const base: SizeAdvice = { size: engineSize, closest: engineSize, engineSize, adjusted: null, noPoints: false };
  if (preference === 'regular') return base;
  const idx = fit.perSize.findIndex((s) => s.size === engineSize);
  const pick = fit.perSize[idx];
  const neighbour = stepSize(fit, idx, preference === 'snug' ? -1 : 1);
  if (idx < 0 || !pick || !neighbour || !neighbour.wearable || neighbour.score === null) return base;
  if (pick.score !== null && neighbour.score < pick.score - PREFERENCE_SCORE_SLACK) return base;
  return { size: neighbour.size, closest: neighbour.size, engineSize, adjusted: preference === 'snug' ? 'down' : 'up', noPoints: false };
}

/**
 * The size one step smaller (−1) or larger (+1) than `perSize[idx]`. In chart order, except on a
 * men's W/L chart (sizes with `axes`, slice M2b): there a step is one waist at the same leg, because
 * snug and relaxed are about the girth, never the leg length.
 */
export function stepSize(fit: FitResult, idx: number, step: -1 | 1): SizeFit | undefined {
  const here = fit.perSize[idx];
  if (!here) return undefined;
  if (!here.axes) return fit.perSize[idx + step];
  const waists: string[] = [];
  for (const s of fit.perSize) if (s.axes && !waists.includes(s.axes.waist)) waists.push(s.axes.waist);
  const target = waists[waists.indexOf(here.axes.waist) + step];
  return target === undefined ? undefined : fit.perSize.find((s) => s.axes?.waist === target && s.axes.leg === here.axes!.leg);
}

/** The recommended size and its direct neighbours, in chart order (on a W/L chart: the waists either side, same leg). */
export function neighbourSizes(fit: FitResult, centre: string | null): SizeFit[] {
  const idx = fit.perSize.findIndex((s) => s.size === centre);
  if (idx < 0) return fit.perSize.slice(0, 3);
  if (fit.perSize[idx]!.axes) {
    return [stepSize(fit, idx, -1), fit.perSize[idx], stepSize(fit, idx, 1)].filter((s): s is SizeFit => s !== undefined);
  }
  return fit.perSize.slice(Math.max(0, idx - 1), idx + 2);
}

/** Which About-you field supplies each fit point (points the form cannot collect are absent). */
const FIELD_FOR_POINT: Partial<Record<string, AboutField>> = { bust: 'bust', waist: 'waist', hip: 'hip', inseam: 'inseam', foot: 'footEu', neck: 'neck', sleeve: 'sleeve', shoulder: 'shoulder', thigh: 'thigh' };
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

/**
 * One shopper-facing note. `add` is the hint to add a measurement; `short` is a band note without
 * its "consider a size up" tail (the size peek shows that).
 */
export interface EmbedNote {
  /** `pullOn`: the waistband against the hips (pull-on garments); `estimate`: the size's tape numbers were not measured. */
  kind: 'closest' | 'band' | 'add' | 'well' | 'pullOn' | 'estimate';
  text: string;
  short?: string;
}

/** The notes as plain sentences (what FitPanel shows). */
export function embedNotes(fit: FitResult, advice: SizeAdvice, category: GarmentCategory, profile: BodyProfile, garment?: AboutGarment): string[] {
  return embedNoteList(fit, advice, category, profile, garment).map((n) => n.text);
}

/**
 * Shopper-facing notes for the size on screen (COPY-2, F3): built from that size's own points, in
 * plain words (the catalogue's `fit.notes`), with hints only for measurements the About-you form
 * can actually collect.
 *
 * Garment tape (fit engine README, "Garment tape"): the embed never prints the engine's English
 * `notes`; it says the same facts from the structured fields, in the catalogue's words. A size whose
 * waistband only just passes the hips never reads "fits you well", a size whose tape numbers were
 * not measured by the shop always carries that label, and a pull-on check that could not run for
 * lack of a hips measurement is said. No margin in cm is printed.
 */
export function embedNoteList(fit: FitResult, advice: SizeAdvice, category: GarmentCategory, profile: BodyProfile, garment?: AboutGarment): EmbedNote[] {
  const t = embedStrings().fit.notes;
  const audience = garment?.audience;
  const labelOf = (point: string): string => pointLabelFor(point, audience);
  const size = advice.size ?? advice.closest;
  const idx = fit.perSize.findIndex((p) => p.size === size);
  const s = fit.perSize[idx];
  if (!s) return [];
  const used = s.points.filter(isPointFit);
  const notes: EmbedNote[] = [];
  if (!advice.size && s.pullOn?.status === 'blocked') {
    // Nothing is recommended because no waistband passes the hips: that is the reason to give.
    notes.push({ kind: 'pullOn', text: t.pullOnNone(s.size) });
  } else if (!advice.size && fit.sizeAxes?.waist !== undefined && fit.sizeAxes.leg === undefined && s.size === fit.closestSize) {
    // A W/L chart whose leg could not be checked (slice M2b): the waist is picked, no leg is invented.
    notes.push({ kind: 'closest', text: t.legUnchecked(fit.sizeAxes.waist) });
  } else if (!advice.size) {
    const worst = used.reduce<PointFit | undefined>((w, p) => (w === undefined || p.score < w.score ? p : w), undefined);
    if (worst) notes.push({ kind: 'closest', text: t.closest(s.size, bandText(worst.band), labelOf(worst.point)) });
  }
  // First, so the size peek (one note) shows it: the size goes on, but only just.
  if (advice.size && s.pullOn?.status === 'marginal') notes.push({ kind: 'pullOn', text: t.pullOnTight({ short: s.pullOn.marginCm < 0 }) });
  if (fit.pullOnUnchecked) notes.push({ kind: 'pullOn', text: t.pullOnUnchecked, short: t.pullOnUncheckedShort });
  // Men's top chosen for the waist (fit engine `waistLed`, slice M2a): say so before the band notes.
  if (fit.waistLed && size === (fit.closestSize ?? fit.recommendedSize)) notes.push({ kind: 'band', text: t.waistLed(labelOf('bust')) });
  // No "size up/down" advice after the preference already moved the size (it would contradict it).
  const suggest = !advice.adjusted;
  for (const p of used) {
    if (p.band === 'good') continue;
    const up = p.band === 'tight' && suggest && stepSize(fit, idx, 1) !== undefined;
    const down = p.band === 'loose' && suggest && stepSize(fit, idx, -1) !== undefined;
    const say = (to: 'up' | 'down' | null): string => t.band(bandText(p.band), labelOf(p.point), { stretch: !!p.inZone, suggest: to });
    notes.push({ kind: 'band', text: say(up ? 'up' : down ? 'down' : null), short: say(null) });
  }
  // Measurements worth adding: points we skipped for lack of a value, or that rest on an estimate.
  const collectable = new Set<AboutField>([...measurementFieldsFor(category, garment), ...requiredFieldsFor(category)]);
  const add: string[] = [];
  for (const p of s.points) {
    const field = FIELD_FOR_POINT[p.point];
    if (!field || !collectable.has(field)) continue;
    const missing = !isPointFit(p) && p.omitted === 'user';
    const weak = isPointFit(p) && (p.confidence < LOW_POINT_CONFIDENCE || profile.measurements[field as BodyMeasurementKey]?.source === 'prior');
    if ((missing || weak) && !add.includes(labelOf(p.point))) add.push(labelOf(p.point));
  }
  // The shown size's waistband numbers (pull-on check, waist read from the band) when the shop did not measure them.
  const tape = tapeProvenanceOf(s);
  if (tape === 'interpolated' || tape === 'extrapolated') notes.push({ kind: 'estimate', text: t.tapeEstimated(s.size, { rough: tape === 'extrapolated' }) });
  // The pull-on check reads the hips even where the hip is no fit point (an A-line skirt): a hip
  // that is only our estimate is worth adding.
  if (s.pullOn && collectable.has('hip') && profile.measurements.hip?.source === 'prior' && !add.includes(labelOf('hip'))) add.push(labelOf('hip'));
  if (add.length > 0) notes.push({ kind: 'add', text: t.add(add) });
  if (notes.length === 0) notes.push({ kind: 'well', text: t.fitsWell(s.size) });
  return notes;
}

const TAPE_ORDER = ['measured', 'interpolated', 'extrapolated'] as const;

/** The worst provenance of the garment tape values one size's result rests on; undefined when it used none. */
export function tapeProvenanceOf(size: SizeFit): (typeof TAPE_ORDER)[number] | undefined {
  let worst = -1;
  if (size.pullOn) worst = Math.max(worst, TAPE_ORDER.indexOf(size.pullOn.provenance));
  for (const p of size.points) if (isPointFit(p) && p.elasticBand) worst = Math.max(worst, TAPE_ORDER.indexOf(p.elasticBand.provenance));
  return worst < 0 ? undefined : TAPE_ORDER[worst];
}

/**
 * The FitResult as FitPanel shows it in the embed (F3, COPY-2): the score, confidence, notes and
 * "fits" of the size we actually recommend after the preference, never the engine pick's. No
 * tie-break label (developer jargon).
 */
export function fitWithAdvice(fit: FitResult, advice: SizeAdvice, category: GarmentCategory, profile: BodyProfile, garment?: AboutGarment): FitResult {
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
    notes: embedNotes(fit, advice, category, profile, garment),
    tieBreak: null,
  };
}

export function usablePoints(size: SizeFit | undefined): PointFit[] {
  return size ? size.points.filter(isPointFit) : [];
}

export function pointLabel(point: string): string {
  const points = embedStrings().fit.points;
  return Object.prototype.hasOwnProperty.call(points, point) ? points[point]! : point;
}

/** A fit point's name for a garment's audience: a men's garment reads "Chest", "Seat", "Sleeve" (slice M2). */
export function pointLabelFor(point: string, audience?: GarmentPayload['audience']): string {
  if (audience === 'men') {
    const men = embedStrings().fit.pointsMen;
    if (Object.prototype.hasOwnProperty.call(men, point)) return men[point]!;
  }
  return pointLabel(point);
}

export function bandText(band: PointFit['band']): string {
  return embedStrings().fit.bands[band];
}

/**
 * "2.0 cm more room than designed" / "0.6 in less room …", relative to the ease the garment is designed for.
 * A length (inseam, sleeve, body length of a men's garment): "2.0 cm shorter than ideal" / "longer".
 */
export function gapText(p: PointFit, units: Units = 'metric'): string {
  const d = Math.round(p.gapCm * 10) / 10;
  const t = embedStrings().fit;
  // A men's chest whose room is what fitting the waist costs (fit engine `waistLedCm`, slice M2a):
  // its band reads "good" by design, so the room is said with its reason, not as a contradiction.
  if (p.waistLedCm !== undefined && d >= 0.5) return t.moreRoomForWaist(lengthText(d, units));
  if (p.measure === 'length') {
    if (Math.abs(d) < 0.5) return t.lengthRight;
    return d > 0 ? t.longer(lengthText(d, units)) : t.shorter(lengthText(Math.abs(d), units));
  }
  if (Math.abs(d) < 0.5) return t.asDesigned;
  return d > 0 ? t.moreRoom(lengthText(d, units)) : t.lessRoom(lengthText(Math.abs(d), units));
}
