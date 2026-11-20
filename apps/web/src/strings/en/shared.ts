/**
 * English strings: see `../en.ts` for which part of `apps/web` this file covers (DECISIONS.md D21).
 *
 * This part: the components the embed shares with the consumer app (`@/components` fit panel,
 * estimate badge, size rings, avatar figure, number field), the size-ring sentences of `@/render`
 * and the small formats of `@/lib/format`. Sentences with values are functions; the code decides
 * WHAT is said (which ring, which source, which number), the catalogue HOW it is worded, word order,
 * plurals and lower case included.
 *
 * Not here: the fit bands ("Good fit", "Tight": `fit.bands` of the embed's catalogue, which the
 * rings read too), the estimate disclaimer (`ESTIMATE_DISCLAIMER` of `@curtain/schema`) and the fit
 * engine's own notes (`FitResult.notes`).
 */

/** Where a ring's garment girth comes from (`RingSource` of `@/render/ringInputs`). */
type Source = 'measured' | 'interpolated' | 'extrapolated' | 'assumed';

export interface SharedStrings {
  /** `@/lib/format`: the shapes of a missing value, a percentage and a length. */
  format: {
    /** Shown in place of a value that is not there. */
    none: string;
    percent: (n: number) => string;
    cm: (n: string) => string;
  };
  /** `components/FitPanel.tsx`. */
  fitPanel: {
    /** "[Add your measurements] to see how this fits.": the link, then the rest of the sentence. */
    addMeasurementsLink: string;
    addMeasurementsAfter: string;
    working: string;
    noSizeFits: string;
    /** A W/L chart whose leg could not be checked: the waist is known (heading and line; `size` is the row on screen). */
    waistOnly: (waist: string) => string;
    waistOnlyText: (size: string) => string;
    /** "Closest is [M], but …" / "Closest is [M] at 62% …": the text before the size, then the rest. */
    closestBefore: string;
    closestBlockedAfter: string;
    closestScoredAfter: (score: string) => string;
    size: string;
    /** Compact line "fit [91%] · 80% sure": the text before the score, then the rest. */
    compactFitBefore: string;
    compactFitAfter: (confidence: string) => string;
    notesLabel: string;
    recommendedSize: string;
    fitScore: string;
    /** `tieBreak`: the engine's tie-break rule in words, or null. */
    confidenceLine: (confidence: string, tieBreak: string | null) => string;
  };
  /** `components/EstimateBadge.tsx`: the estimate label on one line and on two short lines (the same words). */
  estimate: {
    label: string;
    lines: readonly [string, string];
  };
  /** `components/SizeRings.tsx`. */
  sizeRings: {
    /** One ring's full sentence in the screen-reader list. */
    sentence: (size: string, text: string) => string;
  };
  /** `components/AvatarView.tsx`. */
  avatar: {
    /** The figure's accessible name with a garment on it; `onWhom` is one of the three below. */
    garmentLabel: (name: string, size: string | null, onWhom: string) => string;
    /** The figure's accessible name when the size is not drawn on it (the size advice: it cannot be worn at `where`). */
    notDrawnLabel: (name: string, size: string | null, where: string, onWhom: string) => string;
    onCapture: string;
    onMeasuredBody: string;
    onReferenceBody: string;
    bodyOutline: string;
    referenceOutline: string;
    /** The badge of the thumbnail figure. */
    estimateShort: string;
    bodyFromMeasurements: string;
    referenceBody: string;
    captureOverlay: string;
    rendering: string;
  };
  /** `components/NumberField.tsx`. */
  numberField: {
    optional: string;
    sliderLabel: (label: string) => string;
  };
  /** `render/rings.ts` and `render/ringInputs.ts`: chips, ring sentences and the notes under the figure. */
  rings: {
    cm: (n: string) => string;
    inches: (n: string) => string;
    room: (length: string) => string;
    short: (length: string) => string;
    noRoom: string;
    /** A figure worked out from an estimated body girth. */
    about: (text: string) => string;
    you: (length: string) => string;
    youEstimated: (length: string) => string;
    labels: { bust: string; chest: string; waist: string; hip: string; hem: string };
    /** "Waist: …": a ring's sentence behind its label. */
    labelled: (label: string, rest: string) => string;
    /** A point the engine scored; `band` is the engine's word as the chip prints it. */
    scored: (band: string, room: string, girth: string, you: string) => string;
    girthBodyChart: (length: string) => string;
    girthGarment: (length: string) => string;
    /** A hip the engine does not score, drawn at the garment's tape girth. */
    around: (length: string) => string;
    tapeChipNote: (o: { skirt: boolean; length: string; source: string }) => string;
    belowBand: (length: string) => string;
    atHipLine: string;
    /** `why`: the engine's reason for not scoring the point. */
    tapeHip: (o: { length: string; where: string; source: string; body: { you: string; room: string } | null; why: string }) => string;
    notChecked: string;
    notCheckedText: (why: string, chart: { room: string; girth: string; you: string } | null) => string;
    /** Added to a scored hip when the tape has the garment's own hip girth. */
    alsoTapeHip: (length: string, source: string) => string;
    waistband: string;
    tooSmallToPullOn: string;
    onlyJustPullsOn: string;
    /** The waist sentence of a size whose band does not, or only just, pass the hips; `scored` is the chart sentence. */
    bandBlocked: (scored: string) => string;
    bandMarginal: (scored: string) => string;
    byTheSizeChart: string;
    /** "band 67-94 cm measured": `relaxed` without its unit. */
    bandChipNote: (relaxed: string, stretched: string, source: string) => string;
    bandRange: (relaxed: string, stretched: string, source: string) => string;
    /** How the pull-on check is known. */
    pullOnMeasured: string;
    pullOnAllAssumed: string;
    bandHow: { measured: string; assumed: string; estimated: string };
    closureAssumed: (bandHow: string) => string;
    passesHips: (hip: string, spare: string, how: string) => string;
    smallerThanHips: (by: string, hip: string, how: string) => string;
    bandNotMeasured: string;
    hemChip: (length: string, source: string) => string;
    widerThanDrawn: string;
    hemText: (length: string, source: string, clamped: boolean) => string;
    /** One word on a chip for where a girth comes from. */
    sourceWord: Record<Source, string>;
    /** The full wording of a source, for a ring's sentence; `measuredSizes` may be empty. */
    sourceSentence: Record<Source, (measuredSizes: readonly string[]) => string>;
    /** The wording of a source in the notes under the figure, said in full once. */
    sourceNote: Record<Source, (size: string, measuredSizes: readonly string[]) => string>;
    notes: {
      /** No ring is a size-chart girth. */
      garmentOnly: string;
      /** `labels`: the rings that are size-chart girths; `all`: every ring is one. */
      chart: (o: { labels: readonly string[]; all: boolean; bodyChart: boolean }) => string;
      bodyEstimated: string;
      /** The short form of an assumed source, after the first note. */
      assumed: string;
      bandAssumed: string;
      band: (how: string) => string;
      bandNotMeasured: string;
      hip: (how: string, belowBandUnknown: boolean) => string;
      hem: (how: string, clamped: boolean) => string;
    };
  };
}

const lower = (s: string): string => s.toLowerCase();
const list = (items: readonly string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
/** " 8, 10 and 14", or nothing. */
const between = (sizes: readonly string[]): string => (sizes.length ? ` ${list(sizes)}` : '');
/** " on sizes 8, 10 and 14", or nothing. */
const onSizes = (sizes: readonly string[]): string => (sizes.length ? ` on size${sizes.length > 1 ? 's' : ''} ${list(sizes)}` : '');

export const SHARED_EN: SharedStrings = {
  format: {
    none: '—',
    percent: (n) => `${n}%`,
    cm: (n) => `${n} cm`,
  },
  fitPanel: {
    addMeasurementsLink: 'Add your measurements',
    addMeasurementsAfter: ' to see how this fits.',
    working: 'Working out the fit…',
    noSizeFits: 'No size fits',
    waistOnly: (waist) => `Waist ${waist} fits`,
    waistOnlyText: (size) => `The leg length is not checked yet, so no full size is picked. Size ${size} is shown for the waist.`,
    closestBefore: 'Closest is ',
    closestBlockedAfter: ', but its waistband does not stretch over your hips — we would not recommend it.',
    closestScoredAfter: (score) => ` at ${score} — we would not recommend it.`,
    size: 'Size',
    compactFitBefore: 'fit ',
    compactFitAfter: (confidence) => ` · ${confidence} sure`,
    notesLabel: 'Fit notes',
    recommendedSize: 'Recommended size',
    fitScore: 'Fit score',
    confidenceLine: (confidence, tieBreak) => `Confidence ${confidence} · estimate${tieBreak ? ` · tie broken by ${tieBreak}` : ''}`,
  },
  estimate: {
    label: 'Estimate · not measured',
    lines: ['Estimate ·', 'not measured'],
  },
  sizeRings: {
    sentence: (size, text) => `Size ${size}. ${text}.`,
  },
  avatar: {
    garmentLabel: (name, size, onWhom) => `Estimated look of ${name}${size ? ` in size ${size}` : ''} ${onWhom} — not measured`,
    notDrawnLabel: (name, size, where, onWhom) => `The body alone, ${onWhom.replace(/^on /, '')}: ${name}${size ? ` in size ${size}` : ''} is not drawn, because the size advice says it does not go on at the ${where} (estimate)`,
    onCapture: 'over your capture',
    onMeasuredBody: 'on a body drawn from your measurements',
    onReferenceBody: 'on a reference body',
    bodyOutline: 'Your body outline (estimate)',
    referenceOutline: 'Reference body outline',
    estimateShort: 'Estimate',
    bodyFromMeasurements: 'Body from your measurements',
    referenceBody: 'Reference body · add your measurements',
    captureOverlay: 'Your capture · garment overlay',
    rendering: 'Rendering estimate',
  },
  numberField: {
    optional: '(optional)',
    sliderLabel: (label) => `${label} slider`,
  },
  rings: {
    cm: (n) => `${n} cm`,
    inches: (n) => `${n} in`,
    room: (length) => `${length} room`,
    short: (length) => `${length} short`,
    noRoom: 'no room',
    about: (text) => `about ${text}`,
    you: (length) => `you ${length}`,
    youEstimated: (length) => `you about ${length} (estimated from your height and weight)`,
    labels: { bust: 'Bust', chest: 'Chest', waist: 'Waist', hip: 'Hips', hem: 'Hem' },
    labelled: (label, rest) => `${label}: ${rest}`,
    scored: (band, room, girth, you) => `${lower(band)}, ${room} (${girth}, ${you})`,
    girthBodyChart: (length) => `size chart body girth plus designed ease: ${length}`,
    girthGarment: (length) => `garment ${length} from the size chart`,
    around: (length) => `${length} around`,
    tapeChipNote: ({ skirt, length, source }) => `${skirt ? 'skirt' : 'garment'} ${length} ${source}`,
    belowBand: (length) => `${length} below the band`,
    atHipLine: 'at its hip line',
    tapeHip: ({ length, where, source, body, why }) => `the garment is ${length} around ${where} (${source})${body ? `, ${body.you}: ${body.room}` : ''}; no tight or loose word, ${why}`,
    notChecked: 'Not checked',
    notCheckedText: (why, chart) => `not checked, ${why}${chart ? ` (${chart.room} by the size chart: ${chart.girth}, ${chart.you})` : ''}`,
    alsoTapeHip: (length, source) => `; the garment itself is ${length} around at its hip line (${source})`,
    waistband: 'Waistband',
    tooSmallToPullOn: 'too small to pull on',
    onlyJustPullsOn: 'only just pulls on',
    bandBlocked: (scored) => `the band does not stretch over your hips; by the size chart alone: ${scored}`,
    bandMarginal: (scored) => `the band only just stretches over your hips; by the size chart alone: ${scored}`,
    byTheSizeChart: 'by the size chart',
    bandChipNote: (relaxed, stretched, source) => `band ${relaxed}-${stretched} ${source}`,
    bandRange: (relaxed, stretched, source) => `; elastic band ${relaxed} relaxed to ${stretched} stretched (${source})`,
    pullOnMeasured: 'measured',
    pullOnAllAssumed: 'band girth and pull-on closure assumed, not measured',
    bandHow: { measured: 'band measured', assumed: 'band girth assumed, not measured', estimated: 'band girth estimated from the measured sizes' },
    closureAssumed: (bandHow) => `${bandHow}, pull-on closure assumed`,
    passesHips: (hip, spare, how) => `; stretched, it passes over hips of ${hip} with ${spare} to spare (${how})`,
    smallerThanHips: (by, hip, how) => `; stretched, it is ${by} smaller than hips of ${hip}, so it may not pull on over them (${how})`,
    bandNotMeasured: '; elastic band, its girth is not measured',
    hemChip: (length, source) => `${length} ${source}`,
    widerThanDrawn: 'wider than drawn',
    hemText: (length, source, clamped) => `${length} around (${source})${clamped ? '; spread out it is wider than this picture, so the ring is drawn narrower than the real hem' : ''}`,
    sourceWord: { measured: 'measured', interpolated: 'estimated', extrapolated: 'rough estimate', assumed: 'assumed' },
    sourceSentence: {
      measured: () => 'measured on the garment in this size',
      interpolated: (measuredSizes) => `not measured in this size: estimated between the measured sizes${between(measuredSizes)}, interpolated`,
      extrapolated: (measuredSizes) => `not measured in this size: estimated beyond the measured sizes${between(measuredSizes)}, extrapolated`,
      assumed: () => 'assumed, not measured',
    },
    sourceNote: {
      measured: (_size, measuredSizes) => `measured on the garment${onSizes(measuredSizes)}`,
      interpolated: (size, measuredSizes) => `measured${onSizes(measuredSizes)}; size ${size} was not measured and is estimated from the sizes on either side (interpolated)`,
      extrapolated: (size, measuredSizes) => `measured${onSizes(measuredSizes)}; size ${size} was not measured and is estimated by continuing the step of the nearest measured sizes (extrapolated)`,
      assumed: () => 'girth assumed, not measured yet',
    },
    notes: {
      garmentOnly: 'Rings show the garment’s own girths around a figure drawn from your answers: the picture is an estimate; each ring says below whether it is measured, estimated or assumed.',
      chart: ({ labels, all, bodyChart }) => {
        const names = labels.map(lower);
        const one = !all && names.length === 1;
        const which = all ? 'Rings show' : one ? `The ${names[0]} ring shows` : `The ${list(names)} rings show`;
        const others = all ? '' : ' The other rings are the garment’s own girths; each says below whether it is measured, estimated or assumed.';
        return bodyChart
          ? `${which} the size chart’s body girth${one ? '' : 's'} plus the designed ease, around a figure drawn from your answers: an estimate, not a measured garment.${others}`
          : `${which} the garment’s size-chart girth${one ? '' : 's'} around a figure drawn from your answers: an estimate, not a measured garment.${others}`;
      },
      bodyEstimated: 'Body girths marked “about” are estimated from your height and weight; add your measurements for exact numbers.',
      assumed: 'assumed, not measured yet',
      bandAssumed: 'girth assumed, not measured yet',
      band: (how) => `Elastic waistband: ${how}; the waist ring is the size chart plus designed ease, the bracket under it the band’s relaxed-to-stretched range.`,
      bandNotMeasured: 'Elastic waistband: its girth is not measured.',
      hip: (how, belowBandUnknown) => `Hips: the garment’s own girth at its hip line, ${how}${belowBandUnknown ? ' (the shop did not say how far below the band)' : ''}. The size advice does not use it.`,
      hem: (how, clamped) => `Hem: ${how}${clamped ? '; wider than this picture can show, so it is drawn narrower than it is' : ''}.`,
    },
  },
};
