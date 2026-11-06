import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath } from '@curtain/mannequin';
import { beforeAll, describe, expect, it } from 'vitest';
import { PINNED_MODELS, canonicalJson, controlFrame, depthRange, exportJob, inputHash, sha256, turntableClips, type ExportOptions, type Phase0Manifest } from './exportJob';
import { decodePng } from './exportPng';
import { render } from './raster';
import { MANNEQUIN_GREY, MANNEQUIN_ID } from './separation';

/** Small job: the same code path as the CLI at a size a unit test can afford. Also the source of the pytest fixture. */
const SMALL_JOB: ExportOptions = { productId: 'monochrome-03', frames: 8, width: 64, height: 112, motionFrames: 5, syntheticPhotos: true };

function run(options: ExportOptions): { manifest: Phase0Manifest; files: Map<string, Uint8Array | string> } {
  const files = new Map<string, Uint8Array | string>();
  const { manifest } = exportJob(options, (p, d) => files.set(p, d));
  return { manifest, files };
}

const bytesOf = (d: Uint8Array | string | undefined): Uint8Array => {
  if (d === undefined) throw new Error('missing file');
  return typeof d === 'string' ? new TextEncoder().encode(d) : d;
};

let job: ReturnType<typeof run>;
beforeAll(() => {
  job = run(SMALL_JOB);
});

describe('turntable clips', () => {
  it('splits a turn into two 4k+1 half turns pinned front→back and back→front', () => {
    const [a, b] = turntableClips(160);
    expect(a!.frame_indices).toHaveLength(81);
    expect(a!.frame_indices[0]).toBe(0);
    expect(a!.frame_indices[80]).toBe(80);
    expect([a!.first_photo, a!.last_photo]).toEqual(['front', 'back']);
    expect(b!.frame_indices[0]).toBe(80);
    expect(b!.frame_indices[79]).toBe(159);
    expect(b!.frame_indices[80]).toBe(0);
    expect([b!.first_photo, b!.last_photo]).toEqual(['back', 'front']);
    expect(() => turntableClips(100)).toThrow(/multiple of 8/);
  });
});

describe('control depth', () => {
  it('stays inside the physical and the declared range, and matches the silhouette', () => {
    const mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
    const body = buildMannequinMesh(mannequin);
    const path = turntablePath(mannequin, 'turntable_mid', { frames: 8 });
    const range = depthRange(body.positions, path.frames);
    expect(range.nearCm).toBeGreaterThan(path.radiusCm - 80);
    expect(range.farCm).toBeLessThan(path.radiusCm + 80);
    for (const f of [path.frames[0]!, path.frames[2]!, path.frames[4]!]) {
      const r = render([{ positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID }], f, 96, 160);
      const c = controlFrame(r, range.nearCm, range.farCm);
      let fg = 0, nearest = Infinity, nearestVis = 0, farthest = 0, farthestVis = 0;
      for (let k = 0; k < c.depthMm.length; k++) {
        expect(c.mask[k] === 255).toBe(c.depthMm[k]! > 0);
        expect(c.depthVis[k]! > 0).toBe(c.depthMm[k]! > 0);
        if (!c.mask[k]) continue;
        fg++;
        expect(c.depthMm[k]!).toBeGreaterThanOrEqual(range.nearCm * 10);
        expect(c.depthMm[k]!).toBeLessThanOrEqual(range.farCm * 10);
        if (c.depthMm[k]! < nearest) [nearest, nearestVis] = [c.depthMm[k]!, c.depthVis[k]!];
        if (c.depthMm[k]! > farthest) [farthest, farthestVis] = [c.depthMm[k]!, c.depthVis[k]!];
      }
      expect(fg).toBeGreaterThan(500);
      expect(nearestVis).toBeGreaterThan(farthestVis); // near is bright
    }
  });

  it('writes 16-bit depth in mm that decodes to the rendered depth', () => {
    const png = decodePng(bytesOf(job.files.get('control/depth_mm/0000.png')));
    expect(png.bitDepth).toBe(16);
    expect([png.width, png.height]).toEqual([64, 112]);
    const fg = [...png.data].filter((v) => v > 0);
    expect(fg.length).toBeGreaterThan(100);
    expect(Math.min(...fg)).toBeGreaterThanOrEqual(job.manifest.control.near_cm * 10);
    expect(Math.max(...fg)).toBeLessThanOrEqual(job.manifest.control.far_cm * 10);
  });
});

describe('job manifest', () => {
  it('lists photos by role, base size, chart, fabric, mannequin, seeds and pinned models', () => {
    const m = job.manifest;
    expect(m.format).toBe('curtain.phase0.job');
    expect(m.product_id).toBe('monochrome-03');
    expect(m.base_size).toBe('M');
    expect(m.photos.map((p) => [p.role, p.path, p.synthetic])).toEqual([
      ['front', 'photos/front.png', true],
      ['back', 'photos/back.png', true],
    ]);
    for (const p of m.photos) expect(p.sha256).toBe(sha256(bytesOf(job.files.get(p.path))));
    expect(m.chart.rows.map((r) => r.size)).toContain('M');
    expect(m.fabric.format).toBe('curtain.garment.material');
    expect(m.mannequin.glb_sha256).toBe(sha256(bytesOf(job.files.get('mannequin.glb'))));
    expect(m.seeds).toEqual({ video: 43, recon: 7 });
    expect(m.models).toEqual(PINNED_MODELS);
    expect(m.clips.map((c) => [c.id, c.frame_indices.length])).toEqual([['turntable_a', 5], ['turntable_b', 5], ['motion', 5]]);
    expect(m.job_id).toBe(`monochrome-03-${m.input_hash.slice(0, 12)}`);
    for (const dir of ['control/depth_mm', 'control/depth_vis', 'control/mask', 'synthetic/rgb', 'synthetic/garment_mask']) {
      for (let i = 0; i < 8; i++) expect(job.files.has(`${dir}/${String(i).padStart(4, '0')}.png`)).toBe(true);
    }
    for (let i = 0; i < 5; i++) expect(job.files.has(`motion/depth_vis/${String(i).padStart(4, '0')}.png`)).toBe(true);
  });

  it('input_hash is the hash of hash_inputs as a reader of manifest.json sees them, in any key order', () => {
    const parsed = JSON.parse(new TextDecoder().decode(bytesOf(job.files.get('manifest.json')))) as Phase0Manifest;
    expect(inputHash(parsed.hash_inputs)).toBe(parsed.input_hash);
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":3}],"b":1}');
    const reversed = Object.fromEntries(Object.entries(parsed.hash_inputs).reverse());
    expect(inputHash(reversed)).toBe(parsed.input_hash);
  });

  it('is stable across runs (same hash, byte-identical files) and changes with the inputs it covers', () => {
    const again = run(SMALL_JOB);
    expect(again.manifest.input_hash).toBe(job.manifest.input_hash);
    expect([...again.files.keys()]).toEqual([...job.files.keys()]);
    for (const [p, d] of job.files) expect(sha256(bytesOf(again.files.get(p)))).toBe(sha256(bytesOf(d)));
    const seeds = run({ ...SMALL_JOB, synthetic: false, seeds: { video: 44, recon: 7 } }).manifest.input_hash;
    const noSynthetic = run({ ...SMALL_JOB, synthetic: false }).manifest.input_hash;
    expect(seeds).not.toBe(noSynthetic);
    expect(noSynthetic).not.toBe(job.manifest.input_hash);
  });

  it('requires merchant front and back photos unless asked for synthetic stills', () => {
    const png = new Uint8Array([1, 2, 3]);
    const base = { ...SMALL_JOB, syntheticPhotos: false, synthetic: false };
    expect(() => run({ ...base, photos: [{ role: 'front', bytes: png, ext: 'png', source: 'f.png' }] })).toThrow(/back photo is required/);
    expect(() => run({ ...base, photos: [{ role: 'front', bytes: png, ext: 'gif', source: 'f.gif' }] })).toThrow(/png, jpg or webp/);
    const details = Array.from({ length: 5 }, (_, i) => ({ role: 'detail' as const, bytes: png, ext: 'jpg', source: `d${i}.jpg` }));
    const pair = [{ role: 'front' as const, bytes: png, ext: 'jpeg', source: 'f.jpeg' }, { role: 'back' as const, bytes: new Uint8Array([4]), ext: 'png', source: 'b.png' }];
    expect(() => run({ ...base, photos: [...pair, ...details] })).toThrow(/at most 4 detail/);
    const ok = run({ ...base, photos: [...pair, details[0]!] });
    expect(ok.manifest.photos.map((p) => [p.role, p.path, p.synthetic, p.source])).toEqual([
      ['front', 'photos/front.jpg', false, 'f.jpeg'],
      ['back', 'photos/back.png', false, 'b.png'],
      ['detail', 'photos/detail_0.jpg', false, 'd0.jpg'],
    ]);
    expect(ok.files.get('photos/front.jpg')).toBe(png);
    // A different photo is a different job; the file name is not part of the hash.
    const renamed = run({ ...base, photos: [{ ...pair[0]!, source: 'other.jpeg' }, pair[1]!, details[0]!] });
    expect(renamed.manifest.input_hash).toBe(ok.manifest.input_hash);
    const otherBack = run({ ...base, photos: [pair[0]!, { ...pair[1]!, bytes: new Uint8Array([5]) }, details[0]!] });
    expect(otherBack.manifest.input_hash).not.toBe(ok.manifest.input_hash);
  });

  it('matches the pytest fixture the Modal helpers are tested against', () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'modal', 'tests', 'fixtures', 'manifest.json');
    const f = JSON.parse(readFileSync(fixture, 'utf8')) as Phase0Manifest;
    expect(f.input_hash).toBe(job.manifest.input_hash);
    expect(f.models).toEqual(PINNED_MODELS);
    expect(inputHash(f.hash_inputs)).toBe(f.input_hash);
  });
});
