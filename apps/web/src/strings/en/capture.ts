/**
 * English strings: see `../en.ts` for which part of `apps/web` this file covers (DECISIONS.md D21).
 *
 * The camera scan (`@/features/capture`): one section per step of the flow, plus what the steps
 * share. Sentences with a value in them are functions, so a pack can put the value where its
 * language wants it; a `{name}` in a plain string marks where the screen puts an element (see
 * `fill` in `@/features/capture/components/text`).
 *
 * The scan worker never reads this catalogue (a worker has its own module instance and would not
 * follow the page's locale): it sends codes (`GateReason`, `ScanErrorCode`, `Season`, the
 * undertone) and the page turns them into the text below.
 */
import type { BodyMeasurementKey, ManualMethod } from '@curtain/schema';
import type { GateHintKey } from '../../features/capture/poseGate';
import type { SelfieHintKey } from '../../features/capture/selfieGate';
import type { Season, Sex, SkinEstimate } from '../../features/capture/types';
import type { ScanErrorCode } from '../../features/capture/workerProtocol';

/** The copy that differs between the Curtain app and the fitting room on a shop's page. */
interface ByVariant {
  app: string;
  embed: string;
}

interface HeaderStrings {
  eyebrow: string;
  title: string;
  subtitle: string;
}

/** The measurements with an ISO 8559-1 tape instruction. */
export type TapeKey = 'bust' | 'waist' | 'hip' | 'thigh' | 'shoulder' | 'inseam';
/** Where a fused value came from (`Measurement.source`). */
export type SourceKey = 'scan' | 'manual' | 'fused' | 'prior';

export interface CaptureStrings {
  /** Names, units and tape instructions of the measurements, and the manual form's messages. */
  measurements: {
    labels: Record<BodyMeasurementKey, string>;
    units: Record<BodyMeasurementKey, string>;
    tape: Record<TapeKey, string>;
    tapeFallback: string;
    methods: Record<ManualMethod, { label: string; hint: string }>;
    errors: {
      heightNeeded: string;
      notANumber: string;
      range: (lo: number, hi: number) => string;
    };
  };
  /** The spoken guidance of the body scan, by what the pose gate saw. */
  gate: Record<GateHintKey, string> & { turnSide: string };
  /** The selfie quality hints, by what the selfie gate saw. */
  selfieGate: Record<SelfieHintKey, string>;
  /** Errors the scan worker reports by code. */
  scanErrors: Record<ScanErrorCode, string>;
  /** Pieces every step shares. */
  ui: {
    estimate: string;
    cameraPreview: string;
    cameraDeclined: string;
    cameraFailed: string;
    privacy: ByVariant;
  };
  intro: {
    header: { app: HeaderStrings; embed: HeaderStrings };
    facePhoto: string;
    bodyVideo: ByVariant;
    tape: ByVariant;
    estimate: string;
    noCamera: string;
    modelsFailed: string;
    checking: string;
    start: ByVariant;
    enterMeasurements: string;
    skip: string;
    saveFailed: string;
  };
  face: {
    header: HeaderStrings;
    unavailable: string;
    stillLoading: string;
    noFace: string;
    failed: string;
    unreadable: string;
    noCamera: string;
    reading: string;
    loadingModels: string;
    centre: string;
    takePhoto: string;
    choosePhoto: string;
    skip: string;
    tileAlt: string;
    skinTone: string;
    undertones: Record<SkinEstimate['undertone'], string>;
    seasons: Record<Season, string>;
    /** Both names come from `undertones` and `seasons`. */
    skinLine: (monk: number, undertone: string, season: string) => string;
    notEnoughSkin: string;
    swatchLegend: string;
    swatchGroup: string;
    monkTone: (n: number) => string;
    /** `{season}`: the season's name, emphasised. */
    seasonNote: string;
    confirm: string;
    retake: string;
  };
  body: {
    eyebrow: ByVariant;
    title: string;
    subtitle: ByVariant;
    measuring: string;
    height: string;
    weight: string;
    heightHelp: string;
    place: ByVariant;
    faceCamera: string;
    turn: string;
    modelsFailed: string;
    start: string;
    loadingModels: string;
    skip: string;
    getReady: (count: number) => string;
    measuringStatus: string;
    failed: string;
    notMeasured: string;
    facing: string;
    sideCaptured: string;
    turnToSide: string;
    /** `view`: one of the three above. */
    recording: (view: string, seconds: number) => string;
    tryAgain: string;
    manualInstead: string;
  };
  manual: {
    eyebrow: string;
    title: string;
    subtitleScan: string;
    subtitleNoScan: string;
    methodLegend: string;
    methodGroup: string;
    optional: string;
    chartsLegend: string;
    chartsGroup: string;
    charts: Record<Sex, string>;
    chartsNote: string;
    submit: string;
  };
  fusion: {
    header: HeaderStrings;
    /** `labels`: the names of the measurements in dispute, as in `measurements.labels`. */
    conflict: (labels: string[]) => string;
    list: string;
    confidence: (label: string, percent: number) => string;
    sources: Record<SourceKey, string>;
    /** `{scan}` and `{you}`: the two values, in bold. */
    disagree: string;
    value: (amount: string, unit: string) => string;
    remeasured: (label: string, unit: string) => string;
    save: string;
    remeasure: string;
    saving: string;
    use: string;
    rescan: string;
    stored: string;
  };
}

export const CAPTURE_EN: CaptureStrings = {
  measurements: {
    labels: {
      height: 'Height',
      weight: 'Weight',
      bust: 'Bust / chest',
      waist: 'Waist',
      hip: 'Hip',
      shoulder: 'Shoulder',
      thigh: 'Thigh',
      inseam: 'Inseam',
      foot: 'Foot length',
      footLengthCm: 'Foot length',
      footEu: 'Shoe size (EU)',
      neck: 'Neck',
      sleeve: 'Arm length',
    },
    units: {
      height: 'cm',
      weight: 'kg',
      bust: 'cm',
      waist: 'cm',
      hip: 'cm',
      shoulder: 'cm',
      thigh: 'cm',
      inseam: 'cm',
      foot: 'cm',
      footLengthCm: 'cm',
      footEu: 'EU',
      neck: 'cm',
      sleeve: 'cm',
    },
    tape: {
      bust: 'Tape horizontal around the fullest part of the bust, at bust-point level, breathing normally, tape snug but not tight.',
      waist: 'Tape around the natural waist, midway between the lowest rib and the top of the hip bone (iliac crest).',
      hip: 'Tape horizontal around the fullest part of the buttocks, feet together.',
      thigh: 'Tape horizontal around the thigh just below the crotch, at the fullest part.',
      shoulder: 'Measure across the back from the tip of one shoulder bone to the other.',
      inseam: 'From the crotch down the inside of the leg to the floor, standing straight without shoes.',
    },
    tapeFallback: 'Measure with a tape, snug but not tight.',
    methods: {
      tape: { label: 'Tape, just now', hint: '±1.5 cm' },
      memory: { label: 'From memory', hint: '±2.5 cm' },
      guess: { label: 'A guess', hint: '±4 cm' },
    },
    errors: {
      heightNeeded: 'Your height is needed to scale everything else',
      notANumber: 'Enter a number',
      range: (lo, hi) => `Expected between ${lo} and ${hi}`,
    },
  },
  gate: {
    noPerson: 'Step into the frame',
    stepBack: 'Step back so your whole body is visible, head to heels',
    centre: 'Move towards the centre of the frame',
    visibility: 'Make sure your feet and head are clearly visible',
    straight: 'Stand straight and keep the phone upright',
    arms: 'Hold your arms slightly away from your body',
    still: 'Hold still…',
    perfect: 'Perfect, hold that pose',
    turnSide: 'Now turn 90° to your left and hold still',
  },
  selfieGate: {
    noFace: 'No face detected — face the camera',
    multipleFaces: 'Only one face should be in the frame',
    faceTheCamera: 'Face the camera directly, keep your head level',
    neutralExpression: 'Relax your face — close your mouth and keep a neutral expression',
    moreLight: 'Move to a brighter spot or turn on a light',
    lessSideLight: 'Face the light source — avoid strong light from one side',
    holdSteady: 'Hold the phone steady — the photo is a little blurry',
    moveCloser: 'Move closer or zoom in so your face is larger in the frame',
    clearFace: 'Remove anything covering your face (hands, masks)',
    perfect: 'Great — hold that pose',
  },
  scanErrors: {
    no_front_frame: 'no usable front frame: the whole body must be visible and still',
  },
  ui: {
    estimate: 'estimate',
    cameraPreview: 'Camera preview',
    cameraDeclined: 'Camera access was declined.',
    cameraFailed: 'Could not open the camera.',
    privacy: {
      app: 'Photos and video stay on this device. They are processed in a background worker, never uploaded, and only an anonymised fit signature (about 80 numbers, no face or skin data) ever syncs.',
      embed: 'Video stays on this device. It is processed in this browser and never uploaded, and no measurement is sent to Curtain or the shop.',
    },
  },
  intro: {
    header: {
      app: { eyebrow: 'Your private fitting room', title: 'Let’s measure you', subtitle: 'About two minutes. Nothing leaves your phone.' },
      embed: { eyebrow: 'More accurate fit', title: 'Quick body scan', subtitle: 'About 30 seconds. Nothing leaves this device.' },
    },
    facePhoto: 'One face photo for your skin tone and identity tile.',
    bodyVideo: {
      app: 'An 8-second body video, measured by a model running on this device.',
      embed: 'An 8-second body video, measured in this browser.',
    },
    tape: {
      app: 'A few tape measurements to keep the scan honest.',
      embed: 'Check or add a few measurements.',
    },
    estimate: 'Every result is an estimate and says how sure it is.',
    noCamera: 'No camera detected — we will go straight to manual measurements.',
    modelsFailed: 'The scan models could not be loaded; manual measurements still work.',
    checking: 'Checking your device…',
    start: { app: 'Start with a photo', embed: 'Start the scan' },
    enterMeasurements: 'Enter measurements',
    skip: 'Skip for now',
    saveFailed: 'Could not save your profile on this device.',
  },
  face: {
    header: { eyebrow: 'Step 1 of 3', title: 'Face & colour', subtitle: 'One front-lit photo. Hair away from the face helps.' },
    unavailable: 'The scan models are not available on this device; you can skip this step.',
    stillLoading: 'The scan models are still loading; try again in a moment.',
    noFace: 'No face found. Face the camera in good light and try again.',
    failed: 'Face analysis failed.',
    unreadable: 'That image could not be read.',
    noCamera: 'No camera on this device. Choose a photo instead.',
    reading: 'Reading skin tone…',
    loadingModels: 'Loading the scan models on this device…',
    centre: 'Centre your face in the oval, neutral expression.',
    takePhoto: 'Take photo',
    choosePhoto: 'Choose a photo',
    skip: 'Skip this step',
    tileAlt: 'Your identity tile (background removed)',
    skinTone: 'Skin tone',
    undertones: { warm: 'warm', cool: 'cool', neutral: 'neutral' },
    seasons: {
      'light spring': 'light spring',
      'warm spring': 'warm spring',
      'bright spring': 'bright spring',
      'light summer': 'light summer',
      'cool summer': 'cool summer',
      'soft summer': 'soft summer',
      'soft autumn': 'soft autumn',
      'warm autumn': 'warm autumn',
      'deep autumn': 'deep autumn',
      'deep winter': 'deep winter',
      'cool winter': 'cool winter',
      'bright winter': 'bright winter',
    },
    skinLine: (monk, undertone, season) => `Monk ${monk} · ${undertone} undertone · ${season}`,
    notEnoughSkin: 'Could not sample enough skin pixels.',
    swatchLegend: 'Confirm or adjust your swatch',
    swatchGroup: 'Monk skin tone swatch',
    monkTone: (n) => `Monk tone ${n}`,
    seasonNote: 'Colour season {season} is a rule-based estimate from skin, hair and contrast — you can change it later in your profile.',
    confirm: 'Looks right',
    retake: 'Retake',
  },
  body: {
    eyebrow: { app: 'Step 2 of 3', embed: 'Step 1 of 2' },
    title: 'Body scan',
    subtitle: {
      app: '8 seconds. Stand 2–3 m away in fitted clothing, phone upright.',
      embed: '8 seconds. Stand 2–3 m away in fitted clothing, camera upright.',
    },
    measuring: 'Measuring on device…',
    height: 'Height (cm)',
    weight: 'Weight (kg, optional)',
    heightHelp: 'Your height sets the scale of the scan; weight improves the estimate. Neither is ever uploaded.',
    place: {
      app: 'Prop the phone upright at hip height, 2–3 m away.',
      embed: 'Place your phone or laptop so the camera is at hip height, 2–3 m away.',
    },
    faceCamera: 'Face the camera, arms slightly away from your body (A-pose), feet together.',
    turn: 'Halfway through, turn 90° to your left and hold still.',
    modelsFailed: 'The scan models could not be loaded. You can still enter measurements by hand.',
    start: 'Start 8-second scan',
    loadingModels: 'Loading scan models…',
    skip: 'Skip, enter measurements manually',
    getReady: (count) => `Get ready… ${count}`,
    measuringStatus: 'Measuring on device',
    failed: 'Scan failed',
    notMeasured: 'The scan could not be measured.',
    facing: 'Facing the camera',
    sideCaptured: 'Side view captured',
    turnToSide: 'Turn to your side',
    recording: (view, seconds) => `${view} · ${seconds} s`,
    tryAgain: 'Try again',
    manualInstead: 'Enter measurements manually instead',
  },
  manual: {
    eyebrow: 'Step 3 of 3',
    title: 'Your measurements',
    subtitleScan: 'The scan keeps these honest; they sharpen the scan. Leave blank what you do not know.',
    subtitleNoScan: 'No scan this time — these drive the fit directly.',
    methodLegend: 'How did you measure?',
    methodGroup: 'How did you measure',
    optional: '(optional)',
    chartsLegend: 'Which size charts do you usually use?',
    chartsGroup: 'Size chart type',
    charts: { female: "Women's charts", male: "Men's charts", unspecified: 'Prefer not to say' },
    chartsNote: 'Only used to pick the population prior for missing measurements. Stays on this device.',
    submit: 'Combine with the scan',
  },
  fusion: {
    header: { eyebrow: 'Result', title: 'Your fit profile', subtitle: 'Each value shows how sure we are. Higher is better; sizes change every 4–6 cm.' },
    conflict: (labels) => `The scan and your entry disagree on ${labels.map((l) => l.toLowerCase()).join(', ')}. Remeasure with a tape to settle it.`,
    list: 'Measurements',
    confidence: (label, percent) => `${label} confidence ${percent} percent`,
    sources: { scan: 'scan', manual: 'you', fused: 'scan + you', prior: 'estimate' },
    disagree: 'Scan says {scan}, you said {you} ({cm} cm apart).',
    value: (amount, unit) => `${amount} ${unit}`,
    remeasured: (label, unit) => `Remeasured ${label} in ${unit}`,
    save: 'Save',
    remeasure: 'Remeasure this one',
    saving: 'Saving on device…',
    use: 'Use these measurements',
    rescan: 'Redo the body scan',
    stored: 'Stored only on this device, your photos encrypted. Only an 80-number fit signature (no photo, no face or skin data) can sync, and you can delete everything in one tap.',
  },
};
