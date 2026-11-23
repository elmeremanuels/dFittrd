/**
 * Tests for the accuracy report (CUR-32, WO-018). Synthetic data only — real volunteer data is
 * gitignored and never committed (D19).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCURACY_POINTS,
  allPointStats,
  parseAccuracyCsv,
  pointStats,
  statsToConsole,
  statsToMarkdown,
  type AccuracyRow,
} from '../../../scripts/accuracy-report';

const SAMPLE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../scripts/data/accuracy-sample.csv'), 'utf8');

describe('parseAccuracyCsv', () => {
  it('reads the synthetic sample fixture (four rows, six tape + six scan values)', () => {
    const rows = parseAccuracyCsv(SAMPLE);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.volunteer_id).toBe('v01');
    expect(rows[0]!.sex).toBe('f');
    expect(rows[0]!.age_band).toBe('30-44');
    expect(rows[0]!.tape.bust).toBeCloseTo(92.0, 9);
    expect(rows[0]!.scan.bust).toBeCloseTo(92.5, 9);
    expect(rows[0]!.notes).toBe('synthetic fixture');
    for (const p of ACCURACY_POINTS) {
      expect(Number.isFinite(rows[0]!.tape[p])).toBe(true);
      expect(Number.isFinite(rows[0]!.scan[p])).toBe(true);
    }
  });

  it('refuses a CSV without a header row', () => {
    expect(() => parseAccuracyCsv('')).toThrow(/header row/);
  });

  it('refuses a CSV missing a required column', () => {
    const csv = 'volunteer_id,tape_height\nv01,168\n';
    expect(() => parseAccuracyCsv(csv)).toThrow(/missing column/);
  });

  it('refuses a row whose tape value is not a number', () => {
    const csv = [
      'volunteer_id,tape_height,tape_shoulder,tape_bust,tape_waist,tape_hip,tape_inseam,scan_height,scan_shoulder,scan_bust,scan_waist,scan_hip,scan_inseam',
      'v01,NaN,39,92,74,100,76,168,39,92,74,100,76',
    ].join('\n');
    expect(() => parseAccuracyCsv(csv)).toThrow(/tape_height is not a number/);
  });
});

describe('pointStats', () => {
  it('computes signed error = scan − tape; on the sample, every mean is small and signed correctly', () => {
    const rows = parseAccuracyCsv(SAMPLE);
    const stats = allPointStats(rows);
    // v01, v02, v03 all have scan > tape on bust (+0.5, -0.5, +1.2); mean bust error is positive.
    const bust = stats.find((s) => s.point === 'bust')!;
    expect(bust.n).toBe(4);
    expect(bust.meanSignedCm).toBeCloseTo((0.5 - 0.5 + 1.2 - 0.6) / 4, 9);
    expect(bust.medianAbsCm).toBeCloseTo(0.55, 2);
    expect(bust.within1).toBeCloseTo(0.75, 9);
    expect(bust.within2).toBe(1);
    expect(bust.within3).toBe(1);
  });

  it('accepts a synthetic CSV where every scan equals its tape (the identity case)', () => {
    const rows: AccuracyRow[] = [1, 2, 3].map((i) => ({
      volunteer_id: `v${i}`,
      tape: { height: 170, shoulder: 40, bust: 90, waist: 70, hip: 100, inseam: 78 },
      scan: { height: 170, shoulder: 40, bust: 90, waist: 70, hip: 100, inseam: 78 },
    }));
    for (const s of allPointStats(rows)) {
      expect(s.meanSignedCm).toBe(0);
      expect(s.medianAbsCm).toBe(0);
      expect(s.within1).toBe(1);
    }
  });

  it('flags a point whose median absolute error is above the acceptance bound (1.5 cm)', () => {
    const rows: AccuracyRow[] = Array.from({ length: 10 }, (_, i) => ({
      volunteer_id: `v${i + 1}`,
      tape: { height: 170, shoulder: 40, bust: 90, waist: 70, hip: 100, inseam: 78 },
      scan: { height: 170, shoulder: 40, bust: 90 + (i < 5 ? 0 : 4), waist: 70, hip: 100, inseam: 78 },
    }));
    const bust = pointStats(rows, 'bust');
    expect(bust.medianAbsCm).toBe(2);
    expect(bust.within2).toBe(0.5);
    // The acceptance rule says median abs ≤ 1.5 cm: this synthetic point fails it.
    expect(bust.medianAbsCm).toBeGreaterThan(1.5);
  });

  it('flags a point whose share within 2 cm is below the acceptance bound (80 %)', () => {
    const rows: AccuracyRow[] = Array.from({ length: 10 }, (_, i) => ({
      volunteer_id: `v${i + 1}`,
      tape: { height: 170, shoulder: 40, bust: 90, waist: 70, hip: 100, inseam: 78 },
      scan: { height: 170, shoulder: 40, bust: 90 + (i < 3 ? 0 : 2.5), waist: 70, hip: 100, inseam: 78 },
    }));
    const bust = pointStats(rows, 'bust');
    expect(bust.within2).toBeCloseTo(0.3, 9);
    expect(bust.within2).toBeLessThan(0.8);
  });
});

describe('statsToMarkdown', () => {
  it('writes a table with the six points and the acceptance flag for flagged points', () => {
    const rows = parseAccuracyCsv(SAMPLE);
    const md = statsToMarkdown(allPointStats(rows), 'sample', new Date('2026-11-23T00:00:00Z'));
    expect(md).toMatch(/^# Accuracy report: sample/);
    expect(md).toContain('| Point |');
    for (const p of ACCURACY_POINTS) expect(md).toContain(`| ${p} |`);
    expect(md).toContain('2026-11-23');
    expect(md).toContain('Acceptance');
  });
});

describe('statsToConsole', () => {
  it('prints a fixed-width table the terminal can read', () => {
    const rows = parseAccuracyCsv(SAMPLE);
    const out = statsToConsole(allPointStats(rows));
    expect(out).toMatch(/^Point\s+n\s+mean/);
    for (const p of ACCURACY_POINTS) expect(out).toContain(p);
  });
});
