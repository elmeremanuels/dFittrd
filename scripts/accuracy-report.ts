/**
 * Accuracy report (CUR-32, WO-018): compares the tape measure's readings to the scan's, per
 * measurement point. Reads an anonymous CSV (one row per volunteer, six tape + six scan values)
 * and prints per point the mean signed error, the median absolute error, the 90th-percentile
 * absolute error, and the share within 1, 2 and 3 cm. Also writes a markdown report.
 *
 * Pure: no network, no secrets, no shopper data. Real CSVs are gitignored
 * (`scripts/data/.gitignore`); the tests use a synthetic fixture only.
 *
 * Run: pnpm exec tsx scripts/accuracy-report.ts [path/to/accuracy-YYYY-MM.csv]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACCURACY_POINTS = ['height', 'shoulder', 'bust', 'waist', 'hip', 'inseam'] as const;
export type AccuracyPoint = (typeof ACCURACY_POINTS)[number];

export interface AccuracyRow {
  volunteer_id: string;
  sex?: string;
  age_band?: string;
  tape: Record<AccuracyPoint, number>;
  scan: Record<AccuracyPoint, number>;
  notes?: string;
}

export interface PointStats {
  point: AccuracyPoint;
  n: number;
  /** Mean signed error (scan − tape), cm. Positive = the scan reads larger than the tape. */
  meanSignedCm: number;
  /** Median absolute error, cm. */
  medianAbsCm: number;
  /** 90th-percentile absolute error, cm. */
  p90AbsCm: number;
  /** Maximum absolute error, cm. */
  maxAbsCm: number;
  /** Share within 1 cm, 0..1. */
  within1: number;
  within2: number;
  within3: number;
}

/** Acceptance thresholds (ACCURACY-PROTOCOL.md §8). */
export const ACCEPTANCE = { medianAbsCmMax: 1.5, within2Min: 0.8 } as const;

export function parseAccuracyCsv(text: string): AccuracyRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('accuracy CSV: need a header row and at least one data row');
  const header = lines[0]!.split(',').map((h) => h.trim());
  const index = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`accuracy CSV: missing column "${name}"`);
    return i;
  };
  const idIdx = index('volunteer_id');
  const tapeIdx = ACCURACY_POINTS.map((p) => index(`tape_${p}`));
  const scanIdx = ACCURACY_POINTS.map((p) => index(`scan_${p}`));
  const sexIdx = header.indexOf('sex');
  const ageIdx = header.indexOf('age_band');
  const notesIdx = header.indexOf('notes');
  const rows: AccuracyRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r]!.split(',').map((c) => c.trim());
    if (cells.length < header.length) throw new Error(`accuracy CSV: row ${r + 1} has fewer cells than the header`);
    const tape = {} as Record<AccuracyPoint, number>;
    const scan = {} as Record<AccuracyPoint, number>;
    for (let i = 0; i < ACCURACY_POINTS.length; i++) {
      const t = Number(cells[tapeIdx[i]!]);
      const s = Number(cells[scanIdx[i]!]);
      if (!Number.isFinite(t)) throw new Error(`accuracy CSV: row ${r + 1} tape_${ACCURACY_POINTS[i]} is not a number`);
      if (!Number.isFinite(s)) throw new Error(`accuracy CSV: row ${r + 1} scan_${ACCURACY_POINTS[i]} is not a number`);
      tape[ACCURACY_POINTS[i]] = t;
      scan[ACCURACY_POINTS[i]] = s;
    }
    rows.push({
      volunteer_id: cells[idIdx]!,
      sex: sexIdx >= 0 ? cells[sexIdx] : undefined,
      age_band: ageIdx >= 0 ? cells[ageIdx] : undefined,
      tape,
      scan,
      notes: notesIdx >= 0 ? cells[notesIdx] : undefined,
    });
  }
  return rows;
}

const quantile = (xs: readonly number[], q: number): number => {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

export function pointStats(rows: readonly AccuracyRow[], point: AccuracyPoint): PointStats {
  const signed = rows.map((r) => r.scan[point] - r.tape[point]);
  const abs = signed.map((v) => Math.abs(v));
  const n = rows.length;
  const meanSignedCm = n === 0 ? Number.NaN : signed.reduce((s, v) => s + v, 0) / n;
  const medianAbsCm = quantile(abs, 0.5);
  const p90AbsCm = quantile(abs, 0.9);
  const maxAbsCm = abs.length === 0 ? Number.NaN : Math.max(...abs);
  const within = (cm: number): number => (n === 0 ? Number.NaN : abs.filter((v) => v <= cm).length / n);
  return {
    point,
    n,
    meanSignedCm,
    medianAbsCm,
    p90AbsCm,
    maxAbsCm,
    within1: within(1),
    within2: within(2),
    within3: within(3),
  };
}

export function allPointStats(rows: readonly AccuracyRow[]): PointStats[] {
  return ACCURACY_POINTS.map((p) => pointStats(rows, p));
}

const pct = (v: number): string => (Number.isFinite(v) ? `${(v * 100).toFixed(0)} %` : 'n/a');
const cm = (v: number): string => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : 'n/a');
const abs = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');

export function statsToMarkdown(stats: readonly PointStats[], title: string, now = new Date()): string {
  const flag = (s: PointStats): string =>
    s.medianAbsCm > ACCEPTANCE.medianAbsCmMax || s.within2 < ACCEPTANCE.within2Min ? ' ⚠' : '';
  const lines = [
    `# Accuracy report: ${title}`,
    '',
    `_Generated ${now.toISOString().slice(0, 10)}._ ${stats[0]?.n ?? 0} volunteers.`,
    '',
    '## Per-point statistics (scan − tape, cm)',
    '',
    '| Point | n | mean signed | median abs | p90 abs | max abs | ≤1 cm | ≤2 cm | ≤3 cm | status |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...stats.map(
      (s) =>
        `| ${s.point} | ${s.n} | ${cm(s.meanSignedCm)} | ${abs(s.medianAbsCm)} | ${abs(s.p90AbsCm)} | ${abs(s.maxAbsCm)} | ${pct(s.within1)} | ${pct(s.within2)} | ${pct(s.within3)} |${flag(s)} |`,
    ),
    '',
    'Acceptance (ACCURACY-PROTOCOL.md §8): median absolute error ≤ 1.5 cm and at least 80 % within 2 cm. Points that miss either threshold are flagged ⚠.',
    '',
  ];
  return lines.join('\n');
}

export function statsToConsole(stats: readonly PointStats[]): string {
  const header = 'Point       n   mean  median  p90   max   ≤1cm  ≤2cm  ≤3cm';
  const rows = stats.map((s) =>
    [
      s.point.padEnd(11),
      String(s.n).padStart(3),
      cm(s.meanSignedCm).padStart(7),
      abs(s.medianAbsCm).padStart(6),
      abs(s.p90AbsCm).padStart(5),
      abs(s.maxAbsCm).padStart(5),
      pct(s.within1).padStart(5),
      pct(s.within2).padStart(5),
      pct(s.within3).padStart(5),
    ].join(' '),
  );
  return [header, ...rows].join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const csvPath = argv[0];
  if (!csvPath) {
    process.stderr.write('usage: tsx scripts/accuracy-report.ts <path/to/accuracy-YYYY-MM.csv>\n');
    process.exit(2);
  }
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseAccuracyCsv(text);
  const stats = allPointStats(rows);
  process.stdout.write(statsToConsole(stats) + '\n');
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'reports', 'qwen');
  mkdirSync(outDir, { recursive: true });
  const title = csvPath.replace(/^.*[/\\]/, '').replace(/\.csv$/, '');
  const outPath = join(outDir, `accuracy-report-${title}.md`);
  writeFileSync(outPath, statsToMarkdown(stats, title));
  process.stdout.write(`\nwrote ${outPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
