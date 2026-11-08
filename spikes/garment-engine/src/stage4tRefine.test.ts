/**
 * Stage 4t 0.5.0 helpers: the off-reference pixels (consistency 0.4.0) as don't care in the IoU and cut from the bake's
 * masks, the record's mask-set hash (the same as `phase0_garment.file_set_sha256`), and the trousers' legs held on their
 * own side of the mid-plane (`keepLegsApart`).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { fileSetSha256, maskIouIgnoring, offReferenceSpansOnRecord, withoutPixels } from './stage4t';
import { keepLegsApart, LEG_MIDPLANE_GAP_CM } from './templateFit';

const mask = (bits: number[]): { width: number; height: number; data: Uint8Array } => ({ width: bits.length, height: 1, data: Uint8Array.from(bits) });

describe('off-reference pixels', () => {
  it('count for neither side of the IoU when ignored, and are cut from a copy of the mask', () => {
    const render = mask([1, 1, 1, 0, 0, 0]);
    const garment = mask([1, 1, 1, 1, 1, 0]); // two pixels of flap
    const flap = mask([0, 0, 0, 1, 1, 0]);
    expect(maskIouIgnoring(render, garment, null)).toBeCloseTo(3 / 5, 6);
    expect(maskIouIgnoring(render, garment, flap)).toBe(1);
    const cut = withoutPixels(garment, flap);
    expect(Array.from(cut.data)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(Array.from(garment.data)).toEqual([1, 1, 1, 1, 1, 0]);
    expect(withoutPixels(garment, null)).toBe(garment);
  });

  it('hashes a mask set as phase0_garment.file_set_sha256 does (base name, NUL, sha256 of the bytes, in order)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offref-'));
    const files = ['0000.png', '0001.png'].map((n, k) => {
      writeFileSync(join(dir, n), Buffer.from(`mask ${k}`));
      return join(dir, n);
    });
    const h = createHash('sha256');
    for (const [k, n] of ['0000.png', '0001.png'].entries()) {
      h.update(Buffer.concat([Buffer.from(`${n}\0`), createHash('sha256').update(Buffer.from(`mask ${k}`)).digest()]));
    }
    expect(fileSetSha256(files)).toBe(h.digest('hex'));
  });

  it('finds the spans on record (CPU re-score first, else the GPU record) so stage 4t can refuse a job without masks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'offref-'));
    expect(offReferenceSpansOnRecord(dir)).toEqual([]);
    mkdirSync(join(dir, 'stage2'));
    writeFileSync(join(dir, 'stage2/record.json'), JSON.stringify({ consistency: { off_reference_spans: [{ frame0: 1, frame1: 2 }] } }));
    expect(offReferenceSpansOnRecord(dir)).toHaveLength(1);
    writeFileSync(join(dir, 'stage2/consistency_v2.json'), JSON.stringify({ off_reference_spans: [{ frame0: 1 }, { frame0: 9 }] }));
    expect(offReferenceSpansOnRecord(dir)).toHaveLength(2);
    writeFileSync(join(dir, 'stage2/consistency_v2.json'), JSON.stringify({ off_reference_spans: [] }));
    expect(offReferenceSpansOnRecord(dir)).toEqual([]);
  });
});

describe('trouser legs kept apart (template fit 0.5.0)', () => {
  it('cuts the inward rays at the mid-plane and leaves the outward ones', () => {
    const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
    const y = m.landmarks.crotch[1] - 10;
    const l = m.legAt(y, 1)!, r = m.legAt(y, -1)!;
    const mid = (l.cx + r.cx) / 2;
    // One row of four rays per leg: out (+side x), in (−side x), front, back.
    const dirs = (side: number): [number, number, number][] => [[side, 0, 0], [-side, 0, 0], [0, 0, 1], [0, 0, -1]];
    const rays = [...dirs(1).map((d) => ({ o: [l.cx, y, l.cz] as [number, number, number], d, own: null })), ...dirs(-1).map((d) => ({ o: [r.cx, y, r.cz] as [number, number, number], d, own: null }))];
    const parts = [
      { name: 'leg_l' as const, rows: 1, cols: 4, offset: 0, v: new Float64Array(4) },
      { name: 'leg_r' as const, rows: 1, cols: 4, offset: 4, v: new Float64Array(4) },
    ];
    const lo = new Float64Array(8).fill(1), hi = new Float64Array(8).fill(40);
    const res = keepLegsApart({ m, parts, rays, present: new Uint8Array(8).fill(1), lo, hi });
    expect(res.clampedRays).toBe(2);
    // The inward ray of each leg ends LEG_MIDPLANE_GAP_CM short of the mid-plane.
    expect(l.cx - hi[1]!).toBeCloseTo(mid + LEG_MIDPLANE_GAP_CM, 6);
    expect(r.cx + hi[5]!).toBeCloseTo(mid - LEG_MIDPLANE_GAP_CM, 6);
    for (const i of [0, 2, 3, 4, 6, 7]) expect(hi[i]).toBe(40);
  });
});
